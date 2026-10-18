//! Synthetic HWP rejection, read-only export and owner roundtrip contract.
use rhwp::{
    document_core::DocumentCore,
    model::{
        control::Control,
        header_footer::{HeaderFooterApply, MasterPage},
        paragraph::Paragraph,
    },
};
use serde_json::{json, Value};
use std::{fs, path::Path};
fn text(n: &Value) -> String {
    let mut s = if n["type"] == "TextRun" {
        n["text"].as_str().unwrap_or("").to_string()
    } else {
        String::new()
    };
    if let Some(c) = n["children"].as_array() {
        for n in c {
            s += &text(n);
        }
    }
    s
}
fn frames(d: &DocumentCore) -> Value {
    json!((0..d.page_count()).map(|p|{let t:Value=serde_json::from_str(&d.build_page_render_tree(p).unwrap().root.to_json()).unwrap();json!({"info":serde_json::from_str::<Value>(&d.get_page_info_native(p).unwrap()).unwrap(),"masters":t["children"].as_array().unwrap().iter().filter(|n|n["type"]=="MasterPage").map(text).collect::<Vec<_>>()})}).collect::<Vec<_>>())
}
fn state(d: &DocumentCore) -> (String, Value) {
    (format!("{:?}", d.document()), frames(d))
}
fn seed(out: &Path) {
    fs::create_dir(out).unwrap();
    let mut d = DocumentCore::new_empty();
    d.create_blank_document_native().unwrap();
    let original = d.document().sections[0].clone();
    let mut doc = d.document().clone();
    doc.sections.clear();
    for i in 0..3 {
        let mut s = original.clone();
        let p = &mut s.paragraphs[0];
        p.insert_text_at(0, &format!("BODY_{i}"));
        s.section_def.page_def.width = if i == 0 { 59528 } else { 42000 };
        s.section_def.master_pages = vec![MasterPage {
            apply_to: HeaderFooterApply::Both,
            text_width: 20000,
            text_height: 5000,
            text_ref: 1,
            paragraphs: vec![Paragraph {
                text: format!("MASTER_{i}"),
                ..Default::default()
            }],
            ..Default::default()
        }];
        for c in &mut p.controls {
            if let Control::SectionDef(sd) = c {
                **sd = s.section_def.clone();
            }
        }
        s.raw_stream = None;
        doc.sections.push(s);
    }
    d.set_document(doc);
    fs::write(
        out.join("source-three-physical.hwpx"),
        d.export_hwpx_native().unwrap(),
    )
    .unwrap();
}
fn main() {
    let args: Vec<_> = std::env::args().skip(1).collect();
    if args[0] == "seed" {
        seed(Path::new(&args[1]));
        return;
    }
    let fixed = args[2] == "fixed";
    assert!(fixed || args[2] == "baseline");
    let fixtures: Vec<Value> = serde_json::from_slice(&fs::read(&args[0]).unwrap()).unwrap();
    let out = Path::new(&args[1]);
    fs::create_dir(out).unwrap();
    let control = fixtures
        .iter()
        .find(|f| f["case"] == "both-control")
        .unwrap();
    let sentinel = DocumentCore::from_bytes(&fs::read(control["path"].as_str().unwrap()).unwrap())
        .unwrap()
        .export_hwp_with_adapter_snapshot()
        .unwrap();
    let mut rows = Vec::new();
    let mut atomic = 0;
    let mut reopens = 0;
    let mut restores = 0;
    let mut owner_checks = 0;
    let mut raw_cache_rejections = 0;
    for f in &fixtures {
        let input = fs::read(f["path"].as_str().unwrap()).unwrap();
        let reject = f["rejectHwp"] == true;
        let name = f["case"].as_str().unwrap();
        let d = DocumentCore::from_bytes(&input).unwrap();
        let before = state(&d);
        let hx = d.export_hwpx_native().unwrap();
        let cold = DocumentCore::from_bytes(&hx).unwrap();
        assert_eq!(frames(&cold), before.1);
        assert!(state(&d) == before);
        reopens += 1;
        if reject {
            for api in 0..6 {
                let mut d = DocumentCore::from_bytes(&input).unwrap();
                d.insert_text_native(
                    0,
                    0,
                    d.document().sections[0].paragraphs[0].text.chars().count(),
                    "EDIT",
                )
                .unwrap();
                let snap = d.save_snapshot_native();
                let original = state(&d);
                let path = out.join(format!("{name}-{api}-existing.hwp"));
                fs::write(&path, &sentinel).unwrap();
                let r = match api {
                    0 => d.export_hwp_native(),
                    1 => d.export_hwp_with_adapter_snapshot(),
                    2 => d
                        .export_hwp_with_adapter_snapshot_with_report()
                        .map(|a| a.into_bytes()),
                    3 => d
                        .export_hwp_with_adapter_snapshot_with_password_and_report(b"qa-pass")
                        .map(|a| a.into_bytes()),
                    4 => d.export_hwp_with_adapter(),
                    _ => d.export_hwp_with_adapter_with_password(b"qa-pass"),
                };
                if fixed {
                    let error = r.as_ref().err().unwrap().to_string();
                    assert!(error.contains("단일 짝수 바탕쪽") && error.contains("HWPX"));
                    assert!(state(&d) == original, "rejection changes live model/layout");
                    atomic += 1;
                } else {
                    assert!(r.is_ok(), "baseline must expose silent HWP save");
                }
                if let Ok(bytes) = &r {
                    fs::write(&path, bytes).unwrap();
                }
                if fixed {
                    assert_eq!(fs::read(&path).unwrap(), sentinel);
                    let after = d.export_hwpx_native().unwrap();
                    let fresh = DocumentCore::from_bytes(&after).unwrap();
                    assert_eq!(frames(&fresh), original.1);
                    reopens += 1;
                    d.restore_snapshot_native(snap).unwrap();
                    assert!(state(&d) == original);
                    restores += 1;
                }
                d.discard_snapshot_native(snap);
                rows.push(json!({"case":name,"api":api,"rejected":r.is_err(),"fileUnchanged":fs::read(&path).unwrap()==sentinel}));
            }
            if fixed {
                let mut cached = DocumentCore::from_bytes(&input).unwrap();
                for section in &mut cached.document_mut().sections {
                    section.raw_stream = Some(Vec::new());
                    section.seal_raw_provenance();
                }
                let original = state(&cached);
                let error = cached.export_hwp_with_adapter().unwrap_err().to_string();
                assert!(error.contains("단일 짝수 바탕쪽"));
                assert!(
                    state(&cached) == original,
                    "adapter raw cache cannot bypass read-only rejection"
                );
                raw_cache_rejections += 1;
            }
        } else {
            let h = d.export_hwp_with_adapter_snapshot().unwrap();
            let c = DocumentCore::from_bytes(&h).unwrap();
            assert_eq!(frames(&c), frames(&d));
            let h2 = c.export_hwp_with_adapter_snapshot().unwrap();
            let c2 = DocumentCore::from_bytes(&h2).unwrap();
            assert_eq!(frames(&c2), frames(&d));
            let x = c.export_hwpx_native().unwrap();
            let c3 = DocumentCore::from_bytes(&x).unwrap();
            assert_eq!(frames(&c3), frames(&d));
            assert!(state(&d) == before);
            reopens += 3;
            rows.push(json!({"case":name,"supportedHwp":true,"cycleEqual":true}));
        }
        if name == "two-odd-even-restart3" || name == "same-visible-content" {
            let mut d = DocumentCore::from_bytes(&input).unwrap();
            let initial = d.save_snapshot_native();
            let mut doc = d.document().clone();
            let s = &mut doc.sections[0];
            for p in &mut s.section_def.master_pages[0].paragraphs {
                let len = p.text.chars().count();
                p.delete_text_at(0, len);
                p.insert_text_at(0, "AFTER_0");
            }
            for c in &mut s.paragraphs[0].controls {
                if let Control::SectionDef(sd) = c {
                    **sd = s.section_def.clone();
                }
            }
            s.raw_stream = None;
            d.set_document(doc);
            assert_eq!(frames(&d)[1]["masters"], json!(["AFTER_0"]));
            let changed = state(&d);
            let bytes = d.export_hwpx_native().unwrap();
            let c = DocumentCore::from_bytes(&bytes).unwrap();
            assert_eq!(frames(&c), changed.1);
            let r = d.export_hwp_with_adapter_snapshot();
            if fixed {
                assert!(r.is_err());
                assert!(state(&d) == changed);
            } else {
                let c = DocumentCore::from_bytes(&r.unwrap()).unwrap();
                assert_ne!(frames(&c), changed.1);
            }
            d.restore_snapshot_native(initial).unwrap();
            assert_eq!(frames(&d), before.1);
            d.discard_snapshot_native(initial);
            owner_checks += 1;
            restores += 1;
            reopens += 1;
        }
    }
    let proof = json!({"mode":args[2],"cases":fixtures.len(),"knownRejectedCases":fixtures.iter().filter(|f|f["rejectHwp"]==true).count(),"atomicRejections":atomic,"reopens":reopens,"snapshotRestores":restores,"ownerEditChecks":owner_checks,"rawAdapterCacheRejections":raw_cache_rejections,"rows":rows,"GUIVerified":false});
    fs::write(
        out.join("proof.json"),
        serde_json::to_vec_pretty(&proof).unwrap(),
    )
    .unwrap();
    println!(
        "cases={} atomicRejections={atomic} reopens={reopens}",
        fixtures.len()
    );
}

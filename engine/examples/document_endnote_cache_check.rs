//! Compact live/reopen oracle for document-end notes. No GUI or Hancom claim.
use rhwp::{
    document_core::DocumentCore,
    model::{control::Control, footnote::FootnotePlacement},
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{fs, path::Path};
fn digest(s: &str) -> String {
    Sha256::digest(s.as_bytes())
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}
fn text(node: &Value, out: &mut String) {
    if node["type"] == "TextRun" {
        out.push_str(node["text"].as_str().unwrap_or_default());
    }
    if let Some(children) = node["children"].as_array() {
        for child in children {
            text(child, out);
        }
    }
}
fn view(d: &DocumentCore) -> Value {
    let pages: Vec<_> = (0..d.page_count()).map(|p| {
        let info: Value = serde_json::from_str(&d.get_page_info_native(p).unwrap()).unwrap();
        let tree: Value = serde_json::from_str(&d.build_page_render_tree(p).unwrap().root.to_json()).unwrap();
        let mut rendered = String::new(); text(&tree, &mut rendered);
        json!({"info": info, "textSHA256": digest(&rendered), "textChars": rendered.chars().count()})
    }).collect();
    let mut notes = Vec::new();
    for (si, s) in d.document().sections.iter().enumerate() {
        for (pi, p) in s.paragraphs.iter().enumerate() {
            for (ci, c) in p.controls.iter().enumerate() {
                let (kind, paragraphs) = match c {
                    Control::Endnote(n) => ("endnote", &n.paragraphs),
                    Control::Footnote(n) => ("footnote", &n.paragraphs),
                    _ => continue,
                };
                notes.push(json!({"section":si,"paragraph":pi,"control":ci,"kind":kind,"texts":paragraphs.iter().map(|p|json!({"chars":p.text.chars().count(),"sha256":digest(&p.text)})).collect::<Vec<_>>()}));
            }
        }
    }
    json!({"pages":pages,"notes":notes,"body":d.document().sections.iter().map(|s|s.paragraphs.iter().map(|p|p.text.clone()).collect::<Vec<_>>()).collect::<Vec<_>>()})
}
fn check(d: &DocumentCore, out: &Path, case: &str, stage: &str) -> Value {
    let live = view(d);
    let bytes = d.export_hwpx_native().unwrap();
    fs::write(out.join(format!("{case}-{stage}.hwpx")), &bytes).unwrap();
    let cold = DocumentCore::from_bytes(&bytes).unwrap();
    let fresh = view(&cold);
    assert_eq!(live["body"], fresh["body"]);
    assert_eq!(live["notes"], fresh["notes"]);
    let mut rebuilt = DocumentCore::new_empty();
    rebuilt.set_document(d.document().clone());
    assert_eq!(
        view(&rebuilt),
        fresh,
        "direct model rebuild isolates the pagination cache"
    );
    assert_eq!(view(d), live, "export is read-only");
    json!({"case":case,"stage":stage,"equal":live==fresh,"live":live,"cold":fresh})
}
fn seed(out: &Path) {
    fs::create_dir(out).unwrap();
    for count in [2, 3] {
        let mut d = DocumentCore::new_empty();
        d.create_blank_document_native().unwrap();
        d.insert_text_native(0, 0, 0, "SEED").unwrap();
        let original = d.document().sections[0].clone();
        let mut sections = Vec::new();
        for i in 0..count {
            let mut s = original.clone();
            let p = &mut s.paragraphs[0];
            let len = p.text.chars().count();
            p.delete_text_at(0, len);
            p.insert_text_at(0, &format!("BODY_{i}"));
            s.section_def.page_def.width = if i == 0 { 59528 } else { 42000 };
            s.section_def.master_pages.clear();
            s.section_def.endnote_shape.placement = FootnotePlacement::EachColumn;
            s.section_def.endnote_shape.attr &= !0x300;
            for c in &mut p.controls {
                if let Control::SectionDef(sd) = c {
                    **sd = s.section_def.clone();
                }
            }
            s.raw_stream = None;
            sections.push(s);
        }
        let mut doc = d.document().clone();
        doc.sections = sections;
        d.set_document(doc);
        let inserted: Value =
            serde_json::from_str(&d.insert_endnote_native(0, 0, 0).unwrap()).unwrap();
        let ci = inserted["controlIdx"].as_u64().unwrap() as usize;
        d.insert_text_in_footnote_native(0, 0, ci, 0, 0, "note")
            .unwrap();
        fs::write(
            out.join(format!("seed-{count}.hwpx")),
            d.export_hwpx_native().unwrap(),
        )
        .unwrap();
    }
}
fn main() {
    let args: Vec<_> = std::env::args().skip(1).collect();
    if args[0] == "seed" {
        seed(Path::new(&args[1]));
        return;
    }
    let fixtures: Vec<Value> = serde_json::from_slice(&fs::read(&args[0]).unwrap()).unwrap();
    let out = Path::new(&args[1]);
    fs::create_dir(out).unwrap();
    let mut rows = Vec::new();
    let mut restores = 0;
    for f in &fixtures {
        let case = f["case"].as_str().unwrap();
        let mut d =
            DocumentCore::from_bytes(&fs::read(f["path"].as_str().unwrap()).unwrap()).unwrap();
        let targets = f["targets"].as_array().unwrap();
        rows.push(check(&d, out, case, "before"));
        let initial = d.save_snapshot_native();
        for t in targets {
            d.insert_text_in_footnote_native(
                t[0].as_u64().unwrap() as usize,
                0,
                t[1].as_u64().unwrap() as usize,
                0,
                0,
                "Z",
            )
            .unwrap();
        }
        rows.push(check(&d, out, case, "small"));
        for t in targets {
            d.delete_text_in_footnote_native(
                t[0].as_u64().unwrap() as usize,
                0,
                t[1].as_u64().unwrap() as usize,
                0,
                0,
                1,
            )
            .unwrap();
        }
        let added = "NOTE_CONTENT ".repeat(f["repeat"].as_u64().unwrap() as usize);
        d.begin_batch_native().unwrap();
        for t in targets {
            d.insert_text_in_footnote_native(
                t[0].as_u64().unwrap() as usize,
                0,
                t[1].as_u64().unwrap() as usize,
                0,
                0,
                &added,
            )
            .unwrap();
        }
        d.end_batch_native().unwrap();
        let grown = check(&d, out, case, "grown");
        let grown_cold = grown["cold"].clone();
        rows.push(grown);
        let after = d.save_snapshot_native();
        d.restore_snapshot_native(initial).unwrap();
        restores += 1;
        rows.push(check(&d, out, case, "undo"));
        d.restore_snapshot_native(after).unwrap();
        restores += 1;
        assert_eq!(view(&d), grown_cold);
        rows.push(check(&d, out, case, "redo"));
        d.begin_batch_native().unwrap();
        for t in targets {
            d.delete_text_in_footnote_native(
                t[0].as_u64().unwrap() as usize,
                0,
                t[1].as_u64().unwrap() as usize,
                0,
                0,
                added.chars().count(),
            )
            .unwrap();
        }
        d.end_batch_native().unwrap();
        rows.push(check(&d, out, case, "shrunk"));
        if f["structural"] == true {
            let si = targets[0][0].as_u64().unwrap() as usize;
            let ci = targets[0][1].as_u64().unwrap() as usize;
            d.delete_footnote_native(si, 0, ci).unwrap();
            rows.push(check(&d, out, case, "removed"));
            let inserted: Value =
                serde_json::from_str(&d.insert_endnote_native(si, 0, 0).unwrap()).unwrap();
            let ci = inserted["controlIdx"].as_u64().unwrap() as usize;
            d.insert_text_in_footnote_native(si, 0, ci, 0, 0, "NEW_NOTE")
                .unwrap();
            rows.push(check(&d, out, case, "added"));
        }
        d.restore_snapshot_native(initial).unwrap();
        restores += 1;
        rows.push(check(&d, out, case, "restored"));
        d.discard_snapshot_native(initial);
        d.discard_snapshot_native(after);
    }
    let mismatches = rows.iter().filter(|r| r["equal"] != true).count();
    let proof = json!({"mode":args[2],"cases":fixtures.len(),"comparisons":rows.len(),"mismatches":mismatches,"hwpxReopens":rows.len(),"fullRebuilds":rows.len(),"snapshotRestores":restores,"rows":rows,"GUIVerified":false});
    fs::write(
        out.join("proof.json"),
        serde_json::to_vec_pretty(&proof).unwrap(),
    )
    .unwrap();
    if args[2] == "baseline" {
        assert!(mismatches > 0);
    } else {
        assert_eq!(mismatches, 0);
    }
    println!(
        "cases={} comparisons={} mismatches={}",
        fixtures.len(),
        rows.len(),
        mismatches
    );
}

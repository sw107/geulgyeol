//! Runtime NewStart replay across pages; synthetic input, no native-app UI claim.
use rhwp::{document_core::DocumentCore, model::paragraph::NumberingRestart};
use serde_json::{json, Value};
use std::{collections::BTreeSet, fs, path::Path};
fn observe(d: &DocumentCore, reverse: bool) -> Value {
    let mut indices = (0..d.page_count()).collect::<Vec<_>>();
    if reverse {
        indices.reverse();
    }
    let mut runs = Vec::new();
    for p in indices {
        let v: Value = serde_json::from_str(&d.get_page_text_layout_native(p).unwrap()).unwrap();
        for r in v["runs"].as_array().unwrap() {
            let mut r = r.clone();
            r["page"] = json!(p);
            runs.push(r);
        }
    }
    runs.sort_by(|a, b| {
        a["page"]
            .as_u64()
            .cmp(&b["page"].as_u64())
            .then_with(|| a["y"].as_f64().partial_cmp(&b["y"].as_f64()).unwrap())
            .then_with(|| a["x"].as_f64().partial_cmp(&b["x"].as_f64()).unwrap())
    });
    let body = runs
        .iter()
        .filter(|r| {
            r["paraIdx"] == 1
                && r["charStart"].is_number()
                && !r["text"].as_str().unwrap_or("").is_empty()
        })
        .collect::<Vec<_>>();
    let first = body.iter().find(|r| r["charStart"] == 0).unwrap();
    let first_page = first["page"].as_u64().unwrap();
    let first_x = first["x"].as_f64().unwrap();
    let mut seen = BTreeSet::new();
    let mut later = Vec::new();
    for r in body
        .iter()
        .filter(|r| r["page"].as_u64().unwrap() > first_page)
    {
        let key = (r["page"].to_string(), r["y"].to_string());
        if seen.insert(key) {
            let x = r["x"].as_f64().unwrap();
            assert!(
                (x - first_x).abs() < 0.11,
                "NewStart continuation: {x} != {first_x}"
            );
            later.push(json!({"page":r["page"],"x":r["x"],"charStart":r["charStart"]}));
        }
    }
    assert!(later.len() > 20);
    let markers = runs
        .iter()
        .filter(|r| {
            !r["charStart"].is_number()
                && r["text"].as_str().map_or(false, |t| {
                    t.ends_with('.') && t[..t.len() - 1].chars().all(|c| c.is_ascii_digit())
                })
        })
        .map(|r| r["text"].clone())
        .collect::<Vec<_>>();
    assert_eq!(
        markers,
        json!(["1.", "123.", "124."]).as_array().unwrap().clone()
    );
    json!({"pages":d.page_count(),"firstX":first_x,"later":later,"markers":markers,"text":d.document().sections[0].paragraphs.iter().map(|p| &p.text).collect::<Vec<_>>()})
}
fn main() {
    let args = std::env::args().collect::<Vec<_>>();
    assert_eq!(args.len(), 3);
    let out = Path::new(&args[2]);
    assert!(!out.exists());
    fs::create_dir_all(out).unwrap();
    let mut d = DocumentCore::from_bytes(&fs::read(&args[1]).unwrap()).unwrap();
    let para = &d.document().sections[0].paragraphs[1];
    let props: Value =
        serde_json::from_str(&d.get_para_properties_at_native(0, 1).unwrap()).unwrap();
    let id = props["numberingId"].as_u64().unwrap() as usize;
    assert_eq!(d.document().doc_info.numberings[id - 1].start_number, 1);
    assert_eq!(
        d.document().doc_info.numberings[id - 1].heads[0].attr & 12,
        12
    );
    assert!(para.numbering_restart.is_none());
    d.set_numbering_restart_native(0, 1, 2, 123).unwrap();
    assert_eq!(
        d.document().sections[0].paragraphs[1].numbering_restart,
        Some(NumberingRestart::NewStart(123))
    );
    let initial = observe(&d, false);
    assert_eq!(observe(&d, true), initial);
    let mut stages = Vec::new();
    for (i, ext) in ["hwpx", "hwp", "hwpx", "hwp"].iter().enumerate() {
        let a = if *ext == "hwp" {
            d.export_hwp_with_adapter_snapshot_with_report()
        } else {
            d.export_hwpx_native_with_report()
        }
        .unwrap();
        assert!(a.content_loss().is_empty());
        let b = a.into_bytes();
        fs::write(out.join(format!("reopen-{i}.{ext}")), &b).unwrap();
        d = DocumentCore::from_bytes(&b).unwrap();
        let v = observe(&d, true);
        assert_eq!(v, initial);
        stages.push(ext);
    }
    let proof = json!({"definitionStart":1,"restart":123,"flags":12,"positions":initial,"saveReopens":stages.len(),"restartReappliedAfterEachLoad":false,"nativeAppUI":false});
    fs::write(
        out.join("proof.json"),
        serde_json::to_vec_pretty(&proof).unwrap(),
    )
    .unwrap();
    println!(
        "{}",
        json!({"pages":proof["positions"]["pages"],"laterLines":proof["positions"]["later"].as_array().unwrap().len(),"saveReopens":4,"restartReappliedAfterEachLoad":false})
    );
}

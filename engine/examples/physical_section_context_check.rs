//! Native live/cold pagination contract for synthetic physical-section fixtures.
use rhwp::document_core::DocumentCore;
use serde_json::{json, Value};
use std::{fs, path::Path};

fn collect_text(node: &Value, out: &mut String) {
    if node["type"] == "TextRun" {
        out.push_str(node["text"].as_str().unwrap_or_default());
    }
    if let Some(children) = node["children"].as_array() {
        for child in children {
            collect_text(child, out);
        }
    }
}

fn frames(d: &DocumentCore) -> Value {
    json!((0..d.page_count())
        .map(|pi| {
            let info: Value = serde_json::from_str(&d.get_page_info_native(pi).unwrap()).unwrap();
            let tree: Value =
                serde_json::from_str(&d.build_page_render_tree(pi).unwrap().root.to_json())
                    .unwrap();
            let decorations: Vec<_> = tree["children"]
                .as_array()
                .unwrap()
                .iter()
                .filter(|n| matches!(n["type"].as_str(), Some("MasterPage" | "Header" | "Footer")))
                .map(|n| {
                    let mut text = String::new();
                    collect_text(n, &mut text);
                    json!({"type":n["type"],"text":text})
                })
                .collect();
            json!({"info":info,"decorations":decorations})
        })
        .collect::<Vec<_>>())
}

fn body(d: &DocumentCore) -> Value {
    json!(d
        .document()
        .sections
        .iter()
        .map(|s| s.paragraphs.iter().map(|p| &p.text).collect::<Vec<_>>())
        .collect::<Vec<_>>())
}

fn check(d: &DocumentCore, out: &Path, case: &str, stage: &str, hwp: bool) -> Value {
    let live = frames(d);
    let bytes = d.export_hwpx_native().unwrap();
    fs::write(out.join(format!("{case}-{stage}.hwpx")), &bytes).unwrap();
    let cold = DocumentCore::from_bytes(&bytes).unwrap();
    assert_eq!(body(&cold), body(d));
    assert_eq!(frames(d), live, "export leaves live pagination untouched");
    let cold_frames = frames(&cold);
    if hwp {
        // Match the public WASM export API, including the HWPX-to-HWP adapter.
        let bytes = d.export_hwp_with_adapter_snapshot().unwrap();
        fs::write(out.join(format!("{case}-{stage}.hwp")), &bytes).unwrap();
        let hwp = DocumentCore::from_bytes(&bytes).unwrap();
        assert_eq!(body(&hwp), body(d));
        assert_eq!(
            frames(&hwp),
            cold_frames,
            "both format reopens agree on page context"
        );
    }
    let mut rebuilt = DocumentCore::new_empty();
    rebuilt.set_document(d.document().clone());
    let rebuilt_frames = frames(&rebuilt);
    assert_eq!(
        rebuilt_frames, cold_frames,
        "independent in-memory rebuild isolates cache from serialization"
    );
    json!({"case":case,"stage":stage,"equal":live==cold_frames,"live":live,"cold":cold_frames,"hwpReopened":hwp})
}

fn carry_history(
    d: &mut DocumentCore,
    out: &Path,
    case: &str,
    target: usize,
    rows: &mut Vec<Value>,
) -> usize {
    let before = frames(d);
    let initial = d.save_snapshot_native();
    rows.push(check(d, out, case, "before", false));
    d.insert_text_native(target, 0, 0, "X").unwrap();
    assert_eq!(
        d.page_count() as usize,
        before.as_array().unwrap().len(),
        "one character must not change page count"
    );
    let short = check(d, out, case, "one-character", false);
    let short_cold = short["cold"].clone();
    rows.push(short);
    let short_snapshot = d.save_snapshot_native();
    let growth = " batch-owner growth 가나다라 abcdef ".repeat(200);
    let last = d.document().sections.len() - 1;
    d.begin_batch_native().unwrap();
    d.insert_text_native(0, 0, 0, &growth).unwrap();
    d.insert_text_native(last, 0, 0, "TAIL_EDIT").unwrap();
    d.end_batch_native().unwrap();
    let batch = check(d, out, case, "batch-grown", false);
    let batch_cold = batch["cold"].clone();
    rows.push(batch);
    let batch_snapshot = d.save_snapshot_native();
    d.restore_snapshot_native(short_snapshot).unwrap();
    assert_eq!(frames(d), short_cold);
    rows.push(check(d, out, case, "undo-batch", false));
    d.restore_snapshot_native(batch_snapshot).unwrap();
    assert_eq!(frames(d), batch_cold);
    rows.push(check(d, out, case, "redo-batch", false));
    d.begin_batch_native().unwrap();
    d.delete_text_native(0, 0, 0, growth.chars().count())
        .unwrap();
    d.delete_text_native(last, 0, 0, "TAIL_EDIT".chars().count())
        .unwrap();
    d.end_batch_native().unwrap();
    rows.push(check(d, out, case, "batch-shrunk", false));
    d.restore_snapshot_native(initial).unwrap();
    assert_eq!(frames(d), before);
    rows.push(check(d, out, case, "restored", false));
    d.restore_snapshot_native(short_snapshot).unwrap();
    assert_eq!(frames(d), short_cold);
    rows.push(check(d, out, case, "redo-one-character", false));
    d.restore_snapshot_native(initial).unwrap();
    rows.push(check(d, out, case, "final-before", false));
    for snapshot in [initial, short_snapshot, batch_snapshot] {
        d.discard_snapshot_native(snapshot);
    }
    5
}

fn main() {
    let args: Vec<_> = std::env::args().skip(1).collect();
    let fixtures: Vec<Value> = serde_json::from_slice(&fs::read(&args[0]).unwrap()).unwrap();
    let out = Path::new(&args[1]);
    fs::create_dir(out).unwrap();
    let mut rows = Vec::new();
    let mut restores = 0;
    for fixture in &fixtures {
        let case = fixture["case"].as_str().unwrap();
        let target = fixture["target"].as_u64().unwrap() as usize;
        let hwp = fixture["crossFormatHwp"] == true;
        let mut d = DocumentCore::from_bytes(&fs::read(fixture["path"].as_str().unwrap()).unwrap())
            .unwrap();
        if fixture["carryHistory"] == true {
            restores += carry_history(&mut d, out, case, target, &mut rows);
            continue;
        }
        let start = d.document().sections[target].paragraphs[0]
            .text
            .chars()
            .count();
        let added = " first-owner continuation 가나다라 abcdef ".repeat(160);
        rows.push(check(&d, out, case, "before", hwp));
        let snapshot = d.save_snapshot_native();
        d.insert_text_native(target, 0, start, &added).unwrap();
        rows.push(check(&d, out, case, "grown", hwp));
        d.delete_text_native(target, 0, start, added.chars().count())
            .unwrap();
        rows.push(check(&d, out, case, "shrunk", hwp));
        d.insert_text_native(target, 0, start, &added).unwrap();
        rows.push(check(&d, out, case, "regrown", hwp));
        d.restore_snapshot_native(snapshot).unwrap();
        restores += 1;
        rows.push(check(&d, out, case, "restored", hwp));
        d.discard_snapshot_native(snapshot);
    }
    let mismatches = rows.iter().filter(|r| r["equal"] != true).count();
    let hwp_reopens = rows.iter().filter(|r| r["hwpReopened"] == true).count();
    let proof = json!({"mode":args[2],"cases":fixtures.len(),"comparisons":rows.len(),"mismatches":mismatches,
        "reopens":rows.len(),"hwpReopens":hwp_reopens,"fullRebuilds":rows.len(),"snapshotRestores":restores,"rows":rows,"GUIVerified":false});
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
        "cases={} comparisons={} mismatches={} restores={}",
        fixtures.len(),
        rows.len(),
        mismatches,
        restores
    );
}

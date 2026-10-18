//! Source-addressed note entry and caret queries; synthetic fixtures only.
use rhwp::document_core::DocumentCore;
use serde_json::{json, Value};
use std::{fs, path::Path};

fn query(d: &DocumentCore, s: usize, c: usize, inner: usize) -> Value {
    let result = (|| -> Result<Value, String> {
        let info: Value = serde_json::from_str(
            &d.get_note_edit_info_native(s, 0, c)
                .map_err(|e| e.to_string())?,
        )
        .unwrap();
        let rect: Value = serde_json::from_str(
            &d.get_cursor_rect_in_note_native(s, 0, c, inner, if inner == 0 { 2 } else { 0 })
                .map_err(|e| e.to_string())?,
        )
        .unwrap();
        assert_eq!(info["ok"], true);
        let page = info["pageNum"].as_u64().unwrap() as u32;
        assert!(page < d.page_count());
        if inner == 0 {
            assert_eq!(info["pageNum"], rect["pageIndex"]);
        }
        for k in ["x", "y", "height"] {
            assert!(rect[k].as_f64().unwrap().is_finite());
        }
        assert!(rect["height"].as_f64().unwrap() > 0.0);
        Ok(json!({"info":info,"rect":rect}))
    })();
    match result {
        Ok(v) => v,
        Err(e) => json!({"error":e}),
    }
}

fn check(d: &DocumentCore, f: &Value, stage: &str, inner: usize, rows: &mut Vec<Value>) {
    let bytes = d.export_hwpx_native().unwrap();
    let cold = DocumentCore::from_bytes(&bytes).unwrap();
    for t in f["targets"].as_array().unwrap() {
        let s = t[0].as_u64().unwrap() as usize;
        let c = t[1].as_u64().unwrap() as usize;
        let live = query(d, s, c, inner);
        assert_eq!(
            live,
            query(&cold, s, c, inner),
            "live/fresh entry and caret"
        );
        rows.push(json!({"case":f["case"],"stage":stage,"section":s,"control":c,"inner":inner,"result":live}));
    }
}

fn main() {
    let args: Vec<_> = std::env::args().skip(1).collect();
    assert!(args[2] == "baseline" || args[2] == "fixed");
    let fixtures: Vec<Value> = serde_json::from_slice(&fs::read(&args[0]).unwrap()).unwrap();
    let out = Path::new(&args[1]);
    fs::create_dir(out).unwrap();
    let mut rows = Vec::new();
    let mut negative_checks = 0;
    for f in &fixtures {
        let mut d =
            DocumentCore::from_bytes(&fs::read(f["path"].as_str().unwrap()).unwrap()).unwrap();
        let targets = f["targets"].as_array().unwrap();
        check(&d, f, "before", 0, &mut rows);
        assert!(d.get_note_edit_info_native(usize::MAX, 0, 0).is_err());
        assert!(d.get_note_edit_info_native(0, usize::MAX, 0).is_err());
        assert!(d.get_note_edit_info_native(0, 0, usize::MAX).is_err());
        assert!(d.get_note_edit_info_native(0, 0, 0).is_err());
        negative_checks += 4;
        let initial = d.save_snapshot_native();
        for t in targets {
            let (s, c) = (
                t[0].as_u64().unwrap() as usize,
                t[1].as_u64().unwrap() as usize,
            );
            d.insert_text_in_footnote_native(s, 0, c, 0, 2, "ENTRY_X")
                .unwrap();
        }
        check(&d, f, "typed", 0, &mut rows);
        let typed = d.save_snapshot_native();
        for t in targets {
            d.split_paragraph_in_footnote_native(
                t[0].as_u64().unwrap() as usize,
                0,
                t[1].as_u64().unwrap() as usize,
                0,
                3,
                None,
            )
            .unwrap();
        }
        check(&d, f, "split", 1, &mut rows);
        for t in targets {
            d.merge_paragraph_in_footnote_native(
                t[0].as_u64().unwrap() as usize,
                0,
                t[1].as_u64().unwrap() as usize,
                1,
            )
            .unwrap();
        }
        check(&d, f, "merged", 0, &mut rows);
        d.restore_snapshot_native(initial).unwrap();
        check(&d, f, "undo", 0, &mut rows);
        d.restore_snapshot_native(typed).unwrap();
        check(&d, f, "redo", 0, &mut rows);
        d.restore_snapshot_native(initial).unwrap();
        check(&d, f, "restored", 0, &mut rows);
        d.discard_snapshot_native(initial);
        d.discard_snapshot_native(typed);
    }
    let failures = rows
        .iter()
        .filter(|r| !r["result"]["error"].is_null())
        .count();
    let proof = json!({"mode":args[2],"cases":fixtures.len(),"queries":rows.len(),"failedQueries":failures,"hwpxReopens":fixtures.len()*7,"snapshotRestores":fixtures.len()*3,"negativeChecks":negative_checks,"rows":rows,"GUIVerified":false});
    fs::write(
        out.join("proof.json"),
        serde_json::to_vec_pretty(&proof).unwrap(),
    )
    .unwrap();
    if args[2] == "baseline" {
        assert!(failures > 0);
    } else {
        assert_eq!(failures, 0);
    }
    println!(
        "cases={} queries={} failedQueries={}",
        fixtures.len(),
        rows.len(),
        failures
    );
}

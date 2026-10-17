//! Synthetic cell-fragment coordinates, independent Native save/reopen and runtime NewStart.
use rhwp::{
    document_core::DocumentCore,
    model::{control::Control, paragraph::NumberingRestart},
};
use serde_json::{json, Value};
use std::{collections::BTreeMap, fs, path::Path};

fn number(v: &Value, key: &str) -> usize {
    v[key].as_u64().unwrap() as usize
}

fn observe(d: &DocumentCore, row: &Value, reverse: bool, restart: bool) -> Value {
    let mut pages = (0..d.page_count()).collect::<Vec<_>>();
    if reverse {
        pages.reverse();
    }
    let mut runs = Vec::new();
    for page in pages {
        let layout: Value =
            serde_json::from_str(&d.get_page_text_layout_native(page).unwrap()).unwrap();
        for run in layout["runs"].as_array().unwrap() {
            let mut run = run.clone();
            run["page"] = json!(page);
            runs.push(run);
        }
    }
    let mut cells = Vec::new();
    for cell in 0..number(row, "columns") {
        let owned = runs
            .iter()
            .filter(|r| {
                r["parentParaIdx"] == row["parent"]
                    && r["controlIdx"] == row["ci"]
                    && r["cellIdx"] == cell
            })
            .collect::<Vec<_>>();
        let mut markers = owned.iter().filter(|r| !r["charStart"].is_number()
            && r["text"].as_str().is_some_and(|s| s.ends_with('.') && s[..s.len()-1].chars().all(|c| c.is_ascii_digit())))
            .map(|r| json!({"text":r["text"], "paragraph":r["cellParaIdx"], "page":r["page"], "x":r["x"]})).collect::<Vec<_>>();
        markers.sort_by_key(|r| number(r, "paragraph"));
        let expected = if restart && cell == 0 {
            vec!["123.", "12467.", "12468."]
        } else {
            vec!["123.", "124.", "125."]
        };
        assert_eq!(
            markers
                .iter()
                .map(|r| r["text"].as_str().unwrap())
                .collect::<Vec<_>>(),
            expected
        );
        let mut lines = BTreeMap::<(usize, i64), &Value>::new();
        for r in owned
            .iter()
            .filter(|r| r["cellParaIdx"] == 1 && r["charStart"].is_number())
        {
            let key = (
                number(r, "page"),
                (r["y"].as_f64().unwrap() * 10.0).round() as i64,
            );
            let entry = lines.entry(key).or_insert(r);
            if number(r, "charStart") < number(entry, "charStart") {
                *entry = r;
            }
        }
        let first = lines.values().find(|r| r["charStart"] == 0).unwrap();
        let target = if number(row, "bits") & 8 != 0 {
            first["x"].as_f64().unwrap()
        } else {
            markers[1]["x"].as_f64().unwrap()
        };
        let later = lines
            .values()
            .filter(|r| number(r, "page") > number(first, "page"))
            .map(|r| {
                assert!(
                    (r["x"].as_f64().unwrap() - target).abs() < 0.15,
                    "{} cell {cell} x={} target={target}",
                    row["file"],
                    r["x"]
                );
                json!({"page":r["page"],"x":r["x"],"y":r["y"],"charStart":r["charStart"]})
            })
            .collect::<Vec<_>>();
        assert!(later.len() > 10);
        let Control::Table(table) =
            &d.document().sections[0].paragraphs[number(row, "parent")].controls[number(row, "ci")]
        else {
            panic!("table")
        };
        let semantics=table.cells[cell].paragraphs.iter().map(|para|json!({
            "text":para.text,"style":para.style_id,"chars":para.char_shapes,"paraShape":para.para_shape_id,
        })).collect::<Vec<_>>();
        cells.push(json!({"cell":cell,"firstX":first["x"],"targetX":target,"later":later,"markers":markers,"semantics":semantics}));
    }
    json!({"pages":d.page_count(),"cells":cells})
}

fn main() {
    let args = std::env::args().collect::<Vec<_>>();
    assert_eq!(args.len(), 3);
    let fixtures = Path::new(&args[1]);
    let out = Path::new(&args[2]);
    assert!(!out.exists());
    fs::create_dir_all(out).unwrap();
    let manifest: Vec<Value> =
        serde_json::from_slice(&fs::read(fixtures.join("manifest.json")).unwrap()).unwrap();
    assert_eq!(manifest.len(), 16);
    let mut results = Vec::new();
    let mut reopens = 0;
    let mut restarts = 0;
    for row in &manifest {
        let input = fs::read(fixtures.join(row["file"].as_str().unwrap())).unwrap();
        let mut d = DocumentCore::from_bytes(&input).unwrap();
        assert!(d.document().doc_info.numberings[number(row, "id") - 1]
            .heads
            .iter()
            .all(|head| head.attr & 12 == number(row, "bits") as u32));
        let initial = observe(&d, row, false, false);
        assert_eq!(observe(&d, row, true, false), initial);
        let cold_reverse = DocumentCore::from_bytes(&input).unwrap();
        assert_eq!(observe(&cold_reverse, row, true, false), initial);
        let mut exports = Vec::new();
        for ext in ["hwp", "hwpx", "hwp", "hwpx"] {
            let artifact = if ext == "hwp" {
                d.export_hwp_with_adapter_snapshot_with_report()
            } else {
                d.export_hwpx_native_with_report()
            }
            .unwrap();
            assert!(artifact.content_loss().is_empty());
            let bytes = artifact.into_bytes();
            exports.push(json!({"format":ext,"bytes":bytes.len(),"blake3":blake3::hash(&bytes).to_hex().to_string()}));
            d = DocumentCore::from_bytes(&bytes).unwrap();
            assert_eq!(observe(&d, row, true, false), initial);
            reopens += 1;
        }
        // This runtime-only test deliberately makes no cell-NewStart wire claim:
        // the existing export lowering supports body lists only.
        let mut model = d.document().clone();
        let Control::Table(table) =
            &mut model.sections[0].paragraphs[number(row, "parent")].controls[number(row, "ci")]
        else {
            panic!("table")
        };
        table.cells[0].paragraphs[1].numbering_restart = Some(NumberingRestart::NewStart(12345));
        let mut cold_restart = DocumentCore::new_empty();
        cold_restart.set_document(model.clone());
        d.set_document(model);
        let restarted = observe(&d, row, false, true);
        assert_eq!(observe(&d, row, true, true), restarted);
        assert_eq!(observe(&cold_restart, row, true, true), restarted);
        let snapshot = d.save_snapshot_native();
        d.restore_snapshot_native(snapshot).unwrap();
        assert_eq!(observe(&d, row, true, true), restarted);
        d.discard_snapshot_native(snapshot);
        restarts += 1;
        results.push(json!({"fixture":row,"initial":initial,"nativeExports":exports,"runtimeNewStart":restarted}));
        println!("PASS Native {}", row["file"]);
    }
    fs::write(
        out.join("proof.json"),
        serde_json::to_vec_pretty(&json!({"native":true,
        "fixtures":results.len(),"reopens":reopens,"runtimeNewStartCases":restarts,
        "cellNewStartPersistenceTested":false,"nativeAppUI":false,"results":results}))
        .unwrap(),
    )
    .unwrap();
}

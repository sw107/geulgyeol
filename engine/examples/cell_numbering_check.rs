//! Independently verify actual flat/nested cell numbering UI exports.
#[path = "common/nested_cells.rs"]
pub mod nested_cells;
use nested_cells::{path_json, table};
use rhwp::{
    document_core::DocumentCore,
    model::{control::Control, paragraph::Paragraph},
};
use serde_json::{json, Value};
fn content(paras: &[Paragraph]) -> Value {
    json!(paras.iter().map(|p| json!({
        "text":p.text,"style":p.style_id,"positions":p.logical_control_positions(),
        "chars":p.char_shapes.iter().map(|r|json!([r.start_pos,r.char_shape_id])).collect::<Vec<_>>(),
        "controls":p.controls.iter().map(|c|match c {
            Control::Table(t)=>json!({"kind":"table","rows":t.row_count,"cols":t.col_count,"cells":t.cells.iter().map(|cell|json!({"geometry":[cell.row,cell.col,cell.row_span,cell.col_span,cell.width,cell.height],"padding":format!("{:?}",cell.padding),"border":cell.border_fill_id,"direction":cell.text_direction,"paras":content(&cell.paragraphs)})).collect::<Vec<_>>()}),
            _=>json!(format!("{:?}",std::mem::discriminant(c))),
        }).collect::<Vec<_>>()
    })).collect::<Vec<_>>())
}
fn eq(a: &Value, b: &Value) {
    match (a, b) {
        (Value::Number(a), Value::Number(b)) => assert_eq!(a.as_f64(), b.as_f64()),
        (Value::Array(a), Value::Array(b)) => {
            assert_eq!(a.len(), b.len());
            for (a, b) in a.iter().zip(b) {
                eq(a, b);
            }
        }
        (Value::Object(a), Value::Object(b)) => {
            assert_eq!(a.keys().collect::<Vec<_>>(), b.keys().collect::<Vec<_>>());
            for (k, a) in a {
                eq(a, &b[k]);
            }
        }
        _ => assert_eq!(a, b),
    }
}
fn compact(d: &DocumentCore) -> String {
    let mut result = String::new();
    for i in 0..d.page_count() {
        for chunk in d.render_page_svg_native(i).unwrap().split("<text").skip(1) {
            if let Some((_, s)) = chunk.split_once('>') {
                if let Some((text, _)) = s.split_once("</text>") {
                    result.push_str(text);
                }
            }
        }
    }
    result.chars().filter(|c| !c.is_whitespace()).collect()
}
fn path(base: &[(usize, usize, usize)], cell: usize, p: usize) -> Vec<(usize, usize, usize)> {
    let mut v = base.to_vec();
    let last = v.last_mut().unwrap();
    last.1 = cell;
    last.2 = p;
    v
}
fn main() {
    let args = std::env::args().collect::<Vec<_>>();
    let rows: Vec<Value> = serde_json::from_slice(&std::fs::read(&args[1]).unwrap()).unwrap();
    let mut rejects = 0;
    for row in &rows {
        let old = DocumentCore::from_bytes(&std::fs::read(row["input"].as_str().unwrap()).unwrap())
            .unwrap();
        let mut d =
            DocumentCore::from_bytes(&std::fs::read(row["file"].as_str().unwrap()).unwrap())
                .unwrap();
        let parent = row["parent"].as_u64().unwrap() as usize;
        let base: Vec<_> = row["path"]
            .as_array()
            .unwrap()
            .iter()
            .map(|p| {
                (
                    p["controlIndex"].as_u64().unwrap() as usize,
                    p["cellIndex"].as_u64().unwrap() as usize,
                    p["cellParaIndex"].as_u64().unwrap() as usize,
                )
            })
            .collect();
        let props = |d: &DocumentCore, cell, count| {
            json!((0..count)
                .map(|p| serde_json::from_str::<Value>(
                    &d.get_cell_para_properties_by_path_native(
                        0,
                        parent,
                        &path_json(&path(&base, cell, p))
                    )
                    .unwrap()
                )
                .unwrap())
                .collect::<Vec<_>>())
        };
        eq(&props(&d, 0, 4), &row["expected"]);
        eq(&props(&d, 1, 2), &row["neighbor"]);
        let numbers=json!(d.document().doc_info.numberings.iter().enumerate().map(|(i,n)|json!({"id":i+1,"levelFormats":n.level_formats,"startNumber":n.start_number})).collect::<Vec<_>>());
        eq(&numbers, &row["numberings"]);
        assert_eq!(
            content(&d.document().sections[0].paragraphs),
            content(&old.document().sections[0].paragraphs),
            "text/style/char/control/cell geometry refs: {}",
            row["file"]
        );
        let styles = |d: &DocumentCore| {
            let mut s = d.document().doc_info.styles.clone();
            for s in &mut s {
                s.raw_data = None;
            }
            serde_json::to_value(s).unwrap()
        };
        assert_eq!(styles(&d), styles(&old));
        for p in [0, parent + 1] {
            eq(
                &serde_json::from_str::<Value>(&d.get_para_properties_at_native(0, p).unwrap())
                    .unwrap(),
                &serde_json::from_str::<Value>(&old.get_para_properties_at_native(0, p).unwrap())
                    .unwrap(),
            );
        }
        let text = compact(&d);
        for (p, label) in row["labels"].as_array().unwrap().iter().enumerate() {
            if let Some(label) = label.as_str() {
                assert!(
                    text.contains(&format!("{label}대상{p}끝")),
                    "{}: {text}",
                    row["file"]
                );
            }
        }
        // Batch preflight must reject a wrong cell/intermediate/control reference atomically.
        let before = d.export_hwpx_native().unwrap();
        let mut invalid = base.clone();
        invalid.last_mut().unwrap().1 = table(&d.document().sections[0].paragraphs[parent], &base)
            .cells
            .len();
        let paths = format!(
            "[{},{}]",
            path_json(&path(&base, 0, 0)),
            path_json(&invalid)
        );
        assert!(d
            .apply_para_format_in_cells_by_paths_native(
                0,
                parent,
                &paths,
                r#"{"headType":"Number","numberingId":1,"paraLevel":0}"#
            )
            .is_err());
        assert_eq!(before, d.export_hwpx_native().unwrap());
        rejects += 1;
    }
    std::fs::create_dir_all(&args[2]).unwrap();
    let proof = json!({"verifiedUIExports":rows.len(),"nativeAtomicBadPaths":rejects,"allSavedParaPropertiesAndDefinitions":true,"bodyAndCellContentStyleCharGeometryRefsPreserved":true,"displayLabels":true,"GUIVerified":false});
    std::fs::write(
        format!("{}/proof.json", args[2]),
        serde_json::to_vec_pretty(&proof).unwrap(),
    )
    .unwrap();
    println!("{proof}");
}

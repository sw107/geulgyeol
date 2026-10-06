//! Independently reopen actual UI pending-format exports and check note/control references.
use rhwp::{
    document_core::DocumentCore,
    model::{control::Control, paragraph::Paragraph},
};
use serde_json::{json, Value};
fn note(d: &DocumentCore, ci: usize) -> &[Paragraph] {
    match &d.document().sections[0].paragraphs[0].controls[ci] {
        Control::Footnote(n) => &n.paragraphs,
        Control::Endnote(n) => &n.paragraphs,
        _ => panic!(),
    }
}
fn number(d: &DocumentCore, ci: usize) -> Value {
    match &d.document().sections[0].paragraphs[0].controls[ci] {
        Control::Footnote(n) => json!(["footnote", n.number]),
        Control::Endnote(n) => json!(["endnote", n.number]),
        _ => panic!(),
    }
}
fn properties(d: &DocumentCore, ci: usize) -> Value {
    json!(note(d,ci).iter().enumerate().map(|(pi,p)|json!({"text":p.text,"para":serde_json::from_str::<Value>(&d.get_para_properties_in_footnote_native(0,0,ci,pi).unwrap()).unwrap(),"chars":(0..p.text.chars().count()).map(|i|serde_json::from_str::<Value>(&d.get_char_properties_in_footnote_native(0,0,ci,pi,i).unwrap()).unwrap()).collect::<Vec<_>>()})).collect::<Vec<_>>())
}
fn refs(d: &DocumentCore, ci: usize) -> Value {
    json!(note(d, ci)
        .iter()
        .filter(|p| !p.controls.is_empty())
        .map(|p| json!([p.logical_control_positions(), format!("{:?}", p.controls)]))
        .collect::<Vec<_>>())
}
fn styles(d: &DocumentCore) -> Value {
    let mut s = d.document().doc_info.styles.clone();
    for s in &mut s {
        s.raw_data = None;
    }
    serde_json::to_value(s).unwrap()
}
fn compare(a: &Value, b: &Value, path: &str) {
    match (a, b) {
        (Value::Number(a), Value::Number(b)) => {
            assert_eq!(a.as_f64(), b.as_f64(), "numeric {path}")
        }
        (Value::Object(a), Value::Object(b)) => {
            assert_eq!(
                a.keys().collect::<Vec<_>>(),
                b.keys().collect::<Vec<_>>(),
                "keys {path}"
            );
            for (k, v) in a {
                compare(v, &b[k], &format!("{path}.{k}"));
            }
        }
        (Value::Array(a), Value::Array(b)) => {
            assert_eq!(a.len(), b.len(), "length {path}");
            for (i, (a, b)) in a.iter().zip(b).enumerate() {
                compare(a, b, &format!("{path}[{i}]"));
            }
        }
        _ => assert_eq!(a, b, "{path}"),
    }
}
fn main() {
    let args = std::env::args().collect::<Vec<_>>();
    let rows: Vec<Value> = serde_json::from_slice(&std::fs::read(&args[1]).unwrap()).unwrap();
    for row in &rows {
        let old = DocumentCore::from_bytes(&std::fs::read(row["input"].as_str().unwrap()).unwrap())
            .unwrap();
        let d = DocumentCore::from_bytes(&std::fs::read(row["file"].as_str().unwrap()).unwrap())
            .unwrap();
        let ci = row["control"].as_u64().unwrap() as usize;
        let neighbor = row["neighbor"].as_u64().unwrap() as usize;
        compare(
            &properties(&d, ci),
            &row["expected"],
            row["file"].as_str().unwrap(),
        );
        assert_eq!(properties(&d, neighbor), properties(&old, neighbor));
        for n in [ci, neighbor] {
            assert_eq!(number(&d, n), number(&old, n));
            assert_eq!(refs(&d, n), refs(&old, n));
        }
        assert_eq!(styles(&d), styles(&old));
        let p = &d.document().sections[0].paragraphs[0];
        let b = &old.document().sections[0].paragraphs[0];
        assert_eq!(p.text, b.text);
        assert_eq!(p.style_id, b.style_id);
        assert_eq!(p.para_shape_id, b.para_shape_id);
        assert_eq!(p.logical_control_positions(), b.logical_control_positions());
        assert_eq!(p.controls.len(), b.controls.len());
        for i in 0..b.text.chars().count() {
            assert_eq!(
                d.get_char_properties_at_native(0, 0, i).unwrap(),
                old.get_char_properties_at_native(0, 0, i).unwrap()
            );
        }
        let ids = |d: &DocumentCore, n| note(d, n).iter().map(|p| p.style_id).collect::<Vec<_>>();
        assert_eq!(ids(&d, neighbor), ids(&old, neighbor));
        let mut expected_ids = ids(&old, ci);
        match row["action"].as_str().unwrap() {
            "split-new" => expected_ids.insert(
                2,
                old.document().doc_info.styles[expected_ids[1] as usize].next_style_id,
            ),
            "merge-new" => {
                expected_ids.remove(1);
            }
            _ => {}
        }
        assert_eq!(ids(&d, ci), expected_ids);
    }
    std::fs::create_dir_all(&args[2]).unwrap();
    let proof = json!({"verifiedUIExports":rows.len(),"noteNumbersAndAutoNumberRefsPreserved":true,"bodyAndNeighborAndStylesPreserved":true,"GUIVerified":false});
    std::fs::write(
        format!("{}/proof.json", args[2]),
        serde_json::to_vec_pretty(&proof).unwrap(),
    )
    .unwrap();
    println!("{proof}");
}

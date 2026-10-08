//! Reopen actual body numbering UI exports with the native engine.
use rhwp::{
    document_core::DocumentCore,
    model::{control::Control, paragraph::Paragraph},
};
use serde_json::{json, Value};
fn note_refs(kind: &str, number: u16, paras: &[Paragraph]) -> Value {
    json!({"type":kind,"number":number,"paras":paras.iter().map(|p|json!({"text":p.text,"style":p.style_id,"shape":p.para_shape_id,"positions":p.logical_control_positions(),"chars":p.char_shapes.iter().map(|r| json!([r.start_pos,r.char_shape_id])).collect::<Vec<_>>(),"controls":p.controls.iter().map(|c|format!("{:?}",c)).collect::<Vec<_>>()})).collect::<Vec<_>>()})
}
fn refs(d: &DocumentCore) -> Value {
    json!(d.document().sections[0].paragraphs.iter().map(|p| json!({
        "text": p.text, "style": p.style_id, "positions": p.logical_control_positions(),
        "chars": p.char_shapes.iter().map(|r| json!([r.start_pos, r.char_shape_id])).collect::<Vec<_>>(),
        "controls": p.controls.iter().map(|c| match c {
            Control::Footnote(n) => note_refs("footnote",n.number,&n.paragraphs),
            Control::Endnote(n) => note_refs("endnote",n.number,&n.paragraphs),
            _ => json!(format!("{:?}",std::mem::discriminant(c))),
        }).collect::<Vec<_>>()
    })).collect::<Vec<_>>())
}
fn numeric_equal(a: &Value, b: &Value) {
    match (a, b) {
        (Value::Number(a), Value::Number(b)) => assert_eq!(a.as_f64(), b.as_f64()),
        (Value::Array(a), Value::Array(b)) => {
            assert_eq!(a.len(), b.len());
            for (a, b) in a.iter().zip(b) {
                numeric_equal(a, b);
            }
        }
        (Value::Object(a), Value::Object(b)) => {
            assert_eq!(a.keys().collect::<Vec<_>>(), b.keys().collect::<Vec<_>>());
            for (k, a) in a {
                numeric_equal(a, &b[k]);
            }
        }
        _ => assert_eq!(a, b),
    }
}
fn text_nodes(svg: &str) -> String {
    let mut text = String::new();
    for chunk in svg.split("<text").skip(1) {
        if let Some((_, rest)) = chunk.split_once('>') {
            if let Some((content, _)) = rest.split_once("</text>") {
                text.push_str(content);
            }
        }
    }
    text.chars().filter(|c| !c.is_whitespace()).collect()
}
fn main() {
    let args = std::env::args().collect::<Vec<_>>();
    let rows: Vec<Value> = serde_json::from_slice(&std::fs::read(&args[1]).unwrap()).unwrap();
    for row in &rows {
        let old = DocumentCore::from_bytes(&std::fs::read(row["input"].as_str().unwrap()).unwrap())
            .unwrap();
        let d = DocumentCore::from_bytes(&std::fs::read(row["file"].as_str().unwrap()).unwrap())
            .unwrap();
        let props = json!(d.document().sections[0]
            .paragraphs
            .iter()
            .enumerate()
            .map(|(p, _)| serde_json::from_str::<Value>(
                &d.get_para_properties_at_native(0, p).unwrap()
            )
            .unwrap())
            .collect::<Vec<_>>());
        numeric_equal(&props, &row["expected"]);
        let numberings = json!(d.document().doc_info.numberings.iter().enumerate().map(|(i,n)|json!({"id":i+1,"levelFormats":n.level_formats,"startNumber":n.start_number})).collect::<Vec<_>>());
        numeric_equal(&numberings, &row["numberings"]);
        if let Some(id) = row["newId"].as_u64() {
            let mut expected = [1; 7];
            expected[row["startLevel"].as_u64().unwrap() as usize] =
                row["newStart"].as_u64().unwrap() as u32;
            assert_eq!(
                d.document().doc_info.numberings[id as usize - 1].level_start_numbers,
                expected
            );
        }
        for (p, oldp) in old.document().sections[0].paragraphs.iter().enumerate() {
            for offset in 0..oldp.text.chars().count() {
                assert_eq!(
                    d.get_char_properties_at_native(0, p, offset).unwrap(),
                    old.get_char_properties_at_native(0, p, offset).unwrap()
                );
            }
        }
        assert_eq!(refs(&d), refs(&old));
        let normalized_styles = |d: &DocumentCore| {
            let mut s = d.document().doc_info.styles.clone();
            for s in &mut s {
                s.raw_data = None;
            }
            serde_json::to_value(s).unwrap()
        };
        assert_eq!(normalized_styles(&d), normalized_styles(&old));
        let text = text_nodes(&d.render_page_svg_native(0).unwrap());
        for (p, label) in row["labels"].as_array().unwrap().iter().enumerate() {
            if let Some(label) = label.as_str() {
                assert!(
                    text.contains(&format!("{label}항목{p}끝")),
                    "{} {p}: {text}",
                    row["file"]
                );
            }
        }
    }
    std::fs::create_dir_all(&args[2]).unwrap();
    let proof = json!({"verifiedUIExports":rows.len(),"allSavedParagraphProperties":true,"displayLabels":true,"textCharStyleAndNoteReferencesPreserved":true,"GUIVerified":false});
    std::fs::write(
        format!("{}/proof.json", args[2]),
        serde_json::to_vec_pretty(&proof).unwrap(),
    )
    .unwrap();
    println!("{proof}");
}

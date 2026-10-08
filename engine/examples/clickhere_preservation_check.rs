//! Field edit scalar/UTF-16/token axes, mixed formats and note references.
use rhwp::{document_core::DocumentCore, model::control::Control};
use serde_json::{json, Value};
use std::path::Path;
fn semantic(d: &DocumentCore) -> Value {
    let p = &d.document().sections[0].paragraphs[0];
    let positions = p.control_text_positions();
    json!({"text":p.text,"style":p.style_id,"para":p.para_shape_id,
        "chars":(0..p.text.chars().count()).map(|i| p.char_shape_id_at(i)).collect::<Vec<_>>(),
        "notes":p.controls.iter().enumerate().filter_map(|(i,c)| match c {
            Control::Footnote(n)=>Some(json!({"at":positions[i],"number":n.number,"paragraphs":n.paragraphs.iter().map(|p|json!({"text":p.text,"style":p.style_id,"para":p.para_shape_id,"chars":(0..p.text.chars().count()).map(|i|p.char_shape_id_at(i)).collect::<Vec<_>>() })).collect::<Vec<_>>() })), _=>None }).collect::<Vec<_>>()})
}
fn axis(d: &DocumentCore) -> Value {
    let p = &d.document().sections[0].paragraphs[0];
    json!({"text":p.text,"offsets":p.char_offsets,"count":p.char_count,"shapeRefs":p.char_shapes,"controlPositions":p.control_text_positions(),"fieldRanges":p.field_ranges,"fields":serde_json::from_str::<Value>(&d.get_field_list_json()).unwrap()})
}
fn reopen(d: &DocumentCore, out: &Path, name: &str) {
    let expected = semantic(d);
    for (ext, b) in [
        ("hwp", d.export_hwp_native().unwrap()),
        ("hwpx", d.export_hwpx_native().unwrap()),
    ] {
        std::fs::write(out.join(format!("{name}.{ext}")), &b).unwrap();
        let reopened = DocumentCore::from_bytes(&b).unwrap();
        assert_eq!(semantic(&reopened), expected, "{name} {ext}");
    }
}
fn main() {
    let out = std::env::args().nth(1).unwrap();
    let out = Path::new(&out);
    std::fs::create_dir_all(out).unwrap();
    let mut evidence = Vec::new();
    for (case, start) in [0, 1, 2, 3, 6].into_iter().enumerate() {
        let mut d = DocumentCore::new_empty();
        d.create_blank_document_native().unwrap();
        d.insert_text_native(0, 0, 0, "앞🙂뒤가나끝").unwrap();
        d.apply_char_format_native(0, 0, 2, 3, "{\"italic\":true}")
            .unwrap();
        d.apply_char_format_native(0, 0, 3, 4, "{\"bold\":true}")
            .unwrap();
        d.insert_footnote_native(0, 0, 2).unwrap();
        let before = semantic(&d);
        let before_axis = axis(&d);
        let snap = d.save_snapshot_native();
        let field: Value = serde_json::from_str(
            &d.insert_click_here_field_at(0, 0, start, "안내🙂", "memo", "field", true)
                .unwrap(),
        )
        .unwrap();
        let id = field["fieldId"].as_u64().unwrap() as u32;
        assert_eq!(semantic(&d), before, "case {case} insert");
        let after_axis = axis(&d);
        let after = d.save_snapshot_native();
        reopen(&d, out, &format!("insert-{case}"));
        d.restore_snapshot_native(snap).unwrap();
        assert_eq!(semantic(&d), before);
        d.restore_snapshot_native(after).unwrap();
        assert_eq!(axis(&d), after_axis);
        d.set_field_value_by_id(id, "값🙂").unwrap();
        let value_axis = axis(&d);
        let fields: Value = serde_json::from_str(&d.get_field_list_json()).unwrap();
        assert_eq!(
            fields[0]["endPos"].as_u64().unwrap() - fields[0]["startPos"].as_u64().unwrap(),
            3,
            "UTF-16 value span"
        );
        reopen(&d, out, &format!("value-{case}"));
        d.set_active_field(0, 0, start);
        d.insert_text_native(0, 0, start, "中𐐀").unwrap();
        reopen(&d, out, &format!("typed-{case}"));
        d.remove_field_at(0, 0, start).unwrap();
        assert_eq!(semantic(&d), before, "case {case} remove");
        reopen(&d, out, &format!("remove-{case}"));
        evidence.push(json!({"case":case,"start":start,"before":before_axis,"insert":after_axis,"value":value_axis}));
    }
    // Actual text-command redo repeats local insertion after deletion; snapshots alone
    // cannot detect a raw char-shape boundary drifting into the field's prefix.
    let mut d = DocumentCore::new_empty();
    d.create_blank_document_native().unwrap();
    d.insert_text_native(0, 0, 0, "앞뒤").unwrap();
    d.apply_char_format_native(0, 0, 0, 1, "{\"italic\":true}")
        .unwrap();
    d.insert_click_here_field_at(0, 0, 1, "입력🙂", "m", "n", true)
        .unwrap();
    let prefix = d.document().sections[0].paragraphs[0].char_shape_id_at(0);
    d.set_active_field(0, 0, 1);
    d.replace_body_text_local_native(0, 0, 1, 0, "🙂").unwrap();
    d.apply_char_format_native(0, 0, 1, 2, "{\"bold\":true}")
        .unwrap();
    d.delete_text_native(0, 0, 1, 1).unwrap();
    d.set_active_field(0, 0, 1);
    d.replace_body_text_local_native(0, 0, 1, 0, "🙂").unwrap();
    d.apply_char_format_native(0, 0, 1, 2, "{\"bold\":true}")
        .unwrap();
    d.set_active_field(0, 0, 2);
    d.replace_body_text_local_native(0, 0, 2, 0, "다").unwrap();
    d.apply_char_format_native(0, 0, 2, 3, "{\"bold\":true}")
        .unwrap();
    for repeat in 0..4 {
        d.delete_text_native(0, 0, 1, 2).unwrap();
        d.set_active_field(0, 0, 1);
        d.replace_body_text_local_native(0, 0, 1, 0, "🙂다")
            .unwrap();
        d.apply_char_format_native(0, 0, 1, 3, "{\"bold\":true}")
            .unwrap();
        assert_eq!(
            d.document().sections[0].paragraphs[0].char_shape_id_at(0),
            prefix,
            "redo prefix {repeat}"
        );
        reopen(&d, out, &format!("redo-{repeat}"));
    }
    let mut d = DocumentCore::new_empty();
    d.create_blank_document_native().unwrap();
    d.insert_text_native(0, 0, 0, "앞🙂뒤가나끝").unwrap();
    d.apply_char_format_native(0, 0, 2, 3, "{\"italic\":true}")
        .unwrap();
    for at in [1, 5] {
        let r: Value = serde_json::from_str(&d.insert_footnote_native(0, 0, at).unwrap()).unwrap();
        d.insert_text_in_footnote_native(
            0,
            0,
            r["controlIdx"].as_u64().unwrap() as usize,
            0,
            2,
            "각주🙂본문",
        )
        .unwrap();
    }
    let baseline = semantic(&d);
    let mut ids = Vec::new();
    for (i, at) in [1, 4, 6].into_iter().enumerate() {
        let r: Value = serde_json::from_str(
            &d.insert_click_here_field_at(0, 0, at, "안내🙂", "memo", &format!("field{i}"), true)
                .unwrap(),
        )
        .unwrap();
        ids.push(r["fieldId"].as_u64().unwrap() as u32);
        assert_eq!(semantic(&d), baseline, "multiple insert {i}");
        reopen(&d, out, &format!("multi-insert-{i}"));
    }
    for (i, &id) in ids.iter().enumerate() {
        d.set_field_value_by_id(id, "값🙂").unwrap();
        reopen(&d, out, &format!("multi-value-{i}"));
    }
    for (i, &id) in ids.iter().enumerate() {
        let fields: Value = serde_json::from_str(&d.get_field_list_json()).unwrap();
        let f = fields
            .as_array()
            .unwrap()
            .iter()
            .find(|f| f["fieldId"].as_u64() == Some(id as u64))
            .unwrap();
        d.remove_field_at(0, 0, f["startCharIdx"].as_u64().unwrap() as usize)
            .unwrap();
        reopen(&d, out, &format!("multi-remove-{i}"));
    }
    assert_eq!(
        semantic(&d),
        baseline,
        "multiple removal restores all note anchors and styles"
    );
    // An incomplete token axis must reject insertion without even invalidating raw bytes.
    d.document_mut().sections[0].raw_stream = Some(vec![1, 2, 3]);
    d.document_mut().sections[0].paragraphs[0].char_offsets[0] += 1;
    let unchanged = format!("{:?}", d.document());
    assert!(d
        .insert_click_here_field_at(0, 0, 1, "g", "m", "n", true)
        .is_err());
    assert_eq!(format!("{:?}", d.document()), unchanged);
    let mut bad = DocumentCore::new_empty();
    bad.create_blank_document_native().unwrap();
    bad.insert_text_native(0, 0, 0, "보존🙂").unwrap();
    let p = &mut bad.document_mut().sections[0].paragraphs[0];
    p.controls
        .push(Control::Unknown(rhwp::model::control::UnknownControl {
            ctrl_id: 1234,
        }));
    for off in &mut p.char_offsets {
        *off += 8;
    }
    p.char_count += 8;
    bad.document_mut().sections[0].raw_stream = Some(vec![4, 5, 6]);
    let unchanged = format!("{:?}", bad.document());
    assert!(bad
        .insert_click_here_field_at(0, 0, 1, "g", "m", "n", true)
        .is_err());
    assert_eq!(
        format!("{:?}", bad.document()),
        unchanged,
        "unknown ownership atomic rejection"
    );
    std::fs::write(out.join("proof.json"),serde_json::to_vec_pretty(&json!({"cases":evidence,"reopens":66,"atomicRejections":2,"repeatedCommandRedos":4,"multiFieldCases":9})).unwrap()).unwrap();
    println!("passed {} Native cases", evidence.len());
}

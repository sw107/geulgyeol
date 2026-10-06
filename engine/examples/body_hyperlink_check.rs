//! Main-body hyperlink range, formatting, atomic refusal, snapshot and serialization checks.
use rhwp::{
    document_core::DocumentCore,
    model::control::{Control, Parameter},
};
use serde_json::{json, Value};
use std::path::Path;
fn state(d: &DocumentCore) -> String {
    format!("{:?}", d.document())
}
fn view(d: &DocumentCore) -> Value {
    json!({"paragraphs":d.document().sections.iter().map(|s|s.paragraphs.iter().map(|p|json!({
        "text":p.text,"style":p.style_id,"para":p.para_shape_id,
        "chars":(0..p.text.chars().count()).map(|i|p.char_shape_id_at(i)).collect::<Vec<_>>(),
        "positions":p.control_text_positions(),"ranges":p.field_ranges,
        "fields":p.controls.iter().filter_map(|c|match c { Control::Field(f)=>Some(json!({"id":f.field_id,"type":format!("{:?}",f.field_type),"url":f.command})),_=>None}).collect::<Vec<_>>(),
        "notes":p.controls.iter().filter_map(|c|match c {Control::Footnote(n)=>Some(json!({"number":n.number,"paragraphs":n.paragraphs.iter().map(|p|json!({"text":p.text,"style":p.style_id,"para":p.para_shape_id,"chars":(0..p.text.chars().count()).map(|i|p.char_shape_id_at(i)).collect::<Vec<_>>(),"controls":p.controls})).collect::<Vec<_>>()})),_=>None}).collect::<Vec<_>>()
    })).collect::<Vec<_>>()).collect::<Vec<_>>()})
}
fn fixture() -> DocumentCore {
    let mut d = DocumentCore::new_empty();
    d.create_blank_document_native().unwrap();
    d.insert_text_native(0, 0, 0, "앞🙂한글𐐀링크뒤참조끝")
        .unwrap();
    d.apply_char_format_native(0, 0, 0, 1, "{\"italic\":true}")
        .unwrap();
    d.apply_char_format_native(0, 0, 2, 5, "{\"bold\":true}")
        .unwrap();
    d.apply_char_format_native(0, 0, 5, 8, "{\"underline\":true}")
        .unwrap();
    for at in [1, 10] {
        let v: Value = serde_json::from_str(&d.insert_footnote_native(0, 0, at).unwrap()).unwrap();
        d.insert_text_in_footnote_native(
            0,
            0,
            v["controlIdx"].as_u64().unwrap() as usize,
            0,
            2,
            "각주🙂참조",
        )
        .unwrap();
    }
    d.apply_para_format_native(0, 0, "{\"alignment\":\"center\",\"marginLeft\":730}")
        .unwrap();
    d.insert_paragraph_native(0, 1).unwrap();
    d.insert_text_native(0, 1, 0, "다른스타일🙂보존").unwrap();
    d.apply_style_native(0, 1, 1).unwrap();
    d.apply_para_format_native(0, 1, "{\"alignment\":\"right\",\"marginLeft\":450}")
        .unwrap();
    d.apply_char_format_native(0, 1, 0, 3, "{\"italic\":true}")
        .unwrap();
    d
}
fn reopens(d: &DocumentCore, out: &Path, label: &str) {
    for (ext, b) in [
        ("hwp", d.export_hwp_native().unwrap()),
        ("hwpx", d.export_hwpx_native().unwrap()),
    ] {
        std::fs::write(out.join(format!("{label}.{ext}")), &b).unwrap();
        let r = DocumentCore::from_bytes(&b).unwrap();
        assert_eq!(view(&r), view(d), "{label} {ext}");
    }
}
fn verify_ui(seed: &Path, out: &Path) {
    let input = DocumentCore::from_bytes(&std::fs::read(seed).unwrap()).unwrap();
    let base = input.export_hwpx_native().unwrap();
    let mut d = DocumentCore::from_bytes(&base).unwrap();
    let definitions = format!("{:?}", d.document().doc_info);
    let mut count = 0;
    let check = |d: &DocumentCore, label: &str, count: &mut usize| {
        for ext in ["hwp", "hwpx"] {
            let file = out.join(format!("{label}.{ext}"));
            let r = DocumentCore::from_bytes(&std::fs::read(&file).unwrap()).unwrap();
            assert_eq!(
                view(&r),
                view(d),
                "{}: original char/para/style refs, fields/ranges and notes",
                file.display()
            );
            *count += 1;
        }
    };
    check(&d, "seed", &mut count);
    let v: Value = serde_json::from_str(
        &d.insert_body_hyperlink(0, 0, 2, 7, "https://example.com/한글?q=🙂&x=1#끝", "")
            .unwrap(),
    )
    .unwrap();
    let id = v["fieldId"].as_u64().unwrap() as u32;
    check(&d, "selected", &mut count);
    d.update_body_hyperlink(0, 0, id, "http://example.org:8080/수정🙂")
        .unwrap();
    check(&d, "url-edit", &mut count);
    d.insert_body_hyperlink(0, 0, 7, 9, "https://second.example/", "")
        .unwrap();
    check(&d, "adjacent", &mut count);
    d.remove_body_hyperlink(0, 0, id).unwrap();
    check(&d, "unlink", &mut count);
    d.insert_body_hyperlink(0, 0, 9, 9, "https://new.example/🙂", "삽입🙂한글")
        .unwrap();
    check(&d, "caret", &mut count);
    assert_eq!(
        format!("{:?}", d.document().doc_info),
        definitions,
        "main edits leave original definitions intact"
    );
    for ext in ["Hwp", "Hwpx"] {
        let b = if ext == "Hwp" {
            d.export_hwp_native().unwrap()
        } else {
            d.export_hwpx_native().unwrap()
        };
        let mut r = DocumentCore::from_bytes(&b).unwrap();
        let imported_definitions = format!("{:?}", r.document().doc_info);
        let id = r.collect_all_fields()[0].field.field_id;
        r.update_body_hyperlink(0, 0, id, "https://reopened.example/바꿈🙂")
            .unwrap();
        check(&r, &format!("reopened-{ext}"), &mut count);
        r.remove_body_hyperlink(0, 0, id).unwrap();
        check(&r, &format!("reopened-unlink-{ext}"), &mut count);
        assert_eq!(
            format!("{:?}", r.document().doc_info),
            imported_definitions,
            "edits keep imported format's definitions/cache intact"
        );
    }
    let mut d = DocumentCore::from_bytes(&base).unwrap();
    let v: Value = serde_json::from_str(
        &d.insert_click_here_field_at(0, 0, 0, "안내🙂", "메모", "이웃", true)
            .unwrap(),
    )
    .unwrap();
    d.set_field_value_by_id(v["fieldId"].as_u64().unwrap() as u32, "값")
        .unwrap();
    d.insert_body_hyperlink(0, 0, 3, 8, "https://neighbor.example/", "")
        .unwrap();
    check(&d, "neighbor-field", &mut count);
    assert_eq!(
        format!("{:?}", d.document().doc_info),
        definitions,
        "neighbor edits leave definitions intact"
    );
    let proof = json!({"uiSavedFilesVerified":count,"fullCharParaStyleReferences":true,"pairedFieldRanges":true,"footnoteTree":true,"originalDefinitionsUnchanged":true});
    std::fs::write(
        out.parent().unwrap().join("native-ui-reopen-proof.json"),
        serde_json::to_vec_pretty(&proof).unwrap(),
    )
    .unwrap();
    println!("{proof}");
}
fn main() {
    let args: Vec<_> = std::env::args().skip(1).collect();
    if args[0] == "--verify-ui" {
        verify_ui(Path::new(&args[1]), Path::new(&args[2]));
        return;
    }
    let out = Path::new(&args[0]);
    std::fs::create_dir_all(out).unwrap();
    let mut d = fixture();
    reopens(&d, out, "seed");
    let definitions = format!("{:?}", d.document().doc_info);
    let before = view(&d);
    let neighbor = before["paragraphs"][0][1].clone();
    let snap = d.save_snapshot_native();
    let r: Value = serde_json::from_str(
        &d.insert_body_hyperlink(0, 0, 2, 7, "https://example.com/한글?q=🙂&x=1#끝", "")
            .unwrap(),
    )
    .unwrap();
    let id = r["fieldId"].as_u64().unwrap() as u32;
    for key in ["text", "style", "para", "chars", "notes"] {
        assert_eq!(
            view(&d)["paragraphs"][0][0][key],
            before["paragraphs"][0][0][key],
            "wrap {key}"
        );
    }
    let after = view(&d);
    let redo = d.save_snapshot_native();
    d.restore_snapshot_native(snap).unwrap();
    assert_eq!(view(&d), before);
    d.restore_snapshot_native(redo).unwrap();
    assert_eq!(view(&d), after);
    reopens(&d, out, "selected");
    let before = view(&d);
    d.update_body_hyperlink(0, 0, id, "http://example.org:8080/새🙂")
        .unwrap();
    for key in [
        "text",
        "style",
        "para",
        "chars",
        "notes",
        "positions",
        "ranges",
    ] {
        assert_eq!(
            view(&d)["paragraphs"][0][0][key],
            before["paragraphs"][0][0][key],
            "edit {key}"
        );
    }
    reopens(&d, out, "edited");
    let r: Value = serde_json::from_str(
        &d.insert_body_hyperlink(0, 0, 7, 9, "https://second.example/path", "")
            .unwrap(),
    )
    .unwrap();
    let id2 = r["fieldId"].as_u64().unwrap() as u32;
    reopens(&d, out, "adjacent");
    let before = view(&d);
    d.remove_body_hyperlink(0, 0, id).unwrap();
    for key in ["text", "style", "para", "chars", "notes"] {
        assert_eq!(
            view(&d)["paragraphs"][0][0][key],
            before["paragraphs"][0][0][key],
            "unlink {key}"
        );
    }
    assert_eq!(
        serde_json::from_str::<Value>(&d.get_body_hyperlink_at(0, 0, 8).unwrap()).unwrap()
            ["fieldId"],
        id2
    );
    reopens(&d, out, "unlinked");
    assert_eq!(
        serde_json::from_str::<Value>(&d.get_body_hyperlink_at(0, 0, 9).unwrap()).unwrap()["found"],
        false,
        "link end is outside"
    );
    let before = view(&d);
    d.insert_body_hyperlink(0, 0, 9, 9, "https://new.example/🙂", "삽입🙂한글")
        .unwrap();
    assert_eq!(
        d.document().sections[0].paragraphs[0].text,
        "앞🙂한글𐐀링크뒤참삽입🙂한글조끝"
    );
    let oldchars = before["paragraphs"][0][0]["chars"].as_array().unwrap();
    let after = view(&d);
    let newchars = after["paragraphs"][0][0]["chars"].as_array().unwrap();
    assert_eq!(&newchars[..9], &oldchars[..9]);
    assert_eq!(&newchars[14..], &oldchars[9..]);
    assert_eq!(
        after["paragraphs"][0][0]["notes"],
        before["paragraphs"][0][0]["notes"]
    );
    reopens(&d, out, "caret");
    assert_eq!(
        view(&d)["paragraphs"][0][1],
        neighbor,
        "other style paragraph stays untouched"
    );
    assert_eq!(
        format!("{:?}", d.document().doc_info),
        definitions,
        "format definitions unchanged"
    );
    let mut rows = Vec::new();
    for kind in [
        "bad-section",
        "bad-para",
        "reversed",
        "outside",
        "inside-note",
        "overlap",
        "empty-display",
        "bad-axis",
        "wrong-id",
        "extra-params",
        "ctrl-data",
    ] {
        let mut d = fixture();
        let mut id = 0;
        if matches!(kind, "overlap" | "wrong-id" | "extra-params" | "ctrl-data") {
            let v: Value = serde_json::from_str(
                &d.insert_body_hyperlink(0, 0, 2, 7, "https://example.com", "")
                    .unwrap(),
            )
            .unwrap();
            id = v["fieldId"].as_u64().unwrap() as u32;
        }
        if kind == "bad-axis" {
            d.document_mut().sections[0].paragraphs[0].char_offsets[0] += 1;
        }
        if kind == "extra-params" {
            let p = &mut d.document_mut().sections[0].paragraphs[0];
            let ci = p.field_ranges[0].control_idx;
            if let Control::Field(f) = &mut p.controls[ci] {
                f.parameters.items.push(Parameter::String {
                    name: Some("Reference".into()),
                    value: "keep".into(),
                    preserve_space: false,
                });
            }
        }
        if kind == "ctrl-data" {
            let p = &mut d.document_mut().sections[0].paragraphs[0];
            let ci = p.field_ranges[0].control_idx;
            p.ctrl_data_records.resize(p.controls.len(), None);
            p.ctrl_data_records[ci] = Some(vec![1, 2, 3]);
        }
        d.document_mut().sections[0].raw_stream = Some(vec![67, 80, 66, 75]);
        let before = state(&d);
        let events = d.serialize_event_log();
        let result = match kind {
            "bad-section" => d.insert_body_hyperlink(99, 0, 2, 7, "https://example.com", ""),
            "bad-para" => d.insert_body_hyperlink(0, 99, 2, 7, "https://example.com", ""),
            "reversed" => d.insert_body_hyperlink(0, 0, 7, 2, "https://example.com", ""),
            "outside" => d.insert_body_hyperlink(0, 0, 2, 99, "https://example.com", ""),
            "inside-note" => d.insert_body_hyperlink(0, 0, 0, 3, "https://example.com", ""),
            "overlap" => d.insert_body_hyperlink(0, 0, 3, 8, "https://example.com", ""),
            "empty-display" => d.insert_body_hyperlink(0, 0, 3, 3, "https://example.com", ""),
            "wrong-id" => d.remove_body_hyperlink(0, 0, id + 1),
            "extra-params" | "ctrl-data" => d.remove_body_hyperlink(0, 0, id),
            _ => d.insert_body_hyperlink(0, 0, 2, 7, "https://example.com", ""),
        };
        assert!(result.is_err(), "{kind}");
        assert_eq!(state(&d), before, "{kind} atomic document/raw");
        assert_eq!(events, d.serialize_event_log(), "{kind} events");
        rows.push(json!({"kind":kind,"error":result.unwrap_err().to_string()}));
    }
    for url in [
        "javascript:alert(1)",
        "data:text/html,x",
        "file:///tmp/x",
        "example.com",
        "https://",
        "https://u:p@example.com",
        "https://example.com/a b",
        "https://example.com:99999",
        "https://-bad.com",
        "https://[bad]/",
    ] {
        let mut d = fixture();
        let before = state(&d);
        let events = d.serialize_event_log();
        assert!(
            d.insert_body_hyperlink(0, 0, 2, 7, url, "").is_err(),
            "{url}"
        );
        assert_eq!(before, state(&d));
        assert_eq!(events, d.serialize_event_log());
        rows.push(json!({"url":url,"unchanged":true}));
    }
    std::fs::write(
        out.join("proof.json"),
        serde_json::to_vec_pretty(
            &json!({"positive":5,"reopens":12,"snapshotUndoRedo":2,"refusals":rows}),
        )
        .unwrap(),
    )
    .unwrap();
    println!(
        "{}",
        json!({"positive":5,"reopens":12,"refusals":rows.len()})
    );
}

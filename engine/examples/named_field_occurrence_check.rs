//! Explicit same-name field occurrences: native owner selection and two-format IO.
use rhwp::{
    document_core::DocumentCore,
    model::{control::Control, paragraph::Paragraph},
};
use serde_json::{json, Value};
use std::path::Path;

fn value(s: &str) -> Value {
    serde_json::from_str(s).unwrap()
}
fn fields(d: &DocumentCore) -> Vec<Value> {
    value(&d.get_field_list_json())
        .as_array()
        .unwrap()
        .iter()
        .filter(|f| f["name"] == "중복")
        .cloned()
        .collect()
}
fn values(d: &DocumentCore) -> Vec<String> {
    fields(d)
        .iter()
        .map(|f| f["value"].as_str().unwrap().to_owned())
        .collect()
}
fn state(d: &DocumentCore) -> Value {
    json!({"model":format!("{:?}",d.document()),"hwp":d.export_hwp_native().unwrap(),"hwpx":d.export_hwpx_native().unwrap(),"svg":(0..d.page_count()).map(|p|d.render_page_svg_native(p).unwrap()).collect::<Vec<_>>()})
}

fn fixture(kind: &str) -> DocumentCore {
    let mut d = DocumentCore::new_empty();
    d.create_blank_document_native().unwrap();
    d.insert_text_native(0, 0, 0, "본문 보존😀 ").unwrap();
    d.apply_char_format_native(0, 0, 0, 2, r#"{"bold":true}"#)
        .unwrap();
    if kind != "cells" {
        for text in ["본문 첫째", "본문 둘째🙂", "본문 셋째"] {
            let at = d.document().sections[0].paragraphs[0].text.chars().count();
            let r = value(
                &d.insert_click_here_field_at(0, 0, at, "안내", "", "중복", true)
                    .unwrap(),
            );
            d.set_field_value_by_id(r["fieldId"].as_u64().unwrap() as u32, text)
                .unwrap();
            let end = d.document().sections[0].paragraphs[0].text.chars().count();
            d.insert_text_native(0, 0, end, " | ").unwrap();
        }
    }
    if kind != "body" {
        let r = value(&d.create_table_native(0, 0, 0, 1, 3).unwrap());
        let p = r["paraIdx"].as_u64().unwrap() as usize;
        let c = r["controlIdx"].as_u64().unwrap() as usize;
        for (i, text) in ["셀 첫째", "셀 둘째🙂", "셀 셋째"].iter().enumerate() {
            d.insert_text_in_cell_native(0, p, c, i, 0, 0, text)
                .unwrap();
        }
        let Control::Table(t) = &mut d.document_mut().sections[0].paragraphs[p].controls[c] else {
            panic!()
        };
        for cell in &mut t.cells {
            cell.field_name = Some("중복".into());
        }
    }
    let mut guard = Paragraph::new_empty_like(&d.document().sections[0].paragraphs[0]);
    guard.insert_text_at(0, "별도 문단 보존🧪");
    d.document_mut().sections[0].paragraphs.push(guard);
    let document = d.document().clone();
    d.set_document(document);
    d
}

fn main() {
    let arg = std::env::args().nth(1).expect("FRESH_OUTPUT");
    let out = Path::new(&arg);
    std::fs::create_dir(out).unwrap();
    let mut rows = Vec::new();
    let mut fixture_rows = Vec::new();
    let mut reopens = 0;
    let mut refusals = 0;
    for kind in ["body", "cells", "mixed"] {
        let seed = fixture(kind);
        for format in ["hwp", "hwpx"] {
            let bytes = if format == "hwp" {
                seed.export_hwp_native().unwrap()
            } else {
                seed.export_hwpx_native().unwrap()
            };
            let input = out.join(format!("fixture-{kind}.{format}"));
            std::fs::write(&input, &bytes).unwrap();
            let original = DocumentCore::from_bytes(&bytes).unwrap();
            let source = values(&original);
            assert!(source.len() >= 3);
            fixture_rows.push(json!({"kind":kind,"format":format,"path":input,"values":source}));
            for index in [0, source.len() / 2, source.len() - 1] {
                for text in ["순번 새값😀", "", "긴 값 보존 한글"] {
                    let mut d = DocumentCore::from_bytes(&bytes).unwrap();
                    let before = state(&d);
                    let field_id = fields(&d)[index]["fieldId"].clone();
                    for (i, expected) in source.iter().enumerate() {
                        let got = value(&d.get_field_value_by_name_at("중복", i).unwrap());
                        assert_eq!(got["value"], *expected);
                        assert_eq!(got["fieldId"], fields(&d)[i]["fieldId"]);
                    }
                    assert_eq!(state(&d), before, "getters are read-only");
                    let undo = d.save_snapshot_native();
                    let r = value(&d.set_field_value_by_name_at("중복", index, text).unwrap());
                    assert_eq!(r["fieldId"], field_id);
                    assert_eq!(r["oldValue"], source[index]);
                    let mut expected = source.clone();
                    expected[index] = text.to_owned();
                    assert_eq!(values(&d), expected);
                    assert_eq!(
                        d.document().sections[0].paragraphs.last().unwrap().text,
                        "별도 문단 보존🧪"
                    );
                    for ext in ["hwp", "hwpx"] {
                        let data = if ext == "hwp" {
                            d.export_hwp_native().unwrap()
                        } else {
                            d.export_hwpx_native().unwrap()
                        };
                        let file = out.join(format!("edit-{}.{ext}", rows.len()));
                        std::fs::write(&file, &data).unwrap();
                        let mut reopened = DocumentCore::from_bytes(&data).unwrap();
                        assert_eq!(values(&reopened), expected);
                        reopened
                            .set_field_value_by_name_at("중복", index, "재편집😀")
                            .unwrap();
                        let mut again = expected.clone();
                        again[index] = "재편집😀".into();
                        assert_eq!(values(&reopened), again);
                        reopens += 1;
                    }
                    let after = state(&d);
                    let redo = d.save_snapshot_native();
                    d.restore_snapshot_native(undo).unwrap();
                    assert_eq!(state(&d), before);
                    d.restore_snapshot_native(redo).unwrap();
                    assert_eq!(state(&d), after);
                    d.discard_snapshot_native(undo);
                    d.discard_snapshot_native(redo);
                    rows.push(
                        json!({"kind":kind,"inputFormat":format,"index":index,"replacement":text}),
                    );
                }
            }
            let mut d = DocumentCore::from_bytes(&bytes).unwrap();
            let before = state(&d);
            for (name, index) in [
                ("중복", source.len()),
                ("중복", usize::MAX),
                ("없는 이름", 0),
            ] {
                assert!(d.get_field_value_by_name_at(name, index).is_err());
                assert_eq!(state(&d), before);
                assert!(d.set_field_value_by_name_at(name, index, "거절").is_err());
                assert_eq!(state(&d), before);
                refusals += 2;
            }
            let legacy = value(&d.get_field_value_by_name("중복").unwrap());
            assert_eq!(legacy["value"], source[0]);
            d.set_field_value_by_name("중복", "기존 첫 일치").unwrap();
            let mut expected = source.clone();
            expected[0] = "기존 첫 일치".into();
            assert_eq!(values(&d), expected);
        }
    }
    let proof = json!({"cases":rows.len(),"refusals":refusals,"reopens":reopens,"snapshotRestores":rows.len()*2,"fixtures":fixture_rows,"rows":rows});
    std::fs::write(
        out.join("proof.json"),
        serde_json::to_vec_pretty(&proof).unwrap(),
    )
    .unwrap();
    println!(
        "{}",
        json!({"cases":rows.len(),"refusals":refusals,"reopens":reopens})
    );
}

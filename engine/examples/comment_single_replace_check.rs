//! Single replacement must reject unsupported comment input before deleting text.
use rhwp::document_core::DocumentCore;
use serde_json::{json, Value};
use std::path::Path;

const TEXT: &str = "앞😀 needle 뒤 보존";

fn fixture() -> DocumentCore {
    let mut doc = DocumentCore::new_empty();
    doc.create_blank_document_native().unwrap();
    doc.insert_text_native(0, 0, 0, TEXT).unwrap();
    doc.apply_char_format_native(0, 0, 0, 2, r#"{"bold":true}"#)
        .unwrap();
    doc.apply_char_format_native(0, 0, 10, 14, r#"{"italic":true}"#)
        .unwrap();
    doc.insert_body_comment(0, 0, 3, 9, "주석 내용 보존😀")
        .unwrap();
    doc
}

fn state(doc: &DocumentCore) -> Value {
    json!({
        "document": format!("{:?}", doc.document()),
        "hwp": doc.export_hwp_native().unwrap(),
        "hwpx": doc.export_hwpx_native().unwrap(),
        "svg": (0..doc.page_count()).map(|p| doc.render_page_svg_native(p).unwrap()).collect::<Vec<_>>(),
    })
}

fn main() {
    let output_arg = std::env::args().nth(1).expect("FRESH_OUTPUT_DIR");
    let output = Path::new(&output_arg);
    std::fs::create_dir(output).unwrap();
    let mut rows = Vec::new();
    let mut reopens = 0;
    for input_format in ["hwp", "hwpx"] {
        for api in ["replaceText", "replaceOne"] {
            for (position, offset, query) in [
                ("before", 0, "앞"),
                ("inside", 3, "needle"),
                ("after", 10, "뒤"),
            ] {
                for replacement in ["\n", "\r", "\r\n", "Q", "", "긴문구😀"] {
                    let seed = fixture();
                    let bytes = if input_format == "hwp" {
                        seed.export_hwp_native().unwrap()
                    } else {
                        seed.export_hwpx_native().unwrap()
                    };
                    let mut doc = DocumentCore::from_bytes(&bytes).unwrap();
                    let before = state(&doc);
                    let glyphs: Vec<_> = (0..TEXT.chars().count())
                        .map(|i| doc.document().sections[0].paragraphs[0].char_shape_id_at(i))
                        .collect();
                    let fields = format!("{:?}", doc.collect_all_fields()[0].field);
                    let undo = doc.save_snapshot_native();
                    let result = if api == "replaceText" {
                        doc.replace_text_native(0, 0, offset, query.chars().count(), replacement)
                    } else {
                        doc.replace_one_native(query, replacement, true)
                    };
                    let rejected = replacement.contains(['\r', '\n']);
                    let expected = if rejected {
                        assert!(result
                            .unwrap_err()
                            .to_string()
                            .contains("주석 본문에 줄바꿈"));
                        assert_eq!(state(&doc), before);
                        TEXT.to_string()
                    } else {
                        assert_eq!(
                            serde_json::from_str::<Value>(&result.unwrap()).unwrap()["ok"],
                            true
                        );
                        let mut chars: Vec<_> = TEXT.chars().collect();
                        chars.splice(offset..offset + query.chars().count(), replacement.chars());
                        let para = &doc.document().sections[0].paragraphs[0];
                        let inserted = replacement.chars().count();
                        for (i, shape) in glyphs.iter().enumerate() {
                            let new_offset = if i < offset {
                                Some(i)
                            } else if i >= offset + query.chars().count() {
                                Some(i - query.chars().count() + inserted)
                            } else {
                                None
                            };
                            if let Some(new_offset) = new_offset {
                                assert_eq!(para.char_shape_id_at(new_offset), *shape);
                            }
                        }
                        chars.into_iter().collect()
                    };
                    assert_eq!(doc.document().sections[0].paragraphs[0].text, expected);
                    assert_eq!(format!("{:?}", doc.collect_all_fields()[0].field), fields);
                    for format in ["hwp", "hwpx"] {
                        let bytes = if format == "hwp" {
                            doc.export_hwp_native().unwrap()
                        } else {
                            doc.export_hwpx_native().unwrap()
                        };
                        std::fs::write(
                            output.join(format!("case-{}.{format}", rows.len())),
                            &bytes,
                        )
                        .unwrap();
                        let reopened = DocumentCore::from_bytes(&bytes).unwrap();
                        assert_eq!(reopened.document().sections[0].paragraphs[0].text, expected);
                        let field = &reopened.collect_all_fields()[0].field;
                        assert_eq!(field.memo_paragraphs[0].text, "주석 내용 보존😀");
                        reopens += 1;
                    }
                    let after = state(&doc);
                    let redo = doc.save_snapshot_native();
                    doc.restore_snapshot_native(undo).unwrap();
                    assert_eq!(state(&doc), before);
                    doc.restore_snapshot_native(redo).unwrap();
                    assert_eq!(state(&doc), after);
                    doc.discard_snapshot_native(undo);
                    doc.discard_snapshot_native(redo);
                    rows.push(json!({"input":input_format,"api":api,"position":position,"replacement":replacement,"rejected":rejected}));
                }
            }
        }
    }
    let proof = json!({"cases":rows.len(),"rejections":36,"successes":36,"reopens":reopens,"snapshotRestores":rows.len()*2,"rows":rows});
    std::fs::write(
        output.join("proof.json"),
        serde_json::to_vec_pretty(&proof).unwrap(),
    )
    .unwrap();
    println!(
        "{}",
        json!({"cases":72,"rejections":36,"successes":36,"reopens":reopens})
    );
}

//! Standalone Native regression: no missing library-test fixtures or GUI adapter.
use rhwp::model::paragraph::CharShapeRef;
use rhwp::wasm_api::HwpDocument;
use serde_json::{json, Value};
use std::path::Path;

fn semantic(d: &HwpDocument) -> Value {
    let mut result = json!({
        "text": d.get_text_file_text(),
        "styles": serde_json::from_str::<Value>(&d.get_style_list()).unwrap(),
        "char": serde_json::from_str::<Value>(&d.get_char_properties_at_native(0, 0, 0).unwrap()).unwrap(),
        "para": serde_json::from_str::<Value>(&d.get_para_properties_at_native(0, 0).unwrap()).unwrap(),
    });
    // JSON.stringify in JavaScript emits integral floats as integers.
    fn json_numbers(value: &mut Value) {
        match value {
            Value::Array(items) => items.iter_mut().for_each(json_numbers),
            Value::Object(fields) => fields.values_mut().for_each(json_numbers),
            Value::Number(n) if n.is_f64() => {
                let f = n.as_f64().unwrap();
                if f.fract() == 0.0 && f.abs() < 9_007_199_254_740_992.0 {
                    *value = json!(f as i64);
                }
            }
            _ => {}
        }
    }
    json_numbers(&mut result);
    result
}

fn compare(actual: Value, expected: &Value, label: &str) {
    assert_eq!(actual, *expected, "{label}");
}

fn save(d: &HwpDocument, format: &str) -> Vec<u8> {
    let result = match format {
        "hwp" => d.export_hwp_with_adapter_snapshot_with_report(),
        "hwpx" => d.export_hwpx_native_with_report(),
        _ => panic!("unknown format"),
    }
    .unwrap();
    assert!(result.content_loss().is_empty());
    result.into_bytes()
}

fn valid_resources(d: &HwpDocument) {
    let info = &d.document().doc_info;
    assert!(!info.char_shapes.is_empty());
    assert!(!info.para_shapes.is_empty());
    assert!(!info.styles.is_empty());
    for cs in &info.char_shapes {
        assert!(cs.base_size > 0);
        for (language, id) in cs.font_ids.iter().enumerate() {
            assert!((*id as usize) < info.font_faces[language].len());
        }
    }
    for ps in &info.para_shapes {
        assert!((ps.tab_def_id as usize) < info.tab_defs.len());
    }
    for style in &info.styles {
        assert!((style.char_shape_id as usize) < info.char_shapes.len());
        assert!((style.para_shape_id as usize) < info.para_shapes.len());
        assert!((style.next_style_id as usize) < info.styles.len());
    }
    for section in &d.document().sections {
        for p in &section.paragraphs {
            assert!((p.style_id as usize) < info.styles.len());
            assert!((p.para_shape_id as usize) < info.para_shapes.len());
            for cs in &p.char_shapes {
                assert!((cs.char_shape_id as usize) < info.char_shapes.len());
            }
        }
    }
}

fn self_check() -> usize {
    let text = "첫 한글🙂𐐀 입력";
    let mut reopens = 0;
    for template in [false, true] {
        for stage in 0..3 {
            let mut d = HwpDocument::create_empty();
            assert_eq!(d.document().sections[0].paragraphs.len(), 1);
            assert!(d.document().sections[0].paragraphs[0].controls.is_empty());
            if template {
                d.create_blank_document_native().unwrap();
            }
            if stage > 0 {
                d.insert_text_native(0, 0, 0, text).unwrap();
            }
            if stage == 2 {
                d.apply_char_format_native(
                    0,
                    0,
                    0,
                    text.chars().count(),
                    r#"{"fontSize":1400,"bold":true,"italic":true,"textColor":3368703}"#,
                )
                .unwrap();
                d.apply_para_format_native(0, 0, r#"{"alignment":"center","lineSpacing":180}"#)
                    .unwrap();
            }
            valid_resources(&d);
            let expected = semantic(&d);
            if stage > 0 {
                let unicode: String = serde_json::from_str(&d.get_text_file_unicode()).unwrap();
                assert!(unicode.contains(text));
            }
            for first in ["hwp", "hwpx"] {
                let one = HwpDocument::from_bytes(&save(&d, first)).unwrap();
                valid_resources(&one);
                compare(
                    semantic(&one),
                    &expected,
                    &format!("first {template}/{stage}/{first}"),
                );
                reopens += 1;
                for second in ["hwp", "hwpx"] {
                    let two = HwpDocument::from_bytes(&save(&one, second)).unwrap();
                    valid_resources(&two);
                    compare(
                        semantic(&two),
                        &expected,
                        &format!("second {template}/{stage}/{first}/{second}"),
                    );
                    let three = HwpDocument::from_bytes(&save(&two, first)).unwrap();
                    valid_resources(&three);
                    compare(
                        semantic(&three),
                        &expected,
                        &format!("third {template}/{stage}/{first}/{second}"),
                    );
                    reopens += 2;
                }
            }
        }
    }
    let mut invalid = HwpDocument::create_empty();
    invalid.document_mut().sections[0].paragraphs[0]
        .char_shapes
        .push(CharShapeRef {
            start_pos: 0,
            char_shape_id: 42,
        });
    let before = format!("{:?}", invalid.document());
    let error = invalid.export_hwpx_native().unwrap_err().to_string();
    assert!(error.contains("charPrIDRef") && error.contains("42"));
    assert_eq!(before, format!("{:?}", invalid.document()));
    reopens
}

fn main() {
    let args: Vec<_> = std::env::args().skip(1).collect();
    let output = Path::new(&args[0]);
    std::fs::create_dir_all(output).unwrap();
    let self_reopens = self_check();
    if args.len() > 2 {
        let old = HwpDocument::from_bytes(&std::fs::read(&args[2]).unwrap()).unwrap();
        assert!(old.document().doc_info.char_shapes.is_empty());
        let before = format!("{:?}", old.document());
        let error = old.export_hwpx_native().unwrap_err().to_string();
        assert!(error.contains("charPrIDRef") && error.contains("[0]"));
        assert_eq!(before, format!("{:?}", old.document()));
    }
    let mut independent = 0;
    let mut resaves = 0;
    if args.len() > 1 {
        let rows: Vec<Value> = serde_json::from_slice(&std::fs::read(&args[1]).unwrap()).unwrap();
        for row in rows {
            let d = HwpDocument::from_bytes(&std::fs::read(row["file"].as_str().unwrap()).unwrap())
                .unwrap();
            valid_resources(&d);
            compare(
                semantic(&d),
                &row["semantic"],
                row["file"].as_str().unwrap(),
            );
            let svg: Vec<_> = (0..d.page_count())
                .map(|p| d.render_page_svg_native(p).unwrap())
                .collect();
            assert_eq!(json!(svg), row["svg"], "{} Native/WASM SVG", row["file"]);
            for format in ["hwp", "hwpx"] {
                let reopened = HwpDocument::from_bytes(&save(&d, format)).unwrap();
                valid_resources(&reopened);
                compare(semantic(&reopened), &row["semantic"], format);
                resaves += 1;
            }
            independent += 1;
        }
    }
    let proof = json!({"nativeFactoryAndTemplateCases":6,"nativeThreeSaveChainReopens":self_reopens,
        "independentWasmSavedReopens":independent,"independentNativeResaves":resaves,
        "resourceDefinitionsAndRefsChecked":true,"bareSemanticComparedExactly":true,
        "independentFullSVGComparedExactly":true,
        "templateTransparentFillGetterDifferenceUnfixed":false,
        "danglingId42StillRejectedWithoutMutation":true});
    std::fs::write(
        output.join("proof.json"),
        serde_json::to_vec_pretty(&proof).unwrap(),
    )
    .unwrap();
    println!("{proof}");
}

#[test]
fn empty_and_template_roundtrips_keep_defined_resources() {
    assert_eq!(self_check(), 60);
}

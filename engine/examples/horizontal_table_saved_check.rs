//! Independent Native comparison of actual Electron saved long-table files.
use rhwp::{model::control::Control, wasm_api::HwpDocument};
use serde_json::{json, Value};
// JSON.stringify emits integral floats as integers. Normalize only exact,
// integral values in the API's u32/i32 range; fractional values stay exact.
fn canonical_numbers(value: &mut Value) {
    match value {
        Value::Array(values) => values.iter_mut().for_each(canonical_numbers),
        Value::Object(fields) => fields.values_mut().for_each(canonical_numbers),
        Value::Number(number) if number.is_f64() => {
            if let Some(number) = number.as_f64() {
                if number.fract() == 0.0 && number.abs() <= f64::from(u32::MAX) {
                    *value = json!(number as i64);
                }
            }
        }
        _ => {}
    }
}
fn parse(s: String) -> Value {
    let mut value = serde_json::from_str(&s).unwrap();
    canonical_numbers(&mut value);
    value
}
fn main() {
    let args: Vec<_> = std::env::args().skip(1).collect();
    std::fs::create_dir_all(&args[1]).unwrap();
    if args.get(2).is_some_and(|x| x == "--pair") {
        let paths: Vec<String> = serde_json::from_slice(&std::fs::read(&args[0]).unwrap()).unwrap();
        for (i, path) in paths.iter().enumerate() {
            let d = HwpDocument::from_bytes(&std::fs::read(path).unwrap()).unwrap();
            std::fs::write(
                format!("{}/sections{i}.json", args[1]),
                serde_json::to_vec_pretty(
                    &d.document()
                        .sections
                        .iter()
                        .map(|s| &s.paragraphs)
                        .collect::<Vec<_>>(),
                )
                .unwrap(),
            )
            .unwrap();
            std::fs::write(
                format!("{}/section-debug{i}.txt", args[1]),
                format!("{:#?}", d.document().sections),
            )
            .unwrap();
            std::fs::write(
                format!("{}/docinfo{i}.txt", args[1]),
                format!("{:?}", d.document().doc_info),
            )
            .unwrap();
        }
        return;
    }
    let rows: Vec<Value> = serde_json::from_slice(&std::fs::read(&args[0]).unwrap()).unwrap();
    for row in &rows {
        let mut d = HwpDocument::from_bytes(&std::fs::read(row["file"].as_str().unwrap()).unwrap())
            .unwrap();
        d.set_clip_enabled(false);
        let (p, c) = d.document().sections[0]
            .paragraphs
            .iter()
            .enumerate()
            .find_map(|(p, para)| {
                para.controls
                    .iter()
                    .position(|c| matches!(c, Control::Table(_)))
                    .map(|c| (p, c))
            })
            .unwrap();
        assert_eq!(
            parse(d.get_table_properties(0, p as u32, c as u32).unwrap()),
            row["props"]
        );
        assert_eq!(parse(d.get_style_list()), row["styles"]);
        let svg: Vec<_> = (0..d.page_count())
            .map(|p| d.render_page_svg_native(p).unwrap())
            .collect();
        assert_eq!(json!(svg), row["svg"]);
        assert_eq!(d.page_count() as u64, row["pageCount"].as_u64().unwrap());
        let body: Vec<_> = (0..d.document().sections[0].paragraphs.len())
            .map(|i| d.get_text_range(0, i as u32, 0, 100000).unwrap())
            .collect();
        if let Some(expected) = row.get("bodyFormats").and_then(Value::as_array) {
            for (i, expected) in expected.iter().enumerate() {
                assert_eq!(parse(d.get_para_properties_at_native(0, i).unwrap()), expected["props"]);
                assert_eq!(parse(d.get_char_format_runs_native(0, i, 0, body[i].chars().count()).unwrap()), expected["runs"]);
            }
        }
        if let Some(expected) = row.get("pageDef") {
            assert_eq!(parse(d.get_page_def(0).unwrap()), *expected);
        }
        assert_eq!(json!(body), row["body"]);
        assert_eq!(d.get_text_file_text(), row["text"].as_str().unwrap());
        for (i, cell) in row["cells"].as_array().unwrap().iter().enumerate() {
            assert_eq!(
                parse(d.get_cell_info(0, p as u32, c as u32, i as u32).unwrap()),
                cell["info"]
            );
            assert_eq!(
                parse(
                    d.get_cell_properties(0, p as u32, c as u32, i as u32)
                        .unwrap()
                ),
                cell["props"]
            );
            for (para, expected) in cell["paras"].as_array().unwrap().iter().enumerate() {
                let text = d
                    .get_text_in_cell(0, p as u32, c as u32, i as u32, para as u32, 0, 10000)
                    .unwrap();
                assert_eq!(text, expected["text"].as_str().unwrap());
                assert_eq!(
                    parse(
                        d.get_cell_para_properties_at_native(0, p, c, i, para)
                            .unwrap()
                    ),
                    expected["props"]
                );
                assert_eq!(
                    parse(
                        d.get_cell_char_format_runs_by_path_native(
                            0,
                            p,
                            &[(c, i, para)],
                            0,
                            text.chars().count()
                        )
                        .unwrap()
                    ),
                    expected["runs"]
                );
            }
        }
    }
    std::fs::write(format!("{}/proof.json",args[1]),serde_json::to_vec_pretty(&json!({"sameBytesFiles":rows.len(),"fullSVGPageCountBodyCellsParagraphAndCharacterIDsStylesExact":true})).unwrap()).unwrap();
    println!("PASS {} actual Electron files", rows.len());
}

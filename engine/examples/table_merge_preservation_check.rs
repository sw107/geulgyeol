//! Synthetic cell merge owners, exact histories, saved reopen and independent WASM oracle.
#[allow(dead_code)]
#[path = "common/nested_cells.rs"]
mod nested_cells;
use rhwp::{
    document_core::DocumentCore,
    model::{
        control::{Bookmark, Control},
        paragraph::{NumberingRestart, Paragraph, TitleMark},
    },
};
use serde_json::{json, Value};
use std::path::Path;
fn table(d: &DocumentCore, p: usize, c: usize) -> &rhwp::model::table::Table {
    let Control::Table(t) = &d.document().sections[0].paragraphs[p].controls[c] else {
        panic!("table")
    };
    t
}
fn content(ps: &[Paragraph]) -> Value {
    let mut v = serde_json::to_value(ps).unwrap();
    fn clear(v: &mut Value) {
        match v {
            Value::Array(a) => a.iter_mut().for_each(clear),
            Value::Object(o) => {
                for k in [
                    "line_segs",
                    "hwpx_axis_shift",
                    "layout_only_fill_lines",
                    "single_line_overflow_memo",
                    "dirty",
                    "text_reflowed_after_edit",
                ] {
                    o.remove(k);
                }
                if let Some(Value::Array(h)) = o.get_mut("raw_header_extra") {
                    for b in h.iter_mut().take(6) {
                        *b = json!(0);
                    }
                }
                for v in o.values_mut() {
                    clear(v);
                }
            }
            _ => {}
        }
    }
    clear(&mut v);
    v
}
fn fields(d: &DocumentCore) -> Value {
    let mut f: Value = serde_json::from_str(&d.get_field_list_json()).unwrap();
    if let Value::Array(a) = &mut f {
        for field in a {
            // Named-cell fieldId is a computed cell locator, not a stored Field ID.
            if field["cellField"] == true {
                field.as_object_mut().unwrap().remove("fieldId");
            }
            field.as_object_mut().unwrap().remove("location");
            field.as_object_mut().unwrap().remove("listId");
            field.as_object_mut().unwrap().remove("paraInList");
        }
    }
    f
}
// HWP5 synthesizes packed/raw records and last-paragraph bits from HWPX.
// Keep the in-memory move comparison above strict; saved reopen compares typed
// semantics separately from those representation caches.
fn saved_content(ps: &[Paragraph]) -> Value {
    let mut v = content(ps);
    fn clear(v: &mut Value) {
        match v {
            Value::Array(a) => a.iter_mut().for_each(clear),
            Value::Object(o) => {
                if o.get("ctrl_data_name") == Some(&json!("")) {
                    o.insert("ctrl_data_name".into(), Value::Null);
                }
                if o.contains_key("field_type") {
                    if let Some(parameters) = o.get("parameters") {
                        let items = parameters["items"].as_array().unwrap();
                        if items.is_empty()
                            || (items.len() == 1
                                && items[0]["String"]["name"] == "Command"
                                && items[0]["String"]["value"] == o["command"])
                        {
                            o.remove("parameters");
                        }
                    }
                }
                o.retain(|k, _| {
                    !k.starts_with("raw_")
                        && !matches!(
                            k.as_str(),
                            "char_count_msb"
                                | "control_mask"
                                | "ctrl_data_records"
                                | "list_header_width_ref"
                        )
                });
                if (o.contains_key("cells") && o.contains_key("row_count"))
                    || o.contains_key("treat_as_char")
                {
                    o.remove("attr");
                }
                for v in o.values_mut() {
                    clear(v);
                }
            }
            _ => {}
        }
    }
    clear(&mut v);
    v
}
fn whole(d: &DocumentCore) -> String {
    nested_cells::model(d)
}
fn make(kind: &str) -> (DocumentCore, usize, usize) {
    let (mut d, p, path) = nested_cells::fixture(if kind == "nested" { 2 } else { 1 }, false);
    let c = path[0].0;
    d.add_bookmark_native(0, p + 1, 0, "인접 본문 책갈피🙂")
        .unwrap();
    match kind {
        "link" => {
            d.insert_cell_hyperlink_by_path(
                0,
                p,
                &[(c, 1, 0)],
                2,
                5,
                "https://example.invalid/merge-link",
                "링크🙂",
            )
            .unwrap();
        }
        "clickhere" => {
            d.insert_click_here_field_at_by_path(
                0,
                p,
                &[(c, 1, 0)],
                2,
                "안내🙂",
                "메모",
                "병합필드",
                true,
            )
            .unwrap();
        }
        "equations" => {
            d.insert_equation_in_cell_native(0, p, c, 1, 0, 2, "a over b", 1000, 0)
                .unwrap();
            d.insert_equation_in_cell_native(0, p, c, 1, 0, 5, "x _1 ^2", 1200, 0)
                .unwrap();
        }
        "control-only" => {
            let mut para = Paragraph::new_empty_like(&table(&d, p, c).cells[1].paragraphs[0]);
            para.controls = vec![Control::Bookmark(Bookmark {
                name: "빈 문단 참조🙂".into(),
            })];
            para.char_count += 8;
            para.align_ctrl_data_records();
            let Control::Table(t) = &mut d.document_mut().sections[0].paragraphs[p].controls[c]
            else {
                panic!()
            };
            t.cells[1].paragraphs = vec![para];
        }
        "metadata" => {
            let Control::Table(t) = &mut d.document_mut().sections[0].paragraphs[p].controls[c]
            else {
                panic!()
            };
            let para = &mut t.cells[1].paragraphs[0];
            para.insert_text_at(2, "\t");
            para.tab_extended = vec![[120, 0, 0, 0, 0, 0, 0]];
            para.title_marks.push(TitleMark {
                char_idx: 1,
                ignore: false,
            });
            para.numbering_restart = Some(NumberingRestart::NewStart(7));
        }
        "nested" | "plain" => {}
        _ => panic!("kind"),
    }
    let doc = d.document().clone();
    d.set_document(doc);
    (d, p, c)
}
fn merge(d: &mut DocumentCore, p: usize, c: usize, r: &[u16]) {
    d.merge_table_cells_native(0, p, c, r[0], r[1], r[2], r[3])
        .unwrap();
}
fn operation(d: &mut DocumentCore, p: usize, c: usize, op: &Value) {
    if let Some(r) = op.as_array() {
        merge(
            d,
            p,
            c,
            &r.iter()
                .map(|v| v.as_u64().unwrap() as u16)
                .collect::<Vec<_>>(),
        );
    } else {
        match op["kind"].as_str().unwrap() {
            "insertRow" => {
                d.insert_table_row_native(0, p, c, 0, false).unwrap();
            }
            "deleteRow" => {
                d.delete_table_row_native(0, p, c, 0).unwrap();
            }
            "insertColumn" => {
                d.insert_table_column_native(0, p, c, 0, false).unwrap();
            }
            "deleteColumn" => {
                d.delete_table_column_native(0, p, c, 0).unwrap();
            }
            "split" => {
                d.split_table_cell_native(0, p, c, 0, 0).unwrap();
            }
            "splitInto" => {
                d.split_table_cell_into_native(0, p, c, 0, 0, 1, 2, false, false)
                    .unwrap();
            }
            "reopen" => {
                *d = DocumentCore::from_bytes(&save(d, op["format"].as_str().unwrap())).unwrap();
            }
            _ => panic!("operation"),
        }
    }
}
fn typed_info(d: &DocumentCore) -> String {
    let mut info = d.document().doc_info.clone();
    info.raw_stream = None;
    info.raw_stream_dirty = false;
    info.raw_provenance = None;
    format!("{info:?}")
}
fn save(d: &DocumentCore, ext: &str) -> Vec<u8> {
    if ext == "hwp" {
        d.export_hwp_with_adapter_snapshot().unwrap()
    } else {
        d.export_hwpx_native().unwrap()
    }
}
fn main() {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    let out = Path::new(&args[0]);
    std::fs::create_dir_all(out).unwrap();
    if args
        .get(1)
        .is_some_and(|s| s == "--verify-wasm" || s == "--verify-adjacent-wasm")
    {
        let adjacent = args[1] == "--verify-adjacent-wasm";
        let manifest = args.get(2).map(String::as_str).unwrap_or(if adjacent {
            "adjacent-manifest.json"
        } else {
            "manifest.json"
        });
        let proof_file = args.get(3).map(String::as_str).unwrap_or(if adjacent {
            "native-adjacent-wasm-proof.json"
        } else {
            "native-wasm-proof.json"
        });
        let rows: Vec<Value> =
            serde_json::from_slice(&std::fs::read(out.join(manifest)).unwrap()).unwrap();
        let mut n = 0;
        for row in &rows {
            let mut expected =
                DocumentCore::from_bytes(&std::fs::read(row["input"].as_str().unwrap()).unwrap())
                    .unwrap();
            let p = row["ref"]["ppi"].as_u64().unwrap() as usize;
            let c = row["ref"]["ci"].as_u64().unwrap() as usize;
            for op in row["operations"].as_array().unwrap() {
                operation(&mut expected, p, c, op);
            }
            let format = row["file"].as_str().unwrap().rsplit('.').next().unwrap();
            let expected = DocumentCore::from_bytes(&save(&expected, format)).unwrap();
            let actual =
                DocumentCore::from_bytes(&std::fs::read(row["file"].as_str().unwrap()).unwrap())
                    .unwrap();
            assert_eq!(
                content(&actual.document().sections[0].paragraphs),
                content(&expected.document().sections[0].paragraphs),
                "{}",
                row["file"]
            );
            assert_eq!(fields(&actual), fields(&expected));
            assert_eq!(
                typed_info(&actual),
                typed_info(&expected),
                "typed DocInfo {}",
                row["file"]
            );
            assert_eq!(
                nested_cells::svg(&actual),
                nested_cells::svg(&expected),
                "{}",
                row["file"]
            );
            assert_eq!(
                format!("{:?}", actual.document().bin_data_content),
                format!("{:?}", expected.document().bin_data_content)
            );
            n += 1;
        }
        std::fs::write(out.join(proof_file),serde_json::to_vec_pretty(&json!({"independentSavedReopens":n,"nativeOperationReexecution":true,"fullParagraphsControlsFieldOwnersBinDataAndSVG":true,"typedDocInfoCompared":true})).unwrap()).unwrap();
        println!("Independent Native reopens {n}");
        return;
    }
    let mut rows = vec![];
    let mut reopens = 0;
    let mut pairs = 0;
    let mut refusals = 0;
    for kind in [
        "plain",
        "link",
        "clickhere",
        "equations",
        "nested",
        "control-only",
        "metadata",
    ] {
        for (direction, r) in [
            ("row", [0, 0, 0, 1]),
            ("column", [0, 1, 1, 1]),
            ("block", [0, 0, 1, 1]),
        ] {
            let (source, p, c) = make(kind);
            let label = format!("{kind}-{direction}");
            let input = out.join(format!("{label}-input.hwpx"));
            if !input.exists() {
                std::fs::write(&input, save(&source, "hwpx")).unwrap();
            }
            if args.get(1).is_some_and(|s| s == "--fixtures-only") {
                rows.push(json!({"label":label,"input":input,"ref":{"ppi":p,"ci":c},"range":r}));
                continue;
            }
            let mut d = DocumentCore::from_bytes(&std::fs::read(&input).unwrap()).unwrap();
            let before = whole(&d);
            let before_svg = nested_cells::svg(&d);
            let before_fields = fields(&d);
            let old = table(&d, p, c).clone();
            let expected = old
                .cells
                .iter()
                .filter(|cell| {
                    cell.row >= r[0] && cell.row <= r[2] && cell.col >= r[1] && cell.col <= r[3]
                })
                .flat_map(|cell| {
                    cell.paragraphs.iter().filter(move |p| {
                        (cell.row == r[0] && cell.col == r[1])
                            || !p.text.is_empty()
                            || !p.controls.is_empty()
                            || !p.field_ranges.is_empty()
                            || !p.orphan_field_ends.is_empty()
                            || !p.range_tags.is_empty()
                            || !p.title_marks.is_empty()
                            || p.ctrl_data_records.iter().any(Option::is_some)
                    })
                })
                .cloned()
                .collect::<Vec<_>>();
            let snap = d.save_snapshot_with_composition_native();
            merge(&mut d, p, c, &r);
            let primary = table(&d, p, c)
                .cells
                .iter()
                .find(|cell| cell.row == r[0] && cell.col == r[1])
                .unwrap();
            assert_eq!(
                content(&primary.paragraphs),
                content(&expected),
                "moved whole paragraphs {label}"
            );
            assert_eq!(
                fields(&d),
                before_fields,
                "field IDs/types/names survive {label}"
            );
            let after = whole(&d);
            let after_svg = nested_cells::svg(&d);
            let redo = d.save_snapshot_with_composition_native();
            for _ in 0..4 {
                d.restore_snapshot_native(snap).unwrap();
                assert_eq!(whole(&d), before);
                assert_eq!(nested_cells::svg(&d), before_svg);
                d.restore_snapshot_native(redo).unwrap();
                assert_eq!(whole(&d), after);
                assert_eq!(nested_cells::svg(&d), after_svg);
                pairs += 1;
            }
            for (stage, id) in [("after", redo), ("undo", snap)] {
                d.restore_snapshot_native(id).unwrap();
                for ext in ["hwp", "hwpx"] {
                    let file = out.join(format!("{label}-{stage}.{ext}"));
                    let data = save(&d, ext);
                    std::fs::write(&file, &data).unwrap();
                    let reopened = DocumentCore::from_bytes(&data).unwrap();
                    if saved_content(&reopened.document().sections[0].paragraphs)
                        != saved_content(&d.document().sections[0].paragraphs)
                    {
                        std::fs::write(
                            out.join(format!("{label}-{stage}-{ext}-ir-diff.json")),
                            serde_json::to_vec_pretty(&json!({"saved":saved_content(&reopened.document().sections[0].paragraphs),"live":saved_content(&d.document().sections[0].paragraphs)})).unwrap(),
                        ).unwrap();
                    }
                    assert_eq!(
                        saved_content(&reopened.document().sections[0].paragraphs),
                        saved_content(&d.document().sections[0].paragraphs),
                        "saved paragraphs {label} {stage} {ext}"
                    );
                    assert_eq!(fields(&reopened), fields(&d));
                    assert_eq!(
                        nested_cells::svg(&reopened),
                        nested_cells::svg(&d),
                        "saved SVG {label} {stage} {ext}"
                    );
                    reopens += 1;
                }
            }
            d.restore_snapshot_native(snap).unwrap();
            for bad in [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 2, 1], [0, 0, 1, 2]] {
                let b = whole(&d);
                let svg = nested_cells::svg(&d);
                assert!(d
                    .merge_table_cells_native(0, p, c, bad[0], bad[1], bad[2], bad[3])
                    .is_err());
                assert_eq!(whole(&d), b);
                assert_eq!(nested_cells::svg(&d), svg);
                refusals += 1;
            }
            for (s, pp, cc) in [(999, p, c), (0, 999, c), (0, p, 999)] {
                let b = whole(&d);
                assert!(d.merge_table_cells_native(s, pp, cc, 0, 0, 0, 1).is_err());
                assert_eq!(whole(&d), b);
                refusals += 1;
            }
            d.discard_snapshot_native(snap);
            d.discard_snapshot_native(redo);
            rows.push(json!({"label":label,"input":input,"ref":{"ppi":p,"ci":c},"range":r}));
        }
    }
    std::fs::write(
        out.join("fixtures.json"),
        serde_json::to_vec_pretty(&rows).unwrap(),
    )
    .unwrap();
    if args.get(1).is_some_and(|s| s == "--fixtures-only") {
        println!("Prepared {} fixtures", rows.len());
        return;
    }
    let mut adjacent_pairs = 0;
    let mut adjacent_reopens = 0;
    let first = &rows.iter().find(|r| r["label"] == "link-row").unwrap();
    let mut d = DocumentCore::from_bytes(&std::fs::read(first["input"].as_str().unwrap()).unwrap())
        .unwrap();
    let p = first["ref"]["ppi"].as_u64().unwrap() as usize;
    let c = first["ref"]["ci"].as_u64().unwrap() as usize;
    merge(&mut d, p, c, &[0, 0, 0, 1]);
    for kind in [
        "insertRow",
        "deleteRow",
        "insertColumn",
        "deleteColumn",
        "split",
    ] {
        let before = whole(&d);
        let before_svg = nested_cells::svg(&d);
        let before_fields = fields(&d);
        let undo = d.save_snapshot_with_composition_native();
        operation(&mut d, p, c, &json!({"kind":kind}));
        assert_eq!(fields(&d), before_fields, "adjacent owners {kind}");
        let after = whole(&d);
        let after_svg = nested_cells::svg(&d);
        let redo = d.save_snapshot_with_composition_native();
        for _ in 0..4 {
            d.restore_snapshot_native(undo).unwrap();
            assert_eq!(whole(&d), before);
            assert_eq!(nested_cells::svg(&d), before_svg);
            d.restore_snapshot_native(redo).unwrap();
            assert_eq!(whole(&d), after);
            assert_eq!(nested_cells::svg(&d), after_svg);
            adjacent_pairs += 1;
        }
        for (stage, id) in [("after", redo), ("undo", undo)] {
            d.restore_snapshot_native(id).unwrap();
            for ext in ["hwp", "hwpx"] {
                let data = save(&d, ext);
                std::fs::write(out.join(format!("adjacent-{kind}-{stage}.{ext}")), &data).unwrap();
                let reopened = DocumentCore::from_bytes(&data).unwrap();
                assert_eq!(
                    saved_content(&reopened.document().sections[0].paragraphs),
                    saved_content(&d.document().sections[0].paragraphs),
                    "adjacent saved {kind} {stage} {ext}"
                );
                assert_eq!(fields(&reopened), fields(&d));
                assert_eq!(nested_cells::svg(&reopened), nested_cells::svg(&d));
                adjacent_reopens += 1;
            }
        }
        d.restore_snapshot_native(redo).unwrap();
        d.discard_snapshot_native(undo);
        d.discard_snapshot_native(redo);
    }
    let proof = json!({"cases":rows.len(),"snapshotPairs":pairs,"savedReopens":reopens,"atomicNativeRefusals":refusals,"adjacentCases":5,"adjacentPairs":adjacent_pairs,"adjacentReopens":adjacent_reopens,"wholeParagraphOwnersStylesAndSVGCompared":true});
    std::fs::write(
        out.join("native-proof.json"),
        serde_json::to_vec_pretty(&proof).unwrap(),
    )
    .unwrap();
    println!("{proof}");
}

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
    let index = op["index"].as_u64().unwrap_or(0) as u16;
    let after = op["after"].as_bool().unwrap_or(false);
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
                d.insert_table_row_native(0, p, c, index, after).unwrap();
            }
            "deleteRow" => {
                d.delete_table_row_native(0, p, c, index).unwrap();
            }
            "insertColumn" => {
                d.insert_table_column_native(0, p, c, index, after).unwrap();
            }
            "deleteColumn" => {
                d.delete_table_column_native(0, p, c, index).unwrap();
            }
            "split" => {
                d.split_table_cell_native(0, p, c, 0, 0).unwrap();
            }
            "splitInto" => {
                d.split_table_cell_into_native(
                    0,
                    p,
                    c,
                    op["row"].as_u64().unwrap_or(0) as u16,
                    op["col"].as_u64().unwrap_or(0) as u16,
                    op["nRows"].as_u64().unwrap_or(1) as u16,
                    op["mCols"].as_u64().unwrap_or(2) as u16,
                    op["equalRowHeight"].as_bool().unwrap_or(false),
                    op["mergeFirst"].as_bool().unwrap_or(false),
                )
                .unwrap();
            }
            "splitRange" => {
                let r = op["range"].as_array().unwrap();
                d.split_table_cells_in_range_native(
                    0,
                    p,
                    c,
                    r[0].as_u64().unwrap() as u16,
                    r[1].as_u64().unwrap() as u16,
                    r[2].as_u64().unwrap() as u16,
                    r[3].as_u64().unwrap() as u16,
                    op["nRows"].as_u64().unwrap_or(1) as u16,
                    op["mCols"].as_u64().unwrap_or(2) as u16,
                    op["equalRowHeight"].as_bool().unwrap_or(false),
                )
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
    if args.get(1).is_some_and(|s| s == "--nested-fixtures") {
        nested_command_fixtures(out);
        return;
    }
    if args.get(1).is_some_and(|s| s == "--structure") {
        structure(out);
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

// Reuse the strict merge owner/reopen oracle for adjacent structural editing.
fn structure(out: &Path) {
    let (mut seed, p, c) = make("link");
    seed.insert_equation_in_cell_native(0, p, c, 1, 1, 2, "a over b", 1000, 0)
        .unwrap();
    seed.insert_equation_in_cell_native(0, p, c, 1, 1, 5, "x _1 ^2", 1200, 0)
        .unwrap();
    merge(&mut seed, p, c, &[0, 0, 1, 1]);
    let cases = [
        (
            "insert-row-interior",
            json!([{"kind":"insertRow","after":true}]),
        ),
        (
            "insert-column-interior",
            json!([{"kind":"insertColumn","after":true}]),
        ),
        ("delete-merged-anchor-row", json!([{"kind":"deleteRow"}])),
        (
            "delete-merged-anchor-column",
            json!([{"kind":"deleteColumn"}]),
        ),
        (
            "row-insert-delete",
            json!([{"kind":"insertRow","after":true},{"kind":"deleteRow","index":1}]),
        ),
        (
            "column-insert-delete",
            json!([{"kind":"insertColumn","after":true},{"kind":"deleteColumn","index":1}]),
        ),
        ("unmerge", json!([{"kind":"split"}])),
        (
            "split-2x2",
            json!([{"kind":"splitInto","nRows":2,"mCols":2}]),
        ),
        (
            "split-1x3",
            json!([{"kind":"splitInto","nRows":1,"mCols":3}]),
        ),
        (
            "split-merge-first",
            json!([{"kind":"splitInto","nRows":2,"mCols":3,"mergeFirst":true}]),
        ),
        (
            "split-range",
            json!([{"kind":"splitRange","range":[0,0,1,1],"nRows":2,"mCols":2}]),
        ),
        (
            "unmerge-range",
            json!([{"kind":"split"},{"kind":"splitRange","range":[0,0,1,1],"nRows":1,"mCols":2}]),
        ),
    ];
    let mut fixtures = vec![];
    let mut pairs = 0;
    let mut reopens = 0;
    let mut refusals = 0;
    let mut noops = 0;
    fn owners(d: &DocumentCore, p: usize, c: usize) -> Value {
        content(
            &table(d, p, c)
                .cells
                .iter()
                .flat_map(|cell| cell.paragraphs.iter())
                .filter(|p| {
                    !p.text.is_empty() || !p.controls.is_empty() || !p.field_ranges.is_empty()
                })
                .cloned()
                .collect::<Vec<_>>(),
        )
    }
    for ext in ["hwp", "hwpx"] {
        let input = out.join(format!("combined-merged-input.{ext}"));
        let serialized = if ext == "hwp" {
            seed.export_hwp_with_adapter_snapshot_with_report().unwrap()
        } else {
            seed.export_hwpx_native_with_report().unwrap()
        };
        assert!(serialized.content_loss().is_empty(), "seed content loss");
        std::fs::write(&input, serialized.bytes()).unwrap();
        for (name, operations) in &cases {
            let label = format!("{ext}-{name}");
            let mut d = DocumentCore::from_bytes(serialized.bytes()).unwrap();
            let before = whole(&d);
            let before_svg = nested_cells::svg(&d);
            let before_fields = fields(&d);
            let before_owners = owners(&d, p, c);
            let before_root = content(
                &d.document().sections[0]
                    .paragraphs
                    .iter()
                    .enumerate()
                    .filter(|(i, _)| *i != p)
                    .map(|(_, p)| p.clone())
                    .collect::<Vec<_>>(),
            );
            let undo = d.save_snapshot_with_composition_native();
            for op in operations.as_array().unwrap() {
                operation(&mut d, p, c, op);
            }
            assert_eq!(
                owners(&d, p, c),
                before_owners,
                "whole content owners {label}"
            );
            assert_eq!(fields(&d), before_fields, "field identities {label}");
            assert_eq!(
                content(
                    &d.document().sections[0]
                        .paragraphs
                        .iter()
                        .enumerate()
                        .filter(|(i, _)| *i != p)
                        .map(|(_, p)| p.clone())
                        .collect::<Vec<_>>()
                ),
                before_root
            );
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
                pairs += 1;
            }
            for (stage, id) in [("after", redo), ("undo", undo)] {
                d.restore_snapshot_native(id).unwrap();
                for format in ["hwp", "hwpx"] {
                    let data = if format == "hwp" {
                        d.export_hwp_with_adapter_snapshot_with_report().unwrap()
                    } else {
                        d.export_hwpx_native_with_report().unwrap()
                    };
                    assert!(
                        data.content_loss().is_empty(),
                        "content loss {label} {stage} {format}"
                    );
                    let file = out.join(format!("{label}-{stage}.{format}"));
                    std::fs::write(file, data.bytes()).unwrap();
                    let reopened = DocumentCore::from_bytes(data.bytes()).unwrap();
                    let saved = saved_content(&reopened.document().sections[0].paragraphs);
                    let mut expected = saved_content(&d.document().sections[0].paragraphs);
                    // Cross-format section defaults/packed PageBorderFill attributes
                    // also change without a table edit. Compare untouched body owners
                    // to the same-format saved input, and table owners to live IR.
                    let input_core = DocumentCore::from_bytes(serialized.bytes()).unwrap();
                    let baseline = DocumentCore::from_bytes(&save(&input_core, format)).unwrap();
                    let canonical = saved_content(&baseline.document().sections[0].paragraphs);
                    for i in 0..expected.as_array().unwrap().len() {
                        if i != p {
                            expected[i] = canonical[i].clone();
                        }
                    }
                    assert_eq!(saved, expected, "saved owners {label} {stage} {format}");
                    assert_eq!(typed_info(&reopened), typed_info(&baseline));
                    assert_eq!(
                        format!("{:?}", reopened.document().bin_data_content),
                        format!("{:?}", baseline.document().bin_data_content)
                    );
                    assert_eq!(fields(&reopened), fields(&d));
                    assert_eq!(
                        nested_cells::svg(&reopened),
                        nested_cells::svg(&d),
                        "saved SVG {label} {stage} {format}"
                    );
                    reopens += 1;
                }
            }
            d.discard_snapshot_native(undo);
            d.discard_snapshot_native(redo);
            fixtures.push(
                json!({"label":label,"input":input,"ref":{"ppi":p,"ci":c},"operations":operations}),
            );
        }
        let mut d = DocumentCore::from_bytes(serialized.bytes()).unwrap();
        for (sr, sc, er, ec, nr, nc) in [
            (0, 0, 1, 2, 1, 2),
            (1, 0, 0, 1, 1, 2),
            (0, 1, 1, 1, 1, 2),
            (0, 0, 0, 0, 1, 2),
            (0, 0, 1, 1, 0, 2),
            (0, 1, 1, 1, 1, 1),
            (0, 0, 1, 2, 1, 1),
        ] {
            let b = whole(&d);
            let svg = nested_cells::svg(&d);
            let events = d.serialize_event_log();
            let hwp = save(&d, "hwp");
            let hwpx = save(&d, "hwpx");
            assert!(d
                .split_table_cells_in_range_native(0, p, c, sr, sc, er, ec, nr, nc, false)
                .is_err());
            assert_eq!(whole(&d), b);
            assert_eq!(nested_cells::svg(&d), svg);
            assert_eq!(d.serialize_event_log(), events);
            assert_eq!(save(&d, "hwp"), hwp);
            assert_eq!(save(&d, "hwpx"), hwpx);
            refusals += 1;
        }
        for (r, col, nr, nc, mf) in [
            (0, 0, 65535, 2, true),
            (0, 0, 0, 2, false),
            (0, 1, 1, 2, false),
            (2, 0, 1, 1, false),
        ] {
            let b = whole(&d);
            let svg = nested_cells::svg(&d);
            let events = d.serialize_event_log();
            let hwp = save(&d, "hwp");
            let hwpx = save(&d, "hwpx");
            assert!(d
                .split_table_cell_into_native(0, p, c, r, col, nr, nc, false, mf)
                .is_err());
            assert_eq!(whole(&d), b);
            assert_eq!(nested_cells::svg(&d), svg);
            assert_eq!(d.serialize_event_log(), events);
            assert_eq!(save(&d, "hwp"), hwp);
            assert_eq!(save(&d, "hwpx"), hwpx);
            refusals += 1;
        }
        for is_range in [false, true] {
            let b = whole(&d);
            let events = d.serialize_event_log();
            let svg = nested_cells::svg(&d);
            if is_range {
                d.split_table_cells_in_range_native(0, p, c, 0, 0, 1, 1, 1, 1, false)
                    .unwrap();
            } else {
                d.split_table_cell_into_native(0, p, c, 0, 0, 1, 1, false, true)
                    .unwrap();
            }
            assert_eq!(whole(&d), b);
            assert_eq!(d.serialize_event_log(), events);
            assert_eq!(nested_cells::svg(&d), svg);
            noops += 1;
        }
    }
    // Small synthetic grid: overflow happens after an earlier cell was split.
    let mut t = table(&seed, p, c).clone();
    t.split_cell(0, 0).unwrap();
    t.row_count = u16::MAX - 1;
    let b = format!("{t:?}");
    assert!(t.split_cells_in_range(0, 0, 1, 1, 2, 1, false).is_err());
    assert_eq!(format!("{t:?}"), b);
    refusals += 1;
    std::fs::write(
        out.join("fixtures.json"),
        serde_json::to_vec_pretty(&fixtures).unwrap(),
    )
    .unwrap();
    let proof = json!({"cases":fixtures.len(),"snapshotPairs":pairs,"savedReopens":reopens,"atomicNativeRefusals":refusals,"unchangedValidNoops":noops,"wholeParagraphOwnersStylesAndSVGCompared":true,"savedContentLosses":0});
    std::fs::write(
        out.join("native-proof.json"),
        serde_json::to_vec_pretty(&proof).unwrap(),
    )
    .unwrap();
    println!("{proof}");
}

// Unsupported nested structural UI commands must never fall back to this root.
fn nested_command_fixtures(out: &Path) {
    let (equations, ep, ec) = make("equations");
    let eq_para = table(&equations, ep, ec).cells[1].paragraphs[0].clone();
    let mut rows = vec![];
    for depth in [2, 3] {
        for merged in [false, true] {
            let (mut d, p, path) = nested_cells::fixture(depth, false);
            let mut link_path = path.clone();
            let leaf = link_path.last_mut().unwrap();
            leaf.1 = 1;
            leaf.2 = 0;
            d.insert_cell_hyperlink_by_path(
                0,
                p,
                &link_path,
                2,
                5,
                "https://example.invalid/nested-table-owner",
                "안쪽 표 링크🙂",
            )
            .unwrap();
            d.add_bookmark_native(0, p + 1, 0, "바깥 본문 보존🙂")
                .unwrap();
            let t = nested_cells::table_mut(&mut d.document_mut().sections[0].paragraphs[p], &path);
            t.cells[1].paragraphs[1] = eq_para.clone();
            if merged {
                t.merge_cells(0, 0, 0, 1).unwrap();
            }
            let doc = d.document().clone();
            d.set_document(doc);
            for format in ["hwp", "hwpx"] {
                let file = out.join(format!("depth{depth}-merged{merged}.{format}"));
                let bytes = if format == "hwp" {
                    d.export_hwp_with_adapter_snapshot_with_report().unwrap()
                } else {
                    d.export_hwpx_native_with_report().unwrap()
                };
                assert!(bytes.content_loss().is_empty());
                std::fs::write(&file, bytes.bytes()).unwrap();
                rows.push(json!({"label":format!("depth{depth}-merged{merged}-{format}"),"input":file,"ref":{"ppi":p,"ci":path[0].0},"path":serde_json::from_str::<Value>(&nested_cells::path_json(&path)).unwrap(),"depth":depth,"merged":merged}));
            }
        }
    }
    std::fs::write(
        out.join("nested-fixtures.json"),
        serde_json::to_vec_pretty(&rows).unwrap(),
    )
    .unwrap();
    println!("Prepared {} nested fixtures, depth 2/3, leaf link/two equations/direct format/body bookmark", rows.len());
}

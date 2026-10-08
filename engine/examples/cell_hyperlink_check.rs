//! Cell hyperlink transactions: exact paths, neighboring owners, paired ranges and refs.
#[path = "common/nested_cells.rs"]
mod nested_cells;
use rhwp::{
    document_core::DocumentCore,
    model::{
        control::{Control, Parameter},
        paragraph::{CharShapeRef, Paragraph},
    },
};
use serde_json::{json, Value};
use std::path::Path;
fn view(d: &DocumentCore) -> Value {
    fn paras(ps: &[Paragraph]) -> Value {
        json!(ps.iter().map(|p|json!({"text":p.text,"style":p.style_id,"para":p.para_shape_id,"chars":(0..p.text.chars().count()).map(|i|p.char_shape_id_at(i)).collect::<Vec<_>>(),"positions":p.control_text_positions(),"ranges":p.field_ranges,"tags":p.range_tags,"controls":p.controls.iter().map(|c|match c {Control::Table(t)=>json!({"cells":t.cells.iter().map(|c|json!({"name":c.field_name,"geometry":[c.row,c.col,c.row_span,c.col_span,c.width],"para":paras(&c.paragraphs)})).collect::<Vec<_>>()}),Control::Field(f)=>json!({"id":f.field_id,"type":format!("{:?}",f.field_type),"url":f.command,"name":f.ctrl_data_name.as_deref().unwrap_or("")}),Control::Footnote(n)=>json!({"note":n.number,"para":paras(&n.paragraphs)}),_=>json!({"kind":format!("{c:?}").split(['(','{']).next()})}).collect::<Vec<_>>()})).collect::<Vec<_>>())
    }
    json!({"sections":d.document().sections.iter().map(|s|paras(&s.paragraphs)).collect::<Vec<_>>(),"fields":serde_json::from_str::<Value>(&d.get_field_list_json()).unwrap()})
}
fn target<'a>(d: &'a DocumentCore, parent: usize, path: &[(usize, usize, usize)]) -> &'a Paragraph {
    let mut p = &d.document().sections[0].paragraphs[parent];
    for &(ci, cell, pi) in path {
        let Control::Table(t) = &p.controls[ci] else {
            panic!()
        };
        p = &t.cells[cell].paragraphs[pi];
    }
    p
}
fn target_mut<'a>(
    d: &'a mut DocumentCore,
    parent: usize,
    path: &[(usize, usize, usize)],
) -> &'a mut Paragraph {
    fn walk<'a>(p: &'a mut Paragraph, path: &[(usize, usize, usize)]) -> &'a mut Paragraph {
        let (ci, cell, pi) = path[0];
        let Control::Table(t) = &mut p.controls[ci] else {
            panic!()
        };
        let p = &mut t.cells[cell].paragraphs[pi];
        if path.len() == 1 {
            p
        } else {
            walk(p, &path[1..])
        }
    }
    walk(&mut d.document_mut().sections[0].paragraphs[parent], path)
}
fn fixture(depth: usize, merged: bool) -> (DocumentCore, usize, Vec<(usize, usize, usize)>, u32) {
    let (mut d, parent, path) = nested_cells::fixture(depth, merged);
    let n: Value = serde_json::from_str(&d.insert_footnote_native(0, 0, 1).unwrap()).unwrap();
    let ci = n["controlIdx"].as_u64().unwrap() as usize;
    d.insert_text_in_footnote_native(0, 0, ci, 0, 2, "각주🙂참조")
        .unwrap();
    let note = d.document().sections[0].paragraphs[0].controls[ci].clone();
    let old = target(&d, parent, &path).clone();
    let mut p = Paragraph::new_empty_like(&old);
    p.insert_text_at(0, "앞🙂한글𐐀링크 뒤참조끝");
    p.style_id = 1;
    p.para_shape_id = old.para_shape_id;
    p.char_shapes = vec![
        CharShapeRef {
            start_pos: 0,
            char_shape_id: old.char_shape_id_at(0).unwrap_or(0),
        },
        CharShapeRef {
            start_pos: 3,
            char_shape_id: 0,
        },
        CharShapeRef {
            start_pos: 6,
            char_shape_id: old.char_shape_id_at(0).unwrap_or(0),
        },
    ];
    p.controls = vec![note];
    p.ctrl_data_records = vec![None];
    for o in p.char_offsets.iter_mut().skip(1) {
        *o += 8;
    }
    p.char_count += 8;
    p.char_shapes[1].start_pos = p.char_offsets[3];
    p.char_shapes[2].start_pos = p.char_offsets[6];
    *target_mut(&mut d, parent, &path) = p;
    let t = nested_cells::table_mut(&mut d.document_mut().sections[0].paragraphs[parent], &path);
    t.cells[0].field_name = Some("same".into());
    t.cells[1].field_name = Some("same".into());
    t.cells[1].paragraphs[0].style_id = 2;
    let doc = d.document().clone();
    d.set_document(doc);
    let id: Value = serde_json::from_str(
        &d.insert_click_here_field_at_by_path(
            0,
            parent,
            &path,
            0,
            "안내🙂",
            "메모",
            "existing",
            true,
        )
        .unwrap(),
    )
    .unwrap();
    assert!(id["fieldId"].as_u64().is_some());
    // Imported-like high actual ID avoids the separate virtual-cell ID namespace.
    let id = 1000;
    for c in &mut target_mut(&mut d, parent, &path).controls {
        if let Control::Field(f) = c {
            f.field_id = id;
        }
    }
    d.set_field_value_by_id(id, "값").unwrap();
    let b = d.export_hwpx_native().unwrap();
    d = DocumentCore::from_bytes(&b).unwrap();
    (d, parent, path, id)
}
fn save(d: &DocumentCore, out: &Path, label: &str) -> Vec<Value> {
    let mut rows = Vec::new();
    for (ext, b) in [
        ("hwp", d.export_hwp_native().unwrap()),
        ("hwpx", d.export_hwpx_native().unwrap()),
    ] {
        let file = out.join(format!("{label}.{ext}"));
        std::fs::write(&file, &b).unwrap();
        let r = DocumentCore::from_bytes(&b).unwrap();
        assert_eq!(view(&r), view(d), "{label} {ext}");
        rows.push(json!({"file":file}));
    }
    rows
}
fn verify_ui(manifest: &Path, out: &Path) {
    let rows: Vec<Value> = serde_json::from_slice(&std::fs::read(manifest).unwrap()).unwrap();
    for row in &rows {
        let mut d =
            DocumentCore::from_bytes(&std::fs::read(row["input"].as_str().unwrap()).unwrap())
                .unwrap();
        let defs = format!("{:?}", d.document().doc_info);
        let parent = row["c"]["parent"].as_u64().unwrap() as usize;
        let path: Vec<_> = row["c"]["path"]
            .as_array()
            .unwrap()
            .iter()
            .map(|e| {
                (
                    e["controlIndex"].as_u64().unwrap() as usize,
                    e["cellIndex"].as_u64().unwrap() as usize,
                    e["cellParaIndex"].as_u64().unwrap() as usize,
                )
            })
            .collect();
        let op = row["op"].as_str().unwrap();
        if op == "multipage" {
            d.insert_cell_hyperlink_by_path(
                0,
                parent,
                &path,
                1,
                1,
                "https://multipage.invalid",
                &"길이🙂한글 ".repeat(80),
            )
            .unwrap();
            assert_eq!(format!("{:?}", d.document().doc_info), defs);
            let r =
                DocumentCore::from_bytes(&std::fs::read(row["file"].as_str().unwrap()).unwrap())
                    .unwrap();
            assert_eq!(
                view(&d),
                view(&r),
                "independent multipage refs {}",
                row["file"]
            );
            continue;
        }
        let id: Value = serde_json::from_str(
            &d.insert_cell_hyperlink_by_path(
                0,
                parent,
                &path,
                3,
                8,
                "https://example.invalid/한글?q=🙂&x=1",
                "",
            )
            .unwrap(),
        )
        .unwrap();
        let id = id["fieldId"].as_u64().unwrap() as u32;
        if op != "wrap" {
            d.update_cell_hyperlink_by_path(0, parent, &path, id, "http://example.invalid/수정🙂")
                .unwrap();
        }
        if !matches!(op, "wrap" | "url") {
            d.insert_cell_hyperlink_by_path(0, parent, &path, 8, 10, "https://second.invalid", "")
                .unwrap();
        }
        if !matches!(op, "wrap" | "url" | "adjacent") {
            d.remove_cell_hyperlink_by_path(0, parent, &path, id)
                .unwrap();
        }
        if !matches!(op, "wrap" | "url" | "adjacent" | "unlink") {
            d.insert_cell_hyperlink_by_path(
                0,
                parent,
                &path,
                10,
                10,
                "https://new.invalid",
                "삽입🙂한글",
            )
            .unwrap();
        }
        if matches!(op, "long") || op.starts_with("reopened") {
            d.insert_cell_hyperlink_by_path(
                0,
                parent,
                &path,
                1,
                1,
                "https://long.invalid",
                &"길이🙂한글 ".repeat(4),
            )
            .unwrap();
        }
        assert_eq!(
            format!("{:?}", d.document().doc_info),
            defs,
            "unchanged imported definitions"
        );
        if op.starts_with("reopened") {
            let ext = op.rsplit('-').next().unwrap();
            let b = if ext == "Hwp" {
                d.export_hwp_native().unwrap()
            } else {
                d.export_hwpx_native().unwrap()
            };
            d = DocumentCore::from_bytes(&b).unwrap();
            let defs = format!("{:?}", d.document().doc_info);
            let field = d
                .collect_all_fields()
                .into_iter()
                .find(|f| format!("{:?}", f.field.field_type) == "Hyperlink")
                .unwrap()
                .field
                .field_id;
            d.update_cell_hyperlink_by_path(
                0,
                parent,
                &path,
                field,
                "https://reopened.invalid/새🙂",
            )
            .unwrap();
            if op.starts_with("reopened-unlink") {
                d.remove_cell_hyperlink_by_path(0, parent, &path, field)
                    .unwrap();
            }
            assert_eq!(format!("{:?}", d.document().doc_info), defs);
        }
        let r = DocumentCore::from_bytes(&std::fs::read(row["file"].as_str().unwrap()).unwrap())
            .unwrap();
        assert_eq!(view(&d),view(&r),"independent Native full paragraph/style/char IDs, field ranges, URLs and note refs: {}",row["file"]);
    }
    let proof = json!({"uiSavedFilesVerified":rows.len(),"fullCharParaStyleReferences":true,"pairedFieldRanges":true,"allSiblingCellBodyNoteReferences":true,"originalDefinitionsUnchanged":true});
    std::fs::write(out, serde_json::to_vec_pretty(&proof).unwrap()).unwrap();
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
    let mut fixtures = Vec::new();
    let mut positives = Vec::new();
    let mut rejects = Vec::new();
    let long = "길이🙂한글 ".repeat(80);
    for depth in 1..=3 {
        for merged in [false, true] {
            let (mut d, parent, path, neighbor) = fixture(depth, merged);
            let definitions = format!("{:?}", d.document().doc_info);
            let baseline = view(&d);
            let seed = save(&d, out, &format!("seed-{depth}-{merged}"));
            fixtures.push(json!({"depth":depth,"merged":merged,"parent":parent,"path":serde_json::from_str::<Value>(&nested_cells::path_json(&path)).unwrap(),"neighborId":neighbor,"seed":seed}));
            let mut id = 0;
            for (label, op) in [
                ("wrap", 0),
                ("url", 1),
                ("adjacent", 2),
                ("unlink", 3),
                ("caret", 4),
                ("long", 5),
            ] {
                let before = view(&d);
                let original = target(&d, parent, &path).clone();
                let snapshot = d.save_snapshot_native();
                match op {
                    0 => {
                        let v: Value = serde_json::from_str(
                            &d.insert_cell_hyperlink_by_path(
                                0,
                                parent,
                                &path,
                                3,
                                8,
                                "https://example.invalid/한글?q=🙂&x=1",
                                "",
                            )
                            .unwrap(),
                        )
                        .unwrap();
                        id = v["fieldId"].as_u64().unwrap() as u32;
                    }
                    1 => {
                        d.update_cell_hyperlink_by_path(
                            0,
                            parent,
                            &path,
                            id,
                            "http://example.invalid/수정🙂",
                        )
                        .unwrap();
                    }
                    2 => {
                        d.insert_cell_hyperlink_by_path(
                            0,
                            parent,
                            &path,
                            8,
                            10,
                            "https://second.invalid",
                            "",
                        )
                        .unwrap();
                    }
                    3 => {
                        d.remove_cell_hyperlink_by_path(0, parent, &path, id)
                            .unwrap();
                    }
                    4 => {
                        d.insert_cell_hyperlink_by_path(
                            0,
                            parent,
                            &path,
                            10,
                            10,
                            "https://new.invalid",
                            "삽입🙂한글",
                        )
                        .unwrap();
                    }
                    _ => {
                        d.insert_cell_hyperlink_by_path(
                            0,
                            parent,
                            &path,
                            0,
                            0,
                            "https://long.invalid",
                            &long,
                        )
                        .unwrap();
                    }
                }
                let changed = target(&d, parent, &path);
                if op < 4 {
                    assert_eq!(changed.text, original.text);
                    assert_eq!(
                        (0..original.text.chars().count())
                            .map(|i| changed.char_shape_id_at(i))
                            .collect::<Vec<_>>(),
                        (0..original.text.chars().count())
                            .map(|i| original.char_shape_id_at(i))
                            .collect::<Vec<_>>()
                    );
                }
                assert_eq!(changed.style_id, original.style_id);
                assert_eq!(changed.para_shape_id, original.para_shape_id);
                assert_eq!(definitions, format!("{:?}", d.document().doc_info));
                assert_eq!(
                    serde_json::from_str::<Value>(&d.get_field_value_by_id(neighbor).unwrap())
                        .unwrap()["value"],
                    "값"
                );
                // Every sibling and out-of-target control/reference must remain identical.
                let mut expected = d.document().clone();
                fn restore(
                    p: &mut Paragraph,
                    path: &[(usize, usize, usize)],
                    original: &Paragraph,
                ) {
                    let (ci, c, pi) = path[0];
                    let Control::Table(t) = &mut p.controls[ci] else {
                        panic!()
                    };
                    let p = &mut t.cells[c].paragraphs[pi];
                    if path.len() == 1 {
                        *p = original.clone();
                    } else {
                        restore(p, &path[1..], original)
                    }
                }
                restore(
                    &mut expected.sections[0].paragraphs[parent],
                    &path,
                    &original,
                );
                let mut comparison = DocumentCore::new_empty();
                comparison.set_document(expected);
                let mut expected_view = view(&comparison);
                expected_view["fields"] = before["fields"].clone();
                assert_eq!(
                    expected_view, before,
                    "{depth} {merged} {label} all other cell/body/note references"
                );
                let after = view(&d);
                let redo = d.save_snapshot_native();
                d.restore_snapshot_native(snapshot).unwrap();
                assert_eq!(view(&d), before);
                d.restore_snapshot_native(redo).unwrap();
                assert_eq!(view(&d), after);
                let files = save(&d, out, &format!("{depth}-{merged}-{label}"));
                positives.push(json!({"depth":depth,"merged":merged,"op":label,"saved":files}));
            }
            for kind in [
                "empty-path",
                "wrong-parent",
                "bad-control",
                "bad-cell",
                "bad-para",
                "reversed",
                "outside",
                "overlap-field",
                "inside-note",
                "bad-axis",
                "wrong-owner",
                "unsafe-url",
                "extra-params",
                "duplicate-command",
                "ctrl-data",
                "duplicate-owner",
            ] {
                let (mut e, pa, mut path, _) = fixture(depth, merged);
                let mut link_id = None;
                if matches!(
                    kind,
                    "extra-params" | "duplicate-command" | "ctrl-data" | "duplicate-owner"
                ) {
                    let v: Value = serde_json::from_str(
                        &e.insert_cell_hyperlink_by_path(
                            0,
                            pa,
                            &path,
                            3,
                            8,
                            "https://example.invalid",
                            "",
                        )
                        .unwrap(),
                    )
                    .unwrap();
                    let id = v["fieldId"].as_u64().unwrap() as u32;
                    link_id = Some(id);
                    let p = target_mut(&mut e, pa, &path);
                    let ci = p.field_ranges.iter().find(|fr| matches!(&p.controls[fr.control_idx], Control::Field(f) if f.field_id == id)).unwrap().control_idx;
                    if kind == "ctrl-data" {
                        p.ctrl_data_records.resize(p.controls.len(), None);
                        p.ctrl_data_records[ci] = Some(vec![1, 2, 3]);
                    }
                    if kind == "duplicate-owner" {
                        if let Control::Field(f) = &mut p.controls[0] {
                            f.field_id = id;
                        }
                    }
                    if let Control::Field(f) = &mut p.controls[ci] {
                        if kind == "extra-params" {
                            f.parameters.items.push(Parameter::String {
                                name: Some("Reference".into()),
                                value: "keep".into(),
                                preserve_space: false,
                            });
                        }
                        if kind == "duplicate-command" {
                            for _ in 0..2 {
                                f.parameters.items.push(Parameter::String {
                                    name: Some("Command".into()),
                                    value: "https://keep.invalid".into(),
                                    preserve_space: false,
                                });
                            }
                        }
                    }
                }
                e.document_mut().sections[0].raw_stream = Some(vec![67, 80, 66, 75]);
                let (mut start, mut end) = (3, 8);
                let mut parent = pa;
                let mut url = "https://example.invalid";
                match kind {
                    "empty-path" => path.clear(),
                    "wrong-parent" => parent = 99,
                    "bad-control" => path[0].0 = 99,
                    "bad-cell" => path.last_mut().unwrap().1 = 99,
                    "bad-para" => path.last_mut().unwrap().2 = 99,
                    "reversed" => {
                        start = 8;
                        end = 3;
                    }
                    "outside" => end = 999,
                    "overlap-field" => start = 0,
                    "inside-note" => start = 2,
                    "bad-axis" => target_mut(&mut e, pa, &path).char_offsets[0] += 1,
                    "unsafe-url" => url = "file:///tmp/x",
                    _ => {}
                }
                let before = format!("{:?}", e.document());
                let events = e.serialize_event_log();
                let result = if let Some(id) = link_id {
                    e.remove_cell_hyperlink_by_path(0, parent, &path, id)
                } else if kind == "wrong-owner" {
                    e.remove_cell_hyperlink_by_path(0, parent, &path, 99999)
                } else {
                    e.insert_cell_hyperlink_by_path(0, parent, &path, start, end, url, "")
                };
                assert!(result.is_err(), "{kind}");
                assert_eq!(
                    before,
                    format!("{:?}", e.document()),
                    "{kind} atomic entire document/raw/dirty"
                );
                assert_eq!(events, e.serialize_event_log());
                rejects.push(json!({"depth":depth,"merged":merged,"kind":kind,"error":result.unwrap_err().to_string()}));
            }
            assert_eq!(
                baseline["sections"][0][0],
                view(&d)["sections"][0][0],
                "body notes unchanged"
            );
        }
    }
    std::fs::write(
        out.join("manifest.json"),
        serde_json::to_vec_pretty(&fixtures).unwrap(),
    )
    .unwrap();
    let proof = json!({"positive":positives.len(),"reopens":positives.len()*2+fixtures.len()*2,"snapshotUndoRedoPairs":positives.len(),"atomicRefusals":rejects.len(),"rows":positives,"refusals":rejects});
    std::fs::write(
        out.join("proof.json"),
        serde_json::to_vec_pretty(&proof).unwrap(),
    )
    .unwrap();
    println!(
        "{}",
        json!({"positive":positives.len(),"reopens":positives.len()*2+fixtures.len()*2,"atomicRefusals":rejects.len()})
    );
}

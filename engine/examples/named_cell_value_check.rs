//! Named-cell whole-paragraph contract, distinct field ownership, atomic refusal.
#[path = "common/nested_cells.rs"]
mod nested_cells;
use nested_cells::{fixture, table_mut};
use rhwp::{
    document_core::DocumentCore,
    model::{
        control::{Control, UnknownControl},
        paragraph::{Paragraph, RangeTag},
    },
};
use serde_json::{json, Value};
use std::path::Path;

fn fields(d: &DocumentCore) -> Value {
    serde_json::from_str(&d.get_field_list_json()).unwrap()
}
fn clear_names(ps: &mut [Paragraph]) {
    for p in ps {
        for c in &mut p.controls {
            if let Control::Table(t) = c {
                for c in &mut t.cells {
                    c.field_name = None;
                    clear_names(&mut c.paragraphs);
                }
            }
        }
    }
}
fn para_view(p: &Paragraph) -> Value {
    json!({"text":p.text,"style":p.style_id,"para":p.para_shape_id,
        "chars":(0..p.text.chars().count()).map(|i|p.char_shape_id_at(i)).collect::<Vec<_>>(),
        "positions":p.control_text_positions(),"ranges":p.field_ranges,"tags":p.range_tags,
        "controls":p.controls.iter().map(|c|match c {
            Control::Table(t)=>json!({"table":t.cells.iter().map(|c|json!({"name":c.field_name,"geometry":[c.row,c.col,c.row_span,c.col_span,c.width,c.height],"border":c.border_fill_id,"paras":c.paragraphs.iter().map(para_view).collect::<Vec<_>>()})).collect::<Vec<_>>() }),
            Control::Footnote(n)=>json!({"note":n.number,"paras":n.paragraphs.iter().map(para_view).collect::<Vec<_>>()}),
            Control::Field(f)=>json!({"field":f.field_id,"name":f.field_name(),"command":f.command}),
            Control::Unknown(u)=>json!({"unknown":u.ctrl_id}),
            _=>json!({"kind":format!("{c:?}").split(['(','{']).next()})
        }).collect::<Vec<_>>()})
}
fn view(d: &DocumentCore) -> Value {
    json!({"sections":d.document().sections.iter().map(|s|s.paragraphs.iter().map(para_view).collect::<Vec<_>>()).collect::<Vec<_>>(),"fields":fields(d)})
}
fn target<'a>(
    d: &'a mut DocumentCore,
    parent: usize,
    path: &[(usize, usize, usize)],
    cell: usize,
    para: usize,
) -> &'a mut Paragraph {
    &mut table_mut(&mut d.document_mut().sections[0].paragraphs[parent], path).cells[cell]
        .paragraphs[para]
}
fn prepare(depth: usize, merged: bool) -> (DocumentCore, usize, Vec<(usize, usize, usize)>) {
    let (mut d, parent, path) = fixture(depth, merged);
    clear_names(&mut d.document_mut().sections[0].paragraphs);
    let t = table_mut(&mut d.document_mut().sections[0].paragraphs[parent], &path);
    t.cells[0].field_name = Some("target".into());
    t.cells[1].field_name = Some("neighbor".into());
    t.cells[0].paragraphs[0].style_id = 1;
    t.cells[1].paragraphs[0].style_id = 2;
    // Keep a body footnote and a separate later cell paragraph containing a note.
    let r: Value = serde_json::from_str(&d.insert_footnote_native(0, 0, 1).unwrap()).unwrap();
    let ci = r["controlIdx"].as_u64().unwrap() as usize;
    d.insert_text_in_footnote_native(0, 0, ci, 0, 2, "보존🙂각주")
        .unwrap();
    let note = d.document().sections[0].paragraphs[0].controls[ci].clone();
    let p = target(&mut d, parent, &path, 0, 1);
    p.text = "앞🙂뒤".into();
    p.style_id = 14;
    p.char_offsets = vec![0, 1, 11];
    p.char_count = 13;
    p.controls = vec![note];
    p.ctrl_data_records = vec![None];
    p.field_ranges.clear();
    p.line_segs.clear();
    // Canonicalize the known blank fill defaults before testing any mutation.
    let bytes = d.export_hwpx_native().unwrap();
    d = DocumentCore::from_bytes(&bytes).unwrap();
    (d, parent, path)
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
fn main() {
    if std::env::args().nth(1).as_deref() == Some("--verify-ui") {
        let rows: Vec<Value> = serde_json::from_slice(&std::fs::read(std::env::args().nth(2).unwrap()).unwrap()).unwrap();
        for row in &rows {
            let mut expected = DocumentCore::from_bytes(&std::fs::read(row["input"].as_str().unwrap()).unwrap()).unwrap();
            let name = if row.get("innerValue").is_some() {"inner"} else {"target"};
            let value = row.get("innerValue").unwrap_or(&row["value"]).as_str().unwrap();
            expected.set_field_value_by_name(name,value).unwrap();
            let saved = DocumentCore::from_bytes(&std::fs::read(row["file"].as_str().unwrap()).unwrap()).unwrap();
            assert_eq!(view(&saved),view(&expected),"{}: all paragraphs, cell notes, field owners and shape references",row["file"]);
        }
        println!("{}",json!({"uiSavedFilesVerified":rows.len(),"fullRecursiveSemanticTree":true}));
        return;
    }
    let out_arg = std::env::args().nth(1).unwrap();
    let out = Path::new(&out_arg);
    std::fs::create_dir_all(out).unwrap();
    let mut positives = Vec::new();
    let mut rejects = Vec::new();
    let mut manifest = Vec::new();
    for depth in 1..=3 {
        for merged in [false, true] {
            let (base, parent, path) = prepare(depth, merged);
            for (i, value) in ["새🙂𐐀값", "", "短🙂"].iter().enumerate() {
                let mut d = DocumentCore::from_bytes(&base.export_hwpx_native().unwrap()).unwrap();
                let before = view(&d);
                let definitions = format!("{:?}", d.document().doc_info);
                let old = target(&mut d, parent, &path, 0, 0).clone();
                let snapshot = d.save_snapshot_native();
                let result: Value =
                    serde_json::from_str(&if i % 2 == 0 {
                        d.set_field_value_by_name("target", value).unwrap()
                    } else {
                        d.set_field_value_by_id(0, value).unwrap()
                    })
                        .unwrap();
                assert_eq!(result["oldValue"], old.text);
                assert_eq!(result["newValue"], *value);
                let changed = target(&mut d, parent, &path, 0, 0).clone();
                assert_eq!(changed.text, *value);
                assert_eq!(changed.style_id, old.style_id);
                assert_eq!(changed.para_shape_id, old.para_shape_id);
                assert!(changed.char_shapes.iter().all(|s| old
                    .char_shapes
                    .iter()
                    .any(|o| s.char_shape_id == o.char_shape_id)));
                assert_eq!(format!("{:?}", d.document().doc_info), definitions);
                // Compare every other paragraph/reference exactly in the public semantic tree.
                let after = view(&d);
                *target(&mut d, parent, &path, 0, 0) = old;
                assert_eq!(view(&d), before);
                *target(&mut d, parent, &path, 0, 0) = changed;
                let redo = d.save_snapshot_native();
                d.restore_snapshot_native(snapshot).unwrap();
                assert_eq!(view(&d), before);
                d.restore_snapshot_native(redo).unwrap();
                assert_eq!(view(&d), after);
                let label = format!("normal-d{depth}-m{merged}-{i}");
                let saved = save(&d, out, &label);
                positives.push(json!({"kind":"normal","depth":depth,"merged":merged,"value":value,"reopens":saved.len()}));
                if i == 0 {
                    for ext in ["hwp", "hwpx"] {
                        let file = out.join(format!("input-d{depth}-m{merged}.{ext}"));
                        let b = if ext == "hwp" {
                            base.export_hwp_native().unwrap()
                        } else {
                            base.export_hwpx_native().unwrap()
                        };
                        std::fs::write(&file, b).unwrap();
                        manifest.push(json!({"kind":"normal","file":file,"parent":parent,"path":path,"depth":depth,"merged":merged}));
                    }
                }
            }
            for kind in [
                "inner-field",
                "same-name-inner",
                "first-note",
                "unknown",
                "bad-axis",
                "range-reference",
                "empty-paragraphs",
                "duplicate-cell-name",
                "inner-target",
            ] {
                let (mut d, parent, path) = prepare(depth, merged);
                let mut selected = "target";
                match kind {
                    "inner-field" | "same-name-inner" | "inner-target" => {
                        let inner = if kind == "same-name-inner" {
                            "target"
                        } else {
                            "inner"
                        };
                        d.insert_click_here_field_at_by_path(
                            0, parent, &path, 1, "guide", "memo", inner, true,
                        )
                        .unwrap();
                        if kind == "inner-target" {
                            selected = "inner";
                        }
                    }
                    "first-note" => {
                        let p = target(&mut d, parent, &path, 0, 1).clone();
                        *target(&mut d, parent, &path, 0, 0) = p;
                    }
                    "unknown" => {
                        let p = target(&mut d, parent, &path, 0, 0);
                        p.controls = vec![Control::Unknown(UnknownControl {
                            ctrl_id: 0x78787878,
                        })];
                        p.ctrl_data_records = vec![None];
                        for v in &mut p.char_offsets {
                            *v += 8;
                        }
                        p.char_count += 8;
                    }
                    "bad-axis" => target(&mut d, parent, &path, 0, 0).char_offsets[0] += 1,
                    "range-reference" => {
                        target(&mut d, parent, &path, 0, 0)
                            .range_tags
                            .push(RangeTag {
                                start: 0,
                                end: 1,
                                tag: 0x01000001,
                            })
                    }
                    "empty-paragraphs" => {
                        table_mut(&mut d.document_mut().sections[0].paragraphs[parent], &path).cells
                            [0]
                        .paragraphs
                        .clear()
                    }
                    "duplicate-cell-name" => {
                        table_mut(&mut d.document_mut().sections[0].paragraphs[parent], &path)
                            .cells[1]
                            .field_name = Some("target".into())
                    }
                    _ => unreachable!(),
                }
                if matches!(kind, "duplicate-cell-name" | "inner-target") {
                    let before = view(&d);
                    let snapshot = d.save_snapshot_native();
                    if kind == "duplicate-cell-name" {
                        d.set_field_value_by_name_at("target", 1, "다른🙂").unwrap();
                        assert_ne!(view(&d), before);
                        assert_eq!(
                            target(&mut d, parent, &path, 0, 0).text,
                            before["fields"][0]["value"].as_str().unwrap()
                        );
                    } else {
                        d.set_field_value_by_name(selected, "내부🙂").unwrap();
                        assert_eq!(fields(&d)[1]["value"], "내부🙂");
                    }
                    let after = view(&d);
                    let redo = d.save_snapshot_native();
                    d.restore_snapshot_native(snapshot).unwrap();
                    assert_eq!(view(&d), before);
                    d.restore_snapshot_native(redo).unwrap();
                    assert_eq!(view(&d), after);
                    let saved = save(&d, out, &format!("{kind}-d{depth}-m{merged}"));
                    positives.push(
                        json!({"kind":kind,"depth":depth,"merged":merged,"reopens":saved.len()}),
                    );
                    continue;
                }
                // Serialize supported complex fixtures before adding a raw-stream sentinel.
                if matches!(
                    kind,
                    "inner-field" | "same-name-inner" | "first-note" | "unknown"
                ) {
                    for ext in if kind == "unknown" {
                        vec!["hwp"]
                    } else {
                        vec!["hwp", "hwpx"]
                    } {
                        let file = out.join(format!("{kind}-d{depth}-m{merged}.{ext}"));
                        let b = if ext == "hwp" {
                            d.export_hwp_native().unwrap()
                        } else {
                            d.export_hwpx_native().unwrap()
                        };
                        std::fs::write(&file, b).unwrap();
                        manifest.push(json!({"kind":kind,"file":file,"parent":parent,"path":path,"depth":depth,"merged":merged}));
                    }
                }
                for value in ["新🙂𐐀", ""] {
                    d.document_mut().sections[0].raw_stream = Some(vec![0x43, 0x50, 0x42, 0x4b]);
                    let before = format!("{:?}", d.document());
                    let events = d.serialize_event_log();
                    assert!(
                        d.set_field_value_by_name(selected, value).is_err(),
                        "{kind}"
                    );
                    assert_eq!(
                        format!("{:?}", d.document()),
                        before,
                        "{kind} entire document"
                    );
                    assert_eq!(d.serialize_event_log(), events);
                    assert!(d.set_field_value_by_id(0, value).is_err(), "{kind} by ID");
                    assert_eq!(format!("{:?}", d.document()), before);
                    assert_eq!(d.serialize_event_log(), events);
                    rejects.push(json!({"kind":kind,"depth":depth,"merged":merged,"value":value,"wholeDocumentAndEventsUnchanged":true}));
                }
                if kind == "same-name-inner" {
                    d.document_mut().sections[0].raw_stream = None;
                    let before=view(&d);let snapshot=d.save_snapshot_native();
                    d.set_field_value_by_name_at("target",1,"순번🙂").unwrap();
                    assert_eq!(fields(&d)[1]["value"],"순번🙂");
                    let after=view(&d);let redo=d.save_snapshot_native();d.restore_snapshot_native(snapshot).unwrap();assert_eq!(view(&d),before);d.restore_snapshot_native(redo).unwrap();assert_eq!(view(&d),after);
                    let saved=save(&d,out,&format!("same-name-occurrence-d{depth}-m{merged}"));positives.push(json!({"kind":"same-name-occurrence","depth":depth,"merged":merged,"reopens":saved.len()}));
                }
            }
        }
    }
    // Synthetic IDs repeat between tables; name + occurrence retains its old contract.
    let (mut d, parent, _path) = prepare(2, false);
    let table_paragraph = d.document().sections[0].paragraphs[parent].clone();
    d.document_mut().sections[0].paragraphs.push(table_paragraph);
    let before = format!("{:?}", d.document());
    let events = d.serialize_event_log();
    assert!(d.set_field_value_by_id(0, "wrong").is_err());
    assert_eq!(format!("{:?}", d.document()), before);
    assert_eq!(d.serialize_event_log(),events);
    rejects.push(json!({"kind":"duplicate-id","wholeDocumentAndEventsUnchanged":true}));
    std::fs::write(
        out.join("manifest.json"),
        serde_json::to_vec_pretty(&manifest).unwrap(),
    )
    .unwrap();
    let proof = json!({"positives":positives,"rejects":rejects,"GUIVerified":false,"physicalIMEVerified":false,"manifest":manifest.len()});
    std::fs::write(
        out.join("proof.json"),
        serde_json::to_vec_pretty(&proof).unwrap(),
    )
    .unwrap();
    println!(
        "{}",
        json!({"normalAndSelectionCases":proof["positives"].as_array().unwrap().len(),"atomicRejections":proof["rejects"].as_array().unwrap().len(),"fixtures":manifest.len()})
    );
}

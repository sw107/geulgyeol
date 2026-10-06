use rhwp::{
    document_core::DocumentCore,
    model::{
        control::{Control, Ruby, UnknownControl},
        header_footer::MasterPage,
        paragraph::{CharShapeRef, Paragraph},
        shape::{Caption, ShapeObject, TextBox},
    },
};
use serde_json::{json, Value};
fn idx(s: &str, k: &str) -> usize {
    serde_json::from_str::<Value>(s).unwrap()[k]
        .as_u64()
        .unwrap() as usize
}
fn collect(p: &Paragraph, d: &DocumentCore, out: &mut Vec<Value>) {
    let style = &d.document().doc_info.styles[p.style_id as usize];
    out.push(json!({"text":p.text,"style":style.local_name,"para":p.para_shape_id,"chars":p.char_shapes.iter().map(|c|json!([c.start_pos,c.char_shape_id])).collect::<Vec<_>>() }));
    for c in &p.controls {
        match c {
            Control::Table(t) => {
                for c in &t.cells {
                    for p in &c.paragraphs {
                        collect(p, d, out);
                    }
                }
                if let Some(c) = &t.caption {
                    for p in &c.paragraphs {
                        collect(p, d, out);
                    }
                }
            }
            Control::Header(h) => {
                for p in &h.paragraphs {
                    collect(p, d, out)
                }
            }
            Control::Footer(h) => {
                for p in &h.paragraphs {
                    collect(p, d, out)
                }
            }
            Control::Footnote(h) => {
                for p in &h.paragraphs {
                    collect(p, d, out)
                }
            }
            Control::Endnote(h) => {
                for p in &h.paragraphs {
                    collect(p, d, out)
                }
            }
            Control::HiddenComment(h) => {
                for p in &h.paragraphs {
                    collect(p, d, out)
                }
            }
            Control::Field(h) => {
                for p in &h.memo_paragraphs {
                    collect(p, d, out)
                }
            }
            Control::Shape(s) => {
                if let Some(a) = s.drawing() {
                    if let Some(t) = &a.text_box {
                        for p in &t.paragraphs {
                            collect(p, d, out);
                        }
                    }
                    if let Some(c) = &a.caption {
                        for p in &c.paragraphs {
                            collect(p, d, out);
                        }
                    }
                }
            }
            Control::SectionDef(s) => {
                for m in &s.master_pages {
                    for p in &m.paragraphs {
                        collect(p, d, out)
                    }
                }
            }
            _ => {}
        }
    }
}
fn semantic(d: &DocumentCore) -> Value {
    let mut ps = vec![];
    for s in &d.document().sections {
        for p in &s.paragraphs {
            collect(p, d, &mut ps);
        }
        for m in &s.section_def.master_pages {
            for p in &m.paragraphs {
                collect(p, d, &mut ps);
            }
        }
    }
    let styles: Vec<_> = d
        .document()
        .doc_info
        .styles
        .iter()
        .map(|s| {
            json!([
                s.local_name,
                s.english_name,
                s.char_shape_id,
                s.para_shape_id,
                d.document().doc_info.styles[s.next_style_id as usize].local_name
            ])
        })
        .collect();
    json!({"paragraphs":ps,"styles":styles})
}
fn fixture(kind: usize) -> (DocumentCore, usize) {
    let mut d = DocumentCore::new_empty();
    d.create_blank_document_native().unwrap();
    let table = d.create_table_native(0, 0, 0, 2, 2).unwrap();
    let p = idx(&table, "paraIdx");
    let t = idx(&table, "controlIdx");
    for c in 0..4 {
        d.insert_text_in_cell_native(0, p, t, c, 0, 0, &format!("셀{c} 스타일😀"))
            .unwrap();
    }
    d.insert_text_native(0, p + 1, 0, "본문 하나 둘").unwrap();
    d.split_paragraph_native(0, p + 1, 5, None).unwrap();
    let sid = d.document().doc_info.styles.len();
    let mut a = d.document().doc_info.styles[0].clone();
    a.local_name = "Deleted A".into();
    a.english_name = "DeleteA".into();
    a.raw_data = None;
    let mut b = a.clone();
    b.local_name = "Survivor B".into();
    b.english_name = "KeepB".into();
    b.next_style_id = sid as u8;
    let mut c = b.clone();
    c.local_name = "Survivor C".into();
    c.english_name = "KeepC".into();
    c.next_style_id = (sid + 1) as u8;
    let mut cs = d.document().doc_info.char_shapes[a.char_shape_id as usize].clone();
    cs.bold = true;
    cs.base_size = 1400;
    cs.raw_data = None;
    a.char_shape_id = d.document().doc_info.char_shapes.len() as u16;
    d.document_mut().doc_info.char_shapes.push(cs);
    d.document_mut().doc_info.styles.extend([a, b, c]);
    d.document_mut().doc_info.raw_stream_dirty = true;
    d.apply_style_native(0, p + 1, sid).unwrap();
    d.apply_style_native(0, p + 2, sid + 1).unwrap();
    for (cell, style) in [(0, sid), (1, sid), (2, sid + 1), (3, sid + 2)] {
        d.apply_cell_style_native(0, p, t, cell, 0, style).unwrap();
    }
    let prototype = match &d.document().sections[0].paragraphs[p].controls[t] {
        Control::Table(t) => t.cells[0].paragraphs[0].clone(),
        _ => panic!(),
    };
    match kind {
        0 => {}
        1 => {
            let nested = match &d.document().sections[0].paragraphs[p].controls[t] {
                Control::Table(t) => t.clone(),
                _ => panic!(),
            };
            if let Control::Table(outer) =
                &mut d.document_mut().sections[0].paragraphs[p].controls[t]
            {
                let cp = &mut outer.cells[1].paragraphs[0];
                cp.controls.push(Control::Table(nested));
                cp.char_count += 8;
                cp.align_ctrl_data_records();
            }
        }
        2 | 3 => {
            d.create_header_footer_native(0, kind == 2, 0).unwrap();
            for p in &mut d.document_mut().sections[0].paragraphs {
                for c in &mut p.controls {
                    match c {
                        Control::Header(h) => h.paragraphs = vec![prototype.clone()],
                        Control::Footer(h) => h.paragraphs = vec![prototype.clone()],
                        _ => {}
                    }
                }
            }
        }
        4 | 5 => {
            if kind == 4 {
                d.insert_footnote_native(0, p + 1, 0).unwrap();
            } else {
                d.insert_endnote_native(0, p + 1, 0).unwrap();
            }
            for p in &mut d.document_mut().sections[0].paragraphs {
                for c in &mut p.controls {
                    match c {
                        Control::Footnote(h) => h.paragraphs = vec![prototype.clone()],
                        Control::Endnote(h) => h.paragraphs = vec![prototype.clone()],
                        _ => {}
                    }
                }
            }
        }
        6 | 7 => {
            let r = d
                .create_shape_control_native(
                    0,
                    p + 1,
                    0,
                    8000,
                    4000,
                    0,
                    0,
                    false,
                    "TopAndBottom",
                    "rectangle",
                    false,
                    false,
                    &[],
                )
                .unwrap();
            let pi = idx(&r, "paraIdx");
            let ci = idx(&r, "controlIdx");
            if let Control::Shape(s) = &mut d.document_mut().sections[0].paragraphs[pi].controls[ci]
            {
                let drawing = s.drawing_mut().unwrap();
                if kind == 6 {
                    drawing.text_box = Some(TextBox {
                        paragraphs: vec![prototype],
                        ..Default::default()
                    });
                } else {
                    drawing.caption = Some(Caption {
                        paragraphs: vec![prototype],
                        width: 8000,
                        ..Default::default()
                    });
                }
            }
        }
        8 => {
            d.document_mut().sections[0]
                .section_def
                .master_pages
                .push(MasterPage {
                    paragraphs: vec![prototype],
                    ..Default::default()
                });
        }
        _ => unreachable!(),
    }
    (d, sid)
}
fn reject(d: &mut DocumentCore, sid: usize, label: &str) {
    let before = format!("{:?}", d.document());
    assert!(
        d.delete_style_preserving_format_native(sid).is_err(),
        "{label}"
    );
    assert_eq!(format!("{:?}", d.document()), before, "atomic {label}");
}
fn main() {
    let out = std::env::args().nth(1).expect("OUTPUT_DIR");
    std::fs::create_dir_all(&out).unwrap();
    let (mut cases, mut reopens, mut rejects) = (0, 0, 0);
    for kind in 0..8 {
        for source in ["hwp", "hwpx"] {
            let (d, sid) = fixture(kind);
            let input = if source == "hwp" {
                d.export_hwp_with_adapter_snapshot().unwrap()
            } else {
                d.export_hwpx_native().unwrap()
            };
            let mut d = DocumentCore::from_bytes(&input).unwrap();
            let before = semantic(&d);
            let undo = d.save_snapshot_native();
            let report = d.delete_style_preserving_format_native(sid).unwrap();
            let after = semantic(&d);
            let redo = d.save_snapshot_native();
            assert_eq!(
                before["paragraphs"].as_array().unwrap().len(),
                after["paragraphs"].as_array().unwrap().len(),
                "scopes kind{kind}"
            );
            let base = d.document().doc_info.styles[0].local_name.clone();
            for (a, b) in before["paragraphs"]
                .as_array()
                .unwrap()
                .iter()
                .zip(after["paragraphs"].as_array().unwrap())
            {
                assert_eq!(a["text"], b["text"]);
                assert_eq!(a["chars"], b["chars"]);
                assert_eq!(a["para"], b["para"]);
                assert_eq!(
                    b["style"],
                    if a["style"] == "Deleted A" {
                        json!(base)
                    } else {
                        a["style"].clone()
                    }
                );
            }
            assert!(!after["styles"]
                .as_array()
                .unwrap()
                .iter()
                .any(|s| s[0] == "Deleted A"));
            assert_eq!(
                after["styles"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .find(|s| s[0] == "Survivor B")
                    .unwrap()[4],
                base
            );
            assert_eq!(
                after["styles"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .find(|s| s[0] == "Survivor C")
                    .unwrap()[4],
                "Survivor B"
            );
            d.restore_snapshot_native(undo).unwrap();
            assert_eq!(semantic(&d), before);
            d.restore_snapshot_native(redo).unwrap();
            assert_eq!(semantic(&d), after);
            for (format, bytes) in [
                ("hwp", d.export_hwp_with_adapter_snapshot().unwrap()),
                ("hwpx", d.export_hwpx_native().unwrap()),
            ] {
                let r = DocumentCore::from_bytes(&bytes).unwrap();
                assert_eq!(semantic(&r), after, "{source}->{format} kind{kind}");
                if kind == 0 && source == "hwp" {
                    std::fs::write(format!("{out}/style-deleted.{format}"), bytes).unwrap();
                }
                reopens += 1;
            }
            println!("PASS kind{kind} source{source} {report}");
            cases += 1;
        }
    }
    let (mut d, sid) = fixture(0);
    std::fs::write(
        format!("{out}/style-before-delete.hwpx"),
        d.export_hwpx_native().unwrap(),
    )
    .unwrap();
    for bad in [0, 999] {
        reject(&mut d, bad, "bad style ID");
        rejects += 1;
    }
    let (mut d, sid) = fixture(0);
    d.document_mut().sections[0].paragraphs[0].style_id = 255;
    reject(&mut d, sid, "bad body reference");
    rejects += 1;
    let (mut d, sid) = fixture(0);
    let table = d.document_mut().sections[0]
        .paragraphs
        .iter_mut()
        .flat_map(|p| &mut p.controls)
        .find_map(|c| {
            if let Control::Table(t) = c {
                Some(t)
            } else {
                None
            }
        })
        .unwrap();
    table.cells[0].paragraphs[0].style_id = 255;
    reject(&mut d, sid, "bad nested reference");
    rejects += 1;
    let (mut d, sid) = fixture(0);
    d.document_mut().doc_info.styles[0].next_style_id = 255;
    reject(&mut d, sid, "bad next style");
    rejects += 1;
    let (mut d, sid) = fixture(0);
    d.document_mut().sections[0].paragraphs[0]
        .controls
        .push(Control::Unknown(UnknownControl { ctrl_id: 123 }));
    reject(&mut d, sid, "unknown control");
    rejects += 1;
    let (mut d, sid) = fixture(0);
    d.document_mut().sections[0].paragraphs[0]
        .controls
        .push(Control::Ruby(Ruby {
            style_id_ref: sid as u16,
            ..Default::default()
        }));
    reject(&mut d, sid, "ruby needs deleted style");
    rejects += 1;
    let (mut d, sid) = fixture(0);
    d.document_mut().sections[0].paragraphs[0]
        .controls
        .push(Control::Ruby(Ruby {
            style_id_ref: (sid + 1) as u16,
            ..Default::default()
        }));
    d.delete_style_preserving_format_native(sid).unwrap();
    assert!(
        matches!(&d.document().sections[0].paragraphs[0].controls.last().unwrap(),Control::Ruby(r)if r.style_id_ref==sid as u16)
    );
    let (mut master, sid) = fixture(8);
    reject(
        &mut master,
        sid,
        "master page requires raw record preservation",
    );
    rejects += 1;
    let (mut d, sid) = fixture(0);
    d.document_mut().doc_info.styles[sid].char_shape_id = 65535;
    reject(&mut d, sid, "bad style shape reference");
    rejects += 1;
    let (mut d, sid) = fixture(0);
    d.document_mut().sections[0]
        .section_def
        .extra_child_records
        .push(rhwp::model::document::RawRecord {
            tag_id: rhwp::parser::tags::HWPTAG_PARA_HEADER,
            ..Default::default()
        });
    reject(&mut d, sid, "opaque paragraph reference");
    rejects += 1;
    let (mut d, sid) = fixture(0);
    d.document_mut()
        .doc_info
        .extra_records
        .push(rhwp::model::document::RawRecord {
            tag_id: rhwp::parser::tags::HWPTAG_STYLE,
            ..Default::default()
        });
    reject(&mut d, sid, "opaque style record");
    rejects += 1;
    let proof = json!({"cases":cases,"snapshot_undo_redo_cases":cases,"two_format_reopens":reopens,"atomic_rejections":rejects,"nested_style_references_preserved":true,"physical_IME_verified":false,"native_GUI_verified":false});
    std::fs::write(
        format!("{out}/native-style-proof.json"),
        serde_json::to_vec_pretty(&proof).unwrap(),
    )
    .unwrap();
    println!("{proof}");
}

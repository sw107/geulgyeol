//! Paragraph-end Enter is explicit; split/paste/merge-undo preserve inherited styles.
use rhwp::{
    document_core::DocumentCore,
    error::HwpError,
    model::{
        control::Control,
        document::RawRecord,
        paragraph::{CharShapeRef, ParaMeta, Paragraph},
        shape::{Caption, ShapeObject, TextBox},
    },
};
use serde_json::{json, Value};
#[derive(Clone, Copy, Debug)]
enum Location {
    Body,
    Caption(usize, usize),
    Cell(usize, usize, bool),
    Hf(usize, usize, bool),
    Note(usize, usize),
    Text(usize, usize, bool),
}
fn idx(s: &str, k: &str) -> usize {
    serde_json::from_str::<Value>(s).unwrap()[k]
        .as_u64()
        .unwrap() as usize
}
fn paragraphs(d: &DocumentCore, l: Location) -> &[Paragraph] {
    match l {
        Location::Body => &d.document().sections[0].paragraphs,
        Location::Caption(pi, ci) => {
            let Control::Table(t) = &d.document().sections[0].paragraphs[pi].controls[ci] else {
                panic!()
            };
            &t.caption.as_ref().unwrap().paragraphs
        }
        Location::Cell(pi, ci, nested) => {
            let Control::Table(t) = &d.document().sections[0].paragraphs[pi].controls[ci] else {
                panic!()
            };
            if nested {
                let Control::Table(t) = &t.cells[0].paragraphs[0].controls[0] else {
                    panic!()
                };
                &t.cells[0].paragraphs
            } else {
                &t.cells[0].paragraphs
            }
        }
        Location::Hf(pi, ci, _) => match &d.document().sections[0].paragraphs[pi].controls[ci] {
            Control::Header(h) => &h.paragraphs,
            Control::Footer(h) => &h.paragraphs,
            _ => panic!(),
        },
        Location::Note(pi, ci) => match &d.document().sections[0].paragraphs[pi].controls[ci] {
            Control::Footnote(h) => &h.paragraphs,
            Control::Endnote(h) => &h.paragraphs,
            _ => panic!(),
        },
        Location::Text(pi, ci, caption) => {
            let Control::Shape(s) = &d.document().sections[0].paragraphs[pi].controls[ci] else {
                panic!()
            };
            let drawing = s.drawing().unwrap();
            if caption {
                &drawing.caption.as_ref().unwrap().paragraphs
            } else {
                &drawing.text_box.as_ref().unwrap().paragraphs
            }
        }
    }
}
fn paragraphs_mut(d: &mut DocumentCore, l: Location) -> &mut [Paragraph] {
    match l {
        Location::Body => &mut d.document_mut().sections[0].paragraphs,
        Location::Caption(pi, ci) => {
            let Control::Table(t) = &mut d.document_mut().sections[0].paragraphs[pi].controls[ci]
            else {
                panic!()
            };
            &mut t.caption.as_mut().unwrap().paragraphs
        }
        Location::Cell(pi, ci, nested) => {
            let Control::Table(t) = &mut d.document_mut().sections[0].paragraphs[pi].controls[ci]
            else {
                panic!()
            };
            if nested {
                let Control::Table(t) = &mut t.cells[0].paragraphs[0].controls[0] else {
                    panic!()
                };
                &mut t.cells[0].paragraphs
            } else {
                &mut t.cells[0].paragraphs
            }
        }
        Location::Hf(pi, ci, _) => {
            match &mut d.document_mut().sections[0].paragraphs[pi].controls[ci] {
                Control::Header(h) => &mut h.paragraphs,
                Control::Footer(h) => &mut h.paragraphs,
                _ => panic!(),
            }
        }
        Location::Note(pi, ci) => {
            match &mut d.document_mut().sections[0].paragraphs[pi].controls[ci] {
                Control::Footnote(h) => &mut h.paragraphs,
                Control::Endnote(h) => &mut h.paragraphs,
                _ => panic!(),
            }
        }
        Location::Text(pi, ci, caption) => {
            let Control::Shape(s) = &mut d.document_mut().sections[0].paragraphs[pi].controls[ci]
            else {
                panic!()
            };
            let drawing = s.drawing_mut().unwrap();
            if caption {
                &mut drawing.caption.as_mut().unwrap().paragraphs
            } else {
                &mut drawing.text_box.as_mut().unwrap().paragraphs
            }
        }
    }
}
fn fixture(kind: usize, direct: u8) -> (DocumentCore, Location, u8, u8, u16, u16, u16, u16) {
    let mut d = DocumentCore::new_empty();
    d.create_blank_document_native().unwrap();
    let a = d.create_style_native("{\"name\":\"Title A\"}").unwrap() as u8;
    let mut cs = d.document().doc_info.char_shapes[0].clone();
    cs.base_size = 2100;
    cs.italic = true;
    cs.raw_data = None;
    let bc = d.document().doc_info.char_shapes.len() as u16;
    d.document_mut().doc_info.char_shapes.push(cs);
    let mut ps = d.document().doc_info.para_shapes[0].clone();
    ps.margin_left = 820;
    ps.spacing_before = 280;
    ps.raw_data = None;
    let bp = d.document().doc_info.para_shapes.len() as u16;
    d.document_mut().doc_info.para_shapes.push(ps);
    let b = d
        .create_style_native(
            &json!({"name":"Body B","baseCharShapeId":bc,"baseParaShapeId":bp}).to_string(),
        )
        .unwrap() as u8;
    d.update_style_metadata_native(a as usize, &json!({"nextStyleId":b}).to_string())
        .unwrap();
    d.update_style_metadata_native(b as usize, &json!({"nextStyleId":b}).to_string())
        .unwrap();
    d.insert_text_native(0, 0, 0, "문단😀 끝").unwrap();
    d.apply_style_native(0, 0, a as usize).unwrap();
    if direct & 1 != 0 {
        d.apply_char_format_native(0, 0, 0, 5, "{\"bold\":true,\"fontSize\":1600}")
            .unwrap();
    }
    if direct & 2 != 0 {
        d.apply_para_format_native(0, 0, "{\"marginLeft\":730}")
            .unwrap();
    }
    if direct & 1 != 0 {
        let direct_id = (d.document().doc_info.char_shapes.len() - 1) as u32;
        assert!(d.document().doc_info.char_shapes[direct_id as usize].bold);
        d.document_mut().sections[0].paragraphs[0].char_shapes = vec![CharShapeRef {
            start_pos: 0,
            char_shape_id: direct_id,
        }];
    }
    let p = &d.document().sections[0].paragraphs[0];
    let (ac, ap) = (p.char_shapes[0].char_shape_id as u16, p.para_shape_id);
    let mut prototype = Paragraph::new_empty_like(p);
    prototype.insert_text_at(0, "문단😀 끝");
    let l = match kind {
        0 => Location::Body,
        1 | 2 => {
            let r = d.create_table_native(0, 0, 0, 1, 1).unwrap();
            let (pi, ci) = (idx(&r, "paraIdx"), idx(&r, "controlIdx"));
            let Control::Table(t) = &mut d.document_mut().sections[0].paragraphs[pi].controls[ci]
            else {
                panic!()
            };
            t.cells[0].paragraphs = vec![prototype];
            if kind == 2 {
                let nested = t.clone();
                let p = &mut t.cells[0].paragraphs[0];
                p.controls = vec![Control::Table(nested)];
                p.char_count += 8;
                p.align_ctrl_data_records();
            }
            Location::Cell(pi, ci, kind == 2)
        }
        3 | 4 => {
            d.create_header_footer_native(0, kind == 3, 0).unwrap();
            let mut found = None;
            for (pi, p) in d.document_mut().sections[0]
                .paragraphs
                .iter_mut()
                .enumerate()
            {
                for (ci, c) in p.controls.iter_mut().enumerate() {
                    match c {
                        Control::Header(h) => {
                            h.paragraphs = vec![prototype.clone()];
                            found = Some(Location::Hf(pi, ci, kind == 3))
                        }
                        Control::Footer(h) => {
                            h.paragraphs = vec![prototype.clone()];
                            found = Some(Location::Hf(pi, ci, kind == 3))
                        }
                        _ => {}
                    }
                }
            }
            found.unwrap()
        }
        5 | 6 => {
            if kind == 5 {
                d.insert_footnote_native(0, 0, 0).unwrap();
            } else {
                d.insert_endnote_native(0, 0, 0).unwrap();
            }
            let mut found = None;
            for (pi, p) in d.document_mut().sections[0]
                .paragraphs
                .iter_mut()
                .enumerate()
            {
                for (ci, c) in p.controls.iter_mut().enumerate() {
                    match c {
                        Control::Footnote(h) => {
                            h.paragraphs = vec![prototype.clone()];
                            found = Some(Location::Note(pi, ci))
                        }
                        Control::Endnote(h) => {
                            h.paragraphs = vec![prototype.clone()];
                            found = Some(Location::Note(pi, ci))
                        }
                        _ => {}
                    }
                }
            }
            found.unwrap()
        }
        8 => {
            let r = d.create_table_native(0, 0, 0, 1, 1).unwrap();
            let (pi, ci) = (idx(&r, "paraIdx"), idx(&r, "controlIdx"));
            let Control::Table(t) = &mut d.document_mut().sections[0].paragraphs[pi].controls[ci]
            else {
                panic!()
            };
            t.caption = Some(Caption {
                paragraphs: vec![prototype],
                width: 12000,
                ..Default::default()
            });
            Location::Caption(pi, ci)
        }
        7 => {
            let r = d
                .create_shape_control_native(
                    0,
                    0,
                    0,
                    12000,
                    6000,
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
            let (pi, ci) = (idx(&r, "paraIdx"), idx(&r, "controlIdx"));
            let Control::Shape(s) = &mut d.document_mut().sections[0].paragraphs[pi].controls[ci]
            else {
                panic!()
            };
            assert!(matches!(s.as_ref(), ShapeObject::Rectangle(_)));
            let drawing = s.drawing_mut().unwrap();
            if kind == 7 {
                drawing.text_box = Some(TextBox {
                    paragraphs: vec![prototype],
                    ..Default::default()
                })
            } else {
                drawing.caption = Some(Caption {
                    paragraphs: vec![prototype],
                    width: 12000,
                    ..Default::default()
                })
            }
            Location::Text(pi, ci, kind == 8)
        }
        _ => unreachable!(),
    };
    (d, l, a, b, ac, ap, bc, bp)
}
fn split(
    d: &mut DocumentCore,
    l: Location,
    off: usize,
    meta: Option<ParaMeta>,
    enter: bool,
) -> Result<String, HwpError> {
    match l {
        Location::Body => d.split_paragraph_native_with_next_style(0, 0, off, meta, enter),
        Location::Caption(pi, ci) => {
            d.split_paragraph_in_cell_native_with_next_style(0, pi, ci, 65534, 0, off, meta, enter)
        }
        Location::Cell(pi, ci, true) => d.split_paragraph_in_cell_by_path_with_next_style(
            0,
            pi,
            &[(ci, 0, 0), (0, 0, 0)],
            off,
            meta,
            enter,
        ),
        Location::Cell(pi, ci, false) => {
            d.split_paragraph_in_cell_native_with_next_style(0, pi, ci, 0, 0, off, meta, enter)
        }
        Location::Hf(_, _, header) => d.split_paragraph_in_header_footer_native_with_next_style(
            0, header, 0, 0, off, meta, enter,
        ),
        Location::Note(pi, ci) => {
            d.split_paragraph_in_footnote_native_with_next_style(0, pi, ci, 0, off, meta, enter)
        }
        Location::Text(pi, ci, caption) => d.split_paragraph_in_cell_native_with_next_style(
            0,
            pi,
            ci,
            if caption { 65534 } else { 0 },
            0,
            off,
            meta,
            enter,
        ),
    }
}
fn merge(d: &mut DocumentCore, l: Location) -> Result<String, HwpError> {
    match l {
        Location::Body => d.merge_paragraph_native(0, 1),
        Location::Cell(pi, ci, true) => {
            d.merge_paragraph_in_cell_by_path(0, pi, &[(ci, 0, 0), (0, 0, 1)])
        }
        Location::Cell(pi, ci, false) => d.merge_paragraph_in_cell_native(0, pi, ci, 0, 1),
        Location::Caption(pi, ci) => d.merge_paragraph_in_cell_native(0, pi, ci, 65534, 1),
        Location::Hf(_, _, header) => d.merge_paragraph_in_header_footer_native(0, header, 0, 1),
        Location::Note(pi, ci) => d.merge_paragraph_in_footnote_native(0, pi, ci, 1),
        Location::Text(pi, ci, _) => d.merge_paragraph_in_cell_native(0, pi, ci, 0, 1),
    }
}

fn semantic_ps(ps: &[Paragraph], out: &mut Vec<Value>) {
    for p in ps {
        out.push(json!([
            p.text,
            p.style_id,
            p.para_shape_id,
            p.char_shapes
                .iter()
                .map(|r| json!([r.start_pos, r.char_shape_id]))
                .collect::<Vec<_>>()
        ]));
        for c in &p.controls {
            match c {
                Control::Table(t) => {
                    for c in &t.cells {
                        semantic_ps(&c.paragraphs, out)
                    }
                    if let Some(c) = &t.caption {
                        semantic_ps(&c.paragraphs, out)
                    }
                }
                Control::Header(h) => semantic_ps(&h.paragraphs, out),
                Control::Footer(h) => semantic_ps(&h.paragraphs, out),
                Control::Footnote(h) => semantic_ps(&h.paragraphs, out),
                Control::Endnote(h) => semantic_ps(&h.paragraphs, out),
                Control::Shape(s) => {
                    if let Some(g) = s.drawing() {
                        if let Some(t) = &g.text_box {
                            semantic_ps(&t.paragraphs, out)
                        }
                        if let Some(t) = &g.caption {
                            semantic_ps(&t.paragraphs, out)
                        }
                    }
                }
                _ => {}
            }
        }
    }
}
fn semantic(d: &DocumentCore) -> Value {
    let mut out = vec![];
    for s in &d.document().sections {
        semantic_ps(&s.paragraphs, &mut out)
    }
    json!(out)
}
fn main() {
    let out = std::env::args()
        .skip(1)
        .find(|a| !a.starts_with("--"))
        .expect("OUTPUT_DIR");
    std::fs::create_dir_all(&out).unwrap();
    let baseline = std::env::args().any(|a| a == "--baseline");
    let (mut cases, mut reopens, mut history, mut rejects) = (0, 0, 0, 0);
    let mut observations = vec![];
    for kind in 0..9 {
        for direct in 0..4 {
            for mode in 0..4 {
                let (mut d, l, a, b, ac, ap, bc, bp) = fixture(kind, direct);
                let before = semantic(&d);
                let source = paragraphs(&d, l)[0].clone();
                let len = source.text.chars().count();
                let undo = d.save_snapshot_native();
                let off = if mode == 1 { 2 } else { len };
                let meta = if mode == 3 {
                    Some(source.capture_meta())
                } else {
                    None
                };
                split(&mut d, l, off, meta, !baseline && mode != 2)
                    .unwrap_or_else(|e| panic!("scope={kind} direct={direct} mode={mode}: {e}"));
                let p = &paragraphs(&d, l)[1];
                let transition = !baseline && mode == 0;
                assert_eq!(
                    p.style_id,
                    if transition { b } else { a },
                    "kind={kind} direct={direct} mode={mode}"
                );
                assert_eq!(
                    p.para_shape_id,
                    if transition && direct & 2 == 0 {
                        bp
                    } else {
                        ap
                    }
                );
                assert_eq!(
                    p.char_shapes[0].char_shape_id,
                    if transition && direct & 1 == 0 {
                        bc as u32
                    } else {
                        ac as u32
                    }, "char scope={kind} direct={direct} mode={mode} source={:?} next={:?} styleA={:?}", source.char_shapes, p.char_shapes, d.document().doc_info.styles[a as usize]
                );
                let first = &paragraphs(&d, l)[0];
                assert_eq!(first.style_id, source.style_id);
                assert_eq!(first.para_shape_id, source.para_shape_id);
                if off == len {
                    assert_eq!(first.text, source.text);
                    assert_eq!(
                        serde_json::to_value(&first.char_shapes).unwrap(),
                        serde_json::to_value(&source.char_shapes).unwrap()
                    );
                }
                let after = semantic(&d);
                if !baseline && mode == 0 {
                    let metadata = paragraphs(&d, l)[1].capture_meta();
                    merge(&mut d, l).unwrap();
                    split(&mut d, l, off, Some(metadata), true).unwrap();
                    assert_eq!(
                        semantic(&d),
                        after,
                        "merge inverse must retain B, scope={kind} direct={direct}"
                    );
                }
                let redo = d.save_snapshot_native();
                d.restore_snapshot_native(undo).unwrap();
                assert_eq!(semantic(&d), before);
                d.restore_snapshot_native(redo).unwrap();
                assert_eq!(semantic(&d), after);
                history += 2;
                for bytes in [
                    d.export_hwp_with_adapter_snapshot().unwrap(),
                    d.export_hwpx_native().unwrap(),
                ] {
                    assert_eq!(
                        semantic(&DocumentCore::from_bytes(&bytes).unwrap()),
                        after,
                        "reopen kind={kind} direct={direct} mode={mode}"
                    );
                    reopens += 1;
                }
                d.discard_snapshot_native(undo);
                d.discard_snapshot_native(redo);
                cases += 1;
                if direct == 0 && mode == 0 {
                    observations.push(json!({"scope":kind,"source":a,"next":b,"observed":paragraphs(&d,l)[1].style_id}));
                }
            }
        }
    }
    if !baseline {
        for kind in 0..9 {
            for invalid in 0..13 {
                let (mut d, l, a, b, _, _, _, _) = fixture(kind, 0);
                match invalid {
                    0 => d.document_mut().doc_info.styles[a as usize].next_style_id = 250,
                    1 => d.document_mut().doc_info.styles[b as usize].char_shape_id = 65535,
                    2 => d.document_mut().doc_info.styles[b as usize].para_shape_id = 65535,
                    3 => d.document_mut().doc_info.styles[b as usize].style_type = 2,
                    4 => d.document_mut().doc_info.styles[b as usize].style_type = 1,
                    5 => d.document_mut().doc_info.styles[a as usize].char_shape_id = 65535,
                    6 => d.document_mut().doc_info.styles[a as usize].para_shape_id = 65535,
                    7 => d.document_mut().doc_info.extra_records.push(RawRecord {
                        tag_id: rhwp::parser::tags::HWPTAG_STYLE,
                        ..Default::default()
                    }),
                    8 => {
                        let s = d.document().doc_info.styles[0].clone();
                        d.document_mut().doc_info.styles.resize(257, s)
                    }
                    9 => paragraphs_mut(&mut d, l)[0].style_id = 250,
                    10 => paragraphs_mut(&mut d, l)[0].para_shape_id = 65535,
                    11 => paragraphs_mut(&mut d, l)[0].char_shapes[0].char_shape_id = 65535,
                    _ => {}
                };
                let before = format!("{:?}", d.document());
                let events = d.serialize_event_log();
                let end = paragraphs(&d, l)[0].text.chars().count();
                assert!(
                    split(&mut d, l, end + usize::from(invalid == 12), None, true).is_err(),
                    "reject scope={kind} kind={invalid}"
                );
                assert_eq!(format!("{:?}", d.document()), before);
                assert_eq!(d.serialize_event_log(), events);
                rejects += 1;
            }
        }
    }
    if !baseline {
        for kind in 0..9 {
            let (mut d, l, _, _, _, _, _, _) = fixture(kind, 0);
            let mut meta = paragraphs(&d, l)[0].capture_meta();
            meta.empty_char_shape_id = Some(65535);
            let before = format!("{:?}", d.document());
            let events = d.serialize_event_log();
            let end = paragraphs(&d, l)[0].text.chars().count();
            assert!(split(&mut d, l, end, Some(meta), true).is_err());
            assert_eq!(format!("{:?}", d.document()), before);
            assert_eq!(d.serialize_event_log(), events);
            rejects += 1;
        }
    }
    if !baseline {
        for kind in 0..9 {
            for empty in [false, true] {
                let (mut d, l, a, b, _, _, _, _) = fixture(kind, 3);
                if empty {
                    let p = &mut paragraphs_mut(&mut d, l)[0];
                    p.text.clear();
                    p.char_offsets.clear();
                    p.char_count = (p
                        .controls
                        .iter()
                        .filter(|c| c.occupies_ctrl_char_slot())
                        .count()
                        * 8
                        + 1) as u32;
                    p.line_segs.clear();
                    p.invalidate_layout_inputs();
                } else {
                    d.update_style_metadata_native(
                        a as usize,
                        &json!({"nextStyleId":a}).to_string(),
                    )
                    .unwrap();
                }
                let source = paragraphs(&d, l)[0].clone();
                let end = source.text.chars().count();
                split(&mut d, l, end, None, true).unwrap();
                let p = &paragraphs(&d, l)[1];
                assert_eq!(p.style_id, if empty { b } else { a });
                assert_eq!(p.para_shape_id, source.para_shape_id);
                assert_eq!(
                    p.char_shapes[0].char_shape_id,
                    source.char_shapes[0].char_shape_id
                );
                let expected = semantic(&d);
                for bytes in [
                    d.export_hwp_with_adapter_snapshot().unwrap(),
                    d.export_hwpx_native().unwrap(),
                ] {
                    assert_eq!(
                        semantic(&DocumentCore::from_bytes(&bytes).unwrap()),
                        expected
                    );
                    reopens += 1;
                }
                cases += 1;
            }
        }
    }
    let proof = json!({"baseline":baseline,"cases":cases,"two_format_reopens":reopens,"snapshot_undo_redo_operations":history,"merge_inverse_cases":if baseline{0}else{36},"atomic_rejections":rejects,"observations":observations,"GUI_verified":false,"physical_IME_verified":false});
    std::fs::write(
        format!("{out}/native-next-style-proof.json"),
        serde_json::to_vec_pretty(&proof).unwrap(),
    )
    .unwrap();
    println!("{proof}");
}

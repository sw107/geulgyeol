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
    for p in &mut d.document_mut().sections[0].paragraphs {
        for c in &mut p.controls {
            if let Control::Table(t) = c {
                let styled = t.cells[0].paragraphs[0].clone();
                let independent = t.cells[2].paragraphs[0].clone();
                t.cells[0].paragraphs.extend([styled, independent]);
            }
        }
    }
    let mut override_para = d.document().doc_info.para_shapes[0].clone();
    override_para.margin_left = 333;
    override_para.raw_data = None;
    let override_para_id = d.document().doc_info.para_shapes.len() as u16;
    let direct_char = d.document().doc_info.styles[0].char_shape_id as u32;
    d.document_mut().doc_info.para_shapes.push(override_para);
    fn direct(ps: &mut [Paragraph], sid: usize, direct_char: u32, direct_para: u16) {
        for p in ps {
            if p.style_id as usize == sid {
                p.apply_char_shape_range(2, p.text.chars().count(), direct_char);
                if p.text.contains("셀1") {
                    p.para_shape_id = direct_para;
                }
            }
            for c in &mut p.controls {
                match c {
                    Control::Table(t) => {
                        for c in &mut t.cells {
                            direct(&mut c.paragraphs, sid, direct_char, direct_para);
                        }
                    }
                    Control::Header(h) => direct(&mut h.paragraphs, sid, direct_char, direct_para),
                    Control::Footer(h) => direct(&mut h.paragraphs, sid, direct_char, direct_para),
                    Control::Footnote(h) => {
                        direct(&mut h.paragraphs, sid, direct_char, direct_para)
                    }
                    Control::Endnote(h) => direct(&mut h.paragraphs, sid, direct_char, direct_para),
                    Control::Shape(s) => {
                        if let Some(d) = s.drawing_mut() {
                            if let Some(t) = &mut d.text_box {
                                direct(&mut t.paragraphs, sid, direct_char, direct_para);
                            }
                            if let Some(c) = &mut d.caption {
                                direct(&mut c.paragraphs, sid, direct_char, direct_para);
                            }
                        }
                    }
                    _ => {}
                }
            }
        }
    }
    direct(
        &mut d.document_mut().sections[0].paragraphs,
        sid,
        direct_char,
        override_para_id,
    );
    (d, sid)
}

fn reject(d: &mut DocumentCore, sid: usize, chars: &str, paras: &str, label: &str) {
    let before = format!("{:?}", d.document());
    assert!(
        d.update_style_shapes_native(sid, chars, paras).is_err(),
        "{label}"
    );
    assert_eq!(format!("{:?}", d.document()), before, "atomic {label}");
}
fn main() {
    let out = std::env::args().nth(1).expect("OUTPUT_DIR");
    std::fs::create_dir_all(&out).unwrap();
    let (mut cases, mut reopens, mut rejects, mut history) = (0, 0, 0, 0);
    for kind in 0..8 {
        for mode in 0..3 {
            for source in ["hwp", "hwpx"] {
                let (mut d, sid) = fixture(kind);
                if mode == 2 {
                    d.document_mut().doc_info.styles[sid].style_type = 1;
                }
                let input = if source == "hwp" {
                    d.export_hwp_with_adapter_snapshot().unwrap()
                } else {
                    d.export_hwpx_native().unwrap()
                };
                if mode == 0 {
                    std::fs::write(format!("{out}/kind{kind}-{source}-source.{source}"), &input)
                        .unwrap();
                }
                let mut d = DocumentCore::from_bytes(&input).unwrap();
                let before = semantic(&d);
                let old = d.document().doc_info.styles[sid].clone();
                let old_defs = serde_json::to_value(&d.document().doc_info.styles).unwrap();
                let old_chars = serde_json::to_value(&d.document().doc_info.char_shapes).unwrap();
                let old_paras = serde_json::to_value(&d.document().doc_info.para_shapes).unwrap();
                let svg_before = d.render_page_svg_native(0).unwrap();
                let undo = d.save_snapshot_native();
                let (char_json, para_json) = if mode == 1 {
                    ("{\"textColor\":\"#D01234\"}", "{}")
                } else {
                    (
                        "{\"fontSize\":2400,\"italic\":true}",
                        "{\"alignment\":\"center\",\"marginLeft\":900}",
                    )
                };
                let report = d
                    .update_style_shapes_native(sid, char_json, para_json)
                    .unwrap();
                let after = semantic(&d);
                let new = d.document().doc_info.styles[sid].clone();
                assert_ne!(new.char_shape_id, old.char_shape_id);
                assert_eq!(new.next_style_id, old.next_style_id);
                assert_eq!(new.local_name, old.local_name);
                if mode == 2 {
                    assert_eq!(new.para_shape_id, old.para_shape_id);
                }
                let mut expected = before.clone();
                let mut targets = 0;
                for p in expected["paragraphs"].as_array_mut().unwrap() {
                    if p["style"] == "Deleted A" {
                        targets += 1;
                        if mode != 2 && p["para"] == old.para_shape_id {
                            p["para"] = json!(new.para_shape_id);
                        }
                        for run in p["chars"].as_array_mut().unwrap() {
                            if run[1] == old.char_shape_id {
                                run[1] = json!(new.char_shape_id);
                            }
                        }
                    }
                }
                expected["styles"].as_array_mut().unwrap()[sid][2] = json!(new.char_shape_id);
                expected["styles"].as_array_mut().unwrap()[sid][3] = json!(new.para_shape_id);
                assert_eq!(
                    after, expected,
                    "propagation kind{kind} mode{mode} source{source}"
                );
                let defs = serde_json::to_value(&d.document().doc_info.styles).unwrap();
                for i in 0..defs.as_array().unwrap().len() {
                    if i != sid {
                        assert_eq!(defs[i], old_defs[i], "other style");
                    }
                }
                let chars = serde_json::to_value(&d.document().doc_info.char_shapes).unwrap();
                let paras = serde_json::to_value(&d.document().doc_info.para_shapes).unwrap();
                assert_eq!(
                    &chars.as_array().unwrap()[..old_chars.as_array().unwrap().len()],
                    old_chars.as_array().unwrap()
                );
                assert_eq!(
                    &paras.as_array().unwrap()[..old_paras.as_array().unwrap().len()],
                    old_paras.as_array().unwrap()
                );
                let svg_after = d.render_page_svg_native(0).unwrap();
                assert_ne!(svg_after, svg_before, "rendered style change");
                let redo = d.save_snapshot_native();
                d.restore_snapshot_native(undo).unwrap();
                assert_eq!(semantic(&d), before);
                assert_eq!(d.render_page_svg_native(0).unwrap(), svg_before);
                d.restore_snapshot_native(redo).unwrap();
                assert_eq!(semantic(&d), after);
                assert_eq!(d.render_page_svg_native(0).unwrap(), svg_after);
                history += 2;
                let unchanged = format!("{:?}", d.document());
                d.update_style_shapes_native(sid, char_json, para_json)
                    .unwrap();
                assert_eq!(format!("{:?}", d.document()), unchanged, "idempotence");
                for (format, bytes) in [
                    ("hwp", d.export_hwp_with_adapter_snapshot().unwrap()),
                    ("hwpx", d.export_hwpx_native().unwrap()),
                ] {
                    let r = DocumentCore::from_bytes(&bytes).unwrap();
                    assert_eq!(
                        semantic(&r),
                        after,
                        "reopen kind{kind} mode{mode} {source}->{format}"
                    );
                    if mode == 0 && source == "hwp" {
                        std::fs::write(format!("{out}/kind{kind}-updated.{format}"), bytes)
                            .unwrap();
                    }
                    reopens += 1;
                }
                println!("PASS kind{kind} mode{mode} source{source} targets{targets} {report}");
                cases += 1;
            }
        }
    }
    for malformed in ["{", "[]", "null"] {
        let (mut d, sid) = fixture(0);
        reject(&mut d, sid, malformed, "{}", "bad JSON");
        rejects += 1;
    }
    for kind in 0..13 {
        let (mut d, sid) = fixture(if kind == 6 { 8 } else { 0 });
        let mut target = sid;
        match kind {
            0 => target = 999,
            1 => d.document_mut().sections[0].paragraphs[0].style_id = 255,
            2 => d.document_mut().doc_info.styles[sid].char_shape_id = 65535,
            3 => d.document_mut().doc_info.styles[sid].next_style_id = 255,
            4 => d.document_mut().sections[0].paragraphs[0]
                .controls
                .push(Control::Unknown(UnknownControl { ctrl_id: 123 })),
            5 => d.document_mut().sections[0].paragraphs[0]
                .controls
                .push(Control::Ruby(Ruby {
                    style_id_ref: sid as u16,
                    ..Default::default()
                })),
            6 => {}
            7 => d.document_mut().sections[0]
                .section_def
                .extra_child_records
                .push(rhwp::model::document::RawRecord {
                    tag_id: rhwp::parser::tags::HWPTAG_PARA_HEADER,
                    ..Default::default()
                }),
            8 => d
                .document_mut()
                .doc_info
                .extra_records
                .push(rhwp::model::document::RawRecord {
                    tag_id: rhwp::parser::tags::HWPTAG_STYLE,
                    ..Default::default()
                }),
            9 => d.document_mut().sections[0].paragraphs[0].char_shapes[0].char_shape_id = 65535,
            10 => d.document_mut().sections[0].paragraphs[0].para_shape_id = 65535,
            11 => {
                let shape = d.document().doc_info.char_shapes[0].clone();
                d.document_mut().doc_info.char_shapes.resize(65536, shape);
            }
            12 => {
                let shape = d.document().doc_info.para_shapes[0].clone();
                d.document_mut().doc_info.para_shapes.resize(65536, shape);
            }
            _ => unreachable!(),
        }
        reject(
            &mut d,
            target,
            "{\"fontSize\":2400}",
            "{\"marginLeft\":900}",
            &format!("bad reference {kind}"),
        );
        rejects += 1;
    }
    let (mut deep, sid) = fixture(0);
    let seed = deep.document().sections[0].paragraphs[0].clone();
    let mut table = deep.document().sections[0]
        .paragraphs
        .iter()
        .flat_map(|p| &p.controls)
        .find_map(|c| {
            if let Control::Table(t) = c {
                Some(t.clone())
            } else {
                None
            }
        })
        .unwrap();
    table.cells.truncate(1);
    let mut nested = seed.clone();
    nested.controls.clear();
    for _ in 0..70 {
        let mut t = table.clone();
        t.cells[0].paragraphs = vec![nested];
        nested = seed.clone();
        nested.controls = vec![Control::Table(t)];
    }
    deep.document_mut().sections[0].paragraphs.push(nested);
    reject(&mut deep, sid, "{\"fontSize\":2400}", "{}", "depth guard");
    rejects += 1;
    let (mut large, sid) = fixture(0);
    let prototype = large.document().sections[0]
        .paragraphs
        .iter()
        .find(|p| p.style_id as usize == sid)
        .unwrap()
        .clone();
    large.document_mut().sections[0]
        .paragraphs
        .extend(std::iter::repeat_n(prototype, 600));
    let started = std::time::Instant::now();
    large
        .update_style_shapes_native(sid, "{\"textColor\":\"#D01234\"}", "{}")
        .unwrap();
    let elapsed_ms = started.elapsed().as_millis();
    assert!(
        elapsed_ms < 10000,
        "600 paragraph performance {elapsed_ms} ms"
    );
    let (d, _) = fixture(1);
    std::fs::write(
        format!("{out}/gui-source.hwpx"),
        d.export_hwpx_native().unwrap(),
    )
    .unwrap();
    let proof = json!({"cases":cases,"snapshot_undo_redo_operations":history,"two_format_reopens":reopens,"atomic_rejections":rejects,"other_styles_and_direct_format_preserved":true,"native_GUI_verified":false,"large_document_paragraphs":600,"large_document_update_ms":elapsed_ms});
    std::fs::write(
        format!("{out}/native-propagation-proof.json"),
        serde_json::to_vec_pretty(&proof).unwrap(),
    )
    .unwrap();
    println!("{proof}");
}

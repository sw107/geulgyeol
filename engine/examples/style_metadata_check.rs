//! Style metadata boundaries, atomic rejection and two-format history preservation.
use rhwp::{
    document_core::DocumentCore,
    model::{control::Control, document::RawRecord, paragraph::Paragraph},
};
use serde_json::{json, Value};
fn idx(s: &str, k: &str) -> usize {
    serde_json::from_str::<Value>(s).unwrap()[k]
        .as_u64()
        .unwrap() as usize
}
fn fixture(kind: usize) -> DocumentCore {
    let mut d = DocumentCore::new_empty();
    d.create_blank_document_native().unwrap();
    let r = d.create_table_native(0, 0, 0, 1, 2).unwrap();
    let pi = idx(&r, "paraIdx");
    let ci = idx(&r, "controlIdx");
    d.insert_text_in_cell_native(0, pi, ci, 0, 0, 0, "셀😀 보존")
        .unwrap();
    d.insert_text_native(0, pi + 1, 0, "본문 직접 서식과 스타일")
        .unwrap();
    d.apply_char_format_native(0, pi + 1, 2, 6, "{\"bold\":true,\"fontSize\":1800}")
        .unwrap();
    d.apply_para_format_native(0, pi + 1, "{\"marginLeft\":450}")
        .unwrap();
    let prototype = if let Control::Table(t) = &d.document().sections[0].paragraphs[pi].controls[ci]
    {
        t.cells[0].paragraphs[0].clone()
    } else {
        panic!()
    };
    match kind {
        0 => {}
        1 => {
            let nested = d.document().sections[0].paragraphs[pi].controls[ci].clone();
            if let Control::Table(t) = &mut d.document_mut().sections[0].paragraphs[pi].controls[ci]
            {
                let p = &mut t.cells[1].paragraphs[0];
                p.controls.push(nested);
                p.char_count += 8;
                p.align_ctrl_data_records();
            }
        }
        2 => {
            d.create_header_footer_native(0, true, 0).unwrap();
            for p in &mut d.document_mut().sections[0].paragraphs {
                for c in &mut p.controls {
                    if let Control::Header(h) = c {
                        h.paragraphs = vec![prototype.clone()]
                    }
                }
            }
        }
        3 => {
            d.insert_footnote_native(0, pi + 1, 0).unwrap();
            for p in &mut d.document_mut().sections[0].paragraphs {
                for c in &mut p.controls {
                    if let Control::Footnote(h) = c {
                        h.paragraphs = vec![prototype.clone()]
                    }
                }
            }
        }
        _ => unreachable!(),
    }
    d
}
fn collect(ps: &[Paragraph], out: &mut Vec<Value>) {
    for p in ps {
        out.push(json!({"text":p.text,"style":p.style_id,"para":p.para_shape_id,"chars":p.char_shapes.iter().map(|c|json!([c.start_pos,c.char_shape_id])).collect::<Vec<_>>() }));
        for c in &p.controls {
            match c {
                Control::Table(t) => {
                    for c in &t.cells {
                        collect(&c.paragraphs, out)
                    }
                }
                Control::Header(h) => collect(&h.paragraphs, out),
                Control::Footnote(h) => collect(&h.paragraphs, out),
                _ => {}
            }
        }
    }
}
fn semantic(d: &DocumentCore) -> Value {
    let mut ps = vec![];
    for s in &d.document().sections {
        collect(&s.paragraphs, &mut ps)
    }
    json!({"paragraphs":ps,"styles":d.document().doc_info.styles.iter().map(|s|json!({"name":s.local_name,"englishName":s.english_name,"type":s.style_type,"next":s.next_style_id,"char":s.char_shape_id,"para":s.para_shape_id,"lang":s.lang_id})).collect::<Vec<_>>()})
}
fn reject(d: &mut DocumentCore, id: Option<usize>, args: &str) -> usize {
    let before = format!("{:?}", d.document());
    let ev = d.serialize_event_log();
    let rejected = match id {
        Some(id) => d.update_style_metadata_native(id, args).is_err(),
        None => d.create_style_native(args).is_err(),
    };
    assert!(rejected, "must reject {id:?} {args}");
    assert_eq!(format!("{:?}", d.document()), before, "atomic {args}");
    assert_eq!(d.serialize_event_log(), ev);
    1
}
fn main() {
    let out = std::env::args().nth(1).expect("OUTPUT_DIR");
    std::fs::create_dir_all(&out).unwrap();
    let (mut cases, mut reopens, mut history, mut rejected) = (0, 0, 0, 0);
    for kind in 0..4 {
        for typ in [0, 1] {
            let mut d = fixture(kind);
            let sections = format!("{:?}", d.document().sections);
            let ev = d.serialize_event_log();
            let before = semantic(&d);
            let undo = d.save_snapshot_native();
            let base = d.document().sections[0].paragraphs.last().unwrap();
            let (cs, ps) = (
                base.char_shapes.last().unwrap().char_shape_id,
                base.para_shape_id,
            );
            let next = d.document().doc_info.styles.len();
            let sid=d.create_style_native(&json!({"name":"추가😀","englishName":"New","type":typ,"nextStyleId":next,"baseCharShapeId":cs,"baseParaShapeId":ps}).to_string()).unwrap();
            assert_eq!(sid, next);
            let style = &d.document().doc_info.styles[sid];
            assert_eq!((style.char_shape_id as u32, style.para_shape_id), (cs, ps));
            // Updating metadata on a style actually referenced by paragraphs does not alter their shapes/runs.
            d.update_style_metadata_native(
                0,
                &json!({"name":"바탕 변경😀","englishName":"Changed base","nextStyleId":sid})
                    .to_string(),
            )
            .unwrap();
            d.update_style_metadata_native(
                sid,
                &json!({"name":"새 이름😀","englishName":"Renamed","nextStyleId":sid}).to_string(),
            )
            .unwrap();
            assert_eq!(format!("{:?}", d.document().sections), sections);
            assert_eq!(d.serialize_event_log(), ev);
            let after = semantic(&d);
            assert_eq!(before["paragraphs"], after["paragraphs"]);
            for i in 1..sid {
                assert_eq!(before["styles"][i], after["styles"][i]);
            }
            let unchanged = format!("{:?}", d.document());
            d.update_style_metadata_native(sid, "{}").unwrap();
            assert_eq!(format!("{:?}", d.document()), unchanged);
            let redo = d.save_snapshot_native();
            d.restore_snapshot_native(undo).unwrap();
            assert_eq!(semantic(&d), before);
            d.restore_snapshot_native(redo).unwrap();
            assert_eq!(semantic(&d), after);
            history += 2;
            for (fmt, bytes) in [
                ("hwp", d.export_hwp_with_adapter_snapshot().unwrap()),
                ("hwpx", d.export_hwpx_native().unwrap()),
            ] {
                let mut r = DocumentCore::from_bytes(&bytes).unwrap();
                assert_eq!(semantic(&r), after, "kind={kind} type={typ} {fmt}");
                // Invalidate a reopened HWP raw DocInfo stream, then confirm a second saved rename survives.
                r.update_style_metadata_native(sid, "{\"name\":\"다시 변경😀\"}")
                    .unwrap();
                let expected = semantic(&r);
                let again = if fmt == "hwp" {
                    r.export_hwp_with_adapter_snapshot().unwrap()
                } else {
                    r.export_hwpx_native().unwrap()
                };
                assert_eq!(
                    semantic(&DocumentCore::from_bytes(&again).unwrap()),
                    expected
                );
                std::fs::write(format!("{out}/{kind}-{typ}.{fmt}"), again).unwrap();
                reopens += 2;
            }
            d.discard_snapshot_native(undo);
            d.discard_snapshot_native(redo);
            cases += 1;
        }
    }
    let mut d = fixture(0);
    let n = d.document().doc_info.styles.len();
    for args in [
        "[]",
        "null",
        "{",
        "{\"name\":null}",
        "{\"englishName\":12}",
        "{\"nextStyleId\":-1}",
        "{\"nextStyleId\":256}",
        "{\"nextStyleId\":250}",
        "{\"nextStyleId\":1.5}",
        "{\"nextStyleId\":\"0\"}",
        "{\"nextStyleId\":18446744073709551615}",
        "{\"type\":2}",
        "{\"type\":256}",
        "{\"type\":-1}",
        "{\"type\":null}",
        "{\"baseCharShapeId\":65536}",
        "{\"baseParaShapeId\":65536}",
        "{\"baseCharShapeId\":65535}",
        "{\"baseParaShapeId\":65535}",
        "{\"baseCharShapeId\":-1}",
        "{\"baseParaShapeId\":\"0\"}",
    ] {
        rejected += reject(&mut d, None, args);
    }
    for args in [
        "[]",
        "null",
        "{",
        "{\"name\":null}",
        "{\"englishName\":false}",
        "{\"name\":\"must stay unchanged\",\"nextStyleId\":-1}",
        "{\"name\":\"must stay unchanged\",\"nextStyleId\":256}",
        "{\"name\":\"must stay unchanged\",\"nextStyleId\":250}",
        "{\"name\":\"must stay unchanged\",\"nextStyleId\":1.5}",
        "{\"name\":\"must stay unchanged\",\"nextStyleId\":\"0\"}",
    ] {
        rejected += reject(&mut d, Some(0), args);
    }
    rejected += reject(&mut d, Some(n), "{\"name\":\"bad id\"}");
    let long = json!({"name":"😀".repeat(32768)}).to_string();
    rejected += reject(&mut d, None, &long);
    rejected += reject(&mut d, Some(0), &long);
    for mutation in 0..6 {
        let mut d = fixture(0);
        match mutation {
            0 => d.document_mut().doc_info.styles[0].next_style_id = 250,
            1 => d.document_mut().doc_info.styles[0].style_type = 2,
            2 => d.document_mut().doc_info.styles[0].char_shape_id = 65535,
            3 => d.document_mut().doc_info.styles[0].para_shape_id = 65535,
            4 => d.document_mut().doc_info.extra_records.push(RawRecord {
                tag_id: rhwp::parser::tags::HWPTAG_STYLE,
                ..Default::default()
            }),
            5 => {
                let s = d.document().doc_info.styles[0].clone();
                d.document_mut().doc_info.styles.resize(257, s);
            }
            _ => unreachable!(),
        };
        rejected += reject(&mut d, None, "{}");
        rejected += reject(&mut d, Some(0), "{\"name\":\"bad table\"}");
    }
    rejected += reject(&mut DocumentCore::new_empty(), None, "{}");
    // Highest supported style ID and self-next are valid; adding a 257th style is atomic rejection.
    let mut d = fixture(0);
    let s = d.document().doc_info.styles[0].clone();
    d.document_mut().doc_info.styles.resize(255, s);
    let sid = d
        .create_style_native("{\"name\":\"last\",\"nextStyleId\":255}")
        .unwrap();
    assert_eq!(sid, 255);
    rejected += reject(&mut d, None, "{}");
    d.update_style_metadata_native(255, "{\"name\":\"last changed\",\"nextStyleId\":255}")
        .unwrap();
    for bytes in [
        d.export_hwp_with_adapter_snapshot().unwrap(),
        d.export_hwpx_native().unwrap(),
    ] {
        assert_eq!(
            semantic(&DocumentCore::from_bytes(&bytes).unwrap()),
            semantic(&d)
        );
        reopens += 1;
    }
    // Opaque paragraph controls do not need reindexing for metadata; preserve them exactly.
    let mut d = fixture(0);
    d.document_mut().sections[0].paragraphs[0]
        .controls
        .push(Control::Unknown(rhwp::model::control::UnknownControl {
            ctrl_id: u32::from_le_bytes(*b"test"),
        }));
    let ps = format!("{:?}", d.document().sections);
    d.update_style_metadata_native(0, "{\"name\":\"safe rename\"}")
        .unwrap();
    assert_eq!(format!("{:?}", d.document().sections), ps);
    let proof = json!({"valid_scope_cases":cases,"two_format_reopens":reopens,"snapshot_undo_redo_operations":history,"atomic_rejections":rejected,"maximum_style_id":255,"paragraphs_and_direct_formats_preserved":true,"other_styles_preserved":true,"native_GUI_verified":false,"physical_IME_verified":false});
    std::fs::write(
        format!("{out}/native-style-metadata-proof.json"),
        serde_json::to_vec_pretty(&proof).unwrap(),
    )
    .unwrap();
    println!("{proof}");
}

//! Plain note character-format preservation, atomic negatives and two-format history.
use rhwp::{
    document_core::DocumentCore,
    model::{
        control::Control,
        paragraph::{CharShapeRef, Paragraph},
    },
};
use serde_json::{json, Value};
fn note(d: &DocumentCore, ci: usize) -> &[Paragraph] {
    match &d.document().sections[0].paragraphs[0].controls[ci] {
        Control::Footnote(n) => &n.paragraphs,
        Control::Endnote(n) => &n.paragraphs,
        _ => panic!(),
    }
}
fn note_mut(d: &mut DocumentCore, ci: usize) -> &mut Vec<Paragraph> {
    match &mut d.document_mut().sections[0].paragraphs[0].controls[ci] {
        Control::Footnote(n) => &mut n.paragraphs,
        Control::Endnote(n) => &mut n.paragraphs,
        _ => panic!(),
    }
}
fn svg(d: &DocumentCore) -> Vec<String> {
    (0..d.page_count())
        .map(|i| d.render_page_svg_native(i).unwrap())
        .collect()
}
fn model(d: &DocumentCore) -> String {
    format!("{:?}", d.document())
}
fn semantic(d: &DocumentCore, ci: usize) -> Value {
    json!(note(d,ci).iter().map(|p|json!({"text":p.text,"style":p.style_id,"paraShape":p.para_shape_id,"offsets":p.char_offsets,"positions":p.logical_control_positions(),"controls":format!("{:?}",p.controls),"chars":(0..p.text.chars().count()).map(|o|serde_json::from_str::<Value>(&d.get_char_properties_in_footnote_native(0,0,ci,note(d,ci).iter().position(|x|std::ptr::eq(x,p)).unwrap(),o).unwrap()).unwrap()).collect::<Vec<_>>()})).collect::<Vec<_>>())
}
fn fixture(endnote: bool, unicode: bool) -> (DocumentCore, usize, usize) {
    let mut d = DocumentCore::new_empty();
    d.create_blank_document_native().unwrap();
    d.insert_text_native(0, 0, 0, "본문 보존😀 옆 문서")
        .unwrap();
    let r = if endnote {
        d.insert_endnote_native(0, 0, 2)
    } else {
        d.insert_footnote_native(0, 0, 2)
    }
    .unwrap();
    let ci = serde_json::from_str::<Value>(&r).unwrap()["controlIdx"]
        .as_u64()
        .unwrap() as usize;
    let r = d.insert_footnote_native(0, 0, 5).unwrap();
    let neighbor = serde_json::from_str::<Value>(&r).unwrap()["controlIdx"]
        .as_u64()
        .unwrap() as usize;
    let base = note(&d, ci)[0].clone();
    let mut cs = d.document().doc_info.char_shapes[0].clone();
    cs.italic = true;
    cs.text_color = 0x334477;
    cs.base_size = 1300;
    cs.raw_data = None;
    let csid = d.document().doc_info.char_shapes.len() as u32;
    d.document_mut().doc_info.char_shapes.push(cs);
    let texts = if unicode {
        [
            "앞😀첫각주 인용✏️끝",
            "둘🧪각주 논문 한글끝",
            "",
            "마지막🦋각주",
        ]
    } else {
        [
            "first note citation end",
            "second note plain tail",
            "",
            "last note tail",
        ]
    };
    let mut ps = vec![];
    for (i, t) in texts.iter().enumerate() {
        let mut p = if i == 0 {
            base.clone()
        } else {
            Paragraph::new_empty_like(&base)
        };
        p.insert_text_at(p.text.chars().count(), t);
        p.style_id = if i == 1 { 1 } else { base.style_id };
        p.char_shapes = vec![CharShapeRef {
            start_pos: 0,
            char_shape_id: 0,
        }];
        p.apply_char_shape_range(3, 6, csid);
        ps.push(p)
    }
    *note_mut(&mut d, ci) = ps;
    d.insert_text_in_footnote_native(0, 0, neighbor, 0, 2, "이웃 각주 보존😀")
        .unwrap();
    let doc = d.document().clone();
    d.set_document(doc);
    (d, ci, neighbor)
}
fn unchanged(d: &DocumentCore, old: &DocumentCore, ci: usize) {
    let mut doc = d.document().clone();
    let oldps = note(old, ci);
    let ps = match &mut doc.sections[0].paragraphs[0].controls[ci] {
        Control::Footnote(n) => &mut n.paragraphs,
        Control::Endnote(n) => &mut n.paragraphs,
        _ => panic!(),
    };
    for (p, b) in ps.iter_mut().zip(oldps) {
        p.char_shapes = b.char_shapes.clone();
        p.line_segs = b.line_segs.clone();
        p.single_line_overflow_memo = b.single_line_overflow_memo.clone();
    }
    doc.doc_info
        .char_shapes
        .truncate(old.document().doc_info.char_shapes.len());
    doc.doc_info.raw_stream_dirty = old.document().doc_info.raw_stream_dirty;
    doc.sections[0].raw_stream = old.document().sections[0].raw_stream.clone();
    assert_eq!(
        format!("{doc:?}"),
        model(old),
        "all other document content/format/definitions preserved"
    )
}
fn main() {
    if std::env::args().nth(1).as_deref() == Some("--verify-ui") {
        let manifest = std::env::args().nth(2).unwrap();
        let out = std::env::args().nth(3).unwrap();
        std::fs::create_dir_all(&out).unwrap();
        let rows: Vec<Value> = serde_json::from_slice(&std::fs::read(manifest).unwrap()).unwrap();
        for row in &rows {
            let old =
                DocumentCore::from_bytes(&std::fs::read(row["input"].as_str().unwrap()).unwrap())
                    .unwrap();
            let saved =
                DocumentCore::from_bytes(&std::fs::read(row["file"].as_str().unwrap()).unwrap())
                    .unwrap();
            for key in ["control", "neighbor"] {
                let ci = row[key].as_u64().unwrap() as usize;
                let mut a = semantic(&saved, ci);
                let mut b = semantic(&old, ci);
                for p in a.as_array_mut().unwrap() {
                    p.as_object_mut().unwrap().remove("chars");
                }
                for p in b.as_array_mut().unwrap() {
                    p.as_object_mut().unwrap().remove("chars");
                }
                assert_eq!(
                    a, b,
                    "UI stored note text/style/para/control positions preserved"
                );
                let number =
                    |d: &DocumentCore| match &d.document().sections[0].paragraphs[0].controls[ci] {
                        Control::Footnote(n) => json!(["footnote", n.number]),
                        Control::Endnote(n) => json!(["endnote", n.number]),
                        _ => panic!(),
                    };
                assert_eq!(
                    number(&saved),
                    number(&old),
                    "note kind and number preserved"
                );
            }
            let styles = |d: &DocumentCore| {
                let mut s = d.document().doc_info.styles.clone();
                for s in &mut s {
                    s.raw_data = None;
                }
                serde_json::to_value(s).unwrap()
            };
            assert_eq!(styles(&saved), styles(&old));
            assert_eq!(
                saved.document().sections[0].paragraphs[0].logical_control_positions(),
                old.document().sections[0].paragraphs[0].logical_control_positions(),
                "body markers preserved"
            );
        }
        let proof = json!({"verifiedUIExports":rows.len(),"GUIVerified":false});
        std::fs::write(
            format!("{out}/proof.json"),
            serde_json::to_vec_pretty(&proof).unwrap(),
        )
        .unwrap();
        println!("{proof}");
        return;
    }
    let out = std::env::args().nth(1).unwrap();
    std::fs::create_dir_all(&out).unwrap();
    let (mut cases, mut restores, mut reopens, mut rejects) = (0, 0, 0, 0);
    let mut fixtures = vec![];
    for endnote in [false, true] {
        for unicode in [false, true] {
            let (d, ci, neighbor) = fixture(endnote, unicode);
            let input = d.export_hwpx_native().unwrap();
            let file = format!("{out}/endnote{endnote}-unicode{unicode}.hwpx");
            std::fs::write(&file, &input).unwrap();
            fixtures.push(json!({"file":file,"endnote":endnote,"unicode":unicode,"control":ci,"neighbor":neighbor}));
            {
                let mut named = DocumentCore::from_bytes(&input).unwrap();
                let before = model(&named);
                let before_svg = svg(&named);
                let props = r#"{"fontName":"Footnote QA Font"}"#;
                assert!(named
                    .apply_char_format_in_footnote_native(0, 0, ci, 0, 2, 999, 4, props)
                    .is_err());
                assert_eq!(model(&named), before);
                rejects += 1;
                let undo = named.save_snapshot_native();
                named
                    .apply_char_format_in_footnote_native(0, 0, ci, 0, 2, 1, 7, props)
                    .unwrap();
                assert!(named
                    .document()
                    .doc_info
                    .font_faces
                    .iter()
                    .all(|f| f.iter().any(|font| font.name == "Footnote QA Font")));
                let after = model(&named);
                let after_svg = svg(&named);
                let redo = named.save_snapshot_native();
                named.restore_snapshot_native(undo).unwrap();
                assert_eq!(model(&named), before);
                assert_eq!(svg(&named), before_svg);
                named.restore_snapshot_native(redo).unwrap();
                assert_eq!(model(&named), after);
                assert_eq!(svg(&named), after_svg);
                restores += 2;
                for bytes in [
                    named.export_hwp_native().unwrap(),
                    named.export_hwpx_native().unwrap(),
                ] {
                    let r = DocumentCore::from_bytes(&bytes).unwrap();
                    assert_eq!(semantic(&r, ci), semantic(&named, ci));
                    reopens += 1;
                }
                named.discard_snapshot_native(undo);
                named.discard_snapshot_native(redo);
                cases += 1;
            }
            for (id, props, sp, start, ep, end) in [
                ("bold", json!({"bold":true}), 0, 2, 0, 9),
                (
                    "size",
                    json!({"fontSize":1700,"textColor":"#336699"}),
                    0,
                    2,
                    1,
                    7,
                ),
                (
                    "arrays",
                    json!({"ratios":vec![110;7],"spacings":vec![2;7]}),
                    0,
                    3,
                    3,
                    5,
                ),
                (
                    "super",
                    json!({"superscript":true,"subscript":false}),
                    1,
                    1,
                    1,
                    5,
                ),
            ] {
                let mut d = DocumentCore::from_bytes(&input).unwrap();
                let old = DocumentCore::from_bytes(&input).unwrap();
                let before = model(&d);
                let bs = svg(&d);
                let old_sem = semantic(&d, ci);
                for bad in [
                    json!({"bold":"x"}),
                    json!({"fontSize":0}),
                    json!({"fontId":65535}),
                    json!({"fontIds":vec![65535;7]}),
                    json!({"charShapeId":0}),
                    json!({"ratios":vec![300;7]}),
                    json!({"textColor":"wrong"}),
                    json!({"borderFillId":1}),
                ] {
                    assert!(d
                        .apply_char_format_in_footnote_native(
                            0,
                            0,
                            ci,
                            sp,
                            start,
                            ep,
                            end,
                            &bad.to_string()
                        )
                        .is_err());
                    assert_eq!(model(&d), before);
                    assert_eq!(svg(&d), bs);
                    rejects += 1;
                }
                for (ctrl, a, b, c, e) in [
                    (ci, sp, start, 999, 0),
                    (ci, sp, 999, ep, end),
                    (ci, ep, end, sp, start),
                    (0, 0, 0, 0, 1),
                ] {
                    assert!(d
                        .apply_char_format_in_footnote_native(
                            0,
                            0,
                            ctrl,
                            a,
                            b,
                            c,
                            e,
                            &props.to_string()
                        )
                        .is_err());
                    assert_eq!(model(&d), before);
                    assert_eq!(svg(&d), bs);
                    rejects += 1;
                }
                // Unsupported object in a later target cannot allow earlier text to change.
                let mut bad = DocumentCore::from_bytes(&input).unwrap();
                note_mut(&mut bad, ci)[1]
                    .controls
                    .push(Control::ColumnDef(Default::default()));
                let bb = model(&bad);
                assert!(bad
                    .apply_char_format_in_footnote_native(0, 0, ci, 0, 2, 1, 4, &props.to_string())
                    .is_err());
                assert_eq!(model(&bad), bb);
                rejects += 1;
                let undo = d.save_snapshot_native();
                let result: Value = serde_json::from_str(
                    &d.apply_char_format_in_footnote_native(
                        0,
                        0,
                        ci,
                        sp,
                        start,
                        ep,
                        end,
                        &props.to_string(),
                    )
                    .unwrap(),
                )
                .unwrap();
                assert_eq!(result["changed"], true);
                unchanged(&d, &old, ci);
                let after_sem = semantic(&d, ci);
                for pi in 0..4 {
                    let b = old_sem[pi]["chars"].as_array().unwrap();
                    for (offset, bc) in b.iter().enumerate() {
                        let actual = &after_sem[pi]["chars"][offset];
                        let selected = pi >= sp
                            && pi <= ep
                            && offset >= if pi == sp { start } else { 0 }
                            && offset < if pi == ep { end } else { b.len() };
                        if !selected {
                            assert_eq!(actual, bc)
                        } else {
                            let mut expected = bc.clone();
                            let mut got = actual.clone();
                            expected.as_object_mut().unwrap().remove("charShapeId");
                            got.as_object_mut().unwrap().remove("charShapeId");
                            for (k, v) in props.as_object().unwrap() {
                                expected[k] = v.clone();
                            }
                            assert_eq!(
                                got, expected,
                                "selected run keeps every unspecified property"
                            );
                        }
                    }
                }
                let after = model(&d);
                let asvg = svg(&d);
                let redo = d.save_snapshot_native();
                for _ in 0..3 {
                    d.restore_snapshot_native(undo).unwrap();
                    assert_eq!(model(&d), before);
                    assert_eq!(svg(&d), bs);
                    d.restore_snapshot_native(redo).unwrap();
                    assert_eq!(model(&d), after);
                    assert_eq!(svg(&d), asvg);
                    restores += 2;
                }
                for (fmt, bytes) in [
                    ("hwp", d.export_hwp_native().unwrap()),
                    ("hwpx", d.export_hwpx_native().unwrap()),
                ] {
                    let r = DocumentCore::from_bytes(&bytes).unwrap();
                    assert_eq!(semantic(&r, ci), after_sem);
                    assert_eq!(semantic(&r, neighbor), semantic(&old, neighbor));
                    std::fs::write(
                        format!("{out}/endnote{endnote}-unicode{unicode}-{id}.{fmt}"),
                        bytes,
                    )
                    .unwrap();
                    reopens += 1;
                }
                d.discard_snapshot_native(undo);
                d.discard_snapshot_native(redo);
                cases += 1;
            }
        }
    }
    let proof = json!({"cases":cases,"restores":restores,"reopens":reopens,"rejections":rejects,"fixtures":fixtures,"GUIVerified":false});
    std::fs::write(
        format!("{out}/proof.json"),
        serde_json::to_vec_pretty(&proof).unwrap(),
    )
    .unwrap();
    println!("{proof}");
}

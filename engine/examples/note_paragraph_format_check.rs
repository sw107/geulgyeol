//! Note paragraph format preservation, atomic negatives and two-format history.
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
    json!(note(d,ci).iter().map(|p|json!({"text":p.text,"style":p.style_id,"para":serde_json::from_str::<Value>(&d.get_para_properties_in_footnote_native(0,0,ci,note(d,ci).iter().position(|x|std::ptr::eq(x,p)).unwrap()).unwrap()).unwrap(),"offsets":p.char_offsets,"positions":p.logical_control_positions(),"controls":format!("{:?}",p.controls),"chars":(0..p.text.chars().count()).map(|o|serde_json::from_str::<Value>(&d.get_char_properties_in_footnote_native(0,0,ci,note(d,ci).iter().position(|x|std::ptr::eq(x,p)).unwrap(),o).unwrap()).unwrap()).collect::<Vec<_>>()})).collect::<Vec<_>>())
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
    for (i, p) in ps.iter_mut().enumerate() {
        let mut shape = d.document().doc_info.para_shapes[p.para_shape_id as usize].clone();
        shape.indent = if i == 1 { -400 } else { 200 };
        shape.margin_left = i as i32 * 300;
        shape.spacing_before = i as i32 * 100;
        shape.raw_data = None;
        let id = d.document().doc_info.para_shapes.len() as u16;
        d.document_mut().doc_info.para_shapes.push(shape);
        p.para_shape_id = id;
    }
    *note_mut(&mut d, ci) = ps;
    d.insert_text_in_footnote_native(0, 0, neighbor, 0, 2, "이웃 각주 보존😀")
        .unwrap();
    let doc = d.document().clone();
    d.set_document(doc);
    (d, ci, neighbor)
}

fn unchanged(d: &DocumentCore, old: &DocumentCore, ci: usize, first: usize, last: usize) {
    let mut doc = d.document().clone();
    let ps = match &mut doc.sections[0].paragraphs[0].controls[ci] {
        Control::Footnote(n) => &mut n.paragraphs,
        Control::Endnote(n) => &mut n.paragraphs,
        _ => panic!(),
    };
    for pi in first..=last {
        let b = &note(old, ci)[pi];
        let p = &mut ps[pi];
        p.para_shape_id = b.para_shape_id;
        p.line_segs = b.line_segs.clone();
        p.single_line_overflow_memo = b.single_line_overflow_memo.clone();
    }
    doc.doc_info
        .para_shapes
        .truncate(old.document().doc_info.para_shapes.len());
    doc.doc_info
        .tab_defs
        .truncate(old.document().doc_info.tab_defs.len());
    doc.doc_info
        .border_fills
        .truncate(old.document().doc_info.border_fills.len());
    doc.doc_info.raw_stream_dirty = old.document().doc_info.raw_stream_dirty;
    doc.sections[0].raw_stream = old.document().sections[0].raw_stream.clone();
    assert_eq!(
        format!("{doc:?}"),
        model(old),
        "all other content, runs, controls, references and definitions preserved"
    );
}
fn main() {
    if std::env::args().nth(1).as_deref() == Some("--verify-ui") {
        let rows: Vec<Value> =
            serde_json::from_slice(&std::fs::read(std::env::args().nth(2).unwrap()).unwrap())
                .unwrap();
        let out = std::env::args().nth(3).unwrap();
        std::fs::create_dir_all(&out).unwrap();
        for row in &rows {
            let old =
                DocumentCore::from_bytes(&std::fs::read(row["input"].as_str().unwrap()).unwrap())
                    .unwrap();
            let d =
                DocumentCore::from_bytes(&std::fs::read(row["file"].as_str().unwrap()).unwrap())
                    .unwrap();
            for k in ["control", "neighbor"] {
                let ci = row[k].as_u64().unwrap() as usize;
                let mut a = semantic(&d, ci);
                let mut b = semantic(&old, ci);
                if k == "control" {
                    for p in a.as_array_mut().unwrap() {
                        p.as_object_mut().unwrap().remove("para");
                    }
                    for p in b.as_array_mut().unwrap() {
                        p.as_object_mut().unwrap().remove("para");
                    }
                }
                assert_eq!(a, b);
                let number =
                    |d: &DocumentCore| match &d.document().sections[0].paragraphs[0].controls[ci] {
                        Control::Footnote(n) => json!(["footnote", n.number]),
                        Control::Endnote(n) => json!(["endnote", n.number]),
                        _ => panic!(),
                    };
                assert_eq!(number(&d), number(&old));
            }
            let styles = |d: &DocumentCore| {
                let mut s = d.document().doc_info.styles.clone();
                for s in &mut s {
                    s.raw_data = None;
                }
                serde_json::to_value(s).unwrap()
            };
            assert_eq!(styles(&d), styles(&old));
            assert_eq!(
                d.document().sections[0].paragraphs[0].logical_control_positions(),
                old.document().sections[0].paragraphs[0].logical_control_positions()
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
    let (mut cases, mut restores, mut reopens, mut rejects, mut noops) = (0, 0, 0, 0, 0);
    let mut fixtures = vec![];
    for endnote in [false, true] {
        for unicode in [false, true] {
            let (d, ci, neighbor) = fixture(endnote, unicode);
            let input = d.export_hwpx_native().unwrap();
            let file = format!("{out}/endnote{endnote}-unicode{unicode}.hwpx");
            std::fs::write(&file, &input).unwrap();
            fixtures.push(json!({"file":file,"endnote":endnote,"unicode":unicode,"control":ci,"neighbor":neighbor}));
            for (id, props, first, start, last, end) in [
                ("align", json!({"alignment":"center"}), 0, 2, 1, 7),
                (
                    "spacing",
                    json!({"lineSpacing":180,"lineSpacingType":"Percent"}),
                    0,
                    2,
                    3,
                    5,
                ),
                (
                    "indent",
                    json!({"indent":600,"marginLeft":1200}),
                    1,
                    3,
                    1,
                    3,
                ),
                (
                    "before-after",
                    json!({"spacingBefore":350,"spacingAfter":250}),
                    0,
                    2,
                    3,
                    5,
                ),
                (
                    "fixed",
                    json!({"lineSpacing":1800,"lineSpacingType":"Fixed"}),
                    0,
                    2,
                    1,
                    7,
                ),
                ("tabs", json!({"tabAutoLeft":true}), 0, 2, 1, 7),
                (
                    "border",
                    json!({"borderLeft":{"type":1,"width":2,"color":"#334477"}}),
                    0,
                    2,
                    1,
                    7,
                ),
            ] {
                let mut d = DocumentCore::from_bytes(&input).unwrap();
                let old = DocumentCore::from_bytes(&input).unwrap();
                let before = model(&d);
                let bs = svg(&d);
                for bad in [
                    json!({"alignment":"bad"}),
                    json!({"lineSpacing":-1}),
                    json!({"indent":2147483648i64}),
                    json!({"numberingId":65535}),
                    json!({"paraShapeId":0}),
                    json!({"borderFillId":65535}),
                    json!({"tabStops":[{"position":1,"type":1}]}),
                    json!({"borderLeft":{"type":1,"width":1,"color":"bad"}}),
                ] {
                    assert!(d
                        .apply_para_format_in_footnote_range_native(
                            0,
                            0,
                            ci,
                            first,
                            start,
                            last,
                            end,
                            &bad.to_string()
                        )
                        .is_err());
                    assert_eq!(model(&d), before);
                    assert_eq!(svg(&d), bs);
                    rejects += 1;
                }
                for (sec, parent, ctrl, a, b, c, e) in [
                    (99, 0, ci, first, start, last, end),
                    (0, 99, ci, first, start, last, end),
                    (0, 0, 0, first, start, last, end),
                    (0, 0, ci, first, 999, last, end),
                    (0, 0, ci, first, start, 999, end),
                    (0, 0, ci, last, end, first, start),
                    (0, 0, ci, first, start, last, 999),
                ] {
                    if (a, b) == (c, e) {
                        continue;
                    }
                    assert!(d
                        .apply_para_format_in_footnote_range_native(
                            sec,
                            parent,
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
                for broken in 0..7 {
                    let mut bad = DocumentCore::from_bytes(&input).unwrap();
                    let pid = note(&bad, ci)[1].para_shape_id as usize;
                    match broken {
                        0 => note_mut(&mut bad, ci)[1]
                            .controls
                            .push(Control::ColumnDef(Default::default())),
                        1 => note_mut(&mut bad, ci)[1].style_id = 255,
                        2 => note_mut(&mut bad, ci)[1].para_shape_id = 65535,
                        3 => note_mut(&mut bad, ci)[1].char_shapes[0].char_shape_id = 99999,
                        4 => bad.document_mut().doc_info.para_shapes[pid].tab_def_id = 65535,
                        5 => bad.document_mut().doc_info.para_shapes[pid].numbering_id = 65535,
                        _ => bad.document_mut().doc_info.para_shapes[pid].border_fill_id = 65535,
                    };
                    let bb = model(&bad);
                    assert!(bad
                        .apply_para_format_in_footnote_range_native(
                            0,
                            0,
                            ci,
                            0,
                            2,
                            1,
                            4,
                            &props.to_string()
                        )
                        .is_err());
                    assert_eq!(model(&bad), bb);
                    rejects += 1;
                }
                let undo = d.save_snapshot_native();
                let result: Value = serde_json::from_str(
                    &d.apply_para_format_in_footnote_range_native(
                        0,
                        0,
                        ci,
                        first,
                        start,
                        last,
                        end,
                        &props.to_string(),
                    )
                    .unwrap(),
                )
                .unwrap();
                assert_eq!(result["changed"], true);
                unchanged(&d, &old, ci, first, last);
                let mods = props.as_object().unwrap();
                for pi in 0..4 {
                    let before: Value = serde_json::from_str(
                        &old.get_para_properties_in_footnote_native(0, 0, ci, pi)
                            .unwrap(),
                    )
                    .unwrap();
                    let after: Value = serde_json::from_str(
                        &d.get_para_properties_in_footnote_native(0, 0, ci, pi)
                            .unwrap(),
                    )
                    .unwrap();
                    if pi < first || pi > last {
                        assert_eq!(after, before);
                    } else {
                        for (k, v) in before.as_object().unwrap() {
                            if !mods.contains_key(k)
                                && k != "paraShapeId"
                                && k != "tabStops"
                                && k != "borderFillId"
                            {
                                assert_eq!(after[k], *v, "omitted paragraph property: {k}");
                            }
                        }
                    }
                }
                let after = model(&d);
                let asvg = svg(&d);
                let sem = semantic(&d, ci);
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
                let repeated: Value = serde_json::from_str(
                    &d.apply_para_format_in_footnote_range_native(
                        0,
                        0,
                        ci,
                        first,
                        start,
                        last,
                        end,
                        &props.to_string(),
                    )
                    .unwrap(),
                )
                .unwrap();
                assert_eq!(repeated["changed"], false);
                assert_eq!(model(&d), after);
                noops += 1;
                for (fmt, bytes) in [
                    ("hwp", d.export_hwp_native().unwrap()),
                    ("hwpx", d.export_hwpx_native().unwrap()),
                ] {
                    let r = DocumentCore::from_bytes(&bytes).unwrap();
                    assert_eq!(semantic(&r, ci), sem);
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
    let proof = json!({"cases":cases,"restores":restores,"reopens":reopens,"rejections":rejects,"noOps":noops,"fixtures":fixtures,"GUIVerified":false});
    std::fs::write(
        format!("{out}/proof.json"),
        serde_json::to_vec_pretty(&proof).unwrap(),
    )
    .unwrap();
    println!("{proof}");
}

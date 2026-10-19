//! Strict JSON and HWPX control-character regression; synthetic documents only.
//! Run `cargo run --example note_control_text_check -- getter|roundtrip|contexts`.
use rhwp::{
    document_core::DocumentCore,
    model::{
        control::Control,
        paragraph::Paragraph,
        shape::{DrawingObjAttr, RectangleShape, ShapeObject, TextBox},
        table::{Cell, Table},
    },
};
use serde_json::{json, Value};

fn blank() -> DocumentCore {
    let mut d = DocumentCore::new_empty();
    d.create_blank_document_native().unwrap();
    d
}
fn fixture(endnote: bool) -> (DocumentCore, usize) {
    let mut d = blank();
    d.insert_text_native(0, 0, 0, "본문😀").unwrap();
    let raw = if endnote {
        d.insert_endnote_native(0, 0, 1)
    } else {
        d.insert_footnote_native(0, 0, 1)
    }
    .unwrap();
    let ci = serde_json::from_str::<Value>(&raw).unwrap()["controlIdx"]
        .as_u64()
        .unwrap() as usize;
    (d, ci)
}
fn paragraphs(d: &DocumentCore, ci: usize) -> &[Paragraph] {
    match &d.document().sections[0].paragraphs[0].controls[ci] {
        Control::Footnote(n) => &n.paragraphs,
        Control::Endnote(n) => &n.paragraphs,
        _ => panic!("note"),
    }
}
fn info(d: &DocumentCore, ci: usize) -> Value {
    let before = format!("{:?}", d.document());
    let raw = d.get_footnote_info_native(0, 0, ci).unwrap();
    let v: Value = serde_json::from_str(&raw).expect("getter must return strict JSON");
    let ps = paragraphs(d, ci);
    let number = match &d.document().sections[0].paragraphs[0].controls[ci] {
        Control::Footnote(n) => n.number,
        Control::Endnote(n) => n.number,
        _ => unreachable!(),
    };
    assert_eq!(
        v,
        json!({"ok":true,"paraCount":ps.len(),
        "totalTextLen":ps.iter().map(|p|p.text.chars().count()).sum::<usize>(),
        "number":number,"texts":ps.iter().map(|p|&p.text).collect::<Vec<_>>()})
    );
    assert_eq!(format!("{:?}", d.document()), before, "getter is read-only");
    v
}
fn getter() {
    let c0: String = (0..32).map(|i| char::from_u32(i).unwrap()).collect();
    let cases = [
        String::new(),
        "A한😀B".into(),
        "A\\t\\n\\r\"\\한😀".into(),
        "A\t\n\r\r\n한😀".into(),
        c0,
    ];
    for end in [false, true] {
        for text in &cases {
            let (mut d, ci) = fixture(end);
            d.insert_text_in_footnote_native(0, 0, ci, 0, 0, text)
                .unwrap();
            // Empty and nonempty subsequent paragraphs exercise array boundaries.
            d.split_paragraph_in_footnote_native(0, 0, ci, 0, text.chars().count(), None)
                .unwrap();
            d.split_paragraph_in_footnote_native(0, 0, ci, 1, 0, None)
                .unwrap();
            d.insert_text_in_footnote_native(0, 0, ci, 2, 0, "둘째\"\\😀")
                .unwrap();
            info(&d, ci);
            assert!(d.get_footnote_info_native(999, 0, ci).is_err());
            assert!(d.get_footnote_info_native(0, 999, ci).is_err());
            assert!(d.get_footnote_info_native(0, 0, usize::MAX).is_err());
        }
    }
    // All C0 values are legal in JSON; only XML-legal TAB/LF/CR go to HWPX below.
    println!("getter: 10 cases, both note kinds, all C0, Unicode scalar lengths");
}
fn roundtrip() {
    for end in [false, true] {
        for text in [
            "A\t한😀B",
            "A\n한😀B",
            "A\r한😀B",
            "A\r\n한😀B",
            "A\\t\\n\\r\"한😀B",
        ] {
            let (mut d, ci) = fixture(end);
            let before = info(&d, ci);
            let initial = d.save_snapshot_native();
            d.insert_text_in_footnote_native(0, 0, ci, 0, 0, text)
                .unwrap();
            let grown = info(&d, ci);
            let edited = d.save_snapshot_native();
            for (stage, snapshot, expected) in [
                ("grown", edited, &grown),
                ("undo", initial, &before),
                ("redo", edited, &grown),
            ] {
                d.restore_snapshot_native(snapshot).unwrap();
                assert_eq!(&info(&d, ci), expected, "{stage} live");
                let mut cold = DocumentCore::from_bytes(&d.export_hwpx_native().unwrap()).unwrap();
                assert_eq!(&info(&cold, ci), expected, "{stage} cold");
                let model = cold.document().clone();
                cold.set_document(model);
                assert_eq!(&info(&cold, ci), expected, "{stage} rebuilt");
                let twice = DocumentCore::from_bytes(&cold.export_hwpx_native().unwrap()).unwrap();
                assert_eq!(&info(&twice, ci), expected, "{stage} second save");
            }
            // The API's character offsets retain CR and non-BMP scalar counts.
            d.delete_text_in_footnote_native(0, 0, ci, 0, 0, text.chars().count())
                .unwrap();
            assert_eq!(info(&d, ci), before);
            d.discard_snapshot_native(initial);
            d.discard_snapshot_native(edited);
        }
    }
    println!("roundtrip: 10 cases, 30 history stages, live/cold/rebuilt/second save");
}
fn texts(ps: &[Paragraph], out: &mut Vec<String>) {
    for p in ps {
        out.push(p.text.clone());
        for c in &p.controls {
            match c {
                Control::Table(t) => {
                    for cell in &t.cells {
                        texts(&cell.paragraphs, out);
                    }
                }
                Control::Shape(s) => {
                    if let Some(t) = s.drawing().and_then(|d| d.text_box.as_ref()) {
                        texts(&t.paragraphs, out);
                    }
                }
                _ => {}
            }
        }
    }
}
fn contexts() {
    // The same hp:t serializer handles body, table cells, and text boxes.
    // Put CR and LF in different style runs to catch boundary normalization.
    for kind in ["body", "cell", "textbox"] {
        let mut d = blank();
        let mut italic = d.document().doc_info.char_shapes[0].clone();
        italic.italic = true;
        italic.raw_data = None;
        d.document_mut().doc_info.char_shapes.push(italic);
        let mut p = Paragraph::new_empty_like(&d.document().sections[0].paragraphs[0]);
        p.insert_text_at(0, "A😀\r\nB\tC\rD\nE<&\"\\");
        p.apply_char_shape_range(2, 3, 1);
        let mut host = Paragraph::new_empty_like(&p);
        match kind {
            "body" => host = p,
            "cell" => {
                let mut cell = Cell::new_empty(0, 0, 10000, 6000, 0);
                cell.paragraphs = vec![p];
                let mut table = Table {
                    row_count: 1,
                    col_count: 1,
                    cells: vec![cell],
                    row_sizes: vec![1],
                    ..Default::default()
                };
                table.common.width = 10000;
                table.common.height = 6000;
                table.rebuild_grid();
                host.controls.push(Control::Table(Box::new(table)));
                host.char_count += 8;
            }
            "textbox" => {
                let mut rect = RectangleShape {
                    drawing: DrawingObjAttr {
                        text_box: Some(TextBox {
                            paragraphs: vec![p],
                            ..Default::default()
                        }),
                        ..Default::default()
                    },
                    ..Default::default()
                };
                rect.common.width = 10000;
                rect.common.height = 6000;
                host.controls
                    .push(Control::Shape(Box::new(ShapeObject::Rectangle(rect))));
                host.char_count += 8;
            }
            _ => unreachable!(),
        }
        d.document_mut().sections[0].paragraphs = vec![host];
        let mut expected = vec![];
        texts(&d.document().sections[0].paragraphs, &mut expected);
        for _ in 0..2 {
            d = DocumentCore::from_bytes(&d.export_hwpx_native().unwrap()).unwrap();
            let mut actual = vec![];
            texts(&d.document().sections[0].paragraphs, &mut actual);
            assert_eq!(
                actual, expected,
                "{kind} HWPX must preserve exact control characters"
            );
        }
    }
    println!("contexts: body/cell/textbox, split CR/LF style runs, 2 cold saves each");
}
fn main() {
    match std::env::args().nth(1).as_deref() {
        Some("getter") => getter(),
        Some("roundtrip") => roundtrip(),
        Some("contexts") => contexts(),
        _ => {
            getter();
            roundtrip();
            contexts();
        }
    }
}

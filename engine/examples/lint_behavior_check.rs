//! Exercise the actual editor transactions and HWPX ellipse parser after lint cleanup.
use base64::Engine;
use rhwp::{
    document_core::DocumentCore,
    model::{
        control::Control,
        shape::{HorzRelTo, ShapeObject, VertRelTo},
        Point,
    },
};
use serde_json::{json, Value};

fn events(d: &DocumentCore) -> Value {
    serde_json::from_str::<Value>(&d.serialize_event_log()).unwrap()["events"].clone()
}
fn texts(d: &DocumentCore) -> Vec<String> {
    d.document().sections[0]
        .paragraphs
        .iter()
        .map(|p| p.text.clone())
        .collect()
}
fn pictures(d: &DocumentCore) -> Vec<(u16, Vec<u8>)> {
    d.document()
        .bin_data_content
        .iter()
        .map(|b| (b.id, b.data.load()))
        .collect()
}
fn fixture(batch: bool) -> DocumentCore {
    let mut d = DocumentCore::new_empty();
    d.create_blank_document_native().unwrap();
    d.insert_text_native(0, 0, 0, "앞😀 그림 문단과 뒤 문단")
        .unwrap();
    d.split_paragraph_native(0, 0, 7, None).unwrap();
    let png = base64::engine::general_purpose::STANDARD.decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j9ZkAAAAASUVORK5CYII=").unwrap();
    for x in [0, 9000] {
        d.insert_picture_native(
            0,
            0,
            0,
            &[],
            &png,
            3600,
            2400,
            1,
            1,
            "png",
            "synthetic",
            None,
            None,
        )
        .unwrap();
        if let Some(Control::Picture(p)) = d.document_mut().sections[0].paragraphs[0]
            .controls
            .iter_mut()
            .rev()
            .find(|c| matches!(c, Control::Picture(_)))
        {
            p.common.horizontal_offset = x;
            p.common.vert_rel_to = VertRelTo::Para;
            p.common.horz_rel_to = HorzRelTo::Para;
            p.common.attr = (p.common.attr & !((3 << 3) | (7 << 8))) | (2 << 3) | (3 << 8);
        }
    }
    d.begin_batch_native().unwrap();
    if !batch {
        d.end_batch_native().unwrap();
    }
    d.insert_text_native(0, 1, 0, "시작").unwrap();
    assert_eq!(
        events(&d),
        json!([{"type":"TextInserted","section":0,"para":1,"offset":0,"len":2}])
    );
    // A fresh supported picture chain makes all four public APIs use their staged path.
    for p in &mut d.document_mut().sections[0].paragraphs {
        p.line_segs.clear();
    }
    d
}
fn ellipse(d: &DocumentCore) -> Value {
    let shape = d.document().sections[0]
        .paragraphs
        .iter()
        .flat_map(|p| &p.controls)
        .find_map(|c| match c {
            Control::Shape(s) => match s.as_ref() {
                ShapeObject::Ellipse(e) => Some(e),
                _ => None,
            },
            _ => None,
        })
        .unwrap();
    json!({"attr":shape.attr,"center":[shape.center.x,shape.center.y],"axis1":[shape.axis1.x,shape.axis1.y],"axis2":[shape.axis2.x,shape.axis2.y],
        "start1":[shape.start1.x,shape.start1.y],"end1":[shape.end1.x,shape.end1.y],"start2":[shape.start2.x,shape.start2.y],"end2":[shape.end2.x,shape.end2.y],
        "width":shape.common.width,"height":shape.common.height,"description":shape.common.description})
}
fn main() {
    let out = std::env::args().nth(1).expect("OUTPUT_DIR");
    std::fs::create_dir_all(&out).unwrap();
    let (mut cases, mut reopens, mut history) = (0, 0, 0);
    for batch in [false, true] {
        for op in 0..4 {
            let mut d = fixture(batch);
            let before = texts(&d);
            let resources = pictures(&d);
            let undo = d.save_snapshot_native();
            let len = d.document().sections[0].paragraphs[0].text.chars().count();
            let expected = match op {
                0 => {
                    d.apply_char_format_native(0, 0, 0, len, "{\"fontSize\":1400,\"bold\":true}")
                        .unwrap();
                    json!({"type":"CharFormatChanged","section":0,"para":0,"start":0,"end":len})
                }
                1 => {
                    d.apply_para_format_native(
                        0,
                        0,
                        "{\"spacingBefore\":300,\"spacingAfter\":240,\"marginLeft\":800}",
                    )
                    .unwrap();
                    json!({"type":"ParaFormatChanged","section":0,"para":0})
                }
                2 => {
                    d.split_paragraph_native(0, 0, 3, None).unwrap();
                    json!({"type":"ParagraphSplit","section":0,"para":0,"offset":3})
                }
                3 => {
                    d.merge_paragraph_native(0, 1).unwrap();
                    json!({"type":"ParagraphMerged","section":0,"para":1})
                }
                _ => unreachable!(),
            };
            assert_eq!(
                events(&d),
                json!([{"type":"TextInserted","section":0,"para":1,"offset":0,"len":2},expected])
            );
            assert!(
                d.document().sections[0]
                    .paragraphs
                    .iter()
                    .all(|p| !p.line_segs.is_empty()),
                "staged chain publishes successor rows: batch={batch} op={op}"
            );
            let all_events = events(&d);
            let ended: Value = serde_json::from_str(&d.end_batch_native().unwrap()).unwrap();
            assert_eq!(ended["events"], all_events);
            assert_eq!(events(&d), json!([]));
            let after = texts(&d);
            assert_eq!(before.concat(), after.concat());
            assert_eq!(pictures(&d), resources);
            let redo = d.save_snapshot_native();
            d.restore_snapshot_native(undo).unwrap();
            assert_eq!(texts(&d), before);
            d.restore_snapshot_native(redo).unwrap();
            assert_eq!(texts(&d), after);
            history += 2;
            for (fmt, data) in [
                ("hwp", d.export_hwp_with_adapter_snapshot().unwrap()),
                ("hwpx", d.export_hwpx_native().unwrap()),
            ] {
                let r = DocumentCore::from_bytes(&data).unwrap();
                assert_eq!(texts(&r), after);
                assert_eq!(pictures(&r), resources);
                std::fs::write(format!("{out}/event-{batch}-{op}.{fmt}"), data).unwrap();
                reopens += 1;
            }
            d.discard_snapshot_native(undo);
            d.discard_snapshot_native(redo);
            cases += 1;
        }
    }
    let mut ellipse_cases = 0;
    for attr in [0_u32, 1, 3, 3 | (1 << 8), 3 | (2 << 8)] {
        let mut d = DocumentCore::new_empty();
        d.create_blank_document_native().unwrap();
        d.create_shape_control_native(
            0,
            0,
            0,
            12000,
            9000,
            300,
            450,
            true,
            "InFrontOfText",
            "ellipse",
            false,
            false,
            &[],
        )
        .unwrap();
        for c in &mut d.document_mut().sections[0].paragraphs[0].controls {
            if let Control::Shape(s) = c {
                if let ShapeObject::Ellipse(e) = s.as_mut() {
                    e.attr = attr;
                    e.common.description = "synthetic ellipse".into();
                    e.center = Point { x: 6100, y: 4200 };
                    e.axis1 = Point { x: 11800, y: 4300 };
                    e.axis2 = Point { x: 6000, y: 8800 };
                    e.start1 = Point { x: 11200, y: 2500 };
                    e.end1 = Point { x: 4700, y: 500 };
                    e.start2 = Point { x: 300, y: 4100 };
                    e.end2 = Point { x: 6100, y: 8400 };
                }
            }
        }
        let expected = ellipse(&d);
        let data = d.export_hwpx_native().unwrap();
        let parsed = DocumentCore::from_bytes(&data).unwrap();
        assert_eq!(
            ellipse(&parsed),
            expected,
            "explicit HWPX ellipse fields attr={attr}"
        );
        for data in [
            parsed.export_hwpx_native().unwrap(),
            parsed.export_hwp_with_adapter_snapshot().unwrap(),
        ] {
            let r = DocumentCore::from_bytes(&data).unwrap();
            assert_eq!(ellipse(&r), expected);
            reopens += 1;
        }
        ellipse_cases += 1;
    }
    let proof = json!({"staged_event_cases":cases,"staged_event_order_and_values_preserved":true,"ellipse_cases":ellipse_cases,
        "two_format_reopens":reopens,"snapshot_undo_redo_operations":history,"native_GUI_verified":false,"physical_IME_verified":false});
    std::fs::write(
        format!("{out}/lint-behavior-proof.json"),
        serde_json::to_vec_pretty(&proof).unwrap(),
    )
    .unwrap();
    println!("{proof}");
}

//! Field-value mutation must reject unsupported ownership before touching any bytes.
use rhwp::{
    document_core::DocumentCore,
    model::control::{Control, UnknownControl},
};
use serde_json::{json, Value};
use std::path::Path;

fn state(d: &DocumentCore) -> String {
    format!("{:?}", d.document())
}
fn view(d: &DocumentCore) -> Value {
    json!(d.document().sections.iter().map(|s|s.paragraphs.iter().map(|p|json!({
        "text":p.text,"style":p.style_id,"para":p.para_shape_id,
        "chars":(0..p.text.chars().count()).map(|i|p.char_shape_id_at(i)).collect::<Vec<_>>(),
        "positions":p.control_text_positions(),"ranges":p.field_ranges,
        "notes":p.controls.iter().filter_map(|c|match c {Control::Footnote(n)=>Some(json!({"number":n.number,"paragraphs":n.paragraphs.iter().map(|p|json!({"text":p.text,"style":p.style_id,"para":p.para_shape_id,"chars":(0..p.text.chars().count()).map(|i|p.char_shape_id_at(i)).collect::<Vec<_>>(),"controls":p.controls})).collect::<Vec<_>>()})),_=>None}).collect::<Vec<_>>()
    })).collect::<Vec<_>>()).collect::<Vec<_>>())
}
fn history_state(d: &DocumentCore) -> String {
    fn clear(ps: &mut [rhwp::model::paragraph::Paragraph]) {
        for p in ps {
            p.single_line_overflow_memo.clear();
            for c in &mut p.controls {
                match c {
                    Control::Footnote(n) => clear(&mut n.paragraphs),
                    Control::Endnote(n) => clear(&mut n.paragraphs),
                    _ => {}
                }
            }
        }
    }
    let mut doc = d.document().clone();
    for s in &mut doc.sections {
        clear(&mut s.paragraphs);
    }
    format!("{doc:?}")
}
fn reopen(d: &DocumentCore, out: &Path, label: &str) {
    for (ext, bytes) in [
        ("hwp", d.export_hwp_native().unwrap()),
        ("hwpx", d.export_hwpx_native().unwrap()),
    ] {
        std::fs::write(out.join(format!("{label}.{ext}")), &bytes).unwrap();
        let r = DocumentCore::from_bytes(&bytes).unwrap();
        assert_eq!(view(&r), view(d), "{label} {ext}");
        assert_eq!(
            r.get_field_list_json(),
            d.get_field_list_json(),
            "{label} fields {ext}"
        );
    }
}
fn fixture() -> (DocumentCore, u32) {
    let mut d = DocumentCore::new_empty();
    d.create_blank_document_native().unwrap();
    d.insert_text_native(0, 0, 0, "앞🙂뒤가나끝").unwrap();
    d.apply_char_format_native(0, 0, 0, 1, "{\"italic\":true}")
        .unwrap();
    d.apply_char_format_native(0, 0, 2, 3, "{\"bold\":true}")
        .unwrap();
    for at in [1, 5] {
        let r: Value = serde_json::from_str(&d.insert_footnote_native(0, 0, at).unwrap()).unwrap();
        d.insert_text_in_footnote_native(
            0,
            0,
            r["controlIdx"].as_u64().unwrap() as usize,
            0,
            2,
            "인용🙂각주",
        )
        .unwrap();
    }
    let r: Value = serde_json::from_str(
        &d.insert_click_here_field_at(0, 0, 2, "안내🙂", "memo", "first", true)
            .unwrap(),
    )
    .unwrap();
    let id = r["fieldId"].as_u64().unwrap() as u32;
    d.set_field_value_by_id(id, "옛𐐀값").unwrap();
    (d, id)
}
fn main() {
    let args: Vec<_> = std::env::args().skip(1).collect();
    let out = Path::new(&args[0]);
    let observe = args.get(1).map(String::as_str) == Some("--observe");
    std::fs::create_dir_all(out).unwrap();
    let mut rows = Vec::new();
    let mut fixtures = Vec::new();
    for kind in [
        "inner-note",
        "unknown",
        "bad-end",
        "reversed",
        "bad-axis",
        "nested-field",
        "boundary-clear",
        "begin-collision",
    ] {
        let (mut d, id) = fixture();
        match kind {
            "inner-note" => {
                d.insert_footnote_native(0, 0, 3).unwrap();
                d.document_mut().sections[0].paragraphs[0].field_ranges[0].inner_slot_count = 1;
            }
            "unknown" => {
                let p = &mut d.document_mut().sections[0].paragraphs[0];
                p.controls.insert(
                    0,
                    Control::Unknown(UnknownControl {
                        ctrl_id: 0x78787878,
                    }),
                );
                p.ctrl_data_records.insert(0, None);
                for fr in &mut p.field_ranges {
                    fr.control_idx += 1;
                }
                for co in &mut p.char_offsets {
                    *co += 8;
                }
                p.char_count += 8;
            }
            "bad-end" => {
                let p = &mut d.document_mut().sections[0].paragraphs[0];
                p.field_ranges[0].end_char_idx = p.text.chars().count() + 1;
            }
            "reversed" => {
                d.document_mut().sections[0].paragraphs[0].field_ranges[0].end_char_idx = 1;
            }
            "bad-axis" => {
                d.document_mut().sections[0].paragraphs[0].char_offsets[0] += 1;
            }
            "nested-field" => {
                d.insert_click_here_field_at(0, 0, 3, "nested", "memo", "second", true)
                    .unwrap();
            }
            "boundary-clear" => {
                d.insert_click_here_field_at(0, 0, 5, "隣🙂", "memo", "neighbor", true)
                    .unwrap();
            }
            "begin-collision" => {
                d.insert_click_here_field_at(0, 0, 2, "境界🙂", "memo", "neighbor", true)
                    .unwrap();
            }
            _ => unreachable!(),
        }
        if matches!(
            kind,
            "inner-note" | "unknown" | "nested-field" | "boundary-clear" | "begin-collision"
        ) {
            for ext in if kind == "unknown" {
                vec!["hwp"]
            } else {
                vec!["hwp", "hwpx"]
            } {
                let bytes = if ext == "hwp" {
                    d.export_hwp_native().unwrap()
                } else {
                    d.export_hwpx_native().unwrap()
                };
                let file = out.join(format!("{kind}.{ext}"));
                std::fs::write(&file, bytes).unwrap();
                fixtures.push(json!({"kind":kind,"file":file,"id":id,"value":if kind=="boundary-clear" {""}else{"새🙂"}}));
            }
        }
        // Synthetic sentinel makes raw-stream invalidation observable even for malformed IR.
        d.document_mut().sections[0].raw_stream = Some(vec![0x43, 0x50, 0x42, 0x4b]);
        let before = state(&d);
        let before_view = view(&d);
        let events = d.serialize_event_log();
        let value = if kind == "boundary-clear" {
            ""
        } else {
            "새🙂"
        };
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            d.set_field_value_by_id(id, value)
        }));
        let panicked = result.is_err();
        let result = result.ok();
        let after = state(&d);
        let row = json!({"kind":kind,"panicked":panicked,"accepted":matches!(result,Some(Ok(_))),"error":result.and_then(Result::err).map(|e|e.to_string()),"changed":before!=after,
            "rawStreamPreserved":d.document().sections[0].raw_stream==Some(vec![0x43,0x50,0x42,0x4b]),
            "before":before_view,"after":view(&d),"eventsPreserved":events==d.serialize_event_log()});
        std::fs::write(out.join(format!("{kind}-before.txt")), before.as_bytes()).unwrap();
        std::fs::write(out.join(format!("{kind}-after.txt")), after.as_bytes()).unwrap();
        if !observe {
            assert_eq!(row["panicked"], false, "{kind} must return an error, not panic");
            assert_eq!(row["accepted"], false, "{kind}");
            assert_eq!(before, after, "{kind} entire document");
            assert_eq!(events, d.serialize_event_log());
            assert!(d.set_field_value_by_name("first", value).is_err());
            assert_eq!(state(&d), before, "{kind} by-name entire document");
            assert_eq!(events, d.serialize_event_log());
        }
        rows.push(row);
    }
    let mut positives = Vec::new();
    if !observe {
        for adjacent in [false, true] {
            let (mut d, id) = fixture();
            let neighbor = if adjacent {
                let r: Value = serde_json::from_str(
                    &d.insert_click_here_field_at(0, 0, 5, "隣🙂", "memo", "neighbor", true)
                        .unwrap(),
                )
                .unwrap();
                Some(r["fieldId"].as_u64().unwrap() as u32)
            } else {
                None
            };
            for ext in ["hwp", "hwpx"] {
                let file = out.join(format!("supported-{adjacent}.{ext}"));
                let b = if ext == "hwp" {
                    d.export_hwp_native().unwrap()
                } else {
                    d.export_hwpx_native().unwrap()
                };
                std::fs::write(&file, b).unwrap();
                fixtures.push(json!({"kind":"supported","file":file,"id":id,"adjacent":adjacent,"neighbor":neighbor}));
            }
            for (i, value) in ["새🙂", "", "𐐀값"].into_iter().enumerate() {
                if adjacent && value.is_empty() {
                    let before = state(&d);
                    assert!(d.set_field_value_by_id(id, value).is_err());
                    assert_eq!(state(&d), before);
                    continue;
                }
                let before = history_state(&d);
                let snap = d.save_snapshot_native();
                if i % 2 == 0 {
                    d.set_field_value_by_id(id, value).unwrap();
                } else {
                    d.set_field_value_by_name("first", value).unwrap();
                }
                if let Some(n) = neighbor {
                    let fs: Value = serde_json::from_str(&d.get_field_list_json()).unwrap();
                    assert_eq!(
                        fs.as_array()
                            .unwrap()
                            .iter()
                            .find(|f| f["fieldId"].as_u64() == Some(n as u64))
                            .unwrap()["value"],
                        ""
                    );
                }
                let after = history_state(&d);
                let redo = d.save_snapshot_native();
                d.restore_snapshot_native(snap).unwrap();
                assert_eq!(history_state(&d), before, "undo {adjacent} {i}");
                d.restore_snapshot_native(redo).unwrap();
                assert_eq!(history_state(&d), after, "redo {adjacent} {i}");
                reopen(&d, out, &format!("supported-{adjacent}-{i}"));
                positives.push(json!({"adjacent":adjacent,"value":value,"after":view(&d)}));
            }
        }
    }
    std::fs::write(
        out.join("manifest.json"),
        serde_json::to_vec_pretty(&fixtures).unwrap(),
    )
    .unwrap();
    std::fs::write(
        out.join("proof.json"),
        serde_json::to_vec_pretty(&json!({"observe":observe,"unsupported":rows,"supported":positives,"reopens":positives.len()*2,"snapshotUndoRedo":positives.len()*2})).unwrap(),
    )
    .unwrap();
    println!(
        "{}",
        json!({"observe":observe,"cases":rows.len(),"accepted":rows.iter().filter(|r|r["accepted"]==true).count(),"changed":rows.iter().filter(|r|r["changed"]==true).count()})
    );
}

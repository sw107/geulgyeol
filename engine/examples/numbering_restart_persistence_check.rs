//! Hancom-shaped standard list identities, no private wire field or restart reapplication.
use rhwp::{document_core::DocumentCore, model::style::HeadType};
use serde_json::{json, Value};
use std::{fs, path::Path};
fn live(d: &DocumentCore) -> Value {
    let doc = d.document();
    json!({"numberings":doc.doc_info.numberings,"shapes":doc.doc_info.para_shapes,
        "rawDocInfo":doc.doc_info.raw_stream,"dirty":doc.doc_info.raw_stream_dirty,
        "paragraphs":doc.sections.iter().map(|s|json!({"raw":s.raw_stream,"paras":s.paragraphs.iter().map(|p|json!({"text":p.text,"shape":p.para_shape_id,"style":p.style_id,"chars":p.char_shapes,"restart":format!("{:?}",p.numbering_restart)})).collect::<Vec<_>>()})).collect::<Vec<_>>()})
}
fn view(d: &DocumentCore) -> Value {
    let mut layout = (0..d.page_count())
        .map(|p| serde_json::from_str::<Value>(&d.get_page_text_layout_native(p).unwrap()).unwrap())
        .collect::<Vec<_>>();
    let labels = layout
        .iter()
        .flat_map(|page| page["runs"].as_array().unwrap())
        .filter(|r| !r["charStart"].is_number())
        .filter_map(|r| r["text"].as_str())
        .filter(|t| t.ends_with('.') && t.chars().all(|c| c.is_ascii_digit() || c == '.'))
        .map(str::to_string)
        .collect::<Vec<_>>();
    for page in &mut layout {
        for run in page["runs"].as_array_mut().unwrap() {
            run.as_object_mut().unwrap().remove("paraShapeId");
        }
    }
    json!({"labels":labels,"text":d.document().sections[0].paragraphs.iter().map(|p| &p.text).collect::<Vec<_>>(),"layout":layout})
}
fn save(d: &DocumentCore, ext: &str) -> Vec<u8> {
    let a = if ext == "hwp" {
        d.export_hwp_with_adapter_snapshot_with_report()
    } else {
        d.export_hwpx_native_with_report()
    }
    .unwrap();
    assert!(a.content_loss().is_empty());
    a.into_bytes()
}
fn main() {
    let args = std::env::args().collect::<Vec<_>>();
    assert_eq!(args.len(), 3);
    let out = Path::new(&args[2]);
    assert!(!out.exists());
    fs::create_dir_all(out).unwrap();
    let input = fs::read(&args[1]).unwrap();
    let mut d = DocumentCore::from_bytes(&input).unwrap();
    assert_eq!(d.document().sections[0].paragraphs.len(), 6);
    d.set_numbering_restart_native(0, 2, 2, 123).unwrap();
    let initial = view(&d);
    assert_eq!(
        initial["labels"],
        json!(["1.", "2.", "123.", "124.", "124.1.", "125."])
    );
    let live_before = live(&d);
    for ext in ["hwpx", "hwp"] {
        let bytes = save(&d, ext);
        fs::write(out.join(format!("first.{ext}")), &bytes).unwrap();
        assert_eq!(live(&d), live_before, "export must not mutate live IR");
    }
    let source_shapes = d.document().doc_info.para_shapes.clone();
    let source_number = d.document().doc_info.numberings[1].clone();
    let mut stages = Vec::new();
    for (i, ext) in ["hwpx", "hwp", "hwpx", "hwp", "hwpx"].iter().enumerate() {
        let b = save(&d, ext);
        fs::write(out.join(format!("reopen-{i}.{ext}")), &b).unwrap();
        d = DocumentCore::from_bytes(&b).unwrap();
        assert!(d.document().sections[0]
            .paragraphs
            .iter()
            .all(|p| p.numbering_restart.is_none()));
        let observed = view(&d);
        assert_eq!(observed, initial);
        for (p, para) in d.document().sections[0].paragraphs.iter().enumerate() {
            let shape = &d.document().doc_info.para_shapes[para.para_shape_id as usize];
            let src = &source_shapes[if p == 4 { 2 } else { 1 }];
            let mut expected = src.clone();
            expected.numbering_id = shape.numbering_id;
            // HWP materializes the duplicated head/level bits; HWPX holds the
            // same semantic values in separate fields. Retain all other bits.
            let encoded_head = 0x1f << 23;
            expected.attr1 = (expected.attr1 & !encoded_head) | (shape.attr1 & encoded_head);
            // The binary path has no separate KEEP_WORD lexical token; its
            // zero break bits (still compared above) carry that same default.
            assert!(matches!(shape.break_latin_word.as_deref(), None | Some("KEEP_WORD")));
            expected.break_latin_word = shape.break_latin_word.clone();
            assert_eq!(&expected, shape);
            assert_eq!(shape.head_type, HeadType::Number);
            let n = &d.document().doc_info.numberings[shape.numbering_id as usize - 1];
            assert_eq!(
                n.heads.iter().map(|h| h.attr & 12).collect::<Vec<_>>(),
                source_number
                    .heads
                    .iter()
                    .map(|h| h.attr & 12)
                    .collect::<Vec<_>>()
            );
            assert_eq!(n.level_start_numbers[0], if p < 2 { 1 } else { 123 });
        }
        stages.push(ext);
    }
    for scenario in ["repeat-restart", "other-list-return"] {
        let mut scenario_doc = DocumentCore::from_bytes(&input).unwrap();
        scenario_doc
            .set_numbering_restart_native(0, 2, 2, 123)
            .unwrap();
        if scenario == "repeat-restart" {
            scenario_doc
                .set_numbering_restart_native(0, 5, 2, 7)
                .unwrap();
        } else {
            scenario_doc
                .apply_para_format_native(
                    0,
                    3,
                    r#"{"headType":"Number","numberingId":1,"paraLevel":0}"#,
                )
                .unwrap();
            scenario_doc
                .set_numbering_restart_native(0, 4, 1, 0)
                .unwrap();
        }
        let expected = view(&scenario_doc);
        assert_eq!(
            expected["labels"],
            if scenario == "repeat-restart" {
                json!(["1.", "2.", "123.", "124.", "124.1.", "7."])
            } else {
                json!(["1.", "2.", "123.", "1.", "123.1.", "124."])
            }
        );
        for ext in ["hwpx", "hwp"] {
            let bytes = save(&scenario_doc, ext);
            fs::write(out.join(format!("{scenario}.{ext}")), &bytes).unwrap();
            let reloaded = DocumentCore::from_bytes(&bytes).unwrap();
            assert_eq!(view(&reloaded), expected);
        }
    }
    let mut toggle_reopens = 0;
    for (name, props) in [
        ("dialog-remove", r#"{"headType":"None","numberingId":0}"#),
        ("toolbar-remove", r#"{"headType":"None"}"#),
        ("bullet", r#"{"headType":"Bullet","numberingId":1,"paraLevel":0}"#),
    ] {
        let mut toggle = DocumentCore::from_bytes(&input).unwrap();
        toggle.document_mut().doc_info.bullets.push(rhwp::model::style::Bullet {
            bullet_char: '●', text_distance: 50, ..Default::default()
        });
        toggle.set_numbering_restart_native(0, 2, 2, 123).unwrap();
        let restart_view = view(&toggle);
        let undo = toggle.save_snapshot_native();
        toggle.apply_para_format_native(0, 2, props).unwrap();
        assert!(toggle.document().sections[0].paragraphs[2].numbering_restart.is_none());
        let off = view(&toggle);
        let redo = toggle.save_snapshot_native();
        toggle.restore_snapshot_native(undo).unwrap();
        assert_eq!(view(&toggle), restart_view);
        toggle.restore_snapshot_native(redo).unwrap();
        assert_eq!(view(&toggle), off);
        for ext in ["hwpx", "hwp"] {
            let bytes = save(&toggle, ext);
            fs::write(out.join(format!("{name}.{ext}")), &bytes).unwrap();
            assert_eq!(view(&DocumentCore::from_bytes(&bytes).unwrap()), off);
            toggle_reopens += 1;
        }
        toggle.apply_para_format_native(0, 2, r#"{"headType":"Number","numberingId":2,"paraLevel":0}"#).unwrap();
        let again = view(&toggle);
        assert_eq!(again["labels"], json!(["1.","2.","3.","4.","4.1.","5."]));
        for ext in ["hwpx", "hwp"] {
            let bytes = save(&toggle, ext);
            fs::write(out.join(format!("{name}-number-again.{ext}")), &bytes).unwrap();
            assert_eq!(view(&DocumentCore::from_bytes(&bytes).unwrap()), again);
            toggle_reopens += 1;
        }
    }
    // Legacy stale snapshots are ignored without mutation, both in the
    // borrowed fast path and while projecting a different active restart.
    for active in [false, true] {
        let mut stale = DocumentCore::from_bytes(&input).unwrap();
        stale.apply_para_format_native(0, 2, r#"{"headType":"None"}"#).unwrap();
        if active { stale.set_numbering_restart_native(0, 5, 2, 7).unwrap(); }
        let expected = view(&stale);
        stale.document_mut().sections[0].paragraphs[2].numbering_restart =
            Some(rhwp::model::paragraph::NumberingRestart::NewStart(123));
        let before = live(&stale);
        for ext in ["hwpx", "hwp"] {
            let bytes = save(&stale, ext);
            assert_eq!(live(&stale), before);
            assert_eq!(view(&DocumentCore::from_bytes(&bytes).unwrap()), expected);
            toggle_reopens += 1;
        }
    }
    // Unverified lower-level / outline NewStart must fail, never invent nwno kinds.
    let mut unsupported = DocumentCore::from_bytes(&input).unwrap();
    unsupported
        .set_numbering_restart_native(0, 4, 2, 123)
        .unwrap();
    assert!(unsupported.export_hwpx_native_with_report().is_err());
    assert!(unsupported
        .export_hwp_with_adapter_snapshot_with_report()
        .is_err());
    let mut overflow = DocumentCore::from_bytes(&input).unwrap();
    overflow.set_numbering_restart_native(0, 2, 2, 65536).unwrap();
    assert!(overflow.export_hwpx_native_with_report().is_err());
    assert!(overflow.export_hwp_with_adapter_snapshot_with_report().is_err());
    let result = json!({"labels":initial["labels"],"stages":stages,"saveReopens":9,"toggleAndStaleReopens":toggle_reopens,"toggleUndoRedoVerified":true,"restartReappliedAfterLoad":false,"liveIRUnchangedOnExport":true,"paragraphFormattingPreserved":true,"continuePreviousAcrossListSwitch":true,"lowerLevelRestartExplicitlyBlocked":true,"outOfRangeStartExplicitlyBlocked":true,"nativeAppUI":false});
    fs::write(
        out.join("proof.json"),
        serde_json::to_vec_pretty(&result).unwrap(),
    )
    .unwrap();
    println!("{result}");
}

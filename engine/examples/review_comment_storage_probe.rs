//! Reproduce the current review-memo storage gap; this is not an authoring API.
//! Synthetic fixtures only. A passing probe means the documented gap still exists.
use rhwp::{
    document_core::DocumentCore,
    model::{
        control::{Control, FieldType, Parameter},
        paragraph::Paragraph,
    },
    parser::tags,
};
use serde_json::{json, Value};
use std::path::Path;

fn view(d: &DocumentCore) -> Value {
    json!({"sections": d.document().sections.iter().map(|s| json!({
        "paragraphs": s.paragraphs.iter().map(|p| json!({
            "text":p.text,"style":p.style_id,"para":p.para_shape_id,
            "charRefs": (0..p.text.chars().count()).map(|i| p.char_shape_id_at(i)).collect::<Vec<_>>(),
            "ranges":p.field_ranges,
            "fields":p.controls.iter().filter_map(|c| match c {Control::Field(f)=>Some(json!({
                "id":f.field_id,"type":format!("{:?}",f.field_type),"command":f.command,
                "memoIndex":f.memo_index,"parameters":f.parameters,
                "memo":f.memo_paragraphs.iter().map(|p|json!({"text":p.text,"style":p.style_id,"para":p.para_shape_id,
                    "charRefs":(0..p.text.chars().count()).map(|i|p.char_shape_id_at(i)).collect::<Vec<_>>()
                })).collect::<Vec<_>>()
            })),_=>None}).collect::<Vec<_>>()
        })).collect::<Vec<_>>(),
        "masterPages":s.section_def.master_pages.len()
    })).collect::<Vec<_>>()})
}
fn memo_texts(d: &DocumentCore) -> Vec<String> {
    d.document()
        .sections
        .iter()
        .flat_map(|s| &s.paragraphs)
        .flat_map(|p| &p.controls)
        .filter_map(|c| match c {
            Control::Field(f) => Some(f),
            _ => None,
        })
        .flat_map(|f| &f.memo_paragraphs)
        .map(|p| p.text.clone())
        .collect()
}
fn anchor_view(d: &DocumentCore) -> Value {
    let p = &d.document().sections[0].paragraphs[0];
    json!({"text":p.text,"style":p.style_id,"para":p.para_shape_id,
        "chars":(0..p.text.chars().count()).map(|i|p.char_shape_id_at(i)).collect::<Vec<_>>()})
}
fn tail_count(d: &DocumentCore) -> usize {
    d.document()
        .sections
        .iter()
        .map(|s| {
            let bytes = rhwp::serializer::body_text::serialize_section(s);
            rhwp::parser::record::Record::read_all(&bytes)
                .unwrap()
                .iter()
                .filter(|r| r.tag_id == tags::HWPTAG_MEMO_LIST)
                .count()
        })
        .sum()
}
fn fixture(count: u32) -> DocumentCore {
    let mut d = DocumentCore::new_empty();
    d.create_blank_document_native().unwrap();
    d.insert_text_native(0, 0, 0, "앞🙂한글𐐀선택뒤보존끝")
        .unwrap();
    d.apply_char_format_native(0, 0, 2, 5, "{\"bold\":true}")
        .unwrap();
    d.apply_char_format_native(0, 0, 5, 8, "{\"italic\":true}")
        .unwrap();
    d.apply_para_format_native(0, 0, "{\"alignment\":\"center\"}")
        .unwrap();
    let anchor = anchor_view(&d);
    for n in 1..=count {
        let (start, end) = if n == 1 { (2, 7) } else { (7, 9) };
        let result: Value = serde_json::from_str(
            &d.insert_body_hyperlink(0, 0, start, end, "https://example.invalid/fixture", "")
                .unwrap(),
        )
        .unwrap();
        let id = result["fieldId"].as_u64().unwrap() as u32;
        let p = &mut d.document_mut().sections[0].paragraphs[0];
        let template = p.clone();
        let f = p
            .controls
            .iter_mut()
            .find_map(|c| match c {
                Control::Field(f) if f.field_id == id => Some(f),
                _ => None,
            })
            .unwrap();
        f.field_type = FieldType::Memo;
        f.ctrl_id = tags::FIELD_MEMO;
        f.memo_index = n;
        // No identity or clock metadata. The command is an explicit synthetic fixture.
        f.command = format!("MEMO/65535/{n}/0/0//\\;;");
        f.parameters.items = vec![
            Parameter::String {
                name: Some("Command".into()),
                value: f.command.clone(),
                preserve_space: false,
            },
            Parameter::Integer {
                name: Some("Number".into()),
                value: n.into(),
            },
        ];
        f.memo_paragraphs = [format!("합성 검토 {n} 한글🙂"), format!("두 번째 줄 {n} 𐐀")]
            .iter()
            .map(|text| {
                let mut body = Paragraph::new_empty_like(&template);
                body.text = text.clone();
                let mut offset = 0;
                body.char_offsets = body
                    .text
                    .chars()
                    .map(|c| {
                        let at = offset;
                        offset += c.len_utf16() as u32;
                        at
                    })
                    .collect();
                body.char_count = offset + 1;
                body
            })
            .collect();
        f.memo_text_direction = Some("HORIZONTAL".into());
    }
    let model = d.document().clone();
    d.set_document(model);
    assert_eq!(
        anchor_view(&d),
        anchor,
        "fixture construction preserves selected text and format"
    );
    d
}
fn save(d: &DocumentCore, out: &Path, label: &str) -> (DocumentCore, DocumentCore) {
    let hwp = d.export_hwp_with_adapter_snapshot_with_report().unwrap();
    let hwpx = d.export_hwpx_native_with_report().unwrap();
    std::fs::write(out.join(format!("{label}.hwp")), hwp.bytes()).unwrap();
    std::fs::write(out.join(format!("{label}.hwpx")), hwpx.bytes()).unwrap();
    std::fs::write(
        out.join(format!("{label}-reports.json")),
        serde_json::to_vec_pretty(&json!({
            "hwp":format!("{:?}",hwp.content_loss()),"hwpx":format!("{:?}",hwpx.content_loss())
        }))
        .unwrap(),
    )
    .unwrap();
    (
        DocumentCore::from_bytes(hwp.bytes()).unwrap(),
        DocumentCore::from_bytes(hwpx.bytes()).unwrap(),
    )
}
fn main() {
    let args: Vec<_> = std::env::args().collect();
    let out = Path::new(&args[1]);
    std::fs::create_dir_all(out).unwrap();
    if args.get(2).is_some_and(|s| s == "--verify-wasm") {
        let mut results = vec![];
        for (file, expected) in [
            ("wasm-from-hwpx.hwpx", 4),
            ("wasm-from-hwpx.hwp", 0),
            ("wasm-from-hwp.hwpx", 2),
            ("wasm-from-hwp.hwp", 0),
        ] {
            let d = DocumentCore::from_bytes(&std::fs::read(out.join(file)).unwrap()).unwrap();
            let texts = memo_texts(&d);
            assert_eq!(texts.len(), expected, "{file}");
            if file == "wasm-from-hwp.hwpx" {
                assert!(texts.iter().all(String::is_empty));
            }
            results.push(json!({"file":file,"memoTexts":texts,"view":view(&d)}));
        }
        std::fs::write(
            out.join("native-wasm-reopen.json"),
            serde_json::to_vec_pretty(&results).unwrap(),
        )
        .unwrap();
        return;
    }
    let mut cases = vec![];
    for count in [1, 2] {
        let d = fixture(count);
        let expected = memo_texts(&d);
        let anchor = anchor_view(&d);
        let (hwp, hwpx) = save(&d, out, &format!("memo-{count}"));
        assert_eq!(
            memo_texts(&hwpx),
            expected,
            "HWPX preserves memo paragraphs"
        );
        assert_eq!(anchor_view(&hwpx), anchor);
        assert_eq!(anchor_view(&hwp), anchor);
        assert!(memo_texts(&hwp).is_empty(), "known HWP5 memo-tail read gap");
        assert_eq!(tail_count(&d), count as usize, "writer emitted memo tails");
        assert_eq!(
            tail_count(&hwp),
            count as usize,
            "unedited raw HWP stream preserves tails"
        );
        assert!(hwp.document().sections[0].paragraphs[0]
            .controls
            .iter()
            .filter_map(|c| match c {
                Control::Field(f) => Some(f),
                _ => None,
            })
            .all(|f| f.field_type == FieldType::Unknown));
        let (second_hwp, second_hwpx) = save(&hwp, out, &format!("memo-{count}-from-hwp"));
        assert_eq!(
            memo_texts(&second_hwpx),
            vec![String::new(); count as usize],
            "fallback invents empty memo subLists instead of restoring contents"
        );
        let mut edited = hwp;
        edited.insert_text_native(0, 0, 0, "수정").unwrap();
        assert_eq!(
            tail_count(&edited),
            0,
            "body edit invalidates raw stream; unowned memo tails disappear"
        );
        let (edited_hwp, _) = save(&edited, out, &format!("memo-{count}-edited-hwp"));
        assert!(memo_texts(&edited_hwp).is_empty());
        let mut snapshot = DocumentCore::from_bytes(&hwpx.export_hwpx_native().unwrap()).unwrap();
        let before = view(&snapshot);
        let old = snapshot.save_snapshot_native();
        if let Control::Field(f) = snapshot.document_mut().sections[0].paragraphs[0]
            .controls
            .iter_mut()
            .find(|c| matches!(c, Control::Field(_)))
            .unwrap()
        {
            let mut replacement = Paragraph::new_empty_like(&f.memo_paragraphs[0]);
            replacement.text = "합성 수정🙂".into();
            let mut offset = 0;
            replacement.char_offsets = replacement
                .text
                .chars()
                .map(|c| {
                    let at = offset;
                    offset += c.len_utf16() as u32;
                    at
                })
                .collect();
            replacement.char_count = offset + 1;
            f.memo_paragraphs[0] = replacement;
        }
        let after = view(&snapshot);
        let new = snapshot.save_snapshot_native();
        snapshot.restore_snapshot_native(old).unwrap();
        assert_eq!(view(&snapshot), before);
        snapshot.restore_snapshot_native(new).unwrap();
        assert_eq!(view(&snapshot), after);
        cases.push(json!({"memoCount":count,"expectedMemoTexts":expected,"before":view(&d),"hwpx":view(&hwpx),
            "hwp":view(&second_hwp),"hwpToHwpx":view(&second_hwpx),"afterBodyEditHwp":view(&edited_hwp),
            "anchorTextAndReferencesPreserved":true,"snapshotIRRestoration":true,
            "writerMemoTailCount":count,"rawHwpMemoTailCount":count,"afterBodyEditMemoTailCount":0,
            "memoAuthoringAPIImplemented":false,"hwpMemoContentRestored":false}));
    }
    let proof = json!({"purpose":"reproduce storage support gap, not verify comment authoring", "cases":cases,"GUIVerified":false,"physicalIMEVerified":false});
    std::fs::write(
        out.join("native-proof.json"),
        serde_json::to_vec_pretty(&proof).unwrap(),
    )
    .unwrap();
    println!("HWPX memo contents and snapshots preserved; HWP memo-tail ownership/content read gap reproduced (1 and 2 memos)");
}

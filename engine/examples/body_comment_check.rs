//! Synthetic body comments: content vs anchor, metadata, references, snapshots, IO.
use rhwp::{
    document_core::DocumentCore,
    model::{
        control::{Control, FieldType, Parameter},
        paragraph::Paragraph,
    },
};
use serde_json::{json, Value};
use std::path::Path;
fn view(d: &DocumentCore) -> Value {
    fn ps(paras: &[Paragraph]) -> Vec<Value> {
        paras.iter().map(|p|json!({"text":p.text,"style":p.style_id,
        "para":p.para_shape_id,"chars":(0..p.text.chars().count()).map(|i|p.char_shape_id_at(i)).collect::<Vec<_>>(),
        "positions":p.control_text_positions(),"ranges":p.field_ranges,"fields":p.controls.iter().filter_map(|c|match c{
        Control::Field(f)=>Some(json!({"id":f.field_id,"type":format!("{:?}",f.field_type),"command":f.command,"index":f.memo_index,"direction":f.memo_text_direction.as_deref().unwrap_or("HORIZONTAL"),
            "parameters":if f.field_type==FieldType::Memo {json!(f.parameters)} else {json!({"name":f.parameters.name.as_deref().filter(|n|!n.is_empty()),"items":f.parameters.items.iter().filter(|v|!matches!(v,Parameter::String{name:Some(n),value,..} if n=="Command" && value==&f.command)).collect::<Vec<_>>()})},"memo":ps(&f.memo_paragraphs)})),_=>None}).collect::<Vec<_>>(),
        "notes":p.controls.iter().filter_map(|c|match c{Control::Footnote(n)=>Some(json!({"number":n.number,"paragraphs":ps(&n.paragraphs)})),_=>None}).collect::<Vec<_>>()
    })).collect()
    }
    json!(d
        .document()
        .sections
        .iter()
        .map(|s| ps(&s.paragraphs))
        .collect::<Vec<_>>())
}
fn memo_ids_preserved(expected: &DocumentCore, actual: &DocumentCore) {
    let all = actual.collect_all_fields();
    for f in expected
        .collect_all_fields()
        .iter()
        .filter(|f| f.field.field_type == FieldType::Memo)
    {
        let other = all
            .iter()
            .find(|v| v.field.field_id == f.field.field_id)
            .unwrap();
        for (i, p) in f.field.memo_paragraphs.iter().enumerate() {
            if let Some(id) = rhwp::model::memo::paragraph_id(p) {
                assert_eq!(
                    rhwp::model::memo::paragraph_id(&other.field.memo_paragraphs[i]),
                    Some(id)
                );
            }
        }
    }
}
fn refs(d: &DocumentCore) -> Value {
    let p = &d.document().sections[0].paragraphs[0];
    json!({"text":p.text,"para":p.para_shape_id,"style":p.style_id,
        "chars":(0..p.text.chars().count()).map(|i|p.char_shape_id_at(i)).collect::<Vec<_>>(),
        "otherParas":view(d)[0].as_array().unwrap()[1..],
        "notes":p.controls.iter().filter_map(|c|match c{Control::Footnote(n)=>Some(format!("{:?}",n)),_=>None}).collect::<Vec<_>>()})
}
fn check_io(d: &DocumentCore, out: &Path, label: &str, hwpx_only: bool) -> usize {
    let before = view(d);
    let model = format!("{:?}", d.document());
    let mut n = 0;
    for ext in ["hwp", "hwpx"] {
        if hwpx_only && ext == "hwp" {
            assert!(d.export_hwp_native().is_err());
            continue;
        }
        let bytes = if ext == "hwp" {
            d.export_hwp_native().unwrap()
        } else {
            d.export_hwpx_native().unwrap()
        };
        std::fs::write(out.join(format!("{label}.{ext}")), &bytes).unwrap();
        let r = DocumentCore::from_bytes(&bytes).unwrap();
        assert_eq!(view(&r), before, "{label}.{ext}");
        memo_ids_preserved(d, &r);
        for f in r
            .collect_all_fields()
            .iter()
            .filter(|f| f.field.field_type == FieldType::Memo)
        {
            let info: Value = serde_json::from_str(
                &r.get_body_comment_at(
                    f.location.section_index,
                    f.location.para_index,
                    r.document().sections[f.location.section_index].paragraphs
                        [f.location.para_index]
                        .field_ranges[f.field_range_index]
                        .start_char_idx,
                )
                .unwrap(),
            )
            .unwrap();
            assert_eq!(
                info["editable"], true,
                "reopened comment remains editable: {info}"
            );
        }
        n += 1;
    }
    assert_eq!(
        format!("{:?}", d.document()),
        model,
        "exports leave live model intact"
    );
    n
}
fn atomic(d: &mut DocumentCore, op: impl FnOnce(&mut DocumentCore) -> bool) {
    let before = format!("{:?}", d.document());
    let events = d.serialize_event_log();
    assert!(op(d));
    assert_eq!(format!("{:?}", d.document()), before);
    assert_eq!(d.serialize_event_log(), events);
}
fn roundtrip(
    d: &mut DocumentCore,
    out: &Path,
    label: &str,
    op: impl FnOnce(&mut DocumentCore),
) -> usize {
    let before = view(d);
    let old = d.save_snapshot_native();
    op(d);
    let after = view(d);
    let newer = d.save_snapshot_native();
    d.restore_snapshot_native(old).unwrap();
    assert_eq!(view(d), before);
    let mut count = check_io(d, out, &format!("{label}-undo"), false);
    d.restore_snapshot_native(newer).unwrap();
    assert_eq!(view(d), after);
    count += check_io(d, out, label, false);
    d.discard_snapshot_native(old);
    d.discard_snapshot_native(newer);
    count
}
fn id(d: &mut DocumentCore, start: usize, end: usize, content: &str) -> u32 {
    let v: Value =
        serde_json::from_str(&d.insert_body_comment(0, 0, start, end, content).unwrap()).unwrap();
    assert_eq!(v["supportedSaveFormats"], json!(["hwp", "hwpx"]));
    v["fieldId"].as_u64().unwrap() as u32
}
fn main() {
    let args: Vec<_> = std::env::args().skip(1).collect();
    let out = Path::new(&args[0]);
    std::fs::create_dir_all(out).unwrap();
    if args.get(1).is_some_and(|a| a == "--verify-wasm") {
        let rows: Vec<Value> =
            serde_json::from_slice(&std::fs::read(out.join("wasm-manifest.json")).unwrap())
                .unwrap();
        for r in &rows {
            let mut expected =
                DocumentCore::from_bytes(&std::fs::read(r["input"].as_str().unwrap()).unwrap())
                    .unwrap();
            for op in r["ops"].as_array().unwrap() {
                match op["kind"].as_str().unwrap() {
                    "insert" => {
                        let v: Value = serde_json::from_str(
                            &expected
                                .insert_body_comment(
                                    0,
                                    0,
                                    op["start"].as_u64().unwrap() as usize,
                                    op["end"].as_u64().unwrap() as usize,
                                    op["content"].as_str().unwrap(),
                                )
                                .unwrap(),
                        )
                        .unwrap();
                        assert_eq!(v["fieldId"], op["id"]);
                    }
                    "update" => {
                        expected
                            .update_body_comment(
                                0,
                                0,
                                op["id"].as_u64().unwrap() as u32,
                                op["content"].as_str().unwrap(),
                            )
                            .unwrap();
                    }
                    "remove" => {
                        expected
                            .remove_body_comment(0, 0, op["id"].as_u64().unwrap() as u32)
                            .unwrap();
                    }
                    "link" => {
                        let v: Value = serde_json::from_str(
                            &expected
                                .insert_body_hyperlink(
                                    0,
                                    0,
                                    op["start"].as_u64().unwrap() as usize,
                                    op["end"].as_u64().unwrap() as usize,
                                    op["url"].as_str().unwrap(),
                                    "",
                                )
                                .unwrap(),
                        )
                        .unwrap();
                        assert_eq!(v["fieldId"], op["id"]);
                    }
                    "delete" => {
                        expected
                            .delete_text_native(
                                0,
                                0,
                                op["at"].as_u64().unwrap() as usize,
                                op["count"].as_u64().unwrap() as usize,
                            )
                            .unwrap();
                    }
                    "body" => {
                        expected
                            .insert_text_native(
                                0,
                                0,
                                op["at"].as_u64().unwrap() as usize,
                                op["text"].as_str().unwrap(),
                            )
                            .unwrap();
                    }
                    _ => panic!("unknown saved operation"),
                }
            }
            let actual =
                DocumentCore::from_bytes(&std::fs::read(r["file"].as_str().unwrap()).unwrap())
                    .unwrap();
            memo_ids_preserved(&expected, &actual);
            assert_eq!(
                view(&actual),
                view(&expected),
                "independent saved-file refs/content/metadata: {}",
                r["file"]
            );
        }
        std::fs::write(
            out.join("native-wasm-proof.json"),
            json!({"independentlyReopened":rows.len(),"allBodyMemoNoteFieldReferences":true})
                .to_string(),
        )
        .unwrap();
        return;
    }
    let seed = Path::new(&args[1]);
    let preserved = Path::new(&args[2]);
    let mut d = DocumentCore::from_bytes(&std::fs::read(seed).unwrap()).unwrap();
    // Normalize the existing synthetic seed's fill-only HWPX import differences once.
    d = DocumentCore::from_bytes(&d.export_hwpx_native().unwrap()).unwrap();
    std::fs::write(out.join("seed.hwpx"), d.export_hwpx_native().unwrap()).unwrap();
    let original = refs(&d);
    let defs = format!("{:?}", d.document().doc_info);
    let mut reopens = check_io(&d, out, "seed", false);
    let mut first = 0;
    reopens += roundtrip(&mut d, out, "insert", |d| {
        first = id(d, 1, 5, "첫째 검토🙂\n\n둘째 줄𐐀\n");
    });
    assert_eq!(refs(&d), original);
    assert_eq!(format!("{:?}", d.document().doc_info), defs);
    let got: Value = serde_json::from_str(&d.get_body_comment_at(0, 0, 1).unwrap()).unwrap();
    assert_eq!(got["author"], "");
    assert!(got["createDateTime"].is_null());
    let mut second = 0;
    reopens += roundtrip(&mut d, out, "adjacent", |d| {
        second = id(d, 5, 8, "두 번째 검토🙂");
    });
    let link: Value = serde_json::from_str(
        &d.insert_body_hyperlink(0, 0, 8, 9, "https://example.invalid/neighbor", "")
            .unwrap(),
    )
    .unwrap();
    let link_id = link["fieldId"].as_u64().unwrap() as u32;
    reopens += roundtrip(&mut d, out, "content", |d| {
        d.update_body_comment(0, 0, first, "주석만 수정🙂\n보존𐐀")
            .unwrap();
    });
    assert_eq!(refs(&d), original);
    let info: Value = serde_json::from_str(&d.get_body_comment_at(0, 0, 2).unwrap()).unwrap();
    assert_eq!(info["selectedText"], "🙂한글𐐀");
    atomic(&mut d, |d| {
        serde_json::from_str::<Value>(
            &d.update_body_comment(0, 0, first, "주석만 수정🙂\n보존𐐀")
                .unwrap(),
        )
        .unwrap()["changed"]
            == false
    });
    reopens += roundtrip(&mut d, out, "remove", |d| {
        d.remove_body_comment(0, 0, first).unwrap();
    });
    assert_eq!(refs(&d), original);
    assert_eq!(
        d.collect_all_fields()
            .iter()
            .find(|f| f.field.field_id == link_id)
            .unwrap()
            .field
            .command,
        "https://example.invalid/neighbor"
    );
    atomic(&mut d, |d| d.remove_body_comment(0, 0, first).is_err());
    for range in [(0, 0), (8, 7), (0, 999), (4, 6), (4, 9), (0, 3)] {
        atomic(&mut d, |d| {
            d.insert_body_comment(0, 0, range.0, range.1, "검토")
                .is_err()
        });
    }
    for value in ["", " ", "bad\0", "bad\t", "bad\r", "bad\u{fffe}"] {
        atomic(&mut d, |d| {
            d.update_body_comment(0, 0, second, value).is_err()
        });
    }
    atomic(&mut d, |d| {
        d.update_body_comment(0, 0, link_id, "다른 필드").is_err()
    });
    // Save/reopen, then edit review text and delete by the same source field owner.
    for ext in ["hwp", "hwpx"] {
        let bytes = if ext == "hwp" {
            d.export_hwp_native().unwrap()
        } else {
            d.export_hwpx_native().unwrap()
        };
        let mut r = DocumentCore::from_bytes(&bytes).unwrap();
        let before = refs(&r);
        r.update_body_comment(0, 0, second, "재열기 내용🙂")
            .unwrap();
        reopens += check_io(&r, out, &format!("reopened-{ext}"), false);
        r.remove_body_comment(0, 0, second).unwrap();
        assert_eq!(refs(&r), before);
        reopens += check_io(&r, out, &format!("deleted-{ext}"), false);
    }
    // Ordinary body input updates scalar anchors without touching memo contents or note payloads.
    reopens += roundtrip(&mut d, out, "body-prefix", |d| {
        d.insert_text_native(0, 0, 0, "본문🙂").unwrap();
    });
    reopens += roundtrip(&mut d, out, "body-inside", |d| {
        d.insert_text_native(0, 0, 10, "선택🙂").unwrap();
    });
    let queries = d.collect_all_fields();
    let q = queries.iter().find(|f| f.field.field_id == second).unwrap();
    assert_eq!(q.field.memo_paragraphs[0].text, "두 번째 검토🙂");
    // Known imported authors remain unchanged on review-content edits in both formats.
    for ext in ["hwp", "hwpx"] {
        let mut imported = DocumentCore::from_bytes(
            &std::fs::read(preserved.join(format!("known.{ext}"))).unwrap(),
        )
        .unwrap();
        let f = imported
            .collect_all_fields()
            .into_iter()
            .find(|f| f.field.field_type == FieldType::Memo)
            .unwrap();
        let metadata = f.field.parameters.clone();
        let body = refs(&imported);
        imported
            .update_body_comment(0, 0, f.field.field_id, "원본 작성자 유지🙂")
            .unwrap();
        assert_eq!(
            imported
                .collect_all_fields()
                .iter()
                .find(|x| x.field.field_id == f.field.field_id)
                .unwrap()
                .field
                .parameters,
            metadata
        );
        assert_eq!(refs(&imported), body);
        reopens += check_io(&imported, out, &format!("import-{ext}"), false);
    }
    let mut typed =
        DocumentCore::from_bytes(&std::fs::read(preserved.join("typed-time.hwpx")).unwrap())
            .unwrap();
    let f = typed
        .collect_all_fields()
        .into_iter()
        .find(|f| f.field.field_type == FieldType::Memo)
        .unwrap();
    let metadata = f.field.parameters.clone();
    let result: Value = serde_json::from_str(
        &typed
            .update_body_comment(0, 0, f.field.field_id, "시각 metadata 유지🙂")
            .unwrap(),
    )
    .unwrap();
    assert_eq!(result["supportedSaveFormats"], json!(["hwpx"]));
    assert_eq!(
        typed
            .collect_all_fields()
            .iter()
            .find(|x| x.field.field_id == f.field.field_id)
            .unwrap()
            .field
            .parameters,
        metadata
    );
    reopens += check_io(&typed, out, "typed-time", true);
    let mut vertical =
        DocumentCore::from_bytes(&std::fs::read(preserved.join("known.hwpx")).unwrap()).unwrap();
    let vf = vertical
        .collect_all_fields()
        .into_iter()
        .find(|f| f.field.field_type == FieldType::Memo)
        .unwrap();
    if let Control::Field(f) = vertical.document_mut().sections[0].paragraphs[0]
        .controls
        .iter_mut()
        .find(|c| matches!(c,Control::Field(f) if f.field_id==vf.field.field_id))
        .unwrap()
    {
        f.memo_text_direction = Some("VERTICAL".into());
    }
    let v: Value = serde_json::from_str(
        &vertical
            .update_body_comment(0, 0, vf.field.field_id, "방향 보존🙂")
            .unwrap(),
    )
    .unwrap();
    assert_eq!(v["supportedSaveFormats"], json!(["hwpx"]));
    reopens += check_io(&vertical, out, "vertical", true);
    // Existing HWP/HWPX paragraph IDs survive content edits; unknown tracking suffixes do not.
    for source_id in [1u32, 42] {
        let mut para_id =
            DocumentCore::from_bytes(&std::fs::read(preserved.join("known.hwpx")).unwrap())
                .unwrap();
        let pf = para_id
            .collect_all_fields()
            .into_iter()
            .find(|f| f.field.field_type == FieldType::Memo)
            .unwrap();
        if let Control::Field(f) = para_id.document_mut().sections[0].paragraphs[0]
            .controls
            .iter_mut()
            .find(|c| matches!(c,Control::Field(f) if f.field_id==pf.field.field_id))
            .unwrap()
        {
            f.memo_paragraphs[0].raw_header_extra = vec![0; 10];
            f.memo_paragraphs[0].raw_header_extra[6..10].copy_from_slice(&source_id.to_le_bytes());
        }
        para_id
            .update_body_comment(0, 0, pf.field.field_id, "문단 ID 유지🙂")
            .unwrap();
        for bytes in [
            para_id.export_hwp_native().unwrap(),
            para_id.export_hwpx_native().unwrap(),
        ] {
            let r = DocumentCore::from_bytes(&bytes).unwrap();
            let rf = r
                .collect_all_fields()
                .into_iter()
                .find(|f| f.field.field_id == pf.field.field_id)
                .unwrap();
            assert_eq!(
                &rf.field.memo_paragraphs[0].raw_header_extra[6..10],
                &source_id.to_le_bytes()
            );
        }
        if source_id == 42 {
            std::fs::write(
                out.join("paragraph-id.hwpx"),
                para_id.export_hwpx_native().unwrap(),
            )
            .unwrap();
        }
    }
    let mut extra_refusals = 0;
    for kind in [
        "tracking-index",
        "control-mask",
        "tab",
        "index-mismatch",
        "duplicate-paragraph-id",
    ] {
        let mut x = DocumentCore::from_bytes(&std::fs::read(preserved.join("known.hwpx")).unwrap())
            .unwrap();
        let xf = x
            .collect_all_fields()
            .into_iter()
            .find(|f| f.field.field_type == FieldType::Memo)
            .unwrap();
        if let Control::Field(f) = x.document_mut().sections[0].paragraphs[0]
            .controls
            .iter_mut()
            .find(|c| matches!(c,Control::Field(f) if f.field_id==xf.field.field_id))
            .unwrap()
        {
            match kind {
                "tracking-index" => {
                    f.memo_paragraphs[0].raw_header_extra = vec![0; 12];
                    f.memo_paragraphs[0].raw_header_extra[10] = 42;
                }
                "control-mask" => f.memo_paragraphs[0].control_mask = 1,
                "tab" => {
                    f.memo_paragraphs[0].text.push('\t');
                }
                "duplicate-paragraph-id" => {
                    f.memo_paragraphs[0].raw_header_extra = vec![0; 10];
                    f.memo_paragraphs[0].raw_header_extra[6..10]
                        .copy_from_slice(&42u32.to_le_bytes());
                    f.memo_paragraphs.push(f.memo_paragraphs[0].clone());
                }
                "index-mismatch" => {
                    f.memo_index = 99;
                }
                _ => unreachable!(),
            }
        }
        if kind == "tracking-index" {
            atomic(&mut x, |d| d.export_hwpx_native().is_err());
            std::fs::write(
                out.join("unsupported-tracking.hwp"),
                x.export_hwp_native().unwrap(),
            )
            .unwrap();
        }
        if kind == "index-mismatch" {
            atomic(&mut x, |d| d.export_hwp_native().is_err());
        } else {
            atomic(&mut x, |d| {
                d.update_body_comment(0, 0, xf.field.field_id, "거절")
                    .is_err()
            });
        }
        extra_refusals += 1;
    }
    let mut unsupported = 0;
    for file in [
        "tail-unknown.hwp",
        "list-time.hwp",
        "control-time.hwp",
        "duplicate-index.hwp",
        "orphan-index.hwp",
        "root-unknown.hwp",
        "header-flags.hwp",
        "header-time.hwp",
        "invalid-utf16.hwp",
        "author-slash.hwp",
        "invalid-command.hwp",
        "invalid-marker.hwp",
        "multi-section.hwp",
    ] {
        let mut x =
            DocumentCore::from_bytes(&std::fs::read(preserved.join(file)).unwrap()).unwrap();
        atomic(&mut x, |d| {
            d.insert_body_comment(0, 1, 0, 1, "새 내용").is_err()
        });
        unsupported += 1;
    }
    std::fs::write(out.join("after.hwpx"), d.export_hwpx_native().unwrap()).unwrap();
    let proof = json!({"nativeReopens":reopens,"commentSnapshotOperations":4,"genericBodySnapshotOperations":2,"unsupportedImportedDocuments":unsupported,"unsupportedParagraphReferences":extra_refusals,"verticalHwpxOnly":true,"memoParagraphIdsPreserved":true,"newAuthorEmptyNoCreatedTime":true,"originalAuthorAndTimePreserved":true,"bodyTextStylesNotesNeighborFieldUnchanged":true,"reopenedCommentRemainsEditable":true,"typedTimeHwpxOnly":true,"GUIVerified":false});
    std::fs::write(
        out.join("proof.json"),
        serde_json::to_vec_pretty(&proof).unwrap(),
    )
    .unwrap();
    println!("{proof}");
}

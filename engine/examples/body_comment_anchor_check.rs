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
fn anchors(d: &DocumentCore) -> Vec<(u32, usize, usize, usize)> {
    d.collect_all_fields()
        .iter()
        .filter(|f| f.field.field_type == FieldType::Memo)
        .map(|f| {
            let p = &d.document().sections[0].paragraphs[f.location.para_index];
            let r = &p.field_ranges[f.field_range_index];
            (
                f.field.field_id,
                f.location.para_index,
                r.start_char_idx,
                r.end_char_idx,
            )
        })
        .collect()
}
fn main() {
    let args: Vec<_> = std::env::args().skip(1).collect();
    let out = Path::new(&args[0]);
    std::fs::create_dir_all(out).unwrap();
    if args.get(1).is_some_and(|v| v == "--verify-wasm") {
        let rows: Vec<Value> =
            serde_json::from_slice(&std::fs::read(out.join("wasm-manifest.json")).unwrap())
                .unwrap();
        for row in &rows {
            let mut d =
                DocumentCore::from_bytes(&std::fs::read(row["input"].as_str().unwrap()).unwrap())
                    .unwrap();
            for op in row["ops"].as_array().unwrap() {
                let p = op["p"].as_u64().unwrap_or(0) as usize;
                let at = op["at"].as_u64().unwrap_or(0) as usize;
                match op["kind"].as_str().unwrap() {
                    "insert" => {
                        d.insert_text_native(0, p, at, op["text"].as_str().unwrap())
                            .unwrap();
                    }
                    "delete" => {
                        d.delete_text_native(0, p, at, op["count"].as_u64().unwrap() as usize)
                            .unwrap();
                    }
                    "local" => {
                        d.replace_body_text_local_native(
                            0,
                            p,
                            at,
                            op["count"].as_u64().unwrap() as usize,
                            op["text"].as_str().unwrap(),
                        )
                        .unwrap();
                    }
                    "split" => {
                        d.split_paragraph_native_with_next_style(
                            0,
                            p,
                            at,
                            None,
                            op["next"].as_bool().unwrap_or(false),
                        )
                        .unwrap();
                    }
                    "merge" => {
                        d.merge_paragraph_native(0, p).unwrap();
                    }
                    "range" => {
                        d.delete_range_native(
                            0,
                            p,
                            at,
                            op["endP"].as_u64().unwrap() as usize,
                            op["end"].as_u64().unwrap() as usize,
                            None,
                        )
                        .unwrap();
                    }
                    _ => panic!("op"),
                }
            }
            let a =
                DocumentCore::from_bytes(&std::fs::read(row["file"].as_str().unwrap()).unwrap())
                    .unwrap();
            assert_eq!(view(&a), view(&d), "{}", row["file"]);
            memo_ids_preserved(&d, &a);
        }
        std::fs::write(
            out.join("native-wasm-proof.json"),
            json!({"independentSavedReopens":rows.len(),"refsStylesMetadataAnchors":true})
                .to_string(),
        )
        .unwrap();
        return;
    }
    let seed = std::fs::read(&args[1]).unwrap();
    let mut plain = DocumentCore::from_bytes(&seed).unwrap();
    let cs: Vec<_> = plain.document().sections[0].paragraphs[0]
        .controls
        .iter()
        .enumerate()
        .filter_map(|(i, c)| matches!(c, Control::Footnote(_)).then_some(i))
        .collect();
    for i in cs.into_iter().rev() {
        plain.delete_footnote_native(0, 0, i).unwrap();
    }
    let plain = plain.export_hwpx_native().unwrap();
    std::fs::write(out.join("plain-seed.hwpx"), &plain).unwrap();
    let mut reopens = 0;
    let mut normal = 0;
    let mut refused = 0;
    for (name, bytes) in [("plain", plain), ("notes", seed)] {
        let mut base = DocumentCore::from_bytes(&bytes).unwrap();
        base.insert_body_comment(0, 0, 1, 5, "첫째 원본🙂").unwrap();
        base.insert_body_comment(0, 0, 5, 8, "인접 원본한글")
            .unwrap();
        std::fs::write(
            out.join(format!("{name}-comments.hwpx")),
            base.export_hwpx_native().unwrap(),
        )
        .unwrap();
        for (kind, at, count, text) in [
            ("insert", 0, 0, "앞🙂"),
            ("insert", 1, 0, "경계한"),
            ("insert", 2, 0, "안𐐀"),
            ("insert", 5, 0, "인접🙂"),
            ("insert", 8, 0, "끝한"),
            ("insert", 10, 0, "뒤🙂"),
            ("delete", 0, 1, ""),
            ("delete", 1, 1, ""),
            ("delete", 2, 2, ""),
            ("delete", 4, 2, ""),
            ("delete", 5, 3, ""),
            ("delete", 8, 2, ""),
            ("delete", 1, 7, ""),
            ("local", 2, 1, "조합🙂"),
        ] {
            let mut d = DocumentCore::from_bytes(&bytes).unwrap();
            d.insert_body_comment(0, 0, 1, 5, "첫째 원본🙂").unwrap();
            d.insert_body_comment(0, 0, 5, 8, "인접 원본한글").unwrap();
            let a = anchors(&d);
            let old = d.save_snapshot_native();
            let before = view(&d);
            if kind == "delete" && [(5, 3), (1, 7)].contains(&(at, count)) {
                atomic(&mut d, |x| x.delete_text_native(0, 0, at, count).is_err());
                refused += 1;
                d.discard_snapshot_native(old);
                continue;
            }
            match kind {
                "insert" => {
                    d.insert_text_native(0, 0, at, text).unwrap();
                }
                "delete" => {
                    d.delete_text_native(0, 0, at, count).unwrap();
                }
                _ => {
                    d.replace_body_text_local_native(0, 0, at, count, text)
                        .unwrap();
                }
            }
            let n = text.chars().count();
            let map = |x: usize| {
                if x >= at + count {
                    x - count
                } else if x > at {
                    at
                } else {
                    x
                }
            };
            let expected: Vec<_> = a
                .iter()
                .map(|&(id, p, start, end)| {
                    let mut s = map(start);
                    let mut e = map(end);
                    if n > 0 {
                        if at <= s {
                            s += n;
                            e += n;
                        } else if at < e {
                            e += n;
                        }
                    }
                    (id, p, s, e)
                })
                .collect();
            assert_eq!(anchors(&d), expected, "{name} {kind} {at}");
            let newer = d.save_snapshot_native();
            let after = view(&d);
            reopens += check_io(&d, out, &format!("{name}-{kind}-{at}"), false);
            d.restore_snapshot_native(old).unwrap();
            assert_eq!(view(&d), before);
            d.restore_snapshot_native(newer).unwrap();
            assert_eq!(view(&d), after);
            d.discard_snapshot_native(old);
            d.discard_snapshot_native(newer);
            normal += 1;
        }
        for at in [0, 1, 2, 5, 6, 8, 11] {
            let mut d = DocumentCore::from_bytes(&base.export_hwpx_native().unwrap()).unwrap();
            let before = view(&d);
            if name == "notes" || [2, 6].contains(&at) {
                atomic(&mut d, |x| {
                    x.split_paragraph_native(0, 0, at, None).is_err()
                });
                refused += 1;
            } else {
                d.split_paragraph_native(0, 0, at, None).unwrap();
                let expected: Vec<_> = anchors(&base)
                    .iter()
                    .map(|&(id, p, s, e)| {
                        if s >= at {
                            (id, p + 1, s - at, e - at)
                        } else {
                            (id, p, s, e)
                        }
                    })
                    .collect();
                assert_eq!(anchors(&d), expected);
                reopens += check_io(&d, out, &format!("split-{at}"), false);
                d.merge_paragraph_native(0, 1).unwrap();
                if view(&d) != before {
                    std::fs::write(
                        out.join("merge-diagnostic.json"),
                        json!({"at":at,"before":before,"after":view(&d)}).to_string(),
                    )
                    .unwrap();
                }
                assert_eq!(view(&d), before);
                reopens += check_io(&d, out, &format!("merge-{at}"), false);
                normal += 2;
            }
        }
        let mut d = DocumentCore::from_bytes(&base.export_hwpx_native().unwrap()).unwrap();
        atomic(&mut d, |x| {
            x.delete_range_native(0, 0, 0, 1, 1, None).is_err()
        });
        refused += 1;
    }
    // Empty anchors remain empty when new body text is inserted at their position.
    let mut single =
        DocumentCore::from_bytes(&std::fs::read(out.join("plain-comments.hwpx")).unwrap()).unwrap();
    let second = anchors(&single)[1].0;
    single.remove_body_comment(0, 0, second).unwrap();
    std::fs::write(
        out.join("single-comments.hwpx"),
        single.export_hwpx_native().unwrap(),
    )
    .unwrap();
    single.delete_text_native(0, 0, 1, 4).unwrap();
    assert_eq!(anchors(&single)[0].2, anchors(&single)[0].3);
    reopens += check_io(&single, out, "empty", false);
    single.insert_text_native(0, 0, 1, "새🙂").unwrap();
    assert_eq!((anchors(&single)[0].2, anchors(&single)[0].3), (3, 3));
    reopens += check_io(&single, out, "empty-insert", false);
    normal += 2;
    for file in ["duplicate-id.hwpx", "overlap.hwpx"] {
        let bytes = std::fs::read(out.join(file)).unwrap();
        for op in 0..6 {
            let mut d = DocumentCore::from_bytes(&bytes).unwrap();
            atomic(&mut d, |x| match op {
                0 => x.insert_text_native(0, 0, 0, "거절").is_err(),
                1 => x.delete_text_native(0, 0, 0, 1).is_err(),
                2 => x
                    .replace_body_text_local_native(0, 0, 0, 1, "거절")
                    .is_err(),
                3 => x.split_paragraph_native(0, 0, 0, None).is_err(),
                4 => x.merge_paragraph_native(0, 1).is_err(),
                _ => x.delete_range_native(0, 0, 0, 0, 1, None).is_err(),
            });
            refused += 1;
        }
    }
    for file in [
        "invalid-marker.hwp",
        "orphan-index.hwp",
        "invalid-command.hwp",
    ] {
        let bytes = std::fs::read(Path::new("../memo-preservation-qa/native").join(file)).unwrap();
        let mut d = DocumentCore::from_bytes(&bytes).unwrap();
        atomic(&mut d, |x| x.insert_text_native(0, 0, 0, "거절").is_err());
        refused += 1;
    }
    let proof = json!({"nativeNormal":normal,"nativeReopens":reopens,"atomicRefusals":refused,"splitInsideOrNotesRefused":true,"crossParagraphDeleteRefused":true,"GUIVerified":false});
    std::fs::write(
        out.join("proof.json"),
        serde_json::to_vec_pretty(&proof).unwrap(),
    )
    .unwrap();
    println!("{proof}");
}

//! Synthetic-only HWP memo load/save ownership, metadata, opaque records and snapshots.
use rhwp::{
    document_core::DocumentCore,
    model::{
        control::{Control, FieldType, Parameter},
        memo,
        paragraph::Paragraph,
    },
    parser::{cfb_reader::CfbReader, record::Record, tags},
    serializer::{body_text::serialize_section, record_writer::write_records},
};
use serde_json::{json, Value};
use std::path::Path;

fn view(d: &DocumentCore) -> Value {
    fn paragraphs(ps: &[Paragraph]) -> Vec<Value> {
        ps.iter().map(|p|json!({"text":p.text,"style":p.style_id,"para":p.para_shape_id,
        "chars":(0..p.text.chars().count()).map(|i|p.char_shape_id_at(i)).collect::<Vec<_>>(),"ranges":p.field_ranges,
        "fields":p.controls.iter().filter_map(|c|match c {Control::Field(f)=>Some(json!({"id":f.field_id,"type":format!("{:?}",f.field_type),"command":f.command,"memoIndex":f.memo_index,"memo":paragraphs(&f.memo_paragraphs)})),_=>None}).collect::<Vec<_>>(),
        "notes":p.controls.iter().filter_map(|c|match c {Control::Footnote(n)=>Some(json!({"number":n.number,"paragraphs":paragraphs(&n.paragraphs)})),_=>None}).collect::<Vec<_>>()
    })).collect()
    }
    json!(d
        .document()
        .sections
        .iter()
        .map(|s| paragraphs(&s.paragraphs))
        .collect::<Vec<_>>())
}
fn tails(d: &DocumentCore) -> Vec<Vec<u8>> {
    d.document()
        .sections
        .iter()
        .filter_map(|s| s.memo_tail.as_ref().map(|t| t.bytes.clone()))
        .collect()
}
fn raw_controls(d: &DocumentCore) -> Vec<Vec<u8>> {
    d.document()
        .sections
        .iter()
        .flat_map(|s| &s.paragraphs)
        .flat_map(|p| &p.controls)
        .filter_map(|c| match c {
            Control::Field(f) => f
                .hwp_memo_control
                .as_ref()
                .map(|o| serde_json::to_vec(&o.records).unwrap()),
            _ => None,
        })
        .collect()
}
fn fixture(seed: &Path) -> DocumentCore {
    let loaded = DocumentCore::from_bytes(&std::fs::read(seed).unwrap()).unwrap();
    assert_eq!(
        loaded.document().sections[0]
            .memo_tail
            .as_ref()
            .unwrap()
            .entries
            .iter()
            .filter(|e| e.owner_id.is_some())
            .count(),
        2,
        "loaded memo ownership"
    );
    let mut d = DocumentCore::new_empty();
    d.create_blank_document_native().unwrap();
    d.insert_text_native(0, 0, 0, "앞🙂한글𐐀선택뒤보존끝주")
        .unwrap();
    d.apply_char_format_native(0, 0, 2, 5, "{\"bold\":true}")
        .unwrap();
    d.apply_char_format_native(0, 0, 5, 8, "{\"italic\":true}")
        .unwrap();
    for at in [0, 12] {
        let r: Value = serde_json::from_str(&d.insert_footnote_native(0, 0, at).unwrap()).unwrap();
        d.insert_text_in_footnote_native(
            0,
            0,
            r["controlIdx"].as_u64().unwrap() as usize,
            0,
            2,
            "각주 보존🙂",
        )
        .unwrap();
    }
    for (n, start, end) in [(1, 2, 7), (2, 7, 9)] {
        let r: Value = serde_json::from_str(
            &d.insert_body_hyperlink(
                0,
                0,
                start,
                end,
                "https://example.invalid/synthetic-memo",
                "",
            )
            .unwrap(),
        )
        .unwrap();
        let id = r["fieldId"].as_u64().unwrap() as u32;
        let template = d.document().sections[0].paragraphs[0].clone();
        let f = d.document_mut().sections[0].paragraphs[0]
            .controls
            .iter_mut()
            .find_map(|c| match c {
                Control::Field(f) if f.field_id == id => Some(f),
                _ => None,
            })
            .unwrap();
        f.ctrl_id = tags::FIELD_MEMO;
        f.field_type = FieldType::Memo;
        f.memo_index = n;
        f.command = format!("MEMO/65535/{n}/0/0/합성 작성자{n}🙂/\\;;");
        f.parameters = memo::parameters(&f.command).unwrap();
        f.memo_paragraphs = [format!("합성 검토 {n} 한글🙂"), format!("다음 줄 {n} 𐐀")]
            .iter()
            .map(|text| {
                let mut p = Paragraph::new_empty_like(&template);
                p.text = text.clone();
                let mut offset = 0;
                p.char_offsets = p
                    .text
                    .chars()
                    .map(|c| {
                        let at = offset;
                        offset += c.len_utf16() as u32;
                        at
                    })
                    .collect();
                p.char_count = offset + 1;
                p
            })
            .collect();
        f.memo_text_direction = Some("HORIZONTAL".into());
    }
    d.insert_body_hyperlink(0, 0, 9, 11, "https://example.invalid/adjacent", "")
        .unwrap();
    d.insert_paragraph_native(0, 1).unwrap();
    d.insert_text_native(0, 1, 0, "다른 문단/스타일 보존🙂")
        .unwrap();
    d.apply_style_native(0, 1, 1).unwrap();
    let x = d.export_hwpx_native().unwrap();
    let normalized = DocumentCore::from_bytes(&x).unwrap();
    let h = normalized.export_hwp_with_adapter_snapshot().unwrap();
    DocumentCore::from_bytes(&h).unwrap()
}
fn rewrite(d: &DocumentCore, records: &[Record]) -> Vec<u8> {
    let b = d.export_hwp_native().unwrap();
    let mut c = CfbReader::open(&b).unwrap();
    let mut h = c.read_file_header().unwrap();
    let flags = u32::from_le_bytes(h[36..40].try_into().unwrap()) & !1;
    h[36..40].copy_from_slice(&flags.to_le_bytes());
    let info = c.read_doc_info(d.document().header.compressed).unwrap();
    let body = write_records(records);
    rhwp::serializer::mini_cfb::build_cfb(&[
        ("/FileHeader", &h),
        ("/DocInfo", &info),
        ("/BodyText/Section0", &body),
    ])
    .unwrap()
}
fn records(d: &DocumentCore) -> Vec<Record> {
    Record::read_all(&serialize_section(&d.document().sections[0])).unwrap()
}
fn reopens(d: &DocumentCore, out: &Path, label: &str, hwpx: bool) -> usize {
    let before = format!("{:?}", d.document());
    let mut count = 0;
    for ext in ["hwp", "hwpx"] {
        let b = if ext == "hwp" {
            d.export_hwp_with_adapter_snapshot().unwrap()
        } else if hwpx {
            d.export_hwpx_native().unwrap()
        } else {
            continue;
        };
        std::fs::write(out.join(format!("{label}.{ext}")), &b).unwrap();
        let r = DocumentCore::from_bytes(&b).unwrap();
        assert_eq!(
            view(&r),
            view(d),
            "{label} {ext} text/style/format/field ranges/memo/notes"
        );
        if ext == "hwp" {
            assert_eq!(tails(&r), tails(d));
            assert_eq!(raw_controls(&r), raw_controls(d));
        }
        assert_eq!(
            format!("{:?}", d.document()),
            before,
            "export live model unchanged"
        );
        count += 1;
    }
    count
}
fn no_change(d: &DocumentCore, operation: impl FnOnce(&DocumentCore) -> bool) {
    let before = format!("{:?}", d.document());
    assert!(operation(d));
    assert_eq!(
        format!("{:?}", d.document()),
        before,
        "refused export is atomic"
    );
}
fn main() {
    let args: Vec<_> = std::env::args().skip(1).collect();
    let out = Path::new(&args[0]);
    std::fs::create_dir_all(out).unwrap();
    if args.get(1).is_some_and(|a| a == "--verify-wasm") {
        let manifest: Vec<Value> =
            serde_json::from_slice(&std::fs::read(out.join("wasm-manifest.json")).unwrap())
                .unwrap();
        for row in &manifest {
            let mut expected =
                DocumentCore::from_bytes(&std::fs::read(row["input"].as_str().unwrap()).unwrap())
                    .unwrap();
            if row["edited"].as_bool().unwrap() {
                expected.insert_text_native(0, 0, 0, "본문 수정🙂").unwrap();
            }
            let actual =
                DocumentCore::from_bytes(&std::fs::read(row["file"].as_str().unwrap()).unwrap())
                    .unwrap();
            assert_eq!(view(&actual), view(&expected));
            if row["file"].as_str().unwrap().ends_with(".hwp") && !tails(&expected).is_empty() {
                assert_eq!(tails(&actual), tails(&expected));
                assert_eq!(raw_controls(&actual), raw_controls(&expected));
            }
        }
        std::fs::write(out.join("native-wasm-proof.json"),serde_json::to_vec_pretty(&json!({"independentlyReopened":manifest.len(),"rangesMetadataMemoNotesAndRefs":true})).unwrap()).unwrap();
        return;
    }
    let d = fixture(Path::new(&args[1]));
    std::fs::write(out.join("seed-diagnostics.json"),serde_json::to_vec_pretty(&json!({
        "tails":d.document().sections.iter().filter_map(|s|s.memo_tail.as_ref()).map(|t|json!({"portable":t.portable,"container":t.container_root,"entries":t.entries.iter().map(|e|json!({"index":e.index,"owner":e.owner_id,"portable":e.portable,"paragraphs":e.paragraphs.len()})).collect::<Vec<_>>()})).collect::<Vec<_>>(),
        "records":records(&d).iter().map(|r|json!({"tag":r.tag_id,"level":r.level,"data":r.data})).collect::<Vec<_>>()
    })).unwrap()).unwrap();
    let mut reopens_count = 0;
    reopens_count += reopens(&d, out, "known", true);
    let original = view(&d);
    let source_tails = tails(&d);
    let source_controls = raw_controls(&d);
    let mut edit = DocumentCore::from_bytes(&d.export_hwp_native().unwrap()).unwrap();
    let undo = edit.save_snapshot_native();
    edit.insert_text_native(0, 0, 0, "본문 수정🙂").unwrap();
    assert_eq!(tails(&edit), source_tails);
    assert_eq!(raw_controls(&edit), source_controls);
    reopens_count += reopens(&edit, out, "known-edited", true);
    let changed = view(&edit);
    let redo = edit.save_snapshot_native();
    edit.restore_snapshot_native(undo).unwrap();
    assert_eq!(view(&edit), original);
    reopens_count += reopens(&edit, out, "known-undo", true);
    edit.restore_snapshot_native(redo).unwrap();
    assert_eq!(view(&edit), changed);
    reopens_count += reopens(&edit, out, "known-redo", true);
    for at in [3, 7, 9] {
        let mut interior = DocumentCore::from_bytes(&d.export_hwp_native().unwrap()).unwrap();
        interior.insert_text_native(0, 0, at, "내부🙂").unwrap();
        reopens_count += reopens(&interior, out, &format!("inside-{at}"), true);
    }
    let mut deletion = DocumentCore::from_bytes(&d.export_hwp_native().unwrap()).unwrap();
    deletion.delete_text_native(0, 0, 4, 1).unwrap();
    reopens_count += reopens(&deletion, out, "body-delete", true);
    // Conversion back to HWP reconstructs the same content and explicit Author from Command.
    let x = DocumentCore::from_bytes(&std::fs::read(out.join("known.hwpx")).unwrap()).unwrap();
    let back = DocumentCore::from_bytes(&x.export_hwp_with_adapter_snapshot().unwrap()).unwrap();
    assert_eq!(view(&back), original);
    std::fs::write(
        out.join("known-x-to-h.hwp"),
        back.export_hwp_native().unwrap(),
    )
    .unwrap();
    reopens_count += 1;
    // The source-format tail may live in the final section while its owners live earlier.
    let mut multi = DocumentCore::from_bytes(&d.export_hwp_native().unwrap()).unwrap();
    let tail = multi.document_mut().sections[0].memo_tail.take().unwrap();
    multi.document_mut().sections[0].raw_stream = None;
    let mut last = multi.document().sections[0].clone();
    last.paragraphs = vec![Paragraph::new_empty_like(&last.paragraphs[1])];
    last.memo_tail = Some(tail);
    last.raw_stream = None;
    last.raw_provenance = None;
    multi.document_mut().sections.push(last);
    multi.document_mut().doc_properties.section_count = 2;
    multi.document_mut().doc_info.raw_stream_dirty = true;
    let model = multi.document().clone();
    multi.set_document(model);
    multi.insert_text_native(1, 0, 0, "두 번째 구역🙂").unwrap();
    reopens_count += reopens(&multi, out, "multi-section", true);
    multi.insert_text_native(0, 0, 0, "앞구역 수정🙂").unwrap();
    reopens_count += reopens(&multi, out, "multi-section-edited", true);

    let mut opaque_rows = vec![];
    for kind in [
        "tail-unknown",
        "list-time",
        "control-time",
        "duplicate-index",
        "orphan-index",
        "root-unknown",
        "header-flags",
        "header-time",
        "invalid-utf16",
        "author-slash",
    ] {
        let mut rs = records(&d);
        let memo_idx = rs
            .iter()
            .position(|r| r.tag_id == tags::HWPTAG_MEMO_LIST)
            .unwrap();
        match kind {
            "invalid-utf16" | "author-slash" => {
                let n = rs
                    .iter()
                    .position(|r| {
                        r.tag_id == tags::HWPTAG_CTRL_HEADER
                            && r.data
                                .windows(10)
                                .any(|b| b == [b'M', 0, b'E', 0, b'M', 0, b'O', 0, b'/', 0])
                    })
                    .unwrap();
                if kind == "invalid-utf16" {
                    let at = rs[n]
                        .data
                        .windows(4)
                        .position(|b| b == [0x3d, 0xd8, 0x42, 0xde])
                        .unwrap();
                    rs[n].data[at + 2] = b'a';
                    rs[n].data[at + 3] = 0;
                } else {
                    let count = u16::from_le_bytes(rs[n].data[9..11].try_into().unwrap()) as usize;
                    let units: Vec<_> = rs[n].data[11..11 + count * 2]
                        .chunks_exact(2)
                        .map(|b| u16::from_le_bytes([b[0], b[1]]))
                        .collect();
                    let command = String::from_utf16(&units)
                        .unwrap()
                        .replace("작성자1", "작성자/1");
                    let suffix = rs[n].data[11 + count * 2..].to_vec();
                    rs[n].data.truncate(9);
                    rs[n]
                        .data
                        .extend_from_slice(&(command.encode_utf16().count() as u16).to_le_bytes());
                    rs[n]
                        .data
                        .extend(command.encode_utf16().flat_map(u16::to_le_bytes));
                    rs[n].data.extend(suffix);
                }
                rs[n].size = rs[n].data.len() as u32;
            }
            "root-unknown" => rs.insert(
                memo_idx,
                Record {
                    tag_id: 903,
                    level: 1,
                    size: 11,
                    data: b"opaque-root".to_vec(),
                },
            ),
            "header-flags" | "header-time" => {
                let n = rs
                    .iter()
                    .position(|r| {
                        r.tag_id == tags::HWPTAG_CTRL_HEADER
                            && r.data
                                .windows(10)
                                .any(|b| b == [b'M', 0, b'E', 0, b'M', 0, b'O', 0, b'/', 0])
                    })
                    .unwrap();
                if kind == "header-flags" {
                    rs[n].data[8] = 7;
                } else {
                    rs[n]
                        .data
                        .extend_from_slice(b"QA-time=2024-01-02T03:04:05Z");
                }
                rs[n].size = rs[n].data.len() as u32;
            }
            "tail-unknown" => rs.push(Record {
                tag_id: 901,
                level: 1,
                size: 11,
                data: b"opaque-tail".to_vec(),
            }),
            "list-time" => {
                rs[memo_idx]
                    .data
                    .extend_from_slice(b"QA-CreateDateTime=2024-01-02T03:04:05Z");
                rs[memo_idx].size = rs[memo_idx].data.len() as u32;
            }
            "control-time" => {
                let n = rs
                    .iter()
                    .position(|r| {
                        r.tag_id == tags::HWPTAG_CTRL_HEADER
                            && r.data
                                .windows(10)
                                .any(|b| b == [b'M', 0, b'E', 0, b'M', 0, b'O', 0, b'/', 0])
                    })
                    .unwrap();
                rs.insert(
                    n + 1,
                    Record {
                        tag_id: 902,
                        level: 2,
                        size: 43,
                        data: b"QA-original-time=2024-01-02T03:04:05Z;opaque".to_vec(),
                    },
                );
            }
            "duplicate-index" => {
                let end = rs
                    .iter()
                    .enumerate()
                    .skip(memo_idx + 1)
                    .find(|(_, r)| r.tag_id == tags::HWPTAG_MEMO_LIST)
                    .unwrap()
                    .0;
                let duplicate = rs[memo_idx..end].to_vec();
                rs.extend(duplicate);
            }
            "orphan-index" => {
                rs[memo_idx].data = 99u32.to_le_bytes().to_vec();
            }
            _ => unreachable!(),
        }
        let bytes = rewrite(&d, &rs);
        std::fs::write(out.join(format!("{kind}.hwp")), &bytes).unwrap();
        let mut imported = DocumentCore::from_bytes(&bytes).unwrap();
        let raw = tails(&imported);
        let controls = raw_controls(&imported);
        assert_eq!(
            serialize_section(&imported.document().sections[0]),
            write_records(&rs),
            "unedited body stream exact"
        );
        no_change(&imported, |d| d.export_hwpx_native().is_err());
        imported.insert_text_native(0, 0, 0, "본문 수정🙂").unwrap();
        reopens_count += reopens(&imported, out, &format!("{kind}-edited"), false);
        assert_eq!(tails(&imported), raw);
        assert_eq!(raw_controls(&imported), controls);
        no_change(&imported, |d| d.export_hwpx_native().is_err());
        opaque_rows
            .push(json!({"kind":kind,"hwpOriginalRecordsPreserved":true,"hwpxAtomicRefusal":true}));
    }
    let mut rs = records(&d);
    let text = rs
        .iter_mut()
        .find(|r| r.tag_id == tags::HWPTAG_PARA_TEXT && r.level == 1)
        .unwrap();
    let mut units: Vec<_> = text
        .data
        .chunks_exact(2)
        .map(|b| u16::from_le_bytes([b[0], b[1]]))
        .collect();
    let at = units
        .windows(8)
        .position(|u| u == [4, 0x6d65, 0x0025, 0xff01, 0x00ff, 1, 0, 4])
        .unwrap();
    units[at + 5] = 99;
    text.data = units.into_iter().flat_map(u16::to_le_bytes).collect();
    let bytes = rewrite(&d, &rs);
    std::fs::write(out.join("invalid-marker.hwp"), &bytes).unwrap();
    let mut invalid_marker = DocumentCore::from_bytes(&bytes).unwrap();
    assert_eq!(
        serialize_section(&invalid_marker.document().sections[0]),
        write_records(&rs)
    );
    invalid_marker
        .insert_text_native(0, 0, 0, "본문 수정🙂")
        .unwrap();
    no_change(&invalid_marker, |d| d.export_hwp_native().is_err());
    no_change(&invalid_marker, |d| d.export_hwpx_native().is_err());
    // A memo marker with an unrecognized header command stays opaque with its original bytes.
    let mut rs = records(&d);
    let header = rs
        .iter_mut()
        .find(|r| {
            r.tag_id == tags::HWPTAG_CTRL_HEADER
                && r.data.get(11..19) == Some(&[77, 0, 69, 0, 77, 0, 79, 0])
        })
        .unwrap();
    header.data[11..19].copy_from_slice(&[88, 0, 88, 0, 88, 0, 88, 0]);
    let bytes = rewrite(&d, &rs);
    std::fs::write(out.join("invalid-command.hwp"), &bytes).unwrap();
    let mut invalid_command = DocumentCore::from_bytes(&bytes).unwrap();
    assert_eq!(
        serialize_section(&invalid_command.document().sections[0]),
        write_records(&rs)
    );
    invalid_command
        .insert_text_native(0, 0, 0, "본문 수정🙂")
        .unwrap();
    reopens_count += reopens(&invalid_command, out, "invalid-command-edited", false);
    assert_eq!(tails(&invalid_command), tails(&d));
    no_change(&invalid_command, |d| d.export_hwpx_native().is_err());
    // Existing typed creation-time metadata cannot be silently dropped by an HWP export.
    let mut x = DocumentCore::from_bytes(&std::fs::read(out.join("known.hwpx")).unwrap()).unwrap();
    if let Control::Field(f) = x.document_mut().sections[0].paragraphs[0]
        .controls
        .iter_mut()
        .find(|c| matches!(c,Control::Field(f) if f.field_type==FieldType::Memo))
        .unwrap()
    {
        f.raw_parameters_xml = None;
        f.parameters.items.push(Parameter::String {
            name: Some("CreateDateTime".into()),
            value: "2024-01-02T03:04:05Z".into(),
            preserve_space: false,
        });
    }
    let metadata = x.export_hwpx_native().unwrap();
    std::fs::write(out.join("typed-time.hwpx"), &metadata).unwrap();
    let typed = DocumentCore::from_bytes(&metadata).unwrap();
    no_change(&typed, |d| d.export_hwp_with_adapter_snapshot().is_err());
    let mut invalid = DocumentCore::from_bytes(&d.export_hwp_native().unwrap()).unwrap();
    invalid.document_mut().sections[0]
        .memo_tail
        .as_mut()
        .unwrap()
        .bytes
        .push(1);
    no_change(&invalid, |d| d.export_hwp_native().is_err());
    let mut changed_memo = DocumentCore::from_bytes(&d.export_hwp_native().unwrap()).unwrap();
    if let Control::Field(f) = changed_memo.document_mut().sections[0].paragraphs[0]
        .controls
        .iter_mut()
        .find(|c| matches!(c,Control::Field(f) if f.field_type==FieldType::Memo))
        .unwrap()
    {
        f.command.push_str("changed");
    }
    no_change(&changed_memo, |d| d.export_hwp_native().is_err());
    let proof = json!({"reopens":reopens_count,"bodyEditUndoRedo":true,"crossSectionOwners":true,"selectedTextFormatRangesAdjacentHyperlinkNotes":true,"originalAuthorAndOpaqueTimeBytes":true,"opaque":opaque_rows,"typedTimeHwpAtomicRefusal":true,"sourceTamperingAndMetadataEditRefused":true,"GUIVerified":false});
    std::fs::write(
        out.join("proof.json"),
        serde_json::to_vec_pretty(&proof).unwrap(),
    )
    .unwrap();
    println!("{proof}");
}

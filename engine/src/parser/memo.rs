//! Keep memo containers separate from the editable body raw cache.
use super::{body_text, record::Record, tags};
use crate::model::{
    control::Control,
    document::RawRecord,
    memo::{HwpMemoControl, HwpMemoEntry, HwpMemoTail},
    paragraph::Paragraph,
};

pub(super) fn control(c: &mut Control, records: &[Record], force: bool) {
    let Control::Field(f) = c else {
        return;
    };
    if !force && !crate::model::memo::is_memo(f) {
        return;
    }
    let exact_command = records[0]
        .data
        .get(9..11)
        .and_then(|b| {
            let n = u16::from_le_bytes(b.try_into().ok()?) as usize;
            let encoded: Vec<_> = records[0]
                .data
                .get(11..11 + n * 2)?
                .chunks_exact(2)
                .map(|b| u16::from_le_bytes([b[0], b[1]]))
                .collect();
            String::from_utf16(&encoded).ok()
        })
        .is_some_and(|command| command == f.command);
    let portable = records.len() == 1
        && exact_command
        && crate::model::memo::parameters(&f.command).is_some()
        && records[0].data.len() == 19 + f.command.encode_utf16().count() * 2
        && f.properties == 0x8000
        && f.extra_properties == 0
        && f.command.chars().all(|c| {
            matches!(c, '\t' | '\n' | '\r') || (c >= ' ' && c != '\u{fffe}' && c != '\u{ffff}')
        });
    let digest = crate::model::memo::field_digest(f);
    let raw: Vec<_> = records
        .iter()
        .map(|r| RawRecord {
            tag_id: r.tag_id,
            level: r.level,
            data: r.data.clone(),
        })
        .collect();
    let records_digest = crate::model::memo::records_digest(&raw);
    f.hwp_memo_control = Some(Box::new(HwpMemoControl {
        records: raw,
        records_digest,
        begin: None,
        end: None,
        field_digest: digest,
        portable,
    }));
}
pub(super) fn finish_paragraph(p: &mut Paragraph, records: &[Record]) {
    let Some(text) = records
        .iter()
        .find(|r| r.tag_id == tags::HWPTAG_PARA_TEXT && r.level == records[0].level + 1)
    else {
        return;
    };
    let u: Vec<_> = text
        .data
        .chunks_exact(2)
        .map(|b| u16::from_le_bytes([b[0], b[1]]))
        .collect();
    let mut i = 0;
    let mut ci = 0;
    let mut stack = vec![];
    let mut pairs = vec![];
    while i < u.len() {
        let code = u[i];
        if body_text::is_extended_ctrl_char(code) {
            let Some(chunk) = u.get(i..i + 8) else {
                break;
            };
            let marker: [u16; 8] = chunk.try_into().unwrap();
            if code == 3 {
                stack.push((ci, marker));
                ci += 1;
            } else if code == 4 {
                if let Some((owner, begin)) = stack.pop() {
                    pairs.push((owner, begin, marker));
                }
            } else if body_text::is_extended_only_ctrl_char(code) {
                ci += 1;
            }
            i += 8;
        } else {
            if code == 13 {
                break;
            }
            i += 1;
        }
    }
    for (ci, begin, end) in pairs {
        if let Some(c) = p.controls.get_mut(ci) {
            let signature = begin[1] as u32 | ((begin[2] as u32) << 16) == tags::FIELD_MEMO
                || (end[1] == 0x6d65 && end[2] == 0x0025);
            if signature && matches!(c,Control::Field(f) if f.hwp_memo_control.is_none()) {
                if let Some(start) = records
                    .iter()
                    .enumerate()
                    .filter(|(_, r)| {
                        r.tag_id == tags::HWPTAG_CTRL_HEADER && r.level == records[0].level + 1
                    })
                    .nth(ci)
                    .map(|(i, _)| i)
                {
                    let mut finish = start + 1;
                    while finish < records.len() && records[finish].level > records[start].level {
                        finish += 1;
                    }
                    control(c, &records[start..finish], true);
                }
            }
            let Control::Field(f) = c else {
                continue;
            };
            if let Some(o) = &mut f.hwp_memo_control {
                o.begin = Some(begin);
                o.end = Some(end);
            }
        }
    }
    for c in &mut p.controls {
        if let Control::Field(f) = c {
            let digest = crate::model::memo::field_digest(f);
            if let Some(o) = &mut f.hwp_memo_control {
                o.field_digest = digest;
            }
        }
    }
}
pub(super) fn tail(records: &[Record], data: &[u8]) -> Option<(usize, HwpMemoTail)> {
    let first = records
        .iter()
        .position(|r| r.tag_id == tags::HWPTAG_MEMO_LIST)?;
    let root = records[..first]
        .iter()
        .rposition(|r| r.tag_id == tags::HWPTAG_PARA_HEADER && r.level == 0);
    let container = root
        .and_then(|i| body_text::parse_paragraph(&records[i..first]).ok())
        .is_some_and(|p| {
            p.text.is_empty() && !p.has_para_text && p.controls.is_empty() && p.char_count == 1
        });
    let start = if container { root.unwrap() } else { first };
    let mut offsets = vec![];
    let mut offset = 0;
    for r in records {
        offsets.push(offset);
        let h = u32::from_le_bytes(data.get(offset..offset + 4)?.try_into().ok()?);
        offset += (if h >> 20 == 0xfff { 8 } else { 4 }) + r.data.len();
    }
    let bytes = data[offsets[start]..].to_vec();
    let digest = *blake3::hash(&bytes).as_bytes();
    let mut entries = vec![];
    let mut portable = container
        && offset == data.len()
        && records[start..first].iter().all(|r| match r.tag_id {
            tags::HWPTAG_PARA_HEADER => r.level == 0 && r.data.len() == 24,
            tags::HWPTAG_PARA_CHAR_SHAPE => r.level == 1 && r.data.len() % 8 == 0,
            tags::HWPTAG_PARA_LINE_SEG => r.level == 1 && r.data.len() % 36 == 0,
            _ => false,
        });
    let mut i = first;
    while i < records.len() {
        if records[i].tag_id != tags::HWPTAG_MEMO_LIST {
            portable = false;
            i += 1;
            continue;
        }
        let begin = i;
        i += 1;
        while i < records.len() && records[i].tag_id != tags::HWPTAG_MEMO_LIST {
            i += 1;
        }
        let part = &records[begin..i];
        let index = part[0]
            .data
            .get(..4)
            .map(|b| u32::from_le_bytes(b.try_into().unwrap()))
            .unwrap_or(0);
        let header = part
            .get(1)
            .filter(|r| r.tag_id == tags::HWPTAG_LIST_HEADER && r.level == 1);
        let count = header
            .and_then(|r| r.data.get(..4))
            .map(|b| u32::from_le_bytes(b.try_into().unwrap()) as usize);
        let mut known = part[0].level == 1
            && part[0].data.len() == 4
            && header.is_some_and(|r| r.data.len() == 16 && r.data[4..].iter().all(|b| *b == 0));
        let mut paragraphs = vec![];
        let mut j = 2;
        while j < part.len() {
            if part[j].tag_id != tags::HWPTAG_PARA_HEADER || part[j].level != 1 {
                known = false;
                j += 1;
                continue;
            }
            let start = j;
            j += 1;
            while j < part.len() && part[j].level > 1 {
                j += 1;
            }
            let rs = &part[start..j];
            known &= rs.iter().all(|r| {
                matches!(
                    r.tag_id,
                    tags::HWPTAG_PARA_HEADER
                        | tags::HWPTAG_PARA_TEXT
                        | tags::HWPTAG_PARA_CHAR_SHAPE
                        | tags::HWPTAG_PARA_LINE_SEG
                        | tags::HWPTAG_PARA_RANGE_TAG
                )
            });
            match body_text::parse_paragraph(rs) {
                Ok(p) => {
                    let text: Vec<_> = rs
                        .iter()
                        .filter(|r| r.tag_id == tags::HWPTAG_PARA_TEXT)
                        .collect();
                    let expected: Vec<u8> = p
                        .text
                        .encode_utf16()
                        .chain(std::iter::once(13))
                        .flat_map(u16::to_le_bytes)
                        .collect();
                    known &= p.controls.is_empty()
                        && p.raw_header_extra.len() <= 12
                        && p.raw_header_extra
                            .get(10..)
                            .is_none_or(|v| v.iter().all(|b| *b == 0))
                        && p.range_tags.is_empty()
                        && p.orphan_field_ends.is_empty()
                        && rs[0].data.len() == 24
                        && ((text.len() == 1 && text[0].data == expected)
                            || (text.is_empty()
                                && p.text.is_empty()
                                && p.char_count == 1
                                && !p.has_para_text));
                    paragraphs.push(p);
                }
                Err(_) => known = false,
            }
        }
        known &= count == Some(paragraphs.len()) && !paragraphs.is_empty() && index > 0;
        entries.push(HwpMemoEntry {
            index,
            paragraphs,
            owner_id: None,
            portable: known,
        });
    }
    Some((
        start,
        HwpMemoTail {
            bytes,
            digest,
            model_digest: [0; 32],
            source_controls: vec![],
            entries,
            container_root: container,
            portable,
        },
    ))
}

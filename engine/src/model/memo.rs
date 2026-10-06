//! HWP5 memo ownership and opaque preservation. No comment-authoring surface.
use super::{
    control::{Control, Field, FieldType, Parameter, ParameterList},
    document::{Document, RawRecord},
    paragraph::Paragraph,
    shape::ShapeObject,
};
use crate::parser::tags;
use std::collections::HashMap;

#[derive(Debug, Clone, serde::Serialize)]
pub struct HwpMemoControl {
    pub records: Vec<RawRecord>,
    pub records_digest: [u8; 32],
    pub begin: Option<[u16; 8]>,
    pub end: Option<[u16; 8]>,
    pub field_digest: [u8; 32],
    pub portable: bool,
}
#[derive(Debug, Clone, serde::Serialize)]
pub struct HwpMemoEntry {
    pub index: u32,
    pub paragraphs: Vec<Paragraph>,
    pub owner_id: Option<u32>,
    pub portable: bool,
}
#[derive(Debug, Clone, serde::Serialize)]
pub struct HwpMemoTail {
    /// Includes the original empty container root and all opaque suffix records.
    pub bytes: Vec<u8>,
    pub digest: [u8; 32],
    pub model_digest: [u8; 32],
    pub source_controls: Vec<[u8; 32]>,
    pub entries: Vec<HwpMemoEntry>,
    pub container_root: bool,
    pub portable: bool,
}
pub fn is_memo(field: &Field) -> bool {
    field.field_type == FieldType::Memo
        || (field.ctrl_id == tags::FIELD_UNKNOWN && field.command.starts_with("MEMO/"))
}
pub fn field_digest(field: &Field) -> [u8; 32] {
    let mut f = field.clone();
    f.hwp_memo_control = None;
    // Layout is derived during loading. Content, IDs and source attributes remain sealed.
    for p in &mut f.memo_paragraphs {
        p.line_segs.clear();
        p.hwpx_axis_shift = 0;
        p.layout_only_fill_lines = 0;
    }
    *blake3::hash(&serde_json::to_vec(&f).expect("in-memory field fingerprint")).as_bytes()
}
pub fn records_digest(records: &[RawRecord]) -> [u8; 32] {
    *blake3::hash(&serde_json::to_vec(records).expect("in-memory records")).as_bytes()
}
pub fn tail_digest(t: &HwpMemoTail) -> [u8; 32] {
    *blake3::hash(
        &serde_json::to_vec(&(&t.entries, t.container_root, t.portable, &t.source_controls))
            .expect("in-memory tail model"),
    )
    .as_bytes()
}
/// Only explicit command metadata is projected; no guessed author/creation time.
pub fn parameters(command: &str) -> Option<ParameterList> {
    let t: Vec<_> = command.split('/').collect();
    if t.len() != 7 || t[0] != "MEMO" || t[6] != "\\;;" {
        return None;
    }
    let shape: u16 = t[1].parse().ok()?;
    let number: u16 = t[2].parse().ok()?;
    if number == 0 || t[3].parse::<u32>().is_err() || t[4].parse::<u32>().is_err() {
        return None;
    }
    let string = |name: &str, value: String| Parameter::String {
        name: Some(name.into()),
        value,
        preserve_space: false,
    };
    Some(ParameterList {
        name: Some(String::new()),
        items: vec![
            Parameter::Integer {
                name: Some("Prop".into()),
                value: 0,
            },
            string("Command", command.into()),
            string("ID", format!("memo{number}")),
            Parameter::Integer {
                name: Some("Number".into()),
                value: number.into(),
            },
            string("Author", t[5].into()),
            string("MemoShapeIDRef", shape.to_string()),
        ],
    })
}
pub fn command_index(command: &str) -> Option<u32> {
    command
        .strip_prefix("MEMO/")?
        .split('/')
        .nth(1)?
        .parse()
        .ok()
}
/// Prove the imported metadata can be reconstructed from Command, rather than warn after loss.
pub fn parameters_preserved(f: &Field) -> bool {
    let Some(expected) = parameters(&f.command) else {
        return false;
    };
    if f.instance_id.is_some()
        || f.ctrl_data_name.as_deref().is_some_and(|n| !n.is_empty())
        || f.parameters.name.as_deref().is_some_and(|n| !n.is_empty())
        || f.raw_parameters_xml
            .as_ref()
            .is_some_and(|xml| *xml != f.parameters.render_xml("parameters"))
    {
        return false;
    }
    let mut seen = std::collections::HashSet::new();
    f.parameters.items.iter().all(|v| {
        let name = match v {
            Parameter::Integer { name, .. } | Parameter::String { name, .. } => name.as_deref(),
            _ => None,
        };
        expected.items.contains(v) && name.is_some_and(|n| seen.insert(n))
    })
}
fn valid_markers(f: &Field) -> bool {
    let Some(o) = &f.hwp_memo_control else {
        return false;
    };
    let (Some(b), Some(e)) = (o.begin, o.end) else {
        return false;
    };
    b == [
        3,
        (tags::FIELD_MEMO & 0xffff) as u16,
        (tags::FIELD_MEMO >> 16) as u16,
        0,
        0,
        0,
        0,
        3,
    ] && f.memo_index > 0
        && f.memo_index <= u16::MAX as u32
        && e == [4, 0x6d65, 0x0025, 0xff01, 0x00ff, f.memo_index as u16, 0, 4]
}

fn visit_shape<'a>(s: &'a ShapeObject, f: &mut impl FnMut(&'a Field, &'a Paragraph, usize, bool)) {
    if let Some(d) = s.drawing() {
        if let Some(t) = &d.text_box {
            visit(&t.paragraphs, false, f);
        }
        if let Some(c) = &d.caption {
            visit(&c.paragraphs, false, f);
        }
    }
    match s {
        ShapeObject::Group(g) => {
            for c in &g.children {
                visit_shape(c, f);
            }
            if let Some(c) = &g.caption {
                visit(&c.paragraphs, false, f);
            }
        }
        ShapeObject::Picture(p) => {
            if let Some(c) = &p.caption {
                visit(&c.paragraphs, false, f);
            }
        }
        ShapeObject::Chart(p) => {
            if let Some(c) = &p.caption {
                visit(&c.paragraphs, false, f);
            }
        }
        ShapeObject::Ole(p) => {
            if let Some(c) = &p.caption {
                visit(&c.paragraphs, false, f);
            }
        }
        _ => {}
    }
}
fn visit<'a>(
    ps: &'a [Paragraph],
    root: bool,
    f: &mut impl FnMut(&'a Field, &'a Paragraph, usize, bool),
) {
    for p in ps {
        for (ci, c) in p.controls.iter().enumerate() {
            match c {
                Control::Field(v) => {
                    f(v, p, ci, root);
                    visit(&v.memo_paragraphs, false, f);
                }
                Control::Table(t) => {
                    for c in &t.cells {
                        visit(&c.paragraphs, false, f);
                    }
                    if let Some(c) = &t.caption {
                        visit(&c.paragraphs, false, f);
                    }
                }
                Control::Shape(s) => visit_shape(s, f),
                Control::Picture(p) => {
                    if let Some(c) = &p.caption {
                        visit(&c.paragraphs, false, f);
                    }
                }
                Control::Header(h) => visit(&h.paragraphs, false, f),
                Control::Footer(h) => visit(&h.paragraphs, false, f),
                Control::Footnote(n) => visit(&n.paragraphs, false, f),
                Control::Endnote(n) => visit(&n.paragraphs, false, f),
                Control::HiddenComment(n) => visit(&n.paragraphs, false, f),
                _ => {}
            }
        }
    }
}
fn fields<'a>(doc: &'a Document) -> Vec<(&'a Field, &'a Paragraph, usize, bool)> {
    let mut out = vec![];
    for s in &doc.sections {
        visit(&s.paragraphs, true, &mut |f, p, ci, root| {
            out.push((f, p, ci, root))
        });
        for m in &s.section_def.master_pages {
            visit(&m.paragraphs, false, &mut |f, p, ci, root| {
                out.push((f, p, ci, root))
            });
        }
    }
    out
}
fn range_valid(p: &Paragraph, ci: usize) -> bool {
    let ranges: Vec<_> = p
        .field_ranges
        .iter()
        .filter(|r| r.control_idx == ci)
        .collect();
    ranges.len() == 1
        && ranges[0].start_char_idx <= ranges[0].end_char_idx
        && ranges[0].end_char_idx <= p.text.chars().count()
        && !p.field_ranges.iter().any(|other| {
            let own = ranges[0];
            (own.start_char_idx < other.start_char_idx
                && other.start_char_idx < own.end_char_idx
                && own.end_char_idx < other.end_char_idx)
                || (other.start_char_idx < own.start_char_idx
                    && own.start_char_idx < other.end_char_idx
                    && other.end_char_idx < own.end_char_idx)
        })
}
/// Resolve across all sections, not by nearest paragraph or first matching index.
pub fn link(doc: &mut Document) {
    let mut ids = HashMap::new();
    let mut indices = HashMap::new();
    let source_controls: Vec<_> = fields(doc)
        .iter()
        .filter_map(|(f, _, _, _)| f.hwp_memo_control.as_ref().map(|o| o.records_digest))
        .collect();
    for (f, _, _, _) in fields(doc) {
        *ids.entry(f.field_id).or_insert(0usize) += 1;
        if f.hwp_memo_control.is_some() {
            *indices.entry(f.memo_index).or_insert(0usize) += 1;
        }
    }
    let mut candidates = HashMap::new();
    for (si, s) in doc.sections.iter().enumerate() {
        for (pi, p) in s.paragraphs.iter().enumerate() {
            for (ci, c) in p.controls.iter().enumerate() {
                let Control::Field(f) = c else {
                    continue;
                };
                let number_matches = command_index(&f.command) == Some(f.memo_index);
                if f.field_id != 0
                    && ids.get(&f.field_id) == Some(&1)
                    && indices.get(&f.memo_index) == Some(&1)
                    && valid_markers(f)
                    && range_valid(p, ci)
                    && number_matches
                {
                    candidates.insert(f.memo_index, (si, pi, ci));
                }
            }
        }
    }
    let mut tails = HashMap::new();
    for s in &doc.sections {
        if let Some(t) = &s.memo_tail {
            for e in &t.entries {
                *tails.entry(e.index).or_insert(0usize) += 1;
            }
        }
    }
    let mut bindings = vec![];
    for (si, s) in doc.sections.iter().enumerate() {
        if let Some(t) = &s.memo_tail {
            for (ei, e) in t.entries.iter().enumerate() {
                if e.index == 0
                    || tails.get(&e.index) != Some(&1)
                    || e.paragraphs.is_empty()
                    || e.paragraphs.iter().any(|p| !p.controls.is_empty())
                {
                    continue;
                }
                if let Some(&(osi, pi, ci)) = candidates.get(&e.index) {
                    bindings.push((si, ei, osi, pi, ci, e.paragraphs.clone()));
                }
            }
        }
    }
    for (si, ei, osi, pi, ci, paragraphs) in bindings {
        let Control::Field(f) = &mut doc.sections[osi].paragraphs[pi].controls[ci] else {
            continue;
        };
        f.field_type = FieldType::Memo;
        f.memo_paragraphs = paragraphs;
        f.memo_text_direction = Some("HORIZONTAL".into());
        if let Some(parameters) = parameters(&f.command) {
            f.parameters = parameters;
        }
        let digest = field_digest(f);
        f.hwp_memo_control.as_mut().unwrap().field_digest = digest;
        let id = f.field_id;
        doc.sections[si].memo_tail.as_mut().unwrap().entries[ei].owner_id = Some(id);
    }
    for s in &mut doc.sections {
        if let Some(t) = &mut s.memo_tail {
            t.source_controls = source_controls.clone();
            t.model_digest = tail_digest(t);
        }
    }
}
pub fn validate(doc: &Document, hwpx: bool) -> Result<(), String> {
    // Unedited HWP passes through the original complete section bytes, including unsupported markers.
    if !hwpx
        && doc
            .sections
            .iter()
            .all(|s| s.raw_provenance_permits_reuse())
    {
        return Ok(());
    }
    let all = fields(doc);
    let mut controls: Vec<_> = all
        .iter()
        .filter_map(|(f, _, _, _)| f.hwp_memo_control.as_ref().map(|o| o.records_digest))
        .collect();
    controls.sort_unstable();
    let mut ids = HashMap::new();
    for (f, _, _, _) in &all {
        *ids.entry(f.field_id).or_insert(0usize) += 1;
    }
    for s in &doc.sections {
        if let Some(t) = &s.memo_tail {
            let mut original = t.source_controls.clone();
            original.sort_unstable();
            if original != controls {
                return Err("원본 메모 컨트롤이 삭제/복제되어 저장하지 않았습니다.".into());
            }
            if *blake3::hash(&t.bytes).as_bytes() != t.digest
                || tail_digest(t) != t.model_digest
                || !t.container_root
            {
                return Err(
                    "메모 꼬리의 원본/위치를 안전하게 보존할 수 없어 저장하지 않았습니다.".into(),
                );
            }
            if hwpx
                && (!t.portable
                    || t.entries
                        .iter()
                        .any(|e| !e.portable || e.owner_id.is_none()))
            {
                return Err("미해석/소유권 불명 HWP 메모 레코드를 HWPX로 보존할 수 없어 저장하지 않았습니다.".into());
            }
            for e in &t.entries {
                if let Some(id) = e.owner_id {
                    if ids.get(&id) != Some(&1)
                        || !all.iter().any(|(f, p, ci, root)| {
                            *root
                                && f.field_id == id
                                && f.memo_index == e.index
                                && range_valid(p, *ci)
                        })
                    {
                        return Err("메모 꼬리의 필드 소유권이 바뀌어 저장하지 않았습니다.".into());
                    }
                }
            }
        }
    }
    for (f, p, ci, _) in all {
        if let Some(o) = &f.hwp_memo_control {
            if f.field_type == FieldType::Memo
                && !f.memo_paragraphs.is_empty()
                && !doc
                    .sections
                    .iter()
                    .filter_map(|s| s.memo_tail.as_ref())
                    .flat_map(|t| &t.entries)
                    .any(|e| e.owner_id == Some(f.field_id) && e.index == f.memo_index)
            {
                return Err("메모 본문을 소유한 꼬리가 없어 저장하지 않았습니다.".into());
            }
            let source_data = o
                .records
                .iter()
                .skip(1)
                .take_while(|r| r.tag_id != tags::HWPTAG_CTRL_HEADER)
                .find(|r| r.tag_id == tags::HWPTAG_CTRL_DATA)
                .map(|r| r.data.as_slice());
            let current_data = p.ctrl_data_records.get(ci).and_then(|r| r.as_deref());
            if field_digest(f) != o.field_digest
                || records_digest(&o.records) != o.records_digest
                || source_data != current_data
                || !valid_markers(f)
                || !range_valid(p, ci)
            {
                return Err(
                    "원본 메모의 내용/메타데이터/표식을 보존할 수 없어 저장하지 않았습니다.".into(),
                );
            }
            if hwpx
                && (!o.portable || f.field_type != FieldType::Memo || f.memo_paragraphs.is_empty())
            {
                return Err(
                    "미해석 메모 컨트롤을 HWPX로 보존할 수 없어 저장하지 않았습니다.".into(),
                );
            }
        } else if !hwpx && is_memo(f) && !f.parameters.is_empty() {
            if !parameters_preserved(f) {
                return Err(
                    "작성 시각 등 메모 parameters를 HWP로 보존할 수 없어 저장하지 않았습니다."
                        .into(),
                );
            }
        }
    }
    Ok(())
}

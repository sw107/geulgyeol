//! Review comments: body anchor and review text are distinct, staged edits.
use super::field_query::{
    insert_click_here_field_in_para, rebuild_char_offsets_at_positions, stage_hyperlink_remove,
    validate_field_edit_axis,
};
use crate::{
    document_core::DocumentCore,
    error::HwpError,
    model::{
        control::{Control, Field, FieldType, Parameter},
        document::Document,
        memo,
        paragraph::Paragraph,
    },
    parser::tags,
};
use serde_json::json;

fn invalid(message: &str) -> HwpError {
    HwpError::InvalidField(message.into())
}
fn paragraph(doc: &Document, sec: usize, p: usize) -> Result<&Paragraph, HwpError> {
    doc.sections
        .get(sec)
        .and_then(|s| s.paragraphs.get(p))
        .ok_or_else(|| invalid("본문 주석 문단 없음"))
}
fn validate_range(
    p: &Paragraph,
    start: usize,
    end: usize,
    exclude: Option<usize>,
) -> Result<(), HwpError> {
    validate_field_edit_axis(p)?;
    if start > end || end > p.text.chars().count() || (exclude.is_none() && start == end) {
        return Err(invalid(
            "주석은 본문 한 문단의 비어 있지 않은 선택에 추가하세요.",
        ));
    }
    for (i, r) in p.field_ranges.iter().enumerate() {
        if exclude == Some(i) {
            continue;
        }
        if (start < r.end_char_idx && r.start_char_idx < end)
            || (r.start_char_idx == r.end_char_idx
                && start <= r.start_char_idx
                && r.start_char_idx <= end)
            || (start == end && r.start_char_idx <= start && start < r.end_char_idx)
        {
            return Err(invalid("겹친 필드/주석 범위는 지원하지 않습니다."));
        }
    }
    // Notes at a boundary remain outside the selected anchor. Controls inside it cannot move.
    if p.controls
        .iter()
        .zip(p.control_text_positions())
        .any(|(c, at)| {
            !matches!(
                c,
                Control::Field(_) | Control::SectionDef(_) | Control::ColumnDef(_)
            ) && start < at
                && at < end
        })
        || !p.range_tags.is_empty()
    {
        return Err(invalid(
            "주석 범위 안의 개체/각주 또는 범위 참조는 지원하지 않습니다.",
        ));
    }
    Ok(())
}
fn plain_memo(f: &Field) -> bool {
    f.field_type == FieldType::Memo
        && !f.memo_paragraphs.is_empty()
        && f.memo_paragraphs.iter().all(|p| {
            p.controls.is_empty()
                && p.control_mask == 0
                && p.raw_break_type == 0
                && p.numbering_restart.is_none()
                && p.tab_extended.is_empty()
                && !p.text.chars().any(char::is_control)
                && p.raw_header_extra.len() <= 12
                && p.raw_header_extra
                    .get(10..)
                    .is_none_or(|v| v.iter().all(|b| *b == 0))
                && p.field_ranges.is_empty()
                && p.range_tags.is_empty()
                && p.orphan_field_ends.is_empty()
                && p.title_marks.is_empty()
                && p.char_shapes.len() == 1
                && p.char_shapes[0].start_pos == 0
        })
}
fn text(f: &Field) -> String {
    f.memo_paragraphs
        .iter()
        .map(|p| p.text.as_str())
        .collect::<Vec<_>>()
        .join("\n")
}
fn metadata(f: &Field, name: &str) -> Option<String> {
    f.parameters.items.iter().find_map(|v| match v {
        Parameter::String {
            name: Some(n),
            value,
            ..
        } if n == name => Some(value.clone()),
        _ => None,
    })
}
fn contents(input: &str, templates: &[Paragraph]) -> Result<Vec<Paragraph>, HwpError> {
    if input.trim().is_empty()
        || input.encode_utf16().count() > 4096
        || input.split('\n').count() > 32
        || input
            .chars()
            .any(|c| (c != '\n' && c.is_control()) || matches!(c, '\u{fffe}' | '\u{ffff}'))
    {
        return Err(invalid(
            "주석 내용은 1~4096 UTF-16 단위, 최대32문단의 일반 텍스트로 입력하세요.",
        ));
    }
    Ok(input
        .split('\n')
        .enumerate()
        .map(|(i, line)| {
            let template = templates.get(i).or_else(|| templates.first());
            let mut p = Paragraph::new_empty();
            if let Some(t) = templates.get(i) {
                p.raw_header_extra = t.raw_header_extra.clone();
                p.has_para_text = t.has_para_text;
            }
            if let Some(t) = template {
                p.style_id = t.style_id;
                p.para_shape_id = t.para_shape_id;
                p.char_shapes = t.char_shapes.clone();
            }
            p.insert_text_at(0, line);
            p
        })
        .collect())
}
fn staged(doc: &Document) -> Result<Document, HwpError> {
    let d = memo::prepare_for_authoring(doc).map_err(|e| invalid(&e))?;
    for s in &d.sections {
        for p in &s.paragraphs {
            for (ci, c) in p.controls.iter().enumerate() {
                if matches!(c,Control::Field(f) if memo::is_memo(f) && !plain_memo(f)) {
                    return Err(invalid(
                        "복합 서식·개체·문단 부가참조가 있는 기존 주석의 저작은 지원하지 않습니다.",
                    ));
                }
                if let Control::Field(f) = c {
                    if memo::is_memo(f) {
                        let r = p
                            .field_ranges
                            .iter()
                            .enumerate()
                            .find(|(_, r)| r.control_idx == ci)
                            .ok_or_else(|| invalid("기존 주석 범위가 없습니다."))?;
                        validate_range(p, r.1.start_char_idx, r.1.end_char_idx, Some(r.0))?;
                    }
                }
            }
        }
    }
    Ok(d)
}
fn formats(d: &Document) -> Vec<&'static str> {
    if memo::validate(d, false).is_ok() {
        vec!["hwp", "hwpx"]
    } else {
        vec!["hwpx"]
    }
}
impl DocumentCore {
    fn comment_staged_document(&self) -> Result<Document, HwpError> {
        let all = self.collect_all_fields();
        let mut ids = std::collections::HashMap::new();
        for f in &all {
            *ids.entry(f.field.field_id).or_insert(0usize) += 1;
        }
        if all.iter().any(|f| {
            memo::is_memo(&f.field)
                && (f.field.field_id == 0 || ids.get(&f.field.field_id) != Some(&1))
        }) {
            return Err(invalid("문서/이름 셀과 주석 ID의 소유권이 중복입니다."));
        }
        staged(&self.document)
    }
    fn comment_owner(&self, sec: usize, p: usize, id: u32) -> Result<(usize, usize), HwpError> {
        if id == 0
            || self
                .collect_all_fields()
                .iter()
                .filter(|f| f.field.field_id == id)
                .count()
                != 1
        {
            return Err(invalid("주석 ID의 소유권이 없거나 중복입니다."));
        }
        let para = paragraph(&self.document, sec, p)?;
        let (ri,r)=para.field_ranges.iter().enumerate().find(|(_,r)|
            matches!(para.controls.get(r.control_idx),Some(Control::Field(f)) if f.field_id==id && f.field_type==FieldType::Memo))
            .ok_or_else(||invalid("이 본문 문단의 주석이 아닙니다."))?;
        validate_range(para, r.start_char_idx, r.end_char_idx, Some(ri))?;
        Ok((r.control_idx, ri))
    }
    pub fn get_body_comment_at(&self, sec: usize, p: usize, at: usize) -> Result<String, HwpError> {
        let para = paragraph(&self.document, sec, p)?;
        if at > para.text.chars().count() {
            return Err(invalid("주석 커서 범위 초과"));
        }
        let matches:Vec<_>=para.field_ranges.iter().filter(|r|
            ((r.start_char_idx<=at && at<r.end_char_idx) || (r.start_char_idx==r.end_char_idx && at==r.start_char_idx))
            && matches!(para.controls.get(r.control_idx),Some(Control::Field(f)) if f.field_type==FieldType::Memo)).collect();
        if matches.len() > 1 {
            return Err(invalid("같은 위치의 주석 소유권이 모호합니다."));
        }
        let Some(r) = matches.first() else {
            let prepared = self.comment_staged_document();
            return Ok(json!({"ok":true,"found":false,"editable":prepared.is_ok(),
                "supportedSaveFormats":prepared.as_ref().map(formats).unwrap_or_default(),
                "editRevision":format!("{}:{:?}:{}",self.render_normalization.document_epoch,self.render_normalization.section_revisions,self.event_log.len()),
                "reason":prepared.err().map(|e|e.to_string())}).to_string());
        };
        let Control::Field(f) = &para.controls[r.control_idx] else {
            unreachable!()
        };
        self.comment_owner(sec, p, f.field_id)?;
        let prepared = self.comment_staged_document();
        let supported = prepared.as_ref().map(formats).unwrap_or_default();
        Ok(json!({"ok":true,"found":true,"fieldId":f.field_id,"startCharIdx":r.start_char_idx,
            "endCharIdx":r.end_char_idx,"selectedText":para.text.chars().skip(r.start_char_idx).take(r.end_char_idx-r.start_char_idx).collect::<String>(),
            "editRevision":format!("{}:{:?}:{}",self.render_normalization.document_epoch,self.render_normalization.section_revisions,self.event_log.len()),
            "content":text(f),"author":metadata(f,"Author").unwrap_or_default(),
            "createDateTime":metadata(f,"CreateDateTime"),"editable":prepared.is_ok(),
            "supportedSaveFormats":supported,"reason":prepared.err().map(|e|e.to_string())}).to_string())
    }
    pub fn insert_body_comment(
        &mut self,
        sec: usize,
        p: usize,
        start: usize,
        end: usize,
        content: &str,
    ) -> Result<String, HwpError> {
        validate_range(paragraph(&self.document, sec, p)?, start, end, None)?;
        let original = paragraph(&self.document, sec, p)?;
        if original.char_shapes.is_empty() {
            return Err(invalid("본문 글자 모양 참조가 없습니다."));
        }
        let paragraphs = contents(content, &[Paragraph::new_empty_like(original)])?;
        let id = self.allocate_hyperlink_id()?;
        let mut doc = self.comment_staged_document()?;
        let index = doc
            .sections
            .iter()
            .flat_map(|s| &s.paragraphs)
            .flat_map(|p| &p.controls)
            .filter_map(|c| match c {
                Control::Field(f) if memo::is_memo(f) => Some(f.memo_index),
                _ => None,
            })
            .max()
            .unwrap_or(0)
            .checked_add(1)
            .filter(|n| *n <= u16::MAX as u32)
            .ok_or_else(|| invalid("메모 index 공간이 부족합니다."))?;
        let shape = doc.sections[sec].section_def.memo_shape_id;
        // Product rule: new author is explicitly empty; no inferred account or creation timestamp.
        let command = format!("MEMO/{shape}/{index}/0/0//\\;;");
        let para = &mut doc.sections[sec].paragraphs[p];
        insert_click_here_field_in_para(para, start, id, "", "", "", false)?;
        let ci = para
            .controls
            .iter()
            .position(|c| matches!(c,Control::Field(f) if f.field_id==id))
            .unwrap();
        let positions = para.control_text_positions();
        para.controls[ci] = Control::Field(Field {
            ctrl_id: tags::FIELD_MEMO,
            field_type: FieldType::Memo,
            properties: 0x8000,
            field_id: id,
            memo_index: index,
            memo_paragraphs: paragraphs,
            memo_text_direction: Some("HORIZONTAL".into()),
            parameters: memo::parameters(&command).unwrap(),
            command,
            ..Default::default()
        });
        para.field_ranges
            .iter_mut()
            .find(|r| r.control_idx == ci)
            .unwrap()
            .end_char_idx = end;
        rebuild_char_offsets_at_positions(para, &positions);
        validate_field_edit_axis(para)?;
        let supported = formats(&doc);
        self.document = doc;
        self.finish_body_hyperlink_edit(sec, p);
        Ok(json!({"ok":true,"changed":true,"fieldId":id,"startCharIdx":start,"endCharIdx":end,"supportedSaveFormats":supported}).to_string())
    }
    pub fn update_body_comment(
        &mut self,
        sec: usize,
        p: usize,
        id: u32,
        content: &str,
    ) -> Result<String, HwpError> {
        let (ci, _) = self.comment_owner(sec, p, id)?;
        let Control::Field(f) = &self.document.sections[sec].paragraphs[p].controls[ci] else {
            unreachable!()
        };
        let paragraphs = contents(content, &f.memo_paragraphs)?;
        let mut doc = self.comment_staged_document()?;
        if text(f) == content {
            return Ok(
                json!({"ok":true,"changed":false,"supportedSaveFormats":formats(&doc)}).to_string(),
            );
        }
        let Control::Field(f) = &mut doc.sections[sec].paragraphs[p].controls[ci] else {
            unreachable!()
        };
        f.memo_paragraphs = paragraphs;
        let supported = formats(&doc);
        self.document = doc;
        self.finish_body_hyperlink_edit(sec, p);
        Ok(json!({"ok":true,"changed":true,"supportedSaveFormats":supported}).to_string())
    }
    pub fn remove_body_comment(
        &mut self,
        sec: usize,
        p: usize,
        id: u32,
    ) -> Result<String, HwpError> {
        let (ci, ri) = self.comment_owner(sec, p, id)?;
        let mut doc = self.comment_staged_document()?;
        doc.sections[sec].paragraphs[p] =
            stage_hyperlink_remove(&doc.sections[sec].paragraphs[p], ci, ri)?;
        let supported = formats(&doc);
        self.document = doc;
        self.finish_body_hyperlink_edit(sec, p);
        Ok(json!({"ok":true,"changed":true,"supportedSaveFormats":supported}).to_string())
    }
}

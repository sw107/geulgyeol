//! Plan paragraph-end Enter before any split; structural split/undo do not opt in.
use crate::{
    error::HwpError,
    model::{
        document::DocInfo,
        paragraph::{ParaMeta, Paragraph},
    },
};
#[derive(Clone, Copy)]
pub(super) struct NextStyle {
    style: u8,
    old_char: u32,
    new_char: u32,
    old_para: u16,
    new_para: u16,
}
impl NextStyle {
    pub(super) fn apply(self, p: &mut Paragraph) {
        p.style_id = self.style;
        if p.para_shape_id == self.old_para {
            p.para_shape_id = self.new_para;
        }
        p.replace_style_char_shape_preserving_overrides(self.old_char, self.new_char);
        p.invalidate_layout_inputs();
    }
    pub(super) fn para_shape(self, original: u16) -> u16 {
        if original == self.old_para {
            self.new_para
        } else {
            original
        }
    }
}
pub(super) fn prepare(
    info: &DocInfo,
    p: &Paragraph,
    offset: usize,
    enabled: bool,
    restore_meta: Option<&ParaMeta>,
) -> Result<Option<NextStyle>, HwpError> {
    if let Some(id) = restore_meta.and_then(|m| m.empty_char_shape_id) {
        if id as usize >= info.char_shapes.len() {
            return Err(HwpError::RenderError(
                "복원할 빈 문단의 문자 모양이 문서에 없습니다.".into(),
            ));
        }
    }
    if !enabled {
        return Ok(None);
    }
    let end = p.text.chars().count() + p.controls.iter().filter(|c| c.is_logical_inline()).count();
    if offset > end {
        return Err(HwpError::RenderError(
            "문단 끝을 벗어난 Enter 위치입니다.".into(),
        ));
    }
    if offset != end {
        return Ok(None);
    }
    let invalid = || {
        HwpError::RenderError(
            "다음 스타일에 잘못되거나 지원하지 않는 참조가 있어 문단을 나누지 않았습니다.".into(),
        )
    };
    let source = info.styles.get(p.style_id as usize).ok_or_else(invalid)?;
    if info.styles.len() > 256 || source.style_type > 1 {
        return Err(invalid());
    }
    // Character styles have no following-paragraph style contract.
    if source.style_type == 1 {
        return Ok(None);
    }
    let target = info
        .styles
        .get(source.next_style_id as usize)
        .ok_or_else(invalid)?;
    if target.style_type != 0
        || [source.char_shape_id, target.char_shape_id]
            .iter()
            .any(|id| *id as usize >= info.char_shapes.len())
        || [source.para_shape_id, target.para_shape_id, p.para_shape_id]
            .iter()
            .any(|id| *id as usize >= info.para_shapes.len())
        || p.char_shapes
            .iter()
            .any(|r| r.char_shape_id as usize >= info.char_shapes.len())
        || info
            .extra_records
            .iter()
            .any(|r| r.tag_id == crate::parser::tags::HWPTAG_STYLE)
    {
        return Err(invalid());
    }
    if source.next_style_id == p.style_id {
        return Ok(None);
    }
    Ok(Some(NextStyle {
        style: source.next_style_id,
        old_char: source.char_shape_id as u32,
        new_char: target.char_shape_id as u32,
        old_para: source.para_shape_id,
        new_para: target.para_shape_id,
    }))
}

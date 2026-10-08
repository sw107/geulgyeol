use crate::{
    document_core::DocumentCore,
    error::HwpError,
    model::control::{AutoNumberType, Control},
    model::shape::CaptionDirection,
};
use serde_json::json;

impl DocumentCore {
    /// Read-only contract for the narrowly supported root picture caption editor.
    /// Unsupported children must be rejected before a UI selection is deleted.
    pub fn get_picture_caption_edit_info_native(
        &self,
        sec: usize,
        para: usize,
        ctrl: usize,
    ) -> Result<String, HwpError> {
        let reject = || {
            HwpError::RenderError(
                "일반 본문의 위/아래 그림 캡션 텍스트만 편집할 수 있습니다".into(),
            )
        };
        let host = self
            .document
            .sections
            .get(sec)
            .and_then(|s| s.paragraphs.get(para))
            .ok_or_else(reject)?;
        let Some(Control::Picture(picture)) = host.controls.get(ctrl) else {
            return Err(reject());
        };
        let caption = picture.caption.as_ref().ok_or_else(reject)?;
        if picture.common.treat_as_char
            || picture.shape_attr.rotation_angle.rem_euclid(360) != 0
            || !matches!(
                caption.direction,
                CaptionDirection::Top | CaptionDirection::Bottom
            )
            || caption.paragraphs.is_empty()
        {
            return Err(reject());
        }
        let mut paragraphs = Vec::new();
        for p in &caption.paragraphs {
            if !p.field_ranges.is_empty() || !p.orphan_field_ends.is_empty() || !p.range_tags.is_empty()
                || p.controls.iter().any(|c| !matches!(c, Control::AutoNumber(n) if n.number_type == AutoNumberType::Picture)) {
                return Err(HwpError::RenderError("복합 참조가 있는 그림 캡션은 편집할 수 없습니다".into()));
            }
            let positions = p.control_text_positions();
            if positions.len() != p.controls.len()
                || positions.iter().any(|i| *i >= p.text.chars().count())
            {
                return Err(HwpError::RenderError(
                    "그림 캡션 번호 위치를 확인할 수 없습니다".into(),
                ));
            }
            // Keep the existing label and number on the first side of a split.
            let edit_from = positions.iter().max().map_or(0, |i| i + 1);
            paragraphs.push(json!({"text":p.text,"editFrom":edit_from}));
        }
        Ok(json!({"paragraphs":paragraphs}).to_string())
    }
}

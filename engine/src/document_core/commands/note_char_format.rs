//! Plain note text formatting with full preflight and mixed-run preservation.
use super::formatting::char_shape_mods_affect_text_flow;
use crate::{
    document_core::{helpers::parse_char_shape_mods, DocumentCore},
    error::HwpError,
    model::{control::Control, event::DocumentEvent},
};
use serde_json::Value;
fn error(s: impl ToString) -> HwpError {
    HwpError::RenderError(s.to_string())
}
fn integer(v: &Value, min: i64, max: i64) -> bool {
    v.as_i64().is_some_and(|n| n >= min && n <= max)
}
fn color(v: &Value) -> bool {
    v.as_str().is_some_and(|s| {
        s.len() == 7 && s.starts_with('#') && s[1..].bytes().all(|c| c.is_ascii_hexdigit())
    })
}
impl DocumentCore {
    fn validate_note_char_props(&self, props: &Value) -> Result<(), HwpError> {
        let fields = props
            .as_object()
            .ok_or_else(|| error("각주 글자 모양은 JSON 객체여야 합니다"))?;
        for (k, v) in fields {
            let valid = match k.as_str() {
                "bold" | "italic" | "underline" | "strikethrough" | "emboss" | "engrave"
                | "superscript" | "subscript" | "kerning" => v.is_boolean(),
                "fontSize" => integer(v, 1, i32::MAX as i64),
                "fontName" => v.as_str().is_some_and(|s| {
                    !s.trim().is_empty()
                        && s.chars().count() <= 256
                        && !s.chars().any(char::is_control)
                }),
                "fontId" => integer(v, 0, u16::MAX as i64),
                "fontIds" => v.as_array().is_some_and(|a| {
                    a.len() == 7 && a.iter().all(|v| integer(v, 0, u16::MAX as i64))
                }),
                "textColor" | "shadeColor" | "underlineColor" | "strikeColor" | "shadowColor" => {
                    color(v)
                }
                "underlineType" => v
                    .as_str()
                    .is_some_and(|s| ["None", "Bottom", "Top"].contains(&s)),
                "outlineType" | "emphasisDot" => integer(v, 0, 6),
                "shadowType" => integer(v, 0, 2),
                "shadowOffsetX" | "shadowOffsetY" => integer(v, -100, 100),
                "underlineShape" | "strikeShape" => integer(v, 0, 16),
                "ratios" | "relativeSizes" => v
                    .as_array()
                    .is_some_and(|a| a.len() == 7 && a.iter().all(|v| integer(v, 1, 255))),
                "spacings" | "charOffsets" => v
                    .as_array()
                    .is_some_and(|a| a.len() == 7 && a.iter().all(|v| integer(v, -128, 127))),
                _ => false,
            };
            if !valid {
                return Err(error(format!(
                    "각주 글자 모양 항목/값을 지원하지 않습니다: {k}"
                )));
            }
        }
        if props.get("fontName").is_some()
            && (props.get("fontId").is_some() || props.get("fontIds").is_some())
        {
            return Err(error("각주 글꼴 이름과 ID는 함께 지정할 수 없습니다"));
        }
        if let Some(name) = props.get("fontName").and_then(Value::as_str) {
            let fonts = &self.document.doc_info.font_faces;
            // The existing per-language registrar appends placeholders to every pool.
            let additions = fonts
                .iter()
                .filter(|f| !f.iter().any(|font| font.name == name))
                .count();
            if fonts.len() != 7
                || fonts.iter().any(|f| {
                    f.len().saturating_add(additions) > u16::MAX as usize + 1
                        || f.iter()
                            .position(|font| font.name == name)
                            .is_some_and(|id| id > u16::MAX as usize)
                })
            {
                return Err(error("각주 글꼴 정의 수 한도 초과"));
            }
        }
        if let Some(v) = props.get("fontId") {
            if self
                .document
                .doc_info
                .font_faces
                .iter()
                .any(|f| v.as_u64().unwrap() as usize >= f.len())
            {
                return Err(error("각주 글꼴 참조 범위 초과"));
            }
        }
        if let Some(v) = props.get("fontIds") {
            for (lang, id) in v.as_array().unwrap().iter().enumerate() {
                if self
                    .document
                    .doc_info
                    .font_faces
                    .get(lang)
                    .is_none_or(|f| id.as_u64().unwrap() as usize >= f.len())
                {
                    return Err(error("각주 언어별 글꼴 참조 범위 초과"));
                }
            }
        }
        Ok(())
    }
    pub fn get_char_properties_in_footnote_native(
        &self,
        sec: usize,
        parent: usize,
        control: usize,
        para: usize,
        offset: usize,
    ) -> Result<String, HwpError> {
        let p = self
            .get_footnote_paragraph_ref(sec, parent, control, para)
            .ok_or_else(|| error("각주/미주 문단을 찾을 수 없습니다"))?;
        if offset > p.text.chars().count() {
            return Err(error("각주 문자 범위 초과"));
        }
        Ok(self.build_char_properties_json(p, offset))
    }
    #[allow(clippy::too_many_arguments)]
    pub fn apply_char_format_in_footnote_native(
        &mut self,
        sec: usize,
        parent: usize,
        control: usize,
        start_para: usize,
        start: usize,
        end_para: usize,
        end: usize,
        json: &str,
    ) -> Result<String, HwpError> {
        let props: Value = serde_json::from_str(json).map_err(error)?;
        self.validate_note_char_props(&props)?;
        if (start_para, start) > (end_para, end) {
            return Err(error("각주 시작 위치가 끝 위치보다 뒤에 있음"));
        }
        let mut runs: Vec<(usize, usize, usize, u32)> = Vec::new();
        // No definitions or document state are changed until every paragraph is validated.
        for pi in start_para..=end_para {
            let p = self
                .get_footnote_paragraph_ref(sec, parent, control, pi)
                .ok_or_else(|| error("각주/미주 문단 범위 초과"))?;
            let len = p.text.chars().count();
            let from = if pi == start_para { start } else { 0 };
            let to = if pi == end_para { end } else { len };
            if from > len || to > len || from > to {
                return Err(error("각주 문자 범위 초과"));
            }
            if p.char_offsets.len() != len
                || p.controls
                    .iter()
                    .any(|c| !matches!(c, Control::AutoNumber(_)))
            {
                return Err(error(
                    "각주 글자 서식은 일반 텍스트와 자동번호 문단만 지원합니다",
                ));
            }
            let info = &self.document.doc_info;
            if p.para_shape_id as usize >= info.para_shapes.len()
                || p.style_id as usize >= info.styles.len()
                || p.char_shapes.is_empty()
            {
                return Err(error("각주 문단 모양/스타일 참조 오류"));
            }
            for r in &p.char_shapes {
                let cs = info
                    .char_shapes
                    .get(r.char_shape_id as usize)
                    .ok_or_else(|| error("각주 글자 모양 참조 범위 초과"))?;
                if cs.border_fill_id as usize > info.border_fills.len()
                    || cs.font_ids.iter().enumerate().any(|(lang, id)| {
                        info.font_faces
                            .get(lang)
                            .is_none_or(|f| *id as usize >= f.len())
                    })
                {
                    return Err(error("각주 기존 글꼴/테두리 참조 범위 초과"));
                }
            }
            for offset in from..to {
                let id = p
                    .char_shape_id_at(offset)
                    .ok_or_else(|| error("각주 글자 모양 없음"))?;
                if let Some(last) = runs
                    .last_mut()
                    .filter(|r| r.0 == pi && r.2 == offset && r.3 == id)
                {
                    last.2 = offset + 1;
                } else {
                    runs.push((pi, offset, offset + 1, id));
                }
            }
        }
        if self
            .document
            .doc_info
            .char_shapes
            .len()
            .saturating_add(runs.len())
            > u16::MAX as usize + 1
        {
            return Err(error("각주 글자 모양 정의 수 한도 초과"));
        }
        if runs.is_empty() || props.as_object().unwrap().is_empty() {
            return Ok("{\"ok\":true,\"changed\":false}".into());
        }
        let mut effective = props.clone();
        if let Some(name) = props.get("fontName").and_then(Value::as_str) {
            let ids: Vec<i32> = (0..7)
                .map(|lang| self.find_or_create_font_id_for_lang(lang, name))
                .collect();
            effective.as_object_mut().unwrap().remove("fontName");
            effective["fontIds"] = serde_json::to_value(ids).unwrap();
        }
        let mods = parse_char_shape_mods(&effective.to_string());
        let flow = char_shape_mods_affect_text_flow(&mods);
        let mut changed = false;
        for (pi, from, to, base) in &runs {
            let id = self.document.find_or_create_char_shape(*base, &mods);
            if id != *base {
                self.get_footnote_paragraph_mut(sec, parent, control, *pi)?
                    .apply_char_shape_range(*from, *to, id);
                changed = true;
            }
        }
        if changed {
            if flow {
                for pi in start_para..=end_para {
                    self.reflow_footnote_paragraph(sec, parent, control, pi)
                }
            }
            self.document.sections[sec].raw_stream = None;
            self.rebuild_section_deferred_in_batch(sec);
            self.event_log.push(DocumentEvent::CharFormatChanged {
                section: sec,
                para: parent,
                start,
                end,
            });
        }
        Ok(format!("{{\"ok\":true,\"changed\":{changed}}}"))
    }
}

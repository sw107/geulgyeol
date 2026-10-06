//! Atomic paragraph formatting for plain note selections and saved dialog targets.
use super::paragraph_paths::validate_props;
use crate::{
    document_core::{
        helpers::{
            build_tab_def_from_json, json_has_border_keys, json_has_tab_keys, parse_json_i16_array,
            parse_para_shape_mods,
        },
        DocumentCore,
    },
    error::HwpError,
    model::{control::Control, event::DocumentEvent, style::HeadType},
};
use serde_json::Value;
fn error(s: impl ToString) -> HwpError {
    HwpError::RenderError(s.to_string())
}
impl DocumentCore {
    #[allow(clippy::too_many_arguments)]
    pub fn apply_para_format_in_footnote_range_native(
        &mut self,
        sec: usize,
        parent: usize,
        ctrl: usize,
        first: usize,
        start: usize,
        last: usize,
        end: usize,
        json: &str,
    ) -> Result<String, HwpError> {
        let props: Value = serde_json::from_str(json).map_err(error)?;
        validate_props(&props)?;
        if ["fillColor", "patternColor", "patternType"]
            .iter()
            .any(|k| props.get(k).is_some())
            && props.get("fillType").is_none()
        {
            return Err(error("각주 배경 변경에는 fillType이 필요합니다"));
        }
        if (first, start) > (last, end) {
            return Err(error("각주 문단 서식 범위 순서 오류"));
        }
        let mut bases = vec![];
        for pi in first..=last {
            let p = self
                .get_footnote_paragraph_ref(sec, parent, ctrl, pi)
                .ok_or_else(|| error("각주/미주 문단 범위 초과"))?;
            let len = p.text.chars().count();
            if (pi == first && start > len) || (pi == last && end > len) {
                return Err(error("각주 문자 범위 초과"));
            }
            if p.char_offsets.len() != len
                || p.controls
                    .iter()
                    .any(|c| !matches!(c, Control::AutoNumber(_)))
            {
                return Err(error(
                    "각주 문단 서식은 일반 텍스트와 자동번호 문단만 지원합니다",
                ));
            }
            let info = &self.document.doc_info;
            let shape = info
                .para_shapes
                .get(p.para_shape_id as usize)
                .ok_or_else(|| error("각주 문단 모양 참조 오류"))?;
            if p.style_id as usize >= info.styles.len()
                || p.char_shapes.is_empty()
                || shape.border_fill_id as usize > info.border_fills.len()
                || (shape.tab_def_id != 0 && shape.tab_def_id as usize >= info.tab_defs.len())
            {
                return Err(error("각주 기존 스타일/탭/테두리 참조 오류"));
            }
            for r in &p.char_shapes {
                let cs = info
                    .char_shapes
                    .get(r.char_shape_id as usize)
                    .ok_or_else(|| error("각주 글자 모양 참조 오류"))?;
                if cs.border_fill_id as usize > info.border_fills.len()
                    || cs.font_ids.iter().enumerate().any(|(l, id)| {
                        info.font_faces
                            .get(l)
                            .is_none_or(|f| *id as usize >= f.len())
                    })
                {
                    return Err(error("각주 기존 글꼴/글자 테두리 참조 오류"));
                }
            }
            let head = match props.get("headType").and_then(Value::as_str) {
                Some("Number") => HeadType::Number,
                Some("Outline") => HeadType::Outline,
                Some("Bullet") => HeadType::Bullet,
                Some("None") => HeadType::None,
                _ => shape.head_type,
            };
            let number = props
                .get("numberingId")
                .and_then(Value::as_u64)
                .map_or(shape.numbering_id as usize, |n| n as usize);
            let limit = match head {
                HeadType::Number | HeadType::Outline => info.numberings.len(),
                HeadType::Bullet => info.bullets.len(),
                HeadType::None => info.numberings.len().max(info.bullets.len()),
            };
            if number > limit
                || props
                    .get("borderFillId")
                    .and_then(Value::as_u64)
                    .is_some_and(|id| id as usize > info.border_fills.len())
            {
                return Err(error("각주 번호/테두리 참조 범위 초과"));
            }
            bases.push(p.para_shape_id);
        }
        let info = &self.document.doc_info;
        if info.para_shapes.len().saturating_add(bases.len()) > u16::MAX as usize + 1
            || info.tab_defs.len().saturating_add(bases.len()) > u16::MAX as usize + 1
            || info.border_fills.len().saturating_add(bases.len()) > u16::MAX as usize
        {
            return Err(error("각주 문단 모양 정의 수 한도 초과"));
        }
        if props.as_object().unwrap().is_empty() {
            return Ok("{\"ok\":true,\"changed\":false}".into());
        }
        let mut changed = false;
        for (offset, base) in bases.iter().enumerate() {
            let shape = &self.document.doc_info.para_shapes[*base as usize];
            let mut effective = props.clone();
            // Border mutations start from each paragraph's own definition and keep omitted fill fields.
            if json_has_border_keys(json) {
                let fields = effective.as_object_mut().unwrap();
                fields
                    .entry("borderFillId")
                    .or_insert(Value::from(shape.border_fill_id));
                if fields.get("fillType").and_then(Value::as_str) == Some("solid") {
                    let seed = fields["borderFillId"].as_u64().unwrap() as usize;
                    let solid = seed
                        .checked_sub(1)
                        .and_then(|i| self.document.doc_info.border_fills.get(i))
                        .and_then(|b| b.fill.solid.as_ref());
                    fields
                        .entry("patternType")
                        .or_insert(Value::from(solid.map_or(-1, |f| f.pattern_type)));
                    fields.entry("patternColor").or_insert(Value::from(format!(
                        "#{:06x}",
                        solid.map_or(0, |f| f.pattern_color)
                    )));
                    fields.entry("fillColor").or_insert(Value::from(format!(
                        "#{:06x}",
                        solid.map_or(0xffffff, |f| f.background_color)
                    )));
                }
            }
            let effective = effective.to_string();
            let mut mods = parse_para_shape_mods(&effective);
            mods.border_fill_id = props
                .get("borderFillId")
                .and_then(Value::as_u64)
                .map(|id| id as u16);
            if json_has_tab_keys(&effective) {
                let td = build_tab_def_from_json(
                    &effective,
                    shape.tab_def_id,
                    &self.document.doc_info.tab_defs,
                );
                mods.tab_def_id = Some(self.document.find_or_create_tab_def(td));
            }
            if json_has_border_keys(&effective) {
                mods.border_fill_id = Some(self.create_border_fill_from_json(&effective));
            }
            if let Some(a) = parse_json_i16_array(&effective, "borderSpacing", 4) {
                mods.border_spacing = Some([a[0], a[1], a[2], a[3]]);
            }
            let id = self.document.find_or_create_para_shape(*base, &mods);
            if id != *base {
                self.get_footnote_paragraph_mut(sec, parent, ctrl, first + offset)?
                    .para_shape_id = id;
                changed = true;
            }
        }
        if changed {
            self.rebuild_resolved_styles();
            for pi in first..=last {
                self.reflow_footnote_paragraph(sec, parent, ctrl, pi);
            }
            self.document.sections[sec].raw_stream = None;
            self.rebuild_section_deferred_in_batch(sec);
            self.event_log.push(DocumentEvent::ParaFormatChanged {
                section: sec,
                para: parent,
            });
        }
        Ok(format!("{{\"ok\":true,\"changed\":{changed}}}"))
    }
}

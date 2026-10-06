//! Validate style metadata before changing names, references or the style table.
use crate::{document_core::DocumentCore, error::HwpError, model::style::Style};
use serde_json::{Map, Value};

fn error(message: &str) -> HwpError {
    HwpError::RenderError(message.into())
}
fn object(json: &str) -> Result<Map<String, Value>, HwpError> {
    let value: Value = serde_json::from_str(if json.trim().is_empty() { "{}" } else { json })
        .map_err(|_| error("잘못된 스타일 메타데이터 JSON입니다."))?;
    value
        .as_object()
        .cloned()
        .ok_or_else(|| error("스타일 메타데이터는 JSON 객체여야 합니다."))
}
fn name(fields: &Map<String, Value>, key: &str) -> Result<Option<String>, HwpError> {
    fields
        .get(key)
        .map(|v| {
            let s = v
                .as_str()
                .ok_or_else(|| error("스타일 이름은 문자열이어야 합니다."))?;
            if s.encode_utf16().count() > u16::MAX as usize {
                return Err(error("스타일 이름의 저장 길이를 초과했습니다."));
            }
            Ok(s.to_owned())
        })
        .transpose()
}
fn number(fields: &Map<String, Value>, key: &str) -> Result<Option<u64>, HwpError> {
    fields
        .get(key)
        .map(|v| {
            v.as_u64()
                .ok_or_else(|| error("스타일 참조는 음수가 아닌 정수여야 합니다."))
        })
        .transpose()
}
fn next_style(fields: &Map<String, Value>, count: usize) -> Result<Option<u8>, HwpError> {
    number(fields, "nextStyleId")?
        .map(|id| {
            let id = u8::try_from(id).map_err(|_| error("다음 스타일 ID 범위를 초과했습니다."))?;
            if id as usize >= count {
                return Err(error("다음 스타일이 문서에 없습니다."));
            }
            Ok(id)
        })
        .transpose()
}
fn shape(
    fields: &Map<String, Value>,
    key: &str,
    fallback: u16,
    count: usize,
) -> Result<u16, HwpError> {
    let id = match number(fields, key)? {
        Some(id) => u16::try_from(id).map_err(|_| error("기본 모양 ID 범위를 초과했습니다."))?,
        None => fallback,
    };
    if id as usize >= count {
        return Err(error("기본 모양이 문서에 없습니다."));
    }
    Ok(id)
}
impl DocumentCore {
    fn validate_style_metadata_table(&self) -> Result<(), HwpError> {
        let info = &self.document.doc_info;
        if info.styles.len() > 256
            || info.styles.iter().any(|s| {
                s.style_type > 1
                    || s.next_style_id as usize >= info.styles.len()
                    || s.char_shape_id as usize >= info.char_shapes.len()
                    || s.para_shape_id as usize >= info.para_shapes.len()
            })
            || info
                .extra_records
                .iter()
                .any(|r| r.tag_id == crate::parser::tags::HWPTAG_STYLE)
        {
            return Err(error(
                "스타일 정의에 잘못되거나 지원하지 않는 참조가 있어 변경하지 않았습니다.",
            ));
        }
        Ok(())
    }

    /// Add a style using existing shape definitions. All checks precede mutation.
    /// The new style may name itself as its next style, including ID 255.
    pub fn create_style_native(&mut self, json: &str) -> Result<usize, HwpError> {
        let fields = object(json)?;
        self.validate_style_metadata_table()?;
        let info = &self.document.doc_info;
        let id = info.styles.len();
        if id >= 256 {
            return Err(error(
                "문서의 스타일 ID 범위를 초과하여 추가하지 않았습니다.",
            ));
        }
        let style_type = number(&fields, "type")?.unwrap_or(0);
        if style_type > 1 {
            return Err(error("지원하지 않는 스타일 종류입니다."));
        }
        let fallback = info.styles.first();
        let new_style = Style {
            raw_data: None,
            local_name: name(&fields, "name")?.unwrap_or_default(),
            english_name: name(&fields, "englishName")?.unwrap_or_default(),
            style_type: style_type as u8,
            next_style_id: next_style(&fields, id + 1)?.unwrap_or(0),
            lang_id: 1042,
            char_shape_id: shape(
                &fields,
                "baseCharShapeId",
                fallback.map(|s| s.char_shape_id).unwrap_or(0),
                info.char_shapes.len(),
            )?,
            para_shape_id: shape(
                &fields,
                "baseParaShapeId",
                fallback.map(|s| s.para_shape_id).unwrap_or(0),
                info.para_shapes.len(),
            )?,
            lock_form: false,
        };
        self.document.doc_info.styles.push(new_style);
        self.document.doc_info.raw_stream_dirty = true;
        self.rebuild_resolved_styles();
        Ok(id)
    }

    /// Change only names/next-style reference, or reject the entire update.
    pub fn update_style_metadata_native(
        &mut self,
        style_id: usize,
        json: &str,
    ) -> Result<(), HwpError> {
        let fields = object(json)?;
        self.validate_style_metadata_table()?;
        let info = &self.document.doc_info;
        let old = info
            .styles
            .get(style_id)
            .ok_or_else(|| error("변경할 스타일이 문서에 없습니다."))?;
        let local_name = name(&fields, "name")?.unwrap_or_else(|| old.local_name.clone());
        let english_name =
            name(&fields, "englishName")?.unwrap_or_else(|| old.english_name.clone());
        let next_style_id = next_style(&fields, info.styles.len())?.unwrap_or(old.next_style_id);
        if local_name == old.local_name
            && english_name == old.english_name
            && next_style_id == old.next_style_id
        {
            return Ok(());
        }
        let style = &mut self.document.doc_info.styles[style_id];
        style.local_name = local_name;
        style.english_name = english_name;
        style.next_style_id = next_style_id;
        style.raw_data = None;
        self.document.doc_info.raw_stream_dirty = true;
        Ok(())
    }
}

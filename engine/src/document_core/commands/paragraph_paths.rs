//! Direct paragraph formatting of table-only paths, with atomic target preflight.
use super::format_copy::parse_path;
use crate::{document_core::DocumentCore, error::HwpError, model::style::HeadType};
use serde_json::Value;
use std::collections::BTreeSet;
fn error(message: impl ToString) -> HwpError {
    HwpError::RenderError(message.to_string())
}
fn integer(v: &Value, min: i64, max: i64) -> bool {
    v.as_i64().is_some_and(|n| n >= min && n <= max)
}
fn color(v: &Value) -> bool {
    v.as_str().is_some_and(|s| {
        s.len() == 7 && s.starts_with('#') && s[1..].bytes().all(|c| c.is_ascii_hexdigit())
    })
}
fn validate_props(props: &Value) -> Result<(), HwpError> {
    let fields = props
        .as_object()
        .ok_or_else(|| error("문단 모양은 JSON 객체여야 합니다"))?;
    for (key, value) in fields {
        let valid = match key.as_str() {
            "alignment" => value.as_str().is_some_and(|s| {
                [
                    "left",
                    "right",
                    "center",
                    "justify",
                    "distribute",
                    "split",
                    "division",
                ]
                .contains(&s)
            }),
            "lineSpacingType" => value
                .as_str()
                .is_some_and(|s| ["Percent", "Fixed", "SpaceOnly", "Minimum"].contains(&s)),
            "headType" => value
                .as_str()
                .is_some_and(|s| ["None", "Outline", "Number", "Bullet"].contains(&s)),
            "marginLeft" | "marginRight" | "indent" | "spacingBefore" | "spacingAfter" => {
                integer(value, i32::MIN as i64, i32::MAX as i64)
            }
            "lineSpacing" => integer(value, 0, i32::MAX as i64),
            "numberingId" | "borderFillId" => integer(value, 0, u16::MAX as i64),
            "paraLevel" => integer(value, 0, 6),
            "verticalAlign" => integer(value, 0, 3),
            "englishBreakUnit" => integer(value, 0, 2),
            "koreanBreakUnit" => integer(value, 0, 1),
            "widowOrphan" | "keepWithNext" | "keepLines" | "pageBreakBefore" | "fontLineHeight"
            | "singleLine" | "autoSpaceKrEn" | "autoSpaceKrNum" | "borderConnect"
            | "borderIgnoreMargin" | "tabAutoLeft" | "tabAutoRight" => value.is_boolean(),
            "tabStops" => value.as_array().is_some_and(|a| {
                a.iter().all(|v| {
                    v.as_object().is_some_and(|o| {
                        o.len() == 3
                            && integer(&v["position"], 0, i32::MAX as i64)
                            && integer(&v["type"], 0, u8::MAX as i64)
                            && integer(&v["fill"], 0, u8::MAX as i64)
                    })
                })
            }),
            "borderLeft" | "borderRight" | "borderTop" | "borderBottom" => {
                value.as_object().is_some_and(|o| {
                    o.len() == 3
                        && integer(&value["type"], 0, u8::MAX as i64)
                        && integer(&value["width"], 0, u8::MAX as i64)
                        && color(&value["color"])
                })
            }
            "fillType" => value
                .as_str()
                .is_some_and(|s| ["none", "solid"].contains(&s)),
            "fillColor" | "patternColor" => color(value),
            "patternType" => integer(value, -1, 6),
            "borderSpacing" => value.as_array().is_some_and(|a| {
                a.len() == 4
                    && a.iter()
                        .all(|v| integer(v, i16::MIN as i64, i16::MAX as i64))
            }),
            _ => false,
        };
        if !valid {
            return Err(error(format!(
                "문단 모양 항목/값을 지원하지 않습니다: {key}"
            )));
        }
    }
    Ok(())
}
impl DocumentCore {
    pub fn apply_para_format_in_cells_by_paths_native(
        &mut self,
        sec: usize,
        parent: usize,
        paths_json: &str,
        props_json: &str,
    ) -> Result<String, HwpError> {
        let props: Value = serde_json::from_str(props_json).map_err(error)?;
        validate_props(&props)?;
        if props
            .get("borderFillId")
            .and_then(Value::as_u64)
            .is_some_and(|id| id as usize > self.document.doc_info.border_fills.len())
        {
            return Err(error("테두리 모양 참조 범위 초과"));
        }
        let entries: Vec<Value> = serde_json::from_str(paths_json).map_err(error)?;
        if entries.is_empty() {
            return Err(error("문단 모양 대상이 없습니다"));
        }
        let mut paths = BTreeSet::new();
        for entry in entries {
            let p = parse_path(&entry.to_string())?;
            self.validate_cell_format_path(sec, parent, &p)?;
            paths.insert(p);
        }
        // Validate every original and incoming reference before allocating any format definitions.
        for path in &paths {
            let para = self.resolve_paragraph_by_path(sec, parent, path)?;
            let info = &self.document.doc_info;
            let shape = info
                .para_shapes
                .get(para.para_shape_id as usize)
                .ok_or_else(|| error("문단 모양 참조 범위 초과"))?;
            if para.style_id as usize >= info.styles.len()
                || para
                    .char_shapes
                    .iter()
                    .any(|r| r.char_shape_id as usize >= info.char_shapes.len())
                || shape.border_fill_id as usize > info.border_fills.len()
                || (shape.tab_def_id != 0 && shape.tab_def_id as usize >= info.tab_defs.len())
            {
                return Err(error("문단의 기존 스타일/글자/탭/테두리 참조 범위 초과"));
            }
            let head = match props.get("headType").and_then(Value::as_str) {
                Some("Number") => HeadType::Number,
                Some("Bullet") => HeadType::Bullet,
                Some("Outline") => HeadType::Outline,
                Some("None") => HeadType::None,
                _ => shape.head_type,
            };
            let number = props
                .get("numberingId")
                .and_then(Value::as_u64)
                .map_or(shape.numbering_id as usize, |v| v as usize);
            let limit = match head {
                HeadType::Number | HeadType::Outline => info.numberings.len(),
                HeadType::Bullet => info.bullets.len(),
                HeadType::None => info.numberings.len().max(info.bullets.len()),
            };
            if number > limit {
                return Err(error("문단의 번호/글머리 참조 범위 초과"));
            }
        }
        let info = &self.document.doc_info;
        if info.para_shapes.len().saturating_add(paths.len()) > u16::MAX as usize + 1
            || info.tab_defs.len().saturating_add(paths.len()) > u16::MAX as usize + 1
            || info.border_fills.len().saturating_add(paths.len()) > u16::MAX as usize
        {
            return Err(error("문단 모양 정의 수 한도 초과"));
        }
        // Address structure is unchanged by formatting. All mutable lookups below were preflighted.
        if !props.as_object().unwrap().is_empty() {
            for path in &paths {
                let mut effective = props.clone();
                if super::super::helpers::json_has_border_keys(&props.to_string()) {
                    let para = self.resolve_paragraph_by_path(sec, parent, path)?;
                    let base = self.document.doc_info.para_shapes[para.para_shape_id as usize]
                        .border_fill_id;
                    let fields = effective.as_object_mut().unwrap();
                    fields.entry("borderFillId").or_insert(Value::from(base));
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
                self.apply_para_format_in_cell_by_path_native(
                    sec,
                    parent,
                    path,
                    &effective.to_string(),
                )?;
            }
        }
        Ok(format!("{{\"ok\":true,\"paragraphs\":{}}}", paths.len()))
    }
}

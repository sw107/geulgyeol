//! Atomic format-copy entry points for table-only cell paths.
use crate::{
    document_core::DocumentCore,
    error::HwpError,
    model::{
        control::Control,
        paragraph::Paragraph,
        style::HeadType,
        table::{Cell, VerticalAlign},
    },
};
use serde::Deserialize;
use std::collections::BTreeSet;

type CellPath = Vec<(usize, usize, usize)>;
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PathEntry {
    control_index: usize,
    cell_index: usize,
    cell_para_index: usize,
}
#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct OwnProperties {
    padding_left: Option<i16>,
    padding_right: Option<i16>,
    padding_top: Option<i16>,
    padding_bottom: Option<i16>,
    apply_inner_margin: Option<bool>,
    vertical_align: Option<u8>,
    text_direction: Option<u8>,
    is_header: Option<bool>,
    cell_protect: Option<bool>,
    field_name: Option<String>,
    editable_in_form: Option<bool>,
    border_fill_id: Option<u16>,
}
fn error(message: impl ToString) -> HwpError {
    HwpError::RenderError(message.to_string())
}
fn path(entries: Vec<PathEntry>) -> Result<CellPath, HwpError> {
    if entries.is_empty() || entries.len() > 64 {
        return Err(error("모양복사 셀 경로 깊이는 1..64이어야 합니다"));
    }
    Ok(entries
        .into_iter()
        .map(|e| (e.control_index, e.cell_index, e.cell_para_index))
        .collect())
}
pub(super) fn parse_path(json: &str) -> Result<CellPath, HwpError> {
    path(serde_json::from_str(json).map_err(error)?)
}
fn cell_mut<'a>(paragraph: &'a mut Paragraph, path: &[(usize, usize, usize)]) -> &'a mut Cell {
    // Every address was checked before any mutation. Editing properties cannot change this tree.
    let (control, cell, para) = path[0];
    let Control::Table(table) = &mut paragraph.controls[control] else {
        unreachable!()
    };
    if path.len() == 1 {
        &mut table.cells[cell]
    } else {
        cell_mut(&mut table.cells[cell].paragraphs[para], &path[1..])
    }
}
impl DocumentCore {
    pub(crate) fn validate_cell_format_path(
        &self,
        sec: usize,
        parent: usize,
        path: &[(usize, usize, usize)],
    ) -> Result<(), HwpError> {
        let mut para = self
            .document
            .sections
            .get(sec)
            .and_then(|s| s.paragraphs.get(parent))
            .ok_or_else(|| error("셀 서식 본문 주소 범위 초과"))?;
        for &(control, cell, inner) in path {
            let Some(Control::Table(table)) = para.controls.get(control) else {
                return Err(error("셀 서식 경로는 표 셀만 지원합니다"));
            };
            para = table
                .cells
                .get(cell)
                .and_then(|c| c.paragraphs.get(inner))
                .ok_or_else(|| error("셀 서식 셀/문단 주소 범위 초과"))?;
        }
        Ok(())
    }
    pub fn get_cell_own_properties_by_path_native(
        &self,
        sec: usize,
        parent: usize,
        json: &str,
    ) -> Result<String, HwpError> {
        let path = parse_path(json)?;
        self.validate_cell_format_path(sec, parent, &path)?;
        let table = self.resolve_table_by_path(sec, parent, &path)?;
        self.build_cell_properties_json(table, path.last().unwrap().1, false)
    }
    pub fn get_cell_para_properties_by_path_native(
        &self,
        sec: usize,
        parent: usize,
        json: &str,
    ) -> Result<String, HwpError> {
        let path = parse_path(json)?;
        self.validate_cell_format_path(sec, parent, &path)?;
        let para = self.resolve_paragraph_by_path(sec, parent, &path)?;
        Ok(self.build_para_properties_json(para.para_shape_id, sec))
    }
    pub fn apply_cell_own_properties_by_paths_native(
        &mut self,
        sec: usize,
        parent: usize,
        paths_json: &str,
        props_json: &str,
    ) -> Result<String, HwpError> {
        let entries: Vec<Vec<PathEntry>> = serde_json::from_str(paths_json).map_err(error)?;
        if entries.is_empty() {
            return Err(error("모양복사 대상 셀이 없습니다"));
        }
        let mut paths = BTreeSet::new();
        for entries in entries {
            let mut p = path(entries)?;
            self.validate_cell_format_path(sec, parent, &p)?;
            p.last_mut().unwrap().2 = 0;
            paths.insert(p);
        }
        let props: OwnProperties = serde_json::from_str(props_json).map_err(error)?;
        if props.vertical_align.is_some_and(|v| v > 2)
            || props.text_direction.is_some_and(|v| v > 2)
        {
            return Err(error("모양복사 셀 방향/정렬 값 범위 초과"));
        }
        if props
            .border_fill_id
            .is_some_and(|v| v as usize > self.document.doc_info.border_fills.len())
        {
            return Err(error("모양복사 테두리/배경 참조 범위 초과"));
        }
        // Resolve zone overlay semantics before mutable borrows, matching the flat setter.
        let targets = paths
            .iter()
            .map(|p| {
                let table = self
                    .resolve_table_by_path(sec, parent, p)
                    .expect("preflight table");
                let cell = &table.cells[p.last().unwrap().1];
                let border = props
                    .border_fill_id
                    .filter(|&id| !Self::cell_is_covered_by_zone_border_fill(table, cell, id));
                (p.clone(), border, cell.paragraphs.len())
            })
            .collect::<Vec<_>>();
        let reflow = props.padding_left.is_some()
            || props.padding_right.is_some()
            || props.apply_inner_margin.is_some();
        for (p, border, _) in &targets {
            let cell = cell_mut(&mut self.document.sections[sec].paragraphs[parent], p);
            if let Some(v) = props.padding_left {
                cell.padding.left = v;
            }
            if let Some(v) = props.padding_right {
                cell.padding.right = v;
            }
            if let Some(v) = props.padding_top {
                cell.padding.top = v;
            }
            if let Some(v) = props.padding_bottom {
                cell.padding.bottom = v;
            }
            if let Some(v) = props.apply_inner_margin {
                cell.set_apply_inner_margin(v);
            }
            if let Some(v) = props.vertical_align {
                cell.vertical_align = match v {
                    1 => VerticalAlign::Center,
                    2 => VerticalAlign::Bottom,
                    _ => VerticalAlign::Top,
                };
            }
            if let Some(v) = props.text_direction {
                cell.text_direction = v;
            }
            if let Some(v) = props.is_header {
                cell.set_header(v);
            }
            if let Some(v) = props.cell_protect {
                cell.set_cell_protect(v);
            }
            if let Some(v) = props.editable_in_form {
                cell.set_editable_in_form(v);
            }
            if let Some(v) = &props.field_name {
                cell.field_name = if v.is_empty() { None } else { Some(v.clone()) };
            }
            if let Some(v) = border {
                cell.border_fill_id = *v;
            }
        }
        for (p, _, count) in &targets {
            if reflow {
                for para in 0..*count {
                    self.reflow_cell_paragraph_by_path(sec, parent, p, para);
                }
            }
        }
        for control in paths.iter().map(|p| p[0].0).collect::<BTreeSet<_>>() {
            self.mark_cell_control_dirty(sec, parent, control);
        }
        self.document.sections[sec].raw_stream = None;
        self.rebuild_section_deferred_in_batch(sec);
        Ok(format!("{{\"ok\":true,\"cells\":{}}}", paths.len()))
    }
    /// Text selection: char properties only on selected scalars; paragraph properties on touched paragraphs.
    #[allow(clippy::too_many_arguments)]
    pub fn apply_format_copy_in_cell_native(
        &mut self,
        sec: usize,
        parent: usize,
        start_json: &str,
        end_json: &str,
        start: usize,
        end: usize,
        char_json: &str,
        para_json: &str,
    ) -> Result<String, HwpError> {
        let a = parse_path(start_json)?;
        let b = parse_path(end_json)?;
        self.validate_cell_format_path(sec, parent, &a)?;
        self.validate_cell_format_path(sec, parent, &b)?;
        if a.len() != b.len()
            || a[..a.len() - 1] != b[..b.len() - 1]
            || (a.last().unwrap().0, a.last().unwrap().1)
                != (b.last().unwrap().0, b.last().unwrap().1)
        {
            return Err(error("모양복사 텍스트 선택은 같은 셀 안이어야 합니다"));
        }
        let first = a.last().unwrap().2;
        let last = b.last().unwrap().2;
        if first > last || (first == last && start > end) {
            return Err(error("모양복사 선택 순서 오류"));
        }
        let cell = self.resolve_cell_by_path(sec, parent, &a)?;
        let char_props: serde_json::Value = serde_json::from_str(char_json).map_err(error)?;
        let para_props: serde_json::Value = serde_json::from_str(para_json).map_err(error)?;
        if !char_props.is_object() || !para_props.is_object() {
            return Err(error("모양복사 글자/문단 모양은 객체여야 합니다"));
        }
        let char_keys = [
            "fontSize",
            "bold",
            "italic",
            "underline",
            "strikethrough",
            "textColor",
            "shadeColor",
            "emboss",
            "engrave",
            "fontId",
            "fontIds",
            "underlineType",
            "underlineColor",
            "outlineType",
            "shadowType",
            "shadowColor",
            "shadowOffsetX",
            "shadowOffsetY",
            "strikeColor",
            "subscript",
            "superscript",
            "ratios",
            "spacings",
            "relativeSizes",
            "charOffsets",
            "emphasisDot",
            "underlineShape",
            "strikeShape",
            "kerning",
        ];
        let para_keys = [
            "alignment",
            "lineSpacing",
            "lineSpacingType",
            "marginLeft",
            "marginRight",
            "indent",
            "spacingBefore",
            "spacingAfter",
            "headType",
            "paraLevel",
            "numberingId",
            "widowOrphan",
            "keepWithNext",
            "keepLines",
            "pageBreakBefore",
            "fontLineHeight",
            "singleLine",
            "autoSpaceKrEn",
            "autoSpaceKrNum",
            "verticalAlign",
            "englishBreakUnit",
            "koreanBreakUnit",
            "borderConnect",
            "borderIgnoreMargin",
        ];
        for (props, keys) in [
            (&char_props, char_keys.as_slice()),
            (&para_props, para_keys.as_slice()),
        ] {
            if props
                .as_object()
                .unwrap()
                .keys()
                .any(|k| !keys.contains(&k.as_str()))
            {
                return Err(error("모양복사 지원하지 않는 모양 항목"));
            }
        }
        for key in ["fontId", "numberingId"] {
            let props = if key == "fontId" {
                &char_props
            } else {
                &para_props
            };
            if let Some(v) = props.get(key) {
                let id = v
                    .as_u64()
                    .filter(|v| *v <= u16::MAX as u64)
                    .ok_or_else(|| error("모양복사 모양 참조 타입/범위 오류"))?
                    as usize;
                if key == "fontId" {
                    if self
                        .document
                        .doc_info
                        .font_faces
                        .first()
                        .is_none_or(|fonts| id >= fonts.len())
                    {
                        return Err(error("모양복사 글꼴 참조 범위 초과"));
                    }
                } else if id
                    > self
                        .document
                        .doc_info
                        .numberings
                        .len()
                        .max(self.document.doc_info.bullets.len())
                {
                    return Err(error("모양복사 번호/글머리 참조 범위 초과"));
                }
            }
        }
        if let Some(fonts) = char_props.get("fontIds") {
            let fonts = fonts
                .as_array()
                .filter(|a| a.len() == 7)
                .ok_or_else(|| error("모양복사 글꼴 참조 배열 오류"))?;
            for (lang, id) in fonts.iter().enumerate() {
                let id = id
                    .as_u64()
                    .filter(|v| *v <= u16::MAX as u64)
                    .ok_or_else(|| error("모양복사 글꼴 참조 타입/범위 오류"))?
                    as usize;
                if self
                    .document
                    .doc_info
                    .font_faces
                    .get(lang)
                    .is_none_or(|fonts| id >= fonts.len())
                {
                    return Err(error("모양복사 언어별 글꼴 참조 범위 초과"));
                }
            }
        }
        let has_chars = !char_props.as_object().unwrap().is_empty();
        let has_paras = !para_props.as_object().unwrap().is_empty();
        let mut ranges = Vec::new();
        for index in first..=last {
            let para = &cell.paragraphs[index];
            if para
                .char_shapes
                .iter()
                .any(|r| r.char_shape_id as usize >= self.document.doc_info.char_shapes.len())
                || para.para_shape_id as usize >= self.document.doc_info.para_shapes.len()
            {
                return Err(error("모양복사 문단 모양 참조 범위 초과"));
            }
            let base = &self.document.doc_info.para_shapes[para.para_shape_id as usize];
            let head = match para_props.get("headType").and_then(|v| v.as_str()) {
                Some("Number") => HeadType::Number,
                Some("Bullet") => HeadType::Bullet,
                Some("Outline") => HeadType::Outline,
                Some("None") => HeadType::None,
                Some(_) => return Err(error("모양복사 문단 머리 유형 오류")),
                None => base.head_type,
            };
            let number = para_props
                .get("numberingId")
                .and_then(|v| v.as_u64())
                .map_or(base.numbering_id as usize, |v| v as usize);
            let limit = match head {
                HeadType::Bullet => self.document.doc_info.bullets.len(),
                HeadType::Number | HeadType::Outline => self.document.doc_info.numberings.len(),
                HeadType::None => self
                    .document
                    .doc_info
                    .numberings
                    .len()
                    .max(self.document.doc_info.bullets.len()),
            };
            if number > limit {
                return Err(error(
                    "모양복사 문단 머리 유형의 번호/글머리 참조 범위 초과",
                ));
            }
            let length = para.text.chars().count();
            let lo = if index == first { start } else { 0 };
            let hi = if index == last { end } else { length };
            if lo > hi || hi > length {
                return Err(error("모양복사 선택 글자 범위 초과"));
            }
            let mut p = a.clone();
            p.last_mut().unwrap().2 = index;
            ranges.push((p, lo, hi));
        }
        // All paths and ranges are checked before format definitions can be allocated.
        for (p, lo, hi) in ranges {
            if has_chars && lo < hi {
                self.apply_char_format_in_cell_by_path(sec, parent, &p, lo, hi, char_json)?;
            }
            if has_paras {
                self.apply_para_format_in_cell_by_path_native(sec, parent, &p, para_json)?;
            }
        }
        Ok("{\"ok\":true}".into())
    }
}

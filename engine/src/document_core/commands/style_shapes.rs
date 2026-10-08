//! Transactional style shape propagation through modeled paragraph containers.
use super::formatting::{char_shape_mods_affect_text_flow, para_shape_mods_affect_text_flow};
use crate::{
    document_core::{
        helpers::{parse_char_shape_mods, parse_para_shape_mods},
        DocumentCore,
    },
    error::HwpError,
    model::{
        control::Control,
        paragraph::Paragraph,
        shape::{Caption, CaptionDirection, ShapeObject},
    },
    renderer::{
        composer::{reflow_line_segs, ParagraphBox},
        style_resolver::{resolve_styles_for_document, ResolvedStyleSet},
    },
};
#[derive(Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ShapeReport {
    paragraphs_updated: usize,
}
struct Propagate<'a> {
    target: usize,
    count: usize,
    old_char: u32,
    new_char: u32,
    old_para: u16,
    new_para: u16,
    paragraph_style: bool,
    reflow: bool,
    char_count: usize,
    para_count: usize,
    styles: &'a ResolvedStyleSet,
    dpi: f64,
    is_hwp3_variant: bool,
    report: ShapeReport,
}
impl Propagate<'_> {
    fn error(message: &str) -> HwpError {
        HwpError::RenderError(message.into())
    }
    fn paragraphs(
        &mut self,
        ps: &mut [Paragraph],
        depth: usize,
        width: f64,
    ) -> Result<bool, HwpError> {
        if depth > 64 {
            return Err(Self::error(
                "과도한 중첩 문서의 스타일은 안전하게 변경할 수 없습니다.",
            ));
        }
        let mut changed = false;
        let mut first_reflow = None;
        for (index, p) in ps.iter_mut().enumerate() {
            if p.style_id as usize >= self.count
                || p.para_shape_id as usize >= self.para_count
                || p.char_shapes
                    .iter()
                    .any(|r| r.char_shape_id as usize >= self.char_count)
            {
                return Err(Self::error(
                    "문단에 잘못된 스타일/모양 참조가 있어 변경하지 않았습니다.",
                ));
            }
            if p.style_id as usize == self.target {
                let para_changed = self.paragraph_style
                    && p.para_shape_id == self.old_para
                    && self.old_para != self.new_para;
                let char_changed = self.old_char != self.new_char
                    && (p.char_shapes.is_empty()
                        || p.char_shapes
                            .iter()
                            .any(|r| r.char_shape_id == self.old_char));
                if para_changed {
                    p.para_shape_id = self.new_para;
                }
                if char_changed {
                    p.replace_style_char_shape_preserving_overrides(self.old_char, self.new_char);
                }
                if para_changed || char_changed {
                    if self.reflow {
                        first_reflow.get_or_insert(index);
                        let style = self.styles.para_styles.get(p.para_shape_id as usize);
                        let margins = style.map(|s| s.margin_left + s.margin_right).unwrap_or(0.0);
                        reflow_line_segs(
                            p,
                            ParagraphBox::content_width_px((width - margins).max(0.0), self.dpi),
                            self.styles,
                            self.dpi,
                        );
                    }
                    self.report.paragraphs_updated += 1;
                    changed = true;
                }
            }
            for c in &mut p.controls {
                changed |= self.control(c, depth + 1, width)?;
            }
        }
        if let Some(first) = first_reflow {
            super::text_editing::recalculate_cell_paragraph_vpos(
                ps,
                first,
                None,
                self.styles,
                self.dpi,
                self.is_hwp3_variant,
            );
        }
        Ok(changed)
    }
    fn caption(&mut self, c: &mut Caption, depth: usize, fallback: f64) -> Result<bool, HwpError> {
        let width = match c.direction {
            CaptionDirection::Left | CaptionDirection::Right => c.width,
            _ => c.max_width,
        };
        let width = if width > 0 {
            crate::renderer::hwpunit_to_px(width as i32, self.dpi)
        } else {
            fallback
        };
        self.paragraphs(&mut c.paragraphs, depth, width)
    }
    fn shape(&mut self, s: &mut ShapeObject, depth: usize, width: f64) -> Result<bool, HwpError> {
        if depth > 64 {
            return Err(Self::error(
                "과도한 중첩 도형의 스타일은 안전하게 변경할 수 없습니다.",
            ));
        }
        let mut changed = false;
        let shape_width = crate::renderer::hwpunit_to_px(s.common().width as i32, self.dpi);
        if let Some(d) = s.drawing_mut() {
            if let Some(t) = &mut d.text_box {
                changed |= self.paragraphs(
                    &mut t.paragraphs,
                    depth + 1,
                    (shape_width
                        - crate::renderer::hwpunit_to_px(
                            t.margin_left as i32 + t.margin_right as i32,
                            self.dpi,
                        ))
                    .max(0.0),
                )?;
            }
            if let Some(c) = &mut d.caption {
                changed |= self.caption(c, depth + 1, width)?;
            }
        }
        match s {
            ShapeObject::Group(g) => {
                for s in &mut g.children {
                    changed |= self.shape(s, depth + 1, width)?;
                }
                if let Some(c) = &mut g.caption {
                    changed |= self.caption(c, depth + 1, width)?;
                }
            }
            ShapeObject::Picture(p) => {
                if let Some(c) = &mut p.caption {
                    changed |= self.caption(c, depth + 1, width)?;
                }
            }
            ShapeObject::Chart(p) => {
                if let Some(c) = &mut p.caption {
                    changed |= self.caption(c, depth + 1, width)?;
                }
            }
            ShapeObject::Ole(p) => {
                if let Some(c) = &mut p.caption {
                    changed |= self.caption(c, depth + 1, width)?;
                }
            }
            _ => {}
        }
        Ok(changed)
    }
    fn control(&mut self, c: &mut Control, depth: usize, width: f64) -> Result<bool, HwpError> {
        if depth > 64 {
            return Err(Self::error(
                "과도한 중첩 개체의 스타일은 안전하게 변경할 수 없습니다.",
            ));
        }
        match c {
            Control::Table(t) => {
                let mut changed = false;
                let metrics = DocumentCore::table_cell_reflow_metrics(t);
                for (c, (owner, left, right)) in t.cells.iter_mut().zip(metrics) {
                    let cell_width = crate::renderer::hwpunit_to_px(
                        owner - left as i32 - right as i32,
                        self.dpi,
                    )
                    .max(0.0);
                    changed |= self.paragraphs(&mut c.paragraphs, depth, cell_width)?;
                }
                if let Some(c) = &mut t.caption {
                    changed |= self.caption(c, depth, width)?;
                }
                if changed {
                    t.dirty = true;
                }
                Ok(changed)
            }
            Control::Shape(s) => self.shape(s, depth, width),
            Control::Picture(p) => {
                if let Some(c) = &mut p.caption {
                    self.caption(c, depth, width)
                } else {
                    Ok(false)
                }
            }
            Control::Header(h) => self.paragraphs(&mut h.paragraphs, depth, width),
            Control::Footer(h) => self.paragraphs(&mut h.paragraphs, depth, width),
            Control::Footnote(h) => self.paragraphs(&mut h.paragraphs, depth, width),
            Control::Endnote(h) => self.paragraphs(&mut h.paragraphs, depth, width),
            Control::HiddenComment(h) => self.paragraphs(&mut h.paragraphs, depth, width),
            Control::Field(h) => self.paragraphs(&mut h.memo_paragraphs, depth, width),
            Control::SectionDef(s) => {
                if !s.master_pages.is_empty() {
                    return Err(Self::error(
                        "바탕쪽이 포함된 문서의 스타일 모양 변경은 아직 지원하지 않습니다.",
                    ));
                }
                if s.extra_child_records
                    .iter()
                    .any(|r| r.tag_id == crate::parser::tags::HWPTAG_PARA_HEADER)
                {
                    return Err(Self::error(
                        "모델링되지 않은 문단의 스타일 참조가 있어 변경하지 않았습니다.",
                    ));
                }
                let mut changed = false;
                for m in &mut s.master_pages {
                    changed |= self.paragraphs(&mut m.paragraphs, depth, width)?;
                }
                Ok(changed)
            }
            Control::Ruby(r) => {
                let old = r.style_id_ref as usize;
                if old >= self.count || old == self.target {
                    return Err(Self::error(
                        "덧말의 스타일 참조를 안전하게 변경할 수 없습니다.",
                    ));
                }
                Ok(false)
            }
            Control::Unknown(_) => Err(Self::error(
                "알 수 없는 개체가 있어 스타일 참조를 안전하게 바꿀 수 없습니다.",
            )),
            _ => Ok(false),
        }
    }
}
impl DocumentCore {
    /// Validate and propagate on a clone; no document/cache changes on rejection.
    pub fn update_style_shapes_native(
        &mut self,
        style_id: usize,
        char_json: &str,
        para_json: &str,
    ) -> Result<String, HwpError> {
        let normalize = |s: &str| -> Result<String, HwpError> {
            let v: serde_json::Value =
                serde_json::from_str(if s.trim().is_empty() { "{}" } else { s })
                    .map_err(|_| Propagate::error("잘못된 스타일 모양 JSON입니다."))?;
            if !v.is_object() {
                return Err(Propagate::error("스타일 모양은 JSON 객체여야 합니다."));
            }
            Ok(v.to_string())
        };
        let char_json = normalize(char_json)?;
        let para_json = normalize(para_json)?;
        let info = &self.document.doc_info;
        if style_id >= info.styles.len()
            || info.styles.len() > 256
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
            return Err(Propagate::error(
                "스타일 정의에 잘못되거나 지원하지 않는 참조가 있어 변경하지 않았습니다.",
            ));
        }
        let old = info.styles[style_id].clone();
        let char_mods = parse_char_shape_mods(&char_json);
        let para_mods = parse_para_shape_mods(&para_json);
        let new_char = char_mods.apply_to(&info.char_shapes[old.char_shape_id as usize]);
        let new_para = para_mods.apply_to(&info.para_shapes[old.para_shape_id as usize]);
        let char_changed = new_char != info.char_shapes[old.char_shape_id as usize];
        // Character styles never alter paragraph shape definitions or references.
        let para_changed =
            old.style_type == 0 && new_para != info.para_shapes[old.para_shape_id as usize];
        if (char_changed && info.char_shapes.len() > u16::MAX as usize)
            || (para_changed && info.para_shapes.len() > u16::MAX as usize)
        {
            return Err(Propagate::error(
                "스타일 모양 ID 범위를 초과하여 변경하지 않았습니다.",
            ));
        }
        let mut candidate = self.document.clone();
        if char_changed {
            let id = candidate.doc_info.char_shapes.len() as u16;
            candidate.doc_info.char_shapes.push(new_char);
            candidate.doc_info.styles[style_id].char_shape_id = id;
        }
        if para_changed {
            let id = candidate.doc_info.para_shapes.len() as u16;
            candidate.doc_info.para_shapes.push(new_para);
            candidate.doc_info.styles[style_id].para_shape_id = id;
        }
        let updated = &candidate.doc_info.styles[style_id];
        let resolved = resolve_styles_for_document(&candidate, self.dpi);
        let mut propagation = Propagate {
            target: style_id,
            count: candidate.doc_info.styles.len(),
            old_char: old.char_shape_id as u32,
            new_char: updated.char_shape_id as u32,
            old_para: old.para_shape_id,
            new_para: updated.para_shape_id,
            paragraph_style: old.style_type == 0,
            reflow: (char_changed && char_shape_mods_affect_text_flow(&char_mods))
                || (para_changed
                    && (para_shape_mods_affect_text_flow(&para_mods)
                        || para_mods.spacing_before.is_some()
                        || para_mods.spacing_after.is_some())),
            char_count: self.document.doc_info.char_shapes.len(),
            para_count: self.document.doc_info.para_shapes.len(),
            styles: &resolved,
            dpi: self.dpi,
            is_hwp3_variant: self.document.layout_profile().hwp3_layout(),
            report: ShapeReport::default(),
        };
        for section in &mut candidate.sections {
            if !section.section_def.master_pages.is_empty()
                || section
                    .section_def
                    .extra_child_records
                    .iter()
                    .any(|r| r.tag_id == crate::parser::tags::HWPTAG_PARA_HEADER)
            {
                return Err(Propagate::error(
                    "바탕쪽 또는 모델링되지 않은 문단의 스타일 모양 변경은 아직 지원하지 않습니다.",
                ));
            }
            let page = &section.section_def.page_def;
            let width = crate::renderer::hwpunit_to_px(
                (page.width as i64 - page.margin_left as i64 - page.margin_right as i64)
                    .clamp(0, i32::MAX as i64) as i32,
                self.dpi,
            );
            // Body paragraphs are reflowed below with their actual column boxes.
            let reflow = propagation.reflow;
            for p in &mut section.paragraphs {
                let controls = std::mem::take(&mut p.controls);
                propagation.reflow = false;
                propagation.paragraphs(std::slice::from_mut(p), 0, width)?;
                p.controls = controls;
                propagation.reflow = reflow;
                for c in &mut p.controls {
                    propagation.control(c, 1, width)?;
                }
            }
            if char_changed || para_changed {
                section.raw_stream = None;
            }
        }
        let report = serde_json::json!({"ok":true,"styleId":style_id,"paragraphsUpdated":propagation.report.paragraphs_updated});
        if !char_changed && !para_changed {
            return Ok(report.to_string());
        }
        candidate.doc_info.styles[style_id].raw_data = None;
        candidate.doc_info.raw_stream_dirty = true;
        let reflow = propagation.reflow;
        let new_char = propagation.new_char;
        let new_para = propagation.new_para;
        let old_char = propagation.old_char;
        self.document = candidate;
        self.rebuild_resolved_styles();
        for sec in 0..self.document.sections.len() {
            if reflow {
                for para in 0..self.document.sections[sec].paragraphs.len() {
                    let p = &self.document.sections[sec].paragraphs[para];
                    if p.style_id as usize == style_id
                        && (p.para_shape_id == new_para && old.para_shape_id != new_para
                            || p.char_shapes.iter().any(|r| r.char_shape_id == new_char)
                                && old_char != new_char)
                    {
                        self.reflow_body_paragraph(sec, para);
                    }
                }
            }
            self.rebuild_section(sec);
        }
        self.invalidate_page_tree_cache();
        Ok(report.to_string())
    }
}

//! First-level table cell equations. Explicit cell + inner control addresses
//! keep multiple equations distinct; textbox/nested paths remain unsupported.
use crate::document_core::DocumentCore;
use crate::error::HwpError;
use crate::model::event::DocumentEvent;
use crate::model::shape::{CommonObjAttr, HorzRelTo, ShapeObject, TextWrap, VertRelTo};
use crate::model::{
    control::{Control, Equation},
    paragraph::Paragraph,
};
use std::collections::HashSet;

impl DocumentCore {
    pub(crate) fn next_equation_instance_id(&self) -> Result<u32, HwpError> {
        fn paragraphs(
            ps: &[Paragraph],
            used: &mut HashSet<u32>,
            depth: usize,
        ) -> Result<(), HwpError> {
            if depth > 64 {
                return Err(HwpError::RenderError(
                    "수식 ID를 안전하게 확인할 수 없는 중첩 문서입니다.".into(),
                ));
            }
            for p in ps {
                for c in &p.controls {
                    match c {
                        Control::Equation(e) => {
                            used.insert(e.common.instance_id);
                        }
                        Control::Table(t) => {
                            for c in &t.cells {
                                paragraphs(&c.paragraphs, used, depth + 1)?;
                            }
                            if let Some(c) = &t.caption {
                                paragraphs(&c.paragraphs, used, depth + 1)?;
                            }
                        }
                        Control::SectionDef(s) => {
                            for m in &s.master_pages {
                                paragraphs(&m.paragraphs, used, depth + 1)?;
                            }
                        }
                        Control::Header(h) => paragraphs(&h.paragraphs, used, depth + 1)?,
                        Control::Footer(h) => paragraphs(&h.paragraphs, used, depth + 1)?,
                        Control::Footnote(h) => paragraphs(&h.paragraphs, used, depth + 1)?,
                        Control::Endnote(h) => paragraphs(&h.paragraphs, used, depth + 1)?,
                        Control::HiddenComment(h) => paragraphs(&h.paragraphs, used, depth + 1)?,
                        Control::Field(f) => paragraphs(&f.memo_paragraphs, used, depth + 1)?,
                        Control::Picture(p) => {
                            if let Some(c) = &p.caption {
                                paragraphs(&c.paragraphs, used, depth + 1)?;
                            }
                        }
                        Control::Shape(s) => shape(s, used, depth + 1)?,
                        _ => {}
                    }
                }
            }
            Ok(())
        }
        fn shape(s: &ShapeObject, used: &mut HashSet<u32>, depth: usize) -> Result<(), HwpError> {
            if depth > 64 {
                return Err(HwpError::RenderError(
                    "수식 ID를 안전하게 확인할 수 없는 중첩 문서입니다.".into(),
                ));
            }
            if let Some(d) = s.drawing() {
                if let Some(t) = &d.text_box {
                    paragraphs(&t.paragraphs, used, depth + 1)?;
                }
                if let Some(c) = &d.caption {
                    paragraphs(&c.paragraphs, used, depth + 1)?;
                }
            }
            match s {
                ShapeObject::Group(g) => {
                    for s in &g.children {
                        shape(s, used, depth + 1)?;
                    }
                    if let Some(c) = &g.caption {
                        paragraphs(&c.paragraphs, used, depth + 1)?;
                    }
                }
                ShapeObject::Picture(p) => {
                    if let Some(c) = &p.caption {
                        paragraphs(&c.paragraphs, used, depth + 1)?;
                    }
                }
                ShapeObject::Chart(p) => {
                    if let Some(c) = &p.caption {
                        paragraphs(&c.paragraphs, used, depth + 1)?;
                    }
                }
                ShapeObject::Ole(p) => {
                    if let Some(c) = &p.caption {
                        paragraphs(&c.paragraphs, used, depth + 1)?;
                    }
                }
                _ => {}
            }
            Ok(())
        }
        let mut used = HashSet::new();
        for s in &self.document.sections {
            paragraphs(&s.paragraphs, &mut used, 0)?;
            for m in &s.section_def.master_pages {
                paragraphs(&m.paragraphs, &mut used, 0)?;
            }
        }
        for seq in 1..=0x03ff_ffff {
            let id = 0x4400_0000 | seq;
            if !used.contains(&id) {
                return Ok(id);
            }
        }
        Err(HwpError::RenderError(
            "수식 instance ID를 더 이상 배정할 수 없습니다.".into(),
        ))
    }

    fn equation_cell_paragraph(
        &self,
        sec: usize,
        parent: usize,
        table: usize,
        cell: usize,
        para: usize,
    ) -> Result<&Paragraph, HwpError> {
        let s = self
            .document
            .sections
            .get(sec)
            .ok_or_else(|| HwpError::RenderError("구역 인덱스 범위 초과".into()))?;
        let p = s
            .paragraphs
            .get(parent)
            .ok_or_else(|| HwpError::RenderError("문단 인덱스 범위 초과".into()))?;
        let t = match p.controls.get(table) {
            Some(Control::Table(t)) => t,
            _ => return Err(HwpError::RenderError("일반 표 셀만 지원합니다.".into())),
        };
        t.cells
            .get(cell)
            .and_then(|c| c.paragraphs.get(para))
            .ok_or_else(|| HwpError::RenderError("셀 또는 셀 문단 인덱스 범위 초과".into()))
    }

    // Validate an exact PARA_TEXT stream before changing any coordinates.
    // Only text + equations are widened here; other objects/fields remain guarded.
    fn cell_equation_stream(p: &Paragraph) -> Result<Vec<u32>, HwpError> {
        let error = || {
            HwpError::RenderError(
                "이 셀 문단의 문자·개체 범위를 안전하게 편집할 수 없습니다.".into(),
            )
        };
        if p.char_offsets.len() != p.text.chars().count()
            || p.controls
                .iter()
                .any(|c| !matches!(c,Control::Equation(e) if e.common.treat_as_char))
            || !p.field_ranges.is_empty()
            || !p.orphan_field_ends.is_empty()
            || !p.title_marks.is_empty()
            || !p.range_tags.is_empty()
            || p.text
                .chars()
                .any(|c| (c.is_control() && c != '\t') || c == '\u{fffc}')
        {
            return Err(error());
        }
        let mut starts = Vec::with_capacity(p.controls.len());
        let mut end = 0u32;
        for (ch, &offset) in p.text.chars().zip(&p.char_offsets) {
            let gap = offset.checked_sub(end).ok_or_else(error)?;
            if gap % 8 != 0 || (gap / 8) as usize > p.controls.len() - starts.len() {
                return Err(error());
            }
            for _ in 0..gap / 8 {
                starts.push(end);
                end = end.checked_add(8).ok_or_else(error)?;
            }
            end = offset
                .checked_add(if ch == '\t' { 8 } else { ch.len_utf16() as u32 })
                .ok_or_else(error)?;
        }
        while starts.len() < p.controls.len() {
            starts.push(end);
            end = end.checked_add(8).ok_or_else(error)?;
        }
        if end.checked_add(1) != Some(p.char_count) {
            return Err(error());
        }
        if p.line_segs
            .iter()
            .any(|v| v.text_start > p.char_count || v.text_start.checked_add(8).is_none())
        {
            return Err(error());
        }
        if p.char_shapes.iter().any(|s| s.start_pos >= p.char_count)
            || p.char_shapes
                .windows(2)
                .any(|s| s[0].start_pos > s[1].start_pos)
        {
            return Err(error());
        }
        Ok(starts)
    }

    fn finish_cell_equation_edit(
        &mut self,
        sec: usize,
        parent: usize,
        table: usize,
        cell: usize,
        para: usize,
    ) {
        self.mark_cell_control_dirty(sec, parent, table);
        self.document.sections[sec].raw_stream = None;
        self.reflow_cell_paragraph(sec, parent, table, cell, para);
        self.recompose_section(sec);
        self.paginate_if_needed();
        self.invalidate_page_tree_cache();
    }

    #[allow(clippy::too_many_arguments)]
    pub fn insert_equation_in_cell_native(
        &mut self,
        sec: usize,
        parent: usize,
        table: usize,
        cell: usize,
        para: usize,
        offset: usize,
        script: &str,
        font_size: u32,
        color: u32,
    ) -> Result<String, HwpError> {
        let p = self.equation_cell_paragraph(sec, parent, table, cell, para)?;
        let starts = Self::cell_equation_stream(p)?;
        if offset > crate::document_core::helpers::logical_paragraph_length(p)
            || font_size == 0
            || font_size > 409600
            || script.encode_utf16().count() > 8000
        {
            return Err(HwpError::RenderError(
                "수식 삽입 위치·크기·스크립트 범위가 올바르지 않습니다.".into(),
            ));
        }
        let (text_offset, _) = crate::document_core::helpers::logical_to_text_offset(p, offset);
        let logical = p.logical_control_positions();
        let index = logical
            .iter()
            .position(|&pos| pos >= offset)
            .unwrap_or(p.controls.len());
        let raw = if logical.get(index) == Some(&offset) {
            starts[index]
        } else {
            p.char_offsets
                .get(text_offset)
                .copied()
                .unwrap_or_else(|| p.char_count - 1)
        };
        if p.char_count.checked_add(8).is_none()
            || p.char_offsets.iter().any(|&v| v.checked_add(8).is_none())
            || p.char_shapes
                .iter()
                .any(|v| v.start_pos.checked_add(8).is_none())
        {
            return Err(HwpError::RenderError(
                "셀 문자 좌표가 범위를 벗어났습니다.".into(),
            ));
        }
        let (width, height) = crate::renderer::equation::intrinsic_size_hwp(script, font_size);
        let equation = Equation {
            common: CommonObjAttr {
                ctrl_id: crate::parser::tags::CTRL_EQUATION,
                attr: 0x0C2A_2311,
                treat_as_char: true,
                width,
                height,
                z_order: p.controls.len() as i32,
                margin: crate::model::Padding {
                    left: 56,
                    right: 56,
                    top: 0,
                    bottom: 0,
                },
                instance_id: self.next_equation_instance_id()?,
                flow_with_text: true,
                vert_rel_to: VertRelTo::Para,
                horz_rel_to: HorzRelTo::Para,
                text_wrap: TextWrap::TopAndBottom,
                hwp5_gen_shape_attr_bit26: true,
                description: "수식입니다.".into(),
                ..Default::default()
            },
            script: script.into(),
            font_size,
            color,
            baseline: 85,
            version_info: "Equation Version 60".into(),
            font_name: "HYhwpEQ".into(),
            ..Default::default()
        };
        let p = Self::resolve_cell_paragraph_mut(
            &mut self.document.sections[sec],
            parent,
            &[(table, cell, para)],
        )?;
        p.align_ctrl_data_records();
        p.controls
            .insert(index, Control::Equation(Box::new(equation)));
        p.ctrl_data_records.insert(index, None);
        for v in &mut p.char_offsets {
            if *v >= raw {
                *v += 8;
            }
        }
        for v in &mut p.char_shapes {
            if v.start_pos >= raw && v.start_pos > 0 {
                v.start_pos += 8;
            }
        }
        for v in &mut p.line_segs {
            if v.text_start >= raw && v.text_start > 0 {
                v.text_start += 8;
            }
        }
        p.char_count += 8;
        p.control_mask |= 1 << 11;
        p.has_para_text = true;
        p.invalidate_layout_inputs();
        self.finish_cell_equation_edit(sec, parent, table, cell, para);
        self.event_log.push(DocumentEvent::PictureInserted {
            section: sec,
            para: parent,
        });
        Ok(format!(
            "{{\"ok\":true,\"controlIdx\":{index},\"charOffset\":{}}}",
            offset + 1
        ))
    }

    pub fn get_equation_properties_in_cell_native(
        &self,
        sec: usize,
        parent: usize,
        table: usize,
        cell: usize,
        para: usize,
        eq: usize,
    ) -> Result<String, HwpError> {
        match self
            .equation_cell_paragraph(sec, parent, table, cell, para)?
            .controls
            .get(eq)
        {
            Some(Control::Equation(e)) => Ok(Self::equation_properties_json(e)),
            _ => Err(HwpError::RenderError(
                "대상 셀 컨트롤이 수식이 아닙니다.".into(),
            )),
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub fn set_equation_properties_in_cell_native(
        &mut self,
        sec: usize,
        parent: usize,
        table: usize,
        cell: usize,
        para: usize,
        eq: usize,
        props: &str,
    ) -> Result<String, HwpError> {
        let original = match &self
            .equation_cell_paragraph(sec, parent, table, cell, para)?
            .controls
            .get(eq)
        {
            Some(Control::Equation(e)) if e.common.treat_as_char => e.as_ref(),
            _ => {
                return Err(HwpError::RenderError(
                    "일반 셀의 인라인 수식만 편집할 수 있습니다.".into(),
                ))
            }
        };
        // Validate before the legacy property applier can change the object.
        let value: serde_json::Value = serde_json::from_str(props)
            .map_err(|_| HwpError::RenderError("수식 속성 JSON이 올바르지 않습니다.".into()))?;
        if !value.is_object()
            || value.get("script").map_or(false, |v| {
                v.as_str().map_or(true, |s| s.encode_utf16().count() > 8000)
            })
            || value
                .get("fontSize")
                .map_or(false, |v| v.as_u64().map_or(true, |n| n == 0 || n > 409600))
            || value
                .get("treatAsChar")
                .map_or(false, |v| v != &serde_json::Value::Bool(true))
            || ["width", "height", "color"].iter().any(|key| {
                value
                    .get(key)
                    .map_or(false, |v| v.as_u64().map_or(true, |n| n > i32::MAX as u64))
            })
            || value.get("baseline").map_or(false, |v| {
                v.as_i64()
                    .map_or(true, |n| n < i16::MIN as i64 || n > i16::MAX as i64)
            })
            || value.get("fontName").map_or(false, |v| {
                v.as_str().map_or(true, |n| n.encode_utf16().count() > 1000)
            })
        {
            return Err(HwpError::RenderError(
                "셀 수식 속성 범위가 올바르지 않습니다.".into(),
            ));
        }
        let mut updated = original.clone();
        Self::apply_equation_properties(&mut updated, self.dpi, props);
        if !updated.common.treat_as_char
            || updated.common.width > i32::MAX as u32
            || updated.common.height > i32::MAX as u32
        {
            return Err(HwpError::RenderError(
                "셀 수식 크기·배치 범위가 올바르지 않습니다.".into(),
            ));
        }
        let p = Self::resolve_cell_paragraph_mut(
            &mut self.document.sections[sec],
            parent,
            &[(table, cell, para)],
        )?;
        if let Control::Equation(e) = &mut p.controls[eq] {
            **e = updated;
        }
        p.invalidate_layout_inputs();
        self.finish_cell_equation_edit(sec, parent, table, cell, para);
        Ok("{\"ok\":true}".into())
    }

    pub fn delete_equation_control_in_cell_native(
        &mut self,
        sec: usize,
        parent: usize,
        table: usize,
        cell: usize,
        para: usize,
        eq: usize,
    ) -> Result<String, HwpError> {
        self.get_equation_properties_in_cell_native(sec, parent, table, cell, para, eq)?;
        let starts = Self::cell_equation_stream(
            self.equation_cell_paragraph(sec, parent, table, cell, para)?,
        )?;
        let start = starts[eq];
        let end = start + 8;
        let p = Self::resolve_cell_paragraph_mut(
            &mut self.document.sections[sec],
            parent,
            &[(table, cell, para)],
        )?;
        p.align_ctrl_data_records();
        p.controls.remove(eq);
        p.ctrl_data_records.remove(eq);
        for v in &mut p.char_offsets {
            if *v >= end {
                *v -= 8;
            }
        }
        for v in &mut p.char_shapes {
            if v.start_pos >= start {
                v.start_pos = if v.start_pos >= end {
                    v.start_pos - 8
                } else {
                    start
                };
            }
        }
        for v in &mut p.line_segs {
            if v.text_start >= start {
                v.text_start = if v.text_start >= end {
                    v.text_start - 8
                } else {
                    start
                };
            }
        }
        p.char_count -= 8;
        p.invalidate_layout_inputs();
        self.finish_cell_equation_edit(sec, parent, table, cell, para);
        self.event_log.push(DocumentEvent::PictureDeleted {
            section: sec,
            ctrl: eq,
            para: parent,
        });
        Ok("{\"ok\":true}".into())
    }
}

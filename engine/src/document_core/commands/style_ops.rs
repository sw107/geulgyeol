//! Remove a style without leaving stale indices in nested document scopes.
use crate::{
    document_core::DocumentCore,
    error::HwpError,
    model::{control::Control, document::Document, paragraph::Paragraph, shape::ShapeObject},
};
#[derive(Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct StyleDeletionReport {
    paragraphs_reassigned: usize,
    paragraphs_reindexed: usize,
    ruby_references_reindexed: usize,
    next_styles_adjusted: usize,
}
struct Remap {
    deleted: usize,
    count: usize,
    report: StyleDeletionReport,
}
impl Remap {
    fn error(message: &str) -> HwpError {
        HwpError::RenderError(message.into())
    }
    fn paragraphs(&mut self, ps: &mut [Paragraph], depth: usize) -> Result<bool, HwpError> {
        if depth > 64 {
            return Err(Self::error(
                "과도한 중첩 문서의 스타일은 안전하게 삭제할 수 없습니다.",
            ));
        }
        let mut changed = false;
        for p in ps {
            let old = p.style_id as usize;
            if old >= self.count {
                return Err(Self::error(
                    "문단에 잘못된 스타일 참조가 있어 삭제하지 않았습니다.",
                ));
            }
            if old == self.deleted {
                p.style_id = 0;
                self.report.paragraphs_reassigned += 1;
                changed = true;
            } else if old > self.deleted {
                p.style_id -= 1;
                self.report.paragraphs_reindexed += 1;
                changed = true;
            }
            for c in &mut p.controls {
                changed |= self.control(c, depth + 1)?;
            }
        }
        Ok(changed)
    }
    fn shape(&mut self, s: &mut ShapeObject, depth: usize) -> Result<bool, HwpError> {
        if depth > 64 {
            return Err(Self::error(
                "과도한 중첩 도형의 스타일은 안전하게 삭제할 수 없습니다.",
            ));
        }
        let mut changed = false;
        if let Some(d) = s.drawing_mut() {
            if let Some(t) = &mut d.text_box {
                changed |= self.paragraphs(&mut t.paragraphs, depth + 1)?;
            }
            if let Some(c) = &mut d.caption {
                changed |= self.paragraphs(&mut c.paragraphs, depth + 1)?;
            }
        }
        match s {
            ShapeObject::Group(g) => {
                for s in &mut g.children {
                    changed |= self.shape(s, depth + 1)?;
                }
                if let Some(c) = &mut g.caption {
                    changed |= self.paragraphs(&mut c.paragraphs, depth + 1)?;
                }
            }
            ShapeObject::Picture(p) => {
                if let Some(c) = &mut p.caption {
                    changed |= self.paragraphs(&mut c.paragraphs, depth + 1)?;
                }
            }
            ShapeObject::Chart(p) => {
                if let Some(c) = &mut p.caption {
                    changed |= self.paragraphs(&mut c.paragraphs, depth + 1)?;
                }
            }
            ShapeObject::Ole(p) => {
                if let Some(c) = &mut p.caption {
                    changed |= self.paragraphs(&mut c.paragraphs, depth + 1)?;
                }
            }
            _ => {}
        }
        Ok(changed)
    }
    fn control(&mut self, c: &mut Control, depth: usize) -> Result<bool, HwpError> {
        match c {
            Control::Table(t) => {
                let mut changed = false;
                for c in &mut t.cells {
                    changed |= self.paragraphs(&mut c.paragraphs, depth)?;
                }
                if let Some(c) = &mut t.caption {
                    changed |= self.paragraphs(&mut c.paragraphs, depth)?;
                }
                if changed {
                    t.dirty = true;
                }
                Ok(changed)
            }
            Control::Shape(s) => self.shape(s, depth),
            Control::Picture(p) => {
                if let Some(c) = &mut p.caption {
                    self.paragraphs(&mut c.paragraphs, depth)
                } else {
                    Ok(false)
                }
            }
            Control::Header(h) => self.paragraphs(&mut h.paragraphs, depth),
            Control::Footer(h) => self.paragraphs(&mut h.paragraphs, depth),
            Control::Footnote(h) => self.paragraphs(&mut h.paragraphs, depth),
            Control::Endnote(h) => self.paragraphs(&mut h.paragraphs, depth),
            Control::HiddenComment(h) => self.paragraphs(&mut h.paragraphs, depth),
            Control::Field(h) => self.paragraphs(&mut h.memo_paragraphs, depth),
            Control::SectionDef(s) => {
                if !s.master_pages.is_empty() {
                    return Err(Self::error(
                        "바탕쪽이 포함된 문서의 스타일 삭제는 아직 지원하지 않습니다.",
                    ));
                }
                if s.extra_child_records
                    .iter()
                    .any(|r| r.tag_id == crate::parser::tags::HWPTAG_PARA_HEADER)
                {
                    return Err(Self::error(
                        "모델링되지 않은 문단의 스타일 참조가 있어 삭제하지 않았습니다.",
                    ));
                }
                let mut changed = false;
                for m in &mut s.master_pages {
                    changed |= self.paragraphs(&mut m.paragraphs, depth)?;
                }
                Ok(changed)
            }
            Control::Ruby(r) => {
                let old = r.style_id_ref as usize;
                if old >= self.count {
                    return Err(Self::error(
                        "덧말에 잘못된 스타일 참조가 있어 삭제하지 않았습니다.",
                    ));
                }
                if old == self.deleted {
                    return Err(Self::error(
                        "덧말이 이 스타일을 사용 중입니다. 덧말 스타일을 변경한 뒤 삭제하세요.",
                    ));
                }
                if old > self.deleted {
                    r.style_id_ref -= 1;
                    self.report.ruby_references_reindexed += 1;
                    Ok(true)
                } else {
                    Ok(false)
                }
            }
            Control::Unknown(_) => Err(Self::error(
                "알 수 없는 개체가 있어 스타일 참조를 안전하게 바꿀 수 없습니다.",
            )),
            _ => Ok(false),
        }
    }
    fn document(&mut self, d: &mut Document) -> Result<(), HwpError> {
        for s in &mut d.sections {
            if !s.section_def.master_pages.is_empty() {
                return Err(Self::error(
                    "바탕쪽이 포함된 문서의 스타일 삭제는 아직 지원하지 않습니다.",
                ));
            }
            if s.section_def
                .extra_child_records
                .iter()
                .any(|r| r.tag_id == crate::parser::tags::HWPTAG_PARA_HEADER)
            {
                return Err(Self::error(
                    "모델링되지 않은 문단의 스타일 참조가 있어 삭제하지 않았습니다.",
                ));
            }
            self.paragraphs(&mut s.paragraphs, 0)?;
            for m in &mut s.section_def.master_pages {
                self.paragraphs(&mut m.paragraphs, 0)?;
            }
            s.raw_stream = None;
        }
        for (i, s) in d.doc_info.styles.iter_mut().enumerate() {
            if i == self.deleted {
                continue;
            }
            let old = s.next_style_id as usize;
            if old == self.deleted {
                s.next_style_id = 0;
            } else if old > self.deleted {
                s.next_style_id -= 1;
            } else {
                continue;
            }
            s.raw_data = None; // Raw STYLE records must not restore old next IDs.
            self.report.next_styles_adjusted += 1;
        }
        d.doc_info.styles.remove(self.deleted);
        d.doc_info.raw_stream_dirty = true;
        Ok(())
    }
}
impl DocumentCore {
    pub fn delete_style_preserving_format_native(
        &mut self,
        style_id: usize,
    ) -> Result<String, HwpError> {
        if self
            .document
            .doc_info
            .extra_records
            .iter()
            .any(|r| r.tag_id == crate::parser::tags::HWPTAG_STYLE)
        {
            return Err(Remap::error(
                "모델링되지 않은 스타일 레코드가 있어 삭제하지 않았습니다.",
            ));
        }
        let styles = &self.document.doc_info.styles;
        if style_id == 0 || style_id >= styles.len() || styles.len() > 256 {
            return Err(Remap::error(
                "바탕글 또는 범위를 벗어난 스타일은 삭제할 수 없습니다.",
            ));
        }
        if styles.iter().any(|s| {
            s.style_type > 1
                || s.next_style_id as usize >= styles.len()
                || s.char_shape_id as usize >= self.document.doc_info.char_shapes.len()
                || s.para_shape_id as usize >= self.document.doc_info.para_shapes.len()
        }) {
            return Err(Remap::error(
                "스타일 정의에 잘못된 참조가 있어 삭제하지 않았습니다.",
            ));
        }
        let mut remap = Remap {
            deleted: style_id,
            count: styles.len(),
            report: StyleDeletionReport::default(),
        };
        let mut candidate = self.document.clone();
        remap.document(&mut candidate)?;
        // All fallible validation finished on the candidate; commit once.
        self.document = candidate;
        self.rebuild_resolved_styles();
        for i in 0..self.document.sections.len() {
            self.rebuild_section(i);
        }
        self.invalidate_page_tree_cache();
        let mut report = serde_json::to_value(&remap.report).unwrap();
        report["ok"] = serde_json::Value::Bool(true);
        report["deletedStyleId"] = serde_json::json!(style_id);
        report["fallbackStyleId"] = serde_json::json!(0);
        Ok(report.to_string())
    }
}

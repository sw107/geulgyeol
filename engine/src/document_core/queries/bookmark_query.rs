//! 책갈피 조회/조작 기능

use super::field_query::{rebuild_char_offsets_at_positions, validate_field_edit_axis};
use crate::document_core::helpers::find_control_text_positions;
use crate::document_core::DocumentCore;
use crate::error::HwpError;
use crate::model::control::{Bookmark, Control};
use crate::model::paragraph::Paragraph;
use serde_json::json;

/// 책갈피 정보
#[derive(Debug, Clone)]
struct BookmarkInfo {
    name: String,
    sec: usize,
    para: usize,
    ctrl_idx: usize,
    /// 텍스트 내 위치 (정렬용)
    char_pos: usize,
    nested: bool,
}

impl DocumentCore {
    /// 문서 내 모든 책갈피 목록을 JSON으로 반환
    pub fn get_bookmarks_native(&self) -> Result<String, HwpError> {
        let bookmarks = self.collect_bookmarks();
        Ok(serde_json::to_string(
            &bookmarks
                .iter()
                .map(|b| {
                    json!({
                        "name":b.name,"sec":b.sec,"para":b.para,"ctrlIdx":b.ctrl_idx,
                        "charPos":b.char_pos,"editable":!b.nested
                    })
                })
                .collect::<Vec<_>>(),
        )
        .unwrap())
    }

    /// Insert a bookmark at a visible Unicode scalar boundary in ordinary body text.
    /// Capture control anchors before mutation; char_offsets index TEXT, not controls.
    pub fn add_bookmark_native(
        &mut self,
        sec: usize,
        para: usize,
        char_offset: usize,
        name: &str,
    ) -> Result<String, HwpError> {
        let name = bookmark_name(name)?;
        if self.collect_bookmarks().iter().any(|b| b.name == name) {
            return Ok(
                r#"{"ok":false,"error":"같은 이름의 책갈피가 이미 등록되어 있습니다."}"#.into(),
            );
        }
        let original = self.bookmark_body_paragraph(sec, para)?;
        validate_field_edit_axis(original)?;
        if char_offset > original.text.chars().count() {
            return Err(HwpError::InvalidField(
                "책갈피 위치가 문단 범위를 벗어났습니다.".into(),
            ));
        }
        if original
            .field_ranges
            .iter()
            .any(|r| r.start_char_idx <= char_offset && char_offset <= r.end_char_idx)
            || !original.range_tags.is_empty()
        {
            return Err(HwpError::InvalidField(
                "필드/주석 경계 또는 범위 참조 안의 책갈피 추가는 지원하지 않습니다.".into(),
            ));
        }
        let mut staged = original.clone();
        let mut positions = staged.control_text_positions();
        let ci = positions
            .iter()
            .position(|&at| at > char_offset)
            .unwrap_or(positions.len());
        staged.align_ctrl_data_records();
        staged
            .controls
            .insert(ci, Control::Bookmark(Bookmark { name: name.into() }));
        staged
            .ctrl_data_records
            .insert(ci, Some(build_bookmark_ctrl_data(name)));
        for r in &mut staged.field_ranges {
            if r.control_idx >= ci {
                r.control_idx += 1;
            }
        }
        positions.insert(ci, char_offset);
        rebuild_char_offsets_at_positions(&mut staged, &positions);
        staged.control_mask |= 1u32 << 0x0016;
        validate_field_edit_axis(&staged)?;
        self.commit_bookmark_paragraph(sec, para, staged);
        Ok(r#"{"ok":true,"changed":true}"#.into())
    }

    pub fn delete_bookmark_native(
        &mut self,
        sec: usize,
        para: usize,
        ctrl_idx: usize,
    ) -> Result<String, HwpError> {
        let original = self.bookmark_body_paragraph(sec, para)?;
        validate_bookmark_owner(original, ctrl_idx)?;
        validate_field_edit_axis(original)?;
        let mut staged = original.clone();
        let mut positions = staged.control_text_positions();
        staged.controls.remove(ctrl_idx);
        if ctrl_idx < staged.ctrl_data_records.len() {
            staged.ctrl_data_records.remove(ctrl_idx);
        }
        for r in &mut staged.field_ranges {
            if r.control_idx > ctrl_idx {
                r.control_idx -= 1;
            }
        }
        positions.remove(ctrl_idx);
        rebuild_char_offsets_at_positions(&mut staged, &positions);
        if !staged
            .controls
            .iter()
            .any(|c| matches!(c, Control::Bookmark(_) | Control::IndexMark(_)))
        {
            staged.control_mask &= !(1u32 << 0x0016);
        }
        validate_field_edit_axis(&staged)?;
        self.commit_bookmark_paragraph(sec, para, staged);
        Ok(r#"{"ok":true,"changed":true}"#.into())
    }

    pub fn rename_bookmark_native(
        &mut self,
        sec: usize,
        para: usize,
        ctrl_idx: usize,
        new_name: &str,
    ) -> Result<String, HwpError> {
        let name = bookmark_name(new_name)?;
        let original = self.bookmark_body_paragraph(sec, para)?;
        let old_name = validate_bookmark_owner(original, ctrl_idx)?;
        if name == old_name {
            return Ok(r#"{"ok":true,"changed":false}"#.into());
        }
        if self.collect_bookmarks().iter().any(|b| {
            b.name == name && (b.nested || b.sec != sec || b.para != para || b.ctrl_idx != ctrl_idx)
        }) {
            return Ok(
                r#"{"ok":false,"error":"같은 이름의 책갈피가 이미 등록되어 있습니다."}"#.into(),
            );
        }
        validate_field_edit_axis(original)?;
        let mut staged = original.clone();
        let Control::Bookmark(bm) = &mut staged.controls[ctrl_idx] else {
            unreachable!()
        };
        bm.name = name.into();
        staged.align_ctrl_data_records();
        staged.ctrl_data_records[ctrl_idx] = Some(build_bookmark_ctrl_data(name));
        self.commit_bookmark_paragraph(sec, para, staged);
        Ok(r#"{"ok":true,"changed":true}"#.into())
    }

    /// Text edits in bookmark paragraphs need the same complete, owned coordinate axis.
    pub(crate) fn validate_body_bookmark_text_axis(para: &Paragraph) -> Result<bool, HwpError> {
        let bookmarks = para
            .controls
            .iter()
            .enumerate()
            .filter(|(_, c)| matches!(c, Control::Bookmark(_)));
        let mut found = false;
        for (ci, _) in bookmarks {
            found = true;
            validate_bookmark_owner(para, ci)?;
        }
        if found {
            validate_field_edit_axis(para)?;
        }
        Ok(found)
    }

    pub(crate) fn reject_body_bookmark_structure_edit(
        paras: &[&Paragraph],
    ) -> Result<(), HwpError> {
        if paras
            .iter()
            .any(|p| p.controls.iter().any(|c| matches!(c, Control::Bookmark(_))))
        {
            return Err(HwpError::InvalidField(
                "책갈피가 있는 문단의 분할·병합·문단 간 삭제는 아직 지원하지 않습니다.".into(),
            ));
        }
        Ok(())
    }

    fn bookmark_body_paragraph(&self, sec: usize, para: usize) -> Result<&Paragraph, HwpError> {
        self.document
            .sections
            .get(sec)
            .and_then(|s| s.paragraphs.get(para))
            .ok_or_else(|| HwpError::InvalidField("책갈피 본문 문단을 찾을 수 없습니다.".into()))
    }

    fn commit_bookmark_paragraph(&mut self, sec: usize, para: usize, staged: Paragraph) {
        self.document.sections[sec].paragraphs[para] = staged;
        self.document.sections[sec].raw_stream = None;
        self.recompose_section(sec);
        // Control indices also own paginated footnotes. Rebuild their references now.
        self.paginate_if_needed();
    }

    /// 내부: 모든 책갈피 수집 (중첩 구조 포함)
    fn collect_bookmarks(&self) -> Vec<BookmarkInfo> {
        let mut result = vec![];
        for (sec_idx, section) in self.document.sections.iter().enumerate() {
            collect_bookmarks_from_paragraphs(&section.paragraphs, sec_idx, None, &mut result);
            for master in &section.section_def.master_pages {
                collect_bookmarks_from_paragraphs(
                    &master.paragraphs,
                    sec_idx,
                    Some(0),
                    &mut result,
                );
            }
        }
        result
    }
}

/// 문단 목록에서 책갈피를 재귀적으로 수집 (표 셀, 글상자 등 중첩 구조 포함)
///
/// `host_para`: 중첩 구조의 경우 소속 최상위 문단 인덱스. None이면 최상위 레벨.
fn collect_bookmarks_from_paragraphs(
    paragraphs: &[crate::model::paragraph::Paragraph],
    sec: usize,
    host_para: Option<usize>,
    result: &mut Vec<BookmarkInfo>,
) {
    for (para_idx, para) in paragraphs.iter().enumerate() {
        // 최상위 레벨이면 para_idx 사용, 중첩이면 호스트 문단 인덱스 유지
        let effective_para = host_para.unwrap_or(para_idx);
        let positions = find_control_text_positions(para);
        for (ctrl_idx, ctrl) in para.controls.iter().enumerate() {
            match ctrl {
                Control::Bookmark(bm) => {
                    let char_pos = if host_para.is_some() {
                        // 중첩 구조 내 책갈피: 호스트 문단 시작점으로 이동
                        0
                    } else {
                        positions.get(ctrl_idx).copied().unwrap_or(0)
                    };
                    result.push(BookmarkInfo {
                        name: bm.name.clone(),
                        sec,
                        para: effective_para,
                        ctrl_idx,
                        char_pos,
                        nested: host_para.is_some(),
                    });
                }
                Control::Table(t) => {
                    for cell in &t.cells {
                        collect_bookmarks_from_paragraphs(
                            &cell.paragraphs,
                            sec,
                            Some(effective_para),
                            result,
                        );
                    }
                    if let Some(c) = &t.caption {
                        collect_bookmarks_from_paragraphs(
                            &c.paragraphs,
                            sec,
                            Some(effective_para),
                            result,
                        );
                    }
                }
                Control::Shape(shape) => {
                    collect_bookmarks_from_shape(shape, sec, effective_para, result)
                }
                Control::Picture(p) => {
                    if let Some(c) = &p.caption {
                        collect_bookmarks_from_paragraphs(
                            &c.paragraphs,
                            sec,
                            Some(effective_para),
                            result,
                        );
                    }
                }
                Control::Field(f) => collect_bookmarks_from_paragraphs(
                    &f.memo_paragraphs,
                    sec,
                    Some(effective_para),
                    result,
                ),
                Control::Header(h) => {
                    collect_bookmarks_from_paragraphs(
                        &h.paragraphs,
                        sec,
                        Some(effective_para),
                        result,
                    );
                }
                Control::Footer(f) => {
                    collect_bookmarks_from_paragraphs(
                        &f.paragraphs,
                        sec,
                        Some(effective_para),
                        result,
                    );
                }
                Control::Footnote(n) => {
                    collect_bookmarks_from_paragraphs(
                        &n.paragraphs,
                        sec,
                        Some(effective_para),
                        result,
                    );
                }
                Control::Endnote(n) => {
                    collect_bookmarks_from_paragraphs(
                        &n.paragraphs,
                        sec,
                        Some(effective_para),
                        result,
                    );
                }
                Control::HiddenComment(hc) => {
                    collect_bookmarks_from_paragraphs(
                        &hc.paragraphs,
                        sec,
                        Some(effective_para),
                        result,
                    );
                }
                _ => {}
            }
        }
    }
}

fn collect_bookmarks_from_shape(
    shape: &crate::model::shape::ShapeObject,
    sec: usize,
    host: usize,
    result: &mut Vec<BookmarkInfo>,
) {
    if let Some(drawing) = shape.drawing() {
        if let Some(textbox) = &drawing.text_box {
            collect_bookmarks_from_paragraphs(&textbox.paragraphs, sec, Some(host), result);
        }
    }
    if let Some(caption) = crate::document_core::helpers::get_caption_from_shape(shape) {
        collect_bookmarks_from_paragraphs(&caption.paragraphs, sec, Some(host), result);
    }
    if let crate::model::shape::ShapeObject::Group(group) = shape {
        for child in &group.children {
            collect_bookmarks_from_shape(child, sec, host, result);
        }
    }
}

fn bookmark_name(name: &str) -> Result<&str, HwpError> {
    if name.encode_utf16().count() > 250 || name.chars().any(char::is_control) {
        return Err(HwpError::InvalidField(
            "책갈피 이름은 제어 문자 없는 최대250 UTF-16자로 입력하세요.".into(),
        ));
    }
    let name = name.trim();
    if name.is_empty()
        || name.encode_utf16().count() > 250
        || name
            .chars()
            .any(|c| c.is_control() || matches!(c, '\u{fffe}' | '\u{ffff}'))
    {
        return Err(HwpError::InvalidField(
            "책갈피 이름은 제어 문자 없는 1~250 UTF-16자로 입력하세요.".into(),
        ));
    }
    Ok(name)
}

fn validate_bookmark_owner(para: &Paragraph, ci: usize) -> Result<&str, HwpError> {
    let Some(Control::Bookmark(bm)) = para.controls.get(ci) else {
        return Err(HwpError::InvalidField(
            "지정한 본문 컨트롤이 책갈피가 아닙니다.".into(),
        ));
    };
    // Unrecognized CTRL_DATA is retained rather than silently overwritten/dropped.
    if para
        .ctrl_data_records
        .get(ci)
        .and_then(Option::as_ref)
        .is_some_and(|data| *data != build_bookmark_ctrl_data(&bm.name))
    {
        return Err(HwpError::InvalidField(
            "알 수 없는 책갈피 참조 데이터는 편집하지 않습니다.".into(),
        ));
    }
    Ok(&bm.name)
}

/// 책갈피 CTRL_DATA 바이너리 생성 (ParameterSet 형식)
///
/// 구조: ps_id(2) + count(2) + dummy(2) + item_id(2) + item_type(2) + name_len(2) + name(UTF-16LE)
fn build_bookmark_ctrl_data(name: &str) -> Vec<u8> {
    let utf16: Vec<u16> = name.encode_utf16().collect();
    let mut data = Vec::with_capacity(12 + utf16.len() * 2);
    data.extend_from_slice(&0x021Bu16.to_le_bytes()); // ps_id
    data.extend_from_slice(&1i16.to_le_bytes()); // count = 1
    data.extend_from_slice(&0u16.to_le_bytes()); // dummy
    data.extend_from_slice(&0x4000u16.to_le_bytes()); // item_id
    data.extend_from_slice(&1u16.to_le_bytes()); // item_type = String
    data.extend_from_slice(&(utf16.len() as u16).to_le_bytes()); // name_len
    for &ch in &utf16 {
        data.extend_from_slice(&ch.to_le_bytes());
    }
    data
}

#[cfg(test)]
mod tests {
    //! 책갈피 추가/삭제/이름변경의 raw_stream 무효화 회귀 테스트.
    //!
    //! serialize_section(serializer/body_text.rs)은 raw_stream 이 Some 이면 IR 을 무시하고
    //! 원본 바이트를 그대로 반환한다. HWP5 파서는 모든 섹션에 raw_stream 을 채우므로
    //! (parser/mod.rs), 세 뮤테이터가 raw_stream 을 비우지 않으면 — 책갈피 추가·삭제·
    //! 이름변경만 하고 저장하는 워크플로에서 — 편집이 저장 시 통째로 유실된다.
    //! recompose_section 은 화면만 갱신할 뿐 raw_stream 을 건드리지 않는다.
    //! 누름틀 set_field_value_*(field_query.rs)·양식 set_form_value_*(form_query.rs)는
    //! 같은 불변식을 이미 지킨다.

    use crate::document_core::DocumentCore;
    use crate::model::control::{Bookmark, Control};
    use crate::model::document::{Document, Section};
    use crate::model::paragraph::Paragraph;
    use crate::serializer::body_text::serialize_section;

    const SENTINEL: u8 = 0xAB;

    fn core_from(doc: Document) -> DocumentCore {
        let mut core = DocumentCore::new_empty();
        core.document = doc;
        core.composed = vec![Vec::new()];
        core.dirty_sections = vec![true];
        core.dirty_paragraphs = vec![None];
        core
    }

    /// 파싱된 문서를 흉내낸다 — 섹션이 원본 스트림 바이트를 물고 있는 상태.
    fn doc_with_raw_stream(paragraphs: Vec<Paragraph>) -> Document {
        let mut doc = Document::default();
        doc.sections.push(Section {
            paragraphs,
            raw_stream: Some(vec![SENTINEL; 64]),
            ..Default::default()
        });
        doc
    }

    fn text_para(text: &str) -> Paragraph {
        let mut p = Paragraph {
            text: text.to_string(),
            char_offsets: (0..text.chars().count() as u32).collect(),
            char_count: text.encode_utf16().count() as u32 + 1,
            ..Default::default()
        };
        p.has_para_text = true;
        p
    }

    fn para_with_bookmark(name: &str) -> Paragraph {
        let mut p = Paragraph::default();
        p.char_count = 9; // one extended bookmark slot and paragraph terminator
        p.controls.push(Control::Bookmark(Bookmark {
            name: name.to_string(),
        }));
        p
    }

    #[test]
    fn add_bookmark_invalidates_raw_stream() {
        let mut core = core_from(doc_with_raw_stream(vec![text_para("안녕하세요")]));
        let r = core
            .add_bookmark_native(0, 0, 2, "중간지점")
            .expect("호출 성공");
        assert!(r.contains(r#""ok":true"#), "전제: 책갈피 추가 성공 ({r})");

        assert!(
            core.document.sections[0].raw_stream.is_none(),
            "raw_stream 이 남으면 추가한 책갈피가 저장 시 사라진다"
        );
        let out = serialize_section(&core.document.sections[0]);
        assert_ne!(
            out,
            vec![SENTINEL; 64],
            "직렬화가 원본 바이트를 반환하면 유실"
        );
    }

    #[test]
    fn delete_bookmark_invalidates_raw_stream() {
        let mut core = core_from(doc_with_raw_stream(vec![para_with_bookmark("삭제대상")]));
        let r = core.delete_bookmark_native(0, 0, 0).expect("호출 성공");
        assert!(r.contains(r#""ok":true"#), "전제: 책갈피 삭제 성공 ({r})");

        assert!(
            core.document.sections[0].raw_stream.is_none(),
            "raw_stream 이 남으면 삭제한 책갈피가 저장 시 되살아난다"
        );
    }

    #[test]
    fn rename_bookmark_invalidates_raw_stream() {
        let mut core = core_from(doc_with_raw_stream(vec![para_with_bookmark("옛이름")]));
        let r = core
            .rename_bookmark_native(0, 0, 0, "새이름")
            .expect("호출 성공");
        assert!(r.contains(r#""ok":true"#), "전제: 이름 변경 성공 ({r})");

        // 이름은 IR 에 반영됐고,
        match &core.document.sections[0].paragraphs[0].controls[0] {
            Control::Bookmark(b) => assert_eq!(b.name, "새이름"),
            _ => panic!("책갈피여야 함"),
        }
        // raw_stream 은 무효화돼야 한다 — 남으면 저장 시 옛 이름으로 되돌아간다.
        assert!(
            core.document.sections[0].raw_stream.is_none(),
            "raw_stream 이 남으면 이름 변경이 저장 시 옛 이름으로 되돌아간다"
        );
    }
}

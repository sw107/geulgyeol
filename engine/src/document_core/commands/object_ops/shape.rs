//! 도형 생성/속성/그룹 native 명령 (object_ops 분할, #1904).

use super::MIN_SHAPE_SIZE;
use crate::document_core::helpers::get_textbox_from_shape;
use crate::document_core::DocumentCore;
use crate::error::HwpError;
use crate::model::control::Control;
use crate::model::event::DocumentEvent;
use crate::model::paragraph::Paragraph;
use crate::model::shape::{Caption, CaptionDirection, CaptionVertAlign, ShapeObject};

fn write_group_child_rendering(sa: &mut crate::model::shape::ShapeComponentAttr) {
// Hancom uses rotMatrix to turn the image pixels. Encoding a
// rotation inside scaMatrix alone preserves corners in our parser,
// but other readers retain the original pixel direction.
let (a,b,c,d) = (sa.render_sx,sa.render_b,sa.render_c,sa.render_sy);
let sx = a.hypot(c);
let sy = b.hypot(d);
let orthogonal = sx > 1e-9 && sy > 1e-9
    && (a*b+c*d).abs() <= 1e-6*(sx*sy).max(1.0);
let (scale,rotation) = if orthogonal {
    let signed_sy = if a*d-b*c < 0.0 { -sy } else { sy };
    ([sx,0.0,0.0,0.0,signed_sy,0.0],
     [a/sx,-c/sx,0.0,c/sx,a/sx,0.0])
} else {
    ([a,b,0.0,c,d,0.0],[1.0,0.0,0.0,0.0,1.0,0.0])
};
sa.raw_rendering = 1_u16.to_le_bytes().to_vec();
for matrix in [
    [1.0,0.0,sa.render_tx,0.0,1.0,sa.render_ty],
    scale,
    rotation,
] {
    for value in matrix { sa.raw_rendering.extend_from_slice(&value.to_le_bytes()); }
}
}

impl DocumentCore {
    /// Children store transforms in the top-level group coordinate system.
    /// Apply the change relative to the previous parent orientation, rather
    /// than replacing each child's own scale/rotation or applying twice.
    fn apply_group_orientation(group: &mut crate::model::shape::GroupShape, props: &str) {
        use crate::document_core::helpers::{json_bool, json_i32};
        let sa = &group.shape_attr;
        let angle = json_i32(props, "rotationAngle").map(|v| v as i16).unwrap_or(sa.rotation_angle);
        let hf = json_bool(props, "horzFlip").unwrap_or(sa.horz_flip);
        let vf = json_bool(props, "vertFlip").unwrap_or(sa.vert_flip);
        if (angle, hf, vf) == (sa.rotation_angle, sa.horz_flip, sa.vert_flip) { return; }
        fn orientation(angle: i16, hf: bool, vf: bool) -> [f64; 4] {
            let (s, c) = (angle as f64).to_radians().sin_cos();
            let x = if hf { -1.0 } else { 1.0 };
            let y = if vf { -1.0 } else { 1.0 };
            [c*x, -s*y, s*x, c*y]
        }
        let old = orientation(sa.rotation_angle, sa.horz_flip, sa.vert_flip);
        let new = orientation(angle, hf, vf);
        // Orthogonal inverse is the transpose.
        let delta = [new[0]*old[0]+new[1]*old[1], new[0]*old[2]+new[1]*old[3],
                     new[2]*old[0]+new[3]*old[1], new[2]*old[2]+new[3]*old[3]];
        let cx = group.common.width as f64 / 2.0;
        let cy = group.common.height as f64 / 2.0;
        fn update(shape: &mut ShapeObject, m: &[f64; 4], cx: f64, cy: f64) {
            let sa = shape.shape_attr_mut();
            let (a,b,c,d,tx,ty) = (sa.render_sx,sa.render_b,sa.render_c,sa.render_sy,sa.render_tx,sa.render_ty);
            sa.render_sx = m[0]*a+m[1]*c;
            sa.render_b = m[0]*b+m[1]*d;
            sa.render_c = m[2]*a+m[3]*c;
            sa.render_sy = m[2]*b+m[3]*d;
            sa.render_tx = cx + m[0]*(tx-cx)+m[1]*(ty-cy);
            sa.render_ty = cy + m[2]*(tx-cx)+m[3]*(ty-cy);
            write_group_child_rendering(sa);
            if let ShapeObject::Group(nested) = shape {
                for child in &mut nested.children { update(child,m,cx,cy); }
            }
        }
        for child in &mut group.children { update(child,&delta,cx,cy); }
        group.shape_attr.rotation_angle = angle;
        group.shape_attr.horz_flip = hf;
        group.shape_attr.vert_flip = vf;
        group.shape_attr.flip = (group.shape_attr.flip & !3) | u32::from(hf) | (u32::from(vf)<<1);
        // Child transforms already include this orientation. A parsed HWP may
        // still carry the previous container R; leaving it there prevents the
        // next resize from recognizing the current logical frame.
        group.shape_attr.render_sx = 1.0;
        group.shape_attr.render_b = 0.0;
        group.shape_attr.render_c = 0.0;
        group.shape_attr.render_sy = 1.0;
        group.shape_attr.render_tx = 0.0;
        group.shape_attr.render_ty = 0.0;
    }


    fn shape_caption_ref(shape: &ShapeObject) -> Option<&Caption> {
        match shape {
            ShapeObject::Line(s) => s.drawing.caption.as_ref(),
            ShapeObject::Rectangle(s) => s.drawing.caption.as_ref(),
            ShapeObject::Ellipse(s) => s.drawing.caption.as_ref(),
            ShapeObject::Arc(s) => s.drawing.caption.as_ref(),
            ShapeObject::Polygon(s) => s.drawing.caption.as_ref(),
            ShapeObject::Curve(s) => s.drawing.caption.as_ref(),
            ShapeObject::Group(s) => s.caption.as_ref(),
            ShapeObject::Picture(s) => s.caption.as_ref(),
            ShapeObject::Chart(s) => s.caption.as_ref(),
            ShapeObject::Ole(s) => s.caption.as_ref(),
        }
    }

    fn shape_caption_mut(shape: &mut ShapeObject) -> &mut Option<Caption> {
        match shape {
            ShapeObject::Line(s) => &mut s.drawing.caption,
            ShapeObject::Rectangle(s) => &mut s.drawing.caption,
            ShapeObject::Ellipse(s) => &mut s.drawing.caption,
            ShapeObject::Arc(s) => &mut s.drawing.caption,
            ShapeObject::Polygon(s) => &mut s.drawing.caption,
            ShapeObject::Curve(s) => &mut s.drawing.caption,
            ShapeObject::Group(s) => &mut s.caption,
            ShapeObject::Picture(s) => &mut s.caption,
            ShapeObject::Chart(s) => &mut s.caption,
            ShapeObject::Ole(s) => &mut s.caption,
        }
    }

    fn clear_shape_caption(shape: &mut ShapeObject) -> bool {
        let had_caption = Self::shape_caption_ref(shape).is_some()
            || shape
                .drawing()
                .is_some_and(|drawing| drawing.caption.is_some());
        match shape {
            ShapeObject::Line(s) => s.drawing.caption = None,
            ShapeObject::Rectangle(s) => s.drawing.caption = None,
            ShapeObject::Ellipse(s) => s.drawing.caption = None,
            ShapeObject::Arc(s) => s.drawing.caption = None,
            ShapeObject::Polygon(s) => s.drawing.caption = None,
            ShapeObject::Curve(s) => s.drawing.caption = None,
            ShapeObject::Group(s) => s.caption = None,
            ShapeObject::Picture(s) => s.caption = None,
            ShapeObject::Chart(s) => {
                s.caption = None;
                s.drawing.caption = None;
            }
            ShapeObject::Ole(s) => {
                s.caption = None;
                s.drawing.caption = None;
            }
        }
        if had_caption {
            shape.common_mut().attr &= !(1 << 29);
        }
        had_caption
    }

    fn format_shape_caption_props_json(shape: &ShapeObject) -> String {
        let caption = Self::shape_caption_ref(shape);
        format!(
            ",\"hasCaption\":{},\"captionDirection\":\"{}\",\"captionVertAlign\":\"{}\",\"captionWidth\":{},\"captionSpacing\":{},\"captionMaxWidth\":{},\"captionIncludeMargin\":{}",
            caption.is_some(),
            caption.map_or("Bottom", |cap| match cap.direction {
                CaptionDirection::Left => "Left",
                CaptionDirection::Right => "Right",
                CaptionDirection::Top => "Top",
                CaptionDirection::Bottom => "Bottom",
            }),
            caption.map_or("Top", |cap| match cap.vert_align {
                CaptionVertAlign::Top => "Top",
                CaptionVertAlign::Center => "Center",
                CaptionVertAlign::Bottom => "Bottom",
            }),
            caption.map_or(0u32, |cap| cap.width),
            caption.map_or(0i16, |cap| cap.spacing),
            caption.map_or(0u32, |cap| cap.max_width),
            caption.map_or(false, |cap| cap.include_margin),
        )
    }

    fn apply_shape_caption_props(shape: &mut ShapeObject, props_json: &str) -> bool {
        use crate::document_core::helpers::{json_bool, json_i16, json_str, json_u32};

        let Some(has_caption) = json_bool(props_json, "hasCaption") else {
            return false;
        };
        if !has_caption {
            return Self::clear_shape_caption(shape);
        }

        let default_max_width = shape.common().width;
        let mut created = false;
        {
            let caption_slot = Self::shape_caption_mut(shape);
            if caption_slot.is_none() {
                let mut caption = Caption {
                    max_width: default_max_width,
                    ..Default::default()
                };
                let auto_number = crate::model::control::AutoNumber {
                    number_type: crate::model::control::AutoNumberType::Picture,
                    suffix_char: '.',
                    ..Default::default()
                };
                let mut para = Paragraph::new_empty();
                // 한컴 그림/OLE 캡션은 AutoNumber 앞에 "그림" 접두어를 함께 표시한다.
                para.text = "그림  ".to_string();
                para.char_count = 13;
                para.char_count_msb = true;
                para.control_mask = 1u32 << 0x12;
                para.char_offsets = vec![0, 1, 2, 11];
                para.controls
                    .push(crate::model::control::Control::AutoNumber(auto_number));
                para.ctrl_data_records.push(None);
                caption.paragraphs.push(para);
                *caption_slot = Some(caption);
                created = true;
            }

            if let Some(caption) = caption_slot.as_mut() {
                if let Some(v) = json_str(props_json, "captionDirection") {
                    caption.direction = match v.as_str() {
                        "Left" => CaptionDirection::Left,
                        "Right" => CaptionDirection::Right,
                        "Top" => CaptionDirection::Top,
                        _ => CaptionDirection::Bottom,
                    };
                }
                if let Some(v) = json_str(props_json, "captionVertAlign") {
                    caption.vert_align = match v.as_str() {
                        "Center" => CaptionVertAlign::Center,
                        "Bottom" => CaptionVertAlign::Bottom,
                        _ => CaptionVertAlign::Top,
                    };
                }
                if let Some(v) = json_u32(props_json, "captionWidth") {
                    caption.width = v;
                }
                if let Some(v) = json_i16(props_json, "captionSpacing") {
                    caption.spacing = v;
                }
                if let Some(v) = json_bool(props_json, "captionIncludeMargin") {
                    caption.include_margin = v;
                }
            }
        }

        if created {
            shape.common_mut().attr |= 1 << 29;
        }
        created
    }

    fn resolve_shape_control_ref(
        &self,
        section_idx: usize,
        parent_para_idx: usize,
        control_idx: usize,
    ) -> Result<&ShapeObject, HwpError> {
        let section = self.document.sections.get(section_idx).ok_or_else(|| {
            HwpError::RenderError(format!("구역 인덱스 {} 범위 초과", section_idx))
        })?;

        let body_len = section.paragraphs.len();
        let para = if parent_para_idx < body_len {
            section.paragraphs.get(parent_para_idx).ok_or_else(|| {
                HwpError::RenderError(format!("문단 인덱스 {} 범위 초과", parent_para_idx))
            })?
        } else {
            let mut virtual_idx = parent_para_idx - body_len;
            let mut found = None;
            'outer: for body_para in &section.paragraphs {
                for ctrl in &body_para.controls {
                    if let Control::Endnote(en) = ctrl {
                        if virtual_idx < en.paragraphs.len() {
                            found = en.paragraphs.get(virtual_idx);
                            break 'outer;
                        }
                        virtual_idx -= en.paragraphs.len();
                    }
                }
            }
            found.ok_or_else(|| {
                HwpError::RenderError(format!("문단 인덱스 {} 범위 초과", parent_para_idx))
            })?
        };

        let ctrl = para.controls.get(control_idx).ok_or_else(|| {
            HwpError::RenderError(format!("컨트롤 인덱스 {} 범위 초과", control_idx))
        })?;
        match ctrl {
            Control::Shape(s) => Ok(s.as_ref()),
            _ => Err(HwpError::RenderError(
                "지정된 컨트롤이 Shape이 아닙니다".to_string(),
            )),
        }
    }
    fn resolve_shape_control_mut(
        &mut self,
        section_idx: usize,
        parent_para_idx: usize,
        control_idx: usize,
    ) -> Result<&mut ShapeObject, HwpError> {
        let section = self.document.sections.get_mut(section_idx).ok_or_else(|| {
            HwpError::RenderError(format!("구역 인덱스 {} 범위 초과", section_idx))
        })?;

        let body_len = section.paragraphs.len();
        let para = if parent_para_idx < body_len {
            section.paragraphs.get_mut(parent_para_idx).ok_or_else(|| {
                HwpError::RenderError(format!("문단 인덱스 {} 범위 초과", parent_para_idx))
            })?
        } else {
            let mut virtual_idx = parent_para_idx - body_len;
            let mut found = None;
            'outer: for body_para in &mut section.paragraphs {
                for ctrl in &mut body_para.controls {
                    if let Control::Endnote(en) = ctrl {
                        if virtual_idx < en.paragraphs.len() {
                            found = en.paragraphs.get_mut(virtual_idx);
                            break 'outer;
                        }
                        virtual_idx -= en.paragraphs.len();
                    }
                }
            }
            found.ok_or_else(|| {
                HwpError::RenderError(format!("문단 인덱스 {} 범위 초과", parent_para_idx))
            })?
        };

        let ctrl = para.controls.get_mut(control_idx).ok_or_else(|| {
            HwpError::RenderError(format!("컨트롤 인덱스 {} 범위 초과", control_idx))
        })?;
        match ctrl {
            Control::Shape(s) => Ok(s.as_mut()),
            _ => Err(HwpError::RenderError(
                "지정된 컨트롤이 Shape이 아닙니다".to_string(),
            )),
        }
    }
    fn body_rectangle_width_target(
        &self,
        sec: usize,
        para: usize,
        ci: usize,
    ) -> Result<&ShapeObject, HwpError> {
        let section = self
            .document
            .sections
            .get(sec)
            .ok_or_else(|| HwpError::RenderError("본문 구역 범위 초과".into()))?;
        if section.section_def.text_direction != 0 || para >= section.paragraphs.len() {
            return Err(HwpError::RenderError("가로 본문 문단만 지원합니다".into()));
        }
        let p = &section.paragraphs[para];
        let info = &self.document.doc_info;
        if p.para_shape_id as usize >= info.para_shapes.len()
            || p.style_id as usize >= info.styles.len()
            || p.char_shapes
                .iter()
                .any(|c| c.char_shape_id as usize >= info.char_shapes.len())
        {
            return Err(HwpError::RenderError(
                "본문 사각형 문단의 서식 참조 범위 초과".into(),
            ));
        }
        let shape = self.resolve_shape_control_ref(sec, para, ci)?;
        if !shape.supports_body_rectangle_width() {
            return Err(HwpError::RenderError(
                "변환/흐름/글상자/캡션 없는 본문 사각형만 지원합니다".into(),
            ));
        }
        Ok(shape)
    }

    /// Width and basis form one atomic value; relative widths use 1/100 percent.
    pub fn get_body_rectangle_width_native(
        &self,
        sec: usize,
        para: usize,
        ci: usize,
    ) -> Result<String, HwpError> {
        let c = self.body_rectangle_width_target(sec, para, ci)?.common();
        Ok(
            serde_json::json!({"width":c.width,"widthCriterion":format!("{:?}",c.width_criterion)})
                .to_string(),
        )
    }

    /// Explicit width units, without extending the generic shape/cell setters.
    pub fn set_body_rectangle_width_native(
        &mut self,
        sec: usize,
        para: usize,
        ci: usize,
        props: &str,
    ) -> Result<String, HwpError> {
        use crate::model::shape::SizeCriterion;
        let error = |s: &str| HwpError::RenderError(s.into());
        let v: serde_json::Value =
            serde_json::from_str(props).map_err(|_| error("잘못된 사각형 너비 JSON"))?;
        let fields = v
            .as_object()
            .ok_or_else(|| error("사각형 너비 객체가 필요합니다"))?;
        if fields.len() != 2
            || !fields.contains_key("width")
            || !fields.contains_key("widthCriterion")
        {
            return Err(error("width와 widthCriterion만 함께 지정해야 합니다"));
        }
        let basis = match v["widthCriterion"].as_str() {
            Some("Absolute") => SizeCriterion::Absolute,
            Some("Paper") => SizeCriterion::Paper,
            Some("Page") => SizeCriterion::Page,
            Some("Column") => SizeCriterion::Column,
            Some("Para") => SizeCriterion::Para,
            _ => return Err(error("지원하지 않는 너비 기준")),
        };
        let width = v["width"]
            .as_u64()
            .filter(|w| *w >= u64::from(MIN_SHAPE_SIZE) && *w <= i32::MAX as u64)
            .ok_or_else(|| error("사각형 너비 범위 초과"))? as u32;
        if basis != SizeCriterion::Absolute && width > 10000
            || basis == SizeCriterion::Para && width != 10000
        {
            return Err(error(
                "문단 너비는100%, 다른 상대 너비는2~100%만 지원합니다",
            ));
        }
        self.body_rectangle_width_target(sec, para, ci)?;
        let Control::Shape(shape) = &mut self.document.sections[sec].paragraphs[para].controls[ci]
        else {
            unreachable!()
        };
        let ShapeObject::Rectangle(r) = shape.as_mut() else {
            unreachable!()
        };
        r.common.width = width;
        r.common.width_criterion = basis;
        Self::sync_common_obj_attr_known_bits(&mut r.common);
        r.drawing.shape_attr.original_width = width;
        r.drawing.shape_attr.current_width = width;
        r.drawing.shape_attr.rotation_center.x = (width / 2) as i32;
        r.x_coords = [0, width as i32, width as i32, 0];
        self.document.sections[sec].raw_stream = None;
        self.recompose_section(sec);
        self.paginate_if_needed();
        self.invalidate_page_tree_cache();
        self.event_log.push(DocumentEvent::PictureResized {
            section: sec,
            para,
            ctrl: ci,
        });
        Ok("{\"ok\":true}".into())
    }

    /// 글상자(Shape) 속성 조회 (네이티브).
    pub fn get_shape_properties_native(
        &self,
        section_idx: usize,
        parent_para_idx: usize,
        control_idx: usize,
    ) -> Result<String, HwpError> {
        let shape = self.resolve_shape_control_ref(section_idx, parent_para_idx, control_idx)?;

        let c = shape.common();
        let common_json = Self::common_obj_attr_to_json(c);

        // TextBox 속성
        let tb_json = if let Some(tb) = get_textbox_from_shape(shape) {
            let va = match tb.vertical_align {
                crate::model::table::VerticalAlign::Top => "Top",
                crate::model::table::VerticalAlign::Center => "Center",
                crate::model::table::VerticalAlign::Bottom => "Bottom",
            };
            format!(
                ",\"tbMarginLeft\":{},\"tbMarginRight\":{},\"tbMarginTop\":{},\"tbMarginBottom\":{},\"tbVerticalAlign\":\"{}\"",
                tb.margin_left, tb.margin_right, tb.margin_top, tb.margin_bottom, va
            )
        } else {
            String::new()
        };

        // 테두리 / 회전 / 채우기 정보
        let drawing = shape.drawing();
        let extra_json = if let Some(d) = drawing {
            let sa = &d.shape_attr;
            let fill = &d.fill;
            let fill_type = match fill.fill_type {
                crate::model::style::FillType::None => "none",
                crate::model::style::FillType::Solid => "solid",
                crate::model::style::FillType::Gradient => "gradient",
                crate::model::style::FillType::Image => "image",
            };
            // borderAttr 비트필드 분해
            let bl = &d.border_line;
            let line_type = bl.attr & 0x3F; // bits 0-5: 선 종류 (0~17)
            let line_end_shape = (bl.attr >> 6) & 0x0F; // bits 6-9: 끝 모양
            let arrow_start = (bl.attr >> 10) & 0x3F; // bits 10-15: 화살표 시작 모양
            let arrow_end = (bl.attr >> 16) & 0x3F; // bits 16-21: 화살표 끝 모양
            let arrow_start_size = (bl.attr >> 22) & 0x0F; // bits 22-25: 화살표 시작 크기
            let arrow_end_size = (bl.attr >> 26) & 0x0F; // bits 26-29: 화살표 끝 크기

            let mut extra = format!(
                ",\"borderColor\":{},\"borderWidth\":{},\"borderAttr\":{},\"borderOutlineStyle\":{}\
                ,\"lineType\":{},\"lineEndShape\":{}\
                ,\"arrowStart\":{},\"arrowEnd\":{},\"arrowStartSize\":{},\"arrowEndSize\":{}\
                ,\"rotationAngle\":{},\"horzFlip\":{},\"vertFlip\":{}\
                ,\"fillType\":\"{}\"",
                bl.color, bl.width, bl.attr, bl.outline_style,
                line_type, line_end_shape,
                arrow_start, arrow_end, arrow_start_size, arrow_end_size,
                sa.rotation_angle, sa.horz_flip, sa.vert_flip,
                fill_type
            );
            // 단색 채우기
            if let Some(ref s) = fill.solid {
                extra.push_str(&format!(
                    ",\"fillBgColor\":{},\"fillPatColor\":{},\"fillPatType\":{}",
                    s.background_color, s.pattern_color, s.pattern_type
                ));
            }
            // 그러데이션 채우기
            if let Some(ref g) = fill.gradient {
                extra.push_str(&format!(
                    ",\"gradientType\":{},\"gradientAngle\":{},\"gradientCenterX\":{},\"gradientCenterY\":{},\"gradientBlur\":{}",
                    g.gradient_type, g.angle, g.center_x, g.center_y, g.blur
                ));
            }
            extra.push_str(&format!(",\"fillAlpha\":{}", fill.alpha));
            // 그림자
            extra.push_str(&format!(",\"shadowType\":{},\"shadowColor\":{},\"shadowOffsetX\":{},\"shadowOffsetY\":{},\"shadowAlpha\":{}",
                d.shadow_type, d.shadow_color, d.shadow_offset_x, d.shadow_offset_y, d.shadow_alpha));
            extra.push_str(&format!(",\"scInstId\":{}", d.inst_id));
            extra
        } else {
            String::new()
        };

        // Rectangle 전용: 모서리 곡률
        let round_json = if let crate::model::shape::ShapeObject::Rectangle(ref rect) = shape {
            format!(",\"roundRate\":{}", rect.round_rate)
        } else {
            String::new()
        };

        // 연결선 타입 + 제어점 좌표 (꺽임/곡선 중간 마커용)
        let connector_json = if let crate::model::shape::ShapeObject::Line(ref line) = shape {
            if let Some(ref conn) = line.connector {
                // type=2 제어점의 평균 좌표 (꺽임 모서리 / 곡선 중간점)
                let ctrl2_pts: Vec<&crate::model::shape::ConnectorControlPoint> = conn
                    .control_points
                    .iter()
                    .filter(|cp| cp.point_type == 2)
                    .collect();
                if !ctrl2_pts.is_empty() {
                    let avg_x: i32 =
                        ctrl2_pts.iter().map(|p| p.x).sum::<i32>() / ctrl2_pts.len() as i32;
                    let avg_y: i32 =
                        ctrl2_pts.iter().map(|p| p.y).sum::<i32>() / ctrl2_pts.len() as i32;
                    format!(
                        ",\"connectorType\":{},\"connectorMidX\":{},\"connectorMidY\":{}",
                        conn.link_type as u32, avg_x, avg_y
                    )
                } else {
                    format!(",\"connectorType\":{}", conn.link_type as u32)
                }
            } else {
                String::new()
            }
        } else {
            String::new()
        };

        let extra_json = if matches!(shape, ShapeObject::Group(_)) {
            let sa = shape.shape_attr();
            format!(",\"rotationAngle\":{},\"horzFlip\":{},\"vertFlip\":{}", sa.rotation_angle, sa.horz_flip, sa.vert_flip)
        } else { extra_json };
        let caption_json = Self::format_shape_caption_props_json(shape);
        Ok(format!(
            "{{{}{}{}{}{}{}}}",
            common_json, tb_json, extra_json, round_json, connector_json, caption_json
        ))
    }
    /// 글상자(Shape) 속성 변경 (네이티브).
    pub fn set_shape_properties_native(
        &mut self,
        section_idx: usize,
        parent_para_idx: usize,
        control_idx: usize,
        props_json: &str,
    ) -> Result<String, HwpError> {
        use crate::document_core::helpers::{json_bool, json_i32, json_str};

        let shape = self.resolve_shape_control_mut(section_idx, parent_para_idx, control_idx)?;
        // Orientation-only edits keep the imported line/page projection. The
        // mixed picture frame solver currently attests only unrotated groups;
        // recomposing here would collapse the inline carrier onto page one.
        let preserve_group_frame = matches!(shape, ShapeObject::Group(_))
            && serde_json::from_str::<serde_json::Value>(props_json).ok()
                .and_then(|v| v.as_object().map(|o| !o.is_empty() && o.keys().all(|k|
                    matches!(k.as_str(), "rotationAngle" | "horzFlip" | "vertFlip"))))
                .unwrap_or(false);

        // CommonObjAttr 업데이트
        // 리사이즈 핸들을 반대편으로 끌어당길 때 studio가 width/height=0 을 보내
        // 도형이 렌더러상 사라지는 버그 방어: 최소 크기 clamp.
        let previous_group_size = (shape.common().width, shape.common().height);
        let c = shape.common_mut();
        let new_w = crate::document_core::helpers::json_u32(props_json, "width")
            .map(|w| w.max(MIN_SHAPE_SIZE));
        let new_h = crate::document_core::helpers::json_u32(props_json, "height")
            .map(|h| h.max(MIN_SHAPE_SIZE));
        Self::apply_common_obj_attr_from_json(c, props_json);

        // Polygon/Curve: original_width/height는 생성 시 값으로 유지해야 렌더러의
        // 스케일 팩터(sx = current/original)가 올바르게 동작한다.
        let is_polygon_or_curve = matches!(
            shape,
            crate::model::shape::ShapeObject::Polygon(_)
                | crate::model::shape::ShapeObject::Curve(_)
        );
        let saved_orig_w = if is_polygon_or_curve {
            shape.drawing().map(|d| d.shape_attr.original_width)
        } else {
            None
        };
        let saved_orig_h = if is_polygon_or_curve {
            shape.drawing().map(|d| d.shape_attr.original_height)
        } else {
            None
        };

        // ShapeComponentAttr 크기/회전/채우기 동기화
        if let Some(d) = shape.drawing_mut() {
            if let Some(w) = new_w {
                d.shape_attr.current_width = w;
                d.shape_attr.original_width = w;
            }
            if let Some(h) = new_h {
                d.shape_attr.current_height = h;
                d.shape_attr.original_height = h;
            }

            // 회전/기울임
            if let Some(v) = json_i32(props_json, "rotationAngle") {
                d.shape_attr.rotation_angle = v as i16;
            }
            // 대칭(flip)
            if let Some(v) = json_bool(props_json, "horzFlip") {
                d.shape_attr.horz_flip = v;
                if v {
                    d.shape_attr.flip |= 1;
                } else {
                    d.shape_attr.flip &= !1;
                }
            }
            if let Some(v) = json_bool(props_json, "vertFlip") {
                d.shape_attr.vert_flip = v;
                if v {
                    d.shape_attr.flip |= 2;
                } else {
                    d.shape_attr.flip &= !2;
                }
            }

            // 테두리 선 — 색상/굵기
            if let Some(v) = json_i32(props_json, "borderColor") {
                d.border_line.color = v as u32;
            }
            if let Some(v) = json_i32(props_json, "borderWidth") {
                d.border_line.width = v;
            }

            // 테두리 선 — attr 비트필드 개별 필드 업데이트
            {
                let mut attr = d.border_line.attr;
                if let Some(v) = json_i32(props_json, "lineType") {
                    attr = (attr & !0x3F) | ((v as u32) & 0x3F);
                }
                if let Some(v) = json_i32(props_json, "lineEndShape") {
                    attr = (attr & !(0x0F << 6)) | (((v as u32) & 0x0F) << 6);
                }
                if let Some(v) = json_i32(props_json, "arrowStart") {
                    attr = (attr & !(0x3F << 10)) | (((v as u32) & 0x3F) << 10);
                }
                if let Some(v) = json_i32(props_json, "arrowEnd") {
                    attr = (attr & !(0x3F << 16)) | (((v as u32) & 0x3F) << 16);
                }
                if let Some(v) = json_i32(props_json, "arrowStartSize") {
                    attr = (attr & !(0x0F << 22)) | (((v as u32) & 0x0F) << 22);
                }
                if let Some(v) = json_i32(props_json, "arrowEndSize") {
                    attr = (attr & !(0x0F << 26)) | (((v as u32) & 0x0F) << 26);
                }
                d.border_line.attr = attr;
            }

            // 채우기 (단색)
            if let Some(v) = json_str(props_json, "fillType") {
                d.fill.fill_type = match v.as_str() {
                    "solid" => crate::model::style::FillType::Solid,
                    "gradient" => crate::model::style::FillType::Gradient,
                    "image" => crate::model::style::FillType::Image,
                    _ => crate::model::style::FillType::None,
                };
            }
            if let Some(v) = json_i32(props_json, "fillBgColor") {
                let solid = d.fill.solid.get_or_insert_with(|| {
                    crate::model::style::SolidFill {
                        pattern_type: -1, // -1 = 단색 채우기 (0은 채우기 없음)
                        ..Default::default()
                    }
                });
                solid.background_color = v as u32;
            }
            if let Some(v) = json_i32(props_json, "fillPatColor") {
                let solid = d
                    .fill
                    .solid
                    .get_or_insert_with(|| crate::model::style::SolidFill {
                        pattern_type: -1,
                        ..Default::default()
                    });
                solid.pattern_color = v as u32;
            }
            if let Some(v) = json_i32(props_json, "fillPatType") {
                let solid = d
                    .fill
                    .solid
                    .get_or_insert_with(|| crate::model::style::SolidFill {
                        pattern_type: -1,
                        ..Default::default()
                    });
                solid.pattern_type = v;
            }
            if let Some(v) = json_i32(props_json, "fillAlpha") {
                d.fill.alpha = v as u8;
            }

            // 채우기 (그라디언트)
            if let Some(v) = json_i32(props_json, "gradientType") {
                let grad = d.fill.gradient.get_or_insert_with(Default::default);
                grad.gradient_type = v as i16;
            }
            if let Some(v) = json_i32(props_json, "gradientAngle") {
                let grad = d.fill.gradient.get_or_insert_with(Default::default);
                grad.angle = v as i16;
            }
            if let Some(v) = json_i32(props_json, "gradientCenterX") {
                let grad = d.fill.gradient.get_or_insert_with(Default::default);
                grad.center_x = v as i16;
            }
            if let Some(v) = json_i32(props_json, "gradientCenterY") {
                let grad = d.fill.gradient.get_or_insert_with(Default::default);
                grad.center_y = v as i16;
            }
            if let Some(v) = json_i32(props_json, "gradientBlur") {
                let grad = d.fill.gradient.get_or_insert_with(Default::default);
                grad.blur = v as i16;
            }

            // 그림자
            if let Some(v) = crate::document_core::helpers::json_u32(props_json, "shadowType") {
                d.shadow_type = v;
            }
            if let Some(v) = crate::document_core::helpers::json_i32(props_json, "shadowColor") {
                d.shadow_color = v as u32;
            }
            if let Some(v) = crate::document_core::helpers::json_i32(props_json, "shadowOffsetX") {
                d.shadow_offset_x = v;
            }
            if let Some(v) = crate::document_core::helpers::json_i32(props_json, "shadowOffsetY") {
                d.shadow_offset_y = v;
            }

            // TextBox 속성 업데이트
            if let Some(ref mut tb) = d.text_box {
                if let Some(v) = json_i32(props_json, "tbMarginLeft") {
                    tb.margin_left = v as i16;
                }
                if let Some(v) = json_i32(props_json, "tbMarginRight") {
                    tb.margin_right = v as i16;
                }
                if let Some(v) = json_i32(props_json, "tbMarginTop") {
                    tb.margin_top = v as i16;
                }
                if let Some(v) = json_i32(props_json, "tbMarginBottom") {
                    tb.margin_bottom = v as i16;
                }
                if let Some(v) = json_str(props_json, "tbVerticalAlign") {
                    tb.vertical_align = match v.as_str() {
                        "Top" => crate::model::table::VerticalAlign::Top,
                        "Center" => crate::model::table::VerticalAlign::Center,
                        "Bottom" => crate::model::table::VerticalAlign::Bottom,
                        _ => tb.vertical_align,
                    };
                }
            }
        }

        // Rectangle 곡률
        if let crate::model::shape::ShapeObject::Rectangle(ref mut rect) = shape {
            if let Some(v) = crate::document_core::helpers::json_i32(props_json, "roundRate") {
                rect.round_rate = v as u8;
            }
        }

        // Rectangle 좌표 동기화
        if let crate::model::shape::ShapeObject::Rectangle(ref mut rect) = shape {
            let w = rect.common.width as i32;
            let h = rect.common.height as i32;
            rect.x_coords = [0, w, w, 0];
            rect.y_coords = [0, 0, h, h];
        }

        let caption_changed = Self::apply_shape_caption_props(shape, props_json);

        // Polygon/Curve: original_width/height 복원 (생성 시 값 유지 → 렌더러 스케일 팩터 정상화)
        if let Some(d) = shape.drawing_mut() {
            if let Some(w) = saved_orig_w {
                d.shape_attr.original_width = w;
            }
            if let Some(h) = saved_orig_h {
                d.shape_attr.original_height = h;
            }
        }

        // Group 리사이즈: original_width 유지, current_width만 변경 (렌더러가 스케일 적용)
        // 한컴 방식: 자식은 변경하지 않고, 컨테이너의 current/original 비율로 스케일 결정
        if let crate::model::shape::ShapeObject::Group(ref mut group) = shape {
            if let Some(nw) = new_w {
                group.shape_attr.current_width = nw;
                // original_width는 유지 (스케일 기준)
            }
            if let Some(nh) = new_h {
                group.shape_attr.current_height = nh;
            }
            // Parsed child matrices already include the parent scale. For a
            // simple unrotated picture group, bake the resize delta into those
            // matrices and normalize the container to avoid double scaling on
            // ungroup or HWPX reload. Other group kinds retain their old path.
            let simple_pictures = !group.children.is_empty()
                && group.shape_attr.rotation_angle.rem_euclid(360) == 0
                && !group.shape_attr.horz_flip && !group.shape_attr.vert_flip
                && group.children.iter().all(|child| match child {
                    crate::model::shape::ShapeObject::Picture(pic) => {
                        let sa = &pic.shape_attr;
                        sa.render_b.abs() < 1e-6 && sa.render_c.abs() < 1e-6
                            && sa.render_sx > 0.0 && sa.render_sy > 0.0
                            && sa.original_width > 0 && sa.original_height > 0
                    }
                    _ => false,
                });
            // Resize in the parent's logical axes, then restore its orientation.
            // R * D * inverse(R) keeps rotated children orthogonal even when
            // width and height change by different factors.
            let mut previous = group.clone();
            previous.common.width = previous_group_size.0;
            previous.common.height = previous_group_size.1;
            previous.shape_attr.current_width = previous_group_size.0;
            previous.shape_attr.current_height = previous_group_size.1;
            let sx = group.common.width as f64 / previous_group_size.0.max(1) as f64;
            let sy = group.common.height as f64 / previous_group_size.1.max(1) as f64;
            let oriented_resize = !simple_pictures
                && crate::renderer::float_placement::supports_picture_group_exclusion(&previous);
            let (sin,cos) = (previous.shape_attr.rotation_angle as f64).to_radians().sin_cos();
            let delta = [cos*cos*sx+sin*sin*sy, cos*sin*(sx-sy),
                         cos*sin*(sx-sy), sin*sin*sx+cos*cos*sy];
            let (old_cx,old_cy) = (previous_group_size.0 as f64/2.0,previous_group_size.1 as f64/2.0);
            let (new_cx,new_cy) = (group.common.width as f64/2.0,group.common.height as f64/2.0);
            if (new_w.is_some() || new_h.is_some()) && oriented_resize {
                for child in &mut group.children {
                    if let ShapeObject::Picture(pic) = child {
                        let sa = &mut pic.shape_attr;
                        let (a,b,c,d,tx,ty) = (sa.render_sx,sa.render_b,sa.render_c,sa.render_sy,sa.render_tx,sa.render_ty);
                        sa.render_sx = delta[0]*a+delta[1]*c;
                        sa.render_b = delta[0]*b+delta[1]*d;
                        sa.render_c = delta[2]*a+delta[3]*c;
                        sa.render_sy = delta[2]*b+delta[3]*d;
                        sa.render_tx = new_cx+delta[0]*(tx-old_cx)+delta[1]*(ty-old_cy);
                        sa.render_ty = new_cy+delta[2]*(tx-old_cx)+delta[3]*(ty-old_cy);
                        sa.current_width = (sa.original_width as f64 * sa.render_sx.hypot(sa.render_c)).round().max(1.0) as u32;
                        sa.current_height = (sa.original_height as f64 * sa.render_b.hypot(sa.render_sy)).round().max(1.0) as u32;
                        pic.common.width = sa.current_width;
                        pic.common.height = sa.current_height;
                        write_group_child_rendering(sa);
                    }
                }
                group.shape_attr.original_width = group.common.width;
                group.shape_attr.original_height = group.common.height;
                group.shape_attr.render_sx = 1.0;
                group.shape_attr.render_b = 0.0;
                group.shape_attr.render_c = 0.0;
                group.shape_attr.render_sy = 1.0;
                group.shape_attr.render_tx = 0.0;
                group.shape_attr.render_ty = 0.0;
            }
            if (new_w.is_some() || new_h.is_some()) && simple_pictures
                && previous_group_size.0 > 0 && previous_group_size.1 > 0
            {
                let sx = group.common.width as f64 / previous_group_size.0 as f64;
                let sy = group.common.height as f64 / previous_group_size.1 as f64;
                for child in &mut group.children {
                    if let crate::model::shape::ShapeObject::Picture(pic) = child {
                        let sa = &mut pic.shape_attr;
                        sa.render_sx *= sx;
                        sa.render_sy *= sy;
                        sa.render_tx *= sx;
                        sa.render_ty *= sy;
                        sa.offset_x = sa.render_tx.round() as i32;
                        sa.offset_y = sa.render_ty.round() as i32;
                        let width = (sa.original_width as f64 * sa.render_sx).round().max(1.0) as u32;
                        let height = (sa.original_height as f64 * sa.render_sy).round().max(1.0) as u32;
                        sa.current_width = width;
                        sa.current_height = height;
                        pic.common.width = width;
                        pic.common.height = height;
                        pic.common.horizontal_offset = sa.offset_x as u32;
                        pic.common.vertical_offset = sa.offset_y as u32;
                        let identity = [1.0_f64, 0.0, 0.0, 0.0, 1.0, 0.0];
                        sa.raw_rendering = 2_u16.to_le_bytes().to_vec();
                        for matrix in [
                            [1.0, 0.0, sa.render_tx, 0.0, 1.0, sa.render_ty],
                            [sa.render_sx, 0.0, 0.0, 0.0, sa.render_sy, 0.0],
                            identity, identity, identity,
                        ] {
                            for value in matrix { sa.raw_rendering.extend_from_slice(&value.to_le_bytes()); }
                        }
                    }
                }
                group.shape_attr.original_width = group.common.width;
                group.shape_attr.original_height = group.common.height;
                group.shape_attr.render_sx = 1.0;
                group.shape_attr.render_sy = 1.0;
            }
            // 회전 중심 갱신
            group.shape_attr.rotation_center.x = (group.common.width / 2) as i32;
            group.shape_attr.rotation_center.y = (group.common.height / 2) as i32;
            // raw_rendering 초기화 → 직렬화 시 스케일 행렬 재생성
            Self::apply_group_orientation(group, props_json);
            group.shape_attr.raw_rendering = Vec::new();
        }

        if caption_changed {
            crate::parser::assign_auto_numbers(&mut self.document);
        }

        // 리플로우 + 렌더 트리 캐시 무효화
        let section = &mut self.document.sections[section_idx];
        section.raw_stream = None;
        if !preserve_group_frame {
            self.recompose_section(section_idx);
            self.paginate_if_needed();
        }
        self.invalidate_page_tree_cache();

        self.event_log.push(DocumentEvent::PictureResized {
            section: section_idx,
            para: parent_para_idx,
            ctrl: control_idx,
        });
        Ok("{\"ok\":true}".to_string())
    }
    /// [Task #1138] Shape 속성 → JSON. get_shape_properties_native +
    /// get_cell_shape_properties_by_path_native 공유.
    pub(crate) fn format_shape_props_inner(
        shape: &crate::model::shape::ShapeObject,
    ) -> Result<String, HwpError> {
        let c = shape.common();
        let common_json = Self::common_obj_attr_to_json(c);

        // TextBox 속성
        let tb_json = if let Some(tb) = get_textbox_from_shape(shape) {
            let va = match tb.vertical_align {
                crate::model::table::VerticalAlign::Top => "Top",
                crate::model::table::VerticalAlign::Center => "Center",
                crate::model::table::VerticalAlign::Bottom => "Bottom",
            };
            format!(
                ",\"tbMarginLeft\":{},\"tbMarginRight\":{},\"tbMarginTop\":{},\"tbMarginBottom\":{},\"tbVerticalAlign\":\"{}\"",
                tb.margin_left, tb.margin_right, tb.margin_top, tb.margin_bottom, va
            )
        } else {
            String::new()
        };

        // 테두리 / 회전 / 채우기 정보
        let drawing = shape.drawing();
        let extra_json = if let Some(d) = drawing {
            let sa = &d.shape_attr;
            let fill = &d.fill;
            let fill_type = match fill.fill_type {
                crate::model::style::FillType::None => "none",
                crate::model::style::FillType::Solid => "solid",
                crate::model::style::FillType::Gradient => "gradient",
                crate::model::style::FillType::Image => "image",
            };
            let bl = &d.border_line;
            let line_type = bl.attr & 0x3F;
            let line_end_shape = (bl.attr >> 6) & 0x0F;
            let arrow_start = (bl.attr >> 10) & 0x3F;
            let arrow_end = (bl.attr >> 16) & 0x3F;
            let arrow_start_size = (bl.attr >> 22) & 0x0F;
            let arrow_end_size = (bl.attr >> 26) & 0x0F;

            let mut extra = format!(
                ",\"borderColor\":{},\"borderWidth\":{},\"borderAttr\":{},\"borderOutlineStyle\":{}\
                ,\"lineType\":{},\"lineEndShape\":{}\
                ,\"arrowStart\":{},\"arrowEnd\":{},\"arrowStartSize\":{},\"arrowEndSize\":{}\
                ,\"rotationAngle\":{},\"horzFlip\":{},\"vertFlip\":{}\
                ,\"fillType\":\"{}\"",
                bl.color, bl.width, bl.attr, bl.outline_style,
                line_type, line_end_shape,
                arrow_start, arrow_end, arrow_start_size, arrow_end_size,
                sa.rotation_angle, sa.horz_flip, sa.vert_flip,
                fill_type
            );
            if let Some(ref s) = fill.solid {
                extra.push_str(&format!(
                    ",\"fillBgColor\":{},\"fillPatColor\":{},\"fillPatType\":{}",
                    s.background_color, s.pattern_color, s.pattern_type
                ));
            }
            if let Some(ref g) = fill.gradient {
                extra.push_str(&format!(
                    ",\"gradientType\":{},\"gradientAngle\":{},\"gradientCenterX\":{},\"gradientCenterY\":{},\"gradientBlur\":{}",
                    g.gradient_type, g.angle, g.center_x, g.center_y, g.blur
                ));
            }
            extra.push_str(&format!(",\"fillAlpha\":{}", fill.alpha));
            extra.push_str(&format!(",\"shadowType\":{},\"shadowColor\":{},\"shadowOffsetX\":{},\"shadowOffsetY\":{},\"shadowAlpha\":{}",
                d.shadow_type, d.shadow_color, d.shadow_offset_x, d.shadow_offset_y, d.shadow_alpha));
            extra.push_str(&format!(",\"scInstId\":{}", d.inst_id));
            extra
        } else {
            String::new()
        };

        let round_json = if let crate::model::shape::ShapeObject::Rectangle(ref rect) = shape {
            format!(",\"roundRate\":{}", rect.round_rate)
        } else {
            String::new()
        };

        let connector_json = if let crate::model::shape::ShapeObject::Line(ref line) = shape {
            if let Some(ref conn) = line.connector {
                let ctrl2_pts: Vec<&crate::model::shape::ConnectorControlPoint> = conn
                    .control_points
                    .iter()
                    .filter(|cp| cp.point_type == 2)
                    .collect();
                if !ctrl2_pts.is_empty() {
                    let avg_x: i32 =
                        ctrl2_pts.iter().map(|p| p.x).sum::<i32>() / ctrl2_pts.len() as i32;
                    let avg_y: i32 =
                        ctrl2_pts.iter().map(|p| p.y).sum::<i32>() / ctrl2_pts.len() as i32;
                    format!(
                        ",\"connectorType\":{},\"connectorMidX\":{},\"connectorMidY\":{}",
                        conn.link_type as u32, avg_x, avg_y
                    )
                } else {
                    format!(",\"connectorType\":{}", conn.link_type as u32)
                }
            } else {
                String::new()
            }
        } else {
            String::new()
        };

        let extra_json = if matches!(shape, ShapeObject::Group(_)) {
            let sa = shape.shape_attr();
            format!(",\"rotationAngle\":{},\"horzFlip\":{},\"vertFlip\":{}", sa.rotation_angle, sa.horz_flip, sa.vert_flip)
        } else { extra_json };
        let caption_json = Self::format_shape_caption_props_json(shape);
        Ok(format!(
            "{{{}{}{}{}{}{}}}",
            common_json, tb_json, extra_json, round_json, connector_json, caption_json
        ))
    }
    /// [Task #1138] Shape 속성 JSON 적용 (mutation only). 후처리 (recompose /
    /// paginate / cache invalidate / event log) 는 호출자 책임.
    /// set_shape_properties_native + set_cell_shape_properties_by_path_native 공유.
    /// 반환: caption_changed (true면 호출자가 AutoNumber 후처리 필요).
    pub(crate) fn apply_shape_props_inner(
        shape: &mut crate::model::shape::ShapeObject,
        props_json: &str,
    ) -> bool {
        use crate::document_core::helpers::{json_bool, json_i32, json_str};

        let c = shape.common_mut();
        let new_w = crate::document_core::helpers::json_u32(props_json, "width")
            .map(|w| w.max(MIN_SHAPE_SIZE));
        let new_h = crate::document_core::helpers::json_u32(props_json, "height")
            .map(|h| h.max(MIN_SHAPE_SIZE));
        Self::apply_common_obj_attr_from_json(c, props_json);

        let is_polygon_or_curve = matches!(
            shape,
            crate::model::shape::ShapeObject::Polygon(_)
                | crate::model::shape::ShapeObject::Curve(_)
        );
        let saved_orig_w = if is_polygon_or_curve {
            shape.drawing().map(|d| d.shape_attr.original_width)
        } else {
            None
        };
        let saved_orig_h = if is_polygon_or_curve {
            shape.drawing().map(|d| d.shape_attr.original_height)
        } else {
            None
        };

        if let Some(d) = shape.drawing_mut() {
            if let Some(w) = new_w {
                d.shape_attr.current_width = w;
                d.shape_attr.original_width = w;
            }
            if let Some(h) = new_h {
                d.shape_attr.current_height = h;
                d.shape_attr.original_height = h;
            }
            if let Some(v) = json_i32(props_json, "rotationAngle") {
                d.shape_attr.rotation_angle = v as i16;
            }
            if let Some(v) = json_bool(props_json, "horzFlip") {
                d.shape_attr.horz_flip = v;
                if v {
                    d.shape_attr.flip |= 1;
                } else {
                    d.shape_attr.flip &= !1;
                }
            }
            if let Some(v) = json_bool(props_json, "vertFlip") {
                d.shape_attr.vert_flip = v;
                if v {
                    d.shape_attr.flip |= 2;
                } else {
                    d.shape_attr.flip &= !2;
                }
            }
            if let Some(v) = json_i32(props_json, "borderColor") {
                d.border_line.color = v as u32;
            }
            if let Some(v) = json_i32(props_json, "borderWidth") {
                d.border_line.width = v;
            }
            {
                let mut attr = d.border_line.attr;
                if let Some(v) = json_i32(props_json, "lineType") {
                    attr = (attr & !0x3F) | ((v as u32) & 0x3F);
                }
                if let Some(v) = json_i32(props_json, "lineEndShape") {
                    attr = (attr & !(0x0F << 6)) | (((v as u32) & 0x0F) << 6);
                }
                if let Some(v) = json_i32(props_json, "arrowStart") {
                    attr = (attr & !(0x3F << 10)) | (((v as u32) & 0x3F) << 10);
                }
                if let Some(v) = json_i32(props_json, "arrowEnd") {
                    attr = (attr & !(0x3F << 16)) | (((v as u32) & 0x3F) << 16);
                }
                if let Some(v) = json_i32(props_json, "arrowStartSize") {
                    attr = (attr & !(0x0F << 22)) | (((v as u32) & 0x0F) << 22);
                }
                if let Some(v) = json_i32(props_json, "arrowEndSize") {
                    attr = (attr & !(0x0F << 26)) | (((v as u32) & 0x0F) << 26);
                }
                d.border_line.attr = attr;
            }
            if let Some(v) = json_str(props_json, "fillType") {
                d.fill.fill_type = match v.as_str() {
                    "solid" => crate::model::style::FillType::Solid,
                    "gradient" => crate::model::style::FillType::Gradient,
                    "image" => crate::model::style::FillType::Image,
                    _ => crate::model::style::FillType::None,
                };
            }
            if let Some(v) = json_i32(props_json, "fillBgColor") {
                let solid = d
                    .fill
                    .solid
                    .get_or_insert_with(|| crate::model::style::SolidFill {
                        pattern_type: -1,
                        ..Default::default()
                    });
                solid.background_color = v as u32;
            }
            if let Some(v) = json_i32(props_json, "fillPatColor") {
                let solid = d
                    .fill
                    .solid
                    .get_or_insert_with(|| crate::model::style::SolidFill {
                        pattern_type: -1,
                        ..Default::default()
                    });
                solid.pattern_color = v as u32;
            }
            if let Some(v) = json_i32(props_json, "fillPatType") {
                let solid = d
                    .fill
                    .solid
                    .get_or_insert_with(|| crate::model::style::SolidFill {
                        pattern_type: -1,
                        ..Default::default()
                    });
                solid.pattern_type = v;
            }
            if let Some(v) = json_i32(props_json, "fillAlpha") {
                d.fill.alpha = v as u8;
            }
            if let Some(v) = json_i32(props_json, "gradientType") {
                let grad = d.fill.gradient.get_or_insert_with(Default::default);
                grad.gradient_type = v as i16;
            }
            if let Some(v) = json_i32(props_json, "gradientAngle") {
                let grad = d.fill.gradient.get_or_insert_with(Default::default);
                grad.angle = v as i16;
            }
            if let Some(v) = json_i32(props_json, "gradientCenterX") {
                let grad = d.fill.gradient.get_or_insert_with(Default::default);
                grad.center_x = v as i16;
            }
            if let Some(v) = json_i32(props_json, "gradientCenterY") {
                let grad = d.fill.gradient.get_or_insert_with(Default::default);
                grad.center_y = v as i16;
            }
            if let Some(v) = json_i32(props_json, "gradientBlur") {
                let grad = d.fill.gradient.get_or_insert_with(Default::default);
                grad.blur = v as i16;
            }
            if let Some(v) = crate::document_core::helpers::json_u32(props_json, "shadowType") {
                d.shadow_type = v;
            }
            if let Some(v) = crate::document_core::helpers::json_i32(props_json, "shadowColor") {
                d.shadow_color = v as u32;
            }
            if let Some(v) = crate::document_core::helpers::json_i32(props_json, "shadowOffsetX") {
                d.shadow_offset_x = v;
            }
            if let Some(v) = crate::document_core::helpers::json_i32(props_json, "shadowOffsetY") {
                d.shadow_offset_y = v;
            }
            if let Some(ref mut tb) = d.text_box {
                if let Some(v) = json_i32(props_json, "tbMarginLeft") {
                    tb.margin_left = v as i16;
                }
                if let Some(v) = json_i32(props_json, "tbMarginRight") {
                    tb.margin_right = v as i16;
                }
                if let Some(v) = json_i32(props_json, "tbMarginTop") {
                    tb.margin_top = v as i16;
                }
                if let Some(v) = json_i32(props_json, "tbMarginBottom") {
                    tb.margin_bottom = v as i16;
                }
                if let Some(v) = json_str(props_json, "tbVerticalAlign") {
                    tb.vertical_align = match v.as_str() {
                        "Top" => crate::model::table::VerticalAlign::Top,
                        "Center" => crate::model::table::VerticalAlign::Center,
                        "Bottom" => crate::model::table::VerticalAlign::Bottom,
                        _ => tb.vertical_align,
                    };
                }
            }
        }

        if let crate::model::shape::ShapeObject::Rectangle(ref mut rect) = shape {
            if let Some(v) = crate::document_core::helpers::json_i32(props_json, "roundRate") {
                rect.round_rate = v as u8;
            }
        }

        if let crate::model::shape::ShapeObject::Rectangle(ref mut rect) = shape {
            let w = rect.common.width as i32;
            let h = rect.common.height as i32;
            rect.x_coords = [0, w, w, 0];
            rect.y_coords = [0, 0, h, h];
        }

        let caption_changed = Self::apply_shape_caption_props(shape, props_json);

        if let Some(d) = shape.drawing_mut() {
            if let Some(w) = saved_orig_w {
                d.shape_attr.original_width = w;
            }
            if let Some(h) = saved_orig_h {
                d.shape_attr.original_height = h;
            }
        }

        if let crate::model::shape::ShapeObject::Group(ref mut group) = shape {
            if let Some(nw) = new_w {
                group.shape_attr.current_width = nw;
            }
            if let Some(nh) = new_h {
                group.shape_attr.current_height = nh;
            }
            group.shape_attr.rotation_center.x = (group.common.width / 2) as i32;
            group.shape_attr.rotation_center.y = (group.common.height / 2) as i32;
            Self::apply_group_orientation(group, props_json);
            group.shape_attr.raw_rendering = Vec::new();
        }
        caption_changed
    }
    /// 글상자(Shape) 삭제 (네이티브).
    ///
    /// delete_picture_control_native()와 동일한 패턴.
    pub fn delete_shape_control_native(
        &mut self,
        section_idx: usize,
        parent_para_idx: usize,
        control_idx: usize,
    ) -> Result<String, HwpError> {
        if section_idx >= self.document.sections.len() {
            return Err(HwpError::RenderError(format!(
                "구역 인덱스 {} 범위 초과",
                section_idx
            )));
        }
        let section = &mut self.document.sections[section_idx];
        if parent_para_idx >= section.paragraphs.len() {
            return Err(HwpError::RenderError(format!(
                "문단 인덱스 {} 범위 초과",
                parent_para_idx
            )));
        }
        let para = &mut section.paragraphs[parent_para_idx];
        if control_idx >= para.controls.len() {
            return Err(HwpError::RenderError(format!(
                "컨트롤 인덱스 {} 범위 초과",
                control_idx
            )));
        }
        if !matches!(&para.controls[control_idx], Control::Shape(_)) {
            return Err(HwpError::RenderError(
                "지정된 컨트롤이 Shape이 아닙니다".to_string(),
            ));
        }

        // char_offsets 조정 (delete_picture_control_native와 동일)
        let text_chars: Vec<char> = para.text.chars().collect();
        let mut ci = 0usize;
        let mut prev_end: u32 = 0;
        let mut gap_start: Option<u32> = None;
        'outer: for i in 0..text_chars.len() {
            let offset = if i < para.char_offsets.len() {
                para.char_offsets[i]
            } else {
                prev_end
            };
            while prev_end + 8 <= offset && ci < para.controls.len() {
                if ci == control_idx {
                    gap_start = Some(prev_end);
                    break 'outer;
                }
                ci += 1;
                prev_end += 8;
            }
            let char_size: u32 = if text_chars[i] == '\t' {
                8
            } else if text_chars[i].len_utf16() == 2 {
                2
            } else {
                1
            };
            prev_end = offset + char_size;
        }
        if gap_start.is_none() {
            while ci < para.controls.len() {
                if ci == control_idx {
                    gap_start = Some(prev_end);
                    break;
                }
                ci += 1;
                prev_end += 8;
            }
        }
        if let Some(gs) = gap_start {
            let threshold = gs + 8;
            for offset in para.char_offsets.iter_mut() {
                if *offset >= threshold {
                    *offset -= 8;
                }
            }
        }

        para.controls.remove(control_idx);
        if control_idx < para.ctrl_data_records.len() {
            para.ctrl_data_records.remove(control_idx);
        }
        if para.char_count >= 8 {
            para.char_count -= 8;
        }

        // line_segs 재계산: 도형 높이가 반영된 line_segs를 텍스트 기반으로 리셋
        Self::reflow_paragraph_line_segs_after_control_delete(para, &self.styles, self.dpi);

        section.raw_stream = None;
        self.recompose_section(section_idx);
        self.paginate_if_needed();

        self.event_log.push(DocumentEvent::PictureDeleted {
            section: section_idx,
            para: parent_para_idx,
            ctrl: control_idx,
        });
        Ok("{\"ok\":true}".to_string())
    }
    /// 커서 위치에 글상자(Rectangle + TextBox)를 삽입한다 (네이티브).
    pub fn create_shape_control_native(
        &mut self,
        section_idx: usize,
        para_idx: usize,
        char_offset: usize,
        width: u32,
        height: u32,
        horz_offset: u32,
        vert_offset: u32,
        treat_as_char: bool,
        text_wrap_str: &str,
        shape_type: &str,
        line_flip_x: bool,
        line_flip_y: bool,
        polygon_points: &[crate::model::Point],
    ) -> Result<String, HwpError> {
        use crate::model::paragraph::{CharShapeRef, LineSeg};
        use crate::model::shape::*;
        use crate::model::style::{Fill, ShapeBorderLine};

        // 유효성 검사
        if section_idx >= self.document.sections.len() {
            return Err(HwpError::RenderError(format!(
                "구역 인덱스 {} 범위 초과",
                section_idx
            )));
        }
        if para_idx >= self.document.sections[section_idx].paragraphs.len() {
            return Err(HwpError::RenderError(format!(
                "문단 인덱스 {} 범위 초과",
                para_idx
            )));
        }
        if width == 0 && height == 0 {
            return Err(HwpError::RenderError(
                "폭과 높이가 모두 0입니다".to_string(),
            ));
        }

        let text_wrap = match text_wrap_str {
            "Square" => TextWrap::Square,
            "Tight" => TextWrap::Tight,
            "Through" => TextWrap::Through,
            "TopAndBottom" => TextWrap::TopAndBottom,
            "BehindText" => TextWrap::BehindText,
            "InFrontOfText" => TextWrap::InFrontOfText,
            _ => TextWrap::InFrontOfText,
        };

        // 커서 위치 문단의 속성 상속 — 혼합 글자모양 문단에서는 커서 offset 의 글자모양이 기준.
        let current_para = &self.document.sections[section_idx].paragraphs[para_idx];
        let default_char_shape_id: u32 = current_para.char_shape_id_at(char_offset).unwrap_or(0);
        let default_para_shape_id: u16 = current_para.para_shape_id;

        // 편집 영역 폭
        let pd = &self.document.sections[section_idx].section_def.page_def;
        let content_width =
            (pd.width as i32 - pd.margin_left as i32 - pd.margin_right as i32).max(7200) as u32;

        // attr 비트 계산
        // 도형(line/ellipse/rectangle) 및 floating 글상자: 한컴 기본값 0x046A4000
        //   Paper/Top/Paper/Left/InFrontOfText + 절대크기 + allow_overlap + bit26
        // inline 글상자(treat_as_char=true): Para/Top/Column/Left/Square = 0x0A0210
        // [Task #1280 v2] 삽입 글상자는 한컴 정답값 floating(treat_as_char=false)+글앞으로(InFrontOfText).
        //   권위 샘플 samples/textbox-under-image.hwp 실측: 글상자 배치=글앞으로/Paper/Paper/false.
        //   serializer(control.rs:1768)는 common.attr!=0 이면 그대로 직렬화하므로 attr 와 enum 필드를
        //   함께 정합시킨다. treat_as_char=true 인 inline 글상자는 #1280 본편 동작을 그대로 보존.
        let inline_textbox = shape_type == "textbox" && treat_as_char;
        let mut attr: u32 = if inline_textbox { 0x0A0210 } else { 0x046A4000 };
        if treat_as_char {
            attr |= 0x01;
        }

        // --- 빈 문단 (글상자 내부용) ---
        let tb_inner_width = width.saturating_sub(1020); // 양쪽 여백 510+510
        let mut inner_raw_header_extra = vec![0u8; 10];
        inner_raw_header_extra[0..2].copy_from_slice(&1u16.to_le_bytes());
        inner_raw_header_extra[4..6].copy_from_slice(&1u16.to_le_bytes());
        let inner_para = Paragraph {
            text: String::new(),
            char_count: 1,
            char_count_msb: true,
            control_mask: 0,
            para_shape_id: default_para_shape_id,
            style_id: 0,
            char_shapes: vec![CharShapeRef {
                start_pos: 0,
                char_shape_id: default_char_shape_id,
            }],
            line_segs: vec![LineSeg {
                text_start: 0,
                line_height: 1000,
                text_height: 1000,
                baseline_distance: 850,
                line_spacing: 600,
                segment_width: tb_inner_width as i32,
                tag: LineSeg::TAG_SINGLE_SEGMENT_LINE,
                ..Default::default()
            }],
            has_para_text: false,
            raw_header_extra: inner_raw_header_extra,
            ..Default::default()
        };

        // --- 도형 구조 조립 ---
        let w_i = width as i32;
        let h_i = height as i32;
        let new_z_order = self.max_shape_z_order_in_section(section_idx) + 1;

        // ctrl_id 결정
        let is_connector = shape_type.starts_with("connector-");
        let ctrl_id: u32 = match shape_type {
            "line"
            | "connector-straight"
            | "connector-stroke"
            | "connector-arc"
            | "connector-straight-arrow"
            | "connector-stroke-arrow"
            | "connector-arc-arrow" => {
                if is_connector {
                    0x24636f6c
                } else {
                    0x246c696e
                }
            } // '$col' or '$lin'
            "ellipse" => 0x24656c6c, // '$ell'
            "polygon" => 0x24706f6c, // '$pol'
            "arc" => 0x24617263,     // '$arc'
            _ => 0x24726563,         // '$rec' (rectangle, textbox)
        };

        // instance_id 생성: 고유 해시 (z_order 기반 + 위치/크기)
        let instance_id: u32 = {
            let mut h: u32 = 0x7de30000;
            h = h.wrapping_add(new_z_order as u32 * 0x100);
            h = h.wrapping_add(horz_offset.wrapping_mul(3));
            h = h.wrapping_add(vert_offset.wrapping_mul(7));
            h = h.wrapping_add(width);
            h = h.wrapping_add(height.wrapping_mul(0x1b));
            h |= 0x40000000; // bit30 설정 (한컴 호환)
            if h == 0 {
                h = 0x7de34b69;
            }
            h
        };

        let common = CommonObjAttr {
            ctrl_id,
            attr,
            vertical_offset: vert_offset,
            horizontal_offset: horz_offset,
            width,
            height,
            z_order: new_z_order,
            instance_id,
            margin: if shape_type == "textbox" {
                crate::model::Padding {
                    left: 283,
                    right: 283,
                    top: 283,
                    bottom: 283,
                }
            } else {
                crate::model::Padding {
                    left: 0,
                    right: 0,
                    top: 0,
                    bottom: 0,
                }
            },
            treat_as_char,
            // [Task #1280 v2] inline 글상자만 Para/Column(본문 기준), floating 글상자·도형은 Paper.
            vert_rel_to: if inline_textbox {
                VertRelTo::Para
            } else {
                VertRelTo::Paper
            },
            vert_align: VertAlign::Top,
            horz_rel_to: if inline_textbox {
                HorzRelTo::Column
            } else {
                HorzRelTo::Paper
            },
            horz_align: HorzAlign::Left,
            text_wrap,
            description: match shape_type {
                "line" => "선입니다.".to_string(),
                "ellipse" => "타원입니다.".to_string(),
                "rectangle" => "사각형입니다.".to_string(),
                "textbox" => "글상자입니다.".to_string(),
                "polygon" => "다각형입니다.".to_string(),
                "arc" => "호입니다.".to_string(),
                "connector-straight" => "직선 연결선입니다.".to_string(),
                "connector-stroke" => "꺾인 연결선입니다.".to_string(),
                "connector-arc" => "곡선 연결선입니다.".to_string(),
                _ => "그리기 개체.".to_string(),
            },
            ..Default::default()
        };

        let has_textbox = shape_type == "textbox";
        let has_fill = shape_type != "line" && !is_connector;

        let drawing = DrawingObjAttr {
            shape_attr: ShapeComponentAttr {
                ctrl_id,
                is_two_ctrl_id: true,
                original_width: width,
                original_height: height,
                current_width: width,
                current_height: height,
                local_file_version: 1,
                flip: 0x00080000, // 한컴 기본값
                rotation_center: crate::model::Point {
                    x: (width / 2) as i32,
                    y: (height / 2) as i32,
                },
                ..Default::default()
            },
            border_line: ShapeBorderLine {
                color: 0,
                width: 33,
                // Connector type describes routing; Hancom requires a separate
                // tail style in the native line attributes to draw its arrowhead.
                attr: 0xD1000041
                    | if is_connector && shape_type.ends_with("-arrow") {
                        1 << 16 // tail arrow style: ARROW
                    } else {
                        0
                    },
                outline_style: 0,
            },
            fill: if has_fill {
                Fill {
                    fill_type: crate::model::style::FillType::Solid,
                    solid: Some(crate::model::style::SolidFill {
                        background_color: 0x00FFFFFF,
                        pattern_color: 0,
                        pattern_type: -1,
                    }),
                    gradient: None,
                    image: None,
                    alpha: 0,
                }
            } else {
                Fill::default()
            },
            text_box: if has_textbox {
                Some(TextBox {
                    list_attr: 0x20,
                    vertical_all: false,
                    vertical_align: crate::model::table::VerticalAlign::Top,
                    margin_left: 283,
                    margin_right: 283,
                    margin_top: 283,
                    margin_bottom: 283,
                    max_width: width,
                    raw_list_header_extra: vec![0u8; 13],
                    paragraphs: vec![inner_para],
                })
            } else {
                None
            },
            // inst_id: 한컴 SubjectID 기준 = (CTRL_HEADER instance_id & 0x3FFFFFFF) + 1
            inst_id: (instance_id & 0x3FFFFFFF) + 1,
            ..Default::default()
        };

        let shape_obj = match shape_type {
            "line"
            | "connector-straight"
            | "connector-stroke"
            | "connector-arc"
            | "connector-straight-arrow"
            | "connector-stroke-arrow"
            | "connector-arc-arrow" => {
                // 드래그 방향에 따라 시작/끝점 결정
                let (sx, sy, ex, ey) = match (line_flip_x, line_flip_y) {
                    (false, false) => (0, 0, w_i, h_i), // 좌상→우하
                    (false, true) => (0, h_i, w_i, 0),  // 좌하→우상
                    (true, false) => (w_i, 0, 0, h_i),  // 우상→좌하
                    (true, true) => (w_i, h_i, 0, 0),   // 우하→좌상
                };
                let connector = if is_connector {
                    use crate::model::shape::{ConnectorControlPoint, ConnectorData, LinkLineType};
                    let link_type = match shape_type {
                        "connector-straight" => LinkLineType::StraightNoArrow,
                        "connector-straight-arrow" => LinkLineType::StraightOneWay,
                        "connector-stroke" => LinkLineType::StrokeNoArrow,
                        "connector-stroke-arrow" => LinkLineType::StrokeOneWay,
                        "connector-arc" => LinkLineType::ArcNoArrow,
                        "connector-arc-arrow" => LinkLineType::ArcOneWay,
                        _ => LinkLineType::StraightNoArrow,
                    };
                    // 꺽인/곡선 연결선: 한컴 호환 제어점 생성
                    // 구조: 시작앵커(type=3) + 중간점(type=2) + 끝앵커(type=26)
                    let control_points = match link_type {
                        LinkLineType::StrokeNoArrow
                        | LinkLineType::StrokeOneWay
                        | LinkLineType::StrokeBoth
                        | LinkLineType::ArcNoArrow
                        | LinkLineType::ArcOneWay
                        | LinkLineType::ArcBoth => {
                            vec![
                                ConnectorControlPoint {
                                    x: sx,
                                    y: sy,
                                    point_type: 3,
                                }, // 시작 앵커
                                ConnectorControlPoint {
                                    x: ex,
                                    y: sy,
                                    point_type: 2,
                                }, // 중간 (직각 꺾임)
                                ConnectorControlPoint {
                                    x: ex,
                                    y: ey,
                                    point_type: 26,
                                }, // 끝 앵커
                            ]
                        }
                        _ => Vec::new(),
                    };
                    Some(ConnectorData {
                        link_type,
                        start_subject_id: 0,
                        start_subject_index: 0,
                        end_subject_id: 0,
                        end_subject_index: 0,
                        control_points,
                        raw_trailing: vec![0x1a, 0, 0, 0, 0, 0], // 한컴 호환 패딩
                    })
                } else {
                    None
                };
                ShapeObject::Line(LineShape {
                    common,
                    drawing,
                    start: crate::model::Point { x: sx, y: sy },
                    end: crate::model::Point { x: ex, y: ey },
                    started_right_or_bottom: if is_connector {
                        false
                    } else {
                        line_flip_x || line_flip_y
                    },
                    connector,
                })
            }
            "ellipse" => ShapeObject::Ellipse(EllipseShape {
                common,
                drawing,
                attr: 0,
                center: crate::model::Point {
                    x: w_i / 2,
                    y: h_i / 2,
                },
                axis1: crate::model::Point { x: w_i, y: h_i / 2 },
                axis2: crate::model::Point { x: w_i / 2, y: h_i },
                start1: crate::model::Point { x: w_i, y: h_i / 2 },
                end1: crate::model::Point { x: w_i, y: h_i / 2 },
                start2: crate::model::Point { x: w_i, y: h_i / 2 },
                end2: crate::model::Point { x: w_i, y: h_i / 2 },
            }),
            "polygon" => {
                let points = if !polygon_points.is_empty() {
                    polygon_points.to_vec()
                } else {
                    // 기본 삼각형 (bbox 내접)
                    vec![
                        crate::model::Point { x: w_i / 2, y: 0 },
                        crate::model::Point { x: w_i, y: h_i },
                        crate::model::Point { x: 0, y: h_i },
                    ]
                };
                ShapeObject::Polygon(PolygonShape {
                    common,
                    drawing,
                    points,
                    raw_trailing: Vec::new(),
                })
            }
            "arc" => {
                // 사각형에 내접하는 타원의 1/4 호 (우상 사분면)
                // center: bbox 중심, axis1: 우측 중앙, axis2: 상단 중앙
                ShapeObject::Arc(ArcShape {
                    common,
                    drawing,
                    arc_type: 0, // 0=Arc
                    center: crate::model::Point {
                        x: w_i / 2,
                        y: h_i / 2,
                    },
                    axis1: crate::model::Point { x: w_i, y: h_i / 2 },
                    axis2: crate::model::Point { x: w_i / 2, y: 0 },
                })
            }
            _ => ShapeObject::Rectangle(RectangleShape {
                common,
                drawing,
                round_rate: 0,
                x_coords: [0, w_i, w_i, 0],
                y_coords: [0, 0, h_i, h_i],
            }),
        };

        // --- 기존 문단에 인라인 컨트롤로 삽입 ---
        self.document.sections[section_idx].raw_stream = None;

        let insert_para_idx = para_idx;
        let insert_ctrl_idx;
        {
            let paragraph = &mut self.document.sections[section_idx].paragraphs[para_idx];

            // 컨트롤 삽입 위치 결정 (char_offset 기준)
            let insert_idx = {
                let positions =
                    crate::document_core::helpers::find_control_text_positions(paragraph);
                let mut idx = paragraph.controls.len();
                for (i, &pos) in positions.iter().enumerate() {
                    if pos > char_offset {
                        idx = i;
                        break;
                    }
                }
                idx
            };

            // 컨트롤 추가
            // [#3214] controls 기준 인덱스를 ctrl_data_records 에 그대로 쓰기 전에 정렬한다.
            paragraph.align_ctrl_data_records();
            paragraph
                .controls
                .insert(insert_idx, Control::Shape(Box::new(shape_obj)));
            paragraph.ctrl_data_records.insert(insert_idx, None);

            // char_offsets: 컨트롤은 텍스트축 배열에 원소로 들어가지 않고 "8 code unit 갭"으로
            // 표현된다. insert_idx 는 controls 축 인덱스이므로, 이를 char_offsets(텍스트축,
            // 길이 = text.chars().count())에 원소로 끼워넣으면 배열이 1 늘어나 불변이 깨진다
            // (control_text_positions 등이 char_offsets[i]↔text char i 대응을 가정). 각주/수식
            // 삽입 경로처럼 텍스트 인덱스 기준으로 삽입 지점 이후만 +8 시프트한다.
            if !paragraph.char_offsets.is_empty() {
                let text_len = paragraph.text.chars().count();
                let safe_offset = char_offset.min(text_len);
                let insert_pos: u32 = if safe_offset < paragraph.char_offsets.len() {
                    paragraph.char_offsets[safe_offset]
                } else {
                    let last_idx = paragraph.char_offsets.len() - 1;
                    let last_w = paragraph
                        .text
                        .chars()
                        .nth(last_idx)
                        .map(|c| if (c as u32) > 0xFFFF { 2 } else { 1 })
                        .unwrap_or(1);
                    paragraph.char_offsets[last_idx] + last_w
                };
                for co in paragraph.char_offsets[safe_offset..].iter_mut() {
                    *co += 8;
                }
                for cs in &mut paragraph.char_shapes {
                    if cs.start_pos > insert_pos || (cs.start_pos == insert_pos && cs.start_pos > 0)
                    {
                        cs.start_pos += 8;
                    }
                }
                for rt in &mut paragraph.range_tags {
                    if rt.start >= insert_pos {
                        rt.start += 8;
                    }
                    if rt.end >= insert_pos {
                        rt.end += 8;
                    }
                }
            }

            // char_count 갱신 (확장 컨트롤 = 8 code units)
            paragraph.char_count += 8;

            // control_mask에 GSO 비트 설정
            paragraph.control_mask |= 0x00000800;
            // has_para_text 보장
            paragraph.has_para_text = true;
            insert_ctrl_idx = insert_idx;
        }

        // 리플로우 + 페이지네이션
        self.recompose_section(section_idx);
        self.paginate_if_needed();

        self.event_log.push(DocumentEvent::PictureInserted {
            section: section_idx,
            para: insert_para_idx,
        });
        Ok(crate::document_core::helpers::json_ok_with(&format!(
            "\"paraIdx\":{},\"controlIdx\":{}",
            insert_para_idx, insert_ctrl_idx
        )))
    }
    /// 글상자(Shape) z-order 변경 (네이티브).
    /// operation: "front" | "back" | "forward" | "backward"
    pub fn change_shape_z_order_native(
        &mut self,
        section_idx: usize,
        para_idx: usize,
        control_idx: usize,
        operation: &str,
    ) -> Result<String, HwpError> {
        let section = self.document.sections.get(section_idx).ok_or_else(|| {
            HwpError::RenderError(format!("구역 인덱스 {} 범위 초과", section_idx))
        })?;

        // 구역 내 모든 Shape의 (z_order, para_idx, ctrl_idx) 수집
        let mut shape_infos: Vec<(i32, usize, usize)> = Vec::new();
        for (pi, para) in section.paragraphs.iter().enumerate() {
            for (ci, ctrl) in para.controls.iter().enumerate() {
                if let Control::Shape(shape) = ctrl {
                    shape_infos.push((shape.z_order(), pi, ci));
                }
            }
        }

        // (z_order, para_idx, ctrl_idx) 기준 정렬 — 렌더링 순서와 동일
        shape_infos.sort();

        let target_pos = shape_infos
            .iter()
            .position(|&(_, pi, ci)| pi == para_idx && ci == control_idx)
            .ok_or_else(|| HwpError::RenderError("대상 Shape를 찾을 수 없습니다".to_string()))?;
        let current_z = shape_infos[target_pos].0;
        let last_pos = shape_infos.len() - 1;

        // (대상 새 z_order, 이웃 변경 정보 Option<(para_idx, ctrl_idx, 새 z_order)>)
        let changes: Option<(i32, Option<(usize, usize, i32)>)> = match operation {
            "front" => {
                if target_pos == last_pos {
                    None // 이미 맨 앞
                } else {
                    let max_z = shape_infos[last_pos].0;
                    Some((max_z + 1, None))
                }
            }
            "back" => {
                if target_pos == 0 {
                    None // 이미 맨 뒤
                } else {
                    let min_z = shape_infos[0].0;
                    Some((min_z - 1, None))
                }
            }
            "forward" => {
                if target_pos >= last_pos {
                    None // 이미 맨 앞
                } else {
                    let neighbor = shape_infos[target_pos + 1];
                    if current_z == neighbor.0 {
                        // 같은 z_order — 대상만 +1하여 이웃 위로 이동
                        Some((current_z + 1, None))
                    } else {
                        // 다른 z_order — 이웃과 z_order 교환
                        Some((neighbor.0, Some((neighbor.1, neighbor.2, current_z))))
                    }
                }
            }
            "backward" => {
                if target_pos == 0 {
                    None // 이미 맨 뒤
                } else {
                    let neighbor = shape_infos[target_pos - 1];
                    if current_z == neighbor.0 {
                        // 같은 z_order — 대상만 -1하여 이웃 아래로 이동
                        Some((current_z - 1, None))
                    } else {
                        // 다른 z_order — 이웃과 z_order 교환
                        Some((neighbor.0, Some((neighbor.1, neighbor.2, current_z))))
                    }
                }
            }
            _ => {
                return Err(HwpError::RenderError(format!(
                    "알 수 없는 operation: {}",
                    operation
                )))
            }
        };

        let (new_z, neighbor_change) = match changes {
            Some(c) => c,
            None => {
                return Ok(crate::document_core::helpers::json_ok_with(&format!(
                    "\"zOrder\":{}",
                    current_z
                )))
            }
        };

        // [#5769 후속] 자기기술 변경 레코드 — SetZOrderCommand 가 이대로 소비해 undo/redo
        // 의 절대 대입 쌍으로 쓴다. 교환인 경우 이웃의 이전 값은 new_z 와 같다(둘의 z 를
        // 맞바꾼 것). 기존 소비자는 zOrder 키만 읽으므로 추가 필드는 안전하다.
        let mut moves_json = format!(
            "{{\"ppi\":{},\"ci\":{},\"before\":{},\"after\":{}}}",
            para_idx, control_idx, current_z, new_z
        );
        if let Some((n_pi, n_ci, n_z)) = neighbor_change {
            moves_json.push_str(&format!(
                ",{{\"ppi\":{},\"ci\":{},\"before\":{},\"after\":{}}}",
                n_pi, n_ci, new_z, n_z
            ));
        }

        // z_order 변경: 대상 + 이웃
        {
            let section = &mut self.document.sections[section_idx];
            if let Control::Shape(shape) = &mut section.paragraphs[para_idx].controls[control_idx] {
                shape.common_mut().z_order = new_z;
            }
            if let Some((n_pi, n_ci, n_z)) = neighbor_change {
                if let Control::Shape(shape) = &mut section.paragraphs[n_pi].controls[n_ci] {
                    shape.common_mut().z_order = n_z;
                }
            }
        }

        self.document.sections[section_idx].raw_stream = None;
        self.recompose_section(section_idx);
        self.paginate_if_needed();

        Ok(crate::document_core::helpers::json_ok_with(&format!(
            "\"zOrder\":{},\"moves\":[{}]",
            new_z, moves_json
        )))
    }

    /// [#5769 후속] z 순서 절대 대입 — `SetZOrderCommand` 의 undo/redo 가 쓴다.
    ///
    /// pairs_json: `[{"ppi":N,"ci":N,"z":N},...]`. 상대 연산(front/forward/…)과 달리 값
    /// 자체를 복원하므로 [`Self::change_shape_z_order_native`] 이 남긴 `moves` 를 뒤집어
    /// 넣으면 정확한 역연산이다 — Shape z 대입에는 대입 외 부작용이 없다(#5769 선결 규약).
    /// 적용 후 passthrough 무효화·파생 상태 재구성 후처리는 상대 연산과 동일하다. 하나라도
    /// 검증에 어긋나면 아무것도 적용하지 않고 거절한다 — 부분 적용은 undo 도중의 문서 오염이다.
    pub fn apply_shape_z_order_pairs_native(
        &mut self,
        section_idx: usize,
        pairs_json: &str,
    ) -> Result<String, HwpError> {
        let pairs: Vec<serde_json::Value> = serde_json::from_str(pairs_json)
            .map_err(|e| HwpError::RenderError(format!("pairs JSON 파싱 실패: {}", e)))?;
        if pairs.is_empty() {
            return Ok(crate::document_core::helpers::json_ok_with("\"applied\":0"));
        }

        // 1차 — 전수 검증. 지목이 Shape 가 아니면 기록 이후 문서가 바뀐 것이므로 실패다.
        {
            let section = self.document.sections.get(section_idx).ok_or_else(|| {
                HwpError::RenderError(format!("구역 인덱스 {} 범위 초과", section_idx))
            })?;
            for pair in &pairs {
                let err = |what: &str| HwpError::RenderError(format!("pairs 항목 {} 누락", what));
                let pi = pair["ppi"].as_u64().ok_or_else(|| err("ppi"))? as usize;
                let ci = pair["ci"].as_u64().ok_or_else(|| err("ci"))? as usize;
                if pair["z"].as_i64().is_none() {
                    return Err(err("z"));
                }
                let para = section.paragraphs.get(pi).ok_or_else(|| {
                    HwpError::RenderError(format!("문단 인덱스 {} 범위 초과", pi))
                })?;
                match para.controls.get(ci) {
                    Some(Control::Shape(_)) => {}
                    _ => {
                        return Err(HwpError::RenderError(format!(
                            "지목 (ppi={}, ci={}) 은 Shape 가 아니다 — 기록 이후 문서가 바뀌었다",
                            pi, ci
                        )))
                    }
                }
            }
        }

        // 2차 — 적용.
        let applied = {
            let section = &mut self.document.sections[section_idx];
            let mut applied = 0usize;
            for pair in &pairs {
                let pi = pair["ppi"].as_u64().expect("1차에서 검증됨") as usize;
                let ci = pair["ci"].as_u64().expect("1차에서 검증됨") as usize;
                let z = pair["z"].as_i64().expect("1차에서 검증됨") as i32;
                if let Some(Control::Shape(shape)) = section.paragraphs[pi].controls.get_mut(ci) {
                    shape.common_mut().z_order = z;
                    applied += 1;
                }
            }
            applied
        };

        self.document.sections[section_idx].raw_stream = None;
        self.recompose_section(section_idx);
        self.paginate_if_needed();

        Ok(crate::document_core::helpers::json_ok_with(&format!(
            "\"applied\":{}",
            applied
        )))
    }
    /// 도형 내부 좌표만 스케일 (common/shape_attr은 변경하지 않음)
    fn scale_shape_coords(child: &mut crate::model::shape::ShapeObject, sx: f64, sy: f64) {
        use crate::model::shape::ShapeObject as SO;
        fn sp(v: i32, s: f64) -> i32 {
            (v as f64 * s).round() as i32
        }
        match child {
            SO::Line(ref mut s) => {
                s.start.x = sp(s.start.x, sx);
                s.start.y = sp(s.start.y, sy);
                s.end.x = sp(s.end.x, sx);
                s.end.y = sp(s.end.y, sy);
            }
            SO::Rectangle(ref mut s) => {
                let w = s.common.width as i32;
                let h = s.common.height as i32;
                s.x_coords = [0, w, w, 0];
                s.y_coords = [0, 0, h, h];
            }
            SO::Ellipse(ref mut s) => {
                s.center.x = sp(s.center.x, sx);
                s.center.y = sp(s.center.y, sy);
                s.axis1.x = sp(s.axis1.x, sx);
                s.axis1.y = sp(s.axis1.y, sy);
                s.axis2.x = sp(s.axis2.x, sx);
                s.axis2.y = sp(s.axis2.y, sy);
                s.start1.x = sp(s.start1.x, sx);
                s.start1.y = sp(s.start1.y, sy);
                s.end1.x = sp(s.end1.x, sx);
                s.end1.y = sp(s.end1.y, sy);
                s.start2.x = sp(s.start2.x, sx);
                s.start2.y = sp(s.start2.y, sy);
                s.end2.x = sp(s.end2.x, sx);
                s.end2.y = sp(s.end2.y, sy);
            }
            SO::Arc(ref mut s) => {
                s.center.x = sp(s.center.x, sx);
                s.center.y = sp(s.center.y, sy);
                s.axis1.x = sp(s.axis1.x, sx);
                s.axis1.y = sp(s.axis1.y, sy);
                s.axis2.x = sp(s.axis2.x, sx);
                s.axis2.y = sp(s.axis2.y, sy);
            }
            SO::Polygon(ref mut s) => {
                for p in &mut s.points {
                    p.x = sp(p.x, sx);
                    p.y = sp(p.y, sy);
                }
            }
            SO::Curve(ref mut s) => {
                for p in &mut s.points {
                    p.x = sp(p.x, sx);
                    p.y = sp(p.y, sy);
                }
            }
            _ => {}
        }
    }
    /// 그룹 자식 개체들을 비례 스케일 (크기/위치/도형좌표 포함)
    fn scale_group_children(children: &mut [crate::model::shape::ShapeObject], sx: f64, sy: f64) {
        use crate::model::shape::ShapeObject as SO;
        fn sp(v: i32, s: f64) -> i32 {
            (v as f64 * s).round() as i32
        }

        for child in children.iter_mut() {
            // CommonObjAttr 스케일
            let c = child.common_mut();
            c.horizontal_offset = (c.horizontal_offset as f64 * sx) as u32;
            c.vertical_offset = (c.vertical_offset as f64 * sy) as u32;
            c.width = ((c.width as f64 * sx).round().max(1.0)) as u32;
            c.height = ((c.height as f64 * sy).round().max(1.0)) as u32;
            let new_horz = c.horizontal_offset;
            let new_vert = c.vertical_offset;
            let new_cw = c.width;
            let new_ch = c.height;

            // 도형별 좌표 스케일
            match child {
                SO::Line(ref mut s) => {
                    s.start.x = sp(s.start.x, sx);
                    s.start.y = sp(s.start.y, sy);
                    s.end.x = sp(s.end.x, sx);
                    s.end.y = sp(s.end.y, sy);
                }
                SO::Rectangle(ref mut s) => {
                    let w = new_cw as i32;
                    let h = new_ch as i32;
                    s.x_coords = [0, w, w, 0];
                    s.y_coords = [0, 0, h, h];
                }
                SO::Ellipse(ref mut s) => {
                    s.center.x = sp(s.center.x, sx);
                    s.center.y = sp(s.center.y, sy);
                    s.axis1.x = sp(s.axis1.x, sx);
                    s.axis1.y = sp(s.axis1.y, sy);
                    s.axis2.x = sp(s.axis2.x, sx);
                    s.axis2.y = sp(s.axis2.y, sy);
                    s.start1.x = sp(s.start1.x, sx);
                    s.start1.y = sp(s.start1.y, sy);
                    s.end1.x = sp(s.end1.x, sx);
                    s.end1.y = sp(s.end1.y, sy);
                    s.start2.x = sp(s.start2.x, sx);
                    s.start2.y = sp(s.start2.y, sy);
                    s.end2.x = sp(s.end2.x, sx);
                    s.end2.y = sp(s.end2.y, sy);
                }
                SO::Arc(ref mut s) => {
                    s.center.x = sp(s.center.x, sx);
                    s.center.y = sp(s.center.y, sy);
                    s.axis1.x = sp(s.axis1.x, sx);
                    s.axis1.y = sp(s.axis1.y, sy);
                    s.axis2.x = sp(s.axis2.x, sx);
                    s.axis2.y = sp(s.axis2.y, sy);
                }
                SO::Polygon(ref mut s) => {
                    for p in &mut s.points {
                        p.x = sp(p.x, sx);
                        p.y = sp(p.y, sy);
                    }
                }
                SO::Curve(ref mut s) => {
                    for p in &mut s.points {
                        p.x = sp(p.x, sx);
                        p.y = sp(p.y, sy);
                    }
                }
                SO::Group(ref mut g) => {
                    g.shape_attr.current_width = new_cw;
                    g.shape_attr.original_width = new_cw;
                    g.shape_attr.current_height = new_ch;
                    g.shape_attr.original_height = new_ch;
                    Self::scale_group_children(&mut g.children, sx, sy);
                }
                SO::Picture(_) => {} // 그림은 크기만 변경
                SO::Chart(_) => {}   // 차트: 크기만 변경, 내부 좌표 스케일 없음 (Task #195 단계 2)
                SO::Ole(_) => {}     // OLE: 크기만 변경
            }

            // shape_attr 동기화
            let sa = match child {
                SO::Line(s) => &mut s.drawing.shape_attr,
                SO::Rectangle(s) => &mut s.drawing.shape_attr,
                SO::Ellipse(s) => &mut s.drawing.shape_attr,
                SO::Arc(s) => &mut s.drawing.shape_attr,
                SO::Polygon(s) => &mut s.drawing.shape_attr,
                SO::Curve(s) => &mut s.drawing.shape_attr,
                SO::Group(g) => &mut g.shape_attr,
                SO::Picture(p) => &mut p.shape_attr,
                SO::Chart(c) => &mut c.drawing.shape_attr,
                SO::Ole(o) => &mut o.drawing.shape_attr,
            };
            sa.offset_x = new_horz as i32;
            sa.offset_y = new_vert as i32;
            sa.current_width = new_cw;
            sa.original_width = new_cw;
            sa.current_height = new_ch;
            sa.original_height = new_ch;
            sa.render_tx = new_horz as f64;
            sa.render_ty = new_vert as f64;
            sa.raw_rendering = Vec::new();
        }
    }
    /// 구역 내 모든 Shape의 z_order 최대값을 반환 (새 Shape 생성 시 사용)
    fn max_shape_z_order_in_section(&self, section_idx: usize) -> i32 {
        self.document
            .sections
            .get(section_idx)
            .map(|section| {
                section
                    .paragraphs
                    .iter()
                    .flat_map(|p| p.controls.iter())
                    .filter_map(|ctrl| {
                        if let Control::Shape(shape) = ctrl {
                            Some(shape.z_order())
                        } else {
                            None
                        }
                    })
                    .max()
                    .unwrap_or(-1)
            })
            .unwrap_or(-1)
    }

    // ─── 개체 묶기/풀기 API ──────────────────────────────
    /// 선택된 개체들을 GroupShape로 묶는다.
    /// targets: [(para_idx, control_idx), ...] — 같은 구역 내 Shape 또는 Picture
    /// 반환: JSON `{"ok":true, "paraIdx":N, "controlIdx":N}`
    pub fn group_shapes_native(
        &mut self,
        section_idx: usize,
        targets: &[(usize, usize)],
    ) -> Result<String, HwpError> {
        use crate::model::control::Control;
        use crate::model::shape::*;

        if targets.len() < 2 {
            return Err(HwpError::RenderError(
                "묶기 위해서는 2개 이상의 개체가 필요합니다".to_string(),
            ));
        }
        // Removing the same index twice removes an unrelated neighbour on the
        // second pass. Reject duplicate targets before touching the document.
        let mut unique_targets = std::collections::HashSet::with_capacity(targets.len());
        if targets.iter().any(|target| !unique_targets.insert(*target)) {
            return Err(HwpError::RenderError(
                "같은 개체를 중복해서 묶을 수 없습니다".to_string(),
            ));
        }
        if section_idx >= self.document.sections.len() {
            return Err(HwpError::RenderError(format!(
                "구역 인덱스 {} 범위 초과",
                section_idx
            )));
        }

        // 1) 대상 개체들을 ShapeObject로 수집 (인덱스 유효성 검사 포함)
        let section = &self.document.sections[section_idx];
        let mut children: Vec<ShapeObject> = Vec::new();
        let mut group_min_x: i32 = i32::MAX;
        let mut group_min_y: i32 = i32::MAX;
        let mut group_max_x: i32 = i32::MIN;
        let mut group_max_y: i32 = i32::MIN;
        let mut first_common: Option<CommonObjAttr> = None;

        for &(pi, ci) in targets {
            if pi >= section.paragraphs.len() {
                return Err(HwpError::RenderError(format!(
                    "문단 인덱스 {} 범위 초과",
                    pi
                )));
            }
            if ci >= section.paragraphs[pi].controls.len() {
                return Err(HwpError::RenderError(format!(
                    "컨트롤 인덱스 {} 범위 초과 (문단 {})",
                    ci, pi
                )));
            }
            let ctrl = &section.paragraphs[pi].controls[ci];
            let (common, shape_obj) = match ctrl {
                Control::Shape(s) => {
                    let c = s.common().clone();
                    (c, (**s).clone())
                }
                Control::Picture(p) => {
                    let c = p.common.clone();
                    (c, ShapeObject::Picture(p.clone()))
                }
                _ => {
                    return Err(HwpError::RenderError(format!(
                        "컨트롤 ({},{})은 Shape/Picture가 아닙니다",
                        pi, ci
                    )))
                }
            };

            // 합산 bbox 계산 (HWPUNIT 기준 — horizontal_offset, vertical_offset, width, height)
            let x1 = common.horizontal_offset as i32;
            let y1 = common.vertical_offset as i32;
            let x2 = x1 + common.width as i32;
            let y2 = y1 + common.height as i32;
            group_min_x = group_min_x.min(x1);
            group_min_y = group_min_y.min(y1);
            group_max_x = group_max_x.max(x2);
            group_max_y = group_max_y.max(y2);

            if first_common.is_none() {
                first_common = Some(common);
            }
            children.push(shape_obj);
        }

        let group_w = (group_max_x - group_min_x).max(1) as u32;
        let group_h = (group_max_y - group_min_y).max(1) as u32;
        let fc = first_common.unwrap();

        // 2) 자식 개체의 offset/render 좌표를 그룹 로컬 좌표로 변환
        for child in &mut children {
            let displayed_width = child.common().width;
            let displayed_height = child.common().height;
            // 그룹 내 로컬 좌표 계산
            let new_horz = ((child.common().horizontal_offset as i32 - group_min_x).max(0)) as u32;
            let new_vert = ((child.common().vertical_offset as i32 - group_min_y).max(0)) as u32;
            child.common_mut().horizontal_offset = new_horz;
            child.common_mut().vertical_offset = new_vert;

            // shape_attr: 렌더링에 사용되는 render_tx/ty와 offset_x/y 설정
            let sa = match child {
                ShapeObject::Line(s) => &mut s.drawing.shape_attr,
                ShapeObject::Rectangle(s) => &mut s.drawing.shape_attr,
                ShapeObject::Ellipse(s) => &mut s.drawing.shape_attr,
                ShapeObject::Arc(s) => &mut s.drawing.shape_attr,
                ShapeObject::Polygon(s) => &mut s.drawing.shape_attr,
                ShapeObject::Curve(s) => &mut s.drawing.shape_attr,
                ShapeObject::Group(g) => &mut g.shape_attr,
                ShapeObject::Picture(p) => &mut p.shape_attr,
                ShapeObject::Chart(c) => &mut c.drawing.shape_attr,
                ShapeObject::Ole(o) => &mut o.drawing.shape_attr,
            };
            sa.offset_x = new_horz as i32;
            sa.offset_y = new_vert as i32;
            sa.group_level = 1;
            sa.is_two_ctrl_id = false; // 그룹 자식은 ctrl_id 1번만
            sa.raw_rendering = Vec::new(); // 새로 생성 (직렬화 시 재계산)
                                           // 렌더러가 사용하는 변환 행렬 값 설정
            sa.render_tx = new_horz as f64;
            sa.render_ty = new_vert as f64;
            // Group rendering uses original dimensions times this matrix.
            // A resized picture's current box is not its original image size.
            sa.render_sx = if sa.original_width > 0 {
                displayed_width as f64 / sa.original_width as f64
            } else { 1.0 };
            sa.render_sy = if sa.original_height > 0 {
                displayed_height as f64 / sa.original_height as f64
            } else { 1.0 };
            sa.render_b = 0.0;
            sa.render_c = 0.0;
            // HWPX's renderingInfo writer preserves raw matrices and otherwise
            // emits identity. Store the new local transform for both formats.
            let identity = [1.0_f64, 0.0, 0.0, 0.0, 1.0, 0.0];
            sa.raw_rendering.extend_from_slice(&2_u16.to_le_bytes());
            for matrix in [
                [1.0, 0.0, sa.render_tx, 0.0, 1.0, sa.render_ty],
                [sa.render_sx, 0.0, 0.0, 0.0, sa.render_sy, 0.0],
                identity, identity, identity,
            ] {
                for value in matrix {
                    sa.raw_rendering.extend_from_slice(&value.to_le_bytes());
                }
            }
        }

        // 3) GroupShape 조립
        let new_z_order = self.max_shape_z_order_in_section(section_idx) + 1;
        let group = GroupShape {
            common: CommonObjAttr {
                ctrl_id: 0x24636f6e, // '$con' — 그룹 컨테이너
                attr: fc.attr,
                vertical_offset: group_min_y as u32,
                horizontal_offset: group_min_x as u32,
                width: group_w,
                height: group_h,
                z_order: new_z_order,
                margin: fc.margin.clone(),
                treat_as_char: fc.treat_as_char,
                vert_rel_to: fc.vert_rel_to,
                vert_align: fc.vert_align,
                horz_rel_to: fc.horz_rel_to,
                horz_align: fc.horz_align,
                text_wrap: fc.text_wrap,
                description: "묶음 개체입니다.".to_string(),
                ..Default::default()
            },
            shape_attr: ShapeComponentAttr {
                ctrl_id: 0x24636f6e, // '$con'
                is_two_ctrl_id: true,
                original_width: group_w,
                original_height: group_h,
                current_width: group_w,
                current_height: group_h,
                local_file_version: 1,
                flip: 0x00080000,
                rotation_center: crate::model::Point {
                    x: (group_w / 2) as i32,
                    y: (group_h / 2) as i32,
                },
                ..Default::default()
            },
            children,
            caption: None,
        };

        let group_obj = ShapeObject::Group(group);

        // 4) 원래 개체들을 문단에서 제거 (큰 인덱스부터 제거해야 인덱스 밀림 방지)
        let mut sorted_targets: Vec<(usize, usize)> = targets.to_vec();
        sorted_targets.sort_by(|a, b| b.cmp(a)); // 역순 정렬

        // 첫 번째 삽입 위치 (원래 개체 중 가장 앞에 있는 것)
        let insert_target = *targets.iter().min().unwrap();

        for &(pi, ci) in &sorted_targets {
            let para = &mut self.document.sections[section_idx].paragraphs[pi];

            // char_offsets 조정
            let text_chars: Vec<char> = para.text.chars().collect();
            let mut ctrl_ci = 0usize;
            let mut prev_end: u32 = 0;
            let mut gap_start: Option<u32> = None;
            'outer: for i in 0..text_chars.len() {
                let offset = if i < para.char_offsets.len() {
                    para.char_offsets[i]
                } else {
                    prev_end
                };
                while prev_end + 8 <= offset && ctrl_ci < para.controls.len() {
                    if ctrl_ci == ci {
                        gap_start = Some(prev_end);
                        break 'outer;
                    }
                    ctrl_ci += 1;
                    prev_end += 8;
                }
                let char_size: u32 = if text_chars[i] == '\t' {
                    8
                } else if text_chars[i].len_utf16() == 2 {
                    2
                } else {
                    1
                };
                prev_end = offset + char_size;
            }
            if gap_start.is_none() {
                while ctrl_ci < para.controls.len() {
                    if ctrl_ci == ci {
                        gap_start = Some(prev_end);
                        break;
                    }
                    ctrl_ci += 1;
                    prev_end += 8;
                }
            }
            if let Some(gs) = gap_start {
                let threshold = gs + 8;
                for offset in para.char_offsets.iter_mut() {
                    if *offset >= threshold {
                        *offset -= 8;
                    }
                }
            }

            para.controls.remove(ci);
            if ci < para.ctrl_data_records.len() {
                para.ctrl_data_records.remove(ci);
            }
            if para.char_count >= 8 {
                para.char_count -= 8;
            }
        }

        // 5) 삽입 위치 인덱스 재계산 (제거 후 인덱스가 변했을 수 있음)
        //    insert_target의 para에서 그보다 앞에서 제거된 개체 수만큼 보정
        let (insert_pi, insert_ci_orig) = insert_target;
        let removed_before = sorted_targets
            .iter()
            .filter(|&&(pi, ci)| pi == insert_pi && ci < insert_ci_orig)
            .count();
        let insert_ci = insert_ci_orig - removed_before;

        // 6) GroupShape를 문단에 삽입
        {
            let para = &mut self.document.sections[section_idx].paragraphs[insert_pi];

            // controls/ctrl_data_records 삽입 (범위 보정)
            let ctrl_insert = insert_ci.min(para.controls.len());

            // char_offsets 시프트 지점(텍스트축 char-index)을 컨트롤 삽입 *이전* 상태에서
            // 계산한다. create_shape_control_native(#1904 shape.rs:1519-1556)와 동일한
            // 규약: 삽입 지점 이전 char_offsets 는 그대로 두고, 그 지점 이후만 +8 시프트
            // 해야 한다. 버그: 기존 코드는 이 계산 없이 para.char_offsets 전체를 +8 했기
            // 때문에, 그룹 대상보다 앞서 문단에 남아있는 다른 컨트롤(그룹에 포함되지 않은
            // Shape/Picture 등)의 char_offsets 항목까지 밀려 텍스트-컨트롤 오프셋 매핑이
            // 깨졌다(커서 이동/컨트롤 조회 시 위치 오탐).
            let text_positions = crate::document_core::helpers::find_control_text_positions(para);
            let text_len = para.text.chars().count();
            let safe_offset = text_positions.get(ctrl_insert).copied().unwrap_or(text_len);

            para.controls
                .insert(ctrl_insert, Control::Shape(Box::new(group_obj)));
            let cdr_insert = ctrl_insert.min(para.ctrl_data_records.len());
            para.ctrl_data_records.insert(cdr_insert, None);

            // char_offsets: 텍스트 문자 매핑이므로 컨트롤 인덱스와 무관 — 삽입 지점(safe_offset)
            // 이후 char_offsets 만 +8 시프트한다.
            if !para.char_offsets.is_empty() {
                let shift_from = safe_offset.min(para.char_offsets.len());
                for co in para.char_offsets[shift_from..].iter_mut() {
                    *co += 8;
                }
            }
            para.char_count += 8;
            para.control_mask |= 0x00000800;
            para.has_para_text = true;
        }

        // 7) 리플로우 + 페이지네이션
        self.document.sections[section_idx].raw_stream = None;
        self.recompose_section(section_idx);
        self.paginate_if_needed();

        self.event_log.push(DocumentEvent::PictureInserted {
            section: section_idx,
            para: insert_pi,
        });
        Ok(crate::document_core::helpers::json_ok_with(&format!(
            "\"paraIdx\":{},\"controlIdx\":{}",
            insert_pi, insert_ci
        )))
    }
    /// GroupShape를 풀어 자식 개체들을 개별 Shape/Picture로 복원한다.
    /// 스펙: 한 단계만 풀기 (중첩 그룹은 유지), 자식 cnt 1 감소
    pub fn ungroup_shape_native(
        &mut self,
        section_idx: usize,
        para_idx: usize,
        control_idx: usize,
    ) -> Result<String, HwpError> {
        use crate::model::control::Control;
        use crate::model::shape::*;

        if section_idx >= self.document.sections.len() {
            return Err(HwpError::RenderError(format!(
                "구역 인덱스 {} 범위 초과",
                section_idx
            )));
        }
        let section = &mut self.document.sections[section_idx];
        if para_idx >= section.paragraphs.len() {
            return Err(HwpError::RenderError(format!(
                "문단 인덱스 {} 범위 초과",
                para_idx
            )));
        }
        let para = &mut section.paragraphs[para_idx];
        if control_idx >= para.controls.len() {
            return Err(HwpError::RenderError(format!(
                "컨트롤 인덱스 {} 범위 초과",
                control_idx
            )));
        }

        // GroupShape 추출
        match &para.controls[control_idx] {
            Control::Shape(s) => match s.as_ref() {
                ShapeObject::Group(_) => {}
                _ => {
                    return Err(HwpError::RenderError(
                        "지정된 컨트롤이 GroupShape이 아닙니다".to_string(),
                    ))
                }
            },
            _ => {
                return Err(HwpError::RenderError(
                    "지정된 컨트롤이 Shape이 아닙니다".to_string(),
                ))
            }
        };
        // The normalization below only preserves axis-aligned positive picture
        // scales. It discards composed rotation/reflection, and the standalone
        // paragraph exclusion cannot yet preserve that group's page flow.
        // Reject before removing any controls rather than silently losing the
        // picture orientation and collapsing the saved document's pages.
        fn has_oriented_child(shape: &ShapeObject) -> bool {
            let sa = shape.shape_attr();
            sa.rotation_angle != 0
                || sa.horz_flip
                || sa.vert_flip
                || sa.render_b.abs() > 1e-8
                || sa.render_c.abs() > 1e-8
                || sa.render_sx < 0.0
                || sa.render_sy < 0.0
                || matches!(shape, ShapeObject::Group(g) if g.children.iter().any(has_oriented_child))
        }
        // Stored hosts need an exact, unambiguous mapping of every extended
        // control slot. Do not infer starts from malformed/partial offset gaps.
        fn stored_control_starts(para: &crate::model::paragraph::Paragraph) -> Option<Vec<u32>> {
            if para.char_offsets.len() != para.text.chars().count()
                || para.controls.iter().any(|c| !c.occupies_ctrl_char_slot()) {
                return None;
            }
            let mut starts = Vec::with_capacity(para.controls.len());
            let mut end = 0u32;
            for (ch, &offset) in para.text.chars().zip(&para.char_offsets) {
                let gap = offset.checked_sub(end)?;
                if gap % 8 != 0 || (gap / 8) as usize > para.controls.len() - starts.len() {
                    return None;
                }
                for _ in 0..gap / 8 {
                    starts.push(end);
                    end = end.checked_add(8)?;
                }
                end = offset.checked_add(ch.len_utf16() as u32)?;
            }
            while starts.len() < para.controls.len() {
                starts.push(end);
                end = end.checked_add(8)?;
            }
            (end.checked_add(1)? == para.char_count).then_some(starts)
        }
        let stored_starts = stored_control_starts(para);
        // A single authentic row starting at zero owns the entire paragraph,
        // including its floating controls and visible text. Expanding one
        // extended-control slot changes stream positions, not that partition
        // or the saved physical row. Other stored partitions remain guarded.
        let stored_body_host = para.line_segs.len() == 1
            && para.line_segs[0].text_start == 0
            && para.line_segs[0].line_height > 0
            && para.line_segs[0].text_height > 0
            && para.line_segs[0].baseline_distance >= 0
            && para.line_segs[0].baseline_distance <= para.line_segs[0].line_height
            && para.line_segs[0].segment_width > 0
            && para.line_segs[0].tag & crate::model::paragraph::LineSeg::TAG_IMPLEMENTATION_PROPERTY == 0
            && para.layout_only_fill_lines == 0
            && !para.stored_text_partition_is_dirty()
            && para.char_offsets.len() == para.text.chars().count()
            && !para.text.chars().any(|ch| ch.is_control() || ch == '\u{fffc}')
            && para.field_ranges.is_empty()
            && para.orphan_field_ends.is_empty()
            && para.title_marks.is_empty()
            // Generic range tags are not represented by the HWPX writer yet.
            // Keep these imported hosts guarded instead of widening a path
            // whose two-format preservation cannot be demonstrated.
            && para.range_tags.is_empty()
            && para.ctrl_data_records.get(control_idx).map_or(true, Option::is_none)
            && stored_starts.is_some()
            && para.controls.iter().enumerate().all(|(index, control)| {
                index == control_idx || match control {
                    Control::SectionDef(_) | Control::ColumnDef(_) => true,
                    Control::Picture(p) => !p.common.treat_as_char && p.caption.is_none(),
                    _ => false,
                }
            });
        // Keep the common AABB as the flow frame, the current size as pixels,
        // and all stream-indexed metadata in sync without dropping saved rows.
        let oriented_picture_group = match &para.controls[control_idx] {
            Control::Shape(shape) => match shape.as_ref() {
                ShapeObject::Group(g) if has_oriented_child(shape)
                    && (para.line_segs.is_empty() || stored_body_host)
                    && crate::renderer::float_placement::supports_picture_group_exclusion(g)
                    => Some(g.clone()),
                _ => None,
            },
            _ => None,
        };
        if let Some(group) = oriented_picture_group {
            let mut pictures = Vec::new();
            for child in &group.children {
                let mut pic = match child {
                    ShapeObject::Picture(p) => p.clone(),
                    _ => unreachable!(),
                };
                let a = &pic.shape_attr;
                let sx = a.render_sx.hypot(a.render_c);
                let sy = a.render_b.hypot(a.render_sy);
                let angle = a.render_c.atan2(a.render_sx).to_degrees();
                // The standalone format records an integral angle, and has no
                // shear field. Refuse unrepresentable axes before mutation.
                let dot = a.render_sx*a.render_b + a.render_c*a.render_sy;
                if !sx.is_finite() || !sy.is_finite() || sx <= 0.0 || sy <= 0.0
                    || !angle.is_finite() || (angle-angle.round()).abs() > 1e-6
                    || dot.abs() > sx*sy*1e-6 {
                    return Err(HwpError::RenderError(
                        "이 묶음의 기울기 변환은 개별 그림으로 유지할 수 없습니다.".to_string()));
                }
                let w = (a.original_width as f64*sx).round().max(1.0);
                let h = (a.original_height as f64*sy).round().max(1.0);
                let (sin,cos) = angle.to_radians().sin_cos();
                let fw = (cos.abs()*w+sin.abs()*h).round().max(1.0);
                let fh = (sin.abs()*w+cos.abs()*h).round().max(1.0);
                let cx = a.render_sx*a.original_width as f64/2.0
                    +a.render_b*a.original_height as f64/2.0+a.render_tx;
                let cy = a.render_c*a.original_width as f64/2.0
                    +a.render_sy*a.original_height as f64/2.0+a.render_ty;
                let flip = a.render_sx*a.render_sy-a.render_b*a.render_c < 0.0;
                let description = pic.common.description.clone();
                pic.common = group.common.clone();
                pic.common.description = description;
                pic.common.width = fw as u32;
                pic.common.height = fh as u32;
                pic.common.horizontal_offset = (group.common.horizontal_offset as i32 as f64
                    +cx-fw/2.0).round() as i32 as u32;
                pic.common.vertical_offset = (group.common.vertical_offset as i32 as f64
                    +cy-fh/2.0).round() as i32 as u32;
                let a = &mut pic.shape_attr;
                a.rotation_angle = angle.round() as i16;
                a.horz_flip = false; a.vert_flip = flip;
                a.flip = (a.flip & !3) | (u32::from(flip)<<1);
                a.original_width = w as u32; a.current_width = w as u32;
                a.original_height = h as u32; a.current_height = h as u32;
                a.group_level = 0; a.offset_x = 0; a.offset_y = 0;
                a.render_sx = 1.0; a.render_sy = 1.0;
                a.render_b = 0.0; a.render_c = 0.0;
                a.render_tx = 0.0; a.render_ty = 0.0;
                a.raw_rendering.clear(); a.is_two_ctrl_id = true;
                // Normalize all four image rectangle points along with orgSz;
                // crop coordinates keep their original image reference.
                let xs = [pic.border_x[0],pic.border_x[2],pic.border_y[0],pic.border_y[2]];
                let ys = [pic.border_x[1],pic.border_x[3],pic.border_y[1],pic.border_y[3]];
                let rw = i64::from(*xs.iter().max().unwrap())-i64::from(*xs.iter().min().unwrap());
                let rh = i64::from(*ys.iter().max().unwrap())-i64::from(*ys.iter().min().unwrap());
                if rw > 0 && rh > 0 {
                    for points in [&mut pic.border_x,&mut pic.border_y] {
                        for (index,coordinate) in points.iter_mut().enumerate() {
                            let scale = if index%2 == 0 {w/rw as f64} else {h/rh as f64};
                            *coordinate = (*coordinate as f64*scale).round() as i32;
                        }
                    }
                }
                pictures.push(Control::Picture(pic));
            }
            let positions = if stored_body_host {
                stored_starts.unwrap()
            } else {
                para.control_utf16_positions()
            };
            let group_start = positions[control_idx];
            let insertion = group_start.checked_add(8).ok_or_else(||
                HwpError::RenderError("묶음의 문자 위치가 범위를 벗어났습니다.".to_string()))?;
            let count = pictures.len();
            let delta = u32::try_from(count - 1).ok().and_then(|n| n.checked_mul(8))
                .ok_or_else(|| HwpError::RenderError("묶음의 개체 수가 범위를 벗어났습니다.".to_string()))?;
            // Reject ambiguous or overflowing source coordinates before any
            // mutation. A style boundary inside the original control cannot
            // be assigned to the expanded children without inventing meaning.
            if para.char_shapes.iter().any(|cs| cs.start_pos > group_start && cs.start_pos < insertion)
                || para.range_tags.iter().any(|tag| [tag.start, tag.end].iter()
                    .any(|&pos| pos > group_start && pos < insertion))
                || para.char_count.checked_add(delta).is_none()
                || para.char_offsets.iter().any(|offset| offset.checked_add(delta).is_none())
                || para.char_shapes.iter().any(|cs| cs.start_pos.checked_add(delta).is_none())
                || para.range_tags.iter().any(|tag| tag.start.checked_add(delta).is_none()
                    || tag.end.checked_add(delta).is_none()) {
                return Err(HwpError::RenderError("묶음의 본문 범위를 안전하게 유지할 수 없습니다.".to_string()));
            }
            para.align_ctrl_data_records();
            para.controls.splice(control_idx..control_idx+1,pictures);
            para.ctrl_data_records.splice(control_idx..control_idx+1,(0..count).map(|_|None));
            para.char_count += delta;
            for offset in &mut para.char_offsets {
                if *offset >= insertion { *offset += delta; }
            }
            for style in &mut para.char_shapes {
                if style.start_pos >= insertion { style.start_pos += delta; }
            }
            for tag in &mut para.range_tags {
                if tag.start >= insertion { tag.start += delta; }
                if tag.end >= insertion { tag.end += delta; }
            }
            // No visible text or style assignment changed: preserve the valid
            // stored partition and clear only the derived width memo.
            para.invalidate_single_line_overflow_memo();
            para.control_mask |= 0x00000800;
            para.has_para_text = true;
            self.document.sections[section_idx].raw_stream = None;
            self.recompose_section(section_idx);
            self.paginate_if_needed();
            self.event_log.push(DocumentEvent::PictureDeleted {
                section: section_idx,para: para_idx,ctrl: control_idx,
            });
            return Ok("{\"ok\":true}".to_string());
        }
        if let Control::Shape(shape) = &para.controls[control_idx] {
            if has_oriented_child(shape) {
                return Err(HwpError::RenderError(
                    "회전하거나 대칭한 묶음은 현재 배치를 유지하며 풀 수 없습니다. 묶음을 유지하거나 회전/대칭을 해제한 뒤 다시 시도하세요.".to_string(),
                ));
            }
        }
        // GroupShape를 꺼냄
        let group_ctrl = para.controls.remove(control_idx);
        if control_idx < para.ctrl_data_records.len() {
            para.ctrl_data_records.remove(control_idx);
        }
        if para.char_count >= 8 {
            para.char_count -= 8;
        }

        let group_shape = match group_ctrl {
            Control::Shape(s) => match *s {
                ShapeObject::Group(g) => g,
                _ => unreachable!(),
            },
            _ => unreachable!(),
        };

        // 그룹의 글로벌 좌표
        let group_x = group_shape.common.horizontal_offset as i32;
        let group_y = group_shape.common.vertical_offset as i32;
        // 그룹 스케일 (리사이즈된 경우)
        let gsa = &group_shape.shape_attr;
        let group_sx = if gsa.original_width > 0 {
            gsa.current_width as f64 / gsa.original_width as f64
        } else {
            1.0
        };
        let group_sy = if gsa.original_height > 0 {
            gsa.current_height as f64 / gsa.original_height as f64
        } else {
            1.0
        };

        // 자식들을 개별 컨트롤로 복원
        let mut insert_idx = control_idx;
        for mut child in group_shape.children {
            // 파일에서 로드한 그룹 자식은 common이 기본값(0) → shape_attr에서 복원
            {
                let sa = child.shape_attr();
                // HWP group children have no CommonObjAttr dimensions. Their
                // visible picture size lives in the composed rendering matrix,
                // not in original_width/height (which may be the image's native
                // size). Remove the parent scale here; the common dimensions
                // receive it once in the global-coordinate conversion below.
                let (sa_w, sa_h) = if matches!(&child, ShapeObject::Picture(_)) {
                    let restore = |original: u32, scale: f64, parent_scale: f64| {
                        let value = original as f64 * scale.abs() / parent_scale;
                        if value.is_finite() && value > 0.0 {
                            value.round().max(1.0) as u32
                        } else {
                            original
                        }
                    };
                    (
                        restore(sa.original_width, sa.render_sx, group_sx),
                        restore(sa.original_height, sa.render_sy, group_sy),
                    )
                } else {
                    (sa.original_width, sa.original_height)
                };
                let sa_ox = sa.offset_x;
                let sa_oy = sa.offset_y;
                let c = child.common_mut();
                if c.width == 0 && sa_w > 0 {
                    c.width = sa_w;
                }
                if c.height == 0 && sa_h > 0 {
                    c.height = sa_h;
                }
                if c.horizontal_offset == 0 && sa_ox > 0 {
                    c.horizontal_offset = sa_ox as u32;
                }
                if c.vertical_offset == 0 && sa_oy > 0 {
                    c.vertical_offset = sa_oy as u32;
                }
            }
            // 자식의 로컬 좌표를 글로벌 좌표로 변환 (그룹 스케일 적용)
            {
                let c = child.common_mut();
                c.horizontal_offset =
                    (group_x + (c.horizontal_offset as f64 * group_sx) as i32) as u32;
                c.vertical_offset = (group_y + (c.vertical_offset as f64 * group_sy) as i32) as u32;
                c.width = ((c.width as f64 * group_sx).round().max(1.0)) as u32;
                c.height = ((c.height as f64 * group_sy).round().max(1.0)) as u32;
                c.vert_rel_to = group_shape.common.vert_rel_to;
                c.vert_align = group_shape.common.vert_align;
                c.horz_rel_to = group_shape.common.horz_rel_to;
                c.horz_align = group_shape.common.horz_align;
                c.text_wrap = group_shape.common.text_wrap;
                c.attr = group_shape.common.attr;
                c.treat_as_char = group_shape.common.treat_as_char;
            }
            // 도형별 좌표에 그룹 스케일 적용
            if group_sx != 1.0 || group_sy != 1.0 {
                Self::scale_shape_coords(&mut child, group_sx, group_sy);
            }
            // shape_attr 갱신 (common 값 확정 후)
            let final_w = child.common().width;
            let final_h = child.common().height;
            // Hancom sizes the standalone image rectangle from these four
            // corners as well as the shape matrix. Since ungroup normalizes
            // original/current size below, bake its scale into that rectangle
            // first. Crop coordinates have a separate image reference and must
            // remain untouched.
            if let ShapeObject::Picture(pic) = &mut child {
                // Despite their historical names these arrays hold interleaved
                // points: [pt0.x, pt0.y, pt1.x, pt1.y] and [pt2.x, ...].
                let xs = [pic.border_x[0], pic.border_x[2], pic.border_y[0], pic.border_y[2]];
                let ys = [pic.border_x[1], pic.border_x[3], pic.border_y[1], pic.border_y[3]];
                let rect_w = i64::from(*xs.iter().max().unwrap())
                    - i64::from(*xs.iter().min().unwrap());
                let rect_h = i64::from(*ys.iter().max().unwrap())
                    - i64::from(*ys.iter().min().unwrap());
                // The image rectangle's source coordinate range may differ
                // from orgSz (notably cropped HWPX pictures).
                if rect_w > 0 && rect_h > 0 {
                    let sx = final_w as f64 / rect_w as f64;
                    let sy = final_h as f64 / rect_h as f64;
                    for points in [&mut pic.border_x, &mut pic.border_y] {
                        for (index, coordinate) in points.iter_mut().enumerate() {
                            let scale = if index % 2 == 0 { sx } else { sy };
                            *coordinate = (*coordinate as f64 * scale).round() as i32;
                        }
                    }
                    pic.shape_attr.render_sx = 1.0;
                    pic.shape_attr.render_sy = 1.0;
                }
            }
            {
                let sa = match &mut child {
                    ShapeObject::Line(s) => &mut s.drawing.shape_attr,
                    ShapeObject::Rectangle(s) => &mut s.drawing.shape_attr,
                    ShapeObject::Ellipse(s) => &mut s.drawing.shape_attr,
                    ShapeObject::Arc(s) => &mut s.drawing.shape_attr,
                    ShapeObject::Polygon(s) => &mut s.drawing.shape_attr,
                    ShapeObject::Curve(s) => &mut s.drawing.shape_attr,
                    ShapeObject::Group(g) => &mut g.shape_attr,
                    ShapeObject::Picture(p) => &mut p.shape_attr,
                    ShapeObject::Chart(c) => &mut c.drawing.shape_attr,
                    ShapeObject::Ole(o) => &mut o.drawing.shape_attr,
                };
                if sa.group_level > 0 {
                    sa.group_level -= 1;
                }
                sa.offset_x = 0;
                sa.offset_y = 0;
                sa.render_tx = 0.0;
                sa.render_ty = 0.0;
                sa.current_width = final_w;
                sa.original_width = final_w;
                sa.current_height = final_h;
                sa.original_height = final_h;
                sa.is_two_ctrl_id = true;
                sa.raw_rendering = Vec::new();
            }

            // 문단에 삽입
            // [#3214] controls 기준 인덱스를 ctrl_data_records 에 그대로 쓰기 전에 정렬한다.
            para.align_ctrl_data_records();
            para.controls
                .insert(insert_idx, Control::Shape(Box::new(child)));
            para.ctrl_data_records.insert(insert_idx, None);
            para.char_count += 8;
            para.control_mask |= 0x00000800;
            para.has_para_text = true;
            insert_idx += 1;
        }

        // char_offsets: 그룹 1개 → 자식 N개, net 변화 = (N-1) * 8
        //
        // [Issue #2912] group_shapes_native 의 반대 방향 연산이다. #2905/#2910 에서 확립한
        // 규약(create_shape_control_native/insert_equation_native 와 동일)대로, 언그룹
        // 지점(find_control_text_positions 기준) *이전* char_offsets 는 그대로 두고, 그
        // 지점 이후 항목에만 net_delta 를 적용해야 한다. 기존 코드는 이 계산 없이
        // para.char_offsets 전체에 무조건 += 했기 때문에, 언그룹 대상보다 앞서 문단에
        // 남아있는 텍스트/컨트롤의 char_offsets 까지 밀려 텍스트-컨트롤 오프셋 매핑이
        // 깨졌다.
        let children_count = insert_idx - control_idx;
        if children_count > 1 && !para.char_offsets.is_empty() {
            let net_delta = ((children_count - 1) * 8) as u32;
            let text_positions = crate::document_core::helpers::find_control_text_positions(para);
            let text_len = para.text.chars().count();
            let safe_offset = text_positions.get(control_idx).copied().unwrap_or(text_len);
            let shift_from = safe_offset.min(para.char_offsets.len());
            for co in para.char_offsets[shift_from..].iter_mut() {
                *co += net_delta;
            }
        }

        // 리플로우 + 페이지네이션
        self.document.sections[section_idx].raw_stream = None;
        self.recompose_section(section_idx);
        self.paginate_if_needed();

        self.event_log.push(DocumentEvent::PictureDeleted {
            section: section_idx,
            para: para_idx,
            ctrl: control_idx,
        });
        Ok("{\"ok\":true}".to_string())
    }

    // ─── 수식 속성 API ──────────────────────────────────
    pub(crate) fn footnote_shape_number_format_code(
        format: crate::model::footnote::NumberFormat,
    ) -> u8 {
        crate::model::footnote::FootnoteShape::number_format_attr_code(format) as u8
    }
    fn footnote_shape_number_format_from_str(
        value: &str,
        fallback: crate::model::footnote::NumberFormat,
    ) -> crate::model::footnote::NumberFormat {
        crate::model::footnote::FootnoteShape::number_format_from_name(value, fallback)
    }
    fn footnote_shape_number_format_name(
        format: crate::model::footnote::NumberFormat,
    ) -> &'static str {
        use crate::model::footnote::NumberFormat;
        match format {
            NumberFormat::Digit => "digit",
            NumberFormat::CircledDigit => "circledDigit",
            NumberFormat::UpperRoman => "upperRoman",
            NumberFormat::LowerRoman => "lowerRoman",
            NumberFormat::UpperAlpha => "upperAlpha",
            NumberFormat::LowerAlpha => "lowerAlpha",
            NumberFormat::CircledUpperAlpha => "circledUpperAlpha",
            NumberFormat::CircledLowerAlpha => "circledLowerAlpha",
            NumberFormat::HangulSyllable => "hangulSyllable",
            NumberFormat::CircledHangulSyllable => "circledHangulSyllable",
            NumberFormat::HangulJamo => "hangulJamo",
            NumberFormat::CircledHangulJamo => "circledHangulJamo",
            NumberFormat::HangulDigit => "hangulDigit",
            NumberFormat::HanjaDigit => "hanjaDigit",
            NumberFormat::CircledHanjaDigit => "circledHanjaDigit",
            NumberFormat::HanjaGapEul => "hanjaGapEul",
            NumberFormat::HanjaGapEulHanja => "hanjaGapEulHanja",
            NumberFormat::FourSymbol => "fourSymbol",
            NumberFormat::UserChar => "userChar",
        }
    }
    fn encode_footnote_shape_attr(shape: &crate::model::footnote::FootnoteShape) -> u32 {
        shape.encode_attr()
    }
    fn sync_endnote_control_with_shape(
        endnote: &mut crate::model::footnote::Endnote,
        number_format_code: u8,
        prefix_char: char,
        suffix_char: char,
    ) {
        use crate::model::control::{AutoNumberType, Control};

        endnote.before_decoration_letter = if prefix_char == '\0' {
            0
        } else {
            prefix_char as u16
        };
        endnote.after_decoration_letter = if suffix_char == '\0' {
            0
        } else {
            suffix_char as u16
        };
        endnote.number_shape = number_format_code as u32;

        for para in &mut endnote.paragraphs {
            for ctrl in &mut para.controls {
                if let Control::AutoNumber(auto_num) = ctrl {
                    if auto_num.number_type == AutoNumberType::Endnote {
                        auto_num.format = number_format_code;
                        auto_num.prefix_char = prefix_char;
                        auto_num.suffix_char = suffix_char;
                        auto_num.number = endnote.number;
                        auto_num.assigned_number = endnote.number;
                    }
                }
            }
        }
    }
    pub(crate) fn renumber_paragraph_endnotes_with_shape(
        paragraphs: &mut [crate::model::paragraph::Paragraph],
        next_number: &mut u16,
        number_format_code: u8,
        prefix_char: char,
        suffix_char: char,
    ) {
        for para in paragraphs {
            for ctrl in &mut para.controls {
                match ctrl {
                    Control::Endnote(endnote) => {
                        endnote.number = *next_number;
                        Self::sync_endnote_control_with_shape(
                            endnote,
                            number_format_code,
                            prefix_char,
                            suffix_char,
                        );
                        *next_number = next_number.saturating_add(1);
                    }
                    Control::Table(table) => {
                        for cell in &mut table.cells {
                            Self::renumber_paragraph_endnotes_with_shape(
                                &mut cell.paragraphs,
                                next_number,
                                number_format_code,
                                prefix_char,
                                suffix_char,
                            );
                        }
                    }
                    Control::Shape(shape) => {
                        if let Some(text_box) =
                            shape.drawing_mut().and_then(|d| d.text_box.as_mut())
                        {
                            Self::renumber_paragraph_endnotes_with_shape(
                                &mut text_box.paragraphs,
                                next_number,
                                number_format_code,
                                prefix_char,
                                suffix_char,
                            );
                        }
                    }
                    _ => {}
                }
            }
        }
    }
    /// HWP 직렬화가 읽는 문단 control stream의 구역 정의를 section 메타와 맞춘다.
    fn sync_section_def_controls_from_section(&mut self, section_idx: usize) {
        let Some(section) = self.document.sections.get_mut(section_idx) else {
            return;
        };
        let section_def = section.section_def.clone();
        for paragraph in &mut section.paragraphs {
            for control in &mut paragraph.controls {
                if let Control::SectionDef(control_section_def) = control {
                    **control_section_def = section_def.clone();
                }
            }
        }
    }

    /// 현재 구역의 미주 모양을 조회한다.
    pub fn get_endnote_shape_native(&self, section_idx: usize) -> Result<String, HwpError> {
        let section = self.document.sections.get(section_idx).ok_or_else(|| {
            HwpError::RenderError(format!("구역 인덱스 {} 범위 초과", section_idx))
        })?;
        let shape = &section.section_def.endnote_shape;
        let separator_enabled = shape.separator_length != 0
            || shape.separator_line_type != 0
            || shape.separator_line_width != 0;
        let separator_color =
            crate::document_core::helpers::clipboard_color_to_css(shape.separator_color);

        Ok(format!(
            concat!(
                "{{\"ok\":true,",
                "\"numberFormat\":\"{}\",",
                "\"userChar\":\"{}\",",
                "\"prefixChar\":\"{}\",",
                "\"suffixChar\":\"{}\",",
                "\"startNumber\":{},",
                "\"separatorEnabled\":{},",
                "\"separatorLength\":{},",
                "\"separatorMarginTop\":{},",
                "\"separatorMarginBottom\":{},",
                "\"noteSpacing\":{},",
                "\"separatorLineType\":{},",
                "\"separatorLineWidth\":{},",
                "\"separatorColor\":\"{}\",",
                "\"numberCodeSuperscript\":{},",
                "\"printInlineAfterText\":{},",
                "\"numbering\":\"{}\",",
                "\"placement\":\"{}\"",
                "}}"
            ),
            Self::footnote_shape_number_format_name(shape.number_format),
            Self::json_escape_note_char(shape.user_char),
            Self::json_escape_note_char(shape.prefix_char),
            Self::json_escape_note_char(shape.suffix_char),
            shape.start_number,
            if separator_enabled { "true" } else { "false" },
            shape.separator_length,
            shape.separator_above_margin_hu(),
            shape.separator_below_margin_hu(),
            shape.between_notes_margin_hu(),
            shape.separator_line_type,
            shape.separator_line_width,
            separator_color,
            if shape.number_code_superscript {
                "true"
            } else {
                "false"
            },
            if shape.print_inline_after_text {
                "true"
            } else {
                "false"
            },
            Self::footnote_numbering_name(shape.numbering),
            Self::footnote_placement_name(shape.placement),
        ))
    }
    /// 현재 구역의 미주 모양을 적용한다.
    pub fn apply_endnote_shape_native(
        &mut self,
        section_idx: usize,
        props_json: &str,
    ) -> Result<String, HwpError> {
        {
            let section = self.document.sections.get_mut(section_idx).ok_or_else(|| {
                HwpError::RenderError(format!("구역 인덱스 {} 범위 초과", section_idx))
            })?;
            let shape = &mut section.section_def.endnote_shape;

            if let Some(v) = crate::document_core::helpers::json_str(props_json, "numberFormat") {
                shape.number_format =
                    Self::footnote_shape_number_format_from_str(&v, shape.number_format);
            }
            if let Some(v) = crate::document_core::helpers::json_str(props_json, "userChar") {
                shape.user_char = Self::first_char_or_nul(&v);
            }
            if let Some(v) = crate::document_core::helpers::json_str(props_json, "prefixChar") {
                shape.prefix_char = Self::first_char_or_nul(&v);
            }
            if let Some(v) = crate::document_core::helpers::json_str(props_json, "suffixChar") {
                shape.suffix_char = Self::first_char_or_nul(&v);
            }
            if let Some(v) = crate::document_core::helpers::json_u16(props_json, "startNumber") {
                shape.start_number = v.max(1);
            }
            if let Some(v) = Self::hwpunit16_from_json(props_json, "separatorLength") {
                shape.separator_length = i32::from(v.max(0));
            }
            if let Some(v) = Self::hwpunit16_from_json(props_json, "separatorMarginTop") {
                let above = v.max(0);
                // HWP5 저장본은 구분선 위 값을 fallback 슬롯에 보관하는 경우가 있어 함께 갱신한다.
                shape.separator_margin_top = above;
                shape.separator_margin_bottom = above;
            }
            if let Some(v) = Self::hwpunit16_from_json(props_json, "separatorMarginBottom") {
                shape.note_spacing = v.max(0);
            }
            if let Some(v) = Self::hwpunit16_from_json(props_json, "noteSpacing") {
                shape.raw_unknown = v.max(0) as u16;
            }
            if let Some(v) = crate::document_core::helpers::json_u8(props_json, "separatorLineType")
            {
                shape.separator_line_type = v;
            }
            if let Some(v) =
                crate::document_core::helpers::json_u8(props_json, "separatorLineWidth")
            {
                shape.separator_line_width = v;
            }
            if let Some(v) = crate::document_core::helpers::json_color(props_json, "separatorColor")
            {
                shape.separator_color = v;
            }
            if let Some(v) = crate::document_core::helpers::json_str(props_json, "numbering") {
                shape.numbering = Self::footnote_numbering_from_str(&v, shape.numbering);
            }
            if let Some(v) = crate::document_core::helpers::json_str(props_json, "placement") {
                shape.placement = Self::footnote_placement_from_str(&v, shape.placement);
            }
            if let Some(v) =
                crate::document_core::helpers::json_bool(props_json, "numberCodeSuperscript")
            {
                shape.number_code_superscript = v;
            }
            if let Some(v) =
                crate::document_core::helpers::json_bool(props_json, "printInlineAfterText")
            {
                shape.print_inline_after_text = v;
            }
            if let Some(false) =
                crate::document_core::helpers::json_bool(props_json, "separatorEnabled")
            {
                shape.separator_length = 0;
                shape.separator_line_type = 0;
                shape.separator_line_width = 0;
            }
            shape.attr = Self::encode_footnote_shape_attr(shape);
            let start_number = shape.start_number.max(1);
            let number_format_code = Self::footnote_shape_number_format_code(shape.number_format);
            let prefix_char = shape.prefix_char;
            let suffix_char = shape.suffix_char;
            let mut next_number = start_number;
            Self::renumber_paragraph_endnotes_with_shape(
                &mut section.paragraphs,
                &mut next_number,
                number_format_code,
                prefix_char,
                suffix_char,
            );
            section.raw_stream = None;
        }
        self.sync_section_def_controls_from_section(section_idx);

        self.recompose_section(section_idx);
        self.paginate_if_needed();
        self.invalidate_page_tree_cache();

        Ok(crate::document_core::helpers::json_ok())
    }
}

#[cfg(test)]
mod resize_clamp_tests {
    use super::*;
    use crate::model::document::{Document, Section, SectionDef};
    use crate::model::page::PageDef;

    fn make_test_core() -> DocumentCore {
        let mut doc = Document::default();
        doc.sections.push(Section {
            section_def: SectionDef {
                page_def: PageDef {
                    width: 59528,
                    height: 84188,
                    margin_left: 8504,
                    margin_right: 8504,
                    margin_top: 5668,
                    margin_bottom: 4252,
                    margin_header: 4252,
                    margin_footer: 4252,
                    ..Default::default()
                },
                ..Default::default()
            },
            paragraphs: vec![Paragraph::default()],
            raw_stream: None,
            raw_provenance: None,
            memo_tail: None,
        });
        let mut core = DocumentCore::new_empty();
        // set_document이 composed/styles/pagination 벡터를 일관되게 초기화한다.
        core.set_document(doc);
        core
    }

    fn create_rectangle(core: &mut DocumentCore) -> (usize, usize) {
        let res = core
            .create_shape_control_native(
                0,
                0,
                0,
                9000,
                6750,
                0,
                0,
                false,
                "InFrontOfText",
                "rectangle",
                false,
                false,
                &[],
            )
            .expect("create rectangle");
        let para_idx = res
            .split("\"paraIdx\":")
            .nth(1)
            .and_then(|s| s.split(',').next())
            .and_then(|s| s.parse::<usize>().ok())
            .unwrap_or(0);
        let ctrl_idx = res
            .split("\"controlIdx\":")
            .nth(1)
            .and_then(|s| s.split(|c: char| !c.is_ascii_digit()).next())
            .and_then(|s| s.parse::<usize>().ok())
            .unwrap_or(0);
        (para_idx, ctrl_idx)
    }

    fn shape_common<'a>(
        core: &'a DocumentCore,
        para: usize,
        ctrl: usize,
    ) -> &'a crate::model::shape::CommonObjAttr {
        let c = &core.document.sections[0].paragraphs[para].controls[ctrl];
        match c {
            Control::Shape(s) => s.common(),
            _ => panic!("expected shape"),
        }
    }

    /// 리사이즈 핸들을 반대편 너머로 잡아끌 때 studio가 width=0 을 보내도
    /// 도형 공통 크기는 MIN_SHAPE_SIZE 이상을 유지해야 한다.
    #[test]
    fn resize_to_zero_width_clamps_to_min() {
        let mut core = make_test_core();
        let (para, ctrl) = create_rectangle(&mut core);

        core.set_shape_properties_native(0, para, ctrl, r#"{"width":0,"height":0}"#)
            .expect("resize to 0");

        let common = shape_common(&core, para, ctrl);
        assert!(
            common.width >= MIN_SHAPE_SIZE,
            "width clamped: {}",
            common.width
        );
        assert!(
            common.height >= MIN_SHAPE_SIZE,
            "height clamped: {}",
            common.height
        );
    }

    /// Rectangle은 common.width/height 를 기반으로 x_coords/y_coords 를 재계산한다.
    /// 0으로 내려가면 [0,0,0,0]이 되어 화면에서 사라졌던 버그 방어.
    #[test]
    fn rectangle_coords_nonzero_after_shrink_to_zero() {
        let mut core = make_test_core();
        let (para, ctrl) = create_rectangle(&mut core);

        core.set_shape_properties_native(0, para, ctrl, r#"{"width":0,"height":0}"#)
            .expect("resize to 0");

        let ctrl_ref = &core.document.sections[0].paragraphs[para].controls[ctrl];
        if let Control::Shape(shape) = ctrl_ref {
            if let ShapeObject::Rectangle(rect) = shape.as_ref() {
                assert_ne!(rect.x_coords, [0, 0, 0, 0], "Rectangle x_coords collapsed");
                assert_ne!(rect.y_coords, [0, 0, 0, 0], "Rectangle y_coords collapsed");
            } else {
                panic!("expected Rectangle variant");
            }
        }
    }

    /// 반복된 0-resize 후에도 원상 복구 가능한 양의 크기로 리사이즈할 수 있어야 한다.
    /// (사용자 보고 시나리오: 핸들 여러 번 클릭 → 도형 소실 → 되돌리기 불가)
    #[test]
    fn repeated_zero_resize_does_not_corrupt_state() {
        let mut core = make_test_core();
        let (para, ctrl) = create_rectangle(&mut core);

        for _ in 0..5 {
            core.set_shape_properties_native(0, para, ctrl, r#"{"width":0,"height":0}"#)
                .expect("repeated resize");
        }
        core.set_shape_properties_native(0, para, ctrl, r#"{"width":12000,"height":8000}"#)
            .expect("restore");

        let common = shape_common(&core, para, ctrl);
        assert_eq!(common.width, 12000);
        assert_eq!(common.height, 8000);
    }

    /// group_shapes_native 는 그룹으로 묶이는 컨트롤보다 앞서 문단에 남아있는 텍스트의
    /// char_offsets 를 건드리면 안 된다. 삽입 지점(safe_offset) 이전 항목은 그대로 두고
    /// 그 이후만 +8 시프트해야 한다(create_shape_control_native 와 동일 규약, shape.rs:1519).
    /// 회귀 전에는 para.char_offsets 전체를 무조건 +8 해서, 그룹 대상보다 앞에 있는
    /// 텍스트/컨트롤의 오프셋까지 밀렸다.
    #[test]
    fn group_shapes_only_shifts_char_offsets_after_insertion_point() {
        let mut core = make_test_core();
        {
            // 문단에 실제 텍스트 "A"를 미리 채워 char_offsets=[0] 상태를 만든다.
            let para = &mut core.document.sections[0].paragraphs[0];
            para.text = "A".to_string();
            para.char_offsets = vec![0];
            para.char_count = 1;
        }

        // 텍스트 뒤(char_offset=1)에 사각형 3개를 순서대로 삽입한다.
        let mut ctrl_indices = Vec::new();
        for _ in 0..3 {
            let res = core
                .create_shape_control_native(
                    0,
                    0,
                    1,
                    900,
                    900,
                    0,
                    0,
                    false,
                    "InFrontOfText",
                    "rectangle",
                    false,
                    false,
                    &[],
                )
                .expect("create rectangle");
            let ctrl_idx = res
                .split("\"controlIdx\":")
                .nth(1)
                .and_then(|s| s.split(|c: char| !c.is_ascii_digit()).next())
                .and_then(|s| s.parse::<usize>().ok())
                .unwrap();
            ctrl_indices.push(ctrl_idx);
        }
        assert_eq!(
            core.document.sections[0].paragraphs[0].char_offsets,
            vec![0],
            "사전 조건: 삽입 후에도 'A' 오프셋은 0 이어야 한다"
        );

        // 뒤의 두 도형만 묶는다 — 첫 도형은 문단에 그대로 남아 있다.
        core.group_shapes_native(0, &[(0, ctrl_indices[1]), (0, ctrl_indices[2])])
            .expect("group shapes");

        assert_eq!(
            core.document.sections[0].paragraphs[0].char_offsets,
            vec![0],
            "그룹 묶기가 삽입 지점 이전 텍스트(char 'A')의 char_offsets 를 밀면 안 된다"
        );
    }

    /// [Issue #2912] ungroup_shape_native 는 언그룹 지점 이전 char_offsets 를 건드리면 안
    /// 된다. group_shapes_native(#2905/#2910) 와 반대 방향(1개 → N개)의 연산이지만 동일한
    /// 규약을 지켜야 한다: 삽입/시프트 지점(find_control_text_positions 기준) 이전 항목은
    /// 그대로 두고 그 이후만 시프트한다.
    ///
    /// 회귀 전에는 para.char_offsets 전체에 무조건 net_delta 를 더해서, 언그룹 대상보다
    /// 앞서 문단에 남아있는 텍스트("A")의 char_offsets 항목까지 밀렸다.
    #[test]
    fn ungroup_shape_only_shifts_char_offsets_after_insertion_point() {
        let mut core = make_test_core();
        {
            // 문단에 실제 텍스트 "A"를 미리 채워 char_offsets=[0] 상태를 만든다.
            let para = &mut core.document.sections[0].paragraphs[0];
            para.text = "A".to_string();
            para.char_offsets = vec![0];
            para.char_count = 1;
        }

        // 텍스트 뒤(char_offset=1)에 사각형 3개를 순서대로 삽입한다.
        let mut ctrl_indices = Vec::new();
        for _ in 0..3 {
            let res = core
                .create_shape_control_native(
                    0,
                    0,
                    1,
                    900,
                    900,
                    0,
                    0,
                    false,
                    "InFrontOfText",
                    "rectangle",
                    false,
                    false,
                    &[],
                )
                .expect("create rectangle");
            let ctrl_idx = res
                .split("\"controlIdx\":")
                .nth(1)
                .and_then(|s| s.split(|c: char| !c.is_ascii_digit()).next())
                .and_then(|s| s.parse::<usize>().ok())
                .unwrap();
            ctrl_indices.push(ctrl_idx);
        }
        assert_eq!(
            core.document.sections[0].paragraphs[0].char_offsets,
            vec![0],
            "사전 조건: 사각형 삽입 후에도 'A' 오프셋은 0 이어야 한다"
        );

        // 뒤의 두 도형을 GroupShape 로 직접 감싸 넣는다 (group_shapes_native 는 별도 결함
        // #2905 계열이 있어 이 테스트의 관심사인 ungroup_shape_native 만 독립적으로
        // 검증하기 위해 그룹 생성은 우회한다). ctrl_indices[1], [2] 는 char_offsets
        // 배열 길이(1) 를 넘어서는 위치에 있으므로 그룹으로 합쳐도 char_offsets 는
        // 여전히 [0] 이어야 한다 — 이는 group_shapes_native 가 올바르게 구현되었을 때와
        // 동일한 사전 조건이다.
        let group_ctrl_idx;
        {
            use crate::model::control::Control;
            use crate::model::shape::{GroupShape, ShapeObject};
            let para = &mut core.document.sections[0].paragraphs[0];
            let removed_third = para.controls.remove(ctrl_indices[2]);
            para.ctrl_data_records.remove(ctrl_indices[2]);
            let removed_second = para.controls.remove(ctrl_indices[1]);
            para.ctrl_data_records.remove(ctrl_indices[1]);
            let shape_of = |c: Control| -> ShapeObject {
                match c {
                    Control::Shape(s) => *s,
                    _ => panic!("expected shape control"),
                }
            };
            let child_a = shape_of(removed_second);
            let child_b = shape_of(removed_third);
            let group = GroupShape {
                common: child_a.common().clone(),
                shape_attr: child_a.shape_attr().clone(),
                children: vec![child_a, child_b],
                caption: None,
            };
            group_ctrl_idx = ctrl_indices[1];
            para.controls.insert(
                group_ctrl_idx,
                Control::Shape(Box::new(ShapeObject::Group(group))),
            );
            para.ctrl_data_records.insert(group_ctrl_idx, None);
        }
        assert_eq!(
            core.document.sections[0].paragraphs[0].char_offsets,
            vec![0],
            "사전 조건: 그룹 삽입 후에도 'A' 오프셋은 0 이어야 한다"
        );

        // 방금 만든 그룹을 다시 풀어낸다 (1개 → 2개, net_delta = 8).
        core.ungroup_shape_native(0, 0, group_ctrl_idx)
            .expect("ungroup shapes");

        assert_eq!(
            core.document.sections[0].paragraphs[0].char_offsets,
            vec![0],
            "언그룹이 삽입 지점 이전 텍스트(char 'A')의 char_offsets 를 밀면 안 된다"
        );
    }
}

#[cfg(test)]
mod char_shape_inherit_tests {
    use super::*;
    use crate::model::control::Control;
    use crate::model::paragraph::CharShapeRef;

    /// 혼합 글자모양 문단: 텍스트 20자, 글자 인덱스 0~9 는 34, 10~ 는 37.
    /// 커서 offset 10 의 글자모양(37)은 첫 엔트리(34)와 다르다.
    fn core_with_mixed_shape_paragraph() -> DocumentCore {
        let mut core = DocumentCore::new_empty();
        core.create_blank_document_native().unwrap();
        core.insert_text_native(0, 0, 0, "0123456789abcdefghij")
            .unwrap();
        let para = &mut core.document.sections[0].paragraphs[0];
        // 컨트롤(SectionDef 등)이 UTF-16 앞자리를 차지하므로 경계는 char_offsets 로 계산.
        let boundary = para.char_offsets[10];
        para.char_shapes = vec![
            CharShapeRef {
                start_pos: 0,
                char_shape_id: 34,
            },
            CharShapeRef {
                start_pos: boundary,
                char_shape_id: 37,
            },
        ];
        core
    }

    /// [index-axis 회귀] 도형 삽입이 char_offsets(텍스트축, 길이=글자수)에 controls축 인덱스로
    /// 원소를 끼워넣어 char_offsets.len() 이 text.chars().count() 와 어긋나던 결함.
    #[test]
    fn create_shape_preserves_char_offsets_length_invariant() {
        let mut core = DocumentCore::new_empty();
        core.create_blank_document_native().unwrap();
        core.insert_text_native(0, 0, 0, "AB").unwrap();
        core.create_shape_control_native(
            0,
            0,
            1,
            9000,
            6750,
            0,
            0,
            false,
            "InFrontOfText",
            "textbox",
            false,
            false,
            &[],
        )
        .unwrap();
        let para = &core.document.sections[0].paragraphs[0];
        assert_eq!(
            para.char_offsets.len(),
            para.text.chars().count(),
            "도형 삽입 후 char_offsets 길이가 텍스트 글자 수와 일치해야 함(컨트롤은 갭으로 표현)"
        );
    }

    #[test]
    fn create_textbox_inherits_char_shape_at_cursor_offset() {
        let mut core = core_with_mixed_shape_paragraph();
        core.create_shape_control_native(
            0,
            0,
            10,
            9000,
            6750,
            0,
            0,
            false,
            "InFrontOfText",
            "textbox",
            false,
            false,
            &[],
        )
        .unwrap();

        let tb_para = core.document.sections[0]
            .paragraphs
            .iter()
            .find_map(|p| {
                p.controls.iter().find_map(|c| match c {
                    Control::Shape(s) => crate::document_core::helpers::get_textbox_from_shape(s)
                        .map(|tb| &tb.paragraphs[0]),
                    _ => None,
                })
            })
            .expect("글상자 내부 문단");
        assert_eq!(
            tb_para.char_shapes.first().map(|cs| cs.char_shape_id),
            Some(37),
            "글상자 내부 문단이 커서 offset 글자모양(37)이 아닌 값을 상속"
        );
    }
}

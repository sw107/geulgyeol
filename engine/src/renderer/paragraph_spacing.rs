//! Shared leading spacing for partial paragraph fit and painting.
use super::hwpunit_to_px;
use crate::model::paragraph::{LineSeg, Paragraph};

#[allow(clippy::too_many_arguments)]
pub(crate) fn partial_paragraph_spacing_before_px(
    para: Option<&Paragraph>,
    para_index: usize,
    start_line: usize,
    spacing_before: f64,
    dpi: f64,
    is_column_top: bool,
    keep_column_top: bool,
    reapply_snap: bool,
    suppress_vpos_fallback: bool,
) -> f64 {
    if start_line != 0 || spacing_before <= 0.0 {
        return 0.0;
    }
    if !is_column_top || keep_column_top || reapply_snap {
        return spacing_before;
    }
    if suppress_vpos_fallback {
        return 0.0;
    }
    let first = para.and_then(|p| p.line_segs.first());
    if para_index == 0 {
        return spacing_before.min(
            first
                .map(|s| hwpunit_to_px(s.vertical_pos, dpi))
                .unwrap_or(0.0)
                .max(0.0),
        );
    }
    first
        .filter(|s| s.tag & LineSeg::TAG_IMPLEMENTATION_PROPERTY == 0)
        .map(|s| hwpunit_to_px(s.vertical_pos, dpi))
        .filter(|v| *v > 0.0 && *v <= spacing_before + 0.5)
        .unwrap_or(0.0)
}

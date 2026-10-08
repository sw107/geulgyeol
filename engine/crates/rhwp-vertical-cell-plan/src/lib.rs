//! Experimental pure geometry/ownership calculation; NOT connected to rhwp.
//!
//! Input is one ordinary text cell, ordered paragraphs, and ordered usable fragment
//! rectangles. All lengths are fixed-point 1/1024 pixel. Callers must quantize
//! rectangles inward and measured advance/ink extents outward, and supply shaped
//! units with original Unicode scalar ranges (not UTF-8 byte offsets). Units such
//! as combining sequences and ZWJ emoji are indivisible. This module does not
//! shape text, generate pages, resolve styles/padding, or interpret stored lines.
//! Each paragraph begins a fresh column, including empty paragraphs. Columns
//! progress in the requested direction; characters always progress top to bottom.
//! HWP text directions 1/2 both use right-to-left columns; glyph orientation is
//! represented by caller-supplied post-rotation metrics, not by rewriting text.
//! Finite-frame exhaustion is an error, never a successful partial plan.

use std::ops::Range;

pub const SUBPIXELS_PER_PIXEL: u32 = 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Direction {
    RightToLeft,
    LeftToRight,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Rect {
    pub x: i64,
    pub y: i64,
    pub width: u32,
    pub height: u32,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Unit {
    pub source: Range<usize>,
    /// Top-to-bottom advance including the measured ink height after rotation.
    pub advance: u32,
    /// Measured ink width after rotation.
    pub width: u32,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Paragraph {
    pub char_count: usize,
    pub column_width: u32,
    /// Cross-axis separation after every column of this paragraph. No final gap
    /// is charged at a frame boundary. This is not a paragraph y-axis margin.
    pub gap_after: u32,
    pub units: Vec<Unit>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Placement {
    pub source: Range<usize>,
    pub bounds: Rect,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Column {
    pub paragraph_index: usize,
    pub paragraph_column_index: usize,
    pub source: Range<usize>,
    /// Reserved column, spanning the usable fragment height.
    pub bounds: Rect,
    pub used_height: u32,
    pub units: Vec<Placement>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Fragment {
    /// Index in the original input frames, even if small frames were skipped.
    pub frame_index: usize,
    pub columns: Vec<Column>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Plan {
    pub fragments: Vec<Fragment>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Error {
    InvalidFrame {
        frame_index: usize,
    },
    InvalidParagraph {
        paragraph_index: usize,
    },
    InvalidUnit {
        paragraph_index: usize,
        unit_index: usize,
    },
    ColumnDoesNotFit {
        paragraph_index: usize,
    },
    UnitDoesNotFit {
        paragraph_index: usize,
        unit_index: usize,
    },
    InsufficientFrames {
        paragraph_index: usize,
        char_start: usize,
    },
}

/// Produce a complete plan or reject it. No caller state is mutated, and original
/// paragraph/scalar identities are preserved across both column and frame breaks.
pub fn plan(
    paragraphs: &[Paragraph],
    frames: &[Rect],
    direction: Direction,
) -> Result<Plan, Error> {
    for (i, frame) in frames.iter().enumerate() {
        if frame.width == 0
            || frame.height == 0
            || frame.x.checked_add(i64::from(frame.width)).is_none()
            || frame.y.checked_add(i64::from(frame.height)).is_none()
        {
            return Err(Error::InvalidFrame { frame_index: i });
        }
    }
    // Validate the entire source before placing anything, including empty text.
    for (pi, para) in paragraphs.iter().enumerate() {
        if para.column_width == 0 || (para.char_count == 0) != para.units.is_empty() {
            return Err(Error::InvalidParagraph {
                paragraph_index: pi,
            });
        }
        let mut end = 0;
        for (ui, unit) in para.units.iter().enumerate() {
            if unit.source.start != end
                || unit.source.end <= end
                || unit.source.end > para.char_count
                || unit.advance == 0
                || unit.width == 0
                || unit.width > para.column_width
            {
                return Err(Error::InvalidUnit {
                    paragraph_index: pi,
                    unit_index: ui,
                });
            }
            end = unit.source.end;
        }
        if end != para.char_count {
            return Err(Error::InvalidParagraph {
                paragraph_index: pi,
            });
        }
    }
    if !paragraphs.is_empty() && !frames.is_empty() {
        for (pi, para) in paragraphs.iter().enumerate() {
            if !frames.iter().any(|f| para.column_width <= f.width) {
                return Err(Error::ColumnDoesNotFit {
                    paragraph_index: pi,
                });
            }
            for (ui, unit) in para.units.iter().enumerate() {
                if !frames
                    .iter()
                    .any(|f| para.column_width <= f.width && unit.advance <= f.height)
                {
                    return Err(Error::UnitDoesNotFit {
                        paragraph_index: pi,
                        unit_index: ui,
                    });
                }
            }
        }
    }

    let mut result = Plan {
        fragments: Vec::new(),
    };
    let mut frame_index = 0;
    let mut occupied: u64 = 0;
    let mut previous_gap: u32 = 0;
    for (pi, para) in paragraphs.iter().enumerate() {
        let mut unit_index = 0;
        let mut column_index = 0;
        loop {
            let start = para.units.get(unit_index).map_or(0, |u| u.source.start);
            let first_advance = para.units.get(unit_index).map_or(0, |u| u.advance);
            let (frame, gap) = loop {
                let Some(frame) = frames.get(frame_index) else {
                    return Err(Error::InsufficientFrames {
                        paragraph_index: pi,
                        char_start: start,
                    });
                };
                let gap = if occupied == 0 {
                    0
                } else {
                    u64::from(previous_gap)
                };
                if occupied + gap + u64::from(para.column_width) <= u64::from(frame.width)
                    && first_advance <= frame.height
                {
                    break (*frame, gap);
                }
                frame_index += 1;
                occupied = 0;
                previous_gap = 0;
            };
            let offset = occupied + gap;
            let x = match direction {
                Direction::RightToLeft => {
                    frame.x + i64::from(frame.width) - offset as i64 - i64::from(para.column_width)
                }
                Direction::LeftToRight => frame.x + offset as i64,
            };
            let mut column = Column {
                paragraph_index: pi,
                paragraph_column_index: column_index,
                source: start..start,
                bounds: Rect {
                    x,
                    y: frame.y,
                    width: para.column_width,
                    height: frame.height,
                },
                used_height: 0,
                units: Vec::new(),
            };
            while let Some(unit) = para.units.get(unit_index) {
                if u64::from(column.used_height) + u64::from(unit.advance) > u64::from(frame.height)
                {
                    break;
                }
                column.units.push(Placement {
                    source: unit.source.clone(),
                    bounds: Rect {
                        x: x + i64::from((para.column_width - unit.width) / 2),
                        y: frame.y + i64::from(column.used_height),
                        width: unit.width,
                        height: unit.advance,
                    },
                });
                column.used_height += unit.advance;
                column.source.end = unit.source.end;
                unit_index += 1;
            }
            if result
                .fragments
                .last()
                .is_none_or(|f| f.frame_index != frame_index)
            {
                result.fragments.push(Fragment {
                    frame_index,
                    columns: Vec::new(),
                });
            }
            result
                .fragments
                .last_mut()
                .expect("fragment just inserted")
                .columns
                .push(column);
            occupied = offset + u64::from(para.column_width);
            previous_gap = para.gap_after;
            column_index += 1;
            if unit_index == para.units.len() {
                break;
            }
        }
    }
    Ok(result)
}

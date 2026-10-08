use rhwp_vertical_cell_plan::*;

fn rect(w: u32, h: u32) -> Rect {
    Rect {
        x: -30,
        y: 17,
        width: w,
        height: h,
    }
}
fn paragraph(count: usize, width: u32, advance: u32, gap: u32) -> Paragraph {
    Paragraph {
        char_count: count,
        column_width: width,
        gap_after: gap,
        units: (0..count)
            .map(|i| Unit {
                source: i..i + 1,
                advance,
                width,
            })
            .collect(),
    }
}
fn inside(inner: Rect, outer: Rect) -> bool {
    inner.x >= outer.x
        && inner.y >= outer.y
        && i128::from(inner.x) + i128::from(inner.width)
            <= i128::from(outer.x) + i128::from(outer.width)
        && i128::from(inner.y) + i128::from(inner.height)
            <= i128::from(outer.y) + i128::from(outer.height)
}
// Independent exhaustive ownership oracle. No calls into placement internals.
fn verify(paras: &[Paragraph], frames: &[Rect], direction: Direction, plan: &Plan) {
    let mut actual_units = Vec::new();
    let expected_units: Vec<_> = paras
        .iter()
        .enumerate()
        .flat_map(|(pi, p)| p.units.iter().map(move |u| (pi, u.source.clone())))
        .collect();
    let mut owners: Vec<Vec<u32>> = paras.iter().map(|p| vec![0; p.char_count]).collect();
    let mut empties = vec![0; paras.len()];
    let mut column_counts = vec![0; paras.len()];
    let mut last_frame = None;
    let mut last_paragraph = 0;
    for fragment in &plan.fragments {
        assert!(last_frame.is_none_or(|i| fragment.frame_index > i));
        last_frame = Some(fragment.frame_index);
        let frame = frames[fragment.frame_index];
        assert!(!fragment.columns.is_empty());
        let mut previous: Option<&Column> = None;
        for column in &fragment.columns {
            assert!(column.paragraph_index >= last_paragraph);
            last_paragraph = column.paragraph_index;
            let p = &paras[column.paragraph_index];
            assert_eq!(
                column.paragraph_column_index,
                column_counts[column.paragraph_index]
            );
            column_counts[column.paragraph_index] += 1;
            assert!(inside(column.bounds, frame));
            assert_eq!(column.bounds.width, p.column_width);
            assert_eq!(column.bounds.y, frame.y);
            assert_eq!(column.bounds.height, frame.height);
            if let Some(prev) = previous {
                let gap = i128::from(paras[prev.paragraph_index].gap_after);
                match direction {
                    Direction::RightToLeft => assert_eq!(
                        i128::from(column.bounds.x) + i128::from(column.bounds.width) + gap,
                        i128::from(prev.bounds.x)
                    ),
                    Direction::LeftToRight => assert_eq!(
                        i128::from(prev.bounds.x) + i128::from(prev.bounds.width) + gap,
                        i128::from(column.bounds.x)
                    ),
                }
            } else {
                match direction {
                    Direction::RightToLeft => assert_eq!(
                        i128::from(column.bounds.x) + i128::from(column.bounds.width),
                        i128::from(frame.x) + i128::from(frame.width)
                    ),
                    Direction::LeftToRight => assert_eq!(column.bounds.x, frame.x),
                }
            }
            previous = Some(column);
            if p.char_count == 0 {
                assert_eq!(column.source, 0..0);
                assert!(column.units.is_empty());
                empties[column.paragraph_index] += 1;
            } else {
                assert!(!column.units.is_empty());
                assert_eq!(column.source.start, column.units[0].source.start);
                assert_eq!(column.source.end, column.units.last().unwrap().source.end);
            }
            let mut bottom = frame.y;
            for placement in &column.units {
                assert!(inside(placement.bounds, column.bounds));
                assert_eq!(placement.bounds.y, bottom);
                bottom += i64::from(placement.bounds.height);
                actual_units.push((column.paragraph_index, placement.source.clone()));
                for owner in &mut owners[column.paragraph_index][placement.source.clone()] {
                    *owner += 1;
                }
            }
            assert_eq!(i64::from(column.used_height), bottom - frame.y);
        }
    }
    assert_eq!(
        actual_units, expected_units,
        "shaped unit order/identity must be conserved"
    );
    for (pi, owner) in owners.iter().enumerate() {
        assert!(
            owner.iter().all(|n| *n == 1),
            "each scalar exactly once in paragraph {pi}"
        );
        assert_eq!(empties[pi], u32::from(paras[pi].char_count == 0));
    }
}

#[test]
fn long_paragraph_crosses_columns_and_frames() {
    let p = vec![paragraph(1001, 10, 7, 3)];
    let f = vec![rect(36, 28); 100];
    let plan = plan(&p, &f, Direction::RightToLeft).unwrap();
    verify(&p, &f, Direction::RightToLeft, &plan);
    assert_eq!(plan.fragments.len(), 84);
    assert_eq!(plan.fragments[0].columns.len(), 3);
    assert_eq!(plan.fragments[0].columns[2].source, 8..12);
    assert_eq!(plan.fragments[1].columns[0].source, 12..16);
}

#[test]
fn empty_paragraphs_have_one_owned_marker_and_column() {
    let p = vec![
        paragraph(0, 10, 1, 2),
        paragraph(3, 10, 8, 2),
        paragraph(0, 10, 1, 2),
        paragraph(0, 10, 1, 2),
    ];
    let f = vec![rect(22, 24); 3];
    let plan = plan(&p, &f, Direction::RightToLeft).unwrap();
    verify(&p, &f, Direction::RightToLeft, &plan);
    assert_eq!(plan.fragments.len(), 2);
}

#[test]
fn korean_latin_combining_and_emoji_scalar_clusters_are_not_split() {
    let clusters = ["한", "A", "e\u{301}", "👩\u{200d}💻", "🇰🇷", "🙂", "끝"];
    let text = clusters.concat();
    assert_ne!(text.len(), text.chars().count());
    let mut end = 0;
    let units = clusters
        .iter()
        .enumerate()
        .map(|(i, s)| {
            let start = end;
            end += s.chars().count();
            Unit {
                source: start..end,
                advance: if i == 1 { 6 } else { 12 },
                width: 12,
            }
        })
        .collect();
    let p = vec![Paragraph {
        char_count: end,
        column_width: 14,
        gap_after: 3,
        units,
    }];
    let f = vec![rect(31, 24); 5];
    for d in [Direction::RightToLeft, Direction::LeftToRight] {
        let plan = plan(&p, &f, d).unwrap();
        verify(&p, &f, d, &plan);
    }
}

#[test]
fn exact_integer_boundaries_and_gaps() {
    let p = vec![paragraph(4, 1025, 513, 1)];
    let f = vec![rect(2051, 1026)];
    let plan = plan(&p, &f, Direction::RightToLeft).unwrap();
    verify(&p, &f, Direction::RightToLeft, &plan);
    assert_eq!(plan.fragments[0].columns.len(), 2);
    assert_eq!(plan.fragments[0].columns[1].used_height, 1026);
    let too_short = vec![rect(2051, 1025)];
    assert!(matches!(
        rhwp_vertical_cell_plan::plan(&p, &too_short, Direction::RightToLeft),
        Err(Error::InsufficientFrames { char_start: 2, .. })
    ));
}

#[test]
fn differing_column_metrics_and_frames_skip_without_changing_identity() {
    let mut p = vec![paragraph(2, 10, 9, 5), paragraph(4, 20, 15, 2)];
    p[1].units[2].width = 7;
    let f = vec![
        rect(10, 9),
        rect(4, 100),
        rect(40, 9),
        rect(42, 30),
        rect(20, 30),
    ];
    let plan = plan(&p, &f, Direction::RightToLeft).unwrap();
    verify(&p, &f, Direction::RightToLeft, &plan);
    assert_eq!(
        plan.fragments
            .iter()
            .map(|f| f.frame_index)
            .collect::<Vec<_>>(),
        [0, 2, 3]
    );
}

#[test]
fn giant_gap_is_not_charged_across_a_frame_boundary() {
    let p = vec![paragraph(2, 1, 1, u32::MAX)];
    let f = vec![rect(1, 1); 2];
    let plan = plan(&p, &f, Direction::RightToLeft).unwrap();
    verify(&p, &f, Direction::RightToLeft, &plan);
    assert_eq!(plan.fragments.len(), 2);
}

#[test]
fn insufficient_frames_returns_no_partial_plan_and_does_not_mutate_inputs() {
    let p = vec![paragraph(10, 10, 10, 0)];
    let f = vec![rect(20, 20)];
    let saved = (p.clone(), f.clone());
    assert_eq!(
        plan(&p, &f, Direction::RightToLeft),
        Err(Error::InsufficientFrames {
            paragraph_index: 0,
            char_start: 4
        })
    );
    assert_eq!((p, f), saved);
    assert_eq!(
        plan(&[paragraph(0, 1, 1, 0)], &[], Direction::RightToLeft),
        Err(Error::InsufficientFrames {
            paragraph_index: 0,
            char_start: 0
        })
    );
}

#[test]
fn unit_too_tall_or_column_too_wide_is_rejected() {
    assert_eq!(
        plan(
            &[paragraph(1, 11, 1, 0)],
            &[rect(10, 50)],
            Direction::RightToLeft
        ),
        Err(Error::ColumnDoesNotFit { paragraph_index: 0 })
    );
    assert_eq!(
        plan(
            &[paragraph(1, 10, 51, 0)],
            &[rect(10, 50), rect(5, 100)],
            Direction::RightToLeft
        ),
        Err(Error::UnitDoesNotFit {
            paragraph_index: 0,
            unit_index: 0
        })
    );
}

#[test]
fn rejects_gapped_overlapping_empty_reversed_and_out_of_range_units() {
    for ranges in [
        vec![(1, 2)],
        vec![(0, 1), (0, 2)],
        vec![(0, 1), (2, 3)],
        vec![(0, 0)],
        vec![(1, 0)],
        vec![(0, 4)],
        vec![(0, 1)],
    ] {
        let p = Paragraph {
            char_count: 3,
            column_width: 10,
            gap_after: 0,
            units: ranges
                .into_iter()
                .map(|(start, end)| Unit {
                    source: start..end,
                    advance: 1,
                    width: 1,
                })
                .collect(),
        };
        assert!(plan(&[p], &[rect(100, 100)], Direction::RightToLeft).is_err());
    }
}

#[test]
fn rejects_zero_metrics_and_invalid_empty_paragraph() {
    for (count, width, advance, ink) in [(1, 0, 1, 1), (1, 1, 0, 1), (1, 1, 1, 0), (1, 1, 1, 2)] {
        let mut p = paragraph(count, width, advance, 0);
        p.units[0].width = ink;
        assert!(plan(&[p], &[rect(100, 100)], Direction::RightToLeft).is_err());
    }
    let mut p = paragraph(1, 1, 1, 0);
    p.char_count = 0;
    assert!(plan(&[p], &[rect(100, 100)], Direction::RightToLeft).is_err());
}

#[test]
fn rejects_coordinate_overflow_and_zero_frame_dimensions() {
    for f in [
        Rect {
            x: i64::MAX,
            y: 0,
            width: 1,
            height: 1,
        },
        Rect {
            x: 0,
            y: i64::MAX,
            width: 1,
            height: 1,
        },
        rect(0, 1),
        rect(1, 0),
    ] {
        assert_eq!(
            plan(&[], &[f], Direction::RightToLeft),
            Err(Error::InvalidFrame { frame_index: 0 })
        );
    }
    let p = vec![paragraph(1, 1, 1, 0)];
    let f = vec![Rect {
        x: i64::MIN,
        y: i64::MIN,
        width: 1,
        height: 1,
    }];
    let plan = plan(&p, &f, Direction::RightToLeft).unwrap();
    verify(&p, &f, Direction::RightToLeft, &plan);
}

#[test]
fn empty_input_returns_empty_plan() {
    assert_eq!(
        plan(&[], &[], Direction::RightToLeft),
        Ok(Plan { fragments: vec![] })
    );
}

#[test]
fn deterministic_generated_cases_check_every_scalar_once_and_every_box() {
    let mut seed = 0x70c52u64;
    let mut next = || {
        seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1);
        (seed >> 32) as u32
    };
    for case in 0..600 {
        let mut p = Vec::new();
        for _ in 0..next() % 8 + 1 {
            let width = next() % 24 + 1;
            let count = next() % 40;
            let mut end = 0;
            let mut units = Vec::new();
            for _ in 0..count {
                let start = end;
                end += (next() % 4 + 1) as usize;
                units.push(Unit {
                    source: start..end,
                    advance: next() % 30 + 1,
                    width: next() % width + 1,
                });
            }
            p.push(Paragraph {
                char_count: end,
                column_width: width,
                gap_after: next() % 12,
                units,
            });
        }
        let f: Vec<_> = (0..400)
            .map(|i| Rect {
                x: i64::from(i) - 200,
                y: case - 300,
                width: next() % 80 + 24,
                height: next() % 90 + 30,
            })
            .collect();
        for direction in [Direction::RightToLeft, Direction::LeftToRight] {
            let plan = plan(&p, &f, direction).unwrap();
            verify(&p, &f, direction, &plan);
        }
    }
}

#[test]
fn caller_supplied_rotated_and_upright_metrics_change_breaks_keep_identity() {
    // Geometry contract only: these are supplied metrics, not font-shaping output.
    let upright = vec![paragraph(4, 10, 10, 0)];
    let mut rotated = upright.clone();
    rotated[0].units[1].advance = 5;
    rotated[0].units[3].advance = 5;
    let frames = vec![rect(10, 15); 4];
    let up = plan(&upright, &frames, Direction::RightToLeft).unwrap();
    let rot = plan(&rotated, &frames, Direction::RightToLeft).unwrap();
    verify(&upright, &frames, Direction::RightToLeft, &up);
    verify(&rotated, &frames, Direction::RightToLeft, &rot);
    assert_eq!(up.fragments.len(), 4);
    assert_eq!(rot.fragments.len(), 2);
    assert_eq!(rot.fragments[0].columns[0].source, 0..2);
}

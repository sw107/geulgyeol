//! Read-only diagnostic adapter for project-vertical-cell-plan.mjs JSON output.
use rhwp_vertical_cell_plan::{plan, Column, Direction, Error, Paragraph, Plan, Rect, Unit};
use serde_json::{json, Value};
use std::{env, fs};

fn u32_field(v: &Value, key: &str) -> u32 {
    u32::try_from(v[key].as_u64().unwrap()).unwrap()
}
fn rect(v: &Value) -> Rect {
    Rect {
        x: v["x"].as_i64().unwrap(),
        y: v["y"].as_i64().unwrap(),
        width: u32_field(v, "width"),
        height: u32_field(v, "height"),
    }
}
fn contained(inner: Rect, outer: Rect) -> bool {
    inner.x >= outer.x
        && inner.y >= outer.y
        && i128::from(inner.x) + i128::from(inner.width)
            <= i128::from(outer.x) + i128::from(outer.width)
        && i128::from(inner.y) + i128::from(inner.height)
            <= i128::from(outer.y) + i128::from(outer.height)
}
fn box_json(b: Rect) -> Value {
    json!({"x":b.x,"y":b.y,"width":b.width,"height":b.height})
}
// Independent source conservation/boundary audit of the returned plan.
fn audit(paras: &[Paragraph], frames: &[Rect], result: &Plan) -> Value {
    let expected: Vec<_> = paras
        .iter()
        .enumerate()
        .flat_map(|(pi, p)| p.units.iter().map(move |u| (pi, u.source.clone())))
        .collect();
    let mut actual = Vec::new();
    let mut owners: Vec<Vec<u32>> = paras.iter().map(|p| vec![0; p.char_count]).collect();
    let mut empties = vec![0; paras.len()];
    let mut column_counts = vec![0; paras.len()];
    let mut last_frame = None;
    let mut last_pi = 0;
    for f in &result.fragments {
        assert!(last_frame.is_none_or(|i| i < f.frame_index));
        last_frame = Some(f.frame_index);
        let mut previous: Option<&Column> = None;
        for c in &f.columns {
            assert!(c.paragraph_index >= last_pi);
            last_pi = c.paragraph_index;
            let p = &paras[c.paragraph_index];
            assert_eq!(c.paragraph_column_index, column_counts[c.paragraph_index]);
            column_counts[c.paragraph_index] += 1;
            assert!(contained(c.bounds, frames[f.frame_index]));
            if let Some(prev) = previous {
                assert_eq!(
                    i128::from(c.bounds.x)
                        + i128::from(c.bounds.width)
                        + i128::from(paras[prev.paragraph_index].gap_after),
                    i128::from(prev.bounds.x)
                );
            }
            previous = Some(c);
            if p.char_count == 0 {
                assert_eq!(c.source, 0..0);
                assert!(c.units.is_empty());
                empties[c.paragraph_index] += 1;
            } else {
                assert_eq!(c.source.start, c.units[0].source.start);
                assert_eq!(c.source.end, c.units.last().unwrap().source.end);
            }
            let mut next_y = c.bounds.y;
            for u in &c.units {
                assert!(contained(u.bounds, c.bounds));
                assert_eq!(u.bounds.y, next_y);
                next_y += i64::from(u.bounds.height);
                actual.push((c.paragraph_index, u.source.clone()));
                for count in &mut owners[c.paragraph_index][u.source.clone()] {
                    *count += 1;
                }
            }
            assert_eq!(i64::from(c.used_height), next_y - c.bounds.y);
        }
    }
    assert_eq!(actual, expected);
    for (i, p) in paras.iter().enumerate() {
        assert!(owners[i].iter().all(|n| *n == 1));
        assert_eq!(empties[i], u32::from(p.char_count == 0));
    }
    json!({"scalars":owners.iter().map(Vec::len).sum::<usize>(),"duplicateOwners":0,
        "missingOwners":0,"sourceUnitOrderPreserved":true,"originalParagraphIndexesPreserved":true,
        "boundsViolations":0,"columns":column_counts.iter().sum::<usize>()})
}
fn main() {
    let args: Vec<_> = env::args().collect();
    assert_eq!(args.len(), 3, "INPUT_JSON OUTPUT_JSON");
    let input: Value = serde_json::from_slice(&fs::read(&args[1]).unwrap()).unwrap();
    assert_eq!(input["productionIntegrated"], false);
    let mut cases = Vec::new();
    for f in input["fixtures"].as_array().unwrap() {
        assert_eq!(f["productionEligible"], false);
        assert_eq!(f["sourceHasNumbering"], true);
        let paras: Vec<_> = f["paragraphs"]
            .as_array()
            .unwrap()
            .iter()
            .map(|p| {
                let count = usize::try_from(p["charCount"].as_u64().unwrap()).unwrap();
                assert_eq!(p["text"].as_str().unwrap().chars().count(), count);
                Paragraph {
                    char_count: count,
                    column_width: u32_field(p, "columnWidth"),
                    gap_after: u32_field(p, "gapAfter"),
                    units: p["units"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .map(|u| Unit {
                            source: usize::try_from(u["source"][0].as_u64().unwrap()).unwrap()
                                ..usize::try_from(u["source"][1].as_u64().unwrap()).unwrap(),
                            advance: u32_field(u, "advance"),
                            width: u32_field(u, "width"),
                        })
                        .collect(),
                }
            })
            .collect();
        let mut frames: Vec<_> = f["frames"].as_array().unwrap().iter().map(rect).collect();
        let original_frame_count = frames.len();
        let initial = plan(&paras, &frames, Direction::RightToLeft);
        if paras.len() == 124 {
            assert!(matches!(&initial, Err(Error::InsufficientFrames { .. })));
        } else {
            assert!(initial.is_ok());
        }
        let initial_status = match &initial {
            Ok(_) => "complete".to_owned(),
            Err(e) => format!("{e:?}"),
        };
        let mut attempt = initial;
        // Supply hypothetical extra budgets. This does NOT allocate rhwp pages.
        while matches!(attempt, Err(Error::InsufficientFrames { .. })) && frames.len() < 64 {
            frames.push(rect(&f["hypotheticalContinuation"]));
            attempt = plan(&paras, &frames, Direction::RightToLeft);
        }
        let result = attempt.expect("bounded synthetic projection must obtain a complete plan");
        let ownership = audit(&paras, &frames, &result);
        let fragments: Vec<_>=result.fragments.iter().map(|f|json!({
            "frameIndex":f.frame_index,"bounds":box_json(frames[f.frame_index]),
            "columns":f.columns.iter().map(|c|json!({"paragraph":c.paragraph_index,
                "paragraphColumn":c.paragraph_column_index,"source":[c.source.start,c.source.end],
                "bounds":box_json(c.bounds),"usedHeight":c.used_height,
                "units":c.units.iter().map(|u|json!({"source":[u.source.start,u.source.end],"bounds":box_json(u.bounds)})).collect::<Vec<_>>()
            })).collect::<Vec<_>>()
        })).collect();
        cases.push(json!({"id":f["id"],"sourceFile":f["sourceFile"],"sourceSHA256":f["sourceSHA256"],
            "sourceDirection":f["sourceDirection"],"sourceHasNumbering":true,"productionEligible":false,
            "paragraphs":paras.len(),"suppliedActualFrames":original_frame_count,"initialStatus":initial_status,
            "hypotheticalAdditionalFrames":frames.len()-original_frame_count,"plannedFragments":result.fragments.len(),
            "ownership":ownership,"fragments":fragments}));
    }
    // Same extracted source and geometry must produce identical HWP/HWPX plans.
    for pair in cases.chunks_exact(2) {
        assert_eq!(pair[0]["ownership"], pair[1]["ownership"]);
        assert_eq!(pair[0]["fragments"], pair[1]["fragments"]);
    }
    let proof = json!({"engineSHA256":input["engineSHA256"],"productionIntegrated":false,
        "paginationFixed":false,"fontShapingVerified":false,"GUIVerified":false,"cases":cases});
    fs::write(&args[2], serde_json::to_vec_pretty(&proof).unwrap()).unwrap();
    println!(
        "Verified {} independent text projections, including HWP/HWPX plan equality.",
        proof["cases"].as_array().unwrap().len()
    );
}

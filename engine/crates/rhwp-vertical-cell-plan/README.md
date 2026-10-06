# Experimental vertical cell ownership plan

This std-only library is an independent calculation prototype. `rhwp` does not
have a dependency on it. No measurement, pagination, renderer, API, UI, history,
or serializer uses it. `serde_json` is a dev dependency for the diagnostic example
only. Do not describe this work as a vertical pagination fix.

## Contract

Input is one ordinary text cell with ordered paragraphs and ordered **usable**
fragment rectangles, after the caller has resolved padding and constraints.
Lengths use integer 1/1024 pixels; signed coordinates allow negative origins.
Quantize rectangle edges inward (ceil left/top, floor right/bottom) and measured
advances/ink extents outward. Positive dimensions and checked coordinate edges
are mandatory. Available geometry is an explicit budget, never inferred from
stored horizontal lines or a reused page cut.

A paragraph has a reserved column width, cross-axis gap, scalar count, and measured
units. Unit source ranges must form an exact contiguous partition of the original
Unicode **scalar** sequence. UTF-8 byte indexes are not acceptable. The shaping
adapter must keep combining marks, variation selectors, ZWJ sequences, and other
indivisible clusters in one unit. It must supply positive advance and width that
bound actual post-rotation ink. This crate neither segments graphemes nor shapes
fonts; accepting a valid input does not prove that the caller shaped it correctly.
HWP direction 1/2 both use right-to-left columns. Their rotation and glyph metrics
are resolved by the caller; the scalar source itself is never rewritten here.

Paragraphs start new columns. Units progress top to bottom. The next unit goes to
a new column if it cannot fit in the remaining height. A new frame is needed if
column width plus the previous column's gap cannot fit, or the next unit cannot
fit that frame's height. Gaps are reset across frame boundaries. Empty paragraphs
reserve one column and one 0..0 semantic marker. This explicit baseline policy
has no widow/orphan, keep-with-next, stored-line, alignment, or justification rules.

Output retains original paragraph index, paragraph column index, scalar range,
original input frame index, reserved column rectangle, consumed height, and unit
rectangles. Frames skipped for insufficient space keep their indexes. A successful
plan covers every input scalar exactly once in original order. Empty paragraphs
also have one marker. Output boxes stay within the provided frame; clipping is not
used to rescue an overflowing plan. Invalid input, an unplaceable column/unit,
or exhausted frames yields an error with **no partial plan** and no input mutation.
The caller may supply more frames and retry exhaustion, before publishing any
layout tree. Each call recomputes from original input, so retries do not duplicate
source ownership.

## Independent verification

Run from the repository root with the existing offline Cargo cache/target, debug
info disabled and incremental compilation off:

```sh
cargo test --offline --locked --manifest-path engine/Cargo.toml -p rhwp-vertical-cell-plan
cargo clippy --offline --locked --manifest-path engine/Cargo.toml -p rhwp-vertical-cell-plan --all-targets -- -D warnings
cargo clippy --offline --locked --manifest-path engine/Cargo.toml -p rhwp-vertical-cell-plan --lib --target wasm32-unknown-unknown -- -D warnings
```

`tests/ownership.rs` independently enumerates each original scalar and unit. It
checks ownership, source and column order, empty markers, gaps, bounds, long text,
variable metrics, shaped mixed-script clusters, exact fixed-point edges, skipped
frames, exhaustion, malformed ranges, and overflow. Deterministic generation runs
600 inputs in both column directions (1,200 ownership audits).

`scripts/project-vertical-cell-plan.mjs ENGINE_DIR DIAGNOSIS_DIR INPUT_JSON` reads
the prior synthetic diagnostic HWP/HWPX files using the unchanged WASM. It extracts
left-cell text and actual cell fragment boxes, resolves **only those fixtures'**
known padding, and supplies conservative square font metrics. It does not mutate
source files. The original files include numbering and two cells; they are marked
`productionEligible:false`. Their plain-text projection deliberately excludes
numbering and surrounding row semantics. It is not a complete document adapter.

```sh
cargo run --offline --locked --manifest-path engine/Cargo.toml -p rhwp-vertical-cell-plan --example plan_fixture -- INPUT_JSON OUTPUT_JSON
```

The example audits all source units and boxes, rejects the insufficient original
four-frame budget for 124 paragraphs, and separately retries with explicit
**hypothetical** continuation frames. Those frames are not allocated rhwp pages.
HWP/HWPX input pairs must produce identical plans. Conservative metrics are not
real font/GUI evidence.

## Future integration and fallback

Before wiring this into rhwp, add one complete, preflighted plain-cell adapter.
It must resolve style/rotation metrics and usable rectangles consistently in both
measurement and rendering, preserve original scalar/paragraph identity, and fail
before any tree/cache mutation. Production must continue through the existing
legacy path on an ineligible input or an incomplete/rejected plan. Never apply a
successful prefix and then fall back for the remaining text.

The initial eligibility gate must exclude numbering/bullets, merged/nested cells,
images/equations/other controls, fields/range tags, linked flow/text boxes, complex
scripts without proven shaping, invalid directions, special stored positions,
SQUEEZE/justification/alignment rules not represented here, and unresolved page,
row, or keep-with-next constraints. Oversized units cannot be silently clipped.
Failure to allocate a complete frame budget is also a whole-cell fallback. Mixed
plain Korean/Latin/emoji is eligible only after the shaping/rotation adapter can
supply validated indivisible units and ink bounds.

Integration touch points (unchanged now):

- `engine/src/renderer/layout/table_layout.rs`: `cell_units_uncached` and
  `calc_vertical_cell_content_height` must share the plan's column/character budget
  with pagination. Existing horizontal CellUnit heights cannot stand in for x-axis
  column consumption. Neighbor cells and row-break/height policy still need design.
- `engine/src/renderer/layout/table_partial.rs`: select planned fragment owners;
  pass original indexes and ranges. Do not slice paragraphs and reset identities.
- `engine/src/renderer/layout/table_cell_content.rs`: emit selected units using the
  plan, without recomposing the whole cell per fragment. Preserve style/reference
  indexes, `cell_context`, `para_index`, `char_start`, carets and original text.
- SVG cell clipping remains the final rendering boundary. A valid plan must already
  fit it. Production integration requires real render-tree ownership/bounds, edits,
  undo/redo, HWP/HWPX reopen and horizontal regressions, followed by actual Mac GUI.

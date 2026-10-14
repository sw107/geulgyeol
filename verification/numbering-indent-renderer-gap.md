# Open renderer item: numbering continuation indent

Status: open, existing behavior; outside the serialization fix in PR #50. No renderer/product code was changed to address it.

In the numeric synthetic first paragraph with `useInstWidth=0` and `autoIndent=0`, Hancom Office HWP 12.30.0 (6544) continues the second line at the body left margin. The production Geulgyeol QA app continues under the text after the number. Opening either the Geulgyeol HWP or HWPX output in Hancom displays the Hancom placement. A one-page result or preserved numbering bits does not imply matching line layout or glyph output.

Fresh evidence uses the *same bytes* for three inputs: the original numeric HWPX, the Hancom-edited HWPX and the production Geulgyeol HWP. The retained pre-fix WASM (`ac622053d7e8fa16d3474f8c3c9a4b252e4d735fa6e4d132884ed5b7885ffc69`) and fixed WASM (`ef7644144be504064fa3448d7f3a76c1793b60efe679f72bc34d3212419aefc0`) produced byte-identical SVG pages, matching page counts and paragraph state for all three. The baseline HWP export separately reproduces loss of the true flags; the fixed export retains them. Thus, in these cases the parser fix changes serialization while the observed renderer gap predates it. This is supplementary engine evidence, not a claim of a newly executed baseline Mac GUI suite or universal layout non-regression.

Local evidence: `evidence/followup-hancom/render-comparison.json`, baseline/fixed `*.svg`, `numbering-save-bits.json`, `native-ui-observations.json`, and `packaged-back/*.png`, under the `numbering-head-flags` QA root. Native Hancom screenshots are in the task's CUA tool outputs.

Future renderer work should model the two bits in line layout, compare all four boolean combinations and mixed numbering levels in the installed Hancom editor, and verify both exports and fresh reopens. It requires a separate implementation and review; this item is not resolved by PR #50.

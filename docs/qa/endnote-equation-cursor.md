# Endnote equation text caret: source characters and render slots

On main `d0ae3d05808673a103adaddcf36a63152f1c6a07`, a final inline
equation followed by `EQ_END` reproduces the PR89 observation: requesting note
offset 0 displays the caret at the end of the paragraph. A generic hit test there
returns logical slot 7. The original PR89 review recorded 24 such observations
across six cases and four history states; it did not certify equation-paragraph
text editing.

The public note text insertion API edits Unicode scalar positions in `Paragraph.text`.
The renderer and generic `hitTest` also count inline objects as logical slots.
For the example above, source offset 1 inserts after `E`, while its old displayed
caret sits before `E`. Source offset 6 inserts at the end, while its displayed
caret sits before the final character. Data was inserted at the requested source
position; the displayed caret was wrong. The observed X errors were 64.4px at
offset 0, 8.4px at offset 1, and 9.6px at offset 6.

The candidate converts equation-containing endnote source positions with the
existing `text_to_logical_offset` helper, then retains the existing first-paragraph
number-prefix adjustment. It uses the existing inline-object caret path for these
paragraphs instead of a text-run-only lookup that falls back to the last run.
Deferred notes match equation bounds by their complete source note reference,
since the equation keeps its source section while text belongs to the render owner.
Plain-note paths, public ABI, input code, generic hit testing, layout and serializers
remain unchanged.

## Scope of the checks

- Native and public WASM: 15 synthetic variants and 99 scalar positions, including
  first/middle/trailing and adjacent equations, empty text, Unicode, first-note
  numbering and notes deferred into another section. Baseline geometric failures:
  65; candidate: zero. Native additionally checks the actual inserted marker glyph,
  source/control properties, cold reopening and snapshot undo/redo.
- Unmodified production Cursor Home/End/updateRect, plain input, note command and
  CommandHistory methods with DOM/dispatch adapters: 23 ASCII-origin Home/End cases,
  23 non-BMP insertions and 46 undo/redo actions. Baseline failures: 17; candidate:
  zero. This is not an actual Electron or physical IME run.
- Every focused source/render/history view remains exactly equal to baseline.
  Candidate and baseline ZIP entry contents match for 99 SDK edits and 23 adapted
  input/history saves, with all XML members well formed.
- Existing 35-document regression: 140 stages, 280 complete SDK views and 140 saved
  archives exactly equal current main. PR92 control-character checks, Studio/SDK
  type checks, 20 host tests and 90 Studio tests also pass.

The existing body-caret measurement differs from the inserted glyph start by up
to 0.454px in these fixtures. The candidate does not worsen that measurement.
Existing saved line boxes can differ vertically by 2/3px, and inverse-command
history can change the rounded caret Y by 0.6px. Those baseline observations remain
visible, bounded by 0.7px; source, page, X and height restoration are checked
separately. SDK snapshot restoration and baseline/candidate render comparisons
remain exact. This patch does not repair those older rounding differences.

## Repeatable focused checks

```sh
cargo run --offline --locked --manifest-path engine/Cargo.toml --example endnote_object_repro -- seed engine/examples/fixtures/endnote-unequal-two.hwpx /absolute/fresh-seeds
python3 scripts/make-endnote-equation-cursor-fixtures.py /absolute/fresh-seeds/equation-after-text.hwpx /absolute/fresh-fixtures
cargo run --offline --locked --manifest-path engine/Cargo.toml --example endnote_equation_cursor_check -- fixed /absolute/fresh-fixtures/manifest.json /absolute/fresh-native
node scripts/build-wasm-release.mjs /absolute/fresh-sdk/pkg
node scripts/check-endnote-equation-cursor.mjs fixed /absolute/fresh-sdk/pkg /absolute/fresh-fixtures/manifest.json /absolute/fresh-native/raw.json /absolute/fresh-sdk-check
node scripts/check-endnote-equation-input.mjs /absolute/fresh-sdk/pkg /absolute/fresh-fixtures/manifest.json /absolute/fresh-native/raw.json /absolute/fresh-input-check fixed
```

The generator edits synthetic copies only. It canonicalizes the known retained
seed's unbound `ns0:paraHead` prefix to the declared head prefix, assigns distinct
paragraph/equation IDs and preserves original ZIP compression methods. Failed
preparation attempts are retained separately; no product namespace repair is part
of this change.

## Remaining limits

Generic `hitTest` is a logical-slot text lookup, not an inverse of source-scalar
note editing. At an equation boundary it can choose the adjacent text position;
before/after-object affinity and mouse object selection are separate concerns.
No new full rich-object editor, physical keyboard/IME, pending-format selection,
or non-BMP arrow/Home-End behavior is certified. Existing excluded mixed-object
overflow layouts remain excluded. Independent review and actual-app QA of the
new head/SDK are required before merge. Genuine Hancom interoperability remains
unverified. Full Rust unit compilation is blocked by the same four missing inputs
listed in `note-control-text.md`; no CI success is claimed.

## Control marks display regression (independent PR93 P2)

At reviewed head `3ae98e2893908698f159d98adb790b5560256023`, enabling
View → control marks (`ctrl=true`, `para=true`) skips the shared inline-flow
resolver. The new endnote equation route still passes a logical offset to the
general marked-control fallback. In `unicode-first` (`한😀é𐐷Z`), source EOF 6
displays x=20 while actual text insertion starts at x=80.4; saved/reopened EOF
after `◆😀` retains an 80.4px error. The independent actual-app review confirmed
these errors; this is separate from object affinity, Unicode navigation and the
existing subpixel measurement differences above.

The correction keeps the inline equation resolver enabled for virtual endnote
paragraphs containing an inline equation in either display mode. Body and plain
note paths keep their existing display-mode policy. Source offsets, input,
serialization and rendered layout are unchanged.

```sh
node scripts/check-endnote-equation-marks.mjs observe /absolute/reviewed-sdk/pkg /absolute/fixtures/manifest.json /absolute/fresh-baseline
node scripts/check-endnote-equation-marks.mjs fixed /absolute/new-sdk/pkg /absolute/fixtures/manifest.json /absolute/fresh-candidate /absolute/fresh-baseline/raw.json
```

This check covers all 15 fixtures and 99 scalar positions in all four independent
control-code/paragraph-mark flag combinations. Each position checks before/after
insertion, snapshot undo/redo, and saved-file reopening in the same Node PID and a
fresh Node PID (2,376 caret-to-independent-insertion-glyph probes). It checks source,
render and archive equality against the reviewed SDK. The 0.615px X bound retains
the existing measured glyph rounding; page identity is exact. This is public SDK
QA, not an Electron, physical keyboard/IME, or Hancom test. A new independent
actual-app run on the revised pinned head/SDK remains required before merge.

Fresh SDK observations against current main and the reviewed PR93 SDK separate
this regression from the original caret defect: main has 456 failing probes;
reviewed PR93 fixes those but introduces 492 failures in the control-code display
mode. The corrected SDK has zero failures across all 2,376 probes (maximum
rounded glyph X difference 0.5px). The exact Unicode P2 has zero X difference both
before insertion and after same/fresh-Node-PID reopening. All 396 saved mark-mode
archives are byte-identical to the reviewed SDK. Default Native/SDK 99-position
checks, 23 adapted production-method inputs, 35-document regression, PR92 control
checks, both type checks and 110 host/Studio unit tests also pass again.

Independent XML checks cover 813 archive pairs whose ZIP member bytes remain
identical to the prior reviewed outputs. The 140 old 35-document regression saves
retain their original unbound header prefix; the other 673 saves have well-formed
XML. These legacy fixture defects are not new regressions or a Hancom pass.

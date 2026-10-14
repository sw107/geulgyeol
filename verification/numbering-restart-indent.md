# Paragraph NewStart replay across body-page continuations

PR #51 follow-up from `82de34d8939cba1e4becb834348d259680fece43`. The fix remains on `dev/numbering-continuation-indent`; merge requires independent review.

## Reproducer and minimum change

Synthetic shared numbering definition: start **1**, level 0, decimal `^1.`, `useInstWidth=1`, `autoIndent=1`, zero width adjustment / text distance. Paragraphs are `BEFORE`, a three-page paragraph with runtime **NewStart(123)**, then `AFTER`. Earlier coverage used definition start 123 and therefore missed this case.

With the previous WASM (`2974efdd…cb69fbc`), first-page body x was **139.4**, later-page x **124.4** for 71 line starts, and markers were `1.`, `123.`, `3.`. Previous-page replay called `advance(..., None)`, losing the paragraph restart. The continuation helper consequently recovered a counter for 2 instead of 123, and the following paragraph reached 3.

Previous-page replay now passes `para.numbering_restart` into the existing `NumberingState::advance`. The old public two-argument `advance_numbering` retains its no-restart behavior; a crate-local helper carries the restart. No counter rule, number format, serializer, or cell-continuation path is redesigned.

Final WASM SHA-256: `f37c7fc8c1671f415a2fd4c4ebc695fe0a8042d458d48905b9d10842323d5847`.

## Fresh checks

QA root: `/Users/sw107/Documents/Codex/2026-10-14/task/numbering-restart-indent`.

- Native `numbering_restart_indent_check`: definition start / applied head bits / runtime NewStart asserted; first and all 71 later line starts **139.4**, markers `1.`, `123.`, `124.`; forward/reverse page-query results agree. Four alternating HWPX/HWP reloads with explicit restart reapplication retain positions and text.
- Real WASM `check-numbering-restart-indent.mjs`: same input bytes and same assertions; previous build reproduces the gap, final build passes; four reloads with restart explicitly reapplied.
- Actual Mac Electron source-QA `check-electron-numbering-restart.mjs`: previous/final WASM loaded into separate owned runtimes. Real bridge/history applies NewStart; previous x=124.4 / next=3, final x=139.4 / next=124. Undo produces `1.,2.,3.`, redo restores the restart layout. Both HWP/HWPX outputs reload, restart is reapplied, and positions/text agree. Loaded engine hashes and normal exit 0 are recorded. Screenshots visibly include the first-page `123.RESTART` and a later-page continuation. QA handles are instrumented; native choosers are controlled. This is not physical keyboard/IME or genuine save-chooser coverage.
- Ordinary production Mac package: final engine hash and 80 ASAR source files verified, ad hoc signature verified. Public API edits and 12 HWP/HWPX reopens across standalone text, the two Hancom matrix documents before/after insertion, and the nine-page control pass, with normal exit 0. This package does not expose the source-QA handles. The runtime NewStart-specific check above is a separate source-QA result.
- Existing four-flag body checks: ten reloads, exact nonnumbered SVG control, nine-page definition-start-123 control with 190 later line starts. Existing body numbering: 20 cases / 44 reloads. Nested-cell numbering: 78 cases / 156 reloads; labels/properties/history/save only.
- Existing flag regression: Native 28 parser contracts / six paths / 30 reloads; real WASM six paths / 30 reloads. Forty fresh binary/XML exports inspected for head bits, including ten NewStart-test exports; original flag fixtures retain sentinel/zero character references.
- `tsc --noEmit` passes. Desktop tests: 82 pass, one skip. Full Rust lib tests remain unavailable because the checkout lacks the three embedded samples already listed in the initial validation document; those tests are not counted as passed. No CI success is inferred from an empty check list.

Reproduction:

```sh
node scripts/check-numbering-restart-indent.mjs ENGINE_PKG FRESH_OUTPUT baseline
node scripts/check-numbering-restart-indent.mjs FIXED_PKG FRESH_OUTPUT fixed BASELINE_OUTPUT/restart.hwpx
cargo run --manifest-path engine/Cargo.toml -p rhwp --example numbering_restart_indent_check -- INPUT_HWPX FRESH_OUTPUT
node scripts/check-electron-numbering-restart.mjs RUNTIME_ROOT ENGINE_PKG INPUT_HWPX FRESH_OUTPUT baseline-or-fixed
```

Use `build-electron-table-qa.mjs` without production mode to prepare the isolated source-QA runtime. The final ordinary bundle is built separately with production mode. Local raw evidence: `evidence/run/baseline-retry`, `native-final`, `wasm`, `mac-baseline`, `mac-fixed`, `packaged`, `export-bits-proof.json`; root logs retain all commands' results. `source-preservation.json` rechecks the original dirty checkout's status, binary diff hash and untracked hashes.

## Boundaries

`numbering_restart` is an editing-state attribute that the existing HWP/HWPX serializer does not retain. The restart tests explicitly apply it **after each load**, and the Mac source-QA check uses the real bridge mutation/history path. These reload checks prove restart-aware rendering on loaded documents; they do not claim NewStart persistence. That existing serialization limitation is not repaired by this replay fix.

The 78 nested-cell cases do **not** verify four-flag cell coordinates. Split cells still apply head metadata only for `start_line == 0`; `start_line > 0` cell continuations remain an existing open gap. General wrapping/font fidelity, Roman fixed areas, and the earlier pending physical keyboard/native chooser/Hancom-final-reopen cycle remain outside this correction. No user original or unsaved document is closed or overwritten.

# Numbering continuation indentation — limited renderer fix

Base: merged main `e760e9d600229c7507dcbd6adaecd3c84f15de5d` (PR #50). Branch: `dev/numbering-continuation-indent`. All inputs are synthetic. The original dirty checkout and user documents are preserved.

## Observed behavior and implementation

Installed editing application: **한컴오피스 한글**, `/Applications/Hancom Office HWP.app`, version **12.30.0 (6544)**. Native CUA opened and saved the four combinations as new HWPX files, using decimal `123.`, second-level `1.123.`, and Roman `CXXIII.` markers. No license, login or new agreement was accepted.

| useInstWidth | autoIndent | Decimal first body line | Continuation |
|---|---|---|---|
| 0 | 0 | single-number reference area | paragraph left margin |
| 1 | 0 | actual marker area | paragraph left margin |
| 0 | 1 | single-number reference area | same reference area |
| 1 | 1 | actual marker area | same actual area |

The existing renderer always used actual marker width and hung every line. It now derives layout-only metadata from a valid stored numbering head. Bit 3 controls continuation placement and available line width. Bit 2 selects actual width or a decimal reference expansion with counter/start 1. Marker glyph bounds remain independent of the reserved area; this preserves the visible overlap Hancom itself shows for `123.` in a fixed one-digit area.

Fixed-width projection is deliberately limited to **decimal references with zero width adjustment and zero text distance**. Roman fixed areas did not match an `I.` reference in Hancom, so that calculation remains open; nondecimal or adjusted heads retain their previous width estimate. Automatic indentation still follows bit 3. Bullets and synthesized outline definitions retain their previous layout.

A later-page PartialParagraph formerly received an unnumbered composition. The continuation path now reads the current/history counter without advancing it, resolves the existing head and restores its automatic area. It emits no repeated marker.

The HWP v5 [official format specification](https://cdn.hancom.com/link/docs/한글문서파일형식_5.0_revision1.3.pdf), table 40, defines these two bits. Hancom's [number-area help](https://help.hancom.com/hoffice/multi/ko_kr/hwp/format/numberbullet(position).htm) describes actual digit-width fitting and a fixed one-digit area. The scoped decimal reference calculation is supported additionally by the installed app observations above.

## Reproduction and evidence

QA root: `/Users/sw107/Documents/Codex/2026-10-14/task/numbering-continuation-indent`.

- `scripts/prepare-numbering-indent-fixtures.mjs ENGINE_PKG FRESH_OUTPUT` emits the four combinations, decimal / second-level decimal / Roman controls. ZIP member metadata is retained, including the stored `mimetype` member. A failed compressed-mimetype draft was retained locally and excluded from oracle results.
- `engine/examples/numbering_indent_check.rs INPUT_HWPX FRESH_OUTPUT` asserts applied flags, first/continuation positions, text and four alternating HWPX/HWP reopens, using the real native crate.
- `scripts/check-numbering-indent.mjs ENGINE_PKG FIXTURES FRESH_OUTPUT BASELINE_PKG` checks four-combination positions, ten alternating saves/reopens, a nonnumbered wrapped control with exact SVG equality, and later-page indentation / counter continuity.
- `scripts/check-packaged-numbering-indent.mjs FRESH_OUTPUT APP ENGINE_PKG HANCOM_INPUT_DIR` runs the actual Mac production bundle through its public host/plugin APIs, checks the served WASM hash and ASAR source files, edits both matrix documents and exports/reopens both formats. It does not substitute a save dialog or expose private renderer handles.

Native Hancom observations and screenshots are in this task's CUA outputs. Saved oracle files and their embedded previews are in `evidence/matrix/inputs/hancom-*.hwpx` and `evidence/matrix/hancom-*-preview.png`. Programmatic Mac screenshots, launch/quit records and saves are in the packaged evidence directories. Old and final builds have separate evidence directories; failed attempts are retained.

The existing body and cell numbering harnesses required the current real DocumentWriteFence to be installed in their bridge adapters. Cell fixtures can now be selected through `GEULGYEOL_NESTED_PARAGRAPH_PROOF`; no fixture is fabricated or replaced.

## Final recorded checks

Final WASM SHA-256: `2974efdd669b35d5bc7bd45ea3fd1d6d16ede2206f4181f3f75522a76cb69fbc`.

- Native four-combination checks: cached Hancom decimal / multilevel and cache-free decimal / multilevel; 16 HWP/HWPX reopens.
- Real WASM: ten alternating reopens, nonnumbered wrapped control exact SVG equality, nine-page hard-break document with 190 later-page line starts and exactly four `123.` markers followed by `124.`.
- Existing body numbering: 20 cases, 44 reopens; nested cell numbering: 78 cases, 156 reopens. Existing flag WASM regression: six paths, 30 reopens. Native flag regression: 28 parser contracts, six paths and 30 reopens.
- Actual production Mac bundle: public API edit/export/reopen checks, 12 reopens across standalone text, both Hancom matrix documents before/after insertion, and the nine-page document; served engine hash verified, normal app quit with exit 0. Forty final binary/XML exports inspected for flags; original flag fixtures also retain sentinel/zero character references.
- TypeScript `tsc --noEmit`: exit 0. Desktop tests: 82 passed, one skipped after enabling their required temporary localhost binding.
- ASAR contents: 80 files matched the staged ordinary runtime; ad hoc bundle signature verified. Original dirty checkout status, binary diff hash and untracked file hashes match the preservation record.

Final evidence: `evidence/matrix/wasm-pagination-delivery`, `native-pagination-*`, `body-pagination-final`, `cell-pagination-final`, `flags-pagination-final`, `packaged-pagination-final`, `final-export-bits-proof.json`, plus `validation-final.json` and `package-proof-pagination.json` in the QA root.

## Limits and remaining work

This fixes head-dependent horizontal placement, not general Hancom page fidelity. Soft-wrap boundaries, justification spacing, font metrics, number-specific character styles, number alignment, width adjustment and text-distance units are not redesigned. The actual Mac screenshot still shows an existing first-row overflow / hard-break spacing gap. Matching paragraph count, text, flags or starting x coordinates is not pixel equality.

The additional native screen-control call was interrupted. Therefore fresh physical keyboard editing, native Geulgyeol save-chooser use, and Hancom reopening the final edited outputs are **pending**, separate from the completed public-API Mac app checks. An isolated QA app window may remain open; no user document was closed.

`cargo test -p rhwp --lib` cannot compile because this checkout lacks three embedded samples: `samples/3-09월_교육_통합_2022.hwp`, `samples/hwp3-sample16-hwp5.hwp`, and `samples/hwpx/aift.hwpx`. Native executable checks and production native/WASM builds do not replace that suite. No CI check is claimed where GitHub reports none. Independent review and merge remain with the parent.

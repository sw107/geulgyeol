# HWPX numbering head flag preservation

HWPX `useInstWidth` and `autoIndent` now populate HWP numbering-head attribute bits 2 and 3. Previously the raw HWPX XML survived an HWPX save, but an HWP save lost these flags. Missing flag attributes retain the existing zero behavior. The boundary-value evidence below is scoped by execution path. Raw para-head XML, including levels 8–10 beyond the seven-level HWP model, is preserved on direct HWPX saves; this is not a claim that those levels survive a bridge through HWP.

The production change is five parser lines. Parser regressions were added for numeric and XML boolean tokens, reversed attribute order, levels 1/7, missing attributes and out-of-range raw heads. Those 28 contracts were executed through the independent native example; the Rust library unit-test target itself is blocked as described below. The example also covers six document paths through 30 alternating HWP/HWPX saves and reopens.

## Observed validation

Validation resumed from main `21837fae2af8c694f5eac1fb7674053be7d6a728` on an Apple Silicon Mac. The original working tree and all of its pre-existing untracked files were hashed before and after and remained unchanged; work used a separate checkout and synthetic copies.

- TypeScript check: passed.
- Desktop tests with the fixed engine: 82 passed, 1 skipped, 0 failed. The first sandboxed attempt lacked generated bindings and could not listen on localhost; it is retained as failed evidence.
- Fresh native production build/example: 28 contracts, six document paths and 30 save/reopens passed. A second Native run using the checked-in fixture generator also passed. Only that generated-fixture Native run supplies repeated-save boundary evidence for numbering start `0`, first-head start `0`, first-head width `-12`, distance `0`, and character references `0` / `4294967295`: complete modeled numbering state is compared at each of its 30 reopens.
- Fixed WASM: six document paths, 30 save/reopens; all 30 exports independently inspected for seven-level flag bits, omitted/zero flag behavior and the first two character references (`4294967295` / `0`). These recorded WASM inputs have numbering start `1`, width `0` and distance `0`; the generated start-0/negative-width fixture was not run through WASM in this evidence set.
- Actual Mac Electron 44.3.0 source QA: six HWP/HWPX paths; typing, formatting, undo/redo, both host save formats and 12 reopens passed. All 84 original/history/reopened export files independently inspected for seven-level numbering flags and the first two character references. These recorded Mac inputs also have start `1`, width `0` and distance `0`. The output checker records additional head fields but does not assert every start, width or distance. Native chooser results are controlled in this suite; the actual host IPC and filesystem save remain real.
- Packaged Mac app: production renderer without `__wasm` / `__inputHandler` QA handles; the loaded engine hash matches the fixed package. All 80 ASAR files match the assembled production runtime, including packaged fonts. The QA product name/profile is `GeulgyeolNumberingQA`; production UI version remains `0.4.4-beta.3`. Ad-hoc signature verification passed; Developer ID signing and notarization were not performed.
- Installed editor: **한컴오피스 한글 12.30.0 (6544)**, bundle `com.hancom.office.hwp12.mac.general`, separate from Viewer. Its About UI and bundle metadata agreed. It opened the synthetic numeric HWPX, accepted `X` before the first paragraph and saved a new HWPX. XML inspection confirmed all seven paragraphs and seven emoji, with exactly the intended one-character edit, and flag sequence `[0,4,8,12,4,8,12]`.
- The actual packaged Geulgyeol app loaded that Hancom-edited HWPX, exported both HWP and HWPX and reopened both. Text/emoji and the same numbering bits were preserved. Screenshots were inspected. Packaged QA uses public host/plugin APIs, no native dialog interception, and disables background timer throttling during the run.

The output checker `check-numbering-head-exports.py` asserts flags in levels 1–7 and the first sentinel/second zero character reference. Its recorded width/distance/XML start fields, and its `noZeroDefaultSentinelNormalization` label, must not be read as assertions of every scalar or of exact lexical tokens after an HWP bridge.

| Evidence path | Completed coverage | Boundary / raw-XML limits |
| --- | --- | --- |
| Native parser contracts | 28 cases: token forms, attribute order, model levels and omitted/out-of-range raw capture | Parsing checks, separate from repeated-save coverage |
| Native with new generated fixtures | 6 paths / 30 reopens, whole modeled numbering state compared | Start 0 / width -12 / distance 0 / sentinel and zero repeated-save evidence belongs here |
| Recorded WASM and Mac suites | 6 paths each; 30 WASM and 12 Mac reopens, independent flag/reference checks | Input start 1 / width 0 / distance 0; no generated boundary run or full scalar checker claim |
| Hancom follow-up | One numeric synthetic fixture in both HWP and HWPX, actual edit/save/fresh reopen | Start 1 / width 0; not all three token variants or full visual compatibility |
| Direct generated Native HWPX export | All 10 raw para-head elements byte-equal to input | Before any HWP bridge only; no level 8–10 HWP survival claim |

## Hancom reverse-direction follow-up

Native UI control was recovered by checking the actual document/window title and waiting for the file preview and enabled Open button. The Save As popup did not reliably apply HWP; HWP saving was therefore exercised from an opened HWP, with the default `한글 문서 (*.hwp)` type visibly verified. No existing blank/user document was closed or overwritten.

1. Copied the production Geulgyeol outputs to `from-geulgyeol-hwp.hwp` and `from-geulgyeol-hwpx.hwpx`. Hancom opened each, displayed `X항목0…`, and showed one page.
2. From the opened HWP, Hancom saved a new HWP without editing, then typed `H` and saved another new HWP. From the opened HWPX, it typed `P` and saved a new HWPX. Disk inspection confirms exactly `HX항목0…` / `PX항목0…`, seven paragraphs, seven emoji, and identical applied paragraph-property values. Seven-level flag sequence remains `[0,4,8,12,4,8,12]`.
3. Made byte-identical copies under distinct new paths and opened those in Hancom, forcing fresh file loads without closing user windows. The native UI showed `reopen-hancom-edited-hwp.hwp` with `HX…`, and `reopen-hancom-edited-hwpx.hwpx` with `PX…`; each was one page.
4. The same production Geulgyeol QA bundle loaded both newly edited Hancom files, exported each to both formats and reopened those exports. Four exports preserve the complete paragraph text including all seven emoji, the seven flags, and the first sentinel/second zero reference. This supplementary packaged runner uses public host/plugin APIs and writes exported bytes; it does not claim an additional native host file-chooser save test.

The follow-up closes the prior HWP saving/final Hancom reopen blocker **for these two numeric-fixture paths**. It does not establish full Hancom compatibility or visual/glyph identity. Hancom native screenshots/AX observations are retained in this task's tool outputs; immutable binary inputs/saves/reopen copies and structured proof files are indexed below.

Fixed WASM SHA-256: `ef7644144be504064fa3448d7f3a76c1793b60efe679f72bc34d3212419aefc0`.

The WASM packaging input was the earlier successful release build whose source hash was checked against the actual dirty parser, not a claimed historical success. New changes after that build are tests and QA scripts; production parser logic is identical. Native code was rebuilt from the final checkout.

## Remaining limits and findings

- Rust library unit tests do **not** compile in this source distribution because these upstream files are absent: `engine/samples/3-09월_교육_통합_2022.hwp`, `engine/samples/hwp3-sample16-hwp5.hwp`, and `engine/samples/hwpx/aift.hwpx`. Workspace-wide tests also reference absent `mydocs/tech/agent_runtime/version_policy.md`. No substitute files were invented. The independent native example passes, but this is not a full Rust suite pass.
- Visible layout parity is **not** established. Paragraph zero (`autoIndent=0`, `useInstWidth=0`) continues at the body left margin in Hancom, while Geulgyeol continues under the text after the number. Fresh comparison of the same original numeric HWPX, Hancom-edited HWPX and Geulgyeol HWP in the retained pre-fix WASM and fixed WASM produced byte-identical SVGs, matching page counts and paragraph state for all three inputs. This supports an existing renderer gap for these inputs, rather than a new rendering regression from this parser fix. This PR preserves serialization only. The separate open renderer item is tracked in [numbering-indent-renderer-gap.md](numbering-indent-renderer-gap.md).
- Formatting undo restores applied properties/content/SVG but leaves an unused paragraph-shape record. The first stricter byte check failed and its files were preserved. Typing history still requires byte equality at a common caret; formatting history requires semantic/SVG equality and independent inspection of the numbering exports. Raw byte equality after formatting undo is not claimed.
- One packaged QA attempt timed out while observing asynchronous New Document. The final script awaits the existing handler and disables background throttling; its fresh retry passed. Failed output is retained.
- No physical IME, printer, Linux, broad upstream fixture suite, or CI success is claimed. The parent performs the final remote-SHA verification and merge after independent review; this task does not merge the PR.

## Local evidence index

Under the local QA root `numbering-head-flags/`:

- `native-contracts.log`, `generated-native.log`, `generated-native/proof.json`: independently executed Native contracts and the boundary-value repeated-save run.
- `evidence/fixed/fixed-wasm-export-proof.json` and `evidence/fixed/qa-fixed-final-export-proof.json`: the 30 / 84 output-inspection records, with the assertion limits above.
- `evidence/fixed/packaged-final-retry/`: the original production-app proof and Geulgyeol screenshots.
- `evidence/followup-hancom/copies/`: original Geulgyeol output copies, actual Hancom saves and byte-identical fresh-reopen copies.
- `evidence/followup-hancom/native-ui-observations.json`, `fresh-reopen-copy-proof.json`, `hancom-hwp-save-proof.json`, `hancom-hwpx-save-proof.json`, `numbering-save-bits.json`: native UI path observations and disk verification.
- `evidence/followup-hancom/packaged-back/`, `packaged-back-numbering-proof.json`: actual production-app back-import/export/reopen proof and four independently inspected exports.
- `evidence/followup-hancom/render-comparison.json`, its baseline/fixed SVGs, and `direct-hwpx-raw-head-proof.json`: fresh renderer comparison and direct-HWPX raw-element proof.

## Reproduction

Use a built WASM package, existing standalone build environment, and fresh output directories. `PKG`, `PHASE`, `ROOT` and `APP` below are task-specific paths. The generator below reproduces the new **Native boundary** fixture run; its WASM/Mac counterparts have not been executed in the recorded evidence.

```sh
node scripts/prepare-numbering-head-fixtures.mjs "$PKG" "$PHASE/fixtures"
cargo run --offline --locked --manifest-path engine/Cargo.toml -p rhwp \
  --example numbering_head_flags_check -- "$PHASE/fixtures" "$PHASE/baseline-native" fixed
```

`baseline-native` is the checker’s historical directory name for independently constructed known-bit HWP inputs; the command above is a fixed-engine run. It does not assert a new baseline reproduction.

For the recorded WASM/Mac scope, use the retained start-1/width-0 `fixtures` and known-bit HWP inputs in a fresh phase:

```sh
node scripts/check-numbering-head-flags.mjs "$PKG" "$PHASE" "$PHASE/fixed-wasm" fixed
python3 -B scripts/check-numbering-head-exports.py "$PHASE" fixed-wasm fixed
```

For Mac source QA, start a fresh `EvidenceBudget` phase under `ROOT` before building. The evidence helper enforces size/free-space limits. Set `NODE_PATH` to the repository's `desktop/node_modules` so the external bootstrap can resolve the official Electron runtime.

```sh
node scripts/build-electron-table-qa.mjs "$PHASE" qa-fixed "$PKG"
GEULGYEOL_QA_BUDGET_ROOT="$ROOT" NODE_PATH="$PWD/desktop/node_modules" \
  node scripts/check-electron-numbering-head-flags.mjs "$PHASE/qa-fixed" fixed "$PHASE" "$PKG"
python3 -B scripts/check-numbering-head-exports.py "$PHASE" qa-fixed fixed
```

The packaged checker expects the isolated `GeulgyeolNumberingQA.app` candidate and the **synthetic** numeric HWPX actually edited in Hancom with an initial `X`. It refuses an existing output directory and isolates its profile. It does not operate on the user's existing Geulgyeol instance.

```sh
node scripts/check-packaged-numbering-head-flags.mjs "$PHASE/packaged" "$APP" "$PKG" "$HANCOM_SYNTHETIC_HWPX"
```

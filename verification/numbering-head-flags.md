# HWPX numbering head flag preservation

HWPX `useInstWidth` and `autoIndent` now populate HWP numbering-head attribute bits 2 and 3. Previously the raw HWPX XML survived an HWPX save, but an HWP save lost these flags. Missing attributes retain the existing zero behavior; explicit zero, start zero, negative width, character reference zero and `4294967295` remain intact. Raw para-head XML, including levels beyond the seven-level HWP model, remains preserved.

The production change is five parser lines. Parser regressions cover numeric and XML boolean tokens, reversed attribute order, levels 1/7, missing attributes and out-of-range raw heads. The native example also exercises these 28 contracts and six document paths through 30 alternating HWP/HWPX saves and reopens.

## Observed validation

Validation resumed from main `21837fae2af8c694f5eac1fb7674053be7d6a728` on an Apple Silicon Mac. The original working tree and all of its pre-existing untracked files were hashed before and after and remained unchanged; work used a separate checkout and synthetic copies.

- TypeScript check: passed.
- Desktop tests with the fixed engine: 82 passed, 1 skipped, 0 failed. The first sandboxed attempt lacked generated bindings and could not listen on localhost; it is retained as failed evidence.
- Fresh native production build/example: 28 contracts, six document paths and 30 save/reopens passed. A second run using the checked-in fixture generator also passed.
- Fixed WASM: six document paths, 30 save/reopens; all 30 exports independently inspected for flag bits and lexical zero/sentinel behavior.
- Actual Mac Electron 44.3.0 source QA: six HWP/HWPX paths; typing, formatting, undo/redo, both host save formats and 12 reopens passed. All 84 original/history/reopened export files independently inspected for numbering flags and zero/sentinel values. Native chooser results are controlled in this suite; the actual host IPC and filesystem save remain real.
- Packaged Mac app: production renderer without `__wasm` / `__inputHandler` QA handles; the loaded engine hash matches the fixed package. All 80 ASAR files match the assembled production runtime, including packaged fonts. The QA product name/profile is `GeulgyeolNumberingQA`; production UI version remains `0.4.4-beta.3`. Ad-hoc signature verification passed; Developer ID signing and notarization were not performed.
- Installed editor: **한컴오피스 한글 12.30.0 (6544)**, bundle `com.hancom.office.hwp12.mac.general`, separate from Viewer. Its About UI and bundle metadata agreed. It opened the synthetic numeric HWPX, accepted `X` before the first paragraph and saved a new HWPX. XML inspection confirmed all seven paragraphs and seven emoji, with exactly the intended one-character edit, and flag sequence `[0,4,8,12,4,8,12]`.
- The actual packaged Geulgyeol app loaded that Hancom-edited HWPX, exported both HWP and HWPX and reopened both. Text/emoji and the same numbering bits were preserved. Screenshots were inspected. Packaged QA uses public host/plugin APIs, no native dialog interception, and disables background timer throttling during the run.

Fixed WASM SHA-256: `ef7644144be504064fa3448d7f3a76c1793b60efe679f72bc34d3212419aefc0`.

The WASM packaging input was the earlier successful release build whose source hash was checked against the actual dirty parser, not a claimed historical success. New changes after that build are tests and QA scripts; production parser logic is identical. Native code was rebuilt from the final checkout.

## Remaining limits and findings

- Rust library unit tests do **not** compile in this source distribution because these upstream files are absent: `engine/samples/3-09월_교육_통합_2022.hwp`, `engine/samples/hwp3-sample16-hwp5.hwp`, and `engine/samples/hwpx/aift.hwpx`. Workspace-wide tests also reference absent `mydocs/tech/agent_runtime/version_policy.md`. No substitute files were invented. The independent native example passes, but this is not a full Rust suite pass.
- The native screen tool began returning the user's existing `빈 문서 1` window while the saved synthetic document/Save As flow was in another window. Further keyboard/menu attempts did not reliably reach that document. No user document was closed or overwritten. Final Geulgyeol → Hancom reopening and Hancom HWP saving are **unverified**, and the overall bidirectional Hancom comparison is incomplete.
- Visible layout parity is **not** established. Paragraph zero (`autoIndent=0`, `useInstWidth=0`) continues at the body left margin in Hancom, while Geulgyeol continues under the text after the number. The current renderer does not use these bits; this PR preserves their serialization only. This remains a separate renderer issue.
- Formatting undo restores applied properties/content/SVG but leaves an unused paragraph-shape record. The first stricter byte check failed and its files were preserved. Typing history still requires byte equality at a common caret; formatting history requires semantic/SVG equality and independent inspection of the numbering exports. Raw byte equality after formatting undo is not claimed.
- One packaged QA attempt timed out while observing asynchronous New Document. The final script awaits the existing handler and disables background throttling; its fresh retry passed. Failed output is retained.
- No physical IME, printer, Linux, broad upstream fixture suite, or CI success is claimed. Keep the PR draft until the remaining Hancom comparison and independent review are resolved.

## Reproduction

Use a built WASM package, existing standalone build environment, and fresh output directories. `PKG`, `PHASE`, `ROOT` and `APP` below are task-specific paths.

```sh
node scripts/prepare-numbering-head-fixtures.mjs "$PKG" "$PHASE/fixtures"
cargo run --offline --locked --manifest-path engine/Cargo.toml -p rhwp \
  --example numbering_head_flags_check -- "$PHASE/fixtures" "$PHASE/baseline-native" fixed
node scripts/check-numbering-head-flags.mjs "$PKG" "$PHASE" "$PHASE/fixed-wasm" fixed
python3 -B scripts/check-numbering-head-exports.py "$PHASE" fixed-wasm fixed
```

`baseline-native` is the checker’s historical directory name for independently constructed known-bit HWP inputs; the command above is a fixed-engine run. It does not assert a new baseline reproduction.

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

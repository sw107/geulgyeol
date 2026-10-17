# Horizontal cell numbering across page fragments

Base main: `55afaad77822d81260dc88d56a7c89967cb8ef4e` (PR #71).
Branch: `dev/cell-numbering-continuation`. All fixtures are synthetic.

## Change

Both horizontal cell-fragment paths previously attached numbering metadata only
when `start_line == 0`. A paragraph resumed on another page consequently lost
its automatic number area, while its first fragment retained it. The baseline
PR #71 SDK reproduces this in eight autoIndent-enabled matrix entries.

The continuation paths now reuse the complete cell's precomputed counters and
the existing numbering composition helper. They reserve the stored head's area
without advancing the body list or painting another marker. The existing
`start_line > 0` paint guard suppresses the repeated marker. Numberless, bullet,
missing/synthesized-head and autoIndent-disabled cases return before cloning a
composition. An empty first fragment keeps its old path.

This changes three renderer files. No public API, serializer, WASM bridge,
InputHandler/history, UI or vertical-cell pagination code changes are included.

## Validation

Baseline SDK SHA-256:
`d155c31adca72095d3cb4bb19e858c9f3872104612f8271ac7e5b002882a34b5`.
Final candidate SDK SHA-256:
`bbc48a4db3e3d6edd867f9121a7758943634e78d124e482c36c794f34349e7b6`.

- Real WASM: 16 fixtures (four head-flag combinations × one/two-column tables ×
  forced/soft line wrapping), 64 alternating HWP/HWPX save/reopens. Checks include
  4,404 later-page line starts, horizontal cell bounds, exactly-once emitted
  non-whitespace text, neighboring paragraph text, cell-local markers/counters and cold
  reverse page queries. autoIndent-disabled SVG matches the baseline exactly.
- Eight additional controls: plain, bullet and vertical direction 1/2 for both
  table shapes. Their complete SVG and HWP/HWPX bytes match the baseline.
- Native executable: the same 16 fixtures and 64 alternating save/reopens,
  cold reverse queries and neighboring text/style/character-shape references.
  Sixteen additional runtime NewStart cases verify five-digit markers, the next
  paragraph counter, an independent neighbor cell, cold reverse queries and
  immediate snapshot restoration without an intervening edit. NewStart is set
  directly on the model; these are not UI undo/redo tests. No replacement samples
  were added to the unit suite.
- Studio TypeScript and 42 input/history/native-shortcut VM tests pass. The new
  scripts pass Node syntax checks; the Native example passes rustfmt checking.
- Existing body indentation checks pass ten save/reopens and the later-page
  control. Decimal/Roman/multilevel body SVG and wire bytes match PR #71.
  Existing body NewStart persistence checks pass seven export/reopen stages.
  Seven cursor/format/control fixtures pass 118 coordinate comparisons, including
  the 98-page control; no performance benchmark is repeated or claimed.

## App verification gate

An earlier candidate (`2ab317a9…`) was actually loaded in an isolated Mac
Electron QA runtime; its resource URL and served engine SHA were recorded.
Four layout-only cases and one input/undo/redo/HWP save/reopen path completed.
The driver then clicked Save before the host's reopen transition had settled;
its second-format save timed out. This attempt is retained as failed evidence
and does not validate the final candidate. The driver now waits for the host
filename and enabled Save button before continuing. A subsequent driver
preflight additionally requires a changed document epoch: saving has already
assigned the same filename to the old document, so filename alone does not prove
reopening. It also rejects an open host error dialog. The first epoch driver
incorrectly read `baramHost.state().documentEpoch`; the actual presentation-state
API only returns dirty/filename. Its real Electron attempt failed the driver's
integer assertion and exited normally. The driver now reads the existing QA
bridge's `documentGeneration`, without changing a product API. Four Node VM checks run
the actual desktop host and the real `baramState` function with gated adapters and the exact driver predicate:
delayed commit, early epoch publication with host work still pending, Open
cancel, and load failure. The next save's format is selected after the host
finishes resetting it. These are driver checks, not Electron/OS execution.

After the PM reassigned the GUI slot, the corrected driver passed actual Mac
Electron source-QA on the final SDK: 16 layout fixtures, eight noncomposing CDP
input/real native-menu undo/redo cases, 16 host IPC saves and 16 host reopens.
Each input creates one history entry; undo restores the initial observation,
redo restores the edited observation, and saved/reopened documents pass the
clean-state and changed-generation gates. Host IPC dirty notifications remain
true across the 16 undo/redo callbacks and become false after saving/reopening;
this audit is not a separate internal-state sample after every undo.

The actual requested asset URL served the final SDK SHA above. Independent
binary/XML inspection checks all seven numbering heads in the 16 app exports.
Re-reading those exports verifies exact stored text including whitespace, with
only the expected X insertion in cell 0's long paragraph. It does not establish
rendered whitespace placement. Four `c2-hard` flag representatives retain both
HWP and HWPX outputs for the separate Hancom comparison, with path/hash metadata
in `electron-handoff/hancom-four-flags.json`; no document copies were made.

The owned app exited normally with code 0 and the GUI slot was returned. The
already-open Hancom PR #72 document was not touched. Actual Hancom comparison
remains pending. The test runner uses a dedicated QA-only WASM alias and
controlled chooser results; it is not signed release/package or physical
keyboard/native chooser verification.

### Latest-main combination check

A further run at source HEAD `d9a56a42d95e21bf10c29fe7fbfa4eb6f0e39fc3`
repeats the branch check in `electron-bridge-generation`. A separate
`electron-main-integration` run combines the final PR #73 SDK with the PR #72
UI runtime built from `6f13bd2c16ab035f2052645a56be91ca3e758999`. That source
Git tree is exactly equal to main `e16cad657f38aa456845ab023ea315ab3c3ac5c2`.
The pinned source files match main, and all 83 reused runtime files were hashed
before and after; none changed. Main has no intervening engine changes.
This is an actual main-UI/PR73-engine combination check, not a merged source
commit, rebuilt package or release.

Both runs pass the same 16 layout fixtures, eight input/undo/redo cases and
16 real host save/reopens, with the actual requested WASM serving
`bbc48a4db3e3d6edd867f9121a7758943634e78d124e482c36c794f34349e7b6`.
All 16 saved files are byte-identical between the runs and the earlier
independently inspected `electron-release-retry` exports. Both owned apps quit
normally with code 0. These are repeated checks of the same matrix, not additional
unique coverage.

`main-integration-input.json` pins the main/UI relationship and reused runtime.
`hancom-handoff-manifest.json` lists all 16 integrated app exports with hashes,
original fixture paths, head flags, exact edit and expected cell-local labels.
No documents were copied for handoff. The GUI slot is returned; these outputs
await actual Hancom editing/save/reopen comparison.

## Other limits

Cell NewStart is checked as runtime model/snapshot behavior, including a large
counter and independent neighboring cell. Existing export lowering supports
body NewStart only; this work does not add cell NewStart serialization or a new
editing API. Saved cell-list identity checks use standard numbering definitions.
The changed-case rendered-text comparison removes whitespace, so it does not
establish whitespace placement or word-spacing equivalence. Exact paragraph
text hashes protect stored whitespace content separately.
General font/wrap fidelity, Roman fixed areas, vertical pagination, physical
IME/native choosers and signed release packaging are outside this change.

The three existing embedded library-test samples remain absent:
`samples/3-09월_교육_통합_2022.hwp`, `samples/hwp3-sample16-hwp5.hwp`,
`samples/hwpx/aift.hwpx`. A Native example is not the full Rust unit suite.
No CI success is inferred from absent checks. Merge and deployment remain held
for independent review and the outstanding Hancom gate.

## Reproduction and retained evidence

Local QA root: `/Users/sw107/Documents/Codex/2026-10-14/task/cell-numbering-continuation/qa`.
`final-engine-source.json` links the three renderer source hashes to the final
SDK. `baseline`, `wasm-release-matrix/checks` and `native-release/checks` contain
the scoped results; preliminary build phases are not final-source validation.
`electron-release-retry` contains the passing final Electron run;
`electron-release` retains the failed presentation-state epoch assertion.
`electron-handoff` contains independent saved-head/text and host-state audits.
`regressions-fixed` contains the current body/cursor regressions. The first
regression attempt incorrectly supplied the already-fixed PR #71 SDK to a
historical harness mode expecting a broken body renderer; that driver assertion
is retained separately and is not a candidate-engine failure.

The existing shared toolchain/target caches were reused. During Native/WASM
verification the conservative
build-cache-plus-evidence growth guard observed at most 363,843,584 bytes,
below the 1.5 GiB ceiling; observed free space stayed at or above
18,227,200,000 bytes, above the existing 16,374,562,816-byte floor. These are disk
measurements, not peak-RSS or application RAM bounds. No new checkout or app
package was created. After the two latest Electron runs, the checkpoint has
18,186,240,000 bytes free and conservative cache/evidence growth of 327,770,112
bytes. The whole-run evidence budget reports no unfinished phase.

```sh
node scripts/prepare-cell-numbering-continuation.mjs BASELINE_SDK FRESH_FIXTURES
node --max-old-space-size=256 --wasm-max-mem-pages=2048 \
  scripts/check-cell-numbering-continuation.mjs FINAL_SDK FRESH_FIXTURES FRESH_OUTPUT fixed BASELINE_SDK
cargo run --offline --locked --manifest-path engine/Cargo.toml -p rhwp \
  --example cell_numbering_continuation_check -- FRESH_FIXTURES FRESH_NATIVE_OUTPUT
```

Only after the PM reassigns the GUI slot, use the existing isolated source-QA
runtime (or prepare one with `build-electron-table-qa.mjs`) and run:

```sh
node scripts/check-electron-cell-numbering-continuation.mjs \
  QA_ROOT FINAL_SDK FRESH_FIXTURES FRESH_PHASE SOURCE_QA_RUNTIME
```

The driver-only check needs no GUI slot and starts no app:

```sh
node --test scripts/check-cell-numbering-host-wait.test.mjs
```

The synthetic matrix is reproducible from the generator. Keep the normalized
fixtures, final SDK and minimal proofs/hashes through final validation and
independent review. The initial setup seeds, intermediate cross-format exports
and failed-run app profile/runtime are cleanup candidates only after the PM
confirms their tests have finished. No originals, frozen earlier evidence or
shared build cache are cleanup candidates for this task, and nothing was
deleted or moved to Trash.

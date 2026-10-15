# Body list NewStart persistence

Base: merged main `e6d8413c67609d4d10d389b040872b008047b521`. Branch: `dev/numbering-restart-persistence`. All inputs are synthetic copies. The original dirty checkout's status, binary diff SHA-256 and all untracked hashes were rechecked unchanged.

## Cause and standard representation

The replay fix rendered an in-memory `NewStart(123)` correctly, but both serializers omitted that transient paragraph attribute. With the previous WASM (`f37c7fc8c1671f415a2fd4c4ebc695fe0a8042d458d48905b9d10842323d5847`), both independent saves changed `1.,2.,123.,124.,124.1.,125.` back to `1.,2.,3.,4.,4.1.,5.` after reopening. The current baseline SDK and actual Mac Electron source-QA reproduce this loss.

Installed editing product: **한컴오피스 한글 12.30.0 (6544)**, `/Applications/Hancom Office HWP.app`, bundle `com.hancom.office.hwp12.mac.general`. In that app, the synthetic six-paragraph input initially showed `1.,2.,3.,4.,4.1.,5.`. Applying 새 번호 목록 시작 / 123 to paragraph 3 showed `1.,2.,123.,124.,124.1.,125.` and saved successfully as a separate `hancom-newstart123.hwpx`.

That real saved HWPX adds a numbering definition with global and first-head start 123 and changes the target plus following list paragraphs (including the child level) to standard paragraph-shape references to that definition. Earlier paragraphs retain their original list identity. It contains no paragraph `newNum` control. Its embedded preview and the parsed XML are retained as evidence.

Primary references:

- [Hancom HWP 5.0 revision 1.3](https://cdn.hancom.com/link/docs/한글문서파일형식_5.0_revision1.3.pdf), numbering tables 39–40 and paragraph-shape tables 43–44. Tables 143–144 define `nwno` for page, note and object counters; they do not establish a paragraph-list `nwno` kind.
- Official Hancom OWPML model at `1453388472c703a4b299a0834f425cdac16644b9`: [NumberingType.cpp](https://github.com/hancom-io/hwpx-owpml-model/blob/1453388472c703a4b299a0834f425cdac16644b9/OWPML/Class/Head/NumberingType.cpp) reads/writes numbering `start`; [heading.cpp](https://github.com/hancom-io/hwpx-owpml-model/blob/1453388472c703a4b299a0834f425cdac16644b9/OWPML/Class/Head/heading.cpp) reads/writes `idRef` and `level`.

The implementation infers the export lowering from this real native output and the standard definition/reference model. It does not invent a wire attribute.

## Change and supported scope

Both HWP and HWPX export paths use one private export projection. It borrows documents with no body NewStart unchanged. Otherwise it clones the document, clones the applicable numbering and paragraph shapes, and switches the restarted list and subsequent matching list references to the new definition. Repeated restarts and switching away from/back to the list retain separate counter histories. ContinuePrevious keeps existing list/history semantics. Live editing state, history and original raw streams are not mutated by export.

The new definition retains modeled head flags, formats, distances, character references and other paragraph formatting. HWPX raw heads retain levels 2–10; only the level-1 `start` changes. The current relative runtime counter semantics are preserved: effective start is original level-1 start minus one (saturating) plus the requested value (at least one). Values outside the shared HWP UINT16 start range fail explicitly.

Supported NewStart is **level-1 body NUMBER lists**, including following lower levels. Lower-level and outline NewStart fail explicitly; this native oracle does not establish their persistence rules. Cell/nested-story restart persistence is not added. Cloned HWP records are rebuilt from modeled fields; arbitrary unknown binary record tails are not a claimed fidelity guarantee.

## Fresh verification

QA root: `/Users/sw107/Documents/Codex/2026-10-14/task/numbering-restart-persistence`.

Final WASM SHA-256: `b32f304e7235beaa10c08d707dcfa16ba416149398539a578e3894039d3f21a1`.

| Check | Result and evidence under QA root |
| --- | --- |
| Native persistence | Nine save/reopens with start 123, following child level, repeated restart to 7, explicit ContinuePrevious across another list; text and normalized text-layout geometry match without restart reapplication. Live IR and formatting unchanged; unsupported lower-level and out-of-range starts rejected. `evidence/oracle/native-final/proof.json` |
| Native paginated replay | Three pages, 71 later line starts, four alternating reopens without reapplication. `evidence/oracle/native-smoke/proof.json` |
| Real WASM persistence | Two independent formats plus five chained reopens, real snapshot undo/redo, unchanged live state. No-restart HWP and HWPX output bytes exactly match previous build. `evidence/oracle/wasm-persistence/proof.json` |
| Real WASM pagination | Three pages / 71 later lines / four reopens, stable forward/reverse page queries without restart reapplication. `evidence/oracle/wasm-pages/proof.json` |
| Real Hancom-saved input | Native Hancom's saved start-123 HWPX reads correctly in current SDK and survives four alternating HWPX/HWP reopens. `evidence/oracle/hancom-origin-proof.json` |
| Actual Mac source-QA | Old build reproduces save loss; final build retains `123.,124.,124.1.,125.`, continuation geometry and undo/redo through real bridge/history and both formats without reapplying restart. Instrumented handles and controlled dialogs are used. Both runs quit normally. `evidence/oracle/mac-baseline-verified/proof.json`, `mac-persistence-fixed/proof.json` |
| Ordinary production Mac package | Current served WASM and 80 ASAR source files verified; ad hoc signature verified. Twelve reopens across standalone text, two Hancom matrix documents before/after public API insertion, and nine-page control. Normal exit 0, no source-QA handles or dialog replacement. `evidence/oracle/mac-production/proof.json`, `package-proof.json`, `sign.log` |
| Existing regression | Four-flag body: ten reopens, exact nonnumbered SVG control, nine-page / 190 later-line control. Body numbering: 20 cases / 44 reopens. Nested-cell numbering: 78 cases / 156 reopens (labels/properties/history/save, not four-flag coordinates). `evidence/oracle/four-flags`, `body`, `cell` |
| Flag contracts and wire checks | Native 28 contracts / six paths / 30 reopens; real WASM six paths / 30 reopens. All 60 resulting exports inspected for head flags and original sentinel/0 references. Ten restart HWPX files inspected for standard start 123 and absence of invented `newNum`. `evidence/oracle/native-flags`, `wasm-flags`, `export-inspection.json`; direct ten-head comparison in `direct-hwpx-clone-proof.json` |
| Type and desktop checks | `tsc --noEmit` exit 0; desktop tests 82 pass, one skip. `typecheck.log`, `desktop-tests.log` |

Native example reproduction:

```sh
cargo run --manifest-path engine/Cargo.toml -p rhwp --example numbering_restart_persistence_check -- INPUT_HWPX FRESH_OUTPUT
node scripts/check-numbering-restart-persistence.mjs ENGINE_PKG INPUT_HWPX FRESH_OUTPUT fixed PREVIOUS_ENGINE_PKG
node scripts/check-electron-numbering-restart.mjs RUNTIME_ROOT ENGINE_PKG THREE_PAGE_SIX_PARAGRAPH_INPUT FRESH_OUTPUT fixed 2
```

Earlier failed assertion/observer attempts remain in distinct evidence directories and are not counted as successful checks. The baseline/retry logs preserve those failures.

## Remaining validation limits

**Final Geulgyeol → Hancom reopen/edit/save/reopen is blocked.** After choosing HWP in Hancom's Save As format menu, File/Open/Save and document switching remained disabled, while AX and screenshots exposed only the document. Menu cancellation, Escape, Command-period, and the ordinary Open toolbar button did not restore these commands. No HWP save from this dialog or final native reopen is claimed. A user-assisted dialog cancellation was requested. No app force-quit, user-window closure, original overwrite, login, terms acceptance or activation was attempted. The earlier successful native HWPX save and its contents are verified separately above.

Full `cargo test -p rhwp --lib` exits 101 before running because this checkout lacks `engine/samples/3-09월_교육_통합_2022.hwp`, `engine/samples/hwp3-sample16-hwp5.hwp`, and `engine/samples/hwpx/aift.hwpx`. See `full-rust-lib.log`. Production Native examples compile and run, but do not substitute for a full lib-test pass. CI status must be reported separately; an empty check list is not success.

Physical keyboard/IME and genuine native save chooser completion are not established by source-QA or public API tests. General wrapping/font fidelity and Roman fixed areas remain outside this change. Split cells still apply head metadata only at `start_line == 0`; later cell continuations remain an existing open gap. Merge requires independent review and resolution or explicit acceptance of the native validation gap.

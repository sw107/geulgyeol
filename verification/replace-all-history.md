# Replace All no-op and failure history

Base main: `238636d666d89fcf683457029a9986470dcaf427`. Branch: `dev/replace-all-history`. QA root: `/Users/sw107/Documents/Codex/2026-10-14/task/replace-all-history`.

The real FindDialog always returned a cursor from its replaceAll snapshot callback, including zero matches and `{ok:false}`. History therefore recorded a phantom edit, discarded redo, consumed a live snapshot reference and marked a clean document dirty. A failed result after partial mutation could leave changed content recorded. A thrown exception already used SnapshotCommand's rollback; this is a negative control, not a newly implemented rollback.

Only `FindDialog.doReplaceAll` changes in production. Zero matches return the existing `null` no-op signal. A failed result throws inside the snapshot so existing rollback runs before history commits. Failures display a concise status; positive success remains one undo operation. The no-handler fallback emits `document-changed` only for positive success. Engine, bridge, InputHandler and history implementations are unchanged.

Tested unchanged WASM: `9c526ed153f2b0644464ad9da59664eba2cb429c783bdc88f15899fbf797ac06`.

## Fresh evidence

Paths below are relative to `QA_ROOT/evidence/run`.

| Check | Result |
| --- | --- |
| Actual Mac baseline | 24 cases: HWP/HWPX × clean/pending redo × empty, unmatched, missing API, false after mutation, throw after mutation, success. Twelve zero/failed-result cases reproduce phantom history and redo loss. Exceptions already rollback, with four expected unhandled baseline page errors. `mac-baseline/proof.json` |
| Actual Mac fixed | Same 24 cases pass and **48 HWP/HWPX file reopens** retain text, all display/print SVGs and page count. No-op/failure compares complete exports at the same saved caret, cursor/selection, dirty state, stack lengths and live history snapshot references. Prior redo and older undo are executed. Success clears prior redo and undoes/redoes once. No page errors; normal exit 0. `mac-fixed/proof.json` |
| Search spans | Selected 16 unchanged synthetic fixtures across body, flat/nested cells and textboxes, including Unicode case-fold spans, ASCII, unmatched/empty queries and four replacement strings. **96 cases / 384 reopens**, 64 source-UI method cases, 96 history restores; strict history-SVG check has no differences. Node + real WASM/source, not GUI. `search-span/proof.json` |
| Fallback | Eight real-WASM/source checks across both formats: unmatched, success, missing API and pre-mutation exception. Only positive success emits a change event. `fallback-proof.json` |
| Final checks | TypeScript exit 0. Desktop: 82 pass, one skip, no failures. Root `typecheck.log`, `desktop-tests.log`. Current rebuilt source-QA runtime, input/export hashes and preserved original trees are checked in root `delivery-freeze.json`. |

Mac checks launch actual Electron 44.3.0 and click the product's real modeless FindDialog button through its actual bridge/history. Existing QA handles support preparation/observation; native choosers and close dialogs are controlled. This is source-QA, not ordinary packaged-app/native-chooser or physical keyboard/IME coverage. Files are written and read back before app reload.

Failures are synthetic and confined to the owned QA app: remove the WASM method, or return false/throw after a real engine mutation. No naturally occurring engine error was reproduced and no failure was injected into Hancom. Partial-mutation rollback is verified with the live editing InputHandler; no-handler fallback checks establish pre-mutation failure and event emission, not partial-mutation rollback.

## Editing Hancom comparison

In **한컴오피스 한글 12.30.0 (6544)**, the synthetic HWPX contains two `needle` occurrences. The normal Open panel initially left Open disabled; Finder Open With → editing Hancom loaded the same synthetic file. No access refusal, security setting, app restart or existing-window closure was bypassed or performed.

The native All Replace button changed both occurrences to Q. One document-menu Undo restored both. With that replacement pending in redo, unmatched `NOT_PRESENT` All Replace left Undo disabled and Redo enabled; executing Redo restored both Q replacements. This matches the fixed no-op/success history behavior. AX presses that did not execute were not counted; coordinate activation and resulting document screenshots establish the operations.

Native Save As created a new `hancom-replace-all.hwpx`; the input hash is unchanged. Loading that saved file in the SDK gives exact `Q | Q 가나다 😀`. `hancom-proof.json` records observations, filename, hash and text. Native screenshots are in the conversation tool trace; no standalone native image files are claimed. This covers normal HWPX behavior, not failure injection, both-format native interchange or arbitrary glyph fidelity.

## Reproduction and limits

```sh
node scripts/build-electron-table-qa.mjs QA_ROOT baseline-or-fixed ENGINE_PKG
node scripts/check-electron-replace-all-history.mjs RUNTIME_ROOT ENGINE_PKG INPUT_HWPX FRESH_OUTPUT baseline-or-fixed
```

The input basename also needs an adjacent `.hwp` copy; both here are synthetic SDK exports of `needle | needle 가나다 😀`. Original user documents and the earlier dirty checkout remain untouched: status, binary diff and all untracked hashes are checked, including the working clone's pre-existing untracked files.

Rust is unchanged, so its full suite was not rerun for this UI-only correction. The prior three-missing-embedded-sample compilation limitation is not a pass. CI is reported separately; an empty check list is not success. No web editor was developed and no merge was performed.

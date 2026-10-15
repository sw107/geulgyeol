# Single Replace failure preserves document history

Base: `6260195f9a37a38aeb3b60d7a6a85ed4c130a665`.
Branch: `dev/single-replace-failure-history`.

## Problem and change

The modeless Find/Replace dialog's single Replace path returned a cursor from
its snapshot operation even when the bridge returned `{ok:false}`. This
committed a phantom edit, discarded pending redo and marked the document dirty.
If the failed result followed partial mutation, that mutation remained.
The no-handler fallback also published `document-changed` for a failed result.
Thrown failures already rolled back through SnapshotCommand, but escaped the
dialog without a user-facing failure status.

Only `FindDialog.doReplace` changes in production. A failed result throws
inside the existing snapshot operation, allowing its rollback to finish before
history commits. The dialog catches failures and displays `바꾸기에 실패했습니다.`.
Success retains the existing single-undo behavior and clears the previous error
color before searching again. Failed fallback operations no longer emit a change
event. Engine, history, document-transition and write-fence code are unchanged.

## Reproduction and verification

`scripts/check-single-replace-failure-history.mjs` executes current FindDialog,
Bridge replacement methods, InputHandler snapshot routing, SnapshotCommand,
CommandHistory and DocumentDirtyState with the real WASM engine. DOM, cursor,
repaint and the normal-mode write-fence adapter are substitutes; this is not
actual Mac UI, physical input, IME or security-fence validation.

The 32 cases cover HWP/HWPX, body/table-cell text, clean or pending-redo state,
missing body API, false/throw after real mutation, success, and the ordinary
cell-edit fallback when the deferred API is absent. The missing API exercises
the real bridge's compatibility return. Other failures are explicitly injected
after actual engine edits; no naturally occurring engine failure is claimed.

| Check | Result |
| --- | --- |
| Baseline, 32 cases | 12 wrong history commits, including 8 surviving partial mutations; 8 thrown exceptions escaped the dialog |
| Fixed, same 32 cases | Failures preserve complete HWP/HWPX bytes, all page/print SVGs, text, cursor/selection, both history heads/stacks, live snapshot count and clean state; pending redo remains executable |
| Saved files | 64 disk save/reopens preserve text, page count and all page/print SVGs |
| No-handler fallback | 6 cases; only success emits a change event; failures before mutation preserve bytes and display failure status |
| Existing cell-layout/history regression | 24 cases, 160 restores, 80 reopens, 4 rejections; strict saved SVG equality, no issues |
| Focused desktop tests | Baseline 12 pass / 3 fail; fixed 15 / 15 pass |
| Full desktop suite | 88 pass, 0 fail, 1 skipped |
| TypeScript | Exit 0 |

All snapshot resources are released after each case. Partial-mutation rollback
is verified through the handler/snapshot path. The no-handler fallback checks
do not claim partial-mutation rollback.

```sh
node scripts/check-single-replace-failure-history.mjs ENGINE_PKG FRESH_OUTPUT fixed
node --test desktop/tests/find-stale-hit.test.cjs
node scripts/check-cell-layout-history.mjs ENGINE_PKG FRESH_OUTPUT
```

QA root:
`/Users/sw107/Documents/Codex/2026-10-14/task/single-replace-failure-history`.
Raw results: `evidence/baseline/run/proof.json`, `evidence/fixed/proof.json`,
`evidence/cell-layout/proof.json`, and the root test/typecheck logs.

Verified FindDialog SHA-256:
`f3c694814643c12465a5d87f155e6522eb2a337cae5c4b9f3043ddb87e7c5640`.
Unchanged engine SHA-256:
`9c526ed153f2b0644464ad9da59664eba2cb429c783bdc88f15899fbf797ac06`.

## Remaining manual checks

Native app/document-session control was absent from this turn's available tool
catalog. No Mac app, native chooser, genuine Hancom comparison, or new keyboard
test is claimed. The outstanding ordinary-key/Korean-IME/paste investigation
remains incomplete. A future Mac check should keep a pending redo, attempt a
failed single Replace, confirm the visible failure status and unchanged document,
then check successful Replace, Undo/Redo and save/reopen in both formats.

Original dirty checkout and pre-existing working-clone untracked files are
preserved by status, binary-diff and file hashes. No user document or existing
app window was opened or closed for this change. Full Rust tests were not rerun
for this TypeScript correction; the previously missing three embedded samples
remain a known limitation, not a pass. CI is reported separately; an empty
check list is not success.

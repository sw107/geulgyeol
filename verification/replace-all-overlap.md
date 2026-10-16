# Replace All selects disjoint source spans

Base main: `1336a954e828cc01e0ad0d21337b8761772d00e7`, the ordinary merge
of independently reviewed PR #57 head `9588d05bc4262fda2409f9089e540d03b9d7427b`.
The merge and remote main were read back. No duplicate merge was performed.
Worktree: `/Users/sw107/Documents/Codex/2026-10-14/task/replace-all-overlap/repo`,
branch `dev/replace-all-overlap`. It was clean when shell access resumed.

## Failure and fix

The actual baseline WASM replaces `aaa` in `aaaaTAIL` twice, using overlapping
source spans at offsets 0 and 1. Replacing with `Q` returns count 2 and `QAIL`;
deleting returns `IL`. After the later span shrinks, the earlier span deletes
text beyond the original matched region, including characters from `TAIL`.

Replace All now selects disjoint matches from left to right in each independent
text/equation container, then applies the retained spans in reverse. The key
contains section, body owner, full cell/text-box path, text-box flag and equation
control index. Identical offsets in different cells, paragraphs or equations
do not suppress each other. Expected results are count 1 with `QaTAIL` or
`aTAIL`, preserving the unmatched suffix.

The production change is 21 lines in `search_query.rs`. Find All's overlapping
literal matching remains unchanged. The explicit nth-match branch retains its
original selection list. No API, Find/F3 scope, keyboard, serialization or
history code changed. Find/F3 still supports body and flat cells; Replace All
already supports nested cells and text boxes, which this regression exercises.
Caption text searching and unsupported Find/F3 containers are not added.

## Verification

QA root: `/Users/sw107/Documents/Codex/2026-10-14/task/replace-all-overlap/qa`.
Baseline WASM SHA-256:
`d62c0f8962dd23c3e0e7cb22b212fc438647bcf9e115610681577f2be0741598`.
Final offline/locked release WASM SHA-256:
`68bf45b5ec9cca1f2ad2f495c03dccaaea208cccc50813e7fb85409a006474e9`.
Rust 1.93.1 and the existing wasm-bindgen tool produced the final SDK.

| Check | Result |
| --- | --- |
| Focused desktop regressions | Baseline 4 pass / 14 fail; all 18 pass in the final full suite |
| Fixtures | 64 immutable synthetic HWP/HWPX documents covering body, flat cell, nested cell and text box; ASCII, Korean, emoji, case-fold expansion, prefix/suffix, adjacent/spaced and missing matches |
| Actual Bridge/FindDialog/InputHandler/SnapshotCommand/CommandHistory | 192 cases; baseline 144 mismatches (36 in each scope), final zero |
| Replacement lengths | Empty deletion, shorter `Q`, longer `한😀글XYZ` |
| Undo/redo and resource ownership | 336 history restores; exact document bytes and all SVGs restore; no orphan snapshots; no-match cases preserve clean state and history |
| Save/reopen | 768 disk reopens preserve target text, full text export, semantic text, outer paragraph properties, page count and every screen/print SVG |
| Independent container identities | Body text, equation script, table-host body and two sibling cells sharing the same offsets: five replacements preserve every suffix, in HWP/HWPX |
| Cell / caption regressions | 1,242 cell search steps, 12 reopens; 216 caption starts / 720 calls, eight reopens; no errors or mismatches |
| Single-Replace failure/history regression | 32 cases, six fallback checks, 64 reopens |
| Existing search-span regression | 96 cases, 96 restores, 384 reopens; zero history SVG differences |
| Full desktop suite | 131 pass, zero fail, one pre-existing skip |
| Build/type/format | Release WASM, wasm-bindgen, TypeScript, changed Rust file rustfmt, production source bundle and git diff checks pass |

The checker executes real product methods with cursor/DOM/repaint adapters.
Its writable-document adapter is limited to synthetic documents. It does not
establish native GUI or general write-fence coverage. Inputs were derived from
existing synthetic scope fixtures; those source files were read without changes.

The first fixed checker incorrectly compared raw text-file export escaping to
literal supplementary characters. That failed run is retained in `evidence/fixed`.
The checker now separately compares decoded semantic text while retaining raw
export and byte comparisons for history and disk roundtrips. Both baseline and
fixed engines were rerun using the same final checker. Only the verified runs
support the table above.

Raw proofs: `evidence/baseline-verified/proof.json`,
`evidence/fixed-verified/proof.json`, `evidence/cell-final/proof.json`,
`evidence/caption-final/proof.json`, `evidence/single-final/proof.json`,
`evidence/span-final/proof.json`. Logs include `desktop-final.log`.
Source and evidence pins are frozen in `delivery-freeze.json`.

```sh
node scripts/check-replace-all-overlap.mjs OLD_ENGINE SCOPE_MANIFEST FIXTURES BASELINE_OUT baseline
node scripts/check-replace-all-overlap.mjs NEW_ENGINE SCOPE_MANIFEST FIXTURES FIXED_OUT fixed
node --test desktop/tests/replace-all-overlap.test.cjs
```

## Remaining limits

Shell execution recovered; app screen-control tools remain unavailable. No user
document or existing app window was manipulated. Actual Mac UI, genuine Hancom
editing/comparison, Korean IME, paste and Mac packaging/launch remain unverified.
The production bundle was built without QA exposures and was not launched.

`cargo test --lib --no-run --offline --locked` exits 101 because the same three
embedded samples are missing: `engine/samples/3-09월_교육_통합_2022.hwp`,
`engine/samples/hwp3-sample16-hwp5.hwp`, `engine/samples/hwpx/aift.hwpx`.
No samples were substituted or excluded. This is not a full Rust unit-test pass.
CI status is separate from local verification. Original dirty-tree hashes and
the preceding 13 source / 630 evidence pins are rechecked before delivery.
The new PR remains draft until independent review; no new merge is authorized.

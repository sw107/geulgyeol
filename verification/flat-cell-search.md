# Find/F3 retains its flat table cell origin

Base main: `9194b7483243c2886ff1453b000c116943069e09`, the ordinary merge
of PR #56 head `1af31905524934673d5021d07f9afa87758b5ca2`. Both the merged
PR and remote main were read back. Its empty check list is not a CI pass.
PR #56's preceding navigation evidence remains limited to body paragraphs.

This change uses the initially clean `dev/flat-cell-search-origin` worktree
at `/Users/sw107/Documents/Codex/2026-10-14/task/flat-cell-search/repo`.

## Reproduction and change

A synthetic table has two cells, with two paragraphs in the first cell.
Every paragraph contains a match at offset 0, between body matches before
and after the table. Find Next visits the first cell, then skips its next
paragraph and the adjacent cell. Reverse search similarly skips cells.
The engine compared only the outer body paragraph and character offset,
so different cell addresses collided. Cursor paragraph indices can also
be local after editing a cell paragraph.

FindDialog and closed-dialog Find Again now pass the complete flat cell
origin, normalizing its outer paragraph and preferring the current flat
path over legacy cursor fields. Previous Find retains the cached hit's
cell address while preserving the document-generation invalidation guard.

The optional eighth WASM argument is a strict cell-context JSON object.
It must agree with the outer paragraph and resolve to an existing table
cell paragraph. Invalid contexts reject without a body fallback or mutation.
The existing native entry point and omitted-argument body-only behavior
remain available. Forward search includes the caret; reverse excludes it.

Ordering follows the existing search collector: body paragraph text, then
its controls/cells/cell paragraphs, then the next body paragraph. Physical
anchor interleaving within one host paragraph and Hancom's visual reading
order have not been established. Nested cells, text boxes and equations
remain excluded from Find/F3. Matching and replacement policies are unchanged.

## Verification

QA root: `/Users/sw107/Documents/Codex/2026-10-14/task/flat-cell-search/qa`.
Final release WASM SHA-256:
`d62c0f8962dd23c3e0e7cb22b212fc438647bcf9e115610681577f2be0741598`.
It was built offline/locked with Rust 1.93.1 and processed with wasm-bindgen.

| Check | Result |
| --- | --- |
| New focused desktop tests against baseline WASM | 0 pass, 7 fail |
| Same tests against final WASM | 7 pass, 0 fail |
| Immutable synthetic HWP/HWPX | 6 documents; ASCII, Korean, emoji, adjacent matches, host body text, distinct cells and cell paragraphs |
| Actual engine/Bridge/FindDialog/Find Again | 1,242 forward/reverse steps; baseline 920 mismatches, final 0 |
| Cursor/document guards | Local cell paragraph, flat path precedence, unsupported path origins and stale document generation checked |
| Search preservation | HWP/HWPX bytes, text, paragraph properties, page count, every screen/print SVG unchanged; 12 disk reopens preserve those semantic/layout properties |
| Excluded scopes | Nested cell, text box and equation in HWP/HWPX; 24 scope checks, no mutation |
| Body-boundary regression | 1,120 steps, zero mismatches, 40 reopens; this row covers body navigation |
| Single-Replace failure/history regression | 32 cases, 6 fallback checks, 64 reopens; no wrong history or remaining partial mutation |
| Existing search-span regression | 96 cases, 96 history restores, 384 reopens; zero history SVG differences |
| Full desktop suite | 112 pass, 0 fail, 1 pre-existing skipped picture-layout test |
| Build/type/format | Final release WASM, wasm-bindgen, TypeScript, changed Rust code formatting, production source bundle and git diff checks pass |

Raw proofs: `evidence/baseline-verified/proof.json`,
`evidence/flat-final/proof.json`, `evidence/scope-final/proof.json`,
`evidence/body-final/proof.json`, `evidence/replace-final/proof.json`,
`evidence/span-final/proof.json`; final desktop log: `desktop-final.log`.
Source/output hashes and preservation checks are frozen in `delivery-freeze.json`.
Original dirty-tree hashes and the preceding PR's 651 source/evidence pins
were rechecked. Earlier runs are retained separately, including the first
desktop run's three API-argument expectation failures and two sandbox-denied
local-server tests. Updated expectations retain exact argument checks and
add a cached-cell-origin test. The final suite permits its local test server.

Reproduction with separately built baseline and final engines:

```sh
node scripts/check-flat-cell-search.mjs OLD_ENGINE FIXTURES BASELINE_OUT baseline OLD_SOURCE_ROOT
node scripts/check-flat-cell-search.mjs NEW_ENGINE FIXTURES FIXED_OUT fixed
node --test desktop/tests/flat-cell-search.test.cjs desktop/tests/find-stale-hit.test.cjs
```

## Remaining limits

Cursor/DOM adapters execute product methods in Node; they do not establish
native GUI, physical keyboard, Korean IME or paste behavior. The production
bundle was built without QA exposures and was not launched or Mac-packaged.
No user app window or document was manipulated. Screen control tools are
absent. Installed bundle metadata identifies Hancom Office HWP 12.30.0
(6544); current runtime editing and Hancom comparison remain unverified.

The full Rust library test compile exits 101 because three embedded samples
are missing: `engine/samples/3-09월_교육_통합_2022.hwp`,
`engine/samples/hwp3-sample16-hwp5.hwp`, and
`engine/samples/hwpx/aift.hwpx`. They were not substituted or excluded.
This is not a full Rust unit-test pass. CI is reported separately from local tests.

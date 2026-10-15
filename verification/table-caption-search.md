# PR #57 follow-up: table caption search origin

Review found a regression in PR #57 head
`3c96f14ded2345d937659d397250b0820b4096d2`: `enterTableCaptionEditing`
sets `cellIndex=65534`, while `FindDialog.searchOrigin` treated those flat
fields as an ordinary table cell. The WASM correctly rejected cell 65534,
and the exception stopped a fresh Find Next/Previous or closed-dialog Find Again.

The failure was reproduced without injection using real caption-bearing
synthetic HWP/HWPX, the product caption-entry method, Bridge, FindDialog,
Find Again and the existing WASM. All 216 caption search starts threw
`검색 시작 셀 좌표가 잘못됨` on the reviewed source. The new desktop regression
also failed before the fix.

The production fix adds a caption-sentinel guard after resolving the current
flat path. A caption keeps its outer body paragraph and caret-offset hint,
without supplying a cell origin. Caption text stays outside Find/F3's existing
search scope. Ordinary cells keep their complete addresses. Engine validation
remains strict; the raw invalid-origin test now explicitly includes 65534.
No Rust, serialization, mutation, keyboard or document-generation code changed.

## Final verification

QA root: `/Users/sw107/Documents/Codex/2026-10-14/task/caption-search-origin/qa`.
The offline/locked release build and wasm-bindgen were rerun. Every generated
SDK file, including WASM, is byte-identical to the reviewed PR's engine:
`d62c0f8962dd23c3e0e7cb22b212fc438647bcf9e115610681577f2be0741598`.

| Check | Result |
| --- | --- |
| Caption regression | Four immutable HWP/HWPX documents; empty/nonempty host body, actual flat caption entry and sentinel path, offsets 0/3/end, matching/missing/caption-only query, Next/Previous/Find Again |
| Reviewed source | 216 starts, 216 natural engine errors |
| Fixed source | 216 starts, 720 search calls, zero errors or sequence mismatches; caption sentinel never passed as a cell origin |
| Caption roundtrips | Eight disk reopens; text, caption, table/paragraph properties, page count and every screen/print SVG match; searches preserve HWP/HWPX bytes |
| Ordinary cell regression | 1,242 search steps, zero mismatches, 12 reopens |
| Body boundary regression | 1,120 steps, zero mismatches, 40 reopens |
| Single-Replace failure/history | 32 cases plus six fallback checks, 64 reopens |
| Existing search-span regression | 96 cases, 96 history restores, 384 reopens, zero history SVG differences |
| Full desktop suite | 113 pass, zero fail, one pre-existing skip |
| Build/type | Final WASM/SDK, TypeScript, production source bundle and git diff checks pass |

Raw proofs are `evidence/baseline-verified/proof.json`,
`evidence/caption-final/proof.json`, `evidence/cell-final/proof.json`,
`evidence/body-final/proof.json`, `evidence/replace-final/proof.json`,
`evidence/span-final/proof.json`; logs include `desktop-final.log`.
`engine-comparison.json` pins the unchanged engine. Final source and evidence
hashes are recorded in `delivery-freeze.json`.

The first fixed-run checker compared JSON key insertion order and reported
false sequence differences. Its evidence is retained in `evidence/fixed`.
Keys were canonicalized, then baseline and fixed source were rerun with the
same final checker into fresh directories. Only verified results are used above.

Reproduction:

```sh
node scripts/check-table-caption-search.mjs ENGINE FIXTURES BASELINE_OUT baseline REVIEWED_SOURCE_ROOT
node scripts/check-table-caption-search.mjs ENGINE FIXTURES FIXED_OUT fixed
node --test desktop/tests/table-caption-search.test.cjs desktop/tests/flat-cell-search.test.cjs
```

Original dirty-tree files remain unchanged. The reviewed source is preserved
in `baseline-source`; its nine original source pins and all 1,219 prior evidence
pins are rechecked. This follow-up preserves the previous evidence rather than
rewriting the original delivery record.

These are source/engine checks with cursor/DOM adapters. Screen control tools
remain absent. Actual Mac UI, genuine Hancom editing/comparison, Korean IME,
paste and Mac packaging/launch remain unverified. No app window or user document
was manipulated. The prior full Rust library compile remains blocked by the
same three missing embedded samples listed in `flat-cell-search.md`; this
follow-up does not claim a full Rust unit-test pass. CI is separate from local
verification. PR #57 remains draft pending another independent review; no merge
or ready action is authorized by this follow-up.

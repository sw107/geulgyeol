# Forward search includes a match at the caret

Base main: `ef9400009a556ee9460104c99ea416c1ebce72f6`, the ordinary merge of
independently reviewed PR #55 head `fd2296b81c7091c6df4561b4fe103a7baae82c13`.
PR #55 was confirmed mergeable with no checks, changed from draft to ready,
then merged with a head-SHA precondition. Remote main was read back twice.
No duplicate merge was performed and absent CI checks are not a CI pass.

This change uses a separate, initially clean worktree:
`/Users/sw107/Documents/Codex/2026-10-14/task/cell-search-navigation/repo`,
branch `dev/forward-search-boundary`. Node dependencies, fonts and generated
WASM are linked only into ignored local paths; user source files are untouched.

## Reproduction and minimal fix

In a synthetic body paragraph `needleneedle`, start at scalar offset 0 and
execute Find Next repeatedly. The previous engine selects starts `[6, 0, 0]`:
it skips the first occurrence, then cannot advance from the first to the
adjacent second occurrence after wrapping. A match at the initial caret or
exactly at the previous match's end was excluded by `char_offset > from_char`.
The same defect is present through the product FindDialog and closed-dialog
Find Again command, without a failure injection.

The sole production change makes the forward comparison inclusive (`>=`).
Callers advance using the previous match's end. Reverse search still uses
`<`, excluding the current match's start, and the existing overlapping-literal
match policy is unchanged. No mutation, serialization, document-transition,
write-fence or keyboard/IME code changes.

## Verification

The pinned old engine is `9c526ed153f2b0644464ad9da59664eba2cb429c783bdc88f15899fbf797ac06`.
The new release WASM was built offline/locked from this worktree with Rust
1.93.1, then processed with the existing wasm-bindgen tool. New engine SHA-256:
`5166699e854392cd1f7fdb692e5fd1a990ef33d882023fd2cbc3eda9c98efdb8`.

| Check | Result |
| --- | --- |
| New focused desktop tests, old engine | 0 pass / 16 fail, reproducing the boundary contract failures |
| Same focused tests, new engine | 16 / 16 pass |
| Immutable HWP/HWPX inputs | 20 documents: adjacent/spaced ASCII, emoji, Korean, case-insensitive and overlapping matches, exact/nonzero/inside-match cursors, later paragraph, single and missing matches |
| Engine + actual Bridge/FindDialog/Find Again methods | 1,120 forward/reverse search steps; old engine 608 mismatches, new engine 0 |
| Search preservation and roundtrips | Complete HWP/HWPX bytes unchanged by searches; 40 disk reopens preserve text, paragraph properties, page count, all page SVGs and print SVGs |
| PR #55 single-Replace regression on new engine | 32 cases, 6 fallback checks, 64 reopens; no wrong history or surviving partial mutation |
| Existing search-span regression | 96 cases, 96 history restores, 384 reopens; zero history SVG differences with strict source-dialog layout checks |
| Desktop suite | 104 pass, 0 fail, 1 skipped |
| Build/type/format | Release WASM build, wasm-bindgen, TypeScript, changed Rust file rustfmt, production-mode source bundle and git diff checks pass |

The new checker executes real engine APIs, the current bridge method, the
FindDialog controller and the existing closed-dialog Find Again command.
DOM/cursor services are adapters; these are source/engine checks, not actual
Mac UI or physical keyboard tests. `actualUICases` in the older search-span
report names its source-dialog path and does not mean native GUI coverage.
The new fixtures focus on body navigation; arbitrary table-cell origin
addressing is not claimed by these body checks.

The first new test oracle incorrectly omitted overlapping literals. Its
outputs remain in the failed `baseline` and `fixed` evidence directories.
The oracle was corrected to the existing engine policy and both engines were
rerun into fresh `baseline-verified` and `fixed-verified` directories. Only
those verified results are used above. The first full desktop run also lacked
the generated runtime SDK in the fresh worktree; that setup failure is retained.
The final full suite uses the freshly built SDK, including the 16 new tests.

## Evidence and remaining manual checks

QA root: `/Users/sw107/Documents/Codex/2026-10-14/task/forward-search-boundary`.
Raw proofs: `evidence/baseline-verified/proof.json`,
`evidence/fixed-verified/proof.json`, `evidence/single-replace-regression/proof.json`,
and `evidence/search-span-regression/proof.json`. Baseline inputs and their
checksums are in `fixtures/pins.json`. Source and output hashes are frozen in
`delivery-freeze.json`.

Reproduction:

```sh
node scripts/check-forward-search-boundary.mjs ENGINE_PKG FIXTURES FRESH_OUTPUT fixed
node --test desktop/tests/search-boundary.test.cjs
```

The native app/document-session tool is still absent. The production source
bundle was built but not launched, packaged, signed or notarized. Actual Mac
Find Next/Previous, Find Again, adjacent-match selection, genuine Hancom
comparison and the separate ordinary-key/Korean-IME/paste investigation remain
manual work. No existing app window or user document was opened or closed.

`cargo test --lib --no-run --offline --locked` was attempted and exits 101
because the same three embedded samples are absent:
`engine/samples/3-09월_교육_통합_2022.hwp`,
`engine/samples/hwp3-sample16-hwp5.hwp`, and `engine/samples/hwpx/aift.hwpx`.
They were not replaced or excluded. This is not a full Rust unit-test pass.
CI status is reported separately. Original dirty-tree and previous-checkout
status/diff/untracked hashes are rechecked before delivery.

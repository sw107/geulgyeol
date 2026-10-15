# Find Previous after a document switch

Base: `93328de6070502086ffa4de1e697dc96bb2a85e7`.

## Reproduction and change

In the actual Mac Electron app, open synthetic A with `OLD needle A_END` in
paragraph 1, find `needle`, and keep the modeless Find/Replace dialog open.
Open synthetic B, whose saved cursor is at paragraph 0, offset 0:

```text
FIRST needle
SECOND__ needle
LAST needle
```

Before the fix, clicking Previous selects B's first match. It should wrap from
B's initial cursor to the last match. The dialog retained A's paragraph 1,
offset 4 as the reverse-search origin. Document initialization clears editor
selection/history but does not publish the mutation/history events to which
the dialog subscribes. Single Replace already checks document generation;
reverse search did not.

Search now invalidates its cached hit when the bridge's document generation
changes, before choosing the reverse-search origin. Same-document Previous
still starts at the current match's beginning to skip that match.

## Verification

- Native Mac UI, official Electron 44.3.0, isolated QA profile, current source
  build. All UI actions used cua_repl AX/coordinates. File chooser answers were
  controlled; desktop IPC and saved filesystem bytes were real. This was not
  a packaged release or an ordinary native chooser test.
- HWPX baseline reproduced the wrong first-match selection. Fixed HWPX selects
  last, then middle; single Replace affects only the selected middle match.
  Replace All changes 3 matches, one Undo restores them, and Redo restores the
  replacements. Attempts to undo/redo the old document after opening B did not
  change B. HWP was also checked with Previous immediately after A-to-B Open:
  it selects the last match and shows the wrap message.
- Keeping the dialog open through New leaves a clean blank document. Old
  undo/redo attempts do not restore old content; stale Replace finds no match;
  Replace All reports zero. A fresh document containing
  `FRESH needle / needle END` supports Find, two replacements, Undo, Redo,
  save and UI reopen.
- UI-saved and UI-reopened files: `B-replaced.hwpx`, `B-replaced.hwp`, and
  `fresh-replaced.hwp`. Their content and one-page layout were observed in
  the native screenshot trace. Independent engine reads verify their exact
  expected text; 6 additional SDK save/reopens preserve paragraph properties,
  all page SVGs and print SVGs. SDK checks are separate from the 3 UI reopens.
- New focused regressions: baseline 10 pass / 2 fail; fixed 12 / 12 pass.
  They cover stale body/cell coordinates and unchanged-document reverse
  search. Full desktop suite: 85 pass, 0 fail, 1 skipped. TypeScript: exit 0.
- Original dirty checkout, its untracked hashes, and the prior
  `evidence/run/verification.json` remain unchanged.

Evidence root:
`/Users/sw107/Documents/Codex/2026-10-14/task/find-dialog-document-switch`.
Current observations are in `evidence/resume/mac-observations.json`, and
independent disk reads are in `evidence/resume/saved-files-proof.json`.
Screenshots were observed in the cua_repl trace; no separate screenshot files
are claimed.

Verified FindDialog SHA-256:
`62a742f011062b5c6e1fd08f3c53b2b40cc5e66661e6c29d608c7feeb80ea030`.
Unchanged WASM SHA-256:
`9c526ed153f2b0644464ad9da59664eba2cb429c783bdc88f15899fbf797ac06`.

## Limits and follow-up

One rapid native `typeText` attempt produced partial input and the transition
guard warning "확인 중 문서가 변경되었습니다. 다시 확인해 주세요."
Its cause is not established and that attempt is not counted as a pass.
After dismissing it and creating a fresh synthetic blank, normal paste,
Find/Replace, Undo/Redo, save and reopen succeeded. This warning needs separate
follow-up; this change only addresses cached reverse-search coordinates.

Table-cell cached hits are covered by the unit regression; native UI cases
used body text. Hancom comparison was not rerun for this change. No full Rust
suite pass is claimed: the three previously missing fixtures remain absent
(`engine/samples/3-09월_교육_통합_2022.hwp`,
`engine/samples/hwp3-sample16-hwp5.hwp`, `engine/samples/hwpx/aift.hwpx`).
No CI success is claimed.

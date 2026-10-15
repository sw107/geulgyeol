# NewStart removal, bullets and history

Independent review of PR #52 head `f516ea3eb0246cd6af84cedd89e492aea1142d94` found that plain-text/bullet transitions retained a transient NewStart and caused both HWP and HWPX export to reject the document. Reapplying numbering also revived the old 123. Actual Mac source-QA reproduced all three routes: dialog removal, toolbar removal and bullet transition.

Body formatting now clears restart when the resulting head is plain text or a bullet. Active Number/Outline behavior and the existing export bounds are preserved. Export also ignores inactive restarts in old snapshots, without mutating live state, including when another paragraph requires projection. Toolbar history originally restored only shape IDs; removal/bullet commands now use the existing snapshot mechanism so undo restores 123 and redo clears it again. Reapplying the original list after removal resumes `1.,2.,3.,4.,4.1.,5.`. Cell snapshot branches are unchanged.

Final WASM SHA-256: `9c526ed153f2b0644464ad9da59664eba2cb429c783bdc88f15899fbf797ac06`.

QA root: `/Users/sw107/Documents/Codex/2026-10-14/task/numbering-restart-persistence`. Paths in the table are relative to `evidence/toggle-p2` unless stated otherwise. The post-reconnection build was compared with the tested WASM and production UI assets before commit; root `resume-source-match.json` records those hashes.

| Check | Result and evidence |
| --- | --- |
| Actual Mac P2 baseline | Initial engine `b32f304e…21a1`: three handler routes fail both exports and reapplication revives 123. `mac-baseline-final/proof.json` |
| Actual Mac fixed transitions | Three real handler paths, undo/redo, numbering reapplication and **24 HWP/HWPX app reopens** pass. Source-QA uses instrumented handles and controlled dialogs, with normal exit 0. `mac-history-fixed/proof.json` |
| Native | **25 reopens**: original nine restart cases plus 16 removal/reapplication/stale-state cases. Snapshot undo/redo, unchanged live export state and formatting pass. Active lower-level/out-of-range restarts remain explicitly rejected. `native/proof.json` |
| WASM and pagination | Seven persistence reopens, unchanged no-restart output bytes against the initial engine; three-page / 71 later-line control with four reopens. Actual Mac three-page / 72 later-line check: first/later x=139.4, multilevel labels and both reopens retain restart without reapplication. `wasm-persistence`, `wasm-pages-verified`, `mac-pages` |
| Existing regression | Four-flag / ten reopens / nine-page control; body 20 cases / 44 reopens; cell 78 cases / 156 reopens (labels/properties/history/save, not coordinate coverage). `four-flags`, `body-history`, `cell-verified` |
| Flag contracts and exports | Native 28 contracts / 30 reopens and WASM 30; all 60 final exports retain head flags and sentinel/0 references. Ten restarted HWPX files use standard start 123 and no invented `newNum`. `native-flags`, `wasm-flags`, `export-inspection.json` |
| Ordinary final Mac package | Final served WASM / 80 ASAR files and ad hoc signature verified. Existing 12 reopens pass. Separate Hancom input check completes **four additional app reopens**, preserving exact source text plus native edit marker, six labels and three pages. No QA handles or dialog replacement. `mac-production`, `mac-native-interop`; root `toggle-history-package/package-proof.json`, `toggle-history-sign.log` |
| Final checks after reconnection | TypeScript exit 0; desktop 82 pass, one skip. Root `resume-typecheck.log`, `resume-desktop-tests.log`. Original dirty checkout status, binary diff and untracked hashes remain unchanged. Root `source-preservation.json` |

The first fixed Mac attempt found the additional toolbar-history gap; its failure remains at `mac-fixed`. Earlier cell attempts lacked the fixture-proof environment variable, and a page attempt named a nonexistent input; these are retained setup failures, not successful checks. Corrected runs use the existing absolute fixture proof and unchanged historical input. No original fixture was replaced or normalized to make a test pass.

## Genuine Hancom bidirectional cycle

Editing product: **한컴오피스 한글 12.30.0 (6544)**. Finder Open With on a new synthetic copy restored file commands; no hidden modal or exact internal cause was proven. No app restart, process termination, security change, login, license activation or existing-window closure was used.

For HWP and HWPX separately:

1. Opened Geulgyeol's synthetic three-page export in editing Hancom. First page visibly showed `1.,2.,123.`; continuation/last page showed consistent body indentation and `124.,124.1.,125.`. The HWP view also showed the first/second-page boundary with LINE37/LINE38 continuation.
2. Inserted `[HANCOM_HWP]` or `[HANCOM_HWPX]` at the end of the last paragraph. Used the genuine Save As dialog, retaining the source format and choosing a new filename outside `inputs`.
3. Copied each saved file to a fresh pathname and reopened through Hancom's normal Open dialog. First and last page screenshots in the tool trace retained 123, child numbering, edit marker and three pages. This avoids counting an already-open document as a disk reload.
4. Loaded both native saved files into the final ordinary Geulgyeol Mac package, then saved/reopened each as HWP and HWPX. Exact paragraph text equals the original plus the expected suffix; labels remain `1.,2.,123.,124.,124.1.,125.` and page count stays three. App screenshots, hashes and normal exit 0 are at `mac-native-interop`.

The final engine's actual Mac exports are **byte-identical** to the two files opened in Hancom. `native-input-equivalence.json` records HWP SHA-256 `ae56a58e939b92bc5d3dad70d9bd08476ba8f5231292a2e23cb9a988346d4631` and HWPX `dd52f3748c64b2e03c18004e135a8823af6af40bbb898485ef64c0fb7adcd17a`. Native operations and filenames are at `evidence/native-interop/native-ui-proof.json` relative to the QA root. Its reverse-app pending flag describes the earlier native stage; the subsequent `mac-native-interop/proof.json` completes that step. Hancom screenshots are in the conversation tool trace; no standalone image files are claimed for them.

This establishes the specified synthetic native cycle. It does not establish arbitrary font/line-wrap identity between applications or physical IME entry. Source-QA transition checks invoke actual UI handler methods using instrumented handles and controlled dialogs, separately from the genuine Hancom chooser cycle.

## Reproduction and limits

```sh
node scripts/check-electron-numbering-restart-toggle.mjs RUNTIME_ROOT ENGINE_PKG SIX_PARAGRAPH_INPUT FRESH_OUTPUT baseline-or-fixed
cargo run --manifest-path engine/Cargo.toml -p rhwp --example numbering_restart_persistence_check -- SIX_PARAGRAPH_INPUT FRESH_OUTPUT
```

Full Rust lib-test compilation still exits 101 for the same three missing embedded samples listed in [the initial report](numbering-restart-persistence.md); see root `toggle-full-rust-lib.log`. No full lib-test success is claimed. An empty PR check list is not CI success. General font/wrapping fidelity, Roman fixed widths and split-cell `start_line > 0` remain outside this correction. Merge remains with the independent reviewer.

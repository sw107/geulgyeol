# Beta readiness and fresh-ASAR runtime dependency closure

PR #58 head `88212499dfe9cd5503c0961ddef56f2e956f7e7f` was independently
reviewed, confirmed ready/mergeable without checks, and normally merged.
Remote main readback: `2d3b10450b3484d093fbdb94af1d65bc51fd6a93`.
No CI success is inferred from an empty check list. This separate worktree
starts at that main, branch `dev/beta-runtime-closure`.

## Beta remains on hold

Read-only GitHub release lookup finds public `v0.4.4-beta.2`, published
2026-10-08, with the Mac arm64 ZIP and SHA256SUMS assets. Current source
package, window title and host HTML identify `0.4.4-beta.3 / GeulgyeolBeta3`.
The public quick-start document still describes beta.1. No version, public
asset, tag, ZIP or release was changed in this task.

| Gate | Observed state / remaining requirement |
| --- | --- |
| Verified fix | PR #58 is on main; production WASM remains `68bf45b5ec9cca1f2ad2f495c03dccaaea208cccc50813e7fb85409a006474e9` |
| Version and instructions | Source labels agree at beta.3; update the beta.1 quick-start/install/verification instructions for the actual candidate before distribution |
| Fresh production inputs | A fresh production source bundle was built with the verified engine and QA globals disabled. No final Mac candidate was made. Use reviewed committed source, verified runtime, explicit UI/engine/font inputs and provenance; an old dev app rename is insufficient |
| Runtime signature | Installed npm Electron metadata is 44.3.0. Read-only strict/deep verification exits 1: `code has no resources but signature indicates they must be present`. Cause is unconfirmed. The installed runtime was not changed or resigned; obtain/verify suitable runtime inputs and verify the final candidate independently |
| Final candidate signature | Pending. The repository provides ad-hoc signing, not Developer ID signing or notarization; preserve that disclosure |
| Actual package workflow | App screen-control tools are unavailable. Actual Mac launch/open/edit/save/reopen/print remains unverified; synthetic module loading does not satisfy this gate |
| Public files | Private production-source runtime inventory covers 53 ordinary files, excluding linked fonts. Defined high-confidence credential patterns and sensitive filenames produced zero findings. Four WASM/binding files contain absolute user-path metadata; bindings have documentation examples and WASM has compilation dependency paths. Values were withheld. Review this metadata, font licenses and the final distributable archive before public adoption |
| Publication | Pending final archive inventory/content review, checksums and download verification. No release assets were created |

The limited pattern scan is not a general guarantee that no secrets exist.
It does not cover linked fonts or a final signed archive, which does not yet
exist. Raw QA logs and local-source provenance are private evidence, not public
release attachments. No security settings, access rejection, existing app
window or user document was changed or bypassed.

## Small packaging fix

The fresh packager explicitly selects desktop runtime modules. `main.cjs`
requires `./print-preview.cjs`, but that file was missing from its required
set. The packager successfully emitted an ASAR that could not resolve this
top-level dependency. Add that single file to the existing explicit set;
the file-selection policy and excluded roots remain unchanged.

The regression executes the real Python packager in a temporary clean Git
fixture, reads back and verifies its ASAR, and loads its actual main/preload
source with a stub Electron interface. The fixture has a tiny non-executable
synthetic runtime and synthetic UI, WASM and font inputs. Its sourceCommit is
a fixture commit. These outputs are test artifacts and must never be released
or mistaken for the real beta.

| Check | Result |
| --- | --- |
| Baseline emitted ASAR | `print-preview.cjs` absent; main dependency loading fails with `MODULE_NOT_FOUND` |
| Fixed emitted ASAR | Current print-preview bytes included; main/preload dependency closure loads, including server/storage/close/shortcut/print modules |
| Source and archive integrity | Actual packager runs, ASAR file integrity reads back, included runtime bytes match current source, and synthetic build/version/engine provenance agree |
| Private canaries | Five deliberately tracked synthetic private/test/dependency canaries remain excluded in both baseline and fixed ASARs |
| New regression | Before fix: zero pass / one fail; after fix: passes in the final suite |
| Full desktop suite | 132 pass, zero fail, one pre-existing skip |
| Production source build | Pass; not an app launch or native print result |

No Rust or application-runtime source was modified. The same verified engine
is reused; prior engine/UI/IME, controlled-failure and natural-failure limits
remain unchanged. The full Rust library test compile remains blocked by the
three embedded samples listed in `replace-all-overlap.md`; it was not rerun
or claimed to pass for this packaging-only change.

QA root: `/Users/sw107/Documents/Codex/2026-10-14/task/beta-runtime-closure/qa`.
Key records: `beta-readiness.json`, `current-release.json`, `merged58.json`,
`official-runtime-signature.log`, `production-public-file-audit.json`,
`evidence/baseline/proof.json`, `evidence/fixed/proof.json`,
`desktop-final.log`, `production-preparation/build-proof.json`.
Original dirty-tree and previous 12 source / 1,400 evidence pins are rechecked.
Final hashes are frozen in `delivery-freeze.json`.

```sh
node scripts/check-merged-beta-runtime.mjs FRESH_OUTPUT fixed
node --test desktop/tests/merged-beta-runtime.test.cjs
```

The new change remains a draft PR for independent review. Beta release is
held until the remaining package gates above are completed; no ready/merge
or publication of this new change is included in the current task.

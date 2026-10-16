# Electron font QA input and completion contract

Reviewed PR #66 head: `157c55a20c1baed6b23a3b88de096884136b01f0`.
QA root: `/Users/sw107/Documents/Codex/2026-10-14/task/electron-font-runtime-contract/qa`.
PR #66 remains unmerged pending independent review. Product source, engine,
font bytes and beta publication are unchanged/held.

## Reproduced false-success path

The reviewed runner checked only eight rows and hashes of whatever variants
were supplied. It used the first variant as the comparison baseline and relied
on `fonts.some(...)` to reject differences. Eight TTF-only rows could therefore
produce eight self comparisons; eight empty variant lists could produce no
font comparisons. Neither case necessarily contained a difference to reject.
Duplicate font names and a TTF moved into the baseline position were also
unconstrained.

`old-flow-replay.json` reproduces all four paths using the exact reviewed Git
source's checks and the preserved real measurement records. The old input and
success conditions accept all four. The empty case has zero profiles/loads;
the TTF-only case has eight profiles/forty loads, not forty profiles/two hundred
loads. This is explicitly a source-flow replay, not a newly executed Electron
run and not a modification to any saved real-app proof.

## Input contract enforced before any output or launch

The runner now calls `validateFontInputs` from a separately testable module.
It requires:

- Schema 1 and the current product inventory hash.
- Exactly the eight named Nanum files, without duplicate or unknown rows, and
  their inventory weights.
- Exactly five unique kinds in order: current WOFF2, decoded-current SFNT,
  official full TTF, full null-transform WOFF2, full standard-transform WOFF2.
- Distinct payload hashes per file; declared size, size bound, SHA-256 and
  WOFF2/TrueType container checks.
- The current WOFF2 SHA from the product inventory as the baseline, and the
  official TTF SHA from its pinned glyph reference. Rebinding hashes in an
  edited input does not redefine either authority.
- Coverage of the shared text corpus by the current mapping list.

The exact validated byte buffers are retained and sent to the browser; paths
are not reread later for rendering. The loop explicitly assigns its baseline
only when the kind is `current-woff2`, rather than using the first result.

## Completion contract

`allStepsCompleted` becomes true only after `assertRuntimeCompletion` succeeds.
The returned observed counts are written to `completionCounts` in future proofs,
and the contract module's SHA is recorded. Required totals are:

| Observation | Required count |
| --- | ---: |
| Unique file/kind pairs | 40 |
| Pinned current baselines | 8 |
| Observed FontFace load timings | 200 |
| Alternatives compared to current | 32 |
| Document families / saves / reopens / PDFs | 4 / 8 / 8 / 4 |

Every profile must have five load and five constructor/load timings, all twelve
unique text/size measurements and a raster digest. The checker binds observed
hashes/sizes back to the validated profiles and recomputes metric/pixel equality
against the current baseline. True flags cannot conceal different raw results.
Document families and both saved/reopened formats must also be complete.
Empty, truncated, duplicated or self-only result arrays cannot pass vacuously.

## Verification and preserved evidence

The new contract tests use explicitly synthetic schema/result fixtures; they do
not pretend that their mock byte buffers were parsed by Chromium. Together with
the existing owned-exit/serial-poll tests, 44 tests pass with no failures/skips.

Fifteen actual CLI negative invocations cover TTF-only/empty/missing variants,
duplicate or unknown names, duplicate kinds or payloads, baseline reordering or
replacement, rebound baseline/reference hashes, size/weight/schema/inventory
changes. All exit 1 before creating outputs, so Electron is not launched. Seven
additional checks mutate copies of the saved measurement records to remove
profiles/trials, duplicate pairs or conceal differing raw metrics/pixels; the
completion gate rejects every one.

The unchanged prepared input validates as forty cached buffers. Both previously
completed actual-app runs are revalidated directly against the new completion
contract, returning 40 profiles / 200 loads / 8 baselines / 32 alternatives and
4 documents / 8 saves / 8 reopens / 4 PDFs. Their original proof hashes are
recorded in `guard-proof.json`. This revision performs **no new Electron run**;
the prior app evidence was independently confirmed and remains immutable.

```sh
node --test scripts/tests/electron-font-runtime-contract.test.mjs \
  scripts/tests/electron-qa-exit.test.mjs scripts/tests/electron-qa-serial-poll.test.cjs
```

The QA root retains the source-flow replay/CLI driver, mutated inputs, rejection
logs, result-revalidation proof and source pins. Node syntax and whitespace
checks pass. No product TypeScript changed; no new desktop/native pass is
claimed. CI absence is not a pass. The original dirty tree, earlier QA freezes
and original real-app measurements are preserved.

Actual Hancom comparison, manual OS dialogs, physical IME/printers, GPU, long
sessions, font replacement/RFN closure and final distribution remain open.
Beta publication is held; this fix closes a QA false-success path only.

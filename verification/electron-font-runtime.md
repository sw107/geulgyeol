# Packaged Electron, browser fonts and PDF output

Product main: `9a9db66bda140f65f63c7d0eba9ceb2b5dca42ba` (PR #65 merged).
QA root: `/Users/sw107/Documents/Codex/2026-10-14/task/electron-font-runtime-qa/qa`.
Startup-ownership follow-up: the sibling `qa-followup` directory. The original
QA freeze remains intact; the follow-up has a separate final freeze.
This change adds QA tools and evidence documentation. Product code, the engine,
25 product font binaries and generated font rules are unchanged.
The subsequent P2 fix for incomplete comparison inputs and vacuous success is
documented in [the runtime input/completion contract](electron-font-runtime-contract.md).

## Recovered execution scope

The shell can launch actual Electron with local-app execution permission.
The sandboxed probe terminated with SIGABRT; the separately retained local
probe succeeded with Electron 44.3.0 / Chromium 152.0.7977.78 and real
BrowserWindow, FontFace and Canvas2D APIs. No security setting was changed.
There is still no text-session Mac screen/click/keyboard tool. DevTools and
existing app automation are the supported means used here; screenshots are
Electron webContents pixels, not observation of OS dialogs or other apps.

A fresh production build, with development read globals absent, was packaged
from that main and the existing runtime. The QA-only app has 83 ASAR entries,
279 bundle entries and matching bundled/loose engine hash
`d27a745d2048b1029df9f251482340be5022755639cc780c7fcaea9c4fe913c1`.
All ASAR/block/source checks and strict deep ad-hoc signature verification pass
before and after execution; all 279 bundle records remain identical. This is
not Developer ID signing, notarization or a final distribution candidate. No
ZIP, tag or public release asset was produced.

## Actual app document and font loading results

`scripts/check-electron-font-runtime.mjs` uses the unchanged packaged main,
preload, host IPC, atomic writes, browser renderer and HWP-control plugin. The
existing packaged QA adapter controls native chooser *responses* and keeps the
owned windows from taking the user's keyboard focus. The ASAR and renderer
logic are not patched. Synthetic edits use the public HWP-control plugin.

Four synthetic documents request the English/Korean names of the two ExtraBold
faces. Real host Open loads each fixture, a programmatic edit adds Korean/Latin
text, and real host Save writes both HWP and HWPX through IPC and atomicWrite.
All eight saved files are reopened through host Open. Exported bytes parsed by
the real engine retain the edited text and first-character requested family.
The 4 documents / 8 saves / 8 reopens pass. These are single-paragraph fixtures,
not a broad layout corpus or a manual native-chooser workflow.

For the two Korean names, the product's actual FontFace registrations reach
`loaded`, the local ExtraBold WOFF2 URLs are requested, and the app logs report
successful loads. For the English names, the app's width-based OS detector
reports installed fonts, so no bundled FontFace is observed. This is a recorded
app decision, not independent identification of an installed font file. That
priority was not disabled or spoofed to force a webfont result. There are no
recorded page errors or failed resource requests in the completed run.

## Chromium candidate compatibility and timing

The same real renderer separately constructs FontFaces from all 40 pinned
profiles: eight files × current WOFF2 / decoded-current SFNT control / full
official TTF / full null-transform WOFF2 / full standard-transform WOFF2.
Each uses a unique QA family alias, real browser font parsing, FontFaceSet
registration and Canvas2D. Five serial trials per profile complete: 200 loads.
All tested characters are in the current cmap, so missing-character fallback
is excluded from the four shared strings at 16/28/48px. There are 32 alternative
versus current pixel-grid/metric comparisons, all equal, across 480 rendered
text/size cases. This adds Chromium coverage to the retained CanvasKit results;
it does not test every added full-source character or every shaping script.

The first timer measured only `await face.load()` and was approximately zero:
binary FontFace parsing can happen during construction. The corrected timer
starts before the byte-buffer copy and constructor and ends after load. Raw
old and corrected measurements remain, rather than treating zero as free work.

| Eight-file profile | Raw bytes | Constructor + load p50 / p95 (ms) |
| --- | ---: | ---: |
| Current WOFF2 | 3,962,468 | 11.25 / 15.60 |
| Decoded-current SFNT control | 18,623,024 | 2.90 / 4.40 |
| Official full TTF | 20,117,512 | 3.80 / 4.60 |
| Full null-transform WOFF2 | 5,160,152 | 10.45 / 12.10 |
| Full standard-transform WOFF2 | 4,448,192 | 14.00 / 16.20 |

Each timing row pools 40 samples (eight files × five trials) in one warm
Chromium process. CDP transfer, base64 decoding, disk/network I/O and whole-app
startup are excluded. OS font caches were not controlled. First-trial Canvas2D
draw submission plus readback p50 is about 1.4–1.5ms per profile group. These
are narrow local measurements, not a cold-start, GPU, RSS or user latency
prediction. Full standard WOFF2 is 12.26% larger than current; full TTF is
407.70% larger despite the lower in-memory parse timing. No candidate was
written over a product font or installed on the system.
The table uses the first completed run (`qa/app-run-complete`, QA source
`70210e69222944ac6900031dc8b63bea50c629dd`). The ownership follow-up reruns the
same actual app/font/document/PDF workload and retains its own raw measurements.

## Product print preview and PDF

For each edited/reopened document, public `file:print` creates the real product
SVG print preview. Electron `webContents.printToPDF` prints that preview with
backgrounds and CSS page size; the physical Print button is not invoked.
Four PDFs (9,373–13,297 bytes) are generated. The existing Swift PDF inspector,
compiled with a task-local module cache, opens all four with PDFKit/CoreGraphics,
checks one page each and renders at 144dpi. Extracted Korean/Latin text matches
the edited document when whitespace is ignored; one extraction inserts a
space in `doc-1`, so exact raw text order/spacing is not claimed. Product and
native PDF raster images were inspected for the bounded test text.

This verifies the product preview → Electron PDF path. The browser/macOS print
sheet, its Save-as-PDF UI, physical printers and Hancom printing remain untested.

## Full-source distribution conditions and remaining decision

The pinned reference is Google Fonts commit
`1d0e46c7933245c8180fe83e47917961c913bbdb`. The new
`scripts/audit-nanum-distribution.py` checks all current/reference hashes and
records eight full TTFs, sixteen full WOFF2 candidates and three source OFLs.
All three source notices are byte-identical to the notices already packaged.
Copyright and Reserved Font Name declarations are present. The WOFF2 name and
cmap tables, full character inventory and smart-layout tables retain the
reference bytes. Extended WOFF2 metadata is absent. Decoded differences are
limited to head/DSIG and, for the Coding standard transforms, glyf/loca.

Unchanged licensed full TTFs can be bundled subject to the OFL conditions:
retain copyright/license information, keep the font under OFL, do not sell it
alone, and do not imply author endorsement. The RFN restriction applies to
modified versions. This does not turn the existing undocumented subsets into
approved originals. See the [official OFL text](https://openfontlicense.org/open-font-license-official-text/).

For WOFF/WOFF2, the FAQ permits retaining names when data is unchanged except
compression with equivalent metadata retained or omitted. It also describes
functional equivalence: complete character inventory, shaping behavior,
readability and author/license metadata. Conversion-tool success or a few equal
screenshots alone is insufficient. This audit and prior full cmap/table/glyph
checks support that assessment; they do not grant RFN clearance. The candidate
recipe and naming decision still need a recorded review before replacement.
See [OFL FAQ 2.2–2.8](https://openfontlicense.org/ofl-faq/).

WOFF2's standard packaging/reconstruction rules explain why head flags and
checksums, DSIG and transformed outline representation can differ. Those are
technical format facts, not an extra copyright permission. See the
[W3C WOFF2 specification](https://www.w3.org/TR/WOFF2/).

The full TTF route has the strongest byte-identity provenance but a much larger
payload. Standard WOFF2 is the smaller full-source candidate with the measured
parse tradeoff above. Both still need the adoption decision, updated provenance
inventory, actual candidate-document/native comparison as appropriate, and a
verified final package/download before publication. The current font bytes,
RFN/source hold, Noto metadata/.notdef review and beta release hold remain.

## Reproduction, failures and scope retained

Use the existing production builder/packager/signer and a fresh owned app;
the package proof records exact inputs. The builder's output includes loose
engine files, so packaging uses a fresh staging view excluding those four files
and its fonts link; the packager receives engine/fonts separately. The initial
duplicate-entry rejection occurred before an app was created and is retained.

```sh
node scripts/check-electron-font-runtime.mjs \
  --output-root /path/to/new/run --app /path/to/QA/GeulgyeolBeta3.app \
  --inputs /path/to/prepared/inputs.json
python scripts/audit-nanum-distribution.py \
  --inputs /path/to/prepared/inputs.json --output-root /path/to/new/audit
```

Run Electron with normal local-app permission and the existing fontTools/Brotli
Python environment. No security-disabling launch flags are used. Every run has
its own profile/files. The completed run exits 0 normally without termination.
Earlier harness failures (SDK method name, overstrict FontFace expectation,
Inspector expression syntax and disconnect ordering) are retained with source
snapshots. The unconfirmed exit receipt stays unconfirmed; a later read-only
check found no owned app process, and the corrected run has its own confirmed
normal exit. The OFL whitespace-layout audit failure is also retained.

Typecheck, Node syntax, Python AST and whitespace checks pass. Five controlled
wrong-hash/existing-output/optimized-Python guards reject before app launch or
output replacement. A sixth controlled startup test confirms the launcher
reports the owned child immediately and rejects a child exiting with code17
before Inspector readiness; it is not an actual Electron failure claim. The
caller can therefore clean up its child even if startup rejects before returning.
That QA-only launch callback is optional for existing callers. Product source
is unchanged, so the old desktop/Rust suite
was not repeated as a substitute for this runtime coverage. The prior missing
Rust samples remain a separate full-suite limitation; CI absence is not success.

The dirty original tree and earlier evidence are preserved. No user document,
window, font installation, credential or security setting changed. Actual
Hancom editing/reference layout, manual OS dialogs, physical IME/printers, GPU,
long sessions, Developer ID/notarization and final distribution remain open.
The prior 57,066,368-byte diagnostic is an accumulated unfreed-buffer sum, not
final RSS. No new memory reliability conclusion is drawn from this short run.

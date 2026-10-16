# Full-source Nanum alternatives: size and renderer comparison

Base main: `a36d0c9903e648303d0cdd3f1c7a5261dc1728e8` (PR #62 merged).
These are the original comparison records. Subsequent product-loader and surface
cleanup measurements are in [CanvasKit font-loader QA](canvaskit-font-loader.md).
QA root: `/Users/sw107/Documents/Codex/2026-10-14/task/nanum-font-alternatives/qa`.
Product font bytes are unchanged. The alternatives below exist only in QA.
This comparison does not approve beta publication or close the current subset
RFN review item.

## Size and source

Eight full static TTFs come from the already pinned Google Fonts references
in [the source inventory](../desktop/web/licenses/FONT_SOURCE_PROVENANCE.json).
The preparer checks each reference SHA-256 and current product hash before
writing. Both WOFF2 options retain the full source character inventory, names,
metrics, hinting and layout; no character subsetting or name edit is applied.

| Eight-file profile | Bytes | Increase over current WOFF2 |
| --- | ---: | ---: |
| Current product subsets, WOFF2 | 3,962,468 | — |
| Current subsets decoded to SFNT, format control | 18,623,024 | 369.99% |
| Official full TTF | 20,117,512 | 407.70% |
| Official full WOFF2, no preprocessing transforms | 5,160,152 | 30.23% |
| Official full WOFF2, standard glyf/loca transforms | 4,448,192 | 12.26% |

The standard WOFF2 profile adds 485,724 bytes; the null-transform profile adds
1,197,684. The decoded current SFNT is a format control, not a solution to the
current subset's source/RFN conditions. These are unarchived payload sizes,
not measured download, process-memory or startup-time changes.

The full-source profiles have 96,080 Unicode mapping entries versus 91,696
across the eight current files: 4,384 additional per-file mappings covering
970 distinct added codepoints. The 16 sampled added codepoints per file return
missing glyph IDs in both current controls and nonzero IDs in all full profiles.
That is a measured coverage difference, not validation of every new script.

The null-transform profile preserves every decoded table byte except WOFF2
head checksum/flag changes and DSIG removal. Standard transforms additionally
reconstruct glyf/loca, while all other table bytes, cmap, metrics, names and
layout remain identical to the source. These are the normal format operations
described in [WOFF2](https://www.w3.org/TR/WOFF2/). Full references and lossless
compression provide a technical alternative to undocumented subsetting;
they do not infer a permission for the currently bundled modified subsets.

## Actual CanvasKit component measurements

The Node harness uses the product's CanvasKit module and WASM, without a Mac
window or browser. WASM SHA-256 is
`25ebed8e60158c5854f8dc807b936daca21354f8bfb6a2231266b0a93812f301`.
The measured value in the proof is authoritative; compare it to the pinned
production `canvaskit-SCAxUyCS.wasm` before treating a rerun as the same build.

Five profiles per file make 40 typeface/FontMgr load cases; all load successfully.
The final comparison records:

- 32 current-codepoint glyph grid pairs, zero changed RGBA pixels.
- 16 full-source grid pairs comparing both WOFF2 outputs to the full TTF,
  zero changed pixels across the complete full-source mapping sets.
- 128 vector comparisons at sizes 9/16/28/48, zero differences in glyph widths,
  glyph bounds or global font metrics. This covers 1,467,136 per-glyph vector
  comparisons summed over profiles and sizes.
- 1,152 ordinary paragraph comparisons at sizes 12/18/32 and widths 180/320/520,
  zero differences in line metrics, wrapping, height or RGBA pixels. Four
  shared Hangul/Latin/mixed/punctuation strings run for each font. The conjoining
  Jamo corpus is absent from the current cmap and is explicitly skipped for
  all eight fonts; it is not counted as passing coverage.

Glyph grids use explicit positions; paragraphs use each profile's own internal
family name. Neither test alone establishes compatibility with existing family
requests. That difference is checked separately below.

## ExtraBold family lookup is a concrete adoption gate

| File | Current internal family | Full-source internal family |
| --- | --- | --- |
| NanumGothic-ExtraBold | NanumGothicExtraBold | NanumGothic |
| NanumMyeongjo-ExtraBold | NanumMyeongjoExtraBold | NanumMyeongjo |

For these two files, each full TTF/null-WOFF2/standard-WOFF2 FontMgr fails a bare
request for the old family: six measured lookup differences. Loading and
rendering with the new family still works. This is an API compatibility
difference, not a reproduced failure of the application's current font rules.

Registering the unchanged full-source bytes with `TypefaceFontProvider` under
the old family restores all six lookups. The external-alias route adds 216
paragraph comparisons with zero layout/pixel differences against the current
fonts. This demonstrates a possible integration technique without editing
font name tables; it is not applied to the product renderer here.

The strict comparison deliberately exits **1** for the six bare lookup changes.
It must not be reported as a fully passing replacement gate. The standard
WOFF2 profile is the smaller promising candidate, but adoption needs an explicit
family-resolution decision in the actual application, followed by its own
document/layout and native validation. Product fonts are therefore retained.

## Reproduction and retained failures

Use a task-local Python environment with fontTools 4.61.1 and Brotli 1.2.0, the
existing pinned reference directory, and the project's locked CanvasKit 0.42.0
dependency. No download or system font installation occurs in these commands:

```sh
python scripts/prepare-nanum-font-comparison.py \
  --reference-root /path/to/pinned/google-fonts \
  --output-root /path/to/new/prepared
node scripts/check-nanum-font-alternatives.mjs \
  --inputs /path/to/new/prepared/inputs.json \
  --output-root /path/to/new/rendered
```

Create the parent QA directory first; each output directory must be fresh. The preparer refuses Python optimization mode so
integrity assertions cannot be disabled. Five controlled negative checks cover
wrong reference/input hashes, optimized Python, and existing preparation/report
outputs; all fail safely without changing prior files. These are controlled
guard checks, not natural network or application failure tests. A repeat
preparation produces byte-identical payloads for all 40 profiles.

An early current-SFNT control reserialized cmap after inspecting it. The failed
table check and output are preserved; a fresh lazy WOFF2 decoder now keeps the
control tables intact. Early render invocations before preparation completed
produced no comparison proof. A plain paragraph-style object was also rejected
in a preflight; the final code uses the product's ParagraphStyle constructor.

In the first long-lived CanvasKit run, raster readback failed on the fifth font
after large all-glyph grids; no completed full-suite proof was produced. Its
PNGs/log remain. The final tool runs a fresh process per font and completes all
eight, checking worker exit status against its proof. This isolates retained
context state; it does not diagnose the earlier failure or establish long-session
native-app reliability. Both the failure and isolated results retain that scope.

Records: `prepared-delivery/inputs.json`, `comparison-summary.json`,
`renderer-family-final/proof.json`, per-font proof/PNG/log files, and
`guards-final/proof.json`. The final proof's script SHA and all input hashes
must match the source being assessed. Earlier pre-family-check runs had zero
render differences but did not test the legacy lookup requirement.

## Native and release limits

The supported tools still provide no Mac text-session screen/click/keyboard
control; the only screen-context tool is active-voice-only and was not invoked.
No installed app, user document, security setting, credential or font installation
was changed. This is offscreen CanvasKit component QA, not actual Mac document
open/edit/save/reopen, browser FontFace, application font-rule/glyph-replay
integration, Hancom, physical IME or printing verification.

No new app, ZIP, tag or public asset is produced by this comparison. Earlier QA
app copies remain preserved and are not final distribution candidates. The
current subset/RFN review, Noto metadata/.notdef issues, actual native workflow
and final public download/package verification remain open. Beta publication
stays held; CI absence and the earlier missing-sample Rust limitation remain
separate from these component measurements.

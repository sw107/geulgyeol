# CanvasKit font aliases and software surface cleanup

Base main: `e3e61b9bb5af62e451c98e2771b392a92d519b55` (PR #63 merged).
Evidence root: `/Users/sw107/Documents/Codex/2026-10-14/task/font-loader-alias-qa/qa`.
All synthetic documents and candidate fonts remain in QA. Product font bytes,
font rules, engine source and WASM are unchanged. Beta publication stays held.

## Product change

`CanvasKitLayerRenderer.renderPage` now calls `surface.dispose()` in its finally
block. The installed CanvasKit 0.42.0 `MakeSurface` allocates a separate pixel
buffer with `_malloc`; `MakeSWCanvasSurface` uses that surface. Its JS `dispose`
method frees the buffer and then deletes the native surface. Native `delete`
alone leaves that allocation behind. The SDK's Surface declaration documents
`dispose` as cleaning up extra memory, although it is deprecated in anticipation
of a future version where `delete` will be sufficient.

The comparison tool had the same mistake at both grid and paragraph cleanup
sites. Those use `dispose` too. Its new optional `--single-context` mode runs all
eight fonts with one CanvasKit instance; the default isolated-worker mode and
strict lookup-difference exit remain available.

## Measured surface lifetime

`scripts/check-canvaskit-font-loader.mjs` imports the actual product renderer,
font-rule planner and glyph replay cache by resolving TS aliases and stripping
types with Node 22.18.0. Real CanvasKit 0.42.0/WASM performs parsing and raster
operations. A minimal canvas/ImageData adapter copies actual software RGBA to
Node memory. It does not implement text measurement or font lookup. Browser
bootstrap, DOM FontFace registration and OS font detection are not exercised.

The diagnostic wraps CanvasKit's exported `_malloc`/`_free` around real software
surface creation and records only the width × height × 4 backing allocation.
The surface-creation wrapper forwards directly; graphics, font parsing and
lookup use the real APIs. A controlled adapter failure
at pixel transfer exercises the product finally path; it is not presented as a
natural rendering failure.

| Run | Product surface allocations | Observed frees | Outstanding bytes |
| --- | ---: | ---: | ---: |
| Original renderer, 8 normal + 8 controlled-error renders | 16 | 0 | 57,066,368 total |
| Fixed renderer, same cases | 16 | 16 | 0 |
| Fixed renderer, including 16 reopened-document renders | 32 | 32 | 0 |

The baseline diagnostic manually frees each *recorded* orphan after recording
the failure, keeping reproduction bounded. The proof reports those cleanup
bytes explicitly; they are not counted as product frees. Baseline exits 1;
both fixed runs exit 0. Normal-page and explicitly invoked product paragraph
shaping pixel hashes agree before and after the fix in all eight cases.

The original large-grid readback failure is preserved. After surface cleanup,
the full eight-font comparison completes in one CanvasKit instance: 40 loads,
32 current-grid pairs, 16 full-source-grid pairs, 128 metric vectors, 1,152
ordinary paragraphs and 216 externally aliased paragraphs. All measured pixels,
metrics and layouts agree. Six bare-family lookup differences remain, so the
strict command correctly exits **1**. This establishes a concrete leak and a
completed rerun of the formerly failing workload. It does not prove that every
possible cause of the old readback failure or long-session native reliability
has been resolved.

## Aliases in the actual product code

The six original misses are two ExtraBold legacy families multiplied by full
TTF, full null-transform WOFF2 and full transformed WOFF2. They remain misses in
`FontMgr.matchFamilyStyle(legacyName, ...)`. They are not six reproduced product
render failures.

Existing `prepareBundledFonts` maps all supplied aliases to one prepared face,
and stores the native family reported by that face's FontMgr. Product paragraph
shaping uses that native family, while glyph replay resolves verified blob
digest + face index without a family-name search. This already supports these
candidate name changes once the source and aliases have been supplied; no font
name-table rewrite or new product alias/provider code was needed.

The QA sends known local bytes through controlled `qa:` fetch URLs into the
unchanged loader, with both old English and Korean aliases. For each of the two
families it tests the current WOFF2 and three full-source alternatives:

- Eight engine-created documents request the old English family in all seven
  language slots. Exact source registration succeeds for each slot.
- Product `renderPage` produces nonblank pixels with no unexpected unsupported
  operations. Page pixels and explicitly invoked product paragraph-shaping
  pixels agree across current and candidate fonts for the common test string.
- Sixteen synthetic HWP/HWPX save/reopen operations preserve content, family,
  size and rendered page pixels. This is WASM serialization and offscreen
  product-renderer QA, not native file-dialog or editing-session QA.
- Eight controlled glyph-run resource fixtures replay through the actual cache,
  instantiate the exact verified face and draw with real CanvasKit. Eight
  corrupted-digest controls are rejected. The engine's test documents emitted
  **zero glyphRun ops**: this SDK/workload does not establish engine-emitted
  glyph-run end-to-end coverage. Fixture coverage is recorded separately.

The actual planner was also queried with external webfonts enabled and disabled:

| Request | External fonts disabled | External fonts enabled |
| --- | --- | --- |
| NanumGothicExtraBold / NanumMyeongjoExtraBold | unavailable | unavailable |
| 나눔고딕 ExtraBold / 나눔명조 ExtraBold | unavailable | existing Fontsource CDN WOFF source |

No network request to those CDN URLs was made. The controlled supply therefore
demonstrates existing loader capability, not a claim that the current offline
catalog supplies these faces or that a full-source font migration is complete.
Product catalog policy and 25 font binaries remain untouched.

## Reproduction and checks

With the previously prepared, hash-pinned font inputs and installed locked Node
dependencies, choose fresh output directories:

```sh
node scripts/check-canvaskit-font-loader.mjs \
  --inputs /path/to/prepared/inputs.json --output-root /path/to/new/loader
node scripts/check-nanum-font-alternatives.mjs \
  --inputs /path/to/prepared/inputs.json --output-root /path/to/new/comparison \
  --single-context
```

The loader proof pins every imported TS module, both WASMs, CanvasKit JS and all
tested input hashes. Baseline source snapshots and proofs remain in QA. The
single-context comparison proof reports process isolation as false and retains
all six measured lookup changes rather than suppressing them.

Type checking and a fresh Vite production build into QA pass. Desktop tests:
152 total, 151 pass, 0 fail, 1 pre-existing skip. The first sandboxed run had
149 pass / 2 localhost `listen EPERM` failures / 1 skip; the full run with local
port permission passes. No tests were excluded or altered for this result.
No full Rust library-suite success is claimed: the prior three missing sample
files still limit that suite. CI absence is not a passing status.

## Remaining limits

No text-session Mac screen/click/keyboard tool is available. Installed Hancom
metadata remains 12.30.0 (6544); activation and real editing capability are
unverified. No user document, open window, security setting or installed font
was changed. Hancom comparison, physical IME, native open/edit/save/reopen,
printing, GPU/browser bootstrap and long-session native behavior remain open.
The current subset RFN/source question, Noto metadata/.notdef review and final
distribution/download verification also remain held. This build produces no
new app bundle, release archive, tag or public asset.

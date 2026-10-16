# Nanum ExtraBold document family resolution

Base main: `c0c04d9ebc3ae6cec0918a21cc20c4646d829a2f` (PR #64 merged).
Evidence: `/Users/sw107/Documents/Codex/2026-10-14/task/nanum-family-resolution/qa`.
Product font bytes, generated upstream rules, engine source and WASM remain
unchanged. This change does not adopt the full-source candidates or approve
publication; the current RFN/source question and release gates remain open.

## Problem and change

An engine-created document requesting `NanumGothicExtraBold` or
`NanumMyeongjoExtraBold` reports that exact name in its CanvasKit document
preflight. Before this change, the product planner has no supply for those
English names. The Korean `나눔고딕 ExtraBold` / `나눔명조 ExtraBold` names use CDN
WOFF online and are unavailable offline, even though both corresponding WOFF2
files are already included by `scripts/build.sh`.

The Geulgyeol build now explicitly enables an app-owned two-file supply table.
Each file has its Korean and legacy English alias. The runtime uses this table
for both CanvasKit supply planning and Canvas2D webfont entries, so offline
documents can request either name without adding a network dependency. The
existing renderer binds aliases to the font's actual native family. No font
name-table rewrite or new TypefaceFontProvider is needed.

The build flag `__GEULGYEOL_BUNDLED_NANUM__` is enabled only in
`vite.geulgyeol-beta.config.mjs`. With it absent, the original catalog behavior
is retained. App rules have distinct `rule.geulgyeol-bundle.*` IDs and live
outside generated files. The upstream registry/generator named by the generated
headers is not included in this repository snapshot; generated files were not
hand-edited or presented as regenerated. This is a host-specific declaration
of files the host already includes, not a change to upstream rule authority.

Existing planner guards still apply: an explicitly missing local file is
unavailable, a configured font base URL is respected, aliases deduplicate by
URL, and normalized requests resolve without broadening unknown family names.

## Actual document and renderer component regression

The extended `scripts/check-canvaskit-font-loader.mjs` has two optional modes:
`--geulgyeol-font-plan` and `--geulgyeol-font-plan-korean`. These set the same
build flag before importing actual product TS modules, then use the real
WASM document preflight's `requiredFontFamilies` as planner input. The unchanged
product `prepareBundledFonts` consumes that returned plan. The prior diagnostic
mode that supplies explicit QA aliases is also retained.

Two ExtraBold faces × four profiles (current WOFF2, official full TTF, full
null-transform WOFF2, full transformed WOFF2) × two requested-name languages
give 16 synthetic documents and 32 HWP/HWPX save/reopen operations. Each mode
checks:

- The real document requests its saved name; the offline plan supplies exactly
  the matching local file with both aliases and no unavailable font.
- Product document-font status reports catalog web supply, with one matching
  webfont entry per name. This is catalog/status evidence, not browser loading.
- Exact source registration succeeds for all seven language slots. Real
  software `renderPage` is nonblank with no unexpected unsupported operation.
- Current and full-source profiles have equal page pixels and equal pixels
  from an explicit call to the product paragraph shaping method.
- Content, original requested name, size, offline plan and page pixels survive
  both format reopens. Names are not rewritten in the document.
- Per mode, eight exact-face glyph resource fixtures replay and eight corrupted
  digest controls are rejected. The engine documents emit zero glyphRun ops;
  these fixtures do not establish engine-emitted glyph-run end-to-end coverage.
- Per mode, 32 software surface allocations have 32 observed frees, including
  eight deliberate pixel-transport errors. No unreleased backing allocation is
  recorded. The error is an injected adapter control, not a natural app error.

Candidate bytes are injected at the **actual planned URLs** in the diagnostic;
only fetch responses in that Node process change. The product's 25 font files
are never overwritten. All candidates retain their original intrinsic family
names. The six bare legacy-name lookups still fail, but the supported product
alias route renders the candidates. Those six outcomes remain recorded rather
than renamed to bare lookup successes. The previous strict replacement
comparison remains exit 1 and was not reclassified as passing.

A third, unflagged eight-document / sixteen-reopen control passes with the old
explicit-QA supply mode. A catalog matrix uses the actual main-version runtime
from Git as a baseline: 158 requests × seven option sets. Unflagged web entries
and plans match the baseline for every request. Enabling the app table changes
only the four intended English/Korean names; all other requests stay identical.
The matrix source, baseline source hash and output records are retained in QA.

## Validation and reproduction

Use the already prepared, hash-pinned candidates and fresh output directories:

```sh
node scripts/check-canvaskit-font-loader.mjs \
  --inputs /path/to/prepared/inputs.json --output-root /path/to/new/english \
  --geulgyeol-font-plan
node scripts/check-canvaskit-font-loader.mjs \
  --inputs /path/to/prepared/inputs.json --output-root /path/to/new/korean \
  --geulgyeol-font-plan-korean
```

Type checking passes. A Vite build with the checked-in Geulgyeol config and
`--configLoader native` passes, and its output contains both app-owned rules.
The normal config loader first hit EPERM writing a temporary config under the
read-only original node_modules symlink; that failure is retained. Native
config loading avoids that write, without changing the config or dependencies.
A QA-only copy of all 25 existing font files retains every source hash. This
build output was not executed as a native app or packaged for distribution.

Desktop tests: 152 total, 151 pass, 0 fail, one existing skip, with local-port
permission for the existing server tests. New source syntax and whitespace
checks pass. Existing-output, wrong-inventory-hash and invalid-mode controls
reject safely. No full Rust library-suite success is claimed; the prior three
missing sample files still limit that suite. CI absence is not a pass.

## Limits retained

This is real product-module/CanvasKit/engine WASM component QA with Node canvas
and ImageData transport adapters. Browser FontFace, OS font detection, actual
Mac UI, Hancom editing, physical IME, printing, GPU, long native sessions and
final download/distribution remain unverified. The installed Hancom metadata
previously checked is 12.30.0 (6544); editing/activation is not inferred from it.
No user document, window, installed font, credential or security setting changed.

The prior surface metric of 57,066,368 bytes is the **accumulated** unfreed pixel
buffer sum across diagnostic cases, not final RSS. The old readback failure and
its scope remain preserved. Full-source font replacement, RFN/source closure,
Noto metadata/.notdef review and beta publication remain held. No new app,
release archive, tag or public release asset is produced.

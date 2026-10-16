# Full-source Nanum glyph and hinting preservation

Base main: `234d680dfc40966caa357b9570c5ff11a2390f9f` (PR #66 merged).
QA root: `/Users/sw107/Documents/Codex/2026-10-14/task/full-font-glyph-equivalence/qa`.
This phase addresses one technical RFN-evidence gap: glyphs outside the Unicode
cmap, their composite data and hint programs. It adds no product font replacement,
app behavior change, package, release asset or license approval.

## Why this scope

The installed Hancom metadata remains Hancom Office HWP 12.30.0 (6544). The
read-only bundle inspection found no `.sdef` dictionary, `NSAppleScriptEnabled`
or `OSAScriptingDefinition` declaration. This does not establish that every
possible vendor automation interface is absent. No text-session screen/click/
keyboard tool is available; active-voice-only capture was not used. Actual
Hancom open/edit/save/reopen cannot be established here, and no app launch or
editing/activation success is inferred from metadata.

Earlier raster comparisons covered Unicode-mapped characters. Full fonts also
contain unencoded glyphs used by composition/shaping, plus hint programs. The
new audit traverses every glyph ID in the full official source and both full
WOFF2 candidates, including `.notdef` and empty glyphs. It does not repeat the
app/FontFace/PDF workflows already preserved in previous phases.

## Inputs and method

Eight source TTFs are the pinned Google Fonts references in the existing source
inventory, commit `1d0e46c7933245c8180fe83e47917961c913bbdb`. The candidate bytes
are the existing full null-transform and standard-transform WOFF2 outputs.
`scripts/check-nanum-full-glyph-equivalence.py` reuses the reviewed Node input
contract: exact eight names × five ordered/unique profiles, current/reference
hash authority, weights, sizes and containers. Python rechecks the 24 full-font
payload hashes it actually consumes and parses those cached bytes, not later
path contents. Incomplete inputs cannot silently reduce the matrix.

FontTools 4.61.1 is required. The proof records its version, Python version,
glyf decoder source SHA and input/contract/audit SHAs. This is one pinned parser
and a data comparison, not independent native rendering of every glyph.

For every glyph ID, the canonical record covers:

- Glyph order/name and all decoded coordinates, contour ends and semantic point
  flags (on-curve, overlap and cubic).
- Bounding boxes, including zero-contour glyph bounds; absent empty bounds use
  the empty-glyph zero values.
- Composite glyph references/order, transforms, placement and semantic flags.
  Point-attachment indices are recorded directly, since the convenience
  component-transform API does not represent them. Unknown fields reject.
- Exact glyph instruction bytes and program presence, horizontal metrics and
  vertical metrics where present.

The pinned decoder removes coordinate-storage/repeat bits during decoding and
retains semantic flags; the comparison does not treat alternative coordinate
packing as an outline change. Every reference glyph gets an ID/name/digest
record, including its Unicode-mapped status and instruction byte count.

All table sets must match except mandatory DSIG removal. Every other table is
byte-identical, with only tightly checked head checksum/bit11 differences and,
for standard WOFF2, permitted glyf/loca encoding differences. Thus global hint
tables, layout tables, cmap, metrics and original name/license metadata cannot
be silently removed. Declared null/standard profiles must have the corresponding
actual transform flags; profile labels cannot merely be swapped.

## Results

| Full reference | Glyphs | Not directly Unicode-mapped |
| --- | ---: | ---: |
| NanumGothic Bold | 13,534 | 1,709 |
| NanumGothic ExtraBold | 13,671 | 1,845 |
| NanumGothic Regular | 13,297 | 1,470 |
| NanumGothicCoding Bold | 20,338 | 7,897 |
| NanumGothicCoding Regular | 20,024 | 7,583 |
| NanumMyeongjo Bold | 14,695 | 2,814 |
| NanumMyeongjo ExtraBold | 14,697 | 2,814 |
| NanumMyeongjo Regular | 14,695 | 2,814 |
| Total | 124,951 | 28,946 |

Both candidates match all source records: **249,902 glyph comparisons**, of
which **57,892** concern non-Unicode-mapped glyphs. All 16 comparisons include
glyph zero `.notdef`. Source totals include 70,587 composite and 9,259 empty
glyphs, and 37,079 glyphs with 6,449,591 instruction bytes. Metrics, contours,
component semantics, instruction bytes and remaining table data are preserved.
“Unmapped” here means absent from all Unicode cmap subtables; format14 variation
mapping is explicitly rejected rather than misclassified.

The initial canonicalizer omitted zero-contour bounding boxes. Its snapshot and
initial result remain; the final source records those bounds and reruns all
eight references/sixteen candidate comparisons. Only `all-glyphs-final/proof.json`
and its source SHA are used for the final claim.

Thirteen controlled synthetic tests cover both valid WOFF2 modes and detect
changes to unencoded outlines/hints/metrics, component metric flags, overlap,
global hinting, name metadata and extra head flags. They also cover zero-contour
bounds, point attachments, unknown component fields and swapped profile labels.
These generated test fonts are not claimed to be native rendering evidence.

Six CLI guards reject missing/duplicate input rows/profiles, wrong reference
hashes, Python optimization, existing output and swapped transform payloads.
The transform-payload swap passes the generic byte-input checks but fails the
actual transform check with no completed proof; its partial output is retained.
Existing sentinel content is unchanged. Python AST and whitespace checks pass.

## RFN implication and limits

The [OFL FAQ 2.2–2.8](https://openfontlicense.org/ofl-faq/) distinguishes a
compression-only webfont conversion from modification and describes functional
equivalence in terms of full inventory, shaping, readable output and original
metadata. This phase strengthens the complete glyph/hinting-data part of that
assessment, beyond a cmap or small rendered-text sample. It does not grant or
deny copyright permission; the published license remains the authority.

The [WOFF2 specification, section 5](https://www.w3.org/TR/WOFF2/) explains
reconstruction differences in outline encoding and loca offsets, mandatory
DSIG removal and head flag bit11. This audit confines its accepted byte
differences to those format operations while comparing decoded glyph content.
Format conformance alone is not an extra RFN permission.

No new all-glyph browser/native raster test, Hancom comparison or cross-platform
shaping test is claimed. The earlier Chromium/CanvasKit results retain their
own measured scope. A full-source adoption decision must record the chosen
recipe/naming rationale and retain notices/provenance; final candidate package
and download verification remain outstanding. The existing product subsets'
source/RFN question is separate from these full-source candidates. Font
replacement and beta publication remain held.

## Reproduction

Use the existing pinned Python environment and prepared inputs; outputs must
be fresh. No font file is rewritten or installed.

```sh
PYTHONDONTWRITEBYTECODE=1 /path/to/fonttools-4.61.1/python \
  scripts/check-nanum-full-glyph-equivalence.py \
  --inputs /path/to/prepared/inputs.json --output-root /path/to/new/all-glyphs
PYTHONDONTWRITEBYTECODE=1 /path/to/fonttools-4.61.1/python \
  scripts/tests/full-font-glyph-equivalence.test.py -v
```

Product source, 25 font hashes and 1,237 engine/build inputs are unchanged; the
original dirty checkout and earlier QA evidence remain preserved. No new app,
OS automation, security change, credential access or user-document operation
was performed. Physical IME/printers, GPU, long sessions, actual Hancom layout
and final distribution remain unverified. CI absence is not a passing status.

# Official font reference investigation

Application source at investigation start: main
`65b10bd8eddfc09246c4aac4c24e3d9d8d3e34bd`.
QA root: `/Users/sw107/Documents/Codex/2026-10-14/task/font-source-provenance/qa`.
The 25 product WOFF2 files remain byte-identical. This follow-up adds evidence
and copyright/source notices; it does not replace fonts or approve a release.

## Result and limits

The 16 previously unmatched files now have pinned official TTF references with
matching Unicode-mapped glyph data. Three Gowun files also match official
distributed WOFF2 bytes exactly. With the preceding nine Pretendard matches,
12 of the 25 bundled binaries have exact official-file matches; the remaining
13 have glyph-reference matches, not established original generation recipes.

| Current files | Official reference result | Outstanding issue |
| --- | --- | --- |
| Gowun Batang Regular/Bold, Gowun Dodum Regular (3) | Official Google Fonts Korean/Latin WOFF2 SHA-256 matches exactly; all mapped glyphs also match official TTFs | Native display/print remains unverified |
| Nanum Gothic (3), Gothic Coding (2), Myeongjo (3) | All mapped outlines, horizontal/vertical metrics and hint instructions match pinned official static TTFs | Subset codepoints and layout tables differ; original recipe/RFN authority for current assets is unestablished |
| Noto Sans KR Bold/Regular, Serif KR Bold/Regular (4) | All mapped glyph data matches official variable-font instances at 700/400 as named | Internal names retain Thin/ExtraLight; original name/subset recipe and full layout equivalence remain unestablished |
| Noto Sans KR ExtraLight (1) | All 12,208 mapped glyphs match the official 200 instance | OS/2 weight is 400; original recipe and full layout equivalence remain unestablished |

The per-file inventory is
[`FONT_SOURCE_PROVENANCE.json`](../desktop/web/licenses/FONT_SOURCE_PROVENANCE.json).
It distinguishes exact binary matches from glyph references and records every
input/output hash, reference weight, codepoint count, metadata warning and
evidence limit. Supplemental copyright notices from the actual bundled font
metadata are in [`FONT_SOURCE_NOTICE.md`](../desktop/web/licenses/FONT_SOURCE_NOTICE.md).
Existing OFL notices are unchanged. In particular, the Noto Serif supplement
preserves its Adobe font-metadata copyright alongside the existing Google OFL
notice; the Pretendard supplement also retains both metadata copyright strings.
These notices grant no additional permission or RFN waiver.

## Official retrieval and comparison

The Google Fonts reference snapshot is
[`1d0e46c7933245c8180fe83e47917961c913bbdb`](https://github.com/google/fonts/tree/1d0e46c7933245c8180fe83e47917961c913bbdb).
The contents API supplied the actual download URLs. All 34 downloaded files
(13 TTFs, seven OFL files, seven METADATA.pb files and seven descriptions;
78,209,519 bytes) pass Git blob SHA-1 and recorded SHA-256 checks. The seven
OFL files match the existing notices exactly. METADATA.pb records author
repositories/commits for Gowun, Nanum and Noto; those declarations are retained
as declarations, without claiming to have rebuilt the author repositories.

The official CSS API was queried using public format negotiation and its
[documented subset parameter](https://developers.google.com/fonts/docs/getting_started#specifying_script_subsets).
The first Latin-only request did not match the local files and is retained.
The Korean/Latin request with a Firefox 40 compatibility user-agent returns
three Gowun files identical to the bundled bytes. The returned CSS, exact URL,
user-agent and font files are saved; there was no guessed historical URL,
authentication or TLS bypass. Current Nanum/Noto service files do not have
the local hashes, so no exact official binary match is asserted for them.

Using fontTools 4.61.1 and Brotli 1.2.0 from the preceding task-only environment,
the Noto variable TTFs were instantiated at the tested weights without updating
font names automatically. Those instances are QA references, not product files.
For all 16 assets, the comparator checks each local Unicode mapping against its
reference using decomposed recording-pen outlines, integer-normalized numeric
encoding, hmtx/vmtx values and glyph instruction bytes. Across 184,891 mappings,
all three mismatch counts are zero. This is a data comparison, not visual,
kerning, shaping, native CanvasKit or printing validation.

Unencoded outline multisets are also checked. ExtraLight has one additional
empty outline in that multiset. A separate .notdef comparison identifies that
both Sans ExtraLight and Regular have an empty .notdef outline where the
reference has five contours; their .notdef advance/bearing values still match.
This missing-glyph behavior difference is retained as an open issue. No claim
of whole-font equivalence follows from the mapped glyph matches.

Default-subset reconstructions for the 11 static fonts and all-feature probes
for three Nanum regular files were also attempted using the target's Unicode
set. Their decoded table comparisons do not reproduce the complete current
assets. Those target-derived probes are recorded as unsuccessful recipe probes,
not confirmation of how the original files were generated. Their layouts are
not silently substituted into the application.

## Noto weight and name diagnosis

For each of the five Noto files, sentinel glyphs were checked against alternate
weights as a negative control. Each intended reference weight has zero sentinel
outline differences. Each wrong weight changes seven of the seven/eight
available sentinel outlines; the square is weight-invariant in the eight-glyph
sets. ExtraLight's complete mapped set matches 200, while its 400/700 controls
differ. Bold matches 700 and Regular matches 400, despite the internal labels.

The official variable source names themselves contain Thin (Sans default 100)
or ExtraLight (Serif default 200). This makes inherited base names a possible
explanation for the labels, not a proven history of the bundled generation
process. Metadata weight/name edits can affect font selection; they are not
applied here without their own product validation and review.

## Distribution conditions and QA alternatives

The current Nanum assets omit codepoints from their full reference fonts while
retaining Nanum names. The actual OFL files declare Nanum RFNs. No permission
for these particular modified assets, or evidence establishing full functional
equivalence, was obtained. Official-source lineage alone does not close this
review item. The [OFL FAQ, section 2](https://openfontlicense.org/ofl-faq/),
distinguishes compression from subsetting and describes name conditions; no
legal release conclusion or inferred author permission is claimed here.

Eight alternatives were prepared only in QA from the full pinned Nanum TTFs,
using WOFF2 with preprocessing transforms disabled. Every name, cmap, glyph,
metric and layout table is byte-identical after decoding. Differences are
limited to the head checksum/WOFF2 flag and removal of the original eight-byte
DSIG tables where present, as required by the
[WOFF2 format](https://www.w3.org/TR/WOFF2/).
All source characters are retained. These 5,160,152 bytes of alternatives show
a reproducible technical path for review; they are not installed, selected,
packaged or native-app validated. Replacing current assets remains separate
work because their coverage/layout tables differ from the current subsets.

Two early comparison-harness attempts failed on mapping iteration and missing
DSIG lookup. Their scripts/logs and generated first-file copies are preserved.
The final verifier explicitly checks the format-required differences instead
of skipping unexpected rendering-table differences.

## Access and retained release gates

The tool catalog still provides shell execution but no Mac text-session screen
reader/click/keyboard tool. The screen-context tool remains active-voice-only
and was not invoked. No user document, installed app, security setting,
credential or original font was modified. Installed Hancom metadata remains
12.30.0 (6544); editing capability and document UI comparison are unverified.

The earlier QA application/archive remains based on PR #60 source, predating
these notices and the PR #61 documentation. It is not a final distribution
candidate. Actual app open/edit/save/reopen, Hancom comparison, physical IME,
printing, ordinary downloaded launch and final public-file/archive verification
remain required. Beta publication is held; nothing is uploaded or released.
Prior evidence and original user files are preserved. CI absence and the prior
three-missing-sample Rust test limitation are not reported as passing tests.

# Note JSON and HWPX control-character preservation

On main `630525b550e20b397d3002a3a7c4399e3b161e0a`, inserting TAB, LF,
or CR through the note editing API exposed two independent product defects:

- `getFootnoteInfo` escaped quotes and backslashes but left C0 characters raw.
  Its output failed strict JSON parsing for both footnotes and endnotes. The
  document model still contained the inserted characters. Studio parses this
  response directly in `wasm-bridge.ts`.
- HWPX serialization preserved TAB and LF using inline elements, but silently
  discarded CR. CRLF consequently reopened as LF. The existing HWPX parser
  already preserved an XML numeric CR reference, so no parser change is needed.

The getter now uses the existing `json_escape` helper. Its field names, ordering,
numbering, paragraph array, Unicode scalar counts, and error behavior are unchanged.
The shared `hp:t` serializer emits CR as `&#13;`, preserving its code point through
XML line-ending normalization. TAB and LF retain their existing representations.
Other XML-ineligible C0 characters retain the previous export policy; testing them
as JSON input does not claim HWPX support for those characters.

## Repeat the focused checks

```sh
cargo run --offline --locked --manifest-path engine/Cargo.toml --example note_control_text_check
node scripts/build-wasm-release.mjs /absolute/fresh-sdk/pkg
node scripts/check-note-control-text.mjs fixed /absolute/fresh-sdk/pkg engine/examples/fixtures/endnote-unequal-two.hwpx /absolute/fresh-observations
```

The Native example checks both note kinds, every C0 character in the getter,
quotes, backslashes, literal escape sequences, non-BMP scalar lengths, empty and
multiple paragraphs, read-only queries, invalid indices, history snapshots,
deletion offsets, and repeated HWPX cold loads. It also exercises body, table-cell,
and text-box serialization with CR and LF in separate character-style runs.

The WASM checker uses unmodified `JSON.parse`, compares exact text and metadata,
checks that queries do not change exported bytes, and tests live, cold, and second
save states across before/edit/undo/redo snapshots. Blank-note automatic-number
placeholder spaces are retained. Its `observe` mode records baseline failures and
returns successfully even when defects are observed; it is not an acceptance pass.
Use `fixed` for the acceptance gate.

## Recorded validation scope

The corrected baseline checker recorded 42 strict JSON failures and 8 CR text
mismatches. The candidate passed 14 input cases, 56 history stages, and two
getter-only all-C0 cases. An independent XML parser checked all 56 saved archives
and their exact first-note-paragraph text, CR references, and TAB/LF elements.

The existing 35-document matrix matched current main exactly across 140 stages:
280 WASM views, 420 Native views, and all ZIP entry contents in 140 HWPX exports.
Rows were matched by unique document/stage keys because the pinned Native merge
oracle stores three focused cases at the end of its array. Existing note-format
checks passed 28 cases, 600 rejected inputs, 56 reopens, and 168 restores; note-cache
checks passed nine cases and 67 comparisons in each runtime. Studio and public SDK
type checks passed, along with 20 desktop host and 90 Studio unit tests.

The Native checks passed 10 getter cases, 10 round-trip cases with 30 history
stages, and three shared-serializer contexts. These are engine checks with SDK
snapshots, not actual application CommandHistory, keyboard, or IME tests. They do
not establish HWP5 CR round-trip support or genuine Hancom interoperability.
The current execution environment has shell access but no general screen-control
tool; no new application session was used for these checks.

Existing Rust unit compilation requires four absent repository inputs:
`engine/mydocs/tech/agent_runtime/version_policy.md`,
`engine/samples/3-09월_교육_통합_2022.hwp`,
`engine/samples/hwp3-sample16-hwp5.hwp`, and
`engine/samples/hwpx/aift.hwpx`. Focused examples compile independently.

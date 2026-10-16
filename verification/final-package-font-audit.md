# Reviewed-source Mac package and font audit

Reviewed application source: `d53f9555d7f938716832e2c6b203159770481316` (PR #60).
QA root: `/Users/sw107/Documents/Codex/2026-10-14/task/final-package-font-audit/qa`.
This audit does not authorize beta publication. The package below predates the
documentation corrections in this follow-up; it is a preserved QA candidate,
not an uploaded release or the final candidate for the next source commit.

## Execution access and outstanding native checks

Shell execution works. The available tool catalog has no text-session Mac
screen reader, click or keyboard control. Its screen-context tool is restricted
to active voice calls and was not used. No user document or application window
was opened, closed or modified, and no OS automation was substituted.

The installed `/Applications/Hancom Office HWP.app` reports product
`Hancom Office HWP`, version `12.30.0`, build `6544`, identifier
`com.hancom.office.hwp12.mac.general` in Info.plist. This verifies installed
metadata only. Activation, editing capability, real app comparisons, physical
IME, paste, print preview and printing remain unverified.

The attempted PR #60 ready/ordinary-merge command was rejected before execution
by automatic approval review, citing the earlier parent-only merge instruction.
No alternate merge method was attempted. A read of the source thread returned
no turns, so it supplied no additional approval evidence. At the pre-merge
check, PR #60 was draft/open, head matched the reviewed SHA, mergeable/CLEAN,
with no reported CI checks. No merge SHA is claimed by this audit.

## Isolated package and signature

The existing packaging script consumed the authenticated official Electron
44.3.0 runtime, the pinned production Studio build and SDK from the preceding
cold-cache verification, and current tracked assets. It copied the runtime into
a new task-owned `GeulgyeolBeta3.app`; the installed runtime was not resigned.
An initial duplicate SDK input was rejected before a bundle was copied. Its
empty proof and error log were retained; staging the 16 non-SDK production
Studio files separately allowed the packaging script to complete.

- Product/version: `GeulgyeolBeta3` / `0.4.4-beta.3`, arm64.
- Bundle ID: `org.geulgyeol.beta.0443`.
- All 81 ASAR entries and block hashes validate. The 80 declared inputs match
  their exact Git objects or pinned generated inputs; the additional entry is
  build-info.json. Both embedded/loose WASM copies have SHA-256
  `d27a745d2048b1029df9f251482340be5022755639cc780c7fcaea9c4fe913c1`.
- The production debugging globals checked by the verifier are absent.
- ASAR SHA-256: `d11138a16f08a7d63909964633e802cb1bf7d025ef4b0507bb50d8827458d0c6`.
- The fresh, initially unsealed copy fails strict signature verification (exit
  1). Applying the repository's normal ad-hoc signing script to this copy seals
  its resources; `codesign --verify --deep --strict --verbose=2` exits 0.
  CDHash: `58db6f4b9fa68db12d23cff73c24fa0ff2e75112`.
- The signed bundle contains 279 file/link entries, 351,086,783 ordinary file
  bytes. The manifest pins files, executable modes and internal symlinks.
- It is ad-hoc signed, without Developer ID or notarization. Read-only `spctl`
  assessment exits 1 with `internal error in Code Signing subsystem`; it does
  not establish successful Gatekeeper assessment or ordinary downloaded launch.
- A separate comparison confirms all 256 ordinary files and 14 symlinks in the
  original installed runtime (270 entries) still match the authenticated cached
  official archive, with no extras.

No security settings, credentials, quarantine attributes or original runtime
signatures were changed. Successful ad-hoc integrity checks are not native
application execution or distribution trust verification.

## QA-only archive and content review

An internal ZIP was created, without upload, tag or release:
`Geulgyeol-d53f955-QA-only-mac-arm64.zip`, 154,699,299 bytes,
SHA-256 `f4b4e798c09653ab4e2c81d31ff72cd3448332db9237140f78c76ea291e7ce01`.

All 279 ordinary file/link entries, bytes, modes and targets agree with the
signed bundle. The first exact-entry-set audit also found 597 AppleDouble
metadata entries and deliberately failed rather than ignoring them. A separate
parser validated every extra entry's structure, empty resource fork, target
and single 11-byte `com.apple.provenance` attribute against the actual candidate
xattr. Those records were preserved, not stripped. The archive was read and
CRC-checked without extracting another application copy. Extracted-app launch,
download/quarantine behavior and post-download signature validation remain open.

All 81 ASAR files pass the recorded personal host-path, GitHub-token,
AWS-access-key and private-key-header patterns. The documented static Emscripten
`/home/web_user` value remains. This is a bounded content check, not an exhaustive
secret audit or a successful public download test.

## Fonts and licenses

All 25 WOFF2 files (15,932,260 bytes, eight families) were parsed with fontTools
and Brotli in a task-only virtual environment. Original font bytes are
unchanged; all WOFF2 tables, names, weights, glyph counts and cmap coverage are
recorded in `font-metadata.json`. No system package was installed. An initial
Python HTTPS request failed local certificate verification; its log is kept.
The successful downloads used system curl with TLS verification enabled, with
no certificate-store or verification-policy change.

- All nine Pretendard binaries match the official v1.3.9 files byte for byte at
  [commit 5c41199](https://github.com/orioncactus/pretendard/tree/5c41199ea0024a9e0b2cb31735265056e5472d76/packages/pretendard/dist/web/static/woff2).
- The seven Google Fonts family OFL files match the bundled notices byte for
  byte at [commit 1d0e46c](https://github.com/google/fonts/tree/1d0e46c7933245c8180fe83e47917961c913bbdb/ofl).
- The v1.3.9 Pretendard license differs from the current bundled notice. The
  bundled file retains additional copyright/reserved-name notices and matches
  the [current official license at commit 7aeb069](https://github.com/orioncactus/pretendard/blob/7aeb0698819be2b4097dae8ec8fe6a795e5cf3ae/LICENSE)
  exactly. Both versions and the diff were preserved; no notice was removed.
- Original binary provenance for the other 16 fonts remains unestablished.
  Parsing metadata and matching license texts do not establish that provenance
  or a complete legal release conclusion.
- `NotoSansKR-ExtraLight.woff2` has OS/2 weight 400; Bold's internal family
  contains `Thin`, and Regular's unique ID also contains `Thin`. These are
  discrepancies, not evidence that the glyph outlines or rendering are correct.
- The Regular cmap maps `■`, `▪`, `□`, `○`, `─` to real glyphs. The prior
  documented source TTF and regeneration script are absent from this Git tree.
  No recreation, visual font comparison or runtime font substitution is claimed.

The follow-up changes only this record and `assets/fonts/FONTS.md`: correct the
stale 36-file/22,651,296-byte count, distinguish absent optional fonts, and remove
the unsupported committed-TTF/regeneration assertion. No font binary or product
behavior was changed. A future candidate must include the reviewed corrections.

## Public release state and retained gates

The current release API lists public `v0.4.4-beta.2`; its small SHA256SUMS file
was downloaded and matches the API's own file digest. Its ZIP hash text agrees
with the ZIP asset's API digest. The ZIP itself was not downloaded or revalidated
here. No public beta.3 asset exists in the retrieved release list; README and
the quick-start still describe beta.1. No public artifact or guide was changed.

Beta publication remains held for the actual final reviewed-source package,
ordinary downloaded launch, open/edit/save/reopen/print, genuine Hancom and IME,
remaining font source/transform review, updated public guides, and final public
archive/checksum/download checks. The preceding three-missing-sample Rust suite
limitation and lack of reported CI remain; neither is called a pass. Prior
source/evidence hashes and the original dirty user tree are preserved.

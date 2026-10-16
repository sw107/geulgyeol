# Reproducible release SDK path normalization

Base main: `af9911c86cddec8e58e2af0787f7ec23b34d6f49`, the normal merge of
independently reviewed PR #59 head `61dff7974b9eea99eadf3b99c35a816e2759d4b1`.
The merged PR and remote main were read back; no CI pass is inferred from
absent checks. This separate worktree uses `dev/reproducible-wasm-paths`.
Earlier source changes and copies survived an execution-server interruption;
the resumed shell confirmed their state before work continued.

## Build change and reproducibility

The previous private production bundle exposed absolute user paths in four
files: a hashed WASM asset, loose WASM, binding JavaScript and its declaration.
WASM carried compilation dependency paths. Bindings also copied a `/Users/...`
documentation example. The SDK scanner reproduced those findings before repair.

`scripts/build-wasm-release.mjs` builds offline/locked with Rust/cargo 1.93.1
and wasm-bindgen 0.2.127. It remaps source, Cargo, Rustup and target roots to
stable `/geulgyeol/` prefixes during compilation. Encoded Rust flags preserve
spaces and non-ASCII paths. Custom flags/wrappers reject instead of silently
altering the release recipe. The documentation example now uses a neutral
`/document-assets/` path. No WASM bytes are manually rewritten.

Generated SDKs are checked for POSIX/Windows user paths and the original build
prefixes before staged ordinary files are published. Output preflight rejects
symlinks, unrelated files and unexpected package metadata. Renames avoid editing
through existing hardlinks. `scripts/build.sh` uses this build helper.

Two independently located engine source trees with 1,237 matching pinned files
were built using the same pinned toolchain/cache. The second root contains
spaces and Korean characters. All four SDK files and `package.json` are byte
identical; both SDK audits are clean. This establishes reproducibility across
these two roots on this host, not across untested platforms/toolchains.

Final WASM SHA-256:
`d27a745d2048b1029df9f251482340be5022755639cc780c7fcaea9c4fe913c1`.
The older pre-normalization engine and all previous artifacts remain preserved.

## Verification

| Check | Result |
| --- | --- |
| Build/path safety tests | 17 pass: all SDK files, POSIX/Windows paths, unusual exact prefixes, encoded flags, relative cache paths, custom compiler overrides, linked/unrelated output preservation |
| SDK equality | Two source roots, identical hashes for four SDK files and module package metadata; zero SDK path findings |
| Replace All regression | 192 body/flat/nested/text-box cases, zero mismatches, 336 history restores, 768 disk reopens |
| Find/F3 cell regression | 1,242 steps, zero mismatches, 12 reopens |
| Caption-origin regression | 216 starts / 720 calls, zero errors or mismatches, eight reopens; caption text search support is not added |
| Single-Replace failure/history | 32 cases plus six fallback checks, 64 reopens; controlled failure coverage is not natural intermediate-failure verification |
| Search-span regression | 96 cases, 96 restores, 384 reopens; zero history SVG differences |
| Full desktop suite | 149 pass, zero fail, one pre-existing skip |
| Production build / type checks | Fresh production source bundle, TypeScript, shell syntax and git diff checks pass |
| Production file audit | 53 ordinary files, no defined high-confidence credential or personal-path findings; both bundled engine copies match the final WASM |
| Authenticated Electron Node mode | Electron 44.3.0, six engine cases, 12 snapshot restores, 12 disk reopens; no native app window or signed candidate used |

The production audit initially flagged CanvasKit's static Emscripten virtual
HOME `/home/web_user`. Its code context identifies a virtual filesystem value;
that single value is recorded separately and retained unchanged. This is not
a host user's directory. Linked fonts are audited separately. Pattern scans
are limited checks, not a guarantee that every possible secret is absent or
that a final distributable is ready.

The Electron Node-mode process exited 0 and completed its engine checks, but
also emitted `task_name_for_pid: (os/kern) failure (5)` on stderr. The raw log
is preserved; no privilege/security change or retry bypass was attempted.
This run does not establish ordinary GUI launch, native dialogs or printing.

The actual build helper ran independently in both roots. The full standalone
packaging path's dependency-ownership checks and final app signing/QA were not
executed. Tests using cursor/DOM/repaint adapters remain source/engine checks.

## Read-only font and runtime provenance findings

All 25 WOFF2 files (15,932,260 bytes) match both the tracked canonical font
assets and the existing runtime copies. Their eight declared families map to
tracked SIL OFL 1.1 license texts; font and license bytes were compared with
the base Git commit. No unrecognized/proprietary filenames were observed.
Upstream download bytes and internal WOFF2 name/license metadata were not
independently verified: installed fontTools cannot decode WOFF2 because Brotli
is unavailable, and no packages were installed. `FONTS.md` still claims 36 files,
which disagrees with the actual inventory. The inventory/guide must be reconciled
before release; these records are not a legal opinion or release approval.

Cached `electron-v44.3.0-darwin-arm64.zip` SHA-256
`49b91ef265c603c8888500f807484b63816069c30f87ba2b403e7c87f0f45035`
matches both the installed package checksum and the official Electron GitHub
release asset digest. The 256 ordinary archive files and archive symlinks match
the installed runtime; no missing, changed or extra installed entries were found.
Neither the official archive nor the installed bundle has a root
`Contents/_CodeSignature/CodeResources` envelope. Read-only codesign inspection
reports linker-signed ad-hoc code, unbound Info.plist and no sealed resources.
Strict/deep verification exits 1 with the same resource-seal error. Thus the
observed seal absence is present in the authenticated raw runtime distribution;
it is not evidence that a final application has been signed or verified.
The original archive/runtime was not edited, resigned or stripped of attributes.
No credentials or security settings were accessed or changed.

## Evidence and remaining release gates

QA root: `/Users/sw107/Documents/Codex/2026-10-14/task/reproducible-wasm-paths/qa`.
Key files: `baseline-paths.json`, `final-a.log`, `final-b.log`,
`second-source-pins.json`, `reproducibility.json`, `paths-final-b.json`,
`production-public-audit.json`, `font-audit.json`, `runtime-archive-audit.json`,
`official-electron-release.json`, `runtime-signature-*.log`, `electron-node-proof.json`,
`desktop-final.log`, and `evidence/*-final/proof.json`.
Final source/evidence pins are frozen in `delivery-freeze.json`; original dirty
source and the preceding nine source / 309 evidence pins are rechecked.

```sh
# Configure verified tool/cache locations with CARGO_HOME, RUSTUP_HOME,
# CARGO_TARGET_DIR, CARGO, RUSTC and WASM_BINDGEN (or a verified PATH).
# The ordinary scripts/build.sh sources scripts/standalone-env.sh for this.
node scripts/build-wasm-release.mjs FRESH_SDK_OUTPUT
node scripts/check-release-paths.mjs FRESH_SDK_OUTPUT
node --test desktop/tests/release-paths.test.cjs
```

The full Rust library test compile again exits 101 because the same three
embedded samples are missing: `3-09월_교육_통합_2022.hwp`,
`hwp3-sample16-hwp5.hwp`, `hwpx/aift.hwpx`. They were not substituted/excluded.

Beta publication remains held. No final Mac candidate, ZIP, release asset or
tag was created. Fresh reviewed-source packaging and final strict signatures,
actual launch/open/edit/save/reopen/print, genuine Hancom and IME checks, current
installation/version/font guides, final archive inventory/secret review,
checksums and download verification remain pending. This change is a separate
draft PR; merge/publication awaits independent review and the required gates.

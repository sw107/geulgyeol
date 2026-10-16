# PR #60 follow-up: prepare the standalone dependency cache

Reviewed head: `ddfdaed74f4e27d2d50530e8587588fd3386081c`.
The review found that the release helper required an offline build while the
standalone installer populated tools but not the repository's crate cache.
This follow-up keeps the release build offline and completes online setup.
PR #60 remains draft pending another review; beta publication stays held.

## Reproduction and narrow fix

A newly created, initially empty `.geulgyeol-tools/cargo-home` in this worktree
reproduced the failure with the real release helper. Node exits 1 around cargo
exit 101: the pinned Git dependency cannot be checked out in offline mode.
No previous cache or SDK was removed or emptied.

Registry absence was also isolated after Git sources were available: the newly
created registry was temporarily renamed within this task's owned paths, the
real offline helper failed to find `argon2` in crates.io, and the registry was
restored in a `finally` block. All 182 existing crate archives were retained.

`setup-standalone.sh` now sources the same repository environment after the
toolchain installer and runs:

```sh
"$CARGO_HOME/bin/cargo" fetch --locked --manifest-path engine/Cargo.toml
```

Setup is already the online npm/tool installation phase. A failed fetch aborts
setup through its existing `set -e`; no unlocked update, global-cache fallback
or automatic network use was added to the release build. The full locked graph
is prepared: an intermediate wasm-target-only fetch downloaded 182 archives
but still left offline resolution unable to load `arrayref`. Its failed build
is preserved. The final unfiltered locked fetch prepares 363 archives and the
locked Git sources. Every archive hash matches Cargo.lock; the lock is unchanged.

## Verification

QA root: `/Users/sw107/Documents/Codex/2026-10-14/task/standalone-crate-cache/qa`.
An existing verified Rust 1.93.1 toolchain was reused to isolate dependency-cache
preparation. The real Cargo cache is the repository-owned path used by setup
and build. A complete real npm/rustup reinstall was not performed, preserving
the current dependencies and originals.

The document regressions below use the real WASM and source handlers under
Node with cursor/DOM adapters and synthetic document copies. They do not
establish native application, genuine Hancom or IME behavior.

| Check | Result |
| --- | --- |
| New setup wiring tests | Reviewed setup: 0 pass / 2 fail; fixed setup: 2 pass. Actual setup/environment scripts run in isolated fixtures; npm/tool installers are shims |
| Ordering and cache identity | Locked fetch occurs after tool installation, uses the repository's physical CARGO_HOME/RUSTUP_HOME/target, and prepares the complete graph |
| Fetch failure propagation | A controlled fetch exit 9 aborts setup, without a ready marker. This is not a natural interrupted-network test |
| Real empty-cache / empty-registry attempts | Both fail offline before dependency preparation; raw logs preserved |
| Real online preparation | `cargo fetch --locked` succeeds in the newly created private cache; 363 archive hashes and Git commits agree with the unchanged lock; no credentials file created |
| Real subsequent build | Offline/locked release build succeeds using that same prepared cache; all four SDK files pass the path audit |
| Reproducibility retained | Four SDK files and package.json are byte-identical to both earlier independently located source-root builds; all 1,237 earlier source/build-input pins remain unchanged |
| Replace All regression | 192 cases, zero mismatches, 336 history restores, 768 disk reopens |
| Cell / caption regressions | 1,242 cell search steps / 12 reopens; 216 caption starts / 720 calls / 8 reopens; zero errors or mismatches |
| Single-Replace and search-span | 32 cases plus 6 fallback checks / 64 reopens; 96 span cases / 96 restores / 384 reopens; zero history SVG differences |
| Full desktop suite | 151 pass, zero fail, one pre-existing skip |
| Production source build | Pass with the prepared-cache SDK; not native app launch or final package verification |

The engine remains byte-identical:
`d27a745d2048b1029df9f251482340be5022755639cc780c7fcaea9c4fe913c1`.
No Rust, release-helper, matching, serialization, API or dependency-version
change is part of this follow-up.

An early isolated fetch probe omitted an explicit compiler path and failed to
locate `rustc`; the verified tool path was supplied on the next attempt. An early
fixture assertion also used `/var` instead of setup's canonical `/private/var`
path; the test now compares physical roots. These attempts remain in separate
logs. Final baseline/fixed tests use the same final test source.

Records include `cold-before-fetch.log`, `registry-empty-proof.json`,
`registry-empty-build.log`, `fetch-all-locked.log`, `full-prepared-cache.json`,
`full-fetch-offline.log`, `sdk-comparison.json`, `sdk-paths-final.json`,
`setup-baseline-final.log`, `setup-fixed-final.log`, `desktop-final.log`, and
`evidence/*-final/proof.json`. Final source/evidence hashes are in
`delivery-freeze.json`; the earlier 11 source / 2,595 evidence pins are preserved.

Normal developer flow remains:

```sh
bash scripts/setup-standalone.sh  # online tool/dependency preparation
bash scripts/build.sh            # offline/locked engine build
```

Actual app launch/open/edit/save/reopen/print, genuine Hancom, IME, final signed
candidate/public-file/archive/checksum/download checks remain unverified and
beta publication remains held. The prior three-missing-sample Rust library
test limitation remains; no complete Rust suite pass is claimed or rerun for
this shell-only fix. Original dirty files, old caches and existing evidence
were preserved. No security setting or credential change was performed.

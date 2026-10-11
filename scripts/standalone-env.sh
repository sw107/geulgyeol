#!/usr/bin/env bash
# Source this file; settings apply only to the current build process.
GEULGYEOL_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
export CARGO_HOME="$GEULGYEOL_ROOT/.geulgyeol-tools/cargo-home"
export RUSTUP_HOME="$GEULGYEOL_ROOT/.geulgyeol-tools/rustup-home"
export CARGO_TARGET_DIR="$GEULGYEOL_ROOT/engine/target"
export RUSTUP_TOOLCHAIN=1.93.1
export RUSTUP_AUTO_INSTALL=0
export RUSTC="$CARGO_HOME/bin/rustc"
export RUSTDOC="$CARGO_HOME/bin/rustdoc"
unset RUSTC_WRAPPER RUSTC_WORKSPACE_WRAPPER
export RUSTUP_DIST_SERVER=https://static.rust-lang.org
export RUSTUP_UPDATE_ROOT=https://static.rust-lang.org/rustup
export PATH="$CARGO_HOME/bin:$GEULGYEOL_ROOT/.geulgyeol-tools/wasm-bindgen/bin:$PATH"
unset GEULGYEOL_DEV_ENGINE_DIR

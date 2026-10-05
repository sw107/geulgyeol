#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
command -v cargo >/dev/null
command -v wasm-bindgen >/dev/null
command -v node >/dev/null
cargo build --locked --release --target wasm32-unknown-unknown --lib --manifest-path engine/Cargo.toml
mkdir -p pkg
wasm-bindgen engine/target/wasm32-unknown-unknown/release/rhwp.wasm --target web --out-dir pkg
printf '{"type":"module"}\n' > pkg/package.json
(cd rhwp-studio && npx tsc && npx vite build --config vite.geulgyeol-beta.config.mjs)
cp pkg/rhwp.js pkg/rhwp_bg.wasm pkg/rhwp.d.ts desktop/web/studio/
mkdir -p desktop/web/studio/fonts
cp assets/fonts/* desktop/web/studio/fonts/

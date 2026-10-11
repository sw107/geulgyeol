#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/standalone-env.sh
node scripts/check-standalone-paths.mjs
cargo build --locked --release --target wasm32-unknown-unknown --lib --manifest-path engine/Cargo.toml
mkdir -p pkg
wasm-bindgen "$CARGO_TARGET_DIR/wasm32-unknown-unknown/release/rhwp.wasm" --target web --out-dir pkg
printf '{"type":"module"}\n' > pkg/package.json
(cd rhwp-studio && ./node_modules/.bin/tsc && ./node_modules/.bin/vite build --config vite.geulgyeol-beta.config.mjs)
cp pkg/rhwp.js pkg/rhwp_bg.wasm pkg/rhwp.d.ts desktop/web/studio/
mkdir -p desktop/web/studio/fonts
cp assets/fonts/* desktop/web/studio/fonts/

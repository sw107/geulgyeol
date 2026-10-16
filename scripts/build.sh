#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/standalone-env.sh
node scripts/check-standalone-paths.mjs
node scripts/build-wasm-release.mjs pkg
(cd rhwp-studio && ./node_modules/.bin/tsc && ./node_modules/.bin/vite build --config vite.geulgyeol-beta.config.mjs)
cp pkg/rhwp.js pkg/rhwp_bg.wasm pkg/rhwp.d.ts desktop/web/studio/
mkdir -p desktop/web/studio/fonts
cp assets/fonts/* desktop/web/studio/fonts/

#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ "$(uname -s)" != Darwin || "$(uname -m)" != arm64 ]]; then
 echo 'Mac ARM64 packaging requires a Mac ARM64 host.' >&2; exit 1
fi
node scripts/check-standalone-paths.mjs
candidate=dist/GeulgyeolIndependent-darwin-arm64/GeulgyeolIndependent.app
if [[ -e "$candidate" || -L "$candidate" ]]; then
 echo 'Refusing to overwrite an existing independent candidate.' >&2; exit 1
fi
bash scripts/build.sh
cmp pkg/rhwp_bg.wasm desktop/web/studio/rhwp_bg.wasm
(cd desktop && ./node_modules/.bin/electron-packager . GeulgyeolIndependent \
 --platform=darwin --arch=arm64 --electron-version=44.3.0 --out=../dist \
 --app-bundle-id=org.geulgyeol.independent --asar \
 '--ignore=^/(tests|node_modules)(/|$)' --prune=false)
bash scripts/sign-mac-bundle.sh "$candidate" org.geulgyeol.independent

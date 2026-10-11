#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ "$(uname -s)" != Darwin || "$(uname -m)" != arm64 ]]; then
  echo 'This installer currently supports macOS ARM64.' >&2; exit 1
fi
source scripts/standalone-env.sh
for directory in .geulgyeol-tools "$CARGO_HOME" "$RUSTUP_HOME" .geulgyeol-tools/downloads .geulgyeol-tools/wasm-bindgen; do
  if [[ -L "$directory" ]]; then echo "Refusing external tool symlink: $directory" >&2; exit 1; fi
done
node --input-type=module - <<'JS'
import fs from 'node:fs';
import path from 'node:path';
const root=fs.realpathSync('.');
function scan(dir){
 if(!fs.existsSync(dir))return;
 for(const e of fs.readdirSync(dir,{withFileTypes:true})){
  const p=path.join(dir,e.name);
  if(e.isSymbolicLink()){
   const resolved=fs.realpathSync(p);
   if(!resolved.startsWith(root+path.sep))throw Error('Refusing external tool link: '+path.relative(root,p));
  }else if(e.isDirectory())scan(p);
 }
}
scan('.geulgyeol-tools');
JS
mkdir -p .geulgyeol-tools/downloads
download(){ curl --fail --location --proto '=https' --tlsv1.2 --retry 2 --output "$2" "$1"; }
if [[ ! -x "$CARGO_HOME/bin/rustup" ]]; then
  download https://static.rust-lang.org/rustup/dist/aarch64-apple-darwin/rustup-init .geulgyeol-tools/downloads/rustup-init
  download https://static.rust-lang.org/rustup/dist/aarch64-apple-darwin/rustup-init.sha256 .geulgyeol-tools/downloads/rustup-init.sha256
  expected="$(awk '{print $1}' .geulgyeol-tools/downloads/rustup-init.sha256)"
  actual="$(shasum -a 256 .geulgyeol-tools/downloads/rustup-init | awk '{print $1}')"
  [[ "$expected" =~ ^[0-9a-f]{64}$ && "$actual" == "$expected" ]]
  chmod +x .geulgyeol-tools/downloads/rustup-init
  .geulgyeol-tools/downloads/rustup-init -y --no-modify-path --profile minimal --default-toolchain none
fi
"$CARGO_HOME/bin/rustup" toolchain install 1.93.1 --profile minimal --component clippy,rustfmt --target wasm32-unknown-unknown
archive=.geulgyeol-tools/downloads/wasm-bindgen-0.2.127-aarch64-apple-darwin.tar.gz
if [[ ! -f "$archive" ]]; then
  download https://github.com/wasm-bindgen/wasm-bindgen/releases/download/0.2.127/wasm-bindgen-0.2.127-aarch64-apple-darwin.tar.gz "$archive"
fi
actual="$(shasum -a 256 "$archive" | awk '{print $1}')"
[[ "$actual" == cd93e691eb5953ace5d8ffce52a20b024077a3dac3e2215b8224136b0efb7585 ]]
if [[ ! -e .geulgyeol-tools/wasm-bindgen/bin ]]; then
  mkdir -p .geulgyeol-tools/wasm-bindgen/bin
  tar -xzf "$archive" -C .geulgyeol-tools/wasm-bindgen/bin --strip-components=1
fi
node scripts/check-standalone-paths.mjs

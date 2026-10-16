#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# npm ci deletes existing node_modules; never run it through an external link.
node --input-type=module - <<'JS'
import fs from 'node:fs';
import path from 'node:path';
const root=fs.realpathSync('.');
for(const rel of ['desktop','rhwp-studio','desktop/node_modules','rhwp-studio/node_modules','.geulgyeol-tools']){
 const p=path.join(root,rel);
 if(fs.existsSync(p)||fs.lstatSync(path.dirname(p)).isSymbolicLink()){
  const resolved=fs.realpathSync(p);
  if(resolved!==p)throw Error('Refusing linked installation destination: '+rel);
 }else{
  try{if(fs.lstatSync(p).isSymbolicLink())throw Error('Refusing dangling symlink: '+rel);}
  catch(e){if(e.code!=='ENOENT')throw e;}
 }
}
JS
npm --prefix desktop ci --registry=https://registry.npmjs.org --ignore-scripts=false --no-audit --no-fund
node desktop/node_modules/electron/install.js
npm --prefix rhwp-studio ci --registry=https://registry.npmjs.org --ignore-scripts=false --no-audit --no-fund
bash scripts/install-standalone-rust.sh
# Prepare the full locked graph in the repository-owned offline-build cache;
# target-only fetch can omit packages needed during dependency resolution.
source scripts/standalone-env.sh
"$CARGO_HOME/bin/cargo" fetch --locked --manifest-path engine/Cargo.toml

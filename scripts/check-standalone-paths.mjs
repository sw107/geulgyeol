import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const root=fs.realpathSync(path.resolve(import.meta.dirname,'..'));
const inside=(p,base)=>p===base||p.startsWith(base+path.sep);
const checked=[];
function owned(rel){
 const p=path.join(root,rel),resolved=fs.realpathSync(p);
 assert(inside(resolved,root),`External dependency: ${rel}`);
 if(fs.statSync(p).isDirectory())assert.equal(resolved,p,`Linked dependency directory: ${rel}`);
 checked.push(rel);return p;
}
function links(dir){
 for(const e of fs.readdirSync(dir,{withFileTypes:true})){
  const p=path.join(dir,e.name);
  if(e.isSymbolicLink())assert(inside(fs.realpathSync(p),root),`External symlink: ${path.relative(root,p)}`);
  else if(e.isDirectory())links(p);
 }
}
for(const rel of ['desktop/node_modules','rhwp-studio/node_modules'])links(owned(rel));
for(const [rel,pkg] of [['desktop','electron'],['desktop','@electron/packager'],['rhwp-studio','typescript'],['rhwp-studio','vite']]){
 const lock=JSON.parse(fs.readFileSync(path.join(root,rel,'package-lock.json')));
 const installed=JSON.parse(fs.readFileSync(path.join(root,rel,'node_modules',pkg,'package.json')));
 assert.equal(installed.version,lock.packages['node_modules/'+pkg].version,`${pkg} lock version`);
}
const electron=owned('desktop/node_modules/electron/dist/'+(process.platform==='darwin'?'Electron.app/Contents/MacOS/Electron':'electron'));
const electronVersion=execFileSync(electron,['-p','process.versions.electron'],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},encoding:'utf8'}).trim();
assert.equal(electronVersion,'44.3.0');
const versions={node:process.version,electron:electronVersion};
if(!process.argv.includes('--node-only')){
 for(const rel of ['.geulgyeol-tools/cargo-home','.geulgyeol-tools/rustup-home','.geulgyeol-tools/wasm-bindgen'])links(owned(rel));
 const env={...process.env,CARGO_HOME:path.join(root,'.geulgyeol-tools/cargo-home'),RUSTUP_HOME:path.join(root,'.geulgyeol-tools/rustup-home'),RUSTUP_TOOLCHAIN:'1.93.1',RUSTUP_AUTO_INSTALL:'0'};
 for(const [name,rel,expected] of [['rustc','.geulgyeol-tools/cargo-home/bin/rustc','rustc 1.93.1'],['cargo','.geulgyeol-tools/cargo-home/bin/cargo','cargo 1.93.1'],['wasmBindgen','.geulgyeol-tools/wasm-bindgen/bin/wasm-bindgen','wasm-bindgen 0.2.127']]){
  const version=execFileSync(owned(rel),['--version'],{env,encoding:'utf8'}).trim();assert(version.startsWith(expected),`${name}: ${version}`);versions[name]=version;
 }
}
console.log(JSON.stringify({ownedPaths:checked,externalSymlinks:0,versions},null,2));

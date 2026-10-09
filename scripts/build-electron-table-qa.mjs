// Build a private Electron source-QA runtime without changing desktop/web assets.
// Usage: node scripts/build-electron-table-qa.mjs QA_ROOT FRESH_PHASE WASM_PKG [production]
// Set GEULGYEOL_QA_REUSE_UI to a prior QA runtime/web/studio to reuse identical assets.
// The QA bundle exposes existing handles only for selection/read assertions.
// Use the production mode for the ordinary product bundle without these handles.
import fs from 'node:fs';import path from 'node:path';import {execFileSync} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'..');
const {build}=await import(path.join(root,'rhwp-studio/node_modules/vite/dist/node/index.js'));
const q=path.resolve(process.argv[2]),phase=process.argv[3],engine=path.resolve(process.argv[4]),instrument=process.argv[5]!=='production';
process.env.GEULGYEOL_DEV_ENGINE_DIR=engine;
const {default:config}=await import(path.join(root,'rhwp-studio/vite.geulgyeol-beta.config.mjs'));
const out=path.join(q,phase,'runtime/web/studio'),old=process.env.GEULGYEOL_QA_REUSE_UI;
if(fs.existsSync(out))throw Error('Fresh output required');fs.mkdirSync(out,{recursive:true});
const plugins=instrument?[{name:'QA-read-only-exposures',enforce:'pre',transform(code,id){if(id===path.join(root,'rhwp-studio/src/main.ts')){for(const name of ['wasm','inputHandler']){const marker='(window as any).__'+name+' = '+name+';';if(!code.includes(marker))throw Error('Missing QA exposure '+name);const block='if (import.meta.env.DEV) {\n'+(name==='wasm'?'  ':'      ')+marker;code=code.replace(block,'(window as any).__'+name+' = '+name+';\n'+block);}return {code,map:null};}}}]:[];
const result=await build({...config,plugins,configFile:false,root:path.join(root,'rhwp-studio'),cacheDir:path.join(q,phase,'vite-cache'),build:{...config.build,outDir:out,write:false,copyPublicDir:false,emptyOutDir:false}});let reused=0,written=0;
function emit(name,bytes){const p=path.join(out,name),before=old?path.join(old,name):null;fs.mkdirSync(path.dirname(p),{recursive:true});if(before&&fs.existsSync(before)&&fs.readFileSync(before).equals(bytes)){fs.linkSync(before,p);reused++;}else{fs.writeFileSync(p,bytes);written++;}}
for(const bundle of (Array.isArray(result)?result:[result]))for(const item of bundle.output)emit(item.fileName,Buffer.from(item.type==='chunk'?item.code:item.source));
function publicFiles(dir,rel=''){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const n=path.join(rel,e.name),p=path.join(dir,e.name);if(e.isDirectory())publicFiles(p,n);else if(e.isFile())emit(n,fs.readFileSync(p));}}publicFiles(path.join(root,'rhwp-studio/public'));
fs.symlinkSync(path.join(root,'desktop/web/studio/fonts'),path.join(out,'fonts'));
for(const name of ['rhwp.js','rhwp.d.ts','rhwp_bg.wasm','rhwp_bg.wasm.d.ts'])fs.linkSync(path.join(engine,name),path.join(out,name));
const runtime=path.join(q,phase,'runtime');for(const rel of execFileSync('git',['ls-files','-z','desktop'],{cwd:root}).toString().split('\0').filter(Boolean)){const name=rel.slice('desktop/'.length);if(name.startsWith('tests/')||name.startsWith('web/studio/')||name==='package-lock.json')continue;const p=path.join(runtime,name);fs.mkdirSync(path.dirname(p),{recursive:true});fs.copyFileSync(path.join(root,rel),p);}
const bootstrap=fs.readFileSync(path.join(root,'scripts/electron-document-lifecycle-bootstrap.cjs'),'utf8').replace("app.on('browser-window-created', (_e,win)=>{","app.on('browser-window-created', (_e,win)=>{\n  win.webContents.setBackgroundThrottling(false);");fs.writeFileSync(path.join(q,phase,'bootstrap.cjs'),bootstrap);fs.mkdirSync(path.join(q,phase,'files'),{recursive:true});
fs.writeFileSync(path.join(q,phase,'build-proof.json'),JSON.stringify({instrumentedQAReadOnlyExposures:instrument,sourceProductUnmodifiedByInstrumentation:true,reused,written,engine,out},null,2));console.log(JSON.stringify({phase,reused,written,instrument}));

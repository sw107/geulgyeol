// Synthetic Enter/undo timings using generated WASM and the current typed UI command source.
import fs from 'node:fs';import path from 'node:path';import {pathToFileURL,fileURLToPath} from 'node:url';import {stripTypeScriptTypes} from 'node:module';import {performance} from 'node:perf_hooks';import assert from 'node:assert/strict';import crypto from 'node:crypto';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const [engineArg,fixturesArg,outArg]=process.argv.slice(2);
assert(engineArg && fixturesArg && outArg,'ENGINE_DIR FIXTURE_DIR OUTPUT_DIR [LABEL]');
const engine=path.resolve(engineArg),fixtures=path.resolve(fixturesArg),q=path.resolve(outArg);fs.mkdirSync(q,{recursive:true});
const {initSync,HwpDocument}=await import(pathToFileURL(path.join(engine,'rhwp.js')));const bytes=fs.readFileSync(path.join(engine,'rhwp_bg.wasm'));const wasm=initSync({module:bytes});
let source=fs.readFileSync(path.join(root,'rhwp-studio/src/engine/command.ts'),'utf8');let js='const MAX_PAGE_LOCAL_TEXT_EDIT_CHARS=10000;\n'+stripTypeScriptTypes(source,{mode:'transform'}).replace(/^import .*?;\s*$/gm,'');const commands=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
const src=fs.readFileSync(path.join(root,'rhwp-studio/src/core/wasm-bridge.ts'),'utf8');let code='class BridgeProbe {doc; constructor(doc){this.doc=doc;}\n';
for(const n of ['splitParagraph','splitParagraphInCell','mergeParagraph','mergeParagraphInCell','saveSnapshot','saveSnapshotWithComposition','restoreSnapshot','discardSnapshot']){const a=src.indexOf('  '+n+'('),b=src.indexOf('\n  }',a)+4;assert(a>=0,n);code+=src.slice(a,b)+'\n';}code+='} export {BridgeProbe};';
const {BridgeProbe}=await import('data:text/javascript;base64,'+Buffer.from('function serializeParaMeta(m){return m?JSON.stringify(m):undefined;}\n'+stripTypeScriptTypes(code,{mode:'transform'})).toString('base64'));

import inspector from 'node:inspector';
const session=new inspector.Session();session.connect();
const post=(method,params={})=>new Promise((resolve,reject)=>session.post(method,params,(error,value)=>error?reject(error):resolve(value)));
await post('Profiler.enable');await post('Profiler.setSamplingInterval',{interval:1000});
const configs=JSON.parse(fs.readFileSync(path.join(fixtures,'manifest.json'))),rows=[];
for(const c of configs){
 for(let trial=-1;trial<2;trial++){
  globalThis.gc?.();const d=new HwpDocument(fs.readFileSync(path.resolve(fixtures,path.basename(c.file))));const b=new BridgeProbe(d);
  const pos=c.scope==='body'?{sectionIndex:0,paragraphIndex:c.target,charOffset:c.offset}:{sectionIndex:0,paragraphIndex:c.target,parentParaIndex:c.target,controlIndex:0,cellIndex:0,cellParaIndex:0,charOffset:c.offset};
  const cmd=new (c.scope==='body'?commands.SplitParagraphCommand:commands.SplitParagraphInCellCommand)(pos,true);const profiled=c.paragraphs===8192&&trial>=0;
  try {
   if(profiled)await post('Profiler.start');
   const start=performance.now();cmd.execute(b);const enterMs=performance.now()-start;
   if(profiled){const {profile}=await post('Profiler.stop');fs.writeFileSync(path.join(q,`${c.scope}-${c.paragraphs}-${trial}.cpuprofile`),JSON.stringify(profile));}
   const startUndo=performance.now();cmd.undo(b);const undoMs=performance.now()-startUndo;
   const rss=process.memoryUsage().rss,wasmBytes=wasm.memory.buffer.byteLength;assert(rss<768*1024*1024);assert(wasmBytes<512*1024*1024);
   const row={scope:c.scope,paragraphs:c.paragraphs,trial,warmup:trial<0,CPUProfiled:profiled,enterMs,undoMs,rssBytes:rss,wasmBytes};rows.push(row);console.log(JSON.stringify(row));
  }finally{cmd.discard(b);d.free();}
 }
}
session.disconnect();fs.writeFileSync(path.join(q,'wasm-profile-timings.json'),JSON.stringify({engineSHA256:crypto.createHash('sha256').update(bytes).digest('hex'),node:process.version,actualCurrentUICommand:true,CPUIntervalUs:1000,instrumentationOnly:true,GUIVerified:false,rows},null,2));

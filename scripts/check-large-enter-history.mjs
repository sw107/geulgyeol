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
const configs=JSON.parse(fs.readFileSync(path.join(fixtures,'manifest.json')));
// Large-document correctness checks run after every timed trial has finished.
const largeHistory=[];
const largeParity=[];
const views=d=>Array.from({length:d.pageCount()},(_,i)=>{const svg=d.renderPageSvg(i);const digest=crypto.createHash('sha256').update(svg).digest('hex');globalThis.gc?.();assert(process.memoryUsage().rss<768*1024*1024);assert(wasm.memory.buffer.byteLength<512*1024*1024);return digest;});
const semantic=(d,c)=>({text:d.getTextFileText(),styles:d.getStyleList(),paragraphs:d.getParagraphCount(0),bodyStyles:Array.from({length:d.getParagraphCount(0)},(_,i)=>JSON.parse(d.getStyleAt(0,i)).id),cellStyles:c.scope==='cell'?Array.from({length:d.getCellParagraphCount(0,c.target,0,0)},(_,i)=>JSON.parse(d.getCellStyleAt(0,c.target,0,0,i)).id):[]});
for(const c of configs.filter(c=>c.paragraphs===8192)) {
 globalThis.gc?.();const d=new HwpDocument(fs.readFileSync(path.resolve(fixtures,path.basename(c.file))));const b=new BridgeProbe(d);
 const pos=c.scope==='body'?{sectionIndex:0,paragraphIndex:c.target,charOffset:c.offset}:{sectionIndex:0,paragraphIndex:c.target,parentParaIndex:c.target,controlIndex:0,cellIndex:0,cellParaIndex:0,charOffset:c.offset};
 const cmd=new (c.scope==='body'?commands.SplitParagraphCommand:commands.SplitParagraphInCellCommand)(pos,true);
 let reopens=0;
 const reopen=expected=>{for(const format of ['Hwp','Hwpx']){const exported=d['export'+format+'WithReport']();try{assert.equal(JSON.parse(exported.contentLoss()).count,0);const reopened=new HwpDocument(exported.takeBytes());try{assert.deepEqual(semantic(reopened,c),expected);reopens++;}finally{reopened.free();}}finally{exported.free();}}};
 try {
  const before=semantic(d,c),beforeSvg=views(d);cmd.execute(b);const after=semantic(d,c),afterSvg=views(d);reopen(after);
  cmd.undo(b);assert.deepEqual(semantic(d,c),before);assert.deepEqual(views(d),beforeSvg);reopen(before);
  cmd.execute(b);assert.deepEqual(semantic(d,c),after);assert.deepEqual(views(d),afterSvg);reopen(after);
  const rss=process.memoryUsage().rss,wasmBytes=wasm.memory.buffer.byteLength;assert(rss<768*1024*1024);assert(wasmBytes<512*1024*1024);
  largeHistory.push({scope:c.scope,paragraphs:c.paragraphs,pagesBefore:beforeSvg.length,pagesAfter:afterSvg.length,exactEveryPageSvgUndoRedo:true,fullTextAndAllBodyStyleIdsPreserved:true,twoFormatReopens:reopens,rssBytes:rss,wasmBytes});
  largeParity.push({scope:c.scope,paragraphs:c.paragraphs,beforePageSHA256:beforeSvg,afterPageSHA256:afterSvg,beforeSemanticSHA256:crypto.createHash('sha256').update(JSON.stringify(before)).digest('hex'),afterSemanticSHA256:crypto.createHash('sha256').update(JSON.stringify(after)).digest('hex')});
 }finally{cmd.discard(b);d.free();}
}
fs.writeFileSync(path.join(q,'large-history-parity.json'),JSON.stringify(largeParity,null,2));
fs.writeFileSync(path.join(q,'large-history-proof.json'),JSON.stringify({engineSHA256:crypto.createHash('sha256').update(bytes).digest('hex'),node:process.version,largeHistory,comparison:'per-page SHA256 without retaining SVG strings',GUIVerified:false,physicalIMEVerified:false},null,2));console.log(JSON.stringify(largeHistory));

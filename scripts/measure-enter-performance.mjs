// Synthetic Enter/undo timings using generated WASM and the current typed UI command source.
import fs from 'node:fs';import path from 'node:path';import {pathToFileURL,fileURLToPath} from 'node:url';import {stripTypeScriptTypes} from 'node:module';import {performance} from 'node:perf_hooks';import assert from 'node:assert/strict';import crypto from 'node:crypto';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const [engineArg,fixturesArg,outArg,label='measured',modesArg]=process.argv.slice(2);
assert(engineArg && fixturesArg && outArg,'ENGINE_DIR FIXTURE_DIR OUTPUT_DIR [LABEL] [MODES_CSV]');
const allowedModes=['legacy-core','next-core','legacy-command','next-command'];
const modes=modesArg===undefined?allowedModes:modesArg.split(',');
assert(modes.length>0 && new Set(modes).size===modes.length && modes.every(mode=>allowedModes.includes(mode)),'MODES_CSV must contain unique supported modes');
const engine=path.resolve(engineArg),fixtures=path.resolve(fixturesArg),q=path.resolve(outArg);fs.mkdirSync(q,{recursive:true});
const {initSync,HwpDocument}=await import(pathToFileURL(path.join(engine,'rhwp.js')));const bytes=fs.readFileSync(path.join(engine,'rhwp_bg.wasm'));const wasm=initSync({module:bytes});
let source=fs.readFileSync(path.join(root,'rhwp-studio/src/engine/command.ts'),'utf8');let js='const MAX_PAGE_LOCAL_TEXT_EDIT_CHARS=10000;\n'+stripTypeScriptTypes(source,{mode:'transform'}).replace(/^import .*?;\s*$/gm,'');const commands=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
const src=fs.readFileSync(path.join(root,'rhwp-studio/src/core/wasm-bridge.ts'),'utf8');let code='class BridgeProbe {doc; constructor(doc){this.doc=doc;}\n';
for(const n of ['splitParagraph','splitParagraphInCell','mergeParagraph','mergeParagraphInCell','saveSnapshot','saveSnapshotWithComposition','restoreSnapshot','discardSnapshot']){const a=src.indexOf('  '+n+'('),b=src.indexOf('\n  }',a)+4;assert(a>=0,n);code+=src.slice(a,b)+'\n';}code+='} export {BridgeProbe};';
const {BridgeProbe}=await import('data:text/javascript;base64,'+Buffer.from('function serializeParaMeta(m){return m?JSON.stringify(m):undefined;}\n'+stripTypeScriptTypes(code,{mode:'transform'})).toString('base64'));
const configs=JSON.parse(fs.readFileSync(path.join(fixtures,'manifest.json')));const results=[];let maxRss=0,maxWasm=0;
const timed=f=>{const a=performance.now();const value=f();return {value,ms:performance.now()-a};};const summary=a=>{a=a.toSorted((x,y)=>x-y);return {medianMs:(a[Math.floor((a.length-1)/2)]+a[Math.floor(a.length/2)])/2,p95Ms:a[Math.min(a.length-1,Math.ceil(a.length*.95)-1)],minMs:a[0],maxMs:a.at(-1)};};
for(const c of configs){const data=fs.readFileSync(path.resolve(fixtures,path.basename(c.file)));const values=Object.fromEntries(modes.map(n=>[n,[]]));let pages=0;
 for(let trial=-3;trial<12;trial++){
  const order=trial%2===0?Object.keys(values):Object.keys(values).reverse();
  for(const mode of order){globalThis.gc?.();const load=timed(()=>new HwpDocument(data));const d=load.value;const b=new BridgeProbe(d);const parts={save:[],restore:[],split:[],merge:[]};
   for(const [name,kind]of [['saveSnapshot','save'],['saveSnapshotWithComposition','save'],['restoreSnapshot','restore'],['splitParagraph','split'],['splitParagraphInCell','split'],['mergeParagraph','merge'],['mergeParagraphInCell','merge']]){const fn=b[name].bind(b);b[name]=(...a)=>{const r=timed(()=>fn(...a));parts[kind].push(r.ms);return r.value;};}
   let cmd;
   try{assert.equal(d.getParagraphCount(0),c.paragraphs);pages=d.pageCount();const pos=c.scope==='body'?{sectionIndex:0,paragraphIndex:c.target,charOffset:c.offset}:{sectionIndex:0,paragraphIndex:c.target,parentParaIndex:c.target,controlIndex:c.control,cellIndex:0,cellParaIndex:0,charOffset:c.offset};
    const next=mode.startsWith('next');let run,undo;
    if(mode.endsWith('command')){cmd=new (c.scope==='body'?commands.SplitParagraphCommand:commands.SplitParagraphInCellCommand)(pos,next);run=()=>cmd.execute(b);undo=()=>cmd.undo(b);}
    else{run=()=>c.scope==='body'?b.splitParagraph(0,c.target,c.offset,undefined,next):b.splitParagraphInCell(0,c.target,0,0,0,c.offset,undefined,next);undo=()=>c.scope==='body'?b.mergeParagraph(0,c.target+1):b.mergeParagraphInCell(0,c.target,0,0,1);}
    const enter=timed(run).ms;const styleAfter=JSON.parse(c.scope==='body'?d.getStyleAt(0,c.target+1):d.getCellStyleAt(0,c.target,0,0,1)).id;assert.equal(styleAfter,next?23:22);const back=timed(undo).ms;
    const styleUndo=JSON.parse(c.scope==='body'?d.getStyleAt(0,c.target):d.getCellStyleAt(0,c.target,0,0,0)).id;assert.equal(styleUndo,22);
    const memory={rss:process.memoryUsage().rss,wasm:wasm.memory.buffer.byteLength};maxRss=Math.max(maxRss,memory.rss);maxWasm=Math.max(maxWasm,memory.wasm);assert(memory.rss<768*1024*1024,'RSS budget');assert(memory.wasm<512*1024*1024,'WASM budget');
    if(trial>=0)values[mode].push({enter,undo:back,load:load.ms,saveBefore:parts.save[0]||0,saveAfter:parts.save[1]||0,restore:parts.restore[0]||0,split:parts.split[0],merge:parts.merge[0]||0,...memory});
   }finally{cmd?.discard(b);d.free();}
  }
 }
 for(const [mode,samples]of Object.entries(values)){const row={scope:c.scope,paragraphs:c.paragraphs,textScalars:c.textScalars,pages,mode,samples:12,metrics:{}};for(const key of ['enter','undo','load','saveBefore','saveAfter','restore','split','merge'])row.metrics[key]=summary(samples.map(x=>x[key]));row.raw=samples;results.push(row);console.log(JSON.stringify({...row,raw:undefined}));}
 fs.writeFileSync(path.join(q,label+'-partial.json'),JSON.stringify(results,null,2));
}
const proof={engineSHA256:crypto.createHash('sha256').update(bytes).digest('hex'),node:process.version,platform:process.platform,arch:process.arch,warmupTrials:3,measuredTrials:12,alternatingModeOrder:true,modes,gcBetweenTrials:typeof globalThis.gc==='function',rssLimitBytes:768*1024*1024,wasmLimitBytes:512*1024*1024,maxRssBytes:maxRss,maxWasmBytes:maxWasm,sourceSHA256:crypto.createHash('sha256').update(source).digest('hex'),bridgeSHA256:crypto.createHash('sha256').update(src).digest('hex'),GUIVerified:false,physicalIMEVerified:false,results};fs.writeFileSync(path.join(q,label+'-proof.json'),JSON.stringify(proof,null,2));console.log(JSON.stringify({complete:true,maxRss,maxWasm}));

// Paired default-runtime comparison; fixed common warmup and alternating A/B order.
import fs from 'node:fs';import path from 'node:path';import {pathToFileURL,fileURLToPath} from 'node:url';import {stripTypeScriptTypes} from 'node:module';import {performance} from 'node:perf_hooks';import assert from 'node:assert/strict';import crypto from 'node:crypto';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const [baselineArg,candidateArg,fixturesArg,outArg]=process.argv.slice(2);
assert(baselineArg&&candidateArg&&fixturesArg&&outArg,'BASELINE_ENGINE CANDIDATE_ENGINE FIXTURES OUTPUT_DIR');
assert.equal(typeof globalThis.gc,'function','run with --expose-gc');
const fixtures=path.resolve(fixturesArg),out=path.resolve(outArg);fs.mkdirSync(out,{recursive:true});
const engines={};
for(const [name,dir] of [['baseline',baselineArg],['candidate',candidateArg]]){
 const bytes=fs.readFileSync(path.resolve(dir,'rhwp_bg.wasm'));const {initSync,HwpDocument}=await import(pathToFileURL(path.resolve(dir,'rhwp.js')));engines[name]={HwpDocument,wasm:initSync({module:bytes}),sha256:crypto.createHash('sha256').update(bytes).digest('hex')};
}
let source=fs.readFileSync(path.join(root,'rhwp-studio/src/engine/command.ts'),'utf8');let js='const MAX_PAGE_LOCAL_TEXT_EDIT_CHARS=10000;\n'+stripTypeScriptTypes(source,{mode:'transform'}).replace(/^import .*?;\s*$/gm,'');const commands=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
const src=fs.readFileSync(path.join(root,'rhwp-studio/src/core/wasm-bridge.ts'),'utf8');let code='class BridgeProbe {doc; constructor(doc){this.doc=doc;}\n';
for(const n of ['splitParagraph','splitParagraphInCell','mergeParagraph','mergeParagraphInCell','saveSnapshot','saveSnapshotWithComposition','restoreSnapshot','discardSnapshot']){const a=src.indexOf('  '+n+'('),b=src.indexOf('\n  }',a)+4;assert(a>=0,n);code+=src.slice(a,b)+'\n';}code+='} export {BridgeProbe};';
const {BridgeProbe}=await import('data:text/javascript;base64,'+Buffer.from('function serializeParaMeta(m){return m?JSON.stringify(m):undefined;}\n'+stripTypeScriptTypes(code,{mode:'transform'})).toString('base64'));

const configs=JSON.parse(fs.readFileSync(path.join(fixtures,'manifest.json')));const inputs=new Map(configs.map(c=>[c.file,fs.readFileSync(path.join(fixtures,path.basename(c.file)))]));
const order=trial=>trial%2===0?['baseline','candidate']:['candidate','baseline'];const results=[];let maxRss=0,maxWasmCombined=0;
function trial(c,name){
 globalThis.gc();const e=engines[name],d=new e.HwpDocument(inputs.get(c.file)),b=new BridgeProbe(d);
 const pos=c.scope==='body'?{sectionIndex:0,paragraphIndex:c.target,charOffset:c.offset}:{sectionIndex:0,paragraphIndex:c.target,parentParaIndex:c.target,controlIndex:0,cellIndex:0,cellParaIndex:0,charOffset:c.offset};
 const cmd=new (c.scope==='body'?commands.SplitParagraphCommand:commands.SplitParagraphInCellCommand)(pos,true);
 try{
  const start=performance.now();cmd.execute(b);const enterMs=performance.now()-start;
  assert.equal(JSON.parse(c.scope==='body'?d.getStyleAt(0,c.target+1):d.getCellStyleAt(0,c.target,0,0,1)).id,23);
  const undoStart=performance.now();cmd.undo(b);const undoMs=performance.now()-undoStart;
  assert.equal(JSON.parse(c.scope==='body'?d.getStyleAt(0,c.target):d.getCellStyleAt(0,c.target,0,0,0)).id,22);
  const rss=process.memoryUsage().rss,wasmCombined=Object.values(engines).reduce((s,e)=>s+e.wasm.memory.buffer.byteLength,0);maxRss=Math.max(maxRss,rss);maxWasmCombined=Math.max(maxWasmCombined,wasmCombined);assert(rss<768*1048576);assert(wasmCombined<512*1048576);
  return {enterMs,undoMs,rssBytes:rss,combinedWasmBytes:wasmCombined};
 }finally{cmd.discard(b);d.free();}
}
const globalWarmup=[];
// Both instances receive exactly twelve large-body and twelve large-cell edits.
for(let i=0;i<12;i++)for(const c of configs.filter(c=>c.paragraphs===8192))for(const name of order(i))globalWarmup.push({scope:c.scope,engine:name,trial:i,...trial(c,name)});
for(const c of configs){
 for(let i=0;i<3;i++)for(const name of order(i))trial(c,name);
 const rows=[];
 for(let i=0;i<20;i++){
  const pair={trial:i,order:order(i)};for(const name of pair.order)pair[name]=trial(c,name);rows.push(pair);
 }
 results.push({scope:c.scope,paragraphs:c.paragraphs,inputSHA256:crypto.createHash('sha256').update(inputs.get(c.file)).digest('hex'),rows});
 fs.writeFileSync(path.join(out,'controlled-partial.json'),JSON.stringify({globalWarmup,results},null,2));console.log(JSON.stringify({scope:c.scope,paragraphs:c.paragraphs,completedPairs:rows.length}));
}
const median=a=>{const v=a.toSorted((a,b)=>a-b);return(v[Math.floor((v.length-1)/2)]+v[Math.floor(v.length/2)])/2;};
const stats=a=>{const mean=a.reduce((s,v)=>s+v,0)/a.length,variance=a.reduce((s,v)=>s+(v-mean)**2,0)/(a.length-1);return{medianMs:median(a),meanMs:mean,varianceMsSquared:variance,stdDevMs:Math.sqrt(variance),minMs:Math.min(...a),maxMs:Math.max(...a),firstHalfMedianMs:median(a.slice(0,a.length/2)),lastHalfMedianMs:median(a.slice(a.length/2))};};
let seed=0x53616d65;const rand=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return(seed>>>0)/4294967296;};
const bootstrap=a=>{const draws=[];for(let i=0;i<10000;i++)draws.push(median(Array.from({length:a.length},()=>a[Math.floor(rand()*a.length)])));draws.sort((a,b)=>a-b);return[draws[249],draws[9749]];};
function signP(a){const n=a.filter(v=>v!==0).length,k=a.filter(v=>v>0).length;if(!n)return 1;let c=1,p=0;for(let j=0;j<=n;j++){if(j>=Math.max(k,n-k))p+=c/2**n;c=c*(n-j)/(j+1);}return Math.min(1,2*p);}
const summary=results.map(r=>{const row={scope:r.scope,paragraphs:r.paragraphs,metrics:{}};for(const metric of ['enterMs','undoMs']){const a=r.rows.map(x=>x.baseline[metric]),b=r.rows.map(x=>x.candidate[metric]),delta=a.map((v,i)=>v-b[i]),baseline=stats(a),candidate=stats(b);row.metrics[metric]={baseline,candidate,medianGainPercent:(1-candidate.medianMs/baseline.medianMs)*100,pairedMedianSavedMs:median(delta),pairedMedianSaved95PercentBootstrapMs:bootstrap(delta),twoSidedSignTestP:signP(delta),candidateWins:delta.filter(v=>v>0).length,baselineDriftPercent:Math.abs(baseline.lastHalfMedianMs/baseline.firstHalfMedianMs-1)*100,candidateDriftPercent:Math.abs(candidate.lastHalfMedianMs/candidate.firstHalfMedianMs-1)*100};}return row;});
const gates=summary.map(r=>({scope:r.scope,paragraphs:r.paragraphs,passes:['enterMs','undoMs'].every(metric=>{const m=r.metrics[metric];return r.paragraphs===8192?m.medianGainPercent>=10&&m.pairedMedianSaved95PercentBootstrapMs[0]>0&&m.twoSidedSignTestP<0.05&&m.baselineDriftPercent<=10&&m.candidateDriftPercent<=10:m.medianGainPercent>=-5;})}));
const proof={node:process.version,platform:process.platform,arch:process.arch,runtimeFlags:process.execArgv,engineSHA256:Object.fromEntries(Object.entries(engines).map(([n,e])=>[n,e.sha256])),mode:'actual current next-command',globalWarmupsPerEngine:{body8192:12,cell8192:12},perConfigWarmups:3,measuredPairsPerConfig:20,executionOrder:'AB then BA in alternate trials; ten trials each order',bothInstancesInSameProcess:true,heavyConcurrentTasks:false,summary,gates,predeclaredCandidateGate:'both large scopes Enter and undo gain >=10%, paired median bootstrap lower bound >0, sign p<.05, within-run half median drift <=10%; all small-config median regressions <=5%',allGatesPassed:gates.every(g=>g.passes),maxRssBytes:maxRss,maxCombinedWasmBytes:maxWasmCombined,rssLimitBytes:768*1048576,combinedWasmLimitBytes:512*1048576,heapMiB:192,confidenceIntervalsAreDescriptive:true,GUIVerified:false,physicalIMEVerified:false,globalWarmup,results};
fs.writeFileSync(path.join(out,'controlled-proof.json'),JSON.stringify(proof,null,2));console.log(JSON.stringify({allGatesPassed:proof.allGatesPassed,gates,maxRss,maxWasmCombined}));

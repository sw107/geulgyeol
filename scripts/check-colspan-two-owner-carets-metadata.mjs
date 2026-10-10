// Metadata-aware successor. Historical indexed and dirty consumers are preserved.
// Usage: WASM_PKG SEEDS_JSON FRESH_OUTPUT NATIVE_LEDGER_ROOT NATIVE_BASELINE_ORACLE
// Requires GEULGYEOL_QA_BUDGET_ROOT identifying the entire new QA bundle.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {CaretRunIndex, forEachBatch} from './qa-caret-run-index.mjs';
import {EvidenceBudget} from './qa-evidence-budget.mjs';
import {openNativeSourceEvidence} from './qa-native-metadata-input.mjs';
const [pkgArg,seedsArg,outArg,nativeArg,baselineArg] = process.argv.slice(2);
assert(nativeArg && baselineArg, 'Native ledger and baseline oracle required');
assert(process.env.GEULGYEOL_QA_BUDGET_ROOT, 'explicit whole-run budget root required');
const pkg=path.resolve(pkgArg), out=path.resolve(outArg), nativeRoot=path.resolve(nativeArg);
assert(!fs.existsSync(out), 'fresh output required');
const budgetRoot=path.resolve(process.env.GEULGYEOL_QA_BUDGET_ROOT);
const relative=path.relative(budgetRoot,out);
assert(relative&&!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative),'fresh phase must be inside whole-run root');
new EvidenceBudget({root:budgetRoot}).check({normalForecastBytes:1048576,failureForecastBytes:16384});
fs.mkdirSync(out);
const budget=new EvidenceBudget({root:budgetRoot,phase:out});
budget.begin({normalForecastBytes:1048576,failureForecastBytes:16384});
const sha=b=>createHash('sha256').update(b).digest('hex');
async function fileSHA(file) {
 const h=createHash('sha256');for await(const chunk of fs.createReadStream(file))h.update(chunk);return h.digest('hex');
}
let checked=0;
const rows=[], tolerance=.11, batchSize=128;
try {
 const M=await import(pathToFileURL(path.join(pkg,'rhwp.js')));
 M.initSync({module:fs.readFileSync(path.join(pkg,'rhwp_bg.wasm'))});
 const seeds=JSON.parse(fs.readFileSync(seedsArg));
 const evidence=await openNativeSourceEvidence({nativeRoot,seedsFile:path.resolve(seedsArg),baselineRoot:path.resolve(baselineArg)});
 const {nativeProcess,nativeProcessFile,nativeBinary,nativePin}=evidence;
 async function verify(d,label,oracle) {
  const t=JSON.parse(d.getControls()).find(t=>t.ctrlId==='tbl'&&t.list===0);
  const dim=JSON.parse(d.getTableDimensions(0,t.para,t.controlIndex));
  const snapshot=()=>({hwp:sha(d.exportHwp()),hwpx:sha(d.exportHwpx()),
   svg:Array.from({length:d.pageCount()},(_,i)=>sha(d.renderPageSvg(i)))});
  const before=snapshot(), rendered=new CaretRunIndex();
  for(let page=0;page<d.pageCount();page++)
   for(const r of JSON.parse(d.getPageTextLayout(page)).runs)rendered.add(r,page);
  function* queries() {
   for(let cell=0;cell<dim.cellCount;cell++) {
    if(JSON.parse(d.getCellInfo(0,t.para,t.controlIndex,cell)).row===0)continue;
    for(let para=0;para<d.getCellParagraphCount(0,t.para,t.controlIndex,cell);para++) {
     const length=[...d.getTextInCell(0,t.para,t.controlIndex,cell,para,0,100000)].length;
     for(const offset of new Set([0,Math.floor(length/2),length]))yield {cell,para,offset};
    }
   }
  }
  let maximumXErrorPx=0,maximumYErrorPx=0,maximumHeightErrorPx=0;
  const count=await forEachBatch(queries(),async ({cell,para,offset},i)=>{
   if(i%batchSize===0)budget.check();
   const matching=rendered.query(cell,para,offset);
   assert(matching.length,'rendered caret witness');
   const rect=JSON.parse(d.getCursorRectInCell(0,t.para,t.controlIndex,cell,para,offset));
   assert(matching.some(w=>w.page===rect.pageIndex),'caret on rendered owner page');
   assert.equal(rect.cellOverflowed,false,'caret inside body cell');
   const witnesses=oracle.index.query(cell,para,offset,rect.pageIndex).map(({run:r,page})=>{
    const local=offset-r.charStart;
    assert(local<r.charX.length,'Native character advance witness');
    return {page,dx:Math.abs(rect.x-(r.x+r.charX[local])),
     dy:Math.abs(rect.y-(r.paintBaselineY-r.paintFontSize*.8)),dh:Math.abs(rect.height-r.paintFontSize)};
   });
   const witness=witnesses.find(w=>w.dx<=tolerance&&w.dy<=tolerance&&w.dh<=tolerance);
   assert(witness,label+' Native coordinates: '+JSON.stringify({cell,para,offset,rect,witnesses}));
   maximumXErrorPx=Math.max(maximumXErrorPx,witness.dx);
   maximumYErrorPx=Math.max(maximumYErrorPx,witness.dy);
   maximumHeightErrorPx=Math.max(maximumHeightErrorPx,witness.dh);
  },batchSize);
  assert.deepEqual(snapshot(),before,'caret queries read only');
  checked+=count;rows.push({label,carets:count,coordinateQueries:count,pages:d.pageCount(),readOnly:true,
   nativeLedgerSHA256:oracle.ledgerSHA256,nativeSourceSHA256:oracle.sourceSHA256,
   nativeBaselineOracleSHA256:oracle.baselineSHA256,maximumXErrorPx,maximumYErrorPx,maximumHeightErrorPx});
 }
 for(const seed of seeds)for(const ext of ['hwp','hwpx']) {
  budget.check();
  const bytes=fs.readFileSync(seed.files[ext]),pin=sha(bytes),d=new M.HwpDocument(bytes);
  try {
   const processRow=nativeProcess.rows.find(r=>r.label===seed.label&&r.format===ext);
   assert.equal(processRow?.exitCode,0);
   assert.equal(processRow.sourceSHA256||processRow.sourceSHA256Before,pin);
   assert.equal(processRow.sourceAfterSHA256||processRow.sourceSHA256After,pin);
   const ledgerBytes=fs.readFileSync(path.join(nativeRoot,seed.label+'-'+ext,'ledger.json'));
   const ledger=JSON.parse(ledgerBytes);
   const baselineBytes=fs.readFileSync(path.join(path.resolve(baselineArg),seed.label+'-'+ext+'.json'));
   const baseline=JSON.parse(baselineBytes),byRun=new Map();
   for(const r of baseline.runs) {
    const key=r.page+':'+r.runIndex;assert(!byRun.has(key),'duplicate baseline run');byRun.set(key,r);
   }
   const oracle={ledgerSHA256:sha(ledgerBytes),sourceSHA256:pin,baselineSHA256:sha(baselineBytes),
    index:new CaretRunIndex({target:ledger.target,native:true})};
   assert.equal(baseline.nativeLedgerSHA256,oracle.ledgerSHA256);assert.equal(baseline.sourceSHA256,pin);
   for(const p of ledger.pages)for(const [index,r] of p.text.runs.entries()) {
    const paint=byRun.get(p.page+':'+index);
    oracle.index.add({...r,...paint},p.page);
   }
   await verify(d,seed.label+'-'+ext,oracle);
   for(const save of ['hwp','hwpx']) {
    const v=new M.HwpDocument(save==='hwp'?d.exportHwp():d.exportHwpx());
    try {await verify(v,seed.label+'-'+ext+'-reopen-'+save,oracle);}finally{v.free();}
   }
   assert.equal(await fileSHA(seed.files[ext]),pin);
  } finally {d.free();}
 }
 await evidence.verifyUnchanged();
 assert.equal(await fileSHA(nativeBinary),nativePin);
 const proof={engineSHA256:await fileSHA(path.join(pkg,'rhwp_bg.wasm')),nativeSHA256:nativePin,
  nativeProcessSHA256:await fileSHA(nativeProcessFile),coordinateTolerancePx:tolerance,
  queryBatchSize:batchSize,coordinateQueries:checked,checked,rows,metadataConsumer:true,metadataInputFiles:evidence.inputFiles};
 const json=JSON.stringify(proof,null,2)+'\n';
 budget.check({normalForecastBytes:Buffer.byteLength(json)});
 fs.writeFileSync(path.join(out,'proof.json'),json,{flag:'wx'});
 budget.mark('complete');
 console.log(JSON.stringify({checked,documents:rows.length}));
} catch(e) {
 budget.mark('failed');
 fs.writeFileSync(path.join(out,'failure.json'),JSON.stringify({complete:false,failure:String(e),checked})+'\n',{flag:'wx'});
 throw e;
}

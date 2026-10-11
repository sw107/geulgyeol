// Existing synthetic fixtures; actual host functions with Electron/DOM adapters.
// No app/UI execution, passwords in IPC, or plaintext files/fallback.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {exportHostDocumentForSave} from '../rhwp-studio/src/command/host-save-export.ts';
import {consumeWasmDocumentExport} from '../rhwp-studio/src/core/export-content-loss.ts';
const require=createRequire(import.meta.url);
const {bootHost,uiController}=require('./check-host-save.cjs');
const storage=require('../desktop/storage.cjs');
const root=path.resolve(import.meta.dirname,'..');
const out=path.resolve(process.argv[2]),native=path.resolve(process.argv[3]);
function owned(p){assert(p.startsWith(path.join(root,'.geulgyeol-local/qa')+path.sep));assert.equal(fs.realpathSync(path.dirname(p)),path.dirname(p));}
owned(out);owned(native);assert(!fs.existsSync(out),'fresh evidence directory');fs.mkdirSync(out);
const inputPassword='QA-fixture-input-only',outputPassword='QA-fixture-output-only',wrongPassword='QA-fixture-incorrect';
const sha=b=>createHash('sha256').update(b).digest('hex');
const write=(n,v)=>fs.writeFileSync(path.join(out,n),JSON.stringify(v,null,2)+'\n');
const {initSync,HwpDocument}=await import(pathToFileURL(path.join(root,'pkg/rhwp.js')));
initSync({module:fs.readFileSync(path.join(root,'pkg/rhwp_bg.wasm'))});
const plan=JSON.parse(fs.readFileSync(path.join(native,'manifest.json')));
assert.equal(plan.schema,'geulgyeol-encrypted-complex-native-v1');
assert.equal(plan.inputs.length,6);assert.equal(plan.rows.length,12);
assert.equal(new Set(plan.inputs.map(r=>r.label+'/'+r.source)).size,6);
for(const input of plan.inputs){assert(['repeat-table','merged-repeat-table','caption-pictures'].includes(input.label));assert(['hwp','hwpx'].includes(input.source));}
const json=s=>JSON.parse(s);
function svg(d){assert(d.pageCount()>=1&&d.pageCount()<=16);return Array.from({length:d.pageCount()},(_,i)=>d.renderPageSvg(i));}
function view(d){
 const controls=json(d.getControls()),tables=controls.filter(c=>c.ctrlId==='tbl'&&c.list===0);
 return {text:d.getTextFileText(),styles:json(d.getStyleList()),
  body:Array.from({length:d.getParagraphCount(0)},(_,p)=>({text:d.getTextRange(0,p,0,100000),runs:json(d.getCharFormatRuns(0,p,0,d.getParagraphLength(0,p)))})),
  tables:tables.map(t=>{const dim=json(d.getTableDimensions(0,t.para,t.controlIndex));return {dim,properties:json(d.getTableProperties(0,t.para,t.controlIndex)),cells:Array.from({length:dim.cellCount},(_,i)=>({info:json(d.getCellInfo(0,t.para,t.controlIndex,i)),props:json(d.getCellProperties(0,t.para,t.controlIndex,i)),paras:Array.from({length:d.getCellParagraphCount(0,t.para,t.controlIndex,i)},(_,p)=>{const text=d.getTextInCell(0,t.para,t.controlIndex,i,p,0,100000);return {text,runs:json(d.getCellCharFormatRunsByPath(0,t.para,JSON.stringify([{controlIndex:t.controlIndex,cellIndex:i,cellParaIndex:p}]),0,[...text].length))};})}))};}),
  pictures:controls.filter(c=>c.ctrlId==='gso'&&c.list===0).map(c=>json(d.getPictureProperties(0,c.para,c.controlIndex)))};
}
const rows=[];let unexpected=0;
for(const input of plan.inputs){
 if(input.status!=='prepared'){for(const target of ['hwp','hwpx'])rows.push({...input,target,status:'native-input-unavailable'});continue;}
 owned(input.file);const original=fs.readFileSync(input.file);assert.equal(sha(original),input.sha256);
 for(const target of ['hwp','hwpx']){
  const d=HwpDocument.openWithPassword(original,inputPassword);
  try{
   assert.throws(()=>new HwpDocument(original));assert.throws(()=>HwpDocument.openWithPassword(original,wrongPassword));
   d.insertText(0,0,0,'SAVED_EDIT ');const before=view(d),beforeSvg=svg(d);
   const file=path.join(out,`${input.label}-${input.source}-to-${target}.${target}`);
   // Test an explicitly selected existing synthetic file; successful save may replace it.
   fs.writeFileSync(file,original);
   const reference=plan.rows.find(r=>r.label===input.label&&r.source===input.source&&r.target===target);
   let lastReport=null,ipcCalls=0;
   const reported=(format,p)=>{const a=consumeWasmDocumentExport(d[format==='hwp'?'exportHwpWithPasswordAndReport':'exportHwpxWithPasswordAndReport'](p));lastReport=a.contentLoss;return a;};
   const exporter={requiresPasswordForSave:true,fileName:input.label+'.'+input.source,
    exportHwpWithPasswordAndReport:p=>reported('hwp',p),exportHwpxWithPasswordAndReport:p=>reported('hwpx',p),
    exportHwpWithReport(){throw Error('plaintext fallback forbidden');},exportHwpxWithReport(){throw Error('plaintext fallback forbidden');}};
   const host=await bootHost(require.resolve('../desktop/main.cjs'),storage,async()=>({canceled:false,filePath:file}));
   const ui=await uiController((...args)=>{assert.equal(args.length,3);assert(!args.some(x=>[inputPassword,outputPassword,wrongPassword].includes(x)));ipcCalls++;const[data,name,format]=args;return host.save(host.event,{data,name,format});},new Uint8Array(),{configureHost(h){h.requiresPasswordForSave=()=>true;h.exportForSave=(format,expected)=>exportHostDocumentForSave(exporter,format,()=>assert.equal(h.state().changeSeq,expected.changeSeq),async()=>outputPassword);}});
   ui.get('format').value=target;await ui.get('save').onclick();
   assert.deepEqual(view(d),before,'live text/formats/table/picture view unchanged');assert.deepEqual(svg(d),beforeSvg);
   assert.equal(sha(fs.readFileSync(input.file)),input.sha256);
   const base={label:input.label,source:input.source,target,loss:lastReport,ipcCalls,inputPreserved:true,sourceViewPreserved:true,sourceSVGPreserved:true};
   if(ui.state().dirty){
    assert.equal(sha(fs.readFileSync(file)),input.sha256);assert.equal(ui.notified.length,0);
    const refused=lastReport?.count>0&&ipcCalls===0;
    rows.push({...base,status:refused?'content-loss-rejected':'unexpected-host-failure',selectedFilePreserved:true});
    if(!refused)unexpected++;
    continue;
   }
   assert.equal(ipcCalls,1);assert.equal(lastReport.count,0);assert.equal(ui.notified.length,1);
   const bytes=fs.readFileSync(file);assert.throws(()=>new HwpDocument(bytes));assert.throws(()=>HwpDocument.openWithPassword(bytes,wrongPassword));assert.throws(()=>HwpDocument.openWithPassword(bytes,inputPassword));
   const reopened=HwpDocument.openWithPassword(bytes,outputPassword);
   try{
    const after=view(reopened),afterSvg=svg(reopened);
    rows.push({...base,status:'saved',file,reference:reference?.file,sha256:sha(bytes),
     nativeReferenceStatus:reference?.status??'unavailable',
     sourceViewEqual:JSON.stringify(after)===JSON.stringify(before),
     sourceFullSVGEqual:JSON.stringify(afterSvg)===JSON.stringify(beforeSvg),
     pages:reopened.pageCount(),wasmSvgSHA256:afterSvg.map(sha),
     noPasswordRejected:true,wrongPasswordRejected:true,previousPasswordRejected:true,
     correctPasswordReopen:true,selectedFilePreserved:false});
   }finally{reopened.free();}
  }finally{d.free();}
 }
}
const lossGateChecks=[];
const nativeProof=json(fs.readFileSync(path.join(native,'proof.json')));
for(const check of nativeProof.contentLossFaultChecks){
 const input=plan.inputs.find(r=>r.label==='caption-pictures'&&r.source===check.target&&r.status==='prepared');
 assert(input);const bytes=fs.readFileSync(input.file),d=HwpDocument.openWithPassword(bytes,inputPassword);
 try{
  const before=view(d),file=path.join(out,'loss-gate-'+check.target+'.'+check.target);fs.writeFileSync(file,bytes);let ipcCalls=0;
  const host=await bootHost(require.resolve('../desktop/main.cjs'),storage,async()=>({canceled:false,filePath:file}));
  const report=(format,p)=>{const a=consumeWasmDocumentExport(d[format==='hwp'?'exportHwpWithPasswordAndReport':'exportHwpxWithPasswordAndReport'](p));assert.equal(a.contentLoss.count,0);return {...a,contentLoss:check.loss};};
  const exporter={requiresPasswordForSave:true,fileName:'caption-pictures.'+check.target,
   exportHwpWithPasswordAndReport:p=>report('hwp',p),exportHwpxWithPasswordAndReport:p=>report('hwpx',p),
   exportHwpWithReport(){throw Error('plaintext fallback forbidden');},exportHwpxWithReport(){throw Error('plaintext fallback forbidden');}};
  const ui=await uiController((data,name,format)=>{ipcCalls++;return host.save(host.event,{data,name,format});},new Uint8Array(),{configureHost(h){h.requiresPasswordForSave=()=>true;h.exportForSave=(format,expected)=>exportHostDocumentForSave(exporter,format,()=>assert.equal(h.state().changeSeq,expected.changeSeq),async()=>outputPassword);}});
  ui.get('format').value=check.target;await ui.get('save').onclick();
  assert.equal(ipcCalls,0);assert.equal(ui.state().dirty,true);assert.equal(ui.notified.length,0);assert.equal(sha(fs.readFileSync(file)),sha(bytes));assert.deepEqual(view(d),before);
  lossGateChecks.push({target:check.target,actualNativeLossDTOInjected:true,actualWASMLossFaultInjected:false,
   loss:check.loss,ipcCalls,dirtyPreserved:true,selectedSyntheticFilePreserved:true,plaintextFallback:false});
 }finally{d.free();}
}
assert.equal(rows.length,12);assert.equal(lossGateChecks.length,2);
write('native-manifest.json',{schema:'geulgyeol-encrypted-complex-host-v1',rows});
write('proof.json',{syntheticOnly:true,actualHostSaveFunction:true,actualRegisteredHostIPCHandler:true,actualNodeFilesystem:true,
 actualWASMSerializers:true,ElectronUIExecuted:false,actualIPCTransportExecuted:false,OSChooserExecuted:false,
 userDocumentsUsed:false,userPasswordsUsed:false,passwordsPassedToMain:false,plaintextFallbackUsed:false,
 engineSHA256:sha(fs.readFileSync(path.join(root,'pkg/rhwp_bg.wasm'))),unexpectedHostFailures:unexpected,rows,lossGateChecks});
console.log(`Host complex encrypted matrix: ${rows.filter(r=>r.status==='saved').length} saved, ${rows.filter(r=>r.status==='content-loss-rejected').length} matrix loss rejections, ${lossGateChecks.length} injected DTO loss-gate checks, ${unexpected} unexpected failures`);
if(unexpected)process.exitCode=1;

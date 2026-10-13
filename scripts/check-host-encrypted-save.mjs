// Real WASM serializers + actual host UI/IPC/storage with dialog/window adapters.
// No Electron, browser, user documents, or user passwords.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {exportHostDocumentForSave} from '../rhwp-studio/src/command/host-save-export.ts';
import {consumeWasmDocumentExport} from '../rhwp-studio/src/core/export-content-loss.ts';
const require=createRequire(import.meta.url);
const {bootHost,storageWithFaults,uiController}=require('./check-host-save.cjs');
const storage=require('../desktop/storage.cjs');
const root=path.resolve(import.meta.dirname,'..'),q=path.resolve(process.argv[2]),native=path.resolve(process.argv[3]);
assert(q.startsWith(path.join(root,'.geulgyeol-local/qa')+path.sep));
assert(native.startsWith(path.join(root,'.geulgyeol-local/qa')+path.sep));
assert(!fs.existsSync(q),'fresh private host-output directory required');fs.mkdirSync(q);
const {initSync,HwpDocument}=await import(pathToFileURL(path.join(root,'pkg/rhwp.js')));
initSync({module:fs.readFileSync(path.join(root,'pkg/rhwp_bg.wasm'))});
// These are public fixture values used by encrypted_save_check.rs, not secrets.
const inputPassword='QA-fixture-input-only',outputPassword='QA-fixture-output-only',wrongPassword='QA-fixture-incorrect';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const write=(name,value)=>fs.writeFileSync(path.join(q,name),JSON.stringify(value,null,2)+'\n');
const rows=[],checks=[];
const svg=d=>Array.from({length:d.pageCount()},(_,i)=>d.renderPageSvg(i));
function exporter(d,fileName){return {requiresPasswordForSave:true,fileName,
 exportHwpWithPasswordAndReport:p=>consumeWasmDocumentExport(d.exportHwpWithPasswordAndReport(p)),
 exportHwpxWithPasswordAndReport:p=>consumeWasmDocumentExport(d.exportHwpxWithPasswordAndReport(p)),
 exportHwpWithReport(){throw Error('plaintext fallback forbidden');},exportHwpxWithReport(){throw Error('plaintext fallback forbidden');}};}
function digest(d){return sha(consumeWasmDocumentExport(d.exportHwpWithReport()).bytes);}
const inputPins={};
for(const source of ['hwp','hwpx']){
 const input=fs.readFileSync(path.join(native,`input-${source}.${source}`));inputPins[source]=sha(input);
 for(const target of ['hwp','hwpx']){
  const d=HwpDocument.openWithPassword(input,inputPassword);
  try{
   d.insertText(0,0,0,'SAVED_EDIT ');const before={text:d.getTextFileText(),svg:svg(d),modelDigest:digest(d)};
   const e=exporter(d,'input-'+source+'.'+source),file=path.join(q,`saved-${source}-to-${target}.${target}`);
   const host=await bootHost(require.resolve('../desktop/main.cjs'),storage,async()=>({canceled:false,filePath:file}));
   const ui=await uiController((...args)=>{assert.equal(args.length,3);assert(!args.some(arg=>arg===inputPassword||arg===outputPassword));const [data,name,format]=args;return host.save(host.event,{data,name,format});},new Uint8Array(),{configureHost(h){h.requiresPasswordForSave=()=>true;h.exportForSave=(format,expected)=>exportHostDocumentForSave(e,format,()=>assert.equal(h.state().changeSeq,expected.changeSeq),async()=>outputPassword);}});
   ui.get('format').value=target;await ui.get('save').onclick();assert.equal(ui.state().dirty,false);assert.equal(ui.notified.length,1);
   const bytes=fs.readFileSync(file);assert.throws(()=>new HwpDocument(bytes));assert.throws(()=>HwpDocument.openWithPassword(bytes,wrongPassword));assert.throws(()=>HwpDocument.openWithPassword(bytes,inputPassword));
   const reopened=HwpDocument.openWithPassword(bytes,outputPassword);
   let wasmSvg;try{assert.equal(reopened.getTextFileText(),before.text);wasmSvg=svg(reopened);assert.deepEqual(wasmSvg,before.svg);}finally{reopened.free();}
   assert.equal(digest(d),before.modelDigest);assert(e.requiresPasswordForSave);
   assert.equal(sha(fs.readFileSync(path.join(native,`input-${source}.${source}`))),inputPins[source]);
   rows.push({source,target,file,reference:path.join(native,`saved-${source}-to-${target}.${target}`),sha256:sha(bytes),wasmSvg,modelPreserved:true,encryptedReopen:true,originalPreserved:true});
  }finally{d.free();}
 }
}
// Failure/cancel branches preserve actual encrypted originals and source model.
for(const mode of ['password-cancel','chooser-cancel','filesystem-failure','late-edit']){
 const input=fs.readFileSync(path.join(native,'input-hwp.hwp')),d=HwpDocument.openWithPassword(input,inputPassword);
 try{
  const before=digest(d),e=exporter(d,'input-hwp.hwp'),file=path.join(q,mode+'.hwp');fs.writeFileSync(file,input);
  let writes=0,ui;const faulty=mode==='filesystem-failure'?storageWithFaults(require.resolve('../desktop/storage.cjs'),'write-and-close'):storage;
  const host=await bootHost(require.resolve('../desktop/main.cjs'),faulty,async()=>mode==='chooser-cancel'?{canceled:true}:(mode==='late-edit'?(ui.edit(),{canceled:false,filePath:file}):{canceled:false,filePath:file}));
  ui=await uiController((data,name,format)=>{writes++;return host.save(host.event,{data,name,format});},new Uint8Array(),{configureHost(h){h.requiresPasswordForSave=()=>true;h.exportForSave=(format,expected)=>exportHostDocumentForSave(e,format,()=>assert.equal(h.state().changeSeq,expected.changeSeq),async()=>mode==='password-cancel'?null:outputPassword);}});
  ui.get('format').value='hwp';await ui.get('save').onclick();assert.equal(ui.state().dirty,true);assert.equal(ui.notified.length,0);assert.equal(digest(d),before);
  if(mode==='password-cancel')assert.equal(writes,0);
  if(mode!=='late-edit')assert.equal(sha(fs.readFileSync(file)),sha(input));
  assert(!fs.readdirSync(q).some(n=>n.startsWith('.baram-')));checks.push({mode,dirtyPreserved:true,sourceModelPreserved:true,originalPreserved:mode!=='late-edit'});
 }finally{d.free();}
}
write('native-manifest.json',{schema:'geulgyeol-synthetic-encrypted-save-v1',rows});
write('proof.json',{syntheticOnly:true,actualHostUIFunction:true,actualHostIPCHandler:true,actualFilesystem:true,actualWASMSerializers:true,
 encryptedOutputs:rows.length,inputPins,rows:rows.map(({wasmSvg,...rest})=>rest),checks,engineSHA256:sha(fs.readFileSync(path.join(root,'pkg/rhwp_bg.wasm'))),
 ElectronExecuted:false,MacUIVerified:false,nativeChooserControlled:true,passwordsLogged:false,passwordsPassedToMainProcess:false});
console.log('PASS host encrypted save: 4 protected format pairs and 4 cancel/failure/version branches');

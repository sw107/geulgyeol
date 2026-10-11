import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {exportHostDocumentForSave} from '../../rhwp-studio/src/command/host-save-export.ts';
import {validateSavePassword} from '../../rhwp-studio/src/ui/save-password-validation.ts';
const require=createRequire(import.meta.url);
const {uiController}=require('../check-host-save.cjs');
const plain=Uint8Array.of(1),encrypted=Uint8Array.of(2);
const artifact=(format,bytes=encrypted,count=0)=>({bytes,contentLoss:{schemaVersion:1,outputFormat:format,count,losses:[]}});
const fixturePassword='QA-public-fixture-value';
function exporter(protectedDoc=true){
 const calls=[];return {calls,fileName:'synthetic.hwp',requiresPasswordForSave:protectedDoc,
  exportHwpWithReport(){calls.push('plain-hwp');return artifact('hwp',plain);},
  exportHwpxWithReport(){calls.push('plain-hwpx');return artifact('hwpx',plain);},
  exportHwpWithPasswordAndReport(p){assert.equal(p,fixturePassword);calls.push('protected-hwp');return artifact('hwp');},
  exportHwpxWithPasswordAndReport(p){assert.equal(p,fixturePassword);calls.push('protected-hwpx');return artifact('hwpx');}};
}
const gate=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
test('protected HWP/HWPX always select reported password serializers',async()=>{
 for(const format of ['hwp','hwpx']){const e=exporter();assert.deepEqual(await exportHostDocumentForSave(e,format,()=>{},async()=>fixturePassword),encrypted);assert.deepEqual(e.calls,['protected-'+format]);assert(e.requiresPasswordForSave);}
});
test('plain document does not request a password or change output format',async()=>{
 for(const format of ['hwp','hwpx']){const e=exporter(false);assert.deepEqual(await exportHostDocumentForSave(e,format,()=>{},async()=>{throw Error('unexpected prompt');}),plain);assert.deepEqual(e.calls,['plain-'+format]);}
});
test('cancel and short input never serialize; confirmation mismatch remains invalid',async()=>{
 const e=exporter();assert.equal(await exportHostDocumentForSave(e,'hwp',()=>{},async()=>null),null);assert.deepEqual(e.calls,[]);
 await assert.rejects(exportHostDocumentForSave(e,'hwp',()=>{},async()=>'x'),/5자/);assert.deepEqual(e.calls,[]);
 assert.equal(validateSavePassword(fixturePassword,'different-fixture'),'mismatch');assert.equal(validateSavePassword('x','x'),'short');assert.equal(validateSavePassword(fixturePassword,fixturePassword),null);
});
test('edit while password is pending fails before serialization',async()=>{
 const e=exporter(),g=gate();let version=1;const pending=exportHostDocumentForSave(e,'hwpx',()=>{if(version!==1)throw Error('stale document');},()=>g.promise);version=2;g.resolve(fixturePassword);await assert.rejects(pending,/stale/);assert.deepEqual(e.calls,[]);
});
test('protected serializer failure is sanitized and never falls back',async()=>{
 const e=exporter();e.exportHwpWithPasswordAndReport=()=>{throw Error('adapter failure '+fixturePassword);};
 await assert.rejects(exportHostDocumentForSave(e,'hwp',()=>{},async()=>fixturePassword),error=>!error.message.includes(fixturePassword)&&/암호화 저장/.test(error.message));assert.deepEqual(e.calls,[]);
});
test('content loss and invalid formats stop before any write',async()=>{
 const e=exporter();e.exportHwpxWithPasswordAndReport=()=>artifact('hwpx',encrypted,1);
 await assert.rejects(exportHostDocumentForSave(e,'hwpx',()=>{},async()=>fixturePassword),/보존/);
 await assert.rejects(exportHostDocumentForSave(e,'hml',()=>{},async()=>fixturePassword),/HWP/);assert.deepEqual(e.calls,[]);
});
test('actual host UI exposes only the password prompt and keeps duplicate save busy',async()=>{
 const g=gate(),e=exporter();let ui,writes=0;
 ui=await uiController(async bytes=>{writes++;assert.deepEqual(bytes,encrypted);return null;},plain,{configureHost(host,get){host.requiresPasswordForSave=()=>true;host.exportForSave=(format,expected)=>exportHostDocumentForSave(e,format,()=>assert.equal(host.state().changeSeq,expected.changeSeq),()=>{assert.equal(get('editor').inert,false);return g.promise;});}});
 const pending=ui.get('save').onclick();await new Promise(r=>setImmediate(r));assert.equal(ui.get('save').disabled,true);assert.equal(ui.get('editor').inert,false);await ui.get('save').onclick();assert.equal(writes,0);g.resolve(null);await pending;
 assert.equal(writes,0);assert.equal(ui.state().dirty,true);assert.deepEqual(ui.notified,[]);assert.equal(ui.get('editor').inert,false);assert.match(ui.get('status').textContent,/취소/);
});
test('actual host rejects a document version changed during export before IPC',async()=>{
 const g=gate();let ui,writes=0;ui=await uiController(async()=>{writes++;},plain,{configureHost(host){host.requiresPasswordForSave=()=>true;host.exportForSave=()=>g.promise;}});
 const pending=ui.get('save').onclick();await new Promise(r=>setImmediate(r));ui.edit();g.resolve(encrypted);await pending;assert.equal(writes,0);assert.equal(ui.state().dirty,true);assert.deepEqual(ui.notified,[]);assert.equal(ui.get('error-dialog').open,true);assert.equal(ui.get('editor').inert,false);
});
test('save chooser cancellation, filesystem failure and late edits preserve dirty state',async()=>{
 for(const outcome of ['cancel','error','late-edit','success']){
  let ui;ui=await uiController(async bytes=>{assert.deepEqual(bytes,encrypted);if(outcome==='error')throw Error('synthetic filesystem EIO');if(outcome==='cancel')return null;if(outcome==='late-edit')ui.edit();return {name:'encrypted.hwpx',size:bytes.length};},plain,{configureHost(host){host.requiresPasswordForSave=()=>true;host.exportForSave=async()=>encrypted;}});
  await ui.get('save').onclick();assert.equal(ui.state().dirty,outcome!=='success');assert.equal(ui.notified.length,outcome==='success'?1:0);assert.equal(ui.get('editor').inert,false);
 }
});

import puppeteer from '../rhwp-studio/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
import {launchPackaged} from './packaged-electron-qa.mjs';
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';import {createHash} from 'node:crypto';
const q=path.resolve(process.argv[2]),executable=path.resolve(process.argv[3]);
const engine=path.resolve(process.env.GEULGYEOL_QA_ENGINE_DIR);
const M=await import(pathToFileURL(path.join(engine,'rhwp.js')));M.initSync({module:fs.readFileSync(path.join(engine,'rhwp_bg.wasm'))});
const text=bytes=>{const doc=new M.HwpDocument(new Uint8Array(bytes));try{return JSON.parse(doc.getTextFileText());}finally{doc.free();}};
const sha=value=>createHash('sha256').update(value).digest('hex');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const write=(name,data)=>fs.writeFileSync(path.join(q,name),JSON.stringify(data,null,2));
const control=data=>write('control.json',data);
async function until(fn,label){const end=Date.now()+65000;while(Date.now()<end){if(await fn())return;await pause(50);}throw Error('Timeout '+label);}
const rows=[],processes=[];let p,b,page,frame,failure;
const audit=()=>fs.readFileSync(path.join(q,'audit.jsonl'),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
const add=(name,data={})=>{rows.push({name,...data});console.log('PASS '+name);write('progress.json',rows);};
async function attach(id){
  control({id,canceled:true});const launch=await launchPackaged(executable,q);p=launch.p;processes.push(p);
  b=await puppeteer.connect({browserWSEndpoint:launch.endpoint,defaultViewport:null,protocolTimeout:30000});
  await until(async()=>{page=(await b.pages()).find(page=>/^http:\/\/127\.0\.0\.1:\d+\/$/.test(page.url()));frame=page?.frames().find(frame=>frame.url().includes('/studio/'));return frame;},'packaged editor frame');
  return page.url();
}
async function ready(){await page.waitForFunction(()=>!document.querySelector('#save').disabled,{timeout:65000,polling:100});}
const bytes=()=>frame.evaluate(()=>{window.baramHost.export('hwp');return Array.from(window.baramHost.export('hwpx'));}).then(Buffer.from);
const drafts=()=>frame.evaluate(()=>new Promise((resolve,reject)=>{const req=indexedDB.open('rhwpStudioAutosave');req.onerror=()=>reject(req.error);req.onsuccess=()=>{const db=req.result;const get=db.transaction('drafts','readonly').objectStore('drafts').getAll();get.onerror=()=>{db.close();reject(get.error);};get.onsuccess=()=>{db.close();resolve(get.result.map(row=>({id:row.id,data:Array.from(new Uint8Array(row.data))})));};};}));
async function quit(plan){control(plan);await until(()=>p.exitCode!==null,'normal application quit');assert.equal(p.exitCode,0);b.disconnect();b=null;}
try{
  const originalOrigin=await attach('start');await ready();
  await frame.evaluate(()=>window.rhwpStudio.plugins.load('hwpctrl'));
  await frame.evaluate(()=>window.rhwpStudio.plugins.invoke('hwpctrl','invoke',['SetTextFile',['재실행 복구 한글🙂 · 사용자 원본 없는 합성 문서','TEXT','insertfile']]));
  let recovery;
  await until(async()=>{recovery=(await drafts()).find(row=>text(Buffer.from(row.data)).includes('재실행 복구 한글'));return recovery;},'real autosave recovery draft');
  fs.writeFileSync(path.join(q,'files/recovery-before-exit.hwp'),Buffer.from(recovery.data));
  add('actual packaged editor writes Korean synthetic text and a real IndexedDB recovery draft',{origin:originalOrigin,draftSHA256:sha(Buffer.from(recovery.data))});
  control({id:'crash',crashRenderer:true,unavailableChoice:'exit'});await until(()=>audit().some(row=>row.kind==='renderer-gone'),'controlled renderer crash');
  await quit({id:'exit-unavailable',close:true,unavailableChoice:'exit'});
  add('renderer crash followed by explicit unavailable-state exit quits normally and retains draft',{exitCode:p.exitCode});
  const reopenedOrigin=await attach('restart');assert.equal(reopenedOrigin,originalOrigin);
  await frame.waitForSelector('.recovery-dialog',{visible:true,timeout:65000});
  assert.equal(await page.$eval('#editor',element=>element.inert),false,'Startup recovery is interactive');
  assert((await drafts()).some(row=>sha(Buffer.from(row.data))===sha(Buffer.from(recovery.data))));
  await page.screenshot({path:path.join(q,'recovery-dialog.png')});
  add('cold restart uses the same origin and presents the persisted draft in the actual recovery dialog',{origin:reopenedOrigin});
  await frame.evaluate(()=>document.querySelector('.recovery-dialog .dialog-btn-primary').click());await ready();
  const restored=await bytes();assert.match(text(restored),/재실행 복구 한글/);assert(await frame.evaluate(()=>window.baramHost.state().dirty));
  assert((await drafts()).some(row=>row.id===recovery.id&&sha(Buffer.from(row.data))===sha(Buffer.from(recovery.data))));
  add('restore action loads the draft, leaves it dirty and preserves its durable copy until save');
  await frame.evaluate(()=>window.rhwpStudio.plugins.load('hwpctrl'));
  await frame.evaluate(()=>window.rhwpStudio.plugins.invoke('hwpctrl','invoke',['SetTextFile',[' 복구 뒤 추가 편집🙂','TEXT','insertfile']]));
  const expected=text(await bytes());
  control({id:'save-recovered',file:'recovered.hwpx'});await page.evaluate(()=>document.querySelector('#save').click());
  await until(async()=>!(await frame.evaluate(()=>window.baramHost.state().dirty)),'successful recovered save');
  assert.equal(text(fs.readFileSync(path.join(q,'files/recovered.hwpx'))),expected);
  await until(async()=>!(await drafts()).some(row=>row.id===recovery.id),'recovered draft cleanup after real save');
  await quit({id:'quit-clean',quit:true});
  add('restored and further edited document saves through real IPC and quits normally');
  assert.equal(await attach('reopen-saved'),originalOrigin);await ready();
  assert.equal(await frame.$('.recovery-dialog'),null,'Saved draft is cleared');
  control({id:'open-saved',openFile:'recovered.hwpx'});await page.evaluate(()=>document.querySelector('#open').click());
  await until(async()=>!await page.$eval('#save',element=>element.disabled)&&await page.$eval('#filename',element=>element.textContent.includes('recovered.hwpx')),'actual packaged file reopen');
  assert.equal(text(await bytes()),expected);await page.screenshot({path:path.join(q,'reopened-document.png')});
  await quit({id:'quit-reopened',quit:true});
  add('third actual application launch reopens the saved recovery result and exits normally');
  write('proof.json',{actualPackagedApp:true,executable,controlledNativeResponses:true,controlledRendererCrash:true,
    recoveryDialogDOMClick:true,OSChooserVerified:false,physicalIMEVerified:false,clipboardAccessed:false,
    rows,normalExitCodes:processes.map(process=>process.exitCode)});
}catch(error){failure=String(error);console.error(error);write('failure.json',{failure,stack:error.stack,rows});process.exitCode=1;}
finally{
  if(p?.exitCode===null){control({id:'finally',quit:true,choice:'discard',unavailableChoice:'exit'});await until(()=>p.exitCode!==null,'normal cleanup').catch(error=>{failure=String(error);process.exitCode=1;});}
  b?.disconnect();write('lifecycle.json',{failure,exitCodes:processes.map(process=>process.exitCode)});
}

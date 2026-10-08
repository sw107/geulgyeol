// Real packaged startup and IndexedDB; synthetic engine fixtures and explicit
// IDB fault injection. A second renderer crash occurs before the 10s debounce.
import puppeteer from '../rhwp-studio/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
import {launchPackaged} from './packaged-electron-qa.mjs';
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';import {createHash} from 'node:crypto';
const q=path.resolve(process.argv[2]),executable=path.resolve(process.argv[3]),scenario=process.argv[4],baseline=process.argv[5]==='baseline';
assert(['crash-again','delete-failure','later','clear-failure','select-many','replacement-failure','replacement-abort','replacement-success'].includes(scenario));
const engine=path.resolve(process.env.GEULGYEOL_QA_ENGINE_DIR),M=await import(pathToFileURL(path.join(engine,'rhwp.js')));
M.initSync({module:fs.readFileSync(path.join(engine,'rhwp_bg.wasm'))});
const text=data=>{const d=new M.HwpDocument(new Uint8Array(data));try{return JSON.parse(d.getTextFileText());}finally{d.free();}};
const sha=data=>createHash('sha256').update(Buffer.from(data)).digest('hex');
const pause=ms=>new Promise(r=>setTimeout(r,ms));const write=(n,v)=>fs.writeFileSync(path.join(q,n),JSON.stringify(v,null,2)),control=v=>write('control.json',v);
async function until(fn,label){const end=Date.now()+45000;while(Date.now()<end){if(await fn())return;await pause(30);}throw Error('Timeout '+label);}
const rows=[],processes=[];let p,b,page,frame,failure;let initialOrigin;
const add=(name,details={})=>{rows.push({name,...details});console.log('PASS '+name);write('progress.json',rows);};
const audit=()=>fs.readFileSync(path.join(q,'audit.jsonl'),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
async function attach(id){control({id,canceled:true});const launch=await launchPackaged(executable,q);p=launch.p;processes.push(p);b=await puppeteer.connect({browserWSEndpoint:launch.endpoint,defaultViewport:null,protocolTimeout:30000});
  await until(async()=>{page=(await b.pages()).find(v=>/^http:\/\/127\.0\.0\.1:\d+\/$/.test(v.url()));frame=page?.frames().find(v=>v.url().includes('/studio/'));return frame;},'packaged frame');
  if(initialOrigin)assert.equal(page.url(),initialOrigin);else initialOrigin=page.url();
}
async function ready(){await page.waitForFunction(()=>!document.querySelector('#save').disabled,{timeout:45000,polling:50});}
async function quit(id){control({id,quit:true,choice:'discard',unavailableChoice:'exit'});await until(()=>p.exitCode!==null,'normal quit');assert.equal(p.exitCode,0);b.disconnect();b=null;}
async function crash(id){control({id,crashRenderer:true});await until(()=>audit().some(row=>row.kind==='renderer-gone'&&row.at>crash.after),'renderer crash');await quit(id+'-exit');}
const state=()=>frame.evaluate(()=>window.baramHost.state());
const bytes=()=>frame.evaluate(()=>Array.from(window.baramHost.export('hwp')));
const drafts=()=>frame.evaluate(()=>new Promise((resolve,reject)=>{const req=indexedDB.open('rhwpStudioAutosave');req.onerror=()=>reject(req.error);req.onsuccess=()=>{const db=req.result;const get=db.transaction('drafts','readonly').objectStore('drafts').getAll();get.onerror=()=>{db.close();reject(get.error);};get.onsuccess=()=>{db.close();resolve(get.result.map(row=>({...row,data:Array.from(new Uint8Array(row.data))})));};};}));
const restore=()=>frame.evaluate(()=>document.querySelector('.recovery-dialog .dialog-btn-primary').click());
async function dialog(){await frame.waitForSelector('.recovery-dialog',{visible:true,timeout:45000});assert(!await page.$eval('#editor',e=>e.inert));}
function fixture(id,message,age){const d=M.HwpDocument.createEmpty();try{d.createBlankDocument();assert(JSON.parse(d.insertText(0,0,0,message)).ok);const data=Array.from(d.exportHwp());return {id,fileName:id+'.hwp',sourceFormat:'hwp',savedAt:Date.now()-age,byteLength:data.length,data,dirtyReason:'qa-synthetic-fixture'};}finally{d.free();}}
const fixtures=[fixture('qa-recovery-A','보존 복구 A 한글🙂',3000),fixture('qa-recovery-B','선택 복구 B 다른 한글🙂',2000),fixture('qa-recovery-C','선택 복구 C 최신 한글🙂',1000)];
const fingerprints=rows=>Object.fromEntries(rows.map(row=>[row.id,sha(row.data)]));
try{
  await attach('seed');await ready();
  const seeded=(scenario==='replacement-failure'||scenario==='replacement-abort')?[fixtures[0],...Array.from({length:12},(_,i)=>fixture('qa-extra-'+i,'기존 복구 '+i,100+i*50))]:scenario==='select-many'||scenario==='clear-failure'?fixtures:[fixtures[0]];
  await frame.evaluate(rows=>new Promise((resolve,reject)=>{const req=indexedDB.open('rhwpStudioAutosave');req.onerror=()=>reject(req.error);req.onsuccess=()=>{const db=req.result,tx=db.transaction('drafts','readwrite');for(const row of rows)tx.objectStore('drafts').put({...row,data:new Uint8Array(row.data).buffer});tx.oncomplete=()=>{db.close();resolve();};tx.onabort=()=>{db.close();reject(tx.error);};};}),seeded);
  assert.deepEqual(fingerprints(await drafts()),fingerprints(seeded));await quit('seed-close');
  await attach('offer');await dialog();
  if(scenario==='later'){
    await frame.evaluate(()=>[...document.querySelectorAll('.recovery-dialog button')].find(e=>e.textContent==='나중에').click());await ready();
    assert(!(await state()).dirty);assert(!text(await bytes()).includes('보존 복구'));assert.deepEqual(fingerprints(await drafts()),fingerprints(seeded));await quit('later-clean-close');
    await attach('offer-again');await dialog();assert.deepEqual(fingerprints(await drafts()),fingerprints(seeded));add('later leaves all draft bytes intact across clean close and restart');
    await restore();await ready();
  }else if(scenario==='clear-failure'){
    await frame.evaluate(()=>{window.qaClearOriginal=IDBObjectStore.prototype.clear;window.qaClearFailed=false;IDBObjectStore.prototype.clear=function(...args){if(this.name==='drafts'){window.qaClearFailed=true;throw Error('QA controlled draft clear failure');}return window.qaClearOriginal.apply(this,args);};});
    await frame.evaluate(()=>[...document.querySelectorAll('.recovery-dialog button')].find(e=>e.textContent==='삭제').click());await ready();
    assert(await frame.evaluate(()=>window.qaClearFailed));assert.deepEqual(fingerprints(await drafts()),fingerprints(seeded));assert(!(await state()).dirty);
    if(!baseline)await until(()=>frame.evaluate(()=>document.body.textContent.includes('복구 후보를 삭제하지 못했습니다')),'visible cleanup failure');
    await frame.evaluate(()=>IDBObjectStore.prototype.clear=window.qaClearOriginal);await quit('clear-failure-close');await attach('after-clear-failure');await dialog();
    assert.deepEqual(fingerprints(await drafts()),fingerprints(seeded));add('failed delete-all retains every draft and next startup offers them again');
    await frame.evaluate(()=>[...document.querySelectorAll('.recovery-dialog button')].find(e=>e.textContent==='삭제').click());await ready();assert.equal((await drafts()).length,0);await quit('clear-retry-close');await attach('after-clear-retry');await ready();assert.equal(await frame.$('.recovery-dialog'),null);add('successful delete-all retry clears only the private profile drafts');
  }else{
    if(scenario==='select-many'||(scenario==='replacement-failure'||scenario==='replacement-abort')){
      await frame.evaluate(scenario=>{const input=document.querySelector('.recovery-dialog input[value="'+(scenario==='select-many'?'qa-recovery-B':'qa-recovery-A')+'"]');input.checked=true;input.dispatchEvent(new Event('change',{bubbles:true}));},scenario);
    }
    if(scenario==='delete-failure')await frame.evaluate(()=>{window.qaDeleteOriginal=IDBObjectStore.prototype.delete;window.qaDeleteAttempts=[];IDBObjectStore.prototype.delete=function(id,...args){window.qaDeleteAttempts.push(id);if(this.name==='drafts'&&id==='qa-recovery-A')throw Error('QA controlled recovered draft deletion failure');return window.qaDeleteOriginal.call(this,id,...args);};});
    const restoreStarted=Date.now();await restore();await ready();const recoveredState=await state();const recoveredText=text(await bytes());
    const selected=scenario==='select-many'?fixtures[1]:fixtures[0];assert.equal(recoveredText,text(selected.data));
    const currentRows=await drafts();
    if(baseline){
      if(scenario==='crash-again'){assert(recoveredState.dirty);assert.equal(currentRows.length,0);add('baseline deletes the only durable draft immediately after restore',{dirty:true,rows:currentRows.length});crash.after=Date.now();await crash('second-crash');await attach('after-second-crash');await ready();assert.equal(await frame.$('.recovery-dialog'),null);assert(!text(await bytes()).includes('보존 복구'));add('baseline second crash before debounce permanently loses recovered document');}
      else{assert(!recoveredState.dirty);assert.equal(sha(currentRows[0].data),sha(selected.data));assert((await frame.evaluate(()=>window.qaDeleteAttempts)).includes(selected.id));add('baseline deletion failure leaves successfully loaded recovery document clean',{state:recoveredState});await frame.evaluate(()=>IDBObjectStore.prototype.delete=window.qaDeleteOriginal);}
    }else{
      assert(recoveredState.dirty);assert.deepEqual(fingerprints(currentRows),fingerprints(seeded));add('restored document is dirty and all original durable draft bytes remain',{scenario,state:recoveredState});
      if(scenario==='delete-failure'){assert(!(await frame.evaluate(()=>window.qaDeleteAttempts)).includes(selected.id));await frame.evaluate(()=>IDBObjectStore.prototype.delete=window.qaDeleteOriginal);add('restoration does not call the failing selected-draft deletion API');}
      if(scenario==='crash-again'){
        assert(Date.now()-restoreStarted<10000,'Second crash must precede the default idle autosave');crash.after=Date.now();await crash('second-crash');await attach('after-second-crash');await dialog();assert.deepEqual(fingerprints(await drafts()),fingerprints(seeded));await restore();await ready();assert.equal(text(await bytes()),text(selected.data));assert((await state()).dirty);add('second crash before debounce survives restart and restores the same persisted document');
      }
      let expectedText=text(selected.data);
      if(scenario==='replacement-failure'||scenario==='replacement-abort'){
        await frame.evaluate(scenario=>{window.qaPutOriginal=IDBObjectStore.prototype.put;window.qaPutFailed=false;IDBObjectStore.prototype.put=function(row,...args){if(this.name==='drafts'&&row.id==='qa-recovery-A'){window.qaPutFailed=true;if(scenario==='replacement-abort'){const request=window.qaPutOriginal.call(this,row,...args);this.transaction.abort();return request;}throw Error('QA controlled replacement put failure');}return window.qaPutOriginal.call(this,row,...args);};},scenario);
        await until(()=>frame.evaluate(()=>window.qaPutFailed),'real idle autosave put failure');
        assert.deepEqual(fingerprints(await drafts()),fingerprints(seeded));assert((await state()).dirty);
        await frame.evaluate(()=>IDBObjectStore.prototype.put=window.qaPutOriginal);
        add('failed replacement of oldest recovered draft preserves all thirteen durable rows before pruning',{fault:scenario==='replacement-abort'?'real IDB transaction aborted after put':'controlled put API rejection'});
      }
      if(scenario==='replacement-success'){
        await frame.evaluate(()=>window.rhwpStudio.plugins.load('hwpctrl'));
        await frame.evaluate(()=>window.rhwpStudio.plugins.invoke('hwpctrl','invoke',['SetTextFile',['대체본 영속화 추가 한글🙂','TEXT','insertfile']]));
        expectedText=text(await bytes());
        await until(async()=>{const row=(await drafts()).find(row=>row.id===selected.id);return row&&text(row.data)===expectedText;},'real replacement transaction commit');
        assert.equal((await drafts()).length,1);crash.after=Date.now();await crash('replacement-crash');await attach('after-replacement-crash');await dialog();await restore();await ready();assert.equal(text(await bytes()),expectedText);assert((await state()).dirty);
        add('committed replacement keeps the same draft ID and survives crash with the latest edits');
      }
      // Real native save removes only the adopted selected ID after durable write.
      control({id:'save-recovered',file:'recovered.hwp'});await page.select('#format','hwp');await page.evaluate(()=>document.querySelector('#save').click());await until(async()=>!(await state()).dirty,'real recovered save');
      assert.equal(text(fs.readFileSync(path.join(q,'files/recovered.hwp'))),expectedText);await until(async()=>!(await drafts()).some(row=>row.id===selected.id),'selected draft cleanup after real save');
      const remaining=seeded.filter(row=>row.id!==selected.id);assert.deepEqual(fingerprints(await drafts()),fingerprints(remaining));add('real save persists recovered text then deletes only its adopted draft',{selectedID:selected.id,remainingIDs:remaining.map(row=>row.id)});
    }
  }
  await quit('finished');write('proof.json',{scenario,baseline,actualPackagedApp:true,syntheticFixturesInRealIndexedDB:true,controlledNativeResponses:true,controlledRendererCrash:scenario==='crash-again',controlledIDBFault:['delete-failure','clear-failure','replacement-failure','replacement-abort'].includes(scenario),OSChooserVerified:false,physicalIMEVerified:false,manualGUIVerified:false,clipboardAccessed:false,rows,normalExitCodes:processes.map(v=>v.exitCode)});
}catch(error){failure=String(error);console.error(error);write('failure.json',{failure,stack:error.stack,rows});process.exitCode=1;}
finally{if(p?.exitCode===null){await quit('finally').catch(error=>{failure=String(error);process.exitCode=1;});}b?.disconnect();write('lifecycle.json',{failure,exitCodes:processes.map(v=>v.exitCode)});}

// Stored future timestamps simulate clock rollback without changing OS clocks.
// Transaction faults occur in the actual packaged renderer's IndexedDB.
import puppeteer from '../rhwp-studio/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
import {launchPackaged} from './packaged-electron-qa.mjs';
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';import {createHash} from 'node:crypto';
const q=path.resolve(process.argv[2]),executable=path.resolve(process.argv[3]),scenario=process.argv[4],baseline=process.argv[5]==='baseline';
assert(['future-timestamps','query-failure','query-abort','delete-failure','delete-abort'].includes(scenario));
const engine=path.resolve(process.env.GEULGYEOL_QA_ENGINE_DIR),M=await import(pathToFileURL(path.join(engine,'rhwp.js')));M.initSync({module:fs.readFileSync(path.join(engine,'rhwp_bg.wasm'))});
const text=data=>{const d=new M.HwpDocument(new Uint8Array(data));try{return JSON.parse(d.getTextFileText());}finally{d.free();}};
const sha=data=>createHash('sha256').update(Buffer.from(data)).digest('hex'),pause=ms=>new Promise(r=>setTimeout(r,ms));
const write=(name,data)=>fs.writeFileSync(path.join(q,name),JSON.stringify(data,null,2)),control=data=>write('control.json',data);
async function until(fn,label){const end=Date.now()+45000;while(Date.now()<end){if(await fn())return;await pause(30);}throw Error('Timeout '+label);}
const rows=[],processes=[];let p,b,page,frame,failure,origin;
const add=(name,details={})=>{rows.push({name,...details});console.log('PASS '+name);write('progress.json',rows);};
const audit=()=>fs.readFileSync(path.join(q,'audit.jsonl'),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
async function attach(id){control({id,canceled:true});const launch=await launchPackaged(executable,q);p=launch.p;processes.push(p);b=await puppeteer.connect({browserWSEndpoint:launch.endpoint,defaultViewport:null});await until(async()=>{page=(await b.pages()).find(v=>/^http:\/\/127\.0\.0\.1:\d+\/$/.test(v.url()));frame=page?.frames().find(v=>v.url().includes('/studio/'));return frame;},'frame');if(origin)assert.equal(page.url(),origin);else origin=page.url();}
async function ready(){await page.waitForFunction(()=>!document.querySelector('#save').disabled,{timeout:45000,polling:50});}
async function quit(id){control({id,quit:true,choice:'discard',unavailableChoice:'exit'});await until(()=>p.exitCode!==null,'normal quit');assert.equal(p.exitCode,0);b.disconnect();b=null;}
async function crash(){const start=Date.now();control({id:'crash',crashRenderer:true});await until(()=>audit().some(row=>row.kind==='renderer-gone'&&row.at>=start),'renderer crash');await quit('crash-exit');}
async function dialog(){await frame.waitForSelector('.recovery-dialog',{visible:true,timeout:45000});}
const state=()=>frame.evaluate(()=>window.baramHost.state());
const bytes=()=>frame.evaluate(()=>Array.from(window.baramHost.export('hwp')));
const drafts=()=>frame.evaluate(()=>new Promise((resolve,reject)=>{const req=indexedDB.open('rhwpStudioAutosave');req.onerror=()=>reject(req.error);req.onsuccess=()=>{const db=req.result,get=db.transaction('drafts','readonly').objectStore('drafts').getAll();get.onerror=()=>{db.close();reject(get.error);};get.onsuccess=()=>{db.close();resolve(get.result.map(row=>({...row,data:Array.from(new Uint8Array(row.data))})));};};}));
async function chooseActive(){await frame.evaluate(()=>{const input=document.querySelector('.recovery-dialog input[value="qa-active"]');input.checked=true;input.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('.recovery-dialog .dialog-btn-primary').click();});await ready();}
function fixture(id,message,savedAt){const d=M.HwpDocument.createEmpty();try{d.createBlankDocument();assert(JSON.parse(d.insertText(0,0,0,message)).ok);const data=Array.from(d.exportHwp());return {id,fileName:id+'.hwp',sourceFormat:'hwp',savedAt,byteLength:data.length,data};}finally{d.free();}}
const active=fixture('qa-active','현재 복구 문서 한글🙂',Date.now()-1000),future=Array.from({length:scenario.startsWith('delete-')?13:12},(_,i)=>fixture('qa-future-'+i,'미래 시각 복구 '+i,Date.now()+365*86400000+i*1000));
const fingerprints=items=>Object.fromEntries(items.map(row=>[row.id,sha(row.data)]));
try{
  await attach('seed');await ready();const seeded=[active,...future];
  await frame.evaluate(items=>new Promise((resolve,reject)=>{const req=indexedDB.open('rhwpStudioAutosave');req.onerror=()=>reject(req.error);req.onsuccess=()=>{const db=req.result,tx=db.transaction('drafts','readwrite');for(const item of items)tx.objectStore('drafts').put({...item,data:new Uint8Array(item.data).buffer});tx.oncomplete=()=>{db.close();resolve();};tx.onabort=()=>{db.close();reject(tx.error);};};}),seeded);
  assert.deepEqual(fingerprints(await drafts()),fingerprints(seeded));await quit('seed-close');await attach('restore');await dialog();await chooseActive();assert((await state()).dirty);
  await frame.evaluate(scenario=>{
    window.qaPruneOriginal={put:IDBObjectStore.prototype.put,getAll:IDBObjectStore.prototype.getAll,delete:IDBObjectStore.prototype.delete};
    window.qaPutCommitted=false;window.qaPruneArmed=false;window.qaPruneFault=false;window.qaPruneDeletes=[];
    IDBObjectStore.prototype.put=function(row,...args){const result=window.qaPruneOriginal.put.call(this,row,...args);if(this.name==='drafts'&&row.id==='qa-active')this.transaction.addEventListener('complete',()=>{window.qaPutCommitted=true;window.qaPruneArmed=true;},{once:true});return result;};
    IDBObjectStore.prototype.getAll=function(...args){
      if(this.name==='drafts'&&window.qaPruneArmed&&scenario.startsWith('query-')){
        window.qaPruneArmed=false;window.qaPruneFault=true;
        if(scenario==='query-failure')throw Error('QA controlled pruning lookup failure');
        const result=window.qaPruneOriginal.getAll.apply(this,args),tx=this.transaction;
        result.addEventListener('success',()=>tx.abort(),{once:true});return result;
      }
      return window.qaPruneOriginal.getAll.apply(this,args);
    };
    IDBObjectStore.prototype.delete=function(id,...args){
      if(this.name==='drafts')window.qaPruneDeletes.push(id);
      if(this.name==='drafts'&&window.qaPruneArmed&&id==='qa-future-1'&&scenario.startsWith('delete-')){
        window.qaPruneArmed=false;window.qaPruneFault=true;
        if(scenario==='delete-failure')throw Error('QA controlled pruning delete failure');
        const result=window.qaPruneOriginal.delete.call(this,id,...args),tx=this.transaction;
        result.addEventListener('success',()=>tx.abort(),{once:true});return result;
      }
      return window.qaPruneOriginal.delete.call(this,id,...args);
    };
  },scenario);
  await frame.evaluate(()=>window.rhwpStudio.plugins.load('hwpctrl'));await frame.evaluate(()=>window.rhwpStudio.plugins.invoke('hwpctrl','invoke',['SetTextFile',['교체 저장 최신 한글🙂','TEXT','insertfile']]));
  const expectedText=text(await bytes());await until(()=>frame.evaluate(()=>window.qaPutCommitted),'actual replacement commit');
  if(baseline){
    await until(async()=>!(await drafts()).some(row=>row.id===active.id),'baseline active draft pruned');assert((await state()).dirty);
    const after=await drafts();assert.equal(after.length,12);assert.deepEqual(fingerprints(after),fingerprints(future));assert((await frame.evaluate(()=>window.qaPruneDeletes)).includes(active.id));add('baseline prunes the newly committed active ID when twelve other timestamps are future',{activeID:active.id,futureRows:12});
    await crash();await attach('after-crash');await dialog();assert(!(await drafts()).some(row=>row.id===active.id));
    await frame.evaluate(()=>[...document.querySelectorAll('.recovery-dialog button')].find(v=>v.textContent==='나중에').click());await ready();assert.notEqual(text(await bytes()),expectedText);add('baseline restart has only future drafts and loses the latest active replacement');
  }else{
    if(scenario==='future-timestamps')await until(async()=>(await drafts()).length===12,'successful pruning');else await until(()=>frame.evaluate(()=>window.qaPruneFault),'controlled pruning transaction fault');
    if(scenario.startsWith('query-'))assert.deepEqual(await frame.evaluate(()=>window.qaPruneDeletes),[],'Failed lookup must not start pruning');
    const after=await drafts(),saved=after.find(row=>row.id===active.id);assert(saved);assert.equal(text(saved.data),expectedText);assert((await state()).dirty);
    assert(!(await frame.evaluate(()=>window.qaPruneDeletes)).includes(active.id));
    const others=scenario==='future-timestamps'?future.slice(1):future;assert.deepEqual(fingerprints(after.filter(row=>row.id!==active.id)),fingerprints(others));
    add('replacement remains durable and active ID is never a pruning target',{scenario,rows:after.length,protectedID:active.id,fault:scenario==='future-timestamps'?null:scenario});
    await frame.evaluate(()=>{for(const [name,fn] of Object.entries(window.qaPruneOriginal))IDBObjectStore.prototype[name]=fn;});
    await crash();await attach('after-crash');await dialog();const persisted=await drafts();assert.equal(text(persisted.find(row=>row.id===active.id).data),expectedText);assert.deepEqual(fingerprints(persisted.filter(row=>row.id!==active.id)),fingerprints(others));
    await chooseActive();assert.equal(text(await bytes()),expectedText);assert((await state()).dirty);add('crash and restart recover the committed latest active document despite future timestamps or pruning failure');
    control({id:'save',file:'latest.hwp'});await page.select('#format','hwp');await page.evaluate(()=>document.querySelector('#save').click());await until(async()=>!(await state()).dirty,'real file save');assert.equal(text(fs.readFileSync(path.join(q,'files/latest.hwp'))),expectedText);await until(async()=>!(await drafts()).some(row=>row.id===active.id),'selected ID cleanup');assert.deepEqual(fingerprints(await drafts()),fingerprints(others));add('real native save persists latest text and cleans only the recovered active ID');
  }
  await quit('finished');write('proof.json',{scenario,baseline,actualPackagedApp:true,futureTimestampRows:future.length,OSClockChanged:false,realReplacementPutCommitted:true,queryAbortAfterRequestSuccess:scenario==='query-abort',deleteAbortAfterRequestSuccess:scenario==='delete-abort',controlledNativeResponses:true,controlledRendererCrash:true,OSChooserVerified:false,physicalIMEVerified:false,manualGUIVerified:false,clipboardAccessed:false,rows,normalExitCodes:processes.map(v=>v.exitCode)});
}catch(error){failure=String(error);console.error(error);write('failure.json',{failure,stack:error.stack,rows});process.exitCode=1;}
finally{
  if(p?.exitCode===null){if(frame)await frame.evaluate(()=>[...document.querySelectorAll('.recovery-dialog button')].find(v=>v.textContent==='나중에')?.click()).catch(()=>{});await quit('finally').catch(error=>{failure=String(error);process.exitCode=1;});}b?.disconnect();write('lifecycle.json',{failure,exitCodes:processes.map(v=>v.exitCode)});
}

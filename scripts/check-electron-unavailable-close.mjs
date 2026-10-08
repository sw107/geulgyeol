// Real isolated Electron. Controlled startup exception, JS failure or renderer crash.
// Only this suite's window is closed; native warning responses are controlled.
import puppeteer from '../rhwp-studio/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
const root=path.resolve(import.meta.dirname,'..'),q=path.resolve(process.argv[2]),mode=process.argv[3];
assert(['startup','javascript','crash'].includes(mode));
assert(!fs.existsSync(path.join(q,'audit.jsonl'))&&!fs.existsSync(path.join(q,'app-data')),'Fresh dedicated QA directory required');
for(const rel of ['main.cjs','preload.cjs','close-controller.cjs','web/baram.js'])assert.deepEqual(fs.readFileSync(path.join(q,'runtime',rel)),fs.readFileSync(path.join(root,'desktop',rel)));
const sha=b=>createHash('sha256').update(b).digest('hex');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const write=(n,v)=>fs.writeFileSync(path.join(q,n),JSON.stringify(v,null,2));
const control=v=>write('control.json',v);
const audit=()=>fs.existsSync(path.join(q,'audit.jsonl'))?fs.readFileSync(path.join(q,'audit.jsonl'),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[];
async function until(f,label){const deadline=Date.now()+65000;while(Date.now()<deadline){if(await f())return;await pause(50);}throw Error('Timeout '+label);}
let p,b,page,failure,normalQuit=false;
const rows=[];
try{
  control({id:'start'});const env={...process.env,GEULGYEOL_ELECTRON_MODULE:'electron',GEULGYEOL_QA_DIR:q};delete env.ELECTRON_RUN_AS_NODE;
  p=spawn(path.join(root,'desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),[path.join(q,'bootstrap.cjs'),'--remote-debugging-port=0','--remote-debugging-address=127.0.0.1'],{env});
  let log='',endpoint;for(const stream of [p.stdout,p.stderr])stream.on('data',d=>{log+=d;fs.appendFileSync(path.join(q,'launch.log'),d);});
  await until(()=>endpoint=log.match(/DevTools listening on (ws:\/\/\S+)/)?.[1],'endpoint');
  b=await puppeteer.connect({browserWSEndpoint:endpoint,defaultViewport:null,protocolTimeout:30000});
  await until(async()=>{page=(await b.pages()).find(p=>/^http:\/\/127\.0\.0\.1:\d+\/$/.test(p.url()));return page;},'window');
  if(mode==='startup'){
    await page.waitForFunction(()=>document.querySelector('#error-dialog').open,{timeout:60000,polling:100});
    assert.match(await page.$eval('#error-text',e=>e.textContent),/QA controlled permanent SDK initialization failure/);
    assert(await page.$eval('#save',e=>e.disabled));rows.push({name:'startup failure keeps file actions disabled'});
  }else{
    await page.waitForFunction(()=>!document.querySelector('#save').disabled,{timeout:60000,polling:100});
    const frame=page.frames().find(f=>f.url().includes('/studio/'));
    await page.evaluate(()=>document.querySelector('#new').click());
    await page.waitForFunction(()=>!document.querySelector('#save').disabled,{timeout:60000,polling:100});
    await frame.evaluate(async()=>{await window.rhwpStudio.plugins.load('hwpctrl');window.rhwpStudio.plugins.invoke('hwpctrl','invoke',['SetTextFile',['장애 전 합성 복구 문서🙂','TEXT','insertfile']]);});
    let draft;
    await until(async()=>{draft=await frame.evaluate(()=>new Promise((resolve,reject)=>{const r=indexedDB.open('rhwpStudioAutosave');r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result,get=db.transaction('drafts','readonly').objectStore('drafts').getAll();get.onerror=()=>{db.close();reject(get.error);};get.onsuccess=()=>{db.close();resolve(get.result.map(v=>({id:v.id,data:Array.from(new Uint8Array(v.data))})));};};}));return draft.length>0;},'real recovery draft');
    fs.writeFileSync(path.join(q,'files/recovery-before-failure.hwp'),Buffer.from(draft[0].data));
    rows.push({name:'actual IndexedDB draft exists before failure',id:draft[0].id,SHA256:sha(Buffer.from(draft[0].data))});
    if(mode==='javascript')await page.evaluate(()=>{window.baramPrepareClose=()=>{throw new Error('QA controlled renderer JavaScript failure');};});
    else{control({id:'crash',crashRenderer:true});await until(()=>audit().some(e=>e.kind==='renderer-gone'),'renderer crash');}
  }
  const evalCount=audit().filter(e=>e.kind==='renderer-evaluate').length;
  control({id:'cancel-close',close:true,duplicateClose:true,choice:'cancel'});
  await until(()=>audit().some(e=>e.kind==='close-confirmation'&&e.plan==='cancel-close'),'unavailable warning');await pause(250);
  assert.equal(p.exitCode,null);
  const warning=audit().find(e=>e.kind==='close-confirmation'&&e.plan==='cancel-close').options;
  assert.deepEqual(warning.buttons,['취소','종료']);assert.equal(warning.cancelId,0);assert.equal(warning.defaultId,0);
  assert.match(warning.detail,/복구본은 삭제하지 않습니다/);
  assert.equal(audit().filter(e=>e.kind==='close-confirmation'&&e.plan==='cancel-close').length,1);
  if(mode==='crash')assert.equal(audit().filter(e=>e.kind==='renderer-evaluate').length,evalCount,'crashed renderer never runs recovery cleanup');
  rows.push({name:'explicit warning cancel retains window; duplicate requests prompt once',warning});
  control({id:'exit-close',close:true,choice:'exit'});
  await until(()=>p.exitCode!==null,'explicit unavailable exit');assert.equal(p.exitCode,0);
  rows.push({name:'explicit warning exit closes normally without successful-save claim'});
  write('proof.json',{mode,actualElectron:true,controlledNativeResponses:true,OSChooserVerified:false,rows});
  console.log(JSON.stringify(rows));
}catch(e){failure=String(e);write('failure.json',{failure,stack:e.stack,rows});console.error(e);process.exitCode=1;}
finally{
  if(p?.exitCode===null){control({id:'quit',quit:true,choice:'exit'});try{await until(()=>p.exitCode!==null,'normal close');}catch(e){failure=failure||String(e);}}
  normalQuit=p?.exitCode===0;b?.disconnect();write('lifecycle.json',{normalQuit,exitCode:p?.exitCode,failure});if(!normalQuit)process.exitCode=1;
}

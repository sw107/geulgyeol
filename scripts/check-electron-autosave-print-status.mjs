// Actual Mac Electron/HWP/WASM autosave/print status regression. Synthetic inputs only.
// Faults affect only this owned QA app. OS window.print is blocked.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
const root=process.env.GEULGYEOL_QA_SOURCE_ROOT||path.resolve(import.meta.dirname,'..');
const {finishOwnedQA}=await import(path.join(root,'scripts/electron-qa-exit.mjs'));
const {default:puppeteer}=await import(path.join(root,'rhwp-studio/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js'));
const {EvidenceBudget}=await import(path.join(root,'scripts/qa-evidence-budget.mjs'));
const q=path.resolve(process.argv[2]),mode=process.argv[3]||'fixed';
assert(['baseline','fixed'].includes(mode));
const phase=path.dirname(q),budgetRoot=path.resolve(process.env.GEULGYEOL_QA_BUDGET_ROOT);
const budget=new EvidenceBudget({root:budgetRoot,phase});
assert.equal(JSON.parse(fs.readFileSync(path.join(phase,'qa-evidence-status.json'))).outcome,'running');
budget.started=true; budget.check();
assert(!fs.existsSync(path.join(q,'audit.jsonl')),'fresh source-QA run required');
const sha=b=>createHash('sha256').update(b).digest('hex');
const write=(n,v)=>fs.writeFileSync(path.join(q,n),JSON.stringify(v,null,2));
const control=v=>write('control.json',v),pause=ms=>new Promise(r=>setTimeout(r,ms));
const audit=()=>fs.existsSync(path.join(q,'audit.jsonl'))?fs.readFileSync(path.join(q,'audit.jsonl'),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[];
let p,b,page,frame,failure,normalQuit=false,budgetError,monitor,exitOutcome;
const rows=[],dialogs=[],errors=[],nativeStages={};
let blockedOSPrintCalls=0;
const consoleEvents=[];
let readyEvents=0;
async function until(fn,label,timeout=30000){const end=Date.now()+timeout;while(Date.now()<end){if(budgetError)throw budgetError;if(await fn())return;await pause(50);}throw Error('Timeout '+label);}
const command=id=>frame.evaluate(id=>window.rhwpStudio.automation.execute(id,undefined,{allowDialog:true}),id);
async function settle(){await until(()=>frame.evaluate(()=>!window.__inputHandler.hasDeferredPaginationPending()),'pagination idle');await pause(100);}
async function state(){
 const s=await frame.evaluate(()=>{const w=window.__wasm,h=window.__inputHandler;window.baramHost.export('hwp');return {host:window.baramHost.state(),pages:w.pageCount,text:w.doc.getTextFileText(),svg:Array.from({length:w.pageCount},(_,i)=>w.renderPageSvg(i)),printSvg:Array.from({length:w.pageCount},(_,i)=>w.renderPageSvgWithProfile(i,'print')),hwp:Array.from(window.baramHost.export('hwp')),hwpx:Array.from(window.baramHost.export('hwpx')),history:{u:h.history.undoStack.length,r:h.history.redoStack.length},pending:h.hasDeferredPaginationPending()};});
 for(const ext of ['hwp','hwpx'])s[ext]=sha(Buffer.from(s[ext]));
 s.svg=s.svg.map(sha);s.printSvg=s.printSvg.map(sha);return s;
}
const preserved=async before=>assert.deepEqual(await state(),before,'complete bytes, SVG, text, dirty state and history preserved');
const previewPages=async()=>Promise.all((await b.pages()).filter(x=>x.url().endsWith('/studio/print.html')));
async function preview(){assert((await command('file:print')).ok);let child;await until(async()=>{child=(await previewPages())[0];return child&&await child.evaluate(()=>!!document.querySelector('#close-btn')&&document.querySelectorAll('.page').length===2);},'two-page preview');return child;}
try{
 assert.equal(process.platform,'darwin');
 for(const rel of ['main.cjs','preload.cjs','close-controller.cjs','web/baram.js',...(mode==='fixed'?['print-preview.cjs']:[])])assert.deepEqual(fs.readFileSync(path.join(q,'runtime',rel)),fs.readFileSync(path.join(root,'desktop',rel)));
 const fixtures=path.resolve(process.env.GEULGYEOL_QA_PRINT_FIXTURES);
 const pins=JSON.parse(fs.readFileSync(path.join(fixtures,'fixture-proof.json')));
 assert(pins.synthetic&&pins.expectedPages===2);
 for(const ext of ['hwp','hwpx']){const bytes=fs.readFileSync(path.join(fixtures,'print-input.'+ext));assert.equal(sha(bytes),pins.filesSHA256[ext]);fs.writeFileSync(path.join(q,'files','print-input.'+ext),bytes);}
 control({id:'start',canceled:true});
 const env={...process.env,GEULGYEOL_ELECTRON_MODULE:'electron',GEULGYEOL_QA_DIR:q};delete env.ELECTRON_RUN_AS_NODE;
 p=spawn(path.join(root,'desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),[path.join(q,'bootstrap.cjs'),'--remote-debugging-port=0','--remote-debugging-address=127.0.0.1','--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows'],{env});
 monitor=setInterval(()=>{try{budget.check();}catch(e){budgetError=e;control({id:'budget-stop-owned-QA',quit:true,choice:'cancel'});}},1000);
 let log='';for(const s of [p.stdout,p.stderr])s.on('data',d=>{log+=d;fs.appendFileSync(path.join(q,'launch.log'),d);});
 await until(()=>{if(p.exitCode!==null)throw Error('app exited '+p.exitCode);return /DevTools listening on (ws:\/\/\S+)/.test(log);},'CDP');
 b=await puppeteer.connect({browserWSEndpoint:log.match(/DevTools listening on (ws:\/\/\S+)/)[1],defaultViewport:null});
 await until(async()=>{page=(await b.pages()).find(x=>/^http:\/\/127\.0\.0\.1:\d+\/$/.test(x.url()));frame=page?.frames().find(f=>f.url().includes('/studio/'));return frame;},'app');
 page.on('console',m=>{const text=m.text();consoleEvents.push(text);if(text==='QA_OS_PRINT_BLOCKED')blockedOSPrintCalls++;if(text.startsWith('[file:print] 인쇄 미리보기 준비 완료'))readyEvents++;});
 page.on('dialog',d=>{dialogs.push(d.message());d.dismiss().catch(e=>{if(!String(e).includes('No dialog is showing'))errors.push(String(e));});});page.on('pageerror',e=>errors.push(String(e)));
 await page.evaluateOnNewDocument(()=>{window.__qaPrintCalls=0;window.print=()=>{window.__qaPrintCalls++;console.error('QA_OS_PRINT_BLOCKED');throw Error('QA forbids OS print');};});
 await frame.evaluate(()=>{window.__qaPrintCalls=0;window.print=()=>{window.__qaPrintCalls++;console.error('QA_OS_PRINT_BLOCKED');throw Error('QA forbids OS print');};});
 await frame.evaluate(()=>{const value=JSON.parse(localStorage.getItem('rhwp-settings')||'{}');value.version=1;value.autosave={recoveryEnabled:true,recoveryIntervalMinutes:10,idleSaveEnabled:true,idleDelaySeconds:2};localStorage.setItem('rhwp-settings',JSON.stringify(value));});
 await page.reload({waitUntil:'domcontentloaded'});
 await until(()=>{frame=page.frames().find(f=>f.url().includes('/studio/'));return frame;},'fresh settings frame');
 await page.waitForFunction(()=>!document.querySelector('#save').disabled,{timeout:30000});await frame.evaluate(()=>window.rhwpStudio.plugins.load('hwpctrl'));
 const engineAsset=fs.readdirSync(path.join(q,'runtime/web/studio/assets')).find(n=>/^rhwp_bg-.*\.wasm$/.test(n));
 const receivedEngineSHA256=sha(Buffer.from(await(await fetch(new URL('/studio/assets/'+engineAsset,page.url()))).arrayBuffer()));
 assert.equal(receivedEngineSHA256,sha(fs.readFileSync(path.join(root,'pkg/rhwp_bg.wasm'))));
 for(const ext of ['hwp','hwpx']){
  await frame.evaluate(()=>window.rhwpStudio.notifySaved());control({id:'open-'+ext,openFile:'print-input.'+ext});await page.evaluate(()=>document.querySelector('#open').click());
  await until(()=>frame.evaluate(ext=>window.__wasm.fileName==='print-input.'+ext&&window.__inputHandler.active,ext),'open '+ext);await page.waitForFunction(()=>!document.querySelector('#save').disabled);await settle();
  const clean=await state();assert.equal(clean.pages,2);assert.equal(clean.host.dirty,false);assert.match(clean.text,/PRINT_51/);
  // Keep both an undo entry and a redo entry across print. Actual product commands.
  await frame.evaluate(()=>window.__inputHandler.focus());await page.keyboard.sendCharacter('A');await settle();const first=await state();
  await page.keyboard.sendCharacter('B');await settle();const second=await state();assert.notEqual(first.hwp,second.hwp);
  assert((await command('edit:undo')).ok);await settle();const before=await state();assert.equal(before.hwp,first.hwp);assert(before.history.u>0&&before.history.r>0);assert(before.host.dirty);assert.equal(before.pages,2);
  const status=()=>frame.evaluate(()=>document.getElementById('sb-message').textContent);
  const drafts=()=>frame.evaluate(()=>new Promise((resolve,reject)=>{
   const request=indexedDB.open('rhwpStudioAutosave');request.onerror=()=>reject(request.error);
   request.onsuccess=()=>{const db=request.result,tx=db.transaction('drafts','readonly'),get=tx.objectStore('drafts').getAll();let values=[];
    get.onsuccess=()=>{values=get.result.map(row=>({...row,data:Array.from(new Uint8Array(row.data))}));};
    tx.oncomplete=()=>{db.close();resolve(values);};tx.onerror=()=>{db.close();reject(tx.error);};};
  }));
  const fingerprints=values=>Object.fromEntries(values.map(row=>[row.id,sha(Buffer.from(row.data))]));
  // One unrelated synthetic recovery row must survive both autosave and real save.
  const seed={id:'qa-unrelated-'+ext,fileName:'unrelated-synthetic-'+ext+'.hwp',sourceFormat:'hwp',savedAt:Date.now(),data:Array.from(fs.readFileSync(path.join(fixtures,'print-input.hwp')))};
  await frame.evaluate(seed=>new Promise((resolve,reject)=>{const request=indexedDB.open('rhwpStudioAutosave');request.onsuccess=()=>{const db=request.result,tx=db.transaction('drafts','readwrite');tx.objectStore('drafts').put({...seed,data:new Uint8Array(seed.data).buffer,byteLength:seed.data.length});tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>{db.close();reject(tx.error);};};request.onerror=()=>reject(request.error);}),seed);
  const unrelatedBefore=fingerprints((await drafts()).filter(row=>row.fileName!==before.host.fileName));
  const normal='QA_AUTOSAVE_NORMAL_'+ext;await frame.evaluate(text=>{document.getElementById('sb-message').textContent=text;},normal);
  assert((await command('edit:redo')).ok);await settle();assert.equal((await state()).hwp,second.hwp);
  assert((await command('edit:undo')).ok);await settle();assert.equal((await state()).hwp,first.hwp);
  const readyBefore=readyEvents;
  await frame.evaluate(()=>{window.__qaAutoOriginalOpen=window.open;window.open=function(...args){const child=window.__qaAutoOriginalOpen.apply(this,args);if(child)child.addEventListener('load',()=>{child.__qaAutoNativeFrame=child.requestAnimationFrame;child.__qaAutoFrames=[];child.requestAnimationFrame=fn=>{child.__qaAutoFrames.push(fn);return 0;};},{once:true});return child;};});
  let child;
  try{child=await preview();await until(()=>child.evaluate(()=>window.__qaAutoFrames.length>0),'print readiness held');}
  finally{await frame.evaluate(()=>{window.open=window.__qaAutoOriginalOpen;delete window.__qaAutoOriginalOpen;});}
  const progress=await status();assert.match(progress,/인쇄/);
  let committed;
  await until(async()=>{committed=(await drafts()).find(row=>row.fileName===before.host.fileName);return committed&&/^복구용 자동 저장 완료/.test(await status());},'real idle autosave during held print');
  assert.equal(sha(Buffer.from(committed.data)),before.hwp,'recovery bytes committed without changing the document');
  const autosaveComplete=await status();
  await child.evaluate(()=>{const callbacks=window.__qaAutoFrames;window.requestAnimationFrame=window.__qaAutoNativeFrame;delete window.__qaAutoFrames;delete window.__qaAutoNativeFrame;callbacks.forEach(fn=>fn(performance.now()));});
  await until(()=>readyEvents>readyBefore,'print completes after autosave');
  await child.evaluate(()=>document.getElementById('close-btn').click());await until(()=>child.isClosed(),'print closes');
  await pause(1850);const afterTimer=await status();assert.equal(afterTimer,mode==='fixed'?normal:progress);
  await preserved(before);assert.deepEqual(fingerprints((await drafts()).filter(row=>row.id!==committed.id)),unrelatedBefore);
  // Delay only a real committed recovery transaction's completion callback.
  await frame.evaluate(()=>{
   const descriptor=Object.getOwnPropertyDescriptor(IDBTransaction.prototype,'oncomplete');window.__qaAutoTxnDescriptor=descriptor;window.__qaAutoCompletions=[];
   Object.defineProperty(IDBTransaction.prototype,'oncomplete',{...descriptor,set(callback){descriptor.set.call(this,event=>{
    if(this.mode==='readwrite'&&this.objectStoreNames.contains('drafts')&&typeof callback==='function')window.__qaAutoCompletions.push(()=>callback.call(this,event));
    else if(typeof callback==='function')callback.call(this,event);
   });}});
  });
  assert((await command('edit:redo')).ok);await settle();assert.equal((await state()).hwp,second.hwp);
  assert((await command('edit:undo')).ok);await settle();assert.equal((await state()).hwp,first.hwp);
  await until(()=>frame.evaluate(()=>window.__qaAutoCompletions.length>0),'committed autosave callback held');
  const whileHeld=(await drafts()).find(row=>row.id===committed.id);assert.equal(sha(Buffer.from(whileHeld.data)),before.hwp);
  assert.match(await status(),/복구용 자동 저장 중/);
  assert((await command('view:form-mode')).ok);assert.equal(await status(),'양식 모드');
  const consoleBefore=consoleEvents.length;
  await frame.evaluate(()=>{Object.defineProperty(IDBTransaction.prototype,'oncomplete',window.__qaAutoTxnDescriptor);delete window.__qaAutoTxnDescriptor;const callbacks=window.__qaAutoCompletions;delete window.__qaAutoCompletions;callbacks.forEach(fn=>fn());});
  await until(()=>consoleEvents.slice(consoleBefore).some(text=>text.startsWith('[autosave] draft saved:')),'late autosave completion reported');
  await pause(1850);const latestAfterCompletion=await status();assert.equal(latestAfterCompletion,mode==='fixed'?'양식 모드':progress);
  await preserved(before);assert.deepEqual(fingerprints((await drafts()).filter(row=>row.id!==committed.id)),unrelatedBefore);
  assert((await command('view:form-mode')).ok);assert.equal(await status(),'기본 편집 모드');
  // Persist edited synthetic bytes through the actual host IPC/filesystem path.
  const savedName='qa-autosave-user-save.'+ext;control({id:'user-save-'+ext,file:savedName});await page.select('#format',ext);await page.evaluate(()=>document.getElementById('save').click());
  await until(()=>frame.evaluate(()=>!window.baramHost.state().dirty),'actual user save clean');
  assert.equal(sha(fs.readFileSync(path.join(q,'files',savedName))),before[ext]);
  await until(async()=>!(await drafts()).some(row=>row.id===committed.id),'only current recovery removed after real save');
  assert.deepEqual(fingerprints(await drafts()),unrelatedBefore);
  assert.deepEqual(await frame.evaluate(()=>({u:window.__inputHandler.history.undoStack.length,r:window.__inputHandler.history.redoStack.length})),before.history);
  rows.push({ext,normal,printProgress:progress,autosaveComplete,afterRestoreTimer:afterTimer,lateCompletionStatus:latestAfterCompletion,
   actualRecoveryCommit:true,recoverySHA256:before.hwp,unrelatedDraftsUnchanged:true,userSaveSHA256:before[ext],currentDraftRemovedOnlyAfterUserSave:true,history:before.history,documentBytesAndTextAndSVGPreserved:true});
  assert((await command('edit:redo')).ok);await settle();assert.equal((await state()).hwp,second.hwp,'retained redo works');assert((await command('edit:undo')).ok);await settle();assert.equal((await state()).hwp,first.hwp,'retained undo works');
  write('progress.json',rows);write('console-events.json',consoleEvents);budget.check();console.log('PASS '+mode+' '+ext);
  if(mode==='baseline')break;
 }
 assert.deepEqual(errors,[]);assert.equal(blockedOSPrintCalls,0,'no OS print attempts across frames and children');
 await frame.evaluate(()=>window.rhwpStudio.notifySaved());control({id:'normal-quit',quit:true,choice:'cancel'});await until(()=>p.exitCode!==null,'normal quit');assert.equal(p.exitCode,0);normalQuit=true;
 write('proof.json',{mode,rows,dialogs,errors,receivedEngineSHA256,actualMacElectron:true,electron:'44.3.0',instrumentedReadHandles:true,syntheticFixturesOnly:true,nativeFileChooserControlled:true,OSPrintDialogVerified:false,OSPrintCallsBlocked:true,scope:'actual idle autosave/print restore and committed-IDB callback race with real user save',physicalPrinterOutput:false,normalQuit,exitCode:p.exitCode,budget:budget.check()});
}catch(e){failure=String(e);write('failure.json',{failure,stack:e.stack,rows,dialogs,errors});write('console-events.json',consoleEvents);throw e;}
finally{
 clearInterval(monitor);
 if(failure&&frame&&!frame.detached){
  try{await frame.evaluate(()=>{if(window.__qaAutoTxnDescriptor){Object.defineProperty(IDBTransaction.prototype,'oncomplete',window.__qaAutoTxnDescriptor);delete window.__qaAutoTxnDescriptor;}const callbacks=window.__qaAutoCompletions||[];delete window.__qaAutoCompletions;callbacks.forEach(fn=>fn());});}catch{}
  try{const recovery=await frame.evaluate(()=>({hwp:Array.from(window.baramHost.export('hwp')),hwpx:Array.from(window.baramHost.export('hwpx')),dirty:window.baramHost.state(),history:{u:window.__inputHandler.history.undoStack.length,r:window.__inputHandler.history.redoStack.length}}));
   for(const ext of ['hwp','hwpx'])fs.writeFileSync(path.join(q,'files','failure-preserved.'+ext),Buffer.from(recovery[ext]),{flag:'wx'});
   write('failure-preservation.json',{host:recovery.dirty,history:recovery.history,bytesPreserved:true});
   await frame.evaluate(()=>window.rhwpStudio.notifySaved());
  }catch(e){write('failure-preservation-error.json',{error:String(e)});}
 }
 if(p)exitOutcome=await finishOwnedQA(p,{
  requestClose:()=>control({id:'cleanup-owned-QA',quit:true,choice:'cancel'}),
  // Only this invocation's newly spawned QA child may be terminated on a
  // measured budget failure. Other failures keep unsaved state intact.
  allowTerminate:!!budgetError,
 });
 normalQuit=exitOutcome?.normalQuit===true;
 b?.disconnect();
 write('lifecycle.json',{...exitOutcome,normalQuit,failure,nativeStages,
  terminationUnconfirmed:p?exitOutcome.terminationUnconfirmed:false});
}

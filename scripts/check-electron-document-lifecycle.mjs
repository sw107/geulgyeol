// Dedicated official Electron runtime, real preload/IPC/atomic writes.
// Native dialog responses are controlled by the QA bootstrap; no OS chooser claim.
import puppeteer from '../rhwp-studio/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {launchPackaged} from './packaged-electron-qa.mjs';
const packaged=process.env.GEULGYEOL_QA_PACKAGED_APP;
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const root=path.resolve(import.meta.dirname,'..'),q=path.resolve(process.argv[2]);
assert(!fs.existsSync(path.join(q,'audit.jsonl'))&&!fs.existsSync(path.join(q,'app-data')),'Fresh dedicated QA directory required');
const engine=path.resolve(process.env.GEULGYEOL_QA_ENGINE_DIR);
const M=await import(pathToFileURL(path.join(engine,'rhwp.js')));
M.initSync({module:fs.readFileSync(path.join(engine,'rhwp_bg.wasm'))});
const sha=b=>createHash('sha256').update(b).digest('hex');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const write=(n,v)=>fs.writeFileSync(path.join(q,n),JSON.stringify(v,null,2));
const control=v=>write('control.json',v);
const audit=()=>fs.existsSync(path.join(q,'audit.jsonl'))?fs.readFileSync(path.join(q,'audit.jsonl'),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[];
async function until(fn,label){const end=Date.now()+65000;while(Date.now()<end){if(await fn())return;await pause(50);}throw Error('Timeout '+label);}
const text=bytes=>{const d=new M.HwpDocument(new Uint8Array(bytes));try{return JSON.parse(d.getTextFileText());}finally{d.free();}};
const rows=[],pageErrors=[];let p,b,page,frame,failure,normalQuit=false;
// getDocumentState hashes an HWP export. Warm that export before byte snapshots
// so lazily registered font metadata does not confound a no-edit comparison.
const exported=ext=>frame.evaluate(ext=>{window.baramHost.export('hwp');return Array.from(window.baramHost.export(ext));},ext).then(Buffer.from);
const state=()=>page.evaluate(()=>({host:document.querySelector('#editor iframe').contentWindow.baramHost.state(),filename:document.querySelector('#filename').textContent,busy:document.querySelector('#save').disabled,status:document.querySelector('#status').textContent,errorOpen:document.querySelector('#error-dialog').open,errorText:document.querySelector('#error-text').textContent}));
const add=(name,details={})=>{rows.push({name,...details});console.log('PASS '+name);write('progress.json',rows);};
const click=id=>page.evaluate(id=>document.getElementById(id).click(),id);
async function settled(){await until(async()=>!(await state()).busy,'operation completion');await pause(100);}
async function edit(value){await frame.evaluate(value=>window.rhwpStudio.plugins.invoke('hwpctrl','invoke',['SetTextFile',[value,'TEXT','insertfile']]),value);await pause(80);}
async function dismissError(){await page.evaluate(()=>{const d=document.querySelector('#error-dialog');if(d.open)d.close();});}
async function preserve(label,plan,action){
 const before=await exported('hwpx'),s=await state();control(plan);await action();await settled();
 assert.deepEqual(await exported('hwpx'),before);assert.equal((await state()).host.dirty,s.host.dirty);
 add(label,{failureKind:plan.rejectDialog?'controlled native chooser rejection':plan.file==='write-failure.hwpx'?'real filesystem rename failure':undefined,beforeSHA256:sha(before),afterSHA256:sha(await exported('hwpx')),dirty:(await state()).host.dirty});
 await dismissError();
}
async function waitPlanPrompt(id){await until(()=>audit().some(e=>e.kind==='close-confirmation'&&e.plan===id),'confirmation '+id);}
try{
 if(!packaged)for(const rel of ['main.cjs','preload.cjs','close-controller.cjs','web/baram.js'])assert.deepEqual(fs.readFileSync(path.join(q,'runtime',rel)),fs.readFileSync(path.join(root,'desktop',rel)));
 control({id:'start',canceled:true});let endpoint;
 if(packaged){const launch=await launchPackaged(path.resolve(packaged),q);p=launch.p;endpoint=launch.endpoint;}else{
 const env={...process.env,GEULGYEOL_ELECTRON_MODULE:'electron',GEULGYEOL_QA_DIR:q};delete env.ELECTRON_RUN_AS_NODE;
 p=spawn(path.join(root,'desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),[path.join(q,'bootstrap.cjs'),'--remote-debugging-port=0','--remote-debugging-address=127.0.0.1'],{env});
 let output='';const log=fs.createWriteStream(path.join(q,'launch.log'));
 for(const stream of [p.stdout,p.stderr])stream.on('data',d=>{output+=d;log.write(d);});
 await until(()=>{endpoint=output.match(/DevTools listening on (ws:\/\/\S+)/)?.[1];if(p.exitCode!==null)throw Error('app exit '+p.exitCode);return endpoint;},'endpoint');
 }
 b=await puppeteer.connect({browserWSEndpoint:endpoint,defaultViewport:null,protocolTimeout:30000});
 await until(async()=>{page=(await b.pages()).find(p=>/^http:\/\/127\.0\.0\.1:\d+\/$/.test(p.url()));return page;},'app window');
 page.on('pageerror',e=>pageErrors.push(String(e)));
 page.on('dialog',async d=>{pageErrors.push('unexpected JS dialog '+d.message());await d.dismiss();});
 await page.waitForFunction(()=>!document.querySelector('#save').disabled,{timeout:65000,polling:100});
 frame=page.frames().find(f=>f.url().includes('/studio/'));await frame.evaluate(()=>window.rhwpStudio.plugins.load('hwpctrl'));
 const viewport=await page.evaluate(()=>({width:innerWidth,height:innerHeight,bodyWidth:document.body.clientWidth,bodyHeight:document.body.clientHeight}));
 assert(viewport.width>=900&&viewport.height>=590);add('native viewport retained',viewport);
 // Start with the app's real blank document, rather than an engine handle
 // whose initial section may not accept a plugin insert.
 await click('new');await settled();assert.equal((await state()).errorOpen,false);

 // Reproduce the exact same-task edit/new race, with a full before snapshot.
 await frame.evaluate(()=>window.rhwpStudio.notifySaved());await pause(80);
 control({id:'stale-new',choice:'cancel'});
 const beforeNew=Buffer.from(await page.evaluate(()=>{
  const h=document.querySelector('#editor iframe').contentWindow;
  h.rhwpStudio.plugins.invoke('hwpctrl','invoke',['SetTextFile',['새 문서 전 미저장🙂','TEXT','insertfile']]);
  h.baramHost.export('hwp');const bytes=Array.from(h.baramHost.export('hwpx'));
  window.qaBeforeNewState=h.baramHost.state();document.querySelector('#new').click();return bytes;
 }));await settled();const afterNew=await exported('hwpx');
 fs.writeFileSync(path.join(q,'files/stale-new-before.hwpx'),beforeNew);fs.writeFileSync(path.join(q,'files/stale-new-after.hwpx'),afterNew);
 write('same-task-state.json',{before:await page.evaluate(()=>window.qaBeforeNewState),after:await state()});
 assert(text(beforeNew).includes('미저장'));assert.equal(sha(afterNew),sha(beforeNew));assert((await state()).host.dirty);
 assert.equal((await state()).errorOpen,false);
 assert.equal(audit().filter(e=>e.kind==='close-confirmation'&&e.plan==='stale-new').length,1);
 add('same-task edit/new cancel preserves complete document',{beforeSHA256:sha(beforeNew),dirty:true});

 await preserve('new save chooser cancel preserves document',{id:'new-save-cancel',choice:'save',canceled:true},()=>click('new'));
 await preserve('new save failure preserves document',{id:'new-save-fail',choice:'save',file:'failed.hwp',rejectDialog:true},()=>click('new'));
 fs.mkdirSync(path.join(q,'files/write-failure.hwpx'));fs.writeFileSync(path.join(q,'files/write-failure.hwpx/sentinel'),'preserved');
 await page.select('#format','hwpx');
 await preserve('new real filesystem failure preserves document',{id:'new-fs-fail',choice:'save',file:'write-failure.hwpx'},()=>click('new'));
 await preserve('open real filesystem failure preserves document',{id:'open-fs-fail',choice:'save',file:'write-failure.hwpx'},()=>click('open'));
 await preserve('close real filesystem failure preserves document',{id:'close-fs-fail',choice:'save',file:'write-failure.hwpx',close:true},async()=>{await waitPlanPrompt('close-fs-fail');await pause(200);});
 assert.equal(fs.readFileSync(path.join(q,'files/write-failure.hwpx/sentinel'),'utf8'),'preserved');assert(!fs.readdirSync(path.join(q,'files')).some(n=>n.startsWith('.baram-')));
 await preserve('open cancel preserves document',{id:'open-cancel',choice:'cancel'},()=>click('open'));
 await preserve('open chooser cancel after discard preserves document',{id:'open-chooser-cancel',choice:'discard'},()=>click('open'));
 fs.writeFileSync(path.join(q,'files/invalid.hwp'),'synthetic invalid file');
 await preserve('invalid open preserves previous document',{id:'open-invalid',choice:'discard',openFile:'invalid.hwp'},()=>click('open'));

 // Preserve real reply values. Insert immediately after the second state reply.
 await frame.evaluate(()=>{window.qaReplies=[];window.qaOriginalPost=MessagePort.prototype.postMessage;let count=0;MessagePort.prototype.postMessage=function(message,...args){const v=message?.result;const isState=v&&typeof v.documentSha256==='string'&&typeof v.changeSeq==='number';if(isState)window.qaReplies.push({...v});const result=window.qaOriginalPost.call(this,message,...args);if(isState&&++count===2){window.qaLateFired=true;window.rhwpStudio.plugins.invoke('hwpctrl','invoke',['SetTextFile',['나중 편집🙂','TEXT','insertfile']]);}return result;};});
 await page.select('#format','hwpx');control({id:'late-save',file:'late-saved.hwpx'});await click('save');await settled();
 const current=await exported('hwpx'),saved=fs.readFileSync(path.join(q,'files/late-saved.hwpx'));
 fs.writeFileSync(path.join(q,'files/late-current.hwpx'),current);
 const replies=await frame.evaluate(()=>window.qaReplies);assert(await frame.evaluate(()=>Boolean(window.qaLateFired)));assert.equal(replies.length,2);assert.equal(replies[0].changeSeq,replies[1].changeSeq);
 assert(text(current).includes('나중 편집'));assert(!text(saved).includes('나중 편집'));assert((await state()).host.dirty);assert.match((await state()).status,/추가 편집/);
 add('late edit after unchanged state reply remains dirty',{replies,currentText:text(current),savedText:text(saved),state:await state()});
 await frame.evaluate(()=>{MessagePort.prototype.postMessage=window.qaOriginalPost;});

 // A second request and close during a pending save cannot replace the document.
 const gatedBefore=await exported('hwpx'),saveCount=audit().filter(e=>e.kind==='save-dialog-enter').length;
 control({id:'save-gated',file:'gated.hwpx',gate:'release-save'});await click('save');
 await until(()=>audit().filter(e=>e.kind==='save-dialog-enter').length>saveCount,'pending save');
 await click('save');await click('new');await click('open');control({id:'close-busy',choice:'discard',close:true,duplicateClose:true});await pause(250);
 assert.equal(p.exitCode,null);assert.deepEqual(await exported('hwpx'),gatedBefore);assert.equal(audit().filter(e=>e.kind==='save-dialog-enter').length,saveCount+1);
 await edit('저장 대기 중 편집🙂');control({id:'release-save',choice:'cancel'});fs.writeFileSync(path.join(q,'release-save'),'ready');await settled();
 assert((await state()).host.dirty);assert(!text(fs.readFileSync(path.join(q,'files/gated.hwpx'))).includes('저장 대기 중 편집'));
 add('duplicate file actions and close blocked while save pending; late edit retained');

 // An old save belongs to its original document, even if a public host API
 // swaps the document while the native chooser is pending.
 const originalText=text(await exported('hwpx'));control({id:'save-old-epoch',file:'old-epoch.hwpx',gate:'release-epoch'});await click('save');
 await until(()=>audit().some(e=>e.kind==='save-dialog-enter'&&e.plan==='save-old-epoch'),'old epoch save');
 await frame.evaluate(()=>window.baramHost.newDocument());await edit('새 문서 세대의 미저장 편집🙂');fs.writeFileSync(path.join(q,'release-epoch'),'ready');await settled();
 assert.equal(text(fs.readFileSync(path.join(q,'files/old-epoch.hwpx'))),originalText);assert(text(await exported('hwpx')).includes('새 문서 세대의 미저장 편집'));assert((await state()).host.dirty);assert.equal((await state()).host.fileName,'새 문서.hwp');add('save completion for old epoch preserves new document name and dirty state');

 // A revision change during the native confirmation invalidates its approval.
 const promptBefore=await exported('hwpx');control({id:'new-prompt-gated',choice:'discard',closeGate:'release-prompt'});await click('new');await waitPlanPrompt('new-prompt-gated');
 await edit('확인 대기 중 편집🙂');fs.writeFileSync(path.join(q,'release-prompt'),'ready');await settled();assert(text(await exported('hwpx')).includes('확인 대기 중 편집'));assert.notDeepEqual(await exported('hwpx'),promptBefore);assert((await state()).host.dirty);
 add('edit during confirmation invalidates discard approval');await dismissError();

 // Save-before-new for HWP and HWPX; reopen the actual disk artifact in the app.
 for(const format of ['hwp','hwpx']){
  await edit('전환 전 저장 '+format+'🙂');const expectedText=text(await exported('hwpx'));
  await page.select('#format',format);const file='before-new.'+format;control({id:'new-save-'+format,choice:'save',file});await click('new');await settled();
  assert.equal(text(await exported('hwpx')),'');assert.equal((await state()).host.dirty,false);assert.equal(text(fs.readFileSync(path.join(q,'files',file))),expectedText);
  control({id:'reopen-'+format,openFile:file});await click('open');await settled();assert.equal(text(await exported('hwpx')),expectedText);assert.equal((await state()).host.dirty,false);
  add('save before new and actual app reopen '+format,{diskSHA256:sha(fs.readFileSync(path.join(q,'files',file))),text:expectedText});
 }
 await edit('버릴 합성 편집🙂');control({id:'new-discard',choice:'discard'});await click('new');await settled();assert.equal(text(await exported('hwpx')),'');assert.equal((await state()).host.dirty,false);add('new discard clears only approved document');
 control({id:'reopen-after-discard',openFile:'before-new.hwpx'});await click('open');await settled();

 // Save-before-open failure/cancel and successful transition.
 await edit('열기 전 미저장🙂');
 await preserve('open save chooser cancel preserves document',{id:'open-save-cancel',choice:'save',canceled:true,openFile:'before-new.hwp'},()=>click('open'));
 await preserve('open save failure preserves document',{id:'open-save-fail',choice:'save',rejectDialog:true,openFile:'before-new.hwp'},()=>click('open'));
 const beforeOpenText=text(await exported('hwpx'));control({id:'open-save-success',choice:'save',file:'before-open.hwpx',openFile:'before-new.hwp'});await click('open');await settled();
 assert.equal(text(fs.readFileSync(path.join(q,'files/before-open.hwpx'))),beforeOpenText);assert.equal(text(await exported('hwpx')),text(fs.readFileSync(path.join(q,'files/before-new.hwp'))));add('save before open persists old document then loads chosen document');

 // Late edit during file selection: final in-frame load fence must reject it.
 control({id:'open-gated',openFile:'before-new.hwpx',openGate:'release-open'});await click('open');await until(async()=>(await state()).busy,'open in progress');await pause(150);await edit('열기 선택 중 편집🙂');fs.writeFileSync(path.join(q,'release-open'),'ready');await settled();
 assert(text(await exported('hwpx')).includes('열기 선택 중 편집'));assert((await state()).host.dirty);add('edit during open chooser blocks stale replacement');await dismissError();

 // Actual close cancellation deduplicates requests, then save cancel/failure keep window.
 for(const [id,extra] of [['close-cancel',{choice:'cancel'}],['close-save-cancel',{choice:'save',canceled:true}],['close-save-fail',{choice:'save',rejectDialog:true}]]){
  const before=await exported('hwpx');control({id,...extra,close:true,duplicateClose:true});await waitPlanPrompt(id);await pause(200);await settled();assert.equal(p.exitCode,null);assert.deepEqual(await exported('hwpx'),before);assert((await state()).host.dirty);
  assert.equal(audit().filter(e=>e.kind==='close-confirmation'&&e.plan===id).length,1);add(id+' preserves window/document');await dismissError();
 }
 await page.select('#format','hwpx');
 control({id:'close-save-late',choice:'save',file:'close-copy.hwpx',gate:'release-close-save',close:true});await waitPlanPrompt('close-save-late');
 await until(()=>audit().some(e=>e.kind==='save-dialog-enter'&&e.plan==='close-save-late'),'close save chooser');await edit('닫기 저장 중 편집🙂');fs.writeFileSync(path.join(q,'release-close-save'),'ready');await settled();
 assert.equal(p.exitCode,null);assert((await state()).host.dirty);assert(!text(fs.readFileSync(path.join(q,'files/close-copy.hwpx'))).includes('닫기 저장 중 편집'));add('late edit during save before close keeps window dirty');

 // Inject a public edit during real draft deletion, without changing IDB results.
 await frame.evaluate(()=>{window.qaOriginalDelete=IDBObjectStore.prototype.delete;window.qaCleanupEdit=false;IDBObjectStore.prototype.delete=function(...args){const result=window.qaOriginalDelete.apply(this,args);if(!window.qaCleanupEdit){window.qaCleanupEdit=true;window.rhwpStudio.plugins.invoke('hwpctrl','invoke',['SetTextFile',['복구본 정리 중 편집🙂','TEXT','insertfile']]);}return result;};});
 control({id:'close-cleanup-edit',choice:'discard',close:true});await waitPlanPrompt('close-cleanup-edit');await settled();await pause(200);
 assert(await frame.evaluate(()=>window.qaCleanupEdit));assert.equal(p.exitCode,null);assert(text(await exported('hwpx')).includes('복구본 정리 중 편집'));assert((await state()).host.dirty);add('edit during draft cleanup aborts close and preserves edits');
 await frame.evaluate(()=>{IDBObjectStore.prototype.delete=window.qaOriginalDelete;});await dismissError();
 let recovery;
 await until(async()=>{
  const drafts=await frame.evaluate(()=>new Promise((resolve,reject)=>{const req=indexedDB.open('rhwpStudioAutosave');req.onerror=()=>reject(req.error);req.onsuccess=()=>{const db=req.result;const tx=db.transaction('drafts','readonly');const get=tx.objectStore('drafts').getAll();get.onerror=()=>{db.close();reject(get.error);};get.onsuccess=()=>{const rows=get.result.map(row=>({id:row.id,data:Array.from(new Uint8Array(row.data))}));db.close();resolve(rows);};};}));
  recovery=drafts.find(d=>text(Buffer.from(d.data)).includes('복구본 정리 중 편집'));return Boolean(recovery);
 },'recovery scheduling after aborted close');
 fs.writeFileSync(path.join(q,'files/recovery-after-aborted-close.hwp'),Buffer.from(recovery.data));add('aborted cleanup restores actual IndexedDB recovery draft',{draftId:recovery.id,SHA256:sha(Buffer.from(recovery.data))});
 // Reject the real renderer's IDB delete API once, separately from write faults.
 const idbBefore=await exported('hwpx');
 await frame.evaluate(()=>{window.qaOriginalDelete=IDBObjectStore.prototype.delete;window.qaDeleteRejected=false;IDBObjectStore.prototype.delete=function(...args){if(!window.qaDeleteRejected){window.qaDeleteRejected=true;throw new Error('QA controlled IndexedDB delete rejection');}return window.qaOriginalDelete.apply(this,args);};});
 control({id:'close-idb-fail',choice:'discard',close:true});await waitPlanPrompt('close-idb-fail');await settled();await pause(200);
 assert.equal(p.exitCode,null);assert(await frame.evaluate(()=>window.qaDeleteRejected));assert.deepEqual(await exported('hwpx'),idbBefore);assert((await state()).host.dirty);assert.match((await state()).errorText,/IndexedDB delete rejection/);
 await frame.evaluate(()=>{IDBObjectStore.prototype.delete=window.qaOriginalDelete;});
 const keptDraft=await frame.evaluate(id=>new Promise((resolve,reject)=>{const req=indexedDB.open('rhwpStudioAutosave');req.onerror=()=>reject(req.error);req.onsuccess=()=>{const db=req.result,get=db.transaction('drafts','readonly').objectStore('drafts').get(id);get.onerror=()=>{db.close();reject(get.error);};get.onsuccess=()=>{db.close();resolve(get.result?Array.from(new Uint8Array(get.result.data)):null);};};}),recovery.id);
 assert(keptDraft);assert.equal(sha(Buffer.from(keptDraft)),sha(Buffer.from(recovery.data)));add('controlled IndexedDB deletion failure preserves window, document and existing recovery draft',{failureKind:'controlled real-renderer IDB delete API rejection',draftSHA256:sha(Buffer.from(keptDraft))});await dismissError();
 // Save-before-close: real IPC atomic write completes before the native window dies.
 const closingText=text(await exported('hwpx'));control({id:'close-save-success',choice:'save',file:'before-close.hwpx',close:true});
 await until(async()=>p.exitCode!==null||audit().some(e=>e.kind==='save-dialog-enter'&&e.plan==='close-save-success')||(await state()).errorOpen,'close save decision');
 // The window can be destroyed between the IPC audit and the process exit.
 // Verify the durable artifact and normal quit below rather than querying a
 // renderer that has already detached.
 if(p.exitCode===null){const current=await state().catch(()=>null);if(current)assert.equal(current.errorOpen,false,JSON.stringify(current));}
 await until(()=>p.exitCode!==null,'save before close');normalQuit=p.exitCode===0;assert(normalQuit);assert.equal(text(fs.readFileSync(path.join(q,'files/before-close.hwpx'))),closingText);add('save before close persists all edits then normal quit');
 assert.deepEqual(pageErrors,[]);
 write('proof.json',{actualElectron:true,actualPackagedApp:Boolean(packaged),executable:packaged,defaultViewport:null,controlledNativeResponses:true,OSChooserVerified:false,programmaticPublicPluginEdits:true,physicalIMEVerified:false,clipboardAccessed:false,rows,pageErrors,engineSHA256:sha(fs.readFileSync(path.join(engine,'rhwp_bg.wasm')))});
}catch(e){failure=String(e);write('failure.json',{failure,stack:e.stack,rows,pageErrors,state:page&&p?.exitCode===null?await state().catch(e=>String(e)):null});console.error(e);process.exitCode=1;}
finally{
 if(p&&p.exitCode===null){for(const gate of ['release-save','release-prompt','release-open','release-close-save','release-epoch'])if(!fs.existsSync(path.join(q,gate)))fs.writeFileSync(path.join(q,gate),'finally release');control({id:'quit',quit:true,choice:'discard'});try{await until(()=>p.exitCode!==null,'normal close');normalQuit=p.exitCode===0;}catch(e){failure=failure||String(e);}}
 b?.disconnect();write('lifecycle.json',{normalQuit,exitCode:p?.exitCode,failure});if(!normalQuit)process.exitCode=1;
}

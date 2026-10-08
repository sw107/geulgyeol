// Official Electron, production editor. Delay after finalize returns true,
// or reject that reply after it executed, without changing document operations.
import puppeteer from '../rhwp-studio/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';import {pathToFileURL} from 'node:url';import {createHash} from 'node:crypto';
const root=path.resolve(import.meta.dirname,'..'),q=path.resolve(process.argv[2]),scenario=process.argv[3],baseline=process.argv[4]==='baseline';
assert(['public','file-read','image-decode','cancel','pending-render'].includes(scenario));
assert(!fs.existsSync(path.join(q,'audit.jsonl'))&&!fs.existsSync(path.join(q,'app-data')),'Fresh dedicated QA directory required');
if(!baseline)for(const n of ['main.cjs','preload.cjs','close-controller.cjs','web/baram.js'])assert.deepEqual(fs.readFileSync(path.join(q,'runtime',n)),fs.readFileSync(path.join(root,'desktop',n)));
const sha=b=>createHash('sha256').update(b).digest('hex'),pause=ms=>new Promise(r=>setTimeout(r,ms));
const write=(n,v)=>fs.writeFileSync(path.join(q,n),JSON.stringify(v,null,2)),control=v=>write('control.json',v);
const audit=()=>fs.existsSync(path.join(q,'audit.jsonl'))?fs.readFileSync(path.join(q,'audit.jsonl'),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[];
async function until(f,label,ms=65000){const end=Date.now()+ms;while(Date.now()<end){if(await f())return;await pause(50);}throw Error('Timeout '+label);}
let p,b,page,frame,failure,normalQuit=false;const rows=[];
async function recoveryText(data){const engine=path.resolve(process.env.GEULGYEOL_QA_ENGINE_DIR);const m=await import(pathToFileURL(path.join(engine,'rhwp.js')));m.initSync({module:fs.readFileSync(path.join(engine,'rhwp_bg.wasm'))});const d=new m.HwpDocument(new Uint8Array(data));try{return JSON.parse(d.getTextFileText());}finally{d.free();}}
const bytes=()=>frame.evaluate(()=>{window.baramHost.export('hwp');return Array.from(window.baramHost.export('hwpx'));}).then(Buffer.from);
const state=()=>page.evaluate(()=>{const h=document.querySelector('#editor iframe').contentWindow;return {host:h.baramHost.state(),busy:document.querySelector('#save').disabled,inert:document.querySelector('#editor').inert,childInert:h.document.documentElement.inert,locked:h.qaWasm.documentWritesLocked??false,error:document.querySelector('#error-text').textContent};});
const edit=text=>frame.evaluate(text=>window.rhwpStudio.plugins.invoke('hwpctrl','invoke',['SetTextFile',[text,'TEXT','insertfile']]),text);
const drafts=()=>frame.evaluate(()=>new Promise((resolve,reject)=>{const r=indexedDB.open('rhwpStudioAutosave');r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result,get=db.transaction('drafts','readonly').objectStore('drafts').getAll();get.onerror=()=>{db.close();reject(get.error);};get.onsuccess=()=>{db.close();resolve(get.result.map(d=>({id:d.id,data:Array.from(new Uint8Array(d.data))})));};};}));
try{
 control({id:'start'});const env={...process.env,GEULGYEOL_ELECTRON_MODULE:'electron',GEULGYEOL_QA_DIR:q};delete env.ELECTRON_RUN_AS_NODE;
 p=spawn(path.join(root,'desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),[path.join(q,'bootstrap.cjs'),'--remote-debugging-port=0','--remote-debugging-address=127.0.0.1'],{env});let log='',endpoint;
 for(const s of [p.stdout,p.stderr])s.on('data',d=>{log+=d;fs.appendFileSync(path.join(q,'launch.log'),d);});await until(()=>endpoint=log.match(/DevTools listening on (ws:\/\/\S+)/)?.[1],'endpoint');
 b=await puppeteer.connect({browserWSEndpoint:endpoint,defaultViewport:null,protocolTimeout:30000});await until(async()=>{page=(await b.pages()).find(p=>/^http:\/\/127\.0\.0\.1:\d+\/$/.test(p.url()));return page;},'window');
 await page.waitForFunction(()=>!document.querySelector('#save').disabled,{polling:100,timeout:60000});frame=page.frames().find(f=>f.url().includes('/studio/'));
 await page.evaluate(()=>document.querySelector('#new').click());await until(async()=>!await page.$eval('#save',e=>e.disabled),'new');await frame.evaluate(()=>window.rhwpStudio.plugins.load('hwpctrl'));await edit('최종 응답 경합 합성 문서🙂');
 await frame.evaluate(()=>{window.rhwpStudio.automation.registerCommand({id:'ext:qa:capture',label:'QA capture',canExecute:()=>true,execute(s){window.qaIH=s.getInputHandler();window.qaWasm=s.wasm;window.qaBus=s.eventBus;window.qaHandle=s.wasm.borrowDocumentHandle();window.qaCapturedWrite=window.qaHandle.insertText.bind(window.qaHandle);}});const r=window.rhwpStudio.automation.execute('ext:qa:capture');if(!r.ok)throw Error(JSON.stringify(r));});
 if(scenario==='file-read'||scenario==='image-decode'){
  await frame.evaluate(async scenario=>{
   const png=async(color,width)=>{const c=document.createElement('canvas');c.width=width;c.height=16;const x=c.getContext('2d');x.fillStyle=color;x.fillRect(0,0,c.width,c.height);return new File([await new Promise(r=>c.toBlob(r,'image/png'))],'synthetic.png',{type:'image/png'});};
   const before=await png('blue',16),replacement=await png('red',32),data=new Uint8Array(await before.arrayBuffer()),pos=window.qaIH.getCursorPosition();let result;
   window.qaIH.executeOperation({kind:'snapshot',operationType:'qaInsertPicture',operation(w){result=w.insertPicture(pos.sectionIndex,pos.paragraphIndex,pos.charOffset,'',data,2400,2400,16,16,'png','QA synthetic picture');if(!result.ok)throw Error(JSON.stringify(result));return pos;}});
   const create=document.createElement.bind(document),NativeImage=window.Image;window.qaAsyncDone=false;
   if(scenario==='file-read'){const real=replacement.arrayBuffer.bind(replacement);replacement.arrayBuffer=async()=>{window.qaAsyncReady=true;await new Promise(r=>window.qaReleaseAsync=r);return real();};}
   else window.Image=function(...args){const img=new NativeImage(...args);Object.defineProperty(img,'onload',{set(fn){img.addEventListener('load',e=>{window.qaAsyncReady=true;window.qaReleaseAsync=()=>fn.call(img,e);},{once:true});}});return img;};
   document.createElement=function(tag,...args){const el=create(tag,...args);if(tag==='input'){Object.defineProperty(el,'files',{value:[replacement]});el.click=()=>{window.qaAsyncPromise=el.onchange().finally(()=>{window.qaAsyncDone=true;});};}return el;};
   try{window.qaIH.promptAssignPictureImage({sec:pos.sectionIndex,ppi:result.paraIdx,ci:result.controlIdx,type:'image'});}finally{document.createElement=create;}
   // Restore Image once the real decoder has installed the controlled callback.
   if(scenario==='image-decode'){while(!window.qaAsyncReady)await new Promise(r=>setTimeout(r,20));window.Image=NativeImage;}
  },scenario);await until(()=>frame.evaluate(()=>window.qaAsyncReady),'pending real image callback');
 }
 const before=await bytes();fs.writeFileSync(path.join(q,'files/before-finalize.hwpx'),before);
 if(scenario==='pending-render'){
  assert(!baseline,'Pending render refusal is a current-source regression');
  await frame.evaluate(()=>{window.qaRenderDone=false;window.qaRenderPromise=window.qaIH.executeDocumentAgentOperation({kind:'snapshot',operationType:'qaPendingRender',operation(w){w.insertText(0,0,0,'진행 중 편집');return {sectionIndex:0,paragraphIndex:0,charOffset:7};}},()=>new Promise(r=>window.qaReleaseRender=r)).finally(()=>{window.qaRenderDone=true;});});
  assert(await frame.evaluate(()=>window.qaIH.hasPendingDocumentAgentOperation()));
  control({id:'close-pending-render',choice:'discard',close:true});
  await until(()=>page.evaluate(()=>document.querySelector('#error-dialog').open),'pending transaction refusal');
  assert.equal(p.exitCode,null);assert(!(await state()).busy);assert(!(await state()).locked);assert.match((await state()).error,/진행 중인 편집/);
  rows.push({name:'pending real document-agent transaction rejects final close and restores editing'});
  await page.evaluate(()=>document.querySelector('#error-dialog').close());await frame.evaluate(()=>window.qaReleaseRender());await until(()=>frame.evaluate(()=>window.qaRenderDone),'pending render completion');
  const edited=await bytes();assert((await state()).host.dirty);assert(!await frame.evaluate(()=>window.qaIH.hasPendingDocumentAgentOperation()));
  control({id:'retry-after-render',choice:'save',file:'render-completed.hwpx',close:true});await until(()=>p.exitCode!==null,'completed transaction close');assert.equal(p.exitCode,0);assert.deepEqual(fs.readFileSync(path.join(q,'files/render-completed.hwpx')),edited);rows.push({name:'completed transaction saves exactly and normal close retry succeeds'});
 }else if(scenario==='cancel'){
  await until(async()=>(await drafts()).length>0,'existing recovery');control({id:'cancel-finalize',choice:'discard',unavailableChoice:'cancel',close:true,rejectFinalize:true});
  await until(()=>audit().some(r=>r.kind==='close-confirmation'&&r.options.buttons.includes('종료')),'unavailable warning');await pause(250);assert.equal(p.exitCode,null);
  const afterCancel=await state();assert.deepEqual(await bytes(),before);rows.push({name:'prepare succeeded, finalize reply rejected, native warning cancelled',state:afterCancel,warning:audit().find(r=>r.kind==='close-confirmation'&&r.options.buttons.includes('종료')).options});
  await edit('취소 뒤 편집🙂');const edited=await bytes();assert.notEqual(sha(edited),sha(before));await pause(11500);const recovery=await drafts();
  if(baseline){assert(afterCancel.busy&&afterCancel.inert);assert.equal(recovery.length,0);rows.push({name:'baseline remains locked and recovery draft absent after edit'});}
  else{assert(!afterCancel.busy&&!afterCancel.inert&&!afterCancel.childInert&&!afterCancel.locked);assert((await state()).host.dirty);assert(recovery.length>0);assert.match(await recoveryText(recovery[0].data),/취소 뒤 편집/);assert.equal(await page.evaluate(()=>window.baramFinalizeClose()),false,'cancel clears final approval');fs.writeFileSync(path.join(q,'files/recovery-after-cancel.hwp'),Buffer.from(recovery[0].data));rows.push({name:'cancel restores editing and actual IndexedDB recovery',draftSHA256:sha(Buffer.from(recovery[0].data))});control({id:'retry-save-close',choice:'save',file:'retry-saved.hwpx',close:true});await until(()=>p.exitCode!==null,'close retry');assert.equal(p.exitCode,0);assert.deepEqual(fs.readFileSync(path.join(q,'files/retry-saved.hwpx')),edited);rows.push({name:'close retry saves latest edits and quits normally'});}
 }else{
  control({id:'ack-gap',choice:'save',file:'before-close.hwpx',close:true,afterFinalizeGate:'release-final-ack'});await until(()=>audit().some(r=>r.kind==='finalize-approved'),'finalize true reply');const beforeLate=await bytes();let errors=[];
  if(scenario==='public')errors=await frame.evaluate(()=>{const errors=[];for(const op of [()=>window.qaIH.executeOperation({kind:'snapshot',operationType:'qaAfterFinalize',operation(w){w.insertText(0,0,0,'FINAL LATE');return {sectionIndex:0,paragraphIndex:0,charOffset:10};}}),()=>window.qaCapturedWrite(0,0,0,'BORROWED LATE'),()=>window.qaHandle.findOrCreateFontId('QA late font')])try{op();}catch(e){errors.push(String(e));}return errors;});
  else{await frame.evaluate(()=>window.qaReleaseAsync());await until(()=>frame.evaluate(()=>window.qaAsyncDone),'image callback completion');}
  const afterLate=await bytes();fs.writeFileSync(path.join(q,'files/after-finalize.hwpx'),afterLate);rows.push({name:'edit attempt after successful finalize reply',scenario,errors,beforeSHA256:sha(beforeLate),afterSHA256:sha(afterLate),state:await state()});
  if(baseline)assert.notEqual(sha(afterLate),sha(beforeLate));else{assert.deepEqual(afterLate,beforeLate);assert((await state()).locked);if(scenario==='public')assert.equal(errors.length,3);}
  fs.writeFileSync(path.join(q,'release-final-ack'),'released');await until(()=>p.exitCode!==null,'final close');assert.equal(p.exitCode,0);assert.deepEqual(fs.readFileSync(path.join(q,'files/before-close.hwpx')),beforeLate);rows.push({name:baseline?'baseline loses post-finalize edits on normal close':'post-finalize writes blocked and exact saved document retained'});
 }
 write('proof.json',{scenario,baseline,actualElectron:true,controlledNativeResponses:true,OSChooserVerified:false,physicalIMEVerified:false,rows});console.log(JSON.stringify(rows));
}catch(e){failure=String(e);write('failure.json',{failure,stack:e.stack,rows,state:p?.exitCode===null&&page?await state().catch(String):null});console.error(e);process.exitCode=1;}
finally{
 if(p?.exitCode===null){if(scenario==='pending-render')await frame.evaluate(()=>window.qaReleaseRender?.()).catch(()=>{});fs.writeFileSync(path.join(q,'release-final-ack'),'finally');if(baseline&&scenario==='cancel')await page.evaluate(()=>{window.baramPrepareClose=()=>{throw Error('QA owned baseline exit');};}).catch(()=>{});control({id:'quit',quit:true,choice:'discard',unavailableChoice:'exit'});try{await until(()=>p.exitCode!==null,'normal cleanup');}catch(e){failure=failure||String(e);}}
 normalQuit=p?.exitCode===0;b?.disconnect();write('lifecycle.json',{normalQuit,exitCode:p?.exitCode,failure});if(!normalQuit)process.exitCode=1;
}

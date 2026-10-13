// Actual Mac Electron/HWP/WASM status ownership regression. Synthetic inputs only.
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
  const observations=[];
  const status=()=>frame.evaluate(()=>document.getElementById('sb-message').textContent);
  const setStatus=text=>frame.evaluate(text=>{document.getElementById('sb-message').textContent=text;},text);
  const installHook=options=>frame.evaluate(options=>{
   const w=window.__wasm,descriptor=Object.getOwnPropertyDescriptor(w,'renderPageSvgWithProfile'),original=w.renderPageSvgWithProfile;
   window.__qaStatusHook={descriptor,original,calls:[],external:[]};
   Object.defineProperty(w,'renderPageSvgWithProfile',{configurable:true,writable:true,value:function(i,profile){
    const saved=window.__qaStatusHook;saved.calls.push([i,profile]);
    if(options.fail&&i===1&&profile==='print')throw Error('QA status second-page render failure');
    const svg=original.call(this,i,profile);
    if(i===0&&profile==='print'&&options.message){
     const el=document.getElementById('sb-message');
     if(options.message==='mode'){
      const result=window.rhwpStudio.automation.execute('view:form-mode');if(!result.ok)throw Error('form-mode command failed');
     }else if(options.message==='equal'){el.textContent=el.textContent;}
     else{el.textContent=options.message;}
     saved.external.push(el.textContent);
    }
    return svg;
   }});
  },options);
  const restoreHook=()=>frame.evaluate(()=>{
   const h=window.__qaStatusHook;
   if(h.descriptor)Object.defineProperty(window.__wasm,'renderPageSvgWithProfile',h.descriptor);
   else delete window.__wasm.renderPageSvgWithProfile;
   delete window.__qaStatusHook;return {calls:h.calls,external:h.external};
  });
  const printSuccess=async(hook=false,existing=null,priorCount=readyEvents)=>{
   const count=priorCount,child=existing||await preview();await until(()=>readyEvents>count,'print ready');
   await child.evaluate(()=>{window.print=()=>{console.error('QA_OS_PRINT_BLOCKED');throw Error('QA forbids OS print');};});
   const hookResult=hook?await restoreHook():null;
   const value=await status();await preserved(before);
   const expected=await frame.evaluate(()=>{const tree=n=>n.nodeType===1?{name:n.nodeName,attrs:[...n.attributes].map(a=>[a.name,a.value]).sort((a,b)=>a[0].localeCompare(b[0])),children:[...n.childNodes].map(tree)}:{type:n.nodeType,text:n.textContent};return Array.from({length:window.__wasm.pageCount},(_,i)=>JSON.stringify(tree(new DOMParser().parseFromString(window.__wasm.renderPageSvgWithProfile(i,'print'),'image/svg+xml').documentElement)));});
   const actual=await child.evaluate(()=>[...document.querySelectorAll('.page svg')].map((e,i)=>{const prefix='rhwp-print-page-'+(i+1)+'-',tree=n=>n.nodeType===1?{name:n.nodeName,attrs:[...n.attributes].map(a=>[a.name,a.value.replaceAll(prefix,'')]).sort((a,b)=>a[0].localeCompare(b[0])),children:[...n.childNodes].map(tree)}:{type:n.nodeType,text:n.textContent};return JSON.stringify(tree(e));}));
   assert.deepEqual(actual.map(sha),expected.map(sha));
   await child.evaluate(()=>document.getElementById('close-btn').click());await until(()=>child.isClosed(),'close');await preserved(before);
   return {status:value,hookResult,fullPrintSVG:true};
  };
  const cancelPdf=async()=>{
   assert((await command('file:print-to-pdf')).ok);
   await until(()=>frame.evaluate(()=>!!document.querySelector('[data-testid="pdf-print-dialog"]')),'PDF guidance');
   await frame.evaluate(()=>document.querySelector('[aria-label="PDF로 저장"] .dialog-footer .dialog-btn:not(.dialog-btn-primary)').click());
   await preserved(before);return status();
  };
  const printFailure=async(options={},pdf=false)=>{
   const prior=consoleEvents.length;await installHook({...options,fail:true});
   assert((await command(pdf?'file:print-to-pdf':'file:print')).ok);
   if(pdf){await until(()=>frame.evaluate(()=>!!document.querySelector('[data-testid="pdf-print-dialog"]')),'PDF guidance');await frame.evaluate(()=>document.querySelector('[aria-label="PDF로 저장"] .dialog-btn-primary').click());}
   await until(()=>consoleEvents.slice(prior).some(x=>x.includes('QA status second-page render failure')),'render rejected');
   await until(async()=>(await previewPages()).length===0,'incomplete child closed');
   const hook=await restoreHook();assert.deepEqual(hook.calls,[[0,'print'],[1,'print']]);
   if(pdf){await until(()=>frame.evaluate(()=>!!document.querySelector('.dialog-pdf-error:not([hidden])')),'PDF error');await frame.evaluate(()=>document.querySelector('[aria-label="PDF로 저장"] .dialog-footer .dialog-btn:not(.dialog-btn-primary)').click());}
   await preserved(before);return {status:await status(),hook};
  };
  const normal='QA_STATUS_NORMAL_'+ext;
  await setStatus(normal);const failed=await printFailure();assert.match(failed.status,/인쇄 미리보기 실패/);
  assert.equal(await cancelPdf(),failed.status,'guidance cancel leaves the prior failure visible');
  const recovered=await printSuccess();
  assert.equal(recovered.status,mode==='fixed'?normal:failed.status);
  observations.push({case:'failure-cancel-success',failed:failed.status,recovered:recovered.status,original:normal});
  await setStatus(normal);const pdfFailed=await printFailure({},true);assert.match(pdfFailed.status,/PDF 준비 실패/);
  const fromPdf=await printSuccess();assert.equal(fromPdf.status,mode==='fixed'?normal:pdfFailed.status);
  observations.push({case:'pdf-failure-preview-success',failed:pdfFailed.status,recovered:fromPdf.status});
  await setStatus(normal);await installHook({message:'QA_NEWER_WORK_MESSAGE'});const newer=await printSuccess(true);
  assert.equal(newer.status,mode==='fixed'?'QA_NEWER_WORK_MESSAGE':normal);
  observations.push({case:'newer-during-success',...newer});
  await setStatus(normal);await installHook({message:'mode'});const modeRace=await printSuccess(true);
  assert.equal(await frame.evaluate(()=>window.rhwpStudio.automation.getContext().isFormMode),true);
  assert.equal(modeRace.status,mode==='fixed'?'양식 모드':normal);
  observations.push({case:'actual-form-mode-command-during-success',...modeRace});
  assert((await command('view:form-mode')).ok);assert.equal(await status(),'기본 편집 모드');await preserved(before);
  await setStatus(normal);await installHook({message:'equal'});const sameText=await printSuccess(true);
  assert.equal(sameText.status,mode==='fixed'?sameText.hookResult.external[0]:normal);
  observations.push({case:'identical-text-external-write-during-success',...sameText});
  await setStatus(normal);const newerFailure=await printFailure({message:'QA_NEWER_WORK_BEFORE_ERROR'});
  assert.equal(newerFailure.status,mode==='fixed'?'QA_NEWER_WORK_BEFORE_ERROR':'인쇄 미리보기 실패: QA status second-page render failure');
  observations.push({case:'newer-during-failure',...newerFailure});
  await setStatus(normal);const betweenFailure=await printFailure();await setStatus('QA_NEWER_BETWEEN_ATTEMPTS');
  const between=await printSuccess();assert.equal(between.status,'QA_NEWER_BETWEEN_ATTEMPTS');
  observations.push({case:'newer-between-attempts',failed:betweenFailure.status,...between});
  await setStatus(normal);const identicalFailure=await printFailure();await setStatus(identicalFailure.status);
  const identical=await printSuccess();assert.equal(identical.status,identicalFailure.status,'externally rewritten identical error remains externally owned');
  observations.push({case:'identical-error-between-attempts',...identical});
  if(mode==='fixed'){
   await setStatus(normal);const count=readyEvents;
   await frame.evaluate(()=>{
    window.__qaStatusOriginalOpen=window.open;
    window.open=function(...args){const child=window.__qaStatusOriginalOpen.apply(this,args);
     if(child)child.addEventListener('load',()=>{child.__qaNativeFrame=child.requestAnimationFrame;child.__qaLateFrames=[];child.requestAnimationFrame=fn=>{child.__qaLateFrames.push(fn);return 0;};},{once:true});
     return child;
    };
   });
   let lateChild;
   try{lateChild=await preview();await until(()=>lateChild.evaluate(()=>window.__qaLateFrames.length>0),'late completion frame held');}
   finally{await frame.evaluate(()=>{window.open=window.__qaStatusOriginalOpen;delete window.__qaStatusOriginalOpen;});}
   const duplicate=await frame.evaluate(()=>{
    document.getElementById('sb-message').textContent='QA_NEWER_WHILE_COMPLETION_HELD';
    return window.rhwpStudio.automation.execute('file:print',undefined,{allowDialog:true});
   });
   assert(duplicate.ok);assert.equal((await previewPages()).length,1,'duplicate request opens no second child');
   assert(await frame.evaluate(()=>document.querySelector('#rhwp-toast-container')?.textContent.includes('인쇄 문서를 준비하고 있습니다.')),'duplicate request is acknowledged');
   await lateChild.evaluate(()=>{const callbacks=window.__qaLateFrames;window.requestAnimationFrame=window.__qaNativeFrame;delete window.__qaLateFrames;delete window.__qaNativeFrame;callbacks.forEach(fn=>fn(performance.now()));});
   const late=await printSuccess(false,lateChild,count);assert.equal(late.status,'QA_NEWER_WHILE_COMPLETION_HELD');
   observations.push({case:'duplicate-request-and-late-completion',singleChild:true,...late});
  }
  rows.push({ext,before,observations,documentAndHistoryPreserved:true,OSPrintCalls:0});
  assert((await command('edit:redo')).ok);await settle();assert.equal((await state()).hwp,second.hwp,'retained redo works');assert((await command('edit:undo')).ok);await settle();assert.equal((await state()).hwp,first.hwp,'retained undo works');
  write('progress.json',rows);write('console-events.json',consoleEvents);budget.check();console.log('PASS '+mode+' '+ext);
  if(mode==='baseline')break;
 }
 assert.deepEqual(errors,[]);assert.equal(blockedOSPrintCalls,0,'no OS print attempts across frames and children');
 await frame.evaluate(()=>window.rhwpStudio.notifySaved());control({id:'normal-quit',quit:true,choice:'cancel'});await until(()=>p.exitCode!==null,'normal quit');assert.equal(p.exitCode,0);normalQuit=true;
 write('proof.json',{mode,rows,dialogs,errors,receivedEngineSHA256,actualMacElectron:true,electron:'44.3.0',instrumentedReadHandles:true,syntheticFixturesOnly:true,nativeFileChooserControlled:true,OSPrintDialogVerified:false,OSPrintCallsBlocked:true,scope:'actual HWP/WASM print status failure/success and external-message ownership races',physicalPrinterOutput:false,normalQuit,exitCode:p.exitCode,budget:budget.check()});
}catch(e){failure=String(e);write('failure.json',{failure,stack:e.stack,rows,dialogs,errors});write('console-events.json',consoleEvents);throw e;}
finally{
 clearInterval(monitor);
 if(failure&&frame&&!frame.detached){
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

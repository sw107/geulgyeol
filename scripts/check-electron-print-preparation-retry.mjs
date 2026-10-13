// Actual Mac Electron/HWP/WASM recovery regression. Synthetic inputs only.
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
  const status=()=>frame.evaluate(()=>document.getElementById('sb-message')?.textContent);
  const fault=()=>frame.evaluate(()=>{
   const w=window.__wasm, descriptor=Object.getOwnPropertyDescriptor(w,'renderPageSvgWithProfile'),original=w.renderPageSvgWithProfile;
   window.__qaRenderFault={descriptor,original,calls:[]};
   Object.defineProperty(w,'renderPageSvgWithProfile',{configurable:true,writable:true,value:function(i,profile){
    window.__qaRenderFault.calls.push([i,profile]);
    if(i===1&&profile==='print')throw Error('QA controlled second-page render failure');
    return original.call(this,i,profile);
   }});
  });
  const restore=()=>frame.evaluate(()=>{
   const saved=window.__qaRenderFault, calls=saved.calls;
   if(saved.descriptor)Object.defineProperty(window.__wasm,'renderPageSvgWithProfile',saved.descriptor);
   else delete window.__wasm.renderPageSvgWithProfile;
   delete window.__qaRenderFault;return calls;
  });
  const verifyRetry=async()=>{
   const priorReadyEvents=readyEvents;
   const child=await preview();
   await until(()=>readyEvents>priorReadyEvents,'preview preparation complete');
   await child.evaluate(()=>{window.print=()=>{console.error('QA_OS_PRINT_BLOCKED');throw Error('QA forbids OS print');};});
   child.on('console',m=>{if(m.text()==='QA_OS_PRINT_BLOCKED')blockedOSPrintCalls++;});
   const expected=await frame.evaluate(()=>{const tree=n=>n.nodeType===1?{name:n.nodeName,attrs:[...n.attributes].map(a=>[a.name,a.value]).sort((a,b)=>a[0].localeCompare(b[0])),children:[...n.childNodes].map(tree)}:{type:n.nodeType,text:n.textContent};return Array.from({length:window.__wasm.pageCount},(_,i)=>JSON.stringify(tree(new DOMParser().parseFromString(window.__wasm.renderPageSvgWithProfile(i,'print'),'image/svg+xml').documentElement)));});
   const actual=await child.evaluate(()=>[...document.querySelectorAll('.page svg')].map((e,i)=>{const prefix='rhwp-print-page-'+(i+1)+'-',tree=n=>n.nodeType===1?{name:n.nodeName,attrs:[...n.attributes].map(a=>[a.name,a.value.replaceAll(prefix,'')]).sort((a,b)=>a[0].localeCompare(b[0])),children:[...n.childNodes].map(tree)}:{type:n.nodeType,text:n.textContent};return JSON.stringify(tree(e));}));
   assert.deepEqual(actual.map(sha),expected.map(sha),'complete retry SVG nodes, attributes and text');
   await preserved(before);const restoredStatus=await status();
   await child.evaluate(()=>document.querySelector('#close-btn').click());await until(()=>child.isClosed(),'retry close');
   assert.equal((await previewPages()).length,0);await preserved(before);
   return {fullPrintSVG:true,closePreserves:true,status:restoredStatus};
  };
  await fault();assert((await command('file:print')).ok);
  await until(async()=>/QA controlled second-page render failure/.test(await status()),'preview render rejection');
  await until(async()=>(await previewPages()).length===0,'failed preview closed');
  const previewFaultCalls=await restore();assert.deepEqual(previewFaultCalls,[[0,'print'],[1,'print']]);
  await preserved(before);const afterPreviewFailure=await verifyRetry();
  assert.equal(await frame.evaluate(()=>window.rhwpStudio.automation.isEnabled('file:print-to-pdf')),true,'PDF command available');
  const pdfCancel=command('file:print-to-pdf');assert((await pdfCancel).ok);
  await until(()=>frame.evaluate(()=>!!document.querySelector('[data-testid="pdf-print-dialog"]')),'PDF guidance');
  await frame.evaluate(()=>document.querySelector('[aria-label="PDF로 저장"] .dialog-footer .dialog-btn:not(.dialog-btn-primary)').click());
  assert((await pdfCancel).ok);await preserved(before);
  assert.equal(await frame.evaluate(()=>document.querySelectorAll('#rhwp-print-surface').length),0);
  const afterPdfCancel=await verifyRetry();
  await fault();const pdfFailure=command('file:print-to-pdf');assert((await pdfFailure).ok);
  await until(()=>frame.evaluate(()=>!!document.querySelector('[data-testid="pdf-print-dialog"]')),'second PDF guidance');
  await frame.evaluate(()=>document.querySelector('[aria-label="PDF로 저장"] .dialog-btn-primary').click());
  assert((await pdfFailure).ok);
  await until(()=>frame.evaluate(()=>document.querySelector('.dialog-pdf-error')?.textContent.includes('QA controlled second-page render failure')),'PDF render error');
  await until(async()=>/PDF 준비 실패: QA controlled second-page render failure/.test(await status()),'PDF failure finalized');
  const pdfFaultCalls=await restore();assert.deepEqual(pdfFaultCalls,[[0,'print'],[1,'print']]);
  assert.equal(await frame.evaluate(()=>document.querySelectorAll('#rhwp-print-surface').length),0);
  await preserved(before);
  await frame.evaluate(()=>document.querySelector('[aria-label="PDF로 저장"] .dialog-footer .dialog-btn:not(.dialog-btn-primary)').click());
  const afterPdfFailure=await verifyRetry();
  // Deterministically close after the real readiness path requests a frame.
  // A closed window never delivers the queued frame in Chromium.
  await frame.evaluate(()=>{
   window.__qaOriginalOpen=window.open;
   window.open=function(...args){const child=window.__qaOriginalOpen.apply(this,args);
    if(child)child.addEventListener('load',()=>{child.__qaPendingFrameCalls=0;child.requestAnimationFrame=()=>{child.__qaPendingFrameCalls++;return 0;};},{once:true});
    return child;
   };
  });
  let early;
  try{early=await preview();await until(()=>early.evaluate(()=>window.__qaPendingFrameCalls>0),'actual readiness awaiting frame');}
  finally{await frame.evaluate(()=>{window.open=window.__qaOriginalOpen;delete window.__qaOriginalOpen;});}
  await early.evaluate(()=>window.close());await until(()=>early.isClosed(),'early preview close');
  await preserved(before);await pause(150);
  assert((await command('file:print-to-pdf')).ok);
  let earlyCloseRecovery;
  if(mode==='baseline'){
   await pause(250);
   assert.equal(await frame.evaluate(()=>!!document.querySelector('[data-testid="pdf-print-dialog"]')),false);
   assert(await frame.evaluate(()=>[...document.querySelectorAll('#rhwp-toast-container [role="status"]')].some(x=>x.textContent.includes('인쇄 문서를 준비하고 있습니다.'))),'baseline guard still busy');
   earlyCloseRecovery={reproduced:true,readinessFrameDiscarded:true,subsequentPdfGuidanceBlocked:true};
  }else{
   await until(()=>frame.evaluate(()=>!!document.querySelector('[data-testid="pdf-print-dialog"]')),'PDF guidance after early preview close');
   await frame.evaluate(()=>document.querySelector('[aria-label="PDF로 저장"] .dialog-footer .dialog-btn:not(.dialog-btn-primary)').click());
   await preserved(before);earlyCloseRecovery={readinessFrameDiscarded:true,pdfGuidanceCanceled:true,retry:await verifyRetry()};
  }
  assert.equal(await frame.evaluate(()=>window.__qaPrintCalls),0,'no OS print invocation');
  rows.push({ext,earlyCloseRecovery,before,previewFaultCalls,pdfFaultCalls,afterPreviewFailure,afterPdfCancel,afterPdfFailure,pdfGuidanceCanceled:true,failedSurfacesRemoved:true,OSPrintCalls:0});
  assert((await command('edit:redo')).ok);await settle();assert.equal((await state()).hwp,second.hwp,'retained redo works');assert((await command('edit:undo')).ok);await settle();assert.equal((await state()).hwp,first.hwp,'retained undo works');
  write('progress.json',rows);write('console-events.json',consoleEvents);budget.check();console.log('PASS '+mode+' '+ext);
  if(mode==='baseline')break;
 }
 assert.deepEqual(errors,[]);assert.equal(blockedOSPrintCalls,0,'no OS print attempts across frames and children');
 await frame.evaluate(()=>window.rhwpStudio.notifySaved());control({id:'normal-quit',quit:true,choice:'cancel'});await until(()=>p.exitCode!==null,'normal quit');assert.equal(p.exitCode,0);normalQuit=true;
 write('proof.json',{mode,rows,dialogs,errors,receivedEngineSHA256,actualMacElectron:true,electron:'44.3.0',instrumentedReadHandles:true,syntheticFixturesOnly:true,nativeFileChooserControlled:true,OSPrintDialogVerified:false,OSPrintCallsBlocked:true,scope:'actual HWP/WASM render rejection, PDF guidance cancellation and retry',physicalPrinterOutput:false,normalQuit,exitCode:p.exitCode,budget:budget.check()});
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

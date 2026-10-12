// Actual Electron source QA. Synthetic fixtures only; no physical printer output.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
const root=process.env.GEULGYEOL_QA_SOURCE_ROOT||path.resolve(import.meta.dirname,'..');
const {installNativePrintObserver}=await import(path.join(root,'scripts/native-print-observer.mjs'));
const {finishOwnedQA}=await import(path.join(root,'scripts/electron-qa-exit.mjs'));
const {default:puppeteer}=await import(path.join(root,'rhwp-studio/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js'));
const {EvidenceBudget}=await import(path.join(root,'scripts/qa-evidence-budget.mjs'));
const q=path.resolve(process.argv[2]),mode=process.argv[3];
assert(['blocked','fixed'].includes(mode));
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
const nativeStage=(ext,key,value=true)=>{nativeStages[ext]??={called:false,sheetObserved:false,canceled:false,rendererReturned:false};nativeStages[ext][key]=value;write('native-print-stages.json',nativeStages);};
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
 page.on('dialog',d=>{dialogs.push(d.message());d.dismiss().catch(e=>{if(!String(e).includes('No dialog is showing'))errors.push(String(e));});});page.on('pageerror',e=>errors.push(String(e)));
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
  const count=dialogs.length;
  if(mode==='blocked'){
   assert((await command('file:print')).ok);await until(()=>audit().some(e=>e.kind==='close-confirmation'&&e.plan==='open-'+ext&&/팝업이 차단/.test(e.options.message)),'blocked alert');assert.equal((await previewPages()).length,0);await preserved(before);
   rows.push({ext,blocked:true,before});
  }else{
   const child=await preview();child.on('pageerror',e=>errors.push(String(e)));
   let nativePrintCanceled=false;
   const visible=await child.evaluate(()=>({pages:document.querySelectorAll('.page').length,title:document.querySelector('.print-preview-title').textContent,text:[...document.querySelectorAll('.page svg text')].map(t=>t.textContent).join(''),bridge:typeof window.baram,require:typeof window.require}));
   assert.equal(visible.pages,2);assert.match(visible.title,/2쪽/);assert.match(visible.text,/PRINT_51/);assert.equal(visible.require,'undefined');assert.equal(visible.bridge,'undefined');await preserved(before);
   // Compare all parsed SVG nodes, not just page count or selected tokens.
   const expected=await frame.evaluate(()=>{const tree=n=>n.nodeType===1?{name:n.nodeName,attrs:[...n.attributes].map(a=>[a.name,a.value]).sort((a,b)=>a[0].localeCompare(b[0])),children:[...n.childNodes].map(tree)}:{type:n.nodeType,text:n.textContent};return Array.from({length:window.__wasm.pageCount},(_,i)=>JSON.stringify(tree(new DOMParser().parseFromString(window.__wasm.renderPageSvgWithProfile(i,'print'),'image/svg+xml').documentElement)));});
   const actual=await child.evaluate(()=>[...document.querySelectorAll('.page svg')].map((e,i)=>{const prefix='rhwp-print-page-'+(i+1)+'-',tree=n=>n.nodeType===1?{name:n.nodeName,attrs:[...n.attributes].map(a=>[a.name,a.value.replaceAll(prefix,'')]).sort((a,b)=>a[0].localeCompare(b[0])),children:[...n.childNodes].map(tree)}:{type:n.nodeType,text:n.textContent};return JSON.stringify(tree(e));}));assert.deepEqual(actual.map(sha),expected.map(sha),'all SVG nodes, attributes and text');
   // Native UI observations are captured by the allowed observer.
   if(process.env.GEULGYEOL_QA_NATIVE_PRINT_CANCEL==='1'){
    for(const attempt of [1,2]){const nativeKey=ext+'-'+attempt;
    write('before-native-print-'+nativeKey+'.json',before);
    // Observe entry into the real print function without changing its behavior.
    await child.evaluate(installNativePrintObserver,nativeKey);
    nativeStage(nativeKey,'prepared');
    write('native-print-ready-'+nativeKey+'.json',{ext,attempt,ownedQA:true,documentName:'print-input.'+ext});console.log('WAIT native print cancel '+ext);
    // A UI observer must bind this exact QA preview first. A prepared marker
    // proves neither that print was called nor that an OS sheet appeared.
    await until(()=>fs.existsSync(path.join(q,'native-print-observer-ready-'+nativeKey+'.json')),'exact QA UI observer '+nativeKey,900000);
    nativeStage(nativeKey,'callRequested');
    child.on('console',message=>{if(message.text()==='[qa-native-print-called] '+nativeKey)nativeStage(nativeKey,'called');});
    // Modal window.print may hold CDP until cancellation. Handle rejection
    // immediately; neither its pending state nor timeout proves sheet creation.
    // Native UI observer clicks the exact preview's real print button.
    // Do not dispatch a modal print through a pending CDP request.
    write('native-print-call-ready-'+nativeKey+'.json',{ext,attempt,documentName:'print-input.'+ext,ownedQA:true});
    await until(()=>fs.existsSync(path.join(q,'native-print-canceled-'+nativeKey+'.json')),'observed native print cancel '+nativeKey,900000);
    const receipt=JSON.parse(fs.readFileSync(path.join(q,'native-print-canceled-'+nativeKey+'.json')));
    assert(receipt.nativeDialogObserved&&receipt.cancelButtonInvoked&&receipt.noPrinterOutput);
    assert.equal(receipt.documentName,'print-input.'+ext,'UI receipt belongs to this synthetic QA document');
    await until(()=>nativeStages[nativeKey].called===true,'real print entry '+nativeKey,5000);
    nativeStage(nativeKey,'sheetObserved');nativeStage(nativeKey,'canceled');
    assert(await child.evaluate(()=>!!document.querySelector('#close-btn')),'renderer returned after native cancellation');
    await preserved(before);nativeStage(nativeKey,'rendererReturned');nativePrintCanceled=true;
    }
   }
   // Child navigation and child popups remain blocked, including a local URL.
   assert.equal(await child.evaluate(()=>window.open('/studio/print.html','_blank')===null),true);
   const url=child.url();await child.evaluate(()=>{location.href='/';});await pause(200);assert.equal(child.url(),url);await preserved(before);
   await child.evaluate(()=>document.querySelector('#close-btn').click());await until(()=>child.isClosed(),'preview close');await preserved(before);
   assert.equal(await frame.evaluate(()=>window.open('/studio/print.html?unapproved=1','_blank')===null),true);
   assert.equal(await frame.evaluate(()=>window.open('https://example.com/','_blank')===null),true);
   // Replacement keeps a single app-owned preview; the old one closes normally.
   const old=await preview();const replacement=await preview();await until(()=>old.isClosed(),'replace old preview');assert.equal((await previewPages()).length,1);await preserved(before);
   await replacement.evaluate(()=>window.close());await until(()=>replacement.isClosed(),'window close');await preserved(before);
   assert.equal(dialogs.length,count,'no blocked-popup alert on supported print');
   rows.push({ext,visible,fullPrintSVG:true,before,closePreserves:true,replacementPreserves:true,nativePrintCanceled});
  }
  assert((await command('edit:redo')).ok);await settle();assert.equal((await state()).hwp,second.hwp,'retained redo works');assert((await command('edit:undo')).ok);await settle();assert.equal((await state()).hwp,first.hwp,'retained undo works');
  if(process.env.GEULGYEOL_QA_NATIVE_PRINT_CANCEL==='1'){
   const savedState=await state();control({id:'preserve-synthetic-'+ext,canceled:false,file:'native-preserved-'+ext+'.'+ext,choice:'cancel'});
   write('native-save-ready-'+ext+'.json',{ext,documentName:'print-input.'+ext});console.log('WAIT owned synthetic save '+ext);
   await until(()=>fs.existsSync(path.join(q,'native-save-clicked-'+ext+'.json')),'UI synthetic save '+ext,900000);
   await until(()=>frame.evaluate(()=>!window.baramHost.state().dirty),'durable clean after synthetic save');
   const saved=fs.readFileSync(path.join(q,'files','native-preserved-'+ext+'.'+ext));assert.equal(sha(saved),savedState[ext],'save preserves edited synthetic bytes');
   write('native-saved-'+ext+'.json',{ext,sha256:sha(saved),dirtyAfterSave:false,actualIPCAndFilesystem:true});
  }
  write('progress.json',rows);budget.check();console.log('PASS '+mode+' '+ext);
 }
 assert.deepEqual(errors,[]);
 await frame.evaluate(()=>window.rhwpStudio.notifySaved());control({id:'normal-quit',quit:true,choice:'cancel'});await until(()=>p.exitCode!==null,'normal quit');assert.equal(p.exitCode,0);normalQuit=true;
 write('proof.json',{mode,rows,dialogs,errors,receivedEngineSHA256,actualMacElectron:true,electron:'44.3.0',instrumentedReadHandles:true,syntheticFixturesOnly:true,nativeFileChooserControlled:true,OSPrintDialogVerified:rows.every(r=>r.nativePrintCanceled===true),physicalPrinterOutput:false,normalQuit,exitCode:p.exitCode,budget:budget.check()});
}catch(e){failure=String(e);write('failure.json',{failure,stack:e.stack,rows,dialogs,errors});throw e;}
finally{
 clearInterval(monitor);
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

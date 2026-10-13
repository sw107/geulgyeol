// Actual Mac Electron/HWP/WASM find/replace stale hit regression. Synthetic inputs only.
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
// Electron atomically replaces Preferences while the evidence scan is running.
// Retry a full scan only for a vanished temporary Preferences file in this app.
function checkBudget(){
 for(let attempt=0;attempt<3;attempt++)try{return budget.check();}catch(e){
  const dir=path.join(q,'app-data','GeulgyeolBeta3');
  if(e.code!=='ENOENT'||path.dirname(e.path||'')!==dir||!path.basename(e.path).startsWith('.com.github.Electron.Preferences.')||attempt===2)throw e;
 }
}
budget.started=true; checkBudget();
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
async function state(checkpoint){
 const s=await frame.evaluate(()=>{
  const w=window.__wasm,h=window.__inputHandler;
  const hwp=Array.from(window.baramHost.export('hwp')),hwpx=Array.from(window.baramHost.export('hwpx'));
  const cursor=h.getCursorPosition(),storedCaret=JSON.parse(w.doc.getStoredCaret()),interpretedCaret=w.getCaretPosition();
  // Compare every serialized byte at a common saved caret. Keep production
  // exports and their caret separately; never mask bytes or move the UI cursor.
  const hook=w.onBeforeExport;let canonicalHwp,canonicalHwpx,canonicalCaret;
  try{w.onBeforeExport=()=>w.setCaretPosition(0,0,0);
   canonicalHwp=Array.from(window.baramHost.export('hwp'));canonicalHwpx=Array.from(window.baramHost.export('hwpx'));canonicalCaret=w.getCaretPosition();
  }finally{w.onBeforeExport=hook;hook?.();}
  return {host:window.baramHost.state(),pages:w.pageCount,text:w.doc.getTextFileText(),svg:Array.from({length:w.pageCount},(_,i)=>w.renderPageSvg(i)),printSvg:Array.from({length:w.pageCount},(_,i)=>w.renderPageSvgWithProfile(i,'print')),hwp,hwpx,canonicalHwp,canonicalHwpx,cursor,selection:h.cursor.getSelection(),storedCaret,interpretedCaret,canonicalCaret,history:{u:h.history.undoStack.length,r:h.history.redoStack.length},pending:h.hasDeferredPaginationPending()};
 });
 const expected={sectionIndex:s.cursor.sectionIndex,paragraphIndex:s.cursor.parentParaIndex??s.cursor.paragraphIndex,charOffset:s.cursor.parentParaIndex!==undefined?0:s.cursor.charOffset};
 assert.deepEqual(s.interpretedCaret,expected,'production export stamps the actual UI caret');
 assert.deepEqual(s.canonicalCaret,{sectionIndex:0,paragraphIndex:0,charOffset:0});
 for(const [key,ext] of [['hwp','hwp'],['hwpx','hwpx'],['canonicalHwp','canonical.hwp'],['canonicalHwpx','canonical.hwpx']]){
  const bytes=Buffer.from(s[key]);if(checkpoint)fs.writeFileSync(path.join(q,'files',checkpoint+'.'+ext),bytes,{flag:'wx'});s[key]=sha(bytes);
 }
 s.svg=s.svg.map(sha);s.printSvg=s.printSvg.map(sha);
 if(checkpoint)write(checkpoint+'.json',s);return s;
}
function sameDocument(actual,expected){
 for(const key of ['canonicalHwp','canonicalHwpx','text','svg','printSvg','pages'])assert.deepEqual(actual[key],expected[key],'complete document and layout preserved: '+key);
}
const preserved=async before=>assert.deepEqual(await state(),before,'complete bytes, SVG, text, dirty state and history preserved');
try{
 assert.equal(process.platform,'darwin');
 for(const rel of ['main.cjs','preload.cjs','close-controller.cjs','web/baram.js',...(mode==='fixed'?['print-preview.cjs']:[])])assert.deepEqual(fs.readFileSync(path.join(q,'runtime',rel)),fs.readFileSync(path.join(root,'desktop',rel)));
 const fixtures=path.resolve(process.argv[4]);const pins=JSON.parse(fs.readFileSync(path.join(fixtures,'fixture-proof.json')));assert(pins.synthetic&&pins.expectedPages===1);
 for(const row of pins.rows)for(const ext of ['hwp','hwpx']){const bytes=fs.readFileSync(path.join(fixtures,row.name+'.'+ext));assert.equal(sha(bytes),row.filesSHA256[ext]);fs.writeFileSync(path.join(q,'files',row.name+'.'+ext),bytes,{flag:'wx'});}
 control({id:'start',canceled:true});
 const env={...process.env,GEULGYEOL_ELECTRON_MODULE:'electron',GEULGYEOL_QA_DIR:q};delete env.ELECTRON_RUN_AS_NODE;
 p=spawn(path.join(root,'desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),[path.join(q,'bootstrap.cjs'),'--remote-debugging-port=0','--remote-debugging-address=127.0.0.1','--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows'],{env});
 monitor=setInterval(()=>{try{checkBudget();}catch(e){budgetError=e;control({id:'budget-stop-owned-QA',quit:true,choice:'cancel'});}},1000);
 let log='';for(const s of [p.stdout,p.stderr])s.on('data',d=>{log+=d;fs.appendFileSync(path.join(q,'launch.log'),d);});
 await until(()=>{if(p.exitCode!==null)throw Error('app exited '+p.exitCode);return /DevTools listening on (ws:\/\/\S+)/.test(log);},'CDP');
 b=await puppeteer.connect({browserWSEndpoint:log.match(/DevTools listening on (ws:\/\/\S+)/)[1],defaultViewport:null});
 await until(async()=>{page=(await b.pages()).find(x=>/^http:\/\/127\.0\.0\.1:\d+\/$/.test(x.url()));frame=page?.frames().find(f=>f.url().includes('/studio/'));return frame;},'app');
 page.on('console',m=>{const text=m.text();consoleEvents.push(text);if(text==='QA_OS_PRINT_BLOCKED')blockedOSPrintCalls++;if(text.startsWith('[file:print] 인쇄 미리보기 준비 완료'))readyEvents++;});
 page.on('dialog',d=>{dialogs.push(d.message());d.dismiss().catch(e=>{if(!String(e).includes('No dialog is showing'))errors.push(String(e));});});page.on('pageerror',e=>errors.push(String(e)));
 await page.evaluateOnNewDocument(()=>{window.__qaPrintCalls=0;window.print=()=>{window.__qaPrintCalls++;console.error('QA_OS_PRINT_BLOCKED');throw Error('QA forbids OS print');};});
 await frame.evaluate(()=>{window.__qaPrintCalls=0;window.print=()=>{window.__qaPrintCalls++;console.error('QA_OS_PRINT_BLOCKED');throw Error('QA forbids OS print');};});
 await frame.evaluate(()=>{const settings=JSON.parse(localStorage.getItem('rhwp-settings')||'{}');settings.version=1;settings.autosave={recoveryEnabled:false,recoveryIntervalMinutes:10,idleSaveEnabled:false,idleDelaySeconds:10};localStorage.setItem('rhwp-settings',JSON.stringify(settings));});
 await page.reload({waitUntil:'domcontentloaded'});await until(()=>{frame=page.frames().find(f=>f.url().includes('/studio/'));return frame;},'isolated frame');
 await page.waitForFunction(()=>!document.querySelector('#save').disabled,{timeout:30000});await frame.evaluate(()=>window.rhwpStudio.plugins.load('hwpctrl'));
 const engineAsset=fs.readdirSync(path.join(q,'runtime/web/studio/assets')).find(n=>/^rhwp_bg-.*\.wasm$/.test(n));
 const receivedEngineSHA256=sha(Buffer.from(await(await fetch(new URL('/studio/assets/'+engineAsset,page.url()))).arrayBuffer()));
 assert.equal(receivedEngineSHA256,sha(fs.readFileSync(path.join(root,'pkg/rhwp_bg.wasm'))));
 const click=label=>frame.evaluate(label=>{const button=[...document.querySelectorAll('.find-dialog button')].find(b=>b.textContent===label);if(!button)throw Error('Missing find button '+label);button.click();},label);
 const setQuery=(query,cs=false)=>frame.evaluate(({query,cs})=>{const dialog=document.querySelector('.find-dialog'),inputs=dialog.querySelectorAll('.find-dialog-input');inputs[0].value=query;inputs[0].dispatchEvent(new Event('input',{bubbles:true}));inputs[1].value='Q';const check=dialog.querySelector('input[type=checkbox]');check.checked=cs;check.dispatchEvent(new Event('change',{bubbles:true}));},{query,cs});
 const closeFind=()=>frame.evaluate(()=>document.querySelector('.find-dialog .dialog-close')?.click());
 const position=async(offset=0)=>frame.evaluate(offset=>{const h=window.__inputHandler;h.cursor.clearSelection();h.moveCursorTo({sectionIndex:0,paragraphIndex:0,charOffset:offset});h.focus();},offset);
 async function load(ext,name='find-input'){
  await closeFind();await frame.evaluate(()=>window.rhwpStudio.notifySaved());control({id:'open-'+name+'-'+ext,openFile:name+'.'+ext});await page.evaluate(()=>document.getElementById('open').click());
  await until(()=>frame.evaluate(name=>window.__wasm.fileName===name&&window.__inputHandler.active,name+'.'+ext),'fixture open');await page.waitForFunction(()=>!document.getElementById('save').disabled);await settle();
 }
 async function openFind(query='needle',cs=false){assert((await command('edit:find-replace')).ok);await frame.waitForSelector('.find-dialog');await setQuery(query,cs);await position(0);await click('다음 찾기');}
 async function saveSource(ext,name,expected){control({id:'save-'+name,file:name+'.'+ext});await page.select('#format',ext);await page.evaluate(()=>document.getElementById('save').click());await until(()=>frame.evaluate(()=>!window.baramHost.state().dirty),'durable save');await page.waitForFunction(()=>!document.getElementById('save').disabled);assert.equal(sha(fs.readFileSync(path.join(q,'files',name+'.'+ext))),expected[ext]);}
 for(const ext of ['hwp','hwpx']){
  const cases=[];
  for(const kind of ['query-change','case-change','empty-query','body-edit','document-replace']){
   await load(ext);const clean=await state();
   const prepare=text=>frame.evaluate(text=>{const h=window.__inputHandler;h.executeOperation({kind:'snapshot',operationType:'qa-prepare-text',operation(w){const result=JSON.parse(w.doc.insertText(0,0,0,text));if(!result.ok)throw Error('synthetic preparation rejected');return {sectionIndex:0,paragraphIndex:0,charOffset:text.length};}});},text);
   await prepare('A');await settle();const first=await state();assert.notEqual(first.hwp,clean.hwp);
   await prepare('B');await settle();const second=await state();assert.notEqual(second.hwp,first.hwp);
   assert((await command('edit:undo')).ok);await settle();sameDocument(await state(),first);
   await openFind(kind==='case-change'?'NEEDLE':'needle');
   if(kind==='query-change')await setQuery('NOT_PRESENT');
   if(kind==='case-change')await setQuery('NEEDLE',true);
   if(kind==='empty-query')await setQuery('');
   if(kind==='body-edit'){await position(0);await page.keyboard.sendCharacter('XYZ');await settle();}
   if(kind==='document-replace'){
    const current=await state();await saveSource(ext,'before-document-replace-'+ext,current);
    control({id:'replace-document-'+ext,openFile:'alternate-input.'+ext});await page.evaluate(()=>document.getElementById('open').click());await until(()=>frame.evaluate(ext=>window.__wasm.fileName==='alternate-input.'+ext,ext),'replacement document');await page.waitForFunction(()=>!document.getElementById('save').disabled);await settle();assert(await frame.$('.find-dialog'),'modeless dialog survives document replacement');
   }
   const before=await state(ext+'-'+kind+'-stale-before');await click('바꾸기');await settle();const after=await state(ext+'-'+kind+'-stale-after');
   if(mode==='baseline'){assert.notEqual(after.hwp,before.hwp,'stale hit wrongly mutates document');cases.push({kind,beforeText:JSON.parse(before.text),afterText:JSON.parse(after.text),beforeHistory:before.history,afterHistory:after.history,wrongMutationReproduced:true});continue;}
   if(kind==='body-edit'){
    // Invalidated ranges trigger a fresh search. This intentionally selects
    // the new range but must not edit bytes, mark clean or alter history.
    sameDocument(after,before);for(const key of ['host','history','pending','hwpx'])assert.deepEqual(after[key],before[key]);
    const start=JSON.parse(before.text).indexOf('needle'),anchor={sectionIndex:0,paragraphIndex:0,charOffset:start},focus={...anchor,charOffset:start+6};
    assert.deepEqual(after.cursor,focus);assert.deepEqual(after.selection,{anchor,focus});
   }else assert.deepEqual(after,before,'unmatched stale replace preserves complete exports, state and pending redo');
   if(['query-change','case-change','empty-query'].includes(kind)){assert(before.history.r>0);assert((await command('edit:redo')).ok);await settle();sameDocument(await state(),second);assert((await command('edit:undo')).ok);await settle();const returned=await state();sameDocument(returned,before);}
   await setQuery(kind==='document-replace'?'safe':'needle');await position(0);await click('다음 찾기');const prefix=ext+'-'+kind;const replacementBefore=await state(prefix+'-original');await click('바꾸기');await settle();const replaced=await state(prefix+'-replaced');
   assert.equal(JSON.parse(replaced.text),JSON.parse(before.text).replace(kind==='document-replace'?'safe':'needle','Q'),'only the newly matched text is replaced');
   assert((await command('edit:undo')).ok);await settle();const undone=await state(prefix+'-undone');sameDocument(undone,replacementBefore);assert.deepEqual(undone.history,{u:replaced.history.u-1,r:1});
   assert((await command('edit:redo')).ok);await settle();const redone=await state(prefix+'-redone');sameDocument(redone,replaced);assert.deepEqual(redone.history,replaced.history);
   await closeFind();const saveBefore=await state(prefix+'-save-before');sameDocument(saveBefore,replaced);
   const saved=[];for(const format of ['hwp','hwpx']){const name='find-'+ext+'-'+kind+'-'+format;await saveSource(format,name,saveBefore);saved.push({name:name+'.'+format,format,sha256:saveBefore[format]});}
   for(const item of saved){control({id:'reopen-'+item.name,openFile:item.name});await page.evaluate(()=>document.getElementById('open').click());await until(()=>frame.evaluate(name=>window.baramHost.state().fileName===name&&window.__inputHandler.active,item.name),'reopen replaced document '+item.name);await page.waitForFunction(()=>!document.getElementById('save').disabled);await settle();const reopened=await state(prefix+'-reopened-'+item.format);assert.equal(reopened.host.fileName,item.name);    for(const key of ['text','svg','printSvg','pages'])assert.deepEqual(reopened[key],saveBefore[key],'saved document data/layout: '+key);
    if(item.format===ext){
     const key=ext==='hwp'?'canonicalHwp':'canonicalHwpx';assert.equal(reopened[key],saveBefore[key],'source-format roundtrip full bytes');item.sourceFormatFullBytesEqual=true;
    }else{
     // Cross-format parsing has pre-existing metadata conversions (documented
     // by baseline). Compare every output byte to the unchanged core parser,
     // while independently requiring the editor's expected text and all SVGs.
     const oracle=await frame.evaluate(({bytes,name})=>{
      const w=window.__wasm,M=w.getWasmModuleExports(),d=new M.HwpDocument(new Uint8Array(bytes));
      try{d.convertToEditable();d.ensureParagraphStableIds?.();d.setFileName(name);d.setCaretPosition(0,0,0);return {hwp:Array.from(d.exportHwp()),hwpx:Array.from(d.exportHwpx())};}finally{d.free();}
     },{bytes:Array.from(fs.readFileSync(path.join(q,'files',item.name))),name:item.name});
     assert.equal(reopened.canonicalHwp,sha(Buffer.from(oracle.hwp)));assert.equal(reopened.canonicalHwpx,sha(Buffer.from(oracle.hwpx)));item.crossFormatCoreFullBytesEqual=true;
    }
    item.rawRoundtripFullBytesEqual=reopened[item.format==='hwp'?'canonicalHwp':'canonicalHwpx']===saveBefore[item.format==='hwp'?'canonicalHwp':'canonicalHwpx'];
    assert.equal(reopened.host.dirty,false);assert.deepEqual(reopened.history,{u:0,r:0});}
   cases.push({kind,staleActionPreserved:true,dirtyBefore:before.host.dirty,historyBefore:before.history,pendingRedoVerified:before.history.r>0,newMatchOnly:true,undoRedoVerified:true,fullBytesAtSameCaretVerified:true,productionCaretVerified:true,caretStages:[replacementBefore,replaced,undone,redone].map(s=>({cursor:s.cursor,stored:s.storedCaret,interpreted:s.interpretedCaret,hwp:s.hwp,hwpx:s.hwpx})),savedReopened:saved});
  }
  rows.push({ext,cases});write('progress.json',rows);console.log('PASS '+mode+' '+ext);if(mode==='baseline')break;
 }
 assert.deepEqual(errors,[]);assert.equal(blockedOSPrintCalls,0,'no OS print attempts across frames and children');
 await frame.evaluate(()=>window.rhwpStudio.notifySaved());control({id:'normal-quit',quit:true,choice:'cancel'});await until(()=>p.exitCode!==null,'normal quit');assert.equal(p.exitCode,0);normalQuit=true;
 write('proof.json',{mode,rows,dialogs,errors,receivedEngineSHA256,actualMacElectron:true,electron:'44.3.0',instrumentedReadHandles:true,syntheticFixturesOnly:true,nativeFileChooserControlled:true,OSPrintDialogVerified:false,OSPrintCallsBlocked:true,scope:'actual modeless find/replace stale hit, editing, save/reopen and history',physicalPrinterOutput:false,normalQuit,exitCode:p.exitCode,budget:checkBudget()});
}catch(e){failure=String(e);write('failure.json',{failure,stack:e.stack,rows,dialogs,errors});write('console-events.json',consoleEvents);throw e;}
finally{
 clearInterval(monitor);
 if(failure&&frame&&!frame.detached){
  try{const recovery=await frame.evaluate(()=>({hwp:Array.from(window.baramHost.export('hwp')),hwpx:Array.from(window.baramHost.export('hwpx')),dirty:window.baramHost.state(),history:{u:window.__inputHandler.history.undoStack.length,r:window.__inputHandler.history.redoStack.length}}));
   for(const ext of ['hwp','hwpx'])fs.writeFileSync(path.join(q,'files','failure-preserved.'+ext),Buffer.from(recovery[ext]),{flag:'wx'});
   write('failure-preservation.json',{host:recovery.dirty,history:recovery.history,bytesPreserved:true,renderer:await frame.evaluate(()=>({wasmName:window.__wasm.fileName,host:window.baramHost.state(),active:window.__inputHandler.active}))});
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

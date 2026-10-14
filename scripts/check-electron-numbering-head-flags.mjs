// Actual Mac Electron/HWP/WASM find/replace history serializer diagnostic. Synthetic inputs only.
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
function checkBudget(){for(let attempt=0;attempt<3;attempt++)try{return budget.check();}catch(e){if(e.code!=='ENOENT'||path.dirname(e.path||'')!==path.join(q,'app-data','GeulgyeolBeta3')||!path.basename(e.path).startsWith('.com.github.Electron.Preferences.')||attempt===2)throw e;}}
budget.started=true;checkBudget();
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
async function state(label){
 const s=await frame.evaluate(()=>{
  const w=window.__wasm,h=window.__inputHandler;const hwp=Array.from(window.baramHost.export('hwp')),hwpx=Array.from(window.baramHost.export('hwpx'));
  const hook=w.onBeforeExport;let canonical;
  try{w.onBeforeExport=()=>w.setCaretPosition(0,0,0);canonical={hwp:Array.from(window.baramHost.export('hwp')),hwpx:Array.from(window.baramHost.export('hwpx'))};}finally{w.onBeforeExport=hook;hook?.();}
  const props=Array.from({length:w.doc.getParagraphCount(0)},(_,p)=>({para:JSON.parse(w.doc.getParaPropertiesAt(0,p)),char:JSON.parse(w.doc.getCharPropertiesAt(0,p,0))}));
  return {text:w.doc.getTextFileText(),pages:w.pageCount,svg:Array.from({length:w.pageCount},(_,i)=>w.renderPageSvg(i)),printSvg:Array.from({length:w.pageCount},(_,i)=>w.renderPageSvgWithProfile(i,'print')),props,styles:JSON.parse(w.doc.getStyleList()),hwp,hwpx,canonical,host:window.baramHost.state(),history:{u:h.history.undoStack.length,r:h.history.redoStack.length}};
 });
 for(const ext of ['hwp','hwpx']){const bytes=Buffer.from(s[ext]);if(label)fs.writeFileSync(path.join(q,'files',label+'.'+ext),bytes,{flag:'wx'});s[ext]=sha(bytes);s.canonical[ext]=sha(Buffer.from(s.canonical[ext]));}
 s.svg=s.svg.map(sha);s.printSvg=s.printSvg.map(sha);if(label)write(label+'.json',s);return s;
}
// Formatting undo leaves unused paragraph shapes in DocInfo; semantic equality
// and separately inspected numbering exports are required, not identical table size.
function equalDoc(a,b,{exactBytes=true}={}){for(const key of ['text','pages','svg','printSvg','props','styles',...(exactBytes?['canonical']:[])])assert.deepEqual(a[key],b[key],key+' preserved');}
const preserved=async before=>assert.deepEqual(await state(),before,'complete bytes, SVG, text, dirty state and history preserved');
try{
 assert.equal(process.platform,'darwin');
 for(const rel of ['main.cjs','preload.cjs','close-controller.cjs','web/baram.js',...(mode==='fixed'?['print-preview.cjs']:[])])assert.deepEqual(fs.readFileSync(path.join(q,'runtime',rel)),fs.readFileSync(path.join(root,'desktop',rel)));
 const phaseRoot=path.resolve(process.argv[4]),engine=path.resolve(process.argv[5]);
 const fixtures=path.join(phaseRoot,'fixtures'),pins=JSON.parse(fs.readFileSync(path.join(fixtures,'proof.json')));assert(pins.synthetic&&pins.paragraphs===7);
 for(const row of pins.rows)for(const ext of ['hwp','hwpx']){const source=ext==='hwpx'?path.join(fixtures,row.name+'.hwpx'):path.join(phaseRoot,'baseline-native',row.name+'-input.hwp');fs.writeFileSync(path.join(q,'files',row.name+'.'+ext),fs.readFileSync(source),{flag:'wx'});}
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
 assert.equal(receivedEngineSHA256,sha(fs.readFileSync(path.join(engine,'rhwp_bg.wasm'))));
 const position=p=>frame.evaluate(p=>{const h=window.__inputHandler;h.cursor.clearSelection();h.moveCursorTo({sectionIndex:0,paragraphIndex:p,charOffset:1});h.focus();},p);
 async function load(name){await frame.evaluate(()=>window.rhwpStudio.notifySaved());control({id:'open-'+name,openFile:name});await page.evaluate(()=>document.getElementById('open').click());await until(()=>frame.evaluate(name=>window.baramHost.state().fileName===name&&window.__inputHandler.active,name),'load '+name);await page.waitForFunction(()=>!document.getElementById('save').disabled);await settle();}
 const scenarios=mode==='baseline'?[{name:'numeric',ext:'hwpx'}]:pins.rows.flatMap(row=>['hwp','hwpx'].map(ext=>({name:row.name,ext})));
 for(const {name,ext} of scenarios){
  const prefix=name+'-'+ext;await load(name+'.'+ext);const original=await state(prefix+'-original');assert.equal(original.props.length,7);
  for(let p=0;p<7;p++){assert.equal(original.props[p].para.headType,'Number');assert.equal(original.props[p].para.paraLevel,p);assert.equal(original.props[p].para.numberingId,pins.rows.find(r=>r.name===name).numberingId);}
  let final=original;
  if(mode==='fixed'){
   await position(0);await page.keyboard.sendCharacter('X');await settle();const typed=await state(prefix+'-typed');assert.notEqual(typed.text,original.text);
   assert((await command('edit:undo')).ok);await settle();equalDoc(await state(),original);
   assert((await command('edit:redo')).ok);await settle();equalDoc(await state(),typed);
   await position(1);await frame.evaluate(()=>window.__inputHandler.applyParaPropsAtCursor({spacingBefore:8}));await settle();const formatted=await state(prefix+'-formatted');assert.notDeepEqual(formatted.props,typed.props);assert.equal(formatted.text,typed.text);assert.deepEqual(formatted.styles,typed.styles);
   assert((await command('edit:undo')).ok);await settle();const formatUndone=await state(prefix+'-format-undone');equalDoc(formatUndone,typed,{exactBytes:false});write(prefix+'-format-undo-byte-difference.json',{before:typed.canonical,after:formatUndone.canonical,semanticEquality:true,byteEquality:JSON.stringify(typed.canonical)===JSON.stringify(formatUndone.canonical),limitation:'Formatting undo may retain an unused paragraph shape; numbering exports inspected separately.'});
   assert((await command('edit:redo')).ok);await settle();equalDoc(await state(prefix+'-format-redone'),formatted,{exactBytes:false});final=formatted;
  }
  const saved=[];for(const target of (mode==='baseline'?['hwp']:['hwp','hwpx'])){
   const file=prefix+'-saved.'+target;const beforeSave=await state();control({id:'save-'+file,file});await page.select('#format',target);await page.evaluate(()=>document.getElementById('save').click());await until(()=>frame.evaluate(()=>!window.baramHost.state().dirty),'save');await page.waitForFunction(()=>!document.getElementById('save').disabled);assert.equal(sha(fs.readFileSync(path.join(q,'files',file))),beforeSave[target]);saved.push({file,target,sha256:beforeSave[target]});
  }
  for(const item of saved){await load(item.file);const reopened=await state(prefix+'-reopened-'+item.target);for(const key of ['text','pages','svg','printSvg','props','styles'])assert.deepEqual(reopened[key],final[key],key+' save/reopen');assert.equal(reopened.host.dirty,false);assert.deepEqual(reopened.history,{u:0,r:0});item.reopenedDataStylesAndLayoutEqual=true;}
  rows.push({name,ext,saved,actualTypingAndFormattingHistory:mode==='fixed',expectedFlags:pins.rows.find(r=>r.name===name).expectedFlags});write('progress.json',rows);console.log('PASS '+mode+' '+prefix);
 }
 assert.deepEqual(errors,[]);assert.equal(blockedOSPrintCalls,0,'no OS print attempts across frames and children');
 await frame.evaluate(()=>window.rhwpStudio.notifySaved());control({id:'normal-quit',quit:true,choice:'cancel'});await until(()=>p.exitCode!==null,'normal quit');assert.equal(p.exitCode,0);normalQuit=true;
 write('proof.json',{mode,rows,dialogs,errors,receivedEngineSHA256,actualMacElectron:true,electron:'44.3.0',instrumentedReadHandles:true,syntheticFixturesOnly:true,nativeFileChooserControlled:true,OSPrintDialogVerified:false,OSPrintCallsBlocked:true,scope:'numbering-head flags, real editing/history, actual host save and reopen; no Hancom/IME/Linux claim',physicalPrinterOutput:false,normalQuit,exitCode:p.exitCode,budget:checkBudget()});
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

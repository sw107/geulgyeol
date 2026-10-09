// Actual Mac Electron signed outer-margin inputs, exact endpoints and native saves.
// Official Mac Electron + current host/preload/IPC. QA-only read exposures place
// the table selection; edits use the real dialog and CommandHistory. No OS input.
import puppeteer from '../rhwp-studio/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const root=path.resolve(import.meta.dirname,'..'),q=path.resolve(process.argv[2]),engine=path.resolve(process.argv[3]);
const M=await import(pathToFileURL(path.join(engine,'rhwp.js')));M.initSync({module:fs.readFileSync(path.join(engine,'rhwp_bg.wasm'))});
const sha=b=>createHash('sha256').update(b).digest('hex'),write=(name,value)=>fs.writeFileSync(path.join(q,name),JSON.stringify(value,null,2));
const control=value=>write('control.json',value),pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label){const end=Date.now()+65000;while(Date.now()<end){if(await fn())return;await pause(50);}throw Error('Timeout '+label);}
let p,b,page,frame,failure,normalQuit=false,receivedEngineSHA256;const errors=[],rows=[],manifest=[];let pairs=0,reopens=0;
// A background/occluded Mac window can suspend RAF; readiness uses host state
// and completed synchronous engine SVG, with a bounded renderer timer.
const settle=async()=>{
 // The product completes deferred cell pagination asynchronously. Comparing a
 // transient frame with a save (which flushes it) is not a round-trip oracle.
 // Observe the real idle boundary; do not force a test-only engine flush.
 await until(()=>frame.evaluate(()=>!window.__inputHandler.hasDeferredPaginationPending()),'product pagination idle');
 await frame.evaluate(()=>new Promise(r=>{requestAnimationFrame(()=>requestAnimationFrame(r));setTimeout(r,250);}));
};
const history=()=>frame.evaluate(()=>({u:window.__inputHandler.history.undoStack.length,r:window.__inputHandler.history.redoStack.length}));
const state=()=>frame.evaluate(()=>{
 const w=window.__wasm,d=w.doc,t=JSON.parse(d.getControls()).find(t=>t.ctrlId==='tbl'&&t.list===0);w.exportHwp();const dims=w.getTableDimensions(0,t.para,t.controlIndex),cells=Array.from({length:dims.cellCount},(_,i)=>({info:w.getCellInfo(0,t.para,t.controlIndex,i),props:w.getCellProperties(0,t.para,t.controlIndex,i),paras:Array.from({length:w.getCellParagraphCount(0,t.para,t.controlIndex,i)},(_,cp)=>({text:d.getTextInCell(0,t.para,t.controlIndex,i,cp,0,10000),props:w.getCellParaPropertiesAt(0,t.para,t.controlIndex,i,cp),runs:JSON.parse(d.getCellCharFormatRunsByPath(0,t.para,JSON.stringify([{controlIndex:t.controlIndex,cellIndex:i,cellParaIndex:cp}]),0,[...d.getTextInCell(0,t.para,t.controlIndex,i,cp,0,10000)].length))}))})),svg=Array.from({length:w.pageCount},(_,i)=>w.renderPageSvg(i));
 const rendered=svg.map(s=>[...new DOMParser().parseFromString(s,'image/svg+xml').querySelectorAll('text')].map(t=>t.textContent).join(''));
 return {target:t,dims,props:w.getTableProperties(0,t.para,t.controlIndex),cells,body:Array.from({length:d.getParagraphCount(0)},(_,i)=>d.getTextRange(0,i,0,100000)),styles:JSON.parse(d.getStyleList()),text:d.getTextFileText(),svg,rendered,pageCount:w.pageCount,hwp:Array.from(w.exportHwp()),hwpx:Array.from(w.exportHwpx())};
});
const margins=v=>['outerLeft','outerRight','outerTop','outerBottom'].map(k=>v.props[k]);
async function load(name){const generation=await frame.evaluate(()=>window.__wasm.documentGeneration);await frame.evaluate(()=>window.rhwpStudio.notifySaved());control({id:'open-'+name,openFile:name,choice:'discard'});await page.evaluate(()=>document.querySelector('#open').click());await until(()=>frame.evaluate(({name,generation})=>window.__wasm?.fileName===name&&window.__wasm.documentGeneration!==generation&&window.__inputHandler?.active&&!document.documentElement.classList.contains('rhwp-busy'),{name,generation}),'load '+name);await until(()=>page.evaluate(()=>!document.querySelector('#save').disabled),'host load settled');await settle();}
async function open(){await frame.evaluate(()=>{const h=window.__inputHandler,t=JSON.parse(window.__wasm.doc.getControls()).find(t=>t.ctrlId==='tbl'&&t.list===0);h.cursor.exitCellSelectionMode();h.cursor.exitCellMode?.();h.cursor.clearSelection();h.cursor.enterTableObjectSelectionDirect(0,t.para,t.controlIndex);h.renderTableObjectSelection();assertDispatch(h.dispatcher.dispatchWithResult('table:cell-props'));function assertDispatch(v){if(!v.ok)throw Error(JSON.stringify(v));}});await frame.waitForSelector('.tcp-dialog',{visible:true});}
async function close(confirm){await frame.evaluate(confirm=>{const d=document.querySelector('.tcp-dialog'),button=confirm?d.querySelector('.dialog-btn-primary'):[...d.querySelectorAll('.dialog-btn')].find(b=>b.textContent.trim()==='취소');button.click();},confirm);await frame.waitForSelector('.tcp-dialog',{hidden:true});await settle();}
async function edit(side,value){await frame.evaluate(({side,value})=>{const d=document.querySelector('.tcp-dialog');[...d.querySelectorAll('.dialog-tab')].find(b=>b.textContent.trim()==='여백/캡션').click();const input=[...d.querySelectorAll('.dialog-section-title')].find(t=>t.textContent.trim()==='바깥 여백').parentElement.querySelectorAll('input[type=number]')[side];input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));},{side,value});}
async function key(redo){await frame.evaluate(()=>window.__inputHandler.focus());await page.keyboard.down('Meta');if(redo)await page.keyboard.down('Shift');try{await page.keyboard.press('z');}finally{if(redo)await page.keyboard.up('Shift');await page.keyboard.up('Meta');}await settle();}
function comparable(v){const {hwp,hwpx,...rest}=v;return rest;}
async function saveAndReopen(label,expected){
 for(const ext of ['hwp','hwpx']){
  const payload=await state(),name=label+'.'+ext;control({id:'save-'+name,file:name});await page.select('#format',ext);await page.evaluate(()=>document.querySelector('#save').click());await until(()=>fs.existsSync(path.join(q,'files',name)),'native save');await until(()=>page.evaluate(()=>!document.querySelector('#save').disabled),'save settled');
  const bytes=fs.readFileSync(path.join(q,'files',name));assert.equal(sha(bytes),sha(Buffer.from(payload[ext])),'native save current export');await load(name);const actual=await state();
  assert.deepEqual(actual.svg,expected.svg,'complete saved SVG');assert.deepEqual(actual.body,expected.body);assert.deepEqual(actual.cells,expected.cells,'all cell formatting and character IDs after reopening');assert.deepEqual(actual.styles,expected.styles);assert.deepEqual(actual.pageCount,expected.pageCount);assert.deepEqual(actual.props,expected.props);
  manifest.push({file:path.join(q,'files',name),svg:actual.svg,pageCount:actual.pageCount,body:actual.body,text:actual.text,cells:actual.cells,props:actual.props,styles:actual.styles});reopens++;
 }
}
try{assert.equal(process.platform,'darwin');assert(!fs.existsSync(path.join(q,'audit.jsonl')));const cases=['boundary-input.hwpx','boundary-input.hwp'];
 const seed=new M.HwpDocument(fs.readFileSync(path.join(root,'../table-size-qa/seeds/normal-mixed-declared.hwpx')));for(const name of cases)fs.writeFileSync(path.join(q,'files',name),seed[name.endsWith('.hwp')?'exportHwp':'exportHwpx']());seed.free();
 control({id:'startup',canceled:true});const env={...process.env,GEULGYEOL_QA_DIR:q,GEULGYEOL_PROFILE_ROOT:path.join(q,'profile'),GEULGYEOL_ELECTRON_MODULE:'electron'};delete env.ELECTRON_RUN_AS_NODE;
 p=spawn(path.join(root,'desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),[path.join(q,'bootstrap.cjs'),'--remote-debugging-port=0','--remote-debugging-address=127.0.0.1','--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows'],{env});let log='';for(const s of [p.stdout,p.stderr])s.on('data',d=>{log+=d;fs.appendFileSync(path.join(q,'launch.log'),d);});
 await until(()=>/DevTools listening on (ws:\/\/\S+)/.test(log),'renderer endpoint');b=await puppeteer.connect({browserWSEndpoint:log.match(/DevTools listening on (ws:\/\/\S+)/)[1],defaultViewport:null});await until(async()=>{page=(await b.pages()).find(p=>/^http:\/\/127\.0\.0\.1:\d+\/$/.test(p.url()));frame=page?.frames().find(f=>f.url().includes('/studio/'));return frame;},'app');page.on('pageerror',e=>errors.push(String(e)));await page.waitForFunction(()=>!document.querySelector('#save').disabled,{timeout:30000});const asset=fs.readdirSync(path.join(q,'runtime/web/studio/assets')).find(n=>/^rhwp_bg-.*\.wasm$/.test(n));receivedEngineSHA256=sha(Buffer.from(await(await fetch(new URL('/studio/assets/'+asset,page.url()))).arrayBuffer()));assert.equal(receivedEngineSHA256,sha(fs.readFileSync(path.join(engine,'rhwp_bg.wasm'))));
 for(const name of cases)for(let side=0;side<4;side++)for(const unit of [-32768,-850,32767]){
  await load(name);const before=await state(),hist=await history(),expected=margins(before);expected[side]=unit;
  const mm=String(unit*25.4/7200);await open();await edit(side,mm);await close(true);const after=await state();
  assert.deepEqual(margins(after),expected,'new signed UI input is exact');assert.deepEqual(after.cells,before.cells,'margin edit preserves cell sizes/text/formatting');assert.deepEqual(after.body,before.body);assert.deepEqual(after.styles,before.styles);assert.equal((await history()).u,hist.u+1);
  await key(false);assert.deepEqual(comparable(await state()),comparable(before),'boundary undo');await key(true);assert.deepEqual(comparable(await state()),comparable(after),'boundary redo');pairs++;
  await saveAndReopen(name.replace('.','-')+'-'+side+'-'+unit,after);rows.push({name,side,requestedMm:mm,unit,UIApplied:true,historyPairs:1});console.log('PASS '+name+' side='+side+' unit='+unit);
 }
 assert.deepEqual(errors,[]);await page.screenshot({path:path.join(q,'electron.png')});control({id:'normal-quit',quit:true,choice:'discard'});await until(()=>p.exitCode!==null,'normal application exit');assert.equal(p.exitCode,0);normalQuit=true;
 write('manifest.json',manifest);write('proof.json',{rows,pairs,reopens,errors,actualMacElectron:true,officialRuntimeVersion:'44.3.0',QAWindowBackgroundThrottlingDisabled:true,receivedEngineSHA256,QAReadExposuresForSelection:true,nativeResponsesControlled:true,OSChooserVerified:false,physicalIMEVerified:false,manualGUIVerified:false,clipboardAccessed:false,engineSHA256:sha(fs.readFileSync(path.join(engine,'rhwp_bg.wasm'))),exitCode:p.exitCode});console.log(JSON.stringify({cases:rows.length,pairs,reopens}));
}catch(e){failure=String(e);if(page&&frame){await Promise.allSettled([page.evaluate(()=>({busy:document.querySelector('#save')?.disabled,status:document.querySelector('#status')?.textContent,error:document.querySelector('#error-text')?.textContent})).then(v=>write('host-failure-state.json',v)),frame.evaluate(()=>({filename:window.__wasm?.fileName,generation:window.__wasm?.documentGeneration,active:window.__inputHandler?.active,visibility:document.visibilityState,busy:document.documentElement.classList.contains('rhwp-busy')})).then(v=>write('frame-failure-state.json',v))]);}write('failure.json',{failure,stack:e.stack,rows,pairs,reopens,errors});throw e;}
finally{if(p?.exitCode===null){control({id:'cleanup',quit:true,choice:'discard'});await until(()=>p.exitCode!==null,'cleanup normal quit');normalQuit=p.exitCode===0;}b?.disconnect();write('lifecycle.json',{exitCode:p?.exitCode,normalQuit,failure});}

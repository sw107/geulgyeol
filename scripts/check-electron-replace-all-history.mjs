// Actual Mac source-QA: real FindDialog button, Bridge, InputHandler and history.
// Usage: node ... RUNTIME_ROOT ENGINE_PKG INPUT_HWPX FRESH_OUTPUT baseline|fixed
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';import {createHash} from 'node:crypto';
import puppeteer from '../rhwp-studio/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
import {finishOwnedQA} from './electron-qa-exit.mjs';
const root=path.resolve(import.meta.dirname,'..'),[runtime,pkg,input,output,mode]=process.argv.slice(2),q=path.resolve(runtime),out=path.resolve(output);
assert.equal(process.platform,'darwin');assert(['baseline','fixed'].includes(mode));assert(!fs.existsSync(out));fs.mkdirSync(out,{recursive:true});
const write=(n,v)=>fs.writeFileSync(path.join(out,n),JSON.stringify(v,null,2)),sha=b=>createHash('sha256').update(b).digest('hex');
const control=v=>fs.writeFileSync(path.join(q,'control.json'),JSON.stringify(v));const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label){const end=Date.now()+45000;while(Date.now()<end){if(await fn())return;await pause(50);}throw Error('Timeout: '+label);}
let p,b,page,frame,failure,exitOutcome;const errors=[],stages=[];
try{
 for(const rel of ['main.cjs','preload.cjs','close-controller.cjs','web/baram.js'])assert.deepEqual(fs.readFileSync(path.join(q,'runtime',rel)),fs.readFileSync(path.join(root,'desktop',rel)));
 control({id:'restart-start',canceled:true});const env={...process.env,GEULGYEOL_ELECTRON_MODULE:'electron',GEULGYEOL_QA_DIR:q};delete env.ELECTRON_RUN_AS_NODE;
 p=spawn(path.join(root,'desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),[path.join(q,'bootstrap.cjs'),'--remote-debugging-port=0','--remote-debugging-address=127.0.0.1','--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows'],{env});
 let log='';p.on('error',e=>{failure=String(e);});for(const s of [p.stdout,p.stderr])s.on('data',d=>{log+=d;fs.appendFileSync(path.join(out,'launch.log'),d);});
 await until(()=>{if(failure)throw Error(failure);if(p.exitCode!==null)throw Error('Early app exit '+p.exitCode);return /DevTools listening on (ws:\/\/\S+)/.test(log);},'Electron endpoint');
 b=await puppeteer.connect({browserWSEndpoint:log.match(/DevTools listening on (ws:\/\/\S+)/)[1],defaultViewport:null});
 await until(async()=>{page=(await b.pages()).find(p=>/^http:\/\/127\.0\.0\.1:\d+\/$/.test(p.url()));frame=page?.frames().find(f=>f.url().includes('/studio/'));return frame;},'Mac app frame');
 page.on('pageerror',e=>errors.push(String(e)));await page.waitForFunction(()=>!document.querySelector('#save').disabled,{timeout:45000});
 const asset=fs.readdirSync(path.join(q,'runtime/web/studio/assets')).find(n=>/^rhwp_bg-.*\.wasm$/.test(n));const loaded=Buffer.from(await(await fetch(new URL('/studio/assets/'+asset,page.url()))).arrayBuffer());const hash=sha(fs.readFileSync(path.resolve(pkg,'rhwp_bg.wasm')));assert.equal(sha(loaded),hash);
 const settle=()=>until(()=>frame.evaluate(()=>!window.__inputHandler.hasDeferredPaginationPending()),'pagination');
 const runCommand=id=>frame.evaluate(id=>window.rhwpStudio.automation.execute(id,undefined,{allowDialog:true}),id);
 const observe=()=>frame.evaluate(()=>{const h=window.__inputHandler,w=window.__wasm,d=w.doc;const hook=w.onBeforeExport;let hwp,hwpx;try{w.onBeforeExport=()=>w.setCaretPosition(0,0,0);hwp=Array.from(window.baramHost.export('hwp'));hwpx=Array.from(window.baramHost.export('hwpx'));}finally{w.onBeforeExport=hook;hook?.();}return {text:d.getTextRange(0,0,0,100000),pages:d.pageCount(),svg:Array.from({length:d.pageCount()},(_,p)=>d.renderPageSvg(p)),printSvg:Array.from({length:d.pageCount()},(_,p)=>d.renderPageSvgWithProfile(p,'print')),cursor:h.getCursorPosition(),selection:h.cursor.getSelection(),history:{u:h.history.undoStack.length,r:h.history.redoStack.length,resources:[...h.history.undoStack,...h.history.redoStack].reduce((n,c)=>n+(c.snapshotResourceCount?.()??0),0)},dirty:window.baramHost.state().dirty,hwp,hwpx};});
 const comparable=s=>({...s,hwp:sha(Buffer.from(s.hwp)),hwpx:sha(Buffer.from(s.hwpx))});
 const status=()=>frame.evaluate(()=>document.querySelector('.find-dialog-status')?.textContent);
 let expectedBaselineErrors=0,reopens=0;
 for(const source of['hwp','hwpx'])for(const redo of[false,true])for(const kind of['empty','no-match','unsupported','false-after-edit','throw-after-edit','success']){
  const id=source+'-'+(redo?'redo':'clean')+'-'+kind;
  await frame.evaluate(async({bytes,name})=>{document.querySelector('.find-dialog .dialog-close')?.click();await window.rhwpStudio.notifySaved();await window.baramHost.loadDocument(new Uint8Array(bytes),name);},{bytes:Array.from(fs.readFileSync(input.replace(/\.hwpx$/,'.'+source))),name:'input.'+source});await settle();
  if(redo){for(const text of['A','B'])await frame.evaluate(text=>{const h=window.__inputHandler;h.executeOperation({kind:'snapshot',operationType:'qaSetup',operation:w=>{w.insertText(0,0,0,text);return {sectionIndex:0,paragraphIndex:0,charOffset:text.length};}});},text);await settle();await frame.evaluate(()=>{const h=window.__inputHandler;window.__qaFuture=h.wasm.doc.getTextRange(0,0,0,100000);h.performUndo();});await settle();}
  assert((await runCommand('edit:find-replace')).ok);await frame.waitForSelector('.find-dialog');
  await frame.evaluate(kind=>{const inputs=document.querySelectorAll('.find-dialog .find-dialog-input');inputs[0].value=kind==='empty'?'':kind==='no-match'?'NOT_PRESENT':'needle';inputs[0].dispatchEvent(new Event('input',{bubbles:true}));inputs[1].value='Q';const h=window.__inputHandler;h.moveCursorTo({sectionIndex:0,paragraphIndex:0,charOffset:0});h.cursor.clearSelection();},kind);
  const before=await observe();if(redo)assert.equal(before.history.r,1);else assert.equal(before.dirty,false);
  await frame.evaluate(kind=>{const w=window.__wasm;window.__qaRestoreReplaceAll=()=>{};if(kind==='unsupported'){const d=w.doc,old=d.replaceAll;d.replaceAll=undefined;window.__qaRestoreReplaceAll=()=>{d.replaceAll=old;};}if(kind==='false-after-edit'||kind==='throw-after-edit'){const old=w.replaceAll;w.replaceAll=function(...args){old.apply(this,args);if(kind==='throw-after-edit')throw Error('QA injected after real replaceAll mutation');return {ok:false};};window.__qaRestoreReplaceAll=()=>{w.replaceAll=old;};}},kind);
  const errorCount=errors.length;
  try{await frame.evaluate(()=>{const b=[...document.querySelectorAll('.find-dialog button')].find(b=>b.textContent==='모두 바꾸기');if(!b)throw Error('Missing actual button');b.click();});await settle();}finally{await frame.evaluate(()=>window.__qaRestoreReplaceAll());}
  const after=await observe(),actualStatus=await status();let preserved=false;
  if(kind==='success'){
   assert.equal(after.text,before.text.replaceAll('needle','Q'));assert.equal(after.history.u,before.history.u+1);assert.equal(after.history.r,0);assert.equal(actualStatus,'2개 바꿈');
   await frame.evaluate(()=>window.__inputHandler.performUndo());await settle();const u=await observe();for(const k of['text','pages','svg','printSvg','hwp','hwpx'])assert.deepEqual(comparable(u)[k],comparable(before)[k],id+' undo '+k);
   await frame.evaluate(()=>window.__inputHandler.performRedo());await settle();assert.deepEqual(comparable(await observe()),comparable(after));
  }else if(mode==='fixed'||kind==='empty'||kind==='throw-after-edit'){
   assert.deepEqual(comparable(after),comparable(before),id+' preserved');preserved=true;
   if(kind==='throw-after-edit'&&mode==='baseline')expectedBaselineErrors+=errors.length-errorCount;
   if(mode==='fixed')assert.equal(actualStatus,kind==='no-match'?'0개 바꿈':kind==='empty'?'':'모두 바꾸기에 실패했습니다.');
   if(redo){await frame.evaluate(()=>window.__inputHandler.performRedo());await settle();assert.equal((await observe()).text,await frame.evaluate(()=>window.__qaFuture));await frame.evaluate(()=>window.__inputHandler.performUndo());await settle();const back=await observe();for(const k of['text','svg','printSvg','hwp','hwpx'])assert.deepEqual(comparable(back)[k],comparable(before)[k]);}
   if(redo){await frame.evaluate(()=>window.__inputHandler.performUndo());await settle();assert.equal((await observe()).text,'needle | needle 가나다 😀');await frame.evaluate(()=>window.__inputHandler.performRedo());await settle();}
  }else{assert.equal(after.history.u,before.history.u+1,id+' phantom history');assert.equal(after.history.r,0,id+' discarded redo');assert.equal(after.dirty,true);if(kind==='false-after-edit')assert.notEqual(after.text,before.text);else assert.equal(after.text,before.text);}
  const saved=[];
  if(mode==='fixed')for(const ext of['hwp','hwpx']){const raw=Buffer.from(await frame.evaluate(ext=>Array.from(window.baramHost.export(ext)),ext));const file=id+'.'+ext;fs.writeFileSync(path.join(out,file),raw);const expected=(await observe()).text;await frame.evaluate(async({bytes,name})=>{document.querySelector('.find-dialog .dialog-close')?.click();await window.rhwpStudio.notifySaved();await window.baramHost.loadDocument(new Uint8Array(bytes),name);},{bytes:Array.from(fs.readFileSync(path.join(out,file))),name:file});await settle();const r=await observe();assert.equal(r.text,expected);assert.deepEqual(r.svg,after.svg);assert.deepEqual(r.printSvg,after.printSvg);saved.push({ext,file,sha256:sha(raw),reopened:true});reopens++;}
  if((source==='hwpx'&&redo&&['no-match','false-after-edit','success'].includes(kind)))await page.screenshot({path:path.join(out,id+'.png')});
  stages.push({id,source,redo,kind,status:actualStatus,before:comparable(before),after:comparable(after),preserved,saved});
 }
 assert.equal(errors.length,expectedBaselineErrors);await frame.evaluate(async()=>{document.querySelector('.find-dialog .dialog-close')?.click();await window.rhwpStudio.notifySaved();await window.baramHost.newDocument();});control({id:'replace-all-done',quit:true,choice:'discard'});exitOutcome=await finishOwnedQA(p,{requestClose:async()=>control({id:'replace-all-close',quit:true,choice:'discard'}),allowTerminate:false,closeTimeoutMs:10000});assert(exitOutcome.normalQuit);
 write('proof.json',{mode,actualMacElectronSourceQA:true,actualFindDialogButton:true,realBridgeAndHistory:true,instrumentedQAHandles:true,dialogControlled:true,nativeChooser:false,faultInjection:['missing WASM method','false after real mutation','throw after real mutation'],engineSHA256:hash,loadedEngineSHA256:hash,stages,reopens,errors,expectedBaselineErrors,exitOutcome});console.log(JSON.stringify({mode,cases:stages.length,reopens,normalQuit:exitOutcome.normalQuit}));
}catch(e){failure=String(e);write('failure.json',{failure,stack:e.stack,errors,stages});throw e;}
finally{b?.disconnect();if(p&&(p.exitCode===null&&p.signalCode===null))exitOutcome=await finishOwnedQA(p,{requestClose:async()=>control({id:'replace-all-cleanup',quit:true,choice:'discard'}),allowTerminate:true});write('lifecycle.json',{failure,exitOutcome,exitCode:p?.exitCode,signal:p?.signalCode});}

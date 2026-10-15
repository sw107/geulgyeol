// Actual Mac source-QA: real removal/bullet/number handlers and snapshot history.
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
 const original=['1.','2.','3.','4.','4.1.','5.'],restarted=['1.','2.','123.','124.','124.1.','125.'];
 const settle=()=>until(()=>frame.evaluate(()=>!window.__inputHandler.hasDeferredPaginationPending()),'format pagination');
 const observe=()=>frame.evaluate(()=>{const d=window.__wasm.doc;return {props:JSON.parse(d.getParaPropertiesAt(0,2)),labels:Array.from({length:d.pageCount()},(_,p)=>JSON.parse(d.getPageTextLayout(p)).runs).flat().filter(r=>!Number.isInteger(r.charStart)&&/^\d+(?:\.\d+)*\.$/.test(r.text)).map(r=>r.text),text:Array.from({length:d.getParagraphCount(0)},(_,p)=>d.getTextRange(0,p,0,100000))};});
 const exports=async(name,fail)=>{const rows=[];for(const ext of['hwp','hwpx']){const r=await frame.evaluate(ext=>{try{return {bytes:Array.from(window.baramHost.export(ext))};}catch(e){return {error:String(e)};}},ext);if(fail){assert(r.error&&/paragraph numbering restart/.test(r.error),JSON.stringify(r));rows.push({ext,error:r.error});}else{assert(!r.error,JSON.stringify(r));const bytes=Buffer.from(r.bytes),file=name+'.'+ext;fs.writeFileSync(path.join(out,file),bytes);rows.push({ext,file,sha256:sha(bytes)});}}return rows;};
 for(const change of['dialog-remove','toolbar-remove','bullet']){
  await frame.evaluate(async bytes=>{await window.rhwpStudio.notifySaved();await window.baramHost.loadDocument(new Uint8Array(bytes),'toggle-synthetic.hwpx');const h=window.__inputHandler;h.moveCursorTo({sectionIndex:0,paragraphIndex:2,charOffset:0});h.executeOperation({kind:'snapshot',operationType:'qaRestart',operation:w=>{w.setNumberingRestart(0,2,2,123);return {sectionIndex:0,paragraphIndex:2,charOffset:0};}});},Array.from(fs.readFileSync(input)));await settle();const before=await observe();assert.deepEqual(before.labels,restarted);
  const applied=await frame.evaluate(change=>{const h=window.__inputHandler;if(change==='dialog-remove')return h.captureBodyNumbering()?.apply(null,0,1,0);if(change==='toolbar-remove')h.toggleNumbering();else h.toggleBullet();return true;},change);assert.equal(applied,true);await settle();const off=await observe();assert.equal(off.props.headType,change==='bullet'?'Bullet':'None');assert(!off.labels.includes('123.'));const saved=await exports(change,mode==='baseline');await page.screenshot({path:path.join(out,change+'.png')});
  await frame.evaluate(()=>window.__inputHandler.performUndo());await settle();assert.deepEqual(await observe(),before);const undone=await exports(change+'-undo',false);
  await frame.evaluate(()=>window.__inputHandler.performRedo());await settle();assert.deepEqual(await observe(),off);const redone=await exports(change+'-redo',mode==='baseline');
  await frame.evaluate(()=>window.__inputHandler.applyNumbering(2));await settle();const reapplied=await observe();assert.deepEqual(reapplied.labels,mode==='fixed'?original:restarted);const numberSaved=await exports(change+'-number-again',false);
  await frame.evaluate(()=>window.__inputHandler.performUndo());await settle();assert.deepEqual(await observe(),off);
  await frame.evaluate(()=>window.__inputHandler.performRedo());await settle();assert.deepEqual(await observe(),reapplied);
  const reopens=[];
  for(const [files,expected]of[[saved,off],[undone,before],[redone,off],[numberSaved,reapplied]])for(const row of files){if(!row.file)continue;await frame.evaluate(async({bytes,name})=>{await window.rhwpStudio.notifySaved();await window.baramHost.loadDocument(new Uint8Array(bytes),name);},{bytes:Array.from(fs.readFileSync(path.join(out,row.file))),name:row.file});await settle();const v=await observe();assert.deepEqual(v.labels,expected.labels);assert.deepEqual(v.text,expected.text);assert.equal(v.props.headType,expected.props.headType);reopens.push(row.file);}
  stages.push({change,off,reapplied,saved,undone,redone,numberSaved,reopens,undoRedoVerified:true});
 }
 assert.deepEqual(errors,[]);await frame.evaluate(async()=>{await window.rhwpStudio.notifySaved();await window.baramHost.newDocument();});control({id:'toggle-done',quit:true,choice:'discard'});exitOutcome=await finishOwnedQA(p,{requestClose:async()=>control({id:'toggle-close',quit:true,choice:'discard'}),allowTerminate:false,closeTimeoutMs:10000});assert(exitOutcome.normalQuit);
 write('proof.json',{mode,actualMacElectronSourceQA:true,realUIHandlers:true,instrumentedQAHandles:true,dialogControlled:true,nativeChooser:false,engineSHA256:hash,loadedEngineSHA256:hash,stages,errors,exitOutcome});console.log(JSON.stringify({mode,scenarios:stages.length,normalQuit:exitOutcome.normalQuit,engineSHA256:hash}));
}catch(e){failure=String(e);write('failure.json',{failure,stack:e.stack,errors,stages});throw e;}
finally{b?.disconnect();if(p&&(p.exitCode===null&&p.signalCode===null))exitOutcome=await finishOwnedQA(p,{requestClose:async()=>control({id:'toggle-cleanup',quit:true,choice:'discard'}),allowTerminate:true});write('lifecycle.json',{failure,exitOutcome,exitCode:p?.exitCode,signal:p?.signalCode});}

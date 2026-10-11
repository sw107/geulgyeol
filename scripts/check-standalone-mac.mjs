// Actual production Mac bundle; no dialog replacement or QA renderer exposures.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import puppeteer from '../rhwp-studio/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
const root=path.resolve(import.meta.dirname,'..'),q=path.resolve(process.argv[2]);
assert.equal(process.platform,'darwin');assert(!fs.existsSync(q),'Fresh QA output directory required');
fs.mkdirSync(q,{recursive:true});
const bundle=path.join(root,'dist/GeulgyeolIndependent-darwin-arm64/GeulgyeolIndependent.app');
const executable=path.join(bundle,'Contents/MacOS/GeulgyeolIndependent');
const archive=path.join(bundle,'Contents/Resources/app.asar');
const require=createRequire(path.join(root,'desktop/package.json'));
const asar=require('@electron/asar');
const sha=b=>createHash('sha256').update(b).digest('hex');
const write=(n,v)=>fs.writeFileSync(path.join(q,n),JSON.stringify(v,null,2));
const wasm=fs.readFileSync(path.join(root,'pkg/rhwp_bg.wasm')),engineSHA256=sha(wasm);
const M=await import(pathToFileURL(path.join(root,'pkg/rhwp.js')));M.initSync({module:wasm});
// getTextFileText follows the legacy CP949 contract and escapes non-CP949
// characters as numeric entities. Compare stored Unicode paragraph text.
const text=bytes=>{const d=new M.HwpDocument(new Uint8Array(bytes));try{return Array.from({length:d.getParagraphCount(0)},(_,i)=>d.getTextRange(0,i,0,100000)).join('\n');}finally{d.free();}};
for(const rel of ['main.cjs','preload.cjs','close-controller.cjs','web/baram.js','web/studio/rhwp.js','web/studio/rhwp_bg.wasm'])assert.deepEqual(asar.extractFile(archive,rel),fs.readFileSync(path.join(root,'desktop',rel)),`Bundled current source: ${rel}`);
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label){const end=Date.now()+65000;while(Date.now()<end){if(await fn())return;await delay(50);}throw Error('Timeout: '+label);}
let p,b,page,frame,ws,mainSend,failure,normalQuit=false;const errors=[],rows=[];
try{
 const env={...process.env,GEULGYEOL_PROFILE_ROOT:path.join(q,'profile')};delete env.ELECTRON_RUN_AS_NODE;
 p=spawn(executable,['--inspect=0','--remote-debugging-port=0','--remote-debugging-address=127.0.0.1'],{env});
 let log='';for(const s of [p.stdout,p.stderr])s.on('data',d=>{log+=d;fs.appendFileSync(path.join(q,'launch.log'),d);});
 await until(()=>{if(p.exitCode!==null)throw Error('Early exit '+p.exitCode);return /DevTools listening on (ws:\/\/\S+)/.test(log)&&/Debugger listening on (ws:\/\/\S+)/.test(log);},'production endpoints');
 ws=new WebSocket(log.match(/Debugger listening on (ws:\/\/\S+)/)[1]);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
 let seq=0;const pending=new Map();ws.onmessage=e=>{const v=JSON.parse(e.data);if(v.id){const t=pending.get(v.id);pending.delete(v.id);v.error?t.reject(Error(JSON.stringify(v.error))):t.resolve(v.result);}};
 const send=expression=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method:'Runtime.evaluate',params:{expression,returnByValue:true}}));});
 mainSend=send;
 const appExpr='(()=>{const req=typeof require==="function"?require:process.mainModule.require.bind(process.mainModule);return req("electron").app;})()';
 const main=await send('JSON.stringify((()=>{const app='+appExpr+';return {execPath:process.execPath,appPath:app.getAppPath(),userData:app.getPath("userData"),isPackaged:app.isPackaged,electron:process.versions.electron};})())');
 assert(!main.exceptionDetails,JSON.stringify(main.exceptionDetails));const runtime=JSON.parse(main.result.value);
 assert.equal(runtime.appPath,archive);assert.equal(runtime.execPath,executable);assert(runtime.userData.startsWith(path.join(q,'profile')+path.sep));assert.equal(runtime.isPackaged,true);assert.equal(runtime.electron,'44.3.0');write('runtime-paths.json',runtime);
 b=await puppeteer.connect({browserWSEndpoint:log.match(/DevTools listening on (ws:\/\/\S+)/)[1],defaultViewport:null});
 await until(async()=>{page=(await b.pages()).find(p=>/^http:\/\/127\.0\.0\.1:\d+\/$/.test(p.url()));return page;},'Mac window');
 page.on('pageerror',e=>errors.push(String(e)));await page.waitForFunction(()=>!document.querySelector('#save').disabled,{timeout:65000});
 frame=page.frames().find(f=>f.url().includes('/studio/'));assert(frame);
 const prod=await frame.evaluate(()=>({wasmExposure:typeof window.__wasm,inputExposure:typeof window.__inputHandler}));assert.deepEqual(prod,{wasmExposure:'undefined',inputExposure:'undefined'});
 const served=await frame.evaluate(async()=>{const u=performance.getEntriesByType('resource').map(x=>x.name).find(u=>/rhwp_bg-.*\.wasm(?:$|\?)/.test(u));if(!u)throw Error('Missing loaded engine resource');return {url:u,bytes:Array.from(new Uint8Array(await (await fetch(u)).arrayBuffer()))};});assert.equal(sha(Buffer.from(served.bytes)),engineSHA256);
 await page.evaluate(()=>document.querySelector('#new').click());await page.waitForFunction(()=>!document.querySelector('#save').disabled);
 const expected='글결 독립 실행 확인 ABC 123 é';
 const inputResult=await frame.evaluate(async value=>{await window.baramHost.ready();await window.rhwpStudio.plugins.load('hwpctrl');return await window.rhwpStudio.plugins.invoke('hwpctrl','invoke',['SetTextFile',[value,'TEXT','insertfile']]);},expected);
 await delay(150);write('input-result.json',{inputResult,state:await frame.evaluate(()=>window.baramHost.state())});
 for(const ext of ['hwp','hwpx']){
  const bytes=Buffer.from(await frame.evaluate(ext=>Array.from(window.baramHost.export(ext)),ext));write('text-'+ext+'.json',{expected,actual:text(bytes)});assert(text(bytes).includes(expected));
  const file='standalone.'+ext;fs.writeFileSync(path.join(q,file),bytes);
  const reopened=await frame.evaluate(async ({bytes,file})=>{await window.rhwpStudio.notifySaved();const host=window.baramHost;const result=await host.loadDocument(new Uint8Array(bytes),file);return {result,state:host.state()};},{bytes:Array.from(fs.readFileSync(path.join(q,file))),file});
  const roundtrip=Buffer.from(await frame.evaluate(ext=>Array.from(window.baramHost.export(ext)),ext));assert(text(roundtrip).includes(expected));rows.push({format:ext,bytes:bytes.length,SHA256:sha(bytes),pageCount:reopened.result.pageCount,reopened:true});
 }
 await frame.evaluate(async()=>{await window.rhwpStudio.notifySaved();await window.baramHost.newDocument();});
 await page.screenshot({path:path.join(q,'electron.png')});assert.deepEqual(errors,[]);
 await send('setTimeout(()=>'+appExpr+'.quit(),100);true');ws.close();await until(()=>p.exitCode!==null,'normal app.quit');assert.equal(p.exitCode,0);normalQuit=true;
 write('proof.json',{actualMacPackagedElectron:true,ordinaryProductionMain:true,dialogInterception:false,QAExposures:false,engineSHA256,loadedEngineSHA256:engineSHA256,asarSHA256:sha(fs.readFileSync(archive)),rows,errors,normalQuit,exitCode:p.exitCode,nativeChooserVerified:false,physicalIMEVerified:false});
 console.log(JSON.stringify({formats:rows.length,normalQuit,engineSHA256}));
}catch(e){failure=String(e);write('failure.json',{failure,stack:e.stack,errors,rows});throw e;}
finally{b?.disconnect();if(p?.exitCode===null){
 if(mainSend&&ws?.readyState===WebSocket.OPEN){await mainSend('setTimeout(()=>{const req=typeof require==="function"?require:process.mainModule.require.bind(process.mainModule);req("electron").app.exit(1);},100);true');ws.close();}
 else p.kill('SIGTERM');
 await until(()=>p.exitCode!==null||p.signalCode!==null,'own failed QA child exit');
 }ws?.close();write('lifecycle.json',{normalQuit,exitCode:p?.exitCode,signal:p?.signalCode,failure});}

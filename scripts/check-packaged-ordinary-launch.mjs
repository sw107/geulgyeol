// No browser-main inspector, injected adapter, or native dialog replacement.
// CDP only reads the owned renderer. Quit targets the still-live child PID.
import puppeteer from '../rhwp-studio/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';import {createHash} from 'node:crypto';
const q=path.resolve(process.argv[2]),executable=path.resolve(process.argv[3]),engineSHA=process.argv[4],expectedVersion=process.argv[5]??JSON.parse(fs.readFileSync(new URL('../desktop/package.json',import.meta.url))).version;
assert(executable.includes('.app/Contents/MacOS/'));assert(!fs.existsSync(path.join(q,'profile')));
const env={...process.env,GEULGYEOL_PROFILE_ROOT:path.join(q,'profile')};
for(const key of ['ELECTRON_RUN_AS_NODE','GEULGYEOL_QA_DIR','GEULGYEOL_ELECTRON_MODULE','GEULGYEOL_QA_PACKAGED_APP'])delete env[key];
const p=spawn(executable,['--remote-debugging-port=0','--remote-debugging-address=127.0.0.1'],{env});
let log='',b,failure,quitRequested=false;for(const stream of [p.stdout,p.stderr])stream.on('data',data=>{log+=data;fs.appendFileSync(path.join(q,'launch.log'),data);});
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn,label){const end=Date.now()+30000;while(Date.now()<end){if(await fn())return;await pause(50);}throw Error('Timeout '+label);}
async function normalQuit(){
  assert.equal(p.exitCode,null,'Only the owned live child may be targeted');
  const request=spawn('python3',['-c',`import ctypes,sys,json
ctypes.CDLL('/System/Library/Frameworks/AppKit.framework/AppKit')
objc=ctypes.CDLL('/usr/lib/libobjc.A.dylib')
objc.objc_getClass.argtypes=[ctypes.c_char_p];objc.objc_getClass.restype=ctypes.c_void_p
objc.sel_registerName.argtypes=[ctypes.c_char_p];objc.sel_registerName.restype=ctypes.c_void_p
lookup=ctypes.CFUNCTYPE(ctypes.c_void_p,ctypes.c_void_p,ctypes.c_void_p,ctypes.c_int)(('objc_msgSend',objc))
terminate=ctypes.CFUNCTYPE(ctypes.c_bool,ctypes.c_void_p,ctypes.c_void_p)(('objc_msgSend',objc))
app=lookup(objc.objc_getClass(b'NSRunningApplication'),objc.sel_registerName(b'runningApplicationWithProcessIdentifier:'),int(sys.argv[1]))
assert app
accepted=terminate(app,objc.sel_registerName(b'terminate'))
print(json.dumps({'ownedPID':int(sys.argv[1]),'normalQuitRequestAccepted':accepted,'forceTerminateUsed':False}))
assert accepted
`,String(p.pid)]);let response='';for(const stream of [request.stdout,request.stderr])stream.on('data',data=>response+=data);
  await until(()=>request.exitCode!==null,'normal quit request');assert.equal(request.exitCode,0,response);fs.writeFileSync(path.join(q,'normal-quit-request.json'),response);quitRequested=true;
  await until(()=>p.exitCode!==null,'native application exit');assert.equal(p.exitCode,0);
}
try{
  await until(()=>/DevTools listening on (ws:\/\/\S+)/.test(log),'read-only renderer endpoint');
  assert(!/Debugger listening on/.test(log),'Main inspector must be absent');
  b=await puppeteer.connect({browserWSEndpoint:log.match(/DevTools listening on (ws:\/\/\S+)/)[1],defaultViewport:null});let page;
  await until(async()=>{page=(await b.pages()).find(page=>/^http:\/\/127\.0\.0\.1:\d+\/$/.test(page.url()));return page;},'ordinary window');
  await page.waitForFunction(()=>!document.querySelector('#save').disabled,{timeout:30000});
  const info=await page.evaluate(()=>window.baram.info());assert.equal(info.version,expectedVersion);
  const state=await page.evaluate(()=>document.querySelector('#editor iframe').contentWindow.baramHost.state());assert.equal(state.dirty,false);
  const wasm=Buffer.from(await(await fetch(page.url()+'studio/rhwp_bg.wasm')).arrayBuffer()),hash=createHash('sha256').update(wasm).digest('hex');assert.equal(hash,engineSHA);
  await page.screenshot({path:path.join(q,'startup.png')});await normalQuit();
  fs.writeFileSync(path.join(q,'proof.json'),JSON.stringify({actualPackagedApp:true,executable,ownedPID:p.pid,mainInspectorUsed:false,nativeResponseAdapter:false,rendererCDPReadOnly:true,version:info.version,engineSHA256:hash,normalQuitMethod:'NSRunningApplication.terminate on owned live PID',forceTerminateUsed:false,exitCode:p.exitCode,OSChooserVerified:false,physicalIMEVerified:false,manualGUIVerified:false,clipboardAccessed:false},null,2));console.log('PASS adapter-free packaged startup and targeted native normal quit');
}catch(error){failure=String(error);console.error(error);fs.writeFileSync(path.join(q,'failure.json'),JSON.stringify({failure,stack:error.stack},null,2));process.exitCode=1;}
finally{if(p.exitCode===null&&!quitRequested)await normalQuit().catch(error=>{failure=String(error);process.exitCode=1;});b?.disconnect();fs.writeFileSync(path.join(q,'lifecycle.json'),JSON.stringify({exitCode:p.exitCode,failure},null,2));}

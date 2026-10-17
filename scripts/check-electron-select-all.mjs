// Native menu callback in an owned Electron process; DOM focus and CDP typing.
// No OS menu click, clipboard access, physical keyboard or Hancom claim.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import puppeteer from '../rhwp-studio/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
import {finishOwnedQA} from './electron-qa-exit.mjs';
const root=path.resolve(import.meta.dirname,'..'),[dirArg,mode,oldArg]=process.argv.slice(2);
assert(['baseline','fixed'].includes(mode)); const q=path.resolve(dirArg),old=path.resolve(oldArg);
assert(!fs.existsSync(q));fs.mkdirSync(q,{recursive:true});fs.mkdirSync(path.join(q,'files'));
const sha=b=>createHash('sha256').update(b).digest('hex');
const write=(n,v)=>fs.writeFileSync(path.join(q,n),JSON.stringify(v,null,2)+'\n');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label){const end=Date.now()+45000;while(Date.now()<end){if(await fn())return;await pause(30);}throw Error('Timeout '+label);}
const runtime=path.join(q,'runtime'),reused={};
function linkTree(a,b){fs.mkdirSync(b,{recursive:true});for(const e of fs.readdirSync(a)){const from=path.join(a,e),to=path.join(b,e);if(fs.statSync(from).isDirectory())linkTree(from,to);else{fs.linkSync(fs.realpathSync(from),to);reused[to]=sha(fs.readFileSync(to));}}}
linkTree(path.join(old,'web/studio'),path.join(runtime,'web/studio'));
for(const rel of execFileSync('git',['ls-files','-z','desktop'],{cwd:root}).toString().split('\0').filter(Boolean)){
 const n=rel.slice(8);if(n.startsWith('tests/')||n.startsWith('web/studio/')||n==='package-lock.json')continue;
 const to=path.join(runtime,n);fs.mkdirSync(path.dirname(to),{recursive:true});fs.copyFileSync(path.join(root,rel),to);
}
if(mode==='baseline')for(const n of ['main.cjs','web/baram.js','web/edit-history.js'])fs.copyFileSync(path.join(q,'../baseline-source',n),path.join(runtime,n));
write('runtime-pins.json',{reused,source:Object.fromEntries(['main.cjs','web/baram.js','web/edit-history.js'].map(n=>[n,sha(fs.readFileSync(path.join(runtime,n)))]))});
let bootstrap=fs.readFileSync(path.join(root,'scripts/electron-document-lifecycle-bootstrap.cjs'),'utf8');
bootstrap=bootstrap.replace("require('./runtime/main.cjs');",`
let menuPlan;
const menuTimer=setInterval(()=>{const c=control();if(c.selectAll&&menuPlan!==c.id){menuPlan=c.id;
 const w=BrowserWindow.getAllWindows().find(w=>/^http:\\/\\/127[.]0[.]0[.]1:\\d+\\/$/.test(w.webContents.getURL()));
 const item=require(process.env.GEULGYEOL_ELECTRON_MODULE).Menu.getApplicationMenu().items.find(i=>i.label==='편집').submenu.items.find(i=>String(i.role).toLowerCase()==='selectall'||i.id==='document-select-all');
 if(!w||!item)throw Error('Native select-all menu missing');item.click(item,w,{});audit('native-select-all',{plan:c.id,role:item.role,id:item.id});
}},30);app.on('will-quit',()=>clearInterval(menuTimer));
require('./runtime/main.cjs');
`);fs.writeFileSync(path.join(q,'bootstrap.cjs'),bootstrap);
const control=v=>write('control.json',v),audit=()=>fs.existsSync(path.join(q,'audit.jsonl'))?fs.readFileSync(path.join(q,'audit.jsonl'),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[];
const M=await import(pathToFileURL(path.join(runtime,'web/studio/rhwp.js')));M.initSync({module:fs.readFileSync(path.join(runtime,'web/studio/rhwp_bg.wasm'))});
const text=bytes=>{const d=new M.HwpDocument(bytes);try{return JSON.parse(d.getTextFileText()).trim();}finally{d.free();}};
let child,browser,page,frame,failure,exit;const rows=[],errors=[];
control({id:'start',choice:'discard',canceled:true});
try{
 const env={...process.env,GEULGYEOL_QA_DIR:q,GEULGYEOL_ELECTRON_MODULE:'electron',GEULGYEOL_PROFILE_ROOT:path.join(q,'app-data')};delete env.ELECTRON_RUN_AS_NODE;
 child=spawn(path.join(root,'desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),[path.join(q,'bootstrap.cjs'),'--remote-debugging-port=0','--remote-debugging-address=127.0.0.1'],{env});
 let log='',spawnError;child.once('error',e=>spawnError=e);for(const s of [child.stdout,child.stderr])s.on('data',b=>{log+=b;fs.appendFileSync(path.join(q,'launch.log'),b);});
 await until(()=>{if(spawnError)throw spawnError;if(child.exitCode!==null||child.signalCode!==null)throw Error('Owned app exited before ready');return /DevTools listening on (ws:\/\/\S+)/.test(log);},'CDP');
 browser=await puppeteer.connect({browserWSEndpoint:log.match(/DevTools listening on (ws:\/\/\S+)/)[1],defaultViewport:null});
 await until(async()=>{page=(await browser.pages()).find(p=>/^http:\/\/127\.0\.0\.1:\d+\/$/.test(p.url()));return page;},'window');
 page.on('pageerror',e=>errors.push(String(e)));await page.waitForFunction(()=>!document.querySelector('#save').disabled,{timeout:45000});
 frame=page.frames().find(f=>f.url().includes('/studio/'));await frame.evaluate(()=>window.rhwpStudio.plugins.load('hwpctrl'));
 const exported=()=>frame.evaluate(()=>Array.from(window.baramHost.export('hwpx'))).then(b=>new Uint8Array(b));
 const state=()=>page.evaluate(()=>({busy:document.querySelector('#save').disabled,error:document.querySelector('#error-dialog').open}));
 const menu=async id=>{control({id,selectAll:true,choice:'discard'});await until(()=>audit().some(e=>e.kind==='native-select-all'&&e.plan===id),'menu callback');await pause(80);};
 const add=(name,data={})=>{rows.push({name,...data});write('progress.json',rows);console.log('PASS '+name);};
 await frame.evaluate(()=>window.rhwpStudio.plugins.invoke('hwpctrl','invoke',['SetTextFile',['SELECT-ALL-A\nSELECT-ALL-B','TEXT','insertfile']]));
 fs.writeFileSync(path.join(q,'files/seed.hwpx'),await exported());
 control({id:'load-seed',openFile:'seed.hwpx',choice:'discard'});await page.evaluate(()=>document.querySelector('#open').click());
 await until(()=>page.evaluate(()=>!document.querySelector('#save').disabled&&document.querySelector('#editor iframe').contentWindow.baramHost.state().fileName==='seed.hwpx'),'seed reopen');
 add('synthetic two-paragraph document reopened through real host');
 await frame.evaluate(()=>window.baramHost.focus());
 await menu('document');await page.keyboard.type('Q');await pause(100);
 const after=text(await exported());write('replacement.json',{mode,after});
 if(mode==='baseline'){
  assert.notEqual(after,'Q');assert(after.includes('SELECT-ALL'));add('native selectAll fails to select document',{after});
  control({id:'reload-history-baseline',openFile:'seed.hwpx',choice:'discard'});await page.evaluate(()=>document.querySelector('#open').click());
  await until(()=>page.evaluate(()=>!document.querySelector('#save').disabled&&document.querySelector('#editor iframe').contentWindow.baramHost.state().fileName==='seed.hwpx'),'history baseline reopen');
  await frame.evaluate(()=>window.baramHost.focus());
  await page.keyboard.down('Control');await page.keyboard.press('a');await page.keyboard.up('Control');await page.keyboard.type('Q');await pause(100);
  assert.equal(text(await exported()),'Q');add('pre-fix renderer keyboard selection replaces document');
 }else{assert.equal(after,'Q');add('native selectAll replaces entire multi-paragraph document',{after});}
 const undoResult=await frame.evaluate(()=>window.rhwpStudio.plugins.invoke('hwpctrl','undo',[]));await pause(100);
 const undone=text(await exported());
 const secondUndoResult=await frame.evaluate(()=>window.rhwpStudio.plugins.invoke('hwpctrl','undo',[]));await pause(100);
 const secondUndone=text(await exported());write('undo-observation.json',{undoResult,undone,secondUndoResult,secondUndone});
 assert.equal(undone,'');assert.equal(secondUndone,'SELECT-ALL-A\nSELECT-ALL-B');
 add('existing two-step selection replacement undo reproduced',{first:undone,second:secondUndone,atomicUndoFixed:false});
 if(mode==='fixed'){
  const before=sha(await exported());await page.evaluate(()=>{const input=document.createElement('input');input.id='qa-select-field';input.value='FIELD-TEXT';document.body.append(input);input.focus();});
  await menu('field');await page.keyboard.type('F');assert.equal(await page.$eval('#qa-select-field',e=>e.value),'F');assert.equal(sha(await exported()),before);add('native selectAll selects focused field without changing document');
  await page.evaluate(()=>document.querySelector('#qa-select-field').remove());
  for(const format of ['hwp','hwpx']){
   await page.select('#format',format);control({id:'save-'+format,file:'selected.'+format});await page.evaluate(()=>document.querySelector('#save').click());await until(async()=>!(await state()).busy,'save');assert.equal((await state()).error,false);
   const saved=fs.readFileSync(path.join(q,'files/selected.'+format));assert.equal(text(saved),text(await exported()));add('real save and engine reopen '+format,{sha256:sha(saved)});
  }
 }
 assert.deepEqual(errors,[]);for(const [n,h] of Object.entries(reused))assert.equal(sha(fs.readFileSync(n)),h);
}catch(e){failure=String(e);write('failure.json',{failure,stack:e.stack,rows,errors});process.exitCode=1;}
finally{
 browser?.disconnect();if(child)exit=await finishOwnedQA(child,{requestClose:async()=>control({id:'quit',quit:true,choice:'discard'}),closeTimeoutMs:10000});
 write('proof.json',{mode,rows,errors,failure,exit,actualElectron:true,nativeMenuCallbackInvoked:true,physicalMenuClickVerified:false,physicalIMEVerified:false,clipboardAccessed:false,HancomVerified:false});if(!exit?.normalQuit)process.exitCode=1;
}

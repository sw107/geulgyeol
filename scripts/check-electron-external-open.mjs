// Actual Electron host/renderer/IPC/storage; injected Electron open-file events
// and controlled chooser replies. Does not operate Finder or other applications.
// Usage: NEW_PHASE_DIR baseline|fixed PINNED_PRODUCTION_RUNTIME_DIR
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import puppeteer from '../rhwp-studio/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
import {finishOwnedQA} from './electron-qa-exit.mjs';
const root=path.resolve(import.meta.dirname,'..');
const [phaseArg,mode,oldArg]=process.argv.slice(2), q=path.resolve(phaseArg),old=path.resolve(oldArg);
assert(['baseline','fixed'].includes(mode)); assert(!fs.existsSync(q),'Fresh phase required');
const sha=b=>createHash('sha256').update(b).digest('hex');
const write=(name,value)=>fs.writeFileSync(path.join(q,name),JSON.stringify(value,null,2)+'\n');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label){const end=Date.now()+45000;while(Date.now()<end){if(await fn())return;await pause(30);}throw Error('Timeout '+label);}
fs.mkdirSync(q,{recursive:true});fs.mkdirSync(path.join(q,'files'));
const runtime=path.join(q,'runtime'), reused={};
function linkTree(from,to){fs.mkdirSync(to,{recursive:true});for(const e of fs.readdirSync(from,{withFileTypes:true})){
  const a=path.join(from,e.name),b=path.join(to,e.name);
  if(fs.statSync(a).isDirectory())linkTree(a,b);else{fs.linkSync(fs.realpathSync(a),b);reused[b]=sha(fs.readFileSync(b));}
}}
linkTree(path.join(old,'web/studio'),path.join(runtime,'web/studio'));
const tracked=execFileSync('git',['ls-files','-z','desktop'],{cwd:root}).toString().split('\0').filter(Boolean);
for(const rel of tracked){const n=rel.slice(8);if(n.startsWith('tests/')||n.startsWith('web/studio/')||n==='package-lock.json')continue;
  const to=path.join(runtime,n);fs.mkdirSync(path.dirname(to),{recursive:true});fs.copyFileSync(path.join(root,rel),to);
}
if(mode==='baseline')for(const n of ['main.cjs','preload.cjs','web/baram.js'])fs.copyFileSync(path.join(q,'../baseline-source',n),path.join(runtime,n));
write('runtime-pins.json',{reused,source:Object.fromEntries(['main.cjs','preload.cjs','web/baram.js','external-open.cjs'].map(n=>[n,sha(fs.readFileSync(path.join(runtime,n)))]))});
const engine=await import(pathToFileURL(path.join(runtime,'web/studio/rhwp.js')));
engine.initSync({module:fs.readFileSync(path.join(runtime,'web/studio/rhwp_bg.wasm'))});
const snapshot=bytes=>{const d=new engine.HwpDocument(new Uint8Array(bytes));try{return {text:JSON.parse(d.getTextFileText()),pages:d.pageCount()};}finally{d.free();}};
for(const [name,text] of [['startup.hwpx','시작 요청 합성🙂'],['second.hwp','두 번째 합성 문서🙂'],['third.hwpx','세 번째 합성 문서🙂']]){
  const d=engine.HwpDocument.createEmpty();try{d.createBlankDocument();d.insertText(0,0,0,text);
    fs.writeFileSync(path.join(q,'files',name),name.endsWith('.hwp')?d.exportHwp():d.exportHwpx());
  }finally{d.free();}
}
fs.writeFileSync(path.join(q,'files/invalid.hwp'),'invalid synthetic document');
const seedPins=Object.fromEntries(['startup.hwpx','second.hwp','third.hwpx','invalid.hwp'].map(n=>[n,sha(fs.readFileSync(path.join(q,'files',n)))]));
write('input-pins.json',seedPins);
let bootstrap=fs.readFileSync(path.join(root,'scripts/electron-document-lifecycle-bootstrap.cjs'),'utf8');
bootstrap=bootstrap.replace("require('./runtime/main.cjs');",`
let externalPlan;
function emitExternal(c){const e={preventDefault(){this.prevented=true;}};app.emit('open-file',e,path.join(q,'files',c.externalFile));audit('external-open-event',{plan:c.id,file:c.externalFile,prevented:!!e.prevented});}
const externalTimer=setInterval(()=>{const c=control();if(c.externalFile&&externalPlan!==c.id){externalPlan=c.id;emitExternal(c);}},30);
app.on('will-quit',()=>clearInterval(externalTimer));
require('./runtime/main.cjs');
emitExternal({id:'pre-ready',externalFile:'startup.hwpx'});
`);
fs.writeFileSync(path.join(q,'bootstrap.cjs'),bootstrap);
const control=value=>write('control.json',value), audit=()=>fs.existsSync(path.join(q,'audit.jsonl'))?fs.readFileSync(path.join(q,'audit.jsonl'),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[];
control({id:'startup',choice:'cancel',canceled:true});
let child,browser,page,frame,failure,exit;const rows=[],errors=[];
const add=(name,details={})=>{rows.push({name,...details});write('progress.json',rows);console.log('PASS '+name);};
try{
  const env={...process.env,GEULGYEOL_QA_DIR:q,GEULGYEOL_ELECTRON_MODULE:'electron',GEULGYEOL_PROFILE_ROOT:path.join(q,'app-data')};delete env.ELECTRON_RUN_AS_NODE;
  child=spawn(path.join(root,'desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),[path.join(q,'bootstrap.cjs'),'--remote-debugging-port=0','--remote-debugging-address=127.0.0.1'],{env});
  let launch='',launchError;child.once('error',e=>launchError=e);
  for(const stream of [child.stdout,child.stderr])stream.on('data',b=>{launch+=b;fs.appendFileSync(path.join(q,'launch.log'),b);});
  await until(()=>{if(launchError)throw launchError;if(child.exitCode!==null||child.signalCode!==null)throw Error('Owned Electron exited before startup');return /DevTools listening on (ws:\/\/\S+)/.test(launch);},'renderer endpoint');
  browser=await puppeteer.connect({browserWSEndpoint:launch.match(/DevTools listening on (ws:\/\/\S+)/)[1],defaultViewport:null});
  await until(async()=>{page=(await browser.pages()).find(p=>/^http:\/\/127\.0\.0\.1:\d+\/$/.test(p.url()));return page;},'window');
  page.on('pageerror',e=>errors.push(String(e)));page.on('dialog',async d=>{errors.push(d.message());await d.dismiss();});
  const state=()=>page.evaluate(()=>{const h=document.querySelector('#editor iframe')?.contentWindow?.baramHost;return {host:h?.state(),busy:document.querySelector('#save').disabled,error:document.querySelector('#error-dialog').open,errorText:document.querySelector('#error-text').textContent};});
  const settled=()=>until(async()=>!(await state()).busy,'idle');
  const loaded=name=>until(async()=>{const s=await state();return !s.busy&&s.host?.fileName===name;},'loaded '+name);
  await page.waitForFunction(()=>!document.querySelector('#save').disabled,{timeout:45000});
  frame=page.frames().find(f=>f.url().includes('/studio/'));await frame.evaluate(()=>window.rhwpStudio.plugins.load('hwpctrl'));
  const exported=()=>frame.evaluate(()=>Array.from(window.baramHost.export('hwpx'))).then(Buffer.from);
  const edit=text=>frame.evaluate(text=>window.rhwpStudio.plugins.invoke('hwpctrl','invoke',['SetTextFile',[text,'TEXT','insertfile']]),text);
  const event=async(id,externalFile,extra={})=>{control({id,externalFile,choice:'cancel',...extra});await until(()=>audit().some(e=>e.kind==='external-open-event'&&e.plan===id),'event '+id);};
  const dismiss=()=>page.evaluate(()=>document.querySelector('#error-dialog').close());
  if(mode==='baseline'){
    await pause(200);assert.equal(audit().find(e=>e.plan==='pre-ready').prevented,false);
    assert(!snapshot(await exported()).text.includes('시작 요청'));add('baseline ignores pre-ready open-file');
    await event('baseline-ready','second.hwp');await pause(200);
    assert.equal(audit().find(e=>e.plan==='baseline-ready').prevented,false);assert(!snapshot(await exported()).text.includes('두 번째'));
    add('baseline ignores ready open-file');
  }else{
    await loaded('startup.hwpx');assert(snapshot(await exported()).text.includes('시작 요청'));add('pre-ready HWPX request loaded in actual app');
    await event('ready-hwp','second.hwp');await loaded('second.hwp');assert(snapshot(await exported()).text.includes('두 번째'));add('ready HWP request loaded in actual app');
    await edit('취소로 보존할 편집🙂');await settled();const before=sha(await exported());
    await event('cancel','third.hwpx');await until(()=>audit().some(e=>e.kind==='close-confirmation'&&e.plan==='cancel'),'cancel prompt');await settled();
    assert.equal(sha(await exported()),before);assert((await state()).host.dirty);add('cancel preserves exact dirty HWPX bytes',{sha256:before});
    await page.select('#format','hwpx');await event('save-first','third.hwpx',{choice:'save',file:'before-open.hwpx'});await loaded('third.hwpx');
    assert.equal(sha(fs.readFileSync(path.join(q,'files/before-open.hwpx'))),before);add('save-before-open persists all prior edits through real atomic write');
    await edit('저장 대기 중 이전 내용🙂');control({id:'save-gated',file:'gated.hwpx',gate:'release-save'});await page.evaluate(()=>document.querySelector('#save').click());
    await until(()=>audit().some(e=>e.kind==='save-dialog-enter'&&e.plan==='save-gated'),'save pending');
    await event('during-save','second.hwp',{choice:'cancel'});await edit('저장 이후 추가 편집🙂');await pause(120);
    assert.equal((await state()).host.fileName,'third.hwpx');assert((await state()).busy);
    fs.writeFileSync(path.join(q,'release-save'),'ready');
    await until(()=>audit().some(e=>e.kind==='close-confirmation'&&e.plan==='during-save'),'queued prompt');await settled();
    assert.equal((await state()).host.fileName,'third.hwpx');assert((await state()).host.dirty);
    assert(snapshot(await exported()).text.includes('저장 이후 추가 편집'));assert(!snapshot(fs.readFileSync(path.join(q,'files/gated.hwpx'))).text.includes('저장 이후 추가 편집'));
    add('queued open waits for save and cancel preserves later edits');
    await event('stale','second.hwp',{choice:'discard',closeGate:'release-confirm'});
    await until(()=>audit().some(e=>e.kind==='close-confirmation'&&e.plan==='stale'),'stale prompt');await edit('확인 도중 추가 편집🙂');
    fs.writeFileSync(path.join(q,'release-confirm'),'ready');await until(async()=>(await state()).error,'stale error');
    assert(snapshot(await exported()).text.includes('확인 도중 추가 편집'));assert.equal((await state()).host.fileName,'third.hwpx');add('edit during confirmation rejects stale replacement');await dismiss();await settled();
    await event('invalid','invalid.hwp',{choice:'discard'});await until(async()=>(await state()).error,'invalid parse error');const invalidBefore=sha(await exported());
    await event('after-error','startup.hwpx',{choice:'discard'});await pause(120);assert.equal(sha(await exported()),invalidBefore);
    await dismiss();await loaded('startup.hwpx');add('invalid file preserves document; next request waits for error dismissal');
    for(const format of ['hwp','hwpx']){
      await edit('실제 앱 재열기 '+format+'🙂');const expected=snapshot(await exported()).text;
      await page.select('#format',format);control({id:'save-'+format,file:'reopen.'+format});await page.evaluate(()=>document.querySelector('#save').click());await settled();
      assert.equal(snapshot(fs.readFileSync(path.join(q,'files/reopen.'+format))).text,expected);
      await event('reopen-'+format,'reopen.'+format);await loaded('reopen.'+format);assert.equal(snapshot(await exported()).text,expected);
      add('real atomic save and external reopen '+format,{text:expected});
    }
    assert(audit().filter(e=>e.kind==='external-open-event').every(e=>e.prevented));
  }
  assert.deepEqual(errors,[]);
  for(const [n,pin] of Object.entries(seedPins))assert.equal(sha(fs.readFileSync(path.join(q,'files',n))),pin);
  for(const [n,pin] of Object.entries(reused))assert.equal(sha(fs.readFileSync(n)),pin);
}catch(e){failure=String(e);write('failure.json',{failure,stack:e.stack,rows,errors});process.exitCode=1;}
finally{
  browser?.disconnect();
  if(child)exit=await finishOwnedQA(child,{requestClose:async()=>{for(const gate of ['release-save','release-confirm'])if(!fs.existsSync(path.join(q,gate)))fs.writeFileSync(path.join(q,gate),'finally release');control({id:'quit',quit:true,choice:'discard'});},closeTimeoutMs:10000});
  write('proof.json',{mode,rows,errors,failure,exit,actualElectron:true,OSOpenFileEventInjected:true,FinderVerified:false,controlledNativeResponses:true,OSChooserVerified:false,HancomVerified:false,physicalIMEVerified:false,sourceMain:sha(fs.readFileSync(path.join(runtime,'main.cjs'))),engineSHA256:sha(fs.readFileSync(path.join(runtime,'web/studio/rhwp_bg.wasm')))});
  if(!exit?.normalQuit)process.exitCode=1;
}

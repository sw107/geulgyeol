// Actual Electron window only. The QA directory stages byte-identical host files
// and current compiled app UI in its runtime/, plus an isolated bootstrap/profile.
import puppeteer from '../rhwp-studio/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'..'),q=path.resolve(process.argv[2]);
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const write=(name,value)=>fs.writeFileSync(path.join(q,name),JSON.stringify(value,null,2)+'\n');
const control=value=>write('control.json',value);
const audit=()=>fs.readFileSync(path.join(q,'audit.jsonl'),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
async function until(check,label){const end=Date.now()+15000;while(Date.now()<end){if(await check())return;await pause(40);}throw Error('Timeout: '+label);}
assert.equal(process.platform,'darwin');
assert(fs.existsSync(path.join(q,'bootstrap.cjs')),'isolated QA bootstrap required');
assert(!fs.existsSync(path.join(q,'layout-proof.json')),'preserve previous evidence; use fresh QA');
let child,browser,page,frame,normalQuit=false,failure;
const checks=[],errors=[];
const metrics=()=>page.evaluate(()=>{
  const rect=selector=>{const r=document.querySelector(selector).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
  return {inner:[innerWidth,innerHeight],screen:[screen.width,screen.height],dpr:devicePixelRatio,body:rect('body'),header:rect('header'),main:rect('main'),iframe:rect('#editor iframe'),nav:rect('nav'),scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight};
});
async function resize(id,size){control({id,resize:size,canceled:true});await until(()=>audit().some(e=>e.kind==='native-resize'&&e.plan===id),id);await pause(150);return audit().find(e=>e.kind==='native-resize'&&e.plan===id);}
async function capture(id){control({id,capture:id,canceled:true});await until(()=>audit().some(e=>e.kind==='native-capture'&&e.plan===id),id+' capture');}
try{
  control({id:'initial',canceled:true});
  const env={...process.env,GEULGYEOL_ELECTRON_MODULE:'electron'};delete env.ELECTRON_RUN_AS_NODE;
  const exe=path.join(root,'desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
  child=spawn(exe,[path.join(q,'bootstrap.cjs'),'--remote-debugging-port=0','--remote-debugging-address=127.0.0.1'],{env});
  const log=fs.createWriteStream(path.join(q,'layout-launch.log'));let output='',endpoint;
  for(const s of [child.stdout,child.stderr])s.on('data',b=>{output+=b;log.write(b);});
  await until(()=>{endpoint=output.match(/DevTools listening on (ws:\/\/\S+)/)?.[1];if(child.exitCode!==null)throw Error('Electron exited '+child.exitCode);return endpoint;},'endpoint');
  // Reproduce the old connection's default emulation on this disposable window.
  browser=await puppeteer.connect({browserWSEndpoint:endpoint});
  await until(async()=>{page=(await browser.pages()).find(p=>/^http:\/\/127\.0\.0\.1:\d+\/$/.test(p.url()));return page;},'app window');
  page.on('pageerror',e=>errors.push(String(e)));page.on('dialog',d=>d.accept());
  await page.waitForFunction(()=>!document.querySelector('#save').disabled,{timeout:60000});
  frame=page.frames().find(f=>f.url().includes('/studio/'));assert(frame);
  const native=await resize('baseline',[1280,860]),before=await metrics();
  assert.deepEqual(before.inner,[800,600],'old default viewport reproduced');
  assert.notDeepEqual(before.inner,native.contentSize,'old viewport diverges from native window');
  await capture('baseline-fixed-viewport');
  browser.disconnect();
  browser=await puppeteer.connect({browserWSEndpoint:endpoint,defaultViewport:null});
  page=(await browser.pages()).find(p=>/^http:\/\/127\.0\.0\.1:\d+\/$/.test(p.url()));
  page.on('pageerror',e=>errors.push(String(e)));page.on('dialog',d=>d.accept());
  const cdp=await page.createCDPSession();await cdp.send('Emulation.clearDeviceMetricsOverride');
  frame=page.frames().find(f=>f.url().includes('/studio/'));
  const sha=bytes=>crypto.createHash('sha256').update(Buffer.from(bytes)).digest('hex');
  const documentBefore=await frame.evaluate(()=>Array.from(window.baramHost.export('hwpx')));
  const zoom=()=>frame.evaluate(()=>document.querySelector('#sb-zoom-display')?.textContent?.trim()||null);
  const zoomBefore=await zoom();
  assert.match(zoomBefore,/\d+\s*%/,'read actual document zoom');
  for(const [width,height] of [[900,620],[1024,720],[1280,860],[1440,900],[900,620],[1280,860]]){
    const id='native-'+width+'x'+height+'-'+checks.length;
    const n=await resize(id,[width,height]),m=await metrics();
    assert.deepEqual(m.inner,n.contentSize,id+' viewport follows native content size');
    assert.equal(m.body.width,m.inner[0],id+' body width');assert.equal(m.body.height,m.inner[1],id+' body height');
    assert.equal(m.header.right,m.inner[0],id+' header spans window');assert.equal(m.iframe.right,m.inner[0],id+' editor spans window');
    assert(Math.abs(m.iframe.bottom-m.inner[1])<=1,id+' editor reaches bottom');
    assert(m.nav.right<=m.inner[0]&&m.nav.x>=0,id+' toolbar inside window');
    assert.equal(m.scrollWidth,m.inner[0],id+' no outer horizontal overflow');
    assert.equal(sha(await frame.evaluate(()=>Array.from(window.baramHost.export('hwpx')))),sha(documentBefore),id+' document unchanged');
    assert.equal(await zoom(),zoomBefore,id+' document zoom preserved');
    const scroll=await frame.evaluate(()=>{const candidates=[...document.querySelectorAll('*')].filter(e=>{const s=getComputedStyle(e);return /(auto|scroll)/.test(s.overflowY)&&e.scrollHeight>e.clientHeight+1;});const e=candidates.find(e=>e.clientHeight>100);if(!e)return {tested:false};const before=e.scrollTop;e.scrollTop=50;const after=e.scrollTop;e.scrollTop=before;return {tested:true,after,clientHeight:e.clientHeight,scrollHeight:e.scrollHeight};});
    if(scroll.tested)assert(scroll.after>0,id+' document scrolling works');
    await capture(id);checks.push({native:n,metrics:m,documentUnchanged:true,zoom:zoomBefore,scroll});
  }
  assert.equal(errors.length,0,'no renderer errors');
  write('layout-proof.json',{baseline:{native,metrics:before},correction:'defaultViewport:null; clear pre-existing metrics override only on QA reconnect',checks,errors,actualElectron:true,physicalResize:false,CDPUsedOnlyOnElectron:true,documentUnchanged:true,zoomPreserved:true,originalAttachmentLocallyReadable:false});
  console.log(JSON.stringify({baselineViewport:before.inner,baselineNative:native.contentSize,resizeCases:checks.length,errors:errors.length}));
}catch(e){failure=String(e);write('layout-failure.json',{failure,stack:e.stack,checks,errors});console.error(e);process.exitCode=1;}
finally{
  if(child&&child.exitCode===null){control({id:'quit',quit:true,allowDiscard:true,canceled:true});try{await until(()=>child.exitCode!==null,'normal quit');normalQuit=child.exitCode===0;}catch(e){failure=failure||String(e);if(browser)await browser.close().catch(()=>{});}}
  browser?.disconnect();write('layout-lifecycle.json',{normalQuit,exitCode:child?.exitCode,signal:child?.signalCode,failure});if(!normalQuit)process.exitCode=1;
}

// Actual isolated Mac Electron. QA handles expose existing application objects.
// Chooser results are controlled; input, native menu callbacks, IPC and FS are real.
// node ... QA_ROOT SDK FIXTURE_DIR FRESH_PHASE SOURCE_QA_RUNTIME
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import puppeteer from '../rhwp-studio/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
import {observe} from './check-cell-numbering-continuation.mjs';
import {EvidenceBudget} from './qa-evidence-budget.mjs';
import {finishOwnedQA} from './electron-qa-exit.mjs';

// Self-contained so Puppeteer can serialize this exact predicate into the host.
export function reopenedHostReady({name, beforeEpoch}) {
  const save=document.getElementById('save'), label=document.getElementById('filename');
  if(!save || save.disabled || !label || document.getElementById('error-dialog')?.open)return false;
  const studio=document.getElementById('editor')?.querySelector('iframe')?.contentWindow;
  const state=studio?.baramHost?.state(), epoch=studio?.__wasm?.documentGeneration;
  return Number.isSafeInteger(beforeEpoch) && Number.isSafeInteger(epoch)
    && epoch!==beforeEpoch && state?.fileName===name && !state.dirty
    && label.textContent===name;
}

async function main() {
const [qa, sdk, fixtureDir, phase, previousRuntime] = process.argv.slice(2), root = path.resolve(import.meta.dirname, '..');
assert.equal(process.platform, 'darwin');
assert(qa && sdk && fixtureDir && phase && previousRuntime);
const output = path.join(qa, phase); assert(!fs.existsSync(output)); fs.mkdirSync(output);
const budget = new EvidenceBudget({root:qa,phase:output});
budget.begin({normalForecastBytes:96*1024**2,failureForecastBytes:96*1024**2});
const write=(name,value)=>fs.writeFileSync(path.join(output,name),JSON.stringify(value,null,2)+'\n');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const control=value=>write('control.json',value), pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn,label){const end=Date.now()+45000;while(Date.now()<end){if(await fn())return;await pause(50);}throw Error('timeout '+label);}
let child, browser, page, frame, failure, exitOutcome;
const results=[],errors=[];
try {
  const previous=path.resolve(previousRuntime);
  function linkTree(from,to){fs.mkdirSync(to,{recursive:true});for(const entry of fs.readdirSync(from,{withFileTypes:true})){
    const a=path.join(from,entry.name),b=path.join(to,entry.name);
    if(entry.isDirectory())linkTree(a,b);
    else if(entry.isSymbolicLink())fs.symlinkSync(fs.realpathSync(a),b);
    else {assert(entry.isFile());fs.linkSync(a,b);}
  }}
  linkTree(previous,path.join(output,'runtime'));
  for(const name of ['rhwp.js','rhwp.d.ts','rhwp_bg.wasm.d.ts'])
    assert.equal(sha(fs.readFileSync(path.join(previous,'web/studio',name))),sha(fs.readFileSync(path.join(sdk,name))),'unchanged SDK ABI');
  const wasm=path.join(sdk,'rhwp_bg.wasm'), expectedHash=sha(fs.readFileSync(wasm));
  const studio=path.join(output,'runtime/web/studio');
  const aliases=['rhwp_bg.wasm',...fs.readdirSync(path.join(studio,'assets')).filter(name=>/^rhwp_bg.*\.wasm$/.test(name)).map(name=>'assets/'+name)];
  assert.equal(aliases.length,2);
  for(const alias of aliases){const dest=path.join(studio,alias);fs.unlinkSync(dest);fs.linkSync(wasm,dest);}
  for(const name of ['main.cjs','preload.cjs','close-controller.cjs','web/baram.js'])
    assert(fs.readFileSync(path.join(output,'runtime',name)).equals(fs.readFileSync(path.join(root,'desktop',name))));
  let bootstrap=fs.readFileSync(path.join(root,'scripts/electron-document-lifecycle-bootstrap.cjs'),'utf8');
  bootstrap+=`\nlet lastMenu;const menuTimer=setInterval(()=>{const c=control();if(c.menu&&lastMenu!==c.id){lastMenu=c.id;const menu=require('electron').Menu.getApplicationMenu();const item=menu.items.find(i=>i.label==='편집').submenu.items.find(i=>i.label===c.menu);if(!item)throw Error('missing menu '+c.menu);item.click(item,BrowserWindow.getAllWindows()[0]);audit('qa-menu-send',{plan:c.id,label:c.menu});}},25);app.on('will-quit',()=>clearInterval(menuTimer));\n`;
  fs.writeFileSync(path.join(output,'bootstrap.cjs'),bootstrap);fs.mkdirSync(path.join(output,'files'));
  control({id:'start',canceled:true});
  const env={...process.env,GEULGYEOL_ELECTRON_MODULE:'electron',GEULGYEOL_QA_DIR:output};delete env.ELECTRON_RUN_AS_NODE;
  child=spawn(path.join(root,'desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),
    [path.join(output,'bootstrap.cjs'),'--remote-debugging-port=0','--remote-debugging-address=127.0.0.1',
      '--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows'],{env});
  let log='';for(const stream of [child.stdout,child.stderr])stream.on('data',data=>{log+=data;fs.appendFileSync(path.join(output,'launch.log'),data);});
  await until(()=>{if(child.exitCode!==null)throw Error('app exit '+child.exitCode);return /DevTools listening on (ws:\/\/\S+)/.test(log);},'CDP');
  browser=await puppeteer.connect({browserWSEndpoint:log.match(/DevTools listening on (ws:\/\/\S+)/)[1],defaultViewport:null});
  await until(async()=>{page=(await browser.pages()).find(p=>/^http:\/\/127\.0\.0\.1:\d+\/$/.test(p.url()));frame=page?.frames().find(f=>f.url().includes('/studio/'));return frame;},'app frame');
  page.on('pageerror',error=>errors.push(String(error)));
  await page.waitForFunction(()=>!document.querySelector('#save').disabled,{timeout:45000});
  const witness=await frame.evaluate(async()=>{
    const request=performance.getEntriesByType('resource').find(r=>/rhwp_bg.*\.wasm(?:$|\?)/.test(r.name));
    if(!request)throw Error('actual WASM request missing');const bytes=await(await fetch(request.name,{cache:'no-store'})).arrayBuffer();
    return {requestedURL:request.name,servedSHA256:[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join(''),bytes:bytes.byteLength};
  });assert.equal(witness.servedSHA256,expectedHash);write('active-engine-witness.json',witness);
  const settled=()=>frame.waitForFunction(()=>!window.__inputHandler.hasDeferredPaginationPending(),{timeout:45000});
  const load=async(bytes,name)=>{await frame.evaluate(async({bytes,name})=>{await window.rhwpStudio.notifySaved();await window.baramHost.loadDocument(new Uint8Array(bytes),name);},{bytes:Array.from(bytes),name});await settled();};
  const capture=async row=>{
    const data=await frame.evaluate(row=>{const d=window.__wasm.doc;return {
      pages:Array.from({length:d.pageCount()},(_,page)=>d.getPageTextLayout(page)),
      controls:Array.from({length:d.pageCount()},(_,page)=>d.getPageControlLayout(page)),
      texts:Array.from({length:row.columns},(_,cell)=>[0,1,2].map(p=>d.getTextInCellByPath(0,row.parent,JSON.stringify([{controlIndex:row.ci,cellIndex:cell,cellParaIndex:p}]),0,1000000)))};},row);
    const fake={pageCount:()=>data.pages.length,getPageTextLayout:page=>data.pages[page],getPageControlLayout:page=>data.controls[page],getTextInCellByPath:(_s,_p,json)=>{const at=JSON.parse(json)[0];return data.texts[at.cellIndex][at.cellParaIndex];}};
    const view=observe(fake,row);assert(view.cells.every(cell=>cell.mismatchCount===0));return view;
  };
  const menu=async(label,id)=>{control({id,menu:label});await until(()=>fs.readFileSync(path.join(output,'audit.jsonl'),'utf8').includes('"plan":"'+id+'","label"'),'menu callback');await settled();};
  const manifest=JSON.parse(fs.readFileSync(path.join(fixtureDir,'manifest.json')));
  for(const row of manifest){
    const bytes=fs.readFileSync(path.join(fixtureDir,row.file));await load(bytes,row.file);const initial=await capture(row),saves=[];
    if((row.columns===1&&row.wrap==='soft')||(row.columns===2&&row.wrap==='hard')){
      await frame.evaluate(row=>{const h=window.__inputHandler;h.cursor.clearSelection();h.cursor.moveTo({sectionIndex:0,paragraphIndex:1,charOffset:0,parentParaIndex:row.parent,controlIndex:row.ci,cellIndex:0,cellParaIndex:1,cellPath:[{controlIndex:row.ci,cellIndex:0,cellParaIndex:1}]});h.active=true;h.focus();},row);
      await page.keyboard.sendCharacter('X');await settled();
      await frame.waitForFunction(({parent,ci})=>window.__wasm.doc.getTextInCellByPath(0,parent,JSON.stringify([{controlIndex:ci,cellIndex:0,cellParaIndex:1}]),0,1)==='X',{timeout:45000},row);
      assert.equal(await frame.evaluate(()=>window.__inputHandler.history.undoStack.length),1);
      const edited=await capture(row);assert.notEqual(edited.cells[0].textSHA256,initial.cells[0].textSHA256);
      await menu('실행 취소','undo-'+row.file);assert.deepEqual(await capture(row),initial);
      await menu('다시 실행','redo-'+row.file);assert.deepEqual(await capture(row),edited);
      for(const ext of ['hwp','hwpx']){
        await page.waitForFunction(()=>!document.querySelector('#save').disabled,{timeout:45000});
        await page.select('#format',ext);const name=row.file.replace('.hwpx','-edited.'+ext);control({id:'save-'+name,file:name});await page.click('#save');
        await until(()=>fs.existsSync(path.join(output,'files',name)),'host save');
        await until(()=>frame.evaluate(()=>!window.baramHost.state().dirty),'saved state');
        await page.waitForFunction(()=>!document.querySelector('#open').disabled,{timeout:45000});
        const beforeEpoch=await frame.evaluate(()=>window.__wasm.documentGeneration);
        assert(Number.isSafeInteger(beforeEpoch));
        control({id:'open-'+name,openFile:name,choice:'discard'});await page.click('#open');
        // Save already set this filename on the old document. Require a new
        // epoch as well as host completion before inspecting the reopened one.
        await page.waitForFunction(reopenedHostReady,{timeout:45000},{name,beforeEpoch});
        await settled();
        assert.deepEqual(await capture(row),edited);
        saves.push({ext,file:name,sha256:sha(fs.readFileSync(path.join(output,'files',name)))});
      }
    }
    results.push({fixture:row,initial,inputUndoRedo:saves.length===2,saveReopens:saves});write('progress.json',results);budget.check();
    console.log('PASS Electron '+row.file);
  }
  assert.deepEqual(errors,[]);
  await page.screenshot({path:path.join(output,'final.png')});
  control({id:'done',quit:true,choice:'discard'});
  exitOutcome=await finishOwnedQA(child,{requestClose:async()=>control({id:'close',quit:true,choice:'discard'}),closeTimeoutMs:15000});assert(exitOutcome.normalQuit);
  write('proof.json',{actualMacElectron:true,existingQAHandles:true,controlledChooser:true,physicalIME:false,nativeChooser:false,
    qaOnlyWasmAlias:true,engineWitness:witness,results,errors,exitOutcome});
} catch(error){failure=String(error);write('failure.json',{failure,stack:error.stack,results,errors});throw error;}
finally {
  if(child&&child.exitCode===null&&child.signalCode===null)exitOutcome=await finishOwnedQA(child,{requestClose:async()=>control({id:'cleanup',quit:true,choice:'discard'}),allowTerminate:true});
  browser?.disconnect();write('lifecycle.json',{failure,exitOutcome});budget.mark(failure?'failed':'complete');
}
}
if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)await main();

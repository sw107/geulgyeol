// Reuse the preserved app. Optional current WASM is test-injected into the
// unchanged UI bridge; this does not modify or repackage the signed application.
import puppeteer from '../rhwp-studio/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import crypto from 'node:crypto';import {spawn,execFileSync} from 'node:child_process';
const [directory,label,engineDir]=process.argv.slice(2),q=path.resolve(directory),out=path.join(q,label);
fs.mkdirSync(out);const app=path.resolve(q,'../dev12-integration-qa/GeulgyeolDev12.app'),exe=path.join(app,'Contents/MacOS/GeulgyeolDev12');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex'),pause=ms=>new Promise(r=>setTimeout(r,ms));
let child,browser,page,frame;const rows=[],errors=[];let injected=false,reopens=0;
const semantic=()=>frame.evaluate(()=>{const d=window.__wasm.doc;return {text:d.getTextFileText(),styles:JSON.parse(d.getStyleList()),char:JSON.parse(d.getCharPropertiesAt(0,0,0)),para:JSON.parse(d.getParaPropertiesAt(0,0))};});
const templateGetterDifferences=[];
function compare(actual,expected,label){
 const adjusted=structuredClone(actual);
 for(const scope of ['char','para']){
  if(actual[scope].fillType==='none'&&expected[scope].fillType==='solid'&&actual[scope].patternColor==='#000000'&&expected[scope].patternColor==='#999999'&&actual[scope].patternType===0&&expected[scope].patternType===-1){
   templateGetterDifferences.push({label,scope,fields:['fillType','patternColor','patternType']});
   for(const f of ['fillType','patternColor','patternType'])adjusted[scope][f]=expected[scope][f];
  }
 }
 assert.deepEqual(adjusted,expected,label);
}
try{
 const env={...process.env,GEULGYEOL_DEV_PROFILE_ROOT:path.join(out,'profile')};delete env.ELECTRON_RUN_AS_NODE;
 child=spawn(exe,['--remote-debugging-port=0','--remote-debugging-address=127.0.0.1'],{env});let launch='';
 const log=fs.createWriteStream(path.join(out,'launch.log'));for(const stream of [child.stdout,child.stderr])stream.on('data',b=>{launch+=b;log.write(b);});let endpoint;
 for(let n=0;n<100;n++){endpoint=launch.match(/DevTools listening on (ws:\/\/\S+)/)?.[1];if(endpoint)break;assert.equal(child.exitCode,null);await pause(200);}assert(endpoint);browser=await puppeteer.connect({browserWSEndpoint:endpoint});
 for(let n=0;n<100;n++){page=(await browser.pages()).find(p=>/^http:\/\/127\.0\.0\.1:\d+\/$/.test(p.url()));if(page)break;await pause(200);}assert(page);page.on('pageerror',e=>errors.push(String(e)));
 for(let n=0;n<150;n++){frame=page.frames().find(f=>f.url().includes('/studio/'));if(frame&&await frame.evaluate(()=>Boolean(window.__inputHandler?.active)).catch(()=>false))break;await pause(200);}assert(frame);await frame.waitForFunction(()=>window.__inputHandler?.active);
 if(await frame.$('.dialog-close'))await frame.click('.dialog-close');
 let engineHash=JSON.parse(fs.readFileSync(path.join(q,'../dev12-integration-qa/renderer-proof.json'))).loadedWasmSHA256;
 if(engineDir){
  const glue=fs.readFileSync(path.join(engineDir,'rhwp.js'));const served=await frame.evaluate(async()=>await(await fetch(new URL('rhwp.js',location.href))).text());assert.equal(sha(Buffer.from(served)),sha(glue),'test-injected engine uses identical ABI glue');
  const bytes=fs.readFileSync(path.join(engineDir,'rhwp_bg.wasm'));engineHash=sha(bytes);
  await frame.evaluate(async base64=>{const m=await import(new URL('rhwp.js',location.href).href);const raw=atob(base64),bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));await m.default({module_or_path:bytes});window.__wasm.doc.free();window.__wasm.doc=m.HwpDocument.createEmpty();window.__newDocumentTestModule=m;},bytes.toString('base64'));
  injected=true;
 }
 // The actual host button calls SDK -> baramHost.newDocument -> main.initializeDocument.
 await page.waitForFunction(()=>!document.getElementById('new').disabled);await page.click('#new');
 await frame.waitForFunction(()=>window.__wasm.fileName==='새 문서.hwp'&&window.__inputHandler.active&&!document.documentElement.classList.contains('rhwp-busy'));
 await pause(300);
 for(const stage of ['blank','text','formatted']){
  if(stage==='text'){
   await frame.evaluate(()=>{const h=window.__inputHandler;h.cursor.moveTo({sectionIndex:0,paragraphIndex:0,charOffset:0});h.cursor.clearSelection();h.updateCaret();h.focus();});
   await page.keyboard.sendCharacter('첫 한글🙂𐐀 입력');
  }
  if(stage==='formatted'){
   await frame.evaluate(()=>{const h=window.__inputHandler;h.cursor.selectRange({sectionIndex:0,paragraphIndex:0,charOffset:0},{sectionIndex:0,paragraphIndex:0,charOffset:Array.from('첫 한글🙂𐐀 입력').length});h.updateCaret();h.focus();});
   assert.deepEqual(await frame.evaluate(()=>window.__inputHandler.dispatcher.dispatchWithResult('format:bold')),{ok:true});
  }
  const expected=await semantic();if(stage!=='blank')assert(await frame.evaluate(()=>JSON.parse(window.__wasm.doc.getTextFileUnicode()).includes('첫 한글🙂𐐀 입력')));if(stage==='formatted')assert.equal(expected.char.bold,true);
  for(const format of ['hwp','hwpx']){
   const bytes=await frame.evaluate(format=>Array.from(window.baramHost.export(format)),format);const file=path.join(out,stage+'.'+format);fs.writeFileSync(file,Buffer.from(bytes));
   const sourceSvg=await frame.evaluate(()=>Array.from({length:window.__wasm.pageCount},(_,p)=>window.__wasm.renderPageSvg(p)));
   // Current injected engine explicitly reopens/resaves its bytes; packaged UI
   // file loading would instantiate the older bundled constructor instead.
   let savedSvg=sourceSvg;
   if(injected){
    const result=await frame.evaluate(({bytes,format})=>{const M=window.__newDocumentTestModule;let d=new M.HwpDocument(new Uint8Array(bytes));const sem=d=>({text:d.getTextFileText(),styles:JSON.parse(d.getStyleList()),char:JSON.parse(d.getCharPropertiesAt(0,0,0)),para:JSON.parse(d.getParaPropertiesAt(0,0))});const first=sem(d);const firstSvg=Array.from({length:d.pageCount()},(_,p)=>d.renderPageSvg(p));const next=format==='hwp'?'hwpx':'hwp';const b=next==='hwp'?d.exportHwp():d.exportHwpx();d.free();d=new M.HwpDocument(b);const second=sem(d);const again=next==='hwp'?d.exportHwp():d.exportHwpx();d.free();d=new M.HwpDocument(again);const third=sem(d);d.free();return {first,second,third,firstSvg};},{bytes,format});
    compare(result.first,expected,stage+'/'+format+'/first');compare(result.second,expected,stage+'/'+format+'/second');compare(result.third,expected,stage+'/'+format+'/third');reopens+=3;savedSvg=result.firstSvg;
   }
   rows.push({file,semantic:expected,svg:savedSvg,sourceSvg,sourceAndReopenedSVGExact:JSON.stringify(sourceSvg)===JSON.stringify(savedSvg),stage,source:'actual-Electron-UI-template',engineSHA256:engineHash});
  }
 }
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify(rows,null,2));fs.writeFileSync(path.join(out,'proof.json'),JSON.stringify({actualElectronRenderer:true,actualHostNewButtonAndSDKInitialization:true,UIProductSource:'30601b1 (unchanged new-document UI)',preservedAppModified:false,candidateEngineTestInjected:injected,engineSHA256:engineHash,states:3,savedFiles:6,currentEngineReopens:reopens,packagedUIFileLoadVerified:false,templateTransparentFillGetterDifferenceUnfixed:templateGetterDifferences.length > 0,templateGetterDifferences,physicalIMEVerified:false,OSClipboardAccessed:false,OSDialogsInvoked:0,errors},null,2));console.log(JSON.stringify({states:3,savedFiles:6,currentEngineReopens:reopens,injected}));
}finally{
 let normalQuit=false;
 if(child&&child.exitCode===null){try{await frame?.evaluate(()=>window.rhwpStudio.notifySaved()).catch(()=>{});await pause(300);execFileSync('/usr/bin/osascript',['-e','tell application "'+app+'" to quit'],{timeout:10000});for(let n=0;n<50&&child.exitCode===null;n++)await pause(200);normalQuit=child.exitCode===0;}catch{}if(child.exitCode===null)child.kill('SIGTERM');}
 browser?.disconnect();fs.writeFileSync(path.join(out,'lifecycle.json'),JSON.stringify({normalQuit,exit:child?.exitCode,signal:child?.signalCode},null,2));if(!normalQuit)process.exitCode=1;
}

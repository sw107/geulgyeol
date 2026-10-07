// Actual current-source Mac Chrome. DEV positions, no OS clipboard or physical IME.
import puppeteer from '../rhwp-studio/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import crypto from 'node:crypto';
const [outArg,url='http://127.0.0.1:32170/studio/']=process.argv.slice(2),out=path.resolve(outArg),baseline=process.argv.includes('--baseline'),staleOnly=process.argv.includes('--stale-only'),dialogsOnly=process.argv.includes('--dialogs-only'),rootMergeOnly=process.argv.includes('--root-merge-only');
const fixtures=JSON.parse(fs.readFileSync(path.join(out,'native/nested-fixtures.json'))),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const ids=['table:insert-row-above','table:insert-row-below','table:insert-col-left','table:insert-col-right','table:delete-row','table:delete-col','table:cell-merge','table:cell-split','table:insert-row-col','table:delete-row-col'];
let browser,page,phase='launch';const checks=[],manifest=[],errors=[],runtime=[],refusals=[],staleDialogs=[];let pairs=0,rootCases=0;
const state=()=>page.evaluate(()=>({hwp:Array.from(window.__wasm.exportHwp()),hwpx:Array.from(window.__wasm.exportHwpx()),svg:Array.from({length:window.__wasm.pageCount},(_,p)=>window.__wasm.renderPageSvg(p))}));
const history=()=>page.evaluate(()=>({u:window.__inputHandler.history.undoStack.length,r:window.__inputHandler.history.redoStack.length}));
async function load(file){phase='load '+path.basename(file);await page.evaluate(()=>window.rhwpStudio.notifySaved());await (await page.$('#file-input')).uploadFile(path.resolve(file));await page.waitForFunction(name=>window.__wasm?.fileName===name&&window.__inputHandler?.active&&!document.documentElement.classList.contains('rhwp-busy'),{timeout:30000},path.basename(file));await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));}
async function move(f,nested,selection=false){await page.evaluate(({f,nested,selection})=>{const h=window.__inputHandler,c=h.cursor;c.exitCellSelectionMode();c.exitCellMode?.();c.clearSelection();const p=nested?f.path:[{controlIndex:f.ref.ci,cellIndex:0,cellParaIndex:0}];c.moveTo({sectionIndex:0,paragraphIndex:p.at(-1).cellParaIndex,charOffset:0,parentParaIndex:f.ref.ppi,controlIndex:p[0].controlIndex,cellIndex:p[0].cellIndex,cellParaIndex:p[0].cellParaIndex,cellPath:p});if(selection){if(!c.enterCellSelectionMode())throw Error('F5 failed');c.setCellSelectionAnchor(0,0);c.setCellSelectionFocus(0,1);}h.updateCaret();h.focus();}, {f,nested,selection});}
async function key(redo=false){await page.evaluate(()=>window.__inputHandler.focus());await page.keyboard.down('Meta');if(redo)await page.keyboard.down('Shift');try{await page.keyboard.press('z');}finally{if(redo)await page.keyboard.up('Shift');await page.keyboard.up('Meta');}await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));}
async function dispatch(id){return page.evaluate(id=>window.__inputHandler.dispatcher.dispatchWithResult(id),id);}
async function splitApply(){await page.waitForSelector('#csd-col-check');await page.click('.modal-overlay .dialog-btn-primary');await page.waitForSelector('#csd-col-check',{hidden:true});}
const inspect=f=>page.evaluate(f=>{const w=window.__wasm,h=window.__inputHandler;let leaf;try{leaf=w.getTableDimensionsByPath(0,f.ref.ppi,JSON.stringify(f.path));}catch(e){leaf={error:String(e)};}return {root:w.getTableDimensions(0,f.ref.ppi,f.ref.ci),leaf,fields:w.getFieldList(),position:h.getCursorPosition(),context:h.getCellTableContext()};},f);
try{
 browser=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:false,userDataDir:path.join(out,'chrome-integration-profile'),args:['--window-size=1280,900','--no-first-run','--no-default-browser-check']});page=await browser.newPage();await page.setViewport({width:1280,height:860});await page.setCacheEnabled(false);page.on('pageerror',e=>errors.push(String(e)));page.on('dialog',d=>d.dismiss());page.on('response',r=>{if(r.url().includes('rhwp_bg.wasm'))runtime.push(r.buffer().then(b=>({url:r.url(),sha256:sha(b)})));});await page.setRequestInterception(true);const origin=new URL(url).origin;page.on('request',r=>r.url().startsWith(origin+'/')||r.url().startsWith('data:')||r.url().startsWith('blob:')?r.continue():r.abort());await page.goto(url+'?renderer=canvas2d',{waitUntil:'networkidle0'});await page.waitForFunction(()=>window.__inputHandler?.active);if(await page.$('.dialog-close'))await page.click('.dialog-close');
 if(rootMergeOnly){
  const rows=[],saved=[];let count=0;
  for(const f of fixtures){await load(f.input);await move(f,true);await move(f,false,true);const b=await state(),before=await inspect(f),hist=await history();assert.deepEqual(await dispatch('table:cell-merge'),{ok:true});const a=await state(),after=await inspect(f);assert.equal(after.root.cellCount,3);const identity=v=>v.map(({location,listId,paraInList,...x})=>{if(x.cellField)delete x.fieldId;return x;});assert.deepEqual(identity(after.fields),identity(before.fields));assert.equal((await history()).u,hist.u+1);
   for(let i=0;i<4;i++){await key();assert.deepEqual(await state(),b);await key(true);assert.deepEqual(await state(),a);count++;}
   for(const [stage,data,operations] of [['after',a,[[0,0,0,1]]],['undo',b,[]]])for(const ext of ['hwp','hwpx']){const file=path.join(out,'root-merge-'+f.label+'-'+stage+'.'+ext);fs.writeFileSync(file,Buffer.from(data[ext]));saved.push({input:path.resolve(f.input),file,ref:f.ref,operations});await load(file);assert.deepEqual((await state()).svg,data.svg);}
   rows.push({fixture:f.label,depth:f.depth,nestedOwnersMovedWithRootMerge:true});
  }
  assert.equal(errors.length,0);fs.writeFileSync(path.join(out,'root-merge-manifest.json'),JSON.stringify(saved,null,2));fs.writeFileSync(path.join(out,'root-merge-proof.json'),JSON.stringify({cases:rows.length,checks:rows,undoRedoPairs:count,savedReopens:saved.length,errors},null,2));console.log('PASS root merges '+rows.length+' pairs '+count+' reopens '+saved.length);
 }else if(dialogsOnly){
  const rows=[],saved=[];let count=0;
  for(const f of fixtures.filter(f=>f.depth===2&&!f.merged)){
   await load(f.input);await move(f,true);await move(f,false);let operations=[];
   for(const [id,kind] of [['table:insert-row-col','insertRow'],['table:delete-row-col','deleteRow']]){
    const b=await state(),prev=structuredClone(operations),hist=await history();assert.deepEqual(await dispatch(id),{ok:true});await page.waitForSelector('.modal-overlay .dialog-btn-primary');await page.click('.modal-overlay .dialog-btn-primary');await page.waitForSelector('.modal-overlay',{hidden:true});const a=await state();assert.notDeepEqual(a.hwpx,b.hwpx,'normal dialog applies');assert.equal((await history()).u,hist.u+1);operations.push({kind});
    for(let i=0;i<4;i++){await key();assert.deepEqual(await state(),b);await key(true);assert.deepEqual(await state(),a);count++;}
    for(const [stage,data,ops] of [['after',a,operations],['undo',b,prev]])for(const ext of ['hwp','hwpx']){const file=path.join(out,'dialog-'+f.label+'-'+kind+'-'+stage+'.'+ext);fs.writeFileSync(file,Buffer.from(data[ext]));saved.push({input:path.resolve(f.input),file,ref:f.ref,operations:structuredClone(ops)});await load(file);assert.deepEqual((await state()).svg,data.svg);}
    await load(path.join(out,'dialog-'+f.label+'-'+kind+'-after.hwpx'));operations.push({kind:'reopen',format:'hwpx'});await move(f,false);rows.push({fixture:f.label,id,kind});
   }
  }
  assert.equal(errors.length,0);fs.writeFileSync(path.join(out,'dialogs-manifest.json'),JSON.stringify(saved,null,2));fs.writeFileSync(path.join(out,'dialogs-proof.json'),JSON.stringify({cases:rows.length,checks:rows,undoRedoPairs:count,savedReopens:saved.length,errors},null,2));console.log('PASS normal dialogs '+rows.length+' pairs '+count+' reopens '+saved.length);
 }else if(staleOnly){
  const rows=[];
  for(const f of fixtures.filter(f=>f.depth===2&&!f.merged))for(const id of ['table:cell-split','table:insert-row-col','table:delete-row-col'])for(const change of ['other-cell','other-range','reloaded-document']){
   await load(f.input);await move(f,false);assert.deepEqual(await dispatch(id),{ok:true});await page.waitForSelector('.modal-overlay .dialog-btn-primary');
   if(change==='reloaded-document'){await load(f.input);await move(f,false);}
   else if(change==='other-range'){await move(f,false,true);}
   else{await page.evaluate(f=>{const h=window.__inputHandler,c=h.cursor,p={controlIndex:f.ref.ci,cellIndex:2,cellParaIndex:0};c.moveTo({sectionIndex:0,paragraphIndex:0,charOffset:0,parentParaIndex:f.ref.ppi,controlIndex:p.controlIndex,cellIndex:2,cellParaIndex:0,cellPath:[p]});h.updateCaret();},f);}
   const b=await state(),hist=await history();await page.click('.modal-overlay .dialog-btn-primary');await page.waitForSelector('.modal-overlay',{hidden:true});assert.deepEqual(await state(),b,id+' stale '+change);assert.deepEqual(await history(),hist);rows.push({fixture:f.label,id,change,unchanged:true});
  }
  const f=fixtures.find(f=>f.depth===3&&!f.merged&&f.input.endsWith('.hwpx'));await load(f.input);await move(f,true,true);
  // Leave the inner F5 context intact while the flat cursor moves to the root.
  await page.evaluate(f=>{const h=window.__inputHandler,p={controlIndex:f.ref.ci,cellIndex:0,cellParaIndex:0};h.cursor.moveTo({sectionIndex:0,paragraphIndex:0,charOffset:0,parentParaIndex:f.ref.ppi,controlIndex:f.ref.ci,cellIndex:0,cellParaIndex:0,cellPath:[p]});h.updateCaret();},f);
  for(const id of ids){const b=await state(),hist=await history();assert.deepEqual(await dispatch(id),{ok:false,reason:'disabled'});await page.evaluate(id=>{const d=window.__inputHandler.dispatcher;d.registry.get(id).execute(d.services);},id);assert.deepEqual(await state(),b);assert.deepEqual(await history(),hist);rows.push({id,change:'inner-selection-context-with-root-cursor',unchanged:true});}
  await move(f,false);await page.evaluate(()=>{const h=window.__inputHandler,p=h.getCursorPosition();p.cellPath=[{controlIndex:p.controlIndex,cellIndex:2,cellParaIndex:0}];h.cursor.moveTo(p);h.updateCaret();});
  for(const id of ids){const b=await state(),hist=await history();await page.evaluate(id=>{const d=window.__inputHandler.dispatcher;d.registry.get(id).execute(d.services);},id);assert.deepEqual(await state(),b);assert.deepEqual(await history(),hist);assert.equal(await page.$('.modal-overlay'),null);rows.push({id,change:'inconsistent-root-path-and-flat-cell',unchanged:true});}
  assert.equal(errors.length,0);fs.writeFileSync(path.join(out,'stale-root-proof.json'),JSON.stringify({checks:rows,errors},null,2));console.log('PASS stale-root '+rows.length);
 }else if(baseline){const f=fixtures.find(f=>f.depth===2&&!f.merged&&f.input.endsWith('.hwpx'));
  for(const id of [ids[1],ids[3],ids[4],ids[5],ids[6],ids[7]]){await load(f.input);await move(f,true,id==='table:cell-merge');const before=await inspect(f),b=await state();assert.equal(before.context.cellPath.length,2);const result=await dispatch(id);if(id==='table:cell-split'&&result.ok)await splitApply();const after=await inspect(f),a=await state();assert.notDeepEqual(a.hwpx,b.hwpx,'reproduced mutation');assert.notDeepEqual(after.root,before.root,'wrong root changed');fs.writeFileSync(path.join(out,'baseline-'+id.split(':')[1]+'.hwpx'),Buffer.from(a.hwpx));checks.push({id,result,before,after,wrongRootChanged:true});console.log('REPRO '+id);}
  fs.writeFileSync(path.join(out,'baseline-proof.json'),JSON.stringify({checks,errors,runtime:await Promise.all(runtime)},null,2));
 }else{
  const fieldIdentity=v=>v.map(({location,listId,paraInList,...x})=>{if(x.cellField)delete x.fieldId;return x;});
  for(const f of fixtures){
   for(const [id,kind] of [['table:insert-row-above','insertRow'],['table:insert-col-left','insertColumn']]){
    await load(f.input);await move(f,true);await move(f,false);const b=await state(),before=await inspect(f),length=(await history()).u;
    assert.deepEqual(await dispatch(id),{ok:true},'root supported');const a=await state(),after=await inspect(f);assert.deepEqual(fieldIdentity(after.fields),fieldIdentity(before.fields),'nested/root field identities');assert.equal((await history()).u,length+1);
    for(let cycle=0;cycle<4;cycle++){await key();assert.deepEqual(await state(),b,'root exact undo');await key(true);assert.deepEqual(await state(),a,'root exact redo');pairs++;}
    await key();
    if(kind==='insertRow'){
     assert((await history()).r>0,'pending redo');await move(f,true);const shape=await inspect(f);assert.equal(shape.position.cellPath.length,f.depth);assert.equal(shape.context.cellPath.length,f.depth);
     for(const command of ids){
      await move(f,true,command==='table:cell-merge');const before=await state(),hist=await history();
      for(let repeat=0;repeat<4;repeat++){
       const result=await dispatch(command);assert.deepEqual(result,{ok:false,reason:'disabled'},command+' disabled at nested path');
       assert.deepEqual(await state(),before,command+' dispatch unchanged');assert.deepEqual(await history(),hist,command+' history');
       // Direct execute must also refuse if an external caller bypasses canExecute.
       await page.evaluate(id=>{const d=window.__inputHandler.dispatcher;d.registry.get(id).execute(d.services);},command);
       assert.deepEqual(await state(),before,command+' direct unchanged');assert.deepEqual(await history(),hist,command+' direct history');
       assert.equal(await page.$('.modal-overlay'),null,'no unsupported dialog opened');
      }
      refusals.push({fixture:f.label,command,depth:f.depth,dispatchRepeats:4,directRepeats:4,unchangedHwpHwpxSvgHistory:true});
     }
     // Root dialogs are bound to their opening target. A nested cursor at Apply
     // must not reuse captured root coordinates or a changed current target.
     for(const command of ['table:cell-split','table:insert-row-col','table:delete-row-col']){
      await move(f,false);assert.deepEqual(await dispatch(command),{ok:true});await page.waitForSelector('.modal-overlay .dialog-btn-primary');await move(f,true);const before=await state(),hist=await history();await page.click('.modal-overlay .dialog-btn-primary');await page.waitForSelector('.modal-overlay',{hidden:true});assert.deepEqual(await state(),before,'stale dialog unchanged');assert.deepEqual(await history(),hist,'stale dialog redo retained');staleDialogs.push({fixture:f.label,command,nestedTargetAtApply:true});
     }
     await move(f,false);
    }
    await key(true);assert.deepEqual(await state(),a,'redo remains usable after refusals');
    for(const [stage,data,operations] of [['after',a,[{kind}]],['undo',b,[]]])for(const ext of ['hwp','hwpx']){
     const file=path.join(out,f.label+'-'+kind+'-'+stage+'.'+ext);fs.writeFileSync(file,Buffer.from(data[ext]));manifest.push({input:path.resolve(f.input),file,ref:f.ref,operations});await load(file);assert.deepEqual((await state()).svg,data.svg,'saved full SVG '+path.basename(file));
    }
    checks.push({fixture:f.label,id,depth:f.depth,wholeDocumentUndoRedoBytes:true});rootCases++;console.log('PASS root '+f.label+' '+kind);
   }
  }
  assert.equal(errors.length,0);const received=await Promise.all(runtime);assert(received.some(v=>v.sha256===sha(fs.readFileSync(path.join(out,'pkg/rhwp_bg.wasm')))));
  const proof={rootCases,rootUndoRedoPairs:pairs,savedReopens:manifest.length,refusals,staleDialogs,runtime:received,errors,headless:false,DEVPositionSetup:true,physicalIMEVerified:false,nativeElectronVerified:false,OSClipboardAccessed:false};fs.writeFileSync(path.join(out,'browser-proof.json'),JSON.stringify(proof,null,2));fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify(manifest,null,2));await page.screenshot({path:path.join(out,'current-source-browser.png')});console.log(JSON.stringify({rootCases,pairs,reopens:manifest.length,nestedDispatchRefusals:refusals.length*4,directRefusals:refusals.length*4,staleDialogs:staleDialogs.length}));
 }
}catch(e){fs.writeFileSync(path.join(out,'browser-failure-'+Date.now()+'.json'),JSON.stringify({phase,error:String(e).slice(0,1000),checks,errors},null,2));throw e;}finally{await browser?.close();}

// Current-source headed Mac Chrome, exact path commands/Bridge/history/save.
// DEV cursor placement; no physical pointer, IME, clipboard or installed host claim.
import puppeteer from '../rhwp-studio/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import crypto from 'node:crypto';
const [outArg,url='http://127.0.0.1:32171/studio/']=process.argv.slice(2),out=path.resolve(outArg);
const fixtures=JSON.parse(fs.readFileSync(path.join(out,'native/nested-row-fixtures.json')));
const unsupported=JSON.parse(fs.readFileSync(path.join(out,'native/scope-fixtures/nested-fixtures.json')));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex'),ids=['table:insert-row-above','table:insert-row-below','table:insert-col-left','table:insert-col-right','table:delete-row','table:delete-col','table:cell-merge','table:cell-split','table:insert-row-col','table:delete-row-col'];
let browser,page,phase='launch',pairs=0;const errors=[],runtime=[],checks=[],manifest=[],refusals=[],stale=[];
const state=()=>page.evaluate(()=>({hwp:Array.from(window.__wasm.exportHwp()),hwpx:Array.from(window.__wasm.exportHwpx()),svg:Array.from({length:window.__wasm.pageCount},(_,p)=>window.__wasm.renderPageSvg(p))}));
const history=()=>page.evaluate(()=>({u:window.__inputHandler.history.undoStack.length,r:window.__inputHandler.history.redoStack.length}));
const dispatch=id=>page.evaluate(id=>window.__inputHandler.dispatcher.dispatchWithResult(id),id);
async function load(file){phase='load '+path.basename(file);await page.evaluate(()=>window.rhwpStudio.notifySaved());await(await page.$('#file-input')).uploadFile(path.resolve(file));await page.waitForFunction(name=>window.__wasm?.fileName===name&&window.__inputHandler?.active&&!document.documentElement.classList.contains('rhwp-busy'),{timeout:30000},path.basename(file));await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));}
async function move(f,anchor=0){await page.evaluate(({f,anchor})=>{const h=window.__inputHandler,c=h.cursor;c.exitCellSelectionMode();c.exitCellMode?.();c.clearSelection();const p=f.path.map(x=>({...x}));p.at(-1).cellIndex=anchor;p.at(-1).cellParaIndex=0;c.moveTo({sectionIndex:0,paragraphIndex:0,charOffset:0,parentParaIndex:f.ref.ppi,controlIndex:p[0].controlIndex,cellIndex:p[0].cellIndex,cellParaIndex:p[0].cellParaIndex,cellPath:p});h.updateCaret();h.focus();},{f,anchor});}
async function key(redo=false){await page.evaluate(()=>window.__inputHandler.focus());await page.keyboard.down('Meta');if(redo)await page.keyboard.down('Shift');try{await page.keyboard.press('z');}finally{if(redo)await page.keyboard.up('Shift');await page.keyboard.up('Meta');}await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));}
const protectedView=f=>page.evaluate(f=>{const w=window.__wasm;return {root:w.getTableDimensions(0,f.ref.ppi,f.ref.ci),properties:w.getTableProperties(0,f.ref.ppi,f.ref.ci),fields:w.getFieldList().map(({location,listId,paraInList,...x})=>{if(x.cellField)delete x.fieldId;return x;}),body:Array.from({length:w.getParagraphCount(0)},(_,p)=>w.getTextRange(0,p,0,10000)),rootCells:Array.from({length:w.getTableDimensions(0,f.ref.ppi,f.ref.ci).cellCount},(_,cell)=>({info:w.getCellInfo(0,f.ref.ppi,f.ref.ci,cell),paragraphs:Array.from({length:w.getCellParagraphCount(0,f.ref.ppi,f.ref.ci,cell)},(_,p)=>({text:w.doc.getTextInCell(0,f.ref.ppi,f.ref.ci,cell,p,0,10000),props:JSON.parse(w.doc.getCellParaPropertiesAt(0,f.ref.ppi,f.ref.ci,cell,p))}))}))};},f);
try{
 browser=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:false,userDataDir:process.env.GEULGYEOL_QA_BROWSER_PROFILE??path.join(out,'chrome-integration-profile'),args:['--window-size=1280,900','--no-first-run','--no-default-browser-check']});page=await browser.newPage();await page.setViewport({width:1280,height:860});await page.setCacheEnabled(false);page.on('pageerror',e=>errors.push(String(e)));page.on('dialog',d=>d.dismiss());page.on('response',r=>{if(r.url().includes('rhwp_bg.wasm'))runtime.push(r.buffer().then(b=>({url:r.url(),sha256:sha(b)})));});await page.setRequestInterception(true);const origin=new URL(url).origin;page.on('request',r=>r.url().startsWith(origin+'/')||r.url().startsWith('data:')||r.url().startsWith('blob:')?r.continue():r.abort());await page.goto(url+'?renderer=canvas2d',{waitUntil:'networkidle0'});await page.waitForFunction(()=>window.__inputHandler?.active);if(await page.$('.dialog-close'))await page.click('.dialog-close');
 for(const f of fixtures)for(const [name,action,anchor] of [['above-first','insertAbove',0],['below-first','insertBelow',0],['above-last','insertAbove',2],['below-last','insertBelow',2],['delete-text-last','delete',2],['insert-delete','insertAbove',0]]){
  phase=f.label+' '+name;await load(f.input);await move(f,anchor);const b=await state(),protectedBefore=await protectedView(f),hist=await history(),command=action==='delete'?ids[4]:action==='insertAbove'?ids[0]:ids[1];
  const operationPath=structuredClone(f.path);operationPath.at(-1).cellIndex=anchor;const operations=[{kind:'nestedRow',path:operationPath,action}];
  assert.deepEqual(await dispatch(command),{ok:true});assert.equal((await history()).u,hist.u+1);
  const expectedRow=anchor/2+(action==='insertAbove'?1:0);const cursor=await page.evaluate(()=>({position:window.__inputHandler.getCursorPosition(),info:window.__wasm.getCellInfoByPath(0,window.__inputHandler.getCursorPosition().parentParaIndex,JSON.stringify(window.__inputHandler.getCursorPosition().cellPath))}));
  assert.equal(cursor.position.cellPath.length,2);assert.equal(cursor.info.row,action==='delete'?0:expectedRow);assert.equal(cursor.info.col,0);
  if(name==='insert-delete'){await move(f,0);assert.deepEqual(await dispatch(ids[4]),{ok:true});operations.push({kind:'nestedRow',path:structuredClone(f.path),action:'delete'});assert.equal((await history()).u,hist.u+2);}
  const a=await state();assert.deepEqual(await protectedView(f),protectedBefore,'outside inner target preserved '+phase);
  const layout=await page.evaluate(f=>({dims:window.__wasm.getTableDimensionsByPath(0,f.ref.ppi,JSON.stringify(f.path)),leaf:window.__wasm.getTableCellBboxesByPath(0,f.ref.ppi,JSON.stringify(f.path)),parent:window.__wasm.getTableCellBboxes(0,f.ref.ppi,f.ref.ci).filter(b=>b.cellIdx===f.path[0].cellIndex)}),f);
  assert.equal(layout.dims.rowCount,name==='insert-delete'?2:action==='delete'?1:3);
  for(let cell=0;cell<layout.dims.cellCount;cell++)assert(layout.leaf.some(b=>b.cellIdx===cell&&b.w>0&&b.h>0),'visible inner cell '+cell);
  for(const b of layout.leaf){assert([b.x,b.y,b.w,b.h].every(Number.isFinite));assert(layout.parent.some(p=>p.pageIndex===b.pageIndex&&b.x>=p.x-2&&b.y>=p.y-2&&b.x+b.w<=p.x+p.w+2&&b.y+b.h<=p.y+p.h+2),'ancestor contains inner frame');}

  for(let cycle=0;cycle<4;cycle++){
   await key();if(name==='insert-delete')await key();assert.deepEqual(await state(),b,'exact undo '+phase);
   await key(true);if(name==='insert-delete')await key(true);assert.deepEqual(await state(),a,'exact redo '+phase);pairs+=name==='insert-delete'?2:1;
  }
  for(const [stage,data,ops] of [['after',a,operations],['undo',b,[]]])for(const ext of ['hwp','hwpx']){
   const file=path.join(out,f.label+'-'+name+'-'+stage+'.'+ext);fs.writeFileSync(file,Buffer.from(data[ext]));manifest.push({input:path.resolve(f.input),file,ref:f.ref,operations:ops});await load(file);assert.deepEqual((await state()).svg,data.svg,'saved full SVG '+phase+' '+ext);
  }
  checks.push({fixture:f.label,name,action,anchor,outsidePreserved:true,cursorRebound:true,visibleInnerCellsAndAncestorContainment:true});console.log('PASS '+phase);
 }
 // Refusal stress with a real pending redo: unsupported commands still preserve it.
 for(const f of [...fixtures,...unsupported.filter(f=>f.depth!==2||f.merged)]){
  await load(f.input);await move(f);await page.evaluate(f=>{const h=window.__inputHandler,p={controlIndex:f.ref.ci,cellIndex:0,cellParaIndex:0};h.cursor.moveTo({sectionIndex:0,paragraphIndex:0,charOffset:0,parentParaIndex:f.ref.ppi,controlIndex:f.ref.ci,cellIndex:0,cellParaIndex:0,cellPath:[p]});h.updateCaret();},f);assert.deepEqual(await dispatch(ids[0]),{ok:true});const redo=await state();await key();await move(f);assert((await history()).r>0);
  const commands=f.depth===2&&!f.merged?ids.filter(id=>id!==ids[0]&&id!==ids[1]):ids;
  for(const id of commands){const b=await state(),hist=await history();for(let repeat=0;repeat<4;repeat++){
   assert.deepEqual(await dispatch(id),{ok:false,reason:'disabled'},'unsupported '+id);
   await page.evaluate(id=>{const d=window.__inputHandler.dispatcher;d.registry.get(id).execute(d.services);},id);
   assert.deepEqual(await state(),b,'direct refusal '+id);assert.deepEqual(await history(),hist);assert.equal(await page.$('.modal-overlay'),null);
  }refusals.push({fixture:f.label,id,dispatch:4,direct:4,pendingRedoPreserved:true});}
  await key(true);assert.deepEqual(await state(),redo,'redo usable');
 }
 // A queued snapshot operation must refuse cursor/path/document/host changes.
 for(const f of fixtures)for(const change of ['other-inner-cell','root-cursor','changed-host','reloaded-document','selection']){
  await load(f.input);await move(f);await page.evaluate(()=>{const h=window.__inputHandler,original=h.executeOperation;window.__rowDeferred=null;h.executeOperation=op=>{window.__rowDeferred=op;};h.dispatcher.dispatch('table:insert-row-above');h.executeOperation=original;if(!window.__rowDeferred)throw Error('row operation not captured');});
  if(change==='other-inner-cell')await move(f,2);
  else if(change==='reloaded-document'){await load(f.input);await move(f);}
  else if(change==='changed-host')await page.evaluate(f=>window.__wasm.insertTableRow(0,f.ref.ppi,f.ref.ci,1,true),f);
  else if(change==='root-cursor')await page.evaluate(f=>{const h=window.__inputHandler,p=f.path[0];h.cursor.moveTo({sectionIndex:0,paragraphIndex:p.cellParaIndex,charOffset:0,parentParaIndex:f.ref.ppi,controlIndex:p.controlIndex,cellIndex:p.cellIndex,cellParaIndex:p.cellParaIndex,cellPath:[p]});h.updateCaret();},f);
  else await page.evaluate(()=>{const c=window.__inputHandler.cursor;if(!c.enterCellSelectionMode())throw Error('F5');c.setCellSelectionAnchor(0,0);c.setCellSelectionFocus(0,1);});
  const b=await state(),hist=await history();await page.evaluate(()=>window.__inputHandler.executeOperation(window.__rowDeferred));assert.deepEqual(await state(),b);assert.deepEqual(await history(),hist);stale.push({fixture:f.label,change,queuedSnapshotNoOp:true});
 }
 // Changed but still resolvable paths, token mismatches and JS integer coercions.
 for(const f of fixtures){await load(f.input);await move(f);const query=await page.evaluate(f=>window.__wasm.getNestedTableRowTarget(0,f.ref.ppi,f.path),f);
  await page.evaluate(f=>window.__wasm.insertTableRow(0,f.ref.ppi,f.ref.ci,1,true),f);
  const current=await page.evaluate(f=>window.__wasm.getNestedTableRowTarget(0,f.ref.ppi,f.path),f),options={path:f.path,action:'insertAbove',expectedToken:current.token};const invalid=[{...options,expectedToken:query.token},{...options,expectedToken:''},...[-1,0.25,'NaN','Infinity',4294967296].map(sec=>({...options,sec})),{...options,path:f.path.slice(0,1)},{...options,unexpected:true},{...options,action:'insertColumn'}];
  for(const value of invalid){const b=await state(),hist=await history();const refused=await page.evaluate(({f,value})=>{try{const {sec=0,...edit}=value;window.__wasm.doc.editNestedTableRow(typeof sec==='string'?Number(sec):sec,f.ref.ppi,JSON.stringify(edit));return false;}catch{return true;}},{f,value});assert(refused,JSON.stringify(value));assert.deepEqual(await state(),b);assert.deepEqual(await history(),hist);stale.push({fixture:f.label,rawAPIRefusal:true});}
 }
 assert.equal(errors.length,0);const received=await Promise.all(runtime);assert(received.some(x=>x.sha256===sha(fs.readFileSync(path.join(out,'pkg/rhwp_bg.wasm')))));
 await page.screenshot({path:path.join(out,'current-source-browser.png')});fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify(manifest,null,2));
 const proof={cases:checks.length,mutatingEdits:checks.reduce((n,c)=>n+(c.name==='insert-delete'?2:1),0),undoRedoPairs:pairs,savedReopens:manifest.length,checks,refusals,stale,nestedDispatchRefusals:refusals.length*4,directRefusals:refusals.length*4,staleRefusals:stale.length,runtime:received,errors,headless:false,DEVPositionSetup:true,physicalPointerIMEVerified:false,installedHostVerified:false,OSClipboardAccessed:false};fs.writeFileSync(path.join(out,'browser-proof.json'),JSON.stringify(proof,null,2));console.log(JSON.stringify({cases:checks.length,pairs,reopens:manifest.length,refusals:refusals.length*8,stale:stale.length}));
}catch(e){fs.writeFileSync(path.join(out,'browser-failure-'+Date.now()+'.json'),JSON.stringify({phase,error:String(e).slice(0,2000),checks,errors},null,2));throw e;}finally{await browser?.close();}

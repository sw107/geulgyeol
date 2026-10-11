// Narrow excluded lineWrap history successor; PR21 QA remains unchanged.
// input events, dialogs, history, native saves and file reopens use product paths.
import puppeteer from '../rhwp-studio/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {isDeepStrictEqual} from 'node:util';
import {spawn} from 'node:child_process';
import {launchPackaged} from './packaged-electron-qa.mjs';
import {createTableManifestWriter} from './write-electron-table-manifest.mjs';
import {EvidenceBudget} from './qa-evidence-budget.mjs';
import {selectPlannedOperations,plannedTableSaveFiles,assertPlannedFixtures} from './qa-table-save-plan.mjs';
const packaged=process.env.GEULGYEOL_QA_PACKAGED_APP;
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
const root=path.resolve(import.meta.dirname,'..'),q=path.resolve(process.argv[2]),engine=path.resolve(process.argv[3]),baseline=process.argv[4]==='baseline';
const M=await import(pathToFileURL(path.join(engine,'rhwp.js')));
const sha=b=>createHash('sha256').update(b).digest('hex'),gzipEvidence=process.env.GEULGYEOL_QA_GZIP_EVIDENCE!=='0';
let boundedStateWrites=0;
const write=(name,value)=>{if(name.endsWith('-state.json')&&process.env.GEULGYEOL_QA_MAX_STATE_FILES){const cap=Number(process.env.GEULGYEOL_QA_MAX_STATE_FILES);assert(Number.isSafeInteger(cap)&&cap>0);assert(++boundedStateWrites<=cap,'planned state evidence limit exceeded');}const json=JSON.stringify(name.endsWith('-state.json')||/-undo\d\.json$|-redo\d\.json$/.test(name)?compact(value):value,null,2),compressed=gzipEvidence&&!['control.json','proof.json','lifecycle.json','failure.json'].includes(name);const data=compressed?gzipSync(json):json;if(!failure)budget?.check({normalForecastBytes:Buffer.byteLength(data)});else assert(Buffer.byteLength(data)<=16384,'bounded failure metadata');fs.writeFileSync(path.join(q,name+(compressed?'.gz':'')),data);};
function compact(v){if(Array.isArray(v))return v.map(compact);if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,['hwp','hwpx'].includes(k)?{sha256:sha(Buffer.from(x)),bytes:x.length}:k==='svg'?x.map(s=>({sha256:sha(s),bytes:Buffer.byteLength(s)})):compact(x)]));return v;}
const control=value=>write('control.json',value),pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label){const end=Date.now()+65000;while(Date.now()<end){if(budgetFailure&&!label.startsWith('cleanup'))throw budgetFailure;if(await fn())return;await pause(50);}throw Error('Timeout '+label);}
let p,b,page,frame,failure,caseMeta,normalQuit=false,receivedEngineSHA256;const errors=[],rows=[];let budget,manifestWriter,budgetFailure;let pairs=0,reopens=0;const paintChecks=[];const mixedReferences=new Map();const fallbackComparisons=[];const repairScopes=[];
// A background/occluded Mac window can suspend RAF; readiness uses host state
// and completed synchronous engine SVG, with a bounded renderer timer.
const settle=async()=>{
 // The product completes deferred cell pagination asynchronously. Comparing a
 // transient frame with a save (which flushes it) is not a round-trip oracle.
 // Observe the real idle boundary; do not force a test-only engine flush.
 await until(()=>frame.evaluate(()=>!window.__inputHandler.hasDeferredPaginationPending()),'product pagination idle');
 await frame.evaluate(()=>new Promise(r=>{requestAnimationFrame(()=>requestAnimationFrame(r));setTimeout(r,250);}));
};
// Inspect the engine SVG inside the actual Electron renderer so glyph bounds
// use the shipped fonts. Clip visibility and raw ownership are checked separately.
const paintGeometry=()=>frame.evaluate(()=>{
 const w=window.__wasm,d=w.doc,target=JSON.parse(d.getControls()).find(t=>t.ctrlId==='tbl'&&t.list===0),def=JSON.parse(d.getPageDef(0)),px=96/7200,top=(def.marginTop+def.marginHeader)*px,bottom=(def.height-def.marginBottom-def.marginFooter)*px,out=[];
 for(let p=0;p<w.pageCount;p++){
  const holder=document.createElement('div');holder.style.cssText='position:absolute;left:-20000px;top:0;visibility:hidden;pointer-events:none';const svg=document.importNode(new DOMParser().parseFromString(w.renderPageSvg(p),'image/svg+xml').documentElement,true);holder.appendChild(svg);document.body.appendChild(holder);
  try{
   const clips=[...svg.querySelectorAll('clipPath rect')].map(r=>({id:r.parentElement.id,x:Number(r.getAttribute('x')),y:Number(r.getAttribute('y')),width:Number(r.getAttribute('width')),height:Number(r.getAttribute('height'))}));let maxInk=-Infinity,minInk=Infinity,maxBorder=-Infinity;const hidden=[],partial=[],inkOutside=[],borderOutside=[];let visibleText='';
   for(const t of svg.querySelectorAll('text')){
    if(t.closest('defs')||!t.textContent.trim())continue;const box=t.getBBox();let lo=box.y,hi=box.y+box.height;
    for(let a=t.parentElement;a&&a!==svg;a=a.parentElement){const id=a.getAttribute('clip-path')?.match(/url\(#([^)]*)\)/)?.[1];if(id){const c=clips.find(c=>c.id===id);if(!c)throw Error('Unknown clip '+id);lo=Math.max(lo,c.y);hi=Math.min(hi,c.y+c.height);}}
    const item={text:t.textContent,y:box.y,height:box.height,visibleHeight:Math.max(0,hi-lo)};
    if(hi<=lo)hidden.push(item);else{visibleText+=t.textContent;maxInk=Math.max(maxInk,hi);minInk=Math.min(minInk,lo);if(box.height-(hi-lo)>1)partial.push(item);if(hi>bottom+2||lo<top-2)inkOutside.push(item);}
   }
   for(const line of svg.querySelectorAll('line')){if(line.closest('defs'))continue;const hi=Math.max(Number(line.getAttribute('y1')),Number(line.getAttribute('y2')));maxBorder=Math.max(maxBorder,hi);if(hi>bottom+2)borderOutside.push({bottom:hi});}
   const runs=JSON.parse(d.getPageTextLayout(p)).runs,tables=JSON.parse(d.getPageControlLayout(p)).controls.filter(c=>c.type==='table'&&c.paraIdx===target.para&&c.controlIdx===target.controlIndex),host=runs.filter(r=>r.paraIdx===target.para&&!r.cellPath),following=runs.filter(r=>r.paraIdx>target.para&&!r.cellPath);out.push({page:p,top,bottom,minInk,maxInk,maxBorder,clips,hidden,partial,inkOutside,borderOutside,visibleText,tables:tables.map(t=>({x:t.x,y:t.y,w:t.w,h:t.h,cells:t.cells})),host,following});
  }finally{holder.remove();}
 }
 return out;
});
const excludedState=v=>Boolean(caseMeta?.fallbackExpected||(caseMeta?.expectedLeaveScope&&v.dims.rowCount>65));
async function verifyPaint(label,v){const geometry=await paintGeometry();write(label+'-paint.json',geometry);paintChecks.push({label,pages:geometry.length,maxBorderOverflow:Math.max(...geometry.map(p=>p.maxBorder-p.bottom)),maxInkOverflow:Math.max(...geometry.map(p=>p.maxInk-p.bottom)),hidden:geometry.flatMap(p=>p.hidden).length,partial:geometry.flatMap(p=>p.partial).length});
 if(baseline||excludedState(v))return;
 const lastTablePage=geometry.findLast(p=>p.tables.length),hosts=geometry.filter(p=>p.host.length);if(v.body[v.target.para].trim()&&v.props.vertRelTo==='Page'&&v.props.vertAlign==='Top'&&v.props.vertOffset===0&&!v.props.allowOverlap){assert(hosts.length,'trailing host preserved');assert(hosts.every(p=>p.page>=lastTablePage.page),'host after all table fragments');for(const p of hosts){for(const r of p.host)for(const t of p.tables)assert(r.y>=p.maxBorder-.2,'host below terminal painted border');for(const r of p.following)assert(r.y>=Math.max(...p.host.map(h=>h.y+h.h))-.2,'following body after host');}if(label.startsWith('budget-input.')&&label.endsWith('-initial'))assert(hosts[0].page>lastTablePage.page,'insufficient terminal budget moves first host line to a fresh page');}
 if(caseMeta?.declaredBeforePx!==undefined){
  if(hosts[0]?.page===lastTablePage.page){const actual=hosts[0].host[0].y-lastTablePage.maxBorder,expected=caseMeta.declaredBeforePx,outer=v.props.outerBottom*96/7200;assert(actual>=expected-.2&&actual<=expected+outer+.2,'paragraph before spacing once after frame: '+actual+' vs '+expected);}
  else if(caseMeta.missingHostLineSegments&&label.endsWith('-initial'))assert(Math.abs(hosts[0].host[0].y-hosts[0].top)<.2,'no saved leading spacing at fresh page top');
  for(const p of hosts.filter(p=>p.following.length)){const last=p.host.reduce((a,b)=>a.y>b.y?a:b),next=Math.min(...p.following.map(r=>r.y)),extra=last.h*(v.bodyFormats[v.target.para].props.lineSpacing/100-1),expected=last.h+extra+caseMeta.declaredAfterPx;assert(Math.abs(next-last.y-expected)<.3,'host line advance and paragraph after spacing exactly once: '+(next-last.y)+' vs '+expected);}
  if(caseMeta.label.endsWith('-fit')&&label.endsWith('-initial'))assert(hosts[0].page>lastTablePage.page,'before plus line does not fit terminal remainder');
 }
 for(const p of geometry){assert.deepEqual(p.borderOutside,[],'border within body page '+p.page);assert.deepEqual(p.inkOutside,[],'actual glyph ink within body page '+p.page);assert.deepEqual(p.hidden,[],'no text hidden by clip page '+p.page);assert.deepEqual(p.partial,[],'no glyph cut by clip page '+p.page);for(const c of p.clips)assert(c.y+c.height<=p.bottom+2,'clip within page body');}
 if(caseMeta?.assertNoEmptyTableFragment){
  const headers=new Set(v.cells.flatMap((c,i)=>c.info.row===0?[i]:[]));
  const tablePages=geometry.filter(p=>p.tables.length).map(p=>p.page);
  for(const p of tablePages)assert(v.cellRendered[p].some(r=>!headers.has(r.cell)&&r.text.trim()),'no header-only or empty terminal table fragment on page '+p);
  if(label.endsWith('-initial'))assert.equal(tablePages.length,caseMeta.expectedTablePages,'boundary table fragments, including repeated headers');
 }
 const visible={...v,rendered:geometry.map(p=>p.visibleText)};ownership(visible);
}
const history=()=>frame.evaluate(()=>({u:window.__inputHandler.history.undoStack.length,r:window.__inputHandler.history.redoStack.length,snapshotResources:[...window.__inputHandler.history.undoStack,...window.__inputHandler.history.redoStack].reduce((n,c)=>n+(c.snapshotResourceCount?.()||0),0)}));
const readState=()=>frame.evaluate(()=>{
 const w=window.__wasm,d=w.doc,t=JSON.parse(d.getControls()).find(t=>t.ctrlId==='tbl'&&t.list===0);w.exportHwp();const dims=w.getTableDimensions(0,t.para,t.controlIndex),cells=Array.from({length:dims.cellCount},(_,i)=>({info:w.getCellInfo(0,t.para,t.controlIndex,i),needsTextSnapshot:typeof d.mergedCellNeedsTextSnapshot==='function'?d.mergedCellNeedsTextSnapshot(0,t.para,t.controlIndex,i):null,props:w.getCellProperties(0,t.para,t.controlIndex,i),paras:Array.from({length:w.getCellParagraphCount(0,t.para,t.controlIndex,i)},(_,cp)=>({text:d.getTextInCell(0,t.para,t.controlIndex,i,cp,0,10000),props:w.getCellParaPropertiesAt(0,t.para,t.controlIndex,i,cp),runs:JSON.parse(d.getCellCharFormatRunsByPath(0,t.para,JSON.stringify([{controlIndex:t.controlIndex,cellIndex:i,cellParaIndex:cp}]),0,[...d.getTextInCell(0,t.para,t.controlIndex,i,cp,0,10000)].length))}))})),svg=Array.from({length:w.pageCount},(_,i)=>w.renderPageSvg(i));
 const cellRendered=Array.from({length:w.pageCount},(_,page)=>JSON.parse(d.getPageTextLayout(page)).runs.filter(r=>r.cellPath).map(r=>({cell:r.cellIdx,para:r.cellParaIdx,text:r.text})));
 const rendered=svg.map(s=>[...new DOMParser().parseFromString(s,'image/svg+xml').querySelectorAll('text')].map(t=>t.textContent).join(''));
 return {target:t,dims,needsTextSnapshot:typeof d.bodyTableHostNeedsTextSnapshot==='function'?d.bodyTableHostNeedsTextSnapshot(0,t.para):null,pageDef:JSON.parse(d.getPageDef(0)),props:w.getTableProperties(0,t.para,t.controlIndex),cells,body:Array.from({length:d.getParagraphCount(0)},(_,i)=>d.getTextRange(0,i,0,100000)),styles:JSON.parse(d.getStyleList()),bodyFormats:Array.from({length:d.getParagraphCount(0)},(_,i)=>({props:JSON.parse(d.getParaPropertiesAt(0,i)),runs:JSON.parse(d.getCharFormatRuns(0,i,0,[...d.getTextRange(0,i,0,100000)].length))})),text:d.getTextFileText(),svg,rendered,cellRendered,pageCount:w.pageCount,hwp:Array.from(w.exportHwp()),hwpx:Array.from(w.exportHwpx())};
});
const state=async()=>{const cap=Number(process.env.GEULGYEOL_QA_MAX_PAGES||0);if(cap){assert(Number.isSafeInteger(cap)&&cap>0);assert((await frame.evaluate(()=>window.__wasm.pageCount))<=cap,'planned page limit exceeded');}return readState();};
async function load(name){const generation=await frame.evaluate(()=>window.__wasm.documentGeneration);await frame.evaluate(()=>window.rhwpStudio.notifySaved());control({id:'open-'+name,openFile:name,choice:'discard'});await page.evaluate(()=>document.querySelector('#open').click());await until(()=>frame.evaluate(({name,generation})=>window.__wasm?.fileName===name&&window.__wasm.documentGeneration!==generation&&window.__inputHandler?.active&&!document.documentElement.classList.contains('rhwp-busy'),{name,generation}),'load '+name);await until(()=>page.evaluate(()=>!document.querySelector('#save').disabled),'host load settled');await settle();}
async function open(){await frame.evaluate(()=>{const h=window.__inputHandler,t=JSON.parse(window.__wasm.doc.getControls()).find(t=>t.ctrlId==='tbl'&&t.list===0);h.cursor.exitCellSelectionMode();h.cursor.exitCellMode?.();h.cursor.clearSelection();h.cursor.enterTableObjectSelectionDirect(0,t.para,t.controlIndex);h.renderTableObjectSelection();assertDispatch(h.dispatcher.dispatchWithResult('table:cell-props'));function assertDispatch(v){if(!v.ok)throw Error(JSON.stringify(v));}});await frame.waitForSelector('.tcp-dialog',{visible:true});}
async function close(confirm){await frame.evaluate(confirm=>{const d=document.querySelector('.tcp-dialog'),button=confirm?d.querySelector('.dialog-btn-primary'):[...d.querySelectorAll('.dialog-btn')].find(b=>b.textContent.trim()==='취소');button.click();},confirm);await frame.waitForSelector('.tcp-dialog',{hidden:true});await settle();}
async function edit(side,value){await frame.evaluate(({side,value})=>{const d=document.querySelector('.tcp-dialog');[...d.querySelectorAll('.dialog-tab')].find(b=>b.textContent.trim()==='여백/캡션').click();const input=[...d.querySelectorAll('.dialog-section-title')].find(t=>t.textContent.trim()==='바깥 여백').parentElement.querySelectorAll('input[type=number]')[side];input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));},{side,value});}
async function key(redo){await frame.evaluate(()=>window.__inputHandler.focus());await page.keyboard.down('Meta');if(redo)await page.keyboard.down('Shift');try{await page.keyboard.press('z');}finally{if(redo)await page.keyboard.up('Shift');await page.keyboard.up('Meta');}await settle();}
function roundTripEqual(actual,expected,label){if(!caseMeta?.fallbackExpected||caseMeta?.fallbackExactHistory)return assert.deepEqual(actual,expected,label);fallbackComparisons.push({fixture:caseMeta.name,label,equal:isDeepStrictEqual(actual,expected),actualSHA256:sha(JSON.stringify(actual)),expectedSHA256:sha(JSON.stringify(expected))});}
function comparable(v){const {hwp,hwpx,...rest}=v;return rest;}
async function saveAndReopen(label,expected){
 for(const ext of caseMeta?.sameFormatSaveReopen?[caseMeta.ext]:['hwp','hwpx']){
  const payload=await state(),name=label+'.'+ext;budget.check({normalForecastBytes:payload[ext].length});control({id:'save-'+name,file:name});await page.select('#format',ext);await page.evaluate(()=>document.querySelector('#save').click());await until(()=>fs.existsSync(path.join(q,'files',name)),'native save');await until(()=>page.evaluate(()=>!document.querySelector('#save').disabled),'save settled');
  const bytes=fs.readFileSync(path.join(q,'files',name));assert.equal(sha(bytes),sha(Buffer.from(payload[ext])),'native save current export');await load(name);const actual=await state();
  if(sha(actual.svg.join(''))!==sha(expected.svg.join('')))write(name+'-save-svg-diff.json',{beforeSvg:expected.svg,actualSvg:actual.svg,expectedPageDef:expected.pageDef,actualPageDef:actual.pageDef,expectedProps:expected.props,actualProps:actual.props});roundTripEqual(actual.svg,expected.svg,'complete saved SVG');roundTripEqual(actual.pageDef,expected.pageDef,'source page budget preserved');roundTripEqual(actual.body,expected.body);roundTripEqual(actual.bodyFormats,expected.bodyFormats,'body paragraph and character styles after reopen');roundTripEqual(actual.cells,expected.cells,'all cell formatting and character IDs after reopening');roundTripEqual(actual.styles,expected.styles);roundTripEqual(actual.pageCount,expected.pageCount);ownership(actual);await verifyPaint(name,actual);
  await manifestWriter.append({file:path.join(q,'files',name),svg:actual.svg,pageCount:actual.pageCount,pageDef:actual.pageDef,body:actual.body,bodyFormats:actual.bodyFormats,text:actual.text,cells:actual.cells,props:actual.props,styles:actual.styles});reopens++;
 }
}
function ownership(v){
 if(excludedState(v))return; // Excluded states are judged against the pinned baseline, not promoted to supported geometry.
 const headerRows=new Set(v.cells.filter(c=>c.props.isHeader).flatMap(c=>Array.from({length:c.info.rowSpan},(_,i)=>c.info.row+i)));let leadingRows=0;while(headerRows.has(leadingRows))leadingRows++;
 const repeats=c=>v.props.repeatHeader&&c.info.row<leadingRows;
 for(let i=0;i<v.cells.length;i++)for(let cp=0;cp<v.cells[i].paras.length;cp++){
  const perPage=v.cellRendered.map(runs=>runs.filter(r=>r.cell===i&&r.para===cp).map(r=>r.text).join('')),expected=v.cells[i].paras[cp].text.replace(/\s/g,'');
  if(repeats(v.cells[i])){for(const actual of perPage.filter(Boolean))assert.equal(actual.replace(/\s/g,''),expected,'complete repeated header '+i+':'+cp);}
  else assert.equal(perPage.join('').replace(/\s/g,''),expected,'ordered merged cell text across fragments '+i+':'+cp);
 }
 const count=t=>Object.fromEntries([...t.replace(/\s/g,'')].sort().reduce((entries,c)=>{const last=entries.at(-1);if(last?.[0]===c)last[1]++;else entries.push([c,1]);return entries;},[]));
 const header=v.cells.filter(repeats).flatMap(c=>c.paras.map(p=>p.text)).join('');
 let model=v.body.join('')+v.cells.flatMap(c=>c.paras.map(p=>p.text)).join('');
 const tablePages=v.cellRendered.filter(runs=>runs.length).length;model+=header.repeat(Math.max(0,tablePages-1));
 assert.deepEqual(count(v.rendered.join('')),count(model),'visible nonspace scalars exactly once except complete repeated header');
 const text=v.rendered.join('');for(const marker of['AFTER_TABLE_END'])if(v.body.some(t=>t.includes(marker)))assert.equal(text.split(marker).length-1,1,'following body owner');
}

async function mixedTextHistory(f,op,before,hist){
 let stages=[before];const steps=[
  {name:'text',run:()=>page.keyboard.sendCharacter('SEQ🙂')},
  {name:'shift-enter',run:async()=>{await page.keyboard.down('Shift');try{await page.keyboard.press('Enter');}finally{await page.keyboard.up('Shift');}}},
  {name:'delete',run:()=>page.keyboard.press('Delete')},
  {name:'backspace',run:()=>page.keyboard.press('Backspace')},
  {name:'enter',run:()=>page.keyboard.press('Enter')},
  {name:'after-enter-text',run:()=>page.keyboard.sendCharacter('TAIL🙂')},
 ];
 await selectCell(op.target.cell,op.target.para);
 const burst=op.name==='mixed-burst-history',observations=[];
 if(burst){
  const reference=mixedReferences.get(f.name);assert(reference,'settled reference sequence required');assert.deepEqual(comparable(before),comparable(reference[0]));
  for(const step of steps){await step.run();observations.push(await frame.evaluate(()=>({pending:window.__inputHandler.hasDeferredPaginationPending(),undo:window.__inputHandler.history.undoStack.length})));}
  await settle();const after=await state(),h=await history();assert.equal(h.u,hist.u+steps.length,'burst preserves separate mixed commands');assert(h.snapshotResources<=2*(h.u+h.r));write(f.name+'-mixed-burst-state.json',{after,history:h,observations});assert.deepEqual(comparable(after),comparable(reference.at(-1)),'burst equals settled mixed result');ownership(after);await verifyPaint(f.name+'-mixed-burst',after);stages=reference;
 }else{
  for(const [i,step]of steps.entries()){
   await step.run();await settle();const after=await state(),h=await history();assert.equal(h.u,hist.u+i+1,'one operation for mixed step '+step.name);assert(h.snapshotResources<=2*(h.u+h.r),'bounded snapshot resource ownership');write(f.name+'-mixed-step-'+i+'-state.json',{after,history:h,step:step.name});ownership(after);await verifyPaint(f.name+'-mixed-step-'+i,after);stages.push(after);
  }
  mixedReferences.set(f.name,stages);
 }
 for(let cycle=0;cycle<2;cycle++){
  for(let i=steps.length-1;i>=0;i--){await key(false);const actual=await state();write(f.name+'-mixed-undo-'+cycle+'-'+i+'-state.json',actual);assert.deepEqual(comparable(actual),comparable(stages[i]),'exact mixed undo '+i);}
  for(let i=1;i<stages.length;i++){await key(true);const actual=await state();write(f.name+'-mixed-redo-'+cycle+'-'+i+'-state.json',actual);assert.deepEqual(comparable(actual),comparable(stages[i]),'exact mixed redo '+i);pairs++;}
 }
 await saveAndReopen(f.label+'-'+f.ext+'-'+op.name,stages.at(-1));rows.push({label:f.label,ext:f.ext,operation:op.name,burst,observations,steps:steps.map(s=>s.name),historyPairs:steps.length*2,beforePages:before.pageCount,afterPages:stages.at(-1).pageCount,historyAfter:await history()});console.log('PASS '+f.name+' '+op.name);
}

// The owner is not the last reading-order cell: Tab is navigation only.
async function ownerTabNavigation(f,op,before,hist){
 const observe=()=>frame.evaluate(()=>({cursor:window.__inputHandler.cursor.getPosition(),dirty:window.rhwpStudio.automation.getContext().isDirty}));
 const start=await observe();assert.equal(start.dirty,false,'fresh source is clean');
 const control=await state();assert.deepEqual(comparable(control),comparable(before),'no-input control preserves full model/SVG');
 const queries=await frame.evaluate(()=>{const w=window.__wasm,p=window.__inputHandler.cursor.getPosition();return {direct:w.getTableCellBboxes(p.sectionIndex,p.parentParaIndex,p.controlIndex),byPath:w.getTableCellBboxesByPath(p.sectionIndex,p.parentParaIndex,JSON.stringify(p.cellPath))};});
 assert.deepEqual(before.cells[24].info,{row:8,col:0,rowSpan:32,colSpan:2});
 assert.deepEqual(before.cells[25].info,{row:8,col:2,rowSpan:1,colSpan:1});
 const order=before.cells.map((c,i)=>({i,...c.info})).sort((a,b)=>a.row-b.row||a.col-b.col).map(c=>c.i);
 assert.equal(order[order.indexOf(24)+1],25,'declared next reading-order cell');
 await page.keyboard.press('Tab');await settle();
 const after=await state(),end=await observe(),nextHistory=await history();
 write(f.name+'-'+op.name+'-state.json',{before,control,after,start,end,queries,historyBefore:hist,historyAfter:nextHistory});
 assert.deepEqual(after,before,'navigation preserves complete model, SVG and both exports');
 assert.deepEqual(nextHistory,hist,'navigation creates no history or snapshot resources');
 assert.equal(end.dirty,start.dirty,'navigation does not mark dirty');
 assert.equal(end.cursor.cellIndex,25);assert.equal(end.cursor.cellParaIndex,0);assert.equal(end.cursor.charOffset,0);
 assert.equal(end.cursor.parentParaIndex,start.cursor.parentParaIndex);assert.equal(end.cursor.controlIndex,start.cursor.controlIndex);
 assert.deepEqual(end.cursor.cellPath,[{controlIndex:start.cursor.controlIndex,cellIndex:25,cellParaIndex:0}]);
 rows.push({label:f.label,ext:f.ext,operation:op.name,fromCell:24,toCell:25,noChange:true,historyBefore:hist,historyAfter:nextHistory,dirtyBefore:start.dirty,dirtyAfter:end.dirty});
 console.log('PASS '+f.name+' '+op.name);
}

// Connect owner input/navigation/history to native save and product-only reopen.
async function ownerSaveReopen(f,op,source,hist){
 assert(f.sameFormatSaveReopen&&f.fallbackExactHistory&&f.repairExpected);
 const reopenedEdit=op.name==='owner-reopened-edit',inputText=reopenedEdit?'REOPEN_EDIT🙂':'SAVE_NAV🙂',snapshotIDs=new Set();
 if(reopenedEdit){assert.equal(sha(fs.readFileSync(f.files[f.ext])),f.priorSavedSHA256[f.ext]);assert.equal(sha(fs.readFileSync(path.join(q,'files',f.name))),f.priorSavedSHA256[f.ext]);assert(source.cells[24].paras[0].text.startsWith('SAVE_NAV🙂'),'PR34 saved edit is the new source');}
 const observe=()=>frame.evaluate(()=>{const h=window.__inputHandler,record=c=>({fields:JSON.stringify(c),resources:c.snapshotResourceCount?.()||0});return {cursor:h.cursor.getPosition(),dirty:window.rhwpStudio.automation.getContext().isDirty,fileName:window.__wasm.fileName,generation:window.__wasm.documentGeneration,entries:{undo:h.history.undoStack.map(record),redo:h.history.redoStack.map(record)}};});
 const stem=f.name+'-'+op.name+'-',sourceObservation=await observe();
 assert.equal(sourceObservation.dirty,false);assert.deepEqual(hist,{u:0,r:0,snapshotResources:0});assert.deepEqual(source.cells[24].info,{row:8,col:0,rowSpan:32,colSpan:2});
 assert.equal(source.props.repeatHeader,true);assert.deepEqual(source.cells.flatMap((c,i)=>c.props.isHeader?[i]:[]),[0,1,2]);assert(source.body.at(-1).includes('AFTER_TABLE_END'));
 await page.keyboard.sendCharacter(inputText);await settle();
 const edited=await state(),editObservation=await observe(),editHistory=await history();
 write(stem+'source-state.json',{source,edited,sourceObservation,editObservation,editHistory});
 assert.deepEqual(editHistory,{u:1,r:0,snapshotResources:1});assert.equal(editObservation.dirty,true);assert.equal(edited.cells[24].paras[0].text,inputText+source.cells[24].paras[0].text);
 assert.deepEqual(edited.cells[24].paras.slice(1),source.cells[24].paras.slice(1));assert.deepEqual(edited.cells.filter((_,i)=>i!==24),source.cells.filter((_,i)=>i!==24));
 for(const k of ['body','bodyFormats','props','pageDef','styles','dims'])assert.deepEqual(edited[k],source[k]);
 const ids=p=>p.runs.flatMap(r=>Array(r.endOffset-r.startOffset).fill(r.charShapeId));assert.deepEqual(ids(edited.cells[24].paras[0]).slice([...inputText].length),ids(source.cells[24].paras[0]));assert.deepEqual(edited.cells[24].paras[0].props,source.cells[24].paras[0].props);
 const retained=await frame.evaluateHandle(()=>window.__inputHandler.history.peekUndoTop());
 try{
  const lastPara=edited.cells[24].paras.length-1,lastOffset=[...edited.cells[24].paras[lastPara].text].length;assert.equal(lastPara,63);assert.equal(lastOffset,66);
  for(const step of [{name:'tab',shift:false,from:24,cell:25,para:0,offset:0},{name:'shift-tab',shift:true,from:25,cell:24,para:lastPara,offset:lastOffset}]){
   const start=await observe();assert.equal(start.cursor.cellIndex,step.from);
   if(step.shift)await page.keyboard.down('Shift');try{await page.keyboard.press('Tab');}finally{if(step.shift)await page.keyboard.up('Shift');}await settle();
   const after=await state(),observation=await observe(),now=await history(),sameCommand=await frame.evaluate(c=>window.__inputHandler.history.peekUndoTop()===c,retained);
   write(stem+step.name+'-state.json',{reference:edited,after,start,observation,referenceObservation:editObservation,historyBefore:editHistory,historyAfter:now,expected:{cell:step.cell,para:step.para,charOffset:step.offset},sameCommand});
   assert.deepEqual(after,edited,'navigation full SVG/model/both exports exact');assert.deepEqual(now,editHistory);assert.deepEqual(observation.entries,editObservation.entries);assert.equal(observation.dirty,true);assert(sameCommand);
   assert.equal(observation.cursor.cellIndex,step.cell);assert.equal(observation.cursor.cellParaIndex,step.para);assert.equal(observation.cursor.paragraphIndex,step.para);assert.equal(observation.cursor.charOffset,step.offset);assert.deepEqual(observation.cursor.cellPath,[{controlIndex:observation.cursor.controlIndex,cellIndex:step.cell,cellParaIndex:step.para}]);
  }
  const restore=async(redo,phase,reference,expectedHistory)=>{
   await key(redo);const after=await state(),observation=await observe(),now=await history(),sameCommand=await frame.evaluate(c=>[...window.__inputHandler.history.undoStack,...window.__inputHandler.history.redoStack].includes(c),retained);
   if(reopenedEdit){const fields=JSON.parse(observation.entries[redo?'undo':'redo'][0].fields);for(const id of [fields.beforeId,fields.afterId])if(id!==null){assert(Number.isInteger(id));snapshotIDs.add(id);}}
   write(stem+phase+'-state.json',{reference,after,observation,history:now,sameCommand});assert.deepEqual(comparable(after),comparable(reference),'history full SVG/model excluding container bytes');assert.deepEqual(now,expectedHistory);assert.equal(observation.dirty,true);assert(sameCommand);assert.deepEqual(observation.cursor,redo?editObservation.cursor:sourceObservation.cursor);return {after,observation,history:now};
  };
  await restore(false,'before-save-undo',source,{u:0,r:1,snapshotResources:2});await restore(true,'before-save-redo',edited,{u:1,r:0,snapshotResources:1});pairs++;
  const payload=await state(),beforeSave=await observe(),beforeSaveHistory=await history(),name=f.label+'-'+f.ext+'-'+op.name+'.'+f.ext;
  assert.notEqual(name,f.name,'second save never overwrites copied PR34 input');assert(!fs.existsSync(path.join(q,'files',name)),'fresh saved output required');
  budget.check({normalForecastBytes:payload[f.ext].length});control({id:'save-'+name,file:name});await page.select('#format',f.ext);await page.evaluate(()=>document.querySelector('#save').click());
  await until(()=>fs.existsSync(path.join(q,'files',name)),'native save integrated');await until(()=>frame.evaluate(()=>!window.rhwpStudio.automation.getContext().isDirty),'product save marks clean');await until(()=>page.evaluate(()=>!document.querySelector('#save').disabled),'product save settled');await settle();
  const bytes=fs.readFileSync(path.join(q,'files',name)),afterSave=await state(),savedObservation=await observe(),savedHistory=await history(),sameSavedCommand=await frame.evaluate(c=>window.__inputHandler.history.peekUndoTop()===c,retained),saveStatus=await page.evaluate(()=>({status:document.querySelector('#status').textContent,filename:document.querySelector('#filename').textContent}));
  write(stem+'saved-state.json',{reference:payload,after:afterSave,beforeSave,savedObservation,beforeSaveHistory,savedHistory,sameSavedCommand,saveStatus,savedFile:{name,bytes:bytes.length,sha256:sha(bytes)},expectedExportSHA256:sha(Buffer.from(payload[f.ext]))});
  assert.equal(sha(bytes),sha(Buffer.from(payload[f.ext])),'real native file current same-format export');assert.deepEqual(comparable(afterSave),comparable(edited));assert.equal(beforeSave.dirty,true);assert.equal(savedObservation.dirty,false);assert.equal(savedObservation.fileName,name);assert.equal(savedObservation.generation,beforeSave.generation);assert.deepEqual(savedObservation.cursor,beforeSave.cursor);assert.deepEqual(savedObservation.entries,beforeSave.entries);assert.deepEqual(savedHistory,beforeSaveHistory);assert(sameSavedCommand);assert(saveStatus.status.includes('저장 완료'));assert(!saveStatus.filename.includes('수정됨'));
  await restore(false,'after-save-undo',source,{u:0,r:1,snapshotResources:2});const final=await restore(true,'after-save-redo',edited,{u:1,r:0,snapshotResources:1});pairs++;
  // Never call load() here: it performs a QA notifySaved() that would mask policy.
  const generation=final.observation.generation,plan='reopen-'+name;control({id:plan,openFile:name,choice:'discard'});await page.evaluate(()=>document.querySelector('#open').click());
  await until(()=>frame.evaluate(({name,generation})=>window.__wasm.fileName===name&&window.__wasm.documentGeneration!==generation&&window.__inputHandler.active&&!document.documentElement.classList.contains('rhwp-busy'),{name,generation}),'product reopen integrated');await until(()=>page.evaluate(()=>!document.querySelector('#save').disabled),'product reopen settled');await settle();
  const reopened=await state(),reopenObservation=await observe(),reopenHistory=await history(),audit=fs.readFileSync(path.join(q,'audit.jsonl'),'utf8').trim().split('\n').map(line=>JSON.parse(line)),confirmations=audit.filter(r=>r.kind==='close-confirmation'&&r.plan===plan),reopenCommandRetained=await frame.evaluate(c=>[...window.__inputHandler.history.undoStack,...window.__inputHandler.history.redoStack].includes(c),retained);
  write(stem+'reopened-state.json',{reference:edited,after:reopened,beforeReopen:final.observation,reopenObservation,reopenHistory,confirmations,reopenCommandRetained,productOnlyOpen:true});
  assert.deepEqual(comparable(reopened),comparable(edited),'same-format reopen complete SVG/model including page/cell/formats');assert.equal(reopenObservation.dirty,false);assert.equal(reopenObservation.fileName,name);assert.notEqual(reopenObservation.generation,generation);assert.deepEqual(reopenHistory,{u:0,r:0,snapshotResources:0});assert(!reopenCommandRetained);assert.equal(confirmations.length,1,'actual unsaved transition confirmation after post-save history');assert(confirmations[0].options.buttons.some(s=>/저장.*않|저장 안/.test(s)));
  if(reopenedEdit){
   const oldIDs=[...snapshotIDs],discarded=await retained.evaluate(c=>({fields:JSON.stringify(c),resources:c.snapshotResourceCount?.()||0}));assert.equal(oldIDs.length,3);
   const released=JSON.parse(discarded.fields);assert.equal(discarded.resources,0);assert.equal(released.beforeId,null);assert.equal(released.afterId,null);
   const probes=await frame.evaluate(ids=>ids.map(id=>{try{window.__wasm.doc.restoreSnapshot(id);return {id,rejected:false};}catch(e){return {id,rejected:true,error:String(e)};}}),oldIDs);
   const afterProbe=await state(),probeObservation=await observe(),probeHistory=await history();
   write(stem+'stale-probe-state.json',{reference:reopened,after:afterProbe,referenceObservation:reopenObservation,probeObservation,reopenHistory,probeHistory,oldIDs,discarded,probes,oldGeneration:generation,newGeneration:reopenObservation.generation});
   assert(probes.every(v=>v.rejected&&v.error.includes('스냅샷')&&v.error.includes('없음')),'old generation snapshot IDs reject before mutation');assert.deepEqual(afterProbe,reopened);assert.deepEqual(probeObservation,reopenObservation);assert.deepEqual(probeHistory,reopenHistory);
   for(const redo of [false,true]){
    await key(redo);const after=await state(),observation=await observe(),now=await history();
    write(stem+(redo?'empty-redo':'empty-undo')+'-state.json',{reference:reopened,after,referenceObservation:reopenObservation,observation,historyBefore:reopenHistory,historyAfter:now});
    assert.deepEqual(after,reopened,'cleared history cannot restore previous generation');assert.deepEqual(observation,reopenObservation);assert.deepEqual(now,reopenHistory);
   }
   assert.equal(sha(fs.readFileSync(f.files[f.ext])),f.priorSavedSHA256[f.ext],'original PR34 saved copy preserved');assert.equal(sha(fs.readFileSync(path.join(q,'files',f.name))),f.priorSavedSHA256[f.ext]);
  }
  await verifyPaint(name,reopened);await manifestWriter.append({file:path.join(q,'files',name),svg:reopened.svg,pageCount:reopened.pageCount,pageDef:reopened.pageDef,body:reopened.body,bodyFormats:reopened.bodyFormats,text:reopened.text,cells:reopened.cells,props:reopened.props,styles:reopened.styles});reopens++;
  rows.push({label:f.label,ext:f.ext,operation:op.name,navigationTransitions:2,historyKeyCommands:reopenedEdit?6:4,undoRedoPairs:2,emptyHistoryNoops:reopenedEdit?2:0,staleSnapshotRejections:reopenedEdit?snapshotIDs.size:0,priorSavedSHA256:reopenedEdit?f.priorSavedSHA256[f.ext]:null,sameFormatReopens:1,savedDirty:false,savedHistoryRetained:true,postSaveUndoRedoDirty:true,reopenedDirty:false,reopenedHistoryCleared:true,productOnlyReopen:true,unsavedOpenConfirmations:1,lastPara,lastOffset,resourceSequence:[1,2,1,1,2,1,0]});console.log('PASS '+f.name+' '+op.name);
 }finally{await retained.dispose();}
}

// Two separate entries: history-only owner snapshot, then ordinary next-cell input.
async function ownerMultiHistory(f,op,source,hist){
 assert(f.sameFormatSaveReopen&&f.fallbackExactHistory&&f.repairExpected);
 assert.equal(sha(fs.readFileSync(f.files[f.ext])),f.priorSavedSHA256[f.ext]);assert(source.cells[24].paras[0].text.startsWith('REOPEN_EDIT🙂SAVE_NAV🙂'));
 const observe=()=>frame.evaluate(()=>{const h=window.__inputHandler,record=c=>({fields:JSON.stringify(c),resources:c.snapshotResourceCount?.()||0});return {cursor:h.cursor.getPosition(),dirty:window.rhwpStudio.automation.getContext().isDirty,fileName:window.__wasm.fileName,generation:window.__wasm.documentGeneration,entries:{undo:h.history.undoStack.map(record),redo:h.history.redoStack.map(record)}};});
 const stem=f.name+'-'+op.name+'-',sourceObservation=await observe();assert.equal(sourceObservation.dirty,false);assert.deepEqual(hist,{u:0,r:0,snapshotResources:0});
 assert.deepEqual(source.cells[24].info,{row:8,col:0,rowSpan:32,colSpan:2});assert.deepEqual(source.cells[25].info,{row:8,col:2,rowSpan:1,colSpan:1});
 const predicates=await frame.evaluate(()=>{const w=window.__wasm,t=JSON.parse(w.doc.getControls()).find(t=>t.ctrlId==='tbl'&&t.list===0);return [24,25].map(cell=>({cell,guarded:w.mergedCellNeedsTextSnapshot(0,t.para,t.controlIndex,cell),excluded:w.excludedLineWrapCellNeedsTextSnapshot(0,t.para,t.controlIndex,cell)}));});assert.deepEqual(predicates,[{cell:24,guarded:false,excluded:true},{cell:25,guarded:false,excluded:false}]);
 const validateInput=(before,after,cell,text)=>{assert.equal(after.cells[cell].paras[0].text,text+before.cells[cell].paras[0].text);assert.deepEqual(after.cells[cell].paras.slice(1),before.cells[cell].paras.slice(1));assert.deepEqual(after.cells.filter((_,i)=>i!==cell),before.cells.filter((_,i)=>i!==cell));for(const k of ['body','bodyFormats','props','pageDef','styles','dims'])assert.deepEqual(after[k],before[k]);assert.deepEqual(after.cells.map(c=>c.info),before.cells.map(c=>c.info));assert.deepEqual(after.cells.map(c=>c.props),before.cells.map(c=>c.props));const ids=p=>p.runs.flatMap(r=>Array(r.endOffset-r.startOffset).fill(r.charShapeId));assert.deepEqual(ids(after.cells[cell].paras[0]).slice([...text].length),ids(before.cells[cell].paras[0]));assert.deepEqual(after.cells[cell].paras[0].props,before.cells[cell].paras[0].props);};
 await page.keyboard.sendCharacter('M24🙂');await settle();const owner=await state(),ownerObservation=await observe(),ownerHistory=await history();
 write(stem+'owner-input-state.json',{source,owner,sourceObservation,ownerObservation,ownerHistory,predicates});validateInput(source,owner,24,'M24🙂');assert.deepEqual(ownerHistory,{u:1,r:0,snapshotResources:1});assert.equal(JSON.parse(ownerObservation.entries.undo[0].fields).type,'snapshot:insertText');
 const ownerHandle=await frame.evaluateHandle(()=>window.__inputHandler.history.peekUndoTop());let ordinaryHandle;
 try{
  await page.keyboard.press('Tab');await settle();const afterTab=await state(),tabObservation=await observe(),tabHistory=await history();
  write(stem+'tab-state.json',{reference:owner,after:afterTab,ownerObservation,tabObservation,ownerHistory,tabHistory});assert.deepEqual(afterTab,owner);assert.deepEqual(tabHistory,ownerHistory);assert.deepEqual(tabObservation.entries,ownerObservation.entries);assert.equal(tabObservation.cursor.cellIndex,25);assert.equal(tabObservation.cursor.cellParaIndex,0);assert.equal(tabObservation.cursor.charOffset,0);
  await page.keyboard.sendCharacter('M25🙂');await settle();const both=await state(),bothObservation=await observe(),bothHistory=await history();
  write(stem+'ordinary-input-state.json',{reference:owner,both,tabObservation,bothObservation,bothHistory});validateInput(owner,both,25,'M25🙂');assert.deepEqual(bothHistory,{u:2,r:0,snapshotResources:1});
  const snapshot=JSON.parse(bothObservation.entries.undo[0].fields),ordinary=JSON.parse(bothObservation.entries.undo[1].fields);assert.equal(snapshot.type,'snapshot:insertText');assert.equal(ordinary.type,'insertText');assert.equal(ordinary.position.cellIndex,25);assert.equal(ordinary.text,'M25🙂');assert.equal(bothObservation.entries.undo[1].resources,0);assert(!('beforeId' in ordinary)&&!('afterId' in ordinary));
  ordinaryHandle=await frame.evaluateHandle(()=>window.__inputHandler.history.peekUndoTop());
  const identity=()=>frame.evaluate((a,b)=>{const h=window.__inputHandler,name=c=>c===a?'owner':c===b?'ordinary':'unexpected';return {undo:h.history.undoStack.map(name),redo:h.history.redoStack.map(name)};},ownerHandle,ordinaryHandle);
  assert.deepEqual(await identity(),{undo:['owner','ordinary'],redo:[]},'two actual distinct command objects');
  await page.keyboard.down('Shift');try{await page.keyboard.press('Tab');}finally{await page.keyboard.up('Shift');}await settle();const afterReverse=await state(),reverseObservation=await observe(),reverseHistory=await history();
  write(stem+'shift-tab-state.json',{reference:both,after:afterReverse,bothObservation,reverseObservation,bothHistory,reverseHistory,identity:await identity()});assert.deepEqual(afterReverse,both);assert.deepEqual(reverseHistory,bothHistory);assert.deepEqual(reverseObservation.entries,bothObservation.entries);assert.equal(reverseObservation.cursor.cellIndex,24);assert.equal(reverseObservation.cursor.cellParaIndex,63);assert.equal(reverseObservation.cursor.charOffset,66);
  const stages=[{name:'undo-ordinary',redo:false,reference:owner,cursor:tabObservation.cursor,expected:{u:1,r:1,snapshotResources:1},order:{undo:['owner'],redo:['ordinary']}},{name:'undo-owner',redo:false,reference:source,cursor:sourceObservation.cursor,expected:{u:0,r:2,snapshotResources:2},order:{undo:[],redo:['ordinary','owner']}},{name:'redo-owner',redo:true,reference:owner,cursor:ownerObservation.cursor,expected:{u:1,r:1,snapshotResources:1},order:{undo:['owner'],redo:['ordinary']}},{name:'redo-ordinary',redo:true,reference:both,cursor:bothObservation.cursor,expected:{u:2,r:0,snapshotResources:1},order:{undo:['owner','ordinary'],redo:[]}}];
  const resources=[ownerHistory.snapshotResources,bothHistory.snapshotResources];
  for(const stage of stages){
   await key(stage.redo);const after=await state(),observation=await observe(),now=await history(),order=await identity();
   write(stem+stage.name+'-state.json',{reference:stage.reference,after,observation,history:now,identity:order,expectedHistory:stage.expected,expectedCursor:stage.cursor});
   assert.deepEqual(comparable(after),comparable(stage.reference),'two-entry history exact full SVG/model '+stage.name);assert.deepEqual(now,stage.expected);assert.deepEqual(observation.cursor,stage.cursor);assert.deepEqual(order,stage.order);assert.equal(observation.dirty,true);assert(now.snapshotResources<=4);resources.push(now.snapshotResources);
  }
  pairs+=2;
  const payload=await state(),beforeSave=await observe(),name=f.label+'-'+f.ext+'-'+op.name+'.'+f.ext;assert.notEqual(name,f.name);assert(!fs.existsSync(path.join(q,'files',name)));budget.check({normalForecastBytes:payload[f.ext].length});
  control({id:'save-'+name,file:name});await page.select('#format',f.ext);await page.evaluate(()=>document.querySelector('#save').click());await until(()=>fs.existsSync(path.join(q,'files',name)),'native multi-history save');await until(()=>frame.evaluate(()=>!window.rhwpStudio.automation.getContext().isDirty),'multi-history save clean');await until(()=>page.evaluate(()=>!document.querySelector('#save').disabled),'multi-history save settled');await settle();
  const bytes=fs.readFileSync(path.join(q,'files',name)),saved=await state(),savedObservation=await observe(),savedHistory=await history(),savedOrder=await identity();
  write(stem+'saved-state.json',{reference:payload,after:saved,beforeSave,savedObservation,savedHistory,identity:savedOrder,savedFile:{name,bytes:bytes.length,sha256:sha(bytes)},expectedExportSHA256:sha(Buffer.from(payload[f.ext]))});assert.equal(sha(bytes),sha(Buffer.from(payload[f.ext])));assert.deepEqual(comparable(saved),comparable(both));assert.equal(savedObservation.dirty,false);assert.deepEqual(savedObservation.entries,beforeSave.entries);assert.deepEqual(savedObservation.cursor,beforeSave.cursor);assert.equal(savedObservation.generation,beforeSave.generation);assert.deepEqual(savedHistory,bothHistory);assert.deepEqual(savedOrder,{undo:['owner','ordinary'],redo:[]});
  // Product-only open, without the QA load()/notifySaved() preparation.
  const generation=savedObservation.generation,plan='reopen-'+name;control({id:plan,openFile:name,choice:'discard'});await page.evaluate(()=>document.querySelector('#open').click());await until(()=>frame.evaluate(({name,generation})=>window.__wasm.fileName===name&&window.__wasm.documentGeneration!==generation&&window.__inputHandler.active&&!document.documentElement.classList.contains('rhwp-busy'),{name,generation}),'native multi-history reopen');await until(()=>page.evaluate(()=>!document.querySelector('#save').disabled),'multi-history reopen settled');await settle();
  const reopened=await state(),reopenObservation=await observe(),reopenHistory=await history(),reopenOrder=await identity(),releasedOwner=await ownerHandle.evaluate(c=>({fields:JSON.stringify(c),resources:c.snapshotResourceCount?.()||0})),releasedOrdinary=await ordinaryHandle.evaluate(c=>({fields:JSON.stringify(c),resources:c.snapshotResourceCount?.()||0}));
  write(stem+'reopened-state.json',{reference:both,after:reopened,reopenObservation,reopenHistory,identity:reopenOrder,releasedOwner,releasedOrdinary,previousGeneration:generation,productOnlyOpen:true});assert.deepEqual(comparable(reopened),comparable(both));assert.equal(reopenObservation.dirty,false);assert.notEqual(reopenObservation.generation,generation);assert.deepEqual(reopenHistory,{u:0,r:0,snapshotResources:0});assert.deepEqual(reopenOrder,{undo:[],redo:[]});assert.equal(releasedOwner.resources,0);const released=JSON.parse(releasedOwner.fields);assert.equal(released.beforeId,null);assert.equal(released.afterId,null);assert.equal(releasedOrdinary.resources,0);
  assert.equal(sha(fs.readFileSync(f.files[f.ext])),f.priorSavedSHA256[f.ext]);assert.equal(sha(fs.readFileSync(path.join(q,'files',f.name))),f.priorSavedSHA256[f.ext]);await verifyPaint(name,reopened);await manifestWriter.append({file:path.join(q,'files',name),svg:reopened.svg,pageCount:reopened.pageCount,pageDef:reopened.pageDef,body:reopened.body,bodyFormats:reopened.bodyFormats,text:reopened.text,cells:reopened.cells,props:reopened.props,styles:reopened.styles});reopens++;
  rows.push({label:f.label,ext:f.ext,operation:op.name,entries:2,entryTypes:['snapshot:insertText','insertText'],navigationTransitions:2,historyKeyCommands:4,undoRedoPairs:2,resourceSequence:resources,maxResources:Math.max(...resources),sameFormatReopens:1,sourceSHA256:f.priorSavedSHA256[f.ext],productOnlyReopen:true});console.log('PASS '+f.name+' '+op.name);
 }finally{await ordinaryHandle?.dispose();await ownerHandle.dispose();}
}

// Reverse navigation must reach the owner's last Unicode scalar position.
async function ownerReverseNavigation(f,op,source,hist){
 const observe=()=>frame.evaluate(()=>{const h=window.__inputHandler,record=c=>{const fields=JSON.stringify(c);if(fields.length>16384)throw Error('bounded history entry required');return {className:c.constructor.name,fields,resources:c.snapshotResourceCount?.()||0};};return {cursor:h.cursor.getPosition(),dirty:window.rhwpStudio.automation.getContext().isDirty,entries:{undo:h.history.undoStack.map(record),redo:h.history.redoStack.map(record)}};});
 const edited=op.name==='owner-edited-navigation',start=await observe();
 assert.equal(start.dirty,false);assert.deepEqual(hist,{u:0,r:0,snapshotResources:0});
 assert.deepEqual(source.cells[24].info,{row:8,col:0,rowSpan:32,colSpan:2});
 const lastPara=source.cells[24].paras.length-1,lastOffset=[...source.cells[24].paras[lastPara].text].length;
 assert.equal(lastPara,63);assert.equal(lastOffset,66);
 let reference=source,expectedHistory=hist,expectedObservation=start;
 if(edited){
  await page.keyboard.sendCharacter('NAV_EDIT🙂');await settle();reference=await state();expectedHistory=await history();expectedObservation=await observe();
  assert.deepEqual(expectedHistory,{u:1,r:0,snapshotResources:1});assert.equal(expectedObservation.dirty,true);
  assert.equal(reference.cells[24].paras[0].text,'NAV_EDIT🙂'+source.cells[24].paras[0].text);
  assert.deepEqual(reference.body,source.body);assert.deepEqual(reference.bodyFormats,source.bodyFormats);assert.deepEqual(reference.props,source.props);assert.deepEqual(reference.pageDef,source.pageDef);assert.deepEqual(reference.styles,source.styles);
  for(let i=0;i<source.cells.length;i++)if(i!==24)assert.deepEqual(reference.cells[i],source.cells[i]);
  write(f.name+'-'+op.name+'-edited-state.json',{source,reference,observation:expectedObservation,history:expectedHistory});
 }
 const steps=edited?[{name:'tab',shift:false,cell:25,para:0,offset:0},{name:'shift-tab',shift:true,cell:24,para:lastPara,offset:lastOffset}]:[{name:'shift-tab',shift:true,cell:24,para:lastPara,offset:lastOffset}];
 for(const step of steps){
  const navigationStart=await observe();assert.equal(navigationStart.cursor.cellIndex,step.shift?25:24,'actual source cell before key');
  if(step.shift)await page.keyboard.down('Shift');try{await page.keyboard.press('Tab');}finally{if(step.shift)await page.keyboard.up('Shift');}await settle();
  const after=await state(),end=await observe(),now=await history();
  write(f.name+'-'+op.name+'-'+step.name+'-state.json',{reference,after,start:expectedObservation,navigationStart,end,historyBefore:expectedHistory,historyAfter:now,expected:{cell:step.cell,para:step.para,charOffset:step.offset}});
  assert.deepEqual(after,reference,'navigation preserves full model/SVG and both export bytes');assert.deepEqual(now,expectedHistory,'history counts and snapshot resources unchanged');assert.deepEqual(end.entries,expectedObservation.entries,'retained command fields and snapshot IDs unchanged');assert.equal(end.dirty,expectedObservation.dirty);
  assert.equal(end.cursor.cellIndex,step.cell);assert.equal(end.cursor.cellParaIndex,step.para);assert.equal(end.cursor.paragraphIndex,step.para);assert.equal(end.cursor.charOffset,step.offset);assert.equal(end.cursor.parentParaIndex,expectedObservation.cursor.parentParaIndex);assert.equal(end.cursor.controlIndex,expectedObservation.cursor.controlIndex);assert.deepEqual(end.cursor.cellPath,[{controlIndex:end.cursor.controlIndex,cellIndex:step.cell,cellParaIndex:step.para}]);
 }
 rows.push({label:f.label,ext:f.ext,operation:op.name,edited,steps:steps.map(s=>s.name),lastPara,lastOffset,historyBeforeNavigation:expectedHistory,dirtyBeforeNavigation:expectedObservation.dirty,noChangeDuringNavigation:true});console.log('PASS '+f.name+' '+op.name);
}

// A single retained redo entry must survive navigation and still execute.
async function ownerRedoNavigation(f,op,source,hist){
 const observe=()=>frame.evaluate(()=>{const h=window.__inputHandler,record=c=>{const fields=JSON.stringify(c);if(fields.length>16384)throw Error('bounded history entry required');return {fields,resources:c.snapshotResourceCount?.()||0};};return {cursor:h.cursor.getPosition(),dirty:window.rhwpStudio.automation.getContext().isDirty,entries:{undo:h.history.undoStack.map(record),redo:h.history.redoStack.map(record)}};});
 const sourceObservation=await observe();assert.equal(sourceObservation.dirty,false);assert.deepEqual(hist,{u:0,r:0,snapshotResources:0});
 await page.keyboard.sendCharacter('REDO_NAV🙂');await settle();
 const edited=await state(),editObservation=await observe(),editHistory=await history();
 write(f.name+'-'+op.name+'-source-state.json',{source,edited,sourceObservation,editObservation,editHistory});
 assert.deepEqual(editHistory,{u:1,r:0,snapshotResources:1});assert.equal(editObservation.dirty,true);assert.equal(edited.cells[24].paras[0].text,'REDO_NAV🙂'+source.cells[24].paras[0].text);
 await key(false);const undone=await state(),undoObservation=await observe(),undoHistory=await history();
 write(f.name+'-'+op.name+'-initial-undo-state.json',{reference:source,after:undone,observation:undoObservation,history:undoHistory});
 assert.deepEqual(comparable(undone),comparable(source),'initial undo restores original complete SVG/model');assert.deepEqual(undoHistory,{u:0,r:1,snapshotResources:2});
 const entry=JSON.parse(undoObservation.entries.redo[0].fields);assert.equal(entry.type,'snapshot:insertText');assert.notEqual(entry.beforeId,null);assert.notEqual(entry.afterId,null);
 const lastPara=undone.cells[24].paras.length-1,lastOffset=[...undone.cells[24].paras[lastPara].text].length;assert.equal(lastPara,63);assert.equal(lastOffset,66);
 const steps=[{name:'tab',shift:false,from:24,cell:25,para:0,offset:0},{name:'shift-tab',shift:true,from:25,cell:24,para:lastPara,offset:lastOffset}];
 for(const step of steps){
  const navigationStart=await observe();assert.equal(navigationStart.cursor.cellIndex,step.from);
  if(step.shift)await page.keyboard.down('Shift');try{await page.keyboard.press('Tab');}finally{if(step.shift)await page.keyboard.up('Shift');}await settle();
  const after=await state(),end=await observe(),now=await history();
  write(f.name+'-'+op.name+'-'+step.name+'-state.json',{reference:undone,after,navigationStart,end,referenceObservation:undoObservation,historyBefore:undoHistory,historyAfter:now,expected:{cell:step.cell,para:step.para,charOffset:step.offset}});
  assert.deepEqual(after,undone,'navigation preserves full model/SVG and both export bytes');assert.deepEqual(now,undoHistory);assert.deepEqual(navigationStart.entries,undoObservation.entries);assert.deepEqual(end.entries,undoObservation.entries,'retained redo command and both snapshot IDs unchanged');assert.equal(navigationStart.dirty,undoObservation.dirty);assert.equal(end.dirty,undoObservation.dirty);
  assert.equal(end.cursor.cellIndex,step.cell);assert.equal(end.cursor.paragraphIndex,step.para);assert.equal(end.cursor.cellParaIndex,step.para);assert.equal(end.cursor.charOffset,step.offset);assert.deepEqual(end.cursor.cellPath,[{controlIndex:end.cursor.controlIndex,cellIndex:step.cell,cellParaIndex:step.para}]);
 }
 await key(true);const redone=await state(),redoObservation=await observe(),redoHistory=await history();
 write(f.name+'-'+op.name+'-redo-state.json',{reference:edited,after:redone,observation:redoObservation,history:redoHistory});
 assert.deepEqual(comparable(redone),comparable(edited),'real redo after navigation restores prior edited complete SVG/model');assert.deepEqual(redoHistory,{u:1,r:0,snapshotResources:1});
 const redoEntry=JSON.parse(redoObservation.entries.undo[0].fields);assert.equal(redoEntry.beforeId,entry.beforeId);assert.equal(redoEntry.afterId,null,'redo releases after snapshot');assert.deepEqual(redoObservation.cursor,editObservation.cursor);
 await key(false);const undoneAgain=await state(),undoAgainObservation=await observe(),undoAgainHistory=await history();
 write(f.name+'-'+op.name+'-undo-state.json',{reference:source,after:undoneAgain,observation:undoAgainObservation,history:undoAgainHistory});
 assert.deepEqual(comparable(undoneAgain),comparable(source),'real undo after redo restores original complete SVG/model');assert.deepEqual(undoAgainHistory,{u:0,r:1,snapshotResources:2});assert.deepEqual(undoAgainObservation.cursor,sourceObservation.cursor);
 const nextEntry=JSON.parse(undoAgainObservation.entries.redo[0].fields);assert.equal(nextEntry.beforeId,entry.beforeId);assert.notEqual(nextEntry.afterId,null);assert.equal(nextEntry.timestamp,entry.timestamp);pairs++;
 rows.push({label:f.label,ext:f.ext,operation:op.name,steps:steps.map(s=>s.name),lastPara,lastOffset,initialUndoExact:true,redoAfterNavigationExact:true,undoAfterRedoExact:true,navigationDirty:undoObservation.dirty,resourceSequence:[editHistory.snapshotResources,undoHistory.snapshotResources,redoHistory.snapshotResources,undoAgainHistory.snapshotResources]});console.log('PASS '+f.name+' '+op.name);
}

// Opening and cancelling cell properties must retain a single redo entry.
async function ownerRedoDialogCancel(f,op,source,hist){
 const observe=()=>frame.evaluate(()=>{const h=window.__inputHandler,record=c=>{const fields=JSON.stringify(c);if(fields.length>16384)throw Error('bounded history entry required');return {fields,resources:c.snapshotResourceCount?.()||0};};return {cursor:h.cursor.getPosition(),dirty:window.rhwpStudio.automation.getContext().isDirty,entries:{undo:h.history.undoStack.map(record),redo:h.history.redoStack.map(record)}};});
 const sourceObservation=await observe();assert.equal(sourceObservation.dirty,false);assert.deepEqual(hist,{u:0,r:0,snapshotResources:0});
 await page.keyboard.sendCharacter('REDO_CANCEL🙂');await settle();
 const edited=await state(),editObservation=await observe(),editHistory=await history();
 write(f.name+'-'+op.name+'-source-state.json',{source,edited,sourceObservation,editObservation,editHistory});
 assert.deepEqual(editHistory,{u:1,r:0,snapshotResources:1});assert.equal(editObservation.dirty,true);assert.equal(edited.cells[24].paras[0].text,'REDO_CANCEL🙂'+source.cells[24].paras[0].text);
 await key(false);const undone=await state(),undoObservation=await observe(),undoHistory=await history();
 write(f.name+'-'+op.name+'-initial-undo-state.json',{reference:source,after:undone,observation:undoObservation,history:undoHistory});
 assert.deepEqual(comparable(undone),comparable(source),'initial undo restores original complete SVG/model');assert.deepEqual(undoHistory,{u:0,r:1,snapshotResources:2});
 const entry=JSON.parse(undoObservation.entries.redo[0].fields);assert.equal(entry.type,'snapshot:insertText');assert.notEqual(entry.beforeId,null);assert.notEqual(entry.afterId,null);
 const retained=await frame.evaluateHandle(()=>window.__inputHandler.history.peekRedoTop());
 try{
  const identity=()=>frame.evaluate(command=>window.__inputHandler.history.peekRedoTop()===command,retained);
  const dialogMeta=()=>frame.evaluate(()=>{const d=document.querySelector('.tcp-dialog');return {tabs:[...d.querySelectorAll('.dialog-tab')].map(t=>t.textContent.trim()),inputs:[...d.querySelectorAll('input,select')].map(e=>({tag:e.tagName,type:e.type,value:e.value,checked:e.checked??null})),cancelButtons:[...d.querySelectorAll('.dialog-footer .dialog-btn')].filter(b=>b.textContent.trim()==='취소').length};});
  await frame.evaluate(()=>{const h=window.__inputHandler,p=h.cursor.getPosition();if(h.isInTableObjectSelection()||p.cellIndex!==24)throw Error('owner 24 cell-mode cursor required');const result=h.dispatcher.dispatchWithResult('table:cell-props');if(!result.ok)throw Error(JSON.stringify(result));});
  await frame.waitForSelector('.tcp-dialog',{visible:true});await settle();
  const opened=await state(),openObservation=await observe(),openHistory=await history(),openDialog=await dialogMeta(),openIdentity=await identity();
  write(f.name+'-'+op.name+'-dialog-open-state.json',{reference:undone,after:opened,referenceObservation:undoObservation,observation:openObservation,historyBefore:undoHistory,historyAfter:openHistory,dialog:openDialog,retainedRedoIdentity:openIdentity});
  assert.deepEqual(opened,undone,'opening cell dialog preserves full model/SVG and both export bytes');assert.deepEqual(openObservation,undoObservation);assert.deepEqual(openHistory,undoHistory);assert(openIdentity,'same redo command retained during dialog');assert.deepEqual(openDialog.tabs,['기본','여백/캡션','표','셀'],'cell-mode dialog only');assert.equal(openDialog.cancelButtons,1);
  await frame.click('.tcp-dialog .dialog-footer .dialog-btn:not(.dialog-btn-primary)');
  await frame.waitForSelector('.tcp-dialog',{hidden:true});await settle();
  const cancelled=await state(),cancelObservation=await observe(),cancelHistory=await history(),cancelIdentity=await identity();
  write(f.name+'-'+op.name+'-dialog-cancel-state.json',{reference:undone,after:cancelled,referenceObservation:undoObservation,observation:cancelObservation,historyBefore:undoHistory,historyAfter:cancelHistory,retainedRedoIdentity:cancelIdentity,dialogHidden:true});
  assert.deepEqual(cancelled,undone,'cancel preserves full model/SVG and both export bytes');assert.deepEqual(cancelObservation,undoObservation,'cancel preserves cursor/dirty/command fields and snapshot IDs');assert.deepEqual(cancelHistory,undoHistory);assert(cancelIdentity,'same redo command retained after cancel');
 }finally{await retained.dispose();}
 await key(true);const redone=await state(),redoObservation=await observe(),redoHistory=await history();
 write(f.name+'-'+op.name+'-redo-state.json',{reference:edited,after:redone,observation:redoObservation,history:redoHistory});
 assert.deepEqual(comparable(redone),comparable(edited),'real redo after cell dialog cancel restores prior edited complete SVG/model');assert.deepEqual(redoHistory,{u:1,r:0,snapshotResources:1});
 const redoEntry=JSON.parse(redoObservation.entries.undo[0].fields);assert.equal(redoEntry.beforeId,entry.beforeId);assert.equal(redoEntry.afterId,null,'redo releases after snapshot');assert.deepEqual(redoObservation.cursor,editObservation.cursor);
 await key(false);const undoneAgain=await state(),undoAgainObservation=await observe(),undoAgainHistory=await history();
 write(f.name+'-'+op.name+'-undo-state.json',{reference:source,after:undoneAgain,observation:undoAgainObservation,history:undoAgainHistory});
 assert.deepEqual(comparable(undoneAgain),comparable(source),'real undo after redo restores original complete SVG/model');assert.deepEqual(undoAgainHistory,{u:0,r:1,snapshotResources:2});assert.deepEqual(undoAgainObservation.cursor,sourceObservation.cursor);
 const nextEntry=JSON.parse(undoAgainObservation.entries.redo[0].fields);assert.equal(nextEntry.beforeId,entry.beforeId);assert.notEqual(nextEntry.afterId,null);assert.equal(nextEntry.timestamp,entry.timestamp);pairs++;
 rows.push({label:f.label,ext:f.ext,operation:op.name,dialogTransitions:['open','cancel'],retainedRedoIdentityChecks:2,initialUndoExact:true,redoAfterCancelExact:true,undoAfterRedoExact:true,cancelDirty:undoObservation.dirty,resourceSequence:[editHistory.snapshotResources,undoHistory.snapshotResources,redoHistory.snapshotResources,undoAgainHistory.snapshotResources]});console.log('PASS '+f.name+' '+op.name);
}

// Observe product focus restoration and real keyboard delivery without QA focus.
async function ownerDialogFocus(f,op,source,hist){
 const route=op.name==='owner-dialog-escape-focus'?'escape':'cancel';
 const observe=()=>frame.evaluate(()=>{const h=window.__inputHandler,record=c=>{const fields=JSON.stringify(c);if(fields.length>16384)throw Error('bounded history entry required');return {fields,resources:c.snapshotResourceCount?.()||0};};return {cursor:h.cursor.getPosition(),dirty:window.rhwpStudio.automation.getContext().isDirty,entries:{undo:h.history.undoStack.map(record),redo:h.history.redoStack.map(record)}};});
 const focus=async()=>({renderer:await frame.evaluate(()=>{const h=window.__inputHandler,e=document.activeElement;return {activeEditor:e===h.textarea,tag:e?.tagName,label:e?.getAttribute('aria-label'),insideDialog:!!e?.closest('.tcp-dialog'),editorActive:h.isActive()};}),host:await page.evaluate(()=>({tag:document.activeElement?.tagName,editorFrame:document.activeElement?.tagName==='IFRAME'}))});
 const rawHistoryKey=async redo=>{await page.keyboard.down('Meta');if(redo)await page.keyboard.down('Shift');try{await page.keyboard.press('z');}finally{if(redo)await page.keyboard.up('Shift');await page.keyboard.up('Meta');}await settle();};
 const events=()=>frame.evaluate(()=>window.__dialogFocusQA.events);
 await frame.evaluate(()=>{const h=window.__inputHandler,events=[],record=e=>{if(events.length>=64)throw Error('bounded focus event log');const t=e.target;events.push({type:e.type,key:e.key??null,data:e.data??null,inputType:e.inputType??null,meta:e.metaKey??false,shift:e.shiftKey??false,trusted:e.isTrusted,target:{tag:t?.tagName,editor:t===h.textarea,insideDialog:!!t?.closest?.('.tcp-dialog'),label:t?.getAttribute?.('aria-label')??null}});};window.__dialogFocusQA={events,record};for(const type of ['keydown','input','focusin'])document.addEventListener(type,record,{capture:true,passive:true});});
 try{
  const sourceObservation=await observe(),sourceFocus=await focus();assert.equal(sourceObservation.dirty,false);assert.deepEqual(hist,{u:0,r:0,snapshotResources:0});assert(sourceFocus.renderer.activeEditor&&sourceFocus.host.editorFrame);
  await page.keyboard.sendCharacter('REDO_FOCUS🙂');await settle();const edited=await state(),editObservation=await observe(),editHistory=await history();
  write(f.name+'-'+op.name+'-source-state.json',{source,edited,sourceObservation,sourceFocus,editObservation,editHistory});
  assert.deepEqual(editHistory,{u:1,r:0,snapshotResources:1});assert.equal(edited.cells[24].paras[0].text,'REDO_FOCUS🙂'+source.cells[24].paras[0].text);assert.equal(editObservation.dirty,true);
  await rawHistoryKey(false);const undone=await state(),undoObservation=await observe(),undoHistory=await history();
  write(f.name+'-'+op.name+'-initial-undo-state.json',{reference:source,after:undone,observation:undoObservation,history:undoHistory});
  assert.deepEqual(comparable(undone),comparable(source));assert.deepEqual(undoHistory,{u:0,r:1,snapshotResources:2});
  const entry=JSON.parse(undoObservation.entries.redo[0].fields);assert.notEqual(entry.beforeId,null);assert.notEqual(entry.afterId,null);
  async function cycle(name,reference,referenceObservation,referenceHistory){
   const retained=await frame.evaluateHandle(()=>window.__inputHandler.history.peekRedoTop());
   const eventStart=(await events()).length;
   try{
    await frame.evaluate(()=>{const h=window.__inputHandler,p=h.cursor.getPosition();if(h.isInTableObjectSelection()||p.cellIndex!==24)throw Error('owner 24 cell-mode cursor required');const result=h.dispatcher.dispatchWithResult('table:cell-props');if(!result.ok)throw Error(JSON.stringify(result));});
    await frame.waitForSelector('.tcp-dialog',{visible:true});await settle();
    const opened=await state(),openObservation=await observe(),openHistory=await history(),openFocus=await focus(),openIdentity=await frame.evaluate(c=>window.__inputHandler.history.peekRedoTop()===c,retained);
    const dialog=await frame.evaluate(()=>{const d=document.querySelector('.tcp-dialog');return {tabs:[...d.querySelectorAll('.dialog-tab')].map(t=>t.textContent.trim()),primaryFocused:document.activeElement===d.querySelector('.dialog-btn-primary')};});
    write(f.name+'-'+op.name+'-'+name+'-open-state.json',{reference,after:opened,referenceObservation,observation:openObservation,historyBefore:referenceHistory,historyAfter:openHistory,focus:openFocus,dialog,retainedRedoIdentity:openIdentity});
    assert.deepEqual(opened,reference);assert.deepEqual(openObservation,referenceObservation);assert.deepEqual(openHistory,referenceHistory);assert(openIdentity);assert(dialog.primaryFocused&&openFocus.renderer.insideDialog&&!openFocus.renderer.activeEditor);assert.deepEqual(dialog.tabs,['기본','여백/캡션','표','셀']);
    if(route==='escape')await page.keyboard.press('Escape');else await frame.click('.tcp-dialog .dialog-footer .dialog-btn:not(.dialog-btn-primary)');
    await frame.waitForSelector('.tcp-dialog',{hidden:true});await settle();
    const closed=await state(),closeObservation=await observe(),closeHistory=await history(),closeFocus=await focus(),closeIdentity=await frame.evaluate(c=>window.__inputHandler.history.peekRedoTop()===c,retained),closeEvents=(await events()).slice(eventStart);
    write(f.name+'-'+op.name+'-'+name+'-close-state.json',{reference,after:closed,referenceObservation,observation:closeObservation,historyBefore:referenceHistory,historyAfter:closeHistory,focus:closeFocus,route,events:closeEvents,retainedRedoIdentity:closeIdentity,dialogHidden:true});
    assert.deepEqual(closed,reference,'close preserves full SVG/model and both export bytes');assert.deepEqual(closeObservation,referenceObservation);assert.deepEqual(closeHistory,referenceHistory);assert(closeIdentity);assert(closeFocus.renderer.activeEditor&&closeFocus.renderer.editorActive&&closeFocus.host.editorFrame,'product restores editor focus before any QA focus or keyboard');assert.equal(closeFocus.renderer.tag,'TEXTAREA');assert.equal(closeFocus.renderer.label,'문서 편집 입력');
    if(route==='escape')assert(closeEvents.some(e=>e.type==='keydown'&&e.key==='Escape'&&e.trusted&&e.target.insideDialog&&!e.target.editor),'real Escape delivered to modal');
   }finally{await retained.dispose();}
  }
  await cycle('history',undone,undoObservation,undoHistory);
  let eventStart=(await events()).length;await rawHistoryKey(true);const redone=await state(),redoObservation=await observe(),redoHistory=await history(),redoEvents=(await events()).slice(eventStart),redoFocus=await focus();
  write(f.name+'-'+op.name+'-redo-state.json',{reference:edited,after:redone,observation:redoObservation,history:redoHistory,events:redoEvents,focus:redoFocus});
  assert.deepEqual(comparable(redone),comparable(edited));assert.deepEqual(redoHistory,{u:1,r:0,snapshotResources:1});assert.deepEqual(redoObservation.cursor,editObservation.cursor);assert(redoEvents.some(e=>e.type==='keydown'&&e.key?.toLowerCase()==='z'&&e.meta&&e.shift&&e.trusted&&e.target.editor),'unforced redo reaches editor');
  eventStart=(await events()).length;await rawHistoryKey(false);const undoneAgain=await state(),undoAgainObservation=await observe(),undoAgainHistory=await history(),undoEvents=(await events()).slice(eventStart),undoFocus=await focus();
  write(f.name+'-'+op.name+'-undo-state.json',{reference:source,after:undoneAgain,observation:undoAgainObservation,history:undoAgainHistory,events:undoEvents,focus:undoFocus});
  assert.deepEqual(comparable(undoneAgain),comparable(source));assert.deepEqual(undoAgainHistory,{u:0,r:1,snapshotResources:2});assert.deepEqual(undoAgainObservation.cursor,sourceObservation.cursor);assert(undoEvents.some(e=>e.type==='keydown'&&e.key?.toLowerCase()==='z'&&e.meta&&!e.shift&&e.trusted&&e.target.editor),'unforced undo reaches editor');
  const redoEntry=JSON.parse(redoObservation.entries.undo[0].fields),finalEntry=JSON.parse(undoAgainObservation.entries.redo[0].fields);assert.equal(redoEntry.beforeId,entry.beforeId);assert.equal(redoEntry.afterId,null);assert.equal(finalEntry.beforeId,entry.beforeId);assert.notEqual(finalEntry.afterId,null);assert.equal(finalEntry.timestamp,entry.timestamp);
  await cycle('text',undoneAgain,undoAgainObservation,undoAgainHistory);
  eventStart=(await events()).length;await page.keyboard.press('x');await settle();const typed=await state(),typedObservation=await observe(),typedHistory=await history(),typedEvents=(await events()).slice(eventStart),typedFocus=await focus();
  write(f.name+'-'+op.name+'-text-input-state.json',{reference:source,after:typed,observation:typedObservation,history:typedHistory,events:typedEvents,focus:typedFocus});
  assert.equal(typed.cells[24].paras[0].text,'x'+source.cells[24].paras[0].text);assert.deepEqual(typed.cells[24].paras.slice(1),source.cells[24].paras.slice(1));for(let i=0;i<source.cells.length;i++)if(i!==24)assert.deepEqual(typed.cells[i],source.cells[i]);for(const k of ['body','bodyFormats','props','pageDef','styles','dims'])assert.deepEqual(typed[k],source[k]);assert.deepEqual(typedHistory,{u:1,r:0,snapshotResources:1});assert.equal(typedObservation.cursor.charOffset,1);assert.equal(typedObservation.dirty,true);assert(typedEvents.some(e=>e.type==='keydown'&&e.key==='x'&&e.trusted&&e.target.editor)&&typedEvents.some(e=>e.type==='input'&&e.data==='x'&&e.trusted&&e.target.editor),'ordinary keyboard events reach editor and edit text');assert(typedFocus.renderer.activeEditor&&typedFocus.host.editorFrame);pairs++;
  rows.push({label:f.label,ext:f.ext,operation:op.name,route,dialogCycles:2,dialogTransitions:4,retainedRedoIdentityChecks:4,unforcedHistoryKeys:2,ordinaryKeyInputs:1,initialUndoExact:true,redoAfterCloseExact:true,undoAfterRedoExact:true,qaFocusCallsAfterDialog:0,resourceSequence:[1,2,1,2,1]});console.log('PASS '+f.name+' '+op.name);
 }finally{await frame.evaluate(()=>{const q=window.__dialogFocusQA;for(const type of ['keydown','input','focusin'])document.removeEventListener(type,q.record,true);delete window.__dialogFocusQA;});}
}

// Pending numeric dialog edits must be discarded without losing focus or redo.
async function ownerDialogPending(f,op,source,hist){
 const route=op.name==='owner-dialog-pending-escape'?'escape':'cancel';
 const observe=()=>frame.evaluate(()=>{const h=window.__inputHandler,record=c=>{const fields=JSON.stringify(c);if(fields.length>16384)throw Error('bounded history entry required');return {fields,resources:c.snapshotResourceCount?.()||0};};return {cursor:h.cursor.getPosition(),dirty:window.rhwpStudio.automation.getContext().isDirty,entries:{undo:h.history.undoStack.map(record),redo:h.history.redoStack.map(record)}};});
 const focus=async()=>({renderer:await frame.evaluate(()=>{const h=window.__inputHandler,e=document.activeElement;return {activeEditor:e===h.textarea,tag:e?.tagName,label:e?.getAttribute('aria-label'),insideDialog:!!e?.closest('.tcp-dialog'),editorActive:h.isActive()};}),host:await page.evaluate(()=>({tag:document.activeElement?.tagName,editorFrame:document.activeElement?.tagName==='IFRAME'}))});
 const rawHistoryKey=async redo=>{await page.keyboard.down('Meta');if(redo)await page.keyboard.down('Shift');try{await page.keyboard.press('z');}finally{if(redo)await page.keyboard.up('Shift');await page.keyboard.up('Meta');}await settle();};
 const events=()=>frame.evaluate(()=>window.__dialogPendingQA.events);
 await frame.evaluate(()=>{const h=window.__inputHandler,events=[],record=e=>{if(events.length>=64)throw Error('bounded focus event log');const t=e.target;events.push({type:e.type,key:e.key??null,data:e.data??null,inputType:e.inputType??null,meta:e.metaKey??false,shift:e.shiftKey??false,trusted:e.isTrusted,target:{tag:t?.tagName,type:t?.type??null,editor:t===h.textarea,insideDialog:!!t?.closest?.('.tcp-dialog'),label:t?.getAttribute?.('aria-label')??null}});};window.__dialogPendingQA={events,record};for(const type of ['keydown','input','change','focusin'])document.addEventListener(type,record,{capture:true,passive:true});});
 try{
  const sourceObservation=await observe(),sourceFocus=await focus();assert.equal(sourceObservation.dirty,false);assert.deepEqual(hist,{u:0,r:0,snapshotResources:0});assert(sourceFocus.renderer.activeEditor&&sourceFocus.host.editorFrame);
  await page.keyboard.sendCharacter('REDO_PENDING🙂');await settle();const edited=await state(),editObservation=await observe(),editHistory=await history();
  write(f.name+'-'+op.name+'-source-state.json',{source,edited,sourceObservation,sourceFocus,editObservation,editHistory});
  assert.deepEqual(editHistory,{u:1,r:0,snapshotResources:1});assert.equal(edited.cells[24].paras[0].text,'REDO_PENDING🙂'+source.cells[24].paras[0].text);assert.equal(editObservation.dirty,true);
  await rawHistoryKey(false);const undone=await state(),undoObservation=await observe(),undoHistory=await history();
  write(f.name+'-'+op.name+'-initial-undo-state.json',{reference:source,after:undone,observation:undoObservation,history:undoHistory});
  assert.deepEqual(comparable(undone),comparable(source));assert.deepEqual(undoHistory,{u:0,r:1,snapshotResources:2});
  const entry=JSON.parse(undoObservation.entries.redo[0].fields);assert.notEqual(entry.beforeId,null);assert.notEqual(entry.afterId,null);
  async function cycle(name,reference,referenceObservation,referenceHistory){
   const retained=await frame.evaluateHandle(()=>window.__inputHandler.history.peekRedoTop());
   const eventStart=(await events()).length;
   try{
    await frame.evaluate(()=>{const h=window.__inputHandler,p=h.cursor.getPosition();if(h.isInTableObjectSelection()||p.cellIndex!==24)throw Error('owner 24 cell-mode cursor required');const result=h.dispatcher.dispatchWithResult('table:cell-props');if(!result.ok)throw Error(JSON.stringify(result));});
    await frame.waitForSelector('.tcp-dialog',{visible:true});await settle();
    const opened=await state(),openObservation=await observe(),openHistory=await history(),openFocus=await focus(),openIdentity=await frame.evaluate(c=>window.__inputHandler.history.peekRedoTop()===c,retained);
    const dialog=await frame.evaluate(()=>{const d=document.querySelector('.tcp-dialog');return {tabs:[...d.querySelectorAll('.dialog-tab')].map(t=>t.textContent.trim()),primaryFocused:document.activeElement===d.querySelector('.dialog-btn-primary')};});
    write(f.name+'-'+op.name+'-'+name+'-open-state.json',{reference,after:opened,referenceObservation,observation:openObservation,historyBefore:referenceHistory,historyAfter:openHistory,focus:openFocus,dialog,retainedRedoIdentity:openIdentity});
    assert.deepEqual(opened,reference);assert.deepEqual(openObservation,referenceObservation);assert.deepEqual(openHistory,referenceHistory);assert(openIdentity);assert(dialog.primaryFocused&&openFocus.renderer.insideDialog&&!openFocus.renderer.activeEditor);assert.deepEqual(dialog.tabs,['기본','여백/캡션','표','셀']);
    const fieldEventStart=(await events()).length;
    await frame.click('.tcp-dialog .dialog-tab:nth-child(2)');
    const fieldHandle=await frame.evaluateHandle(()=>[...document.querySelector('.tcp-dialog').querySelectorAll('.dialog-section-title')].find(t=>t.textContent.trim()==='바깥 여백').parentElement.querySelector('input[type=number]'));
    const input=fieldHandle.asElement();assert(input,'actual outer-left numeric field');
    try{
     const fieldBefore=await input.evaluate(e=>({tag:e.tagName,type:e.type,min:e.min,max:e.max,step:e.step,value:e.value,disabled:e.disabled,readOnly:e.readOnly}));
     assert.deepEqual({...fieldBefore,value:undefined},{tag:'INPUT',type:'number',min:'-115.6',max:'115.6',step:'0.1',value:undefined,disabled:false,readOnly:false});
     assert.equal(fieldBefore.value,(Math.round(reference.props.outerLeft*25.4/7200*10)/10).toFixed(1),'UI display contract');
     const pendingValue=(Number(fieldBefore.value)+0.1).toFixed(1);assert(Number(pendingValue)>Number(fieldBefore.min)&&Number(pendingValue)<Number(fieldBefore.max));
     await input.click();await page.keyboard.press('ArrowUp');await settle();
     const fieldAfter=await input.evaluate(e=>({value:e.value,numericFocused:document.activeElement===e,valid:e.checkValidity()})),pending=await state(),pendingObservation=await observe(),pendingHistory=await history(),pendingFocus=await focus(),pendingIdentity=await frame.evaluate(c=>window.__inputHandler.history.peekRedoTop()===c,retained),fieldEvents=(await events()).slice(fieldEventStart),wouldConfirmHWPUNIT=Math.round(Number(pendingValue)*7200/25.4);
     write(f.name+'-'+op.name+'-'+name+'-pending-state.json',{reference,after:pending,referenceObservation,observation:pendingObservation,historyBefore:referenceHistory,historyAfter:pendingHistory,focus:pendingFocus,field:{property:'outerLeft',section:'바깥 여백',side:'왼쪽',before:fieldBefore,after:fieldAfter,pendingValue,inputMethod:'ArrowUp',wouldConfirmHWPUNIT,originalHWPUNIT:reference.props.outerLeft},events:fieldEvents,retainedRedoIdentity:pendingIdentity});
     assert.equal(fieldAfter.value,pendingValue);assert.notEqual(fieldAfter.value,fieldBefore.value);assert(fieldAfter.numericFocused&&fieldAfter.valid);assert.notEqual(wouldConfirmHWPUNIT,reference.props.outerLeft,'pending field change would change document if confirmed');assert(pendingFocus.renderer.insideDialog&&!pendingFocus.renderer.activeEditor&&pendingFocus.renderer.tag==='INPUT');assert.deepEqual(pending,reference,'pending numeric input has not applied to full SVG/model/exports');assert.deepEqual(pendingObservation,referenceObservation);assert.deepEqual(pendingHistory,referenceHistory);assert(pendingIdentity);assert(fieldEvents.some(e=>e.type==='input'&&e.trusted&&e.target.type==='number'&&e.target.insideDialog&&!e.target.editor),'trusted numeric input stays in dialog');
    }finally{await fieldHandle.dispose();}
    if(route==='escape')await page.keyboard.press('Escape');else await frame.click('.tcp-dialog .dialog-footer .dialog-btn:not(.dialog-btn-primary)');
    await frame.waitForSelector('.tcp-dialog',{hidden:true});await settle();
    const closed=await state(),closeObservation=await observe(),closeHistory=await history(),closeFocus=await focus(),closeIdentity=await frame.evaluate(c=>window.__inputHandler.history.peekRedoTop()===c,retained),closeEvents=(await events()).slice(eventStart);
    write(f.name+'-'+op.name+'-'+name+'-close-state.json',{reference,after:closed,referenceObservation,observation:closeObservation,historyBefore:referenceHistory,historyAfter:closeHistory,focus:closeFocus,route,events:closeEvents,retainedRedoIdentity:closeIdentity,dialogHidden:true});
    assert.deepEqual(closed,reference,'close preserves full SVG/model and both export bytes');assert.deepEqual(closeObservation,referenceObservation);assert.deepEqual(closeHistory,referenceHistory);assert(closeIdentity);assert(closeFocus.renderer.activeEditor&&closeFocus.renderer.editorActive&&closeFocus.host.editorFrame,'product restores editor focus before any QA focus or keyboard');assert.equal(closeFocus.renderer.tag,'TEXTAREA');assert.equal(closeFocus.renderer.label,'문서 편집 입력');
    if(route==='escape')assert(closeEvents.some(e=>e.type==='keydown'&&e.key==='Escape'&&e.trusted&&e.target.insideDialog&&!e.target.editor&&e.target.type==='number'),'real Escape delivered from numeric input');
   }finally{await retained.dispose();}
  }
  await cycle('history',undone,undoObservation,undoHistory);
  let eventStart=(await events()).length;await rawHistoryKey(true);const redone=await state(),redoObservation=await observe(),redoHistory=await history(),redoEvents=(await events()).slice(eventStart),redoFocus=await focus();
  write(f.name+'-'+op.name+'-redo-state.json',{reference:edited,after:redone,observation:redoObservation,history:redoHistory,events:redoEvents,focus:redoFocus});
  assert.deepEqual(comparable(redone),comparable(edited));assert.deepEqual(redoHistory,{u:1,r:0,snapshotResources:1});assert.deepEqual(redoObservation.cursor,editObservation.cursor);assert(redoEvents.some(e=>e.type==='keydown'&&e.key?.toLowerCase()==='z'&&e.meta&&e.shift&&e.trusted&&e.target.editor),'unforced redo reaches editor');
  eventStart=(await events()).length;await rawHistoryKey(false);const undoneAgain=await state(),undoAgainObservation=await observe(),undoAgainHistory=await history(),undoEvents=(await events()).slice(eventStart),undoFocus=await focus();
  write(f.name+'-'+op.name+'-undo-state.json',{reference:source,after:undoneAgain,observation:undoAgainObservation,history:undoAgainHistory,events:undoEvents,focus:undoFocus});
  assert.deepEqual(comparable(undoneAgain),comparable(source));assert.deepEqual(undoAgainHistory,{u:0,r:1,snapshotResources:2});assert.deepEqual(undoAgainObservation.cursor,sourceObservation.cursor);assert(undoEvents.some(e=>e.type==='keydown'&&e.key?.toLowerCase()==='z'&&e.meta&&!e.shift&&e.trusted&&e.target.editor),'unforced undo reaches editor');
  const redoEntry=JSON.parse(redoObservation.entries.undo[0].fields),finalEntry=JSON.parse(undoAgainObservation.entries.redo[0].fields);assert.equal(redoEntry.beforeId,entry.beforeId);assert.equal(redoEntry.afterId,null);assert.equal(finalEntry.beforeId,entry.beforeId);assert.notEqual(finalEntry.afterId,null);assert.equal(finalEntry.timestamp,entry.timestamp);
  await cycle('text',undoneAgain,undoAgainObservation,undoAgainHistory);
  eventStart=(await events()).length;await page.keyboard.press('x');await settle();const typed=await state(),typedObservation=await observe(),typedHistory=await history(),typedEvents=(await events()).slice(eventStart),typedFocus=await focus();
  write(f.name+'-'+op.name+'-text-input-state.json',{reference:source,after:typed,observation:typedObservation,history:typedHistory,events:typedEvents,focus:typedFocus});
  assert.equal(typed.cells[24].paras[0].text,'x'+source.cells[24].paras[0].text);assert.deepEqual(typed.cells[24].paras.slice(1),source.cells[24].paras.slice(1));for(let i=0;i<source.cells.length;i++)if(i!==24)assert.deepEqual(typed.cells[i],source.cells[i]);for(const k of ['body','bodyFormats','props','pageDef','styles','dims'])assert.deepEqual(typed[k],source[k]);assert.deepEqual(typedHistory,{u:1,r:0,snapshotResources:1});assert.equal(typedObservation.cursor.charOffset,1);assert.equal(typedObservation.dirty,true);assert(typedEvents.some(e=>e.type==='keydown'&&e.key==='x'&&e.trusted&&e.target.editor)&&typedEvents.some(e=>e.type==='input'&&e.data==='x'&&e.trusted&&e.target.editor),'ordinary keyboard events reach editor and edit text');assert(typedFocus.renderer.activeEditor&&typedFocus.host.editorFrame);pairs++;
  rows.push({label:f.label,ext:f.ext,operation:op.name,route,dialogCycles:2,dialogTransitions:4,retainedRedoIdentityChecks:6,pendingNumericEdits:2,unforcedHistoryKeys:2,ordinaryKeyInputs:1,initialUndoExact:true,redoAfterCloseExact:true,undoAfterRedoExact:true,qaFocusCallsAfterDialog:0,resourceSequence:[1,2,1,2,1]});console.log('PASS '+f.name+' '+op.name);
 }finally{await frame.evaluate(()=>{const q=window.__dialogPendingQA;for(const type of ['keydown','input','change','focusin'])document.removeEventListener(type,q.record,true);delete window.__dialogPendingQA;});}
}

// New input replaces one retained redo entry and releases its snapshot IDs.
async function ownerRedoBranch(f,op,source,hist){
 const observe=()=>frame.evaluate(()=>{const h=window.__inputHandler,record=c=>{const fields=JSON.stringify(c);if(fields.length>16384)throw Error('bounded history entry required');return {fields,resources:c.snapshotResourceCount?.()||0};};return {cursor:h.cursor.getPosition(),dirty:window.rhwpStudio.automation.getContext().isDirty,entries:{undo:h.history.undoStack.map(record),redo:h.history.redoStack.map(record)}};});
 const initialObservation=await observe();assert.equal(initialObservation.dirty,false);assert.deepEqual(hist,{u:0,r:0,snapshotResources:0});
 await page.keyboard.sendCharacter('OLD_REDO🙂');await settle();const oldEdited=await state();assert.equal(oldEdited.cells[24].paras[0].text,'OLD_REDO🙂'+source.cells[24].paras[0].text);
 await key(false);const undone=await state(),oldObservation=await observe(),oldHistory=await history();
 write(f.name+'-'+op.name+'-old-state.json',{source,oldEdited,undone,initialObservation,oldObservation,oldHistory});
 assert.deepEqual(comparable(undone),comparable(source));assert.deepEqual(oldHistory,{u:0,r:1,snapshotResources:2});
 const oldFields=JSON.parse(oldObservation.entries.redo[0].fields),oldIDs=[oldFields.beforeId,oldFields.afterId];assert(oldIDs.every(id=>Number.isInteger(id)));
 const oldHandle=await frame.evaluateHandle(()=>window.__inputHandler.history.peekRedoTop());
 try{
  await page.keyboard.sendCharacter('NEW_BRANCH🙂');await settle();const branch=await state(),branchObservation=await observe(),branchHistory=await history();
  const discarded=await oldHandle.evaluate(c=>({fields:JSON.stringify(c),resources:c.snapshotResourceCount?.()||0}));
  write(f.name+'-'+op.name+'-branch-state.json',{source,branch,branchObservation,branchHistory,oldIDs,discarded});
  assert.equal(branch.cells[24].paras[0].text,'NEW_BRANCH🙂'+source.cells[24].paras[0].text);assert.deepEqual(branchHistory,{u:1,r:0,snapshotResources:1});assert.equal(branchObservation.dirty,true);assert.notDeepEqual(comparable(branch),comparable(oldEdited));
  const discardedFields=JSON.parse(discarded.fields);assert.equal(discarded.resources,0);assert.equal(discardedFields.beforeId,null);assert.equal(discardedFields.afterId,null);
  const probes=await frame.evaluate(ids=>ids.map(id=>{try{window.__wasm.doc.restoreSnapshot(id);return {id,rejected:false};}catch(e){return {id,rejected:true,error:String(e)};}}),oldIDs);
  const afterProbe=await state(),probeObservation=await observe(),probeHistory=await history();
  write(f.name+'-'+op.name+'-discard-probe-state.json',{reference:branch,after:afterProbe,probes,observation:probeObservation,history:probeHistory});
  assert(probes.every(p=>p.rejected&&p.error.includes('스냅샷')&&p.error.includes('없음')),'discarded WASM snapshot IDs reject before mutation');assert.deepEqual(afterProbe,branch);assert.deepEqual(probeObservation,branchObservation);assert.deepEqual(probeHistory,branchHistory);
  await key(true);const blocked=await state(),blockedObservation=await observe(),blockedHistory=await history();
  write(f.name+'-'+op.name+'-blocked-old-redo-state.json',{reference:branch,after:blocked,referenceObservation:branchObservation,observation:blockedObservation,history:blockedHistory});
  assert.deepEqual(blocked,branch);assert.deepEqual(blockedObservation,branchObservation);assert.deepEqual(blockedHistory,branchHistory,'old redo cannot execute after new input');
  await key(false);const branchUndo=await state(),undoObservation=await observe(),undoHistory=await history();
  write(f.name+'-'+op.name+'-undo-state.json',{reference:source,after:branchUndo,observation:undoObservation,history:undoHistory});
  assert.deepEqual(comparable(branchUndo),comparable(source),'new branch undo restores source full SVG/model');assert.deepEqual(undoHistory,{u:0,r:1,snapshotResources:2});assert.deepEqual(undoObservation.cursor,initialObservation.cursor);
  await key(true);const branchRedo=await state(),redoObservation=await observe(),redoHistory=await history();
  write(f.name+'-'+op.name+'-redo-state.json',{reference:branch,after:branchRedo,observation:redoObservation,history:redoHistory});
  assert.deepEqual(comparable(branchRedo),comparable(branch),'new branch redo restores new full SVG/model');assert.notDeepEqual(comparable(branchRedo),comparable(oldEdited));assert.deepEqual(redoHistory,{u:1,r:0,snapshotResources:1});assert.deepEqual(redoObservation.cursor,branchObservation.cursor);
  await key(true);const exhausted=await state(),exhaustedObservation=await observe(),exhaustedHistory=await history();
  write(f.name+'-'+op.name+'-exhausted-redo-state.json',{reference:branchRedo,after:exhausted,referenceObservation:redoObservation,observation:exhaustedObservation,history:exhaustedHistory});
  assert.deepEqual(exhausted,branchRedo);assert.deepEqual(exhaustedObservation,redoObservation);assert.deepEqual(exhaustedHistory,redoHistory,'old redo is not retained below new branch');pairs++;
  rows.push({label:f.label,ext:f.ext,operation:op.name,discardedOldIDs:oldIDs,discardedWasmIDRejections:probes.length,emptyRedoChecks:2,newBranchUndoRedoExact:true,resourceSequence:[oldHistory.snapshotResources,branchHistory.snapshotResources,undoHistory.snapshotResources,redoHistory.snapshotResources]});console.log('PASS '+f.name+' '+op.name);
 }finally{await oldHandle.dispose();}
}

async function snapshotBudgetHistory(f,op,before){
 assert(before.cells[op.target.cell].needsTextSnapshot,'real source snapshot path required');
 const signature=v=>sha(JSON.stringify(comparable(v))),references=[signature(before)],observations=[];
 let current=0,maxResources=0,firstEvictionAt=null;
 async function observed(stage){const h=await history();assert(h.snapshotResources<=98,'unchanged product 98-ID budget');maxResources=Math.max(maxResources,h.snapshotResources);observations.push({stage,current,...h});return h;}
 await selectCell(op.target.cell,op.target.para);
 for(let i=1;i<=100;i++){
  await page.keyboard.sendCharacter('X');await settle();const v=await state();references.push(signature(v));current=i;
  const h=await observed('create-'+i);assert.equal(h.r,0);assert.equal(h.u,Math.min(i,98));if(h.u<i&&firstEvictionAt===null)firstEvictionAt=i;
 }
 assert.equal(firstEvictionAt,99,'actual budget eviction begins after 98 snapshot entries');
 ownership(await state());await verifyPaint(f.name+'-budget-full',await state());
 for(let i=0;i<8;i++){await key(false);current--;assert.equal(signature(await state()),references[current],'interleaved undo source exact');await observed('interleaved-undo');}
 const branchBase=current;await page.keyboard.sendCharacter('B');await settle();current++;references[current]=signature(await state());
 assert.equal((await observed('new-branch')).r,0,'new edit discards retained redo');
 await key(false);current--;assert.equal(signature(await state()),references[current],'new branch undo exact');await observed('branch-undo');
 await key(true);current++;assert.equal(signature(await state()),references[current],'new branch redo exact');await observed('branch-redo');pairs++;
 let drained=0,replayed=0;
 while((await history()).u){assert(drained<100);await key(false);current--;assert.equal(signature(await state()),references[current],'retained undo sequence exact');await observed('drain-undo');drained++;}
 const oldestRetained=current,empty=signature(await state());await key(false);assert.equal(signature(await state()),empty,'empty undo is stable');
 while((await history()).r){assert(replayed<100);await key(true);current++;assert.equal(signature(await state()),references[current],'retained redo sequence exact');await observed('replay-redo');replayed++;pairs++;}
 assert(current<=branchBase+1,'bounded redo remains contiguous');assert(drained>0&&replayed>0&&replayed<=drained);
 const after=await state();ownership(after);await verifyPaint(f.name+'-budget-final',after);
 const summary={created:100,configuredSnapshotIDBudget:98,maxResources,firstEvictionAt,interleavedUndos:8,branchBase,drained,replayed,oldestRetained,finalRetained:current,observations,referenceDigests:references};
 write(f.name+'-snapshot-budget-state.json',summary);await saveAndReopen(f.label+'-'+f.ext+'-'+op.name,after);
 rows.push({label:f.label,ext:f.ext,operation:op.name,created:100,maxResources,firstEvictionAt,drained,replayed,oldestRetained,finalRetained:current,historyPairs:replayed+1,beforePages:before.pageCount,afterPages:after.pageCount});console.log('PASS '+f.name+' '+op.name);
}

async function selectCell(cell,para,charOffset=0){return frame.evaluate(({cell,para,charOffset})=>{const h=window.__inputHandler,w=window.__wasm,t=JSON.parse(w.doc.getControls()).find(t=>t.ctrlId==='tbl'&&t.list===0);h.cursor.exitCellSelectionMode();h.cursor.exitCellMode?.();h.cursor.clearSelection();h.cursor.moveTo({sectionIndex:0,paragraphIndex:para,parentParaIndex:t.para,controlIndex:t.controlIndex,cellIndex:cell,cellParaIndex:para,cellPath:[{controlIndex:t.controlIndex,cellIndex:cell,cellParaIndex:para}],charOffset});h.updateCaret();h.focus();return {position:h.cursor.getPosition(),rect:h.cursor.getRect()};},{cell,para,charOffset});}
async function type(cell,para,text,charOffset=0){const before=await selectCell(cell,para,charOffset);assert(before.rect,'cell caret');await page.keyboard.sendCharacter(text);await settle();return before;}
async function cellKey(cell,para,key,shift=false){const caret=await selectCell(cell,para);if(shift)await page.keyboard.down('Shift');try{await page.keyboard.press(key);}finally{if(shift)await page.keyboard.up('Shift');}await settle();return caret;}
async function typeHost(){await frame.evaluate(()=>{const h=window.__inputHandler,w=window.__wasm,t=JSON.parse(w.doc.getControls()).find(t=>t.ctrlId==='tbl'&&t.list===0);h.cursor.exitCellSelectionMode();h.cursor.exitCellMode?.();h.cursor.clearSelection();h.cursor.moveTo({sectionIndex:0,paragraphIndex:t.para,charOffset:w.doc.getParagraphLength(0,t.para)});h.updateCaret();h.focus();});await page.keyboard.sendCharacter('HOST_EDIT🙂');await settle();}
async function prepareReplace(query,text,all){await frame.evaluate(()=>window.__inputHandler.dispatcher.dispatchWithResult('edit:find-replace'));await frame.waitForSelector('.find-dialog-input',{visible:true});await frame.evaluate(({query,text,all})=>{const es=document.querySelectorAll('.find-dialog-input');es[0].value=query;es[1].value=text;if(!all)[...document.querySelectorAll('.find-dialog-buttons button')].find(b=>b.textContent.trim()==='다음 찾기').click();},{query,text,all});await settle();}
async function replace(all){await frame.evaluate(all=>{[...document.querySelectorAll('.find-dialog-buttons button')].find(b=>b.textContent.trim()===(all?'모두 바꾸기':'바꾸기')).click();document.querySelector('.find-dialog .dialog-close').click();},all);await settle();}

async function height(cell,mm){await selectCell(cell,0);await frame.evaluate(()=>window.__inputHandler.dispatcher.dispatchWithResult('table:cell-props'));await frame.waitForSelector('.tcp-dialog',{visible:true});await frame.evaluate(mm=>{const d=document.querySelector('.tcp-dialog');[...d.querySelectorAll('.dialog-tab')].find(t=>t.textContent.trim()==='셀').click();const title=[...d.querySelectorAll('.dialog-section-title')].find(t=>t.textContent.trim()==='셀 크기');const section=title.parentElement,check=section.querySelector('input[type=checkbox]');if(!check.checked)check.click();const es=section.querySelectorAll('input[type=number]');if(mm!==null)es[1].value=String(mm);es[1].dispatchEvent(new Event('input',{bubbles:true}));es[1].dispatchEvent(new Event('change',{bubbles:true}));},mm);await close(true);}
try{
 assert.equal(process.platform,'darwin');assert(!fs.existsSync(path.join(q,'audit.jsonl')),'fresh run');const cases=[];
 assert(process.env.GEULGYEOL_QA_BUDGET_ROOT,'explicit whole-run GEULGYEOL_QA_BUDGET_ROOT required');
 budget=new EvidenceBudget({root:process.env.GEULGYEOL_QA_BUDGET_ROOT,phase:q});
 budget.begin({normalForecastBytes:Number(process.env.GEULGYEOL_QA_NORMAL_FORECAST_BYTES||134217728),failureForecastBytes:Number(process.env.GEULGYEOL_QA_FAILURE_FORECAST_BYTES||16777216)});
 M.initSync({module:fs.readFileSync(path.join(engine,'rhwp_bg.wasm'))});
 manifestWriter=await createTableManifestWriter(q,{gzip:true,beforeWrite:bytes=>budget.check({normalForecastBytes:bytes})});
 const seedRows=JSON.parse(fs.readFileSync(process.env.GEULGYEOL_HOST_SEEDS||path.resolve(root,'../table-host-spacing-qa/seeds.json')));
 for(const seed of seedRows){for(const ext of ['hwpx','hwp']){const name=seed.label+'-input.'+ext;budget.check({normalForecastBytes:fs.statSync(path.resolve(root,seed.files[ext])).size});fs.copyFileSync(path.resolve(root,seed.files[ext]),path.join(q,'files',name));cases.push({...seed,name,ext});}}
 const selectedCases=cases.filter(f=>!process.env.GEULGYEOL_FRAGMENT_CASE||f.name===process.env.GEULGYEOL_FRAGMENT_CASE);assert(selectedCases.length,'selected fixture unavailable');const expectedFixtures=selectedCases.map(f=>f.name),plannedFixtures=[];assertPlannedFixtures(expectedFixtures,expectedFixtures);
 control({id:'startup',canceled:true});let packagedEndpoint;
 if(packaged){const launch=await launchPackaged(path.resolve(packaged),q);p=launch.p;packagedEndpoint=launch.endpoint;}
 const env={...process.env,GEULGYEOL_QA_DIR:q,GEULGYEOL_PROFILE_ROOT:path.join(q,'profile'),GEULGYEOL_ELECTRON_MODULE:'electron'};delete env.ELECTRON_RUN_AS_NODE;
 if(!packaged)p=spawn(path.join(root,'desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),[path.join(q,'bootstrap.cjs'),'--remote-debugging-port=0','--remote-debugging-address=127.0.0.1','--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows'],{env});let log='';for(const s of [p.stdout,p.stderr])s.on('data',d=>{log=(log+d.toString()).slice(-65536);try{budget.check({normalForecastBytes:d.length});fs.appendFileSync(path.join(q,'launch.log'),d);}catch(e){budgetFailure||=e;}});
 await until(()=>packagedEndpoint||/DevTools listening on (ws:\/\/\S+)/.test(log),'renderer endpoint');b=await puppeteer.connect({browserWSEndpoint:packagedEndpoint||log.match(/DevTools listening on (ws:\/\/\S+)/)[1],defaultViewport:null});await until(async()=>{page=(await b.pages()).find(p=>/^http:\/\/127\.0\.0\.1:\d+\/$/.test(p.url()));frame=page?.frames().find(f=>f.url().includes('/studio/'));return frame;},'app');page.on('pageerror',e=>errors.push(String(e)));await page.waitForFunction(()=>!document.querySelector('#save').disabled,{timeout:30000});const asset=fs.readdirSync(path.join(process.env.GEULGYEOL_QA_STUDIO_DIR||path.join(q,'runtime/web/studio'),'assets')).find(n=>/^rhwp_bg-.*\.wasm$/.test(n));receivedEngineSHA256=sha(Buffer.from(await(await fetch(new URL('/studio/assets/'+asset,page.url()))).arrayBuffer()));assert.equal(receivedEngineSHA256,sha(fs.readFileSync(path.join(engine,'rhwp_bg.wasm'))));
 if(packaged)await frame.evaluate(()=>{
   const services=window.rhwpStudio.automation.options.dispatcher.services;
   if(window.__wasm||window.__inputHandler)throw Error('Production QA globals must be absent before memory-only aliases');
   Object.defineProperty(window,'__wasm',{get:()=>services.wasm});
   Object.defineProperty(window,'__inputHandler',{get:()=>services.getInputHandler()});
  });
 for(const f of selectedCases){
  caseMeta=f;await load(f.name);const initial=await state();
  if(f.repairExpected!==undefined){const repaired=await frame.evaluate(({cell,expected})=>{const w=window.__wasm,d=w.doc,t=JSON.parse(d.getControls()).find(t=>t.ctrlId==='tbl'&&t.list===0),dim=w.getTableDimensions(0,t.para,t.controlIndex),guarded=Array.from({length:dim.cellCount},(_,i)=>d.mergedCellNeedsTextSnapshot(0,t.para,t.controlIndex,i)),repair=Array.from({length:dim.cellCount},(_,i)=>typeof d.excludedLineWrapCellNeedsTextSnapshot==='function'&&d.excludedLineWrapCellNeedsTextSnapshot(0,t.para,t.controlIndex,i));if(guarded.some(Boolean))throw Error('Excluded layout scope was promoted');if(repair.some((v,i)=>v!==(expected&&i===cell)))throw Error('History-only predicate differs from exact planned owner');return {guarded,repair};},{cell:f.historyCell,expected:f.repairExpected});write(f.name+'-history-scope.json',repaired);repairScopes.push({fixture:f.name,repairExpected:f.repairExpected,guardedEligible:repaired.guarded.filter(Boolean).length,historyEligible:repaired.repair.flatMap((v,i)=>v?[i]:[])});}
write(f.name+'-initial-state.json',initial);assert(initial.pageCount>=1);await verifyPaint(f.name+'-initial',initial);
  const scan=await frame.evaluate(({allowMissing})=>{const w=window.__wasm,d=w.doc,t=JSON.parse(d.getControls()).find(t=>t.ctrlId==='tbl'&&t.list===0),dim=w.getTableDimensions(0,t.para,t.controlIndex),out=[],unavailable=[];for(let cell=0;cell<dim.cellCount;cell++)for(let para=0;para<w.getCellParagraphCount(0,t.para,t.controlIndex,cell);para++){let r;try{r=w.getCursorRectInCell(0,t.para,t.controlIndex,cell,para,0);}catch(e){if(!allowMissing)throw e;unavailable.push({cell,para,error:String(e)});}if(r)out.push({cell,para,page:r.pageIndex});}assertDispatch(out.length);function assertDispatch(v){if(!v)throw Error('No selectable caret witness');}const last=Math.max(...out.map(p=>p.page));return {positions:[out.find(p=>p.page===0)||out[0],last===0?out[Math.floor(out.length/2)]:out.find(p=>p.page===Math.floor(last/2)&&p.cell!==0)||out[Math.floor(out.length/2)],out.findLast(p=>p.page===last)],unavailable};},{allowMissing:excludedState(initial)});const positions=scan.positions;assert(positions.every(Boolean));write(f.name+'-fragments.json',{positions,pageCount:initial.pageCount,unavailableCarets:scan.unavailable});
  if(f.expectedRowCount){assert.equal(initial.dims.rowCount,f.expectedRowCount);const eligible=initial.cells.flatMap((c,i)=>c.needsTextSnapshot?[i]:[]);assert.deepEqual(eligible,f.expectedSupported?initial.cells.flatMap((c,i)=>c.info.row>0?[i]:[]):[],'actual boundary eligibility');}
  const ops=positions.map((p,i)=>({name:'input-'+i,run:()=>type(p.cell,p.para,'EDIT'+i+'🙂'),kind:'input',target:p}));
  if(f.repairExpected){
   assert(f.fallbackExactHistory,'history-only input requires strict comparison');
   const target={cell:f.historyCell,para:0};
   ops.push({name:'history-input',kind:'input',target,run:()=>type(target.cell,target.para,'EDIT🙂')});
   ops.push({name:'owner-save-reopen',kind:'save-integration',target});
   ops.push({name:'owner-reopened-edit',kind:'save-integration',target});
   ops.push({name:'owner-multi-history',kind:'save-integration',target});
   ops.push({name:'owner-tab',kind:'navigation',target});
   ops.push({name:'owner-shift-tab',kind:'navigation',target:{cell:25,para:0}});
   ops.push({name:'owner-edited-navigation',kind:'navigation',target});
   ops.push({name:'owner-redo-navigation',kind:'navigation',target});
   ops.push({name:'owner-redo-branch',kind:'navigation',target});
   ops.push({name:'owner-redo-dialog-cancel',kind:'navigation',target});
   ops.push({name:'owner-dialog-escape-focus',kind:'navigation',target});
   ops.push({name:'owner-dialog-cancel-focus',kind:'navigation',target});
   ops.push({name:'owner-dialog-pending-escape',kind:'navigation',target});
   ops.push({name:'owner-dialog-pending-cancel',kind:'navigation',target});
  }
  if(f.merged){
   const owners=f.mergedOwners?initial.cells.flatMap((c,i)=>c.info.rowSpan>1||c.info.colSpan>1?[i]:[]):[initial.cells.findIndex(c=>c.info.rowSpan>1||c.info.colSpan>1)];
   assert(owners.length&&owners.every(cell=>cell>=0),'merged source owners');
   for(const cell of owners){
    const count=initial.cells[cell].paras.length,paragraphs=[0,Math.floor((count-1)/2),count-1];
    for(const [i,para]of paragraphs.entries()){
     const rect=await frame.evaluate(({cell,para})=>{const w=window.__wasm,t=JSON.parse(w.doc.getControls()).find(t=>t.ctrlId==='tbl'&&t.list===0);return w.getCursorRectInCell(0,t.para,t.controlIndex,cell,para,0);},{cell,para});assert(rect,'merged owner caret');
     const target={cell,para,page:rect.pageIndex},name=f.mergedOwners?'owner-'+cell+'-input-'+i:'merged-input-'+i;
     ops.push({name,run:()=>type(cell,para,'MERGED'+i+'🙂'),kind:'input',target});
    }
   }
  }
  if(f.fragmentTail){
   const owners=[...new Set([...initial.cells.flatMap((c,i)=>c.info.rowSpan>1?[i]:[]),initial.cells.length-1])];
   for(const cell of owners){
    const para=initial.cells[cell].paras.length-1,charOffset=[...initial.cells[cell].paras[para].text].length;
    const rect=await frame.evaluate(({cell,para,charOffset})=>{const w=window.__wasm,t=JSON.parse(w.doc.getControls()).find(t=>t.ctrlId==='tbl'&&t.list===0);return w.getCursorRectInCell(0,t.para,t.controlIndex,cell,para,charOffset);},{cell,para,charOffset});
    const lastPage=Math.max(...initial.cellRendered.flatMap((runs,page)=>runs.some(r=>r.cell===cell)?[page]:[]));assert.equal(rect?.pageIndex,lastPage,'tail caret is in actual final owner fragment');
    ops.push({name:'owner-'+cell+'-fragment-tail',kind:'input',target:{cell,para,charOffset,page:lastPage},run:()=>type(cell,para,'TAIL_EDIT🙂',charOffset)});
   }
  }
  if(f.historyGaps){
   const cell=f.historyCell??initial.cells.findIndex(c=>c.info.rowSpan>1),count=initial.cells[cell].paras.length;
   for(const [i,para]of [0,Math.floor((count-1)/2),count-1].entries()){
    const target={cell,para};
    ops.push({name:'shift-enter-'+i,kind:'line-break',target,run:()=>cellKey(cell,para,'Enter',true)});
    ops.push({name:'direct-delete-'+i,kind:'direct-delete',target,run:()=>cellKey(cell,para,'Delete')});
   }
   ops.push({name:'tab-navigation',kind:'navigation',target:{cell:0,para:0},run:()=>cellKey(0,0,'Tab')});
   const lastCell=initial.cells.length-1,lastPara=Math.floor((initial.cells[lastCell].paras.length-1)/2);
   ops.push({name:'tab-last-row',kind:'row-insert',target:{cell:lastCell,para:lastPara},run:()=>cellKey(lastCell,lastPara,'Tab')});
   for(const name of ['mixed-text-history','mixed-burst-history'])ops.push({name,kind:'sequence',target:{cell,para:Math.floor((count-1)/2)}});
  }
  if(f.snapshotBudgetTest)ops.push({name:'snapshot-budget',kind:'budget',target:{cell:f.historyCell,para:0}});
  if(!baseline&&f.label!=='numbered')ops.push({name:'host-input',kind:'host-input',run:()=>typeHost()});
  ops.push({name:'replace-one',kind:'replace',prepare:()=>prepareReplace(f.query||'ROW024','SINGLE🙂',false),run:()=>replace(false)});
  ops.push({name:'replace-all',kind:'replace',prepare:()=>prepareReplace(f.allQuery||'ROW','T',true),run:()=>replace(true)});
  ops.push({name:'size-noop',kind:'noop',run:()=>height(positions[1].cell,null)});
  if(f.label!=='numbered')for(const mm of [30,2])ops.push({name:'height-'+mm,kind:'height',run:()=>height(positions[1].cell,mm)});
  const selectedOps=selectPlannedOperations(ops,f.operations,process.env.GEULGYEOL_FRAGMENT_OPERATION);
  manifestWriter.planFiles(plannedTableSaveFiles(q,f,selectedOps));plannedFixtures.push(f.name);
  for(const op of selectedOps){await load(f.name);if(op.name==='height-2')await height(positions[1].cell,30);if(op.target)await selectCell(op.target.cell,op.target.para,op.target.charOffset??0);else if(op.kind==='height'||op.kind==='noop')await selectCell(positions[1].cell,0);if(op.prepare)await op.prepare();const before=await state(),hist=await history();if(op.name==='owner-multi-history'){await ownerMultiHistory(f,op,before,hist);continue;}if(['owner-save-reopen','owner-reopened-edit'].includes(op.name)){await ownerSaveReopen(f,op,before,hist);continue;}if(op.name==='owner-tab'){await ownerTabNavigation(f,op,before,hist);continue;}if(['owner-shift-tab','owner-edited-navigation'].includes(op.name)){await ownerReverseNavigation(f,op,before,hist);continue;}if(op.name==='owner-redo-navigation'){await ownerRedoNavigation(f,op,before,hist);continue;}if(op.name==='owner-redo-branch'){await ownerRedoBranch(f,op,before,hist);continue;}if(op.name==='owner-redo-dialog-cancel'){await ownerRedoDialogCancel(f,op,before,hist);continue;}if(['owner-dialog-escape-focus','owner-dialog-cancel-focus'].includes(op.name)){await ownerDialogFocus(f,op,before,hist);continue;}if(['owner-dialog-pending-escape','owner-dialog-pending-cancel'].includes(op.name)){await ownerDialogPending(f,op,before,hist);continue;}if(op.kind==='sequence'){await mixedTextHistory(f,op,before,hist);continue;}if(op.kind==='budget'){await snapshotBudgetHistory(f,op,before);continue;}const caret=await op.run();const after=await state();const afterHistory=await history();if(f.repairExpected){assert.equal(afterHistory.snapshotResources,hist.snapshotResources+1,'one bounded history-only source snapshot');}write(f.name+'-'+op.name+'-state.json',{before,after,caret,historyBefore:hist,historyAfterEdit:afterHistory});if(op.kind==='noop'||op.kind==='navigation'){assert.deepEqual(comparable(after),comparable(before));assert.deepEqual(await history(),hist);ownership(after);if(op.kind==='navigation'){const cursor=await frame.evaluate(()=>window.__inputHandler.cursor.getPosition());assert.equal(cursor.cellIndex,1,'Tab navigates into next cell without text or history mutation');}if(f.verifyUnchangedSaveReopen){await verifyPaint(f.name+'-'+op.name,after);await saveAndReopen(f.label+'-'+f.ext+'-'+op.name,after);}rows.push({label:f.label,ext:f.ext,operation:op.name,noChange:true});console.log('PASS '+f.name+' '+op.name);continue;}if(op.kind==='row-insert'){
    assert.equal(after.dims.rowCount,before.dims.rowCount+1,'last-cell Tab adds one row');if(f.expectedLeaveScope){assert.equal(after.dims.rowCount,66);assert(after.cells.every(c=>!c.needsTextSnapshot),'66-row edit exits guarded snapshot scope');}assert.equal(after.dims.colCount,before.dims.colCount);assert.deepEqual(after.cells.slice(0,before.cells.length).map(c=>c.paras),before.cells.map(c=>c.paras),'Tab preserves all original cell text and styles');assert.deepEqual(after.body,before.body);
   }else if(op.kind==='height'){
    // Cell size is a minimum. Long content can keep the same physical rows
    // after a smaller declared height; the stored edit must still be applied.
    assert.notDeepEqual(after.cells.map(c=>c.props),before.cells.map(c=>c.props),'declared height changed');
   }else assert.notDeepEqual(after.svg,before.svg,'text operation changes complete SVG');assert.equal((await history()).u,hist.u+1,'one history operation');if(op.kind==='host-input'&&before.needsTextSnapshot){assert.equal(after.needsTextSnapshot,false,'first host edit generated lines');assert.equal((await history()).snapshotResources,hist.snapshotResources+1,'one bounded source snapshot');}
   if(op.kind==='row-insert'){assert.deepEqual(after.styles,before.styles);}
   else if(op.kind==='height'){assert.deepEqual(after.cells.map(c=>c.props.width),before.cells.map(c=>c.props.width),'height-only edit preserves exact cell widths');assert.deepEqual(after.cells.map(c=>c.paras),before.cells.map(c=>c.paras));assert.deepEqual(after.body,before.body);const tpBefore={...before.props},tpAfter={...after.props};delete tpBefore.tableHeight;delete tpAfter.tableHeight;assert.deepEqual(tpAfter,tpBefore,'height edit preserves other table properties');}
   else{assert.deepEqual(after.cells.map(c=>c.props),before.cells.map(c=>c.props));if(op.kind==='host-input'){const expected=[...before.body];expected[before.target.para]+='HOST_EDIT🙂';assert.deepEqual(after.body,expected);assert.deepEqual(after.cells,before.cells,'host input preserves all table cells');}else assert.deepEqual(after.body,before.body);assert.deepEqual(after.styles,before.styles);}
   // Actual model text supplies the ownership oracle after deliberate replacements.
   assert.deepEqual(after.bodyFormats.map(p=>p.props),before.bodyFormats.map(p=>p.props),'body paragraph properties preserved');for(let i=0;i<before.body.length;i++){if(before.body[i]===after.body[i])assert.deepEqual(after.bodyFormats[i].runs,before.bodyFormats[i].runs,'original body character styles');else{const ids=p=>p.runs.flatMap(r=>Array(r.endOffset-r.startOffset).fill(r.charShapeId));assert.deepEqual(ids(after.bodyFormats[i]).slice(0,[...before.body[i]].length),ids(before.bodyFormats[i]),'all original host character styles preserved');}}
   if(['input','line-break','direct-delete'].includes(op.kind)&&before.cells[op.target.cell].needsTextSnapshot){const now=await history();assert.equal(now.u,hist.u+1,'one bounded merged-cell history entry');assert.equal(now.snapshotResources,hist.snapshotResources+1,'one source snapshot before first undo');}
   if(op.kind!=='row-insert')assert.deepEqual(after.cells.map(c=>c.info),before.cells.map(c=>c.info),'merged topology unchanged by content edits');
   ownership(after);await verifyPaint(f.name+'-'+op.name,after);assert.deepEqual(after.pageDef,before.pageDef,'original page definition');if(!['height','row-insert'].includes(op.kind))assert.deepEqual(after.props,before.props,'text operations preserve table position and flow properties');assert.deepEqual(after.cells.slice(0,before.cells.length).map(c=>c.paras.map(p=>p.props)),before.cells.map(c=>c.paras.map(p=>p.props)),'paragraph/style/numbering references');const ids=p=>p.runs.flatMap(r=>Array(r.endOffset-r.startOffset).fill(r.charShapeId));for(let cell=0;cell<before.cells.length;cell++)for(let para=0;para<before.cells[cell].paras.length;para++){const a=before.cells[cell].paras[para],b=after.cells[cell].paras[para];if(a.text===b.text)assert.deepEqual(b.runs,a.runs);else if(op.kind==='input'){const at=op.target?.charOffset??0,added=[...b.text].length-[...a.text].length;assert.deepEqual([...ids(b).slice(0,at),...ids(b).slice(at+added)],ids(a),'input preserves all original character shape IDs');}else assert.deepEqual(ids(b).slice(-1),ids(a).slice(-1),'replacement preserves unchanged tail format');}
   for(let n=0;n<2;n++){await key(false);const undo=await state();write(f.name+'-'+op.name+'-undo'+n+'.json',undo);if(sha(undo.svg.join(''))!==sha(before.svg.join('')))write(f.name+'-'+op.name+'-undo-svg-diff.json',{beforeSvg:before.svg,actualSvg:undo.svg,geometry:await paintGeometry()});roundTripEqual(comparable(undo),comparable(before),'exact undo including clips/cuts/complete SVG');await key(true);const redo=await state();write(f.name+'-'+op.name+'-redo'+n+'.json',redo);roundTripEqual(comparable(redo),comparable(after),'exact redo including clips/cuts/complete SVG');pairs++;}
   // Skip numbered ownership tokens only when replacement changed them.
   await saveAndReopen(f.label+'-'+f.ext+'-'+op.name,after);rows.push({label:f.label,ext:f.ext,operation:op.name,beforePages:before.pageCount,afterPages:after.pageCount,target:op.target,caret,historyPairs:2,historyAfter:await history()});console.log('PASS '+f.name+' '+op.name);
  }
  mixedReferences.delete(f.name);
 }
 assert.deepEqual(errors,[]);budget.check({normalForecastBytes:2097152});await page.screenshot({path:path.join(q,'electron.png')});control({id:'normal-quit',quit:true,choice:'discard'});await until(()=>p.exitCode!==null,'normal application exit');assert.equal(p.exitCode,0);normalQuit=true;
 assertPlannedFixtures(expectedFixtures,plannedFixtures);const manifestEvidence=await manifestWriter.finish();budget.mark('complete');budget.check();write('proof.json',{evidenceLimits:{maxPages:Number(process.env.GEULGYEOL_QA_MAX_PAGES||0),maxStateFiles:Number(process.env.GEULGYEOL_QA_MAX_STATE_FILES||0),stateFiles:boundedStateWrites},gzipAuxiliaryJSONEvidence:gzipEvidence,manifestEvidence,rows,pairs,reopens,errors,fallbackComparisons,repairScopes,actualMacElectron:true,actualPackagedApp:Boolean(packaged),productionReadAliasesInjectedOnlyInQAProcess:Boolean(packaged),officialRuntimeVersion:'44.3.0',QAWindowBackgroundThrottlingDisabled:!packaged,receivedEngineSHA256,paintChecks,physicalBodyTolerancePx:2,QAReadExposuresForSelection:true,nativeResponsesControlled:true,OSChooserVerified:false,physicalIMEVerified:false,manualGUIVerified:false,clipboardAccessed:false,engineSHA256:sha(fs.readFileSync(path.join(engine,'rhwp_bg.wasm'))),appExitCode:p.exitCode,exitCode:p.exitCode});console.log(JSON.stringify({cases:rows.length,pairs,reopens}));
}catch(e){failure=String(e).slice(0,2048);await manifestWriter?.abort(new Error(failure));if(budget?.started){budget.mark('failed');write('failure.json',{failure,stack:String(e.stack).slice(0,8192),cases:rows.length,pairs,reopens,errorCount:errors.length,manifestComplete:false});}throw e;}
finally{if(p?.exitCode===null){control({id:'cleanup',quit:true,choice:'discard'});await until(()=>p.exitCode!==null,'cleanup normal quit');normalQuit=p.exitCode===0;}b?.disconnect();if(budget?.started)write('lifecycle.json',{exitCode:p?.exitCode,normalQuit,failure});}

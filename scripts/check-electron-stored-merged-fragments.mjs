// Actual Mac Electron stored partial-frame and merged-cell continuation QA.
// input events, dialogs, history, native saves and file reopens use product paths.
import puppeteer from '../rhwp-studio/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const root=path.resolve(import.meta.dirname,'..'),q=path.resolve(process.argv[2]),engine=path.resolve(process.argv[3]),baseline=process.argv[4]==='baseline';
const M=await import(pathToFileURL(path.join(engine,'rhwp.js')));M.initSync({module:fs.readFileSync(path.join(engine,'rhwp_bg.wasm'))});
const sha=b=>createHash('sha256').update(b).digest('hex'),write=(name,value)=>fs.writeFileSync(path.join(q,name),JSON.stringify(name.endsWith('-state.json')||/-undo\d\.json$|-redo\d\.json$/.test(name)?compact(value):value,null,2));
function compact(v){if(Array.isArray(v))return v.map(compact);if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,['hwp','hwpx'].includes(k)?{sha256:sha(Buffer.from(x)),bytes:x.length}:k==='svg'?x.map(s=>({sha256:sha(s),bytes:Buffer.byteLength(s)})):compact(x)]));return v;}
const control=value=>write('control.json',value),pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label){const end=Date.now()+65000;while(Date.now()<end){if(await fn())return;await pause(50);}throw Error('Timeout '+label);}
let p,b,page,frame,failure,caseMeta,normalQuit=false,receivedEngineSHA256;const errors=[],rows=[],manifest=[];let pairs=0,reopens=0;const paintChecks=[];const mixedReferences=new Map();
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
async function verifyPaint(label,v){const geometry=await paintGeometry();write(label+'-paint.json',geometry);paintChecks.push({label,pages:geometry.length,maxBorderOverflow:Math.max(...geometry.map(p=>p.maxBorder-p.bottom)),maxInkOverflow:Math.max(...geometry.map(p=>p.maxInk-p.bottom)),hidden:geometry.flatMap(p=>p.hidden).length,partial:geometry.flatMap(p=>p.partial).length});
 if(baseline)return;
 const lastTablePage=geometry.findLast(p=>p.tables.length),hosts=geometry.filter(p=>p.host.length);if(v.body[v.target.para].trim()&&v.props.vertRelTo==='Page'&&v.props.vertAlign==='Top'&&v.props.vertOffset===0&&!v.props.allowOverlap){assert(hosts.length,'trailing host preserved');assert(hosts.every(p=>p.page>=lastTablePage.page),'host after all table fragments');for(const p of hosts){for(const r of p.host)for(const t of p.tables)assert(r.y>=p.maxBorder-.2,'host below terminal painted border');for(const r of p.following)assert(r.y>=Math.max(...p.host.map(h=>h.y+h.h))-.2,'following body after host');}if(label.startsWith('budget-input.')&&label.endsWith('-initial'))assert(hosts[0].page>lastTablePage.page,'insufficient terminal budget moves first host line to a fresh page');}
 if(caseMeta?.declaredBeforePx!==undefined){
  if(hosts[0]?.page===lastTablePage.page){const actual=hosts[0].host[0].y-lastTablePage.maxBorder,expected=caseMeta.declaredBeforePx,outer=v.props.outerBottom*96/7200;assert(actual>=expected-.2&&actual<=expected+outer+.2,'paragraph before spacing once after frame: '+actual+' vs '+expected);}
  else if(caseMeta.missingHostLineSegments&&label.endsWith('-initial'))assert(Math.abs(hosts[0].host[0].y-hosts[0].top)<.2,'no saved leading spacing at fresh page top');
  for(const p of hosts.filter(p=>p.following.length)){const last=p.host.reduce((a,b)=>a.y>b.y?a:b),next=Math.min(...p.following.map(r=>r.y)),extra=last.h*(v.bodyFormats[v.target.para].props.lineSpacing/100-1),expected=last.h+extra+caseMeta.declaredAfterPx;assert(Math.abs(next-last.y-expected)<.3,'host line advance and paragraph after spacing exactly once: '+(next-last.y)+' vs '+expected);}
  if(caseMeta.label.endsWith('-fit')&&label.endsWith('-initial'))assert(hosts[0].page>lastTablePage.page,'before plus line does not fit terminal remainder');
 }
 for(const p of geometry){assert.deepEqual(p.borderOutside,[],'border within body page '+p.page);assert.deepEqual(p.inkOutside,[],'actual glyph ink within body page '+p.page);assert.deepEqual(p.hidden,[],'no text hidden by clip page '+p.page);assert.deepEqual(p.partial,[],'no glyph cut by clip page '+p.page);for(const c of p.clips)assert(c.y+c.height<=p.bottom+2,'clip within page body');}
 const visible={...v,rendered:geometry.map(p=>p.visibleText)};ownership(visible);
}
const history=()=>frame.evaluate(()=>({u:window.__inputHandler.history.undoStack.length,r:window.__inputHandler.history.redoStack.length,snapshotResources:[...window.__inputHandler.history.undoStack,...window.__inputHandler.history.redoStack].reduce((n,c)=>n+(c.snapshotResourceCount?.()||0),0)}));
const state=()=>frame.evaluate(()=>{
 const w=window.__wasm,d=w.doc,t=JSON.parse(d.getControls()).find(t=>t.ctrlId==='tbl'&&t.list===0);w.exportHwp();const dims=w.getTableDimensions(0,t.para,t.controlIndex),cells=Array.from({length:dims.cellCount},(_,i)=>({info:w.getCellInfo(0,t.para,t.controlIndex,i),needsTextSnapshot:typeof d.mergedCellNeedsTextSnapshot==='function'?d.mergedCellNeedsTextSnapshot(0,t.para,t.controlIndex,i):null,props:w.getCellProperties(0,t.para,t.controlIndex,i),paras:Array.from({length:w.getCellParagraphCount(0,t.para,t.controlIndex,i)},(_,cp)=>({text:d.getTextInCell(0,t.para,t.controlIndex,i,cp,0,10000),props:w.getCellParaPropertiesAt(0,t.para,t.controlIndex,i,cp),runs:JSON.parse(d.getCellCharFormatRunsByPath(0,t.para,JSON.stringify([{controlIndex:t.controlIndex,cellIndex:i,cellParaIndex:cp}]),0,[...d.getTextInCell(0,t.para,t.controlIndex,i,cp,0,10000)].length))}))})),svg=Array.from({length:w.pageCount},(_,i)=>w.renderPageSvg(i));
 const cellRendered=Array.from({length:w.pageCount},(_,page)=>JSON.parse(d.getPageTextLayout(page)).runs.filter(r=>r.cellPath).map(r=>({cell:r.cellIdx,para:r.cellParaIdx,text:r.text})));
 const rendered=svg.map(s=>[...new DOMParser().parseFromString(s,'image/svg+xml').querySelectorAll('text')].map(t=>t.textContent).join(''));
 return {target:t,dims,needsTextSnapshot:typeof d.bodyTableHostNeedsTextSnapshot==='function'?d.bodyTableHostNeedsTextSnapshot(0,t.para):null,pageDef:JSON.parse(d.getPageDef(0)),props:w.getTableProperties(0,t.para,t.controlIndex),cells,body:Array.from({length:d.getParagraphCount(0)},(_,i)=>d.getTextRange(0,i,0,100000)),styles:JSON.parse(d.getStyleList()),bodyFormats:Array.from({length:d.getParagraphCount(0)},(_,i)=>({props:JSON.parse(d.getParaPropertiesAt(0,i)),runs:JSON.parse(d.getCharFormatRuns(0,i,0,[...d.getTextRange(0,i,0,100000)].length))})),text:d.getTextFileText(),svg,rendered,cellRendered,pageCount:w.pageCount,hwp:Array.from(w.exportHwp()),hwpx:Array.from(w.exportHwpx())};
});
async function load(name){const generation=await frame.evaluate(()=>window.__wasm.documentGeneration);await frame.evaluate(()=>window.rhwpStudio.notifySaved());control({id:'open-'+name,openFile:name,choice:'discard'});await page.evaluate(()=>document.querySelector('#open').click());await until(()=>frame.evaluate(({name,generation})=>window.__wasm?.fileName===name&&window.__wasm.documentGeneration!==generation&&window.__inputHandler?.active&&!document.documentElement.classList.contains('rhwp-busy'),{name,generation}),'load '+name);await until(()=>page.evaluate(()=>!document.querySelector('#save').disabled),'host load settled');await settle();}
async function open(){await frame.evaluate(()=>{const h=window.__inputHandler,t=JSON.parse(window.__wasm.doc.getControls()).find(t=>t.ctrlId==='tbl'&&t.list===0);h.cursor.exitCellSelectionMode();h.cursor.exitCellMode?.();h.cursor.clearSelection();h.cursor.enterTableObjectSelectionDirect(0,t.para,t.controlIndex);h.renderTableObjectSelection();assertDispatch(h.dispatcher.dispatchWithResult('table:cell-props'));function assertDispatch(v){if(!v.ok)throw Error(JSON.stringify(v));}});await frame.waitForSelector('.tcp-dialog',{visible:true});}
async function close(confirm){await frame.evaluate(confirm=>{const d=document.querySelector('.tcp-dialog'),button=confirm?d.querySelector('.dialog-btn-primary'):[...d.querySelectorAll('.dialog-btn')].find(b=>b.textContent.trim()==='취소');button.click();},confirm);await frame.waitForSelector('.tcp-dialog',{hidden:true});await settle();}
async function edit(side,value){await frame.evaluate(({side,value})=>{const d=document.querySelector('.tcp-dialog');[...d.querySelectorAll('.dialog-tab')].find(b=>b.textContent.trim()==='여백/캡션').click();const input=[...d.querySelectorAll('.dialog-section-title')].find(t=>t.textContent.trim()==='바깥 여백').parentElement.querySelectorAll('input[type=number]')[side];input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));},{side,value});}
async function key(redo){await frame.evaluate(()=>window.__inputHandler.focus());await page.keyboard.down('Meta');if(redo)await page.keyboard.down('Shift');try{await page.keyboard.press('z');}finally{if(redo)await page.keyboard.up('Shift');await page.keyboard.up('Meta');}await settle();}
function comparable(v){const {hwp,hwpx,...rest}=v;return rest;}
async function saveAndReopen(label,expected){
 for(const ext of ['hwp','hwpx']){
  const payload=await state(),name=label+'.'+ext;control({id:'save-'+name,file:name});await page.select('#format',ext);await page.evaluate(()=>document.querySelector('#save').click());await until(()=>fs.existsSync(path.join(q,'files',name)),'native save');await until(()=>page.evaluate(()=>!document.querySelector('#save').disabled),'save settled');
  const bytes=fs.readFileSync(path.join(q,'files',name));assert.equal(sha(bytes),sha(Buffer.from(payload[ext])),'native save current export');await load(name);const actual=await state();
  if(sha(actual.svg.join(''))!==sha(expected.svg.join('')))write(name+'-save-svg-diff.json',{beforeSvg:expected.svg,actualSvg:actual.svg,expectedPageDef:expected.pageDef,actualPageDef:actual.pageDef,expectedProps:expected.props,actualProps:actual.props});assert.deepEqual(actual.svg,expected.svg,'complete saved SVG');assert.deepEqual(actual.pageDef,expected.pageDef,'source page budget preserved');assert.deepEqual(actual.body,expected.body);assert.deepEqual(actual.bodyFormats,expected.bodyFormats,'body paragraph and character styles after reopen');assert.deepEqual(actual.cells,expected.cells,'all cell formatting and character IDs after reopening');assert.deepEqual(actual.styles,expected.styles);assert.deepEqual(actual.pageCount,expected.pageCount);ownership(actual);await verifyPaint(name,actual);
  manifest.push({file:path.join(q,'files',name),svg:actual.svg,pageCount:actual.pageCount,pageDef:actual.pageDef,body:actual.body,bodyFormats:actual.bodyFormats,text:actual.text,cells:actual.cells,props:actual.props,styles:actual.styles});reopens++;
 }
}
function ownership(v){
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
  {name:'tab-last-row',run:async()=>{if(f.mixedAppendLastCell)await selectCell(before.cells.length-1,Math.floor((before.cells.at(-1).paras.length-1)/2));await page.keyboard.press('Tab');}},
  {name:'new-row-text',run:()=>page.keyboard.sendCharacter('TAIL🙂')},
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

async function selectCell(cell,para,charOffset=0){return frame.evaluate(({cell,para,charOffset})=>{const h=window.__inputHandler,w=window.__wasm,t=JSON.parse(w.doc.getControls()).find(t=>t.ctrlId==='tbl'&&t.list===0);h.cursor.exitCellSelectionMode();h.cursor.exitCellMode?.();h.cursor.clearSelection();h.cursor.moveTo({sectionIndex:0,paragraphIndex:para,parentParaIndex:t.para,controlIndex:t.controlIndex,cellIndex:cell,cellParaIndex:para,cellPath:[{controlIndex:t.controlIndex,cellIndex:cell,cellParaIndex:para}],charOffset});h.updateCaret();h.focus();return {position:h.cursor.getPosition(),rect:h.cursor.getRect()};},{cell,para,charOffset});}
async function type(cell,para,text,charOffset=0){const before=await selectCell(cell,para,charOffset);assert(before.rect,'cell caret');await page.keyboard.sendCharacter(text);await settle();return before;}
async function cellKey(cell,para,key,shift=false){const caret=await selectCell(cell,para);if(shift)await page.keyboard.down('Shift');try{await page.keyboard.press(key);}finally{if(shift)await page.keyboard.up('Shift');}await settle();return caret;}
async function typeHost(){await frame.evaluate(()=>{const h=window.__inputHandler,w=window.__wasm,t=JSON.parse(w.doc.getControls()).find(t=>t.ctrlId==='tbl'&&t.list===0);h.cursor.exitCellSelectionMode();h.cursor.exitCellMode?.();h.cursor.clearSelection();h.cursor.moveTo({sectionIndex:0,paragraphIndex:t.para,charOffset:w.doc.getParagraphLength(0,t.para)});h.updateCaret();h.focus();});await page.keyboard.sendCharacter('HOST_EDIT🙂');await settle();}
async function prepareReplace(query,text,all){await frame.evaluate(()=>window.__inputHandler.dispatcher.dispatchWithResult('edit:find-replace'));await frame.waitForSelector('.find-dialog-input',{visible:true});await frame.evaluate(({query,text,all})=>{const es=document.querySelectorAll('.find-dialog-input');es[0].value=query;es[1].value=text;if(!all)[...document.querySelectorAll('.find-dialog-buttons button')].find(b=>b.textContent.trim()==='다음 찾기').click();},{query,text,all});await settle();}
async function replace(all){await frame.evaluate(all=>{[...document.querySelectorAll('.find-dialog-buttons button')].find(b=>b.textContent.trim()===(all?'모두 바꾸기':'바꾸기')).click();document.querySelector('.find-dialog .dialog-close').click();},all);await settle();}

async function height(cell,mm){await selectCell(cell,0);await frame.evaluate(()=>window.__inputHandler.dispatcher.dispatchWithResult('table:cell-props'));await frame.waitForSelector('.tcp-dialog',{visible:true});await frame.evaluate(mm=>{const d=document.querySelector('.tcp-dialog');[...d.querySelectorAll('.dialog-tab')].find(t=>t.textContent.trim()==='셀').click();const title=[...d.querySelectorAll('.dialog-section-title')].find(t=>t.textContent.trim()==='셀 크기');const section=title.parentElement,check=section.querySelector('input[type=checkbox]');if(!check.checked)check.click();const es=section.querySelectorAll('input[type=number]');if(mm!==null)es[1].value=String(mm);es[1].dispatchEvent(new Event('input',{bubbles:true}));es[1].dispatchEvent(new Event('change',{bubbles:true}));},mm);await close(true);}
try{
 assert.equal(process.platform,'darwin');assert(!fs.existsSync(path.join(q,'audit.jsonl')),'fresh run');const cases=[];
 const seedRows=JSON.parse(fs.readFileSync(process.env.GEULGYEOL_HOST_SEEDS||path.resolve(root,'../table-host-spacing-qa/seeds.json')));
 for(const seed of seedRows){for(const ext of ['hwpx','hwp']){const name=seed.label+'-input.'+ext;fs.copyFileSync(path.resolve(root,seed.files[ext]),path.join(q,'files',name));cases.push({...seed,name,ext});}}
 control({id:'startup',canceled:true});const env={...process.env,GEULGYEOL_QA_DIR:q,GEULGYEOL_PROFILE_ROOT:path.join(q,'profile'),GEULGYEOL_ELECTRON_MODULE:'electron'};delete env.ELECTRON_RUN_AS_NODE;
 p=spawn(path.join(root,'desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),[path.join(q,'bootstrap.cjs'),'--remote-debugging-port=0','--remote-debugging-address=127.0.0.1','--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows'],{env});let log='';for(const s of [p.stdout,p.stderr])s.on('data',d=>{log+=d;fs.appendFileSync(path.join(q,'launch.log'),d);});
 await until(()=>/DevTools listening on (ws:\/\/\S+)/.test(log),'renderer endpoint');b=await puppeteer.connect({browserWSEndpoint:log.match(/DevTools listening on (ws:\/\/\S+)/)[1],defaultViewport:null});await until(async()=>{page=(await b.pages()).find(p=>/^http:\/\/127\.0\.0\.1:\d+\/$/.test(p.url()));frame=page?.frames().find(f=>f.url().includes('/studio/'));return frame;},'app');page.on('pageerror',e=>errors.push(String(e)));await page.waitForFunction(()=>!document.querySelector('#save').disabled,{timeout:30000});const asset=fs.readdirSync(path.join(q,'runtime/web/studio/assets')).find(n=>/^rhwp_bg-.*\.wasm$/.test(n));receivedEngineSHA256=sha(Buffer.from(await(await fetch(new URL('/studio/assets/'+asset,page.url()))).arrayBuffer()));assert.equal(receivedEngineSHA256,sha(fs.readFileSync(path.join(engine,'rhwp_bg.wasm'))));
 for(const f of cases.filter(f=>!process.env.GEULGYEOL_FRAGMENT_CASE||f.name===process.env.GEULGYEOL_FRAGMENT_CASE)){
  caseMeta=f;await load(f.name);const initial=await state();write(f.name+'-initial-state.json',initial);assert(initial.pageCount>=1);await verifyPaint(f.name+'-initial',initial);
  const positions=await frame.evaluate(()=>{const w=window.__wasm,d=w.doc,t=JSON.parse(d.getControls()).find(t=>t.ctrlId==='tbl'&&t.list===0),dim=w.getTableDimensions(0,t.para,t.controlIndex),out=[];for(let cell=0;cell<dim.cellCount;cell++)for(let para=0;para<w.getCellParagraphCount(0,t.para,t.controlIndex,cell);para++){const r=w.getCursorRectInCell(0,t.para,t.controlIndex,cell,para,0);if(r)out.push({cell,para,page:r.pageIndex});}const last=Math.max(...out.map(p=>p.page));return [out.find(p=>p.page===0)||out[0],last===0?out[Math.floor(out.length/2)]:out.find(p=>p.page===Math.floor(last/2)&&p.cell!==0)||out[Math.floor(out.length/2)],out.findLast(p=>p.page===last)];});assert(positions.every(Boolean));write(f.name+'-fragments.json',{positions,pageCount:initial.pageCount});
  const ops=positions.map((p,i)=>({name:'input-'+i,run:()=>type(p.cell,p.para,'EDIT'+i+'🙂'),kind:'input',target:p}));
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
  if(!baseline&&f.label!=='numbered')ops.push({name:'host-input',kind:'host-input',run:()=>typeHost()});
  ops.push({name:'replace-one',kind:'replace',prepare:()=>prepareReplace(f.query||'ROW024','SINGLE🙂',false),run:()=>replace(false)});
  ops.push({name:'replace-all',kind:'replace',prepare:()=>prepareReplace(f.allQuery||'ROW','T',true),run:()=>replace(true)});
  ops.push({name:'size-noop',kind:'noop',run:()=>height(positions[1].cell,null)});
  if(f.label!=='numbered')for(const mm of [30,2])ops.push({name:'height-'+mm,kind:'height',run:()=>height(positions[1].cell,mm)});
  for(const op of ops.filter(op=>(!f.operations||f.operations.includes(op.name))&&(!process.env.GEULGYEOL_FRAGMENT_OPERATION||op.name===process.env.GEULGYEOL_FRAGMENT_OPERATION))){await load(f.name);if(op.name==='height-2')await height(positions[1].cell,30);if(op.target)await selectCell(op.target.cell,op.target.para,op.target.charOffset??0);else if(op.kind==='height'||op.kind==='noop')await selectCell(positions[1].cell,0);if(op.prepare)await op.prepare();const before=await state(),hist=await history();if(op.kind==='sequence'){await mixedTextHistory(f,op,before,hist);continue;}const caret=await op.run();const after=await state();write(f.name+'-'+op.name+'-state.json',{before,after,caret});if(op.kind==='noop'||op.kind==='navigation'){assert.deepEqual(comparable(after),comparable(before));assert.deepEqual(await history(),hist);ownership(after);if(op.kind==='navigation'){const cursor=await frame.evaluate(()=>window.__inputHandler.cursor.getPosition());assert.equal(cursor.cellIndex,1,'Tab navigates into next cell without text or history mutation');}rows.push({label:f.label,ext:f.ext,operation:op.name,noChange:true});console.log('PASS '+f.name+' '+op.name);continue;}if(op.kind==='row-insert'){
    assert.equal(after.dims.rowCount,before.dims.rowCount+1,'last-cell Tab adds one row');assert.equal(after.dims.colCount,before.dims.colCount);assert.deepEqual(after.cells.slice(0,before.cells.length).map(c=>c.paras),before.cells.map(c=>c.paras),'Tab preserves all original cell text and styles');assert.deepEqual(after.body,before.body);
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
   for(let n=0;n<2;n++){await key(false);const undo=await state();write(f.name+'-'+op.name+'-undo'+n+'.json',undo);if(sha(undo.svg.join(''))!==sha(before.svg.join('')))write(f.name+'-'+op.name+'-undo-svg-diff.json',{beforeSvg:before.svg,actualSvg:undo.svg,geometry:await paintGeometry()});assert.deepEqual(comparable(undo),comparable(before),'exact undo including clips/cuts/complete SVG');await key(true);const redo=await state();write(f.name+'-'+op.name+'-redo'+n+'.json',redo);assert.deepEqual(comparable(redo),comparable(after),'exact redo including clips/cuts/complete SVG');pairs++;}
   // Skip numbered ownership tokens only when replacement changed them.
   await saveAndReopen(f.label+'-'+f.ext+'-'+op.name,after);rows.push({label:f.label,ext:f.ext,operation:op.name,beforePages:before.pageCount,afterPages:after.pageCount,target:op.target,caret,historyPairs:2,historyAfter:await history()});console.log('PASS '+f.name+' '+op.name);
  }
 }
 assert.deepEqual(errors,[]);await page.screenshot({path:path.join(q,'electron.png')});control({id:'normal-quit',quit:true,choice:'discard'});await until(()=>p.exitCode!==null,'normal application exit');assert.equal(p.exitCode,0);normalQuit=true;
 const manifestPath=path.join(q,'manifest.json');fs.writeFileSync(manifestPath,'[');for(const [i,row]of manifest.entries())fs.appendFileSync(manifestPath,(i?',':'')+JSON.stringify(row));fs.appendFileSync(manifestPath,']');write('proof.json',{rows,pairs,reopens,errors,actualMacElectron:true,officialRuntimeVersion:'44.3.0',QAWindowBackgroundThrottlingDisabled:true,receivedEngineSHA256,paintChecks,physicalBodyTolerancePx:2,QAReadExposuresForSelection:true,nativeResponsesControlled:true,OSChooserVerified:false,physicalIMEVerified:false,manualGUIVerified:false,clipboardAccessed:false,engineSHA256:sha(fs.readFileSync(path.join(engine,'rhwp_bg.wasm'))),appExitCode:p.exitCode,exitCode:p.exitCode});console.log(JSON.stringify({cases:rows.length,pairs,reopens}));
}catch(e){failure=String(e);if(page&&frame&&p?.exitCode===null){await Promise.allSettled([page.evaluate(()=>({busy:document.querySelector('#save')?.disabled,status:document.querySelector('#status')?.textContent,error:document.querySelector('#error-text')?.textContent})).then(v=>write('host-failure-state.json',v)),frame.evaluate(()=>({filename:window.__wasm?.fileName,generation:window.__wasm?.documentGeneration,active:window.__inputHandler?.active,visibility:document.visibilityState,busy:document.documentElement.classList.contains('rhwp-busy')})).then(v=>write('frame-failure-state.json',v))]);}write('failure.json',{failure,stack:e.stack,rows,pairs,reopens,errors});throw e;}
finally{if(p?.exitCode===null){control({id:'cleanup',quit:true,choice:'discard'});await until(()=>p.exitCode!==null,'cleanup normal quit');normalQuit=p.exitCode===0;}b?.disconnect();write('lifecycle.json',{exitCode:p?.exitCode,normalQuit,failure});}

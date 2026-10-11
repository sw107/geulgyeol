// Memory-only replay of the observed right-cell intermediate wrap difference.
// BASE_PKG CURRENT_PKG SEEDS ELECTRON_RUN_ROOT FRESH_PHASE
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import {pathToFileURL} from 'node:url';import {gunzipSync} from 'node:zlib';import {EvidenceBudget} from './qa-evidence-budget.mjs';
const [base,current,seedsFile,appRoot,out]=process.argv.slice(2).map(p=>path.resolve(p));assert(!fs.existsSync(out));fs.mkdirSync(out);
const budget=new EvidenceBudget({root:process.env.GEULGYEOL_QA_BUDGET_ROOT,phase:out});budget.begin({normalForecastBytes:1048576,failureForecastBytes:16384});
const sha=b=>createHash('sha256').update(b).digest('hex'),pins=new Map(),read=p=>{const b=fs.readFileSync(p);pins.set(p,sha(b));return b;},json=p=>JSON.parse(gunzipSync(read(p)));
const sourceSHA256=sha(read(path.resolve(import.meta.filename))),seed=JSON.parse(read(seedsFile))[0],rows=[],modules=[];
function capture(d){
 d.exportHwp();const t=JSON.parse(d.getControls()).find(t=>t.ctrlId==='tbl'&&t.list===0),dim=JSON.parse(d.getTableDimensions(0,t.para,t.controlIndex));
 const cells=Array.from({length:dim.cellCount},(_,i)=>({info:JSON.parse(d.getCellInfo(0,t.para,t.controlIndex,i)),props:JSON.parse(d.getCellProperties(0,t.para,t.controlIndex,i)),paras:Array.from({length:d.getCellParagraphCount(0,t.para,t.controlIndex,i)},(_,p)=>{const text=d.getTextInCell(0,t.para,t.controlIndex,i,p,0,10000);return {text,props:JSON.parse(d.getCellParaPropertiesAt(0,t.para,t.controlIndex,i,p)),runs:JSON.parse(d.getCellCharFormatRunsByPath(0,t.para,JSON.stringify([{controlIndex:t.controlIndex,cellIndex:i,cellParaIndex:p}]),0,[...text].length)),charProperties:Array.from({length:[...text].length},(_,offset)=>JSON.parse(d.getCellCharPropertiesAt(0,t.para,t.controlIndex,i,p,offset)))};})}));
 const svg=Array.from({length:d.pageCount()},(_,p)=>sha(d.renderPageSvg(p))),cellRendered=Array.from({length:d.pageCount()},(_,p)=>JSON.parse(d.getPageTextLayout(p)).runs.filter(r=>r.cellPath).map(r=>({cell:r.cellIdx,para:r.cellParaIdx,text:r.text})));
 return {dim,props:JSON.parse(d.getTableProperties(0,t.para,t.controlIndex)),pageDef:JSON.parse(d.getPageDef(0)),styles:JSON.parse(d.getStyleList()),body:Array.from({length:d.getParagraphCount(0)},(_,p)=>d.getTextRange(0,p,0,100000)),cells,svg,cellRendered};
}
try{
 for(const pkg of [base,current]){const m=await import(pathToFileURL(path.join(pkg,'rhwp.js')));m.initSync({module:read(path.join(pkg,'rhwp_bg.wasm'))});modules.push(m);}
 const states=[];
 for(const [engine,m]of modules.entries()){
  const formats=[];
  for(const ext of ['hwp','hwpx']){
   const d=new m.HwpDocument(read(seed.files[ext]));d.setClipEnabled(false);d.setShowControlCodes(false);d.setShowParagraphMarks(false);try{
    const t=JSON.parse(d.getControls()).find(t=>t.ctrlId==='tbl'&&t.list===0),args=[0,t.para,t.controlIndex,40,0],sequence=[capture(d)];
    const edits=[()=>d.insertTextInCell(...args,0,'SEQ🙂'),()=>d.insertTextInCell(...args,4,'\n'),()=>d.deleteTextInCell(...args,5,1),()=>d.deleteTextInCell(...args,4,1),()=>d.splitParagraphInCellWithNextStyle(...args,4),()=>d.insertTextInCell(0,t.para,t.controlIndex,40,1,0,'TAIL🙂')];
    for(const edit of edits){budget.check();edit();sequence.push(capture(d));}
    const phase=path.join(appRoot,ext+'-mixed'),prefix='partial-unequal-right-input.'+ext;
    for(let i=0;i<sequence.length;i++){
     const actual=json(path.join(phase,prefix+(i===0?'-initial-state.json.gz':'-mixed-text-history-mixed-step-'+(i-1)+'-state.json.gz'))),expected=i===0?actual:actual.after;
     assert.deepEqual(sequence[i].svg,expected.svg.map(s=>s.sha256),'memory full SVG equals actual Electron '+engine+'/'+ext+'/'+i);
     assert.deepEqual(sequence[i].cellRendered,expected.cellRendered,'memory run ownership equals Electron');
     assert.deepEqual(sequence[i].cells.map(c=>c.paras.map(p=>p.text)),expected.cells.map(c=>c.paras.map(p=>p.text)),'memory text equals Electron');
    }
    rows.push({engine:engine===0?'before':'current',format:ext,stages:sequence.map((s,i)=>({stage:i,fullModelAndCharPropertiesSHA256:sha(JSON.stringify(s)),svg:s.svg,actualElectronFullSVGEqual:true}))});formats.push(sequence);
   }finally{d.free();}
  }states.push(formats);
 }
 for(let format=0;format<2;format++)assert.deepEqual(states[0][format],states[1][format],'old/current full model and every character property exact');
 const crossFormat=states.map((formats,engine)=>formats[0].map((a,stage)=>{const b=formats[1][stage],differentPages=a.svg.flatMap((s,i)=>s===b.svg[i]?[]:[i]);const {svg:as,cellRendered:ar,...am}=a,{svg:bs,cellRendered:br,...bm}=b;assert.deepEqual(am,bm,'cross-format full logical model and character properties');return {engine:engine===0?'before':'current',stage,differentPages,fullLogicalModelAndCharPropertiesEqual:true};})).flat();
 assert(pins.size>0&&[...pins].every(([p,h])=>sha(fs.readFileSync(p))===h));const proof={sourceSHA256,mode:'memory-only exact replay; no additional Electron or Native run',viewOptions:{clipEnabled:false,showControlCodes:false,showParagraphMarks:false},oldCurrentFullModelAndCharPropertiesExact:true,actualElectronFullSVGMatchedAtAllStages:true,crossFormat,rows,inputSHA256:Object.fromEntries(pins)};
 const bytes=JSON.stringify(proof,null,2)+'\n';budget.check({normalForecastBytes:Buffer.byteLength(bytes)});fs.writeFileSync(path.join(out,'proof.json'),bytes,{flag:'wx'});budget.mark('complete');console.log(JSON.stringify({oldCurrentFullModelAndCharPropertiesExact:true,actualElectronFullSVGMatchedAtAllStages:true,crossFormat}));
}catch(e){fs.writeFileSync(path.join(out,'failure.json'),JSON.stringify({failure:String(e).slice(0,2048),completedRows:rows.length})+'\n',{flag:'wx'});budget.mark('failed');throw e;}

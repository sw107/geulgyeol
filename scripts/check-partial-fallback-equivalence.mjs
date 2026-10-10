// Read-only full SVG/model comparison on the exact same excluded source bytes.
// Usage: BASELINE_PKG CURRENT_PKG SEEDS_JSON FRESH_PROOF_DIR
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';import {createHash} from 'node:crypto';import {EvidenceBudget} from './qa-evidence-budget.mjs';
const [baseArg,currentArg,seedsArg,outArg]=process.argv.slice(2),base=path.resolve(baseArg),current=path.resolve(currentArg),out=path.resolve(outArg);
assert(!fs.existsSync(out));fs.mkdirSync(out);const budget=new EvidenceBudget({root:process.env.GEULGYEOL_QA_BUDGET_ROOT,phase:out});budget.begin({normalForecastBytes:1048576,failureForecastBytes:16384});
const sha=b=>createHash('sha256').update(b).digest('hex'),modules=[];
for(const pkg of [base,current]){const m=await import(pathToFileURL(path.join(pkg,'rhwp.js')));m.initSync({module:fs.readFileSync(path.join(pkg,'rhwp_bg.wasm'))});modules.push(m);}
const seeds=JSON.parse(fs.readFileSync(seedsArg)),rows=[],inputPins=new Map(),enginePins=[base,current].map(pkg=>sha(fs.readFileSync(path.join(pkg,'rhwp_bg.wasm'))));
function state(d){const t=JSON.parse(d.getControls()).find(t=>t.ctrlId==='tbl'&&t.list===0),dim=JSON.parse(d.getTableDimensions(0,t.para,t.controlIndex));return {target:t,dimensions:dim,props:JSON.parse(d.getTableProperties(0,t.para,t.controlIndex)),cells:Array.from({length:dim.cellCount},(_,i)=>({info:JSON.parse(d.getCellInfo(0,t.para,t.controlIndex,i)),props:JSON.parse(d.getCellProperties(0,t.para,t.controlIndex,i)),paragraphs:Array.from({length:d.getCellParagraphCount(0,t.para,t.controlIndex,i)},(_,p)=>({text:d.getTextInCell(0,t.para,t.controlIndex,i,p,0,100000),props:JSON.parse(d.getCellParaPropertiesAt(0,t.para,t.controlIndex,i,p))}))})),body:Array.from({length:d.getParagraphCount(0)},(_,p)=>d.getTextRange(0,p,0,100000)),styles:JSON.parse(d.getStyleList()),pageDef:JSON.parse(d.getPageDef(0)),svg:Array.from({length:d.pageCount()},(_,p)=>sha(d.renderPageSvg(p)))};}
try{for(const seed of seeds)for(const ext of ['hwp','hwpx']){
 budget.check();const file=seed.files[ext],bytes=fs.readFileSync(file),pin=sha(bytes);inputPins.set(file,pin);const docs=modules.map(m=>new m.HwpDocument(bytes));
 try{const states=docs.map(state);assert.deepEqual(states[1],states[0],'excluded '+seed.label+' '+ext+' baseline model/full SVG exact');
 const t=states[1].target;for(const d of docs)assert(Array.from({length:states[1].dimensions.cellCount},(_,i)=>i).every(i=>!d.mergedCellNeedsTextSnapshot(0,t.para,t.controlIndex,i)),'excluded scope required on both engines');
 for(const d of docs)assert.deepEqual(state(d),states[0],'baseline queries read only');
 rows.push({label:seed.label,format:ext,sourceSHA256:pin,modelAndSVGExact:true,readOnly:true,pages:states[0].svg.length,svgSHA256:states[0].svg,stateSHA256:sha(JSON.stringify(states[0]))});
 }finally{for(const d of docs)d.free();}
 }
 assert([...inputPins].every(([file,pin])=>sha(fs.readFileSync(file))===pin));assert.deepEqual([base,current].map(pkg=>sha(fs.readFileSync(path.join(pkg,'rhwp_bg.wasm')))),enginePins);
 fs.writeFileSync(path.join(out,'proof.json'),JSON.stringify({baselineEngineSHA256:enginePins[0],currentEngineSHA256:enginePins[1],inputFilesUnchanged:true,engineFilesUnchanged:true,cases:rows.length,rows},null,2)+'\n',{flag:'wx'});budget.mark('complete');console.log(JSON.stringify({cases:rows.length,fullSVGAndModelExact:true}));
}catch(e){fs.writeFileSync(path.join(out,'failure.json'),JSON.stringify({error:String(e),stack:e.stack,completedCases:rows.length})+'\n',{flag:'wx'});budget.mark('failed');throw e;}

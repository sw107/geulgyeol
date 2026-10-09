// Read-only query and predicate exclusions for a source-preserving text history.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import{pathToFileURL}from'node:url';import{createHash}from'node:crypto';
const[pkgArg,seedsArg,outArg]=process.argv.slice(2),pkg=path.resolve(pkgArg),out=path.resolve(outArg);assert(!fs.existsSync(out),'fresh output');fs.mkdirSync(out,{recursive:true});const M=await import(pathToFileURL(path.join(pkg,'rhwp.js')));M.initSync({module:fs.readFileSync(path.join(pkg,'rhwp_bg.wasm'))});const sha=b=>createHash('sha256').update(b).digest('hex'),rows=[];
for(const seed of JSON.parse(fs.readFileSync(seedsArg)))for(const ext of['hwp','hwpx']){
 const d=new M.HwpDocument(fs.readFileSync(seed.files[ext])),t=JSON.parse(d.getControls()).find(t=>t.ctrlId==='tbl'&&t.list===0),dim=JSON.parse(d.getTableDimensions(0,t.para,t.controlIndex));
 const before=[sha(d.exportHwp()),sha(d.exportHwpx()),Array.from({length:d.pageCount()},(_,i)=>sha(d.renderPageSvg(i)))];
 const eligible=Array.from({length:dim.cellCount},(_,i)=>d.mergedCellNeedsTextSnapshot(0,t.para,t.controlIndex,i));
 assert.deepEqual([sha(d.exportHwp()),sha(d.exportHwpx()),Array.from({length:d.pageCount()},(_,i)=>sha(d.renderPageSvg(i)))],before,'query leaves source exports and complete SVG unchanged');
 assert.equal(eligible.filter(Boolean).length,seed.label==='partial-long-rowspan'?1:0,'bounded route only for page-larger pure merged source owner');
 rows.push({label:seed.label,ext,eligibleCells:eligible.flatMap((yes,i)=>yes?[i]:[]),readOnly:true});d.free();
}
for(const wrap of['Square','BehindText','InFrontOfText']){
 const seed=JSON.parse(fs.readFileSync(seedsArg)).find(s=>s.label==='partial-long-rowspan'),d=new M.HwpDocument(fs.readFileSync(seed.files.hwp)),t=JSON.parse(d.getControls()).find(t=>t.ctrlId==='tbl'&&t.list===0);d.setTableProperties(0,t.para,t.controlIndex,JSON.stringify({textWrap:wrap}));assert.equal(d.mergedCellNeedsTextSnapshot(0,t.para,t.controlIndex,1),false,'other wrap contract excluded');rows.push({excludedWrap:wrap,needsTextSnapshot:false});d.free();
}
const proof={cases:rows.length,engineSHA256:sha(fs.readFileSync(path.join(pkg,'rhwp_bg.wasm'))),rows};fs.writeFileSync(path.join(out,'proof.json'),JSON.stringify(proof,null,2));console.log(JSON.stringify({cases:rows.length}));

// Reproduce the completed-cut FP boundary from the verified synthetic 48x2 left-owner fixture.
// Usage: node scripts/prepare-mixed-owner-completion.mjs OLD_WASM_PKG SOURCE_HWP FRESH_OUTPUT_DIR
import fs from'node:fs';import path from'node:path';import assert from'node:assert/strict';import{pathToFileURL}from'node:url';
const[pkgArg,sourceArg,outArg]=process.argv.slice(2),pkg=path.resolve(pkgArg),out=path.resolve(outArg);assert(!fs.existsSync(out));fs.mkdirSync(out,{recursive:true});
const M=await import(pathToFileURL(path.join(pkg,'rhwp.js')));M.initSync({module:fs.readFileSync(path.join(pkg,'rhwp_bg.wasm'))});const seeds=[];
for(const offset of[-10,-8,-7,-1,0,1,7,8,10]){
 const d=new M.HwpDocument(fs.readFileSync(sourceArg)),t=JSON.parse(d.getControls()).find(t=>t.ctrlId==='tbl'&&t.list===0),dim=JSON.parse(d.getTableDimensions(0,t.para,t.controlIndex));assert.equal(dim.rowCount,48);assert.equal(dim.colCount,2);assert.equal(dim.cellCount,50);assert.equal(JSON.parse(d.getCellInfo(0,t.para,t.controlIndex,2)).rowSpan,47);
 const n=d.getCellParagraphCount(0,t.para,t.controlIndex,2),last=d.getTextInCell(0,t.para,t.controlIndex,2,n-1,0,100000);assert.equal(n,47);d.deleteRangeInCell(0,t.para,t.controlIndex,2,0,0,n-1,[...last].length);d.insertTextInCell(0,t.para,t.controlIndex,2,0,0,'BOUNDARY_ROW024_'+'가'.repeat(1909));
 const def=JSON.parse(d.getPageDef(0));d.setPageDef(0,JSON.stringify({...def,marginBottom:5850+offset}));
 const label='completion-'+(offset<0?'under':offset>0?'over':'exact')+'-'+Math.abs(offset),files={};for(const ext of['hwp','hwpx']){files[ext]=path.join(out,label+'.'+ext);fs.writeFileSync(files[ext],ext==='hwp'?d.exportHwp():d.exportHwpx());}
 seeds.push({label,files,operations:['size-noop'],query:'ROW024',declaredBeforePx:10,declaredAfterPx:5,sourcePartialFrame:true,mergedOwners:true,snapshotEligibleOwners:Array.from({length:48},(_,i)=>i+2),assertNoEmptyTableFragment:true,verifyUnchangedSaveReopen:true,expectedTablePages:offset>7?11:10,boundary:{marginBottom:5850+offset,residualMinusBudgetPx:offset/75,existingCapacityEpsilonPx:.1}});d.free();
}
fs.writeFileSync(path.join(out,'seeds.json'),JSON.stringify(seeds,null,2)+'\n');console.log(JSON.stringify({groups:seeds.length,cases:seeds.length*2}));

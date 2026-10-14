// Supplemental real-WASM render/save checks; native app QA is recorded separately.
// Usage: node ... ENGINE_PKG FIXTURE_DIR FRESH_OUTPUT [BASELINE_PKG]
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {pathToFileURL} from 'node:url';import {createHash} from 'node:crypto';
const [pkg,fixtures,output,baseline]=process.argv.slice(2),out=path.resolve(output);assert(pkg&&fixtures&&!fs.existsSync(out));fs.mkdirSync(out,{recursive:true});
const sha=b=>createHash('sha256').update(b).digest('hex');
async function engine(dir){const M=await import(pathToFileURL(path.resolve(dir,'rhwp.js')));M.initSync({module:fs.readFileSync(path.resolve(dir,'rhwp_bg.wasm'))});return M;}
const M=await engine(pkg),B=baseline?await engine(baseline):null;
const text=d=>Array.from({length:d.getParagraphCount(0)},(_,p)=>d.getTextRange(0,p,0,100000));
function positions(d){const pages=Array.from({length:d.pageCount()},(_,p)=>JSON.parse(d.getPageTextLayout(p)).runs);return Array.from({length:4},(_,p)=>{const body=pages.flatMap((r,page)=>r.map(r=>({...r,page}))).filter(r=>r.paraIdx===p&&Number.isInteger(r.charStart)&&r.text);const first=body.find(r=>r.charStart===0),next=body.find(r=>r.page!==first.page||r.y!==first.y);assert(first&&next);return {p,firstX:first.x,continuationX:next.x,pageCount:d.pageCount()};});}
function check(rows){const x=(p,k)=>rows[p][k],near=(a,b)=>assert(Math.abs(a-b)<.11,`${a} != ${b}`);near(x(0,'continuationX'),x(1,'continuationX'));near(x(0,'firstX'),x(2,'firstX'));near(x(1,'firstX'),x(3,'firstX'));near(x(2,'firstX'),x(2,'continuationX'));near(x(3,'firstX'),x(3,'continuationX'));assert(x(0,'firstX')>x(0,'continuationX'));assert(x(1,'firstX')>x(0,'firstX')+1);}
const proof=[];let reopens=0;
for(const name of ['decimal','multilevel']){const input=fs.readFileSync(path.join(fixtures,name+'.hwpx'));let d=new M.HwpDocument(input);try{const expectedText=text(d),rows=positions(d);check(rows);let baselineRows=null;if(B){const b=new B.HwpDocument(input);try{baselineRows=positions(b);assert.throws(()=>check(baselineRows));}finally{b.free();}}
 const stages=[];for(const [i,ext] of ['Hwpx','Hwp','Hwpx','Hwp','Hwpx'].entries()){const report=d['export'+ext+'WithReport']();let bytes;try{assert.equal(JSON.parse(report.contentLoss()).count,0);bytes=report.takeBytes();}finally{report.free();}fs.writeFileSync(path.join(out,name+'-'+i+'.'+ext.toLowerCase()),bytes);d.free();d=new M.HwpDocument(bytes);assert.deepEqual(text(d),expectedText);check(positions(d));assert.deepEqual(positions(d),rows);reopens++;stages.push({ext,sha256:sha(bytes)});}proof.push({name,rows,baselineRows,stages});
}finally{d.free();}}
// Exercise continuation fragments on later pages, beyond the single-page oracle.
{const d=new M.HwpDocument(fs.readFileSync(path.join(fixtures,'decimal.hwpx')));try{
 for(let p=0;p<4;p++)d.insertText(0,p,Array.from(d.getTextRange(0,p,0,100000)).length,('\n'+('가나다라마바사 '.repeat(5))).repeat(80));
 d.splitParagraph(0,3,Array.from(d.getTextRange(0,3,0,100000)).length);d.insertText(0,4,0,'AFTER');
 assert(d.pageCount()>4);const rows=positions(d);check(rows);
 const pages=Array.from({length:d.pageCount()},(_,page)=>JSON.parse(d.getPageTextLayout(page)).runs.map(r=>({...r,page}))).flat();
 const markers=pages.filter(r=>!Number.isInteger(r.charStart)&&/^\d+\.$/.test(r.text)).map(r=>r.text);assert.deepEqual(markers,['123.','123.','123.','123.','124.']);
 let laterPageLines=0;for(let p=0;p<4;p++){const runs=pages.filter(r=>r.paraIdx===p&&Number.isInteger(r.charStart)&&r.text),first=runs.find(r=>r.charStart===0),lines=new Map();
  for(const r of runs){const key=r.page+':'+r.y,old=lines.get(key);if(!old||r.charStart<old.charStart)lines.set(key,r);}
  for(const r of lines.values()){if(r.page===first.page)continue;assert(Math.abs(r.x-rows[p].continuationX)<.11,JSON.stringify({p,first,expectedX:rows[p].continuationX,actual:r}));laterPageLines++;}
 }
 fs.writeFileSync(path.join(out,'paginated-decimal.hwpx'),d.exportHwpx());
 assert(laterPageLines>20);proof.push({name:'paginated-hard-break-continuations',pageCount:d.pageCount(),laterPageLines,headCombinations:[0,4,8,12],nativeAppUI:false});
}finally{d.free();}}
// Nonnumbered paragraphs retain their exact SVG, including wrapping/alignment.
if(B){const control=new B.HwpDocument(fs.readFileSync(path.join(fixtures,'decimal.hwpx')));let bytes;try{for(let p=0;p<4;p++)control.applyParaFormat(0,p,JSON.stringify({headType:'None',numberingId:0}));bytes=control.exportHwpx();}finally{control.free();}const b=new B.HwpDocument(bytes),d=new M.HwpDocument(bytes);try{assert.equal(d.pageCount(),b.pageCount());for(let p=0;p<d.pageCount();p++)assert.equal(d.renderPageSvg(p),b.renderPageSvg(p));proof.push({name:'nonnumbered-wrapped-control',exactSVGEqual:true,sha256:sha(bytes)});}finally{b.free();d.free();}}
const result={engineSHA256:sha(fs.readFileSync(path.join(pkg,'rhwp_bg.wasm'))),realWASM:true,nativeAppUI:false,reopens,proof};fs.writeFileSync(path.join(out,'proof.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({reopens,cases:proof.length,engineSHA256:result.engineSHA256}));

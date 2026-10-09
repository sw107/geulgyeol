// Differential scope guard: excluded placements retain the previous complete SVG.
// Usage: node script OLD_PKG NEW_PKG SYNTHETIC_HWPX OUTPUT_JSON
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const sha=b=>createHash('sha256').update(b).digest('hex');
const [oldPath,newPath,source,output]=process.argv.slice(2).map(p=>path.resolve(p));
async function engine(p){const m=await import(pathToFileURL(path.join(p,'rhwp.js')));m.initSync({module:fs.readFileSync(path.join(p,'rhwp_bg.wasm'))});return m;}
const old=await engine(oldPath),next=await engine(newPath),rows=[];
const scenarios=[
 {name:'eligible',mutate:()=>{},same:false},
 {name:'allow-overlap',mutate:(d,t)=>d.setTableProperties(0,t.para,t.controlIndex,JSON.stringify({allowOverlap:true})),same:true},
 {name:'paragraph-relative',mutate:(d,t)=>d.setTableProperties(0,t.para,t.controlIndex,JSON.stringify({vertRelTo:'Para'})),same:true},
 {name:'positive-page-offset',mutate:(d,t)=>d.setTableProperties(0,t.para,t.controlIndex,JSON.stringify({vertOffset:1800})),same:true},
 {name:'visible-before-anchor',mutate:(d,t)=>d.insertText(0,t.para,0,'BEFORE_TABLE🙂 '),same:true},
];
function snapshot(m,bytes){const d=new m.HwpDocument(bytes);d.setClipEnabled(false);try{const t=JSON.parse(d.getControls()).find(t=>t.ctrlId==='tbl'&&t.list===0);return {pages:d.pageCount(),svg:Array.from({length:d.pageCount()},(_,p)=>d.renderPageSvg(p)),body:Array.from({length:d.getParagraphCount(0)},(_,p)=>d.getTextRange(0,p,0,100000)),table:d.getTableProperties(0,t.para,t.controlIndex)};}finally{d.free();}}
for(const scenario of scenarios){const d=new old.HwpDocument(fs.readFileSync(source)),t=JSON.parse(d.getControls()).find(t=>t.ctrlId==='tbl'&&t.list===0);scenario.mutate(d,t);
 for(const format of ['hwp','hwpx']){const bytes=d[format==='hwp'?'exportHwp':'exportHwpx'](),a=snapshot(old,bytes),b=snapshot(next,bytes);assert.deepEqual(b.body,a.body,'model text '+scenario.name);assert.equal(b.table,a.table,'source placement properties '+scenario.name);if(scenario.same)assert.deepEqual(b.svg,a.svg,'complete unchanged SVG '+scenario.name);else assert.notDeepEqual(b.svg,a.svg,'eligible regression is detected');rows.push({scenario:scenario.name,format,unchangedSvg:scenario.same,pagesBefore:a.pages,pagesAfter:b.pages,sourceSHA256:sha(bytes),beforeSvgSHA256:sha(a.svg.join('')),afterSvgSHA256:sha(b.svg.join(''))});}d.free();}
fs.writeFileSync(output,JSON.stringify({rows,oldEngineSHA256:sha(fs.readFileSync(path.join(oldPath,'rhwp_bg.wasm'))),newEngineSHA256:sha(fs.readFileSync(path.join(newPath,'rhwp_bg.wasm')))},null,2));console.log(JSON.stringify({cases:rows.length,excludedUnchanged:rows.filter(r=>r.unchangedSvg).length,eligibleChanged:rows.filter(r=>!r.unchangedSvg).length}));

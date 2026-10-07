// Diagnostic only: existing paragraph formatting and rectangle APIs do not implement the menu contract.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
const [pkg, seed, native, out] = process.argv.slice(2);
fs.mkdirSync(out,{recursive:true});
const wasm=fs.readFileSync(path.join(pkg,'rhwp_bg.wasm'));
const {initSync,HwpDocument}=await import(pathToFileURL(path.resolve(pkg,'rhwp.js')));
initSync({module:wasm});
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const rows=[];let reopens=0;
const d=new HwpDocument(fs.readFileSync(seed));
try {
 const before={text:d.getTextFileText(),fields:d.getFieldList(),neighbor:d.getParaPropertiesAt(0,1)};
 const initial=sha(d.exportHwp()),snapshot=d.saveSnapshot();
 d.applyParaFormat(0,0,JSON.stringify({borderBottom:{type:1,width:7,color:'#000000'},fillType:'none'}));
 assert.deepEqual({text:d.getTextFileText(),fields:d.getFieldList(),neighbor:d.getParaPropertiesAt(0,1)},before);
 assert.equal(JSON.parse(d.getParaPropertiesAt(0,0)).borderBottom.type,1);
 d.restoreSnapshot(snapshot);assert.equal(sha(d.exportHwp()),initial);d.discardSnapshot(snapshot);
 const result=JSON.parse(d.createShapeControl(JSON.stringify({sectionIdx:0,paraIdx:0,charOffset:0,width:10000,height:283,shapeType:'rectangle',treatAsChar:false,textWrap:'InFrontOfText'})));
 d.setShapeProperties(0,0,result.controlIdx,JSON.stringify({widthRelTo:'Para',widthCriterion:'Para',vertRelTo:'Para',horzRelTo:'Para',fillType:'solid',fillBgColor:0,lineType:0}));
 const props=JSON.parse(d.getShapeProperties(0,0,result.controlIdx));
 assert(!('widthRelTo' in props)&&!('widthCriterion' in props));
 for(const ext of ['Hwp','Hwpx']) {
   const bytes=d['export'+ext]();const file=path.resolve(out,'wasm-absolute.'+ext.toLowerCase());fs.writeFileSync(file,bytes);
   const r=new HwpDocument(bytes);try {assert.equal(JSON.parse(r.getShapeProperties(0,0,result.controlIdx)).width,10000);reopens++;}finally{r.free();}
 }
 rows.push({label:'absolute-api',widthBasisGetterAbsent:true,properties:props});
}finally{d.free();}
for(const label of ['relative-before','relative-margins']) {
 for(const ext of ['hwp','hwpx']) {
   const input=fs.readFileSync(path.join(native,label+'.'+ext));const r=new HwpDocument(input);
   try {
     const tree=JSON.parse(r.getPageRenderTree(0));
     const rectangles=[];const visit=n=>{if(n.type==='Rect')rectangles.push(n.bbox);for(const c of n.children??[])visit(c);};visit(tree.root??tree);
     assert.equal(rectangles.length,1);const rectangle=rectangles[0];const svg=r.renderPageSvg(0);assert(svg.includes('<svg'));
     fs.writeFileSync(path.join(out,label+'-'+ext+'.svg'),svg);
     fs.writeFileSync(path.join(out,label+'-'+ext+'-tree.json'),JSON.stringify(tree,null,2));
     rows.push({label,ext,rectangle,svgSHA256:sha(svg),paraProperties:JSON.parse(r.getParaPropertiesAt(0,0))});reopens++;
   }finally{r.free();}
 }
}
for(const ext of ['hwp','hwpx']) { const before=rows.find(v=>v.label==='relative-before'&&v.ext===ext);const after=rows.find(v=>v.label==='relative-margins'&&v.ext===ext);assert.equal(after.rectangle.w,before.rectangle.w);assert(after.rectangle.x>before.rectangle.x);assert(after.paraProperties.marginLeft>10&&after.paraProperties.marginRight>15); }
const proof={relativeWidthIgnoresParagraphMarginsBothFormats:true,diagnosticOnly:true,wasmSHA256:sha(wasm),paragraphBorderPreservesTextFieldsNeighbor:true,paragraphBorderUndoExact:true,shapeGetterOmitsWidthBasis:true,roundtripReopens:reopens,rows,GUIVerified:false,physicalIMEVerified:false,newPublicParagraphBandFeature:false};
fs.writeFileSync(path.join(out,'proof.json'),JSON.stringify(proof,null,2)+'\n');console.log(JSON.stringify({...proof,rows:undefined}));

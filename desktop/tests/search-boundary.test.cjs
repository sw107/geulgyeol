const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');

let modulePromise;
function engine(){
 return modulePromise??=import(pathToFileURL(path.resolve(__dirname,'../web/studio/rhwp.js'))).then(M=>{
  M.initSync({module:fs.readFileSync(path.resolve(__dirname,'../web/studio/rhwp_bg.wasm'))});return M;
 });
}
for(const ext of ['hwp','hwpx'])for(const includeCells of [false,true])for(const c of [
 {text:'needleneedle',query:'needle',length:6,sensitive:true},
 {text:'😀😀',query:'😀',length:1,sensitive:true},
 {text:'한글한글',query:'한글',length:2,sensitive:true},
 {text:'AaAa',query:'aa',length:2,sensitive:false},
])test(`forward search includes the caret and adjacent ${c.query} in ${ext}, cells=${includeCells}`,async()=>{
 const M=await engine(),seed=M.HwpDocument.createEmpty();let d;
 try{
  assert(JSON.parse(seed.insertText(0,0,0,c.text)).ok);
  d=new M.HwpDocument(ext==='hwp'?seed.exportHwp():seed.exportHwpx());
  const before=Buffer.from(d.exportHwpx());let cursor=0;const found=[];
  for(let i=0;i<3;i++){
   const hit=JSON.parse(d.searchText(c.query,0,0,cursor,true,c.sensitive,includeCells));
   assert(hit.found);found.push([hit.charOffset,hit.length,hit.wrapped]);cursor=hit.charOffset+hit.length;
  }
  assert.deepEqual(found,[[0,c.length,false],[c.length,c.length,false],[0,c.length,true]]);
  // Reverse search excludes the current start and keeps overlapping matches.
  const previous=JSON.parse(d.searchText(c.query,0,0,c.length,false,c.sensitive,includeCells));
  assert.equal(previous.charOffset,c.sensitive?0:1);assert.equal(previous.wrapped,false);
  const wrapped=JSON.parse(d.searchText(c.query,0,0,0,false,c.sensitive,includeCells));
  assert.equal(wrapped.charOffset,c.length);assert.equal(wrapped.wrapped,true);
  assert.deepEqual(Buffer.from(d.exportHwpx()),before,'search never edits the document');
 }finally{d?.free();seed.free();}
});

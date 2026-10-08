const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const {pathToFileURL}=require('node:url');
// Private documents stay outside the app/source distribution. Set only for local QA.
test('split table renders each of eleven pictures once across eight pages',{skip:!process.env.BARAM_LAYOUT_FIXTURE},async()=>{
 const root=process.env.GEULGYEOL_QA_ENGINE_DIR || path.resolve(__dirname,'../web/studio');const {initSync,HwpDocument}=await import(pathToFileURL(root+'/rhwp.js'));
 initSync({module:fs.readFileSync(root+'/rhwp_bg.wasm')});const doc=new HwpDocument(fs.readFileSync(process.env.BARAM_LAYOUT_FIXTURE));
 try{assert.equal(doc.pageCount(),8);const counts=[];for(let page=0;page<8;page++){const svg=doc.renderPageSvg(page);counts.push((svg.match(/<image\b/g)||[]).length);}
 assert.deepEqual(counts,[1,0,1,2,2,2,2,1]);}finally{doc.free();}
});

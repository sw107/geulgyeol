const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
test('Korean text survives HWP and HWPX export and reopen',async()=>{
 const root=process.env.GEULGYEOL_QA_ENGINE_DIR || path.resolve(__dirname,'../web/studio');
 const {initSync,HwpDocument}=await import(pathToFileURL(path.join(root,'rhwp.js')));
 initSync({module:fs.readFileSync(path.join(root,'rhwp_bg.wasm'))});
 const doc=HwpDocument.createEmpty();
 try {
 const text='바람 문서 편집기 테스트 — 한글과 English 123';
 doc.insertText(0,0,0,text);
 const expected=doc.getTextFileText();
 assert.ok(expected.includes('바람 문서 편집기 테스트'));
 for(const format of ['Hwp','Hwpx']) {
 const artifact=doc['export'+format+'WithReport']();
 try {assert.equal(JSON.parse(artifact.contentLoss()).count,0);const bytes=artifact.takeBytes();const reopened=new HwpDocument(bytes);
 try{assert.equal(reopened.getTextFileText(),expected);}finally{reopened.free();}
 }finally{artifact.free();}
 }
 }finally{doc.free();}
});

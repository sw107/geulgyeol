const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const {pathToFileURL}=require('node:url');
for(const template of [true,false]) test(template?'app blank template preserves table edits through HWP and HWPX':'minimal engine document needs default style initialization',{todo:template?false:'createEmpty has no DocInfo styles; app uses createBlankDocument'},async()=>{
 const root=process.env.GEULGYEOL_QA_ENGINE_DIR || path.resolve(__dirname,'../web/studio');const {initSync,HwpDocument}=await import(pathToFileURL(root+'/rhwp.js'));
 initSync({module:fs.readFileSync(root+'/rhwp_bg.wasm')});const doc=HwpDocument.createEmpty();
 try{
  const ok=value=>assert.equal(JSON.parse(value).ok,true);
  if(template)doc.createBlankDocument();
  const created=JSON.parse(doc.createTable(0,0,0,2,2));assert.equal(created.ok,true);
  const ci=created.controlIdx;
  ok(doc.insertTextInCell(0,0,ci,0,0,0,'첫째 셀 한글'));
  ok(doc.insertTextInCell(0,0,ci,3,0,0,'마지막 셀 123'));
  ok(doc.splitParagraphInCell(0,0,ci,0,0,3));
  ok(doc.insertTextInCell(0,0,ci,0,1,0,'새 문단 '));
  const expected=doc.getTextFileText();assert.ok(expected.includes('새 문단 셀 한글'));assert.ok(expected.includes('마지막 셀 123'));
  for(const format of ['Hwp','Hwpx']){
   const result=doc['export'+format+'WithReport']();try{
    assert.equal(JSON.parse(result.contentLoss()).count,0);const reopened=new HwpDocument(result.takeBytes());
    try{assert.equal(reopened.getTextFileText(),expected);assert.equal(reopened.pageCount(),doc.pageCount());const tables=JSON.parse(reopened.getControls()).filter(c=>c.ctrlId==='tbl');assert.equal(tables.length,1);const table=tables[0];assert.deepEqual(JSON.parse(reopened.getCellInfo(0,table.para,table.controlIndex,3)),{row:1,col:1,rowSpan:1,colSpan:1});}finally{reopened.free();}
   }finally{result.free();}
  }
 }finally{doc.free();}
});

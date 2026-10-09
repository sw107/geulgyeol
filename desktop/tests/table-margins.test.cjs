const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');

test('table outer-margin edits survive HWP/HWPX origins, snapshots and both save formats',async()=>{
 const root=process.env.GEULGYEOL_QA_ENGINE_DIR||path.resolve(__dirname,'../web/studio');
 const {initSync,HwpDocument}=await import(pathToFileURL(root+'/rhwp.js'));
 initSync({module:fs.readFileSync(root+'/rhwp_bg.wasm')});
 const seed=HwpDocument.createEmpty();
 const keys=['outerLeft','outerRight','outerTop','outerBottom'];
 const target=d=>JSON.parse(d.getControls()).find(c=>c.ctrlId==='tbl'&&c.list===0);
 const margins=d=>{const t=target(d),p=JSON.parse(d.getTableProperties(0,t.para,t.controlIndex));return keys.map(k=>p[k]);};
 try{
  seed.createBlankDocument();const t=JSON.parse(seed.createTable(0,0,0,2,2));
  seed.insertTextInCell(0,t.paraIdx,t.controlIdx,0,0,0,'여백 편집에도 보존🙂');
  seed.setTableProperties(0,t.paraIdx,t.controlIdx,JSON.stringify(Object.fromEntries(keys.map(k=>[k,283]))));
  for(const origin of ['Hwp','Hwpx']){
   const doc=new HwpDocument(seed['export'+origin]());
   try{
    assert.deepEqual(margins(doc),[283,283,283,283]);const before=doc.saveSnapshot(),text=doc.getTextFileText();
    const ref=target(doc),expected=[13,0,-283,32767];
    doc.setTableProperties(0,ref.para,ref.controlIndex,JSON.stringify(Object.fromEntries(keys.map((k,i)=>[k,expected[i]]))));
    const after=doc.saveSnapshot();assert.deepEqual(margins(doc),expected);
    doc.restoreSnapshot(before);assert.deepEqual(margins(doc),[283,283,283,283]);
    doc.restoreSnapshot(after);assert.deepEqual(margins(doc),expected);
    for(const format of ['Hwp','Hwpx']){
     const result=doc['export'+format+'WithReport']();
     try{assert.equal(JSON.parse(result.contentLoss()).count,0);const reopened=new HwpDocument(result.takeBytes());
      try{assert.deepEqual(margins(reopened),expected);assert.equal(reopened.getTextFileText(),text);}finally{reopened.free();}
     }finally{result.free();}
    }
   }finally{doc.free();}
  }
 }finally{seed.free();}
});

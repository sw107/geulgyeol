const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
test('multiple cell equations preserve their neighbors and body across history and native format exports',async()=>{
  const root=path.resolve(__dirname,'../web/studio');
  const {initSync,HwpDocument}=await import(pathToFileURL(path.join(root,'rhwp.js')));
  initSync({module:fs.readFileSync(path.join(root,'rhwp_bg.wasm'))});
  const d=HwpDocument.createEmpty();
  try {
    d.createBlankDocument();
    const {paraIdx:p,controlIdx:t}=JSON.parse(d.createTable(0,0,0,1,2));
    const body=JSON.parse(d.insertEquation(0,p+1,0,'body ^2',1000,0));
    const bodyScript=x=>JSON.parse(x.getEquationProperties(0,body.paraIdx,body.controlIdx,-1,-1)).script;
    const props=(x,c,i)=>JSON.parse(x.getEquationPropertiesInCell(0,p,t,c,0,i));
    d.insertTextInCell(0,p,t,0,0,0,'앞😀뒤');
    d.insertEquationInCell(0,p,t,1,0,0,'neighbor',1000,0);
    const transition=f=>{
      const before=d.renderPageSvg(0),undo=d.saveSnapshot(); f();
      const after=d.renderPageSvg(0),redo=d.saveSnapshot(); assert.notEqual(before,after);
      d.restoreSnapshot(undo);assert.equal(d.renderPageSvg(0),before);
      d.restoreSnapshot(redo);assert.equal(d.renderPageSvg(0),after);
    };
    for(const [i,s] of ['first','second','third'].entries()) transition(()=>d.insertEquationInCell(0,p,t,0,0,i+1,s,1000,0));
    transition(()=>d.setEquationPropertiesInCell(0,p,t,0,0,1,'{"script":"a over b","fontSize":1300}'));
    assert.equal(props(d,0,0).script,'first');assert.equal(props(d,0,2).script,'third');
    transition(()=>d.deleteEquationControlInCell(0,p,t,0,0,0));
    assert.equal(props(d,0,0).script,'a over b');assert.equal(props(d,0,1).script,'third');
    assert.equal(props(d,1,0).script,'neighbor');assert.equal(bodyScript(d),'body ^2');
    const text=d.getTextFileText();assert.equal(d.getTextInCell(0,p,t,0,0,0,5).replaceAll('\uFFFC',''), '앞😀뒤');
    const svg=d.renderPageSvg(0);
    assert.throws(()=>d.deleteEquationControlInCell(0,p,t,0,0,99));assert.equal(d.renderPageSvg(0),svg);
    for(const format of ['Hwp','Hwpx']) {
      const report=d['export'+format+'WithReport']();
      try {
        assert.equal(JSON.parse(report.contentLoss()).count,0);
        const r=new HwpDocument(report.takeBytes());
        try {
          assert.equal(r.getTextFileText(),text);
          assert.equal(props(r,0,0).script,'a over b');assert.equal(props(r,0,1).script,'third');
          assert.equal(props(r,1,0).script,'neighbor');assert.equal(bodyScript(r),'body ^2');
          r.setEquationPropertiesInCell(0,p,t,0,0,1,'{"script":"reopened"}');
          assert.equal(props(r,0,1).script,'reopened');assert.equal(props(r,0,0).script,'a over b');
        } finally {r.free();}
      } finally {report.free();}
    }
  } finally {d.free();}
});

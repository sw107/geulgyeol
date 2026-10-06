const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const {pathToFileURL}=require('node:url');
test('style lifecycle preserves nested paragraph and next-style references when deleting a style',async()=>{
  const root=process.env.GEULGYEOL_QA_ENGINE_DIR || path.resolve(__dirname,'../web/studio');
  const {initSync,HwpDocument}=await import(pathToFileURL(path.join(root,'rhwp.js')));
  initSync({module:fs.readFileSync(path.join(root,'rhwp_bg.wasm'))});
  const d=HwpDocument.createEmpty();
  try {
    d.createBlankDocument();
    const {paraIdx:p,controlIdx:t}=JSON.parse(d.createTable(0,0,0,1,2));
    d.insertText(0,p+1,0,'첫 문단 두 번째');d.splitParagraph(0,p+1,4);
    d.insertTextInCell(0,p,t,0,0,0,'삭제할 스타일 셀');d.insertTextInCell(0,p,t,1,0,0,'남길 스타일 셀');
    const a=d.createStyle(JSON.stringify({name:'Delete A',englishName:'DeleteA',type:0}));
    const b=d.createStyle(JSON.stringify({name:'Keep B',englishName:'KeepB',type:0,nextStyleId:a}));
    const c=d.createStyle(JSON.stringify({name:'Keep C',englishName:'KeepC',type:0,nextStyleId:b}));
    assert(d.updateStyle(a,JSON.stringify({name:'Edited A',englishName:'EditedA',nextStyleId:0})));
    assert(d.updateStyleShapes(a,'{"bold":true,"fontSize":1400}','{}'));
    const history=f=>{
      const before=d.getStyleList(),svgBefore=d.renderPageSvg(0),undo=d.saveSnapshot();f();
      const after=d.getStyleList(),svgAfter=d.renderPageSvg(0),redo=d.saveSnapshot();
      d.restoreSnapshot(undo);assert.equal(d.getStyleList(),before);assert.equal(d.renderPageSvg(0),svgBefore);
      d.restoreSnapshot(redo);assert.equal(d.getStyleList(),after);assert.equal(d.renderPageSvg(0),svgAfter);
    };
    history(()=>{d.applyStyle(0,p+1,a);d.applyStyle(0,p+2,a);d.applyCellStyle(0,p,t,0,0,a);d.applyCellStyle(0,p,t,1,0,b);});
    // Parse a saved source to ensure raw STYLE records exist before next IDs change.
    const initial=d.exportHwpWithReport();const parsed=new HwpDocument(initial.takeBytes());initial.free();
    try {
      const text=parsed.getTextFileText(),svg=parsed.renderPageSvg(0),undo=parsed.saveSnapshot();
      const oldStyles=parsed.getStyleList();const base=JSON.parse(oldStyles)[0].name;
      const report=JSON.parse(parsed.deleteStylePreservingFormat(a));assert.equal(report.ok,true);
      assert.equal(report.paragraphsReassigned,3);assert.equal(report.paragraphsReindexed,1);
      assert.equal(parsed.getTextFileText(),text);assert.equal(parsed.renderPageSvg(0),svg,'delete keeps appearance');
      const styles=JSON.parse(parsed.getStyleList());
      assert.equal(styles.find(s=>s.name==='Keep B').id,b-1);assert.equal(styles.find(s=>s.name==='Keep B').nextStyleId,0);
      assert.equal(styles.find(s=>s.name==='Keep C').nextStyleId,b-1);
      assert.equal(JSON.parse(parsed.getCellStyleAt(0,p,t,0,0)).name,base);
      assert.equal(JSON.parse(parsed.getCellStyleAt(0,p,t,1,0)).name,'Keep B');
      const newStyles=parsed.getStyleList(),redo=parsed.saveSnapshot();
      parsed.restoreSnapshot(undo);assert.equal(parsed.getStyleList(),oldStyles);assert.equal(parsed.renderPageSvg(0),svg);
      parsed.restoreSnapshot(redo);assert.equal(parsed.getStyleList(),newStyles);assert.equal(parsed.renderPageSvg(0),svg);
      assert.throws(()=>parsed.deleteStylePreservingFormat(0));assert.equal(parsed.getStyleList(),newStyles);
      assert.equal(parsed.deleteStyle(999),false);assert.equal(parsed.getStyleList(),newStyles);
      for(const format of ['Hwp','Hwpx']){
        const result=parsed['export'+format+'WithReport']();try{
          assert.equal(JSON.parse(result.contentLoss()).count,0);const r=new HwpDocument(result.takeBytes());try{
            assert.equal(r.getTextFileText(),text);assert.equal(r.getStyleList(),newStyles);
            assert.equal(JSON.parse(r.getCellStyleAt(0,p,t,0,0)).name,base);
            assert.equal(JSON.parse(r.getCellStyleAt(0,p,t,1,0)).name,'Keep B');
            r.applyCellStyle(0,p,t,0,0,b-1);assert.equal(JSON.parse(r.getCellStyleAt(0,p,t,0,0)).name,'Keep B');
          }finally{r.free();}
        }finally{result.free();}
      }
    } finally {parsed.free();}
  }finally{d.free();}
});

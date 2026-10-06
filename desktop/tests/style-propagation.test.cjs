const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const {pathToFileURL}=require('node:url');
function preserved(before,after,sid){const clean=s=>JSON.parse(s).map(v=>{if(v.id===sid){delete v.charShapeId;delete v.paraShapeId;}return v;});assert.deepEqual(clean(after),clean(before));}
test('style shape propagation across saved nested/header/note scopes preserves references and snapshot history',async()=>{
  const root=process.env.GEULGYEOL_QA_ENGINE_DIR || path.resolve(__dirname,'../web/studio');
  const {initSync,HwpDocument}=await import(pathToFileURL(path.join(root,'rhwp.js')));
  initSync({module:fs.readFileSync(path.join(root,'rhwp_bg.wasm'))});
  const fixtureRoot=process.env.GEULGYEOL_QA_FIXTURES;
  const fixtures=fixtureRoot ? Array.from({length:8},(_,kind)=>['hwp','hwpx'].map(format=>path.join(fixtureRoot,`kind${kind}-${format}-source.${format}`))).flat() : [];
  if(!fixtures.length){
    const d=HwpDocument.createEmpty();try{
      d.createBlankDocument();d.insertText(0,0,0,'스타일 본문');
      const sid=d.createStyle('{"name":"Update A","englishName":"UpdateA","type":0}');d.applyStyle(0,0,sid);
      const svg=d.renderPageSvg(0),undo=d.saveSnapshot(),styles=d.getStyleList();
      assert.equal(JSON.parse(d.updateStyleShapesPreservingOverrides(sid,'{"fontSize":2400}','{}')).ok,true);
      preserved(styles,d.getStyleList(),sid);assert.notEqual(d.renderPageSvg(0),svg);
      const redo=d.saveSnapshot();d.restoreSnapshot(undo);assert.equal(d.renderPageSvg(0),svg);d.restoreSnapshot(redo);
      assert.equal(d.updateStyleShapes(999,'{}','{}'),false);d.discardSnapshot(undo);d.discardSnapshot(redo);
    }finally{d.free();}
  }
  for(const fixture of fixtures){
    const d=new HwpDocument(fs.readFileSync(fixture));try{
      const sid=JSON.parse(d.getStyleList()).find(s=>s.name==='Deleted A').id;
      const styles=d.getStyleList(),detail=d.getStyleDetail(sid),text=d.getTextFileText(),svg=d.renderPageSvg(0),undo=d.saveSnapshot();
      const baseline={};for(const format of ['Hwp','Hwpx']){const x=d['export'+format+'WithReport']();try{const r=new HwpDocument(x.takeBytes());try{baseline[format]=JSON.parse(r.getStyleDetail(sid));}finally{r.free();}}finally{x.free();}}
      const result=JSON.parse(d.updateStyleShapesPreservingOverrides(sid,'{"fontSize":2400,"italic":true}','{"alignment":"center","marginLeft":900}'));
      assert.equal(result.ok,true);assert(result.paragraphsUpdated>=4,fixture);preserved(styles,d.getStyleList(),sid);assert.equal(d.getTextFileText(),text);assert.notEqual(d.getStyleDetail(sid),detail);
      const newStyles=d.getStyleList(),newDetail=d.getStyleDetail(sid),newSvg=d.renderPageSvg(0),redo=d.saveSnapshot();assert.notEqual(newSvg,svg);
      d.restoreSnapshot(undo);assert.equal(d.getStyleDetail(sid),detail);assert.equal(d.renderPageSvg(0),svg);
      d.restoreSnapshot(redo);assert.equal(d.getStyleDetail(sid),newDetail);assert.equal(d.renderPageSvg(0),newSvg);
      assert.equal(JSON.parse(d.updateStyleShapesPreservingOverrides(sid,'{"fontSize":2400,"italic":true}','{"alignment":"center","marginLeft":900}')).paragraphsUpdated,0);
      assert.throws(()=>d.updateStyleShapesPreservingOverrides(999,'{}','{}'));assert.throws(()=>d.updateStyleShapesPreservingOverrides(sid,'[','{}'));
      assert.equal(d.getStyleDetail(sid),newDetail);assert.equal(d.renderPageSvg(0),newSvg);
      for(const format of ['Hwp','Hwpx']){
        const result=d['export'+format+'WithReport']();try{
          assert.equal(JSON.parse(result.contentLoss()).count,0,fixture);const r=new HwpDocument(result.takeBytes());try{
            assert.equal(r.getStyleList(),newStyles);const expected=baseline[format],updated=JSON.parse(newDetail);
            for(const key of ['fontSize','italic','charShapeId'])expected.charProps[key]=updated.charProps[key];
            for(const key of ['alignment','marginLeft','paraShapeId'])expected.paraProps[key]=updated.paraProps[key];
            assert.deepEqual(JSON.parse(r.getStyleDetail(sid)),expected,fixture+' -> '+format);assert.equal(r.getTextFileText(),text);
          }finally{r.free();}
        }finally{result.free();}
      }
      d.discardSnapshot(undo);d.discardSnapshot(redo);
    }finally{d.free();}
  }
  console.log(JSON.stringify({runtime:process.platform,fixtureCases:fixtures.length,twoFormatReopens:fixtures.length*2,snapshotUndoRedo:fixtures.length*2,nativeGUIVerified:false}));
});

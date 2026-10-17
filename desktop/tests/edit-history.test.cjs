const {test}=require('node:test');
const assert=require('node:assert/strict');
test('native history waits for IME completion without replaying stale requests',async()=>{
  const {observeComposition,routeHistory}=await import('../web/edit-history.js');
  const events=new EventTarget();
  const document=Object.assign(events,{activeElement:{tagName:'TEXTAREA',getAttribute:()=> '문서 편집 입력'},querySelector:()=>null});
  const calls=[];
  const editor={commands:{execute:async a=>calls.push(a)}};
  observeComposition(document);observeComposition(document);
  events.dispatchEvent(new Event('compositionstart'));
  await routeHistory('undo',{document,editor});
  await routeHistory('redo',{document,editor});
  assert.deepEqual(calls,[]);
  events.dispatchEvent(new Event('compositionend'));
  assert.deepEqual(calls,[]);
  await routeHistory('undo',{document,editor});
  assert.deepEqual(calls,['edit:undo']);
});
test('history routes document input to engine and dialog fields to their own history',async()=>{
  const {routeHistory}=await import('../web/edit-history.js');
  const calls=[];
  const inner={activeElement:{tagName:'TEXTAREA',getAttribute:()=> '문서 편집 입력'},querySelector:()=>null,execCommand:a=>calls.push('field:'+a)};
  const document={activeElement:{tagName:'IFRAME',contentDocument:inner},querySelector:()=>null};
  const editor={commands:{execute:async a=>calls.push(a)}};
  await routeHistory('undo',{document,editor});
  await routeHistory('redo',{document,editor});
  assert.deepEqual(calls,['edit:undo','edit:redo']);
  inner.activeElement={tagName:'INPUT',getAttribute:()=>null};
  await routeHistory('undo',{document,editor});
  assert.equal(calls.at(-1),'field:undo');
  inner.activeElement={tagName:'DIV',isContentEditable:true,getAttribute:()=>null};
  await routeHistory('redo',{document,editor});
  assert.equal(calls.at(-1),'field:redo');
  inner.activeElement={tagName:'BUTTON'};
  inner.querySelector=()=>({});
  await routeHistory('undo',{document,editor});
  inner.querySelector=()=>null;
  await routeHistory('undo',{document,editor,busy:true});
  await routeHistory('paste',{document,editor});
  await routeHistory('undo',{document});
  assert.equal(calls.length,4);
});

test('native select-all selects the editor document, while focused fields keep browser selection',async()=>{
  const {routeSelectAll}=await import('../web/edit-history.js');const calls=[];
  const inner={activeElement:{tagName:'TEXTAREA',getAttribute:()=> '문서 편집 입력'},querySelector:()=>null,execCommand:a=>calls.push('field:'+a)};
  const document={activeElement:{tagName:'IFRAME',contentDocument:inner},querySelector:()=>null};
  const editor={commands:{execute:async a=>calls.push(a)}};
  await routeSelectAll({document,editor});assert.deepEqual(calls,['edit:select-all']);
  for(const field of [{tagName:'INPUT'},{tagName:'TEXTAREA'},{tagName:'DIV',isContentEditable:true}]){
    inner.activeElement=field;await routeSelectAll({document,editor});assert.equal(calls.at(-1),'field:selectAll');
  }
  assert.equal(calls.length,4);
});

test('native select-all respects busy state, IME composition, modal focus and absent editor',async()=>{
  const {observeComposition,routeSelectAll}=await import('../web/edit-history.js');const calls=[];
  const inner=Object.assign(new EventTarget(),{activeElement:{tagName:'TEXTAREA',getAttribute:()=> '문서 편집 입력'},querySelector:()=>null});
  const document={activeElement:{tagName:'IFRAME',contentDocument:inner},querySelector:()=>null};
  const editor={commands:{execute:async a=>calls.push(a)}};observeComposition(inner);
  inner.dispatchEvent(new Event('compositionstart'));await routeSelectAll({document,editor});
  inner.dispatchEvent(new Event('compositionend'));assert.deepEqual(calls,[]);
  await routeSelectAll({document,editor,busy:true});await routeSelectAll({document});
  document.querySelector=()=>({});await routeSelectAll({document,editor});document.querySelector=()=>null;
  inner.activeElement={tagName:'BUTTON'};inner.querySelector=()=>({});await routeSelectAll({document,editor});
  assert.deepEqual(calls,[]);
  inner.activeElement={tagName:'INPUT'};inner.execCommand=a=>calls.push(a);await routeSelectAll({document,editor});
  assert.deepEqual(calls,['selectAll']);
});

test('native select-all menu routes the editor and leaves other windows on their own selection',async()=>{
  const {bootHost}=require('../../scripts/check-host-save.cjs');
  const host=await bootHost(require.resolve('../main.cjs'),require('../storage.cjs'),async()=>({canceled:true}));
  const item=host.menu.find(m=>m.label==='편집').submenu.find(m=>m.id==='document-select-all');
  assert(item);assert.equal(item.role,undefined);assert.equal(item.accelerator,'CmdOrCtrl+A');
  item.click(item,host.window);assert.deepEqual(host.actions,['select-all']);
  let otherSelections=0;const other={isDestroyed:()=>false,webContents:{selectAll:()=>otherSelections++}};
  item.click(item,other);assert.equal(otherSelections,1);assert.deepEqual(host.actions,['select-all']);
  item.click(item,{...other,isDestroyed:()=>true});assert.equal(otherSelections,1);assert.deepEqual(host.actions,['select-all']);
});

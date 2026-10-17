// VM-only regression: real input/router/command/history source, in-memory WASM,
// cursor and repaint adapters. Does not load WASM, Electron or native libraries.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
const root=path.resolve(__dirname,'../..');
function load(source,dependencies={}){
  const names=[...source.matchAll(/^export (?:class|function|const) (\w+)/gm)].map(m=>m[1]);
  const js=stripTypeScriptTypes(source,{mode:'transform'}).replace(/^import[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm,'').replace(/\bexport\s+/g,'');
  const exports={};vm.runInNewContext(js+'\nObject.assign(exports,{'+names.join(',')+'});\nif(typeof replaceBodySelectionInput === "function") exports.replaceBodySelectionInput=replaceBodySelectionInput;',
    {exports,structuredClone,AggregateError,console,...dependencies});return exports;
}
const source=name=>fs.readFileSync(path.join(root,'rhwp-studio/src/engine',name),'utf8');
const limit=/export const MAX_PAGE_LOCAL_TEXT_EDIT_CHARS = (\d+);/.exec(source('input-edit-invalidation.ts'));
assert(limit,'read the current body edit limit from source');
const commands=load(source('command.ts'),{MAX_PAGE_LOCAL_TEXT_EDIT_CHARS:Number(limit[1])});
const {CommandHistory}=load(source('history.ts'),commands);
const handler=source('input-handler.ts');
function method(start,end){const a=handler.indexOf(start),b=handler.indexOf(end,a);assert(a>=0&&b>a);return handler.slice(a,b);}
const routerSource='export class Router {\n'+[
  method('  private deleteSelection(options?', '\n  /** Undo 처리 */'),
  method('  executeOperation(desc:', '\n  /**\n   * document-agent'),
  method('  private isOperationAllowedInEditMode(desc:', '\n  /** 편집 영역이 활성'),
  method('  getPendingCharShape():', '\n  /** [#4162] Command'),
  method('  private advancePendingCharShapeAnchor(', '\n  /**\n   * 셀 블록'),
].join('\n')+'\n}';
const {Router}=load(routerSource,{...commands,CursorState:{comparePositions:(a,b)=>
  a.sectionIndex-b.sectionIndex || a.paragraphIndex-b.paragraphIndex || a.charOffset-b.charOffset}});
const inputSource=process.env.GEULGYEOL_ATOMIC_INPUT_BASELINE ? fs.readFileSync(process.env.GEULGYEOL_ATOMIC_INPUT_BASELINE,'utf8') : source('input-handler-text.ts');
const input=load(inputSource,commands);
const clone=structuredClone;
const pos=(paragraphIndex,charOffset)=>({sectionIndex:0,paragraphIndex,charOffset});

function fixture({paragraphs=['SELECT-ALL-A','SELECT-ALL-B'],start=pos(0,0),end=pos(paragraphs.length-1,Array.from(paragraphs.at(-1)).length),...options}={}){
  let state={paragraphs:clone(paragraphs),formats:[{font:'source',bold:false}],metadata:{bookmark:'preserved',style:7}};
  const before=clone(state),snapshots=new Map(),fragments=new Map();let next=1;
  const counts={refreshes:0,discardedFragments:0,advances:0};
  const wasm={
    getFieldList:()=>{if(options.fieldReadFails)throw Error('field reader failed');return options.fields||[];},
    getBookmarks:()=>[],bodyTableHostNeedsTextSnapshot:()=>false,
    assertDocumentWritable(){if(options.locked)throw Error('document locked');},
    saveSnapshot(){if(options.failSave)throw Error('save failed');const id=next++;snapshots.set(id,clone(state));return id;},
    restoreSnapshot(id){if(options.failRestore)throw Error('restore failed');assert(snapshots.has(id));state=clone(snapshots.get(id));},
    discardSnapshot:id=>snapshots.delete(id),
    captureDeleteRange(){if(options.failCapture)throw Error('capture failed');const id=next++;fragments.set(id,clone(state));return id;},
    restoreDeleteFragment(id){assert(fragments.has(id));state=clone(fragments.get(id));fragments.delete(id);},
    discardDeleteFragment(id){if(fragments.delete(id))counts.discardedFragments++;},
    deleteRange(_s,p,a,q,b){
      if(options.noOpDelete)return {changed:false};
      const replacement=Array.from(state.paragraphs[p]).slice(0,a).join('')+Array.from(state.paragraphs[q]).slice(b).join('');
      state.paragraphs.splice(p,q-p+1,replacement);if(options.failDelete)throw Error('delete failed');return {changed:true};
    },
    insertText(_s,p,off,text){const chars=Array.from(state.paragraphs[p]);chars.splice(off,0,...Array.from(text));state.paragraphs[p]=chars.join('');if(options.failInsert)throw Error('insert failed');},
    replaceBodyTextLocal(s,p,off,count,text){assert.equal(count,0);this.insertText(s,p,off,text);return {documentPaginationPending:false,flowChanged:false};},
    deleteText(_s,p,off,count){const chars=Array.from(state.paragraphs[p]);chars.splice(off,count);state.paragraphs[p]=chars.join('');},
    applyCharFormat(_s,p,a,b,json){state.formats.push({p,a,b,...JSON.parse(json)});if(options.failFormat)throw Error('format failed');},
  };
  let selection={start:clone(start),end:clone(end)},position=clone(end);
  const cursor={isInCell:()=>!!options.cell,isInTextBox:()=>!!options.textbox,
    isInHeaderFooter:()=>false,isInFootnote:()=>false,
    hasSelection:()=>selection!==null,getSelectionOrdered:()=>clone(selection),
    getPosition:()=>clone(position),getRect:()=>null,blockSelectionPhase:()=>2,
    clearSelection(){selection=null;},moveTo(p){position=clone(p);selection=null;},resetPreferredX(){},
    selectRange(a,b){selection={start:clone(a),end:clone(b)};position=clone(b);},
  };
  const h=Object.assign(new Router(),{wasm,cursor,history:new CommandHistory(),editMode:options.form?'form':'normal',active:true,
    textarea:{value:''},isComposing:false,_isIOS:false,_lastComposedText:'',
    canDeleteSelectionInFormMode:()=>!options.denyDelete,canInsertTextInFormMode:()=>!options.denyInsert,
    getNonEmptyHeaderFooterSelection:()=>null,prepareClickHereInputPosition:()=>cursor.getPosition(),
    isClickHereGuidePosition:()=>false,isExitedFieldStartPosition:()=>false,
    pendingCharShape:options.format?{bold:true}:null,pendingCharShapeAnchor:clone(start),
    prepareTextMutationBeforeCursor:()=>false,
    caretLayoutReveal:{requestFor(){}},
    refreshAfterOperation(){counts.refreshes++;if(options.failRefresh)throw Error('refresh failed');},
  });
  const type=text=>{h.textarea.value=text;return input.onInput.call(h);};
  return {h,wasm,cursor,before,type,counts,snapshots,fragments,options,
    state:()=>clone(state),selection:()=>clone(selection),
    undo:()=>h.history.undo(wasm),redo:()=>h.history.redo(wasm),clear:()=>h.history.clear(wasm)};
}

test('one undo restores the full selected body; redo applies replacement without re-running mutations',()=>{
  const f=fixture();f.type('Q');assert.deepEqual(f.state().paragraphs,['Q']);
  f.undo();assert.deepEqual(f.state(),f.before);assert.equal(f.h.history.canUndo(),false);
  assert.equal(f.counts.refreshes,1);assert.equal(f.fragments.size,0);assert.equal(f.counts.discardedFragments,1);
  f.options.failInsert=true;f.redo();assert.deepEqual(f.state().paragraphs,['Q']);
  f.undo();assert.deepEqual(f.state(),f.before);f.clear();assert.equal(f.snapshots.size,0);
});

for(const c of [
  {paragraphs:['left-MIDDLE-right'],start:pos(0,5),end:pos(0,11),text:'새🙂',expected:['left-새🙂-right']},
  {paragraphs:['앞🙂한글','둘째끝','이웃'],start:pos(0,2),end:pos(1,2),text:'😀가',expected:['앞🙂😀가끝','이웃']},
])test('scalar positions and untouched neighbors survive replacement and undo: '+c.text,()=>{
  const f=fixture(c);f.type(c.text);assert.deepEqual(f.state().paragraphs,c.expected);
  assert.equal(f.cursor.getPosition().charOffset,c.start.charOffset+Array.from(c.text).length);
  f.undo();assert.deepEqual(f.state(),f.before);f.clear();assert.equal(f.fragments.size+f.snapshots.size,0);
});

test('ordinary typing after replacement remains a separate undo boundary',()=>{
  const f=fixture();f.type('Q');f.type('R');assert.deepEqual(f.state().paragraphs,['QR']);
  f.undo();assert.deepEqual(f.state().paragraphs,['Q']);f.undo();assert.deepEqual(f.state(),f.before);
  f.redo();f.redo();assert.deepEqual(f.state().paragraphs,['QR']);f.clear();
});

test('pending format is part of the same undo state and advances to the inserted scalar end',()=>{
  const f=fixture({format:true});f.type('🙂가');assert.deepEqual(f.state().formats.at(-1),{p:0,a:0,b:2,bold:true});
  assert.equal(f.h.pendingCharShapeAnchor.charOffset,2);f.undo();assert.deepEqual(f.state(),f.before);f.clear();
});

test('stale pending format is not revived by selection replacement',()=>{
  const f=fixture({format:true});f.h.pendingCharShapeAnchor=pos(7,3);f.type('Q');
  assert.deepEqual(f.state().formats,f.before.formats);assert.equal(f.h.pendingCharShape,null);assert.equal(f.h.pendingCharShapeAnchor,null);
  f.undo();assert.deepEqual(f.state(),f.before);f.clear();
});

test('repeated replacements respect the existing snapshot history budget',()=>{
  const f=fixture();
  for(let i=0;i<110;i++){
    if(i)f.cursor.selectRange(pos(0,0),pos(0,Array.from(f.state().paragraphs[0]).length));
    f.type('Q'+i);assert(f.snapshots.size<=98);assert.equal(f.fragments.size,0);
  }
  f.clear();assert.equal(f.snapshots.size+f.fragments.size,0);
});

for(const failure of ['failCapture','failDelete','failInsert','failFormat','denyInsert'])test('failed '+failure+' restores document, selection, redo and snapshot resources',()=>{
  const f=fixture({format:true});f.type('Q');f.undo();const before=f.state();
  f.cursor.selectRange(pos(0,0),pos(1,12));const expectedSelection=f.selection();const resources=f.snapshots.size;
  f.h.pendingCharShape={bold:true};f.h.pendingCharShapeAnchor=pos(0,0);
  const pending={shape:clone(f.h.pendingCharShape),anchor:clone(f.h.pendingCharShapeAnchor)};
  f.options[failure]=true;assert.throws(()=>f.type('Z'));
  assert.deepEqual(f.state(),before);assert.deepEqual(f.selection(),expectedSelection);assert(f.h.history.canRedo());
  assert.deepEqual(f.h.pendingCharShape,pending.shape);assert.deepEqual(f.h.pendingCharShapeAnchor,pending.anchor);
  assert.equal(f.h.history.canUndo(),false);assert.equal(f.fragments.size,0);assert.equal(f.snapshots.size,resources);f.clear();
});

test('no-op deletion keeps selection and redo without inserting text',()=>{
  const f=fixture();f.type('Q');f.undo();f.cursor.selectRange(pos(0,0),pos(1,12));const selected=f.selection();
  f.options.noOpDelete=true;f.type('Z');assert.deepEqual(f.state(),f.before);assert.deepEqual(f.selection(),selected);
  assert(f.h.history.canRedo());assert.equal(f.h.history.canUndo(),false);assert.equal(f.fragments.size,0);f.clear();
});

test('snapshot-save failure changes neither the document nor selection',()=>{
  const f=fixture({failSave:true}),selected=f.selection();assert.throws(()=>f.type('Z'),/save failed/);
  assert.deepEqual(f.state(),f.before);assert.deepEqual(f.selection(),selected);assert.equal(f.fragments.size+f.snapshots.size,0);
});

test('rollback failure propagates the aggregate error and does not claim selection restoration',()=>{
  const f=fixture({failInsert:true,failRestore:true});assert.throws(()=>f.type('Z'),e=>e instanceof AggregateError);
  assert.equal(f.selection(),null);assert.equal(f.fragments.size+f.snapshots.size,0);assert.equal(f.h.history.canUndo(),false);
});

test('refresh failure after commit does not restore a stale pre-edit selection',()=>{
  const f=fixture({failRefresh:true});assert.throws(()=>f.type('Z'),/refresh failed/);
  assert.deepEqual(f.state().paragraphs,['Z']);assert.equal(f.selection(),null);assert(f.h.history.canUndo());
  f.undo();assert.deepEqual(f.state(),f.before);f.clear();
});

test('existing field and form paths retain their previous separate commands',()=>{
  for(const options of [{fields:[{fieldType:'hyperlink'}]},{form:true}]){
    const f=fixture(options);f.type('Q');assert.equal(f.h.history.peekUndoTop().type,'insertText');
    f.undo();assert.deepEqual(f.state().paragraphs,['']);f.undo();assert.deepEqual(f.state(),f.before);f.clear();
  }
});

test('field inspection failure refuses replacement before any deletion',()=>{
  const f=fixture({fieldReadFails:true}),selected=f.selection();assert.throws(()=>f.type('Q'),/field reader failed/);
  assert.deepEqual(f.state(),f.before);assert.deepEqual(f.selection(),selected);assert.equal(f.h.history.canUndo(),false);
  assert.equal(f.snapshots.size+f.fragments.size,0);
});

for(const options of [{form:true},{cell:true},{textbox:true},{fields:[{}]},
  {end:{...pos(1,12),sectionIndex:1}},{start:{...pos(0,0),parentParaIndex:0}},
  {end:{...pos(1,12),cellPath:[{controlIndex:0,cellIndex:0,cellParaIndex:0}]}},
  {start:{...pos(0,0),isTextBox:true}},{end:pos(0,0)},
])test('out-of-scope selection is left on the existing path: '+JSON.stringify(options),()=>{
  const f=fixture(options),selected=f.selection();
  assert.equal(input.replaceBodySelectionInput.call(f.h,'Q'),false);
  assert.deepEqual(f.state(),f.before);assert.deepEqual(f.selection(),selected);
  assert.equal(f.snapshots.size+f.fragments.size,0);assert.equal(f.h.history.canUndo(),false);
});

test('IME body updates keep their existing unrecorded raw-input path',()=>{
  const f=fixture();let updates=0;Object.assign(f.h,{isComposing:true,compositionAnchor:pos(0,0),compositionLength:0,
    resetRawTextMutationEffects(){},replaceTextAtRaw(){updates++;},consumeRawTextMutationBeforeCursor:()=>false,afterTextInputEdit(){}});
  f.type('가');assert.equal(updates,1);assert.equal(f.h.history.canUndo(),false);assert.equal(f.snapshots.size,0);
});

test('locked, inactive, empty-input and denied-selection gates do not apply a replacement',()=>{
  for(const options of [{locked:true},{denyDelete:true},{inactive:true}]){
    const f=fixture(options);if(options.inactive)f.h.active=false;
    if(options.locked)assert.throws(()=>f.type('Q'),/locked/);else f.type('Q');
    assert.deepEqual(f.state(),f.before);assert.equal(f.h.history.canUndo(),false);
  }
  const f=fixture();f.type('');assert.deepEqual(f.state(),f.before);assert.equal(f.h.history.canUndo(),false);
});

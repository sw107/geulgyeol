// Selection IME transaction regressions; actual production router/commands/history.
// VM fault tests plus synthetic HWP/HWPX engine tests; no native GUI.
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
  let selection={start:clone(start),end:clone(end)},position=clone(options.reverse?start:end);
  let anchor=clone(options.reverse?end:start),phase=Object.hasOwn(options,'phase')?options.phase:2;
  const cursor={isInCell:()=>!!options.cell,isInTextBox:()=>!!options.textbox,
    isInHeaderFooter:()=>false,isInFootnote:()=>!!options.footnote,
    hasSelection:()=>selection!==null,getSelectionOrdered:()=>clone(selection),
    getSelection:()=>selection?{anchor:clone(anchor),focus:clone(position)}:null,
    getPosition:()=>clone(position),getRect:()=>null,blockSelectionPhase:()=>phase,
    clearSelection(){selection=null;},moveTo(p){position=clone(p);selection=null;},resetPreferredX(){},
    selectRange(a,b,blockPhase=null){
      const forward=a.sectionIndex-b.sectionIndex || a.paragraphIndex-b.paragraphIndex || a.charOffset-b.charOffset;
      selection=forward<=0?{start:clone(a),end:clone(b)}:{start:clone(b),end:clone(a)};
      anchor=clone(a);position=clone(b);phase=blockPhase;
    },
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

function ime(options={}) {
 const f=fixture(options),h=f.h;
 Object.assign(f.wasm,{documentGeneration:1,hasLoadedDocument:()=>true,
  getTextRange:(_s,p,a,n)=>Array.from(f.state().paragraphs[p]).slice(a,a+n).join(''),
  replaceBodyTextLocal(s,p,a,n,t){this.deleteText(s,p,a,n);this.insertText(s,p,a,t);return {documentPaginationPending:false,flowChanged:false};}});
 Object.assign(h,{compositionAnchor:null,compositionLength:0,_lastCompositionText:'',
  resetRawTextMutationEffects(){},consumeRawTextMutationBeforeCursor:()=>false,
  replaceTextAtRaw:(...args)=>input.replaceTextAtRaw.call(h,...args),
  getTextAt:(...args)=>input.getTextAt.call(h,...args),caret:{hideComposition(){}},updateCaret(){},afterTextInputEdit(){},afterEdit(){f.counts.refreshes++;},
  hasBodySelectionComposition:()=>input.hasBodySelectionComposition?.call(h) ?? false,
  onCompositionEnd:e=>input.onCompositionEnd.call(h,e),
 });
 return Object.assign(f,{start:()=>input.onCompositionStart.call(h),end:text=>h.onCompositionEnd({data:text}),
  cancel:()=>input.cancelBodySelectionComposition.call(h)});
}

for(const reverse of [false,true])for(const text of ['가','😀가'])test(`one atomic IME replacement, reverse=${reverse}, text=${text}`,()=>{
 const f=ime({reverse});f.start();f.type('ㄱ');f.type(text);
 assert.equal(f.h.history.canUndo(),false);assert.equal(f.fragments.size,0);
 f.end(text);assert.deepEqual(f.state().paragraphs,[text]);assert.equal(f.h.history.peekUndoTop().type,'snapshot:replaceBodySelectionInput');
 f.undo();assert.deepEqual(f.state(),f.before);assert.equal(f.h.history.canUndo(),false);
 assert.equal(f.h.history.peekRedoTop().selectionBefore?.(),undefined,'typing undo follows existing contract: no stale selected range');
 f.redo();assert.deepEqual(f.state().paragraphs,[text]);f.clear();assert.equal(f.snapshots.size,0);
});
for(const reverse of [false,true])for(const mode of ['empty-end','explicit-cancel','no-update'])test(`cancel restores selection direction, phase and redo: ${reverse}/${mode}`,()=>{
 const f=ime({reverse,phase:2});f.type('Q');f.undo();f.cursor.selectRange(reverse?pos(1,12):pos(0,0),reverse?pos(0,0):pos(1,12),2);
 const selected=f.cursor.getSelection(),resources=f.snapshots.size,refreshes=f.counts.refreshes;
 f.start();if(mode!=='no-update')f.type('가');
 if(mode==='explicit-cancel')f.cancel();else f.end('');
 assert.deepEqual(f.state(),f.before);assert.deepEqual(f.cursor.getSelection(),selected);assert.equal(f.cursor.blockSelectionPhase(),2);
 assert.equal(f.h.history.canUndo(),false);assert(f.h.history.canRedo());assert.equal(f.snapshots.size,resources);assert(f.counts.refreshes>refreshes,'restored source invalidates preview rendering');
 f.redo();assert.deepEqual(f.state().paragraphs,['Q']);f.clear();
});
test('ordinary input after committed IME is a separate undo boundary',()=>{
 const f=ime();f.start();f.type('가');f.end('가');f.type('나');
 f.undo();assert.deepEqual(f.state().paragraphs,['가']);f.undo();assert.deepEqual(f.state(),f.before);f.clear();
});
test('final compositionend data is reconciled before the atomic commit',()=>{
 const f=ime();f.start();f.type('ㄱ');f.end('가');f.type('가');
 assert.deepEqual(f.state().paragraphs,['가']);f.undo();assert.deepEqual(f.state(),f.before);f.clear();
});
test('another operation flushes the selection composition before applying its own command',()=>{
 const f=ime();f.start();f.type('가');
 f.h.executeOperation({kind:'command',command:new commands.InsertTextCommand(pos(0,1),'Q')});
 assert.deepEqual(f.state().paragraphs,['가Q']);f.undo();assert.deepEqual(f.state().paragraphs,['가']);f.undo();assert.deepEqual(f.state(),f.before);f.clear();
});
test('document-agent entry refuses preview-state mutation before changing its history or model',async()=>{
 const a=handler.indexOf('  async executeDocumentAgentOperation('),b=handler.indexOf('\n  private async performDocumentAgentOperation',a);
 const {Agent}=load('export class Agent {\n'+handler.slice(a,b)+'\n}');
 const f=ime();f.start();f.type('가');let executed=0;
 f.h.pendingDocumentAgentOperations=0;f.h.performDocumentAgentOperation=async()=>executed++;
 await assert.rejects(Agent.prototype.executeDocumentAgentOperation.call(f.h,{},async()=>{}),/조합/);
 assert.equal(executed,0);assert.equal(f.h.history.canUndo(),false);assert.deepEqual(f.state().paragraphs,['가']);
 f.end('가');await Agent.prototype.executeDocumentAgentOperation.call(f.h,{},async()=>{});assert.equal(executed,1);f.clear();
});
test('Undo during active selection composition restores source in one call; Redo restores the replacement',()=>{
 function extract(name){const a=handler.indexOf('  private '+name+'('),b=handler.indexOf('\n  }\n',a);return handler.slice(a,b+4);}
 const {Undo}=load('export class Undo {\n'+['handleUndo','handleRedo','restoreEditContextAfterHistory'].map(extract).join('\n')+'\n}',commands);
 const f=ime();f.h.restoreEditContextAfterHistory=Undo.prototype.restoreEditContextAfterHistory;
 for(const name of ['clearPendingFootnoteCharShape','flushDeferredPaginationIfNeeded','clearTableResizeRuntimeCache','resetDerivedStateAfterHistoryJump','restoreSelectionAfterUndo','restoreSelectionAfterRedo'])f.h[name]=()=>{};
 f.start();f.type('가');Undo.prototype.handleUndo.call(f.h);assert.deepEqual(f.state(),f.before);assert.equal(f.h.history.canUndo(),false);
 Undo.prototype.handleRedo.call(f.h);assert.deepEqual(f.state().paragraphs,['가']);f.clear();
});
test('cancel without rendering releases resources before a handler is disposed/deactivated',()=>{
 const f=ime(),selected=f.cursor.getSelection();f.start();f.type('가');const refreshes=f.counts.refreshes;
 input.cancelBodySelectionComposition.call(f.h,false);assert.deepEqual(f.state(),f.before);assert.deepEqual(f.cursor.getSelection(),selected);
 assert.equal(f.snapshots.size+f.fragments.size,0);assert.equal(f.counts.refreshes,refreshes);
 assert.equal(input.hasBodySelectionComposition.call(f.h),false);
});
for(const failure of ['failSave','failCapture','failDelete','denyInsert','noOpDelete'])test('start failure restores source and selection: '+failure,()=>{
 const f=ime({reverse:true}),selected=f.cursor.getSelection();f.options[failure]=true;
 assert.throws(()=>f.start());assert.deepEqual(f.state(),f.before);assert.deepEqual(f.cursor.getSelection(),selected);
 assert.equal(f.h.history.canUndo(),false);assert.equal(f.snapshots.size+f.fragments.size,0);
});
test('pending format and source metadata round-trip with the atomic IME entry',()=>{
 const f=ime({format:true});f.start();f.type('😀가');f.end('😀가');
 assert.deepEqual(f.state().formats.at(-1),{p:0,a:0,b:2,bold:true});assert.equal(f.h.pendingCharShapeAnchor.charOffset,2);
 f.undo();assert.deepEqual(f.state(),f.before);f.clear();
});
test('preview write failure rolls back without recording deletion or leaking resources',()=>{
 const f=ime(),selected=f.cursor.getSelection();f.start();f.options.failInsert=true;assert.throws(()=>f.type('가'));
 assert.deepEqual(f.state(),f.before);assert.deepEqual(f.cursor.getSelection(),selected);assert.equal(f.h.isComposing,false);
 assert.equal(f.snapshots.size+f.fragments.size,0);assert.equal(f.h.history.canUndo(),false);
});
test('commit write failure restores source and preserves redo',()=>{
 const f=ime();f.type('Q');f.undo();f.cursor.selectRange(pos(0,0),pos(1,12),2);const selected=f.cursor.getSelection();
 f.start();f.type('가');f.options.failInsert=true;assert.throws(()=>f.end('가'));
 assert.deepEqual(f.state(),f.before);assert.deepEqual(f.cursor.getSelection(),selected);assert.equal(f.h.isComposing,false);assert(f.h.history.canRedo());f.clear();assert.equal(f.snapshots.size,0);
});
test('document generation change never restores a former document snapshot into the new document',()=>{
 const f=ime();f.start();f.type('가');f.wasm.documentGeneration++;let restored=0,discarded=0;
 f.wasm.restoreSnapshot=()=>restored++;f.wasm.discardSnapshot=()=>discarded++;
 f.end('가');assert.equal(restored+discarded,0);assert.equal(f.h.history.canUndo(),false);assert.equal(f.h.isComposing,false);
});
for(const options of [{cell:true},{textbox:true},{footnote:true},{form:true},{fields:[{}]},
 {start:{...pos(0,0),parentParaIndex:0}},{end:{...pos(1,12),cellPath:[{controlIndex:0,cellIndex:1,cellParaIndex:0}]}},
 {end:{...pos(1,12),sectionIndex:1}}])test('unsupported context uses the prior deletion route: '+JSON.stringify(options),()=>{
 const f=ime(options);let deletes=0;f.h.deleteSelection=()=>deletes++;f.start();
 assert.equal(deletes,1);assert.equal(input.hasBodySelectionComposition.call(f.h),false);assert.equal(f.snapshots.size,0);
});
test('repeated composition commits/cancels stay within existing snapshot budget',()=>{
 const f=ime();for(let i=0;i<110;i++){
  if(i)f.cursor.selectRange(pos(0,0),pos(0,Array.from(f.state().paragraphs[0]).length));
  f.start();f.type('가'+i);f.end('가'+i);assert(f.snapshots.size<=98);assert.equal(f.fragments.size,0);
 }f.clear();assert.equal(f.snapshots.size,0);
});

let realEngine;
async function engine(){
 return realEngine??=(async()=>{
  const {pathToFileURL}=require('node:url');
  let loader=fs.readFileSync(path.join(root,'scripts/lib/text-command-qa.mjs'),'utf8');
  loader=loader.replace("'insertTextInCellDeferredPagination',","'insertTextInCellDeferredPagination','saveSnapshot','restoreSnapshot','discardSnapshot','captureDeleteRange','restoreDeleteFragment','discardDeleteFragment','deleteRange','getFieldList','getBookmarks','applyCharFormat',");
  const {loadTextCommandQA}=await import('data:text/javascript;base64,'+Buffer.from(loader).toString('base64'));
  const Q=loadTextCommandQA(root),folder=process.env.GEULGYEOL_QA_ENGINE_DIR||path.join(root,'pkg');
  const M=await import(pathToFileURL(path.join(folder,'rhwp.js')));M.initSync({module:fs.readFileSync(path.join(folder,'rhwp_bg.wasm'))});return {Q,M};
 })();
}
for(const ext of ['hwp','hwpx'])for(const cancel of [false,true])test(`real ${ext} multi-paragraph scalar IME, cancel=${cancel}`,async()=>{
 const {Q,M}=await engine(),seed=M.HwpDocument.createEmpty();let doc,reopened;
 try{
  seed.createBlankDocument();assert(JSON.parse(seed.insertText(0,0,0,'앞🙂ABC')).ok);assert(JSON.parse(seed.splitParagraph(0,0,5)).ok);assert(JSON.parse(seed.insertText(0,1,0,'뒤끝')).ok);
  doc=new M.HwpDocument(ext==='hwp'?seed.exportHwp():seed.exportHwpx());const before=Buffer.from(doc.exportHwpx());
  const f=ime({start:pos(0,2),end:pos(1,1),reverse:true});const bridge=new Q.Bridge(doc);
  for(const key of Object.getOwnPropertyNames(Q.Bridge.prototype))if(key!=='constructor')f.wasm[key]=bridge[key].bind(bridge);
  f.start();f.type('ㄱ');f.type('가');f.end(cancel?'':'가');
  if(cancel)assert.deepEqual(Buffer.from(doc.exportHwpx()),before);
  else{
   assert.equal(doc.getTextRange(0,0,0,20),'앞🙂가끝');f.undo();assert.deepEqual(Buffer.from(doc.exportHwpx()),before);assert.equal(f.h.history.canUndo(),false);
   f.redo();assert.equal(doc.getTextRange(0,0,0,20),'앞🙂가끝');
  }
  reopened=new M.HwpDocument(ext==='hwp'?doc.exportHwp():doc.exportHwpx());assert.equal(reopened.getTextRange(0,0,0,20),cancel?'앞🙂ABC':'앞🙂가끝');f.clear();
 }finally{reopened?.free();doc?.free();seed.free();}
});


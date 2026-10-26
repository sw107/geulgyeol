// Preserve the independent review's production menu/dispatcher wiring check.
// VM-only: native clipboard, insertion, WASM queries and menu DOM are doubles.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
const root=path.resolve(__dirname,'../..');
const read=rel=>fs.readFileSync(path.join(root,rel),'utf8');
function load(source,dependencies={}) {
  const names=[...source.matchAll(/^export (?:class|function|const) (\w+)/gm)].map(m=>m[1]);
  const js=stripTypeScriptTypes(source,{mode:'transform'})
    .replace(/^import[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm,'').replace(/\bexport\s+/g,'');
  return vm.runInNewContext(js+'\n({'+names.join(',')+'})',{console,...dependencies});
}
function between(source,start,end) {
  const from=source.indexOf(start),to=source.indexOf(end,from);
  assert(from>=0&&to>from,`production source range: ${start}`);
  return source.slice(from,to);
}
const {CursorState}=load(read('rhwp-studio/src/engine/cursor.ts'));
const guardSource=between(read('rhwp-studio/src/engine/input-handler.ts'),
  '  canPastePlainText():','  /** 붙이기 (커맨드 시스템용');
const {Guard}=load('export class Guard {\n'+guardSource+'\n}');
const {plainTextPasteCommand}=load(read('rhwp-studio/src/command/commands/plain-text-paste.ts'),{showToast:()=>{}});
const {CommandRegistry}=load(read('rhwp-studio/src/command/registry.ts'));
const {CommandDispatcher}=load(read('rhwp-studio/src/command/dispatcher.ts'),{busyDepth:()=>0});
const {MenuBar}=load(read('rhwp-studio/src/ui/menu-bar.ts'),{syncMenuShortcutLabels:()=>{}});
const contextSource=between(read('rhwp-studio/src/main.ts'),
  'function getContext(): EditorContext','\nfunction setEditMode(');
function fixture() {
  const cursor=new CursorState({}),insertions=[];
  let reads=0;
  const input=Object.assign(Object.create(Guard.prototype),{
    cursor,editMode:'normal',isComposing:false,
    isInField:()=>false,isPictureCaptionEditing:()=>false,
    hasSelection:()=>cursor.hasSelection(),getCursorPosition:()=>cursor.getPosition(),
    isInTable:()=>cursor.isInCell(),isInCellSelectionMode:()=>cursor.isInCellSelectionMode(),
    isInPictureObjectSelection:()=>cursor.isInPictureObjectSelection(),
    isInTableObjectSelection:()=>cursor.isInTableObjectSelection(),
    getCellTableContext:()=>null,hasCopiedFormat:()=>false,hasMultiCellSelection:()=>false,
    canEditCurrentFormField:()=>false,canInsertTodayDate:()=>false,canUndo:()=>false,canRedo:()=>false,
    performPastePlainText:text=>insertions.push(text),
  });
  const environment={inputHandler:input,editMode:'normal',canvasView:null,
    wasm:{pageCount:1,hasTableTransposeClipboard:()=>false,getShowControlCodes:()=>false,
      getShowParagraphMarks:()=>false,getSourceFormat:()=> 'hwpx'},
    nestedTableRowAvailability:()=>({}),pictureCaptionAvailability:()=>({}),documentState:{isDirty:()=>false}};
  const getContext=vm.runInNewContext(stripTypeScriptTypes(contextSource+'\ngetContext',{mode:'transform'}),environment);
  const registry=new CommandRegistry();
  registry.register(plainTextPasteCommand);
  const dispatcher=new CommandDispatcher(registry,{getContext,getInputHandler:()=>input,
    readClipboardText:()=>{reads++;return 'TEXT';}},{emit:()=>{}});
  const classes=new Set();
  const item={dataset:{cmd:'edit:paste-plain-text'},
    classList:{toggle:(name,on)=>on?classes.add(name):classes.delete(name)},removeAttribute:()=>{}};
  const menu=Object.assign(Object.create(MenuBar.prototype),{dispatcher});
  const update=()=>{
    menu.updateMenuStates({querySelectorAll:selector=>selector==='.md-item[data-cmd]'?[item]:[]});
    return !classes.has('disabled');
  };
  return {cursor,input,environment,getContext,dispatcher,update,insertions,reads:()=>reads};
}
test('real cursor, main context, dispatcher and menu enable both ordinary body cursor and text selection',()=>{
  const f=fixture();
  assert.equal(f.getContext().hasSelection,false);
  assert.equal(f.getContext().canPastePlainText,true);
  assert.equal(f.update(),true);
  assert.equal(f.dispatcher.dispatch('edit:paste-plain-text'),true);
  // Set logical cursor state without invoking the doubled WASM's geometry APIs.
  f.cursor.anchor={sectionIndex:0,paragraphIndex:0,charOffset:0};
  f.cursor.position={sectionIndex:0,paragraphIndex:0,charOffset:3};
  assert.equal(f.cursor.hasSelection(),true);
  assert.equal(f.getContext().hasSelection,true);
  assert.equal(f.getContext().canPastePlainText,true);
  assert.equal(f.update(),true);
  assert.equal(f.dispatcher.dispatch('edit:paste-plain-text'),true);
  assert.deepEqual(f.insertions,['TEXT','TEXT']);
  assert.equal(f.reads(),2);
});
test('same production chain disables excluded live states before clipboard reads or insertion',()=>{
  const cases={
    noDocument:f=>{f.environment.wasm.pageCount=0;},
    form:f=>{f.environment.editMode='form';f.input.editMode='form';},
    composing:f=>{f.input.isComposing=true;},
    cell:f=>{f.cursor.position.parentParaIndex=0;},
    picture:f=>{f.cursor._pictureObjectSelected=true;},
    field:f=>{f.input.isInField=()=>true;},
  };
  for(const [name,change] of Object.entries(cases)) {
    const f=fixture();change(f);
    assert.equal(f.update(),false,name);
    assert.equal(f.dispatcher.dispatch('edit:paste-plain-text'),false,name);
    assert.deepEqual(f.insertions,[],name);
    assert.equal(f.reads(),0,name);
  }
});
test('dispatcher checks current input state even after the menu was previously enabled',()=>{
  const f=fixture();assert.equal(f.update(),true);
  f.input.isComposing=true;
  assert.equal(f.dispatcher.dispatch('edit:paste-plain-text'),false);
  assert.deepEqual(f.insertions,[]);
  assert.equal(f.reads(),0);
  assert.equal(f.update(),false);
});

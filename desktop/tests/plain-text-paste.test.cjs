const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
const root=path.resolve(__dirname,'../..');
const read=rel=>fs.readFileSync(path.join(root,rel),'utf8');
function load(source,dependencies={}){
  const names=[...source.matchAll(/^export (?:class|function|const) (\w+)/gm)].map(m=>m[1]);
  const js=stripTypeScriptTypes(source,{mode:'transform'}).replace(/^import[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm,'').replace(/\bexport\s+/g,'');
  return vm.runInNewContext(js+'\n({'+names.join(',')+'})',{console,...dependencies});
}
const shortcuts=load(read('rhwp-studio/src/command/shortcut-map.ts'),{detectPlatformKind:()=> 'mac'});
const mutations=[];
const keyboard=load(read('rhwp-studio/src/engine/input-handler-keyboard.ts'),{...shortcuts,
  InsertTextCommand:class {constructor(pos,text){this.pos=pos;this.text=text;}execute(){mutations.push(['insert',this.pos,this.text]);}},
  DeleteSelectionCommand:class {constructor(start){this.start=start;}execute(){mutations.push(['delete']);return this.start;}discard(){mutations.push(['discard']);}}
});
const inputSource=read('rhwp-studio/src/engine/input-handler.ts');
const methodStart=inputSource.indexOf('  canPastePlainText():');
const methodEnd=inputSource.indexOf('  /** 붙이기 (커맨드 시스템용',methodStart);
assert(methodStart>=0&&methodEnd>methodStart);
const {PasteInput}=load('export class PasteInput {\n'+inputSource.slice(methodStart,methodEnd)+'\n}',{_keyboard:keyboard});
function fixture({selection=false}={}){
  const input=Object.create(PasteInput.prototype),calls=[],operations=[];
  const position={sectionIndex:0,paragraphIndex:1,charOffset:2};
  const cursor={getPosition:()=>position,hasSelection:()=>selection,
    getSelectionOrdered:()=>({start:position,end:{...position,charOffset:4}}),blockSelectionPhase:()=>null};
  for(const name of ['isInCell','isInTextBox','isInHeaderFooter','isInFootnote','isInCellSelectionMode','isInPictureObjectSelection','isInTableObjectSelection'])cursor[name]=()=>false;
  Object.assign(input,{active:true,cursor,editMode:'normal',isComposing:false,isPictureCaptionEditing:()=>false,isInField:()=>false,
    focusTextarea:()=>calls.push('focus'),isFormMode:()=>false,executeOperation:op=>operations.push(op),
    wasm:new Proxy({}, {get(){throw Error('text-only paste must not consult rich clipboard');}})});
  return {input,calls,operations,position};
}
test('text-only paste bypasses rich clipboard and keeps Unicode multiline replacement in one existing snapshot',()=>{
  const f=fixture({selection:true});mutations.length=0;f.input.performPastePlainText('가🙂\r\n둘째');
  assert.deepEqual(f.calls,['focus']);assert.equal(f.operations.length,1);const op=f.operations[0];
  assert.equal(op.kind,'snapshot');assert.equal(op.operationType,'pastePlainText');
  const result=op.operation({splitParagraph:(sec,para,offset)=>{mutations.push(['split',sec,para,offset]);return JSON.stringify({ok:true,paraIdx:para+1});}});
  assert.deepEqual(mutations.map(c=>c[0]),['delete','discard','insert','split','insert']);
  assert.equal(mutations[2][2],'가🙂');assert.equal(mutations[3][3],4);assert.equal(mutations[4][2],'둘째');
  assert.equal(result.paragraphIndex,2);assert.equal(result.charOffset,2);
});
test('empty text preserves the selection and ordinary rich paste still chooses the original HTML path',()=>{
  const f=fixture({selection:true});f.input.performPastePlainText('');assert.equal(f.calls.length,0);assert.equal(f.operations.length,0);
  f.input.wasm={hasInternalClipboard:()=>false,getClipboardText:()=>'',clipboardHasControl:()=>false};
  const event={clipboardData:{getData:type=>type==='text/html'?'<b>rich</b>':'rich',items:[]},preventDefault(){this.prevented=true;}};
  keyboard.onPaste.call(f.input,event);assert.equal(event.prevented,true);
  assert.equal(f.operations.length,1);assert.equal(f.operations[0].operationType,'pasteHtml');
});
test('menu command and live input guard reject unsupported contexts before reading the clipboard or changing focus',()=>{
  const notices=[];const {plainTextPasteCommand:cmd}=load(read('rhwp-studio/src/command/commands/plain-text-paste.ts'),{showToast:notice=>notices.push(notice)});
  const normal={hasDocument:true,isEditable:true,isFormMode:false,canPastePlainText:true};assert.equal(cmd.canExecute(normal),true);
  for(const patch of [{hasDocument:false},{isEditable:false},{isFormMode:true},{canPastePlainText:false}])assert.equal(cmd.canExecute({...normal,...patch}),false);
  let reads=0;
  const run=f=>cmd.execute({getInputHandler:()=>f.input,readClipboardText:()=>{reads++;return 'TEXT';}});
  for(const name of ['isInCell','isInTextBox','isInHeaderFooter','isInFootnote','isInCellSelectionMode','isInPictureObjectSelection','isInTableObjectSelection']){
    const f=fixture();f.input.cursor[name]=()=>true;run(f);assert.equal(f.calls.length,0,name);
  }
  for(const patch of [{editMode:'form'},{isComposing:true},{isPictureCaptionEditing:()=>true},{isInField:()=>true}]){
    const f=fixture();Object.assign(f.input,patch);run(f);assert.equal(f.calls.length,0);
  }
  for(const patch of [{parentParaIndex:0},{cellPath:[{}]}]){const f=fixture();Object.assign(f.position,patch);run(f);assert.equal(f.calls.length,0);}
  assert.equal(reads,0);const f=fixture();run(f);assert.equal(reads,1);assert.equal(f.operations.length,1);
  cmd.execute({getInputHandler:()=>f.input,readClipboardText:()=>null});assert.equal(f.operations.length,1);assert.equal(notices.length,1);
  assert(read('rhwp-studio/index.html').includes('data-cmd="edit:paste-plain-text"'));
  assert(read('rhwp-studio/src/command/commands/edit.ts').includes('  plainTextPasteCommand,'));
});
test('native IPC returns only text to the trusted main frame and preload uses a synchronous text-only channel',()=>{
  const {installPlainTextClipboard}=require('../plain-text-clipboard.cjs');
  const origin='http://127.0.0.1:33333',frame={url:origin+'/'},contents={mainFrame:frame};
  const win={webContents:contents,isDestroyed:()=>false};
  const trusted=vm.runInNewContext('('+read('desktop/main.cjs').split('\n').find(line=>line.startsWith('function trusted('))+')',{win,origin});
  let handler,reads=0;
  installPlainTextClipboard({on:(name,fn)=>{assert.equal(name,'baram:clipboard-text');handler=fn;}},{readText:()=>{reads++;return '가🙂\n둘째';}},trusted);
  for(const event of [{sender:contents,senderFrame:{}},{sender:{},senderFrame:frame},{sender:contents,senderFrame:{url:'https://example.com/'}}]){
    handler(event);assert.equal(event.returnValue,null);
  }
  assert.equal(reads,0);const event={sender:contents,senderFrame:frame};handler(event);assert.equal(event.returnValue,'가🙂\n둘째');assert.equal(reads,1);
  frame.url='https://example.com/';handler(event);assert.equal(event.returnValue,null);assert.equal(reads,1);
  let api,channel;
  vm.runInNewContext(read('desktop/preload.cjs'),{require:name=>{assert.equal(name,'electron');return {contextBridge:{exposeInMainWorld:(name,value)=>{assert.equal(name,'baram');api=value;}},ipcRenderer:{sendSync:name=>{channel=name;return 'TEXT';}}};}});
  assert.equal(api.clipboardText(),'TEXT');assert.equal(channel,'baram:clipboard-text');
  const readerSource=read('rhwp-studio/src/command/native-clipboard.ts');
  const reader=load(readerSource,{window:{parent:{baram:api}}});
  assert.equal(reader.readNativeClipboardText(),'TEXT');
  assert.equal(load(readerSource,{window:{parent:{}}}).readNativeClipboardText(),null);
  assert(read('rhwp-studio/src/main.ts').includes('readClipboardText: readNativeClipboardText'));
});
test('Ctrl/Cmd+Shift+V including Korean physical KeyV routes before submode state changes and prevents rich browser fallback',()=>{
  for(const patch of [{ctrlKey:true},{metaKey:true},{metaKey:true,key:'ㅍ'},{ctrlKey:true,key:'Process',isComposing:true,keyCode:229}]){
    const event={key:'V',code:'KeyV',ctrlKey:false,metaKey:false,shiftKey:true,altKey:false,isComposing:false,keyCode:0,...patch,preventDefault(){this.defaultPrevented=true;}};
    assert.equal(shortcuts.matchShortcut(event,shortcuts.defaultShortcuts),'edit:paste-plain-text');
    const calls=[];keyboard.onKeyDown.call({active:true,isComposing:false,dispatcher:{dispatch:id=>calls.push(id)}},event);
    assert.equal(event.defaultPrevented,true);assert.deepEqual(calls,event.isComposing?[]:['edit:paste-plain-text']);
  }
});

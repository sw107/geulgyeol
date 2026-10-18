// Current BookmarkDialog plus real WASM bookmark insertion/snapshot persistence.
// DOM widgets and refresh scheduling are adapters; actual app validation is separate.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {stripTypeScriptTypes} from 'node:module';
import {pathToFileURL} from 'node:url';
import {test} from 'node:test';

const repo=path.resolve(import.meta.dirname,'../..'),read=n=>fs.readFileSync(repo+'/rhwp-studio/src/'+n,'utf8');
const strip=s=>stripTypeScriptTypes(s,{mode:'transform'}).replace(/^import[\s\S]*?;\s*$/gm,'');
const load=s=>import('data:text/javascript;base64,'+Buffer.from(s).toString('base64'));
const source=fs.readFileSync(process.env.GEULGYEOL_BOOKMARK_DIALOG_SOURCE??repo+'/rhwp-studio/src/ui/bookmark-dialog.ts','utf8');
const {BookmarkDialog}=await load('const enableDialogDrag=()=>{};\n'+strip(source));
const commands=await load('const MAX_PAGE_LOCAL_TEXT_EDIT_CHARS=10000;\n'+strip(read('engine/command.ts')));
globalThis.__bookmarkSuggestionCommands=commands;
const {CommandHistory}=await load('const {NO_TEXT_MUTATION_EFFECTS}=globalThis.__bookmarkSuggestionCommands;\n'+strip(read('engine/history.ts')));
const pkg=process.env.GEULGYEOL_BOOKMARK_WASM_PKG??repo+'/pkg';
const M=await import(pathToFileURL(fs.realpathSync(pkg+'/rhwp.js')));
M.initSync({module:fs.readFileSync(pkg+'/rhwp_bg.wasm')});

function fixture(names,bytes){
 const d=bytes?new M.HwpDocument(bytes):M.HwpDocument.createEmpty();
 if(!bytes){d.createBlankDocument();d.insertText(0,0,0,'본문🙂 보존');for(const name of names)assert(JSON.parse(d.addBookmark(0,0,2,name)).ok);}
 d.exportHwp();const history=new CommandHistory(),snapshots=new Set();let refreshes=0,focused=0;
 const pos={sectionIndex:0,paragraphIndex:0,charOffset:3};
 const wasm={documentGeneration:1,getBookmarks:()=>JSON.parse(d.getBookmarks()),
  addBookmark:(...a)=>JSON.parse(d.addBookmark(...a)),saveSnapshot(){const id=d.saveSnapshot();snapshots.add(id);return id;},
  restoreSnapshot:id=>d.restoreSnapshot(id),discardSnapshot(id){d.discardSnapshot(id);snapshots.delete(id);}};
 const ih={getBodyBookmarkTarget:()=>pos,focus(){focused++;},executeOperation(desc){assert.equal(desc.kind,'snapshot');history.execute(new commands.SnapshotCommand(desc.operationType,pos,pos,desc.operation),wasm);refreshes++;}};
 const services={wasm,getInputHandler:()=>ih,getContext:()=>({hasDocument:true,isEditable:true,isFormMode:false})};
 const dialog=new BookmarkDialog(services);
 const refresh=()=>Object.assign(dialog,{_open:true,bookmarks:wasm.getBookmarks(),documentGeneration:1,nameInput:{value:''},statusLabel:{style:{},textContent:''},overlay:{remove(){}}});refresh();
 const state=()=>({hwp:Buffer.from(d.exportHwp()),hwpx:Buffer.from(d.exportHwpx()),text:d.getTextFileText(),bookmarks:wasm.getBookmarks()});
 return {d,wasm,ih,services,dialog,history,snapshots,refresh,state,refreshes:()=>refreshes,focused:()=>focused,close(){history.clear(wasm);assert.equal(snapshots.size,0);d.free();}};
}

for(const [label,names,expected] of [
 ['empty',[],'책갈피1'],['sequential',['책갈피1','책갈피2'],'책갈피3'],
 ['deleted gap',['책갈피1','책갈피3'],'책갈피4'],
 ['several occupied suffixes',['책갈피1','책갈피4','책갈피5'],'책갈피6'],
 ['custom names',['장 서론','책갈피3'],'책갈피4'],
 ['different spelling',['책갈피01','책갈피１'],'책갈피3'],
])test(`${label}: default name is available and suggesting does not mutate document/history`,()=>{
 const f=fixture(names);try{const before=f.state();f.dialog.suggestName();assert.equal(f.dialog.nameInput.value,expected);assert(!before.bookmarks.some(b=>b.name===expected));assert.deepEqual(f.state(),before);assert.equal(f.history.canUndo(),false);assert.equal(f.refreshes(),0);assert.equal(f.snapshots.size,0);}finally{f.close();}
});

test('noneditable nested bookmark names also reserve the default name',()=>{
 const f=fixture([]);try{f.dialog.bookmarks=[{name:'책갈피2',editable:false}];f.dialog.suggestName();assert.equal(f.dialog.nameInput.value,'책갈피3');assert.equal(f.history.canUndo(),false);}finally{f.close();}
});
test('without an input handler the current input is retained',()=>{
 const f=fixture([]);try{f.services.getInputHandler=()=>null;f.dialog.nameInput.value='유지할 입력';f.dialog.suggestName();assert.equal(f.dialog.nameInput.value,'유지할 입력');}finally{f.close();}
});
for(const ext of ['hwp','hwpx'])test(`${ext}: unchanged default inserts once, undo/redo and reopen preserve existing bookmarks and text`,()=>{
 const seed=fixture(['책갈피1','책갈피3']);let f,reopened;try{
  f=fixture([],seed.state()[ext]);const before=f.state();f.dialog.suggestName();const proposed=f.dialog.nameInput.value;f.dialog.doAdd();assert.equal(f.dialog.isOpen(),false,f.dialog.statusLabel.textContent);assert.equal(f.history.undoStack.length,1);assert.equal(f.refreshes(),1);assert.equal(f.focused(),1);
  const after=f.state();assert.equal(after.text,before.text);assert.equal(after.bookmarks.length,before.bookmarks.length+1);for(const old of before.bookmarks)assert.deepEqual(after.bookmarks.find(b=>b.name===old.name),old);assert.equal(after.bookmarks.find(b=>b.name===proposed)?.charPos,3);
  for(let i=0;i<3;i++){f.history.undo(f.wasm);assert.deepEqual(f.state(),before);f.history.redo(f.wasm);assert.deepEqual(f.state(),after);}
  f.history.undo(f.wasm);const redo=f.history.peekRedoTop(),n=f.snapshots.size;f.refresh();f.dialog.suggestName();assert.equal(f.dialog.nameInput.value,proposed);assert.equal(f.history.peekRedoTop(),redo);assert.equal(f.snapshots.size,n);f.history.redo(f.wasm);f.refresh();f.dialog.suggestName();assert(!f.wasm.getBookmarks().some(b=>b.name===f.dialog.nameInput.value));
  reopened=new M.HwpDocument(f.state()[ext]);assert.equal(reopened.getTextFileText(),after.text);assert.deepEqual(JSON.parse(reopened.getBookmarks()),after.bookmarks);
 }finally{reopened?.free();f?.close();seed.close();}
});

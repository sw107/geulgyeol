// Actual BookmarkDialog navigation against current WASM bookmark coordinates.
// DOM painting and cursor movement are observed adapters; no GUI claim here.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {stripTypeScriptTypes} from 'node:module';
import {pathToFileURL} from 'node:url';
import {test} from 'node:test';

const repo=path.resolve(import.meta.dirname,'../..');
const source=fs.readFileSync(process.env.GEULGYEOL_BOOKMARK_DIALOG_SOURCE??repo+'/rhwp-studio/src/ui/bookmark-dialog.ts','utf8');
const js=stripTypeScriptTypes(source,{mode:'transform'}).replace(/^import[\s\S]*?;\s*$/gm,'');
const {BookmarkDialog}=await import('data:text/javascript;base64,'+Buffer.from('const enableDialogDrag=()=>{};\n'+js).toString('base64'));
const pkg=process.env.GEULGYEOL_BOOKMARK_WASM_PKG??repo+'/pkg';
const M=await import(pathToFileURL(fs.realpathSync(pkg+'/rhwp.js')));
M.initSync({module:fs.readFileSync(pkg+'/rhwp_bg.wasm')});

function documentFixture(){
 const d=M.HwpDocument.createEmpty();d.createBlankDocument();d.insertText(0,0,0,'앞🙂 책갈피 뒤');
 assert.equal(JSON.parse(d.addBookmark(0,0,3,'목적지')).ok,true);return d;
}
function fixture(){
 const docs=[documentFixture()];let current=docs[0],generation=1,hasDocument=true;
 const moves=[];let removed=0,focused=0;const cursor={sectionIndex:0,paragraphIndex:0,charOffset:0};
 const ih={moveCursorTo(p){moves.push(p);Object.assign(cursor,p);return true;},focus(){focused++;}};
 const services={wasm:{get documentGeneration(){return generation;},getBookmarks(){return JSON.parse(current.getBookmarks());}},getInputHandler:()=>ih,getContext:()=>({hasDocument,isEditable:false,isFormMode:false})};
 const dialog=new BookmarkDialog(services);
 Object.assign(dialog,{_open:true,bookmarks:services.wasm.getBookmarks(),selectedIdx:0,documentGeneration:generation,statusLabel:{textContent:'',style:{}},overlay:{remove(){removed++;}}});
 return {dialog,services,ih,moves,cursor,get d(){return current;},focused:()=>focused,removed:()=>removed,
  snapshot:()=>({hwp:Buffer.from(current.exportHwp()),hwpx:Buffer.from(current.exportHwpx()),bookmarks:JSON.parse(current.getBookmarks())}),
  switchDocument(){current=documentFixture();docs.push(current);generation++;},
  noDocument(){hasDocument=false;},close(){for(const d of docs)d.free();}};
}

test('a live bookmark navigates exactly once in a read-only document without document mutation',()=>{
 const f=fixture();try{const before=f.snapshot();f.dialog.doMove();assert.deepEqual(f.moves,[{sectionIndex:0,paragraphIndex:0,charOffset:3}]);assert.equal(f.removed(),1);assert.equal(f.focused(),1);assert.deepEqual(f.snapshot(),before);}finally{f.close();}
});
test('old list cannot navigate a new document even when bookmark names and coordinates match',()=>{
 const f=fixture();try{f.switchDocument();const before=f.snapshot();f.dialog.doMove();assert.equal(f.moves.length,0);assert.equal(f.removed(),0);assert.equal(f.focused(),0);assert.equal(f.dialog.isOpen(),true);assert.match(f.dialog.statusLabel.textContent,/문서|목록/);assert.deepEqual(f.snapshot(),before);}finally{f.close();}
});
for(const change of ['moved','renamed','deleted'])test(`a ${change} bookmark rejects stale coordinates and keeps the list open`,()=>{
 const f=fixture();try{const bm=JSON.parse(f.d.getBookmarks())[0];if(change==='moved')f.d.insertText(0,0,0,'추가🙂');else if(change==='renamed')assert(JSON.parse(f.d.renameBookmark(bm.sec,bm.para,bm.ctrlIdx,'바뀐 이름')).ok);else assert(JSON.parse(f.d.deleteBookmark(bm.sec,bm.para,bm.ctrlIdx)).ok);const before=f.snapshot();f.dialog.doMove();assert.equal(f.moves.length,0);assert.equal(f.dialog.isOpen(),true);assert.match(f.dialog.statusLabel.textContent,/책갈피|목록/);assert.deepEqual(f.snapshot(),before);}finally{f.close();}
});
test('failed exact movement never jumps to unrelated adjacent paragraphs or closes the list',()=>{
 const f=fixture();try{f.ih.moveCursorTo=p=>{f.moves.push(p);return false;};const before=f.snapshot();f.dialog.doMove();assert.deepEqual(f.moves,[{sectionIndex:0,paragraphIndex:0,charOffset:3}]);assert.equal(f.removed(),0);assert.equal(f.focused(),0);assert.equal(f.dialog.isOpen(),true);assert.match(f.dialog.statusLabel.textContent,/이동/);assert.deepEqual(f.snapshot(),before);}finally{f.close();}
});
test('navigation reports a bridge failure without closing or moving',()=>{
 const f=fixture();try{f.services.wasm.getBookmarks=()=>{throw Error('목록 조회 실패');};f.dialog.doMove();assert.equal(f.moves.length,0);assert.equal(f.dialog.isOpen(),true);assert.match(f.dialog.statusLabel.textContent,/목록 조회 실패/);}finally{f.close();}
});
for(const state of ['closed','no-document','no-handler'])test(`${state} does not navigate`,()=>{
 const f=fixture();try{if(state==='closed')f.dialog._open=false;if(state==='no-document')f.noDocument();if(state==='no-handler')f.services.getInputHandler=()=>null;f.dialog.doMove();assert.equal(f.moves.length,0);assert.equal(f.removed(),0);}finally{f.close();}
});
test('nested navigation hints remain available without granting mutation permission',()=>{
 const f=fixture();try{const nested={name:'하위 책갈피',sec:0,para:0,ctrlIdx:2,charPos:0,editable:false};f.services.wasm.getBookmarks=()=>[nested];f.dialog.bookmarks=[nested];f.dialog.doMove();assert.deepEqual(f.moves,[{sectionIndex:0,paragraphIndex:0,charOffset:0}]);assert.equal(f.removed(),1);}finally{f.close();}
});
for(const ext of ['hwp','hwpx'])test(`${ext} reopened bookmark navigation keeps text, formatting, and bookmark bytes unchanged`,()=>{
 const f=fixture();let reopened;try{const data=f.snapshot();reopened=new M.HwpDocument(data[ext]);f.services.wasm.getBookmarks=()=>JSON.parse(reopened.getBookmarks());f.dialog.bookmarks=f.services.wasm.getBookmarks();const before={hwp:Buffer.from(reopened.exportHwp()),hwpx:Buffer.from(reopened.exportHwpx())};f.dialog.doMove();assert.equal(f.moves.length,1);assert.deepEqual(Buffer.from(reopened.exportHwp()),before.hwp);assert.deepEqual(Buffer.from(reopened.exportHwpx()),before.hwpx);}finally{reopened?.free();f.close();}
});

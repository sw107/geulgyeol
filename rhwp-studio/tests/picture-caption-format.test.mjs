// Real current-source format handler, caption router, history, cursor validation and WASM.
// Node >=22.18; requires built SDK at ../../pkg or GEULGYEOL_CAPTION_WASM_PKG.
// Cursor painting/DOM and batch scheduling are adapters; Electron validation is separate.
import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {test} from 'node:test';import {stripTypeScriptTypes} from 'node:module';import {pathToFileURL} from 'node:url';
const repo=path.resolve(import.meta.dirname,'../..'),src=repo+'/rhwp-studio/src/';
const read=n=>fs.readFileSync(src+n,'utf8');
function load(source,imports={}){
 const s=stripTypeScriptTypes(source,{mode:'transform'}),names=[...s.matchAll(/\bexport (?:class|function|const|let) (\w+)/g)].map(m=>m[1]),bindings=[];
 for(const m of s.matchAll(/^import\s+\{([\s\S]*?)\}\s+from\s+['"]([^'"]+)['"];?/gm)){assert(m[2] in imports,m[2]);bindings.push(`const {${m[1].replace(/\bas\b/g,':')}}=imports[${JSON.stringify(m[2])}];`);}
 for(const m of s.matchAll(/^import\s+\*\s+as\s+(\w+)\s+from\s+['"]([^'"]+)['"];?/gm)){assert(m[2] in imports);bindings.push(`const ${m[1]}=imports[${JSON.stringify(m[2])}];`);}
 return new Function('imports',bindings.join('\n')+'\n'+s.replace(/^import[\s\S]*?;\s*$/gm,'').replace(/\bexport (?=class|function|const|let)/g,'')+`\nreturn {${names}};`)(imports);
}
function method(s,n){const a=s.indexOf(`  ${n}(`)>=0?s.indexOf(`  ${n}(`):s.indexOf(`  private ${n}(`),z=s.indexOf('\n  }\n',a);assert(a>=0&&z>a,n);return s.slice(a,z+4);}
const objects=load(read('engine/object-props.ts'),{'./equation-target':{}});
const commands=load(read('engine/command.ts'),{'./object-props':objects,'./input-edit-invalidation':{MAX_PAGE_LOCAL_TEXT_EDIT_CHARS:10000}});
const {CommandHistory}=load(read('engine/history.ts'),{'./command':commands});const toasts=[];
const caption=load(read('engine/input-handler-caption.ts'),{'./command':commands,'@/ui/toast':{showToast:x=>toasts.push(x)}});
const input=read('engine/input-handler.ts');
const {Handler}=load(`import * as commands from './command';import * as _captionText from './caption';
const {ApplyCharFormatCommand,SnapshotCommand,SubmodeSnapshotCommand,SubmodeSelectionSnapshotCommand,IMMEDIATE_TEXT_MUTATION_EFFECTS}=commands;
export class Handler {${['applyCharFormat','executeOperation','isOperationAllowedInEditMode','restoreSelectionAfterUndo','restoreSelectionAfterRedo'].map(n=>method(input,n)).join('\n')}}`,{'./command':commands,'./caption':caption});
const {Cursor}=load(`export class Cursor {${method(read('engine/cursor.ts'),'selectPictureCaptionRange')}}`);
const bridge=read('core/wasm-bridge.ts');
const {Bridge}=load(`export class Bridge {doc;constructor(d){this.doc=d;}assertDocumentWritable(){}runInBatch(fn){return fn();}
${['getPictureProperties','getPictureCaptionEditInfo','getCellCharPropertiesAt','applyCharFormatInCell','saveSnapshot','restoreSnapshot','discardSnapshot','getParagraphLength','getCharPropertiesAt','getCharFormatRuns','applyCharFormat','setCharShapeId','getCellCharPropertiesAtByPath','getCellCharFormatRunsByPath','getCellParagraphLengthByPath','applyCharFormatInCellByPath','setCharShapeIdInCellByPath'].map(n=>method(bridge,n)).join('\n')}}`);
const pkg=process.env.GEULGYEOL_CAPTION_WASM_PKG??repo+'/pkg';
const M=await import(pathToFileURL(fs.realpathSync(pkg+'/rhwp.js')));M.initSync({module:fs.readFileSync(pkg+'/rhwp_bg.wasm')});
const png=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j9ZkAAAAASUVORK5CYII=','base64'));
const count=s=>[...s].length,compare=(a,b)=>(a.cellParaIndex??0)-(b.cellParaIndex??0)||a.charOffset-b.charOffset;
function fixture(multi=false){
 const d=M.HwpDocument.createEmpty();d.createBlankDocument();d.insertText(0,0,0,'본문🙂 보존');d.splitParagraph(0,0,count('본문🙂 보존'));d.insertText(0,1,0,'이웃 본문');
 const r=JSON.parse(d.insertPicture(0,0,count('본문🙂 보존'),'[]',png,7200,3600,1,1,'png','서식 회귀 그림'));assert(r.ok);
 d.setPictureProperties(0,r.paraIdx,r.controlIdx,JSON.stringify({hasCaption:true,captionDirection:'Bottom',captionWidth:8504,captionSpacing:850}));
 const text='기존😀 첫줄';d.insertTextInCell(0,r.paraIdx,r.controlIdx,0,0,4,text);
 if(multi){d.splitParagraphInCell(0,r.paraIdx,r.controlIdx,0,0,4+count(text));d.insertTextInCell(0,r.paraIdx,r.controlIdx,0,1,0,'둘째 캡션🙂');}
 const w=new Bridge(d),history=new CommandHistory(),cursor=new Cursor(),h=new Handler(),snapshots=new Set(),events=[];
 const start={sectionIndex:0,paragraphIndex:0,charOffset:4,parentParaIndex:r.paraIdx,controlIndex:r.controlIdx,cellIndex:0,cellParaIndex:0,isTextBox:true},end={...start,charOffset:7};
 let pending={italic:false},dirty=false;const flags={header:false,note:false};
 Object.assign(cursor,{wasm:w,anchor:{...start},position:{...end},phase:null,
  isInHeaderFooter:()=>flags.header,isInFootnote:()=>flags.note,
  getPosition(){return {...this.position};},getRect:()=>null,resetPreferredX(){},updateRect(){},
  getSelection(){return this.anchor?{anchor:{...this.anchor},focus:{...this.position}}:null;},
  getSelectionOrdered(){if(!this.anchor)return null;return compare(this.anchor,this.position)<=0?{start:{...this.anchor},end:{...this.position}}:{start:{...this.position},end:{...this.anchor}};},
  blockSelectionPhase(){return this._blockSelectionMode?this._expandPhase:null;},
  moveTo(p){this.position={...p};this.anchor=null;},clearSelection(){this.anchor=null;this._blockSelectionMode=false;this._expandPhase=0;},
 });
 const save=w.saveSnapshot.bind(w),discard=w.discardSnapshot.bind(w);w.saveSnapshot=()=>{const id=save();snapshots.add(id);return id;};w.discardSnapshot=id=>{discard(id);assert(snapshots.delete(id));};
 Object.assign(h,{wasm:w,history,cursor,editMode:'normal',getSelectedCellBlock:()=>null,getPendingCharShape:()=>pending,
  getNonEmptySelection:()=>{const s=cursor.getSelectionOrdered();return s&&compare(s.start,s.end)!==0?s:null;},
  stagePendingCharShape:props=>{pending={...pending,...props};},
  prepareTextMutationBeforeCursor:()=>false,refreshAfterOperation(){dirty=true;events.push('refresh');},updateCaret(){},
  eventBus:{emit(){}},caretLayoutReveal:{requestFor(){}},
  applyCharFormatInHeaderFooterSelection:()=>events.push('header'),getFootnoteCharFormatSelection:()=>null,stagePendingFootnoteCharShape:()=>events.push('note'),
 });
 const select=(a=start,b=end,phase=null)=>{assert(cursor.selectPictureCaptionRange(a,b,phase));};
 const data=()=>{d.exportHwp();const ps=JSON.parse(d.getPictureCaptionEditInfo(0,r.paraIdx,r.controlIdx)).paragraphs;return {
  hwp:Buffer.from(d.exportHwp()),hwpx:Buffer.from(d.exportHwpx()),body:d.getTextFileText(),picture:JSON.parse(d.getPictureProperties(0,r.paraIdx,r.controlIdx)),image:Buffer.from(d.getControlImageData(0,r.paraIdx,'[]',r.controlIdx)),
  caption:ps.map((p,i)=>({...p,chars:[...p.text].map((_,j)=>JSON.parse(d.getCellCharPropertiesAt(0,r.paraIdx,r.controlIdx,0,i,j)))}))};};
 return {d,w,h,history,cursor,r,start,end,select,data,snapshots,events,flags,pending:()=>structuredClone(pending),dirty:()=>dirty,
  undo(){const p=history.undo(w);cursor.moveTo(p);h.restoreSelectionAfterUndo(history.peekRedoTop());},
  redo(){const p=history.redo(w);cursor.moveTo(p);h.restoreSelectionAfterRedo(history.peekUndoTop());},
  close(){history.clear(w);assert.equal(snapshots.size,0);d.free();}};
}
const props={bold:true,italic:true,fontSize:1700,textColor:'#245678'};
function mixedFixture(){
 const f=fixture();
 // Deliberately keep a plain first character before the styled runs. A partial
 // change must not turn the 23pt bold pink run into the first character's style.
 f.d.applyCharFormatInCell(0,f.r.paraIdx,f.r.controlIdx,0,0,5,6,JSON.stringify({bold:true,fontSize:2300,textColor:'#ac1256'}));
 f.d.applyCharFormatInCell(0,f.r.paraIdx,f.r.controlIdx,0,0,7,8,JSON.stringify({underline:true,fontSize:1450,textColor:'#3465a4'}));
 f.select({...f.end,charOffset:9},f.start,1);
 return f;
}
const effective=({charShapeId,...rest})=>rest;
for(const requested of [{italic:true},{textColor:'#789abc'},{fontSize:1900},{bold:false}])test(`partial ${Object.keys(requested)[0]} change preserves every unrequested mixed-caption property through undo/redo and both formats`,()=>{
 const f=mixedFixture();try{
  const before=f.data(),selection=f.cursor.getSelection();f.h.applyCharFormat(requested);const after=f.data();
  assert.equal(f.history.undoStack.length,1);assert.equal(after.caption[0].text,before.caption[0].text);assert.deepEqual(after.body,before.body);assert.deepEqual(after.image,before.image);assert.deepEqual(after.picture,before.picture);
  for(let i=0;i<before.caption[0].chars.length;i++)assert.deepEqual(effective(after.caption[0].chars[i]),{...effective(before.caption[0].chars[i]),...(i>=4&&i<9?requested:{})},`character ${i}: only requested properties change`);
  const depth=f.history.undoStack.length,n=f.snapshots.size,events=f.events.length;f.h.applyCharFormat(requested);assert.equal(f.history.undoStack.length,depth);assert.equal(f.snapshots.size,n);assert.equal(f.events.length,events);assert.deepEqual(f.data(),after);
  for(let i=0;i<3;i++){f.undo();assert.deepEqual(f.data(),before);assert.deepEqual(f.cursor.getSelection(),selection);f.redo();assert.deepEqual(f.data(),after);assert.deepEqual(f.cursor.getSelection(),selection);}
  for(const ext of ['hwp','hwpx']){const d=new M.HwpDocument(after[ext]);try{assert.equal(d.getTextInCell(0,f.r.paraIdx,f.r.controlIdx,0,0,0,1000),after.caption[0].text);for(let i=0;i<after.caption[0].chars.length;i++)assert.deepEqual(effective(JSON.parse(d.getCellCharPropertiesAt(0,f.r.paraIdx,f.r.controlIdx,0,0,i))),effective(after.caption[0].chars[i]),`${ext} character ${i}`);assert.deepEqual(Buffer.from(d.getControlImageData(0,f.r.paraIdx,'[]',f.r.controlIdx)),after.image);}finally{d.free();}}
 }finally{f.close();}
});
for(const fault of ['false','throw'])test(`later mixed-style run ${fault} restores all earlier run mutations and pending redo atomically`,()=>{
 const f=mixedFixture();try{
  f.h.applyCharFormat({italic:true});f.undo();const before=f.data(),selection=f.cursor.getSelection(),redo=f.history.peekRedoTop(),pending=f.pending(),dirty=f.dirty(),n=f.snapshots.size,events=f.events.length,toastCount=toasts.length;
  const setter=f.w.applyCharFormatInCell.bind(f.w);let calls=0;
  f.w.applyCharFormatInCell=(...args)=>{calls++;const result=setter(...args);if(calls===2){if(fault==='throw')throw Error('injected after second style run mutation');return JSON.stringify({ok:false});}return result;};
  f.h.applyCharFormat({italic:true});assert.equal(calls,2);assert.deepEqual(f.data(),before);assert.equal(f.history.peekRedoTop(),redo);assert.equal(f.snapshots.size,n);assert.equal(f.history.undoStack.length,0);assert.deepEqual(f.cursor.getSelection(),selection);assert.deepEqual(f.pending(),pending);assert.equal(f.dirty(),dirty);assert.equal(f.events.length,events);assert.equal(toasts.length,toastCount+1);
 }finally{f.close();}
});
test('the reproduced empty-path table command is replaced only at the caption handler boundary',()=>{
 const f=fixture();try{const before=f.data();assert.throws(()=>new commands.ApplyCharFormatCommand(f.start,f.end,props).execute(f.w),/경로가 비어있습니다/);assert.deepEqual(f.data(),before);f.h.applyCharFormat(props);assert.equal(f.history.peekUndoTop().constructor.name,'CaptionFormatCommand');assert(f.data().caption[0].chars.slice(4,7).every(c=>c.bold));}finally{f.close();}
});
for(const reverse of [false,true])test(`natural format handler uses one snapshot and restores ${reverse?'backward':'forward'} caption selection on undo/redo`,()=>{
 const f=fixture();try{
  f.select(reverse?f.end:f.start,reverse?f.start:f.end,2);const selection=f.cursor.getSelection(),before=f.data();
  f.h.applyCharFormat(props);const after=f.data();assert.equal(f.history.undoStack.length,1);assert.equal(f.snapshots.size,1);assert.equal(f.history.peekUndoTop().type,'applyCharFormat');
  assert(after.caption[0].chars.slice(4,7).every(c=>c.bold&&c.italic&&c.fontSize===1700&&c.textColor==='#245678'));
  assert.deepEqual(after.body,before.body);assert.deepEqual(after.image,before.image);assert.deepEqual(after.picture,before.picture);assert.equal(after.caption[0].text,before.caption[0].text);
  assert.deepEqual(f.cursor.getSelection(),selection);assert.equal(f.cursor.blockSelectionPhase(),2);
  for(let i=0;i<3;i++){f.undo();assert.deepEqual(f.data(),before);assert.deepEqual(f.cursor.getSelection(),selection);assert.equal(f.cursor.blockSelectionPhase(),2);f.redo();assert.deepEqual(f.data(),after);assert.deepEqual(f.cursor.getSelection(),selection);assert.equal(f.cursor.blockSelectionPhase(),2);}
  for(const ext of ['hwp','hwpx']){const reopened=new M.HwpDocument(after[ext]);try{assert.equal(reopened.getTextInCell(0,f.r.paraIdx,f.r.controlIdx,0,0,0,1000),after.caption[0].text);for(let at=4;at<7;at++){const c=JSON.parse(reopened.getCellCharPropertiesAt(0,f.r.paraIdx,f.r.controlIdx,0,0,at));assert(c.bold&&c.italic&&c.fontSize===1700&&c.textColor==='#245678');}assert.deepEqual(Buffer.from(reopened.getControlImageData(0,f.r.paraIdx,'[]',f.r.controlIdx)),after.image);}finally{reopened.free();}}
 }finally{f.close();}
});
test('multiple caption paragraphs format atomically without changing the number prefix or text',()=>{
 const f=fixture(true);try{f.select({...f.start,charOffset:5},{...f.end,cellParaIndex:1,charOffset:3});const before=f.data();f.h.applyCharFormat(props);const after=f.data();assert.equal(f.history.undoStack.length,1);assert.deepEqual(after.caption.map(p=>p.text),before.caption.map(p=>p.text));assert.deepEqual(after.caption[0].chars.slice(0,5),before.caption[0].chars.slice(0,5));assert(after.caption[1].chars.slice(0,3).every(c=>c.bold));f.undo();assert.deepEqual(f.data(),before);f.redo();assert.deepEqual(f.data(),after);}finally{f.close();}
});
test('same-value format preserves pending redo, exact selection, pending style, dirty and snapshots',()=>{
 const f=fixture();try{f.select(f.end,f.start,1);f.h.applyCharFormat(props);f.undo();const top=f.history.peekRedoTop(),before=f.data(),selection=f.cursor.getSelection(),pending=f.pending(),dirty=f.dirty(),n=f.snapshots.size,events=f.events.length;f.h.applyCharFormat({bold:false});assert.deepEqual(f.data(),before);assert.equal(f.history.peekRedoTop(),top);assert.equal(f.history.undoStack.length,0);assert.equal(f.snapshots.size,n);assert.deepEqual(f.cursor.getSelection(),selection);assert.deepEqual(f.pending(),pending);assert.equal(f.dirty(),dirty);assert.equal(f.events.length,events);}finally{f.close();}
});
for(const fault of ['false','throw'])test(`${fault} after a real first-paragraph mutation rolls back the whole format and retains redo/selection`,()=>{
 const f=fixture(true);try{
  f.select({...f.start,charOffset:5},{...f.end,cellParaIndex:1,charOffset:3});f.h.applyCharFormat(props);f.undo();
  const before=f.data(),selection=f.cursor.getSelection(),redo=f.history.peekRedoTop(),pending=f.pending(),dirty=f.dirty(),n=f.snapshots.size,eventCount=f.events.length,toastCount=toasts.length,setter=f.w.applyCharFormatInCell.bind(f.w);let calls=0;
  f.w.applyCharFormatInCell=(...args)=>{calls++;const result=setter(...args);if(calls===2){if(fault==='throw')throw Error('injected after mutation');return JSON.stringify({ok:false});}return result;};
  f.h.applyCharFormat(props);assert.equal(calls,2);assert.deepEqual(f.data(),before);assert.equal(f.history.peekRedoTop(),redo);assert.equal(f.snapshots.size,n);assert.deepEqual(f.cursor.getSelection(),selection);assert.deepEqual(f.pending(),pending);assert.equal(f.dirty(),dirty);assert.equal(f.events.length,eventCount);assert.equal(toasts.length,toastCount+1);
 }finally{f.close();}
});
for(const guard of ['number-prefix','cross-container','rotation','side','form'])test(`${guard} caption selection is rejected before mutation`,()=>{
 const f=fixture();try{
  if(guard==='number-prefix')f.cursor.anchor={...f.start,charOffset:0};
  if(guard==='cross-container')f.cursor.anchor={sectionIndex:0,paragraphIndex:1,charOffset:0};
  if(guard==='rotation'||guard==='side')f.d.setPictureProperties(0,f.r.paraIdx,f.r.controlIdx,JSON.stringify(guard==='rotation'?{rotationAngle:90}:{hasCaption:true,captionDirection:'Left'}));
  if(guard==='form')f.h.editMode='form';
  f.d.exportHwp();const before=Buffer.from(f.d.exportHwpx()),n=toasts.length;f.h.applyCharFormat(props);assert.deepEqual(Buffer.from(f.d.exportHwpx()),before);assert.equal(f.history.canUndo(),false);assert.equal(f.snapshots.size,0);assert.equal(toasts.length,n+1);
 }finally{f.close();}
});
test('caption caret keeps the existing pending-format path',()=>{
 const f=fixture();try{f.cursor.clearSelection();f.h.applyCharFormat({bold:true});assert.equal(f.pending().bold,true);assert.equal(f.history.canUndo(),false);assert.equal(f.snapshots.size,0);}finally{f.close();}
});
test('ordinary body and table cell formatting retain their generic command routes',()=>{
 const f=fixture();try{
  f.cursor.anchor={sectionIndex:0,paragraphIndex:1,charOffset:0};f.cursor.position={sectionIndex:0,paragraphIndex:1,charOffset:2};f.h.applyCharFormat({bold:true});assert.equal(f.history.peekUndoTop().constructor.name,'ApplyCharFormatCommand');assert.equal(f.snapshots.size,0);assert(JSON.parse(f.d.getCharPropertiesAt(0,1,0)).bold);
  f.history.clear(f.w);const table=JSON.parse(f.d.createTable(0,1,count('이웃 본문'),1,1));assert(table.ok);f.d.insertTextInCell(0,table.paraIdx,table.controlIdx,0,0,0,'표 셀');
  const start={sectionIndex:0,paragraphIndex:0,charOffset:0,parentParaIndex:table.paraIdx,controlIndex:table.controlIdx,cellIndex:0,cellParaIndex:0,cellPath:[{controlIndex:table.controlIdx,cellIndex:0,cellParaIndex:0}]};f.cursor.anchor=start;f.cursor.position={...start,charOffset:2};f.h.applyCharFormat({italic:true});assert.equal(f.history.peekUndoTop().constructor.name,'ApplyCharFormatCommand');assert.equal(f.snapshots.size,0);assert(JSON.parse(f.d.getCellCharPropertiesAt(0,table.paraIdx,table.controlIdx,0,0,0)).italic);
 }finally{f.close();}
});
for(const mode of ['header','note'])test(`${mode} keeps its existing early format route`,()=>{
 const f=fixture();try{f.flags[mode]=true;f.h.applyCharFormat(props);assert(f.events.includes(mode));assert.equal(f.history.canUndo(),false);assert.equal(f.snapshots.size,0);}finally{f.close();}
});

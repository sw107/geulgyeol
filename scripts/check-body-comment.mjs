// Current WASM + actual comment dialog/dispatcher/InputHandler/SnapshotCommand/CommandHistory.
// DOM, geometry and paint are adapters; no Mac GUI or physical IME claim.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {stripTypeScriptTypes} from 'node:module';
const [pkg,seed,preserved,out]=process.argv.slice(2);fs.mkdirSync(out,{recursive:true});
const read=f=>fs.readFileSync(f,'utf8'),sha=b=>crypto.createHash('sha256').update(b).digest('hex'),parse=JSON.parse;
const load=async s=>import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(s,{mode:'transform'}).replace(/^import[\s\S]*?;\s*$/gm,'')).toString('base64'));
const method=(s,n)=>{let a=-1;for(const p of ['  ','  private ']){a=s.indexOf(p+n+'(');if(a>=0)break;}assert(a>=0,n);const b=s.indexOf('\n  }\n',a);assert(b>a,n);return s.slice(a,b+4)+'\n';};
const source=Object.fromEntries(Object.entries({command:'engine/command.ts',history:'engine/history.ts',bridge:'core/wasm-bridge.ts',input:'engine/input-handler.ts',dialog:'ui/comment-dialog.ts',comment:'command/commands/comment.ts',registry:'command/registry.ts',dispatcher:'command/dispatcher.ts',mutations:'core/mutation-method-registry.ts'}).map(([k,f])=>[k,read('rhwp-studio/src/'+f)]));
const commands=await load('const MAX_PAGE_LOCAL_TEXT_EDIT_CHARS=10000;\n'+source.command);globalThis.__commentCommands=commands;
const {CommandHistory}=await load('const {NO_TEXT_MUTATION_EFFECTS}=globalThis.__commentCommands;\n'+source.history);
let bs='export class BridgeProbe{doc;documentGeneration=1;constructor(doc){this.doc=doc;}\n';
for(const n of ['getTextRange','getParagraphLength','getParagraphCount','getCharPropertiesAt','getParaPropertiesAt','saveSnapshot','restoreSnapshot','discardSnapshot','getFieldList','clearActiveField','deleteText','getBodyCommentAt','insertBodyComment','updateBodyComment','removeBodyComment'])bs+=method(source.bridge,n);
const {BridgeProbe}=await load(bs+'}');
class ElementAdapter {constructor(tag){this.tagName=tag;this.style={};this.children=[];this.value='';this.listeners={};}appendChild(e){this.children.push(e);return e;}setAttribute(){}addEventListener(n,f){this.listeners[n]=f;}focus(){}}
globalThis.document={createElement:t=>new ElementAdapter(t)};let externalOpens=0;
globalThis.window={open(){externalOpens++;throw new Error('Unexpected external open');}};globalThis.fetch=()=>{externalOpens++;throw new Error('Unexpected fetch');};
const {CommentDialog}=await load('class ModalDialog{constructor(){}show(){globalThis.__commentDialog=this;this.body=this.createBody();}hide(){this.closed=true;this.afterClose?.();}}\n'+source.dialog);
globalThis.__CommentDialog=CommentDialog;const toasts=[];globalThis.__commentToast=x=>toasts.push(x);
const {bodyCommentCommand}=await load('const CommentDialog=globalThis.__CommentDialog,showToast=globalThis.__commentToast;\n'+source.comment);
const {CommandRegistry}=await load(source.registry),{CommandDispatcher}=await load('const busyDepth=()=>0;\n'+source.dispatcher);
let hs='const {SnapshotCommand,SubmodeSnapshotCommand,SubmodeSelectionSnapshotCommand,IMMEDIATE_TEXT_MUTATION_EFFECTS}=globalThis.__commentCommands;\nexport class HandlerProbe{\n';
for(const n of ['getCursorPosition','getSelection','getHyperlinkTarget','getBodyCommentTarget','executeOperation','isOperationAllowedInEditMode','handleUndo','handleRedo','restoreEditContextAfterHistory','resetDerivedStateAfterHistoryJump','restoreSelectionAfterUndo','restoreSelectionAfterRedo'])hs+=method(source.input,n);
const {HandlerProbe}=await load(hs+'}');const {MUTATING_METHODS}=await load(source.mutations);
for(const n of ['insertBodyComment','updateBodyComment','removeBodyComment'])assert(MUTATING_METHODS.includes(n));assert(!MUTATING_METHODS.includes('getBodyCommentAt'));
assert(/\bbodyCommentCommand,/.test(read('rhwp-studio/src/command/commands/insert.ts')));
assert(/class="md-item" data-cmd="insert:comment"/.test(read('rhwp-studio/index.html')));
const bytes=fs.readFileSync(path.join(pkg,'rhwp_bg.wasm'));const {initSync,HwpDocument}=await import(pathToFileURL(path.resolve(pkg,'rhwp.js')));initSync({module:bytes});
const state=d=>({body:Array.from({length:d.getParagraphCount(0)},(_,p)=>{const text=d.getTextRange(0,p,0,100000);return {text,para:parse(d.getParaPropertiesAt(0,p)),chars:[...text].map((_,i)=>parse(d.getCharPropertiesAt(0,p,i)))};}),fields:parse(d.getFieldList()),comments:parse(d.getFieldList()).filter(f=>f.fieldType==='memo').map(f=>{const v=parse(d.getBodyCommentAt(f.location.sectionIndex,f.location.paraIndex,f.startCharIdx));delete v.editRevision;return v;}),notes:parse(d.getControls()).filter(c=>c.list===0&&c.ctrlId==='fn').map(c=>{const info=parse(d.getFootnoteInfo(0,c.para,c.controlIndex));return {info,paras:info.texts.map((text,p)=>({text,para:parse(d.getParaPropertiesInFootnote(0,c.para,c.controlIndex,p)),chars:[...text].map((_,i)=>parse(d.getCharPropertiesInFootnote(0,c.para,c.controlIndex,p,i)))}))};})});
const rows=[],manifest=[];let saves=0,refusals=0,undos=0,redos=0,mutations=0;
function save(s,label,hwpxOnly=false){const before=state(s.d),events=s.d.getEventLog();for(const ext of ['Hwp','Hwpx']){
 if(hwpxOnly&&ext==='Hwp'){assert.throws(()=>s.d.exportHwpWithReport(),/보존|저장|메모/);assert.deepEqual(state(s.d),before);assert.equal(s.d.getEventLog(),events);refusals++;continue;}
 const e=s.d['export'+ext+'WithReport']();try{assert.equal(parse(e.contentLoss()).count,0);const b=e.takeBytes(),file=path.resolve(out,label+'.'+ext.toLowerCase());fs.writeFileSync(file,b);const r=new HwpDocument(b);try{assert.deepEqual(state(r),before,label+' '+ext);saves++;}finally{r.free();}manifest.push({input:s.input,file,ops:structuredClone(s.ops)});}finally{e.free();}}
 assert.deepEqual(state(s.d),before);assert.equal(s.d.getEventLog(),events);
}
function make(input=seed){const d=new HwpDocument(fs.readFileSync(input)),wasm=new BridgeProbe(d),history=new CommandHistory(),ih=new HandlerProbe();let pos={sectionIndex:0,paragraphIndex:0,charOffset:1},selection=null,mode='body';
const cursor={getPosition:()=>({...pos}),getSelectionOrdered:()=>selection,moveTo:p=>{pos={...p};selection=null;},getRect:()=>null,resetPreferredX(){},isInFootnote:()=>mode==='footnote',isInHeaderFooter:()=>mode==='header',isInCellSelectionMode:()=>mode==='block',isInPictureObjectSelection:()=>false,isInTableObjectSelection:()=>false,exitBlockSelectionMode(){selection=null;},exitCellSelectionMode(){},clearSelection(){selection=null;},hasSelection:()=>selection!=null};
Object.assign(ih,{wasm,history,cursor,editMode:'edit',eventBus:{emit(){}},caretLayoutReveal:{requestFor(){}},refreshAfterOperation(){},prepareTextMutationBeforeCursor:()=>false,clearPendingFootnoteCharShape(){},flushDeferredPaginationIfNeeded(){},clearTableResizeRuntimeCache(){},afterEdit(){},focus(){}});
const ctx={hasDocument:true,isEditable:true,isFormMode:false,inTable:false,inCellSelectionMode:false,inPictureObjectSelection:false,inTableObjectSelection:false};const services={getInputHandler:()=>ih,wasm,eventBus:ih.eventBus,getContext:()=>ctx},registry=new CommandRegistry();registry.register(bodyCommentCommand);const dispatcher=new CommandDispatcher(registry,services,ih.eventBus);
return {d,input:path.resolve(input),ops:[],wasm,history,ih,cursor,ctx,dispatcher,set(a,b){pos={sectionIndex:0,paragraphIndex:0,charOffset:a};selection=b==null?null:{start:{...pos},end:{...pos,charOffset:b}};},raw(p,s=null){pos=p;selection=s;},mode(m){mode=m;},open(){globalThis.__commentDialog=null;dispatcher.dispatch('insert:comment');return globalThis.__commentDialog;},close(){history.clear(wasm);d.free();}};}
function apply(s,text,op){const dlg=s.open();assert(dlg);dlg.contentInput.value=text;assert.equal(dlg.onConfirm(),true,dlg.errorLabel.textContent);dlg.hide();s.ops.push(op);mutations++;return dlg;}
function history(s,before,beforeOps,label,hwpxOnly=false){const after=state(s.d),afterOps=structuredClone(s.ops),cursor=s.cursor.getPosition();s.ih.handleUndo();s.ops=beforeOps;assert.deepEqual(state(s.d),before,label+' undo');undos++;save(s,label+'-undo',hwpxOnly);s.ih.handleRedo();s.ops=afterOps;assert.deepEqual(state(s.d),after,label+' redo');assert.deepEqual(s.cursor.getPosition(),cursor);redos++;save(s,label,hwpxOnly);rows.push({label,after});}
function unchanged(s,op){const before=state(s.d),events=s.d.getEventLog(),u=s.history.peekUndoTop(),r=s.history.peekRedoTop();op();assert.deepEqual(state(s.d),before);assert.equal(s.d.getEventLog(),events);assert.equal(s.history.peekUndoTop(),u);assert.equal(s.history.peekRedoTop(),r);refusals++;}
const s=make();try{save(s,'seed');s.set(1,5);let before=state(s.d),ops=structuredClone(s.ops);const firstDlg=apply(s,'첫째 검토🙂\n\n두 번째𐐀\n',{kind:'insert',start:1,end:5,content:'첫째 검토🙂\n\n두 번째𐐀\n'});const first=state(s.d).comments[0].fieldId;s.ops.at(-1).id=first;
assert.deepEqual(state(s.d).body,before.body);assert.deepEqual(state(s.d).notes,before.notes);assert.equal(state(s.d).comments[0].author,'');assert.equal(state(s.d).comments[0].createDateTime,null);assert.equal(state(s.d).comments[0].selectedText,'🙂한글𐐀');history(s,before,ops,'insert');
unchanged(s,()=>assert.equal(firstDlg.onConfirm(),false));
s.set(5,8);before=state(s.d);ops=structuredClone(s.ops);apply(s,'둘째 검토🙂',{kind:'insert',start:5,end:8,content:'둘째 검토🙂'});const second=state(s.d).comments[1].fieldId;s.ops.at(-1).id=second;history(s,before,ops,'adjacent');
const link=parse(s.d.insertBodyHyperlink(0,0,8,9,'https://example.invalid/neighbor',''));s.ops.push({kind:'link',start:8,end:9,url:'https://example.invalid/neighbor',id:link.fieldId});
s.set(2);before=state(s.d);ops=structuredClone(s.ops);apply(s,'주석 내용만 수정🙂\n보존𐐀',{kind:'update',id:first,content:'주석 내용만 수정🙂\n보존𐐀'});assert.deepEqual(state(s.d).body,before.body);assert.deepEqual(state(s.d).notes,before.notes);history(s,before,ops,'edit');
s.set(2);unchanged(s,()=>{const dlg=s.open();assert(dlg);assert.equal(dlg.onConfirm(),true);dlg.hide();});
s.set(2);before=state(s.d);ops=structuredClone(s.ops);const remove=s.open();assert(remove);remove.body.children.find(e=>e.tagName==='button').listeners.click();assert.equal(remove.closed,true);s.ops.push({kind:'remove',id:first});mutations++;assert.deepEqual(state(s.d).body,before.body);assert.deepEqual(state(s.d).notes,before.notes);history(s,before,ops,'delete');
unchanged(s,()=>assert.throws(()=>s.d.removeBodyComment(0,0,first)));
// Cancel and malformed values preserve content, events, and both history stacks.
s.set(1,5);unchanged(s,()=>{const dlg=s.open();assert(dlg);dlg.contentInput.value='취소할 내용';dlg.hide();assert.equal(dlg.onConfirm(),false);});
for(const text of ['', ' ', 'bad\0','bad\t','bad\r','bad\u0085','bad\ufffe','bad\ud800','x'.repeat(4097),'x\n'.repeat(33)]){s.set(1,5);unchanged(s,()=>{const dlg=s.open();assert(dlg);dlg.contentInput.value=text;assert.equal(dlg.onConfirm(),false);dlg.hide();});}
for(const text of ['bad\ud800','bad\udc00',123,null,{},'\uffff'])unchanged(s,()=>assert.throws(()=>s.d.insertBodyComment(0,0,1,5,text)));
for(const at of [-1,1.5,NaN,Infinity,2**32,999])unchanged(s,()=>assert.throws(()=>s.d.insertBodyComment(0,0,at,5,'검토')));
for(const id of [-1,1.5,NaN,Infinity,2**32,0,link.fieldId])unchanged(s,()=>{assert.throws(()=>s.d.updateBodyComment(0,0,id,'검토'));assert.throws(()=>s.d.removeBodyComment(0,0,id));});
for(const mode of ['footnote','header','block']){s.mode(mode);unchanged(s,()=>assert.equal(s.open(),null));}s.mode('body');
for(const key of ['isFormMode','inTable','inCellSelectionMode','inPictureObjectSelection','inTableObjectSelection']){s.ctx[key]=true;unchanged(s,()=>assert.equal(s.dispatcher.dispatch('insert:comment'),false));s.ctx[key]=false;}
for(const [p,selection] of [[{sectionIndex:0,paragraphIndex:0,charOffset:1,parentParaIndex:0,cellPath:[{controlIndex:0,cellIndex:0,cellParaIndex:0}]},null],[{sectionIndex:0,paragraphIndex:0,charOffset:1},{start:{sectionIndex:0,paragraphIndex:0,charOffset:1},end:{sectionIndex:0,paragraphIndex:1,charOffset:3}}]]){s.raw(p,selection);unchanged(s,()=>assert.equal(s.open(),null));}
// A selection change in the same paragraph, or a document edit, makes the open dialog stale.
s.set(1,5);let stale=s.open();assert(stale);s.set(2,4);unchanged(s,()=>{stale.contentInput.value='바뀐 선택';assert.equal(stale.onConfirm(),false);stale.hide();});
s.set(1,5);stale=s.open();assert(stale);const old=s.d.saveSnapshot();s.d.applyCharFormat(0,0,1,2,'{"italic":true}');unchanged(s,()=>{stale.contentInput.value='바뀐 서식';assert.equal(stale.onConfirm(),false);stale.hide();});s.d.restoreSnapshot(old);s.d.discardSnapshot(old);
s.set(1,5);stale=s.open();assert(stale);s.ih.editMode='form';unchanged(s,()=>{stale.contentInput.value='모드 변경';assert.equal(stale.onConfirm(),false);stale.hide();});s.ih.editMode='edit';
// A rejected overlap preserves an existing redo branch.
s.ih.handleUndo();const afterUndo=state(s.d),redo=s.history.peekRedoTop();s.set(4,7);unchanged(s,()=>assert.equal(s.open(),null));assert.equal(s.history.peekRedoTop(),redo);s.ih.handleRedo();assert.deepEqual(state(s.d).comments.find(c=>c.fieldId===second).content,'둘째 검토🙂');
// Actual body input changes anchors while the review text remains separate.
s.d.insertText(0,0,0,'본문🙂');s.ops.push({kind:'body',at:0,text:'본문🙂'});assert.equal(state(s.d).comments.find(c=>c.fieldId===second).content,'둘째 검토🙂');save(s,'body-prefix');
}finally{s.close();}
// Body deletion contracts the scalar anchor, including an empty anchor; review text remains separate.
{const s=make();try{s.set(1,5);let before=state(s.d),ops=[];apply(s,'빈 범위도 검토 유지🙂',{kind:'insert',start:1,end:5,content:'빈 범위도 검토 유지🙂'});const id=state(s.d).comments[0].fieldId;s.ops.at(-1).id=id;history(s,before,ops,'range-insert');
for(const [at,count,label] of [[2,1,'range-contract'],[1,3,'range-empty']]){s.set(at);before=state(s.d);ops=structuredClone(s.ops);s.ih.executeOperation({kind:'snapshot',operationType:'deleteText',operation:bridge=>{bridge.deleteText(0,0,at,count);return {sectionIndex:0,paragraphIndex:0,charOffset:at};}});s.ops.push({kind:'delete',at,count});const f=state(s.d).comments[0];assert.equal(f.content,'빈 범위도 검토 유지🙂');assert.equal(f.fieldId,id);if(label==='range-empty'){assert.equal(f.startCharIdx,f.endCharIdx);assert.equal(f.selectedText,'');}history(s,before,ops,label);}
s.set(1);before=state(s.d);ops=structuredClone(s.ops);apply(s,'빈 범위 내용 수정🙂',{kind:'update',id,content:'빈 범위 내용 수정🙂'});history(s,before,ops,'range-empty-edit');s.set(1);before=state(s.d);ops=structuredClone(s.ops);const dlg=s.open();assert(dlg);dlg.body.children.find(e=>e.tagName==='button').listeners.click();s.ops.push({kind:'remove',id});mutations++;history(s,before,ops,'range-empty-remove');}finally{s.close();}}
// Reopened HWP/HWPX comments remain editable and deletable through the same UI.
for(const ext of ['hwp','hwpx']){const input=path.resolve(out,'edit.'+ext),s=make(input);try{const f=state(s.d).comments[0];s.set(f.startCharIdx);let before=state(s.d),ops=[];apply(s,'재열기 수정🙂',{kind:'update',id:f.fieldId,content:'재열기 수정🙂'});history(s,before,ops,'reopened-'+ext);s.set(f.startCharIdx);before=state(s.d);ops=structuredClone(s.ops);const dlg=s.open();dlg.body.children.find(e=>e.tagName==='button').listeners.click();s.ops.push({kind:'remove',id:f.fieldId});mutations++;history(s,before,ops,'reopened-delete-'+ext);}finally{s.close();}}
// Imported author/time values are retained. Unsupported HWP conversion is explicit and atomic.
{const s=make(path.join(preserved,'typed-time.hwpx'));try{const f=state(s.d).comments[0];assert.equal(f.editable,true);assert.deepEqual(f.supportedSaveFormats,['hwpx']);s.set(f.startCharIdx);const before=state(s.d),ops=[];const dlg=apply(s,'기존 metadata 유지🙂',{kind:'update',id:f.fieldId,content:'기존 metadata 유지🙂'});assert(dlg.body.children.some(e=>e.textContent?.includes('HWPX로 저장')));const after=state(s.d).comments[0];assert.equal(after.author,f.author);assert.equal(after.createDateTime,f.createDateTime);history(s,before,ops,'typed-time',true);}finally{s.close();}}
// Memo direction and paragraph reference fixtures generated independently by Native.
for(const [name,hwpxOnly] of [['vertical.hwpx',true],['paragraph-id.hwpx',false]]){const s=make(path.join(path.dirname(seed),name));try{const f=state(s.d).comments[0];assert.equal(f.editable,true);s.set(f.startCharIdx);const before=state(s.d),ops=[];apply(s,'참조 보존 UI🙂',{kind:'update',id:f.fieldId,content:'참조 보존 UI🙂'});history(s,before,ops,name,hwpxOnly);}finally{s.close();}}
{const s=make(path.join(path.dirname(seed),'unsupported-tracking.hwp'));try{const f=state(s.d).comments[0];assert.equal(f.editable,false);s.set(f.startCharIdx);unchanged(s,()=>assert.equal(s.open(),null));}finally{s.close();}}
for(const name of ['control-time.hwp','tail-unknown.hwp','multi-section.hwp']){const s=make(path.join(preserved,name));try{s.set(2,7);unchanged(s,()=>assert.equal(s.open(),null));assert(toasts.length>0);}finally{s.close();}}
assert.equal(externalOpens,0);fs.writeFileSync(path.join(path.dirname(seed),'wasm-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
const proof={wasmSHA256:sha(bytes),sourceSHA256:Object.fromEntries(Object.entries(source).map(([k,v])=>[k,sha(v)])),mutations,saves,refusals,undos,redos,newAuthorEmptyCreationTimeAbsent:true,originalAuthorTimePreserved:true,GUIVerified:false,physicalIMEVerified:false,externalOpens,rows};fs.writeFileSync(path.join(out,'proof.json'),JSON.stringify(proof,null,2)+'\n');console.log(JSON.stringify({...proof,rows:undefined,sourceSHA256:undefined}));

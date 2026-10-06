// Actual candidate WASM + current dialog/command/dispatcher/bridge/InputHandler/history.
// DOM, cursor geometry and repaint adapters; no Mac GUI or physical IME claim.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {stripTypeScriptTypes} from 'node:module';
const [pkg, manifestFile, out] = process.argv.slice(2);
fs.mkdirSync(out,{recursive:true});
const read=f=>fs.readFileSync(f,'utf8'),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const load=async s=>import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(s,{mode:'transform'}).replace(/^import[\s\S]*?;\s*$/gm,'')).toString('base64'));
const method=(s,n)=>{let a=-1;for(const p of ['  ','  private ']){a=s.indexOf(p+n+'(');if(a>=0)break;}assert(a>=0,n);const b=s.indexOf('\n  }\n',a);assert(b>a,n);return s.slice(a,b+4)+'\n';};
const source=Object.fromEntries(Object.entries({command:'engine/command.ts',history:'engine/history.ts',bridge:'core/wasm-bridge.ts',input:'engine/input-handler.ts',dialog:'ui/hyperlink-dialog.ts',link:'command/commands/hyperlink.ts',registry:'command/registry.ts',dispatcher:'command/dispatcher.ts',mutations:'core/mutation-method-registry.ts'}).map(([k,f])=>[k,read('rhwp-studio/src/'+f)]));
const commands=await load('const MAX_PAGE_LOCAL_TEXT_EDIT_CHARS=10000;\n'+source.command);globalThis.__linkCommands=commands;
const {CommandHistory}=await load('const {NO_TEXT_MUTATION_EFFECTS}=globalThis.__linkCommands;\n'+source.history);
let bs='export class BridgeProbe{doc;documentGeneration=1;constructor(doc){this.doc=doc;}\n';
for(const n of ['getTextRange','getParagraphLength','getParagraphCount','getCharPropertiesAt','getParaPropertiesAt','saveSnapshot','restoreSnapshot','discardSnapshot','getFieldList','clearActiveField','getBodyHyperlinkAt','insertBodyHyperlink','updateBodyHyperlink','removeBodyHyperlink','getTextInCellByPath','getCellParagraphLengthByPath','getCellParaPropertiesAtByPath','getCellHyperlinkAtByPath','insertCellHyperlinkByPath','updateCellHyperlinkByPath','removeCellHyperlinkByPath'])bs+=method(source.bridge,n);
const {BridgeProbe}=await load(bs+'}');
class ElementAdapter {constructor(tag){this.tagName=tag;this.style={};this.children=[];this.value='';this.listeners={};}appendChild(e){this.children.push(e);return e;}setAttribute(){}addEventListener(n,f){this.listeners[n]=f;}focus(){}select(){}}
globalThis.document={createElement:tag=>new ElementAdapter(tag)};
let externalOpens=0;globalThis.window={open(){externalOpens++;throw new Error('Unexpected URL execution');}};
globalThis.fetch=()=>{externalOpens++;throw new Error('Unexpected network request');};
const {HyperlinkDialog}=await load('class ModalDialog{constructor(){}show(){globalThis.__linkDialog=this;this.body=this.createBody();}hide(){this.closed=true;this.afterClose?.();}}\n'+source.dialog);
globalThis.__HyperlinkDialog=HyperlinkDialog;const toasts=[];globalThis.__linkToast=x=>toasts.push(x);
const {bodyHyperlinkCommand}=await load('const HyperlinkDialog=globalThis.__HyperlinkDialog,showToast=globalThis.__linkToast;\n'+source.link);
const {CommandRegistry}=await load(source.registry),{CommandDispatcher}=await load('const busyDepth=()=>0;\n'+source.dispatcher);
let hs='const {SnapshotCommand,SubmodeSnapshotCommand,SubmodeSelectionSnapshotCommand,IMMEDIATE_TEXT_MUTATION_EFFECTS}=globalThis.__linkCommands;\nexport class HandlerProbe{\n';
for(const n of ['getCursorPosition','getSelection','getBodyHyperlinkTarget','getHyperlinkTarget','executeOperation','isOperationAllowedInEditMode','handleUndo','handleRedo','restoreEditContextAfterHistory','resetDerivedStateAfterHistoryJump','restoreSelectionAfterUndo','restoreSelectionAfterRedo'])hs+=method(source.input,n);
const {HandlerProbe}=await load(hs+'}');
const {MUTATING_METHODS}=await load(source.mutations);
for(const name of ['insertCellHyperlinkByPath','updateCellHyperlinkByPath','removeCellHyperlinkByPath']) assert(MUTATING_METHODS.includes(name));
assert(!MUTATING_METHODS.includes('getCellHyperlinkAtByPath'));
const bytes=fs.readFileSync(path.join(pkg,'rhwp_bg.wasm'));
const {initSync,HwpDocument}=await import(pathToFileURL(path.resolve(pkg,'rhwp.js')));initSync({module:bytes});
const parsed=JSON.parse,rows=[],savedManifest=[],layoutRows=[];let reopens=0,undos=0,redos=0,refusals=0;
const fixtures=parsed(fs.readFileSync(manifestFile));
const pathAt=(c,level,cell,para)=>c.path.slice(0,level).map((e,i)=>i===level-1?{...e,cellIndex:cell,cellParaIndex:para}:{...e});
const cellText=(d,c,p=c.path)=>d.getTextInCellByPath(0,c.parent,JSON.stringify(p),0,100000);
function model(d,c) {
  const controls=parsed(d.getControls());
  return {fields:parsed(d.getFieldList()),styles:parsed(d.getStyleList()),controls,
    body:Array.from({length:d.getParagraphCount(0)},(_,p)=>{const text=d.getTextRange(0,p,0,100000);return {text,para:parsed(d.getParaPropertiesAt(0,p)),chars:[...text].map((_,i)=>parsed(d.getCharPropertiesAt(0,p,i)))};}),
    levels:c.path.map((_,l)=>Array.from({length:c.merged?3:4},(_,cell)=>{const p=pathAt(c,l+1,cell,0),at=JSON.stringify(p);return {own:parsed(d.getCellOwnPropertiesByPath(0,c.parent,at)),paras:Array.from({length:d.getCellParagraphCountByPath(0,c.parent,at)},(_,para)=>{const q=JSON.stringify(pathAt(c,l+1,cell,para)),text=d.getTextInCellByPath(0,c.parent,q,0,100000);return {text,para:parsed(d.getCellParaPropertiesAtByPath(0,c.parent,q)),chars:[...text].map((_,i)=>parsed(d.getCellCharPropertiesAtByPath(0,c.parent,q,i)))};})};})),
    notes:controls.filter(x=>x.list===0&&x.ctrlId==='fn').map(x=>parsed(d.getFootnoteInfo(0,x.para,x.controlIndex)))};
}
const bboxes=(d,c)=>c.path.map((_,l)=>parsed(d.getTableCellBboxesByPath(0,c.parent,JSON.stringify(c.path.slice(0,l+1)))));
function reopen(d,c,label,input,op) {
  const before=model(d,c);
  for(const ext of ['Hwp','Hwpx']) {const e=d['export'+ext+'WithReport']();try{assert.equal(parsed(e.contentLoss()).count,0);const b=e.takeBytes(),file=path.resolve(out,label+'.'+ext.toLowerCase());fs.writeFileSync(file,b);const r=new HwpDocument(b);try{assert.deepEqual(model(r,c),before,label+' '+ext);reopens++;if(input&&op)savedManifest.push({input,file,c,op});}finally{r.free();}}finally{e.free();}}
}
function make(c,input) {
  const d=new HwpDocument(fs.readFileSync(input)),wasm=new BridgeProbe(d),history=new CommandHistory(),ih=new HandlerProbe();
  let pos,selection=null,mode='cell';const last=c.path.at(-1);
  const position=at=>({sectionIndex:0,paragraphIndex:last.cellParaIndex,parentParaIndex:c.parent,controlIndex:last.controlIndex,cellIndex:last.cellIndex,cellParaIndex:last.cellParaIndex,cellPath:c.path.map(e=>({...e})),charOffset:at});pos=position(3);
  const cursor={getPosition:()=>({...pos}),getSelectionOrdered:()=>selection,moveTo:p=>{pos={...p};selection=null;},getRect:()=>null,resetPreferredX(){},isInFootnote:()=>mode==='footnote',isInHeaderFooter:()=>mode==='header',isInCellSelectionMode:()=>mode==='block',isInPictureObjectSelection:()=>false,isInTableObjectSelection:()=>false,exitBlockSelectionMode(){selection=null;},exitCellSelectionMode(){},clearSelection(){selection=null;},hasSelection:()=>selection!=null};
  Object.assign(ih,{wasm,history,cursor,editMode:'edit',eventBus:{emit(){}},caretLayoutReveal:{requestFor(){}},refreshAfterOperation(){},prepareTextMutationBeforeCursor:()=>false,clearPendingFootnoteCharShape(){},flushDeferredPaginationIfNeeded(){},clearTableResizeRuntimeCache(){},afterEdit(){},focus(){}});
  const ctx={hasDocument:true,isEditable:true,isFormMode:false,inTable:true,inCellSelectionMode:false,inPictureObjectSelection:false,inTableObjectSelection:false};const services={getInputHandler:()=>ih,wasm,eventBus:ih.eventBus,getContext:()=>ctx};const registry=new CommandRegistry();registry.register(bodyHyperlinkCommand);const dispatcher=new CommandDispatcher(registry,services,ih.eventBus);
  return {d,c,input,wasm,history,ih,cursor,ctx,dispatcher,position,set(at,end){pos=position(at);selection=end==null?null:{start:position(at),end:position(end)};},setRaw(p,s=null){pos=p;selection=s;},mode(m){mode=m;},open(){globalThis.__linkDialog=null;dispatcher.dispatch('insert:hyperlink');return globalThis.__linkDialog;},close(){history.clear(wasm);d.free();}};
}
function apply(s,url,display){const dlg=s.open();assert(dlg);dlg.urlInput.value=url;if(display!==undefined)dlg.textInput.value=display;assert.equal(dlg.onConfirm(),true,dlg.errorLabel.textContent);dlg.hide();return dlg;}
function preserved(before,after,op) {
  assert.deepEqual(after.body,before.body);assert.deepEqual(after.notes,before.notes);assert.deepEqual(after.styles,before.styles);
  // Newly authored Field controls and shifted stream offsets are expected. Compare all other control payloads; Native independently checks scalar anchors.
  const stableControls = xs => xs.filter(x=>x.ctrlId!=='').map(x=>{const y={...x,props:{...x.props}};if(x.list!==0){delete y.pos;delete y.controlIndex;}if(x.ctrlId==='tbl')delete y.props.Height;return y;});
  assert.deepEqual(stableControls(after.controls),stableControls(before.controls));
  for(let l=0;l<before.levels.length;l++) {
    const leaf=l===before.levels.length-1;
    for(let i=0;i<before.levels[l].length;i++) {
      if(leaf&&i===0){assert.deepEqual(after.levels[l][i].own,before.levels[l][i].own);assert.deepEqual(after.levels[l][i].paras.slice(1),before.levels[l][i].paras.slice(1));const a=after.levels[l][i].paras[0],b=before.levels[l][i].paras[0];assert.deepEqual(a.para,b.para);if(!['caret','long','multipage'].includes(op)){assert.equal(a.text,b.text);assert.deepEqual(a.chars,b.chars);}else{const at=op==='caret'?10:1,n=op==='caret'?[...'삽입🙂한글'].length:[...'길이🙂한글 '.repeat(op==='multipage'?80:4)].length;assert.deepEqual(a.chars.slice(0,at),b.chars.slice(0,at));assert.deepEqual(a.chars.slice(at+n),b.chars.slice(at));}}
      else assert.deepEqual(after.levels[l][i],before.levels[l][i]);
    }
  }
  const neighbor=before.fields.find(f=>f.name==='existing');const now=after.fields.find(f=>f.name==='existing');assert.equal(now.value,neighbor.value);assert.equal(now.command,neighbor.command);assert.equal(now.fieldId,neighbor.fieldId);assert.equal(now.startCharIdx,neighbor.startCharIdx);assert.equal(now.endCharIdx,neighbor.endCharIdx);assert.equal(now.guide,neighbor.guide);
}
function roundtrip(s,before,op,label){const after=model(s.d,s.c),afterCursor=s.cursor.getPosition();preserved(before,after,op);s.ih.handleUndo();assert.deepEqual(model(s.d,s.c),before,label+' undo');undos++;s.ih.handleRedo();assert.deepEqual(model(s.d,s.c),after,label+' redo');assert.deepEqual(s.cursor.getPosition(),afterCursor,label+' full-path cursor');redos++;reopen(s.d,s.c,label,s.input,op);rows.push({label,op,depth:s.c.depth,merged:s.c.merged,input:s.input});}
function atomic(s,fn,label){const before=model(s.d,s.c),event=s.d.getEventLog(),u=s.history.peekUndoTop(),r=s.history.peekRedoTop(),hwp=sha(s.d.exportHwp()),hwpx=sha(s.d.exportHwpx());fn();assert.deepEqual(model(s.d,s.c),before,label);assert.equal(s.d.getEventLog(),event);assert.equal(s.history.peekUndoTop(),u);assert.equal(s.history.peekRedoTop(),r);assert.equal(sha(s.d.exportHwp()),hwp);assert.equal(sha(s.d.exportHwpx()),hwpx);refusals++;}
for(const c of fixtures)for(const {file:input} of c.seed) {
  const s=make(c,input),base=path.basename(input).replace(/\./g,'-');
  try {
    assert.equal(s.dispatcher.isEnabled('insert:hyperlink'),true);
    reopen(s.d,c,base+'-seed');
    let before=model(s.d,c);const a=s.position(3),b=s.position(8);b.cellPath=b.cellPath.map(e=>({cellParaIndex:e.cellParaIndex,cellIndex:e.cellIndex,controlIndex:e.controlIndex}));s.setRaw(a,{start:a,end:b});apply(s,'https://example.invalid/한글?q=🙂&x=1');assert.equal(parsed(s.d.getCellHyperlinkAtByPath(0,c.parent,JSON.stringify(c.path),3)).text,'한글𐐀링크');roundtrip(s,before,'wrap',base+'-wrap');
    before=model(s.d,c);s.set(4);const edited=apply(s,'http://example.invalid/수정🙂');assert.equal(edited.textInput.readOnly,true);roundtrip(s,before,'url',base+'-url');
    before=model(s.d,c);s.set(8,10);apply(s,'https://second.invalid');assert.equal(parsed(s.d.getFieldList()).filter(f=>f.fieldType==='hyperlink').length,2);roundtrip(s,before,'adjacent',base+'-adjacent');
    before=model(s.d,c);s.set(4);const unlink=s.open();assert(unlink);unlink.body.children.find(e=>e.tagName==='button').listeners.click();assert.equal(unlink.closed,true);roundtrip(s,before,'unlink',base+'-unlink');
    before=model(s.d,c);s.set(10);apply(s,'https://new.invalid','삽입🙂한글');assert.equal(cellText(s.d,c),'값앞🙂한글𐐀링크 뒤삽입🙂한글참조끝');roundtrip(s,before,'caret',base+'-caret');
    // Place long display at a safe boundary after the independent field, before the note.
    before=model(s.d,c);const oldBox=bboxes(s.d,c);s.set(1);apply(s,'https://long.invalid','길이🙂한글 '.repeat(4));const newBox=bboxes(s.d,c);for(let l=0;l<c.depth;l++){assert(oldBox[l].length>0);const cell=c.path[l].cellIndex;const a=oldBox[l].find(x=>x.cellIdx===cell),b=newBox[l].find(x=>x.cellIdx===cell);assert(a&&b);assert(b.h>a.h,'ancestor layout height '+JSON.stringify({c,input,level:l,before:oldBox,after:newBox}));}
    layoutRows.push({depth:c.depth,merged:c.merged,input,before:oldBox,after:newBox});roundtrip(s,before,'long',base+'-long');
    // Cancel and safe scheme validation keep entire public document, bytes, events and history.
    s.set(1);atomic(s,()=>{const dlg=s.open();assert(dlg);dlg.hide();},'cancel');
    for(const url of ['javascript:alert(1)','data:text/html,x','file:///tmp/x','example.com','https://','https://u:p@example.com','https://example.com/a b']){s.set(1);atomic(s,()=>{const dlg=s.open();assert(dlg);dlg.urlInput.value=url;assert.equal(dlg.onConfirm(),false);dlg.hide();},url);}
    for(const mode of ['footnote','header','block']){s.mode(mode);atomic(s,()=>assert.equal(s.open(),null),mode);}s.mode('cell');
    for(const key of ['isFormMode','inCellSelectionMode','inPictureObjectSelection','inTableObjectSelection']){s.ctx[key]=true;atomic(s,()=>{assert.equal(s.dispatcher.isEnabled('insert:hyperlink'),false);assert.equal(s.dispatcher.dispatch('insert:hyperlink'),false);},key);s.ctx[key]=false;}
    const p=s.position(1),neighbor=s.position(3);neighbor.cellIndex=1;neighbor.cellPath.at(-1).cellIndex=1;
    for(const end of [neighbor,{...p,cellParaIndex:1,cellPath:p.cellPath.map((e,i)=>i===c.depth-1?{...e,cellParaIndex:1}:e)},{sectionIndex:0,paragraphIndex:c.parent,charOffset:2}]) {s.setRaw(p,{start:p,end});atomic(s,()=>assert.equal(s.open(),null),'cross owner');}
    s.setRaw({...p,isTextBox:true});atomic(s,()=>assert.equal(s.open(),null),'textbox');
    // Strict raw path/index decoding never falls back to a valid default cell.
    for(const bad of ['[]','{}','not-json',JSON.stringify([{controlIndex:0,cellIndex:0}]),JSON.stringify([{controlIndex:0,cellIndex:0,cellParaIndex:-1}]),JSON.stringify([{controlIndex:0,cellIndex:0,cellParaIndex:0.5}]),JSON.stringify([{...c.path[0],unknown:0}]),JSON.stringify(c.path.map((e,i)=>i===c.depth-1?{...e,cellIndex:99}:e)),JSON.stringify(Array.from({length:65},()=>c.path[0]))]) {
      atomic(s,()=>{assert.throws(()=>s.d.getCellHyperlinkAtByPath(0,c.parent,bad,1));assert.throws(()=>s.d.insertCellHyperlinkByPath(0,c.parent,bad,1,1,'https://example.invalid','safe'));assert.throws(()=>s.d.updateCellHyperlinkByPath(0,c.parent,bad,1002,'https://example.invalid'));assert.throws(()=>s.d.removeCellHyperlinkByPath(0,c.parent,bad,1002));},'bad path');
    }
    for(const n of [-1,1.5,NaN,Infinity,2**32])atomic(s,()=>{const q=JSON.stringify(c.path);assert.throws(()=>s.d.getCellHyperlinkAtByPath(n,c.parent,q,1));assert.throws(()=>s.d.insertCellHyperlinkByPath(0,c.parent,q,n,1,'https://example.invalid','safe'));assert.throws(()=>s.d.updateCellHyperlinkByPath(0,c.parent,q,n,'https://example.invalid'));assert.throws(()=>s.d.removeCellHyperlinkByPath(0,c.parent,q,n));},'bad index');
    // Stale dialog text, changed mode and overlapped selection refuse before history mutation.
    s.set(1);const stale=s.open(),snap=s.wasm.saveSnapshot();s.d.insertTextInCellByPath(0,c.parent,JSON.stringify(c.path),1,'외부');atomic(s,()=>{stale.urlInput.value='https://stale.invalid';assert.equal(stale.onConfirm(),false);},'stale dialog');stale.hide();s.wasm.restoreSnapshot(snap);s.wasm.discardSnapshot(snap);
    s.set(1);const moved=s.open();s.setRaw(neighbor);atomic(s,()=>{moved.urlInput.value='https://moved.invalid';assert.equal(moved.onConfirm(),false);},'changed owner');moved.hide();
    s.set(1);const changedMode=s.open();s.ih.editMode='form';atomic(s,()=>{changedMode.urlInput.value='https://mode.invalid';assert.equal(changedMode.onConfirm(),false);},'changed mode');changedMode.hide();s.ih.editMode='edit';
    s.ih.handleUndo();s.set(9,11);atomic(s,()=>{const dlg=s.open();if(dlg){dlg.urlInput.value='https://overlap.invalid';assert.equal(dlg.onConfirm(),false);dlg.hide();}},'overlap preserves redo');s.ih.handleRedo();
    for(const ext of ['Hwp','Hwpx']){const r=new HwpDocument(s.d['export'+ext]());try{const f=parsed(r.getFieldList()).find(f=>f.fieldType==='hyperlink');assert(f);const before=model(r,c);r.updateCellHyperlinkByPath(0,c.parent,JSON.stringify(c.path),f.fieldId,'https://reopened.invalid/새🙂');assert.equal(parsed(r.getCellHyperlinkAtByPath(0,c.parent,JSON.stringify(c.path),f.startCharIdx)).url,'https://reopened.invalid/새🙂');reopen(r,c,base+'-reopened-'+ext,s.input,'reopened-'+ext);r.removeCellHyperlinkByPath(0,c.parent,JSON.stringify(c.path),f.fieldId);const leaf=c.depth-1;assert.equal(model(r,c).levels[leaf][0].paras[0].text,before.levels[leaf][0].paras[0].text);assert.deepEqual(model(r,c).levels[leaf][0].paras[0].chars,before.levels[leaf][0].paras[0].chars);reopen(r,c,base+'-reopened-unlink-'+ext,s.input,'reopened-unlink-'+ext);}finally{r.free();}}
  } finally{s.close();}
}
// Oversized display uses page splitting. Check all SVG pages instead of comparing only the first-page cell box.
const multipageRows=[];
for(const c of fixtures)for(const {file:input} of c.seed) {
  const s=make(c,input);
  try {
    const before=model(s.d,c),pagesBefore=s.d.pageCount();s.set(1);apply(s,'https://multipage.invalid','길이🙂한글 '.repeat(80));
    const pagesAfter=s.d.pageCount();assert(pagesAfter>pagesBefore);
    const visible=Array.from({length:pagesAfter},(_,p)=>s.d.renderPageSvg(p)).flatMap(svg=>Array.from(svg.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g),m=>m[1].replace(/<[^>]+>/g,''))).join('');
    assert.equal([...visible].filter(ch=>ch==='길').length,80,'all display repetitions rendered across pages');
    multipageRows.push({depth:c.depth,merged:c.merged,input,pagesBefore,pagesAfter,renderedRepetitions:80});
    roundtrip(s,before,'multipage',path.basename(input).replace(/\./g,'-')+'-multipage');
  }finally{s.close();}
}
assert.equal(externalOpens,0);
const proof={candidateWasmSHA256:sha(bytes),sourceSHA256:Object.fromEntries(Object.entries(source).map(([k,v])=>[k,sha(v)])),positive:rows.length,reopens,undos,redos,atomicRefusals:refusals,layoutCases:layoutRows.length,multipageCases:multipageRows.length,multipageRows,GUIVerified:false,physicalIMEVerified:false,externalOpens,rows,layoutRows};
fs.writeFileSync(path.join(out,'proof.json'),JSON.stringify(proof,null,2)+'\n');fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify(savedManifest,null,2)+'\n');console.log(JSON.stringify({...proof,rows:undefined,layoutRows:undefined,multipageRows:undefined}));

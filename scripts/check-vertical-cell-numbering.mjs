// Actual package WASM + current numbering dialog/command/InputHandler/CommandHistory.
// Checks vertical metadata/history preservation, including explicitly unsupported rendering.
// Existing missing vertical list glyphs are reported separately from data preservation.
import fs from 'node:fs';
import nodePath from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';
const [engine, out, onlyCase] = process.argv.slice(2);
assert(engine && out);
fs.mkdirSync(out, {
  recursive: true
});
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const bytes = fs.readFileSync(nodePath.join(engine, 'rhwp_bg.wasm'));
const {
  initSync,
  HwpDocument
} = await import(pathToFileURL(nodePath.resolve(engine, 'rhwp.js')));
initSync({
  module: bytes
});
const load = async s => import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(s, {
  mode: 'transform'
}).replace(/^import[\s\S]*?;\s*$/gm, '')).toString('base64'));
const method = (s, n) => {
  let a = -1;
  for (const p of ['  ', '  private ']) {
    a = s.indexOf(p + n + '(');
    if (a >= 0) break;
  }
  if (a < 0) a = s.indexOf('  ' + n + '<');
  assert(a >= 0, n);
  return s.slice(a, s.indexOf('\n  }\n', a) + 4) + '\n';
};
const source = {
  bridge: fs.readFileSync('rhwp-studio/src/core/wasm-bridge.ts', 'utf8'),
  input: fs.readFileSync('rhwp-studio/src/engine/input-handler.ts', 'utf8'),
  dialog: fs.readFileSync('rhwp-studio/src/ui/numbering-dialog.ts', 'utf8'),
  format: fs.readFileSync('rhwp-studio/src/command/commands/format.ts', 'utf8'),
  command: fs.readFileSync('rhwp-studio/src/engine/command.ts', 'utf8'),
  history: fs.readFileSync('rhwp-studio/src/engine/history.ts', 'utf8')
};
const commands = await load('const MAX_PAGE_LOCAL_TEXT_EDIT_CHARS=10000;\n' + source.command);
globalThis.__gapCommands = commands;
const {
  CommandHistory
} = await load('const {NO_TEXT_MUTATION_EFFECTS}=globalThis.__gapCommands;\n' + source.history);
let bridge = 'export class BridgeProbe{doc;documentGeneration=1;constructor(d){this.doc=d;}\n';
for (const n of ['getTextRange', 'getParagraphLength', 'getParagraphCount', 'getTableDimensions','getTableDimensionsByPath','getCellInfo','getCellInfoByPath','getCellParagraphCount','getCellParagraphLengthByPath','getCellParagraphCountByPath','getCellParaPropertiesAtByPath','getCellParaPropertiesAt','applyParaFormatInCell','applyParaFormatInCellsByPaths','getTextInCellByPath', 'getParaPropertiesAt', 'ensureDefaultNumbering', 'createNumbering', 'getNumberingList', 'applyParaFormat', 'setParaShapeId', 'saveSnapshot', 'restoreSnapshot', 'discardSnapshot', 'runInBatch']) bridge += method(source.bridge, n);
bridge += '}';
const {
  BridgeProbe
} = await load(bridge);
// Small DOM event adapter: actual dialog body construction and input listeners run.
class ElementAdapter {
  constructor(tag){this.tagName=tag;this.children=[];this.style={};this.listeners=new Map();this.className='';this.classList={add:()=>{},remove:()=>{},toggle:()=>{}};}
  appendChild(child){child.parentElement=this;this.children.push(child);return child;}
  addEventListener(type,fn){this.listeners.set(type,fn);}
  setAttribute(name,value){this[name]=value;}
  querySelectorAll(selector){const nodes=this.children.flatMap(c=>[c,...(c.querySelectorAll?.(selector)??[])]);return nodes.filter(c=>selector.startsWith('.')?c.className?.split(' ').includes(selector.slice(1)):c.tagName===selector);}
  dispatch(type){this.listeners.get(type)?.({target:this});}
}
globalThis.document={createElement:tag=>new ElementAdapter(tag),createTextNode:text=>({textContent:text})};
const {
  NumberingDialog
} = await load('const BULLET_PRESETS=[];class ModalDialog {constructor(){}show(){globalThis.__gapDialog=this;globalThis.__gapDOM=this.createBody();}hide(){}}\n' + source.dialog);
globalThis.__gapDialogClass = NumberingDialog;
const {
  formatCommands
} = await load('const NumberingDialog=globalThis.__gapDialogClass;\n' + source.format);
let h = fs.readFileSync('rhwp-studio/src/engine/cell-block-format.ts','utf8')+'\nconst {ApplyParaFormatCommand,SnapshotCommand,SubmodeSnapshotCommand,SubmodeSelectionSnapshotCommand}=globalThis.__gapCommands;export class HandlerProbe{\n';
for (const n of ['captureCellNumbering','getCursorPosition','captureBodyNumbering', 'getParaProperties', 'applyNumbering', 'applyParaPropsAtCursor', 'applyParaFormat', 'applyParaFormatInNoteOrHeader', 'getFootnoteCharFormatSelection', 'getSelectedCellBlock', 'getParaFormatTargetsForCellBlock', 'getParaFormatTargetsAtCursor', 'getParaFormatTargetsForRange', 'executeParaFormatCommand', 'executeOperation']) h += method(source.input, n);
h += '}';
const {
  HandlerProbe
} = await load(h);
const fixtures=JSON.parse(fs.readFileSync('../nested-paragraph-qa/behavior/native/proof.json')).fixtures.filter(x=>!x.equations&&x.file.endsWith('.hwpx'));
const pathAt=(c,cell,p)=>[...c.path.slice(0,-1),{...c.path.at(-1),cellIndex:cell,cellParaIndex:p}];
const posAt=(c,cell,p)=>{const cellPath=pathAt(c,cell,p),first=cellPath[0];return {sectionIndex:0,paragraphIndex:c.parent,parentParaIndex:c.parent,controlIndex:first.controlIndex,cellIndex:first.cellIndex,cellParaIndex:first.cellParaIndex,cellPath,charOffset:1};};
const compact=d=>Array.from({length:d.pageCount()},(_,i)=>[...d.renderPageSvg(i).matchAll(/<(text|tspan)\b[^>]*>([^<]*)<\/\1>/g)].map(x=>x[2]).join('').replace(/\s/g,'')).join('');
const label=(d,text)=>compact(d).match(new RegExp('(\\d+(?:\\.\\d+)*\\.)'+text))?.[1]??null;
const definition=(start=1)=>JSON.stringify({levelFormats:Array(7).fill('^N'),numberFormats:Array(7).fill(0),startNumber:start});
const scenarios=[
 {id:'plain-ahead',mode:0,heads:['A','A',null,null],expected:['1.','2.',null,'3.'],chosen:'A'},
 {id:'existing-previous',mode:1,heads:['A','A',null,'A'],expected:['1.','2.',null,'3.'],chosen:'A'},
 {id:'new-start',mode:2,start:5,heads:['A','A',null,null],expected:['1.','2.',null,'5.'],chosen:'new'},
 {id:'after-other-list',mode:0,heads:['A','A','B',null],expected:['1.','2.','1.','2.'],chosen:'B'},
 {id:'resume-previous-A',mode:1,previous:'A',heads:['A','A','B',null],expected:['1.','2.','1.','3.'],chosen:'A'},
 {id:'level-continue',mode:0,heads:['A','A','A','B'],levels:[0,1,1,1],expected:['1.','1.1.','1.2.','1.3.'],chosen:'A'},
 {id:'level-new-start',mode:2,start:5,heads:['A','A',null,'A'],levels:[0,0,0,1],expected:['1.','2.',null,'5.'],chosen:'new'},
 {id:'range-continue',mode:0,range:true,heads:['A','A','B',null],expected:['1.','2.','3.','4.'],chosen:'A'},
 {id:'clear-range',mode:0,range:true,clear:true,heads:['A','A','B','B'],expected:['1.','2.',null,null],chosen:'none'},
 {id:'block-preserve-independent-ids',mode:0,block:true,heads:['A','A',null,'A'],expected:['1.','2.','3.','4.'],chosen:'A'},
 {id:'block-previous-keep-ids',mode:1,block:true,heads:['A','A','A','A'],expected:['1.','2.','3.','4.'],chosen:'A'},
 {id:'block-new-start',mode:2,start:5,block:true,heads:['A','A',null,'A'],expected:['5.','6.','7.','8.'],chosen:'new'},
 {id:'block-clear',mode:0,block:true,clear:true,heads:['A','A',null,'A'],expected:[null,null,null,null],chosen:'none'},
];
let cases=0,reopens=0,undos=0,redos=0,rejections=0,noOps=0,rollbacks=0;
const rows=[],manifest=[];
const svgs=d=>Array.from({length:d.pageCount()},(_,i)=>d.renderPageSvg(i));
for(const c of fixtures)for(const direction of [1,2])for(const sc of scenarios){
 if(onlyCase && sc.id!==onlyCase)continue;
 const d=new HwpDocument(fs.readFileSync(c.file)),wasm=new BridgeProbe(d),a=wasm.createNumbering(definition()),b=wasm.createNumbering(definition()),ids={A:a,B:b};
 const path=(cell,p)=>pathAt(c,cell,p),json=(cell,p)=>JSON.stringify(path(cell,p));
 const text=(cell,p)=>d.getTextInCellByPath(0,c.parent,json(cell,p),0,100000);
 const setText=(cell,p,value)=>{d.deleteTextInCellByPath(0,c.parent,json(cell,p),0,Array.from(text(cell,p)).length);d.insertTextInCellByPath(0,c.parent,json(cell,p),0,value);};
 for(const p of [0,1])setText(0,p,'대상'+p+'끝AbC');
 for(let p=2;p<4;p++){d.splitParagraphInCellByPath(0,c.parent,json(0,p-1),Array.from(text(0,p-1)).length);d.insertTextInCellByPath(0,c.parent,json(0,p),0,'대상'+p+'끝AbC');}
 for(const cell of [0,1])for(let p=0;p<(cell===0?4:2);p++){const head=cell===0?sc.heads[p]:'B';if(cell===1)setText(cell,p,'이웃'+p+'끝AbC');if(head)d.applyParaFormatInCellsByPaths(0,c.parent,JSON.stringify([path(cell,p)]),JSON.stringify({headType:'Number',numberingId:ids[head],paraLevel:cell===0?sc.levels?.[p]??0:0}));}
 // Body and neighboring cell deliberately share the target's definition in ordinary cases.
 if(!sc.block)for(const p of [0,1])d.applyParaFormatInCellsByPaths(0,c.parent,JSON.stringify([path(1,p)]),JSON.stringify({headType:'Number',numberingId:a,paraLevel:0}));
 for(const p of [0,c.parent+1])d.applyParaFormat(0,p,JSON.stringify({headType:'Number',numberingId:a,paraLevel:0}));
 for(const cell of [0,1])d.applyCellOwnPropertiesByPaths(0,c.parent,JSON.stringify([path(cell,0)]),JSON.stringify({textDirection:direction}));
 const history=new CommandHistory(),ih=new HandlerProbe();let position=posAt(c,0,sc.range?2:3),selection=sc.range?{start:posAt(c,0,2),end:posAt(c,0,3)}:null;
 const cursor={isInFootnote:()=>false,isInHeaderFooter:()=>false,isInCellSelectionMode:()=>sc.block??false,getSelectionOrdered:()=>selection,getPosition:()=>position,getRect:()=>null,moveTo:p=>{position=p;},resetPreferredX(){},getCellTableContext:()=>({sec:0,ppi:c.parent,ci:c.path[0].controlIndex,cellPath:c.path}),getSelectedCellRange:()=>({startRow:0,startCol:0,endRow:0,endCol:1}),getExcludedCells:()=>new Set()};
 Object.assign(ih,{wasm,history,cursor,isOperationAllowedInEditMode:()=>true,prepareTextMutationBeforeCursor:()=>false,caretLayoutReveal:{requestFor(){}},refreshAfterOperation(){},focus(){},focusTextarea(){}});
 const props=(cell,count)=>Array.from({length:count},(_,p)=>JSON.parse(d.getCellParaPropertiesAtByPath(0,c.parent,json(cell,p))));
 const labels=()=>Array.from({length:4},(_,p)=>label(d,'대상'+p+'끝AbC'));
 const body=()=>[0,c.parent+1].map(p=>({props:JSON.parse(d.getParaPropertiesAt(0,p)),text:d.getTextRange(0,p,0,100000)}));
 try{
  assert.equal(label(d,'대상0끝'),null);assert.deepEqual([0,1].map(p=>label(d,'이웃'+p+'끝AbC')),[null,null]);
  const before=Buffer.from(d.exportHwpx()),beforeSVG=svgs(d),beforeDefs=wasm.getNumberingList(),beforeBody=body(),beforeNeighbor=props(1,2),beforeProps=props(0,4);
  const own=()=>Array.from({length:c.cellCount},(_,cell)=>JSON.parse(d.getCellOwnPropertiesByPath(0,c.parent,json(cell,0))));
  const beforeOwn=own();
  formatCommands.find(x=>x.id==='format:para-num-shape').execute({getInputHandler:()=>ih,wasm,eventBus:{}});const dialog=globalThis.__gapDialog;assert.equal(typeof dialog.onApplyDefinition,'function');
  const inputs=globalThis.__gapDOM.querySelectorAll('input');inputs.find(x=>x.name==='nd-preset'&&x.value===(sc.clear?'0':'2')).dispatch('change');inputs.find(x=>x.name==='nd-restart-mode'&&x.value===String(sc.mode)).dispatch('change');const start=inputs.find(x=>x.type==='number');start.value=String(sc.start??1);start.dispatch('input');if(sc.previous){const select=globalThis.__gapDOM.querySelectorAll('select')[0];select.value=String(ids[sc.previous]);select.dispatch('change');}
  // Focus/caret movement must not replace the captured cell or its range.
  position={sectionIndex:0,paragraphIndex:0,charOffset:0};dialog.onConfirm();
  const after=Buffer.from(d.exportHwpx()),afterProps=props(0,4),afterDefs=wasm.getNumberingList(),afterSVG=svgs(d);
  assert.deepEqual(labels(),Array(4).fill(null),JSON.stringify({depth:c.depth,merged:c.merged,id:sc.id}));assert.deepEqual(body(),beforeBody);assert.deepEqual(own(),beforeOwn);
  if(!sc.block){assert.deepEqual(props(1,2),beforeNeighbor);assert.deepEqual([0,1].map(p=>label(d,'이웃'+p+'끝AbC')),[null,null]);}
  else if(sc.id==='block-preserve-independent-ids'||sc.id==='block-previous-keep-ids')assert.deepEqual(props(1,2),beforeNeighbor);
  const expectedId=sc.chosen==='new'?beforeDefs.length+1:sc.chosen==='none'?0:ids[sc.chosen];
  for(const p of sc.block?[0,1,2,3]:sc.range?[2,3]:[3]){assert.equal(afterProps[p].numberingId,expectedId);assert.equal(afterProps[p].paraLevel,beforeProps[p].headType==='Number'?beforeProps[p].paraLevel:0);}
  assert.equal(afterDefs.length,beforeDefs.length+(sc.chosen==='new'?1:0));assert.deepEqual(afterDefs.slice(0,beforeDefs.length),beforeDefs);
  if(sc.mode===2)assert.equal(afterProps[sc.block?0:3].numberingStartNum,sc.start);
  if(after.equals(before)){assert(!history.canUndo());noOps++;}else for(let n=0;n<3;n++){history.undo(wasm);undos++;assert(Buffer.from(d.exportHwpx()).equals(before));assert.deepEqual(svgs(d),beforeSVG);history.redo(wasm);redos++;assert(Buffer.from(d.exportHwpx()).equals(after));assert.deepEqual(svgs(d),afterSVG);}
  const id='d'+c.depth+'-m'+c.merged+'-v'+direction+'-'+sc.id,input=nodePath.resolve(out,id+'-before.hwpx');fs.writeFileSync(input,before);
  for(const f of ['Hwp','Hwpx']){const e=d['export'+f+'WithReport']();try{assert.equal(JSON.parse(e.contentLoss()).count,0);const bytes=e.takeBytes(),r=new HwpDocument(bytes);try{const file=nodePath.resolve(out,id+'.'+f.toLowerCase());fs.writeFileSync(file,bytes);assert.deepEqual(Array.from({length:4},(_,p)=>JSON.parse(r.getCellParaPropertiesAtByPath(0,c.parent,json(0,p)))),afterProps);assert.deepEqual([0,1].map(p=>JSON.parse(r.getParaPropertiesAt(0,p===0?0:c.parent+1))),beforeBody.map(x=>x.props));assert.deepEqual(Array.from({length:4},(_,p)=>label(r,'대상'+p+'끝AbC')),Array(4).fill(null));assert.deepEqual(Array.from({length:c.cellCount},(_,cell)=>JSON.parse(r.getCellOwnPropertiesByPath(0,c.parent,json(cell,0)))),beforeOwn);manifest.push({input,file,parent:c.parent,path:c.path,expected:afterProps,neighbor:props(1,2),labels:Array(4).fill(null),numberings:afterDefs,verticalDirection:direction,own:beforeOwn,depth:c.depth,texts:Array.from({length:4},(_,p)=>'대상'+p+'끝AbC')});reopens++;}finally{r.free();}}finally{e.free();}}
  position=posAt(c,0,3);selection=null;
  const capture=ih.captureCellNumbering();for(const bad of [[definition(),1,1,65535],[definition(),2,0,0]]){assert.equal(capture.apply(...bad),false);assert(Buffer.from(d.exportHwpx()).equals(after));rejections++;}
  const invalidPath=path(0,0);invalidPath.at(-1).cellIndex=999;assert.throws(()=>d.applyParaFormatInCellsByPaths(0,c.parent,JSON.stringify([path(0,0),invalidPath]),JSON.stringify({headType:'Number',numberingId:a,paraLevel:0})));assert(Buffer.from(d.exportHwpx()).equals(after));rejections++;
  if(sc.id==='plain-ahead') {
    for(const mutate of [
      ()=>d.insertTextInCellByPath(0,c.parent,json(0,3),0,'변경'),
      ()=>d.splitParagraphInCellByPath(0,c.parent,json(0,2),Array.from(text(0,2)).length),
      ()=>wasm.createNumbering(definition(7)),
    ]) {
      const cap=ih.captureCellNumbering(),snapshot=wasm.saveSnapshot();try{mutate();const changed=Buffer.from(d.exportHwpx());assert.equal(cap.apply(definition(),2,1,0),false);assert(Buffer.from(d.exportHwpx()).equals(changed));rejections++;}finally{wasm.restoreSnapshot(snapshot);wasm.discardSnapshot(snapshot);}
      assert(Buffer.from(d.exportHwpx()).equals(after));assert.deepEqual(svgs(d),afterSVG);
    }
    const cap=ih.captureCellNumbering();wasm.documentGeneration++;assert.equal(cap.apply(definition(),2,1,0),false);wasm.documentGeneration--;assert(Buffer.from(d.exportHwpx()).equals(after));rejections++;
  }
  if(sc.id==='existing-previous') {
    ih.executeOperation({kind:'snapshot',operationType:'seedCellRedo',operation:w=>{w.applyParaFormatInCellsByPaths(0,c.parent,[path(0,2)],{alignment:'left'});return position;}});
    history.undo(wasm);undos++;assert(history.canRedo());ih.captureCellNumbering().apply(definition(),1,1,a);assert(history.canRedo());assert(Buffer.from(d.exportHwpx()).equals(after));noOps++;
    history.redo(wasm);redos++;history.undo(wasm);undos++;assert(Buffer.from(d.exportHwpx()).equals(after));
  }
  if(sc.id==='range-continue'){
   selection={start:posAt(c,0,2),end:posAt(c,0,3)};const cap=ih.captureCellNumbering(),saved=wasm.applyParaFormatInCellsByPaths.bind(wasm);let calls=0;
   wasm.applyParaFormatInCellsByPaths=(...args)=>{if(Object.keys(args[3]).length&&++calls===2)throw new Error('injected cell numbering failure');return saved(...args);};
   assert.throws(()=>cap.apply(definition(7),2,7,0),/injected cell numbering failure/);wasm.applyParaFormatInCellsByPaths=saved;assert(Buffer.from(d.exportHwpx()).equals(after));rollbacks++;
  }
  rows.push({id,definitionsBefore:beforeDefs.length,definitionsAfter:afterDefs.length,verticalDirection:direction,verticalTextRotationChecked:true,visibleVerticalNumberingSupported:false});cases++;
 }finally{history.clear(wasm);d.free();}
}
const proof={cases,reopens,undos,redos,rejections,noOps,rollbacks,rows,engineSHA256:sha(bytes),sourceSHA256:Object.fromEntries(Object.entries(source).map(([k,v])=>[k,sha(v)])),visibleVerticalNumberingSupported:false,actualDialogBodyAndListeners:true,actualInputHandlerAndHistory:true,GUIVerified:false};fs.writeFileSync(nodePath.join(out,'manifest.json'),JSON.stringify(manifest,null,2));fs.writeFileSync(nodePath.join(out,'proof.json'),JSON.stringify(proof,null,2));console.log(JSON.stringify(proof));

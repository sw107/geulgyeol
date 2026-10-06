// Actual package WASM + current numbering dialog/command/InputHandler/CommandHistory.
// Modal DOM, cursor geometry and screen refresh are adapters; this reproduces a gap.
import fs from 'node:fs';
import path from 'node:path';
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
const bytes = fs.readFileSync(path.join(engine, 'rhwp_bg.wasm'));
const {
  initSync,
  HwpDocument
} = await import(pathToFileURL(path.resolve(engine, 'rhwp.js')));
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
const fixtures=JSON.parse(fs.readFileSync('../nested-paragraph-qa/behavior/native/proof.json')).fixtures.filter(x=>!x.equations&&!x.merged&&x.file.endsWith('.hwpx'));
const pathAt=(c,cell,p)=>[...c.path.slice(0,-1),{...c.path.at(-1),cellIndex:cell,cellParaIndex:p}];
const posAt=(c,p)=>{const cellPath=pathAt(c,0,p),first=cellPath[0];return {sectionIndex:0,paragraphIndex:c.parent,parentParaIndex:c.parent,controlIndex:first.controlIndex,cellIndex:first.cellIndex,cellParaIndex:first.cellParaIndex,cellPath,charOffset:1};};
const compact=svg=>[...svg.matchAll(/<(text|tspan)\b[^>]*>([^<]*)<\/\1>/g)].map(x=>x[2]).join('').replace(/\s/g,'');
const label=(d,text)=>{const all=Array.from({length:d.pageCount()},(_,i)=>compact(d.renderPageSvg(i))).join('');return all.match(new RegExp('(\\d+(?:\\.\\d+)*\\.)'+text))?.[1]??null;};
const rows=[];
for(const c of fixtures)for(const [route,mode,existing] of [['plain-ahead',0,false],['existing-previous',1,true],['multilevel-previous',1,true],['new-start',2,false]]){
 const d=new HwpDocument(fs.readFileSync(c.file)),w=new BridgeProbe(d),nid=w.ensureDefaultNumbering();
 const para=(cell,p)=>JSON.stringify(pathAt(c,cell,p));
 for(let p=0;p<2;p++){const old=d.getTextInCellByPath(0,c.parent,para(0,p),0,100000);d.deleteTextInCellByPath(0,c.parent,para(0,p),0,Array.from(old).length);d.insertTextInCellByPath(0,c.parent,para(0,p),0,'대상'+p+'끝');}
 for(let p=2;p<4;p++){d.splitParagraphInCellByPath(0,c.parent,para(0,p-1),d.getTextInCellByPath(0,c.parent,para(0,p-1),0,100000).length);d.insertTextInCellByPath(0,c.parent,para(0,p),0,p===2?'설명끝':'대상3끝');}
 d.applyParaFormat(0,0,JSON.stringify({headType:'Number',numberingId:nid,paraLevel:0}));
 d.applyParaFormat(0,c.parent+1,JSON.stringify({headType:'Number',numberingId:nid,paraLevel:0}));
 for(const p of [0,1,...(existing?[3]:[])])d.applyParaFormatInCellsByPaths(0,c.parent,JSON.stringify([pathAt(c,0,p)]),JSON.stringify({headType:'Number',numberingId:nid,paraLevel:route==='multilevel-previous'?1:0}));
 for(const p of [0,1])d.applyParaFormatInCellsByPaths(0,c.parent,JSON.stringify([pathAt(c,1,p)]),JSON.stringify({headType:'Number',numberingId:nid,paraLevel:0}));
 const history=new CommandHistory(),ih=new HandlerProbe();let position=posAt(c,3);
 Object.assign(ih,{wasm:w,history,cursor:{isInFootnote:()=>false,isInHeaderFooter:()=>false,isInCellSelectionMode:()=>false,getSelectionOrdered:()=>null,getPosition:()=>position,getRect:()=>null,moveTo:p=>{position=p;},resetPreferredX(){}},isOperationAllowedInEditMode:()=>true,prepareTextMutationBeforeCursor:()=>false,caretLayoutReveal:{requestFor(){}},refreshAfterOperation(){},focus(){},focusTextarea(){}});
 try{
  const beforeDefs=w.getNumberingList(),beforeBytes=Buffer.from(d.exportHwpx()),beforeProps=JSON.parse(d.getCellParaPropertiesAtByPath(0,c.parent,para(0,3))),beforeLabels=[0,1,3].map(p=>label(d,'대상'+p+'끝'));
  formatCommands.find(x=>x.id==='format:para-num-shape').execute({getInputHandler:()=>ih,wasm:w,eventBus:{}});const dialog=globalThis.__gapDialog;
  dialog.selectedPreset=2;dialog.restartMode=mode;dialog.startNumber=mode===2?5:1;dialog.onConfirm();
  const afterProps=JSON.parse(d.getCellParaPropertiesAtByPath(0,c.parent,para(0,3))),afterLabel=label(d,'대상3끝');
  history.undo(w);const undoDefinitions=w.getNumberingList().length,undoBytes=Buffer.from(d.exportHwpx()).equals(beforeBytes);
  const row={depth:c.depth,route,beforeLabels,beforeProps,afterProps,afterLabel,expectedLocalContinuationLabel:'3.',definitionsBefore:beforeDefs.length,definitionsAfterUndo:undoDefinitions,undoRestoresBytes:undoBytes};rows.push(row);
 }finally{history.clear(w);d.free();}
}
fs.writeFileSync(path.join(out,'proof.json'),JSON.stringify({rows,GUIVerified:false,scope:'reproduce only'},null,2));console.log(JSON.stringify(rows.map(({depth,route,beforeLabels,afterLabel,definitionsBefore,definitionsAfterUndo,undoRestoresBytes,afterProps})=>({depth,route,beforeLabels,afterLabel,definitionsBefore,definitionsAfterUndo,undoRestoresBytes,levelAfter:afterProps.paraLevel}))));

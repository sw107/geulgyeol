// Four-page cell: full-prefix numbering and snapshot history through actual UI/WASM.
// Actual package WASM + current numbering dialog/command/InputHandler/CommandHistory.
// Modal DOM, cursor geometry and screen refresh are adapters; this reproduces a gap.
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
const seed=HwpDocument.createEmpty();seed.createBlankDocument();const r=JSON.parse(seed.createTableEx(JSON.stringify({sectionIdx:0,paraIdx:0,charOffset:0,rowCount:1,colCount:1,treatAsChar:false,colWidths:[12000],rowHeights:[1300]})));seed.setTableProperties(0,r.paraIdx,r.controlIdx,JSON.stringify({treatAsChar:false,pageBreak:2}));const nid=seed.ensureDefaultNumbering(),parent=r.paraIdx,ci=r.controlIdx;
const path=p=>JSON.stringify([{controlIndex:ci,cellIndex:0,cellParaIndex:p}]);seed.beginBatch();try{for(let p=0;p<124;p++){if(p)seed.splitParagraphInCellByPath(0,parent,path(p-1),Array.from(seed.getTextInCellByPath(0,parent,path(p-1),0,100000)).length);seed.insertTextInCellByPath(0,parent,path(p),0,'항목'+p+'끝');if(p<123)seed.applyParaFormatInCellsByPaths(0,parent,JSON.stringify([JSON.parse(path(p))]),JSON.stringify({headType:'Number',numberingId:nid,paraLevel:0}));}}finally{seed.endBatch();}const bytesSeed=seed.exportHwpx();seed.free();const d=new HwpDocument(bytesSeed),wasm=new BridgeProbe(d),history=new CommandHistory(),ih=new HandlerProbe();let position={sectionIndex:0,paragraphIndex:parent,parentParaIndex:parent,controlIndex:ci,cellIndex:0,cellParaIndex:123,cellPath:JSON.parse(path(123)),charOffset:1};Object.assign(ih,{wasm,history,cursor:{isInFootnote:()=>false,isInHeaderFooter:()=>false,isInCellSelectionMode:()=>false,getSelectionOrdered:()=>null,getPosition:()=>position,getRect:()=>null,moveTo:p=>{position=p;},resetPreferredX(){}},isOperationAllowedInEditMode:()=>true,prepareTextMutationBeforeCursor:()=>false,caretLayoutReveal:{requestFor(){}},refreshAfterOperation(){},focus(){},focusTextarea(){}});
try{const before=Buffer.from(d.exportHwpx());formatCommands.find(x=>x.id==='format:para-num-shape').execute({getInputHandler:()=>ih,wasm,eventBus:{}});const dialog=globalThis.__gapDialog;dialog.selectedPreset=2;dialog.restartMode=0;dialog.onConfirm();assert(d.pageCount()>1);const svg=Array.from({length:d.pageCount()},(_,i)=>d.renderPageSvg(i));const compact=svg.join('').replace(/<[^>]*>/g,'').replace(/\s/g,'');for(let p=0;p<124;p++)assert(compact.includes((p+1)+'.항목'+p+'끝'),p+' '+compact);const after=Buffer.from(d.exportHwpx());history.undo(wasm);assert(Buffer.from(d.exportHwpx()).equals(before));history.redo(wasm);assert(Buffer.from(d.exportHwpx()).equals(after));let reopens=0;for(const f of ['Hwp','Hwpx']){const e=d['export'+f+'WithReport']();try{assert.equal(JSON.parse(e.contentLoss()).count,0);const b=e.takeBytes(),r=new HwpDocument(b);try{assert.equal(r.pageCount(),d.pageCount());const compact=Array.from({length:r.pageCount()},(_,i)=>r.renderPageSvg(i)).join('').replace(/<[^>]*>/g,'').replace(/\s/g,'');for(let p=0;p<124;p++)assert(compact.includes((p+1)+'.항목'+p+'끝'));fs.writeFileSync(nodePath.join(out,'page.'+f.toLowerCase()),b);reopens++;}finally{r.free();}}finally{e.free();}}fs.writeFileSync(nodePath.join(out,'proof.json'),JSON.stringify({pageCount:d.pageCount(),paragraphs:124,reopens,undo:1,redo:1,GUIVerified:false},null,2));}finally{history.clear(wasm);d.free();}

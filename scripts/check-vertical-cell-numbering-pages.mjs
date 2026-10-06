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

const cases=[],manifest=[];
const svgs=d=>Array.from({length:d.pageCount()},(_,i)=>d.renderPageSvg(i));
const compact=d=>svgs(d).join('').replace(/<[^>]*>/g,'').replace(/\s/g,'');
const def=()=>JSON.stringify({levelFormats:Array(7).fill('^N'),numberFormats:Array(7).fill(0),startNumber:1});
for(const direction of [1,2])for(const splitTable of [false,true]){
 const seed=HwpDocument.createEmpty();seed.createBlankDocument();seed.insertText(0,0,0,'본문보존끝');const r=JSON.parse(seed.createTableEx(JSON.stringify({sectionIdx:0,paraIdx:0,charOffset:0,rowCount:1,colCount:2,treatAsChar:false,colWidths:[12000,12000],rowHeights:[1300]})));const parent=r.paraIdx,ci=r.controlIdx;seed.setTableProperties(0,parent,ci,JSON.stringify({treatAsChar:false,pageBreak:2}));const nid=seed.createNumbering(def()),texts=Array.from({length:124},(_,p)=>'항목'+p+'끝AbC');const path=(cell,p)=>[{controlIndex:ci,cellIndex:cell,cellParaIndex:p}],json=(cell,p)=>JSON.stringify(path(cell,p));
 seed.beginBatch();try{for(const cell of [0,1]){seed.applyCellOwnPropertiesByPaths(0,parent,JSON.stringify([path(cell,0)]),JSON.stringify({textDirection:cell===1&&splitTable?0:direction}));for(let p=0;p<(cell===0?124:2);p++){if(p)seed.splitParagraphInCellByPath(0,parent,json(cell,p-1),seed.getCellParagraphLengthByPath(0,parent,json(cell,p-1)));seed.insertTextInCellByPath(0,parent,json(cell,p),0,cell===0?texts[p]:'인접'+p+'끝AbC'+(splitTable&&p===0?'긴옆셀'.repeat(500):''));if(cell===1||p<123)seed.applyParaFormatInCellsByPaths(0,parent,JSON.stringify([path(cell,p)]),JSON.stringify({headType:'Number',numberingId:nid,paraLevel:0}));}}for(const p of [0,parent+1])seed.applyParaFormat(0,p,JSON.stringify({headType:'Number',numberingId:nid,paraLevel:0}));}finally{seed.endBatch();}
 const bytesSeed=seed.exportHwpx();seed.free();const d=new HwpDocument(bytesSeed),wasm=new BridgeProbe(d),history=new CommandHistory(),ih=new HandlerProbe();let position={sectionIndex:0,paragraphIndex:parent,parentParaIndex:parent,controlIndex:ci,cellIndex:0,cellParaIndex:123,cellPath:path(0,123),charOffset:1};Object.assign(ih,{wasm,history,cursor:{isInFootnote:()=>false,isInHeaderFooter:()=>false,isInCellSelectionMode:()=>false,getSelectionOrdered:()=>null,getPosition:()=>position,getRect:()=>null,moveTo:p=>{position=p;},resetPreferredX(){}},isOperationAllowedInEditMode:()=>true,prepareTextMutationBeforeCursor:()=>false,caretLayoutReveal:{requestFor(){}},refreshAfterOperation(){},focus(){},focusTextarea(){}});
 const props=(doc,cell,count)=>Array.from({length:count},(_,p)=>JSON.parse(doc.getCellParaPropertiesAtByPath(0,parent,json(cell,p)))),own=doc=>[0,1].map(cell=>JSON.parse(doc.getCellOwnPropertiesByPath(0,parent,json(cell,0)))),body=doc=>[0,parent+1].map(p=>JSON.parse(doc.getParaPropertiesAt(0,p)));
 try{const originalOwn=own(d),neighbor=props(d,1,2),bodyBefore=body(d);if(splitTable)assert(d.pageCount()>1);for(const action of ['ahead','new','clear']){
  position={sectionIndex:0,paragraphIndex:parent,parentParaIndex:parent,controlIndex:ci,cellIndex:0,cellParaIndex:123,cellPath:path(0,123),charOffset:1};const before=Buffer.from(d.exportHwpx()),beforeSVG=svgs(d),beforeDefs=wasm.getNumberingList();formatCommands.find(x=>x.id==='format:para-num-shape').execute({getInputHandler:()=>ih,wasm,eventBus:{}});const dialog=globalThis.__gapDialog,inputs=globalThis.__gapDOM.querySelectorAll('input');inputs.find(x=>x.name==='nd-preset'&&x.value===(action==='clear'?'0':'2')).dispatch('change');inputs.find(x=>x.name==='nd-restart-mode'&&x.value===(action==='new'?'2':'0')).dispatch('change');const start=inputs.find(x=>x.type==='number');start.value='5';start.dispatch('input');dialog.onConfirm();
  const after=Buffer.from(d.exportHwpx()),afterSVG=svgs(d),expected=props(d,0,124),numberings=wasm.getNumberingList();assert.equal(expected[123].headType,action==='clear'?'None':'Number');assert.equal(expected[123].numberingId,action==='clear'?0:action==='new'?beforeDefs.length+1:nid);assert.equal(numberings.length,beforeDefs.length+(action==='new'?1:0));assert.deepEqual(numberings.slice(0,beforeDefs.length),beforeDefs);assert.deepEqual(own(d),originalOwn);assert.deepEqual(props(d,1,2),neighbor);assert.deepEqual(body(d),bodyBefore);history.undo(wasm);assert(Buffer.from(d.exportHwpx()).equals(before));assert.deepEqual(svgs(d),beforeSVG);history.redo(wasm);assert(Buffer.from(d.exportHwpx()).equals(after));assert.deepEqual(svgs(d),afterSVG);
  const text=compact(d),occurrences=texts.map(t=>text.split(t).length-1);assert(occurrences.every(n=>n>0));const id='v'+direction+'-splitTable'+splitTable+'-'+action,input=nodePath.resolve(out,id+'-before.hwpx');fs.writeFileSync(input,before);for(const f of ['Hwp','Hwpx']){const e=d['export'+f+'WithReport']();try{assert.equal(JSON.parse(e.contentLoss()).count,0);const bytes=e.takeBytes(),re=new HwpDocument(bytes);try{assert.deepEqual(props(re,0,124),expected);assert.deepEqual(own(re),originalOwn);assert.deepEqual(props(re,1,2),neighbor);assert.deepEqual(body(re),bodyBefore);const reopened=compact(re);assert.deepEqual(texts.map(t=>reopened.split(t).length-1),occurrences);const file=nodePath.resolve(out,id+'.'+f.toLowerCase());fs.writeFileSync(file,bytes);manifest.push({input,file,parent,path:path(0,0),expected,neighbor,labels:Array(124).fill(null),texts,numberings,own:originalOwn,verticalDirection:direction,depth:1});}finally{re.free();}}finally{e.free();}}
  cases.push({id,direction,splitTable,storedCellHeight:originalOwn[0].height,outsidePageGlyphs:svgs(d).join('').match(/<text x="-\d/g)?.length??0,pageCount:d.pageCount(),paragraphs:124,uniqueTextOccurrences:[...new Set(occurrences)],duplicateParagraphs:occurrences.filter(n=>n>1).length,visibleVerticalNumberingSupported:false});
 }}finally{history.clear(wasm);d.free();}
}
const proof={cases:cases.length,reopens:manifest.length,undos:cases.length,redos:cases.length,observations:cases,engineSHA256:sha(bytes),GUIVerified:false,verticalPaginationSupported:false};fs.writeFileSync(nodePath.join(out,'proof.json'),JSON.stringify(proof,null,2));fs.writeFileSync(nodePath.join(out,'manifest.json'),JSON.stringify(manifest,null,2));console.log(JSON.stringify(proof));

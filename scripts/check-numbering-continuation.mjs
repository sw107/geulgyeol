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
for (const n of ['getTextRange', 'getParagraphLength', 'getParagraphCount', 'getParaPropertiesAt', 'ensureDefaultNumbering', 'createNumbering', 'getNumberingList', 'applyParaFormat', 'setParaShapeId', 'saveSnapshot', 'restoreSnapshot', 'discardSnapshot', 'runInBatch']) bridge += method(source.bridge, n);
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
let h = 'const {ApplyParaFormatCommand,SnapshotCommand,SubmodeSnapshotCommand,SubmodeSelectionSnapshotCommand}=globalThis.__gapCommands;export class HandlerProbe{\n';
for (const n of ['captureBodyNumbering', 'getParaProperties', 'applyNumbering', 'applyParaPropsAtCursor', 'applyParaFormat', 'applyParaFormatInNoteOrHeader', 'getFootnoteCharFormatSelection', 'getSelectedCellBlock', 'getParaFormatTargetsAtCursor', 'getParaFormatTargetsForRange', 'executeParaFormatCommand', 'executeOperation']) h += method(source.input, n);
h += '}';
const {
  HandlerProbe
} = await load(h);
const nodes = svg => [...svg.matchAll(/<(text|tspan)\b[^>]*>([^<]*)<\/\1>/g)].map(x => x[2]).join('').replace(/\s/g, '');
const marker = (d, p) => nodes(d.renderPageSvg(0)).match(new RegExp('(\\d+(?:\\.\\d+)*\\.)항목' + p + '끝'))?.[1] ?? null;
const definition = (start = 1, hierarchy = false) => JSON.stringify({levelFormats:Array(7).fill(hierarchy ? '^N' : '').map((x,i)=>x || '^'+(i+1)+'.'), numberFormats:Array(7).fill(0), startNumber:start});
const cases = [
  {id:'plain-ahead', heads:['A','A',null,null], mode:0, expected:['1.','2.',null,'3.'], dest:'A'},
  {id:'existing-previous', heads:['A','A',null,'A'], mode:1, expected:['1.','2.',null,'3.'], dest:'A'},
  {id:'existing-ahead-control', heads:['A','A',null,'A'], mode:0, expected:['1.','2.',null,'3.'], dest:'A'},
  {id:'new-start-control', heads:['A','A',null,null], mode:2,start:5, expected:['1.','2.',null,'5.'], dest:'new'},
  {id:'ahead-after-other-list', heads:['A','A','B',null], mode:0,expected:['1.','2.','1.','2.'],dest:'B'},
  {id:'resume-current-list', heads:['A','A','B','A'], mode:1,expected:['1.','2.','1.','3.'],dest:'A'},
  {id:'select-earlier-list', heads:['A','A','B',null], mode:1,previous:'A',expected:['1.','2.','1.','3.'],dest:'A'},
  {id:'select-nearest-list', heads:['A','A','B',null], mode:1,previous:'B',expected:['1.','2.','1.','2.'],dest:'B'},
  {id:'bullet-id-does-not-select-number-list', heads:['A','A','bullet',null],mode:0,expected:['1.','2.',null,'3.'],dest:'A'},
  {id:'multilevel-continue', heads:['A','A','A','B'],levels:[0,1,1,1],hierarchy:true,mode:0,expected:['1.','1.1.','1.2.','1.3.'],dest:'A'},
  {id:'independent-hierarchy-engine', heads:['A','A',null,'B'],levels:[0,0,0,1],hierarchy:true,mode:0,expected:['1.','2.',null,'2.1.'],dest:'A',beforeLast:'1.1.'},
  {id:'independent-multilevel-start',heads:['A','A',null,'A'],levels:[0,0,0,1],hierarchy:true,mode:2,start:5,expected:['1.','2.',null,'5.'],dest:'new'},
  {id:'range-keeps-levels',heads:['A','A','B','A','A'],levels:[0,1,0,0,1],hierarchy:true,mode:0,selection:[3,4],expected:['1.','1.1.','1.','2.','2.1.'],dest:'B'},
  {id:'range-plain-continue',heads:['A','A','B',null,null],mode:0,selection:[3,4],expected:['1.','2.','1.','2.','3.'],dest:'B'},
  {id:'references-preserved', heads:['A','A',null,null],mode:0,expected:['1.','2.',null,'3.'],dest:'A',note:true},
  {id:'clear-numbering-saved-target',heads:['A','A',null,'A'],mode:0,clear:true,expected:['1.','2.',null,null],dest:'none'},
  {id:'clear-numbering-range',heads:['A','A','B','A','A'],levels:[0,0,0,0,1],mode:0,clear:true,selection:[3,4],expected:['1.','2.','1.',null,null],dest:'none'},
  {id:'clear-numbering-noop',heads:[null,null,null,null],mode:0,clear:true,expected:[null,null,null,null],dest:'none'},
  {id:'fresh-ahead',heads:[null,null,null,null],mode:0,expected:[null,null,null,'1.'],dest:'new'},
  {id:'new-list-does-not-merge-later-old-list',heads:['A','A',null,null,'A','B'],mode:2,start:5,expected:['1.','2.',null,'5.','3.','1.'],dest:'new'},
];
let reopens=0,undos=0,redos=0,rejections=0,noOps=0,structural=0,rollbacks=0;
const rows=[], manifests=[];
// Restart mode is inferred from preceding list IDs; the stored paragraph shapes remain unchanged.
const storedProps = ({numberingRestartMode, ...props}) => props;
for (const c of cases) {
  if (onlyCase && c.id !== onlyCase) continue;
  let d=HwpDocument.createEmpty(); d.createBlankDocument();
  // Load a real HWPX baseline so blank-document border defaults are canonical before exact cross-format comparisons.
  const seed=d.exportHwpx();d.free();d=new HwpDocument(seed);
  const texts=c.heads.map((_,p)=>'항목'+p+'끝');
  texts.forEach((t,p)=>{if(p)d.splitParagraph(0,p-1,Array.from(texts[p-1]).length);d.insertText(0,p,0,t);});
  const wasm=new BridgeProbe(d), ids={A:wasm.createNumbering(definition(1,c.hierarchy)),B:wasm.createNumbering(definition(1,c.hierarchy))};
  c.heads.forEach((head,p)=>{if(head==='bullet'){const bid=d.ensureDefaultBullet('●');wasm.applyParaFormat(0,p,JSON.stringify({headType:'Bullet',numberingId:bid,paraLevel:0}));}else if(head)wasm.applyParaFormat(0,p,JSON.stringify({headType:'Number',numberingId:ids[head],paraLevel:c.levels?.[p]??0}));});
  if(c.note){const note=JSON.parse(d.insertFootnote(0,2,0));assert(note.ok);d.insertTextInFootnote(0,2,note.controlIdx,0,1,'주석 보존😀');}
  const history=new CommandHistory(),ih=new HandlerProbe();
  let pos={sectionIndex:0,paragraphIndex:3,charOffset:1},selection=c.selection?{start:{...pos,paragraphIndex:c.selection[0],charOffset:0},end:{...pos,paragraphIndex:c.selection[1],charOffset:2}}:null;
  const cursor={isInFootnote:()=>false,isInHeaderFooter:()=>false,isInCellSelectionMode:()=>false,getSelectionOrdered:()=>selection,getPosition:()=>({...pos}),getRect:()=>null,moveTo:p=>{pos={...p};},resetPreferredX(){}};
  Object.assign(ih,{wasm,cursor,history,focus(){},focusTextarea(){},isOperationAllowedInEditMode:()=>true,prepareTextMutationBeforeCursor:()=>false,caretLayoutReveal:{requestFor(){}},refreshAfterOperation(){}});
  const props=()=>texts.map((_,p)=>wasm.getParaPropertiesAt(0,p));
  const labels=()=>texts.map((_,p)=>marker(d,p));
  try {
    const beforeProps=props(),beforeBytes=Buffer.from(d.exportHwpx()),beforeSVG=d.renderPageSvg(0),beforeDefs=wasm.getNumberingList(),beforeText=d.getTextFileText();
    if(c.beforeLast)assert.equal(marker(d,3),c.beforeLast);
    const input=path.resolve(out,c.id+'-before.hwpx');fs.writeFileSync(input,beforeBytes);
    formatCommands.find(x=>x.id==='format:para-num-shape').execute({getInputHandler:()=>ih,wasm,eventBus:{}});
    const dialog=globalThis.__gapDialog;assert(dialog instanceof NumberingDialog);assert.equal(typeof dialog.onApplyDefinition,'function');
    const inputs=globalThis.__gapDOM.querySelectorAll('input');
    const preset=inputs.find(n=>n.name==='nd-preset'&&n.value===(c.clear?'0':'2'));preset.dispatch('change');
    const mode=inputs.find(n=>n.name==='nd-restart-mode'&&n.value===String(c.mode));mode.dispatch('change');
    const start=inputs.find(n=>n.type==='number');assert.equal(start.disabled,c.mode!==2);start.value=String(c.start??1);start.dispatch('input');
    const previous=globalThis.__gapDOM.querySelectorAll('select')[0];assert.equal(previous.disabled,c.mode!==1);
    if(c.previous){previous.value=String(ids[c.previous]);previous.dispatch('change');}
    // The modal may move the caret; the captured range must remain authoritative.
    pos={...pos,paragraphIndex:0};dialog.onConfirm();
    const afterProps=props(),afterDefs=wasm.getNumberingList(),afterBytes=Buffer.from(d.exportHwpx()),afterSVG=d.renderPageSvg(0);
    assert.equal(d.getTextFileText(),beforeText);assert.deepEqual(labels(),c.expected,c.id);
    const chosen=c.dest==='new'?beforeDefs.length+1:c.dest==='none'?0:ids[c.dest];
    for(const p of c.selection??[3]) assert.equal(afterProps[p].numberingId,chosen);
    for(let p=0;p<texts.length;p++) if(!(c.selection??[3]).includes(p))assert.deepEqual(storedProps(afterProps[p]),storedProps(beforeProps[p]));
    assert.equal(afterDefs.length,beforeDefs.length+(c.dest==='new'?1:0));
    if(c.mode===2)assert.equal(afterProps[3].numberingStartNum,c.start??1);
    const changed=!afterBytes.equals(beforeBytes);
    if(changed){for(let n=0;n<3;n++){history.undo(wasm);undos++;assert.deepEqual(props(),beforeProps);assert.deepEqual(wasm.getNumberingList(),beforeDefs);assert.equal(d.renderPageSvg(0),beforeSVG);assert(Buffer.from(d.exportHwpx()).equals(beforeBytes));history.redo(wasm);redos++;assert.deepEqual(props(),afterProps);assert.equal(d.renderPageSvg(0),afterSVG);assert(Buffer.from(d.exportHwpx()).equals(afterBytes));}}
    else {noOps++;assert.equal(history.canUndo(),false);}
    if(c.id==='existing-previous') {
      pos={...pos,paragraphIndex:3};
      ih.executeOperation({kind:'snapshot',operationType:'seedRedo',operation:w=>{w.applyParaFormat(0,2,JSON.stringify({alignment:'left'}));return pos;}});
      history.undo(wasm);undos++;assert(history.canRedo());
      ih.captureBodyNumbering().apply(definition(),1,1,ids.A);assert(history.canRedo());assert(Buffer.from(d.exportHwpx()).equals(afterBytes));noOps++;
      history.redo(wasm);redos++;assert.equal(wasm.getParaPropertiesAt(0,2).alignment,'left');
      history.undo(wasm);undos++;assert(Buffer.from(d.exportHwpx()).equals(afterBytes));
    }
    if(c.id==='range-plain-continue') {
      const saved=wasm.applyParaFormat.bind(wasm),top=history.peekUndoTop();let calls=0;
      wasm.applyParaFormat=(...args)=>{if(++calls===2)throw new Error('injected numbering apply failure');return saved(...args);};
      assert.throws(()=>ih.captureBodyNumbering().apply(definition(7),2,7,0),/injected numbering apply failure/);
      wasm.applyParaFormat=saved;assert(Buffer.from(d.exportHwpx()).equals(afterBytes));assert.equal(history.peekUndoTop(),top);rollbacks++;
    }
    // Invalid reference/mode/start/stale-target calls must preserve bytes and history.
    for(const bad of [[definition(),1,1,999],[definition(),99,1,0],[definition(),2,0,0]]){const capture=ih.captureBodyNumbering();assert(capture);const raw=Buffer.from(d.exportHwpx());assert.equal(capture.apply(...bad),false);assert(Buffer.from(d.exportHwpx()).equals(raw));rejections++;}
    const capture=ih.captureBodyNumbering();wasm.documentGeneration++;assert.equal(capture.apply(definition(),2,1,0),false);assert(Buffer.from(d.exportHwpx()).equals(afterBytes));wasm.documentGeneration--;rejections++;
    if(c.id==='plain-ahead') {
      for(const mutate of [
        ()=>d.insertText(0,3,0,'바뀐 내용'),
        ()=>wasm.applyParaFormat(0,3,JSON.stringify({alignment:'left'})),
        ()=>wasm.applyParaFormat(0,2,JSON.stringify({headType:'Number',numberingId:ids.B,paraLevel:0})),
        ()=>wasm.createNumbering(definition(7)),
        ()=>d.splitParagraph(0,2,texts[2].length),
      ]) {
        const capture=ih.captureBodyNumbering(),snapshot=wasm.saveSnapshot();
        try {mutate();const changed=Buffer.from(d.exportHwpx());assert.equal(capture.apply(definition(),2,1,0),false);assert(Buffer.from(d.exportHwpx()).equals(changed));rejections++;}
        finally {wasm.restoreSnapshot(snapshot);wasm.discardSnapshot(snapshot);}
        assert(Buffer.from(d.exportHwpx()).equals(afterBytes));assert.equal(d.renderPageSvg(0),afterSVG);
      }
    }
    for(const f of ['Hwp','Hwpx']){
      const e=d['export'+f+'WithReport']();try{assert.equal(JSON.parse(e.contentLoss()).count,0);const b=e.takeBytes(),r=new HwpDocument(b),file=path.resolve(out,c.id+'.'+f.toLowerCase());try{assert.deepEqual(texts.map((_,p)=>JSON.parse(r.getParaPropertiesAt(0,p))),afterProps);assert.deepEqual(texts.map((_,p)=>marker(r,p)),c.expected);fs.writeFileSync(file,b);manifests.push({input,file,expected:afterProps,labels:c.expected,numberings:afterDefs,newId:c.dest==='new'?chosen:null,newStart:c.mode===2?c.start??1:1,startLevel:c.levels?.[3]??0});reopens++;}finally{r.free();}}finally{e.free();}
    }
    if(c.id==='plain-ahead'){
      // Insertion and deletion in the middle must renumber this list only.
      const prior=d.renderPageSvg(0),raw=Buffer.from(d.exportHwpx());
      const structuralSave = action => {
        const count=d.getParagraphCount(0),expected=Array.from({length:count},(_,p)=>JSON.parse(d.getParaPropertiesAt(0,p))),svg=d.renderPageSvg(0);
        const input=path.resolve(out,c.id+'-'+action+'-before.hwpx');fs.writeFileSync(input,d.exportHwpx());
        for(const f of ['Hwp','Hwpx']){
          const e=d['export'+f+'WithReport']();try{assert.equal(JSON.parse(e.contentLoss()).count,0);const b=e.takeBytes(),r=new HwpDocument(b);try{
            assert.deepEqual(Array.from({length:count},(_,p)=>JSON.parse(r.getParaPropertiesAt(0,p))),expected);
            assert.equal(r.renderPageSvg(0),svg);
            const file=path.resolve(out,c.id+'-'+action+'.'+f.toLowerCase());fs.writeFileSync(file,b);
            manifests.push({input,file,expected,labels:[],numberings:wasm.getNumberingList(),newId:null});reopens++;
          }finally{r.free();}}finally{e.free();}
        }
      };
      ih.executeOperation({kind:'snapshot',operationType:'numberingMiddleInsert',operation:w=>{d.splitParagraph(0,0,texts[0].length);d.insertText(0,1,0,'삽입항목끝');return pos;}});
      assert.equal(marker(d,1),'3.');assert.equal(marker(d,3),'4.');structural++;structuralSave('insert');
      history.undo(wasm);assert.equal(d.renderPageSvg(0),prior);assert(Buffer.from(d.exportHwpx()).equals(raw));undos++;
      history.redo(wasm);assert.equal(marker(d,3),'4.');redos++;
      const inserted=d.renderPageSvg(0);
      ih.executeOperation({kind:'snapshot',operationType:'numberingMiddleDelete',operation:w=>{d.mergeParagraph(0,1);return pos;}});
      assert.equal(marker(d,3),'3.');structural++;structuralSave('delete');
      history.undo(wasm);assert.equal(d.renderPageSvg(0),inserted);undos++;
      history.redo(wasm);assert.equal(marker(d,3),'3.');redos++;
    }
    rows.push({id:c.id,changed,numberingId:chosen,expectedLabels:c.expected,definitionsBefore:beforeDefs.length,definitionsAfter:afterDefs.length});
  }finally{history.clear(wasm);d.free();}
}
fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify(manifests,null,2));
const proof={cases:rows.length,reopens,undos,redos,rejections,noOps,structural,rollbacks,rows,engineSHA256:sha(bytes),sourceSHA256:Object.fromEntries(Object.entries(source).map(([k,v])=>[k,sha(v)])),actualNumberingDialogBodyAndInputListeners:true,actualNumberingDialogConfirm:true,actualFormatCommand:true,actualInputHandlerExecuteOperation:true,realCommandHistory:true,GUIVerified:false};
fs.writeFileSync(path.join(out,'proof.json'),JSON.stringify(proof,null,2));console.log(JSON.stringify(proof));

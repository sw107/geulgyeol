// Combined SDK + unchanged production entry/input/command/history/cursor methods.
// DOM and operation-dispatch adapters only: this is not an Electron/IME QA run.
// node SCRIPT PKG MANIFEST NATIVE_CURSOR_RAW FRESH_OUT
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { stripTypeScriptTypes } from 'node:module';
import { pathToFileURL } from 'node:url';
const [pkg, manifest, nativeFile, out] = process.argv.slice(2);
fs.mkdirSync(out);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const load = source => import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(source, { mode: 'transform' })).toString('base64'));
const read = file => fs.readFileSync(file, 'utf8');
const method = (source, name) => {
  let start = source.indexOf('  ' + name + '(');
  if (start < 0) start = source.indexOf('  private ' + name + '(');
  assert(start >= 0, name);
  const end = source.indexOf('\n  }\n', start);
  assert(end > start, name);
  return source.slice(start, end + 4) + '\n';
};
const between = (source, first, last) => {
  const start = source.indexOf(first), end = source.indexOf(last, start);
  assert(start >= 0 && end > start, first);
  return source.slice(start, end);
};
const bridgeSource = read('rhwp-studio/src/core/wasm-bridge.ts');
const cursorSource = read('rhwp-studio/src/engine/cursor.ts');
const commandSource = read('rhwp-studio/src/engine/command.ts');
const inputSource = read('rhwp-studio/src/engine/input-handler-text.ts');
const inputHandlerSource = read('rhwp-studio/src/engine/input-handler.ts');
const insertSource = read('rhwp-studio/src/command/commands/insert.ts');
const bridgeNames = ['getCursorRect', 'getNoteEditInfo', 'getCursorRectInNote', 'getCursorRectInFootnote', 'getFootnoteInfo', 'insertTextInFootnote', 'deleteTextInFootnote'];
const { Bridge } = await load('export class Bridge { doc; constructor(doc){this.doc=doc;}\n' + bridgeNames.map(n => method(bridgeSource, n)).join('') + '}');
const getters = cursorSource.split('\n').filter(line => /^  get fn\w+\(\)/.test(line)).join('\n');
const { Cursor } = await load('export class Cursor {\n' + getters + '\n' +
  ['enterFootnoteMode', 'exitFootnoteMode', 'setFnCursorPosition', 'moveToParagraphEdgeInFn', 'updateRect', 'invalidateFocusedCellCursorGeometry', 'applyPreparedFocusedCellCursorGeometry', 'isInCell'].map(n => method(cursorSource, n)).join('') +
  cursorSource.split('\n').filter(line => /^  isIn(Footnote|HeaderFooter)\(\)/.test(line)).join('\n') + '\n}');
const helpers = ['fnEditContext', 'hfFnStubPosition', 'charCount'].map(name => {
  const start = commandSource.indexOf('function ' + name + '(');
  return commandSource.slice(start, commandSource.indexOf('\n}', start) + 2);
}).join('\n');
const command = between(commandSource, 'export class InsertTextInFootnoteCommand', 'export class DeleteTextInFootnoteCommand');
const { InsertTextInFootnoteCommand } = await load(helpers + '\n' + command);
const noEffects = between(commandSource, 'export const NO_TEXT_MUTATION_EFFECTS', 'export const IMMEDIATE_TEXT_MUTATION_EFFECTS');
const { CommandHistory } = await load(noEffects + read('rhwp-studio/src/engine/history.ts').replace(/^import .*;\n/gm, ''));
const { enterNoteEditing } = await load('export ' + between(insertSource, 'function enterNoteEditing(', '\n/**'));
globalThis.__integrationNoteCommand = InsertTextInFootnoteCommand;
const { onInput } = await load('const InsertTextInFootnoteCommand=globalThis.__integrationNoteCommand;\n' +
  helpers + '\n' + between(inputSource, 'export function onInput(', '\nexport function insertTextAtRaw'));
const { Receiver } = await load('export class Receiver {\n' + method(inputHandlerSource, 'restoreEditContextAfterHistory') + '}');
const M = await import(pathToFileURL(path.resolve(pkg, 'rhwp.js')));
M.initSync({ module: fs.readFileSync(path.join(pkg, 'rhwp_bg.wasm')) });
const fixtures = JSON.parse(read(manifest)), native = JSON.parse(read(nativeFile)), rows = [];
let entryChecks = 0, cursorChecks = 0, historyOperations = 0, recordedInputs = 0;
function model(doc) {
  const sections = Array.from({ length: doc.getSectionCount() }, (_, s) =>
    Array.from({ length: doc.getParagraphCount(s) }, (_, p) => doc.getTextRange(s, p, 0, doc.getParagraphLength(s, p))));
  return sections;
}
function ui(doc) {
  const wasm = new Bridge(doc), cursor = new Cursor(), history = new CommandHistory(), receiver = new Receiver();
  Object.assign(cursor, { wasm, position: { sectionIndex: 0, paragraphIndex: 0, charOffset: 0 }, _headerFooterMode: 'none', _fnFormatRevision: 0, clearSelection() {} });
  Object.assign(receiver, { wasm, cursor, history, active: true, isComposing: false, eventBus: { emit() {} },
    textarea: { value: '', focused: false, focus() { this.focused = true; } }, afterEdit() {},
    executeOperation(operation) { assert.equal(operation.kind, 'record'); history.recordWithoutExecute(operation.command, wasm); recordedInputs++; } });
  return receiver;
}
function enter(receiver, target) {
  receiver.textarea.focused = false;
  enterNoteEditing({ wasm: receiver.wasm, eventBus: receiver.eventBus }, receiver, target.section, target.para, target.control);
  assert(receiver.cursor.isInFootnote() && receiver.textarea.focused);
  assert.equal(receiver.cursor.fnSectionIdx, target.section);
  assert.equal(receiver.cursor.fnParaIdx, target.para);
  assert.equal(receiver.cursor.fnControlIdx, target.control);
  assert.deepEqual(receiver.cursor.rect, receiver.wasm.getCursorRectInNote(target.section, target.para, target.control, 0, 2));
  entryChecks++;
}

function historyRect(actual,expected){
 if(!actual||!expected){assert.deepEqual(actual,expected);return 0;}
 const a={...actual},b={...expected};delete a.y;delete b.y;assert.deepEqual(a,b,'history keeps page/X/height');
 const delta=Math.abs(actual.y-expected.y);assert(delta<=.7,'known current-main saved line-box rounding bound');return delta;
}
const checks=[];const mode=process.argv[6]??'fixed';assert(['observe','fixed'].includes(mode));
for(const f of fixtures.filter(f=>/^[\x00-\x7f]*$/.test(f.expectedText))){
 for(const edge of f.expectedText?[-1,1]:[-1]){
  const d=new M.HwpDocument(fs.readFileSync(f.path)),receiver=ui(d),offset=edge<0?0:[...f.expectedText].length;
  try{enter(receiver,{section:f.section,para:f.para,control:f.control});receiver.cursor.setFnCursorPosition(f.notePara,0);receiver.cursor.moveToParagraphEdgeInFn(edge);
   assert.equal(receiver.cursor.fnCharOffset,offset);const n=native.rows.find(r=>r.case===f.case&&r.offset===offset);assert(n);
   const shown=receiver.cursor.rect?{...receiver.cursor.rect}:null;const aligned=shown?.pageIndex===n.referenceCaret.pageIndex&&Math.abs(shown.x-n.referenceCaret.x)<=.11;if(mode==='fixed')assert(aligned,'Home/End source caret aligns');
   receiver.textarea.value='◆😀';onInput.call(receiver);const expected=[...f.expectedText].slice(0,offset).join('')+'◆😀'+[...f.expectedText].slice(offset).join('');
   assert.equal(receiver.wasm.getFootnoteInfo(f.section,f.para,f.control).texts[f.notePara],expected);assert.equal(receiver.cursor.fnCharOffset,offset+2);
   const after={...receiver.cursor.rect};let pos=receiver.history.undo(receiver.wasm);assert(pos);receiver.restoreEditContextAfterHistory(receiver.history.peekRedoTop(),pos);
   assert.equal(receiver.wasm.getFootnoteInfo(f.section,f.para,f.control).texts[f.notePara],f.expectedText);assert.equal(receiver.cursor.fnCharOffset,offset);const undoYDelta=historyRect(receiver.cursor.rect,shown);
   pos=receiver.history.redo(receiver.wasm);assert(pos);receiver.restoreEditContextAfterHistory(receiver.history.peekUndoTop(),pos);
   assert.equal(receiver.wasm.getFootnoteInfo(f.section,f.para,f.control).texts[f.notePara],expected);assert.equal(receiver.cursor.fnCharOffset,offset+2);const redoYDelta=historyRect(receiver.cursor.rect,after);
   fs.writeFileSync(path.join(out,f.case+'-'+edge+'.hwpx'),d.exportHwpx(),{flag:'wx'});checks.push({case:f.case,edge,sourceOffset:offset,shown,after,sourceScalarAndRenderCaretAligned:aligned,historySourcePageXHeightRestored:true,undoYDeltaPx:undoYDelta,redoYDeltaPx:redoYDelta});
  }finally{receiver.history.clear(receiver.wasm);d.free()}
 }
}
const proof={mode,geometryFailures:checks.filter(c=>!c.sourceScalarAndRenderCaretAligned).length,GUIVerified:false,scope:'Unmodified production entry, Cursor Home/End/updateRect, plain onInput, note command and CommandHistory with explicit DOM and record-dispatch adapters. No pending formatting, physical IME, mouse/object affinity or non-BMP arrow/Home-End claim.',WASMSHA256:sha(fs.readFileSync(path.join(pkg,'rhwp_bg.wasm'))),cases:checks.length,inputActions:checks.length,undoRedoActions:checks.length*2,checks};
fs.writeFileSync(path.join(out,'proof.json'),JSON.stringify(proof,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({...proof,checks:undefined}));

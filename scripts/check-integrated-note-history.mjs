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
  ['enterFootnoteMode', 'exitFootnoteMode', 'setFnCursorPosition', 'updateRect', 'invalidateFocusedCellCursorGeometry', 'applyPreparedFocusedCellCursorGeometry', 'isInCell'].map(n => method(cursorSource, n)).join('') +
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
for (const fixture of fixtures) {
  const input = fs.readFileSync(fixture.path);
  assert.equal(sha(input), fixture.sha256);
  const doc = new M.HwpDocument(input), receiver = ui(doc), initialBody = model(doc);
  const noteTargets = [...new Map(fixture.actions.map(a => [a.section + ':' + a.para + ':' + a.control, a])).values()];
  const originals = noteTargets.map(a => ({ ...a, texts: receiver.wasm.getFootnoteInfo(a.section, a.para, a.control).texts }));
  function checkpoint(stage) {
    assert.deepEqual(model(doc), initialBody, 'source body unchanged');
    for (const note of originals) {
      const expected = note.texts.map((text, p) => (['grown', 'redo'].includes(stage)
        ? fixture.actions.filter(a => a.section === note.section && a.para === note.para && a.control === note.control && a.notePara === p).map(a => a.text).join('') : '') + text);
      assert.deepEqual(receiver.wasm.getFootnoteInfo(note.section, note.para, note.control).texts, expected);
    }
    const bytes = doc.exportHwpx();
    fs.writeFileSync(path.join(out, fixture.case + '-' + stage + '.hwpx'), bytes, { flag: 'wx' });
    const cold = new M.HwpDocument(bytes);
    const expected = native.rows.find(r => r.case === fixture.case && r.stage === stage).result.live;
    const results = [];
    try {
      for (const [variant, document] of [['live', doc], ['cold', cold]]) {
        const instance = variant === 'live' ? receiver : ui(document);
        assert.equal(document.pageCount(), expected.pages);
        for (const target of fixture.targets) enter(instance, target);
        for (const query of expected.queries) {
          const rect = JSON.parse(document.getCursorRectInNote(...query.source, query.offset));
          const hit = JSON.parse(document.hitTest(rect.pageIndex, rect.x, rect.y + rect.height * 0.5));
          assert.deepEqual(rect, query.rect);
          assert.deepEqual(hit, query.hit);
          assert.equal(rect.pageIndex, query.expected.page);
          enter(instance, { section: query.source[0], para: query.source[1], control: query.source[2] });
          instance.cursor.setFnCursorPosition(query.source[3], query.offset);
          assert.deepEqual(instance.cursor.rect, rect, 'production Cursor follows source fragment');
          results.push({ variant, source: query.source, offset: query.offset, rect, hit });
          cursorChecks++;
        }
      }
    } finally { cold.free(); }
    rows.push({ case: fixture.case, stage, pages: doc.pageCount(), diskSHA256: sha(bytes), results });
  }
  try {
    checkpoint('before');
    for (const action of fixture.actions) {
      enter(receiver, action);
      receiver.cursor.setFnCursorPosition(action.notePara, 0);
      receiver.textarea.value = action.text;
      onInput.call(receiver);
      assert.equal(receiver.cursor.fnCharOffset, [...action.text].length);
    }
    checkpoint('grown');
    assert(doc.pageCount() > 1, 'long note spans pages');
    for (let i = 0; i < fixture.actions.length; i++) {
      const position = receiver.history.undo(receiver.wasm); assert(position);
      receiver.restoreEditContextAfterHistory(receiver.history.peekRedoTop(), position); historyOperations++;
    }
    checkpoint('undo');
    for (let i = 0; i < fixture.actions.length; i++) {
      const position = receiver.history.redo(receiver.wasm); assert(position);
      receiver.restoreEditContextAfterHistory(receiver.history.peekUndoTop(), position); historyOperations++;
    }
    checkpoint('redo');
  } finally { receiver.history.clear(receiver.wasm); doc.free(); }
}
const proof = { GUIVerified: false, scope: 'Combined WASM, production entry/onInput/note command/CommandHistory/context restore/Cursor methods with DOM and record-dispatch adapters; actual Electron integration QA pending.',
  WASMSHA256: sha(fs.readFileSync(path.join(pkg, 'rhwp_bg.wasm'))), cases: fixtures.length, stages: rows.length, entryChecks, cursorChecks, recordedInputs, historyOperations, failures: 0, rows };
fs.writeFileSync(path.join(out, 'proof.json'), JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ ...proof, rows: undefined }));

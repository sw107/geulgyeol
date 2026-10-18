// Actual BookmarkDialog handlers and WASM history; DOM event propagation is an
// explicit adapter. This suite does not claim browser default actions or real IME.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {stripTypeScriptTypes} from 'node:module';
import {pathToFileURL} from 'node:url';
import {test} from 'node:test';

const repo = path.resolve(import.meta.dirname, '../..');
const read = name => fs.readFileSync(repo + '/rhwp-studio/src/' + name, 'utf8');
const strip = source => stripTypeScriptTypes(source, {mode: 'transform'})
  .replace(/^import[\s\S]*?;\s*$/gm, '');
const load = source => import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const source = fs.readFileSync(process.env.GEULGYEOL_BOOKMARK_DIALOG_SOURCE
  ?? repo + '/rhwp-studio/src/ui/bookmark-dialog.ts', 'utf8');
const {BookmarkDialog} = await load('const enableDialogDrag=()=>{};\n' + strip(source));
const commands = await load('const MAX_PAGE_LOCAL_TEXT_EDIT_CHARS=10000;\n' + strip(read('engine/command.ts')));
globalThis.__bookmarkKeyboardCommands = commands;
const {CommandHistory} = await load('const {NO_TEXT_MUTATION_EFFECTS}=globalThis.__bookmarkKeyboardCommands;\n'
  + strip(read('engine/history.ts')));
const pkg = process.env.GEULGYEOL_BOOKMARK_WASM_PKG ?? repo + '/pkg';
const M = await import(pathToFileURL(fs.realpathSync(pkg + '/rhwp.js')));
M.initSync({module: fs.readFileSync(pkg + '/rhwp_bg.wasm')});

class Element {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.listeners = [];
    this.style = {};
    this.value = '';
    this.classList = {add() {}, toggle() {}};
  }
  appendChild(child) { child.parent = this; this.children.push(child); return child; }
  replaceChildren() { for (const c of this.children) c.parent = null; this.children = []; }
  addEventListener(type, handler, capture = false) { this.listeners.push({type, handler, capture}); }
  removeEventListener(type, handler, capture = false) {
    this.listeners = this.listeners.filter(l => l.type !== type || l.handler !== handler || l.capture !== capture);
  }
  remove() { this.parent.children = this.parent.children.filter(c => c !== this); this.parent = null; }
  focus() { document.activeElement = this; }
  select() {}
}

// Capture listeners run before target listeners. The path stays fixed when a
// handler removes its overlay, as it does in the browser's event dispatch.
function keydown(target, key, options = {}) {
  const event = {key, target, isComposing: false, keyCode: 0, altKey: false,
    ctrlKey: false, metaKey: false, shiftKey: false, defaultPrevented: false,
    cancelBubble: false, ...options,
    stopPropagation() { this.cancelBubble = true; },
    preventDefault() { this.defaultPrevented = true; }};
  const path = [];
  for (let node = target; node; node = node.parent) path.push(node);
  const call = (node, capture) => {
    for (const l of [...node.listeners]) if (l.type === 'keydown' && l.capture === capture) l.handler(event);
  };
  for (const node of [...path].reverse()) { call(node, true); if (event.cancelBubble) return event; }
  for (const node of path) { call(node, false); if (event.cancelBubble) break; }
  return event;
}

function fixture() {
  const oldDocument = globalThis.document;
  const doc = new Element('#document');
  doc.body = doc.appendChild(new Element('body'));
  doc.createElement = tag => new Element(tag);
  doc.createTextNode = text => Object.assign(new Element('#text'), {textContent: text});
  globalThis.document = doc;
  const outside = doc.body.appendChild(new Element('textarea'));
  const d = M.HwpDocument.createEmpty();
  d.createBlankDocument(); d.insertText(0, 0, 0, '본문🙂 보존');
  d.exportHwp();
  const history = new CommandHistory(), snapshots = new Set();
  let focused = 0, editorKeys = 0;
  doc.addEventListener('keydown', () => editorKeys++);
  const position = {sectionIndex: 0, paragraphIndex: 0, charOffset: 3};
  const wasm = {documentGeneration: 1,
    getBookmarks: () => JSON.parse(d.getBookmarks()),
    addBookmark: (...args) => JSON.parse(d.addBookmark(...args)),
    saveSnapshot() { const id = d.saveSnapshot(); snapshots.add(id); return id; },
    restoreSnapshot: id => d.restoreSnapshot(id),
    discardSnapshot(id) { d.discardSnapshot(id); snapshots.delete(id); }};
  const ih = {getBodyBookmarkTarget: () => position, focus() { focused++; outside.focus(); },
    executeOperation(desc) {
      history.execute(new commands.SnapshotCommand(desc.operationType, position, position, desc.operation), wasm);
    }};
  const context = {hasDocument: true, isEditable: true, isFormMode: false};
  const dialog = new BookmarkDialog({wasm, getInputHandler: () => ih, getContext: () => context});
  const state = () => ({hwp: Buffer.from(d.exportHwp()), hwpx: Buffer.from(d.exportHwpx()),
    text: d.getTextFileText(), bookmarks: wasm.getBookmarks()});
  dialog.show();
  return {dialog, doc, outside, wasm, history, context, state,
    focused: () => focused, editorKeys: () => editorKeys,
    enter: options => keydown(dialog.nameInput, 'Enter', options),
    close() { if (dialog.isOpen()) dialog.hide(); history.clear(wasm);
      assert.equal(snapshots.size, 0); d.free(); globalThis.document = oldDocument; }};
}

test('Enter in the bookmark name adds once, closes, and preserves text through undo/redo', () => {
  const f = fixture();
  try {
    const before = f.state();
    f.dialog.nameInput.value = '키보드 책갈피';
    const event = f.enter();
    assert.equal(f.dialog.isOpen(), false, 'capture must allow the intended add action');
    assert.equal(event.defaultPrevented, true);
    assert.equal(f.editorKeys(), 0, 'closing Enter must not reach the editor');
    assert.equal(f.focused(), 1);
    assert.equal(f.history.undoStack.length, 1);
    const after = f.state();
    assert.equal(after.text, before.text);
    assert.deepEqual(after.bookmarks.map(b => [b.name, b.charPos]), [['키보드 책갈피', 3]]);
    f.history.undo(f.wasm); assert.deepEqual(f.state(), before);
    f.history.redo(f.wasm); assert.deepEqual(f.state(), after);
  } finally { f.close(); }
});

for (const [label, options] of [
  ['composing', {isComposing: true}], ['legacy IME commit', {keyCode: 229}],
  ['Ctrl', {ctrlKey: true}], ['Meta', {metaKey: true}], ['Alt', {altKey: true}],
  ['Shift', {shiftKey: true}],
]) test(`${label} Enter neither submits nor reaches the editor; later plain Enter adds once`, () => {
  const f = fixture();
  try {
    const before = f.state();
    const event = f.enter(options);
    assert.equal(f.dialog.isOpen(), true);
    assert.equal(event.defaultPrevented, false, 'IME/default behavior stays available');
    assert.deepEqual(f.state(), before);
    assert.equal(f.history.canUndo(), false);
    assert.equal(f.editorKeys(), 0);
    f.enter(); assert.equal(f.dialog.isOpen(), false);
    assert.equal(f.history.undoStack.length, 1);
  } finally { f.close(); }
});

for (const value of ['', '   ', '이'.repeat(251)]) test(`invalid name (${value.length} chars) retains dialog and redo history`, () => {
  const f = fixture();
  try {
    f.enter(); f.history.undo(f.wasm); f.dialog.show();
    const before = f.state(), redo = f.history.peekRedoTop();
    f.dialog.nameInput.value = value;
    const event = f.enter();
    assert.equal(f.dialog.isOpen(), true);
    assert.equal(event.defaultPrevented, true);
    assert.match(f.dialog.statusLabel.textContent, /이름|넘을/);
    assert.deepEqual(f.state(), before);
    assert.equal(f.history.canUndo(), false);
    assert.equal(f.history.peekRedoTop(), redo);
  } finally { f.close(); }
});

test('Enter cannot submit after the document generation changes', () => {
  const f = fixture();
  try {
    const before = f.state(); f.wasm.documentGeneration++;
    f.enter();
    assert.equal(f.dialog.isOpen(), true);
    assert.match(f.dialog.statusLabel.textContent, /문서/);
    assert.deepEqual(f.state(), before);
    assert.equal(f.history.canUndo(), false);
  } finally { f.close(); }
});

test('other targets and editor shortcuts stay isolated; Escape removes capture on every reopen', () => {
  const f = fixture();
  try {
    for (let cycle = 0; cycle < 3; cycle++) {
      if (cycle) f.dialog.show();
      const before = f.state();
      keydown(f.outside, 'Enter');
      keydown(f.dialog.dialog, 'Enter');
      keydown(f.dialog.nameInput, 'b', {ctrlKey: true});
      assert.equal(f.dialog.isOpen(), true);
      assert.equal(f.editorKeys(), cycle);
      assert.deepEqual(f.state(), before);
      const escape = keydown(f.dialog.nameInput, 'Escape');
      assert.equal(escape.defaultPrevented, true);
      assert.equal(f.dialog.isOpen(), false);
      assert.equal(f.doc.listeners.filter(l => l.capture).length, 0);
      keydown(f.outside, 'ArrowRight');
      assert.equal(f.editorKeys(), cycle + 1);
    }
    assert.equal(f.focused(), 3);
    assert.equal(f.history.canUndo(), false);
  } finally { f.close(); }
});

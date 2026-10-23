// Tests real dialog/command handlers with a small DOM adapter; no app, build or WASM copy.
// Browser default scrolling, screen-reader announcements and native IME remain QA work.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {test} from 'node:test';

const src = new URL('../src/', import.meta.url);
const read = name => fs.readFileSync(new URL(name, src), 'utf8');
const load = source => import('data:text/javascript;base64,' + Buffer.from(
  stripTypeScriptTypes(source, {mode: 'transform'}).replace(/^import[\s\S]*?;\s*$/gm, ''),
).toString('base64'));
const api = await load(read('ui/document-diagnostics-dialog.ts'));
const {DocumentDiagnosticsDialog, showDocumentDiagnostics, closeDocumentDiagnostics} = api;

class Element {
  constructor(tagName) {
    this.tagName = tagName; this.children = []; this.listeners = []; this.style = {};
    this.attributes = {}; this._text = ''; this.disabled = false;
  }
  get textContent() { return this._text + this.children.map(c => c.textContent).join(''); }
  set textContent(value) { this._text = value; this.replaceChildren(); }
  get isConnected() { return this === document || Boolean(this.parent?.isConnected); }
  appendChild(child) { this.children.push(child); child.parent = this; return child; }
  append(...children) { children.forEach(c => this.appendChild(c)); }
  replaceChildren() { this.children.forEach(c => { c.parent = null; }); this.children = []; }
  setAttribute(name, value) { this.attributes[name] = value; }
  closest(selector) { return this.attributes.inert !== undefined ? this : this.parent?.closest(selector); }
  contains(target) { return this === target || this.children.some(c => c.contains(target)); }
  addEventListener(type, handler, capture = false) { this.listeners.push({type, handler, capture}); }
  removeEventListener(type, handler, capture = false) {
    this.listeners = this.listeners.filter(l => l.type !== type || l.handler !== handler || l.capture !== capture);
  }
  remove() { this.parent?.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; }
  focus() {
    document.activeElement = this;
    for (const l of [...document.listeners]) if (l.type === 'focusin') l.handler({target: this});
  }
  click() { if (!this.disabled) for (const l of this.listeners) if (l.type === 'click') l.handler({target: this}); }
  querySelectorAll(selector) {
    return this.children.flatMap(c => [
      ...(c.tabIndex === 0 || (c.tagName === 'button' && !c.disabled) ? [c] : []),
      ...c.querySelectorAll(selector),
    ]);
  }
}
class Button extends Element { constructor() { super('button'); } }
globalThis.HTMLElement = Element;
globalThis.HTMLButtonElement = Button;

function key(key, options = {}) {
  const event = {key, target: document.activeElement, defaultPrevented: false, cancelBubble: false,
    preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.cancelBubble = true; }, ...options};
  for (const l of [...document.listeners]) if (l.type === 'keydown' && l.capture) l.handler(event);
  if (!event.cancelBubble) for (const l of [...document.listeners]) if (l.type === 'keydown' && !l.capture) l.handler(event);
  return event;
}
const warning = (kind = 'LinesegArrayEmpty', cell = null) => ({kind, section: 0, paragraph: 2, cell});
const report = warnings => ({count: warnings.length, summary: {'줄 배치 경고': warnings.length}, warnings});
function fixture(initial = report([warning()])) {
  const doc = new Element('#document'); doc.body = doc.appendChild(new Element('body'));
  doc.createElement = tag => tag === 'button' ? new Button() : new Element(tag);
  globalThis.document = doc;
  const outside = doc.body.appendChild(new Element('textarea')); outside.focus();
  const state = {report: initial, reads: 0, loaded: true, format: 'hwpx', editorKeys: 0};
  doc.addEventListener('keydown', () => state.editorKeys++);
  const wasm = new Proxy({documentGeneration: 1, fileName: '<img src=x onerror=alert(1)>.hwpx',
    hasLoadedDocument: () => state.loaded, getSourceFormat: () => state.format,
    getValidationWarnings() { state.reads++; if (state.error) throw new Error('read failed'); return state.report; },
  }, {get(target, prop) { if (!(prop in target)) throw new Error(`Unexpected engine API: ${String(prop)}`); return target[prop]; }});
  const services = {wasm, getInputHandler: () => ({focus: () => outside.focus()})};
  const dialog = new DocumentDiagnosticsDialog(services);
  const nodes = (tag, el = doc) => el.children.flatMap(c => [...(c.tagName === tag ? [c] : []), ...nodes(tag, c)]);
  return {doc, outside, state, wasm, services, dialog, nodes,
    text: () => doc.textContent,
    buttons: () => nodes('button'),
    close: () => closeDocumentDiagnostics()};
}

test('reports all three kinds, counts and 1-based body/cell locations as plain text', () => {
  const f = fixture(report([warning(), warning('LinesegUncomputed'), warning('LinesegTextRunReflow', {ctrl: 2, row: 3, col: 4, innerPara: 5})]));
  try {
    const before = JSON.stringify(f.state.report);
    f.dialog.show();
    assert.match(f.text(), /기록된 경고 3건/);
    for (const label of ['줄 배치 정보가 비어 있음', '줄 높이가 계산되지 않음', '긴 문단의 줄 배치 정보가 하나뿐임']) assert.ok(f.text().includes(label));
    assert.match(f.text(), /구역 1, 문단 3, 표 컨트롤 3, 행 4, 열 5, 셀 문단 6/);
    assert.match(f.text(), /편집 후에는 달라질/);
    assert.match(f.text(), /호환성을 보증하지/);
    assert.equal(f.nodes('img').length, 0);
    assert.match(f.text(), /<img src=x/);
    assert.equal(JSON.stringify(f.state.report), before);
    assert.equal(f.dialog.dialog.attributes.role, 'dialog');
    assert.equal(f.dialog.dialog.attributes['aria-modal'], 'true');
  } finally { f.close(); }
});

test('zero warnings, unsupported formats, no document and read failure have distinct states', () => {
  const f = fixture(report([]));
  try {
    f.dialog.show(); assert.match(f.text(), /기록된 HWPX 줄 배치 경고가 없습니다/); f.dialog.hide();
    for (const format of ['hwp', 'hml']) {
      f.state.format = format; f.dialog.show();
      assert.match(f.text(), /이 형식에는/); f.dialog.hide();
    }
    assert.equal(f.state.reads, 1);
    f.state.loaded = false; f.dialog.show(); assert.match(f.text(), /열린 문서가 없습니다/); f.dialog.hide();
    f.state.loaded = true; f.state.format = 'hwpx'; f.state.error = true; f.dialog.show();
    assert.match(f.text(), /가져오지 못했습니다/);
    assert.doesNotMatch(f.text(), /경고가 없습니다/);
  } finally { f.close(); }
});

test('pagination exposes every warning including the last, and returns focus to the scroll region', () => {
  const f = fixture(report(Array.from({length: 101}, (_, i) => ({...warning(), paragraph: i}))));
  try {
    f.dialog.show();
    assert.equal(f.nodes('li').length, 51); // summary + 50 detail rows
    const previous = f.buttons()[0], next = f.buttons()[1];
    assert.equal(previous.disabled, true);
    next.focus(); key('Enter'); assert.match(f.text(), /51–100 \/ 101건/);
    assert.equal(document.activeElement, f.dialog.content);
    next.click(); assert.match(f.text(), /구역 1, 문단 101/); assert.equal(next.disabled, true);
    previous.click(); assert.match(f.text(), /51–100/);
  } finally { f.close(); }
});

test('repeat open is a singleton; Tab/Shift+Tab are trapped, Escape cleans up and restores focus', () => {
  const f = fixture();
  try {
    for (let cycle = 0; cycle < 4; cycle++) {
      showDocumentDiagnostics(f.services); showDocumentDiagnostics(f.services);
      assert.equal(f.nodes('button').filter(b => b.textContent === '닫기').length, 1);
      const close = f.buttons().at(-1);
      assert.equal(document.activeElement, close);
      assert.equal(key('Tab').defaultPrevented, true);
      assert.equal(document.activeElement.attributes['aria-label'], '문서 점검 결과');
      key('Tab', {shiftKey: true}); assert.equal(document.activeElement, close);
      f.outside.focus(); assert.equal(document.activeElement, close);
      key('Enter', {ctrlKey: true}); assert.equal(f.buttons().at(-1), close);
      key('s', {ctrlKey: true}); assert.equal(f.state.editorKeys, cycle);
      key('Escape', {isComposing: true}); assert.equal(f.buttons().at(-1), close);
      key('Escape');
      assert.equal(document.activeElement, f.outside);
      assert.equal(f.doc.listeners.filter(l => l.capture || l.type === 'focusin').length, 0);
      key('ArrowRight'); assert.equal(f.state.editorKeys, cycle + 1);
    }
    assert.equal(f.state.reads, 4);
  } finally { f.close(); }
});

test('close click/Enter/Space work and detached previous focus falls back to editor', () => {
  const f = fixture();
  try {
    for (const action of [() => f.buttons().at(-1).click(), () => key('Enter'), () => key(' ')]) {
      f.dialog.show(); action(); assert.equal(f.buttons().length, 0); assert.equal(document.activeElement, f.outside);
    }
    const temporary = f.doc.body.appendChild(new Button()); temporary.focus();
    f.dialog.show(); temporary.remove(); key('Escape'); assert.equal(document.activeElement, f.outside);
    f.doc.body.focus(); f.dialog.show(); key('Escape'); assert.equal(document.activeElement, f.outside);
  } finally { f.close(); }
});

test('load lifecycle closes without refocusing the old editor; reopening reads only the replacement', () => {
  const f = fixture();
  try {
    f.dialog.show(); closeDocumentDiagnostics();
    assert.equal(f.buttons().length, 0);
    assert.notEqual(document.activeElement, f.outside);
    assert.equal(f.doc.listeners.filter(l => l.capture || l.type === 'focusin').length, 0);
    f.wasm.documentGeneration++; f.state.report = report([]);
    f.dialog.show(); assert.match(f.text(), /기록된 HWPX 줄 배치 경고가 없습니다/);
    assert.doesNotMatch(f.text(), /구역 1, 문단 3/);
    f.wasm.documentGeneration++; key('Tab'); assert.equal(f.buttons().length, 0);
    f.state.report = report([warning('LinesegUncomputed')]); f.dialog.show();
    f.wasm.documentGeneration++; f.state.report = report([]); f.dialog.show();
    assert.doesNotMatch(f.text(), /줄 높이가 계산되지 않음/);
  } finally { f.close(); }
});

test('tool command is read-only, available in read-only/form contexts, and menu/load hooks are connected', async () => {
  globalThis.__diagnosticsTestShow = showDocumentDiagnostics;
  const {toolCommands} = await load('const showDocumentDiagnostics = globalThis.__diagnosticsTestShow;\n' + read('command/commands/tool.ts'));
  const cmd = toolCommands.find(c => c.id === 'tool:document-diagnostics');
  assert.equal(cmd.opensDialog, true);
  assert.equal(cmd.canExecute({hasDocument: false}), false);
  assert.equal(cmd.canExecute({hasDocument: true, isEditable: false, isFormMode: true}), true);
  const f = fixture();
  try { cmd.execute(f.services); assert.match(f.text(), /문서 점검/); } finally { f.close(); }
  const main = read('main.ts');
  assert.match(main, /async function loadBytes\([\s\S]*?\): Promise<void> \{\s*closeDocumentDiagnostics\(\);/);
  assert.match(main, /async function createNewDocument\([^\n]+\{\s*closeDocumentDiagnostics\(\);/);
  assert.match(fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8'), /data-cmd="tool:document-diagnostics"/);
});

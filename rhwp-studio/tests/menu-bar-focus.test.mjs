// Real MenuBar handlers with a small DOM/default-focus adapter. This is not a
// browser or native app run: actual Electron mouse/keyboard behavior needs QA.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {test} from 'node:test';

const source = fs.readFileSync(new URL('../src/ui/menu-bar.ts', import.meta.url), 'utf8');
const code = stripTypeScriptTypes(source, {mode: 'transform'}).replace(/^import[\s\S]*?;\s*$/gm, '');
// Shortcut-label rendering is independent of the focus and command-routing contract.
const {MenuBar} = await import('data:text/javascript;base64,' + Buffer.from(
  'const syncMenuShortcutLabels=()=>{};\n' + code,
).toString('base64'));

class Element {
  constructor(tag, classes = '', dataset = {}) {
    this.tagName = tag; this.children = []; this.listeners = []; this.dataset = dataset;
    const values = new Set(classes.split(' ').filter(Boolean));
    this.classList = {
      contains: c => values.has(c), add: c => values.add(c), remove: c => values.delete(c),
      toggle(c, force = !values.has(c)) { if (force) values.add(c); else values.delete(c); },
    };
  }
  append(child) { this.children.push(child); child.parent = this; return child; }
  addEventListener(type, handler) { this.listeners.push({type, handler}); }
  removeAttribute() {}
  contains(node) { return this === node || this.children.some(c => c.contains(node)); }
  matches(selector) {
    return selector.split(',').some(s => {
      s = s.trim();
      const cls = /^\.([\w-]+)/.exec(s)?.[1];
      return !!cls && this.classList.contains(cls)
        && (!s.includes('[data-cmd]') || this.dataset.cmd !== undefined)
        && (!s.includes(':not(.disabled)') || !this.classList.contains('disabled'));
    });
  }
  closest(selector) { return this.matches(selector) ? this : this.parent?.closest(selector) ?? null; }
  querySelectorAll(selector) {
    return this.children.flatMap(c => [...(c.matches(selector) ? [c] : []), ...c.querySelectorAll(selector)]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  get isConnected() { return this === document || !!this.parent?.isConnected; }
  focus() {
    if (document.activeElement && document.activeElement !== this) emit(document.activeElement, 'blur');
    document.activeElement = this;
  }
}

function emit(target, type, properties = {}) {
  const event = {target, button: 0, detail: 1, defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; }, ...properties};
  for (let node = target; node; node = node.parent) {
    for (const listener of node.listeners) if (listener.type === type) listener.handler(event);
  }
  return event;
}
function mouseDown(target, button = 0) {
  const event = emit(target, 'mousedown', {button});
  // Explicitly model Chromium's primary-button default focus step between down/click.
  if (button === 0 && !event.defaultPrevented) {
    const focusable = target.tagName === 'input' || target.tagName === 'button';
    (focusable ? target : document.body).focus();
  }
  return event;
}
function click(target) { const down = mouseDown(target); emit(target, 'click'); return down; }
function fixture() {
  const doc = new Element('#document'); doc.body = doc.append(new Element('body'));
  globalThis.document = doc;
  globalThis.HTMLElement = Element;
  const editor = doc.body.append(new Element('textarea'));
  const outside = doc.body.append(new Element('input'));
  const container = doc.body.append(new Element('nav'));
  const menu = container.append(new Element('div', 'menu-item', {menu: 'edit'}));
  const title = menu.append(new Element('span', 'menu-title'));
  const undo = menu.append(new Element('div', 'md-item', {cmd: 'edit:undo'}));
  const label = undo.append(new Element('span', 'md-label'));
  const redo = menu.append(new Element('div', 'md-item', {cmd: 'edit:redo'}));
  const direct = container.append(new Element('button', 'menu-command', {cmd: 'view:toolbox-basic'}));
  const state = {calls: [], enabled: true, duringDispatch: [], execute: () => {}};
  const dispatcher = {
    isEnabled: () => state.enabled,
    dispatch(cmd, params) {
      state.calls.push({cmd, params}); state.duringDispatch.push(doc.activeElement);
      state.execute(cmd); return true;
    },
  };
  new MenuBar(container, {}, dispatcher, {get: () => undefined});
  editor.focus();
  return {doc, editor, outside, container, menu, title, undo, label, redo, direct, state};
}

test('mouse menu undo and redo preserve editor focus through dispatch and subsequent input', () => {
  const f = fixture(); let received = 0;
  f.editor.addEventListener('keydown', () => received++);
  for (const target of [f.label, f.redo]) {
    click(f.title); const down = click(target);
    assert.equal(down.defaultPrevented, false);
    assert.equal(f.doc.activeElement, f.editor);
    assert.equal(f.state.duringDispatch.at(-1), f.editor);
    assert.equal(f.menu.classList.contains('open'), false);
    emit(f.doc.activeElement, 'keydown', {key: 'a'});
  }
  assert.equal(received, 2);
  assert.deepEqual(f.state.calls.map(c => c.cmd), ['edit:undo', 'edit:redo']);
  assert.equal(f.state.calls[0].params.anchorEl, f.undo);
});

test('disabled menu item does not dispatch or drop editor focus', () => {
  const f = fixture(); f.state.enabled = false; click(f.title); click(f.label);
  assert.deepEqual(f.state.calls, []);
  assert.equal(f.doc.activeElement, f.editor);
});

test('direct menu command preserves pointer focus and dispatches only once on click', () => {
  const f = fixture(); mouseDown(f.direct);
  assert.equal(f.state.calls.length, 0);
  assert.equal(f.doc.activeElement, f.direct);
  emit(f.direct, 'click');
  assert.equal(f.doc.activeElement, f.editor);
  assert.deepEqual(f.state.calls.map(c => c.cmd), ['view:toolbox-basic']);
});

test('command-owned dialog focus is not stolen back after dispatch', () => {
  const f = fixture(); const dialogInput = f.doc.body.append(new Element('input'));
  f.state.execute = () => dialogInput.focus(); click(f.title); click(f.label);
  assert.equal(f.doc.activeElement, dialogInput);
  assert.equal(f.menu.classList.contains('open'), false);
});

test('outside input still takes focus while closing the menu', () => {
  const f = fixture(); click(f.title); const down = mouseDown(f.outside);
  assert.equal(down.defaultPrevented, false);
  assert.equal(f.doc.activeElement, f.outside);
  assert.equal(f.menu.classList.contains('open'), false);
  assert.deepEqual(f.state.calls, []);
});

test('unrelated controls inside the bar retain their default focus behavior', () => {
  const f = fixture(); const input = f.container.append(new Element('input'));
  assert.equal(mouseDown(input).defaultPrevented, false);
  assert.equal(f.doc.activeElement, input);
});

test('secondary button mousedown is not cancelled or dispatched', () => {
  const f = fixture(); assert.equal(mouseDown(f.label, 2).defaultPrevented, false);
  assert.deepEqual(f.state.calls, []);
});

test('keyboard activation without mousedown still dispatches exactly once', () => {
  const f = fixture(); f.direct.focus(); emit(f.direct, 'click', {detail: 0});
  assert.deepEqual(f.state.calls.map(c => c.cmd), ['view:toolbox-basic']);
  assert.equal(f.doc.activeElement, f.direct);
});

test('menu title toggle and Escape keep existing editor focus', () => {
  const f = fixture(); click(f.title); emit(f.editor, 'keydown', {key: 'Escape'});
  assert.equal(f.menu.classList.contains('open'), false);
  assert.equal(f.doc.activeElement, f.editor);
  click(f.title); click(f.title);
  assert.equal(f.menu.classList.contains('open'), false);
  assert.equal(f.doc.activeElement, f.editor);
});

test('menu commands preserve another focused input rather than forcing editor focus', () => {
  const f = fixture(); f.outside.focus(); click(f.title); click(f.label);
  assert.equal(f.doc.activeElement, f.outside);
});


test('normal blur can commit composition before focus restoration and command dispatch', () => {
  const f = fixture(); const order = [];
  f.editor.addEventListener('blur', () => order.push('blur/commit'));
  f.state.execute = () => { order.push('command'); assert.equal(f.doc.activeElement, f.editor); };
  click(f.title); click(f.label);
  assert.deepEqual(order, ['blur/commit', 'command']);
});

test('focus deliberately moved elsewhere between down and click is respected', () => {
  const f = fixture(); click(f.title); mouseDown(f.label); f.outside.focus(); emit(f.label, 'click');
  assert.equal(f.doc.activeElement, f.outside);
});

test('keyboard click does not reuse an unfinished pointer gesture', () => {
  const f = fixture(); click(f.title); mouseDown(f.label); f.direct.focus();
  emit(f.label, 'click', {detail: 0});
  assert.equal(f.doc.activeElement, f.direct);
});

test('detached previous input is not refocused', () => {
  const f = fixture(); click(f.title); mouseDown(f.label); f.editor.parent = null;
  emit(f.label, 'click'); assert.equal(f.doc.activeElement, f.doc.body);
});

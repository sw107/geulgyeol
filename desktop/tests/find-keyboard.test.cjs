const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');

// Exercise the production dialog build/show/hide and document capture listener.
// The small DOM stand-in records focus and event ownership; it does not emulate
// browser default actions or the editor's text input/IME implementation.
function setup() {
  const captures = new Set();
  const document = {
    activeElement: null,
    createElement: () => new Element(),
    addEventListener(type, listener, capture) {
      if (type === 'keydown' && capture) captures.add(listener);
    },
    removeEventListener(type, listener, capture) {
      if (type === 'keydown' && capture) captures.delete(listener);
    },
  };
  class Element {
    children = [];
    listeners = new Map();
    style = {};
    value = '';
    checked = false;
    appendChild(child) { this.children.push(child); child.parent = this; }
    contains(target) { return target === this || this.children.some(child => child.contains(target)); }
    addEventListener(type, listener) { this.listeners.set(type, listener); }
    focus() { document.activeElement = this; }
    select() {}
    remove() {
      if (this.contains(document.activeElement)) document.activeElement = document.body;
      this.parent.children = this.parent.children.filter(child => child !== this);
    }
  }
  document.body = new Element();
  const editor = new Element();
  const otherDialogInput = new Element();
  const calls = [];
  const ih = { focus() { calls.push('editor-focus'); editor.focus(); } };
  const exports = {};
  const source = fs.readFileSync(path.resolve(__dirname, '../../rhwp-studio/src/ui/find-dialog.ts'), 'utf8');
  const code = stripTypeScriptTypes(source, { mode: 'transform' }).replace(/\bexport\s+/g, '')
    + '\nObject.assign(exports, { FindDialog });';
  vm.runInNewContext(code, { exports, document });
  const dialog = new exports.FindDialog({
    getInputHandler: () => ih,
    eventBus: { on: () => () => {} },
  }, 'replace');
  dialog.doSearch = forward => calls.push(forward ? 'next' : 'previous');
  dialog.doReplace = () => calls.push('replace');
  dialog.show();
  function key(target, key, extras = {}) {
    target.focus();
    const event = {
      target, key, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false,
      isComposing: false, keyCode: 0, prevented: false, stopped: false,
      preventDefault() { this.prevented = true; },
      stopPropagation() { this.stopped = true; },
      ...extras,
    };
    for (const listener of captures) listener(event);
    return event;
  }
  return { dialog, document, captures, editor, otherDialogInput, calls, key };
}

for (const target of ['editor', 'otherDialogInput']) {
  for (const [key, shiftKey] of [['Enter', false], ['Enter', true], ['Escape', false]]) {
    test(`${target} retains ${shiftKey ? 'Shift+' : ''}${key} while find is open`, () => {
      const c = setup();
      const event = c.key(c[target], key, { shiftKey });
      assert.equal(event.prevented, false);
      assert.equal(event.stopped, false);
      assert.equal(c.dialog.isOpen(), true);
      assert.equal(c.document.activeElement, c[target]);
      assert.deepEqual(c.calls, []);
    });
  }
}

test('query Enter and Shift+Enter retain forward/backward search', () => {
  const c = setup();
  for (const shiftKey of [false, true]) {
    const event = c.key(c.dialog.queryInput, 'Enter', { shiftKey });
    assert.equal(event.prevented, true);
    assert.equal(event.stopped, true);
    assert.equal(c.document.activeElement, c.dialog.queryInput);
  }
  assert.deepEqual(c.calls, ['next', 'previous']);
});

test('replacement Enter replaces and Shift+Enter finds previous', () => {
  const c = setup();
  c.key(c.dialog.replaceInput, 'Enter');
  c.key(c.dialog.replaceInput, 'Enter', { shiftKey: true });
  assert.deepEqual(c.calls, ['replace', 'previous']);
});

test('Enter on dialog buttons and checkbox keeps their native default action', () => {
  const c = setup();
  const buttons = c.dialog.wrap.children.flatMap(row => row.children)
    .filter(child => child.className === 'dialog-btn' || child.className === 'dialog-close');
  assert.equal(buttons.length, 5);
  for (const target of [...buttons, c.dialog.caseSensitiveCheck]) {
    const event = c.key(target, 'Enter');
    assert.equal(event.prevented, false);
    assert.equal(event.stopped, true);
  }
  assert.deepEqual(c.calls, []);
});

test('Escape in find closes once and restores editor focus', () => {
  const c = setup();
  const event = c.key(c.dialog.queryInput, 'Escape');
  assert.equal(event.prevented, true);
  assert.equal(c.dialog.isOpen(), false);
  assert.equal(c.document.activeElement, c.editor);
  assert.equal(c.captures.size, 0);
  c.dialog.hide();
  assert.deepEqual(c.calls, ['editor-focus']);
});

test('close button restores focus only when it belongs to find', () => {
  const c = setup();
  const close = c.dialog.wrap.children[0].children[1];
  close.focus();
  close.listeners.get('click')();
  assert.equal(c.document.activeElement, c.editor);
  c.dialog.show();
  c.otherDialogInput.focus();
  c.dialog.hide();
  assert.equal(c.document.activeElement, c.otherDialogInput);
  assert.deepEqual(c.calls, ['editor-focus']);
});

test('hide/reopen installs exactly one active capture listener', () => {
  const c = setup();
  c.dialog.hide();
  assert.equal(c.captures.size, 0);
  c.dialog.show();
  c.dialog.show();
  assert.equal(c.captures.size, 1);
  c.calls.length = 0;
  c.key(c.dialog.queryInput, 'Enter');
  assert.deepEqual(c.calls, ['next']);
});

for (const composing of [{ isComposing: true }, { keyCode: 229 }]) {
  for (const key of ['Enter', 'Escape']) {
    test(`IME ${JSON.stringify(composing)} ${key} does not search or close`, () => {
      const c = setup();
      const event = c.key(c.dialog.queryInput, key, composing);
      assert.equal(event.prevented, false);
      assert.equal(c.dialog.isOpen(), true);
      assert.deepEqual(c.calls, []);
    });
  }
}

for (const modifier of ['ctrlKey', 'metaKey', 'altKey']) {
  test(`${modifier}+Enter does not trigger a find action`, () => {
    const c = setup();
    assert.equal(c.key(c.dialog.queryInput, 'Enter', { [modifier]: true }).prevented, false);
    assert.deepEqual(c.calls, []);
  });
}

const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {stripTypeScriptTypes} = require('node:module');

const root = path.resolve(__dirname, '../../rhwp-studio/src');
const fileURL = name => pathToFileURL(path.join(root, name)).href;
// Load the complete production class with its existing runtime import resolved.
const source = stripTypeScriptTypes(fs.readFileSync(path.join(root, 'ui/command-palette.ts'), 'utf8'), {mode: 'transform'})
  .replace("'@/engine/navigation-keymap'", JSON.stringify(fileURL('engine/navigation-keymap.ts')));
const modules = Promise.all([
  import('data:text/javascript;base64,' + Buffer.from(source).toString('base64')),
  import(fileURL('command/registry.ts')),
  import(fileURL('command/dispatcher.ts')),
]);

class Element {
  children = []; handlers = new Map(); dataset = {}; className = ''; value = '';
  classList = {
    toggle: (name, enabled) => {
      const names = new Set(this.className.split(' ').filter(Boolean));
      if (enabled) names.add(name); else names.delete(name);
      this.className = [...names].join(' ');
    },
  };
  appendChild(child) {this.children.push(child); child.parent = this;}
  replaceChildren() {this.children = [];}
  remove() {this.parent.children = this.parent.children.filter(child => child !== this);}
  addEventListener(type, fn) {this.handlers.set(type, fn);}
  querySelectorAll(selector) {
    const name = selector.slice(1), result = [];
    for (const child of this.children) {
      if (child.className.split(' ').includes(name)) result.push(child);
      result.push(...child.querySelectorAll(selector));
    }
    return result;
  }
  querySelector(selector) {return this.querySelectorAll(selector)[0] ?? null;}
  focus() {}
  scrollIntoView() {}
}

async function fixture(run) {
  const [{CommandPalette}, {CommandRegistry}, {CommandDispatcher}] = await modules;
  const previousDocument = globalThis.document;
  const previousPlatform = globalThis.__rhwpTestPlatformKind;
  const document = {body: new Element(), handlers: new Map(), createElement: () => new Element(),
    addEventListener(type, fn) {this.handlers.set(type, fn);},
    removeEventListener(type, fn) {if (this.handlers.get(type) === fn) this.handlers.delete(type);}};
  globalThis.document = document;
  globalThis.__rhwpTestPlatformKind = 'other';
  const registry = new CommandRegistry(), calls = [], checks = [], events = [];
  const context = {allowed: false};
  const services = {getContext: () => context};
  const definitions = [
    {id: 'tools:always', label: '항상 명령', shortcutLabel: 'Ctrl+K'},
    {id: 'tools:live', label: '동적 명령', canExecute: ctx => {checks.push(ctx); return ctx.allowed;}},
    {id: 'tools:stub', label: '미구현 명령', canExecute: () => false},
  ].map(def => ({...def, execute: actual => {assert.equal(actual, services); calls.push(def.id);}}));
  registry.registerAll(definitions);
  const dispatcher = new CommandDispatcher(registry, services, {emit: name => events.push(name)});
  const palette = new CommandPalette(registry, dispatcher);
  const rows = () => document.body.querySelectorAll('.cp-item');
  const labels = () => rows().map(row => row.children[0].textContent);
  const filter = value => {
    const input = document.body.querySelector('.cp-input');
    input.value = value; input.handlers.get('input')();
  };
  const key = value => {
    const event = {key: value, prevented: false, stopped: false,
      preventDefault() {this.prevented = true;}, stopPropagation() {this.stopped = true;}};
    document.handlers.get('keydown')(event); return event;
  };
  try {await run({palette, registry, calls, checks, events, context, document, rows, labels, filter, key});}
  finally {
    palette.close(); globalThis.document = previousDocument;
    if (previousPlatform === undefined) delete globalThis.__rhwpTestPlatformKind;
    else globalThis.__rhwpTestPlatformKind = previousPlatform;
  }
}

test('palette lists registered commands in order without evaluating availability and filters labels, IDs and shortcuts', () => fixture(f => {
  f.palette.open();
  assert.deepEqual(f.labels(), ['항상 명령', '동적 명령', '미구현 명령']);
  assert.deepEqual(f.checks, []);
  for (const [query, expected] of [['  동적  ', '동적 명령'], ['TOOLS:ALWAYS', '항상 명령'], ['ctrl+k', '항상 명령']]) {
    f.filter(query); assert.deepEqual(f.labels(), [expected]);
  }
  f.filter('일치 없음'); assert.deepEqual(f.rows(), []);
  assert.equal(f.document.body.querySelector('.cp-empty').textContent, '검색 결과 없음');
  f.filter(''); assert.equal(f.rows().length, 3);
  assert.deepEqual(f.checks, []);
}));

test('palette delegates execution to the live dispatcher even when availability changes after opening', () => fixture(f => {
  f.palette.open(); f.filter('동적'); f.key('Enter');
  assert.deepEqual(f.calls, []); assert.equal(f.checks[0], f.context);
  assert.equal(f.palette.isOpen(), false);
  f.palette.open(); f.filter('동적'); f.context.allowed = true; f.key('Enter');
  assert.deepEqual(f.calls, ['tools:live']);
  assert.deepEqual(f.events, ['command-state-changed']);
  f.palette.open(); f.filter('미구현'); f.key('Enter');
  assert.deepEqual(f.calls, ['tools:live']);
}));

test('keyboard wrap, pointer selection, filtering reset and Escape retain selection and close behavior', () => fixture(f => {
  f.palette.open();
  const selected = () => f.rows().findIndex(row => row.className.includes('cp-item--selected'));
  assert.equal(selected(), 0);
  const up = f.key('ArrowUp'); assert(up.prevented && up.stopped); assert.equal(selected(), 2);
  f.key('ArrowDown'); assert.equal(selected(), 0);
  f.rows()[1].handlers.get('mousemove')(); assert.equal(selected(), 1);
  f.filter('항상'); assert.equal(selected(), 0);
  let prevented = false;
  f.rows()[0].handlers.get('mousedown')({preventDefault() {prevented = true;}});
  assert(prevented); assert.deepEqual(f.calls, ['tools:always']); assert.equal(f.palette.isOpen(), false);
  f.palette.open(); f.filter('없음'); f.key('ArrowDown'); assert.deepEqual(f.rows(), []);
  const escape = f.key('Escape'); assert(escape.prevented && escape.stopped);
  assert.equal(f.palette.isOpen(), false); assert.equal(f.document.handlers.has('keydown'), false);
  assert.deepEqual(f.calls, ['tools:always']);
}));

test('reopening reflects registry changes without caching a stale command list', () => fixture(f => {
  f.palette.open(); f.palette.close(); f.registry.unregister('tools:always');
  f.registry.register({id: 'tools:new', label: '새 명령', execute() {}});
  f.palette.open(); assert.deepEqual(f.labels(), ['동적 명령', '미구현 명령', '새 명령']);
}));

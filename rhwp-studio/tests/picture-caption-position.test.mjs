// Small UI contract tests: real registry, dispatcher, InputHandler routing,
// property routing, SnapshotCommand and history; engine/DOM/repaint are adapters.
// Run: node --test rhwp-studio/tests/picture-caption-position.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {stripTypeScriptTypes} from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
function load(source, imports = {}) {
  const stripped = stripTypeScriptTypes(source, {mode: 'transform'});
  const names = [...stripped.matchAll(/\bexport (?:class|function|const|let) (\w+)/g)].map(m => m[1]);
  const code = stripped.replace(/^import[\s\S]*?;\s*$/gm, '').replace(/\bexport (?=class|function|const|let)/g, '');
  // Bind only explicitly imported runtime names, keeping the production code intact.
  const bindings = [];
  for (const match of stripped.matchAll(/^import\s+\{([\s\S]*?)\}\s+from\s+['"]([^'"]+)['"];?/gm)) {
    assert(match[2] in imports, `Unexpected runtime dependency: ${match[2]}`);
    bindings.push(`const {${match[1].replace(/\bas\b/g, ':')}} = imports[${JSON.stringify(match[2])}];`);
  }
  for (const match of stripped.matchAll(/^import\s+\*\s+as\s+(\w+)\s+from\s+['"]([^'"]+)['"];?/gm)) {
    assert(match[2] in imports); bindings.push(`const ${match[1]} = imports[${JSON.stringify(match[2])}];`);
  }
  return new Function('imports', bindings.join('\n') + '\n' + code + `\nreturn {${names.join(',')}};`)(imports);
}
function method(source, name) {
  const start = source.indexOf(`  ${name}(`) >= 0 ? source.indexOf(`  ${name}(`) : source.indexOf(`  private ${name}(`);
  const end = source.indexOf('\n  }\n', start);
  assert(start >= 0 && end > start, name);
  return source.slice(start, end + 4);
}
const objects = load(read('engine/object-props.ts'), {'./equation-target': {}});
const commands = load(read('engine/command.ts'), {
  './object-props': objects, './input-edit-invalidation': {MAX_PAGE_LOCAL_TEXT_EDIT_CHARS: 10000},
});
const {CommandHistory} = load(read('engine/history.ts'), {'./command': commands});
const toasts = [];
const caption = load(read('command/commands/picture-caption.ts'), {
  '@/engine/command': commands, '@/engine/object-props': objects,
  '@/ui/toast': {showToast: value => toasts.push(value)},
});
const input = read('engine/input-handler.ts');
const {Handler} = load(`import * as commands from './command';
const {SnapshotCommand,SubmodeSnapshotCommand,SubmodeSelectionSnapshotCommand,IMMEDIATE_TEXT_MUTATION_EFFECTS} = commands;
export class Handler {${['executeOperation', 'isOperationAllowedInEditMode'].map(name => method(input, name)).join('\n')}}`, {'./command': commands});
const {CommandRegistry} = load(read('command/registry.ts'));
const {CommandDispatcher} = load(read('command/dispatcher.ts'), {'../view/busy-cursor.ts': {busyDepth: () => 0}});
const insertSource = read('command/commands/insert.ts');
// Load the complete real insertion registry. Unused dialog dependencies are inert.
const insertImports = Object.fromEntries([...insertSource.matchAll(/^import[\s\S]*?from ['"]([^'"]+)['"];$/gm)].map(match => [match[1], {}]));
Object.assign(insertImports, {
  './picture-caption': caption, '@/engine/command': commands, '@/engine/object-props': objects,
  './hyperlink': {bodyHyperlinkCommand: {id: 'insert:hyperlink'}},
  './comment': {bodyCommentCommand: {id: 'insert:comment'}},
  './paragraph-band': {bodyParagraphBandCommand: {id: 'insert:para-band'}},
});
const {insertCommands} = load(insertSource, insertImports);

function fixture(hasCaption = true) {
  const ref = {sec: 0, ppi: 2, ci: 1, type: 'image'};
  const anchor = {sectionIndex: 0, paragraphIndex: 2, charOffset: 17};
  const initialCursor = {sectionIndex: 0, paragraphIndex: 0, charOffset: 1};
  const payload = {paragraphs: [{text: '그림 7 한글🙂', number: {kind: 'Picture', value: 7},
    paraShape: 9, runs: [{offset: 0, shape: 2}, {offset: 5, shape: 13}]}]};
  let state = {body: '본문 보존', image: [1, 2, 3], siblingCaption: '그림 8', source: {opaque: [9, 7]},
    props: {rotationAngle: 0, hasCaption, captionDirection: 'Bottom', captionVertAlign: 'Center',
      captionWidth: 9933, captionSpacing: 432, captionIncludeMargin: true},
    caption: hasCaption ? structuredClone(payload) : null};
  let pos = {...initialCursor}, selected = {...ref}, nextId = 0;
  const snapshots = new Map(), calls = [], events = [];
  const wasm = {
    assertDocumentWritable() {},
    getParagraphLength: () => 23,
    getPictureProperties(...args) {calls.push(['get', ...args]); return structuredClone(state.props);},
    setPictureProperties(sec, para, ci, patch) {
      calls.push(['set', sec, para, ci, structuredClone(patch)]);
      if (patch.hasCaption && !state.props.hasCaption) state.caption = structuredClone(payload);
      if (!patch.hasCaption) state.caption = null;
      Object.assign(state.props, patch);
      return {ok: true};
    },
    saveSnapshot() {snapshots.set(++nextId, structuredClone(state)); return nextId;},
    restoreSnapshot(id) {assert(snapshots.has(id)); state = structuredClone(snapshots.get(id));},
    discardSnapshot(id) {assert(snapshots.delete(id));},
  };
  const context = {hasDocument: true, isEditable: true, editMode: 'normal', isFormMode: false,
    inPictureObjectSelection: true, inTable: false, inNestedTable: false,
    inCellSelectionMode: false, inTableObjectSelection: false};
  const history = new CommandHistory(), ih = new Handler();
  const cursor = {
    getPosition: () => ({...pos}), getRect: () => null, resetPreferredX() {},
    moveTo(p) {pos = {...p}; selected = null;}, isInFootnote: () => false, isInHeaderFooter: () => false,
  };
  let multi = false, form = false, outside = anchor;
  Object.assign(ih, {
    wasm, cursor, history, editMode: 'normal', eventBus: {emit: (...args) => events.push(args)},
    isFormMode: () => form, isMultiPictureSelection: () => multi,
    getSelectedPictureRef: () => selected, getPositionOutsideSelectedPicture: () => outside,
    selectPictureObject(sec, ppi, ci, type) {selected = {sec, ppi, ci, type};},
    prepareTextMutationBeforeCursor: () => false,
    refreshAfterOperation: () => events.push(['refresh']),
  });
  const registry = new CommandRegistry(); registry.registerAll(insertCommands);
  const services = {wasm, getContext: () => ({...context, ...caption.pictureCaptionAvailability(ih, wasm)}),
    getInputHandler: () => ih, eventBus: ih.eventBus};
  const dispatcher = new CommandDispatcher(registry, services, ih.eventBus);
  const run = suffix => dispatcher.dispatchWithResult(`insert:caption-${suffix}`);
  const choose = () => {selected = {...ref};};
  return {wasm, ih, history, calls, events, context, dispatcher, run, choose, anchor,
    state: () => structuredClone(state), pos: () => structuredClone(pos), selected: () => structuredClone(selected),
    snapshots, guard(change) {change({ref, context, setMulti: b => multi = b, setForm: b => form = b,
      setOutside: p => outside = p}); choose();},
    mutate(fn) {fn(state);}, close() {history.clear(wasm); assert.equal(snapshots.size, 0);}};
}
function changed(f, suffix) {
  f.choose(); const before = f.state(), depth = f.history.undoStack.length;
  assert.deepEqual(f.run(suffix), {ok: true});
  assert.equal(f.history.undoStack.length, depth + 1);
  assert.equal(f.history.peekUndoTop().type, 'snapshot:setPictureCaptionPosition');
  assert.deepEqual(f.pos(), f.anchor);
  assert.equal(f.selected().type, 'image');
  const after = f.state();
  for (let i = 0; i < 3; i++) {
    assert.deepEqual(f.history.undo(f.wasm), f.anchor); assert.deepEqual(f.state(), before);
    assert.deepEqual(f.history.redo(f.wasm), f.anchor); assert.deepEqual(f.state(), after);
  }
  return {before, after};
}
function unchanged(f, action) {
  const before = {state: f.state(), cursor: f.pos(), selection: f.selected(),
    undo: f.history.peekUndoTop(), redo: f.history.peekRedoTop(), snapshots: f.snapshots.size,
    setters: f.calls.filter(c => c[0] === 'set').length, refreshes: f.events.filter(c => c[0] === 'refresh').length};
  action();
  assert.deepEqual(f.state(), before.state); assert.deepEqual(f.pos(), before.cursor);
  assert.deepEqual(f.selected(), before.selection); assert.equal(f.history.peekUndoTop(), before.undo);
  assert.equal(f.history.peekRedoTop(), before.redo); assert.equal(f.snapshots.size, before.snapshots);
  assert.equal(f.events.filter(c => c[0] === 'refresh').length, before.refreshes);
  return before;
}

test('registered position menus preserve existing caption text, number, formatting and sibling/source state', () => {
  const f = fixture();
  try {
    const {before, after} = changed(f, 'top');
    assert.deepEqual(after, {...before, props: {...before.props, captionDirection: 'Top'}});
    assert.deepEqual(f.calls.find(c => c[0] === 'set').at(-1), {hasCaption: true, captionDirection: 'Top'});
    changed(f, 'bottom');
    const removed = changed(f, 'none');
    assert.equal(removed.after.caption, null); assert.equal(removed.after.props.hasCaption, false);
    assert.equal(f.calls.filter(c => c[0] === 'set').length, 3, 'redo restores the original after snapshot');
  } finally {f.close();}
});

for (const suffix of ['top', 'bottom']) test(`new ${suffix} caption uses the existing insertion defaults in one history entry`, () => {
  const f = fixture(false);
  try {
    const {after} = changed(f, suffix);
    assert.deepEqual(after.props, {rotationAngle: 0, ...caption.DEFAULT_PICTURE_CAPTION_PROPS,
      captionDirection: suffix === 'top' ? 'Top' : 'Bottom'});
    assert.equal(after.caption.paragraphs[0].number.value, 7);
  } finally {f.close();}
});

for (const [hasCaption, suffix] of [[true, 'bottom'], [true, 'top'], [false, 'none']]) test(`${suffix} no-op preserves pending redo, cursor and selection`, () => {
  const f = fixture(hasCaption);
  try {
    if (suffix === 'top') f.mutate(s => {s.props.captionDirection = 'Top';});
    changed(f, hasCaption && suffix !== 'top' ? 'top' : 'bottom'); f.history.undo(f.wasm); f.choose();
    const setters = f.calls.filter(c => c[0] === 'set').length;
    unchanged(f, () => {assert.equal(f.run(suffix).ok, true);});
    assert.equal(f.calls.filter(c => c[0] === 'set').length, setters);
    assert(f.history.canRedo());
  } finally {f.close();}
});

test('excluded contexts, object types, nested refs, rotations and side captions never reach the setter', () => {
  const guards = [
    ...['hasDocument', 'isEditable', 'inPictureObjectSelection'].map(key => ({context}) => {context[key] = false;}),
    ...['isFormMode', 'inCellSelectionMode', 'inTableObjectSelection'].map(key => ({context}) => {context[key] = true;}),
    ({context}) => {context.editMode = 'form';}, ({setMulti}) => setMulti(true), ({setForm}) => setForm(true),
    ...['shape', 'equation', 'group', 'line', 'ole'].map(type => ({ref}) => {ref.type = type;}),
    ...['cellIdx', 'cellParaIdx', 'outerTableControlIdx'].map(key => ({ref}) => {ref[key] = 0;}),
    ({ref}) => {ref.cellPath = [{controlIndex: 0, cellIndex: 0, cellParaIndex: 0}];},
    ({ref}) => {ref.headerFooter = {kind: 'header', outerParaIdx: 0, outerControlIdx: 0};},
    ({ref}) => {ref.noteRef = {};},
  ];
  for (const guard of guards) {
    const f = fixture();
    try {
      f.guard(guard);
      for (const suffix of ['top', 'bottom', 'none']) assert.equal(f.dispatcher.isEnabled(`insert:caption-${suffix}`), false);
      unchanged(f, () => f.run('top')); assert(!f.calls.some(c => c[0] === 'set'));
    }
    finally {f.close();}
  }
  for (const patch of [{rotationAngle: 1}, {rotationAngle: NaN}, {captionDirection: 'Left'}, {captionDirection: 'Right'}]) {
    const f = fixture();
    try {
      f.mutate(s => Object.assign(s.props, patch));
      for (const suffix of ['top', 'bottom', 'none']) assert.equal(f.dispatcher.isEnabled(`insert:caption-${suffix}`), false);
      unchanged(f, () => {assert.equal(f.run('top').reason, 'disabled');}); assert(!f.calls.some(c => c[0] === 'set'));
    }
    finally {f.close();}
  }
});

test('availability follows current selection and properties without requiring a prior caption command', () => {
  const f = fixture();
  const enabled = expected => {
    for (const suffix of ['top', 'bottom', 'none']) assert.equal(f.dispatcher.isEnabled(`insert:caption-${suffix}`), expected);
  };
  try {
    enabled(true);
    f.guard(({setMulti}) => setMulti(true)); enabled(false);
    f.guard(({setMulti, ref}) => {setMulti(false); ref.type = 'group';}); enabled(false);
    f.guard(({ref}) => {ref.type = 'image';}); enabled(true);
    f.mutate(s => {s.props.rotationAngle = 90;}); enabled(false);
    f.mutate(s => {s.props.rotationAngle = 0;}); enabled(true);
    const getter = f.wasm.getPictureProperties;
    f.wasm.getPictureProperties = () => {throw new Error('document changed or closed');}; enabled(false);
    f.wasm.getPictureProperties = getter; enabled(true);
    f.ih.getSelectedPictureRef = () => null; enabled(false);
    assert.equal(f.history.canUndo(), false); assert.equal(f.snapshots.size, 0);
    assert(!f.calls.some(c => c[0] === 'set')); assert.equal(f.events.length, 0);
  } finally {f.close();}
});

test('missing live caption availability fails closed instead of enabling from generic object selection', () => {
  const f = fixture();
  try {
    for (const suffix of ['top', 'bottom', 'none']) {
      const command = insertCommands.find(c => c.id === `insert:caption-${suffix}`);
      assert.equal(command.canExecute(f.context), false);
    }
    assert.deepEqual(caption.pictureCaptionAvailability(null, f.wasm), {canSetPictureCaptionPosition: false});
  } finally {f.close();}
});

test('production main getContext forwards live caption availability into the real registered canExecute', () => {
  const main = read('main.ts');
  const start = main.indexOf('function getContext(): EditorContext {');
  const end = main.indexOf('\n}\n', start);
  assert(start >= 0 && end > start);
  const f = fixture();
  try {
    const {getContext} = load(`const {inputHandler,wasm,editMode,canvasView,documentState,
      nestedTableRowAvailability,pictureCaptionAvailability} = imports.boot;\nexport ${main.slice(start, end + 2)}`, {
      boot: {
        inputHandler: {...f.ih, canEditCurrentFormField: () => false,
          hasSelection: () => false, hasCopiedFormat: () => false, isInTable: () => false,
          getCursorPosition: f.pos, getCellTableContext: () => null,
          isInCellSelectionMode: () => false, hasMultiCellSelection: () => false,
          isInTableObjectSelection: () => false, isInPictureObjectSelection: () => true,
          isInField: () => false, canUndo: () => false, canRedo: () => false},
        wasm: {...f.wasm, pageCount: 1, hasTableTransposeClipboard: () => false,
          getShowControlCodes: () => false, getShowParagraphMarks: () => false, getSourceFormat: () => 'hwpx'},
        editMode: 'normal', canvasView: null, documentState: {isDirty: () => false},
        nestedTableRowAvailability: () => ({}), pictureCaptionAvailability: caption.pictureCaptionAvailability,
      },
    });
    const enabled = expected => {
      const context = getContext();
      assert.equal(context.canSetPictureCaptionPosition, expected);
      for (const suffix of ['top', 'bottom', 'none']) {
        const command = insertCommands.find(c => c.id === `insert:caption-${suffix}`);
        assert.equal(command.canExecute(context), expected);
      }
    };
    enabled(true);
    f.guard(({ref}) => {ref.type = 'group';}); enabled(false);
    f.guard(({ref, setMulti}) => {ref.type = 'image'; setMulti(true);}); enabled(false);
    f.guard(({ref, setMulti}) => {setMulti(false); ref.cellIdx = 0;}); enabled(false);
    f.guard(({ref}) => {delete ref.cellIdx;}); enabled(true);
    f.mutate(s => {s.props.rotationAngle = 90;}); enabled(false);
    f.mutate(s => {s.props.rotationAngle = 0;}); enabled(true);
    assert(!f.calls.some(c => c[0] === 'set')); assert.equal(f.snapshots.size, 0);
  } finally {f.close();}
});

for (const suffix of ['top', 'bottom', 'none']) for (const fault of ['false', 'throw', 'wrong-position', 'getter']) {
  test(`${suffix}: ${fault} after mutation restores all document state and pending redo atomically`, t => {
    const errors = t.mock.method(console, 'error', () => {});
    const f = fixture(suffix !== 'bottom');
    try {
      changed(f, suffix === 'none' ? 'top' : suffix === 'top' ? 'top' : 'bottom');
      f.history.undo(f.wasm); f.choose();
      const setter = f.wasm.setPictureProperties, getter = f.wasm.getPictureProperties;
      f.wasm.setPictureProperties = (...args) => {
        const result = setter(...args);
        if (fault === 'false') return {ok: false};
        if (fault === 'throw') throw new Error('injected failure after mutation');
        if (fault === 'wrong-position') f.mutate(s => {s.props.hasCaption = suffix === 'none'; s.props.captionDirection = 'Right';});
        if (fault === 'getter') f.wasm.getPictureProperties = () => {throw new Error('injected verification failure');};
        return result;
      };
      unchanged(f, () => {assert.equal(f.run(suffix).reason, 'threw');});
      assert.equal(errors.mock.callCount(), 1, 'dispatcher reports the injected failure');
      f.wasm.getPictureProperties = getter;
      assert(f.history.canRedo());
    } finally {f.close();}
  });
}

test('a body picture remains editable when the old caret was in a table; one-paragraph documents use the host anchor', () => {
  const f = fixture();
  try {
    f.guard(({context, setOutside}) => {context.inTable = true; context.inNestedTable = true; setOutside(null);});
    assert.equal(f.run('top').ok, true);
    const anchor = {sectionIndex: 0, paragraphIndex: 2, charOffset: 23};
    assert.deepEqual(f.pos(), anchor);
    assert.deepEqual(f.history.undo(f.wasm), anchor);
    assert.equal(f.state().props.captionDirection, 'Bottom');
  } finally {f.close();}
});

test('InputHandler form-mode gate still rejects the operation when UI context is stale', () => {
  const f = fixture();
  try {f.ih.editMode = 'form'; unchanged(f, () => f.run('top')); assert(!f.calls.some(c => c[0] === 'set'));}
  finally {f.close();}
});

test('only three caption position HTML entries are enabled; six side commands remain stubs', () => {
  const html = fs.readFileSync(path.join(root, '../index.html'), 'utf8');
  const f = fixture();
  try {
    for (const suffix of ['top', 'bottom', 'none', 'lt', 'lm', 'lb', 'rt', 'rm', 'rb']) {
      const tag = html.match(new RegExp(`<div class="([^"]+)" data-cmd="insert:caption-${suffix}">`));
      assert(tag, suffix);
      const enabled = ['top', 'bottom', 'none'].includes(suffix);
      assert.equal(!tag[1].includes('disabled'), enabled, suffix);
      assert.equal(f.dispatcher.isEnabled(`insert:caption-${suffix}`), enabled, suffix);
    }
  } finally {f.close();}
});

test('the real menu state updater opens the caption submenu only with an editable selection', () => {
  const {MenuBar} = load(read('ui/menu-bar.ts'), {'./menu-shortcut-labels': {}});
  const f = fixture();
  const classList = () => {
    const values = new Set(['disabled']);
    return {contains: value => values.has(value), toggle(value, enabled) {if (enabled) values.add(value); else values.delete(value);}};
  };
  const items = ['top', 'bottom', 'none', 'lt', 'lm', 'lb', 'rt', 'rm', 'rb']
    .map(suffix => ({dataset: {cmd: `insert:caption-${suffix}`}, classList: classList()}));
  const sub = {classList: classList(), querySelectorAll: () => items};
  const menu = {querySelectorAll: selector => selector === '.md-sub' ? [sub] : items};
  const bar = Object.assign(Object.create(MenuBar.prototype), {dispatcher: f.dispatcher});
  try {
    bar.updateMenuStates(menu); assert.equal(sub.classList.contains('disabled'), false);
    assert.equal(items.filter(item => !item.classList.contains('disabled')).length, 3);
    for (const guard of [({ref}) => {ref.type = 'group';}, ({ref, setMulti}) => {ref.type = 'image'; setMulti(true);},
      ({ref, setMulti}) => {setMulti(false); ref.cellIdx = 0;}]) {
      f.guard(guard); bar.updateMenuStates(menu); assert.equal(sub.classList.contains('disabled'), true);
      assert(items.every(item => item.classList.contains('disabled')));
    }
    f.guard(({ref}) => {delete ref.cellIdx;});
    f.mutate(s => {s.props.rotationAngle = 45;});
    bar.updateMenuStates(menu); assert.equal(sub.classList.contains('disabled'), true);
    f.mutate(s => {s.props.rotationAngle = 0;});
    bar.updateMenuStates(menu); assert.equal(sub.classList.contains('disabled'), false);
    f.context.inPictureObjectSelection = false;
    bar.updateMenuStates(menu); assert.equal(sub.classList.contains('disabled'), true);
    f.context.inPictureObjectSelection = true; f.context.isEditable = false;
    bar.updateMenuStates(menu); assert.equal(sub.classList.contains('disabled'), true);
  } finally {f.close();}
});

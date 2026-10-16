// Actual WASM/Bridge/FindDialog/InputHandler/SnapshotCommand/CommandHistory.
// DOM, cursor geometry and repaint are adapters, not native Mac app QA.
// node scripts/check-replace-all-overlap.mjs PKG SCOPE_MANIFEST FIXTURES FRESH_OUT baseline|fixed
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { stripTypeScriptTypes } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
const [pkgArg, manifestArg, fixturesArg, outArg, mode] = process.argv.slice(2);
const root = path.resolve(import.meta.dirname, '..'), pkg = path.resolve(pkgArg), fixtures = path.resolve(fixturesArg), out = path.resolve(outArg);
assert(['baseline', 'fixed'].includes(mode)); assert(!fs.existsSync(out)); fs.mkdirSync(out, { recursive: true });
const sha = b => createHash('sha256').update(b).digest('hex');
const source = Object.fromEntries(Object.entries({ dialog: 'ui/find-dialog.ts', bridge: 'core/wasm-bridge.ts',
  command: 'engine/command.ts', history: 'engine/history.ts', input: 'engine/input-handler.ts',
  dirty: 'core/document-dirty-state.ts', bus: 'core/event-bus.ts' }).map(([k, p]) => [k, fs.readFileSync(root + '/rhwp-studio/src/' + p, 'utf8')]));
const load = text => import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(text, { mode: 'transform' })
  .replace(/^import[\s\S]*?;\s*$/gm, '')).toString('base64'));
function method(text, name) {
  let start = text.indexOf('  ' + name + '(');
  if (start < 0) start = text.indexOf('  private ' + name + '(');
  if (start < 0) start = text.indexOf('  ' + name + '<');
  const end = text.indexOf('\n  }', start); assert(start >= 0 && end > start, name); return text.slice(start, end + 4);
}
const commands = await load('const MAX_PAGE_LOCAL_TEXT_EDIT_CHARS=10000;\n' + source.command);
globalThis.__overlapCommands = commands;
const { CommandHistory } = await load('const {NO_TEXT_MUTATION_EFFECTS}=globalThis.__overlapCommands;\n' + source.history);
const { FindDialog } = await load(source.dialog), { DocumentDirtyState } = await load(source.dirty), { EventBus } = await load(source.bus);
const { Handler } = await load('const {SnapshotCommand,SubmodeSnapshotCommand,SubmodeSelectionSnapshotCommand}=globalThis.__overlapCommands;export class Handler{\n' +
  ['executeOperation', 'isOperationAllowedInEditMode', 'refreshAfterOperation'].map(n => method(source.input, n)).join('\n') + '\n}');
const { Bridge } = await load('export class Bridge{documentGeneration=1;constructor(doc){this.doc=doc;}assertDocumentWritable(){}\n' +
  ['replaceAll', 'saveSnapshot', 'restoreSnapshot', 'discardSnapshot', 'runInBatch'].map(n => method(source.bridge, n)).join('\n') + '\n}');
const M = await import(pathToFileURL(pkg + '/rhwp.js')); M.initSync({ module: fs.readFileSync(pkg + '/rhwp_bg.wasm') });
const configs = [
  { id: 'tail', text: 'aaaaTAIL', query: 'aaa', pieces: ['', 'aTAIL'], hits: 2 },
  { id: 'prefix-tail', text: 'START aaaaTAIL', query: 'aaa', pieces: ['START ', 'aTAIL'], hits: 2 },
  { id: 'adjacent', text: 'aaaaaaTAIL', query: 'aaa', pieces: ['', '', 'TAIL'], hits: 4 },
  { id: 'spaced', text: 'aaa aaaTAIL', query: 'aaa', pieces: ['', ' ', 'TAIL'], hits: 2 },
  { id: 'emoji', text: '😀😀😀😀TAIL', query: '😀😀😀', pieces: ['', '😀TAIL'], hits: 2 },
  { id: 'korean', text: '가가가가TAIL', query: '가가가', pieces: ['', '가TAIL'], hits: 2 },
  { id: 'fold-expansion', text: 'İİİİTAIL', query: 'i\u0307i\u0307i\u0307', sensitive: false, pieces: ['', 'İTAIL'], hits: 2 },
  { id: 'missing', text: 'aaaaTAIL', query: 'ZZZ', pieces: ['aaaaTAIL'], hits: 0 },
];
const target = (d, c) => c.kind === 0 ? d.getTextRange(0, c.parent, 0, 100000) : c.kind === 1
  ? d.getTextInCell(0, c.parent, c.control, 0, 0, 0, 100000)
  : d.getTextInCellByPath(0, c.parent, JSON.stringify(c.kind === 2
    ? [{ controlIndex: c.control, cellIndex: 0, cellParaIndex: 0 }, { controlIndex: 0, cellIndex: 0, cellParaIndex: 0 }]
    : [{ controlIndex: c.control, cellIndex: 0, cellParaIndex: 0 }]), 0, 100000);
if (!fs.existsSync(fixtures)) {
  assert.equal(mode, 'baseline'); fs.mkdirSync(fixtures, { recursive: true });
  const scopes = JSON.parse(fs.readFileSync(manifestArg)).filter(c => c.id.endsWith('-c0-a0'));
  assert.deepEqual(scopes.map(c => c.kind), [0, 1, 2, 3]);
  const pins = [];
  for (const scope of scopes) for (const c of configs) {
    const input = fs.readFileSync(scope.input), d = new M.HwpDocument(input);
    try {
      assert.equal(target(d, scope), scope.original);
      assert.deepEqual(JSON.parse(d.replaceAll(scope.original, c.text, true)), { ok: true, count: 1 });
      assert.equal(target(d, scope), c.text);
      for (const ext of ['hwp', 'hwpx']) {
        const bytes = ext === 'hwp' ? d.exportHwp() : d.exportHwpx(), file = `k${scope.kind}-${c.id}.${ext}`;
        fs.writeFileSync(fixtures + '/' + file, bytes);
        pins.push({ file, ext, kind: scope.kind, parent: scope.parent, control: scope.control, config: c.id,
          sha256: sha(bytes), seedInput: scope.input, seedSHA256: sha(input) });
      }
    } finally { d.free(); }
  }
  fs.writeFileSync(fixtures + '/pins.json', JSON.stringify({ synthetic: true, configs, pins }, null, 2));
}
const pinned = JSON.parse(fs.readFileSync(fixtures + '/pins.json')); assert.deepEqual(pinned.configs, configs);
function state(d, c) {
  const text = d.getTextFileText();
  // The text-file API JSON-quotes text and numeric-escapes supplementary scalars.
  const semanticText = JSON.parse(text).replace(/&#(\d+);/g, (_, value) => String.fromCodePoint(Number(value)));
  return { target: target(d, c), text, semanticText, props: Array.from({ length: d.getParagraphCount(0) }, (_, p) => JSON.parse(d.getParaPropertiesAt(0, p))),
    hwp: sha(d.exportHwp()), hwpx: sha(d.exportHwpx()), pages: d.pageCount(),
    svg: Array.from({ length: d.pageCount() }, (_, p) => sha(d.renderPageSvg(p))),
    print: Array.from({ length: d.pageCount() }, (_, p) => sha(d.renderPageSvgWithProfile(p, 'print'))) };
}
const rows = [], mismatches = [];
let reopens = 0, restores = 0;
for (const pin of pinned.pins) for (const replacement of ['Q', '', '한😀글XYZ']) {
  const c = configs.find(c => c.id === pin.config), bytes = fs.readFileSync(fixtures + '/' + pin.file);
  assert.equal(sha(bytes), pin.sha256);
  const d = new M.HwpDocument(bytes), w = new Bridge(d), history = new CommandHistory(), eventBus = new EventBus(), dirty = new DocumentDirtyState(eventBus), live = new Set();
  const save = d.saveSnapshot.bind(d), discard = d.discardSnapshot.bind(d);
  d.saveSnapshot = () => { const id = save(); live.add(id); return id; };
  d.discardSnapshot = id => { discard(id); live.delete(id); };
  let pos = { sectionIndex: 0, paragraphIndex: 0, charOffset: 0 }, result;
  const cursor = { getPosition: () => ({ ...pos }), moveTo: p => { pos = { ...p }; }, resetPreferredX() {}, clearSelection() {} };
  eventBus.on('document-mutated', reason => dirty.markDirty(reason));
  const ih = Object.assign(new Handler(), { wasm: w, history, cursor, editMode: 'normal', eventBus,
    caretLayoutReveal: { requestFor() {} }, afterEdit() { eventBus.emit('document-mutated', 'qa-repaint-adapter'); }, getCursorPosition: () => ({ ...pos }) });
  const dlg = Object.assign(Object.create(FindDialog.prototype), { services: { wasm: w, eventBus, getInputHandler: () => ih },
    queryInput: { value: c.query }, replaceInput: { value: replacement }, caseSensitiveCheck: { checked: c.sensitive ?? true }, statusLabel: { style: {} } });
  const replace = w.replaceAll.bind(w); w.replaceAll = (...args) => (result = replace(...args));
  const id = pin.file + '-r' + ['Q', '', '한😀글XYZ'].indexOf(replacement);
  try {
    const before = state(d, pin), allBefore = d.searchAllText(c.query, c.sensitive ?? true, true);
    assert.equal(JSON.parse(allBefore).length, c.hits, 'Find All retains its overlapping matches');
    const expected = c.pieces.join(replacement), expectedCount = c.pieces.length - 1;
    dlg.doReplaceAll(); assert(result?.ok);
    const after = state(d, pin);
    if (after.target !== expected || result.count !== expectedCount) mismatches.push({ id, kind: pin.kind, query: c.query,
      replacement, before: before.target, expected, actual: after.target, expectedCount, actualCount: result.count });
    assert.deepEqual(after.props, before.props);
    assert.equal(history.undoStack.length, result.count ? 1 : 0); assert.equal(history.redoStack.length, 0);
    assert.equal(dirty.isDirty(), !!result.count); assert.equal(dlg.statusLabel.textContent, `${result.count}개 바꿈`);
    if (mode === 'fixed') { assert.equal(after.target, expected); assert.equal(result.count, expectedCount); assert.equal(after.semanticText, before.semanticText.replace(c.text, expected)); }
    const saved = [];
    const persist = (stage, wanted) => {
      if (mode !== 'fixed') return;
      for (const ext of ['hwp', 'hwpx']) {
        const file = id + '-' + stage + '.' + ext, data = ext === 'hwp' ? d.exportHwp() : d.exportHwpx();
        fs.writeFileSync(out + '/' + file, data);
        const reopened = new M.HwpDocument(fs.readFileSync(out + '/' + file));
        try { const actual = state(reopened, pin); for (const key of ['target', 'text', 'semanticText', 'props', 'pages', 'svg', 'print']) assert.deepEqual(actual[key], wanted[key], file + ': ' + key);
          reopens++; saved.push({ file, sha256: sha(data) }); } finally { reopened.free(); }
      }
    };
    persist('changed', after);
    if (result.count) {
      history.undo(w); restores++; assert.deepEqual(state(d, pin), before); assert.equal(d.searchAllText(c.query, c.sensitive ?? true, true), allBefore);
      persist('undo', before);
      history.redo(w); restores++; assert.deepEqual(state(d, pin), after);
    } else { assert.deepEqual(after, before); persist('unchanged', before); }
    rows.push({ id, ...pin, replacement, expected, expectedCount, actual: after.target, actualCount: result.count, saved });
  } finally { history.clear(w); assert.equal(live.size, 0, id + ': no orphan snapshots'); d.free(); }
}
const proof = { mode, GUIVerified: false, actualWasmBridgeFindDialogInputHandlerSnapshotHistory: true, cursorDOMRepaintAdapters: true,
  rows, mismatches, reopens, restores, wasmSHA256: sha(fs.readFileSync(pkg + '/rhwp_bg.wasm')),
  sourceSHA256: Object.fromEntries(Object.entries(source).map(([k, v]) => [k, sha(v)])), harnessSHA256: sha(fs.readFileSync(import.meta.filename)) };
fs.writeFileSync(out + '/proof.json', JSON.stringify(proof, null, 2));
console.log(JSON.stringify({ mode, cases: rows.length, mismatches: mismatches.length, reopens, restores }));
if (mode === 'fixed') assert.equal(mismatches.length, 0); else assert(mismatches.length > 0);

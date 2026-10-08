// Current engine and actual command/registry/dispatcher/menu-state code.
// Reproduces missing support. No review-comment authoring or GUI success claim.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {stripTypeScriptTypes} from 'node:module';
import {pathToFileURL} from 'node:url';

const [pkg, fixtures, out] = process.argv.slice(2);
fs.mkdirSync(out, {recursive: true});
const read = f => fs.readFileSync(f, 'utf8');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const sources = Object.fromEntries(Object.entries({
  insert: 'command/commands/insert.ts', hyperlink: 'command/commands/hyperlink.ts',
  registry: 'command/registry.ts', dispatcher: 'command/dispatcher.ts', menu: 'ui/menu-bar.ts',
}).map(([k, f]) => [k, read('rhwp-studio/src/' + f)]));
const load = async s => import('data:text/javascript;base64,' + Buffer.from(
  stripTypeScriptTypes(s, {mode: 'transform'}).replace(/^import[\s\S]*?;\s*$/gm, ''),
).toString('base64'));
globalThis.__memoProbeHyperlink = (await load(sources.hyperlink)).bodyHyperlinkCommand;
const {insertCommands} = await load('const bodyHyperlinkCommand=globalThis.__memoProbeHyperlink;\n' + sources.insert);
const {CommandRegistry} = await load(sources.registry);
const {CommandDispatcher} = await load('const busyDepth=()=>0;\n' + sources.dispatcher);
const start = sources.menu.indexOf('  private updateMenuStates(');
const end = sources.menu.indexOf('\n  }\n', start);
assert(start >= 0 && end > start);
const {MenuProbe} = await load('export class MenuProbe{dispatcher;constructor(d){this.dispatcher=d;}\n'
  + sources.menu.slice(start, end + 4) + '\n}');
const bytes = fs.readFileSync(path.join(pkg, 'rhwp_bg.wasm'));
const {initSync, HwpDocument} = await import(pathToFileURL(path.resolve(pkg, 'rhwp.js')));
initSync({module: bytes});
const exports = Object.getOwnPropertyNames(HwpDocument.prototype).filter(n => /comment|memo/i.test(n));
assert.deepEqual(exports, []);
const state = d => ({hwp: sha(d.exportHwp()), hwpx: sha(d.exportHwpx()),
  text: d.getTextFileText(), fields: d.getFieldList(), info: d.getDocumentInfo(), events: d.getEventLog()});
// Events are an append-only audit log, not document snapshot state.
const documentState = s => { const {events, ...document} = s; return document; };
const saveReported = (d, kind, file) => {
  const artifact = kind === 'hwp' ? d.exportHwpWithReport() : d.exportHwpxWithReport();
  try {
    const report = JSON.parse(artifact.contentLoss());
    fs.writeFileSync(file, artifact.takeBytes());
    return report;
  } finally { artifact.free(); }
};

const contexts = ['body', 'cell', 'nestedCell', 'header', 'footnote', 'multiParagraph'];
const ranges = [[2, 7], [7, 9], [4, 4], [-1, 3], [9, 2], [2.5, 7], [2, 999], [0, Number.MAX_SAFE_INTEGER]];
const rows = [], snapshots = [], reports = [];
let operations = 0, selectionReads = 0, emittedEvents = 0;
for (const file of ['memo-1.hwpx', 'memo-2.hwpx', 'memo-1.hwp', 'memo-2.hwp']) {
  const d = new HwpDocument(fs.readFileSync(path.join(fixtures, file)));
  try {
    const before = state(d);
    for (const scope of contexts) for (const [a, b] of ranges) {
      const ctx = {hasDocument: true, isEditable: true, isFormMode: false, hasSelection: a !== b,
        inTable: scope === 'cell' || scope === 'nestedCell', inCellSelectionMode: false,
        inPictureObjectSelection: false, inTableObjectSelection: false};
      const pos = {sectionIndex: 0, paragraphIndex: 0, charOffset: a};
      const ih = {
        getCursorPosition: () => pos,
        getSelection() { selectionReads++; return {start: pos, end: {...pos,
          paragraphIndex: scope === 'multiParagraph' ? 1 : 0, charOffset: b}}; },
        executeOperation() { operations++; throw new Error('Disabled command must not edit'); },
      };
      const eventBus = {emit() { emittedEvents++; }};
      const services = {getContext: () => ctx, getInputHandler: () => ih, wasm: d, eventBus};
      const registry = new CommandRegistry(); registry.registerAll(insertCommands);
      const dispatcher = new CommandDispatcher(registry, services, eventBus);
      assert.equal(registry.has('insert:comment'), true);
      assert.equal(dispatcher.isEnabled('insert:comment'), false);
      const result = dispatcher.dispatchWithResult('insert:comment');
      assert.deepEqual(result, {ok: false, reason: 'disabled'});
      const classes = new Set();
      const item = {dataset: {cmd: 'insert:comment'}, classList: {
        toggle(n, enabled) { enabled ? classes.add(n) : classes.delete(n); },
      }};
      new MenuProbe(dispatcher).updateMenuStates({querySelectorAll: selector =>
        selector === '.md-item[data-cmd]' ? [item] : []});
      assert(classes.has('disabled')); assert.deepEqual(state(d), before);
      rows.push({file, scope, range: [a, b], result, entireStateUnchanged: true});
    }
    if (file === 'memo-2.hwpx' || file === 'memo-2.hwp') {
      const from = file.endsWith('.hwpx') ? 'hwpx' : 'hwp';
      for (const kind of ['hwp', 'hwpx']) reports.push({from, kind,
        contentLoss: saveReported(d, kind, path.join(fixtures, `wasm-from-${from}.${kind}`))});
    }
    // Generic document snapshots exist; this does not test an absent comment command.
    const old = d.saveSnapshot(); d.insertText(0, 0, 0, '합성 본문 수정🙂');
    const after = state(d); const newer = d.saveSnapshot();
    d.restoreSnapshot(old); assert.deepEqual(documentState(state(d)), documentState(before));
    d.restoreSnapshot(newer); assert.deepEqual(documentState(state(d)), documentState(after));
    d.restoreSnapshot(old); d.discardSnapshot(old); d.discardSnapshot(newer);
    snapshots.push({file, genericDocumentSnapshotRestore: true, commentUndoRedoTested: false});
  } finally { d.free(); }
}
assert.equal(operations, 0); assert.equal(selectionReads, 0); assert.equal(emittedEvents, 0);
assert(/class="md-item disabled" data-cmd="insert:comment"/.test(read('rhwp-studio/index.html')));
const proof = {verdict: 'GAP_REPRODUCED', implementationChanged: false,
  wasmSHA256: sha(bytes), sourceSHA256: Object.fromEntries(Object.entries(sources).map(([k, v]) => [k, sha(v)])),
  memoOrCommentExports: exports, disabledDispatchCases: rows.length, operations, selectionReads, emittedEvents,
  // Scope labels here exercise unconditional disabled dispatch, not implemented scope guards.
  scopeGuardImplemented: false, commentAuthoringVerified: false, commentUndoRedoVerified: false,
  GUIVerified: false, physicalIMEVerified: false, reports, snapshots, rows};
fs.writeFileSync(path.join(out, 'proof.json'), JSON.stringify(proof, null, 2) + '\n');
console.log(JSON.stringify({...proof, rows: undefined, sourceSHA256: undefined}));

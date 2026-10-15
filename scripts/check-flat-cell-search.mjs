// Actual WASM + current Bridge, FindDialog and closed-dialog Find Again.
// Cursor/DOM adapters are source tests, not native app QA.
// node scripts/check-flat-cell-search.mjs PKG FIXTURES FRESH_OUTPUT baseline|fixed [SOURCE_ROOT]
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { stripTypeScriptTypes } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const [pkgArg, fixturesArg, outArg, mode, sourceRootArg] = process.argv.slice(2);
const root = sourceRootArg ? path.resolve(sourceRootArg) : path.resolve(import.meta.dirname, '..');
const pkg = path.resolve(pkgArg), fixtures = path.resolve(fixturesArg), out = path.resolve(outArg);
assert(['baseline', 'fixed'].includes(mode));
assert(!fs.existsSync(out));
fs.mkdirSync(out, { recursive: true });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const source = Object.fromEntries(Object.entries({ dialog: 'ui/find-dialog.ts', bridge: 'core/wasm-bridge.ts', edit: 'command/commands/edit.ts' })
  .map(([key, file]) => [key, fs.readFileSync(root + '/rhwp-studio/src/' + file, 'utf8')]));
const load = text => import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(text, { mode: 'transform' })
  .replace(/^import[\s\S]*?;\s*$/gm, '')).toString('base64'));
const M = await import(pathToFileURL(pkg + '/rhwp.js'));
M.initSync({ module: fs.readFileSync(pkg + '/rhwp_bg.wasm') });

// Independent addresses: a body paragraph, the table host body, two paragraphs
// of cell 0, cell 1, then the following body paragraph. All starts collide at 0.
const configs = [
  { id: 'flat', query: 'needle', repeat: 1, hostBody: false },
  { id: 'unicode-adjacent', query: '😀', repeat: 2, hostBody: false },
  { id: 'host-body', query: '한글', repeat: 2, hostBody: true },
];
function expectedHits(c) {
  const hit = (para, offset = 0, cell) => ({ found: true, sec: 0, para, charOffset: offset, length: [...c.query].length,
    ...(cell ? { cellContext: { parentPara: 1, ctrlIdx: 0, cellIdx: cell[0], cellPara: cell[1] } } : {}) });
  const repeated = (para, cell) => Array.from({ length: c.repeat }, (_, i) => hit(para, i * [...c.query].length, cell));
  return [...repeated(0), ...(c.hostBody ? repeated(1) : []), ...repeated(1, [0, 0]),
    hit(1, 0, [0, 1]), hit(1, 0, [1, 0]), ...repeated(2)];
}
if (!fs.existsSync(fixtures)) {
  assert.equal(mode, 'baseline');
  fs.mkdirSync(fixtures, { recursive: true });
  const pins = [];
  for (const c of configs) {
    const d = M.HwpDocument.createEmpty();
    try {
      d.createBlankDocument();
      const repeated = c.query.repeat(c.repeat);
      assert(JSON.parse(d.insertText(0, 0, 0, repeated + ' before')).ok);
      assert(JSON.parse(d.splitParagraph(0, 0, [...repeated + ' before'].length)).ok);
      assert.deepEqual(JSON.parse(d.createTable(0, 1, 0, 1, 2)), { ok: true, paraIdx: 1, controlIdx: 0 });
      assert(JSON.parse(d.insertTextInCell(0, 1, 0, 0, 0, 0, repeated)).ok);
      assert(JSON.parse(d.splitParagraphInCell(0, 1, 0, 0, 0, [...repeated].length)).ok);
      assert(JSON.parse(d.insertTextInCell(0, 1, 0, 0, 1, 0, c.query + ' second')).ok);
      assert(JSON.parse(d.insertTextInCell(0, 1, 0, 1, 0, 0, c.query + ' cell1')).ok);
      if (c.hostBody) assert(JSON.parse(d.insertText(0, 1, 0, repeated)).ok);
      assert(JSON.parse(d.insertText(0, 2, 0, repeated + ' after')).ok);
      for (const ext of ['hwp', 'hwpx']) {
        const bytes = ext === 'hwp' ? d.exportHwp() : d.exportHwpx(), file = c.id + '.' + ext;
        fs.writeFileSync(fixtures + '/' + file, bytes);
        pins.push({ file, sha256: sha(bytes) });
      }
    } finally { d.free(); }
  }
  fs.writeFileSync(fixtures + '/pins.json', JSON.stringify({ synthetic: true, configs, pins }, null, 2));
}
const pins = JSON.parse(fs.readFileSync(fixtures + '/pins.json'));
assert.deepEqual(pins.configs, configs);
for (const p of pins.pins) assert.equal(sha(fs.readFileSync(fixtures + '/' + p.file)), p.sha256);

const dialog = await load(source.dialog);
globalThis.__flatCellDialog = dialog;
const { FindDialog } = dialog;
if (mode === 'fixed') {
  const base = { sectionIndex: 0, paragraphIndex: 7, parentParaIndex: 1, charOffset: 2,
    controlIndex: 9, cellIndex: 9, cellParaIndex: 9,
    cellPath: [{ controlIndex: 0, cellIndex: 1, cellParaIndex: 0 }] };
  assert.deepEqual(FindDialog.searchOrigin(base), { sec: 0, para: 1, charOffset: 2,
    cellContext: { parentPara: 1, ctrlIdx: 0, cellIdx: 1, cellPara: 0 } }, 'flat path overrides stale legacy fields');
  for (const pos of [{ ...base, isTextBox: true }, { ...base, cellPath: [...base.cellPath, ...base.cellPath] }]) {
    assert.equal(FindDialog.searchOrigin(pos).cellContext, undefined, 'unsupported origins are not flattened to a table cell');
  }
}
const { editCommands } = await load('const {FindDialog,navigateToSearchHit}=globalThis.__flatCellDialog;const canExecuteFormatPaste=()=>false;\n' + source.edit);
const again = editCommands.find(c => c.id === 'edit:find-again');
assert(again);
const start = source.bridge.indexOf('  searchText('), end = source.bridge.indexOf('\n  }', start);
assert(start >= 0 && end > start);
const { Bridge } = await load('export class Bridge { constructor(doc){this.doc=doc;this.documentGeneration=1;}\n' + source.bridge.slice(start, end + 4) + '\n}');
const key = h => !h?.found ? { found: false } : ({ found: true, sec: h.sec, para: h.para, charOffset: h.charOffset,
  length: h.length, ...(h.cellContext ? { cellContext: h.cellContext } : {}), wrapped: !!h.wrapped });
const position = (hit, end = false, flavor) => {
  const cell = hit.cellContext;
  return { sectionIndex: hit.sec, paragraphIndex: cell && flavor === 'local-paragraph' ? cell.cellPara : hit.para,
    charOffset: hit.charOffset + (end ? hit.length : 0), ...(cell ? {
      parentParaIndex: cell.parentPara, controlIndex: cell.ctrlIdx, cellIndex: cell.cellIdx, cellParaIndex: cell.cellPara,
      ...(flavor === 'path' ? { cellPath: [{ controlIndex: cell.ctrlIdx, cellIndex: cell.cellIdx, cellParaIndex: cell.cellPara }] } : {}),
    } : {}) };
};
function state(d) {
  return { text: d.getTextFileText(), allHits: JSON.parse(d.searchAllText('needle', true, true)),
    props: Array.from({ length: d.getParagraphCount(0) }, (_, p) => JSON.parse(d.getParaPropertiesAt(0, p))),
    pages: d.pageCount(), hwp: sha(d.exportHwp()), hwpx: sha(d.exportHwpx()),
    svg: Array.from({ length: d.pageCount() }, (_, p) => sha(d.renderPageSvg(p))),
    print: Array.from({ length: d.pageCount() }, (_, p) => sha(d.renderPageSvgWithProfile(p, 'print'))) };
}
const rows = [], mismatches = [];
let searches = 0, reopens = 0;
for (const ext of ['hwp', 'hwpx']) for (const c of configs) {
  const d = new M.HwpDocument(fs.readFileSync(fixtures + '/' + c.id + '.' + ext));
  try {
    const expected = expectedHits(c), before = state(d);
    assert.deepEqual(JSON.parse(d.searchAllText(c.query, true, true)), expected.map(({ found, ...hit }) => hit));
    const paths = [];
    for (const flavor of ['direct', 'dialog', 'local-paragraph', 'path', 'find-again']) for (const forward of [true, false]) {
      if (flavor === 'find-again' && !forward) continue;
      let pos = position(forward ? expected[0] : expected.at(-1), false, flavor), actualHit;
      const bridge = new Bridge(d), search = bridge.searchText.bind(bridge);
      bridge.searchText = (...args) => (actualHit = search(...args));
      const ih = { getCursorPosition: () => ({ ...pos }), moveCursorTo: p => { pos = { ...p }; }, cursor: {
        setAnchor() {}, clearSelection() {}, moveTo: p => { pos = { ...p }; },
      } };
      const services = { wasm: bridge, getInputHandler: () => ih };
      const dlg = Object.create(FindDialog.prototype);
      Object.assign(dlg, { services, queryInput: { value: c.query }, caseSensitiveCheck: { checked: true }, statusLabel: { style: {} } });
      FindDialog.lastQuery = c.query; FindDialog.lastCaseSensitive = true;
      // Reverse starts just after the final match so its first result is that match.
      if (!forward) pos.charOffset += expected.at(-1).length;
      const steps = [];
      for (let step = 0; step < expected.length * 3; step++) {
        const index = forward ? step % expected.length : expected.length - 1 - step % expected.length;
        const wanted = key({ ...expected[index], wrapped: step > 0 && step % expected.length === 0 });
        if (flavor === 'direct') {
          const origin = !forward && actualHit?.found ? actualHit : {
            sec: pos.sectionIndex, para: pos.parentParaIndex ?? pos.paragraphIndex, charOffset: pos.charOffset,
            ...(pos.parentParaIndex !== undefined ? { cellContext: { parentPara: pos.parentParaIndex, ctrlIdx: pos.controlIndex, cellIdx: pos.cellIndex, cellPara: pos.cellParaIndex } } : {}),
          };
          actualHit = JSON.parse(d.searchText(c.query, origin.sec, origin.para, origin.charOffset, forward, true, true,
            origin.cellContext ? JSON.stringify(origin.cellContext) : undefined));
          if (actualHit.found) pos = position(actualHit, true, flavor);
        } else if (flavor === 'find-again') again.execute(services);
        else if (forward) dlg.findNext(); else dlg.findPrev();
        const actual = key(actualHit);
        if (JSON.stringify(actual) !== JSON.stringify(wanted)) mismatches.push({ ext, id: c.id, flavor, forward, step, actual, expected: wanted });
        steps.push({ actual, expected: wanted }); searches++;
        // Exercise real cursor shapes produced after cell paragraph edits/path navigation.
        if (actualHit?.found && ['local-paragraph', 'path'].includes(flavor)) pos = position(actualHit, true, flavor);
      }
      paths.push({ flavor, forward, steps });
    }
    if (mode === 'fixed') {
      // A stale cell hit must not override the next document's body caret.
      const bridge = new Bridge(d), ih = { getCursorPosition: () => ({ sectionIndex: 0, paragraphIndex: 0, charOffset: 0 }),
        moveCursorTo() {}, cursor: { clearSelection() {}, moveTo() {}, setAnchor() {} } };
      let actual;
      const search = bridge.searchText.bind(bridge);
      bridge.searchText = (...args) => (actual = search(...args));
      const dlg = Object.create(FindDialog.prototype);
      Object.assign(dlg, { services: { wasm: bridge, getInputHandler: () => ih },
        queryInput: { value: c.query }, caseSensitiveCheck: { checked: true }, statusLabel: { style: {} },
        currentHit: expected.find(h => h.cellContext), currentHitGeneration: 0 });
      dlg.findPrev();
      assert.deepEqual(key(actual), key({ ...expected.at(-1), wrapped: true }));
    }
    assert.deepEqual(state(d), before, 'find operations preserve bytes, text, properties and every SVG');
    const saved = [];
    if (mode === 'fixed') for (const target of ['hwp', 'hwpx']) {
      const bytes = target === 'hwp' ? d.exportHwp() : d.exportHwpx(), file = c.id + '-' + ext + '.' + target;
      fs.writeFileSync(out + '/' + file, bytes);
      const reopened = new M.HwpDocument(fs.readFileSync(out + '/' + file));
      try {
        const actual = state(reopened);
        for (const field of ['text', 'allHits', 'props', 'pages', 'svg', 'print']) assert.deepEqual(actual[field], before[field], file + ': ' + field);
        saved.push({ file, sha256: sha(bytes), textPropertiesAndSVGEqual: true }); reopens++;
      } finally { reopened.free(); }
    }
    rows.push({ ext, id: c.id, paths, saved, unchanged: true });
  } finally { d.free(); }
}
const proof = { mode, GUIVerified: false, actualWasmBridgeFindDialogAndFindAgain: true, cursorAndDOMAdapters: true,
  flatCellTraversal: true, canonicalContainerOrder: 'body paragraph, then its controls/cells/paragraphs, then next body paragraph',
  searches, reopens, mismatches, rows, wasmSHA256: sha(fs.readFileSync(pkg + '/rhwp_bg.wasm')),
  sourceSHA256: Object.fromEntries(Object.entries(source).map(([key, text]) => [key, sha(text)])),
  harnessSHA256: sha(fs.readFileSync(import.meta.filename)) };
fs.writeFileSync(out + '/proof.json', JSON.stringify(proof, null, 2));
console.log(JSON.stringify({ mode, documents: rows.length, searches, reopens, mismatches: mismatches.length }));
if (mode === 'fixed') assert.equal(mismatches.length, 0); else assert(mismatches.length > 0);

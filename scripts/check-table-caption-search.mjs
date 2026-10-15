// Actual caption-entry/FindDialog/Find Again source + real WASM. No native GUI claim.
// node scripts/check-table-caption-search.mjs PKG FIXTURES FRESH_OUT baseline|fixed [SOURCE_ROOT]
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { stripTypeScriptTypes } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
const [pkgArg, fixturesArg, outArg, mode, sourceArg] = process.argv.slice(2);
const pkg = path.resolve(pkgArg), fixtures = path.resolve(fixturesArg), out = path.resolve(outArg);
const root = sourceArg ? path.resolve(sourceArg) : path.resolve(import.meta.dirname, '..');
assert(['baseline', 'fixed'].includes(mode)); assert(!fs.existsSync(out));
fs.mkdirSync(out, { recursive: true });
const sha = x => createHash('sha256').update(x).digest('hex');
const source = Object.fromEntries(Object.entries({ dialog: 'ui/find-dialog.ts', bridge: 'core/wasm-bridge.ts',
  edit: 'command/commands/edit.ts', input: 'engine/input-handler.ts' }).map(([k, p]) => [k, fs.readFileSync(root + '/rhwp-studio/src/' + p, 'utf8')]));
const load = code => import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(code, { mode: 'transform' })
  .replace(/^import[\s\S]*?;\s*$/gm, '')).toString('base64'));
function method(text, name) {
  const start = text.indexOf('  ' + name + '('), end = text.indexOf('\n  }', start);
  assert(start >= 0 && end > start, name); return text.slice(start, end + 4);
}
const M = await import(pathToFileURL(pkg + '/rhwp.js'));
M.initSync({ module: fs.readFileSync(pkg + '/rhwp_bg.wasm') });
const dialog = await load(source.dialog), { FindDialog } = dialog;
globalThis.__captionDialog = dialog;
const { editCommands } = await load('const {FindDialog,navigateToSearchHit}=globalThis.__captionDialog;const canExecuteFormatPaste=()=>false;\n' + source.edit);
const again = editCommands.find(c => c.id === 'edit:find-again'); assert(again);
const { Bridge } = await load('export class Bridge{constructor(doc){this.doc=doc;this.documentGeneration=1;}\n' + method(source.bridge, 'searchText') + '\n}');
const { Entry } = await load('export class Entry{\n' + method(source.input, 'enterTableCaptionEditing') + '\n}');
if (!fs.existsSync(fixtures)) {
  fs.mkdirSync(fixtures, { recursive: true });
  const pins = [];
  for (const hostBody of [false, true]) {
    const d = M.HwpDocument.createEmpty();
    try {
      d.createBlankDocument();
      assert(JSON.parse(d.insertText(0, 0, 0, 'needle before')).ok);
      assert(JSON.parse(d.splitParagraph(0, 0, 13)).ok);
      assert.deepEqual(JSON.parse(d.createTable(0, 1, 0, 1, 2)), { ok: true, paraIdx: 1, controlIdx: 0 });
      assert(JSON.parse(d.insertTextInCell(0, 1, 0, 0, 0, 0, 'needle cell0')).ok);
      assert(JSON.parse(d.splitParagraphInCell(0, 1, 0, 0, 0, 12)).ok);
      assert(JSON.parse(d.insertTextInCell(0, 1, 0, 0, 1, 0, 'needle second')).ok);
      assert(JSON.parse(d.insertTextInCell(0, 1, 0, 1, 0, 0, 'needle cell1')).ok);
      assert(JSON.parse(d.setTableProperties(0, 1, 0, JSON.stringify({ hasCaption: true }))).ok);
      assert(JSON.parse(d.insertTextInCell(0, 1, 0, 65534, 0, 3, 'CAPTION_ONLY 😀')).ok);
      if (hostBody) assert(JSON.parse(d.insertText(0, 1, 0, 'needle host')).ok);
      assert(JSON.parse(d.insertText(0, 2, 0, 'needle after')).ok);
      for (const ext of ['hwp', 'hwpx']) {
        const file = `caption-${hostBody ? 'host-body' : 'empty-host'}.${ext}`;
        const bytes = ext === 'hwp' ? d.exportHwp() : d.exportHwpx();
        fs.writeFileSync(fixtures + '/' + file, bytes); pins.push({ file, hostBody, ext, sha256: sha(bytes) });
      }
    } finally { d.free(); }
  }
  fs.writeFileSync(fixtures + '/pins.json', JSON.stringify({ synthetic: true, pins }, null, 2));
}
const { pins } = JSON.parse(fs.readFileSync(fixtures + '/pins.json'));
assert.equal(pins.length, 4);
const cell = (idx, para) => ({ parentPara: 1, ctrlIdx: 0, cellIdx: idx, cellPara: para });
const hit = (para, context) => ({ found: true, sec: 0, para, charOffset: 0, length: 6, ...(context ? { cellContext: context } : {}) });
const rank = h => h.cellContext ? 2 + (h.cellContext.cellIdx === 0 ? h.cellContext.cellPara : 2) : h.para === 2 ? 5 : h.para;
const key = h => !h?.found ? { found: false } : ({ found: true, sec: h.sec, para: h.para,
  charOffset: h.charOffset, length: h.length, ...(h.cellContext ? { cellContext: h.cellContext } : {}), wrapped: !!h.wrapped });
function state(d) {
  return { text: d.getTextFileText(), caption: d.getTextInCell(0, 1, 0, 65534, 0, 0, 10000),
    table: JSON.parse(d.getTableProperties(0, 1, 0)),
    props: Array.from({ length: d.getParagraphCount(0) }, (_, p) => JSON.parse(d.getParaPropertiesAt(0, p))),
    hwp: sha(d.exportHwp()), hwpx: sha(d.exportHwpx()), pages: d.pageCount(),
    svg: Array.from({ length: d.pageCount() }, (_, p) => sha(d.renderPageSvg(p))),
    print: Array.from({ length: d.pageCount() }, (_, p) => sha(d.renderPageSvgWithProfile(p, 'print'))) };
}
const rows = [], errors = [], mismatches = [];
let starts = 0, searches = 0, reopens = 0;
for (const pin of pins) {
  const bytes = fs.readFileSync(fixtures + '/' + pin.file); assert.equal(sha(bytes), pin.sha256);
  const d = new M.HwpDocument(bytes);
  try {
    const before = state(d); assert(before.table.hasCaption); assert(before.caption.includes('CAPTION_ONLY 😀'));
    const all = [hit(0), ...(pin.hostBody ? [hit(1)] : []), hit(1, cell(0, 0)), hit(1, cell(0, 1)), hit(1, cell(1, 0)), hit(2)];
    assert.deepEqual(JSON.parse(d.searchAllText('needle', true, true)), all.map(({ found, ...h }) => h));
    const cases = [];
    for (const shape of ['entry-flat', 'sentinel-path']) for (const offset of [0, 3, [...before.caption].length])
      for (const query of ['needle', 'MISSING_QUERY', 'CAPTION_ONLY']) for (const flavor of ['next', 'previous', 'find-again']) {
        starts++;
        let pos, actual, gold, goldPos = { rank: 1, offset };
        const cursor = { clearSelection() {}, resetPreferredX() {}, setAnchor() {}, moveTo: p => { pos = { ...p }; } };
        const ih = Object.assign(new Entry(), { cursor, updateCaret() {}, focusTextarea() {},
          getCursorPosition: () => ({ ...pos }), moveCursorTo: p => { pos = { ...p }; } });
        ih.enterTableCaptionEditing(0, 1, 0, offset);
        assert.equal(pos.cellIndex, 65534); assert.equal(pos.paragraphIndex, 0);
        if (shape === 'sentinel-path') pos.cellPath = [{ controlIndex: 0, cellIndex: 65534, cellParaIndex: 0 }];
        const initialPosition = { ...pos }, bridge = new Bridge(d), call = bridge.searchText.bind(bridge), calls = [];
        bridge.searchText = (...args) => { calls.push(args); return (actual = call(...args)); };
        const services = { wasm: bridge, getInputHandler: () => ih }, dlg = Object.create(FindDialog.prototype);
        Object.assign(dlg, { services, queryInput: { value: query }, caseSensitiveCheck: { checked: true }, statusLabel: { style: {} } });
        FindDialog.lastQuery = query; FindDialog.lastCaseSensitive = true;
        const forward = flavor !== 'previous', steps = [];
        let error;
        for (let step = 0; step < (query === 'needle' ? 8 : 1); step++) {
          const from = !forward && gold?.found ? { rank: rank(gold), offset: gold.charOffset } : goldPos;
          const candidates = query === 'needle' ? all : [];
          const cmp = h => rank(h) - from.rank || h.charOffset - from.offset;
          const selected = forward ? candidates.find(h => cmp(h) >= 0) : candidates.findLast(h => cmp(h) < 0);
          const expected = !candidates.length ? { found: false } : { ...(selected ?? (forward ? candidates[0] : candidates.at(-1))), wrapped: !selected };
          searches++;
          try { if (flavor === 'find-again') again.execute(services); else if (forward) dlg.findNext(); else dlg.findPrev(); }
          catch (e) { error = String(e); errors.push({ file: pin.file, shape, offset, query, flavor, step, error }); break; }
          if (JSON.stringify(key(actual)) !== JSON.stringify(key(expected))) mismatches.push({ file: pin.file, shape, offset, query, flavor, step, actual, expected });
          steps.push({ actual, expected });
          if (expected.found) goldPos = { rank: rank(expected), offset: expected.charOffset + expected.length };
          gold = expected;
        }
        if (mode === 'fixed') {
          assert.equal(calls[0][7], undefined, 'caption sentinel never reaches the engine as a cell origin');
          assert.deepEqual(calls[0].slice(1, 4), [0, 1, offset], 'caption search retains its outer body owner');
        }
        cases.push({ shape, offset, query, flavor, initialPosition, firstSearchArgs: calls[0], error, steps });
      }
    assert.deepEqual(state(d), before, 'caption-origin searches never modify bytes, caption, properties or SVGs');
    const saved = [];
    if (mode === 'fixed') for (const ext of ['hwp', 'hwpx']) {
      const file = pin.file + '-reopened.' + ext, data = ext === 'hwp' ? d.exportHwp() : d.exportHwpx();
      fs.writeFileSync(out + '/' + file, data);
      const reopened = new M.HwpDocument(fs.readFileSync(out + '/' + file));
      try {
        const after = state(reopened);
        for (const field of ['text', 'caption', 'table', 'props', 'pages', 'svg', 'print']) assert.deepEqual(after[field], before[field], file + ': ' + field);
        saved.push({ file, sha256: sha(data) }); reopens++;
      } finally { reopened.free(); }
    }
    rows.push({ ...pin, cases, saved, unchanged: true });
  } finally { d.free(); }
}
const proof = { mode, GUIVerified: false, actualCaptionEntryFindDialogBridgeAndFindAgain: true, cursorDOMAdapters: true,
  starts, searches, reopens, errors, mismatches, rows, wasmSHA256: sha(fs.readFileSync(pkg + '/rhwp_bg.wasm')),
  sourceSHA256: Object.fromEntries(Object.entries(source).map(([k, text]) => [k, sha(text)])), harnessSHA256: sha(fs.readFileSync(import.meta.filename)) };
fs.writeFileSync(out + '/proof.json', JSON.stringify(proof, null, 2));
console.log(JSON.stringify({ mode, documents: rows.length, starts, searches, errors: errors.length, mismatches: mismatches.length, reopens }));
if (mode === 'baseline') { assert.equal(errors.length, starts); assert(errors.every(e => e.error.includes('검색 시작 셀 좌표가 잘못됨'))); }
else { assert.equal(errors.length, 0); assert.equal(mismatches.length, 0); }

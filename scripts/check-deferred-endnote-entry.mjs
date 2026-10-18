// Real WASM + existing bridge/cursor/insert entry methods; DOM adapter, not app QA.
// node SCRIPT PKG MANIFEST FRESH_OUTPUT baseline|fixed
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { stripTypeScriptTypes } from 'node:module';
import { pathToFileURL } from 'node:url';
const [pkg, manifest, out, mode] = process.argv.slice(2);
assert(['baseline', 'fixed'].includes(mode)); fs.mkdirSync(out);
const sha = b => createHash('sha256').update(b).digest('hex');
const M = await import(pathToFileURL(path.resolve(pkg, 'rhwp.js')));
M.initSync({ module: fs.readFileSync(path.join(pkg, 'rhwp_bg.wasm')) });
const load = async s => import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(s, { mode: 'transform' })).toString('base64'));
const method = (s, name) => {
  const start = s.indexOf('  ' + name + '('); assert(start >= 0, name);
  return s.slice(start, s.indexOf('\n  }\n', start) + 4) + '\n';
};
const bridgeSource = fs.readFileSync('rhwp-studio/src/core/wasm-bridge.ts', 'utf8');
const cursorSource = fs.readFileSync('rhwp-studio/src/engine/cursor.ts', 'utf8');
const insertSource = fs.readFileSync('rhwp-studio/src/command/commands/insert.ts', 'utf8');
const { Bridge } = await load('export class Bridge { doc; constructor(d){this.doc=d;}\n' +
  ['getNoteEditInfo', 'getCursorRectInNote', 'getCursorRectInFootnote'].map(n => method(bridgeSource, n)).join('') + '}');
const { Cursor } = await load('export class Cursor {\n' +
  ['enterFootnoteMode', 'setFnCursorPosition', 'updateRect'].map(n => method(cursorSource, n)).join('') + '}');
const start = insertSource.indexOf('function enterNoteEditing('); assert(start >= 0);
const { enterNoteEditing } = await load('export ' + insertSource.slice(start, insertSource.indexOf('\n/**', start)));
const fixtures = JSON.parse(fs.readFileSync(manifest)), rows = []; let negativeChecks = 0, uiEntries = 0;
const walk = n => [n, ...(n.children ?? []).flatMap(walk)];
for (const f of fixtures) {
  const input = fs.readFileSync(f.path); assert.equal(sha(input), f.sha256);
  const d = new M.HwpDocument(input);
  const body = () => Array.from({ length: d.getSectionCount() }, (_, s) =>
    Array.from({ length: d.getParagraphCount(s) }, (_, p) => d.getTextRange(s, p, 0, d.getParagraphLength(s, p))));
  const initialBody = body();
  const initialNotes = f.targets.map(([s, c]) => JSON.parse(d.getFootnoteInfo(s, 0, c)).texts);
  const query = (doc, s, c, inner) => {
    try {
      const info = JSON.parse(doc.getNoteEditInfo(s, 0, c));
      const rect = JSON.parse(doc.getCursorRectInNote(s, 0, c, inner, inner === 0 ? 2 : 0));
      assert.equal(info.ok, true); assert(info.pageNum < doc.pageCount());
      if (inner === 0) {
        assert.equal(info.pageNum, rect.pageIndex);
        if (info.kind === 'endnote') {
          const renderSection = JSON.parse(doc.getPageInfo(info.pageNum)).sectionIndex;
          assert(info.virtualParaIndex >= doc.getParagraphCount(renderSection));
          const runs = walk(JSON.parse(doc.getPageRenderTree(info.pageNum))).filter(n => n.type === 'TextRun' && n.pi === info.virtualParaIndex);
          const hasVisibleText = JSON.parse(doc.getFootnoteInfo(s, 0, c)).texts.some(t => t.trim());
          // Empty-note placeholders are not painted. Their logical caret may
          // extend beyond the marker's ink box; glyph metrics are out of scope.
          assert(runs.some(n => Math.abs(rect.y - n.bbox.y) < rect.height + 1 &&
            (!hasVisibleText || (rect.x >= n.bbox.x - 0.2 && rect.x <= n.bbox.x + n.bbox.w + 0.2))), 'caret belongs to selected rendered note');
        }
        const wasm = new Bridge(doc), cursor = new Cursor(); let focused = false;
        Object.assign(cursor, { wasm, _headerFooterMode: 'none', _fnFormatRevision: 0, position: { sectionIndex: s, paragraphIndex: 0, charOffset: 0 }, clearSelection() {} });
        enterNoteEditing({ wasm, eventBus: { emit() {} } }, { cursor, textarea: { focus() { focused = true; } } }, s, 0, c);
        assert(cursor._footnoteMode && focused); assert.equal(cursor._fnSectionIdx, s); assert.equal(cursor._fnControlIdx, c);
        assert.deepEqual(cursor.rect, rect); uiEntries++;
      }
      for (const k of ['x', 'y', 'height']) assert(Number.isFinite(rect[k])); assert(rect.height > 0);
      return { info, rect };
    } catch (e) { if (e instanceof assert.AssertionError) throw e; return { error: String(e) }; }
  };
  const check = (stage, inner = 0, targets = f.targets) => {
    const bytes = d.exportHwpx(); fs.writeFileSync(path.join(out, f.case + '-' + stage + '.hwpx'), bytes, { flag: 'wx' });
    const cold = new M.HwpDocument(bytes);
    try {
      for (const [s, c] of targets) {
        const result = query(d, s, c, inner); assert.deepEqual(result, query(cold, s, c, inner));
        assert.deepEqual(JSON.parse(d.getFootnoteInfo(s, 0, c)), JSON.parse(cold.getFootnoteInfo(s, 0, c)));
        rows.push({ case: f.case, stage, section: s, control: c, inner, result });
      }
    } finally { cold.free(); }
  };
  try {
    check('before');
    for (const args of [[0xffffffff, 0, 0], [0, 0xffffffff, 0], [0, 0, 0xffffffff], [0, 0, 0]]) { assert.throws(() => d.getNoteEditInfo(...args)); negativeChecks++; }
    const initial = d.saveSnapshot();
    for (const [s, c] of f.targets) d.insertTextInFootnote(s, 0, c, 0, 2, 'ENTRY_X');
    assert.deepEqual(body(), initialBody, 'note typing preserves body');
    for (let i = 0; i < f.targets.length; i++) {
      const [s, c] = f.targets[i], expected = [...initialNotes[i]];
      expected[0] = expected[0].slice(0, 2) + 'ENTRY_X' + expected[0].slice(2);
      assert.deepEqual(JSON.parse(d.getFootnoteInfo(s, 0, c)).texts, expected, 'source-addressed note text');
    }
    check('typed'); const typed = d.saveSnapshot();
    for (const [s, c] of f.targets) d.splitParagraphInFootnote(s, 0, c, 0, 3);
    check('split', 1);
    for (const [s, c] of f.targets) d.mergeParagraphInFootnote(s, 0, c, 1);
    check('merged'); d.restoreSnapshot(initial); check('undo'); d.restoreSnapshot(typed); check('redo'); d.restoreSnapshot(initial); check('restored');
    d.discardSnapshot(initial); d.discardSnapshot(typed);
    const s = f.targets[0][0], inserted = JSON.parse(d.insertEndnote(s, 0, 0));
    check('inserted', 0, [[s, inserted.controlIdx]]);
  } finally { d.free(); }
}
const failedQueries = rows.filter(r => r.result.error).length;
const proof = { mode, engineSHA256: sha(fs.readFileSync(path.join(pkg, 'rhwp_bg.wasm'))), cases: fixtures.length, queries: rows.length, failedQueries, hwpxReopens: fixtures.length * 8, snapshotRestores: fixtures.length * 3, negativeChecks, uiAdapterEntries: uiEntries, rows, GUIVerified: false, scope: 'Existing entry/bridge/cursor methods with DOM adapter; actual keyboard/app QA remains separate.' };
fs.writeFileSync(path.join(out, 'proof.json'), JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
if (mode === 'baseline') assert(failedQueries > 0); else assert.equal(failedQueries, 0);
console.log(JSON.stringify({ ...proof, rows: undefined }));

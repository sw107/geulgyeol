// Public SDK checks, not actual app/IME QA. A separate Node PID checks saved files.
// observe|fixed PKG MANIFEST FRESH_OUTPUT [BASELINE_RAW]
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
const [mode, pkg, manifest, out, baselineFile] = process.argv.slice(2);
const coldWorker = mode === '--cold';
assert(coldWorker || ['observe', 'fixed'].includes(mode));
const read = p => JSON.parse(fs.readFileSync(p));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const M = await import(pathToFileURL(path.resolve(pkg, 'rhwp.js')));
M.initSync({ module: fs.readFileSync(path.join(pkg, 'rhwp_bg.wasm')) });
const rows = [], failures = [];
function flags(d, ctrl, para) {
  d.setShowControlCodes(ctrl); d.setShowParagraphMarks(para);
  assert.equal(d.getShowControlCodes(), ctrl); assert.equal(d.getShowParagraphMarks(), para);
}
function state(d, f) {
  const notes = JSON.parse(d.getFootnoteInfo(f.section, f.para, f.control));
  const body = Array.from({ length: d.getSectionCount() }, (_, s) =>
    Array.from({ length: d.getParagraphCount(s) }, (_, p) => d.getTextRange(s, p, 0, d.getParagraphLength(s, p))));
  const render = Array.from({ length: d.pageCount() }, (_, p) => JSON.parse(d.getPageRenderTree(p)));
  return { notes, bodySHA256: sha(JSON.stringify(body)), renderSHA256: sha(JSON.stringify(render)) };
}
function probe(d, f, offset, label) {
  const before = state(d, f), snapshot = d.saveSnapshot();
  const caret = JSON.parse(d.getCursorRectInNote(f.section, f.para, f.control, f.notePara, offset));
  let glyph;
  try {
    d.insertTextInFootnote(f.section, f.para, f.control, f.notePara, offset, '◇');
    const found = [];
    function walk(n, pageIndex) {
      if (n.type === 'TextRun' && n.text.includes('◇')) {
        assert(n.text.startsWith('◇'), 'independent probe glyph starts its symbol-font run');
        found.push({ pageIndex, x: n.bbox.x, y: n.bbox.y, text: n.text });
      }
      for (const c of n.children ?? []) walk(c, pageIndex);
    }
    for (let p = 0; p < d.pageCount(); p++) walk(JSON.parse(d.getPageRenderTree(p)), p);
    assert.equal(found.length, 1); glyph = found[0];
  } finally { d.restoreSnapshot(snapshot); d.discardSnapshot(snapshot); }
  assert.deepEqual(state(d, f), before, 'probe restores all source/render state');
  const deltaX = Math.abs(caret.x - glyph.x), aligned = caret.pageIndex === glyph.pageIndex && deltaX <= .615;
  const result = { label, offset, caret, insertionGlyph: glyph, deltaX, aligned, state: before };
  if (!aligned) failures.push({ case: f.case, ctrl: f.ctrl, para: f.paraMarks, ...result });
  return result;
}
if (coldWorker) {
  for (const saved of read(manifest)) {
    const d = new M.HwpDocument(fs.readFileSync(saved.path));
    try { flags(d, saved.f.ctrl, saved.f.paraMarks); rows.push({ key: saved.key, probe: probe(d, saved.f, saved.offset + 2, 'fresh-Node-PID-reopen') }); }
    finally { d.free(); }
  }
  fs.writeFileSync(out, JSON.stringify({ PID: process.pid, rows, failures }) + '\n', { flag: 'wx' });
} else {
  fs.mkdirSync(out); const saved = [], fixtures = read(manifest);
  for (const fixture of fixtures) for (const ctrl of [false, true]) for (const paraMarks of [false, true]) {
    assert.equal(sha(fs.readFileSync(fixture.path)), fixture.sha256);
    const f = { ...fixture, ctrl, paraMarks };
    for (let offset = 0; offset <= [...f.expectedText].length; offset++) {
      const key = `${f.case}-${+ctrl}-${+paraMarks}-${offset}`, d = new M.HwpDocument(fs.readFileSync(f.path));
      let initial, edited;
      try {
        flags(d, ctrl, paraMarks); initial = d.saveSnapshot();
        const before = probe(d, f, offset, 'before'), original = before.state;
        assert.equal(original.notes.texts[f.notePara], f.expectedText);
        d.insertTextInFootnote(f.section, f.para, f.control, f.notePara, offset, '◆😀');
        const expected = [...f.expectedText].slice(0, offset).join('') + '◆😀' + [...f.expectedText].slice(offset).join('');
        const after = probe(d, f, offset + 2, 'after');
        assert.equal(after.state.notes.texts[f.notePara], expected);
        assert.equal(after.state.bodySHA256, original.bodySHA256);
        const bytes = d.exportHwpx(), savedPath = path.join(out, key + '.hwpx');
        fs.writeFileSync(savedPath, bytes, { flag: 'wx' });
        saved.push({ key, path: savedPath, sha256: sha(bytes), f, offset });
        const reopened = new M.HwpDocument(bytes); let samePID;
        try { flags(reopened, ctrl, paraMarks); samePID = probe(reopened, f, offset + 2, 'same-Node-PID-reopen'); assert.deepEqual(samePID.state.notes, after.state.notes); assert.equal(samePID.state.bodySHA256, after.state.bodySHA256); }
        finally { reopened.free(); }
        edited = d.saveSnapshot(); d.restoreSnapshot(initial);
        const undo = probe(d, f, offset, 'undo'); assert.deepEqual(undo.state, original);
        d.restoreSnapshot(edited); const redo = probe(d, f, offset + 2, 'redo'); assert.deepEqual(redo.state, after.state);
        rows.push({ key, case: f.case, ctrl, paraMarks, offset, before, after, samePID, undo, redo, archiveSHA256: sha(bytes) });
      } finally { if (initial !== undefined) d.discardSnapshot(initial); if (edited !== undefined) d.discardSnapshot(edited); d.free(); }
    }
  }
  const savesFile = path.join(out, 'saves.json'), coldFile = path.join(out, 'cold.json');
  fs.writeFileSync(savesFile, JSON.stringify(saved) + '\n', { flag: 'wx' });
  const child = spawnSync(process.execPath, [path.resolve(process.argv[1]), '--cold', pkg, savesFile, coldFile], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
  assert.equal(child.status, 0, child.stderr); const cold = read(coldFile); assert.notEqual(cold.PID, process.pid);
  failures.push(...cold.failures);
  const baseline = baselineFile ? read(baselineFile) : null;
  for (const r of rows) {
    const fresh = cold.rows.find(x => x.key === r.key); assert(fresh); r.freshPID = fresh.probe;
    assert.deepEqual(r.freshPID.state, r.samePID.state);
    if (baseline) {
      const b = baseline.rows.find(x => x.key === r.key); assert(b);
      for (const stage of ['before', 'after', 'samePID', 'freshPID', 'undo', 'redo']) assert.deepEqual(r[stage].state, b[stage].state, r.key + ':' + stage + ':source/layout unchanged');
      assert.equal(r.archiveSHA256, b.archiveSHA256, 'serialized ZIP bytes unchanged');
    }
  }
  const report = { mode, GUIVerified: false, PID: process.pid, coldPID: cold.PID, WASMSHA256: sha(fs.readFileSync(path.join(pkg, 'rhwp_bg.wasm'))), cases: fixtures.length, flagCombinations: 4, positions: rows.length, probes: rows.length * 6, maxDeltaX: Math.max(...rows.flatMap(r => ['before', 'after', 'samePID', 'freshPID', 'undo', 'redo'].map(k => r[k].deltaX))), sourceLayoutAndArchivesEqualBaseline: !!baseline, failures, rows };
  fs.writeFileSync(path.join(out, 'raw.json'), JSON.stringify(report) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ ...report, rows: undefined, failures: failures.length }));
  if (mode === 'fixed') assert.equal(failures.length, 0, 'each caret must match a separately inserted glyph in all four display flag combinations');
}

// Real WASM SDK, source-XML oracle from the Native fixture generator, and an
// independent Native reopen of every WASM export. No GUI/Hancom assertion.
// node scripts/check-inline-master-pages.mjs PKG NATIVE_FIXTURES NATIVE_BINARY FRESH_OUTPUT
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const [pkg, fixtures, binary, output] = process.argv.slice(2);
assert(pkg && fixtures && binary && output);
fs.mkdirSync(output);
const wasm = fs.readFileSync(path.resolve(pkg, 'rhwp_bg.wasm'));
const {initSync, HwpDocument} = await import(pathToFileURL(path.resolve(pkg, 'rhwp.js')));
initSync({module: wasm});
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const cases = JSON.parse(fs.readFileSync(path.join(fixtures, 'input-manifest.json'))).cases;
const normalized = value => value.map(s => ({...s, controls: s.controls.map(c => ({...c,
  masters: c.para === 0 && c.masters.length === 0 ? s.outerMasters : c.masters}))}));
const viewText = (d, expected) => expected.map((s, si) => s.body.map((_, pi) =>
  d.getTextRange(si, pi, 0, d.getParagraphLength(si, pi))));
const state = d => ({text: d.getTextFileText(), hwpx: sha(d.exportHwpx()),
  svg: Array.from({length: d.pageCount()}, (_, i) => sha(d.renderPageSvg(i)))});
const exports = [];
let loads = 0, refused = 0, reopens = 0, restores = 0, exportRefusals = 0;
for (const row of cases) {
  const bytes = fs.readFileSync(row.path);
  assert.equal(sha(bytes), row.sha256);
  if (row.expectedError) {
    // A failed constructor must leave another live document intact.
    const held = new HwpDocument(fs.readFileSync(cases.find(c => !c.expectedError).path));
    try {
      const before = state(held);
      assert.throws(() => new HwpDocument(bytes));
      assert.deepEqual(state(held), before);
      refused++;
    } finally { held.free(); }
    continue;
  }
  const d = new HwpDocument(bytes);
  try {
    loads++;
    assert.deepEqual(viewText(d, row.expected), row.expected.map(s => s.body));
    const before = state(d), undo = d.saveSnapshot();
    for (const edited of [false, true]) {
      const expected = structuredClone(row.expected);
      if (edited) {
        const si = expected.length - 1, pi = expected[si].body.length - 1;
        const result = JSON.parse(d.insertText(si, pi, d.getParagraphLength(si, pi), ' EDIT'));
        assert.equal(result.ok, true);
        expected[si].body[pi] += ' EDIT';
      }
      for (const format of ['Hwp', 'Hwpx']) {
        if (row.hwpUnsupported && format === 'Hwp') {
          const sealed = state(d);
          assert.throws(() => d.exportHwp(), /owner/);
          assert.deepEqual(state(d), sealed);
          exportRefusals++;
          continue;
        }
        const report = d['export' + format + 'WithReport']();
        let data;
        try {
          assert.equal(JSON.parse(report.contentLoss()).count, 0);
          data = report.takeBytes();
        } finally { report.free(); }
        const label = `${row.label}${edited ? '-edited' : ''}-${format.toLowerCase()}`;
        const physicalHwp = structuredClone(row.expectedHwp ?? expected);
        if (edited && row.expectedHwp) physicalHwp.at(-1).body[physicalHwp.at(-1).body.length - 1] += ' EDIT';
        const wanted = format === 'Hwp' ? physicalHwp : expected;
        const file = path.join(output, `${label}.${format.toLowerCase()}`);
        fs.writeFileSync(file, data, {flag: 'wx'});
        const reopened = new HwpDocument(data);
        try {
          assert.deepEqual(viewText(reopened, wanted), wanted.map(s => s.body));
          reopens++;
        } finally { reopened.free(); }
        exports.push({label, file, sha256: sha(data), expected: normalized(wanted),
          expectedHwp: normalized(physicalHwp)});
      }
    }
    const after = state(d), redo = d.saveSnapshot();
    try {
      d.restoreSnapshot(undo); assert.deepEqual(state(d), before); restores++;
      d.restoreSnapshot(redo); assert.deepEqual(state(d), after); restores++;
    } finally { d.discardSnapshot(undo); d.discardSnapshot(redo); }
  } finally { d.free(); }
  assert.equal(sha(fs.readFileSync(row.path)), row.sha256);
}
const inspect = path.join(output, 'native-reopen');
const result = spawnSync(binary, ['inspect', inspect, ...exports.map(e => e.file)], {encoding: 'utf8'});
fs.writeFileSync(path.join(output, 'native-reopen.log'), (result.stdout ?? '') + (result.stderr ?? ''));
assert.equal(result.status, 0);
for (const row of exports) {
  const loaded = JSON.parse(fs.readFileSync(path.join(inspect, row.label + '-loaded.json')));
  assert.deepEqual(normalized(loaded), row.expected);
  for (const format of ['hwp', 'hwpx']) {
    const file = path.join(inspect, `${row.label}-${format}-reopened.json`);
    // Unsupported HWP projections are covered by the original WASM refusals.
    if (!fs.existsSync(file)) {
      assert.equal(format, 'hwp');
      assert.match(fs.readFileSync(path.join(inspect, `${row.label}-hwp-error.txt`), 'utf8'), /owner/);
      continue;
    }
    assert.deepEqual(normalized(JSON.parse(fs.readFileSync(file))), format === 'hwp' ? row.expectedHwp : row.expected);
  }
}
const proof = {engineSHA256: sha(wasm), loads, rejectedAmbiguousInputs: refused,
  exportRefusals, wasmReopens: reopens, snapshotRestores: restores,
  nativeVerification: JSON.parse(fs.readFileSync(path.join(inspect, 'counts.json'))),
  exports, GUIVerified: false};
fs.writeFileSync(path.join(output, 'proof.json'), JSON.stringify(proof, null, 2) + '\n', {flag:'wx'});
console.log(JSON.stringify({...proof, exports: exports.length}));

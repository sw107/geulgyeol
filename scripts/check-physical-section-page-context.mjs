// Live pagination must agree with a fresh document after an earlier physical section changes.
// Usage: node SCRIPT PKG FIXTURE_MANIFEST FRESH_OUTPUT baseline|fixed
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const [pkg, manifest, out, mode] = process.argv.slice(2);
assert(['baseline', 'fixed'].includes(mode));
fs.mkdirSync(out);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const M = await import(pathToFileURL(path.resolve(pkg, 'rhwp.js')));
M.initSync({ module: fs.readFileSync(path.join(pkg, 'rhwp_bg.wasm')) });
const walk = node => [node, ...(node.children ?? []).flatMap(walk)];
const text = node => walk(node).filter(n => n.type === 'TextRun').map(n => n.text ?? '').join('');
const frames = doc => Array.from({ length: doc.pageCount() }, (_, page) => {
  const tree = JSON.parse(doc.getPageRenderTree(page));
  return { info: JSON.parse(doc.getPageInfo(page)), decorations: tree.children
    .filter(n => ['MasterPage', 'Header', 'Footer'].includes(n.type))
    .map(n => ({ type: n.type, text: text(n) })) };
});
const body = (doc, count) => Array.from({ length: count }, (_, si) =>
  Array.from({ length: doc.getParagraphCount(si) }, (_, pi) =>
    doc.getTextRange(si, pi, 0, doc.getParagraphLength(si, pi))));
const fixtures = JSON.parse(fs.readFileSync(manifest));
const rows = [];
let comparisons = 0, mismatches = 0, reopens = 0, hwpReopens = 0, restores = 0;
for (const fixture of fixtures) {
  const bytes = fs.readFileSync(fixture.path);
  assert.equal(sha(bytes), fixture.sha256);
  const d = new M.HwpDocument(bytes);
  const originalBody = body(d, fixture.sections);
  const start = d.getParagraphLength(fixture.target, 0);
  const added = ' first-owner continuation 가나다라 abcdef '.repeat(160);
  const check = stage => {
    const live = frames(d), liveBody = body(d, fixture.sections);
    const exported = d.exportHwpx();
    fs.writeFileSync(path.join(out, fixture.case + '-' + stage + '.hwpx'), exported, { flag: 'wx' });
    const cold = new M.HwpDocument(exported);
    try {
      const fresh = frames(cold);
      assert.deepEqual(body(cold, fixture.sections), liveBody, 'exported body');
      if (fixture.crossFormatHwp) {
        const hwpBytes = d.exportHwp();
        fs.writeFileSync(path.join(out, fixture.case + '-' + stage + '.hwp'), hwpBytes, { flag: 'wx' });
        const hwp = new M.HwpDocument(hwpBytes);
        try {
          assert.deepEqual(body(hwp, fixture.sections), liveBody, 'HWP body');
          assert.deepEqual(frames(hwp), fresh, 'both format reopens agree on page context');
          hwpReopens++;
        } finally { hwp.free(); }
      }
      for (let si = 0; si < fixture.sections; si++) {
        if (si !== fixture.target) assert.deepEqual(liveBody[si], originalBody[si], 'untouched section text');
      }
      if (fixture.numberingOracle) {
        let last = 0;
        for (let si = 0; si < fixture.sections; si++) {
          const pages = fresh.filter(p => p.info.sectionIndex === si);
          const start = fixture.restart && si === 1 ? 7 : last + 1;
          assert.deepEqual(pages.map(p => p.info.pageNumber), pages.map((_, i) => start + i), 'independent section numbering');
          last = pages.at(-1).info.pageNumber;
          for (const page of pages) {
            const odd = page.info.pageNumber % 2 === 1;
            if (si > 0) assert.deepEqual(page.decorations.filter(n => n.type === 'MasterPage').map(n => n.text),
              ['MASTER_' + (odd ? 1 : 0)], 'independent odd/even master selection');
            if (fixture.mirrored && si > 0) assert.equal(page.info.bindingMirrored, !odd, 'facing-page binding follows final parity');
            if (fixture.headers) for (const type of ['Header', 'Footer'])
              assert.equal(page.decorations.find(n => n.type === type)?.text,
                type.toUpperCase() + '_' + (odd ? 'ODD' : 'EVEN'), 'inherited decoration parity');
          }
        }
      }
      assert.deepEqual(frames(d), live, 'export does not mutate live pagination');
      const equal = JSON.stringify(live) === JSON.stringify(fresh);
      comparisons++; reopens++; if (!equal) mismatches++;
      rows.push({ case: fixture.case, stage, equal, live, cold: fresh });
      if (stage === 'before' || stage === 'restored') assert(equal, fixture.case + ' ' + stage);
      if (stage === 'grown' || stage === 'regrown') {
        const old = rows.find(r => r.case === fixture.case && r.stage === 'before');
        assert(live.filter(p => p.info.sectionIndex === fixture.target).length >
          old.live.filter(p => p.info.sectionIndex === fixture.target).length, 'growth must add pages');
      }
    } finally { cold.free(); }
  };
  try {
    check('before');
    const snapshot = d.saveSnapshot();
    d.insertText(fixture.target, 0, start, added); check('grown');
    d.deleteText(fixture.target, 0, start, [...added].length); check('shrunk');
    d.insertText(fixture.target, 0, start, added); check('regrown');
    d.restoreSnapshot(snapshot); restores++; check('restored');
    d.discardSnapshot(snapshot);
  } finally { d.free(); }
}
const proof = { mode, engineSHA256: sha(fs.readFileSync(path.join(pkg, 'rhwp_bg.wasm'))),
  cases: fixtures.length, comparisons, mismatches, reopens, hwpReopens, snapshotRestores: restores, rows,
  crossFormatHwpExcluded: fixtures.filter(f => !f.crossFormatHwp).map(f => f.case),
  crossFormatLimit: 'Three-physical-section shared-master HWP conversion differs already in the merged baseline; not certified or repaired by this cache change. Exact reviewer fixtures test HWPX only.',
  GUIVerified: false };
fs.writeFileSync(path.join(out, 'proof.json'), JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
if (mode === 'baseline') assert(mismatches > 0, 'baseline must reproduce inherited cache P2');
else assert.equal(mismatches, 0, 'live page context must equal fresh reopen');
console.log(JSON.stringify({ ...proof, rows: undefined }));

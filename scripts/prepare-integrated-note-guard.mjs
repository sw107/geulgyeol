// Add long source-addressed endnotes to unsafe single-Even controls. Fresh outputs only.
// node SCRIPT PKG OLD_ROOT FRESH_OUT
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const [pkg, root, out] = process.argv.slice(2);
fs.mkdirSync(out);
const read = file => JSON.parse(fs.readFileSync(file));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const M = await import(pathToFileURL(path.resolve(pkg, 'rhwp.js')));
M.initSync({ module: fs.readFileSync(path.join(pkg, 'rhwp_bg.wasm')) });
const guard = read(path.join(root, 'single-even-hwp-rejection/fixtures-2/manifest.json'));
const flow = read(path.join(root, 'endnote-text-continuations/fixtures3/manifest.json'));
const preserved = read(path.join(root, 'endnote-text-continuations/preserved-minimal-manifest.json'));
const cursor = read(path.join(root, 'pr88-cursor-fragments/cursor-manifest.json'));
const cross = [];
for (const name of ['two-odd-even-restart3', 'one-even']) {
  const original = guard.find(f => f.case === name);
  assert(original?.rejectHwp);
  const input = fs.readFileSync(original.path); assert.equal(sha(input), original.sha256);
  const doc = new M.HwpDocument(input);
  try {
    const inserted = JSON.parse(doc.insertEndnote(0, 0, 0));
    assert(inserted.ok);
    const control = inserted.controlIdx;
    doc.insertTextInFootnote(0, 0, control, 0, 0, 'CROSS_한글😀');
    const bytes = doc.exportHwpx(), file = path.join(out, name + '-note.hwpx');
    fs.writeFileSync(file, bytes, { flag: 'wx' });
    const source = { section: 0, para: 0, control };
    const fixture = { case: name + '-note', path: file, sha256: sha(bytes), targets: [source],
      actions: [{ ...source, notePara: 0, text: 'CROSS_한글😀 '.repeat(1200) }], expectedPages: null };
    cross.push(fixture);
    guard.push({ ...original, case: fixture.case, path: file, sha256: fixture.sha256, rejectHwp: true });
  } finally { doc.free(); }
}
const donors = [...flow, ...preserved].filter(f => ['different-widths', 'narrow-to-wide', 'multiple-donors', 'preserved-minimal-two'].includes(f.case))
  .map(f => ({ ...f, targets: f.case === 'multiple-donors' ? f.targets.filter(t => t.section < 2) : f.targets }));
assert.equal(donors.reduce((n, f) => n + f.targets.length, 0), 5);
for (const [name, rows] of Object.entries({ guard, flow: [...flow, ...cross], cursor: [...cursor, ...preserved, ...cross], donors: [...donors, ...cross] })) {
  fs.writeFileSync(path.join(out, name + '-manifest.json'), JSON.stringify(rows, null, 2) + '\n', { flag: 'wx' });
}
console.log(JSON.stringify({ originalBlockedDonorTargets: 5, newCrossCases: cross.length, guardCases: guard.length, flowCases: flow.length + cross.length, cursorCases: cursor.length + preserved.length + cross.length }));

// Current WASM only; no new comment authoring, GUI, or physical IME claim.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
const [pkg, fixtures, out] = process.argv.slice(2);
fs.mkdirSync(out, {recursive: true});
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const wasm = fs.readFileSync(path.join(pkg, 'rhwp_bg.wasm'));
const {initSync, HwpDocument} = await import(pathToFileURL(path.resolve(pkg, 'rhwp.js')));
initSync({module: wasm});
const manifest = [], rows = [];
let refused = 0, saves = 0, undo = 0, redo = 0;
const cases = ['known.hwp', 'known.hwpx', 'multi-section.hwp', 'tail-unknown.hwp',
  'list-time.hwp', 'control-time.hwp', 'duplicate-index.hwp', 'orphan-index.hwp',
  'typed-time.hwpx', 'root-unknown.hwp', 'header-flags.hwp', 'header-time.hwp', 'invalid-utf16.hwp', 'author-slash.hwp', 'invalid-marker.hwp', 'invalid-command.hwp'];
const state = d => ({fields: d.getFieldList(), text: d.getTextFileText(), info: d.getDocumentInfo()});
function save(d, kind, file, canSave) {
  const before = state(d), events = d.getEventLog();
  if (!canSave) {
    assert.throws(() => kind === 'hwp' ? d.exportHwpWithReport() : d.exportHwpxWithReport(), /보존|저장|메모/);
    assert.deepEqual(state(d), before); assert.equal(d.getEventLog(), events); refused++; return;
  }
  const artifact = kind === 'hwp' ? d.exportHwpWithReport() : d.exportHwpxWithReport();
  try {
    const report = JSON.parse(artifact.contentLoss()); assert.equal(report.count, 0);
    const bytes = artifact.takeBytes(); fs.writeFileSync(file, bytes);
    const reopened = new HwpDocument(bytes);
    try {
      assert.deepEqual(state(reopened), before);
    } finally { reopened.free(); }
    saves++;
  } finally { artifact.free(); }
  assert.deepEqual(state(d), before); assert.equal(d.getEventLog(), events);
}
for (const inputName of cases) {
  const input = path.resolve(fixtures, inputName), bytes = fs.readFileSync(input);
  const d = new HwpDocument(bytes);
  try {
    const known = inputName.startsWith('known.') || inputName === 'multi-section.hwp';
    const typed = inputName === 'typed-time.hwpx', invalid = inputName === 'invalid-marker.hwp';
    const baseline = state(d), old = d.saveSnapshot();
    const getBytes = () => typed ? d.exportHwpx() : d.exportHwp();
    const originalHash = sha(getBytes());
    for (const kind of ['hwp', 'hwpx']) {
      const file = path.resolve(out, inputName + '-unchanged.' + kind);
      const allowed = kind === 'hwp' ? !typed : known || typed;
      save(d, kind, file, allowed);
      if (allowed) manifest.push({input, file, edited: false});
    }
    d.insertText(0, 0, 0, '본문 수정🙂'); const changed = state(d), newer = d.saveSnapshot();
    for (const kind of ['hwp', 'hwpx']) {
      const file = path.resolve(out, inputName + '-edited.' + kind);
      const allowed = kind === 'hwp' ? !typed && !invalid : known || typed;
      save(d, kind, file, allowed);
      if (allowed) manifest.push({input, file, edited: true});
    }
    d.restoreSnapshot(old); assert.deepEqual(state(d), baseline); assert.equal(sha(getBytes()), originalHash); undo++;
    d.restoreSnapshot(newer); assert.deepEqual(state(d), changed); redo++;
    d.restoreSnapshot(old); d.discardSnapshot(old); d.discardSnapshot(newer);
    rows.push({inputName, genericBodyEditUndoRedo: true, commentAuthoringTested: false});
  } finally { d.free(); }
}
fs.writeFileSync(path.join(fixtures, 'wasm-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
const proof = {wasmSHA256: sha(wasm), cases: rows.length, saves, atomicExportRefusals: refused,
  undo, redo, originalSnapshotBytesRestored: true, commentAuthoringImplemented: false,
  GUIVerified: false, physicalIMEVerified: false, externalOpens: 0, rows};
fs.writeFileSync(path.join(out, 'proof.json'), JSON.stringify(proof, null, 2) + '\n');
console.log(JSON.stringify({...proof, rows: undefined}));

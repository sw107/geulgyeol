// Strict public-WASM regression. No JSON repair and no GUI/IME claim.
// node scripts/check-note-control-text.mjs observe|fixed PKG SEED FRESH_OUTPUT
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const [mode, pkg, seed, out] = process.argv.slice(2);
assert(['observe', 'fixed'].includes(mode));
fs.mkdirSync(out);
const M = await import(pathToFileURL(path.resolve(pkg, 'rhwp.js')));
M.initSync({module: fs.readFileSync(path.join(pkg, 'rhwp_bg.wasm'))});
const source = fs.readFileSync(seed), rows = [], failures = [];
const sha = b => createHash('sha256').update(b).digest('hex');
const cases = [
  ['empty', ''], ['plain', 'A한😀B'], ['tab', 'A\t한😀B'],
  ['lf', 'A\n한😀B'], ['cr', 'A\r한😀B'], ['crlf', 'A\r\n한😀B'],
  ['literal', 'A\\t\\n\\r"\\한😀B'],
];
function fixture(kind) {
  const d = new M.HwpDocument(source);
  d.createBlankDocument();
  d.insertText(0, 0, 0, '본문😀');
  const ci = JSON.parse(kind === 'footnote' ? d.insertFootnote(0, 0, 1) : d.insertEndnote(0, 0, 1)).controlIdx;
  // Blank notes include the editor's existing automatic-number placeholder spaces.
  const seedText = JSON.parse(d.getFootnoteInfo(0, 0, ci)).texts[0];
  return {d, ci, seedText};
}
function inspect(d, ci, texts, label) {
  const raw = d.getFootnoteInfo(0, 0, ci);
  const expected = {ok:true, paraCount:texts.length, totalTextLen:texts.reduce((n,t)=>n+[...t].length,0), number:1, texts};
  let parsed, error;
  try {
    parsed = JSON.parse(raw);
    assert.deepEqual(parsed, expected);
    // These fields retain the previous byte ordering and compact JSON shape.
    assert.equal(raw, JSON.stringify(expected));
  } catch (e) {
    error = String(e);
    failures.push({label, error, raw, expected});
  }
  const pages = Array.from({length:d.pageCount()}, (_,i) => JSON.parse(d.getPageRenderTree(i)));
  return {raw, parsed, error, pages};
}
for (const kind of ['footnote', 'endnote']) {
  for (const [name, text] of cases) {
    const {d, ci, seedText} = fixture(kind);
    let initial, edited;
    try {
      d.splitParagraphInFootnote(0, 0, ci, 0, 0);
      d.splitParagraphInFootnote(0, 0, ci, 1, 0);
      d.insertTextInFootnote(0, 0, ci, 2, 0, '둘째"\\😀');
      const before = ['', '', '둘째"\\😀'+seedText];
      initial = d.saveSnapshot();
      d.insertTextInFootnote(0, 0, ci, 0, 0, text);
      edited = d.saveSnapshot();
      for (const [stage, snapshot, texts] of [
        ['before', initial, before], ['grown', edited, [text,...before.slice(1)]],
        ['undo', initial, before], ['redo', edited, [text,...before.slice(1)]],
      ]) {
        d.restoreSnapshot(snapshot);
        const label = `${kind}-${name}-${stage}`, beforeInfo = d.exportHwpx();
        const live = inspect(d, ci, texts, label+'-live');
        const bytes = d.exportHwpx();
        // Querying info must not mutate persisted document content.
        assert.deepEqual(bytes, beforeInfo);
        fs.writeFileSync(path.join(out, label+'.hwpx'), bytes, {flag:'wx'});
        const cold = new M.HwpDocument(bytes);
        try {
          const reopened = inspect(cold, ci, texts, label+'-cold');
          const secondBytes = cold.exportHwpx(), second = new M.HwpDocument(secondBytes);
          try {
            const secondView = inspect(second, ci, texts, label+'-second');
            rows.push({kind, name, stage, texts, archiveSHA256:sha(bytes), live, cold:reopened, second:secondView});
          } finally { second.free(); }
        } finally { cold.free(); }
      }
      d.restoreSnapshot(edited);
      d.deleteTextInFootnote(0, 0, ci, 0, 0, [...text].length);
      inspect(d, ci, before, `${kind}-${name}-delete`);
    } finally {
      if (initial !== undefined) d.discardSnapshot(initial);
      if (edited !== undefined) d.discardSnapshot(edited);
      d.free();
    }
  }
  // JSON accepts every C0 value. Most are invalid in XML 1.0, so do not export.
  const {d, ci, seedText} = fixture(kind);
  try {
    const text = Array.from({length:32},(_,i)=>String.fromCodePoint(i)).join('')+'한😀"\\';
    d.insertTextInFootnote(0, 0, ci, 0, 0, text);
    rows.push({kind,name:'all-c0-getter-only',live:inspect(d,ci,[text+seedText],kind+'-all-c0')});
  } finally { d.free(); }
}
const report = {mode, GUIVerified:false, HancomVerified:false,
  historyKind:'SDK snapshots; application CommandHistory not exercised',
  WASMSHA256:sha(fs.readFileSync(path.join(pkg,'rhwp_bg.wasm'))),
  seedSHA256:sha(source), cases:cases.length*2, stages:cases.length*2*4,
  getterOnlyCases:2, failures, rows};
fs.writeFileSync(path.join(out,'raw.json'), JSON.stringify(report)+'\n', {flag:'wx'});
console.log(JSON.stringify({...report,rows:undefined,failures:failures.length}));
if (mode === 'fixed') assert.equal(failures.length, 0, 'all public JSON/text checks must pass');

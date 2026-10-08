import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';
const [engine, out, sourceArg] = process.argv.slice(2);
fs.mkdirSync(out, {
  recursive: true
});
const {
  initSync,
  HwpDocument
} = await import(pathToFileURL(path.resolve(engine, 'rhwp.js')));
const wb = fs.readFileSync(path.join(engine, 'rhwp_bg.wasm'));
initSync({
  module: wb
});
const source = fs.readFileSync(sourceArg ?? 'rhwp-studio/src/engine/input-handler.ts', 'utf8');
const method = n => {
  let a = source.indexOf('  ' + n + '(');
  if (a < 0) a = source.indexOf('  private ' + n + '(');
  assert(a >= 0, n);
  return source.slice(a, source.indexOf('\n  }\n', a) + 4) + '\n';
};
let probe = 'export class Probe {\n';
for (const n of ['toggleFormat', 'applyToggleFormat', 'getSelectedCellBlock', 'getCharPropertiesAtCursor', 'getNonEmptySelection', 'applyCharFormat']) probe += method(n);
probe += '}';
const {
  Probe
} = await import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(probe, {
  mode: 'transform'
})).toString('base64'));
const d = HwpDocument.createEmpty();
d.createBlankDocument();
d.insertText(0, 0, 0, '본문 보존😀');
const note = JSON.parse(d.insertFootnote(0, 0, 2));
d.insertTextInFootnote(0, note.paraIdx, note.controlIdx, 0, 2, '각주 선택😀 혼합');
const h = new Probe(),
  calls = [];
Object.assign(h, {
  cursor: {
    isInHeaderFooter: () => false,
    isInFootnote: () => true,
    isInCellSelectionMode: () => false,
    getPosition: () => ({
      sectionIndex: 0,
      paragraphIndex: 0,
      charOffset: 1
    }),
    getSelectionOrdered: () => null,
    getFootnoteSelectionOrdered: () => ({
      start: {
        fnParaIdx: 0,
        charOffset: 2
      },
      end: {
        fnParaIdx: 0,
        charOffset: 6
      },
      pageNum: 0,
      footnoteIndex: 0
    }),
    fnSectionIdx: 0,
    fnParaIdx: note.paraIdx,
    fnControlIdx: note.controlIdx
  },
  wasm: {
    getCharPropertiesAt: (...a) => JSON.parse(d.getCharPropertiesAt(...a))
  },
  executeOperation: o => calls.push(o)
});
const svg = d.renderPageSvg(0),
  before = d.exportHwpx();
for (const p of ['bold', 'italic']) h.toggleFormat(p);
assert.equal(calls.length, 0);
assert.equal(d.renderPageSvg(0), svg);
assert.deepEqual(d.exportHwpx(), before);
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
fs.writeFileSync(path.join(out, 'input.hwpx'), before);
const proof = {
  blockedRequests: 2,
  operationCount: 0,
  unchangedHwpxAndSVG: true,
  missingRangeAPI: typeof HwpDocument.prototype.applyCharFormatInFootnote !== 'function',
  inputHandlerSHA256: sha(source),
  engineSHA256: sha(wb),
  note,
  GUIVerified: false
};
assert(proof.missingRangeAPI);
fs.writeFileSync(path.join(out, 'proof.json'), JSON.stringify(proof, null, 2));
console.log(JSON.stringify(proof));
d.free();

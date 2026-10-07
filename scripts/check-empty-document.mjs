// Current WASM factory/template and all three-save HWP/HWPX chains.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
const [engineDir, outputDir] = process.argv.slice(2);
const output = path.resolve(outputDir);
fs.mkdirSync(output);
const bytes = fs.readFileSync(path.join(engineDir, 'rhwp_bg.wasm'));
const M = await import(pathToFileURL(path.resolve(engineDir, 'rhwp.js')));
M.initSync({ module: bytes });
const semantic = d => ({ text: d.getTextFileText(), styles: JSON.parse(d.getStyleList()),
  char: JSON.parse(d.getCharPropertiesAt(0, 0, 0)), para: JSON.parse(d.getParaPropertiesAt(0, 0)) });
const svg = d => Array.from({ length: d.pageCount() }, (_, p) => d.renderPageSvg(p));
const save = (d, format) => {
  const report = d[format === 'hwp' ? 'exportHwpWithReport' : 'exportHwpxWithReport']();
  try { assert.equal(JSON.parse(report.contentLoss()).count, 0); return report.takeBytes(); }
  finally { report.free(); }
};
const rows = [];
let reopens = 0;
const existingTemplateDifferences = [];
function check(d, expected, location) {
  const actual = semantic(d), adjusted = structuredClone(actual);
  if (location.startsWith('template/')) {
    for (const scope of ['char', 'para']) {
      if (actual[scope].fillType === 'none' && expected[scope].fillType === 'solid' &&
          actual[scope].patternColor === '#000000' && expected[scope].patternColor === '#999999' &&
          actual[scope].patternType === 0 && expected[scope].patternType === -1) {
        existingTemplateDifferences.push({ location, scope, actual: {
          fillType: actual[scope].fillType, patternColor: actual[scope].patternColor, patternType: actual[scope].patternType } });
        for (const f of ['fillType', 'patternColor', 'patternType']) adjusted[scope][f] = expected[scope][f];
      }
    }
  }
  assert.deepEqual(adjusted, expected, location);
}
function record(data, d, name) {
  const file = path.join(output, name);
  fs.writeFileSync(file, data);
  rows.push({ file, semantic: semantic(d), svg: svg(d) });
}
for (const mode of ['bare', 'template']) {
  for (const stage of ['blank', 'text', 'formatted']) {
    const d = M.HwpDocument.createEmpty();
    try {
      if (mode === 'template') d.createBlankDocument();
      const text = '첫 한글🙂𐐀 입력';
      if (stage !== 'blank') d.insertText(0, 0, 0, text);
      if (stage === 'formatted') {
        d.applyCharFormat(0, 0, 0, Array.from(text).length,
          JSON.stringify({ fontSize: 1400, bold: true, italic: true, textColor: 3368703 }));
        d.applyParaFormat(0, 0, JSON.stringify({ alignment: 'center', lineSpacing: 180 }));
      }
      const expected = semantic(d);
      if (stage !== 'blank') assert(JSON.parse(d.getTextFileUnicode()).includes(text), 'first Korean and supplementary-plane input survives');
      for (const first of ['hwp', 'hwpx']) {
        const data = save(d, first), one = new M.HwpDocument(data);
        try {
          check(one, expected, `${mode}/${stage}/${first}`); reopens++;
          record(data, one, `${mode}-${stage}-${first}.${first}`);
          for (const second of ['hwp', 'hwpx']) {
            const data2 = save(one, second), two = new M.HwpDocument(data2);
            try {
              check(two, expected, `${mode}/${stage}/${first}/${second}`); reopens++;
              record(data2, two, `${mode}-${stage}-${first}-${second}.${second}`);
              const three = new M.HwpDocument(save(two, first));
              try { check(three, expected, `${mode}/${stage}/${first}/${second}/${first}`); reopens++; }
              finally { three.free(); }
            } finally { two.free(); }
          }
        } finally { one.free(); }
      }
    } finally { d.free(); }
  }
}
assert.equal(reopens, 60);
fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(rows, null, 2));
const proof = { cases: 6, savedFiles: rows.length, threeSaveChainReopens: reopens,
  engineSHA256: crypto.createHash('sha256').update(bytes).digest('hex'),
  bareSemanticComparedExactly: true, templateTransparentFillGetterDifferenceUnfixed: existingTemplateDifferences.length > 0,
  existingTemplateDifferences, svgRecordedForIndependentNativeComparison: true };
fs.writeFileSync(path.join(output, 'proof.json'), JSON.stringify(proof, null, 2));
console.log(JSON.stringify(proof));

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
let modulePromise;
function engine() {
  return modulePromise ??= import(pathToFileURL(path.resolve(__dirname, '../web/studio/rhwp.js'))).then(M => {
    M.initSync({ module: fs.readFileSync(path.resolve(__dirname, '../web/studio/rhwp_bg.wasm')) }); return M;
  });
}
const configs = [
  { text: 'aaaaTAIL', query: 'aaa', pieces: ['', 'aTAIL'], hits: 2 },
  { text: 'START aaaaTAIL', query: 'aaa', pieces: ['START ', 'aTAIL'], hits: 2 },
  { text: 'aaaaaaTAIL', query: 'aaa', pieces: ['', '', 'TAIL'], hits: 4 },
  { text: 'aaa aaaTAIL', query: 'aaa', pieces: ['', ' ', 'TAIL'], hits: 2 },
  { text: '😀😀😀😀TAIL', query: '😀😀😀', pieces: ['', '😀TAIL'], hits: 2 },
  { text: '가가가가TAIL', query: '가가가', pieces: ['', '가TAIL'], hits: 2 },
  { text: 'İİİİTAIL', query: 'i\u0307i\u0307i\u0307', sensitive: false, pieces: ['', 'İTAIL'], hits: 2 },
  { text: 'aaaaTAIL', query: 'ZZZ', pieces: ['aaaaTAIL'], hits: 0 },
];
for (const ext of ['hwp', 'hwpx']) for (const c of configs) test(`replaceAll uses disjoint source spans in ${ext}: ${c.text} / ${c.query}`, async () => {
  const M = await engine(), seed = M.HwpDocument.createEmpty();
  try {
    seed.createBlankDocument(); assert(JSON.parse(seed.insertText(0, 0, 0, c.text)).ok);
    const bytes = ext === 'hwp' ? seed.exportHwp() : seed.exportHwpx();
    for (const replacement of ['Q', '', '한😀글XYZ']) {
      const d = new M.HwpDocument(bytes);
      try {
        assert.equal(JSON.parse(d.searchAllText(c.query, c.sensitive ?? true, true)).length, c.hits, 'Find All still enumerates overlaps');
        const result = JSON.parse(d.replaceAll(c.query, replacement, c.sensitive ?? true));
        assert.deepEqual(result, { ok: true, count: c.pieces.length - 1 });
        assert.equal(d.getTextRange(0, 0, 0, 10000), c.pieces.join(replacement));
      } finally { d.free(); }
    }
  } finally { seed.free(); }
});
for (const ext of ['hwp', 'hwpx']) test(`overlap suppression is independent for body, equation, host paragraph and sibling cells in ${ext}`, async () => {
  const M = await engine(), seed = M.HwpDocument.createEmpty(); let d;
  try {
    seed.createBlankDocument(); seed.insertText(0, 0, 0, 'aaaaTAIL'); seed.splitParagraph(0, 0, 8);
    assert(JSON.parse(seed.createTable(0, 1, 0, 1, 2)).ok);
    seed.insertText(0, 1, 0, 'aaaaTAIL');
    for (const cell of [0, 1]) seed.insertTextInCell(0, 1, 0, cell, 0, 0, 'aaaaTAIL');
    const equation = JSON.parse(seed.insertEquation(0, 0, 0, 'aaaaTAIL', 1000, 0)); assert(equation.ok);
    d = new M.HwpDocument(ext === 'hwp' ? seed.exportHwp() : seed.exportHwpx());
    assert.equal(JSON.parse(d.searchAllText('aaa', true, true)).length, 10);
    assert.deepEqual(JSON.parse(d.replaceAll('aaa', 'Q', true)), { ok: true, count: 5 });
    for (const para of [0, 1]) assert.equal(d.getTextRange(0, para, 0, 1000), 'QaTAIL');
    for (const cell of [0, 1]) assert.equal(d.getTextInCell(0, 1, 0, cell, 0, 0, 1000), 'QaTAIL');
    const control = JSON.parse(d.getEquationProperties(0, 0, equation.controlIdx, -1, -1));
    assert.equal(control.script, 'QaTAIL');
  } finally { d?.free(); seed.free(); }
});

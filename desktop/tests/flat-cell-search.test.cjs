const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

let modulePromise;
function engine() {
  return modulePromise ??= import(pathToFileURL(path.resolve(__dirname, '../web/studio/rhwp.js'))).then(M => {
    M.initSync({ module: fs.readFileSync(path.resolve(__dirname, '../web/studio/rhwp_bg.wasm')) });
    return M;
  });
}
function seed(M) {
  const d = M.HwpDocument.createEmpty();
  d.createBlankDocument();
  assert(JSON.parse(d.insertText(0, 0, 0, 'needle before')).ok);
  assert(JSON.parse(d.splitParagraph(0, 0, 13)).ok);
  assert.deepEqual(JSON.parse(d.createTable(0, 1, 0, 1, 2)), { ok: true, paraIdx: 1, controlIdx: 0 });
  assert(JSON.parse(d.insertTextInCell(0, 1, 0, 0, 0, 0, 'needle')).ok);
  assert(JSON.parse(d.splitParagraphInCell(0, 1, 0, 0, 0, 6)).ok);
  assert(JSON.parse(d.insertTextInCell(0, 1, 0, 0, 1, 0, 'needle')).ok);
  assert(JSON.parse(d.insertTextInCell(0, 1, 0, 1, 0, 0, 'needle')).ok);
  assert(JSON.parse(d.insertText(0, 2, 0, 'needle after')).ok);
  return d;
}
const cell = (cellIdx, cellPara = 0) => ({ parentPara: 1, ctrlIdx: 0, cellIdx, cellPara });
const addresses = [[0], [1, cell(0)], [1, cell(0, 1)], [1, cell(1)], [2]];
const address = h => [h.para, ...(h.cellContext ? [h.cellContext] : [])];

for (const ext of ['hwp', 'hwpx']) {
  for (const forward of [true, false]) test(`flat cells and body traverse and wrap in ${ext}, forward=${forward}`, async () => {
    const M = await engine(), original = seed(M);
    let d;
    try {
      d = new M.HwpDocument(ext === 'hwp' ? original.exportHwp() : original.exportHwpx());
      const before = Buffer.from(d.exportHwpx());
      let para = forward ? 0 : 2, offset = forward ? 0 : 6, context;
      for (let step = 0; step < addresses.length * 3; step++) {
        const h = JSON.parse(d.searchText('needle', 0, para, offset, forward, true, true, context && JSON.stringify(context)));
        const index = forward ? step % addresses.length : addresses.length - 1 - step % addresses.length;
        assert(h.found);
        assert.deepEqual(address(h), addresses[index]);
        assert.equal(h.wrapped, step > 0 && step % addresses.length === 0);
        para = h.para; offset = h.charOffset + (forward ? h.length : 0); context = h.cellContext;
      }
      assert.deepEqual(Buffer.from(d.exportHwpx()), before);
    } finally { d?.free(); original.free(); }
  });

  test(`body-only defaults and opt-in retain distinct scopes in ${ext}`, async () => {
    const M = await engine(), original = seed(M);
    let d;
    try {
      d = new M.HwpDocument(ext === 'hwp' ? original.exportHwp() : original.exportHwpx());
      for (const include of [undefined, false]) {
        const h = JSON.parse(d.searchText('needle', 0, 0, 6, true, true, include));
        assert.deepEqual(address(h), [2]);
      }
      const h = JSON.parse(d.searchText('needle', 0, 1, 99, true, true, true));
      assert.deepEqual(address(h), [1, cell(0)], 'body offset does not exclude cells at offset 0');
    } finally { d?.free(); original.free(); }
  });
}

test('invalid cell origins reject without modifying bytes or falling back to body', async () => {
  const M = await engine(), d = seed(M);
  try {
    const before = Buffer.from(d.exportHwpx());
    const invalid = [
      '', '{', 'null', '[]', '{}',
      JSON.stringify({ ...cell(0), cellIdx: -1 }),
      JSON.stringify({ ...cell(0), cellIdx: 0.5 }),
      JSON.stringify({ ...cell(0), cellIdx: '0' }),
      JSON.stringify({ ...cell(0), cellIdx: true }),
      JSON.stringify({ ...cell(0), cellIdx: 4294967296 }),
      JSON.stringify({ ...cell(0), ignored: 1 }),
      JSON.stringify({ ...cell(0), parentPara: 0 }),
      JSON.stringify({ ...cell(0), ctrlIdx: 99 }),
      JSON.stringify(cell(99)), JSON.stringify(cell(0, 99)), JSON.stringify(cell(65534)),
    ];
    for (const json of invalid) assert.throws(() => d.searchText('needle', 0, 1, 0, true, true, true, json));
    assert.throws(() => d.searchText('needle', 0, 1, 0, true, true, false, JSON.stringify(cell(0))));
    assert.throws(() => d.searchText('needle', 99, 1, 0, true, true, true, JSON.stringify(cell(0))));
    assert.throws(() => d.searchText('needle', 0, 0, 0, true, true, true, JSON.stringify({ ...cell(0), parentPara: 0 })), 'section/column definitions are not tables');
    assert.deepEqual(Buffer.from(d.exportHwpx()), before);
  } finally { d.free(); }
});

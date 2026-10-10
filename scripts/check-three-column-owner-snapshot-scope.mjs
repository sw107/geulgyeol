// Synthetic fixtures only; preserve historical two-column scope evidence.
// Usage: node scripts/check-three-column-owner-snapshot-scope.mjs WASM_PKG SEEDS_JSON FRESH_OUTPUT baseline|supported
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const [pkgArg, seedsArg, outArg, mode] = process.argv.slice(2);
assert(['baseline', 'supported'].includes(mode));
const pkg = path.resolve(pkgArg), out = path.resolve(outArg);
assert(!fs.existsSync(out), 'fresh output required');
fs.mkdirSync(out, { recursive: true });
const sha = b => createHash('sha256').update(b).digest('hex');
const engineBefore = sha(fs.readFileSync(path.join(pkg, 'rhwp_bg.wasm')));
const M = await import(pathToFileURL(path.join(pkg, 'rhwp.js')));
M.initSync({ module: fs.readFileSync(path.join(pkg, 'rhwp_bg.wasm')) });
const seeds = JSON.parse(fs.readFileSync(seedsArg));
assert.equal(seeds.length, 5);
const rows = [], sourcePins = new Map();
function target(d) {
  const t = JSON.parse(d.getControls()).find(t => t.ctrlId === 'tbl' && t.list === 0);
  assert(t); return t;
}
function state(d) {
  return { hwp: sha(d.exportHwp()), hwpx: sha(d.exportHwpx()),
    svg: Array.from({ length: d.pageCount() }, (_, i) => sha(d.renderPageSvg(i))) };
}
function check(d, t, expected, details) {
  const before = state(d), dim = JSON.parse(d.getTableDimensions(0, t.para, t.controlIndex));
  const actual = Array.from({ length: dim.cellCount }, (_, i) => i)
    .filter(i => d.mergedCellNeedsTextSnapshot(0, t.para, t.controlIndex, i));
  assert.deepEqual(actual, expected, JSON.stringify(details));
  assert.deepEqual(state(d), before, 'eligibility query must preserve exports and all SVGs');
  rows.push({ ...details, dimensions: dim, eligibleCells: actual, readOnly: true, state: before });
}
for (const seed of seeds) for (const ext of ['hwp', 'hwpx']) {
  const file = seed.files[ext], bytes = fs.readFileSync(file); sourcePins.set(file, sha(bytes));
  const d = new M.HwpDocument(bytes), t = target(d);
  try { check(d, t, mode === 'supported' ? seed.snapshotEligibleOwners : [],
    { group: seed.label, format: ext, scope: 'positive', mode }); } finally { d.free(); }
}
const seed = seeds.find(s => s.label === 'three-long-left'); assert(seed);
function malformedPlainGrid(d, kind) {
  const bytes = execFileSync('python3', ['-c', `import io,zipfile,sys,re
kind=sys.argv[1]
with zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())) as z: data={n:z.read(n) for n in z.namelist()}
s=data['Contents/section0.xml'].decode();changed=0
def cell(m):
 global changed
 v=m.group();a=re.search(r'<hp:cellAddr[^>]*colAddr="(\\d+)"[^>]*rowAddr="(\\d+)"',v)
 if not a or a.groups()!=('1','1'):return v
 changed+=1
 if kind=='gap':return ''
 if kind=='overlap':return v+v
 if kind=='row-range':return re.sub(r'(<hp:cellSpan[^>]*rowSpan=")[^"]*(")',lambda x:x.group(1)+'49'+x.group(2),v,count=1)
 if kind=='column-range':return re.sub(r'(<hp:cellAddr[^>]*colAddr=")[^"]*(")',lambda x:x.group(1)+'3'+x.group(2),v,count=1)
 raise AssertionError(kind)
s=re.sub(r'<hp:tc\\b.*?</hp:tc>',cell,s,flags=re.S);assert changed==1;data['Contents/section0.xml']=s.encode();b=io.BytesIO()
with zipfile.ZipFile(b,'w',zipfile.ZIP_DEFLATED) as z:
 for n,v in data.items():z.writestr(n,v)
sys.stdout.buffer.write(b.getvalue())`, kind], {input:d.exportHwpx()});
  const next=new M.HwpDocument(bytes),t=target(next),dim=JSON.parse(next.getTableDimensions(0,t.para,t.controlIndex));
  assert.equal(dim.rowCount,48);assert.equal(dim.colCount,3);
  const cells=Array.from({length:dim.cellCount},(_,i)=>JSON.parse(next.getCellInfo(0,t.para,t.controlIndex,i)));
  const cover=cells.filter(c=>c.col===1&&c.row<=1&&1<c.row+c.rowSpan).length;
  if(kind==='gap')assert.equal(cover,0);
  else if(kind==='overlap')assert.equal(cover,2);
  else if(kind==='row-range')assert(cells.some(c=>c.row===1&&c.col===1&&c.rowSpan===49));
  else assert(cells.some(c=>c.row===1&&c.col===3));
  return next;
}
const variants = [...[
  ['treatAsChar', true], ['allowOverlap', true], ['textWrap', 'Square'],
  ['vertRelTo', 'Para'], ['vertAlign', 'Bottom'], ['vertOffset', 1800],
  ['cellSpacing', 75], ['pageBreak', 0]
].map(([key, value]) => ({ name: key, mutate(d, t) {
  d.setTableProperties(0, t.para, t.controlIndex, JSON.stringify({ [key]: value }));
  if (key === 'vertOffset') {
    // Existing HWPX getter reports zero when raw_ctrl_data is absent; inspect
    // the actual exported common position rather than fabricate an assertion.
    const xml = execFileSync('python3', ['-c',
      'import sys,io,zipfile; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); sys.stdout.buffer.write(z.read("Contents/section0.xml"))'],
      { input: d.exportHwpx() }).toString();
    assert.equal(Number(xml.match(/<hp:pos\b[^>]*vertOffset="([^"]+)"/)[1]), value);
  } else assert.equal(JSON.parse(d.getTableProperties(0, t.para, t.controlIndex))[key], value);
}})), {
  name: 'vertical-body-owner', mutate(d, t) {
    const cell = seed.historyOwners[0];
    d.setCellProperties(0, t.para, t.controlIndex, cell, JSON.stringify({ textDirection: 1 }));
    assert.equal(JSON.parse(d.getCellProperties(0, t.para, t.controlIndex, cell)).textDirection, 1);
  }
}, {
  name: 'inconsistent-stored-column-width', mutate(d, t) {
    const cell = seed.historyOwners[0], old = JSON.parse(d.getCellProperties(0, t.para, t.controlIndex, cell)).width;
    d.setCellProperties(0, t.para, t.controlIndex, cell, JSON.stringify({ width: old + 75 }));
    assert.equal(JSON.parse(d.getCellProperties(0, t.para, t.controlIndex, cell)).width, old + 75);
    assert.equal(JSON.parse(d.getCellProperties(0, t.para, t.controlIndex, 0)).width, old);
  }
}, {
  name: 'colspan-two', mutate(d, t) {
    assert(JSON.parse(d.mergeTableCells(0, t.para, t.controlIndex, 1, 1, 1, 2)).ok);
    const dim = JSON.parse(d.getTableDimensions(0, t.para, t.controlIndex));
    assert(Array.from({ length: dim.cellCount }, (_, i) => JSON.parse(d.getCellInfo(0, t.para, t.controlIndex, i)))
      .some(c => c.colSpan === 2 && c.row === 1));
  }
}, {
  name: 'over-64-rows', mutate(d, t) {
    for (let i = 0; i < 18; i++) assert(JSON.parse(d.insertTableRow(0, t.para, t.controlIndex, 1, true)).ok);
    assert.equal(JSON.parse(d.getTableDimensions(0, t.para, t.controlIndex)).rowCount, 66);
  }
}, {
  name: 'fourth-column', mutate(d, t) {
    assert(JSON.parse(d.insertTableColumn(0, t.para, t.controlIndex, 0, true)).ok);
    assert.equal(JSON.parse(d.getTableDimensions(0, t.para, t.controlIndex)).colCount, 4);
  }
}, {
  name: 'vertical-header', mutate(d, t) {
    d.setCellProperties(0, t.para, t.controlIndex, 0, JSON.stringify({ textDirection: 1 }));
    assert.equal(JSON.parse(d.getCellProperties(0, t.para, t.controlIndex, 0)).textDirection, 1);
  }
}, {
  name: 'caption', mutate(d, t) {
    d.setTableProperties(0, t.para, t.controlIndex, JSON.stringify({ hasCaption: true }));
    assert.equal(JSON.parse(d.getTableProperties(0, t.para, t.controlIndex)).hasCaption, true);
  }
}, {
  name: 'runtime-local-width-override', mutate(d, t) {
    const cell = seed.historyOwners[0], old = JSON.parse(d.getCellProperties(0, t.para, t.controlIndex, cell)).width;
    assert(JSON.parse(d.resizeTableCells(0, t.para, t.controlIndex,
      JSON.stringify([{ cellIdx: cell, widthDelta: 0, localResize: true, renderWidth: old + 75 }]))).ok);
    assert.equal(JSON.parse(d.getCellProperties(0, t.para, t.controlIndex, cell)).width, old);
  }
}, {
  name: 'residual-common-width', mutate(d) {
    const bytes = execFileSync('python3', ['-c', `import io,zipfile,sys,re
with zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())) as z: data={n:z.read(n) for n in z.namelist()}
s=data['Contents/section0.xml'].decode()
def change(m):
 v=m.group();v,n=re.subn(r'(<hp:sz[^>]*width=")[^"]*(")',lambda x:x.group(1)+'21075'+x.group(2),v,count=1);assert n==1;return v
s,n=re.subn(r'<hp:tbl\\b.*?</hp:tbl>',change,s,count=1,flags=re.S);assert n==1;data['Contents/section0.xml']=s.encode()
b=io.BytesIO()
with zipfile.ZipFile(b,'w',zipfile.ZIP_DEFLATED) as z:
 for n,v in data.items():z.writestr(n,v)
sys.stdout.buffer.write(b.getvalue())`], { input: d.exportHwpx() });
    const next = new M.HwpDocument(bytes), t = target(next);
    assert.equal(JSON.parse(next.getTableProperties(0, t.para, t.controlIndex)).tableWidth, 21075);
    assert.equal(JSON.parse(next.getCellProperties(0, t.para, t.controlIndex, 0)).width, 7000);
    return next;
  }
}, ...['gap','overlap','row-range','column-range'].map(kind=>({name:'malformed-'+kind,mutate:d=>malformedPlainGrid(d,kind)}))];
for (const variant of variants) for (const ext of ['hwp', 'hwpx']) {
  let d = new M.HwpDocument(fs.readFileSync(seed.files[ext])), t = target(d);
  try { const next = variant.mutate(d, t); if (next) { d.free(); d = next; t = target(d); }
    check(d, t, [], { group: seed.label, format: ext, scope: 'excluded', variant: variant.name }); }
  finally { d.free(); }
}
for (const [file, pin] of sourcePins) assert.equal(sha(fs.readFileSync(file)), pin, 'fixture preserved');
assert.equal(sha(fs.readFileSync(path.join(pkg, 'rhwp_bg.wasm'))), engineBefore);
const proof = { mode, engineSHA256: engineBefore, positiveCases: 10, excludedCases: variants.length * 2,
  sourceFilesUnchanged: sourcePins.size, queryReadOnlyCases: rows.length, rows };
fs.writeFileSync(path.join(out, 'proof.json'), JSON.stringify(proof, null, 2) + '\n');
console.log(JSON.stringify({ mode, positiveCases: proof.positiveCases, excludedCases: proof.excludedCases,
  queryReadOnlyCases: rows.length, sourceFilesUnchanged: sourcePins.size }));

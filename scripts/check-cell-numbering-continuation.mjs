// Actual WASM, synthetic-only cell continuation matrix.
// node ... SDK FIXTURES FRESH_OUTPUT baseline|fixed [BASELINE_SDK]
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function engine(dir) {
  const M = await import(pathToFileURL(path.resolve(dir, 'rhwp.js')));
  M.initSync({module: fs.readFileSync(path.join(dir, 'rhwp_bg.wasm'))});
  return M;
}
export function observe(d, row, reverse = false) {
  const indices = Array.from({length: d.pageCount()}, (_, i) => i);
  if (reverse) indices.reverse();
  const runs = indices.flatMap(page => JSON.parse(d.getPageTextLayout(page)).runs.map(r => ({...r, page})));
  const bounds = new Map();
  for (const page of indices) for (const control of JSON.parse(d.getPageControlLayout(page)).controls) {
    if (control.type==='table' && control.paraIdx===row.parent && control.controlIdx===row.ci)
      for (const cell of control.cells) bounds.set(page+':'+cell.cellIdx,cell);
  }
  const cells = [];
  for (let cell = 0; cell < row.columns; cell++) {
    const owned = runs.filter(r => r.parentParaIdx === row.parent && r.controlIdx === row.ci && r.cellIdx === cell);
    const body = owned.filter(r => r.cellParaIdx === 1 && Number.isInteger(r.charStart) && r.text);
    for (const run of body) {
      const bound=bounds.get(run.page+':'+cell);assert(bound,'page-local cell bounds');
      assert(run.x>=bound.x-0.5 && run.x+run.w<=bound.x+bound.w+0.5,'horizontal text stays within cell');
    }
    const lines = new Map();
    for (const r of body) {
      const key = r.page + ':' + r.y, old = lines.get(key);
      if (!old || r.charStart < old.charStart) lines.set(key, r);
    }
    const starts = [...lines.values()].sort((a,b) => a.page - b.page || a.y - b.y);
    const first = starts.find(r => r.charStart === 0);
    assert(first, 'first long-paragraph line');
    const later = starts.filter(r => r.page > first.page);
    assert(later.length > 10, 'fixture must exercise a split paragraph');
    const markers = owned.filter(r => !Number.isInteger(r.charStart) && /^\d+\.$/.test(r.text))
      .sort((a,b) => a.cellParaIdx - b.cellParaIdx).map(r => ({text:r.text, paragraph:r.cellParaIdx, page:r.page, x:r.x}));
    assert.deepEqual(markers.map(r => r.text), ['123.', '124.', '125.']);
    assert.deepEqual(markers.map(r => r.paragraph), [0, 1, 2]);
    assert.equal(markers[1].page, first.page, 'marker only on initial paragraph fragment');
    const ordered = body.sort((a,b) => a.charStart - b.charStart);
    const paragraphTexts = [0,1,2].map(p=>d.getTextInCellByPath(0, row.parent,
      JSON.stringify([{controlIndex:row.ci,cellIndex:cell,cellParaIndex:p}]), 0, 1000000));
    const expected = paragraphTexts[1];
    assert.equal(ordered.map(r => r.text).join('').replace(/\s/g,''), expected.replace(/\s/g,''), 'emitted text exactly once');
    const target = row.bits & 8 ? first.x : markers[1].x;
    const mismatches = later.filter(r => Math.abs(r.x - target) > 0.15);
    cells.push({cell, firstX:first.x, targetX:target, firstPage:first.page,
      laterLines:later.map(r => ({page:r.page, x:r.x, y:r.y, charStart:r.charStart})),
      mismatchCount:mismatches.length, markers, textSHA256:sha(Buffer.from(expected)),
      paragraphTextSHA256:paragraphTexts.map(text=>sha(Buffer.from(text)))});
  }
  return {pages:d.pageCount(), cells};
}
async function main() {
const [sdk, fixtureDir, output, mode, baseline] = process.argv.slice(2);
assert(sdk && fixtureDir && output && ['baseline', 'fixed'].includes(mode) && !fs.existsSync(output));
fs.mkdirSync(output, {recursive: true});
const M = await engine(sdk), B = baseline ? await engine(baseline) : null;
const manifest = JSON.parse(fs.readFileSync(path.join(fixtureDir, 'manifest.json')));
assert.equal(manifest.length,16,'complete four-flag × two-table × two-wrap matrix');
assert.equal(new Set(manifest.map(r=>`${r.columns}:${r.wrap}:${r.bits}`)).size,16,'unique matrix entries');
const results = [];
const controls = [];
let reopens = 0;
try {
  for (const row of manifest) {
    const input = fs.readFileSync(path.join(fixtureDir, row.file));
    let d = new M.HwpDocument(input);
    try {
      const initial = observe(d, row);
      assert.deepEqual(observe(d, row, true), initial, 'page-query order');
      const coldReverse = new M.HwpDocument(input);
      try { assert.deepEqual(observe(coldReverse, row, true), initial, 'cold reverse page-query order'); }
      finally { coldReverse.free(); }
      for (const cell of initial.cells) {
        if (mode === 'baseline' && row.bits & 8) assert(cell.mismatchCount > 10, 'reproduce missing continuation area');
        else assert.equal(cell.mismatchCount, 0, row.file);
      }
      if (B) {
        const b = new B.HwpDocument(input);
        try {
          const old = observe(b, row);
          assert.equal(old.pages, initial.pages);
          for (let i = 0; i < old.cells.length; i++) {
            assert.deepEqual(old.cells[i].markers, initial.cells[i].markers);
            assert.equal(old.cells[i].textSHA256, initial.cells[i].textSHA256);
            assert.equal(old.cells[i].firstX, initial.cells[i].firstX);
          }
          if (!(row.bits & 8)) for (let page = 0; page < d.pageCount(); page++)
            assert.equal(d.renderPageSvg(page), b.renderPageSvg(page), 'autoIndent=0 exact SVG control');
        } finally { b.free(); }
      }
      const stages = [];
      for (const [i, ext] of ['Hwp', 'Hwpx', 'Hwp', 'Hwpx'].entries()) {
        const report = d['export' + ext + 'WithReport']();
        let bytes;
        try { assert.equal(JSON.parse(report.contentLoss()).count, 0); bytes = report.takeBytes(); }
        finally { report.free(); }
        fs.writeFileSync(path.join(output, row.file.replace('.hwpx', `-${i}.${ext.toLowerCase()}`)), bytes);
        d.free(); d = new M.HwpDocument(bytes);
        assert.deepEqual(observe(d, row, true), initial, 'alternating save/reopen');
        stages.push({ext, sha256:sha(bytes)}); reopens++;
      }
      results.push({...row, inputSHA256:sha(input), ...initial, stages});
      console.log('PASS ' + mode + ' ' + row.file + ' pages=' + initial.pages);
    } finally { d.free(); }
  }
  if (B) for (const columns of [1,2]) for (const kind of ['plain','bullet','vertical1','vertical2']) {
    const row=manifest.find(r=>r.columns===columns&&r.wrap==='hard'&&r.bits===12);
    const seed=new B.HwpDocument(fs.readFileSync(path.join(fixtureDir,row.file)));
    let bytes;
    try {
      for(let cell=0;cell<columns;cell++) {
        if(kind.startsWith('vertical')) seed.applyCellOwnPropertiesByPaths(0,row.parent,
          JSON.stringify([[{controlIndex:row.ci,cellIndex:cell,cellParaIndex:0}]]),JSON.stringify({textDirection:Number(kind.at(-1))}));
        else for(let p=0;p<3;p++) seed.applyParaFormatInCell(0,row.parent,row.ci,cell,p,
          JSON.stringify({headType:kind==='plain'?'None':'Bullet',numberingId:kind==='plain'?0:seed.ensureDefaultBullet('•')}));
      }
      bytes=seed.exportHwpx();
    } finally {seed.free();}
    const before=new B.HwpDocument(bytes),after=new M.HwpDocument(bytes);
    try {
      assert.equal(after.pageCount(),before.pageCount());
      for(let page=0;page<after.pageCount();page++)assert.equal(after.renderPageSvg(page),before.renderPageSvg(page),kind+' exact SVG');
      for(const ext of ['Hwp','Hwpx'])assert.deepEqual(after['export'+ext](),before['export'+ext](),kind+' wire bytes');
      controls.push({columns,kind,pages:after.pageCount(),exactSVG:true,exactWireBytes:true});
    } finally {before.free();after.free();}
  }
  fs.writeFileSync(path.join(output, 'proof.json'), JSON.stringify({mode, actualWASM:true,
    nativeAppUI:false, engineSHA256:sha(fs.readFileSync(path.join(sdk,'rhwp_bg.wasm'))), reopens, results, controls}, null, 2));
} catch (error) {
  fs.writeFileSync(path.join(output,'failure.json'), JSON.stringify({error:String(error),stack:error.stack,results},null,2));
  throw error;
}
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();

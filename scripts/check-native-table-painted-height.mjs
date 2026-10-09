// Compare native diagnostics against independently read painted frames.
// Usage: node scripts/check-native-table-painted-height.mjs QA_DIR WASM_DIR NATIVE_BINARY SAVED_MANIFEST
// The manifest is produced by the actual Electron host-spacing QA, not bundled source fixtures.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const [outArg, pkgArg, nativeArg, sourceArg] = process.argv.slice(2);
const out = path.resolve(outArg), pkg = path.resolve(pkgArg), native = path.resolve(nativeArg);
assert(!fs.existsSync(out), 'fresh output directory required');
fs.mkdirSync(out, {recursive: true});
const M = await import(pathToFileURL(path.join(pkg, 'rhwp.js')));
M.initSync({module: fs.readFileSync(path.join(pkg, 'rhwp_bg.wasm'))});
const source = JSON.parse(fs.readFileSync(sourceArg));
const original = source.find(row => path.basename(row.file) === 'whole-none-fit-hwpx-input-1.hwp');
assert(original, 'actual saved middle-cell growth case required');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const variants = [
  {name:'original', top:283, bottom:283, shrink:0},
  {name:'bottom-zero', top:900, bottom:0, shrink:0},
  {name:'bottom-large', top:0, bottom:900, shrink:0},
  {name:'bottom-negative', top:900, bottom:-150, shrink:0},
  {name:'within-two', top:0, bottom:900, shrink:75},
  {name:'visible-over-two', top:900, bottom:0, shrink:150},
  {name:'visible-over-three', top:0, bottom:900, shrink:225},
  // Predicate exclusion: retain its existing diagnostic contract.
  {name:'overlap-excluded', top:283, bottom:283, shrink:0, overlap:true},
];
const rows = [];
for (const variant of variants) {
  const d = new M.HwpDocument(fs.readFileSync(original.file));
  d.setTableProperties(0, 0, 2, JSON.stringify({outerTop:variant.top, outerBottom:variant.bottom, allowOverlap:!!variant.overlap}));
  const pageDef = JSON.parse(d.getPageDef(0));
  d.setPageDef(0, JSON.stringify({...pageDef, marginBottom:pageDef.marginBottom + variant.shrink}));
  for (const ext of ['hwp', 'hwpx']) {
    const file = path.join(out, variant.name + '.' + ext);
    fs.writeFileSync(file, ext === 'hwp' ? d.exportHwp() : d.exportHwpx());
    const reloaded = new M.HwpDocument(fs.readFileSync(file));
    reloaded.setClipEnabled(false);
    const tree = JSON.parse(reloaded.getPageRenderTree(0));
    const nodes = []; const visit = node => { nodes.push(node); (node.children || []).forEach(visit); }; visit(tree);
    const table = nodes.find(node => node.type === 'Table');
    const body = nodes.find(node => node.type === 'Body');
    assert(table && body, 'whole frame retained at the diagnostic boundary');
    const svg = Array.from({length:reloaded.pageCount()}, (_, i) => reloaded.renderPageSvg(i));
    // The public tree rounds geometry to 0.1px. Read full precision from the
    // same table's horizontal SVG borders and the preserved source page budget.
    const lines = [...svg[0].matchAll(/<line\b[^>]*>/g)].map(([tag]) => Object.fromEntries([...tag.matchAll(/(x1|x2|y1|y2)="([^"]+)"/g)].map(([,key,value]) => [key,Number(value)])));
    const frameBorders = lines.filter(line => line.y1 === line.y2 && Math.abs(line.x1-table.bbox.x)<.11 && Math.abs(line.x2-line.x1-table.bbox.w)<.11);
    assert(frameBorders.length > 0, 'independent painted border required');
    const exactPageDef = JSON.parse(reloaded.getPageDef(0));
    const frameBottom = Math.max(...frameBorders.map(line=>line.y1));
    const bodyBottom = (exactPageDef.height-exactPageDef.marginBottom-exactPageDef.marginFooter)*96/7200;
    assert(Math.abs(frameBottom-table.bbox.y-table.bbox.h)<.11);
    assert(Math.abs(bodyBottom-body.bbox.y-body.bbox.h)<.11);
    const manifest = [{...original, file, pageDef:exactPageDef, props:JSON.parse(reloaded.getTableProperties(0, 0, 2)), svg, pageCount:reloaded.pageCount()}];
    const manifestPath = path.join(out, variant.name + '-' + ext + '-manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    const result = spawnSync(native, [manifestPath, path.join(out, variant.name + '-' + ext + '-native')], {encoding:'utf8', env:{...process.env, RHWP_TABLE_DRIFT:'1'}, maxBuffer:8*1024*1024});
    fs.writeFileSync(path.join(out, variant.name + '-' + ext + '.log'), result.stdout + result.stderr);
    assert.equal(result.status, 0, 'complete Native saved model and SVG equality: ' + variant.name + '.' + ext);
    const diagnostics = [...result.stderr.matchAll(/LAYOUT_OVERFLOW: page=0, sec=0, col=0, para=0, type=Table, first=true, y=([\d.-]+), bottom=([\d.-]+), overflow=([\d.-]+)px/g)].map(m => ({y:Number(m[1]),bottom:Number(m[2]),overflow:Number(m[3])}));
    if (variant.overlap) assert(diagnostics.length > 0, 'excluded shape keeps its existing warning');
    else {
      assert.equal(diagnostics.length > 0, frameBottom - bodyBottom > 2, 'warning follows visible frame with unchanged 2px threshold');
      for (const warning of diagnostics) {
        assert(Math.abs(warning.y - frameBottom) <= .11, 'diagnostic y equals painted table frame');
        assert(Math.abs(warning.bottom - bodyBottom) <= .11, 'diagnostic bottom equals body frame');
      }
    }
    rows.push({...variant, ext, frameBottom, bodyBottom, visibleOverflow:frameBottom-bodyBottom, diagnostics, savedSHA256:sha(fs.readFileSync(file)), completeNativeSVGSame:true});
    reloaded.free();
  }
  d.free();
}
assert(rows.some(row => !row.overlap && row.diagnostics.length), 'genuine visible overflow still warned');
const proof = {sourceFile:path.basename(original.file), sourceSHA256:sha(fs.readFileSync(original.file)), wasmSHA256:sha(fs.readFileSync(path.join(pkg,'rhwp_bg.wasm'))), nativeSHA256:sha(fs.readFileSync(native)), cases:rows.length, rows};
fs.writeFileSync(path.join(out,'proof.json'), JSON.stringify(proof,null,2));
console.log(JSON.stringify({cases:rows.length,genuineOverflowCases:rows.filter(row=>!row.overlap&&row.diagnostics.length).length,excludedWarnings:rows.filter(row=>row.overlap&&row.diagnostics.length).length}));

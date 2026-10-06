// Read-only projection of the previous synthetic diagnosis into independent input.
// This does not change a document or connect the planner to rhwp rendering.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
const [engineDir, diagnosisDir, outputFile] = process.argv.slice(2);
assert(engineDir && diagnosisDir && outputFile);
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const wasm = fs.readFileSync(path.join(engineDir, 'rhwp_bg.wasm'));
const ui = JSON.parse(fs.readFileSync(path.join(diagnosisDir, 'behavior/ui/proof.json')));
const native = JSON.parse(fs.readFileSync(path.join(diagnosisDir, 'behavior/native/proof.json')));
assert.equal(sha(wasm), ui.engineSHA256);
const {initSync, HwpDocument} = await import(pathToFileURL(path.resolve(engineDir, 'rhwp.js')));
initSync({module: wasm});
const scale = 1024, huToPx = v => v * 96 / 7200;
// Constrained reproduction only: same positive table/cell padding, no overrides.
// Match the existing declared-height guard; not a general padding resolver.
const inset = (b, pad) => {
 const x = Math.ceil((b.x + pad.left) * scale);
 const y = Math.ceil((b.y + pad.top) * scale);
 return {x, y, width: Math.floor((b.x + b.width - pad.right) * scale) - x,
  height: Math.floor((b.y + b.height - pad.bottom) * scale) - y};
};
const fixtures = [];
for (const f of ui.fixtures.filter(f => f.direction > 0)) for (const file of f.outputs) {
 const bytes = fs.readFileSync(file), before = sha(bytes), d = new HwpDocument(bytes);
 try {
  const at = p => JSON.stringify([{controlIndex: f.ci, cellIndex: 0, cellParaIndex: p}]);
  const cell = JSON.parse(d.getCellOwnPropertiesByPath(0, f.parent, at(0)));
  const table = JSON.parse(d.getTableProperties(0, f.parent, f.ci));
  assert.equal(cell.textDirection, f.direction);
  assert.equal(cell.applyInnerMargin, false);
  for (const side of ['Left', 'Right', 'Top', 'Bottom']) {
   assert.equal(cell['padding' + side], table['padding' + side]);
   assert(table['padding' + side] > 0);
  }
  let pad = Object.fromEntries(['Left','Right','Top','Bottom'].map(s => [s.toLowerCase(), huToPx(table['padding'+s])]));
  const declaredHeight = huToPx(cell.height), total = pad.top + pad.bottom;
  if (declaredHeight > 0 && total >= declaredHeight) {
   const ratio = declaredHeight * 0.5 / total;
   pad = {...pad, top: pad.top * ratio, bottom: pad.bottom * ratio};
  }
  const observation = native.observations.find(n => path.resolve(n.file) === path.resolve(file));
  assert(observation);
  const stored = observation.paragraph0StoredLines[0];
  const frames = observation.pages.filter(p => p.cellBox).map(p => inset(p.cellBox, pad));
  const full = observation.pages.find(p => p.page === 1)?.cellBox ?? observation.pages[0].cellBox;
  // This synthetic p1 continuation is shortened. Use the p124 continuation box
  // as an explicit hypothetical future-frame budget, never as allocated pages.
  const fullCase = native.observations.find(n => n.id === 'p124-d'+f.direction && n.file.endsWith(path.extname(file)));
  const continuation = fullCase?.pages.find(p => p.page === 1)?.cellBox ?? full;
  const paragraphs = [];
  let sourceHasNumbering = false;
  assert.equal(d.getCellParagraphCountByPath(0, f.parent, at(0)), f.count);
  for (let pi = 0; pi < f.count; pi++) {
   const count = d.getCellParagraphLengthByPath(0, f.parent, at(pi));
   const text = d.getTextInCellByPath(0, f.parent, at(pi), 0, count);
   assert.equal([...text].length, count);
   const para = JSON.parse(d.getCellParaPropertiesAtByPath(0, f.parent, at(pi)));
   sourceHasNumbering ||= para.headType === 'Number';
   const units = [...text].map((_, i) => {
    const shape = JSON.parse(d.getCellCharPropertiesAtByPath(0, f.parent, at(pi), i));
    // Caller-supplied conservative square font metrics for the text projection.
    // Does not prove actual shaped ink bounds or direction1/2 glyph appearance.
    const extent = Math.ceil(huToPx(shape.fontSize) * scale);
    return {source: [i, i+1], advance: extent, width: extent};
   });
   paragraphs.push({text, charCount: count,
    columnWidth: Math.max(Math.ceil(huToPx(stored.height)*scale), ...units.map(u=>u.width)),
    gapAfter: Math.ceil(huToPx(stored.spacing)*scale), units});
  }
  assert(sourceHasNumbering, 'the original diagnosis contains numbering and must remain excluded');
  assert.equal(sha(fs.readFileSync(file)), before);
  fixtures.push({id: f.id + '-' + path.extname(file).slice(1), sourceFile: path.resolve(file), sourceSHA256: before,
   sourceDirection: f.direction, sourceHasNumbering, productionEligible: false,
   projection: 'single-cell plain text only; numbering/control/layout semantics excluded',
   metrics: 'synthetic outward-rounded square font extents; no font shaping verification',
   effectivePaddingPx: pad, paragraphs, frames, hypotheticalContinuation: inset(continuation,pad)});
 } finally {d.free();}
}
const output = {engineSHA256: sha(wasm), subpixelsPerPixel: scale, GUIVerified: false,
 productionIntegrated: false, fixtures};
fs.mkdirSync(path.dirname(path.resolve(outputFile)),{recursive:true});
fs.writeFileSync(outputFile, JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify({fixtures: fixtures.length, sourceFilesUnchanged: true, productionIntegrated: false}));

#!/usr/bin/env node
// Component QA with the product's CanvasKit build; this does not launch the Mac app.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const kinds = ['current-woff2', 'current-sfnt-control', 'official-full-ttf',
  'official-full-woff2-null', 'official-full-woff2-transformed'];
const args = process.argv.slice(2);
assert([4, 5, 6].includes(args.length), 'Usage: --inputs prepared/inputs.json --output-root NEW_DIRECTORY [--single-context]');
assert.equal(args[0], '--inputs');
assert.equal(args[2], '--output-root');
if (args.length === 6) assert.equal(args[4], '--font-file');
if (args.length === 5) assert.equal(args[4], '--single-context');
const singleContext = args.length === 5;
const workerFile = args.length === 6 ? args[5] : null;
const inputPath = path.resolve(args[1]), output = path.resolve(args[3]);
assert(!fs.existsSync(output) && !fs.lstatSync(path.dirname(output)).isSymbolicLink(), 'Use a fresh output directory');
const inputBytes = fs.readFileSync(inputPath), input = JSON.parse(inputBytes);
const inventoryPath = path.join(root, 'desktop/web/licenses/FONT_SOURCE_PROVENANCE.json');
const inventoryBytes = fs.readFileSync(inventoryPath), inventory = JSON.parse(inventoryBytes);
assert.equal(input.productInventorySHA256, sha(inventoryBytes));
assert.equal(input.schemaVersion, 1);
assert.equal(input.fonts.length, 8);
assert.deepEqual(new Set(input.fonts.map(x => x.file)),
  new Set(inventory.fonts.filter(x => x.file.startsWith('Nanum')).map(x => x.file)));
const buffers = new Map();
for (const row of input.fonts) {
  const pinned = inventory.fonts.find(x => x.file === row.file);
  assert.equal(row.weight, pinned.metadataWeight);
  assert.deepEqual(row.variants.map(x => x.kind), kinds);
  for (const variant of row.variants) {
    const bytes = fs.readFileSync(variant.path);
    assert(bytes.length > 0 && bytes.length <= 64 * 1024 * 1024);
    assert.equal(bytes.length, variant.bytes);
    assert.equal(sha(bytes), variant.sha256, 'Changed prepared input: ' + variant.kind);
    if (variant.kind === 'current-woff2') assert.equal(sha(bytes), pinned.sha256);
    if (variant.kind === 'official-full-ttf') assert.equal(sha(bytes), pinned.glyphReference.TTF_SHA256);
    buffers.set(variant.path, bytes);
  }
  for (const list of [row.currentCodepoints, row.sourceCodepoints]) {
    assert(list.length > 10000);
    assert(list.every((cp, i) => Number.isInteger(cp) && cp >= 0 && cp <= 0x10ffff
      && !(cp >= 0xd800 && cp <= 0xdfff) && (i === 0 || list[i - 1] < cp)));
  }
}
fs.mkdirSync(output);
const require = createRequire(path.join(root, 'rhwp-studio/package.json'));
const canvasKitJS = require.resolve('canvaskit-wasm');
const canvasKitWasm = path.join(path.dirname(canvasKitJS), 'canvaskit.wasm');
const wasmBytes = fs.readFileSync(canvasKitWasm);
if (!workerFile && !singleContext) {
  const proofs = [], workerFailures = [];
  for (const row of input.fonts) {
    const childOutput = path.join(output, path.basename(row.file, '.woff2'));
    const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--inputs', inputPath,
      '--output-root', childOutput, '--font-file', row.file], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
    fs.writeFileSync(childOutput + '.log', (child.stdout ?? '') + (child.stderr ?? ''));
    const proofPath = path.join(childOutput, 'proof.json');
    if (child.error || !fs.existsSync(proofPath)) {
      workerFailures.push({ file: row.file, exit: child.status, error: child.error ? String(child.error) : 'Worker produced no completed proof' });
      continue;
    }
    const proof = JSON.parse(fs.readFileSync(proofPath));
    assert.equal(proof.fontFiles, 1);
    assert.equal(proof.rows[0].file, row.file);
    assert.equal(proof.sourceSHA256, sha(fs.readFileSync(fileURLToPath(import.meta.url))));
    assert.equal(proof.CanvasKitWASM_SHA256, sha(wasmBytes));
    assert.equal(proof.inputSHA256, sha(inputBytes));
    const expectedExit = proof.incompatibilities.length || proof.mismatches.length ? 1 : 0;
    if (child.status !== expectedExit) workerFailures.push({ file: row.file, exit: child.status, expectedExit,
      error: 'Worker exit disagrees with its completed proof' });
    proofs.push(proof);
    console.log(row.file + ': worker exit ' + child.status + ', measured differences ' + proof.mismatches.length);
  }
  const sum = key => proofs.reduce((n, proof) => n + proof[key], 0);
  const result = { sourceSHA256: sha(fs.readFileSync(fileURLToPath(import.meta.url))), inputSHA256: sha(inputBytes),
    productInventorySHA256: sha(inventoryBytes), CanvasKitJS_SHA256: sha(fs.readFileSync(canvasKitJS)), CanvasKitWASM_SHA256: sha(wasmBytes),
    node: process.version, perFontProcessIsolation: true, requestedFontFiles: 8, fontFiles: sum('fontFiles'),
    formatLoads: sum('formatLoads'), currentMappedCodepoints: sum('currentMappedCodepoints'), sourceMappedCodepoints: sum('sourceMappedCodepoints'),
    paragraphComparisons: sum('paragraphComparisons'), metricComparisons: sum('metricComparisons'),
    aliasedParagraphComparisons: sum('aliasedParagraphComparisons'),
    glyphGridComparisons: sum('glyphGridComparisons'), fullSourceGridComparisons: sum('fullSourceGridComparisons'),
    workerFailures, incompatibilities: proofs.flatMap(x => x.incompatibilities), mismatches: proofs.flatMap(x => x.mismatches),
    rows: proofs.flatMap(x => x.rows), productFontsReplaced: false, browserFontFaceVerified: false,
    nativeAppLaunched: false, HancomIMEVerified: false, actualPrintingVerified: false, releaseHeld: true };
  fs.writeFileSync(path.join(output, 'proof.json'), JSON.stringify(result, null, 2) + '\n');
  fs.writeSync(1, JSON.stringify({ fontFiles: result.fontFiles, formatLoads: result.formatLoads,
    paragraphComparisons: result.paragraphComparisons, metricComparisons: result.metricComparisons,
    aliasedParagraphComparisons: result.aliasedParagraphComparisons,
    glyphGridComparisons: result.glyphGridComparisons, fullSourceGridComparisons: result.fullSourceGridComparisons,
    workerFailures: workerFailures.length, incompatibilities: result.incompatibilities.length, mismatches: result.mismatches.length }) + '\n');
  process.exit(workerFailures.length || result.incompatibilities.length || result.mismatches.length ? 1 : 0);
}
const fontsToTest = singleContext ? input.fonts : input.fonts.filter(row => row.file === workerFile);
assert.equal(fontsToTest.length, singleContext ? 8 : 1);
const ck = await require('canvaskit-wasm')({ wasmBinary: wasmBytes });
const normal = value => ArrayBuffer.isView(value) ? Array.from(value)
  : Array.isArray(value) ? value.map(normal)
    : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k => [k, normal(value[k])])) : value;
const same = (a, b) => JSON.stringify(normal(a)) === JSON.stringify(normal(b));
const vectorSha = vector => sha(Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength));
const textFor = cps => cps.map(cp => String.fromCodePoint(cp)).join('');
const weightEnum = weight => ck.FontWeight[({ 400: 'Normal', 700: 'Bold', 800: 'ExtraBold' })[weight]];
const styleFor = row => ({ weight: weightEnum(row.weight), width: ck.FontWidth.Normal, slant: ck.FontSlant.Upright });

function load(variant) {
  const bytes = buffers.get(variant.path), errors = [];
  let face = null, manager = null;
  try { face = ck.Typeface.MakeFreeTypeFaceFromData(bytes); } catch (e) { errors.push('FreeType: ' + String(e)); }
  if (!face) {
    try { face = ck.Typeface.MakeTypefaceFromData(bytes); } catch (e) { errors.push('Typeface: ' + String(e)); }
  }
  try { manager = ck.FontMgr.FromData(bytes); } catch (e) { errors.push('FontMgr: ' + String(e)); }
  const result = { kind: variant.kind, bytes: variant.bytes, sha256: variant.sha256, faceLoaded: !!face,
    fontManagerLoaded: !!manager && manager.countFamilies() > 0, family: face?.getFamilyName() ?? null,
    fontManagerFamilies: manager ? Array.from({ length: manager.countFamilies() }, (_, i) => manager.getFamilyName(i)) : [], errors };
  return { face, manager, result, delete() { face?.delete(); manager?.delete(); } };
}

function snapshot(surface, pngPath) {
  surface.flush();
  const image = surface.makeImageSnapshot();
  try {
    const width = surface.width(), height = surface.height();
    const pixels = image.readPixels(0, 0, { width, height, colorType: ck.ColorType.RGBA_8888,
      alphaType: ck.AlphaType.Unpremul, colorSpace: ck.ColorSpace.SRGB });
    assert(pixels && pixels.byteLength === width * height * 4, 'Raster readback failed');
    const copy = Buffer.from(pixels);
    if (pngPath) {
      const png = image.encodeToBytes();
      assert(png?.length > 0);
      fs.writeFileSync(pngPath, png);
    }
    return { width, height, sha256: sha(copy), pixels: copy };
  } finally { image.delete(); }
}

function grid(loaded, cps, pngPath) {
  const ids = loaded.face.getGlyphIDs(textFor(cps), cps.length);
  assert.equal(ids.length, cps.length);
  const columns = 128, cellWidth = 32, cellHeight = 36;
  const surface = ck.MakeSurface(columns * cellWidth, Math.ceil(cps.length / columns) * cellHeight + 8);
  assert(surface, 'Raster surface allocation failed');
  const paint = new ck.Paint(), font = new ck.Font(loaded.face, 20);
  font.setSubpixel(true); paint.setColor(ck.BLACK); paint.setAntiAlias(true);
  try {
    const canvas = surface.getCanvas(); canvas.clear(ck.WHITE);
    const positions = new Float32Array(cps.length * 2);
    cps.forEach((_, i) => { positions[2 * i] = i % columns * cellWidth + 4; positions[2 * i + 1] = Math.floor(i / columns) * cellHeight + 27; });
    canvas.drawGlyphs(ids, positions, 0, 0, font, paint);
    const result = snapshot(surface, pngPath);
    assert(result.pixels.some((v, i) => i % 4 !== 3 && v < 250), 'Blank glyph grid');
    return result;
  } finally { font.delete(); paint.delete(); surface.dispose(); }
}

function diff(a, b) {
  if (a.width === b.width && a.height === b.height && a.sha256 === b.sha256) return 0;
  let count = 0;
  const width = Math.max(a.width, b.width), height = Math.max(a.height, b.height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const ai = (y * a.width + x) * 4, bi = (y * b.width + x) * 4;
    if (x >= a.width || x >= b.width || y >= a.height || y >= b.height
      || a.pixels.readUInt32LE(ai) !== b.pixels.readUInt32LE(bi)) count++;
  }
  return count;
}

function metrics(loaded, cps, size) {
  const ids = loaded.face.getGlyphIDs(textFor(cps), cps.length), font = new ck.Font(loaded.face, size);
  font.setSubpixel(true);
  try {
    const widths = font.getGlyphWidths(ids), bounds = font.getGlyphBounds(ids);
    assert.equal(widths.length, cps.length); assert.equal(bounds.length, cps.length * 4);
    assert(widths.every(Number.isFinite) && bounds.every(Number.isFinite));
    return { size, widthsSHA256: vectorSha(widths), boundsSHA256: vectorSha(bounds), global: normal(font.getMetrics()) };
  } finally { font.delete(); }
}

function paragraph(loaded, row, text, size, width, alias = null) {
  const paragraphStyle = new ck.ParagraphStyle({ textStyle: { color: ck.BLACK,
    fontFamilies: [alias?.family ?? loaded.result.fontManagerFamilies[0]], fontSize: size, fontStyle: styleFor(row) }, textAlign: ck.TextAlign.Left });
  const builder = alias ? ck.ParagraphBuilder.MakeFromFontProvider(paragraphStyle, alias.provider)
    : ck.ParagraphBuilder.Make(paragraphStyle, loaded.manager);
  let para = null, surface = null;
  try {
    builder.addText(text); para = builder.build(); para.layout(width);
    const lineKeys = ['startIndex', 'endIndex', 'endExcludingWhitespaces', 'endIncludingNewline', 'hardBreak',
      'ascent', 'descent', 'height', 'width', 'left', 'baseline', 'lineNumber'];
    const lineMetrics = para.getLineMetrics().map(line => Object.fromEntries(lineKeys.filter(k => k in line).map(k => [k, line[k]])));
    const layout = { height: para.getHeight(), longestLine: para.getLongestLine(),
      maxIntrinsicWidth: para.getMaxIntrinsicWidth(), minIntrinsicWidth: para.getMinIntrinsicWidth(), lineMetrics };
    assert(layout.height > 0 && Number.isFinite(layout.height) && lineMetrics.length > 0, 'Empty paragraph');
    surface = ck.MakeSurface(width + 8, Math.ceil(layout.height) + 8); assert(surface);
    surface.getCanvas().clear(ck.WHITE); surface.getCanvas().drawParagraph(para, 4, 4);
    return { layout, raster: snapshot(surface) };
  } finally { surface?.dispose(); para?.delete(); builder.delete(); }
}

const corpus = [
  ['hangul', '글결 편집 가나다라 한글 문서 저장 재열기 인쇄 12345'],
  ['latin-shaping', 'AVATAR office ffi fi fl To WA 0123456789 (test) - _ + ='],
  ['mixed-wrap', '글결 문서 ABC 가나다 12345 한글 DEF 라마바 67890 저장'],
  ['jamo', '가나다 한글 문서'],
  ['punctuation', '가나다, 라마바. ABC: 123; (한글) [문서] / 456!'],
];
const rows = [], incompatibilities = [], mismatches = [];
let paragraphComparisons = 0, aliasedParagraphComparisons = 0, metricComparisons = 0, glyphGridComparisons = 0, fullSourceGridComparisons = 0;
for (const row of fontsToTest) {
  const loaded = row.variants.map(load), base = loaded[0], source = loaded[2];
  const aliases = new Map();
  const result = { file: row.file, weight: row.weight, currentCodepoints: row.currentCodepoints.length,
    sourceCodepoints: row.sourceCodepoints.length, addedCodepoints: row.sourceAddedCodepoints.length,
    compatibility: loaded.map(x => x.result), familyChanges: loaded.filter(x => x.result.family !== base.result.family).map(x => x.result.kind),
    glyphGrids: [], fullSourceGrids: [], metrics: [], paragraphs: [], familyLookups: [], aliasedParagraphs: [], skippedCorpus: [], addedCoverage: [] };
  try {
    for (const item of loaded) if (!item.result.faceLoaded || !item.result.fontManagerLoaded)
      incompatibilities.push({ file: row.file, kind: item.result.kind, face: item.result.faceLoaded, manager: item.result.fontManagerLoaded });
    if (loaded.some(x => !x.result.faceLoaded || !x.result.fontManagerLoaded)) { rows.push(result); continue; }
    for (const item of loaded) {
      const matched = item.manager.matchFamilyStyle(base.result.family, styleFor(row));
      const lookup = { kind: item.result.kind, requestedFamily: base.result.family, bareLookupMatched: !!matched,
        returnedFamily: matched?.getFamilyName() ?? null };
      matched?.delete();
      if (!lookup.bareLookupMatched) {
        const provider = ck.TypefaceFontProvider.Make();
        const variant = row.variants.find(x => x.kind === item.result.kind);
        provider.registerFont(buffers.get(variant.path), base.result.family);
        const aliased = provider.matchFamilyStyle(base.result.family, styleFor(row));
        lookup.externalAliasMatched = !!aliased;
        aliased?.delete();
        aliases.set(item.result.kind, { provider, family: base.result.family });
        mismatches.push({ file: row.file, kind: item.result.kind, check: 'legacy-family-lookup', requestedFamily: base.result.family,
          externalAliasMatched: lookup.externalAliasMatched });
      }
      result.familyLookups.push(lookup);
    }
    const basename = path.basename(row.file, '.woff2');
    const baseGrid = grid(base, row.currentCodepoints, path.join(output, basename + '-current-grid.png'));
    result.baselineGrid = { width: baseGrid.width, height: baseGrid.height, sha256: baseGrid.sha256 };
    for (const item of loaded.slice(1)) {
      const candidateGrid = grid(item, row.currentCodepoints, item.result.kind === 'official-full-woff2-null'
        ? path.join(output, basename + '-full-null-common-grid.png') : undefined);
      const pixels = diff(baseGrid, candidateGrid); glyphGridComparisons++;
      result.glyphGrids.push({ kind: item.result.kind, changedPixels: pixels, sha256: candidateGrid.sha256 });
      if (pixels) mismatches.push({ file: row.file, kind: item.result.kind, check: 'current-codepoint-grid', changedPixels: pixels });
    }
    const fullGrid = grid(source, row.sourceCodepoints);
    for (const item of loaded.slice(3)) {
      const candidate = grid(item, row.sourceCodepoints), pixels = diff(fullGrid, candidate); fullSourceGridComparisons++;
      result.fullSourceGrids.push({ kind: item.result.kind, changedPixels: pixels, sourceSHA256: fullGrid.sha256, candidateSHA256: candidate.sha256 });
      if (pixels) mismatches.push({ file: row.file, kind: item.result.kind, check: 'full-source-grid', changedPixels: pixels });
    }
    for (const size of [9, 16, 28, 48]) {
      const expected = metrics(base, row.currentCodepoints, size);
      for (const item of loaded.slice(1)) {
        const actual = metrics(item, row.currentCodepoints, size); metricComparisons++;
        const glyphMetricsEqual = expected.widthsSHA256 === actual.widthsSHA256 && expected.boundsSHA256 === actual.boundsSHA256;
        result.metrics.push({ kind: item.result.kind, size, glyphMetricsEqual, globalMetricsEqual: same(expected.global, actual.global),
          currentGlobalMetrics: expected.global, candidateGlobalMetrics: actual.global });
        if (!glyphMetricsEqual) mismatches.push({ file: row.file, kind: item.result.kind, check: 'current-glyph-metrics', size });
        if (!same(expected.global, actual.global)) mismatches.push({ file: row.file, kind: item.result.kind, check: 'global-font-metrics', size });
      }
    }
    const currentSet = new Set(row.currentCodepoints), common = corpus.filter(([id, text]) => {
      const absent = Array.from(text, c => c.codePointAt(0)).filter(cp => !currentSet.has(cp));
      if (absent.length) result.skippedCorpus.push({ id, absentCodepoints: [...new Set(absent)] });
      return absent.length === 0;
    });
    assert(common.length >= 3, 'Insufficient shared paragraph corpus');
    for (const [id, text] of common) for (const size of [12, 18, 32]) for (const width of [180, 320, 520]) {
      const expected = paragraph(base, row, text, size, width);
      for (const item of loaded.slice(1)) {
        const actual = paragraph(item, row, text, size, width), pixels = diff(expected.raster, actual.raster);
        const layoutEqual = same(expected.layout, actual.layout); paragraphComparisons++;
        result.paragraphs.push({ id, kind: item.result.kind, size, width, layoutEqual, changedPixels: pixels,
          currentLayout: expected.layout, candidateLayout: actual.layout,
          currentPixelSHA256: expected.raster.sha256, candidatePixelSHA256: actual.raster.sha256 });
        if (!layoutEqual || pixels) mismatches.push({ file: row.file, kind: item.result.kind, check: 'paragraph', id, size, width, layoutEqual, changedPixels: pixels });
        const alias = aliases.get(item.result.kind);
        if (alias) {
          const aliased = paragraph(item, row, text, size, width, alias), aliasPixels = diff(expected.raster, aliased.raster);
          const aliasLayoutEqual = same(expected.layout, aliased.layout); aliasedParagraphComparisons++;
          result.aliasedParagraphs.push({ id, kind: item.result.kind, size, width, layoutEqual: aliasLayoutEqual, changedPixels: aliasPixels,
            currentPixelSHA256: expected.raster.sha256, aliasedPixelSHA256: aliased.raster.sha256 });
          if (!aliasLayoutEqual || aliasPixels) mismatches.push({ file: row.file, kind: item.result.kind,
            check: 'externally-aliased-paragraph', id, size, width, layoutEqual: aliasLayoutEqual, changedPixels: aliasPixels });
        }
      }
    }
    for (const item of loaded) {
      const ids = item.face.getGlyphIDs(textFor(row.coverageSample), row.coverageSample.length);
      result.addedCoverage.push({ kind: item.result.kind, sampledCodepoints: row.coverageSample, missingGlyphs: Array.from(ids).filter(x => x === 0).length });
    }
    rows.push(result);
    console.log(row.file + ': compared ' + row.currentCodepoints.length + ' common mappings; ' + common.length + ' paragraph strings.');
  } finally { for (const alias of aliases.values()) alias.provider.delete(); for (const item of loaded) item.delete(); }
}
const result = { sourceSHA256: sha(fs.readFileSync(fileURLToPath(import.meta.url))), inputSHA256: sha(inputBytes),
  productInventorySHA256: sha(inventoryBytes), CanvasKitJS_SHA256: sha(fs.readFileSync(canvasKitJS)), CanvasKitWASM_SHA256: sha(wasmBytes),
  node: process.version, perFontProcessIsolation: !singleContext, fontFiles: rows.length, formatLoads: fontsToTest.length * kinds.length,
  currentMappedCodepoints: fontsToTest.reduce((n, x) => n + x.currentCodepoints.length, 0),
  sourceMappedCodepoints: fontsToTest.reduce((n, x) => n + x.sourceCodepoints.length, 0),
  paragraphComparisons, aliasedParagraphComparisons, metricComparisons, glyphGridComparisons, fullSourceGridComparisons,
  incompatibilities, mismatches, rows, productFontsReplaced: false, browserFontFaceVerified: false,
  nativeAppLaunched: false, HancomIMEVerified: false, actualPrintingVerified: false, releaseHeld: true };
fs.writeFileSync(path.join(output, 'proof.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ fontFiles: result.fontFiles, formatLoads: result.formatLoads, paragraphComparisons, metricComparisons,
  aliasedParagraphComparisons, glyphGridComparisons, fullSourceGridComparisons, incompatibilities: incompatibilities.length, mismatches: mismatches.length }));
if (incompatibilities.length || mismatches.length) process.exitCode = 1;

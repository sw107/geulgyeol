#!/usr/bin/env node
// Real product modules and WASM; Node canvas transport adapters, not native app QA.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire, registerHooks, stripTypeScriptTypes } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
assert([4, 5].includes(args.length) && args[0] === '--inputs' && args[2] === '--output-root',
  'Usage: --inputs prepared/inputs.json --output-root NEW_DIRECTORY [--geulgyeol-font-plan[-korean]]');
if (args.length === 5) assert(['--geulgyeol-font-plan', '--geulgyeol-font-plan-korean'].includes(args[4]));
const appFontPlan = args.length === 5, koreanRequests = args[4] === '--geulgyeol-font-plan-korean';
if (appFontPlan) globalThis.__GEULGYEOL_BUNDLED_NANUM__ = true;
const output = path.resolve(args[3]), inputBytes = fs.readFileSync(path.resolve(args[1]));
assert(!fs.existsSync(output), 'Use a fresh output directory');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const input = JSON.parse(inputBytes);
const inventoryBytes = fs.readFileSync(path.join(root, 'desktop/web/licenses/FONT_SOURCE_PROVENANCE.json'));
const inventory = JSON.parse(inventoryBytes);
assert.equal(input.productInventorySHA256, sha(inventoryBytes));
assert.equal(input.schemaVersion, 1);
const rows = input.fonts.filter(row => /^(NanumGothic|NanumMyeongjo)-ExtraBold\.woff2$/.test(row.file));
assert.equal(rows.length, 2);
for (const row of rows) {
  const pinned = inventory.fonts.find(x => x.file === row.file);
  assert.equal(row.variants[0].sha256, pinned.sha256);
  assert.equal(row.variants[2].sha256, pinned.glyphReference.TTF_SHA256);
  for (const v of row.variants) {
    const bytes = fs.readFileSync(v.path);
    assert.equal(sha(bytes), v.sha256);
    assert.equal(bytes.length, v.bytes);
  }
}
fs.mkdirSync(output);
const sourcePins = {}, src = path.join(root, 'rhwp-studio/src');
// Resolve the product's TS aliases and strip types; do not rewrite product logic.
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'canvaskit-wasm/bin/canvaskit.wasm?url') {
      return { url: 'data:text/javascript,export default "qa-unused-bootstrap-url"', shortCircuit: true };
    }
    if (specifier.startsWith('@/') || (/^\.\.?\//.test(specifier) && context.parentURL?.endsWith('.ts'))) {
      const base = specifier.startsWith('@/') ? path.join(src, specifier.slice(2))
        : path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier);
      for (const candidate of [base, base + '.ts', path.join(base, 'index.ts')]) {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          return { url: pathToFileURL(candidate).href, shortCircuit: true };
        }
      }
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.endsWith('.ts')) {
      const file = fileURLToPath(url), bytes = fs.readFileSync(file);
      sourcePins[path.relative(root, file)] = sha(bytes);
      return { format: 'module', source: stripTypeScriptTypes(bytes.toString(), { mode: 'transform' }), shortCircuit: true };
    }
    return next(url, context);
  },
});
const { CanvasKitLayerRenderer } = await import(pathToFileURL(path.join(src, 'view/canvaskit-renderer.ts')));
const { resolveCanvasKitFontPlanWithRules: plan, getWebFontSupplySnapshotWithRules } = await import(pathToFileURL(path.join(src, 'core/font-loader.ts')));
const { FONT_RULE_WEBFONT_ENTRIES } = await import(pathToFileURL(path.join(src, 'core/font-rule-runtime.ts')));
const { analyzeDocumentFonts } = await import(pathToFileURL(path.join(src, 'core/document-font-status.ts')));
const { CanvasKitGlyphRunFontCache, drawCanvasKitGlyphRun } = await import(pathToFileURL(path.join(src, 'view/canvaskit/glyph-run-fonts.ts')));
const require = createRequire(path.join(root, 'rhwp-studio/package.json'));
const { blake3 } = await import(pathToFileURL(require.resolve('@noble/hashes/blake3.js')));
const ckJS = require.resolve('canvaskit-wasm'), ckWasm = fs.readFileSync(path.join(path.dirname(ckJS), 'canvaskit.wasm'));
const ck = await require('canvaskit-wasm')({ wasmBinary: ckWasm });
const sdk = await import(pathToFileURL(path.join(root, 'pkg/rhwp.js')));
const engineBytes = fs.readFileSync(path.join(root, 'pkg/rhwp_bg.wasm'));
sdk.initSync({ module: engineBytes });

// Only transfer real WASM RGBA pixels. No text measurement/font/graphics API is mocked.
class TransportCanvas {
  constructor(width, height, failFlush = false) {
    Object.assign(this, { width, height, failFlush, parentElement: null, classList: { contains: () => false } });
  }
  getContext(kind) {
    assert.equal(kind, '2d');
    return { putImageData: data => {
      if (this.failFlush) throw new Error('QA controlled pixel transport failure');
      this.pixels = Buffer.from(data.data);
    } };
  }
}
globalThis.HTMLCanvasElement = TransportCanvas;
globalThis.ImageData = class { constructor(data, width, height) { Object.assign(this, { data, width, height }); } };
const urls = new Map();
globalThis.fetch = async url => { assert(urls.has(url), 'No network permitted in this QA'); return new Response(urls.get(url)); };

// Track only JS-owned surface backing allocations, including product error cleanup.
const live = new Map(), malloc = ck._malloc, free = ck._free, make = ck.MakeSWCanvasSurface;
let surfaceBytes = null, allocations = 0, observedFrees = 0, manuallyFreedBaselineBytes = 0;
ck._malloc = size => { const p = malloc(size); if (size === surfaceBytes) { live.set(p, size); allocations++; } return p; };
ck._free = pointer => { if (live.delete(pointer)) observedFrees++; return free(pointer); };
ck.MakeSWCanvasSurface = canvas => {
  surfaceBytes = canvas.width * canvas.height * 4;
  try { return make(canvas); } finally { surfaceBytes = null; }
};
const cleanup = [];
function recordCleanup(label) {
  const outstanding = [...live.values()].reduce((a, b) => a + b, 0);
  cleanup.push({ label, outstandingAllocations: live.size, outstandingBytes: outstanding });
  // Bound a baseline regression run without hiding the observed leak in its proof.
  for (const [pointer, bytes] of live) { free(pointer); manuallyFreedBaselineBytes += bytes; }
  live.clear();
}
const renderer = () => new CanvasKitLayerRenderer(ck, 'default', { preference: 'software', requested: 'software' }, null, null);
const ops = tree => { const out = []; const walk = n => { if (n.children) n.children.forEach(walk); if (n.child) walk(n.child); if (n.ops) out.push(...n.ops); }; walk(tree.root); return out; };
const results = [], plans = [], bareLookupMisses = [];
const text = '글결 AVATAR office 123';
for (const row of rows) {
  const alias = row.file.startsWith('NanumGothic-') ? 'NanumGothicExtraBold' : 'NanumMyeongjoExtraBold';
  const korean = row.file.startsWith('NanumGothic-') ? '나눔고딕 ExtraBold' : '나눔명조 ExtraBold';
  const requestedFamily = koreanRequests ? korean : alias;
  for (const family of [alias, korean]) for (const offline of [true, false]) {
    plans.push({ family, disableExternalWebFonts: offline, decision: plan([family], { disableExternalWebFonts: offline }) });
    if (appFontPlan) {
      const decision = plans.at(-1).decision;
      assert.equal(decision.unavailableFonts.length, 0); assert.equal(decision.sources.length, 1);
      assert.equal(decision.sources[0].url, 'fonts/' + row.file);
      assert.deepEqual(new Set(decision.sources[0].aliases), new Set([alias, korean]));
      assert.equal(getWebFontSupplySnapshotWithRules(family).status, 'catalogued');
      const webEntries = FONT_RULE_WEBFONT_ENTRIES.filter(entry => entry.name === family);
      assert.equal(webEntries.length, 1); assert.equal(webEntries[0].file, 'fonts/' + row.file);
    }
  }
  if (appFontPlan) {
    assert.equal(plan([alias, korean], { disableExternalWebFonts: true }).sources.length, 1);
    assert.deepEqual(plan([alias], { availableLocalFiles: new Set() }).unavailableFonts, [alias]);
    assert.equal(plan([alias], { availableLocalFiles: new Set([row.file]), localFontBaseUrl: 'app://qa/fonts/' }).sources[0].url, 'app://qa/fonts/' + row.file);
    assert.equal(plan([alias.toUpperCase()], { disableExternalWebFonts: true }).sources.length, 1);
  }
  let expectedPagePixels = null, expectedShapedPixels = null;
  for (const v of row.variants.filter(x => x.kind !== 'current-sfnt-control')) {
    const bytes = fs.readFileSync(v.path), url = 'qa:' + row.file + ':' + v.kind, r = renderer();
    const label = row.file + ':' + v.kind;
    const doc = sdk.HwpDocument.createEmpty();
    try {
      doc.insertText(0, 0, 0, text);
      const fontIds = Array.from({ length: 7 }, (_, language) => doc.findOrCreateFontIdForLang(language, requestedFamily));
      assert(JSON.parse(doc.applyCharFormat(0, 0, 0, text.length, JSON.stringify({ fontIds, fontSize: 1800 }))).ok);
      const props = JSON.parse(doc.getCharPropertiesAt(0, 0, 0)); assert.equal(props.fontFamily, requestedFamily);
      const preflight = JSON.parse(doc.getCanvasKitDocumentPreflight('default', 'screen'));
      assert.deepEqual(preflight.requiredFontFamilies, [requestedFamily]);
      const documentPlan = appFontPlan ? plan(preflight.requiredFontFamilies, { disableExternalWebFonts: true })
        : { sources: [{ url, aliases: [alias, korean] }], unavailableFonts: [] };
      assert.equal(documentPlan.unavailableFonts.length, 0); assert.equal(documentPlan.sources.length, 1);
      for (const source of documentPlan.sources) urls.set(source.url, bytes);
      assert.equal(await r.prepareBundledFonts(documentPlan.sources), 1);
      const prepared = r.findPreparedTypeface(requestedFamily);
      assert(prepared?.fontManager && prepared.typeface);
      assert.equal(r.findPreparedTypeface(alias), prepared); assert.equal(r.findPreparedTypeface(korean), prepared);
      const style = { weight: ck.FontWeight.ExtraBold, width: ck.FontWidth.Normal, slant: ck.FontSlant.Upright };
      const bare = prepared.fontManager.matchFamilyStyle(alias, style);
      if (!bare) bareLookupMisses.push(label); else bare.delete();
      const native = prepared.fontManager.matchFamilyStyle(prepared.fontFamily, style);
      assert(native); native.delete();
      const fontStatus = appFontPlan ? analyzeDocumentFonts([requestedFamily], { localFonts: [], localSupported: false }) : null;
      if (fontStatus) assert.equal(fontStatus.fonts[0].source, 'web');
      for (let language = 0; language < 7; language++) {
        assert(JSON.parse(doc.registerExactFontSource(props.charShapeId, language, bytes, 0)).ok);
      }
      const tree = JSON.parse(doc.getPageLayerTreeWithProfile(0, 'screen', false, false));
      const canvas = new TransportCanvas(Math.ceil(tree.pageWidth), Math.ceil(tree.pageHeight));
      r.renderPage(tree, canvas, 1);
      assert(canvas.pixels?.some((v, i) => i % 4 !== 3 && v < 250));
      const pagePixels = sha(canvas.pixels), diagnostics = r.diagnostics();
      assert(diagnostics.lastRenderCompleted); assert.equal(diagnostics.lastUnexpectedUnsupportedOps.length, 0);
      recordCleanup(label + ':page');
      const roundTrips = [];
      for (const format of ['hwp', 'hwpx']) {
        const saved = format === 'hwp' ? doc.exportHwp() : doc.exportHwpx();
        fs.writeFileSync(path.join(output, label.replaceAll(':', '-') + '.' + format), saved);
        const reopened = new sdk.HwpDocument(saved);
        try {
          const p = JSON.parse(reopened.getCharPropertiesAt(0, 0, 0)); assert.equal(p.fontFamily, requestedFamily); assert.equal(p.fontSize, 1800);
          if (appFontPlan) {
            const reopenedPreflight = JSON.parse(reopened.getCanvasKitDocumentPreflight('default', 'screen'));
            assert.deepEqual(plan(reopenedPreflight.requiredFontFamilies, { disableExternalWebFonts: true }), documentPlan);
          }
          const reopenedTree = JSON.parse(reopened.getPageLayerTreeWithProfile(0, 'screen', false, false));
          assert.equal(ops(reopenedTree).filter(x => x.type === 'textRun').map(x => x.text).join(''), text);
          const reopenedCanvas = new TransportCanvas(canvas.width, canvas.height);
          r.renderPage(reopenedTree, reopenedCanvas, 1);
          assert.equal(sha(reopenedCanvas.pixels), pagePixels);
          recordCleanup(label + ':reopened-' + format);
          roundTrips.push({ format, bytes: saved.length, sha256: sha(saved), family: p.fontFamily,
            pagePixelSHA256: sha(reopenedCanvas.pixels) });
        } finally { reopened.free(); }
      }
      // Explicitly exercise the product shaping method with its resolved native family.
      const shaped = ck.MakeSurface(520, 80);
      let shapedPixels;
      try {
        shaped.getCanvas().clear(ck.WHITE);
        assert(r.renderShapedScriptText(shaped.getCanvas(), text, '#000000', 24, 4, 32, 0, prepared.fontManager, prepared.fontFamily, false, false));
        const image = shaped.makeImageSnapshot();
        try { const pixels = image.readPixels(0, 0, { width: 520, height: 80, colorType: ck.ColorType.RGBA_8888, alphaType: ck.AlphaType.Unpremul, colorSpace: ck.ColorSpace.SRGB }); assert(pixels); shapedPixels = sha(pixels); }
        finally { image.delete(); }
      } finally { shaped.dispose(); }
      expectedPagePixels ??= pagePixels; expectedShapedPixels ??= shapedPixels;
      assert.equal(pagePixels, expectedPagePixels); assert.equal(shapedPixels, expectedShapedPixels);
      // Exact glyph replay is a controlled resource fixture, not an engine-emitted glyphRun.
      const digest = Buffer.from(blake3(bytes)).toString('hex'), key = `font:blake3:${bytes.length}:${digest}`;
      const resource = { blobs: [{ id: 'blob', portability: 'portableBlob', digest: { algorithm: 'blake3', value: digest }, dataRef: { kind: 'fontBlob', id: key } }], faces: [{ id: 'face', blobKey: 'blob', faceIndex: 0 }] };
      const cache = new CanvasKitGlyphRunFontCache(ck), badCache = new CanvasKitGlyphRunFontCache(ck);
      const glyphIds = Array.from(prepared.typeface.getGlyphIDs('AVATAR'));
      const run = { glyphIds, positions: glyphIds.map((_, i) => ({ x: 8 + 24 * i, y: 32 })), clusters: glyphIds.map((_, i) => i),
        direction: 'ltr', bidiLevel: 0, writingMode: 'horizontal-tb', orientation: 'horizontal', variant: {},
        paintStyle: {}, placement: { runToPage: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 } },
        shapeKey: { direction: 'ltr', writingMode: 'horizontal-tb', fontInstance: { faceKey: 'face', sizePx: 24, syntheticBold: false, syntheticItalic: false } },
        diagnostics: { replayEligibility: 'portable', strictVisualEligible: true, quality: 'exact', missingGlyphCount: 0, clusterMismatchCount: 0, usedFallbackFontCount: 0 } };
      let replay;
      try {
        const resources = { fontBlobKeys: [key], fontBlobs: [] };
        cache.registerResources(resource, resources, () => bytes, 0);
        replay = cache.replayStatus(run, resource); assert(replay.replayable, replay.reason);
        const font = cache.font(run, resource); assert(font);
        const surface = ck.MakeSurface(200, 50), paint = new ck.Paint();
        try { paint.setColor(ck.BLACK); assert(drawCanvasKitGlyphRun(surface.getCanvas(), run, font, paint)); }
        finally { paint.delete(); surface.dispose(); }
        const corrupted = Buffer.from(bytes); corrupted[corrupted.length - 1] ^= 1;
        badCache.registerResources(resource, resources, () => corrupted, 0);
        assert.equal(badCache.replayStatus(run, resource).reason, 'fontBlobNotVerified');
      } finally { cache.clear(); badCache.clear(); }
      results.push({ file: row.file, kind: v.kind, fontSHA256: sha(bytes), requestedAlias: requestedFamily, resolvedNativeFamily: prepared.fontFamily,
        preflightRequiredFontFamilies: preflight.requiredFontFamilies, documentPlan, fontStatus,
        pagePixels, shapedPixels, roundTrips, engineGlyphRunCount: ops(tree).filter(x => x.type === 'glyphRun').length,
        controlledGlyphReplay: replay.report, corruptedDigestRejected: true, diagnostics });
      // Deliberate adapter failure proves product finally cleanup, not a natural rendering failure.
      assert.throws(() => r.renderPage(tree, new TransportCanvas(canvas.width, canvas.height, true), 1), /QA controlled pixel transport failure/);
      recordCleanup(label + ':controlled-error');
    } finally { doc.free(); r.dispose(); }
  }
}
assert.equal(bareLookupMisses.length, 6);
const leak = cleanup.some(x => x.outstandingBytes > 0);
const proof = { sourceSHA256: sha(fs.readFileSync(fileURLToPath(import.meta.url))), sourcePins, inputSHA256: sha(inputBytes),
  CanvasKitJS_SHA256: sha(fs.readFileSync(ckJS)), CanvasKitWASM_SHA256: sha(ckWasm), engineSHA256: sha(engineBytes), node: process.version,
  plans, bareLookupMisses, results, cleanup, allocations, observedFrees, manuallyFreedBaselineBytes, surfaceLeakObserved: leak,
  nativeAppLaunched: false, browserBootstrapVerified: false, browserFontFaceVerified: false, osFontDetectionVerified: false,
  fontBytesChanged: false, appFontPlan, koreanRequests, candidateSupply: appFontPlan
    ? 'actual Geulgyeol offline document plan; candidate responses injected at planned URLs, no product file replaced'
    : 'controlled QA URLs via existing prepareBundledFonts; unflagged catalog', releaseHeld: true };
fs.writeFileSync(path.join(output, 'proof.json'), JSON.stringify(proof, null, 2) + '\n');
console.log(JSON.stringify({ syntheticDocuments: results.length, roundTrips: results.length * 2, bareLookupMisses: bareLookupMisses.length,
  controlledGlyphReplayCases: results.length, cleanupCases: cleanup.length, allocations, observedFrees, surfaceLeakObserved: leak }));
if (leak) process.exitCode = 1;

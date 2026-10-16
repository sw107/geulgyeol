#!/usr/bin/env node
// Actual packaged Electron and browser fonts. Chooser replies are controlled only
// in this owned process; no OS chooser, physical printer, or IME claim.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';
import puppeteer from '../rhwp-studio/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
import { launchPackaged } from './packaged-electron-qa.mjs';
import { finishOwnedQA } from './electron-qa-exit.mjs';
import { validateFontInputs, assertRuntimeCompletion, fontProfileKey,
  FONT_STRINGS, FONT_SIZES, FONT_TRIALS, DOCUMENT_FAMILIES } from './lib/electron-font-runtime-contract.mjs';

const root = path.resolve(import.meta.dirname, '..'), args = process.argv.slice(2);
assert(args.length === 6 && args[0] === '--output-root' && args[2] === '--app' && args[4] === '--inputs',
  'Usage: --output-root NEW_DIRECTORY --app OWNED_APP --inputs prepared/inputs.json');
const q = path.resolve(args[1]), app = path.resolve(args[3]), inputPath = path.resolve(args[5]);
assert(!fs.existsSync(q), 'Fresh output required');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const inputBytes = fs.readFileSync(inputPath), input = JSON.parse(inputBytes);
const inventory = fs.readFileSync(path.join(root, 'desktop/web/licenses/FONT_SOURCE_PROVENANCE.json'));
const fontBytes = validateFontInputs(input, inventory);
const sdk = await import(pathToFileURL(path.join(root, 'pkg/rhwp.js')));
const engine = fs.readFileSync(path.join(root, 'pkg/rhwp_bg.wasm'));
sdk.initSync({ module: engine });
fs.mkdirSync(q); fs.mkdirSync(path.join(q, 'files')); fs.mkdirSync(path.join(q, 'font-raster'));
const write = (name, value) => fs.writeFileSync(path.join(q, name), JSON.stringify(value, null, 2) + '\n');
const control = value => write('control.json', value);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, label, ms = 45000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return; await pause(50); }
  throw Error('Timeout: ' + label);
}
function documentSnapshot(bytes) {
  const d = new sdk.HwpDocument(new Uint8Array(bytes));
  try { return { text: Array.from({ length: d.getParagraphCount(0) }, (_, p) => d.getTextRange(0, p, 0, 100000)).join('\n'),
    first: JSON.parse(d.getCharPropertiesAt(0, 0, 0)), pages: d.pageCount() }; }
  finally { d.free(); }
}

// This function is serialized into the actual Chromium renderer by Puppeteer.
async function browserFontProbe({ base64, family, weight, strings, sizes, trials }) {
  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  const times = [], constructAndLoadMs = [], metrics = []; let raster = null, png = null;
  for (let trial = 0; trial < trials; trial++) {
    const name = `${family}_${trial}`;
    const constructionStarted = performance.now();
    const face = new FontFace(name, bytes.buffer.slice(0), { weight: String(weight), style: 'normal' });
    const started = performance.now(); await face.load(); times.push(performance.now() - started);
    constructAndLoadMs.push(performance.now() - constructionStarted);
    if (face.status !== 'loaded') throw Error('FontFace did not load');
    document.fonts.add(face);
    try {
      if (!document.fonts.check(`${weight} 24px "${name}"`, strings.join(''))) throw Error('FontFaceSet check failed');
      if (trial === 0) {
        const canvas = document.createElement('canvas'); canvas.width = 1400; canvas.height = 720;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.fillStyle = '#000';
        let y = 44; const drawStarted = performance.now();
        for (const size of sizes) for (const text of strings) {
          ctx.font = `${weight} ${size}px "${name}"`; ctx.fontKerning = 'normal';
          const m = ctx.measureText(text);
          metrics.push({ size, text, width: m.width, ascent: m.actualBoundingBoxAscent, descent: m.actualBoundingBoxDescent,
            left: m.actualBoundingBoxLeft, right: m.actualBoundingBoxRight });
          ctx.fillText(text, 8, y); y += 54;
        }
        const drawAndReadStart = performance.now();
        const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        const readFinished = performance.now();
        raster = { width: canvas.width, height: canvas.height, drawMs: drawAndReadStart - drawStarted,
          readMs: readFinished - drawAndReadStart,
          sha256: Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', pixels)), x => x.toString(16).padStart(2, '0')).join('') };
        png = canvas.toDataURL('image/png').split(',')[1]; canvas.width = 0;
      }
    } finally { document.fonts.delete(face); }
  }
  return { loadMs: times, medianLoadMs: [...times].sort((a, b) => a - b)[2], constructAndLoadMs,
    medianConstructAndLoadMs: [...constructAndLoadMs].sort((a, b) => a - b)[2], metrics, raster, png };
}

async function mainPrintToPDF(file) {
  const req = typeof require === 'function' ? require : process.mainModule.require.bind(process.mainModule);
  const w = req('electron').BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('/studio/print.html'));
  if (!w) throw Error('Owned print window missing');
  const b = await w.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true });
  req('node:fs').writeFileSync(file, b, { flag: 'wx' });
  return { bytes: b.length, version: process.versions.electron };
}

let p, browser, page, frame, mainWS, sendMain, exit;
const rows = [], fonts = [], errors = [], networkFailures = [], consoleEvents = []; let failure, normal = false;
let completionCounts;
try {
  control({ id: 'startup', canceled: true, choice: 'discard' });
  const started = Date.now();
  const launched = await launchPackaged(path.join(app, 'Contents/MacOS/GeulgyeolBeta3'), q, child => {
    p = child; // Own the child even if startup fails before launchPackaged returns.
    write('owned-process.json', { pid: p.pid, executable: path.join(app, 'Contents/MacOS/GeulgyeolBeta3') });
  });
  p = launched.p;
  mainWS = new WebSocket(launched.mainEndpoint);
  await new Promise((resolve, reject) => { mainWS.onopen = resolve; mainWS.onerror = reject; });
  let seq = 0; const pending = new Map();
  mainWS.onmessage = event => { const data = JSON.parse(event.data); if (data.id) {
    const r = pending.get(data.id); pending.delete(data.id); data.error ? r.reject(Error(JSON.stringify(data.error))) : r.resolve(data.result);
  } };
  sendMain = async expression => {
    new vm.Script(expression);
    const result = await new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject });
      mainWS.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } })); });
    assert(!result.exceptionDetails, JSON.stringify(result.exceptionDetails)); return result.result.value;
  };
  browser = await puppeteer.connect({ browserWSEndpoint: launched.endpoint, defaultViewport: null, protocolTimeout: 45000 });
  await until(async () => { page = (await browser.pages()).find(p => /^http:\/\/127\.0\.0\.1:\d+\/$/.test(p.url())); return page; }, 'product window');
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', message => consoleEvents.push(message.text()));
  page.on('requestfailed', request => networkFailures.push({ url: request.url(), error: request.failure()?.errorText }));
  await page.waitForFunction(() => !document.querySelector('#save').disabled, { timeout: 45000 });
  frame = page.frames().find(f => f.url().includes('/studio/')); assert(frame);
  const runtime = await frame.evaluate(() => ({ userAgent: navigator.userAgent, fontFace: typeof FontFace,
    canvas2d: !!document.createElement('canvas').getContext('2d'), developmentGlobals: [typeof window.__wasm, typeof window.__inputHandler] }));
  assert.deepEqual(runtime.developmentGlobals, ['undefined', 'undefined']);
  write('runtime.json', { startupToReadyMs: Date.now() - started, ...runtime });
  const settle = async () => { await page.waitForFunction(() => !document.querySelector('#save').disabled, { timeout: 45000 }); await pause(100); };
  const click = id => page.evaluate(id => document.getElementById(id).click(), id);
  const exported = async ext => Buffer.from(await frame.evaluate(ext => Array.from(window.baramHost.export(ext)), ext));
  await frame.evaluate(() => window.rhwpStudio.plugins.load('hwpctrl'));
  for (const family of DOCUMENT_FAMILIES) {
    const label = 'doc-' + rows.length, text = `글결 실제 앱 ${label} AVATAR 123`;
    const d = sdk.HwpDocument.createEmpty(); let fixture;
    try { d.insertText(0, 0, 0, text); const fontIds = Array.from({ length: 7 }, (_, i) => d.findOrCreateFontIdForLang(i, family));
      assert(JSON.parse(d.applyCharFormat(0, 0, 0, text.length, JSON.stringify({ fontIds, fontSize: 1800 }))).ok); fixture = d.exportHwpx(); }
    finally { d.free(); }
    fs.writeFileSync(path.join(q, 'files', label + '.hwpx'), fixture);
    control({ id: label + '-open', openFile: label + '.hwpx', choice: 'discard' }); await click('open'); await settle();
    assert.equal(documentSnapshot(await exported('hwpx')).text, text);
    const faceState = await frame.evaluate(async family => {
      await document.fonts.ready;
      return { faces: [...document.fonts].filter(f => f.family.replaceAll('"', '') === family).map(f => ({ family: f.family, status: f.status, weight: f.weight })),
        allFaces: [...document.fonts].map(f => ({ family: f.family, status: f.status, weight: f.weight })),
        registeredCSS: document.getElementById('rhwp-web-font-faces')?.textContent,
        resources: performance.getEntriesByType('resource').filter(x => /Nanum.*ExtraBold/.test(x.name)).map(x => ({ name: x.name, duration: x.duration, transferSize: x.transferSize })) };
    }, family);
    write(label + '-font-observation.json', faceState);
    const productFontFaceObserved = faceState.faces.some(f => f.status === 'loaded');
    await frame.evaluate(() => window.rhwpStudio.plugins.invoke('hwpctrl', 'invoke', ['SetTextFile', ['편집 추가 ABC ', 'TEXT', 'insertfile']])); await pause(100);
    const edited = documentSnapshot(await exported('hwpx')); assert(edited.text.includes('편집 추가 ABC')); assert(edited.text.includes(text));
    const saves = [];
    for (const ext of ['hwp', 'hwpx']) {
      const file = label + '-saved.' + ext;
      await page.select('#format', ext); control({ id: file, file, choice: 'discard' }); await click('save'); await settle();
      const saved = fs.readFileSync(path.join(q, 'files', file)); assert.equal(documentSnapshot(saved).text, edited.text);
      control({ id: file + '-reopen', openFile: file, choice: 'discard' }); await click('open'); await settle();
      const reopened = documentSnapshot(await exported(ext)); assert.equal(reopened.text, edited.text); assert.equal(reopened.first.fontFamily, family);
      saves.push({ ext, sha256: sha(saved), bytes: saved.length, textPreserved: true, familyPreserved: true });
    }
    await page.screenshot({ path: path.join(q, label + '-product.png') });
    const command = await frame.evaluate(() => window.rhwpStudio.automation.execute('file:print', undefined, { allowDialog: true }));
    let preview;
    await until(async () => { preview = (await browser.pages()).find(x => /\/studio\/print.html$/.test(x.url()));
      return preview && await preview.evaluate(() => !!document.querySelector('#print-btn') && document.querySelectorAll('svg').length > 0); }, 'product print preview');
    const previewInfo = await preview.evaluate(() => ({ title: document.title, svgPages: document.querySelectorAll('svg').length,
      text: document.body.textContent, images: [...document.images].map(i => ({ complete: i.complete, width: i.naturalWidth })) }));
    const pdfPath = path.join(q, label + '-printToPDF.pdf');
    const pdf = await sendMain(`(${mainPrintToPDF.toString()})(${JSON.stringify(pdfPath)})`);
    assert(fs.readFileSync(pdfPath).subarray(0, 5).equals(Buffer.from('%PDF-')));
    await preview.screenshot({ path: path.join(q, label + '-preview.png') }); await preview.evaluate(() => document.getElementById('close-btn').click());
    rows.push({ family, text, editedText: edited.text, productFontFaceObserved, faceState, saves, command, previewInfo, pdf: { ...pdf, file: path.basename(pdfPath), sha256: sha(fs.readFileSync(pdfPath)) } });
    write('document-progress.json', rows);
  }
  for (const [index, row] of input.fonts.entries()) {
    let current;
    const shared = new Set(row.currentCodepoints);
    const strings = FONT_STRINGS;
    assert(strings.every(t => Array.from(t).every(c => shared.has(c.codePointAt(0)))));
    for (const [variantIndex, v] of row.variants.entries()) {
      const result = await frame.evaluate(browserFontProbe, { base64: fontBytes.get(fontProfileKey(row.file, v.kind)).toString('base64'),
        family: 'OwnedQA_' + index + '_' + variantIndex, weight: row.weight, strings, sizes: FONT_SIZES, trials: FONT_TRIALS });
      fs.writeFileSync(path.join(q, 'font-raster', row.file + '-' + v.kind + '.png'), Buffer.from(result.png, 'base64')); delete result.png;
      if (v.kind === 'current-woff2') { assert(!current); current = result; }
      assert(current, 'Pinned current WOFF2 result must exist before any alternative');
      fonts.push({ file: row.file, kind: v.kind, fontSHA256: v.sha256, bytes: v.bytes, ...result,
        sameMetricsAsCurrent: JSON.stringify(result.metrics) === JSON.stringify(current.metrics), samePixelsAsCurrent: result.raster.sha256 === current.raster.sha256 });
      write('font-progress.json', fonts);
    }
    console.log('Browser FontFace completed ' + row.file);
  }
  assert.deepEqual(errors, []);
  completionCounts = assertRuntimeCompletion(input, rows, fonts);
  normal = true;
} catch (error) {
  failure = String(error); write('failure.json', { failure, stack: error.stack }); process.exitCode = 1;
} finally {
  // Node's inspector can keep an otherwise closed Electron process alive.
  mainWS?.close(); browser?.disconnect();
  if (p) exit = await finishOwnedQA(p, { requestClose: async () => {
    control({ id: 'owned-cleanup', quit: true, choice: 'discard' });
  }, allowTerminate: true, closeTimeoutMs: 8000 });
  write('proof.json', { sourceSHA256: sha(fs.readFileSync(import.meta.filename)), inputSHA256: sha(inputBytes), engineSHA256: sha(engine),
    ASARSHA256: sha(fs.readFileSync(path.join(app, 'Contents/Resources/app.asar'))), actualPackagedElectron: true,
    productionGlobalsUnexposed: true, nativeChooserResponsesControlled: true, osChooserVerified: false, physicalPrintVerified: false,
    pdfRoute: 'product print preview + Electron webContents.printToPDF', manualGUIVerified: false, physicalIMEVerified: false,
    candidateFontBytesReplacedInProduct: false, warmSingleRendererFontFaceTrials: FONT_TRIALS,
    inputContractSHA256: sha(fs.readFileSync(path.join(root, 'scripts/lib/electron-font-runtime-contract.mjs'))), completionCounts,
    rows, fonts, errors, networkFailures, consoleEvents, failure, exit,
    allStepsCompleted: normal, fontCompatibilityDifferences: fonts.filter(f => !f.sameMetricsAsCurrent || !f.samePixelsAsCurrent).length,
    productFontFaceObservedRows: rows.filter(r => r.productFontFaceObserved).length, releaseHeld: true });
  if (!exit?.normalQuit || !normal || fonts.some(f => !f.sameMetricsAsCurrent || !f.samePixelsAsCurrent)) process.exitCode = 1;
}

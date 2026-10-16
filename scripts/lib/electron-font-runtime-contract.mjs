import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';

export const FONT_FILES = Object.freeze([
  'NanumGothic-Bold.woff2', 'NanumGothic-ExtraBold.woff2', 'NanumGothic-Regular.woff2',
  'NanumGothicCoding-Bold.woff2', 'NanumGothicCoding-Regular.woff2',
  'NanumMyeongjo-Bold.woff2', 'NanumMyeongjo-ExtraBold.woff2', 'NanumMyeongjo-Regular.woff2',
]);
export const FONT_KINDS = Object.freeze(['current-woff2', 'current-sfnt-control', 'official-full-ttf',
  'official-full-woff2-null', 'official-full-woff2-transformed']);
export const FONT_STRINGS = Object.freeze([
  '글결 편집 가나다라 한글 문서 저장 재열기 12345', 'AVATAR office ffi fi fl To WA 0123456789',
  '글결 문서 ABC 가나다 12345 DEF 라마바 67890', '가나다, 라마바. ABC: 123; (한글) [문서] / 456!',
]);
export const FONT_SIZES = Object.freeze([16, 28, 48]);
export const FONT_TRIALS = 5;
export const DOCUMENT_FAMILIES = Object.freeze([
  'NanumGothicExtraBold', '나눔고딕 ExtraBold', 'NanumMyeongjoExtraBold', '나눔명조 ExtraBold',
]);
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const pair = (file, kind) => `${file}\0${kind}`;
const sameSet = (actual, expected, label) => assert.deepEqual([...actual].sort(), [...expected].sort(), label);

/** Validate before creating outputs/starting Electron; retain the exact checked bytes. */
export function validateFontInputs(input, inventoryBytes, read = fs.readFileSync) {
  assert.equal(input.schemaVersion, 1, 'Input schema must be 1');
  assert.equal(input.productInventorySHA256, sha(inventoryBytes), 'Inventory hash mismatch');
  const inventory = JSON.parse(inventoryBytes);
  const pinned = inventory.fonts.filter(row => row.file.startsWith('Nanum'));
  assert.equal(pinned.length, 8, 'Expected exactly eight pinned Nanum files');
  sameSet(new Set(pinned.map(row => row.file)), FONT_FILES, 'Pinned font names differ');
  assert(Array.isArray(input.fonts) && input.fonts.length === 8, 'Expected eight input font rows');
  sameSet(new Set(input.fonts.map(row => row.file)), FONT_FILES, 'Input names must be the eight unique pinned files');
  const buffers = new Map();
  for (const row of input.fonts) {
    const reference = pinned.find(item => item.file === row.file);
    assert.equal(row.weight, reference.metadataWeight, 'Font weight differs from inventory');
    assert(Array.isArray(row.variants), 'Variants must be an array');
    assert.deepEqual(row.variants.map(v => v.kind), FONT_KINDS,
      'Require all five unique profiles in order, with current-woff2 first');
    assert.equal(new Set(row.variants.map(v => v.sha256)).size, 5, 'Profiles must use distinct font payloads');
    for (const v of row.variants) {
      assert(typeof v.path === 'string' && v.path.length > 0, 'Font path required');
      const bytes = read(v.path);
      assert(Buffer.isBuffer(bytes) && bytes.length >= 4 && bytes.length <= 64 * 1024 * 1024, 'Invalid font size');
      assert(Number.isSafeInteger(v.bytes) && v.bytes === bytes.length, 'Declared byte size mismatch');
      assert.equal(sha(bytes), v.sha256, 'Font payload hash mismatch');
      if (v.kind === 'current-woff2') assert.equal(v.sha256, reference.sha256, 'Current baseline is not the pinned product font');
      if (v.kind === 'official-full-ttf') assert.equal(v.sha256, reference.glyphReference.TTF_SHA256, 'Official TTF is not the pinned reference');
      const woff2 = ['current-woff2', 'official-full-woff2-null', 'official-full-woff2-transformed'].includes(v.kind);
      assert(woff2 ? bytes.subarray(0, 4).equals(Buffer.from('wOF2')) : bytes.readUInt32BE(0) === 0x00010000,
        'Font container does not match its declared profile');
      buffers.set(pair(row.file, v.kind), bytes);
    }
    assert(Array.isArray(row.currentCodepoints) && FONT_STRINGS.every(text => Array.from(text).every(c => row.currentCodepoints.includes(c.codePointAt(0)))),
      'Shared corpus must be covered by the current font');
  }
  assert.equal(buffers.size, 40);
  return buffers;
}

/** A completed loop alone is not success: require the full observed comparison matrix. */
export function assertRuntimeCompletion(input, rows, fonts) {
  assert.equal(rows.length, 4, 'Require four completed document cases');
  sameSet(new Set(rows.map(row => row.family)), DOCUMENT_FAMILIES, 'Document families must be unique and complete');
  for (const row of rows) {
    assert.deepEqual(row.saves.map(save => save.ext), ['hwp', 'hwpx'], 'Require both format saves/reopens');
    assert(row.saves.every(save => save.textPreserved === true && save.familyPreserved === true), 'Save/reopen did not preserve content and family');
    assert(row.pdf && Number.isSafeInteger(row.pdf.bytes) && row.pdf.bytes > 5, 'PDF output missing');
  }
  assert.equal(fonts.length, 40, 'Require forty observed profiles');
  const actual = new Map(fonts.map(font => [pair(font.file, font.kind), font]));
  assert.equal(actual.size, 40, 'Observed profile pairs must be unique');
  sameSet(actual.keys(), FONT_FILES.flatMap(file => FONT_KINDS.map(kind => pair(file, kind))), 'Observed profile matrix differs');
  let loads = 0, alternatives = 0, baselines = 0;
  for (const row of input.fonts) {
    const baseline = actual.get(pair(row.file, 'current-woff2'));
    assert.equal(baseline.fontSHA256, row.variants[0].sha256, 'Observed baseline hash differs');
    for (const v of row.variants) {
      const font = actual.get(pair(row.file, v.kind));
      assert.equal(font.fontSHA256, v.sha256, 'Observed font hash differs');
      assert.equal(font.bytes, v.bytes, 'Observed font size differs');
      for (const values of [font.loadMs, font.constructAndLoadMs]) {
        assert(Array.isArray(values) && values.length === FONT_TRIALS && values.every(value => Number.isFinite(value) && value >= 0),
          'Require five observed load and constructor/load timings');
      }
      loads += font.constructAndLoadMs.length;
      assert.equal(font.metrics.length, 12, 'Require all twelve text/size measurements');
      sameSet(font.metrics.map(m => `${m.size}\0${m.text}`), FONT_SIZES.flatMap(size => FONT_STRINGS.map(text => `${size}\0${text}`)), 'Text/size measurements differ');
      for (const m of font.metrics) assert(['width', 'ascent', 'descent', 'left', 'right'].every(k => Number.isFinite(m[k])), 'Invalid measured metric');
      assert.equal(font.raster.width, 1400); assert.equal(font.raster.height, 720);
      assert(/^[a-f0-9]{64}$/.test(font.raster.sha256), 'Raster digest missing');
      assert.equal(font.sameMetricsAsCurrent, true); assert.equal(font.samePixelsAsCurrent, true);
      assert.deepEqual(font.metrics, baseline.metrics, 'Measured metrics differ from current baseline');
      assert.equal(font.raster.sha256, baseline.raster.sha256, 'Measured pixels differ from current baseline');
      if (v.kind === 'current-woff2') baselines++; else alternatives++;
    }
  }
  assert.equal(baselines, 8); assert.equal(loads, 200); assert.equal(alternatives, 32);
  const saves = rows.reduce((n, row) => n + row.saves.length, 0);
  assert.equal(saves, 8);
  return { fontProfiles: actual.size, fontFaceLoads: loads, baselineProfiles: baselines, alternativeComparisons: alternatives,
    documentCases: rows.length, saves, reopens: saves, pdfs: rows.length };
}

export const fontProfileKey = pair;

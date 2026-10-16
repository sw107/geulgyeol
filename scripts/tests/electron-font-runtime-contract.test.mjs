import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { validateFontInputs, assertRuntimeCompletion, FONT_FILES, FONT_KINDS,
  FONT_STRINGS, FONT_SIZES, DOCUMENT_FAMILIES } from '../lib/electron-font-runtime-contract.mjs';

const sha = b => crypto.createHash('sha256').update(b).digest('hex');
// These are schema/decision fixtures, not fonts claimed to pass Chromium parsing.
function fixture() {
  const files = new Map();
  const fonts = FONT_FILES.map(file => ({ file,
    weight: file.includes('ExtraBold') ? 800 : file.includes('-Bold') ? 700 : 400,
    currentCodepoints: [...new Set(Array.from(FONT_STRINGS.join(''), c => c.codePointAt(0)))].sort((a, b) => a - b),
    variants: FONT_KINDS.map(kind => {
      const magic = kind.includes('woff2') ? Buffer.from('wOF2') : Buffer.from([0, 1, 0, 0]);
      const bytes = Buffer.concat([magic, Buffer.from(file + kind)]), path = `fixture:${file}:${kind}`;
      files.set(path, bytes); return { kind, path, bytes: bytes.length, sha256: sha(bytes) };
    }),
  }));
  const inventory = Buffer.from(JSON.stringify({ fonts: fonts.map(row => ({ file: row.file,
    metadataWeight: row.weight, sha256: row.variants[0].sha256,
    glyphReference: { TTF_SHA256: row.variants[2].sha256 } })) }));
  const input = { schemaVersion: 1, productInventorySHA256: sha(inventory), fonts };
  const rows = DOCUMENT_FAMILIES.map(family => ({ family,
    saves: ['hwp', 'hwpx'].map(ext => ({ ext, textPreserved: true, familyPreserved: true })), pdf: { bytes: 100 } }));
  const results = fonts.flatMap(row => row.variants.map(v => ({ file: row.file, kind: v.kind,
    fontSHA256: v.sha256, bytes: v.bytes, loadMs: [0, 0, 0, 0, 0], constructAndLoadMs: [1, 2, 1, 2, 1],
    metrics: FONT_SIZES.flatMap(size => FONT_STRINGS.map(text => ({ size, text, width: 100, ascent: 10, descent: 2, left: 0, right: 100 }))),
    raster: { width: 1400, height: 720, sha256: sha(Buffer.from(row.file)) }, sameMetricsAsCurrent: true, samePixelsAsCurrent: true,
  })));
  return { input, inventory, read: path => files.get(path), files, rows, results };
}

test('complete input and observed matrix require 40 profiles, 200 loads and 32 alternatives', () => {
  const f = fixture();
  assert.equal(validateFontInputs(f.input, f.inventory, f.read).size, 40);
  assert.deepEqual(assertRuntimeCompletion(f.input, f.rows, f.results), {
    fontProfiles: 40, fontFaceLoads: 200, baselineProfiles: 8, alternativeComparisons: 32,
    documentCases: 4, saves: 8, reopens: 8, pdfs: 4,
  });
});

const invalidInputs = {
  'official-TTF-only rows': f => { for (const row of f.input.fonts) row.variants = [row.variants[2]]; },
  'empty variant arrays': f => { for (const row of f.input.fonts) row.variants = []; },
  'one missing variant': f => { f.input.fonts[0].variants.pop(); },
  'duplicate font name': f => { f.input.fonts[1] = structuredClone(f.input.fonts[0]); },
  'unknown font name': f => { f.input.fonts[0].file = 'Unknown.woff2'; },
  'duplicate variant kind': f => { f.input.fonts[0].variants[1] = structuredClone(f.input.fonts[0].variants[0]); },
  'TTF moved to baseline position': f => { const v = f.input.fonts[0].variants; [v[0], v[2]] = [v[2], v[0]]; },
  'current baseline payload replaced by full TTF': f => {
    const v = f.input.fonts[0].variants; v[0] = { ...v[2], kind: 'current-woff2' };
  },
  'current baseline hash rebound to a different WOFF2': f => {
    const v = f.input.fonts[0].variants, bytes = Buffer.from('wOF2 changed baseline');
    f.files.set(v[0].path, bytes); Object.assign(v[0], { bytes: bytes.length, sha256: sha(bytes) });
  },
  'official reference rebound': f => {
    const v = f.input.fonts[0].variants, bytes = Buffer.concat([Buffer.from([0, 1, 0, 0]), Buffer.from('changed reference')]);
    f.files.set(v[2].path, bytes); Object.assign(v[2], { bytes: bytes.length, sha256: sha(bytes) });
  },
  'profile payload reused under another name': f => {
    const v = f.input.fonts[0].variants; v[3] = { ...v[4], kind: 'official-full-woff2-null' };
  },
  'declared size changed': f => { f.input.fonts[0].variants[0].bytes++; },
  'payload changed without updating hash': f => { const v = f.input.fonts[0].variants[1]; f.files.get(v.path)[4] ^= 1; },
  'font weight changed': f => { f.input.fonts[0].weight = 123; },
  'schema changed': f => { f.input.schemaVersion = 2; },
};
for (const [name, mutate] of Object.entries(invalidInputs)) test('reject input: ' + name, () => {
  const f = fixture(); mutate(f); assert.throws(() => validateFontInputs(f.input, f.inventory, f.read));
});

const invalidResults = {
  'empty profiles cannot pass vacuously': f => { f.results = []; },
  'eight TTF self comparisons cannot pass': f => { f.results = f.results.filter(r => r.kind === 'official-full-ttf'); },
  'missing observed profile': f => { f.results.pop(); },
  'duplicate observed pair at forty records': f => { f.results[1] = structuredClone(f.results[0]); },
  'changed observed baseline hash': f => { f.results[0].fontSHA256 = '0'.repeat(64); },
  'four constructor timings': f => { f.results[0].constructAndLoadMs.pop(); },
  'missing load timing': f => { f.results[0].loadMs = []; },
  'nonfinite timing': f => { f.results[0].loadMs[0] = NaN; },
  'missing text/size measurement': f => { f.results[0].metrics.pop(); },
  'duplicate text/size measurement': f => { f.results[0].metrics[1] = structuredClone(f.results[0].metrics[0]); },
  'metric mismatch hidden by true flag': f => { f.results[1].metrics[0].width++; },
  'pixel mismatch hidden by true flag': f => { f.results[1].raster.sha256 = '0'.repeat(64); },
  'missing document': f => { f.rows.pop(); },
  'duplicate document family': f => { f.rows[0].family = f.rows[1].family; },
  'missing save/reopen': f => { f.rows[0].saves.pop(); },
  'same format twice': f => { f.rows[0].saves[1].ext = 'hwp'; },
  'missing PDF': f => { delete f.rows[0].pdf; },
};
for (const [name, mutate] of Object.entries(invalidResults)) test('reject completion: ' + name, () => {
  const f = fixture(); validateFontInputs(f.input, f.inventory, f.read); mutate(f);
  assert.throws(() => assertRuntimeCompletion(f.input, f.rows, f.results));
});

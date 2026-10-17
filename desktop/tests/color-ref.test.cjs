const {test} = require('node:test');
const assert = require('node:assert/strict');
const {pathToFileURL} = require('node:url');
const path = require('node:path');

const ui = name => import(pathToFileURL(path.resolve(__dirname, '../../rhwp-studio/src/ui', name)));
const colors = ui('color-ref.ts');

test('HWP color bytes map to RGB picker values in both directions', async () => {
  const {colorRefToHex, hexToColorRef} = await colors;
  for (const [ref, hex] of [
    [0, '#000000'], [0xffffff, '#ffffff'],
    [0x0000ff, '#ff0000'], [0x00ff00, '#00ff00'], [0xff0000, '#0000ff'],
    [0x563412, '#123456'], [0xefcdab, '#abcdef'],
  ]) {
    assert.equal(colorRefToHex(ref), hex);
    assert.equal(hexToColorRef(hex), ref);
    assert.equal(hexToColorRef(hex.toUpperCase()), ref);
    assert.equal(hexToColorRef(hex.slice(1)), ref);
  }
});

test('picker display ignores upper-byte flags and CLR_NONE without changing channel order', async () => {
  const {colorRefToHex} = await colors;
  assert.equal(colorRefToHex(0x80563412), '#123456');
  assert.equal(colorRefToHex(-1), '#ffffff');
  assert.equal(colorRefToHex(0xff000000), '#000000');
});

test('RGB picker round trips preserve every channel value', async () => {
  const {colorRefToHex, hexToColorRef} = await colors;
  for (let channel = 0; channel < 256; channel++) {
    for (const shift of [0, 8, 16]) {
      const value = channel << shift;
      assert.equal(hexToColorRef(colorRefToHex(value)), value);
    }
  }
});

function form() {
  return {
    common: {sizeProtect: true, treatAsChar: true},
    transform: {}, outerMargin: {}, caption: {present: false}, line: {},
    shapeTextBox: {}, shapeCorner: {customChecked: false, activeIndex: 0},
    shapeFill: {solidChecked: true}, shapeShadow: {present: false},
    image: {effectControlsPresent: false},
  };
}

function checkColorPatches({buildPicturePropsPatch}) {
  const props = {sizeProtect: true, treatAsChar: true};
  const shape = {fillType: 'solid', fillBgColor: 0x80563412, fillPatColor: -1};
  const input = form();
  input.shapeFill.solidColors = {face: '#123456', pattern: '#ffffff'};
  assert.deepEqual(buildPicturePropsPatch('shape', props, shape, input), {});

  input.line.color = '#123456';
  input.shapeFill.solidColors = {face: '#abcdef', pattern: '#0000ff'};
  input.shapeShadow = {present: true, activeIndex: 1, color: '#ff0000', offsetX: '0', offsetY: '0'};
  assert.deepEqual(buildPicturePropsPatch('shape', props, shape, input), {
    borderColor: 0x563412, fillBgColor: 0xefcdab, fillPatColor: 0xff0000,
    shadowType: 1, shadowColor: 0xff, shadowOffsetX: 0, shadowOffsetY: 0,
  });
}

test('picture property patches retain unchanged fill flags and convert edited border, fill and shadow colors', async () => {
  checkColorPatches(await ui('picture-props-apply-model.ts'));
});

test('transparent-fill QA data URL loader imports the real model and applies color patches', async () => {
  const {loadTransparentFillModel} = await import('../../scripts/check-transparent-fill.mjs');
  checkColorPatches(await loadTransparentFillModel());
});

test('caption-history QA source-strip loader binds the real color helper for color patches', async () => {
  const {loadCaptionModel} = await import('../../scripts/check-caption-history.mjs');
  checkColorPatches(await loadCaptionModel());
});

test('transparent-fill QA resolves helpers beside a selected source and supports sources without imports', async () => {
  const fs = require('node:fs/promises');
  const os = require('node:os');
  const {loadTransparentFillModel} = await import('../../scripts/check-transparent-fill.mjs');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'geulgyeol-color-loader-'));
  const source = path.join(root, 'model.ts');
  try {
    await fs.writeFile(source, "import {hexToColorRef} from './color-ref.ts';\nexport const color = hexToColorRef('#123456');\n");
    await fs.writeFile(path.join(root, 'color-ref.ts'), 'export function hexToColorRef(hex: string): number { return 42; }\n');
    assert.equal((await loadTransparentFillModel(source)).color, 42);
    await fs.unlink(path.join(root, 'color-ref.ts'));
    await fs.writeFile(source, 'export const color = 7;\n');
    assert.equal((await loadTransparentFillModel(source)).color, 7);
  } finally {
    await fs.rm(root, {recursive: true, force: true});
  }
});

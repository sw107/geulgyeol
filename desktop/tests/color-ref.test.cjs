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

test('picture property patches retain unchanged fill flags and convert edited border, fill and shadow colors', async () => {
  const {buildPicturePropsPatch} = await ui('picture-props-apply-model.ts');
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
});

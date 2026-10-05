const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

test('inline pictures share lines, wrap and paginate without loss or duplicate emission after both exports', async () => {
  const root = path.resolve(process.env.BARAM_ENGINE_DIR || path.join(__dirname, '../web/studio'));
  const { initSync, HwpDocument } = await import(pathToFileURL(root + '/rhwp.js'));
  initSync({ module: fs.readFileSync(root + '/rhwp_bg.wasm') });
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWZkAAAAASUVORK5CYII=', 'base64');
  function boxes(doc) {
    return Array.from({ length: doc.pageCount() }, (_, p) => [...doc.renderPageSvg(p).matchAll(/<image\b[^>]*>/g)]
      .map(([tag]) => ['x', 'y', 'width', 'height'].map(key => {
        const value = Number(tag.match(new RegExp(`\\b${key}="([^"]+)"`))?.[1]);
        assert.ok(Number.isFinite(value));
        return Math.round(value * 1000) / 1000;
      })).sort((a,b) => a[1] - b[1] || a[0] - b[0]));
  }
  for (const [count, width, height, pageCounts, text = ''] of [
    [3, 6000, 3000, [3]], [3, 20000, 3000, [3]], [5, 20000, 30000, [4, 1]],
    [1, 20000, 30000, [1], '그림 옆의 한글 본문을 유지합니다.'],
    [3, 20000, 30000, [3], '그림 옆의 한글 본문을 유지합니다.'],
    [5, 20000, 30000, [4, 1], '한글'],
  ]) {
    const doc = HwpDocument.createEmpty();
    try {
      doc.createBlankDocument();
      if (text) doc.insertText(0, 0, 0, text);
      for (let i = 0; i < count; i++) doc.insertPicture(0, 0, 0, '', png, width, height, 1, 1, 'png', `picture-${i}`);
      for (const c of JSON.parse(doc.getControls()).filter(c => c.ctrlId === 'gso'))
        doc.setPictureProperties(0, c.para, c.controlIndex, '{"treatAsChar":true}');
      // Horizontal navigation and text mutation must share scalar coordinates,
      // even when several inline pictures precede the first text character.
      if (text) {
        const length = doc.getParagraphLength(0, 0);
        for (let offset = 0; offset <= length; offset++) for (const delta of [-1, 1]) {
          const next = JSON.parse(doc.navigateNextEditableText(0, 0, offset, delta, '[]'));
          if ((offset === 0 && delta < 0) || (offset === length && delta > 0))
            assert.equal(next.type, 'boundary');
          else assert.equal(next.charOffset, offset + delta);
        }
        const before = JSON.parse(doc.getTextFileText());
        assert.throws(() => doc.replaceBodyTextLocal(0, 0, length + 1, 0, 'ㅎ'));
        assert.equal(JSON.parse(doc.getTextFileText()), before);
      }
      const expected = boxes(doc);
      assert.deepEqual(expected.map(p => p.length), pageCounts);
      if (count >= 2) {
        assert.equal(expected[0][0][1], expected[0][1][1], 'first two pictures share a line');
        assert.ok(expected[0][1][0] >= expected[0][0][0] + expected[0][0][2] - 0.01);
      }
      if (count >= 3) {
        if (width === 20000) assert.ok(expected[0][2][1] >= expected[0][0][1] + expected[0][0][3]);
        else assert.equal(expected[0][2][1], expected[0][0][1]);
      }
      for (const format of ['Hwp', 'Hwpx']) {
        let current = doc;
        try {
          for (let cycle = 0; cycle < 3; cycle++) {
            const artifact = current[`export${format}WithReport`]();
            let next;
            try {
              assert.equal(JSON.parse(artifact.contentLoss()).count, 0);
              next = new HwpDocument(artifact.takeBytes());
            } finally { artifact.free(); }
            if (current !== doc) current.free();
            current = next;
            assert.deepEqual(boxes(current), expected, `${format} cycle ${cycle + 1}`);
            assert.equal(JSON.parse(current.getTextFileText()).trim(), text);
          }
        } finally { if (current !== doc) current.free(); }
      }
      const controls = JSON.parse(doc.getControls()).filter(c => c.ctrlId === 'gso');
      for (const c of controls) doc.setPictureProperties(0, c.para, c.controlIndex, '{"width":6000,"height":3000}');
      const shrunk = boxes(doc);
      assert.deepEqual(shrunk.map(p => p.length), [count], 'shrinking recomputes pagination');
      assert.ok(shrunk[0].every(b => b[1] === shrunk[0][0][1]), 'small pictures fit on one line');
      for (const c of controls) doc.setPictureProperties(0, c.para, c.controlIndex, JSON.stringify({width, height}));
      assert.deepEqual(boxes(doc), expected, 'enlarging restores wrapping and pagination');
      for (const format of ['Hwp', 'Hwpx']) {
        const artifact = doc[`export${format}WithReport`]();
        let reopened;
        try {
          reopened = new HwpDocument(artifact.takeBytes());
          assert.deepEqual(boxes(reopened), expected, `resize then ${format} reopen`);
        } finally { reopened?.free(); artifact.free(); }
      }
      if (text && count === 5) {
        const seed = doc.exportHwpxWithReport();
        let edited;
        try { edited = new HwpDocument(seed.takeBytes()); } finally { seed.free(); }
        try {
          for (const format of ['Hwpx', 'Hwp', 'Hwpx', 'Hwp', 'Hwpx']) {
            const before = JSON.parse(edited.getTextFileText()).trim();
            const offset = Math.min(1, Array.from(before).length);
            edited.insertText(0, 0, offset, '추가');
            const characters = Array.from(before); characters.splice(offset, 0, '추가');
            assert.equal(JSON.parse(edited.getTextFileText()).trim(), characters.join(''));
            const beforeSave = boxes(edited);
            assert.deepEqual(beforeSave.map(p => p.length), [4, 1]);
            const artifact = edited[`export${format}WithReport`]();
            let reopened;
            try {
              assert.equal(JSON.parse(artifact.contentLoss()).count, 0);
              reopened = new HwpDocument(artifact.takeBytes());
            } finally { artifact.free(); }
            edited.free(); edited = reopened;
            assert.deepEqual(boxes(edited), beforeSave, `edited HWPX axis after ${format} save`);
            assert.equal(JSON.parse(edited.getTextFileText()).trim(), characters.join(''));
          }
        } finally { edited?.free(); }
      }
    } finally { doc.free(); }
  }
});

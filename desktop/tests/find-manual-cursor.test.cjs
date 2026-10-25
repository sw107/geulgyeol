const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {pathToFileURL} = require('node:url');
const {stripTypeScriptTypes} = require('node:module');

const root = path.resolve(__dirname, '../..');
const exportsObject = {};
const source = stripTypeScriptTypes(fs.readFileSync(path.join(root, 'rhwp-studio/src/ui/find-dialog.ts'), 'utf8'),
  {mode: 'transform'}).replace(/\bexport\s+/g, '');
vm.runInNewContext(source + '\nObject.assign(api, {FindDialog});', {api: exportsObject});
let enginePromise;
function engine() {
  return enginePromise ??= (async () => {
    const folder = process.env.GEULGYEOL_QA_ENGINE_DIR || path.join(root, 'desktop/web/studio');
    const M = await import(pathToFileURL(path.join(folder, 'rhwp.js')));
    M.initSync({module: fs.readFileSync(path.join(folder, 'rhwp_bg.wasm'))});
    return M;
  })();
}
const text = 'needle --- needle --- needle';
function controller(d) {
  let pos = {sectionIndex: 0, paragraphIndex: 0, charOffset: 0}, anchor = null;
  const calls = [];
  const ih = {
    getCursorPosition: () => ({...pos}),
    getSelection: () => !anchor ? null : anchor.charOffset <= pos.charOffset
      ? {start: {...anchor}, end: {...pos}} : {start: {...pos}, end: {...anchor}},
    moveCursorTo(next) {anchor = null; pos = {...next};},
    cursor: {
      clearSelection() {anchor = null;}, moveTo(next) {pos = {...next};}, setAnchor() {anchor = {...pos};},
    },
    executeOperation(op) {calls.push('snapshot'); op.operation(wasm);},
  };
  const wasm = {
    documentGeneration: 1,
    searchText(...args) {calls.push(['search', ...args]); return JSON.parse(d.searchText(...args));},
    replaceText(...args) {calls.push(['replace', ...args]); return JSON.parse(d.replaceText(...args));},
  };
  const dialog = new exportsObject.FindDialog({wasm, getInputHandler: () => ih, eventBus: {emit() {}}}, 'replace');
  Object.assign(dialog, {queryInput: {value: 'needle'}, replaceInput: {value: 'Q'},
    caseSensitiveCheck: {checked: true}, statusLabel: {style: {}, textContent: ''}});
  dialog.findNext();
  assert.equal(dialog.currentHit.charOffset, 0);
  calls.length = 0;
  return {dialog, calls,
    click(offset) {ih.moveCursorTo({sectionIndex: 0, paragraphIndex: 0, charOffset: offset});},
    select(start, end) {ih.moveCursorTo({sectionIndex: 0, paragraphIndex: 0, charOffset: start}); ih.cursor.setAnchor(); ih.cursor.moveTo({sectionIndex: 0, paragraphIndex: 0, charOffset: end});},
  };
}

for (const format of ['hwp', 'hwpx']) {
  for (const scenario of ['click at old focus', 'different selection', 'unchanged selection', 'reversed same selection']) {
    test(`${format}: ${scenario} retains the intended navigation/replace behavior`, async () => {
      const M = await engine(), seed = M.HwpDocument.createEmpty();
      let doc, reopened;
      try {
        assert(JSON.parse(seed.insertText(0, 0, 0, text)).ok);
        doc = new M.HwpDocument(format === 'hwp' ? seed.exportHwp() : seed.exportHwpx());
        const before = Buffer.from(doc.exportHwpx()), c = controller(doc);
        if (scenario === 'click at old focus') {
          c.click(6); c.dialog.findPrev();
          assert.equal(c.dialog.currentHit.charOffset, 0, 'a click removed the match selection');
          assert.deepEqual(Buffer.from(doc.exportHwpx()), before);
        } else if (scenario === 'different selection') {
          c.select(11, 17); c.dialog.doReplace();
          assert(!c.calls.some(call => Array.isArray(call) && call[0] === 'replace'));
          assert.equal(c.dialog.currentHit.charOffset, 22);
          assert.deepEqual(Buffer.from(doc.exportHwpx()), before);
        } else {
          if (scenario === 'reversed same selection') c.select(6, 0);
          c.dialog.doReplace();
          assert.equal(c.calls.filter(call => Array.isArray(call) && call[0] === 'replace').length, 1);
          assert.equal(c.calls.filter(call => call === 'snapshot').length, 1);
        }
        reopened = new M.HwpDocument(doc.exportHwpx());
        const first = JSON.parse(reopened.searchText('needle', 0, 0, 0, true, true, true));
        assert.equal(first.charOffset, scenario.includes('same selection') || scenario === 'unchanged selection' ? 6 : 0);
      } finally {reopened?.free(); doc?.free(); seed.free();}
    });
  }
}

for (const format of ['hwp', 'hwpx']) {
  for (const action of ['previous', 'replace']) {
    test(`${format}: ${action} honors a manually moved cursor instead of the old search hit`, async () => {
      const M = await engine(), seed = M.HwpDocument.createEmpty();
      let doc, reopened;
      try {
        assert(JSON.parse(seed.insertText(0, 0, 0, text)).ok);
        doc = new M.HwpDocument(format === 'hwp' ? seed.exportHwp() : seed.exportHwpx());
        const before = Buffer.from(doc.exportHwpx());
        const c = controller(doc);
        c.click(18);
        if (action === 'previous') {
          c.dialog.findPrev();
          assert.equal(c.dialog.currentHit.charOffset, 11, 'previous match must be before the current caret');
        } else {
          c.dialog.doReplace();
          assert(!c.calls.some(call => Array.isArray(call) && call[0] === 'replace'), 'a deselected old hit must not be replaced');
          assert.equal(c.dialog.currentHit.charOffset, 22, 'find the next match at the new caret first');
        }
        assert.deepEqual(Buffer.from(doc.exportHwpx()), before, 'the first action only navigates');
        reopened = new M.HwpDocument(doc.exportHwpx());
        assert.equal(JSON.parse(reopened.searchText('needle', 0, 0, 0, true, true, true)).charOffset, 0);
      } finally {reopened?.free(); doc?.free(); seed.free();}
    });
  }
}

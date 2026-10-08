// Real UI methods/commands and fresh WASM. Cursor/DOM/operation dispatch use a headless adapter.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';
const [engineDir, fixtures, out, inputHandlerSource] = process.argv.slice(2);
assert(engineDir && fixtures && out, 'ENGINE_DIR FIXTURE_DIR OUTPUT_DIR');
fs.mkdirSync(out, {
  recursive: true
});
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const wasmBytes = fs.readFileSync(path.resolve(engineDir, 'rhwp_bg.wasm'));
const {
  initSync,
  HwpDocument
} = await import(pathToFileURL(path.resolve(engineDir, 'rhwp.js')));
initSync({
  module: wasmBytes
});
const load = async s => import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(s, {
  mode: 'transform'
}).replace(/^import .*?;\s*$/gm, '')).toString('base64'));
const method = (s, n) => {
  let a = s.indexOf('  ' + n + '(');
  if (a < 0) a = s.indexOf('  ' + n + '<');
  if (a < 0) a = s.indexOf('  private ' + n + '(');
  assert(a >= 0, n);
  return s.slice(a, s.indexOf('\n  }\n', a) + 4) + '\n';
};
const bs = fs.readFileSync(path.join(root, 'rhwp-studio/src/core/wasm-bridge.ts'), 'utf8');
let bridge = 'class BridgeProbe {doc;constructor(doc){this.doc=doc;}\n';
for (const n of ['runInBatch', 'getTableDimensions', 'getTableDimensionsByPath', 'getCellInfo', 'getCellInfoByPath', 'getCellParagraphCount', 'getCellParagraphCountByPath', 'getCellParaPropertiesAtByPath', 'applyParaFormatInCellsByPaths', 'saveSnapshot', 'restoreSnapshot', 'discardSnapshot', 'getParaPropertiesAt', 'getCellParaPropertiesAt', 'applyParaFormat', 'applyParaFormatInCell', 'setParaShapeId', 'setCellParaShapeId', 'getCursorRectByPath', 'getCursorRectInCell', 'getLineInfoInCell']) bridge += method(bs, n);
bridge += '}\nexport {BridgeProbe};';
const {
  BridgeProbe
} = await load(bridge);
const commands = await load('const MAX_PAGE_LOCAL_TEXT_EDIT_CHARS=10000;\n' + fs.readFileSync(path.join(root, 'rhwp-studio/src/engine/command.ts'), 'utf8'));
globalThis.__gapCommands = commands;
const {
  CommandHistory
} = await load("const {NO_TEXT_MUTATION_EFFECTS}=globalThis.__gapCommands;\n" + fs.readFileSync(path.join(root, "rhwp-studio/src/engine/history.ts"), "utf8"));
const source = fs.readFileSync(inputHandlerSource ? path.resolve(inputHandlerSource) : path.join(root, 'rhwp-studio/src/engine/input-handler.ts'), 'utf8');
let handler = 'function pxToRaw2x(px){return Math.round(px*150); }\n' + fs.readFileSync(path.join(root, 'rhwp-studio/src/engine/hanging-indent.ts'), 'utf8') + 'const {ApplyParaFormatCommand}=globalThis.__gapCommands;\n' + fs.readFileSync(path.join(root, 'rhwp-studio/src/engine/cell-block-format.ts'), 'utf8') + 'class HandlerProbe {\n';
for (const n of ['applyParaAlign', 'setLineSpacing', 'applyParaPropsAtCursor', 'applyParaPropsToRange', 'applyParaFormat', 'applyParaFormatInNoteOrHeader', 'getFootnoteCharFormatSelection', 'getSelectedCellBlock', 'getParaFormatTargetsAtCursor', 'getParaFormatTargetsForCellBlock', 'getParaFormatTargetsForRange', 'executeParaFormatCommand', 'getParaProperties', 'applyStyle', 'applyHangingIndentAtCursor']) handler += method(source, n);
handler += '}\nexport {HandlerProbe};';
const {
  HandlerProbe
} = await load(handler);
function bytes(d) {
  const e = d.exportHwpxWithReport();
  try {
    assert.equal(JSON.parse(e.contentLoss()).count, 0);
    return e.takeBytes();
  } finally {
    e.free();
  }
}
assert.equal(typeof HwpDocument.prototype.applyParaFormatInCellsByPaths, 'function');
assert(fs.readFileSync(path.join(root, 'engine/src/document_core/commands/formatting.rs'), 'utf8').includes('pub fn apply_para_format_in_cell_by_path_native'));
const pj = p => JSON.stringify(p),
  target = (p, c, n = 0) => [...p.slice(0, -1), {
    ...p.at(-1),
    cellIndex: c,
    cellParaIndex: n
  }];
function pos(c, p, o = 1) {
  const first = p[0];
  return {
    sectionIndex: 0,
    paragraphIndex: c.parent,
    parentParaIndex: c.parent,
    controlIndex: first.controlIndex,
    cellIndex: first.cellIndex,
    cellParaIndex: first.cellParaIndex,
    cellPath: p,
    charOffset: o
  };
}
function leaf(d, c) {
  return Array.from({
    length: c.cellCount
  }, (_, i) => ({
    own: JSON.parse(d.getCellOwnPropertiesByPath(0, c.parent, pj(target(c.path, i)))),
    paras: [0, 1].map(n => {
      const p = target(c.path, i, n),
        text = d.getTextInCellByPath(0, c.parent, pj(p), 0, 100000);
      return {
        text,
        chars: Array.from(text, (_, o) => JSON.parse(d.getCellCharPropertiesAtByPath(0, c.parent, pj(p), o))),
        para: JSON.parse(d.getCellParaPropertiesAtByPath(0, c.parent, pj(p)))
      };
    })
  }));
}
function state(d, c) {
  return {
    leaf: leaf(d, c),
    body: d.getTextRange(0, 0, 0, 100000),
    svg: Array.from({
      length: d.pageCount()
    }, (_, i) => hash(d.renderPageSvg(i)))
  };
}
function geometry(d) {
  return Array.from({
    length: d.pageCount()
  }, (_, i) => Array.from(d.renderPageSvg(i).matchAll(/<clipPath id="cell-clip-[^"]+"><rect x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"/g), m => m.slice(1).map(Number)));
}
function ui(d, c) {
  const wasm = new BridgeProbe(d),
    h = new HandlerProbe(),
    history = [],
    commandHistory = new CommandHistory();
  let position = pos(c, c.path),
    selection = null,
    block = false,
    excluded = new Set();
  Object.assign(h, {
    wasm,
    cursor: {
      getRect: () => null,
      getPosition: () => position,
      getSelectionOrdered: () => selection,
      isInCellSelectionMode: () => block,
      isInHeaderFooter: () => false,
      isInFootnote: () => false,
      getCellTableContext: () => ({
        sec: 0,
        ppi: c.parent,
        ci: c.control,
        cellPath: c.path
      }),
      getSelectedCellRange: () => ({
        startRow: 0,
        startCol: 0,
        endRow: 0,
        endCol: 1
      }),
      getExcludedCells: () => excluded
    },
    executeOperation(op) {
      assert.equal(op.kind, 'command');
      commandHistory.execute(op.command, wasm);
      history.push(op.command);
    }
  });
  return {
    h,
    wasm,
    history,
    commandHistory,
    set(p, s, b = false, e = new Set()) {
      position = p;
      selection = s;
      block = b;
      excluded = e;
    }
  };
}
const actions = ['align-center', 'line-spacing', 'dialog-indent', 'block-align', 'multi-para', 'reverse-para', 'excluded-block', 'dialog-extras', 'shift-tab'];
let cases = 0,
  restores = 0,
  reopens = 0,
  rejections = 0,
  regressionFixed = 0,
  savedSVGEqual = 0;
const issues = [],
  rows = [],
  exports = [];
for (const c of JSON.parse(fs.readFileSync(path.join(fixtures, 'proof.json'))).fixtures) {
  for (const action of actions) {
    const d = new HwpDocument(fs.readFileSync(c.file)),
      u = ui(d, c);
    try {
      console.log(JSON.stringify({
        depth: c.depth,
        merged: c.merged,
        equations: c.equations,
        action
      }));
      const before = state(d, c);
      const selectedCell = action === 'multi-para' || action === 'reverse-para' || action === 'dialog-extras' ? 1 : 0;
      const a = pos(c, target(c.path, selectedCell), 2),
        b = pos(c, target(c.path, selectedCell, 1), 0);
      if (action === 'multi-para' || action === 'reverse-para') u.set(a, action === 'reverse-para' ? {
        start: b,
        end: a
      } : {
        start: a,
        end: b
      });else if (action === 'block-align' || action === 'excluded-block') u.set(pos(c, c.path), null, true, action === 'excluded-block' ? new Set(['0,0']) : new Set());else u.set(pos(c, target(c.path, selectedCell)), null);
      const actual = JSON.parse(d.getCellParaPropertiesAtByPath(0, c.parent, pj(target(c.path, selectedCell))));
      assert.deepEqual(u.h.getParaProperties(), actual, 'query follows innermost paragraph');
      const targets = u.h.getParaFormatTargetsAtCursor();
      assert(targets.length > 0);
      const affected = new Set(targets.map(t => `${t.cellPath?.at(-1).cellIndex ?? t.cellIdx}:${t.cellPath?.at(-1).cellParaIndex ?? t.cellParaIdx}`));
      if (action === 'shift-tab') assert.equal(u.h.applyHangingIndentAtCursor(), true);else if (action === 'line-spacing') u.h.setLineSpacing(200);else if (action === 'dialog-indent') u.h.applyParaPropsToRange(a, a, {
        indent: 900,
        marginLeft: 2100
      });else if (action === 'multi-para' || action === 'reverse-para') u.h.applyParaPropsToRange(action === 'reverse-para' ? b : a, action === 'reverse-para' ? a : b, {
        alignment: 'right',
        lineSpacing: 180,
        marginLeft: 1500
      });else if (action === 'dialog-extras') u.h.applyParaPropsAtCursor({
        tabStops: [{
          position: 1500,
          type: 0,
          fill: 0
        }],
        tabAutoLeft: true,
        fillType: 'solid',
        fillColor: '#CCFF99',
        patternType: -1,
        borderFillId: actual.borderFillId,
        borderLeft: {
          type: 1,
          width: 0,
          color: '#000000'
        },
        borderSpacing: [100, 200, 300, 400]
      });else u.h.applyParaAlign('center');
      assert.equal(u.history.length, 1, 'one paragraph command');
      const after = state(d, c);
      assert.equal(after.body, before.body);
      for (let i = 0; i < c.cellCount; i++) {
        assert.deepEqual(after.leaf[i].own, before.leaf[i].own);
        for (let n = 0; n < 2; n++) {
          const a = after.leaf[i].paras[n],
            b = before.leaf[i].paras[n];
          assert.equal(a.text, b.text);
          assert.deepEqual(a.chars, b.chars);
          if (!affected.has(`${i}:${n}`)) assert.deepEqual(a.para, b.para);else if (action === 'shift-tab') assert(a.para.indent < 0);else if (action === 'line-spacing') assert.equal(a.para.lineSpacing, 200);else if (action === 'dialog-indent') {
            assert.equal(a.para.indent, 6);
            assert.equal(a.para.marginLeft, 14);
          } else if (action === 'multi-para' || action === 'reverse-para') {
            assert.equal(a.para.alignment, 'right');
            assert.equal(a.para.lineSpacing, 180);
            assert.equal(a.para.marginLeft, 10);
          } else if (action === 'dialog-extras') assert.equal(a.para.fillColor, '#ccff99');else assert.equal(a.para.alignment, 'center');
        }
      }
      for (let n = 0; n < 3; n++) {
        u.commandHistory.undo(u.wasm);
        assert.deepEqual(state(d, c), before, 'undo formats and full SVG');
        restores++;
        u.commandHistory.redo(u.wasm);
        assert.deepEqual(state(d, c), after, 'redo formats and full SVG');
        restores++;
      }
      for (const f of ['Hwp', 'Hwpx']) {
        const e = d['export' + f + 'WithReport']();
        try {
          assert.equal(JSON.parse(e.contentLoss()).count, 0);
          const data = e.takeBytes(),
            r = new HwpDocument(data);
          try {
            const got = state(r, c);
            assert.deepEqual(got.leaf, after.leaf, 'saved/reopened exact text/char/para/cell format');
            assert.equal(got.body, after.body);
            if (JSON.stringify(got.svg) === JSON.stringify(after.svg)) savedSVGEqual++;
            if (!c.equations && !c.merged && action === 'align-center') {
              const live = geometry(d),
                saved = geometry(r);
              assert.deepEqual(saved.map(p => p.length), live.map(p => p.length));
              for (let p = 0; p < live.length; p++) for (let i = 0; i < live[p].length; i++) for (let k = 0; k < 4; k++) assert(Math.abs(saved[p][i][k] - live[p][i][k]) <= 1 / 75 + 0.000001, 'representative saved cell geometry within one HWPUNIT');
            }
            const savedFile = path.join(out, `depth${c.depth}-merged${c.merged}-equations${c.equations}-${action}.${f.toLowerCase()}`);
            fs.writeFileSync(savedFile, data);
            exports.push({
              file: path.resolve(savedFile),
              input: path.resolve(c.file),
              parent: c.parent,
              path: c.path,
              action,
              depth: c.depth
            });
            reopens++;
          } finally {
            r.free();
          }
        } finally {
          e.free();
        }
      }
      if (c.depth > 1 && !c.merged && !c.equations && actions.indexOf(action) < 4) regressionFixed++;
      rows.push({
        depth: c.depth,
        merged: c.merged,
        equations: c.equations,
        action,
        affected: [...affected],
        geometry: geometry(d)
      });
      cases++;
    } finally {
      for (const cmd of u.history) cmd.discard(u.wasm);
      d.free();
    }
  }
  const d = new HwpDocument(fs.readFileSync(c.file)),
    u = ui(d, c);
  try {
    const before = state(d, c),
      good = target(c.path, 1),
      bad = structuredClone(good);
    bad.at(-1).cellIndex = 999;
    for (const run of [() => d.applyParaFormatInCellsByPaths(0, c.parent, pj([good, bad]), '{"lineSpacing":200}'), () => d.applyParaFormatInCellsByPaths(0, c.parent, pj([good]), '{"numberingId":65535}'), () => d.applyParaFormatInCellsByPaths(0, c.parent, '[[]]', '{"indent":900}'), () => d.applyParaFormatInCellsByPaths(0, c.parent, pj([good]), '{"indent":"x"}')]) {
      assert.throws(run);
      assert.deepEqual(state(d, c), before);
      rejections++;
    }
    if (c.depth > 1) {
      const a = pos(c, good, 2),
        cross = pos(c, target(c.path, 2, 1), 4);
      u.set(a, {
        start: a,
        end: cross
      });
      u.h.applyParaPropsToRange(a, cross, {
        indent: 900
      });
      assert.equal(u.history.length, 0);
      assert.deepEqual(state(d, c), before);
      rejections++;
      u.set(a, {
        start: a,
        end: pos(c, bad, 4)
      });
      u.h.applyParaPropsToRange(a, pos(c, bad, 4), {
        indent: 900
      });
      assert.equal(u.history.length, 0);
      assert.deepEqual(state(d, c), before);
      rejections++;
      u.set(a, null);
      u.h.applyStyle(0);
      assert.equal(u.history.length, 0);
      assert.deepEqual(state(d, c), before, 'unsupported nested style assignment boundary retained');
      rejections++;
      const malformed = structuredClone(good);
      malformed[0].controlIndex = 999;
      const p = pos(c, malformed);
      u.set(p, null);
      u.h.applyParaAlign('center');
      assert.equal(u.history.length, 0);
      assert.deepEqual(state(d, c), before, 'failed command rollback');
      rejections++;
    }
  } finally {
    for (const cmd of u.history) cmd.discard(u.wasm);
    d.free();
  }
}
let historyBudgetCases = 0,
  historyBudgetCommands = 0,
  historyBudgetRestores = 0;
for (const c of JSON.parse(fs.readFileSync(path.join(fixtures, 'proof.json'))).fixtures.filter(c => !c.merged && !c.equations)) {
  const d = new HwpDocument(fs.readFileSync(c.file)),
    u = ui(d, c),
    states = [state(d, c)];
  try {
    for (let i = 0; i < 125; i++) {
      u.h.applyParaAlign(i % 2 ? 'right' : 'center');
      states.push(state(d, c));
      assert(u.commandHistory.liveSnapshotIds() <= 98);
      historyBudgetCommands++;
    }
    for (let i = 0; i < 20; i++) {
      u.commandHistory.undo(u.wasm);
      assert(u.commandHistory.liveSnapshotIds() <= 98);
      historyBudgetRestores++;
    }
    assert.deepEqual(state(d, c), states[105]);
    for (let i = 0; i < 20; i++) {
      u.commandHistory.redo(u.wasm);
      assert(u.commandHistory.liveSnapshotIds() <= 98);
      historyBudgetRestores++;
    }
    assert.deepEqual(state(d, c), states[125]);
    u.commandHistory.undo(u.wasm);
    const prior = state(d, c);
    u.h.setLineSpacing(200);
    const edited = state(d, c);
    u.commandHistory.undo(u.wasm);
    assert.deepEqual(state(d, c), prior);
    u.commandHistory.redo(u.wasm);
    assert.deepEqual(state(d, c), edited);
    historyBudgetRestores += 3;
    u.commandHistory.clear(u.wasm);
    assert.equal(u.commandHistory.liveSnapshotIds(), 0);
    for (const cmd of u.history) assert.equal(cmd.snapshotResourceCount(), 0);
    historyBudgetCases++;
  } finally {
    u.commandHistory.clear(u.wasm);
    d.free();
  }
}
fs.writeFileSync(path.join(out, 'export-manifest.json'), JSON.stringify(exports, null, 2));
assert.equal(regressionFixed, 8);
const proof = {
  historyBudgetCases,
  historyBudgetCommands,
  historyBudgetRestores,
  cases,
  regressionFixed,
  restores,
  reopens,
  rejections,
  savedSVGEqual,
  representativeSavedGeometryTolerancePx: 1 / 75,
  rows,
  engineSHA256: hash(wasmBytes),
  inputHandlerSHA256: hash(source),
  GUIVerified: false,
  DOMAndCursorMocked: true,
  operationDispatchAdapter: true
};
fs.writeFileSync(path.join(out, 'proof.json'), JSON.stringify(proof, null, 2));
console.log(JSON.stringify({
  historyBudgetCases,
  historyBudgetCommands,
  historyBudgetRestores,
  cases,
  regressionFixed,
  restores,
  reopens,
  rejections,
  savedSVGEqual
}));

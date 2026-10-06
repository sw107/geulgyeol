// Actual WASM, Bridge, InputHandler methods and command classes; a headless adapter supplies cursor/DOM/operation dispatch.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';
const [engineDir, fixtureDir, out] = process.argv.slice(2);
assert(engineDir && fixtureDir && out, 'ENGINE_DIR FIXTURE_DIR OUTPUT_DIR');
fs.mkdirSync(out, {
  recursive: true
});
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url))),
  bytes = fs.readFileSync(path.resolve(engineDir, 'rhwp_bg.wasm'));
const {
  initSync,
  HwpDocument
} = await import(pathToFileURL(path.resolve(engineDir, 'rhwp.js')));
initSync({
  module: bytes
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
let b = bs.slice(bs.indexOf('function parseDeferredFocusedCellCursorGeometry('), bs.indexOf('export type DeferredPaginationStatus')) + 'class BridgeProbe {doc;constructor(doc){this.doc=doc;}\n';
for (const n of ['saveSnapshot', 'restoreSnapshot', 'discardSnapshot', 'runInBatch', 'getCellOwnProperties', 'getCellOwnPropertiesByPath', 'getCellParaPropertiesAtByPath', 'applyCellOwnPropertiesByPaths', 'applyFormatCopyInCell', 'getTableDimensions', 'getTableDimensionsByPath', 'getCellInfo', 'getCellInfoByPath', 'setCellProperties', 'getCellCharPropertiesAt', 'getCellCharPropertiesAtByPath', 'getCharPropertiesAt', 'getParaPropertiesAt', 'getCellParaPropertiesAt', 'findOrCreateFontId', 'applyCharFormat', 'applyCharFormatInCellByPath', 'setCharShapeId', 'setCharShapeIdInCellByPath', 'getParagraphLength', 'getCellParagraphLengthByPath', 'applyParaFormat', 'applyParaFormatInCell', 'setParaShapeId', 'setCellParaShapeId']) b += method(bs, n);
b += '}\nexport {BridgeProbe};';
const {
  BridgeProbe
} = await load(b);
const commands = await load('const MAX_PAGE_LOCAL_TEXT_EDIT_CHARS=10000;\n' + fs.readFileSync(path.join(root, 'rhwp-studio/src/engine/command.ts'), 'utf8'));
globalThis.__formatCommands = commands;
const cb = fs.readFileSync(path.join(root, 'rhwp-studio/src/engine/cell-block-format.ts'), 'utf8');
const hs = fs.readFileSync(path.join(root, 'rhwp-studio/src/engine/input-handler.ts'), 'utf8');
let h = 'const {ApplyCharFormatCommand,ApplyParaFormatCommand}=globalThis.__formatCommands;const PX_TO_RAW_2X=150,PX_TO_HWPUNIT=75;\n' + cb + '\n' + hs.slice(hs.indexOf('const FORMAT_COPY_CHAR_KEYS'), hs.indexOf('function availableDropWidthPx')) + hs.slice(hs.indexOf('function normalizeFormatCopyParaProps'), hs.indexOf('function createOverlaySvg')) + 'class HandlerProbe {\n';
for (const n of ['performFormatCopy', 'performFormatPaste', 'applyCopiedFormatToCurrentTarget', 'copyFormatAtCursor', 'applyCopiedCellPropsToSelection', 'getSelectedCellBlock', 'getCharPropertiesAtCursor', 'getCharProperties', 'getParaProperties', 'getSelection', 'applyCharPropsToRange', 'applyParaPropsToRange', 'getParaFormatTargetsForRange', 'executeParaFormatCommand']) h += method(hs, n);
h += '}\nexport {HandlerProbe};';
const {
  HandlerProbe
} = await load(h);
const hash = s => crypto.createHash('sha256').update(s).digest('hex'),
  pj = p => JSON.stringify(p),
  target = (p, c, n = 0) => [...p.slice(0, -1), {
    ...p.at(-1),
    cellIndex: c,
    cellParaIndex: n
  }];
const parse = s => JSON.parse(s);
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
    own: parse(d.getCellOwnPropertiesByPath(0, c.parent, pj(target(c.path, i)))),
    paras: [0, 1].map(n => {
      const p = target(c.path, i, n),
        text = d.getTextInCellByPath(0, c.parent, pj(p), 0, 100000);
      return {
        text,
        chars: Array.from(text, (_, o) => parse(d.getCellCharPropertiesAtByPath(0, c.parent, pj(p), o))),
        para: parse(d.getCellParaPropertiesAtByPath(0, c.parent, pj(p)))
      };
    })
  }));
}
function state(d, c) {
  const body = d.getTextRange(0, c.parent + 1, 0, 100000);
  return {
    leaf: leaf(d, c),
    body,
    bodyChars: Array.from(body, (_, o) => parse(d.getCharPropertiesAt(0, c.parent + 1, o))),
    bodyPara: parse(d.getParaPropertiesAt(0, c.parent + 1)),
    svg: Array.from({
      length: d.pageCount()
    }, (_, i) => hash(d.renderPageSvg(i)))
  };
}
function ui(d, c) {
  const wasm = new BridgeProbe(d),
    ih = new HandlerProbe();
  let p = pos(c, c.path),
    selection = null,
    block = false;
  const history = [];
  Object.assign(ih, {
    wasm,
    formatCopyState: null,
    focusTextarea() {},
    getNonEmptySelection: () => selection,
    cursor: {
      getPosition: () => structuredClone(p),
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
        startCol: ih.excludedTest ? 0 : 1,
        endRow: 1,
        endCol: 1
      }),
      getExcludedCells: () => new Set(ih.excludedTest ? ['0,0', '1,0'] : [])
    },
    executeOperation(op) {
      const cmd = op.kind === 'command' ? op.command : new commands.SnapshotCommand(op.operationType, p, p, op.operation);
      cmd.execute(wasm);
      if (!cmd.isNoOp?.()) history.push(cmd);
    }
  });
  return {
    ih,
    wasm,
    history,
    set(p0, s, b0 = false) {
      p = p0;
      selection = s;
      block = b0;
    }
  };
}
let cases = 0,
  restores = 0,
  reopens = 0,
  rejections = 0,
  repeated = 0;
const rows = [];
function persist(d, c, id, expected) {
  for (const f of ['Hwp', 'Hwpx']) {
    const e = d['export' + f + 'WithReport']();
    try {
      assert.equal(parse(e.contentLoss()).count, 0);
      const data = e.takeBytes();
      fs.writeFileSync(path.join(out, id + '.' + f.toLowerCase()), data);
      const r = new HwpDocument(data);
      try {
        const got = state(r, c);
        assert.deepEqual(got.leaf, expected.leaf, 'saved cell properties/text/character/paragraph formats');
        assert.equal(got.body, expected.body);
        reopens++;
      } finally {
        r.free();
      }
    } finally {
      e.free();
    }
  }
}
for (const c of parse(fs.readFileSync(path.join(fixtureDir, 'proof.json'))).fixtures) {
  for (const mode of ['block', 'block-excluded', 'text', 'text-zero-end', 'body']) {
    const d = new HwpDocument(fs.readFileSync(c.file)),
      u = ui(d, c);
    try {
      const before = state(d, c);
      u.ih.excludedTest = mode === 'block-excluded';
      u.ih.performFormatCopy();
      const copied = structuredClone(u.ih.formatCopyState);
      assert.equal(copied.charProps.bold, true);
      assert.equal(copied.paraProps.marginLeft, 1200);
      assert.equal(copied.cellProps.paddingLeft, 400);
      if (mode.startsWith('block')) u.set(pos(c, target(c.path, 1)), null, true);else if (mode.startsWith('text')) u.set(pos(c, target(c.path, 1), 2), {
        start: pos(c, target(c.path, 1), 2),
        end: pos(c, target(c.path, 1, 1), mode === 'text-zero-end' ? 0 : 4)
      });else {
        const a = {
            sectionIndex: 0,
            paragraphIndex: c.parent + 1,
            charOffset: 1
          },
          b = {
            ...a,
            charOffset: 3
          };
        u.set(a, {
          start: a,
          end: b
        });
      }
      u.ih.performFormatPaste();
      assert.equal(u.ih.formatCopyState, null);
      assert(u.history.length > 0);
      const after = state(d, c);
      u.ih.performFormatPaste();
      assert.deepEqual(state(d, c), after, 'clipboard consumed after one paste');
      if (mode.startsWith('block')) {
        assert.deepEqual(after.leaf.map(x => x.paras), before.leaf.map(x => x.paras));
        for (const i of [0, 2]) assert.deepEqual(after.leaf[i], before.leaf[i], 'unselected neighbor preserved');
        for (const index of c.cellCount === 4 ? [1, 3] : [1]) for (const k of Object.keys(copied.cellProps)) assert.equal(after.leaf[index].own[k], copied.cellProps[k]);
        assert.deepEqual(after.bodyChars, before.bodyChars);
      }
      if (mode.startsWith('text')) {
        for (let i = 0; i < c.cellCount; i++) {
          assert.deepEqual(after.leaf[i].own, before.leaf[i].own);
          if (i !== 1) assert.deepEqual(after.leaf[i], before.leaf[i]);
        }
        for (let n = 0; n < 2; n++) {
          const a = after.leaf[1].paras[n],
            b = before.leaf[1].paras[n];
          assert.equal(a.text, b.text);
          assert.equal(a.para.marginLeft, 8);
          for (let o = 0; o < a.chars.length; o++) {
            const selected = n === 0 ? o >= 2 : o < (mode === 'text-zero-end' ? 0 : 4);
            assert.equal(a.chars[o].bold, selected);
            if (!selected) assert.deepEqual(a.chars[o], b.chars[o]);
          }
        }
        assert.deepEqual(after.bodyChars, before.bodyChars);
      }
      if (mode === 'body') {
        assert.deepEqual(after.leaf, before.leaf);
        assert.equal(after.body, before.body);
        for (let o = 0; o < after.bodyChars.length; o++) assert.equal(after.bodyChars[o].bold, o >= 1 && o < 3);
        assert.equal(after.bodyPara.marginLeft, 8);
      }
      for (let n = 0; n < 3; n++) {
        for (const cmd of [...u.history].reverse()) cmd.undo(u.wasm);
        assert.deepEqual(state(d, c), before, 'undo full formats and SVG');
        restores++;
        for (const cmd of u.history) cmd.execute(u.wasm);
        assert.deepEqual(state(d, c), after, 'redo full formats and SVG');
        restores++;
      }
      const id = `depth${c.depth}-merged${c.merged}-${mode}`;
      persist(d, c, id, after);
      // Re-copy and paste the same target: repeat command flow and one-shot clearing.
      u.set(pos(c, c.path), null);
      u.ih.performFormatCopy();
      if (mode.startsWith('block')) u.set(pos(c, target(c.path, 1)), null, true);else if (mode.startsWith('text')) u.set(pos(c, target(c.path, 1), 2), {
        start: pos(c, target(c.path, 1), 2),
        end: pos(c, target(c.path, 1, 1), mode === 'text-zero-end' ? 0 : 4)
      });else {
        const a = {
          sectionIndex: 0,
          paragraphIndex: c.parent + 1,
          charOffset: 1
        };
        u.set(a, {
          start: a,
          end: {
            ...a,
            charOffset: 3
          }
        });
      }
      u.ih.performFormatPaste();
      assert.equal(u.ih.formatCopyState, null);
      assert.deepEqual(state(d, c), after);
      repeated++;
      rows.push({
        id,
        commands: u.history.length
      });
      cases++;
    } finally {
      for (const cmd of u.history) cmd.discard?.(u.wasm);
      d.free();
    }
  }
  // Strict malformed/late paths, invalid references, cross-cell text and rollback of UI commands.
  const d = new HwpDocument(fs.readFileSync(c.file)),
    u = ui(d, c);
  try {
    const before = state(d, c),
      good = target(c.path, 1),
      bad = structuredClone(good);
    bad.at(-1).cellIndex = 999;
    for (const run of [() => d.applyCellOwnPropertiesByPaths(0, c.parent, pj([good, bad]), '{"paddingLeft":300}'), () => d.applyCellOwnPropertiesByPaths(0, c.parent, pj([good]), '{"borderFillId":65535}'), () => d.applyFormatCopyInCell(0, c.parent, pj(good), pj(target(c.path, 2, 1)), 2, 4, '{"bold":true}', '{"marginLeft":1200}'), () => d.applyFormatCopyInCell(0, c.parent, pj(good), pj(target(c.path, 1, 1)), 2, 4, '{"fontId":65535}', '{"marginLeft":1200}'), () => d.applyFormatCopyInCell(0, c.parent, pj(good), pj(target(c.path, 1, 1)), 2, 4, '{"bold":true}', '{"numberingId":65535}')]) {
      assert.throws(run);
      assert.deepEqual(state(d, c), before);
      rejections++;
    }
    if (c.depth > 1) {
      u.ih.performFormatCopy();
      const saved = structuredClone(u.ih.formatCopyState);
      u.set(pos(c, good, 2), {
        start: pos(c, good, 2),
        end: pos(c, target(c.path, 2, 1), 4)
      });
      u.ih.performFormatPaste();
      assert.deepEqual(state(d, c), before);
      assert.deepEqual(u.ih.formatCopyState, saved);
      assert.equal(u.history.length, 0);
      rejections++;
      u.set(pos(c, c.path), null);
      u.ih.performFormatCopy();
      u.ih.formatCopyState.cellProps.borderFillId = 65535;
      const invalidClipboard = structuredClone(u.ih.formatCopyState);
      u.set(pos(c, good), null, true);
      u.ih.performFormatPaste();
      assert.deepEqual(state(d, c), before);
      assert.deepEqual(u.ih.formatCopyState, invalidClipboard);
      assert.equal(u.history.length, 0);
      rejections++;
    }
    let numbering = d.createNumbering('{}');
    while (numbering <= parse(d.getBulletList()).length) numbering = d.createNumbering('{}');
    const beforePool = state(d, c);
    assert.throws(() => d.applyFormatCopyInCell(0, c.parent, pj(good), pj(target(c.path, 1, 1)), 2, 4, '{"bold":true}', JSON.stringify({
      headType: 'Bullet',
      numberingId: numbering
    })));
    assert.deepEqual(state(d, c), beforePool);
    rejections++;
  } finally {
    for (const cmd of u.history) cmd.discard?.(u.wasm);
    d.free();
  }
}
const proof = {
  cases,
  restores,
  reopens,
  rejections,
  repeated,
  rows,
  wasmSHA256: hash(bytes),
  inputHandlerSHA256: hash(hs),
  bridgeSHA256: hash(bs),
  GUIVerified: false,
  DOMAndCursorMocked: true,
  operationDispatchAdapter: true,
  physicalIMEVerified: false
};
fs.writeFileSync(path.join(out, 'proof.json'), JSON.stringify(proof, null, 2));
console.log(JSON.stringify(proof));

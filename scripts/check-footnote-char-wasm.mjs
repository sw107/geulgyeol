// Real WASM, UI/command/cursor selection methods and CommandHistory; DOM/dispatch adapter.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';
const [engine, inputs, out] = process.argv.slice(2);
assert(engine && inputs && out);
fs.mkdirSync(out, {
  recursive: true
});
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const wb = fs.readFileSync(path.join(engine, 'rhwp_bg.wasm'));
const {
  initSync,
  HwpDocument
} = await import(pathToFileURL(path.resolve(engine, 'rhwp.js')));
initSync({
  module: wb
});
const load = async s => import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(s, {
  mode: 'transform'
}).replace(/^import .*?;\s*$/gm, '')).toString('base64'));
const method = (s, n) => {
  let a = -1;
  for (const prefix of ['  ', '  private ', '  static ']) {
    a = s.indexOf(prefix + n + '(');
    if (a >= 0) break;
  }
  assert(a >= 0, n);
  return s.slice(a, s.indexOf('\n  }\n', a) + 4) + '\n';
};
const cs = fs.readFileSync('rhwp-studio/src/engine/command.ts', 'utf8'),
  bs = fs.readFileSync('rhwp-studio/src/core/wasm-bridge.ts', 'utf8'),
  hs = fs.readFileSync('rhwp-studio/src/engine/input-handler.ts', 'utf8'),
  cus = fs.readFileSync('rhwp-studio/src/engine/cursor.ts', 'utf8');
const commands = await load('const MAX_PAGE_LOCAL_TEXT_EDIT_CHARS=10000;\n' + cs);
globalThis.__noteCommands = commands;
const {
  CommandHistory
} = await load('const {NO_TEXT_MUTATION_EFFECTS}=globalThis.__noteCommands;\n' + fs.readFileSync('rhwp-studio/src/engine/history.ts', 'utf8'));
let bridge = 'export class BridgeProbe {doc;constructor(d){this.doc=d;}\n';
for (const n of ['saveSnapshot', 'restoreSnapshot', 'discardSnapshot', 'getFootnoteInfo', 'getCharPropertiesInFootnote', 'applyCharFormatInFootnote', 'getCharPropertiesAt']) bridge += method(bs, n);
bridge += '}';
const {
  BridgeProbe
} = await load(bridge);
let cursor = 'class CursorState {\n' + method(cus, 'compareFootnotePositions') + '}\nexport class CursorProbe {\n';
for (const n of ['getFootnoteSelectionOrdered', 'selectFootnoteRange']) cursor += method(cus, n);
cursor += '}';
const {
  CursorProbe
} = await load(cursor);
let handler = 'export class HandlerProbe {\n';
for (const n of ['toggleFormat', 'applyToggleFormat', 'applyCharFormat', 'getSelectedCellBlock', 'getCharPropertiesAtCursor', 'getCharProperties', 'getFootnoteCharFormatSelection', 'applyCharPropsToFootnoteSelection', 'restoreSelectionAfterUndo', 'restoreSelectionAfterRedo', 'sameFootnoteSelectionTarget', 'applyCharPropsToRange', 'adjustFontSize', 'adjustCharRatio', 'adjustCharSpacing']) handler += method(hs, n);
handler += '}';
const {
  HandlerProbe
} = await load(handler);
const {
  formatCommands
} = await load('class CharShapeDialog {show(props){this.props=props;globalThis.__noteDialog=this;}}\n' + fs.readFileSync('rhwp-studio/src/command/commands/format.ts', 'utf8'));
const props = (d, c, neighbor = false) => {
  const ci = neighbor ? c.neighbor : c.control,
    info = JSON.parse(d.getFootnoteInfo(0, 0, ci));
  return info.texts.map((text, p) => ({
    text,
    para: JSON.parse(d.getParaPropertiesInFootnote(0, 0, ci, p)),
    chars: Array.from(text, (_, o) => JSON.parse(d.getCharPropertiesInFootnote(0, 0, ci, p, o)))
  }));
};
const state = (d, c) => ({
  notes: props(d, c),
  neighbor: props(d, c, true),
  body: d.getTextRange(0, 0, 0, 100000),
  bodyChars: Array.from(d.getTextRange(0, 0, 0, 100000), (_, i) => JSON.parse(d.getCharPropertiesAt(0, 0, i))),
  svg: Array.from({
    length: d.pageCount()
  }, (_, i) => sha(d.renderPageSvg(i)))
});
function ui(d, c) {
  const wasm = new BridgeProbe(d),
    cursor = new CursorProbe(),
    h = new HandlerProbe(),
    history = new CommandHistory(),
    calls = [];
  Object.assign(cursor, {
    wasm,
    fnSectionIdx: 0,
    fnParaIdx: 0,
    fnControlIdx: c.control,
    fnInnerParaIdx: 0,
    fnCharOffset: 9,
    fnPageNum: 0,
    fnFootnoteIndex: 0,
    _fnInnerParaIdx: 0,
    _fnCharOffset: 9,
    _fnPageNum: 0,
    _fnFootnoteIndex: 0,
    fnAnchor: {
      fnParaIdx: 0,
      charOffset: 2
    },
    isInFootnote: () => true,
    isInHeaderFooter: () => false,
    isInCellSelectionMode: () => false,
    getPosition: () => ({
      sectionIndex: 0,
      paragraphIndex: 0,
      charOffset: 1
    })
  });
  Object.assign(h, {
    wasm,
    cursor,
    focusTextarea() {},
    executeOperation(op) {
      assert.equal(op.kind, 'snapshot');
      const cmd = new commands.SubmodeSelectionSnapshotCommand(op.operationType, cursor.getPosition(), cursor.getPosition(), op.operation, op.editContext, op.editContextAfter, op.selectionBefore, op.selectionAfter);
      history.execute(cmd, wasm);
      if (!cmd.isNoOp()) {
        calls.push(cmd);
        h.restoreSelectionAfterRedo(cmd);
      }
    }
  });
  return {
    h,
    wasm,
    cursor,
    history,
    calls,
    set(a, b) {
      cursor.fnAnchor = {
        ...a
      };
      cursor._fnInnerParaIdx = b.fnParaIdx;
      cursor._fnCharOffset = b.charOffset;
      cursor.fnInnerParaIdx = b.fnParaIdx;
      cursor.fnCharOffset = b.charOffset;
    }
  };
}
const actions = ['bold', 'italic', 'size', 'spacing', 'ratio', 'dialog', 'reverse', 'multi', 'font'];
let cases = 0,
  restores = 0,
  reopens = 0,
  rejections = 0,
  noOps = 0,
  selectionRestores = 0,
  savedSVGEqual = 0;
const exports = [];
for (const c of JSON.parse(fs.readFileSync(path.join(inputs, 'proof.json'))).fixtures) {
  for (const action of actions) {
    const d = new HwpDocument(fs.readFileSync(c.file)),
      u = ui(d, c);
    try {
      const multi = action === 'multi',
        reverse = action === 'reverse';
      const a = {
          fnParaIdx: 0,
          charOffset: 2
        },
        b = {
          fnParaIdx: multi ? 3 : 0,
          charOffset: multi ? 5 : 9
        };
      u.set(reverse ? b : a, reverse ? a : b);
      const ordered = u.h.getFootnoteCharFormatSelection();
      assert(ordered);
      assert.deepEqual(u.h.getCharProperties(), JSON.parse(d.getCharPropertiesInFootnote(0, 0, c.control, 0, 2)));
      const before = state(d, c);
      let requested;
      if (action === 'bold' || action === 'italic' || reverse || multi) {
        requested = {
          [action === 'italic' ? 'italic' : 'bold']: true
        };
        u.h.toggleFormat(action === 'italic' ? 'italic' : 'bold');
      } else if (action === 'size') {
        requested = {
          fontSize: 1100
        };
        u.h.adjustFontSize(100);
      } else if (action === 'spacing') {
        requested = {
          spacings: Array(7).fill(2)
        };
        u.h.adjustCharSpacing(2);
      } else if (action === 'ratio') {
        requested = {
          ratios: Array(7).fill(110)
        };
        u.h.adjustCharRatio(10);
      } else if (action === 'font') {
        requested = {
          fontName: 'Footnote QA Font'
        };
        formatCommands.find(c => c.id === 'format:char-shape').execute({
          getInputHandler: () => u.h,
          wasm: u.wasm,
          eventBus: {}
        });
        globalThis.__noteDialog.onApply({
          ...requested
        });
      } else {
        requested = {
          fontSize: 1500,
          textColor: '#336699',
          underlineType: 'Bottom',
          underlineColor: '#112233'
        };
        formatCommands.find(c => c.id === 'format:char-shape').execute({
          getInputHandler: () => u.h,
          wasm: u.wasm,
          eventBus: {}
        });
        assert.deepEqual(globalThis.__noteDialog.props, u.h.getCharProperties());
        u.cursor.fnAnchor = null;
        globalThis.__noteDialog.onApply({
          ...requested
        });
      }
      assert.equal(u.calls.length, 1);
      const after = state(d, c);
      assert.deepEqual(after.neighbor, before.neighbor);
      assert.equal(after.body, before.body);
      assert.deepEqual(after.bodyChars, before.bodyChars);
      for (let p = 0; p < after.notes.length; p++) {
        assert.equal(after.notes[p].text, before.notes[p].text);
        assert.deepEqual(after.notes[p].para, before.notes[p].para);
        for (let i = 0; i < after.notes[p].chars.length; i++) {
          const got = structuredClone(after.notes[p].chars[i]),
            old = structuredClone(before.notes[p].chars[i]),
            selected = p >= a.fnParaIdx && p <= b.fnParaIdx && i >= (p === a.fnParaIdx ? a.charOffset : 0) && i < (p === b.fnParaIdx ? b.charOffset : after.notes[p].chars.length);
          if (!selected) assert.deepEqual(got, old);else {
            delete old.charShapeId;
            delete got.charShapeId;
            Object.assign(old, requested);
            if (requested.fontName) {
              delete old.fontName;
              old.fontFamily = requested.fontName;
              old.fontFamilies = Array(7).fill(requested.fontName);
            }
            if (requested.underlineType) old.underline = true;
            assert.deepEqual(got, old);
          }
        }
      }
      for (let i = 0; i < 3; i++) {
        u.history.undo(u.wasm);
        u.cursor.fnAnchor = null;
        u.h.restoreSelectionAfterUndo(u.history.peekRedoTop());
        assert.deepEqual(state(d, c), before);
        assert.deepEqual(u.h.getFootnoteCharFormatSelection(), ordered);
        restores++;
        selectionRestores++;
        u.history.redo(u.wasm);
        u.cursor.fnAnchor = null;
        u.h.restoreSelectionAfterRedo(u.history.peekUndoTop());
        assert.deepEqual(state(d, c), after);
        assert.deepEqual(u.h.getFootnoteCharFormatSelection(), ordered);
        restores++;
        selectionRestores++;
      }
      u.h.applyCharPropsToFootnoteSelection(ordered, requested);
      assert.equal(u.calls.length, 1);
      assert.deepEqual(state(d, c), after);
      noOps++;
      for (const f of ['Hwp', 'Hwpx']) {
        const e = d['export' + f + 'WithReport']();
        try {
          assert.equal(JSON.parse(e.contentLoss()).count, 0);
          const bytes = e.takeBytes(),
            r = new HwpDocument(bytes);
          try {
            const got = state(r, c);
            assert.deepEqual(got.notes, after.notes);
            assert.deepEqual(got.neighbor, after.neighbor);
            assert.equal(got.body, after.body);
            assert.deepEqual(got.bodyChars, after.bodyChars);
            if (JSON.stringify(got.svg) === JSON.stringify(after.svg)) savedSVGEqual++;
            const file = path.resolve(out, `endnote${c.endnote}-unicode${c.unicode}-${action}.${f.toLowerCase()}`);
            fs.writeFileSync(file, bytes);
            exports.push({
              file,
              input: path.resolve(c.file),
              control: c.control,
              neighbor: c.neighbor
            });
            reopens++;
          } finally {
            r.free();
          }
        } finally {
          e.free();
        }
      }
      cases++;
    } finally {
      u.history.clear(u.wasm);
      d.free();
    }
  }
  const d = new HwpDocument(fs.readFileSync(c.file)),
    u = ui(d, c);
  try {
    const before = state(d, c),
      rawBefore = d.exportHwpx();
    for (const run of [() => d.applyCharFormatInFootnote(0, 0, c.control, 0, 2, 999, 4, '{"bold":true,"fontName":"Rejected QA Font"}'), () => d.applyCharFormatInFootnote(0, 0, c.control, 0, 2, 1, 999, '{"bold":true}'), () => d.applyCharFormatInFootnote(0, 0, c.control, 0, 2, 1, 4, '{"fontId":65535}'), () => d.applyCharFormatInFootnote(0, 0, 0, 0, 0, 0, 1, '{"bold":true}'), () => u.h.applyCharPropsToFootnoteSelection(u.h.getFootnoteCharFormatSelection(), {
      bold: 'x'
    })]) {
      assert.throws(run);
      assert.deepEqual(state(d, c), before);
      assert.equal(u.calls.length, 0);
      assert.deepEqual(d.exportHwpx(), rawBefore);
      rejections++;
    }
    const good = u.h.getFootnoteCharFormatSelection();
    u.h.applyCharPropsToFootnoteSelection({
      ...good,
      controlIdx: c.neighbor
    }, {
      bold: true
    });
    assert.deepEqual(state(d, c), before);
    rejections++;
    u.h.applyCharPropsToRange({
      sectionIndex: 0,
      paragraphIndex: 0,
      charOffset: 0
    }, {
      sectionIndex: 0,
      paragraphIndex: 0,
      charOffset: 4
    }, {
      bold: true
    });
    assert.deepEqual(state(d, c), before);
    rejections++;
    u.cursor.fnAnchor = null;
    u.h.toggleFormat('bold');
    assert.deepEqual(state(d, c), before);
    assert.equal(u.calls.length, 0);
    noOps++;
    assert.equal(u.cursor.selectFootnoteRange({
      fnParaIdx: 0,
      charOffset: 2
    }, {
      fnParaIdx: 1,
      charOffset: 999
    }), false);
    assert.equal(u.cursor.fnAnchor, null);
    rejections++;
  } finally {
    u.history.clear(u.wasm);
    d.free();
  }
}
fs.writeFileSync(path.join(out, 'export-manifest.json'), JSON.stringify(exports, null, 2));
const proof = {
  cases,
  restores,
  reopens,
  rejections,
  noOps,
  selectionRestores,
  savedSVGEqual,
  engineSHA256: sha(wb),
  sourceSHA256: {
    input: sha(hs),
    bridge: sha(bs),
    command: sha(cs),
    cursor: sha(cus)
  },
  realCommandHistory: true,
  GUIVerified: false,
  DOMAndDispatchAdapter: true
};
fs.writeFileSync(path.join(out, 'proof.json'), JSON.stringify(proof, null, 2));
console.log(JSON.stringify(proof));

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
for (const n of ['hasLoadedDocument', 'saveSnapshot', 'restoreSnapshot', 'discardSnapshot', 'getFootnoteInfo', 'getCharPropertiesInFootnote', 'applyCharFormatInFootnote', 'getCharPropertiesAt', 'getParaPropertiesInFootnote', 'applyParaFormatInFootnote', 'insertTextInFootnote', 'applyParaFormatInFootnoteRange']) bridge += method(bs, n);
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
let handler = 'const {SnapshotCommand,SubmodeSnapshotCommand,SubmodeSelectionSnapshotCommand}=globalThis.__noteCommands; export class HandlerProbe {\n';
for (const n of ['toggleFormat', 'applyToggleFormat', 'applyCharFormat', 'getSelectedCellBlock', 'clearPendingFootnoteCharShape', 'getPendingFootnoteCharShape', 'stagePendingFootnoteCharShape', 'getCharPropertiesAtCursor', 'getCharProperties', 'getFootnoteCharFormatSelection', 'applyCharPropsToFootnoteSelection', 'restoreSelectionAfterUndo', 'restoreSelectionAfterRedo', 'sameFootnoteSelectionTarget', 'applyCharPropsToRange', 'adjustFontSize', 'adjustCharRatio', 'adjustCharSpacing', 'applyParaAlign', 'setLineSpacing', 'applyParaPropsAtCursor', 'applyParaFormat', 'applyParaFormatInNoteOrHeader', 'getParaProperties', 'getSelection', 'getCursorPosition', 'applyParaPropsToRange', 'getParaFormatTargetsForRange', 'executeParaFormatCommand', 'getFootnoteParaFormatSelection', 'applyParaPropsToFootnoteSelection', 'executeOperation', 'restoreEditContextAfterHistory']) handler += method(hs, n);
handler += '}';
const {
  HandlerProbe
} = await load(handler);
const {
  formatCommands
} = await load('class ParaShapeDialog {show(props){this.props=props;globalThis.__paraDialog=this;}}\n' + fs.readFileSync('rhwp-studio/src/command/commands/format.ts', 'utf8'));
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
    getSelectionOrdered: () => null, moveTo(){}, resetPreferredX(){},
    setFnCursorPosition(p, o) {
      this.fnInnerParaIdx = p;
      this.fnCharOffset = o;
      this._fnInnerParaIdx = p;
      this._fnCharOffset = o;
      this.fnAnchor = null;
    },
    getPosition: () => ({
      sectionIndex: 0,
      paragraphIndex: 0,
      charOffset: 1
    })
  });
  Object.assign(h, {
    wasm,
    cursor,
    history,
    focusTextarea() {},
    isOperationAllowedInEditMode() {
      return true;
    },
    caretLayoutReveal: {
      requestFor() {}
    },
    refreshAfterOperation() {
      calls.push(history.peekUndoTop());
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
const actions = ['align', 'spacing', 'indent-dialog', 'caret-dialog', 'reverse-dialog', 'multi-dialog', 'empty-dialog', 'fixed-dialog', 'tabs-dialog', 'border-dialog'];
let caretControls = 0, cases = 0,
  restores = 0,
  reopens = 0,
  rejections = 0,
  noOps = 0,
  selectionRestores = 0,
  savedSVGEqual = 0;
const exports = [];
function restore(u, undo) {
  const pos = undo ? u.history.undo(u.wasm) : u.history.redo(u.wasm);
  const cmd = undo ? u.history.peekRedoTop() : u.history.peekUndoTop();
  u.h.restoreEditContextAfterHistory(cmd, pos);
  u.h[undo ? 'restoreSelectionAfterUndo' : 'restoreSelectionAfterRedo'](cmd);
}
for (const c of JSON.parse(fs.readFileSync(path.join(inputs, 'proof.json'))).fixtures) {
  for (const mods of [{ alignment: 'center' }, { lineSpacing: 180, lineSpacingType: 'Percent' }, { indent: 600 }]) {
    const d = new HwpDocument(fs.readFileSync(c.file)), u = ui(d, c);
    try {
      u.cursor.fnAnchor = null;
      const before = state(d, c);
      u.h.applyParaPropsAtCursor(mods);
      const after = state(d, c);
      assert.equal(u.calls.length, 1);
      assert.notDeepEqual(after.notes[0].para, before.notes[0].para);
      assert.deepEqual(after.notes[0].chars, before.notes[0].chars);
      assert.deepEqual(after.notes.slice(1), before.notes.slice(1));
      assert.deepEqual(after.neighbor, before.neighbor);
      assert.deepEqual(after.bodyChars, before.bodyChars);
      restore(u, true); assert.deepEqual(state(d, c), before);
      restore(u, false); assert.deepEqual(state(d, c), after);
      caretControls++;
    } finally { u.history.clear(u.wasm); d.free(); }
  }
  for (const action of actions) {
    const d = new HwpDocument(fs.readFileSync(c.file)),
      u = ui(d, c);
    try {
      const caret = action === 'caret-dialog' || action === 'empty-dialog';
      const first = action === 'empty-dialog' ? 2 : caret ? 1 : 0;
      const last = action === 'multi-dialog' || action === 'spacing' ? 3 : caret ? first : 1;
      const a = {
          fnParaIdx: first,
          charOffset: first === 2 ? 0 : 2
        },
        b = {
          fnParaIdx: last,
          charOffset: last === 2 ? 0 : last === 3 ? 5 : 7
        };
      if (caret) {
        u.cursor.setFnCursorPosition(first, a.charOffset);
      } else u.set(action === 'reverse-dialog' ? b : a, action === 'reverse-dialog' ? a : b);
      const ordered = u.h.getFootnoteParaFormatSelection(),
        before = state(d, c);
      assert.deepEqual(u.h.getParaProperties(), before.notes[first].para);
      const services = {
        getInputHandler: () => u.h,
        wasm: u.wasm,
        eventBus: {}
      };
      let requested;
      if (action === 'align') {
        requested = {
          alignment: 'center'
        };
        formatCommands.find(x => x.id === 'format:align-center').execute(services);
      } else if (action === 'spacing') {
        requested = {
          lineSpacing: 180,
          lineSpacingType: 'Percent'
        };
        formatCommands.find(x => x.id === 'format:line-spacing').execute(services, {
          value: 180
        });
      } else {
        requested = action === 'fixed-dialog' ? {
          lineSpacing: 1800,
          lineSpacingType: 'Fixed'
        } : action === 'tabs-dialog' ? {
          tabAutoLeft: true
        } : action === 'border-dialog' ? {
          borderLeft: {
            type: 1,
            width: 2,
            color: '#334477'
          }
        } : action === 'reverse-dialog' ? {
          alignment: 'right'
        } : {
          indent: 600,
          marginLeft: 1200
        };
        formatCommands.find(x => x.id === 'format:para-shape').execute(services);
        assert.deepEqual(globalThis.__paraDialog.props, before.notes[first].para);
        u.cursor.setFnCursorPosition(3, 1);
        globalThis.__paraDialog.onApply({
          ...requested
        });
      }
      assert.equal(u.calls.length, 1);
      const after = state(d, c);
      assert.deepEqual(after.neighbor, before.neighbor);
      assert.equal(after.body, before.body);
      assert.deepEqual(after.bodyChars, before.bodyChars);
      for (let pi = 0; pi < after.notes.length; pi++) {
        assert.equal(after.notes[pi].text, before.notes[pi].text);
        assert.deepEqual(after.notes[pi].chars, before.notes[pi].chars);
        const old = structuredClone(before.notes[pi].para),
          got = structuredClone(after.notes[pi].para);
        if (pi < first || pi > last) {
          assert.deepEqual(got, old);
          continue;
        }
        delete old.paraShapeId;
        delete got.paraShapeId;
        Object.assign(old, requested);
        if (requested.indent !== undefined) old.indent = requested.indent / 150;
        if (requested.marginLeft !== undefined) old.marginLeft = requested.marginLeft / 150;
        if (requested.lineSpacingType === 'Fixed') old.lineSpacing = requested.lineSpacing / 150;
        if (requested.borderLeft) {
          delete old.borderFillId;
          delete got.borderFillId;
        }
        assert.deepEqual(got, old, 'selected paragraph keeps every unspecified property');
      }
      const expectedSelection = caret ? null : ordered;
      assert.deepEqual(u.h.getFootnoteCharFormatSelection(), expectedSelection);
      assert.equal(u.cursor.fnInnerParaIdx, ordered.end.fnParaIdx);
      assert.equal(u.cursor.fnCharOffset, ordered.end.charOffset);
      for (let i = 0; i < 3; i++) {
        restore(u, true);
        assert.deepEqual(state(d, c), before);
        assert.deepEqual(u.h.getFootnoteCharFormatSelection(), expectedSelection);
        assert.equal(u.cursor.fnInnerParaIdx, ordered.end.fnParaIdx);
        restores++;
        selectionRestores++;
        restore(u, false);
        assert.deepEqual(state(d, c), after);
        assert.deepEqual(u.h.getFootnoteCharFormatSelection(), expectedSelection);
        restores++;
        selectionRestores++;
      }
      u.h.applyParaPropsToFootnoteSelection(ordered, requested);
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
            assert.deepEqual(got.svg, after.svg);
            savedSVGEqual++;
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
    u.set({
      fnParaIdx: 0,
      charOffset: 2
    }, {
      fnParaIdx: 1,
      charOffset: 7
    });
    const old = state(d, c),
      raw = d.exportHwpx(),
      selection = u.h.getFootnoteParaFormatSelection();
    for (const run of [() => d.applyParaFormatInFootnoteRange(99, 0, c.control, 0, 2, 1, 7, '{"alignment":"center"}'), () => d.applyParaFormatInFootnoteRange(0, 99, c.control, 0, 2, 1, 7, '{"indent":600}'), () => d.applyParaFormatInFootnoteRange(0, 0, 0, 0, 2, 1, 7, '{"alignment":"center"}'), () => d.applyParaFormatInFootnoteRange(0, 0, c.control, 0, 2, 999, 7, '{"tabAutoLeft":true,"borderLeft":{"type":1,"width":1,"color":"#445566"}}'), () => d.applyParaFormatInFootnoteRange(0, 0, c.control, 0, 2, 1, 999, '{"indent":600}'), () => u.h.applyParaPropsToFootnoteSelection(selection, {
      indent: 'bad'
    })]) {
      assert.throws(run);
      assert.deepEqual(state(d, c), old);
      assert.deepEqual(d.exportHwpx(), raw);
      assert.equal(u.calls.length, 0);
      rejections++;
    }
    for (const axis of [0, 1, 2, 3, 4, 5, 6]) for (const bad of [-1, 0.5, NaN, Infinity, 4294967296]) {
      const args = [0, 0, c.control, 0, 2, 1, 7];
      args[axis] = bad;
      assert.throws(() => d.applyParaFormatInFootnoteRange(...args, '{"indent":600}'));
      assert.deepEqual(state(d, c), old);
      assert.deepEqual(d.exportHwpx(), raw);
      rejections++;
    }
    u.h.applyParaPropsToFootnoteSelection({
      ...selection,
      controlIdx: c.neighbor
    }, {
      alignment: 'center'
    });
    assert.deepEqual(state(d, c), old);
    assert.equal(u.calls.length, 0);
    rejections++;
    formatCommands.find(x => x.id === 'format:para-shape').execute({
      getInputHandler: () => u.h,
      wasm: u.wasm,
      eventBus: {}
    });
    u.cursor.fnControlIdx = c.neighbor;
    globalThis.__paraDialog.onApply({
      indent: 600
    });
    assert.deepEqual(state(d, c), old);
    assert.equal(u.calls.length, 0);
    u.cursor.fnControlIdx = c.control;
    rejections++;
    u.h.applyParaPropsToRange({
      sectionIndex: 0,
      paragraphIndex: 0,
      charOffset: 0
    }, {
      sectionIndex: 0,
      paragraphIndex: 0,
      charOffset: 1
    }, {
      indent: 600
    });
    assert.deepEqual(state(d, c), old);
    assert.equal(u.calls.length, 0);
    rejections++;
    u.h.applyParaPropsToFootnoteSelection(selection, {});
    assert.deepEqual(state(d, c), old);
    assert.equal(u.calls.length, 0);
    noOps++;
    u.cursor.fnAnchor = null;
    u.h.toggleFormat('bold');
    assert.equal(u.h.pendingCharShape, undefined);
    assert.deepEqual(state(d, c), old);
    noOps++;
  } finally {
    u.history.clear(u.wasm);
    d.free();
  }
}
fs.writeFileSync(path.join(out, 'export-manifest.json'), JSON.stringify(exports, null, 2));
const proof = {
  caretControls,
  cases,
  restores,
  reopens,
  rejections,
  noOps,
  selectionRestores,
  savedSVGEqual,
  realCommandHistory: true,
  actualExecuteOperation: true,
  engineSHA256: sha(wb),
  sourceSHA256: {
    input: sha(hs),
    bridge: sha(bs),
    command: sha(cs),
    cursor: sha(cus)
  },
  GUIVerified: false,
  DOMAndRenderAdapter: true
};
fs.writeFileSync(path.join(out, 'proof.json'), JSON.stringify(proof, null, 2));
console.log(JSON.stringify(proof));

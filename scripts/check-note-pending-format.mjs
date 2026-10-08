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
}).replace(/^import[\s\S]*?;\s*$/gm, '')).toString('base64'));
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
let bridge = bs.slice(bs.indexOf('function serializeParaMeta('), bs.indexOf('\n}', bs.indexOf('function serializeParaMeta(')) + 2) + '\nexport class BridgeProbe {doc;documentGeneration=1;constructor(d){this.doc=d;}\n';
for (const n of ['hasLoadedDocument', 'saveSnapshot', 'restoreSnapshot', 'discardSnapshot', 'getFootnoteInfo', 'getCharPropertiesInFootnote', 'applyCharFormatInFootnote', 'getCharPropertiesAt', 'getParaPropertiesInFootnote', 'applyParaFormatInFootnote', 'insertTextInFootnote', 'applyParaFormatInFootnoteRange', 'deleteTextInFootnote', 'splitParagraphInFootnote', 'mergeParagraphInFootnote']) bridge += method(bs, n);
bridge += '}';
const {
  BridgeProbe
} = await load(bridge);
const {
  CursorState
} = await load('const {cellAxisPath}=globalThis.__noteCommands;\n' + fs.readFileSync('rhwp-studio/src/engine/cursor.ts', 'utf8'));
globalThis.__noteCursorClass = CursorState;
const textMethods = await load('const {InsertTextInFootnoteCommand,InsertTextInHeaderFooterCommand,InsertTextCommand,TextMutationEffectAccumulator,NO_TEXT_MUTATION_EFFECTS,IMMEDIATE_TEXT_MUTATION_EFFECTS}=globalThis.__noteCommands;\n' + fs.readFileSync('rhwp-studio/src/engine/input-handler-text.ts', 'utf8'));
const keyboardSource = fs.readFileSync('rhwp-studio/src/engine/input-handler-keyboard.ts', 'utf8');
const noteKeyboard = await load('const {DeleteTextInFootnoteCommand,MergeParagraphInFootnoteCommand}=globalThis.__noteCommands;const dispatchSubmodeGlobalShortcut=()=>false; export function noteKey(e){\n' + keyboardSource.slice(keyboardSource.indexOf('  // ─── 각주 편집 모드 키보드 처리'), keyboardSource.indexOf('  // ─── F5 블록 선택 모드 진입')) + '\n}');
let handler = 'const {SnapshotCommand,SubmodeSnapshotCommand,SubmodeSelectionSnapshotCommand,IMMEDIATE_TEXT_MUTATION_EFFECTS,ApplyCharFormatCommand,applyCharShapeModsToRange}=globalThis.__noteCommands; const CursorState=globalThis.__noteCursorClass; const clearObjectEditingPage=()=>{}; export class HandlerProbe {\n';
for (const n of ['toggleFormat', 'applyToggleFormat', 'applyCharFormat', 'getSelectedCellBlock', 'getCharPropertiesAtCursor', 'getCharProperties', 'getFootnoteCharFormatSelection', 'applyCharPropsToFootnoteSelection', 'restoreSelectionAfterUndo', 'restoreSelectionAfterRedo', 'sameFootnoteSelectionTarget', 'applyCharPropsToRange', 'adjustFontSize', 'adjustCharRatio', 'adjustCharSpacing', 'applyParaAlign', 'setLineSpacing', 'applyParaPropsAtCursor', 'applyParaFormat', 'applyParaFormatInNoteOrHeader', 'getParaProperties', 'getSelection', 'getCursorPosition', 'applyParaPropsToRange', 'getParaFormatTargetsForRange', 'executeParaFormatCommand', 'getFootnoteParaFormatSelection', 'applyParaPropsToFootnoteSelection', 'executeOperation', 'restoreEditContextAfterHistory', 'clearPendingFootnoteCharShape', 'getPendingFootnoteCharShape', 'stagePendingFootnoteCharShape', 'continuePendingFootnoteCharShape', 'insertFootnoteTextWithProps', 'insertPendingFootnoteText', 'beginPendingFootnoteComposition', 'updatePendingFootnoteComposition', 'finishPendingFootnoteComposition', 'cancelPendingFootnoteComposition', 'handleUndo', 'handleRedo', 'resetDerivedStateAfterHistoryJump', 'deactivate', 'dispose', 'stagePendingCharShape', 'getPendingCharShape', 'advancePendingCharShapeAnchor', 'getNonEmptySelection']) handler += method(hs, n);
handler += '}';
const {
  HandlerProbe
} = await load(handler);
const {
  formatCommands
} = await load('class CharShapeDialog {show(props){this.props=props;globalThis.__paraDialog=this;}}\n' + fs.readFileSync('rhwp-studio/src/command/commands/format.ts', 'utf8'));
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
    cursor = new CursorState(wasm),
    h = new HandlerProbe(),
    history = new CommandHistory(),
    calls = [];
  cursor.updateRect = () => {};
  cursor.resolveHeaderFooterPreviewPage = () => 0;
  cursor.enterFootnoteMode(0, 0, c.control, 0, 0);
  cursor.setFnCursorPosition(1, 8);
  Object.assign(h, {
    wasm,
    cursor,
    history,
    onCompositionEnd() {
      textMethods.onCompositionEnd.call(this);
    },
    active: true,
    isComposing: false,
    _isIOS: false,
    textarea: {
      value: '',
      focus() {}
    },
    eventBus: {
      emit() {}
    },
    caret: {
      hideComposition() {}
    },
    caretLayoutReveal: {
      requestFor() {}
    },
    focusTextarea() {},
    focus() {},
    isOperationAllowedInEditMode() {
      return true;
    },
    refreshAfterOperation() {
      calls.push(history.peekUndoTop());
    },
    afterEdit() {},
    updateCaret() {},
    resetRawTextMutationEffects() {},
    canInsertTextInFormMode() {
      return true;
    },
    canDeleteSelectionInFormMode() {
      return true;
    },
    flushDeferredPaginationIfNeeded() {},
    prepareTextMutationBeforeCursor() {
      return false;
    },
    clearTableResizeRuntimeCache() {}
  });
  return {
    h,
    wasm,
    cursor,
    history,
    calls,
    input(t) {
      h.textarea.value = t;
      textMethods.onInput.call(h);
    },
    start() {
      textMethods.onCompositionStart.call(h);
    },
    end() {
      textMethods.onCompositionEnd.call(h);
    },
    key(k) {
      noteKeyboard.noteKey.call(h, {
        key: k,
        preventDefault() {},
        shiftKey: false,
        ctrlKey: false,
        metaKey: false,
        altKey: false
      });
    }
  };
}
let cases = 0,
  restores = 0,
  reopens = 0,
  rejections = 0,
  lifetimeCases = 0,
  compositionCases = 0,
  structuralCases = 0,
  rollbackCases = 0,
  lifecycleCases = 0,
  continuedInputCases = 0,
  bodyCellPendingControls = 0,
  boundaryCases = 0,
  noOps = 0,
  savedSVGEqual = 0,
  budgetCases = 0,
  snapshotPeak = 0;
const exports = [];
const actions = ['bold', 'italic', 'size', 'dialog-font', 'ratio-spacing', 'toggle-twice'];
function undoRedo(u, d, c, before, after) {
  for (let i = 0; i < 3; i++) {
    u.h.handleUndo();
    assert.deepEqual(state(d, c), before);
    assert.equal(u.h.getPendingFootnoteCharShape(), undefined);
    u.h.handleRedo();
    assert.deepEqual(state(d, c), after);
    assert.equal(u.h.getPendingFootnoteCharShape(), undefined);
    restores += 2;
  }
}
function verifyInsert(before, after, para, start, text, mods) {
  assert.deepEqual(after.neighbor, before.neighbor);
  assert.equal(after.body, before.body);
  assert.deepEqual(after.bodyChars, before.bodyChars);
  for (let p = 0; p < before.notes.length; p++) {
    assert.deepEqual(after.notes[p].para, before.notes[p].para);
    if (p !== para) {
      assert.deepEqual(after.notes[p], before.notes[p]);
      continue;
    }
    const chars = Array.from(before.notes[p].text),
      n = Array.from(text).length;
    assert.equal(after.notes[p].text, chars.slice(0, start).join('') + text + chars.slice(start).join(''));
    for (let i = 0; i < chars.length; i++) assert.deepEqual(after.notes[p].chars[i + (i >= start ? n : 0)], before.notes[p].chars[i], 'existing run untouched');
    const base = structuredClone(before.notes[p].chars[Math.max(0, start - 1)]);
    delete base.charShapeId;
    Object.assign(base, mods);
    if (mods.fontName) {
      delete base.fontName;
      base.fontFamily = mods.fontName;
      base.fontFamilies = Array(7).fill(mods.fontName);
    }
    for (let i = 0; i < n; i++) {
      const got = structuredClone(after.notes[p].chars[start + i]);
      delete got.charShapeId;
      assert.deepEqual(got, base);
    }
  }
}
function save(d, c, after, action) {
  for (const f of ['Hwp', 'Hwpx']) {
    const e = d['export' + f + 'WithReport']();
    try {
      assert.equal(JSON.parse(e.contentLoss()).count, 0);
      const bytes = e.takeBytes(),
        r = new HwpDocument(bytes);
      try {
        assert.deepEqual(state(r, c), after);
        savedSVGEqual++;
        const file = path.resolve(out, `endnote${c.endnote}-unicode${c.unicode}-${action}.${f.toLowerCase()}`);
        fs.writeFileSync(file, bytes);
        exports.push({
          file,
          action,
          input: path.resolve(c.file),
          control: c.control,
          neighbor: c.neighbor,
          expected: after.notes
        });
        reopens++;
      } finally {
        r.free();
      }
    } finally {
      e.free();
    }
  }
}
for (const c of JSON.parse(fs.readFileSync(path.join(inputs, 'proof.json'))).fixtures) {
  for (const action of actions) {
    const d = new HwpDocument(fs.readFileSync(c.file)),
      u = ui(d, c);
    try {
      const before = state(d, c),
        raw = d.exportHwpx();
      let mods;
      if (action === 'bold' || action === 'italic') {
        mods = {
          [action]: true
        };
        u.h.toggleFormat(action);
      } else if (action === 'size') {
        mods = {
          fontSize: 1500
        };
        u.h.adjustFontSize(500);
      } else if (action === 'ratio-spacing') {
        mods = {
          ratios: Array(7).fill(110),
          spacings: Array(7).fill(3)
        };
        u.h.adjustCharRatio(10);
        u.h.adjustCharSpacing(3);
      } else if (action === 'toggle-twice') {
        mods = {
          bold: false
        };
        u.h.toggleFormat('bold');
        assert.equal(u.h.getCharProperties().bold, true);
        u.h.toggleFormat('bold');
        assert.equal(u.h.getCharProperties().bold, false);
      } else {
        mods = {
          fontName: 'Pending Note QA Font',
          fontSize: 1600
        };
        formatCommands.find(x => x.id === 'format:char-shape').execute({
          getInputHandler: () => u.h,
          wasm: u.wasm,
          eventBus: {}
        });
        globalThis.__paraDialog.onApply(mods);
      }
      assert.equal(u.history.canUndo(), false);
      assert.deepEqual(state(d, c), before);
      assert.deepEqual(d.exportHwpx(), raw);
      assert(u.h.getPendingFootnoteCharShape());
      u.input('한😀Q');
      const after = state(d, c);
      verifyInsert(before, after, 1, 8, '한😀Q', mods);
      assert.equal(u.cursor.fnCharOffset, 11);
      assert(u.h.getPendingFootnoteCharShape());
      assert.equal(u.calls.length, 1);
      undoRedo(u, d, c, before, after);
      save(d, c, after, action);
      cases++;
    } finally {
      u.h.cancelPendingFootnoteComposition();
      u.history.clear(u.wasm);
      d.free();
    }
  }
  for (const action of ['first-note-near-number', 'empty-paragraph']) {
    const d = new HwpDocument(fs.readFileSync(c.file)),
      u = ui(d, c);
    try {
      const para = action === 'empty-paragraph' ? 2 : 0,
        start = action === 'empty-paragraph' ? 0 : 2;
      u.cursor.setFnCursorPosition(para, start);
      const before = state(d, c);
      u.h.applyCharFormat({
        bold: true,
        fontSize: 1800
      });
      u.input('한😀');
      const after = state(d, c);
      if (action === 'empty-paragraph') {
        assert.equal(after.notes[para].text, '한😀');
        assert(after.notes[para].chars.every(p => p.bold && p.fontSize === 1800));
        assert.deepEqual(after.notes[para].para, before.notes[para].para);
        for (let p = 0; p < before.notes.length; p++) if (p !== para) assert.deepEqual(after.notes[p], before.notes[p]);
        assert.deepEqual(after.neighbor, before.neighbor);
        assert.equal(after.body, before.body);
        assert.deepEqual(after.bodyChars, before.bodyChars);
      } else verifyInsert(before, after, para, start, '한😀', {
        bold: true,
        fontSize: 1800
      });
      undoRedo(u, d, c, before, after);
      save(d, c, after, action);
      boundaryCases++;
    } finally {
      u.h.cancelPendingFootnoteComposition();
      u.history.clear(u.wasm);
      d.free();
    }
  }
  // Reservation lifetime follows cursor revision; round trips cannot resurrect it.
  for (const move of ['away-back', 'selection-clear', 'mode-return', 'other-note-return', 'enter', 'backspace', 'delete-forward', 'fresh-format-after-move']) {
    const d = new HwpDocument(fs.readFileSync(c.file)),
      u = ui(d, c);
    try {
      u.h.toggleFormat('bold');
      const old = u.h.getPendingFootnoteCharShape();
      assert(old);
      if (move === 'away-back') {
        u.cursor.setFnCursorPosition(1, 9);
        u.cursor.setFnCursorPosition(1, 8);
      } else if (move === 'selection-clear') {
        u.cursor.setAnchor();
        u.cursor.setFnCursorPosition(1, 10);
        u.cursor.clearSelection();
        u.cursor.setFnCursorPosition(1, 8);
      } else if (move === 'mode-return') {
        u.cursor.exitFootnoteMode();
        u.cursor.enterHeaderFooterMode(true, 0, 0, 0);
        u.cursor.exitHeaderFooterMode();
        u.cursor.enterFootnoteMode(0, 0, c.control, 0, 0);
        u.cursor.setFnCursorPosition(1, 8);
      } else if (move === 'other-note-return') {
        u.cursor.exitFootnoteMode();
        u.cursor.enterFootnoteMode(0, 0, c.neighbor, 1, 0);
        u.cursor.exitFootnoteMode();
        u.cursor.enterFootnoteMode(0, 0, c.control, 0, 0);
        u.cursor.setFnCursorPosition(1, 8);
      } else if (move === 'fresh-format-after-move') {
        u.cursor.setFnCursorPosition(1, 10);
        u.h.applyCharFormat({
          textColor: '#336699'
        });
        assert.deepEqual(u.h.getPendingFootnoteCharShape(), {
          textColor: '#336699'
        });
      } else u.key(move === 'enter' ? 'Enter' : move === 'backspace' ? 'Backspace' : 'Delete');
      if (move === 'delete-forward') {
        assert.deepEqual(u.h.getPendingFootnoteCharShape(), old);
      } else if (move !== 'fresh-format-after-move') assert.equal(u.h.getPendingFootnoteCharShape(), undefined, move);
      lifetimeCases++;
    } finally {
      u.h.cancelPendingFootnoteComposition();
      u.history.clear(u.wasm);
      d.free();
    }
  }
  for (const action of ['compose', 'cancel', 'empty-first', 'compose-font', 'interrupted', 'undo-mid-composition', 'command-mid-composition']) {
    const d = new HwpDocument(fs.readFileSync(c.file)),
      u = ui(d, c);
    try {
      const before = state(d, c);
      const mods = action === 'compose-font' ? {
        fontName: 'Composition Note QA Font',
        bold: true
      } : {
        bold: true,
        italic: true
      };
      u.h.applyCharFormat(mods);
      u.start();
      assert(u.h.pendingFootnoteComposition);
      assert.equal(u.history.canUndo(), false);
      if (action === 'empty-first') u.input('');
      u.input('ㅎ');
      u.input('한');
      u.input('한😀');
      assert.equal(u.history.canUndo(), false);
      if (action === 'undo-mid-composition') {
        u.h.handleUndo();
        assert.deepEqual(state(d, c), before);
        assert.equal(u.h.isComposing, false);
        u.end();
        assert.equal(u.history.undoStack.length, 0);
        u.h.handleRedo();
        verifyInsert(before, state(d, c), 1, 8, '한😀', mods);
        restores += 2;
      } else if (action === 'command-mid-composition') {
        u.key('Enter');
        assert.equal(u.h.isComposing, false);
        assert.equal(u.history.undoStack.length, 2);
        u.end();
        assert.equal(u.history.undoStack.length, 2);
        u.h.handleUndo();
        verifyInsert(before, state(d, c), 1, 8, '한😀', mods);
        u.h.handleUndo();
        assert.deepEqual(state(d, c), before);
        restores += 2;
      } else if (action === 'cancel') {
        u.input('');
        u.end();
        assert.deepEqual(state(d, c), before);
        assert.equal(u.history.canUndo(), false);
        noOps++;
      } else if (action === 'interrupted') {
        u.cursor.setFnCursorPosition(1, 4);
        u.input('잘못');
        u.input('여전히 잘못');
        u.end();
        assert.deepEqual(state(d, c), before);
        assert.equal(u.h.getPendingFootnoteCharShape(), undefined);
        assert.equal(u.history.canUndo(), false);
        noOps++;
      } else {
        u.end();
        const after = state(d, c);
        verifyInsert(before, after, 1, 8, '한😀', mods);
        assert.equal(u.history.undoStack.length, 1);
        u.input('한😀');
        assert.deepEqual(state(d, c), after, 'composition ghost input ignored');
        undoRedo(u, d, c, before, after);
        save(d, c, after, action);
      }
      compositionCases++;
    } finally {
      u.h.cancelPendingFootnoteComposition();
      u.history.clear(u.wasm);
      d.free();
    }
  }
  for (const action of ['delete-new-backward', 'delete-new-forward', 'split-new', 'merge-new']) {
    const d = new HwpDocument(fs.readFileSync(c.file)),
      u = ui(d, c);
    try {
      u.h.applyCharFormat({
        bold: true,
        italic: true,
        fontSize: 1700
      });
      u.input('한😀Q');
      const before = state(d, c);
      if (action === 'delete-new-forward') u.cursor.setFnCursorPosition(1, 8);
      if (action === 'merge-new') u.cursor.setFnCursorPosition(1, 0);
      u.key(action === 'split-new' ? 'Enter' : action === 'delete-new-forward' ? 'Delete' : 'Backspace');
      const after = state(d, c);
      assert.notDeepEqual(after, before, action);
      u.h.handleUndo();
      assert.deepEqual(state(d, c), before, action + ' undo');
      u.h.handleRedo();
      assert.deepEqual(state(d, c), after, action + ' redo');
      restores += 2;
      save(d, c, after, action);
      structuralCases++;
    } finally {
      u.h.cancelPendingFootnoteComposition();
      u.history.clear(u.wasm);
      d.free();
    }
  }
  for (const action of ['continue-input', 'change-format-during-composition']) {
    const d = new HwpDocument(fs.readFileSync(c.file)),
      u = ui(d, c);
    try {
      const before = state(d, c);
      u.h.applyCharFormat({
        bold: true
      });
      if (action === 'change-format-during-composition') u.start();
      u.input('한😀Q');
      if (action === 'change-format-during-composition') u.h.toggleFormat('italic');
      const first = state(d, c);
      verifyInsert(before, first, 1, 8, '한😀Q', {
        bold: true
      });
      u.input('Z');
      const after = state(d, c);
      assert.equal(after.notes[1].chars[11].bold, true);
      assert.equal(after.notes[1].chars[11].italic, action === 'change-format-during-composition');
      assert.equal(u.history.undoStack.length, 2);
      u.h.handleUndo();
      assert.deepEqual(state(d, c), first);
      u.h.handleUndo();
      assert.deepEqual(state(d, c), before);
      u.h.handleRedo();
      u.h.handleRedo();
      assert.deepEqual(state(d, c), after);
      restores += 4;
      save(d, c, after, action);
      continuedInputCases++;
    } finally {
      u.h.cancelPendingFootnoteComposition();
      u.history.clear(u.wasm);
      d.free();
    }
  }
  for (const action of ['deactivate', 'dispose', 'document-swap', 'document-release']) {
    let d = new HwpDocument(fs.readFileSync(c.file));
    const u = ui(d, c);
    try {
      const before = state(d, c);
      u.h.applyCharFormat({
        bold: true
      });
      u.start();
      u.input('한😀');
      const nop = () => {};
      Object.assign(u.h, {
        cancelDeferredPaginationFlush: nop,
        stopTextSelectionDragAutoScroll: nop,
        deferredPaginationRunner: {
          cancel: nop
        },
        _cellBlockLetterImeGuard: {
          reset: nop
        },
        fieldMarker: {
          hide: nop,
          dispose: nop
        },
        selectionRenderer: {
          clear: nop,
          dispose: nop
        },
        container: {
          removeEventListener: nop
        }
      });
      Object.assign(u.h.caretLayoutReveal, {
        clear: nop
      });
      Object.assign(u.h.caret, {
        hide: nop,
        dispose: nop
      });
      Object.assign(u.h.textarea, {
        removeEventListener: nop,
        remove: nop
      });
      globalThis.document = {
        removeEventListener: nop
      };
      if (action === 'document-swap') {
        const next = new HwpDocument(fs.readFileSync(c.file));
        u.wasm.doc = next;
        u.wasm.documentGeneration++;
        d.free();
        d = next;
        u.h.deactivate();
        assert.deepEqual(state(d, c), before);
      } else if (action === 'document-release') {
        u.wasm.doc = null;
        d.free();
        d = null;
        u.h.dispose();
      } else {
        u.h[action]();
        assert.deepEqual(state(d, c), before);
      }
      assert.equal(u.h.pendingFootnoteComposition, null);
      assert.equal(u.h.getPendingFootnoteCharShape(), undefined);
      lifecycleCases++;
    } finally {
      u.h.cancelPendingFootnoteComposition();
      if (d) {
        u.history.clear(u.wasm);
        d.free();
      }
    }
  }
  {
    const d=new HwpDocument(fs.readFileSync(c.file)),u=ui(d,c);
    try {
      u.h.applyCharFormat({bold:true});u.input('Q');const after=state(d,c);u.h.handleUndo();
      u.cursor.setFnCursorPosition(3,Array.from(JSON.parse(d.getFootnoteInfo(0,0,c.control)).texts[3]).length);
      u.h.applyCharFormat({bold:true});const before=state(d,c),raw=d.exportHwpx();assert(u.history.canRedo());u.key('Delete');
      assert.deepEqual(state(d,c),before);assert.deepEqual(d.exportHwpx(),raw);assert(u.history.canRedo());assert.deepEqual(u.h.getPendingFootnoteCharShape(),{bold:true});
      assert.throws(()=>u.h.applyCharFormat({fontId:65535}));assert.deepEqual(u.h.getPendingFootnoteCharShape(),{bold:true});assert.deepEqual(state(d,c),before);assert.deepEqual(d.exportHwpx(),raw);assert(u.history.canRedo());
      u.h.handleRedo();assert.deepEqual(state(d,c),after);noOps++;rejections++;restores+=2;
    } finally {u.history.clear(u.wasm);d.free();}
  }
  for (const composing of [false, true]) {
    const d = new HwpDocument(fs.readFileSync(c.file)),
      u = ui(d, c);
    try {
      const before = state(d, c),
        raw = d.exportHwpx();
      u.h.applyCharFormat({
        fontName: 'Rollback Pending Font',
        bold: true
      });
      if (composing) u.start();
      const original = u.wasm.applyCharFormatInFootnote.bind(u.wasm);
      let fail = true;
      u.wasm.applyCharFormatInFootnote = (...args) => {
        if (fail && args[6] > args[4]) {
          const error = Error('injected after insertion');
          error.stack = 'Error: injected after insertion';
          throw error;
        }
        return original(...args);
      };
      if (composing) assert.throws(() => u.input('실패'));else u.input('실패'); // Ordinary input catches a failed snapshot operation.
      assert.deepEqual(state(d, c), before);
      assert.deepEqual(d.exportHwpx(), raw);
      assert.equal(u.history.canUndo(), false);
      fail = false;
      u.input('성공');
      if (composing) u.end();
      verifyInsert(before, state(d, c), 1, 8, '성공', {
        fontName: 'Rollback Pending Font',
        bold: true
      });
      rollbackCases++;
    } finally {
      u.h.cancelPendingFootnoteComposition();
      u.history.clear(u.wasm);
      d.free();
    }
  }
  const d = new HwpDocument(fs.readFileSync(c.file)),
    u = ui(d, c);
  try {
    const before = state(d, c),
      raw = d.exportHwpx();
    for (const props of [{
      bold: 'x'
    }, {
      fontId: 65535
    }, {
      fontName: ''
    }, {
      borderFillId: 1
    }]) {
      assert.throws(() => u.h.applyCharFormat(props));
      assert.deepEqual(state(d, c), before);
      assert.deepEqual(d.exportHwpx(), raw);
      assert.equal(u.history.canUndo(), false);
      rejections++;
    }
  } finally {
    u.history.clear(u.wasm);
    d.free();
  }
}
{
  const c = JSON.parse(fs.readFileSync(path.join(inputs, 'proof.json'))).fixtures[0],
    d = new HwpDocument(fs.readFileSync(c.file)),
    u = ui(d, c),
    live = new Set();
  const saveSnapshot = u.wasm.saveSnapshot.bind(u.wasm),
    discardSnapshot = u.wasm.discardSnapshot.bind(u.wasm);
  u.wasm.saveSnapshot = () => {
    const id = saveSnapshot();
    live.add(id);
    snapshotPeak = Math.max(snapshotPeak, live.size);
    assert(live.size <= 100);
    return id;
  };
  u.wasm.discardSnapshot = id => {
    discardSnapshot(id);
    live.delete(id);
  };
  try {
    u.h.applyCharFormat({
      bold: true
    });
    for (let i = 0; i < 104; i++) u.input('A');
    assert.equal(live.size, 98);
    u.start();
    u.input('ㅎ');
    u.input('한😀');
    u.end();
    assert.equal(live.size, 98);
    const after = state(d, c);
    u.start();
    u.input('취소');
    u.input('');
    u.end();
    assert.deepEqual(state(d, c), after);
    assert.equal(live.size, 98);
    u.h.handleUndo();
    u.h.handleRedo();
    assert.deepEqual(state(d, c), after);
    u.h.handleUndo();
    u.h.applyCharFormat({
      italic: true
    });
    u.input('B');
    assert.equal(u.history.canRedo(), false);
    while (u.history.canUndo()) u.h.handleUndo();
    while (u.history.canRedo()) u.h.handleRedo();
    u.history.clear(u.wasm);
    assert.equal(live.size, 0);
    budgetCases++;
  } finally {
    u.h.cancelPendingFootnoteComposition();
    u.history.clear(u.wasm);
    d.free();
  }
}
for (const cell of [false, true]) {
  const c = JSON.parse(fs.readFileSync(path.join(inputs, 'proof.json'))).fixtures[0],
    d = new HwpDocument(fs.readFileSync(c.file)),
    u = ui(d, c);
  try {
    const before = state(d, c);
    u.cursor.exitFootnoteMode();
    let pos = {
      sectionIndex: 0,
      paragraphIndex: 0,
      charOffset: 3,
      ...(cell ? {
        parentParaIndex: 0,
        controlIndex: 0,
        cellIndex: 0,
        cellParaIndex: 0
      } : {})
    };
    u.cursor.getPosition = () => ({
      ...pos
    });
    u.h.applyCharFormat({
      bold: true
    });
    assert.deepEqual(u.h.getPendingCharShape(), {
      bold: true
    });
    const old = {
      ...pos
    };
    pos.charOffset++;
    u.h.advancePendingCharShapeAnchor(old, pos);
    assert.deepEqual(u.h.getPendingCharShape(), {
      bold: true
    });
    u.cursor.enterFootnoteMode(0, 0, c.control, 0, 0);
    u.h.applyCharFormat({
      italic: true
    });
    assert.equal(u.h.getPendingCharShape(), undefined);
    assert.deepEqual(u.h.pendingCharShape, {
      bold: true
    });
    u.cursor.exitFootnoteMode();
    assert.deepEqual(u.h.getPendingCharShape(), {
      bold: true
    });
    assert.equal(u.h.getPendingFootnoteCharShape(), undefined);
    pos.charOffset++;
    assert.equal(u.h.getPendingCharShape(), undefined);
    u.h.applyCharFormat({
      textColor: '#336699'
    });
    assert.deepEqual(u.h.getPendingCharShape(), {
      textColor: '#336699'
    });
    assert.deepEqual(state(d, c), before);
    bodyCellPendingControls++;
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
  lifetimeCases,
  compositionCases,
  structuralCases,
  rollbackCases,
  lifecycleCases,
  continuedInputCases,
  bodyCellPendingControls,
  boundaryCases,
  budgetCases,
  snapshotPeak,
  noOps,
  savedSVGEqual,
  engineSHA256: sha(wb),
  actualCursorClass: true,
  actualExecuteOperation: true,
  actualTextInputFunctions: true,
  actualFootnoteKeyboardBranch: true,
  realCommandHistory: true,
  sourceSHA256: Object.fromEntries(['rhwp-studio/src/engine/input-handler.ts', 'rhwp-studio/src/engine/input-handler-text.ts', 'rhwp-studio/src/engine/input-handler-keyboard.ts', 'rhwp-studio/src/engine/cursor.ts', 'rhwp-studio/src/engine/history.ts', 'rhwp-studio/src/engine/command.ts', 'rhwp-studio/src/command/commands/format.ts', 'rhwp-studio/src/core/wasm-bridge.ts'].map(p => [p, sha(fs.readFileSync(p))])),
  GUIVerified: false,
  physicalIMEVerified: false,
  DOMAndGeometryAdapter: true
};
fs.writeFileSync(path.join(out, 'proof.json'), JSON.stringify(proof, null, 2));
console.log(JSON.stringify(proof));

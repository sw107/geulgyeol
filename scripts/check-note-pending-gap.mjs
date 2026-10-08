// Real WASM, UI/command/cursor selection methods and CommandHistory; DOM/dispatch adapter.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';
const [engine, inputs, out, baselineRoot] = process.argv.slice(2);
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
  hs = fs.readFileSync(path.join(baselineRoot, 'input-handler.ts'), 'utf8'),
  cus = fs.readFileSync('rhwp-studio/src/engine/cursor.ts', 'utf8');
const commands = await load('const MAX_PAGE_LOCAL_TEXT_EDIT_CHARS=10000;\n' + cs);
globalThis.__noteCommands = commands;
const {
  CommandHistory
} = await load('const {NO_TEXT_MUTATION_EFFECTS}=globalThis.__noteCommands;\n' + fs.readFileSync('rhwp-studio/src/engine/history.ts', 'utf8'));
let bridge = 'export class BridgeProbe {doc;constructor(d){this.doc=d;}\n';
for (const n of ['saveSnapshot', 'restoreSnapshot', 'discardSnapshot', 'getFootnoteInfo', 'getCharPropertiesInFootnote', 'applyCharFormatInFootnote', 'getCharPropertiesAt', 'getParaPropertiesInFootnote', 'applyParaFormatInFootnote', 'insertTextInFootnote']) bridge += method(bs, n);
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
for (const n of ['toggleFormat', 'applyToggleFormat', 'applyCharFormat', 'getSelectedCellBlock', 'getCharPropertiesAtCursor', 'getCharProperties', 'getFootnoteCharFormatSelection', 'applyCharPropsToFootnoteSelection', 'restoreSelectionAfterUndo', 'restoreSelectionAfterRedo', 'sameFootnoteSelectionTarget', 'applyCharPropsToRange', 'adjustFontSize', 'adjustCharRatio', 'adjustCharSpacing', 'applyParaAlign', 'setLineSpacing', 'applyParaPropsAtCursor', 'applyParaFormat', 'applyParaFormatInNoteOrHeader', 'getParaProperties', 'getSelection', 'getCursorPosition', 'applyParaPropsToRange', 'getParaFormatTargetsForRange', 'executeParaFormatCommand']) handler += method(hs, n);
handler += '}';
const {
  HandlerProbe
} = await load(handler);
const {
  formatCommands
} = await load('class ParaShapeDialog {show(props){this.props=props;globalThis.__paraDialog=this;}}\n' + fs.readFileSync(path.join(baselineRoot, 'format.ts'), 'utf8'));
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
    getSelectionOrdered: () => null,
    setFnCursorPosition(p, o) {
      this.fnInnerParaIdx = p;
      this.fnCharOffset = o;
      this._fnInnerParaIdx = p;
      this._fnCharOffset = o;
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
    focusTextarea() {},
    executeOperation(op) {
      if (op.kind === 'record') {
        history.recordWithoutExecute(op.command, wasm);
        return;
      }
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
const textSource = fs.readFileSync(path.join(baselineRoot, 'input-handler-text.ts'), 'utf8');
const input = await load('const {InsertTextInFootnoteCommand}=globalThis.__noteCommands;const charCount=s=>Array.from(s).length;\n' + textSource.slice(textSource.indexOf('export function onInput('), textSource.indexOf('export function insertTextAtRaw(')));
let unsupportedPendingInputs = 0;
for (const c of JSON.parse(fs.readFileSync(path.join(inputs, 'proof.json'))).fixtures) {
  const e = new HwpDocument(fs.readFileSync(c.file)),
    v = ui(e, c);
  v.cursor.fnAnchor = null;
  v.cursor.setFnCursorPosition(1, 8);
  const before = state(e, c);
  v.h.toggleFormat('bold');
  assert.equal(v.h.pendingCharShape, undefined);
  assert.equal(v.calls.length, 0);
  assert.deepEqual(state(e, c), before);
  Object.assign(v.h, {
    active: true,
    isComposing: false,
    _isIOS: false,
    textarea: {
      value: 'QA'
    },
    afterEdit() {}
  });
  input.onInput.call(v.h);
  assert.equal(v.cursor.fnCharOffset, 10);
  assert(JSON.parse(e.getFootnoteInfo(0, 0, c.control)).texts[1].includes('QA'));
  assert.equal(JSON.parse(e.getCharPropertiesInFootnote(0, 0, c.control, 1, 8)).bold, false);
  assert.equal(e.getTextRange(0, 0, 0, 10000), before.body);
  unsupportedPendingInputs++;
  v.history.clear(v.wasm);
  e.free();
}
const proof = {
  unsupportedPendingInputs,
  engineSHA256: sha(wb),
  baselineRoot: path.resolve(baselineRoot),
  actualOnInput: true,
  GUIVerified: false
};
fs.writeFileSync(path.join(out, 'proof.json'), JSON.stringify(proof, null, 2));
console.log(JSON.stringify(proof));

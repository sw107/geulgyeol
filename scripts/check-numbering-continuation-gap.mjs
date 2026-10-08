// Actual package WASM + current numbering dialog/command/InputHandler/CommandHistory.
// Modal DOM, cursor geometry and screen refresh are adapters; this reproduces a gap.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';
const [engine, out] = process.argv.slice(2);
assert(engine && out);
fs.mkdirSync(out, {
  recursive: true
});
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const bytes = fs.readFileSync(path.join(engine, 'rhwp_bg.wasm'));
const {
  initSync,
  HwpDocument
} = await import(pathToFileURL(path.resolve(engine, 'rhwp.js')));
initSync({
  module: bytes
});
const load = async s => import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(s, {
  mode: 'transform'
}).replace(/^import[\s\S]*?;\s*$/gm, '')).toString('base64'));
const method = (s, n) => {
  let a = -1;
  for (const p of ['  ', '  private ']) {
    a = s.indexOf(p + n + '(');
    if (a >= 0) break;
  }
  if (a < 0) a = s.indexOf('  ' + n + '<');
  assert(a >= 0, n);
  return s.slice(a, s.indexOf('\n  }\n', a) + 4) + '\n';
};
const source = {
  bridge: fs.readFileSync('rhwp-studio/src/core/wasm-bridge.ts', 'utf8'),
  input: fs.readFileSync('rhwp-studio/src/engine/input-handler.ts', 'utf8'),
  dialog: fs.readFileSync('rhwp-studio/src/ui/numbering-dialog.ts', 'utf8'),
  format: fs.readFileSync('rhwp-studio/src/command/commands/format.ts', 'utf8'),
  command: fs.readFileSync('rhwp-studio/src/engine/command.ts', 'utf8'),
  history: fs.readFileSync('rhwp-studio/src/engine/history.ts', 'utf8')
};
const commands = await load('const MAX_PAGE_LOCAL_TEXT_EDIT_CHARS=10000;\n' + source.command);
globalThis.__gapCommands = commands;
const {
  CommandHistory
} = await load('const {NO_TEXT_MUTATION_EFFECTS}=globalThis.__gapCommands;\n' + source.history);
let bridge = 'export class BridgeProbe{doc;constructor(d){this.doc=d;}\n';
for (const n of ['getParaPropertiesAt', 'ensureDefaultNumbering', 'createNumbering', 'getNumberingList', 'applyParaFormat', 'setParaShapeId', 'saveSnapshot', 'restoreSnapshot', 'discardSnapshot', 'runInBatch']) bridge += method(source.bridge, n);
bridge += '}';
const {
  BridgeProbe
} = await load(bridge);
const {
  NumberingDialog
} = await load('const BULLET_PRESETS=[];class ModalDialog {constructor(){}show(){globalThis.__gapDialog=this;}hide(){}}\n' + source.dialog);
globalThis.__gapDialogClass = NumberingDialog;
const {
  formatCommands
} = await load('const NumberingDialog=globalThis.__gapDialogClass;\n' + source.format);
let h = 'const {ApplyParaFormatCommand,SnapshotCommand,SubmodeSnapshotCommand,SubmodeSelectionSnapshotCommand}=globalThis.__gapCommands;export class HandlerProbe{\n';
for (const n of ['getParaProperties', 'applyNumbering', 'applyParaPropsAtCursor', 'applyParaFormat', 'applyParaFormatInNoteOrHeader', 'getFootnoteCharFormatSelection', 'getSelectedCellBlock', 'getParaFormatTargetsAtCursor', 'getParaFormatTargetsForRange', 'executeParaFormatCommand', 'executeOperation']) h += method(source.input, n);
h += '}';
const {
  HandlerProbe
} = await load(h);
const textNodes = svg => [...svg.matchAll(/<(text|tspan)\b[^>]*>([^<]*)<\/\1>/g)].map(x => x[2]);
const marker = svg => textNodes(svg).join('').replace(/\s/g, '').match(/(\d+\.)다음목록항목/)?.[1];
let defects = 0,
  controls = 0,
  reopens = 0;
const rows = [];
for (const [id, mode, alreadyNumbered, startNumber] of [['plain-ahead', 0, false, 1], ['existing-previous', 1, true, 1], ['existing-ahead-control', 0, true, 1], ['new-start-control', 2, false, 5]]) {
  const d = HwpDocument.createEmpty();
  d.createBlankDocument();
  const texts = ['기존 목록 첫 항목', '기존 목록 둘째 항목', '설명 문단', '다음 목록 항목'];
  for (let p = 0; p < texts.length; p++) {
    if (p) d.splitParagraph(0, p - 1, Array.from(texts[p - 1]).length);
    d.insertText(0, p, 0, texts[p]);
  }
  const wasm = new BridgeProbe(d),
    nid = wasm.ensureDefaultNumbering();
  for (const p of [0, 1, ...(alreadyNumbered ? [3] : [])]) wasm.applyParaFormat(0, p, JSON.stringify({
    headType: 'Number',
    numberingId: nid,
    paraLevel: 0
  }));
  const history = new CommandHistory(),
    ih = new HandlerProbe();
  let pos = {
    sectionIndex: 0,
    paragraphIndex: 3,
    charOffset: 2
  };
  const cursor = {
    isInFootnote: () => false,
    isInHeaderFooter: () => false,
    isInCellSelectionMode: () => false,
    getSelectionOrdered: () => null,
    getPosition: () => ({
      ...pos
    }),
    getRect: () => null,
    moveTo: p => {
      pos = {
        ...p
      };
    },
    resetPreferredX() {}
  };
  Object.assign(ih, {
    wasm,
    cursor,
    history,
    focus() {},
    focusTextarea() {},
    isOperationAllowedInEditMode: () => true,
    prepareTextMutationBeforeCursor: () => false,
    refreshAfterOperation() {}
  });
  try {
    const beforeProps = texts.map((_, p) => wasm.getParaPropertiesAt(0, p)),
      beforeText = d.getTextFileText(),
      beforeDefs = wasm.getNumberingList(),
      beforeRaw = d.exportHwpx();
    formatCommands.find(x => x.id === 'format:para-num-shape').execute({
      getInputHandler: () => ih,
      wasm,
      eventBus: {}
    });
    const dialog = globalThis.__gapDialog;
    assert(dialog instanceof NumberingDialog);
    dialog.selectedPreset = 2;
    dialog.restartMode = mode;
    dialog.startNumber = startNumber;
    dialog.onConfirm();
    const got = wasm.getParaPropertiesAt(0, 3),
      svg = d.renderPageSvg(0),
      spans = textNodes(svg);
    assert.equal(d.getTextFileText(), beforeText);
    for (const p of [0, 1, 2]) assert.deepEqual(wasm.getParaPropertiesAt(0, p), beforeProps[p]);
    const continuation = mode !== 2;
    const preservedList = got.numberingId === nid;
    const expectedMarker = continuation ? '3.' : '5.';
    const observedMarker = continuation && !preservedList ? '1.' : expectedMarker;
    fs.writeFileSync(path.join(out, id + '.svg'), svg);
    assert.equal(marker(svg), observedMarker, JSON.stringify({
      id,
      spans
    }));
    if (id === 'plain-ahead' || id === 'existing-previous') {
      assert.equal(preservedList, false);
      assert.notEqual(got.numberingRestartMode, mode);
      defects++;
    } else {
      assert.equal(preservedList, mode === 0);
      controls++;
    }
    const row = {
      id,
      requestedMode: mode,
      expectedNumberingId: continuation ? nid : null,
      actualNumberingId: got.numberingId,
      expectedMarker,
      observedMarker,
      queriedRestartMode: got.numberingRestartMode,
      queriedStartNumber: got.numberingStartNum,
      numberingDefinitionsBefore: beforeDefs.length,
      numberingDefinitionsAfter: wasm.getNumberingList().length
    };
    for (const f of ['Hwp', 'Hwpx']) {
      const e = d['export' + f + 'WithReport']();
      try {
        assert.equal(JSON.parse(e.contentLoss()).count, 0);
        const b = e.takeBytes(),
          r = new HwpDocument(b);
        try {
          assert.equal(JSON.parse(r.getParaPropertiesAt(0, 3)).numberingId, got.numberingId);
          assert.equal(marker(r.renderPageSvg(0)), observedMarker);
          fs.writeFileSync(path.join(out, id + '.' + f.toLowerCase()), b);
          reopens++;
        } finally {
          r.free();
        }
      } finally {
        e.free();
      }
    }
    history.undo(wasm);
    row.undoRetainsNewNumberingDefinition = wasm.getNumberingList().length > beforeDefs.length;
    row.undoRestoresHWPXBytes = Buffer.from(d.exportHwpx()).equals(Buffer.from(beforeRaw));
    if (id === 'plain-ahead' || id === 'existing-previous') {
      ih.applyNumbering(nid);
      assert.equal(marker(d.renderPageSvg(0)), '3.');
      row.existingNumberingAPIControlMarker = '3.';
      controls++;
    }
    rows.push(row);
  } finally {
    history.clear(wasm);
    d.free();
  }
}
const proof = {
  defects,
  controls,
  reopens,
  rows,
  engineSHA256: sha(bytes),
  sourceSHA256: Object.fromEntries(Object.entries(source).map(([k, v]) => [k, sha(v)])),
  actualNumberingDialogConfirm: true,
  actualFormatCommand: true,
  actualInputHandlerExecuteOperation: true,
  realCommandHistory: true,
  GUIVerified: false,
  scope: 'Reproduce only; no feature implementation'
};
fs.writeFileSync(path.join(out, 'proof.json'), JSON.stringify(proof, null, 2));
console.log(JSON.stringify(proof));

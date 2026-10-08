// Read-only scope selection: actual UI methods/commands and packaged WASM; headless cursor/dispatch adapter.
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
for (const n of ['runInBatch', 'getTableDimensions', 'getTableDimensionsByPath', 'getCellInfo', 'getCellInfoByPath', 'getCellParagraphCount', 'getParaPropertiesAt', 'getCellParaPropertiesAt', 'applyParaFormat', 'applyParaFormatInCell', 'setParaShapeId', 'setCellParaShapeId']) bridge += method(bs, n);
bridge += '}\nexport {BridgeProbe};';
const {
  BridgeProbe
} = await load(bridge);
const commands = await load('const MAX_PAGE_LOCAL_TEXT_EDIT_CHARS=10000;\n' + fs.readFileSync(path.join(root, 'rhwp-studio/src/engine/command.ts'), 'utf8'));
globalThis.__gapCommands = commands;
const source = fs.readFileSync(inputHandlerSource ? path.resolve(inputHandlerSource) : path.join(root, 'rhwp-studio/src/engine/input-handler.ts'), 'utf8');
let handler = 'const {ApplyParaFormatCommand}=globalThis.__gapCommands;\n' + fs.readFileSync(path.join(root, 'rhwp-studio/src/engine/cell-block-format.ts'), 'utf8') + 'class HandlerProbe {\n';
for (const n of ['applyParaAlign', 'setLineSpacing', 'applyParaPropsAtCursor', 'applyParaPropsToRange', 'applyParaFormat', 'applyParaFormatInNoteOrHeader', 'getSelectedCellBlock', 'getParaFormatTargetsAtCursor', 'getParaFormatTargetsForCellBlock', 'getParaFormatTargetsForRange', 'executeParaFormatCommand', 'getParaProperties']) handler += method(source, n);
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
assert.equal(typeof HwpDocument.prototype.applyParaFormatInCellByPath, 'undefined');
assert(fs.readFileSync(path.join(root, 'engine/src/document_core/commands/formatting.rs'), 'utf8').includes('pub fn apply_para_format_in_cell_by_path_native'));
const rows = [];
for (const c of JSON.parse(fs.readFileSync(path.join(fixtures, 'proof.json'))).fixtures.filter(c => !c.merged)) for (const action of ['align-center', 'line-spacing', 'dialog-indent', 'block-align']) {
  const d = new HwpDocument(fs.readFileSync(c.file));
  try {
    const wasm = new BridgeProbe(d),
      h = new HandlerProbe(),
      p = {
        sectionIndex: 0,
        paragraphIndex: c.parent,
        parentParaIndex: c.parent,
        controlIndex: c.path[0].controlIndex,
        cellIndex: c.path[0].cellIndex,
        cellParaIndex: c.path[0].cellParaIndex,
        cellPath: c.path,
        charOffset: 1
      };
    let calls = 0;
    Object.assign(h, {
      wasm,
      cursor: {
        getPosition: () => p,
        getSelectionOrdered: () => null,
        isInCellSelectionMode: () => action === 'block-align',
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
        getExcludedCells: () => new Set()
      },
      executeOperation(op) {
        calls++;
        op.command.execute(wasm);
      }
    });
    const before = bytes(d),
      svg = Array.from({
        length: d.pageCount()
      }, (_, i) => d.renderPageSvg(i));
    const actual = JSON.parse(d.getCellParaPropertiesAtByPath(0, c.parent, JSON.stringify(c.path))),
      displayed = h.getParaProperties();
    if (action === 'line-spacing') h.setLineSpacing(160);else if (action === 'dialog-indent') h.applyParaPropsToRange(p, p, {
      indent: 900
    });else h.applyParaAlign('center');
    if (c.depth > 1) {
      assert.equal(calls, 0);
      assert.deepEqual(bytes(d), before);
      assert.deepEqual(Array.from({
        length: d.pageCount()
      }, (_, i) => d.renderPageSvg(i)), svg);
      assert.notEqual(displayed.marginLeft, actual.marginLeft);
    } else {
      assert.equal(calls, 1);
      const props = JSON.parse(d.getCellParaPropertiesAt(0, c.parent, c.control, 0, 0));
      if (action === 'line-spacing') assert.equal(props.lineSpacing, 160);else if (action === 'dialog-indent') assert.equal(props.indent, 6);else assert.equal(props.alignment, 'center');
    }
    rows.push({
      depth: c.depth,
      action,
      operationCalls: calls,
      blocked: c.depth > 1,
      unchanged: c.depth > 1,
      displayedMarginLeft: displayed.marginLeft,
      innermostMarginLeft: actual.marginLeft
    });
  } finally {
    d.free();
  }
}
const proof = {
  candidate: 'Nested-cell direct paragraph formatting',
  actualUIMethodsExecuted: true,
  flatControlCases: 4,
  nestedBlockedCases: 8,
  rows,
  engineSHA256: hash(wasmBytes),
  inputHandlerSHA256: hash(source),
  nativePathFormatterPresent: true,
  standaloneWasmPathParagraphSetterPresent: false,
  DOMAndCursorMocked: true,
  operationDispatchAdapter: true,
  GUIVerified: false
};
fs.writeFileSync(path.join(out, 'proof.json'), JSON.stringify(proof, null, 2));
console.log(JSON.stringify(proof));

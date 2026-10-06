// Actual generated WASM bindings plus current Bridge/commands; no GUI claim.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {pathToFileURL, fileURLToPath} from 'node:url';
import {stripTypeScriptTypes} from 'node:module';

const [engineDir, fixtureDir, outputDir] = process.argv.slice(2);
assert(engineDir && fixtureDir && outputDir, 'ENGINE_DIR FIXTURE_DIR OUTPUT_DIR');
fs.mkdirSync(outputDir, {recursive: true});
const {initSync, HwpDocument} = await import(pathToFileURL(path.join(engineDir, 'rhwp.js')));
const wasmBytes = fs.readFileSync(path.join(engineDir, 'rhwp_bg.wasm'));
initSync({module: wasmBytes});
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const bridgeSource = fs.readFileSync(path.join(root, 'rhwp-studio/src/core/wasm-bridge.ts'), 'utf8');
const methods = ['splitParagraph', 'splitParagraphInCell', 'splitParagraphInCellByPath', 'splitParagraphInHeaderFooter', 'splitParagraphInFootnote', 'saveSnapshot', 'restoreSnapshot', 'discardSnapshot'];
let probe = 'class BridgeProbe {doc; constructor(doc){this.doc=doc;}\n';
for (const name of methods) {
  const a = bridgeSource.indexOf('  ' + name + '(');
  assert(a >= 0, name);
  const b = bridgeSource.indexOf('\n  }', a) + 4;
  probe += bridgeSource.slice(a, b) + '\n';
}
probe += '}\nexport {BridgeProbe};';
const transformedBridge = 'function serializeParaMeta(m){return m ? JSON.stringify(m) : undefined;}\n' + stripTypeScriptTypes(probe, {mode: 'transform'});
const {BridgeProbe} = await import('data:text/javascript;base64,' + Buffer.from(transformedBridge).toString('base64'));
const commandSource = fs.readFileSync(path.join(root, 'rhwp-studio/src/engine/command.ts'), 'utf8');
const transformedCommands = 'const MAX_PAGE_LOCAL_TEXT_EDIT_CHARS=10000;\n' + stripTypeScriptTypes(commandSource, {mode: 'transform'}).replace(/^import .*?;\s*$/gm, '');
const commands = await import('data:text/javascript;base64,' + Buffer.from(transformedCommands).toString('base64'));
const fixtures = JSON.parse(fs.readFileSync(path.join(fixtureDir, 'manifest.json'), 'utf8'));
const rows = [];
let cases = 0, history = 0, inverse = 0, uiCases = 0, rejects = 0;

function position(c) {
  const r = c.route;
  return r.kind === 'body' ? {sectionIndex: 0, paragraphIndex: 0, charOffset: c.offset}
    : {sectionIndex: 0, paragraphIndex: r.parent, parentParaIndex: r.parent, controlIndex: r.control ?? r.path?.[0].controlIndex, cellIndex: r.cell ?? 0, cellParaIndex: 0, charOffset: c.offset, ...(r.kind === 'nested' ? {cellPath: r.path} : {})};
}
function split(bridge, c, meta = c.restoreMeta, apply = c.mode !== 2) {
  const r = c.route;
  let result;
  if (r.kind === 'body') result = bridge.splitParagraph(0, 0, c.offset, meta, apply);
  else if (r.kind === 'nested') result = bridge.splitParagraphInCellByPath(0, r.parent, JSON.stringify(r.path), c.offset, meta, apply);
  else if (r.kind === 'cell') result = bridge.splitParagraphInCell(0, r.parent, r.control, r.cell, 0, c.offset, meta, apply);
  else if (r.kind === 'hf') result = bridge.splitParagraphInHeaderFooter(0, r.header, 0, 0, c.offset, meta, apply);
  else result = bridge.splitParagraphInFootnote(0, r.parent, r.control, 0, c.offset, meta, apply);
  if (typeof result === 'string') result = JSON.parse(result);
  assert.equal(result.ok, true, c.id);
  return position(c);
}
function merge(d, c) {
  const r = c.route;
  if (r.kind === 'body') return JSON.parse(d.mergeParagraph(0, 1));
  if (r.kind === 'nested') {const p = structuredClone(r.path); p.at(-1).cellParaIndex = 1; return JSON.parse(d.mergeParagraphInCellByPath(0, r.parent, JSON.stringify(p)));}
  if (r.kind === 'cell') return JSON.parse(d.mergeParagraphInCell(0, r.parent, r.control, r.cell, 1));
  if (r.kind === 'hf') return JSON.parse(d.mergeParagraphInHeaderFooter(0, r.header, 0, 1));
  return JSON.parse(d.mergeParagraphInFootnote(0, r.parent, r.control, 1));
}
function persist(d, c, suffix, expected, formats = ['Hwp', 'Hwpx']) {
  for (const format of formats) {
    const exported = d['export' + format + 'WithReport']();
    try {
      assert.equal(JSON.parse(exported.contentLoss()).count, 0, c.id + suffix + format);
      const file = path.join(outputDir, c.id + '-' + suffix + '.' + format.toLowerCase());
      fs.writeFileSync(file, exported.takeBytes());
      rows.push({file, expected, styles: c.styles});
    } finally {exported.free();}
  }
}
for (const c of fixtures) {
  const d = new HwpDocument(fs.readFileSync(c.input));
  const bridge = new BridgeProbe(d);
  let undo, redo, cmd;
  try {
    const styles = d.getStyleList();
    if (c.mode === 0) {
      const pos = position(c), r = c.route;
      if (r.kind === 'body') cmd = new commands.SplitParagraphCommand(pos, true);
      else if (r.kind === 'cell' || r.kind === 'nested') cmd = new commands.SplitParagraphInCellCommand(pos, true);
      else {
        const context = r.kind === 'hf' ? {mode: 'headerFooter', sectionIdx: 0, isHeader: r.header, applyTo: 0, paraIdx: 0, charOffset: c.offset, previewPage: 0}
          : {mode: 'footnote', sectionIdx: 0, paraIdx: r.parent, controlIdx: r.control, innerParaIdx: 0, charOffset: c.offset, footnoteIndex: 0, pageNum: 0};
        const afterContext = {...context, charOffset: 0, ...(r.kind === 'hf' ? {paraIdx: 1} : {innerParaIdx: 1})};
        cmd = new commands.SubmodeSelectionSnapshotCommand('enter', pos, pos, b => split(b, c), context, () => afterContext);
      }
      cmd.execute(bridge); uiCases++;
    } else {undo = d.saveSnapshot(); split(bridge, c); redo = d.saveSnapshot();}
    assert.equal(d.getStyleList(), styles, c.id + ' preserves style definitions');
    persist(d, c, 'after', c.after);
    if (cmd) cmd.undo(bridge); else d.restoreSnapshot(undo);
    persist(d, c, 'undo', c.before, ['Hwpx']); history++;
    if (cmd) cmd.execute(bridge); else d.restoreSnapshot(redo);
    persist(d, c, 'redo', c.after, ['Hwpx']); history++;
    if (c.mode === 0) {
      const merged = merge(d, c);
      assert(merged.removedParaMeta?.empty_char_shape_id !== undefined, c.id + ' empty typing shape metadata');
      split(bridge, c, merged.removedParaMeta, true);
      persist(d, c, 'merge-inverse', c.after, ['Hwpx']); inverse++;
    }
    cases++;
  } finally {cmd?.discard(bridge); if (undo !== undefined) d.discardSnapshot(undo); if (redo !== undefined) d.discardSnapshot(redo); d.free();}
}
// Latest metadata guard rejects without changing serialized document/event state.
const d = HwpDocument.createEmpty();
try {
  d.createBlankDocument(); const id = d.createStyle('{"name":"Reference guard"}');
  for (const params of [{name:'bad',nextStyleId:250},{name:'bad',nextStyleId:256},{name:'bad',nextStyleId:-1},{name:'bad',type:2},{name:'bad',baseCharShapeId:65536},{name:7},{name:'bad',baseParaShapeId:9999}]) {
    const styles = d.getStyleList(), events = d.getEventLog();
    assert.equal(d.createStyle(JSON.stringify(params)), -1);
    assert.equal(d.getStyleList(), styles); assert.equal(d.getEventLog(), events); rejects++;
  }
  for (const params of [{name:'bad',nextStyleId:250},{name:'bad',nextStyleId:256},{name:'bad',nextStyleId:-1},{name:7},{nextStyleId:0.5}]) {
    const styles = d.getStyleList(), events = d.getEventLog();
    assert.equal(d.updateStyle(id, JSON.stringify(params)), false);
    assert.equal(d.getStyleList(), styles); assert.equal(d.getEventLog(), events); rejects++;
  }
} finally {d.free();}
// Unsupported following character style must fail before all five Enter routes.
for (const c of fixtures.filter(c => c.direct === 0 && c.mode === 0 && c.input.endsWith('.hwp'))) {
  const d = new HwpDocument(fs.readFileSync(c.input));
  try {
    const charStyle = d.createStyle('{"name":"Unsupported next character style","type":1}');
    assert(d.updateStyle(22, JSON.stringify({nextStyleId: charStyle})));
    const styles = d.getStyleList(), text = d.getTextFileText(), events = d.getEventLog(), svg = d.renderPageSvg(0);
    assert.throws(() => split(new BridgeProbe(d), c));
    assert.equal(d.getStyleList(), styles); assert.equal(d.getTextFileText(), text); assert.equal(d.getEventLog(), events); assert.equal(d.renderPageSvg(0), svg); rejects++;
  } finally {d.free();}
}
fs.writeFileSync(path.join(outputDir, 'runtime-results.json'), JSON.stringify(rows));
const proof = {engineSHA256: crypto.createHash('sha256').update(wasmBytes).digest('hex'), cases, snapshotUndoRedoOperations: history, actualMergeInverseCases: inverse, currentSourceUICommandCases: uiCases, atomicRejections: rejects, serializedOutputs: rows.length, actualGeneratedWasmBindingsExecuted: true, allFiveEnterExportsExecuted: true, nativeGUIVerified: false, physicalIMEVerified: false};
fs.writeFileSync(path.join(outputDir, 'runtime-proof.json'), JSON.stringify(proof, null, 2) + '\n');
console.log(JSON.stringify(proof));

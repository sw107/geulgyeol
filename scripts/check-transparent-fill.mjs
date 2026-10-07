// Same small fixtures and actual shape-dialog patch builder before/after fix.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';
import assert from 'node:assert/strict';
const [engineDir, qaDir, mode, uiSource, label] = process.argv.slice(2);
const output = path.resolve(qaDir, label || mode);
fs.mkdirSync(output);
const M = await import(pathToFileURL(path.resolve(engineDir, 'rhwp.js')));
M.initSync({ module: fs.readFileSync(path.join(engineDir, 'rhwp_bg.wasm')) });
const src = fs.readFileSync(uiSource || new URL('../rhwp-studio/src/ui/picture-props-apply-model.ts', import.meta.url), 'utf8');
const UI = await import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(src)).toString('base64'));
const svg = d => Array.from({ length: d.pageCount() }, (_, p) => d.renderPageSvg(p));
const save = (d, format) => {
  const report = d[format === 'hwp' ? 'exportHwpWithReport' : 'exportHwpxWithReport']();
  try { assert.equal(JSON.parse(report.contentLoss()).count, 0); return report.takeBytes(); }
  finally { report.free(); }
};
function query(d, kind, c) {
  if (kind === 'template') return { char: JSON.parse(d.getCharPropertiesAt(0, 0, 0)), para: JSON.parse(d.getParaPropertiesAt(0, 0)) };
  return JSON.parse(kind === 'cell' ? d.getCellProperties(0, c.paraIdx, c.controlIdx, 0) :
    kind === 'table' ? d.getTableProperties(0,c.paraIdx,c.controlIdx) : d.getShapeProperties(0, c.paraIdx, c.controlIdx));
}
function observedFill(props, kind) {
  if (kind === 'template') return { char: observedFill(props.char, 'cell'), para: observedFill(props.para, 'cell') };
  if (kind === 'shape') return { fillType: props.fillType, ...(props.fillType === 'solid' ? { fillBgColor: props.fillBgColor, fillPatColor: props.fillPatColor, fillPatType: props.fillPatType } : {}) };
  return { fillType: props.fillType, fillColor: props.fillColor, patternColor: props.patternColor, patternType: props.patternType };
}
function shapeForm(p) {
  const mm = n => (n * 25.4 / 7200).toFixed(2);
  const css = n => '#' + [n & 255, (n >>> 8) & 255, (n >>> 16) & 255].map(v => v.toString(16).padStart(2, '0')).join('');
  return {
    common: { ...p, sizeProtect: p.sizeProtect ?? false, width: mm(p.width), height: mm(p.height),
      horzOffset: mm(p.horzOffset), vertOffset: mm(p.vertOffset), restrictInPage: p.restrictInPage ?? true, allowOverlap: p.allowOverlap ?? false },
    transform: {}, outerMargin: {}, caption: { present: false }, line: {}, shapeTextBox: {},
    shapeCorner: { customChecked: false, activeIndex: 0 },
    shapeFill: { solidChecked: p.fillType === 'solid', gradientChecked: p.fillType === 'gradient',
      solidColors: { face: css(p.fillBgColor ?? 0xffffff), pattern: css(p.fillPatColor ?? 0) }, patternType: String(p.fillPatType ?? -1) },
    shapeShadow: { present: false }, image: { effectControlsPresent: false },
  };
}
const rows = [], cases = [], issues = [];
let reopens = 0, undoRedo = 0;
for (const [kind, state] of [['template', 'transparent'], ['cell', 'transparent'], ['shape', 'transparent'], ['cell', 'white'], ['shape', 'white'], ['shape', 'pattern'], ['shape', 'none'], ['table', 'none']]) {
  const d = M.HwpDocument.createEmpty(); let c = { paraIdx: 0, controlIdx: 0 };
  try {
    d.createBlankDocument();
    if(kind==='template')d.insertText(0,0,0,'색 없음과 흰색🙂');
    if(kind!=='template')d.setPageBorderFill(0,JSON.stringify({fillType:'solid',fillColor:'#d0e8ff',patternColor:'#000000',patternType:-1,fillArea:'paper'}));
    if (kind === 'cell') {
      c = JSON.parse(d.createTable(0, 0, 0, 1, 1));
      if (state === 'transparent') d.applyCellBorderFillIds(0, c.paraIdx, c.controlIdx, JSON.stringify({ cells: [{ cellIdx: 0, id: 2 }], zones: [] }));
      else d.setCellProperties(0, c.paraIdx, c.controlIdx, 0, JSON.stringify({ fillType: 'solid', fillColor: '#ffffff', patternColor: '#000000', patternType: -1 }));
    }
    if (kind === 'table') c=JSON.parse(d.createTable(0,0,0,1,1));
    if (kind === 'shape') {
      c = JSON.parse(d.createShapeControl(JSON.stringify({ sectionIdx: 0, paraIdx: 0, charOffset: 0, width: 7200, height: 7200, treatAsChar: true, shapeType: 'rectangle' })));
      d.setShapeProperties(0, c.paraIdx, c.controlIdx, JSON.stringify({ fillType: 'solid', fillBgColor: state === 'white' || state === 'none' ? 16777215 : -1, fillPatColor: 10066329, fillPatType: state === 'pattern' ? 1 : -1, fillAlpha: state === 'transparent' ? 97 : 0 }));
      if (state === 'none') d.setShapeProperties(0, c.paraIdx, c.controlIdx, '{"fillType":"none"}');
    }
    const original = query(d, kind, c), originalSvg = svg(d), label = kind + '-' + state;
    if (mode === 'final') {
      if (kind === 'template') { assert.equal(original.char.fillType, 'none'); assert.equal(original.para.fillType, 'none'); }
      else assert.equal(original.fillType, ['white', 'pattern'].includes(state) ? 'solid' : 'none');
    }
    const before = d.saveSnapshot();
    let patch;
    if (kind === 'shape') patch = UI.buildPicturePropsPatch('shape', original, original, shapeForm(original));
    if (kind === 'cell' || kind === 'table') patch = original.fillType === 'solid' ? {
      fillType: 'solid', fillColor: original.fillColor, patternColor: original.patternColor, patternType: original.patternType,
    } : { fillType: 'none' };
    if (patch) {
      if (kind === 'shape') d.setShapeProperties(0, c.paraIdx, c.controlIdx, JSON.stringify(patch));
      else if(kind==='table')d.setTableProperties(0,c.paraIdx,c.controlIdx,JSON.stringify(patch));
      else d.setCellProperties(0, c.paraIdx, c.controlIdx, 0, JSON.stringify(patch));
      if(mode==='final' && (kind==='cell'||kind==='table')){
        const now=query(d,kind,c);
        for(const key of ['borderLeft','borderRight','borderTop','borderBottom','diagonalLine','diagonalSlash','diagonalBackSlash','centerLine'])
          assert.deepEqual(now[key],original[key],'fill-only dialog patch preserves '+key);
      }
      if (state === 'transparent' && JSON.stringify(svg(d)) !== JSON.stringify(originalSvg)) {
        issues.push({ label, issue: 'unchanged dialog-derived fill became visible white', patch });
        if (mode === 'final') assert.fail(label + ' unchanged fill must not become white');
      }
      if (mode === 'final') assert.deepEqual(observedFill(query(d, kind, c), kind), observedFill(original, kind));
    }
    const after = d.saveSnapshot(), afterProps = query(d, kind, c), afterSvg = svg(d);
    d.restoreSnapshot(before); assert.deepEqual(query(d, kind, c), original); assert.deepEqual(svg(d), originalSvg);
    d.restoreSnapshot(after); assert.deepEqual(query(d, kind, c), afterProps); assert.deepEqual(svg(d), afterSvg); undoRedo++;
    // Restore original fixture; exercise explicit white -> none independently.
    d.restoreSnapshot(before);
    const stages = [['initial', observedFill(query(d, kind, c), kind)]];
    for (const stage of ['initial', 'white', 'none']) {
      if (stage !== 'initial') {
        const props = stage === 'white' ? { fillType: 'solid', fillColor: '#ffffff', patternColor: '#000000', patternType: -1 } : { fillType: 'none' };
        if (kind === 'template') { d.applyCharFormat(0, 0, 0, Array.from('색 없음과 흰색🙂').length, JSON.stringify(props)); d.applyParaFormat(0, 0, JSON.stringify(props)); }
        if (kind === 'cell') d.setCellProperties(0, c.paraIdx, c.controlIdx, 0, JSON.stringify(props));
        if (kind === 'table') d.setTableProperties(0,c.paraIdx,c.controlIdx,JSON.stringify(props));
        if (kind === 'shape') {
          const p=query(d,kind,c), form=shapeForm(p);
          form.shapeFill.solidChecked=stage==='white';form.shapeFill.gradientChecked=false;
          form.shapeFill.solidColors={face:'#ffffff',pattern:'#000000'};form.shapeFill.patternType='-1';
          const uiPatch=UI.buildPicturePropsPatch('shape',p,p,form);
          if(mode==='final' && stage==='white' && p.fillType==='none')assert.equal(uiPatch.fillBgColor,16777215,'explicit white activation includes real RGB white');
          d.setShapeProperties(0,c.paraIdx,c.controlIdx,JSON.stringify(uiPatch));
        }
      }
      const expected = observedFill(query(d, kind, c), kind);
      if (mode === 'final' && stage === 'none' && kind === 'shape') assert.equal(svg(d).join('').includes('fill="#ffffff" stroke='), false, 'explicit none removes shape solid fill');
      for (const first of ['hwp', 'hwpx']) {
        const data = save(d, first), one = new M.HwpDocument(data);
        try {
          const props = query(one, kind, c), file = path.join(output, `${label}-${stage}.${first}`);
          fs.writeFileSync(file, data); reopens++;
          if (mode === 'final') assert.deepEqual(observedFill(props, kind), expected, file);
          else if (JSON.stringify(observedFill(props, kind)) !== JSON.stringify(expected)) issues.push({ label, stage, first, expected, actual: observedFill(props, kind) });
          rows.push({ file, kind, state, stage, context: c, fill: observedFill(props, kind), svg: svg(one) });
          for (const second of ['hwp', 'hwpx']) {
            const two = new M.HwpDocument(save(one, second));
            try {
              reopens++; if (mode === 'final') assert.deepEqual(observedFill(query(two, kind, c), kind), expected);
              const three = new M.HwpDocument(save(two, first));
              try { reopens++; if (mode === 'final') assert.deepEqual(observedFill(query(three, kind, c), kind), expected); }
              finally { three.free(); }
            } finally { two.free(); }
          }
        } finally { one.free(); }
      }
    }
    cases.push({ label, original, originalSvg, patch, afterProps, afterSvg, stages });
  } finally { d.free(); }
}
fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(rows, null, 2));
fs.writeFileSync(path.join(output, 'observations.json'), JSON.stringify(cases, null, 2));
const proof = { mode, cases: cases.length, savedFiles: rows.length, reopens, undoRedo, issues,
  actualShapeDialogPatchBuilderExecuted: true, cellDialogFillBranchMirroredFromSource: true, actualGUIVerified: false };
fs.writeFileSync(path.join(output, 'proof.json'), JSON.stringify(proof, null, 2));
console.log(JSON.stringify({ ...proof, issues: issues.length }));

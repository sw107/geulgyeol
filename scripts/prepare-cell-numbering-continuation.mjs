// Synthetic fixtures only; preserves ZIP metadata, including stored mimetype.
// node scripts/prepare-cell-numbering-continuation.mjs BASELINE_SDK FRESH_OUTPUT
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';

const [sdk, output] = process.argv.slice(2);
assert(sdk && output && !fs.existsSync(output));
fs.mkdirSync(output, {recursive: true});
const M = await import(pathToFileURL(path.resolve(sdk, 'rhwp.js')));
M.initSync({module: fs.readFileSync(path.join(sdk, 'rhwp_bg.wasm'))});
const fixtures = [];
for (const columns of [1, 2]) for (const wrap of ['hard', 'soft']) {
  const d = M.HwpDocument.createEmpty();
  try {
    d.createBlankDocument();
    const id = d.createNumbering(JSON.stringify({levelFormats: Array(7).fill('^1.'), numberFormats: Array(7).fill(0), startNumber: 123}));
    const result = JSON.parse(d.createTableEx(JSON.stringify({sectionIdx: 0, paraIdx: 0, charOffset: 0,
      rowCount: columns === 1 ? 1 : 2, colCount: columns, treatAsChar: false,
      colWidths: Array(columns).fill(14000), rowHeights: Array(columns === 1 ? 1 : 2).fill(1400)})));
    assert(result.ok);
    const {paraIdx: parent, controlIdx: ci} = result;
    d.setTableProperties(0, parent, ci, JSON.stringify({treatAsChar: false, pageBreak: columns === 1 ? 2 : 1}));
    d.beginBatch();
    try {
      for (let cell = 0; cell < columns; cell++) {
        const texts = ['BEFORE' + cell, 'CELL' + cell + ' ' + (wrap === 'hard'
          ? Array.from({length: 92}, (_,i) => 'line' + i + ' 한글 words').join('\n')
          : '한글 words text '.repeat(1000)), 'AFTER' + cell];
        const cellPath = p => JSON.stringify([{controlIndex: ci, cellIndex: cell, cellParaIndex: p}]);
        for (let p = 0; p < texts.length; p++) {
          if (p) d.splitParagraphInCellByPath(0, parent, cellPath(p - 1), Array.from(texts[p - 1]).length);
          d.insertTextInCellByPath(0, parent, cellPath(p), 0, texts[p]);
          d.applyParaFormatInCellsByPaths(0, parent, JSON.stringify([JSON.parse(cellPath(p))]),
            JSON.stringify({headType: 'Number', numberingId: id, paraLevel: 0, marginLeft: 0, marginRight: 0, indent: 0}));
        }
      }
    } finally { d.endBatch(); }
    // Reflow the long paragraphs after the batched setup, before freezing the
    // fixture. This avoids retaining stale setup-time line segmentation.
    for (let cell = 0; cell < columns; cell++) {
      d.insertTextInCell(0, parent, ci, cell, 1, 0, 'X');
      d.deleteTextInCell(0, parent, ci, cell, 1, 0, 1);
    }
    const name = `c${columns}-${wrap}`;
    fs.writeFileSync(path.join(output, name + '-seed.hwpx'), d.exportHwpx());
    fixtures.push({name, columns, wrap, parent, ci, id});
  } finally { d.free(); }
}
fs.writeFileSync(path.join(output, 'seeds.json'), JSON.stringify(fixtures, null, 2));
execFileSync('python3', ['-c', String.raw`
import json,re,sys,copy
from pathlib import Path
from zipfile import ZipFile
root=Path(sys.argv[1]); manifest=[]
for row in json.loads((root/'seeds.json').read_text()):
 with ZipFile(root/(row['name']+'-seed.hwpx')) as src:
  for bits in (0,4,8,12):
   header=src.read('Contents/header.xml').decode()
   def patch(match):
    text=match.group(0)
    for key,value in [('useInstWidth',(bits>>2)&1),('autoIndent',(bits>>3)&1),('textOffset',0)]:
     text,n=re.subn(key+r'="[^"]*"',key+'="'+str(value)+'"',text); assert n>=7
    return text
   header,n=re.subn(r'<hh:numbering\b[^>]*\bid="'+str(row['id'])+r'"[^>]*>[\s\S]*?</hh:numbering>',patch,header); assert n==1
   name=row['name']+'-flags'+str(bits)+'.hwpx'
   with ZipFile(root/name,'x') as dst:
    for entry in src.infolist(): dst.writestr(copy.copy(entry),header.encode() if entry.filename=='Contents/header.xml' else src.read(entry.filename))
   manifest.append(dict(row,file=name,bits=bits))
(root/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
`, path.resolve(output)], {stdio: 'inherit'});
console.log(JSON.stringify({synthetic: true, fixtures: fixtures.length * 4}));

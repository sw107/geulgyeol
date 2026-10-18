// Build larger middle sections and retain a separately supplied exact review input.
// node SCRIPT PKG CARRY_BASES FRESH_OUTPUT [REVIEW_INPUT]
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const [pkg, bases, out, review] = process.argv.slice(2);
fs.mkdirSync(out);
const sha = b => createHash('sha256').update(b).digest('hex');
const M = await import(pathToFileURL(path.resolve(pkg, 'rhwp.js')));
M.initSync({module:fs.readFileSync(path.join(pkg,'rhwp_bg.wasm'))});
const rows=[];
for (const f of JSON.parse(fs.readFileSync(bases))) {
  const bytes=fs.readFileSync(f.path);assert.equal(sha(bytes),f.sha256);
  const d=new M.HwpDocument(bytes);
  try {
    d.insertText(f.target,0,d.getParagraphLength(f.target,0),' middle continuation 가나다라 abcdef '.repeat(160));
    const output=d.exportHwpx(),file=path.join(out,f.case+'.hwpx');
    fs.writeFileSync(file,output,{flag:'wx'});
    rows.push({case:f.case,path:path.resolve(file),sha256:sha(output),target:f.target,sections:f.sections,
      carryHistory:true,crossFormatHwp:false,
      oddSuffix:f.case==='latest-definition-order'?'LATEST_ODD':'ODD',
      prefixOddFromSection:f.case==='two-clean-prefixes'?1:null});
  } finally {d.free();}
}
if (review) {
  const bytes=fs.readFileSync(review),file=path.join(out,'review-exact.hwpx');
  fs.writeFileSync(file,bytes,{flag:'wx'});
  rows.push({case:'review-exact',path:path.resolve(file),sha256:sha(bytes),target:1,sections:3,
    carryHistory:true,crossFormatHwp:false,oddSuffix:'ODD',prefixOddFromSection:null});
}
fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify(rows,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({fixtures:rows.length}));

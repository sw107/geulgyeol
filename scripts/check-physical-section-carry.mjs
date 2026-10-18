// Native counterpart: physical_section_context_check with carryHistory fixtures.
// node SCRIPT PKG MANIFEST FRESH_OUTPUT baseline|fixed
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const [pkg,manifest,out,mode]=process.argv.slice(2);
assert(['baseline','fixed'].includes(mode));fs.mkdirSync(out);
const sha=b=>createHash('sha256').update(b).digest('hex');
const M=await import(pathToFileURL(path.resolve(pkg,'rhwp.js')));
M.initSync({module:fs.readFileSync(path.join(pkg,'rhwp_bg.wasm'))});
const walk=n=>[n,...(n.children??[]).flatMap(walk)];
const frames=d=>Array.from({length:d.pageCount()},(_,p)=>{
  const t=JSON.parse(d.getPageRenderTree(p));return {info:JSON.parse(d.getPageInfo(p)),decorations:t.children
    .filter(n=>['MasterPage','Header','Footer'].includes(n.type))
    .map(n=>({type:n.type,text:walk(n).filter(n=>n.type==='TextRun').map(n=>n.text??'').join('')}))};
});
const body=d=>Array.from({length:d.getSectionCount()},(_,s)=>Array.from({length:d.getParagraphCount(s)},(_,p)=>d.getTextRange(s,p,0,d.getParagraphLength(s,p))));
const cases=JSON.parse(fs.readFileSync(manifest)),rows=[];
let mismatches=0,restores=0,reopens=0,parityChecks=0;
for(const f of cases){
  const bytes=fs.readFileSync(f.path);assert.equal(sha(bytes),f.sha256);
  const d=new M.HwpDocument(bytes);
  const parity=pages=>{
    for(const page of pages)for(const type of ['Header','Footer']){
      const odd=page.info.pageNumber%2===1;
      const suffix=odd?(f.prefixOddFromSection!==null&&page.info.sectionIndex>=f.prefixOddFromSection?'PREFIX_ODD':f.oddSuffix):'EVEN';
      assert.equal(page.decorations.find(n=>n.type===type)?.text,type.toUpperCase()+'_'+suffix,f.case+' independent slot owner/parity');
      parityChecks++;
    }
  };
  const check=stage=>{
    const live=frames(d),liveBody=body(d),output=d.exportHwpx();
    fs.writeFileSync(path.join(out,f.case+'-'+stage+'.hwpx'),output,{flag:'wx'});
    const cold=new M.HwpDocument(output);
    try {
      const fresh=frames(cold);assert.deepEqual(body(cold),liveBody);assert.deepEqual(frames(d),live,'export leaves live cache untouched');
      parity(fresh);if(mode==='fixed')parity(live);
      const equal=JSON.stringify(live)===JSON.stringify(fresh);if(!equal)mismatches++;reopens++;
      rows.push({case:f.case,stage,equal,live,cold:fresh});return fresh;
    } finally{cold.free();}
  };
  try{
    const before=frames(d),initial=d.saveSnapshot();check('before');
    d.insertText(f.target,0,0,'X');assert.equal(d.pageCount(),before.length);
    const short=check('one-character'),shortSnapshot=d.saveSnapshot();
    const growth=' batch-owner growth 가나다라 abcdef '.repeat(200),last=d.getSectionCount()-1;
    d.beginBatch();d.insertText(0,0,0,growth);d.insertText(last,0,0,'TAIL_EDIT');d.endBatch();
    const batch=check('batch-grown'),batchSnapshot=d.saveSnapshot();assert(batch.length>short.length);
    d.restoreSnapshot(shortSnapshot);restores++;assert.deepEqual(frames(d),short);check('undo-batch');
    d.restoreSnapshot(batchSnapshot);restores++;assert.deepEqual(frames(d),batch);check('redo-batch');
    d.beginBatch();d.deleteText(0,0,0,[...growth].length);d.deleteText(last,0,0,'TAIL_EDIT'.length);d.endBatch();check('batch-shrunk');
    d.restoreSnapshot(initial);restores++;assert.deepEqual(frames(d),before);check('restored');
    d.restoreSnapshot(shortSnapshot);restores++;assert.deepEqual(frames(d),short);check('redo-one-character');
    d.restoreSnapshot(initial);restores++;check('final-before');
    for(const s of [initial,shortSnapshot,batchSnapshot])d.discardSnapshot(s);
  }finally{d.free();}
}
const proof={mode,engineSHA256:sha(fs.readFileSync(path.join(pkg,'rhwp_bg.wasm'))),cases:cases.length,
  comparisons:rows.length,mismatches,reopens,snapshotRestores:restores,parityChecks,rows,GUIVerified:false};
fs.writeFileSync(path.join(out,'proof.json'),JSON.stringify(proof,null,2)+'\n',{flag:'wx'});
if(mode==='baseline')assert(mismatches>0,'old head must reproduce missing clean-prefix slots');else assert.equal(mismatches,0);
console.log(JSON.stringify({...proof,rows:undefined}));

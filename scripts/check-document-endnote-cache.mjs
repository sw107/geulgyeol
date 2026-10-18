// Compare live note rendering/page count with fresh HWPX reopen; no GUI claim.
// node SCRIPT PKG MANIFEST FRESH_OUTPUT baseline|fixed
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const [pkg,manifest,out,mode]=process.argv.slice(2);
assert(['baseline','fixed'].includes(mode));fs.mkdirSync(out);
const sha=b=>createHash('sha256').update(b).digest('hex');
const M=await import(pathToFileURL(path.resolve(pkg,'rhwp.js')));M.initSync({module:fs.readFileSync(path.join(pkg,'rhwp_bg.wasm'))});
const walk=n=>[n,...(n.children??[]).flatMap(walk)];
const fixtures=JSON.parse(fs.readFileSync(manifest)),rows=[];let restores=0;
for(const f of fixtures){
  const input=fs.readFileSync(f.path);assert.equal(sha(input),f.sha256);
  const d=new M.HwpDocument(input),active=f.targets.map(([section,control])=>({section,control,kind:f.kind}));
  const view=doc=>({
    pages:Array.from({length:doc.pageCount()},(_,p)=>{
      const t=JSON.parse(doc.getPageRenderTree(p)),text=walk(t).filter(n=>n.type==='TextRun').map(n=>n.text??'').join('');
      return {info:JSON.parse(doc.getPageInfo(p)),textSHA256:sha(text),textChars:[...text].length};
    }),
    body:Array.from({length:doc.getSectionCount()},(_,s)=>Array.from({length:doc.getParagraphCount(s)},(_,p)=>doc.getTextRange(s,p,0,doc.getParagraphLength(s,p)))),
    notes:active.filter(t=>t.control!==null).map(t=>{
      const n=JSON.parse(doc.getFootnoteInfo(t.section,0,t.control));return {...t,texts:n.texts.map(text=>({chars:[...text].length,sha256:sha(text)}))};
    }),
  });
  const check=stage=>{
    const live=view(d),bytes=d.exportHwpx();fs.writeFileSync(path.join(out,f.case+'-'+stage+'.hwpx'),bytes,{flag:'wx'});
    const cold=new M.HwpDocument(bytes);
    try{
      const fresh=view(cold);assert.deepEqual(live.body,fresh.body);assert.deepEqual(live.notes,fresh.notes);assert.deepEqual(view(d),live,'export leaves live rendering untouched');
      const equal=JSON.stringify(live)===JSON.stringify(fresh);rows.push({case:f.case,stage,equal,live,cold:fresh});return fresh;
    }finally{cold.free();}
  };
  try{
    check('before');const initial=d.saveSnapshot();
    for(const t of active)d.insertTextInFootnote(t.section,0,t.control,0,0,'Z');check('small');
    for(const t of active)d.deleteTextInFootnote(t.section,0,t.control,0,0,1);
    const added='NOTE_CONTENT '.repeat(f.repeat);d.beginBatch();for(const t of active)d.insertTextInFootnote(t.section,0,t.control,0,0,added);d.endBatch();
    const grown=check('grown'),after=d.saveSnapshot();
    d.restoreSnapshot(initial);restores++;check('undo');
    d.restoreSnapshot(after);restores++;assert.deepEqual(view(d),grown);check('redo');
    d.beginBatch();for(const t of active)d.deleteTextInFootnote(t.section,0,t.control,0,0,added.length);d.endBatch();check('shrunk');
    if(f.structural){
      const t=active[0];d.deleteFootnote(t.section,0,t.control);t.control=null;check('removed');
      t.control=JSON.parse(d.insertEndnote(t.section,0,0)).controlIdx;d.insertTextInFootnote(t.section,0,t.control,0,0,'NEW_NOTE');check('added');
    }
    d.restoreSnapshot(initial);restores++;active.splice(0,active.length,...f.targets.map(([section,control])=>({section,control,kind:f.kind})));check('restored');
    d.discardSnapshot(initial);d.discardSnapshot(after);
  }finally{d.free();}
}
const mismatches=rows.filter(r=>!r.equal).length;
const proof={mode,engineSHA256:sha(fs.readFileSync(path.join(pkg,'rhwp_bg.wasm'))),cases:fixtures.length,comparisons:rows.length,mismatches,hwpxReopens:rows.length,snapshotRestores:restores,rows,GUIVerified:false};
fs.writeFileSync(path.join(out,'proof.json'),JSON.stringify(proof,null,2)+'\n',{flag:'wx'});
if(mode==='baseline')assert(mismatches>0);else assert.equal(mismatches,0);
console.log(JSON.stringify({...proof,rows:undefined}));

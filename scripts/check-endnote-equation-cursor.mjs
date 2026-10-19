// observe|fixed PKG MANIFEST NATIVE_ORACLE FRESH_OUTPUT [BASELINE_RAW]
// Public SDK source-scalar caret checks. Generic hitTest uses logical slots.
import fs from'node:fs';import path from'node:path';import assert from'node:assert/strict';
import{pathToFileURL}from'node:url';import{createHash}from'node:crypto';import{isDeepStrictEqual}from'node:util';
const[mode,pkg,manifest,nativeFile,out,baselineFile]=process.argv.slice(2);assert(['observe','fixed'].includes(mode));fs.mkdirSync(out);
const M=await import(pathToFileURL(path.resolve(pkg,'rhwp.js')));M.initSync({module:fs.readFileSync(path.join(pkg,'rhwp_bg.wasm'))});
const read=p=>JSON.parse(fs.readFileSync(p)),sha=b=>createHash('sha256').update(b).digest('hex'),fixtures=read(manifest),oracle=read(nativeFile),baseline=baselineFile?read(baselineFile):null,rows=[],failures=[];
function view(d){return{notes:JSON.parse(d.getFootnoteInfo(0,0,2)),body:Array.from({length:d.getSectionCount()},(_,s)=>Array.from({length:d.getParagraphCount(s)},(_,p)=>d.getTextRange(s,p,0,d.getParagraphLength(s,p)))),pages:Array.from({length:d.pageCount()},(_,p)=>JSON.parse(d.getPageRenderTree(p)))}}
function safe(f){try{return f()}catch(e){return{error:String(e)}}}
for(const f of fixtures){const input=fs.readFileSync(f.path);assert.equal(sha(input),f.sha256);
 for(let offset=0;offset<=[...f.expectedText].length;offset++){
  const d=new M.HwpDocument(input);let initial,edited;
  try{const n=oracle.rows.find(r=>r.case===f.case&&r.offset===offset);assert(n);const before=view(d);assert.equal(before.notes.texts[f.notePara],f.expectedText);initial=d.saveSnapshot();
   const caret=safe(()=>JSON.parse(d.getCursorRectInNote(f.section,f.para,f.control,f.notePara,offset))),ref=n.referenceCaret;
   const aligned=caret.pageIndex===ref.pageIndex&&Math.abs(caret.x-ref.x)<=.11;
   if(!aligned)failures.push({case:f.case,offset,caret,reference:ref});
   assert(isDeepStrictEqual(view(d),before),'getter is read-only');
   const genericHit=caret.error?null:safe(()=>JSON.parse(d.hitTest(caret.pageIndex,caret.x,caret.y+caret.height*.5)));
   const result=JSON.parse(d.insertTextInFootnote(f.section,f.para,f.control,f.notePara,offset,'◆😀'));assert.equal(result.charOffset,offset+2);
   const after=view(d),expected=[...f.expectedText].slice(0,offset).join('')+'◆😀'+[...f.expectedText].slice(offset).join('');assert.equal(after.notes.texts[f.notePara],expected);assert.deepEqual(after.body,before.body);
   const bytes=d.exportHwpx();fs.writeFileSync(path.join(out,f.case+'-'+offset+'.hwpx'),bytes,{flag:'wx'});const cold=new M.HwpDocument(bytes);let reopened;
   try{reopened=view(cold);assert.deepEqual(reopened.notes,after.notes);assert.deepEqual(reopened.body,after.body);}finally{cold.free()}
   edited=d.saveSnapshot();d.restoreSnapshot(initial);const undo=view(d);assert.deepEqual(undo,before);d.restoreSnapshot(edited);const redo=view(d);assert.deepEqual(redo,after);
   const row={case:f.case,offset,reference:ref,caret,genericHit,sourceScalarAndRenderCaretAligned:aligned,before,after,cold:reopened,undo,redo};
   const old=baseline?.rows.find(r=>r.case===f.case&&r.offset===offset);
   if(old)for(const k of['before','after','cold','undo','redo'])assert(isDeepStrictEqual(row[k],old[k]),'source/layout changed: '+f.case+' '+offset+' '+k);
   rows.push(row);
  }finally{if(initial!==undefined)d.discardSnapshot(initial);if(edited!==undefined)d.discardSnapshot(edited);d.free()}
 }
}
const report={mode,GUIVerified:false,historyKind:'SDK snapshots, not actual application CommandHistory',WASMSHA256:sha(fs.readFileSync(path.join(pkg,'rhwp_bg.wasm'))),cases:fixtures.length,sourceScalarQueries:rows.length,genericHitIsLogicalTextLookupNotSourceScalarInverse:true,sourceLayoutAndHistoryUnchangedAgainstBaseline:!!baseline,failures,rows};
fs.writeFileSync(path.join(out,'raw.json'),JSON.stringify(report)+'\n',{flag:'wx'});console.log(JSON.stringify({...report,rows:undefined,failures:failures.length}));if(mode==='fixed')assert.equal(failures.length,0,'source caret geometry must match Native render/model reference');

// WASM producer plus independent text/geometry oracle. Never launches a GUI.
// wasm PKG MANIFEST FRESH_OUT | verify NATIVE_RAW WASM_RAW MANIFEST FRESH_PROOF baseline|fixed
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {pathToFileURL} from 'node:url';import {createHash} from 'node:crypto';
const [mode,...args]=process.argv.slice(2),sha=b=>createHash('sha256').update(b).digest('hex');
const walk=n=>[n,...(n.children??[]).flatMap(walk)];
if(mode==='wasm'){
 const[pkg,manifest,out,expect]=args;fs.mkdirSync(out);const M=await import(pathToFileURL(path.resolve(pkg,'rhwp.js')));M.initSync({module:fs.readFileSync(path.join(pkg,'rhwp_bg.wasm'))});const fixtures=JSON.parse(fs.readFileSync(manifest)),rows=[];
 for(const f of fixtures){const bytes=fs.readFileSync(f.path);assert.equal(sha(bytes),f.sha256);const d=new M.HwpDocument(bytes);
  const view=doc=>({body:Array.from({length:doc.getSectionCount()},(_,s)=>Array.from({length:doc.getParagraphCount(s)},(_,p)=>doc.getTextRange(s,p,0,doc.getParagraphLength(s,p)))),notes:f.targets.map(t=>({...t,kind:'endnote',paragraphs:JSON.parse(doc.getFootnoteInfo(t.section,t.para,t.control)).texts.map(text=>({text}))})),pages:Array.from({length:doc.pageCount()},(_,p)=>({info:JSON.parse(doc.getPageInfo(p)),runs:walk(JSON.parse(doc.getPageRenderTree(p))).filter(n=>n.type==='TextRun').map(n=>({para:n.pi,text:n.text,bbox:[n.bbox.x,n.bbox.y,n.bbox.w,n.bbox.h]}))}))});
  const check=stage=>{const live=view(d),b=d.exportHwpx();fs.writeFileSync(path.join(out,f.case+'-'+stage+'.hwpx'),b,{flag:'wx'});const cold=new M.HwpDocument(b);try{const fresh=view(cold);assert.deepEqual(live.body,fresh.body);assert.deepEqual(live.notes,fresh.notes);const exactViewEqual=JSON.stringify(live)===JSON.stringify(fresh);if(expect!=="baseline")assert(exactViewEqual,"live/reopen geometry differs");assert.deepEqual(view(d),live);rows.push({case:f.case,result:{stage:f.case+'-'+stage,live,cold:fresh,exactViewEqual,exportReadOnly:true}});return live;}finally{cold.free();}};
  try{const initial=d.saveSnapshot(),before=check('before');for(const a of f.actions)d.insertTextInFootnote(a.section,a.para,a.control,a.notePara,0,a.text);const grown=d.saveSnapshot(),after=check('grown');d.restoreSnapshot(initial);{const restored=check('undo');if(expect!=='baseline')assert.deepEqual(restored,before)};d.restoreSnapshot(grown);{const restored=check('redo');if(expect!=='baseline')assert.deepEqual(restored,after)};for(const a of f.actions)d.deleteTextInFootnote(a.section,a.para,a.control,a.notePara,0,[...a.text].length);const shrunk=check('shrunk');assert.deepEqual(shrunk.notes,before.notes);d.discardSnapshot(initial);d.discardSnapshot(grown);}finally{d.free();}
 }
 fs.writeFileSync(path.join(out,'raw.json'),JSON.stringify({GUIVerified:false,wasmSHA256:sha(fs.readFileSync(path.join(pkg,'rhwp_bg.wasm'))),rows}),{flag:'wx'});console.log('wasm stages='+rows.length);
}else if(mode==='verify'){
 const[nativeFile,wasmFile,manifest,proof,expect]=args,native=JSON.parse(fs.readFileSync(nativeFile)),wasm=JSON.parse(fs.readFileSync(wasmFile)),fixtures=JSON.parse(fs.readFileSync(manifest)),rows=[];assert.equal(native.rows.length,wasm.rows.length);
 for(const [ri,nr]of native.rows.entries()){
  const wr=wasm.rows[ri];assert.equal(nr.case,wr.case);const f=fixtures.find(f=>f.case===nr.case),stage=nr.result.stage.slice(nr.case.length+1),v=nr.result.live,wv=wr.result.live;
  assert.deepEqual(v.body,wv.body);assert.deepEqual(v.notes,wv.notes);if(expect!=="baseline")assert(nr.result.exactViewEqual&&nr.result.rebuildEqual&&wr.result.exactViewEqual);
  const before=native.rows.find(r=>r.case===nr.case&&r.result.stage.endsWith('-before')).result.live;
  assert.deepEqual(v.body,before.body);
  for(const note of v.notes)for(const[pi,p]of note.paragraphs.entries()){
   const original=before.notes.find(n=>n.section===note.section&&n.control===note.control).paragraphs[pi].text;
   const action=f.actions.find(a=>a.section===note.section&&a.control===note.control&&a.notePara===pi);
   assert.equal(p.text,(['grown','redo'].includes(stage)?action?.text??'':'')+original,'exact source mutation');
  }
  const mapping=new Map(),groups=new Map(),fragments=new Map();
  for(const page of v.items)for(const c of page.columns)for(const it of c.items)if(it.isEndnote&&it.endnoteSource){const s=it.endnoteSource,key=[s.section,s.para,s.controlIndex,s.noteParaIndex].join(':');mapping.set(page.section+':'+it.paraIndex,key);if(!fragments.has(key))fragments.set(key,[]);fragments.get(key).push({start:it.startLine??0,end:it.endLine??it.lineSegs.count,total:it.lineSegs.count});}
  if(expect!=='baseline')for(const fs of fragments.values()){let next=0;for(const f of fs){assert.equal(f.start,next,'line fragments contiguous');assert(f.end>f.start);next=f.end;}assert.equal(next,fs[0].total,'all canonical lines covered');}
  const violations=[],notes=[];assert.equal(v.pages.length,wv.pages.length);
  const allText=v.pages.flatMap(p=>p.runs).map(t=>t.text).join('');
  for(const section of v.body)for(const text of section)if(text)assert.equal(allText.split(text).length-1,1,'body exactly once');
  for(const[pageIndex,page]of v.pages.entries()){
   const wp=wv.pages[pageIndex];assert.deepEqual(page.info,wp.info);assert.equal(page.runs.length,wp.runs.length);const frame=v.items[pageIndex].bodyArea;
   for(const[ti,t]of page.runs.entries()){
    const wt=wp.runs[ti];assert.equal(t.text,wt.text);assert.equal(t.para,wt.para);for(let j=0;j<4;j++)assert(Math.abs(t.bbox[j]-wt.bbox[j])<=0.051,'native/wasm geometry');
    const key=mapping.get(t.section+':'+t.para);if(!key)continue;
    if(!groups.has(key))groups.set(key,[]);groups.get(key).push({...t,page:pageIndex});const[x,y,width,height]=t.bbox;
    if(!page.info.columns.some(c=>x>=c.x-0.1&&x+width<=c.x+c.width+0.1)||y<frame.y-0.1||y+height>frame.y+frame.height+0.1||y+height>page.info.height+0.1)violations.push({key,page:pageIndex,bbox:t.bbox,frame});
   }
  }
  for(const note of v.notes)for(const[pi,p]of note.paragraphs.entries()){
   const key=[note.section,note.para,note.control,pi].join(':'),runs=groups.get(key)??[],text=runs.map(r=>r.text).join(''),expected=(pi===0?`${v.notes.indexOf(note)+1}) `:'')+p.text;
   // Number prefixes belong to the virtual paragraph and must occur once.
   if(expect==='baseline'&&text!==expected)violations.push({kind:'sourceCoverage',key,expectedChars:[...expected].length,renderChars:[...text].length});
   else assert.equal(text,expected,`${nr.case}/${stage}/${key}: source chars exactly once`);
   let offset=0;for(const run of runs){assert.equal(run.start,offset,`${nr.case}/${stage}: contiguous scalar intervals`);offset+=[...run.text].length;}if(expect!=='baseline')assert.equal(offset,[...expected].length);
   notes.push({source:key,chars:offset,sha256:sha(text),pages:[...new Set(runs.map(r=>r.page))],runs:runs.length});
  }
  if(f.expectedPages!==null&&v.pages.length!==f.expectedPages)violations.push({kind:'expectedPageCount',expected:f.expectedPages,actual:v.pages.length});
  rows.push({case:nr.case,stage,pages:v.pages.length,notes,violations,liveColdRebuildEqual:!!(nr.result.exactViewEqual&&nr.result.rebuildEqual&&wr.result.exactViewEqual)});
 }
 const failures=rows.filter(r=>r.violations.length),result={GUIVerified:false,wasmSHA256:wasm.wasmSHA256,cases:fixtures.length,stages:rows.length,sourceTextAndScalarCoverage:!rows.some(r=>r.violations.some(v=>v.kind==='sourceCoverage')),canonicalLineCoverage:expect!=="baseline",sourceModelPreserved:true,failureStages:failures.length,geometryFailureStages:rows.filter(r=>r.violations.some(v=>v.kind!=='sourceCoverage')).length,sourceCoverageFailureStages:rows.filter(r=>r.violations.some(v=>v.kind==='sourceCoverage')).length,liveColdRebuildMismatchStages:rows.filter(r=>!r.liveColdRebuildEqual).length,violations:failures.reduce((n,r)=>n+r.violations.length,0),rows};fs.writeFileSync(proof,JSON.stringify(result,null,2)+'\n',{flag:'wx'});if(expect==='baseline')assert(failures.length>0);else assert.equal(failures.length,0);console.log(JSON.stringify({...result,rows:undefined}));
}else throw Error('unknown mode');

// Current production commands/history/bridge + public SDK. No GUI claim.
// node scripts/check-cell-path-history.mjs fixed PKG FRESH_OUT [SOURCE_ROOT]
import fs from'node:fs';import path from'node:path';import assert from'node:assert/strict';import crypto from'node:crypto';import{pathToFileURL}from'node:url';
import{loadTextCommandQA}from'./lib/text-command-qa.mjs';import{createNestedHistoryFixture,nestedHistoryView,referenceIndex}from'./lib/nested-history-fixture.mjs';
const[mode,pkg,out,root=process.cwd()]=process.argv.slice(2);assert(['baseline','fixed'].includes(mode));fs.mkdirSync(out);const{commands:C,CommandHistory,Bridge}=loadTextCommandQA(root);const wasm=fs.readFileSync(path.join(pkg,'rhwp_bg.wasm')),M=await import(pathToFileURL(path.resolve(pkg,'rhwp.js')));M.initSync({module:wasm});const sha=x=>crypto.createHash('sha256').update(x).digest('hex'),rows=[],issues=[];let reopens=0;
function equal(a,b,label,name){if(JSON.stringify(a)===JSON.stringify(b))return;issues.push({name,label,actual:a,expected:b});if(mode==='fixed')assert.deepEqual(a,b,name+' '+label);}
for(const scenario of['d2-leaf','d3-leaf','d3-middle','d2-same','d3-same'])for(const kind of['insert','delete-forward','delete-backward'])for(const unicode of[false,true]){
 const name=scenario+'-'+kind+'-'+unicode,{bytes,meta}=createNestedHistoryFixture(M,scenario,unicode);const seed=path.join(out,name+'-seed.hwpx');fs.writeFileSync(seed,bytes);const d=new M.HwpDocument(bytes),h=new CommandHistory(),w=new Bridge(d),initial=nestedHistoryView(d,meta),row={name,kind,meta,seed,stages:[]};
 const offsetA=kind==='insert'?0:kind==='delete-backward'?2:1,offsetB=1;const pos=meta.positions.map((p,i)=>({...p,charOffset:i?offsetB:offsetA}));
 const payloads=unicode?['🧪','𐐀']:['X','Y'];const make=i=>kind==='insert'?new C.InsertTextCommand(pos[i],payloads[i],1000+i*30):new C.DeleteTextCommand(pos[i],1,kind==='delete-backward'?'backward':'forward',undefined,1000+i*30);
 function expectedTexts(before,i){const arr=before.cells.map(c=>c.text),at=referenceIndex(meta,pos[i]),chars=[...arr[at]];assert(at>=0);chars.splice(pos[i].charOffset,kind==='insert'?0:1,...(kind==='insert'?[...payloads[i]]:[]));arr[at]=chars.join('');return arr;}
 function check(label,expected){const view=nestedHistoryView(d,meta);equal(view,expected,label,name);const outputs=[];
  for(const ext of['Hwp','Hwpx']){const bytes=d['export'+ext](),file=path.join(out,name+'-'+label+'.'+ext.toLowerCase());fs.writeFileSync(file,bytes);const r=new M.HwpDocument(bytes);try{assert.deepEqual(nestedHistoryView(r,meta),view,'reopen preserves producing model');reopens++;}finally{r.free();}outputs.push({file,format:ext,sha256:sha(bytes)});}
  row.stages.push({label,view,outputs});
 }
 try{check('before',initial);const expectedA=expectedTexts(initial,0);h.execute(make(0),w);const first=nestedHistoryView(d,meta);assert.deepEqual(first.cells.map(c=>c.text),expectedA);check('first',first);const expectedB=expectedTexts(first,1);h.execute(make(1),w);const second=nestedHistoryView(d,meta);assert.deepEqual(second.cells.map(c=>c.text),expectedB);check('second',second);
  h.undo(w);check('undo-second',meta.same?initial:first);equal(h.canUndo(),!meta.same,'remaining independent undo',name);
  if(!meta.same){h.undo(w);check('undo-first',initial);h.redo(w);check('redo-first',first);h.redo(w);check('redo-second',second);}else{h.redo(w);check('redo-batch',second);}
 }finally{h.clear(w);d.free();rows.push(row);fs.writeFileSync(path.join(out,'progress.json'),JSON.stringify({rows,issues}));}
}
if(mode==='baseline')assert(issues.length>0);const result={mode,cases:rows.length,states:rows.reduce((n,r)=>n+r.stages.length,0),reopens,issues,issueCount:issues.length,GUIVerified:false,WASMSHA256:sha(wasm),commandSourceSHA256:sha(fs.readFileSync(path.join(root,'rhwp-studio/src/engine/command.ts'))),rows};fs.writeFileSync(path.join(out,'raw.json'),JSON.stringify(result));console.log(JSON.stringify({...result,rows:undefined,issues:undefined}));

// Public factories + current production commands/history; synthetic mixed textual fields.
// Run from repository root: node scripts/check-mixed-cell-field-structure.mjs fixed PKG FRESH_OUT
// No GUI or physical IME claim; all edits, history and both-format reopens are strict gates.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {stripTypeScriptTypes} from 'node:module';
const [mode,pkg,out]=process.argv.slice(2);
assert(mode==='fixed'&&pkg&&out);
fs.mkdirSync(out,{recursive:true});
let moduleIndex=0;
const load=async s=>{const f=path.join(out,`adapter-${moduleIndex++}.mjs`);fs.writeFileSync(f,stripTypeScriptTypes(s,{mode:'transform'}).replace(/^import[\s\S]*?;\s*$/gm,''),{flag:'wx'});return import(pathToFileURL(path.resolve(f)));};
const commandSource=fs.readFileSync('rhwp-studio/src/engine/command.ts','utf8');
const commands=await load('const MAX_PAGE_LOCAL_TEXT_EDIT_CHARS=10000;\n'+commandSource);
globalThis.__cellFieldCommands=commands;
const {CommandHistory}=await load('const {NO_TEXT_MUTATION_EFFECTS}=globalThis.__cellFieldCommands;\n'+fs.readFileSync('rhwp-studio/src/engine/history.ts','utf8'));
const source=fs.readFileSync('rhwp-studio/src/core/wasm-bridge.ts','utf8');
const ma=source.indexOf('function serializeParaMeta('),mb=source.indexOf('\n}',ma);assert(ma>=0&&mb>ma);
let bridge=source.slice(ma,mb+2)+'\nexport class Bridge {doc; constructor(d){this.doc=d;}\n';
for(const name of ['splitParagraphInCell','splitParagraphInCellByPath','mergeParagraphInCell','mergeParagraphInCellByPath','getCellParagraphLength','getCellParagraphLengthByPath','saveSnapshot','saveSnapshotWithComposition','restoreSnapshot','discardSnapshot']) {
 const a=source.indexOf('  '+name+'('),b=source.indexOf('\n  }\n',a);assert(a>=0&&b>a,name);bridge+=source.slice(a,b+4)+'\n';
}
const {Bridge}=await load(bridge+'}');
const wasm=fs.readFileSync(path.join(pkg,'rhwp_bg.wasm'));
const M=await import(pathToFileURL(path.resolve(pkg,'rhwp.js')));M.initSync({module:wasm});
const rows=[],issues=[];let snapshots=0,reopens=0,valueEdits=0,hyperlinkEdits=0;
const j=JSON.parse,sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function same(a,b,label){if(JSON.stringify(a)!==JSON.stringify(b)){const differences=[];function walk(a,b,k){if(JSON.stringify(a)===JSON.stringify(b))return;if(a&&b&&typeof a==='object'&&typeof b==='object'){for(const key of new Set([...Object.keys(a),...Object.keys(b)]))walk(a[key],b[key],k+'.'+key)}else differences.push({key:k,actual:a,expected:b})}walk(a,b,'model');throw Error(label+' '+JSON.stringify(differences).slice(0,3000));}}
function create(kind){
 let d=M.HwpDocument.createEmpty();d.createBlankDocument();const t=j(d.createTable(0,0,0,1,2)),p=[{controlIndex:t.controlIdx,cellIndex:0,cellParaIndex:0}],a=[0,t.paraIdx,t.controlIdx,0,0],pj=JSON.stringify(p);
 d.insertTextInCell(...a,0,kind.includes('adjacent')?'앞 AB 뒤 C 끝':'앞 A 중 B 뒤 C 끝');d.insertTextInCell(0,t.paraIdx,t.controlIdx,1,0,0,'옆 셀 보존🙂');
 let style=null;if(kind.startsWith('next-')){
  const source=d.createStyle(JSON.stringify({name:'Source A '+kind})),target=d.createStyle(JSON.stringify({name:'Target B '+kind}));assert(source>=0&&target>=0);
  const size=kind==='next-large'?2100:900;
  assert(d.updateStyleShapes(target,JSON.stringify({fontSize:size,italic:kind==='next-large',textColor:kind==='next-large'?'#0044ff':'#993300'}),JSON.stringify({marginLeft:820,spacingBefore:280})));
  assert(d.updateStyle(source,JSON.stringify({nextStyleId:target})));assert(d.updateStyle(target,JSON.stringify({nextStyleId:target})));
  assert(j(d.applyCellStyle(...a,source)).ok);style={source,target,size};
 }
 const ids=[];for(const [index,marker]of (kind==='mixed-multi'?['A','C']:kind.includes('reverse')?['B']:['A']).entries()){
  const text=d.getTextInCell(...a,0,1000),at=[...text].indexOf(marker),id=j(d.insertClickHereFieldInCell(...a,at,false,'안내'+marker,'메모'+marker,'필드'+marker,true)).fieldId;
  d.setFieldValue(id,kind.includes('empty')?'':index===1?'둘𐐀':'첫🙂');ids.push(id);
 }
 {
  const marker=kind.includes('reverse')||kind.includes('adjacent')?'A':'B';
  const at=[...d.getTextInCell(...a,0,1000)].indexOf(marker);assert(j(d.insertCellHyperlinkByPath(0,t.paraIdx,pj,at,at+1,'https://example.invalid/qa','')).ok);
 }
 if(!style){const len=[...d.getTextInCell(...a,0,1000)].length;d.applyCharFormatInCell(...a,0,1,'{"italic":true}');d.applyCharFormatInCell(...a,len-1,len,'{"bold":true}');}
 const bytes=d.exportHwpx();d.free();return {bytes,parent:t.paraIdx,path:p,ids,style,kind};
}
function view(d,c){return {fields:j(d.getFieldList()),body:Array.from({length:d.getParagraphCount(0)},(_,pi)=>d.getTextRange(0,pi,0,1000)),sibling:d.getTextInCell(0,c.parent,c.path[0].controlIndex,1,0,0,1000),paras:Array.from({length:d.getCellParagraphCountByPath(0,c.parent,JSON.stringify(c.path))},(_,pi)=>{
 const p=c.path.map((x,i)=>({...x,cellParaIndex:i+1===c.path.length?pi:x.cellParaIndex})),pj=JSON.stringify(p),text=d.getTextInCellByPath(0,c.parent,pj,0,1000);
 return {text,style:j(d.getCellStyleAt(0,c.parent,p[0].controlIndex,0,pi)),para:j(d.getCellParaPropertiesAtByPath(0,c.parent,pj)),chars:[...text].map((_,i)=>j(d.getCellCharPropertiesAtByPath(0,c.parent,pj,i))),emptyChar:text?'':j(d.getCellCharPropertiesAtByPath(0,c.parent,pj,0))};
 })};}
function editCheck(d,c,label){
 const before=view(d,c),results=[];
 for(const id of c.ids){const snapshot=d.saveSnapshot();let error=null;try{
  assert(j(d.setFieldValue(id,'새🙂값')).ok);valueEdits++;
  const target=before.fields.find(f=>f.fieldId===id),after=view(d,c),actual=after.fields.find(f=>f.fieldId===id);assert.equal(actual.value,'새🙂값');
  for(const f of before.fields.filter(f=>!f.cellField&&f.fieldId!==id)){
   const other=after.fields.find(x=>x.fieldId===f.fieldId);for(const key of ['fieldId','fieldType','name','guide','command','value','editableInForm'])same(other[key],f[key],label+' neighbor '+key);
  }
  const pi=target.location.path.at(-1).paraIndex,original=before.paras[pi],updated=after.paras[pi];
  const text=[...original.text];same(updated.text,text.slice(0,target.startCharIdx).join('')+'새🙂값'+text.slice(target.endCharIdx).join(''),label+' exact target text');
  same(after.sibling,before.sibling,label+' sibling');same(after.body,before.body,label+' body');
 }catch(e){error=String(e);throw e;}
 finally {d.restoreSnapshot(snapshot);d.discardSnapshot(snapshot);snapshots++;same(view(d,c),before,label+' snapshot restore');}
 results.push({id,error});}
 for(const f of before.fields.filter(f=>f.fieldType==='hyperlink')){
  const snapshot=d.saveSnapshot(),pi=f.location.path.at(-1).paraIndex;
  const p=c.path.map((x,i)=>({...x,cellParaIndex:i+1===c.path.length?pi:x.cellParaIndex}));
  try{assert(j(d.updateCellHyperlinkByPath(0,c.parent,JSON.stringify(p),f.fieldId,'https://example.invalid/updated')).ok);
   const after=view(d,c),updated=after.fields.find(x=>x.fieldId===f.fieldId);assert.equal(updated.command,'https://example.invalid/updated');
   const expected=structuredClone(before);expected.fields.find(x=>x.fieldId===f.fieldId).command='https://example.invalid/updated';same(after,expected,label+' exact hyperlink URL update');hyperlinkEdits++;
  }finally{d.restoreSnapshot(snapshot);d.discardSnapshot(snapshot);snapshots++;same(view(d,c),before,label+' hyperlink snapshot restore');}
 }
 return results;
}
const fixtures=[];for(const kind of ['mixed-forward','mixed-reverse','mixed-empty','mixed-reverse-empty','mixed-adjacent','mixed-reverse-adjacent','mixed-multi','next-large','next-small']){
 const c=create(kind),d=new M.HwpDocument(c.bytes);try{
  const fields=j(d.getFieldList()).filter(f=>!f.cellField),len=[...d.getTextInCellByPath(0,c.parent,JSON.stringify(c.path),0,1000)].length;
  const offsets=c.style?[len]:[...new Set([0,...fields.flatMap(f=>[f.startCharIdx,f.endCharIdx]),len])].sort((a,b)=>a-b);
  for(const offset of offsets)for(const next of [false,true])fixtures.push({...c,at:offset,applyNextStyle:next,name:kind+'-s'+offset+'-next'+next});
 }finally{d.free();}
}
for(const c of fixtures){const d=new M.HwpDocument(c.bytes),w=new Bridge(d),h=new CommandHistory(),row={name:c.name,kind:c.kind,at:c.at,ids:c.ids,style:c.style,applyNextStyle:c.applyNextStyle,stages:[]};
 const initial=view(d,c);
 function check(label){const v=view(d,c);const edits=editCheck(d,c,c.name+' '+label);const renders=Array.from({length:d.pageCount()},(_,i)=>sha(d.renderPageSvg(i))),outputs=[];
  for(const ext of ['Hwp','Hwpx']){const bytes=d['export'+ext](),r=new M.HwpDocument(bytes);try{
   const saved=path.join(out,c.name+'-'+label+'.'+ext.toLowerCase());fs.writeFileSync(saved,bytes,{flag:'wx'});same(view(r,c),v,c.name+' '+label+' '+ext+' reopen');editCheck(r,c,label+' reopen '+ext);reopens++;
   const cold=Array.from({length:r.pageCount()},(_,i)=>sha(r.renderPageSvg(i)));const svgSame=JSON.stringify(cold)===JSON.stringify(renders);assert(svgSame,c.name+' '+label+' '+ext+' live/reopen SVG');outputs.push({format:ext,file:saved,sha256:sha(bytes),svgSame});
  }finally{r.free();}}
  row.stages.push({label,view:v,edits,outputs,svg:renders});
 }
 try{
  check('before');const first=c.path[0],pos={sectionIndex:0,paragraphIndex:c.parent,parentParaIndex:c.parent,controlIndex:first.controlIndex,cellIndex:0,cellParaIndex:0,cellPath:c.path,charOffset:c.at};
  h.execute(new commands.SplitParagraphInCellCommand(pos,c.applyNextStyle),w);
  if(c.style){const v=view(d,c);assert.equal(v.paras[1].style.id,c.applyNextStyle?c.style.target:c.style.source);if(c.applyNextStyle)assert.equal(v.paras[1].emptyChar.fontSize,c.style.size);}
  check('split');const split=view(d,c);h.undo(w);same(view(d,c),initial,c.name+' enter undo');check('undo');h.redo(w);same(view(d,c),split,c.name+' enter redo');check('redo');
  const mergePos={...pos,charOffset:0,cellParaIndex:1,cellPath:[{...first,cellParaIndex:1}]};h.execute(new commands.MergeParagraphInCellCommand(mergePos),w);same(view(d,c),initial,c.name+' merge');check('merge');h.undo(w);same(view(d,c),split,c.name+' backspace undo');check('merge-undo');h.redo(w);same(view(d,c),initial,c.name+' backspace redo');check('merge-redo');
 }catch(e){row.error=String(e);issues.push({case:c.name,error:String(e)});throw e;}finally{d.free();rows.push(row);fs.writeFileSync(path.join(out,'progress.json'),JSON.stringify({rows,issues}));}
}
const result={mode,cases:rows.length,stages:rows.reduce((n,x)=>n+x.stages.length,0),snapshots,reopens,valueEdits,hyperlinkEdits,svgComparisonDifferences:rows.flatMap(x=>x.stages.flatMap(s=>s.outputs.filter(x=>!x.svgSame).map(o=>({case:x.name,stage:s.label,format:o.format})))),issues,WASMSHA256:sha(wasm),GUIVerified:false,rows};
fs.writeFileSync(path.join(out,'raw.json'),JSON.stringify(result));console.log(JSON.stringify({...result,rows:undefined}));

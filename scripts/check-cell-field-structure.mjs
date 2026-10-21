// Public SDK + current application commands/history. No GUI or physical IME claim.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {stripTypeScriptTypes} from 'node:module';
const [mode,pkg,out,manifest]=process.argv.slice(2);
assert(['baseline','fixed'].includes(mode)&&pkg&&out);
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
const cases=[];
if(manifest) for(const c of JSON.parse(fs.readFileSync(manifest))) cases.push({...c,bytes:fs.readFileSync(c.file)});
else for(const applyNextStyle of [false,true]) for(const value of ['','값','🙂𐐀']) {
 const d=M.HwpDocument.createEmpty();try {
  d.createBlankDocument();const t=JSON.parse(d.createTable(0,0,0,1,2)),a=[0,t.paraIdx,t.controlIdx,0,0];
  d.insertTextInCell(...a,0,'앞\t뒤🙂끝');d.insertTextInCell(0,t.paraIdx,t.controlIdx,1,0,0,'옆 셀 보존');
  const id=JSON.parse(d.insertClickHereFieldInCell(...a,2,false,'안내🙂','메모','필드',true)).fieldId;
  d.setFieldValue(id,value);d.applyCharFormatInCell(...a,0,1,'{"italic":true}');
  const len=[...d.getTextInCell(...a,0,100)].length;d.applyCharFormatInCell(...a,len-1,len,'{"bold":true}');
  const bytes=d.exportHwpx();
  for(const at of new Set([0,1,2,2+[...value].length,len]))cases.push({name:`next-style-${applyNextStyle}-v${[...value].length}-s${at}`,parent:t.paraIdx,path:[{controlIndex:t.controlIdx,cellIndex:0,cellParaIndex:0}],flat:true,applyNextStyle,id,at,bytes});
 }finally {d.free();}
}
const rows=[],mismatches=[];let edits=0,rejections=0,reopens=0;
function equal(a,b,label){if(JSON.stringify(a)===JSON.stringify(b))return;const differences=[];
 function walk(a,b,key){if(JSON.stringify(a)===JSON.stringify(b))return;if(a&&b&&typeof a==='object'&&typeof b==='object'){for(const k of new Set([...Object.keys(a),...Object.keys(b)]))walk(a[k],b[k],key+'.'+k);}else differences.push({key,before:b,after:a});}
 walk(a,b,'model');if(!differences.length)return;if(mode==='baseline'){mismatches.push({label,differences});return;}throw Error(label+' '+JSON.stringify(differences).slice(0,4000));}

for(const c of cases){const d=new M.HwpDocument(c.bytes),w=new Bridge(d),history=new CommandHistory();
 const publicView=doc=>({fields:JSON.parse(doc.getFieldList()),paras:Array.from({length:doc.getCellParagraphCountByPath(0,c.parent,JSON.stringify(c.path))},(_,pi)=>{
  const p=c.path.map((x,i)=>({...x,cellParaIndex:i+1===c.path.length?pi:x.cellParaIndex})),j=JSON.stringify(p),text=doc.getTextInCellByPath(0,c.parent,j,0,10000);
  return {text,chars:[...text].map((_,i)=>JSON.parse(doc.getCellCharPropertiesAtByPath(0,c.parent,j,i)))};
 })});
 const row={name:c.name,stages:[]};
 const check=stage=>{
  const label=c.name+' '+stage;
  const view=publicView(d),snap=d.saveSnapshot();let error=null;
  try{assert.equal(JSON.parse(d.setFieldValue(c.id,'새🙂값')).ok,true);edits++;}catch(e){error=String(e);rejections++;}
  d.restoreSnapshot(snap);d.discardSnapshot(snap);equal(publicView(d),view,label+' restore');
  if(mode==='fixed')assert.equal(error,null,label+' value remains editable');
  else if(error)assert.match(error,/제어 토큰 위치/);
  for(const ext of ['Hwp','Hwpx']){const bytes=d['export'+ext](),r=new M.HwpDocument(bytes);try{
   equal(publicView(r),view,label+' '+ext+' reopen');assert.equal(JSON.parse(r.setFieldValue(c.id,'재열기🙂')).ok,true);reopens++;
  }finally{r.free();}}
  row.stages.push({label,error});
 };
 try {
  const initial=publicView(d);check('before');
  const first=c.path[0],pos={sectionIndex:0,paragraphIndex:c.parent,parentParaIndex:c.parent,controlIndex:first.controlIndex,cellIndex:first.cellIndex,cellParaIndex:first.cellParaIndex,cellPath:c.path,charOffset:c.at};
  const cmd=new commands.SplitParagraphInCellCommand(pos,c.applyNextStyle??false);history.execute(cmd,w);check('split');
  history.undo(w);equal(publicView(d),initial,'undo content and formatting');check('undo');
  history.redo(w);check('redo');
  const mergePos={...pos,charOffset:0,cellParaIndex:1,cellPath:c.path.map((x,i)=>({...x,cellParaIndex:i+1===c.path.length?1:x.cellParaIndex}))};
  history.execute(new commands.MergeParagraphInCellCommand(mergePos),w);equal(publicView(d),initial,'merge content and formatting');check('merge');
  history.undo(w);check('merge-undo');history.redo(w);check('merge-redo');
 }finally {d.free();}rows.push(row);
}
if(mode==='baseline')assert(rejections>0,'must reproduce the current defect');
const report={mode,cases:cases.length,stages:rows.reduce((n,r)=>n+r.stages.length,0),edits,rejections,reopens,GUIVerified:false,mismatches,WASMSHA256:crypto.createHash('sha256').update(wasm).digest('hex'),rows};
fs.writeFileSync(path.join(out,'raw.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({...report,rows:undefined,mismatches:mismatches.length}));

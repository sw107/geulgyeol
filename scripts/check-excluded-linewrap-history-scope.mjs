// The new predicate is history only. Compare identical bytes and all full SVGs.
// Usage: BASE_PKG CURRENT_PKG LINEWRAP_SEEDS ROW4_SEEDS ROW65_SEEDS ROW66_SEEDS FRESH_OUT
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {pathToFileURL} from 'node:url';import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';import {EvidenceBudget} from './qa-evidence-budget.mjs';
const [baseArg,currentArg,seedsArg,row4Arg,row65Arg,row66Arg,outArg]=process.argv.slice(2),base=path.resolve(baseArg),current=path.resolve(currentArg),out=path.resolve(outArg);
assert(!fs.existsSync(out));fs.mkdirSync(out);const budget=new EvidenceBudget({root:process.env.GEULGYEOL_QA_BUDGET_ROOT,phase:out});budget.begin({normalForecastBytes:1048576,failureForecastBytes:16384});
const sha=b=>createHash('sha256').update(b).digest('hex'),modules=[];for(const pkg of [base,current]){const m=await import(pathToFileURL(path.join(pkg,'rhwp.js')));m.initSync({module:fs.readFileSync(path.join(pkg,'rhwp_bg.wasm'))});modules.push(m);}
const sourcePins=new Map(),rows=[];const baseSeed=JSON.parse(fs.readFileSync(seedsArg))[0],rowSeeds=[row4Arg,row65Arg,row66Arg].map(p=>JSON.parse(fs.readFileSync(p))[0]);
function model(d){const t=JSON.parse(d.getControls()).find(t=>t.ctrlId==='tbl'&&t.list===0),dim=JSON.parse(d.getTableDimensions(0,t.para,t.controlIndex));return {target:t,dimensions:dim,props:JSON.parse(d.getTableProperties(0,t.para,t.controlIndex)),cells:Array.from({length:dim.cellCount},(_,i)=>({info:JSON.parse(d.getCellInfo(0,t.para,t.controlIndex,i)),props:JSON.parse(d.getCellProperties(0,t.para,t.controlIndex,i)),paragraphs:Array.from({length:d.getCellParagraphCount(0,t.para,t.controlIndex,i)},(_,p)=>({text:d.getTextInCell(0,t.para,t.controlIndex,i,p,0,100000),props:JSON.parse(d.getCellParaPropertiesAt(0,t.para,t.controlIndex,i,p))}))})),body:Array.from({length:d.getParagraphCount(0)},(_,p)=>d.getTextRange(0,p,0,100000)),styles:JSON.parse(d.getStyleList()),pageDef:JSON.parse(d.getPageDef(0)),svg:Array.from({length:d.pageCount()},(_,p)=>sha(d.renderPageSvg(p)))};}
function patch(bytes,edits){return execFileSync('python3',['-B','-c',`import io,zipfile,sys,re,json
edits=json.loads(sys.argv[1])
with zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())) as z:data={n:z.read(n) for n in z.namelist()}
s=data['Contents/section0.xml'].decode();seen=set()
def cell(m):
 v=m.group();a=re.search(r'<hp:cellAddr[^>]*colAddr="(\\d+)"[^>]*rowAddr="(\\d+)"',v)
 for i,e in enumerate(edits):
  if a and tuple(map(int,a.groups()))==(e[1],e[0]):
   key,val=e[2:];v,n=re.subn('('+key+'=")[^"]*(")',lambda x:x.group(1)+val+x.group(2),v,count=1);assert n==1;seen.add(i)
 return v
s=re.sub(r'<hp:tc\\b.*?</hp:tc>',cell,s,flags=re.S);assert len(seen)==len(edits);data['Contents/section0.xml']=s.encode();b=io.BytesIO()
with zipfile.ZipFile(b,'w',zipfile.ZIP_DEFLATED) as z:
 for n,v in data.items():z.writestr(n,v)
sys.stdout.buffer.write(b.getvalue())`,JSON.stringify(edits)],{input:bytes,maxBuffer:1048576});}
function check(label,bytes,expectedHistoryOwner){
 budget.check();const docs=modules.map(m=>new m.HwpDocument(bytes));try{const before=docs.map(model);assert.deepEqual(before[1],before[0],'layout/model unchanged '+label);const {target:t,dimensions:dim}=before[0],layout=docs.map(d=>Array.from({length:dim.cellCount},(_,i)=>d.mergedCellNeedsTextSnapshot(0,t.para,t.controlIndex,i))),repair=Array.from({length:dim.cellCount},(_,i)=>docs[1].excludedLineWrapCellNeedsTextSnapshot(0,t.para,t.controlIndex,i));assert.deepEqual(layout[1],layout[0],'layout scope unchanged '+label);assert.deepEqual(repair.flatMap((v,i)=>v?[i]:[]),expectedHistoryOwner===null?[]:[expectedHistoryOwner],label);
 for(const [i,d]of docs.entries())assert.deepEqual(model(d),before[i],'queries read only '+label);
 rows.push({label,bytesSHA256:sha(bytes),tableRows:dim.rowCount,layoutEligible:layout[0].filter(Boolean).length,historyEligible:repair.flatMap((v,i)=>v?[i]:[]),layoutAndModelExact:true,readOnly:true,modelSHA256:sha(JSON.stringify(before[0]))});
 }finally{for(const d of docs)d.free();}}
try{
 for(const ext of ['hwp','hwpx']){
  const file=baseSeed.files[ext],bytes=fs.readFileSync(file);sourcePins.set(file,sha(bytes));check('original-'+ext,bytes,24);
  const d=new modules[0].HwpDocument(bytes),t=JSON.parse(d.getControls()).find(t=>t.ctrlId==='tbl'&&t.list===0),hwpx=d.exportHwpx();
  const variants=[['normal-BREAK',[[1,0,'lineWrap','BREAK']],null],['two-SQUEEZE',[[2,0,'lineWrap','SQUEEZE']],null],['KEEP',[[1,0,'lineWrap','KEEP']],null],['owner-SQUEEZE',[[1,0,'lineWrap','BREAK'],[8,0,'lineWrap','SQUEEZE']],null],['header-SQUEEZE',[[1,0,'lineWrap','BREAK'],[0,0,'lineWrap','SQUEEZE']],null],['inside-row-SQUEEZE',[[1,0,'lineWrap','BREAK'],[8,2,'lineWrap','SQUEEZE']],null],['track-mismatch',[[1,0,'width','6999']],null]];
  for(const [label,edits,owner]of variants)check(label+'-from-'+ext,patch(hwpx,edits),owner);
  d.setCellProperties(0,t.para,t.controlIndex,4,JSON.stringify({textDirection:1}));check('text-direction-from-'+ext,d.exportHwpx(),null);d.free();
 }
 for(const seed of rowSeeds)for(const ext of ['hwp','hwpx']){
  const file=seed.files[ext],bytes=fs.readFileSync(file);sourcePins.set(file,sha(bytes));const d=new modules[0].HwpDocument(bytes);const hwpx=d.exportHwpx();d.free();const is65=seed.label==='partial-row65';check(seed.label+'-SQUEEZE-from-'+ext,patch(hwpx,[[1,2,'lineWrap','SQUEEZE']]),is65?24:null);
 }
 assert([...sourcePins].every(([file,pin])=>sha(fs.readFileSync(file))===pin));const proof={baselineEngineSHA256:sha(fs.readFileSync(path.join(base,'rhwp_bg.wasm'))),currentEngineSHA256:sha(fs.readFileSync(path.join(current,'rhwp_bg.wasm'))),sourceInputsUnchanged:true,cases:rows.length,rows};budget.check({normalForecastBytes:Buffer.byteLength(JSON.stringify(proof))});fs.writeFileSync(path.join(out,'proof.json'),JSON.stringify(proof,null,2)+'\n',{flag:'wx'});budget.mark('complete');console.log(JSON.stringify({cases:rows.length,modelAndLayoutExact:true,historyOnly:true}));
}catch(e){fs.writeFileSync(path.join(out,'failure.json'),JSON.stringify({failure:String(e).slice(0,2048),cases:rows.length})+'\n',{flag:'wx'});budget.mark('failed');throw e;}

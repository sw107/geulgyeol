// Only two serialized exclusions; no scope expansion or original writes.
// Usage: FRESH_OUT WASM_PKG SOURCE_SEEDS_JSON, with whole-run budget root.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';
import {EvidenceBudget} from './qa-evidence-budget.mjs';
const [outArg,pkgArg,seedsArg]=process.argv.slice(2),out=path.resolve(outArg),pkg=path.resolve(pkgArg);
assert(!fs.existsSync(out));fs.mkdirSync(out);const budget=new EvidenceBudget({root:process.env.GEULGYEOL_QA_BUDGET_ROOT,phase:out});budget.begin({normalForecastBytes:8388608,failureForecastBytes:16384});
const sha=b=>createHash('sha256').update(b).digest('hex'),M=await import(pathToFileURL(path.join(pkg,'rhwp.js')));M.initSync({module:fs.readFileSync(path.join(pkg,'rhwp_bg.wasm'))});
const original=JSON.parse(fs.readFileSync(seedsArg)).find(s=>s.label==='partial-middle-left'),source=fs.readFileSync(original.files.hwpx),pin=sha(source),seeds=[],rows=[];
try{for(const kind of ['lineWrap','textDirection']){
 let d=new M.HwpDocument(source),t=JSON.parse(d.getControls()).find(t=>t.ctrlId==='tbl'&&t.list===0);
 if(kind==='textDirection'){d.setCellProperties(0,t.para,t.controlIndex,3,JSON.stringify({textDirection:1}));assert.equal(JSON.parse(d.getCellProperties(0,t.para,t.controlIndex,3)).textDirection,1);}
 else {const bytes=execFileSync('python3',['-B','-c',`import io,zipfile,sys,re
with zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())) as z:data={n:z.read(n) for n in z.namelist()}
s=data['Contents/section0.xml'].decode();changed=0
def cell(m):
 global changed
 v=m.group();a=re.search(r'<hp:cellAddr[^>]*colAddr="(\\d+)"[^>]*rowAddr="(\\d+)"',v)
 if not a or a.groups()!=('0','1'):return v
 v,n=re.subn(r'(lineWrap=")[^"]*(")',lambda x:x.group(1)+'SQUEEZE'+x.group(2),v,count=1);assert n==1;changed+=1;return v
s=re.sub(r'<hp:tc\\b.*?</hp:tc>',cell,s,flags=re.S);assert changed==1;data['Contents/section0.xml']=s.encode();b=io.BytesIO()
with zipfile.ZipFile(b,'w',zipfile.ZIP_DEFLATED) as z:
 for n,v in data.items():z.writestr(n,v)
sys.stdout.buffer.write(b.getvalue())`],{input:d.exportHwpx()});d.free();d=new M.HwpDocument(bytes);}
 const label='fallback-'+kind,files={};const dim=JSON.parse(d.getTableDimensions(0,t.para,t.controlIndex));
 const owner=Array.from({length:dim.cellCount},(_,i)=>i).find(i=>JSON.parse(d.getCellInfo(0,t.para,t.controlIndex,i)).colSpan===2);
 const eligible=Array.from({length:dim.cellCount},(_,i)=>i).filter(i=>d.mergedCellNeedsTextSnapshot(0,t.para,t.controlIndex,i));assert.deepEqual(eligible,[]);
 for(const ext of ['hwp','hwpx']){files[ext]=path.join(out,label+'.'+ext);const bytes=ext==='hwp'?d.exportHwp():d.exportHwpx();budget.check({normalForecastBytes:bytes.length});fs.writeFileSync(files[ext],bytes,{flag:'wx'});const reopened=new M.HwpDocument(bytes);assert(Array.from({length:dim.cellCount},(_,i)=>i).every(i=>!reopened.mergedCellNeedsTextSnapshot(0,t.para,t.controlIndex,i)));reopened.free();}
 seeds.push({label,files,merged:false,fragmentTail:false,historyGaps:true,historyCell:owner,fallbackExpected:true,expectedRowCount:48,expectedSupported:false,operations:['direct-delete-0','shift-enter-2']});rows.push({label,eligibleCells:eligible,filesSHA256:Object.fromEntries(Object.entries(files).map(([ext,file])=>[ext,sha(fs.readFileSync(file))]))});d.free();
 }
 assert.equal(sha(fs.readFileSync(original.files.hwpx)),pin);fs.writeFileSync(path.join(out,'seeds.json'),JSON.stringify(seeds,null,2)+'\n',{flag:'wx'});fs.writeFileSync(path.join(out,'proof.json'),JSON.stringify({sourceSHA256:pin,sourceUnchanged:true,engineSHA256:sha(fs.readFileSync(path.join(pkg,'rhwp_bg.wasm'))),rows},null,2)+'\n',{flag:'wx'});budget.mark('complete');
}catch(e){budget.mark('failed');throw e;}

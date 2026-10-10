"""Verify identical pre/post inputs, exact repaired undo, and unchanged edit/save models.
Usage: BEFORE_PHASE AFTER_PHASE CURRENT_WASM_PKG FRESH_COMPARISON_PHASE
No raw original or historical evidence is replaced.
"""
import sys
sys.dont_write_bytecode=True
from pathlib import Path
import json,gzip,hashlib,itertools,subprocess
from importlib.util import spec_from_file_location,module_from_spec
from native_qa_budget import BudgetClient
spec=spec_from_file_location('manifest_reader',Path(__file__).with_name('shard-electron-table-manifest.py'));reader=module_from_spec(spec);spec.loader.exec_module(reader)
def sha(p):
    with Path(p).open('rb') as stream:return hashlib.file_digest(stream,'sha256').hexdigest()
def read(p):
    with (gzip.open(p,'rt') if p.suffix=='.gz' else p.open()) as stream:return json.load(stream)
def comparable(v):return {k:x for k,x in v.items() if k not in ['hwp','hwpx']}
def model(v):return {k:x for k,x in comparable(v).items() if k not in ['svg','rendered','cellRendered']}
before,after,pkg,out=[Path(p).resolve() for p in sys.argv[1:5]];assert len(sys.argv)==5 and not out.exists();out.mkdir();budget=BudgetClient(out,normal_forecast=1048576,failure_forecast=16384);pins={};checks=[]
def pin(p):pins[p]=sha(p)
try:
    for q in [before,after]:
        p=read(q/'harness-process.json');assert p['nodeHarnessExitCode']==p['appExitCode']==0 and p['appNormalQuit'] and p['qaSourcesUnchanged'] and p['sourceSeedsUnchanged'];pin(q/'harness-process.json');assert read(q/'qa-evidence-status.json')['outcome']=='complete';pin(q/'proof.json')
    old,new=read(before/'proof.json'),read(after/'proof.json');assert old['pairs']==new['pairs']==8 and old['reopens']==new['reopens']==8
    assert sum(not r['equal'] for r in old['fallbackComparisons'])==8;assert not new['fallbackComparisons']
    for row in new['rows']:
        budget.check();stem=f"{row['label']}-input.{row['ext']}";op=row['operation'];pin(before/'files'/stem);pin(after/'files'/stem);assert sha(before/'files'/stem)==sha(after/'files'/stem),'identical source input bytes required'
        a=before/(stem+'-'+op+'-state.json.gz');b=after/(stem+'-'+op+'-state.json.gz');pin(a);pin(b);a,b=read(a),read(b)
        assert comparable(a['before'])==comparable(b['before']);assert comparable(a['after'])==comparable(b['after']),'first edit layout/model changed'
        assert b['historyAfterEdit']['snapshotResources']==1 and a['historyAfterEdit']['snapshotResources']==0
        for cycle in range(2):
            p=before/(stem+'-'+op+'-undo'+str(cycle)+'.json.gz');q=after/p.name;pin(p);pin(q);u,v=read(p),read(q);assert model(u)==model(a['before']);assert comparable(u)!=comparable(a['before']);assert comparable(v)==comparable(a['before']),'full original SVG/model not restored'
            p=after/(stem+'-'+op+'-redo'+str(cycle)+'.json.gz');pin(p);assert comparable(read(p))==comparable(a['after']),'full post-edit SVG/model not restored'
        checks.append({'input':stem,'operation':op,'sameInputBytes':True,'preEditAndFirstEditExact':True,'oldUndoModelRecovered':True,'oldUndoSVGExact':False,'newUndoRedoFullSVGAndModelExact':True,'sourceSnapshotResources':1})
    m=[q/'manifest.json.gz' for q in [before,after]]
    for p in m:pin(p)
    files=[]
    for a,b in itertools.zip_longest(reader.rows(m[0]),reader.rows(m[1])):
        budget.check();assert a is not None and b is not None;name=Path(a.pop('file')).name;assert name==Path(b.pop('file')).name and a==b,'save/reopen result changed';files.append(str(after/'files'/name));pin(before/'files'/name);pin(after/'files'/name)
    assert len(files)==8
    # Read exported cell wrapping independently from the serialized HWPX, including HWP imports.
    code=r'''import fs from 'node:fs';import path from 'node:path';import {pathToFileURL} from 'node:url';import {execFileSync} from 'node:child_process';const [pkg,list]=process.argv.slice(1),M=await import(pathToFileURL(path.join(pkg,'rhwp.js')));M.initSync({module:fs.readFileSync(path.join(pkg,'rhwp_bg.wasm'))});const rows=[];for(const file of JSON.parse(list)){const d=new M.HwpDocument(fs.readFileSync(file)),t=JSON.parse(d.getControls()).find(t=>t.ctrlId==='tbl'&&t.list===0),dim=JSON.parse(d.getTableDimensions(0,t.para,t.controlIndex)),guarded=Array.from({length:dim.cellCount},(_,i)=>d.mergedCellNeedsTextSnapshot(0,t.para,t.controlIndex,i)),history=Array.from({length:dim.cellCount},(_,i)=>d.excludedLineWrapCellNeedsTextSnapshot(0,t.para,t.controlIndex,i));const wraps=JSON.parse(execFileSync('python3',['-B','-c',`import sys,zipfile,io,json,xml.etree.ElementTree as E
with zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())) as z:r=E.fromstring(z.read('Contents/section0.xml'))
ns={'p':'http://www.hancom.co.kr/hwpml/2011/paragraph'};out=[]
for c in r.findall('.//p:tc',ns):
  sub=c.find('p:subList',ns);wrap=sub.get('lineWrap') if sub is not None else None
  if wrap not in (None,'BREAK'):
    a=c.find('p:cellAddr',ns);out.append([int(a.get('rowAddr')),int(a.get('colAddr')),wrap])
print(json.dumps(out))`],{input:d.exportHwpx()}).toString());rows.push({file:path.basename(file),rows:dim.rowCount,guardedEligible:guarded.filter(Boolean).length,historyEligible:history.flatMap((v,i)=>v?[i]:[]),serializedWrapping:wraps});d.free();}console.log(JSON.stringify(rows));'''
    subprocess.run(['node','--input-type=module','--check'],input=code,text=True,capture_output=True,check=True)
    inspector=subprocess.run(['node','--input-type=module','-e',code,str(pkg),json.dumps(files)],capture_output=True,text=True,check=True);saved= json.loads(inspector.stdout)
    for row in saved:assert row['rows']==48 and row['guardedEligible']==0 and row['historyEligible']==[24] and row['serializedWrapping']==[[1,0,'SQUEEZE']]
    assert all(sha(p)==value for p,value in pins.items())
    result={'sameSourceInputBytes':True,'oldUnequalUndoChecks':8,'newExactUndoRedoPairs':8,'newSavedReopens':8,'firstEditModelAndSVGUnchanged':True,'savedModelAndSVGUnchanged':True,'guardedLayoutScopePromoted':False,'originalEvidenceUnchanged':True,'operations':checks,'savedWrappingChecks':saved,'inputEvidenceSHA256':{str(p):v for p,v in pins.items()}}
    budget.check(len(json.dumps(result).encode()));(out/'proof.json').write_text(json.dumps(result,indent=2)+'\n');budget.mark('complete');print(json.dumps({k:v for k,v in result.items() if k not in ['operations','savedWrappingChecks','inputEvidenceSHA256']}))
except BaseException as e:
    (out/'failure.json').write_text(json.dumps({'failure':str(e)[:2048],'completedChecks':len(checks)})+'\n');budget.mark('failed');raise
finally:budget.close()

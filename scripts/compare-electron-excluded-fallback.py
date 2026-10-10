"""Compare complete observed excluded Electron results; never claim exact undo.
Usage: CURRENT_PHASE BASELINE_PHASE FRESH_COMPARISON_PHASE
All original bytes remain pinned. Manifest parsing streams bounded records.
"""
import sys
sys.dont_write_bytecode=True
from pathlib import Path
import gzip,json,hashlib,itertools
from importlib.util import spec_from_file_location,module_from_spec
spec=spec_from_file_location('manifest_reader',Path(__file__).with_name('shard-electron-table-manifest.py'));reader=module_from_spec(spec);spec.loader.exec_module(reader);rows=reader.rows
from native_qa_budget import BudgetClient

def sha(p):
    with Path(p).open('rb') as stream:return hashlib.file_digest(stream,'sha256').hexdigest()
def read(p):
    with (gzip.open(p,'rt') if p.suffix=='.gz' else p.open()) as stream:return json.load(stream)
def strip_exports(v):
    if isinstance(v,list):return [strip_exports(x) for x in v]
    if isinstance(v,dict):return {k:strip_exports(x) for k,x in v.items() if k not in ['hwp','hwpx']}
    return v
def signature(v):return hashlib.sha256(json.dumps(v,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()
current,base,out=[Path(p).resolve() for p in sys.argv[1:4]]
assert len(sys.argv)==4 and not out.exists();out.mkdir();budget=BudgetClient(out,normal_forecast=1048576,failure_forecast=16384);pins={};proof_rows=[]
def pinned(p):
    value=sha(p);assert p not in pins or pins[p]==value;pins[p]=value;return value
try:
    proofs=[]
    for q in [current,base]:
        assert read(q/'qa-evidence-status.json')['outcome']=='complete'
        proc=read(q/'harness-process.json');assert proc['nodeHarnessExitCode']==proc['appExitCode']==0 and proc['appNormalQuit'];assert proc['qaSourcesUnchanged'] and proc['sourceSeedsUnchanged'];pinned(q/'harness-process.json')
        v=read(q/'proof.json');proofs.append(v);pinned(q/'proof.json');assert v['manifestEvidence']['diskReadBackVerified']
    assert proofs[0]['engineSHA256']=='444e1a45faad4f7c88aaa12b8ba30b6fd7e60174a612c6b54ae657213c8ac988'
    assert proofs[1]['engineSHA256']=='4128c152b6503430e845f4045b0b9a3b03860ab8da5ebbaf89c914d9067e96e1'
    assert proofs[0]['rows']==proofs[1]['rows'];assert proofs[0]['fallbackComparisons']==proofs[1]['fallbackComparisons'],'same legacy round-trip differences required'
    assert proofs[0]['paintChecks']==proofs[1]['paintChecks'],'same observed paint required'
    for q in [current,base]:
        for p in sorted((q/'files').glob('*-input.*')):pinned(p);assert sha(current/'files'/p.name)==sha(base/'files'/p.name),'same exact input bytes required'
    names=lambda q:sorted(p.name for p in q.glob('*.json.gz') if p.name.endswith('-state.json.gz') or '-undo' in p.name and '-svg-diff' not in p.name or '-redo' in p.name or p.name.endswith('-fragments.json.gz'))
    assert names(current)==names(base)
    for name in names(current):
        budget.check();a=current/name;b=base/name;pinned(a);pinned(b);x=strip_exports(read(a));y=strip_exports(read(b));assert x==y,'observed complete model/SVG mismatch: '+name;proof_rows.append({'file':name,'stateSHA256':signature(x),'equal':True})
    m=[q/'manifest.json.gz' for q in [current,base]]
    for p in m:pinned(p)
    saves=[]
    for a,b in itertools.zip_longest(rows(m[0]),rows(m[1])):
        budget.check();assert a is not None and b is not None
        name=Path(a.pop('file')).name;assert name==Path(b.pop('file')).name;assert a==b,'saved full SVG/model mismatch: '+name
        for q in [current,base]:pinned(q/'files'/name)
        saves.append({'file':name,'fullSavedSVGAndModelExact':True,'stateSHA256':signature(a)})
    assert len(saves)==proofs[0]['reopens']==32
    assert all(sha(p)==pin for p,pin in pins.items()),'original bytes changed'
    result={'currentEngineSHA256':proofs[0]['engineSHA256'],'baselineEngineSHA256':proofs[1]['engineSHA256'],'sameInputBytes':True,'originalBytesPreserved':True,'codeAndInputPinsUnchanged':True,'sourceQAHashSame':read(current/'harness-process.json')['qaSourceSHA256']==read(base/'harness-process.json')['qaSourceSHA256'],'flowsPerEngine':16,'historyPairsObservedPerEngine':32,'savedReopensPerEngine':32,'stateAndCaretComparisons':proof_rows,'savedComparisons':saves,'legacyUnequalRoundTripChecks':sum(not r['equal'] for r in proofs[0]['fallbackComparisons']),'legacyDifferencesIdentical':True,'physicalSupportClaimed':False,'exactUndoClaimed':False,'inputEvidenceSHA256':{str(p):pin for p,pin in pins.items()}}
    assert result['sourceQAHashSame'];budget.check(len(json.dumps(result).encode()));(out/'proof.json').write_text(json.dumps(result,indent=2)+'\n');budget.mark('complete');print(json.dumps({k:v for k,v in result.items() if k not in ['stateAndCaretComparisons','savedComparisons','inputEvidenceSHA256']}))
except BaseException as e:
    (out/'failure.json').write_text(json.dumps({'failure':str(e)[:2048],'completedStateComparisons':len(proof_rows)})+'\n');budget.mark('failed');raise
finally:budget.close()

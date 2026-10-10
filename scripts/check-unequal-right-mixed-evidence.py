"""Independently compare retained right-cell mixed histories and save manifests.
Usage: HWP_PHASE HWPX_PHASE FRESH_PROOF_PHASE
Records cross-format observations without accepting a known left-cell exception.
"""
import sys
sys.dont_write_bytecode = True
from pathlib import Path
import gzip, hashlib, json
from importlib.util import spec_from_file_location, module_from_spec
from native_qa_budget import BudgetClient

def sha(p):
    with p.open('rb') as f: return hashlib.file_digest(f,'sha256').hexdigest()
def comparable(v): return {k:x for k,x in v.items() if k not in ['hwp','hwpx']}
def differences(a,b,label):
    a,b=comparable(a),comparable(b)
    keys=[k for k in a.keys()|b.keys() if a.get(k)!=b.get(k)]
    return {'label':label,'differentKeys':keys,'logicalModelEqual':all(k in ['svg','cellRendered'] for k in keys),
            'differentSVGPages':[i for i in range(max(len(a['svg']),len(b['svg']))) if a['svg'][i:i+1]!=b['svg'][i:i+1]]} if keys else None

def main():
    phases=[Path(p).resolve() for p in sys.argv[1:3]];output=Path(sys.argv[3]).resolve()
    assert len(sys.argv)==4 and not output.exists();output.mkdir()
    budget=BudgetClient(output,normal_forecast=1048576,failure_forecast=16384)
    pins={};source=sha(Path(__file__));observations=[];states=[];pairs=0;statefiles=[]
    def read(p):
        budget.check();pins[str(p)]=sha(p)
        with (gzip.open(p,'rt') if p.suffix=='.gz' else p.open()) as f:return json.load(f)
    def equal(a,b,label): assert comparable(a)==comparable(b),label
    try:
        for phase,ext in zip(phases,['hwp','hwpx']):
            process=read(phase/'harness-process.json');proof=read(phase/'proof.json')
            assert process['nodeHarnessExitCode']==process['appExitCode']==0 and process['appNormalQuit']
            assert process['qaSourcesUnchanged'] and process['sourceSeedsUnchanged']
            assert proof['pairs']==24 and proof['reopens']==4 and not proof['errors'] and not proof['fallbackComparisons']
            assert read(phase/'qa-evidence-status.json')['outcome']=='complete'
            prefix='partial-unequal-right-input.'+ext
            initial=read(phase/(prefix+'-initial-state.json.gz'))
            assert initial['cells'][40]['info']=={'row':47,'col':2,'rowSpan':1,'colSpan':1}
            assert initial['cells'][40]['needsTextSnapshot']
            op='mixed-text-history';reference=[initial]
            for i in range(6):reference.append(read(phase/(prefix+'-'+op+'-mixed-step-'+str(i)+'-state.json.gz'))['after'])
            original=initial['cells'][40]['paras'][0]['text']
            expected=[['SEQ🙂'+original],['SEQ🙂\n'+original],['SEQ🙂\n'+original[1:]],['SEQ🙂'+original[1:]],['SEQ🙂',original[1:]],['SEQ🙂','TAIL🙂'+original[1:]]]
            for i,v in enumerate(reference[1:]):
                assert [p['text'] for p in v['cells'][40]['paras']]==expected[i],'actual mixed text step '+str(i)
                assert v['cells'][:40]==initial['cells'][:40],'other cells and repeated headers preserved'
                for k in ['body','bodyFormats','styles','pageDef']:
                    assert v[k]==initial[k],'unchanged trailing body/style/page budget '+k
            operations={}
            for op in ['mixed-text-history','mixed-burst-history']:
                if op=='mixed-burst-history':equal(read(phase/(prefix+'-'+op+'-mixed-burst-state.json.gz'))['after'],reference[-1],'burst final equals settled')
                retained=[]
                for cycle in range(2):
                    for direction,steps in [('undo',range(6)),('redo',range(1,7))]:
                        for i in steps:
                            name=prefix+'-'+op+'-mixed-'+direction+'-'+str(cycle)+'-'+str(i)+'-state.json.gz'
                            actual=read(phase/name);equal(actual,reference[i],'retained full model/SVG '+name)
                            retained.append(actual);statefiles.append(str(phase/name))
                    pairs+=6
                operations[op]=retained
            states.append({'reference':reference,'operations':operations})
        for i,(a,b) in enumerate(zip(states[0]['reference'],states[1]['reference'])):
            diff=differences(a,b,'stage-'+str(i))
            if diff:observations.append(diff)
        for op in states[0]['operations']:
            for i,(a,b) in enumerate(zip(states[0]['operations'][op],states[1]['operations'][op])):
                diff=differences(a,b,op+'-history-'+str(i))
                if diff:observations.append(diff)
        spec=spec_from_file_location('manifest',Path(__file__).with_name('shard-electron-table-manifest.py'));reader=module_from_spec(spec);spec.loader.exec_module(reader)
        manifests=[]
        for phase in phases:
            p=phase/'manifest.json.gz';pins[str(p)]=sha(p);manifests.append(list(reader.rows(p)))
        assert len(manifests[0])==len(manifests[1])==4
        saved=[]
        for a,b in zip(*manifests):
            an,bn=Path(a['file']).name,Path(b['file']).name
            assert an.replace('-hwp-','-hwpx-')==bn
            keys=[k for k in a.keys()|b.keys() if k!='file' and a.get(k)!=b.get(k)]
            saved.append({'hwpInputSave':an,'hwpxInputSave':bn,'equal':not keys,'differentKeys':keys})
        assert len(statefiles)==len(set(statefiles))==96 and pairs==48
        assert all(sha(Path(p))==h for p,h in pins.items()) and sha(Path(__file__))==source
        result={'assertedAndIndependentlyRetainedPairs':pairs,'retainedStateFiles':len(statefiles),'crossFormatStateObservations':observations,
                'crossFormatFullModelSVGEqual':not observations,'savedComparisons':saved,'crossFormatSavedEqual':all(r['equal'] for r in saved),
                'knownLeftExceptionApplied':False,'sourceSHA256':source,'inputEvidenceSHA256':pins}
        payload=json.dumps(result,indent=2)+'\n';budget.check(len(payload.encode()))
        with (output/'proof.json').open('x') as f:f.write(payload)
        budget.mark('complete');print(json.dumps({k:v for k,v in result.items() if k!='inputEvidenceSHA256'}))
    except BaseException as e:
        with (output/'failure.json').open('x') as f:json.dump({'failure':str(e)[:2048]},f)
        budget.mark('failed');raise
    finally:budget.close()
if __name__=='__main__':main()

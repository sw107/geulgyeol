"""Compare two separate history entries and their reversed undo/ordered redo.
Usage: RUN_ROOT WASM_PKG FRESH_COMPARISON_PHASE
Consumes one bounded two-format Electron run; does not execute new layouts.
"""
import sys
sys.dont_write_bytecode = True
from pathlib import Path
import gzip,hashlib,json,subprocess
from datetime import datetime,timezone
from native_qa_budget import BudgetClient

def sha(p):
    with Path(p).open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
def read(p):
    with (gzip.open(p,'rt') if p.suffix=='.gz' else p.open()) as f:return json.load(f)
def comparable(v):return {k:x for k,x in v.items() if k not in ['hwp','hwpx']}
def input_exact(before,after,cell,text):
    a,b=before['cells'][cell]['paras'][0],after['cells'][cell]['paras'][0]
    assert b['text']==text+a['text'] and a['props']==b['props']
    ids=lambda p:[v['charShapeId'] for v in p['runs'] for _ in range(v['endOffset']-v['startOffset'])]
    assert ids(b)[len(text):]==ids(a)
    assert before['cells'][cell]['paras'][1:]==after['cells'][cell]['paras'][1:]
    assert [c for i,c in enumerate(before['cells']) if i!=cell]==[c for i,c in enumerate(after['cells']) if i!=cell]
    assert [c['info'] for c in before['cells']]==[c['info'] for c in after['cells']]
    assert [c['props'] for c in before['cells']]==[c['props'] for c in after['cells']]
    for k in ['body','bodyFormats','props','pageDef','styles','dims']:assert before[k]==after[k]

run,pkg,out=[Path(p).resolve() for p in sys.argv[1:4]]
assert len(sys.argv)==4 and not out.exists()
repo=Path(__file__).resolve().parent.parent
subprocess.run(['node','--input-type=module','-e',"import {EvidenceBudget} from './scripts/qa-evidence-budget.mjs';new EvidenceBudget({root:process.argv[1]}).check({normalForecastBytes:1048576,failureForecastBytes:16384});",str(run.parent)],cwd=repo,check=True)
out.mkdir();budget=BudgetClient(out,normal_forecast=1048576,failure_forecast=16384);pins={};cases=[]
def pinned(p):
    p=Path(p);pins[p]=sha(p);return read(p)
try:
    seed=pinned(run/'seeds.json');assert len(seed)==1;seed=seed[0]
    assert seed['operations']==['owner-multi-history'] and seed['historyCell']==24 and seed['sameFormatSaveReopen'] and seed['repairExpected'] and seed['fallbackExactHistory']
    whole=pinned(run/'whole-run-preflight.json');assert whole['wholeNewNormalForecastBytes']==sum(whole['componentsBytes'].values())==117440512
    assert whole['failureForecastBytes']==117440512 and whole['maxPagesPerFormat']==10 and whole['maxTotalStateFiles']==40 and whole['maxSnapshotResourcesPlan']==4
    prior_public=pinned(repo/'verification/excluded-owner-reopened-edit/proof.json');prior_phase=run.parent/'excluded-owner-reopened-edit/electron'
    prior_process=pinned(prior_phase/'harness-process.json');assert prior_process['nodeHarnessExitCode']==prior_process['appExitCode']==0
    pins[run/'baseline-checker.mjs']=sha(run/'baseline-checker.mjs');baseline=subprocess.check_output(['git','show','a6d5f3df699b4226c574faeede7092209813d560:scripts/check-electron-excluded-linewrap-history.mjs'],cwd=repo)
    assert hashlib.sha256(baseline).hexdigest()==pins[run/'baseline-checker.mjs']==prior_public['qaCheckerSHA256']==prior_process['qaSourceSHA256']
    phase=run/'electron';process=pinned(phase/'harness-process.json')
    assert process['nodeHarnessExitCode']==process['appExitCode']==0 and process['appNormalQuit'] and process['qaSourcesUnchanged'] and process['sourceSeedsUnchanged']
    assert process['sourceSeedsSHA256']==pins[run/'seeds.json']
    for name,digest in process['qaSourceBeforeSHA256'].items():
        src=phase/name if name=='bootstrap.cjs' else repo/'scripts'/name
        assert sha(src)==digest==process['qaSourceAfterSHA256'][name]
    assert pinned(phase/'qa-evidence-status.json')['outcome']=='complete'
    proof=pinned(phase/'proof.json');assert proof['actualMacElectron'] and proof['pairs']==4 and proof['reopens']==2 and len(proof['rows'])==2 and not proof['errors'] and not proof['fallbackComparisons']
    assert proof['engineSHA256']==proof['receivedEngineSHA256']==sha(pkg/'rhwp_bg.wasm')
    assert proof['evidenceLimits']=={'maxPages':10,'maxStateFiles':40,'stateFiles':22}
    assert len(list(phase.glob('*-state.json.gz')))==22
    for scope in proof['repairScopes']:assert scope['guardedEligible']==0 and scope['historyEligible']==[24]
    manifest=pinned(phase/'manifest.json.gz');status=pinned(phase/'manifest-status.json');assert len(manifest)==2 and status['complete'] and status['records']==status['plannedRecords']==2
    audit=[json.loads(line) for line in (phase/'audit.jsonl').read_text().splitlines()];pins[phase/'audit.jsonl']=sha(phase/'audit.jsonl')
    assert [r['ext'] for r in proof['rows']]==['hwpx','hwp']
    for row in proof['rows']:
        budget.check();ext=row['ext'];stem=seed['label']+'-input.'+ext;base=stem+'-owner-multi-history-'
        assert row['operation']=='owner-multi-history' and row['entries']==2 and row['entryTypes']==['snapshot:insertText','insertText']
        assert row['navigationTransitions']==2 and row['historyKeyCommands']==4 and row['undoRedoPairs']==2 and row['sameFormatReopens']==1
        assert row['resourceSequence']==[1,1,1,2,1,1] and row['maxResources']==2
        prior_case=next(v for v in prior_public['cases'] if v['format']==ext)
        assert sha(seed['files'][ext])==sha(phase/'files'/stem)==row['sourceSHA256']==seed['priorSavedSHA256'][ext]==prior_case['savedSHA256']
        assert Path(seed['files'][ext])==prior_phase/'files'/('reopened-lineWrap-'+ext+'-owner-reopened-edit.'+ext)
        setup=pinned(phase/(base+'owner-input-state.json.gz'));source,owner=setup['source'],setup['owner']
        prior=pinned(prior_phase/('reopened-lineWrap-input.'+ext+'-owner-reopened-edit-reopened-state.json.gz'))
        assert comparable(source)==comparable(prior['after']) and source['cells'][24]['paras'][0]['text'].startswith('REOPEN_EDIT🙂SAVE_NAV🙂')
        assert setup['predicates']==[{'cell':24,'guarded':False,'excluded':True},{'cell':25,'guarded':False,'excluded':False}]
        assert source['cells'][24]['info']=={'row':8,'col':0,'rowSpan':32,'colSpan':2} and source['cells'][25]['info']=={'row':8,'col':2,'rowSpan':1,'colSpan':1}
        assert source['dims']['rowCount']==48 and len(source['cells'])==81
        input_exact(source,owner,24,'M24🙂');start,a=setup['sourceObservation'],setup['ownerObservation']
        assert start['dirty'] is False and a['dirty'] is True and setup['ownerHistory']=={'u':1,'r':0,'snapshotResources':1}
        snapshot=json.loads(a['entries']['undo'][0]['fields']);assert snapshot['type']=='snapshot:insertText' and snapshot['beforeId'] is not None and snapshot['afterId'] is None
        tab=pinned(phase/(base+'tab-state.json.gz'));assert tab['reference']==tab['after']==owner and tab['ownerObservation']==a
        before_b=tab['tabObservation'];assert before_b['cursor']['cellIndex']==25 and before_b['cursor']['cellParaIndex']==before_b['cursor']['charOffset']==0
        assert tab['ownerHistory']==tab['tabHistory']==setup['ownerHistory'] and before_b['entries']==a['entries']
        ordinary_input=pinned(phase/(base+'ordinary-input-state.json.gz'));both=ordinary_input['both'];b=ordinary_input['bothObservation']
        assert ordinary_input['reference']==owner and ordinary_input['tabObservation']==before_b;input_exact(owner,both,25,'M25🙂')
        assert ordinary_input['bothHistory']=={'u':2,'r':0,'snapshotResources':1} and len(b['entries']['undo'])==2 and not b['entries']['redo']
        ordinary=json.loads(b['entries']['undo'][1]['fields']);assert ordinary['type']=='insertText' and ordinary['text']=='M25🙂' and ordinary['position']==before_b['cursor']
        assert b['entries']['undo'][1]['resources']==0 and 'beforeId' not in ordinary and 'afterId' not in ordinary
        reverse=pinned(phase/(base+'shift-tab-state.json.gz'));assert reverse['reference']==reverse['after']==both
        assert reverse['bothHistory']==reverse['reverseHistory']==ordinary_input['bothHistory'] and reverse['reverseObservation']['entries']==b['entries']
        assert reverse['identity']=={'undo':['owner','ordinary'],'redo':[]} and reverse['reverseObservation']['cursor']['cellIndex']==24 and reverse['reverseObservation']['cursor']['cellParaIndex']==63 and reverse['reverseObservation']['cursor']['charOffset']==66
        stages=[('undo-ordinary',owner,before_b['cursor'],{'u':1,'r':1,'snapshotResources':1},{'undo':['owner'],'redo':['ordinary']}),('undo-owner',source,start['cursor'],{'u':0,'r':2,'snapshotResources':2},{'undo':[],'redo':['ordinary','owner']}),('redo-owner',owner,a['cursor'],{'u':1,'r':1,'snapshotResources':1},{'undo':['owner'],'redo':['ordinary']}),('redo-ordinary',both,b['cursor'],{'u':2,'r':0,'snapshotResources':1},{'undo':['owner','ordinary'],'redo':[]})]
        for name,reference,cursor,expected,identity in stages:
            d=pinned(phase/(base+name+'-state.json.gz'));assert d['reference']==reference and comparable(d['after'])==comparable(reference)
            assert d['history']==d['expectedHistory']==expected and d['expectedCursor']==d['observation']['cursor']==cursor and d['identity']==identity and d['observation']['dirty'] is True
            records=[(tag,v) for side in ['undo','redo'] for tag,v in zip(identity[side],d['observation']['entries'][side])];assert len(records)==2
            for tag,rec in records:
                f=json.loads(rec['fields'])
                if tag=='owner':
                    assert f['type']==snapshot['type'] and f['beforeId']==snapshot['beforeId'] and f['timestamp']==snapshot['timestamp'] and rec['resources']==(2 if name=='undo-owner' else 1)
                    assert (f['afterId'] is not None)==(name=='undo-owner')
                else:
                    assert rec['resources']==0 and 'beforeId' not in f and 'afterId' not in f
                    assert all(f[k]==ordinary[k] for k in ['type','text','position','timestamp'])
        saved=pinned(phase/(base+'saved-state.json.gz'));name=seed['label']+'-'+ext+'-owner-multi-history.'+ext;file=phase/'files'/name;pins[file]=sha(file)
        assert comparable(saved['reference'])==comparable(saved['after'])==comparable(both) and saved['savedHistory']==ordinary_input['bothHistory'] and saved['identity']=={'undo':['owner','ordinary'],'redo':[]}
        assert saved['beforeSave']['dirty'] is True and saved['savedObservation']['dirty'] is False and saved['savedObservation']['entries']==saved['beforeSave']['entries'] and saved['savedObservation']['cursor']==saved['beforeSave']['cursor'] and saved['savedObservation']['generation']==saved['beforeSave']['generation']
        assert sha(file)==saved['savedFile']['sha256']==saved['expectedExportSHA256']==saved['reference'][ext]['sha256'] and file.stat().st_size==saved['savedFile']['bytes']==saved['reference'][ext]['bytes']
        ipc=[v for v in audit if v['kind']=='save-ipc-enter' and v['format']==ext];assert len(ipc)==1 and ipc[0]['sha256']==pins[file] and ipc[0]['mainFrame']
        assert sha(phase/'files'/('ipc-payload-'+str(ipc[0]['id'])+'.'+ext))==pins[file]
        reopened=pinned(phase/(base+'reopened-state.json.gz'));assert comparable(reopened['reference'])==comparable(reopened['after'])==comparable(both) and reopened['productOnlyOpen']
        assert reopened['reopenHistory']=={'u':0,'r':0,'snapshotResources':0} and reopened['identity']=={'undo':[],'redo':[]} and reopened['reopenObservation']['dirty'] is False and reopened['reopenObservation']['generation']!=reopened['previousGeneration']==saved['savedObservation']['generation']
        released=json.loads(reopened['releasedOwner']['fields']);assert released['beforeId'] is released['afterId'] is None and reopened['releasedOwner']['resources']==reopened['releasedOrdinary']['resources']==0
        assert not [v for v in audit if v['kind']=='close-confirmation' and v['plan']=='reopen-'+name]
        m=next(v for v in manifest if Path(v['file']).name==name);assert [{'sha256':hashlib.sha256(v.encode()).hexdigest(),'bytes':len(v.encode())} for v in m['svg']]==both['svg']
        for k in ['cells','body','bodyFormats','props','pageDef','styles','text']:assert m[k]==both[k]
        headers=lambda v:[[r for r in page if r['cell'] in [0,1,2]] for page in v['cellRendered']]
        assert source['props']['repeatHeader'] and headers(source)==headers(owner)==headers(both)
        assert all(headers(both)) and all(''.join(v['rendered']).count('AFTER_TABLE_END')==1 for v in [source,owner,both])
        assert max(v['pageCount'] for v in [source,owner,both,reopened['after']])<=10
        cases.append({'format':ext,'sourceSHA256':row['sourceSHA256'],'savedSHA256':pins[file],'pages':both['pageCount'],'entryTypes':row['entryTypes'],'entryObjectsDistinct':True,'undoOrder':['ordinary','owner'],'redoOrder':['owner','ordinary'],'historyRestoreCommands':4,'undoRedoPairs':2,'navigationTransitions':2,'resourceSequence':row['resourceSequence'],'maxResources':2,'sameFormatReopens':1,'originalSavedCopyPreserved':True,'allModelSVGCursorResourceChecksExact':True,'reopenedCleanAndHistoryCleared':True,'repeatHeaderAndFollowingBodyPreserved':True})
    checker=(repo/'scripts/check-electron-excluded-linewrap-history.mjs').read_text();function=checker.split('async function ownerMultiHistory(',1)[1].split('// Reverse navigation',1)[0]
    assert 'await load(' not in function and 'window.rhwpStudio.notifySaved' not in function
    build=run.parent/'excluded-owner-tab/build-runtime';runtime=pinned(build/'runtime-pin-verified.json');assert pinned(phase/'runtime-pin.json')==runtime
    for name,digest in runtime['runtimeFilesSHA256'].items():assert sha(build/'runtime'/name)==sha(phase/'runtime'/name)==digest
    build_proof=pinned(build/'ui-source-proof.json');assert build_proof['buildExitCode']==0 and build_proof['sourceUnchangedDuringBuild']
    for name,digest in build_proof['productSourceBeforeSHA256'].items():assert sha(repo/name)==digest==build_proof['productSourceAfterSHA256'][name]
    finalization=pinned(build/'build-wrapper-finalization.json');assert finalization['buildExitCode']==0 and finalization['coordinatorExitCode']==1
    reuse=pinned(phase/'reuse-proof.json');assert reuse['reusedRuntimeFiles']==52 and not reuse['newBuild'] and not reuse['newPackage']
    prior=pinned(run/'prior-pins.json')
    for p,digest in prior.items():assert sha(p)==digest,'prior evidence or original dirty changed: '+p
    assert all(sha(p)==digest for p,digest in pins.items())
    result={'schema':1,'finishedUTC':datetime.now(timezone.utc).isoformat(),'baseApprovedPR35HEAD':'a6d5f3df699b4226c574faeede7092209813d560','productSourceChanged':False,'collectorSourceSHA256':sha(Path(__file__)),'actualMacElectron':True,'scenarioCases':2,'entryTypes':['snapshot:insertText','insertText'],'distinctCommandObjectsPerCase':2,'historyRestoreCommands':8,'undoRedoPairs':4,'navigationTransitions':4,'sameFormatSavedReopens':2,'maxSnapshotResources':2,'rawStateFiles':22,'maxPagesLimit':10,'maxStateFilesLimit':40,'appAndHarnessExitCode':0,'normalQuit':True,'sourceIsExactPR35SavedFile':True,'priorSavedFilesPreserved':True,'QAResetNotifySavedUsedBetweenSaveAndReopen':False,'newBuild':False,'newPackage':False,'nativeExecutions':0,'runtimeTreeSHA256':runtime['sourceRuntimeSHA256'],'engineSHA256':proof['engineSHA256'],'runtimeFilesVerified':52,'retainedOriginalUIBuildChildExitCode':0,'retainedOriginalBuildCoordinatorPostCompleteExitCode':1,'priorPinnedFilesUnchanged':len(prior),'crossFormatLayoutJudged':False,'guardedLayoutScopePromoted':False,'snapshotNumericReuseAfterNewSnapshotJudged':False,'initialEditorSelectionAndHistoryKeysUseQAFocus':True,'physicalIMEVerified':False,'manualGUIVerified':False,'OSChooserVerified':False,'cases':cases,'inputEvidenceSHA256':{(str(p.relative_to(run.parent)) if p.is_relative_to(run.parent) else str(p.relative_to(repo))):digest for p,digest in pins.items()}}
    payload=json.dumps(result,indent=2)+'\n';budget.check(len(payload.encode()))
    with (out/'proof.json').open('x') as f:f.write(payload)
    budget.mark('complete');print(json.dumps({k:v for k,v in result.items() if k not in ['cases','inputEvidenceSHA256']}))
except BaseException as e:
    with (out/'failure.json').open('x') as f:f.write(json.dumps({'failure':str(e)[:2048],'completedCases':len(cases)})+'\n')
    budget.mark('failed');raise
finally:budget.close()

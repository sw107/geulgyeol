"""Verify replacing one retained redo entry, disposal, and the new branch.
Usage: RUN_ROOT FRESH_COMPARISON_PHASE
History restoration is judged by full SVG/model, not export container bytes.
"""
import sys
sys.dont_write_bytecode = True
from pathlib import Path
import gzip, hashlib, json, subprocess
from datetime import datetime, timezone
from native_qa_budget import BudgetClient


def sha(p):
    with Path(p).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def read(p):
    with (gzip.open(p, 'rt') if p.suffix == '.gz' else p.open()) as stream:
        return json.load(stream)


def comparable(v):
    return {k: x for k, x in v.items() if k not in ['hwp', 'hwpx']}


def single(observation, stack):
    other = 'redo' if stack == 'undo' else 'undo'
    assert len(observation['entries'][stack]) == 1 and not observation['entries'][other]
    command = observation['entries'][stack][0]
    fields = json.loads(command['fields'])
    assert fields['type'] == 'snapshot:insertText'
    return command, fields


run, out = [Path(p).resolve() for p in sys.argv[1:3]]
assert len(sys.argv) == 3 and not out.exists()
repo = Path(__file__).resolve().parent.parent
subprocess.run(['node', '--input-type=module', '-e',
    "import {EvidenceBudget} from './scripts/qa-evidence-budget.mjs';new EvidenceBudget({root:process.argv[1]}).check({normalForecastBytes:1048576,failureForecastBytes:16384});",
    str(run.parent)], cwd=repo, check=True)
out.mkdir()
budget = BudgetClient(out, normal_forecast=1048576, failure_forecast=16384)
pins, cases = {}, []


def pinned(p):
    p = Path(p)
    pins[p] = sha(p)
    return read(p)


try:
    seed_rows = pinned(run/'seeds.json')
    assert len(seed_rows) == 1
    seed = seed_rows[0]
    assert seed['operations'] == ['owner-redo-branch'] and seed['historyCell'] == 24
    assert seed['repairExpected'] and seed['fallbackExactHistory'] and not seed['verifyUnchangedSaveReopen']
    phase = run/'electron'
    process = pinned(phase/'harness-process.json')
    assert process['nodeHarnessExitCode'] == process['appExitCode'] == 0 and process['appNormalQuit']
    assert process['qaSourcesUnchanged'] and process['sourceSeedsUnchanged']
    assert process['sourceSeedsSHA256'] == pins[run/'seeds.json']
    for name, digest in process['qaSourceBeforeSHA256'].items():
        source = phase/name if name == 'bootstrap.cjs' else repo/'scripts'/name
        assert sha(source) == digest == process['qaSourceAfterSHA256'][name]
    assert pinned(phase/'qa-evidence-status.json')['outcome'] == 'complete'
    proof = pinned(phase/'proof.json')
    assert proof['actualMacElectron'] and proof['pairs'] == 2 and proof['reopens'] == 0
    assert len(proof['rows']) == 2 and not proof['errors'] and not proof['fallbackComparisons']
    assert proof['engineSHA256'] == proof['receivedEngineSHA256']
    assert [r['ext'] for r in proof['rows']] == ['hwpx', 'hwp']
    for scope in proof['repairScopes']:
        assert scope['guardedEligible'] == 0 and scope['historyEligible'] == [24]
    for row in proof['rows']:
        budget.check()
        ext = row['ext']
        assert row['operation'] == 'owner-redo-branch' and row['resourceSequence'] == [2, 1, 2, 1]
        assert row['discardedWasmIDRejections'] == row['emptyRedoChecks'] == 2 and row['newBranchUndoRedoExact']
        stem = seed['label']+'-input.'+ext
        assert sha(seed['files'][ext]) == sha(phase/'files'/stem)
        base = stem+'-owner-redo-branch-'
        old = pinned(phase/(base+'old-state.json.gz'))
        source, old_edited = old['source'], old['oldEdited']
        assert old['initialObservation']['dirty'] == False
        assert old_edited['cells'][24]['paras'][0]['text'] == 'OLD_REDO🙂'+source['cells'][24]['paras'][0]['text']
        assert comparable(old['undone']) == comparable(source)
        assert old['oldHistory'] == {'u': 0, 'r': 1, 'snapshotResources': 2}
        old_command, old_fields = single(old['oldObservation'], 'redo')
        old_ids = [old_fields['beforeId'], old_fields['afterId']]
        assert old_ids == row['discardedOldIDs'] and all(isinstance(i, int) for i in old_ids)
        assert old_command['resources'] == 2
        branch = pinned(phase/(base+'branch-state.json.gz'))
        value = branch['branch']
        assert branch['source'] == source and branch['oldIDs'] == old_ids
        assert branch['branchHistory'] == {'u': 1, 'r': 0, 'snapshotResources': 1}
        assert branch['branchObservation']['dirty'] == True
        assert value['cells'][24]['paras'][0]['text'] == 'NEW_BRANCH🙂'+source['cells'][24]['paras'][0]['text']
        assert value['cells'][24]['paras'][1:] == source['cells'][24]['paras'][1:]
        assert [c for i, c in enumerate(value['cells']) if i != 24] == [c for i, c in enumerate(source['cells']) if i != 24]
        for key in ['body', 'bodyFormats', 'props', 'pageDef', 'styles', 'dims']:
            assert value[key] == source[key]
        assert comparable(value) != comparable(old_edited)
        new_command, new_fields = single(branch['branchObservation'], 'undo')
        assert new_command['resources'] == 1 and new_fields['afterId'] is None
        assert new_fields['beforeId'] not in old_ids and new_fields['beforeId'] is not None
        discarded = branch['discarded']
        discarded_fields = json.loads(discarded['fields'])
        assert discarded['resources'] == 0 and discarded_fields['beforeId'] is discarded_fields['afterId'] is None
        stable = lambda f: {k: v for k, v in f.items() if k not in ['beforeId', 'afterId']}
        assert stable(discarded_fields) == stable(old_fields)
        probe = pinned(phase/(base+'discard-probe-state.json.gz'))
        assert probe['reference'] == probe['after'] == value
        assert probe['observation'] == branch['branchObservation'] and probe['history'] == branch['branchHistory']
        assert [p['id'] for p in probe['probes']] == old_ids
        for p in probe['probes']:
            assert p['rejected'] and '스냅샷 '+str(p['id'])+' 없음' in p['error']
        blocked = pinned(phase/(base+'blocked-old-redo-state.json.gz'))
        assert blocked['reference'] == blocked['after'] == value
        assert blocked['referenceObservation'] == blocked['observation'] == branch['branchObservation']
        assert blocked['history'] == branch['branchHistory']
        undone = pinned(phase/(base+'undo-state.json.gz'))
        assert undone['reference'] == source and comparable(undone['after']) == comparable(source)
        assert undone['history'] == {'u': 0, 'r': 1, 'snapshotResources': 2}
        undo_command, undo_fields = single(undone['observation'], 'redo')
        assert undo_command['resources'] == 2 and undo_fields['beforeId'] == new_fields['beforeId'] and undo_fields['afterId'] is not None
        assert undone['observation']['cursor'] == old['initialObservation']['cursor']
        redone = pinned(phase/(base+'redo-state.json.gz'))
        assert redone['reference'] == value and comparable(redone['after']) == comparable(value)
        assert comparable(redone['after']) != comparable(old_edited)
        assert redone['history'] == {'u': 1, 'r': 0, 'snapshotResources': 1}
        redo_command, redo_fields = single(redone['observation'], 'undo')
        assert redo_command['resources'] == 1 and redo_fields['beforeId'] == new_fields['beforeId'] and redo_fields['afterId'] is None
        assert stable(new_fields) == stable(undo_fields) == stable(redo_fields)
        assert redone['observation']['cursor'] == branch['branchObservation']['cursor']
        exhausted = pinned(phase/(base+'exhausted-redo-state.json.gz'))
        assert exhausted['reference'] == exhausted['after'] == redone['after']
        assert exhausted['referenceObservation'] == exhausted['observation'] == redone['observation']
        assert exhausted['history'] == redone['history']
        cases.append({'format': ext, 'sourceSHA256': sha(seed['files'][ext]), 'oldRedoEntriesBeforeNewInput': 1,
            'redoEntriesAfterNewInput': 0, 'discardedOldCommandResources': 0, 'oldIDsRejected': old_ids,
            'rejectedProbePreservesBranchState': True, 'emptyRedoChecks': 2, 'oldRedoNotReexecuted': True,
            'oldSetupUndoFullSVGModelExact': True, 'newBranchUndoFullSVGModelExact': True,
            'newBranchRedoFullSVGModelExact': True, 'resourceSequence': [2, 1, 2, 1], 'newBeforeSnapshotID': new_fields['beforeId']})
    assert pinned(phase/'manifest.json.gz') == []
    status = pinned(phase/'manifest-status.json')
    assert status['complete'] and status['records'] == status['plannedRecords'] == 0
    build = run.parent/'excluded-owner-tab/build-runtime'
    runtime = pinned(build/'runtime-pin-verified.json')
    assert pinned(phase/'runtime-pin.json') == runtime
    for name, digest in runtime['runtimeFilesSHA256'].items():
        assert sha(build/'runtime'/name) == sha(phase/'runtime'/name) == digest
    assert sha(repo/'desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron') == runtime['hostElectronBinarySHA256']
    build_proof = pinned(build/'ui-source-proof.json')
    assert build_proof['buildExitCode'] == 0 and build_proof['sourceUnchangedDuringBuild']
    for name, digest in build_proof['productSourceBeforeSHA256'].items():
        assert sha(repo/name) == digest == build_proof['productSourceAfterSHA256'][name]
    finalization = pinned(build/'build-wrapper-finalization.json')
    assert finalization['buildExitCode'] == 0 and finalization['coordinatorExitCode'] == 1
    reuse = pinned(phase/'reuse-proof.json')
    assert reuse['reusedRuntimeFiles'] == 52 and not reuse['newBuild'] and not reuse['newPackage']
    prior = pinned(run/'prior-pins.json')
    for p, digest in prior.items():
        assert sha(p) == digest, 'previous evidence or original dirty file changed: '+p
    assert all(sha(p) == digest for p, digest in pins.items())
    result = {'schema': 1, 'finishedUTC': datetime.now(timezone.utc).isoformat(),
        'baseApprovedPR29HEAD': 'e033a6935bcddef277e1182ea7b861b9803c184a', 'productSourceChanged': False,
        'actualMacElectron': True, 'scenarioCases': 2, 'oldSnapshotIDRejections': 4, 'discardedOldCommandResources': 0,
        'emptyRedoChecks': 4, 'oldRedoNotReexecuted': True, 'oldSetupUndoChecks': 2,
        'newBranchUndoChecks': 2, 'newBranchRedoChecks': 2, 'newBranchUndoRedoPairs': 2,
        'historyRestoreComparison': 'full SVG/model, excluding HWP/HWPX export container bytes',
        'appAndHarnessExitCode': 0, 'normalQuit': True, 'savedReopens': 0, 'nativeExecutions': 0,
        'newBuild': False, 'newPackage': False, 'runtimeTreeSHA256': runtime['sourceRuntimeSHA256'],
        'runtimeFilesVerified': 52, 'engineSHA256': proof['engineSHA256'],
        'retainedOriginalUIBuildChildExitCode': 0, 'retainedOriginalBuildCoordinatorPostCompleteExitCode': 1,
        'priorPinnedFilesUnchanged': len(prior), 'crossFormatLayoutJudged': False, 'guardedLayoutScopePromoted': False,
        'physicalIMEVerified': False, 'manualGUIVerified': False, 'cases': cases,
        'inputEvidenceSHA256': {str(p.relative_to(run.parent)): digest for p, digest in pins.items()}}
    payload = json.dumps(result, indent=2)+'\n'
    budget.check(len(payload.encode()))
    with (out/'proof.json').open('x') as stream:
        stream.write(payload)
    budget.mark('complete')
    print(json.dumps({k: v for k, v in result.items() if k not in ['cases', 'inputEvidenceSHA256']}))
except BaseException as e:
    with (out/'failure.json').open('x') as stream:
        stream.write(json.dumps({'failure': str(e)[:2048], 'completedCases': len(cases)})+'\n')
    budget.mark('failed')
    raise
finally:
    budget.close()

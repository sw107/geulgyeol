"""Verify one retained redo entry through cell dialog cancel and real redo/undo.
Usage: RUN_ROOT FRESH_COMPARISON_PHASE
No saved-file, nested-table, or multi-entry execution is included.
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


def single_command(observation, stack):
    other = 'redo' if stack == 'undo' else 'undo'
    assert len(observation['entries'][stack]) == 1 and not observation['entries'][other]
    command = observation['entries'][stack][0]
    fields = json.loads(command['fields'])
    assert fields['type'] == 'snapshot:insertText' and fields['beforeId'] is not None
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
    seeds = pinned(run/'seeds.json')
    assert len(seeds) == 1
    seed = seeds[0]
    assert seed['operations'] == ['owner-redo-dialog-cancel'] and seed['historyCell'] == 24
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
        assert row['operation'] == 'owner-redo-dialog-cancel' and row['dialogTransitions'] == ['open', 'cancel']
        assert row['retainedRedoIdentityChecks'] == 2
        assert row['resourceSequence'] == [1, 2, 1, 2]
        assert row['initialUndoExact'] and row['redoAfterCancelExact'] and row['undoAfterRedoExact']
        stem = seed['label']+'-input.'+ext
        assert sha(seed['files'][ext]) == sha(phase/'files'/stem)
        base = stem+'-owner-redo-dialog-cancel-'
        setup = pinned(phase/(base+'source-state.json.gz'))
        source, edited = setup['source'], setup['edited']
        assert setup['sourceObservation']['dirty'] == False and setup['editObservation']['dirty'] == True
        assert setup['editHistory'] == {'u': 1, 'r': 0, 'snapshotResources': 1}
        edit_command, edit_fields = single_command(setup['editObservation'], 'undo')
        assert edit_command['resources'] == 1 and edit_fields['afterId'] is None
        assert edited['cells'][24]['paras'][0]['text'] == 'REDO_CANCEL🙂'+source['cells'][24]['paras'][0]['text']
        assert edited['cells'][24]['paras'][1:] == source['cells'][24]['paras'][1:]
        assert [c for i, c in enumerate(edited['cells']) if i != 24] == [c for i, c in enumerate(source['cells']) if i != 24]
        for key in ['body', 'bodyFormats', 'props', 'pageDef', 'styles', 'dims']:
            assert edited[key] == source[key]
        initial = pinned(phase/(base+'initial-undo-state.json.gz'))
        assert initial['reference'] == source and comparable(initial['after']) == comparable(source)
        assert initial['history'] == {'u': 0, 'r': 1, 'snapshotResources': 2}
        redo_observation = initial['observation']
        command, fields = single_command(redo_observation, 'redo')
        assert command['resources'] == 2 and fields['afterId'] is not None
        assert fields['beforeId'] == edit_fields['beforeId']
        assert redo_observation['cursor'] == setup['sourceObservation']['cursor']
        assert redo_observation['dirty'] == row['cancelDirty'] == True
        assert redo_observation['cursor']['cellIndex'] == 24
        assert redo_observation['cursor']['cellParaIndex'] == redo_observation['cursor']['charOffset'] == 0
        opened = pinned(phase/(base+'dialog-open-state.json.gz'))
        cancelled = pinned(phase/(base+'dialog-cancel-state.json.gz'))
        for value in [opened, cancelled]:
            assert value['reference'] == value['after'] == initial['after']
            assert value['historyBefore'] == value['historyAfter'] == initial['history']
            assert value['referenceObservation'] == value['observation'] == redo_observation
            assert value['retainedRedoIdentity'] is True
        assert opened['dialog']['tabs'] == ['기본', '여백/캡션', '표', '셀']
        assert opened['dialog']['cancelButtons'] == 1 and opened['dialog']['inputs']
        assert cancelled['dialogHidden'] is True
        redo = pinned(phase/(base+'redo-state.json.gz'))
        assert redo['reference'] == edited and comparable(redo['after']) == comparable(edited)
        assert redo['history'] == {'u': 1, 'r': 0, 'snapshotResources': 1}
        redo_command, redo_fields = single_command(redo['observation'], 'undo')
        assert redo_command['resources'] == 1 and redo_fields['afterId'] is None
        assert redo['observation']['cursor'] == setup['editObservation']['cursor']
        final = pinned(phase/(base+'undo-state.json.gz'))
        assert final['reference'] == source and comparable(final['after']) == comparable(source)
        assert final['history'] == {'u': 0, 'r': 1, 'snapshotResources': 2}
        final_command, final_fields = single_command(final['observation'], 'redo')
        assert final_command['resources'] == 2 and final_fields['afterId'] is not None
        assert final['observation']['cursor'] == setup['sourceObservation']['cursor']
        stable = lambda f: {k: v for k, v in f.items() if k != 'afterId'}
        assert stable(edit_fields) == stable(fields) == stable(redo_fields) == stable(final_fields)
        cases.append({'format': ext, 'sourceSHA256': sha(seed['files'][ext]), 'retainedRedoEntries': 1,
            'dialogTransitions': 2, 'cellModeDialogOpenedAndCancelled': True,
            'dialogFullSVGModelAndBothExportDigestsExact': True, 'dialogCursorDirtyHistoryExact': True,
            'retainedRedoCommandIdentityChecks': 2, 'retainedRedoCommandFieldsAndBothSnapshotIDsExact': True,
            'cancelDirty': redo_observation['dirty'], 'initialUndoFullSVGModelExact': True,
            'postCancelRedoFullSVGModelExact': True, 'postRedoUndoFullSVGModelExact': True,
            'resourceSequence': [1, 2, 1, 2], 'snapshotIDs': {'before': fields['beforeId'], 'afterBeforeDialog': fields['afterId'],
                'afterAfterRedo': redo_fields['afterId'], 'afterAfterFinalUndo': final_fields['afterId']}})
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
        'baseApprovedPR30HEAD': '02981d3719b41ce4a2de84bbd94e2de63e32dd6b', 'productSourceChanged': False,
        'actualMacElectron': True, 'scenarioCases': 2, 'exactDialogTransitions': 4, 'retainedRedoCommandIdentityChecks': 4,
        'initialUndoChecks': 2, 'postCancelRedoChecks': 2, 'postRedoUndoChecks': 2, 'redoThenUndoCycles': 2,
        'appAndHarnessExitCode': 0, 'normalQuit': True, 'dialogHistoryEntriesAdded': 0,
        'dialogComparison': 'full SVG/model and both HWP/HWPX export digests',
        'historyRestoreComparison': 'full SVG/model, excluding HWP/HWPX export container bytes',
        'savedReopens': 0, 'nativeExecutions': 0, 'newBuild': False, 'newPackage': False,
        'runtimeTreeSHA256': runtime['sourceRuntimeSHA256'], 'runtimeFilesVerified': 52, 'engineSHA256': proof['engineSHA256'],
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

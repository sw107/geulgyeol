"""Verify one retained redo entry through navigation and real redo/undo.
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
    assert seed['operations'] == ['owner-redo-navigation'] and seed['historyCell'] == 24
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
        assert row['operation'] == 'owner-redo-navigation' and row['steps'] == ['tab', 'shift-tab']
        assert row['resourceSequence'] == [1, 2, 1, 2] and row['lastPara'] == 63 and row['lastOffset'] == 66
        assert row['initialUndoExact'] and row['redoAfterNavigationExact'] and row['undoAfterRedoExact']
        stem = seed['label']+'-input.'+ext
        assert sha(seed['files'][ext]) == sha(phase/'files'/stem)
        base = stem+'-owner-redo-navigation-'
        setup = pinned(phase/(base+'source-state.json.gz'))
        source, edited = setup['source'], setup['edited']
        assert setup['sourceObservation']['dirty'] == False and setup['editObservation']['dirty'] == True
        assert setup['editHistory'] == {'u': 1, 'r': 0, 'snapshotResources': 1}
        edit_command, edit_fields = single_command(setup['editObservation'], 'undo')
        assert edit_command['resources'] == 1 and edit_fields['afterId'] is None
        assert edited['cells'][24]['paras'][0]['text'] == 'REDO_NAV🙂'+source['cells'][24]['paras'][0]['text']
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
        assert redo_observation['dirty'] == row['navigationDirty'] == True
        last_text = source['cells'][24]['paras'][63]['text']
        assert len(source['cells'][24]['paras']) == 64 and len(last_text) == 66
        assert len(last_text.encode('utf-16-le'))//2 == 68
        previous = redo_observation['cursor']
        for step, from_cell, cell, para, offset in [('tab', 24, 25, 0, 0), ('shift-tab', 25, 24, 63, 66)]:
            value = pinned(phase/(base+step+'-state.json.gz'))
            assert value['reference'] == initial['after'] and value['after'] == initial['after']
            assert value['historyBefore'] == value['historyAfter'] == initial['history']
            assert value['referenceObservation'] == redo_observation
            assert value['navigationStart']['cursor'] == previous
            assert value['navigationStart']['cursor']['cellIndex'] == from_cell
            for observation in [value['navigationStart'], value['end']]:
                assert observation['entries'] == redo_observation['entries'] and observation['dirty'] == redo_observation['dirty']
            cursor = value['end']['cursor']
            assert cursor['cellIndex'] == cell and cursor['paragraphIndex'] == cursor['cellParaIndex'] == para and cursor['charOffset'] == offset
            assert cursor['parentParaIndex'] == redo_observation['cursor']['parentParaIndex'] and cursor['controlIndex'] == redo_observation['cursor']['controlIndex']
            assert cursor['cellPath'] == [{'controlIndex': cursor['controlIndex'], 'cellIndex': cell, 'cellParaIndex': para}]
            previous = cursor
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
            'navigationTransitions': 2, 'navigationFullSVGModelAndBothExportDigestsExact': True,
            'retainedRedoCommandFieldsAndBothSnapshotIDsExact': True, 'navigationDirty': redo_observation['dirty'],
            'initialUndoFullSVGModelExact': True, 'postNavigationRedoFullSVGModelExact': True,
            'postRedoUndoFullSVGModelExact': True, 'sourceEnd': {'cell': 24, 'paragraph': 63, 'scalarOffset': 66, 'utf16Length': 68},
            'resourceSequence': [1, 2, 1, 2], 'snapshotIDs': {'before': fields['beforeId'], 'afterBeforeNavigation': fields['afterId'],
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
        'baseApprovedPR28HEAD': '786ebce238d31011aa458d5f2dce1462f9d6aa93', 'productSourceChanged': False,
        'actualMacElectron': True, 'scenarioCases': 2, 'exactNavigationTransitions': 4,
        'initialUndoChecks': 2, 'postNavigationRedoChecks': 2, 'postRedoUndoChecks': 2, 'redoThenUndoCycles': 2,
        'appAndHarnessExitCode': 0, 'normalQuit': True, 'navigationHistoryEntriesAdded': 0,
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

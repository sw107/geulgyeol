"""Verify clean owner Shift+Tab and edited-history navigation without saves.
Usage: RUN_ROOT FRESH_COMPARISON_PHASE
Requires retained Electron evidence, original pins, and the PR27 runtime pin.
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


run, out = [Path(p).resolve() for p in sys.argv[1:3]]
assert len(sys.argv) == 3 and not out.exists()
repo = Path(__file__).resolve().parent.parent
subprocess.run(['node', '--input-type=module', '-e',
    "import {EvidenceBudget} from './scripts/qa-evidence-budget.mjs';new EvidenceBudget({root:process.argv[1]}).check({normalForecastBytes:1048576,failureForecastBytes:16384});",
    str(run.parent)], cwd=repo, check=True)
out.mkdir()
budget = BudgetClient(out, normal_forecast=1048576, failure_forecast=16384)
pins, checks = {}, []


def pinned(p):
    p = Path(p)
    pins[p] = sha(p)
    return read(p)


try:
    seeds = pinned(run/'seeds.json')
    assert len(seeds) == 1
    seed = seeds[0]
    assert seed['operations'] == ['owner-shift-tab', 'owner-edited-navigation']
    assert seed['historyCell'] == 24 and seed['repairExpected'] and seed['fallbackExactHistory']
    assert not seed['verifyUnchangedSaveReopen']
    phase = run/'electron-final'
    process = pinned(phase/'harness-process.json')
    assert process['nodeHarnessExitCode'] == process['appExitCode'] == 0 and process['appNormalQuit']
    assert process['qaSourcesUnchanged'] and process['sourceSeedsUnchanged']
    assert process['sourceSeedsSHA256'] == pins[run/'seeds.json']
    for name, digest in process['qaSourceBeforeSHA256'].items():
        source = phase/name if name == 'bootstrap.cjs' else repo/'scripts'/name
        assert sha(source) == digest == process['qaSourceAfterSHA256'][name]
    assert pinned(phase/'qa-evidence-status.json')['outcome'] == 'complete'
    proof = pinned(phase/'proof.json')
    assert proof['actualMacElectron'] and proof['pairs'] == proof['reopens'] == 0
    assert len(proof['rows']) == 4 and not proof['errors'] and not proof['fallbackComparisons']
    assert proof['engineSHA256'] == proof['receivedEngineSHA256']
    for scope in proof['repairScopes']:
        assert scope['guardedEligible'] == 0 and scope['historyEligible'] == [24]
    assert [(r['ext'], r['operation']) for r in proof['rows']] == [(ext, op) for ext in ['hwpx', 'hwp'] for op in seed['operations']]
    for row in proof['rows']:
        budget.check()
        ext, op = row['ext'], row['operation']
        stem = seed['label']+'-input.'+ext
        assert sha(seed['files'][ext]) == sha(phase/'files'/stem)
        edited = op == 'owner-edited-navigation'
        expected_history = {'u': int(edited), 'r': 0, 'snapshotResources': int(edited)}
        assert row['lastPara'] == 63 and row['lastOffset'] == 66
        assert row['historyBeforeNavigation'] == expected_history and row['dirtyBeforeNavigation'] == edited
        steps = ['tab', 'shift-tab'] if edited else ['shift-tab']
        assert row['steps'] == steps
        edit = pinned(phase/(stem+'-'+op+'-edited-state.json.gz')) if edited else None
        if edit:
            source, reference = edit['source'], edit['reference']
            assert reference['cells'][24]['paras'][0]['text'] == 'NAV_EDIT🙂'+source['cells'][24]['paras'][0]['text']
            assert reference['cells'][24]['paras'][1:] == source['cells'][24]['paras'][1:]
            assert [c for i, c in enumerate(reference['cells']) if i != 24] == [c for i, c in enumerate(source['cells']) if i != 24]
            for key in ['body', 'bodyFormats', 'props', 'pageDef', 'styles', 'dims']:
                assert reference[key] == source[key]
            assert edit['history'] == expected_history and edit['observation']['dirty']
            entries = edit['observation']['entries']
            assert len(entries['undo']) == 1 and entries['redo'] == []
            fields = json.loads(entries['undo'][0]['fields'])
            assert fields['type'] == 'snapshot:insertText' and fields['beforeId'] is not None and fields['afterId'] is None
            assert fields['cursorAfter']['charOffset'] == 9 and entries['undo'][0]['resources'] == 1
        previous_end = None
        for step in steps:
            value = pinned(phase/(stem+'-'+op+'-'+step+'-state.json.gz'))
            assert value['reference'] == value['after'], 'strict full SVG/model and both exported-byte digests'
            assert value['reference']['cells'][24]['info'] == {'row': 8, 'col': 0, 'rowSpan': 32, 'colSpan': 2}
            assert len(value['reference']['cells'][24]['paras']) == 64
            assert len(value['reference']['cells'][24]['paras'][63]['text']) == 66
            assert value['historyBefore'] == value['historyAfter'] == expected_history
            assert value['start']['dirty'] == value['end']['dirty'] == edited
            assert value['start']['entries'] == value['end']['entries']
            assert value['navigationStart']['dirty'] == edited and value['navigationStart']['entries'] == value['start']['entries']
            assert value['navigationStart']['cursor']['cellIndex'] == (25 if step == 'shift-tab' else 24)
            if previous_end is not None:
                assert value['navigationStart']['cursor'] == previous_end, 'adjacent transition cursor continuity'
            if edit:
                assert value['reference'] == edit['reference'] and value['start']['entries'] == edit['observation']['entries']
            elif step == 'shift-tab':
                assert value['start']['cursor']['cellIndex'] == 25
            cursor = value['end']['cursor']
            cell, para, offset = (25, 0, 0) if step == 'tab' else (24, 63, 66)
            assert value['expected'] == {'cell': cell, 'para': para, 'charOffset': offset}
            assert cursor['cellIndex'] == cell and cursor['cellParaIndex'] == cursor['paragraphIndex'] == para and cursor['charOffset'] == offset
            assert cursor['cellPath'] == [{'controlIndex': cursor['controlIndex'], 'cellIndex': cell, 'cellParaIndex': para}]
            assert cursor['parentParaIndex'] == value['start']['cursor']['parentParaIndex']
            previous_end = cursor
            checks.append({'format': ext, 'operation': op, 'step': step, 'cell': cell, 'paragraph': para,
                'charOffset': offset, 'fullSVGModelAndBothExportDigestsExact': True,
                'dirty': edited, 'history': expected_history, 'retainedCommandFieldsAndSnapshotIDsExact': True})
    assert len(checks) == 6
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
    first_sources = pinned(run/'first-source-pins.json')
    for name, digest in first_sources.items():
        assert sha(run/name) == digest
    first_process = pinned(run/'electron/harness-process.json')
    assert first_process['nodeHarnessExitCode'] == first_process['appExitCode'] == 0 and first_process['appNormalQuit']
    assert first_process['qaSourceSHA256'] == first_sources['checkpoint-first-qa.mjs']
    first_result = pinned(run/'comparison/proof.json')
    assert first_result['scenarioCases'] == 4 and first_result['exactNavigationTransitions'] == 6
    prior = pinned(run/'prior-pins.json')
    for p, digest in prior.items():
        assert sha(p) == digest, 'previous evidence or original dirty file changed: '+p
    assert all(sha(p) == digest for p, digest in pins.items())
    result = {'schema': 1, 'finishedUTC': datetime.now(timezone.utc).isoformat(),
        'baseApprovedPR27HEAD': '88cd905130cb3b0e5eb84c428798f5788d7d45b8', 'productSourceChanged': False,
        'actualMacElectron': True, 'scenarioCases': 4, 'exactNavigationTransitions': 6,
        'cleanShiftTabCases': 2, 'editedHistoryRoundTrips': 2, 'newAppAndHarnessExitCode': 0, 'normalQuit': True,
        'sourceOwner': {'cell': 24, 'row': 8, 'col': 0, 'rowSpan': 32, 'colSpan': 2}, 'squeezeGeneralCell': 3,
        'ownerEnd': {'cell': 24, 'paragraph': 63, 'charOffset': 66}, 'navigationHistoryEntriesAdded': 0,
        'undoRedoPairsExecuted': 0, 'savedReopens': 0, 'nativeExecutions': 0, 'newBuild': False, 'newPackage': False,
        'firstRunRetainedSeparately': True, 'firstRunAddedToFinalCounts': False,
        'runtimeTreeSHA256': runtime['sourceRuntimeSHA256'], 'runtimeFilesVerified': 52, 'engineSHA256': proof['engineSHA256'],
        'retainedOriginalUIBuildChildExitCode': 0, 'retainedOriginalBuildCoordinatorPostCompleteExitCode': 1,
        'priorPinnedFilesUnchanged': len(prior), 'crossFormatLayoutJudged': False, 'guardedLayoutScopePromoted': False,
        'physicalIMEVerified': False, 'manualGUIVerified': False, 'checks': checks,
        'inputEvidenceSHA256': {str(p.relative_to(run.parent)): digest for p, digest in pins.items()}}
    payload = json.dumps(result, indent=2)+'\n'
    budget.check(len(payload.encode()))
    with (out/'proof.json').open('x') as stream:
        stream.write(payload)
    budget.mark('complete')
    print(json.dumps({k: v for k, v in result.items() if k not in ['checks', 'inputEvidenceSHA256']}))
except BaseException as e:
    with (out/'failure.json').open('x') as stream:
        stream.write(json.dumps({'failure': str(e)[:2048], 'completedChecks': len(checks)})+'\n')
    budget.mark('failed')
    raise
finally:
    budget.close()

"""Verify modal focus restoration, unforced keyboard delivery, and one redo entry.
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
    assert seed['operations'] == ['owner-dialog-escape-focus', 'owner-dialog-cancel-focus'] and seed['historyCell'] == 24
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
    assert proof['actualMacElectron'] and proof['pairs'] == 4 and proof['reopens'] == 0
    assert len(proof['rows']) == 4 and not proof['errors'] and not proof['fallbackComparisons']
    assert proof['engineSHA256'] == proof['receivedEngineSHA256']
    assert [r['ext'] for r in proof['rows']] == ['hwpx', 'hwpx', 'hwp', 'hwp']
    for scope in proof['repairScopes']:
        assert scope['guardedEligible'] == 0 and scope['historyEligible'] == [24]
    for row in proof['rows']:
        budget.check()
        ext = row['ext']
        route = row['route']
        assert route in ['escape', 'cancel']
        assert row['operation'] == 'owner-dialog-'+route+'-focus'
        assert row['dialogCycles'] == 2 and row['dialogTransitions'] == row['retainedRedoIdentityChecks'] == 4
        assert row['unforcedHistoryKeys'] == 2 and row['ordinaryKeyInputs'] == 1 and row['qaFocusCallsAfterDialog'] == 0
        assert row['resourceSequence'] == [1, 2, 1, 2, 1]
        assert row['initialUndoExact'] and row['redoAfterCloseExact'] and row['undoAfterRedoExact']
        stem = seed['label']+'-input.'+ext
        assert sha(seed['files'][ext]) == sha(phase/'files'/stem)
        base = stem+'-'+row['operation']+'-'
        setup = pinned(phase/(base+'source-state.json.gz'))
        source, edited = setup['source'], setup['edited']
        assert setup['sourceObservation']['dirty'] == False and setup['editObservation']['dirty'] == True
        assert setup['editHistory'] == {'u': 1, 'r': 0, 'snapshotResources': 1}
        edit_command, edit_fields = single_command(setup['editObservation'], 'undo')
        assert edit_command['resources'] == 1 and edit_fields['afterId'] is None
        assert edited['cells'][24]['paras'][0]['text'] == 'REDO_FOCUS🙂'+source['cells'][24]['paras'][0]['text']
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
        assert redo_observation['dirty'] is True
        assert redo_observation['cursor']['cellIndex'] == 24
        assert redo_observation['cursor']['cellParaIndex'] == redo_observation['cursor']['charOffset'] == 0
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
        def focus_exact(v):
            focus = v['focus']
            assert focus['renderer'] == {'activeEditor': True, 'tag': 'TEXTAREA', 'label': '문서 편집 입력',
                'insideDialog': False, 'editorActive': True}
            assert focus['host'] == {'tag': 'IFRAME', 'editorFrame': True}
        for name, reference, reference_observation, reference_history in [
                ('history', initial['after'], redo_observation, initial['history']),
                ('text', final['after'], final['observation'], final['history'])]:
            opened = pinned(phase/(base+name+'-open-state.json.gz'))
            closed = pinned(phase/(base+name+'-close-state.json.gz'))
            for value in [opened, closed]:
                assert value['reference'] == value['after'] == reference
                assert value['historyBefore'] == value['historyAfter'] == reference_history
                assert value['referenceObservation'] == value['observation'] == reference_observation
                assert value['retainedRedoIdentity'] is True
            assert opened['dialog'] == {'tabs': ['기본', '여백/캡션', '표', '셀'], 'primaryFocused': True}
            assert opened['focus']['renderer']['insideDialog'] and not opened['focus']['renderer']['activeEditor']
            assert closed['dialogHidden'] is True and closed['route'] == route
            focus_exact(closed)
            if route == 'escape':
                assert any(e['type'] == 'keydown' and e['key'] == 'Escape' and e['trusted']
                    and e['target']['insideDialog'] and not e['target']['editor'] for e in closed['events'])
            assert any(e['type'] == 'focusin' and e['target']['editor'] and e['trusted'] for e in closed['events'])
        for value, shift in [(redo, True), (final, False)]:
            focus_exact(value)
            assert any(e['type'] == 'keydown' and (e['key'] or '').lower() == 'z' and e['meta']
                and e['shift'] == shift and e['trusted'] and e['target']['editor'] for e in value['events'])
        typed = pinned(phase/(base+'text-input-state.json.gz'))
        assert typed['reference'] == source
        value = typed['after']
        assert value['cells'][24]['paras'][0]['text'] == 'x'+source['cells'][24]['paras'][0]['text']
        assert value['cells'][24]['paras'][1:] == source['cells'][24]['paras'][1:]
        assert [c for i, c in enumerate(value['cells']) if i != 24] == [c for i, c in enumerate(source['cells']) if i != 24]
        for key in ['body', 'bodyFormats', 'props', 'pageDef', 'styles', 'dims']:
            assert value[key] == source[key]
        for value in [edited, typed['after']]:
            for key in ['info', 'props']:
                assert value['cells'][24][key] == source['cells'][24][key]
            assert value['cells'][24]['paras'][0]['props'] == source['cells'][24]['paras'][0]['props']
        assert typed['history'] == {'u': 1, 'r': 0, 'snapshotResources': 1}
        assert typed['observation']['dirty'] is True and typed['observation']['cursor']['charOffset'] == 1
        assert typed['observation']['cursor']['cellIndex'] == 24 and typed['observation']['cursor']['cellParaIndex'] == 0
        typed_command, typed_fields = single_command(typed['observation'], 'undo')
        assert typed_command['resources'] == 1 and typed_fields['afterId'] is None
        assert typed_fields['beforeId'] not in [fields['beforeId'], final_fields['afterId']]
        assert any(e['type'] == 'keydown' and e['key'] == 'x' and e['trusted'] and e['target']['editor'] for e in typed['events'])
        assert any(e['type'] == 'input' and e['data'] == 'x' and e['inputType'] == 'insertText'
            and e['trusted'] and e['target']['editor'] for e in typed['events'])
        focus_exact(typed)
        assert setup['sourceFocus']['renderer']['activeEditor'] and setup['sourceFocus']['host']['editorFrame']
        cases.append({'format': ext, 'route': route, 'sourceSHA256': sha(seed['files'][ext]), 'retainedRedoEntries': 1,
            'dialogCycles': 2, 'exactDialogTransitions': 4, 'productFocusRestoredBeforeQAKey': True,
            'dialogFullSVGModelAndBothExportDigestsExact': True, 'dialogCursorDirtyHistoryExact': True,
            'retainedRedoCommandIdentityChecks': 4, 'retainedRedoCommandFieldsAndBothSnapshotIDsExact': True,
            'initialUndoFullSVGModelExact': True, 'unforcedPostCloseRedoFullSVGModelExact': True,
            'unforcedPostRedoUndoFullSVGModelExact': True, 'unforcedHistoryKeyCommands': 2,
            'immediatePostCloseOrdinaryKeyInputs': 1, 'trustedEditorKeydownAndInputObserved': True,
            'resourceSequence': [1, 2, 1, 2, 1], 'snapshotIDs': {'before': fields['beforeId'],
                'afterBeforeFirstDialog': fields['afterId'], 'afterAfterRedo': redo_fields['afterId'],
                'afterBeforeSecondDialog': final_fields['afterId'], 'newBeforeAfterOrdinaryInput': typed_fields['beforeId']}})
    checker = (repo/'scripts/check-electron-excluded-linewrap-history.mjs').read_text()
    function = checker.split('async function ownerDialogFocus(', 1)[1].split('// New input replaces', 1)[0]
    assert '.focus(' not in function and 'await key(' not in function and 'selectCell(' not in function
    assert 'capture:true,passive:true' in function
    assert 'preventDefault(' not in function and 'stopPropagation(' not in function
    assert 'removeEventListener' in function and 'delete window.__dialogFocusQA' in function
    assert len(cases) == 4 and {(c['format'], c['route']) for c in cases} == {(e, r) for e in ['hwpx', 'hwp'] for r in ['escape', 'cancel']}
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
        'baseApprovedPR31HEAD': 'a058caa31f2f9d2c2346d4f7c7f4efe753aff9f9', 'productSourceChanged': False,
        'actualMacElectron': True, 'scenarioCases': 4, 'dialogClosures': 8, 'exactDialogTransitions': 16, 'retainedRedoCommandIdentityChecks': 16,
        'qaFocusCallsAfterDialog': 0, 'unforcedHistoryKeyCommands': 8, 'immediatePostCloseOrdinaryKeyInputs': 4,
        'initialUndoChecks': 4, 'postCloseRedoChecks': 4, 'postRedoUndoChecks': 4, 'redoThenUndoCycles': 4,
        'appAndHarnessExitCode': 0, 'normalQuit': True, 'dialogHistoryEntriesAdded': 0,
        'dialogComparison': 'full SVG/model and both HWP/HWPX export digests',
        'historyRestoreComparison': 'full SVG/model, excluding HWP/HWPX export container bytes',
        'savedReopens': 0, 'nativeExecutions': 0, 'newBuild': False, 'newPackage': False,
        'runtimeTreeSHA256': runtime['sourceRuntimeSHA256'], 'runtimeFilesVerified': 52, 'engineSHA256': proof['engineSHA256'],
        'retainedOriginalUIBuildChildExitCode': 0, 'retainedOriginalBuildCoordinatorPostCompleteExitCode': 1,
        'priorPinnedFilesUnchanged': len(prior), 'crossFormatLayoutJudged': False, 'guardedLayoutScopePromoted': False,
        'initialEditorSelectionUsesQAFocus': True, 'productFocusRestoredOnBothRoutes': True,
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

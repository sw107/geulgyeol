"""Verify pending numeric edits are discarded, with unforced focus/keys and one redo entry.
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
    assert seed['operations'] == ['owner-dialog-pending-escape', 'owner-dialog-pending-cancel'] and seed['historyCell'] == 24
    assert seed['repairExpected'] and seed['fallbackExactHistory'] and not seed['verifyUnchangedSaveReopen']
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
        assert row['operation'] == 'owner-dialog-pending-'+route
        assert row['dialogCycles'] == 2 and row['dialogTransitions'] == 4 and row['retainedRedoIdentityChecks'] == 6 and row['pendingNumericEdits'] == 2
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
        assert edited['cells'][24]['paras'][0]['text'] == 'REDO_PENDING🙂'+source['cells'][24]['paras'][0]['text']
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
            pending = pinned(phase/(base+name+'-pending-state.json.gz'))
            closed = pinned(phase/(base+name+'-close-state.json.gz'))
            for value in [opened, pending, closed]:
                assert value['reference'] == value['after'] == reference
                assert value['historyBefore'] == value['historyAfter'] == reference_history
                assert value['referenceObservation'] == value['observation'] == reference_observation
                assert value['retainedRedoIdentity'] is True
            assert opened['dialog'] == {'tabs': ['기본', '여백/캡션', '표', '셀'], 'primaryFocused': True}
            assert opened['focus']['renderer']['insideDialog'] and not opened['focus']['renderer']['activeEditor']
            field = pending['field']
            assert field['inputMethod'] == 'ArrowUp'
            assert any(e['type'] == 'keydown' and e['key'] == 'ArrowUp' and e['trusted']
                and e['target']['type'] == 'number' and e['target']['insideDialog'] for e in pending['events'])
            assert field['property'] == 'outerLeft' and field['section'] == '바깥 여백' and field['side'] == '왼쪽'
            before, after = field['before'], field['after']
            assert {k: v for k, v in before.items() if k != 'value'} == {'tag': 'INPUT', 'type': 'number',
                'min': '-115.6', 'max': '115.6', 'step': '0.1', 'disabled': False, 'readOnly': False}
            displayed = str(round(reference['props']['outerLeft']*25.4/7200, 1))
            assert float(before['value']) == float(displayed)
            assert field['originalHWPUNIT'] == reference['props']['outerLeft'] == source['props']['outerLeft']
            assert abs(float(after['value']) - (float(before['value'])+0.1)) < 1e-9 and after['value'] == field['pendingValue']
            assert after['numericFocused'] is after['valid'] is True
            assert float(before['min']) < float(after['value']) < float(before['max'])
            assert field['wouldConfirmHWPUNIT'] == round(float(after['value'])*7200/25.4)
            assert -32768 <= field['wouldConfirmHWPUNIT'] <= 32767 and field['wouldConfirmHWPUNIT'] != field['originalHWPUNIT']
            assert pending['focus']['renderer'] == {'activeEditor': False, 'tag': 'INPUT', 'label': None,
                'insideDialog': True, 'editorActive': True}
            assert pending['focus']['host'] == {'tag': 'IFRAME', 'editorFrame': True}
            assert any(e['type'] == 'input' and e['trusted'] and e['target']['type'] == 'number'
                and e['target']['insideDialog'] and not e['target']['editor'] for e in pending['events'])
            assert not any(e['target']['editor'] for e in pending['events'])
            assert closed['dialogHidden'] is True and closed['route'] == route
            focus_exact(closed)
            if route == 'escape':
                assert any(e['type'] == 'keydown' and e['key'] == 'Escape' and e['trusted']
                    and e['target']['insideDialog'] and not e['target']['editor'] and e['target']['type'] == 'number' for e in closed['events'])
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
            'retainedRedoCommandIdentityChecks': 6, 'retainedRedoCommandFieldsAndBothSnapshotIDsExact': True,
            'pendingNumericEditChecks': 2, 'pendingProperty': 'outerLeft', 'pendingChangeApplied': False,
            'originalNumericHWPUNIT': source['props']['outerLeft'], 'pendingWouldConfirmHWPUNIT': field['wouldConfirmHWPUNIT'],
            'numericFieldFocusedBeforeEscapeOrCancel': True, 'reopenedDisplayRetainsOriginal': True,
            'initialUndoFullSVGModelExact': True, 'unforcedPostCloseRedoFullSVGModelExact': True,
            'unforcedPostRedoUndoFullSVGModelExact': True, 'unforcedHistoryKeyCommands': 2,
            'immediatePostCloseOrdinaryKeyInputs': 1, 'trustedEditorKeydownAndInputObserved': True,
            'resourceSequence': [1, 2, 1, 2, 1], 'snapshotIDs': {'before': fields['beforeId'],
                'afterBeforeFirstDialog': fields['afterId'], 'afterAfterRedo': redo_fields['afterId'],
                'afterBeforeSecondDialog': final_fields['afterId'], 'newBeforeAfterOrdinaryInput': typed_fields['beforeId']}})
    checker = (repo/'scripts/check-electron-excluded-linewrap-history.mjs').read_text()
    function = checker.split('async function ownerDialogPending(', 1)[1].split('// New input replaces', 1)[0]
    assert '.focus(' not in function and 'await key(' not in function and 'selectCell(' not in function
    assert 'capture:true,passive:true' in function
    assert 'preventDefault(' not in function and 'stopPropagation(' not in function
    assert 'removeEventListener' in function and 'delete window.__dialogPendingQA' in function
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
    initial_attempt = pinned(run/'initial-attempt-pins.json')
    for p, digest in initial_attempt.items():
        assert sha(p) == digest, 'initial failed attempt changed: '+p
    failed_process = pinned(run/'electron/harness-process.json')
    assert failed_process['nodeHarnessExitCode'] == 1 and failed_process['appExitCode'] == 0 and failed_process['appNormalQuit']
    assert pinned(run/'electron/qa-evidence-status.json')['outcome'] == 'failed'
    failed_state = pinned(run/'electron/fallback-lineWrap-input.hwpx-owner-dialog-pending-escape-history-pending-state.json.gz')
    assert failed_state['reference'] == failed_state['after']
    assert failed_state['referenceObservation'] == failed_state['observation'] and failed_state['historyBefore'] == failed_state['historyAfter']
    assert failed_state['field']['after']['value'] == '151.0' and failed_state['field']['pendingValue'] == '1.5'
    assert not failed_state['field']['after']['valid'] and failed_state['retainedRedoIdentity']
    prior = pinned(run/'prior-pins.json')
    for p, digest in prior.items():
        assert sha(p) == digest, 'previous evidence or original dirty file changed: '+p
    assert all(sha(p) == digest for p, digest in pins.items())
    result = {'schema': 1, 'finishedUTC': datetime.now(timezone.utc).isoformat(),
        'baseApprovedPR32HEAD': 'c673197b36264e7e4c21c2e3caf8c1a753d12f44', 'productSourceChanged': False,
        'actualMacElectron': True, 'scenarioCases': 4, 'dialogClosures': 8, 'exactDialogTransitions': 16, 'retainedRedoCommandIdentityChecks': 24, 'pendingNumericEditChecks': 8, 'pendingChangesApplied': 0,
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
        'pendingNumericInputMethod': 'ArrowUp', 'initialNumericReplacementAttemptRetained': True,
        'initialAttemptDocumentHistoryUnchanged': True, 'initialAttemptNodeExitCode': 1, 'initialAttemptAppExitCode': 0,
        'initialAttemptPinnedFilesUnchanged': len(initial_attempt), 'numericMetaASelectionJudged': False,
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

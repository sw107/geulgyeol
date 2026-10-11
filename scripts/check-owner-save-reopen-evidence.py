"""Verify owner input -> navigation -> history -> same-format native save/reopen.
Usage: RUN_ROOT WASM_PKG FRESH_COMPARISON_PHASE
Two Electron scenarios; no fresh Native execution or cross-format layout judgement.
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


def command(observation, stack):
    other = 'redo' if stack == 'undo' else 'undo'
    assert len(observation['entries'][stack]) == 1 and not observation['entries'][other]
    record = observation['entries'][stack][0]
    fields = json.loads(record['fields'])
    assert fields['type'] == 'snapshot:insertText' and fields['beforeId'] is not None
    return record, fields


run, pkg, out = [Path(p).resolve() for p in sys.argv[1:4]]
assert len(sys.argv) == 4 and not out.exists()
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
    assert seed['operations'] == ['owner-save-reopen'] and seed['historyCell'] == 24
    assert seed['sameFormatSaveReopen'] and seed['repairExpected'] and seed['fallbackExactHistory']
    assert not seed['verifyUnchangedSaveReopen']
    whole = pinned(run/'whole-run-preflight.json')
    assert whole['wholeNewNormalForecastBytes'] == sum(whole['componentsBytes'].values()) == 100663296
    assert whole['failureForecastBytes'] == 16777216 and whole['globalSyntheticBytes'] == 15126528
    assert not whole['preflight']['incompletePhases']
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
    assert proof['actualMacElectron'] and proof['pairs'] == 4 and proof['reopens'] == 2
    assert len(proof['rows']) == 2 and not proof['errors'] and not proof['fallbackComparisons']
    assert proof['engineSHA256'] == proof['receivedEngineSHA256'] == sha(pkg/'rhwp_bg.wasm')
    assert [r['ext'] for r in proof['rows']] == ['hwpx', 'hwp']
    for scope in proof['repairScopes']:
        assert scope['guardedEligible'] == 0 and scope['historyEligible'] == [24]
    manifest = pinned(phase/'manifest.json.gz')
    assert len(manifest) == 2
    status = pinned(phase/'manifest-status.json')
    assert status['complete'] and status['records'] == status['plannedRecords'] == 2
    audit = [json.loads(line) for line in (phase/'audit.jsonl').read_text().splitlines()]
    pins[phase/'audit.jsonl'] = sha(phase/'audit.jsonl')
    for row in proof['rows']:
        budget.check()
        ext = row['ext']
        assert row['operation'] == 'owner-save-reopen' and row['navigationTransitions'] == 2
        assert row['historyKeyCommands'] == 4 and row['undoRedoPairs'] == 2 and row['sameFormatReopens'] == 1
        assert row['savedDirty'] is row['reopenedDirty'] is False
        assert row['savedHistoryRetained'] and row['postSaveUndoRedoDirty'] and row['reopenedHistoryCleared']
        assert row['productOnlyReopen'] and row['unsavedOpenConfirmations'] == 1
        assert row['lastPara'] == 63 and row['lastOffset'] == 66
        assert row['resourceSequence'] == [1, 2, 1, 1, 2, 1, 0]
        stem = seed['label']+'-input.'+ext
        assert sha(seed['files'][ext]) == sha(phase/'files'/stem)
        base = stem+'-owner-save-reopen-'
        setup = pinned(phase/(base+'source-state.json.gz'))
        source, edited = setup['source'], setup['edited']
        assert source['cells'][24]['info'] == {'row': 8, 'col': 0, 'rowSpan': 32, 'colSpan': 2}
        assert source['dims']['rowCount'] == 48 and len(source['cells']) == 81
        assert source['pageCount'] == edited['pageCount'] == 9
        assert source['props']['repeatHeader'] and [i for i, c in enumerate(source['cells']) if c['props']['isHeader']] == [0, 1, 2]
        assert 'AFTER_TABLE_END' in source['body'][-1]
        headers = lambda v: [[r for r in page if r['cell'] in [0, 1, 2]] for page in v['cellRendered']]
        assert headers(source) == headers(edited) and all(headers(edited))
        assert ''.join(source['rendered']).count('AFTER_TABLE_END') == ''.join(edited['rendered']).count('AFTER_TABLE_END') == 1
        assert edited['cells'][24]['paras'][0]['text'] == 'SAVE_NAV🙂'+source['cells'][24]['paras'][0]['text']
        assert edited['cells'][24]['paras'][1:] == source['cells'][24]['paras'][1:]
        assert [c for i, c in enumerate(edited['cells']) if i != 24] == [c for i, c in enumerate(source['cells']) if i != 24]
        for k in ['body', 'bodyFormats', 'props', 'pageDef', 'styles', 'dims']:
            assert edited[k] == source[k]
        a, b = source['cells'][24]['paras'][0], edited['cells'][24]['paras'][0]
        ids = lambda p: [run['charShapeId'] for run in p['runs'] for _ in range(run['endOffset']-run['startOffset'])]
        assert a['props'] == b['props'] and ids(b)[9:] == ids(a)
        start, edit = setup['sourceObservation'], setup['editObservation']
        assert start['dirty'] is False and edit['dirty'] is True
        assert setup['editHistory'] == {'u': 1, 'r': 0, 'snapshotResources': 1}
        record, fields = command(edit, 'undo')
        assert record['resources'] == 1 and fields['afterId'] is None
        for step, cell, para, offset in [('tab', 25, 0, 0), ('shift-tab', 24, 63, 66)]:
            nav = pinned(phase/(base+step+'-state.json.gz'))
            assert nav['reference'] == nav['after'] == edited and nav['sameCommand']
            assert nav['historyBefore'] == nav['historyAfter'] == setup['editHistory']
            obs = nav['observation']
            assert obs['dirty'] is True and obs['entries'] == edit['entries']
            assert obs['cursor']['cellIndex'] == cell and obs['cursor']['paragraphIndex'] == obs['cursor']['cellParaIndex'] == para
            assert obs['cursor']['charOffset'] == offset and nav['expected'] == {'cell': cell, 'para': para, 'charOffset': offset}
        history_states = []
        for stage, redo in [('before-save-undo', False), ('before-save-redo', True), ('after-save-undo', False), ('after-save-redo', True)]:
            value = pinned(phase/(base+stage+'-state.json.gz'))
            expected = edited if redo else source
            assert value['reference'] == expected and comparable(value['after']) == comparable(expected)
            assert value['history'] == {'u': int(redo), 'r': int(not redo), 'snapshotResources': 1 if redo else 2}
            assert value['sameCommand'] and value['observation']['dirty'] is True
            assert value['observation']['cursor'] == (edit if redo else start)['cursor']
            entry, f = command(value['observation'], 'undo' if redo else 'redo')
            assert f['beforeId'] == fields['beforeId'] and f['timestamp'] == fields['timestamp']
            assert entry['resources'] == (1 if redo else 2)
            assert (f['afterId'] is None) == redo
            history_states.append(value)
        saved = pinned(phase/(base+'saved-state.json.gz'))
        assert comparable(saved['reference']) == comparable(saved['after']) == comparable(edited)
        assert saved['sameSavedCommand'] and saved['beforeSave']['dirty'] is True and saved['savedObservation']['dirty'] is False
        assert saved['beforeSaveHistory'] == saved['savedHistory'] == {'u': 1, 'r': 0, 'snapshotResources': 1}
        assert saved['savedObservation']['entries'] == saved['beforeSave']['entries']
        assert saved['savedObservation']['cursor'] == saved['beforeSave']['cursor']
        assert saved['savedObservation']['generation'] == saved['beforeSave']['generation']
        name = seed['label']+'-'+ext+'-owner-save-reopen.'+ext
        file = phase/'files'/name
        pins[file] = sha(file)
        assert saved['savedFile']['name'] == saved['savedObservation']['fileName'] == name
        assert pins[file] == saved['savedFile']['sha256'] == saved['expectedExportSHA256'] == saved['reference'][ext]['sha256']
        assert file.stat().st_size == saved['savedFile']['bytes'] == saved['reference'][ext]['bytes']
        assert '저장 완료' in saved['saveStatus']['status'] and '수정됨' not in saved['saveStatus']['filename']
        ipc = [r for r in audit if r['kind'] == 'save-ipc-enter' and r['format'] == ext]
        assert len(ipc) == 1 and ipc[0]['sha256'] == pins[file] and ipc[0]['bytes'] == file.stat().st_size and ipc[0]['mainFrame']
        payload = phase/'files'/('ipc-payload-'+str(ipc[0]['id'])+'.'+ext)
        assert sha(payload) == pins[file]
        reopened = pinned(phase/(base+'reopened-state.json.gz'))
        assert reopened['productOnlyOpen'] and not reopened['reopenCommandRetained']
        assert comparable(reopened['after']) == comparable(reopened['reference']) == comparable(edited)
        assert reopened['beforeReopen'] == history_states[-1]['observation'] and reopened['beforeReopen']['dirty'] is True
        assert reopened['reopenObservation']['dirty'] is False and reopened['reopenObservation']['fileName'] == name
        assert reopened['reopenObservation']['generation'] != reopened['beforeReopen']['generation']
        assert reopened['reopenHistory'] == {'u': 0, 'r': 0, 'snapshotResources': 0}
        assert reopened['reopenObservation']['entries'] == {'undo': [], 'redo': []}
        assert len(reopened['confirmations']) == 1 and reopened['confirmations'][0]['plan'] == 'reopen-'+name
        m = next(v for v in manifest if Path(v['file']).name == name)
        assert m['pageCount'] == 9
        # The manifest retains complete SVG strings, not only digest snapshots.
        assert [{'sha256': hashlib.sha256(s.encode()).hexdigest(), 'bytes': len(s.encode())} for s in m['svg']] == edited['svg']
        for k in ['cells', 'body', 'bodyFormats', 'pageDef', 'props', 'styles', 'text']:
            assert m[k] == edited[k]
        cases.append({'format': ext, 'sourceSHA256': sha(seed['files'][ext]), 'savedSHA256': pins[file], 'savedBytes': file.stat().st_size,
            'pages': 9, 'owner': 24, 'nextCell': 25, 'navigationTransitions': 2, 'historyKeyCommands': 4, 'undoRedoPairs': 2,
            'sameFormatReopens': 1, 'savedCleanAndHistoryRetained': True, 'postSaveHistoryMakesDirty': True,
            'reopenedCleanAndHistoryCleared': True, 'nativeSaveCurrentExportExact': True, 'productOnlyReopen': True,
            'unsavedOpenConfirmations': 1, 'repeatHeaderAndFollowingBodyPreserved': True, 'repeatedHeaderPages': 9, 'followingBodyMarkerCount': 1, 'resourceSequence': [1, 2, 1, 1, 2, 1, 0]})
    checker = (repo/'scripts/check-electron-excluded-linewrap-history.mjs').read_text()
    function = checker.split('async function ownerSaveReopen(', 1)[1].split('// Reverse navigation', 1)[0]
    assert 'await load(' not in function and 'window.rhwpStudio.notifySaved' not in function
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
        assert sha(p) == digest, 'prior evidence or original dirty file changed: '+p
    assert all(sha(p) == digest for p, digest in pins.items())
    result = {'schema': 1, 'finishedUTC': datetime.now(timezone.utc).isoformat(),
        'baseApprovedPR33HEAD': 'c926151078312808d6155faf0cfe22e11285650c', 'productSourceChanged': False,
        'collectorSourceSHA256': sha(Path(__file__)), 'actualMacElectron': True, 'scenarioCases': 2, 'navigationTransitions': 4, 'historyKeyCommands': 8, 'undoRedoPairs': 4,
        'sameFormatSavedReopens': 2, 'nativeSaveCurrentExportChecks': 2, 'postSaveCleanHistoryRetainedChecks': 2,
        'postSaveUndoRedoDirtyChecks': 4, 'reopenedCleanEmptyHistoryChecks': 2, 'unsavedOpenConfirmations': 2,
        'appAndHarnessExitCode': 0, 'normalQuit': True, 'navigationComparison': 'full SVG/model and both export byte arrays in app',
        'historyAndReopenComparison': 'full SVG/model excluding serialized container bytes',
        'QAResetNotifySavedUsedBetweenSaveAndReopen': False, 'nativeExecutions': 0, 'newBuild': False, 'newPackage': False,
        'runtimeTreeSHA256': runtime['sourceRuntimeSHA256'], 'runtimeFilesVerified': 52, 'engineSHA256': proof['engineSHA256'],
        'retainedOriginalUIBuildChildExitCode': 0, 'retainedOriginalBuildCoordinatorPostCompleteExitCode': 1,
        'priorPinnedFilesUnchanged': len(prior), 'crossFormatLayoutJudged': False, 'guardedLayoutScopePromoted': False,
        'initialEditorSelectionAndHistoryKeysUseQAFocus': True, 'physicalIMEVerified': False, 'manualGUIVerified': False,
        'OSChooserVerified': False, 'cases': cases,
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

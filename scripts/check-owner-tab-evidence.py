"""Verify retained owner Tab before/after evidence and current product/runtime pins.
Usage: RUN_ROOT FRESH_COMPARISON_PHASE
Requires completed electron-final/ and retains the earlier failed electron/ phase.
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


def order(boxes):
    unique = {}
    for box in boxes:
        unique.setdefault(box['cellIdx'], box)
    return [b['cellIdx'] for b in sorted(unique.values(), key=lambda b: (b['row'], b['col']))]


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
    assert seed['operations'] == ['owner-tab'] and seed['historyCell'] == 24
    assert seed['repairExpected'] and seed['fallbackExactHistory'] and not seed['verifyUnchangedSaveReopen']
    old, final = run/'electron', run/'electron-final'
    old_process = pinned(old/'harness-process.json')
    assert old_process['nodeHarnessExitCode'] == 1 and old_process['appExitCode'] == 0 and old_process['appNormalQuit']
    old_state = pinned(old/(seed['label']+'-input.hwpx-owner-tab-state.json.gz'))
    assert comparable(old_state['before']) == comparable(old_state['after'])
    assert old_state['start']['cursor']['cellIndex'] == 24
    assert 'cellIndex' not in old_state['end']['cursor'] and old_state['end']['cursor']['paragraphIndex'] == 1
    assert old_state['start']['dirty'] == old_state['end']['dirty'] == False
    assert old_state['historyBefore'] == old_state['historyAfter'] == {'u': 0, 'r': 0, 'snapshotResources': 0}
    process = pinned(final/'harness-process.json')
    assert process['nodeHarnessExitCode'] == process['appExitCode'] == 0 and process['appNormalQuit']
    assert process['qaSourcesUnchanged'] and process['sourceSeedsUnchanged']
    assert process['sourceSeedsSHA256'] == pins[run/'seeds.json']
    for name, value in process['qaSourceBeforeSHA256'].items():
        source = final/name if name == 'bootstrap.cjs' else repo/'scripts'/name
        assert sha(source) == value == process['qaSourceAfterSHA256'][name]
    assert pinned(final/'qa-evidence-status.json')['outcome'] == 'complete'
    proof = pinned(final/'proof.json')
    assert proof['actualMacElectron'] and proof['pairs'] == proof['reopens'] == 0
    assert len(proof['rows']) == 2 and not proof['errors'] and not proof['fallbackComparisons']
    for scope in proof['repairScopes']:
        assert scope['guardedEligible'] == 0 and scope['historyEligible'] == [24]
    for row in proof['rows']:
        budget.check()
        ext = row['ext']
        assert row['operation'] == 'owner-tab' and row['fromCell'] == 24 and row['toCell'] == 25
        stem = seed['label']+'-input.'+ext
        assert sha(seed['files'][ext]) == sha(final/'files'/stem)
        value = pinned(final/(stem+'-owner-tab-state.json.gz'))
        assert value['before'] == value['after'], 'full SVG/model plus both serialized export digests'
        assert comparable(value['before']) == comparable(value['control']), 'no-input control'
        assert value['before']['cells'][24]['info'] == {'row': 8, 'col': 0, 'rowSpan': 32, 'colSpan': 2}
        assert value['before']['cells'][25]['info'] == {'row': 8, 'col': 2, 'rowSpan': 1, 'colSpan': 1}
        assert value['start']['cursor']['cellIndex'] == 24
        cursor = value['end']['cursor']
        assert cursor['cellIndex'] == 25 and cursor['cellParaIndex'] == cursor['charOffset'] == 0
        assert cursor['parentParaIndex'] == value['start']['cursor']['parentParaIndex']
        assert cursor['cellPath'] == [{'controlIndex': cursor['controlIndex'], 'cellIndex': 25, 'cellParaIndex': 0}]
        assert value['start']['dirty'] == value['end']['dirty'] == False
        assert value['historyBefore'] == value['historyAfter'] == {'u': 0, 'r': 0, 'snapshotResources': 0}
        direct, by_path = order(value['queries']['direct']), order(value['queries']['byPath'])
        assert len(direct) == 81 and direct[direct.index(24)+1] == 25
        assert len(by_path) == 21 and 24 not in by_path
        cases.append({'format': ext, 'sourceSHA256': sha(seed['files'][ext]), 'fromCell': 24, 'toCell': 25,
            'fullSVGAndModelExact': True, 'bothExportDigestsExact': True, 'dirtyUnchanged': True,
            'historyUnchanged': True, 'directUniqueCells': 81, 'byPathUniqueCells': 21})
    manifest = pinned(final/'manifest.json.gz')
    assert manifest == []
    assert pinned(final/'manifest-status.json')['complete']
    build = run/'build-runtime'
    build_proof = pinned(build/'ui-source-proof.json')
    assert build_proof['buildExitCode'] == 0 and build_proof['sourceUnchangedDuringBuild']
    assert build_proof['productSourceBeforeSHA256'] == build_proof['productSourceAfterSHA256']
    for p, digest in build_proof['productSourceBeforeSHA256'].items():
        assert sha(repo/p) == digest
    runtime_pin = pinned(build/'runtime-pin-verified.json')
    tree_digest = hashlib.sha256(json.dumps(runtime_pin['runtimeFilesSHA256'], sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    assert runtime_pin['sourceRuntimeSHA256'] == tree_digest
    for name, digest in runtime_pin['runtimeFilesSHA256'].items():
        assert sha(build/'runtime'/name) == sha(final/'runtime'/name) == digest
    assert sha(repo/'desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron') == runtime_pin['hostElectronBinarySHA256']
    finalization = pinned(build/'build-wrapper-finalization.json')
    assert finalization['buildExitCode'] == 0 and finalization['coordinatorExitCode'] == 1
    prior = pinned(run/'prior-pins.json')
    for p, digest in prior.items():
        assert sha(p) == digest, 'previous evidence or original dirty file changed: '+p
    assert all(sha(p) == digest for p, digest in pins.items())
    result = {'schema': 1, 'finishedUTC': datetime.now(timezone.utc).isoformat(), 'operation': 'owner-tab',
        'oldObservedExitToBody': True, 'oldObservedFormat': 'hwpx', 'oldHarnessExitCode': 1,
        'oldAppExitCode': 0, 'newExactNavigationCases': 2, 'newAppAndHarnessExitCode': 0,
        'normalQuit': True, 'newHistoryEntries': 0, 'newSnapshotResources': 0, 'savedReopens': 0,
        'productChange': 'top-level single-entry cellPath uses model-ID bbox query for reading order',
        'cursorSourceSHA256': sha(repo/'rhwp-studio/src/engine/cursor.ts'), 'engineSHA256': proof['engineSHA256'],
        'runtimeTreeSHA256': tree_digest, 'runtimeFilesVerified': len(runtime_pin['runtimeFilesSHA256']),
        'buildExitCode': 0, 'buildCoordinatorPostCompleteExitCode': 1,
        'priorPinnedFilesUnchanged': len(prior), 'guardedLayoutScopePromoted': False,
        'crossFormatLayoutJudged': False, 'physicalIMEVerified': False, 'manualGUIVerified': False,
        'cases': cases, 'inputEvidenceSHA256': {str(p.relative_to(run)): digest for p, digest in pins.items()}}
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

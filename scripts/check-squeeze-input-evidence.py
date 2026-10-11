"""Verify fresh SQUEEZE input evidence without a cross-format layout oracle.
Usage: RUN_ROOT CURRENT_WASM_PKG FIXED_NATIVE FRESH_COMPARISON_PHASE
RUN_ROOT contains seeds.json, prior-pins.json, electron/ and native/.
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


run, pkg, native, out = [Path(p).resolve() for p in sys.argv[1:5]]
assert len(sys.argv) == 5 and not out.exists()
# Budget before directory creation, then use the persistent shared policy.
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
    seed = pinned(run/'seeds.json')
    assert len(seed) == 1
    seed = seed[0]
    assert seed['operations'] == ['history-input']
    assert seed['repairExpected'] and seed['fallbackExactHistory']
    assert seed['sameFormatSaveReopen'] and seed['historyCell'] == 24
    electron = run/'electron'
    process = pinned(electron/'harness-process.json')
    assert process['nodeHarnessExitCode'] == process['appExitCode'] == 0
    assert process['appNormalQuit'] and process['qaSourcesUnchanged'] and process['sourceSeedsUnchanged']
    assert process['sourceSeedsSHA256'] == pins[run/'seeds.json']
    for name, value in process['qaSourceBeforeSHA256'].items():
        source = electron/name if name == 'bootstrap.cjs' else repo/'scripts'/name
        assert sha(source) == value == process['qaSourceAfterSHA256'][name]
    assert pinned(electron/'qa-evidence-status.json')['outcome'] == 'complete'
    proof = pinned(electron/'proof.json')
    assert proof['actualMacElectron'] and proof['pairs'] == 4 and proof['reopens'] == 2
    assert not proof['errors'] and not proof['fallbackComparisons']
    assert proof['engineSHA256'] == proof['receivedEngineSHA256'] == sha(pkg/'rhwp_bg.wasm')
    assert [r['ext'] for r in proof['rows']] == ['hwpx', 'hwp']
    for scope in proof['repairScopes']:
        assert scope['guardedEligible'] == 0 and scope['historyEligible'] == [24]
    saved = []
    for row in proof['rows']:
        budget.check()
        ext = row['ext']
        assert row['operation'] == 'history-input' and row['target'] == {'cell': 24, 'para': 0}
        stem = f"{seed['label']}-input.{ext}"
        source = Path(seed['files'][ext])
        assert sha(source) == sha(electron/'files'/stem)
        state = pinned(electron/(stem+'-history-input-state.json.gz'))
        before, after = state['before'], state['after']
        expected_cells = json.loads(json.dumps(before['cells']))
        expected_cells[24]['paras'][0]['text'] = 'EDIT🙂'+expected_cells[24]['paras'][0]['text']
        assert [[p['text'] for p in c['paras']] for c in after['cells']] == [[p['text'] for p in c['paras']] for c in expected_cells]
        assert after['body'] == before['body'] and after['bodyFormats'] == before['bodyFormats']
        assert after['props'] == before['props'] and after['pageDef'] == before['pageDef']
        assert after['styles'] == before['styles']
        assert state['historyBefore'] == {'u': 0, 'r': 0, 'snapshotResources': 0}
        assert state['historyAfterEdit'] == {'u': 1, 'r': 0, 'snapshotResources': 1}
        for cycle in range(2):
            for kind, expected in [('undo', before), ('redo', after)]:
                actual = pinned(electron/(stem+f'-history-input-{kind}{cycle}.json.gz'))
                assert comparable(actual) == comparable(expected), 'strict full SVG/model history'
        name = f"{seed['label']}-{ext}-history-input.{ext}"
        saved.append(electron/'files'/name)
        pins[saved[-1]] = sha(saved[-1])
        checks.append({'format': ext, 'sourceSHA256': sha(source), 'savedSHA256': pins[saved[-1]],
            'targetCell': 24, 'exactHistoryPairs': 2, 'sameFormatReopens': 1,
            'sourceSnapshotResources': 1, 'pageCounts': [before['pageCount'], after['pageCount']]})
    manifest = pinned(electron/'manifest.json.gz')
    assert len(manifest) == 2 and [Path(r['file']) for r in manifest] == saved
    status = pinned(electron/'manifest-status.json')
    assert status['complete'] and status['records'] == status['plannedRecords'] == 2
    code = """import fs from 'node:fs';import path from 'node:path';import {pathToFileURL} from 'node:url';const [pkg,list]=process.argv.slice(1),M=await import(pathToFileURL(path.join(pkg,'rhwp.js')));M.initSync({module:fs.readFileSync(path.join(pkg,'rhwp_bg.wasm'))});const rows=[];for(const file of JSON.parse(list)){const d=new M.HwpDocument(fs.readFileSync(file)),t=JSON.parse(d.getControls()).find(t=>t.ctrlId==='tbl'&&t.list===0),dim=JSON.parse(d.getTableDimensions(0,t.para,t.controlIndex));rows.push({file:path.basename(file),rows:dim.rowCount,guardedEligible:Array.from({length:dim.cellCount},(_,i)=>d.mergedCellNeedsTextSnapshot(0,t.para,t.controlIndex,i)).flatMap((v,i)=>v?[i]:[]),historyEligible:Array.from({length:dim.cellCount},(_,i)=>d.excludedLineWrapCellNeedsTextSnapshot(0,t.para,t.controlIndex,i)).flatMap((v,i)=>v?[i]:[])});d.free();}console.log(JSON.stringify(rows));"""
    scope = json.loads(subprocess.run(['node', '--input-type=module', '-e', code, str(pkg), json.dumps([str(p) for p in saved])], capture_output=True, text=True, check=True).stdout)
    assert all(r['rows'] == 48 and r['guardedEligible'] == [] and r['historyEligible'] == [24] for r in scope)
    native_metadata = json.loads(subprocess.run(['node', str(repo/'scripts/qa-native-metadata-input.mjs'), 'saved', str(run/'native'), str(native)], capture_output=True, text=True, check=True).stdout)
    assert native_metadata['cases'] == 2 and native_metadata['metadataValidated']
    native_process = pinned(run/'native/native-process.json')
    assert native_process['exitCode'] == 0
    index = pinned(run/'native/index.json')
    assert index['cases'] == 2 and index['sourceManifestSHA256'] == pins[electron/'manifest.json.gz']
    for row, file in zip(index['rows'], saved):
        assert row['savedFile'] == file.name and row['savedSHA256'] == pins[file]
        assert row['nativeExitCode'] == 0 and row['nativeSame'] and row['overflowWarnings'] == 0
    prior = pinned(run/'prior-pins.json')
    for p, value in prior.items():
        assert sha(p) == value, 'previous evidence or original dirty file changed: '+p
    assert all(sha(p) == value for p, value in pins.items())
    result = {'schema': 1, 'finishedUTC': datetime.now(timezone.utc).isoformat(),
        'operation': 'history-input', 'exactUndoRedoPairs': 4, 'sameFormatSavedReopens': 2,
        'actualMacElectron': True, 'electronAndHarnessExitCode': 0, 'normalQuit': True,
        'nativeExactSavedCases': 2, 'nativeOverallExitCode': 0, 'nativeOverflowWarnings': 0,
        'engineSHA256': proof['engineSHA256'], 'runtimeSHA256': read(electron/'reuse-proof.json')['sourceRuntimeSHA256'],
        'nativeSHA256': sha(native), 'sourceSeedSHA256': pins[run/'seeds.json'],
        'priorPinnedFilesUnchanged': len(prior), 'crossFormatLayoutJudged': False,
        'guardedLayoutScopePromoted': False, 'cases': checks, 'savedScope': scope,
        'inputEvidenceSHA256': {str(p.relative_to(run)): value for p, value in pins.items()},
        'budget': budget.check(), 'physicalIMEVerified': False, 'manualGUIVerified': False}
    data = json.dumps(result, indent=2)+'\n'
    budget.check(len(data.encode()))
    with (out/'proof.json').open('x') as stream:
        stream.write(data)
    budget.mark('complete')
    print(json.dumps({k: v for k, v in result.items() if k not in ['inputEvidenceSHA256', 'cases', 'savedScope', 'budget']}))
except BaseException as e:
    with (out/'failure.json').open('x') as stream:
        stream.write(json.dumps({'failure': str(e)[:2048], 'completedCases': len(checks)})+'\n')
    budget.mark('failed')
    raise
finally:
    budget.close()

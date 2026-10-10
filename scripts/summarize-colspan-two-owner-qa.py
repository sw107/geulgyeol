#!/usr/bin/env python3
"""Verify completed, immutable Mac table evidence without publishing raw files.

Usage: summarize-colspan-two-owner-qa.py QA_ROOT FRESH_OUTPUT_JSON
Run from the repository. All planned phases must be complete; interrupted runs
are excluded. The output contains hashes and counts, not document contents.
"""
import datetime
import gzip
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import sys


def sha(file):
    with Path(file).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def read(file):
    return json.loads(Path(file).read_text())


def main():
    root, output = Path(sys.argv[1]).resolve(), Path(sys.argv[2])
    assert not output.exists(), 'fresh evidence output required'
    repo = Path.cwd()
    sys.dont_write_bytecode = True
    spec = importlib.util.spec_from_file_location('manifest_stream', repo / 'scripts/shard-electron-table-manifest.py')
    stream = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(stream)
    wasm = sha(root / 'pkg-final/rhwp_bg.wasm')
    native = sha(root / 'native/debug/examples/three_column_owner_check')
    required = 15 * 1024**3 + 256 * 1024**2
    phases, paints, saved_files = [], [], []
    for item in read(root / 'plan.json'):
        name = item['phase']
        phase = root / name
        proof = read(phase / 'proof.json')
        process = read(phase / 'harness-process.json')
        record = read(phase / 'phase-record.json')
        lifecycle = read(phase / 'lifecycle.json')
        assert lifecycle['exitCode'] == 0 and lifecycle['normalQuit'] and not lifecycle.get('failure')
        index_dir = root / ('native-' + name)
        index = read(index_dir / 'index.json')
        assert process['nodeHarnessExitCode'] == process['appExitCode'] == 0 and process['appNormalQuit']
        assert process['qaSourcesUnchanged'] and process['sourceSeedsUnchanged']
        assert process['qaSourceBeforeSHA256'] == process['qaSourceAfterSHA256']
        assert process['sourceSeedsBeforeSHA256'] == process['sourceSeedsAfterSHA256'] == sha(phase / 'seeds.json')
        assert proof['actualMacElectron'] and not proof['actualPackagedApp']
        assert proof['receivedEngineSHA256'] == proof['engineSHA256'] == wasm
        assert not proof['errors'] and proof['exitCode'] == proof['appExitCode'] == 0
        assert len(proof['rows']) == record['cases'] == item['expectedCases']
        assert proof['pairs'] == sum(row.get('historyPairs', 0) for row in proof['rows'])
        assert proof['reopens'] == record['reopens'] == index['cases']
        assert record['nativeComparisons'] == index['cases'] and index['nativeSHA256'] == native
        assert index['verificationInputsUnchanged'] and not index['scratchIsCanonicalEvidence']
        assert len(record['operations']) == 2 and all(o['exitCode'] == 0 for o in record['operations'])
        assert not record['stoppedForBudget'] and record['freeMinimumObservedBytes'] >= required
        assert record['afterFreeBytes'] >= required
        evidence = proof['manifestEvidence']
        manifest = phase / evidence['file']
        assert sha(manifest) == evidence['fileSHA256'] == index['sourceManifestSHA256']
        with gzip.open(manifest, 'rb') as handle:
            raw_sha = hashlib.file_digest(handle, 'sha256').hexdigest()
        assert raw_sha == evidence['uncompressedSHA256'] == index['sourceUncompressedSHA256']
        assert evidence['uncompressedBytes'] == index['sourceUncompressedBytes']
        native_details = []
        count = 0
        for count, (row, idx) in enumerate(zip(stream.rows(manifest), index['rows'], strict=True), 1):
            assert Path(row['file']).name == idx['savedFile']
            # Scope actual saved-file reads to this completed phase's files.
            saved = phase / 'files' / idx['savedFile']
            assert Path(row['file']).resolve() == saved.resolve()
            assert sha(saved) == idx['savedSHA256']
            canonical = json.dumps([row], ensure_ascii=False, separators=(',', ':')).encode()
            assert hashlib.sha256(canonical).hexdigest() == idx['manifestSHA256']
            assert idx['nativeExitCode'] == 0 and idx['nativeSame'] and idx['overflowWarnings'] == 0
            leaf = read(index_dir / f'native-{count-1:04d}/proof.json')
            assert leaf['fullSVGPageCountBodyCellsParagraphAndCharacterIDsStylesExact'] and leaf['sameBytesFiles'] == 1
            log = index_dir / f'native-{count-1:04d}.log'
            assert 'LAYOUT_OVERFLOW' not in log.read_text()
            native_details.append({'savedFile': idx['savedFile'], 'savedSHA256': idx['savedSHA256'],
                                   'manifestCaseSHA256': idx['manifestSHA256'], 'nativeLogSHA256': sha(log),
                                   'nativeProofSHA256': sha(index_dir / f'native-{count-1:04d}/proof.json')})
            saved_files.append(saved)
        assert count == index['cases']
        paints.extend(proof['paintChecks'])
        assert all(p['hidden'] == p['partial'] == 0 and p['maxBorderOverflow'] <= 2 and p['maxInkOverflow'] <= 2 for p in proof['paintChecks'])
        phases.append({'phase': name, 'cases': len(proof['rows']), 'historyPairs': proof['pairs'],
                       'reopens': proof['reopens'], 'nativeComparisons': index['cases'],
                       'nodeExitCode': 0, 'appExitCode': 0, 'normalQuit': True,
                       'startedUTC': record['startedUTC'], 'finishedUTC': record['finishedUTC'],
                       'minimumObservedFreeBytes': record['freeMinimumObservedBytes'],
                       'leafSourceBeforeAfterSHA256': process['qaSourceBeforeSHA256'],
                       'evidenceSHA256': {n: sha(phase / n) for n in ['proof.json', 'harness-process.json', 'harness-process.log', 'phase-record.json', 'lifecycle.json', 'manifest.json.gz', 'electron.png']},
                       'nativeIndexSHA256': sha(index_dir / 'index.json'), 'savedChecks': native_details})
    assert len(saved_files) == len(set(saved_files)), 'saved evidence paths must be distinct'
    protected = read(root / 'protected-before.json')
    assert len(protected) == 22 and all(sha(p) == pin for p, pin in protected.items())
    zip_file = root.parent / 'mac-beta3-completion-release-qa/Geulgyeol-0.4.4-beta.3-mac-arm64.zip'
    zip_sha = sha(zip_file)
    assert zip_sha == 'e7cbb06e72596249d7b6256602eb567b8c81eaf4cc749c405d9cd5f2b9fa28de'
    old_native = root.parent / 'style-lint-qa/target/debug/examples/horizontal_table_saved_check'
    assert sha(old_native) == '369fa9dc076cb2826c443f8e8902f24bb44d771391d295eea0181711dfe8eade'
    approved_pkg = root.parent / 'table-mixed-owner-completion-qa/pkg-final'
    assert sha(approved_pkg / 'rhwp_bg.wasm') == 'e9cdd0cd9b2bb4c2205ae674305d19748ae6651a75da759f672b2233030d42f7'
    assert sha(repo / 'engine/src/renderer/float_placement.rs') == sha(root / 'checkpoint/float_placement.rs')
    assert sha(repo / 'engine/src/renderer/layout.rs') == sha(root / 'checkpoint/layout.rs')
    assert sha(repo / 'engine/src/document_core/commands/text_editing.rs') == sha(root / 'checkpoint/text_editing.rs')
    scopes = {}
    for name, mode in [('scope-baseline', 'baseline'), ('scope-supported', 'supported')]:
        p = read(root / name / 'result/proof.json')
        proc = read(root / name / 'process.json')
        assert proc['exitCode'] == 0 and proc['scriptSHA256Before'] == proc['scriptSHA256After'] == sha(repo / 'scripts/check-colspan-two-owner-snapshot-scope.mjs')
        assert p['mode'] == mode and p['positiveCases'] == 10 and p['excludedCases'] == 58 and p['queryReadOnlyCases'] == 68
        assert p['sourceFilesUnchanged'] == 10
        scopes[mode] = {'positiveCases': 10, 'excludedCases': 58, 'queryReadOnlyCases': 68,
                        'proofSHA256': sha(root / name / 'result/proof.json'), 'processSHA256': sha(root / name / 'process.json')}
    widths = []
    for proof_name, seed_name, directory in [
            ('native-source-width-order-proof.json', 'seeds/seeds.json', 'native-source'),
            ('native-completion-width-order-proof.json', 'completion-seeds/seeds.json', 'native-completion'),
            ('native-whole-fit-width-order-proof.json', 'whole-fit-seeds/seeds.json', 'native-whole-fit')]:
        p = read(root / proof_name)
        seeds = {s['label']: s for s in read(root / seed_name)}
        assert p['cases'] == len(p['rows']) and sha(root / seed_name) == p['seedIndexSHA256']
        for row in p['rows']:
            assert row['sourceOwnershipIssues'] == row['warnings'] == row['emptyHeaderOnlyFragments'] == 0
            assert row['cutContinuityExact'] and row['originalOutputOrderValidated']
            stem = row['label'] + '-' + row['format']
            assert sha(root / directory / stem / 'ledger.json') == row['ledgerSHA256']
            assert sha(root / directory / (stem + '.log')) == row['cutLogSHA256']
            assert sha(seeds[row['label']]['files'][row['format']]) == row['sourceSHA256']
        widths.extend(p['rows'])
    for stem in ['source', 'completion']:
        process = read(root / ('native-' + stem + '-process.json'))
        assert process['nativeSHA256Before'] == process['nativeSHA256After'] == native
        assert process['checkerExitCode'] == 0
        assert process['checkerSHA256Before'] == process['checkerSHA256After'] == sha(repo / 'scripts/check-colspan-two-owner-native-evidence.py')
        assert process['checkerLogSHA256'] == sha(root / ('native-' + stem + '-width-order-check.log'))
        assert all(row['exitCode'] == 0 and row['nativeSHA256'] == native
                   and row['sourceSHA256'] == row['sourceAfterSHA256'] for row in process['rows'])
    whole = read(root / 'native-whole-fit-process.json')
    assert len(whole['rows']) == 3 and all(row['exitCode'] == 0 for row in whole['rows'])
    assert all(Path(row['command'][0]).resolve() == root / 'native/debug/examples/three_column_owner_check'
               for row in whole['rows'][:2])
    order_proofs = [read(root / n) for n in ['pr14-owner-order-source-proof.json', 'pr14-owner-order-boundary-proof.json']]
    assert sum(p['cases'] for p in order_proofs) == 28
    assert sum(r['originalOrderOwners'] for p in order_proofs for r in p['rows']) == 2556
    order_process = read(root / 'pr14-owner-order-process.json')
    assert len(order_process['runs']) == 2 and all(run['exitCode'] == 0 for run in order_process['runs'])
    assert order_process['scriptSHA256Before'] == order_process['scriptSHA256After'] == sha(repo / 'scripts/check-three-column-owner-native-evidence.py')
    negative = read(root / 'owner-order-negative/proof.json')
    assert negative['positiveSyntheticCases'] == 2 and negative['negativeActualProcessCases'] == 6
    assert all(r['actualProcessExitCode'] == 1 and r['historicalSortingCheckerAccepted'] and r['orderDiagnosticPresent'] for r in negative['rows'])
    for case in negative['rows']:
        assert sha(repo / 'scripts' / case['checker']) == case['checkerSHA256']
        assert sha(root / 'owner-order-negative' / (Path(case['checker']).stem+'-'+case['case']+'.log')) == case['logSHA256']
    two_header = read(root / 'two-column-header-colspan-regression-proof.json')
    assert two_header['cases'] == 4 and all(r['queryReadOnly'] and r['sourceUnchanged'] for r in two_header['rows'])
    regression = read(root / 'three-column-regression-scope/result/proof.json')
    assert regression['positiveCases'] == 10 and regression['excludedCases'] == 42 and regression['queryReadOnlyCases'] == 52
    builds = [read(root / n) for n in ['native-build-proof.json', 'wasm-build-proof.json']]
    assert all(b['exitCode'] == 0 and not b['stoppedForBudget'] and b['targetPeakBytes'] <= 5078798827 and b['freeMinimumObservedBytes'] >= required for b in builds)
    target = root.parent / 'style-lint-qa/target'
    target_size = int(subprocess.check_output(['du', '-sk', str(target)]).split()[0]) * 1024
    free = shutil.disk_usage(root).free
    assert target_size <= 5078798827 and free >= required
    desktop = read(root / 'desktop-test-process.json')
    assert desktop['exitCode'] == 0 and desktop['engineSHA256Before'] == desktop['engineSHA256After'] == wasm
    assert desktop['logSHA256'] == sha(root / 'desktop-test-new-engine.log')
    carets = read(root / 'carets/proof.json')
    caret_process = read(root / 'carets-process.json')
    assert len(carets['rows']) == 30 and carets['engineSHA256'] == wasm
    assert carets['checked'] == sum(r['carets'] for r in carets['rows'])
    assert all(r['readOnly'] for r in carets['rows']) and caret_process['exitCode'] == 0
    assert caret_process['scriptSHA256Before'] == caret_process['scriptSHA256After'] == sha(repo / 'scripts/check-colspan-two-owner-carets.mjs')
    prior = root.parent / 'table-colspan-two-owner-qa'
    failure = read(prior / 'colspan-unequal-right-input/harness-process.json')
    assert failure['nodeHarnessExitCode'] == 1 and failure['appExitCode'] == 0 and failure['appNormalQuit']
    cursor_prior = root.parent / 'table-colspan-two-owner-caret-qa'
    binding_failure = read(cursor_prior / 'colspan-unequal-right-input/harness-process.json')
    assert binding_failure['nodeHarnessExitCode'] == 1 and binding_failure['appExitCode'] == 0 and binding_failure['appNormalQuit']
    asset_correction = read(cursor_prior / 'app-template-asset-correction-process.json')
    assert asset_correction['newAssetSHA256'] == sha(cursor_prior / 'pkg-final/rhwp_bg.wasm') and asset_correction['failedPhaseNotCounted']
    cursor_failure = read(cursor_prior / 'colspan-row-bounds/harness-process.json')
    assert cursor_failure['nodeHarnessExitCode'] == 1 and cursor_failure['appExitCode'] == 0 and cursor_failure['appNormalQuit']
    cursor_plan = read(cursor_prior / 'plan.json')
    cursor_records = [read(cursor_prior / item['phase'] / 'phase-record.json') for item in cursor_plan[:13]]
    assert all(r['nodeExitCode'] == r['appExitCode'] == 0 for r in cursor_records)
    assert sum(r['cases'] for r in cursor_records) == 190
    assert sum(r['pairs'] for r in cursor_records) == sum(r['reopens'] for r in cursor_records) == 380
    assert sum(r['nativeComparisons'] for r in cursor_records) == 380
    archives = []
    for name in ['cache-representation-20261010', 'cache-representation-additional-20261010-reviewed']:
        archive = prior / name
        index = read(archive / 'index.json')
        result = read(archive / 'result.json')
        assert result['activeTargetUnchanged'] and result['protected22Unchanged']
        if 'capBytes' in result:
            assert result['logicalSavingsBytes'] <= result['capBytes'] == 2000000000
            assert result['priorProof88Unchanged']
        for verified in sorted((archive / 'records').glob('*verified.json')):
            record = read(verified)
            assert record['onDiskReadBackSHAAndBytesMatchedOriginal'] if 'original' in record else record['onDiskReadBackSHAAndBytesMatchedEachOriginal']
            assert sha(archive / record['objectRelativePath']) == record['compressedSHA256']
        assert sha(archive / 'index.json') == result['indexSHA256']
        assert sha(archive / 'restore.py') == result['restoreScriptSHA256']
        archives.append({'directory':str(archive.relative_to(root.parent)), 'indexSHA256':sha(archive/'index.json'), 'resultSHA256':sha(archive/'result.json'), 'restoreScriptSHA256':sha(archive/'restore.py'), 'convertedOriginalPaths':result.get('convertedPaths',result.get('convertedFiles'))})
    out = {'schema': 1, 'verifiedUTC': datetime.datetime.now(datetime.timezone.utc).isoformat(),
           'scope': 'Mac source-QA Electron 44.3.0; no new packaged app or release',
           'startingCommit': 'e1c59bb87d29f4251f5a48943527456e710f5b28',
           'PR14MergedMain': 'c3fc2bcd11a2483901c4a679e0a61c7330936a84',
           'verifiedCheckoutCommit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip(),
           'wasmSHA256': wasm, 'nativeSHA256': native,
           'caretQueries': carets['checked'], 'caretQueryDocuments': len(carets['rows']),
           'caretProofSHA256': sha(root / 'carets/proof.json'), 'caretProcessSHA256': sha(root / 'carets-process.json'),
           'excludedPreCaretEvidence': {'successfulCases':72,'historyPairs':144,'savedReopensAndNative':144,'failedPhaseNodeExitCode':1,'failedPhaseAppExitCode':0,'failureProcessSHA256':sha(prior / 'colspan-unequal-right-input/harness-process.json'),'regressionProcessSHA256':sha(prior / 'caret-rebuild/before-carets-process.json')},
           'losslessCacheArchives': archives,
           'excludedCursorOnlyEvidence': {'cases':190, 'historyPairs':380, 'reopensAndNative':380, 'normalQuitPhases':13, 'wasmSHA256':sha(cursor_prior/'pkg-final/rhwp_bg.wasm'), 'failedRowBoundsCases':0, 'failureProcessSHA256':sha(cursor_prior/'colspan-row-bounds/harness-process.json'), 'lastSuccessUTC':max(r['finishedUTC'] for r in cursor_records)},
           'excludedTypesetTrial': {'nativeWholeFitCheckerExitCode':read(root.parent/'table-colspan-two-final-qa/native-whole-fit-process.json')['rows'][-1]['exitCode'], 'proofSHA256':sha(root.parent/'table-colspan-two-final-qa/native-whole-fit-process.json')},
           'excludedRuntimeBindingFailure': {'cases':0,'nodeExitCode':1,'appExitCode':0,'processSHA256':sha(cursor_prior / 'colspan-unequal-right-input/harness-process.json'),'assetCorrectionSHA256':sha(cursor_prior / 'app-template-asset-correction-process.json')},
           'newBindingsCurrentSHA256': {p.name: sha(p) for p in sorted((root / 'pkg-final').iterdir()) if p.is_file()},
           'approvedBindingsCurrentSHA256': {p.name: sha(p) for p in sorted(approved_pkg.iterdir()) if p.is_file()},
           'oldNativeUnchangedSHA256': sha(old_native),
           'cases': sum(p['cases'] for p in phases), 'historyPairs': sum(p['historyPairs'] for p in phases),
           'reopens': len(saved_files), 'nativeComparisons': len(saved_files),
           'normalQuitPhases': len(phases), 'paintChecks': len(paints), 'paintPages': sum(p['pages'] for p in paints),
           'maximumBorderOverflowPx': max(p['maxBorderOverflow'] for p in paints),
           'maximumInkOverflowPx': max(p['maxInkOverflow'] for p in paints), 'hidden': 0, 'partial': 0,
           'allSavedBytesRehashed': True, 'fullSVGModelsStylesAndCharacterIDsExact': True,
           'scopeQueries': scopes, 'nativeSourceAndBoundaryCases': len(widths),
           'roundedPaintWidthChecks': sum(r['paintWidthChecks'] for r in widths),
           'fullPrecisionSVGClipWidthChecks': sum(r['fullPrecisionSVGClipWidthChecks'] for r in widths),
           'maximumSVGClipWidthErrorPx': max(r['maximumSVGClipWidthErrorPx'] for r in widths),
            'sourceAndBoundaryProofSHA256': {n: sha(root / n) for n in [
               'native-source-width-order-proof.json', 'native-completion-width-order-proof.json',
               'native-whole-fit-width-order-proof.json', 'native-whole-fit-process.json',
               'native-source-process.json', 'native-completion-process.json', 'row-bounds/proof.json',
               'seeds/fixture-proof.json', 'completion-seeds/source-proof.json',
               'pr14-owner-order-source-proof.json', 'pr14-owner-order-boundary-proof.json',
               'pr14-owner-order-process.json', 'owner-order-negative/proof.json',
               'three-column-regression-scope/result/proof.json', 'three-column-regression-scope/process.json',
               'two-column-header-colspan-regression-proof.json', 'checkpoint/check-two-header-span.mjs',
               'desktop-test-process.json', 'desktop-test-new-engine.log',
               'native-build-proof.json', 'native-build.log', 'wasm-build-proof.json', 'wasm-build.log']},
           'protectedFiles': {str(Path(p).relative_to(root.parent)): h for p,h in protected.items()},
           'approvedZIPUnchangedSHA256': zip_sha, 'publicationAttempted': False,
           'budget': {'targetLimitBytes': 5078798827, 'requiredFreeBytes': required,
                      'buildTargetMaximumObservedBytes': max(b['targetPeakBytes'] for b in builds),
                      'currentTargetBytes': target_size, 'currentFreeBytes': free,
                      'minimumObservedFreeBytes': min([b['freeMinimumObservedBytes'] for b in builds] + [p['minimumObservedFreeBytes'] for p in phases])},
           'twoColumnMergedHeaderReadOnlyCases': 4, 'PR14OriginalOutputOrderOwners': 2556, 'negativeActualOrderProcessCases': 6,
           'sourceSHA256': {str(p.relative_to(repo)): sha(p) for p in [repo / 'engine/src/renderer/float_placement.rs', repo / 'engine/src/renderer/layout.rs', repo / 'engine/src/renderer/typeset.rs', repo / 'scripts/prepare-colspan-two-owner-fixtures.mjs', repo / 'scripts/prepare-colspan-two-owner-completion.mjs', repo / 'engine/src/document_core/commands/text_editing.rs', *sorted((repo / 'scripts').glob('*colspan-two-owner*')), repo / 'scripts/check-three-column-owner-native-evidence.py', repo / 'scripts/check-owner-run-order-negative.py', repo / 'engine/examples/three_column_owner_check.rs', repo / 'engine/examples/mixed_table_owner_probe.rs', repo / 'engine/examples/horizontal_table_saved_check.rs'] if p.is_file()},
           'phases': phases}
    assert len(out['protectedFiles']) == 22
    assert out['normalQuitPhases'] == 17 and out['cases'] == 244
    assert out['historyPairs'] == 448 and out['reopens'] == out['nativeComparisons'] == 484
    output.write_text(json.dumps(out, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({k: out[k] for k in ['cases', 'historyPairs', 'reopens', 'nativeComparisons', 'normalQuitPhases', 'paintChecks', 'paintPages', 'maximumBorderOverflowPx', 'maximumInkOverflowPx', 'budget']}, ensure_ascii=False))


if __name__ == '__main__':
    main()

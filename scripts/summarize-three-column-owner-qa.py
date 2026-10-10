#!/usr/bin/env python3
"""Verify completed, immutable Mac table evidence without publishing raw files.

Usage: summarize-three-column-owner-qa.py QA_ROOT FRESH_OUTPUT_JSON
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
        assert name != 'three-long-middle-all-history', 'interrupted phase cannot count'
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
    assert len(protected) == 14 and all(sha(p) == pin for p, pin in protected.items())
    zip_file = root.parent / 'mac-beta3-completion-release-qa/Geulgyeol-0.4.4-beta.3-mac-arm64.zip'
    zip_sha = sha(zip_file)
    assert zip_sha == 'e7cbb06e72596249d7b6256602eb567b8c81eaf4cc749c405d9cd5f2b9fa28de'
    old_native = root.parent / 'style-lint-qa/target/debug/examples/horizontal_table_saved_check'
    assert sha(old_native) == '369fa9dc076cb2826c443f8e8902f24bb44d771391d295eea0181711dfe8eade'
    approved_pkg = root.parent / 'table-mixed-owner-completion-qa/pkg-final'
    assert sha(approved_pkg / 'rhwp_bg.wasm') == 'e9cdd0cd9b2bb4c2205ae674305d19748ae6651a75da759f672b2233030d42f7'
    assert sha(repo / 'engine/src/renderer/float_placement.rs') == sha(root / 'prepared-checkpoint/float_placement.rs')
    scopes = {}
    for name, mode in [('scope-baseline-grid', 'baseline'), ('scope-supported-grid', 'supported')]:
        p = read(root / name / 'result/proof.json')
        proc = read(root / name / 'process.json')
        assert proc['exitCode'] == 0 and proc['scriptSHA256Before'] == proc['scriptSHA256After'] == sha(repo / 'scripts/check-three-column-owner-snapshot-scope.mjs')
        assert p['mode'] == mode and p['positiveCases'] == 10 and p['excludedCases'] == 42 and p['queryReadOnlyCases'] == 52
        assert p['sourceFilesUnchanged'] == 10
        scopes[mode] = {'positiveCases': 10, 'excludedCases': 42, 'queryReadOnlyCases': 52,
                        'proofSHA256': sha(root / name / 'result/proof.json'), 'processSHA256': sha(root / name / 'process.json')}
    width_process = read(root / 'native-svg-width-process.json')
    assert width_process['scriptSHA256Before'] == width_process['scriptSHA256After'] == sha(repo / 'scripts/check-three-column-owner-native-evidence.py')
    assert len(width_process['runs']) == 2 and all(r['exitCode'] == 0 for r in width_process['runs'])
    widths = []
    for name in ['native-source-svg-width-proof.json', 'native-boundary-svg-width-proof.json']:
        p = read(root / name)
        assert p['cases'] == len(p['rows']) and all(r['sourceOwnershipIssues'] == r['warnings'] == r['emptyHeaderOnlyFragments'] == 0 and r['cutContinuityExact'] for r in p['rows'])

        directory = root / ('native-fixtures-2' if p['cases'] == 10 else 'native-completion')
        for row in p['rows']:
            case = directory / (row['label'] + '-' + row['format'])
            assert sha(case / 'ledger.json') == row['ledgerSHA256']
            seed_path = root / ('seeds/seeds.json' if p['cases'] == 10 else 'completion-seeds-2/seeds.json')
            seeds = {s['label']: s for s in read(seed_path)}
            assert sha(seeds[row['label']]['files'][row['format']]) == row['sourceSHA256']
            assert sha(directory / (row['label'] + '-' + row['format'] + '.log')) == row['cutLogSHA256']
        widths.extend(p['rows'])
    builds = [read(root / n) for n in ['native-build-proof.json', 'wasm-build-proof.json']]
    assert all(b['exitCode'] == 0 and not b['stoppedForBudget'] and b['targetPeakBytes'] <= 5078798827 and b['freeMinimumObservedBytes'] >= required for b in builds)
    target = root.parent / 'style-lint-qa/target'
    target_size = int(subprocess.check_output(['du', '-sk', str(target)]).split()[0]) * 1024
    free = shutil.disk_usage(root).free
    assert target_size <= 5078798827 and free >= required
    desktop = read(root / 'desktop-test-new-engine-process.json')
    assert desktop['exitCode'] == 0 and desktop['engineSHA256Before'] == desktop['engineSHA256After'] == wasm
    assert desktop['logSHA256'] == sha(root / 'desktop-test-new-engine.log')
    interrupted = read(root / 'three-long-middle-all-history/session-loss-checkpoint.json')
    assert interrupted['fullPhaseCountsExcluded'] and not interrupted['willQuitAuditPresent']
    out = {'schema': 1, 'verifiedUTC': datetime.datetime.now(datetime.timezone.utc).isoformat(),
           'scope': 'Mac source-QA Electron 44.3.0; no new packaged app or release',
           'startingCommit': '166deb11997ce81cd524e26691ed2541f9e9c1cd',
           'verifiedCheckoutCommit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip(),
           'wasmSHA256': wasm, 'nativeSHA256': native,
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
           'sourceAndBoundaryProofSHA256': {n: sha(root / n) for n in ['native-source-svg-width-proof.json', 'native-boundary-svg-width-proof.json', 'native-svg-width-process.json', 'row-bounds/proof.json', 'seeds/fixture-proof.json', 'completion-seeds-2/source-proof.json', 'desktop-test-new-engine-process.json', 'desktop-test-new-engine.log', 'desktop-test-process.json', 'desktop-test.log', 'native-build-proof.json', 'native-build.log', 'wasm-build-proof.json', 'wasm-build.log', 'syntax-node-process.json']},
           'protectedASARs': {Path(p).parts[-5] + '/' + Path(p).parts[-4]: h for p,h in protected.items()},
           'approvedZIPUnchangedSHA256': zip_sha, 'publicationAttempted': False,
           'budget': {'targetLimitBytes': 5078798827, 'requiredFreeBytes': required,
                      'buildTargetMaximumObservedBytes': max(b['targetPeakBytes'] for b in builds),
                      'currentTargetBytes': target_size, 'currentFreeBytes': free,
                      'minimumObservedFreeBytes': min([b['freeMinimumObservedBytes'] for b in builds] + [p['minimumObservedFreeBytes'] for p in phases])},
           'interruptedPhaseExcluded': 'three-long-middle-all-history',
           'sourceSHA256': {str(p.relative_to(repo)): sha(p) for p in [repo / 'engine/src/renderer/float_placement.rs', *sorted((repo / 'scripts').glob('*three-column-owner*')), repo / 'engine/examples/three_column_owner_check.rs', repo / 'engine/examples/mixed_table_owner_probe.rs', repo / 'engine/examples/horizontal_table_saved_check.rs'] if p.is_file()},
           'phases': phases}
    assert len(out['protectedASARs']) == 14
    output.write_text(json.dumps(out, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({k: out[k] for k in ['cases', 'historyPairs', 'reopens', 'nativeComparisons', 'normalQuitPhases', 'paintChecks', 'paintPages', 'maximumBorderOverflowPx', 'maximumInkOverflowPx', 'budget']}, ensure_ascii=False))


if __name__ == '__main__':
    main()

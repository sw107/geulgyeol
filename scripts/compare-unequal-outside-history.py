"""Compare completed unequal outside-cell HWP/HWPX Electron evidence.

Usage: HWP_DELETE_PHASE HWP_MIXED_PHASE HWPX_PHASE FRESH_COMPARISON_PHASE [--observe-preexisting-wrap]
Compare full SVG/model states; exported binary digests are format provenance.
Requires GEULGYEOL_QA_BUDGET_ROOT. Prior evidence is read only.
"""
import sys
sys.dont_write_bytecode = True
from pathlib import Path
import gzip
import hashlib
import itertools
import json
from importlib.util import spec_from_file_location, module_from_spec
from native_qa_budget import BudgetClient


def sha(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def comparable(state):
    return {key: value for key, value in state.items() if key not in ['hwp', 'hwpx']}


def main():
    assert len(sys.argv) in [5, 6], __doc__
    observe = len(sys.argv) == 6
    if observe:
        assert sys.argv[5] == '--observe-preexisting-wrap'
    delete, mixed, equivalent, output = [Path(p).resolve() for p in sys.argv[1:5]]
    assert not output.exists(), 'fresh comparison phase required'
    output.mkdir()
    budget = BudgetClient(output, normal_forecast=1048576, failure_forecast=16384)
    pins = {}
    wrap_observations = []
    source_before = sha(Path(__file__))

    def read(path):
        budget.check()
        pins[path] = sha(path)
        with (gzip.open(path, 'rt') if path.suffix == '.gz' else path.open()) as stream:
            return json.load(stream)

    def compare_mixed(x, y, label, permitted=False):
        if comparable(x) == comparable(y):
            return
        assert observe and permitted, 'mixed full model/SVG ' + label
        model = lambda v: {k: value for k, value in comparable(v).items() if k not in ['svg', 'cellRendered']}
        assert model(x) == model(y), 'logical model differs ' + label
        assert len(x['svg']) == len(y['svg'])
        pages = [i for i, (a, b) in enumerate(zip(x['svg'], y['svg'])) if a != b]
        assert pages == [12], 'unexpected page difference ' + label
        assert all(a == b for i, (a, b) in enumerate(zip(x['cellRendered'], y['cellRendered'])) if i != 12)
        wrap_observations.append({'label': label, 'differentPages': pages, 'logicalModelExact': True,
                                  'HwpSVG': x['svg'][12], 'HwpxSVG': y['svg'][12]})

    ap, bp = 'partial-unequal-left-input.hwp', 'partial-unequal-left-input.hwpx'
    try:
        for phase in [delete, mixed, equivalent]:
            process = read(phase / 'harness-process.json')
            assert process['nodeHarnessExitCode'] == process['appExitCode'] == 0
            assert process['appNormalQuit'] and process['qaSourcesUnchanged'] and process['sourceSeedsUnchanged']
            assert read(phase / 'qa-evidence-status.json')['outcome'] == 'complete'
        a = read(delete / (ap + '-direct-delete-0-state.json.gz'))
        b = read(equivalent / (bp + '-direct-delete-0-state.json.gz'))
        for name in ['before', 'after']:
            assert comparable(a[name]) == comparable(b[name]), 'Delete cross-format ' + name
        assert a['before']['cells'][40]['info'] == {'row': 47, 'col': 2, 'rowSpan': 1, 'colSpan': 1}
        assert a['before']['cells'][40]['needsTextSnapshot']
        assert a['after']['cells'][40]['paras'][0]['text'] == a['before']['cells'][40]['paras'][0]['text'][1:], 'first character deleted'
        for cycle in range(2):
            for operation in ['undo', 'redo']:
                tail = '-direct-delete-0-' + operation + str(cycle) + '.json.gz'
                x, y = read(delete / (ap + tail)), read(equivalent / (bp + tail))
                assert comparable(x) == comparable(y), 'Delete cross-format ' + tail
                assert comparable(x) == comparable(a['before' if operation == 'undo' else 'after']), 'Delete exact ' + tail
        assert comparable(read(mixed / (ap + '-initial-state.json.gz'))) == comparable(a['before'])
        for i in range(6):
            tail = '-mixed-step-' + str(i) + '-state.json.gz'
            x, y = read(mixed / (ap + tail)), read(equivalent / (bp + tail))
            compare_mixed(x['after'], y['after'], tail, permitted=i in [2, 3])
            assert x['history'] == y['history'] and x['step'] == y['step']
        for cycle in range(2):
            for operation, steps in [('undo', range(6)), ('redo', range(1, 7))]:
                for i in steps:
                    tail = '-mixed-' + operation + '-' + str(cycle) + '-' + str(i) + '-state.json.gz'
                    x, y = read(mixed / (ap + tail)), read(equivalent / (bp + tail))
                    compare_mixed(x, y, tail, permitted=i in [3, 4])
        x, y = read(mixed / (ap + '-mixed-burst-state.json.gz')), read(equivalent / (bp + '-mixed-burst-state.json.gz'))
        assert comparable(x['after']) == comparable(y['after']) and x['history'] == y['history'], 'burst final full model/SVG'
        # Pending observations are scheduling observations; final states are exact.
        spec = spec_from_file_location('manifest_reader', Path(__file__).with_name('shard-electron-table-manifest.py'))
        reader = module_from_spec(spec)
        spec.loader.exec_module(reader)
        left = []
        for phase in dict.fromkeys([delete, mixed]):
            path = phase / 'manifest.json.gz'
            pins[path] = sha(path)
            left.extend(reader.rows(path))
        path = equivalent / 'manifest.json.gz'
        pins[path] = sha(path)
        saves = 0
        for x, y in itertools.zip_longest(left, reader.rows(path)):
            budget.check()
            assert x is not None and y is not None, 'same save plan cardinality'
            xf, yf = Path(x.pop('file')).name, Path(y.pop('file')).name
            assert xf.replace('-hwp-', '-hwpx-') == yf and x == y, 'saved full model/SVG ' + xf
            saves += 1
        assert saves == 6 and all(sha(path) == pin for path, pin in pins.items())
        assert sha(Path(__file__)) == source_before, 'comparison source unchanged'
        result = {'sameFullInitialModelSVG': True, 'sameFullDeleteModelSVG': True, 'firstCharacterActuallyDeleted': True,
                  'sameMixedIntermediateLogicalModel': True, 'sameMixedIntermediateModelSVG': not wrap_observations,
                  'sameMixedUndoRedoModelSVG': not wrap_observations, 'sameBurstFinalModelSVG': True,
                  'preexistingCrossFormatWrapObservations': wrap_observations,
                  'sameSavedModelSVGComparisons': saves, 'binaryDigestEqualityRequired': False, 'timingObservationEqualityRequired': False,
                  'sourceSHA256': sha(Path(__file__)), 'inputEvidenceSHA256': {str(path): pin for path, pin in pins.items()}}
        payload = json.dumps(result, indent=2) + '\n'
        budget.check(len(payload.encode()))
        (output / 'proof.json').write_text(payload)
        budget.mark('complete')
        print(json.dumps({key: value for key, value in result.items() if key != 'inputEvidenceSHA256'}))
    except BaseException as error:
        (output / 'failure.json').write_text(json.dumps({'failure': str(error)[:2048]}) + '\n')
        budget.mark('failed')
        raise
    finally:
        budget.close()


if __name__ == '__main__':
    main()

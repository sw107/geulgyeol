#!/usr/bin/env python3
"""Prove run/paragraph reordering is rejected before any sorting.

Usage: check-owner-run-order-negative.py FRESH_OUTPUT
Uses tiny synthetic data only. Each reordered worker must exit nonzero.
"""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys


def document():
    owners = [{'cell': i, 'header': True, 'rowStart': 0, 'paragraphs': ['H'+str(i)]} for i in range(3)]
    owners.append({'cell': 3, 'header': False, 'rowStart': 1, 'paragraphs': ['AB', 'CD']})
    def run(cell, para, start, text):
        return {'cellPath': [{}], 'cellIdx': cell, 'controlIdx': 0, 'parentParaIdx': 0,
                'cellParaIdx': para, 'charStart': start, 'text': text}
    runs = [run(i, 0, j, text) for i in range(3) for j, text in enumerate('H'+str(i))]
    runs += [run(3, i, j, text) for i, value in enumerate(['AB', 'CD']) for j, text in enumerate(value)]
    return {'target': {'para': 0, 'control': 0}, 'owners': owners, 'pages': [{'page': 0, 'text': {'runs': runs}}]}


def reordered(kind):
    value = document()
    runs = value['pages'][0]['text']['runs']
    if kind == 'within-paragraph': runs[6], runs[7] = runs[7], runs[6]
    elif kind == 'paragraph-order': runs[6:10] = runs[8:10] + runs[6:8]
    elif kind == 'header-order': runs[0], runs[1] = runs[1], runs[0]
    else: raise AssertionError(kind)
    return value


def load(file):
    sys.dont_write_bytecode = True
    spec = importlib.util.spec_from_file_location('ordered_owner_check', file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def digest(file):
    return hashlib.sha256(Path(file).read_bytes()).hexdigest()


def main():
    root = Path(__file__).resolve().parent.parent
    if sys.argv[1] == '--worker':
        load(sys.argv[2]).check_ownership(reordered(sys.argv[3]))
        raise AssertionError('reordered output was accepted')
    out = Path(sys.argv[1]); assert not out.exists(); out.mkdir()
    historical_source = subprocess.check_output(['git', 'show', 'e1c59bb87d29f4251f5a48943527456e710f5b28:scripts/check-three-column-owner-native-evidence.py'], cwd=root).decode()
    historical = {'__name__': 'historical_owner_checker'}
    exec(compile(historical_source, 'PR14-historical-owner-checker', 'exec'), historical)
    rows = []
    for name in ['check-three-column-owner-native-evidence.py', 'check-colspan-two-owner-native-evidence.py']:
        file = root / 'scripts' / name; before = digest(file); module = load(file)
        module.check_ownership(document())
        for kind in ['within-paragraph', 'paragraph-order', 'header-order']:
            historical['check_ownership'](reordered(kind))
            command = [sys.executable, str(Path(__file__).resolve()), '--worker', str(file), kind]
            result = subprocess.run(command, capture_output=True, text=True)
            log = out / (file.stem+'-'+kind+'.log'); log.write_text(result.stdout+result.stderr)
            assert result.returncode != 0 and 'original-owner-run-order' in result.stderr, kind
            rows.append({'checker': name, 'case': kind, 'historicalSortingCheckerAccepted': True,
                         'actualProcessExitCode': result.returncode, 'orderDiagnosticPresent': True,
                         'logSHA256': digest(log), 'checkerSHA256': before})
        assert before == digest(file)
    proof = {'positiveSyntheticCases': 2, 'negativeActualProcessCases': len(rows),
             'historicalSourceSHA256': hashlib.sha256(historical_source.encode()).hexdigest(), 'rows': rows}
    (out/'proof.json').write_text(json.dumps(proof, indent=2)+'\n')
    print(json.dumps(proof))


if __name__ == '__main__':
    main()

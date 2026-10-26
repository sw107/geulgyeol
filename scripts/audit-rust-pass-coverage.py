#!/usr/bin/env python3
"""Read-only audit of the frozen PR #116 logs. Never runs Rust or infers coverage from ok."""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import re
import sys


MARKER = re.compile(r'\bskip\b|건너뜀|파일 없음|표본 없음|file not found', re.I)
CASE = re.compile(r'^test (\S+?)(?: - should panic)? \.\.\. (.*)$')
TERMINAL = re.compile(r'^(ok|FAILED|ignored)(?:, .*)?$')
CLASSES = {'early-return-before-contract', 'all-inputs-skipped',
           'helper-inputs-skipped', 'diagnostic-preflight-only', 'partial-contract-checked',
           'contract-checked', 'guarded-path-unresolved'}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def parse_cases(text):
    """Serial pretty output, including --nocapture's split terminal line.

    Failure diagnostic blocks are outside case segments. An aborted final case may
    stay incomplete; it is never a pass. This is not a general concurrent parser.
    """
    cases = {}
    pending = None
    output = []
    for line in text.splitlines():
        match = CASE.fullmatch(line)
        if match:
            require(pending is None, 'Unterminated/overlapping libtest case')
            pending, suffix = match.groups()
            require(pending not in cases, 'Duplicate libtest case: ' + pending)
            output = []
            terminal = TERMINAL.fullmatch(suffix)
            if not terminal:
                output.append(suffix)
                continue
        elif pending is not None:
            terminal = TERMINAL.fullmatch(line)
            if not terminal:
                output.append(line)
                continue
        else:
            continue
        cases[pending] = {'status': {'ok': 'passed', 'FAILED': 'failed',
                                    'ignored': 'ignored'}[terminal[1]],
                          'output': '\n'.join(output)}
        pending = None
    return cases


def audit(root, review):
    require(review['schemaVersion'] == 1, 'Unsupported review schema')
    cache = {}
    pins = {}

    def read(relative):
        # Paths may point at the retained, read-only supplemental source overlay.
        require(not Path(relative).is_absolute() and '..' not in Path(relative).parts,
                'Expected a relative evidence path')
        if relative not in cache:
            cache[relative] = (root / relative).read_bytes()
            pins[relative] = digest(cache[relative])
        return cache[relative]

    for relative, expected in review['pins'].items():
        require(digest(read(relative)) == expected, 'Evidence/source hash changed: ' + relative)
    core = json.loads(read('core-final-outcomes.json'))
    integrations = json.loads(read('integration-target-results.json'))
    require(core['planned'] == len(core['byName']), 'Core inventory size mismatch')
    require(dict(Counter(x['status'] for x in core['byName'].values())) == core['rawStatuses'],
            'Core raw counts mismatch')
    rows = []
    keys = set()
    parsed = {}

    def append(scope, target, name, value):
        key = (scope, target, name)
        require(key not in keys, 'Duplicate outcome: ' + str(key))
        keys.add(key)
        if value['status'] != 'passed':
            return
        log = value.get('evidence', value.get('log'))
        if log not in parsed:
            parsed[log] = parse_cases(read(log).decode('utf-8'))
        observed = parsed[log].get(name)
        require(observed is not None and observed['status'] == 'passed',
                'Indexed pass missing from raw libtest log: ' + str(key))
        markers = [line for line in observed['output'].splitlines() if MARKER.search(line)]
        rows.append({'scope': scope, 'target': target, 'name': name,
                     'rawStatus': 'passed', 'log': log, 'markers': markers,
                     'coverage': 'unreviewed',
                     'reason': 'No reviewed contract-path evidence; no marker is not proof of execution'})

    for name, value in core['byName'].items():
        append('core', 'lib', name, value)
    targets = set()
    for target in integrations:
        require(target['target'] not in targets, 'Duplicate integration target')
        targets.add(target['target'])
        for name, value in target.get('outcomes', {}).items():
            append('integration', target['target'], name, value)

    by_key = {(r['scope'], r['target'], r['name']): r for r in rows}
    seen = set()
    for item in review['reviews']:
        key = (item['scope'], item['target'], item['name'])
        require(key in by_key and key not in seen, 'Unknown/duplicate reviewed pass: ' + str(key))
        seen.add(key)
        row = by_key[key]
        require(item['coverage'] in CLASSES, 'Unknown coverage class')
        require(row['log'] == item['log'] and row['log'] in review['pins'], 'Unpinned review log')
        require(row['markers'] == item['markers'], 'Reviewed markers changed: ' + str(key))
        require(item['sources'], 'Review needs source evidence')
        for source in item['sources']:
            require(source['path'] in review['pins'], 'Unpinned source')
            lines = read(source['path']).decode('utf-8').splitlines()
            require(1 <= source['start'] <= source['end'] <= len(lines), 'Invalid source range')
        require(item['reason'].strip(), 'Review needs a reason')
        row.update(coverage=item['coverage'], reason=item['reason'], sources=item['sources'])

    summaries = {}
    for scope in ('core', 'integration'):
        scoped = [r for r in rows if r['scope'] == scope]
        summaries[scope] = {
            'rawPasses': len(scoped),
            'coverage': dict(sorted(Counter(r['coverage'] for r in scoped).items())),
            'markerCandidates': sum(bool(r['markers']) for r in scoped),
            'unreviewedMarkerCandidates': sum(bool(r['markers']) and r['coverage'] == 'unreviewed'
                                             for r in scoped),
        }
    return {'schemaVersion': 1, 'validationHead': review['validationHead'],
            'meaning': 'Raw libtest outcomes retained; coverage is a separate reviewed evidence axis. '
                       'Unreviewed is neither pass nor unexecution; counts are not a new Rust run.',
            'coreRawStatuses': core['rawStatuses'],
            'integrationRawStatuses': dict(Counter(v['status'] for t in integrations
                                                  for v in t.get('outcomes', {}).values())),
            'integrationTargetStates': dict(Counter(t['status'] for t in integrations)),
            'summary': summaries, 'passes': rows, 'sha256': dict(sorted(pins.items()))}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('evidence_root', type=Path)
    parser.add_argument('--review', type=Path, default=Path(__file__).resolve().parents[1]
                        / 'docs/qa/rust-pass-coverage-review.json')
    args = parser.parse_args()
    try:
        result = audit(args.evidence_root, json.loads(args.review.read_text()))
    except (OSError, ValueError, KeyError, TypeError) as error:
        print('Audit incomplete: ' + str(error), file=sys.stderr)
        return 1
    # Zero only means the evidence audit completed, never that Rust tests passed.
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    sys.exit(main())

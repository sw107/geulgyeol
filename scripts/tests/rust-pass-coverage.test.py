"""Offline regressions: no Rust, real corpus, GUI or dependency installation."""
from copy import deepcopy
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location(
    'coverage_audit', Path(__file__).resolve().parents[1] / 'audit-rust-pass-coverage.py')
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def log(cases):
    return 'running %d tests\n%s\ntest result: ok. synthetic summary\n' % (
        len(cases), '\n'.join('test %s ... %s' % case for case in cases))


class CoverageTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.write('source.rs', 'fn fixture() { /* independently reviewed path */ }\n')
        self.write('core.log', log([('early', 'SKIP: sample 없음\nok'),
                                    ('silent', 'ok'),
                                    ('partial', 'first contract checked\nSKIP: second sample 없음\nok')]))
        self.write('integration.log', log([('negative', 'ok'), ('guarded', 'ok')]))
        self.core = {'planned': 5, 'rawStatuses': {'passed': 3, 'failed': 1, 'ignored': 1},
                     'byName': {name: {'status': status, 'evidence': 'core.log'}
                                for name, status in [('early', 'passed'), ('silent', 'passed'),
                                                     ('partial', 'passed'), ('failed', 'failed'),
                                                     ('ignored', 'ignored')]}}
        self.integrations = [
            {'target': 'suite', 'status': 'passed', 'outcomes': {
                name: {'status': 'passed', 'log': 'integration.log'}
                for name in ['negative', 'guarded']}},
            {'target': 'compile-input', 'status': 'unavailable-compile-input'},
            {'target': 'zero', 'status': 'compiled-zero-tests-not-a-pass'}]
        self.write('core-final-outcomes.json', json.dumps(self.core))
        self.write('integration-target-results.json', json.dumps(self.integrations))
        self.review = {'schemaVersion': 1, 'validationHead': 'frozen-head', 'pins': {}, 'reviews': []}

    def write(self, name, text):
        (self.root / name).write_text(text)

    def pin(self, name):
        self.review['pins'][name] = hashlib.sha256((self.root / name).read_bytes()).hexdigest()

    def review_case(self, name, coverage, scope='core', markers=None):
        target = 'lib' if scope == 'core' else 'suite'
        evidence = 'core.log' if scope == 'core' else 'integration.log'
        self.pin(evidence)
        self.pin('source.rs')
        self.review['reviews'].append({
            'scope': scope, 'target': target, 'name': name, 'coverage': coverage,
            'log': evidence, 'markers': markers or [], 'reason': 'Source branch and captured path reviewed',
            'sources': [{'path': 'source.rs', 'start': 1, 'end': 1}]})

    def audit(self):
        return MODULE.audit(self.root, self.review)

    def test_marker_is_candidate_and_silent_ok_stays_unreviewed(self):
        report = self.audit()
        self.assertEqual(report['summary']['core']['coverage'], {'unreviewed': 3})
        self.assertEqual(report['summary']['core']['markerCandidates'], 2)
        self.assertEqual(report['summary']['integration']['coverage'], {'unreviewed': 2})
        self.assertNotIn('passed', report)  # no aggregate Rust success bit
        self.assertEqual(report['coreRawStatuses'], self.core['rawStatuses'])

    def test_review_distinguishes_early_partial_and_actual_negative_contract(self):
        self.review_case('early', 'early-return-before-contract', markers=['SKIP: sample 없음'])
        self.review_case('partial', 'partial-contract-checked', markers=['SKIP: second sample 없음'])
        self.review_case('negative', 'contract-checked', 'integration')
        report = self.audit()
        self.assertEqual(report['summary']['core']['rawPasses'], 3)
        self.assertEqual(report['summary']['core']['coverage'], {
            'early-return-before-contract': 1, 'partial-contract-checked': 1, 'unreviewed': 1})
        self.assertEqual(report['summary']['integration']['coverage'],
                         {'contract-checked': 1, 'unreviewed': 1})
        self.assertEqual(report['integrationTargetStates']['unavailable-compile-input'], 1)
        self.assertEqual(report['integrationTargetStates']['compiled-zero-tests-not-a-pass'], 1)

    def test_all_candidates_do_not_become_contract_passes_by_subtraction(self):
        self.review_case('early', 'early-return-before-contract', markers=['SKIP: sample 없음'])
        self.review_case('partial', 'diagnostic-preflight-only', markers=['SKIP: second sample 없음'])
        result = self.audit()['summary']['core']
        self.assertEqual(result['unreviewedMarkerCandidates'], 0)
        self.assertEqual(result['coverage']['unreviewed'], 1)
        self.assertNotIn('contract-checked', result['coverage'])

    def test_stale_source_or_log_fails_instead_of_using_old_review(self):
        for name in ['source.rs', 'core.log']:
            with self.subTest(name=name):
                original = (self.root / name).read_bytes()
                self.pin(name)
                self.write(name, 'changed')
                with self.assertRaisesRegex(ValueError, 'hash changed'):
                    self.audit()
                (self.root / name).write_bytes(original)

    def test_unknown_duplicate_or_unpinned_reviews_fail(self):
        self.review_case('early', 'early-return-before-contract', markers=['SKIP: sample 없음'])
        good = deepcopy(self.review)
        for mode in ['name', 'class', 'duplicate', 'log-pin', 'source-pin', 'marker', 'range']:
            with self.subTest(mode=mode):
                self.review = deepcopy(good)
                item = self.review['reviews'][0]
                if mode == 'name': item['name'] = 'unplanned'
                elif mode == 'class': item['coverage'] = 'assume-pass'
                elif mode == 'duplicate': self.review['reviews'].append(deepcopy(item))
                elif mode == 'log-pin': del self.review['pins']['core.log']
                elif mode == 'source-pin': del self.review['pins']['source.rs']
                elif mode == 'marker': item['markers'] = []
                elif mode == 'range': item['sources'][0]['end'] = 20
                with self.assertRaises(ValueError): self.audit()

    def test_missing_log_missing_case_and_truncation_fail(self):
        for text in ['', log([('early', 'ok')]), 'running 1 test\ntest early ... SKIP: missing\n']:
            self.write('core.log', text)
            with self.assertRaisesRegex(ValueError, 'pass missing'):
                self.audit()
        (self.root / 'core.log').unlink()
        with self.assertRaises(OSError): self.audit()

    def test_failed_diagnostics_do_not_leak_into_later_pass(self):
        parsed = MODULE.parse_cases('running 2 tests\ntest a ... FAILED\ntest b ... ok\n'
                                    '\nfailures:\n---- a stdout ----\nSKIP: missing\n')
        self.assertEqual(parsed['b'], {'status': 'passed', 'output': ''})

    def test_no_capture_marker_negative_contract_requires_review_too(self):
        self.write('integration.log', log([('negative', 'File not found: deliberately absent\nok'),
                                          ('guarded', 'ok')]))
        self.assertEqual(self.audit()['summary']['integration']['coverage'], {'unreviewed': 2})
        self.review_case('negative', 'contract-checked', 'integration',
                         ['File not found: deliberately absent'])
        self.assertEqual(self.audit()['summary']['integration']['coverage']['contract-checked'], 1)

    def test_reviewed_guard_stays_uncertain_even_with_no_marker(self):
        self.review_case('guarded', 'guarded-path-unresolved', 'integration')
        result = self.audit()['summary']['integration']
        self.assertEqual(result['coverage'], {'guarded-path-unresolved': 1, 'unreviewed': 1})
        self.assertEqual(result['markerCandidates'], 0)
        self.assertNotIn('contract-checked', result['coverage'])

    def test_inventory_count_mismatch_and_duplicate_targets_fail(self):
        self.core['planned'] = 6
        self.write('core-final-outcomes.json', json.dumps(self.core))
        with self.assertRaisesRegex(ValueError, 'inventory size'): self.audit()
        self.core['planned'] = 5
        self.write('core-final-outcomes.json', json.dumps(self.core))
        self.integrations.append(deepcopy(self.integrations[0]))
        self.write('integration-target-results.json', json.dumps(self.integrations))
        with self.assertRaisesRegex(ValueError, 'Duplicate integration target'): self.audit()

    def test_audit_leaves_all_input_bytes_unchanged(self):
        self.review_case('early', 'early-return-before-contract', markers=['SKIP: sample 없음'])
        before = {p.name: p.read_bytes() for p in self.root.iterdir()}
        self.audit()
        after = {p.name: p.read_bytes() for p in self.root.iterdir()}
        self.assertEqual(after, before)

    def test_should_panic_and_ignored_names_preserved(self):
        parsed = MODULE.parse_cases('test a - should panic ... ok\ntest b ... ignored, needs fixture\n')
        self.assertEqual(parsed['a']['status'], 'passed')
        self.assertEqual(parsed['b']['status'], 'ignored')

    def test_duplicate_or_overlapping_case_is_rejected(self):
        for text in ['test a ... ok\ntest a ... ok\n',
                     'test a ... incomplete\ntest b ... ok\n']:
            with self.assertRaises(ValueError): MODULE.parse_cases(text)


if __name__ == '__main__':
    unittest.main()

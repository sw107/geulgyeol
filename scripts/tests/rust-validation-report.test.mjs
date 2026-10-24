import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {test} from 'node:test';
import {summarizeValidation} from '../summarize-validation.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'geulgyeol-rust-report-'));
console.log(`Synthetic Rust evidence preserved: ${dir}`);
const cli = path.resolve(import.meta.dirname, '../summarize-validation.mjs');
const planned = {id: 'contracts', required: true, kind: 'rust-libtest', tests: ['module::a', 'module::b']};
const plan = checks => ({version: 1, checks});
let next = 0;
function log({a = 'ok', b = 'ok', filtered = 0} = {}) {
  const outcomes = [a, b].filter(Boolean);
  return `    Finished test profile\nrunning ${outcomes.length} tests\n`
    + (a ? `test module::a ... ${a}\n` : '') + (b ? `test module::b ... ${b}\n` : '')
    + `\ntest result: ${outcomes.includes('FAILED') ? 'FAILED' : 'ok'}. `
    + `${outcomes.filter(x => x === 'ok').length} passed; ${outcomes.filter(x => x === 'FAILED').length} failed; `
    + `${outcomes.filter(x => x.startsWith('ignored')).length} ignored; 0 measured; ${filtered} filtered out; finished in 0.01s\n`;
}
function summarize(text = log(), exitCode = 0, check = planned) {
  const evidence = path.join(dir, `${next++}.log`); fs.writeFileSync(evidence, text);
  return summarizeValidation(plan([check]), {version: 1, results: [{id: check.id, exitCode, evidence}]});
}

test('complete inventoried native cases pass with counts separate from Node files', () => {
  const result = summarize();
  assert.equal(result.passed, true); assert.equal(result.testCountsComplete, true);
  assert.deepEqual(result.tests, {passed: 2, failed: 0, unavailable: 0, excluded: 0});
  assert.deepEqual(result.fileCounts, {passed: 0, failed: 0, unavailable: 0, excluded: 0});
  assert.equal(result.checks[0].testCases.length, 2);
});

test('exit zero with zero tests or partial filtering never passes', () => {
  for (const text of [log({a: null, b: null, filtered: 2}), log({b: null, filtered: 1}), log({b: null})]) {
    const result = summarize(text);
    assert.equal(result.passed, false); assert.equal(result.testCountsComplete, false);
    assert.equal(result.checks[0].status, 'unavailable');
    assert.ok(result.checks[0].testCases.some(t => t.name === 'module::b' && t.status === 'unavailable'));
  }
});

test('missing result, missing log, compile failure and truncated output are unavailable, not body failures', () => {
  const missing = summarizeValidation(plan([planned]), {version: 1, results: []});
  const noFile = summarizeValidation(plan([planned]), {version: 1, results: [{id: planned.id, exitCode: 0, evidence: path.join(dir, 'absent')}]});
  for (const result of [missing, noFile, summarize('error: missing compile-time input\n', 101), summarize(log().split('test result:')[0])]) {
    assert.equal(result.passed, false); assert.equal(result.testCountsComplete, false);
    assert.equal(result.checks[0].status, 'unavailable'); assert.equal(result.tests.failed, 0);
  }
});

test('ignored tests stay excluded and required explicit unexecution blocks success', () => {
  const result = summarize(log({b: 'ignored, requires unavailable fixture'}));
  assert.equal(result.passed, false); assert.equal(result.checks[0].status, 'excluded');
  assert.equal(result.tests.excluded, 1);
  for (const status of ['excluded', 'unavailable']) {
    const report = summarizeValidation(plan([planned]), {version: 1, results: [{id: planned.id, status, reason: 'not run'}]});
    assert.equal(report.passed, false); assert.equal(report.testCountsComplete, false);
  }
});

test('assertion failures and process failures are preserved even with missing cases', () => {
  const failed = summarize(log({a: 'FAILED', b: null, filtered: 1}), 101);
  assert.equal(failed.checks[0].status, 'failed'); assert.equal(failed.passed, false);
  assert.deepEqual(failed.tests, {passed: 0, failed: 1, unavailable: 1, excluded: 0});
  assert.equal(summarize(log({a: 'FAILED'}), 0).passed, false, 'body failure survives a wrong supplied exit zero');
  assert.equal(summarize(log(), 7).checks[0].status, 'failed');
});

test('optional nonzero process exit still blocks success when Rust evidence is corrupt', () => {
  const evidence = path.join(dir, 'empty.log'); fs.writeFileSync(evidence, '');
  const result = summarizeValidation(plan([{id: 'types', kind: 'command', required: true}, {...planned, required: false}]),
    {version: 1, results: [{id: 'types', exitCode: 0, evidence}, {id: planned.id, exitCode: 7, evidence}]});
  assert.equal(result.passed, false); assert.deepEqual(result.failedProcesses, [planned.id]);
  assert.equal(result.checks[1].status, 'unavailable'); assert.equal(result.tests.failed, 0);
});

test('multiple targets, summary-only, duplicate/unplanned cases and contradictory counts are rejected', () => {
  for (const text of [log() + log(), log().replace('test module::b ... ok\n', ''),
    log().replace('module::b', 'module::a'), log().replace('module::b', 'other::b'),
    log().replace('2 passed', '3 passed'), log().replace('running 2', 'running 1'),
    log().replace('test result: ok', 'test result: FAILED'), log().replace('0 measured', '1 measured'),
    log() + 'test module::a ... ok\n', log().replace('test module::a ... ok', 'test module::a ... something else')]) {
    const result = summarize(text);
    assert.equal(result.passed, false, text); assert.equal(result.checks[0].status, 'unavailable', text);
  }
});

test('unexpected filtered tests prevent success even when all inventoried names appear', () => {
  assert.equal(summarize(log({filtered: 1})).passed, false);
});

test('Rust plan cannot omit its inventory or contain duplicate names', () => {
  for (const tests of [undefined, [], [''], ['a', 'a']]) {
    assert.throws(() => summarizeValidation(plan([{...planned, tests}]), {version: 1, results: []}), /inventory|Duplicate/);
  }
});

test('CLI resolves Rust log relative to results and exits 1 for omitted/zero-test/failed work', () => {
  const planPath = path.join(dir, 'plan.json'), resultsPath = path.join(dir, 'results.json');
  fs.writeFileSync(planPath, JSON.stringify(plan([planned])));
  const invoke = results => {
    fs.writeFileSync(resultsPath, JSON.stringify({version: 1, results}));
    return spawnSync(process.execPath, [cli, planPath, resultsPath], {encoding: 'utf8', cwd: os.tmpdir()});
  };
  for (const [name, text, exitCode, expected] of [
    ['pass', log(), 0, 0], ['zero', log({a: null, b: null, filtered: 2}), 0, 1],
    ['failed', log({a: 'FAILED'}), 101, 1], ['compile', 'error: input missing\n', 101, 1],
  ]) {
    fs.writeFileSync(path.join(dir, `${name}.log`), text);
    const child = invoke([{id: planned.id, exitCode, evidence: `${name}.log`}]);
    assert.equal(child.status, expected, child.stdout);
    assert.equal(JSON.parse(child.stdout).passed, expected === 0);
  }
  assert.equal(invoke([]).status, 1);
});

test('optional Rust unexecution stays visible and incomplete without changing optional policy', () => {
  const evidence = path.join(dir, 'command.log'); fs.writeFileSync(evidence, 'typecheck completed');
  const result = summarizeValidation(plan([{id: 'types', kind: 'command', required: true}, {...planned, required: false}]),
    {version: 1, results: [{id: 'types', exitCode: 0, evidence}]});
  assert.equal(result.passed, true);
  assert.equal(result.testCountsComplete, false);
  assert.equal(result.checks[1].status, 'unavailable');
  assert.deepEqual(result.counts, {passed: 1, failed: 0, unavailable: 1, excluded: 0});
  assert.equal(result.tests.passed, 0, 'do not infer unobserved Rust bodies');
});

// Captured from the included synthetic sources with native Rust 1.93.1.
// Reading the exact stdout keeps these regressions runnable without Rust installed.
const nativeOutput = JSON.parse(fs.readFileSync(new URL('./fixtures/rust-libtest-output.json', import.meta.url))).cases;
function summarizeNative(name) {
  const captured = nativeOutput[name];
  return summarize(captured.stdout, captured.exitCode, {...planned, tests: captured.tests});
}

test('native should_panic success retains the inventory name and passes', () => {
  const result = summarizeNative('should-panic-pass');
  assert.equal(result.passed, true);
  assert.deepEqual(result.tests, {passed: 2, failed: 0, unavailable: 0, excluded: 0});
  assert.deepEqual(result.checks[0].testCases.map(t => t.name), nativeOutput['should-panic-pass'].tests);
});

test('native should_panic without a panic is a body failure, not unavailable', () => {
  const result = summarizeNative('should-panic-fail');
  assert.equal(result.passed, false);
  assert.equal(result.checks[0].status, 'failed');
  assert.deepEqual(result.tests, {passed: 1, failed: 1, unavailable: 0, excluded: 0});
  assert.deepEqual(result.failedProcesses, [planned.id]);
});

test('native ignore with an empty reason remains excluded', () => {
  const result = summarizeNative('ignored-empty-reason');
  assert.equal(result.passed, false);
  assert.equal(result.checks[0].status, 'excluded');
  assert.deepEqual(result.tests, {passed: 1, failed: 0, unavailable: 0, excluded: 1});
  assert.equal(result.checks[0].testCases.find(t => t.name === 'b').reason, '');
});

test('only ignored outcomes may carry a reason, even an empty reason', () => {
  const result = summarize(log().replace('test module::a ... ok', 'test module::a ... ok, '));
  assert.equal(result.passed, false);
  assert.equal(result.checks[0].status, 'unavailable');
});

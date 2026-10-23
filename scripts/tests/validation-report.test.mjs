import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {test} from 'node:test';
import {summarizeValidation} from '../summarize-validation.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'geulgyeol-validation-report-'));
console.log(`Synthetic evidence preserved: ${root}`);
const reporter = path.resolve(import.meta.dirname, '../node-validation-reporter.mjs');
const cli = path.resolve(import.meta.dirname, '../summarize-validation.mjs');
const sources = {
  pass: "import {test} from 'node:test'; test('body pass',()=>{});",
  fail: "import {test} from 'node:test'; test('body fail',()=>{throw Error('assertion sentinel');});",
  missing: "import './missing-fixture.mjs';",
  empty: '// no registered tests',
  skip: "import {test} from 'node:test'; test.skip('skip body',()=>{}); test.todo('todo body');",
  mixed: "import {test} from 'node:test'; test('body pass',()=>{}); test.skip('skip body',()=>{});",
  cancel: "import {test} from 'node:test'; test('cancelled body',()=>new Promise(()=>{}));",
};
fs.writeFileSync(path.join(root, 'body-helper.mjs'), "import {test} from 'node:test'; test('imported body',()=>{});");
sources.imported = "import './body-helper.mjs';";
const runs = new Map();
const env = {...process.env};
delete env.NODE_TEST_CONTEXT; // Child CLI runs must not inherit this test worker's context.
function run(name) {
  if (runs.has(name)) return runs.get(name);
  const file = path.join(root, `${name}.test.mjs`);
  fs.writeFileSync(file, sources[name]);
  const child = spawnSync(process.execPath, ['--test', `--test-reporter=${reporter}`, file], {encoding: 'utf8', timeout: 10000, env});
  assert.equal(child.error, undefined);
  const evidence = path.join(root, `${name}.json`);
  fs.writeFileSync(evidence, child.stdout);
  fs.writeFileSync(path.join(root, `${name}.stderr.log`), child.stderr);
  const result = {file, child, evidence}; runs.set(name, result); return result;
}
function check(name, required = true) {
  return {id: name, required, kind: 'node-test', files: [run(name).file]};
}
function result(name) { return {id: name, exitCode: run(name).child.status, report: run(name).evidence}; }
function summarize(checks, results) {
  return summarizeValidation({version: 1, checks}, {version: 1, results});
}

test('real Node reports distinguish body assertions, startup failure and empty synthetic file passes', () => {
  const report = summarize(['pass', 'fail', 'missing', 'empty'].map(n => check(n)),
    ['pass', 'fail', 'missing', 'empty'].map(result));
  assert.deepEqual(report.counts, {passed: 1, failed: 1, unavailable: 2, excluded: 0});
  assert.deepEqual(report.tests, {passed: 1, failed: 1, unavailable: 0, excluded: 0});
  assert.equal(run('empty').child.status, 0, 'Node itself counts the empty file as a pass');
  assert.equal(report.passed, false);
  assert.equal(report.testCountsComplete, false);
  assert.deepEqual(report.fileCounts, {passed: 1, failed: 1, unavailable: 2, excluded: 0});
  assert.match(report.checks[2].files[0].reason, /load\/startup/);
});

test('skip/TODO, partial exclusion and cancellation do not become required success', () => {
  const report = summarize(['pass', 'skip', 'mixed', 'cancel'].map(n => check(n)),
    ['pass', 'skip', 'mixed', 'cancel'].map(result));
  assert.deepEqual(report.counts, {passed: 1, failed: 0, unavailable: 1, excluded: 2});
  assert.deepEqual(report.tests, {passed: 2, failed: 0, unavailable: 1, excluded: 3});
  assert.equal(report.passed, false);
});

test('missing required check or expected file blocks otherwise passing results', () => {
  const report = summarize([check('pass'), {id: 'native', kind: 'command', required: true}], [result('pass')]);
  assert.deepEqual(report.requiredIncomplete, ['native']);
  assert.equal(report.passed, false);
  const missingFile = {...check('pass'), files: [run('pass').file, path.join(root, 'not-launched.test.mjs')]};
  assert.equal(summarize([missingFile], [result('pass')]).checks[0].status, 'unavailable');
});

test('required exclusion blocks; explicit optional exclusion stays visible', () => {
  const excluded = {id: 'manual', status: 'excluded', reason: 'physical IME outside this run'};
  const planned = {id: 'manual', kind: 'command', required: true};
  assert.equal(summarize([check('pass'), planned], [result('pass'), excluded]).passed, false);
  const report = summarize([check('pass'), {...planned, required: false}], [result('pass'), excluded]);
  assert.equal(report.passed, true); assert.equal(report.counts.excluded, 1);
  assert.equal(summarize([{...planned, required: false}], [excluded]).passed, false, 'no vacuous all-optional success');
});

test('missing, truncated, inconsistent and incomplete reporter evidence all block success', () => {
  for (const [label, data] of [
    ['missing', null], ['truncated', '{'],
    ['incomplete', {...JSON.parse(fs.readFileSync(run('pass').evidence)), complete: false}],
    ['bad-counts', {version: 1, kind: 'node-test', complete: true, summary: {}, files: [{file: run('pass').file, summary: {success: true, counts: {tests: 99}}}]}],
  ]) {
    const reportPath = path.join(root, `evidence-${label}.json`);
    if (data !== null) fs.writeFileSync(reportPath, typeof data === 'string' ? data : JSON.stringify(data));
    const report = summarize([check('pass')], [{id: 'pass', exitCode: 0, report: reportPath}]);
    assert.equal(report.passed, false, label); assert.equal(report.checks[0].status, 'unavailable', label);
  }
});

test('exit failures cannot be masked by a passing reporter; invalid exit is unavailable', () => {
  assert.equal(summarize([check('pass')], [{...result('pass'), exitCode: 7}]).checks[0].status, 'failed');
  assert.equal(summarize([check('pass')], [{...result('pass'), exitCode: null}]).checks[0].status, 'unavailable');
});

test('command checks require evidence and exit code; explicit unavailable input needs a reason', () => {
  const command = {id: 'types', required: true, kind: 'command'};
  const evidence = path.join(root, 'types.log'); fs.writeFileSync(evidence, '');
  assert.equal(summarize([command], [{id: 'types', evidence, exitCode: 0}]).passed, true);
  assert.equal(summarize([command], [{id: 'types', evidence, exitCode: 2}]).checks[0].status, 'failed');
  assert.equal(summarize([command], [{id: 'types', exitCode: 0}]).checks[0].status, 'unavailable');
  assert.equal(summarize([command], [{id: 'types', status: 'unavailable', reason: 'missing compile-time fixture'}]).checks[0].reason, 'missing compile-time fixture');
  assert.match(summarize([command], [{id: 'types', status: 'excluded'}]).checks[0].reason, /need a reason/);
});

test('duplicate/unplanned results and empty plans are rejected rather than hiding missing work', () => {
  assert.throws(() => summarize([], []), /nonempty/);
  assert.throws(() => summarize([check('pass')], [result('pass'), result('pass')]), /duplicate/);
  assert.throws(() => summarize([check('pass')], [{...result('pass'), id: 'unknown'}]), /Unplanned/);
  assert.throws(() => summarize([check('pass'), check('pass')], []), /Duplicate/);
});

test('CLI resolves evidence relative to input files and exits nonzero for required unrun checks', () => {
  const plan = path.join(root, 'plan.json'), results = path.join(root, 'results.json');
  fs.writeFileSync(plan, JSON.stringify({version: 1, checks: [{...check('pass'), files: ['pass.test.mjs']}]}));
  const invoke = entries => {
    fs.writeFileSync(results, JSON.stringify({version: 1, results: entries}));
    return spawnSync(process.execPath, [cli, plan, results], {encoding: 'utf8', cwd: os.tmpdir()});
  };
  const good = invoke([{...result('pass'), report: 'pass.json'}]);
  assert.equal(good.status, 0, good.stdout); assert.equal(JSON.parse(good.stdout).passed, true);
  const missing = invoke([]); assert.equal(missing.status, 1); assert.equal(JSON.parse(missing.stdout).passed, false);
  const skipped = invoke([{id: 'pass', status: 'excluded', reason: 'not run'}]); assert.equal(skipped.status, 1);
});


test('imported helper test registrations belong to the planned entry summary, not extra test files', () => {
  const report = summarize([check('imported')], [result('imported')]);
  assert.equal(report.passed, true);
  assert.deepEqual(report.fileCounts, {passed: 1, failed: 0, unavailable: 0, excluded: 0});
  assert.equal(report.tests.passed, 1);
});

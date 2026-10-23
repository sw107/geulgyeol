import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const STATES = ['passed', 'failed', 'unavailable', 'excluded'];
const zero = () => Object.fromEntries(STATES.map(s => [s, 0]));
const requireValue = (condition, message) => { if (!condition) throw Error(message); };
const readJSON = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const canonical = file => {
  const absolute = path.resolve(file);
  try { return fs.realpathSync(absolute); } catch { return absolute; }
};
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const integer = n => Number.isSafeInteger(n) && n >= 0;

function countsFrom(summary) {
  const c = summary?.counts;
  requireValue(c && ['tests', 'passed', 'failed', 'cancelled', 'skipped', 'todo'].every(k => integer(c[k])), 'Invalid Node counts');
  requireValue(c.tests === c.passed + c.failed + c.cancelled + c.skipped + c.todo, 'Inconsistent Node counts');
  requireValue(typeof summary.success === 'boolean', 'Missing Node summary success');
  return {passed: c.passed, failed: c.failed, unavailable: c.cancelled, excluded: c.skipped + c.todo};
}

export function summarizeNode(report, expectedFiles, exitCode) {
  requireValue(report?.version === 1 && report.kind === 'node-test' && typeof report.complete === 'boolean' && Array.isArray(report.files), 'Invalid Node report');
  const observed = new Map();
  for (const f of report.files) {
    requireValue(nonempty(f.file) && path.isAbsolute(f.file) && !observed.has(f.file), 'Duplicate/invalid Node file');
    requireValue(!observed.has(canonical(f.file)), 'Duplicate canonical Node file');
    observed.set(canonical(f.file), f);
  }
  requireValue([...observed.keys()].every(f => expectedFiles.includes(f)), 'Node report contains unplanned files');
  const tests = zero();
  const files = expectedFiles.map(file => {
    const found = observed.get(file);
    if (!found?.summary) return {file, status: 'unavailable', reason: found
      ? 'No completed test-body summary: file load/startup/early exit or no registered tests'
      : 'Planned test file was not reported', errors: found?.errors ?? []};
    const counts = countsFrom(found.summary);
    for (const k of STATES) tests[k] += counts[k];
    const status = counts.failed ? 'failed' : counts.unavailable ? 'unavailable'
      : counts.excluded ? 'excluded' : counts.passed ? 'passed' : 'unavailable';
    return {file, status: !found.summary.success && status === 'passed' ? 'failed' : status, counts,
      errors: found.errors ?? []};
  });
  const states = files.map(f => f.status);
  // A failure remains visible even when a different file did not execute.
  const status = states.includes('failed') ? 'failed'
    : !report.complete || !report.summary || states.includes('unavailable') ? 'unavailable'
    : exitCode !== 0 || report.summary.success !== true ? 'failed'
    : states.includes('excluded') ? 'excluded' : 'passed';
  if (report.summary) countsFrom(report.summary);
  return {status, tests, files, complete: report.complete === true,
    reason: !report.complete ? 'Node run has no complete final summary' : undefined};
}

/** Plan and observations are separate so omitted required work cannot disappear. */
export function summarizeValidation(plan, observations, {planDirectory = '.', resultDirectory = '.'} = {}) {
  requireValue(plan?.version === 1 && Array.isArray(plan.checks) && plan.checks.length > 0, 'Plan needs nonempty checks');
  requireValue(observations?.version === 1 && Array.isArray(observations.results), 'Results need a results array');
  const ids = new Set();
  for (const check of plan.checks) {
    requireValue(nonempty(check.id) && !ids.has(check.id), 'Duplicate/invalid planned ID');
    requireValue(typeof check.required === 'boolean' && ['node-test', 'command'].includes(check.kind), 'Explicit required/kind fields are mandatory');
    if (check.kind === 'node-test') {
      requireValue(Array.isArray(check.files) && check.files.length > 0 && check.files.every(nonempty), 'Node check needs an explicit nonempty file list');
      const files = check.files.map(f => canonical(path.resolve(planDirectory, f)));
      requireValue(new Set(files).size === files.length, 'Duplicate planned test file');
    }
    ids.add(check.id);
  }
  const results = new Map();
  for (const result of observations.results) {
    requireValue(ids.has(result.id) && !results.has(result.id), 'Unplanned/duplicate result ID');
    results.set(result.id, result);
  }
  const checks = plan.checks.map(check => {
    const result = results.get(check.id);
    const base = {id: check.id, required: check.required, kind: check.kind};
    if (!result) return {...base, status: 'unavailable', reason: 'No result for planned check'};
    try {
      requireValue(result.status === undefined || ['unavailable', 'excluded'].includes(result.status), 'Invalid result status');
      if (['unavailable', 'excluded'].includes(result.status)) {
        requireValue(nonempty(result.reason), 'Unexecuted/excluded checks need a reason');
        return {...base, status: result.status, reason: result.reason};
      }
      requireValue(Number.isInteger(result.exitCode) && result.exitCode >= 0, 'Missing/invalid process exit code');
      if (check.kind === 'node-test') {
        requireValue(nonempty(result.report), 'Node check needs reporter evidence');
        const evidence = path.resolve(resultDirectory, result.report);
        return {...base, evidence, exitCode: result.exitCode, ...summarizeNode(readJSON(evidence),
          check.files.map(f => canonical(path.resolve(planDirectory, f))), result.exitCode)};
      }
      requireValue(nonempty(result.evidence), 'Command check needs a log/evidence file');
      const evidence = path.resolve(resultDirectory, result.evidence);
      requireValue(fs.statSync(evidence).isFile(), 'Command evidence is not a file');
      // Non-test commands (e.g. tsc) have no inferred assertion count.
      return {...base, status: result.exitCode === 0 ? 'passed' : 'failed', evidence, exitCode: result.exitCode};
    } catch (error) {
      return {...base, status: 'unavailable', reason: `Invalid/missing evidence: ${error.message}`};
    }
  });
  const counts = zero(), tests = zero(), fileCounts = zero();
  for (const check of checks) {
    counts[check.status]++;
    for (const file of check.files ?? []) fileCounts[file.status]++;
    for (const k of STATES) tests[k] += check.tests?.[k] ?? 0;
  }
  const required = checks.filter(c => c.required);
  const passed = required.length > 0 && required.every(c => c.status === 'passed')
    && !checks.some(c => c.status === 'failed');
  return {version: 1, passed, counts, fileCounts, tests,
    testCountsComplete: checks.filter(c => c.kind === 'node-test').every(c => c.files?.every(f => f.counts)), checks,
    requiredIncomplete: required.filter(c => c.status !== 'passed').map(c => c.id),
    scope: 'Declared plan only; test counts include completed per-file Node summaries only'};
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    requireValue(process.argv.length === 4, 'Usage: node scripts/summarize-validation.mjs PLAN.json RESULTS.json');
    const [planFile, resultFile] = process.argv.slice(2).map(p => path.resolve(p));
    const report = summarizeValidation(readJSON(planFile), readJSON(resultFile), {
      planDirectory: path.dirname(planFile), resultDirectory: path.dirname(resultFile),
    });
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.passed ? 0 : 1;
  } catch (error) {
    console.log(JSON.stringify({version: 1, passed: false, error: error.message}));
    process.exitCode = 1;
  }
}

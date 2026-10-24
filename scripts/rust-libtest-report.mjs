const requireValue = (condition, message) => { if (!condition) throw Error(message); };

/** One native --lib target, --format=pretty --color=never, captured output only.
 * An explicit pre-run inventory prevents a filtered/partial run becoming success.
 * This does not discover tests, run Cargo, or authenticate the supplied log.
 */
export function summarizeRustLibtest(log, expectedTests, exitCode) {
  const lines = log.split(/\r?\n/);
  const starts = lines.flatMap((line, index) => /^running \d+ tests?$/.test(line) ? [index] : []);
  const ends = lines.flatMap((line, index) => line.startsWith('test result:') ? [index] : []);
  requireValue(starts.length === 1 && ends.length === 1 && starts[0] < ends[0],
    'Expected one complete libtest run; missing/truncated or multiple targets');
  const start = starts[0], end = ends[0];
  const summary = /^test result: (ok|FAILED)\. (\d+) passed; (\d+) failed; (\d+) ignored; (\d+) measured; (\d+) filtered out; finished in [\d.]+s$/.exec(lines[end]);
  requireValue(summary, 'Unsupported libtest summary (use pretty output without color)');
  const [passed, failed, ignored, measured, filteredOut] = summary.slice(2).map(Number);
  const running = Number(lines[start].match(/\d+/)[0]);
  requireValue([passed, failed, ignored, measured, filteredOut, running].every(Number.isSafeInteger), 'Invalid libtest counts');
  requireValue(measured === 0, 'Benchmarks are outside this test adapter');
  requireValue((summary[1] === 'ok') === (failed === 0), 'Inconsistent libtest result');
  const observed = new Map();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith('test ') || i === end) continue;
    const match = /^test (\S+) \.\.\. (ok|FAILED|ignored)(?:, (.+))?$/.exec(line);
    requireValue(match && i > start && i < end && (!match[3] || match[2] === 'ignored'),
      'Unsupported or misplaced libtest case line');
    const [, name, outcome, reason] = match;
    requireValue(expectedTests.includes(name) && !observed.has(name), 'Unplanned/duplicate libtest case');
    observed.set(name, {name, status: {ok: 'passed', FAILED: 'failed', ignored: 'excluded'}[outcome],
      ...(reason ? {reason} : {})});
  }
  const count = status => [...observed.values()].filter(t => t.status === status).length;
  requireValue(running === passed + failed + ignored && observed.size === running
    && count('passed') === passed && count('failed') === failed && count('excluded') === ignored,
  'Libtest case lines and summary counts disagree');
  const testCases = expectedTests.map(name => observed.get(name) ?? {
    name, status: 'unavailable', reason: 'Planned test was not reported (missing or filtered)',
  });
  const unavailable = testCases.length - observed.size;
  const complete = unavailable === 0 && filteredOut === 0;
  return {
    status: failed || exitCode !== 0 ? 'failed' : !complete || running === 0 ? 'unavailable'
      : ignored ? 'excluded' : 'passed',
    tests: {passed, failed, unavailable, excluded: ignored}, testCases, complete, filteredOut,
    ...(!complete || running === 0 ? {reason: 'Planned Rust tests did not all execute; inspect testCases and filteredOut'} : {}),
  };
}

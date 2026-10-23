// Exercise the recovered runner with an owned-browser adapter; no browser or
// application is launched by the default unit-test command.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const source = fs.readFileSync(new URL('../e2e/helpers.mjs', import.meta.url), 'utf8');
let serial = 0;
async function fixture(options, check) {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'geulgyeol-e2e-harness-'));
  const key = `__e2eHarness${++serial}`;
  const state = { closes: 0, reports: [], options };
  const processAdapter = { argv: ['node', 'fixture.test.mjs'], env: { E2E_OUTPUT_DIR: output }, exitCode: 0 };
  const browser = {
    async newPage() {
      if (options.pageFailure) throw new Error('page failed');
      return { async setViewport() {}, async screenshot() {} };
    },
    async close() { state.closes++; },
  };
  class Reporter {
    results = [];
    pass(tc, message) { this.results.push({ status: 'PASS', message }); }
    fail(tc, message) { this.results.push({ status: 'FAIL', message }); }
    generate() {
      state.reports.push(this.results);
      if (options.reportFailure) throw new Error('report failed');
    }
  }
  globalThis[key] = {
    process: processAdapter, Reporter,
    puppeteer: {
      async launch(config) {
        assert.equal(config.headless, true);
        assert(!config.args.includes('--no-sandbox'));
        if (options.launchFailure) throw new Error('launch failed');
        return browser;
      },
      connect() { throw new Error('must not connect to an existing browser'); },
    },
  };
  let code = source
    .replace("import pixelmatch from 'pixelmatch';", 'const pixelmatch = null;')
    .replace("import { PNG } from 'pngjs';", 'const PNG = null;')
    .replace("import puppeteer from 'puppeteer-core';", `const {puppeteer, process} = globalThis.${key};`)
    .replace("import { TestReporter } from './report-generator.mjs';", `const TestReporter = globalThis.${key}.Reporter;`);
  try {
    const api = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
    await check(api, state, processAdapter);
  } finally {
    delete globalThis[key];
    fs.rmSync(output, { recursive: true, force: true });
  }
}

test('E2E with zero assertions fails and closes its browser', () => fixture({}, async (api, state, proc) => {
  await api.runTest('empty', async () => {}, { skipLoadApp: true });
  assert.equal(proc.exitCode, 1);
  assert.match(state.reports[0][0].message, /without any assertions/);
  assert.equal(state.closes, 1);
}));

test('E2E assertion failures retain a failing status', () => fixture({}, async (api, state, proc) => {
  await api.runTest('failed assertion', async () => api.assert(false, 'expected failure'), { skipLoadApp: true });
  assert.equal(proc.exitCode, 1);
  assert.equal(state.reports[0][0].status, 'FAIL');
  assert.equal(state.closes, 1);
}));

test('E2E successful assertions are reported and close the browser', () => fixture({}, async (api, state, proc) => {
  await api.runTest('passed', async () => api.assert(true, 'expected pass'), { skipLoadApp: true });
  assert.equal(proc.exitCode, 0);
  assert.equal(state.reports[0][0].status, 'PASS');
  assert.equal(state.closes, 1);
}));

test('E2E browser launch failure is reported as failure', () => fixture({ launchFailure: true }, async (api, state, proc) => {
  await api.runTest('launch failure', async () => assert.fail('must not run'), { skipLoadApp: true });
  assert.equal(proc.exitCode, 1);
  assert.match(state.reports[0][0].message, /launch failed/);
  assert.equal(state.closes, 0);
}));

test('E2E page creation failure closes the already launched browser', () => fixture({ pageFailure: true }, async (api, state, proc) => {
  await api.runTest('page failure', async () => assert.fail('must not run'), { skipLoadApp: true });
  assert.equal(proc.exitCode, 1);
  assert.match(state.reports[0][0].message, /page failed/);
  assert.equal(state.closes, 1);
}));

test('E2E report write failure still closes its browser and propagates', () => fixture({ reportFailure: true }, async (api, state) => {
  await assert.rejects(api.runTest('report failure', async () => api.assert(true, 'pass'), { skipLoadApp: true }), /report failed/);
  assert.equal(state.closes, 1);
}));

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const runnerSource = fs.readFileSync(new URL('../e2e/run-with-vite.mjs', import.meta.url), 'utf8');
const serverURL = new URL('../e2e/vite-server.mjs', import.meta.url);
const serverSource = fs.readFileSync(serverURL, 'utf8');
const automationSource = fs.readFileSync(new URL('../e2e/automation-commands.test.mjs', import.meta.url), 'utf8');
let serial = 0;

async function runSignalCase(signal, afterCompletion = false) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'geulgyeol-runner-signal-'));
  let child;
  try {
    fs.writeFileSync(path.join(dir, 'runner.mjs'), runnerSource);
    fs.writeFileSync(path.join(dir, 'vite-server.mjs'), `
      import fs from 'node:fs'; import {spawn} from 'node:child_process';
      export const startViteDevServer = async () => ({url:'http://127.0.0.1:1', child:{kill(){}}, logPath:'unused',
        stop:async()=>{console.log('CLEANUP_READY');await new Promise(r=>setTimeout(r,100));fs.writeFileSync('stopped','yes');}});
      export const waitForServer = async () => {};
      export const spawnStudioCommand = (cmd,args) => spawn(cmd,args,{stdio:'inherit'});
      export const spawnNpm = () => {throw new Error('unexpected npm');};
    `);
    fs.writeFileSync(path.join(dir, 'probe.mjs'), afterCompletion ? 'process.exit(0);' : `
      import fs from 'node:fs';
      for (const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>{fs.writeFileSync('received',signal);process.exit(0);});
      console.log('PROBE_READY');setTimeout(()=>process.exit(3),5000);
    `);
    child = spawn(process.execPath, ['runner.mjs', '--', process.execPath, 'probe.mjs'], {
      cwd: dir, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', b => { output += b; });
    child.stderr.on('data', b => { output += b; });
    const exit = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
    const deadline = Date.now() + 4000;
    const marker = afterCompletion ? 'CLEANUP_READY' : 'PROBE_READY';
    while (!output.includes(marker) && Date.now() < deadline && child.exitCode === null) await delay(10);
    assert(output.includes(marker), output);
    child.kill(signal);
    const result = await Promise.race([exit, delay(2000).then(() => null)]);
    assert(result, 'runner did not finish after interruption');
    assert.equal(result.signal, null);
    assert.equal(result.code, afterCompletion ? 0 : signal === 'SIGINT' ? 130 : 143, output);
    assert(fs.existsSync(path.join(dir, 'stopped')), 'owned server must stop');
    if (!afterCompletion) assert.equal(fs.readFileSync(path.join(dir, 'received'), 'utf8'), signal);
  } finally {
    if (child && child.exitCode === null && !child.signalCode) child.kill('SIGTERM');
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
for (const signal of ['SIGINT', 'SIGTERM']) {
  test(`${signal} remains unsuccessful when the test child cleans up with exit 0`, () => runSignalCase(signal));
}
test('signal after the test completed does not turn completed success into failure', () => runSignalCase('SIGTERM', true));

for (const kind of ['no-headers', 'http-error']) {
  test(`readiness deadline bounds ${kind} fetch and retry delay`, async () => {
    const key = `__readiness${++serial}`;
    let aborted = false;
    globalThis[key] = async (_url, options) => {
      if (kind === 'http-error') return { ok: false, status: 503 };
      return new Promise((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => {
          aborted = true; reject(options.signal.reason);
        }, { once: true });
      });
    };
    const code = `const fetch = globalThis.${key};\n` + serverSource.replaceAll('import.meta.url', JSON.stringify(serverURL.href));
    try {
      const { waitForServer } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
      const result = await Promise.race([
        waitForServer('http://127.0.0.1:1', { exitCode: null, signalCode: null }, 'unused', 40)
          .then(() => 'ready', error => error),
        delay(250).then(() => 'deadline exceeded'),
      ]);
      assert(result instanceof Error, String(result));
      if (kind === 'no-headers') assert.equal(aborted, true, 'in-flight fetch must be aborted');
      else assert.match(result.message, /503/);
    } finally { delete globalThis[key]; }
  });
}

async function checkDialogContract({ opens, closes }) {
  const key = `__automationDialog${++serial}`;
  const assertions = [];
  let completion, open = false;
  const oldWindow = globalThis.window, oldDocument = globalThis.document;
  const expectedSelector = '.modal-overlay .dialog-wrap .goto-dialog-body';
  globalThis.document = { querySelector: selector => selector === expectedSelector && open
    ? { getBoundingClientRect: () => ({ width: 300, height: 100 }) } : null };
  globalThis.window = { rhwpStudio: { automation: {
    listCommands: () => [{ id: 'edit:goto', opensDialog: true }],
    execute: (_id, _params, options) => {
      if (!options?.allowDialog) return { ok: false, reason: 'needs-dialog' };
      open = opens; return { ok: true };
    },
  } } };
  const page = { keyboard: { press: async () => { if (closes) open = false; } }, evaluate: async fn => {
    const code = fn.toString();
    if (code.includes('const cmds =')) return { count: 200, hasCopy: true, hasFieldEdit: true, sample: { enabled: true } };
    if (code.includes('const model =')) return { topLevel: Array(8).fill('menu'), fileItemCount: 3, hasSubmenu: true };
    if (code.includes('const ids =')) return { markup: 200, missing: [] };
    if (code.includes('getTextRange')) return '자동화';
    if (code.includes('const before =')) return { result: { ok: true }, hasSelection: true };
    if (code.includes('unknown: a.execute')) return { unknown: { ok: false, reason: 'unregistered' }, enabledUnknown: false };
    if (code.includes('let ran =')) return { prefixRejected: true, inMenu: true, inModel: true, result: { ok: true }, ran: 2, afterDispose: false, stillRegistered: false };
    if (code.includes('const info =') || code.includes('document.querySelector')) return fn();
  } };
  globalThis[key] = {
    runTest: (_title, fn) => { completion = fn({ page }); }, createNewDocument: async () => {},
    typeText: async () => {}, screenshot: async () => {}, assert: (condition, message) => assertions.push({ condition: Boolean(condition), message }),
  };
  const source = automationSource.replace(/import \{[\s\S]*?\} from '\.\/helpers.mjs';/,
    `const {runTest,createNewDocument,typeText,screenshot,assert} = globalThis.${key};`);
  try {
    await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
    await completion;
    const failures = assertions.filter(a => !a.condition);
    if (opens && closes) assert.deepEqual(failures, []);
    else assert(failures.some(a => a.message.includes(opens ? 'Escape' : '실제 표시')), JSON.stringify(assertions));
  } finally {
    delete globalThis[key]; globalThis.window = oldWindow; globalThis.document = oldDocument;
  }
}
test('automation fails when allowDialog returns ok without showing GotoDialog', () => checkDialogContract({ opens: false, closes: true }));
test('automation fails when Escape leaves GotoDialog open', () => checkDialogContract({ opens: true, closes: false }));
test('automation accepts an actually shown and removed GotoDialog', () => checkDialogContract({ opens: true, closes: true }));

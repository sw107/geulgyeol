import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '../..');
const packageSource = fs.readFileSync(path.join(root, 'rhwp-studio/package.json'));
const runnerSource = fs.readFileSync(path.join(root, 'scripts/test-studio.mjs'));

function runFixture({ studio = false, editor = false, failStudio = false, decoys = false } = {}) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'geulgyeol-test-discovery-'));
  try {
    fs.mkdirSync(path.join(temp, 'scripts'));
    fs.mkdirSync(path.join(temp, 'rhwp-studio'));
    fs.writeFileSync(path.join(temp, 'scripts/test-studio.mjs'), runnerSource);
    fs.writeFileSync(path.join(temp, 'rhwp-studio/package.json'), packageSource);
    for (const [directory, present, label, fail] of [
      ['rhwp-studio/tests', studio, 'studio-fixture', failStudio],
      ['npm/editor/tests', editor, 'editor-fixture', false],
    ]) {
      const target = path.join(temp, directory);
      if (present || decoys) fs.mkdirSync(target, { recursive: true });
      if (present) {
        fs.writeFileSync(path.join(target, 'fixture.test.mjs'),
          `import test from 'node:test';import assert from 'node:assert/strict';`
          + `test('${label}',()=>assert.equal(1,${fail ? 2 : 1}));`);
      } else if (decoys) {
        fs.mkdirSync(path.join(target, 'directory.test.mjs'));
        fs.writeFileSync(path.join(target, 'wrong-extension.test.ts'), 'throw new Error("not a test match");');
        fs.writeFileSync(path.join(target, 'helper.mjs'), 'throw new Error("not a test match");');
      }
    }
    const env = { ...process.env, PATH: path.dirname(process.execPath) + path.delimiter + process.env.PATH };
    // This fixture starts a separate CLI test run, not a nested node:test worker.
    delete env.NODE_TEST_CONTEXT;
    const result = spawnSync(process.execPath, ['--run', 'test'], {
      cwd: path.join(temp, 'rhwp-studio'),
      encoding: 'utf8', timeout: 10000,
      env,
    });
    assert.ifError(result.error);
    assert.equal(result.signal, null);
    return result;
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

for (const [name, options, missing] of [
  ['both groups are missing', {}, ['Studio', 'editor host']],
  ['Studio is missing', { editor: true }, ['Studio']],
  ['editor host is missing', { studio: true }, ['editor host']],
  ['directories and nonmatching entries do not count as tests', { decoys: true }, ['Studio', 'editor host']],
]) {
  test(`default test command fails before execution when ${name}`, () => {
    const result = runFixture(options);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stderr, /No \.test\.mjs files found for required test group/);
    for (const group of missing) assert.ok(result.stderr.includes(group), result.stderr);
    assert.doesNotMatch(result.stdout, /studio-fixture|editor-fixture/);
  });
}

test('default test command runs both required groups', () => {
  const result = runFixture({ studio: true, editor: true });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /studio-fixture/);
  assert.match(result.stdout, /editor-fixture/);
  assert.match(result.stdout, /# tests 2/);
  assert.match(result.stdout, /# pass 2/);
  assert.match(result.stdout, /# fail 0/);
});

test('default test command preserves assertion failure exit status', () => {
  const result = runFixture({ studio: true, editor: true, failStudio: true });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /studio-fixture/);
  assert.match(result.stdout, /editor-fixture/);
  assert.match(result.stdout, /# tests 2/);
  assert.match(result.stdout, /# pass 1/);
  assert.match(result.stdout, /# fail 1/);
});

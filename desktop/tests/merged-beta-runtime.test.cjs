const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

test('fresh beta ASAR includes and loads the main/preload dependency closure', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'geulgyeol-beta-closure-'));
  try {
    const output = execFileSync(process.execPath, [path.resolve(__dirname, '../../scripts/check-merged-beta-runtime.mjs'), path.join(dir, 'run'), 'fixed'],
      { encoding: 'utf8', maxBuffer: 1024 * 1024 });
    const result = JSON.parse(output.trim());
    assert.equal(result.packagedPrintPreview, true);
    assert.equal(result.mainAndPreloadLoaded, true);
    assert.equal(result.privateCanariesExcluded, true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

test('table-caption entry supports next, previous and closed-dialog Find Again without a cell origin', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'geulgyeol-caption-search-'));
  try {
    const output = execFileSync(process.execPath, [
      '--no-warnings', path.resolve(__dirname, '../../scripts/check-table-caption-search.mjs'),
      path.resolve(__dirname, '../web/studio'), path.join(dir, 'fixtures'), path.join(dir, 'proof'), 'fixed',
    ], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
    const result = JSON.parse(output.trim());
    assert.equal(result.documents, 4);
    assert.equal(result.starts, 216);
    assert.equal(result.errors, 0);
    assert.equal(result.mismatches, 0);
    assert.equal(result.reopens, 8);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

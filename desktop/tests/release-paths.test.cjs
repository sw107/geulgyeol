const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const modules = Promise.all(['check-release-paths.mjs', 'build-wasm-release.mjs'].map(name => import(pathToFileURL(path.resolve(__dirname, '../../scripts/' + name)))));
function fixture() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'geulgyeol-path-audit-')); return { dir, clear: () => fs.rmSync(dir, { recursive: true, force: true }) }; }
for (const file of ['rhwp.js', 'rhwp.d.ts', 'rhwp_bg.wasm', 'rhwp_bg.wasm.d.ts']) for (const value of ['/Users/private-owner/project/file.rs', '/home/private-owner/source.rs', 'C:\\Users\\private-owner\\source.rs']) {
  test(`release audit detects user metadata in ${file}, ${value.startsWith('C:') ? 'Windows' : value.split('/')[1]}`, async () => {
    const [{ auditSdk, sdkFiles }] = await modules, f = fixture();
    try {
      for (const name of sdkFiles) fs.writeFileSync(path.join(f.dir, name), name === file ? value : '/geulgyeol/source/src/lib.rs');
      const result = auditSdk(f.dir); assert.equal(result.clean, false); assert.equal(result.findings[0].file, file);
      assert(!JSON.stringify(result).includes('private-owner'), 'reports must not echo path values');
    } finally { f.clear(); }
  });
}
test('release audit accepts remapped SDK and rejects exact unusual build prefixes', async () => {
  const [{ auditSdk, sdkFiles }] = await modules, f = fixture();
  try {
    for (const file of sdkFiles) fs.writeFileSync(path.join(f.dir, file), '/geulgyeol/cargo/registry/src/example.rs');
    assert.equal(auditSdk(f.dir).clean, true);
    fs.writeFileSync(path.join(f.dir, 'rhwp_bg.wasm'), '/private-build-area/engine/src/lib.rs');
    assert.equal(auditSdk(f.dir, ['/private-build-area']).clean, false);
  } finally { f.clear(); }
});
test('encoded remap flags retain spaces and prioritize nested prefixes', async () => {
  const [, { remapFlags }] = await modules;
  const flags = remapFlags({ source: '/Users/example/work tree', cargo: '/Users/example/work tree/tools/cargo' });
  assert.deepEqual(flags, ['--remap-path-prefix=/Users/example/work tree=/geulgyeol/source', '--remap-path-prefix=/Users/example/work tree/tools/cargo=/geulgyeol/cargo']);
  assert.throws(() => remapFlags({ source: '/' }));
  assert.throws(() => remapFlags({ source: '/same', target: '/same' }));
});
test('release environment preserves supplied tool/cache choices and rejects custom compiler overrides', async () => {
  const [, { releaseEnv }] = await modules;
  const env = { CARGO_HOME: '/cache/cargo', RUSTUP_HOME: '/cache/rustup', CARGO_TARGET_DIR: '/cache/target', CARGO: '/tools/cargo' };
  const result = releaseEnv(env, '/source/work tree');
  assert.equal(result.env.CARGO, env.CARGO); assert.equal(result.env.RUSTUP_AUTO_INSTALL, '0');
  assert.equal(result.env.RUSTUP_TOOLCHAIN, '1.93.1');
  assert.equal(result.env.CARGO_ENCODED_RUSTFLAGS.split('\x1f').length, 4);
  for (const name of ['RUSTFLAGS', 'CARGO_ENCODED_RUSTFLAGS', 'CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUSTFLAGS', 'RUSTC_WRAPPER', 'RUSTC_WORKSPACE_WRAPPER']) assert.throws(() => releaseEnv({ ...env, [name]: 'custom' }, '/source/work tree'));
});
test('output preflight rejects linked or unrelated files without modifying them', async () => {
  const [, { checkOutput }] = await modules, f = fixture();
  try {
    checkOutput(f.dir);
    fs.writeFileSync(path.join(f.dir, 'rhwp.js'), 'old generated SDK'); checkOutput(f.dir);
    fs.writeFileSync(path.join(f.dir, 'notes.txt'), 'USER DATA'); assert.throws(() => checkOutput(f.dir));
    assert.equal(fs.readFileSync(path.join(f.dir, 'notes.txt'), 'utf8'), 'USER DATA');
    fs.unlinkSync(path.join(f.dir, 'notes.txt'));
    fs.symlinkSync(path.join(f.dir, 'rhwp.js'), path.join(f.dir, 'rhwp_bg.wasm')); assert.throws(() => checkOutput(f.dir));
    assert.equal(fs.readFileSync(path.join(f.dir, 'rhwp.js'), 'utf8'), 'old generated SDK');
  } finally { f.clear(); }
});
test('relative cache and target paths resolve against the build root', async () => {
  const [, { releaseEnv }] = await modules;
  const result = releaseEnv({ CARGO_HOME: 'tools/cargo', RUSTUP_HOME: 'tools/rustup', CARGO_TARGET_DIR: 'target' }, '/build/checkout');
  assert.deepEqual(result.prefixes, { source: '/build/checkout', cargo: '/build/checkout/tools/cargo', rustup: '/build/checkout/tools/rustup', target: '/build/checkout/target' });
});

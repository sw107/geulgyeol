const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function runSetup(failFetch) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'geulgyeol-cold-setup-'));
  const root = path.join(dir, 'source'), bin = path.join(dir, 'fixture-bin');
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true }); fs.mkdirSync(bin);
  for (const name of ['desktop', 'rhwp-studio', 'engine']) fs.mkdirSync(path.join(root, name));
  for (const name of ['setup-standalone.sh', 'standalone-env.sh']) fs.copyFileSync(path.resolve(__dirname, '../../scripts', name), path.join(root, 'scripts', name));
  fs.writeFileSync(path.join(root, 'scripts/install-standalone-rust.sh'), '# Synthetic installer marker; intercepted only in this test fixture.\n');
  const executable = (name, code) => fs.writeFileSync(path.join(bin, name), '#!/usr/bin/env node\n' + code, { mode: 0o755 });
  const logger = `const fs=require('node:fs'),path=require('node:path');
function emit(row){const file='events.json';const rows=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)):[];rows.push(row);fs.writeFileSync(file,JSON.stringify(rows));}`;
  const cargo = `#!/usr/bin/env node
${logger}
const row={step:'cargo-fetch',args:process.argv.slice(2),cargoHome:process.env.CARGO_HOME,rustupHome:process.env.RUSTUP_HOME,target:process.env.CARGO_TARGET_DIR};
emit(row);
if(process.env.QA_FETCH_FAIL==='1')process.exit(9);
fs.mkdirSync(path.join(process.env.CARGO_HOME,'registry'),{recursive:true});fs.writeFileSync(path.join(process.env.CARGO_HOME,'registry/fixture-ready'),'fixture only');
`;
  executable('npm', `${logger}
const prefix=process.argv[process.argv.indexOf('--prefix')+1];emit({step:'npm',prefix});
if(prefix==='desktop'){fs.mkdirSync('desktop/node_modules/electron',{recursive:true});fs.writeFileSync('desktop/node_modules/electron/install.js',${JSON.stringify(logger + "\nemit({step:'electron-install'});")});}`);
  executable('bash', `${logger}
if(process.argv[2]!=='scripts/install-standalone-rust.sh')process.exit(99);emit({step:'rust-installer'});
const home=path.join(process.cwd(),'.geulgyeol-tools/cargo-home');fs.mkdirSync(home+'/bin',{recursive:true});
fs.writeFileSync(home+'/bin/cargo',${JSON.stringify(cargo)},{mode:0o755});`);
  const result = spawnSync('/bin/bash', [path.join(root, 'scripts/setup-standalone.sh')], {
    cwd: root, encoding: 'utf8', env: { ...process.env, PATH: bin + path.delimiter + process.env.PATH, QA_FETCH_FAIL: failFetch ? '1' : '0' },
  });
  const log = path.join(root, 'events.json');
  const events = fs.existsSync(log) ? JSON.parse(fs.readFileSync(log, 'utf8')) : [];
  return { dir, root, result, events, clear: () => fs.rmSync(dir, { recursive: true, force: true }) };
}
test('standalone setup fills the same repository Cargo cache using a locked fetch after tools are installed', () => {
  const f = runSetup(false);
  try {
    assert.equal(f.result.status, 0, f.result.stderr);
    assert.deepEqual(f.events.map(x => x.step), ['npm', 'electron-install', 'npm', 'rust-installer', 'cargo-fetch']);
    const fetch = f.events.at(-1);
    const physicalRoot = fs.realpathSync(f.root);
    assert.deepEqual(fetch.args, ['fetch', '--locked', '--manifest-path', 'engine/Cargo.toml']);
    assert.equal(fetch.cargoHome, path.join(physicalRoot, '.geulgyeol-tools/cargo-home'));
    assert.equal(fetch.rustupHome, path.join(physicalRoot, '.geulgyeol-tools/rustup-home'));
    assert.equal(fetch.target, path.join(physicalRoot, 'engine/target'));
    assert(fs.existsSync(path.join(fetch.cargoHome, 'registry/fixture-ready')));
  } finally { f.clear(); }
});
test('standalone setup fails when locked dependency preparation fails', () => {
  const f = runSetup(true);
  try {
    assert.equal(f.result.status, 9, f.result.stderr);
    assert.equal(f.events.at(-1).step, 'cargo-fetch');
    assert(!fs.existsSync(path.join(f.root, '.geulgyeol-tools/cargo-home/registry/fixture-ready')));
  } finally { f.clear(); }
});

// Exercise the actual packager and emitted ASAR using a tiny synthetic runtime.
// Stubbed Electron module loading is not native app launch/print/release QA.
// node scripts/check-merged-beta-runtime.mjs FRESH_OUTPUT baseline|fixed
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire, isBuiltin } from 'node:module';
const root = path.resolve(import.meta.dirname, '..'), [outArg, mode] = process.argv.slice(2), out = path.resolve(outArg);
assert(['baseline', 'fixed'].includes(mode)); assert(!fs.existsSync(out)); fs.mkdirSync(out, { recursive: true });
const sha = b => createHash('sha256').update(b).digest('hex'), python = process.env.PYTHON || 'python3';
const source = out + '/fixture/source', runtime = out + '/fixture/ElectronFixture.app';
const studio = out + '/fixture/studio', engine = out + '/fixture/engine', fonts = out + '/fixture/fonts';
const copy = (from, to) => { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(from, to); };
const tracked = execFileSync('git', ['ls-files', '-z', 'desktop'], { cwd: root }).toString().split('\0').filter(Boolean);
for (const file of tracked) if (!file.startsWith('desktop/tests/') && !file.startsWith('desktop/web/studio/')) copy(root + '/' + file, source + '/' + file);
for (const file of ['package-merged-mac-beta.py', 'repackage-mac-candidate.py']) copy(root + '/scripts/' + file, source + '/scripts/' + file);
const sentinel = 'SYNTHETIC_PRIVATE_CANARY_73ee7';
for (const file of ['.env', 'desktop/.env', 'desktop/private.key', 'desktop/tests/private.env', 'desktop/node_modules/private.env']) {
  fs.mkdirSync(path.dirname(source + '/' + file), { recursive: true }); fs.writeFileSync(source + '/' + file, sentinel);
}
for (const dir of [studio, engine, fonts, runtime + '/Contents/MacOS', runtime + '/Contents/Resources']) fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(studio + '/index.html', '<!doctype html><title>Synthetic Studio fixture</title>');
fs.writeFileSync(studio + '/fixture.js', '/* synthetic packaging fixture, not the product UI */');
fs.writeFileSync(fonts + '/OFL.txt', 'Synthetic font-license fixture');
const wasm = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]);
for (const file of ['rhwp.js', 'rhwp.d.ts', 'rhwp_bg.wasm.d.ts']) fs.writeFileSync(engine + '/' + file, '// synthetic engine fixture\n');
fs.writeFileSync(engine + '/rhwp_bg.wasm', wasm);
fs.writeFileSync(runtime + '/Contents/MacOS/ElectronFixture', 'Synthetic non-executable runtime fixture. Never launch.');
execFileSync(python, ['-c', 'import plistlib,sys;open(sys.argv[1],"wb").write(plistlib.dumps({"CFBundleExecutable":"ElectronFixture","CFBundleName":"ElectronFixture"}))', runtime + '/Contents/Info.plist']);
const git = args => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false',
  '-c', 'user.name=Packaging Fixture', '-c', 'user.email=fixture@example.invalid', ...args], { cwd: source, stdio: 'pipe' });
git(['init', '-q']); git(['add', '-f', '.']); git(['commit', '-qm', 'Synthetic packaging fixture']);
const app = out + '/SyntheticBeta.app';
const raw = execFileSync(python, [source + '/scripts/package-merged-mac-beta.py', '--runtime-app', runtime,
  '--studio-dir', studio, '--engine-dir', engine, '--font-dir', fonts, '--output-app', app,
  '--expected-engine-sha256', sha(wasm), '--bundle-id', 'org.geulgyeol.fixture'], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
fs.writeFileSync(out + '/package-proof.json', raw);
const unpack = 'import importlib.util,json,base64,sys;spec=importlib.util.spec_from_file_location("helper",sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);_,v=m.read_archive(__import__("pathlib").Path(sys.argv[2]));print(json.dumps({k:base64.b64encode(b).decode() for k,b in v.items()}))';
const env = { ...process.env, PYTHONDONTWRITEBYTECODE: '1' };
const encoded = JSON.parse(execFileSync(python, ['-c', unpack, source + '/scripts/repackage-mac-candidate.py', app + '/Contents/Resources/app.asar'], { encoding: 'utf8', env, maxBuffer: 8 * 1024 * 1024 }));
const files = Object.fromEntries(Object.entries(encoded).map(([k, v]) => [k, Buffer.from(v, 'base64')]));
assert(Object.values(files).every(b => !b.includes(Buffer.from(sentinel))), 'tracked private/test/dependency canaries must not enter ASAR');
assert(Object.keys(files).every(n => !n.split('/').some(p => ['tests', 'node_modules', '.git', '.env'].includes(p))));
for (const name of ['main.cjs', 'preload.cjs', 'profile-server.cjs', 'server.cjs', 'storage.cjs', 'close-controller.cjs', 'document-shortcuts.cjs']) {
  assert.deepEqual(files[name], fs.readFileSync(root + '/desktop/' + name), name + ': exact current source');
}
const packageProof = JSON.parse(raw), build = JSON.parse(files['build-info.json']);
assert.equal(build.sourceCommit, git(['rev-parse', 'HEAD']).toString().trim());
assert.equal(build.engineSHA256, sha(wasm));
assert.equal(packageProof.version, JSON.parse(files['package.json']).version);
let bridgeName, quitCalls = 0;
const electron = { app: { setPath() {}, getPath: () => '/synthetic-profile', requestSingleInstanceLock: () => false, quit: () => { quitCalls++; } },
  contextBridge: { exposeInMainWorld: name => { bridgeName = name; } }, ipcRenderer: {} };
const cache = {}, loaded = [], nodeRequire = createRequire(import.meta.url);
function load(name) {
  if (cache[name]) return cache[name].exports;
  if (!files[name]) { const e = new Error('Missing packaged dependency: ' + name); e.code = 'MODULE_NOT_FOUND'; throw e; }
  const module = { exports: {} }; cache[name] = module; loaded.push(name);
  const require = spec => {
    if (spec === 'electron') return electron;
    if (isBuiltin(spec)) return nodeRequire(spec);
    assert(spec.startsWith('./') || spec.startsWith('../'), 'unexpected external dependency: ' + spec);
    return load(path.posix.normalize(path.posix.join(path.posix.dirname(name), spec)));
  };
  const fn = vm.runInNewContext('(function(require,module,exports,__dirname,__filename){\n' + files[name].toString() + '\n})',
    { URL, Buffer, process: { env: {}, platform: process.platform }, console });
  fn(require, module, module.exports, '/synthetic-asar/' + path.posix.dirname(name), '/synthetic-asar/' + name);
  return module.exports;
}
let error;
try { load('main.cjs'); load('preload.cjs'); } catch (e) { error = { code: e.code, message: e.message }; }
if (files['print-preview.cjs']) assert.deepEqual(files['print-preview.cjs'], fs.readFileSync(root + '/desktop/print-preview.cjs'));
const proof = { mode, syntheticRuntime: true, syntheticStudioEngineAndFonts: true, nativeAppLaunched: false,
  GUIVerified: false, printingVerified: false, signedOrReleased: false,
  packagerExecuted: true, archiveIntegrityReadback: true, privateCanariesExcluded: true,
  asarEntries: Object.keys(files).sort(), asarSHA256: sha(fs.readFileSync(app + '/Contents/Resources/app.asar')),
  packagedPrintPreview: !!files['print-preview.cjs'], mainAndPreloadLoaded: !error, loaded, error,
  version: packageProof.version, sourceSHA256: { packager: sha(fs.readFileSync(root + '/scripts/package-merged-mac-beta.py')),
    main: sha(fs.readFileSync(root + '/desktop/main.cjs')), print: sha(fs.readFileSync(root + '/desktop/print-preview.cjs')) },
  harnessSHA256: sha(fs.readFileSync(import.meta.filename)) };
fs.writeFileSync(out + '/proof.json', JSON.stringify(proof, null, 2));
console.log(JSON.stringify({ mode, packagedPrintPreview: proof.packagedPrintPreview, mainAndPreloadLoaded: !error, privateCanariesExcluded: true, error }));
if (mode === 'baseline') { assert.equal(error?.code, 'MODULE_NOT_FOUND'); assert.equal(error.message, 'Missing packaged dependency: print-preview.cjs'); }
else { assert.equal(error, undefined); assert.equal(quitCalls, 1); assert.equal(bridgeName, 'baram'); assert.equal(typeof cache['print-preview.cjs'].exports.installPrintPreview, 'function'); }

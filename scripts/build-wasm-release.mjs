// Offline, pinned release build. Remap at compilation, then verify before publishing.
// node scripts/build-wasm-release.mjs OUTPUT_DIR
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { auditSdk, sdkFiles } from './check-release-paths.mjs';
export function remapFlags(prefixes) {
  const mapping = Object.entries(prefixes).map(([kind, value]) => {
    const from = path.resolve(value);
    if (from === path.parse(from).root || /[=\x1f]/.test(from)) throw new Error('Unsupported remap prefix');
    return { from, to: '/geulgyeol/' + kind };
  }).sort((a, b) => a.from.length - b.from.length);
  if (new Set(mapping.map(x => x.from)).size !== mapping.length) throw new Error('Remap prefixes must be distinct');
  return mapping.map(x => '--remap-path-prefix=' + x.from + '=' + x.to);
}
export function checkOutput(directory) {
  if (!fs.existsSync(directory)) return;
  if (fs.lstatSync(directory).isSymbolicLink() || !fs.statSync(directory).isDirectory()) throw new Error('Output must be an ordinary directory');
  for (const name of fs.readdirSync(directory)) {
    const p = path.join(directory, name), stat = fs.lstatSync(p);
    if (![...sdkFiles, 'package.json'].includes(name) || !stat.isFile() || stat.isSymbolicLink()) throw new Error('Output contains non-generated or linked entries');
    if (name === 'package.json' && JSON.stringify(JSON.parse(fs.readFileSync(p))) !== JSON.stringify({ type: 'module' })) throw new Error('Unexpected output package metadata');
  }
}
export function releaseEnv(env, root) {
  for (const name of ['RUSTFLAGS', 'CARGO_ENCODED_RUSTFLAGS', 'CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUSTFLAGS', 'RUSTC_WRAPPER', 'RUSTC_WORKSPACE_WRAPPER']) {
    if (env[name]) throw new Error('Release build requires a clean ' + name);
  }
  const canonical = p => { const full = path.resolve(root, p); return fs.existsSync(full) ? fs.realpathSync(full) : full; };
  const prefixes = { source: canonical(root), cargo: canonical(env.CARGO_HOME || path.join(os.homedir(), '.cargo')),
    rustup: canonical(env.RUSTUP_HOME || path.join(os.homedir(), '.rustup')),
    target: canonical(env.CARGO_TARGET_DIR || path.join(root, 'engine/target')) };
  return { prefixes, env: { ...env, RUSTUP_TOOLCHAIN: '1.93.1', RUSTUP_AUTO_INSTALL: '0',
    CARGO_ENCODED_RUSTFLAGS: remapFlags(prefixes).join('\x1f') } };
}
export function build(output, inherited = process.env) {
  const root = fs.realpathSync(path.resolve(import.meta.dirname, '..'));
  output = path.resolve(output); checkOutput(output);
  const { env, prefixes } = releaseEnv(inherited, root);
  const cargo = env.CARGO || 'cargo', rustc = env.RUSTC || 'rustc', bindgen = env.WASM_BINDGEN || 'wasm-bindgen';
  const versions = {};
  for (const [name, command, expected] of [['cargo', cargo, '1.93.1'], ['rustc', rustc, '1.93.1'], ['wasm-bindgen', bindgen, '0.2.127']]) {
    const value = execFileSync(command, ['--version'], { cwd: root, env, encoding: 'utf8' }).trim();
    if (value.split(/\s+/)[1] !== expected) throw new Error('Unexpected ' + name + ' version');
    versions[name] = value;
  }
  execFileSync(cargo, ['build', '--offline', '--locked', '--release', '--target', 'wasm32-unknown-unknown', '--lib', '--manifest-path', root + '/engine/Cargo.toml'], { cwd: root, env, stdio: ['ignore', 'inherit', 'inherit'] });
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const stage = fs.mkdtempSync(path.join(path.dirname(output), '.wasm-release-'));
  try {
    execFileSync(bindgen, [path.join(prefixes.target, 'wasm32-unknown-unknown/release/rhwp.wasm'), '--target', 'web', '--out-dir', stage], { cwd: root, env, stdio: ['ignore', 'inherit', 'inherit'] });
    const audit = auditSdk(stage, Object.values(prefixes));
    if (!audit.clean) { console.error(JSON.stringify(audit)); throw new Error('SDK still contains build/user path metadata'); }
    fs.writeFileSync(stage + '/package.json', '{"type":"module"}\n');
    checkOutput(output); fs.mkdirSync(output, { recursive: true });
    // Rename complete staged files; never edit through an existing hardlink.
    for (const name of [...sdkFiles, 'package.json']) fs.renameSync(path.join(stage, name), path.join(output, name));
    const files = Object.fromEntries(sdkFiles.map(name => [name, createHash('sha256').update(fs.readFileSync(path.join(output, name))).digest('hex')]));
    return { remappedAtCompilation: true, offlineLocked: true, versions, audit, files };
  } finally { fs.rmSync(stage, { recursive: true, force: true }); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) console.log(JSON.stringify(build(process.argv[2] || 'pkg')));

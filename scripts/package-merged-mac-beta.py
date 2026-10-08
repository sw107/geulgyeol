#!/usr/bin/env python3
"""Create a fresh, isolated Mac beta from an official runtime and explicit assets.

Does not download, sign, remove old artifacts, or reuse an earlier application's
JavaScript. Sign the resulting bundle with sign-mac-bundle.sh before verification.
"""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import plistlib
import shutil
import struct
import subprocess
import sys

sys.dont_write_bytecode = True


def sha(data):
    return hashlib.sha256(data).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['runtime-app', 'studio-dir', 'engine-dir', 'font-dir', 'output-app']:
        parser.add_argument('--' + name, type=Path, required=True)
    parser.add_argument('--expected-engine-sha256', required=True)
    parser.add_argument('--bundle-id', required=True)
    parser.add_argument('--refresh-owned-output', action='store_true')
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    output, runtime = args.output_app.resolve(), args.runtime_app.resolve()
    if output.is_relative_to(runtime) or (output.exists() and not args.refresh_owned_output):
        raise ValueError('Use a separate nonexistent output app')
    if subprocess.check_output(['git', 'status', '--porcelain'], cwd=root).strip():
        raise ValueError('Commit the source before packaging')
    commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip()
    package = json.loads((root / 'desktop/package.json').read_text())
    product, version = package['productName'], package['version']
    contents, provenance = {}, {}

    def add(name, file):
        if file.is_symlink() or not file.is_file():
            raise ValueError('Only ordinary files may enter ASAR: ' + str(file))
        if name in contents:
            raise ValueError('Duplicate ASAR entry: ' + name)
        value = file.read_bytes()
        contents[name] = value
        provenance[name] = {'sha256': sha(value), 'source': str(file.resolve())}

    # Current tracked desktop code, SDK and licenses; old Studio is excluded.
    tracked = subprocess.check_output(['git', 'ls-files', '-z', 'desktop'], cwd=root).split(b'\0')
    required = {'main.cjs', 'preload.cjs', 'close-controller.cjs',
                'document-shortcuts.cjs', 'server.cjs', 'profile-server.cjs', 'storage.cjs',
                'package.json', 'LICENSE', 'THIRD_PARTY_NOTICES.md'}
    for raw in tracked:
        if not raw:
            continue
        relative = Path(raw.decode()).relative_to('desktop').as_posix()
        if relative in required or (relative.startswith('web/') and not relative.startswith('web/studio/')):
            add(relative, root / 'desktop' / relative)
    if not required.issubset(contents):
        raise ValueError('Missing current desktop runtime files')
    for file in sorted(args.studio_dir.rglob('*')):
        if file.is_file():
            add('web/studio/' + file.relative_to(args.studio_dir).as_posix(), file)
    for file in sorted(args.font_dir.rglob('*')):
        if file.is_file():
            add('web/studio/fonts/' + file.relative_to(args.font_dir).as_posix(), file)
    for name in ['rhwp.js', 'rhwp.d.ts', 'rhwp_bg.wasm', 'rhwp_bg.wasm.d.ts']:
        add('web/studio/' + name, args.engine_dir / name)
    wasm = [sha(value) for name, value in contents.items()
            if name.startswith('web/studio/') and ('rhwp_bg' in name) and name.endswith('.wasm')]
    if not wasm or set(wasm) != {args.expected_engine_sha256}:
        raise ValueError('Bundled and loose engines must match the verified engine')
    for name in ['main.cjs', 'web/index.html']:
        if version.encode() not in contents[name]:
            raise ValueError('Application version mismatch: ' + name)
    if any('dev-probe-plugin' in name for name in contents):
        raise ValueError('Use the production Studio build')
    build_info = {'sourceCommit': commit, 'version': version, 'product': product,
                  'engineSHA256': args.expected_engine_sha256,
                  'files': {name: data['sha256'] for name, data in provenance.items()}}
    contents['build-info.json'] = (json.dumps(build_info, indent=2) + '\n').encode()
    header, offset = {'files': {}}, 0
    for name, value in sorted(contents.items()):
        node = header
        parts = name.split('/')
        for part in parts[:-1]:
            node = node['files'].setdefault(part, {'files': {}})
        block = 4 * 1024 * 1024
        node['files'][parts[-1]] = {'size': len(value), 'offset': str(offset), 'integrity': {
            'algorithm': 'SHA256', 'hash': sha(value), 'blockSize': block,
            'blocks': [sha(value[i:i + block]) for i in range(0, len(value), block)]}}
        offset += len(value)
    raw_header = json.dumps(header, separators=(',', ':'), ensure_ascii=False).encode()
    padding = b'\0' * (-len(raw_header) % 4)
    pickle = struct.pack('<II', 4 + len(raw_header) + len(padding), len(raw_header)) + raw_header + padding
    # Copy bytes, never hardlink a runtime that will be resigned. Preserve source.
    if args.refresh_owned_output:
        existing = plistlib.loads((output / 'Contents/Info.plist').read_bytes())
        if existing['CFBundleIdentifier'] != args.bundle_id or existing['CFBundleExecutable'] != product:
            raise ValueError('Only the current task-owned candidate may be refreshed')
    else:
        shutil.copytree(runtime, output, symlinks=True,
                        ignore=shutil.ignore_patterns('default_app.asar', '_CodeSignature'))
    archive = output / 'Contents/Resources/app.asar'
    with archive.open('wb') as file:
        file.write(struct.pack('<II', 4, len(pickle)))
        file.write(pickle)
        for name in sorted(contents):
            file.write(contents[name])
    spec = importlib.util.spec_from_file_location('helpers', root / 'scripts/repackage-mac-candidate.py')
    helper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)
    info_path = output / 'Contents/Info.plist'
    info = plistlib.loads(info_path.read_bytes())
    helper.rename_runtime(output, info['CFBundleExecutable'], product, args.bundle_id)
    info.update(CFBundleName=product, CFBundleDisplayName=product,
                CFBundleExecutable=product, CFBundleIdentifier=args.bundle_id,
                CFBundleVersion=version, CFBundleShortVersionString=version)
    info['ElectronAsarIntegrity'] = {'Resources/app.asar': {'algorithm': 'SHA256', 'hash': sha(raw_header)}}
    info_path.write_bytes(plistlib.dumps(info))
    _, actual = helper.read_archive(archive)
    if actual != contents:
        raise ValueError('Fresh ASAR differs from expected source bytes')
    print(json.dumps({'app': str(output), 'sourceCommit': commit, 'version': version,
                      'bundleId': args.bundle_id, 'profileName': product,
                      'engineSHA256': args.expected_engine_sha256,
                      'asarSHA256': sha(archive.read_bytes()), 'asarHeaderSHA256': sha(raw_header),
                      'freshDesktopFiles': sorted(required), 'files': provenance,
                      'requiresAdHocResigning': True}, indent=2))


if __name__ == '__main__':
    main()

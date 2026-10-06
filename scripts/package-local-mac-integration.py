#!/usr/bin/env python3
"""Build one isolated local Mac candidate from fresh Studio and WASM artifacts."""
import argparse
import hashlib
import importlib.util
import json
import pathlib
import plistlib
import shutil
import struct


def sha(data):
    return hashlib.sha256(data).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-app", type=pathlib.Path, required=True)
    parser.add_argument("--studio-dir", type=pathlib.Path, required=True)
    parser.add_argument("--output-app", type=pathlib.Path, required=True)
    args = parser.parse_args()
    root = pathlib.Path(__file__).resolve().parent.parent
    spec = importlib.util.spec_from_file_location("candidate_helpers", root / "scripts/repackage-mac-candidate.py")
    helper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)
    source, output = args.source_app.resolve(), args.output_app.resolve()
    if output.exists() or source == output or output.is_relative_to(source):
        raise ValueError("Use a separate nonexistent output app")
    archive = source / "Contents/Resources/app.asar"
    source_hash = sha(archive.read_bytes())
    if source_hash != "95071ec51add351b31c9ca77e6589cc2f4afbfb0d0264600abfb9eb0a082941b":
        raise ValueError("Expected the preserved verified beta1 runtime")
    old_header, contents = helper.read_archive(archive)
    old_nodes = dict(helper.entries(old_header))
    contents = {name: data for name, data in contents.items()
                if not name.startswith("web/studio/") or name.startswith("web/studio/fonts/")}
    for file in args.studio_dir.resolve().rglob("*"):
        if file.is_file():
            contents["web/studio/" + file.relative_to(args.studio_dir.resolve()).as_posix()] = file.read_bytes()
    for name in ["rhwp.js", "rhwp.d.ts", "rhwp_bg.wasm", "rhwp_bg.wasm.d.ts"]:
        contents["web/studio/" + name] = (root / "pkg" / name).read_bytes()
    product, bundle_id, version = "GeulgyeolDevEnter", "org.geulgyeol.dev.enter", "0.4.4-dev.5"
    package = json.loads((root / "desktop/package.json").read_text())
    package.update(name="geulgyeol-dev-enter", productName=product, version=version)
    contents["package.json"] = (json.dumps(package, ensure_ascii=False, indent=2) + "\n").encode()
    main_text = (root / "desktop/main.cjs").read_text().replace("GeulgyeolBetaNext", product).replace("0.4.4-beta.1", version).replace("글결 베타", "글결 개발 후보")
    old_profile = "path.join(app.getPath('appData'),'" + product + "')"
    assert old_profile in main_text
    main_text = main_text.replace(old_profile, "path.join(process.env.GEULGYEOL_DEV_PROFILE_ROOT||app.getPath('appData'),'" + product + "')")
    contents["main.cjs"] = main_text.encode()
    contents["web/index.html"] = (root / "desktop/web/index.html").read_text().replace("0.4.4-beta.1", version).replace("글결 베타", "글결 개발 후보").encode()
    header, offset = {"files": {}}, 0
    for name, value in sorted(contents.items()):
        node = header
        parts = name.split("/")
        for part in parts[:-1]:
            node = node["files"].setdefault(part, {"files": {}})
        block_size = old_nodes.get(name, {}).get("integrity", {}).get("blockSize", 4 * 1024 * 1024)
        node["files"][parts[-1]] = {"size": len(value), "offset": str(offset), "integrity": {
            "algorithm": "SHA256", "hash": sha(value), "blockSize": block_size,
            "blocks": [sha(value[i:i + block_size]) for i in range(0, len(value), block_size)]}}
        offset += len(value)
    raw_header = json.dumps(header, separators=(",", ":"), ensure_ascii=False).encode()
    padding = b"\0" * (-len(raw_header) % 4)
    pickle = struct.pack("<II", 4 + len(raw_header) + len(padding), len(raw_header)) + raw_header + padding
    shutil.copytree(source, output, symlinks=True)
    new_archive = output / "Contents/Resources/app.asar"
    with new_archive.open("wb") as file:
        file.write(struct.pack("<II", 4, len(pickle)))
        file.write(pickle)
        for name in sorted(contents):
            file.write(contents[name])
    info_path = output / "Contents/Info.plist"
    info = plistlib.loads(info_path.read_bytes())
    helper.rename_runtime(output, info["CFBundleExecutable"], product, bundle_id)
    info.update(CFBundleName=product, CFBundleDisplayName=product, CFBundleExecutable=product,
                CFBundleIdentifier=bundle_id, CFBundleVersion=version, CFBundleShortVersionString=version)
    info["ElectronAsarIntegrity"] = {"Resources/app.asar": {"algorithm": "SHA256", "hash": sha(raw_header)}}
    info_path.write_bytes(plistlib.dumps(info))
    _, actual = helper.read_archive(new_archive)
    assert actual == contents
    assert sha(archive.read_bytes()) == source_hash
    print(json.dumps({"app": str(output), "version": version, "product": product,
                      "bundleId": bundle_id, "profileName": product, "sourceAppUnchanged": True,
                      "files": len(contents), "engineSHA256": sha(actual["web/studio/rhwp_bg.wasm"]),
                      "asarSHA256": sha(new_archive.read_bytes()), "asarHeaderSHA256": sha(raw_header),
                      "requiresAdHocResigning": True, "newZipCreated": False}, indent=2))


if __name__ == "__main__":
    main()

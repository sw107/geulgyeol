#!/usr/bin/env python3
"""Verify packaged assets and extract only bindings for headless engine checks."""
import argparse
import hashlib
import importlib.util
import json
import pathlib
import plistlib
import struct


def sha(data):
    return hashlib.sha256(data).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--app", type=pathlib.Path, required=True)
    parser.add_argument("--studio-dir", type=pathlib.Path, required=True)
    parser.add_argument("--output-dir", type=pathlib.Path, required=True)
    parser.add_argument("--required-ui-method", action="append", default=[])
    parser.add_argument("--source-proof", type=pathlib.Path)
    parser.add_argument("--engine-dir", type=pathlib.Path)
    args = parser.parse_args()
    root = pathlib.Path(__file__).resolve().parent.parent
    spec = importlib.util.spec_from_file_location("asar", root / "scripts/repackage-mac-candidate.py")
    helper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)
    app, output = args.app.resolve(), args.output_dir.resolve()
    if output.is_relative_to(app):
        raise ValueError("Verification output must stay outside the signed app")
    for link in app.rglob("*"):
        if link.is_symlink():
            assert link.resolve().is_relative_to(app), str(link)
    output.mkdir(parents=True, exist_ok=True)
    archive = app / "Contents/Resources/app.asar"
    header, contents = helper.read_archive(archive)
    data = archive.read_bytes()
    header_size = struct.unpack("<4I", data[:16])[3]
    header_sha = sha(data[16:16 + header_size])
    info = plistlib.loads((app / "Contents/Info.plist").read_bytes())
    assert info["ElectronAsarIntegrity"]["Resources/app.asar"]["hash"] == header_sha
    package = json.loads(contents["package.json"])
    product, version, bundle_id = package["productName"], package["version"], info["CFBundleIdentifier"]
    assert info["CFBundleExecutable"] == product
    assert info["CFBundleVersion"] == info["CFBundleShortVersionString"] == version
    assert version.encode() in contents["main.cjs"] and version.encode() in contents["web/index.html"]
    assert b"GEULGYEOL_DEV_PROFILE_ROOT" in contents["main.cjs"]
    assert product.encode() in contents["main.cjs"]
    assert not any(n.startswith(("tests/", "node_modules/")) for n in contents)
    for name, node in helper.entries(header):
        value = contents[name]
        size = node["integrity"]["blockSize"]
        assert node["integrity"]["blocks"] == [sha(value[i:i + size]) for i in range(0, len(value), size)]
    helpers = []
    for path in sorted((app / "Contents/Frameworks").glob(product + " Helper*.app")):
        item = plistlib.loads((path / "Contents/Info.plist").read_bytes())
        assert item["CFBundleName"] == item["CFBundleExecutable"] == path.stem
        assert item["CFBundleIdentifier"].startswith(bundle_id + ".helper")
        assert (path / "Contents/MacOS" / item["CFBundleExecutable"]).is_file()
        helpers.append({"name": path.stem, "bundleId": item["CFBundleIdentifier"]})
    assert len(helpers) == 4
    assets = {}
    for file in args.studio_dir.resolve().rglob("*"):
        if file.is_file():
            name = file.relative_to(args.studio_dir.resolve()).as_posix()
            assert contents["web/studio/" + name] == file.read_bytes(), name
            assets[name] = sha(contents["web/studio/" + name])
    engine = output / "packaged-engine"
    engine.mkdir(exist_ok=True)
    engine_dir = args.engine_dir.resolve() if args.engine_dir else root / "pkg"
    for name in ["rhwp.js", "rhwp.d.ts", "rhwp_bg.wasm", "rhwp_bg.wasm.d.ts"]:
        value = contents["web/studio/" + name]
        assert value == (engine_dir / name).read_bytes(), name
        (engine / name).write_bytes(value)
    (engine / "package.json").write_text('{"type":"module"}\n')
    engine_sha = sha(contents["web/studio/rhwp_bg.wasm"])
    hashed_engine = [n for n in assets if n.startswith("assets/rhwp_bg-") and n.endswith(".wasm")]
    assert len(hashed_engine) == 1 and assets[hashed_engine[0]] == engine_sha
    compiled_ui = b"\n".join(value for name, value in contents.items() if name.startswith("web/studio/") and name.endswith(".js"))
    new_methods = ["applyCellOwnPropertiesByPaths", "applyFormatCopyInCell", "getCellOwnPropertiesByPath", "getCellParaPropertiesAtByPath"]
    new_methods = list(dict.fromkeys(new_methods + args.required_ui_method))
    assert all(n.encode() in compiled_ui for n in new_methods)
    source_hashes = {}
    if args.source_proof:
        source_hashes = json.loads(args.source_proof.read_text())["sourceSHA256"]
        for name, digest in source_hashes.items():
            source = (root / name).resolve()
            assert source.is_relative_to(root) and sha(source.read_bytes()) == digest, name
    proof = {"app": str(app), "version": version, "bundleId": bundle_id, "helpers": helpers,
             "asarSHA256": sha(data), "asarHeaderSHA256": header_sha, "allEntryAndBlockIntegrityVerified": True,
             "freshBindingsAndStudioAssetsMatch": True, "engineSHA256": engine_sha,
             "compiledUIMethods": new_methods, "assets": assets, "profileIsolated": True,
             "onlyBindingsExtracted": True, "allSymlinksStayInsideCandidate": True, "noTestsOrNodeModulesInApp": True, "GUIVerified": False}
    if args.source_proof:
        proof.update(productSourceSHA256=source_hashes, sourceFreezeProof=str(args.source_proof.resolve()))
    (output / "package-verification.json").write_text(json.dumps(proof, indent=2) + "\n")
    print(json.dumps({k: v for k, v in proof.items() if k != "assets"}, indent=2))


if __name__ == "__main__":
    main()

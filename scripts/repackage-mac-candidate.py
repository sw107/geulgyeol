#!/usr/bin/env python3
"""Repackage a verified Mac candidate without rebuilding its engine or renderer."""
import argparse
import copy
import hashlib
import json
import pathlib
import plistlib
import shutil
import struct


ENGINE_SHA = "ccac2d483f32fdfeea8dc717bf8f3767b91e7301a1b0f63b3586d77261b3c1d8"


def sha(data):
    return hashlib.sha256(data).hexdigest()


def entries(node, prefix=""):
    for name, child in node.get("files", {}).items():
        path = prefix + name
        if "files" in child:
            yield from entries(child, path + "/")
        else:
            yield path, child


def read_archive(path):
    data = path.read_bytes()
    fields = struct.unpack("<4I", data[:16])
    if fields[0] != 4 or fields[2] + 4 != fields[1]:
        raise ValueError("Unsupported ASAR header")
    header = json.loads(data[16:16 + fields[3]])
    base = 8 + fields[1]
    contents = {}
    for name, node in entries(header):
        if node.get("link") or node.get("unpacked"):
            raise ValueError("Linked/unpacked ASAR entries are unsupported")
        start = base + int(node["offset"])
        value = data[start:start + node["size"]]
        if len(value) != node["size"] or sha(value) != node["integrity"]["hash"]:
            raise ValueError("ASAR file integrity mismatch: " + name)
        contents[name] = value
    return header, contents


def rename_runtime(app, old_executable, new_executable, bundle_id):
    """Keep Electron's main executable and helper bundle naming in agreement."""
    executable = app / "Contents/MacOS" / old_executable
    executable.rename(executable.with_name(new_executable))
    frameworks = app / "Contents/Frameworks"
    for helper in frameworks.glob(old_executable + " Helper*.app"):
        name = helper.stem.replace(old_executable, new_executable, 1)
        path = helper / "Contents/Info.plist"
        info = plistlib.loads(path.read_bytes())
        old_helper_exe = info["CFBundleExecutable"]
        new_helper_exe = old_helper_exe.replace(old_executable, new_executable, 1)
        helper_exe = helper / "Contents/MacOS" / old_helper_exe
        helper_exe.rename(helper_exe.with_name(new_helper_exe))
        suffix = {" (GPU)": ".GPU", " (Renderer)": ".Renderer", " (Plugin)": ".Plugin"}
        role = name.removeprefix(new_executable + " Helper")
        info.update(CFBundleName=name, CFBundleDisplayName=name,
                    CFBundleExecutable=new_helper_exe,
                    CFBundleIdentifier=bundle_id + ".helper" + suffix.get(role, ""))
        path.write_bytes(plistlib.dumps(info))
        helper.rename(helper.with_name(name + ".app"))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-app", type=pathlib.Path, required=True)
    parser.add_argument("--output-app", type=pathlib.Path, required=True)
    args = parser.parse_args()
    source, output = args.source_app.resolve(), args.output_app.resolve()
    if source == output or output.is_relative_to(source) or output.exists():
        raise ValueError("Use a separate, nonexistent output app")
    root = pathlib.Path(__file__).resolve().parent.parent
    header, contents = read_archive(source / "Contents/Resources/app.asar")
    engine = "web/studio/rhwp_bg.wasm"
    if sha(contents[engine]) != ENGINE_SHA:
        raise ValueError("Input engine is not the verified dev.4 engine")
    replacements = ["package.json", "main.cjs", "web/index.html"]
    for name in replacements:
        contents[name] = (root / "desktop" / name).read_bytes()
    version = json.loads(contents["package.json"])["version"]
    if version != "0.4.4-beta.1":
        raise ValueError("Unexpected release version")
    for name in ["main.cjs", "web/index.html"]:
        if version.encode() not in contents[name]:
            raise ValueError("Version label mismatch: " + name)
    updated = copy.deepcopy(header)
    offset = 0
    for name, node in entries(updated):
        value = contents[name]
        block_size = node["integrity"]["blockSize"]
        node["size"], node["offset"] = len(value), str(offset)
        node["integrity"] = {
            "algorithm": "SHA256", "hash": sha(value), "blockSize": block_size,
            "blocks": [sha(value[i:i + block_size]) for i in range(0, len(value), block_size)],
        }
        offset += len(value)
    raw_header = json.dumps(updated, separators=(",", ":"), ensure_ascii=False).encode()
    padding = b"\0" * (-len(raw_header) % 4)
    payload_size = 4 + len(raw_header) + len(padding)
    header_pickle = struct.pack("<II", payload_size, len(raw_header)) + raw_header + padding
    shutil.copytree(source, output, symlinks=True)
    archive = output / "Contents/Resources/app.asar"
    with archive.open("wb") as file:
        file.write(struct.pack("<II", 4, len(header_pickle)))
        file.write(header_pickle)
        for name, _ in entries(updated):
            file.write(contents[name])
    info_path = output / "Contents/Info.plist"
    info = plistlib.loads(info_path.read_bytes())
    rename_runtime(output, info["CFBundleExecutable"], "GeulgyeolBetaNext", "org.geulgyeol.beta.next")
    info.update(CFBundleName="GeulgyeolBetaNext", CFBundleDisplayName="GeulgyeolBetaNext",
                CFBundleExecutable="GeulgyeolBetaNext",
                CFBundleIdentifier="org.geulgyeol.beta.next",
                CFBundleVersion=version, CFBundleShortVersionString=version)
    info["ElectronAsarIntegrity"] = {
        "Resources/app.asar": {"algorithm": "SHA256", "hash": sha(raw_header)}
    }
    info_path.write_bytes(plistlib.dumps(info))
    _, actual = read_archive(archive)
    if actual != contents:
        raise ValueError("Repacked archive differs from expected bytes")
    print(json.dumps({"version": version, "app": str(output), "files": len(contents),
                      "engineSHA256": sha(actual[engine]),
                      "asarSHA256": sha(archive.read_bytes()),
                      "asarHeaderSHA256": sha(raw_header),
                      "replacedFiles": replacements, "requiresResigning": True}, indent=2))


if __name__ == "__main__":
    main()

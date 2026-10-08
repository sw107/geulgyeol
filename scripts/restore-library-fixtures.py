#!/usr/bin/env python3
"""Verify or restore only reviewed public fixtures from a pinned upstream commit."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import subprocess
import tempfile
from urllib.parse import quote


def verify(data, entry):
    blob = b"blob " + str(len(data)).encode() + b"\0" + data
    if (len(data) != entry["size"]
            or hashlib.sha1(blob).hexdigest() != entry["gitBlob"]
            or hashlib.sha256(data).hexdigest() != entry["sha256"]):
        raise ValueError("Fixture hash mismatch: " + entry["path"])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group()
    source.add_argument("--cache", type=Path, help="Read source paths under this cache root")
    source.add_argument("--download", action="store_true", help="Fetch reviewed pinned files with curl TLS verification")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    manifest = json.loads((root / "verification/library-fixtures/restoration-manifest.json").read_text())
    restored = 0
    for entry in manifest["files"]:
        relative = PurePosixPath(entry["path"])
        if relative.is_absolute() or ".." in relative.parts or entry["destination"] != "engine/" + str(relative):
            raise ValueError("Invalid fixture destination")
        target = root / entry["destination"]
        if target.exists():
            verify(target.read_bytes(), entry)
            continue
        if not args.cache and not args.download:
            raise FileNotFoundError(str(target) + "; use --cache or --download to restore")
        if args.cache:
            data = (args.cache / str(relative)).read_bytes()
        else:
            url = "https://raw.githubusercontent.com/edwardkim/rhwp/" + manifest["commit"] + "/" + quote(str(relative))
            with tempfile.TemporaryDirectory(prefix="geulgyeol-fixture-") as temporary:
                downloaded = Path(temporary) / "download"
                subprocess.run(["curl", "--fail", "--silent", "--show-error", "--location",
                                "--max-time", "45", "--output", str(downloaded), url], check=True)
                data = downloaded.read_bytes()
        verify(data, entry)
        target.parent.mkdir(parents=True, exist_ok=True)
        # An existing nonmatching file is never replaced; verify it above instead.
        with target.open("xb") as output:
            output.write(data)
        restored += 1
    print(json.dumps({"verifiedFiles": len(manifest["files"]), "restoredFiles": restored,
                      "blockedOriginals": len(manifest["blockedOriginals"])}))


if __name__ == "__main__":
    main()

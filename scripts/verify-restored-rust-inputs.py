"""Verify the four restored inputs against their pinned upstream Git blobs."""
from pathlib import Path
import hashlib
import json

root = Path(__file__).resolve().parent.parent
manifest = json.loads((root / "engine/samples/UPSTREAM_TEST_INPUTS.json").read_text(encoding="utf-8"))
for entry in manifest["inputs"]:
    path = root / entry["path"]
    assert path.is_file() and not path.is_symlink(), entry["path"]
    data = path.read_bytes()
    assert len(data) == entry["bytes"], entry["path"]
    assert hashlib.sha256(data).hexdigest() == entry["sha256"], entry["path"]
    git_object = b"blob " + str(len(data)).encode() + b"\0" + data
    assert hashlib.sha1(git_object).hexdigest() == entry["gitBlobOID"], entry["path"]
    print(f"Verified {entry['path']} ({len(data)} bytes)")
print(f"All {len(manifest['inputs'])} restored inputs match upstream {manifest['upstreamCommit']}.")

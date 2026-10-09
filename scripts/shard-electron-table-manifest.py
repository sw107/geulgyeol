#!/usr/bin/env python3
"""Stream a large Electron manifest into bounded per-save Native evidence.

Usage: shard-electron-table-manifest.py MANIFEST_JSON FRESH_OUTPUT_DIR [NATIVE_BINARY] [--scratch]
The original evidence remains unchanged. No fixture contents enter the index.
"""
import gzip
import hashlib
import json
from pathlib import Path
import subprocess
import sys


def digest(file):
    with Path(file).open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def rows(file):
    decoder = json.JSONDecoder()
    opener = gzip.open if str(file).endswith(".gz") else open
    with opener(file, "rt", encoding="utf-8") as stream:
        buffer = stream.read(1024 * 1024).lstrip()
        assert buffer.startswith("["), "array manifest required"
        buffer = buffer[1:]
        after_row = False
        while True:
            buffer = buffer.lstrip()
            while not buffer:
                buffer = stream.read(1024 * 1024).lstrip()
                assert buffer, "incomplete manifest"
            if buffer.startswith("]"):
                assert not (buffer[1:] + stream.read()).strip(), "trailing data"
                return
            if after_row:
                assert buffer.startswith(","), "row separator required"
                buffer = buffer[1:].lstrip()
            while True:
                try:
                    row, end = decoder.raw_decode(buffer)
                    break
                except json.JSONDecodeError:
                    more = stream.read(1024 * 1024)
                    assert more, "incomplete or invalid manifest row"
                    buffer += more
            yield row
            buffer = buffer[end:]
            after_row = True


def main():
    source, output = Path(sys.argv[1]), Path(sys.argv[2])
    native = Path(sys.argv[3]).resolve() if len(sys.argv) > 3 else None
    scratch = len(sys.argv) > 4 and sys.argv[4] == "--scratch"
    assert len(sys.argv) <= 5 and (len(sys.argv) != 5 or scratch)
    assert not scratch or native, "scratch mode requires immediate Native verification"
    source_before = digest(source)
    raw_hash = hashlib.sha256()
    raw_bytes = 0
    opener = gzip.open if source.suffix == ".gz" else open
    with opener(source, "rb") as stream:
        while chunk := stream.read(1024 * 1024):
            raw_hash.update(chunk)
            raw_bytes += len(chunk)
    uncompressed_sha = raw_hash.hexdigest()
    native_before = digest(native) if native else None
    assert not output.exists(), "fresh output required"
    output.mkdir(parents=True)
    index = []
    for i, row in enumerate(rows(source)):
        manifest = output / ("case-scratch.json" if scratch else f"case-{i:04d}.json")
        manifest.write_text(json.dumps([row], ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        item = {"manifest": manifest.name, "manifestSHA256": digest(manifest), "savedFile": Path(row["file"]).name, "savedSHA256": digest(row["file"]), "pages": row["pageCount"]}
        if native:
            destination = output / f"native-{i:04d}"
            log = output / f"native-{i:04d}.log"
            with log.open("w") as stream:
                result = subprocess.run([str(native), str(manifest.resolve()), str(destination.resolve())], stdout=stream, stderr=subprocess.STDOUT)
            assert result.returncode == 0, f"Native comparison failed at case {i}"
            item["nativeExitCode"] = result.returncode
            item["nativeSame"] = True
            item["overflowWarnings"] = log.read_text().count("LAYOUT_OVERFLOW")
            assert item["overflowWarnings"] == 0, f"saved case overflow at {i}"
        index.append(item)
    assert source_before == digest(source) and native_before == (digest(native) if native else None), "verification inputs changed"
    proof = {"sourceEncoding": "gzip" if source.suffix == ".gz" else "json", "sourceUncompressedBytes": raw_bytes, "sourceUncompressedSHA256": uncompressed_sha, "evidenceMode": "immutable-source-with-reused-scratch" if scratch else "retained-shards", "scratchIsCanonicalEvidence": False, "verificationInputsUnchanged": True, "cases": len(index), "sourceManifestSHA256": digest(source), "sourceManifestBytes": source.stat().st_size, "nativeSHA256": digest(native) if native else None, "rows": index}
    (output / "index.json").write_text(json.dumps(proof, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"cases": len(index), "nativeCompared": bool(native), "sourceManifestBytes": source.stat().st_size}), flush=True)


if __name__ == "__main__":
    main()

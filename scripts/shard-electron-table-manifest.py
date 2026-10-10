#!/usr/bin/env python3
"""Stream a large Electron manifest into bounded per-save Native evidence.

Usage: shard-electron-table-manifest.py MANIFEST_JSON FRESH_OUTPUT_DIR [NATIVE_BINARY] [--scratch]
The original evidence remains unchanged. No fixture contents enter the index.
"""
import gzip
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
sys.dont_write_bytecode = True
from native_qa_budget import BudgetClient, run_native


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
                    assert len(buffer) <= 32 * 1024 * 1024, "bounded manifest row required"
            yield row
            buffer = buffer[end:]
            after_row = True


def main():
    source, output = Path(sys.argv[1]), Path(sys.argv[2]).resolve()
    native = Path(sys.argv[3]).resolve() if len(sys.argv) > 3 else None
    scratch = len(sys.argv) > 4 and sys.argv[4] == "--scratch"
    assert len(sys.argv) <= 5 and (len(sys.argv) != 5 or scratch)
    assert not scratch or native, "scratch mode requires immediate Native verification"
    assert not output.exists(), "fresh output required"
    assert os.environ.get("GEULGYEOL_QA_BUDGET_ROOT"), "explicit whole-run budget root required"
    output.mkdir(parents=True)
    budget = None
    index = []
    status = output / "native-wrapper-status.json"
    source_before = native_before = None
    code_paths = [Path(__file__), Path(__file__).with_name("native_qa_budget.py"),
                  Path(__file__).with_name("qa-evidence-budget-bridge.mjs"),
                  Path(__file__).with_name("qa-evidence-budget.mjs")]
    code_before = {p.name: digest(p) for p in code_paths}
    try:
        budget = BudgetClient(output)
        source_before, native_before = digest(source), digest(native) if native else None
        status.write_text(json.dumps({"complete": False, "cases": 0}) + "\n")
        raw_hash, raw_bytes = hashlib.sha256(), 0
        opener = gzip.open if source.suffix == ".gz" else open
        with opener(source, "rb") as stream:
            while chunk := stream.read(1024 * 1024):
                raw_hash.update(chunk)
                raw_bytes += len(chunk)
                if raw_bytes % (16 * 1024 * 1024) == 0:
                    budget.check()
        uncompressed_sha = raw_hash.hexdigest()
        for i, row in enumerate(rows(source)):
            data = json.dumps([row], ensure_ascii=False, separators=(",", ":")).encode()
            assert len(data) <= 32 * 1024 * 1024, "bounded per-case scratch required"
            native_forecast = 16 * 1024 * 1024 if native else 0
            budget.check(len(data) + native_forecast + 16384)
            manifest = output / ("case-scratch.json" if scratch else f"case-{i:04d}.json")
            manifest.write_bytes(data)
            item = {"manifest": manifest.name, "manifestSHA256": digest(manifest),
                    "savedFile": Path(row["file"]).name, "savedSHA256": digest(row["file"]),
                    "pages": row["pageCount"]}
            if native:
                destination = output / f"native-{i:04d}"
                log = output / f"native-{i:04d}.log"
                code = run_native([str(native), str(manifest), str(destination)], log, budget)
                assert code == 0, f"Native comparison failed at case {i}: exit {code}"
                item["nativeExitCode"] = code
                item["nativeSame"] = True
                # Count warnings in bounded chunks rather than retaining the full log.
                warnings = 0
                with log.open(encoding="utf-8") as stream:
                    for line in stream:
                        warnings += line.count("LAYOUT_OVERFLOW")
                item["overflowWarnings"] = warnings
                assert warnings == 0, f"saved case overflow at {i}"
            index.append(item)
            budget.check(4096)
            status.write_text(json.dumps({"complete": False, "cases": len(index)}) + "\n")
        assert source_before == digest(source), "source manifest changed"
        assert native_before == (digest(native) if native else None), "Native binary changed"
        code_after = {p.name: digest(p) for p in code_paths}
        assert code_before == code_after, "Native wrapper sources changed"
        proof = {"sourceEncoding": "gzip" if source.suffix == ".gz" else "json",
                 "sourceUncompressedBytes": raw_bytes, "sourceUncompressedSHA256": uncompressed_sha,
                 "evidenceMode": "immutable-source-with-reused-scratch" if scratch else "retained-shards",
                 "scratchIsCanonicalEvidence": False, "verificationInputsUnchanged": True,
                 "cases": len(index), "sourceManifestSHA256": source_before,
                 "sourceManifestBytes": source.stat().st_size, "nativeSHA256": native_before,
                 "qaSourceBeforeSHA256": code_before, "qaSourceAfterSHA256": code_after,
                 "budgetPreflight": budget.preflight, "rows": index}
        data = (json.dumps(proof, indent=2) + "\n").encode()
        budget.check(len(data) + 8192)
        partial = output / "index.json.partial"
        partial.write_bytes(data)
        with partial.open("rb") as stream:
            os.fsync(stream.fileno())
        assert partial.read_bytes() == data, "disk index bytes changed"
        # Only the newly-created wrapper stage is promoted; no old file is replaced.
        os.link(partial, output / "index.json")
        partial.unlink()
        status.write_text(json.dumps({"complete": True, "cases": len(index)}) + "\n")
        budget.mark("complete")
        print(json.dumps({"cases": len(index), "nativeCompared": bool(native),
                          "sourceManifestBytes": source.stat().st_size}), flush=True)
    except BaseException as error:
        if budget and budget.started and not budget.finished:
            budget.mark("failed")
            status.write_text(json.dumps({"complete": False, "cases": len(index),
                                          "failure": str(error)[:4096]}) + "\n")
        raise
    finally:
        if budget:
            budget.close()


if __name__ == "__main__":
    main()

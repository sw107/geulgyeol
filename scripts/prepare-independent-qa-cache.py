#!/usr/bin/env python3
"""Seed the bounded native/test crate set from crates.io, verifying Cargo.lock."""
import argparse
import hashlib
import importlib.util
import json
import os
import re
import subprocess
import tempfile
import tomllib
import urllib.parse
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REGISTRY = "registry+https://github.com/rust-lang/crates.io-index"

def check_budget():
    spec = importlib.util.spec_from_file_location("geulgyeol_qa_budget", ROOT / "scripts/run-independent-qa.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.capacity()

def owned(path):
    if not path.is_relative_to(ROOT) or path.resolve() != path:
        raise RuntimeError(f"External or linked path: {path}")
    return path

def digest(path):
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for data in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(data)
    return h.hexdigest()

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--report", required=True, help="Fresh report below .geulgyeol-local")
    args = parser.parse_args()
    report = owned(ROOT / args.report)
    if not report.is_relative_to(ROOT / ".geulgyeol-local") or report.exists():
        raise RuntimeError("Report must be a fresh .geulgyeol-local file")
    packages = json.loads((ROOT / "scripts/independent-qa-crates.json").read_text())["packages"]
    lock_path = ROOT / "engine/Cargo.lock"
    lock_sha = digest(lock_path)
    lock = tomllib.loads(lock_path.read_text())
    locked = {(p["name"], p["version"]): p["checksum"] for p in lock["package"] if p.get("source") == REGISTRY}
    cache = owned(ROOT / ".geulgyeol-tools/cargo-home/registry/cache/index.crates.io-1949cf8c6b5b557f")
    cache.mkdir(parents=True, exist_ok=True)
    report.parent.mkdir(parents=True, exist_ok=True)
    rows = []
    capacity_before = check_budget()
    # Resolve every lock pin before any download, refusing lock/recipe drift.
    selected = []
    for package in packages:
        name, version = package["name"], package["version"]
        if not re.fullmatch(r"[A-Za-z0-9_-]+", name) or not re.fullmatch(r"[0-9A-Za-z.+-]+", version):
            raise RuntimeError("Invalid crate selector")
        selected.append((name, version, locked[(name, version)]))
    if len(set((n, v) for n, v, _ in selected)) != len(selected):
        raise RuntimeError("Duplicate crate selector")
    for name, version, expected in selected:
        check_budget()
        destination = owned(cache / f"{name}-{version}.crate")
        url = f"https://static.crates.io/crates/{name}/{name}-{version}.crate"
        downloaded = False
        if destination.exists():
            if not destination.is_file() or digest(destination) != expected:
                raise RuntimeError(f"Existing archive mismatch; preserved: {destination}")
        else:
            fd, temporary = tempfile.mkstemp(prefix=".geulgyeol-qa-download-", dir=cache)
            temporary = Path(temporary)
            try:
                os.close(fd)
                # Use the host's normal verified TLS roots; never disable verification.
                effective = subprocess.check_output([
                    "curl", "--fail", "--location", "--silent", "--show-error",
                    "--proto", "=https", "--proto-redir", "=https", "--max-time", "30",
                    "--max-filesize", str(8 * 1024**2), "--output", str(temporary),
                    "--write-out", "%{url_effective}", url], text=True)
                if urllib.parse.urlparse(effective).hostname != "static.crates.io":
                    raise RuntimeError("Unexpected download host")
                if temporary.stat().st_size > 8 * 1024**2:
                    raise RuntimeError("Crate download size cap exceeded")
                check_budget()
                if digest(temporary) != expected:
                    raise RuntimeError(f"Official archive does not match lock: {name}-{version}")
                # Atomic no-overwrite install. Remove only this invocation's own temporary.
                os.link(temporary, destination)
                downloaded = True
            finally:
                temporary.unlink(missing_ok=True)
        rows.append(dict(name=name, version=version, SHA256=expected, source=url,
                         path=str(destination.relative_to(ROOT)), bytes=destination.stat().st_size,
                         downloaded=downloaded))
        print(f"verified {name}-{version}", flush=True)
    if digest(lock_path) != lock_sha:
        raise RuntimeError("Cargo.lock changed during download")
    with report.open("x") as stream:
        json.dump(dict(lockSHA256=lock_sha, officialRegistry=True, packages=rows,
                       downloadedCount=sum(r["downloaded"] for r in rows),
                       downloadedBytes=sum(r["bytes"] for r in rows if r["downloaded"]),
                       capacityBefore=capacity_before, capacityAfter=check_budget()), stream, indent=2)
        stream.write("\n")

if __name__ == "__main__":
    main()

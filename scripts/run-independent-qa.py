#!/usr/bin/env python3
"""Bounded offline recipes; never execute or rewrite historical QA drivers."""
import argparse
import hashlib
import json
import os
import re
import shutil
import signal
import subprocess
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NORMAL_CAP = 7 * 1024**3
DIAGNOSTIC_CAP = 1024**3
FREE_FLOOR = 16_374_562_816

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def owned(path):
    if not path.is_relative_to(ROOT) or path.resolve() != path:
        raise RuntimeError(f"External or linked QA path: {path}")
    return path

def allocated(paths):
    seen, total = set(), 0
    for path in paths:
        if not path.exists():
            continue
        if path.is_symlink():
            raise RuntimeError(f"Linked capacity root: {path}")
        def walk_error(error):
            if not isinstance(error, FileNotFoundError):
                raise error
        for directory, children, files in os.walk(path, followlinks=False, onerror=walk_error):
            for name in files + children:
                item = Path(directory) / name
                if item.is_symlink():
                    continue
                try:
                    st = item.stat()
                except FileNotFoundError:
                    # Rust atomically renames/removes rmeta temporaries during builds.
                    # They no longer occupy this pathname; permission errors still fail.
                    continue
                key = (st.st_dev, st.st_ino)
                if key not in seen:
                    total += st.st_blocks * 512
                    seen.add(key)
    return total

def capacity(strict=True):
    roots = [ROOT / p for p in [".geulgyeol-tools", ".geulgyeol-local", "desktop/node_modules",
             "rhwp-studio/node_modules", "engine/target", "pkg", "desktop/web/studio",
             "dist/GeulgyeolIndependent-darwin-arm64"]]
    # Count all owned bytes, a stricter ceiling than subtracting old owned baseline.
    usage = allocated(roots)
    diagnostics = allocated([ROOT / ".geulgyeol-local"])
    free = shutil.disk_usage(ROOT).free
    baseline = ROOT / ".geulgyeol-local/independence-qa/budget-baseline.json"
    filesystem_delta = max(0, json.loads(baseline.read_text())["freeBytes"] - free) if baseline.exists() else 0
    result = dict(ownedAllocatedBytes=usage, diagnosticAllocatedBytes=diagnostics, freeBytes=free,
                  filesystemUsedDeltaBytes=filesystem_delta, normalCapBytes=NORMAL_CAP,
                  diagnosticCapBytes=DIAGNOSTIC_CAP, freeFloorBytes=FREE_FLOOR)
    result["withinLimits"] = max(usage, filesystem_delta) <= NORMAL_CAP and diagnostics <= DIAGNOSTIC_CAP and free >= FREE_FLOOR
    if strict and not result["withinLimits"]:
        raise RuntimeError(f"Independent QA capacity exceeded: {result}")
    return result

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--recipe", choices=["empty-roundtrip", "table-ledger", "wasm-build"], required=True)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--input", type=Path)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,63}", args.run_id):
        raise RuntimeError("Run ID must be one bounded lowercase name")
    output = owned(ROOT / ".geulgyeol-local/qa" / args.run_id)
    if output.exists():
        raise RuntimeError(f"Existing QA evidence preserved; choose a fresh run ID: {output}")
    env = os.environ.copy()
    expected = dict(CARGO_HOME=str(ROOT / ".geulgyeol-tools/cargo-home"),
                    RUSTUP_HOME=str(ROOT / ".geulgyeol-tools/rustup-home"),
                    CARGO_TARGET_DIR=str(ROOT / "engine/target"), RUSTUP_TOOLCHAIN="1.93.1",
                    RUSTC=str(ROOT / ".geulgyeol-tools/cargo-home/bin/rustc"),
                    RUSTDOC=str(ROOT / ".geulgyeol-tools/cargo-home/bin/rustdoc"))
    if any(env.get(k) != v for k, v in expected.items()):
        raise RuntimeError("Run via bash scripts/qa-independent.sh to use owned tools")
    for p in [".geulgyeol-tools/cargo-home", ".geulgyeol-tools/rustup-home", "engine/target"]:
        owned(ROOT / p)
    for key in ["RUSTC", "RUSTDOC"]:
        if not Path(env[key]).resolve().is_relative_to(ROOT / ".geulgyeol-tools"):
            raise RuntimeError(f"External owned-tool proxy: {key}")
    if not (ROOT / ".geulgyeol-tools/cargo-home/bin/cargo").resolve().is_relative_to(ROOT / ".geulgyeol-tools"):
        raise RuntimeError("External Cargo proxy")
    for k in ["RUSTFLAGS", "CARGO_ENCODED_RUSTFLAGS", "RUSTDOCFLAGS", "RUSTC_WRAPPER", "RUSTC_WORKSPACE_WRAPPER", "CARGO_BUILD_TARGET"]:
        env.pop(k, None)
    env.update(CARGO_PROFILE_DEV_DEBUG="0", CARGO_PROFILE_RELEASE_DEBUG="0", CARGO_INCREMENTAL="0", CARGO_BUILD_JOBS="2")
    cargo = str(ROOT / ".geulgyeol-tools/cargo-home/bin/cargo")
    command = [cargo, "run", "--offline", "--locked", "--manifest-path", "engine/Cargo.toml", "--example"]
    evidence_inputs = {}
    if args.recipe == "empty-roundtrip":
        if args.input is not None:
            raise RuntimeError("empty-roundtrip synthesizes its own documents")
        command += ["empty_document_check", "--", str(output / "native")]
        evidence_inputs["engine/examples/empty_document_check.rs"] = sha(ROOT / "engine/examples/empty_document_check.rs")
    elif args.recipe == "table-ledger":
        if args.input is None or not args.input.is_file() or args.input.suffix.lower() not in [".hwp", ".hwpx"]:
            raise RuntimeError("table-ledger requires an existing HWP/HWPX input; use synthetic fixtures")
        command += ["three_column_owner_check", "--", str(args.input.resolve()), str(output / "native")]
        evidence_inputs["input"] = sha(args.input)
        for p in ["three_column_owner_check.rs", "mixed_table_owner_probe.rs", "horizontal_table_saved_check.rs"]:
            evidence_inputs[f"engine/examples/{p}"] = sha(ROOT / "engine/examples" / p)
    else:
        if args.input is not None:
            raise RuntimeError("wasm-build takes no input")
        command = [cargo, "build", "--offline", "--locked", "--release", "--target", "wasm32-unknown-unknown", "--lib", "--manifest-path", "engine/Cargo.toml"]
    plan = dict(recipe=args.recipe, command=command, ownedEnvironment={**expected, **{k:env[k] for k in ["CARGO_PROFILE_DEV_DEBUG", "CARGO_PROFILE_RELEASE_DEBUG", "CARGO_INCREMENTAL", "CARGO_BUILD_JOBS"]}},
                output=str(output), inputPins=evidence_inputs, lockSHA256=sha(ROOT / "engine/Cargo.lock"),
                sourceHEAD=subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
                sourceStatus=subprocess.check_output(["git", "status", "--short"], cwd=ROOT, text=True),
                envScriptSHA256=sha(ROOT / "scripts/standalone-env.sh"), runnerSHA256=sha(Path(__file__)))
    if args.dry_run:
        print(json.dumps(plan, indent=2)); return
    preflight = capacity()
    output.mkdir(parents=True, exist_ok=False)
    (output / "plan.json").write_text(json.dumps(plan, indent=2) + "\n")
    samples = [preflight]
    error = None
    started = time.monotonic()
    with (output / "command.log").open("x") as log:
        process = subprocess.Popen(command, cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
        try:
            while process.poll() is None:
                time.sleep(1)
                samples.append(capacity())
                if "Blocking waiting for file lock" in (output / "command.log").read_text(errors="replace"):
                    raise RuntimeError("Shared Cargo/target is in use; stopped this own QA invocation")
        except BaseException as exc:
            error = str(exc)
            # Only the new child session created above; no process inventory or broad kill.
            if process.poll() is None:
                try:
                    os.killpg(process.pid, signal.SIGTERM)
                except ProcessLookupError:
                    pass
                process.wait(timeout=15)
        code = process.wait()
    postflight = capacity(strict=False)
    if code != 0:
        error = error or f"Cargo recipe exited with code {code}; see command.log"
    if not postflight["withinLimits"]:
        error = error or "Independent QA capacity exceeded after child exit"
    oracle = None
    if code == 0 and not error:
        if args.recipe == "empty-roundtrip":
            oracle = json.loads((output / "native/proof.json").read_text())
            if oracle["nativeFactoryAndTemplateCases"] != 6 or oracle["nativeThreeSaveChainReopens"] != 60:
                error = "Native roundtrip oracle did not cover the expected six cases/60 reopens"
        elif args.recipe == "table-ledger":
            oracle = json.loads((output / "native/ledger.json").read_text())
            oracle = dict(pages=len(oracle["pages"]), sourceOwners=len(oracle["owners"]), rows=oracle["rows"], cols=oracle["cols"])
            if not oracle["pages"] or not oracle["sourceOwners"]:
                error = "Native table ledger is empty"
        else:
            oracle = dict(wasmSHA256=sha(ROOT / "engine/target/wasm32-unknown-unknown/release/rhwp.wasm"))
    result = dict(exitCode=code, passed=code == 0 and not error, error=error, elapsedSeconds=time.monotonic()-started,
                  capacityBefore=preflight, capacityAfter=postflight, samples=samples, oracle=oracle,
                  offline=True, historicalDriversExecuted=False, newPackageCreated=False)
    (output / "result.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({k:v for k,v in result.items() if k != "samples"}, indent=2))
    if not result["passed"]:
        raise SystemExit(1)

if __name__ == "__main__":
    main()

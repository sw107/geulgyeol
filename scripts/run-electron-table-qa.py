#!/usr/bin/env python3
"""Record the Node QA process exit separately from the Electron app exit.

Usage: run-electron-table-qa.py QA_DIR WASM_DIR SEEDS_JSON [OPERATION] [baseline]
Build the private QA runtime first. Existing raw proof files are never replaced.
"""
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

root = Path(__file__).resolve().parent.parent
qa, engine, seeds = [Path(p).resolve() for p in sys.argv[1:4]]
record, log = qa / "harness-process.json", qa / "harness-process.log"
assert qa.is_dir() and not record.exists() and not log.exists(), "fresh built QA runtime required"
command = ["node", str(root / "scripts/check-electron-stored-merged-fragments.mjs"), str(qa), str(engine)]
env = {**os.environ, "GEULGYEOL_HOST_SEEDS": str(seeds)}
if len(sys.argv) > 4 and sys.argv[4] != "all":
    env["GEULGYEOL_FRAGMENT_OPERATION"] = sys.argv[4]
if len(sys.argv) > 5:
    assert sys.argv[5] == "baseline"
    command.append("baseline")
source_paths = [root / "scripts" / name for name in ["run-electron-table-qa.py", "check-electron-stored-merged-fragments.mjs", "write-electron-table-manifest.mjs", "packaged-electron-qa.mjs"]] + [qa / "bootstrap.cjs"]
# Capture before launch, then independently after exit. Do not retrofit old records.
def source_hashes():
    return {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in source_paths}
sources_before = source_hashes()
seeds_before = hashlib.sha256(seeds.read_bytes()).hexdigest()
started = datetime.now(timezone.utc).isoformat()
with log.open("w") as stream:
    result = subprocess.run(command, cwd=root, env=env, stdout=stream, stderr=subprocess.STDOUT)
sources_after = source_hashes()
seeds_after = hashlib.sha256(seeds.read_bytes()).hexdigest()
lifecycle = json.loads((qa / "lifecycle.json").read_text()) if (qa / "lifecycle.json").exists() else None
proof = {"command": command, "startedUTC": started, "finishedUTC": datetime.now(timezone.utc).isoformat(), "nodeHarnessExitCode": result.returncode,
         "appExitCode": lifecycle.get("exitCode") if lifecycle else None, "appNormalQuit": lifecycle.get("normalQuit") if lifecycle else None,
         "qaSourceSHA256": hashlib.sha256((root / "scripts/check-electron-stored-merged-fragments.mjs").read_bytes()).hexdigest(),
         "sourceSeedsSHA256": seeds_after, "log": log.name,
         "qaSourceBeforeSHA256": sources_before, "qaSourceAfterSHA256": sources_after,
         "qaSourcesUnchanged": sources_before == sources_after,
         "sourceSeedsBeforeSHA256": seeds_before, "sourceSeedsAfterSHA256": seeds_after,
         "sourceSeedsUnchanged": seeds_before == seeds_after}
record.write_text(json.dumps(proof, indent=2) + "\n")
print(json.dumps(proof), flush=True)
if result.returncode == 0:
    assert sources_before == sources_after and seeds_before == seeds_after, "QA inputs changed during execution"
raise SystemExit(result.returncode if result.returncode >= 0 else 1)

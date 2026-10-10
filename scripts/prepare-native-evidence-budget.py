#!/usr/bin/env python3
"""Budgeted Native source-ledger and painted-baseline producers.
Usage: source SEEDS_JSON NATIVE_BINARY FRESH_PHASE
       baseline SEEDS_JSON NATIVE_LEDGER_ROOT FRESH_PHASE
Requires GEULGYEOL_QA_BUDGET_ROOT. Never builds or modifies original inputs.
"""
import sys
sys.dont_write_bytecode = True
import hashlib
import json
import os
from pathlib import Path
import re
import xml.etree.ElementTree as ET
from native_qa_budget import BudgetClient, run_native

CASE_LIMIT = 32 * 1024 * 1024
def sha(path):
    with Path(path).open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def bounded_json(path, limit=CASE_LIMIT):
    path = Path(path)
    if path.stat().st_size > limit:
        raise RuntimeError("bounded JSON input required")
    return json.loads(path.read_text(encoding="utf-8"))


def plan(seeds):
    rows, labels = [], set()
    for seed in bounded_json(seeds, 4 * 1024 * 1024):
        label = seed["label"]
        if not isinstance(label, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,100}", label):
            raise RuntimeError("safe unique seed label required")
        if set(seed["files"]) != {"hwp", "hwpx"}:
            raise RuntimeError("both HWP/HWPX planned sources required")
        for extension in ("hwp", "hwpx"):
            stem = label + "-" + extension
            if stem in labels:
                raise RuntimeError("duplicate planned source")
            labels.add(stem)
            source = Path(seed["files"][extension]).resolve(strict=True)
            rows.append((label, extension, stem, source))
    if not rows or len(rows) > 256:
        raise RuntimeError("bounded nonempty source plan required")
    return rows


def write_json(path, data, budget):
    payload = (json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n").encode()
    if len(payload) > CASE_LIMIT:
        raise RuntimeError("bounded output case required")
    budget.check(len(payload) + 16384)
    partial = Path(str(path) + ".partial")
    with partial.open("xb") as stream:
        stream.write(payload)
        stream.flush()
        os.fsync(stream.fileno())
    if sha(partial) != hashlib.sha256(payload).hexdigest():
        raise RuntimeError("output disk hash mismatch")
    # Exclusive promotion cannot replace existing evidence.
    os.link(partial, path)
    partial.unlink()  # Only this writer's newly created, validated promotion scratch.
    return hashlib.sha256(payload).hexdigest()


def baseline_case(stem, source, ledger_root, budget):
    ledger_path = ledger_root / stem / "ledger.json"
    ledger_pin, source_pin = sha(ledger_path), sha(source)
    ledger = bounded_json(ledger_path)
    headers = {o["cell"] for o in ledger["owners"] if o["rowStart"] == 0}
    runs, pages = [], []
    seen_pages = set()
    for page in ledger["pages"]:
        number = page["page"]
        if type(number) is not int or number < 0 or number in seen_pages:
            raise RuntimeError("unique nonnegative Native page required")
        seen_pages.add(number)
        budget.check()
        svg = ledger_path.parent / ("page-" + str(number) + ".svg")
        if svg.stat().st_size > 16 * 1024 * 1024:
            raise RuntimeError("bounded SVG page required")
        pin, glyphs = sha(svg), []
        for node in ET.fromstring(svg.read_bytes()).iter("{http://www.w3.org/2000/svg}text"):
            text = "".join(node.itertext())
            if text and all(k in node.attrib for k in ("x", "y", "font-size")):
                glyphs.append((text[0], float(node.attrib["x"]), float(node.attrib["y"]),
                               float(node.attrib["font-size"])))
        for index, run in enumerate(page["text"]["runs"]):
            if index % 128 == 0:
                budget.check()
            if len(run.get("cellPath", [])) != 1 or run["cellIdx"] in headers:
                continue
            if not run["text"]:
                raise RuntimeError("nonempty Native body run required")
            matches = {(x, y, size) for char, x, y, size in glyphs
                       if char == run["text"][0] and abs(x - run["x"]) <= .051
                       and abs(size - run["fontSize"]) <= .051
                       and run["y"] < y <= run["y"] + run["h"] + .1}
            if len(matches) != 1:
                raise RuntimeError("unique Native painted baseline required")
            x, y, size = matches.pop()
            runs.append({"page": number, "runIndex": index, "paintX": x,
                         "paintBaselineY": y, "paintFontSize": size})
        if sha(svg) != pin:
            raise RuntimeError("Native SVG changed")
        pages.append({"page": number, "svgSHA256": pin})
    if sha(ledger_path) != ledger_pin or sha(source) != source_pin:
        raise RuntimeError("Native baseline input changed")
    return {"label": stem, "nativeLedgerSHA256": ledger_pin, "sourceSHA256": source_pin,
            "runs": runs, "pages": pages, "readOnly": True}


def produce(mode, seeds, provider, out):
    if mode not in ("source", "baseline"):
        raise RuntimeError("source or baseline mode required")
    seeds, provider, out = Path(seeds).resolve(strict=True), Path(provider).resolve(strict=True), Path(out)
    planned = plan(seeds)
    seeds_pin = sha(seeds)
    # Pin every source before any child or output case is generated.
    source_pins = {source: sha(source) for _, _, _, source in planned}
    tool_paths = [Path(__file__), Path(__file__).with_name("native_qa_budget.py"),
                  Path(__file__).with_name("qa-evidence-budget-bridge.mjs"),
                  Path(__file__).with_name("qa-evidence-budget.mjs")]
    tools = {p: sha(p) for p in tool_paths}
    native_pin = sha(provider) if mode == "source" else None
    out.mkdir(parents=True, exist_ok=False)
    budget = BudgetClient(out)
    try:
        rows = []
        baseline_pins = {}
        completion_path = None
        if mode == "source":
            dest = out / "native-source"
            dest.mkdir()
        for label, extension, stem, source in planned:
            budget.check(16 * 1024 * 1024)
            if sha(source) != source_pins[source]:
                raise RuntimeError("planned source changed before use")
            if mode == "source":
                command = [str(provider), str(source), str(dest / stem)]
                code = run_native(command, dest / (stem + ".log"), budget,
                                  env={**os.environ, "RHWP_DIAG_MIXED_OWNER": "1",
                                       "RHWP_DIAG_MIXED_OWNER_SCAN": "1"})
                ledger = dest / stem / "ledger.json"
                if code != 0 or not ledger.is_file():
                    raise RuntimeError("Native source generation failed")
                # This is a producer record, not an independent layout assertion.
                rows.append({"label": label, "format": extension, "command": command,
                             "exitCode": code, "nativeSHA256": native_pin,
                             "sourceSHA256Before": source_pins[source],
                             "sourceSHA256After": sha(source), "ledgerSHA256": sha(ledger),
                             "logSHA256": sha(dest / (stem + ".log"))})
            else:
                data = baseline_case(stem, source, provider, budget)
                baseline_pins[provider / stem / "ledger.json"] = data["nativeLedgerSHA256"]
                for page in data["pages"]:
                    baseline_pins[provider / stem / ("page-" + str(page["page"]) + ".svg")] = page["svgSHA256"]
                pin = write_json(out / (stem + ".json"), data, budget)
                rows.append({"label": stem, "runs": len(data["runs"]), "oracleSHA256": pin,
                             "nativeLedgerSHA256": data["nativeLedgerSHA256"],
                             "sourceSHA256": data["sourceSHA256"]})
        if sha(seeds) != seeds_pin or any(sha(p) != pin for p, pin in source_pins.items()):
            raise RuntimeError("planned input changed")
        if any(sha(p) != pin for p, pin in baseline_pins.items()):
            raise RuntimeError("Native baseline input changed after case")
        if any(sha(p) != pin for p, pin in tools.items()):
            raise RuntimeError("producer source changed")
        if mode == "source" and sha(provider) != native_pin:
            raise RuntimeError("Native binary changed")
        proof = {"mode": mode, "cases": len(rows), "complete": True, "rows": rows,
                 "seedIndexSHA256": seeds_pin, "budgetPreflight": budget.preflight,
                 "producerSHA256": {p.name: pin for p, pin in tools.items()}}
        if mode == "source":
            proof.update(nativeBinary=str(provider), nativeSHA256Before=native_pin,
                         nativeSHA256After=sha(provider), layoutAssertionsVerified=False)
            name = "native-source-process.json"
        else:
            proof.update(nativeBodyRuns=sum(r["runs"] for r in rows), independentOfCursorAPI=True)
            name = "proof.json"
        # Consumers must require the phase marker as well as the completion proof.
        # If finalization fails, preserve our own promoted proof as failed evidence.
        budget.check()
        completion_path = out / name
        write_json(completion_path, proof, budget)
        budget.mark("complete")
        return proof
    except BaseException:
        if completion_path is not None and completion_path.exists():
            completion_path.rename(Path(str(completion_path) + ".failed"))
        if budget.started and not budget.finished:
            budget.mark("failed")
        raise
    finally:
        budget.close()


if __name__ == "__main__":
    if len(sys.argv) != 5:
        raise SystemExit(__doc__)
    result = produce(*sys.argv[1:])
    print(json.dumps({"mode": result["mode"], "cases": result["cases"], "complete": True}))

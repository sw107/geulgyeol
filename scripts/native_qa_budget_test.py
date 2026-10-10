"""Small synthetic adapter/wrapper tests; no product Native binary or engine."""
import sys
sys.dont_write_bytecode = True
import gzip
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
from native_qa_budget import BudgetClient, run_native

ROOT = Path(__file__).resolve().parent
sha = lambda p: hashlib.sha256(Path(p).read_bytes()).hexdigest()


class NativeBudgetTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.root = Path(tempfile.mkdtemp(prefix="geulgyeol-native-budget-synthetic-")).resolve()
        print("SYNTHETIC_EVIDENCE_ROOT=" + str(cls.root), flush=True)

    def case(self):
        root = self.root / str(len(list(self.root.iterdir())))
        root.mkdir()
        source = root / "source.hwpx"
        source.write_bytes(b"synthetic document only")
        manifest = root / "manifest.json.gz"
        payload = json.dumps([{"file": str(source), "svg": ["<svg/>"],
                               "pageCount": 1}], separators=(",", ":")).encode()
        manifest.write_bytes(gzip.compress(payload))
        return root, source, manifest, payload

    def native(self, root, fail=False):
        binary = root / "fake-native.py"
        binary.write_text("#!/usr/bin/env python3\n"
                          "import sys\nsys.dont_write_bytecode=True\n"
                          "from pathlib import Path\n"
                          "Path(sys.argv[2]).mkdir()\n"
                          "Path(sys.argv[2],'synthetic.json').write_text('{\"synthetic\":true}')\n"
                          f"raise SystemExit({1 if fail else 0})\n")
        binary.chmod(0o700)  # Only our new synthetic executable.
        return binary

    def invoke(self, root, manifest, native):
        return subprocess.run(
            [sys.executable, "-B", str(ROOT / "shard-electron-table-manifest.py"),
             str(manifest), str(root / "native-phase"), str(native), "--scratch"],
            env={**os.environ, "GEULGYEOL_QA_BUDGET_ROOT": str(root),
                 "PYTHONDONTWRITEBYTECODE": "1"},
            capture_output=True, text=True, timeout=15)

    def test_success_uses_shared_budget_and_preserves_input_hashes(self):
        root, source, manifest, raw = self.case()
        native = self.native(root)
        pins = {p: sha(p) for p in [source, manifest, native]}
        result = self.invoke(root, manifest, native)
        self.assertEqual(result.returncode, 0, result.stderr)
        out = root / "native-phase"
        proof = json.loads((out / "index.json").read_text())
        self.assertEqual(proof["cases"], 1)
        self.assertEqual(proof["sourceUncompressedSHA256"], hashlib.sha256(raw).hexdigest())
        self.assertEqual(proof["sourceManifestSHA256"], pins[manifest])
        self.assertEqual(proof["nativeSHA256"], pins[native])
        self.assertEqual(proof["qaSourceBeforeSHA256"], proof["qaSourceAfterSHA256"])
        self.assertEqual(proof["budgetPreflight"]["normalLimit"], 768 * 1024 * 1024)
        self.assertTrue(proof["rows"][0]["nativeSame"])
        self.assertEqual(json.loads((out / "qa-evidence-status.json").read_text())["outcome"], "complete")
        self.assertTrue(json.loads((out / "native-wrapper-status.json").read_text())["complete"])
        self.assertFalse((out / "index.json.partial").exists())
        self.assertEqual({p: sha(p) for p in pins}, pins)

    def test_native_failure_is_incomplete_without_success_index(self):
        root, source, manifest, _ = self.case()
        native = self.native(root, fail=True)
        pins = {p: sha(p) for p in [source, manifest, native]}
        result = self.invoke(root, manifest, native)
        self.assertNotEqual(result.returncode, 0)
        out = root / "native-phase"
        self.assertFalse((out / "index.json").exists())
        self.assertFalse(json.loads((out / "native-wrapper-status.json").read_text())["complete"])
        self.assertEqual(json.loads((out / "qa-evidence-status.json").read_text())["outcome"], "failed")
        self.assertEqual({p: sha(p) for p in pins}, pins)

    def test_unfinished_prior_phase_blocks_before_fake_native_or_new_marker(self):
        root, _, manifest, _ = self.case()
        old = root / "old"
        old.mkdir()
        marker = old / "qa-evidence-status.json"
        marker.write_text('{"schema":1,"outcome":"running"}\n')
        (old / "manifest.json.gz.partial").write_bytes(b"old partial")
        pin = sha(marker)
        native = self.native(root)
        result = self.invoke(root, manifest, native)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("unfinished evidence", result.stderr)
        out = root / "native-phase"
        self.assertFalse((out / "qa-evidence-status.json").exists())
        self.assertFalse((out / "native-0000").exists())
        self.assertEqual(sha(marker), pin)

    def test_coordinator_pipe_eof_preserves_partial_as_failed_evidence(self):
        root, _, _, _ = self.case()
        phase = root / "phase"
        phase.mkdir()
        with patch.dict(os.environ, {"GEULGYEOL_QA_BUDGET_ROOT": str(root)}):
            client = BudgetClient(phase)
            partial = phase / "index.json.partial"
            partial.write_bytes(b"incomplete")
            client.close()
        self.assertEqual(json.loads((phase / "qa-evidence-status.json").read_text())["outcome"], "failed")
        self.assertEqual(partial.read_bytes(), b"incomplete")

    def test_sampled_budget_failure_stops_only_the_created_fake_child(self):
        root, _, _, _ = self.case()
        original = subprocess.Popen
        created = []
        def spawn(*args, **kwargs):
            child = original(*args, **kwargs)
            created.append(child)
            return child
        class StopBudget:
            def check(self):
                raise RuntimeError("injected budget stop")
        with patch("native_qa_budget.subprocess.Popen", side_effect=spawn):
            with self.assertRaisesRegex(RuntimeError, "injected budget stop"):
                run_native([sys.executable, "-B", "-c", "import time;time.sleep(2)"],
                           root / "fake.log", StopBudget(), interval=.05)
        self.assertEqual(len(created), 1)
        self.assertIsNotNone(created[0].returncode)
        self.assertNotEqual(created[0].returncode, 0)

    def test_missing_budget_root_rejects_without_spawn(self):
        root, _, _, _ = self.case()
        phase = root / "phase"
        phase.mkdir()
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(RuntimeError, "whole-run"):
                BudgetClient(phase)
        self.assertFalse((phase / "qa-evidence-status.json").exists())


if __name__ == "__main__":
    unittest.main()

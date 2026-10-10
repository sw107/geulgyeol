"""Synthetic producer tests with an injected in-memory coordinator.
No real Native/WASM/app, no production floor/limit override.
"""
import sys
sys.dont_write_bytecode = True
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("producer", Path(__file__).with_name("prepare-native-evidence-budget.py"))
producer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(producer)


class Coordinator:
    instances = []
    finalize_failure = False
    def __init__(self, phase):
        self.started, self.finished = True, False
        self.preflight = {"syntheticInjectedCoordinator": True}
        self.outcomes = []
        self.phase = phase
        self.instances.append(self)
    def check(self, forecast=0):
        if forecast < 0:
            raise RuntimeError("bad forecast")
    def mark(self, outcome):
        if outcome == "complete" and self.finalize_failure:
            raise RuntimeError("injected finalization stop")
        self.outcomes.append(outcome)
        self.finished = True
    def close(self):
        pass


class ProducerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.root = Path(tempfile.mkdtemp(prefix="geulgyeol-native-producer-synthetic-")).resolve()
        print("SYNTHETIC_EVIDENCE_ROOT=" + str(cls.root), flush=True)

    def setUp(self):
        self.case = self.root / self._testMethodName
        self.case.mkdir()
        self.seeds = self.case / "seeds.json"
        self.sources = {}
        for extension in ("hwp", "hwpx"):
            path = self.case / ("input." + extension)
            path.write_bytes(b"synthetic source")
            self.sources[extension] = str(path)
        self.seeds.write_text(json.dumps([{"label": "fixture", "files": self.sources}]))
        self.binary = self.case / "fake-native"
        self.binary.write_bytes(b"not an executable; child call is mocked")
        self.out = self.case / "phase"
        Coordinator.finalize_failure = False
        Coordinator.instances.clear()
        self.coordinator = patch.object(producer, "BudgetClient", Coordinator)
        self.coordinator.start()
        self.addCleanup(self.coordinator.stop)

    def ledgers(self, ambiguous=False):
        root = self.case / "ledgers"
        root.mkdir()
        for extension in ("hwp", "hwpx"):
            dest = root / ("fixture-" + extension)
            dest.mkdir()
            run = {"cellPath": [1], "cellIdx": 1, "text": "body", "x": 10,
                   "y": 20, "h": 20, "fontSize": 10}
            ledger = {"owners": [{"cell": 0, "rowStart": 0}],
                      "pages": [{"page": 0, "text": {"runs": [run]}}]}
            (dest / "ledger.json").write_text(json.dumps(ledger))
            text = '<text x="10" y="28" font-size="10">body</text>'
            if ambiguous:
                text += '<text x="10" y="29" font-size="10">body</text>'
            (dest / "page-0.svg").write_text('<svg xmlns="http://www.w3.org/2000/svg">' + text + '</svg>')
        return root

    def fake_native(self, command, log, budget, **options):
        self.assertEqual(options["env"]["RHWP_DIAG_MIXED_OWNER_SCAN"], "1")
        dest = Path(command[2])
        dest.mkdir()
        (dest / "ledger.json").write_text('{"synthetic":true}')
        Path(log).write_text("synthetic diagnostic only\n")
        return 0

    def test_source_plan_preserves_pins_and_records_both_formats(self):
        pins = {Path(p): producer.sha(p) for p in self.sources.values()}
        with patch.object(producer, "run_native", side_effect=self.fake_native):
            proof = producer.produce("source", self.seeds, self.binary, self.out)
        self.assertEqual(proof["cases"], 2)
        self.assertFalse(proof["layoutAssertionsVerified"])
        self.assertEqual(proof["nativeSHA256Before"], proof["nativeSHA256After"])
        self.assertEqual({p: producer.sha(p) for p in pins}, pins)
        self.assertTrue((self.out / "native-source-process.json").exists())
        self.assertEqual(Coordinator.instances[0].outcomes, ["complete"])

    def test_baseline_uses_painted_y_and_preserves_all_native_inputs(self):
        root = self.ledgers()
        pins = {p: producer.sha(p) for p in root.rglob("*") if p.is_file()}
        proof = producer.produce("baseline", self.seeds, root, self.out)
        self.assertEqual(proof["nativeBodyRuns"], 2)
        oracle = json.loads((self.out / "fixture-hwp.json").read_text())
        self.assertEqual(oracle["runs"][0]["paintBaselineY"], 28)
        self.assertEqual({p: producer.sha(p) for p in pins}, pins)

    def test_ambiguous_baseline_is_failed_without_success_proof(self):
        with self.assertRaisesRegex(RuntimeError, "unique Native painted"):
            producer.produce("baseline", self.seeds, self.ledgers(True), self.out)
        self.assertFalse((self.out / "proof.json").exists())
        self.assertEqual(Coordinator.instances[0].outcomes, ["failed"])

    def test_finalization_failure_preserves_proof_as_failed(self):
        Coordinator.finalize_failure = True
        with self.assertRaisesRegex(RuntimeError, "finalization stop"):
            producer.produce("baseline", self.seeds, self.ledgers(), self.out)
        self.assertFalse((self.out / "proof.json").exists())
        self.assertTrue((self.out / "proof.json.failed").exists())
        self.assertEqual(Coordinator.instances[0].outcomes, ["failed"])

    def test_duplicate_plan_is_rejected_before_phase_or_child(self):
        seeds = json.loads(self.seeds.read_text())
        self.seeds.write_text(json.dumps(seeds + seeds))
        with patch.object(producer, "run_native") as child:
            with self.assertRaisesRegex(RuntimeError, "duplicate"):
                producer.produce("source", self.seeds, self.binary, self.out)
            child.assert_not_called()
        self.assertFalse(self.out.exists())
        self.assertEqual(Coordinator.instances, [])

    def test_real_bridge_connects_source_and_baseline_with_fake_native_only(self):
        import os
        from native_qa_budget import BudgetClient
        native = self.case / "executable-fake-native.py"
        native.write_text("#!/usr/bin/env python3\n"
                          "import sys,json\nfrom pathlib import Path\n"
                          "p=Path(sys.argv[2]);p.mkdir()\n"
                          "r={'cellPath':[1],'cellIdx':1,'text':'body','x':10,'y':20,'h':20,'fontSize':10}\n"
                          "l={'owners':[{'cell':0,'rowStart':0}],'pages':[{'page':0,'text':{'runs':[r]}}]}\n"
                          "(p/'ledger.json').write_text(json.dumps(l))\n"
                          "(p/'page-0.svg').write_text('<svg xmlns=\"http://www.w3.org/2000/svg\"><text x=\"10\" y=\"28\" font-size=\"10\">body</text></svg>')\n")
        native.chmod(0o700)  # Only the test's new executable.
        with patch.object(producer, "BudgetClient", BudgetClient):
            with patch.dict(os.environ, {"GEULGYEOL_QA_BUDGET_ROOT": str(self.case),
                                         "PYTHONDONTWRITEBYTECODE": "1"}):
                source = producer.produce("source", self.seeds, native, self.out)
                baseline = producer.produce("baseline", self.seeds, self.out / "native-source",
                                            self.case / "baseline")
        self.assertEqual(source["cases"], 2)
        self.assertEqual(baseline["nativeBodyRuns"], 2)
        self.assertFalse(source["layoutAssertionsVerified"])
        self.assertEqual(source["budgetPreflight"]["normalLimit"], 768 * 1024 * 1024)
        for phase in (self.out, self.case / "baseline"):
            self.assertEqual(json.loads((phase / "qa-evidence-status.json").read_text())["outcome"], "complete")

    def test_planned_source_change_during_child_is_rejected(self):
        def change(*args, **kwargs):
            code = self.fake_native(*args, **kwargs)
            Path(self.sources["hwpx"]).write_bytes(b"changed synthetic source")
            return code
        with patch.object(producer, "run_native", side_effect=change) as child:
            with self.assertRaisesRegex(RuntimeError, "planned source changed"):
                producer.produce("source", self.seeds, self.binary, self.out)
        self.assertEqual(child.call_count, 1)
        self.assertFalse((self.out / "native-source-process.json").exists())
        self.assertEqual(Coordinator.instances[0].outcomes, ["failed"])


if __name__ == "__main__":
    unittest.main()

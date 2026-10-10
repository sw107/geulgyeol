"""Private persistent bridge to the single shared JavaScript evidence policy."""
import json
import os
from pathlib import Path
import subprocess


class BudgetClient:
    def __init__(self, phase, normal_forecast=128 * 1024 * 1024,
                 failure_forecast=16 * 1024 * 1024):
        root = os.environ.get("GEULGYEOL_QA_BUDGET_ROOT")
        if not root:
            raise RuntimeError("explicit whole-run GEULGYEOL_QA_BUDGET_ROOT required")
        self.process = subprocess.Popen(
            ["node", str(Path(__file__).with_name("qa-evidence-budget-bridge.mjs"))],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, encoding="utf-8", bufsize=1)
        self.started = False
        self.finished = False
        try:
            self.preflight = self.request(
                "begin", root=str(Path(root).resolve()), phase=str(Path(phase).resolve()),
                normalForecastBytes=normal_forecast, failureForecastBytes=failure_forecast)
            self.started = True
        except BaseException:
            self.close()
            raise

    def request(self, operation, **values):
        self.process.stdin.write(json.dumps({"op": operation, **values}) + "\n")
        self.process.stdin.flush()
        line = self.process.stdout.readline()
        if not line:
            raise RuntimeError("budget bridge ended without a response")
        response = json.loads(line)
        if not response["ok"]:
            raise RuntimeError(response["error"])
        return response["result"]

    def check(self, forecast=0):
        return self.request("check", normalForecastBytes=forecast)

    def mark(self, outcome):
        result = self.request(outcome)
        self.finished = True
        return result

    def close(self):
        if not self.process.stdin.closed:
            self.process.stdin.close()
        try:
            self.process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            # This is the exact bridge child created by this client.
            self.process.terminate()
            self.process.wait(timeout=5)
        self.process.stdout.close()
        self.process.stderr.close()


def run_native(command, log, budget, interval=.25):
    """Check while our Native child runs; stop only this child on a budget error."""
    with Path(log).open("x", encoding="utf-8") as stream:
        process = subprocess.Popen(command, stdout=stream, stderr=subprocess.STDOUT)
        try:
            while True:
                try:
                    code = process.wait(timeout=interval)
                    break
                except subprocess.TimeoutExpired:
                    budget.check()
            budget.check()
            return code
        except BaseException:
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    # Own verified child only; never enumerate or signal other processes.
                    process.kill()
                    process.wait(timeout=5)
            raise

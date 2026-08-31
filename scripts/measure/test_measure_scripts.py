#!/usr/bin/env python3
from __future__ import annotations

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
COST = ROOT / "scripts/measure/cost_reconciliation.py"
MEMORY = ROOT / "scripts/measure/mem_eval_stats.py"


class MeasureScriptTests(unittest.TestCase):
    def run_script(self, script: Path, *args: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, str(script), *args],
            cwd=ROOT,
            text=True,
            capture_output=True,
            check=False,
        )

    def write_fixture(self, directory: Path, name: str, content: str) -> Path:
        path = directory / name
        path.write_text(content, encoding="utf-8")
        return path

    def test_cost_reconciliation_rejects_empty_and_missing_columns(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            directory = Path(raw)
            empty = self.write_fixture(directory, "usage.tsv", "date\tsettled_cost_usd\n")
            missing = self.write_fixture(directory, "missing.tsv", "date\tamount\n2026-08-31\t1\n")
            bill = self.write_fixture(directory, "bill.tsv", "date\tcost_usd\n2026-08-31\t1\n")

            self.assertNotEqual(
                self.run_script(COST, "--usage", str(empty), "--bill", str(bill)).returncode,
                0,
            )
            self.assertNotEqual(
                self.run_script(COST, "--usage", str(missing), "--bill", str(bill)).returncode,
                0,
            )

    def test_cost_reconciliation_accepts_match_and_rejects_drift(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            directory = Path(raw)
            usage = self.write_fixture(
                directory,
                "usage.tsv",
                "date\tsettled_cost_usd\n2026-08-31\t1.00\n",
            )
            matching = self.write_fixture(
                directory,
                "matching.tsv",
                "date\tcost_usd\n2026-08-31\t1.00\n",
            )
            drifted = self.write_fixture(
                directory,
                "drifted.tsv",
                "date\tcost_usd\n2026-08-31\t2.00\n",
            )

            self.assertEqual(
                self.run_script(COST, "--usage", str(usage), "--bill", str(matching)).returncode,
                0,
            )
            self.assertEqual(
                self.run_script(COST, "--usage", str(usage), "--bill", str(drifted)).returncode,
                1,
            )

    def test_memory_requires_a_metric_and_applies_zero_thresholds(self) -> None:
        self.assertNotEqual(self.run_script(MEMORY).returncode, 0)
        self.assertEqual(self.run_script(MEMORY, "--cross-leak", "0").returncode, 0)
        self.assertEqual(self.run_script(MEMORY, "--cross-leak", "1").returncode, 1)


if __name__ == "__main__":
    unittest.main()

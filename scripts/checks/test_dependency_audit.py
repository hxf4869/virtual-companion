#!/usr/bin/env python3
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
CHECKER = ROOT / "scripts/checks/check_dependency_audit.py"


def audit_report() -> dict:
    return {
        "advisories": {
            "1": {
                "findings": [{"version": "5.2.8", "paths": [".>vite"]}],
                "github_advisory_id": "GHSA-test-high",
                "module_name": "vite",
                "severity": "high",
            },
            "2": {
                "findings": [{"version": "1.0.0", "paths": [".>visible"]}],
                "github_advisory_id": "GHSA-test-moderate",
                "module_name": "visible",
                "severity": "moderate",
            },
        },
        "metadata": {
            "vulnerabilities": {
                "critical": 0,
                "high": 1,
                "moderate": 1,
                "low": 0,
            },
        },
    }


def ledger(expiry: str | None) -> str:
    if expiry is None:
        return "schemaVersion: 1\nentries: []\n"
    return f"""schemaVersion: 1
entries:
  - package: vite
    versions: [\"5.2.8\"]
    advisories:
      - {{id: GHSA-test-high, severity: high}}
    expiryDate: \"{expiry}\"
"""


class DependencyAuditCheckerTests(unittest.TestCase):
    def run_case(self, ledger_text: str) -> subprocess.CompletedProcess[str]:
        with tempfile.TemporaryDirectory() as raw:
            directory = Path(raw)
            audit_path = directory / "audit.json"
            ledger_path = directory / "ledger.yaml"
            audit_path.write_text(json.dumps(audit_report()), encoding="utf-8")
            ledger_path.write_text(ledger_text, encoding="utf-8")
            return subprocess.run(
                [
                    sys.executable,
                    str(CHECKER),
                    "--audit-json",
                    str(audit_path),
                    "--audit-exit-code",
                    "1",
                    "--ledger",
                    str(ledger_path),
                ],
                cwd=ROOT,
                text=True,
                capture_output=True,
                check=False,
            )

    def test_allows_active_registered_high_advisory(self) -> None:
        result = self.run_case(ledger("2999-01-01"))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("ALLOW high GHSA-test-high vite", result.stdout)
        self.assertIn("VISIBLE moderate GHSA-test-moderate visible", result.stdout)

    def test_rejects_unregistered_high_advisory(self) -> None:
        result = self.run_case(ledger(None))
        self.assertEqual(result.returncode, 1)
        self.assertIn("unregistered high advisory", result.stderr)

    def test_rejects_expired_high_advisory(self) -> None:
        result = self.run_case(ledger("2000-01-01"))
        self.assertEqual(result.returncode, 1)
        self.assertIn("exception expired", result.stderr)


if __name__ == "__main__":
    unittest.main()

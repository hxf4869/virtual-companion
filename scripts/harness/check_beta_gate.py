#!/usr/bin/env python3
from __future__ import annotations
from datetime import date
from pathlib import Path
import sys
import yaml

ROOT = Path(__file__).resolve().parents[2]
ROSTER = ROOT / "ops/beta-duty-roster.yaml"


def fail(msg: str) -> int:
    print(f"ERROR: {msg}", file=sys.stderr)
    return 1


def main() -> int:
    if not ROSTER.exists():
        return fail("ops/beta-duty-roster.yaml is missing")
    data = yaml.safe_load(ROSTER.read_text(encoding="utf-8")) or {}
    enabled = data.get("beta_generation_enabled") is True
    if not enabled:
        print("Beta gate: CLOSED (expected until real roster is complete)")
        return 0
    required_top = ["timezone", "date", "dutyWindow", "primary", "backup", "handoffReceiver", "complaintAndAppeal"]
    missing = [k for k in required_top if not data.get(k)]
    if missing:
        return fail(f"beta enabled but missing top-level fields: {missing}")
    if str(data.get("date")) != date.today().isoformat():
        return fail("beta enabled but roster date is not today")
    for role in ("primary", "backup", "handoffReceiver"):
        item = data.get(role) or {}
        for key in ("name", "contactSecretRef", "confirmedAt"):
            value = item.get(key)
            if value in (None, "", "TBD", "REQUIRED"):
                return fail(f"beta enabled but {role}.{key} is not complete")
    complaint = data.get("complaintAndAppeal") or {}
    for key in ("ownerName", "contactSecretRef"):
        if complaint.get(key) in (None, "", "TBD", "REQUIRED"):
            return fail(f"beta enabled but complaintAndAppeal.{key} is not complete")
    expected = {
        "startsAt": "20:15",
        "generationOpensAt": "20:30",
        "longConversationCutoff": "23:45",
        "newGenerationCutoff": "00:00",
        "inFlightGraceUntil": "00:10",
        "endsAt": "00:30",
    }
    window = data.get("dutyWindow") or {}
    for key, value in expected.items():
        if window.get(key) != value:
            return fail(f"beta enabled but dutyWindow.{key} must be {value}")
    print("Beta gate: OPEN configuration is structurally valid")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

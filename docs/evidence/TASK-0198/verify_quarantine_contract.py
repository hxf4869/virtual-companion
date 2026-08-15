#!/usr/bin/env python3
"""Verify TASK-0198 quarantine JSON against the frozen card contract and Git objects."""

from __future__ import annotations

import copy
import hashlib
import json
import subprocess
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[3]
CARD = ROOT / "docs/tasks/TASK-0198-task0196-invalid-closure-authorization-quarantine.md"
RECORD = ROOT / "docs/evidence/TASK-0198/legacy-invalid-closure-quarantine.json"
IDENTITY_KEYS = (
    "predecessor",
    "claimedCandidate",
    "actualTerminal",
    "readyStateImplementation",
    "p0Findings",
    "exactPaths",
    "files",
)


def load_card_contract() -> dict:
    text = CARD.read_text(encoding="utf-8")
    start = text.find("```yaml\n")
    end = text.find("\n```", start + 8)
    if start < 0 or end < 0:
        raise SystemExit("task card YAML block missing")
    task = yaml.safe_load(text[start + 8 : end])
    contract = task.get("legacyInvalidClosureQuarantine")
    if not isinstance(contract, dict):
        raise SystemExit("card missing legacyInvalidClosureQuarantine")
    return contract


def git_blob_and_sha(commit: str, path: str) -> tuple[str, str]:
    blob = subprocess.check_output(
        ["git", "rev-parse", f"{commit}:{path}"],
        cwd=ROOT,
        text=True,
    ).strip()
    content = subprocess.check_output(["git", "cat-file", "blob", blob], cwd=ROOT)
    return blob, hashlib.sha256(content).hexdigest()


def verify_record(contract: dict, record: dict) -> list[str]:
    errors: list[str] = []
    if record.get("recordId") != contract.get("recordId"):
        errors.append("recordId drift")
    if record.get("recordPath", contract.get("recordPath")) != contract.get("recordPath"):
        errors.append("recordPath drift")
    if record.get("kind") != contract.get("kind"):
        errors.append("kind drift")
    if record.get("doesNotLegitimizeInvalidClosure") is not True:
        errors.append("must not legitimize TASK-0196 invalid closure")
    if record.get("reusable") is not False or record.get("oneTimeOnly") is not True:
        errors.append("must be one-time and non-reusable")
    if record.get("inheritedFrom") != "TASK-0197":
        errors.append("must inherit from TASK-0197")
    if record.get("recordId") == "OWNER-MAINT-20260815-TASK-0197-LEGACY-INVALID-CLOSURE-01":
        errors.append("copied TASK-0197 recordId is forbidden")
    pred = record.get("predecessor") or {}
    if pred.get("machineState") != "ACCEPTED" or pred.get("historicalClosureValidity") != "INVALID":
        errors.append("TASK-0196 must remain ACCEPTED/INVALID")
    for key in IDENTITY_KEYS:
        if record.get(key) != contract.get(key):
            errors.append(f"identity drift: {key}")
    files = record.get("files")
    if not isinstance(files, list) or len(files) != 8:
        errors.append("files must be exactly 8 entries")
        return errors
    terminal = (record.get("actualTerminal") or {}).get("commit")
    exact_paths = record.get("exactPaths") or []
    if [item.get("path") for item in files] != exact_paths:
        errors.append("files.path order must equal exactPaths")
    for item in files:
        path = str(item.get("path"))
        try:
            blob, digest = git_blob_and_sha(str(terminal), path)
        except subprocess.CalledProcessError as exc:
            errors.append(f"cannot read {path} at {terminal}: {exc}")
            continue
        if blob != item.get("blob"):
            errors.append(f"blob drift at 1c1dca2: {path}")
        if digest != item.get("contentSha256"):
            errors.append(f"contentSha256 drift at 1c1dca2: {path}")
        if item.get("mode") != "100644" or item.get("type") != "blob":
            errors.append(f"mode/type drift: {path}")
    return errors


def expect_errors(contract: dict, record: dict, needle: str) -> None:
    found = verify_record(contract, record)
    if not found:
        raise SystemExit(f"expected failure for {needle}, got PASS")
    if not any(needle in item for item in found):
        raise SystemExit(f"expected {needle!r} in {found}")


def main() -> int:
    contract = load_card_contract()
    record = json.loads(RECORD.read_text(encoding="utf-8"))
    errors = verify_record(contract, record)
    if errors:
        print("FAIL")
        for item in errors:
            print(item)
        return 1

    mutated = copy.deepcopy(record)
    mutated["files"][0]["blob"] = "0" * 40
    expect_errors(contract, mutated, "blob drift")

    mutated = copy.deepcopy(record)
    mutated["doesNotLegitimizeInvalidClosure"] = False
    expect_errors(contract, mutated, "must not legitimize")

    mutated = copy.deepcopy(record)
    mutated["predecessor"]["historicalClosureValidity"] = "VALID"
    expect_errors(contract, mutated, "ACCEPTED/INVALID")

    mutated = copy.deepcopy(record)
    mutated["recordId"] = "OWNER-MAINT-20260815-TASK-0197-LEGACY-INVALID-CLOSURE-01"
    expect_errors(contract, mutated, "copied TASK-0197 recordId")

    mutated = copy.deepcopy(record)
    mutated["files"] = mutated["files"][:-1]
    mutated["exactPaths"] = mutated["exactPaths"][:-1]
    expect_errors(contract, mutated, "files must be exactly 8")

    print("PASS: TASK-0198 quarantine contract matches card identity and 1c1dca2 objects")
    print("PASS: negative matrix detected blob/legitimacy/copy/count drift")
    return 0


if __name__ == "__main__":
    sys.exit(main())

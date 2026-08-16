#!/usr/bin/env python3
"""Verify TASK-0237 history registry against the frozen card contract and Git objects."""

from __future__ import annotations

import copy
import hashlib
import json
import subprocess
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[3]
CARD = ROOT / "docs/tasks/TASK-0237-history-legacy-finding-registry.md"
REGISTRY = ROOT / "docs/evidence/TASK-0237/task0141-legacy-finding-registry.json"


def load_card_contract() -> dict:
    text = CARD.read_text(encoding="utf-8")
    start = text.find("```yaml\n")
    end = text.find("\n```", start + 8)
    if start < 0 or end < 0:
        raise SystemExit("task card YAML block missing")
    task = yaml.safe_load(text[start + 8 : end])
    contract = task.get("historyRegistry")
    if not isinstance(contract, dict):
        raise SystemExit("card missing historyRegistry")
    return contract


def git_blob_and_sha(commit: str, path: str) -> tuple[str, str]:
    blob = subprocess.check_output(
        ["git", "rev-parse", f"{commit}:{path}"], cwd=ROOT, text=True
    ).strip()
    content = subprocess.check_output(["git", "cat-file", "blob", blob], cwd=ROOT)
    return blob, hashlib.sha256(content).hexdigest()


def verify_registry(contract: dict, registry: dict) -> list[str]:
    errors: list[str] = []
    if registry.get("recordId") != contract.get("recordId"):
        errors.append("recordId drift")
    if registry.get("kind") != contract.get("kind"):
        errors.append("kind drift")
    if registry.get("doesNotLegitimize") is not True:
        errors.append("must not legitimize the finding")
    if registry.get("doesNotRetroactivelyBlock") is not True:
        errors.append("must not retroactively block")
    if registry.get("reusable") is not False or registry.get("oneTimeOnly") is not True:
        errors.append("must be one-time and non-reusable")
    t = registry.get("task0141") or {}
    terminal = contract.get("task0141TerminalCommit")
    if t.get("state") != "REJECTED" or t.get("terminalCommit") != terminal:
        errors.append("task0141 identity drift")
    for key in ("card", "evidence", "handoff"):
        path = contract.get(f"task0141{key.capitalize()}Path")
        blob_field = f"{key}Blob"
        sha_field = f"{key}Sha256"
        try:
            blob, digest = git_blob_and_sha(terminal, str(path))
        except subprocess.CalledProcessError as exc:
            errors.append(f"cannot read {path} at {terminal}: {exc}")
            continue
        if t.get(blob_field) != blob or t.get(sha_field) != digest:
            errors.append(f"task0141 {key} binding drift")
    finding = registry.get("finding") or {}
    if finding.get("classification") != "LEGACY_GOVERNANCE_FINDING_PRE_ACTIVATION":
        errors.append("finding classification drift")
    tails = registry.get("registeredTails") or []
    if [item.get("taskId") for item in tails if isinstance(item, dict)] != [
        "TASK-0098",
        "TASK-0189",
        "TASK-0196",
    ]:
        errors.append("registered tails drift")
    return errors


def expect_errors(contract: dict, registry: dict, needle: str) -> None:
    found = verify_registry(contract, registry)
    if not found:
        raise SystemExit(f"expected failure for {needle}, got PASS")
    if not any(needle in item for item in found):
        raise SystemExit(f"expected {needle!r} in {found}")


def main() -> int:
    contract = load_card_contract()
    registry = json.loads(REGISTRY.read_text(encoding="utf-8"))
    errors = verify_registry(contract, registry)
    if errors:
        print("FAIL")
        for item in errors:
            print(item)
        return 1

    mutated = copy.deepcopy(registry)
    mutated["doesNotLegitimize"] = False
    expect_errors(contract, mutated, "must not legitimize the finding")

    mutated = copy.deepcopy(registry)
    mutated["task0141"]["cardBlob"] = "0" * 40
    expect_errors(contract, mutated, "task0141 card binding drift")

    mutated = copy.deepcopy(registry)
    mutated["registeredTails"] = mutated["registeredTails"][:-1]
    expect_errors(contract, mutated, "registered tails drift")

    print("PASS: TASK-0237 history registry matches card identity and TASK-0141 terminal Git objects")
    print("PASS: negative matrix detected legitimacy/binding/tail drift")
    return 0


if __name__ == "__main__":
    sys.exit(main())

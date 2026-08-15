#!/usr/bin/env python3
"""Verify TASK-0231 governance-gap quarantine JSON against the frozen card contract and repository facts."""

from __future__ import annotations

import copy
import json
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[3]
CARD = ROOT / "docs/tasks/TASK-0231-governance-gap-quarantine.md"
RECORD = ROOT / "docs/evidence/TASK-0231/governance-gap-quarantine.json"

CARD_TASKS = [
    "TASK-0213",
    "TASK-0214",
    "TASK-0215",
    "TASK-0216",
    "TASK-0217",
    "TASK-0218",
    "TASK-0219",
    "TASK-0221",
    "TASK-0222",
    "TASK-0223",
    "TASK-0224",
    "TASK-0225",
    "TASK-0226",
    "TASK-0227",
]
CHECK_KEYS = ("vitest", "diffCheck", "readyDoctor", "precheck", "preClosure")


def load_card_contract() -> dict:
    text = CARD.read_text(encoding="utf-8")
    start = text.find("```yaml\n")
    end = text.find("\n```", start + 8)
    if start < 0 or end < 0:
        raise SystemExit("task card YAML block missing")
    task = yaml.safe_load(text[start + 8 : end])
    contract = task.get("governanceGapQuarantine")
    if not isinstance(contract, dict):
        raise SystemExit("card missing governanceGapQuarantine")
    return contract


def evidence_checks(task_id: str) -> dict[str, str]:
    path = ROOT / "docs" / "evidence" / task_id / "evidence-pack.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    statuses: dict[str, str] = {}
    for check in data.get("checks", []):
        command = str(check.get("command", ""))
        if "pre-closure" in command:
            statuses["preClosure"] = str(check.get("status"))
        elif "precheck" in command:
            statuses["precheck"] = str(check.get("status"))
        elif "doctor.py" in command:
            statuses["readyDoctor"] = str(check.get("status"))
        elif "vitest" in command:
            statuses["vitest"] = str(check.get("status"))
        else:
            statuses["diffCheck"] = str(check.get("status"))
    return statuses, str(data.get("headCommit", ""))


def verify_record(contract: dict, record: dict) -> list[str]:
    errors: list[str] = []
    if record.get("recordId") != contract.get("recordId"):
        errors.append("recordId drift")
    if record.get("kind") != contract.get("kind"):
        errors.append("kind drift")
    if record.get("doesNotLegitimizeAnyClosure") is not True:
        errors.append("must not legitimize any closure")
    if record.get("doesNotRetroactivelyAuthorize") is not True:
        errors.append("must not retroactively authorize")
    if record.get("reusable") is not False or record.get("oneTimeOnly") is not True:
        errors.append("must be one-time and non-reusable")
    if record.get("copiedRecordForbidden") is not True or record.get("secondConsumptionForbidden") is not True:
        errors.append("copy/second-consumption must be forbidden")
    if record.get("recordId") == "OWNER-MAINT-20260815-TASK-0198-LEGACY-INVALID-CLOSURE-01":
        errors.append("copied TASK-0198 recordId is forbidden")

    groups = record.get("groups")
    if not isinstance(groups, list) or len(groups) != 3:
        errors.append("groups must be exactly 3")
        return errors
    by_id = {item.get("groupId"): item for item in groups if isinstance(item, dict)}
    expected_ids = [
        "LEGACY_VALIDATION_GAP_BATCH",
        "LEGACY_AUTHORIZATION_GAP_0209_0210",
        "LEGACY_EXACT_TREE_EVIDENCE_GAP",
    ]
    if set(by_id) != set(expected_ids):
        errors.append(f"group ids drift: {sorted(by_id)}")

    batch = by_id.get("LEGACY_VALIDATION_GAP_BATCH") or {}
    cards = batch.get("cards")
    if not isinstance(cards, list) or len(cards) != 14:
        errors.append("validation gap batch must contain exactly 14 cards")
        return errors
    recorded = {str(item.get("taskId")): item for item in cards if isinstance(item, dict)}
    if set(recorded) != set(CARD_TASKS):
        errors.append(f"card id set drift: {sorted(recorded)}")
    frozen_terminals = set(str(item) for item in (contract.get("groups") or [{}])[0].get("terminalCommits", []))
    for item in cards:
        task_id = str(item.get("taskId"))
        statuses, head = evidence_checks(task_id)
        if item.get("state") != "ACCEPTED":
            errors.append(f"{task_id}: state must be ACCEPTED")
        if str(item.get("terminalCommit", "")) not in frozen_terminals:
            errors.append(f"{task_id}: terminalCommit not in frozen card contract")
        if str(item.get("evidenceHeadCommit", "")) != head:
            errors.append(f"{task_id}: evidenceHeadCommit drift (repo has {head})")
        recorded_checks = item.get("checks") or {}
        for key in CHECK_KEYS:
            if str(recorded_checks.get(key)) != statuses.get(key):
                errors.append(
                    f"{task_id}: check {key} drift (recorded {recorded_checks.get(key)}, repo has {statuses.get(key)})"
                )
        if statuses.get("preClosure") == "PASS":
            errors.append(f"{task_id}: preClosure must not be recorded as PASS")

    auth = by_id.get("LEGACY_AUTHORIZATION_GAP_0209_0210") or {}
    facts = auth.get("facts") or {}
    if facts.get("notRetroactivelyAuthorized") is not True:
        errors.append("authorization gap must not be retroactively authorized")
    if facts.get("task0209RejectedCommit") != "eed0bf6957987ae0adac3f30cc41ce23cf919cf9":
        errors.append("task0209RejectedCommit drift")
    if facts.get("task0210ReadyCommit") != "ecc35f7feb208686ebd8233e4533f5ce7ebc2d07":
        errors.append("task0210ReadyCommit drift")
    if facts.get("task0210AcceptedCommit") != "1e8922ca7394655657f68a9379315116f2e6e91b":
        errors.append("task0210AcceptedCommit drift")
    if facts.get("task0209PrecheckStatus") != "FAIL" or facts.get("task0209PrecheckExitCode") != 1:
        errors.append("task0209 precheck must be real FAIL exit 1")
    if facts.get("task0209PreclosureStatus") != "FAIL" or facts.get("task0209PreclosureExitCode") != 1:
        errors.append("task0209 pre-closure must be real FAIL exit 1")

    gap = by_id.get("LEGACY_EXACT_TREE_EVIDENCE_GAP") or {}
    e_facts = gap.get("facts") or {}
    if e_facts.get("representativeTaskId") != "TASK-0230":
        errors.append("exact-tree gap representative task drift")
    if e_facts.get("task0230AcceptedCommit") != "a0d4106ab25de7a59803254cb12d823ca2a5a98c":
        errors.append("task0230AcceptedCommit drift")
    if e_facts.get("missingStrongTypedRemoteUnavailableEvidence") is not True:
        errors.append("must record missing strong typed remote unavailable evidence")
    if e_facts.get("missingOwnerAuthorizedScope") is not True:
        errors.append("must record missing owner authorized scope")
    if e_facts.get("missingResultRecordRequiredFields") is not True:
        errors.append("must record missing result record required fields")
    if e_facts.get("missingUncoveredPlatformsRecord") is not True:
        errors.append("must record missing uncovered platforms record")

    # Repository-side cross-check for 0209 and 0230 evidence identity.
    data0209 = json.loads((ROOT / "docs/evidence/TASK-0209/evidence-pack.json").read_text(encoding="utf-8"))
    if str(data0209.get("headCommit", "")) != "b50a5efddd20d139f4de763084908ff2618ccf82":
        errors.append("TASK-0209 evidence headCommit drift")
    data0230 = json.loads((ROOT / "docs/evidence/TASK-0230/evidence-pack.json").read_text(encoding="utf-8"))
    if str(data0230.get("headCommit", "")) != "6bfea47d74610e7610d92e588c25a76f05dc677b":
        errors.append("TASK-0230 evidence headCommit drift")
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
    mutated["doesNotLegitimizeAnyClosure"] = False
    expect_errors(contract, mutated, "must not legitimize any closure")

    mutated = copy.deepcopy(record)
    mutated["doesNotRetroactivelyAuthorize"] = False
    expect_errors(contract, mutated, "must not retroactively authorize")

    mutated = copy.deepcopy(record)
    mutated["groups"][0]["cards"][7]["checks"]["preClosure"] = "PASS"
    expect_errors(contract, mutated, "check preClosure drift")

    mutated = copy.deepcopy(record)
    mutated["recordId"] = "OWNER-MAINT-20260815-TASK-0198-LEGACY-INVALID-CLOSURE-01"
    expect_errors(contract, mutated, "copied TASK-0198 recordId")

    mutated = copy.deepcopy(record)
    mutated["groups"] = mutated["groups"][:-1]
    expect_errors(contract, mutated, "groups must be exactly 3")

    print("PASS: TASK-0231 quarantine contract matches card identity and repository evidence")
    print("PASS: negative matrix detected legitimacy/authorization/status/copy/count drift")
    return 0


if __name__ == "__main__":
    sys.exit(main())

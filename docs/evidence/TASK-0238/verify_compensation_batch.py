#!/usr/bin/env python3
"""Verify TASK-0238 compensation batch 1: per-card exact historical binding."""

from __future__ import annotations

import copy
import json
import subprocess
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[3]
CARD = ROOT / "docs/tasks/TASK-0238-compensation-batch-1.md"
RECORD = ROOT / "docs/evidence/TASK-0238/compensation-batch-1.json"


def load_card_contract() -> dict:
    text = CARD.read_text(encoding="utf-8")
    start = text.find("```yaml\n")
    end = text.find("\n```", start + 8)
    if start < 0 or end < 0:
        raise SystemExit("task card YAML block missing")
    task = yaml.safe_load(text[start + 8 : end])
    contract = task.get("compensationBatch")
    if not isinstance(contract, dict):
        raise SystemExit("card missing compensationBatch")
    return contract


def is_ancestor(ancestor: str, descendant: str) -> bool:
    return (
        subprocess.run(
            ["git", "merge-base", "--is-ancestor", ancestor, descendant],
            cwd=ROOT,
            capture_output=True,
        ).returncode
        == 0
    )


def git_tree(commit: str) -> str:
    return subprocess.check_output(
        ["git", "rev-parse", f"{commit}^{{tree}}"], cwd=ROOT, text=True
    ).strip()


def git_blob(commit: str, path: str) -> str:
    return subprocess.check_output(
        ["git", "rev-parse", f"{commit}:{path}"], cwd=ROOT, text=True
    ).strip()


def evidence_preclosure_status(task_id: str) -> list[str]:
    path = ROOT / "docs" / "evidence" / task_id / "evidence-pack.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    return [
        str(item.get("status"))
        for item in (data.get("checks") or [])
        if isinstance(item, dict) and "pre-closure" in str(item.get("command", ""))
    ]


def verify_card(card: dict) -> list[str]:
    errors: list[str] = []
    task_id = str(card.get("taskId"))
    base = str(card.get("baseCommit"))
    terminal = str(card.get("terminalCommit"))
    candidate = str(card.get("candidateCommit"))
    tree = str(card.get("candidateTree"))
    if not (is_ancestor(base, candidate) and is_ancestor(candidate, terminal)):
        errors.append(f"{task_id}: chain base->candidate->terminal failed")
    try:
        actual_tree = git_tree(candidate)
    except subprocess.CalledProcessError:
        actual_tree = ""
    if actual_tree != tree:
        errors.append(f"{task_id}: candidateTree does not belong to candidateCommit")
    for artifact, path in (
        ("card", f"docs/tasks/{task_id}-*.md"),
        ("evidence", f"docs/evidence/{task_id}/evidence-pack.json"),
        ("handoff", f"docs/handoffs/{task_id}.json"),
    ):
        if "*" in path:
            # resolve card path via glob
            matches = sorted(ROOT.glob(path))
            if not matches:
                errors.append(f"{task_id}: card path missing")
                continue
            path = str(matches[0].relative_to(ROOT))
        try:
            current = git_blob("HEAD", path)
            frozen = git_blob(terminal, path)
        except subprocess.CalledProcessError as exc:
            errors.append(f"{task_id}: cannot read {path}: {exc}")
            continue
        if current != frozen:
            errors.append(f"{task_id}: {artifact} artifacts were rewritten after terminal")
    statuses = evidence_preclosure_status(task_id)
    if not statuses or any(status != "NOT_RUN" for status in statuses):
        errors.append(f"{task_id}: preClosure NOT_RUN gap was not kept")
    return errors


def verify_record(contract: dict, record: dict) -> list[str]:
    errors: list[str] = []
    if record.get("batchId") != contract.get("batchId"):
        errors.append("batchId drift")
    if record.get("doesNotRewriteHistory") is not True or record.get("doesNotConvertNotRunToPass") is not True:
        errors.append("record must declare no-rewrite and no-conversion")
    expected_cards = contract.get("cards") or []
    cards = record.get("cards") or []
    if len(cards) != len(expected_cards):
        errors.append(f"expected {len(expected_cards)} cards, got {len(cards)}")
        return errors
    for expected, actual in zip(expected_cards, cards):
        if expected != actual:
            errors.append(f"{expected.get('taskId')}: card identity drifted from card contract")
        errors.extend(verify_card(actual))
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
    mutated["cards"][0]["candidateTree"] = "0" * 40
    expect_errors(contract, mutated, "candidateTree does not belong")

    mutated = copy.deepcopy(record)
    mutated["cards"][1]["candidateCommit"] = "0" * 40
    expect_errors(contract, mutated, "chain base->candidate->terminal failed")

    mutated = copy.deepcopy(record)
    mutated["cards"][2]["terminalCommit"] = mutated["cards"][2]["candidateCommit"]
    expect_errors(contract, mutated, "artifacts were rewritten")

    print("PASS: TASK-0238 compensation batch 1 matches card contract and live Git objects")
    print("PASS: negative matrix detected tree/chain/artifact drift")
    return 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""Verify TASK-0232 quarantine registry against the frozen card contract and Git objects."""

from __future__ import annotations

import copy
import hashlib
import json
import subprocess
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[3]
CARD = ROOT / "docs/tasks/TASK-0232-quarantine-registry.md"
REGISTRY = ROOT / "docs/evidence/TASK-0232/quarantine-registry.json"


def load_card_contract() -> dict:
    text = CARD.read_text(encoding="utf-8")
    start = text.find("```yaml\n")
    end = text.find("\n```", start + 8)
    if start < 0 or end < 0:
        raise SystemExit("task card YAML block missing")
    task = yaml.safe_load(text[start + 8 : end])
    contract = task.get("quarantineRegistry")
    if not isinstance(contract, dict):
        raise SystemExit("card missing quarantineRegistry")
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
    if registry.get("doesNotLegitimizeAnyClosure") is not True:
        errors.append("must not legitimize any closure")
    if registry.get("doesNotRetroactivelyAuthorize") is not True:
        errors.append("must not retroactively authorize")
    if registry.get("reusable") is not False or registry.get("oneTimeOnly") is not True:
        errors.append("must be one-time and non-reusable")
    if registry.get("copiedRecordForbidden") is not True or registry.get("secondConsumptionForbidden") is not True:
        errors.append("copy/second-consumption must be forbidden")
    if registry.get("recordId") == contract.get("predecessorRecordIdNotCopied"):
        errors.append("must not copy TASK-0231 recordId")

    pred = registry.get("predecessor") or {}
    if pred.get("taskId") != "TASK-0231" or pred.get("state") != "REJECTED":
        errors.append("predecessor must be TASK-0231 REJECTED")
    terminal = contract.get("predecessorTerminalCommit")
    if pred.get("terminalCommit") != terminal:
        errors.append("predecessor terminalCommit drift")
    if pred.get("terminalTree") != contract.get("predecessorTerminalTree"):
        errors.append("predecessor terminalTree drift")
    if pred.get("quarantinePath") != contract.get("predecessorQuarantinePath"):
        errors.append("quarantinePath drift")
    if pred.get("verifyPath") != contract.get("predecessorVerifyPath"):
        errors.append("verifyPath drift")
    if pred.get("recordIdNotCopied") != contract.get("predecessorRecordIdNotCopied"):
        errors.append("recordIdNotCopied drift")
    try:
        blob, digest = git_blob_and_sha(terminal, str(contract.get("predecessorQuarantinePath")))
    except subprocess.CalledProcessError as exc:
        errors.append(f"cannot read quarantine JSON at {terminal}: {exc}")
        blob = digest = ""
    if blob != contract.get("predecessorQuarantineBlob") or digest != contract.get("predecessorQuarantineSha256"):
        errors.append("quarantine blob/sha256 drift at TASK-0231 terminal")
    if pred.get("quarantineBlob") != contract.get("predecessorQuarantineBlob"):
        errors.append("predecessor quarantineBlob drift")
    if pred.get("quarantineSha256") != contract.get("predecessorQuarantineSha256"):
        errors.append("predecessor quarantineSha256 drift")
    try:
        blob2, digest2 = git_blob_and_sha(terminal, str(contract.get("predecessorVerifyPath")))
    except subprocess.CalledProcessError as exc:
        errors.append(f"cannot read verify script at {terminal}: {exc}")
        blob2 = digest2 = ""
    if blob2 != contract.get("predecessorVerifyBlob") or digest2 != contract.get("predecessorVerifySha256"):
        errors.append("verify script blob/sha256 drift at TASK-0231 terminal")
    if pred.get("verifyBlob") != contract.get("predecessorVerifyBlob"):
        errors.append("predecessor verifyBlob drift")
    if pred.get("verifySha256") != contract.get("predecessorVerifySha256"):
        errors.append("predecessor verifySha256 drift")

    reg = registry.get("registry") or {}
    if reg.get("groupIds") != contract.get("groupIds"):
        errors.append("groupIds drift")
    if reg.get("task0210AcceptedCommitCorrectSha") != contract.get("task0210AcceptedCommitCorrectSha"):
        errors.append("task0210AcceptedCommitCorrectSha drift")
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
    mutated["doesNotLegitimizeAnyClosure"] = False
    expect_errors(contract, mutated, "must not legitimize any closure")

    mutated = copy.deepcopy(registry)
    mutated["doesNotRetroactivelyAuthorize"] = False
    expect_errors(contract, mutated, "must not retroactively authorize")

    mutated = copy.deepcopy(registry)
    mutated["recordId"] = contract.get("predecessorRecordIdNotCopied")
    expect_errors(contract, mutated, "must not copy TASK-0231 recordId")

    mutated = copy.deepcopy(registry)
    mutated["predecessor"]["quarantineBlob"] = "0" * 40
    expect_errors(contract, mutated, "predecessor quarantineBlob drift")

    mutated = copy.deepcopy(registry)
    mutated["registry"]["groupIds"] = mutated["registry"]["groupIds"][:-1]
    expect_errors(contract, mutated, "groupIds drift")

    print("PASS: TASK-0232 quarantine registry matches card identity and TASK-0231 terminal Git objects")
    print("PASS: negative matrix detected legitimacy/authorization/copy/blob/group drift")
    return 0


if __name__ == "__main__":
    sys.exit(main())

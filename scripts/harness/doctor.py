#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import yaml

from harness_common import (
    CONTEXT_ALGORITHM,
    ROOT,
    HarnessError,
    changed_paths,
    configure_utf8_stdio,
    discover_tasks,
    git_bytes,
    git_object,
    git_text,
    glob_matches,
    is_repository_relative,
    load_yaml,
    normalize_repo_path,
    parse_skill_metadata,
    relative,
    sha256_file,
    SKILL_FRONTMATTER_RE,
    TASK_BLOCK_RE,
    verify_context_lock,
)

FULL_COMMIT_RE = re.compile(r"^[0-9a-f]{40}$")
TASK_ID_RE = re.compile(r"^TASK-[0-9]{4,}$")
RISK_RANK = {"C1": 1, "C2": 2, "C3": 3, "C4": 4}
AUTHORIZATION_FIELDS = (
    "taskId",
    "owner",
    "riskClass",
    "requiredSkills",
    "requiredSkillVersions",
    "targetSkillVersions",
    "baseCommit",
    "contextFingerprint",
    "contextLock",
    "contextFingerprintAlgorithm",
    "readAllowlist",
    "writeAllowlist",
    "forbiddenPaths",
    "sourcesOfTruth",
    "requiredInvariants",
    "humanApprovals",
    "independentReview",
    "requiredCommands",
)
AUTHORIZATION_MUTABLE_FIELDS = {"state", "authorizationCommit", "reviewers"}
PROJECT_STATE_CLOSURE_MUTABLE_FIELDS = {
    "activeTask",
    "activeTaskCard",
    "lastAcceptedTask",
    "lastAcceptedHandoff",
    "lastTerminalTask",
    "lastTerminalHandoff",
    "nextAction",
    "updatedAt",
}
CANONICAL_PRECHECK_COMMANDS = {
    "doctor": ["scripts/harness/doctor.py"],
    "catalogValidate": ["scripts/harness/catalog_tool.py", "validate"],
    "catalogDrift": ["scripts/harness/catalog_tool.py", "diff", "--fail-on-drift"],
    "paidFeatureCheck": ["scripts/harness/check_paid_features.py"],
    "betaRosterGate": ["scripts/harness/check_beta_gate.py"],
}


class Audit:
    def __init__(self) -> None:
        self.errors: list[str] = []
        self.warnings: list[str] = []
        self.checks = 0

    def require(self, condition: bool, message: str) -> None:
        self.checks += 1
        if not condition:
            self.errors.append(message)

    def error(self, message: str) -> None:
        self.checks += 1
        self.errors.append(message)

    def warn(self, message: str) -> None:
        self.warnings.append(message)


def load_json(path: Path, audit: Audit) -> dict[str, Any] | None:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        audit.error(f"{relative(path)}: cannot load JSON: {exc}")
        return None
    if not isinstance(data, dict):
        audit.error(f"{relative(path)}: JSON root must be an object")
        return None
    return data


def json_type_matches(value: Any, expected: str) -> bool:
    if expected == "object":
        return isinstance(value, dict)
    if expected == "array":
        return isinstance(value, list)
    if expected == "string":
        return isinstance(value, str)
    if expected == "integer":
        return isinstance(value, int) and not isinstance(value, bool)
    if expected == "number":
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    if expected == "boolean":
        return isinstance(value, bool)
    if expected == "null":
        return value is None
    return True


def validate_json_schema(
    audit: Audit,
    value: Any,
    schema: dict[str, Any],
    label: str,
) -> None:
    expected_type = schema.get("type")
    if isinstance(expected_type, str):
        valid_type = json_type_matches(value, expected_type)
    elif isinstance(expected_type, list):
        valid_type = any(json_type_matches(value, str(item)) for item in expected_type)
    else:
        valid_type = True
    audit.require(valid_type, f"{label}: expected type {expected_type}")
    if not valid_type:
        return
    if "enum" in schema:
        audit.require(value in schema["enum"], f"{label}: value {value!r} is not in enum")
    if isinstance(value, str):
        if "minLength" in schema:
            audit.require(len(value) >= int(schema["minLength"]), f"{label}: string is too short")
        if "pattern" in schema:
            audit.require(bool(re.search(str(schema["pattern"]), value)), f"{label}: pattern mismatch")
    if isinstance(value, dict):
        required = schema.get("required", [])
        if isinstance(required, list):
            for field in required:
                audit.require(field in value, f"{label}: missing required property {field}")
        properties = schema.get("properties", {})
        if isinstance(properties, dict):
            for field, field_schema in properties.items():
                if field in value and isinstance(field_schema, dict):
                    validate_json_schema(audit, value[field], field_schema, f"{label}.{field}")
    if isinstance(value, list):
        item_schema = schema.get("items")
        if isinstance(item_schema, dict):
            for index, item in enumerate(value):
                validate_json_schema(audit, item, item_schema, f"{label}[{index}]")


def task_required_skills(task: dict[str, Any]) -> list[str]:
    raw = task.get("requiredSkills")
    return [str(item) for item in raw] if isinstance(raw, list) else []


def changed_skill_tree_ids(paths: list[str]) -> tuple[set[str], list[str]]:
    skill_ids: set[str] = set()
    invalid: list[str] = []
    for path in paths:
        normalized = normalize_repo_path(path)
        if not normalized.startswith("skills/"):
            continue
        parts = normalized.split("/")
        if len(parts) < 3 or not parts[1]:
            invalid.append(normalized)
            continue
        skill_ids.add(parts[1])
    return skill_ids, invalid


def semantic_version(value: Any) -> tuple[int, int, int] | None:
    match = re.fullmatch(r"([0-9]+)\.([0-9]+)\.([0-9]+)", str(value))
    if not match:
        return None
    return tuple(int(part) for part in match.groups())


def is_review_evidence_path(task_id: str, path: str) -> bool:
    prefix = f"docs/evidence/{task_id}/"
    return (
        is_repository_relative(path)
        and path.startswith(prefix)
        and path.endswith(".md")
    )


def task_authorization_projection(text: str) -> str:
    normalized = text.replace("\r\n", "\n")
    match = TASK_BLOCK_RE.search(normalized)
    if not match:
        raise HarnessError("task authorization projection: YAML block is missing")
    metadata = yaml.safe_load(match.group(1))
    if not isinstance(metadata, dict):
        raise HarnessError("task authorization projection: YAML metadata must be an object")
    for field in AUTHORIZATION_MUTABLE_FIELDS:
        metadata.pop(field, None)
    canonical = yaml.safe_dump(metadata, allow_unicode=True, sort_keys=True, width=120).rstrip()
    return normalized[: match.start()] + f"```yaml\n{canonical}\n```" + normalized[match.end() :]


def project_state_closure_projection(state: dict[str, Any]) -> dict[str, Any]:
    return {
        key: value
        for key, value in state.items()
        if key not in PROJECT_STATE_CLOSURE_MUTABLE_FIELDS
    }


def task_state_sequence(
    task: dict[str, Any],
    authorization_commit: str,
) -> list[str]:
    path = str(task["_path"])
    history = git_text(
        "log",
        "--format=%H",
        "--reverse",
        f"{authorization_commit}..HEAD",
        "--",
        path,
    ).stdout.splitlines()
    sequence = ["READY"]
    for commit in history:
        raw = git_object(commit.strip(), path).decode("utf-8")
        match = TASK_BLOCK_RE.search(raw)
        if not match:
            raise HarnessError(f"{path}: task YAML missing at {commit}")
        metadata = yaml.safe_load(match.group(1))
        if not isinstance(metadata, dict):
            raise HarnessError(f"{path}: task YAML invalid at {commit}")
        state = str(metadata.get("state", ""))
        if state != sequence[-1]:
            sequence.append(state)
    current_state = str(task.get("state", ""))
    if current_state != sequence[-1]:
        sequence.append(current_state)
    return sequence


def first_matching_state_commit(
    task: dict[str, Any],
    states: set[str],
) -> str | None:
    path = str(task["_path"])
    authorization_commit = str(task.get("authorizationCommit", ""))
    revision = f"{authorization_commit}..HEAD" if FULL_COMMIT_RE.fullmatch(authorization_commit) else "HEAD"
    history = git_text(
        "log",
        "--format=%H",
        "--reverse",
        revision,
        "--",
        path,
    ).stdout.splitlines()
    for commit in history:
        raw = git_object(commit.strip(), path).decode("utf-8")
        match = TASK_BLOCK_RE.search(raw)
        if not match:
            raise HarnessError(f"{path}: task YAML missing at {commit}")
        metadata = yaml.safe_load(match.group(1))
        if not isinstance(metadata, dict):
            raise HarnessError(f"{path}: task YAML invalid at {commit}")
        if str(metadata.get("state", "")) in states:
            return commit.strip()
    return None


def first_terminal_commit(
    task: dict[str, Any],
    terminal_states: set[str],
) -> str | None:
    return first_matching_state_commit(task, terminal_states)


def derive_latest_task_in_states(
    audit: Audit,
    tasks: dict[str, dict[str, Any]],
    states: set[str],
    label: str,
) -> str | None:
    committed: list[tuple[str, str]] = []
    uncommitted: list[str] = []
    try:
        for task_id, task in tasks.items():
            if str(task.get("state", "")) not in states:
                continue
            commit = first_matching_state_commit(task, states)
            if commit:
                committed.append((task_id, commit))
            else:
                uncommitted.append(task_id)
        audit.require(
            len(uncommitted) <= 1,
            f"project-state: multiple uncommitted {label} tasks are ambiguous: {sorted(uncommitted)}",
        )
        if uncommitted:
            return uncommitted[0]
        if not committed:
            return None
        latest_id, latest_commit = committed[0]
        for task_id, commit in committed[1:]:
            if commit == latest_commit:
                audit.error(
                    f"project-state: {label} tasks {latest_id} and {task_id} share one terminal commit"
                )
                return None
            latest_is_ancestor = git_text(
                "merge-base",
                "--is-ancestor",
                latest_commit,
                commit,
                check=False,
            )
            candidate_is_ancestor = git_text(
                "merge-base",
                "--is-ancestor",
                commit,
                latest_commit,
                check=False,
            )
            if latest_is_ancestor.returncode == 0:
                latest_id, latest_commit = task_id, commit
            elif candidate_is_ancestor.returncode != 0:
                audit.error(
                    f"project-state: {label} commits for {latest_id} and {task_id} are not comparable"
                )
                return None
        return latest_id
    except (HarnessError, OSError, UnicodeError, yaml.YAMLError) as exc:
        audit.error(f"project-state: cannot derive latest {label} task: {exc}")
        return None


def changed_paths_between(base_commit: str, target_commit: str) -> list[str]:
    result = git_bytes(
        "diff",
        "--name-only",
        "--diff-filter=ACDMRTUXB",
        "-z",
        base_commit,
        target_commit,
        "--",
    )
    return sorted(
        {
            normalize_repo_path(value.decode("utf-8", errors="surrogateescape"))
            for value in result.stdout.split(b"\0")
            if value
        }
    )


def yaml_at_commit(commit: str, path: str) -> dict[str, Any]:
    try:
        data = yaml.safe_load(git_object(commit, path))
    except (UnicodeError, yaml.YAMLError) as exc:
        raise HarnessError(f"{path}: invalid YAML at {commit}: {exc}") from exc
    if not isinstance(data, dict):
        raise HarnessError(f"{path}: YAML root must be an object at {commit}")
    return data


def protected_rules_at_commit(commit: str) -> list[dict[str, Any]]:
    data = yaml_at_commit(commit, ".harness/protected-paths.yaml")
    rules = data.get("paths")
    if not isinstance(rules, list):
        raise HarnessError(f".harness/protected-paths.yaml: paths must be a list at {commit}")
    return [rule for rule in rules if isinstance(rule, dict)]


def skill_registry_at_commit(commit: str) -> dict[str, dict[str, Any]]:
    data = yaml_at_commit(commit, ".harness/skills.yaml")
    entries = data.get("skills")
    if not isinstance(entries, list):
        raise HarnessError(f".harness/skills.yaml: skills must be a list at {commit}")
    return {
        str(entry.get("id")): entry
        for entry in entries
        if isinstance(entry, dict) and entry.get("id")
    }


def effective_protected_rules(
    audit: Audit,
    task: dict[str, Any],
    current_rules: list[dict[str, Any]],
    target_commit: str | None = None,
) -> list[dict[str, Any]]:
    task_id = str(task.get("taskId", ""))
    combined: list[dict[str, Any]] = []
    try:
        combined.extend(protected_rules_at_commit(str(task.get("baseCommit", ""))))
        if target_commit:
            combined.extend(protected_rules_at_commit(target_commit))
        else:
            combined.extend(current_rules)
    except HarnessError as exc:
        audit.error(f"{task_id}: cannot build effective protected rules: {exc}")
    deduplicated: list[dict[str, Any]] = []
    seen: set[str] = set()
    for rule in combined:
        identity = json.dumps(rule, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        if identity not in seen:
            seen.add(identity)
            deduplicated.append(rule)
    return deduplicated


def validate_tasks(
    audit: Audit,
    tasks: dict[str, dict[str, Any]],
    lifecycle: dict[str, Any],
) -> None:
    states = set(str(item) for item in lifecycle.get("states", []))
    transitions = lifecycle.get("transitions")
    audit.require(isinstance(transitions, dict), "task lifecycle: transitions must be an object")
    if isinstance(transitions, dict):
        audit.require(set(transitions) == states, "task lifecycle: every state must define transitions")
        for source, targets in transitions.items():
            audit.require(isinstance(targets, list), f"task lifecycle: {source} transitions must be a list")
            if isinstance(targets, list):
                for target in targets:
                    audit.require(str(target) in states, f"task lifecycle: {source} targets unknown state {target}")
    required = {
        "taskId",
        "state",
        "owner",
        "riskClass",
        "requiredSkills",
        "baseCommit",
        "contextFingerprint",
        "contextLock",
        "contextFingerprintAlgorithm",
        "readAllowlist",
        "writeAllowlist",
        "forbiddenPaths",
        "sourcesOfTruth",
        "requiredInvariants",
        "requiredCommands",
        "reviewers",
    }
    for task_id, task in tasks.items():
        path = task["_path"]
        missing = sorted(required - task.keys())
        audit.require(not missing, f"{path}: missing task fields: {missing}")
        audit.require(bool(TASK_ID_RE.fullmatch(task_id)), f"{path}: invalid taskId {task_id!r}")
        audit.require(task.get("state") in states, f"{path}: unknown state {task.get('state')!r}")
        audit.require(bool(task.get("owner")), f"{path}: owner is required")
        audit.require(
            task.get("riskClass") in RISK_RANK,
            f"{path}: riskClass must be one of {sorted(RISK_RANK)}",
        )
        audit.require(
            bool(FULL_COMMIT_RE.fullmatch(str(task.get("baseCommit", "")))),
            f"{path}: baseCommit must be a full lowercase Git SHA",
        )
        audit.require(
            bool(re.fullmatch(r"[0-9a-f]{64}", str(task.get("contextFingerprint", "")))),
            f"{path}: contextFingerprint must be SHA-256",
        )
        audit.require(
            task.get("contextFingerprintAlgorithm") == CONTEXT_ALGORITHM,
            f"{path}: unsupported context fingerprint algorithm",
        )
        for field in (
            "requiredSkills",
            "readAllowlist",
            "writeAllowlist",
            "forbiddenPaths",
            "sourcesOfTruth",
            "requiredInvariants",
            "requiredCommands",
            "reviewers",
        ):
            audit.require(isinstance(task.get(field), list), f"{path}: {field} must be a list")
        for error in verify_context_lock(task):
            audit.error(error)
        authorization_commit = str(task.get("authorizationCommit", ""))
        if task_id != "TASK-0001":
            audit.require(
                bool(FULL_COMMIT_RE.fullmatch(authorization_commit)),
                f"{path}: authorizationCommit must be a full Git SHA",
            )
        if FULL_COMMIT_RE.fullmatch(authorization_commit):
            ancestor = git_text("merge-base", "--is-ancestor", authorization_commit, "HEAD", check=False)
            audit.require(ancestor.returncode == 0, f"{path}: authorizationCommit is not an ancestor of HEAD")
            try:
                raw = git_object(authorization_commit, path)
                authorized_text = raw.decode("utf-8")
                current_text = (ROOT / path).read_text(encoding="utf-8")
                match = TASK_BLOCK_RE.search(authorized_text)
                audit.require(bool(match), f"{path}: authorization checkpoint has no task YAML")
                authorized = yaml.safe_load(match.group(1)) if match else {}
                audit.require(
                    isinstance(authorized, dict) and authorized.get("state") == "READY",
                    f"{path}: authorization checkpoint must contain a READY task",
                )
                if isinstance(authorized, dict):
                    for field in AUTHORIZATION_FIELDS:
                        audit.require(
                            task.get(field) == authorized.get(field),
                            f"{path}: authorized field changed after READY checkpoint: {field}",
                        )
                    lifecycle_rules = lifecycle.get("rules")
                    lifecycle_rules = lifecycle_rules if isinstance(lifecycle_rules, dict) else {}
                    if lifecycle_rules.get("readyRequiresOwnerApproval") is True:
                        approvals = task.get("humanApprovals")
                        approvals = approvals if isinstance(approvals, list) else []
                        owner_approved = any(
                            isinstance(item, dict)
                            and item.get("approvedBy") == task.get("owner")
                            and item.get("approvedAt")
                            and item.get("evidence")
                            for item in approvals
                        )
                        audit.require(owner_approved, f"{path}: READY checkpoint lacks Owner approval evidence")
                audit.require(
                    task_authorization_projection(current_text)
                    == task_authorization_projection(authorized_text),
                    f"{path}: task title/body or immutable metadata changed after READY checkpoint",
                )
                changed = git_bytes(
                    "diff",
                    "--name-only",
                    "-z",
                    str(task.get("baseCommit", "")),
                    authorization_commit,
                    "--",
                ).stdout
                checkpoint_paths = {
                    value.decode("utf-8", errors="surrogateescape").replace("\\", "/")
                    for value in changed.split(b"\0")
                    if value
                }
                allowed_checkpoint_paths = {path, str(task.get("contextLock", ""))}
                audit.require(path in checkpoint_paths, f"{path}: authorization commit must include the task card")
                audit.require(
                    checkpoint_paths <= allowed_checkpoint_paths,
                    f"{path}: authorization commit contains non-authorization files: "
                    f"{sorted(checkpoint_paths - allowed_checkpoint_paths)}",
                )
                git_object(authorization_commit, str(task.get("contextLock", "")))
                sequence = task_state_sequence(task, authorization_commit)
                transitions = lifecycle.get("transitions") or {}
                for previous, current in zip(sequence, sequence[1:]):
                    allowed = transitions.get(previous, [])
                    audit.require(
                        isinstance(allowed, list) and current in allowed,
                        f"{path}: invalid task state transition {previous} -> {current}; "
                        f"observed sequence {sequence}",
                    )
            except (HarnessError, OSError, UnicodeError, yaml.YAMLError) as exc:
                audit.error(f"{path}: cannot verify authorization checkpoint: {exc}")


def validate_project_state(
    audit: Audit,
    state: dict[str, Any],
    lifecycle: dict[str, Any],
    tasks: dict[str, dict[str, Any]],
) -> str | None:
    phase_source = str(state.get("phaseSource", ""))
    audit.require(is_repository_relative(phase_source), "project-state: phaseSource must be repository-relative")
    if is_repository_relative(phase_source):
        try:
            product = load_yaml(ROOT / normalize_repo_path(phase_source))
            audit.require(
                state.get("phase") == product.get("phase"),
                "project-state: phase disagrees with product-scope source",
            )
        except HarnessError as exc:
            audit.error(str(exc))
    try:
        projection = load_yaml(ROOT / ".harness/phase-scope.yaml")
        audit.require(
            projection.get("source") == phase_source
            and projection.get("currentPhase") == state.get("phase"),
            "phase-scope compatibility projection drifts from project-state/product-scope",
        )
    except HarnessError as exc:
        audit.error(str(exc))

    active_states = set(str(item) for item in lifecycle.get("activeStates", []))
    terminal_states = set(str(item) for item in lifecycle.get("terminalStates", []))
    max_active = int((lifecycle.get("rules") or {}).get("maximumActiveTasks", 1))
    active = sorted(task_id for task_id, task in tasks.items() if task.get("state") in active_states)
    audit.require(len(active) <= max_active, f"task lifecycle: active tasks {active} exceed maximum {max_active}")

    declared = state.get("activeTask")
    declared_id = str(declared) if declared else None
    audit.require(
        declared_id == (active[0] if len(active) == 1 else None),
        f"project-state: activeTask {declared_id!r} disagrees with discovered active tasks {active}",
    )
    if declared_id:
        audit.require(declared_id in tasks, f"project-state: unknown activeTask {declared_id}")
        if declared_id in tasks:
            audit.require(
                state.get("activeTaskCard") == tasks[declared_id]["_path"],
                "project-state: activeTaskCard does not point to the discovered task card",
            )
    else:
        audit.require(
            state.get("activeTaskCard") in (None, ""),
            "project-state: activeTaskCard must be null when no task is active",
        )

    last_accepted = str(state.get("lastAcceptedTask", ""))
    audit.require(last_accepted in tasks, f"project-state: unknown lastAcceptedTask {last_accepted!r}")
    if last_accepted in tasks:
        audit.require(
            tasks[last_accepted].get("state") == "ACCEPTED",
            f"project-state: lastAcceptedTask {last_accepted} is not ACCEPTED",
        )
    latest_accepted = derive_latest_task_in_states(audit, tasks, {"ACCEPTED"}, "accepted")
    audit.require(
        last_accepted == latest_accepted,
        f"project-state: lastAcceptedTask {last_accepted!r} must point to latest accepted task "
        f"{latest_accepted!r}",
    )
    handoff_value = str(state.get("lastAcceptedHandoff", ""))
    audit.require(is_repository_relative(handoff_value), "project-state: lastAcceptedHandoff must be relative")
    audit.require(
        handoff_value == f"docs/handoffs/{last_accepted}.json",
        "project-state: lastAcceptedHandoff must match lastAcceptedTask",
    )
    if is_repository_relative(handoff_value):
        audit.require((ROOT / handoff_value).is_file(), f"project-state: missing {handoff_value}")
    last_terminal = str(state.get("lastTerminalTask", ""))
    audit.require(last_terminal in tasks, f"project-state: unknown lastTerminalTask {last_terminal!r}")
    if last_terminal in tasks:
        audit.require(
            tasks[last_terminal].get("state") in terminal_states,
            f"project-state: lastTerminalTask {last_terminal} is not terminal",
        )
    latest_terminal = derive_latest_task_in_states(audit, tasks, terminal_states, "terminal")
    audit.require(
        last_terminal == latest_terminal,
        f"project-state: lastTerminalTask {last_terminal!r} must point to latest terminal task "
        f"{latest_terminal!r}",
    )
    terminal_handoff = str(state.get("lastTerminalHandoff", ""))
    audit.require(is_repository_relative(terminal_handoff), "project-state: lastTerminalHandoff must be relative")
    audit.require(
        terminal_handoff == f"docs/handoffs/{last_terminal}.json",
        "project-state: lastTerminalHandoff must match lastTerminalTask",
    )
    if is_repository_relative(terminal_handoff):
        audit.require((ROOT / terminal_handoff).is_file(), f"project-state: missing {terminal_handoff}")
    audit.require(bool(state.get("nextAction")), "project-state: nextAction is required")
    gates = state.get("capabilityGates")
    audit.require(isinstance(gates, dict) and bool(gates), "project-state: capabilityGates are required")

    for task_id, task in tasks.items():
        if task.get("state") in terminal_states:
            handoff_path = ROOT / f"docs/handoffs/{task_id}.json"
            evidence_path = ROOT / f"docs/evidence/{task_id}/evidence-pack.json"
            audit.require(handoff_path.is_file(), f"{task_id}: terminal task is missing handoff")
            audit.require(evidence_path.is_file(), f"{task_id}: terminal task is missing evidence pack")
    return declared_id


def validate_skills(
    audit: Audit,
    tasks: dict[str, dict[str, Any]],
) -> tuple[dict[str, dict[str, Any]], list[dict[str, Any]]]:
    registry = load_yaml(ROOT / ".harness/skills.yaml")
    entries = registry.get("skills")
    if not isinstance(entries, list):
        audit.error(".harness/skills.yaml: skills must be a list")
        entries = []
    skills: dict[str, dict[str, Any]] = {}
    for entry in entries:
        if not isinstance(entry, dict):
            audit.error(".harness/skills.yaml: each Skill entry must be an object")
            continue
        skill_id = str(entry.get("id", ""))
        audit.require(bool(skill_id), ".harness/skills.yaml: Skill id is required")
        audit.require(skill_id not in skills, f".harness/skills.yaml: duplicate Skill {skill_id}")
        skill_path = str(entry.get("path", ""))
        audit.require(is_repository_relative(skill_path), f"Skill {skill_id}: path must be repository-relative")
        path = ROOT / normalize_repo_path(skill_path)
        audit.require(path.is_file(), f"Skill {skill_id}: missing {skill_path}")
        if path.is_file():
            try:
                metadata = parse_skill_metadata(path)
                extension = metadata.get("metadata")
                extension = extension if isinstance(extension, dict) else {}
                declared_id = extension.get("id", metadata.get("id", metadata.get("name")))
                declared_version = extension.get("version", metadata.get("version", ""))
                audit.require(declared_id == skill_id, f"Skill {skill_id}: frontmatter id/name mismatch")
                audit.require(
                    str(declared_version) == str(entry.get("version", "")),
                    f"Skill {skill_id}: registry/frontmatter version mismatch",
                )
            except HarnessError as exc:
                audit.error(str(exc))
        skills[skill_id] = entry

    protected = load_yaml(ROOT / ".harness/protected-paths.yaml")
    rules = protected.get("paths")
    if not isinstance(rules, list):
        audit.error(".harness/protected-paths.yaml: paths must be a list")
        rules = []
    for rule in rules:
        if not isinstance(rule, dict):
            audit.error(".harness/protected-paths.yaml: path rule must be an object")
            continue
        audit.require(bool(rule.get("glob")), "protected path rule: glob is required")
        audit.require(
            rule.get("riskClass") in RISK_RANK,
            f"protected path {rule.get('glob')}: riskClass must be one of {sorted(RISK_RANK)}",
        )
        skill_id = str(rule.get("requiredSkill", ""))
        audit.require(skill_id in skills, f"protected path {rule.get('glob')}: unregistered Skill {skill_id}")

    for task_id, task in tasks.items():
        if task.get("state") in ("DRAFT", "REJECTED"):
            continue
        versions = task.get("requiredSkillVersions")
        if task_id != "TASK-0001":
            audit.require(isinstance(versions, dict), f"{task_id}: task must pin requiredSkillVersions")
        for skill_id in task_required_skills(task):
            audit.require(skill_id in skills, f"{task_id}: required Skill {skill_id} is not registered")
            if skill_id in skills and isinstance(versions, dict):
                skill_path = str(skills[skill_id].get("path", ""))
                try:
                    raw = git_object(str(task.get("baseCommit", "")), skill_path).decode("utf-8")
                    match = SKILL_FRONTMATTER_RE.search(raw)
                    if not match:
                        raise HarnessError(f"{skill_path}: baseline Skill frontmatter is missing")
                    baseline = yaml.safe_load(match.group(1))
                    if not isinstance(baseline, dict):
                        raise HarnessError(f"{skill_path}: baseline Skill frontmatter must be an object")
                    extension = baseline.get("metadata")
                    extension = extension if isinstance(extension, dict) else {}
                    baseline_version = extension.get("version", baseline.get("version", ""))
                    audit.require(
                        str(versions.get(skill_id, "")) == str(baseline_version),
                        f"{task_id}: required Skill {skill_id} is not pinned to its Base Commit version",
                    )
                except (HarnessError, UnicodeError, yaml.YAMLError) as exc:
                    audit.error(f"{task_id}: cannot verify baseline Skill {skill_id}: {exc}")
        targets = task.get("targetSkillVersions")
        if task_id != "TASK-0001":
            audit.require(isinstance(targets, dict), f"{task_id}: targetSkillVersions must be an object")
        delivery_skills = skills
        delivery_commit: str | None = None
        if task.get("state") == "ACCEPTED" and task_id != "TASK-0001":
            try:
                delivery_commit = first_terminal_commit(task, {"ACCEPTED", "REJECTED"})
                if delivery_commit:
                    delivery_skills = skill_registry_at_commit(delivery_commit)
            except HarnessError as exc:
                audit.error(f"{task_id}: cannot load terminal Skill registry: {exc}")
        if isinstance(targets, dict):
            for skill_id, target_version in targets.items():
                audit.require(
                    bool(re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", str(target_version))),
                    f"{task_id}: target Skill {skill_id} must use an exact semantic version",
                )
                if task.get("state") in ("IN_REVIEW", "ACCEPTED"):
                    audit.require(
                        skill_id in delivery_skills,
                        f"{task_id}: target Skill {skill_id} is not registered in delivery snapshot",
                    )
                if skill_id in delivery_skills and task.get("state") in ("IN_REVIEW", "ACCEPTED"):
                    audit.require(
                        str(delivery_skills[skill_id].get("version", "")) == str(target_version),
                        f"{task_id}: target Skill {skill_id} version does not match delivery registry",
                    )
        if (
            task_id != "TASK-0001"
            and task.get("state") in ("IN_REVIEW", "ACCEPTED")
            and isinstance(targets, dict)
        ):
            try:
                baseline_skills = skill_registry_at_commit(str(task.get("baseCommit", "")))
                removed = sorted(set(baseline_skills) - set(delivery_skills))
                audit.require(not removed, f"{task_id}: Skills cannot be removed by targetSkillVersions: {removed}")
                changed_skill_ids = set(delivery_skills) - set(baseline_skills)
                for skill_id in sorted(set(delivery_skills) & set(baseline_skills)):
                    current_entry = delivery_skills[skill_id]
                    baseline_entry = baseline_skills[skill_id]
                    baseline_path = str(baseline_entry.get("path", ""))
                    current_path = str(current_entry.get("path", ""))
                    if baseline_path != current_path:
                        audit.error(
                            f"{task_id}: Skill {skill_id} path changed; targetSkillVersions cannot authorize path moves"
                        )
                        changed_skill_ids.add(skill_id)
                        continue
                    if baseline_entry != current_entry:
                        changed_skill_ids.add(skill_id)
                    try:
                        baseline_content = git_object(
                            str(task.get("baseCommit", "")),
                            baseline_path,
                        )
                        current_content = (
                            git_object(delivery_commit, current_path)
                            if delivery_commit
                            else (ROOT / normalize_repo_path(current_path)).read_bytes()
                        )
                        if baseline_content != current_content:
                            changed_skill_ids.add(skill_id)
                    except (HarnessError, OSError) as exc:
                        audit.error(f"{task_id}: cannot compare Skill {skill_id} with Base Commit: {exc}")
                declared_targets = {str(skill_id) for skill_id in targets}
                delivery_paths = (
                    changed_paths_between(str(task.get("baseCommit", "")), delivery_commit)
                    if delivery_commit
                    else changed_paths(str(task.get("baseCommit", "")))
                )
                changed_tree_ids, invalid_skill_paths = changed_skill_tree_ids(
                    delivery_paths
                )
                audit.require(
                    not invalid_skill_paths,
                    f"{task_id}: changed Skill paths must belong to a registered Skill directory: "
                    f"{invalid_skill_paths}",
                )
                audit.require(
                    changed_tree_ids <= declared_targets,
                    f"{task_id}: changed Skill directories {sorted(changed_tree_ids)} exceed "
                    f"targetSkillVersions {sorted(declared_targets)}",
                )
                audit.require(
                    changed_skill_ids == declared_targets,
                    f"{task_id}: changed Skills {sorted(changed_skill_ids)} must exactly match "
                    f"targetSkillVersions {sorted(declared_targets)}",
                )
                for skill_id in sorted(changed_skill_ids & declared_targets):
                    target_version = semantic_version(targets.get(skill_id))
                    if skill_id in baseline_skills:
                        baseline_version = semantic_version(
                            baseline_skills[skill_id].get("version")
                        )
                        audit.require(
                            baseline_version is not None
                            and target_version is not None
                            and target_version > baseline_version,
                            f"{task_id}: changed existing Skill {skill_id} target version must increase "
                            f"from {baseline_skills[skill_id].get('version')}",
                        )
                    else:
                        audit.require(
                            target_version == (1, 0, 0),
                            f"{task_id}: new Skill {skill_id} must start at version 1.0.0",
                        )
            except (HarnessError, UnicodeError, yaml.YAMLError) as exc:
                audit.error(f"{task_id}: cannot verify target Skill delta: {exc}")
    return skills, [rule for rule in rules if isinstance(rule, dict)]


def validate_sources(audit: Audit, tasks: dict[str, dict[str, Any]]) -> None:
    registry = load_yaml(ROOT / ".harness/sources-of-truth.yaml")
    sources = registry.get("sources")
    audit.require(isinstance(sources, dict), ".harness/sources-of-truth.yaml: sources must be an object")
    if isinstance(sources, dict):
        for source_id, value in sources.items():
            path = str(value)
            audit.require(is_repository_relative(path), f"source {source_id}: path must be repository-relative")
            if is_repository_relative(path):
                audit.require((ROOT / normalize_repo_path(path)).exists(), f"source {source_id}: missing {path}")
    invariants = load_yaml(ROOT / ".harness/invariants.yaml").get("invariants")
    audit.require(isinstance(invariants, list), ".harness/invariants.yaml: invariants must be a list")
    invariant_ids: set[str] = set()
    if isinstance(invariants, list):
        for index, invariant in enumerate(invariants):
            audit.require(isinstance(invariant, dict), f"invariants[{index}]: must be an object")
            if not isinstance(invariant, dict):
                continue
            invariant_id = str(invariant.get("id", ""))
            audit.require(bool(invariant_id), f"invariants[{index}]: id is required")
            audit.require(invariant_id not in invariant_ids, f"invariants: duplicate id {invariant_id}")
            invariant_ids.add(invariant_id)
            audit.require(bool(invariant.get("statement")), f"invariant {invariant_id}: statement is required")
            audit.require(
                isinstance(invariant.get("enforcement"), list) and bool(invariant.get("enforcement")),
                f"invariant {invariant_id}: enforcement must be a non-empty list",
            )
    for task_id, task in tasks.items():
        for path_value in task.get("sourcesOfTruth", []):
            path = str(path_value)
            audit.require(is_repository_relative(path), f"{task_id}: source of truth must be relative: {path}")
            if is_repository_relative(path):
                audit.require(
                    (ROOT / normalize_repo_path(path)).is_file(),
                    f"{task_id}: source of truth does not exist: {path}",
                )
        for invariant_id in task.get("requiredInvariants", []):
            audit.require(
                str(invariant_id) in invariant_ids,
                f"{task_id}: unknown required invariant {invariant_id}",
            )
    for path in sorted((ROOT / "specs/contracts").glob("*.yaml")):
        try:
            contract = load_yaml(path)
            audit.require(bool(contract.get("schemaVersion")), f"{relative(path)}: schemaVersion is required")
        except HarnessError as exc:
            audit.error(str(exc))


def validate_harness_runtime(audit: Audit) -> None:
    tools = load_yaml(ROOT / ".harness/tools.lock.yaml")
    governance = tools.get("governance")
    governance = governance if isinstance(governance, dict) else {}
    python_policy = governance.get("python")
    python_policy = python_policy if isinstance(python_policy, dict) else {}
    minimum = str(python_policy.get("minimum", ""))
    try:
        major, minor = (int(part) for part in minimum.split(".", 1))
    except (TypeError, ValueError):
        audit.error("tools.lock: governance.python.minimum must be major.minor")
    else:
        audit.require(
            sys.version_info >= (major, minor),
            f"Harness requires Python {minimum}+; current is {sys.version_info.major}.{sys.version_info.minor}",
        )
    pyyaml_policy = governance.get("pyyaml")
    pyyaml_policy = pyyaml_policy if isinstance(pyyaml_policy, dict) else {}
    minimum_pyyaml = tuple(int(part) for part in str(pyyaml_policy.get("minimum", "")).split("."))
    maximum_pyyaml = tuple(
        int(part) for part in str(pyyaml_policy.get("maximumExclusive", "")).split(".")
    )
    current_pyyaml = tuple(int(part) for part in yaml.__version__.split(".")[:2])
    audit.require(
        minimum_pyyaml <= current_pyyaml < maximum_pyyaml,
        "Harness requires "
        f"PyYAML >= {pyyaml_policy.get('minimum')}, < {pyyaml_policy.get('maximumExclusive')}; "
        f"current is {yaml.__version__}",
    )
    timezone_policy = governance.get("timezoneData")
    timezone_policy = timezone_policy if isinstance(timezone_policy, dict) else {}
    required_zone = str(timezone_policy.get("requiredZone", ""))
    try:
        ZoneInfo(required_zone)
    except ZoneInfoNotFoundError:
        audit.error(
            f"Harness requires IANA timezone {required_zone}; "
            "install requirements-harness.txt so Windows receives tzdata"
        )


def validate_entrypoints(audit: Audit) -> None:
    config = load_yaml(ROOT / ".harness/agent-entrypoints.yaml")
    canonical = str(config.get("canonicalInstructions", ""))
    audit.require(canonical == "AGENTS.md", "agent-entrypoints: canonicalInstructions must be AGENTS.md")
    canonical_path = ROOT / canonical
    audit.require(canonical_path.is_file(), "agent-entrypoints: AGENTS.md is missing")
    if canonical_path.is_file():
        nonblank = [line for line in canonical_path.read_text(encoding="utf-8").splitlines() if line.strip()]
        audit.require(len(nonblank) <= 160, "AGENTS.md is too large; move explanations to onboarding docs")
    clients = config.get("clients")
    audit.require(isinstance(clients, dict), "agent-entrypoints: clients must be an object")
    if not isinstance(clients, dict):
        return
    allowed_modes = {"NATIVE_DISCOVERY", "THIN_IMPORT", "THIN_REFERENCE"}
    for client_id, client in clients.items():
        if not isinstance(client, dict):
            audit.error(f"agent-entrypoints: {client_id} must be an object")
            continue
        path_value = str(client.get("instructionPath", ""))
        audit.require(is_repository_relative(path_value), f"agent-entrypoints: {client_id} path is invalid")
        path = ROOT / normalize_repo_path(path_value)
        audit.require(path.is_file(), f"agent-entrypoints: {client_id} missing {path_value}")
        mode = client.get("mode")
        audit.require(mode in allowed_modes, f"agent-entrypoints: {client_id} has invalid mode {mode}")
        if mode == "NATIVE_DISCOVERY":
            audit.require(
                path_value == canonical,
                f"agent-entrypoints: native client {client_id} must use canonical instructions",
            )
        expected_hash = str(client.get("contentSha256", ""))
        audit.require(
            bool(re.fullmatch(r"[0-9a-f]{64}", expected_hash)),
            f"agent-entrypoints: {client_id} contentSha256 is required",
        )
        if path.is_file() and re.fullmatch(r"[0-9a-f]{64}", expected_hash):
            audit.require(
                sha256_file(path) == expected_hash,
                f"agent-entrypoints: {client_id} instruction content drifted",
            )
        if path.is_file() and mode in ("THIN_IMPORT", "THIN_REFERENCE"):
            text = path.read_text(encoding="utf-8")
            reference = str(client.get("requiredReference", ""))
            audit.require(reference in text, f"agent-entrypoints: {client_id} adapter misses {reference}")
            nonblank = [line for line in text.splitlines() if line.strip()]
            audit.require(len(nonblank) <= 8, f"agent-entrypoints: {client_id} adapter is not thin")
            audit.require("## 绝对禁止" not in text, f"agent-entrypoints: {client_id} duplicates canonical rules")


def validate_command_registry(audit: Audit, config: dict[str, Any]) -> None:
    runner = str(config.get("runner", ""))
    audit.require(
        runner == "scripts/harness/precheck.py",
        "commands: canonical runner must remain scripts/harness/precheck.py",
    )
    audit.require(is_repository_relative(runner), "commands: runner must be repository-relative")
    if is_repository_relative(runner):
        audit.require((ROOT / runner).is_file(), f"commands: missing runner {runner}")
    commands = config.get("commands")
    profiles = config.get("profiles")
    audit.require(isinstance(commands, dict), "commands: commands must be an object")
    audit.require(isinstance(profiles, dict), "commands: profiles must be an object")
    if not isinstance(commands, dict) or not isinstance(profiles, dict):
        return
    precheck_profile = profiles.get("precheck")
    audit.require(isinstance(precheck_profile, list), "commands: precheck profile must be a list")
    if isinstance(precheck_profile, list):
        missing = sorted(set(CANONICAL_PRECHECK_COMMANDS) - set(str(item) for item in precheck_profile))
        audit.require(
            not missing,
            f"commands: precheck profile cannot remove canonical checks: {missing}",
        )
    for command_id, command in commands.items():
        if not isinstance(command, dict):
            audit.error(f"commands: {command_id} must be an object")
            continue
        argv = command.get("argv")
        audit.require(isinstance(argv, list) and bool(argv), f"commands: {command_id}.argv must be a list")
        if isinstance(argv, list) and argv:
            script = str(argv[0])
            audit.require(is_repository_relative(script), f"commands: {command_id} script must be relative")
            if is_repository_relative(script):
                audit.require((ROOT / script).is_file(), f"commands: {command_id} missing {script}")
    for command_id, expected_argv in CANONICAL_PRECHECK_COMMANDS.items():
        command = commands.get(command_id)
        audit.require(isinstance(command, dict), f"commands: missing canonical command {command_id}")
        if isinstance(command, dict):
            audit.require(
                command.get("argv") == expected_argv,
                f"commands: canonical command {command_id} argv cannot be replaced",
            )
    for profile_id, command_ids in profiles.items():
        audit.require(isinstance(command_ids, list), f"commands: profile {profile_id} must be a list")
        if isinstance(command_ids, list):
            for command_id in command_ids:
                audit.require(command_id in commands, f"commands: profile {profile_id} references {command_id}")


def validate_commands(audit: Audit) -> None:
    validate_command_registry(audit, load_yaml(ROOT / ".harness/commands.yaml"))
    for wrapper in ("scripts/harness/precheck.sh", "scripts/harness/precheck.ps1"):
        path = ROOT / wrapper
        audit.require(path.is_file(), f"commands: missing wrapper {wrapper}")
        if path.is_file():
            audit.require("precheck.py" in path.read_text(encoding="utf-8"), f"{wrapper}: must call precheck.py")


def validate_evidence_and_handoffs(
    audit: Audit,
    tasks: dict[str, dict[str, Any]],
    lifecycle: dict[str, Any],
    current_protected_rules: list[dict[str, Any]],
) -> None:
    handoff_schema = load_json(ROOT / "docs/schemas/handoff.schema.json", audit)
    evidence_schema = load_json(ROOT / "docs/schemas/evidence-pack.schema.json", audit)
    if not handoff_schema or not evidence_schema:
        return
    handoff_states = set(
        handoff_schema.get("properties", {}).get("state", {}).get("enum", [])
    )
    lifecycle_states = set(str(item) for item in lifecycle.get("states", []))
    audit.require(handoff_states == lifecycle_states - {"DRAFT"}, "handoff schema states drift from lifecycle")
    handoffs: dict[str, dict[str, Any]] = {}
    for path in sorted((ROOT / "docs/handoffs").glob("TASK-*.json")):
        data = load_json(path, audit)
        if not data:
            continue
        validate_json_schema(audit, data, handoff_schema, relative(path))
        task_id = str(data.get("taskId", ""))
        audit.require(task_id in tasks, f"{relative(path)}: unknown taskId {task_id}")
        audit.require(path.stem == task_id, f"{relative(path)}: filename and taskId disagree")
        if task_id in tasks:
            audit.require(data.get("state") == tasks[task_id].get("state"), f"{relative(path)}: state disagrees with task")
            audit.require(
                data.get("baseCommit") == tasks[task_id].get("baseCommit"),
                f"{relative(path)}: baseCommit disagrees with task",
            )
        evidence_path = str(data.get("evidencePath", ""))
        audit.require(is_repository_relative(evidence_path), f"{relative(path)}: evidencePath must be relative")
        if is_repository_relative(evidence_path):
            audit.require((ROOT / evidence_path).is_file(), f"{relative(path)}: evidencePath does not exist")
        handoffs[task_id] = data

    evidence_packs: dict[str, dict[str, Any]] = {}
    for path in sorted((ROOT / "docs/evidence").glob("TASK-*/evidence-pack.json")):
        data = load_json(path, audit)
        if not data:
            continue
        validate_json_schema(audit, data, evidence_schema, relative(path))
        task_id = str(data.get("taskId", ""))
        directory_task_id = path.parent.name
        audit.require(task_id == directory_task_id, f"{relative(path)}: directory and taskId disagree")
        audit.require(task_id in tasks, f"{relative(path)}: unknown taskId {task_id}")
        if task_id in tasks:
            task = tasks[task_id]
            audit.require(data.get("baseCommit") == task.get("baseCommit"), f"{relative(path)}: baseCommit disagrees")
            audit.require(
                data.get("contextFingerprint") == task.get("contextFingerprint"),
                f"{relative(path)}: contextFingerprint disagrees",
            )
        checks = data.get("checks")
        audit.require(isinstance(checks, list) and bool(checks), f"{relative(path)}: checks must be non-empty")
        if not isinstance(checks, list):
            continue
        for index, check in enumerate(checks):
            label = f"{relative(path)} checks[{index}]"
            if not isinstance(check, dict):
                audit.error(f"{label}: must be an object")
                continue
            status = check.get("status")
            exit_code = check.get("exitCode")
            reason = check.get("reason")
            if status == "PASS":
                audit.require(exit_code == 0, f"{label}: PASS requires exitCode 0")
            elif status == "FAIL":
                audit.require(isinstance(exit_code, int) and exit_code != 0, f"{label}: FAIL requires non-zero exitCode")
            elif status == "NOT_RUN":
                audit.require(exit_code is None and bool(reason), f"{label}: NOT_RUN requires null exitCode and reason")
            audit.require(
                check.get("artifactHash") is not None or bool(reason),
                f"{label}: null artifactHash requires a truthful no-artifact reason",
            )
        evidence_packs[task_id] = data

    terminal_states = set(str(item) for item in lifecycle.get("terminalStates", []))
    for task_id, task in tasks.items():
        if task.get("state") not in terminal_states:
            continue
        evidence = evidence_packs.get(task_id)
        handoff = handoffs.get(task_id)
        if evidence is None or handoff is None:
            continue
        expected_evidence_path = f"docs/evidence/{task_id}/evidence-pack.json"
        audit.require(
            handoff.get("evidencePath") == expected_evidence_path,
            f"{task_id}: handoff must point to {expected_evidence_path}",
        )
        audit.require(
            evidence.get("headCommit") == handoff.get("headCommit"),
            f"{task_id}: Evidence and Handoff headCommit disagree",
        )
        head_commit = str(evidence.get("headCommit", ""))
        audit.require(bool(FULL_COMMIT_RE.fullmatch(head_commit)), f"{task_id}: headCommit must be a full Git SHA")
        if FULL_COMMIT_RE.fullmatch(head_commit):
            exists = git_text("cat-file", "-e", f"{head_commit}^{{commit}}", check=False)
            audit.require(exists.returncode == 0, f"{task_id}: headCommit does not exist")
            ancestor = git_text("merge-base", "--is-ancestor", str(task.get("baseCommit", "")), head_commit, check=False)
            audit.require(ancestor.returncode == 0, f"{task_id}: headCommit does not descend from baseCommit")
            merged = git_text("merge-base", "--is-ancestor", head_commit, "HEAD", check=False)
            audit.require(merged.returncode == 0, f"{task_id}: headCommit is not an ancestor of current HEAD")
        # TASK-0001 predates the versioned authorization/evidence contract. The
        # portable Harness validates its reproducible base/head/path bindings
        # above, while all tasks with authorizationCommit use the full v2 gate.
        if task.get("authorizationCommit"):
            validate_versioned_terminal_evidence(
                audit,
                task_id,
                task,
                evidence,
                handoff,
                head_commit,
                terminal_states,
                current_protected_rules,
            )


def validate_required_command_coverage(
    audit: Audit,
    task: dict[str, Any],
    by_command: dict[str, list[dict[str, Any]]],
    require_pass: bool,
) -> None:
    task_id = str(task.get("taskId"))
    for command in task.get("requiredCommands", []):
        matches = by_command.get(str(command), [])
        audit.require(bool(matches), f"{task_id}: required command missing from Evidence: {command}")
        if require_pass:
            audit.require(
                any(item.get("status") == "PASS" and item.get("exitCode") == 0 for item in matches),
                f"{task_id}: required command did not PASS: {command}",
            )


def validate_idle_terminal_paths(audit: Audit, task_id: str, paths: list[str]) -> None:
    audit.require(
        not paths,
        f"{task_id}: repository changed after terminal commit without a new active task: {paths}",
    )


def validate_frozen_artifact_bytes(
    audit: Audit,
    label: str,
    current: bytes,
    terminal_snapshot: bytes,
) -> None:
    audit.require(
        current == terminal_snapshot,
        f"{label}: terminal audit artifact is immutable; create an amendment instead of rewriting it",
    )


def validate_frozen_repository_artifact(
    audit: Audit,
    task_id: str,
    terminal_commit: str,
    path: str,
) -> None:
    try:
        snapshot = git_object(terminal_commit, path)
        current = (ROOT / normalize_repo_path(path)).read_bytes()
        validate_frozen_artifact_bytes(audit, f"{task_id}: {path}", current, snapshot)
    except (HarnessError, OSError) as exc:
        audit.error(f"{task_id}: cannot verify frozen terminal artifact {path}: {exc}")


def validate_authorization_precedes_head(
    audit: Audit,
    task: dict[str, Any],
    head_commit: str,
) -> None:
    task_id = str(task.get("taskId", ""))
    authorization_commit = str(task.get("authorizationCommit", ""))
    result = git_text(
        "merge-base",
        "--is-ancestor",
        authorization_commit,
        head_commit,
        check=False,
    )
    audit.require(
        result.returncode == 0,
        f"{task_id}: reviewed headCommit must descend from authorizationCommit",
    )


def validate_versioned_terminal_evidence(
    audit: Audit,
    task_id: str,
    task: dict[str, Any],
    evidence: dict[str, Any],
    handoff: dict[str, Any],
    head_commit: str,
    terminal_states: set[str],
    current_protected_rules: list[dict[str, Any]],
) -> None:
    if FULL_COMMIT_RE.fullmatch(head_commit):
        validate_authorization_precedes_head(audit, task, head_commit)
    terminal_commit: str | None = None
    try:
        terminal_commit = first_terminal_commit(task, terminal_states)
        if terminal_commit:
            boundary_state = yaml.safe_load(
                git_object(terminal_commit, ".harness/project-state.yaml")
            )
            closure_paths = changed_paths_between(head_commit, terminal_commit)
            head_is_ancestor = git_text(
                "merge-base",
                "--is-ancestor",
                head_commit,
                terminal_commit,
                check=False,
            )
            audit.require(
                head_is_ancestor.returncode == 0,
                f"{task_id}: terminal commit does not descend from reviewed headCommit",
            )
            for boundary_path in (
                str(task["_path"]),
                f"docs/evidence/{task_id}/evidence-pack.json",
                f"docs/handoffs/{task_id}.json",
            ):
                validate_frozen_repository_artifact(
                    audit,
                    task_id,
                    terminal_commit,
                    boundary_path,
                )
        else:
            boundary_state = load_yaml(ROOT / ".harness/project-state.yaml")
            closure_paths = changed_paths(head_commit)
        reviewed_state = yaml.safe_load(
            git_object(head_commit, ".harness/project-state.yaml")
        )
        if not isinstance(reviewed_state, dict) or not isinstance(boundary_state, dict):
            raise HarnessError(".harness/project-state.yaml: compared versions must be objects")
        audit.require(
            project_state_closure_projection(reviewed_state)
            == project_state_closure_projection(boundary_state),
            f"{task_id}: protected project-state fields changed after reviewed headCommit",
        )
        current_state = load_yaml(ROOT / ".harness/project-state.yaml")
        if (
            terminal_commit
            and current_state.get("activeTask") in (None, "")
            and current_state.get("lastTerminalTask") == task_id
        ):
            audit.require(
                project_state_closure_projection(boundary_state)
                == project_state_closure_projection(current_state),
                f"{task_id}: protected project-state fields changed after terminal commit without a new task",
            )
            validate_idle_terminal_paths(
                audit,
                task_id,
                changed_paths(terminal_commit),
            )
    except (HarnessError, OSError, UnicodeError, yaml.YAMLError) as exc:
        audit.error(f"{task_id}: cannot verify terminal closure boundary: {exc}")
        closure_paths = []

    if FULL_COMMIT_RE.fullmatch(head_commit):
        try:
            implementation_paths = changed_paths_between(
                str(task.get("baseCommit", "")),
                head_commit,
            )
            implementation_skills = skill_registry_at_commit(head_commit)
            implementation_rules = effective_protected_rules(
                audit,
                task,
                current_protected_rules,
                target_commit=head_commit,
            )
            validate_diff_scope(
                audit,
                task,
                implementation_skills,
                implementation_rules,
                changed_override=implementation_paths,
            )
        except HarnessError as exc:
            audit.error(f"{task_id}: cannot verify implementation scope at headCommit: {exc}")

    checks = evidence.get("checks")
    checks = checks if isinstance(checks, list) else []
    by_command: dict[str, list[dict[str, Any]]] = {}
    for check in checks:
        if isinstance(check, dict):
            by_command.setdefault(str(check.get("command", "")), []).append(check)
            audit.require(bool(check.get("environment")), f"{task_id}: every check requires environment")
            verified_commit = str(check.get("verifiedCommit", ""))
            audit.require(
                bool(FULL_COMMIT_RE.fullmatch(verified_commit)),
                f"{task_id}: every check requires a full verifiedCommit",
            )
            if FULL_COMMIT_RE.fullmatch(verified_commit):
                exists = git_text("cat-file", "-e", f"{verified_commit}^{{commit}}", check=False)
                audit.require(exists.returncode == 0, f"{task_id}: check verifiedCommit does not exist")
                audit.require(
                    verified_commit == head_commit,
                    f"{task_id}: required checks must verify Evidence headCommit",
                )
    validate_required_command_coverage(
        audit,
        task,
        by_command,
        require_pass=task.get("state") == "ACCEPTED",
    )

    reviewers = task.get("reviewers")
    reviewers = reviewers if isinstance(reviewers, list) else []
    if str(task.get("riskClass")) in ("C3", "C4"):
        audit.require(bool(reviewers), f"{task_id}: terminal high-risk task requires reviewers")
        reviewer_ids: set[str] = set()
        for index, reviewer in enumerate(reviewers):
            label = f"{task_id}: reviewers[{index}]"
            audit.require(isinstance(reviewer, dict), f"{label} must be an object")
            if not isinstance(reviewer, dict):
                continue
            for field in ("id", "kind", "verdict", "reviewedCommit", "evidencePath"):
                audit.require(bool(reviewer.get(field)), f"{label}.{field} is required")
            reviewer_id = str(reviewer.get("id", ""))
            audit.require(reviewer_id not in reviewer_ids, f"{label}.id must be unique")
            reviewer_ids.add(reviewer_id)
            audit.require(reviewer.get("id") != task.get("owner"), f"{label} must be independent from owner")
            if task.get("state") == "ACCEPTED":
                audit.require(reviewer.get("verdict") == "PASS", f"{label} verdict must be PASS")
            else:
                audit.require(reviewer.get("verdict") in ("PASS", "FAIL"), f"{label} verdict is invalid")
            audit.require(
                reviewer.get("reviewedCommit") == head_commit,
                f"{label} must review Evidence headCommit",
            )
            review_path = str(reviewer.get("evidencePath", ""))
            audit.require(is_repository_relative(review_path), f"{label}.evidencePath must be relative")
            expected_review_prefix = f"docs/evidence/{task_id}/"
            audit.require(
                is_review_evidence_path(task_id, review_path),
                f"{label}.evidencePath must be a Markdown file under {expected_review_prefix}",
            )
            if is_repository_relative(review_path):
                review_file = ROOT / review_path
                audit.require(review_file.is_file(), f"{label}.evidencePath does not exist")
                if terminal_commit:
                    validate_frozen_repository_artifact(
                        audit,
                        task_id,
                        terminal_commit,
                        review_path,
                    )
                if review_file.is_file():
                    try:
                        review_text = review_file.read_text(encoding="utf-8")
                        match = TASK_BLOCK_RE.search(review_text)
                        audit.require(bool(match), f"{label}.evidencePath lacks fenced YAML metadata")
                        review_data = yaml.safe_load(match.group(1)) if match else {}
                        audit.require(isinstance(review_data, dict), f"{label} metadata must be an object")
                        if isinstance(review_data, dict):
                            expected = {
                                "taskId": task_id,
                                "reviewerId": reviewer.get("id"),
                                "verdict": reviewer.get("verdict"),
                                "reviewedCommit": reviewer.get("reviewedCommit"),
                            }
                            for field, value in expected.items():
                                audit.require(
                                    review_data.get(field) == value,
                                    f"{label} review evidence disagrees on {field}",
                                )
                    except (OSError, yaml.YAMLError) as exc:
                        audit.error(f"{label} cannot read review evidence: {exc}")
        audit.require(
            evidence.get("reviewers") == reviewers,
            f"{task_id}: Evidence reviewers disagree with task",
        )
        audit.require(
            handoff.get("reviewers") == reviewers,
            f"{task_id}: Handoff reviewers disagree with task",
        )
    allowed_closure = (
        task["_path"],
        ".harness/project-state.yaml",
        f"docs/evidence/{task_id}/**",
        f"docs/handoffs/{task_id}.json",
    )
    for path in closure_paths:
        audit.require(
            any(glob_matches(path, pattern) for pattern in allowed_closure),
            f"{task_id}: unverified implementation change after headCommit: {path}",
        )


def validate_diff_scope(
    audit: Audit,
    task: dict[str, Any],
    skills: dict[str, dict[str, Any]],
    protected_rules: list[dict[str, Any]],
    changed_override: list[str] | None = None,
) -> None:
    task_id = str(task.get("taskId"))
    try:
        changed = changed_override if changed_override is not None else changed_paths(str(task.get("baseCommit", "")))
    except (HarnessError, OSError) as exc:
        audit.error(f"{task_id}: cannot calculate diff scope: {exc}")
        return
    allowlist = [str(item) for item in task.get("writeAllowlist", [])]
    forbidden = [str(item) for item in task.get("forbiddenPaths", [])]
    required_skills = set(task_required_skills(task))
    approvals = task.get("humanApprovals")
    approvals = approvals if isinstance(approvals, list) else []
    reviewers = task.get("reviewers")
    reviewers = reviewers if isinstance(reviewers, list) else []
    independent_declared = task.get("independentReview") in (True, "required", "REQUIRED")

    for path in changed:
        audit.require(
            any(glob_matches(path, pattern) for pattern in allowlist),
            f"{task_id}: changed path is outside writeAllowlist: {path}",
        )
        audit.require(
            not any(glob_matches(path, pattern) for pattern in forbidden),
            f"{task_id}: changed path is forbidden: {path}",
        )
        for rule in protected_rules:
            if not glob_matches(path, str(rule.get("glob", ""))):
                continue
            skill_id = str(rule.get("requiredSkill", ""))
            task_risk = str(task.get("riskClass", ""))
            protected_risk = str(rule.get("riskClass", ""))
            audit.require(
                RISK_RANK.get(task_risk, 0) >= RISK_RANK.get(protected_risk, 99),
                f"{task_id}: {path} requires riskClass {protected_risk}, task declares {task_risk}",
            )
            audit.require(
                skill_id in required_skills and skill_id in skills,
                f"{task_id}: {path} requires registered Skill {skill_id}",
            )
            if rule.get("humanApproval") is True:
                approved = any(
                    isinstance(item, dict)
                    and item.get("scope") == skill_id
                    and item.get("approvedBy")
                    and item.get("evidence")
                    for item in approvals
                )
                audit.require(approved, f"{task_id}: {path} requires recorded human approval for {skill_id}")
            if rule.get("independentReview") is True:
                audit.require(independent_declared, f"{task_id}: {path} requires independentReview")
            if rule.get("generatedOnly") is True:
                source_changed = any(glob_matches(item, "specs/catalog/**") for item in changed)
                audit.require(source_changed, f"{task_id}: generated output changed without a Catalog source change")

    risk = str(task.get("riskClass", ""))
    if risk in ("C3", "C4"):
        audit.require(independent_declared, f"{task_id}: {risk} task must declare independentReview")
        if task.get("state") in ("ACCEPTED", "REJECTED"):
            audit.require(
                bool(reviewers) and all(isinstance(item, dict) for item in reviewers),
                f"{task_id}: terminal {risk} task requires structured independent reviewers",
            )
    audit.require(bool(changed), f"{task_id}: no changed files found from baseCommit")


def print_summary(state: dict[str, Any], tasks: dict[str, dict[str, Any]]) -> None:
    active = state.get("activeTask") or "NONE"
    last = state.get("lastAcceptedTask") or "NONE"
    terminal = state.get("lastTerminalTask") or "NONE"
    print(f"Project: {state.get('projectId')} | Phase: {state.get('phase')}")
    print(f"Active task: {active} | Last accepted: {last} | Last terminal: {terminal}")
    if active in tasks:
        task = tasks[str(active)]
        print(f"Task card: {task.get('_path')} | State: {task.get('state')} | Risk: {task.get('riskClass')}")
        print(f"Required Skills: {', '.join(task_required_skills(task)) or 'NONE'}")
    print(f"Next action: {state.get('nextAction')}")
    gates = state.get("capabilityGates") or {}
    for gate_id, gate in gates.items():
        if isinstance(gate, dict):
            print(f"Gate {gate_id}: {gate.get('state')} — {gate.get('reason')}")


def main() -> int:
    configure_utf8_stdio()
    parser = argparse.ArgumentParser(description="Validate the portable Agent Harness")
    parser.add_argument("--task", help="Task ID whose diff scope must be validated")
    parser.add_argument("--summary", action="store_true", help="Print recoverable project status")
    args = parser.parse_args()
    audit = Audit()
    try:
        lifecycle = load_yaml(ROOT / ".harness/task-lifecycle.yaml")
        state = load_yaml(ROOT / ".harness/project-state.yaml")
        tasks = discover_tasks()
        validate_tasks(audit, tasks, lifecycle)
        active_task = validate_project_state(audit, state, lifecycle, tasks)
        skills, protected_rules = validate_skills(audit, tasks)
        validate_sources(audit, tasks)
        validate_harness_runtime(audit)
        validate_entrypoints(audit)
        validate_commands(audit)
        validate_evidence_and_handoffs(audit, tasks, lifecycle, protected_rules)

        last_terminal_task = str(state.get("lastTerminalTask", ""))
        if args.task and active_task and args.task != active_task:
            audit.error(
                f"explicit task {args.task} cannot replace activeTask {active_task} for diff-scope validation"
            )
        if args.task and not active_task and args.task != last_terminal_task:
            audit.error(
                f"explicit task {args.task} cannot replace lastTerminalTask {last_terminal_task} "
                "when no task is active"
            )
        selected_task_id = active_task or last_terminal_task
        if selected_task_id not in tasks:
            audit.error(f"selected task does not exist: {selected_task_id}")
        else:
            selected_task = tasks[selected_task_id]
            validate_diff_scope(
                audit,
                selected_task,
                skills,
                effective_protected_rules(audit, selected_task, protected_rules),
            )
        if args.summary:
            print_summary(state, tasks)
    except HarnessError as exc:
        audit.error(str(exc))
    except Exception as exc:  # fail closed with a concise diagnostic
        audit.error(f"unexpected Harness error: {type(exc).__name__}: {exc}")

    for warning in audit.warnings:
        print(f"WARN: {warning}", file=sys.stderr)
    if audit.errors:
        for error in audit.errors:
            print(f"ERROR: {error}", file=sys.stderr)
        print(f"Harness doctor: FAIL ({len(audit.errors)} errors, {audit.checks} checks)", file=sys.stderr)
        return 1
    print(f"Harness doctor: PASS ({audit.checks} checks)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

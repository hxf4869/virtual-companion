from __future__ import annotations

import fnmatch
import functools
import hashlib
import re
import subprocess
import sys
from pathlib import Path
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parents[2]
TASK_DIR = ROOT / "docs" / "tasks"
CONTEXT_ALGORITHM = "SHA256_ORDINAL_SORTED_PATH_EQUALS_HASH_LF_V1"
TASK_BLOCK_RE = re.compile(r"```yaml\r?\n(.*?)\r?\n```", re.DOTALL)
SKILL_FRONTMATTER_RE = re.compile(r"\A---\r?\n(.*?)\r?\n---", re.DOTALL)
WINDOWS_DRIVE_RE = re.compile(r"^[A-Za-z]:")


class HarnessError(RuntimeError):
    pass


def configure_utf8_stdio() -> None:
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if callable(reconfigure):
            reconfigure(encoding="utf-8", errors="backslashreplace")


def load_yaml(path: Path) -> dict[str, Any]:
    try:
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
    except (OSError, yaml.YAMLError) as exc:
        raise HarnessError(f"{relative(path)}: cannot load YAML: {exc}") from exc
    if not isinstance(data, dict):
        raise HarnessError(f"{relative(path)}: YAML root must be an object")
    return data


def relative(path: Path) -> str:
    try:
        return path.resolve().relative_to(ROOT.resolve()).as_posix()
    except ValueError:
        return path.as_posix()


def normalize_repo_path(value: str) -> str:
    normalized = value.replace("\\", "/")
    while normalized.startswith("./"):
        normalized = normalized[2:]
    return normalized


def is_repository_relative(value: str) -> bool:
    normalized = value.replace("\\", "/")
    if not normalized or normalized.startswith("/") or WINDOWS_DRIVE_RE.match(normalized):
        return False
    parts = Path(normalized).parts
    if ".." in parts or (parts and parts[0] == ".git"):
        return False
    try:
        (ROOT / normalize_repo_path(normalized)).resolve().relative_to(ROOT.resolve())
    except (OSError, RuntimeError, ValueError):
        return False
    return True


def glob_matches(path: str, pattern: str) -> bool:
    normalized_path = normalize_repo_path(path)
    normalized_pattern = normalize_repo_path(pattern)
    path_parts = tuple(part for part in normalized_path.split("/") if part)
    pattern_parts = tuple(part for part in normalized_pattern.split("/") if part)

    @functools.lru_cache(maxsize=None)
    def match(path_index: int, pattern_index: int) -> bool:
        if pattern_index == len(pattern_parts):
            return path_index == len(path_parts)
        token = pattern_parts[pattern_index]
        if token == "**":
            return match(path_index, pattern_index + 1) or (
                path_index < len(path_parts) and match(path_index + 1, pattern_index)
            )
        return (
            path_index < len(path_parts)
            and fnmatch.fnmatchcase(path_parts[path_index], token)
            and match(path_index + 1, pattern_index + 1)
        )

    return match(0, 0)


def parse_task_card(path: Path) -> dict[str, Any]:
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as exc:
        raise HarnessError(f"{relative(path)}: cannot read task card: {exc}") from exc
    match = TASK_BLOCK_RE.search(text)
    if not match:
        raise HarnessError(f"{relative(path)}: first fenced YAML task metadata block is missing")
    try:
        data = yaml.safe_load(match.group(1))
    except yaml.YAMLError as exc:
        raise HarnessError(f"{relative(path)}: invalid task YAML: {exc}") from exc
    if not isinstance(data, dict):
        raise HarnessError(f"{relative(path)}: task metadata must be an object")
    data["_path"] = relative(path)
    return data


def discover_tasks() -> dict[str, dict[str, Any]]:
    tasks: dict[str, dict[str, Any]] = {}
    for path in sorted(TASK_DIR.glob("*.md")):
        if not re.fullmatch(r"TASK-[0-9]{4,}.*\.md", path.name):
            continue
        task = parse_task_card(path)
        task_id = str(task.get("taskId", ""))
        if not task_id:
            raise HarnessError(f"{relative(path)}: taskId is required")
        if task_id in tasks:
            raise HarnessError(f"duplicate taskId: {task_id}")
        tasks[task_id] = task
    return tasks


def parse_skill_metadata(path: Path) -> dict[str, Any]:
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as exc:
        raise HarnessError(f"{relative(path)}: cannot read Skill: {exc}") from exc
    match = SKILL_FRONTMATTER_RE.search(text)
    if not match:
        raise HarnessError(f"{relative(path)}: Skill YAML frontmatter is missing")
    try:
        data = yaml.safe_load(match.group(1))
    except yaml.YAMLError as exc:
        raise HarnessError(f"{relative(path)}: invalid Skill frontmatter: {exc}") from exc
    if not isinstance(data, dict):
        raise HarnessError(f"{relative(path)}: Skill frontmatter must be an object")
    return data


def git_bytes(*args: str, check: bool = True) -> subprocess.CompletedProcess[bytes]:
    return subprocess.run(
        ["git", *args],
        cwd=ROOT,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=check,
    )


def git_text(*args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", *args],
        cwd=ROOT,
        text=True,
        encoding="utf-8",
        errors="replace",
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=check,
    )


def git_object(commit: str, path: str) -> bytes:
    if not is_repository_relative(path):
        raise HarnessError(f"context repository path is not relative: {path}")
    result = git_bytes("show", f"{commit}:{normalize_repo_path(path)}", check=False)
    if result.returncode != 0:
        detail = result.stderr.decode("utf-8", errors="replace").strip()
        raise HarnessError(f"cannot read {path} at {commit}: {detail}")
    return result.stdout


def verify_context_lock(task: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    lock_value = str(task.get("contextLock", ""))
    if not is_repository_relative(lock_value):
        return [f"{task.get('taskId')}: contextLock must be a repository-relative path"]
    lock_path = ROOT / normalize_repo_path(lock_value)
    try:
        lock = load_yaml(lock_path)
    except HarnessError as exc:
        return [str(exc)]
    for key in ("taskId", "baseCommit", "contextFingerprint", "contextFingerprintAlgorithm"):
        if lock.get(key) != task.get(key):
            errors.append(f"{task.get('taskId')}: task and context lock disagree on {key}")
    if lock.get("contextFingerprintAlgorithm") != CONTEXT_ALGORITHM:
        errors.append(f"{task.get('taskId')}: unsupported context fingerprint algorithm")
    inputs = lock.get("inputs")
    if not isinstance(inputs, list) or not inputs:
        return errors + [f"{task.get('taskId')}: context lock inputs must be a non-empty list"]
    rows: list[tuple[str, str]] = []
    seen: set[str] = set()
    for item in inputs:
        if not isinstance(item, dict):
            errors.append(f"{task.get('taskId')}: context input must be an object")
            continue
        logical_path = str(item.get("path", ""))
        repository_path = str(item.get("repositoryPath", logical_path))
        if logical_path in seen:
            errors.append(f"{task.get('taskId')}: duplicate context path {logical_path}")
            continue
        seen.add(logical_path)
        if item.get("provenanceOnly") is True:
            expected_hash = str(item.get("sha256", ""))
            if not re.fullmatch(r"[0-9a-f]{64}", expected_hash):
                errors.append(f"{task.get('taskId')}: invalid provenance-only hash for {logical_path}")
            rows.append((logical_path, expected_hash))
            continue
        if not is_repository_relative(logical_path) and not item.get("repositoryPath"):
            errors.append(f"{task.get('taskId')}: non-portable context path has no repositoryPath alias: {logical_path}")
            continue
        if not is_repository_relative(repository_path):
            errors.append(f"{task.get('taskId')}: invalid repositoryPath alias: {repository_path}")
            continue
        try:
            content = git_object(
                str(item.get("repositoryCommit", lock.get("baseCommit", ""))),
                repository_path,
            )
        except HarnessError as exc:
            errors.append(str(exc))
            continue
        actual_hash = hashlib.sha256(content).hexdigest()
        expected_hash = str(item.get("sha256", ""))
        if actual_hash != expected_hash:
            errors.append(f"{task.get('taskId')}: context hash mismatch for {logical_path}")
        rows.append((logical_path, actual_hash))
    payload = "\n".join(f"{path}={digest}" for path, digest in sorted(rows, key=lambda row: row[0]))
    actual_fingerprint = hashlib.sha256(payload.encode("utf-8")).hexdigest()
    if actual_fingerprint != lock.get("contextFingerprint"):
        errors.append(
            f"{task.get('taskId')}: context fingerprint mismatch "
            f"(expected {lock.get('contextFingerprint')}, got {actual_fingerprint})"
        )
    return errors


def changed_paths(base_commit: str) -> list[str]:
    ancestor = git_text("merge-base", "--is-ancestor", base_commit, "HEAD", check=False)
    if ancestor.returncode != 0:
        raise HarnessError(f"baseCommit {base_commit} is not an ancestor of HEAD")
    tracked = git_bytes(
        "diff",
        "--name-only",
        "--diff-filter=ACDMRTUXB",
        "-z",
        base_commit,
        "--",
    )
    untracked = git_bytes("ls-files", "--others", "--exclude-standard", "-z")
    values = tracked.stdout.split(b"\0") + untracked.stdout.split(b"\0")
    decoded = {
        normalize_repo_path(value.decode("utf-8", errors="surrogateescape"))
        for value in values
        if value
    }
    return sorted(decoded)


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()

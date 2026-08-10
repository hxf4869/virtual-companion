from __future__ import annotations

from contextlib import contextmanager
import fnmatch
import functools
import hashlib
import os
import re
import signal
import subprocess
import sys
from pathlib import Path
from typing import Any, Callable, Iterator

import yaml

ROOT = Path(__file__).resolve().parents[2]
TASK_DIR = ROOT / "docs" / "tasks"
CONTEXT_ALGORITHM = "SHA256_ORDINAL_SORTED_PATH_EQUALS_HASH_LF_V1"
TASK_BLOCK_RE = re.compile(r"```yaml\r?\n(.*?)\r?\n```", re.DOTALL)
SKILL_FRONTMATTER_RE = re.compile(r"\A---\r?\n(.*?)\r?\n---", re.DOTALL)
WINDOWS_DRIVE_RE = re.compile(r"^[A-Za-z]:")
_REPOSITORY_BYTES_READER: Callable[[Path], bytes] | None = None
_REPOSITORY_GLOBBER: Callable[[Path, str], list[Path]] | None = None


class HarnessError(RuntimeError):
    pass


@contextmanager
def repository_read_snapshot(
    bytes_reader: Callable[[Path], bytes],
    globber: Callable[[Path, str], list[Path]],
) -> Iterator[None]:
    global _REPOSITORY_BYTES_READER, _REPOSITORY_GLOBBER
    if _REPOSITORY_BYTES_READER is not None or _REPOSITORY_GLOBBER is not None:
        raise HarnessError("repository read snapshot: nested scopes are not allowed")
    _REPOSITORY_BYTES_READER = bytes_reader
    _REPOSITORY_GLOBBER = globber
    try:
        yield
    finally:
        _REPOSITORY_BYTES_READER = None
        _REPOSITORY_GLOBBER = None


def read_repository_bytes(path: Path) -> bytes:
    reader = _REPOSITORY_BYTES_READER
    return reader(path) if reader is not None else path.read_bytes()


def read_repository_text(path: Path) -> str:
    return read_repository_bytes(path).decode("utf-8")


def repository_glob(root: Path, pattern: str) -> list[Path]:
    globber = _REPOSITORY_GLOBBER
    return globber(root, pattern) if globber is not None else list(root.glob(pattern))


class UniqueKeyLoader(yaml.SafeLoader):
    pass


def _construct_unique_mapping(
    loader: UniqueKeyLoader,
    node: yaml.nodes.MappingNode,
    deep: bool = False,
) -> dict[Any, Any]:
    loader.flatten_mapping(node)
    mapping: dict[Any, Any] = {}
    for key_node, value_node in node.value:
        key = loader.construct_object(key_node, deep=deep)
        if key in mapping:
            raise yaml.constructor.ConstructorError(
                "while constructing a mapping",
                node.start_mark,
                f"found duplicate key {key!r}",
                key_node.start_mark,
            )
        mapping[key] = loader.construct_object(value_node, deep=deep)
    return mapping


UniqueKeyLoader.add_constructor(
    yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG,
    _construct_unique_mapping,
)


def strict_yaml_load(value: str | bytes) -> Any:
    text = value.decode("utf-8") if isinstance(value, bytes) else value
    return yaml.load(text, Loader=UniqueKeyLoader)


def configure_utf8_stdio() -> None:
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if callable(reconfigure):
            reconfigure(encoding="utf-8", errors="backslashreplace")


def load_yaml(path: Path) -> dict[str, Any]:
    try:
        data = strict_yaml_load(read_repository_bytes(path))
    except (OSError, UnicodeError, yaml.YAMLError) as exc:
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
        text = read_repository_text(path)
    except (OSError, UnicodeError) as exc:
        raise HarnessError(f"{relative(path)}: cannot read task card: {exc}") from exc
    match = TASK_BLOCK_RE.search(text)
    if not match:
        raise HarnessError(f"{relative(path)}: first fenced YAML task metadata block is missing")
    try:
        data = strict_yaml_load(match.group(1))
    except yaml.YAMLError as exc:
        raise HarnessError(f"{relative(path)}: invalid task YAML: {exc}") from exc
    if not isinstance(data, dict):
        raise HarnessError(f"{relative(path)}: task metadata must be an object")
    data["_path"] = relative(path)
    return data


def task_id_from_filename(path: Path) -> str | None:
    match = re.match(r"^(TASK-[0-9]{4,})(?:-|\.md$)", path.name)
    return match.group(1) if match else None


def discover_tasks() -> dict[str, dict[str, Any]]:
    tasks: dict[str, dict[str, Any]] = {}
    for path in sorted(repository_glob(TASK_DIR, "*.md")):
        if not re.fullmatch(r"TASK-[0-9]{4,}.*\.md", path.name):
            continue
        task = parse_task_card(path)
        task_id = str(task.get("taskId", ""))
        if not task_id:
            raise HarnessError(f"{relative(path)}: taskId is required")
        filename_task_id = task_id_from_filename(path)
        if filename_task_id != task_id:
            raise HarnessError(
                f"{relative(path)}: filename task ID {filename_task_id!r} "
                f"disagrees with metadata {task_id!r}"
            )
        if task_id in tasks:
            raise HarnessError(f"duplicate taskId: {task_id}")
        tasks[task_id] = task
    return tasks


def parse_skill_metadata(path: Path) -> dict[str, Any]:
    try:
        text = read_repository_text(path)
    except (OSError, UnicodeError) as exc:
        raise HarnessError(f"{relative(path)}: cannot read Skill: {exc}") from exc
    match = SKILL_FRONTMATTER_RE.search(text)
    if not match:
        raise HarnessError(f"{relative(path)}: Skill YAML frontmatter is missing")
    try:
        data = strict_yaml_load(match.group(1))
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
    legacy_context = task.get("taskId") == "TASK-0001"
    expected_path_mode = (
        "LEGACY_EXTERNAL_PATH_WITH_REPOSITORY_ALIAS"
        if legacy_context
        else "REPOSITORY_RELATIVE_AT_BASE_COMMIT"
    )
    if lock.get("pathMode") != expected_path_mode:
        errors.append(f"{task.get('taskId')}: context lock pathMode must bind repository paths at Base Commit")
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
        base_commit = str(lock.get("baseCommit", ""))
        repository_commit = item.get("repositoryCommit")
        if not legacy_context and repository_commit not in (None, "", base_commit):
            errors.append(
                f"{task.get('taskId')}: context input {logical_path} must use the task Base Commit"
            )
            continue
        try:
            content_commit = (
                str(repository_commit)
                if legacy_context and repository_commit
                else base_commit
            )
            content = git_object(content_commit, repository_path)
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
        "--no-renames",
        "--name-only",
        "--diff-filter=ACDMRTUXB",
        "-z",
        base_commit,
        "--",
    )
    staged = git_bytes(
        "diff",
        "--cached",
        "--no-renames",
        "--name-only",
        "--diff-filter=ACDMRTUXB",
        "-z",
        base_commit,
        "--",
    )
    untracked = git_bytes("ls-files", "--others", "--exclude-standard", "-z")
    values = (
        tracked.stdout.split(b"\0")
        + staged.stdout.split(b"\0")
        + untracked.stdout.split(b"\0")
    )
    decoded = {
        normalize_repo_path(value.decode("utf-8", errors="surrogateescape"))
        for value in values
        if value
    }
    return sorted(decoded)


def sha256_file(path: Path) -> str:
    return hashlib.sha256(read_repository_bytes(path)).hexdigest()


def run_command_with_timeout(
    argv: list[str],
    *,
    cwd: Path,
    timeout_seconds: float,
) -> tuple[int | None, bool]:
    """Run argv with an explicit timeout and full process-tree termination.

    Returns ``(returncode, timed_out)``. On timeout the complete process tree
    is terminated: POSIX creates a new session/process group and sends SIGKILL
    to the group; Windows creates a new process group and runs ``taskkill /F /T``.
    A timed-out run never reports PASS semantics from the caller; the real
    termination exit code is returned alongside ``timed_out=True``.
    """
    creationflags = 0
    start_new_session = False
    if os.name == "nt":
        creationflags = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
    else:
        start_new_session = True
    proc = subprocess.Popen(
        argv,
        cwd=str(cwd),
        start_new_session=start_new_session,
        creationflags=creationflags,
    )
    try:
        proc.communicate(timeout=timeout_seconds)
        return proc.returncode, False
    except subprocess.TimeoutExpired:
        _terminate_process_tree(proc)
        proc.communicate()
        return proc.returncode, True


def _terminate_process_tree(proc: subprocess.Popen[Any]) -> None:
    if os.name == "nt":
        subprocess.run(
            ["taskkill", "/F", "/T", "/PID", str(proc.pid)],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
        return
    try:
        os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
    except ProcessLookupError:
        pass

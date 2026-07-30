#!/usr/bin/env python3
from __future__ import annotations

import argparse
from contextlib import contextmanager
from datetime import date, datetime
import functools
import hashlib
import json
import os
import re
import stat
import subprocess
import sys
import time
import unicodedata
from pathlib import Path
from typing import Any, Iterator
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import yaml

from harness_common import (
    CONTEXT_ALGORITHM,
    ROOT,
    HarnessError,
    changed_paths as git_changed_paths,
    configure_utf8_stdio,
    discover_tasks,
    git_bytes,
    git_object as read_git_object,
    git_text,
    glob_matches,
    is_repository_relative,
    load_yaml,
    normalize_repo_path,
    parse_skill_metadata,
    read_repository_bytes,
    read_repository_text,
    relative,
    repository_glob,
    repository_read_snapshot,
    sha256_file,
    SKILL_FRONTMATTER_RE,
    strict_yaml_load,
    TASK_BLOCK_RE,
    task_id_from_filename,
    verify_context_lock,
)

FULL_COMMIT_RE = re.compile(r"^[0-9a-f]{40}$")
TASK_ID_RE = re.compile(r"^TASK-[0-9]{4,}$")
CANONICAL_ID_RE = re.compile(r"^[a-z0-9][a-z0-9._-]*$")
WINDOWS_RESERVED_COMPONENT_RE = re.compile(
    r"^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$",
    re.IGNORECASE,
)
WINDOWS_INVALID_COMPONENT_RE = re.compile(r'[<>:"|?*\x00-\x1f]')
ZED_PROJECT_INSTRUCTION_PRIORITY = (
    ".rules",
    ".cursorrules",
    ".windsurfrules",
    ".clinerules",
    ".github/copilot-instructions.md",
    "AGENT.md",
    "AGENTS.md",
    "CLAUDE.md",
    "GEMINI.md",
)
COPILOT_SUPPORT_MATRIX = (
    "https://docs.github.com/en/copilot/reference/custom-instructions-support"
)
RISK_RANK = {"C1": 1, "C2": 2, "C3": 3, "C4": 4}
AUTHORIZATION_FIELDS = (
    "taskId",
    "owner",
    "riskClass",
    "requiredSkills",
    "requiredSkillVersions",
    "targetSkillVersions",
    "planningBacklog",
    "planningContractHash",
    "planningContractHashAlgorithm",
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
AUTHORIZATION_MUTABLE_FIELDS = {
    "state",
    "authorizationCommit",
    "reviewers",
    "resolutionReason",
    "scopeAmendments",
}
LEGACY_SCOPE_AMENDMENT_FIELDS = {
    "amendmentId",
    "approvedBy",
    "approvedAt",
    "evidence",
    "reason",
    "addedWriteAllowlist",
    "acceptanceAdditions",
}
SCOPE_AMENDMENT_PROJECTION_FIELDS = {
    "schemaVersion",
    "amendmentId",
    "contractSource",
    "contractHashAlgorithm",
    "contractHash",
    "contract",
}
AUTHORIZATION_AMENDMENT_FIELDS = {
    "schemaVersion",
    "taskId",
    "amendmentType",
    "approvedBy",
    "approvedAt",
    "evidence",
    "reason",
    "authorizedParentCommit",
    "baseAuthorizationProjectionHash",
    "scopeGrantAmendmentId",
    "addedWriteAllowlist",
    "replacements",
}
AUTHORIZATION_REPLACEMENT_FIELDS = {"supersedes", "replacement"}
AUTHORIZATION_SUPERSEDES_FIELDS = {"clauseId", "statement", "statementHash"}
AUTHORIZATION_REPLACEMENT_VALUE_FIELDS = {"statement", "statementHash"}
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
PROJECT_STATE_READY_MUTABLE_FIELDS = {
    "activeTask",
    "activeTaskCard",
    "nextAction",
    "updatedAt",
}
TASK_LEDGER_PATH = ".harness/task-ledger.yaml"
TASK_BACKLOG_PATH = ".harness/task-backlog.yaml"
PROJECT_STATE_PATH = ".harness/project-state.yaml"
TASK_DELIVERY_POLICY_PATH = ".harness/task-delivery-policy.yaml"
TASK_DELIVERY_POLICY_CANONICAL_HASH = (
    "cb9c09b087f0f3a0662a45b17df700a1088417354689eb20b088d8686ebf9d0a"
)
PLANNING_CONTRACT_HASH_ALGORITHM = "SHA256_CANONICAL_JSON_V1"
PLANNED_CARD_FIELDS = {
    "taskId",
    "state",
    "owner",
    "planningBacklog",
    "planningContractHash",
    "planningContractHashAlgorithm",
}
PLANNING_TERMINAL_STATES = {"REJECTED", "SUPERSEDED"}
PLANNING_TERMINAL_CARD_FIELDS = PLANNED_CARD_FIELDS | {"planningResolution"}
BACKLOG_ROOT_FIELDS = {
    "schemaVersion",
    "backlogId",
    "phase",
    "bootstrapTask",
    "planningContractHashAlgorithm",
    "authority",
    "rules",
    "technicalAlphaBoundary",
    "testPolicies",
    "executionOrder",
    "criticalPath",
    "decisionGates",
    "authorizationAmendments",
    "resolutions",
    "tasks",
}
BACKLOG_TASK_FIELDS = {
    "title",
    "taskCard",
    "dependencies",
    "decisionGates",
    "objective",
    "scope",
    "forbidden",
    "acceptanceCriteria",
    "promotionConditions",
}
BACKLOG_PROMOTION_CONDITION_FIELDS = {
    "requiresRepositoryIdle",
    "requiresAcceptedDependencies",
    "requiresApprovedDecisionGates",
    "requiresFirstByExecutionOrder",
}
BACKLOG_GATE_FIELDS = {
    "kind",
    "status",
    "requiredFor",
    "requiredDecisions",
    "approval",
}
BACKLOG_GATE_APPROVAL_FIELDS = {
    "approvedBy",
    "approvedAt",
    "evidence",
    "decisionEvidence",
}
BACKLOG_GATE_DECISION_EVIDENCE_FIELDS = {
    "value",
    "evidence",
}
BACKLOG_RESOLUTION_FIELDS = {
    "state",
    "reason",
    "decidedBy",
    "decidedAt",
    "replacementTask",
}
PLANNED_CARD_NON_NORMATIVE_NOTICE = (
    "> 规划正文仅为非规范的人类可读渲染；唯一机器真源是 "
    "`.harness/task-backlog.yaml` 中本 Task ID 的静态合同，"
    "并由 `planningContractHash` 完整绑定。"
)
TASK_LEDGER_FIELDS = {
    "state",
    "contractVersion",
    "taskCard",
    "evidence",
    "handoff",
}
CANONICAL_PRECHECK_COMMANDS = {
    "doctor": ["scripts/harness/doctor.py"],
    "catalogValidate": ["scripts/harness/catalog_tool.py", "validate"],
    "catalogDrift": ["scripts/harness/catalog_tool.py", "diff", "--fail-on-drift"],
    "paidFeatureCheck": ["scripts/harness/check_paid_features.py"],
    "betaRosterGate": ["scripts/harness/check_beta_gate.py"],
}
PORCELAIN_V2_ORDINARY_RE = re.compile(
    rb"^1 [.MTADRCU]{2} (?:N\.\.\.|S[.C][.M][.U]) "
    rb"(?:000000|100644|100755|120000|160000) "
    rb"(?:000000|100644|100755|120000|160000) "
    rb"(?:000000|100644|100755|120000|160000) "
    rb"(?:[0-9a-f]{40}|[0-9a-f]{64}) "
    rb"(?:[0-9a-f]{40}|[0-9a-f]{64}) (.+)$",
    re.DOTALL,
)
PORCELAIN_V2_RENAME_RE = re.compile(
    rb"^2 [.MTADRCU]{2} (?:N\.\.\.|S[.C][.M][.U]) "
    rb"(?:000000|100644|100755|120000|160000) "
    rb"(?:000000|100644|100755|120000|160000) "
    rb"(?:000000|100644|100755|120000|160000) "
    rb"(?:[0-9a-f]{40}|[0-9a-f]{64}) "
    rb"(?:[0-9a-f]{40}|[0-9a-f]{64}) "
    rb"[RC](?:100|[1-9]?[0-9]) (.+)$",
    re.DOTALL,
)
PORCELAIN_V2_UNMERGED_RE = re.compile(
    rb"^u (?:DD|AU|UD|UA|DU|AA|UU) (?:N\.\.\.|S[.C][.M][.U]) "
    rb"(?:000000|100644|100755|120000|160000) "
    rb"(?:000000|100644|100755|120000|160000) "
    rb"(?:000000|100644|100755|120000|160000) "
    rb"(?:000000|100644|100755|120000|160000) "
    rb"(?:[0-9a-f]{40}|[0-9a-f]{64}) "
    rb"(?:[0-9a-f]{40}|[0-9a-f]{64}) "
    rb"(?:[0-9a-f]{40}|[0-9a-f]{64}) (.+)$",
    re.DOTALL,
)


class DoctorGitSnapshot:
    """Run-scoped immutable Git reads with end-of-run stability checks."""

    def __init__(self) -> None:
        head = git_text("rev-parse", "HEAD", check=False)
        if head.returncode != 0 or not FULL_COMMIT_RE.fullmatch(head.stdout.strip()):
            raise HarnessError("doctor snapshot: cannot resolve a full HEAD commit")
        index = git_bytes("ls-files", "--stage", "-z", check=False)
        if index.returncode != 0:
            detail = index.stderr.decode("utf-8", errors="replace").strip()
            raise HarnessError(f"doctor snapshot: cannot read Git index: {detail}")
        index_flags = git_bytes("ls-files", "-v", "-z", check=False)
        if index_flags.returncode != 0:
            detail = index_flags.stderr.decode("utf-8", errors="replace").strip()
            raise HarnessError(
                f"doctor snapshot: cannot read Git index flags: {detail}"
            )
        self._validate_index_flags(index_flags.stdout)
        fsmonitor_flags = git_bytes("ls-files", "-f", "-z", check=False)
        if fsmonitor_flags.returncode != 0:
            detail = fsmonitor_flags.stderr.decode(
                "utf-8",
                errors="replace",
            ).strip()
            raise HarnessError(
                f"doctor snapshot: cannot read Git fsmonitor flags: {detail}"
            )
        self._validate_fsmonitor_flags(fsmonitor_flags.stdout)
        worktree_bytes, worktree_fingerprint = self._capture_worktree()

        self.head = head.stdout.strip()
        self.index_bytes = index.stdout
        self.index_flags_bytes = index_flags.stdout
        self.fsmonitor_flags_bytes = fsmonitor_flags.stdout
        self.worktree_bytes = worktree_bytes
        self.worktree_fingerprint = worktree_fingerprint
        self._trees: dict[str, dict[str, tuple[str, str, str]]] = {}
        self._blobs: dict[str, bytes] = {}
        self._index_entries = self._parse_index(index.stdout)
        self._candidate_fingerprints = {
            os.fsdecode(entry[0]): entry
            for entry in worktree_fingerprint
        }
        self._current_file_cache: dict[str, tuple[bytes, int, int]] = {}
        self._current_blob_oids: dict[str, str] = {}
        self.ledger_introductions: dict[str, set[str]] | None = None

    @staticmethod
    def _worktree_status() -> bytes:
        result = git_bytes(
            "status",
            "--porcelain=v2",
            "--untracked-files=all",
            "-z",
            check=False,
        )
        if result.returncode != 0:
            detail = result.stderr.decode("utf-8", errors="replace").strip()
            raise HarnessError(
                f"doctor snapshot: cannot read worktree status: {detail}"
            )
        return result.stdout

    @staticmethod
    def _status_candidate_paths(raw: bytes) -> tuple[bytes, ...]:
        if raw and not raw.endswith(b"\0"):
            raise HarnessError(
                "doctor snapshot: unterminated worktree status output"
            )
        records = raw.split(b"\0")[:-1] if raw else []
        candidates: set[bytes] = set()
        index = 0
        while index < len(records):
            record = records[index]
            index += 1
            if not record:
                raise HarnessError(
                    "doctor snapshot: empty worktree status record"
                )
            prefix = record[:1]
            if prefix == b"1":
                match = PORCELAIN_V2_ORDINARY_RE.fullmatch(record)
                if match is None:
                    raise HarnessError(
                        "doctor snapshot: malformed ordinary worktree status record"
                    )
                record_candidates = (match.group(1),)
            elif prefix == b"2":
                match = PORCELAIN_V2_RENAME_RE.fullmatch(record)
                if match is None or index >= len(records) or not records[index]:
                    raise HarnessError(
                        "doctor snapshot: malformed rename worktree status record"
                    )
                record_candidates = (match.group(1), records[index])
                index += 1  # The following NUL record is the original path.
            elif prefix == b"u":
                match = PORCELAIN_V2_UNMERGED_RE.fullmatch(record)
                if match is None:
                    raise HarnessError(
                        "doctor snapshot: malformed unmerged worktree status record"
                    )
                record_candidates = (match.group(1),)
            elif prefix == b"?":
                if not record.startswith(b"? "):
                    raise HarnessError(
                        "doctor snapshot: malformed untracked worktree status record"
                    )
                record_candidates = (record[2:],)
            elif prefix in (b"#", b"!"):
                raise HarnessError(
                    "doctor snapshot: unexpected worktree status record type"
                )
            else:
                raise HarnessError(
                    "doctor snapshot: unknown worktree status record type"
                )
            for candidate in record_candidates:
                decoded_candidate = os.fsdecode(candidate)
                if (
                    not candidate
                    or b"\\" in candidate
                    or candidate.startswith(b"/")
                    or any(
                        component in (b"", b".", b"..")
                        for component in candidate.split(b"/")
                    )
                    or not is_repository_relative(decoded_candidate)
                ):
                    raise HarnessError(
                        "doctor snapshot: unsafe worktree status path"
                    )
                candidates.add(candidate)
        return tuple(sorted(candidates))

    @staticmethod
    def _index_flag_records(raw: bytes) -> list[tuple[bytes, bytes]]:
        if raw and not raw.endswith(b"\0"):
            raise HarnessError("doctor snapshot: unterminated Git index flags")
        records = raw.split(b"\0")[:-1] if raw else []
        parsed: list[tuple[bytes, bytes]] = []
        for record in records:
            if (
                len(record) < 3
                or record[1:2] != b" "
                or not record[2:]
            ):
                raise HarnessError("doctor snapshot: malformed Git index flags")
            tag = record[:1]
            if tag.upper() not in b"HSMRCK?":
                raise HarnessError("doctor snapshot: malformed Git index flags")
            parsed.append((tag, record[2:]))
        return parsed

    @classmethod
    def _validate_index_flags(cls, raw: bytes) -> None:
        for tag, _ in cls._index_flag_records(raw):
            if tag == b"S" or (b"a" <= tag <= b"z"):
                raise HarnessError(
                    "doctor snapshot: hidden Git index flag is not allowed"
                )

    @classmethod
    def _validate_fsmonitor_flags(cls, raw: bytes) -> None:
        for tag, _ in cls._index_flag_records(raw):
            if b"a" <= tag <= b"z":
                raise HarnessError(
                    "doctor snapshot: Git fsmonitor-valid flag is not allowed"
                )

    @staticmethod
    def _race_stat(stat_result: os.stat_result) -> tuple[int, int, int, int, int, int]:
        return (
            stat_result.st_dev,
            stat_result.st_ino,
            stat_result.st_mode,
            stat_result.st_size,
            stat_result.st_mtime_ns,
            stat_result.st_ctime_ns,
        )

    @staticmethod
    def _same_file_identity(
        left: tuple[int, int, int, int, int, int],
        right: tuple[int, int, int, int, int, int],
    ) -> bool:
        return (
            left[0],
            left[1],
            left[3],
            left[4],
        ) == (
            right[0],
            right[1],
            right[3],
            right[4],
        )

    @classmethod
    def _candidate_fingerprint(
        cls,
        raw_path: bytes,
    ) -> tuple[bytes, str, int, int, bytes]:
        fingerprint, _ = cls._read_candidate(raw_path, retain_content=False)
        return fingerprint

    @classmethod
    def _parent_states(
        cls,
        decoded_path: str,
    ) -> tuple[tuple[str, tuple[int, int, int, int, int, int]], ...]:
        states: list[tuple[str, tuple[int, int, int, int, int, int]]] = []
        current = ROOT
        reparse_flag = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)
        for component in decoded_path.split("/")[:-1]:
            current /= component
            try:
                metadata = os.lstat(current)
            except OSError as exc:
                raise HarnessError(
                    f"doctor snapshot: cannot inspect worktree parent {current}: {exc}"
                ) from exc
            attributes = int(getattr(metadata, "st_file_attributes", 0))
            if (
                not stat.S_ISDIR(metadata.st_mode)
                or stat.S_ISLNK(metadata.st_mode)
                or bool(attributes & reparse_flag)
            ):
                raise HarnessError(
                    f"doctor snapshot: worktree parent must be a regular directory: {current}"
                )
            states.append((str(current), cls._race_stat(metadata)))
        return tuple(states)

    @classmethod
    def _read_candidate(
        cls,
        raw_path: bytes,
        *,
        retain_content: bool,
    ) -> tuple[tuple[bytes, str, int, int, bytes], bytes | None]:
        decoded_path = os.fsdecode(raw_path)
        if b"\\" in raw_path or not is_repository_relative(decoded_path):
            raise HarnessError(
                "doctor snapshot: unsafe worktree status path"
            )
        candidate = ROOT.joinpath(*decoded_path.split("/"))
        parents_before = cls._parent_states(decoded_path)
        try:
            before = os.lstat(candidate)
        except FileNotFoundError:
            if cls._parent_states(decoded_path) != parents_before:
                raise HarnessError(
                    f"doctor snapshot: worktree parent changed while reading: {decoded_path!r}"
                )
            return (raw_path, "missing", 0, 0, b""), None
        except OSError as exc:
            raise HarnessError(
                f"doctor snapshot: cannot inspect worktree candidate {decoded_path!r}: {exc}"
            ) from exc

        attributes = int(getattr(before, "st_file_attributes", 0))
        mode = int(before.st_mode)
        reparse_flag = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)
        if (
            not stat.S_ISREG(mode)
            or stat.S_ISLNK(mode)
            or bool(attributes & reparse_flag)
        ):
            raise HarnessError(
                f"doctor snapshot: worktree candidate must be a regular non-reparse file: "
                f"{decoded_path!r}"
            )

        digest = hashlib.sha256()
        content = bytearray() if retain_content else None
        try:
            with candidate.open("rb") as stream:
                opened_before = os.fstat(stream.fileno())
                while chunk := stream.read(1024 * 1024):
                    digest.update(chunk)
                    if content is not None:
                        content.extend(chunk)
                opened_after = os.fstat(stream.fileno())
            after = os.lstat(candidate)
        except OSError as exc:
            raise HarnessError(
                f"doctor snapshot: cannot read worktree candidate {decoded_path!r}: {exc}"
            ) from exc
        expected = cls._race_stat(before)
        if (
            cls._race_stat(after) != expected
            or cls._race_stat(opened_after) != cls._race_stat(opened_before)
            or not cls._same_file_identity(
                cls._race_stat(opened_before),
                expected,
            )
            or cls._parent_states(decoded_path) != parents_before
        ):
            raise HarnessError(
                f"doctor snapshot: worktree candidate changed while reading: {decoded_path!r}"
            )
        return (
            (raw_path, "file", mode, attributes, digest.digest()),
            bytes(content) if content is not None else None,
        )

    @classmethod
    def _capture_worktree(
        cls,
    ) -> tuple[bytes, tuple[tuple[bytes, str, int, int, bytes], ...]]:
        status_before = cls._worktree_status()
        candidates = cls._status_candidate_paths(status_before)
        fingerprint = tuple(
            cls._candidate_fingerprint(path)
            for path in candidates
        )
        status_after = cls._worktree_status()
        if status_after != status_before:
            raise HarnessError(
                "doctor snapshot: worktree changed while capturing validation snapshot"
            )
        return status_before, fingerprint

    @staticmethod
    def _parse_index(raw: bytes) -> dict[str, list[tuple[str, str, str]]]:
        entries: dict[str, list[tuple[str, str, str]]] = {}
        for record in raw.split(b"\0"):
            if not record:
                continue
            if b"\t" not in record:
                raise HarnessError("doctor snapshot: malformed Git index record")
            header, raw_path = record.split(b"\t", 1)
            parts = header.decode("ascii", errors="strict").split()
            if len(parts) != 3:
                raise HarnessError("doctor snapshot: malformed Git index header")
            path = raw_path.decode(
                "utf-8",
                errors="surrogateescape",
            )
            entries.setdefault(path, []).append((parts[0], parts[1], parts[2]))
        return entries

    def resolve_commit(self, commit: str) -> str | None:
        if commit == "HEAD":
            return self.head
        return commit if FULL_COMMIT_RE.fullmatch(commit) else None

    def tree_entries(self, commit: str) -> dict[str, tuple[str, str, str]]:
        resolved = self.resolve_commit(commit)
        if resolved is None:
            raise HarnessError(
                f"doctor snapshot: immutable tree requires a full commit, got {commit!r}"
            )
        if resolved in self._trees:
            return self._trees[resolved]
        result = git_bytes("ls-tree", "-r", "-z", resolved, check=False)
        if result.returncode != 0:
            detail = result.stderr.decode("utf-8", errors="replace").strip()
            raise HarnessError(
                f"doctor snapshot: cannot read tree {resolved}: {detail}"
            )
        entries: dict[str, tuple[str, str, str]] = {}
        for record in result.stdout.split(b"\0"):
            if not record:
                continue
            if b"\t" not in record:
                raise HarnessError(
                    f"doctor snapshot: malformed tree record at {resolved}"
                )
            header, raw_path = record.split(b"\t", 1)
            parts = header.decode("ascii", errors="strict").split()
            if len(parts) != 3:
                raise HarnessError(
                    f"doctor snapshot: malformed tree header at {resolved}"
                )
            path = raw_path.decode("utf-8", errors="surrogateescape")
            if path in entries:
                raise HarnessError(
                    f"doctor snapshot: duplicate tree path at {resolved}: {path}"
                )
            entries[path] = (parts[0], parts[1], parts[2])
        self._trees[resolved] = entries
        return entries

    def index_entry(self, path: str) -> tuple[str, str] | None:
        records = self._index_entries.get(normalize_repo_path(path), [])
        if len(records) != 1 or records[0][2] != "0":
            return None
        return records[0][0], records[0][1]

    @staticmethod
    def _filtered_blob_oid(path: str, content: bytes) -> str:
        result = subprocess.run(
            [
                "git",
                "hash-object",
                f"--path={normalize_repo_path(path)}",
                "--stdin",
            ],
            cwd=ROOT,
            input=content,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )
        value = result.stdout.decode("ascii", errors="replace").strip()
        if result.returncode != 0 or not re.fullmatch(r"[0-9a-f]{40,64}", value):
            detail = result.stderr.decode("utf-8", errors="replace").strip()
            raise HarnessError(
                f"doctor snapshot: cannot hash current file {path}: {detail}"
            )
        return value

    def current_file_paths(self) -> set[str]:
        paths = {
            path
            for path, records in self._index_entries.items()
            if len(records) == 1
            and records[0][2] == "0"
            and records[0][0] in ("100644", "100755")
        }
        for path, fingerprint in self._candidate_fingerprints.items():
            if fingerprint[1] == "missing":
                paths.discard(path)
            elif fingerprint[1] == "file":
                paths.add(path)
        return paths

    @staticmethod
    def _repository_relative_path(path: Path) -> str:
        try:
            value = path.relative_to(ROOT).as_posix()
        except ValueError as exc:
            raise HarnessError(
                f"doctor snapshot: path is outside repository: {path}"
            ) from exc
        if not is_repository_relative(value):
            raise HarnessError(
                f"doctor snapshot: unsafe repository read path: {value!r}"
            )
        return normalize_repo_path(value)

    def read_current_file(self, path: Path) -> tuple[bytes, int, int]:
        normalized = self._repository_relative_path(path)
        cached = self._current_file_cache.get(normalized)
        if cached is not None:
            return cached
        raw_path = os.fsencode(normalized)
        expected = self._candidate_fingerprints.get(normalized)
        current, content = self._read_candidate(
            raw_path,
            retain_content=True,
        )
        if content is None:
            raise FileNotFoundError(normalized)
        if expected is not None:
            if current != expected:
                raise HarnessError(
                    f"doctor snapshot: current file changed before read: {normalized}"
                )
        else:
            index_entry = self.index_entry(normalized)
            if index_entry is None:
                raise FileNotFoundError(normalized)
            mode, oid = index_entry
            if mode not in ("100644", "100755"):
                raise HarnessError(
                    f"doctor snapshot: current path is not a regular Git blob: {normalized}"
                )
            filtered_oid = self._filtered_blob_oid(normalized, content)
            if filtered_oid != oid:
                raise HarnessError(
                    f"doctor snapshot: tracked file changed before read: {normalized}"
                )
            self._current_blob_oids[normalized] = filtered_oid
        result = (content, current[2], current[3])
        self._current_file_cache[normalized] = result
        return result

    def current_blob_oid(self, path: Path) -> str:
        normalized = self._repository_relative_path(path)
        content, _, _ = self.read_current_file(path)
        oid = self._current_blob_oids.get(normalized)
        if oid is None:
            oid = self._filtered_blob_oid(normalized, content)
            self._current_blob_oids[normalized] = oid
        return oid

    def read_current_bytes(self, path: Path) -> bytes:
        return self.read_current_file(path)[0]

    def current_path_is_file(self, path: Path) -> bool:
        normalized = self._repository_relative_path(path)
        return normalized in self.current_file_paths()

    def current_path_exists(self, path: Path) -> bool:
        normalized = self._repository_relative_path(path)
        paths = self.current_file_paths()
        return normalized in paths or any(
            candidate.startswith(f"{normalized.rstrip('/')}/")
            for candidate in paths
        )

    def glob_current(self, root: Path, pattern: str) -> list[Path]:
        prefix = self._repository_relative_path(root).rstrip("/")
        result: list[Path] = []
        for path in self.current_file_paths():
            if not path.startswith(f"{prefix}/"):
                continue
            relative_path = path[len(prefix) + 1:]
            if glob_matches(relative_path, pattern):
                result.append(ROOT / path)
        return sorted(result)

    def changed_paths(self, base_commit: str) -> list[str]:
        ancestor = git_text(
            "merge-base",
            "--is-ancestor",
            base_commit,
            self.head,
            check=False,
        )
        if ancestor.returncode != 0:
            raise HarnessError(
                f"baseCommit {base_commit} is not an ancestor of HEAD"
            )
        baseline = self.tree_entries(base_commit)
        paths = set(baseline) | set(self._index_entries)
        changed: set[str] = set()
        for path in paths:
            baseline_entry = baseline.get(path)
            records = self._index_entries.get(path, [])
            index_entry = (
                (
                    records[0][0],
                    "commit" if records[0][0] == "160000" else "blob",
                    records[0][1],
                )
                if len(records) == 1 and records[0][2] == "0"
                else None
            )
            if baseline_entry != index_entry:
                changed.add(path)
        changed.update(self._candidate_fingerprints)
        return sorted(changed)

    def index_matches_tree(self, commit: str) -> bool:
        tree = self.tree_entries(commit)
        paths = set(tree) | set(self._index_entries)
        for path in paths:
            records = self._index_entries.get(path, [])
            index_entry = None
            if len(records) == 1 and records[0][2] == "0":
                object_type = "commit" if records[0][0] == "160000" else "blob"
                index_entry = (records[0][0], object_type, records[0][1])
            if tree.get(path) != index_entry:
                return False
        return True

    def blob(self, oid: str) -> bytes:
        if oid in self._blobs:
            return self._blobs[oid]
        result = git_bytes("cat-file", "blob", oid, check=False)
        if result.returncode != 0:
            detail = result.stderr.decode("utf-8", errors="replace").strip()
            raise HarnessError(f"doctor snapshot: cannot read blob {oid}: {detail}")
        self._blobs[oid] = result.stdout
        return result.stdout

    def verify_unchanged(self, audit: "Audit") -> None:
        head = git_text("rev-parse", "HEAD", check=False)
        audit.require(
            head.returncode == 0 and head.stdout.strip() == self.head,
            "doctor snapshot: HEAD changed during validation",
        )
        index = git_bytes("ls-files", "--stage", "-z", check=False)
        audit.require(
            index.returncode == 0 and index.stdout == self.index_bytes,
            "doctor snapshot: Git index changed during validation",
        )
        index_flags = git_bytes("ls-files", "-v", "-z", check=False)
        try:
            if index_flags.returncode != 0:
                detail = index_flags.stderr.decode(
                    "utf-8",
                    errors="replace",
                ).strip()
                raise HarnessError(
                    f"doctor snapshot: cannot read Git index flags: {detail}"
                )
            self._validate_index_flags(index_flags.stdout)
        except HarnessError as exc:
            audit.error(str(exc))
        else:
            audit.require(
                index_flags.stdout == self.index_flags_bytes,
                "doctor snapshot: Git index flags changed during validation",
            )
        fsmonitor_flags = git_bytes("ls-files", "-f", "-z", check=False)
        try:
            if fsmonitor_flags.returncode != 0:
                detail = fsmonitor_flags.stderr.decode(
                    "utf-8",
                    errors="replace",
                ).strip()
                raise HarnessError(
                    f"doctor snapshot: cannot read Git fsmonitor flags: {detail}"
                )
            self._validate_fsmonitor_flags(fsmonitor_flags.stdout)
        except HarnessError as exc:
            audit.error(str(exc))
        else:
            audit.require(
                fsmonitor_flags.stdout == self.fsmonitor_flags_bytes,
                "doctor snapshot: Git fsmonitor flags changed during validation",
            )
        try:
            worktree_bytes, worktree_fingerprint = self._capture_worktree()
        except HarnessError as exc:
            audit.error(str(exc))
        else:
            audit.require(
                worktree_bytes == self.worktree_bytes
                and worktree_fingerprint == self.worktree_fingerprint,
                "doctor snapshot: worktree changed during validation",
            )


_ACTIVE_GIT_SNAPSHOT: DoctorGitSnapshot | None = None


@contextmanager
def doctor_git_snapshot() -> Iterator[DoctorGitSnapshot]:
    global _ACTIVE_GIT_SNAPSHOT
    if _ACTIVE_GIT_SNAPSHOT is not None:
        raise HarnessError("doctor snapshot: nested validation scopes are not allowed")
    snapshot = DoctorGitSnapshot()
    _ACTIVE_GIT_SNAPSHOT = snapshot
    try:
        with repository_read_snapshot(
            snapshot.read_current_bytes,
            snapshot.glob_current,
        ):
            yield snapshot
    finally:
        _ACTIVE_GIT_SNAPSHOT = None


def git_object(commit: str, path: str) -> bytes:
    snapshot = _ACTIVE_GIT_SNAPSHOT
    normalized_path = normalize_repo_path(path)
    if snapshot is not None:
        resolved = snapshot.resolve_commit(commit)
        if resolved is not None:
            entry = snapshot.tree_entries(resolved).get(normalized_path)
            if entry is None or entry[1] != "blob":
                raise HarnessError(f"cannot read {path} at {commit}: path is not a blob")
            return snapshot.blob(entry[2])
    return read_git_object(commit, path)


def changed_paths(base_commit: str) -> list[str]:
    snapshot = _ACTIVE_GIT_SNAPSHOT
    return (
        snapshot.changed_paths(base_commit)
        if snapshot is not None
        else git_changed_paths(base_commit)
    )


def current_path_is_file(path: Path) -> bool:
    snapshot = _ACTIVE_GIT_SNAPSHOT
    return (
        snapshot.current_path_is_file(path)
        if snapshot is not None
        else path.is_file()
    )


def current_path_exists(path: Path) -> bool:
    snapshot = _ACTIVE_GIT_SNAPSHOT
    return (
        snapshot.current_path_exists(path)
        if snapshot is not None
        else path.exists()
    )


@contextmanager
def timed_phase(label: str) -> Iterator[None]:
    started = time.perf_counter()
    print(f"Harness doctor: START {label}", file=sys.stderr, flush=True)
    try:
        yield
    except Exception:
        elapsed = time.perf_counter() - started
        print(
            f"Harness doctor: ERROR {label} ({elapsed:.3f}s)",
            file=sys.stderr,
            flush=True,
        )
        raise
    elapsed = time.perf_counter() - started
    print(
        f"Harness doctor: DONE {label} ({elapsed:.3f}s)",
        file=sys.stderr,
        flush=True,
    )


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


def unique_json_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    value: dict[str, Any] = {}
    for key, item in pairs:
        if key in value:
            raise ValueError(f"duplicate JSON key {key!r}")
        value[key] = item
    return value


def load_json(path: Path, audit: Audit) -> dict[str, Any] | None:
    try:
        data = json.loads(
            read_repository_text(path),
            object_pairs_hook=unique_json_object,
        )
    except (OSError, UnicodeError, json.JSONDecodeError, ValueError) as exc:
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
    metadata = strict_yaml_load(match.group(1))
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


def project_state_ready_projection(state: dict[str, Any]) -> dict[str, Any]:
    return {
        key: value
        for key, value in state.items()
        if key not in PROJECT_STATE_READY_MUTABLE_FIELDS
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
        metadata = strict_yaml_load(match.group(1))
        if not isinstance(metadata, dict):
            raise HarnessError(f"{path}: task YAML invalid at {commit}")
        state = str(metadata.get("state", ""))
        if state != sequence[-1]:
            sequence.append(state)
    current_state = str(task.get("state", ""))
    if current_state != sequence[-1]:
        sequence.append(current_state)
    return sequence


def task_metadata_at_commit(commit: str, path: str) -> dict[str, Any]:
    raw = git_object(commit, path).decode("utf-8")
    match = TASK_BLOCK_RE.search(raw)
    if not match:
        raise HarnessError(f"{path}: task YAML missing at {commit}")
    metadata = strict_yaml_load(match.group(1))
    if not isinstance(metadata, dict):
        raise HarnessError(f"{path}: task YAML invalid at {commit}")
    return metadata


def validate_task_state_graph(
    audit: Audit,
    task: dict[str, Any],
    lifecycle: dict[str, Any],
    authorization_commit: str,
) -> None:
    task_id = str(task.get("taskId", ""))
    path = str(task.get("_path", ""))
    transitions = lifecycle.get("transitions")
    transitions = transitions if isinstance(transitions, dict) else {}
    graph = git_text(
        "rev-list",
        "--parents",
        "--topo-order",
        "--reverse",
        f"{authorization_commit}..HEAD",
    ).stdout.splitlines()
    for graph_line in graph:
        tokens = graph_line.split()
        if not tokens:
            continue
        commit = tokens[0]
        child_state = str(task_metadata_at_commit(commit, path).get("state", ""))
        for parent in tokens[1:]:
            parent_in_scope = (
                parent == authorization_commit
                or git_text(
                    "merge-base",
                    "--is-ancestor",
                    authorization_commit,
                    parent,
                    check=False,
                ).returncode
                == 0
            )
            if not parent_in_scope:
                continue
            parent_state = str(task_metadata_at_commit(parent, path).get("state", ""))
            if child_state != parent_state:
                allowed = transitions.get(parent_state, [])
                audit.require(
                    isinstance(allowed, list) and child_state in allowed,
                    f"{task_id}: invalid task state edge {parent_state} -> "
                    f"{child_state} at {parent}..{commit}",
                )
    head_state = str(task_metadata_at_commit("HEAD", path).get("state", ""))
    current_state = str(task.get("state", ""))
    if current_state != head_state:
        allowed = transitions.get(head_state, [])
        audit.require(
            isinstance(allowed, list) and current_state in allowed,
            f"{task_id}: invalid worktree task state edge {head_state} -> {current_state}",
        )


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
        metadata = strict_yaml_load(match.group(1))
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
        "--no-renames",
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


def changed_paths_across_history(base_commit: str, target_commit: str) -> list[str]:
    ancestor = git_text(
        "merge-base",
        "--is-ancestor",
        base_commit,
        target_commit,
        check=False,
    )
    if ancestor.returncode != 0:
        raise HarnessError("Base Commit must be an ancestor of the target commit")
    graph = git_text(
        "rev-list",
        "--parents",
        "--topo-order",
        "--reverse",
        f"{base_commit}..{target_commit}",
    ).stdout.splitlines()
    changed: set[str] = set()
    for graph_line in graph:
        tokens = graph_line.split()
        if not tokens:
            continue
        commit = tokens[0]
        commit_descends_from_base = git_text(
            "merge-base",
            "--is-ancestor",
            base_commit,
            commit,
            check=False,
        )
        if commit_descends_from_base.returncode != 0:
            raise HarnessError(
                f"task history is not ancestry-closed after Base Commit: {commit}"
            )
        for parent in tokens[1:]:
            changed.update(changed_paths_between(parent, commit))
    return sorted(changed)


def yaml_at_commit(commit: str, path: str) -> dict[str, Any]:
    try:
        data = strict_yaml_load(git_object(commit, path))
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


def first_task_state_commit_from_base(
    task: dict[str, Any],
    states: set[str],
) -> tuple[str, dict[str, Any]] | None:
    path = str(task.get("_path", ""))
    base_commit = str(task.get("baseCommit", ""))
    history = git_text(
        "log",
        "--format=%H",
        "--reverse",
        f"{base_commit}..HEAD",
        "--",
        path,
    ).stdout.splitlines()
    for commit in history:
        raw = git_object(commit.strip(), path).decode("utf-8")
        match = TASK_BLOCK_RE.search(raw)
        if not match:
            raise HarnessError(f"{path}: task YAML missing at {commit}")
        metadata = strict_yaml_load(match.group(1))
        if not isinstance(metadata, dict):
            raise HarnessError(f"{path}: task YAML invalid at {commit}")
        if str(metadata.get("state", "")) in states:
            return commit.strip(), metadata
    return None


def validate_history_path_allowlist(
    audit: Audit,
    base_commit: str,
    target_commit: str,
    allowed_paths: set[str],
    label: str,
) -> None:
    ancestor = git_text(
        "merge-base",
        "--is-ancestor",
        base_commit,
        target_commit,
        check=False,
    )
    audit.require(
        ancestor.returncode == 0,
        f"{label}: Base Commit must be an ancestor of the target commit",
    )
    if ancestor.returncode != 0:
        return
    graph = git_text(
        "rev-list",
        "--parents",
        "--topo-order",
        "--reverse",
        f"{base_commit}..{target_commit}",
    ).stdout.splitlines()
    for graph_line in graph:
        tokens = graph_line.split()
        if not tokens:
            continue
        commit = tokens[0]
        commit_descends_from_base = git_text(
            "merge-base",
            "--is-ancestor",
            base_commit,
            commit,
            check=False,
        )
        audit.require(
            commit_descends_from_base.returncode == 0,
            f"{label}: history is not ancestry-closed after Base Commit: {commit}",
        )
        for parent in tokens[1:]:
            changed = set(changed_paths_between(parent, commit))
            audit.require(
                changed <= allowed_paths,
                f"{label}: commit edge {parent}..{commit} contains unauthorized paths: "
                f"{sorted(changed - allowed_paths)}",
            )


def validate_ready_parent_projection(
    audit: Audit,
    task_id: str,
    parent_state: dict[str, Any],
    parent_task: dict[str, Any] | None,
) -> None:
    audit.require(
        parent_state.get("activeTask") in (None, "")
        and parent_state.get("activeTaskCard") in (None, ""),
        f"{task_id}: READY parent project-state must be idle",
    )
    if parent_task is not None:
        audit.require(
            parent_task.get("state") == "DRAFT"
            and parent_task.get("authorizationCommit") in (None, ""),
            f"{task_id}: READY parent task must be an unbound DRAFT",
        )


def validate_ready_project_state_checkpoint(
    audit: Audit,
    task: dict[str, Any],
    authorization_commit: str,
    checkpoint_paths: set[str],
    tasks: dict[str, dict[str, Any]],
    lifecycle: dict[str, Any],
) -> None:
    task_id = str(task.get("taskId", ""))
    task_path = str(task.get("_path", ""))
    base_commit = str(task.get("baseCommit", ""))
    baseline_exists = git_text(
        "cat-file",
        "-e",
        f"{base_commit}:{PROJECT_STATE_PATH}",
        check=False,
    )
    if baseline_exists.returncode != 0:
        audit.require(
            task_id == "TASK-0002",
            f"{task_id}: Base Commit is missing .harness/project-state.yaml",
        )
        bootstrap_anchor = first_task_state_commit_from_base(
            task,
            {"IN_PROGRESS", "BLOCKED", "IN_REVIEW", "ACCEPTED", "REJECTED"},
        )
        audit.require(
            bootstrap_anchor is not None
            and bootstrap_anchor[1].get("authorizationCommit") == authorization_commit,
            f"{task_id}: bootstrap authorizationCommit is not anchored by the first implementation state",
        )
        return

    first_ready = first_task_state_commit_from_base(task, {"READY"})
    audit.require(
        first_ready is not None and first_ready[0] == authorization_commit,
        f"{task_id}: authorizationCommit must be the first READY commit after Base Commit",
    )
    parent_result = git_text(
        "rev-list",
        "--parents",
        "-n",
        "1",
        authorization_commit,
        check=False,
    )
    parent_tokens = parent_result.stdout.split()
    audit.require(
        parent_result.returncode == 0 and len(parent_tokens) == 2,
        f"{task_id}: READY authorization commit must have exactly one parent",
    )
    if parent_result.returncode != 0 or len(parent_tokens) != 2:
        return
    parent_commit = parent_tokens[1]
    draft_paths = {task_path, str(task.get("contextLock", ""))}
    validate_history_path_allowlist(
        audit,
        base_commit,
        parent_commit,
        draft_paths,
        f"{task_id}: pre-READY history",
    )
    parent_state = yaml_at_commit(parent_commit, PROJECT_STATE_PATH)
    parent_task_exists = git_text(
        "cat-file",
        "-e",
        f"{parent_commit}:{task_path}",
        check=False,
    ).returncode == 0
    parent_task: dict[str, Any] | None = None
    if parent_task_exists:
        parent_task_text = git_object(parent_commit, task_path).decode("utf-8")
        parent_match = TASK_BLOCK_RE.search(parent_task_text)
        parent_task = strict_yaml_load(parent_match.group(1)) if parent_match else {}
        if not isinstance(parent_task, dict):
            parent_task = {}
    validate_ready_parent_projection(audit, task_id, parent_state, parent_task)
    if task.get("planningBacklog") == TASK_BACKLOG_PATH:
        validate_backlog_draft_promotion_at_base(
            audit,
            task,
            tasks,
            lifecycle,
        )
    direct_paths = set(changed_paths_between(parent_commit, authorization_commit))
    allowed_direct_paths = {
        task_path,
        str(task.get("contextLock", "")),
        PROJECT_STATE_PATH,
    }
    audit.require(
        {task_path, PROJECT_STATE_PATH} <= direct_paths,
        f"{task_id}: READY transition must atomically change task card and project-state",
    )
    audit.require(
        direct_paths <= allowed_direct_paths,
        f"{task_id}: READY transition commit contains unrelated paths: "
        f"{sorted(direct_paths - allowed_direct_paths)}",
    )

    state_path = PROJECT_STATE_PATH
    audit.require(
        state_path in checkpoint_paths,
        f"{task_id}: READY authorization commit must atomically update {state_path}",
    )
    base_state = yaml_at_commit(base_commit, state_path)
    ready_state = yaml_at_commit(authorization_commit, state_path)
    audit.require(
        base_state.get("activeTask") in (None, "")
        and base_state.get("activeTaskCard") in (None, ""),
        f"{task_id}: Base Commit already has an active task",
    )
    audit.require(
        ready_state.get("activeTask") == task_id,
        f"{task_id}: READY checkpoint project-state.activeTask must point to the task",
    )
    audit.require(
        ready_state.get("activeTaskCard") == task_path,
        f"{task_id}: READY checkpoint project-state.activeTaskCard must point to the task card",
    )
    validate_nonblank_text(
        audit,
        f"{task_id}: READY checkpoint project-state.nextAction",
        ready_state.get("nextAction"),
    )
    audit.require(
        project_state_ready_projection(base_state)
        == project_state_ready_projection(ready_state),
        f"{task_id}: READY checkpoint changed non-lifecycle project-state fields",
    )


def is_valid_approval_timestamp(value: Any) -> bool:
    if isinstance(value, datetime):
        return True
    if isinstance(value, date):
        return True
    if not isinstance(value, str) or not value.strip():
        return False
    candidate = value.strip()
    try:
        if "T" in candidate or " " in candidate:
            datetime.fromisoformat(candidate.replace("Z", "+00:00"))
        else:
            date.fromisoformat(candidate)
    except ValueError:
        return False
    return True


def is_canonical_identity(value: Any) -> bool:
    return isinstance(value, str) and bool(CANONICAL_ID_RE.fullmatch(value))


def task_metadata_from_text(text: str, label: str) -> dict[str, Any]:
    match = TASK_BLOCK_RE.search(text.replace("\r\n", "\n"))
    if not match:
        raise HarnessError(f"{label}: task YAML block is missing")
    metadata = strict_yaml_load(match.group(1))
    if not isinstance(metadata, dict):
        raise HarnessError(f"{label}: task YAML metadata must be an object")
    return metadata


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def canonical_exact_repo_path(value: Any) -> str | None:
    if not isinstance(value, str) or not value:
        return None
    if value != unicodedata.normalize("NFC", value):
        return None
    if value != normalize_repo_path(value) or "\\" in value:
        return None
    if value.startswith("/") or value.endswith("/") or "//" in value:
        return None
    components = value.split("/")
    if any(
        not component
        or component in {".", ".."}
        or component.endswith((" ", "."))
        or WINDOWS_INVALID_COMPONENT_RE.search(component) is not None
        or WINDOWS_RESERVED_COMPONENT_RE.fullmatch(component) is not None
        for component in components
    ):
        return None
    if not is_repository_relative(value):
        return None
    return value


def task_acceptance_clauses(text: str, task_id: str) -> dict[str, str]:
    normalized = text.replace("\r\n", "\n")
    section = re.search(
        r"(?ms)^## 验收标准[ \t]*\n(?P<body>.*?)(?=^## |\Z)",
        normalized,
    )
    if not section:
        raise HarnessError(f"{task_id}: task acceptance section is missing")
    clauses: dict[str, str] = {}
    for match in re.finditer(
        r"(?ms)^(?P<number>[1-9][0-9]*)\.\s+(?P<text>.*?)(?=^[1-9][0-9]*\.\s+|\Z)",
        section.group("body"),
    ):
        number = int(match.group("number"))
        statement = re.sub(r"\s+", " ", match.group("text")).strip()
        clause_id = f"{task_id}-ACCEPTANCE-{number:03d}"
        if clause_id in clauses:
            raise HarnessError(f"{task_id}: duplicate acceptance clause {clause_id}")
        clauses[clause_id] = statement
    if not clauses:
        raise HarnessError(f"{task_id}: numbered acceptance clauses are missing")
    return clauses


def validate_exact_amendment_paths(
    audit: Audit,
    label: str,
    raw_paths: Any,
    *,
    allow_empty: bool,
    forbidden: list[str],
    seen_keys: dict[str, str],
) -> list[str]:
    audit.require(
        isinstance(raw_paths, list) and (allow_empty or bool(raw_paths)),
        f"{label} must be {'a list' if allow_empty else 'a non-empty list'}",
    )
    paths: list[str] = []
    for index, raw_path in enumerate(raw_paths if isinstance(raw_paths, list) else []):
        path_label = f"{label}[{index}]"
        path = canonical_exact_repo_path(raw_path)
        audit.require(
            path is not None,
            f"{path_label} must be one canonical repository-relative POSIX path",
        )
        if path is None:
            continue
        portable_key = unicodedata.normalize("NFC", path).casefold()
        previous = seen_keys.setdefault(portable_key, path)
        audit.require(
            previous == path,
            f"{path_label} aliases the already authorized path {previous!r}",
        )
        audit.require(
            not any(glob_matches(path, pattern) for pattern in forbidden),
            f"{path_label} conflicts with forbiddenPaths",
        )
        paths.append(path)
    return paths


def validate_authorization_amendment_contract(
    audit: Audit,
    label: str,
    amendment_id: str,
    contract: Any,
    task: dict[str, Any],
    *,
    authorized_text: str | None,
    seen_path_keys: dict[str, str],
) -> list[str]:
    audit.require(isinstance(contract, dict), f"{label}.contract must be an object")
    if not isinstance(contract, dict):
        return []
    audit.require(
        set(contract) == AUTHORIZATION_AMENDMENT_FIELDS,
        f"{label}.contract fields must be exactly "
        f"{sorted(AUTHORIZATION_AMENDMENT_FIELDS)}",
    )
    audit.require(
        contract.get("schemaVersion") == 1,
        f"{label}.contract.schemaVersion must be 1",
    )
    audit.require(
        contract.get("taskId") == task.get("taskId"),
        f"{label}.contract.taskId must match the task",
    )
    audit.require(
        contract.get("amendmentType") == "OWNER_CLAUSE_REPLACEMENT",
        f"{label}.contract.amendmentType must be OWNER_CLAUSE_REPLACEMENT",
    )
    audit.require(
        contract.get("approvedBy") == "repository-owner"
        and contract.get("approvedBy") == task.get("owner"),
        f"{label}.contract.approvedBy must be the repository-owner task owner",
    )
    audit.require(
        is_valid_approval_timestamp(contract.get("approvedAt")),
        f"{label}.contract.approvedAt must be an ISO-8601 date or timestamp",
    )
    validate_nonblank_text(audit, f"{label}.contract.evidence", contract.get("evidence"))
    validate_nonblank_text(audit, f"{label}.contract.reason", contract.get("reason"))
    audit.require(
        bool(FULL_COMMIT_RE.fullmatch(str(contract.get("authorizedParentCommit", "")))),
        f"{label}.contract.authorizedParentCommit must be a full Git SHA",
    )
    audit.require(
        bool(
            re.fullmatch(
                r"[0-9a-f]{64}",
                str(contract.get("baseAuthorizationProjectionHash", "")),
            )
        ),
        f"{label}.contract.baseAuthorizationProjectionHash must be SHA-256",
    )
    scope_grant_id = contract.get("scopeGrantAmendmentId")
    audit.require(
        scope_grant_id is None or is_canonical_identity(scope_grant_id),
        f"{label}.contract.scopeGrantAmendmentId must be null or canonical",
    )
    forbidden = [
        str(item)
        for item in task.get("forbiddenPaths", [])
        if isinstance(item, str)
    ]
    added_paths = validate_exact_amendment_paths(
        audit,
        f"{label}.contract.addedWriteAllowlist",
        contract.get("addedWriteAllowlist"),
        allow_empty=True,
        forbidden=forbidden,
        seen_keys=seen_path_keys,
    )
    replacements = contract.get("replacements")
    audit.require(
        isinstance(replacements, list) and bool(replacements),
        f"{label}.contract.replacements must be a non-empty list",
    )
    authorized_clauses: dict[str, str] = {}
    if authorized_text is not None:
        try:
            authorized_clauses = task_acceptance_clauses(
                authorized_text,
                str(task.get("taskId", "")),
            )
            expected_projection_hash = sha256_text(
                task_authorization_projection(authorized_text)
            )
            audit.require(
                contract.get("baseAuthorizationProjectionHash")
                == expected_projection_hash,
                f"{label}.contract must bind the complete base authorization projection",
            )
        except HarnessError as exc:
            audit.error(f"{label}.contract cannot bind authorization clauses: {exc}")
    clause_ids: set[str] = set()
    for index, replacement_record in enumerate(
        replacements if isinstance(replacements, list) else []
    ):
        replacement_label = f"{label}.contract.replacements[{index}]"
        audit.require(
            isinstance(replacement_record, dict)
            and set(replacement_record) == AUTHORIZATION_REPLACEMENT_FIELDS,
            f"{replacement_label} fields must be exactly "
            f"{sorted(AUTHORIZATION_REPLACEMENT_FIELDS)}",
        )
        if not isinstance(replacement_record, dict):
            continue
        supersedes = replacement_record.get("supersedes")
        replacement = replacement_record.get("replacement")
        audit.require(
            isinstance(supersedes, dict)
            and set(supersedes) == AUTHORIZATION_SUPERSEDES_FIELDS,
            f"{replacement_label}.supersedes fields must be exactly "
            f"{sorted(AUTHORIZATION_SUPERSEDES_FIELDS)}",
        )
        audit.require(
            isinstance(replacement, dict)
            and set(replacement) == AUTHORIZATION_REPLACEMENT_VALUE_FIELDS,
            f"{replacement_label}.replacement fields must be exactly "
            f"{sorted(AUTHORIZATION_REPLACEMENT_VALUE_FIELDS)}",
        )
        if not isinstance(supersedes, dict) or not isinstance(replacement, dict):
            continue
        clause_id = str(supersedes.get("clauseId", ""))
        superseded_statement = str(supersedes.get("statement", ""))
        replacement_statement = str(replacement.get("statement", ""))
        audit.require(
            bool(re.fullmatch(r"TASK-[0-9]{4,}-ACCEPTANCE-[0-9]{3}", clause_id)),
            f"{replacement_label}.supersedes.clauseId is invalid",
        )
        audit.require(
            clause_id not in clause_ids,
            f"{replacement_label}.supersedes.clauseId must be unique",
        )
        clause_ids.add(clause_id)
        validate_nonblank_text(
            audit,
            f"{replacement_label}.supersedes.statement",
            supersedes.get("statement"),
        )
        validate_nonblank_text(
            audit,
            f"{replacement_label}.replacement.statement",
            replacement.get("statement"),
        )
        audit.require(
            supersedes.get("statementHash") == sha256_text(superseded_statement),
            f"{replacement_label}.supersedes.statementHash is invalid",
        )
        audit.require(
            replacement.get("statementHash") == sha256_text(replacement_statement),
            f"{replacement_label}.replacement.statementHash is invalid",
        )
        if authorized_clauses:
            audit.require(
                authorized_clauses.get(clause_id) == superseded_statement,
                f"{replacement_label}.supersedes must match the authorized clause exactly",
            )
    return added_paths


def validate_scope_amendments(
    audit: Audit,
    label: str,
    task: dict[str, Any],
    *,
    backlog_amendments: dict[str, Any] | None = None,
    authorized_text: str | None = None,
) -> list[str]:
    raw = task.get("scopeAmendments", [])
    audit.require(isinstance(raw, list), f"{label}: scopeAmendments must be a list")
    amendments = raw if isinstance(raw, list) else []
    amendment_ids: set[str] = set()
    added_paths: list[str] = []
    seen_path_keys: dict[str, str] = {}
    forbidden = [
        str(item)
        for item in task.get("forbiddenPaths", [])
        if isinstance(item, str)
    ]
    for index, amendment in enumerate(amendments):
        item_label = f"{label}: scopeAmendments[{index}]"
        audit.require(isinstance(amendment, dict), f"{item_label} must be an object")
        if not isinstance(amendment, dict):
            continue
        amendment_id = str(amendment.get("amendmentId", ""))
        audit.require(
            is_canonical_identity(amendment_id),
            f"{item_label}.amendmentId must be canonical",
        )
        audit.require(
            amendment_id not in amendment_ids,
            f"{item_label}.amendmentId must be unique",
        )
        amendment_ids.add(amendment_id)
        fields = set(amendment)
        if fields == LEGACY_SCOPE_AMENDMENT_FIELDS:
            audit.require(
                False,
                f"{item_label}: retired legacy scope amendment is an immutable "
                "audit record only and cannot grant write authority",
            )
            continue
        audit.require(
            fields == SCOPE_AMENDMENT_PROJECTION_FIELDS,
            f"{item_label} fields must be either the committed legacy path-grant "
            f"shape or exactly {sorted(SCOPE_AMENDMENT_PROJECTION_FIELDS)}",
        )
        if fields != SCOPE_AMENDMENT_PROJECTION_FIELDS:
            continue
        audit.require(
            amendment.get("schemaVersion") == 2,
            f"{item_label}.schemaVersion must be 2",
        )
        audit.require(
            amendment.get("contractSource") == TASK_BACKLOG_PATH,
            f"{item_label}.contractSource must be {TASK_BACKLOG_PATH}",
        )
        audit.require(
            amendment.get("contractHashAlgorithm")
            == PLANNING_CONTRACT_HASH_ALGORITHM,
            f"{item_label}.contractHashAlgorithm is unsupported",
        )
        contract = amendment.get("contract")
        audit.require(
            isinstance(contract, dict)
            and amendment.get("contractHash") == canonical_json_sha256(contract),
            f"{item_label}.contractHash must bind the complete amendment contract",
        )
        if backlog_amendments is not None:
            audit.require(
                backlog_amendments.get(amendment_id) == contract,
                f"{item_label}.contract must exactly project the Backlog amendment",
            )
        added_paths.extend(
            validate_authorization_amendment_contract(
                audit,
                item_label,
                amendment_id,
                contract,
                task,
                authorized_text=authorized_text,
                seen_path_keys=seen_path_keys,
            )
        )
    return added_paths


def validate_scope_amendment_edge(
    audit: Audit,
    parent: list[Any],
    child: list[Any],
    edge_label: str,
) -> None:
    audit.require(
        len(child) >= len(parent) and child[: len(parent)] == parent,
        f"{edge_label}: scopeAmendments must be append-only and immutable",
    )


def validate_uncommitted_scope_amendments(
    audit: Audit,
    committed: Any,
    current: Any,
    edge_label: str,
) -> None:
    audit.require(
        isinstance(committed, list)
        and isinstance(current, list)
        and current == committed,
        f"{edge_label} cannot introduce or rewrite scopeAmendments; an amendment "
        "must already exist in a single-parent Git commit",
    )


def effective_task_write_allowlist(task: dict[str, Any]) -> list[str]:
    allowlist, exact_paths = effective_task_write_scope(task)
    return [*allowlist, *sorted(exact_paths)]


def effective_task_write_scope(
    task: dict[str, Any],
) -> tuple[list[str], set[str]]:
    allowlist = [str(item) for item in task.get("writeAllowlist", [])]
    exact_paths: set[str] = set()
    amendments = task.get("scopeAmendments")
    if not isinstance(amendments, list):
        return allowlist, exact_paths
    for amendment in amendments:
        if not isinstance(amendment, dict):
            continue
        if set(amendment) == SCOPE_AMENDMENT_PROJECTION_FIELDS:
            contract = amendment.get("contract")
            paths = (
                contract.get("addedWriteAllowlist")
                if isinstance(contract, dict)
                else []
            )
        else:
            paths = []
        if isinstance(paths, list):
            exact_paths.update(
                path
                for raw_path in paths
                if (path := canonical_exact_repo_path(raw_path)) is not None
            )
    return allowlist, exact_paths


def is_legacy_harness_bootstrap(task: dict[str, Any]) -> bool:
    if task.get("taskId") != "TASK-0002":
        return False
    base_commit = str(task.get("baseCommit", ""))
    result = git_text(
        "cat-file",
        "-e",
        f"{base_commit}:{PROJECT_STATE_PATH}",
        check=False,
    )
    return result.returncode != 0


def validate_ready_context_lock_bytes(
    audit: Audit,
    task_path: str,
    current: bytes,
    authorized: bytes,
) -> None:
    audit.require(
        current == authorized,
        f"{task_path}: Context Lock changed after READY checkpoint",
    )


def amendment_added_write_paths(amendment: Any) -> list[str]:
    if not isinstance(amendment, dict):
        return []
    if set(amendment) == SCOPE_AMENDMENT_PROJECTION_FIELDS:
        contract = amendment.get("contract")
        raw_paths = (
            contract.get("addedWriteAllowlist")
            if isinstance(contract, dict)
            else []
        )
    else:
        raw_paths = []
    candidates = raw_paths if isinstance(raw_paths, list) else []
    return [
        path
        for raw_path in candidates
        if (path := canonical_exact_repo_path(raw_path)) is not None
    ]


def backlog_authorization_amendments_at(commit: str) -> dict[str, Any]:
    if git_tree_entry(commit, TASK_BACKLOG_PATH) is None:
        return {}
    backlog = yaml_at_commit(commit, TASK_BACKLOG_PATH)
    amendments = backlog.get("authorizationAmendments")
    return amendments if isinstance(amendments, dict) else {}


def validate_amendment_introduction(
    audit: Audit,
    task_id: str,
    task_path: str,
    base_commit: str,
    parent: str,
    commit: str,
    parents: list[str],
    amendment: Any,
) -> None:
    label = f"{task_id}: scope amendment at {commit}"
    audit.require(
        len(parents) == 1,
        f"{label} must be introduced by a single-parent atomic governance commit",
    )
    prior_changes = set(changed_paths_across_history(base_commit, parent))
    for path in amendment_added_write_paths(amendment):
        audit.require(
            path not in prior_changes,
            f"{label} cannot retroactively authorize earlier change to {path}",
        )
        entry = git_tree_entry(commit, path)
        if entry is not None:
            audit.require(
                entry[:2] == ("100644", "blob"),
                f"{label} added path {path} must be a regular 100644 blob",
            )
        components = path.split("/")
        for index in range(1, len(components)):
            prefix = "/".join(components[:index])
            prefix_entry = git_tree_entry(commit, prefix)
            audit.require(
                prefix_entry is None or prefix_entry[0] != "120000",
                f"{label} added path {path} traverses symlink component {prefix}",
            )
    if not isinstance(amendment, dict):
        return
    if set(amendment) == LEGACY_SCOPE_AMENDMENT_FIELDS:
        audit.require(
            False,
            f"{label} uses the retired non-authoritative legacy amendment shape",
        )
        return
    if set(amendment) != SCOPE_AMENDMENT_PROJECTION_FIELDS:
        return
    contract = amendment.get("contract")
    amendment_id = str(amendment.get("amendmentId", ""))
    audit.require(
        isinstance(contract, dict)
        and contract.get("authorizedParentCommit") == parent,
        f"{label} must bind its exact parent commit",
    )
    parent_backlog_amendments = backlog_authorization_amendments_at(parent)
    child_backlog_amendments = backlog_authorization_amendments_at(commit)
    audit.require(
        amendment_id not in parent_backlog_amendments
        and child_backlog_amendments.get(amendment_id) == contract,
        f"{label} must atomically introduce the identical Backlog contract",
    )
    changed = set(changed_paths_between(parent, commit))
    expected_changed = {
        task_path,
        TASK_BACKLOG_PATH,
        *amendment_added_write_paths(amendment),
    }
    audit.require(
        changed == expected_changed,
        f"{label} atomic governance commit must change exactly the task card, "
        "Backlog and its explicitly authorized new paths; "
        f"changed={sorted(changed)}",
    )


def validate_task_authorization_history(
    audit: Audit,
    task_id: str,
    task_path: str,
    base_commit: str,
    authorization_commit: str,
    authorized_text: str,
    enforce_dominance: bool = True,
) -> None:
    expected_projection = task_authorization_projection(authorized_text)
    authorized_metadata = task_metadata_from_text(
        authorized_text,
        f"{task_id}: authorization checkpoint",
    )
    graph = git_text(
        "rev-list",
        "--parents",
        "--topo-order",
        "--reverse",
        f"{authorization_commit}..HEAD",
    ).stdout.splitlines()
    for graph_line in graph:
        tokens = graph_line.split()
        if not tokens:
            continue
        commit = tokens[0]
        try:
            entry = git_tree_entry(commit, task_path)
            audit.require(
                entry is not None and entry[:2] == ("100644", "blob"),
                f"{task_id}: task card is missing or not a regular 100644 blob "
                f"in commit {commit}",
            )
            historical_text = git_object(commit, task_path).decode("utf-8")
            audit.require(
                task_authorization_projection(historical_text) == expected_projection,
                f"{task_id}: authorization projection changed in commit {commit}",
            )
            historical_metadata = task_metadata_from_text(
                historical_text,
                f"{task_id}: task at {commit}",
            )
            backlog_amendments = backlog_authorization_amendments_at(commit)
            validate_scope_amendments(
                audit,
                f"{task_id}: task at {commit}",
                historical_metadata,
                backlog_amendments=backlog_amendments,
                authorized_text=authorized_text,
            )
            child_amendments = historical_metadata.get("scopeAmendments", [])
            child_amendments = (
                child_amendments if isinstance(child_amendments, list) else []
            )
            parents = tokens[1:]
            for parent in parents:
                parent_metadata = (
                    authorized_metadata
                    if parent == authorization_commit
                    else task_metadata_at_commit(parent, task_path)
                )
                parent_amendments = parent_metadata.get("scopeAmendments", [])
                parent_amendments = (
                    parent_amendments if isinstance(parent_amendments, list) else []
                )
                validate_scope_amendment_edge(
                    audit,
                    parent_amendments,
                    child_amendments,
                    f"{task_id}: {parent}..{commit}",
                )
                if (
                    len(child_amendments) > len(parent_amendments)
                    and child_amendments[: len(parent_amendments)]
                    == parent_amendments
                ):
                    for amendment in child_amendments[len(parent_amendments) :]:
                        validate_amendment_introduction(
                            audit,
                            task_id,
                            task_path,
                            base_commit,
                            parent,
                            commit,
                            parents,
                            amendment,
                        )
        except (HarnessError, UnicodeError, yaml.YAMLError) as exc:
            audit.error(
                f"{task_id}: cannot validate task authorization history at "
                f"{commit}: {exc}"
            )
    try:
        head_metadata = task_metadata_at_commit("HEAD", task_path)
        current_text = read_repository_text(ROOT / normalize_repo_path(task_path))
        current_metadata = task_metadata_from_text(
            current_text,
            f"{task_id}: current task",
        )
        validate_scope_amendments(
            audit,
            f"{task_id}: current task",
            current_metadata,
            backlog_amendments=(
                load_yaml(ROOT / TASK_BACKLOG_PATH).get("authorizationAmendments", {})
            ),
            authorized_text=authorized_text,
        )
        head_amendments = head_metadata.get("scopeAmendments", [])
        current_amendments = current_metadata.get("scopeAmendments", [])
        validate_uncommitted_scope_amendments(
            audit,
            head_amendments,
            current_amendments,
            f"{task_id}: HEAD..WORKTREE",
        )
    except (HarnessError, OSError, UnicodeError, yaml.YAMLError) as exc:
        audit.error(f"{task_id}: cannot validate current scope amendments: {exc}")
    if enforce_dominance:
        graph = git_text(
            "rev-list",
            "--topo-order",
            "--reverse",
            f"{base_commit}..HEAD",
        ).stdout.splitlines()
        for commit in graph:
            commit = commit.strip()
            task_exists = git_text(
                "cat-file",
                "-e",
                f"{commit}:{task_path}",
                check=False,
            )
            if task_exists.returncode != 0:
                continue
            try:
                historical = task_metadata_at_commit(commit, task_path)
                if historical.get("state") == "DRAFT":
                    continue
                dominated = git_text(
                    "merge-base",
                    "--is-ancestor",
                    authorization_commit,
                    commit,
                    check=False,
                )
                audit.require(
                    dominated.returncode == 0,
                    f"{task_id}: non-DRAFT task state at {commit} is outside the "
                    "authorizationCommit ancestry",
                )
            except (HarnessError, UnicodeError, yaml.YAMLError) as exc:
                audit.error(
                    f"{task_id}: cannot validate authorization dominance at {commit}: {exc}"
                )
    current_regular_file_bytes(
        audit,
        f"{task_id}: {task_path}",
        ROOT / normalize_repo_path(task_path),
    )
    index_entry = git_index_entry(task_path)
    audit.require(
        index_entry is not None and index_entry[0] == "100644",
        f"{task_id}: current task-card index entry must remain mode 100644",
    )
    worktree_oid = git_worktree_blob_oid(task_path)
    audit.require(
        index_entry is not None and index_entry[1] == worktree_oid,
        f"{task_id}: task-card index and worktree content must match before validation",
    )


def canonical_json_sha256(value: Any) -> str:
    payload = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def is_planning_only_task(task: dict[str, Any]) -> bool:
    state = str(task.get("state", ""))
    if state == "PLANNED":
        return True
    return (
        state in PLANNING_TERMINAL_STATES
        and task.get("planningBacklog") == TASK_BACKLOG_PATH
        and "baseCommit" not in task
    )


def validate_planned_task_metadata(
    audit: Audit,
    task_id: str,
    task: dict[str, Any],
) -> None:
    path = str(task.get("_path", ""))
    state = str(task.get("state", ""))
    expected_fields = (
        PLANNED_CARD_FIELDS
        if state == "PLANNED"
        else PLANNING_TERMINAL_CARD_FIELDS
    )
    fields = set(task) - {"_path"}
    audit.require(
        fields == expected_fields,
        f"{path}: planning-only metadata fields must be exactly "
        f"{sorted(expected_fields)}; dynamic execution evidence is forbidden",
    )
    audit.require(
        state == "PLANNED" or state in PLANNING_TERMINAL_STATES,
        f"{path}: planning-only projection has invalid state {state!r}",
    )
    audit.require(
        is_canonical_identity(task.get("owner")),
        f"{path}: owner must be a canonical lowercase identity",
    )
    audit.require(
        task.get("planningBacklog") == TASK_BACKLOG_PATH,
        f"{path}: PLANNED task must bind {TASK_BACKLOG_PATH}",
    )
    audit.require(
        task.get("planningContractHashAlgorithm")
        == PLANNING_CONTRACT_HASH_ALGORITHM,
        f"{path}: unsupported PLANNED planning contract hash algorithm",
    )
    audit.require(
        bool(
            re.fullmatch(
                r"[0-9a-f]{64}",
                str(task.get("planningContractHash", "")),
            )
        ),
        f"{path}: planningContractHash must be SHA-256",
    )
    audit.require(
        bool(TASK_ID_RE.fullmatch(task_id)),
        f"{path}: invalid taskId {task_id!r}",
    )
    if state in PLANNING_TERMINAL_STATES:
        audit.require(
            isinstance(task.get("planningResolution"), dict),
            f"{path}: planning terminal state requires planningResolution",
        )


def planned_card_render_projection(
    audit: Audit,
    label: str,
    task_id: str,
    entry: dict[str, Any],
    text: str,
) -> dict[str, Any] | None:
    normalized = text.replace("\r\n", "\n")
    metadata_match = TASK_BLOCK_RE.search(normalized)
    if not metadata_match:
        audit.error(f"{label}: planning card YAML block is missing")
        return None
    expected_heading = f"# {task_id}：{entry.get('title')}"
    first_line = normalized.split("\n", 1)[0]
    audit.require(
        first_line == expected_heading,
        f"{label}: planning card heading must be exactly {expected_heading!r}",
    )
    section_matches = list(re.finditer(r"(?m)^## (?P<heading>[^\n]+)\n", normalized))
    audit.require(
        len(section_matches) == 6,
        f"{label}: planning card must contain exactly six normative sections",
    )
    if not section_matches:
        return None
    preamble = normalized[metadata_match.end() : section_matches[0].start()].strip()
    audit.require(
        preamble == PLANNED_CARD_NON_NORMATIVE_NOTICE,
        f"{label}: planning card must contain exactly the fixed Backlog projection "
        "notice and no unbound preamble",
    )
    sections: list[dict[str, str]] = []
    seen_headings: set[str] = set()
    for index, section_match in enumerate(section_matches):
        heading = section_match.group("heading").strip()
        body_end = (
            section_matches[index + 1].start()
            if index + 1 < len(section_matches)
            else len(normalized)
        )
        body = normalized[section_match.end() : body_end].strip()
        audit.require(bool(heading), f"{label}: section {index + 1} heading is blank")
        audit.require(
            heading not in seen_headings,
            f"{label}: section heading {heading!r} is duplicated",
        )
        audit.require(bool(body), f"{label}: section {heading!r} body is blank")
        seen_headings.add(heading)
        sections.append({"heading": heading, "body": body})
    audit.require(
        normalized.count(PLANNED_CARD_NON_NORMATIVE_NOTICE) == 1,
        f"{label}: fixed Backlog projection notice must appear exactly once",
    )
    return {
        "heading": first_line,
        "notice": PLANNED_CARD_NON_NORMATIVE_NOTICE,
        "sections": sections,
    }


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
        if is_planning_only_task(task):
            audit.require(
                task.get("state") in states,
                f"{path}: lifecycle does not register planning state "
                f"{task.get('state')!r}",
            )
            validate_planned_task_metadata(audit, task_id, task)
            try:
                planned_text = read_repository_text(ROOT / path)
                audit.require(
                    PLANNED_CARD_NON_NORMATIVE_NOTICE in planned_text,
                    f"{path}: PLANNED card must declare its body as a "
                    "non-normative Backlog rendering",
                )
            except (OSError, UnicodeError) as exc:
                audit.error(f"{path}: cannot read PLANNED card body: {exc}")
            continue
        audit.require(
            task.get("state") != "SUPERSEDED",
            f"{path}: SUPERSEDED is reserved for planning-only Backlog cards; "
            "an execution task must close as ACCEPTED or REJECTED",
        )
        missing = sorted(required - task.keys())
        audit.require(not missing, f"{path}: missing task fields: {missing}")
        audit.require(bool(TASK_ID_RE.fullmatch(task_id)), f"{path}: invalid taskId {task_id!r}")
        audit.require(task.get("state") in states, f"{path}: unknown state {task.get('state')!r}")
        audit.require(
            is_canonical_identity(task.get("owner")),
            f"{path}: owner must be a canonical lowercase identity",
        )
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
        approvals = task.get("humanApprovals")
        approvals = approvals if isinstance(approvals, list) else []
        for index, approval in enumerate(approvals):
            label = f"{path}: humanApprovals[{index}]"
            audit.require(isinstance(approval, dict), f"{label} must be an object")
            if not isinstance(approval, dict):
                continue
            audit.require(
                is_canonical_identity(approval.get("approvedBy")),
                f"{label}.approvedBy must be a canonical lowercase identity",
            )
            audit.require(
                is_valid_approval_timestamp(approval.get("approvedAt")),
                f"{label}.approvedAt must be an ISO-8601 date or timestamp",
            )
            validate_nonblank_text(audit, f"{label}.scope", approval.get("scope"))
            validate_nonblank_text(audit, f"{label}.evidence", approval.get("evidence"))
        validate_scope_amendments(audit, path, task)
        for error in verify_context_lock(task):
            audit.error(error)
        expected_context_lock = f"docs/tasks/context/{task_id}.context-lock.yaml"
        audit.require(
            task.get("contextLock") == expected_context_lock,
            f"{path}: contextLock must be {expected_context_lock}",
        )
        authorization_commit = str(task.get("authorizationCommit", ""))
        if task.get("state") == "DRAFT":
            audit.require(
                authorization_commit == "",
                f"{path}: DRAFT task must not declare authorizationCommit",
            )
        elif task_id != "TASK-0001":
            audit.require(
                bool(FULL_COMMIT_RE.fullmatch(authorization_commit)),
                f"{path}: authorizationCommit must be a full Git SHA",
            )
        if task.get("state") != "DRAFT" and FULL_COMMIT_RE.fullmatch(authorization_commit):
            ancestor = git_text("merge-base", "--is-ancestor", authorization_commit, "HEAD", check=False)
            audit.require(ancestor.returncode == 0, f"{path}: authorizationCommit is not an ancestor of HEAD")
            base_to_authorization = git_text(
                "merge-base",
                "--is-ancestor",
                str(task.get("baseCommit", "")),
                authorization_commit,
                check=False,
            )
            audit.require(
                base_to_authorization.returncode == 0,
                f"{path}: baseCommit is not an ancestor of authorizationCommit",
            )
            try:
                raw = git_object(authorization_commit, path)
                authorized_text = raw.decode("utf-8")
                current_text = read_repository_text(ROOT / path)
                match = TASK_BLOCK_RE.search(authorized_text)
                audit.require(bool(match), f"{path}: authorization checkpoint has no task YAML")
                authorized = strict_yaml_load(match.group(1)) if match else {}
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
                            and is_valid_approval_timestamp(item.get("approvedAt"))
                            and isinstance(item.get("evidence"), str)
                            and bool(item.get("evidence").strip())
                            for item in approvals
                        )
                        audit.require(owner_approved, f"{path}: READY checkpoint lacks Owner approval evidence")
                audit.require(
                    task_authorization_projection(current_text)
                    == task_authorization_projection(authorized_text),
                    f"{path}: task title/body or immutable metadata changed after READY checkpoint",
                )
                validate_task_authorization_history(
                    audit,
                    task_id,
                    path,
                    str(task.get("baseCommit", "")),
                    authorization_commit,
                    authorized_text,
                    enforce_dominance=not is_legacy_harness_bootstrap(task),
                )
                changed = git_bytes(
                    "diff",
                    "--no-renames",
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
                allowed_checkpoint_paths = {
                    path,
                    str(task.get("contextLock", "")),
                    PROJECT_STATE_PATH,
                }
                audit.require(path in checkpoint_paths, f"{path}: authorization commit must include the task card")
                audit.require(
                    checkpoint_paths <= allowed_checkpoint_paths,
                    f"{path}: authorization commit contains non-authorization files: "
                    f"{sorted(checkpoint_paths - allowed_checkpoint_paths)}",
                )
                validate_ready_project_state_checkpoint(
                    audit,
                    task,
                    authorization_commit,
                    checkpoint_paths,
                    tasks,
                    lifecycle,
                )
                context_path = str(task.get("contextLock", ""))
                authorized_context = git_object(authorization_commit, context_path)
                current_context = read_repository_bytes(
                    ROOT / normalize_repo_path(context_path)
                )
                validate_ready_context_lock_bytes(
                    audit,
                    path,
                    current_context,
                    authorized_context,
                )
                validate_frozen_repository_artifact(
                    audit,
                    task_id,
                    authorization_commit,
                    context_path,
                )
                sequence = task_state_sequence(task, authorization_commit)
                transitions = lifecycle.get("transitions") or {}
                for previous, current in zip(sequence, sequence[1:]):
                    allowed = transitions.get(previous, [])
                    audit.require(
                        isinstance(allowed, list) and current in allowed,
                        f"{path}: invalid task state transition {previous} -> {current}; "
                        f"observed sequence {sequence}",
                    )
                validate_task_state_graph(
                    audit,
                    task,
                    lifecycle,
                    authorization_commit,
                )
            except (HarnessError, OSError, UnicodeError, yaml.YAMLError) as exc:
                audit.error(f"{path}: cannot verify authorization checkpoint: {exc}")


def validate_pending_draft_limit(
    audit: Audit,
    tasks: dict[str, dict[str, Any]],
    lifecycle: dict[str, Any],
) -> list[str]:
    draft_tasks = sorted(
        task_id
        for task_id, task in tasks.items()
        if task.get("state") == "DRAFT"
    )
    maximum_pending_drafts = int(
        (lifecycle.get("rules") or {}).get(
            "maximumPendingDraftTasks",
            1,
        )
    )
    audit.require(
        len(draft_tasks) <= maximum_pending_drafts,
        "task lifecycle: multiple pending DRAFT tasks are not allowed: "
        f"{draft_tasks}",
    )
    return draft_tasks


def validate_ledger_history(
    audit: Audit,
    current_entries: dict[str, Any],
    historical_snapshots: list[tuple[str, dict[str, Any]]],
) -> None:
    immutable_entries: dict[str, Any] = {}
    previous_entries: dict[str, Any] = {}
    for commit, snapshot in historical_snapshots:
        for task_id, entry in previous_entries.items():
            audit.require(
                snapshot.get(task_id) == entry,
                f"task-ledger: entry {task_id} was removed or rewritten in commit {commit}",
            )
        for task_id, entry in snapshot.items():
            if task_id in immutable_entries:
                audit.require(
                    immutable_entries[task_id] == entry,
                    f"task-ledger: immutable entry {task_id} changed in commit {commit}",
                )
            else:
                immutable_entries[task_id] = entry
        previous_entries = snapshot
    for task_id, entry in immutable_entries.items():
        audit.require(
            current_entries.get(task_id) == entry,
            f"task-ledger: historical terminal entry {task_id} was removed or rewritten",
        )


def validate_terminal_history_dominance(
    audit: Audit,
    task_id: str,
    task_path: str,
    base_commit: str,
    terminal_commit: str,
    terminal_states: set[str],
) -> None:
    history = git_text(
        "rev-list",
        "--topo-order",
        "--reverse",
        f"{base_commit}..HEAD",
    ).stdout.splitlines()
    for commit in history:
        commit = commit.strip()
        task_exists = git_text(
            "cat-file",
            "-e",
            f"{commit}:{task_path}",
            check=False,
        )
        if task_exists.returncode != 0:
            continue
        historical_task = task_metadata_at_commit(commit, task_path)
        if historical_task.get("state") not in terminal_states:
            continue
        dominated = git_text(
            "merge-base",
            "--is-ancestor",
            terminal_commit,
            commit,
            check=False,
        )
        audit.require(
            dominated.returncode == 0,
            f"task-ledger: v2 task {task_id} has a terminal state outside "
            f"its canonical terminal boundary at {commit}",
        )


def intervening_terminal_boundaries(
    base_commit: str,
    terminal_commit: str,
    task_id: str,
    current_entries: dict[str, Any],
    introductions: dict[str, set[str]],
) -> list[str]:
    intervening: list[str] = []
    for other_task_id, other_commits in introductions.items():
        if other_task_id == task_id:
            continue
        other_entry = current_entries.get(other_task_id)
        if (
            not isinstance(other_entry, dict)
            or other_entry.get("contractVersion") != 2
        ):
            continue
        for other_commit in other_commits:
            if other_commit == base_commit:
                continue
            after_base = git_text(
                "merge-base",
                "--is-ancestor",
                base_commit,
                other_commit,
                check=False,
            )
            before_terminal = git_text(
                "merge-base",
                "--is-ancestor",
                other_commit,
                terminal_commit,
                check=False,
            )
            if after_base.returncode == 0 and before_terminal.returncode == 0:
                intervening.append(f"{other_task_id}@{other_commit}")
    return sorted(intervening)


def validate_ledger_bound_artifacts(
    audit: Audit,
    current_entries: dict[str, Any],
    tasks: dict[str, dict[str, Any]],
    terminal_states: set[str],
    introductions: dict[str, set[str]],
    allow_uncommitted_terminal: bool,
) -> None:
    for task_id, raw_entry in current_entries.items():
        task = tasks.get(task_id)
        if task is None or not isinstance(raw_entry, dict):
            continue
        for field in ("taskCard", "handoff"):
            path = str(raw_entry.get(field, ""))
            if is_repository_relative(path):
                current_regular_file_bytes(
                    audit,
                    f"task-ledger: {task_id} {field}",
                    ROOT / normalize_repo_path(path),
                )
        validate_current_regular_tree(
            audit,
            task_id,
            f"docs/evidence/{task_id}",
        )
        entry = raw_entry
        contract_version = entry.get("contractVersion")
        try:
            if contract_version == 2:
                introduction_commits = introductions.get(task_id, set())
                audit.require(
                    len(introduction_commits) <= 1,
                    f"task-ledger: v2 task {task_id} has ambiguous terminal introductions: "
                    f"{sorted(introduction_commits)}",
                )
                terminal_commit = (
                    next(iter(introduction_commits))
                    if len(introduction_commits) == 1
                    else None
                )
            else:
                terminal_commit = first_terminal_commit(task, terminal_states)
        except HarnessError as exc:
            audit.error(f"task-ledger: cannot derive {task_id} terminal commit: {exc}")
            continue
        if terminal_commit is None:
            validate_terminal_commit_requirement(
                audit,
                task_id,
                task.get("state") in terminal_states,
                allow_uncommitted_terminal,
            )
            continue
        for field in ("taskCard", "handoff"):
            path = str(entry.get(field, ""))
            if is_repository_relative(path):
                validate_frozen_repository_artifact(
                    audit,
                    task_id,
                    terminal_commit,
                    path,
                )
        validate_frozen_repository_tree(
            audit,
            task_id,
            terminal_commit,
            f"docs/evidence/{task_id}",
        )
        if contract_version != 2:
            continue
        audit.require(
            introductions.get(task_id) == {terminal_commit},
            f"task-ledger: v2 task {task_id} must have exactly one introduction at "
            "its terminal commit",
        )
        try:
            terminal_ledger = yaml_at_commit(terminal_commit, TASK_LEDGER_PATH)
            terminal_entries = terminal_ledger.get("tasks")
            audit.require(
                isinstance(terminal_entries, dict)
                and terminal_entries.get(task_id) == entry,
                f"task-ledger: v2 task {task_id} must first register in its terminal commit",
            )
            terminal_task = task_metadata_at_commit(
                terminal_commit,
                str(entry.get("taskCard", "")),
            )
            audit.require(
                terminal_task.get("state") == entry.get("state")
                and terminal_task.get("state") in terminal_states,
                f"task-ledger: v2 task {task_id} terminal commit and ledger state disagree",
            )
            authorization_commit = str(terminal_task.get("authorizationCommit", ""))
            authorization_precedes_terminal = git_text(
                "merge-base",
                "--is-ancestor",
                authorization_commit,
                terminal_commit,
                check=False,
            )
            audit.require(
                bool(FULL_COMMIT_RE.fullmatch(authorization_commit))
                and authorization_precedes_terminal.returncode == 0,
                f"task-ledger: v2 task {task_id} terminal commit must descend from "
                "authorizationCommit",
            )
            base_commit = str(task.get("baseCommit", ""))
            intervening_boundaries = intervening_terminal_boundaries(
                base_commit,
                terminal_commit,
                task_id,
                current_entries,
                introductions,
            )
            audit.require(
                not intervening_boundaries,
                f"task-ledger: v2 task {task_id} was based before intervening "
                f"terminal boundaries: {sorted(intervening_boundaries)}",
            )
            terminal_state = yaml_at_commit(terminal_commit, PROJECT_STATE_PATH)
            audit.require(
                terminal_state.get("activeTask") in (None, "")
                and terminal_state.get("activeTaskCard") in (None, "")
                and terminal_state.get("lastTerminalTask") == task_id
                and terminal_state.get("lastTerminalHandoff") == entry.get("handoff"),
                f"task-ledger: v2 task {task_id} terminal project-state is not atomically closed",
            )
            if entry.get("state") == "ACCEPTED":
                audit.require(
                    terminal_state.get("lastAcceptedTask") == task_id
                    and terminal_state.get("lastAcceptedHandoff") == entry.get("handoff"),
                    f"task-ledger: accepted v2 task {task_id} terminal project-state "
                    "must update accepted pointers",
                )
            parent_tokens = git_text(
                "rev-list",
                "--parents",
                "-n",
                "1",
                terminal_commit,
            ).stdout.split()
            audit.require(
                len(parent_tokens) == 2,
                f"task-ledger: v2 terminal commit for {task_id} must have exactly one parent",
            )
            if len(parent_tokens) == 2:
                parent_commit = parent_tokens[1]
                parent_entries = ledger_entries_at_commit(parent_commit)
                audit.require(
                    task_id not in parent_entries,
                    f"task-ledger: v2 task {task_id} was registered before its terminal commit",
                )
                parent_task = task_metadata_at_commit(
                    parent_commit,
                    str(entry.get("taskCard", "")),
                )
                audit.require(
                    parent_task.get("state") not in terminal_states,
                    f"task-ledger: v2 task {task_id} terminal parent must be non-terminal",
                )
                terminal_paths = set(
                    changed_paths_between(parent_commit, terminal_commit)
                )
                required_terminal_paths = {
                    str(entry.get("taskCard", "")),
                    PROJECT_STATE_PATH,
                    TASK_LEDGER_PATH,
                    str(entry.get("evidence", "")),
                    str(entry.get("handoff", "")),
                }
                audit.require(
                    required_terminal_paths <= terminal_paths,
                    f"task-ledger: v2 task {task_id} terminal commit is missing atomic "
                    f"closure paths: {sorted(required_terminal_paths - terminal_paths)}",
                )
                allowed_terminal_patterns = (
                    str(entry.get("taskCard", "")),
                    PROJECT_STATE_PATH,
                    TASK_LEDGER_PATH,
                    f"docs/evidence/{task_id}/**",
                    str(entry.get("handoff", "")),
                )
                unauthorized_terminal_paths = [
                    path
                    for path in terminal_paths
                    if not any(
                        glob_matches(path, pattern)
                        for pattern in allowed_terminal_patterns
                    )
                ]
                audit.require(
                    not unauthorized_terminal_paths,
                    f"task-ledger: v2 task {task_id} terminal commit contains "
                    f"unrelated paths: {unauthorized_terminal_paths}",
                )
            validate_terminal_history_dominance(
                audit,
                task_id,
                str(entry.get("taskCard", "")),
                str(task.get("baseCommit", "")),
                terminal_commit,
                terminal_states,
            )
        except (HarnessError, OSError, UnicodeError, yaml.YAMLError) as exc:
            audit.error(f"task-ledger: cannot bind {task_id} to terminal commit: {exc}")


def ledger_entries_at_commit(commit: str) -> dict[str, Any]:
    entry = git_tree_entry(commit, TASK_LEDGER_PATH)
    if entry is None or entry[1] != "blob":
        return {}
    ledger = yaml_at_commit(commit, TASK_LEDGER_PATH)
    if set(ledger) != {"schemaVersion", "tasks"}:
        raise HarnessError(f"task-ledger: invalid root fields at {commit}")
    if ledger.get("schemaVersion") != 1 or not isinstance(ledger.get("tasks"), dict):
        raise HarnessError(f"task-ledger: invalid snapshot at {commit}")
    return ledger["tasks"]


def ledger_introduction_commits_for_task(task_id: str) -> set[str]:
    snapshot = _ACTIVE_GIT_SNAPSHOT
    if (
        snapshot is not None
        and snapshot.ledger_introductions is not None
    ):
        return set(snapshot.ledger_introductions.get(task_id, set()))
    introductions: set[str] = set()
    history = git_text(
        "rev-list",
        "--parents",
        "--topo-order",
        "--reverse",
        "HEAD",
    ).stdout.splitlines()
    for graph_line in history:
        tokens = graph_line.split()
        if not tokens:
            continue
        commit = tokens[0]
        child_entries = ledger_entries_at_commit(commit)
        if task_id not in child_entries:
            continue
        parent_entries = [
            ledger_entries_at_commit(parent)
            for parent in tokens[1:]
        ]
        if not parent_entries or all(
            task_id not in entries
            for entries in parent_entries
        ):
            introductions.add(commit)
    return introductions


def canonical_terminal_commit(
    task: dict[str, Any],
    terminal_states: set[str],
) -> str | None:
    task_id = str(task.get("taskId", ""))
    ledger_path = ROOT / TASK_LEDGER_PATH
    if current_path_is_file(ledger_path):
        ledger = load_yaml(ledger_path)
        entries = ledger.get("tasks")
        entry = entries.get(task_id) if isinstance(entries, dict) else None
        if isinstance(entry, dict) and entry.get("contractVersion") == 2:
            introductions = ledger_introduction_commits_for_task(task_id)
            if len(introductions) > 1:
                raise HarnessError(
                    f"task-ledger: v2 task {task_id} has multiple terminal introductions"
                )
            return next(iter(introductions)) if introductions else None
    return first_terminal_commit(task, terminal_states)


def validate_active_task_base_freshness(
    audit: Audit,
    tasks: dict[str, dict[str, Any]],
    lifecycle: dict[str, Any],
    current_entries: dict[str, Any] | None = None,
    introductions: dict[str, set[str]] | None = None,
) -> None:
    active_states = set(str(item) for item in lifecycle.get("activeStates", []))
    active_tasks = {
        task_id: task
        for task_id, task in tasks.items()
        if task.get("state") in active_states
    }
    if not active_tasks:
        return
    if current_entries is None:
        ledger = load_yaml(ROOT / TASK_LEDGER_PATH)
        raw_entries = ledger.get("tasks")
        current_entries = raw_entries if isinstance(raw_entries, dict) else {}
    if introductions is None:
        introductions = {
            task_id: ledger_introduction_commits_for_task(task_id)
            for task_id, entry in current_entries.items()
            if isinstance(entry, dict) and entry.get("contractVersion") == 2
        }
    for task_id, task in active_tasks.items():
        stale_boundaries = intervening_terminal_boundaries(
            str(task.get("baseCommit", "")),
            "HEAD",
            task_id,
            current_entries,
            introductions,
        )
        audit.require(
            not stale_boundaries,
            f"{task_id}: active task uses a stale Base Commit; terminal boundaries "
            f"were introduced after authorization: {stale_boundaries}",
        )


def validate_ledger_edge(
    audit: Audit,
    parent_entries: dict[str, Any],
    child_entries: dict[str, Any],
    edge_label: str,
) -> None:
    for task_id, entry in parent_entries.items():
        audit.require(
            child_entries.get(task_id) == entry,
            f"task-ledger: entry {task_id} was removed or rewritten on edge {edge_label}",
        )


def validate_terminal_commit_requirement(
    audit: Audit,
    task_id: str,
    is_terminal: bool,
    allow_uncommitted_terminal: bool,
) -> None:
    if is_terminal:
        audit.require(
            allow_uncommitted_terminal,
            f"{task_id}: terminal state must exist in a real Git commit; "
            "use --pre-closure only before creating that commit",
        )


def validate_ledger_parent_edges(
    audit: Audit,
    current_entries: dict[str, Any],
) -> dict[str, set[str]]:
    shallow = git_text("rev-parse", "--is-shallow-repository", check=False)
    audit.require(
        shallow.returncode == 0 and shallow.stdout.strip() == "false",
        "task-ledger: full Git history is required for append-only verification",
    )
    history = git_text(
        "rev-list",
        "--parents",
        "--topo-order",
        "--reverse",
        "HEAD",
    ).stdout.splitlines()
    introductions: dict[str, set[str]] = {}
    snapshots: dict[str, dict[str, Any]] = {}

    def snapshot(commit: str) -> dict[str, Any]:
        if commit not in snapshots:
            snapshots[commit] = ledger_entries_at_commit(commit)
        return snapshots[commit]

    for graph_line in history:
        tokens = graph_line.split()
        if not tokens:
            continue
        commit = tokens[0]
        parent_commits = tokens[1:]
        try:
            child_entries = snapshot(commit)
            parent_snapshots = [
                snapshot(parent_commit)
                for parent_commit in parent_commits
            ]
            for task_id in child_entries:
                if not parent_snapshots or all(
                    task_id not in parent_entries
                    for parent_entries in parent_snapshots
                ):
                    introductions.setdefault(task_id, set()).add(commit)
            for parent_commit, parent_entries in zip(
                parent_commits,
                parent_snapshots,
            ):
                validate_ledger_edge(
                    audit,
                    parent_entries,
                    child_entries,
                    f"{parent_commit}..{commit}",
                )
        except (HarnessError, yaml.YAMLError) as exc:
            audit.error(f"task-ledger: cannot validate history edge at {commit}: {exc}")
    try:
        head_entries = ledger_entries_at_commit("HEAD")
        for task_id, entry in head_entries.items():
            audit.require(
                current_entries.get(task_id) == entry,
                f"task-ledger: historical terminal entry {task_id} was removed or rewritten",
            )
    except HarnessError as exc:
        audit.error(f"task-ledger: cannot compare worktree with HEAD: {exc}")
    for task_id in current_entries:
        historical_introductions = introductions.get(task_id, set())
        audit.require(
            len(historical_introductions) <= 1,
            f"task-ledger: task {task_id} has multiple introduction commits: "
            f"{sorted(historical_introductions)}",
        )
    return introductions


def validate_task_ledger_entries(
    audit: Audit,
    entries: dict[str, Any],
    tasks: dict[str, dict[str, Any]],
    terminal_states: set[str],
) -> None:
    for task_id, raw_entry in entries.items():
        label = f"task-ledger: {task_id}"
        audit.require(bool(TASK_ID_RE.fullmatch(str(task_id))), f"{label}: invalid task ID")
        audit.require(isinstance(raw_entry, dict), f"{label}: entry must be an object")
        if not isinstance(raw_entry, dict):
            continue
        audit.require(
            set(raw_entry) == TASK_LEDGER_FIELDS,
            f"{label}: fields must be exactly {sorted(TASK_LEDGER_FIELDS)}",
        )
        audit.require(
            raw_entry.get("state") in terminal_states,
            f"{label}: state must be terminal",
        )
        contract_version = raw_entry.get("contractVersion")
        audit.require(
            isinstance(contract_version, int)
            and not isinstance(contract_version, bool)
            and contract_version in {1, 2},
            f"{label}: contractVersion must be a supported version (1 or 2)",
        )
        expected_paths = {
            "evidence": f"docs/evidence/{task_id}/evidence-pack.json",
            "handoff": f"docs/handoffs/{task_id}.json",
        }
        for field, expected in expected_paths.items():
            audit.require(
                raw_entry.get(field) == expected,
                f"{label}: {field} must be {expected}",
            )
        task = tasks.get(str(task_id))
        audit.require(task is not None, f"{label}: task card is missing")
        if task is not None:
            expected_contract_version = 2 if task.get("authorizationCommit") else 1
            audit.require(
                contract_version == expected_contract_version,
                f"{label}: contractVersion must be {expected_contract_version} for this task",
            )
            audit.require(
                raw_entry.get("taskCard") == task.get("_path"),
                f"{label}: taskCard does not match the discovered task",
            )
            audit.require(
                raw_entry.get("state") == task.get("state"),
                f"{label}: state disagrees with the task card",
            )
        for field in ("taskCard", "evidence", "handoff"):
            path = str(raw_entry.get(field, ""))
            audit.require(is_repository_relative(path), f"{label}: {field} must be repository-relative")
            if is_repository_relative(path):
                audit.require(
                    current_path_is_file(ROOT / normalize_repo_path(path)),
                    f"{label}: missing {path}",
                )
    for task_id, task in tasks.items():
        if (
            task.get("state") in terminal_states
            and not is_planning_only_task(task)
        ):
            audit.require(
                task_id in entries,
                f"task-ledger: terminal task {task_id} is not registered",
            )


def validate_task_ledger(
    audit: Audit,
    tasks: dict[str, dict[str, Any]],
    lifecycle: dict[str, Any],
    allow_uncommitted_terminal: bool = False,
) -> dict[str, Any]:
    ledger = load_yaml(ROOT / TASK_LEDGER_PATH)
    audit.require(
        set(ledger) == {"schemaVersion", "tasks"},
        "task-ledger: root fields must be exactly schemaVersion and tasks",
    )
    audit.require(ledger.get("schemaVersion") == 1, "task-ledger: unsupported schemaVersion")
    raw_entries = ledger.get("tasks")
    audit.require(isinstance(raw_entries, dict), "task-ledger: tasks must be an object")
    entries = raw_entries if isinstance(raw_entries, dict) else {}
    terminal_states = set(str(item) for item in lifecycle.get("terminalStates", []))
    validate_task_ledger_entries(audit, entries, tasks, terminal_states)
    introductions = validate_ledger_parent_edges(audit, entries)
    if _ACTIVE_GIT_SNAPSHOT is not None:
        _ACTIVE_GIT_SNAPSHOT.ledger_introductions = {
            task_id: set(commits)
            for task_id, commits in introductions.items()
        }
    validate_ledger_bound_artifacts(
        audit,
        entries,
        tasks,
        terminal_states,
        introductions,
        allow_uncommitted_terminal,
    )
    return entries


def validate_task_base_handoff_anchors(
    audit: Audit,
    tasks: dict[str, dict[str, Any]],
    lifecycle: dict[str, Any],
) -> None:
    terminal_states = set(str(item) for item in lifecycle.get("terminalStates", []))
    for task_id, task in tasks.items():
        if is_planning_only_task(task):
            continue
        if task_id == "TASK-0001":
            continue
        if is_legacy_harness_bootstrap(task):
            try:
                legacy_task = tasks.get("TASK-0001")
                if legacy_task is None:
                    raise HarnessError("bootstrap predecessor TASK-0001 is missing")
                first_ready = first_task_state_commit_from_base(task, {"READY"})
                if first_ready is None:
                    raise HarnessError("bootstrap task has no READY commit")
                parent_tokens = git_text(
                    "rev-list",
                    "--parents",
                    "-n",
                    "1",
                    first_ready[0],
                ).stdout.split()
                audit.require(
                    len(parent_tokens) == 2
                    and parent_tokens[1] == task.get("baseCommit"),
                    f"{task_id}: legacy bootstrap baseCommit must be the direct parent "
                    "of its first READY commit",
                )
                legacy_previous = git_object(
                    str(task.get("baseCommit", "")),
                    str(legacy_task["_path"]),
                ).decode("utf-8")
                match = TASK_BLOCK_RE.search(legacy_previous)
                metadata = strict_yaml_load(match.group(1)) if match else {}
                audit.require(
                    isinstance(metadata, dict)
                    and metadata.get("state") in {"DONE", "COMPLETED", "ACCEPTED"},
                    f"{task_id}: legacy bootstrap Base Commit is not a prior terminal snapshot",
                )
            except (HarnessError, UnicodeError, yaml.YAMLError) as exc:
                audit.error(f"{task_id}: cannot verify legacy bootstrap boundary: {exc}")
            continue
        base_commit = str(task.get("baseCommit", ""))
        try:
            base_state = yaml_at_commit(base_commit, PROJECT_STATE_PATH)
            previous_task_id = str(base_state.get("lastTerminalTask", ""))
            audit.require(
                previous_task_id in tasks,
                f"{task_id}: Base Commit project-state has unknown lastTerminalTask "
                f"{previous_task_id!r}",
            )
            if previous_task_id not in tasks:
                continue
            previous_boundary = canonical_terminal_commit(
                tasks[previous_task_id],
                terminal_states,
            )
            audit.require(
                previous_boundary is not None and base_commit == previous_boundary,
                f"{task_id}: baseCommit must equal previous task {previous_task_id} "
                "terminal boundary commit",
            )
        except (HarnessError, OSError, UnicodeError, yaml.YAMLError) as exc:
            audit.error(f"{task_id}: cannot verify Base Commit handoff boundary: {exc}")


def validate_authorized_task_history(
    audit: Audit,
    tasks: dict[str, dict[str, Any]],
) -> None:
    authorized: dict[str, str] = {}
    historical_non_draft_paths: dict[str, set[str]] = {}
    commits = git_text("rev-list", "--reverse", "HEAD").stdout.splitlines()
    for commit in commits:
        paths = [
            path
            for path in repository_paths_at_commit(commit.strip())
            if path.startswith("docs/tasks/")
        ]
        snapshot_paths: dict[str, str] = {}
        for path in paths:
            normalized = normalize_repo_path(path)
            if not re.fullmatch(r"docs/tasks/TASK-[0-9]{4,}.*\.md", normalized):
                continue
            try:
                raw = git_object(commit.strip(), normalized).decode("utf-8")
                match = TASK_BLOCK_RE.search(raw)
                metadata = strict_yaml_load(match.group(1)) if match else {}
            except (HarnessError, UnicodeError, yaml.YAMLError) as exc:
                audit.error(
                    f"authorized-task-history: cannot inspect {normalized} at {commit}: {exc}"
                )
                continue
            if isinstance(metadata, dict):
                task_id = str(metadata.get("taskId", ""))
                filename_task_id = task_id_from_filename(Path(normalized))
                audit.require(
                    filename_task_id == task_id,
                    f"authorized-task-history: filename/taskId mismatch at "
                    f"{commit}: {normalized}",
                )
                previous_snapshot_path = snapshot_paths.setdefault(task_id, normalized)
                audit.require(
                    previous_snapshot_path == normalized,
                    f"authorized-task-history: duplicate taskId {task_id} at "
                    f"{commit}: {previous_snapshot_path}, {normalized}",
                )
                if metadata.get("state") not in {"PLANNED", "DRAFT"}:
                    historical_non_draft_paths.setdefault(task_id, set()).add(normalized)
            if isinstance(metadata, dict) and metadata.get("state") == "READY":
                previous_path = authorized.setdefault(task_id, normalized)
                audit.require(
                    previous_path == normalized,
                    f"authorized-task-history: {task_id} changed task-card path",
                )
    for task_id, canonical_path in authorized.items():
        observed_paths = historical_non_draft_paths.get(task_id, set())
        audit.require(
            observed_paths <= {canonical_path},
            f"authorized-task-history: {task_id} appeared at non-canonical "
            f"non-PLANNED/DRAFT paths: {sorted(observed_paths - {canonical_path})}",
        )
    validate_authorized_task_presence(audit, tasks, authorized)


def validate_authorized_task_presence(
    audit: Audit,
    tasks: dict[str, dict[str, Any]],
    authorized: dict[str, str],
) -> None:
    for task_id, path in authorized.items():
        audit.require(
            task_id in tasks and tasks[task_id].get("_path") == path,
            f"authorized-task-history: READY task {task_id} disappeared from {path}",
        )


def validate_project_state(
    audit: Audit,
    state: dict[str, Any],
    lifecycle: dict[str, Any],
    tasks: dict[str, dict[str, Any]],
) -> str | None:
    audit.require(state.get("schemaVersion") == 1, "project-state: unsupported schemaVersion")
    phase_source = str(state.get("phaseSource", ""))
    audit.require(is_repository_relative(phase_source), "project-state: phaseSource must be repository-relative")
    product: dict[str, Any] = {}
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
    execution_tasks = {
        task_id: task
        for task_id, task in tasks.items()
        if not is_planning_only_task(task)
    }
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
    latest_accepted = derive_latest_task_in_states(
        audit,
        execution_tasks,
        {"ACCEPTED"},
        "accepted",
    )
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
        audit.require(
            current_path_is_file(ROOT / handoff_value),
            f"project-state: missing {handoff_value}",
        )
    last_terminal = str(state.get("lastTerminalTask", ""))
    audit.require(last_terminal in tasks, f"project-state: unknown lastTerminalTask {last_terminal!r}")
    if last_terminal in tasks:
        audit.require(
            tasks[last_terminal].get("state") in terminal_states
            and not is_planning_only_task(tasks[last_terminal]),
            f"project-state: lastTerminalTask {last_terminal} is not an "
            "execution terminal",
        )
    latest_terminal = derive_latest_task_in_states(
        audit,
        execution_tasks,
        terminal_states,
        "terminal",
    )
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
        audit.require(
            current_path_is_file(ROOT / terminal_handoff),
            f"project-state: missing {terminal_handoff}",
        )
    validate_nonblank_text(audit, "project-state: nextAction", state.get("nextAction"))
    gates = state.get("capabilityGates")
    audit.require(isinstance(gates, dict) and bool(gates), "project-state: capabilityGates are required")
    required_gates = {"businessImplementation", "realUserBeta", "realPayment"}
    if isinstance(gates, dict):
        audit.require(
            required_gates <= set(gates),
            f"project-state: capabilityGates missing {sorted(required_gates - set(gates))}",
        )
        for gate_id, gate in gates.items():
            audit.require(isinstance(gate, dict), f"project-state: gate {gate_id} must be an object")
            if not isinstance(gate, dict):
                continue
            audit.require(
                gate.get("state") in {"BLOCKED", "OPEN", "FORBIDDEN"},
                f"project-state: gate {gate_id} has invalid state {gate.get('state')!r}",
            )
            validate_nonblank_text(
                audit,
                f"project-state: gate {gate_id}.reason",
                gate.get("reason"),
            )
        alpha = product.get("alpha")
        alpha = alpha if isinstance(alpha, dict) else {}
        if alpha.get("paymentEnabled") is False and isinstance(gates.get("realPayment"), dict):
            audit.require(
                gates["realPayment"].get("state") == "FORBIDDEN",
                "project-state: realPayment must remain FORBIDDEN while product-scope "
                "alpha.paymentEnabled is false",
            )

    for task_id, task in tasks.items():
        if (
            task.get("state") in terminal_states
            and not is_planning_only_task(task)
        ):
            handoff_path = ROOT / f"docs/handoffs/{task_id}.json"
            evidence_path = ROOT / f"docs/evidence/{task_id}/evidence-pack.json"
            audit.require(
                current_path_is_file(handoff_path),
                f"{task_id}: terminal task is missing handoff",
            )
            audit.require(
                current_path_is_file(evidence_path),
                f"{task_id}: terminal task is missing evidence pack",
            )
    return declared_id


def validate_nonblank_string_list(
    audit: Audit,
    label: str,
    value: Any,
    *,
    allow_empty: bool = False,
) -> list[str]:
    audit.require(isinstance(value, list), f"{label}: must be a list")
    if not isinstance(value, list):
        return []
    audit.require(
        allow_empty or bool(value),
        f"{label}: must be non-empty",
    )
    normalized = [str(item) for item in value]
    audit.require(
        all(isinstance(item, str) and bool(item.strip()) for item in value),
        f"{label}: entries must be non-blank strings",
    )
    audit.require(
        len(normalized) == len(set(normalized)),
        f"{label}: entries must be unique",
    )
    return normalized


def backlog_gate_static_projection(gate: dict[str, Any]) -> dict[str, Any]:
    return {
        key: value
        for key, value in gate.items()
        if key not in {"status", "approval"}
    }


def validate_backlog_history_edge(
    audit: Audit,
    parent: dict[str, Any],
    child: dict[str, Any],
    edge_label: str,
) -> None:
    parent_tasks = parent.get("tasks")
    child_tasks = child.get("tasks")
    audit.require(
        isinstance(parent_tasks, dict) and isinstance(child_tasks, dict),
        f"task-backlog: tasks must remain objects on edge {edge_label}",
    )
    if isinstance(parent_tasks, dict) and isinstance(child_tasks, dict):
        for task_id, entry in parent_tasks.items():
            audit.require(
                child_tasks.get(task_id) == entry,
                f"task-backlog: permanent planning contract {task_id} was removed "
                f"or rewritten on edge {edge_label}",
            )

    parent_order = parent.get("executionOrder")
    child_order = child.get("executionOrder")
    order_is_valid = isinstance(parent_order, list) and isinstance(child_order, list)
    if order_is_valid:
        parent_ids = set(parent_order)
        order_is_valid = [
            task_id for task_id in child_order if task_id in parent_ids
        ] == parent_order
    audit.require(
        order_is_valid,
        "task-backlog: executionOrder must preserve the relative order of every "
        f"historical task ID on edge {edge_label}",
    )

    parent_critical = parent.get("criticalPath")
    child_critical = child.get("criticalPath")
    audit.require(
        isinstance(parent_critical, list)
        and isinstance(child_critical, list)
        and child_critical[: len(parent_critical)] == parent_critical,
        f"task-backlog: criticalPath must preserve its historical prefix on edge "
        f"{edge_label}",
    )

    parent_gates = parent.get("decisionGates")
    child_gates = child.get("decisionGates")
    audit.require(
        isinstance(parent_gates, dict) and isinstance(child_gates, dict),
        f"task-backlog: decisionGates must remain objects on edge {edge_label}",
    )
    if isinstance(parent_gates, dict) and isinstance(child_gates, dict):
        for gate_id, old_gate in parent_gates.items():
            new_gate = child_gates.get(gate_id)
            audit.require(
                isinstance(old_gate, dict) and isinstance(new_gate, dict),
                f"task-backlog: decision gate {gate_id} was removed on edge "
                f"{edge_label}",
            )
            if not isinstance(old_gate, dict) or not isinstance(new_gate, dict):
                continue
            audit.require(
                backlog_gate_static_projection(old_gate)
                == backlog_gate_static_projection(new_gate),
                f"task-backlog: decision gate {gate_id} contract was rewritten on "
                f"edge {edge_label}",
            )
            old_status = str(old_gate.get("status", ""))
            new_status = str(new_gate.get("status", ""))
            if old_status == "PENDING":
                audit.require(
                    new_status in {"PENDING", "APPROVED", "REJECTED"},
                    f"task-backlog: invalid gate transition {gate_id} "
                    f"{old_status} -> {new_status} on edge {edge_label}",
                )
            else:
                audit.require(
                    new_gate == old_gate,
                    f"task-backlog: decided gate {gate_id} is immutable on edge "
                    f"{edge_label}",
                )

    parent_resolutions = parent.get("resolutions")
    child_resolutions = child.get("resolutions")
    audit.require(
        isinstance(parent_resolutions, dict)
        and isinstance(child_resolutions, dict),
        f"task-backlog: resolutions must remain objects on edge {edge_label}",
    )
    if isinstance(parent_resolutions, dict) and isinstance(child_resolutions, dict):
        for task_id, resolution in parent_resolutions.items():
            audit.require(
                child_resolutions.get(task_id) == resolution,
                f"task-backlog: resolution {task_id} was removed or rewritten on "
                f"edge {edge_label}",
            )


def validate_backlog_authorization_amendment_edge(
    audit: Audit,
    parent: dict[str, Any],
    child: dict[str, Any],
    edge_label: str,
) -> None:
    parent_amendments = parent.get("authorizationAmendments", {})
    child_amendments = child.get("authorizationAmendments", {})
    audit.require(
        isinstance(parent_amendments, dict)
        and isinstance(child_amendments, dict),
        f"task-backlog: authorizationAmendments must remain objects on edge "
        f"{edge_label}",
    )
    if not isinstance(parent_amendments, dict) or not isinstance(
        child_amendments,
        dict,
    ):
        return
    for amendment_id, contract in parent_amendments.items():
        audit.require(
            child_amendments.get(amendment_id) == contract,
            f"task-backlog: authorization amendment {amendment_id} was removed "
            f"or rewritten on edge {edge_label}",
        )


def validate_backlog_authorization_amendments(
    audit: Audit,
    raw: Any,
    tasks: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    audit.require(
        isinstance(raw, dict),
        "task-backlog: authorizationAmendments must be an object",
    )
    amendments = raw if isinstance(raw, dict) else {}
    projected_ids: set[str] = set()
    for task in tasks.values():
        task_amendments = task.get("scopeAmendments")
        if not isinstance(task_amendments, list):
            continue
        projected_ids.update(
            str(item.get("amendmentId"))
            for item in task_amendments
            if isinstance(item, dict)
            and set(item) == SCOPE_AMENDMENT_PROJECTION_FIELDS
        )
    audit.require(
        projected_ids == set(amendments),
        "task-backlog: strong Owner amendment contracts and task-card projections "
        f"must have exact bidirectional membership; backlogOnly="
        f"{sorted(set(amendments) - projected_ids)}, "
        f"cardOnly={sorted(projected_ids - set(amendments))}",
    )
    for amendment_id, contract in amendments.items():
        label = f"task-backlog.authorizationAmendments.{amendment_id}"
        audit.require(
            is_canonical_identity(amendment_id),
            f"{label}: amendment ID must be canonical",
        )
        task_id = (
            str(contract.get("taskId", ""))
            if isinstance(contract, dict)
            else ""
        )
        task = tasks.get(task_id)
        audit.require(task is not None, f"{label}: taskId is not registered")
        if task is None:
            continue
        authorization_commit = str(task.get("authorizationCommit", ""))
        authorized_text: str | None = None
        if FULL_COMMIT_RE.fullmatch(authorization_commit):
            try:
                authorized_text = git_object(
                    authorization_commit,
                    str(task.get("_path", "")),
                ).decode("utf-8")
            except (HarnessError, UnicodeError) as exc:
                audit.error(f"{label}: cannot read authorization checkpoint: {exc}")
        validate_authorization_amendment_contract(
            audit,
            label,
            str(amendment_id),
            contract,
            task,
            authorized_text=authorized_text,
            seen_path_keys={},
        )
        task_amendments = task.get("scopeAmendments")
        task_amendment_items = (
            task_amendments if isinstance(task_amendments, list) else []
        )
        projections = [
            item
            for item in task_amendment_items
            if isinstance(item, dict)
            and set(item) == SCOPE_AMENDMENT_PROJECTION_FIELDS
            and item.get("amendmentId") == amendment_id
        ]
        audit.require(
            len(projections) == 1
            and projections[0].get("contract") == contract
            and projections[0].get("contractHash")
            == canonical_json_sha256(contract),
            f"{label}: task card must contain one exact hash-bound projection",
        )
        if isinstance(contract, dict):
            scope_grant_id = contract.get("scopeGrantAmendmentId")
            audit.require(
                scope_grant_id is None,
                f"{label}: scopeGrantAmendmentId must be null because retired "
                "legacy amendments cannot grant authority",
            )
    return amendments


def validate_backlog_planning_card_snapshot(
    audit: Audit,
    label: str,
    task_id: str,
    task_path: str,
    entry: dict[str, Any],
    metadata: dict[str, Any],
    expected_state: str,
    resolution: dict[str, Any] | None,
    card_text: str,
) -> dict[str, Any] | None:
    historical = dict(metadata)
    historical["_path"] = task_path
    validate_planned_task_metadata(audit, task_id, historical)
    audit.require(
        metadata.get("taskId") == task_id,
        f"{label}: planning card taskId must remain {task_id}",
    )
    audit.require(
        metadata.get("state") == expected_state,
        f"{label}: planning card state must remain {expected_state}",
    )
    audit.require(
        metadata.get("planningContractHash") == canonical_json_sha256(entry),
        f"{label}: planning card hash must match its immutable Backlog contract",
    )
    if resolution is None:
        audit.require(
            "planningResolution" not in metadata,
            f"{label}: PLANNED card must not contain planningResolution",
        )
    else:
        audit.require(
            metadata.get("planningResolution") == resolution,
            f"{label}: planning terminal card must project its resolution exactly",
        )
    return planned_card_render_projection(
        audit,
        label,
        task_id,
        entry,
        card_text,
    )


def validate_backlog_resolution_commit(
    audit: Audit,
    parent_commit: str,
    commit: str,
    parent_backlog: dict[str, Any],
    backlog: dict[str, Any],
) -> None:
    parent_entries = parent_backlog.get("tasks")
    entries = backlog.get("tasks")
    parent_resolutions = parent_backlog.get("resolutions")
    resolutions = backlog.get("resolutions")
    if (
        not isinstance(parent_entries, dict)
        or not isinstance(entries, dict)
        or not isinstance(parent_resolutions, dict)
        or not isinstance(resolutions, dict)
    ):
        return
    for task_id in sorted(resolutions):
        entry = entries.get(task_id)
        resolution = resolutions.get(task_id)
        audit.require(
            isinstance(entry, dict) and isinstance(resolution, dict),
            f"task-backlog: resolution {task_id} at {commit} is invalid",
        )
        if not isinstance(entry, dict) or not isinstance(resolution, dict):
            continue
        task_path = str(entry.get("taskCard", ""))
        child_tree = git_tree_entry(commit, task_path)
        audit.require(
            child_tree is not None and child_tree[:2] == ("100644", "blob"),
            f"task-backlog: resolved planning card {task_id} must remain a "
            f"regular 100644 blob at {commit}",
        )
        try:
            child_text = git_object(commit, task_path).decode("utf-8")
            child_metadata = task_metadata_from_text(
                child_text,
                f"task-backlog: resolution {task_id} child {commit}",
            )
            child_render = validate_backlog_planning_card_snapshot(
                audit,
                f"task-backlog: resolution {task_id} child {commit}",
                task_id,
                task_path,
                entry,
                child_metadata,
                str(resolution.get("state", "")),
                resolution,
                child_text,
            )
        except (HarnessError, UnicodeError, yaml.YAMLError) as exc:
            audit.error(
                f"task-backlog: cannot validate resolution {task_id} card at "
                f"{commit}: {exc}"
            )
            continue
        parent_entry = parent_entries.get(task_id)
        audit.require(
            isinstance(parent_entry, dict)
            and parent_entry.get("taskCard") == task_path,
            f"task-backlog: resolution {task_id} on edge "
            f"{parent_commit}..{commit} must preserve its planning card path",
        )
        if not isinstance(parent_entry, dict):
            continue
        parent_tree = git_tree_entry(parent_commit, task_path)
        audit.require(
            parent_tree is not None and parent_tree[:2] == ("100644", "blob"),
            f"task-backlog: resolved planning card {task_id} must remain a "
            f"regular 100644 blob at {parent_commit}",
        )
        try:
            parent_text = git_object(parent_commit, task_path).decode("utf-8")
            parent_metadata = task_metadata_from_text(
                parent_text,
                f"task-backlog: resolution {task_id} parent {parent_commit}",
            )
        except (HarnessError, UnicodeError, yaml.YAMLError) as exc:
            audit.error(
                f"task-backlog: cannot validate resolution {task_id} parent card "
                f"at {parent_commit}: {exc}"
            )
            continue
        if task_id in parent_resolutions:
            parent_resolution = parent_resolutions.get(task_id)
            audit.require(
                isinstance(parent_resolution, dict)
                and parent_resolution == resolution,
                f"task-backlog: resolution {task_id} must remain immutable on edge "
                f"{parent_commit}..{commit}",
            )
            if not isinstance(parent_resolution, dict):
                continue
            parent_render = validate_backlog_planning_card_snapshot(
                audit,
                f"task-backlog: resolution {task_id} parent {parent_commit}",
                task_id,
                task_path,
                parent_entry,
                parent_metadata,
                str(parent_resolution.get("state", "")),
                parent_resolution,
                parent_text,
            )
            audit.require(
                parent_metadata == child_metadata,
                f"task-backlog: resolved planning card {task_id} metadata must "
                f"remain immutable on edge {parent_commit}..{commit}",
            )
            audit.require(
                parent_render == child_render,
                f"task-backlog: resolved planning card {task_id} title, fixed "
                f"notice and six-section projection must remain immutable on edge "
                f"{parent_commit}..{commit}",
            )
            continue
        parent_render = validate_backlog_planning_card_snapshot(
            audit,
            f"task-backlog: resolution {task_id} parent {parent_commit}",
            task_id,
            task_path,
            parent_entry,
            parent_metadata,
            "PLANNED",
            None,
            parent_text,
        )
        shared_fields = PLANNED_CARD_FIELDS - {"state"}
        audit.require(
            {field: parent_metadata.get(field) for field in shared_fields}
            == {field: child_metadata.get(field) for field in shared_fields},
            f"task-backlog: resolution {task_id} introduction on edge "
            f"{parent_commit}..{commit} may only add planningResolution and "
            "transition state",
        )
        audit.require(
            parent_render == child_render,
            f"task-backlog: resolution {task_id} introduction on edge "
            f"{parent_commit}..{commit} must preserve the title, fixed notice "
            "and six-section projection",
        )


def validate_backlog_card_history_edge(
    audit: Audit,
    parent_commit: str,
    commit: str,
    parent: dict[str, Any],
    child: dict[str, Any],
    lifecycle: dict[str, Any],
) -> None:
    parent_entries = parent.get("tasks")
    child_entries = child.get("tasks")
    if not isinstance(parent_entries, dict) or not isinstance(child_entries, dict):
        return
    parent_resolutions = parent.get("resolutions")
    child_resolutions = child.get("resolutions")
    parent_resolutions = (
        parent_resolutions if isinstance(parent_resolutions, dict) else {}
    )
    child_resolutions = (
        child_resolutions if isinstance(child_resolutions, dict) else {}
    )
    transitions = lifecycle.get("transitions")
    transitions = transitions if isinstance(transitions, dict) else {}
    for task_id in sorted(set(parent_entries) | set(child_entries)):
        parent_entry = parent_entries.get(task_id)
        child_entry = child_entries.get(task_id)
        if not isinstance(child_entry, dict):
            audit.error(
                f"task-backlog: planning card contract {task_id} was deleted on "
                f"edge {parent_commit}..{commit}"
            )
            continue
        task_path = str(child_entry.get("taskCard", ""))
        if not isinstance(parent_entry, dict):
            if task_id == child.get("bootstrapTask"):
                continue
            child_tree = git_tree_entry(commit, task_path)
            audit.require(
                child_tree is not None and child_tree[:2] == ("100644", "blob"),
                f"task-backlog: introduced card {task_id} must be a regular "
                f"100644 blob at {commit}",
            )
            try:
                child_text = git_object(commit, task_path).decode("utf-8")
                child_metadata = task_metadata_from_text(
                    child_text,
                    f"task-backlog: introduced card {task_id} at {commit}",
                )
                validate_backlog_planning_card_snapshot(
                    audit,
                    f"task-backlog: introduced card {task_id} at {commit}",
                    task_id,
                    task_path,
                    child_entry,
                    child_metadata,
                    "PLANNED",
                    None,
                    child_text,
                )
            except (HarnessError, UnicodeError, yaml.YAMLError) as exc:
                audit.error(
                    f"task-backlog: cannot validate introduced card {task_id} "
                    f"at {commit}: {exc}"
                )
            continue
        parent_task_path = str(parent_entry.get("taskCard", ""))
        audit.require(
            parent_task_path == task_path,
            f"task-backlog: card {task_id} path changed on edge "
            f"{parent_commit}..{commit}",
        )
        parent_tree = git_tree_entry(parent_commit, task_path)
        child_tree = git_tree_entry(commit, task_path)
        if parent_tree == child_tree:
            continue
        audit.require(
            parent_tree is not None and parent_tree[:2] == ("100644", "blob"),
            f"task-backlog: card {task_id} must be a regular 100644 blob at "
            f"{parent_commit}",
        )
        audit.require(
            child_tree is not None and child_tree[:2] == ("100644", "blob"),
            f"task-backlog: card {task_id} must be a regular 100644 blob at {commit}",
        )
        try:
            parent_text = git_object(parent_commit, task_path).decode("utf-8")
            child_text = git_object(commit, task_path).decode("utf-8")
            parent_metadata = task_metadata_from_text(
                parent_text,
                f"task-backlog: card {task_id} parent {parent_commit}",
            )
            child_metadata = task_metadata_from_text(
                child_text,
                f"task-backlog: card {task_id} child {commit}",
            )
        except (HarnessError, UnicodeError, yaml.YAMLError) as exc:
            audit.error(
                f"task-backlog: cannot validate card {task_id} on edge "
                f"{parent_commit}..{commit}: {exc}"
            )
            continue
        parent_state = str(parent_metadata.get("state", ""))
        child_state = str(child_metadata.get("state", ""))
        parent_planning_only = is_planning_only_task(parent_metadata)
        child_planning_only = is_planning_only_task(child_metadata)
        if child_state != parent_state:
            allowed = transitions.get(parent_state, [])
            audit.require(
                isinstance(allowed, list) and child_state in allowed,
                f"task-backlog: invalid card state edge {task_id} "
                f"{parent_state} -> {child_state} at {parent_commit}..{commit}",
            )
        if parent_planning_only != child_planning_only:
            audit.require(
                parent_planning_only
                and parent_state == "PLANNED"
                and not child_planning_only
                and child_state == "DRAFT",
                f"task-backlog: invalid planning/execution classification edge "
                f"{task_id} {parent_state} -> {child_state} at "
                f"{parent_commit}..{commit}",
            )
        audit.require(
            child_state != "SUPERSEDED" or child_planning_only,
            f"task-backlog: execution card {task_id} cannot transition to "
            f"SUPERSEDED at {parent_commit}..{commit}",
        )
        parent_render: dict[str, Any] | None = None
        child_render: dict[str, Any] | None = None
        if parent_planning_only and parent_state == "PLANNED":
            parent_render = validate_backlog_planning_card_snapshot(
                audit,
                f"task-backlog: card {task_id} parent {parent_commit}",
                task_id,
                task_path,
                parent_entry,
                parent_metadata,
                "PLANNED",
                None,
                parent_text,
            )
        elif parent_planning_only and parent_state in PLANNING_TERMINAL_STATES:
            parent_resolution = parent_resolutions.get(task_id)
            parent_render = validate_backlog_planning_card_snapshot(
                audit,
                f"task-backlog: card {task_id} parent {parent_commit}",
                task_id,
                task_path,
                parent_entry,
                parent_metadata,
                parent_state,
                parent_resolution if isinstance(parent_resolution, dict) else None,
                parent_text,
            )
        if child_planning_only and child_state == "PLANNED":
            child_render = validate_backlog_planning_card_snapshot(
                audit,
                f"task-backlog: card {task_id} child {commit}",
                task_id,
                task_path,
                child_entry,
                child_metadata,
                "PLANNED",
                None,
                child_text,
            )
            audit.require(
                parent_state == "PLANNED"
                and parent_metadata == child_metadata,
                f"task-backlog: unresolved PLANNED card {task_id} metadata must "
                f"remain immutable on edge {parent_commit}..{commit}",
            )
        elif child_planning_only and child_state in PLANNING_TERMINAL_STATES:
            child_resolution = child_resolutions.get(task_id)
            child_render = validate_backlog_planning_card_snapshot(
                audit,
                f"task-backlog: card {task_id} child {commit}",
                task_id,
                task_path,
                child_entry,
                child_metadata,
                child_state,
                child_resolution if isinstance(child_resolution, dict) else None,
                child_text,
            )
        if (
            parent_planning_only
            and child_planning_only
            and parent_state in {"PLANNED", *PLANNING_TERMINAL_STATES}
            and child_state in {"PLANNED", *PLANNING_TERMINAL_STATES}
        ):
            audit.require(
                parent_render == child_render,
                f"task-backlog: planning card {task_id} title, fixed notice and "
                f"six-section projection changed on edge {parent_commit}..{commit}",
            )


def derive_immutable_backlog_history_policy(
    audit: Audit,
    current_lifecycle: dict[str, Any],
) -> dict[str, Any]:
    history = git_text(
        "rev-list",
        "--parents",
        "--topo-order",
        "--reverse",
        "HEAD",
    ).stdout.splitlines()
    snapshots: dict[str, dict[str, Any] | None] = {}
    introductions: list[tuple[str, dict[str, Any]]] = []

    def snapshot(commit: str) -> dict[str, Any] | None:
        if commit in snapshots:
            return snapshots[commit]
        if git_tree_entry(commit, ".harness/task-lifecycle.yaml") is None:
            snapshots[commit] = None
            return None
        lifecycle = yaml_at_commit(commit, ".harness/task-lifecycle.yaml")
        rules = lifecycle.get("rules")
        raw = rules.get("backlogHistoryPolicy") if isinstance(rules, dict) else None
        value = dict(raw) if isinstance(raw, dict) else None
        snapshots[commit] = value
        return value

    for graph_line in history:
        tokens = graph_line.split()
        if not tokens:
            continue
        commit = tokens[0]
        parents = tokens[1:]
        child = snapshot(commit)
        parent_values = [(parent, snapshot(parent)) for parent in parents]
        inherited = [value for _, value in parent_values if value is not None]
        if child is None:
            for parent, parent_value in parent_values:
                audit.require(
                    parent_value is None,
                    "task-backlog: backlogHistoryPolicy was deleted on edge "
                    f"{parent}..{commit}",
                )
            continue
        if not inherited:
            audit.require(
                len(parents) == 1,
                "task-backlog: backlogHistoryPolicy must be introduced by one "
                f"single-parent commit; commit={commit}",
            )
            introductions.append((commit, child))
        for parent, parent_value in parent_values:
            if parent_value is not None:
                audit.require(
                    child == parent_value,
                    "task-backlog: backlogHistoryPolicy is append-only and immutable "
                    f"on edge {parent}..{commit}",
                )

    audit.require(
        len(introductions) == 1,
        "task-backlog: backlogHistoryPolicy must have exactly one historical "
        f"introduction; introductions={[commit for commit, _ in introductions]}",
    )
    introduced = introductions[0][1] if len(introductions) == 1 else {}
    rules = current_lifecycle.get("rules")
    current = rules.get("backlogHistoryPolicy") if isinstance(rules, dict) else None
    audit.require(
        current == introduced,
        "task-backlog: HEAD..WORKTREE backlogHistoryPolicy must equal its first "
        "committed projection",
    )
    return introduced


def validate_task_backlog_history(
    audit: Audit,
    current: dict[str, Any],
    lifecycle: dict[str, Any],
) -> None:
    policy = derive_immutable_backlog_history_policy(audit, lifecycle)
    audit.require(
        isinstance(policy, dict)
        and set(policy) == {"activationCommit", "mode"},
        "task-backlog: lifecycle rules must declare the exact backlogHistoryPolicy",
    )
    activation = (
        str(policy.get("activationCommit", "")) if isinstance(policy, dict) else ""
    )
    audit.require(
        bool(FULL_COMMIT_RE.fullmatch(activation)),
        "task-backlog: backlogHistoryPolicy.activationCommit must be a full Git SHA",
    )
    audit.require(
        isinstance(policy, dict)
        and policy.get("mode")
        == "VALIDATE_ACTIVATION_SNAPSHOT_THEN_ALL_PARENT_EDGES",
        "task-backlog: backlogHistoryPolicy.mode is unsupported",
    )
    ancestry = git_text(
        "merge-base",
        "--is-ancestor",
        activation,
        "HEAD",
        check=False,
    )
    audit.require(
        ancestry.returncode == 0,
        "task-backlog: backlogHistoryPolicy.activationCommit must be an ancestor "
        "of HEAD",
    )
    history_tail = git_text(
        "rev-list",
        "--parents",
        "--topo-order",
        "--reverse",
        "--ancestry-path",
        f"{activation}..HEAD",
    ).stdout.splitlines()
    history = [activation, *history_tail] if ancestry.returncode == 0 else []
    introductions: set[str] = set()
    snapshots: dict[str, dict[str, Any]] = {}

    def snapshot(commit: str) -> dict[str, Any] | None:
        if commit in snapshots:
            return snapshots[commit]
        if git_tree_entry(commit, TASK_BACKLOG_PATH) is None:
            return None
        value = yaml_at_commit(commit, TASK_BACKLOG_PATH)
        snapshots[commit] = value
        return value

    for graph_line in history:
        tokens = graph_line.split()
        if not tokens:
            continue
        commit = tokens[0]
        child = snapshot(commit)
        parents = tokens[1:]
        parent_values = [(parent, snapshot(parent)) for parent in parents]
        if child is not None and (
            not parent_values or all(value is None for _, value in parent_values)
        ):
            introductions.add(commit)
            empty_backlog = {
                "tasks": {},
                "executionOrder": [],
                "criticalPath": [],
                "decisionGates": {},
                "resolutions": {},
                "authorizationAmendments": {},
            }
            validate_backlog_authorization_amendment_edge(
                audit,
                empty_backlog,
                child,
                f"<absent>..{commit}",
            )
            validate_backlog_card_history_edge(
                audit,
                commit,
                commit,
                empty_backlog,
                child,
                lifecycle,
            )
            validate_backlog_history_edge(
                audit,
                empty_backlog,
                child,
                f"<absent>..{commit}",
            )
        for parent, parent_value in parent_values:
            if parent_value is None:
                continue
            audit.require(
                child is not None,
                f"task-backlog: {TASK_BACKLOG_PATH} was deleted on edge "
                f"{parent}..{commit}",
            )
            if child is not None:
                validate_backlog_resolution_commit(
                    audit,
                    parent,
                    commit,
                    parent_value,
                    child,
                )
                validate_backlog_authorization_amendment_edge(
                    audit,
                    parent_value,
                    child,
                    f"{parent}..{commit}",
                )
            if child is not None:
                validate_backlog_card_history_edge(
                    audit,
                    parent,
                    commit,
                    parent_value,
                    child,
                    lifecycle,
                )
                validate_backlog_history_edge(
                    audit,
                    parent_value,
                    child,
                    f"{parent}..{commit}",
                )
    audit.require(
        len(introductions) <= 1,
        f"task-backlog: multiple independent introductions are not allowed: "
        f"{sorted(introductions)}",
    )
    head = snapshot("HEAD")
    if head is not None:
        audit.require(
            current.get("authorizationAmendments")
            == head.get("authorizationAmendments"),
            "task-backlog: HEAD..WORKTREE cannot introduce or rewrite "
            "authorizationAmendments; commit the single-parent governance "
            "amendment before it can authorize later work",
        )
    if head is not None:
        validate_backlog_history_edge(
            audit,
            head,
            current,
            "HEAD..WORKTREE",
        )


def derive_backlog_promotion_projection(
    backlog: dict[str, Any],
    tasks: dict[str, dict[str, Any]],
    lifecycle: dict[str, Any],
    *,
    draft_candidate: str | None = None,
) -> dict[str, Any]:
    entries = backlog.get("tasks")
    entries = entries if isinstance(entries, dict) else {}
    execution_order = backlog.get("executionOrder")
    execution_order = (
        [str(item) for item in execution_order]
        if isinstance(execution_order, list)
        else []
    )
    gates = backlog.get("decisionGates")
    gates = gates if isinstance(gates, dict) else {}
    resolutions = backlog.get("resolutions")
    resolutions = resolutions if isinstance(resolutions, dict) else {}
    active_states = set(str(item) for item in lifecycle.get("activeStates", []))
    repository_idle = not any(
        task_id != draft_candidate
        and (
            task.get("state") in active_states
            or task.get("state") == "DRAFT"
        )
        for task_id, task in tasks.items()
    )

    blockers: dict[str, list[str]] = {}
    promotable: list[str] = []
    planned_count = 0
    for task_id in execution_order:
        task = tasks.get(task_id)
        state = str(task.get("state", "")) if task is not None else "MISSING"
        is_candidate = state == "PLANNED" or (
            draft_candidate == task_id and state == "DRAFT"
        )
        if not is_candidate:
            continue
        if state == "PLANNED":
            planned_count += 1
        entry = entries.get(task_id)
        entry = entry if isinstance(entry, dict) else {}
        conditions = entry.get("promotionConditions")
        conditions = conditions if isinstance(conditions, dict) else {}
        task_blockers: list[str] = []
        if task_id in resolutions:
            resolution = resolutions[task_id]
            task_blockers.append(
                f"RESOLVED:{resolution.get('state') if isinstance(resolution, dict) else 'INVALID'}"
            )
        if conditions.get("requiresAcceptedDependencies") is True:
            dependencies = entry.get("dependencies")
            dependencies = dependencies if isinstance(dependencies, list) else []
            for dependency in dependencies:
                dependency_id = str(dependency)
                dependency_task = tasks.get(dependency_id)
                dependency_state = (
                    str(dependency_task.get("state", "MISSING"))
                    if dependency_task is not None
                    else "MISSING"
                )
                if dependency_state != "ACCEPTED":
                    task_blockers.append(
                        f"DEPENDENCY:{dependency_id}:{dependency_state}"
                    )
        if conditions.get("requiresApprovedDecisionGates") is True:
            task_gates = entry.get("decisionGates")
            task_gates = task_gates if isinstance(task_gates, list) else []
            for gate_value in task_gates:
                gate_id = str(gate_value)
                gate = gates.get(gate_id)
                gate_status = (
                    str(gate.get("status", "MISSING"))
                    if isinstance(gate, dict)
                    else "MISSING"
                )
                if gate_status != "APPROVED":
                    task_blockers.append(
                        f"DECISION_GATE:{gate_id}:{gate_status}"
                    )
        if (
            conditions.get("requiresRepositoryIdle") is True
            and not repository_idle
        ):
            task_blockers.append("REPOSITORY_NOT_IDLE")
        blockers[task_id] = task_blockers
        if not task_blockers:
            promotable.append(task_id)

    next_promotable = promotable[0] if promotable else None
    for task_id in promotable[1:]:
        entry = entries.get(task_id)
        conditions = (
            entry.get("promotionConditions")
            if isinstance(entry, dict)
            else None
        )
        if (
            isinstance(conditions, dict)
            and conditions.get("requiresFirstByExecutionOrder") is True
        ):
            blockers[task_id].append(
                f"WAITING_FOR_ORDER:{next_promotable}"
            )

    return {
        "plannedCount": planned_count,
        "nextPromotable": next_promotable,
        "blockers": blockers,
        "repositoryIdle": repository_idle,
    }


def task_snapshot_at_commit(
    audit: Audit,
    commit: str,
    tasks: dict[str, dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    snapshot: dict[str, dict[str, Any]] = {}
    for task_id, task in tasks.items():
        path = str(task.get("_path", ""))
        if not is_repository_relative(path):
            continue
        try:
            entry = git_tree_entry(commit, path)
            if entry is None:
                continue
            audit.require(
                entry[:2] == ("100644", "blob"),
                f"{task_id}: historical task card at {commit} must be a regular "
                "100644 blob",
            )
            metadata = task_metadata_at_commit(commit, path)
            metadata["_path"] = path
            snapshot[task_id] = metadata
        except (HarnessError, UnicodeError, yaml.YAMLError) as exc:
            audit.error(
                f"{task_id}: cannot load task snapshot at {commit}: {exc}"
            )
    return snapshot


def validate_backlog_draft_promotion_at_base(
    audit: Audit,
    task: dict[str, Any],
    tasks: dict[str, dict[str, Any]],
    lifecycle: dict[str, Any],
) -> None:
    task_id = str(task.get("taskId", ""))
    base_commit = str(task.get("baseCommit", ""))
    try:
        backlog = yaml_at_commit(base_commit, TASK_BACKLOG_PATH)
        state = yaml_at_commit(base_commit, PROJECT_STATE_PATH)
        base_tasks = task_snapshot_at_commit(audit, base_commit, tasks)
        planned = base_tasks.get(task_id)
        audit.require(
            planned is not None and planned.get("state") == "PLANNED",
            f"{task_id}: backlog-managed DRAFT must be PLANNED at Base Commit",
        )
        projection = validate_task_backlog_data(
            audit,
            backlog,
            base_tasks,
            lifecycle,
            state,
        )
        blockers = projection.get("blockers")
        blockers = blockers if isinstance(blockers, dict) else {}
        candidate_blockers = blockers.get(task_id)
        candidate_blockers = (
            candidate_blockers
            if isinstance(candidate_blockers, list)
            else ["MISSING_FROM_PROMOTION_PROJECTION"]
        )
        audit.require(
            projection.get("nextPromotable") == task_id
            and not candidate_blockers,
            f"{task_id}: DRAFT promotion bypasses Backlog order, dependencies or "
            f"decision gates at Base Commit; next={projection.get('nextPromotable')!r}, "
            f"blockers={candidate_blockers}",
        )
    except (HarnessError, OSError, UnicodeError, yaml.YAMLError) as exc:
        audit.error(
            f"{task_id}: cannot reconstruct Backlog promotion at Base Commit: {exc}"
        )


def validate_task_backlog_data(
    audit: Audit,
    backlog: dict[str, Any],
    tasks: dict[str, dict[str, Any]],
    lifecycle: dict[str, Any],
    state: dict[str, Any],
) -> dict[str, Any]:
    audit.require(
        set(backlog) == BACKLOG_ROOT_FIELDS,
        f"task-backlog: root fields must be exactly {sorted(BACKLOG_ROOT_FIELDS)}",
    )
    audit.require(
        backlog.get("schemaVersion") == 1,
        "task-backlog: unsupported schemaVersion",
    )
    audit.require(
        backlog.get("backlogId") == "technical-alpha",
        "task-backlog: backlogId must be technical-alpha",
    )
    audit.require(
        backlog.get("phase") == state.get("phase") == "TECHNICAL_ALPHA",
        "task-backlog: phase must match the current TECHNICAL_ALPHA project state",
    )
    audit.require(
        backlog.get("planningContractHashAlgorithm")
        == PLANNING_CONTRACT_HASH_ALGORITHM,
        "task-backlog: unsupported planning contract hash algorithm",
    )

    authority = backlog.get("authority")
    audit.require(
        isinstance(authority, dict)
        and set(authority) == {"owns", "taskCardsAreHashBoundProjections"},
        "task-backlog: authority fields are invalid",
    )
    if isinstance(authority, dict):
        audit.require(
            authority.get("owns")
            == [
                "executionOrder",
                "dependencies",
                "criticalPath",
                "decisionGates",
                "promotionConditions",
                "authorizationAmendments",
            ],
            "task-backlog: authority must own the complete planning decision set",
        )
        audit.require(
            authority.get("taskCardsAreHashBoundProjections") is True,
            "task-backlog: task cards must be hash-bound projections",
        )

    rules = backlog.get("rules")
    audit.require(isinstance(rules, dict), "task-backlog: rules must be an object")
    rules = rules if isinstance(rules, dict) else {}
    lifecycle_rules = lifecycle.get("rules")
    lifecycle_rules = lifecycle_rules if isinstance(lifecycle_rules, dict) else {}
    active_states = set(str(item) for item in lifecycle.get("activeStates", []))
    terminal_states = set(str(item) for item in lifecycle.get("terminalStates", []))
    transitions = lifecycle.get("transitions")
    transitions = transitions if isinstance(transitions, dict) else {}
    audit.require(
        rules.get("plannedState") == "PLANNED"
        and "PLANNED" in set(str(item) for item in lifecycle.get("states", [])),
        "task-backlog: PLANNED state must exist in the lifecycle",
    )
    audit.require(
        rules.get("plannedConsumesActiveTask") is False
        and lifecycle_rules.get("plannedConsumesActiveTask") is False
        and "PLANNED" not in active_states,
        "task-backlog: PLANNED must not consume activeTask",
    )
    audit.require(
        lifecycle_rules.get("plannedRequiresBacklogEntry") is True,
        "task-backlog: lifecycle must require every PLANNED card to belong "
        "to the canonical Backlog",
    )
    audit.require(
        rules.get("maximumPendingDraftTasks")
        == lifecycle_rules.get("maximumPendingDraftTasks")
        == 1,
        "task-backlog: maximumPendingDraftTasks must be one",
    )
    audit.require(
        rules.get("maximumActiveTasks")
        == lifecycle_rules.get("maximumActiveTasks")
        == 1,
        "task-backlog: maximumActiveTasks must be one",
    )
    audit.require(
        rules.get("idPolicy") == "PERMANENT_NEVER_REUSE",
        "task-backlog: Task IDs must be permanently reserved",
    )
    cancellation_states = validate_nonblank_string_list(
        audit,
        "task-backlog.rules.cancellationStates",
        rules.get("cancellationStates"),
    )
    audit.require(
        set(cancellation_states) == {"REJECTED", "SUPERSEDED"}
        and set(cancellation_states) <= terminal_states,
        "task-backlog: cancellation states must be terminal REJECTED/SUPERSEDED",
    )
    audit.require(
        rules.get("cancellationReasonRequired") is True,
        "task-backlog: cancellation reasons must be required",
    )
    audit.require(
        rules.get("plannedResolutionRegistry") == "resolutions",
        "task-backlog: PLANNED cancellation must use the append-only resolutions registry",
    )
    audit.require(
        set(str(item) for item in transitions.get("PLANNED", []))
        == {"DRAFT", "REJECTED", "SUPERSEDED"},
        "task-backlog: PLANNED must support DRAFT promotion and preserved "
        "REJECTED/SUPERSEDED planning resolution",
    )
    audit.require(
        all(
            "SUPERSEDED" not in set(str(item) for item in targets)
            for source, targets in transitions.items()
            if source != "PLANNED" and isinstance(targets, list)
        ),
        "task-backlog: SUPERSEDED must be reachable only from planning-only "
        "PLANNED cards",
    )
    audit.require(
        set(lifecycle_rules.get("planningTerminalStates", []))
        == PLANNING_TERMINAL_STATES
        and lifecycle_rules.get("planningTerminalRequiresBacklogResolution")
        is True
        and lifecycle_rules.get("planningTerminalConsumesTaskLedger") is False,
        "task-backlog: lifecycle planning-terminal semantics are incomplete",
    )
    audit.require(
        lifecycle_rules.get("authorizationAmendments")
        == {
            "machineSource": TASK_BACKLOG_PATH,
            "taskCardProjectionField": "scopeAmendments",
            "approvedBy": "repository-owner",
            "singleParentAtomicCommitRequired": True,
            "uncommittedAuthorizationForbidden": True,
            "appendOnlyAndImmutable": True,
            "explicitClauseReplacementRequired": True,
            "canonicalExactPosixPathsRequired": True,
            "forbiddenPathsAlwaysWins": True,
        },
        "task-backlog: lifecycle Owner amendment semantics are incomplete",
    )
    promotion = rules.get("promotion")
    audit.require(
        isinstance(promotion, dict),
        "task-backlog: promotion must be an object",
    )
    promotion = promotion if isinstance(promotion, dict) else {}
    audit.require(
        promotion.get("from") == "PLANNED"
        and promotion.get("to") == "DRAFT"
        and promotion.get("selection")
        == "FIRST_PROMOTABLE_BY_EXECUTION_ORDER"
        and promotion.get("requiresRepositoryIdle") is True
        and promotion.get("requiresAllDependenciesAccepted") is True
        and promotion.get("requiresAllDecisionGatesApproved") is True
        and promotion.get("dynamicEvidenceBoundAt") == "DRAFT",
        "task-backlog: promotion semantics drift from the governed PLANNED contract",
    )
    forbidden_dynamic = validate_nonblank_string_list(
        audit,
        "task-backlog.rules.promotion.forbiddenDynamicFieldsWhilePlanned",
        promotion.get("forbiddenDynamicFieldsWhilePlanned"),
    )
    audit.require(
        {
            "baseCommit",
            "authorizationCommit",
            "contextFingerprint",
            "contextLock",
            "requiredCommands",
            "requiredSkillVersions",
        }
        <= set(forbidden_dynamic),
        "task-backlog: PLANNED must forbid all volatile execution evidence",
    )

    boundary = backlog.get("technicalAlphaBoundary")
    audit.require(
        isinstance(boundary, dict),
        "task-backlog: technicalAlphaBoundary must be an object",
    )
    boundary = boundary if isinstance(boundary, dict) else {}
    forbidden_capabilities = validate_nonblank_string_list(
        audit,
        "task-backlog.technicalAlphaBoundary.forbiddenCapabilities",
        boundary.get("forbiddenCapabilities"),
    )
    audit.require(
        {
            "PUBLIC_REGISTRATION",
            "REAL_PAYMENT",
            "ROMANCE_MODE",
            "VOICE",
            "IMAGE",
            "WEBSOCKET",
            "PROACTIVE_MESSAGES",
            "MULTI_ROLE",
            "SECOND_LIVE_PROVIDER",
            "BETA",
        }
        <= set(forbidden_capabilities),
        "task-backlog: Technical Alpha forbidden capability boundary is incomplete",
    )
    outbound = boundary.get("outboundPolicy")
    audit.require(
        isinstance(outbound, dict)
        and outbound.get("beforeTask") == "TASK-0035"
        and outbound.get("realProviderAccess") == "FORBIDDEN"
        and outbound.get("realCredentialRead") == "FORBIDDEN",
        "task-backlog: real outbound must remain forbidden before TASK-0035",
    )
    if isinstance(outbound, dict):
        allowed_outbound = validate_nonblank_string_list(
            audit,
            "task-backlog.technicalAlphaBoundary.outboundPolicy.allowed",
            outbound.get("allowed"),
        )
        audit.require(
            set(allowed_outbound)
            == {
                "FAKE",
                "FAILURE",
                "SYNTHETIC_RECORDS",
                "LOOPBACK_127_0_0_1",
            },
            "task-backlog: pre-live outbound allowlist must remain offline-only",
        )
    audit.require(
        boundary.get("liveProviderLimit") == 1,
        "task-backlog: Technical Alpha permits at most one live provider",
    )

    test_policies = backlog.get("testPolicies")
    audit.require(
        isinstance(test_policies, dict)
        and set(test_policies) == {"java", "database"},
        "task-backlog: testPolicies must define java and database",
    )
    if isinstance(test_policies, dict):
        java_policy = test_policies.get("java")
        database_policy = test_policies.get("database")
        audit.require(
            isinstance(java_policy, dict)
            and java_policy.get("distribution") == "Temurin"
            and java_policy.get("versionSource") == ".harness/tools.lock.yaml"
            and java_policy.get("localValidationHomeRequired") is True
            and java_policy.get("modifySystemJava") is False,
            "task-backlog: Java validation must use the locked Temurin baseline "
            "without modifying system Java",
        )
        audit.require(
            isinstance(database_policy, dict)
            and database_policy.get("firstApplicableTask") == "TASK-0015"
            and database_policy.get("runtime") == "WSL2_DOCKER"
            and database_policy.get("engine")
            == "POSTGRESQL_18_WITH_PGVECTOR"
            and database_policy.get("data") == "SYNTHETIC_ONLY"
            and database_policy.get("network") == "TEMPORARY_PORT_ONLY"
            and database_policy.get("storage") == "TEMPORARY_VOLUME_ONLY"
            and database_policy.get("cleanupRequired") is True
            and database_policy.get("imageVersionAndDigestBoundAtTaskDraft")
            is True,
            "task-backlog: database test policy must remain disposable, synthetic "
            "and dynamically pinned",
        )
        if isinstance(database_policy, dict):
            forbidden_services = validate_nonblank_string_list(
                audit,
                "task-backlog.testPolicies.database.forbiddenExistingServices",
                database_policy.get("forbiddenExistingServices"),
            )
            audit.require(
                set(forbidden_services)
                == {"MYSQL", "REDIS", "RABBITMQ", "KINGBASE"},
                "task-backlog: existing local data services must remain forbidden",
            )

    entries = backlog.get("tasks")
    audit.require(isinstance(entries, dict), "task-backlog: tasks must be an object")
    entries = entries if isinstance(entries, dict) else {}
    validate_backlog_authorization_amendments(
        audit,
        backlog.get("authorizationAmendments"),
        tasks,
    )
    execution_order = validate_nonblank_string_list(
        audit,
        "task-backlog.executionOrder",
        backlog.get("executionOrder"),
    )
    audit.require(
        set(execution_order) == set(entries)
        and len(execution_order) == len(entries),
        "task-backlog: executionOrder must contain every task exactly once",
    )
    bootstrap_task = str(backlog.get("bootstrapTask", ""))
    audit.require(
        bool(execution_order) and bootstrap_task == execution_order[0],
        "task-backlog: bootstrapTask must be first in executionOrder",
    )
    order_index = {
        task_id: index
        for index, task_id in enumerate(execution_order)
    }
    backlog_bound_task_ids = {
        task_id
        for task_id, task in tasks.items()
        if task.get("planningBacklog") == TASK_BACKLOG_PATH
    }
    unregistered_backlog_tasks = sorted(
        backlog_bound_task_ids - set(entries)
    )
    audit.require(
        not unregistered_backlog_tasks,
        "task-backlog: every PLANNED or promoted Backlog-bound card must have "
        f"exactly one canonical entry; unregistered={unregistered_backlog_tasks}",
    )
    planning_only_task_ids = {
        task_id
        for task_id, task in tasks.items()
        if is_planning_only_task(task)
    }
    audit.require(
        planning_only_task_ids <= set(entries),
        "task-backlog: planning-only cards exist outside the canonical Backlog: "
        f"{sorted(planning_only_task_ids - set(entries))}",
    )

    gates = backlog.get("decisionGates")
    audit.require(
        isinstance(gates, dict),
        "task-backlog: decisionGates must be an object",
    )
    gates = gates if isinstance(gates, dict) else {}
    gate_requirements: dict[str, set[str]] = {}
    for gate_id, raw_gate in gates.items():
        label = f"task-backlog.decisionGates.{gate_id}"
        audit.require(
            bool(re.fullmatch(r"GATE-[A-Z0-9-]+", str(gate_id))),
            f"{label}: invalid gate ID",
        )
        audit.require(isinstance(raw_gate, dict), f"{label}: must be an object")
        if not isinstance(raw_gate, dict):
            continue
        audit.require(
            set(raw_gate) == BACKLOG_GATE_FIELDS,
            f"{label}: fields must be exactly {sorted(BACKLOG_GATE_FIELDS)}",
        )
        audit.require(
            raw_gate.get("kind") == "HARD_OWNER_DECISION",
            f"{label}: kind must be HARD_OWNER_DECISION",
        )
        status = str(raw_gate.get("status", ""))
        audit.require(
            status in {"PENDING", "APPROVED", "REJECTED"},
            f"{label}: invalid status {status!r}",
        )
        required_for = validate_nonblank_string_list(
            audit,
            f"{label}.requiredFor",
            raw_gate.get("requiredFor"),
        )
        gate_requirements[str(gate_id)] = set(required_for)
        required_decisions = validate_nonblank_string_list(
            audit,
            f"{label}.requiredDecisions",
            raw_gate.get("requiredDecisions"),
        )
        approval = raw_gate.get("approval")
        if status == "PENDING":
            audit.require(
                approval is None,
                f"{label}: PENDING gate must not fabricate approval",
            )
        else:
            audit.require(
                isinstance(approval, dict)
                and set(approval) == BACKLOG_GATE_APPROVAL_FIELDS,
                f"{label}: decided gate requires Owner evidence for every "
                "required decision",
            )
            if isinstance(approval, dict):
                audit.require(
                    approval.get("approvedBy") == "repository-owner",
                    f"{label}.approval.approvedBy must be repository-owner",
                )
                audit.require(
                    is_valid_approval_timestamp(approval.get("approvedAt")),
                    f"{label}.approval.approvedAt must be ISO-8601",
                )
                validate_nonblank_text(
                    audit,
                    f"{label}.approval.evidence",
                    approval.get("evidence"),
                )
                decision_evidence = approval.get("decisionEvidence")
                audit.require(
                    isinstance(decision_evidence, dict)
                    and set(decision_evidence) == set(required_decisions),
                    f"{label}.approval.decisionEvidence must cover every "
                    "requiredDecision exactly",
                )
                if isinstance(decision_evidence, dict):
                    for decision in required_decisions:
                        decision_record = decision_evidence.get(decision)
                        audit.require(
                            isinstance(decision_record, dict)
                            and set(decision_record)
                            == BACKLOG_GATE_DECISION_EVIDENCE_FIELDS,
                            f"{label}.approval.decisionEvidence[{decision!r}] "
                            "must record value and evidence",
                        )
                        if isinstance(decision_record, dict):
                            for field in sorted(
                                BACKLOG_GATE_DECISION_EVIDENCE_FIELDS
                            ):
                                validate_nonblank_text(
                                    audit,
                                    f"{label}.approval.decisionEvidence"
                                    f"[{decision!r}].{field}",
                                    decision_record.get(field),
                                )

    titles: set[str] = set()
    dependencies_by_task: dict[str, list[str]] = {}
    gates_by_task: dict[str, list[str]] = {}
    for task_id, raw_entry in entries.items():
        label = f"task-backlog.tasks.{task_id}"
        audit.require(
            bool(TASK_ID_RE.fullmatch(str(task_id))),
            f"{label}: invalid task ID",
        )
        audit.require(isinstance(raw_entry, dict), f"{label}: must be an object")
        if not isinstance(raw_entry, dict):
            continue
        audit.require(
            set(raw_entry) == BACKLOG_TASK_FIELDS,
            f"{label}: fields must be exactly {sorted(BACKLOG_TASK_FIELDS)}",
        )
        title = str(raw_entry.get("title", ""))
        validate_nonblank_text(audit, f"{label}.title", raw_entry.get("title"))
        audit.require(
            title not in titles,
            f"{label}: task title is already permanently reserved",
        )
        titles.add(title)
        task_card = str(raw_entry.get("taskCard", ""))
        audit.require(
            is_repository_relative(task_card),
            f"{label}.taskCard must be repository-relative",
        )
        discovered = tasks.get(str(task_id))
        audit.require(discovered is not None, f"{label}: task card is missing")
        if discovered is not None:
            audit.require(
                discovered.get("_path") == task_card,
                f"{label}: taskCard disagrees with discovered card",
            )
            try:
                heading = f"# {task_id}：{title}\n"
                card_text = read_repository_text(ROOT / task_card)
                audit.require(
                    card_text.startswith(heading),
                    f"{label}: task card heading must preserve the reserved ID/title",
                )
                if is_planning_only_task(discovered):
                    planned_card_render_projection(
                        audit,
                        label,
                        str(task_id),
                        raw_entry,
                        card_text,
                    )
            except (OSError, UnicodeError) as exc:
                audit.error(f"{label}: cannot read task card heading: {exc}")

        dependencies = validate_nonblank_string_list(
            audit,
            f"{label}.dependencies",
            raw_entry.get("dependencies"),
        )
        dependencies_by_task[str(task_id)] = dependencies
        for dependency in dependencies:
            audit.require(
                dependency != task_id,
                f"{label}: task cannot depend on itself",
            )
            audit.require(
                dependency in tasks,
                f"{label}: unknown dependency {dependency}",
            )
            if dependency in order_index and task_id in order_index:
                audit.require(
                    order_index[dependency] < order_index[task_id],
                    f"{label}: dependency {dependency} must precede the task in "
                    "executionOrder",
                )

        task_gates = validate_nonblank_string_list(
            audit,
            f"{label}.decisionGates",
            raw_entry.get("decisionGates"),
            allow_empty=True,
        )
        gates_by_task[str(task_id)] = task_gates
        for gate_id in task_gates:
            audit.require(
                gate_id in gates,
                f"{label}: unknown decision gate {gate_id}",
            )
        validate_nonblank_text(
            audit,
            f"{label}.objective",
            raw_entry.get("objective"),
        )
        scope = raw_entry.get("scope")
        audit.require(
            isinstance(scope, dict) and set(scope) == {"in", "out"},
            f"{label}.scope must define in and out",
        )
        if isinstance(scope, dict):
            validate_nonblank_string_list(
                audit,
                f"{label}.scope.in",
                scope.get("in"),
            )
            validate_nonblank_string_list(
                audit,
                f"{label}.scope.out",
                scope.get("out"),
            )
        for field in ("forbidden", "acceptanceCriteria"):
            validate_nonblank_string_list(
                audit,
                f"{label}.{field}",
                raw_entry.get(field),
            )
        promotion_conditions = raw_entry.get("promotionConditions")
        audit.require(
            isinstance(promotion_conditions, dict)
            and set(promotion_conditions)
            == BACKLOG_PROMOTION_CONDITION_FIELDS,
            f"{label}.promotionConditions must be the executable condition "
            f"object {sorted(BACKLOG_PROMOTION_CONDITION_FIELDS)}",
        )
        if isinstance(promotion_conditions, dict):
            for field in sorted(BACKLOG_PROMOTION_CONDITION_FIELDS):
                audit.require(
                    promotion_conditions.get(field) is True,
                    f"{label}.promotionConditions.{field} must be true",
                )

        if discovered is None:
            continue
        expected_hash = canonical_json_sha256(raw_entry)
        if is_planning_only_task(discovered):
            validate_planned_task_metadata(
                audit,
                str(task_id),
                discovered,
            )
            audit.require(
                discovered.get("planningContractHash") == expected_hash,
                f"{label}: PLANNED card hash drifts from the Backlog contract",
            )
        elif task_id != bootstrap_task:
            audit.require(
                discovered.get("planningBacklog") == TASK_BACKLOG_PATH
                and discovered.get("planningContractHash") == expected_hash
                and discovered.get("planningContractHashAlgorithm")
                == PLANNING_CONTRACT_HASH_ALGORITHM,
                f"{label}: promoted task must retain its PLANNED contract binding",
            )
        if (
            discovered.get("state") in {"REJECTED", "SUPERSEDED"}
            and not is_planning_only_task(discovered)
        ):
            validate_nonblank_text(
                audit,
                f"{label}.resolutionReason",
                discovered.get("resolutionReason"),
            )

    for gate_id, required_for in gate_requirements.items():
        actual = {
            task_id
            for task_id, task_gates in gates_by_task.items()
            if gate_id in task_gates
        }
        audit.require(
            required_for == actual,
            f"task-backlog: gate {gate_id} requiredFor disagrees with task references",
        )

    critical_path = validate_nonblank_string_list(
        audit,
        "task-backlog.criticalPath",
        backlog.get("criticalPath"),
    )
    audit.require(
        bool(critical_path)
        and bool(execution_order)
        and critical_path[0] == execution_order[0]
        and critical_path[-1] == execution_order[-1],
        "task-backlog: criticalPath must span the first through final execution task",
    )
    for previous, current in zip(critical_path, critical_path[1:]):
        audit.require(
            previous in dependencies_by_task.get(current, []),
            f"task-backlog: criticalPath edge {previous} -> {current} is not a "
            "declared dependency",
        )
    longest_lengths: dict[str, int] = {}
    for task_id in execution_order:
        internal_dependencies = [
            dependency
            for dependency in dependencies_by_task.get(task_id, [])
            if dependency in longest_lengths
        ]
        longest_lengths[task_id] = 1 + max(
            (longest_lengths[dependency] for dependency in internal_dependencies),
            default=0,
        )
    audit.require(
        bool(longest_lengths)
        and len(critical_path) == max(longest_lengths.values()),
        "task-backlog: declared criticalPath is not a longest dependency path",
    )

    resolutions = backlog.get("resolutions")
    audit.require(
        isinstance(resolutions, dict),
        "task-backlog: resolutions must be an object",
    )
    resolutions = resolutions if isinstance(resolutions, dict) else {}
    for task_id, raw_resolution in resolutions.items():
        label = f"task-backlog.resolutions.{task_id}"
        audit.require(task_id in entries, f"{label}: unknown reserved Task ID")
        audit.require(
            isinstance(raw_resolution, dict),
            f"{label}: must be an object",
        )
        if not isinstance(raw_resolution, dict):
            continue
        audit.require(
            set(raw_resolution) == BACKLOG_RESOLUTION_FIELDS,
            f"{label}: fields must be exactly {sorted(BACKLOG_RESOLUTION_FIELDS)}",
        )
        resolution_state = str(raw_resolution.get("state", ""))
        audit.require(
            resolution_state in {"REJECTED", "SUPERSEDED"},
            f"{label}: state must be REJECTED or SUPERSEDED",
        )
        validate_nonblank_text(
            audit,
            f"{label}.reason",
            raw_resolution.get("reason"),
        )
        audit.require(
            is_canonical_identity(raw_resolution.get("decidedBy")),
            f"{label}.decidedBy must be canonical",
        )
        audit.require(
            is_valid_approval_timestamp(raw_resolution.get("decidedAt")),
            f"{label}.decidedAt must be ISO-8601",
        )
        replacement = raw_resolution.get("replacementTask")
        if resolution_state == "SUPERSEDED":
            audit.require(
                isinstance(replacement, str)
                and replacement in entries
                and replacement != task_id,
                f"{label}: SUPERSEDED requires a distinct permanently reserved "
                "replacementTask",
            )
        else:
            audit.require(
                replacement is None,
                f"{label}: REJECTED must not declare a replacementTask",
            )

    planning_terminal_ids = {
        task_id
        for task_id, task in tasks.items()
        if is_planning_only_task(task)
        and task.get("state") in PLANNING_TERMINAL_STATES
    }
    audit.require(
        set(resolutions) == planning_terminal_ids,
        "task-backlog: planning terminal cards and append-only resolutions "
        f"must match exactly (cards={sorted(planning_terminal_ids)}, "
        f"resolutions={sorted(resolutions)})",
    )
    for task_id in sorted(planning_terminal_ids & set(resolutions)):
        task = tasks[task_id]
        resolution = resolutions[task_id]
        audit.require(
            task.get("state") == resolution.get("state")
            and task.get("planningResolution") == resolution,
            f"task-backlog: planning terminal card {task_id} must project its "
            "resolution exactly",
        )

    projection = derive_backlog_promotion_projection(
        backlog,
        tasks,
        lifecycle,
    )
    repository_idle = bool(projection.get("repositoryIdle"))
    next_promotable = projection.get("nextPromotable")
    if repository_idle and next_promotable:
        audit.require(
            next_promotable in str(state.get("nextAction", "")),
            f"project-state.nextAction must identify Backlog next promotable task "
            f"{next_promotable}",
        )

    backlog_drafts = sorted(
        task_id
        for task_id, task in tasks.items()
        if task.get("state") == "DRAFT"
        and task.get("planningBacklog") == TASK_BACKLOG_PATH
    )
    audit.require(
        len(backlog_drafts) <= 1,
        "task-backlog: multiple Backlog-managed DRAFT promotions are forbidden: "
        f"{backlog_drafts}",
    )
    draft_promotions: dict[str, dict[str, Any]] = {}
    for draft_task_id in backlog_drafts:
        draft_projection = derive_backlog_promotion_projection(
            backlog,
            tasks,
            lifecycle,
            draft_candidate=draft_task_id,
        )
        draft_promotions[draft_task_id] = draft_projection
        draft_blockers = draft_projection.get("blockers")
        draft_blockers = (
            draft_blockers.get(draft_task_id)
            if isinstance(draft_blockers, dict)
            else None
        )
        draft_blockers = (
            draft_blockers
            if isinstance(draft_blockers, list)
            else ["MISSING_FROM_PROMOTION_PROJECTION"]
        )
        audit.require(
            draft_projection.get("nextPromotable") == draft_task_id
            and not draft_blockers,
            f"task-backlog: DRAFT {draft_task_id} bypasses execution order, "
            "dependencies, repository-idle or hard decision gates; "
            f"next={draft_projection.get('nextPromotable')!r}, "
            f"blockers={draft_blockers}",
        )
        audit.require(
            draft_task_id in str(state.get("nextAction", "")),
            f"project-state.nextAction at DRAFT promotion must identify "
            f"{draft_task_id}",
        )

    return {
        **projection,
        "draftPromotions": draft_promotions,
        "executionOrder": execution_order,
        "criticalPath": critical_path,
    }


def validate_task_backlog(
    audit: Audit,
    tasks: dict[str, dict[str, Any]],
    lifecycle: dict[str, Any],
    state: dict[str, Any],
) -> dict[str, Any]:
    backlog = load_yaml(ROOT / TASK_BACKLOG_PATH)
    projection = validate_task_backlog_data(
        audit,
        backlog,
        tasks,
        lifecycle,
        state,
    )
    validate_task_backlog_history(audit, backlog, lifecycle)
    return projection


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
        path_is_file = current_path_is_file(path)
        audit.require(path_is_file, f"Skill {skill_id}: missing {skill_path}")
        if path_is_file:
            try:
                metadata = parse_skill_metadata(path)
                if skill_id == "task-delivery-flow":
                    audit.require(
                        set(metadata) == {"name", "description"},
                        "Skill task-delivery-flow: frontmatter must contain only "
                        "name and description; version belongs to the registry",
                    )
                    declared_id = metadata.get("name")
                    declared_version = entry.get("version", "")
                else:
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
        lifecycle_exemptions = rule.get("lifecycleExemptions", [])
        audit.require(
            isinstance(lifecycle_exemptions, list)
            and all(
                item in {PROJECT_STATE_PATH, TASK_LEDGER_PATH}
                for item in lifecycle_exemptions
            ),
            f"protected path {rule.get('glob')}: lifecycleExemptions may contain only "
            f"{PROJECT_STATE_PATH} and {TASK_LEDGER_PATH}",
        )
        if lifecycle_exemptions:
            audit.require(
                rule.get("glob") == ".harness/**",
                "protected path lifecycleExemptions are valid only on .harness/**",
            )

    for task_id, task in tasks.items():
        if is_planning_only_task(task) or task.get("state") in ("DRAFT", "REJECTED"):
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
                    baseline = strict_yaml_load(match.group(1))
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
                delivery_commit = canonical_terminal_commit(
                    task,
                    {"ACCEPTED", "REJECTED"},
                )
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
                            else read_repository_bytes(
                                ROOT / normalize_repo_path(current_path)
                            )
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
                audit.require(
                    current_path_exists(ROOT / normalize_repo_path(path)),
                    f"source {source_id}: missing {path}",
                )
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
                    current_path_is_file(ROOT / normalize_repo_path(path)),
                    f"{task_id}: source of truth does not exist: {path}",
                )
        for invariant_id in task.get("requiredInvariants", []):
            audit.require(
                str(invariant_id) in invariant_ids,
                f"{task_id}: unknown required invariant {invariant_id}",
            )
    for path in sorted(repository_glob(ROOT / "specs/contracts", "*.yaml")):
        try:
            contract = load_yaml(path)
            audit.require(bool(contract.get("schemaVersion")), f"{relative(path)}: schemaVersion is required")
        except HarnessError as exc:
            audit.error(str(exc))


def validate_task_delivery_policy(audit: Audit) -> None:
    policy = load_yaml(ROOT / TASK_DELIVERY_POLICY_PATH)
    audit.require(
        set(policy)
        == {
            "schemaVersion",
            "policyId",
            "canonicalLifecycleSource",
            "taskSource",
            "skill",
            "modes",
            "complexityGate",
            "budgets",
            "validation",
            "review",
            "candidateIdentity",
            "followUpTasks",
        },
        "task-delivery-policy: root fields do not match the frozen machine contract",
    )
    audit.require(
        policy.get("schemaVersion") == 1
        and policy.get("policyId") == "task-delivery"
        and policy.get("canonicalLifecycleSource") == ".harness/task-lifecycle.yaml"
        and policy.get("taskSource") == TASK_BACKLOG_PATH
        and policy.get("skill")
        == {
            "id": "task-delivery-flow",
            "registry": ".harness/skills.yaml",
        },
        "task-delivery-policy: identity, lifecycle, Backlog or Skill source drifted",
    )
    modes = policy.get("modes")
    audit.require(
        isinstance(modes, dict) and set(modes) == {"single-card", "longline"},
        "task-delivery-policy: modes must be exactly single-card and longline",
    )
    lifecycle = load_yaml(ROOT / ".harness/task-lifecycle.yaml")
    single_card = modes.get("single-card") if isinstance(modes, dict) else {}
    single_card = single_card if isinstance(single_card, dict) else {}
    happy_path = single_card.get("happyPath")
    transitions = lifecycle.get("transitions")
    transitions = transitions if isinstance(transitions, dict) else {}
    if isinstance(happy_path, list):
        for source, target in zip(happy_path, happy_path[1:]):
            audit.require(
                target in transitions.get(source, []),
                f"task-delivery-policy: happyPath edge {source} -> {target} "
                "is not in the canonical lifecycle",
            )
    else:
        audit.error("task-delivery-policy: single-card happyPath must be a list")
    audit.require(
        canonical_json_sha256(policy) == TASK_DELIVERY_POLICY_CANONICAL_HASH,
        "task-delivery-policy: canonical contract hash drifted; update the C4 "
        "validator and tests in the same authorized change",
    )

    sources = load_yaml(ROOT / ".harness/sources-of-truth.yaml").get("sources")
    audit.require(
        isinstance(sources, dict)
        and sources.get("taskDeliveryPolicy") == TASK_DELIVERY_POLICY_PATH,
        "task-delivery-policy: sources-of-truth must register taskDeliveryPolicy",
    )
    audit.require(
        isinstance(sources, dict)
        and sum(
            value == TASK_DELIVERY_POLICY_PATH for value in sources.values()
        )
        == 1,
        "task-delivery-policy: sources-of-truth must register the policy path "
        "exactly once",
    )
    registry = load_yaml(ROOT / ".harness/skills.yaml").get("skills")
    delivery_skills = (
        [
            entry
            for entry in registry
            if isinstance(entry, dict) and entry.get("id") == "task-delivery-flow"
        ]
        if isinstance(registry, list)
        else []
    )
    audit.require(
        delivery_skills
        == [
            {
                "id": "task-delivery-flow",
                "version": "1.0.0",
                "path": "skills/task-delivery-flow/SKILL.md",
            }
        ],
        "task-delivery-policy: task-delivery-flow must be registered exactly once "
        "at version 1.0.0",
    )
    invariants = load_yaml(ROOT / ".harness/invariants.yaml").get("invariants")
    delivery_invariants = (
        [
            invariant
            for invariant in invariants
            if isinstance(invariant, dict) and invariant.get("id") == "INV-HARNESS-007"
        ]
        if isinstance(invariants, list)
        else []
    )
    audit.require(
        delivery_invariants
        == [
            {
                "id": "INV-HARNESS-007",
                "statement": (
                    "single-card and longline delivery follow one registered machine "
                    "policy with bounded review exact candidate identity exact-SHA "
                    "validation and fail-closed dependency release"
                ),
                "enforcement": [
                    "task_delivery_policy",
                    "harness_doctor",
                    "harness_tests",
                    "repository_skill",
                ],
            }
        ],
        "task-delivery-policy: INV-HARNESS-007 projection drifted",
    )

    expected_follow_ups = {
        "idlePlanningCheckpointCore": "TASK-0049",
        "idlePlanningCheckpointConsumers": "TASK-0050",
        "harnessPerformance": "TASK-0051",
        "pathAwareCi": "TASK-0052",
        "snapshotReceipt": "TASK-0053",
    }
    audit.require(
        policy.get("followUpTasks") == expected_follow_ups,
        "task-delivery-policy: follow-up task projection drifted",
    )
    backlog = load_yaml(ROOT / TASK_BACKLOG_PATH)
    entries = backlog.get("tasks")
    entries = entries if isinstance(entries, dict) else {}
    expected_dependencies = {
        "TASK-0049": ["TASK-0048"],
        "TASK-0050": ["TASK-0049"],
        "TASK-0051": ["TASK-0050"],
        "TASK-0052": ["TASK-0051"],
        "TASK-0053": ["TASK-0052"],
    }
    for task_id, dependencies in expected_dependencies.items():
        entry = entries.get(task_id)
        audit.require(
            isinstance(entry, dict) and entry.get("dependencies") == dependencies,
            f"task-delivery-policy: {task_id} successor dependency drifted",
        )
    execution_order = backlog.get("executionOrder")
    successor_order: list[Any] | None = None
    if (
        isinstance(execution_order, list)
        and "TASK-0041" in execution_order
        and "TASK-0013" in execution_order
    ):
        successor_order = execution_order[
            execution_order.index("TASK-0041") + 1 : execution_order.index("TASK-0013")
        ]
    audit.require(
        successor_order
        == [
            "TASK-0043",
            "TASK-0044",
            "TASK-0045",
            "TASK-0046",
            "TASK-0047",
            "TASK-0049",
            "TASK-0050",
            "TASK-0051",
            "TASK-0052",
            "TASK-0053",
        ],
        "task-delivery-policy: replacement execution order must follow the blocked "
        "chain and precede TASK-0013",
    )
    resolutions = backlog.get("resolutions")
    resolutions = resolutions if isinstance(resolutions, dict) else {}
    for old_task, replacement in {
        "TASK-0039": "TASK-0045",
        "TASK-0040": "TASK-0046",
        "TASK-0041": "TASK-0047",
        "TASK-0043": "TASK-0049",
        "TASK-0044": "TASK-0050",
        "TASK-0045": "TASK-0051",
        "TASK-0046": "TASK-0052",
        "TASK-0047": "TASK-0053",
    }.items():
        resolution = resolutions.get(old_task)
        audit.require(
            isinstance(resolution, dict)
            and resolution.get("state") == "SUPERSEDED"
            and resolution.get("replacementTask") == replacement,
            f"task-delivery-policy: {old_task} must be SUPERSEDED by {replacement}",
        )

    agents_text = read_repository_text(ROOT / "AGENTS.md")
    for required_reference in (
        TASK_DELIVERY_POLICY_PATH,
        "skills/task-delivery-flow/SKILL.md",
    ):
        audit.require(
            required_reference in agents_text,
            f"task-delivery-policy: AGENTS.md misses {required_reference}",
        )
    for duplicated_field in (
        "targetWallMinutes",
        "hardFuseWallMinutes",
        "candidateDeadlineMinutes",
        "maximumFixBatches",
        "requiredInputs:",
    ):
        audit.require(
            duplicated_field not in agents_text,
            "task-delivery-policy: AGENTS.md duplicates machine strategy field "
            f"{duplicated_field}",
        )

    skill_path = ROOT / "skills/task-delivery-flow/SKILL.md"
    skill_text = read_repository_text(skill_path)
    audit.require(
        skill_text.isascii(),
        "task-delivery-policy: task-delivery-flow Skill must remain ASCII",
    )
    wrapper_item_match = re.search(
        r"(?ms)^## Run a single card\s+.*?^5\. (?P<body>.*?)(?=^6\. )",
        skill_text,
    )
    audit.require(
        wrapper_item_match is not None,
        "task-delivery-policy: Skill wrapper command identity item is missing",
    )
    if wrapper_item_match is not None:
        wrapper_item = " ".join(wrapper_item_match.group("body").split())
        expected_wrapper_item = (
            "For an ordinary card, use `python scripts/harness/precheck.py --task "
            "TASK-ID` as the canonical command. A wrapper is never an Evidence, "
            "receipt, or PASS alias. A task that freezes wrapper argv executes and "
            "records that wrapper as the actual command; freezing does not convert "
            "the wrapper into the Python canonical command."
        )
        audit.require(
            wrapper_item == expected_wrapper_item,
            "task-delivery-policy: wrapper command identity must be unconditional; "
            "frozen wrapper argv is an actual command and never an Evidence, receipt, "
            "PASS, or Python canonical alias",
        )


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


def first_existing_zed_instruction_path() -> str | None:
    return next(
        (
            candidate
            for candidate in ZED_PROJECT_INSTRUCTION_PRIORITY
            if current_path_is_file(ROOT / normalize_repo_path(candidate))
        ),
        None,
    )


def validate_entrypoints(audit: Audit) -> None:
    config = load_yaml(ROOT / ".harness/agent-entrypoints.yaml")
    canonical = str(config.get("canonicalInstructions", ""))
    audit.require(canonical == "AGENTS.md", "agent-entrypoints: canonicalInstructions must be AGENTS.md")
    canonical_path = ROOT / canonical
    canonical_is_file = current_path_is_file(canonical_path)
    audit.require(canonical_is_file, "agent-entrypoints: AGENTS.md is missing")
    if canonical_is_file:
        nonblank = [
            line
            for line in read_repository_text(canonical_path).splitlines()
            if line.strip()
        ]
        audit.require(len(nonblank) <= 160, "AGENTS.md is too large; move explanations to onboarding docs")
    clients = config.get("clients")
    audit.require(isinstance(clients, dict), "agent-entrypoints: clients must be an object")
    if not isinstance(clients, dict):
        return
    expected_clients = {
        "codex",
        "zed",
        "claudeCode",
        "githubCopilotCliAgentInstructions",
        "githubCopilotCliClaudeImport",
    }
    audit.require(
        set(clients) == expected_clients,
        "agent-entrypoints: client discovery mechanisms must be explicit and complete: "
        f"{sorted(expected_clients)}",
    )
    allowed_modes = {"NATIVE_DISCOVERY", "THIN_IMPORT", "THIN_REFERENCE"}
    for client_id, client in clients.items():
        if not isinstance(client, dict):
            audit.error(f"agent-entrypoints: {client_id} must be an object")
            continue
        path_value = str(client.get("instructionPath", ""))
        audit.require(is_repository_relative(path_value), f"agent-entrypoints: {client_id} path is invalid")
        path = ROOT / normalize_repo_path(path_value)
        path_is_file = current_path_is_file(path)
        audit.require(path_is_file, f"agent-entrypoints: {client_id} missing {path_value}")
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
        if path_is_file and re.fullmatch(r"[0-9a-f]{64}", expected_hash):
            audit.require(
                sha256_file(path) == expected_hash,
                f"agent-entrypoints: {client_id} instruction content drifted",
            )
        if path_is_file and mode in ("THIN_IMPORT", "THIN_REFERENCE"):
            text = read_repository_text(path)
            reference = str(client.get("requiredReference", ""))
            audit.require(reference in text, f"agent-entrypoints: {client_id} adapter misses {reference}")
            nonblank = [line for line in text.splitlines() if line.strip()]
            audit.require(len(nonblank) <= 8, f"agent-entrypoints: {client_id} adapter is not thin")
            audit.require("## 绝对禁止" not in text, f"agent-entrypoints: {client_id} duplicates canonical rules")
            audit.require(
                client.get("unavailableAction")
                == "BLOCK_IF_CANONICAL_UNAVAILABLE",
                f"agent-entrypoints: {client_id} must fail closed when "
                "canonical instructions cannot be loaded",
            )
            audit.require(
                "blocked" in text.casefold(),
                f"agent-entrypoints: {client_id} adapter must state its "
                "fail-closed behavior",
            )
    zed = clients.get("zed")
    if isinstance(zed, dict):
        first_existing = first_existing_zed_instruction_path()
        audit.require(
            first_existing == zed.get("instructionPath"),
            "agent-entrypoints: Zed instructionPath must equal the first existing "
            f"official-priority file, got {first_existing!r}",
        )
        audit.require(
            zed.get("discoverySemantics") == "FIRST_MATCH",
            "agent-entrypoints: Zed must declare FIRST_MATCH discovery semantics",
        )
    copilot_cli_agent = clients.get("githubCopilotCliAgentInstructions")
    copilot_cli_import = clients.get("githubCopilotCliClaudeImport")
    copilot_cli_mechanisms = (copilot_cli_agent, copilot_cli_import)
    for copilot_cli in copilot_cli_mechanisms:
        if not isinstance(copilot_cli, dict):
            continue
        audit.require(
            copilot_cli.get("clientScope") == "GITHUB_COPILOT_CLI",
            "agent-entrypoints: Copilot CLI mechanism must have an exact client scope",
        )
        audit.require(
            copilot_cli.get("discoverySemantics") == "MERGE_ALL_DISCOVERED",
            "agent-entrypoints: Copilot CLI must declare merge-all discovery semantics",
        )
        audit.require(
            copilot_cli.get("supportMatrix") == COPILOT_SUPPORT_MATRIX,
            "agent-entrypoints: Copilot CLI mechanism must link "
            "the official support matrix",
        )
        audit.require(
            copilot_cli.get("documentation")
            == "https://docs.github.com/en/copilot/how-tos/copilot-cli/"
            "customize-copilot/add-custom-instructions",
            "agent-entrypoints: Copilot CLI mechanism must link its official "
            "instruction documentation",
        )
    if isinstance(copilot_cli_agent, dict):
        audit.require(
            copilot_cli_agent.get("instructionPath") == canonical
            and copilot_cli_agent.get("mode") == "NATIVE_DISCOVERY"
            and copilot_cli_agent.get("appliesWhen")
            == "COPILOT_CLI_AGENT_INSTRUCTIONS_SUPPORTED",
            "agent-entrypoints: Copilot CLI must register native AGENTS.md discovery",
        )
    if isinstance(copilot_cli_import, dict):
        audit.require(
            copilot_cli_import.get("instructionPath") == "CLAUDE.md"
            and copilot_cli_import.get("mode") == "THIN_IMPORT"
            and copilot_cli_import.get("requiredReference") == "@AGENTS.md"
            and copilot_cli_import.get("appliesWhen")
            == "COPILOT_CLI_CLAUDE_IMPORT_SUPPORTED",
            "agent-entrypoints: Copilot CLI must register the shared CLAUDE.md thin import",
        )
        audit.require(
            copilot_cli_import.get("unavailableAction")
            == "BLOCK_IF_CANONICAL_UNAVAILABLE",
            "agent-entrypoints: Copilot CLI import must fail closed when canonical "
            "instructions are unavailable",
        )
        copilot_adapter = ROOT / "CLAUDE.md"
        if current_path_is_file(copilot_adapter):
            audit.require(
                "blocked" in read_repository_text(copilot_adapter).casefold(),
                "agent-entrypoints: shared Copilot CLI adapter must state its "
                "fail-closed behavior",
            )
    if isinstance(copilot_cli_agent, dict) and isinstance(
        copilot_cli_import, dict
    ):
        audit.require(
            copilot_cli_agent.get("clientScope")
            == copilot_cli_import.get("clientScope")
            and copilot_cli_agent.get("documentation")
            == copilot_cli_import.get("documentation"),
            "agent-entrypoints: Copilot CLI discovery mechanisms must share "
            "one exact product scope and documentation",
        )


def validate_command_registry(audit: Audit, config: dict[str, Any]) -> None:
    runner = str(config.get("runner", ""))
    audit.require(
        runner == "scripts/harness/precheck.py",
        "commands: canonical runner must remain scripts/harness/precheck.py",
    )
    audit.require(is_repository_relative(runner), "commands: runner must be repository-relative")
    if is_repository_relative(runner):
        audit.require(
            current_path_is_file(ROOT / runner),
            f"commands: missing runner {runner}",
        )
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
                audit.require(
                    current_path_is_file(ROOT / script),
                    f"commands: {command_id} missing {script}",
                )
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
        path_is_file = current_path_is_file(path)
        audit.require(path_is_file, f"commands: missing wrapper {wrapper}")
        if path_is_file:
            audit.require(
                "precheck.py" in read_repository_text(path),
                f"{wrapper}: must call precheck.py",
            )


def validate_check_artifact(
    audit: Audit,
    label: str,
    artifact_hash: Any,
    reason: Any,
) -> None:
    if artifact_hash is None:
        audit.require(
            isinstance(reason, str) and bool(reason.strip()),
            f"{label}: null artifactHash requires a truthful non-blank no-artifact reason",
        )
    else:
        audit.require(
            isinstance(artifact_hash, str)
            and bool(re.fullmatch(r"([0-9a-f]{40}|[0-9a-f]{64})", artifact_hash)),
            f"{label}: artifactHash must be a non-blank 40- or 64-character lowercase hex digest",
        )


def validate_nonblank_text(audit: Audit, label: str, value: Any) -> None:
    audit.require(
        isinstance(value, str) and bool(value.strip()),
        f"{label}: must be a non-blank string",
    )


def validate_evidence_check(audit: Audit, label: str, check: dict[str, Any]) -> None:
    status = check.get("status")
    exit_code = check.get("exitCode")
    reason = check.get("reason")
    if status == "PASS":
        audit.require(exit_code == 0, f"{label}: PASS requires exitCode 0")
    elif status == "FAIL":
        audit.require(
            isinstance(exit_code, int) and exit_code != 0,
            f"{label}: FAIL requires non-zero exitCode",
        )
    elif status == "NOT_RUN":
        audit.require(exit_code is None, f"{label}: NOT_RUN requires null exitCode")
        validate_nonblank_text(audit, f"{label}: NOT_RUN reason", reason)
        audit.require(
            check.get("artifactHash") is None,
            f"{label}: NOT_RUN must not claim an artifactHash",
        )
    validate_check_artifact(audit, label, check.get("artifactHash"), reason)


def validate_evidence_and_handoffs(
    audit: Audit,
    tasks: dict[str, dict[str, Any]],
    lifecycle: dict[str, Any],
    current_protected_rules: list[dict[str, Any]],
    allow_pending_draft: bool = False,
) -> None:
    handoff_schema = load_json(ROOT / "docs/schemas/handoff.schema.json", audit)
    evidence_schema = load_json(ROOT / "docs/schemas/evidence-pack.schema.json", audit)
    if not handoff_schema or not evidence_schema:
        return
    handoff_states = set(
        handoff_schema.get("properties", {}).get("state", {}).get("enum", [])
    )
    lifecycle_states = set(str(item) for item in lifecycle.get("states", []))
    audit.require(
        handoff_states
        == lifecycle_states - {"PLANNED", "DRAFT", "SUPERSEDED"},
        "handoff schema states drift from executable lifecycle states; "
        "planning-only SUPERSEDED must not create a Handoff",
    )
    handoffs: dict[str, dict[str, Any]] = {}
    for path in sorted(repository_glob(ROOT / "docs/handoffs", "TASK-*.json")):
        data = load_json(path, audit)
        if not data:
            continue
        validate_json_schema(audit, data, handoff_schema, relative(path))
        validate_nonblank_text(audit, f"{relative(path)}.nextAction", data.get("nextAction"))
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
            audit.require(
                current_path_is_file(ROOT / evidence_path),
                f"{relative(path)}: evidencePath does not exist",
            )
        handoffs[task_id] = data

    evidence_packs: dict[str, dict[str, Any]] = {}
    for path in sorted(
        repository_glob(
            ROOT / "docs/evidence",
            "TASK-*/evidence-pack.json",
        )
    ):
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
            validate_evidence_check(audit, label, check)
        evidence_packs[task_id] = data

    terminal_states = set(str(item) for item in lifecycle.get("terminalStates", []))
    for task_id, task in tasks.items():
        if (
            task.get("state") not in terminal_states
            or is_planning_only_task(task)
        ):
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
                allow_pending_draft,
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
        audit.require(
            len(matches) == 1,
            f"{task_id}: required command must have exactly one final Evidence result: {command}",
        )
        if require_pass:
            audit.require(
                len(matches) == 1
                and matches[0].get("status") == "PASS"
                and matches[0].get("exitCode") == 0,
                f"{task_id}: required command did not PASS: {command}",
            )


def validate_idle_terminal_paths(audit: Audit, task_id: str, paths: list[str]) -> None:
    audit.require(
        not paths,
        f"{task_id}: repository changed after terminal commit without a new active task: {paths}",
    )


def validate_idle_terminal_history(
    audit: Audit,
    task_id: str,
    terminal_commit: str,
) -> None:
    head_commit = git_text("rev-parse", "HEAD").stdout.strip()
    audit.require(
        head_commit == terminal_commit,
        f"{task_id}: HEAD advanced after terminal commit without a new DRAFT or active task",
    )
    validate_idle_terminal_paths(
        audit,
        task_id,
        changed_paths(terminal_commit),
    )
    snapshot = _ACTIVE_GIT_SNAPSHOT
    index_unchanged = (
        snapshot.index_matches_tree(terminal_commit)
        if snapshot is not None
        else git_text(
            "diff",
            "--cached",
            "--quiet",
            terminal_commit,
            "--",
            check=False,
        ).returncode == 0
    )
    audit.require(
        index_unchanged,
        f"{task_id}: index changed after terminal commit without a new task",
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


@functools.lru_cache(maxsize=1)
def git_core_filemode_enabled() -> bool:
    result = git_text("config", "--bool", "core.filemode", check=False)
    return result.returncode == 0 and result.stdout.strip().lower() == "true"


def current_regular_file_bytes(
    audit: Audit,
    label: str,
    path: Path,
) -> bytes | None:
    snapshot = _ACTIVE_GIT_SNAPSHOT
    if snapshot is not None:
        try:
            content, mode, file_attributes = snapshot.read_current_file(path)
        except (HarnessError, OSError) as exc:
            audit.error(f"{label}: cannot read current file: {exc}")
            return None
        reparse_flag = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)
        regular = (
            stat.S_ISREG(mode)
            and not stat.S_ISLNK(mode)
            and not bool(file_attributes & reparse_flag)
            and (
                not git_core_filemode_enabled()
                or stat.S_IMODE(mode) & 0o111 == 0
            )
        )
        audit.require(
            regular,
            f"{label}: must be a regular non-reparse file",
        )
        return content if regular else None
    try:
        metadata = path.lstat()
    except OSError as exc:
        audit.error(f"{label}: cannot inspect current file: {exc}")
        return None
    reparse_flag = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)
    file_attributes = getattr(metadata, "st_file_attributes", 0)
    regular = (
        stat.S_ISREG(metadata.st_mode)
        and not stat.S_ISLNK(metadata.st_mode)
        and not bool(file_attributes & reparse_flag)
        and (
            not git_core_filemode_enabled()
            or stat.S_IMODE(metadata.st_mode) & 0o111 == 0
        )
    )
    audit.require(
        regular,
        f"{label}: must be a regular non-reparse file",
    )
    if not regular:
        return None
    try:
        return path.read_bytes()
    except OSError as exc:
        audit.error(f"{label}: cannot read current file: {exc}")
        return None


def git_tree_entry(commit: str, path: str) -> tuple[str, str, str] | None:
    snapshot = _ACTIVE_GIT_SNAPSHOT
    normalized_path = normalize_repo_path(path)
    if snapshot is not None and snapshot.resolve_commit(commit) is not None:
        return snapshot.tree_entries(commit).get(normalized_path)
    result = git_bytes(
        "ls-tree",
        "-z",
        commit,
        "--",
        normalized_path,
        check=False,
    )
    if result.returncode != 0 or not result.stdout:
        return None
    records = [record for record in result.stdout.split(b"\0") if record]
    if len(records) != 1 or b"\t" not in records[0]:
        return None
    header, raw_path = records[0].split(b"\t", 1)
    parts = header.decode("ascii", errors="replace").split()
    listed_path = raw_path.decode("utf-8", errors="surrogateescape").replace("\\", "/")
    if len(parts) != 3 or listed_path != normalized_path:
        return None
    return parts[0], parts[1], parts[2]


def git_index_entry(path: str) -> tuple[str, str] | None:
    snapshot = _ACTIVE_GIT_SNAPSHOT
    if snapshot is not None:
        return snapshot.index_entry(path)
    result = git_bytes(
        "ls-files",
        "--stage",
        "-z",
        "--",
        normalize_repo_path(path),
    )
    records = [record for record in result.stdout.split(b"\0") if record]
    if len(records) != 1 or b"\t" not in records[0]:
        return None
    header, raw_path = records[0].split(b"\t", 1)
    parts = header.decode("ascii", errors="replace").split()
    listed_path = raw_path.decode("utf-8", errors="surrogateescape").replace("\\", "/")
    if (
        len(parts) != 3
        or parts[2] != "0"
        or listed_path != normalize_repo_path(path)
    ):
        return None
    return parts[0], parts[1]


def git_worktree_blob_oid(path: str) -> str | None:
    snapshot = _ACTIVE_GIT_SNAPSHOT
    if snapshot is not None:
        return snapshot.current_blob_oid(
            ROOT / normalize_repo_path(path)
        )
    result = git_text(
        "hash-object",
        f"--path={normalize_repo_path(path)}",
        "--",
        normalize_repo_path(path),
        check=False,
    )
    value = result.stdout.strip()
    return value if result.returncode == 0 and re.fullmatch(r"[0-9a-f]{40,64}", value) else None


def validate_current_index_snapshot(
    audit: Audit,
    task_id: str,
    paths: list[str],
) -> None:
    for path in paths:
        repository_path = ROOT / normalize_repo_path(path)
        index_entry = git_index_entry(path)
        if not current_path_is_file(repository_path):
            audit.require(
                index_entry is None,
                f"{task_id}: staged snapshot and worktree disagree on missing path: {path}",
            )
            continue
        try:
            snapshot = _ACTIVE_GIT_SNAPSHOT
            if snapshot is not None:
                _, mode, file_attributes = snapshot.read_current_file(
                    repository_path
                )
            else:
                metadata = repository_path.lstat()
                mode = metadata.st_mode
                file_attributes = getattr(
                    metadata,
                    "st_file_attributes",
                    0,
                )
            reparse_flag = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)
            regular = (
                stat.S_ISREG(mode)
                and not stat.S_ISLNK(mode)
                and not bool(file_attributes & reparse_flag)
            )
            audit.require(
                regular,
                f"{task_id}: changed path must be a regular non-reparse file: {path}",
            )
            audit.require(
                index_entry is not None,
                f"{task_id}: changed path is not staged in the validated snapshot: {path}",
            )
            worktree_oid = git_worktree_blob_oid(path)
            audit.require(
                index_entry is not None
                and worktree_oid is not None
                and index_entry[1] == worktree_oid,
                f"{task_id}: staged snapshot and worktree content disagree: {path}",
            )
        except (HarnessError, OSError) as exc:
            audit.error(f"{task_id}: cannot inspect changed path {path}: {exc}")


def allowed_repository_file_modes(
    audit: Audit,
    task_id: str,
    base_commit: str,
    path: str,
) -> set[str]:
    baseline_entry = git_tree_entry(base_commit, path)
    if baseline_entry is None:
        return {"100644", "100755"} if path.endswith(".sh") else {"100644"}
    audit.require(
        baseline_entry[1] == "blob" and baseline_entry[0] in {"100644", "100755"},
        f"{task_id}: Base Commit path is not a portable regular Git file: {path}",
    )
    return (
        {baseline_entry[0]}
        if baseline_entry[1] == "blob"
        and baseline_entry[0] in {"100644", "100755"}
        else set()
    )


def validate_changed_path_modes(
    audit: Audit,
    task_id: str,
    base_commit: str,
    target_commit: str,
    paths: list[str],
    include_current_index: bool,
) -> None:
    history = git_text(
        "rev-list",
        "--topo-order",
        "--reverse",
        f"{base_commit}..{target_commit}",
    ).stdout.splitlines()
    commits = [commit.strip() for commit in history]
    for path in paths:
        allowed_modes = allowed_repository_file_modes(
            audit,
            task_id,
            base_commit,
            path,
        )
        for commit in commits:
            entry = git_tree_entry(commit, path)
            if entry is None:
                continue
            audit.require(
                entry[1] == "blob" and entry[0] in allowed_modes,
                f"{task_id}: changed path has an unauthorized Git mode/type at "
                f"{commit}: {path} ({entry[0]} {entry[1]})",
            )
        if include_current_index:
            index_entry = git_index_entry(path)
            if index_entry is not None:
                audit.require(
                    index_entry[0] in allowed_modes,
                    f"{task_id}: staged path has an unauthorized Git mode: "
                    f"{path} ({index_entry[0]})",
                )


def validate_frozen_repository_artifact(
    audit: Audit,
    task_id: str,
    terminal_commit: str,
    path: str,
) -> None:
    try:
        entry = git_tree_entry(terminal_commit, path)
        audit.require(
            entry is not None and entry[:2] == ("100644", "blob"),
            f"{task_id}: {path} must be a regular 100644 Git blob at terminal boundary",
        )
        git_object(terminal_commit, path)
        current = current_regular_file_bytes(
            audit,
            f"{task_id}: {path}",
            ROOT / normalize_repo_path(path),
        )
        if current is not None:
            audit.require(
                entry is not None and git_worktree_blob_oid(path) == entry[2],
                f"{task_id}: frozen worktree content changed: {path}",
            )
        audit.require(
            entry is not None and git_index_entry(path) == (entry[0], entry[2]),
            f"{task_id}: frozen index entry changed: {path}",
        )
        history = git_text(
            "rev-list",
            f"{terminal_commit}..HEAD",
        ).stdout.splitlines()
        for commit in history:
            audit.require(
                git_tree_entry(commit.strip(), path) == entry,
                f"{task_id}: frozen artifact changed in commit {commit.strip()}: {path}",
            )
    except (HarnessError, OSError) as exc:
        audit.error(f"{task_id}: cannot verify frozen terminal artifact {path}: {exc}")


def current_repository_tree_entries(prefix: str) -> dict[str, Path]:
    snapshot = _ACTIVE_GIT_SNAPSHOT
    normalized_prefix = normalize_repo_path(prefix).rstrip("/")
    if snapshot is not None:
        return {
            path: ROOT / path
            for path in snapshot.current_file_paths()
            if path.startswith(f"{normalized_prefix}/")
        }
    root = ROOT / normalize_repo_path(prefix)
    entries: dict[str, Path] = {}
    if not root.exists():
        return entries
    for directory, directory_names, file_names in os.walk(root, followlinks=False):
        directory_path = Path(directory)
        for name in list(directory_names):
            path = directory_path / name
            metadata = path.lstat()
            reparse_flag = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)
            if stat.S_ISLNK(metadata.st_mode) or bool(
                getattr(metadata, "st_file_attributes", 0) & reparse_flag
            ):
                entries[relative(path)] = path
                directory_names.remove(name)
        for name in file_names:
            path = directory_path / name
            entries[relative(path)] = path
    return entries


def validate_portable_path_collisions(
    audit: Audit,
    label: str,
    paths: list[str],
) -> None:
    seen: dict[str, str] = {}
    for path in paths:
        audit.require(
            "\\" not in path,
            f"{label}: Git path contains a non-portable backslash: {path!r}",
        )
        audit.require(
            not any(0xD800 <= ord(character) <= 0xDFFF for character in path),
            f"{label}: Git path is not valid portable UTF-8: {path!r}",
        )
        normalized_path = normalize_repo_path(path)
        for component in normalized_path.split("/"):
            audit.require(
                bool(component)
                and component not in {".", ".."}
                and not component.endswith((" ", "."))
                and WINDOWS_INVALID_COMPONENT_RE.search(component) is None
                and WINDOWS_RESERVED_COMPONENT_RE.fullmatch(component) is None,
                f"{label}: path component is not portable to Windows: "
                f"{component!r} in {path!r}",
            )
        key = unicodedata.normalize("NFC", normalized_path).casefold()
        previous = seen.setdefault(key, path)
        audit.require(
            previous == path,
            f"{label}: paths collide on Windows/macOS: {previous!r} and {path!r}",
        )


def repository_paths_at_commit(commit: str) -> list[str]:
    snapshot = _ACTIVE_GIT_SNAPSHOT
    if snapshot is not None and snapshot.resolve_commit(commit) is not None:
        return sorted(snapshot.tree_entries(commit))
    result = git_bytes(
        "ls-tree",
        "-r",
        "-z",
        "--name-only",
        commit,
    )
    return sorted(
        value.decode("utf-8", errors="surrogateescape")
        for value in result.stdout.split(b"\0")
        if value
    )


def repository_index_paths() -> list[str]:
    snapshot = _ACTIVE_GIT_SNAPSHOT
    if snapshot is not None:
        return sorted(snapshot._index_entries)
    result = git_bytes("ls-files", "-z")
    return sorted(
        value.decode("utf-8", errors="surrogateescape")
        for value in result.stdout.split(b"\0")
        if value
    )


def validate_current_regular_tree(
    audit: Audit,
    task_id: str,
    prefix: str,
) -> None:
    root = ROOT / normalize_repo_path(prefix)
    try:
        metadata = root.lstat()
        reparse_flag = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)
        audit.require(
            stat.S_ISDIR(metadata.st_mode)
            and not stat.S_ISLNK(metadata.st_mode)
            and not bool(getattr(metadata, "st_file_attributes", 0) & reparse_flag),
            f"{task_id}: evidence root must be a regular non-reparse directory: {prefix}",
        )
    except OSError as exc:
        audit.error(f"{task_id}: cannot inspect evidence root {prefix}: {exc}")
    entries = current_repository_tree_entries(prefix)
    audit.require(bool(entries), f"{task_id}: evidence tree is empty: {prefix}")
    validate_portable_path_collisions(
        audit,
        f"{task_id}: current evidence tree",
        list(entries),
    )
    for path, current_path in sorted(entries.items()):
        current_regular_file_bytes(audit, f"{task_id}: {path}", current_path)


def git_repository_tree_entries(commit: str, prefix: str) -> dict[str, tuple[str, str, str]]:
    snapshot = _ACTIVE_GIT_SNAPSHOT
    normalized_prefix = normalize_repo_path(prefix).rstrip("/")
    if snapshot is not None and snapshot.resolve_commit(commit) is not None:
        return {
            path.replace("\\", "/"): entry
            for path, entry in snapshot.tree_entries(commit).items()
            if path.replace("\\", "/") == normalized_prefix
            or path.replace("\\", "/").startswith(f"{normalized_prefix}/")
        }
    result = git_bytes(
        "ls-tree",
        "-r",
        "-z",
        commit,
        "--",
        normalized_prefix,
    )
    entries: dict[str, tuple[str, str, str]] = {}
    for record in result.stdout.split(b"\0"):
        if not record or b"\t" not in record:
            continue
        header, raw_path = record.split(b"\t", 1)
        parts = header.decode("ascii", errors="replace").split()
        path = raw_path.decode("utf-8", errors="surrogateescape").replace("\\", "/")
        if len(parts) == 3:
            entries[path] = (parts[0], parts[1], parts[2])
    return entries


def validate_frozen_repository_tree(
    audit: Audit,
    task_id: str,
    terminal_commit: str,
    prefix: str,
) -> None:
    expected = git_repository_tree_entries(terminal_commit, prefix)
    current = current_repository_tree_entries(prefix)
    validate_portable_path_collisions(
        audit,
        f"{task_id}: terminal evidence tree",
        list(expected),
    )
    audit.require(bool(expected), f"{task_id}: frozen evidence tree is empty: {prefix}")
    audit.require(
        set(current) == set(expected),
        f"{task_id}: frozen evidence tree path set changed: "
        f"missing={sorted(set(expected) - set(current))}, "
        f"extra={sorted(set(current) - set(expected))}",
    )
    for path, entry in expected.items():
        audit.require(
            entry[:2] == ("100644", "blob"),
            f"{task_id}: frozen evidence entry must be a regular 100644 Git blob: {path}",
        )
    history = git_text(
        "rev-list",
        f"{terminal_commit}..HEAD",
    ).stdout.splitlines()
    for commit in history:
        audit.require(
            git_repository_tree_entries(commit.strip(), prefix) == expected,
            f"{task_id}: frozen evidence tree changed in commit {commit.strip()}: {prefix}",
        )
    for path in sorted(set(expected) & set(current)):
        validate_frozen_repository_artifact(audit, task_id, terminal_commit, path)


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


def validate_reviewer_identity_fields(
    audit: Audit,
    label: str,
    reviewer: dict[str, Any],
) -> str | None:
    reviewer_id = reviewer.get("id")
    audit.require(
        is_canonical_identity(reviewer_id),
        f"{label}.id must be a canonical lowercase identity",
    )
    audit.require(
        is_canonical_identity(reviewer.get("kind")),
        f"{label}.kind must be a canonical lowercase identity",
    )
    return str(reviewer_id) if is_canonical_identity(reviewer_id) else None


def validate_versioned_terminal_evidence(
    audit: Audit,
    task_id: str,
    task: dict[str, Any],
    evidence: dict[str, Any],
    handoff: dict[str, Any],
    head_commit: str,
    terminal_states: set[str],
    current_protected_rules: list[dict[str, Any]],
    allow_pending_draft: bool,
) -> None:
    if FULL_COMMIT_RE.fullmatch(head_commit):
        validate_authorization_precedes_head(audit, task, head_commit)
    terminal_commit: str | None = None
    try:
        terminal_commit = canonical_terminal_commit(task, terminal_states)
        if terminal_commit:
            boundary_state = strict_yaml_load(
                git_object(terminal_commit, ".harness/project-state.yaml")
            )
            closure_paths = changed_paths_across_history(
                head_commit,
                terminal_commit,
            )
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
            closure_paths = sorted(
                set(changed_paths_across_history(head_commit, "HEAD"))
                | set(changed_paths(head_commit))
            )
        reviewed_state = strict_yaml_load(
            git_object(head_commit, ".harness/project-state.yaml")
        )
        if not isinstance(reviewed_state, dict) or not isinstance(boundary_state, dict):
            raise HarnessError(".harness/project-state.yaml: compared versions must be objects")
        audit.require(
            handoff.get("nextAction") == boundary_state.get("nextAction"),
            f"{task_id}: Handoff nextAction disagrees with terminal project-state",
        )
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
            and not allow_pending_draft
        ):
            audit.require(
                project_state_closure_projection(boundary_state)
                == project_state_closure_projection(current_state),
                f"{task_id}: protected project-state fields changed after terminal commit without a new task",
            )
            validate_idle_terminal_history(audit, task_id, terminal_commit)
    except (HarnessError, OSError, UnicodeError, yaml.YAMLError) as exc:
        audit.error(f"{task_id}: cannot verify terminal closure boundary: {exc}")
        closure_paths = []

    if FULL_COMMIT_RE.fullmatch(head_commit):
        try:
            implementation_paths = changed_paths_across_history(
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
                target_commit=head_commit,
            )
        except HarnessError as exc:
            audit.error(f"{task_id}: cannot verify implementation scope at headCommit: {exc}")

    checks = evidence.get("checks")
    checks = checks if isinstance(checks, list) else []
    by_command: dict[str, list[dict[str, Any]]] = {}
    for check in checks:
        if isinstance(check, dict):
            by_command.setdefault(str(check.get("command", "")), []).append(check)
            validate_nonblank_text(
                audit,
                f"{task_id}: every check environment",
                check.get("environment"),
            )
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
            for field in ("verdict", "reviewedCommit", "evidencePath"):
                audit.require(bool(reviewer.get(field)), f"{label}.{field} is required")
            reviewer_id = validate_reviewer_identity_fields(audit, label, reviewer)
            if reviewer_id is not None:
                audit.require(reviewer_id not in reviewer_ids, f"{label}.id must be unique")
                reviewer_ids.add(reviewer_id)
                audit.require(reviewer_id != task.get("owner"), f"{label} must be independent from owner")
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
                review_is_file = current_path_is_file(review_file)
                audit.require(
                    review_is_file,
                    f"{label}.evidencePath does not exist",
                )
                if terminal_commit:
                    validate_frozen_repository_artifact(
                        audit,
                        task_id,
                        terminal_commit,
                        review_path,
                    )
                if review_is_file:
                    try:
                        review_text = read_repository_text(review_file)
                        match = TASK_BLOCK_RE.search(review_text)
                        audit.require(bool(match), f"{label}.evidencePath lacks fenced YAML metadata")
                        review_data = strict_yaml_load(match.group(1)) if match else {}
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
        TASK_LEDGER_PATH,
        f"docs/evidence/{task_id}/**",
        f"docs/handoffs/{task_id}.json",
    )
    for path in closure_paths:
        audit.require(
            any(glob_matches(path, pattern) for pattern in allowed_closure),
            f"{task_id}: unverified implementation change after headCommit: {path}",
        )


def validate_draft_base_anchor(
    audit: Audit,
    task_id: str,
    base_commit: str,
    terminal_commit: str | None,
) -> None:
    audit.require(
        terminal_commit is not None and base_commit == terminal_commit,
        f"{task_id}: DRAFT baseCommit must equal the last terminal boundary commit",
    )


def validate_draft_checkpoint(
    audit: Audit,
    task: dict[str, Any],
    last_terminal_task: dict[str, Any] | None,
    tasks: dict[str, dict[str, Any]],
    lifecycle: dict[str, Any],
) -> None:
    task_id = str(task.get("taskId", ""))
    task_path = str(task.get("_path", ""))
    context_path = str(task.get("contextLock", ""))
    terminal_commit: str | None = None
    if last_terminal_task is not None:
        try:
            terminal_commit = canonical_terminal_commit(
                last_terminal_task,
                {"ACCEPTED", "REJECTED"},
            )
        except HarnessError as exc:
            audit.error(f"{task_id}: cannot derive last terminal boundary: {exc}")
    validate_draft_base_anchor(
        audit,
        task_id,
        str(task.get("baseCommit", "")),
        terminal_commit,
    )
    if task.get("planningBacklog") == TASK_BACKLOG_PATH:
        try:
            planned = task_metadata_at_commit(
                str(task.get("baseCommit", "")),
                task_path,
            )
            audit.require(
                planned.get("state") == "PLANNED",
                f"{task_id}: backlog-managed DRAFT must originate from a PLANNED "
                "card at Base Commit",
            )
            for field in (
                "taskId",
                "owner",
                "planningBacklog",
                "planningContractHash",
                "planningContractHashAlgorithm",
            ):
                audit.require(
                    planned.get(field) == task.get(field),
                    f"{task_id}: PLANNED contract binding changed during DRAFT "
                    f"promotion: {field}",
                )
            validate_backlog_draft_promotion_at_base(
                audit,
                task,
                tasks,
                lifecycle,
            )
        except (HarnessError, UnicodeError, yaml.YAMLError) as exc:
            audit.error(
                f"{task_id}: cannot validate PLANNED to DRAFT promotion: {exc}"
            )
    try:
        changed = changed_paths(str(task.get("baseCommit", "")))
    except (HarnessError, OSError) as exc:
        audit.error(f"{task_id}: cannot validate DRAFT checkpoint: {exc}")
        return
    allowed = {task_path, context_path}
    audit.require(task_path in changed, f"{task_id}: DRAFT checkpoint must include the task card")
    audit.require(
        set(changed) <= allowed,
        f"{task_id}: DRAFT checkpoint may contain only task card and Context Lock: "
        f"{sorted(set(changed) - allowed)}",
    )
    validate_history_path_allowlist(
        audit,
        str(task.get("baseCommit", "")),
        "HEAD",
        allowed,
        f"{task_id}: DRAFT history",
    )


def validate_project_state_mutation_policy(
    audit: Audit,
    task: dict[str, Any],
    target_commit: str | None,
) -> None:
    task_id = str(task.get("taskId", ""))
    base_commit = str(task.get("baseCommit", ""))
    approvals = task.get("humanApprovals")
    approvals = approvals if isinstance(approvals, list) else []
    harness_approved = any(
        isinstance(item, dict)
        and item.get("scope") == "harness-change"
        and is_canonical_identity(item.get("approvedBy"))
        and is_valid_approval_timestamp(item.get("approvedAt"))
        and isinstance(item.get("evidence"), str)
        and bool(item.get("evidence").strip())
        for item in approvals
    )
    full_harness_authority = (
        task.get("riskClass") == "C4"
        and "harness-change" in task_required_skills(task)
        and harness_approved
        and task.get("independentReview") in (True, "required", "REQUIRED")
    )
    try:
        baseline = yaml_at_commit(base_commit, PROJECT_STATE_PATH)
    except HarnessError as exc:
        audit.require(
            full_harness_authority and task_id == "TASK-0002",
            f"{task_id}: cannot establish project-state baseline: {exc}",
        )
        return
    try:
        candidate = (
            yaml_at_commit(target_commit, PROJECT_STATE_PATH)
            if target_commit
            else load_yaml(ROOT / PROJECT_STATE_PATH)
        )
    except HarnessError as exc:
        audit.error(f"{task_id}: cannot load candidate project-state: {exc}")
        return
    if not full_harness_authority:
        baseline_projection = project_state_closure_projection(baseline)
        history_target = target_commit or "HEAD"
        history = git_text(
            "rev-list",
            "--topo-order",
            "--reverse",
            f"{base_commit}..{history_target}",
        ).stdout.splitlines()
        for commit in history:
            try:
                historical = yaml_at_commit(commit.strip(), PROJECT_STATE_PATH)
                audit.require(
                    project_state_closure_projection(historical)
                    == baseline_projection,
                    f"{task_id}: protected project-state fields changed in commit "
                    f"{commit.strip()} without C4 harness authority",
                )
            except HarnessError as exc:
                audit.error(
                    f"{task_id}: cannot validate project-state history at "
                    f"{commit.strip()}: {exc}"
                )
        audit.require(
            baseline_projection
            == project_state_closure_projection(candidate),
            f"{task_id}: only a C4 harness-change task may modify protected project-state fields",
        )


def validate_diff_scope(
    audit: Audit,
    task: dict[str, Any],
    skills: dict[str, dict[str, Any]],
    protected_rules: list[dict[str, Any]],
    changed_override: list[str] | None = None,
    target_commit: str | None = None,
) -> None:
    task_id = str(task.get("taskId"))
    try:
        if changed_override is not None:
            changed = changed_override
        else:
            base_commit = str(task.get("baseCommit", ""))
            changed = sorted(
                set(changed_paths_across_history(base_commit, "HEAD"))
                | set(changed_paths(base_commit))
            )
    except (HarnessError, OSError) as exc:
        audit.error(f"{task_id}: cannot calculate diff scope: {exc}")
        return
    if target_commit is None:
        validate_current_index_snapshot(audit, task_id, changed)
        portable_paths = repository_index_paths()
        portable_label = f"{task_id}: staged repository snapshot"
    else:
        portable_paths = repository_paths_at_commit(target_commit)
        portable_label = f"{task_id}: reviewed repository snapshot"
    validate_portable_path_collisions(
        audit,
        portable_label,
        portable_paths,
    )
    validate_changed_path_modes(
        audit,
        task_id,
        str(task.get("baseCommit", "")),
        target_commit or "HEAD",
        changed,
        include_current_index=target_commit is None,
    )
    allowlist, amendment_exact_paths = effective_task_write_scope(task)
    forbidden = [str(item) for item in task.get("forbiddenPaths", [])]
    required_skills = set(task_required_skills(task))
    approvals = task.get("humanApprovals")
    approvals = approvals if isinstance(approvals, list) else []
    reviewers = task.get("reviewers")
    reviewers = reviewers if isinstance(reviewers, list) else []
    independent_declared = task.get("independentReview") in (True, "required", "REQUIRED")
    if PROJECT_STATE_PATH in changed:
        validate_project_state_mutation_policy(audit, task, target_commit)

    for path in changed:
        audit.require(
            path in amendment_exact_paths
            or any(glob_matches(path, pattern) for pattern in allowlist),
            f"{task_id}: changed path is outside writeAllowlist: {path}",
        )
        audit.require(
            not any(glob_matches(path, pattern) for pattern in forbidden),
            f"{task_id}: changed path is forbidden: {path}",
        )
        for rule in protected_rules:
            if not glob_matches(path, str(rule.get("glob", ""))):
                continue
            lifecycle_exemptions = rule.get("lifecycleExemptions", [])
            lifecycle_exemptions = (
                lifecycle_exemptions if isinstance(lifecycle_exemptions, list) else []
            )
            if path in lifecycle_exemptions:
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
                    and is_canonical_identity(item.get("approvedBy"))
                    and is_valid_approval_timestamp(item.get("approvedAt"))
                    and isinstance(item.get("evidence"), str)
                    and bool(item.get("evidence").strip())
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


def select_task_for_diff_scope(
    audit: Audit,
    explicit_task: str | None,
    active_task: str | None,
    pending_draft: str | None,
    last_terminal_task: str,
    tasks: dict[str, dict[str, Any]],
) -> str:
    if (
        explicit_task
        and explicit_task in tasks
        and is_planning_only_task(tasks[explicit_task])
    ):
        planning_state = tasks[explicit_task].get("state")
        audit.error(
            f"explicit task {explicit_task} is planning-only {planning_state} "
            "and cannot be executed or selected for diff-scope validation"
        )
    if explicit_task and active_task and explicit_task != active_task:
        audit.error(
            f"explicit task {explicit_task} cannot replace activeTask "
            f"{active_task} for diff-scope validation"
        )
    if (
        explicit_task
        and not active_task
        and explicit_task != (pending_draft or last_terminal_task)
    ):
        audit.error(
            f"explicit task {explicit_task} cannot replace selected task "
            f"{pending_draft or last_terminal_task} when no task is active"
        )
    return active_task or pending_draft or last_terminal_task


def print_summary(
    state: dict[str, Any],
    tasks: dict[str, dict[str, Any]],
    backlog_projection: dict[str, Any] | None = None,
) -> None:
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
    if backlog_projection:
        next_promotable = backlog_projection.get("nextPromotable") or "NONE"
        print(
            f"Backlog: {backlog_projection.get('plannedCount', 0)} PLANNED | "
            f"Next promotable: {next_promotable}"
        )
    gates = state.get("capabilityGates") or {}
    for gate_id, gate in gates.items():
        if isinstance(gate, dict):
            print(f"Gate {gate_id}: {gate.get('state')} — {gate.get('reason')}")


def main() -> int:
    configure_utf8_stdio()
    parser = argparse.ArgumentParser(description="Validate the portable Agent Harness")
    parser.add_argument("--task", help="Task ID whose diff scope must be validated")
    parser.add_argument("--summary", action="store_true", help="Print recoverable project status")
    parser.add_argument(
        "--pre-closure",
        action="store_true",
        help="Allow an otherwise valid terminal worktree before its terminal commit exists",
    )
    args = parser.parse_args()
    audit = Audit()
    backlog_projection: dict[str, Any] = {}
    try:
        with doctor_git_snapshot() as snapshot:
            try:
                with timed_phase("load project and tasks"):
                    lifecycle = load_yaml(ROOT / ".harness/task-lifecycle.yaml")
                    state = load_yaml(ROOT / ".harness/project-state.yaml")
                    tasks = discover_tasks()
                    validate_tasks(audit, tasks, lifecycle)

                with timed_phase("authorized task history"):
                    validate_authorized_task_history(audit, tasks)

                with timed_phase("task ledger history"):
                    validate_task_ledger(
                        audit,
                        tasks,
                        lifecycle,
                        allow_uncommitted_terminal=args.pre_closure,
                    )

                with timed_phase("task boundaries and project state"):
                    validate_task_base_handoff_anchors(audit, tasks, lifecycle)
                    validate_active_task_base_freshness(audit, tasks, lifecycle)
                    active_task = validate_project_state(audit, state, lifecycle, tasks)
                    backlog_projection = validate_task_backlog(
                        audit,
                        tasks,
                        lifecycle,
                        state,
                    )

                with timed_phase("skills sources and entrypoints"):
                    skills, protected_rules = validate_skills(audit, tasks)
                    validate_sources(audit, tasks)
                    validate_task_delivery_policy(audit)
                    validate_harness_runtime(audit)
                    validate_entrypoints(audit)
                    validate_commands(audit)

                draft_tasks = validate_pending_draft_limit(
                    audit,
                    tasks,
                    lifecycle,
                )
                pending_draft = draft_tasks[0] if len(draft_tasks) == 1 else None

                with timed_phase("evidence and handoffs"):
                    validate_evidence_and_handoffs(
                        audit,
                        tasks,
                        lifecycle,
                        protected_rules,
                        allow_pending_draft=pending_draft is not None,
                    )

                with timed_phase("selected task diff scope"):
                    last_terminal_task = str(state.get("lastTerminalTask", ""))
                    selected_task_id = select_task_for_diff_scope(
                        audit,
                        args.task,
                        active_task,
                        pending_draft,
                        last_terminal_task,
                        tasks,
                    )
                    if selected_task_id not in tasks:
                        audit.error(f"selected task does not exist: {selected_task_id}")
                    else:
                        selected_task = tasks[selected_task_id]
                        if selected_task.get("state") == "DRAFT":
                            validate_draft_checkpoint(
                                audit,
                                selected_task,
                                tasks.get(last_terminal_task),
                                tasks,
                                lifecycle,
                            )
                        validate_diff_scope(
                            audit,
                            selected_task,
                            skills,
                            effective_protected_rules(
                                audit,
                                selected_task,
                                protected_rules,
                            ),
                        )
                if args.summary:
                    print_summary(state, tasks, backlog_projection)
            finally:
                snapshot.verify_unchanged(audit)
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

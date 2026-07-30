from __future__ import annotations

import copy
from contextlib import redirect_stderr, redirect_stdout
from datetime import datetime
import io
import json
import os
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
from zoneinfo import ZoneInfo

import yaml
from pathlib import Path

HARNESS_DIR = Path(__file__).resolve().parents[1]
ROOT = HARNESS_DIR.parents[1]
sys.path.insert(0, str(HARNESS_DIR))

import catalog_tool  # noqa: E402
import check_beta_gate  # noqa: E402
import doctor  # noqa: E402
import harness_common  # noqa: E402
import precheck  # noqa: E402
from check_beta_gate import (  # noqa: E402
    canonical_secret_reference,
    is_secret_reference,
    parse_aware_timestamp,
    projection_error,
)
from check_paid_features import PRUNED_DIRS, discover_files  # noqa: E402
from doctor import (  # noqa: E402
    Audit,
    canonical_exact_repo_path,
    canonical_json_sha256,
    changed_skill_tree_ids,
    current_regular_file_bytes,
    derive_backlog_promotion_projection,
    derive_immutable_backlog_history_policy,
    effective_task_write_allowlist,
    effective_task_write_scope,
    effective_protected_rules,
    first_existing_zed_instruction_path,
    is_review_evidence_path,
    intervening_terminal_boundaries,
    project_state_closure_projection,
    project_state_ready_projection,
    repository_index_paths,
    select_task_for_diff_scope,
    sha256_text,
    task_authorization_projection,
    task_acceptance_clauses,
    unique_json_object,
    validate_diff_scope,
    validate_draft_base_anchor,
    validate_authorization_precedes_head,
    validate_authorized_task_history,
    validate_authorized_task_presence,
    validate_active_task_base_freshness,
    validate_backlog_history_edge,
    validate_backlog_authorization_amendments,
    validate_backlog_authorization_amendment_edge,
    validate_backlog_card_history_edge,
    validate_backlog_resolution_commit,
    validate_backlog_draft_promotion_at_base,
    validate_frozen_artifact_bytes,
    validate_command_registry,
    validate_check_artifact,
    validate_changed_path_modes,
    validate_evidence_check,
    validate_entrypoints,
    validate_idle_terminal_paths,
    validate_idle_terminal_history,
    validate_json_schema,
    validate_ledger_history,
    validate_ledger_edge,
    validate_nonblank_text,
    validate_portable_path_collisions,
    validate_pending_draft_limit,
    validate_project_state,
    validate_project_state_mutation_policy,
    validate_required_command_coverage,
    validate_ready_context_lock_bytes,
    validate_ready_parent_projection,
    validate_reviewer_identity_fields,
    validate_scope_amendment_edge,
    validate_scope_amendments,
    validate_uncommitted_scope_amendments,
    validate_authorization_amendment_contract,
    planned_card_render_projection,
    validate_skills,
    validate_sources,
    validate_task_delivery_policy,
    validate_tasks,
    validate_task_authorization_history,
    validate_task_backlog_data,
    validate_task_backlog,
    validate_task_backlog_history,
    validate_task_ledger_entries,
    validate_terminal_commit_requirement,
    validate_terminal_history_dominance,
    validate_amendment_introduction,
)
from harness_common import (  # noqa: E402
    HarnessError,
    discover_tasks,
    glob_matches,
    is_repository_relative,
    load_yaml,
    normalize_repo_path,
    strict_yaml_load,
    TASK_BLOCK_RE,
    task_id_from_filename,
    verify_context_lock,
)


class PathPolicyTests(unittest.TestCase):
    def test_frozen_artifact_must_be_regular_non_reparse_file(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            audit = Audit()
            self.assertIsNone(
                current_regular_file_bytes(audit, "fixture", Path(directory))
            )
            self.assertTrue(any("regular non-reparse" in error for error in audit.errors))

    def test_rename_diff_exposes_both_forbidden_source_and_allowed_target(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            repository = Path(directory)
            subprocess.run(["git", "init", "-q"], cwd=repository, check=True)
            subprocess.run(["git", "config", "user.name", "Harness Test"], cwd=repository, check=True)
            subprocess.run(
                ["git", "config", "user.email", "harness@example.invalid"],
                cwd=repository,
                check=True,
            )
            source = repository / "specs/catalog/x.yaml"
            source.parent.mkdir(parents=True)
            source.write_text("schemaVersion: 1\n", encoding="utf-8")
            subprocess.run(["git", "add", "--", "."], cwd=repository, check=True)
            subprocess.run(["git", "commit", "-qm", "base"], cwd=repository, check=True)
            target = repository / "docs/x.yaml"
            target.parent.mkdir(parents=True)
            source.rename(target)
            subprocess.run(["git", "add", "-A"], cwd=repository, check=True)
            result = subprocess.run(
                ["git", "diff", "--cached", "--no-renames", "--name-only", "-z"],
                cwd=repository,
                stdout=subprocess.PIPE,
                check=True,
            )
            paths = {item.decode("utf-8") for item in result.stdout.split(b"\0") if item}
            self.assertEqual({"specs/catalog/x.yaml", "docs/x.yaml"}, paths)

    def test_repository_paths_reject_drive_relative_unc_and_parent_escape(self) -> None:
        for value in (
            "C:outside.yaml",
            "C:/outside.yaml",
            r"C:\outside.yaml",
            r"\\server\share\outside.yaml",
            "../outside.yaml",
            r"safe\..\..\outside.yaml",
            ".git/config",
        ):
            self.assertFalse(is_repository_relative(value), value)
        self.assertTrue(is_repository_relative("docs/tasks/TASK-0001-project-bootstrap.md"))

    def test_dot_prefixed_repository_paths_are_preserved(self) -> None:
        self.assertEqual(".harness/project-state.yaml", normalize_repo_path(".harness/project-state.yaml"))
        self.assertEqual(".github/workflows/ci.yml", normalize_repo_path("./.github/workflows/ci.yml"))

    def test_recursive_globs_cover_expected_paths_only(self) -> None:
        self.assertTrue(glob_matches("service/a/b/safety/rule.py", "service/**/safety/**"))
        self.assertTrue(glob_matches("service/safety/rule.py", "service/**/safety/**"))
        self.assertTrue(glob_matches("db/migration/V1.sql", "**/db/migration/**"))
        self.assertTrue(glob_matches("service/x/db/migration/V1.sql", "**/db/migration/**"))
        self.assertTrue(glob_matches(".harness/commands.yaml", ".harness/**"))
        self.assertFalse(glob_matches("frontend/src/main.ts", ".harness/**"))

    def test_portable_path_collisions_are_rejected(self) -> None:
        audit = Audit()
        validate_portable_path_collisions(
            audit,
            "fixture",
            ["docs/evidence/Review.md", "docs/evidence/review.md"],
        )
        self.assertTrue(any("collide on Windows/macOS" in error for error in audit.errors))

    def test_windows_invalid_path_components_are_rejected(self) -> None:
        for path in (
            "docs/evidence/TASK-9999/CON.md",
            "docs/evidence/TASK-9999/aux.txt",
            "docs/evidence/TASK-9999/review.",
            "docs/evidence/TASK-9999/review ",
            "docs/evidence/TASK-9999/review:one.md",
            r"docs/evidence/TASK-9999/foo\bar.md",
        ):
            audit = Audit()
            validate_portable_path_collisions(audit, "fixture", [path])
            self.assertTrue(
                any(
                    "not portable to Windows" in error
                    or "non-portable backslash" in error
                    for error in audit.errors
                ),
                path,
            )

    def test_snapshot_collector_preserves_nonportable_git_path_bytes(self) -> None:
        raw = b"foo\\bar.py\0foo/bar.py\0bad\xff.txt\0"
        result = subprocess.CompletedProcess(
            args=["git", "ls-files", "-z"],
            returncode=0,
            stdout=raw,
            stderr=b"",
        )
        with patch.object(doctor, "git_bytes", return_value=result):
            paths = repository_index_paths()
        self.assertIn(r"foo\bar.py", paths)
        audit = Audit()
        validate_portable_path_collisions(audit, "fixture", paths)
        messages = "\n".join(audit.errors)
        self.assertIn("non-portable backslash", messages)
        self.assertIn("not valid portable UTF-8", messages)

    def test_zed_uses_first_existing_official_priority_entrypoint(self) -> None:
        self.assertEqual("AGENTS.md", first_existing_zed_instruction_path())
        with tempfile.TemporaryDirectory() as directory:
            repository = Path(directory)
            (repository / "AGENTS.md").write_text("# canonical\n", encoding="utf-8")
            adapter = repository / ".github/copilot-instructions.md"
            adapter.parent.mkdir(parents=True)
            adapter.write_text("Read AGENTS.md\n", encoding="utf-8")
            with patch.object(doctor, "ROOT", repository):
                self.assertEqual(
                    ".github/copilot-instructions.md",
                    first_existing_zed_instruction_path(),
                )
                (repository / ".rules").write_text("higher priority\n", encoding="utf-8")
                self.assertEqual(".rules", first_existing_zed_instruction_path())

    def test_copilot_cli_registers_both_merged_discovery_mechanisms(self) -> None:
        audit = Audit()
        validate_entrypoints(audit)
        self.assertEqual([], audit.errors)

        config = copy.deepcopy(
            load_yaml(ROOT / ".harness/agent-entrypoints.yaml")
        )
        del config["clients"]["githubCopilotCliAgentInstructions"]
        mutated = Audit()
        with patch.object(doctor, "load_yaml", return_value=config):
            validate_entrypoints(mutated)
        self.assertTrue(
            any(
                "client discovery mechanisms must be explicit and complete"
                in error
                for error in mutated.errors
            ),
            mutated.errors,
        )

    def test_copilot_cli_merge_semantics_cannot_drift(self) -> None:
        config = copy.deepcopy(
            load_yaml(ROOT / ".harness/agent-entrypoints.yaml")
        )
        config["clients"]["githubCopilotCliClaudeImport"][
            "discoverySemantics"
        ] = "FIRST_MATCH"
        audit = Audit()
        with patch.object(doctor, "load_yaml", return_value=config):
            validate_entrypoints(audit)
        self.assertTrue(
            any(
                "merge-all discovery semantics" in error
                for error in audit.errors
            ),
            audit.errors,
        )


class GitHistoryPolicyTests(unittest.TestCase):
    @staticmethod
    def _git(repository: Path, *args: str) -> str:
        result = subprocess.run(
            ["git", *args],
            cwd=repository,
            text=True,
            encoding="utf-8",
            errors="replace",
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=True,
        )
        return result.stdout.strip()

    def _repository(self, directory: str) -> Path:
        repository = Path(directory)
        self._git(repository, "init", "-q")
        self._git(repository, "config", "user.name", "Harness Test")
        self._git(repository, "config", "user.email", "harness@example.invalid")
        return repository

    @staticmethod
    def _write_task(repository: Path, state: str) -> None:
        task_path = repository / "docs/tasks/TASK-9999-policy.md"
        task_path.parent.mkdir(parents=True, exist_ok=True)
        task_path.write_text(
            "# Policy fixture\n\n"
            "```yaml\n"
            "taskId: TASK-9999\n"
            f"state: {state}\n"
            "```\n",
            encoding="utf-8",
        )

    def test_parallel_terminal_branch_cannot_bypass_canonical_boundary(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            repository = self._repository(directory)
            self._write_task(repository, "IN_REVIEW")
            self._git(repository, "add", ".")
            self._git(repository, "commit", "-qm", "base")
            base = self._git(repository, "rev-parse", "HEAD")

            self._git(repository, "checkout", "-qb", "terminal-a")
            self._write_task(repository, "ACCEPTED")
            self._git(repository, "add", ".")
            self._git(repository, "commit", "-qm", "terminal a")
            canonical = self._git(repository, "rev-parse", "HEAD")

            self._git(repository, "checkout", "-qb", "terminal-b", base)
            self._write_task(repository, "ACCEPTED")
            self._git(repository, "add", ".")
            self._git(repository, "commit", "-qm", "terminal b")
            self._git(repository, "checkout", "-q", "terminal-a")
            self._git(repository, "merge", "--no-ff", "terminal-b", "-qm", "merge")

            audit = Audit()
            with (
                patch.object(harness_common, "ROOT", repository),
                patch.object(doctor, "ROOT", repository),
            ):
                validate_terminal_history_dominance(
                    audit,
                    "TASK-9999",
                    "docs/tasks/TASK-9999-policy.md",
                    base,
                    canonical,
                    {"ACCEPTED", "REJECTED"},
                )
            self.assertTrue(
                any("outside its canonical terminal boundary" in error for error in audit.errors)
            )

    def test_parallel_ready_branch_must_descend_from_authorization(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            repository = self._repository(directory)
            self._write_task(repository, "DRAFT")
            self._git(repository, "add", ".")
            self._git(repository, "commit", "-qm", "base")
            base = self._git(repository, "rev-parse", "HEAD")

            self._git(repository, "checkout", "-qb", "ready-a")
            self._write_task(repository, "READY")
            self._git(repository, "add", ".")
            self._git(repository, "commit", "-qm", "ready a")
            authorization = self._git(repository, "rev-parse", "HEAD")
            authorized_text = self._git(
                repository,
                "show",
                f"{authorization}:docs/tasks/TASK-9999-policy.md",
            )

            self._git(repository, "checkout", "-qb", "ready-b", base)
            self._write_task(repository, "READY")
            self._git(repository, "add", ".")
            self._git(repository, "commit", "-qm", "ready b")
            self._git(repository, "checkout", "-q", "ready-a")
            self._git(repository, "merge", "--no-ff", "ready-b", "-qm", "merge")

            audit = Audit()
            with (
                patch.object(harness_common, "ROOT", repository),
                patch.object(doctor, "ROOT", repository),
            ):
                validate_task_authorization_history(
                    audit,
                    "TASK-9999",
                    "docs/tasks/TASK-9999-policy.md",
                    base,
                    authorization,
                    authorized_text,
                )
            self.assertTrue(
                any("outside the authorizationCommit ancestry" in error for error in audit.errors)
            )

    def test_merge_parent_cannot_gain_retroactive_scope_amendment(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            repository = self._repository(directory)
            task_path = repository / "docs/tasks/TASK-9999-policy.md"
            backlog_path = repository / ".harness/task-backlog.yaml"
            task_path.parent.mkdir(parents=True, exist_ok=True)
            backlog_path.parent.mkdir(parents=True, exist_ok=True)
            backlog_path.write_text("schemaVersion: 1\n", encoding="utf-8")

            def write_task(state: str, amendments: list[dict[str, object]]) -> None:
                metadata = {
                    "taskId": "TASK-9999",
                    "state": state,
                    "owner": "repository-owner",
                    "writeAllowlist": [
                        "docs/tasks/TASK-9999-policy.md",
                    ],
                    "forbiddenPaths": [],
                    "scopeAmendments": amendments,
                }
                task_path.write_text(
                    "# TASK-9999：Policy fixture\n\n"
                    "```yaml\n"
                    + yaml.safe_dump(
                        metadata,
                        allow_unicode=True,
                        sort_keys=False,
                    )
                    + "```\n\n"
                    "## 验收标准\n\n"
                    "1. Original authorization remains immutable.\n",
                    encoding="utf-8",
                )

            write_task("DRAFT", [])
            self._git(repository, "add", ".")
            self._git(repository, "commit", "-qm", "base")
            base = self._git(repository, "rev-parse", "HEAD")

            self._git(repository, "checkout", "-qb", "side")
            (repository / "outside.txt").write_text("changed first\n", encoding="utf-8")
            self._git(repository, "add", ".")
            self._git(repository, "commit", "-qm", "side changes outside path")

            self._git(repository, "checkout", "-qb", "mainline", base)
            write_task("READY", [])
            self._git(repository, "add", ".")
            self._git(repository, "commit", "-qm", "ready")
            authorization = self._git(repository, "rev-parse", "HEAD")
            authorized_text = task_path.read_text(encoding="utf-8")

            self._git(repository, "merge", "--no-ff", "--no-commit", "side")
            write_task(
                "READY",
                [
                    {
                        "amendmentId": "task-9999-owner-outside",
                        "approvedBy": "repository-owner",
                        "approvedAt": "2026-07-30",
                        "evidence": "Owner evidence",
                        "reason": "Attempted retroactive grant",
                        "addedWriteAllowlist": ["outside.txt"],
                        "acceptanceAdditions": ["audit note only"],
                    }
                ],
            )
            self._git(repository, "add", ".")
            self._git(repository, "commit", "-qm", "merge with amendment")

            audit = Audit()
            with (
                patch.object(harness_common, "ROOT", repository),
                patch.object(doctor, "ROOT", repository),
            ):
                validate_task_authorization_history(
                    audit,
                    "TASK-9999",
                    "docs/tasks/TASK-9999-policy.md",
                    base,
                    authorization,
                    authorized_text,
                )
            messages = "\n".join(audit.errors)
            self.assertIn("single-parent atomic governance commit", messages)
            self.assertIn(
                "retired legacy scope amendment is an immutable audit record only "
                "and cannot grant write authority",
                messages,
            )

    def test_historical_alternate_task_path_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            repository = self._repository(directory)
            self._write_task(repository, "DRAFT")
            self._git(repository, "add", ".")
            self._git(repository, "commit", "-qm", "base")
            self._write_task(repository, "READY")
            self._git(repository, "add", ".")
            self._git(repository, "commit", "-qm", "ready")
            authorization = self._git(repository, "rev-parse", "HEAD")

            self._git(repository, "checkout", "-qb", "alternate-task")
            alternate = repository / "docs/tasks/TASK-9999-evil.md"
            alternate.write_text(
                "# Alternate\n\n```yaml\n"
                "taskId: TASK-9999\n"
                "state: ACCEPTED\n"
                "```\n",
                encoding="utf-8",
            )
            self._git(repository, "add", ".")
            self._git(repository, "commit", "-qm", "alternate terminal task")
            self._git(repository, "checkout", "-q", "-b", "mainline", authorization)
            self._git(
                repository,
                "merge",
                "--no-ff",
                "-s",
                "ours",
                "alternate-task",
                "-qm",
                "discard alternate tree",
            )

            audit = Audit()
            with (
                patch.object(harness_common, "ROOT", repository),
                patch.object(doctor, "ROOT", repository),
            ):
                validate_authorized_task_history(
                    audit,
                    harness_common.discover_tasks(),
                )
            self.assertTrue(
                any(
                    "duplicate taskId" in error
                    or "non-canonical non-DRAFT paths" in error
                    for error in audit.errors
                )
            )

    def test_idle_terminal_rejects_any_head_advance(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            repository = self._repository(directory)
            fixture = repository / "fixture.txt"
            fixture.write_text("stable\n", encoding="utf-8")
            self._git(repository, "add", ".")
            self._git(repository, "commit", "-qm", "terminal")
            terminal = self._git(repository, "rev-parse", "HEAD")
            self._git(repository, "commit", "--allow-empty", "-qm", "empty advance")

            audit = Audit()
            with (
                patch.object(harness_common, "ROOT", repository),
                patch.object(doctor, "ROOT", repository),
            ):
                validate_idle_terminal_history(audit, "TASK-9999", terminal)
            self.assertTrue(
                any("HEAD advanced after terminal commit" in error for error in audit.errors)
            )

    def test_staged_symlink_mode_cannot_hide_behind_regular_worktree(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            repository = self._repository(directory)
            fixture = repository / "fixture.txt"
            fixture.write_text("regular file\n", encoding="utf-8")
            self._git(repository, "add", ".")
            self._git(repository, "commit", "-qm", "base")
            base = self._git(repository, "rev-parse", "HEAD")
            oid = self._git(repository, "hash-object", "fixture.txt")
            self._git(
                repository,
                "update-index",
                "--cacheinfo",
                f"120000,{oid},fixture.txt",
            )

            audit = Audit()
            with (
                patch.object(harness_common, "ROOT", repository),
                patch.object(doctor, "ROOT", repository),
            ):
                validate_changed_path_modes(
                    audit,
                    "TASK-9999",
                    base,
                    "HEAD",
                    ["fixture.txt"],
                    include_current_index=True,
                )
            self.assertTrue(
                any("unauthorized Git mode" in error for error in audit.errors)
            )

    def test_doctor_snapshot_caches_commit_tree_and_blob_within_one_run(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            repository = self._repository(directory)
            (repository / "one.txt").write_text("same\n", encoding="utf-8")
            (repository / "two.txt").write_text("same\n", encoding="utf-8")
            self._git(repository, "add", ".")
            self._git(repository, "commit", "-qm", "base")
            head = self._git(repository, "rev-parse", "HEAD")
            original_git_bytes = doctor.git_bytes
            calls: list[tuple[str, ...]] = []

            def counting_git_bytes(
                *args: str,
                check: bool = True,
            ) -> subprocess.CompletedProcess[bytes]:
                calls.append(tuple(args))
                return original_git_bytes(*args, check=check)

            with (
                patch.object(harness_common, "ROOT", repository),
                patch.object(doctor, "ROOT", repository),
                patch.object(doctor, "git_bytes", side_effect=counting_git_bytes),
            ):
                with doctor.doctor_git_snapshot():
                    self.assertIsNotNone(doctor.git_tree_entry(head, "one.txt"))
                    self.assertIsNotNone(doctor.git_tree_entry(head, "two.txt"))
                    self.assertEqual(b"same\n", doctor.git_object(head, "one.txt"))
                    self.assertEqual(b"same\n", doctor.git_object(head, "two.txt"))

            tree_calls = [call for call in calls if call[:3] == ("ls-tree", "-r", "-z")]
            blob_calls = [call for call in calls if call[:2] == ("cat-file", "blob")]
            self.assertEqual(1, len(tree_calls), calls)
            self.assertEqual(1, len(blob_calls), calls)
            self.assertIsNone(doctor._ACTIVE_GIT_SNAPSHOT)

    def test_doctor_snapshot_fails_closed_when_index_or_worktree_changes(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            repository = self._repository(directory)
            fixture = repository / "fixture.txt"
            fixture.write_text("base\n", encoding="utf-8")
            self._git(repository, "add", ".")
            self._git(repository, "commit", "-qm", "base")

            with (
                patch.object(harness_common, "ROOT", repository),
                patch.object(doctor, "ROOT", repository),
            ):
                with doctor.doctor_git_snapshot() as snapshot:
                    fixture.write_text("changed\n", encoding="utf-8")
                    self._git(repository, "add", "fixture.txt")
                    audit = Audit()
                    snapshot.verify_unchanged(audit)

            messages = "\n".join(audit.errors)
            self.assertIn("Git index changed during validation", messages)
            self.assertIn("worktree changed during validation", messages)
            self.assertIsNone(doctor._ACTIVE_GIT_SNAPSHOT)

    def test_doctor_snapshot_fails_closed_when_head_changes(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            repository = self._repository(directory)
            (repository / "fixture.txt").write_text("base\n", encoding="utf-8")
            self._git(repository, "add", ".")
            self._git(repository, "commit", "-qm", "base")

            with (
                patch.object(harness_common, "ROOT", repository),
                patch.object(doctor, "ROOT", repository),
            ):
                with doctor.doctor_git_snapshot() as snapshot:
                    self._git(repository, "commit", "--allow-empty", "-qm", "new head")
                    audit = Audit()
                    snapshot.verify_unchanged(audit)

            self.assertIn(
                "doctor snapshot: HEAD changed during validation",
                audit.errors,
            )
            self.assertIsNone(doctor._ACTIVE_GIT_SNAPSHOT)

    def test_doctor_snapshot_binds_dirty_tracked_candidate_content(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            repository = self._repository(directory)
            fixture = repository / "fixture.txt"
            fixture.write_text("base\n", encoding="utf-8")
            self._git(repository, "add", ".")
            self._git(repository, "commit", "-qm", "base")
            fixture.write_text("dirty-a\n", encoding="utf-8")

            with (
                patch.object(harness_common, "ROOT", repository),
                patch.object(doctor, "ROOT", repository),
            ):
                with doctor.doctor_git_snapshot() as snapshot:
                    fixture.write_text("dirty-b\n", encoding="utf-8")
                    audit = Audit()
                    snapshot.verify_unchanged(audit)

            self.assertIn(
                "doctor snapshot: worktree changed during validation",
                audit.errors,
            )

    def test_doctor_snapshot_binds_untracked_candidate_content(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            repository = self._repository(directory)
            (repository / "tracked.txt").write_text("base\n", encoding="utf-8")
            self._git(repository, "add", ".")
            self._git(repository, "commit", "-qm", "base")
            candidate = repository / "candidate.txt"
            candidate.write_text("untracked-a\n", encoding="utf-8")

            with (
                patch.object(harness_common, "ROOT", repository),
                patch.object(doctor, "ROOT", repository),
            ):
                with doctor.doctor_git_snapshot() as snapshot:
                    candidate.write_text("untracked-b\n", encoding="utf-8")
                    audit = Audit()
                    snapshot.verify_unchanged(audit)

            self.assertIn(
                "doctor snapshot: worktree changed during validation",
                audit.errors,
            )

    def test_doctor_snapshot_validates_both_rename_or_copy_paths(self) -> None:
        oid = b"0" * 40
        record = (
            b"2 R. N... 100644 100644 100644 "
            + oid
            + b" "
            + oid
            + b" R100 target.txt\0source.txt\0"
        )
        self.assertEqual(
            (b"source.txt", b"target.txt"),
            doctor.DoctorGitSnapshot._status_candidate_paths(record),
        )
        with self.assertRaisesRegex(HarnessError, "unsafe worktree status path"):
            doctor.DoctorGitSnapshot._status_candidate_paths(
                record.replace(b"source.txt", b"../source.txt")
            )

    def test_doctor_snapshot_rejects_windows_escape_and_malformed_status(self) -> None:
        oid = b"0" * 40
        record = (
            b"2 R. N... 100644 100644 100644 "
            + oid
            + b" "
            + oid
            + b" R100 target.txt\0source.txt\0"
        )
        unsafe_variants = (
            record.replace(b"target.txt", b"..\\outside.txt"),
            record.replace(b"source.txt", b"..\\outside.txt"),
            record.replace(b"target.txt", b"C:\\outside.txt"),
            record.replace(b"source.txt", b"C:/outside.txt"),
            record.replace(b"target.txt", b"\\\\server\\share\\outside.txt"),
        )
        malformed_variants = (
            record.rstrip(b"\0"),
            record.replace(b"R100", b"R101"),
            record.replace(b"R100", b"R01"),
            record.replace(b"R.", b"ZZ"),
            record.replace(b"N...", b"XXXX"),
            record.replace(b"100644", b"777777"),
            b"# branch.oid " + oid + b"\0",
            b"! ignored.txt\0",
            record.replace(b"source.txt\0", b"source.txt\0\0"),
        )
        for raw in (*unsafe_variants, *malformed_variants):
            with self.subTest(raw=raw):
                with self.assertRaises(HarnessError):
                    doctor.DoctorGitSnapshot._status_candidate_paths(raw)

    def test_doctor_snapshot_rejects_hidden_index_flags(self) -> None:
        for flag in ("--skip-worktree", "--assume-unchanged"):
            with self.subTest(flag=flag), tempfile.TemporaryDirectory() as directory:
                repository = self._repository(directory)
                fixture = repository / "fixture.txt"
                fixture.write_text("base\n", encoding="utf-8")
                self._git(repository, "add", ".")
                self._git(repository, "commit", "-qm", "base")
                self._git(repository, "update-index", flag, "fixture.txt")
                fixture.write_text("hidden-change\n", encoding="utf-8")

                with (
                    patch.object(harness_common, "ROOT", repository),
                    patch.object(doctor, "ROOT", repository),
                    self.assertRaisesRegex(HarnessError, "hidden Git index flag"),
                ):
                    with doctor.doctor_git_snapshot():
                        pass
                self.assertIsNone(doctor._ACTIVE_GIT_SNAPSHOT)

    def test_doctor_snapshot_detects_index_flag_change_with_same_stage(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            repository = self._repository(directory)
            fixture = repository / "fixture.txt"
            fixture.write_text("base\n", encoding="utf-8")
            self._git(repository, "add", ".")
            self._git(repository, "commit", "-qm", "base")
            stage_before = self._git(repository, "ls-files", "--stage")

            with (
                patch.object(harness_common, "ROOT", repository),
                patch.object(doctor, "ROOT", repository),
            ):
                with doctor.doctor_git_snapshot() as snapshot:
                    self._git(
                        repository,
                        "update-index",
                        "--skip-worktree",
                        "fixture.txt",
                    )
                    self.assertEqual(
                        stage_before,
                        self._git(repository, "ls-files", "--stage"),
                    )
                    audit = Audit()
                    snapshot.verify_unchanged(audit)

            self.assertTrue(
                any("Git index flag" in error for error in audit.errors),
                audit.errors,
            )

    def test_doctor_snapshot_rejects_fsmonitor_valid_flags(self) -> None:
        with self.assertRaisesRegex(HarnessError, "fsmonitor-valid"):
            doctor.DoctorGitSnapshot._validate_fsmonitor_flags(
                b"h fixture.txt\0"
            )

        with tempfile.TemporaryDirectory() as directory:
            repository = self._repository(directory)
            (repository / "fixture.txt").write_text("base\n", encoding="utf-8")
            self._git(repository, "add", ".")
            self._git(repository, "commit", "-qm", "base")
            original_git_bytes = doctor.git_bytes
            fsmonitor_calls = 0

            def changing_fsmonitor(
                *args: str,
                check: bool = True,
            ) -> subprocess.CompletedProcess[bytes]:
                nonlocal fsmonitor_calls
                result = original_git_bytes(*args, check=check)
                if tuple(args[:3]) == ("ls-files", "-f", "-z"):
                    fsmonitor_calls += 1
                    if fsmonitor_calls > 1 and result.stdout:
                        return subprocess.CompletedProcess(
                            args=result.args,
                            returncode=0,
                            stdout=b"h" + result.stdout[1:],
                            stderr=result.stderr,
                        )
                return result

            with (
                patch.object(harness_common, "ROOT", repository),
                patch.object(doctor, "ROOT", repository),
                patch.object(
                    doctor,
                    "git_bytes",
                    side_effect=changing_fsmonitor,
                ),
            ):
                with doctor.doctor_git_snapshot() as snapshot:
                    audit = Audit()
                    snapshot.verify_unchanged(audit)

            self.assertTrue(
                any("fsmonitor-valid" in error for error in audit.errors),
                audit.errors,
            )

    def test_doctor_snapshot_rejects_transient_clean_and_dirty_reads(self) -> None:
        for initially_dirty in (False, True):
            with (
                self.subTest(initially_dirty=initially_dirty),
                tempfile.TemporaryDirectory() as directory,
            ):
                repository = self._repository(directory)
                fixture = repository / "fixture.txt"
                fixture.write_text("base\n", encoding="utf-8")
                self._git(repository, "add", ".")
                self._git(repository, "commit", "-qm", "base")
                expected = "dirty-a\n" if initially_dirty else "base\n"
                if initially_dirty:
                    fixture.write_text(expected, encoding="utf-8")

                with (
                    patch.object(harness_common, "ROOT", repository),
                    patch.object(doctor, "ROOT", repository),
                ):
                    with doctor.doctor_git_snapshot() as snapshot:
                        fixture.write_text(
                            "transient-malicious\n",
                            encoding="utf-8",
                        )
                        with self.assertRaisesRegex(
                            HarnessError,
                            "file changed before read",
                        ):
                            harness_common.read_repository_text(fixture)
                        fixture.write_text(expected, encoding="utf-8")
                        audit = Audit()
                        snapshot.verify_unchanged(audit)

                self.assertEqual([], audit.errors)

    def test_doctor_snapshot_reuses_first_validated_file_bytes(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            repository = self._repository(directory)
            fixture = repository / "fixture.txt"
            fixture.write_text("base\n", encoding="utf-8")
            self._git(repository, "add", ".")
            self._git(repository, "commit", "-qm", "base")
            expected = fixture.read_bytes()

            with (
                patch.object(harness_common, "ROOT", repository),
                patch.object(doctor, "ROOT", repository),
            ):
                with doctor.doctor_git_snapshot() as snapshot:
                    first = harness_common.read_repository_bytes(fixture)
                    fixture.write_bytes(b"transient-malicious")
                    second = harness_common.read_repository_bytes(fixture)
                    fixture.write_bytes(expected)
                    audit = Audit()
                    snapshot.verify_unchanged(audit)

            self.assertEqual(expected, first)
            self.assertEqual(first, second)
            self.assertEqual([], audit.errors)

    def test_doctor_snapshot_applies_git_filters_to_clean_file_reads(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            repository = self._repository(directory)
            self._git(repository, "config", "core.autocrlf", "true")
            (repository / ".gitattributes").write_text(
                "*.cmd text eol=crlf\n",
                encoding="utf-8",
            )
            fixture = repository / "fixture.cmd"
            fixture.write_bytes(b"@echo off\r\n")
            self._git(repository, "add", ".")
            self._git(repository, "commit", "-qm", "base")
            index_oid = self._git(repository, "rev-parse", ":fixture.cmd")
            raw_oid = self._git(
                repository,
                "hash-object",
                "--no-filters",
                "fixture.cmd",
            )
            self.assertNotEqual(index_oid, raw_oid)

            with (
                patch.object(harness_common, "ROOT", repository),
                patch.object(doctor, "ROOT", repository),
            ):
                with doctor.doctor_git_snapshot() as snapshot:
                    content = harness_common.read_repository_bytes(fixture)
                    self.assertEqual(
                        index_oid,
                        snapshot.current_blob_oid(fixture),
                    )
                    audit = Audit()
                    snapshot.verify_unchanged(audit)

            self.assertEqual(b"@echo off\r\n", content)
            self.assertEqual([], audit.errors)

    def test_doctor_snapshot_freezes_repository_glob_path_set(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            repository = self._repository(directory)
            task_dir = repository / "docs/tasks"
            task_dir.mkdir(parents=True)
            original = task_dir / "TASK-0001-original.md"
            original.write_text("original\n", encoding="utf-8")
            self._git(repository, "add", ".")
            self._git(repository, "commit", "-qm", "base")

            with (
                patch.object(harness_common, "ROOT", repository),
                patch.object(doctor, "ROOT", repository),
            ):
                with doctor.doctor_git_snapshot():
                    transient = task_dir / "TASK-9999-transient.md"
                    transient.write_text("transient\n", encoding="utf-8")
                    discovered = harness_common.repository_glob(
                        task_dir,
                        "*.md",
                    )
                    transient.unlink()

            self.assertEqual([original], discovered)

    def test_doctor_snapshot_preserves_literal_backslash_index_path(self) -> None:
        raw = b"100644 " + b"0" * 40 + b" 0\tfoo\\bar.txt\0"
        entries = doctor.DoctorGitSnapshot._parse_index(raw)
        self.assertEqual(["foo\\bar.txt"], list(entries))
        audit = Audit()
        validate_portable_path_collisions(audit, "fixture", list(entries))
        self.assertTrue(
            any("non-portable backslash" in error for error in audit.errors),
            audit.errors,
        )

    def test_doctor_snapshot_rejects_regular_reparse_candidate(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            repository = self._repository(directory)
            fixture = repository / "fixture.txt"
            fixture.write_text("base\n", encoding="utf-8")
            self._git(repository, "add", ".")
            self._git(repository, "commit", "-qm", "base")
            fixture.write_text("dirty\n", encoding="utf-8")
            original_lstat = doctor.os.lstat

            class ReparseMetadata:
                st_mode = stat.S_IFREG | 0o644
                st_file_attributes = 0x400

            def reparse_lstat(path: os.PathLike[str] | str) -> os.stat_result:
                if Path(path) == fixture:
                    return ReparseMetadata()  # type: ignore[return-value]
                return original_lstat(path)

            with (
                patch.object(harness_common, "ROOT", repository),
                patch.object(doctor, "ROOT", repository),
                patch.object(doctor.os, "lstat", side_effect=reparse_lstat),
                self.assertRaisesRegex(HarnessError, "non-reparse"),
            ):
                with doctor.doctor_git_snapshot():
                    pass
            self.assertIsNone(doctor._ACTIVE_GIT_SNAPSHOT)

    def test_doctor_snapshot_cache_does_not_cross_scopes_or_repositories(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            first_path = root / "first"
            second_path = root / "second"
            first_path.mkdir()
            second_path.mkdir()
            first = self._repository(str(first_path))
            second = self._repository(str(second_path))
            for repository, content in (
                (first, "first\n"),
                (second, "second\n"),
            ):
                (repository / "fixture.txt").write_text(content, encoding="utf-8")
                self._git(repository, "add", ".")
                self._git(repository, "commit", "-qm", "base")

            original_git_bytes = doctor.git_bytes
            calls: list[tuple[str, ...]] = []

            def counting_git_bytes(
                *args: str,
                check: bool = True,
            ) -> subprocess.CompletedProcess[bytes]:
                calls.append(tuple(args))
                return original_git_bytes(*args, check=check)

            values: list[bytes] = []
            for repository in (first, first, second):
                head = self._git(repository, "rev-parse", "HEAD")
                with (
                    patch.object(harness_common, "ROOT", repository),
                    patch.object(doctor, "ROOT", repository),
                    patch.object(doctor, "git_bytes", side_effect=counting_git_bytes),
                ):
                    with doctor.doctor_git_snapshot():
                        values.append(doctor.git_object(head, "fixture.txt"))

            tree_calls = [call for call in calls if call[:3] == ("ls-tree", "-r", "-z")]
            blob_calls = [call for call in calls if call[:2] == ("cat-file", "blob")]
            self.assertEqual(3, len(tree_calls), calls)
            self.assertEqual(3, len(blob_calls), calls)
            self.assertEqual([b"first\n", b"first\n", b"second\n"], values)
            self.assertIsNone(doctor._ACTIVE_GIT_SNAPSHOT)
            self.assertIsNone(harness_common._REPOSITORY_BYTES_READER)
            self.assertIsNone(harness_common._REPOSITORY_GLOBBER)

    def test_doctor_snapshot_clears_scope_after_exception(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            repository = self._repository(directory)
            (repository / "fixture.txt").write_text("base\n", encoding="utf-8")
            self._git(repository, "add", ".")
            self._git(repository, "commit", "-qm", "base")

            with (
                patch.object(harness_common, "ROOT", repository),
                patch.object(doctor, "ROOT", repository),
                self.assertRaisesRegex(RuntimeError, "fixture failure"),
            ):
                with doctor.doctor_git_snapshot():
                    raise RuntimeError("fixture failure")

            self.assertIsNone(doctor._ACTIVE_GIT_SNAPSHOT)

    def test_doctor_snapshot_fails_closed_on_tree_and_blob_git_errors(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            repository = self._repository(directory)
            (repository / "fixture.txt").write_text("base\n", encoding="utf-8")
            self._git(repository, "add", ".")
            self._git(repository, "commit", "-qm", "base")
            head = self._git(repository, "rev-parse", "HEAD")
            original_git_bytes = doctor.git_bytes

            for failing_prefix in (
                ("ls-tree", "-r", "-z"),
                ("cat-file", "blob"),
            ):
                def failing_git_bytes(
                    *args: str,
                    check: bool = True,
                    prefix: tuple[str, ...] = failing_prefix,
                ) -> subprocess.CompletedProcess[bytes]:
                    if tuple(args[:len(prefix)]) == prefix:
                        return subprocess.CompletedProcess(
                            args=["git", *args],
                            returncode=1,
                            stdout=b"",
                            stderr=b"fixture git failure",
                        )
                    return original_git_bytes(*args, check=check)

                with (
                    self.subTest(failing_prefix=failing_prefix),
                    patch.object(harness_common, "ROOT", repository),
                    patch.object(doctor, "ROOT", repository),
                    patch.object(doctor, "git_bytes", side_effect=failing_git_bytes),
                    self.assertRaisesRegex(HarnessError, "fixture git failure"),
                ):
                    with doctor.doctor_git_snapshot():
                        doctor.git_object(head, "fixture.txt")
                self.assertIsNone(doctor._ACTIVE_GIT_SNAPSHOT)

    def test_doctor_snapshot_rejects_malformed_index_and_tree_records(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            repository = self._repository(directory)
            (repository / "fixture.txt").write_text("base\n", encoding="utf-8")
            self._git(repository, "add", ".")
            self._git(repository, "commit", "-qm", "base")
            head = self._git(repository, "rev-parse", "HEAD")
            original_git_bytes = doctor.git_bytes

            def malformed_index(
                *args: str,
                check: bool = True,
            ) -> subprocess.CompletedProcess[bytes]:
                if tuple(args[:3]) == ("ls-files", "--stage", "-z"):
                    return subprocess.CompletedProcess(
                        args=["git", *args],
                        returncode=0,
                        stdout=b"malformed-index\0",
                        stderr=b"",
                    )
                return original_git_bytes(*args, check=check)

            with (
                patch.object(harness_common, "ROOT", repository),
                patch.object(doctor, "ROOT", repository),
                patch.object(doctor, "git_bytes", side_effect=malformed_index),
                self.assertRaisesRegex(HarnessError, "malformed Git index"),
            ):
                with doctor.doctor_git_snapshot():
                    pass

            def malformed_tree(
                *args: str,
                check: bool = True,
            ) -> subprocess.CompletedProcess[bytes]:
                if tuple(args[:3]) == ("ls-tree", "-r", "-z"):
                    return subprocess.CompletedProcess(
                        args=["git", *args],
                        returncode=0,
                        stdout=b"malformed-tree\0",
                        stderr=b"",
                    )
                return original_git_bytes(*args, check=check)

            with (
                patch.object(harness_common, "ROOT", repository),
                patch.object(doctor, "ROOT", repository),
                patch.object(doctor, "git_bytes", side_effect=malformed_tree),
                self.assertRaisesRegex(HarnessError, "malformed tree record"),
            ):
                with doctor.doctor_git_snapshot():
                    doctor.git_object(head, "fixture.txt")
            self.assertIsNone(doctor._ACTIVE_GIT_SNAPSHOT)

    def test_timed_phase_reports_normal_and_exception_completion(self) -> None:
        output = io.StringIO()
        with redirect_stderr(output):
            with doctor.timed_phase("normal"):
                pass
        self.assertIn("Harness doctor: START normal", output.getvalue())
        self.assertIn("Harness doctor: DONE normal", output.getvalue())

        output = io.StringIO()
        with (
            redirect_stderr(output),
            self.assertRaisesRegex(RuntimeError, "fixture failure"),
        ):
            with doctor.timed_phase("failure"):
                raise RuntimeError("fixture failure")
        self.assertIn("Harness doctor: START failure", output.getvalue())
        self.assertIn("Harness doctor: ERROR failure", output.getvalue())

    def test_serial_terminal_chain_excludes_exact_predecessor_only(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            repository = self._repository(directory)
            fixture = repository / "fixture.txt"
            fixture.write_text("root\n", encoding="utf-8")
            self._git(repository, "add", ".")
            self._git(repository, "commit", "-qm", "root terminal")
            root_terminal = self._git(repository, "rev-parse", "HEAD")
            self._git(repository, "commit", "--allow-empty", "-qm", "task a terminal")
            task_a_terminal = self._git(repository, "rev-parse", "HEAD")
            self._git(repository, "commit", "--allow-empty", "-qm", "task b terminal")
            task_b_terminal = self._git(repository, "rev-parse", "HEAD")
            entries = {
                "TASK-1000": {"contractVersion": 2},
                "TASK-1001": {"contractVersion": 2},
            }
            introductions = {
                "TASK-1000": {task_a_terminal},
                "TASK-1001": {task_b_terminal},
            }

            with (
                patch.object(harness_common, "ROOT", repository),
                patch.object(doctor, "ROOT", repository),
            ):
                self.assertEqual(
                    [],
                    intervening_terminal_boundaries(
                        task_a_terminal,
                        task_b_terminal,
                        "TASK-1001",
                        entries,
                        introductions,
                    ),
                )
                self.assertEqual(
                    [f"TASK-1000@{task_a_terminal}"],
                    intervening_terminal_boundaries(
                        root_terminal,
                        task_b_terminal,
                        "TASK-1001",
                        entries,
                        introductions,
                    ),
                )
                audit = Audit()
                validate_active_task_base_freshness(
                    audit,
                    {
                        "TASK-1001": {
                            "state": "IN_PROGRESS",
                            "baseCommit": root_terminal,
                        }
                    },
                    {"activeStates": ["READY", "IN_PROGRESS", "IN_REVIEW"]},
                    {"TASK-1000": entries["TASK-1000"]},
                    {"TASK-1000": introductions["TASK-1000"]},
                )
                self.assertTrue(
                    any("active task uses a stale Base Commit" in error for error in audit.errors)
                )


class ContextTests(unittest.TestCase):
    def test_duplicate_yaml_keys_are_rejected(self) -> None:
        with self.assertRaises(yaml.YAMLError):
            strict_yaml_load("schemaVersion: 1\nschemaVersion: 2\n")

    def test_duplicate_json_keys_are_rejected(self) -> None:
        with self.assertRaises(ValueError):
            json.loads(
                '{"status":"FAIL","status":"PASS"}',
                object_pairs_hook=unique_json_object,
            )

    def test_task_discovery_excludes_template(self) -> None:
        tasks = discover_tasks()
        self.assertTrue({"TASK-0001", "TASK-0002"} <= set(tasks))
        self.assertNotIn("TASK-XXXX", tasks)

    def test_task_filename_id_must_match_metadata_id(self) -> None:
        self.assertEqual(
            "TASK-0002",
            task_id_from_filename(Path("TASK-0002-portable-agent-harness.md")),
        )
        self.assertNotEqual(
            "TASK-0002",
            task_id_from_filename(Path("TASK-9999-portable-agent-harness.md")),
        )

    def test_all_context_locks_are_reproducible(self) -> None:
        for task in discover_tasks().values():
            if task.get("state") == "PLANNED":
                continue
            self.assertEqual([], verify_context_lock(task), task["taskId"])

    def test_context_fingerprint_tampering_is_rejected(self) -> None:
        task = dict(discover_tasks()["TASK-0002"])
        task["contextFingerprint"] = "0" * 64
        errors = verify_context_lock(task)
        self.assertTrue(any("disagree on contextFingerprint" in error for error in errors), errors)

    def test_context_inputs_must_bind_to_base_commit_and_declared_path_mode(self) -> None:
        task = copy.deepcopy(discover_tasks()["TASK-0002"])
        lock = load_yaml(ROOT / task["contextLock"])
        lock["pathMode"] = "CURRENT_WORKTREE"
        lock["inputs"][0]["repositoryCommit"] = "f" * 40
        with patch.object(harness_common, "load_yaml", return_value=lock):
            errors = verify_context_lock(task)
        messages = "\n".join(errors)
        self.assertIn("pathMode must bind", messages)
        self.assertIn("must use the task Base Commit", messages)

    def test_ready_authorization_fields_cannot_be_widened(self) -> None:
        tasks = discover_tasks()
        tasks["TASK-0002"] = dict(tasks["TASK-0002"], owner="tampered-owner")
        tasks = {"TASK-0002": tasks["TASK-0002"]}
        audit = Audit()
        validate_tasks(audit, tasks, load_yaml(ROOT / ".harness/task-lifecycle.yaml"))
        self.assertTrue(
            any("authorized field changed after READY checkpoint: owner" in error for error in audit.errors),
            audit.errors,
        )

    def test_authorization_commit_cannot_be_advanced_to_later_task_commit(self) -> None:
        tasks = discover_tasks()
        task = copy.deepcopy(tasks["TASK-0002"])
        task["authorizationCommit"] = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=ROOT,
            text=True,
            stdout=subprocess.PIPE,
            check=True,
        ).stdout.strip()
        tasks = {"TASK-0002": task}
        audit = Audit()
        validate_tasks(audit, tasks, load_yaml(ROOT / ".harness/task-lifecycle.yaml"))
        self.assertTrue(
            any("bootstrap authorizationCommit is not anchored" in error for error in audit.errors),
            audit.errors,
        )

    def test_ready_authorization_body_cannot_be_rewritten(self) -> None:
        task_path = ROOT / discover_tasks()["TASK-0002"]["_path"]
        original = task_path.read_text(encoding="utf-8")
        tampered = original.replace("## 背景与用户可观察目标", "## 被篡改的目标", 1)
        self.assertNotEqual(
            task_authorization_projection(original),
            task_authorization_projection(tampered),
        )

    def test_ready_context_lock_bytes_cannot_be_rewritten(self) -> None:
        audit = Audit()
        validate_ready_context_lock_bytes(
            audit,
            "docs/tasks/TASK-9999.md",
            b"provenanceOnly: true\n",
            b"provenanceOnly: false\n",
        )
        self.assertTrue(any("Context Lock changed after READY" in error for error in audit.errors))

    def test_ready_parent_must_be_idle_unbound_draft(self) -> None:
        audit = Audit()
        validate_ready_parent_projection(
            audit,
            "TASK-9999",
            {
                "activeTask": "TASK-9999",
                "activeTaskCard": "docs/tasks/TASK-9999.md",
            },
            {"state": "IN_PROGRESS", "authorizationCommit": "a" * 40},
        )
        messages = "\n".join(audit.errors)
        self.assertIn("READY parent project-state must be idle", messages)
        self.assertIn("READY parent task must be an unbound DRAFT", messages)

    def test_invalid_risk_class_is_rejected_globally(self) -> None:
        tasks = discover_tasks()
        tasks["TASK-0002"] = dict(tasks["TASK-0002"], riskClass="critical")
        tasks = {"TASK-0002": tasks["TASK-0002"]}
        audit = Audit()
        validate_tasks(audit, tasks, load_yaml(ROOT / ".harness/task-lifecycle.yaml"))
        self.assertTrue(any("riskClass must be one of" in error for error in audit.errors), audit.errors)


class DeliveryPolicyTests(unittest.TestCase):
    def test_policy_registry_skill_and_entrypoint_projection(self) -> None:
        audit = Audit()
        validate_task_delivery_policy(audit)
        validate_entrypoints(audit)
        validate_sources(audit, {})
        validate_skills(audit, {})
        self.assertEqual([], audit.errors)

    def test_policy_validator_rejects_contract_drift(self) -> None:
        policy_path = ROOT / ".harness/task-delivery-policy.yaml"
        sources_path = ROOT / ".harness/sources-of-truth.yaml"
        drifted = copy.deepcopy(load_yaml(policy_path))
        drifted["budgets"]["targetWallMinutes"] = 61
        real_load_yaml = doctor.load_yaml

        def load_with_drift(path: Path) -> dict[str, object]:
            if Path(path) == policy_path:
                return drifted
            return real_load_yaml(path)

        audit = Audit()
        with patch.object(doctor, "load_yaml", side_effect=load_with_drift):
            validate_task_delivery_policy(audit)
        self.assertTrue(
            any("canonical contract hash drifted" in error for error in audit.errors),
            audit.errors,
        )

        for alias in (
            ".harness/task-delivery-policy.yaml",
            "./.harness/task-delivery-policy.yaml",
            r".harness\task-delivery-policy.yaml",
            ".harness//task-delivery-policy.yaml",
        ):
            with self.subTest(alias=alias):
                duplicated_sources = copy.deepcopy(load_yaml(sources_path))
                duplicated_sources["sources"]["taskDeliveryPolicyAlias"] = alias

                def load_with_duplicate_source(path: Path) -> dict[str, object]:
                    if Path(path) == sources_path:
                        return duplicated_sources
                    return real_load_yaml(path)

                audit = Audit()
                with patch.object(
                    doctor,
                    "load_yaml",
                    side_effect=load_with_duplicate_source,
                ):
                    validate_sources(audit, {})
                    validate_task_delivery_policy(audit)
                self.assertTrue(
                    any(
                        "canonical repository-relative POSIX path" in error
                        or "policy path exactly once" in error
                        for error in audit.errors
                    ),
                    audit.errors,
                )

    def test_policy_validator_rejects_wrapper_alias_drift(self) -> None:
        skill_path = ROOT / "skills/task-delivery-flow/SKILL.md"
        skill_text = skill_path.read_text(encoding="utf-8")
        marker = "the Python canonical command."
        real_read_repository_text = doctor.read_repository_text
        suffixes = (
            " unless its exact argv was frozen.",
            " except when wrapper argv is frozen.",
            " If wrapper argv is frozen, it may stand in for PASS.",
            " The wrapper is an Evidence alias after freezing.",
        )

        for suffix in suffixes:
            with self.subTest(suffix=suffix):
                drifted_skill = skill_text.replace(marker, marker + suffix, 1)

                def read_with_drift(path: Path) -> str:
                    if Path(path) == skill_path:
                        return drifted_skill
                    return real_read_repository_text(path)

                audit = Audit()
                with patch.object(
                    doctor,
                    "read_repository_text",
                    side_effect=read_with_drift,
                ):
                    validate_task_delivery_policy(audit)
                self.assertTrue(
                    any(
                        "wrapper command identity must be unconditional" in error
                        for error in audit.errors
                    ),
                    audit.errors,
                )


class BacklogTests(unittest.TestCase):
    EXPECTED_TITLES = {
        "TASK-0012": "PLANNED 队列、Backlog 和 Harness 治理",
        "TASK-0013": "Provider Registry 与供应商中立准入模型",
        "TASK-0014": "授权快照与 Execution Authorization Guard",
        "TASK-0015": "PostgreSQL、Flyway、复合所有权和 FORCE RLS",
        "TASK-0016": "Worker Claim、Lease、Fence 与过期写拒绝",
        "TASK-0017": "Conversation/Generation 持久化与幂等接收",
        "TASK-0018": "Finalization、Usage/Quota 结算与 Outbox 原子事务",
        "TASK-0019": "ContextPlan、人格结构、LISTEN/DISCUSS",
        "TASK-0020": "输入、增量输出和最终输出安全流水线",
        "TASK-0021": "持久化 Fetch-SSE、续传、Gap/Reset/Snapshot",
        "TASK-0022": "Fake/Failure 后端离线端到端纵切",
        "TASK-0023": "OpenAPI 生成、Client 生成与漂移检查基线",
        "TASK-0024": "Relationship 与唯一活跃 Companion",
        "TASK-0025": "Chat、Generation、History API",
        "TASK-0026": "H5 离线聊天、流式显示与恢复",
        "TASK-0027": "Canonical Memory 持久化与所有权隔离",
        "TASK-0028": "记忆候选、确认、修改、删除与来源 API",
        "TASK-0029": "跨会话召回、Context 注入与删除墓碑",
        "TASK-0030": "H5 记忆管理界面",
        "TASK-0031": "模拟权益、Service Class 与确定性路由",
        "TASK-0032": "最小 ZERO_LLM、额度释放与全故障恢复",
        "TASK-0033": "Anthropic Messages 离线 HTTP/SSE 合同",
        "TASK-0034": "成熟身份组件与内部测试账号接入（硬决策闸门）",
        "TASK-0035": "单一获批真实模型供应商受控接入（硬决策闸门）",
        "TASK-0036": "Technical Alpha 隔离、安全、记忆、故障与指标总验收",
        "TASK-0037": "Harness 性能基线、分层验证与快照复用",
        "TASK-0038": "任务交付执行策略、双模式 Skill 与 AGENTS 入口",
        "TASK-0039": "Harness 阶段计时与跨文件系统性能引擎",
        "TASK-0040": "Harness 路径感知 CI 与包装器平台策略",
        "TASK-0041": "Harness 内容寻址快照复用与 Evidence 门禁",
        "TASK-0043": "Idle planning checkpoint 核心父边校验",
        "TASK-0044": "Idle planning checkpoint 四消费者接线",
        "TASK-0045": "Harness 阶段计时与跨文件系统性能引擎替代",
        "TASK-0046": "Harness 路径感知 CI 与包装器平台策略替代",
        "TASK-0047": "Harness 内容寻址快照复用与 Evidence 门禁替代",
        "TASK-0049": "Idle planning checkpoint 核心父边校验最终替代",
        "TASK-0050": "Idle planning checkpoint 四消费者接线最终替代",
        "TASK-0051": "Harness 阶段计时与跨文件系统性能引擎最终替代",
        "TASK-0052": "Harness 路径感知 CI 与包装器平台策略最终替代",
        "TASK-0053": "Harness 内容寻址快照复用与 Evidence 门禁最终替代",
    }

    def load_inputs(
        self,
    ) -> tuple[
        dict[str, object],
        dict[str, dict[str, object]],
        dict[str, object],
        dict[str, object],
    ]:
        return (
            load_yaml(ROOT / ".harness/task-backlog.yaml"),
            discover_tasks(),
            load_yaml(ROOT / ".harness/task-lifecycle.yaml"),
            load_yaml(ROOT / ".harness/project-state.yaml"),
        )

    @staticmethod
    def card_bytes(
        entry: dict[str, object],
        metadata: dict[str, object],
        *,
        transform: object | None = None,
    ) -> bytes:
        text = (ROOT / str(entry["taskCard"])).read_text(encoding="utf-8")
        match = TASK_BLOCK_RE.search(text)
        assert match is not None
        block = yaml.safe_dump(
            metadata,
            allow_unicode=True,
            sort_keys=False,
            width=120,
        ).rstrip()
        rendered = text[: match.start()] + f"```yaml\n{block}\n```" + text[match.end() :]
        if callable(transform):
            rendered = transform(rendered)
        return rendered.encode("utf-8")

    @staticmethod
    def owner_amendment_contract(
        task: dict[str, object],
        *,
        parent_commit: str = "a" * 40,
    ) -> tuple[dict[str, object], str]:
        authorized_text = doctor.git_object(
            str(task["authorizationCommit"]),
            str(task["_path"]),
        ).decode("utf-8")
        clauses = task_acceptance_clauses(authorized_text, str(task["taskId"]))
        replacements = [
            (
                "TASK-0012-ACCEPTANCE-001",
                "正式 Backlog 保留 TASK-0012～TASK-0036 全部原永久 ID 与产品语义，并追加 "
                "TASK-0037，共 26 个永久 ID；不得改号、复用或删除原卡。",
            ),
            (
                "TASK-0012-ACCEPTANCE-004",
                "TASK-0012 ACCEPTED 后第一张可晋级为 TASK-0037；TASK-0037 "
                "ACCEPTED 后再按原 DAG 推进 TASK-0013。",
            ),
        ]
        contract: dict[str, object] = {
            "schemaVersion": 1,
            "taskId": "TASK-0012",
            "amendmentType": "OWNER_CLAUSE_REPLACEMENT",
            "approvedBy": "repository-owner",
            "approvedAt": "2026-07-30",
            "evidence": "Owner explicitly replaced exactly two acceptance clauses",
            "reason": "Add TASK-0037 without weakening any other authorization",
            "authorizedParentCommit": parent_commit,
            "baseAuthorizationProjectionHash": sha256_text(
                task_authorization_projection(authorized_text)
            ),
            "scopeGrantAmendmentId": None,
            "addedWriteAllowlist": [
                "docs/tasks/TASK-0037-harness-performance-layered-validation.md"
            ],
            "replacements": [
                {
                    "supersedes": {
                        "clauseId": clause_id,
                        "statement": clauses[clause_id],
                        "statementHash": sha256_text(clauses[clause_id]),
                    },
                    "replacement": {
                        "statement": replacement,
                        "statementHash": sha256_text(replacement),
                    },
                }
                for clause_id, replacement in replacements
            ],
        }
        return contract, authorized_text

    def test_backlog_registers_exact_technical_alpha_baseline(self) -> None:
        backlog, tasks, lifecycle, state = self.load_inputs()
        audit = Audit()
        projection = validate_task_backlog_data(
            audit,
            backlog,
            tasks,
            lifecycle,
            state,
        )
        self.assertEqual([], audit.errors)
        expected_ids = [
            "TASK-0012",
            "TASK-0037",
            "TASK-0038",
            "TASK-0039",
            "TASK-0040",
            "TASK-0041",
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
            *[f"TASK-{value:04d}" for value in range(13, 37)],
        ]
        self.assertEqual(expected_ids, backlog["executionOrder"])
        self.assertEqual(
            self.EXPECTED_TITLES,
            {
                task_id: entry["title"]
                for task_id, entry in backlog["tasks"].items()
            },
        )
        self.assertEqual(29, projection["plannedCount"])
        repository_busy = any(
            task["state"] in {*lifecycle["activeStates"], "DRAFT"}
            for task in tasks.values()
        )
        expected_next = None if repository_busy else "TASK-0049"
        self.assertEqual(expected_next, projection["nextPromotable"])
        self.assertEqual(
            {
                "TASK-0039": "TASK-0045",
                "TASK-0040": "TASK-0046",
                "TASK-0041": "TASK-0047",
                "TASK-0043": "TASK-0049",
                "TASK-0044": "TASK-0050",
                "TASK-0045": "TASK-0051",
                "TASK-0046": "TASK-0052",
                "TASK-0047": "TASK-0053",
            },
            {
                task_id: resolution["replacementTask"]
                for task_id, resolution in backlog["resolutions"].items()
            },
        )
        self.assertEqual(["TASK-0012"], backlog["tasks"]["TASK-0038"]["dependencies"])
        self.assertEqual(["TASK-0038"], backlog["tasks"]["TASK-0039"]["dependencies"])
        self.assertEqual(["TASK-0039"], backlog["tasks"]["TASK-0040"]["dependencies"])
        self.assertEqual(["TASK-0040"], backlog["tasks"]["TASK-0041"]["dependencies"])
        self.assertEqual(["TASK-0042"], backlog["tasks"]["TASK-0043"]["dependencies"])
        self.assertEqual(["TASK-0043"], backlog["tasks"]["TASK-0044"]["dependencies"])
        self.assertEqual(["TASK-0044"], backlog["tasks"]["TASK-0045"]["dependencies"])
        self.assertEqual(["TASK-0045"], backlog["tasks"]["TASK-0046"]["dependencies"])
        self.assertEqual(["TASK-0046"], backlog["tasks"]["TASK-0047"]["dependencies"])
        self.assertEqual(["TASK-0048"], backlog["tasks"]["TASK-0049"]["dependencies"])
        self.assertEqual(["TASK-0049"], backlog["tasks"]["TASK-0050"]["dependencies"])
        self.assertEqual(["TASK-0050"], backlog["tasks"]["TASK-0051"]["dependencies"])
        self.assertEqual(["TASK-0051"], backlog["tasks"]["TASK-0052"]["dependencies"])
        self.assertEqual(["TASK-0052"], backlog["tasks"]["TASK-0053"]["dependencies"])
        self.assertEqual(["TASK-0012"], backlog["tasks"]["TASK-0013"]["dependencies"])

        terminal_tasks = copy.deepcopy(tasks)
        terminal_tasks["TASK-0048"]["state"] = "ACCEPTED"
        terminal_projection = derive_backlog_promotion_projection(
            backlog,
            terminal_tasks,
            lifecycle,
        )
        self.assertTrue(terminal_projection["repositoryIdle"])
        self.assertEqual(29, terminal_projection["plannedCount"])
        self.assertEqual("TASK-0049", terminal_projection["nextPromotable"])
        self.assertIn(
            "WAITING_FOR_ORDER:TASK-0049",
            terminal_projection["blockers"]["TASK-0013"],
        )

    def test_task0012_owner_amendment_replaces_exactly_two_clauses(self) -> None:
        backlog, tasks, _, _ = self.load_inputs()
        amendment_id = "task-0012-owner-formalize-task-0037"
        contract = backlog["authorizationAmendments"][amendment_id]
        task = tasks["TASK-0012"]
        authorized_text = doctor.git_object(
            str(task["authorizationCommit"]),
            str(task["_path"]),
        ).decode("utf-8")
        current_text = (ROOT / str(task["_path"])).read_text(encoding="utf-8")
        self.assertEqual(
            task_authorization_projection(authorized_text),
            task_authorization_projection(current_text),
        )
        self.assertEqual(
            {
                "TASK-0012-ACCEPTANCE-001",
                "TASK-0012-ACCEPTANCE-004",
            },
            {
                record["supersedes"]["clauseId"]
                for record in contract["replacements"]
            },
        )
        self.assertEqual(
            ["docs/tasks/TASK-0037-harness-performance-layered-validation.md"],
            contract["addedWriteAllowlist"],
        )
        self.assertEqual(
            "TASK-0012 至 TASK-0036 的 25 个编号、名称和规划合同完整受控",
            backlog["tasks"]["TASK-0012"]["acceptanceCriteria"][0],
        )
        audit = Audit()
        validate_authorization_amendment_contract(
            audit,
            "TASK-0012 amendment",
            amendment_id,
            contract,
            task,
            authorized_text=authorized_text,
            seen_path_keys={},
        )
        self.assertEqual([], audit.errors)

    def test_backlog_missing_file_fails_closed(self) -> None:
        backlog, tasks, lifecycle, state = self.load_inputs()
        with patch.object(
            doctor,
            "load_yaml",
            side_effect=HarnessError(".harness/task-backlog.yaml: missing"),
        ):
            with self.assertRaisesRegex(HarnessError, "task-backlog.yaml"):
                validate_task_backlog(
                    Audit(),
                    tasks,
                    lifecycle,
                    state,
                )

    def test_backlog_rejects_duplicate_order_and_invalid_critical_path(self) -> None:
        backlog, tasks, lifecycle, state = self.load_inputs()
        tampered = copy.deepcopy(backlog)
        tampered["executionOrder"].append("TASK-0013")
        tampered["criticalPath"].remove("TASK-0017")
        audit = Audit()
        validate_task_backlog_data(
            audit,
            tampered,
            tasks,
            lifecycle,
            state,
        )
        messages = "\n".join(audit.errors)
        self.assertIn("executionOrder must contain every task exactly once", messages)
        self.assertIn("criticalPath edge", messages)
        self.assertIn("not a longest dependency path", messages)

    def test_backlog_rejects_unregistered_planned_card(self) -> None:
        backlog, tasks, lifecycle, state = self.load_inputs()
        with_extra = copy.deepcopy(tasks)
        rogue = copy.deepcopy(tasks["TASK-0013"])
        rogue["taskId"] = "TASK-9999"
        with_extra["TASK-9999"] = rogue

        task_audit = Audit()
        validate_tasks(task_audit, {"TASK-9999": rogue}, lifecycle)
        self.assertEqual([], task_audit.errors)

        backlog_audit = Audit()
        validate_task_backlog_data(
            backlog_audit,
            backlog,
            with_extra,
            lifecycle,
            state,
        )
        self.assertTrue(
            any("unregistered=['TASK-9999']" in error for error in backlog_audit.errors),
            backlog_audit.errors,
        )

    def test_backlog_projection_exposes_idle_order_and_repository_blockers(self) -> None:
        backlog, tasks, lifecycle, _ = self.load_inputs()
        active_tasks = copy.deepcopy(tasks)
        active_tasks["TASK-0037"]["state"] = "IN_PROGRESS"
        active_projection = derive_backlog_promotion_projection(
            backlog,
            active_tasks,
            lifecycle,
        )
        self.assertIn(
            "REPOSITORY_NOT_IDLE",
            active_projection["blockers"]["TASK-0013"],
        )

        ordered_tasks = copy.deepcopy(tasks)
        ordered_tasks["TASK-0012"]["state"] = "ACCEPTED"
        ordered_tasks["TASK-0037"]["state"] = "PLANNED"
        first_projection = derive_backlog_promotion_projection(
            backlog,
            ordered_tasks,
            lifecycle,
        )
        self.assertEqual("TASK-0037", first_projection["nextPromotable"])
        self.assertIn(
            "WAITING_FOR_ORDER:TASK-0037",
            first_projection["blockers"]["TASK-0013"],
        )
        ordered_tasks["TASK-0037"]["state"] = "REJECTED"
        for task_id in ("TASK-0038", "TASK-0039", "TASK-0040", "TASK-0041"):
            replacement_projection = derive_backlog_promotion_projection(
                backlog,
                ordered_tasks,
                lifecycle,
            )
            self.assertEqual(task_id, replacement_projection["nextPromotable"])
            self.assertIn(
                f"WAITING_FOR_ORDER:{task_id}",
                replacement_projection["blockers"]["TASK-0013"],
            )
            ordered_tasks[task_id]["state"] = "ACCEPTED"
        after_governance_projection = derive_backlog_promotion_projection(
            backlog,
            ordered_tasks,
            lifecycle,
        )
        self.assertEqual(
            "TASK-0013",
            after_governance_projection["nextPromotable"],
        )
        ordered_tasks["TASK-0013"]["state"] = "ACCEPTED"
        ordered_projection = derive_backlog_promotion_projection(
            backlog,
            ordered_tasks,
            lifecycle,
        )
        self.assertEqual("TASK-0014", ordered_projection["nextPromotable"])
        self.assertIn(
            "WAITING_FOR_ORDER:TASK-0014",
            ordered_projection["blockers"]["TASK-0033"],
        )

    def test_backlog_draft_cannot_bypass_pending_hard_gate(self) -> None:
        backlog, tasks, lifecycle, state = self.load_inputs()
        bypass = copy.deepcopy(tasks)
        for task_id in backlog["executionOrder"]:
            if task_id == "TASK-0034":
                break
            bypass[task_id]["state"] = "ACCEPTED"
        bypass["TASK-0034"]["state"] = "DRAFT"
        idle_state = copy.deepcopy(state)
        idle_state["activeTask"] = None
        idle_state["activeTaskCard"] = None
        idle_state["nextAction"] = "将 TASK-0034 晋级为唯一 DRAFT"

        audit = Audit()
        validate_task_backlog_data(
            audit,
            backlog,
            bypass,
            lifecycle,
            idle_state,
        )
        messages = "\n".join(audit.errors)
        self.assertIn("DRAFT TASK-0034 bypasses", messages)
        self.assertIn(
            "DECISION_GATE:GATE-IDENTITY-PROVIDER-SESSION:PENDING",
            messages,
        )

    def test_backlog_draft_reconstructs_base_git_snapshot(self) -> None:
        backlog, tasks, lifecycle, _ = self.load_inputs()
        with tempfile.TemporaryDirectory() as directory:
            repository = Path(directory)
            subprocess.run(["git", "init", "-q"], cwd=repository, check=True)
            subprocess.run(
                ["git", "config", "user.name", "Harness Test"],
                cwd=repository,
                check=True,
            )
            subprocess.run(
                ["git", "config", "user.email", "harness@example.invalid"],
                cwd=repository,
                check=True,
            )
            harness_dir = repository / ".harness"
            harness_dir.mkdir(parents=True)
            (harness_dir / "task-backlog.yaml").write_text(
                (ROOT / ".harness/task-backlog.yaml").read_text(encoding="utf-8"),
                encoding="utf-8",
            )
            (harness_dir / "project-state.yaml").write_text(
                "schemaVersion: 1\n"
                "phase: TECHNICAL_ALPHA\n"
                "activeTask: null\n"
                "activeTaskCard: null\n"
                "nextAction: 将 TASK-0034 晋级为唯一 DRAFT\n",
                encoding="utf-8",
            )
            task_paths: dict[str, dict[str, object]] = {}
            for task_id, entry in backlog["tasks"].items():
                relative_path = entry["taskCard"]
                target = repository / relative_path
                target.parent.mkdir(parents=True, exist_ok=True)
                text = (ROOT / relative_path).read_text(encoding="utf-8")
                if task_id == "TASK-0012":
                    text = text.replace("state: IN_PROGRESS", "state: ACCEPTED", 1)
                elif task_id < "TASK-0034":
                    text = text.replace("state: PLANNED", "state: ACCEPTED", 1)
                target.write_text(text, encoding="utf-8")
                task_paths[task_id] = {"_path": relative_path}
            subprocess.run(["git", "add", "--", "."], cwd=repository, check=True)
            subprocess.run(
                ["git", "commit", "-qm", "base"],
                cwd=repository,
                check=True,
            )
            base_commit = subprocess.run(
                ["git", "rev-parse", "HEAD"],
                cwd=repository,
                text=True,
                stdout=subprocess.PIPE,
                check=True,
            ).stdout.strip()
            candidate = copy.deepcopy(tasks["TASK-0034"])
            candidate["state"] = "DRAFT"
            candidate["baseCommit"] = base_commit
            task_paths["TASK-0034"] = candidate
            audit = Audit()
            with (
                patch.object(harness_common, "ROOT", repository),
                patch.object(doctor, "ROOT", repository),
            ):
                validate_backlog_draft_promotion_at_base(
                    audit,
                    candidate,
                    task_paths,
                    lifecycle,
                )
            messages = "\n".join(audit.errors)
            self.assertIn("DRAFT promotion bypasses Backlog", messages)
            self.assertIn(
                "DECISION_GATE:GATE-IDENTITY-PROVIDER-SESSION:PENDING",
                messages,
            )

    def test_hard_gate_requires_owner_and_each_decision_evidence(self) -> None:
        backlog, tasks, lifecycle, state = self.load_inputs()
        tampered = copy.deepcopy(backlog)
        gate = tampered["decisionGates"]["GATE-IDENTITY-PROVIDER-SESSION"]
        gate["status"] = "APPROVED"
        gate["approval"] = {
            "approvedBy": "agent",
            "approvedAt": "2026-08-01",
            "evidence": "ok",
            "decisionEvidence": {
                decision: {"value": "ok", "evidence": "ok"}
                for decision in gate["requiredDecisions"][:-1]
            },
        }
        audit = Audit()
        validate_task_backlog_data(
            audit,
            tampered,
            tasks,
            lifecycle,
            state,
        )
        messages = "\n".join(audit.errors)
        self.assertIn("approvedBy must be repository-owner", messages)
        self.assertIn("must cover every requiredDecision exactly", messages)

        gate["approval"]["approvedBy"] = "repository-owner"
        gate["approval"]["decisionEvidence"] = {
            decision: {
                "value": f"Owner-approved value for {decision}",
                "evidence": f"Owner evidence for {decision}",
            }
            for decision in gate["requiredDecisions"]
        }
        valid = Audit()
        validate_task_backlog_data(
            valid,
            tampered,
            tasks,
            lifecycle,
            state,
        )
        self.assertEqual([], valid.errors)

    def test_multiple_pending_drafts_fail_closed(self) -> None:
        _, tasks, lifecycle, _ = self.load_inputs()
        multiple = copy.deepcopy(tasks)
        multiple["TASK-0013"]["state"] = "DRAFT"
        multiple["TASK-0014"]["state"] = "DRAFT"
        audit = Audit()
        self.assertEqual(
            ["TASK-0013", "TASK-0014"],
            validate_pending_draft_limit(audit, multiple, lifecycle),
        )
        self.assertTrue(
            any("multiple pending DRAFT" in error for error in audit.errors),
            audit.errors,
        )

    def test_resolution_introduction_must_atomically_update_planned_card(self) -> None:
        backlog, _, _, _ = self.load_inputs()
        parent = copy.deepcopy(backlog)
        resolved = copy.deepcopy(backlog)
        resolution = {
            "state": "REJECTED",
            "reason": "Owner cancelled the planned capability",
            "decidedBy": "repository-owner",
            "decidedAt": "2026-08-01",
            "replacementTask": None,
        }
        resolved["resolutions"]["TASK-0013"] = resolution
        entry = resolved["tasks"]["TASK-0013"]
        planned = {
            "taskId": "TASK-0013",
            "state": "PLANNED",
            "owner": "repository-owner",
            "planningBacklog": ".harness/task-backlog.yaml",
            "planningContractHash": canonical_json_sha256(entry),
            "planningContractHashAlgorithm": "SHA256_CANONICAL_JSON_V1",
        }
        audit = Audit()
        with patch.object(
            doctor,
            "task_metadata_at_commit",
            return_value=planned,
        ), patch.object(
            doctor,
            "git_tree_entry",
            return_value=("100644", "blob", "e" * 40),
        ), patch.object(
            doctor,
            "git_object",
            return_value=self.card_bytes(entry, planned),
        ):
            validate_backlog_resolution_commit(
                audit,
                "a" * 40,
                "b" * 40,
                parent,
                resolved,
        )
        self.assertTrue(
            any("planning card state must remain REJECTED" in error for error in audit.errors),
            audit.errors,
        )

    def test_atomic_resolution_and_immutable_terminal_projection_pass(self) -> None:
        backlog, _, _, _ = self.load_inputs()
        parent = copy.deepcopy(backlog)
        resolved = copy.deepcopy(backlog)
        entry = resolved["tasks"]["TASK-0013"]
        resolution = {
            "state": "REJECTED",
            "reason": "Owner cancelled the planned capability",
            "decidedBy": "repository-owner",
            "decidedAt": "2026-08-01",
            "replacementTask": None,
        }
        resolved["resolutions"]["TASK-0013"] = resolution
        parent_commit = "a" * 40
        child_commit = "b" * 40
        stable_commit = "c" * 40
        shared = {
            "taskId": "TASK-0013",
            "owner": "repository-owner",
            "planningBacklog": ".harness/task-backlog.yaml",
            "planningContractHash": canonical_json_sha256(entry),
            "planningContractHashAlgorithm": "SHA256_CANONICAL_JSON_V1",
        }
        planned = {**shared, "state": "PLANNED"}
        terminal = {
            **shared,
            "state": "REJECTED",
            "planningResolution": resolution,
        }

        def metadata_at_commit(commit: str, _path: str) -> dict[str, object]:
            return planned if commit == parent_commit else terminal

        def card_at_commit(commit: str, _path: str) -> bytes:
            metadata = planned if commit == parent_commit else terminal
            return self.card_bytes(entry, metadata)

        audit = Audit()
        with patch.object(
            doctor,
            "task_metadata_at_commit",
            side_effect=metadata_at_commit,
        ), patch.object(
            doctor,
            "git_tree_entry",
            return_value=("100644", "blob", "e" * 40),
        ), patch.object(
            doctor,
            "git_object",
            side_effect=card_at_commit,
        ):
            validate_backlog_resolution_commit(
                audit,
                parent_commit,
                child_commit,
                parent,
                resolved,
            )
            validate_backlog_resolution_commit(
                audit,
                child_commit,
                stable_commit,
                resolved,
                resolved,
            )
        self.assertEqual([], audit.errors)

    def test_resolution_split_across_two_commits_fails_closed(self) -> None:
        backlog, _, _, _ = self.load_inputs()
        parent = copy.deepcopy(backlog)
        resolved = copy.deepcopy(backlog)
        resolution = {
            "state": "REJECTED",
            "reason": "Owner cancelled the planned capability",
            "decidedBy": "repository-owner",
            "decidedAt": "2026-08-01",
            "replacementTask": None,
        }
        resolved["resolutions"]["TASK-0013"] = resolution
        entry = resolved["tasks"]["TASK-0013"]
        terminal = {
            "taskId": "TASK-0013",
            "state": "REJECTED",
            "owner": "repository-owner",
            "planningBacklog": ".harness/task-backlog.yaml",
            "planningContractHash": canonical_json_sha256(entry),
            "planningContractHashAlgorithm": "SHA256_CANONICAL_JSON_V1",
            "planningResolution": resolution,
        }
        parent_commit = "a" * 40
        child_commit = "b" * 40

        def metadata_at_commit(commit: str, _path: str) -> dict[str, object]:
            return terminal

        audit = Audit()
        with patch.object(
            doctor,
            "task_metadata_at_commit",
            side_effect=metadata_at_commit,
        ), patch.object(
            doctor,
            "git_tree_entry",
            return_value=("100644", "blob", "e" * 40),
        ), patch.object(
            doctor,
            "git_object",
            return_value=self.card_bytes(entry, terminal),
        ):
            validate_backlog_resolution_commit(
                audit,
                parent_commit,
                child_commit,
                parent,
                resolved,
            )
        self.assertTrue(
            any(
                "planning card state must remain PLANNED"
                in error
                for error in audit.errors
            ),
            audit.errors,
        )

    def test_resolved_card_cannot_be_corrupted_then_restored(self) -> None:
        backlog, _, _, _ = self.load_inputs()
        resolution = {
            "state": "REJECTED",
            "reason": "Owner cancelled the planned capability",
            "decidedBy": "repository-owner",
            "decidedAt": "2026-08-01",
            "replacementTask": None,
        }
        resolved = copy.deepcopy(backlog)
        resolved["resolutions"]["TASK-0013"] = resolution
        good_commit = "a" * 40
        corrupt_commit = "b" * 40
        restored_commit = "c" * 40

        def metadata_at_commit(commit: str, _path: str) -> dict[str, object]:
            if commit == corrupt_commit:
                return {
                    **terminal,
                    "owner": "temporary-owner",
                    "baseCommit": "d" * 40,
                }
            return terminal

        def card_at_commit(commit: str, _path: str) -> bytes:
            return self.card_bytes(entry, metadata_at_commit(commit, _path))

        entry = resolved["tasks"]["TASK-0013"]
        terminal = {
            "taskId": "TASK-0013",
            "state": "REJECTED",
            "owner": "repository-owner",
            "planningBacklog": ".harness/task-backlog.yaml",
            "planningContractHash": canonical_json_sha256(entry),
            "planningContractHashAlgorithm": "SHA256_CANONICAL_JSON_V1",
            "planningResolution": resolution,
        }

        audit = Audit()
        with patch.object(
            doctor,
            "task_metadata_at_commit",
            side_effect=metadata_at_commit,
        ), patch.object(
            doctor,
            "git_tree_entry",
            return_value=("100644", "blob", "e" * 40),
        ), patch.object(
            doctor,
            "git_object",
            side_effect=card_at_commit,
        ):
            validate_backlog_resolution_commit(
                audit,
                good_commit,
                corrupt_commit,
                resolved,
                resolved,
            )
            validate_backlog_resolution_commit(
                audit,
                corrupt_commit,
                restored_commit,
                resolved,
                resolved,
            )
        self.assertTrue(
            any(
                f"metadata must remain immutable on edge {good_commit}..{corrupt_commit}"
                in error
                for error in audit.errors
            ),
            audit.errors,
        )

    def test_resolved_card_mode_cannot_be_corrupted_then_restored(self) -> None:
        backlog, _, _, _ = self.load_inputs()
        resolution = {
            "state": "REJECTED",
            "reason": "Owner cancelled the planned capability",
            "decidedBy": "repository-owner",
            "decidedAt": "2026-08-01",
            "replacementTask": None,
        }
        resolved = copy.deepcopy(backlog)
        resolved["resolutions"]["TASK-0013"] = resolution
        entry = resolved["tasks"]["TASK-0013"]
        terminal = {
            "taskId": "TASK-0013",
            "state": "REJECTED",
            "owner": "repository-owner",
            "planningBacklog": ".harness/task-backlog.yaml",
            "planningContractHash": canonical_json_sha256(entry),
            "planningContractHashAlgorithm": "SHA256_CANONICAL_JSON_V1",
            "planningResolution": resolution,
        }
        good_commit = "a" * 40
        corrupt_commit = "b" * 40
        restored_commit = "c" * 40

        def tree_entry(commit: str, _path: str) -> tuple[str, str, str]:
            mode = "120000" if commit == corrupt_commit else "100644"
            return (mode, "blob", "e" * 40)

        audit = Audit()
        with patch.object(
            doctor,
            "task_metadata_at_commit",
            return_value=terminal,
        ), patch.object(
            doctor,
            "git_tree_entry",
            side_effect=tree_entry,
        ), patch.object(
            doctor,
            "git_object",
            return_value=self.card_bytes(entry, terminal),
        ):
            validate_backlog_resolution_commit(
                audit,
                good_commit,
                corrupt_commit,
                resolved,
                resolved,
            )
            validate_backlog_resolution_commit(
                audit,
                corrupt_commit,
                restored_commit,
                resolved,
                resolved,
            )
        self.assertTrue(
            any(
                f"regular 100644 blob at {corrupt_commit}" in error
                for error in audit.errors
            ),
            audit.errors,
        )

    def test_resolved_card_render_projection_cannot_be_corrupted_then_restored(
        self,
    ) -> None:
        backlog, _, _, _ = self.load_inputs()
        resolution = {
            "state": "REJECTED",
            "reason": "Owner cancelled the planned capability",
            "decidedBy": "repository-owner",
            "decidedAt": "2026-08-01",
            "replacementTask": None,
        }
        resolved = copy.deepcopy(backlog)
        resolved["resolutions"]["TASK-0013"] = resolution
        entry = resolved["tasks"]["TASK-0013"]
        terminal = {
            "taskId": "TASK-0013",
            "state": "REJECTED",
            "owner": "repository-owner",
            "planningBacklog": ".harness/task-backlog.yaml",
            "planningContractHash": canonical_json_sha256(entry),
            "planningContractHashAlgorithm": "SHA256_CANONICAL_JSON_V1",
            "planningResolution": resolution,
        }
        good_commit = "a" * 40
        corrupt_commit = "b" * 40
        restored_commit = "c" * 40
        transforms = {
            "title": lambda text: text.replace(
                "# TASK-0013：Provider Registry 与供应商中立准入模型",
                "# TASK-0013：corrupt",
                1,
            ),
            "notice": lambda text: text.replace(
                doctor.PLANNED_CARD_NON_NORMATIVE_NOTICE,
                "",
                1,
            ),
            "section": lambda text: text.replace("## 目标", "## 篡改目标", 1),
        }
        for name, transform in transforms.items():
            with self.subTest(name=name):
                def card_at_commit(commit: str, _path: str) -> bytes:
                    selected = transform if commit == corrupt_commit else None
                    return self.card_bytes(entry, terminal, transform=selected)

                audit = Audit()
                with patch.object(
                    doctor,
                    "git_tree_entry",
                    return_value=("100644", "blob", "e" * 40),
                ), patch.object(
                    doctor,
                    "git_object",
                    side_effect=card_at_commit,
                ):
                    validate_backlog_resolution_commit(
                        audit,
                        good_commit,
                        corrupt_commit,
                        resolved,
                        resolved,
                    )
                    validate_backlog_resolution_commit(
                        audit,
                        corrupt_commit,
                        restored_commit,
                        resolved,
                        resolved,
                    )
                self.assertTrue(audit.errors, name)
                self.assertTrue(
                    any(
                        "planning card heading" in error
                        or "fixed Backlog projection" in error
                        or "six-section projection" in error
                        for error in audit.errors
                    ),
                    audit.errors,
                )

    def test_introduced_planned_card_requires_complete_render_projection(self) -> None:
        backlog, _, lifecycle, _ = self.load_inputs()
        parent = copy.deepcopy(backlog)
        parent["tasks"].pop("TASK-0037")
        entry = backlog["tasks"]["TASK-0037"]
        metadata = {
            "taskId": "TASK-0037",
            "state": "PLANNED",
            "owner": "repository-owner",
            "planningBacklog": ".harness/task-backlog.yaml",
            "planningContractHash": canonical_json_sha256(entry),
            "planningContractHashAlgorithm": "SHA256_CANONICAL_JSON_V1",
        }
        invalid_card = self.card_bytes(
            entry,
            metadata,
            transform=lambda text: text.replace(
                doctor.PLANNED_CARD_NON_NORMATIVE_NOTICE,
                "",
                1,
            ),
        )
        audit = Audit()
        with patch.object(
            doctor,
            "git_tree_entry",
            return_value=("100644", "blob", "e" * 40),
        ), patch.object(
            doctor,
            "git_object",
            return_value=invalid_card,
        ):
            validate_backlog_card_history_edge(
                audit,
                "a" * 40,
                "b" * 40,
                parent,
                backlog,
                lifecycle,
            )
        self.assertTrue(
            any("fixed Backlog projection" in error for error in audit.errors),
            audit.errors,
        )

    def test_backlog_history_classifies_execution_rejected_and_planning_terminal_edges(
        self,
    ) -> None:
        backlog, tasks, lifecycle, _ = self.load_inputs()

        def run_edge(
            task_id: str,
            parent_metadata: dict[str, object],
            child_metadata: dict[str, object],
            parent_backlog: dict[str, object],
            child_backlog: dict[str, object],
        ) -> Audit:
            entry = child_backlog["tasks"][task_id]
            task_path = str(entry["taskCard"])
            parent_commit = "a" * 40
            child_commit = "b" * 40

            def tree_entry(commit: str, path: str) -> tuple[str, str, str]:
                oid = commit if path == task_path else "e" * 40
                return ("100644", "blob", oid)

            def card_at_commit(commit: str, _path: str) -> bytes:
                metadata = (
                    parent_metadata if commit == parent_commit else child_metadata
                )
                return self.card_bytes(entry, metadata)

            audit = Audit()
            with patch.object(
                doctor,
                "git_tree_entry",
                side_effect=tree_entry,
            ), patch.object(
                doctor,
                "git_object",
                side_effect=card_at_commit,
            ):
                validate_backlog_card_history_edge(
                    audit,
                    parent_commit,
                    child_commit,
                    parent_backlog,
                    child_backlog,
                    lifecycle,
                )
            return audit

        execution_parent = {
            key: value
            for key, value in tasks["TASK-0037"].items()
            if key != "_path"
        }
        execution_parent["state"] = "IN_REVIEW"
        execution_child = copy.deepcopy(execution_parent)
        execution_child["state"] = "REJECTED"
        execution_child["resolutionReason"] = (
            "执行态任务在评审后失败关闭，并保留完整动态证据。"
        )
        execution_audit = run_edge(
            "TASK-0037",
            execution_parent,
            execution_child,
            backlog,
            backlog,
        )
        self.assertEqual([], execution_audit.errors)

        planned = {
            key: value
            for key, value in tasks["TASK-0013"].items()
            if key != "_path"
        }
        for terminal_state in ("REJECTED", "SUPERSEDED"):
            with self.subTest(terminal_state=terminal_state):
                resolution = {
                    "state": terminal_state,
                    "reason": "Owner resolved the planning-only card atomically.",
                    "decidedBy": "repository-owner",
                    "decidedAt": "2026-08-01",
                    "replacementTask": (
                        "TASK-0014" if terminal_state == "SUPERSEDED" else None
                    ),
                }
                resolved_backlog = copy.deepcopy(backlog)
                resolved_backlog["resolutions"]["TASK-0013"] = resolution
                terminal = {
                    **planned,
                    "state": terminal_state,
                    "planningResolution": resolution,
                }
                planning_audit = run_edge(
                    "TASK-0013",
                    planned,
                    terminal,
                    backlog,
                    resolved_backlog,
                )
                self.assertEqual([], planning_audit.errors)

    def test_backlog_history_rejects_classification_reversals(self) -> None:
        backlog, tasks, lifecycle, _ = self.load_inputs()

        def run_edge(
            task_id: str,
            parent_metadata: dict[str, object],
            child_metadata: dict[str, object],
            child_backlog: dict[str, object] | None = None,
        ) -> Audit:
            selected_child = child_backlog or backlog
            entry = selected_child["tasks"][task_id]
            task_path = str(entry["taskCard"])
            parent_commit = "c" * 40
            child_commit = "d" * 40

            def tree_entry(commit: str, path: str) -> tuple[str, str, str]:
                oid = commit if path == task_path else "e" * 40
                return ("100644", "blob", oid)

            def card_at_commit(commit: str, _path: str) -> bytes:
                metadata = (
                    parent_metadata if commit == parent_commit else child_metadata
                )
                return self.card_bytes(entry, metadata)

            audit = Audit()
            with patch.object(
                doctor,
                "git_tree_entry",
                side_effect=tree_entry,
            ), patch.object(
                doctor,
                "git_object",
                side_effect=card_at_commit,
            ):
                validate_backlog_card_history_edge(
                    audit,
                    parent_commit,
                    child_commit,
                    backlog,
                    selected_child,
                    lifecycle,
                )
            return audit

        planned = {
            key: value
            for key, value in tasks["TASK-0013"].items()
            if key != "_path"
        }
        pseudo_execution = {
            **planned,
            "state": "REJECTED",
            "baseCommit": "a" * 40,
        }
        planned_to_execution = run_edge(
            "TASK-0013",
            planned,
            pseudo_execution,
        )
        self.assertTrue(
            any(
                "invalid planning/execution classification edge" in error
                for error in planned_to_execution.errors
            ),
            planned_to_execution.errors,
        )

        execution_parent = {
            key: value
            for key, value in tasks["TASK-0037"].items()
            if key != "_path"
        }
        execution_parent["state"] = "IN_REVIEW"
        planning_resolution = {
            "state": "REJECTED",
            "reason": "Invalid attempt to erase execution history.",
            "decidedBy": "repository-owner",
            "decidedAt": "2026-08-01",
            "replacementTask": None,
        }
        pseudo_planning = {
            "taskId": "TASK-0037",
            "state": "REJECTED",
            "owner": "repository-owner",
            "planningBacklog": ".harness/task-backlog.yaml",
            "planningContractHash": canonical_json_sha256(
                backlog["tasks"]["TASK-0037"]
            ),
            "planningContractHashAlgorithm": "SHA256_CANONICAL_JSON_V1",
            "planningResolution": planning_resolution,
        }
        resolved_backlog = copy.deepcopy(backlog)
        resolved_backlog["resolutions"]["TASK-0037"] = planning_resolution
        execution_to_planning = run_edge(
            "TASK-0037",
            execution_parent,
            pseudo_planning,
            resolved_backlog,
        )
        self.assertTrue(
            any(
                "invalid planning/execution classification edge" in error
                for error in execution_to_planning.errors
            ),
            execution_to_planning.errors,
        )

        execution_superseded = copy.deepcopy(execution_parent)
        execution_superseded["state"] = "SUPERSEDED"
        superseded_audit = run_edge(
            "TASK-0037",
            execution_parent,
            execution_superseded,
        )
        self.assertTrue(
            any(
                "execution card TASK-0037 cannot transition to SUPERSEDED"
                in error
                for error in superseded_audit.errors
            ),
            superseded_audit.errors,
        )

    def test_planning_terminal_rejects_dynamic_fields_or_missing_resolution(
        self,
    ) -> None:
        _, tasks, lifecycle, _ = self.load_inputs()
        planned = copy.deepcopy(tasks["TASK-0013"])

        missing_resolution = copy.deepcopy(planned)
        missing_resolution["state"] = "REJECTED"
        missing_audit = Audit()
        validate_tasks(
            missing_audit,
            {"TASK-0013": missing_resolution},
            lifecycle,
        )
        self.assertTrue(
            any(
                "planning terminal state requires planningResolution" in error
                for error in missing_audit.errors
            ),
            missing_audit.errors,
        )

        dynamic = copy.deepcopy(missing_resolution)
        dynamic["planningResolution"] = {
            "state": "REJECTED",
            "reason": "Owner resolved the planning-only card.",
            "decidedBy": "repository-owner",
            "decidedAt": "2026-08-01",
            "replacementTask": None,
        }
        dynamic["evidence"] = "docs/evidence/TASK-0013/evidence-pack.json"
        dynamic_audit = Audit()
        validate_tasks(
            dynamic_audit,
            {"TASK-0013": dynamic},
            lifecycle,
        )
        self.assertTrue(
            any(
                "dynamic execution evidence is forbidden" in error
                for error in dynamic_audit.errors
            ),
            dynamic_audit.errors,
        )

    def test_owner_scope_amendment_is_controlled_and_append_only(self) -> None:
        _, tasks, _, _ = self.load_inputs()
        task = copy.deepcopy(tasks["TASK-0012"])
        audit = Audit()
        added = validate_scope_amendments(audit, "TASK-0012", task)
        self.assertEqual([], audit.errors)
        self.assertEqual(
            ["docs/tasks/TASK-0037-harness-performance-layered-validation.md"],
            added,
        )
        self.assertIn(
            "docs/tasks/TASK-0037-harness-performance-layered-validation.md",
            effective_task_write_allowlist(task),
        )

        parent: list[object] = []
        child = copy.deepcopy(task["scopeAmendments"])
        valid_edge = Audit()
        validate_scope_amendment_edge(valid_edge, parent, child, "parent..child")
        self.assertEqual([], valid_edge.errors)

        rewritten = copy.deepcopy(child)
        rewritten[0]["reason"] = "rewritten"
        invalid_edge = Audit()
        validate_scope_amendment_edge(
            invalid_edge,
            child,
            rewritten,
            "child..rewritten",
        )
        self.assertTrue(
            any("append-only and immutable" in error for error in invalid_edge.errors),
            invalid_edge.errors,
        )

        invalid_task = copy.deepcopy(task)
        invalid_task["scopeAmendments"][0]["contract"]["approvedBy"] = (
            "implementation-agent"
        )
        invalid_task["scopeAmendments"][0]["contract"]["addedWriteAllowlist"] = [
            "docs/tasks/**"
        ]
        invalid = Audit()
        validate_scope_amendments(invalid, "TASK-0012", invalid_task)
        messages = "\n".join(invalid.errors)
        self.assertIn("must be the repository-owner task owner", messages)
        self.assertIn("must be one canonical repository-relative POSIX path", messages)

        legacy_task = copy.deepcopy(task)
        legacy_task["scopeAmendments"] = [
            {
                "amendmentId": "retired-legacy-grant",
                "approvedBy": "repository-owner",
                "approvedAt": "2026-07-30",
                "evidence": "historical audit record",
                "reason": "must not authorize current writes",
                "addedWriteAllowlist": ["docs/tasks/TASK-9999.md"],
                "acceptanceAdditions": ["historical note"],
            }
        ]
        legacy = Audit()
        self.assertEqual(
            [],
            validate_scope_amendments(legacy, "TASK-0012", legacy_task),
        )
        self.assertTrue(
            any("cannot grant write authority" in error for error in legacy.errors),
            legacy.errors,
        )

    def test_amendment_paths_reject_aliases_and_remain_exact_not_globs(self) -> None:
        aliases = [
            "./docs/tasks/TASK-9999.md",
            r"docs\tasks\TASK-9999.md",
            "docs//tasks/TASK-9999.md",
            "docs/tasks/../tasks/TASK-9999.md",
            "docs/tasks/TASK-9999.md/",
            "docs/tasks/Cafe\u0301.md",
        ]
        for alias in aliases:
            self.assertIsNone(canonical_exact_repo_path(alias), alias)
        self.assertEqual(
            "docs/tasks/TASK-9999.md",
            canonical_exact_repo_path("docs/tasks/TASK-9999.md"),
        )

        _, tasks, _, _ = self.load_inputs()
        task = copy.deepcopy(tasks["TASK-0012"])
        patterns, exact_paths = effective_task_write_scope(task)
        self.assertIn(
            "docs/tasks/TASK-0037-harness-performance-layered-validation.md",
            exact_paths,
        )
        self.assertNotIn(
            "docs/tasks/task-0037-harness-performance-layered-validation.md",
            exact_paths,
        )
        self.assertFalse(
            any(
                glob_matches(
                    "docs/tasks/TASK-9999-unrelated.md",
                    pattern,
                )
                for pattern in exact_paths
            )
        )
        self.assertTrue(patterns)

    def test_strong_owner_amendment_binds_exact_authorized_clauses(self) -> None:
        _, tasks, _, _ = self.load_inputs()
        task = copy.deepcopy(tasks["TASK-0012"])
        contract, authorized_text = self.owner_amendment_contract(task)
        amendment_id = "task-0012-owner-formalize-task-0037"
        audit = Audit()
        validate_authorization_amendment_contract(
            audit,
            "fixture",
            amendment_id,
            contract,
            task,
            authorized_text=authorized_text,
            seen_path_keys={},
        )
        self.assertEqual([], audit.errors)

        tampered = copy.deepcopy(contract)
        tampered["replacements"][0]["supersedes"]["statement"] = "rewritten"
        invalid = Audit()
        validate_authorization_amendment_contract(
            invalid,
            "fixture",
            amendment_id,
            tampered,
            task,
            authorized_text=authorized_text,
            seen_path_keys={},
        )
        messages = "\n".join(invalid.errors)
        self.assertIn("statementHash is invalid", messages)
        self.assertIn("must match the authorized clause exactly", messages)

    def test_strong_amendment_atomically_grants_only_its_exact_new_paths(self) -> None:
        _, tasks, _, _ = self.load_inputs()
        task = copy.deepcopy(tasks["TASK-0012"])
        parent_commit = "a" * 40
        commit = "b" * 40
        contract, _ = self.owner_amendment_contract(
            task,
            parent_commit=parent_commit,
        )
        amendment_id = "task-0012-owner-formalize-task-0037"
        amendment = {
            "schemaVersion": 2,
            "amendmentId": amendment_id,
            "contractSource": ".harness/task-backlog.yaml",
            "contractHashAlgorithm": "SHA256_CANONICAL_JSON_V1",
            "contractHash": canonical_json_sha256(contract),
            "contract": contract,
        }
        exact_paths = {
            str(task["_path"]),
            ".harness/task-backlog.yaml",
            "docs/tasks/TASK-0037-harness-performance-layered-validation.md",
        }

        def backlog_amendments(revision: str) -> dict[str, object]:
            return {} if revision == parent_commit else {amendment_id: contract}

        valid = Audit()
        with patch.object(
            doctor,
            "changed_paths_across_history",
            return_value=[],
        ), patch.object(
            doctor,
            "git_tree_entry",
            return_value=("100644", "blob", "c" * 40),
        ), patch.object(
            doctor,
            "backlog_authorization_amendments_at",
            side_effect=backlog_amendments,
        ), patch.object(
            doctor,
            "changed_paths_between",
            return_value=sorted(exact_paths),
        ):
            validate_amendment_introduction(
                valid,
                "TASK-0012",
                str(task["_path"]),
                str(task["baseCommit"]),
                parent_commit,
                commit,
                [parent_commit],
                amendment,
            )
        self.assertEqual([], valid.errors)

        extra = Audit()
        with patch.object(
            doctor,
            "changed_paths_across_history",
            return_value=[],
        ), patch.object(
            doctor,
            "git_tree_entry",
            return_value=("100644", "blob", "c" * 40),
        ), patch.object(
            doctor,
            "backlog_authorization_amendments_at",
            side_effect=backlog_amendments,
        ), patch.object(
            doctor,
            "changed_paths_between",
            return_value=sorted({*exact_paths, "scripts/harness/doctor.py"}),
        ):
            validate_amendment_introduction(
                extra,
                "TASK-0012",
                str(task["_path"]),
                str(task["baseCommit"]),
                parent_commit,
                commit,
                [parent_commit],
                amendment,
            )
        self.assertTrue(
            any("must change exactly" in error for error in extra.errors),
            extra.errors,
        )

    def test_backlog_amendment_and_task_projection_are_bidirectional(self) -> None:
        _, tasks, _, _ = self.load_inputs()
        projected_tasks = copy.deepcopy(tasks)
        task = projected_tasks["TASK-0012"]
        amendment_id = "task-0012-owner-formalize-task-0037"
        contract, authorized_text = self.owner_amendment_contract(task)
        projection = {
            "schemaVersion": 2,
            "amendmentId": amendment_id,
            "contractSource": ".harness/task-backlog.yaml",
            "contractHashAlgorithm": "SHA256_CANONICAL_JSON_V1",
            "contractHash": canonical_json_sha256(contract),
            "contract": contract,
        }
        task["scopeAmendments"] = [
            item
            for item in task["scopeAmendments"]
            if not (
                isinstance(item, dict)
                and item.get("amendmentId") == amendment_id
            )
        ]
        task["scopeAmendments"].append(projection)
        audit = Audit()
        with patch.object(
            doctor,
            "git_object",
            return_value=authorized_text.encode("utf-8"),
        ):
            validate_backlog_authorization_amendments(
                audit,
                {amendment_id: contract},
                projected_tasks,
            )
        self.assertEqual([], audit.errors)

        missing = Audit()
        validate_backlog_authorization_amendments(missing, {}, projected_tasks)
        self.assertTrue(
            any("exact bidirectional membership" in error for error in missing.errors),
            missing.errors,
        )

    def test_uncommitted_amendment_and_history_rewrite_fail_closed(self) -> None:
        _, tasks, _, _ = self.load_inputs()
        committed = copy.deepcopy(tasks["TASK-0012"]["scopeAmendments"])
        current = copy.deepcopy(committed)
        current.append({"amendmentId": "uncommitted"})
        worktree = Audit()
        validate_uncommitted_scope_amendments(
            worktree,
            committed,
            current,
            "HEAD..WORKTREE",
        )
        self.assertTrue(
            any("must already exist in a single-parent Git commit" in error for error in worktree.errors),
            worktree.errors,
        )

        parent = {
            "authorizationAmendments": {
                "owner-amendment": {"schemaVersion": 1, "reason": "original"}
            }
        }
        corrupt = copy.deepcopy(parent)
        corrupt["authorizationAmendments"]["owner-amendment"]["reason"] = "corrupt"
        restored = copy.deepcopy(parent)
        history = Audit()
        validate_backlog_authorization_amendment_edge(
            history,
            parent,
            corrupt,
            "good..corrupt",
        )
        validate_backlog_authorization_amendment_edge(
            history,
            corrupt,
            restored,
            "corrupt..restored",
        )
        self.assertTrue(
            any("removed or rewritten" in error for error in history.errors),
            history.errors,
        )

    def test_full_history_scans_introduction_and_preterminal_corrupt_restore(
        self,
    ) -> None:
        backlog, _, lifecycle, _ = self.load_inputs()
        task_id = "TASK-0013"
        task_path = str(backlog["tasks"][task_id]["taskCard"])
        card_paths = {
            str(entry["taskCard"])
            for entry in backlog["tasks"].values()
            if isinstance(entry, dict)
        }
        card_bytes = {
            path: (ROOT / path).read_bytes()
            for path in card_paths
            if (ROOT / path).is_file()
        }
        good_card = card_bytes[task_path]
        corrupt_card = good_card.replace(
            f"# {task_id}：".encode("utf-8"),
            f"# {task_id}：被篡改-".encode("utf-8"),
            1,
        )
        commits = ("a" * 40, "b" * 40, "c" * 40)

        def tree_entry(revision: str, path: str) -> tuple[str, str, str] | None:
            if path == ".harness/task-backlog.yaml":
                return ("100644", "blob", "d" * 40)
            if path not in card_paths:
                return None
            blob = "e" * 40
            if path == task_path and revision == commits[1]:
                blob = "f" * 40
            return ("100644", "blob", blob)

        def object_bytes(revision: str, path: str) -> bytes:
            if path == task_path and revision == commits[1]:
                return corrupt_card
            return card_bytes[path]

        def yaml_snapshot(revision: str, path: str) -> dict[str, object]:
            if path == ".harness/task-backlog.yaml":
                return copy.deepcopy(backlog)
            return {"tasks": {}}

        activation = str(
            lifecycle["rules"]["backlogHistoryPolicy"]["activationCommit"]
        )
        graph = "\n".join(
            (
                f"{commits[0]} {activation}",
                f"{commits[1]} {commits[0]}",
                f"{commits[2]} {commits[1]}",
            )
        )

        def git_history(*args: str, **_: object) -> subprocess.CompletedProcess[str]:
            stdout = "" if args[0] == "merge-base" else graph
            return subprocess.CompletedProcess(
                args=["git", *args],
                returncode=0,
                stdout=stdout,
                stderr="",
            )

        audit = Audit()
        with patch.object(
            doctor,
            "git_text",
            side_effect=git_history,
        ), patch.object(
            doctor,
            "git_tree_entry",
            side_effect=tree_entry,
        ), patch.object(
            doctor,
            "git_object",
            side_effect=object_bytes,
        ), patch.object(
            doctor,
            "yaml_at_commit",
            side_effect=yaml_snapshot,
        ):
            validate_task_backlog_history(audit, backlog, lifecycle)
        self.assertTrue(
            any(
                "planning card heading" in error
                or "six-section projection changed" in error
                for error in audit.errors
            ),
            audit.errors,
        )

    def test_real_git_history_rejects_corrupt_restore_and_moved_activation(
        self,
    ) -> None:
        task_id = "TASK-9001"
        task_path = "docs/tasks/TASK-9001-synthetic-planning-fixture.md"
        task_entry = {
            "title": "Synthetic Planning Fixture",
            "taskCard": task_path,
            "dependencies": [],
            "decisionGates": [],
            "promotionConditions": {
                "requiresRepositoryIdle": True,
                "requiresAcceptedDependencies": True,
                "requiresApprovedDecisionGates": True,
                "requiresFirstByExecutionOrder": True,
            },
        }
        fixture_backlog = {
            "schemaVersion": 1,
            "bootstrapTask": "TASK-9000",
            "tasks": {task_id: task_entry},
            "executionOrder": [task_id],
            "criticalPath": [],
            "decisionGates": {},
            "resolutions": {},
            "authorizationAmendments": {},
        }
        planned_metadata = {
            "taskId": task_id,
            "state": "PLANNED",
            "owner": "repository-owner",
            "planningBacklog": ".harness/task-backlog.yaml",
            "planningContractHash": canonical_json_sha256(task_entry),
            "planningContractHashAlgorithm": "SHA256_CANONICAL_JSON_V1",
        }
        planned_yaml = yaml.safe_dump(
            planned_metadata,
            allow_unicode=True,
            sort_keys=False,
        ).rstrip()
        fixture_card = (
            f"# {task_id}：{task_entry['title']}\n\n"
            f"```yaml\n{planned_yaml}\n```\n\n"
            f"{doctor.PLANNED_CARD_NON_NORMATIVE_NOTICE}\n\n"
            "## Objective\n\nSynthetic objective.\n\n"
            "## Scope\n\nSynthetic scope.\n\n"
            "## Dependencies\n\nNo dependencies.\n\n"
            "## Decision Gates\n\nNo decision gates.\n\n"
            "## Promotion Conditions\n\nSynthetic promotion conditions.\n\n"
            "## Acceptance Criteria\n\nSynthetic acceptance criteria.\n"
        )
        baseline_lifecycle = {
            "transitions": {
                "PLANNED": ["DRAFT", "REJECTED", "SUPERSEDED"],
            },
            "rules": {},
        }

        def run_fixture(*, attack: bool) -> list[str]:
            with tempfile.TemporaryDirectory() as directory:
                repository = Path(directory)
                subprocess.run(["git", "init", "-q"], cwd=repository, check=True)
                subprocess.run(
                    ["git", "config", "user.name", "Harness Test"],
                    cwd=repository,
                    check=True,
                )
                subprocess.run(
                    ["git", "config", "user.email", "harness@example.invalid"],
                    cwd=repository,
                    check=True,
                )
                backlog_path = repository / ".harness/task-backlog.yaml"
                lifecycle_path = repository / ".harness/task-lifecycle.yaml"
                backlog_path.parent.mkdir(parents=True)
                backlog_path.write_text(
                    yaml.safe_dump(
                        fixture_backlog,
                        allow_unicode=True,
                        sort_keys=False,
                    ),
                    encoding="utf-8",
                )
                lifecycle_path.write_text(
                    yaml.safe_dump(
                        baseline_lifecycle,
                        allow_unicode=True,
                        sort_keys=False,
                    ),
                    encoding="utf-8",
                )
                card_path = repository / task_path
                card_path.parent.mkdir(parents=True, exist_ok=True)
                card_path.write_text(fixture_card, encoding="utf-8")
                fixture_good_card = (repository / task_path).read_bytes()

                def commit(message: str) -> str:
                    subprocess.run(["git", "add", "-A"], cwd=repository, check=True)
                    subprocess.run(
                        ["git", "commit", "-qm", message],
                        cwd=repository,
                        check=True,
                    )
                    return subprocess.run(
                        ["git", "rev-parse", "HEAD"],
                        cwd=repository,
                        check=True,
                        text=True,
                        encoding="utf-8",
                        stdout=subprocess.PIPE,
                    ).stdout.strip()

                activation = commit("published baseline")
                policy_lifecycle = copy.deepcopy(baseline_lifecycle)
                policy_lifecycle["rules"]["backlogHistoryPolicy"] = {
                    "activationCommit": activation,
                    "mode": "VALIDATE_ACTIVATION_SNAPSHOT_THEN_ALL_PARENT_EDGES",
                }
                lifecycle_path.write_text(
                    yaml.safe_dump(
                        policy_lifecycle,
                        allow_unicode=True,
                        sort_keys=False,
                    ),
                    encoding="utf-8",
                )
                commit("introduce immutable history policy")
                if attack:
                    (repository / task_path).write_bytes(
                        fixture_good_card.replace(
                            b"# TASK-9001",
                            b"# TASK-9001-CORRUPTED",
                            1,
                        )
                    )
                    commit("corrupt planning card")
                    (repository / task_path).write_bytes(fixture_good_card)
                    restored = commit("restore planning card")
                    policy_lifecycle["rules"]["backlogHistoryPolicy"][
                        "activationCommit"
                    ] = restored
                    lifecycle_path.write_text(
                        yaml.safe_dump(
                            policy_lifecycle,
                            allow_unicode=True,
                            sort_keys=False,
                        ),
                        encoding="utf-8",
                    )
                    commit("move activation after restored corruption")

                current_lifecycle = yaml.safe_load(
                    lifecycle_path.read_text(encoding="utf-8")
                )
                audit = Audit()
                with patch.object(
                    harness_common,
                    "ROOT",
                    repository,
                ), patch.object(
                    doctor,
                    "ROOT",
                    repository,
                ):
                    derive_immutable_backlog_history_policy(
                        audit,
                        current_lifecycle,
                    )
                    validate_task_backlog_history(
                        audit,
                        fixture_backlog,
                        current_lifecycle,
                    )
                return audit.errors

        self.assertEqual([], run_fixture(attack=False))
        attack_errors = run_fixture(attack=True)
        self.assertTrue(
            any("append-only and immutable" in error for error in attack_errors),
            attack_errors,
        )
        self.assertTrue(
            any(
                "planning card heading" in error
                or "six-section projection changed" in error
                for error in attack_errors
            ),
            attack_errors,
        )

    def test_unresolved_planned_card_metadata_cannot_be_corrupted_then_restored(
        self,
    ) -> None:
        backlog, _, lifecycle, _ = self.load_inputs()
        entry = backlog["tasks"]["TASK-0013"]
        task_path = entry["taskCard"]
        planned = {
            "taskId": "TASK-0013",
            "state": "PLANNED",
            "owner": "repository-owner",
            "planningBacklog": ".harness/task-backlog.yaml",
            "planningContractHash": canonical_json_sha256(entry),
            "planningContractHashAlgorithm": "SHA256_CANONICAL_JSON_V1",
        }
        good_commit = "a" * 40
        corrupt_commit = "b" * 40
        restored_commit = "c" * 40

        def metadata_at_commit(commit: str, _path: str) -> dict[str, object]:
            if commit == corrupt_commit:
                return {
                    **planned,
                    "owner": "temporary-owner",
                    "baseCommit": "d" * 40,
                }
            return planned

        def tree_entry(commit: str, path: str) -> tuple[str, str, str]:
            oid = commit if path == task_path else "e" * 40
            return ("100644", "blob", oid)

        def card_at_commit(commit: str, _path: str) -> bytes:
            return self.card_bytes(entry, metadata_at_commit(commit, _path))

        audit = Audit()
        with patch.object(
            doctor,
            "task_metadata_at_commit",
            side_effect=metadata_at_commit,
        ), patch.object(
            doctor,
            "git_tree_entry",
            side_effect=tree_entry,
        ), patch.object(
            doctor,
            "git_object",
            side_effect=card_at_commit,
        ):
            validate_backlog_card_history_edge(
                audit,
                good_commit,
                corrupt_commit,
                backlog,
                backlog,
                lifecycle,
            )
            validate_backlog_card_history_edge(
                audit,
                corrupt_commit,
                restored_commit,
                backlog,
                backlog,
                lifecycle,
            )
        self.assertTrue(
            any(
                f"metadata must remain immutable on edge {good_commit}..{corrupt_commit}"
                in error
                for error in audit.errors
            ),
            audit.errors,
        )

    def test_backlog_card_cannot_draft_then_restore_to_planned(self) -> None:
        backlog, _, lifecycle, _ = self.load_inputs()
        entry = backlog["tasks"]["TASK-0013"]
        task_path = entry["taskCard"]
        planned = {
            "taskId": "TASK-0013",
            "state": "PLANNED",
            "owner": "repository-owner",
            "planningBacklog": ".harness/task-backlog.yaml",
            "planningContractHash": canonical_json_sha256(entry),
            "planningContractHashAlgorithm": "SHA256_CANONICAL_JSON_V1",
        }
        draft = {
            **planned,
            "state": "DRAFT",
            "baseCommit": "a" * 40,
        }
        good_commit = "a" * 40
        draft_commit = "b" * 40
        restored_commit = "c" * 40

        def metadata_at_commit(commit: str, _path: str) -> dict[str, object]:
            return draft if commit == draft_commit else planned

        def tree_entry(commit: str, path: str) -> tuple[str, str, str]:
            oid = commit if path == task_path else "e" * 40
            return ("100644", "blob", oid)

        def card_at_commit(commit: str, _path: str) -> bytes:
            return self.card_bytes(entry, metadata_at_commit(commit, _path))

        audit = Audit()
        with patch.object(
            doctor,
            "task_metadata_at_commit",
            side_effect=metadata_at_commit,
        ), patch.object(
            doctor,
            "git_tree_entry",
            side_effect=tree_entry,
        ), patch.object(
            doctor,
            "git_object",
            side_effect=card_at_commit,
        ):
            validate_backlog_card_history_edge(
                audit,
                good_commit,
                draft_commit,
                backlog,
                backlog,
                lifecycle,
            )
            validate_backlog_card_history_edge(
                audit,
                draft_commit,
                restored_commit,
                backlog,
                backlog,
                lifecycle,
            )
        self.assertTrue(
            any(
                "invalid card state edge TASK-0013 DRAFT -> PLANNED"
                in error
                for error in audit.errors
            ),
            audit.errors,
        )

    def test_planned_body_declares_non_normative_backlog_projection(self) -> None:
        _, tasks, lifecycle, _ = self.load_inputs()
        planned = copy.deepcopy(tasks["TASK-0013"])
        with patch.object(
            doctor,
            "read_repository_text",
            return_value="# TASK-0013：tampered\n",
        ):
            audit = Audit()
            validate_tasks(audit, {"TASK-0013": planned}, lifecycle)
        self.assertTrue(
            any("non-normative Backlog rendering" in error for error in audit.errors),
            audit.errors,
        )

    def test_planned_cards_bind_backlog_without_dynamic_evidence(self) -> None:
        backlog, tasks, _, _ = self.load_inputs()
        forbidden_dynamic = set(
            backlog["rules"]["promotion"]["forbiddenDynamicFieldsWhilePlanned"]
        )
        for task_id in backlog["executionOrder"]:
            task = tasks[task_id]
            if task["state"] != "PLANNED":
                continue
            self.assertEqual("PLANNED", task["state"])
            self.assertEqual(
                canonical_json_sha256(backlog["tasks"][task_id]),
                task["planningContractHash"],
            )
            self.assertFalse(
                forbidden_dynamic & set(task),
                (task_id, forbidden_dynamic & set(task)),
            )

    def test_backlog_rejects_dependency_order_cycle_and_card_hash_drift(self) -> None:
        backlog, tasks, lifecycle, state = self.load_inputs()
        tampered = copy.deepcopy(backlog)
        tampered["tasks"]["TASK-0013"]["dependencies"] = ["TASK-0014"]
        tampered["tasks"]["TASK-0014"]["objective"] = "rewritten"
        audit = Audit()
        validate_task_backlog_data(
            audit,
            tampered,
            tasks,
            lifecycle,
            state,
        )
        messages = "\n".join(audit.errors)
        self.assertIn("must precede the task in executionOrder", messages)
        self.assertIn("PLANNED card hash drifts", messages)

    def test_backlog_derives_next_task_and_hard_gate_blockers(self) -> None:
        backlog, tasks, lifecycle, state = self.load_inputs()
        terminal_tasks = copy.deepcopy(tasks)
        terminal_tasks["TASK-0012"]["state"] = "ACCEPTED"
        terminal_tasks["TASK-0037"]["state"] = "REJECTED"
        terminal_tasks["TASK-0037"]["resolutionReason"] = (
            "静态范围无法在硬预算内安全闭环，转由四张永久替代卡严格串行推进。"
        )
        idle_state = copy.deepcopy(state)
        idle_state["activeTask"] = None
        idle_state["activeTaskCard"] = None
        idle_state["nextAction"] = "将 TASK-0038 晋级为唯一 DRAFT"
        audit = Audit()
        projection = validate_task_backlog_data(
            audit,
            backlog,
            terminal_tasks,
            lifecycle,
            idle_state,
        )
        self.assertEqual([], audit.errors)
        self.assertEqual("TASK-0038", projection["nextPromotable"])
        self.assertIn(
            "WAITING_FOR_ORDER:TASK-0038",
            projection["blockers"]["TASK-0013"],
        )
        self.assertIn(
            "DECISION_GATE:GATE-IDENTITY-PROVIDER-SESSION:PENDING",
            projection["blockers"]["TASK-0034"],
        )
        self.assertIn(
            "DECISION_GATE:GATE-LIVE-MODEL-PROVIDER:PENDING",
            projection["blockers"]["TASK-0035"],
        )
        self.assertTrue(
            any(
                blocker.startswith("DEPENDENCY:")
                for blocker in projection["blockers"]["TASK-0036"]
            )
        )

    def test_backlog_history_preserves_ids_contracts_and_resolutions(self) -> None:
        backlog, _, _, _ = self.load_inputs()
        child = copy.deepcopy(backlog)
        child["tasks"].pop("TASK-0013")
        child["executionOrder"].remove("TASK-0013")
        audit = Audit()
        validate_backlog_history_edge(audit, backlog, child, "parent..child")
        self.assertTrue(
            any(
                "permanent planning contract TASK-0013 was removed" in error
                for error in audit.errors
            ),
            audit.errors,
        )

        appended = copy.deepcopy(backlog)
        appended["resolutions"]["TASK-0013"] = {
            "state": "REJECTED",
            "reason": "Owner cancelled the planned capability",
            "decidedBy": "repository-owner",
            "decidedAt": "2026-08-01",
            "replacementTask": None,
        }
        audit = Audit()
        validate_backlog_history_edge(
            audit,
            backlog,
            appended,
            "parent..child",
        )
        self.assertEqual([], audit.errors)

    def test_backlog_resolution_requires_reason_and_new_id_for_replacement(self) -> None:
        backlog, tasks, lifecycle, state = self.load_inputs()
        tampered = copy.deepcopy(backlog)
        tampered["resolutions"]["TASK-0013"] = {
            "state": "SUPERSEDED",
            "reason": " ",
            "decidedBy": "Repository Owner",
            "decidedAt": "not-a-date",
            "replacementTask": "TASK-0013",
        }
        audit = Audit()
        validate_task_backlog_data(
            audit,
            tampered,
            tasks,
            lifecycle,
            state,
        )
        messages = "\n".join(audit.errors)
        self.assertIn("reason: must be a non-blank string", messages)
        self.assertIn("decidedBy must be canonical", messages)
        self.assertIn("decidedAt must be ISO-8601", messages)
        self.assertIn("requires a distinct permanently reserved replacementTask", messages)

    def test_planning_terminal_card_is_atomic_and_does_not_consume_task_ledger(self) -> None:
        backlog, tasks, lifecycle, state = self.load_inputs()
        resolved_backlog = copy.deepcopy(backlog)
        resolved_tasks = copy.deepcopy(tasks)
        resolution = {
            "state": "SUPERSEDED",
            "reason": "Owner replaced the planned capability with a new permanent ID",
            "decidedBy": "repository-owner",
            "decidedAt": "2026-08-01",
            "replacementTask": "TASK-0014",
        }
        resolved_backlog["resolutions"]["TASK-0013"] = resolution
        resolved_tasks["TASK-0013"]["state"] = "SUPERSEDED"
        resolved_tasks["TASK-0013"]["planningResolution"] = resolution

        audit = Audit()
        validate_task_backlog_data(
            audit,
            resolved_backlog,
            resolved_tasks,
            lifecycle,
            state,
        )
        self.assertEqual([], audit.errors)

        ledger = load_yaml(ROOT / ".harness/task-ledger.yaml")
        audit = Audit()
        validate_task_ledger_entries(
            audit,
            ledger["tasks"],
            resolved_tasks,
            set(lifecycle["terminalStates"]),
        )
        self.assertEqual([], audit.errors)

        audit = Audit()
        validate_project_state(
            audit,
            state,
            lifecycle,
            resolved_tasks,
        )
        self.assertEqual([], audit.errors)

    def test_planned_task_metadata_rejects_any_dynamic_field(self) -> None:
        _, tasks, lifecycle, _ = self.load_inputs()
        planned = copy.deepcopy(tasks["TASK-0013"])
        planned["baseCommit"] = "a" * 40
        audit = Audit()
        validate_tasks(
            audit,
            {"TASK-0013": planned},
            lifecycle,
        )
        self.assertTrue(
            any(
                "dynamic execution evidence is forbidden" in error
                for error in audit.errors
            ),
            audit.errors,
        )

    def test_lifecycle_keeps_planned_outside_active_states(self) -> None:
        lifecycle = load_yaml(ROOT / ".harness/task-lifecycle.yaml")
        self.assertIn("PLANNED", lifecycle["states"])
        self.assertNotIn("PLANNED", lifecycle["activeStates"])
        self.assertEqual(1, lifecycle["rules"]["maximumPendingDraftTasks"])
        self.assertFalse(lifecycle["rules"]["plannedConsumesActiveTask"])
        self.assertEqual(
            ["DRAFT", "REJECTED", "SUPERSEDED"],
            lifecycle["transitions"]["PLANNED"],
        )
        for source, targets in lifecycle["transitions"].items():
            if source != "PLANNED":
                self.assertNotIn("SUPERSEDED", targets)
        self.assertFalse(lifecycle["rules"]["planningTerminalConsumesTaskLedger"])
        handoff_schema = json.loads(
            (ROOT / "docs/schemas/handoff.schema.json").read_text(encoding="utf-8")
        )
        self.assertNotIn(
            "SUPERSEDED",
            handoff_schema["properties"]["state"]["enum"],
        )

    def test_execution_task_cannot_use_planning_only_superseded(self) -> None:
        _, _, lifecycle, _ = self.load_inputs()
        execution = {
            "_path": "docs/tasks/TASK-9999.md",
            "taskId": "TASK-9999",
            "state": "SUPERSEDED",
        }
        audit = Audit()
        validate_tasks(audit, {"TASK-9999": execution}, lifecycle)
        self.assertTrue(
            any("SUPERSEDED is reserved for planning-only" in error for error in audit.errors),
            audit.errors,
        )

    def test_planned_task_cannot_be_selected_for_execution(self) -> None:
        _, tasks, _, _ = self.load_inputs()
        audit = Audit()
        selected = select_task_for_diff_scope(
            audit,
            "TASK-0013",
            "TASK-0012",
            None,
            "TASK-0011",
            tasks,
        )
        self.assertEqual("TASK-0012", selected)
        self.assertTrue(
            any(
                "TASK-0013 is planning-only PLANNED and cannot be executed" in error
                for error in audit.errors
            ),
            audit.errors,
        )


class StateTests(unittest.TestCase):
    def test_terminal_closure_cannot_change_capability_gates(self) -> None:
        state = load_yaml(ROOT / ".harness/project-state.yaml")
        lifecycle_only = copy.deepcopy(state)
        lifecycle_only["activeTask"] = None
        lifecycle_only["activeTaskCard"] = None
        lifecycle_only["nextAction"] = "Create the next READY task"
        self.assertEqual(
            project_state_closure_projection(state),
            project_state_closure_projection(lifecycle_only),
        )

        unsafe = copy.deepcopy(state)
        unsafe["capabilityGates"]["realPayment"]["state"] = "ALLOWED"
        self.assertNotEqual(
            project_state_closure_projection(state),
            project_state_closure_projection(unsafe),
        )

    def test_ready_projection_allows_only_activity_fields(self) -> None:
        state = load_yaml(ROOT / ".harness/project-state.yaml")
        ready = copy.deepcopy(state)
        ready["activeTask"] = "TASK-9999"
        ready["activeTaskCard"] = "docs/tasks/TASK-9999.md"
        ready["nextAction"] = "执行 TASK-9999"
        ready["updatedAt"] = "2026-07-31"
        self.assertEqual(
            project_state_ready_projection(state),
            project_state_ready_projection(ready),
        )
        ready["capabilityGates"]["realUserBeta"]["state"] = "OPEN"
        self.assertNotEqual(
            project_state_ready_projection(state),
            project_state_ready_projection(ready),
        )

    def test_multiple_active_tasks_are_rejected(self) -> None:
        tasks = copy.deepcopy(discover_tasks())
        tasks["TASK-0001"]["state"] = "IN_PROGRESS"
        tasks["TASK-0002"]["state"] = "IN_PROGRESS"
        audit = Audit()
        validate_project_state(
            audit,
            load_yaml(ROOT / ".harness/project-state.yaml"),
            load_yaml(ROOT / ".harness/task-lifecycle.yaml"),
            tasks,
        )
        self.assertTrue(any("active tasks" in error and "exceed maximum" in error for error in audit.errors))

    def test_idle_terminal_task_cannot_keep_authorizing_changes(self) -> None:
        audit = Audit()
        validate_idle_terminal_paths(audit, "TASK-9999", ["service/runtime/NewFeature.java"])
        self.assertTrue(any("without a new active task" in error for error in audit.errors))

    def test_project_state_must_point_to_latest_terminal_and_accepted_tasks(self) -> None:
        tasks = copy.deepcopy(discover_tasks())
        for task in tasks.values():
            task["state"] = "DRAFT"
        tasks["TASK-0002"]["state"] = "ACCEPTED"
        state = load_yaml(ROOT / ".harness/project-state.yaml")
        state["activeTask"] = None
        state["activeTaskCard"] = None
        state["lastAcceptedTask"] = "TASK-0001"
        state["lastAcceptedHandoff"] = "docs/handoffs/TASK-0001.json"
        state["lastTerminalTask"] = "TASK-0001"
        state["lastTerminalHandoff"] = "docs/handoffs/TASK-0001.json"
        audit = Audit()
        validate_project_state(
            audit,
            state,
            load_yaml(ROOT / ".harness/task-lifecycle.yaml"),
            tasks,
        )
        messages = "\n".join(audit.errors)
        self.assertIn("must point to latest accepted task 'TASK-0002'", messages)
        self.assertIn("must point to latest terminal task 'TASK-0002'", messages)

    def test_handoff_pointers_must_match_project_state_task_ids(self) -> None:
        state = load_yaml(ROOT / ".harness/project-state.yaml")
        state["lastAcceptedHandoff"] = "README.md"
        state["lastTerminalHandoff"] = "README.md"
        audit = Audit()
        validate_project_state(
            audit,
            state,
            load_yaml(ROOT / ".harness/task-lifecycle.yaml"),
            discover_tasks(),
        )
        self.assertTrue(any("lastAcceptedHandoff must match" in error for error in audit.errors))
        self.assertTrue(any("lastTerminalHandoff must match" in error for error in audit.errors))

    def test_product_scope_forbids_opening_real_payment_gate(self) -> None:
        state = load_yaml(ROOT / ".harness/project-state.yaml")
        state["capabilityGates"]["realPayment"]["state"] = "OPEN"
        state["capabilityGates"]["realUserBeta"]["state"] = "INVALID"
        state["capabilityGates"]["businessImplementation"]["reason"] = "   "
        audit = Audit()
        validate_project_state(
            audit,
            state,
            load_yaml(ROOT / ".harness/task-lifecycle.yaml"),
            discover_tasks(),
        )
        messages = "\n".join(audit.errors)
        self.assertIn("realPayment must remain FORBIDDEN", messages)
        self.assertIn("gate realUserBeta has invalid state", messages)
        self.assertIn("gate businessImplementation.reason: must be a non-blank string", messages)


class EnforcementTests(unittest.TestCase):
    def test_execution_rejected_requires_ledger_evidence_and_handoff(self) -> None:
        tasks = copy.deepcopy(discover_tasks())
        lifecycle = load_yaml(ROOT / ".harness/task-lifecycle.yaml")
        state = copy.deepcopy(load_yaml(ROOT / ".harness/project-state.yaml"))
        tasks["TASK-0037"]["state"] = "REJECTED"
        tasks["TASK-0037"]["resolutionReason"] = (
            "执行态任务失败关闭，必须保留 Ledger、Evidence 与 Handoff。"
        )

        ledger = load_yaml(ROOT / ".harness/task-ledger.yaml")
        ledger_entries = copy.deepcopy(ledger["tasks"])
        ledger_entries.pop("TASK-0037", None)
        ledger_audit = Audit()
        validate_task_ledger_entries(
            ledger_audit,
            ledger_entries,
            tasks,
            set(lifecycle["terminalStates"]),
        )
        self.assertTrue(
            any(
                "terminal task TASK-0037 is not registered" in error
                for error in ledger_audit.errors
            ),
            ledger_audit.errors,
        )

        state["activeTask"] = None
        state["activeTaskCard"] = None
        state["lastTerminalTask"] = "TASK-0037"
        state["lastTerminalHandoff"] = "docs/handoffs/TASK-0037.json"
        state["nextAction"] = "将 TASK-0038 晋级为唯一 DRAFT"
        missing_paths = {
            str(ROOT / "docs/handoffs/TASK-0037.json"),
            str(ROOT / "docs/evidence/TASK-0037/evidence-pack.json"),
        }

        def path_is_file(path: Path) -> bool:
            return str(path) not in missing_paths

        state_audit = Audit()
        with patch.object(
            doctor,
            "derive_latest_task_in_states",
            side_effect=["TASK-0012", "TASK-0037"],
        ), patch.object(
            doctor,
            "current_path_is_file",
            side_effect=path_is_file,
        ):
            validate_project_state(
                state_audit,
                state,
                lifecycle,
                tasks,
            )
        messages = "\n".join(state_audit.errors)
        self.assertIn("TASK-0037: terminal task is missing handoff", messages)
        self.assertIn("TASK-0037: terminal task is missing evidence pack", messages)

    def test_draft_base_cannot_launder_post_terminal_changes(self) -> None:
        audit = Audit()
        validate_draft_base_anchor(
            audit,
            "TASK-9999",
            "b" * 40,
            "a" * 40,
        )
        self.assertTrue(any("must equal the last terminal boundary" in error for error in audit.errors))

    def test_task_ledger_history_rejects_delete_then_restore(self) -> None:
        entry = {
            "state": "ACCEPTED",
            "contractVersion": 1,
            "taskCard": "docs/tasks/TASK-0001-project-bootstrap.md",
            "evidence": "docs/evidence/TASK-0001/evidence-pack.json",
            "handoff": "docs/handoffs/TASK-0001.json",
        }
        audit = Audit()
        validate_ledger_history(
            audit,
            {"TASK-0001": entry},
            [
                ("a" * 40, {"TASK-0001": entry}),
                ("b" * 40, {}),
                ("c" * 40, {"TASK-0001": entry}),
            ],
        )
        self.assertTrue(any("removed or rewritten in commit" in error for error in audit.errors))

    def test_task_ledger_parent_edge_must_be_append_only(self) -> None:
        entry = {"state": "ACCEPTED"}
        audit = Audit()
        validate_ledger_edge(
            audit,
            {"TASK-0001": entry},
            {},
            "parent..merge",
        )
        self.assertTrue(any("parent..merge" in error for error in audit.errors))

    def test_terminal_task_must_remain_discoverable_in_ledger(self) -> None:
        tasks = {"TASK-0001": copy.deepcopy(discover_tasks()["TASK-0001"])}
        audit = Audit()
        validate_task_ledger_entries(audit, {}, tasks, {"ACCEPTED", "REJECTED"})
        self.assertTrue(any("terminal task TASK-0001 is not registered" in error for error in audit.errors))

    def test_terminal_state_requires_real_commit_outside_preclosure(self) -> None:
        audit = Audit()
        validate_terminal_commit_requirement(
            audit,
            "TASK-9999",
            is_terminal=True,
            allow_uncommitted_terminal=False,
        )
        self.assertTrue(any("must exist in a real Git commit" in error for error in audit.errors))

        preclosure = Audit()
        validate_terminal_commit_requirement(
            preclosure,
            "TASK-9999",
            is_terminal=True,
            allow_uncommitted_terminal=True,
        )
        self.assertEqual([], preclosure.errors)

    def test_ready_task_cannot_disappear_from_current_tree(self) -> None:
        audit = Audit()
        validate_authorized_task_presence(
            audit,
            {},
            {"TASK-9999": "docs/tasks/TASK-9999.md"},
        )
        self.assertTrue(any("READY task TASK-9999 disappeared" in error for error in audit.errors))

    def test_reviewed_head_must_follow_ready_authorization(self) -> None:
        task = discover_tasks()["TASK-0002"]
        audit = Audit()
        validate_authorization_precedes_head(audit, task, str(task["baseCommit"]))
        self.assertTrue(any("must descend from authorizationCommit" in error for error in audit.errors))

    def test_enabled_beta_roster_requires_open_project_gate(self) -> None:
        product = load_yaml(ROOT / "specs/catalog/product-scope.yaml")
        roster = load_yaml(ROOT / "ops/beta-duty-roster.yaml")
        now = datetime.now(ZoneInfo(product["betaGate"]["timezone"]))
        roster["beta_generation_enabled"] = True
        roster["date"] = now.date().isoformat()
        for role in ("primary", "backup", "handoffReceiver"):
            roster[role] = {
                "name": f"{role}-owner",
                "contactSecretRef": f"secret://beta/{role}",
                "confirmedAt": now.isoformat(),
            }
        roster["complaintAndAppeal"] = {
            "ownerName": "appeal-owner",
            "contactSecretRef": "secret://beta/appeal",
        }
        with tempfile.TemporaryDirectory() as directory:
            temp = Path(directory)
            roster_path = temp / "roster.yaml"
            product_path = temp / "product.yaml"
            state_path = temp / "state.yaml"
            roster_path.write_text(
                yaml.safe_dump(roster, allow_unicode=True),
                encoding="utf-8",
            )
            product_path.write_text(
                yaml.safe_dump(product, allow_unicode=True),
                encoding="utf-8",
            )
            with (
                patch.object(check_beta_gate, "ROSTER", roster_path),
                patch.object(check_beta_gate, "PRODUCT_SCOPE", product_path),
                patch.object(check_beta_gate, "PROJECT_STATE", state_path),
                redirect_stdout(io.StringIO()),
                redirect_stderr(io.StringIO()),
            ):
                state_path.write_text(
                    "schemaVersion: 1\ncapabilityGates:\n  realUserBeta:\n    state: OPEN\n",
                    encoding="utf-8",
                )
                self.assertEqual(0, check_beta_gate.main())
                stale = copy.deepcopy(roster)
                stale["primary"]["confirmedAt"] = "2000-01-01T20:00:00+08:00"
                roster_path.write_text(
                    yaml.safe_dump(stale, allow_unicode=True),
                    encoding="utf-8",
                )
                self.assertEqual(1, check_beta_gate.main())
                roster_path.write_text(
                    yaml.safe_dump(roster, allow_unicode=True),
                    encoding="utf-8",
                )
                duplicate_backup = copy.deepcopy(roster)
                duplicate_backup["backup"]["contactSecretRef"] = "SECRET://beta/primary"
                roster_path.write_text(
                    yaml.safe_dump(duplicate_backup, allow_unicode=True),
                    encoding="utf-8",
                )
                self.assertEqual(1, check_beta_gate.main())
                duplicate_person = copy.deepcopy(roster)
                duplicate_person["backup"]["name"] = " PRIMARY-OWNER "
                roster_path.write_text(
                    yaml.safe_dump(duplicate_person, allow_unicode=True),
                    encoding="utf-8",
                )
                self.assertEqual(1, check_beta_gate.main())
                unknown_schema = copy.deepcopy(roster)
                unknown_schema["schemaVersion"] = 999
                roster_path.write_text(
                    yaml.safe_dump(unknown_schema, allow_unicode=True),
                    encoding="utf-8",
                )
                self.assertEqual(1, check_beta_gate.main())
                roster_path.write_text(
                    "schemaVersion: 1\nschemaVersion: 1\nbeta_generation_enabled: false\n",
                    encoding="utf-8",
                )
                self.assertEqual(1, check_beta_gate.main())
                roster_path.write_text(
                    yaml.safe_dump(roster, allow_unicode=True),
                    encoding="utf-8",
                )
                state_path.write_text(
                    "schemaVersion: 1\ncapabilityGates:\n  realUserBeta:\n    state: BLOCKED\n",
                    encoding="utf-8",
                )
                self.assertEqual(1, check_beta_gate.main())

    def test_canonical_precheck_commands_cannot_be_removed_or_replaced(self) -> None:
        config = copy.deepcopy(load_yaml(ROOT / ".harness/commands.yaml"))
        config["profiles"]["precheck"].remove("betaRosterGate")
        config["commands"]["paidFeatureCheck"]["argv"] = ["scripts/harness/doctor.py"]
        audit = Audit()
        validate_command_registry(audit, config)
        messages = "\n".join(audit.errors)
        self.assertIn("cannot remove canonical checks", messages)
        self.assertIn("paidFeatureCheck argv cannot be replaced", messages)

    def test_beta_contact_and_confirmation_placeholders_cannot_open_gate(self) -> None:
        for value in (
            "x",
            "TBD",
            "https://example.com/contact",
            "tel://123456",
            "sms:+8613800138000",
            "file:///tmp/contact.txt",
            "javascript:alert123",
            "urn:contact:primary",
            "secret://TBD",
            "vault://REQUIRED",
            "op://TODO",
            "secret://beta/%54%42%44",
            "secret://beta/TBD-primary",
            "secret://beta/required-contact",
            "vault://admin:SuperSecret@vault.local/path",
            "secret://beta/primary/",
            "secret://beta//primary",
        ):
            self.assertFalse(is_secret_reference(value), value)
        self.assertTrue(is_secret_reference("secret://beta/primary-contact"))
        self.assertEqual(
            "secret://beta/primary-contact",
            canonical_secret_reference("SECRET://beta/primary-contact"),
        )
        self.assertIsNone(canonical_secret_reference("secret://beta/%70rimary-contact"))
        self.assertIsNone(canonical_secret_reference("secret://beta/%2554%2542%2544"))
        self.assertIsNone(parse_aware_timestamp("x"))
        self.assertIsNone(parse_aware_timestamp("2026-07-30T20:00:00"))
        self.assertIsNotNone(parse_aware_timestamp("2026-07-30T20:00:00+08:00"))

    def test_base_protected_rules_survive_current_rule_deletion(self) -> None:
        task = copy.deepcopy(discover_tasks()["TASK-0002"])
        task.update(
            {
                "riskClass": "C1",
                "requiredSkills": [],
                "writeAllowlist": [".harness/**"],
                "forbiddenPaths": [],
                "humanApprovals": [],
                "independentReview": False,
            }
        )
        audit = Audit()
        rules = effective_protected_rules(audit, task, current_rules=[])
        self.assertTrue(
            any(rule.get("glob") == ".harness/**" and rule.get("riskClass") == "C4" for rule in rules)
        )
        validate_diff_scope(
            audit,
            task,
            {"harness-change": {"id": "harness-change"}},
            rules,
            changed_override=[".harness/protected-paths.yaml"],
        )
        messages = "\n".join(audit.errors)
        self.assertIn("requires riskClass C4", messages)
        self.assertIn("requires registered Skill harness-change", messages)
        self.assertIn("requires recorded human approval", messages)

    def test_lifecycle_project_state_update_uses_c2_task_intake_policy(self) -> None:
        head = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=ROOT,
            text=True,
            stdout=subprocess.PIPE,
            check=True,
        ).stdout.strip()
        task = {
            "taskId": "TASK-9999",
            "state": "IN_PROGRESS",
            "riskClass": "C2",
            "requiredSkills": ["task-intake"],
            "baseCommit": head,
            "writeAllowlist": [".harness/project-state.yaml"],
            "forbiddenPaths": [],
            "humanApprovals": [],
            "independentReview": False,
            "reviewers": [],
        }
        rules = load_yaml(ROOT / ".harness/protected-paths.yaml")["paths"]
        audit = Audit()
        validate_diff_scope(
            audit,
            task,
            {"task-intake": {"id": "task-intake"}},
            rules,
            changed_override=[".harness/project-state.yaml"],
        )
        messages = "\n".join(audit.errors)
        self.assertNotIn("requires riskClass C4", messages)
        self.assertNotIn("requires registered Skill harness-change", messages)

    def test_reviewer_evidence_is_confined_to_task_evidence_directory(self) -> None:
        self.assertTrue(
            is_review_evidence_path("TASK-0002", "docs/evidence/TASK-0002/review-safety.md")
        )
        for path in (
            ".git/fake-review.md",
            "docs/evidence/TASK-0001/review.md",
            "docs/evidence/TASK-0002/evidence-pack.json",
        ):
            self.assertFalse(is_review_evidence_path("TASK-0002", path), path)

    def test_terminal_audit_artifacts_cannot_be_rewritten_by_future_tasks(self) -> None:
        audit = Audit()
        validate_frozen_artifact_bytes(
            audit,
            "TASK-0002: evidence",
            b'{"reviewers":["rewritten"]}',
            b'{"reviewers":["original"]}',
        )
        self.assertTrue(any("terminal audit artifact is immutable" in error for error in audit.errors))

    def test_skill_auxiliary_paths_are_attributed_to_target_skill_ids(self) -> None:
        skill_ids, invalid = changed_skill_tree_ids(
            [
                "skills/safety-change/scripts/check.py",
                "skills/new-skill/SKILL.md",
                "skills/README.md",
                "README.md",
            ]
        )
        self.assertEqual({"safety-change", "new-skill"}, skill_ids)
        self.assertEqual(["skills/README.md"], invalid)

    def test_beta_roster_timezone_must_match_product_source(self) -> None:
        beta = load_yaml(ROOT / "specs/catalog/product-scope.yaml")["betaGate"]
        roster = load_yaml(ROOT / "ops/beta-duty-roster.yaml")
        roster["timezone"] = "UTC"
        self.assertIn("timezone must match", projection_error(roster, beta) or "")

    def test_json_schema_rejects_missing_and_invalid_nested_values(self) -> None:
        schema = {
            "type": "object",
            "required": ["checks"],
            "properties": {
                "checks": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "required": ["status"],
                        "properties": {"status": {"enum": ["PASS", "FAIL"]}},
                    },
                }
            },
        }
        audit = Audit()
        validate_json_schema(audit, {"checks": [{}, {"status": "UNKNOWN"}]}, schema, "fixture")
        self.assertTrue(any("missing required property status" in error for error in audit.errors))
        self.assertTrue(any("is not in enum" in error for error in audit.errors))

    def test_evidence_artifact_hash_or_reason_cannot_be_blank(self) -> None:
        schema = json.loads(
            (ROOT / "docs/schemas/evidence-pack.schema.json").read_text(encoding="utf-8")
        )
        audit = Audit()
        validate_json_schema(
            audit,
            {
                "taskId": "TASK-9999",
                "baseCommit": "0" * 40,
                "headCommit": "1" * 40,
                "contextFingerprint": "2" * 64,
                "checks": [
                    {
                        "command": "test",
                        "status": "PASS",
                        "exitCode": 0,
                        "artifactHash": "",
                        "reason": None,
                    }
                ],
            },
            schema,
            "fixture",
        )
        self.assertTrue(any("pattern mismatch" in error for error in audit.errors), audit.errors)
        semantic = Audit()
        validate_check_artifact(semantic, "fixture", None, "   ")
        self.assertTrue(any("non-blank" in error for error in semantic.errors), semantic.errors)

        not_run = Audit()
        validate_evidence_check(
            not_run,
            "fixture",
            {
                "status": "NOT_RUN",
                "exitCode": None,
                "artifactHash": "a" * 40,
                "reason": "   ",
            },
        )
        messages = "\n".join(not_run.errors)
        self.assertIn("NOT_RUN reason: must be a non-blank", messages)
        self.assertIn("NOT_RUN must not claim an artifactHash", messages)

    def test_handoff_next_action_cannot_be_empty_or_blank(self) -> None:
        schema = json.loads(
            (ROOT / "docs/schemas/handoff.schema.json").read_text(encoding="utf-8")
        )
        fixture = {
            "taskId": "TASK-9999",
            "state": "ACCEPTED",
            "baseCommit": "0" * 40,
            "headCommit": "1" * 40,
            "evidencePath": "docs/evidence/TASK-9999/evidence-pack.json",
            "completed": [],
            "remaining": [],
            "knownRisks": [],
            "nextAction": "",
        }
        schema_audit = Audit()
        validate_json_schema(schema_audit, fixture, schema, "fixture")
        self.assertTrue(any("string is too short" in error for error in schema_audit.errors))
        semantic = Audit()
        validate_nonblank_text(semantic, "fixture.nextAction", "   ")
        self.assertTrue(any("non-blank string" in error for error in semantic.errors))

    def test_required_commands_must_be_present_and_pass_for_acceptance(self) -> None:
        task = {"taskId": "TASK-9999", "requiredCommands": ["required command"]}
        missing = Audit()
        validate_required_command_coverage(missing, task, {}, require_pass=True)
        self.assertTrue(any("missing from Evidence" in error for error in missing.errors))

        not_run = Audit()
        validate_required_command_coverage(
            not_run,
            task,
            {
                "required command": [
                    {"command": "required command", "status": "NOT_RUN", "exitCode": None}
                ]
            },
            require_pass=True,
        )
        self.assertTrue(any("did not PASS" in error for error in not_run.errors))

        mixed = Audit()
        validate_required_command_coverage(
            mixed,
            task,
            {
                "required command": [
                    {"command": "required command", "status": "PASS", "exitCode": 0},
                    {"command": "required command", "status": "FAIL", "exitCode": 1},
                ]
            },
            require_pass=True,
        )
        self.assertTrue(any("exactly one final Evidence result" in error for error in mixed.errors))

    def test_diff_scope_rejects_scope_skill_risk_approval_and_review_bypasses(self) -> None:
        task = {
            "taskId": "TASK-9999",
            "state": "ACCEPTED",
            "riskClass": "C2",
            "requiredSkills": [],
            "writeAllowlist": ["docs/**"],
            "forbiddenPaths": ["protected/**"],
            "humanApprovals": [],
            "independentReview": False,
            "reviewers": [],
        }
        rules = [
            {
                "glob": "protected/**",
                "riskClass": "C4",
                "requiredSkill": "harness-change",
                "humanApproval": True,
                "independentReview": True,
            }
        ]
        audit = Audit()
        validate_diff_scope(
            audit,
            task,
            {"harness-change": {"id": "harness-change"}},
            rules,
            changed_override=["protected/config.yaml"],
        )
        messages = "\n".join(audit.errors)
        for expected in (
            "outside writeAllowlist",
            "is forbidden",
            "requires riskClass C4",
            "requires registered Skill harness-change",
            "requires recorded human approval",
            "requires independentReview",
        ):
            self.assertIn(expected, messages)

    def test_project_state_protected_fields_require_full_harness_approval(self) -> None:
        task = copy.deepcopy(discover_tasks()["TASK-0002"])
        task["humanApprovals"] = []
        audit = Audit()
        validate_project_state_mutation_policy(audit, task, target_commit=None)
        self.assertTrue(any("cannot establish project-state baseline" in error for error in audit.errors))

    def test_terminal_high_risk_task_requires_structured_reviewer(self) -> None:
        task = {
            "taskId": "TASK-9999",
            "state": "ACCEPTED",
            "riskClass": "C4",
            "requiredSkills": [],
            "writeAllowlist": ["README.md"],
            "forbiddenPaths": [],
            "humanApprovals": [],
            "independentReview": True,
            "reviewers": [],
        }
        audit = Audit()
        validate_diff_scope(audit, task, {}, [], changed_override=["README.md"])
        self.assertTrue(any("structured independent reviewers" in error for error in audit.errors))

    def test_reviewer_identity_fields_must_be_canonical(self) -> None:
        audit = Audit()
        reviewer_id = validate_reviewer_identity_fields(
            audit,
            "reviewer",
            {"id": " Repository-Owner ", "kind": " "},
        )
        self.assertIsNone(reviewer_id)
        self.assertTrue(any(".id must be a canonical" in error for error in audit.errors))
        self.assertTrue(any(".kind must be a canonical" in error for error in audit.errors))

    def test_task_sources_and_invariant_ids_must_resolve(self) -> None:
        task = copy.deepcopy(discover_tasks()["TASK-0002"])
        task["sourcesOfTruth"] = ["C:/outside.yaml", "docs/does-not-exist.yaml"]
        task["requiredInvariants"] = ["INV-DOES-NOT-EXIST"]
        audit = Audit()
        validate_sources(audit, {"TASK-0002": task})
        messages = "\n".join(audit.errors)
        self.assertIn("source of truth must be relative", messages)
        self.assertIn("source of truth does not exist", messages)
        self.assertIn("unknown required invariant", messages)

    def test_skill_changes_must_exactly_match_authorized_targets(self) -> None:
        task = copy.deepcopy(discover_tasks()["TASK-0002"])
        task["state"] = "IN_REVIEW"
        task["targetSkillVersions"].pop("catalog-change")
        audit = Audit()
        validate_skills(audit, {"TASK-0002": task})
        self.assertTrue(
            any("must exactly match targetSkillVersions" in error for error in audit.errors),
            audit.errors,
        )

    def test_changed_existing_skill_must_increase_semantic_version(self) -> None:
        task = copy.deepcopy(discover_tasks()["TASK-0002"])
        task["state"] = "IN_REVIEW"
        task["targetSkillVersions"]["harness-change"] = "1.0.0"
        audit = Audit()
        validate_skills(audit, {"TASK-0002": task})
        self.assertTrue(
            any("target version must increase" in error for error in audit.errors),
            audit.errors,
        )


class DeterminismTests(unittest.TestCase):
    def test_catalog_generation_is_lf_only(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "generated"
            catalog_tool.generate(ROOT, output)
            generated = [path for path in output.rglob("*") if path.is_file()]
            self.assertTrue(generated)
            for path in generated:
                self.assertNotIn(b"\r\n", path.read_bytes(), path.as_posix())

    def test_paid_feature_discovery_prunes_dependencies_and_build_outputs(self) -> None:
        files = discover_files(ROOT)
        relative = [path.relative_to(ROOT).as_posix() for path in files]
        self.assertIn("frontend/package.json", relative)
        self.assertIn("requirements-harness.txt", relative)
        for path in files:
            self.assertFalse(any(part in PRUNED_DIRS for part in path.relative_to(ROOT).parts), path)


class CiWorkflowTests(unittest.TestCase):
    def test_harness_matrix_preserves_checks_and_uses_per_os_timeout_budgets(self) -> None:
        workflow = load_yaml(ROOT / ".github/workflows/ci.yml")
        harness = workflow["jobs"]["harness"]

        self.assertFalse(harness["strategy"]["fail-fast"])
        self.assertEqual("${{ matrix.os }}", harness["runs-on"])
        self.assertEqual("${{ matrix.timeoutMinutes }}", harness["timeout-minutes"])
        self.assertEqual(
            [
                {"os": "ubuntu-latest", "timeoutMinutes": 10},
                {"os": "windows-latest", "timeoutMinutes": 20},
                {"os": "macos-latest", "timeoutMinutes": 10},
            ],
            harness["strategy"]["matrix"]["include"],
        )
        self.assertEqual(
            [
                "Checkout",
                "Set up Python",
                "Install harness dependencies",
                "Test Harness failure and portability rules",
                "Run canonical Harness precheck (Windows wrapper)",
                "Run canonical Harness precheck (POSIX wrapper)",
            ],
            [step["name"] for step in harness["steps"]],
        )


class ValidationFlowTests(unittest.TestCase):
    def test_no_active_task_skips_terminal_introduction_recomputation(self) -> None:
        audit = Audit()
        with patch.object(
            doctor,
            "ledger_introduction_commits_for_task",
            side_effect=AssertionError("ledger history should not be recomputed"),
        ):
            validate_active_task_base_freshness(
                audit,
                {"TASK-0001": {"state": "ACCEPTED"}},
                {"activeStates": ["READY", "IN_PROGRESS", "IN_REVIEW"]},
            )
        self.assertEqual([], audit.errors)

    def test_task_template_uses_one_canonical_precheck_without_duplicate_doctor(self) -> None:
        template = (ROOT / "docs/tasks/task-card-template.md").read_text(encoding="utf-8")
        metadata_blocks = [
            strict_yaml_load(match.group(1))
            for match in TASK_BLOCK_RE.finditer(template)
        ]
        metadata = next(
            block
            for block in metadata_blocks
            if isinstance(block, dict) and "requiredCommands" in block
        )
        commands = metadata["requiredCommands"]

        self.assertEqual(
            [
                "python scripts/harness/precheck.py --task TASK-XXXX",
                "git diff --check",
            ],
            commands,
        )
        self.assertFalse(any("doctor.py" in command for command in commands))
        self.assertEqual(1, sum("precheck.py" in command for command in commands))

    def test_precheck_profile_keeps_each_canonical_gate_exactly_once(self) -> None:
        config = load_yaml(ROOT / ".harness/commands.yaml")
        self.assertEqual(
            [
                "doctor",
                "catalogValidate",
                "catalogDrift",
                "paidFeatureCheck",
                "betaRosterGate",
            ],
            config["profiles"]["precheck"],
        )
        self.assertEqual(
            len(config["profiles"]["precheck"]),
            len(set(config["profiles"]["precheck"])),
        )

    def test_precheck_reports_command_exit_and_elapsed_time(self) -> None:
        config = {
            "commands": {
                "fixture": {
                    "description": "fixture command",
                    "argv": ["scripts/harness/doctor.py"],
                }
            },
            "profiles": {"precheck": ["fixture"]},
        }
        completed = subprocess.CompletedProcess(
            args=["fixture"],
            returncode=0,
        )
        output = io.StringIO()
        with (
            patch.object(precheck, "load_yaml", return_value=config),
            patch.object(precheck.subprocess, "run", return_value=completed),
            patch.object(sys, "argv", ["precheck.py"]),
            redirect_stdout(output),
        ):
            self.assertEqual(0, precheck.main())

        self.assertIn("fixture: PASS (exit=0, elapsed=", output.getvalue())

    def test_precheck_reports_failure_exit_and_elapsed_time(self) -> None:
        config = {
            "commands": {
                "fixture": {
                    "description": "fixture command",
                    "argv": ["scripts/harness/doctor.py"],
                }
            },
            "profiles": {"precheck": ["fixture"]},
        }
        completed = subprocess.CompletedProcess(
            args=["fixture"],
            returncode=7,
        )
        output = io.StringIO()
        errors = io.StringIO()
        with (
            patch.object(precheck, "load_yaml", return_value=config),
            patch.object(precheck.subprocess, "run", return_value=completed),
            patch.object(sys, "argv", ["precheck.py"]),
            redirect_stdout(output),
            redirect_stderr(errors),
        ):
            self.assertEqual(1, precheck.main())

        self.assertIn("fixture: FAIL (exit=7, elapsed=", output.getvalue())
        self.assertIn("FAIL: fixture exited 7", errors.getvalue())

    def test_agent_rules_define_snapshot_reuse_and_low_frequency_polling(self) -> None:
        instructions = (ROOT / "AGENTS.md").read_text(encoding="utf-8")
        policy = load_yaml(ROOT / ".harness/task-delivery-policy.yaml")
        skill = (ROOT / "skills/task-delivery-flow/SKILL.md").read_text(
            encoding="utf-8"
        )
        self.assertIn(".harness/task-delivery-policy.yaml", instructions)
        self.assertIn("skills/task-delivery-flow/SKILL.md", instructions)
        self.assertNotIn("targetWallMinutes", instructions)
        self.assertNotIn("candidateDeadlineMinutes", instructions)
        self.assertEqual(
            [
                "HEAD_SHA",
                "INDEX_TREE",
                "WORKTREE",
                "UNTRACKED_CANDIDATE",
                "EXACT_COMMAND",
                "OPERATING_SYSTEM",
                "INTERPRETER",
                "TOOLCHAIN",
                "DEPENDENCIES",
                "ENVIRONMENT",
                "GIT_CONFIG",
                "EXTERNAL_SERVICES",
                "DATA_STATE",
                "TASK_AUTHORIZATION",
                "CONTEXT",
                "COMMAND_REGISTRY",
            ],
            policy["candidateIdentity"]["requiredInputs"],
        )
        self.assertEqual(
            "LOW_FREQUENCY_STATUS_ONLY",
            policy["validation"]["longRunningCommand"]["polling"],
        )
        self.assertEqual(
            [
                "python",
                "scripts/harness/precheck.py",
                "--task",
                "TASK-ID",
            ],
            policy["validation"]["ordinaryCard"]["canonicalPythonArgv"],
        )
        self.assertFalse(
            policy["validation"]["ordinaryCard"]["wrapperEvidenceAlias"]
        )
        self.assertEqual(
            60,
            policy["validation"]["longRunningCommand"][
                "defaultPollingIntervalSeconds"
            ],
        )
        self.assertTrue(
            policy["validation"]["longRunningCommand"]["statusObservationOnly"]
        )
        self.assertTrue(
            policy["validation"]["longRunningCommand"][
                "parallelStatusCommandForbidden"
            ]
        )
        self.assertTrue(
            policy["validation"]["longRunningCommand"][
                "parallelProcessInspectionCommandForbidden"
            ]
        )
        self.assertTrue(
            policy["validation"]["longRunningCommand"]["repeatedLogFetchForbidden"]
        )
        self.assertTrue(
            policy["validation"]["longRunningCommand"]["duplicateExecutionForbidden"]
        )
        self.assertTrue(
            policy["candidateIdentity"]["reuseRequiresAllInputsUnchanged"]
        )
        self.assertTrue(
            policy["candidateIdentity"]["reusedPassStatusForbidden"]
        )
        self.assertEqual("PASS", policy["candidateIdentity"]["acceptedResult"])
        self.assertEqual(
            ["FAIL", "CANCELLED", "TIMEOUT", "NOT_RUN"],
            policy["candidateIdentity"]["nonPassResults"],
        )
        self.assertEqual(
            [
                "ACCEPTED",
                "PUSHED",
                "HANDOFF_COMPLETE",
                "REMOTE_REVERIFIED",
                "EXACT_SHA_CI_REVERIFIED",
            ],
            policy["modes"]["longline"]["nextCardRequires"],
        )
        self.assertTrue(
            policy["modes"]["longline"]["blockedCardBehavior"][
                "blocksDependencyDescendantsOnly"
            ]
        )
        self.assertIn("only one long command process", skill)
        self.assertIn("about every 60", skill)
        self.assertIn("parallel `status` or `ps` commands", skill)
        self.assertIn("polling observes status only", skill)
        self.assertIn("never invent a `REUSED` PASS", skill)
        self.assertIn(
            "A wrapper is never an Evidence, receipt,\n   or PASS alias.",
            skill,
        )
        self.assertNotIn("unless its exact argv was frozen", skill)
        self.assertIn("Unknown or changed identity", skill)

    def test_task_template_requires_exact_precheck_argv_evidence(self) -> None:
        template = (ROOT / "docs/tasks/task-card-template.md").read_text(
            encoding="utf-8"
        )
        self.assertIn("冻结的精确 canonical Precheck 命令", template)
        self.assertIn("包装器不是该 Python 命令的 Evidence 别名", template)
        self.assertIn("同一条 `git diff --check` 只执行一次", template)


class IntegrationTests(unittest.TestCase):
    @unittest.skipIf(os.name == "nt", "POSIX fake-PATH behavior is exercised on Linux/macOS CI")
    def test_posix_wrapper_falls_back_from_old_python3(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            binary_dir = Path(directory)
            python3 = binary_dir / "python3"
            python = binary_dir / "python"
            python3.write_text("#!/bin/sh\nexit 2\n", encoding="utf-8")
            python.write_text(
                "#!/bin/sh\n"
                "if [ \"$1\" = \"-c\" ]; then exit 0; fi\n"
                "printf 'selected-python\\n'\n",
                encoding="utf-8",
            )
            python3.chmod(0o755)
            python.chmod(0o755)
            result = subprocess.run(
                ["/bin/sh", "scripts/harness/precheck.sh", "--list"],
                cwd=ROOT,
                env={**os.environ, "PATH": str(binary_dir)},
                text=True,
                encoding="utf-8",
                errors="replace",
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                check=False,
            )
            self.assertEqual(0, result.returncode, result.stdout)
            self.assertIn("selected-python", result.stdout)

    def test_command_registry_is_consumed_without_shell_commands(self) -> None:
        config = load_yaml(ROOT / ".harness/commands.yaml")
        self.assertEqual("scripts/harness/precheck.py", config["runner"])
        for command in config["commands"].values():
            self.assertIsInstance(command["argv"], list)
            self.assertTrue(command["argv"][0].endswith(".py"))

    def test_doctor_accepts_current_task(self) -> None:
        result = subprocess.run(
            [sys.executable, "scripts/harness/doctor.py"],
            cwd=ROOT,
            text=True,
            encoding="utf-8",
            errors="replace",
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            check=False,
        )
        self.assertEqual(0, result.returncode, result.stdout)
        self.assertIn("Harness doctor: PASS", result.stdout)


if __name__ == "__main__":
    unittest.main()

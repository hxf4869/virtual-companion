from __future__ import annotations

import copy
from contextlib import redirect_stderr, redirect_stdout
from datetime import datetime
import io
import json
import os
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
from check_beta_gate import (  # noqa: E402
    canonical_secret_reference,
    is_secret_reference,
    parse_aware_timestamp,
    projection_error,
)
from check_paid_features import PRUNED_DIRS, discover_files  # noqa: E402
from doctor import (  # noqa: E402
    Audit,
    changed_skill_tree_ids,
    current_regular_file_bytes,
    effective_protected_rules,
    first_existing_zed_instruction_path,
    is_review_evidence_path,
    intervening_terminal_boundaries,
    project_state_closure_projection,
    project_state_ready_projection,
    repository_index_paths,
    task_authorization_projection,
    unique_json_object,
    validate_diff_scope,
    validate_draft_base_anchor,
    validate_authorization_precedes_head,
    validate_authorized_task_history,
    validate_authorized_task_presence,
    validate_active_task_base_freshness,
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
    validate_project_state,
    validate_project_state_mutation_policy,
    validate_required_command_coverage,
    validate_ready_context_lock_bytes,
    validate_ready_parent_projection,
    validate_reviewer_identity_fields,
    validate_skills,
    validate_sources,
    validate_tasks,
    validate_task_authorization_history,
    validate_task_ledger_entries,
    validate_terminal_commit_requirement,
    validate_terminal_history_dominance,
)
from harness_common import (  # noqa: E402
    discover_tasks,
    glob_matches,
    is_repository_relative,
    load_yaml,
    normalize_repo_path,
    strict_yaml_load,
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
        tasks["TASK-0002"] = task
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
        audit = Audit()
        validate_tasks(audit, tasks, load_yaml(ROOT / ".harness/task-lifecycle.yaml"))
        self.assertTrue(any("riskClass must be one of" in error for error in audit.errors), audit.errors)


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

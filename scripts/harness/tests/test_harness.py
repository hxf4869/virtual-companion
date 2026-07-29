from __future__ import annotations

import copy
from contextlib import redirect_stderr, redirect_stdout
from datetime import datetime
import io
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
from check_beta_gate import (  # noqa: E402
    is_secret_reference,
    parse_aware_timestamp,
    projection_error,
)
from check_paid_features import PRUNED_DIRS, discover_files  # noqa: E402
from doctor import (  # noqa: E402
    Audit,
    changed_skill_tree_ids,
    effective_protected_rules,
    is_review_evidence_path,
    project_state_closure_projection,
    task_authorization_projection,
    validate_diff_scope,
    validate_authorization_precedes_head,
    validate_frozen_artifact_bytes,
    validate_command_registry,
    validate_idle_terminal_paths,
    validate_json_schema,
    validate_project_state,
    validate_required_command_coverage,
    validate_skills,
    validate_sources,
    validate_tasks,
)
from harness_common import (  # noqa: E402
    discover_tasks,
    glob_matches,
    is_repository_relative,
    load_yaml,
    normalize_repo_path,
    verify_context_lock,
)


class PathPolicyTests(unittest.TestCase):
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


class ContextTests(unittest.TestCase):
    def test_task_discovery_excludes_template(self) -> None:
        tasks = discover_tasks()
        self.assertTrue({"TASK-0001", "TASK-0002"} <= set(tasks))
        self.assertNotIn("TASK-XXXX", tasks)

    def test_all_context_locks_are_reproducible(self) -> None:
        for task in discover_tasks().values():
            self.assertEqual([], verify_context_lock(task), task["taskId"])

    def test_context_fingerprint_tampering_is_rejected(self) -> None:
        task = dict(discover_tasks()["TASK-0002"])
        task["contextFingerprint"] = "0" * 64
        errors = verify_context_lock(task)
        self.assertTrue(any("disagree on contextFingerprint" in error for error in errors), errors)

    def test_ready_authorization_fields_cannot_be_widened(self) -> None:
        tasks = discover_tasks()
        tasks["TASK-0002"] = dict(tasks["TASK-0002"], owner="tampered-owner")
        audit = Audit()
        validate_tasks(audit, tasks, load_yaml(ROOT / ".harness/task-lifecycle.yaml"))
        self.assertTrue(
            any("authorized field changed after READY checkpoint: owner" in error for error in audit.errors),
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

    def test_multiple_active_tasks_are_rejected(self) -> None:
        tasks = copy.deepcopy(discover_tasks())
        tasks["TASK-0001"]["state"] = "IN_PROGRESS"
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
        tasks["TASK-0001"]["state"] = "DRAFT"
        tasks["TASK-0002"]["state"] = "ACCEPTED"
        state = load_yaml(ROOT / ".harness/project-state.yaml")
        state["activeTask"] = None
        state["activeTaskCard"] = None
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


class EnforcementTests(unittest.TestCase):
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
                    "capabilityGates:\n  realUserBeta:\n    state: OPEN\n",
                    encoding="utf-8",
                )
                self.assertEqual(0, check_beta_gate.main())
                state_path.write_text(
                    "capabilityGates:\n  realUserBeta:\n    state: BLOCKED\n",
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
        for value in ("x", "TBD", "https://example.com/contact", "tel://123456"):
            self.assertFalse(is_secret_reference(value), value)
        self.assertTrue(is_secret_reference("secret://beta/primary-contact"))
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

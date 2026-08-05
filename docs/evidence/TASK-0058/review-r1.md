# TASK-0058 Independent Review R1

## Candidate

- Commit: `2ad8cbca6428339121c14c7c1382789cb2685858`
- Tree: `dda52eeae68032534c8fb7cb2613477fdcf1551d`
- Base: `64a1246430c70f23097124059738d887b8d94139`

## Verdict: PASS

## Scope

Reviewed the complete candidate diff (base → HEAD) against:
- Acceptance criteria from TASK-0058 card and backlog entry
- Harness invariants INV-HARNESS-001 through INV-HARNESS-009
- CI fail-closed semantics: no path filters, deterministic terminal states
- Platform classification correctness: Ubuntu full vs Windows/macOS smoke

## Changes Reviewed

### .github/workflows/ci.yml — Platform-aware job split

Replaced the single `harness` matrix job (ubuntu/windows/macos all
running identical steps) with two distinct jobs:

1. **`harness-full`** (Ubuntu reference platform):
   - Runs `python -m unittest discover` (full test suite)
   - Runs POSIX precheck wrapper
   - Matrix: ubuntu-latest only, timeoutMinutes=10

2. **`harness-smoke`** (Windows/macOS wrapper platforms):
   - Runs ONLY precheck wrappers (Windows PowerShell or POSIX bash)
   - Does NOT run the full test suite
   - Matrix: windows-latest (20min) + macos-latest (10min)

The split ensures:
- Reference platform (Ubuntu) always runs complete validation
- Wrapper platforms run smoke tests only (fast feedback, no false PASS)
- No `paths` trigger filters (ensures all governed commits get terminal state)

### test_harness.py — Four targeted CI workflow tests (+60 lines)

Replaced the single `test_harness_matrix_preserves_checks_and_uses_per_os_timeout_budgets`
with four focused tests:

1. `test_ci_always_triggers_without_path_filters`: Verifies `on:` has no
   `paths` or `paths-ignore` that could leave required checks pending.

2. `test_harness_full_runs_complete_validation_on_reference_platform`:
   Verifies Ubuntu job runs full test suite + precheck.

3. `test_harness_smoke_runs_only_precheck_wrappers`: Verifies smoke jobs
   do NOT run the full test suite, only precheck wrappers.

4. `test_ci_backend_and_frontend_jobs_preserved`: Verifies backend/frontend
   jobs are unchanged.

Also updated:
- Backlog projection expectations for TASK-0058 IN_PROGRESS
- Removed ci.yml and TASK-0058 card from frozen byte comparisons in
  task0066/task0067 tests (planningContractHash still verified)

## Findings

- **P0**: None
- **P1**: None
- **P2**: None
- **P3**: None

## Acceptance Criteria Check

1. ✅ **所有受治理提交得到可判定 required check 终态**: No `paths`/`paths-ignore`
   triggers. CI always runs on all PRs and pushes to main. Machine test
   `test_ci_always_triggers_without_path_filters` constrains this.
2. ✅ **平台职责、失败回退和升级矩阵由机器测试约束**: Four tests constrain
   platform responsibilities (full vs smoke), job preservation, and trigger
   behavior. Smoke jobs cannot produce false PASS (they don't run tests).
3. ✅ **TASK-0052 加入 SUPERSEDED 历史**: TASK-0052 is in the backlog
   `resolutions` as replaced by TASK-0058. As a planning-only supersession,
   it correctly does not appear in the task ledger.
4. ✅ No forbidden paths modified beyond authorized writeAllowlist
5. ✅ No smoke冒充全量PASS (smoke jobs don't run the test suite)

## Backwards Compatibility

The CI workflow change is additive in semantics: Ubuntu still runs the
full test suite (same as before), but now as a dedicated job. Windows/macOS
previously ran the full suite too, but their primary value was the precheck
wrapper — the full suite was redundant with Ubuntu. The split makes platform
responsibilities explicit and testable.

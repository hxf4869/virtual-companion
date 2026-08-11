# TASK-0160：P2-03 AuthSourceAdmissionFilterTest 修复（TASK-0156 replacement）

```yaml
taskId: TASK-0160
state: READY
owner: repository-owner
riskClass: C3
requiredSkills:
  - task-delivery-flow
  - task-intake
requiredSkillVersions:
  task-delivery-flow: "1.3.7"
  task-intake: "1.2.7"
targetSkillVersions: {}
baseCommit: 662945a219778caf0829582ce60f16747a278453
authorizationCommit: "8331448340d376457edeb788d48280cc7db8d5a6"
contextFingerprint: 332463bf6cec8bf6116e24eac4ca4e346f1169b322bfcf57116edba11d3a3e24
contextLock: docs/tasks/context/TASK-0160.context-lock.yaml
contextFingerprintAlgorithm: SHA256_ORDINAL_SORTED_PATH_EQUALS_HASH_LF_V1
deliveryMode: single-card
deliveryBudgets:
  schemaVersion: 2
  candidateDeadlineMinutes: 45
  targetWallMinutes: 60
  hardFuseWallMinutes: 90
  maximumFixBatches: 1
  maximumReviewRounds: 2
  r3Forbidden: true
  overallElapsed: {anchor: DRAFT_COMMIT, terminal: TERMINAL_COMMIT, recordingRequired: true, resetOranchorForbidden: true}
  intakeActivation: {anchor: DRAFT_COMMIT, terminal: READY_DOCTOR_TERMINAL, targetWallMinutes: 60, hardFuseWallMinutes: 90, timeoutStatus: TIMEOUT, closureOnlyOverrun: true}
  candidateExecution: {anchor: READY_DOCTOR_PASS_AND_IN_PROGRESS_COMMIT, notStartedOutcome: NOT_STARTED, notStartedEligibility: {readyDoctorNonPassRequired: true, readyDoctorPassForbidden: true, inProgressCommitForbidden: true, candidateFreezeForbidden: true}, candidateDeadlineMinutes: 45, targetWallMinutes: 60, hardFuseWallMinutes: 90, timeoutStatus: TIMEOUT, closureOnlyOverrun: true}
  reviewer: {maximumMinutes: 15, timeoutStatus: TIMEOUT, missingTerminalStatus: UNKNOWN}
complexityAssessment:
  policySource: .harness/task-delivery-policy.yaml
  evaluatedBefore: READY
  riskClass: C3
  surfaceId: TASK_0160_P2_03_AUTH_SOURCE_ADMISSION_TEST_FIX
  policySurfaces: [AUTHORIZATION]
  distinctCrossRiskSurfaces: 1
  reviewerMinutesEstimate: 8
  terminalCheckMinutesEstimate: 25
  estimatedWallMinutes: 50
  thresholdsTriggered: []
  splitRequired: false
  ownerIndivisibleAuthorization: false
validationPlan: {frozenBefore: READY, policySource: .harness/ci-execution-policy.yaml, selectedChannel: LOCAL_EXACT_TREE_FALLBACK, profile: precheck}
requiredCommands:
  - python scripts/harness/precheck.py --task TASK-0160
  - docker run --rm -v "$PWD":/app -v vc-maven-cache:/root/.m2 -w /app maven:3.9-eclipse-temurin-25-alpine ./mvnw --batch-mode --no-transfer-progress verify
  - git diff --check
readAllowlist:
  - AGENTS.md
  - CLAUDE.md
  - .harness/ci-execution-policy.yaml
  - .harness/commands.yaml
  - .harness/invariants.yaml
  - .harness/project-state.yaml
  - .harness/protected-paths.yaml
  - .harness/skills.yaml
  - .harness/sources-of-truth.yaml
  - .harness/task-backlog.yaml
  - .harness/task-delivery-policy.yaml
  - .harness/task-ledger.yaml
  - .harness/task-lifecycle.yaml
  - docs/evidence/TASK-0109/zcode-remediation-handoff.md
  - docs/evidence/TASK-0156/evidence-pack.json
  - docs/evidence/TASK-0156/review-r1.md
  - docs/handoffs/TASK-0156.json
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
  - docs/tasks/TASK-0156-p2-03-auth-rate-limit-and-input-tightening.md
  - docs/tasks/task-card-template.md
  - owner-authorization://longline-2026-08-09
  - pom.xml
  - scripts/harness/doctor.py
  - scripts/harness/harness_common.py
  - scripts/harness/precheck.py
  - scripts/harness/tests/test_harness.py
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/application/AuthAbuseGuard.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/application/AuthService.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/AuthRequestBodyLimitFilter.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/AuthRequestTarget.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/AuthSourceAdmissionFilter.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/CookieCsrfGuardFilter.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/web/AuthController.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/web/AuthInputLimits.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/web/AuthRateLimitException.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/web/AuthRequests.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/application/AuthAbuseGuardTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/application/AuthServiceTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/config/AuthRequestBodyLimitFilterTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/config/AuthSourceAdmissionFilterTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/web/AuthControllerAbuseControlTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/web/AuthControllerValidationTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/web/AuthInputLimitsTest.java
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
writeAllowlist:
  - docs/tasks/TASK-0160-p2-03-auth-source-admission-test-fix.md
  - docs/tasks/context/TASK-0160.context-lock.yaml
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - docs/evidence/TASK-0160/**
  - docs/handoffs/TASK-0160.json
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/config/AuthSourceAdmissionFilterTest.java
forbiddenPaths:
  - docs/tasks/TASK-00*-*
  - docs/tasks/TASK-010*-*
  - docs/tasks/TASK-011*-*
  - docs/tasks/TASK-012*-*
  - docs/tasks/TASK-013*-*
  - docs/tasks/TASK-0140-*
  - docs/tasks/TASK-0141-*
  - docs/tasks/TASK-0142-*
  - docs/tasks/TASK-0143-*
  - docs/tasks/TASK-0144-*
  - docs/tasks/TASK-0145-*
  - docs/tasks/TASK-0146-*
  - docs/tasks/TASK-0147-*
  - docs/tasks/TASK-0148-*
  - docs/tasks/TASK-0149-*
  - docs/tasks/TASK-0150-*
  - docs/tasks/TASK-0151-*
  - docs/tasks/TASK-0152-*
  - docs/tasks/TASK-0153-*
  - docs/tasks/TASK-0154-*
  - docs/tasks/TASK-0155-*
  - docs/tasks/TASK-0156-*
  - docs/tasks/TASK-0157-*
  - docs/tasks/TASK-0158-*
  - docs/tasks/TASK-0159-*
  - docs/tasks/context/TASK-00*.context-lock.yaml
  - docs/tasks/context/TASK-010*.context-lock.yaml
  - docs/tasks/context/TASK-011*.context-lock.yaml
  - docs/tasks/context/TASK-012*.context-lock.yaml
  - docs/tasks/context/TASK-013*.context-lock.yaml
  - docs/tasks/context/TASK-0140.context-lock.yaml
  - docs/tasks/context/TASK-0141.context-lock.yaml
  - docs/tasks/context/TASK-0142.context-lock.yaml
  - docs/tasks/context/TASK-0143.context-lock.yaml
  - docs/tasks/context/TASK-0144.context-lock.yaml
  - docs/tasks/context/TASK-0145.context-lock.yaml
  - docs/tasks/context/TASK-0146.context-lock.yaml
  - docs/tasks/context/TASK-0147.context-lock.yaml
  - docs/tasks/context/TASK-0148.context-lock.yaml
  - docs/tasks/context/TASK-0149.context-lock.yaml
  - docs/tasks/context/TASK-0150.context-lock.yaml
  - docs/tasks/context/TASK-0151.context-lock.yaml
  - docs/tasks/context/TASK-0152.context-lock.yaml
  - docs/tasks/context/TASK-0153.context-lock.yaml
  - docs/tasks/context/TASK-0154.context-lock.yaml
  - docs/tasks/context/TASK-0155.context-lock.yaml
  - docs/tasks/context/TASK-0156.context-lock.yaml
  - docs/tasks/context/TASK-0157.context-lock.yaml
  - docs/tasks/context/TASK-0158.context-lock.yaml
  - docs/tasks/context/TASK-0159.context-lock.yaml
  - docs/evidence/TASK-00*/**
  - docs/evidence/TASK-010*/**
  - docs/evidence/TASK-011*/**
  - docs/evidence/TASK-012*/**
  - docs/evidence/TASK-013*/**
  - docs/evidence/TASK-0140/**
  - docs/evidence/TASK-0141/**
  - docs/evidence/TASK-0142/**
  - docs/evidence/TASK-0143/**
  - docs/evidence/TASK-0144/**
  - docs/evidence/TASK-0145/**
  - docs/evidence/TASK-0146/**
  - docs/evidence/TASK-0147/**
  - docs/evidence/TASK-0148/**
  - docs/evidence/TASK-0149/**
  - docs/evidence/TASK-0150/**
  - docs/evidence/TASK-0151/**
  - docs/evidence/TASK-0152/**
  - docs/evidence/TASK-0153/**
  - docs/evidence/TASK-0154/**
  - docs/evidence/TASK-0155/**
  - docs/evidence/TASK-0156/**
  - docs/evidence/TASK-0157/**
  - docs/evidence/TASK-0158/**
  - docs/evidence/TASK-0159/**
  - docs/handoffs/TASK-00*.json
  - docs/handoffs/TASK-010*.json
  - docs/handoffs/TASK-011*.json
  - docs/handoffs/TASK-012*.json
  - docs/handoffs/TASK-013*.json
  - docs/handoffs/TASK-0140.json
  - docs/handoffs/TASK-0141.json
  - docs/handoffs/TASK-0142.json
  - docs/handoffs/TASK-0143.json
  - docs/handoffs/TASK-0144.json
  - docs/handoffs/TASK-0145.json
  - docs/handoffs/TASK-0146.json
  - docs/handoffs/TASK-0147.json
  - docs/handoffs/TASK-0148.json
  - docs/handoffs/TASK-0149.json
  - docs/handoffs/TASK-0150.json
  - docs/handoffs/TASK-0151.json
  - docs/handoffs/TASK-0152.json
  - docs/handoffs/TASK-0153.json
  - docs/handoffs/TASK-0154.json
  - docs/handoffs/TASK-0155.json
  - docs/handoffs/TASK-0156.json
  - docs/handoffs/TASK-0157.json
  - docs/handoffs/TASK-0158.json
  - docs/handoffs/TASK-0159.json
  - .gitattributes
  - AGENTS.md
  - CLAUDE.md
  - README.md
  - ci/**
  - requirements-harness.txt
  - skills/**
  - docs/schemas/**
  - docs/source/**
  - docs/decisions/**
  - docs/planning/**
  - docs/architecture/**
  - docs/engineering/**
  - docs/tasks/task-card-template.md
  - .harness/agent-entrypoints.yaml
  - .harness/ci-execution-policy.yaml
  - .harness/commands.yaml
  - .harness/invariants.yaml
  - .harness/license-inventory.yaml
  - .harness/license-policy.yaml
  - .harness/paid-feature-denylist.yaml
  - .harness/phase-scope.yaml
  - .harness/protected-paths.yaml
  - .harness/skills.yaml
  - .harness/sources-of-truth.yaml
  - .harness/task-backlog.yaml
  - .harness/task-delivery-policy.yaml
  - .harness/task-lifecycle.yaml
  - .harness/tools.lock.yaml
  - scripts/harness/**
  - .github/workflows/**
  - specs/**
  - service/platform/**
  - service/modules/**
  - service/adapters/**
  - service/tests/**
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/baseline/**
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/modelproviders/**
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/application/**
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/jwt/**
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/tenant/**
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/AdminSeedRunner.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/AuthDataSourceConfig.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/AuthRequestBodyLimitFilter.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/AuthRequestTarget.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/AuthSecurityConfig.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/AuthSourceAdmissionFilter.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/CookieCsrfGuardFilter.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/SchemaReadinessHealthIndicator.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/web/**
  - service/apps/runtime/src/main/resources/**
  - service/apps/runtime/pom.xml
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/baseline/**
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/modelproviders/**
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/application/**
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/jwt/**
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/tenant/**
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/config/AdminSeedRunnerTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/config/AuthRequestBodyLimitFilterTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/config/AuthSecurityIntegrationTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/config/SchemaReadinessHealthIndicatorTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/web/**
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/ProductionProfileFailClosedTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/RuntimeContextTest.java
  - service/**/safety/**
  - service/**/memory/**
  - service/**/modelruntime/**
  - service/platform/persistence/src/main/resources/db/migration/**
  - infra/db/run-rls-tests.sh
  - infra/db/tests/01_cross_user_read_denied.sql
  - infra/db/tests/02_cross_relationship_reference_denied.sql
  - infra/db/tests/03_cross_conversation_reference_denied.sql
  - infra/db/tests/04_stale_worker_fence_denied.sql
  - infra/db/tests/05_missing_context_fail_closed.sql
  - infra/db/tests/06_authorization_snapshot_isolation.sql
  - infra/db/tests/07_claim_binds_context.sql
  - infra/db/tests/08_expired_lease_zero_write.sql
  - infra/db/tests/09_wrong_token_zero_write.sql
  - infra/db/tests/10_stale_fence_zero_write.sql
  - infra/db/tests/11_zero_write_on_missing_context.sql
  - infra/db/tests/12_coordinator_reads_only_metadata.sql
  - infra/db/tests/13_idempotent_receive_same_generation_id.sql
  - infra/db/tests/14_idempotent_receive_no_duplicate_message.sql
  - infra/db/tests/15_cross_owner_generation_reference_denied.sql
  - infra/db/tests/16_atomic_finalize_commits_all.sql
  - infra/db/tests/17_fault_injection_rolls_back_all.sql
  - infra/db/tests/18_provider_eos_cannot_complete.sql
  - infra/db/tests/19_realtime_ticket_single_use_ttl_hash.sql
  - infra/db/tests/20_resume_resumed_contiguous_cursor.sql
  - infra/db/tests/21_resume_gap_expired_window.sql
  - infra/db/tests/22_resume_reset_required_epoch.sql
  - infra/db/tests/23_resume_terminal_snapshot.sql
  - infra/db/tests/24_resume_not_found_or_forbidden.sql
  - infra/db/tests/25_realtime_event_rls_owner_isolation.sql
  - infra/db/tests/26_relationship_active_limit_enforced.sql
  - infra/db/tests/27_relationship_unique_active_companion.sql
  - infra/db/tests/28_relationship_not_found_or_forbidden.sql
  - infra/db/tests/29_relationship_lifecycle_activate_deactivate.sql
  - infra/db/tests/30_generation_cancel.sql
  - infra/db/tests/31_message_history_pagination.sql
  - infra/db/tests/32_memory_confirmation_path_only.sql
  - infra/db/tests/33_memory_cross_isolation_fail_closed.sql
  - infra/db/tests/34_memory_lifecycle_evidence_scope.sql
  - infra/db/tests/35_memory_edit_evidence.sql
  - infra/db/tests/36_memory_idempotency.sql
  - infra/db/tests/37_memory_recall_scope_budget.sql
  - infra/db/tests/38_memory_recall_tombstone_determinism.sql
  - infra/db/tests/39_identity_accounts_sessions.sql
  - infra/db/tests/40_provider_attempt_rls.sql
  - infra/db/tests/41_generation_terminal_transitions.sql
  - infra/db/tests/42_terminal_event_atomic.sql
  - infra/db/tests/43_candidate_and_quota_release.sql
  - infra/db/tests/44_finalize_finalize_concurrent.sql
  - infra/db/tests/45_finalize_cancel_concurrent.sql
  - infra/db/tests/46_finalize_terminalize_concurrent.sql
  - infra/db/tests/47_candidate_terminal_toctou.sql
  - infra/db/tests/48_refresh_rotate_concurrent.sql
  - infra/db/tests/49_realtime_seq_concurrent.sql
  - infra/db/tests/50_realtime_event_catalog.sql
  - infra/db/tests/51_authorization_snapshot_one_way_lifecycle.sql
  - infra/db/tests/52_revoked_runtime_dml_on_business_tables.sql
  - infra/db/tests/53_role_attributes_fail_closed.sql
  - infra/db/tests/54_sd_owner_param_trusted_assertion.sql
  - infra/db/tests/55_sd_missing_context_fail_closed.sql
  - infra/db/tests/56_runtime_role_cannot_migrate.sql
  - .mvn/**
  - pom.xml
  - mvnw
  - mvnw.cmd
sourcesOfTruth:
  - AGENTS.md
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - .harness/task-backlog.yaml
  - .harness/task-lifecycle.yaml
  - .harness/task-delivery-policy.yaml
  - .harness/ci-execution-policy.yaml
  - .harness/sources-of-truth.yaml
  - .harness/invariants.yaml
  - .harness/protected-paths.yaml
  - .harness/skills.yaml
  - .harness/commands.yaml
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
  - docs/evidence/TASK-0109/zcode-remediation-handoff.md
  - docs/handoffs/TASK-0156.json
requiredInvariants:
  - INV-HARNESS-001
  - INV-HARNESS-002
  - INV-HARNESS-005
  - INV-HARNESS-007
  - INV-HARNESS-009
humanApprovals:
  - scope: task-assignment
    approvedBy: repository-owner
    approvedAt: "2026-08-11"
    sourceThreadId: 2c8d4f6a-5e3b-4a9c-8d1f-3b5c7e9a2d4f
    evidence: >-
      Owner 2026-08-11 授权长线审计修复一次一张新卡推进。TASK-0156（P2-03 auth 限流收紧）实现正确
      （48f5e00 完成 5 文件变更），但根级 Maven verify 发现 AuthSourceAdmissionFilterTest 2 个测试失败
      （硬编码 20 次迭代=旧 LOGIN_SOURCE_LIMIT，收紧到 10 后第 11 次 429）。该测试在 TASK-0156
      forbiddenPaths（auth/config/**）中，无法在本卡修复 → 如实 REJECTED。本 replacement TASK-0160
      以 TASK-0156 REJECTED terminal（662945a）为 Base：实现已在 Base（不重复），只补
      AuthSourceAdmissionFilterTest 修复（2 处 20→AuthAbuseGuard.LOGIN_SOURCE_LIMIT）+ 重跑全门禁。
      C3 auth + 独立 Reviewer + Maven verify。
  - scope: local-exact-tree-fallback
    approvedBy: repository-owner
    approvedAt: "2026-08-11"
    sourceThreadId: 2c8d4f6a-5e3b-4a9c-8d1f-3b5c7e9a2d4f
    evidence: >-
      Owner 要求长线继续推进；既有 includedMinutes=usedMinutes=2000、paidBudgetUsd=0、
      stopUsageEnabled=true、dispatchCount=0 与无 runner exact-SHA 事实保持不变。本卡
      重新冻结 LOCAL_EXACT_TREE_FALLBACK（profile=precheck），远端仍如实非 PASS，不复用
      任何跨卡 Reviewer 或命令 PASS。
independentReview: required
reviewers: []
terminalStateReason: ""
```

> 本卡不在 Backlog 中，不写 `planningBacklog` 或 `planningContractHash`。它是 TASK-0156（P2-03）
> 的 replacement 卡：TASK-0156 实现正确但 AuthSourceAdmissionFilterTest 在 forbiddenPaths 中
> 无法修复 → REJECTED。本卡以 REJECTED terminal（662945a）为 Base，只补测试修复 + 重跑门禁。

## 背景与用户可观察目标

TASK-0156（P2-03 auth 限流收紧）实现（48f5e00）正确完成全部 5 文件变更（AuthAbuseGuard
LOGIN_SOURCE_LIMIT 20→10、AuthRequests @Size username≤64/password≤128、AuthInputLimits
MAX_USERNAME 64B/MAX_PASSWORD 128B/MAX_BODY 64KiB、AuthAbuseGuardTest budget 自适应、
AuthControllerValidationTest 边界值同步），但根级 Maven verify 发现 AuthSourceAdmissionFilterTest
2 个测试失败：该测试硬编码 20 次迭代匹配旧 LOGIN_SOURCE_LIMIT，收紧到 10 后第 11 次请求收到 429。
该文件在 TASK-0156 forbiddenPaths（auth/config/**）中无法修复 → REJECTED。

本卡 TASK-0160 以 REJECTED terminal 为 Base 承接相同已落地实现，只补 AuthSourceAdmissionFilterTest
修复 + 重跑全门禁。

用户可观察结果：AuthSourceAdmissionFilterTest 的 2 处硬编码 20→AuthAbuseGuard.LOGIN_SOURCE_LIMIT，
使测试自适应限流数值。Maven verify 227 tests 全绿。

## 范围内

1. `AuthSourceAdmissionFilterTest.java`：
   - `forwardedHeadersCannotSplitTheServletSourceWindow`（L33）：`for (int i = 0; i < 20; i++)` →
     `for (int i = 0; i < AuthAbuseGuard.LOGIN_SOURCE_LIMIT; i++)`
   - `loginAndRefreshSourceScopesAreIndependent`（L178）：同上。
2. 终态治理闭环：canonical precheck + 根级 Maven verify（227 tests 全绿）+ git diff --check +
   独立 R1 + Evidence/Handoff/pre-closure/单父 [skip ci]/push/远端 0/0。

## 明确范围外

- 不重复 TASK-0156 的 5 文件实现（AuthAbuseGuard/AuthRequests/AuthInputLimits/AuthAbuseGuardTest/
  AuthControllerValidationTest 已在 Base 662945a，本卡 writeAllowlist 不含它们）。
- 不改 AuthService.java（冗余字符常量无害；字节限制更紧先生效）。
- 不改其他 auth/config 测试文件（AdminSeedRunnerTest/AuthRequestBodyLimitFilterTest/
  AuthSecurityIntegrationTest/SchemaReadinessHealthIndicatorTest — 在 forbiddenPaths 中）。
- 不处理 P2-27（TASK-0157）、RISK-09（TASK-0158）。

## 输入和前置条件

- Base `662945a` = TASK-0156 REJECTED terminal（已 push、0/0、clean；pre-closure Doctor PASS 898804 checks）。
- Base tree 已含 TASK-0156 全部实现（48f5e00：AuthAbuseGuard LOGIN_SOURCE_LIMIT=10、
  AuthRequests @Size(64/128)、AuthInputLimits 64B/128B/64KiB、AuthAbuseGuardTest/AuthControllerValidationTest
  边界值已更新）。
- 受控 Python：PATH=/Users/hxf/.zcode/venvs/vc-harness/bin:$PATH。
- Maven 验证：Docker OrbStack maven:3.9-eclipse-temurin-25-alpine + vc-maven-cache volume。

## 验收标准

1. AuthSourceAdmissionFilterTest 2 处硬编码 20→AuthAbuseGuard.LOGIN_SOURCE_LIMIT。
2. 根级 Maven verify BUILD SUCCESS（227 tests，0 failures）。
3. 唯一 canonical precheck PASS。
4. 唯一无参数 `git diff --check` PASS。
5. R1 独立复核 PASS（C3 必须；0 P0/P1/P2）。
6. 终态 pre-closure PASS、单父 [skip ci] 提交、push 后 HEAD==origin/main、0/0、clean；remote exact-SHA
   如实非 PASS（dispatchCount=0，LOCAL_EXACT_TREE_FALLBACK 冻结于 READY）。
7. TASK-0156 实现的 P2-03 行为保持（Base 已含，本卡不改）。

## 必跑检查

以 YAML `requiredCommands` 精确 argv 为准。

## 回滚或前向修复

若 R1 发现阻塞：最多 1 fix batch → R2；否则如实 REJECTED 并以新卡承接。

## 停止条件

- writeAllowlist 外路径被修改；forbiddenPaths 被触碰。
- Maven verify / canonical Precheck / diff check / pre-closure 任一非 PASS。
- hardFuseWallMinutes 90 到达。

## Evidence Pack

输出到 `docs/evidence/TASK-0160/`（evidence-pack.json、review-r1.md），并生成 `docs/handoffs/TASK-0160.json`。

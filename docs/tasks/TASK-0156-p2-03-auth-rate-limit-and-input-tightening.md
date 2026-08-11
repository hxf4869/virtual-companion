# TASK-0156：P2-03 应用内限流 + 锁定收紧

```yaml
taskId: TASK-0156
state: DRAFT
owner: repository-owner
riskClass: C3
requiredSkills:
  - task-delivery-flow
  - task-intake
requiredSkillVersions:
  task-delivery-flow: "1.3.7"
  task-intake: "1.2.7"
targetSkillVersions: {}
baseCommit: c53609be66451d8a9ab976dcbbb2e17240ac6057
authorizationCommit: ""
contextFingerprint: b889f0acd80f392535626a36d5c95585c6d3f61bc998ee1a2fba15340ff45efc
contextLock: docs/tasks/context/TASK-0156.context-lock.yaml
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
  surfaceId: TASK_0156_P2_03_AUTH_RATE_LIMIT_INPUT_TIGHTENING
  policySurfaces: [AUTHORIZATION]
  distinctCrossRiskSurfaces: 1
  reviewerMinutesEstimate: 10
  terminalCheckMinutesEstimate: 25
  estimatedWallMinutes: 60
  thresholdsTriggered: []
  splitRequired: false
  ownerIndivisibleAuthorization: false
validationPlan: {frozenBefore: READY, policySource: .harness/ci-execution-policy.yaml, selectedChannel: LOCAL_EXACT_TREE_FALLBACK, profile: precheck}
requiredCommands:
  - python scripts/harness/precheck.py --task TASK-0156
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
  - docs/evidence/TASK-0159/evidence-pack.json
  - docs/evidence/TASK-0159/review-r1.md
  - docs/handoffs/TASK-0159.json
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
  - docs/tasks/TASK-0159-p1-11-license-inventory-registration.md
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
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/web/AuthControllerAbuseControlTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/web/AuthControllerValidationTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/web/AuthInputLimitsTest.java
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
writeAllowlist:
  - docs/tasks/TASK-0156-p2-03-auth-rate-limit-and-input-tightening.md
  - docs/tasks/context/TASK-0156.context-lock.yaml
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - docs/evidence/TASK-0156/**
  - docs/handoffs/TASK-0156.json
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/application/AuthAbuseGuard.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/web/AuthRequests.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/web/AuthInputLimits.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/application/AuthAbuseGuardTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/web/AuthControllerValidationTest.java
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
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/**
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/jwt/**
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/tenant/**
  - service/apps/runtime/src/main/resources/**
  - service/apps/runtime/pom.xml
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/baseline/**
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/modelproviders/**
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/config/**
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/jwt/**
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/tenant/**
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/ProductionProfileFailClosedTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/RuntimeContextTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/application/AuthServiceTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/config/AuthRequestBodyLimitFilterTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/web/AuthControllerAbuseControlTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/web/AuthControllerCookieTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/web/AuthExceptionHandlerTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/web/AuthInputLimitsTest.java
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
  - docs/handoffs/TASK-0159.json
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
      Owner 2026-08-11 授权长线审计修复一次一张新卡推进，无需再问。TASK-0156（P2-03 应用内限流 +
      锁定收紧）：AuthAbuseGuard login source limit 收紧（20→10/分/IP）、AuthRequests @Size
      收紧（username 128→64 chars、password 1024→128 chars）、AuthInputLimits 字节限制同步
      （username 512→64B、password 4096→128B、body 16384→65536B/64KiB 放宽、refresh 512B 不变），
      AuthRequestBodyLimitFilter 经 MAX_REQUEST_BODY_BYTES 常量自动同步（无代码改动），同步更新
      受影响测试负测边界。auth 变更不在 protected-paths requiredSkill 列表 → Owner 标 C3 auth
      风险等级（独立 Reviewer 必须）。含 Java 变更跑根级 Maven verify。
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

> 本卡不在 Backlog 中，不写 `planningBacklog` 或 `planningContractHash`。它是 P2-03 审计修复卡：
> 收紧 auth 限流与输入限制数值。auth 路径不在 protected-paths.yaml 的 requiredSkill 列表
> （无 db-migration/safety/memory/modelruntime/.harness/** 触碰），Owner 基于安全敏感性标为 C3。

## 背景与用户可观察目标

P2-03（来自 TASK-0109 审计 48 项问题总表）要求收紧应用内限流与锁定参数。当前 auth 防护数值偏宽松：
AuthAbuseGuard 每源 login 限流 20/分/IP、username @Size(max=128) + MAX_USERNAME_UTF8_BYTES=512B、
password @Size(max=1024) + MAX_PASSWORD_UTF8_BYTES=4096B、body MAX_REQUEST_BODY_BYTES=16KB。

用户可观察结果：
- AuthAbuseGuard login source limit 收紧 20→10/分/IP（refresh source 10 不变；login key 5/分/账号不变；
  15 分钟锁定窗口不变）。
- AuthRequests @Size：LoginRequest 和 CreateAccountRequest 的 username max 128→64、password max 1024→128。
- AuthInputLimits 字节限制同步：MAX_USERNAME_UTF8_BYTES 512→64B、MAX_PASSWORD_UTF8_BYTES 4096→128B、
  MAX_REQUEST_BODY_BYTES 16384→65536B（64KiB，**放宽**以匹配 JSON 包装实际需求上限，field-level
  限制已收紧，body 限制是泛防御天花板）、MAX_REFRESH_TOKEN_UTF8_BYTES 512B 不变。
- AuthRequestBodyLimitFilter 经 AuthInputLimits.MAX_REQUEST_BODY_BYTES 常量自动同步（无代码改动）。
- 受影响测试同步更新负测边界值。

## 范围内

1. `AuthAbuseGuard.java`：`LOGIN_SOURCE_LIMIT` 20→10。
2. `AuthRequests.java`：LoginRequest username `@Size(max=128→64)`、password `@Size(max=1024→128)`；
   CreateAccountRequest username `@Size(max=128→64)`、password `@Size(max=1024→128)`。
3. `AuthInputLimits.java`：`MAX_USERNAME_UTF8_BYTES` 512→64、`MAX_PASSWORD_UTF8_BYTES` 4096→128、
   `MAX_REQUEST_BODY_BYTES` 16384→65536。
4. `AuthAbuseGuardTest.java`：`concurrentAdmissionsNeverExceedTheFrozenSourceBudget` 硬编码
   `.isEqualTo(5)` → `.isEqualTo(25 - AuthAbuseGuard.LOGIN_SOURCE_LIMIT)`（预算拒绝数随 limit 自适应）。
5. `AuthControllerValidationTest.java`：`invalidLoginBodies`/`invalidAccountBodies` 边界值
   `tooLongUsername` 129→65（新 limit 64 + 1）、`tooLongPassword` 1025→129（新 limit 128 + 1）；
   `oneOverBodyIsRejectedBeforeJsonAndService` 中 stale `.doesNotContain("16385"...)` → 动态
   `Integer.toString(AuthInputLimits.MAX_REQUEST_BODY_BYTES + 1)`。
6. 终态治理闭环：canonical precheck + 根级 Maven verify + git diff --check + 独立 R1 + Evidence/
   Handoff/pre-closure/单父 [skip ci]/push/远端 0/0。

## 明确范围外

- 不改 AuthService.java（其 MAX_USERNAME_LENGTH=128/MAX_PASSWORD_LENGTH=1024 字符常量为冗余检查；
  AuthInputLimits 的字节限制 64B/128B 更紧先生效，不改也不破坏——全量 AuthServiceTest 审查确认无断裂）。
- 不改 AuthRequestBodyLimitFilter.java（通过 AuthInputLimits.MAX_REQUEST_BODY_BYTES 常量自动同步，
  无代码改动）。
- 不改 AuthInputLimitsTest/AuthRequestBodyLimitFilterTest/AuthControllerAbuseControlTest
  （使用常量引用自适应；AuthServiceTest 全量审查无断裂——不在 writeAllowlist）。
- 不处理 P2-27（TASK-0157）、RISK-09（TASK-0158）。
- 不触碰 .harness/** 治理文件（除 project-state/task-ledger 终态更新）、specs、infra/db、skills。

## 输入和前置条件

- Base `c53609be66451d8a9ab976dcbbb2e17240ac6057` = TASK-0159 ACCEPTED terminal（已 push、0/0、clean；
  Doctor summary PASS 892714 checks）。
- 本卡 context lock 45 输入钉在 Base；provenance 条目 owner-authorization://longline-2026-08-09
  provenanceOnly（沿用 hash cc0f91c1…）。
- 受控 Python：PATH=/Users/hxf/.zcode/venvs/vc-harness/bin:$PATH。
- Maven 验证：Docker OrbStack maven:3.9-eclipse-temurin-25-alpine + vc-maven-cache volume。

## 权限、RLS 和数据处理要求

不涉及数据库/RLS/用户数据。纯 auth 防护参数收紧。

## 状态机和失败行为

- 实现 = 5 个文件的常量/注解值变更 + 2 个测试文件边界值更新；Maven verify 验证全部单测通过。
- canonical precheck PASS（doctor + license check + catalog validation 等子命令）。
- R1 阻塞 → 最多 1 fix batch → R2；R3 禁止。超 hardFuse 90min → closure-only overrun。

## 验收标准

1. AuthAbuseGuard.LOGIN_SOURCE_LIMIT = 10。
2. AuthRequests @Size(max=64) for username, @Size(max=128) for password（两个 record）。
3. AuthInputLimits: MAX_USERNAME_UTF8_BYTES=64, MAX_PASSWORD_UTF8_BYTES=128, MAX_REQUEST_BODY_BYTES=65536。
4. AuthRequestBodyLimitFilter 无代码改动（自动同步）。
5. AuthAbuseGuardTest/AuthControllerValidationTest 边界值更新通过。
6. 根级 Maven verify BUILD SUCCESS（全部单测 PASS）。
7. 唯一 canonical precheck PASS。
8. 唯一无参数 `git diff --check` PASS。
9. R1 独立复核 PASS（C3 必须；0 P0/P1/P2）。
10. 终态 pre-closure PASS、单父 [skip ci] 提交、push 后 HEAD==origin/main、0/0、clean；remote exact-SHA
    如实非 PASS（dispatchCount=0，LOCAL_EXACT_TREE_FALLBACK 冻结于 READY）。

## 必跑检查

以 YAML `requiredCommands` 精确 argv 为准（canonical precheck 只跑一次；Maven verify 一次；
同一条无参数 `git diff --check` 只执行一次）。

## 回滚或前向修复

若 R1 发现阻塞：最多 1 fix batch → R2；否则如实 REJECTED 并以新卡承接（需 Owner 授权）。

## 停止条件

- writeAllowlist 外路径被修改；forbiddenPaths 被触碰。
- Maven verify / canonical Precheck / diff check / pre-closure 任一非 PASS。
- 候选身份变化或越界。
- hardFuseWallMinutes 90 到达：停止实现/修复/Reviewer/canonical，只允许 closure-only overrun。

## Evidence Pack

输出到 `docs/evidence/TASK-0156/`（evidence-pack.json、review-r1.md、pre-closure-request.json），
并生成 `docs/handoffs/TASK-0156.json`。

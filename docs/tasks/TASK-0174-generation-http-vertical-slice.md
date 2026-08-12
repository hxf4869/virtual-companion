# TASK-0174：Generation HTTP 纵切（async intake → work_item → handler → snapshot 轮询）

```yaml
taskId: TASK-0174
state: ACCEPTED
owner: repository-owner
riskClass: C4
requiredSkills:
  - task-delivery-flow
  - task-intake
  - database-migration
requiredSkillVersions:
  task-delivery-flow: "1.3.7"
  task-intake: "1.2.7"
  database-migration: "1.0.0"
targetSkillVersions: {}
baseCommit: a36b36e2ab76b66ad410c2f568468f8bd3fc850a
authorizationCommit: "plan-approved-2026-08-12-generation-vertical-slice"
contextFingerprint: 9965b6e69a7f642be2d260ab2ebba2e68c34d1f4f8cd842ec157b0356d6b67c0
contextFingerprintAlgorithm: SHA256_ORDINAL_SORTED_PATH_EQUALS_HASH_LF_V1
contextLock: docs/tasks/context/TASK-0174.context-lock.yaml
deliveryMode: single-card
deliveryBudgets:
  schemaVersion: 2
  candidateDeadlineMinutes: 45
  targetWallMinutes: 60
  hardFuseWallMinutes: 90
  maximumFixBatches: 1
  maximumReviewRounds: 2
  r3Forbidden: true
  overallElapsed: {anchor: DRAFT_COMMIT, terminal: TERMINAL_COMMIT, recordingRequired: true, resetOrReanchorForbidden: true}
  intakeActivation: {anchor: DRAFT_COMMIT, terminal: READY_DOCTOR_TERMINAL, targetWallMinutes: 60, hardFuseWallMinutes: 90, timeoutStatus: TIMEOUT, closureOnlyOverrunAllowed: true}
  candidateExecution: {anchor: READY_DOCTOR_PASS_AND_IN_PROGRESS_COMMIT, notStartedOutcome: NOT_STARTED, notStartedEligibility: {readyDoctorNonPassRequired: true, readyDoctorPassForbidden: true, inProgressCommitForbidden: true, candidateFreezeForbidden: true}, candidateDeadlineMinutes: 45, targetWallMinutes: 60, hardFuseWallMinutes: 90, timeoutStatus: TIMEOUT, closureOnlyOverrunAllowed: true}
  reviewer: {maximumMinutes: 15, timeoutStatus: TIMEOUT, missingTerminalStatus: UNKNOWN}
complexityAssessment:
  policySource: .harness/task-delivery-policy.yaml
  evaluatedBefore: READY
  riskClass: C4
  surfaceId: TASK_0174_GENERATION_HTTP_VERTICAL_SLICE
  policySurfaces: [AUTHORIZATION, BACKEND, DATABASE]
  distinctCrossRiskSurfaces: 3
  reviewerMinutesEstimate: 12
  terminalCheckMinutesEstimate: 20
  estimatedWallMinutes: 40
  thresholdsTriggered: []
  splitRequired: false
  ownerIndivisibleAuthorization: false
validationPlan: {frozenBefore: READY, profile: precheck}
requiredCommands:
  - bash infra/db/run-rls-tests.sh
  - JAVA_HOME=/opt/homebrew/opt/openjdk@25/libexec/openjdk.jdk/Contents/Home ./mvnw --batch-mode --no-transfer-progress -pl service/apps/runtime -am test
  - git diff --check
writeAllowlist:
  - service/platform/persistence/src/main/resources/db/migration/V25__generation_intake_workitem_promotion.sql
  - infra/db/tests/65_generation_intake_workitem_promotion.sql
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/WorkItemEnqueueService.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/ConversationCreateService.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/GenerationStateService.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/conversation/web/ConversationController.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/generation/web/GenerationController.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/worker/GenerationWorkItemHandler.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/AuthDataSourceConfig.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/worker/GenerationWorkItemHandlerTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/config/SchemaReadinessHealthIndicatorTest.java
  - docs/tasks/TASK-0174-generation-http-vertical-slice.md
  - docs/tasks/context/TASK-0174.context-lock.yaml
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - docs/evidence/TASK-0174/**
  - docs/handoffs/TASK-0174.json
forbiddenPaths:
  - service/platform/persistence/src/main/resources/db/migration/V[1-9]__*.sql
  - service/platform/persistence/src/main/resources/db/migration/V1[0-9]__*.sql
  - service/platform/persistence/src/main/resources/db/migration/V2[0-4]__*.sql
  - service/apps/runtime/src/main/resources/**
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/worker/WorkItemWorker.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/worker/WorkItemCoordinator.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/worker/LoggingWorkItemHandler.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/AuthSecurityConfig.java
  - service/**/pom.xml
  - specs/**
  - scripts/harness/**
  - skills/**
  - ci/**
  - frontend/**
  - AGENTS.md
  - CLAUDE.md
  - docs/tasks/TASK-01[5-7][0-3]-*
readAllowlist:
  - AGENTS.md
  - CLAUDE.md
  - .harness/agent-entrypoints.yaml
  - .harness/ci-execution-policy.yaml
  - .harness/commands.yaml
  - .harness/invariants.yaml
  - .harness/license-inventory.yaml
  - .harness/license-policy.yaml
  - .harness/paid-feature-denylist.yaml
  - .harness/phase-scope.yaml
  - .harness/project-state.yaml
  - .harness/protected-paths.yaml
  - .harness/skills.yaml
  - .harness/sources-of-truth.yaml
  - .harness/task-backlog.yaml
  - .harness/task-delivery-policy.yaml
  - .harness/task-ledger.yaml
  - .harness/task-lifecycle.yaml
  - .harness/tools.lock.yaml
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
  - docs/tasks/task-card-template.md
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
  - skills/database-migration/SKILL.md
  - specs/contracts/authorization-contract.yaml
  - specs/contracts/database-ownership-contract.yaml
  - pom.xml
  - service/apps/runtime/pom.xml
  - scripts/harness/doctor.py
  - scripts/harness/harness_common.py
  - scripts/harness/precheck.py
  - infra/db/run-rls-tests.sh
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/AuthDataSourceConfig.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/tenant/OwnerContext.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/worker/WorkItemWorker.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/worker/WorkItemHandler.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/worker/LoggingWorkItemHandler.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/worker/WorkItemCoordinator.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/config/SchemaReadinessHealthIndicatorTest.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/WorkItemClaim.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/WorkItemClaimService.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/GenerationReceiveService.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/GenerationRepository.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/ConversationRepository.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/MessageRepository.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/execution/LiveModelInvoker.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/routing/RoutingRequest.java
  - service/platform/persistence/src/main/resources/db/migration/V5__worker_claim_lease_fence.sql
  - service/platform/persistence/src/main/resources/db/migration/V6__conversation_generation_persistence.sql
  - service/platform/persistence/src/main/resources/db/migration/V7__finalize_generation_usage_quota_outbox.sql
  - service/platform/persistence/src/main/resources/db/migration/V10__generation_cancel_message_history.sql
  - service/platform/persistence/src/main/resources/db/migration/V15__provider_attempt_terminal_transitions.sql
  - service/platform/persistence/src/main/resources/db/migration/V16__revoke_business_dml_correct_role_attributes.sql
  - service/platform/persistence/src/main/resources/db/migration/V17__sd_owner_param_trusted_assertion.sql
  - service/platform/persistence/src/main/resources/db/migration/V18__sd_search_path_pg_catalog_revoke_public_create.sql
  - service/platform/persistence/src/main/resources/db/migration/V23__worker_claim_functions_runtime_api_grant.sql
  - service/platform/persistence/src/main/resources/db/migration/V24__worker_coordinator_functions_runtime_api.sql
  - infra/db/tests/63_worker_runtime_role_claim_complete.sql
  - infra/db/tests/58_admin_seed_concurrent.sql
  - docs/tasks/TASK-0173-worker-claim-coordinator-scheduled-polling.md
  - docs/tasks/context/TASK-0173.context-lock.yaml
  - docs/evidence/TASK-0173/evidence-pack.json
  - docs/evidence/TASK-0173/review-r1.md
  - docs/handoffs/TASK-0173.json
  - owner-authorization://longline-2026-08-09
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
  - skills/database-migration/SKILL.md
  - specs/contracts/database-ownership-contract.yaml
  - specs/contracts/authorization-contract.yaml
  - docs/handoffs/TASK-0173.json
requiredInvariants:
  - INV-WORKER-001
  - INV-TENANT-001
  - INV-AUTH-001
  - INV-HARNESS-001
  - INV-HARNESS-002
  - INV-HARNESS-003
  - INV-HARNESS-005
  - INV-HARNESS-007
  - INV-HARNESS-009
humanApprovals:
  - scope: task-assignment
    approvedBy: repository-owner
    approvedAt: "2026-08-12"
    evidence: >-
      Owner 2026-08-12 授权 generation HTTP 纵切（async intake → work_item → handler → snapshot）。后端引擎/DB
      完整（LiveModelInvoker + adapters + generation SD 函数族）但中间断裂：无 HTTP intake、worker 用
      LoggingWorkItemHandler stub、LiveModelInvoker 无调用者。本卡打通可观察端到端链路；真实模型调用
      （LiveModelInvoker.invoke）留后续卡。本 approval 由 TASK-0175 治理补救卡追溯补记（原精简卡流程遗漏
      humanApprovals 字段）。
  - scope: database-migration
    approvedBy: repository-owner
    approvedAt: "2026-08-12"
    evidence: >-
      Owner 授权本卡触碰 protected path **/db/migration/**（V25 新增 create_conversation /
      enqueue_work_item / promote_generation 三 SECURITY DEFINER 函数 + conversation_id_seq /
      work_item_id_seq 两序列，GRANT EXECUTE TO vc_api，SET search_path=vc,pg_catalog）。不改任何已执行
      迁移（V1-V24 frozen，Flyway checksum 安全）；不 REVOKE 既有授权；不新增角色；不新增表/列/约束/状态。
      V17 trusted-owner 断言保持。本 approval 由 TASK-0175 治理补救卡追溯补记。
independentReview: required
reviewers:
  - id: task0174_r1
    kind: independent-review-gate
    verdict: PASS
    reviewedCommit: e4acdbfbec1eebddf478394d9cbdac2597ca6c6e
    evidencePath: docs/evidence/TASK-0174/review-r1.md
```

## 背景与目标

后端引擎/DB 完整（LiveModelInvoker + adapters + generation SD 函数族），但**中间断了**：
无 HTTP intake、worker 用 LoggingWorkItemHandler stub、LiveModelInvoker 无调用者。本卡打通
generation 端到端可观察链路：HTTP 创建 → 入队 work_item → coordinator poll → handler
terminalize → 客户端 snapshot 轮询。真实模型调用（LiveModelInvoker.invoke 构建完整
LiveInvocationRequest）留后续卡（需 routing inputs 设计）。

## 范围内

1. **V25 migration**：4 个 SD 函数 + 2 sequence（create_conversation / enqueue_work_item /
   promote_generation / conversation_id_seq + work_item_id_seq），GRANT EXECUTE vc_api，
   SET search_path=vc,pg_catalog，不改 V1-V24/不 REVOKE/不新增表列约束角色。
2. **3 persistence service**：WorkItemEnqueueService / ConversationCreateService /
   GenerationStateService（JdbcTemplate 包装，照 GenerationReceiveService 模式）。
3. **2 HTTP 端点**：POST /api/v1/conversations（create）+ POST intake + GET snapshot
  （@AuthenticationPrincipal(expression="accountId") 避免 Modulith 跨模块依赖）。
4. **GenerationWorkItemHandler**：替换 LoggingWorkItemHandler；promote IN_PROGRESS →
   terminalize FAILED_FINAL（providers disabled 降级 / integration pending）；非 GENERATION
   kind skip；异常 best-effort terminalize + rethrow。
5. **AuthDataSourceConfig**：+6 persistence service @Bean + workItemHandler bean 替换。
6. **测试**：DB test 65（create_conversation + enqueue + promote 正负）+ handler unit test
   4 场景 + SchemaReadiness 24→25。

## 范围外

- LiveModelInvoker 成功路径（invoke → record_provider_attempt → candidate → finalize
  COMPLETED）：需 LiveInvocationRequest 构建（RoutingRequest authorization snapshot /
  entitlement / protocol），留后续卡。当前 handler 降级 FAILED_FINAL。
- realtime SSE 推送、listMessages / cancelGeneration 端点、relationship HTTP 端点。
- ID 编码 hashid codec（当前 Long.parseLong，alpha 暴露真实 id）。
- canonical precheck / 完整 unittest discover（Owner 2026-08-12 "暂时不跑长时间检查"）。

## 验收标准

1. V25 四函数 + 两 sequence GRANT vc_api；run-rls-tests.sh 65/65 PASS。
2. intake 端点：receive + enqueue（首次 created）；重复 idempotencyKey 幂等不重复入队。
3. snapshot 端点：返回 status + events。
4. handler：GENERATION → promote IN_PROGRESS → terminalize FAILED_FINAL；非 GENERATION skip。
5. runtime mvn -pl runtime -am test BUILD SUCCESS（254/0/0）。
6. git diff --check exit 0。
7. Evidence 如实标注 canonical/unittest deferred + model invocation pending。

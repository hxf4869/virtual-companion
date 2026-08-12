# TASK-0171：P1-04 worker 半边（WorkItemClaimService 装配进 runtime + worker 路径 OwnerContext.asOwner 服务端注入 + V23 授权 vc_api EXECUTE claim 家族函数 + test 63）

```yaml
taskId: TASK-0171
state: DRAFT
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
baseCommit: c789e24598ae6d6ed5f8d99bc8705b559d27fdb4
authorizationCommit: ""
contextFingerprint: cfff5e4ed0f504d3fdd786d9ed3d02c4653456bde5e9da471b53b52623c71fc4
contextLock: docs/tasks/context/TASK-0171.context-lock.yaml
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
  overallElapsed: {anchor: DRAFT_COMMIT, terminal: TERMINAL_COMMIT, recordingRequired: true, resetOrReanchorForbidden: true}
  intakeActivation: {anchor: DRAFT_COMMIT, terminal: READY_DOCTOR_TERMINAL, targetWallMinutes: 60, hardFuseWallMinutes: 90, timeoutStatus: TIMEOUT, closureOnlyOverrunAllowed: true}
  candidateExecution: {anchor: READY_DOCTOR_PASS_AND_IN_PROGRESS_COMMIT, notStartedOutcome: NOT_STARTED, notStartedEligibility: {readyDoctorNonPassRequired: true, readyDoctorPassForbidden: true, inProgressCommitForbidden: true, candidateFreezeForbidden: true}, candidateDeadlineMinutes: 45, targetWallMinutes: 60, hardFuseWallMinutes: 90, timeoutStatus: TIMEOUT, closureOnlyOverrunAllowed: true}
  reviewer: {maximumMinutes: 15, timeoutStatus: TIMEOUT, missingTerminalStatus: UNKNOWN}
complexityAssessment:
  policySource: .harness/task-delivery-policy.yaml
  evaluatedBefore: READY
  riskClass: C4
  surfaceId: TASK_0171_P1_04_WORKER_HALF_OWNER_INJECTION
  policySurfaces: [AUTHORIZATION, BACKEND]
  distinctCrossRiskSurfaces: 2
  reviewerMinutesEstimate: 13
  terminalCheckMinutesEstimate: 25
  estimatedWallMinutes: 40
  thresholdsTriggered: []
  splitRequired: false
  ownerIndivisibleAuthorization: false
validationPlan: {frozenBefore: READY, policySource: .harness/ci-execution-policy.yaml, selectedChannel: LOCAL_EXACT_TREE_FALLBACK, profile: precheck}
requiredCommands:
  - python scripts/harness/precheck.py --task TASK-0171
  - bash infra/db/run-rls-tests.sh
  - JAVA_HOME=/opt/homebrew/opt/openjdk@25/libexec/openjdk.jdk/Contents/Home ./mvnw --batch-mode --no-transfer-progress -pl service/apps/runtime -am test
  - git diff --check
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
  - docs/evidence/TASK-0109/zcode-remediation-handoff.md
  - docs/evidence/TASK-0168/evidence-pack.json
  - docs/evidence/TASK-0168/review-r1.md
  - docs/handoffs/TASK-0168.json
  - docs/tasks/TASK-0168-owner-injection-filter-trusted-principal-binding.md
  - docs/tasks/context/TASK-0168.context-lock.yaml
  - docs/evidence/TASK-0170/evidence-pack.json
  - docs/evidence/TASK-0170/review-r1.md
  - docs/handoffs/TASK-0170.json
  - docs/tasks/TASK-0170-p2-03-audit-event-retention-purge.md
  - docs/tasks/context/TASK-0170.context-lock.yaml
  - specs/contracts/authorization-contract.yaml
  - specs/contracts/database-ownership-contract.yaml
  - owner-authorization://longline-2026-08-09
  - pom.xml
  - service/apps/runtime/pom.xml
  - scripts/harness/doctor.py
  - scripts/harness/harness_common.py
  - scripts/harness/precheck.py
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/VirtualCompanionRuntimeApplication.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/AuthDataSourceConfig.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/AdminSeedRunner.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/IdentityAuthEventPurgeScheduler.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/tenant/OwnerContext.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/tenant/OwnerInjectionFilter.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/config/SchemaReadinessHealthIndicatorTest.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/WorkItemClaim.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/WorkItemClaimService.java
  - service/platform/persistence/src/main/resources/db/migration/V5__worker_claim_lease_fence.sql
  - service/platform/persistence/src/main/resources/db/migration/V16__revoke_business_dml_correct_role_attributes.sql
  - service/platform/persistence/src/main/resources/db/migration/V17__sd_owner_param_trusted_assertion.sql
  - service/platform/persistence/src/main/resources/db/migration/V18__sd_search_path_pg_catalog_revoke_public_create.sql
  - infra/db/run-rls-tests.sh
  - infra/db/tests/07_claim_binds_context.sql
  - infra/db/tests/52_revoked_runtime_dml_on_business_tables.sql
  - infra/db/tests/54_sd_owner_mismatch_fail_closed.sql
  - infra/db/tests/55_sd_missing_context_fail_closed.sql
writeAllowlist:
  - service/platform/persistence/src/main/resources/db/migration/V23__worker_claim_functions_runtime_api_grant.sql
  - infra/db/tests/63_worker_runtime_role_claim_complete.sql
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/AuthDataSourceConfig.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/worker/WorkItemHandler.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/worker/LoggingWorkItemHandler.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/worker/WorkItemWorker.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/worker/WorkItemWorkerTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/config/SchemaReadinessHealthIndicatorTest.java
  - docs/tasks/TASK-0171-p1-04-worker-half-owner-injection.md
  - docs/tasks/context/TASK-0171.context-lock.yaml
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - docs/evidence/TASK-0171/**
  - docs/handoffs/TASK-0171.json
forbiddenPaths:
  - docs/tasks/TASK-00*-*
  - docs/tasks/TASK-010*-*
  - docs/tasks/TASK-011*-*
  - docs/tasks/TASK-012*-*
  - docs/tasks/TASK-013*-*
  - docs/tasks/TASK-014[0-9]-*
  - docs/tasks/TASK-015[0-9]-*
  - docs/tasks/TASK-016[0-9]-*
  - docs/tasks/TASK-0170-*
  - docs/tasks/context/TASK-00*.context-lock.yaml
  - docs/tasks/context/TASK-010*.context-lock.yaml
  - docs/tasks/context/TASK-011*.context-lock.yaml
  - docs/tasks/context/TASK-012*.context-lock.yaml
  - docs/tasks/context/TASK-013*.context-lock.yaml
  - docs/tasks/context/TASK-014[0-9].context-lock.yaml
  - docs/tasks/context/TASK-015[0-9].context-lock.yaml
  - docs/tasks/context/TASK-016[0-9].context-lock.yaml
  - docs/tasks/context/TASK-0170.context-lock.yaml
  - docs/evidence/TASK-00*/**
  - docs/evidence/TASK-010*/**
  - docs/evidence/TASK-011*/**
  - docs/evidence/TASK-012*/**
  - docs/evidence/TASK-013*/**
  - docs/evidence/TASK-014[0-9]/**
  - docs/evidence/TASK-015[0-9]/**
  - docs/evidence/TASK-016[0-9]/**
  - docs/evidence/TASK-0170/**
  - docs/handoffs/TASK-00*.json
  - docs/handoffs/TASK-010*.json
  - docs/handoffs/TASK-011*.json
  - docs/handoffs/TASK-012*.json
  - docs/handoffs/TASK-013*.json
  - docs/handoffs/TASK-014[0-9].json
  - docs/handoffs/TASK-015[0-9].json
  - docs/handoffs/TASK-016[0-9].json
  - docs/handoffs/TASK-0170.json
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
  - service/modules/**
  - service/adapters/**
  - service/tests/**
  - service/**/pom.xml
  - service/platform/persistence/src/main/java/**
  - service/platform/persistence/src/test/**
  - service/platform/persistence/src/main/resources/db/migration/V[1-9]__*.sql
  - service/platform/persistence/src/main/resources/db/migration/V1[0-9]__*.sql
  - service/platform/persistence/src/main/resources/db/migration/V20__*.sql
  - service/platform/persistence/src/main/resources/db/migration/V21__*.sql
  - service/platform/persistence/src/main/resources/db/migration/V22__*.sql
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/baseline/**
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/modelproviders/**
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/VirtualCompanionRuntimeApplication.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/application/**
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/web/**
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/jwt/**
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/tenant/**
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/AdminSeedRunner.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/AuthRequestBodyLimitFilter.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/AuthRequestTarget.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/AuthSecurityConfig.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/AuthSourceAdmissionFilter.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/CookieCsrfGuardFilter.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/SchemaReadinessHealthIndicator.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/IdentityAuthEventPurgeScheduler.java
  - service/apps/runtime/src/main/resources/**
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/baseline/**
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/modelproviders/**
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/application/**
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/web/**
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/jwt/**
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/tenant/**
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/config/AdminSeedRunnerTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/config/AuthRequestBodyLimitFilterTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/config/AuthSecurityIntegrationTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/config/AuthSourceAdmissionFilterTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/config/IdentityAuthEventPurgeSchedulerTest.java
  - infra/db/run-rls-tests.sh
  - infra/db/tests/0[1-9]_*.sql
  - infra/db/tests/[1-5][0-9]_*.sql
  - infra/db/tests/6[0-2]_*.sql
  - frontend/**
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
  - skills/database-migration/SKILL.md
  - specs/contracts/database-ownership-contract.yaml
  - specs/contracts/authorization-contract.yaml
  - docs/evidence/TASK-0109/zcode-remediation-handoff.md
  - docs/handoffs/TASK-0168.json
  - docs/handoffs/TASK-0170.json
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
    sourceThreadId: 2c8d4f6a-5e3b-4a9c-8d1f-3b5c7e9a2d4f
    evidence: >-
      Owner 2026-08-12 长线授权继续审计修复（一次一张新卡）。本卡 TASK-0171 = P1-04 worker 半边
      （§4.1 P1-04「caller 可伪造 owner context」的 worker 执行半边；API 半边已由 TASK-0168
      OwnerInjectionFilter 闭合）。Owner 2026-08-12 已定决策点：① owner 注入形态 =
      OwnerContext.asOwner 服务端注入（与 TASK-0168 API 半边同模式，不新增 DB 角色、不建
      per-principal 连接池、不 SET ROLE）；② 部署拓扑 = runtime 同进程（WorkItemClaimService
      与 worker 原语以 @Bean 装配进 runtime，复用 authDataSource 连接池，无独立 worker
      进程/部署单元）。本卡不做 @Scheduled 轮询调度（无 coordinator/dispatcher 决定 owner
      队列，§5.1.2 依赖 coordinator 落地仍 OWNER_GATE）；只闭合「worker 执行路径的 owner
      服务端注入 + claim 家族调用原语」并装配进 runtime。开卡前已用当前 HEAD（c789e245）
      复核：WorkItemClaimService 在 platform/persistence 存在但 runtime main+test 引用 0；
      OwnerContext.asOwner 业务调用点仅 OwnerInjectionFilter（API 半边）；V5 授权 claim 家族
      EXECUTE 仅 vc_worker（NOLOGIN），runtime 连接池角色（VC_DB_USERNAME=vc_api 成员语义）
      不可调用 → 装配 worker 需要 V23 精确 GRANT EXECUTE TO vc_api。
  - scope: database-migration
    approvedBy: repository-owner
    approvedAt: "2026-08-12"
    sourceThreadId: 2c8d4f6a-5e3b-4a9c-8d1f-3b5c7e9a2d4f
    evidence: >-
      Owner 授权本卡触碰 protected path **/db/migration/**（V23 新增 GRANT EXECUTE：claim
      家族函数 vc.claim_work_items/renew_lease/complete_work_item/fail_work_item/
      cancel_work_item TO vc_api）。不改任何已执行迁移（V1-V22 frozen，Flyway checksum
      安全）；不 REVOKE vc_worker 既有 EXECUTE（V5 基线保持）；不新增角色；不修改任何函数
      （无 CREATE OR REPLACE，search_path 无涉——V18 已重写既有 SD 函数为 vc,pg_catalog）。
      安全论证：V17（TASK-0154）已为 claim_work_items 强断言 p_owner_user_id IS DISTINCT
      FROM vc.current_owner_id() 即 RAISE（test 54/55 实证）；renew_lease/_terminalize
      依赖 transaction-local GUC（vc.owner_user_id + vc.job_fence），无 context 时 WHERE
      不匹配 → 0 行（test 08-11 实证）。因此这些函数只能在 server-trusted owner context
      （OwnerContext.asOwner 经 SET LOCAL 建立）内以匹配 owner 调用——授予 vc_api EXECUTE
      不构成越权，worker 路径与 API 路径同属服务端可信代码（INV-TENANT-001 角色
      NOBYPASSRLS 不变）。新增 DB 测试 63 实证 vc_api 同事务 claim→complete 全链路 +
      无 context claim RAISE + 事务结束后迟到 complete 零写入（INV-WORKER-001）。
  - scope: local-exact-tree-fallback
    approvedBy: repository-owner
    approvedAt: "2026-08-12"
    sourceThreadId: 2c8d4f6a-5e3b-4a9c-8d1f-3b5c7e9a2d4f
    evidence: >-
      Owner 要求长线继续推进；既有 includedMinutes=usedMinutes=2000、paidBudgetUsd=0、
      stopUsageEnabled=true、dispatchCount=0 与无 runner exact-SHA 事实保持不变。本卡
      重新冻结 LOCAL_EXACT_TREE_FALLBACK（profile=precheck），远端仍如实非 PASS，不复用
      任何跨卡 Reviewer 或命令 PASS。
independentReview: required
reviewers: []
```

> 本卡不在 Backlog 中，不写 `planningBacklog` 或 `planningContractHash`。它是 P1-04 审计修复
> worker 执行半边（§4.1 列「普通 runtime caller 不能任意选择 owner；函数参数必须与
> server-trusted context 一致」的 worker 侧落地）：把已存在但未装配的
> `WorkItemClaimService`（platform/persistence）装配进 runtime，worker 路径以
> `OwnerContext.asOwner` 服务端注入 owner 上下文，并新增 V23 授权 runtime 连接池角色
> （vc_api）EXECUTE claim 家族 SECURITY DEFINER 函数。触碰 protected path
> `**/db/migration/**`（V23 新增）→ C4 + database-migration skill + humanApproval
> scope:database-migration + independentReview:required；同时改 `service/apps/runtime/**`
> （@Bean 装配 + worker 新包，非保护路径）。card riskClass 取最高 = C4。

## 背景与用户可观察目标

P1-04（TASK-0109 §4.1）：「caller 可伪造 owner context」。DB 半边已闭合（TASK-0154 V17：
34 个 SECURITY DEFINER 函数强断言 `p_owner_user_id IS DISTINCT FROM vc.current_owner_id()`
即 raise，要求 owner 上下文必须由「服务端可信路径」预先建立）；API 执行半边已闭合
（TASK-0168 `OwnerInjectionFilter`：JWT Principal → `OwnerContext.asOwner` 事务级
`SET LOCAL vc.owner_user_id` 注入）。**本卡闭合 worker 执行半边**。

当前 HEAD（c789e245）事实（代码核实，非盲信清单）：

1. `WorkItemClaimService`（`service/platform/persistence/.../WorkItemClaimService.java`）已存在：
   `claim/renewLease/complete/fail/cancel` → `vc.claim_work_items/renew_lease/complete_work_item/
   fail_work_item/cancel_work_item` 家族 SECURITY DEFINER 函数；`DEFAULT_LEASE_SECONDS=30`、
   `DEFAULT_CLAIM_LIMIT=16`；0 行返回 = 迟到写被拒（INV-WORKER-001，调用方须 fail-closed 不重试）。
   但 **runtime main+test 对 WorkItemClaimService/WorkItemClaim 引用均为 0**（grep 实证）——
   只有定义 + `WorkItemClaimServiceTest`（value-object 单测）在 platform/persistence。
2. `OwnerContext.asOwner(long ownerUserId, Runnable work)`（`OwnerContext.java:33`）是唯一的
   server-trusted owner 注入原语（`TransactionTemplate.executeWithoutResult` 内
   `SELECT set_config('vc.owner_user_id', ?, true)`，第三参 true=事务级，commit 自清）。业务
   调用点目前仅 `OwnerInjectionFilter`（API 半边）；**worker 路径零调用**。
3. V5 授权现状：claim 家族函数 `REVOKE EXECUTE FROM PUBLIC` + `GRANT EXECUTE TO vc_worker`
   （`V5__worker_claim_lease_fence.sql:186-199`）；`vc_worker` 是 `NOBYPASSRLS NOLOGIN`
   （V16 强制，V1 定义）。runtime 连接池（`VC_DB_USERNAME`，operator 提供的 LOGIN role，
   vc_api 成员语义，V14 identity 函数只授 vc_api）**没有** claim 家族 EXECUTE → 装配 worker
   到 runtime 后调用会 `insufficient_privilege`。
4. V17（TASK-0154）已把 `claim_work_items` 的 owner `set_config` 移除，改为断言
   `p_owner_user_id IS DISTINCT FROM vc.current_owner_id()` 即 RAISE；`renew_lease/_terminalize`
   读 `current_owner_id()` + transaction-local `vc.job_fence` GUC，无 context 时 WHERE 不匹配
   → 0 行。test 07/08/09/10/11/54/55 已实证这些 fail-closed 语义。
5. runtime 装配风格：`AuthDataSourceConfig`（@ConditionalOnProperty auth.enabled +
   datasource-enabled）以 @Bean 手工装配（AdminSeedRunner、IdentityAuthEventPurgeScheduler、
   OwnerContext 等），不组件扫描。`@EnableScheduling` 已存在（TASK-0170）但本卡**不新增**
   轮询调度（见范围外）。

用户可观察结果（本卡完成后）：

- **V23 授权**：`vc_api` 获得 claim 家族 5 个函数 EXECUTE（runtime 同进程 worker 复用
  authDataSource 连接池可调用）；`vc_worker` 既有 EXECUTE 不变；无新角色、无函数改动。
- **runtime 装配**：`WorkItemClaimService` 以 @Bean 装配（注入 authJdbcTemplate）；
  新增 `com.virtualcompanion.runtime.worker` 包：`WorkItemHandler`（函数式接口）、
  `LoggingWorkItemHandler`（默认实现，只记元数据无 PII）、`WorkItemWorker`（worker 执行
  原语 `processOwnerBatch(ownerUserId, fence)`：`OwnerContext.asOwner` 包裹
  claim→handle→complete/fail 单事务，0 行 fail-closed 不重试）。
- **DB 测试 63**：实证 vc_api 在 server-trusted context 内同事务 claim→complete 全链路
  成功；无 context claim 被 V17 RAISE 拒绝；claim 事务结束后（transaction-local context
  丢失）迟到 complete 零写入（INV-WORKER-001 语义）。
- **Java 单测**：`WorkItemWorkerTest` 验证 asOwner 以 ownerUserId 包裹、claim→complete
  顺序、handler 异常→fail、0 行不重试、空 claim 返回 0。
- **附带变更**：`SchemaReadinessHealthIndicatorTest` 断言 22→23（V23 加入 classpath 后
  最新 migration 版本为 23——加 migration 卡的必然附带变更，教训 1）。

## 范围内

1. **`V23__worker_claim_functions_runtime_api_grant.sql`（新增 migration，不改 V1-V22）**：
   - `SET search_path TO vc, pg_catalog;`
   - `GRANT EXECUTE ON FUNCTION vc.claim_work_items(bigint, text, integer, integer),
     vc.renew_lease(text, integer), vc.complete_work_item(text), vc.fail_work_item(text),
     vc.cancel_work_item(text) TO vc_api;`
   - 只加授权：不 REVOKE 任何既有授权（vc_worker 保持），不新增角色，不修改函数
     （无 CREATE OR REPLACE，search_path 无涉），不触碰 V1-V22。
2. **`infra/db/tests/63_worker_runtime_role_claim_complete.sql`（新增 DB 测试，
   run-rls-tests.sh 自动 glob 发现）**：
   - 正测：`SET ROLE vc_api` + `BEGIN; SET LOCAL vc.owner_user_id = '1';`（模拟 asOwner
     服务端建立 context）同事务 `vc.claim_work_items(1, 'FENCE-A', 30, 16)` → 2 件
     CLAIMED → 逐个 `vc.complete_work_item(token)` 返回 1 → COMMIT → superuser 验证 2 件
     DONE。
   - 负测：vc_api **无 context** 调 `vc.claim_work_items` → V17 RAISE（fail-closed，
     镜像 test 55 模式）。
   - 负测：新 item claim（事务内）→ COMMIT 后（transaction-local GUC 已清）迟到
     `vc.complete_work_item(token)` → 返回 0 行（INV-WORKER-001 迟到写拒绝）。
3. **`AuthDataSourceConfig.java`（修改）**：新增 3 个 @Bean：
   - `workItemClaimService(JdbcTemplate authJdbcTemplate)` → `new WorkItemClaimService(authJdbcTemplate)`
   - `workItemHandler()` → `new LoggingWorkItemHandler()`
   - `workItemWorker(WorkItemClaimService, OwnerContext, WorkItemHandler)` →
     `new WorkItemWorker(...)`
4. **`WorkItemHandler.java`（新增，`com.virtualcompanion.runtime.worker` 包）**：函数式接口
   `void handle(WorkItemClaim claim)`；业务处理边界（真实 handler 由后续 coordinator/
   业务卡提供）。
5. **`LoggingWorkItemHandler.java`（新增，同包）**：默认实现——info 日志记录
   `id/kind/refId`（元数据，不读 payload——payload 是 bytea 不透明数据，无 PII）。
6. **`WorkItemWorker.java`（新增，同包）**：构造注入 `WorkItemClaimService` + `OwnerContext`
   + `WorkItemHandler`：
   - `int processOwnerBatch(long ownerUserId, String fence)`：`ownerContext.asOwner(ownerUserId,
     () -> { List<WorkItemClaim> claims = claimService.claim(ownerUserId, fence); for each:
     handler.handle(claim) 成功 → complete(claimToken)；异常 → fail(claimToken)；0 行 → 记录
     warning（迟到写拒绝）不重试不抛；返回处理计数 })`。asOwner 的 Runnable 无返回值，
     内部以 `int[]` holder 回传计数。
   - 单事务语义：asOwner 打开一个事务，claim + handle + complete/fail 全部在同一事务内，
     满足 V5 的 transaction-local GUC 依赖（renew/complete 必须在 context 仍有效时调用）。
   - 失败语义：handler 抛异常 → 捕获并 `fail(claimToken)`（任务失败有明确终态 FAILED，
     避免无限重试循环）；complete/fail 返回 0（stale fence/expired lease/wrong token/
     missing context）→ 记录 warning，不重试（INV-WORKER-001 fail-closed）。
   - 本卡不引入 @Scheduled 轮询（无 coordinator/dispatcher 提供 owner 队列，见范围外）。
7. **`WorkItemWorkerTest.java`（新增，runtime test worker 包）**：plain 实例化 + Mockito
   mock（无 Spring 上下文，与既有 auth/config 单测隔离风格一致）：
   - (a) claim 返回 2 项 → asOwner 内 handler.handle×2 + complete×2（正确 token），返回 2；
   - (b) `ownerContext.asOwner(ownerUserId, runnable)` 以调用方 ownerUserId 调用且 runnable
     实际执行（doAnswer）；
   - (c) handler 抛异常 → `fail(token)` 被调、返回 0；
   - (d) complete 返回 0 → 不重试（只调一次）、不抛、返回 0；
   - (e) claim 返回空 → 返回 0、不调 handler；
   - (f) fail 返回 0 → 不抛（fail-closed 记录）。
8. **`SchemaReadinessHealthIndicatorTest.java`（修改）**：`expectedSchemaVersionFromClasspath-
   FindsNewestMigration` 断言 22→23（V23 加入 classpath 后最新 migration 版本为 23）。
9. 终态治理闭环：canonical precheck + run-rls-tests.sh + runtime 模块定向测试 +
   git diff --check + 独立 R1 + Evidence/Handoff/pre-closure/单父 [skip ci]/push/远端 0/0。

## 明确范围外

- 不改任何已执行 migration（V1-V22 frozen，Flyway checksum 安全）；只新增 V23 授权
  （无函数改动、无 REVOKE、无角色改动）。
- **不做 @Scheduled 轮询调度**：无 coordinator/dispatcher 决定「当前处理哪个 owner 的
  队列」，owner 来源与 fence 签发属 coordinator 职责（§5.1.2 OWNER_GATE，依赖
  coordinator 落地）。本卡只提供 worker 执行原语 `processOwnerBatch(ownerUserId, fence)`
  并装配，供未来 coordinator 调用。
- 不做跨事务 renew/长任务续租语义（renew 保持 claim 生命周期，§5.1.2 范围）；
  本卡 worker 原语是同步短任务单事务全链路。
- 不新增/修改 vc_worker 授权、不 REVOKE PUBLIC 之外的既有 EXECUTE、不新增角色、
  不改 RLS policy、不改 `begin_job_context`。
- 不改 `WorkItemClaimService.java` / `WorkItemClaim.java`（platform/persistence 只读参考；
  本卡不向其加测试——claim SQL 语义已由 test 07/08-11/54/55 覆盖）。
- 不改 `OwnerContext.java`（原语设计正确，仅复用）、`OwnerInjectionFilter.java`、
  `application.yaml`、`VirtualCompanionRuntimeApplication.java`、任何 pom.xml。
- 不改 catalog/contract/OpenAPI（specs/**）、frontend、.harness/**（除 project-state/
  task-ledger 终态更新）、scripts/harness、skills、ci。
- 不处理其它审计项（§5.1.2 worker claim lease/fence 完整验证依赖 coordinator；
  P2-22 nextAction 治理为独立 C2 小卡，Owner 已定「显式 task-intake 动作」策略，后续开卡）。
- 根级 Maven verify 与完整 Harness unittest 按 Owner 2026-08-12 static-gates-only 策略
  deferred to unified audit（本卡跑受影响模块 runtime 定向 test + run-rls-tests.sh 作
  迭代证据）。

## 输入和前置条件

- Base `c789e24598ae6d6ed5f8d99bc8705b559d27fdb4` = TASK-0170 ACCEPTED terminal（已 push、
  HEAD==origin/main、0/0、clean；nextAction 三处 sha256 `ee26338d…` 一致）。
- DRAFT 前已跑基线确认无 pre-existing 失败：`mvn -pl service/apps/runtime -am test`
  BUILD SUCCESS 240/0（63 测试类 1046 tests 全绿）；`bash infra/db/run-rls-tests.sh`
  ALL TESTS PASS 62/62——确认 writeAllowlist 文件无 stale 测试阻塞、V1-V22 + test 01-62
  基线绿。
- 本卡 context lock 输入钉在 Base（62 inputs = 61 readAllowlist + 1 provenanceOnly
  `owner-authorization://longline-2026-08-09` 沿用 hash `cc0f91c1…`）；contextFingerprint
  `cfff5e4e…` 由复刻 verify_context_lock 算法生成并自验（先复现 TASK-0170 `b6c72ea3…`
  通过，再生成 TASK-0171）。
- 受控 Python：`PATH=/Users/hxf/.zcode/venvs/vc-harness/bin:$PATH`；JDK 25 在
  `/opt/homebrew/opt/openjdk@25/libexec/openjdk.jdk/Contents/Home`；Docker 用 OrbStack
  （pgvector/pgvector:0.8.5-pg18 digest-pinned）。
- 关键事实：V5 claim 家族 EXECUTE 只授 vc_worker（NOLOGIN NOBYPASSRLS）；runtime
  连接池 VC_DB_USERNAME 是 operator 提供的 LOGIN role（vc_api 成员语义）；V17 断言
  p_owner==current_owner_id（test 54/55）；transaction-local GUC（set_config true）
  commit 自清（asOwner 单事务全链路是唯一合法调用形态）；V18 已把既有 SD 函数
  search_path 重写为 vc,pg_catalog（V23 无函数改动，无 proconfig 问题）；当前最高
  migration V22 / 最高 test 62（V23 / test 63 是本卡新增）；SchemaReadinessHealthIndicatorTest
  当前断言 22（→23）。
- runtime 依赖 virtual-companion-persistence 模块（runtime/pom.xml），WorkItemClaimService
  可直接 import。

## API / 事件 / 数据契约

- 产品 API 不变（worker 原语是内部执行组件，无新端点、无新错误码、不改 OpenAPI）。
- 数据契约：V23 仅新增 vc_api 对 claim 家族 5 个函数的 EXECUTE；不新增表/列/约束/角色；
  不新增事件。
- `WorkItemWorker.processOwnerBatch(ownerUserId, fence)` 是运行时内部原语（非 HTTP 端点），
  供未来 coordinator 装配调用。

## 权限、RLS 和数据处理要求

- vc_api 新增 EXECUTE 只覆盖 claim 家族 5 个 SECURITY DEFINER 函数；表级 DML 授权零变化
  （V16 已 REVOKE 业务表 DML；work_item 的 vc_api 授权维持 V5 基线 = 无 SELECT/无 DML）。
- 安全论证（为什么授 vc_api 不构成越权）：V17 断言保证 claim_work_items 只能在
  p_owner==current_owner_id 时执行，而 current_owner_id 只能由服务端可信路径
  （OwnerContext.asOwner，经 TransactionTemplate 事务级 set_config）建立——vc_api 身份
  下直接调用（无 context / mismatch）一律 RAISE（test 54/55 实证）；renew/terminalize
  在无 context 时 0 行（test 08-11 实证）。worker 路径与 API 路径同属服务端可信代码
  （Owner 决策：asOwner 服务端注入，不新增 DB 角色、不建 per-principal 连接池）。
- vc_worker 既有 EXECUTE 保持（V5 基线），无 REVOKE；`_terminalize` 无独立授权
  （SECURITY DEFINER 内部函数，不直接可调——V5 未 GRANT，保持）。
- 不读 payload 到日志（LoggingWorkItemHandler 只记 id/kind/refId）；worker 处理不触碰
  业务表（claim 家族函数是唯一入口，INV-WORKER-001）。
- INV-TENANT-001：运行角色 NOBYPASSRLS 不变；worker 原语以 asOwner 单事务处理一个
  owner 的批次，不跨租户扫描（claim 按 owner_user_id 过滤 + RLS 双重约束）。

## 状态机和失败行为

- V23 GRANT 失败（如函数签名不匹配）→ run-rls-tests.sh 失败 → 最多 1 fix batch 修 V23。
- claim 无 context / owner mismatch → V17 RAISE（fail-closed，test 63 负测实证）。
- handler 成功 → complete(token) 1 行 → 计数 +1；complete 返回 0（迟到写）→ warning
  日志，不重试（INV-WORKER-001）。
- handler 抛异常 → fail(token)；fail 返回 0 → warning 日志，不重试；任务有 FAILED 终态。
- claim 事务结束后迟到 complete/fail → 0 行（transaction-local context 丢失语义，
  test 63 负测实证）。
- asOwner 事务内未捕获异常 → 整个批次事务回滚（claim 撤销回 PENDING，下次可重试）——
  WorkItemWorker 内部已捕获 handler 异常转 fail，不向上传播。
- 正式门禁非 PASS → 停止 promotion，如实 REJECTED；硬熔断 90min 到达 → closure-only
  overrun。

## 模型、Prompt、记忆和安全边界

不涉及模型/Prompt/记忆。本卡是 Technical Alpha worker 执行路径的 owner 服务端注入
装配（P1-04 worker 半边）+ V23 精确函数授权。不外发、不调模型、不写记忆、不读
work_item payload 到日志。

## 验收标准

1. `V23__worker_claim_functions_runtime_api_grant.sql`：GRANT EXECUTE claim 家族 5 函数
   TO vc_api；不 REVOKE vc_worker；不新增角色；不改函数/search_path；不改 V1-V22。
2. `63_worker_runtime_role_claim_complete.sql`：vc_api 在 server-trusted context 内同事务
   claim→complete 全链路成功（2 件 DONE）+ 无 context claim RAISE（V17）+ 事务结束后
   迟到 complete 零写入。run-rls-tests.sh 含 test 63 全 PASS（63 项）。
3. `AuthDataSourceConfig` 新增 3 个 @Bean（workItemClaimService / workItemHandler /
   workItemWorker），注入 authJdbcTemplate / OwnerContext。
4. `WorkItemWorker.processOwnerBatch`：asOwner(ownerUserId) 包裹 claim→handle→complete/fail
   单事务；0 行 fail-closed 不重试；handler 异常转 fail；空 claim 返回 0。
5. `WorkItemHandler` 函数式接口 + `LoggingWorkItemHandler` 默认实现（只记 id/kind/refId，
   无 PII、不读 payload）。
6. `WorkItemWorkerTest` 覆盖 6 场景（asOwner owner 参数/claim→complete 顺序/handler 异常
   →fail/complete 0 行不重试/空 claim/ fail 0 行不抛）；runtime 模块测试全 PASS（≥240）。
7. `SchemaReadinessHealthIndicatorTest.expectedSchemaVersionFromClasspathFindsNewestMigration`
   断言 23（V23 为 classpath 最新版本）。
8. `mvn -pl service/apps/runtime -am test` BUILD SUCCESS（0 失败，0 skip）。
9. 唯一 `bash infra/db/run-rls-tests.sh` ALL TESTS PASS（含 test 63）。
10. 唯一 canonical precheck `python scripts/harness/precheck.py --task TASK-0171` 8/8 PASS；
    唯一 `git diff --check` exit 0。
11. R1 独立复核 PASS（C4 必须；0 P0/P1/P2）。
12. 终态 pre-closure PASS、单父 `[skip ci]` 提交、push 后 `HEAD==origin/main`、`0/0`、
    clean；remote exact-SHA 如实非 PASS（dispatchCount=0，LOCAL_EXACT_TREE_FALLBACK
    冻结于 READY）。

## 必跑检查

以 YAML `requiredCommands` 精确 argv 为准（canonical precheck 一次；run-rls-tests.sh
一次含 test 63；runtime 模块定向测试一次；同一无参 `git diff --check` 一次）。完整
Harness unittest 与根级 Maven verify 按 Owner 2026-08-12 static-gates-only 策略
deferred to 统一全项目复审。

## 回滚或前向修复

- 若 run-rls-tests.sh 暴露 V23 授权/search_path 问题：最多 1 个 fix batch 修 V23
  （不删测、不加 skip、不改 V1-V22）。
- 若 runtime 单测暴露装配/worker 语义问题：最多 1 个 fix batch 修 runtime 代码。
- 若 R1 发现阻塞项：最多 1 个 fix batch → R2 只验 closure/delta/adjacent risk；R3 禁止。
- 若实测必须触碰 V1-V22、其他角色授权或非 writeAllowlist 路径：立即停止，向 Owner
  申请范围升级（自批禁止）。

## 停止条件

- writeAllowlist 外路径被修改（含改后恢复）；forbiddenPaths 被触碰（含 V1-V22、
  test 01-62、.harness/**、scripts/harness/**、specs/**、application.yaml、
  platform/persistence Java、auth/config 非 write 文件等）。
- 正式 Precheck / run-rls-tests.sh / runtime 定向测试 / diff check / pre-closure 任一非 PASS。
- 候选身份（Commit/Tree）变化或越界。
- hardFuseWallMinutes 90 到达：停止实现/修复/Reviewer/canonical，只允许 Evidence/Handoff/
  pre-closure/终态提交/push/远端 0/0 的 closure-only overrun。

## Evidence Pack

输出到 `docs/evidence/TASK-0171/`（evidence-pack.json、review-r1.md），并生成
`docs/handoffs/TASK-0171.json`。

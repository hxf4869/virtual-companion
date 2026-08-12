# TASK-0173：§5.1.2 worker claim lease/fence coordinator（@Scheduled 轮询：fence 签发 + owner 队列轮询调度 + lease 过期回收 + 跨连接/接管验证；V24 枚举/回收函数 + test 64）

```yaml
taskId: TASK-0173
state: READY
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
baseCommit: 77431d45c976ecc84bbd7b39b754236ed4fb0aed
authorizationCommit: "f41c85f1b5b9e4f64e18a25d13a1b16dc847b72d5"
contextFingerprint: 90bbebd526673c13e0bc8ad41b6fe688bb4a23af82015e6ab09922602daa9d0a
contextLock: docs/tasks/context/TASK-0173.context-lock.yaml
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
  surfaceId: TASK_0173_WORKER_CLAIM_COORDINATOR_SCHEDULED_POLLING
  policySurfaces: [AUTHORIZATION, BACKEND, DATABASE]
  distinctCrossRiskSurfaces: 3
  reviewerMinutesEstimate: 13
  terminalCheckMinutesEstimate: 25
  estimatedWallMinutes: 45
  thresholdsTriggered: []
  splitRequired: false
  ownerIndivisibleAuthorization: false
validationPlan: {frozenBefore: READY, policySource: .harness/ci-execution-policy.yaml, selectedChannel: LOCAL_EXACT_TREE_FALLBACK, profile: precheck}
requiredCommands:
  - python scripts/harness/precheck.py --task TASK-0173
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
  - docs/evidence/TASK-0109/zcode-remediation-handoff.md
  - docs/evidence/TASK-0171/evidence-pack.json
  - docs/evidence/TASK-0171/review-r1.md
  - docs/handoffs/TASK-0171.json
  - docs/tasks/TASK-0171-p1-04-worker-half-owner-injection.md
  - docs/tasks/context/TASK-0171.context-lock.yaml
  - docs/evidence/TASK-0172/evidence-pack.json
  - docs/evidence/TASK-0172/review-r1.md
  - docs/handoffs/TASK-0172.json
  - docs/tasks/TASK-0172-p2-22-nextaction-task-reference-governance.md
  - docs/tasks/context/TASK-0172.context-lock.yaml
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
  - skills/database-migration/SKILL.md
  - specs/contracts/authorization-contract.yaml
  - specs/contracts/database-ownership-contract.yaml
  - owner-authorization://longline-2026-08-09
  - pom.xml
  - service/apps/runtime/pom.xml
  - scripts/harness/doctor.py
  - scripts/harness/harness_common.py
  - scripts/harness/precheck.py
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/AuthDataSourceConfig.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/IdentityAuthEventPurgeScheduler.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/tenant/OwnerContext.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/worker/WorkItemWorker.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/worker/WorkItemHandler.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/worker/LoggingWorkItemHandler.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/worker/WorkItemWorkerTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/config/SchemaReadinessHealthIndicatorTest.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/WorkItemClaim.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/WorkItemClaimService.java
  - service/platform/persistence/src/main/resources/db/migration/V5__worker_claim_lease_fence.sql
  - service/platform/persistence/src/main/resources/db/migration/V16__revoke_business_dml_correct_role_attributes.sql
  - service/platform/persistence/src/main/resources/db/migration/V17__sd_owner_param_trusted_assertion.sql
  - service/platform/persistence/src/main/resources/db/migration/V18__sd_search_path_pg_catalog_revoke_public_create.sql
  - service/platform/persistence/src/main/resources/db/migration/V23__worker_claim_functions_runtime_api_grant.sql
  - infra/db/run-rls-tests.sh
  - infra/db/tests/07_claim_binds_context.sql
  - infra/db/tests/08_expired_lease_zero_write.sql
  - infra/db/tests/58_admin_seed_concurrent.sql
  - infra/db/tests/63_worker_runtime_role_claim_complete.sql
writeAllowlist:
  - service/platform/persistence/src/main/resources/db/migration/V24__worker_coordinator_functions_runtime_api.sql
  - infra/db/tests/64_worker_coordinator_cross_session_recovery.sql
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/worker/WorkItemCoordinator.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/AuthDataSourceConfig.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/worker/WorkItemCoordinatorTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/config/SchemaReadinessHealthIndicatorTest.java
  - docs/tasks/TASK-0173-worker-claim-coordinator-scheduled-polling.md
  - docs/tasks/context/TASK-0173.context-lock.yaml
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - docs/evidence/TASK-0173/**
  - docs/handoffs/TASK-0173.json
forbiddenPaths:
  - docs/tasks/TASK-00*-*
  - docs/tasks/TASK-010*-*
  - docs/tasks/TASK-011*-*
  - docs/tasks/TASK-012*-*
  - docs/tasks/TASK-013*-*
  - docs/tasks/TASK-014[0-9]-*
  - docs/tasks/TASK-015[0-9]-*
  - docs/tasks/TASK-016[0-9]-*
  - docs/tasks/TASK-017[0-2]-*
  - docs/tasks/context/TASK-00*.context-lock.yaml
  - docs/tasks/context/TASK-010*.context-lock.yaml
  - docs/tasks/context/TASK-011*.context-lock.yaml
  - docs/tasks/context/TASK-012*.context-lock.yaml
  - docs/tasks/context/TASK-013*.context-lock.yaml
  - docs/tasks/context/TASK-014[0-9].context-lock.yaml
  - docs/tasks/context/TASK-015[0-9].context-lock.yaml
  - docs/tasks/context/TASK-016[0-9].context-lock.yaml
  - docs/tasks/context/TASK-017[0-2].context-lock.yaml
  - docs/evidence/TASK-00*/**
  - docs/evidence/TASK-010*/**
  - docs/evidence/TASK-011*/**
  - docs/evidence/TASK-012*/**
  - docs/evidence/TASK-013*/**
  - docs/evidence/TASK-014[0-9]/**
  - docs/evidence/TASK-015[0-9]/**
  - docs/evidence/TASK-016[0-9]/**
  - docs/evidence/TASK-017[0-2]/**
  - docs/handoffs/TASK-00*.json
  - docs/handoffs/TASK-010*.json
  - docs/handoffs/TASK-011*.json
  - docs/handoffs/TASK-012*.json
  - docs/handoffs/TASK-013*.json
  - docs/handoffs/TASK-014[0-9].json
  - docs/handoffs/TASK-015[0-9].json
  - docs/handoffs/TASK-016[0-9].json
  - docs/handoffs/TASK-017[0-2].json
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
  - service/platform/persistence/src/main/resources/db/migration/V2[0-3]__*.sql
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
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/worker/WorkItemWorker.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/worker/WorkItemHandler.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/worker/LoggingWorkItemHandler.java
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
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/worker/WorkItemWorkerTest.java
  - infra/db/run-rls-tests.sh
  - infra/db/tests/0[1-9]_*.sql
  - infra/db/tests/[1-5][0-9]_*.sql
  - infra/db/tests/6[0-3]_*.sql
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
  - docs/handoffs/TASK-0171.json
  - docs/handoffs/TASK-0172.json
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
      Owner 2026-08-12 长线授权继续审计修复（一次一张新卡，idle DRAFT 治理例外）。本卡 TASK-0173 =
      §5.1.2 worker claim lease/fence 完整验证（docs/evidence/TASK-0109/zcode-remediation-handoff.md
      §5.1 item 2：V1 begin_job_context / V5 claim_work_items / WorkItemClaimService 只拒绝空/STALE
      fence 却不验证 coordinator 分配；autocommit 可能丢失 transaction-local context；须用真实连接
      验证伪造 owner/fence、过期/接管/旧 fence 和跨连接操作）。Owner 在本会话确认选卡（§5.1.2）与
      部署形态（@Scheduled 轮询：runtime 应用内 Spring @Scheduled 周期轮询 owner 队列，复用
      authDataSource 连接池与 vc_api 授权）。开卡前已用当前 HEAD（77431d45）复核：TASK-0171 已交付
      worker 执行原语（WorkItemWorker.processOwnerBatch(ownerUserId, fence) + V23 授权 vc_api EXECUTE
      claim 家族 + test 63 同事务/迟到写实证）但无 coordinator——runtime 无 @Scheduled 轮询调度
      （唯一 @Scheduled 是 IdentityAuthEventPurgeScheduler）、fence 由调用方签发、CLAIED 过期项无
      回收路径（V5 claim 只选 status='PENDING'）、vc_api 无 work_item SELECT（V5 列级 SELECT 只授
      vc_job_coordinator）故无 owner 队列枚举能力。本卡交付：V24 两个 SD 函数
      （list_pending_owner_ids 枚举有 PENDING 项的 owner；recover_expired_claims 回收过期 CLAIMED
      回 PENDING）授 vc_api EXECUTE + test 64 双会话跨连接/过期回收/接管后旧 fence 零写入 + runtime
      WorkItemCoordinator @Scheduled 轮询（recover → 枚举 → 每 owner 新 fence（UUID）→
      processOwnerBatch）+ AuthDataSourceConfig bean + WorkItemCoordinatorTest +
      SchemaReadinessHealthIndicatorTest 23→24。重试/死信机制明确范围外（FAILED 保持终态，
      TASK-0171 R1 P3 已声明属 coordinator 职责的后续扩展；死信产品语义需 Owner 另定），写入
      knownRisk/remaining。
  - scope: database-migration
    approvedBy: repository-owner
    approvedAt: "2026-08-12"
    sourceThreadId: 2c8d4f6a-5e3b-4a9c-8d1f-3b5c7e9a2d4f
    evidence: >-
      Owner 授权本卡触碰 protected path **/db/migration/**（V24 新增两个 SECURITY DEFINER 函数并
      GRANT EXECUTE TO vc_api）：vc.list_pending_owner_ids()（返回有 PENDING work_item 的 distinct
      owner_user_id，仅 ID 无 payload/token/元数据，coordinator 轮询调度所需——vc_api 无 work_item
      表 SELECT，V5 列级 SELECT 只授 vc_job_coordinator，V23 只授函数 EXECUTE）与
      vc.recover_expired_claims(p_lease_grace_seconds DEFAULT 0)（把 status='CLAIMED' 且
      lease_expires_at <= now() 的项重置回 PENDING 并清 token/fence/时间戳，返回回收行数；lease
      过期回收是 §5.1.2 明确要求——V5 claim 只选 PENDING，CLAIED 过期项永远滞留否则）。不改任何
      已执行迁移（V1-V23 frozen，Flyway checksum 安全）；不 REVOKE 既有授权（vc_worker/vc_api 既有
      EXECUTE、vc_job_coordinator 列级 SELECT 全保持）；不新增角色；不修改任何既有函数；不新增
      表/列/约束/状态。安全论证：list 只暴露 owner_user_id（无业务数据），recover 仅重置过期
      CLAIMED（不触碰 PENDING/DONE/FAILED/CANCELLED，不产生新 claim），V17 断言与 transaction-local
      GUC 语义不受影响（recover 由 coordinator 以 vc_api 身份调用，无 owner context 要求——
      它不建立 tenant context，只做系统级清理，等同 retention purge 模式）；work_item 表 vc_api
      仍无表级 SELECT/DML（test 63 实证）。新增 DB 测试 64 实证跨连接/接管/过期/旧 fence 语义
      （INV-WORKER-001）。
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

> 本卡不在 Backlog 中，不写 `planningBacklog` 或 `planningContractHash`。它是 §5.1.2
> （`docs/evidence/TASK-0109/zcode-remediation-handoff.md` §5.1 item 2「Worker claim 的 lease/fence
> 绑定」）的完整验证卡：TASK-0171 已交付 worker 执行原语（`WorkItemWorker.processOwnerBatch` +
> V23 授权 + test 63），本卡交付 **coordinator**——runtime 内 `@Scheduled` 轮询调度（Owner 2026-08-12
> 本会话确认部署形态）、fence 签发、owner 队列枚举、lease 过期回收，以及真实双会话跨连接/接管/
> 旧 fence 验证（test 64）。触碰 protected path `**/db/migration/**`（V24 新增）→ C4 +
> database-migration skill + humanApproval scope:database-migration + independentReview:required；
> 同时改 `service/apps/runtime/**`（coordinator 新类 + @Bean 装配 + 测试，非保护路径）。
> card riskClass 取最高 = C4。沿用 `owner-authorization://longline-2026-08-09` 长线授权
> （hash `cc0f91c1...`），与 TASK-0153..0172 同属 idle DRAFT 治理例外，不进 backlog。

## 背景与用户可观察目标

§5.1.2（TASK-0109 §5.1 item 2）：V1 `begin_job_context`、V5 `claim_work_items` 和
`WorkItemClaimService` 旧实现只拒绝空/STALE fence，不验证 coordinator 分配；autocommit 还可能在
renew/complete 前丢失 transaction-local context。须用真实连接验证伪造 owner/fence、过期/接管/旧
fence 和跨连接操作。TASK-0171 已闭环执行原语；**本卡闭环 coordinator 与完整验证**。

当前 HEAD（77431d45）事实（代码核实，非盲信清单）：

1. `WorkItemWorker.processOwnerBatch(ownerUserId, fence)`（TASK-0171）已就绪：`OwnerContext.asOwner`
   包裹 claim→handle→批次级 complete/fail 单事务；fence 是**调用方参数**——目前全仓零调用
   （runtime main+test grep 实证），没有签发者。
2. runtime 唯一 @Scheduled 是 `IdentityAuthEventPurgeScheduler`（TASK-0170，cron 每日）；`@EnableScheduling`
   在 `AuthDataSourceConfig` 上（auth + datasource enabled 才激活）。**无 worker 轮询调度**。
3. V5 `claim_work_items`（V5__worker_claim_lease_fence.sql:49-96）WHERE 只选 `status='PENDING'`
   （:84）；CLAIED + `lease_expires_at <= now()` 的项**没有任何回收路径**——worker 崩溃/超时后
   该批永久滞留 CLAIMED（没有 coordinator 把它释放回 PENDING 或重新 claim）。
4. owner 队列枚举能力缺失：runtime 连接池角色是 vc_api（V23 授 claim 家族函数 EXECUTE）；
   work_item 表 V5 只给 `vc_job_coordinator` 列级 SELECT（无 payload/token）、`vc_worker` SELECT、
   **vc_api 零表权限**（test 63 实证）。coordinator 若想「轮询 owner 队列」需要知道哪些 owner 有
   PENDING 项，但 vc_api 查不了 work_item 表 → 必须新增 SECURITY DEFINER 枚举函数。
5. V17（TASK-0154）已把 claim 家族 SD 函数改为强断言 `p_owner_user_id IS DISTINCT FROM
   vc.current_owner_id()` 即 RAISE；V18（TASK-0158）已把全部 37 个 SD 函数 search_path 动态重写为
   `vc, pg_catalog` 并 REVOKE public CREATE；V23（TASK-0171）已授 vc_api claim 家族 EXECUTE。
   新 SD 函数（V24）直接声明 `SET search_path = vc, pg_catalog`（V18 模式）。
6. test 63 已证同事务 claim→complete 全链路 + 无 context RAISE + 迟到 complete 零写入；但**无
   双会话/跨连接/接管/过期回收测试**（58 的 dblink 双会话模式可复用）。
7. 既有状态机（V5）：PENDING / CLAIMED / DONE / FAILED / CANCELLED。`_terminalize` 写终态
   （finished_at）；**FAILED 是终态，无重试/死信路径**（TASK-0171 R1 P3 已声明属 coordinator 职责的
   后续扩展）。

用户可观察结果（本卡完成后）：

- **V24**：`vc.list_pending_owner_ids()`（枚举有 PENDING 项的 owner，仅 ID）与
  `vc.recover_expired_claims([grace_seconds])`（过期 CLAIMED 回收回 PENDING，返回回收行数）两个
  SD 函数授 vc_api EXECUTE；V1-V23 与既有授权零改动。
- **runtime coordinator**：`WorkItemCoordinator`（@Scheduled fixedDelay，默认 5s，可配置）每轮：
  ① 回收过期 lease；② 枚举有 PENDING 项的 owner；③ 对每个 owner 签发新 fence（UUID）并调用
  `workItemWorker.processOwnerBatch(ownerId, fence)`。单 owner 批次异常隔离（记录继续下一 owner）。
- **DB 测试 64**：真实双会话（dblink）实证跨连接伪造 fence 零写入、lease 过期 → 回收 → 接管
  （新 token）→ 旧 token/旧 fence 零写入、`list_pending_owner_ids` 只返回有 PENDING 的 owner。
- **Java 测试**：`WorkItemCoordinatorTest` 验证轮询顺序（recover→list→每 owner 新 fence→batch）、
  空列表 no-op、异常隔离。
- **附带变更**：`SchemaReadinessHealthIndicatorTest` 断言 23→24（加 migration 卡必然附带，教训 1）。

## 范围内

1. **`V24__worker_coordinator_functions_runtime_api.sql`（新增 migration，不改 V1-V23）**：
   - `SET search_path TO vc, pg_catalog;`（V18 模式，无 public）。
   - `CREATE OR REPLACE FUNCTION vc.list_pending_owner_ids() RETURNS TABLE(owner_user_id bigint)
     LANGUAGE sql SECURITY DEFINER SET search_path = vc, pg_catalog AS
     'SELECT DISTINCT wi.owner_user_id FROM vc.work_item wi WHERE wi.status = ''PENDING''
      ORDER BY wi.owner_user_id;'`——只返回 owner ID，不暴露 payload/token/任何业务元数据
     （coordinator 轮询调度的最小必要信息；vc_api 由此获得枚举能力而无需 work_item 表权限）。
   - `CREATE OR REPLACE FUNCTION vc.recover_expired_claims(p_lease_grace_seconds integer DEFAULT 0)
     RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = vc, pg_catalog`：
     `UPDATE vc.work_item u SET status='PENDING', claim_token=NULL, claim_fence=NULL,
     claimed_at=NULL, lease_expires_at=NULL WHERE u.status='CLAIMED'
     AND u.lease_expires_at <= now() - make_interval(secs => GREATEST(p_lease_grace_seconds, 0));`
     `RETURN count(*)`——只重置过期 CLAIMED（不触碰 PENDING/DONE/FAILED/CANCELLED，不产生新
     claim，不建 tenant context）；返回回收行数供 coordinator 记录。
   - `GRANT EXECUTE ON FUNCTION vc.list_pending_owner_ids(), vc.recover_expired_claims(integer)
     TO vc_api;`——只加授权；不 REVOKE 任何既有授权（vc_worker/vc_api 既有 EXECUTE、
     vc_job_coordinator 列级 SELECT 全保持）；不新增角色；不改任何既有函数；不新增表/列/约束/状态。
2. **`infra/db/tests/64_worker_coordinator_cross_session_recovery.sql`（新增 DB 测试，
   run-rls-tests.sh 自动 glob 发现；dblink 双会话模式照 58）**：
   - 正测 A（跨连接伪造拒绝）：会话 1（vc_api + context）claim 成功；会话 2（vc_api 独立连接，
     无 context 或错 fence）用会话 1 的 token 调 `complete_work_item` → 0 行（跨连接无
     transaction-local GUC；INV-WORKER-001）。
   - 正测 B（过期回收 + 接管）：会话 1 claim 后将 `lease_expires_at` 置为过去（superuser 或
     vc_worker 路径；simulate crash）；`recover_expired_claims()` 返回 ≥1；项回 PENDING；会话 2
     重新 claim 拿到**新 token**（接管）；会话 1 旧 token `complete` → 0 行（旧 fence/旧 token
     拒绝——接管后旧持有者零写入）。
   - 正测 C（枚举）：`list_pending_owner_ids()` 只返回有 PENDING 项的 owner；全部终态后返回空；
     不返回 payload/token（返回类型只有 owner_user_id）。
   - 终态验证走 superuser（vc_api 无 work_item SELECT，test 63 模式）。
3. **`WorkItemCoordinator.java`（新增，`com.virtualcompanion.runtime.worker` 包）**：
   - 构造注入 `WorkItemWorker workItemWorker` + `JdbcTemplate authJdbcTemplate`
     （`SELECT vc.recover_expired_claims(?)` / `SELECT vc.list_pending_owner_ids()`）。
   - `@Scheduled(fixedDelayString = "${virtual-companion.worker.coordinator-poll-delay-ms:5000}")`
     `public void pollOwnerQueues()`（@EnableScheduling 已由 AuthDataSourceConfig 提供，仅
     datasource-enabled 时激活）：
     - ① `int recovered = authJdbcTemplate.queryForObject("SELECT vc.recover_expired_claims(0)", Integer.class)`
       （recovered>0 → info 日志）；
     - ② `List<Long> ownerIds = authJdbcTemplate.query("SELECT * FROM vc.list_pending_owner_ids()",
       (rs, n) -> rs.getLong("owner_user_id"))`；
     - ③ 对每个 owner：`String fence = UUID.randomUUID().toString();`
       `workItemWorker.processOwnerBatch(ownerId, fence)`；单 owner 抛异常 → error 日志
       （含 ownerId，不打印 token/fence），**继续下一 owner**（异常隔离，不阻塞整轮）；
     - ④ ownerIds 空 → 仅 ①，no-op 返回。
   - 方法级 try/catch（RuntimeException → error 日志），保证调度循环永不因单轮异常中断
     （@Scheduled 默认单线程；抛异常会吞掉后续轮次——fail 关闭语义是「记录并继续下一轮」）。
   - fence 语义：每次 processOwnerBatch 调用签发新 UUID（V5 接受任意非空非 STALE fence；
     coordinator 分配即「验证 coordinator 分配」的落地——worker 不再由调用方任意指定 fence）。
4. **`AuthDataSourceConfig.java`（修改）**：新增 1 个 @Bean：
   - `workItemCoordinator(WorkItemWorker workItemWorker, JdbcTemplate authJdbcTemplate)` →
     `new WorkItemCoordinator(workItemWorker, authJdbcTemplate)`。
5. **`WorkItemCoordinatorTest.java`（新增，runtime test worker 包）**：plain 实例化 + Mockito mock
   （无 Spring 上下文，照 WorkItemWorkerTest 风格）：
   - (a) 轮询一轮顺序：recover 被调 → list 返回 2 owner → 每个 owner 以**不同** fence 调
     `processOwnerBatch`（doAnswer 捕获 fence 参数断言 UUID 且互不相等）；
   - (b) recover 返回 3 → 日志无异常（结果正确）；
   - (c) list 空 → 只调 recover，不调 processOwnerBatch；
   - (d) 某 owner processOwnerBatch 抛异常 → 该 owner 异常被捕获记录，下一 owner 仍被处理；
   - (e) recover 调用本身抛异常 → 整轮捕获记录，不抛出（调度循环存活）。
6. **`SchemaReadinessHealthIndicatorTest.java`（修改）**：`expectedSchemaVersionFromClasspath-
   FindsNewestMigration` 断言 23→24（V24 加入 classpath 后最新 migration 版本为 24）。
7. 终态治理闭环：canonical precheck + run-rls-tests.sh（64 项）+ runtime 模块定向测试 +
   git diff --check + 独立 R1 + Evidence/Handoff/pre-closure/单父 [skip ci]/push/远端 0/0。

## 明确范围外

- **重试/死信机制**：FAILED 保持终态（V5 `_terminalize` 语义不变）。自动重试（FAILED→PENDING）、
  重试次数上限、死信队列/状态、告警是产品/运维语义，需 Owner 另定（本卡写入 knownRisk/remaining，
  与 TASK-0171 R1 P3「批次 FAILED 无重试/死信机制属 coordinator 职责」的后续扩展对齐）。
- **长任务续租**：本卡 worker 原语是同步短任务单事务全链路（TASK-0171 语义）；coordinator 不自动
  renew lease、不做跨轮续租。长任务 renew 语义留后续卡。
- 不改 V5 claim/renew/_terminalize 语义、不改 `WorkItemClaimService`/`WorkItemClaim`/
  `WorkItemWorker`/`WorkItemHandler`/`LoggingWorkItemHandler`/`OwnerContext`/
  `OwnerInjectionFilter`/`JwtAuthenticationFilter`/`application.yaml`（配置键只经 @Value 默认值）。
- 不改任何已执行 migration（V1-V23 frozen）；只新增 V24 授权（无 REVOKE、无角色/表/列/约束/
  状态改动、无函数改动）。
- 不做跨租户扫描：coordinator 对每个 owner 以独立 fence 调 `processOwnerBatch`，claim 按
  owner_user_id 过滤 + RLS 双重约束（INV-TENANT-001）；coordinator 自身不读 work_item 表
  （V24 函数是唯一入口）。
- 不改 catalog/contract/OpenAPI（specs/**）、frontend、.harness/**（除 project-state/task-ledger
  终态更新）、scripts/harness、skills、ci。
- 不处理其它审计项（P2-20 复核发现已无硬编码 master 待后续验收卡；P2-26/P3-01 等按序开卡）。
- 根级 Maven verify 与完整 Harness unittest 按 Owner 2026-08-12 static-gates-only 策略
  deferred to unified audit（本卡跑受影响模块 runtime 定向 test + run-rls-tests.sh 作
  迭代证据）。

## 输入和前置条件

- Base `77431d45c976ecc84bbd7b39b754236ed4fb0aed` = TASK-0172 ACCEPTED terminal（已 push、
  HEAD==origin/main、0/0、clean；nextAction 三处 sha256 `2f3a9f84…` 一致）。
- DRAFT 前已复核：`test_rejects_merge_on_discovered_primary_branch` 等 harness 测试已显式覆盖
  main/master（P2-20 代码层面已无硬编码 master，唯一 "master" 是显式分支测试用例）；V5 claim 只
  选 PENDING；vc_api 无 work_item 表权限；runtime 无 worker 轮询调度；全仓零
  `processOwnerBatch` 调用。
- 本卡 context lock 输入钉在 Base（64 inputs = 63 readAllowlist + 1 provenanceOnly
  `owner-authorization://longline-2026-08-09` 沿用 hash `cc0f91c1…`）；contextFingerprint
  `90bbebd5…` 由复刻 verify_context_lock 算法生成并自验（先复现 TASK-0172 `700b02c3…`
  通过，再生成 TASK-0173）。
- 受控 Python：`PATH=/Users/hxf/.zcode/venvs/vc-harness/bin:$PATH`；JDK 25 在
  `/opt/homebrew/opt/openjdk@25/libexec/openjdk.jdk/Contents/Home`；Docker 用 OrbStack
  （pgvector/pgvector:0.8.5-pg18 digest-pinned）。
- 关键事实：V18 已动态重写全部 37 个 SD 函数 search_path 为 vc,pg_catalog（V24 新函数直接
  声明 vc,pg_catalog）；V5 只授 vc_job_coordinator work_item 列级 SELECT（无 payload/token）与
  vc_worker SELECT；V23 授 vc_api claim 家族 5 函数 EXECUTE；当前最高 migration V23 / 最高
  test 63（V24 / test 64 是本卡新增）；SchemaReadinessHealthIndicatorTest 当前断言 23（→24）；
  dblink 双会话模式由 test 58 实证可用。

## API / 事件 / 数据契约

- 产品 API 不变（coordinator 是内部调度组件，无新端点、无新错误码、不改 OpenAPI）。
- 数据契约：V24 新增两个 SD 函数（list_pending_owner_ids / recover_expired_claims）并授
  vc_api EXECUTE；不新增表/列/约束/角色/状态；不新增事件。
- `WorkItemCoordinator.pollOwnerQueues()` 是运行时内部 @Scheduled 入口（非 HTTP 端点）。

## 权限、RLS 和数据处理要求

- vc_api 新增 EXECUTE 只覆盖 V24 两个函数；表级授权零变化（vc_api 对 work_item 仍无
  SELECT/DML，test 63/64 实证）。
- 安全论证（为什么授 vc_api 不构成越权）：`list_pending_owner_ids` 只暴露 owner_user_id（无
  payload/token/业务元数据——返回类型只有一列）；`recover_expired_claims` 只把过期 CLAIMED
  重置回 PENDING（不触碰其他状态、不建 tenant context、不产生新 claim、不可被用于改写
  PENDING/DONE/FAILED/CANCELLED 或篡改 owner）；两者都无 p_owner_user_id 参数（不涉及 V17
  trusted-owner 断言面），由 coordinator 以 vc_api 身份做系统级调度/清理（等同 V22 retention
  purge 的调用模式）。V17 断言 + transaction-local GUC 语义不受影响（test 54/55/08-11/63 保持）。
- vc_worker 既有 EXECUTE 与 vc_job_coordinator 列级 SELECT 保持；无 REVOKE；无新角色。
- coordinator 日志不含 payload/token/fence/owner 业务数据（只记 ownerId 与回收/处理计数）；
  不读 work_item payload。
- INV-TENANT-001：运行角色 NOBYPASSRLS 不变；每 owner 独立 context + fence，不跨租户扫描。

## 状态机和失败行为

- V24 GRANT 失败（函数签名不匹配）→ run-rls-tests.sh 失败 → 最多 1 fix batch 修 V24。
- recover_expired_claims：过期 CLAIMED → PENDING（清 token/fence/时间戳）；返回回收行数；
  无过期项返回 0。
- 接管语义：A 的 lease 过期 → recover → 项回 PENDING → B claim 拿新 token；A 旧 token
  complete/fail → 0 行（旧 fence 不匹配 + context 已失；test 64 实证）。
- coordinator 单 owner 批次异常 → error 日志（ownerId）→ 继续下一 owner；recover/list 异常 →
  捕获记录 → 下一轮继续（@Scheduled 单线程循环不被异常杀死）。
- 正式门禁非 PASS → 停止 promotion，如实 REJECTED；硬熔断 90min 到达 → closure-only overrun。

## 模型、Prompt、记忆和安全边界

不涉及模型/Prompt/记忆。本卡是 Technical Alpha worker 调度 coordinator（§5.1.2）的
@Scheduled 轮询落地 + V24 两个调度用 SD 函数 + test 64 双会话完整验证。不外发、不调模型、
不写记忆、不读 work_item payload 到日志。

## 验收标准

1. `V24__worker_coordinator_functions_runtime_api.sql`：两个 SD 函数
   （list_pending_owner_ids / recover_expired_claims(integer)）声明 `SET search_path = vc,
   pg_catalog` 并 GRANT EXECUTE TO vc_api；不 REVOKE 任何既有授权；不新增角色；不改任何既有
   函数/表/列/约束/状态；不改 V1-V23。
2. `64_worker_coordinator_cross_session_recovery.sql`：双会话实证（a）跨连接伪造 fence 零写入；
   （b）过期回收后接管、旧 token 零写入；（c）list 只返回有 PENDING 的 owner、终态后为空。
   run-rls-tests.sh 含 test 64 全 PASS（64 项）。
3. `WorkItemCoordinator.pollOwnerQueues()` @Scheduled（fixedDelay 默认 5000ms 可配置）：
   recover → list → 每 owner 新 fence（UUID，互不相同）→ processOwnerBatch；单 owner 异常
   隔离继续；空列表 no-op；整轮异常捕获记录不抛出。
4. `AuthDataSourceConfig` 新增 `workItemCoordinator` @Bean（注入 WorkItemWorker + authJdbcTemplate）。
5. `WorkItemCoordinatorTest` 覆盖 5 场景（轮询顺序/fence 每 owner 唯一/空列表/异常隔离/recover
   异常存活）；runtime 模块测试全 PASS（≥245）。
6. `SchemaReadinessHealthIndicatorTest.expectedSchemaVersionFromClasspathFindsNewestMigration`
   断言 24（V24 为 classpath 最新版本）。
7. `mvn -pl service/apps/runtime -am test` BUILD SUCCESS（0 失败，0 skip）。
8. 唯一 `bash infra/db/run-rls-tests.sh` ALL TESTS PASS（含 test 64）。
9. 唯一 canonical precheck `python scripts/harness/precheck.py --task TASK-0173` 8/8 PASS；
   唯一 `git diff --check` exit 0。
10. R1 独立复核 PASS（C4 必须；0 P0/P1/P2）。
11. 终态 pre-closure PASS、单父 `[skip ci]` 提交、push 后 `HEAD==origin/main`、`0/0`、
    clean；remote exact-SHA 如实非 PASS（dispatchCount=0，LOCAL_EXACT_TREE_FALLBACK
    冻结于 READY）。

## 必跑检查

以 YAML `requiredCommands` 精确 argv 为准（canonical precheck 一次；run-rls-tests.sh
一次含 test 64；runtime 模块定向测试一次；同一无参 `git diff --check` 一次）。完整
Harness unittest 与根级 Maven verify 按 Owner 2026-08-12 static-gates-only 策略
deferred to 统一全项目复审。

## 回滚或前向修复

- 若 run-rls-tests.sh 暴露 V24 函数/授权问题：最多 1 个 fix batch 修 V24
  （不删测、不加 skip、不改 V1-V23）。
- 若 runtime 单测暴露 coordinator 装配/调度语义问题：最多 1 个 fix batch 修 runtime 代码。
- 若 R1 发现阻塞项：最多 1 个 fix batch → R2 只验 closure/delta/adjacent risk；R3 禁止。
- 若实测必须触碰 V1-V23、其他角色授权或非 writeAllowlist 路径：立即停止，向 Owner
  申请范围升级（自批禁止）。

## 停止条件

- writeAllowlist 外路径被修改（含改后恢复）；forbiddenPaths 被触碰（含 V1-V23、
  test 01-63、.harness/**、scripts/harness/**、specs/**、application.yaml、
  platform/persistence Java、worker 包既有文件、auth/config 非 write 文件等）。
- 正式 Precheck / run-rls-tests.sh / runtime 定向测试 / diff check / pre-closure 任一非 PASS。
- 候选身份（Commit/Tree）变化或越界。
- hardFuseWallMinutes 90 到达：停止实现/修复/Reviewer/canonical，只允许 Evidence/Handoff/
  pre-closure/终态提交/push/远端 0/0 的 closure-only overrun。

## Evidence Pack

输出到 `docs/evidence/TASK-0173/`（evidence-pack.json、review-r1.md），并生成
`docs/handoffs/TASK-0173.json`。

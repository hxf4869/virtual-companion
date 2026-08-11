# TASK-0155：P1-11 migrator/runtime 分离 + schema readiness 门禁 + 缺 schema → 503

```yaml
taskId: TASK-0155
state: DRAFT
owner: repository-owner
riskClass: C2
requiredSkills:
  - task-delivery-flow
  - task-intake
requiredSkillVersions:
  task-delivery-flow: "1.3.7"
  task-intake: "1.2.7"
targetSkillVersions: {}
baseCommit: 2ba482966cf3812629c1e8dfd111a798dba9cd96
authorizationCommit: ""
contextFingerprint: 523497cf7051ab4818c0d7ee28caf1ca634cadef9089dba41a2a8c0de379a0f7
contextLock: docs/tasks/context/TASK-0155.context-lock.yaml
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
  intakeActivation: {anchor: DRAFT_COMMIT, terminal: READY_DOCTOR_TERMINAL, targetWallMinutes: 60, hardFuseWallMinutes: 90, timeoutStatus: TIMEOUT, closureOnlyOverrun: true}
  candidateExecution: {anchor: READY_DOCTOR_PASS_AND_IN_PROGRESS_COMMIT, notStartedOutcome: NOT_STARTED, notStartedEligibility: {readyDoctorNonPassRequired: true, readyDoctorPassForbidden: true, inProgressCommitForbidden: true, candidateFreezeForbidden: true}, candidateDeadlineMinutes: 45, targetWallMinutes: 60, hardFuseWallMinutes: 90, timeoutStatus: TIMEOUT, closureOnlyOverrun: true}
  reviewer: {maximumMinutes: 15, timeoutStatus: TIMEOUT, missingTerminalStatus: UNKNOWN}
complexityAssessment:
  policySource: .harness/task-delivery-policy.yaml
  evaluatedBefore: READY
  riskClass: C2
  surfaceId: TASK_0155_P1_11_MIGRATOR_RUNTIME_SEPARATION_READINESS
  policySurfaces: [BACKEND]
  distinctCrossRiskSurfaces: 1
  reviewerMinutesEstimate: 14
  terminalCheckMinutesEstimate: 25
  estimatedWallMinutes: 85
  thresholdsTriggered: []
  splitRequired: false
  ownerIndivisibleAuthorization: false
validationPlan: {frozenBefore: READY, policySource: .harness/ci-execution-policy.yaml, selectedChannel: LOCAL_EXACT_TREE_FALLBACK, profile: precheck}
requiredCommands:
  - python scripts/harness/precheck.py --task TASK-0155
  - bash infra/db/run-rls-tests.sh
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
  - .harness/tools.lock.yaml
  - docs/evidence/TASK-0109/zcode-remediation-handoff.md
  - docs/evidence/TASK-0154/evidence-pack.json
  - docs/evidence/TASK-0154/review-r1.md
  - docs/handoffs/TASK-0154.json
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
  - docs/tasks/TASK-0154-sd-owner-param-trusted-assertion.md
  - docs/tasks/context/TASK-0154.context-lock.yaml
  - docs/tasks/task-card-template.md
  - infra/db/run-rls-tests.sh
  - infra/db/tests/52_revoked_runtime_dml_on_business_tables.sql
  - owner-authorization://longline-2026-08-09
  - pom.xml
  - scripts/harness/doctor.py
  - scripts/harness/harness_common.py
  - scripts/harness/precheck.py
  - scripts/harness/tests/test_harness.py
  - service/apps/runtime/pom.xml
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/VirtualCompanionRuntimeApplication.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/application/AuthService.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/AdminSeedRunner.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/AuthDataSourceConfig.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/AuthSecurityConfig.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/tenant/OwnerContext.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/web/AuthController.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/web/AuthErrorException.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/web/AuthExceptionHandler.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/web/AuthRequests.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/web/ErrorEnvelope.java
  - service/apps/runtime/src/main/resources/application.yaml
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/ProductionProfileFailClosedTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/RuntimeContextTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/config/AuthSecurityIntegrationTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/web/AuthControllerValidationTest.java
  - service/platform/persistence/pom.xml
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/IdentityAccountRepository.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/IdentityRefreshTokenRepository.java
  - service/platform/persistence/src/main/resources/db/migration/V1__extensions_roles_functions.sql
  - service/platform/persistence/src/main/resources/db/migration/V2__user_domain_ownership.sql
  - service/platform/persistence/src/main/resources/db/migration/V3__authorization_snapshot.sql
  - service/platform/persistence/src/main/resources/db/migration/V4__provider_registry.sql
  - service/platform/persistence/src/main/resources/db/migration/V5__worker_claim_lease_fence.sql
  - service/platform/persistence/src/main/resources/db/migration/V6__conversation_generation_persistence.sql
  - service/platform/persistence/src/main/resources/db/migration/V7__finalize_generation_usage_quota_outbox.sql
  - service/platform/persistence/src/main/resources/db/migration/V8__realtime_resume_ticket_gap_reset_snapshot.sql
  - service/platform/persistence/src/main/resources/db/migration/V9__relationship_active_companion_limit.sql
  - service/platform/persistence/src/main/resources/db/migration/V10__generation_cancel_message_history.sql
  - service/platform/persistence/src/main/resources/db/migration/V11__canonical_memory_lifecycle.sql
  - service/platform/persistence/src/main/resources/db/migration/V12__memory_candidate_management_api.sql
  - service/platform/persistence/src/main/resources/db/migration/V13__memory_recall_context_tombstone.sql
  - service/platform/persistence/src/main/resources/db/migration/V14__identity_accounts_sessions.sql
  - service/platform/persistence/src/main/resources/db/migration/V15__provider_attempt_terminal_transitions.sql
  - service/platform/persistence/src/main/resources/db/migration/V16__revoke_business_dml_correct_role_attributes.sql
  - service/platform/persistence/src/main/resources/db/migration/V17__sd_owner_param_trusted_assertion.sql
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
  - specs/contracts/database-ownership-contract.yaml
writeAllowlist:
  - docs/tasks/TASK-0155-p1-11-migrator-runtime-separation-and-schema-readiness.md
  - docs/tasks/context/TASK-0155.context-lock.yaml
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - service/apps/runtime/pom.xml
  - service/apps/runtime/src/main/resources/application.yaml
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/AuthDataSourceConfig.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/SchemaReadinessHealthIndicator.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/web/AuthExceptionHandler.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/ProductionProfileFailClosedTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/config/SchemaReadinessHealthIndicatorTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/web/AuthExceptionHandlerTest.java
  - infra/db/tests/56_runtime_role_cannot_migrate.sql
  - docs/evidence/TASK-0155/**
  - docs/handoffs/TASK-0155.json
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
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/baseline/**
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/modelproviders/**
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/application/**
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/jwt/**
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/tenant/**
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
  - infra/db/tests/54_sd_owner_mismatch_fail_closed.sql
  - infra/db/tests/55_sd_missing_context_fail_closed.sql
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
  - specs/contracts/database-ownership-contract.yaml
  - docs/evidence/TASK-0109/zcode-remediation-handoff.md
  - docs/handoffs/TASK-0154.json
requiredInvariants:
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
    approvedAt: "2026-08-11"
    sourceThreadId: 2c8d4f6a-5e3b-4a9c-8d1f-3b5c7e9a2d4f
    evidence: >-
      Owner 2026-08-11 长线授权继续审计修复（一次一张新卡，无需再问）。本卡 TASK-0155 = P1-11
      （migrator/runtime 分离 + 503 readiness）：显式分离 Flyway migrator datasource 与 runtime
      datasource（应用内 Flyway 以迁移 principal 运行，runtime 以 vc_* 最小权限角色连接）+ 新增
      schema_version readiness gate（健康指示器：必需 SD 函数/运行时角色/schema history 版本，
      失败拒绝业务流量）+ 缺 schema → 503 不伪装 401（AuthExceptionHandler 对未定义对象类 SQL
      错误映射 503 SCHEMA_UNAVAILABLE，其余 DataAccessException 保持既有 401 fail-closed 契约）。
      工程细节（Boot 4.1.0 spring-boot-flyway 装配、VC_FLYWAY_ENABLED/VC_MIGRATOR_DB_* 环境契约、
      production profile 强制）按长线授权由实施者决定并如实记录；禁止历史改写和伪造 PASS。本卡
      不新增 migration、不触碰 .harness/**（C2，无 protected path 命中）；若实测必须新增 migration
      或触碰受保护路径则立即停止并向 Owner 申请升级，不自批。
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
reviewers:
  - id: task0155_r1
    kind: independent-review-gate
    verdict: null
    reviewedCommit: null
    candidateTree: null
    evidencePath: docs/evidence/TASK-0155/review-r1.md
    reason: ""
terminalStateReason: ""
```

> 本卡不在 Backlog 中，不写 `planningBacklog` 或 `planningContractHash`。P1-11 是
> `docs/evidence/TASK-0109/zcode-remediation-handoff.md` §4.2 登记的 OWNER_GATE 审计项，Owner
> 2026-08-11 长线授权已放行。

## 背景与用户可观察目标

P1-11（空库仍启动并健康）当前事实（baseCommit `2ba4829`）：

1. **runtime 应用当前根本不运行 Flyway**：Boot 4.1.0 将 Flyway 自动装配拆到独立
   `spring-boot-flyway` 模块（经 `spring-boot-starter-flyway` 引入），而
   `service/platform/persistence/pom.xml` 只声明 `flyway-core` + `flyway-database-postgresql`
   （无 Boot starter）——`AuthDataSourceConfig` 注释「With a DataSource bean present, Flyway …
   apply the migrations on startup」与实际不符。迁移目前只在 `infra/db/run-rls-tests.sh`
   （psql 直连 postgres 超级用户）等 out-of-band 路径执行。
2. **无显式 `spring.flyway.*` 配置**，无 migrator/runtime principal 分离：唯一的
   `authDataSource`（VC_DB_* 凭据，operator 提供的 LOGIN role）同时是业务连接池。
3. **无 schema readiness 门禁**：`management.endpoint.health` 只暴露默认 indicator，无任何
   HealthIndicator 校验 schema version / 必需函数 / 角色；空库、落后一版、迁移失败时应用仍
   可能「健康」。
4. **缺 schema 伪装 401**：`AuthExceptionHandler` 把所有 `DataAccessException`（含
   `UndefinedFunctionException`/`UndefinedTableException` 等缺 schema 症状）一律映射 401
   `AUTHENTICATION_REQUIRED`——空库时登录请求被当成「认证失败」，运维无法区分。

用户可观察结果（本卡完成后）：

- 显式分离：应用内 Flyway 通过独立 migrator principal（`VC_MIGRATOR_DB_*`）执行 `db/migration`
  迁移；runtime 连接仍走 `VC_DB_*`（vc_* 最小权限语义）。`VC_FLYWAY_ENABLED=false` 时行为与
  现状一致（测试/无库上下文不受影响）；production profile 强制显式声明。
- schema readiness 门禁：新增 `SchemaReadinessHealthIndicator`（auth datasource 启用时生效），
  校验必需 SD 函数（`vc.current_owner_id`、`vc.identity_authenticate`）、4 个 runtime 角色
  （vc_api/vc_worker/vc_job_coordinator/vc_dispatcher）；应用内 Flyway 启用时另校验
  `flyway_schema_history`（缺表/落后于 classpath 最新版本/含失败行 → DOWN）。任何 SQL 异常
  fail-closed → DOWN；`/actuator/health` 对 DOWN 返回 503。
- 缺 schema → 503：未定义函数/表/列类 SQL 错误映射 `503 SCHEMA_UNAVAILABLE`，不再伪装 401；
  其余持久化失败保持既有 401 fail-closed 契约不变。

## 范围内

1. `service/apps/runtime/pom.xml`：新增 `spring-boot-starter-flyway`（激活 Boot 4.1.0 的
   Flyway 自动装配；flyway-core 版本由 spring-boot-starter-parent 托管，不引入第二版本）。
2. `service/apps/runtime/src/main/resources/application.yaml`：
   - 基础块新增 `spring.flyway.*`：`enabled: ${VC_FLYWAY_ENABLED:false}`、
     `url/user/password: ${VC_MIGRATOR_DB_URL:/VC_MIGRATOR_DB_USERNAME:/VC_MIGRATOR_DB_PASSWORD:}`、
     `locations: classpath:db/migration`、`fail-on-missing-locations: true`。
   - `production` profile 块使 `spring.flyway.enabled/url/user/password` 无默认值（缺失即
     占位符解析失败、启动 fail-closed），与既有 RISK-03 强制模式一致。
   - 注释说明 migrator/runtime 分离与环境契约（凭据只经 env/secret 注入，绝不提交）。
3. `AuthDataSourceConfig.java`：
   - 新增 migrator 凭据 fail-fast 校验 bean（`@ConditionalOnProperty(name="spring.flyway.enabled",
     havingValue="true")`）：`VC_MIGRATOR_DB_URL/USERNAME/PASSWORD` 任一空白 → 启动即抛
     `IllegalStateException`（明确提示缺失变量），绝不让 Flyway 用空 URL 静默失败。
   - 新增 `schemaReadinessHealthIndicator` bean（类级条件不变）：注入 runtime
     `JdbcTemplate`、`ObjectProvider<Flyway>`（可缺省）与 classpath 期望版本。
4. 新增 `SchemaReadinessHealthIndicator.java`（`com.virtualcompanion.runtime.auth.config`，
   手工实例化，不组件扫描）：
   - `pg_proc`：`vc.current_owner_id` 与 `vc.identity_authenticate` 各恰存在 1 个 → 否则 DOWN；
   - `pg_roles`：4 个 runtime 角色全部存在 → 否则 DOWN；
   - `Flyway` bean 存在时（应用内迁移已启用）：`to_regclass('flyway_schema_history')` 为 NULL →
     DOWN（schema 不可验证/空库）；`max(version) WHERE success` 小于 classpath 最新迁移版本 →
     DOWN（落后一版）；`count(*) WHERE NOT success` > 0 → DOWN（迁移失败行）；
   - 任一查询抛异常（连接失败等）→ DOWN（fail-closed）；
   - 期望版本来自 classpath `db/migration/V*.sql` 最大版本号（自维护：新增 V18 后自动提升期望）。
5. `AuthExceptionHandler.java`：新增
   `@ExceptionHandler({UndefinedFunctionException.class, UndefinedTableException.class,
   UndefinedColumnException.class})` → `503 SCHEMA_UNAVAILABLE`（固定非敏感消息）；既有
   `DataAccessException → 401 AUTHENTICATION_REQUIRED` 处理保持不变（Spring 按最具体 handler
   优先，未定义对象类先命中 503）。
6. 测试（全部随本卡提交，不删测、不加 skip）：
   - `SchemaReadinessHealthIndicatorTest`（mock JdbcTemplate 矩阵）：UP / 空库（函数缺失）→
     DOWN / 落后一版（history 16 < 17）→ DOWN / 迁移失败行 → DOWN / 角色缺失 → DOWN /
     查询异常 → DOWN / 无 Flyway bean 时仅 marker 检查；
   - `AuthExceptionHandlerTest`：UndefinedFunctionException/UndefinedTableException/
     UndefinedColumnException → 503 SCHEMA_UNAVAILABLE；普通 DataAccessException →
     401 不变；非法参数/不可读 JSON → 400 不变；
   - `ProductionProfileFailClosedTest` 增加 2 个用例：production + flyway enabled 但缺
     `VC_MIGRATOR_DB_URL` → 启动失败且错误链含缺失变量名（fail-fast）；production + flyway
     enabled + migrator 端口不可达（runtime 端口不同）→ 启动失败且错误链含 migrator 主机/端口
     而非 runtime 端口（证明 Flyway 使用独立 migrator datasource）；
   - `infra/db/tests/56_runtime_role_cannot_migrate.sql`（RLS 套件新增第 56 项）：`SET ROLE
     vc_api` 后 CREATE TABLE（vc schema / public schema 的 flyway_schema_history 伪造）、
     CREATE SCHEMA、ALTER ROLE、DROP SCHEMA 全部 `insufficient_privilege` 拒绝（DO 块捕获，
     沿用 test 52 模式）；sanity：vc_api 仍可执行 `vc.current_owner_id()`（SD 路径未破坏）。
7. 迭代验证（不提交脚本）：手动 e2e 用 digest-pinned pgvector 容器 + maven 容器
   `--network host` 实跑两 boot——空库 + flyway off → `/actuator/health` 503 DOWN 且
   `POST /api/v1/auth/login` 返回 503 SCHEMA_UNAVAILABLE（非 401）；同一库 + flyway on →
   V1..V17 干净迁移、health UP、history 版本 17。命令与输出记入 Evidence（供 Reviewer 复跑）。

## 明确范围外

- 不新增/修改任何 migration（V1..V17 全部 forbidden）；不引入 V18（schema_version 依赖
  `flyway_schema_history` + classpath 版本推导，无新 DDL）。
- 不改 `search_path`（RISK-09 = TASK-0158）；不改 RLS policy、角色属性、GRANT/REVOKE。
- 不改 `infra/db/run-rls-tests.sh` 与任何 `.harness/**`、`scripts/harness/**`、`.github/**`
  （不升级 C4）；不新增 e2e 脚本到仓库（手动 e2e 命令写入 Evidence）。
- 不做应用内限流/锁定（P2-03 = TASK-0156）；不动 CI 矩阵（P2-27 = TASK-0157）。
- 不改变连接故障（`CannotGetJdbcConnectionException` 等）→ 401 的既有 fail-closed 契约
  （P1-11 只修「缺 schema/迁移未完成」的伪装，不泛化到网络层故障）。
- 不给 runtime 角色新增任何 schema 管理权限（`flyway_schema_history` 仅 migrator principal 可读，
  readiness 版本检查走 Flyway bean 的 migrator datasource）。
- 不引入 Testcontainers/H2 等新依赖。

## 输入和前置条件

- Base `2ba482966cf3812629c1e8dfd111a798dba9cd96` 是 TASK-0154 单父 ACCEPTED terminal，已 push、
  `HEAD...origin/main=0/0` 且工作树 clean（会话恢复 Doctor PASS，877690 checks）。
- 本卡 context lock 71 个输入全部钉在 Base；provenance 条目
  `owner-authorization://longline-2026-08-09` 带 `provenanceOnly: true`（沿用 Hash
  `cc0f91c1ddad24cb89128002439148384e4af8b6c8d056498ba8814a53580e95`）。
- 受控 Python：`PATH=/Users/hxf/.zcode/venvs/vc-harness/bin:$PATH`；Docker 只用 OrbStack
  （pgvector/pgvector:0.8.5-pg18 digest-pinned；maven:3.9-eclipse-temurin-25-alpine +
  vc-maven-cache）。
- 关键事实（Boot 4.1.0 源码确认）：`spring-boot-flyway` 的 `FlywayAutoConfiguration` 由
  `spring-boot-starter-flyway` 引入；`spring.flyway.url` 存在时 Flyway 用
  `PropertiesFlywayConnectionDetails` 构建**独立** `SimpleDriverDataSource`（与任何应用
  DataSource bean 无关）→ 天然实现 migrator/runtime 分离；`spring.flyway.enabled` 顶层开关
  （`@ConditionalOnBooleanProperty`，默认 true，本卡显式默认 false）。

## API / 事件 / 数据契约

- 产品 API 不变。错误契约新增一条稳定目录码：`SCHEMA_UNAVAILABLE`（503），消息固定非敏感
  （「The service schema is not available; verify migrations are applied」风格），用于未定义
  函数/表/列类 SQL 失败；`AUTHENTICATION_REQUIRED`(401)/`ACCESS_DENIED`(403)/
  `INVALID_REQUEST`(400) 语义不变。
- `/actuator/health`：auth datasource 启用时整体状态受 `SchemaReadinessHealthIndicator`
  影响（DOWN → HTTP 503）；`show-details: never` 不变（细节不外泄）。
- 环境契约新增：`VC_FLYWAY_ENABLED`（默认 false）、`VC_MIGRATOR_DB_URL/USERNAME/PASSWORD`；
  production profile 下四者强制（无默认值）。runtime `VC_DB_*` 契约不变。
- 数据契约：不新增表/函数/角色；`flyway_schema_history` 由 Flyway 在 migrator principal 默认
  schema 创建（postgres 默认 search_path → public），readiness 经 migrator datasource 查询。

## 权限、RLS 和数据处理要求

- runtime 角色（vc_api/vc_worker/vc_job_coordinator/vc_dispatcher）保持 NOBYPASSRLS NOLOGIN；
  不新增任何 GRANT（V1..V17 已冻结）。
- 迁移 principal（migrator datasource）与 runtime principal（业务连接池）物理分离：migrator
  只能被应用内 Flyway 与 readiness 版本检查使用，不进入任何业务查询路径。
- runtime 角色无 DDL/迁移状态篡改能力（test 56 实证）；`vc.identity_*` EXECUTE 仍只授予
  vc_api（V14 不变）。
- 凭据经 env/secret 注入，不落盘、不提交、不记录日志。

## 状态机和失败行为

- `VC_FLYWAY_ENABLED=true` + migrator 凭据缺失 → 启动失败（fail-fast，消息含缺失变量名）。
- `VC_FLYWAY_ENABLED=true` + 迁移失败/DB 不可达 → 应用启动失败（Flyway 在 context refresh 时
  执行，失败即拒绝启动，不伪装健康）。
- auth datasource 启用时：空库/落后一版/迁移失败/角色缺失 → health DOWN → `/actuator/health`
  503；登录/刷新在缺 schema 时 → 503 SCHEMA_UNAVAILABLE（不伪装 401）。
- `VC_FLYWAY_ENABLED=false`（默认）：行为与现状一致（无 Flyway、无版本检查；marker 检查仍
  生效，空库 health DOWN）。
- 正式门禁非 PASS → 停止 promotion，如实 REJECTED 并按失败根因重建新卡；硬熔断 90min 到达 →
  停止实现/修复/门禁，只允许 closure-only overrun。

## 验收标准

1. `service/apps/runtime/pom.xml` 含 `spring-boot-starter-flyway`；`application.yaml` 含
   `spring.flyway.*` 块（enabled 默认 false、locations=classpath:db/migration、
   fail-on-missing-locations=true），production profile 强制 4 个 flyway 属性。
2. `VC_FLYWAY_ENABLED=true` 且缺 migrator 凭据 → 应用启动失败，错误链含缺失变量名
   （`ProductionProfileFailClosedTest` 新用例 PASS）。
3. Flyway 使用独立 migrator datasource：migrator 端口不可达而 runtime 端口不同 → 启动失败
   错误链含 migrator 端口（新用例 PASS，分离证明）。
4. `SchemaReadinessHealthIndicator` 矩阵单测全 PASS：UP / 空库 DOWN / 落后一版 DOWN /
   迁移失败行 DOWN / 角色缺失 DOWN / 查询异常 DOWN / 无 Flyway 仅 marker 检查。
5. `AuthExceptionHandlerTest`：三类未定义对象异常 → 503 SCHEMA_UNAVAILABLE；普通
   DataAccessException → 401 不变；400 路径不变。
6. `infra/db/tests/56_runtime_role_cannot_migrate.sql` 加入 RLS 套件；`bash
   infra/db/run-rls-tests.sh` 真实运行 **56/56 PASS**（55 现有 + 1 新增，无回归）。
7. 手动 e2e（digest-pinned pgvector + maven `--network host`，命令与输出记入 Evidence）：
   空库 + flyway off → health 503 DOWN + login 503 SCHEMA_UNAVAILABLE；同库 + flyway on →
   V1..V17 干净迁移、health UP、`flyway_schema_history` max(version)=17。
8. 唯一根级 Maven verify BUILD SUCCESS（14 模块，docker JDK 25 + vc-maven-cache）。
9. 唯一 canonical precheck 8/8 PASS；唯一无参数 `git diff --check` PASS（输出空）。
10. 终态 pre-closure PASS、单父 `[skip ci]` 提交、push 后 `HEAD==origin/main`、`0/0`、clean；
    remote exact-SHA 如实非 PASS（dispatchCount=0，LOCAL_EXACT_TREE_FALLBACK 冻结于 READY）。

## 必跑检查

以 YAML `requiredCommands` 精确 argv 为准（canonical precheck 只跑一次；RLS 套件与根级 Maven
verify 各一次；同一条无参数 `git diff --check` 只执行一次）。手动 e2e 为迭代验证，不冒充正式
Evidence，但以真实命令输出记录并供 Reviewer 复跑。

## 回滚或前向修复

- 若 Flyway 迁移在干净库失败：如实记录失败，按失败根因修正后重试；不修改 V1..V17。
- 若 R1 发现阻塞项：最多 1 个 fix batch → R2 只验 closure/delta/adjacent risk；R3 禁止。
- 若实测必须新增 migration 或触碰 protected path：立即停止，向 Owner 申请范围升级（自批
  禁止），否则如实 REJECTED 并以新卡承接。

## 停止条件

- writeAllowlist 外路径被修改（含改后恢复）；forbiddenPaths 被触碰（含 V1..V17 迁移、
  .harness/**、scripts/harness/** 等）。
- 正式 Precheck / RLS 套件 / 根级 Maven verify / diff check / pre-closure 任一非 PASS。
- 候选身份（Commit/Tree）变化或越界。
- hardFuseWallMinutes 90 到达：停止实现/修复/Reviewer/canonical/CI，只允许 Evidence/Handoff/
  pre-closure/终态提交/push/远端 0/0 的 closure-only overrun（如实记录时长与根因）。

## Evidence Pack

输出到 `docs/evidence/TASK-0155/`（evidence-pack.json、review-r1.md、pre-closure-request.json），
并生成 `docs/handoffs/TASK-0155.json`。

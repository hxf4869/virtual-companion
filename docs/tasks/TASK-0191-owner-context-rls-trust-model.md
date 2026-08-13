# TASK-0191：P0 owner context/RLS 信任模型修复（owner GUC 域分离密码学绑定）

```yaml
taskId: TASK-0191
state: IN_PROGRESS
owner: repository-owner
riskClass: C4
requiredSkills:
  - task-delivery-flow
  - task-intake
  - database-migration
  - harness-change
requiredSkillVersions:
  task-delivery-flow: "1.3.7"
  task-intake: "1.2.7"
  database-migration: "1.0.0"
  harness-change: "1.1.7"
targetSkillVersions: {}
planningBacklog: null
planningContractHash: null
planningContractHashAlgorithm: null
baseCommit: 3c7fd0b5b306325d51464053e7b3382044c3dd4b
authorizationCommit: 9aa3221a25d4eedc77377ff07d0bfff46a4e7c63
contextFingerprint: 56ca64e24e6fd668fa90bac08c53c6ce133c152a1859a29fdefc79edd1c1756e
contextLock: docs/tasks/context/TASK-0191.context-lock.yaml
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
  riskClass: C4
  surfaceId: TASK_0191_OWNER_CONTEXT_RLS_TRUST_MODEL
  policySurfaces: [AUTHORIZATION]
  distinctCrossRiskSurfaces: 1
  reviewerMinutesEstimate: 15
  terminalCheckMinutesEstimate: 20
  estimatedWallMinutes: 90
  thresholdsTriggered: []
  splitRequired: false
  ownerIndivisibleAuthorization: true
  indivisibleReason: >-
    Owner 2026-08-13 条件批准：修复 P0 owner context/RLS 信任模型且不得只撤销
    begin_job_context（运行时角色仍可直接 SET 普通 GUC）。数据库信任根
    （current_owner_id/RLS predicate/建立入口/运行时适配/测试）必须一次成卡
    原子落地，拆卡会留下 GUC 伪造仍可行的半修复状态。
readAllowlist:
  - .gitattributes
  - AGENTS.md
  - CLAUDE.md
  - requirements-harness.txt
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
  - docs/decisions/0004-identity-session-boundary.md
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
  - docs/tasks/task-card-template.md
  - docs/tasks/TASK-0190-license-inventory-jackson-databind.md
  - docs/tasks/context/TASK-0190.context-lock.yaml
  - docs/evidence/TASK-0190/evidence-pack.json
  - docs/handoffs/TASK-0190.json
  - service/platform/persistence/src/main/resources/db/migration/**
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/**
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/worker/**
  - service/apps/runtime/src/main/resources/application.yaml
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/tenant/**
  - infra/db/run-rls-tests.sh
  - infra/db/tests/**
  - specs/contracts/worker-lease-contract.yaml
  - specs/contracts/identity-session-boundary-contract.yaml
writeAllowlist:
  - service/platform/persistence/src/main/resources/db/migration/V27__owner_context_cryptographic_binding.sql
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/tenant/OwnerContext.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/tenant/OwnerContextTest.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/OwnerBindingSecretBootstrap.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/config/OwnerBindingSecretBootstrapTest.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/AuthDataSourceConfig.java
  - service/apps/runtime/src/main/resources/application.yaml
  - infra/db/tests/01_cross_user_read_denied.sql
  - infra/db/tests/04_stale_worker_fence_denied.sql
  - infra/db/tests/06_authorization_snapshot_isolation.sql
  - infra/db/tests/07_claim_binds_context.sql
  - infra/db/tests/08_expired_lease_zero_write.sql
  - infra/db/tests/09_wrong_token_zero_write.sql
  - infra/db/tests/10_stale_fence_zero_write.sql
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
  - infra/db/tests/40_provider_attempt_rls.sql
  - infra/db/tests/41_generation_terminal_transitions.sql
  - infra/db/tests/42_terminal_event_atomic.sql
  - infra/db/tests/43_candidate_and_quota_release.sql
  - infra/db/tests/44_finalize_finalize_concurrent.sql
  - infra/db/tests/45_finalize_cancel_concurrent.sql
  - infra/db/tests/46_finalize_terminalize_concurrent.sql
  - infra/db/tests/47_candidate_terminal_toctou.sql
  - infra/db/tests/50_realtime_event_catalog.sql
  - infra/db/tests/51_authorization_snapshot_one_way_lifecycle.sql
  - infra/db/tests/52_revoked_runtime_dml_on_business_tables.sql
  - infra/db/tests/54_sd_owner_mismatch_fail_closed.sql
  - infra/db/tests/59_provider_attempt_authorization_snapshot_fk.sql
  - infra/db/tests/60_quota_nonneg_check_and_release_idempotency.sql
  - infra/db/tests/63_worker_runtime_role_claim_complete.sql
  - infra/db/tests/64_worker_coordinator_cross_session_recovery.sql
  - infra/db/tests/65_generation_intake_workitem_promotion.sql
  - infra/db/tests/66_generation_zero_llm_completed_chain.sql
  - infra/db/tests/67_generation_external_attempt_completed_chain.sql
  - infra/db/tests/68_authorization_snapshot_runtime_creation_external_chain.sql
  - infra/db/tests/69_owner_guc_direct_set_fail_closed.sql
  - infra/db/tests/70_owner_forged_binding_denied.sql
  - infra/db/tests/71_begin_job_context_permission_denied.sql
  - infra/db/tests/72_owner_binding_replay_and_legit_path.sql
  - infra/db/tests/73_owner_secret_table_invisible_to_runtime_roles.sql
  - docs/tasks/TASK-0191-owner-context-rls-trust-model.md
  - docs/tasks/context/TASK-0191.context-lock.yaml
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - docs/evidence/TASK-0191/**
  - docs/handoffs/TASK-0191.json
forbiddenPaths:
  - .github/**
  - ci/**
  - frontend/**
  - infra/db/run-rls-tests.sh
  - scripts/harness/**
  - skills/**
  - specs/**
  - mvnw
  - mvnw.cmd
  - pom.xml
  - service/apps/runtime/pom.xml
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
  - service/platform/persistence/src/main/resources/db/migration/V18__sd_search_path_pg_catalog_revoke_public_create.sql
  - service/platform/persistence/src/main/resources/db/migration/V19__admin_seed_concurrency_guard.sql
  - service/platform/persistence/src/main/resources/db/migration/V20__provider_attempt_authorization_snapshot.sql
  - service/platform/persistence/src/main/resources/db/migration/V21__quota_nonneg_check_and_release_idempotency.sql
  - service/platform/persistence/src/main/resources/db/migration/V22__identity_auth_event_retention_purge.sql
  - service/platform/persistence/src/main/resources/db/migration/V23__worker_claim_functions_runtime_api_grant.sql
  - service/platform/persistence/src/main/resources/db/migration/V24__worker_coordinator_functions_runtime_api.sql
  - service/platform/persistence/src/main/resources/db/migration/V25__generation_intake_workitem_promotion.sql
  - service/platform/persistence/src/main/resources/db/migration/V26__authorization_snapshot_runtime_creation.sql
  - docs/decisions/**
  - docs/planning/**
  - docs/schemas/**
  - docs/source/**
  - docs/tasks/task-card-template.md
  - docs/tasks/TASK-0184-realtime-sse-resume-stream.md
  - docs/tasks/TASK-0189-canonical-greenline-restore.md
  - docs/tasks/TASK-0190-license-inventory-jackson-databind.md
  - docs/tasks/context/TASK-0189.context-lock.yaml
  - docs/tasks/context/TASK-0190.context-lock.yaml
  - docs/evidence/TASK-0184/**
  - docs/evidence/TASK-0189/**
  - docs/evidence/TASK-0190/**
  - docs/handoffs/TASK-0184.json
  - docs/handoffs/TASK-0189.json
  - docs/handoffs/TASK-0190.json
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
sourcesOfTruth:
  - AGENTS.md
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - .harness/task-lifecycle.yaml
  - .harness/task-delivery-policy.yaml
  - .harness/ci-execution-policy.yaml
  - .harness/sources-of-truth.yaml
  - .harness/invariants.yaml
  - .harness/protected-paths.yaml
  - .harness/skills.yaml
  - .harness/commands.yaml
  - .harness/license-inventory.yaml
  - .harness/license-policy.yaml
  - docs/decisions/0004-identity-session-boundary.md
  - specs/contracts/worker-lease-contract.yaml
  - specs/contracts/identity-session-boundary-contract.yaml
  - service/platform/persistence/src/main/resources/db/migration/V1__extensions_roles_functions.sql
  - service/platform/persistence/src/main/resources/db/migration/V2__user_domain_ownership.sql
  - service/platform/persistence/src/main/resources/db/migration/V17__sd_owner_param_trusted_assertion.sql
requiredInvariants:
  - INV-TENANT-001
  - INV-WORKER-001
  - INV-HARNESS-001
  - INV-HARNESS-002
  - INV-HARNESS-003
  - INV-HARNESS-005
  - INV-HARNESS-007
humanApprovals:
  - scope: database-migration
    approvedBy: repository-owner
    approvedAt: "2026-08-13"
    sourceThreadId: zcode-audit-20260813
    evidence: >-
      Owner 2026-08-13 条件批准 TASK-0191 安全边界：批准 HMAC 绑定方向，但不
      接受可跨事务复用的静态 HMAC；证明必须使用明确 domain separation，并至少
      绑定 owner、随机 nonce、当前 backend/session 标识和 transaction
      identity；相关 GUC 必须 transaction-local；current_owner_id() 每次重新
      校验，任一字段缺失或不匹配均失败；必须覆盖 proof 跨 owner、跨事务和跨
      连接重放失败。begin_job_context 撤销 PUBLIC 与所有 runtime role，仅保留
      精确 migrator 权限，不得保留任何普通运行时可调用的任意 owner 入口。
      baseCommit=3c7fd0b（TASK-0190 ACCEPTED 终态）；不得修改既有 Flyway
      migration 或历史任务制品；批准后在冻结范围内自主推进。
  - scope: harness-change
    approvedBy: repository-owner
    approvedAt: "2026-08-13"
    sourceThreadId: zcode-audit-20260813
    evidence: >-
      Owner 同一指令授权本卡治理路径（project-state/task-ledger/evidence/
      handoff）的 C4 交付，并授权 bootstrap/config 新文件在首个 READY 前逐路径
      冻结到 writeAllowlist（不得扩大到无关模块）；P2 runtime/migrator 身份
      隔离另卡处理，本卡不得声称已解决应用进程或 migrator 凭据完全失陷；
      完整 discover NOT_RUN 与 34 分钟 CI 预算风险继续如实记录。
independentReview: required
reviewers: []
requiredCommands:
  - PATH=/Users/hxf/.zcode/venvs/vc-harness/bin:$PATH python scripts/harness/precheck.py --task TASK-0191
  - JAVA_HOME=/opt/homebrew/opt/openjdk@25/libexec/openjdk.jdk/Contents/Home ./mvnw --batch-mode --no-transfer-progress -pl service/apps/runtime -am test
  - bash infra/db/run-rls-tests.sh
  - git diff --check
```

> 本卡为独立延续单卡（前一合法终态：TASK-0190 ACCEPTED `3c7fd0b`）。外部审计
> 报告 `/Users/hxf/projects/virtual-companion-audit-20260813-report.md` 为仓库外
> 输入，仅记录 provenance，不进入 Context Lock 可复验路径。

## 只读调查结论（DRAFT 冻结事实）

### 调用链与信任根现状

1. **信任根是会话可写 custom GUC**：`vc.current_owner_id()`
   （`V1__extensions_roles_functions.sql:41-47`）直接读
   `current_setting('vc.owner_user_id', true)`。PostgreSQL 对未注册命名空间
   （`vc.*`）的 custom GUC 无法收回 `SET`/`set_config` 权限——任何数据库会话
   都能 `SET LOCAL vc.owner_user_id = '2'`。
2. **上下文建立入口共 3 个**：Java `OwnerContext.asOwner`（JWT 验证后
   `set_config(..., true)`，`OwnerInjectionFilter` 每请求调用，服务端可信
   路径）；`vc.begin_job_context`（V1:53-73，invoker，PUBLIC EXECUTE 从未
   撤销，任意 owner + 任意非空非 `STALE` fence 即可绑定）；任意会话直接
   `SET LOCAL vc.owner_user_id`（权限模型无法阻止）。
3. **全部下游信任该 GUC**：V2/V5 等 RLS policy
   （`owner_user_id = vc.current_owner_id()`，FORCE RLS）；V17 的 34 个
   SECURITY DEFINER 断言（`p_owner_user_id IS DISTINCT FROM
   vc.current_owner_id()` 即 RAISE）——V17 只是与同一可伪造 GUC 比较。
4. **post-V26 数据库函数内部已无 owner set_config**（V17 全部移除，仅
   claim_work_items 保留 `vc.job_fence`）；Java 无 `begin_job_context`
   调用者。运行时连接 = `VC_DB_USERNAME`（vc_api 成员语义，NOBYPASSRLS）。
5. **测试依赖**：51 个测试直接 `SET LOCAL vc.owner_user_id`（其中 35/45/46
   另用 `set_config`，44/45/46 用 dblink 跨会话 SET）；test 04 以 vc_worker
   调 `begin_job_context` 验证 STALE 拒绝。
6. `pgcrypto` 已由 V8/V14 幂等创建，`hmac()` 可用；PG18 提供
   `pg_backend_pid()` 与 `pg_current_xact_id()`。

### 威胁模型

- **T1（本卡修复）**：持有运行时角色凭据或可注入 SQL 的攻击者在会话内伪造
  任意 owner 上下文（直接 SET GUC / 调 begin_job_context / 伪造 binding）→
  跨租户读写。违反 INV-TENANT-001/INV-WORKER-001 与 ADR-0004 第 3/7 条。
- **T2（本卡缓解）**：纯 SELECT 级 SQL 注入无法为任意 owner 产生有效证明
  （证明需应用侧秘密 + 当前事务/会话标识）。
- **T3（明确范围外，另开 P2 卡）**：应用进程完全失陷（读应用内存/env）或
  持有 migrator/superuser 凭据；数据库无法区分。本卡不宣称解决。

### Owner 已冻结的安全边界设计（2026-08-13 条件批准）

**证明格式（域分离 + 四元绑定）**：
`proof = HMAC-SHA256(K, "vc-owner-binding-v1|" || owner || "|" || pg_backend_pid() || "|" || pg_current_xact_id() || "|" || nonce)`
- K = `VC_OWNER_BINDING_SECRET`（独立随机值 ≥32 字节，**不得**从 VC_DB_PASSWORD
  派生），存于应用 env 与数据库受限表两处；
- nonce = 每次建立的随机数（应用侧 SecureRandom ≥16 字节 hex）；
- 绑定 owner + backend/session 标识（pid）+ transaction identity（xact id）+
  随机 nonce；三个上下文 GUC（`vc.owner_user_id`/`vc.owner_nonce`/
  `vc.owner_binding`）全部 transaction-local（`set_config(..., true)`）。

**V27（append-only，不含任何密钥明文）**：
1. `vc._owner_binding_secret(id int PK, secret text NOT NULL)`：migrator 所有，
   对 PUBLIC 与全部 runtime 角色**零权限**（无 SELECT/UPDATE/DELETE）。
2. 重定义 `vc.current_owner_id()`：SECURITY DEFINER + STABLE，
   `SET search_path = vc, pg_catalog`；每次调用从三个 GUC + 秘密表重新计算
   HMAC 并与 `vc.owner_binding` 比较（owner/pid/txid/nonce 任一缺失或不匹配
   → NULL，fail-closed）。RLS predicate 与 V17 断言零改动自动生效。
3. 新 `vc.set_owner_context(p_owner bigint, p_nonce text, p_proof text)`：
   SECURITY DEFINER；服务端以自身 `pg_backend_pid()`/`pg_current_xact_id()`
   重算期望证明并比较（域分离串在 DB 侧拼接，调用者不可控）；失败即 RAISE；
   成功后绑定三个 transaction-local GUC。REVOKE FROM PUBLIC；GRANT 四个
   runtime 角色。
4. `REVOKE EXECUTE ON FUNCTION vc.begin_job_context(bigint, text) FROM
   PUBLIC, vc_api, vc_worker, vc_job_coordinator, vc_dispatcher`——不保留
   任何普通运行时可调用的任意 owner 入口；函数不重定义不删除（migrator/
   函数 owner 语义冻结）。

**重放矩阵（由绑定四元保证，测试实证）**：跨 owner（proof 绑 owner）、
跨事务（绑 xact id）、跨连接（绑 backend pid）全部失败；直接 SET GUC 无效
（无 K 无法计算 proof，current_owner_id 每次重校验）。

**密钥供给（Owner 调整后契约）**：
- V27 不展开任何原始密钥；受限表初始化由 **migrator 启动阶段**新组件
  `OwnerBindingSecretBootstrap`（writeAllowlist 已冻结）以 **JDBC 参数绑定**
  幂等完成：`INSERT ... ON CONFLICT DO NOTHING` 后读回常量时间比较（不一致
  → 启动失败），在业务流量与 readiness 放行前执行（FlywayMigrationStrategy
  包装，migrator 数据源）。
- production profile：`VC_OWNER_BINDING_SECRET` 无默认值（缺失启动失败）；
  长度 <32 字节启动失败；任何日志/异常不输出密钥或 proof。
- 本地/DB 测试无需该 env（测试以 superuser 计算 fixture 证明；关键断言全部
  在真实 runtime 角色下执行，superuser 仅用于 fixture/setup）。

**运行时适配**：`OwnerContext.asOwner` 在事务内先
`SELECT pg_backend_pid(), pg_current_xact_id()::text`，SecureRandom nonce，
javax.crypto HmacSHA256（无新依赖）计算 proof，改调
`vc.set_owner_context(?, ?, ?)`；异常/日志不含秘密与 proof。

**回滚策略**：Flyway 无 down；前向修复 = 文档化 V28（恢复旧语义），本卡不
预建；紧急回滚 = 旧镜像 + 旧库快照。

### 测试改造（Owner 授权 + 约束下冻结的精确清单）

- **既有 53 个文件**（writeAllowlist 逐路径列出，非 `infra/db/tests/**` 泛
  授权）：51 个 `SET LOCAL vc.owner_user_id` 文件 + 04 + 44；最小机械改造 =
  superuser 在事务内建立上下文（参数化 owner 的合法证明）后 `SET LOCAL
  ROLE` 切真实 runtime 角色执行断言；35/45/46 的 `set_config` 同理替换；
  44/45/46 的 dblink 会话改为「BEGIN → 读 pid/xact → set_owner_context →
  业务调用 → COMMIT」序列；04 的 begin_job_context 段改为预期
  permission denied（SQLSTATE 42501）。
- **新增 5 个测试**：69 直接 SET GUC 失败（含伪造 owner）；70 伪造
  binding/nonce 失败；71 begin_job_context 对全部 runtime 角色 42501；
  72 重放矩阵（跨 owner/事务/连接）+ 合法路径成功 + 跨租户 RLS 隔离保持；
  73 runtime 角色读密钥表 permission denied + 表零权限审计。
- **Java 测试**：OwnerContextTest 更新（proof 计算路径、无秘密泄漏）；
  OwnerBindingSecretBootstrapTest 新增（缺失/过短/不一致 → 启动失败，常量
  时间比较，不泄漏）。

## 范围内

- V27（唯一被写的 migration 文件，无密钥明文）；
- `OwnerContext`/`OwnerContextTest`/`OwnerBindingSecretBootstrap`（新）/
  `OwnerBindingSecretBootstrapTest`（新）/`AuthDataSourceConfig`（接线）/
  `application.yaml`；
- writeAllowlist 列出的 53 个既有 DB 测试机械改造 + 5 个新 DB 测试；
- 本卡治理路径（context/evidence/handoff/project-state/ledger）。

## 明确范围外

- 不修改 V1-V26 任何既有 migration；不修改任何历史任务制品。
- 不做 T3（应用进程失陷/migrator 凭据、runtime principal 强制校验）——审计
  P2 另开任务；本卡不声称解决。
- 不做 P1 lease/fence 业务写入保护（审计 P1-01）与 job_fence 绑定改造。
- 不改 CI workflow、Backlog、lifecycle、前端、specs 契约；不推送远端。

## 状态机和失败行为

- V27 迁移失败、bootstrap 失败（缺失/过短/不一致）→ fail-closed 停止，
  记录真实退出码。
- RLS 容器测试或 mvn test 非 PASS → `maximumFixBatches: 1` 内修复重跑；超出
  即停止询问 Owner。
- 需要 writeAllowlist 外路径时立即停止，另行申请授权。

## 验收标准

1. V27 落地后：直接 SET GUC、伪造 binding、调 begin_job_context 均无法建立
   有效 owner 上下文（69-71/73 实证，断言在真实 runtime 角色下）；重放矩阵
   跨 owner/事务/连接全部失败，合法证明路径成功且跨租户 RLS 隔离保持（72
   实证）；runtime 角色读密钥表 permission denied（73）；密钥缺失/过短/不一
   致启动失败（BootstrapTest 实证）。
2. `requiredCommands` 四条以同一候选 SHA 真实 PASS（真实退出码）；canonical
   precheck 含 licenseCheck 全绿。
3. diff 仅含 writeAllowlist 的 73 路径；V1-V26 与历史任务制品零修改。
4. C4 独立复核 PASS；Evidence/Handoff/project-state nextAction 逐字一致；
   Ledger 追加 TASK-0191。
5. 完整 harness unittest discover 如实 NOT_RUN（CiPolicy 34 分钟 CI 预算
   风险继续保留，不改写为 PASS）。

## 必跑检查

以 YAML `requiredCommands` 的精确 argv 为准。

## Evidence Pack

输出到 `docs/evidence/TASK-0191/`（含 `review-r1.md`），并生成
`docs/handoffs/TASK-0191.json`。

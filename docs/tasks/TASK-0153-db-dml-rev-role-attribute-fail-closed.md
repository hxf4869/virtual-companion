# TASK-0153：DB 授权收紧 + 危险 role 属性纠正（P1-05 + P2-29）

```yaml
taskId: TASK-0153
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
baseCommit: fc8c9b2cb65c50853904e0ab3655889fb0aeb7f2
authorizationCommit: ""
contextFingerprint: fb0956d8aa80848fcb9b5aeee43fcf361113a228f7978248f7e6d300725eb584
contextLock: docs/tasks/context/TASK-0153.context-lock.yaml
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
  surfaceId: TASK_0153_DB_DML_REVOKE_AND_ROLE_ATTRIBUTE_FAIL_CLOSED
  policySurfaces: [DATABASE]
  distinctCrossRiskSurfaces: 1
  reviewerMinutesEstimate: 12
  terminalCheckMinutesEstimate: 35
  estimatedWallMinutes: 60
  thresholdsTriggerled: []
  splitRequired: false
  ownerIndivisibleAuthorization: false
validationPlan: {frozenBefore: READY, policySource: .harness/ci-execution-policy.yaml, selectedChannel: LOCAL_EXACT_TREE_FALLBACK, profile: precheck}
requiredCommands:
  - python scripts/harness/precheck.py --task TASK-0153
  - git diff --check
readAllowlist:
  - AGENTS.md
  - CLAUDE.md
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
  - .harness/tools.lock.yaml
  - docs/tasks/task-card-template.md
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
  - docs/evidence/TASK-0109/zcode-remediation-handoff.md
  - docs/evidence/TASK-0152/review-r1.md
  - docs/evidence/TASK-0152/evidence-pack.json
  - docs/handoffs/TASK-0152.json
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
  - skills/database-migration/SKILL.md
  - scripts/harness/doctor.py
  - scripts/harness/precheck.py
  - scripts/harness/tests/test_harness.py
  - infra/db/run-rls-tests.sh
  - specs/contracts/database-ownership-contract.yaml
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
  - service/apps/runtime/src/main/resources/application.yaml
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/AuthDataSourceConfig.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/JdbcAuthorizationSnapshotStore.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/ConversationRepository.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/MessageRepository.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/WorkItemClaimService.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/FinalizeGenerationService.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/GenerationReceiveService.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/IdentityAccountRepository.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/IdentityRefreshTokenRepository.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/RealtimeEventRepository.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/RealtimeResumeService.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/RealtimeTicketRepository.java
  - pom.xml
  - service/platform/persistence/pom.xml
writeAllowlist:
  - docs/tasks/TASK-0153-db-dml-rev-role-attribute-fail-closed.md
  - docs/tasks/context/TASK-0153.context-lock.yaml
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - service/platform/persistence/src/main/resources/db/migration/V16__revoke_business_dml_correct_role_attributes.sql
  - infra/db/tests/02_cross_relationship_reference_denied.sql
  - infra/db/tests/03_cross_conversation_reference_denied.sql
  - infra/db/tests/05_missing_context_fail_closed.sql
  - infra/db/tests/15_cross_owner_generation_reference_denied.sql
  - infra/db/tests/19_realtime_ticket_single_use_ttl_hash.sql
  - infra/db/tests/50_realtime_event_catalog.sql
  - infra/db/tests/51_authorization_snapshot_one_way_lifecycle.sql
  - infra/db/tests/52_revoked_runtime_dml_on_business_tables.sql
  - infra/db/tests/53_role_attributes_fail_closed.sql
  - docs/evidence/TASK-0153/**
  - docs/handoffs/TASK-0153.json
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
  - service/**/safety/**
  - service/**/memory/**
  - service/**/modelruntime/**
  - service/apps/**
  - service/modules/**
  - service/adapters/**
  - service/tests/**
  - service/platform/catalog/**
  - service/platform/persistence/src/main/java/**
  - frontend/**
  - infra/db/run-rls-tests.sh
  - infra/db/tests/01_cross_user_read_denied.sql
  - infra/db/tests/04_stale_worker_fence_denied.sql
  - infra/db/tests/06_authorization_snapshot_isolation.sql
  - infra/db/tests/07_claim_binds_context.sql
  - infra/db/tests/08_zero_write_on_stale_fence.sql
  - infra/db/tests/09_zero_write_on_wrong_token.sql
  - infra/db/tests/10_zero_write_on_expired_lease.sql
  - infra/db/tests/11_zero_write_on_missing_context.sql
  - infra/db/tests/12_coordinator_reads_only_metadata.sql
  - infra/db/tests/13_idempotent_receive_same_generation_id.sql
  - infra/db/tests/14_idempotent_receive_no_duplicate_message.sql
  - infra/db/tests/16_atomic_finalize_or_rollback.sql
  - infra/db/tests/17_fault_injection_atomicity.sql
  - infra/db/tests/18_provider_eos_never_completes.sql
  - infra/db/tests/20_resume_continuous_only.sql
  - infra/db/tests/21_resume_gap_reset.sql
  - infra/db/tests/22_resume_reset_required_epoch.sql
  - infra/db/tests/23_resume_snapshot_replaces_draft.sql
  - infra/db/tests/24_resume_terminal_snapshot.sql
  - infra/db/tests/25_realtime_event_rls_owner_isolation.sql
  - infra/db/tests/26_relationship_create.sql
  - infra/db/tests/27_relationship_unique_active_companion.sql
  - infra/db/tests/28_relationship_activate_deactivate.sql
  - infra/db/tests/29_relationship_cross_owner_denied.sql
  - infra/db/tests/30_generation_cancel.sql
  - infra/db/tests/31_message_history_pagination.sql
  - infra/db/tests/32_memory_candidate_requires_confirmation.sql
  - infra/db/tests/33_memory_candidate_cross_owner_denied.sql
  - infra/db/tests/34_memory_lifecycle_evidence_scope.sql
  - infra/db/tests/35_memory_edit_evidence.sql
  - infra/db/tests/36_memory_delete.sql
  - infra/db/tests/37_memory_delete_recall_tombstone.sql
  - infra/db/tests/38_memory_recall_tombstone_determinism.sql
  - infra/db/tests/39_identity_accounts_sessions.sql
  - infra/db/tests/40_provider_attempt_rls.sql
  - infra/db/tests/41_generation_terminal_transitions.sql
  - infra/db/tests/42_terminal_event_atomic.sql
  - infra/db/tests/43_candidate_and_quota_release.sql
  - infra/db/tests/44_finalize_concurrent_single_final.sql
  - infra/db/tests/45_finalize_cancel_concurrent.sql
  - infra/db/tests/46_finalize_terminalize_concurrent.sql
  - infra/db/tests/47_candidate_terminal_toctou.sql
  - infra/db/tests/48_refresh_rotate_concurrent.sql
  - infra/db/tests/49_realtime_seq_concurrent.sql
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
  - docs/evidence/TASK-0109/zcode-remediation-handoff.md
  - docs/evidence/TASK-0152/review-r1.md
  - docs/handoffs/TASK-0152.json
requiredInvariants:
  - INV-TENANT-001
  - INV-WORKER-001
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
      Owner 2026-08-11 长线授权数据库 gates 按推荐方案执行：P1-04/05（服务端可信 +
      窄 SECURITY DEFINER）+ P2-29（启动失败关闭）+ P1-11（显式分离 + 503 readiness）
      + P2-03（应用内限流 + 锁定），一次一张新卡。本卡 TASK-0153 = P1-05（撤销核心
      业务状态表的宽泛 DML grants，保留只读 SELECT，只暴露状态机窄函数路径）+ P2-29
      （对预置危险 role 属性 LOGIN/BYPASSRLS 在 V16 迁移时强制纠正为 NOBYPASSRLS
      NOLOGIN 并断言失败关闭）。经 complexityGate 评估，P1-04（SD 函数 owner 参数收敛）
      拆为后续 TASK-0154 独立卡。本卡单 surface（DB migration），C4 database-migration
      + humanApproval(scope: database-migration)。范围含重构现有 test 50/51（原依赖
      vc_api 宽泛 DML 直接 INSERT 测约束，V16 REVOKE 后改用超级用户 RESET ROLE 做
      INSERT/UPDATE 测约束，vc_api role 只用于 SELECT/EXECUTE 权限验证）。禁止历史
      改写和伪造 PASS；工程细节按长线授权决定并如实记录。
  - scope: database-migration
    approvedBy: repository-owner
    approvedAt: "2026-08-11"
    sourceThreadId: 2c8d4f6a-5e3b-4a9c-8d1f-3b5c7e9a2d4f
    evidence: >-
      Owner 2026-08-11 授权本卡新增 V16 migration（C4 protected path **/db/migration/**
      要求 database-migration 1.0.0 + humanApproval + 独立 Reviewer）。V16 不修改
      V1-V15 已执行迁移；只 REVOKE 业务状态表 DML + ALTER ROLE 强制 NOBYPASSRLS NOLOGIN
      + 断言。新增 2 个 SQL 测试（52/53）；重构 7 个现有测试（02/03/05/15/19/50/51）：
      原 SET ROLE vc_api 直接 INSERT 业务表期望 RLS/FK/CHECK 拒绝的断言，V16 REVOKE 后
      会先被 permission denied 拒绝；修复方式为扩展 EXCEPTION 捕获 insufficient_privilege
      或把 INSERT 改到超级用户（保留 RLS 断言的用 vc_api SELECT）。不触碰 search_path、
      不分离 migrator/runtime、不改 SD 函数签名。工程细节按长线授权决定并如实记录。
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
```

## 背景

P1-05（runtime roles 直写绕过状态机）与 P2-29（V1 不纠正危险 role 属性）是 48 项审计总表
的 OWNER_GATE 项，真实业务/HTTP 接线前阻断。Owner 2026-08-11 授权数据库 gates 按推荐方案
执行，经 complexityGate 评估 P1-04（SD owner 参数收敛）拆为后续 TASK-0154。

**当前事实（baseCommit fc8c9b2）：**

- V2/V3/V7/V8/V15 对 4 个 runtime role（vc_api/vc_worker/vc_job_coordinator/vc_dispatcher）
  宽泛 `GRANT SELECT,INSERT,UPDATE,DELETE` 17 张业务状态表。V5 work_item 与 V14 identity
  已收紧。
- V1 角色 `IF NOT EXISTS CREATE ROLE ... NOBYPASSRLS NOLOGIN`：不纠正预置危险属性。
- 现有 test 50/51 用 `SET ROLE vc_api` 直接 INSERT realtime_event/authorization_snapshot
  测 catalog/CHECK 约束与单向生命周期。V16 REVOKE 后这些 INSERT 会 permission denied，
  需重构：约束测试改用超级用户（RESET ROLE）INSERT，RLS 隔离测试保留 vc_api SELECT。
- ConversationRepository/MessageRepository/JdbcAuthorizationSnapshotStore 在 runtime 未装配，
  本卡不改 Java（Handoff remaining item 记录）。

## 目标

收紧数据库授权边界，使 runtime role 只能通过 SECURITY DEFINER 状态机函数写业务状态，
直接 DML 全部被拒绝；并使任何预置危险 role 属性在 V16 迁移时被强制纠正并断言失败关闭。

## 范围

### in

1. 新增 `V16__revoke_business_dml_correct_role_attributes.sql`：
   - **P2-29**：对 4 个 runtime role 执行 `ALTER ROLE ... NOBYPASSRLS NOLOGIN`；DO 块断言
     `rolbypassrls=false AND rolcanlogin=false`，违反 RAISE EXCEPTION。
   - **P1-05**：`REVOKE INSERT, UPDATE, DELETE ON` 17 张业务状态表 FROM 4 个 runtime role，
     保留 SELECT：V2 表(10) + V3 表(1) + V7 表(4) + V8 表(2) + V15 表(1)。
2. 新增 `infra/db/tests/52_revoked_runtime_dml_on_business_tables.sql`：`SET ROLE vc_api`
   后尝试直接 INSERT/UPDATE/DELETE 各类业务表，断言每条 `insufficient_privilege`；SELECT 仍可用。
3. 新增 `infra/db/tests/53_role_attributes_fail_closed.sql`：断言 4 个 runtime role
   `rolbypassrls=false AND rolcanlogin=false`；验证 V16 断言逻辑对污染 role 会 RAISE。
4. 重构 `infra/db/tests/50_realtime_event_catalog.sql`：将"直接 INSERT realtime_event 测
   catalog CHECK 约束"部分改为超级用户（不 SET ROLE vc_api 或 RESET ROLE）INSERT，使
   INSERT 能到达 CHECK 约束；vc_api role 仍用于验证 append_realtime_event 函数权限和
   append_terminal_event 拒绝。catalog CHECK 约束语义不变。
5. 重构 `infra/db/tests/51_authorization_snapshot_one_way_lifecycle.sql`：将直接 INSERT/UPDATE
   authorization_snapshot 测单向生命周期/并发的部分改为超级用户（RESET ROLE 或不 SET ROLE）
   INSERT/UPDATE；RLS 跨 owner 隔离验证（Phase 5）保留用 vc_api SELECT（只读权限保留）。
   单向生命周期/unique/resurrection/并发 row lock 语义不变。
6. 重构 5 个现有测试（02/03/05/15/19）的"SET ROLE vc_api 直接 INSERT 业务表期望 RLS/FK
   拒绝"断言：V16 REVOKE 后这些 INSERT 会先被 permission denied 拒绝（而非 RLS WITH CHECK
   或 FK）。修复方式：把 EXCEPTION 子句扩展捕获 `insufficient_privilege`，或把 INSERT 改
   到 `SET ROLE vc_api` 之前用超级用户做（保留 RLS 断言的用 vc_api SELECT）。原断言语义
   （跨引用拒绝、缺 context 拒绝、跨 owner 拒绝、TTL 过期）不变。

### out

- 不改 SD 函数签名或 owner 绑定（P1-04，TASK-0154）。
- 不改 Java（未接线；Handoff remaining item 记录）。
- 不动 work_item / identity 表 grants（V5/V14 已收紧）。
- 不改 search_path（RISK-09，TASK-0158）。
- 不分离 migrator/runtime（P1-11，TASK-0155）。
- 不改 V1-V15 已执行 migration。

## 权限、RLS 和数据处理要求

- FORCE RLS 保持不变（V16 只 REVOKE DML，不动 RLS policy）。
- runtime role 保持 NOBYPASSRLS（V16 ALTER 强制 + 断言）。
- SECURITY DEFINER 函数的 EXECUTE grant 保持不变。
- provider_attempt 的 sequence grant 保留。

## 状态机和失败行为

- V16 迁移中若任一 runtime role 仍是 LOGIN 或 BYPASSRLS，DO 块断言 RAISE EXCEPTION。
- V16 后 runtime role 直接 INSERT/UPDATE/DELETE 业务表返回 permission denied。
- 现有 test 50/51 重构后仍验证原语义（catalog CHECK / 单向生命周期），用超级用户做写操作。
- 正式 Precheck 非 PASS → REJECTED。R1 阻塞 → 最多 1 fix batch → R2。超 hardFuse 90min 停止。

## 验收标准

1. V16 存在且 Flyway 全迁移 V1..V16 成功。
2. V16 后 4 个 runtime role `rolbypassrls=false AND rolcanlogin=false`（test 53）。
3. V16 后 runtime role 对 17 张业务表 INSERT/UPDATE/DELETE 全部 permission denied（test 52）；
   SELECT 不受影响。
4. test 50 重构后仍验证 catalog CHECK 拒绝 unknown/non-durable event type（通过超级用户
   INSERT 触发 check_violation）；append_realtime_event/append_terminal_event 权限语义不变。
5. test 51 重构后仍验证单向生命周期（unique、ACTIVE→WITHDRAWN/NARROWED 终态、resurrection
   拒绝、并发 row lock 互斥、跨 owner RLS 隔离）。
6. 现有其他 49 个 SQL 测试全部 PASS（无回归）。
7. 根级 Maven verify BUILD SUCCESS。
8. canonical precheck 8 命令 PASS；完整 Harness unittest PASS；唯一 git diff --check PASS。

## 必跑检查

- `python scripts/harness/precheck.py --task TASK-0153`
- `git diff --check`

## 回滚或前向修复

- V16 是前向 migration，不回滚。若 R1 发现 REVOKE 误伤合法路径，新增 V17 补 grant 或补窄 SD
  函数（留 TASK-0154 范畴）。

## 停止条件

- writeAllowlist 外路径被修改。
- forbiddenPaths 被触碰。
- V16 迁移在干净库上失败。
- 现有其他 49 个 SQL 测试出现非 V16 相关回归。
- 候选身份变化或越界。
- 超出 hardFuseWallMinutes 90。

## Evidence Pack

输出到 `docs/evidence/TASK-0153/`，并生成 `docs/handoffs/TASK-0153.json`。

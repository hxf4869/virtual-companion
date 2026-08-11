# TASK-0154：SD 函数 owner 参数服务端可信收敛（P1-04）

```yaml
taskId: TASK-0154
state: IN_PROGRESS
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
baseCommit: 2c97bad86ce655cc98f5bc70ad99907ab8a2bd16
authorizationCommit: "0b73b2fd2dbf6ce1cbd7de260a8403aa05d63d63"
contextFingerprint: 0372e2f45e916a3cb63dab273f27c5450292368d77495f1facb391cbdd5bee6f
contextLock: docs/tasks/context/TASK-0154.context-lock.yaml
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
  surfaceId: TASK_0154_SD_OWNER_PARAM_TRUSTED_ASSERTION
  policySurfaces: [DATABASE]
  distinctCrossRiskSurfaces: 1
  reviewerMinutesEstimate: 14
  terminalCheckMinutesEstimate: 35
  estimatedWallMinutes: 60
  thresholdsTriggerled: []
  splitRequired: false
  ownerIndivisibleAuthorization: false
validationPlan: {frozenBefore: READY, policySource: .harness/ci-execution-policy.yaml, selectedChannel: LOCAL_EXACT_TREE_FALLBACK, profile: precheck}
requiredCommands:
  - python scripts/harness/precheck.py --task TASK-0154
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
  - docs/evidence/TASK-0153/review-r1.md
  - docs/evidence/TASK-0153/evidence-pack.json
  - docs/handoffs/TASK-0153.json
  - docs/tasks/TASK-0153-db-dml-rev-role-attribute-fail-closed.md
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
  - service/platform/persistence/src/main/resources/db/migration/V16__revoke_business_dml_correct_role_attributes.sql
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
  - docs/tasks/TASK-0154-sd-owner-param-trusted-assertion.md
  - docs/tasks/context/TASK-0154.context-lock.yaml
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - service/platform/persistence/src/main/resources/db/migration/V17__sd_owner_param_trusted_assertion.sql
  - infra/db/tests/07_claim_binds_context.sql
  - infra/db/tests/13_idempotent_receive_same_generation_id.sql
  - infra/db/tests/14_idempotent_receive_no_duplicate_message.sql
  - infra/db/tests/44_finalize_finalize_concurrent.sql
  - infra/db/tests/45_finalize_cancel_concurrent.sql
  - infra/db/tests/46_finalize_terminalize_concurrent.sql
  - infra/db/tests/47_candidate_terminal_toctou.sql
  - infra/db/tests/49_realtime_seq_concurrent.sql
  - infra/db/tests/35_memory_edit_evidence.sql
  - infra/db/tests/54_sd_owner_mismatch_fail_closed.sql
  - infra/db/tests/55_sd_missing_context_fail_closed.sql
  - docs/evidence/TASK-0154/**
  - docs/handoffs/TASK-0154.json
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
  - service/platform/persistence/src/main/resources/db/migration/V16__revoke_business_dml_correct_role_attributes.sql
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
  - infra/db/tests/02_cross_relationship_reference_denied.sql
  - infra/db/tests/03_cross_conversation_reference_denied.sql
  - infra/db/tests/04_stale_worker_fence_denied.sql
  - infra/db/tests/05_missing_context_fail_closed.sql
  - infra/db/tests/06_authorization_snapshot_isolation.sql
  - infra/db/tests/08_expired_lease_zero_write.sql
  - infra/db/tests/09_wrong_token_zero_write.sql
  - infra/db/tests/10_stale_fence_zero_write.sql
  - infra/db/tests/11_zero_write_on_missing_context.sql
  - infra/db/tests/12_coordinator_reads_only_metadata.sql
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
  - infra/db/tests/36_memory_idempotency.sql
  - infra/db/tests/37_memory_recall_scope_budget.sql
  - infra/db/tests/38_memory_recall_tombstone_determinism.sql
  - infra/db/tests/39_identity_accounts_sessions.sql
  - infra/db/tests/40_provider_attempt_rls.sql
  - infra/db/tests/41_generation_terminal_transitions.sql
  - infra/db/tests/42_terminal_event_atomic.sql
  - infra/db/tests/43_candidate_and_quota_release.sql
  - infra/db/tests/48_refresh_rotate_concurrent.sql
  - infra/db/tests/50_realtime_event_catalog.sql
  - infra/db/tests/51_authorization_snapshot_one_way_lifecycle.sql
  - infra/db/tests/52_revoked_runtime_dml_on_business_tables.sql
  - infra/db/tests/53_role_attributes_fail_closed.sql
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
  - docs/evidence/TASK-0153/review-r1.md
  - docs/handoffs/TASK-0153.json
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
      Owner 2026-08-11 长线授权继续审计修复（一次一张新卡）。本卡 TASK-0154 = P1-04（SD 函数
      owner 参数服务端可信收敛）：V17 对所有 34 个含 p_owner_user_id 的 SECURITY DEFINER 函数
      加 owner 一致性断言并移除函数内部 set_config('vc.owner_user_id')（强模式 fail-closed：
      p_owner_user_id IS NULL OR p_owner_user_id IS DISTINCT FROM vc.current_owner_id() → RAISE），
      context 改由服务端可信路径预设（未来 runtime request filter / SET LOCAL）。
      保留参数签名（Java 调用点不改签名）。重构 9 个受影响的现有测试加 SET LOCAL/set_config
      vc.owner_user_id 前置（07/13/14/35/44/45/46/47/49；其中 35 的超级用户 DO 块用 set_config
      模拟可信 context）。新增 2 个 caller-mismatch / missing-context 负测（54/55）。
      claim_work_items 保留 set_config('vc.job_fence')，仅移除 owner set_config。
      禁止历史改写和伪造 PASS；工程细节按长线授权决定并如实记录。
  - scope: database-migration
    approvedBy: repository-owner
    approvedAt: "2026-08-11"
    sourceThreadId: 2c8d4f6a-5e3b-4a9c-8d1f-3b5c7e9a2d4f
    evidence: >-
      Owner 2026-08-11 授权本卡新增 V17 migration（C4 protected path **/db/migration/** 要求
      database-migration 1.0.0 + humanApproval + 独立 Reviewer）。V17 不修改 V1-V16 已执行迁移；
      只用 CREATE OR REPLACE FUNCTION 重定义 34 个 SD 函数（加 owner 一致性断言 + 移除内部
      set_config owner），不破坏 Flyway checksum。断言模式经 Owner 确认为强模式 fail-closed
      （IS DISTINCT FROM，含 NULL 拒绝），符合 TASK-0109 handoff「缺 context 应拒绝」要求。
      不触碰 search_path、不分离 migrator/runtime、不改 RLS policy、不改表结构。工程细节按
      长线授权决定并如实记录。
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

P1-04（caller 可伪造 owner context）是 48 项审计总表的 OWNER_GATE 项。TASK-0153 handoff
remaining 记录：「~34 个 SECURITY DEFINER 函数仍接收 p_owner_user_id 并用它 set_config，
caller 可伪造」。Owner 2026-08-11 长线授权后，TASK-0153 完成 P1-05 + P2-29，本卡接续处理 P1-04。

**当前事实（baseCommit 2c97bad）：**

- 34 个 SECURITY DEFINER 函数接收 `p_owner_user_id` 参数，内部 `PERFORM set_config('vc.owner_user_id',
  p_owner_user_id::text, true)` —— caller 可传任意值伪造 owner context。
- `vc.current_owner_id()` 在 V1 已定义（`NULLIF(current_setting('vc.owner_user_id', true), '')::bigint`）。
- 现有测试两种模式：约 28 个测试预设 `SET LOCAL vc.owner_user_id`（memory/relationship/realtime-resume/
  finalize 大部分），8 个不预设（07/13/14/44/45/46/47/49）依赖函数内部 set_config。
- TASK-0109 handoff 第 4.1 节明确修复要求：「函数参数必须与 server-trusted context 一致，不能
  覆盖它」「缺 context、伪造 context、owner/argument mismatch 均应拒绝」。

## 目标

使所有 34 个 SD 函数不再信任 caller 传入的 `p_owner_user_id` 作为 owner 真源：函数移除内部
`set_config('vc.owner_user_id')`，改为验证 `p_owner_user_id` 与服务端可信的 `vc.current_owner_id()`
一致；缺 context（NULL）或参数不一致立即 RAISE。owner context 由可信路径（runtime request filter
/ 测试的 SET LOCAL）在调用前预设。

## 范围

### in

1. 新增 `V17__sd_owner_param_trusted_assertion.sql`：用 `CREATE OR REPLACE FUNCTION` 重定义
   以下 34 个 SD 函数。每个函数：
   - 开头加断言：
     ```sql
     IF p_owner_user_id IS NULL THEN
         RAISE EXCEPTION 'p_owner_user_id is required';
     END IF;
     IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
         RAISE EXCEPTION 'p_owner_user_id does not match server-trusted current_owner_id';
     END IF;
     ```
   - 移除 `PERFORM set_config('vc.owner_user_id', p_owner_user_id::text, true);`
   - 保留其余所有逻辑（参数验证、业务、返回）不变
   - **claim_work_items 例外**：保留 `PERFORM set_config('vc.job_fence', p_fence, true);`
     （fence 仍由函数绑定，仅移除 owner set_config）

   34 个函数清单（按 migration）：
   - V5：claim_work_items
   - V6：receive_generation
   - V7：finalize_generation
   - V8：ensure_realtime_stream, append_realtime_event, advance_realtime_seq,
     append_terminal_event, expire_realtime_window, reset_stream_epoch,
     issue_realtime_ticket, consume_realtime_ticket, resume_stream, read_generation_snapshot
   - V9：create_relationship, get_relationship, list_relationships, activate_relationship,
     deactivate_relationship
   - V10：cancel_generation, list_messages
   - V11：create_memory_candidate, confirm_memory_candidate, reject_memory_candidate,
     delete_memory, list_memory, get_memory
   - V12：update_memory, list_memory_evidence, delete_memory（V12 版）
   - V13：recall_memory
   - V15：record_provider_attempt, terminalize_generation, insert_generation_candidate,
     record_quota_release

2. 重构 8 个现有测试，在 `SET ROLE vc_*` 后、调用 SD 函数前加 `SET LOCAL vc.owner_user_id = 'X';`
   前置（与已有 28 个测试模式一致）：
   - `07_claim_binds_context.sql`（claim_work_items，vc_worker，owner=1）
   - `13_idempotent_receive_same_generation_id.sql`（receive_generation，vc_api，owner=1）
   - `14_idempotent_receive_no_duplicate_message.sql`（receive_generation，vc_api，owner=1）
   - `44_finalize_finalize_concurrent.sql`（finalize_generation/insert_generation_candidate）
   - `45_finalize_cancel_concurrent.sql`（finalize_generation/cancel_generation/insert_generation_candidate）
   - `46_finalize_terminalize_concurrent.sql`（finalize_generation/insert_generation_candidate/terminalize_generation）
   - `47_candidate_terminal_toctou.sql`（insert_generation_candidate/terminalize_generation）
   - `49_realtime_seq_concurrent.sql`（append_realtime_event/advance_realtime_seq）

3. 新增 `infra/db/tests/54_sd_owner_mismatch_fail_closed.sql`：`SET LOCAL vc.owner_user_id='1'`，
   调用代表性 SD 函数（receive_generation/create_relationship/create_memory_candidate 等跨 V5-V15）
   传 `p_owner_user_id=2`（与 context 不一致），断言每个 RAISE EXCEPTION。
4. 新增 `infra/db/tests/55_sd_missing_context_fail_closed.sql`：不预设 context（current_owner_id()
   返回 NULL），调用代表性 SD 函数传非 NULL p_owner_user_id，断言每个 RAISE EXCEPTION。

### out

- 不改 Java（handoff 明确「保留参数，Java 调用点不改签名」；Repository 在 runtime 未装配）。
- 不改 V1-V16 已执行 migration（V17 只 CREATE OR REPLACE，不破坏 Flyway checksum）。
- 不改 search_path（RISK-09，TASK-0158）。
- 不分离 migrator/runtime（P1-11，TASK-0155）。
- 不改 RLS policy、表结构、GRANT/REVOKE（TASK-0153 已处理）。
- 不改 begin_job_context（V1，非 SECURITY DEFINER，不在 34 清单）。

## 权限、RLS 和数据处理要求

- FORCE RLS 保持不变（V17 只改函数体逻辑，不动 RLS policy）。
- runtime role 保持 NOBYPASSRLS（TASK-0153 V16 ALTER + 断言）。
- SECURITY DEFINER 函数的 EXECUTE grant 保持不变。
- `set_config('vc.job_fence')` 在 claim_work_items 保留（fence 绑定语义不变）。

## 状态机和失败行为

- V17 后 SD 函数要求 `vc.owner_user_id` 已由可信路径设置（非 NULL）且与 `p_owner_user_id` 一致；
  否则 RAISE EXCEPTION（fail-closed）。
- V17 后未预设 context 调用 SD 函数 → RAISE（test 55 验证）。
- V17 后 context 与参数不一致 → RAISE（test 54 验证）。
- 8 个重构测试加 `SET LOCAL` 前置后，调用流程与现有 28 个测试模式一致。
- 正式 Precheck 非 PASS → REJECTED。R1 阻塞 → 最多 1 fix batch → R2。超 hardFuse 90min 停止。

## 验收标准

1. V17 存在且 Flyway 全迁移 V1..V17 成功。
2. V17 后 34 个 SD 函数均含 owner 一致性断言，且移除了内部 `set_config('vc.owner_user_id')`
   （claim_work_items 保留 fence set_config）。
3. 8 个重构测试（07/13/14/44/45/46/47/49）加 `SET LOCAL vc.owner_user_id` 前置后仍 PASS。
4. 新增 test 54：context=1 + param=2 → 所有被测 SD 函数 RAISE（caller-mismatch fail-closed）。
5. 新增 test 55：无 context + param 非 NULL → 所有被测 SD 函数 RAISE（missing-context fail-closed）。
6. 其余 53 个现有 SQL 测试全部 PASS（无回归）。
7. 根级 Maven verify BUILD SUCCESS。
8. canonical precheck 8 命令 PASS；完整 Harness unittest PASS；唯一 git diff --check PASS。

## 必跑检查

- `python scripts/harness/precheck.py --task TASK-0154`
- `git diff --check`

## 回滚或前向修复

- V17 是前向 migration，不回滚。若 R1 发现断言误伤合法路径，新增 V18 调整（不改 V17）。
- 若发现遗漏的受影响测试（IN_PROGRESS 后才暴露），立即停止并评估是否需 Owner amendment
  扩范围，不自批。

## 停止条件

- writeAllowlist 外路径被修改。
- forbiddenPaths 被触碰。
- V17 迁移在干净库上失败。
- 现有其他 SQL 测试出现非 V17 相关回归。
- 候选身份变化或越界。
- 超出 hardFuseWallMinutes 90。

## Evidence Pack

输出到 `docs/evidence/TASK-0154/`，并生成 `docs/handoffs/TASK-0154.json`。

# TASK-0194：P1 worker lease/fence 墙钟生效、外部调用事务边界与失败热循环收敛

```yaml
taskId: TASK-0194
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
planningBacklog: null
planningContractHash: null
planningContractHashAlgorithm: null
baseCommit: fb9cf0e178212d6ff554abf7d4695aa114fe0dba
contextFingerprint: a43067c641a910de33da5c78e2e574fc0103cd0eb769b68445907b652c6140a2
contextLock: docs/tasks/context/TASK-0194.context-lock.yaml
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
  surfaceId: TASK_0194_WORKER_LEASE_FENCE_TX_BOUNDARY
  policySurfaces: [AUTHORIZATION]
  distinctCrossRiskSurfaces: 1
  reviewerMinutesEstimate: 15
  terminalCheckMinutesEstimate: 20
  estimatedWallMinutes: 90
  thresholdsTriggered: [reviewerMinutesGreaterThan15, terminalCheckMinutesGreaterThan20, estimatedWallMinutesGreaterThan90]
  splitRecommended: true
  splitProposal: TASK-0194 承载不可分割的事务模型/墙钟 lease/业务写 fence guard 基座；bounded retry/dead-letter 列为串行后续卡 TASK-0195（本轮不创建）
  ownerIndivisibleAuthorization: true
  indivisibleReason: >-
    事务拆分（claim 提交释放行锁）一旦落地就使 coordinator 可接管同一 work item，必须与
    业务写 fence/lease/token guard 同卡生效，否则会把当前"未证实的 split-brain"变成真实
    split-brain；墙钟 lease 仅在 claim 提交后才有意义；外部调用移出事务依赖前两者。因此
    事务拆分 + 墙钟 lease + fence guard + 外部审计独立持久化 + 独立新事务 fail 构成一个
    不可分割的安全基座，缺任一项都会引入比现状更严重的回归。
readAllowlist:
  - .gitattributes
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
  - AGENTS.md
  - CLAUDE.md
  - docs/decisions/0004-identity-session-boundary.md
  - docs/evidence/TASK-0193/evidence-pack.json
  - docs/evidence/TASK-0193/inherited-manifest.json
  - docs/evidence/TASK-0193/review-r1.md
  - docs/handoffs/TASK-0193.json
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
  - docs/tasks/TASK-0193-p0-owner-context-rls-inherited-adoption.md
  - docs/tasks/context/TASK-0193.context-lock.yaml
  - docs/tasks/task-card-template.md
  - infra/db/run-rls-tests.sh
  - infra/db/tests/04_stale_worker_fence_denied.sql
  - infra/db/tests/05_missing_context_fail_closed.sql
  - infra/db/tests/06_authorization_snapshot_isolation.sql
  - infra/db/tests/07_claim_binds_context.sql
  - infra/db/tests/08_expired_lease_zero_write.sql
  - infra/db/tests/09_wrong_token_zero_write.sql
  - infra/db/tests/10_stale_fence_zero_write.sql
  - infra/db/tests/11_missing_context_zero_write.sql
  - infra/db/tests/12_coordinator_reads_only_metadata.sql
  - infra/db/tests/16_atomic_finalize_commits_all.sql
  - infra/db/tests/17_fault_injection_rolls_back_all.sql
  - infra/db/tests/18_provider_eos_cannot_complete.sql
  - infra/db/tests/30_generation_cancel.sql
  - infra/db/tests/40_provider_attempt_rls.sql
  - infra/db/tests/41_generation_terminal_transitions.sql
  - infra/db/tests/42_terminal_event_atomic.sql
  - infra/db/tests/43_candidate_and_quota_release.sql
  - infra/db/tests/44_finalize_finalize_concurrent.sql
  - infra/db/tests/45_finalize_cancel_concurrent.sql
  - infra/db/tests/46_finalize_terminalize_concurrent.sql
  - infra/db/tests/47_candidate_terminal_toctou.sql
  - infra/db/tests/52_revoked_runtime_dml_on_business_tables.sql
  - infra/db/tests/54_sd_owner_mismatch_fail_closed.sql
  - infra/db/tests/55_sd_missing_context_fail_closed.sql
  - infra/db/tests/59_provider_attempt_authorization_snapshot_fk.sql
  - infra/db/tests/60_quota_nonneg_check_and_release_idempotency.sql
  - infra/db/tests/63_worker_runtime_role_claim_complete.sql
  - infra/db/tests/64_worker_coordinator_cross_session_recovery.sql
  - infra/db/tests/65_generation_intake_workitem_promotion.sql
  - infra/db/tests/66_generation_zero_llm_completed_chain.sql
  - infra/db/tests/67_generation_external_attempt_completed_chain.sql
  - infra/db/tests/68_authorization_snapshot_runtime_creation_external_chain.sql
  - requirements-harness.txt
  - scripts/harness/doctor.py
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/AuthDataSourceConfig.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/tenant/OwnerContext.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/generation/web/GenerationController.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/worker/GenerationWorkItemHandler.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/worker/LiveInvocationAssembler.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/worker/WorkItemCoordinator.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/worker/WorkItemHandler.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/worker/WorkItemWorker.java
  - service/apps/runtime/src/main/resources/application.yaml
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/worker/GenerationWorkItemHandlerTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/worker/LiveInvocationAssemblerTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/worker/WorkItemCoordinatorTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/worker/WorkItemWorkerTest.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/InvocationBinding.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/execution/LiveAttemptOutcome.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/execution/LiveInvocationRequest.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/execution/LiveModelInvoker.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/execution/ProviderAttemptAudit.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/port/ModelProtocolAdapter.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/port/ModelProtocolSession.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/routing/DeterministicRouter.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/routing/QuotaLedger.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/FinalizeGenerationService.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/GenerationCancelService.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/GenerationFinalizeService.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/GenerationReceiveService.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/GenerationStateService.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/PersistenceConfig.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/WorkItemClaim.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/WorkItemClaimService.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/WorkItemEnqueueService.java
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
  - service/platform/persistence/src/main/resources/db/migration/V1__extensions_roles_functions.sql
  - service/platform/persistence/src/main/resources/db/migration/V20__provider_attempt_authorization_snapshot.sql
  - service/platform/persistence/src/main/resources/db/migration/V21__quota_nonneg_check_and_release_idempotency.sql
  - service/platform/persistence/src/main/resources/db/migration/V22__identity_auth_event_retention_purge.sql
  - service/platform/persistence/src/main/resources/db/migration/V23__worker_claim_functions_runtime_api_grant.sql
  - service/platform/persistence/src/main/resources/db/migration/V24__worker_coordinator_functions_runtime_api.sql
  - service/platform/persistence/src/main/resources/db/migration/V25__generation_intake_workitem_promotion.sql
  - service/platform/persistence/src/main/resources/db/migration/V26__authorization_snapshot_runtime_creation.sql
  - service/platform/persistence/src/main/resources/db/migration/V27__owner_context_cryptographic_binding.sql
  - service/platform/persistence/src/main/resources/db/migration/V2__user_domain_ownership.sql
  - service/platform/persistence/src/main/resources/db/migration/V3__authorization_snapshot.sql
  - service/platform/persistence/src/main/resources/db/migration/V4__provider_registry.sql
  - service/platform/persistence/src/main/resources/db/migration/V5__worker_claim_lease_fence.sql
  - service/platform/persistence/src/main/resources/db/migration/V6__conversation_generation_persistence.sql
  - service/platform/persistence/src/main/resources/db/migration/V7__finalize_generation_usage_quota_outbox.sql
  - service/platform/persistence/src/main/resources/db/migration/V8__realtime_resume_ticket_gap_reset_snapshot.sql
  - service/platform/persistence/src/main/resources/db/migration/V9__relationship_active_companion_limit.sql
  - skills/database-migration/SKILL.md
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
  - specs/catalog/generation-states.yaml
  - specs/catalog/provider-attempt-statuses.yaml
  - specs/catalog/realtime-events.yaml
  - specs/catalog/risk-levels.yaml
  - specs/contracts/authorization-contract.yaml
  - specs/contracts/database-ownership-contract.yaml
  - specs/contracts/finalization-contract.yaml
  - specs/contracts/generation-contract.yaml
  - specs/contracts/identity-session-boundary-contract.yaml
  - specs/contracts/realtime-contract.yaml
  - specs/contracts/worker-lease-contract.yaml
writeAllowlist:
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/worker/WorkItemCoordinator.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/worker/WorkItemWorker.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/worker/GenerationWorkItemHandler.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/worker/LiveInvocationAssembler.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/tenant/OwnerContext.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/WorkItemClaimService.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/WorkItemClaim.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/GenerationFinalizeService.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/FinalizeGenerationService.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/GenerationStateService.java
  - service/platform/persistence/src/main/resources/db/migration/V28__worker_lease_fence_business_guard.sql
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/worker/WorkItemWorkerTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/worker/GenerationWorkItemHandlerTest.java
  - infra/db/tests/74_wall_clock_lease_expires.sql
  - infra/db/tests/75_stale_worker_business_write_denied.sql
  - infra/db/tests/76_overtaken_claim_finalize_zero_write.sql
  - infra/db/tests/77_external_audit_survives_finalize_rollback.sql
  - infra/db/tests/78_aborted_tx_independent_fail.sql
  - infra/db/tests/79_fenced_finalize_happy_path.sql
  - docs/tasks/TASK-0194-worker-lease-fence-transaction-boundary.md
  - docs/tasks/context/TASK-0194.context-lock.yaml
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - docs/evidence/TASK-0194/**
  - docs/handoffs/TASK-0194.json
forbiddenPaths:
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
  - service/platform/persistence/src/main/resources/db/migration/V1__extensions_roles_functions.sql
  - service/platform/persistence/src/main/resources/db/migration/V20__provider_attempt_authorization_snapshot.sql
  - service/platform/persistence/src/main/resources/db/migration/V21__quota_nonneg_check_and_release_idempotency.sql
  - service/platform/persistence/src/main/resources/db/migration/V22__identity_auth_event_retention_purge.sql
  - service/platform/persistence/src/main/resources/db/migration/V23__worker_claim_functions_runtime_api_grant.sql
  - service/platform/persistence/src/main/resources/db/migration/V24__worker_coordinator_functions_runtime_api.sql
  - service/platform/persistence/src/main/resources/db/migration/V25__generation_intake_workitem_promotion.sql
  - service/platform/persistence/src/main/resources/db/migration/V26__authorization_snapshot_runtime_creation.sql
  - service/platform/persistence/src/main/resources/db/migration/V27__owner_context_cryptographic_binding.sql
  - service/platform/persistence/src/main/resources/db/migration/V2__user_domain_ownership.sql
  - service/platform/persistence/src/main/resources/db/migration/V3__authorization_snapshot.sql
  - service/platform/persistence/src/main/resources/db/migration/V4__provider_registry.sql
  - service/platform/persistence/src/main/resources/db/migration/V5__worker_claim_lease_fence.sql
  - service/platform/persistence/src/main/resources/db/migration/V6__conversation_generation_persistence.sql
  - service/platform/persistence/src/main/resources/db/migration/V7__finalize_generation_usage_quota_outbox.sql
  - service/platform/persistence/src/main/resources/db/migration/V8__realtime_resume_ticket_gap_reset_snapshot.sql
  - service/platform/persistence/src/main/resources/db/migration/V9__relationship_active_companion_limit.sql
  - service/modules/modelruntime/**
  - service/**/safety/**
  - service/**/memory/**
  - frontend/**
  - .github/**
  - ci/**
  - scripts/harness/**
  - skills/**
  - specs/**
  - docs/decisions/**
  - docs/schemas/**
  - docs/source/**
  - docs/planning/**
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
  - AGENTS.md
  - CLAUDE.md
  - .gitattributes
  - requirements-harness.txt
  - mvnw
  - mvnw.cmd
  - pom.xml
  - service/apps/runtime/pom.xml
  - service/platform/persistence/pom.xml
  - docs/tasks/TASK-0191-owner-context-rls-trust-model.md
  - docs/tasks/TASK-0192-harness-amendment-diffscope-recovery.md
  - docs/tasks/TASK-0193-p0-owner-context-rls-inherited-adoption.md
  - docs/tasks/context/TASK-0191.context-lock.yaml
  - docs/tasks/context/TASK-0192.context-lock.yaml
  - docs/tasks/context/TASK-0193.context-lock.yaml
  - docs/evidence/TASK-0191/**
  - docs/evidence/TASK-0192/**
  - docs/evidence/TASK-0193/**
  - docs/handoffs/TASK-0191.json
  - docs/handoffs/TASK-0192.json
  - docs/handoffs/TASK-0193.json
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
  - scripts/harness/doctor.py
  - docs/tasks/TASK-0193-p0-owner-context-rls-inherited-adoption.md
  - docs/handoffs/TASK-0193.json
  - specs/contracts/worker-lease-contract.yaml
  - specs/contracts/finalization-contract.yaml
requiredInvariants:
  - INV-WORKER-001
  - INV-TX-001
  - INV-GEN-001
  - INV-GEN-002
  - INV-GEN-003
  - INV-AUTH-001
  - INV-TENANT-001
  - INV-HARNESS-002
  - INV-HARNESS-003
  - INV-HARNESS-007
humanApprovals: []
independentReview: required
reviewers: []
requiredCommands:
  - PATH=/Users/hxf/.zcode/venvs/vc-harness/bin:$PATH python scripts/harness/precheck.py --task TASK-0194
  - JAVA_HOME=/opt/homebrew/opt/openjdk@25/libexec/openjdk.jdk/Contents/Home ./mvnw --batch-mode --no-transfer-progress -pl service/apps/runtime -am test
  - bash infra/db/run-rls-tests.sh
  - git diff --check
terminalStateReason: ""
```

> 本卡为外部审计 P1 修复的首张延续单卡（前一合法终态：TASK-0193 ACCEPTED `fb9cf0e`）。
> 目标：修正 worker lease/fence 墙钟失效、provider 外部调用持有长数据库事务与 claim 行锁、
> 业务结果写入缺少 fence/lease guard、PostgreSQL aborted transaction 后失败状态无法落库并
> 回到 PENDING 形成 5 秒热循环与重复外发。**这不是重新实现**，是对现有 worker/generation/
> finalize 调用链与 lease 模型的受控加固。TASK-0191 保持 REJECTED，V27 owner-context 密码学
> 绑定保持不变且不被弱化。

## 已确认边界（不误报）

1. 当前 claim、provider 调用、业务写入和 terminalize 位于 `OwnerContext.asOwner` 的**单一
   长事务**内（`OwnerContext.java:65-77`；`WorkItemWorker.java:67-90`）。
2. claim 的 `UPDATE ... FOR UPDATE SKIP LOCKED`（V5 L82）行锁在该长事务提交前不释放；因此
   coordinator 看不到未提交的 CLAIMED 行，**当前不是已证实的"双 worker 同时提交 split-brain"**。
3. PostgreSQL `now()` 是事务开始时间戳：claim 写 `lease_expires_at = now() + interval`（V5 L90 /
   V17 L66）、`_terminalize` 校验 `lease_expires_at > now()`（V5 L152）、`recover_expired_claims`
   用 `now()`（V24 L60）。全仓 migration 无 `clock_timestamp()`。故同一长事务内 30 秒 lease 不
   会按墙钟过期。
4. 生产 `WorkItemWorker` 从不调用 `renewLease`（全仓仅定义处命中）。
5. 业务写函数（`record_provider_attempt` V20 L52-117 / `insert_generation_candidate` V17 L1846-1899 /
   `finalize_generation` V17 L164-317 / `append_terminal_event` / `record_quota_release` V17 L1904-1950）
   **只校验 `current_owner_id()` 与 generation 状态机，不校验 claim token/fence/lease**；只有 V5
   的 5 个 worker 函数校验 token/fence/lease。`GenerationWorkItemHandler` 从不读取 `claim.claimToken()`。

## 1. 完整根因与文字时序

### 1.1 当前失败时序（单事务模型）

```
coordinator poll(5s) ── list_pending_owner_ids / recover_expired_claims(0) [独立连接, autocommit]
        │
        ▼
WorkItemWorker.processOwnerBatch ── OwnerContext.asOwner = 单一 TransactionTemplate(Tx-main)
        │  (Tx-main 内)
        ├─ claim_work_items(FOR UPDATE SKIP LOCKED) → CLAIMED + lease_expires_at=now()+30s [行锁持有]
        ├─ handler.handle(claim)
        │     ├─ promote_generation(IN_PROGRESS)  [V25 FOR UPDATE]
        │     ├─ LiveModelInvoker.invoke → adapter.open + session.next  ★阻塞网络往返★
        │     │     (provider 调用期间 Tx-main 与 claim 行锁一直持有; now() 冻结, lease 不按墙钟过期)
        │     ├─ record_provider_attempt            [普通 INSERT, 无 fence guard]
        │     ├─ insert_generation_candidate        [无 fence guard]
        │     ├─ promote(FINAL_REVIEW)
        │     └─ finalize_generation(usage/quota/event/outbox)  [无 fence guard]
        └─ complete_work_item(token) / fail_work_item(token)   [仅此处校验 lease_expires_at>now()]
```

### 1.2 三类真实风险（已核实，见外部审计 database P1-01/P1-03、generation P2 #3、independent-verification #2/#4）

- **A. 外部调用持长事务 + lease 墙钟失效**：provider 网络往返期间 `Tx-main` 与 claim 行锁不释放；
  `now()` 冻结使 30 秒 lease 在事务内永不过期；`renewLease` 从不调用。
- **B. 业务写无 fence guard（违反 lateWorkerRule）**：`worker-lease-contract.yaml:51` 要求"stale fence
  不能写 result/usage/final message/event/memory job"，但业务写函数不校验 claim token/fence/lease。
- **C. aborted tx → 失败无法落库 → 5 秒热循环**：任一业务 SQL 抛 PostgreSQL 错误 → `Tx-main` 进入
  aborted 状态 → 同事务内 `safeTerminalize` 与 `fail_work_item` 的 SQL 全部因 `current transaction
  is aborted` 失败 → 异常逃出 `TransactionTemplate` → **整体回滚**（claim、provider_attempt、candidate、
  finalize、fail 全部消失）→ work item 回到 PENDING → coordinator 约 5 秒后再次 claim 并**再次发起
  provider 调用**。外部网络副作用不可随数据库事务回滚，故为重复外发与供应商成本热循环。

### 1.3 修复后目标时序（分段事务模型）

```
segment-A claim-tx(短, 提交):  claim_work_items → COMMIT → CLAIMED 行已提交, 行锁释放
segment-B external-no-tx:      establish owner proof 仅用于只读校验; LiveModelInvoker.invoke
                                ★无数据库事务、不持 claim 行锁★ (provider 网络往返期间 DB 空闲)
segment-B' audit-tx(独立, 提交): record_provider_attempt(audit) → COMMIT  (外部副作用审计先落库)
segment-C finalize-tx(新):      assert_active_claim(owner, work_item, token, fence) ★墙钟+token+fence★
                                → candidate / promote(FINAL_REVIEW) / finalize_generation / complete_work_item
independent fail-tx(新):        若任一段 PostgreSQL aborted → 用全新事务记录 fail/terminal, 不依赖 aborted 事务
```

## 2. 方案比较

| 方案 | 描述 | 采用？ | 理由 |
|---|---|---|---|
| (1) 仅把 `now()` 改 `clock_timestamp()` | 单点改 lease 时间源 | **不** | 用户明确排除：事务与持锁模型不变时，长事务内 provider 调用仍持锁、业务写仍无 fence guard、aborted tx 仍无法 fail；只是让 `_terminalize` 的 lease 判断变墙钟，反而让在途批次的 complete 更易返回 0 而业务写已落库，放大不一致。不能冒充完整修复。 |
| (2) 拆分 claim/external/finalize 事务（推荐基座） | claim 独立提交、external 无事务、finalize 新事务 | **采用** | 释放 provider 调用期间的 DB 事务与行锁；为墙钟 lease 与 fence guard 提供前提。 |
| (3) 业务写传播并校验 claim token/fence/lease（推荐基座） | finalize-tx 起首 `assert_active_claim`，业务写无有效 claim 即 RAISE | **采用** | 落地 `lateWorkerRule`；claim 提交后 coordinator 可接管，必须靠 fence guard 防止 stale/overtaken worker 写 result/usage/final/event。 |
| (4) attempt/outbox/幂等记录在外部调用前后独立持久化（推荐基座） | provider 返回后先用独立 audit-tx 落 `provider_attempt`，再 finalize | **采用** | 外部副作用已发生时，审计不随 finalize-tx 回滚消失（修复 generation P2 #3 / INV-AUTH-001）。 |
| (5) SQL aborted tx 后用独立新事务可靠 fail/retry（推荐基座） | 失败记录走全新事务，不依赖 aborted 事务 | **采用** | 修复 database P1-03 / independent-verification #4：失败状态可靠落库，永久错误转 terminal 而非回到 PENDING 热循环。 |
| (6) bounded retry/dead-letter 同卡完成 | work_item 增 attempt_count/max_attempts + DEAD_LETTERED | **不（本卡）** | 使本卡远超 90 分钟硬熔断与 R3 禁令；列为串行后续 TASK-0195。本卡先以"永久错误可靠 terminal fail-closed"止住无限热循环；bounded retry 留 TASK-0195 为瞬态错误加有界重试。 |

### 推荐方案

**TASK-0194 = (2)+(3)+(4)+(5) 不可分割安全基座**。理由见 `complexityAssessment.indivisibleReason`：
(2) 一旦提交 claim 就释放行锁、使 coordinator 接管成为可能，必须与 (3) 同卡，否则把"未证实的
split-brain"变成真实 split-brain；(1) 的墙钟语义只在 (2) 之后才有意义；(4)(5) 是 (2) 的直接推论
且必须同卡以避免回归（拆分会令审计丢失与 fail 不可落库更易发生）。(6) 可安全延后。

## 3. 追加式 migration 设计（V28，不改 V1-V27）

- 新增 `V28__worker_lease_fence_business_guard.sql`（唯一允许的 migration 写路径）。
- **不编辑 V1-V27 任何文件**；通过 `CREATE OR REPLACE FUNCTION` / 新增 guard 函数在 V28 内演进：
  - 新增 `vc.assert_active_claim(p_owner, p_work_item_id, p_token, p_fence)`：校验 work_item 仍为
    `CLAIMED`、token/fence 精确匹配、`lease_expires_at > clock_timestamp()`，失败即 `RAISE`；成功后
    设置事务本地标记（如 `vc.active_claim`），供业务写函数 fail-closed 复核。
  - `CREATE OR REPLACE` 业务写入口（`finalize_generation`、`insert_generation_candidate`、
    `record_provider_attempt`、`append_terminal_event`、`record_quota_release`）增加"有效 active claim"
    fail-closed 复核；或以受信 guard + 事务本地标记实现等价语义（实现期择一，必须满足 lateWorkerRule）。
  - `CREATE OR REPLACE` claim/renew/`_terminalize`/`recover_expired_claims` 的 lease 时间源由 `now()`
    改为 `clock_timestamp()`，使墙钟真实生效。
- 保持 FORCE RLS、复合 owner FK、`vc_api`/`vc_worker` `NOBYPASSRLS`、V27 owner 密码学绑定与
  `current_owner_id()` 每调用重校验**不被弱化**；迁移末尾 fail-closed DO 块断言关键不变量。
- 不引入 retry_count/dead-letter 字段（属 TASK-0195）。

## 4. 并发 / 崩溃 / 重试状态矩阵

| # | 场景 | 修复后期望（可测） |
|---|---|---|
| 1 | claim 后进程崩溃 | claim-tx 已提交→CLAIMED；coordinator 墙钟到期后 `recover_expired_claims` 回收为 PENDING，重新 claim；无业务写发生。 |
| 2 | provider 调用超时 | external-no-tx 不持 DB 事务/行锁；超时后无 audit-tx 写入；lease 墙钟过期后回收 PENDING 重试；不形成长事务挂起。 |
| 3 | provider 成功但 audit-tx 写入失败 | audit-tx 独立失败不污染 finalize；按失败路径走 independent fail-tx 记录 terminal 失败；provider 已成功但审计未落库时，不进入 COMPLETED。 |
| 4 | audit 成功但 finalize-tx 失败 | finalize-tx 回滚仅回滚 finalize 内写；audit 行已独立提交存活（77 测试）；independent fail-tx 记录失败。 |
| 5 | lease 墙钟过期后旧 worker 恢复写 | `assert_active_claim` 用 clock_timestamp 判定过期→RAISE；candidate/final/usage/quota/event 零写入（75 测试）。 |
| 6 | coordinator 回收与旧 worker 并发 | 新 worker claim 成功（token/fence 新）；旧 worker finalize 的 `assert_active_claim` 因 token/fence 不匹配或状态非 CLAIMED→RAISE 零写（76 测试）；新 worker 正常完成。 |
| 7 | stale token/fence 写 attempt/candidate/final/usage/event | 业务写函数 fail-closed 复核 active claim→零写；仅 V5 worker 函数族曾校验，现扩至全部业务写。 |
| 8 | permanent DB error | 当前事务 aborted→independent fail-tx（全新事务）可靠记录 terminal FAILED；coordinator 不再枚举 terminal，**停止每 5 秒热循环与重复外发**（78 测试）。 |
| 9 | 重复 provider response | 同一 generation 经 `finalize_generation` 幂等 guard（`assistant_message_id IS NOT NULL` RAISE）+ fence guard；第二次 finalize 零写。 |
| 10 | cancel 与 active provider 调用并发 | cancel 落 CANCELLED 后，late finalize 经状态 guard + fence guard 零写（保持 45 测试语义）；cooperative 中断 in-flight session 属另一审计发现（generation P2 #8），本卡不实现、保持 modelruntime 只读。 |

## 5. 精确 allowlist（无宽泛 glob）

- `readAllowlist`：见上方 YAML（137 个精确仓库相对路径，与 Context Lock 输入一一对应）。
- `writeAllowlist`：见上方 YAML（精确 Java/migration/test/治理路径）。
- `forbiddenPaths`：见上方 YAML（V1-V27 逐文件、modelruntime/safety/memory、前端、CI、治理真源、
  历史 TASK-0191/0192/0193 制品等）。

## 6. 风险等级、所需 Skill、独立 Reviewer

- 风险等级：**C4**（含 protected-path `**/db/migration/**` C4 database-migration + AUTHORIZATION 安全面）。
- 所需 Skill：`task-delivery-flow@1.3.7`、`task-intake@1.2.7`、`database-migration@1.0.0`。
- 人工批准：database-migration C4 + AUTHORIZATION 安全面（`humanApprovals` 待 Owner）。
- 独立 Reviewer：**必需**（C3/C4 强制 + AUTHORIZATION 安全面）。R1 覆盖完整状态矩阵、验收、不变量
  与相邻风险；至多 1 次修正批次、至多 R2；R3 禁止。

## 7. 精确验收命令与测试文件计划

冻结命令（绑定同一真实候选 SHA，真实退出码）：
1. `PATH=/Users/hxf/.zcode/venvs/vc-harness/bin:$PATH python scripts/harness/precheck.py --task TASK-0194`
2. `JAVA_HOME=/opt/homebrew/opt/openjdk@25/libexec/openjdk.jdk/Contents/Home ./mvnw --batch-mode --no-transfer-progress -pl service/apps/runtime -am test`
3. `bash infra/db/run-rls-tests.sh`
4. `git diff --check`

新增测试文件计划（writeAllowlist 已列）：
- `74_wall_clock_lease_expires.sql`：claim 后 `pg_sleep` 越过 lease 墙钟→`_terminalize`/guard 判定过期。
- `75_stale_worker_business_write_denied.sql`：过期/错 fence worker 调业务写函数→attempt/candidate/
  final/usage/event 全零写。
- `76_overtaken_claim_finalize_zero_write.sql`：dblink 双会话，B 接管后 A 的 finalize 零写、B 正常完成。
- `77_external_audit_survives_finalize_rollback.sql`：audit-tx 提交后 finalize-tx 注错回滚→audit 行存活。
- `78_aborted_tx_independent_fail.sql`：业务 SQL 报错致事务 aborted→新事务可靠记录 terminal 失败、
  work item 不回 PENDING 热循环。
- `79_fenced_finalize_happy_path.sql`：合法 claim + 有效 fence→finalize 原子完成 final/usage/quota/event。
- Java：`WorkItemWorkerTest`/`GenerationWorkItemHandlerTest` 增分段事务、external-no-tx、audit 独立持久化、
  independent fail 的 mock/契约断言（不伪造真实 PG；真实 PG 由 SQL 测试覆盖）。

## 8. 是否拆卡

- **建议拆卡**：TASK-0194（不可分割安全基座，见上）+ 串行后续 **TASK-0195**（bounded retry/dead-letter：
  `work_item` 增 `attempt_count/max_attempts` 与 `DEAD_LETTERED` terminal，coordinator 跳过 dead-letter，
  为瞬态错误加有界重试）。依赖顺序：TASK-0195 依赖 TASK-0194 ACCEPTED。
- **本轮只创建 TASK-0194 一个 DRAFT**；TASK-0195 待 Owner 在 TASK-0194 终态后另行授权。
- 拆卡理由：单卡覆盖 (2)-(6) 远超 `hardFuseWallMinutes=90` 与 R3 禁令；TASK-0194 单独已能满足最低
  验收（永久错误可靠 terminal，止住无限热循环），TASK-0195 是质量增强而非安全必需。

## 9. 最低验收设计（必须证明）

1. provider 网络调用期间不保持长数据库事务和 claim 行锁（external-no-tx，79/77 实证）。
2. lease 按墙钟真实生效（clock_timestamp，74 实证）。
3. stale worker 无法写 provider attempt、candidate、final message、usage、quota 或 terminal event（75 实证）。
4. 已过期或已被接管的 worker terminalize 为零写入（76 实证）。
5. 外部调用已经发生后，audit/幂等记录不会因最终化事务回滚而完全消失（77 实证）。
6. SQL aborted transaction 后 failure/retry 状态由独立新事务可靠落库（78 实证）。
7. 永久错误不会每 5 秒无限热循环（78 实证：terminal fail 可靠落库，coordinator 不枚举 terminal）。
8. 合法 happy path 仍保持 final message、usage、quota 和 terminal event 的原子性（79 + 16/44 实证）。
9. tenant/RLS 与刚接纳的 V27 owner binding 不被弱化（不修改 V1-V27；V28 保持 FORCE RLS、复合 owner FK、
   owner 密码学绑定、current_owner_id 每调用重校验；53/54/55/69-73 回归绿）。
10. 不记录 claim token、proof、secret 或 provider credential（沿用 V27/OwnerContext 脱敏；warning 不含原始 token）。

## 10. 回滚 / 前向修复策略与部署兼容性

- 回滚：V28 为追加式 `CREATE OR REPLACE`/新增函数；如需回滚，以新的后续 migration（V29+）恢复旧函数
  语义，不删除 V28、不改写 V1-V27、不回滚历史。
- 前向修复：若 R1 发现 fence guard 语义缺陷，仅可在 writeAllowlist 内至多 1 次修正批次修复 V28 自身
  与 Java/test；不得扩到 modelruntime、safety、memory 或 V1-V27。
- 部署兼容性：分段事务不改变对外 HTTP/SSE 契约与 generation 状态机；V28 在现有 V1-V27 之上执行；
  claim 提交后 coordinator 接管依赖 fence guard，二者必须同批部署（不可灰度拆分 fence guard）。
- 预算风险：完整 Harness discover 约 34 分钟 CI 预算风险保留；Evidence 未运行时如实 NOT_RUN，不以
  旧 PASS 代替。

## 范围内

- 实现分段事务模型（claim-tx / external-no-tx / audit-tx / finalize-tx / independent fail-tx）。
- V28 墙钟 lease + 业务写 fence/lease/token guard（追加式，不改 V1-V27）。
- 外部副作用审计独立持久化；aborted tx 后独立新事务可靠 fail。
- 本卡 task card / Context Lock / Evidence / Handoff / project-state / ledger。

## 明确范围外

- 不修改 V1-V27 migration、TASK-0191/0192/0193 历史制品与治理真源。
- 不实现 bounded retry/dead-letter（TASK-0195）；不实现 cooperative 中断 in-flight provider session
  （generation P2 #8，另开任务）；不改 modelruntime/safety/memory。
- 不推送、不合并、不 rebase、不 reset、不改写历史。不进入 READY（本轮仅 DRAFT）。

## 状态机和失败行为

- READY Doctor 因新 blocker 非 PASS → 暂停并合并为一次 Owner 提问，不自行扩权。
- 任一验收命令非 PASS → 真实退出码记录，至多 1 次修正批次（仅 writeAllowlist 内）后重跑；仍非 PASS → REJECTED/暂停。
- Reviewer P0/P1 → 停止并合并为一次 Owner 提问。
- 完整 unittest discover 因预算未运行时保持 NOT_RUN，不得表述为 PASS。

## Evidence Pack

输出到 `docs/evidence/TASK-0194/`，并生成 `docs/handoffs/TASK-0194.json`。

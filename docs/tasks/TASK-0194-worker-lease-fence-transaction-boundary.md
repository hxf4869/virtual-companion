# TASK-0194：P1 worker lease/fence 墙钟生效、外部调用事务边界与失败热循环收敛

```yaml
taskId: TASK-0194
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
planningBacklog: null
planningContractHash: null
planningContractHashAlgorithm: null
baseCommit: fb9cf0e178212d6ff554abf7d4695aa114fe0dba
contextFingerprint: 69aa493b81c570f60be1d60ab5bd28454a3afd2e5041d37c79ba72034756faf7
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
  splitProposal: TASK-0194 承载不可分割安全基座（prepare/external 分离 + attempt intent + 显式 claim guard + 墙钟 lease + per-item terminalize + 独立 fail）；bounded retry/dead-letter 列串行后续 TASK-0195（本轮不创建）
  ownerIndivisibleAuthorization: true
  indivisibleReason: >-
    claim 一旦独立提交就释放行锁、使 coordinator 接管成为可能，必须与"业务写显式校验
    work_item_id+claim_token+claim_fence"同卡生效；attempt intent 必须在 outbound 前独立
    持久化才能保证"外发已发生则审计不丢"，且 intent 写失败须禁止外发；prepare 阶段必须
    把 invoker 内的 JDBC（authorization snapshot 读取）收敛到 prepare-tx，使 external 阶段
    仅消费不可变 PreparedInvocation、无 JDBC/TransactionTemplate。这些互为前提，缺任一项都
    会把"未证实的 split-brain"变成真实 split-brain 或令外发审计/失败状态不可靠落库。
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
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/tenant/OwnerContextTest.java
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
  - service/modules/modelruntime/src/test/java/com/virtualcompanion/modelruntime/execution/LiveModelInvokerTest.java
  - service/modules/modelruntime/src/test/java/com/virtualcompanion/modelruntime/execution/ScriptedAdapter.java
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
  - service/platform/persistence/src/test/java/com/virtualcompanion/platform/persistence/FinalizeGenerationServiceTest.java
  - service/platform/persistence/src/test/java/com/virtualcompanion/platform/persistence/WorkItemClaimServiceTest.java
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
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/execution/LiveModelInvoker.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/execution/PreparedInvocation.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/ExternalAttemptBinding.java
  - service/modules/modelruntime/src/test/java/com/virtualcompanion/modelruntime/execution/LiveModelInvokerTest.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/WorkItemClaimService.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/WorkItemClaim.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/GenerationFinalizeService.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/FinalizeGenerationService.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/GenerationStateService.java
  - service/platform/persistence/src/test/java/com/virtualcompanion/platform/persistence/WorkItemClaimServiceTest.java
  - service/platform/persistence/src/test/java/com/virtualcompanion/platform/persistence/FinalizeGenerationServiceTest.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/worker/WorkItemCoordinator.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/worker/WorkItemWorker.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/worker/GenerationWorkItemHandler.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/worker/LiveInvocationAssembler.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/tenant/OwnerContext.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/worker/WorkItemWorkerTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/worker/GenerationWorkItemHandlerTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/tenant/OwnerContextTest.java
  - service/platform/persistence/src/main/resources/db/migration/V28__worker_lease_fence_business_guard.sql
  - infra/db/tests/74_attempt_intent_created_before_outbound.sql
  - infra/db/tests/75_wall_clock_lease_expires.sql
  - infra/db/tests/76_guarded_finalize_requires_explicit_claim.sql
  - infra/db/tests/77_stale_worker_only_closes_intent.sql
  - infra/db/tests/78_overtaken_claim_zero_business_write.sql
  - infra/db/tests/79_external_audit_survives_finalize_rollback.sql
  - infra/db/tests/80_aborted_tx_independent_per_item_fail.sql
  - infra/db/tests/81_batch_per_item_terminalize_no_pollution.sql
  - infra/db/tests/82_expired_claim_with_intent_not_resent.sql
  - infra/db/tests/83_fenced_finalize_happy_path.sql
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
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/port/ModelProtocolAdapter.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/port/ModelProtocolSession.java
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
  - service/modules/modelruntime/pom.xml
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
humanApprovals:
  - scope: scope-and-split-decision
    approvedBy: repository-owner
    approvedAt: "2026-08-14"
    sourceThreadId: zcode-main-20260814
    evidence: >-
      Owner 2026-08-14 批准拆卡：TASK-0194 承载不可分割安全基座（prepare/external 事务分离 +
      outbound 前 attempt intent + 显式 claim guard + 墙钟 lease + per-item terminalize +
      独立 fail），bounded retry/dead-letter 列串行后续 TASK-0195（暂不创建）；并给定 5 项设计
      修正（已逐项落入 DRAFT 修正 879da12）。授权据此自主进入 READY。
  - scope: database-migration-and-authorization
    approvedBy: repository-owner
    approvedAt: "2026-08-14"
    sourceThreadId: zcode-main-20260814
    evidence: >-
      Owner 2026-08-14 原则批准 TASK-0194 的 C4 database-migration 与 AUTHORIZATION 安全面范围：
      追加式 V28（CREATE OR REPLACE/新增 guard 函数，不改 V1-V27），保持 FORCE RLS、复合 owner FK、
      V27 owner 密码学绑定与 current_owner_id 每调用重校验不被弱化；业务写显式校验
      work_item_id+claim_token+claim_fence（非可伪造 GUC）。
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
> Owner 2026-08-14 批准拆卡：TASK-0194 承载不可分割安全基座，bounded retry/dead-letter 列串行
> 后续 TASK-0195（本轮不创建）。Owner 同日原则批准 C4 database-migration 与 AUTHORIZATION 范围，
> 并给定 5 项设计修正（本卡已逐项落入设计）。TASK-0191 保持 REJECTED，V27 owner-context 密码学
> 绑定保持不变且不被弱化。**这不是重新实现**，是对现有 worker/generation/finalize 调用链与
> lease 模型的受控加固。

## 已确认边界（不误报）

1. 当前 claim、provider 调用、业务写入和 terminalize 位于 `OwnerContext.asOwner` 的**单一长事务**内
   （`OwnerContext.java:65-77`；`WorkItemWorker.java:67-90`）。
2. claim 的 `UPDATE ... FOR UPDATE SKIP LOCKED`（V5 L82）行锁在该长事务提交前不释放；coordinator
   看不到未提交的 CLAIMED 行，**当前不是已证实的"双 worker 同时提交 split-brain"**。
3. PostgreSQL `now()` 是事务开始时间戳；全仓 migration 无 `clock_timestamp()`。故同一长事务内 30 秒
   lease 不会按墙钟过期。生产 `WorkItemWorker` 从不调用 `renewLease`。
4. 业务写函数（`record_provider_attempt`/`insert_generation_candidate`/`finalize_generation`/
   `append_terminal_event`/`record_quota_release`）只校验 `current_owner_id()` 与 generation 状态机，
   **不校验 claim token/fence/lease**；`GenerationWorkItemHandler` 从不读取 `claim.claimToken()`。
5. V27 owner proof 是 transaction-local；`LiveModelInvoker` 内仍含 JDBC（authorization snapshot 读取）。
   因此"external-no-tx"不得直接调用完整 invoker——必须先有 prepare-tx 物化不可变输入。

## 1. 完整根因与修复后文字时序（Owner 修正版）

### 1.1 当前失败时序（单事务模型，已核实）

```
coordinator poll(5s) ── list_pending_owner_ids / recover_expired_claims(0) [独立连接, autocommit]
WorkItemWorker.processOwnerBatch ── OwnerContext.asOwner = 单一 TransactionTemplate(Tx-main)
  (Tx-main 内)
  claim_work_items(FOR UPDATE SKIP LOCKED) → CLAIMED + lease=now()+30s [行锁持有]
  handler.handle(claim)
    promote(IN_PROGRESS); LiveModelInvoker.invoke(含 JDBC 读 auth snapshot + adapter.open/session.next) ★阻塞网络★
    record_provider_attempt / insert_candidate / promote(FINAL_REVIEW) / finalize_generation [无 fence guard]
  complete/fail_work_item(token) [仅此处校验 lease_expires_at>now()]
```
风险：A 外部调用持长事务+行锁且 lease 墙钟失效；B 业务写无 fence guard（违反 lateWorkerRule）；
C 任一业务 SQL 抛 PG 错误→Tx-main aborted→同事务 safeTerminalize/fail 全失败→整体回滚→PENDING→
约 5 秒后再 claim 再外发（重复外发/成本热循环）。

### 1.2 修复后时序（prepare 与网络真正分离）

```
claim-tx(短,提交):        claim_work_items → COMMIT → CLAIMED 已提交, 行锁释放; 每项返回 token/fence
prepare-tx(短,提交):      owner proof(V27,事务本地); 读 message/snapshot; route/auth/safety 预检;
                          创建 attempt intent(CREATED) 绑定 owner+work_item+generation+token_hash+fence
                          +providerAttemptId+requested/execution snapshot+provider/deployment identity;
                          物化不可变 PreparedInvocation(含 ModelProtocolRequest+binding+attemptId, 不再需 JDBC)
                          → COMMIT
                          ★intent 写入失败 → 禁止外发（不进入 external）★
external-no-db:           仅 adapter.open(preparedRequest)/session.next, 消费 PreparedInvocation;
                          ★禁止 JDBC / TransactionTemplate; 测试证明此阶段无活动数据库事务、无 claim 行锁★
audit-outcome-tx(短,提交): UPDATE 同一 intent 的 outcome(SUCCEEDED/FAILED/TIMED_OUT); ★不另插一行★
guarded-finalize-tx(单一): assert_active_claim(work_item_id, token, fence) ★显式参数, 非 GUC★
                          → candidate + promote(FINAL_REVIEW) + finalize(usage/quota/event)
                          + per-work-item terminalize 全部在此同一事务
independent-fail-tx(新):  仅当上述任一事务 aborted → 用全新事务仅终止原 work_item_id/token/fence;
                          ★绝不误伤接管后的新 claim★
```

## 2. 方案比较与矛盾消解

| 方案 | 采用？ | 理由 |
|---|---|---|
| (1) 仅 `now()`→`clock_timestamp()` | 否 | 事务/持锁模型不变时仍持长事务、业务写仍无 guard、aborted tx 仍无法 fail；不能冒充完整修复。 |
| (2) prepare-tx/external-no-db/audit/finalize 分段 + 物化 PreparedInvocation | **是** | 真正把 invoker 内 JDBC 收敛到 prepare；external 仅消费不可变输入，证明网络期无 DB 事务/行锁。 |
| (3) outbound 前独立短事务创建 CREATED attempt intent + UNIQUE providerAttemptId；外发后仅更新同行 outcome | **是** | 保证"外发已发生则审计不丢"；intent 写失败禁止外发。 |
| (4) 业务写显式接收并校验 work_item_id+claim_token+claim_fence（非 GUC 标记） | **是** | 运行时角色可自行 set GUC，故不接受 transaction-local GUC 作 active_claim；必须显式参数或同等不可伪造绑定。 |
| (5) per-work-item terminalize/renew（V28），废除共享 token 整批 fail | **是** | 修当前"同批一项失败把成功项一起标 FAILED"的污染。 |
| (6) bounded retry/dead-letter 同卡 | 否（本卡） | 远超 90min 硬熔断与 R3；列 TASK-0195。本卡以"可靠 terminal fail-closed"止住无限热循环。 |

### 矛盾消解：stale worker 与外发审计保留
- **outbound 前**以独立短事务创建 CREATED intent → 外发**已发生**时审计必然已落库（不依赖 finalize）。
- lease 已失效的**旧 worker**：可把**已存在**的 intent 更新为 `ABANDONED_LATE`（审计终态），但**不得**新建
  attempt、**不得**写 candidate/final/usage/quota/event（业务写经显式 claim guard 拒绝）。
- 故"stale worker 不能写 provider attempt（新建/业务结果）"与"外发审计必须保留（intent+outcome）"不再矛盾：
  新建 attempt 与业务结果被 guard 拒绝；既有 intent 的 outcome/ABANDONED_LATE 更新被允许（仅审计闭合）。

## 3. 追加式 migration 设计（V28，不改 V1-V27）

- 新增 `V28__worker_lease_fence_business_guard.sql`（唯一 migration 写路径）；**不编辑 V1-V27 任何文件**。
- `CREATE OR REPLACE` / 新增函数在 V28 内演进：
  - 新增 `vc.create_attempt_intent(owner, work_item_id, generation_id, claim_token_hash, claim_fence,
    provider_attempt_id, requested_snapshot, execution_snapshot, provider/deployment identity)`：创建
    `CREATED` intent；`provider_attempt_id` 唯一约束；claim token/fence 仅以 hash 形式绑定（不存原始 token/proof/secret）。
  - 新增 `vc.record_attempt_outcome(...)`/`vc.abandon_late_attempt(...)`：仅 `UPDATE` 同一 intent 行。
  - 新增 `vc.assert_active_claim(owner, work_item_id, claim_token, claim_fence)`：逐项直接校验 work_item 仍
    `CLAIMED`、token/fence 精确匹配、`lease_expires_at > clock_timestamp()`；**不读取也不信任任何 transaction-local
    GUC 作为授权标记**；失败 `RAISE`。业务写入口（candidate/promote/finalize/usage/quota/event）须在该断言通过后、
    同一 guarded finalize 事务内执行。
  - `CREATE OR REPLACE` claim/renew/terminalize/recover_expired_claims：lease 时间源 `now()`→`clock_timestamp()`；
    提供**逐 work-item** complete/fail/renew（按 work_item_id+token+fence），不再仅按共享 token 整批更新。
  - `recover_expired_claims` 区分：**已有 outbound attempt intent** 的过期 claim → 终止/标记 `ABANDONED_LATE`，
    不回 PENDING；**可证明无 outbound intent** 的过期 claim → 回 PENDING 可重试。
- 保持 FORCE RLS、复合 owner FK、`NOBYPASSRLS`、V27 owner 密码学绑定与 `current_owner_id()` 每调用重校验**不被弱化**；
  迁移末尾 fail-closed DO 块断言关键不变量。不引入 retry_count/dead-letter 字段（属 TASK-0195）。
- intent/attempt 状态复用既有 `specs/catalog/provider-attempt-statuses.yaml`（`CREATED`/`ABANDONED_LATE`/
  `SUCCEEDED`/`TIMED_OUT` 等已存在，**catalog 只读不改**）。

## 4. 并发 / 崩溃 / 重试状态矩阵（Owner 追加场景已纳入）

| # | 场景 | 修复后期望（可测） |
|---|---|---|
| 1 | claim 后进程崩溃 | claim-tx 已提交→CLAIMED；墙钟到期后 recover（无 intent→PENDING）重新 claim；无业务写。 |
| 2 | provider 调用超时 | external-no-db 不持 DB 事务/行锁；audit-outcome-tx 记 `TIMED_OUT`；fail-closed terminal（TASK-0195 前不无限 PENDING retry）。 |
| 3 | **intent 提交失败** | prepare-tx 失败→**adapter 零调用**（74 + Java LiveModelInvokerTest/HandlerTest 实证）。 |
| 4 | intent 成功，进程在外发**前/中/后**崩溃 | 前：intent=CREATED 残留，过期 claim 有 intent→ABANDONED_LATE 不重发；中/后：外部副作用已发生，intent+outcome 已/可补落库（77/82）。 |
| 5 | lease 墙钟过期后旧 worker 写业务结果 | `assert_active_claim` 用 clock_timestamp 判过期→RAISE；candidate/final/usage/quota/event 零写（76/77）。 |
| 6 | coordinator 回收与旧 worker 并发（overtaken） | 新 worker claim 成功（新 token/fence）；旧 worker finalize 的显式 claim guard 失败→零写；新 worker 正常完成（78）。 |
| 7 | **stale worker 只能闭合既存审计** | 旧 worker 可把既有 intent→`ABANDONED_LATE`，但新建 attempt/candidate/final/usage/event 全被 guard 拒绝（77）。 |
| 8 | permanent DB error | 当前事务 aborted→**independent-fail-tx（全新事务）仅终止原 work_item_id/token/fence**→terminal 可靠落库；coordinator 不枚举 terminal，停止热循环（80）。**仅在 DB 重新可写且该 fail 事务成功边界内声明**；DB 整体不可用不虚构落库保证。 |
| 9 | 重复 provider response | finalize 幂等 guard（`assistant_message_id IS NOT NULL` RAISE）+ 显式 claim guard；第二次零写。 |
| 10 | cancel 与 active provider 并发 | cancel 落 CANCELLED 后 late finalize 经状态 guard + 显式 claim guard 零写；cooperative 中断 in-flight session 属另一发现（generation P2 #8），本卡不实现、adapter 公共契约只读。 |
| 11 | **同批一项成功、一项失败** | per-work-item terminalize：成功项 DONE、失败项 FAILED，终态互不污染（81）。 |
| 12 | **过期 claim 已有 outbound intent** | 不回 PENDING、不再次外发；终止/标记 `ABANDONED_LATE`；仅无 intent 的过期 claim 回 PENDING（82）。 |

## 5. 精确 allowlist（无宽泛 glob）

- `readAllowlist`：见上方 YAML（142 个精确仓库相对路径，与 Context Lock 输入一一对应；含 modelruntime/
  persistence/runtime 相关测试）。
- `writeAllowlist`：见上方 YAML（36 精确路径：LiveModelInvoker+PreparedInvocation+ExternalAttemptBinding
  新类型、persistence claim/finalize/state、runtime worker/handler/OwnerContext、V28、10 个新 SQL 测试、
  Java 测试与治理路径）。
- `forbiddenPaths`：见上方 YAML（V1-V27 逐文件；**公共 adapter 契约** `ModelProtocolAdapter/ModelProtocolSession`
  逐文件禁止以守"不改公共 provider adapter 契约"；safety/memory/前端/CI/治理真源/TASK-0191-0193 历史）。
- modelruntime 不再整体 forbidden：仅 LiveModelInvoker 及 attempt lifecycle 相关新类型/测试可写（Owner 明示），
  公共 port 契约只读；该子树受 protected-path `service/**/modelruntime/**` C3 model-routing-change 约束，
  已由本卡 `independentReview: required` 覆盖。

## 6. 风险等级、所需 Skill、独立 Reviewer

- 风险等级 **C4**（`**/db/migration/**` C4 database-migration + AUTHORIZATION 安全面 + modelruntime C3）。
- Skill：`task-delivery-flow@1.3.7`、`task-intake@1.2.7`、`database-migration@1.0.0`。
- 人工批准：database-migration C4 + AUTHORIZATION 安全面（Owner 2026-08-14 已原则批准，READY 时落 `humanApprovals`）。
- 独立 Reviewer：**必需**（C3/C4 + AUTHORIZATION）。R1 覆盖完整状态矩阵、验收、不变量与相邻风险；至多 1 次修正批次、至多 R2；R3 禁止。

## 7. 精确验收命令与测试文件计划

冻结命令（绑定同一真实候选 SHA，真实退出码）：
1. `PATH=/Users/hxf/.zcode/venvs/vc-harness/bin:$PATH python scripts/harness/precheck.py --task TASK-0194`
2. `JAVA_HOME=/opt/homebrew/opt/openjdk@25/libexec/openjdk.jdk/Contents/Home ./mvnw --batch-mode --no-transfer-progress -pl service/apps/runtime -am test`
3. `bash infra/db/run-rls-tests.sh`
4. `git diff --check`

新增测试（writeAllowlist 已列）：
- SQL：74 intent-before-outbound（含 providerAttemptId 唯一、intent 失败禁外发）；75 墙钟 lease 过期；
  76 显式 claim guard（GUC-only 失败、显式 work_item+token+fence 通过）；77 stale worker 仅闭合 intent；
  78 overtaken 零业务写；79 intent+outcome 在 finalize 回滚后存活；80 aborted tx→独立新事务仅终止原项；
  81 per-item terminalize 无污染；82 有 intent 的过期 claim 不重发；83 guarded happy path 原子完成。
- Java：`LiveModelInvokerTest`（prepare/external 分离、external 阶段断言无活动事务 `TransactionSynchronizationManager`、
  intent 失败→adapter 零调用）；`WorkItemWorkerTest`/`GenerationWorkItemHandlerTest`（分段事务、per-item、
  independent fail 仅原项、intent lifecycle）；`OwnerContextTest`（per-segment owner proof）；
  `WorkItemClaimServiceTest`/`FinalizeGenerationServiceTest`（显式 claim guard、attempt intent create/update）。
  真实 PostgreSQL 行为由 SQL 测试覆盖，Java 侧重 mock/契约断言。

## 8. 是否拆卡

- **已拆**：TASK-0194（不可分割安全基座）+ 串行后续 TASK-0195（bounded retry/dead-letter）。本轮只创建 TASK-0194。
- TASK-0194 单独满足"永久错误可靠 terminal、止住 5 秒热循环与重复外发"；TASK-0195 为瞬态错误加有界重试，安全非必需。

## 9. 最低验收设计（必须证明）

1. provider 网络调用期间无活动数据库事务、无 claim 行锁（external-no-db + PreparedInvocation，Java+75 实证）。
2. lease 按墙钟真实生效（clock_timestamp，75 实证）。
3. stale/overtaken worker 无法新建 attempt 或写 candidate/final/usage/quota/event（显式 claim guard，76/77/78 实证）。
4. 已过期或已被接管的 worker terminalize 为零写入（78 实证）。
5. 外部调用已经发生后，审计/幂等记录（intent+outcome）不会因最终化事务回滚而完全消失（outbound 前 intent，79 实证）。
6. SQL aborted transaction 后 failure/retry 状态由独立新事务可靠落库（80 实证；DB 整体不可用边界如实保留）。
7. 永久错误不会每 5 秒无限热循环（80：independent fail 仅终止原项→terminal，coordinator 不枚举 terminal）。
8. 合法 happy path 仍保持 final/usage/quota/event 原子性（83 + 16/44 实证）。
9. tenant/RLS 与 V27 owner binding 不被弱化（不改 V1-V27；V28 保持 FORCE RLS、复合 owner FK、owner 密码学绑定、
   current_owner_id 每调用重校验；53/54/55/69-73 回归绿）。
10. 不记录 claim token 原值、proof、secret 或 provider credential（intent 仅存 token hash；日志不含原始 token）。

## 10. 回滚 / 前向修复 / 部署兼容性

- 回滚：V28 追加式 `CREATE OR REPLACE`/新增函数；如需回滚以 V29+ 恢复旧语义，不删 V28、不改 V1-V27、不回滚历史。
- 前向修复：R1 发现缺陷仅可在 writeAllowlist 内至多 1 次修正批次修复 V28 自身与 Java/test；不得扩到公共 adapter
  契约、safety、memory 或 V1-V27。
- 部署兼容性：分段事务不改变对外 HTTP/SSE 契约与 generation 状态机；V28 在 V1-V27 之上执行；claim 提交 +
  fence guard + attempt intent 必须**同批部署**（不可灰度拆分 guard）。
- 预算风险：完整 Harness discover 约 34 分钟 CI 预算风险保留；discover 未运行时 Evidence 保持 NOT_RUN。

## 范围内

- 分段事务（claim/prepare/external-no-db/audit-outcome/guarded-finalize/independent-fail）+ PreparedInvocation 物化。
- V28：墙钟 lease + attempt intent（outbound 前创建）+ 显式 claim guard（非 GUC）+ per-item terminalize + 有 intent 的过期 claim 不重发。
- 本卡 task card / Context Lock / Evidence / Handoff / project-state / ledger。

## 明确范围外

- 不修改 V1-V27、TASK-0191/0192/0193 历史制品与治理真源；不改公共 provider adapter 契约（ModelProtocolAdapter/ModelProtocolSession）。
- 不实现 bounded retry/dead-letter（TASK-0195）；不实现 cooperative 中断 in-flight session（generation P2 #8，另卡）。
- 不推送、不合并、不 rebase、不 reset、不改写历史。

## 状态机和失败行为

- READY Doctor 因新 blocker 非 PASS → 暂停合并上报，不自行扩权。
- 任一验收命令非 PASS → 真实退出码记录，至多 1 次修正批次（仅 writeAllowlist 内）后重跑；仍非 PASS → REJECTED/暂停。
- Reviewer P0/P1 → 停止合并上报。
- 若实现必须改公共 adapter 契约、路径超出上述模块、或预计无法遵守 90 分钟 hard fuse → 合并暂停上报。
- 完整 unittest discover 因预算未运行时保持 NOT_RUN，不得表述为 PASS。

## Evidence Pack

输出到 `docs/evidence/TASK-0194/`，并生成 `docs/handoffs/TASK-0194.json`。

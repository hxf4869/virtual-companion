# TASK-0195：P1 worker lease/fence 继承实现独立接纳（含 SchemaReadiness 迁移数断言 27→28 机械修复）

```yaml
taskId: TASK-0195
state: READY
owner: repository-owner
riskClass: C4
requiredSkills:
  - task-delivery-flow
  - task-intake
  - database-migration
  - model-routing-change
requiredSkillVersions:
  task-delivery-flow: "1.3.7"
  task-intake: "1.2.7"
  database-migration: "1.0.0"
  model-routing-change: "1.0.0"
targetSkillVersions: {}
planningBacklog: null
planningContractHash: null
planningContractHashAlgorithm: null
baseCommit: d1941c9a3b93dcc97a40275f80e65883e511594e
contextFingerprint: 7befc35a88c6531ca17a9818e1c8a5bd60656bb4426a305f26b130223cdd7bdb
contextLock: docs/tasks/context/TASK-0195.context-lock.yaml
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
  surfaceId: TASK_0195_P1_WORKER_LEASE_FENCE_INHERITED_ADOPTION
  policySurfaces: [AUTHORIZATION]
  distinctCrossRiskSurfaces: 1
  reviewerMinutesEstimate: 15
  terminalCheckMinutesEstimate: 20
  estimatedWallMinutes: 90
  thresholdsTriggered: []
  splitRequired: false
  ownerIndivisibleAuthorization: true
  indivisibleReason: >-
    Owner 2026-08-14 批准 TASK-0195 的 C4 范围：对 TASK-0194 窗口内已验证、当前树中
    机器绑定的 P1 worker lease/fence 继承实现做独立接纳（授权 + manifest 机器绑定 +
    同一候选 SHA 全量复验 + C4 独立复核 + SchemaReadiness 迁移数断言 27→28 机械修复）。
    授权、manifest 绑定与全量复验必须一次成卡原子完成，拆卡会延续实现已存在但未获
    正式授权的悬置状态。
inheritedStateManifest:
  algorithm: SHA256_MANIFEST_V1
  preImplementationBaseline: fb9cf0e178212d6ff554abf7d4695aa114fe0dba
  rejectedTerminal: d1941c9a3b93dcc97a40275f80e65883e511594e
  rejectedTerminalTree: 540a8a71e08fb95a50c931ba2988bb63bed91e92
  adoptionBase: d1941c9a3b93dcc97a40275f80e65883e511594e
  adoptionBaseTree: 540a8a71e08fb95a50c931ba2988bb63bed91e92
  implementationCommit: a4118b0c67eeff285a7c211df15e69de76943ede
  fixCommit: null
  scopeAmendmentCommit: null
  windowDiffPathCount: 33
  governanceExclusionCount: 7
  inheritedPathCount: 26
  orderedPathSetSha256: d6ff85629e82b9c2f0e6c33d3aee15800fd98bc206eb0a6d868f6fd2276f6333
  manifestSha256: e94e66680ffe8c32070009fcf194c0e5278faf52dd97a100ec6213244cfd9b79
  manifestCanonicalization: >-
    entries=[{blob:<40hex>, mode:"100644", path:<posix>}...] sorted by path (codepoint);
    canonical=json.dumps({algorithm:SHA256_MANIFEST_V1, baseCommit:<adoptionBase>,
    paths:entries}, ensure_ascii=False, sort_keys=True, separators=(",",":"));
    manifestSha256=sha256(canonical utf-8).hex(); orderedPathSetSha256=sha256(concat
    of sorted path each followed by LF).utf-8).hex()
  governanceExcludedPaths:
    - .harness/project-state.yaml
    - .harness/task-ledger.yaml
    - docs/evidence/TASK-0194/evidence-pack.json
    - docs/evidence/TASK-0194/review-r1.md
    - docs/handoffs/TASK-0194.json
    - docs/tasks/TASK-0194-worker-lease-fence-transaction-boundary.md
    - docs/tasks/context/TASK-0194.context-lock.yaml
  paths:
    - {path: infra/db/tests/74_attempt_intent_created_before_outbound.sql, mode: "100644", blob: 2e1d6203da4d7b1513a778e46c89570864a880ed}
    - {path: infra/db/tests/75_wall_clock_lease_expires.sql, mode: "100644", blob: 86a8b00403218d8638c2e1f2cc946945ba99630b}
    - {path: infra/db/tests/76_guarded_finalize_requires_explicit_claim.sql, mode: "100644", blob: fc292cd7e6406c545e592c09495efd959aa8db12}
    - {path: infra/db/tests/77_stale_worker_only_closes_intent.sql, mode: "100644", blob: 77c0ecc83f6acb7831f47ccfd76997b0e257533b}
    - {path: infra/db/tests/78_overtaken_claim_zero_business_write.sql, mode: "100644", blob: 820e68b5d835d1e9159b6dc823a4f9e9ff159972}
    - {path: infra/db/tests/79_external_audit_survives_finalize_rollback.sql, mode: "100644", blob: 5950cab8af0b155398cff79719b5b4c6572adcb1}
    - {path: infra/db/tests/80_aborted_tx_independent_per_item_fail.sql, mode: "100644", blob: f4a661760a52b7a58965e605a73d33d3deb392f3}
    - {path: infra/db/tests/81_batch_per_item_terminalize_no_pollution.sql, mode: "100644", blob: c8b6603d59a75fcc686d0954efcd043eebdc5726}
    - {path: infra/db/tests/82_expired_claim_with_intent_not_resent.sql, mode: "100644", blob: 7743733ce2373a8376d0c54f0041e3ba206c535c}
    - {path: infra/db/tests/83_fenced_finalize_happy_path.sql, mode: "100644", blob: a290f9b330abdeb6ab48498e9b289a15ac377809}
    - {path: service/apps/runtime/src/main/java/com/virtualcompanion/runtime/worker/GenerationWorkItemHandler.java, mode: "100644", blob: 5e24eabb1e149d0383d545026cdbc9b5716af2d9}
    - {path: service/apps/runtime/src/main/java/com/virtualcompanion/runtime/worker/LiveInvocationAssembler.java, mode: "100644", blob: 6ef233408e86e035f75a822db24aa9be120f74df}
    - {path: service/apps/runtime/src/main/java/com/virtualcompanion/runtime/worker/WorkItemWorker.java, mode: "100644", blob: b55d41e39dda9694166bc98cdac4eec32d254cfa}
    - {path: service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/tenant/OwnerContextTest.java, mode: "100644", blob: 98b718c3b34ddabfa0a0ec7839764ff9f04e623f}
    - {path: service/apps/runtime/src/test/java/com/virtualcompanion/runtime/worker/GenerationWorkItemHandlerTest.java, mode: "100644", blob: 8b77e98c3f53c11aceb20d76b0e7ca0616bfc8db}
    - {path: service/apps/runtime/src/test/java/com/virtualcompanion/runtime/worker/WorkItemWorkerTest.java, mode: "100644", blob: 5635218c8cbe623c0fc31acf8578f62d215a8d79}
    - {path: service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/ExternalAttemptBinding.java, mode: "100644", blob: 0fd0a01d5d1ca31477812314b28d97745fb7cf63}
    - {path: service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/execution/LiveModelInvoker.java, mode: "100644", blob: 7f70a68ce8043d01a8bbfbd6b257fa8c3d884e18}
    - {path: service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/execution/PreparedInvocation.java, mode: "100644", blob: 02a07d9e6c9d0dcd7f9ad833074cba7ea3507d12}
    - {path: service/modules/modelruntime/src/test/java/com/virtualcompanion/modelruntime/execution/LiveModelInvokerTest.java, mode: "100644", blob: 898de718de111a857a449d77f1f2d74ac9d61533}
    - {path: service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/GenerationFinalizeService.java, mode: "100644", blob: d2e8176a481157d913079b7df6532d17dcd4c608}
    - {path: service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/WorkItemClaim.java, mode: "100644", blob: a4966b83272f60de81d36a92ee274b948d0a5b29}
    - {path: service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/WorkItemClaimService.java, mode: "100644", blob: 6de72b292a6ae942134d4180cec45c6c39e9e993}
    - {path: service/platform/persistence/src/main/resources/db/migration/V28__worker_lease_fence_business_guard.sql, mode: "100644", blob: 386ab92bcc39b11e0bac1b77eb4abb81e794fdd2}
    - {path: service/platform/persistence/src/test/java/com/virtualcompanion/platform/persistence/FinalizeGenerationServiceTest.java, mode: "100644", blob: ceb2ec6c9ce9caa254e64674624d5f109d2da421}
    - {path: service/platform/persistence/src/test/java/com/virtualcompanion/platform/persistence/WorkItemClaimServiceTest.java, mode: "100644", blob: e6af09cda7ad383dd5a1280eb350c01443592024}
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
  - requirements-harness.txt
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
  - docs/tasks/task-card-template.md
  - docs/tasks/TASK-0193-p0-owner-context-rls-inherited-adoption.md
  - docs/tasks/context/TASK-0193.context-lock.yaml
  - docs/evidence/TASK-0193/inherited-manifest.json
  - docs/tasks/TASK-0194-worker-lease-fence-transaction-boundary.md
  - docs/tasks/context/TASK-0194.context-lock.yaml
  - docs/evidence/TASK-0194/evidence-pack.json
  - docs/evidence/TASK-0194/review-r1.md
  - docs/handoffs/TASK-0194.json
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
  - skills/database-migration/SKILL.md
  - skills/model-routing-change/SKILL.md
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/config/SchemaReadinessHealthIndicatorTest.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/SchemaReadinessHealthIndicator.java
  - service/platform/persistence/src/main/resources/db/migration/V28__worker_lease_fence_business_guard.sql
  - infra/db/run-rls-tests.sh
  - specs/contracts/worker-lease-contract.yaml
  - specs/contracts/finalization-contract.yaml
  - specs/contracts/database-ownership-contract.yaml
  - specs/contracts/model-protocol-contract.yaml
  - specs/contracts/authorization-contract.yaml
  - specs/contracts/generation-contract.yaml
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
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/worker/GenerationWorkItemHandler.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/worker/LiveInvocationAssembler.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/worker/WorkItemWorker.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/tenant/OwnerContextTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/worker/GenerationWorkItemHandlerTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/worker/WorkItemWorkerTest.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/ExternalAttemptBinding.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/execution/LiveModelInvoker.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/execution/PreparedInvocation.java
  - service/modules/modelruntime/src/test/java/com/virtualcompanion/modelruntime/execution/LiveModelInvokerTest.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/GenerationFinalizeService.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/WorkItemClaim.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/WorkItemClaimService.java
  - service/platform/persistence/src/test/java/com/virtualcompanion/platform/persistence/FinalizeGenerationServiceTest.java
  - service/platform/persistence/src/test/java/com/virtualcompanion/platform/persistence/WorkItemClaimServiceTest.java
writeAllowlist:
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/config/SchemaReadinessHealthIndicatorTest.java
  - docs/tasks/TASK-0195-p1-worker-lease-fence-inherited-adoption.md
  - docs/tasks/context/TASK-0195.context-lock.yaml
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - docs/evidence/TASK-0195/**
  - docs/handoffs/TASK-0195.json
forbiddenPaths:
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
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/worker/GenerationWorkItemHandler.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/worker/LiveInvocationAssembler.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/worker/WorkItemWorker.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/tenant/OwnerContextTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/worker/GenerationWorkItemHandlerTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/worker/WorkItemWorkerTest.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/ExternalAttemptBinding.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/execution/LiveModelInvoker.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/execution/PreparedInvocation.java
  - service/modules/modelruntime/src/test/java/com/virtualcompanion/modelruntime/execution/LiveModelInvokerTest.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/port/ModelProtocolAdapter.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/port/ModelProtocolSession.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/GenerationFinalizeService.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/WorkItemClaim.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/WorkItemClaimService.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/FinalizeGenerationService.java
  - service/platform/persistence/src/test/java/com/virtualcompanion/platform/persistence/FinalizeGenerationServiceTest.java
  - service/platform/persistence/src/test/java/com/virtualcompanion/platform/persistence/WorkItemClaimServiceTest.java
  - service/platform/persistence/src/main/resources/db/migration/V28__worker_lease_fence_business_guard.sql
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
  - service/platform/persistence/src/main/resources/db/migration/V27__owner_context_cryptographic_binding.sql
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
  - docs/tasks/TASK-0194-worker-lease-fence-transaction-boundary.md
  - docs/tasks/context/TASK-0191.context-lock.yaml
  - docs/tasks/context/TASK-0192.context-lock.yaml
  - docs/tasks/context/TASK-0193.context-lock.yaml
  - docs/tasks/context/TASK-0194.context-lock.yaml
  - docs/evidence/TASK-0191/**
  - docs/evidence/TASK-0192/**
  - docs/evidence/TASK-0193/**
  - docs/evidence/TASK-0194/**
  - docs/handoffs/TASK-0191.json
  - docs/handoffs/TASK-0192.json
  - docs/handoffs/TASK-0193.json
  - docs/handoffs/TASK-0194.json
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
  - docs/tasks/TASK-0194-worker-lease-fence-transaction-boundary.md
  - docs/evidence/TASK-0194/evidence-pack.json
  - docs/handoffs/TASK-0194.json
  - specs/contracts/worker-lease-contract.yaml
  - specs/contracts/finalization-contract.yaml
  - specs/contracts/model-protocol-contract.yaml
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
  - scope: inherited-state-adoption
    approvedBy: repository-owner
    approvedAt: "2026-08-14"
    sourceThreadId: zcode-main-20260814
    evidence: >-
      Owner 2026-08-14 方案 2 决策原文要点：TASK-0194 以真实结果闭合 REJECTED 后，通
      过 canonical task-intake 分配后继永久任务 ID（机器真源派生：现存最大编号 0194，
      下一顺序即 TASK-0195；TASK-0194 卡内同名 advisory 规划文本顺延至后续编号）；后继
      采用 TASK-0193 同型"继承实现正式接纳"——baseCommit 必须为 TASK-0194 真实 REJECTED
      终态提交 d1941c9a3b93dcc97a40275f80e65883e511594e；精确绑定并审计 TASK-0194 留在
      当前树中的继承实现、候选提交 a4118b0、路径集合、mode/blob/tree/hash 和单父链；
      TASK-0194 历史卡、Evidence、Handoff、amendment 与终态结论全部只读 forbidden，
      TASK-0194 必须继续保持 REJECTED；writeAllowlist 含后继治理路径与
      SchemaReadinessHealthIndicatorTest.java（该文件只允许迁移数量断言 27 机械更新为
      28）；业务实现路径作为继承状态绑定并禁止漂移，不得借后继卡重新设计或扩大实现；
      后继候选必须在同一真实 SHA 重新执行 canonical precheck、Maven runtime reactor
      tests、RLS 全套、git diff --check、C4 独立 Reviewer、pre-closure Doctor，不得复用
      TASK-0194 的 PASS 作为后继 Evidence；若 DRAFT、Context Lock、Doctor 和机器合同均
      PASS 且路径没有扩展，可自主进入 READY、完成机械修复、重新形成候选并执行完整验
      收，无需再次请求过程确认。
  - scope: database-migration
    approvedBy: repository-owner
    approvedAt: "2026-08-14"
    sourceThreadId: zcode-main-20260814
    evidence: >-
      Owner 2026-08-14：后继卡 READY 前必须正确冻结 humanApprovals 包含机器 gate 精确
      要求的 scope database-migration；本卡不修改任何 migration（V1-V28 全部 forbidden，
      26 继承路径含 V28 零漂移绑定），该批准用于满足既有 database migration
      protected-path gate 并正式接纳继承的 V28 worker lease/fence 业务守卫迁移；
      TASK-0194 2026-08-14 的 database-migration 安全边界批准（追加式 V28、不改
      V1-V27、保持 FORCE RLS、复合 owner FK、V27 owner 密码学绑定与 current_owner_id
      每调用重校验、业务写显式 work_item_id+claim_token+claim_fence 非 GUC）继续有效。
independentReview: required
reviewers: []
requiredCommands:
  - PATH=/Users/hxf/.zcode/venvs/vc-harness/bin:$PATH python scripts/harness/precheck.py --task TASK-0195
  - JAVA_HOME=/opt/homebrew/opt/openjdk@25/libexec/openjdk.jdk/Contents/Home ./mvnw --batch-mode --no-transfer-progress -pl service/apps/runtime -am test
  - bash infra/db/run-rls-tests.sh
  - git diff --check
terminalStateReason: ""
```

> 本卡为独立延续单卡（前一合法终态：TASK-0194 REJECTED `d1941c9`）。本卡是
> inherited-state adoption/verification task（TASK-0193 同型先例）：TASK-0194 因
> READY 冻结的 requiredSkills/humanApprovals 与 protected-path 机器 gate 不匹配
> （恰 5 项 gate error，amendment 无法修改 AUTHORIZATION_FIELDS）以 REJECTED 真实
> 闭合，其业务实现（候选 `a4118b0` 26 路径）仍在当前树中；本卡对该继承实现做明确
> 授权、manifest 机器绑定、同一候选 SHA 全量复验与独立复核，**不是重新实现**。
> TASK-0194 保持 REJECTED，本卡接纳的对象是当前树中机器绑定的继承实现。
> 永久 ID 由机器真源派生：现存最大任务编号 0194，下一顺序编号即 TASK-0195；
> TASK-0194 卡内 "bounded retry/dead-letter 列串行后续 TASK-0195" 仅为 advisory
> 规划文本（未注册、非机器绑定），该范围顺延至下一顺序编号（暂不创建），本卡
> 以 TASK-0195 注册为继承接纳卡（Owner 2026-08-14 指令）。

## 继承 manifest 确定规则（Owner 冻结，失败关闭）

1. 原实现窗口 = `fb9cf0e178212d6ff554abf7d4695aa114fe0dba`（TASK-0193 ACCEPTED 终态，
  TASK-0194 baseCommit）→ `d1941c9a3b93dcc97a40275f80e65883e511594e`（TASK-0194
  REJECTED 终态，tree `540a8a71e08fb95a50c931ba2988bb63bed91e92`）。
2. `git diff --name-only fb9cf0e d1941c9` 总路径数必须恰为 **33**。
3. 精确排除 7 个 TASK-0194 治理路径（`inheritedStateManifest.governanceExcludedPaths`）。
4. 排除后必须恰为 **26** 个业务、迁移和测试路径（10 个 `infra/db/tests/7[4-9]|8[0-3]_*.sql`
  + 13 个 service 路径 + 1 个 runtime 测试 + …，逐项见 `inheritedStateManifest.paths`）。
5. 对 26 路径逐项绑定 adoptionBase `d1941c9` 中的 path、mode（全部 `100644`）、blob SHA，
  并绑定有序 path-set hash、manifest hash 与树（canonicalization 规则逐字记录于该字段）。
6. 任一路径、数量、mode、blob、来源提交或树不匹配时失败关闭，不得自行调整规则继续。
7. 附加完整性事实（已机器验证并纳入验收）：26 路径在 `a4118b0`（implementationCommit）
  与 `d1941c9`（adoptionBase）的 blob 逐项一致（继承实现未被闭合提交改动，零漂移）；
  窗口内 9 个提交全部单父（`fb9cf0e → f389b1a → 80455a1 → 879da12 → 77fb9f9 →
  f31dd55 → f452180 → a4118b0 → d1941c9`）。

## 任务性质与验证内容

- **授权**：Owner 2026-08-14 批准对继承实现的正式接纳（inherited-state-adoption +
  database-migration 双 scope）；本卡 writeAllowlist 仅含治理路径与
  SchemaReadinessHealthIndicatorTest.java（27→38 机械修复唯一业务写路径）；26 个继承
  路径全部 forbidden（零漂移绑定，不得借本卡重新设计或扩大实现）。
- **机械修复（唯一）**：`SchemaReadinessHealthIndicatorTest.expectedSchemaVersionFromClasspath()`
  断言 `27` → `28`（连同描述该计数的注释同步 V28 事实）；不改其他测试语义。
- **manifest 核验**：按上述规则从 Git 重新计算并逐项比对 `inheritedStateManifest`；
  任何漂移立即失败关闭。
- **全量复验**（四条冻结命令，同一真实候选 SHA，真实退出码，不得复用 TASK-0194 旧
  结果）：canonical precheck、Maven runtime 全量、RLS 全套、`git diff --check`。
- **安全复验矩阵**（由 RLS 74-83 + mvn 测试实证，Reviewer 独立核对覆盖）：intent 在
  outbound 前创建且失败禁外发（74）；lease 按 clock_timestamp 墙钟过期（75）；
  guarded finalize 需显式 work_item+token+fence（GUC-only 失败，76）；stale worker
  仅能闭合既存 intent（77）；overtaken claim 零业务写（78）；intent+outcome 在
  finalize 回滚后存活（79）；aborted tx 后独立新事务仅终止原项（80）；同批 per-item
  terminalize 无污染（81）；有 intent 的过期 claim 不重发（82）；guarded happy path
  原子完成（83）；external 阶段无 JDBC/事务（LiveModelInvokerTest）；分段事务与
  per-item fail（WorkItemWorkerTest/GenerationWorkItemHandlerTest）。

## 范围内

- manifest 核验、SchemaReadiness 迁移数断言 27→28 机械修复、四条验收命令执行、
  C4 独立复核与本卡治理路径（card/context/evidence/handoff/project-state/ledger）。
- 唯一允许的复核修正批次（`maximumFixBatches: 1`）：仅当四条命令或 Reviewer 发现
  缺陷时，且只能修改 `SchemaReadinessHealthIndicatorTest.java` 自身。

## 明确范围外

- 不重新实现、不重构、不修复继承实现（26 继承路径 forbidden 零漂移）；不修改
  V1-V28 任何 migration、历史任务制品与治理真源。
- 不创建 pre-READY maintenance boundary；READY Doctor 因新 blocker 非 PASS 时暂停并
  一次性上报 Owner。
- 不修改 TASK-0191/0192/0193/0194 历史与其终态结论（TASK-0194 保持 REJECTED）。
- 不实现 bounded retry/dead-letter、cooperative 中断（顺延后续卡）。
- 不推送、不合并、不 rebase、不 reset、不改写历史。

## 状态机和失败行为

- manifest 任一项不匹配（数量≠33/7/26、mode/blob/树/来源提交漂移）→ 立即失败关闭
  并上报，不自行调整规则。
- 任一验收命令非 PASS → 记录真实退出码，进入至多一次复核修正（仅
  SchemaReadinessHealthIndicatorTest.java）后重跑；仍非 PASS 或超出批次 →
  REJECTED/暂停上报。
- Reviewer P0/P1 → 停止并合并为一次 Owner 提问。
- 完整 harness unittest discover 因 34 分钟 CI 预算风险未运行时，Evidence 保持
  `NOT_RUN`，不得表述为 PASS 或「CI 完全兼容」。

## 验收标准

1. manifest 机器核验通过：33/7/26、逐路径 mode/blob、path-set hash、manifest hash、
   树与绑定提交全部精确匹配；26 路径 blob 在 implementationCommit 与 adoptionBase
   一致；窗口 9 提交全单父。
2. 四条 `requiredCommands` 以同一真实候选 SHA 真实 PASS（真实退出码记录于 Evidence）；
   canonical precheck 含 licenseCheck 全绿；Maven runtime 345/345（27→28 修复后无
   failure）。
3. C4 独立 Reviewer 审查实际继承实现范围 `fb9cf0e..d1941c9`（非仅本卡治理 diff），
   独立重算 manifest/blob/tree 并重跑快速验收命令，裁决无 P0/P1。
4. diff 仅含 writeAllowlist 路径；V1-V28、TASK-0191/0192/0193/0194 历史制品零修改；
   TASK-0194 仍为 REJECTED；Evidence/Handoff/project-state nextAction 逐字一致；
   Ledger 追加 TASK-0195。
5. 完整 unittest discover 未运行时如实 NOT_RUN；保持未推送、未合并。

## 必跑检查

以 YAML `requiredCommands` 的精确 argv 为准（四条命令绑定同一真实候选 SHA）。

## Evidence Pack

输出到 `docs/evidence/TASK-0195/`（含 `inherited-manifest.json`、`review-r1.md`），
并生成 `docs/handoffs/TASK-0195.json`。

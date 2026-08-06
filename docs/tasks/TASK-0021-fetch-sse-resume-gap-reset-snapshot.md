# TASK-0021：持久化 Fetch-SSE、续传、Gap/Reset/Snapshot

```yaml
taskId: TASK-0021
state: IN_PROGRESS
owner: repository-owner
riskClass: C4
requiredSkills:
  - task-delivery-flow
  - task-intake
  - database-migration
requiredSkillVersions:
  task-delivery-flow: "1.3.6"
  task-intake: "1.2.6"
  database-migration: "1.0.0"
targetSkillVersions: {}
planningBacklog: .harness/task-backlog.yaml
planningContractHash: b72aaf210a9bf2cce2fd351ea65257740d1fa3d6a44156a8dc064831f005fb2a
planningContractHashAlgorithm: SHA256_CANONICAL_JSON_V1
baseCommit: f09a59661711b5ca7957e397128ce7ca364d5771
contextFingerprint: 358ec02f3fe9bb6460960f66d232648974890ff3451866bf4eb4f5f2c078da74
contextLock: docs/tasks/context/TASK-0021.context-lock.yaml
contextFingerprintAlgorithm: SHA256_ORDINAL_SORTED_PATH_EQUALS_HASH_LF_V1
authorizationCommit: b8077e063ea7a5aaa9b71b9a313eac2df6d8d1e5
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
  surfaceId: TASK_0021_REALTIME_RESUME_TICKET_GAP_RESET_SNAPSHOT
  policySurfaces: [AUTHORIZATION]
  distinctCrossRiskSurfaces: 1
  reviewerMinutesEstimate: 15
  terminalCheckMinutesEstimate: 15
  estimatedWallMinutes: 75
  thresholdsTriggered: []
  splitRequired: false
  ownerIndivisibleAuthorization: false
validationPlan: {frozenBefore: READY, policySource: .harness/ci-execution-policy.yaml, selectedChannel: LOCAL_EXACT_TREE_FALLBACK, profile: precheck}
readAllowlist:
  - .gitattributes
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
  - docs/tasks/TASK-0021-fetch-sse-resume-gap-reset-snapshot.md
  - docs/tasks/task-card-template.md
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
  - requirements-harness.txt
  - pom.xml
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
  - skills/database-migration/SKILL.md
  - specs/contracts/realtime-contract.yaml
  - specs/contracts/database-ownership-contract.yaml
  - specs/contracts/finalization-contract.yaml
  - specs/contracts/generation-contract.yaml
  - specs/catalog/realtime-events.yaml
  - specs/catalog/generation-states.yaml
  - specs/catalog/catalog-manifest.yaml
  - specs/catalog/product-scope.yaml
  - specs/catalog/risk-levels.yaml
  - specs/generated/java/com/virtualcompanion/catalog/RealtimeEventType.java
  - specs/generated/java/com/virtualcompanion/catalog/GenerationState.java
  - service/platform/persistence/src/main/resources/db/migration/V2__user_domain_ownership.sql
  - service/platform/persistence/src/main/resources/db/migration/V6__conversation_generation_persistence.sql
  - service/platform/persistence/src/main/resources/db/migration/V7__finalize_generation_usage_quota_outbox.sql
  - infra/db/tests/16_atomic_finalize_commits_all.sql
  - infra/db/tests/17_fault_injection_rolls_back_all.sql
  - infra/db/tests/18_provider_eos_cannot_complete.sql
  - infra/db/run-rls-tests.sh
  - service/platform/persistence/pom.xml
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/FinalizeGenerationService.java
  - service/platform/persistence/src/test/java/com/virtualcompanion/platform/persistence/FinalizeGenerationServiceTest.java
  - scripts/harness/doctor.py
  - scripts/harness/precheck.py
  - scripts/harness/harness_common.py
  - scripts/harness/tests/test_harness.py
  - docs/evidence/TASK-0020/evidence-pack.json
writeAllowlist:
  - docs/tasks/TASK-0021-fetch-sse-resume-gap-reset-snapshot.md
  - docs/tasks/context/TASK-0021.context-lock.yaml
  - docs/evidence/TASK-0021/**
  - docs/handoffs/TASK-0021.json
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - service/platform/persistence/src/main/resources/db/migration/V8__realtime_resume_ticket_gap_reset_snapshot.sql
  - infra/db/tests/19_realtime_ticket_single_use_ttl_hash.sql
  - infra/db/tests/20_resume_resumed_contiguous_cursor.sql
  - infra/db/tests/21_resume_gap_expired_window.sql
  - infra/db/tests/22_resume_reset_required_epoch.sql
  - infra/db/tests/23_resume_terminal_snapshot.sql
  - infra/db/tests/24_resume_not_found_or_forbidden.sql
  - infra/db/tests/25_realtime_event_rls_owner_isolation.sql
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/RealtimeResumeService.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/RealtimeEventRepository.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/RealtimeTicketRepository.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/RealtimeEventRecord.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/ResumeResult.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/StreamSnapshot.java
  - service/platform/persistence/src/test/java/com/virtualcompanion/platform/persistence/RealtimeResumeServiceTest.java
  - service/platform/persistence/src/test/java/com/virtualcompanion/platform/persistence/RealtimeTicketRepositoryTest.java
forbiddenPaths:
  - .gitattributes
  - AGENTS.md
  - CLAUDE.md
  - .github/**
  - ci/**
  - .harness/agent-entrypoints.yaml
  - .harness/ci-execution-policy.yaml
  - .harness/commands.yaml
  - .harness/invariants.yaml
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
  - docs/schemas/**
  - docs/tasks/task-card-template.md
  - requirements-harness.txt
  - scripts/harness/**
  - skills/**
  - specs/**
  - frontend/**
  - deploy/**
  - ops/**
  - docs/source/**
  - service/adapters/**
  - service/apps/**
  - service/modules/**
  - service/platform/catalog/**
  - service/platform/persistence/pom.xml
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/PersistenceConfig.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/ConversationRepository.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/MessageRepository.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/GenerationRepository.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/GenerationRecord.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/GenerationReceiveService.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/FinalizeGenerationService.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/JdbcAuthorizationSnapshotStore.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/JdbcProviderDeploymentRepository.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/ProviderDeploymentRecord.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/WorkItemClaim.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/WorkItemClaimService.java
  - service/platform/persistence/src/main/resources/db/migration/V1__extensions_roles_functions.sql
  - service/platform/persistence/src/main/resources/db/migration/V2__user_domain_ownership.sql
  - service/platform/persistence/src/main/resources/db/migration/V3__authorization_snapshot.sql
  - service/platform/persistence/src/main/resources/db/migration/V4__provider_registry.sql
  - service/platform/persistence/src/main/resources/db/migration/V5__worker_claim_lease_fence.sql
  - service/platform/persistence/src/main/resources/db/migration/V6__conversation_generation_persistence.sql
  - service/platform/persistence/src/main/resources/db/migration/V7__finalize_generation_usage_quota_outbox.sql
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
  - infra/db/tests/11_missing_context_zero_write.sql
  - infra/db/tests/12_coordinator_reads_only_metadata.sql
  - infra/db/tests/13_idempotent_receive_same_generation_id.sql
  - infra/db/tests/14_idempotent_receive_no_duplicate_message.sql
  - infra/db/tests/15_cross_owner_generation_reference_denied.sql
  - infra/db/tests/16_atomic_finalize_commits_all.sql
  - infra/db/tests/17_fault_injection_rolls_back_all.sql
  - infra/db/tests/18_provider_eos_cannot_complete.sql
  - db/**
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
  - skills/database-migration/SKILL.md
  - specs/contracts/realtime-contract.yaml
  - specs/contracts/database-ownership-contract.yaml
  - specs/contracts/finalization-contract.yaml
  - specs/catalog/realtime-events.yaml
  - specs/catalog/generation-states.yaml
  - scripts/harness/doctor.py
  - scripts/harness/tests/test_harness.py
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
requiredInvariants:
  - INV-RT-001
  - INV-TENANT-001
  - INV-TX-001
  - INV-GEN-003
  - INV-HARNESS-001
  - INV-HARNESS-002
  - INV-HARNESS-003
  - INV-HARNESS-004
  - INV-HARNESS-005
  - INV-HARNESS-007
  - INV-HARNESS-009
requiredCommands:
  - python scripts/harness/precheck.py --task TASK-0021
  - python -m unittest discover -s scripts/harness/tests -p test_*.py
  - git diff --check
reviewers: []
independentReview: required
humanApprovals:
  - scope: database-migration
    approvedBy: repository-owner
    approvedAt: "2026-08-06"
    sourceThreadId: long-line-execution-product-conversation
    evidence: >-
      长线执行 Owner 授权 TASK-0021 数据库迁移变更（覆盖 **/db/migration/** 保护路径）：以
      PostgreSQL 持久事件支撑 Fetch-SSE、续传、Gap/Reset/Snapshot 恢复。ALTER vc.realtime_event
      增补 stream_epoch/event_seq/committed_at envelope 字段并加 per-(generation,epoch) 单调唯一索引；
      ALTER vc.generation 增补权威 stream_epoch；新建 vc.realtime_stream（next_seq 高水位 +
      retained_after_seq 低水位，使 GAP_EXPIRED 确定性可测）与 vc.realtime_ticket（单次、hash-only、
      TTL 45s、boundTo 七元组）；新增 SECURITY DEFINER 函数 append_realtime_event/
      issue_realtime_ticket/consume_realtime_ticket/resume_stream/read_generation_snapshot/
      reset_stream_epoch/expire_realtime_window，全部 revoke PUBLIC 仅 grant vc_api、FORCE RLS +
      复合所有权。仅合成数据 SQL 合同测试与纯 Java 单测；不接入真实 SSE runtime 或 HTTP 端点
      （留给 TASK-0022/0025），不伪造缺失 delta，不发布未提交终态事件。
```

> 规划正文仅为非规范的人类可读渲染；唯一机器真源是 `.harness/task-backlog.yaml` 中本 Task ID 的静态合同，并由 `planningContractHash` 完整绑定。

## 目标

以 PostgreSQL 持久事件支撑 Fetch-SSE、续传、Gap、Reset 和 Snapshot 恢复。

## 范围内

- 短期单次 Ticket、epoch、eventSeq 和 Last-Event-ID；
- terminal snapshot、gap/reset 和连续 cursor。

## 明确禁止

- WebSocket；
- 长期凭据进入 URL、query 或实时参数；
- 客户端伪造缺失 delta，或发布未提交终态事件。

## 依赖与决策闸门

- 依赖：TASK-0018、TASK-0020；
- 无独立硬决策闸门。

## 验收

- 断线、过期窗口、epoch 变化和越权恢复均有合同测试；
- 客户端只推进最后连续序号。

## 晋级规则

全部依赖 ACCEPTED 且执行顺序允许时，才可基于最新 main 创建唯一 DRAFT。

# TASK-0017：Conversation/Generation 持久化与幂等接收

```yaml
taskId: TASK-0017
state: DRAFT
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
planningContractHash: cc05cfbf27689f522544685707c14c7a20171e5eff82195cf01493e2f77b61c4
planningContractHashAlgorithm: SHA256_CANONICAL_JSON_V1
baseCommit: f46ab941d3d08e1f6637d126f7d09e7ebcb53b95
authorizationCommit: ""
contextFingerprint: efb4537c8fac421e0375358b149d7d48a483af89a19cb6cce75a18f2a535b969
contextLock: docs/tasks/context/TASK-0017.context-lock.yaml
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
  surfaceId: TASK_0017_CONVERSATION_GENERATION_PERSISTENCE
  policySurfaces: [AUTHORIZATION]
  distinctCrossRiskSurfaces: 1
  reviewerMinutesEstimate: 15
  terminalCheckMinutesEstimate: 15
  estimatedWallMinutes: 75
  thresholdsTriggered: []
  splitRequired: false
  ownerIndivisibleAuthorization: false
validationPlan: {frozenBefore: READY, policySource: .harness/ci-execution-policy.yaml, selectedChannel: LOCAL_EXACT_TREE_FALLBACK, profile: precheck}
databasePolicy:
  policySource: .harness/task-backlog.yaml#testPolicies.database
  engine: POSTGRESQL_18_WITH_PGVECTOR
  image: pgvector/pgvector:0.8.5-pg18
  imageDigest: sha256:12a379b47ad65289572ea0756efc11b7c241a6662833e8af7038cd3b73d647e0
  data: SYNTHETIC_ONLY
  network: TEMPORARY_PORT_ONLY
  storage: TEMPORARY_VOLUME_ONLY
  cleanupRequired: true
  frozenAt: DRAFT
reviewers: []
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
  - docs/tasks/TASK-0017-conversation-generation-persistence.md
  - docs/tasks/TASK-0015-postgresql-flyway-force-rls.md
  - docs/tasks/task-card-template.md
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
  - skills/database-migration/SKILL.md
  - specs/contracts/database-ownership-contract.yaml
  - scripts/harness/doctor.py
  - scripts/harness/precheck.py
  - scripts/harness/harness_common.py
  - scripts/harness/tests/test_harness.py
  - requirements-harness.txt
  - pom.xml
  - service/platform/persistence/pom.xml
  - service/platform/persistence/src/main/resources/db/migration/V2__user_domain_ownership.sql
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/JdbcAuthorizationSnapshotStore.java
  - docs/evidence/TASK-0015/evidence-pack.json
writeAllowlist:
  - docs/tasks/TASK-0017-conversation-generation-persistence.md
  - docs/tasks/context/TASK-0017.context-lock.yaml
  - docs/evidence/TASK-0017/**
  - docs/handoffs/TASK-0017.json
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - service/platform/persistence/src/main/resources/db/migration/V6__conversation_generation_persistence.sql
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/GenerationRecord.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/ConversationRepository.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/MessageRepository.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/GenerationRepository.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/GenerationReceiveService.java
  - service/platform/persistence/src/test/java/com/virtualcompanion/platform/persistence/GenerationReceiveServiceTest.java
  - infra/db/tests/13_idempotent_receive_same_generation_id.sql
  - infra/db/tests/14_idempotent_receive_no_duplicate_message.sql
  - infra/db/tests/15_cross_owner_generation_reference_denied.sql
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
  - service/platform/persistence/src/main/resources/db/migration/V1__extensions_roles_functions.sql
  - service/platform/persistence/src/main/resources/db/migration/V2__user_domain_ownership.sql
  - service/platform/persistence/src/main/resources/db/migration/V3__authorization_snapshot.sql
  - service/platform/persistence/src/main/resources/db/migration/V4__provider_registry.sql
  - service/platform/persistence/src/main/resources/db/migration/V5__worker_claim_lease_fence.sql
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/PersistenceConfig.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/JdbcAuthorizationSnapshotStore.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/JdbcProviderDeploymentRepository.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/ProviderDeploymentRecord.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/WorkItemClaim.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/WorkItemClaimService.java
  - service/platform/persistence/src/test/java/com/virtualcompanion/platform/persistence/AuthorizationSnapshotCodecTest.java
  - service/platform/persistence/src/test/java/com/virtualcompanion/platform/persistence/WorkItemClaimServiceTest.java
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
  - skills/task-intake/SKILL.md
  - skills/database-migration/SKILL.md
  - scripts/harness/doctor.py
  - scripts/harness/tests/test_harness.py
  - specs/contracts/database-ownership-contract.yaml
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
requiredInvariants:
  - INV-GEN-001
  - INV-TENANT-001
  - INV-HARNESS-001
  - INV-HARNESS-002
  - INV-HARNESS-003
  - INV-HARNESS-004
  - INV-HARNESS-005
  - INV-HARNESS-007
  - INV-HARNESS-009
humanApprovals:
  - scope: database-migration
    approvedBy: repository-owner
    approvedAt: "2026-08-06"
    sourceThreadId: long-line-execution-product-conversation
    evidence: >-
      长线执行授权覆盖 TASK-0017 数据库迁移：generation 增加 idempotency_key（每 owner 唯一）、
      SECURITY DEFINER receive_generation 幂等接收（重复接收只返回同一 logical_generation_id 且不重复创建消息），
      以及 Conversation/Message/Generation JDBC 持久化骨架。仅合成数据、一次性临时容器并完整清理；
      不接最终化事务、SSE 或 H5；不更换 generationId。
independentReview: required
requiredCommands:
  - python scripts/harness/precheck.py --task TASK-0017
  - python -m unittest discover -s scripts/harness/tests -p test_*.py
  - git diff --check
```

> 规划正文仅为非规范的人类可读渲染；唯一机器真源是 `.harness/task-backlog.yaml` 中本 Task ID 的静态合同，并由 `planningContractHash` 完整绑定。

## 目标

持久化 Conversation、Message 与 Generation，并保证一个逻辑请求对应稳定 `generationId`（幂等接收）。

## 范围内

- V6 迁移：generation 增加 `idempotency_key`（每 owner 唯一）与 id 序列；`SECURITY DEFINER vc.receive_generation` 幂等接收（首次创建 generation + 用户消息，重复接收只返回同一 logical_generation_id 且不重复建消息）；
- Conversation/Message/Generation JDBC 仓储与 `GenerationReceiveService` 骨架；
- 幂等接收、稳定 generationId 与复合所有权的 SQL + Java 测试。

## 明确禁止

- 重试、降级或模型切换时更换 generationId；客户端 owner 声明成为所有权真源；
- 提前实现最终化事务、SSE 或 H5；修改 V1-V5 或现有产品源码；给运行角色 BYPASSRLS。

## 依赖与决策闸门

- 依赖：TASK-0015（ACCEPTED，提供 conversation/message/generation 表与复合所有权）；
- 无独立硬决策闸门。

## 验收

- 重复接收（同 owner + idempotency_key）只返回同一 logical_generation_id 且消息不重复创建（SQL 测试证明）；
- 跨 owner 的 generation/conversation 引用被复合外键拒绝；所有状态与所有权约束有数据库与集成测试；
- canonical precheck、完整 Python harness 套件（0 failure）、Docker Temurin-25 编译、`git diff --check` 与独立 Reviewer R1 全部 PASS。

## 晋级规则

TASK-0015 ACCEPTED 后晋级 DRAFT 时冻结镜像版本/摘要；PLANNED 阶段不冻结。Java 编译由 Docker Temurin-25 本地验证。

# TASK-0016：Worker Claim、Lease、Fence 与过期写拒绝

```yaml
taskId: TASK-0016
state: ACCEPTED
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
planningContractHash: 84ea97ff95d5e70c94dc15d98e6404a4493f163201642ad0ef65e2da47e1dec5
planningContractHashAlgorithm: SHA256_CANONICAL_JSON_V1
baseCommit: b552b0f22f81eb61a6856f57aad8c5f0cbe3602a
authorizationCommit: cc0225fb17650cd51449c41e5b914266c0d9f9be
contextFingerprint: 7966d94bf8b44895808cdcfc2c4f528f4ca16371073a3e6ca2901b12a5ee5614
contextLock: docs/tasks/context/TASK-0016.context-lock.yaml
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
  overallElapsed:
    anchor: DRAFT_COMMIT
    terminal: TERMINAL_COMMIT
    recordingRequired: true
    resetOrReanchorForbidden: true
  intakeActivation:
    anchor: DRAFT_COMMIT
    terminal: READY_DOCTOR_TERMINAL
    targetWallMinutes: 60
    hardFuseWallMinutes: 90
    timeoutStatus: TIMEOUT
    closureOnlyOverrun: true
  candidateExecution:
    anchor: READY_DOCTOR_PASS_AND_IN_PROGRESS_COMMIT
    notStartedOutcome: NOT_STARTED
    notStartedEligibility:
      readyDoctorNonPassRequired: true
      readyDoctorPassForbidden: true
      inProgressCommitForbidden: true
      candidateFreezeForbidden: true
    candidateDeadlineMinutes: 45
    targetWallMinutes: 60
    hardFuseWallMinutes: 90
    timeoutStatus: TIMEOUT
    closureOnlyOverrun: true
  reviewer:
    maximumMinutes: 15
    timeoutStatus: TIMEOUT
    missingTerminalStatus: UNKNOWN
complexityAssessment:
  policySource: .harness/task-delivery-policy.yaml
  evaluatedBefore: READY
  riskClass: C4
  surfaceId: TASK_0016_WORKER_CLAIM_LEASE_FENCE
  policySurfaces:
    - AUTHORIZATION
  distinctCrossRiskSurfaces: 1
  reviewerMinutesEstimate: 15
  terminalCheckMinutesEstimate: 15
  estimatedWallMinutes: 90
  thresholdsTriggered: []
  splitRequired: false
  ownerIndivisibleAuthorization: false
validationPlan:
  frozenBefore: READY
  policySource: .harness/ci-execution-policy.yaml
  selectedChannel: LOCAL_EXACT_TREE_FALLBACK
  profile: precheck
databasePolicy:
  policySource: .harness/task-backlog.yaml#testPolicies.database
  engine: POSTGRESQL_18_WITH_PGVECTOR
  runtime: WSL2_DOCKER
  data: SYNTHETIC_ONLY
  network: TEMPORARY_PORT_ONLY
  storage: TEMPORARY_VOLUME_ONLY
  cleanupRequired: true
  forbiddenExistingServices: [MYSQL, REDIS, RABBITMQ, KINGBASE]
  image: pgvector/pgvector:0.8.5-pg18
  imageDigest: sha256:12a379b47ad65289572ea0756efc11b7c241a6662833e8af7038cd3b73d647e0
  postgresqlVersion: "18"
  pgvectorVersion: "0.8.5"
  portBinding: EPHEMERAL_HOST_PORT_TO_CONTAINER_5432
  volume: EPHEMERAL_TMPFS_OR_TMP_VOLUME_REMOVED_ON_CLEANUP
  frozenAt: DRAFT
reviewers:
  - id: task0016_r1
    kind: independent-review-gate
    verdict: PASS
    reviewedCommit: ec634f3ca00f684eef4334b0932e7fd954e0de7c
    evidencePath: docs/evidence/TASK-0016/review-r1.md
    reason: R1 P0 (claim_work_items payload leak via PUBLIC EXECUTE) + P2 (vc_worker direct-write) + P3 (unused PUBLIC _claim_is_live) all fixed in ec634f3; R2 PASS no new P0/P1
    candidateTree: da595e06cf0308d21558c45e44a7ede8ea527784
    budget:
      maximumMinutes: 15
      elapsedSeconds: 260
      hardLimitReached: false
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
  - docs/tasks/TASK-0016-worker-claim-lease-fence.md
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
  - service/platform/persistence/src/main/resources/db/migration/V1__extensions_roles_functions.sql
  - service/platform/persistence/src/main/resources/db/migration/V2__user_domain_ownership.sql
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/JdbcAuthorizationSnapshotStore.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/authorization/AuthorizationSnapshot.java
  - docs/evidence/TASK-0015/evidence-pack.json
  - docs/handoffs/TASK-0015.json
writeAllowlist:
  - docs/tasks/TASK-0016-worker-claim-lease-fence.md
  - docs/tasks/context/TASK-0016.context-lock.yaml
  - docs/evidence/TASK-0016/**
  - docs/handoffs/TASK-0016.json
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - service/platform/persistence/src/main/resources/db/migration/V5__worker_claim_lease_fence.sql
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/WorkItemClaim.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/WorkItemClaimService.java
  - service/platform/persistence/src/test/java/com/virtualcompanion/platform/persistence/WorkItemClaimServiceTest.java
  - infra/db/tests/07_claim_binds_context.sql
  - infra/db/tests/08_expired_lease_zero_write.sql
  - infra/db/tests/09_wrong_token_zero_write.sql
  - infra/db/tests/10_stale_fence_zero_write.sql
  - infra/db/tests/11_missing_context_zero_write.sql
  - infra/db/tests/12_coordinator_reads_only_metadata.sql
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
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/PersistenceConfig.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/JdbcAuthorizationSnapshotStore.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/JdbcProviderDeploymentRepository.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/ProviderDeploymentRecord.java
  - service/platform/persistence/src/test/java/com/virtualcompanion/platform/persistence/AuthorizationSnapshotCodecTest.java
  - infra/db/run-rls-tests.sh
  - infra/db/tests/01_cross_user_read_denied.sql
  - infra/db/tests/02_cross_relationship_reference_denied.sql
  - infra/db/tests/03_cross_conversation_reference_denied.sql
  - infra/db/tests/04_stale_worker_fence_denied.sql
  - infra/db/tests/05_missing_context_fail_closed.sql
  - infra/db/tests/06_authorization_snapshot_isolation.sql
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
  - INV-WORKER-001
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
    sourceThreadId: long-line-execution-product-worker
    evidence: >-
      长线执行授权覆盖 TASK-0016 数据库迁移：work_item 表（FORCE RLS）、SECURITY DEFINER
      claim_work_items/续租/完成/失败/取消（token+fence+lease 校验，迟到写零写入）、协调器只读不透明元数据。
      仅合成数据、一次性临时容器、临时端口/卷并完整清理；vc_worker/vc_job_coordinator 无 BYPASSRLS；
      不连接或修改 MySQL、Redis、RabbitMQ、Kingbase。
independentReview: required
requiredCommands:
  - python scripts/harness/precheck.py --task TASK-0016
  - python -m unittest discover -s scripts/harness/tests -p test_*.py
  - git diff --check
```

> 规划正文仅为非规范的人类可读渲染；唯一机器真源是 `.harness/task-backlog.yaml` 中本 Task ID 的静态合同，并由 `planningContractHash` 完整绑定。

## 目标

实现不透明 Claim、Lease、Fence、`SET LOCAL` 租户上下文和所有迟到写拒绝；Worker 只能在有效 claim/lease/fence 与正确租户上下文下写入结果。

## 范围内

- 新增 `work_item` 表（复合所有权 + FORCE RLS）与 `V5` 迁移；
- `claim_work_items`（SECURITY DEFINER，原子领取、绑定 `vc.owner_user_id`+`vc.job_fence`、返回不透明 token）；
- 续租、完成、失败、取消（均校验 token + 当前 fence + 未过期 lease + 匹配 owner，否则零写入）；
- 协调器 `vc_job_coordinator` 仅 SELECT 不透明元数据列（payload 列级隔离）；
- Java `WorkItemClaimService` 骨架与 `infra/db` 跨场景 SQL 测试。

## 明确禁止

- Worker 跨租户扫描；外部队列成为租户授权边界；
- 迟到 Worker 写结果、Usage、消息、事件或记忆任务；
- 修改已执行迁移 V1-V4 或现有 harness/产品源码；给运行角色 BYPASSRLS。

## 依赖与决策闸门

- 依赖：TASK-0015（ACCEPTED，提供 `vc.begin_job_context` 骨架与 FORCE RLS 基线）；
- 无独立硬决策闸门。

## 验收

- 过期 lease、错误 token、旧 fence 与缺失上下文四种迟到写均零写入（SQL 测试逐一证明）；
- `claim_work_items` 原子领取并绑定租户上下文，协调器只读元数据、读不到 payload；
- canonical precheck、完整 Python harness 套件（0 failure）、Docker Temurin-25 编译、`git diff --check` 与独立 Reviewer R1 全部 PASS。

## 晋级规则

TASK-0015 ACCEPTED 后晋级 DRAFT 时冻结镜像版本/摘要与临时资源策略；PLANNED 阶段不冻结这些值。Java 编译由 Docker Temurin-25 本地验证，不再留作残余风险。

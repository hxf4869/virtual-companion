# TASK-0015：PostgreSQL、Flyway、复合所有权和 FORCE RLS

```yaml
taskId: TASK-0015
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
planningContractHash: e59dffb6b7f4f2ea52f2a67113ae266b58c8ee01f293d67099a02540adb94bb4
planningContractHashAlgorithm: SHA256_CANONICAL_JSON_V1
baseCommit: 4330dca734487446c489dc7fd46c0cb71e963f1e
authorizationCommit: ""
contextFingerprint: 95e6c7de585040da84e280dc6f803ee4a3bc19f08d6e21f441e3c2d57a0d3128
contextLock: docs/tasks/context/TASK-0015.context-lock.yaml
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
  surfaceId: TASK_0015_POSTGRESQL_FLYWAY_FORCE_RLS
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
  - docs/tasks/TASK-0015-postgresql-flyway-force-rls.md
  - docs/tasks/task-card-template.md
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
  - skills/database-migration/SKILL.md
  - specs/contracts/database-ownership-contract.yaml
  - specs/contracts/authorization-contract.yaml
  - scripts/harness/doctor.py
  - scripts/harness/precheck.py
  - scripts/harness/harness_common.py
  - requirements-harness.txt
  - pom.xml
  - service/modules/modelruntime/pom.xml
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/authorization/AuthorizationSnapshotStore.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/authorization/AuthorizationSnapshot.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/authorization/AuthorizationSnapshotId.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/authorization/AuthorizationStatus.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/registry/ProviderRegistry.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/registry/ProviderRegistration.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/registry/ProviderDeployment.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/registry/ProviderId.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/registry/AdmissionStatus.java
writeAllowlist:
  - docs/tasks/TASK-0015-postgresql-flyway-force-rls.md
  - docs/tasks/context/TASK-0015.context-lock.yaml
  - docs/evidence/TASK-0015/**
  - docs/handoffs/TASK-0015.json
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - pom.xml
  - service/platform/persistence/pom.xml
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/**
  - service/platform/persistence/src/main/resources/db/migration/**
  - service/platform/persistence/src/test/java/com/virtualcompanion/platform/persistence/**
  - infra/db/**
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
  - service/tests/**
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
  - specs/contracts/authorization-contract.yaml
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
requiredInvariants:
  - INV-TENANT-001
  - INV-GEN-001
  - INV-GEN-002
  - INV-AUTH-001
  - INV-MEM-001
  - INV-WORKER-001
  - INV-HARNESS-001
  - INV-HARNESS-002
  - INV-HARNESS-003
  - INV-HARNESS-004
  - INV-HARNESS-005
  - INV-HARNESS-006
  - INV-HARNESS-007
  - INV-HARNESS-008
  - INV-HARNESS-009
humanApprovals:
  - scope: database-migration
    approvedBy: repository-owner
    approvedAt: "2026-08-05"
    sourceThreadId: long-line-execution-product-database
    evidence: >-
      长线执行授权覆盖 TASK-0015 数据库迁移：PostgreSQL 18 + pgvector、Flyway 前向迁移、
      复合所有权外键、FORCE RLS 与最小权限角色。仅使用合成数据、一次性临时容器、临时端口与临时卷并完整清理；
      vc_api/vc_worker/vc_job_coordinator/vc_dispatcher 无 BYPASSRLS；不连接或修改 MySQL、Redis、RabbitMQ、Kingbase。
independentReview: required
requiredCommands:
  - python scripts/harness/precheck.py --task TASK-0015
  - python -m unittest discover -s scripts/harness/tests -p test_*.py
  - git diff --check
```

> 规划正文仅为非规范的人类可读渲染；唯一机器真源是 `.harness/task-backlog.yaml` 中本 Task ID 的静态合同，并由 `planningContractHash` 完整绑定。

## 目标

建立 PostgreSQL 18 + pgvector、Flyway 前向迁移、复合所有权外键、最小权限角色和 FORCE RLS 基线，
为用户域核心表、授权快照与 Provider Registry 提供持久化骨架，并以一次性临时容器证明跨租户失败关闭。

## 范围内

- 新建平台持久化模块 `service/platform/persistence`：Flyway 接线、数据源与角色配置、JDBC 持久化骨架；
- 用户域核心表（user、relationship、conversation、message、generation、generation_route、generation_attempt、
  generation_candidate、memory_item、memory_evidence）与授权快照、Provider Registry 持久化骨架表；
- `owner_user_id` 复合所有权外键（覆盖契约六条链路）、`ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY`；
- 最小权限角色 `vc_api`、`vc_worker`、`vc_job_coordinator`、`vc_dispatcher`（均无 BYPASSRLS）与应用显式 owner 谓词；
- `infra/db` 一次性 PostgreSQL 18/pgvector 容器编排（临时端口、临时卷、完整清理）与跨租户失败关闭 SQL 测试；
- Evidence、Handoff 与独立 Reviewer 闭环。

## 明确禁止

- API 或 Worker 角色使用 BYPASSRLS；仅靠应用 WHERE 代替数据库所有权约束；
- 连接、读取或修改现有 MySQL、Redis、RabbitMQ、Kingbase 服务或其容器；
- 保存真实数据、真实凭据或长期测试资源；引入长期容器或固定宿主端口；
- 修改已执行迁移、手改生成物、删测或放宽门禁；修改 harness fixture 或现有领域模块源码。

## 依赖与决策闸门

- 依赖：TASK-0014（由 ACCEPTED 永久后继 TASK-0084 经 `REJECTED_CAPABILITY_SUCCESSORS` 满足）；
- 无独立硬决策闸门。

## 验收

- 跨用户、跨关系、跨会话和缺上下文访问在 FORCE RLS 下失败关闭（`cross_user_read_denied`、
  `cross_relationship_reference_denied`、`cross_conversation_reference_denied`、`stale_worker_fence_denied`、
  `missing_context_fail_closed` 五项 SQL 测试全部通过）；
- 一次性 PostgreSQL 18/pgvector 容器仅使用合成数据、临时端口和临时卷并完整清理，运行角色无 BYPASSRLS；
- canonical precheck、Python harness 测试与 `git diff --check` 全部 PASS；独立 Reviewer R1 PASS。

## 晋级规则

TASK-0014 经后继 TASK-0084 满足后，本卡晋级 DRAFT 时动态锁定镜像版本与摘要（`pgvector/pgvector:0.8.5-pg18`@sha256:12a379b4…）、
临时端口/卷与清理命令；PLANNED 阶段不冻结这些值。READY 前冻结验证通道；Java 25 编译与持久化模块单测由远程 exact-SHA CI 验证，
本地以 LOCAL_EXACT_TREE_FALLBACK 记录候选树。

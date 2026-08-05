# TASK-0088：修复 TASK-0015 持久化 ProviderId 导入编译错误

```yaml
taskId: TASK-0088
state: READY
owner: repository-owner
riskClass: C2
requiredSkills:
  - task-delivery-flow
  - task-intake
requiredSkillVersions:
  task-delivery-flow: "1.3.6"
  task-intake: "1.2.6"
targetSkillVersions: {}
baseCommit: a4c6a6863bb06640bd4e9fd06253ab9b37cf284c
authorizationCommit: 0abfdcbfa9c943e1df442f55f84bec7bad5823cc
contextFingerprint: 2abc01e0355c11e1aad98aac3055bf580eba9a60f10d26cca251d46b0faea784
contextLock: docs/tasks/context/TASK-0088.context-lock.yaml
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
  riskClass: C2
  surfaceId: TASK_0088_PERSISTENCE_PROVIDERID_IMPORT_FIX
  policySurfaces: []
  distinctCrossRiskSurfaces: 0
  reviewerMinutesEstimate: 5
  terminalCheckMinutesEstimate: 5
  estimatedWallMinutes: 20
  thresholdsTriggered: []
  splitRequired: false
  ownerIndivisibleAuthorization: false
validationPlan:
  frozenBefore: READY
  policySource: .harness/ci-execution-policy.yaml
  selectedChannel: LOCAL_EXACT_TREE_FALLBACK
  profile: precheck
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
  - docs/tasks/TASK-0087-harness-fixture-backlog-ledger-coupling.md
  - docs/tasks/task-card-template.md
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
  - scripts/harness/doctor.py
  - scripts/harness/precheck.py
  - scripts/harness/harness_common.py
  - requirements-harness.txt
  - pom.xml
  - service/platform/persistence/pom.xml
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/JdbcAuthorizationSnapshotStore.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/registry/ProviderId.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/authorization/AuthorizationSnapshot.java
  - docs/evidence/TASK-0015/evidence-pack.json
  - docs/handoffs/TASK-0015.json
writeAllowlist:
  - docs/tasks/TASK-0088-persistence-providerid-import-fix.md
  - docs/tasks/context/TASK-0088.context-lock.yaml
  - docs/evidence/TASK-0088/**
  - docs/handoffs/TASK-0088.json
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/JdbcAuthorizationSnapshotStore.java
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
  - service/platform/persistence/src/main/resources/db/migration/**
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/PersistenceConfig.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/JdbcProviderDeploymentRepository.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/ProviderDeploymentRecord.java
  - service/platform/persistence/src/test/**
  - service/tests/**
  - infra/**
  - db/**
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
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
  - scripts/harness/doctor.py
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
requiredInvariants:
  - INV-HARNESS-001
  - INV-HARNESS-002
  - INV-HARNESS-003
  - INV-HARNESS-004
  - INV-HARNESS-005
  - INV-HARNESS-007
  - INV-HARNESS-009
humanApprovals:
  - scope: task-intake
    approvedBy: repository-owner
    approvedAt: "2026-08-05"
    sourceThreadId: long-line-execution-product-database
    evidence: >-
      长线执行授权覆盖 TASK-0088 修复：TASK-0015 的 JdbcAuthorizationSnapshotStore 错误地从
      authorization 包导入 ProviderId（实际位于 registry 包），导致 JDK 25 编译失败。本卡单行修正导入包，
      并以 WSL2 Docker（maven:3.9-eclipse-temurin-25-alpine）内 mvn -pl persistence -am test 作为编译 Evidence。
independentReview: not-required
requiredCommands:
  - python scripts/harness/precheck.py --task TASK-0088
  - python -m unittest discover -s scripts/harness/tests -p test_*.py
  - git diff --check
```

> 规划正文仅为非规范的人类可读渲染。

## 目标

修正 TASK-0015 交付的 `JdbcAuthorizationSnapshotStore` 中错误的 `ProviderId` 导入包
（`authorization` → `registry`），使持久化模块在 JDK 25 下真实编译通过。

## 范围内

- 仅修改 `JdbcAuthorizationSnapshotStore.java` 的 `ProviderId` 导入语句；
- 以 WSL2 Docker（`maven:3.9-eclipse-temurin-25-alpine`）内 `mvn -pl service/platform/persistence -am test`
  作为编译 + 单测 Evidence；
- Evidence、Handoff 与 Ledger 闭环。

## 明确禁止

- 修改其他 Java 文件、迁移、SQL 测试或 harness；
- 改变 AuthorizationSnapshotStore 语义或 RLS 行为；
- 跳过真实编译验证而仅以“人工核对”作为 PASS 依据。

## 依赖与决策闸门

- 依赖：TASK-0015 ACCEPTED（其交付代码存在编译错误）；TASK-0087 ACCEPTED（harness 套件已恢复为绿）；
- 无独立硬决策闸门。

## 验收

- `mvn -pl service/platform/persistence -am test` 在 Temurin 25 容器内 PASS（编译通过且
  `AuthorizationSnapshotCodecTest` 通过，modelruntime/catalog 上游测试通过）；
- canonical precheck、Python harness 测试与 `git diff --check` 全部 PASS。

## 晋级规则

本卡为 TASK-0015 编译缺陷的独立非 Backlog 后续修复（结构同 TASK-0084/0085/0087）；
不进入 Backlog 执行顺序。完成后恢复 Backlog 长线至 TASK-0016。

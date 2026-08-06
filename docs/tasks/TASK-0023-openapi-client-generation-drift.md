# TASK-0023：OpenAPI 生成、Client 生成与漂移检查基线

```yaml
taskId: TASK-0023
state: DRAFT
owner: repository-owner
riskClass: C4
requiredSkills:
  - task-delivery-flow
  - task-intake
requiredSkillVersions:
  task-delivery-flow: "1.3.6"
  task-intake: "1.2.6"
targetSkillVersions: {}
planningBacklog: .harness/task-backlog.yaml
planningContractHash: 2ee6fa6fadc9da4e4efa6d378e82452284131b618c30dfa1d3e2689198585467
planningContractHashAlgorithm: SHA256_CANONICAL_JSON_V1
baseCommit: 71f3aebe9e2a940ba77b23bb5ba86ae2bbd0a1ca
contextFingerprint: 11e0012b67f3726e12fd762c829d15ad913a5f8786c281ec09788dad946e5232
contextLock: docs/tasks/context/TASK-0023.context-lock.yaml
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
  surfaceId: TASK_0023_OPENAPI_CLIENT_GENERATION_DRIFT
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
  - docs/tasks/TASK-0023-openapi-client-generation-drift.md
  - docs/tasks/task-card-template.md
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
  - requirements-harness.txt
  - pom.xml
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
  - docs/decisions/0002-persistence-and-contract-first-direction.md
  - specs/generated/openapi/catalog-schemas.yaml
  - specs/catalog/catalog-manifest.yaml
  - specs/catalog/error-codes.yaml
  - specs/catalog/generation-states.yaml
  - specs/catalog/realtime-events.yaml
  - specs/catalog/product-scope.yaml
  - specs/catalog/risk-levels.yaml
  - specs/contracts/identity-session-boundary-contract.yaml
  - scripts/harness/catalog_tool.py
  - scripts/harness/doctor.py
  - scripts/harness/precheck.py
  - scripts/harness/harness_common.py
  - scripts/harness/tests/test_harness.py
  - docs/evidence/TASK-0022/evidence-pack.json
writeAllowlist:
  - docs/tasks/TASK-0023-openapi-client-generation-drift.md
  - docs/tasks/context/TASK-0023.context-lock.yaml
  - docs/evidence/TASK-0023/**
  - docs/handoffs/TASK-0023.json
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - specs/openapi/virtual-companion.yaml
  - specs/openapi/dist/**
  - scripts/dev/openapi_tool.py
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
  - specs/catalog/**
  - specs/contracts/**
  - specs/generated/**
  - frontend/**
  - deploy/**
  - ops/**
  - docs/source/**
  - service/**
  - docs/decisions/**
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
  - docs/decisions/0002-persistence-and-contract-first-direction.md
  - specs/contracts/identity-session-boundary-contract.yaml
  - scripts/harness/catalog_tool.py
  - scripts/harness/doctor.py
  - scripts/harness/tests/test_harness.py
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
requiredInvariants:
  - INV-TENANT-001
  - INV-HARNESS-001
  - INV-HARNESS-002
  - INV-HARNESS-003
  - INV-HARNESS-004
  - INV-HARNESS-005
  - INV-HARNESS-007
  - INV-HARNESS-009
requiredCommands:
  - python scripts/harness/precheck.py --task TASK-0023
  - python -m unittest discover -s scripts/harness/tests -p test_*.py
  - python scripts/dev/openapi_tool.py diff --fail-on-drift
  - git diff --check
reviewers: []
independentReview: required
```

> 规划正文仅为非规范的人类可读渲染；唯一机器真源是 `.harness/task-backlog.yaml` 中本 Task ID 的静态合同，并由 `planningContractHash` 完整绑定。

## 目标

建立 OpenAPI 唯一契约、Java 接口与 TypeScript Client 的确定性生成和漂移门禁。

## 范围内

- OpenAPI 源、生成器锁定和 CI 漂移检查；
- 错误包络与所有权隐藏语义。

## 明确禁止

- 实现代码反向覆盖 OpenAPI；
- 手改生成物；
- 借 API 基线开启公开注册或 Beta。

## 依赖与决策闸门

- 依赖：TASK-0022；
- 无独立硬决策闸门。

## 验收

- 同输入生成字节稳定且漂移失败关闭；
- Java 与 TypeScript 消费同一 OpenAPI 真源。

## 晋级规则

只有 TASK-0022 已 ACCEPTED 且本卡按 Backlog 顺序可晋级时，才动态锁定生成器与精确命令。

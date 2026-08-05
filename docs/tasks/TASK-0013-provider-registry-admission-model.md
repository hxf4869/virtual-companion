# TASK-0013：Provider Registry 与供应商中立准入模型

```yaml
taskId: TASK-0013
state: REJECTED
resolutionReason: >-
  Provider Registry 代码已完成并通过 Doctor 验证（193037 checks），但将 TASK-0013
  晋升为 IN_PROGRESS 破坏了 test_harness.py 中引用 TASK-0013 作为稳定 PLANNED
  样本的 11 个测试。test_harness.py 属于 C4 harness-change 保护路径
  （scripts/harness/**），TASK-0013 声明 C3 model-routing-change，无权修复。
  需创建 harness-change 任务修复 fixture 后以新任务卡重新交付 Provider Registry。
owner: repository-owner
riskClass: C3
planningBacklog: .harness/task-backlog.yaml
planningContractHash: 7a05b2bdb8e3a0bec89b8e8a6a14fa59b803ef29ccb63e5a2e0a2d3398cf67d1
planningContractHashAlgorithm: SHA256_CANONICAL_JSON_V1
requiredSkills:
  - task-delivery-flow
  - task-intake
  - model-routing-change
requiredSkillVersions:
  task-delivery-flow: "1.3.6"
  task-intake: "1.2.6"
  model-routing-change: "1.0.0"
targetSkillVersions: {}
baseCommit: 1d245f1d3f0e2f9627b97db001d4f92178119c34
authorizationCommit: d2580621485d663649076dff59b16bd71e3eed12
contextFingerprint: 891e5c873ec83382bc6e1752fc5e0023c79e6e49c9a3edc11878e72893d242a9
contextLock: docs/tasks/context/TASK-0013.context-lock.yaml
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
  riskClass: C3
  surfaceId: TASK_0013_PROVIDER_REGISTRY_ADMISSION_MODEL
  policySurfaces:
    - MODEL_ROUTING
  distinctCrossRiskSurfaces: 1
  reviewerMinutesEstimate: 15
  terminalCheckMinutesEstimate: 10
  estimatedWallMinutes: 60
  thresholdsTriggered: []
  splitRequired: false
  ownerIndivisibleAuthorization: false
validationPlan:
  frozenBefore: READY
  policySource: .harness/ci-execution-policy.yaml
  selectedChannel: LOCAL_EXACT_TREE_FALLBACK
  profile: HARNESS_PORTABILITY_LOCAL
reviewers:
  - id: task0013_reviewer_not_started
    kind: independent-review-gate-not-started
    verdict: UNKNOWN
    reviewedCommit: null
    evidencePath: docs/evidence/TASK-0013/review-r1.md
    reason: DRAFT_STATE_REVIEWER_NOT_LAUNCHED
    candidateTree: null
    budget:
      maximumMinutes: 15
      elapsedSeconds: 0
      hardLimitReached: false
readAllowlist:
  - .gitattributes
  - AGENTS.md
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
  - .github/workflows/ci.yml
  - docs/evidence/TASK-0059/evidence-pack.json
  - docs/evidence/TASK-0059/review-r1.md
  - docs/handoffs/TASK-0059.json
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
  - docs/tasks/TASK-0013-provider-registry-admission-model.md
  - docs/tasks/TASK-0059-harness-snapshot-receipt-evidence-gate.md
  - docs/tasks/context/TASK-0013.context-lock.yaml
  - docs/tasks/task-card-template.md
  - pom.xml
  - requirements-harness.txt
  - scripts/harness/doctor.py
  - scripts/harness/harness_common.py
  - scripts/harness/precheck.py
  - scripts/harness/tests/test_harness.py
  - service/modules/modelruntime/pom.xml
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/ContractChecks.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/ModelProtocolCapabilities.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/port/ModelProtocolAdapter.java
  - skills/harness-change/SKILL.md
  - skills/model-routing-change/SKILL.md
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
writeAllowlist:
  - docs/tasks/TASK-0013-provider-registry-admission-model.md
  - docs/tasks/context/TASK-0013.context-lock.yaml
  - docs/evidence/TASK-0013/evidence-pack.json
  - docs/evidence/TASK-0013/pre-closure-request.json
  - docs/evidence/TASK-0013/review-r1.md
  - docs/handoffs/TASK-0013.json
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/registry/ProviderId.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/registry/AdmissionStatus.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/registry/ProviderDeployment.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/registry/ProviderRegistration.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/registry/ProviderRegistry.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/registry/InMemoryProviderRegistry.java
  - service/modules/modelruntime/src/test/java/com/virtualcompanion/modelruntime/registry/InMemoryProviderRegistryTest.java
forbiddenPaths:
  - .gitattributes
  - AGENTS.md
  - CLAUDE.md
  - .github/**
  - ci/**
  - .harness/agent-entrypoints.yaml
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
  - docs/evidence/TASK-0059/**
  - docs/handoffs/TASK-0059.json
  - docs/tasks/TASK-0059-harness-snapshot-receipt-evidence-gate.md
  - docs/tasks/context/TASK-0059.context-lock.yaml
  - docs/tasks/task-card-template.md
  - requirements-harness.txt
  - scripts/harness/catalog_tool.py
  - scripts/harness/check_beta_gate.py
  - scripts/harness/check_paid_features.py
  - scripts/harness/durable_command.ps1
  - scripts/harness/harness_common.py
  - scripts/harness/precheck.py
  - scripts/harness/precheck.ps1
  - scripts/harness/precheck.sh
  - scripts/harness/doctor.py
  - scripts/harness/tests/test_harness.py
  - service/adapters/**
  - service/apps/**
  - service/modules/conversation/**
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/port/**
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/**
  - service/platform/**
  - service/tests/**
  - skills/**
  - specs/**
  - frontend/**
  - db/**
  - deploy/**
  - ops/**
  - docs/source/**
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
  - skills/model-routing-change/SKILL.md
  - scripts/harness/doctor.py
  - scripts/harness/harness_common.py
  - scripts/harness/precheck.py
  - scripts/harness/tests/test_harness.py
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
requiredInvariants:
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
  - scope: model-routing-change
    approvedBy: repository-owner
    approvedAt: "2026-08-05"
    sourceThreadId: long-line-execution-authorization
    evidence: >-
      用户长线执行授权覆盖 TASK-0013：Provider Registry 与供应商中立准入模型，
      包括 Provider Registry 核心端口、准入状态、不可变部署标识，
      以及 Fake、Failure 与离线协议 Adapter 的登记边界。不接真实供应商。
independentReview: required
requiredCommands:
  - >-
    python -m unittest discover -s scripts/harness/tests -p test_*.py
  - git diff --check
  - python scripts/harness/doctor.py --task TASK-0013
```

> 规划正文仅为非规范的人类可读渲染；唯一机器真源是 `.harness/task-backlog.yaml` 中本 Task ID 的静态合同，并由 `planningContractHash` 完整绑定。

## 目标

建立供应商中立的 Provider、协议、部署、区域、合同与能力准入模型，不接真实供应商。

## 范围内

- Provider Registry 核心端口、准入状态和不可变部署标识；
- Fake、Failure 与离线协议 Adapter 的登记边界。

## 明确禁止

- 猜测默认供应商、模型、区域或合同；
- 把 Adapter 配置当作业务真源，或让业务层依赖供应商 SDK、模型名或 Key；
- 读取真实凭据或访问真实供应商。

## 依赖与决策闸门

- 依赖：TASK-0012；
- 无独立硬决策闸门。

## 验收

- 供应商中立登记、禁用和能力匹配均有失败关闭测试；
- 业务模块不依赖供应商专属类型。

## 晋级规则

只有 TASK-0012 已 ACCEPTED、仓库空闲且本卡是 Backlog 中首个可晋级任务时，才能补齐当时最新 main 的动态证据并成为唯一 DRAFT。

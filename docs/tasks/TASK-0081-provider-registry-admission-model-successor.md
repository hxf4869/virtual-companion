# TASK-0081：Provider Registry 与供应商中立准入模型（永久后继）

```yaml
taskId: TASK-0081
state: READY
owner: repository-owner
riskClass: C3
requiredSkills:
  - task-delivery-flow
  - task-intake
  - model-routing-change
requiredSkillVersions:
  task-delivery-flow: "1.3.6"
  task-intake: "1.2.6"
  model-routing-change: "1.0.0"
targetSkillVersions: {}
baseCommit: 134d7247d666fea17f15568a44ca557a7f312da4
contextFingerprint: 8366f6218bfac617c5cf034eff9d505d7d3f463b13d7f716d67aece3a5dbc4aa
contextLock: docs/tasks/context/TASK-0081.context-lock.yaml
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
  surfaceId: TASK_0081_PROVIDER_REGISTRY_ADMISSION_MODEL_SUCCESSOR
  policySurfaces:
    - MODEL_ROUTING
  distinctCrossRiskSurfaces: 1
  reviewerMinutesEstimate: 15
  terminalCheckMinutesEstimate: 10
  estimatedWallMinutes: 45
  thresholdsTriggered: []
  splitRequired: false
  ownerIndivisibleAuthorization: false
validationPlan:
  frozenBefore: READY
  policySource: .harness/ci-execution-policy.yaml
  selectedChannel: LOCAL_EXACT_TREE_FALLBACK
  profile: HARNESS_PORTABILITY_LOCAL
reviewers:
  - id: task0081_reviewer_not_started
    kind: independent-review-gate-not-started
    verdict: UNKNOWN
    reviewedCommit: null
    evidencePath: docs/evidence/TASK-0081/review-r1.md
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
  - docs/evidence/TASK-0013/evidence-pack.json
  - docs/evidence/TASK-0080/evidence-pack.json
  - docs/handoffs/TASK-0013.json
  - docs/handoffs/TASK-0080.json
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
  - docs/tasks/TASK-0013-provider-registry-admission-model.md
  - docs/tasks/TASK-0080-harness-fixture-terminal-pointer-isolation.md
  - docs/tasks/TASK-0081-provider-registry-admission-model-successor.md
  - docs/tasks/context/TASK-0081.context-lock.yaml
  - docs/tasks/task-card-template.md
  - requirements-harness.txt
  - scripts/harness/doctor.py
  - scripts/harness/harness_common.py
  - scripts/harness/precheck.py
  - scripts/harness/tests/test_harness.py
  - service/modules/modelruntime/pom.xml
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/ContractChecks.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/ModelProtocolCapabilities.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/port/ModelProtocolAdapter.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/registry/AdmissionStatus.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/registry/InMemoryProviderRegistry.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/registry/ProviderDeployment.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/registry/ProviderId.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/registry/ProviderRegistration.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/registry/ProviderRegistry.java
  - service/modules/modelruntime/src/test/java/com/virtualcompanion/modelruntime/registry/InMemoryProviderRegistryTest.java
  - skills/model-routing-change/SKILL.md
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
writeAllowlist:
  - docs/tasks/TASK-0081-provider-registry-admission-model-successor.md
  - docs/tasks/context/TASK-0081.context-lock.yaml
  - docs/evidence/TASK-0081/evidence-pack.json
  - docs/evidence/TASK-0081/pre-closure-request.json
  - docs/evidence/TASK-0081/review-r1.md
  - docs/handoffs/TASK-0081.json
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
  - docs/evidence/TASK-0013/**
  - docs/evidence/TASK-0080/**
  - docs/handoffs/TASK-0013.json
  - docs/handoffs/TASK-0080.json
  - docs/tasks/TASK-0013-provider-registry-admission-model.md
  - docs/tasks/TASK-0080-harness-fixture-terminal-pointer-isolation.md
  - docs/tasks/context/TASK-0013.context-lock.yaml
  - docs/tasks/context/TASK-0080.context-lock.yaml
  - docs/tasks/task-card-template.md
  - requirements-harness.txt
  - scripts/harness/**
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
      用户长线执行授权与「按你的建议来」覆盖 Provider Registry 后继。
      TASK-0078/0080 已修复 fixture 耦合。本卡验收已合入 main 的 registry
      源码与 fail-closed 测试，不接真实供应商。
independentReview: required
requiredCommands:
  - >-
    python -m unittest discover -s scripts/harness/tests -p test_*.py
  - git diff --check
  - python scripts/harness/doctor.py --task TASK-0081
```

## 目标

建立供应商中立的 Provider、协议、部署与能力准入模型，不接真实供应商。
本卡是 TASK-0013/0079 的永久后继：验收已合入 main 的 registry 实现。

## 范围内

- Provider Registry 核心端口、准入状态和不可变部署标识（已合入源码验收）；
- Fake、Failure 与离线协议 Adapter 的登记边界（fail-closed 测试验收）；
- 独立 Reviewer 与 Evidence/Handoff 闭环。

## 明确禁止

- 猜测默认供应商、模型、区域或合同；
- 业务层依赖供应商 SDK、模型名或 Key；
- 读取真实凭据或访问真实供应商；
- 修改 harness 测试 fixture。

## 依赖与决策闸门

- 依赖：TASK-0080 ACCEPTED（fixture 终态指针隔离）；TASK-0013/0079 REJECTED（前驱）；
- 无独立硬决策闸门。

## 验收

- 供应商中立登记、禁用和能力匹配均有失败关闭测试（源码已在 main）；
- 业务模块不依赖供应商专属类型；
- Doctor PASS；Python harness 测试 PASS；独立 Reviewer PASS。

## 背景

TASK-0013 实现了完整 Provider Registry（6 main + 1 test）并合入 main，但 fixture 耦合导致
两次 REJECTED。TASK-0078/0080 已永久修复。本卡以干净 base 验收已合入代码并完成闭环。

# TASK-0084：授权快照与 Execution Authorization Guard（永久后继）

```yaml
taskId: TASK-0084
state: ACCEPTED
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
baseCommit: 33bd2e6cad582807be55f16cd458b9debf4a0ed3
authorizationCommit: ee3f567baedc39132af9f534b623019a58b56507
contextFingerprint: 31f70cb3f435ddd5c3e8f26bd6e17b66d9c406132b6da891fcc65d454c1988ee
contextLock: docs/tasks/context/TASK-0084.context-lock.yaml
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
  surfaceId: TASK_0084_EXECUTION_AUTHORIZATION_GUARD_SUCCESSOR
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
  - id: task0084_r1
    kind: independent-review-gate
    verdict: PASS
    reviewedCommit: ec45ce4cf39979606fee9070e81bfdab37c715ec
    evidencePath: docs/evidence/TASK-0084/review-r1.md
    reason: null
    candidateTree: dcc5a7e067a588a40393f7261e3f8b5ddf9657dc
    budget:
      maximumMinutes: 15
      elapsedSeconds: 240
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
  - docs/evidence/TASK-0014/evidence-pack.json
  - docs/evidence/TASK-0083/evidence-pack.json
  - docs/handoffs/TASK-0014.json
  - docs/handoffs/TASK-0083.json
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
  - docs/tasks/TASK-0014-execution-authorization-guard.md
  - docs/tasks/TASK-0083-backlog-planned-fixture-generalization.md
  - docs/tasks/TASK-0084-execution-authorization-guard-successor.md
  - docs/tasks/context/TASK-0084.context-lock.yaml
  - docs/tasks/task-card-template.md
  - requirements-harness.txt
  - scripts/harness/doctor.py
  - scripts/harness/harness_common.py
  - scripts/harness/precheck.py
  - scripts/harness/tests/test_harness.py
  - service/modules/modelruntime/pom.xml
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/authorization/AuthorizationSnapshot.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/authorization/AuthorizationSnapshotId.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/authorization/AuthorizationSnapshotStore.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/authorization/AuthorizationStatus.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/authorization/DataCategory.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/authorization/ExecutionAuthorizationDecision.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/authorization/ExecutionAuthorizationGuard.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/authorization/InMemoryAuthorizationSnapshotStore.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/authorization/ProcessingPurpose.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/authorization/ProviderContractRef.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/authorization/ProviderRegion.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/authorization/QuotaAction.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/InvocationBinding.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/OwnershipTuple.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/registry/ProviderId.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/registry/ProviderRegistry.java
  - service/modules/modelruntime/src/test/java/com/virtualcompanion/modelruntime/authorization/ExecutionAuthorizationGuardTest.java
  - specs/contracts/authorization-contract.yaml
  - skills/model-routing-change/SKILL.md
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
writeAllowlist:
  - docs/tasks/TASK-0084-execution-authorization-guard-successor.md
  - docs/tasks/context/TASK-0084.context-lock.yaml
  - docs/evidence/TASK-0084/evidence-pack.json
  - docs/evidence/TASK-0084/pre-closure-request.json
  - docs/evidence/TASK-0084/review-r1.md
  - docs/handoffs/TASK-0084.json
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/authorization/AuthorizationSnapshot.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/authorization/AuthorizationSnapshotId.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/authorization/AuthorizationSnapshotStore.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/authorization/AuthorizationStatus.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/authorization/DataCategory.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/authorization/ExecutionAuthorizationDecision.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/authorization/ExecutionAuthorizationGuard.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/authorization/InMemoryAuthorizationSnapshotStore.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/authorization/ProcessingPurpose.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/authorization/ProviderContractRef.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/authorization/ProviderRegion.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/authorization/QuotaAction.java
  - service/modules/modelruntime/src/test/java/com/virtualcompanion/modelruntime/authorization/ExecutionAuthorizationGuardTest.java
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
  - docs/evidence/TASK-0014/**
  - docs/evidence/TASK-0083/**
  - docs/handoffs/TASK-0014.json
  - docs/handoffs/TASK-0083.json
  - docs/tasks/TASK-0014-execution-authorization-guard.md
  - docs/tasks/TASK-0083-backlog-planned-fixture-generalization.md
  - docs/tasks/context/TASK-0014.context-lock.yaml
  - docs/tasks/context/TASK-0083.context-lock.yaml
  - docs/tasks/task-card-template.md
  - requirements-harness.txt
  - scripts/harness/**
  - service/adapters/**
  - service/apps/**
  - service/modules/conversation/**
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/port/**
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/**
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/registry/**
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/guard/**
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
  - scripts/harness/tests/test_harness.py
  - specs/contracts/authorization-contract.yaml
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
      用户长线执行授权与「按你的建议来」覆盖 TASK-0014 后继。
      TASK-0083 已泛化 fixture。本卡验收已合入 main 的授权快照与
      ExecutionAuthorizationGuard，不接真实 Provider。
independentReview: required
requiredCommands:
  - >-
    python -m unittest discover -s scripts/harness/tests -p test_*.py
  - git diff --check
  - python scripts/harness/doctor.py --task TASK-0084
```

## 目标

实现请求时与执行时授权快照及统一外发 Guard，撤销或收窄后零外发。
本卡是 TASK-0014 的永久后继：验收已合入 main 的实现。

## 范围内

- requested/execution AuthorizationSnapshot 领域模型（已合入）；
- ExecutionAuthorizationGuard 双快照、撤销/收窄、Provider 准入、额度释放（已合入）；
- 独立 Reviewer 与 Evidence/Handoff 闭环。

## 明确禁止

- 复用已撤销授权执行待处理工作；
- Guard 失败后降级为真实外发；
- 接入真实 Provider 或身份供应商；
- 修改 harness fixture。

## 依赖与决策闸门

- 依赖：TASK-0083 ACCEPTED（fixture 泛化）；TASK-0014 REJECTED（前驱）；
- 无独立硬决策闸门。

## 验收

- 外部 attempt 强制绑定双快照；
- 撤销/收窄/区域或合同失效均取消并释放额度；
- Doctor PASS；Python harness 测试 PASS；独立 Reviewer PASS。

# TASK-0022：Fake/Failure 后端离线端到端纵切

```yaml
taskId: TASK-0022
state: ACCEPTED
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
planningContractHash: 16b6aafc725373a04279f93714ca97da46e01f32af51696421bd5784c0686c3d
planningContractHashAlgorithm: SHA256_CANONICAL_JSON_V1
baseCommit: 939db37dadc9b50e2a9f161a472c338f6e8dc5a2
contextFingerprint: 4d99fff84a37a5024aaef10b14f9f2fbfec4f435526c9653cd472c938be10b6c
contextLock: docs/tasks/context/TASK-0022.context-lock.yaml
contextFingerprintAlgorithm: SHA256_ORDINAL_SORTED_PATH_EQUALS_HASH_LF_V1
authorizationCommit: 437a973ee06488ecfdd669b54a77048f54fb33b5
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
  surfaceId: TASK_0022_FAKE_FAILURE_OFFLINE_E2E_SLICE
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
  - docs/tasks/TASK-0022-fake-failure-offline-e2e-slice.md
  - docs/tasks/task-card-template.md
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
  - requirements-harness.txt
  - pom.xml
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
  - specs/contracts/generation-contract.yaml
  - specs/contracts/model-protocol-contract.yaml
  - specs/contracts/safety-fail-closed-contract.yaml
  - specs/contracts/worker-lease-contract.yaml
  - specs/contracts/authorization-contract.yaml
  - specs/contracts/realtime-contract.yaml
  - specs/contracts/finalization-contract.yaml
  - specs/catalog/generation-states.yaml
  - specs/catalog/realtime-events.yaml
  - specs/catalog/model-protocols.yaml
  - specs/catalog/provider-attempt-statuses.yaml
  - specs/catalog/route-decision-statuses.yaml
  - specs/catalog/product-scope.yaml
  - specs/catalog/risk-levels.yaml
  - specs/catalog/catalog-manifest.yaml
  - specs/generated/java/com/virtualcompanion/catalog/GenerationState.java
  - specs/generated/java/com/virtualcompanion/catalog/SafetyClassifierOutcome.java
  - specs/generated/java/com/virtualcompanion/catalog/ModelProtocol.java
  - service/tests/generation-contract-tests/pom.xml
  - service/tests/generation-contract-tests/src/test/java/com/virtualcompanion/generation/contract/GenerationContractTestSupport.java
  - service/tests/generation-contract-tests/src/test/java/com/virtualcompanion/generation/contract/GenerationAttemptReducerContractTest.java
  - service/tests/generation-contract-tests/src/test/java/com/virtualcompanion/generation/contract/GenerationPublicBoundaryContractTest.java
  - service/modules/conversation/pom.xml
  - service/modules/conversation/src/main/java/com/virtualcompanion/conversation/generation/GenerationAttemptReducer.java
  - service/modules/conversation/src/main/java/com/virtualcompanion/conversation/generation/AttemptTermination.java
  - service/modules/conversation/src/main/java/com/virtualcompanion/conversation/generation/AttemptOutcome.java
  - service/modules/conversation/src/main/java/com/virtualcompanion/conversation/generation/AttemptEventResult.java
  - service/modules/conversation/src/main/java/com/virtualcompanion/conversation/generation/FrozenGenerationCandidate.java
  - service/modules/conversation/src/main/java/com/virtualcompanion/conversation/generation/CandidateContent.java
  - service/modules/modelruntime/pom.xml
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/authorization/ExecutionAuthorizationGuard.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/registry/InMemoryProviderRegistry.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/authorization/InMemoryAuthorizationSnapshotStore.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/port/ModelProtocolAdapter.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/ModelProtocolEvent.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/InvocationBinding.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/ModelProtocolRequest.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/AdapterFailure.java
  - service/modules/safety/pom.xml
  - service/modules/safety/src/main/java/com/virtualcompanion/safety/SafetyGate.java
  - service/modules/safety/src/main/java/com/virtualcompanion/safety/SafetyReview.java
  - service/modules/safety/src/main/java/com/virtualcompanion/safety/ClassifierReport.java
  - service/modules/safety/src/main/java/com/virtualcompanion/safety/SafetyVerdict.java
  - service/modules/safety/src/main/java/com/virtualcompanion/safety/DeterministicSafetyResponse.java
  - service/adapters/model-fake/pom.xml
  - service/adapters/model-fake/src/main/java/com/virtualcompanion/modelfake/FakeModelProtocolAdapter.java
  - service/adapters/model-failure/pom.xml
  - service/adapters/model-failure/src/main/java/com/virtualcompanion/modelfailure/FailureModelProtocolAdapter.java
  - service/adapters/model-failure/src/main/java/com/virtualcompanion/modelfailure/FailureScenario.java
  - scripts/harness/doctor.py
  - scripts/harness/precheck.py
  - scripts/harness/harness_common.py
  - scripts/harness/tests/test_harness.py
  - docs/evidence/TASK-0021/evidence-pack.json
writeAllowlist:
  - docs/tasks/TASK-0022-fake-failure-offline-e2e-slice.md
  - docs/tasks/context/TASK-0022.context-lock.yaml
  - docs/evidence/TASK-0022/**
  - docs/handoffs/TASK-0022.json
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - service/tests/generation-contract-tests/src/test/java/com/virtualcompanion/generation/contract/OfflineGenerationSlice.java
  - service/tests/generation-contract-tests/src/test/java/com/virtualcompanion/generation/contract/OfflineGenerationSliceTest.java
  - service/tests/generation-contract-tests/src/test/java/com/virtualcompanion/generation/contract/SliceTerminalState.java
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
  - service/platform/**
  - service/tests/generation-contract-tests/pom.xml
  - service/tests/generation-contract-tests/src/test/java/com/virtualcompanion/generation/contract/GenerationContractTestSupport.java
  - service/tests/generation-contract-tests/src/test/java/com/virtualcompanion/generation/contract/GenerationAttemptReducerContractTest.java
  - service/tests/generation-contract-tests/src/test/java/com/virtualcompanion/generation/contract/GenerationCandidateSetContractTest.java
  - service/tests/generation-contract-tests/src/test/java/com/virtualcompanion/generation/contract/CandidateContentAddressContractTest.java
  - service/tests/generation-contract-tests/src/test/java/com/virtualcompanion/generation/contract/GenerationPublicBoundaryContractTest.java
  - service/tests/model-protocol-contract-tests/**
  - service/tests/openai-chat-completions-contract-tests/**
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
  - specs/contracts/generation-contract.yaml
  - specs/contracts/model-protocol-contract.yaml
  - specs/contracts/safety-fail-closed-contract.yaml
  - specs/contracts/authorization-contract.yaml
  - scripts/harness/doctor.py
  - scripts/harness/tests/test_harness.py
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
requiredInvariants:
  - INV-GEN-001
  - INV-GEN-002
  - INV-GEN-003
  - INV-RT-001
  - INV-TX-001
  - INV-AUTH-001
  - INV-HARNESS-001
  - INV-HARNESS-002
  - INV-HARNESS-003
  - INV-HARNESS-004
  - INV-HARNESS-005
  - INV-HARNESS-007
  - INV-HARNESS-009
requiredCommands:
  - python scripts/harness/precheck.py --task TASK-0022
  - python -m unittest discover -s scripts/harness/tests -p test_*.py
  - git diff --check
reviewers:
  - id: task0022_r1
    kind: independent-review-gate
    verdict: PASS
    reviewedCommit: 69d782b09ff44fca65c978ca22e21e7896c59a67
    evidencePath: docs/evidence/TASK-0022/review-r1.md
    reason: R1 PASS (no P0/P1) on candidate 69d782b. READY-frozen writeAllowlist/forbiddenPaths untouched. Authorization denial returns before adapter.open (zero outbound transfer, INV-AUTH-001). LATE_DELTA stale-fence prefix discarded on BINDING_MISMATCH then failure on SEQUENCE_MISMATCH -> FAILED_INVALID_STREAM (no fabricated delta, INV-RT-001). safetyAllowsCompletion=false -> BLOCKED_AT_SAFETY, only COMPLETED signals completion (INV-GEN-003). mapFailure + termination chain exhaustive over sealed types. 13 fault classes -> 13 distinct terminal states. P2 card body mentions recovery but acceptance omits it and handoff clarifies; P3 failure() factory footgun for CANCELLATION_FAILED (tests use raw constructor).
    candidateTree: 1382e9ea878a60811a9b4c71ee56a239f7d68a0d
    budget:
      maximumMinutes: 15
      elapsedSeconds: 378
      hardLimitReached: false
independentReview: required
humanApprovals:
  - scope: task-authorization
    approvedBy: repository-owner
    approvedAt: "2026-08-06"
    sourceThreadId: long-line-execution-product-conversation
    evidence: >-
      长线执行 Owner 授权 TASK-0022 离线端到端纵切（进程内合成测试，不触碰 protected 路径）：
      用 Fake（成功）与 Failure（9 故障场景）适配器 + 合成授权快照/Provider Registry，把
      ExecutionAuthorizationGuard → ModelProtocolAdapter → GenerationAttemptReducer →
      SafetyGate/SafetyReview 接成可重复纵切，映射唯一终态（成功/失败/取消/超时/safety BLOCK）。
      零真实外发、零真实数据、零真实凭据；JDBC 服务（receive/claim/finalize/resume）的 DB 行为
      已由现有 SQL 合同套件（tests 01-25）证明，本卡只接进程内 model-runtime 纵切。仅合成数据
      Java 单测；不实现 H5 界面，不引入 testcontainers（留给后续完整 DB 纵切）。
```

> 规划正文仅为非规范的人类可读渲染；唯一机器真源是 `.harness/task-backlog.yaml` 中本 Task ID 的静态合同，并由 `planningContractHash` 完整绑定。

## 目标

用 Fake、Failure 和合成数据贯通接收、授权、Worker、安全、最终化与恢复。

## 范围内

- 完整离线成功、失败、取消、超时和恢复纵切；
- `127.0.0.1` 或进程内合成测试。

## 明确禁止

- 读取真实凭据、访问真实 Provider 或使用真实数据；
- 失败时绕过 Guard、安全或 Fence；
- 提前实现 H5 产品界面。

## 依赖与决策闸门

- 依赖：TASK-0016、TASK-0019、TASK-0021；
- 无独立硬决策闸门。

## 验收

- Fake 成功与 Failure 故障矩阵端到端可重复；
- 零真实外发、零真实数据且所有终态唯一。

## 晋级规则

全部依赖 ACCEPTED、仓库空闲且本卡为首个可晋级项时，才能绑定安全 Skill、人工批准和精确测试成为唯一 DRAFT。

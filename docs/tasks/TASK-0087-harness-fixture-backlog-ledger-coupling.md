# TASK-0087：harness 测试 fixture 对首个进入 Ledger 的 Backlog 产品卡的耦合

```yaml
taskId: TASK-0087
state: ACCEPTED
owner: repository-owner
riskClass: C4
requiredSkills:
  - task-delivery-flow
  - task-intake
  - harness-change
requiredSkillVersions:
  task-delivery-flow: "1.3.6"
  task-intake: "1.2.6"
  harness-change: "1.1.6"
targetSkillVersions: {}
baseCommit: c2356197e227f69495a26eb6f90b2ffda6c8a456
authorizationCommit: 6ff17814410ad1d9b47b55e0c2bb16afa6b8602b
contextFingerprint: 3577b0b9a2d3713e144135e46a93afc64dac045dec3949058196e17b2c696fa8
contextLock: docs/tasks/context/TASK-0087.context-lock.yaml
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
  surfaceId: TASK_0087_HARNESS_FIXTURE_BACKLOG_LEDGER_COUPLING
  policySurfaces:
    - GOVERNANCE
  distinctCrossRiskSurfaces: 1
  reviewerMinutesEstimate: 10
  terminalCheckMinutesEstimate: 15
  estimatedWallMinutes: 30
  thresholdsTriggered: []
  splitRequired: false
  ownerIndivisibleAuthorization: false
validationPlan:
  frozenBefore: READY
  policySource: .harness/ci-execution-policy.yaml
  selectedChannel: LOCAL_EXACT_TREE_FALLBACK
  profile: precheck
reviewers:
  - id: task0087_r1
    kind: independent-review-gate
    verdict: PASS
    reviewedCommit: 6f6b2dab7d02a98fd1c657a98882da34772b2937
    evidencePath: docs/evidence/TASK-0087/review-r1.md
    reason: No fail-closed weakening; correct dropped-vs-retained partition; load_inputs fallback sound and history-preserving
    candidateTree: 59ef0118a29bb8dcb9e5568a456da59706fb9b39
    budget:
      maximumMinutes: 15
      elapsedSeconds: 379
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
  - docs/tasks/TASK-0015-postgresql-flyway-force-rls.md
  - docs/tasks/task-card-template.md
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
  - skills/harness-change/SKILL.md
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
  - scripts/harness/doctor.py
  - scripts/harness/precheck.py
  - scripts/harness/harness_common.py
  - scripts/harness/tests/test_harness.py
  - requirements-harness.txt
  - docs/evidence/TASK-0015/evidence-pack.json
writeAllowlist:
  - docs/tasks/TASK-0087-harness-fixture-backlog-ledger-coupling.md
  - docs/tasks/context/TASK-0087.context-lock.yaml
  - docs/evidence/TASK-0087/**
  - docs/handoffs/TASK-0087.json
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - scripts/harness/tests/test_harness.py
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
  - scripts/harness/doctor.py
  - scripts/harness/precheck.py
  - scripts/harness/harness_common.py
  - skills/**
  - specs/**
  - frontend/**
  - deploy/**
  - ops/**
  - docs/source/**
  - service/**
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
  - skills/harness-change/SKILL.md
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
  - scripts/harness/doctor.py
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
requiredInvariants:
  - INV-HARNESS-001
  - INV-HARNESS-002
  - INV-HARNESS-003
  - INV-HARNESS-005
  - INV-HARNESS-006
  - INV-HARNESS-007
humanApprovals:
  - scope: harness-change
    approvedBy: repository-owner
    approvedAt: "2026-08-05"
    sourceThreadId: long-line-execution-product-database
    evidence: >-
      长线执行授权覆盖 TASK-0087 harness 修复：TASK-0015 是首个进入 Task Ledger 的 Backlog 产品卡，
      test_harness.py 的 planning-terminal 用例硬编码 pop TASK-0013/0014 而未含 TASK-0015，
      致使 fixture 恢复的 PLANNED 卡与 Ledger 的 ACCEPTED 条目比较失败、套件在 main 上转红。
      本卡把硬编码 pop 泛化为“剔除 fixture 恢复为非终态的 backlog 卡”，不弱化失败关闭。
independentReview: required
requiredCommands:
  - python scripts/harness/precheck.py --task TASK-0087
  - python -m unittest discover -s scripts/harness/tests -p test_*.py
  - git diff --check
```

> 规划正文仅为非规范的人类可读渲染。

## 目标

恢复 harness 测试套件为绿：把 `test_planning_terminal_card_is_atomic_and_does_not_consume_task_ledger`
中硬编码的 `pop TASK-0013/0014` 泛化为“剔除所有被 fixture 恢复为非终态的 Backlog 卡”，
使首个进入 Ledger 的 Backlog 产品卡 TASK-0015（及未来同类卡）不再破坏机械 fixture 比较。

## 范围内

- 仅修改 `scripts/harness/tests/test_harness.py` 中上述用例的 ledger 过滤逻辑；
- 保持失败关闭语义不变（只剔除 fixture 恢复为 PLANNED 的卡，仍校验其余 Ledger 条目）；
- Evidence、Handoff、独立 Reviewer 与 Ledger 闭环。

## 明确禁止

- 弱化任何断言、删除测试或新增 skip 以制造通过；
- 修改 doctor.py、其他测试或任何非测试 harness 真源；
- 改变 validate_task_ledger_entries 语义。

## 依赖与决策闸门

- 依赖：TASK-0015 ACCEPTED（其 Ledger 条目触发该耦合）；
- 无独立硬决策闸门。

## 验收

- `python -m unittest discover -s scripts/harness/tests -p test_*.py` 恢复 PASS（0 failure），
  且被改写的用例仍真实校验 planning-only SUPERSEDED 不进 Ledger；
- canonical precheck、`git diff --check` 与独立 Reviewer R1 全部 PASS。

## 晋级规则

本卡为非 Backlog 的 harness-change 后续修复（结构同既有 harness 治理卡）；不进入 Backlog 执行顺序。
TASK-0015 的 Java 编译修复由独立后续卡（TASK-0088）承接，本卡只修 fixture。

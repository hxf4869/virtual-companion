# TASK-0056：Idle planning checkpoint 四消费者接线与 CI 闭环

```yaml
taskId: TASK-0056
state: IN_PROGRESS
owner: repository-owner
riskClass: C4
planningBacklog: .harness/task-backlog.yaml
planningContractHash: 05041efa7a07ccf92a085726ff5c1d053e9e3e5631490be10826309fec8643f3
planningContractHashAlgorithm: SHA256_CANONICAL_JSON_V1
requiredSkills:
  - task-delivery-flow
  - task-intake
  - harness-change
requiredSkillVersions:
  task-delivery-flow: "1.3.6"
  task-intake: "1.2.6"
  harness-change: "1.1.6"
targetSkillVersions:
  task-delivery-flow: "1.3.6"
  task-intake: "1.2.6"
  harness-change: "1.1.6"
baseCommit: 2244ec2f63333ee76fea011a13b7960c29da8d92
authorizationCommit: 510a807d31a08327332bf62e96e2d0534e4339ab
contextFingerprint: 78345f5133a57ecdb4de40fb46edd032d94bfd6121932fae13a1bca1ca0f6564
contextLock: docs/tasks/context/TASK-0056.context-lock.yaml
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
  surfaceId: TASK_0056_IDLE_PLANNING_CHECKPOINT_CONSUMERS
  policySurfaces:
    - GOVERNANCE
  distinctCrossRiskSurfaces: 1
  reviewerMinutesEstimate: 15
  terminalCheckMinutesEstimate: 10
  estimatedWallMinutes: 60
  thresholdsTriggered: []
  splitRequired: false
  ownerIndivisibleAuthorization: false
preDraftObservation:
  base:
    branch: main
    localCommit: 2244ec2f63333ee76fea011a13b7960c29da8d92
    localTree: a72ea7cf1a89ac36f089b42b5a15b153262ef21a
    originMain: 2244ec2f63333ee76fea011a13b7960c29da8d92
    originMainLeftRight:
      left: 0
      right: 0
    indexClean: true
    worktreeClean: true
    activeTask: null
    lastTerminalTask: TASK-0077
    task0056Occupied: false
validationPlan:
  frozenBefore: READY
  policySource: .harness/ci-execution-policy.yaml
  selectedChannel: LOCAL_EXACT_TREE_FALLBACK
  profile: HARNESS_PORTABILITY_LOCAL
reviewers:
  - id: task0056_reviewer_not_started
    kind: independent-review-gate-not-started
    verdict: UNKNOWN
    reviewedCommit: null
    evidencePath: docs/evidence/TASK-0056/review-r1.md
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
  - docs/evidence/TASK-0077/evidence-pack.json
  - docs/handoffs/TASK-0077.json
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
  - docs/tasks/TASK-0055-idle-planning-checkpoint-core-replacement.md
  - docs/tasks/TASK-0056-idle-planning-checkpoint-consumers-ci-closure.md
  - docs/tasks/TASK-0077-permanent-harness-recovery-and-quarantine.md
  - docs/tasks/context/TASK-0056.context-lock.yaml
  - docs/tasks/task-card-template.md
  - requirements-harness.txt
  - scripts/harness/catalog_tool.py
  - scripts/harness/check_beta_gate.py
  - scripts/harness/check_paid_features.py
  - scripts/harness/doctor.py
  - scripts/harness/durable_command.ps1
  - scripts/harness/harness_common.py
  - scripts/harness/precheck.py
  - scripts/harness/precheck.ps1
  - scripts/harness/precheck.sh
  - scripts/harness/tests/test_harness.py
  - skills/harness-change/SKILL.md
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
writeAllowlist:
  - docs/tasks/TASK-0056-idle-planning-checkpoint-consumers-ci-closure.md
  - docs/tasks/context/TASK-0056.context-lock.yaml
  - docs/evidence/TASK-0056/evidence-pack.json
  - docs/evidence/TASK-0056/pre-closure-request.json
  - docs/evidence/TASK-0056/review-r1.md
  - docs/handoffs/TASK-0056.json
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - .harness/task-delivery-policy.yaml
  - scripts/harness/doctor.py
  - scripts/harness/tests/test_harness.py
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
  - .harness/task-lifecycle.yaml
  - .harness/tools.lock.yaml
  - docs/evidence/TASK-0073/**
  - docs/evidence/TASK-0074/**
  - docs/evidence/TASK-0075/**
  - docs/evidence/TASK-0076/**
  - docs/evidence/TASK-0077/**
  - docs/handoffs/TASK-0073.json
  - docs/handoffs/TASK-0074.json
  - docs/handoffs/TASK-0075.json
  - docs/handoffs/TASK-0076.json
  - docs/handoffs/TASK-0077.json
  - docs/tasks/TASK-0073-pre-ready-greenline-parent-edge-recovery.md
  - docs/tasks/TASK-0074-exact-delivery-flow-recovery.md
  - docs/tasks/TASK-0075-permanent-delivery-flow-recovery.md
  - docs/tasks/TASK-0076-harness-skill-version-binding-recovery.md
  - docs/tasks/TASK-0077-permanent-harness-recovery-and-quarantine.md
  - docs/tasks/context/TASK-0073.context-lock.yaml
  - docs/tasks/context/TASK-0074.context-lock.yaml
  - docs/tasks/context/TASK-0075.context-lock.yaml
  - docs/tasks/context/TASK-0076.context-lock.yaml
  - docs/tasks/context/TASK-0077.context-lock.yaml
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
  - skills/catalog-change/**
  - skills/contract-change/**
  - skills/database-migration/**
  - skills/harness-change/SKILL.md
  - skills/memory-change/**
  - skills/model-routing-change/**
  - skills/safety-change/**
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
  - specs/**
  - service/**
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
  - skills/harness-change/SKILL.md
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
  - scope: harness-change
    approvedBy: repository-owner
    approvedAt: "2026-08-05"
    sourceThreadId: long-line-execution-authorization
    evidence: >-
      用户长线执行授权覆盖 TASK-0056：完成 idle planning checkpoint 四消费者接线，
      将 derive_idle_planning_checkpoint 统一接入 DRAFT、Base-Handoff、idle terminal
      与 terminal Diff Scope 四个执行消费者，并闭环 exact-SHA CI
independentReview: required
requiredCommands:
  - >-
    python -m unittest discover -s scripts/harness/tests -p test_*.py
  - git diff --check
  - python scripts/harness/doctor.py --task TASK-0056
```

> 规划正文仅为非规范的人类可读渲染；唯一机器真源是 `.harness/task-backlog.yaml` 中本 Task ID 的静态合同，并由 `planningContractHash` 完整绑定。

## 目标

将已验证 checkpoint 统一接入四个执行消费者，并以 canonical 与 exact-SHA CI 完整闭环。

## 范围内

- 四个消费者共享同一 checkpoint；
- 合法规划尾部成为下一 DRAFT/Base-Handoff 锚点，前卡 Diff Scope 截止 canonical terminal。

## 明确禁止

- 各消费者重复实现解析；
- 重写核心语义，或顺带实现性能、路径感知 CI、receipt。

## 依赖与决策闘门

- 依赖：TASK-0077；
- 无新增硬决策闸门。

## 验收

- 四个消费者对同一历史得到同一结果；
- 无尾部行为不变，轻量集成、canonical 与 exact-SHA CI 全部通过。

## 晋级规则

TASK-0077 必须 ACCEPTED，仓库必须空闲，且本卡是执行顺序中首个可晋级任务。

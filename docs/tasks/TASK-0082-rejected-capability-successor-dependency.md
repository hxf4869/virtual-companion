# TASK-0082：Harness REJECTED 能力后继依赖满足

```yaml
taskId: TASK-0082
state: DRAFT
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
baseCommit: a22b21c86a7fcd86decc5969a007842346affad4
contextFingerprint: 0619082ec2fc65b5dd5cefd0c1d3942c6f6b1a5cf59e7c8e15596301814d2864
contextLock: docs/tasks/context/TASK-0082.context-lock.yaml
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
  surfaceId: TASK_0082_REJECTED_CAPABILITY_SUCCESSOR_DEPENDENCY
  policySurfaces:
    - GOVERNANCE
  distinctCrossRiskSurfaces: 1
  reviewerMinutesEstimate: 10
  terminalCheckMinutesEstimate: 10
  estimatedWallMinutes: 30
  thresholdsTriggered: []
  splitRequired: false
  ownerIndivisibleAuthorization: false
validationPlan:
  frozenBefore: READY
  policySource: .harness/ci-execution-policy.yaml
  selectedChannel: LOCAL_EXACT_TREE_FALLBACK
  profile: HARNESS_PORTABILITY_LOCAL
reviewers:
  - id: task0082_reviewer_not_started
    kind: independent-review-gate-not-started
    verdict: UNKNOWN
    reviewedCommit: null
    evidencePath: docs/evidence/TASK-0082/review-r1.md
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
  - docs/evidence/TASK-0081/evidence-pack.json
  - docs/handoffs/TASK-0081.json
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
  - docs/tasks/TASK-0013-provider-registry-admission-model.md
  - docs/tasks/TASK-0081-provider-registry-admission-model-successor.md
  - docs/tasks/TASK-0082-rejected-capability-successor-dependency.md
  - docs/tasks/context/TASK-0082.context-lock.yaml
  - docs/tasks/task-card-template.md
  - requirements-harness.txt
  - scripts/harness/doctor.py
  - scripts/harness/harness_common.py
  - scripts/harness/precheck.py
  - scripts/harness/tests/test_harness.py
  - skills/harness-change/SKILL.md
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
writeAllowlist:
  - docs/tasks/TASK-0082-rejected-capability-successor-dependency.md
  - docs/tasks/context/TASK-0082.context-lock.yaml
  - docs/evidence/TASK-0082/evidence-pack.json
  - docs/evidence/TASK-0082/pre-closure-request.json
  - docs/evidence/TASK-0082/review-r1.md
  - docs/handoffs/TASK-0082.json
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
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
  - .harness/task-delivery-policy.yaml
  - .harness/task-lifecycle.yaml
  - .harness/tools.lock.yaml
  - docs/evidence/TASK-0081/**
  - docs/handoffs/TASK-0081.json
  - docs/tasks/TASK-0013-provider-registry-admission-model.md
  - docs/tasks/TASK-0081-provider-registry-admission-model-successor.md
  - docs/tasks/context/TASK-0013.context-lock.yaml
  - docs/tasks/context/TASK-0081.context-lock.yaml
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
  - service/**
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
      用户批准「按你的建议来」。TASK-0013 执行态 REJECTED 后 DAG 被
      DEPENDENCY:TASK-0013:REJECTED 阻断。criticalPath 历史前缀不可改写，
      故在 Doctor 晋级依赖检查中承认精确能力后继 TASK-0081（ACCEPTED）
      满足对 TASK-0013 的依赖，不改 backlog 合同与 criticalPath。
independentReview: required
requiredCommands:
  - >-
    python -m unittest discover -s scripts/harness/tests -p test_*.py
  - git diff --check
  - python scripts/harness/doctor.py --task TASK-0082
```

## 目标

在不改写 frozen criticalPath / planning contract 的前提下，让执行态 REJECTED 的能力依赖在精确 ACCEPTED 后继存在时视为满足，从而恢复 Technical Alpha DAG 晋级。

## 范围内

- Doctor `derive_backlog_promotion_projection` 依赖满足：`TASK-0013` → 后继 `TASK-0081`（须 ACCEPTED）；
- 对应定向测试；
- 不修改 task-backlog.yaml、不改 criticalPath、不放宽失败关闭。

## 明确禁止

- 删除测试、增加 skip、吞退出码；
- 通用“任意 REJECTED 都算满足”；
- 改写 backlog planning contract 或 criticalPath 历史前缀。

## 验收

- `nextPromotable` 恢复为 TASK-0014（或执行顺序中首个可晋级 PLANNED）；
- frontier 不再被 `DEPENDENCY:TASK-0013:REJECTED` 阻断；
- 全量 harness 测试 PASS；Doctor PASS。

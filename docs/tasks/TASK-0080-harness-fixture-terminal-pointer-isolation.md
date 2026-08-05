# TASK-0080：Harness fixture 终态指针隔离修复

```yaml
taskId: TASK-0080
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
baseCommit: 0f329b668a702ab30a636b9508ce205d7f0f88ea
authorizationCommit: d028178bf556e6f46681e0f2d828cd458bab0fd5
contextFingerprint: 89242f89788215596a908846e69ffbf6c1024360124e94a17e04f823d78bd44a
contextLock: docs/tasks/context/TASK-0080.context-lock.yaml
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
  surfaceId: TASK_0080_HARNESS_FIXTURE_TERMINAL_POINTER_ISOLATION
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
  - id: task0080_r1
    kind: independent-review-gate
    verdict: PASS
    reviewedCommit: 78b2c84a0c9cbe59c7700ac9d48cedbabce9da78
    evidencePath: docs/evidence/TASK-0080/review-r1.md
    reason: null
    candidateTree: 10254968c4cf1d52903bd44a618c8de26f44cfca
    budget:
      maximumMinutes: 15
      elapsedSeconds: 180
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
  - docs/evidence/TASK-0079/evidence-pack.json
  - docs/handoffs/TASK-0079.json
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
  - docs/tasks/TASK-0078-harness-test-fixture-promotion-isolation.md
  - docs/tasks/TASK-0079-provider-registry-admission-model-successor.md
  - docs/tasks/TASK-0080-harness-fixture-terminal-pointer-isolation.md
  - docs/tasks/context/TASK-0080.context-lock.yaml
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
  - docs/tasks/TASK-0080-harness-fixture-terminal-pointer-isolation.md
  - docs/tasks/context/TASK-0080.context-lock.yaml
  - docs/evidence/TASK-0080/evidence-pack.json
  - docs/evidence/TASK-0080/pre-closure-request.json
  - docs/evidence/TASK-0080/review-r1.md
  - docs/handoffs/TASK-0080.json
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
  - docs/evidence/TASK-0078/**
  - docs/evidence/TASK-0079/**
  - docs/handoffs/TASK-0078.json
  - docs/handoffs/TASK-0079.json
  - docs/tasks/TASK-0078-harness-test-fixture-promotion-isolation.md
  - docs/tasks/TASK-0079-provider-registry-admission-model-successor.md
  - docs/tasks/context/TASK-0078.context-lock.yaml
  - docs/tasks/context/TASK-0079.context-lock.yaml
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
      用户批准「按你的建议来」覆盖 fixture 修复。TASK-0078 遗留 lastAccepted/lastTerminal
      硬编码为 TASK-0059，在 TASK-0078 自身 ACCEPTED 后破坏 project-state 校验。
      本卡只修 load_inputs 终态指针隔离，不改 Doctor 生产路径。
independentReview: required
requiredCommands:
  - >-
    python -m unittest discover -s scripts/harness/tests -p test_*.py
  - git diff --check
  - python scripts/harness/doctor.py --task TASK-0080
```

## 目标

修复 TASK-0078 `load_inputs` 将 `lastAcceptedTask`/`lastTerminalTask` 硬编码为 TASK-0059 的潜伏耦合，使 fixture 跟随 live 终态指针。

## 范围内

- `load_inputs` 仅清空 activeTask，保留 live lastAccepted/lastTerminal；
- nextAction 动态引用 live lastAccepted。

## 明确禁止

- 删除测试、增加 skip、吞退出码；
- 修改 Doctor 生产路径或 backlog。

## 验收

- 全部 Python harness 测试 PASS；
- Doctor PASS；
- 后续产品任务晋升不再因终态指针硬编码失败。

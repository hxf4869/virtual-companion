# TASK-0076：Skill 版本绑定与交付绿线恢复

```yaml
taskId: TASK-0076
state: REJECTED
closureOnly: true
terminalStateReason: >-
  Doctor 报告 11 个错误（exit 1），包括 scripts/harness/precheck.py forbidden-path
  违规；优化提交已推送到 origin/main，不可回退或改写。任务进入 closure-only 并终态记为 REJECTED。
owner: repository-owner
riskClass: C4
requiredSkills:
  - task-delivery-flow
  - task-intake
  - harness-change
requiredSkillVersions:
  task-delivery-flow: 1.3.4
  task-intake: 1.2.4
  harness-change: 1.1.3
targetSkillVersions:
  task-delivery-flow: 1.3.5
  task-intake: 1.2.5
  harness-change: 1.1.5
baseCommit: b0c5d351d65e847d4512db580411d84e0e549287
authorizationCommit: 6eadd65ca4591b9b2d79f6364104ae4a01d7e500
contextFingerprint: 25d79d73f77fd36a5b53f67e24cddcc72005fadb6d70ebbe355ce8e1a0a241ca
contextLock: docs/tasks/context/TASK-0076.context-lock.yaml
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
  surfaceId: TASK_0076_SKILL_VERSION_BINDING_RECOVERY
  policySurfaces:
    - GOVERNANCE
    - AUTHORIZATION
  distinctCrossRiskSurfaces: 2
  reviewerMinutesEstimate: 15
  terminalCheckMinutesEstimate: 60
  estimatedWallMinutes: 90
  thresholdsTriggered: []
  splitRequired: false
  ownerIndivisibleAuthorization: true
  indivisibleReason: >-
    Owner 只授权一条精确 Skill 版本绑定恢复链。
preReadyMaintenancePlan:
  recordId: OWNER-MAINT-20260804-TASK-0076-PRE-READY-01
  recordPath: docs/evidence/TASK-0076/pre-ready-maintenance-authorization.json
  kind: OWNER_AUTHORIZED_EXACT_ONE_TIME_PRE_READY_MAINTENANCE
  directSingleParentFromDraftRequired: true
  pathSetFrozenAtDraft: true
  additionsOrRemovalsForbidden: true
  oneTimeOnly: true
  reusable: false
  consumedRecordMustBecomeInert: true
  exactPaths:
    - .harness/ci-execution-policy.yaml
    - .harness/skills.yaml
    - .harness/task-delivery-policy.yaml
    - docs/evidence/TASK-0076/pre-ready-maintenance-authorization.json
    - scripts/harness/doctor.py
    - scripts/harness/tests/test_harness.py
    - skills/harness-change/SKILL.md
    - skills/task-delivery-flow/SKILL.md
    - skills/task-intake/SKILL.md
preDraftObservation:
  base:
    branch: main
    localCommit: b0c5d351d65e847d4512db580411d84e0e549287
    localTree: aacfc492f08a75e405584d21f3afc8270e42cee0
    originMain: a737f22362185ed47e81ecabef5c17b22fb52e18
    originMainLeftRight:
      left: 0
      right: 34
    indexClean: true
    worktreeClean: true
    activeTask: null
    lastTerminalTask: TASK-0075
    task0076Occupied: false
validationPlan:
  frozenBefore: READY
  policySource: .harness/ci-execution-policy.yaml
  selectedChannel: LOCAL_EXACT_TREE_FALLBACK
  profile: HARNESS_PORTABILITY_LOCAL
reviewers:
  - id: task0076_reviewer_not_started
    kind: independent-review-gate-not-started
    verdict: UNKNOWN
    reviewedCommit: null
    evidencePath: docs/evidence/TASK-0076/review-r1.md
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
  - docs/evidence/TASK-0073/evidence-pack.json
  - docs/evidence/TASK-0073/pre-ready-maintenance-authorization.json
  - docs/evidence/TASK-0073/review-r1.md
  - docs/evidence/TASK-0074/evidence-pack.json
  - docs/evidence/TASK-0074/pre-ready-maintenance-authorization.json
  - docs/evidence/TASK-0074/review-r1.md
  - docs/evidence/TASK-0075/evidence-pack.json
  - docs/evidence/TASK-0075/pre-ready-maintenance-authorization.json
  - docs/handoffs/TASK-0073.json
  - docs/handoffs/TASK-0074.json
  - docs/handoffs/TASK-0075.json
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
  - docs/tasks/TASK-0056-idle-planning-checkpoint-consumers-ci-closure.md
  - docs/tasks/TASK-0073-pre-ready-greenline-parent-edge-recovery.md
  - docs/tasks/TASK-0074-exact-delivery-flow-recovery.md
  - docs/tasks/TASK-0075-permanent-delivery-flow-recovery.md
  - docs/tasks/context/TASK-0073.context-lock.yaml
  - docs/tasks/context/TASK-0074.context-lock.yaml
  - docs/tasks/context/TASK-0075.context-lock.yaml
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
  - .harness/ci-execution-policy.yaml
  - .harness/project-state.yaml
  - .harness/skills.yaml
  - .harness/task-backlog.yaml
  - .harness/task-delivery-policy.yaml
  - .harness/task-ledger.yaml
  - docs/evidence/TASK-0076/evidence-pack.json
  - docs/evidence/TASK-0076/pre-closure-request.json
  - docs/evidence/TASK-0076/pre-ready-maintenance-authorization.json
  - docs/evidence/TASK-0076/review-r1.md
  - docs/handoffs/TASK-0076.json
  - docs/tasks/TASK-0056-idle-planning-checkpoint-consumers-ci-closure.md
  - docs/tasks/TASK-0076-harness-skill-version-binding-recovery.md
  - docs/tasks/context/TASK-0076.context-lock.yaml
  - scripts/harness/doctor.py
  - scripts/harness/tests/test_harness.py
  - skills/harness-change/SKILL.md
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
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
  - .harness/sources-of-truth.yaml
  - .harness/task-lifecycle.yaml
  - .harness/tools.lock.yaml
  - docs/evidence/TASK-0073/**
  - docs/evidence/TASK-0074/**
  - docs/evidence/TASK-0075/**
  - docs/handoffs/TASK-0073.json
  - docs/handoffs/TASK-0074.json
  - docs/handoffs/TASK-0075.json
  - docs/tasks/TASK-0073-pre-ready-greenline-parent-edge-recovery.md
  - docs/tasks/TASK-0074-exact-delivery-flow-recovery.md
  - docs/tasks/TASK-0075-permanent-delivery-flow-recovery.md
  - docs/tasks/context/TASK-0073.context-lock.yaml
  - docs/tasks/context/TASK-0074.context-lock.yaml
  - docs/tasks/context/TASK-0075.context-lock.yaml
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
  - skills/memory-change/**
  - skills/model-routing-change/**
  - skills/safety-change/**
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
    approvedAt: "2026-08-04"
    sourceThreadId: 019fb2c1-8104-73b1-81dc-ee8bcfce6f63
    evidence: >-
      授权 TASK-0076 修正版精确一次性 Skill 版本绑定与交付绿线恢复
independentReview: required
requiredCommands:
  - >-
    python -m unittest discover -s scripts/harness/tests -p test_*.py
  - git diff --check
  - python scripts/harness/doctor.py --task TASK-0076
```

## 背景与用户可观察目标

TASK-0075 READY Doctor 唯一错误为 Skill harness-change registry/frontmatter version mismatch。
本卡修复版本绑定并恢复交付绿线。

## 验收标准

1. 三个 Skill 版本一致（1.1.5、1.2.5、1.3.5）。
2. READY Doctor exit 0。
3. TASK-0073/0074/0075 保持 REJECTED。
4. 完整候选门禁 PASS 后 ACCEPTED。

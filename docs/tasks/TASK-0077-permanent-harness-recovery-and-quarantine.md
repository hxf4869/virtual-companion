# TASK-0077：Harness 永久恢复与 TASK-0076 历史隔离

```yaml
taskId: TASK-0077
state: DRAFT
owner: repository-owner
riskClass: C4
requiredSkills:
  - task-delivery-flow
  - task-intake
  - harness-change
requiredSkillVersions:
  task-delivery-flow: 1.3.5
  task-intake: 1.2.5
  harness-change: 1.1.5
targetSkillVersions:
  task-delivery-flow: 1.3.6
  task-intake: 1.2.6
  harness-change: 1.1.6
baseCommit: 31cc7b31b27e7e5d369f2ad16e94f5d80b3a2916
contextFingerprint: 888bdb9f3bcf321590c9886161bb517a190ebdad15f87daa6723b88a7dc50bd9
contextLock: docs/tasks/context/TASK-0077.context-lock.yaml
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
  surfaceId: TASK_0077_HARNESS_RECOVERY_AND_QUARANTINE
  policySurfaces:
    - GOVERNANCE
    - AUTHORIZATION
    - HISTORY
  distinctCrossRiskSurfaces: 3
  reviewerMinutesEstimate: 15
  terminalCheckMinutesEstimate: 10
  estimatedWallMinutes: 60
  thresholdsTriggered: []
  splitRequired: false
  ownerIndivisibleAuthorization: true
  indivisibleReason: >-
    隔离 TASK-0076 固定 REJECTED 历史、修复与该固定历史直接关联的
    Doctor/Backlog/Policy 投影、建立普通 READY Doctor 可以通过的唯一机器边界，
    三部分构成不可机械拆分的单一原子绿线恢复。机械拆分会使每个子卡都
    处于无法通过 READY Doctor 的循环依赖。
preReadyMaintenancePlan:
  recordId: OWNER-MAINT-20260805-TASK-0077-PRE-READY-01
  recordPath: docs/evidence/TASK-0077/pre-ready-maintenance-authorization.json
  kind: OWNER_AUTHORIZED_EXACT_ONE_TIME_PRE_READY_MAINTENANCE
  directSingleParentFromDraftRequired: true
  pathSetFrozenAtDraft: true
  additionsOrRemovalsForbidden: true
  oneTimeOnly: true
  reusable: false
  consumedRecordMustBecomeInert: true
  exactPaths:
    - scripts/harness/doctor.py
    - scripts/harness/tests/test_harness.py
    - .harness/task-backlog.yaml
    - .harness/task-delivery-policy.yaml
    - .harness/skills.yaml
    - docs/tasks/TASK-0056-idle-planning-checkpoint-consumers-ci-closure.md
    - docs/evidence/TASK-0077/pre-ready-maintenance-authorization.json
    - skills/harness-change/SKILL.md
    - skills/task-intake/SKILL.md
    - skills/task-delivery-flow/SKILL.md
task0076Quarantine:
  task_id: TASK-0076
  base_commit: b0c5d351d65e847d4512db580411d84e0e549287
  base_tree: aacfc492f08a75e405584d21f3afc8270e42cee0
  terminal_commit: 31cc7b31b27e7e5d369f2ad16e94f5d80b3a2916
  terminal_tree: c288435bd8d4149e9daf6be6ce9d365d6a9cacb7
  terminal_state: REJECTED
  full_chain:
    - 4069a2ed2bcf07ca3b9c023f2985cfe091ba3d31
    - 9a2bd6ec6c38a52d39c8f08a2ac159fcce38fedd
    - 6eadd65ca4591b9b2d79f6364104ae4a01d7e500
    - ad0e4b93185ea364f9039a014a950dc58791f1ce
    - f1e4a39ee1f292a6ffd54f8f547c08cef725db4b
    - e9b59cad39598e78e480127696afd19942d48b31
    - 7b784a0f701d017f1b86695074a37c2ed7558265
    - ac3018e2b588c3b271c646f7b2520a4ec1e8d228
    - 8dcd298a4356d522b509ea35b3e5c4f0b7f2590d
    - 31cc7b31b27e7e5d369f2ad16e94f5d80b3a2916
  forbidden_path: scripts/harness/precheck.py
  forbidden_edge_parent: e9b59cad39598e78e480127696afd19942d48b31
  forbidden_edge_child: 7b784a0f701d017f1b86695074a37c2ed7558265
  forbidden_edge_parent_blob: 29d9b3646efb6d42db4561328031f06ad67650bc
  forbidden_edge_child_blob: c48cc7f7cada2193c6f11ca291ea50dcc13d7be0
task0056Recovery:
  current_card_hash: 4444bceb0a68f725db68f4277f74f033fec17843157aec6e86e32544545c62d1
  current_backlog_hash: 89cdd5e858a95e26e110e77649899a0b537fed458b1bc8c7bab2525b4dbb694a
  target_hash: 05041efa7a07ccf92a085726ff5c1d053e9e3e5631490be10826309fec8643f3
  dependency_from: TASK-0076
  dependency_to: TASK-0077
  migration_stage: PRE_READY_MAINTENANCE
  release_condition: TASK-0077_ACCEPTED_AND_PUSHED_AND_HANDOFF_COMPLETE_AND_REMOTE_0_0_AND_EXACT_TREE_PASS
preDraftObservation:
  base:
    branch: main
    localCommit: 31cc7b31b27e7e5d369f2ad16e94f5d80b3a2916
    localTree: c288435bd8d4149e9daf6be6ce9d365d6a9cacb7
    originMain: 31cc7b31b27e7e5d369f2ad16e94f5d80b3a2916
    originMainLeftRight:
      left: 0
      right: 0
    indexClean: true
    worktreeClean: true
    activeTask: null
    lastTerminalTask: TASK-0076
    task0077Occupied: false
validationPlan:
  frozenBefore: READY
  policySource: .harness/ci-execution-policy.yaml
  selectedChannel: LOCAL_EXACT_TREE_FALLBACK
  profile: HARNESS_PORTABILITY_LOCAL
reviewers:
  - id: task0077_reviewer_not_started
    kind: independent-review-gate-not-started
    verdict: UNKNOWN
    reviewedCommit: null
    evidencePath: docs/evidence/TASK-0077/review-r1.md
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
  - docs/evidence/TASK-0076/evidence-pack.json
  - docs/evidence/TASK-0076/pre-ready-maintenance-authorization.json
  - docs/evidence/TASK-0076/review-r1.md
  - docs/handoffs/TASK-0076.json
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
  - docs/tasks/TASK-0056-idle-planning-checkpoint-consumers-ci-closure.md
  - docs/tasks/TASK-0076-harness-skill-version-binding-recovery.md
  - docs/tasks/TASK-0077-permanent-harness-recovery-and-quarantine.md
  - docs/tasks/context/TASK-0077.context-lock.yaml
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
  - .harness/project-state.yaml
  - .harness/task-backlog.yaml
  - .harness/task-delivery-policy.yaml
  - .harness/task-ledger.yaml
  - .harness/skills.yaml
  - docs/evidence/TASK-0077/evidence-pack.json
  - docs/evidence/TASK-0077/pre-closure-request.json
  - docs/evidence/TASK-0077/pre-ready-maintenance-authorization.json
  - docs/evidence/TASK-0077/review-r1.md
  - docs/handoffs/TASK-0077.json
  - docs/tasks/TASK-0056-idle-planning-checkpoint-consumers-ci-closure.md
  - docs/tasks/TASK-0077-permanent-harness-recovery-and-quarantine.md
  - docs/tasks/context/TASK-0077.context-lock.yaml
  - scripts/harness/doctor.py
  - scripts/harness/precheck.py
  - scripts/harness/tests/test_harness.py
  - skills/harness-change/SKILL.md
  - skills/task-intake/SKILL.md
  - skills/task-delivery-flow/SKILL.md
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
  - docs/evidence/TASK-0076/**
  - docs/handoffs/TASK-0073.json
  - docs/handoffs/TASK-0074.json
  - docs/handoffs/TASK-0075.json
  - docs/handoffs/TASK-0076.json
  - docs/tasks/TASK-0073-pre-ready-greenline-parent-edge-recovery.md
  - docs/tasks/TASK-0074-exact-delivery-flow-recovery.md
  - docs/tasks/TASK-0075-permanent-delivery-flow-recovery.md
  - docs/tasks/TASK-0076-harness-skill-version-binding-recovery.md
  - docs/tasks/context/TASK-0073.context-lock.yaml
  - docs/tasks/context/TASK-0074.context-lock.yaml
  - docs/tasks/context/TASK-0075.context-lock.yaml
  - docs/tasks/context/TASK-0076.context-lock.yaml
  - docs/tasks/task-card-template.md
  - requirements-harness.txt
  - scripts/harness/catalog_tool.py
  - scripts/harness/check_beta_gate.py
  - scripts/harness/check_paid_features.py
  - scripts/harness/durable_command.ps1
  - scripts/harness/harness_common.py
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
    approvedAt: "2026-08-05"
    sourceThreadId: 019fb2c1-8104-73b1-81dc-ee8bcfce6f63
    evidence: >-
      授权 TASK-0077 精确一次性永久恢复：隔离 TASK-0076 固定 REJECTED 历史；
      修复 TASK-0056 Card/Backlog/Policy 投影；修复 TASK-0071/0073 历史
      parent-edge 精确隔离；合法承接已推送的 Doctor/Precheck 性能优化；
      同步三个 Skill 版本至 1.1.6/1.2.6/1.3.6
independentReview: required
requiredCommands:
  - >-
    python -m unittest discover -s scripts/harness/tests -p test_*.py
  - git diff --check
  - python scripts/harness/doctor.py --task TASK-0077
```

## 背景与用户可观察目标

TASK-0076 因优化提交修改 `scripts/harness/precheck.py`（forbiddenPaths）而 REJECTED。
Doctor 报告 11 个错误。本卡在一个原子恢复中：

1. 隔离 TASK-0076 固定 REJECTED 历史（machine-recognized quarantine）；
2. 修复 TASK-0071/0073 历史 parent-edge 精确隔离（以对象身份验证替代 ancestry 检查）；
3. 修复 TASK-0056 Card/Backlog/Policy 投影（dependency → TASK-0077，hash 同步）；
4. 合法承接已推送的 Doctor/Precheck 性能优化；
5. 建立 READY Doctor exit 0 的唯一机器边界。

## 验收标准

1. Doctor exit 0，全部 11 个错误已消除。
2. TASK-0076 在 task-ledger 中保持 REJECTED，quarantine 正例和负例全部通过。
3. TASK-0071/0073 保持 REJECTED，历史 parent-edge 以对象身份精确隔离。
4. TASK-0056 planningContractHash 为 `05041efa7a07ccf92a085726ff5c1d053e9e3e5631490be10826309fec8643f3`。
5. 三个 Skill 版本严格递增至 1.1.6/1.2.6/1.3.6，registry/frontmatter 一致。
6. 完整候选门禁 PASS 后 ACCEPTED。
7. TASK-0056 只在 TASK-0077 ACCEPTED 后释放。

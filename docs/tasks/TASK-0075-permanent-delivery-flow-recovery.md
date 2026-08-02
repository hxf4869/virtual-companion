# TASK-0075：永久交付流程与历史投影精确恢复

```yaml
taskId: TASK-0075
state: DRAFT
owner: repository-owner
riskClass: C4
requiredSkills:
  - task-delivery-flow
  - task-intake
  - harness-change
requiredSkillVersions:
  task-delivery-flow: 1.3.3
  task-intake: 1.2.3
  harness-change: 1.1.3
targetSkillVersions:
  task-delivery-flow: 1.3.4
  task-intake: 1.2.4
  harness-change: 1.1.4
baseCommit: d41c9f82e69107cf1ecf0cb2c100d39f436faab7
authorizationCommit: ""
contextFingerprint: deb8e20ac0a38638366ba310a46ce59299e2514bb16b23387ba1ded7a39a396d
contextLock: docs/tasks/context/TASK-0075.context-lock.yaml
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
  surfaceId: TASK_0075_PERMANENT_DELIVERY_FLOW_HISTORY_RECOVERY
  policySurfaces:
    - GOVERNANCE
    - AUTHORIZATION
    - HISTORY
  distinctCrossRiskSurfaces: 3
  reviewerMinutesEstimate: 15
  terminalCheckMinutesEstimate: 60
  estimatedWallMinutes: 90
  thresholdsTriggered:
    - CROSS_RISK_SURFACES
    - TERMINAL_CHECK_MINUTES
  splitRequired: false
  ownerIndivisibleAuthorization: true
  indivisibleReason: >-
    Owner 只授权一条以 d41c9f82e69107cf1ecf0cb2c100d39f436faab7 为
    Base 的精确永久恢复链；唯一 pre-READY maintenance 必须先恢复普通
    READY Doctor，随后同卡才能把 TASK-0056 的 Card、Backlog dependency
    与 delivery-policy core 从永久 REJECTED 的 TASK-0073 前向迁移到
    TASK-0075。拆分会留下不能通过普通 READY 或不能释放 TASK-0056 的半卡。
preReadyMaintenancePlan:
  recordId: OWNER-MAINT-20260803-TASK-0075-PRE-READY-01
  recordPath: docs/evidence/TASK-0075/pre-ready-maintenance-authorization.json
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
    - docs/evidence/TASK-0075/pre-ready-maintenance-authorization.json
    - docs/schemas/evidence-pack.schema.json
    - docs/schemas/handoff.schema.json
    - scripts/harness/doctor.py
    - scripts/harness/tests/test_harness.py
    - skills/harness-change/SKILL.md
    - skills/task-delivery-flow/SKILL.md
    - skills/task-intake/SKILL.md
  exactIdentityBinding:
    - BASE_COMMIT_AND_TREE
    - DRAFT_COMMIT_AND_TREE
    - MAINTENANCE_COMMIT_AND_TREE
    - SORTED_PATH_SET
    - PATH_MODE_TYPE_BLOB
    - PATH_SHA256_AND_CONTENT
    - EXACT_OWNER_AUTHORIZATION_PLAN
    - EXACT_OWNER_ACCEPTANCE
  forbiddenInterfaces:
    - SECOND_RECORD_OR_CONSUMPTION
    - OTHER_TASK_OR_PATH
    - EXTRA_COMMIT_OR_PATH
    - ENVIRONMENT_OR_CLI_BYPASS
    - GIT_NOTE_REPLACE_OR_GRAFT
    - HISTORY_REWRITE
    - CONFIGURABLE_ALLOWLIST
    - GENERAL_OVERRIDE
historicalRecovery:
  task0073CiPolicy:
    maintenanceCommit: b1c37678ab773eca150bdbb273ddafa5d14b781f
    maintenanceTree: 6d0c9f5852313219af370ba411dd192afafd0f73
    policyPath: .harness/ci-execution-policy.yaml
    mode: "100644"
    type: blob
    blob: 9efc2356531f515b3bfc758044863bfe8c998eca
    sha256: 9b393744d334248e0dec492cca2e9370f3cbab5f69d9ea6e27608ab1cd9ac77e
    canonicalProjectionSha256: 3a253a215a88d4b9bd987d7dd2cbf0b2400f93fbd7086b071eb511f81f9cf8a1
    interpretation: HISTORICAL_COMMIT_OWN_POLICY_BLOB_ONLY
  task0073PlanningEdge:
    parentCommit: d6fbee26442a997b96648eea472f98ecba1a5412
    parentTree: a9014d6d779f55d712db93f6f88bb5f4804ef315
    childCommit: 11e6fb12f77486787ef71627e84f34ee069e72bd
    childTree: 36e22afcc810cca0630e159568d2acf03845441d
    exactChangedPaths:
      - .harness/project-state.yaml
      - .harness/task-backlog.yaml
      - .harness/task-delivery-policy.yaml
      - docs/tasks/TASK-0056-idle-planning-checkpoint-consumers-ci-closure.md
      - docs/tasks/TASK-0073-pre-ready-greenline-parent-edge-recovery.md
      - scripts/harness/doctor.py
      - scripts/harness/tests/test_harness.py
    childDeliveryPolicyCanonicalSha256: c5e0c9856ac3fd35b8cfd390fedbdd11645fc63f9e0d525e5a78aa005ef4227d
    interpretation: PARENT_AND_CHILD_COMMIT_OWN_OBJECTS_ONLY
  task0074TerminalQuarantine:
    taskId: TASK-0074
    terminalState: REJECTED
    terminalCommit: d41c9f82e69107cf1ecf0cb2c100d39f436faab7
    terminalTree: dd7c6f7ee3c7d99b9ec8db2cfd6ceee56c37765e
    passClaimed: false
    artifacts:
      evidence:
        path: docs/evidence/TASK-0074/evidence-pack.json
        mode: "100644"
        type: blob
        blob: cbb75f8d5f573684df8284c014ce4507f9b7c3d2
        sha256: 1a9191feca82cec0d59ba4101ac843a90654f0919830cac4c34c97be44b7fa66
      review:
        path: docs/evidence/TASK-0074/review-r1.md
        mode: "100644"
        type: blob
        blob: 714382dff8ed430d80fd8456713b0411aa31c06e
        sha256: 28fce52edfa1bde1b503cac09b6f4fa890044e4addff81aa6ce1f03ffa42e77c
      handoff:
        path: docs/handoffs/TASK-0074.json
        mode: "100644"
        type: blob
        blob: 140aecbbd8c6663f68b4a4b9fb6b256389d5d154
        sha256: 5493fd4b1be8d0c1f15ed439d66712c8d704aa277d92d383c8ef6878219711ac
      card:
        path: docs/tasks/TASK-0074-exact-delivery-flow-recovery.md
        mode: "100644"
        type: blob
        blob: c1b1d5c9e188442522eb8769e7c67e0b5f47de1f
        sha256: ac18f2f42d267f9a8de3e3e2a4f6e5ad50ffdc7869ed46afbb0409596f6d688e
      context:
        path: docs/tasks/context/TASK-0074.context-lock.yaml
        mode: "100644"
        type: blob
        blob: be5dae0a701a4413e7abd97ce455dbfcef392afa
        sha256: 18a6b58707b965052920d1659483b6d869fc594ac4c1cd1429747298d11b0141
    readyDoctor:
      outcome: FAIL
      exitCode: 1
      checks: 355421
      receiptSha256: 452da45a1aa70d1892d68e2200404ce438132a26fc828a10325ba9e79a068239
      passClaimed: false
    preClosure:
      outcome: FAIL
      exitCode: 1
      checks: 359792
      receiptSha256: 0ffa4c92034214f024bfbe438a0bc54fbe3ddd0180fd21595d44c260f1efc86c
      passClaimed: false
      exactErrors:
        - "ERROR: TASK-0073 pre-READY maintenance: CI policy canonical binding drifted"
        - "ERROR: task-backlog: unresolved PLANNED card TASK-0056 metadata must remain immutable on edge d6fbee26442a997b96648eea472f98ecba1a5412..11e6fb12f77486787ef71627e84f34ee069e72bd"
        - "ERROR: task-backlog: planning card TASK-0056 title, fixed notice and six-section projection changed on edge d6fbee26442a997b96648eea472f98ecba1a5412..11e6fb12f77486787ef71627e84f34ee069e72bd"
        - "ERROR: task-backlog: permanent planning contract TASK-0056 was removed or rewritten on edge d6fbee26442a997b96648eea472f98ecba1a5412..11e6fb12f77486787ef71627e84f34ee069e72bd"
        - "ERROR: task-backlog: TASK-0073 replacement repair must be one exact, authorized, atomic parent edge; observed=[]"
        - "ERROR: TASK-0074: Handoff nextAction disagrees with terminal project-state"
        - "ERROR: TASK-0074 delivery timing: candidate execution anchor or budget drifted"
        - "ERROR: TASK-0074 delivery timing.candidateExecution.startedAt: must be a non-blank string"
        - "ERROR: TASK-0074 delivery timing.candidateExecution.endedAt: must be a non-blank string"
        - "ERROR: TASK-0074 delivery timing.candidateExecution.readyDoctorPassAt: must be a non-blank string"
    copiedMutatedOrSecondRecordMustFailClosed: true
futureContracts:
  candidateExecutionNotStarted:
    outcome: NOT_STARTED
    eligibility:
      readyDoctorOutcome: NON_PASS
      readyDoctorPassForbidden: true
      inProgressCommitForbidden: true
      candidateFreezeForbidden: true
    anchor: NOT_STARTED_READY_DOCTOR_NON_PASS
    anchorCommit: null
    startedAt: null
    endedAt: null
    readyDoctorPassAt: null
    inProgressCommit: null
    elapsedSeconds: 0
    closureOnlyOverrunSeconds: 0
    reasonRequired: true
    reanchorForbidden: true
    semantics: NON_PASS_AND_NEVER_STARTED
  existingCandidateOutcomes:
    - PASS
    - FAIL
    - TIMEOUT
    - UNKNOWN
  existingStrongTypingMustRemainUnchanged: true
  terminalHandoffProjection:
    field: nextAction
    comparison: BYTE_FOR_BYTE_STRING_EQUALITY
    sameTerminalCommitRequired: true
    task0074HistoricalMismatchOnlyExactQuarantine: true
preDraftObservation:
  base:
    branch: main
    localCommit: d41c9f82e69107cf1ecf0cb2c100d39f436faab7
    localTree: dd7c6f7ee3c7d99b9ec8db2cfd6ceee56c37765e
    originMain: a737f22362185ed47e81ecabef5c17b22fb52e18
    originMainLeftRight:
      left: 0
      right: 29
    indexClean: true
    worktreeClean: true
    activeTask: null
    lastTerminalTask: TASK-0074
    task0075Occupied: false
  doctorSummary:
    launchCount: 1
    transport: DURABLE_ATOMIC_RECEIPT
    receiptSha256: fae370a663c27b37ab0f6cd23556122ae5481cea7a269e1848cb820c3f2ad4cf
    stdoutSha256: c53fc738f4db31f096b8438354a09e88f23e23c0ce1c9dbb0c5476ab75228508
    stderrSha256: 0603bad8ebfff2330baf1d68852aa9be8ce1b53ae66c3ace03678f9e83e92d82
    startedAt: "2026-08-02T18:31:21.3208732+00:00"
    completedAt: "2026-08-02T18:52:44.2481970+00:00"
    exitCode: 1
    checks: 361792
    exactErrorsEqualAuthorizedTen: true
    eleventhErrorObserved: false
validationPlan:
  frozenBefore: READY
  policySource: .harness/ci-execution-policy.yaml
  selectedChannel: LOCAL_EXACT_TREE_FALLBACK
  profile: HARNESS_PORTABILITY_LOCAL
  candidateBinding:
    commitAndTreeRequired: true
    cleanWorktreeAndIndexRequired: true
    rerunAfterInputChange: true
    crossCommitOrTreeReuseForbidden: true
  reviewer:
    requiredOutcome: PASS
    forkTurns: none
    maximumMinutes: 15
    implementationForbidden: true
    repositoryWritesForbidden: true
    fullDoctorCanonicalOrPlatformSuiteForbidden: true
    maximumFixBatches: 1
    maximumRounds: 2
    r3Forbidden: true
  windows:
    requiredOutcome: PASS
    kind: COMBINED_CANDIDATE_CANONICAL_AND_WINDOWS_EXACT_TREE
    argv: python scripts/harness/precheck.py --profile harnessPortabilityLocal --task TASK-0075
    durableReceiptRequired: true
    eachCanonicalSubcommandExactlyOnce: true
    aliasCacheOrSkipForbidden: true
    exactSubcommands:
      - python -m unittest discover -s scripts/harness/tests -p test_*.py
      - python scripts/harness/doctor.py --task TASK-0075
      - python scripts/harness/catalog_tool.py validate
      - python scripts/harness/catalog_tool.py drift
      - python scripts/harness/check_paid_features.py
      - python scripts/harness/check_beta_gate.py
    canonicalSubset:
      - python scripts/harness/doctor.py --task TASK-0075
      - python scripts/harness/catalog_tool.py validate
      - python scripts/harness/catalog_tool.py drift
      - python scripts/harness/check_paid_features.py
      - python scripts/harness/check_beta_gate.py
    os: Windows-NT-10.0.26200
    python: 3.12.9
    powershell: 7.6.3
  wsl:
    requiredOutcome: PASS
    startsOnlyAfterWindowsPass: true
    distribution: Ubuntu-24.04
    isolation: GIT_ARCHIVE_EXACT_CANDIDATE_TO_WSL_MKTEMP
    argv: bash scripts/harness/precheck.sh --profile harnessPortabilityLocal --task TASK-0075
  macos:
    requiredOutcome: DEFERRED_NOT_CLAIMED
    residualRisk: >-
      本机没有受控 macOS exact-tree 环境；本卡不声称 macOS PASS。
  remote:
    outcome: UNKNOWN_NOT_RUN
    reasonType: OWNER_QUOTA_EVIDENCE_EXPIRED
    currentQuotaVerified: false
    dispatchCount: 0
    passClaimed: false
  localFallbackActivation:
    scope: TASK_0075_ONLY
    ownerAuthorized: true
    remoteStatusMustRemainNonPass: true
    globalUnknownQuotaBehaviorUnchanged: true
    evidence: >-
      Owner 只允许本卡使用 READY 冻结的 Windows 合并门禁与
      Ubuntu-24.04 WSL exact-tree；不得 dispatch、rerun 或 poll GitHub
      Actions，远端固定保持 UNKNOWN_NOT_RUN /
      OWNER_QUOTA_EVIDENCE_EXPIRED / dispatch=0 / passClaimed=false。
  terminalMetadataOnly:
    requiredCommitMarker: "[skip ci]"
    implementationTreeMustRemainVerified: true
    neverRepresentsCiPass: true
candidateFreeze:
  frozen: false
  commit: null
  tree: null
  readiness:
    readyDoctorPassRequired: true
    inProgressCommitRequired: true
    cleanIndexAndWorktreeRequired: true
  oneIdentityForReviewerWindowsWslAndPreClosure: true
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
  - docs/evidence/TASK-0074/pre-closure-request.json
  - docs/evidence/TASK-0074/pre-ready-maintenance-authorization.json
  - docs/evidence/TASK-0074/ready-doctor-receipt-observation.json
  - docs/evidence/TASK-0074/ready-doctor-request.json
  - docs/evidence/TASK-0074/ready-doctor-stderr.txt
  - docs/evidence/TASK-0074/review-r1.md
  - docs/handoffs/TASK-0073.json
  - docs/handoffs/TASK-0074.json
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
  - docs/tasks/TASK-0056-idle-planning-checkpoint-consumers-ci-closure.md
  - docs/tasks/TASK-0073-pre-ready-greenline-parent-edge-recovery.md
  - docs/tasks/TASK-0074-exact-delivery-flow-recovery.md
  - docs/tasks/context/TASK-0073.context-lock.yaml
  - docs/tasks/context/TASK-0074.context-lock.yaml
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
  - docs/evidence/TASK-0075/evidence-pack.json
  - docs/evidence/TASK-0075/pre-closure-request.json
  - docs/evidence/TASK-0075/pre-ready-maintenance-authorization.json
  - docs/evidence/TASK-0075/ready-doctor-receipt.json
  - docs/evidence/TASK-0075/ready-doctor-request.json
  - docs/evidence/TASK-0075/ready-doctor-stderr.txt
  - docs/evidence/TASK-0075/ready-doctor-stdout.txt
  - docs/evidence/TASK-0075/review-r1.md
  - docs/evidence/TASK-0075/review-r2.md
  - docs/evidence/TASK-0075/windows-gate-receipt.json
  - docs/evidence/TASK-0075/windows-gate-request.json
  - docs/evidence/TASK-0075/windows-gate-stderr.txt
  - docs/evidence/TASK-0075/windows-gate-stdout.txt
  - docs/evidence/TASK-0075/wsl-gate-receipt.json
  - docs/evidence/TASK-0075/wsl-gate-request.json
  - docs/evidence/TASK-0075/wsl-gate-stderr.txt
  - docs/evidence/TASK-0075/wsl-gate-stdout.txt
  - docs/handoffs/TASK-0075.json
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
  - docs/tasks/TASK-0056-idle-planning-checkpoint-consumers-ci-closure.md
  - docs/tasks/TASK-0075-permanent-delivery-flow-recovery.md
  - docs/tasks/context/TASK-0075.context-lock.yaml
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
  - docs/handoffs/TASK-0073.json
  - docs/handoffs/TASK-0074.json
  - docs/tasks/TASK-0073-pre-ready-greenline-parent-edge-recovery.md
  - docs/tasks/TASK-0074-exact-delivery-flow-recovery.md
  - docs/tasks/context/TASK-0073.context-lock.yaml
  - docs/tasks/context/TASK-0074.context-lock.yaml
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
  - .gitattributes
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
  - scripts/harness/durable_command.ps1
  - scripts/harness/harness_common.py
  - scripts/harness/precheck.py
  - scripts/harness/precheck.ps1
  - scripts/harness/precheck.sh
  - scripts/harness/tests/test_harness.py
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
  - docs/tasks/TASK-0056-idle-planning-checkpoint-consumers-ci-closure.md
  - docs/tasks/TASK-0073-pre-ready-greenline-parent-edge-recovery.md
  - docs/tasks/TASK-0074-exact-delivery-flow-recovery.md
  - docs/tasks/context/TASK-0073.context-lock.yaml
  - docs/tasks/context/TASK-0074.context-lock.yaml
  - docs/evidence/TASK-0073/evidence-pack.json
  - docs/evidence/TASK-0073/pre-ready-maintenance-authorization.json
  - docs/evidence/TASK-0073/review-r1.md
  - docs/evidence/TASK-0074/evidence-pack.json
  - docs/evidence/TASK-0074/pre-closure-request.json
  - docs/evidence/TASK-0074/pre-ready-maintenance-authorization.json
  - docs/evidence/TASK-0074/ready-doctor-receipt-observation.json
  - docs/evidence/TASK-0074/ready-doctor-request.json
  - docs/evidence/TASK-0074/ready-doctor-stderr.txt
  - docs/evidence/TASK-0074/review-r1.md
  - docs/handoffs/TASK-0073.json
  - docs/handoffs/TASK-0074.json
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
    approvedAt: "2026-08-03"
    sourceThreadId: 019fb2c1-8104-73b1-81dc-ee8bcfce6f63
    evidence: 授权 TASK-0075 精确永久恢复：以 `d41c9f82e69107cf1ecf0cb2c100d39f436faab7` / Tree `dd7c6f7ee3c7d99b9ec8db2cfd6ceee56c37765e` 为 Base，创建前重新 fetch 并确认 main、clean、远端无分叉及 TASK-0075 未占用。允许唯一 machine-recognized pre-READY maintenance commit：精确绑定并隔离 TASK-0073 历史 CI-policy projection、固定父边 `d6fbee26442a997b96648eea472f98ecba1a5412..11e6fb12f77486787ef71627e84f34ee069e72bd`，以及 TASK-0074 终态中已绑定 Commit/Tree/Blob 的 5 条 timing/Handoff 错误；Doctor 必须使用历史提交自身的 Policy/Blob 验证历史对象，不得用当前 Policy 重新解释。为未来 timing Schema 增加严格 `NOT_STARTED` 分支，仅允许 READY Doctor 非 PASS 且从未进入 IN_PROGRESS 时使用，允许候选及时间锚为 null、`elapsedSeconds=0`、原因非空；现有 PASS/FAIL/TIMEOUT/UNKNOWN 约束保持不变。未来 Handoff `nextAction` 必须与 terminal project-state 精确一致；TASK-0073/0074 历史制品不得修改。普通 READY Doctor PASS 后，才允许将 TASK-0056 Card/Backlog dependency 与 delivery-policy core 原子迁移至 TASK-0075，并完整执行 15 分钟独立 Reviewer、合并 Windows 门禁、独立 WSL、pre-closure 与安全推送。禁止通配路径、可配置 allowlist、历史改写、通用 override、记录复用、分支/worktree、GitHub Actions dispatch 或任何绕过。
  - scope: task-0075-owner-acceptance
    approvedBy: repository-owner
    approvedAt: "2026-08-03"
    sourceThreadId: 019fb2c1-8104-73b1-81dc-ee8bcfce6f63
    evidence: 按计划用 goal 继续下去
  - scope: task-0075-local-exact-tree-fallback
    approvedBy: repository-owner
    approvedAt: "2026-08-03"
    sourceThreadId: 019fb2c1-8104-73b1-81dc-ee8bcfce6f63
    evidence: >-
      GitHub Actions 固定 UNKNOWN_NOT_RUN / OWNER_QUOTA_EVIDENCE_EXPIRED /
      dispatch=0 / passClaimed=false；唯一 Reviewer PASS 后只对同一冻结
      TASK-0075 Commit/Tree 启动一次 Windows 合并门禁，Windows PASS 后
      才启动一次 Ubuntu-24.04 WSL exact-tree。
independentReview: required
reviewers: []
requiredCommands:
  - >-
    python -m unittest
    scripts.harness.tests.test_harness.Task0075PreReadyMaintenanceTests.test_exact_machine_record_is_accepted
    scripts.harness.tests.test_harness.Task0075PreReadyMaintenanceTests.test_machine_record_mutations_fail_closed
    scripts.harness.tests.test_harness.Task0075HistoricalProjectionTests.test_task0073_ci_policy_uses_historical_snapshot
    scripts.harness.tests.test_harness.Task0075HistoricalProjectionTests.test_planning_edge_uses_historical_objects
    scripts.harness.tests.test_harness.Task0075HistoricalQuarantineTests.test_exact_task0074_terminal_tuple_is_quarantined
    scripts.harness.tests.test_harness.Task0075HistoricalQuarantineTests.test_identity_or_tuple_mutations_fail_closed
    scripts.harness.tests.test_harness.Task0075DeliveryTimingTests.test_not_started_is_strict_and_fail_closed
    scripts.harness.tests.test_harness.Task0075DeliveryTimingTests.test_existing_statuses_remain_strongly_typed
    scripts.harness.tests.test_harness.Task0075HandoffProjectionTests.test_terminal_next_action_must_match
    scripts.harness.tests.test_harness.Task0075HandoffProjectionTests.test_task0074_exact_historical_mismatch_isolated
    scripts.harness.tests.test_harness.BacklogTests.test_task0075_replacement_is_exact_and_atomic
    scripts.harness.tests.test_harness.IdlePlanningCheckpointTests.test_accepts_no_tail_and_serial_rejected_superseded_edges
    scripts.harness.tests.test_harness.IdlePlanningCheckpointTests.test_accepts_optional_next_action_and_no_promotable_state
    scripts.harness.tests.test_harness.IdlePlanningCheckpointTests.test_rejects_merge_empty_split_multiple_and_extra_paths
    scripts.harness.tests.test_harness.IdlePlanningCheckpointTests.test_rejects_mode_contract_task_mismatch_and_restore_after_error
  - git diff --check
  - python scripts/harness/doctor.py --task TASK-0075
  - python scripts/harness/precheck.py --profile harnessPortabilityLocal --task TASK-0075
  - bash scripts/harness/precheck.sh --profile harnessPortabilityLocal --task TASK-0075
  - python scripts/harness/doctor.py --task TASK-0075 --pre-closure
```

## 背景与用户可观察目标

TASK-0074 的唯一 READY Doctor 在实现前诚实失败，终态保留了 10 条非 PASS
错误。用户最终可观察到：这些历史对象仍逐字节不可变且仍为 REJECTED；未来
Doctor 使用各历史提交自己的 Policy/Blob 解释 TASK-0073 固定对象；未开始候选
可用严格 `NOT_STARTED` 表示；未来终态 Handoff 与 project-state 的
`nextAction` 必须逐字一致；普通 READY PASS 后 TASK-0056 才迁移到 TASK-0075。

## 范围内

- 创建并消费唯一、直接单父、一次性且消费后惰性的 TASK-0075 pre-READY
  maintenance 记录。
- 精确绑定 TASK-0073 maintenance CI-policy 历史快照与固定 7 路径 planning
  父边的 parent/child mode、type、blob、内容和 Policy projection。
- 只读隔离 TASK-0074 终态 Commit/Tree、5 个制品、READY/pre-closure
  非 PASS tuple；不得把历史检查变为 PASS。
- 为未来 schema、Doctor、Skill 与测试增加严格 `NOT_STARTED` 分支，并保持
  PASS/FAIL/TIMEOUT/UNKNOWN 的强类型合同。
- 保持未来 terminal Handoff.nextAction 与同一终态 project-state.nextAction
  精确一致，并加入正负例。
- 普通 READY PASS 后，原子迁移 TASK-0056 Card、Backlog dependency 和
  delivery-policy core 到 TASK-0075；运行唯一 Reviewer、Windows 合并门禁、
  独立 WSL 与 pre-closure。

## 明确范围外

四消费者实现、性能引擎、workflow、产品、Provider、数据库、H5、身份、凭据、
真实外发、GitHub Actions dispatch/rerun/poll、macOS PASS、远端 PASS、通用
break-glass、环境变量或 CLI bypass、历史改写、分支、worktree、第二条记录、
第二次消费、通配写路径与可配置 allowlist 均不在范围内。

## 输入和前置条件

Base 必须保持
`d41c9f82e69107cf1ecf0cb2c100d39f436faab7` / Tree
`dd7c6f7ee3c7d99b9ec8db2cfd6ceee56c37765e`，且为 TASK-0074 的
REJECTED 终态。Context Lock 只绑定该 Base 的仓库对象；Owner 授权计划、接受
语句与唯一 durable summary receipt 只作为 provenance-only 输入。

## API / 事件 / 数据契约

不新增产品 API、事件、数据库或外部数据契约。唯一合同面是 Harness
machine record、历史 Git 对象、Evidence/Handoff Schema、Task delivery/CI
policy 与 TASK-0056 planning projection。

## 权限、RLS 和数据处理要求

只使用 repository-owner 在同一 source thread 给出的两段精确 provenance。
不得把该授权泛化到其他 Task、其他路径、其他历史边、远端 CI 或任何通用
override；不得写入凭据或外部系统。

## 状态机和失败行为

严格执行 `DRAFT -> READY -> IN_PROGRESS -> IN_REVIEW -> ACCEPTED`。唯一
maintenance 是 DRAFT 后、READY 前的直接单父机器边，不是生命周期状态。READY
Doctor 非零或多出第 11 条错误即停止实现并 REJECTED；READY PASS 前不得迁移
TASK-0056。Reviewer TIMEOUT/UNKNOWN、Windows/WSL/pre-closure 任一非 PASS
都必须诚实终止，禁止复跑或复用。

## 模型、Prompt、记忆和安全边界

Reviewer 只能在候选冻结后由本可见任务启动唯一 `fork_turns=none` 独立代理，
只读、不参与实现、不运行 Doctor/canonical/Windows/WSL。不得将代理型号、额度、
Prompt 或外部记忆作为机器授权。

## 验收标准

1. DRAFT 及唯一 maintenance 均为直接单父，路径集合与每个 mode/type/blob/SHA
   精确绑定；记录不可复制、修改、复用或第二次消费。
2. TASK-0073 CI projection 只使用 maintenance Commit
   `b1c37678...` 自己的 Policy Blob；planning repair 只使用固定边
   `d6fbee...11e6fb...` 的历史对象；任一 identity 漂移失败关闭。
3. TASK-0074 的 5 个终态制品及完整 10-error tuple 精确匹配才隔离；它仍为
   REJECTED，READY/pre-closure 均仍是 FAIL。
4. `NOT_STARTED` 只能表示 READY Doctor 非 PASS 且从未有 READY PASS、
   IN_PROGRESS 或候选；所有锚为 null、elapsedSeconds=0、原因非空。
5. 现有 PASS/FAIL/TIMEOUT/UNKNOWN 的候选 SHA/Tree、预算、终态和 exitCode
   约束不弱化；FAIL Evidence 的 exitCode 始终为非零整数。
6. 未来同一终态 Handoff.nextAction 与 project-state.nextAction 逐字一致；
   只有精确 TASK-0074 历史 mismatch 被只读隔离。
7. 普通 READY Doctor exit 0 后才迁移 TASK-0056；该迁移是唯一精确原子
   parent edge，TASK-0073/0074 历史制品不变。
8. 唯一 Reviewer 在 15 分钟内给出结构化 P0/P1/P2/AC/invariant PASS；
   最多一批修复和 R2，禁止 R3。
9. 同一 clean candidate Commit/Tree 的 Windows 合并门禁完整 6 子命令各执行
   一次并 PASS，随后独立 WSL PASS；macOS/remote 保持非 PASS。
10. 同一实现 SHA/Tree 的 READY、Reviewer、Windows、WSL 与 pre-closure
    全部真实 PASS 才 ACCEPTED 并推送；否则完整 REJECTED 且不推已知失败链。

## 必跑检查

只运行 YAML `requiredCommands` 中冻结的精确 argv；会话恢复 summary 不重跑。
Reviewer 前只运行一次秒级自绑定矩阵与一次 `git diff --check`。长命令均为单
进程 durable receipt，约 60 秒只轮询 receipt existence，且 receipt/stdout/
stderr 只消费一次；transport completion 不等于 command PASS。

## 回滚或前向修复

禁止 reset、rebase、amend、cherry-pick、历史改写或恢复历史制品。任何失败只
允许 append-only REJECTED 闭包；已提交的 maintenance 记录消费后永久惰性，
未来修复必须使用新的 Task 与新的显式 Owner 授权。

## 停止条件

Base/Tree、Owner 两段 provenance、TASK-0073/0074 任一历史对象、固定父边、
路径集合或 Git 身份漂移；出现第 11 条恢复前错误；需要第二条 maintenance；
READY Doctor 非零；Reviewer TIMEOUT/UNKNOWN/P0/P1；候选预算熔断；Windows、
WSL 或 pre-closure 非 PASS；或无法保证同一 candidate Commit/Tree 时立即停止
后续门禁并完成真实 REJECTED 闭包。

## Evidence Pack

输出到精确列出的 `docs/evidence/TASK-0075/` 文件并生成
`docs/handoffs/TASK-0075.json`。远端固定记录
`UNKNOWN_NOT_RUN / OWNER_QUOTA_EVIDENCE_EXPIRED / dispatch=0 /
passClaimed=false`。

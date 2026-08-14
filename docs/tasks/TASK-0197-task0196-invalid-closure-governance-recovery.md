# TASK-0197：TASK-0196 非法终态闭合治理恢复（MUST_SPLIT，本卡不可 READY）

```yaml
taskId: TASK-0197
state: DRAFT
owner: repository-owner
riskClass: C4
requiredSkills:
  - task-delivery-flow
  - task-intake
  - harness-change
requiredSkillVersions:
  task-delivery-flow: "1.3.7"
  task-intake: "1.2.7"
  harness-change: "1.1.7"
targetSkillVersions: {}
planningBacklog: null
planningContractHash: null
planningContractHashAlgorithm: null
baseCommit: 1c1dca2f423ea9935000189e86789201cb859832
authorizationCommit: ""
contextFingerprint: b4d806ce7e2d4a82a53f52d9f447a57b5834143b6afbaca135f85ec363d92905
contextLock: docs/tasks/context/TASK-0197.context-lock.yaml
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
  overallElapsed: {anchor: DRAFT_COMMIT, terminal: TERMINAL_COMMIT, recordingRequired: true, resetOrReanchorForbidden: true}
  intakeActivation: {anchor: DRAFT_COMMIT, terminal: READY_DOCTOR_TERMINAL, targetWallMinutes: 60, hardFuseWallMinutes: 90, timeoutStatus: TIMEOUT, closureOnlyOverrun: true}
  candidateExecution: {anchor: READY_DOCTOR_PASS_AND_IN_PROGRESS_COMMIT, notStartedOutcome: NOT_STARTED, notStartedEligibility: {readyDoctorNonPassRequired: true, readyDoctorPassForbidden: true, inProgressCommitForbidden: true, candidateFreezeForbidden: true}, candidateDeadlineMinutes: 45, targetWallMinutes: 60, hardFuseWallMinutes: 90, timeoutStatus: TIMEOUT, closureOnlyOverrun: true}
  reviewer: {maximumMinutes: 15, timeoutStatus: TIMEOUT, missingTerminalStatus: UNKNOWN}
complexityAssessment:
  policySource: .harness/task-delivery-policy.yaml
  evaluatedBefore: READY
  riskClass: C4
  surfaceId: TASK_0197_TASK0196_INVALID_CLOSURE_GOVERNANCE_RECOVERY
  policySurfaces: [GOVERNANCE, AUTHORIZATION, HISTORY]
  distinctCrossRiskSurfaces: 3
  reviewerMinutesEstimate: 15
  terminalCheckMinutesEstimate: 20
  estimatedWallMinutes: 90
  thresholdsTriggered: [crossRiskSurfacesMinimumDistinct2, reviewerMinutesGreaterThan15, terminalCheckMinutesGreaterThan20, estimatedWallMinutesGreaterThan90]
  splitRecommended: true
  splitRequired: true
  splitDecision: MUST_SPLIT
  readyForbiddenUntilSplit: true
  ownerIndivisibleAuthorization: false
  indivisibleBypassForbidden: true
  pendingBypassForbidden: true
  combinedQuarantineAndHarnessReadyForbidden: true
  splitProposal: >-
    机器策略 complexityGate.splitWhen.crossRiskSurfaces.minimumDistinct=2，
    本卡自认 3 个互异面（GOVERNANCE / AUTHORIZATION / HISTORY），必须拆分。
    不得以 ownerIndivisibleAuthorization=true 或 PENDING 绕过。未获批准的
    quarantine 与 harness/failure-semantics 不得合成一张可 READY 的卡。
    严格串行见 serialSplitPlan：SLICE-AUTHORIZATION → SLICE-GOVERNANCE →
    SLICE-HISTORY；后继永久 ID 只在 Owner 批准拆卡后由 canonical task-intake
    分配，本卡不得预占 TASK-0198/0199。
serialSplitPlan:
  policySource: .harness/task-delivery-policy.yaml
  mode: STRICT_SERIAL
  thisCardReadyForbidden: true
  combinedCardReadyForbidden: true
  successorIdsAssignedOnlyByCanonicalTaskIntake: true
  successorIdReservationForbidden: true
  slices:
    - id: SLICE-AUTHORIZATION
      order: 1
      policySurfaces: [AUTHORIZATION]
      distinctCrossRiskSurfaces: 1
      objective: >-
        以独立后继卡冻结 1c1dca2 非法终态的精确 quarantine 合同与四项 P0，
        只写后继卡治理制品（卡、Context、该后继 Evidence/Handoff），不修改
        doctor.py、test_harness.py、ci-execution-policy.yaml。
      inheritsFrozenBindings:
        - legacyInvalidClosureQuarantine
      writeAllowlistPreview:
        - successor-task-card
        - successor-context-lock
        - successor-docs/evidence/**
        - successor-docs/handoffs/*.json
        - .harness/project-state.yaml
        - .harness/task-ledger.yaml
      implementationPathsForbidden: true
    - id: SLICE-GOVERNANCE
      order: 2
      dependsOn: SLICE-AUTHORIZATION-ACCEPTED
      policySurfaces: [GOVERNANCE]
      distinctCrossRiskSurfaces: 1
      objective: >-
        在 quarantine 合同已 ACCEPTED 之后，实现 Doctor 失败关闭：终态原子性、
        combined effective implementation range、pre-closure receipt、READY
        禁实现、fix-batch amendment、Skill 豁免收紧、terminal_commit=None。
      inheritsFrozenBindings:
        - independentReviewerRange
        - terminalOnlyPathSet
        - requiredCommands
      writeAllowlistPreview:
        - .harness/ci-execution-policy.yaml
        - scripts/harness/doctor.py
        - scripts/harness/tests/test_harness.py
        - successor-task-card
        - successor-context-lock
        - successor-docs/evidence/**
        - successor-docs/handoffs/*.json
        - .harness/project-state.yaml
        - .harness/task-ledger.yaml
    - id: SLICE-HISTORY
      order: 3
      dependsOn: SLICE-GOVERNANCE-ACCEPTED
      policySurfaces: [HISTORY]
      distinctCrossRiskSurfaces: 1
      objective: >-
        精确兼容已登记历史 tail，且 quarantine 后仓库可验证但不得描述为
        TASK-0196 原闭合合法。fe0253f→751cb9d 必须表述为 TASK-0195
        canonical terminal fe0253f 的 post-terminal metadata tail 751cb9d，
        由后继 TASK-0196 消费/登记，不得称为 TASK-0196 tail。
      inheritsFrozenBindings:
        - registeredHistoricalTailCompatibility
legacyInvalidClosureQuarantine:
  authorizationStatus: PENDING_OWNER
  recordId: OWNER-MAINT-20260815-TASK-0197-LEGACY-INVALID-CLOSURE-01
  recordPath: docs/evidence/TASK-0197/legacy-invalid-closure-quarantine.json
  kind: PROPOSED_EXACT_ONE_TIME_LEGACY_INVALID_CLOSURE_QUARANTINE
  historicalVerifiabilityOnly: true
  doesNotLegitimizeInvalidClosure: true
  reusable: false
  oneTimeOnly: true
  copiedRecordForbidden: true
  secondConsumptionForbidden: true
  generalizedHistoricalExemptionForbidden: true
  thisCardMustNotImplement: true
  successorSlice: SLICE-AUTHORIZATION
  predecessor:
    taskId: TASK-0196
    machineState: ACCEPTED
    historicalClosureValidity: INVALID
    successorRecoveryTask: TASK-0197
    rewriteOrRestateAsValidForbidden: true
  claimedCandidate:
    commit: 87cd40a2b59317015ce9a8aa55cda2d2fe686c91
    tree: 83deb6e913b47bd51cb07cdaf444d8b1afcbdeca
    parent: 353b1acd1ccffef3c3a502c6a0061461943316bc
    role: REVIEWER_AND_REQUIRED_COMMANDS_CLAIMED_CANDIDATE
    evidenceHeadCommit: 87cd40a2b59317015ce9a8aa55cda2d2fe686c91
    reviewerReviewedCommit: 87cd40a2b59317015ce9a8aa55cda2d2fe686c91
  actualTerminal:
    commit: 1c1dca2f423ea9935000189e86789201cb859832
    tree: 15fa2ef0d7fceda45fe7102fede24469313c9427
    parent: 87cd40a2b59317015ce9a8aa55cda2d2fe686c91
    singleParentRequired: true
    role: ACTUAL_LEDGER_INTRODUCTION_TERMINAL_ANCHOR
    mixedImplementationAndClosure: true
  readyStateImplementation:
    commit: 353b1acd1ccffef3c3a502c6a0061461943316bc
    tree: 77c378b749ac2eeff564b0b6976c57f097e695dc
    parent: 383e4032b3ad8cd7ae2fa0f028ac311b8c35cf78
    cardState: READY
    changedPaths:
      - scripts/harness/doctor.py
      - scripts/harness/tests/test_harness.py
  p0Findings:
    - id: P0-1
      title: 终态原子性违规
      statement: 1c1dca2 混合 doctor.py/test_harness.py 实现修改与终态闭合制品，违反终态只允许卡、project-state、ledger、Evidence、Handoff。
    - id: P0-2
      title: 候选身份违规
      statement: requiredCommands 与 C4 Reviewer 均绑定 87cd40a，未覆盖 1c1dca2 的实现变化。
    - id: P0-3
      title: pre-closure 缺失
      statement: 没有可核验的修复后 pre-closure receipt；Doctor 提交态 PASS 不能代替 pre-closure。
    - id: P0-4
      title: 授权违规
      statement: 第二修复批次无先提交的 Backlog 强类型 Owner amendment，且超过 maximumFixBatches=1；提交消息或聊天声明不构成授权。
  exactPaths:
    - .harness/project-state.yaml
    - .harness/task-ledger.yaml
    - docs/evidence/TASK-0196/evidence-pack.json
    - docs/evidence/TASK-0196/review-r1.md
    - docs/handoffs/TASK-0196.json
    - docs/tasks/TASK-0196-post-terminal-tail-doctor-fix.md
    - scripts/harness/doctor.py
    - scripts/harness/tests/test_harness.py
  files:
    - path: .harness/project-state.yaml
      mode: "100644"
      type: blob
      blob: 8bec7912ca22fd5b84ea503c42cf65d6682a6414
      contentSha256: 43fd74543240449bfdbc125598c2c706a7652e19da779e09a58c492b35afc9bc
    - path: .harness/task-ledger.yaml
      mode: "100644"
      type: blob
      blob: 1a44ec2430a5d7acd616a7a6a22f3167c3bc9573
      contentSha256: b360ddbfc69101dfd4b0d99249d2aa19850aac1716c9a9ad24a484c1c611514e
    - path: docs/evidence/TASK-0196/evidence-pack.json
      mode: "100644"
      type: blob
      blob: 2a09edab5b2298bf2bf86f12ab3272e7a471a036
      contentSha256: 5917ebd6e250fd059f02d46b12491ad106ad549b852de39156bf7cfd43dba446
    - path: docs/evidence/TASK-0196/review-r1.md
      mode: "100644"
      type: blob
      blob: 0cad34253717c75581b3db62f7c17f46fbc67990
      contentSha256: 9b2a8be3cd1cf0b964c9999bb32d0b7b2f474f99ff065ac8387cba21547510f1
    - path: docs/handoffs/TASK-0196.json
      mode: "100644"
      type: blob
      blob: f1485ecde9d7af763cd4c79b6ecda98fbfc82d6f
      contentSha256: 623935fb65f37f0d6e1d585e77d5c24af4b6a2b1d553b6a22684b3310caebb4a
    - path: docs/tasks/TASK-0196-post-terminal-tail-doctor-fix.md
      mode: "100644"
      type: blob
      blob: 82990b70e27f5923df799ccb4baf17bfc7c552fc
      contentSha256: b99e119417ea99f4ca18404c99e7667564aad6bd1f45ba1311770a212dada8e5
    - path: scripts/harness/doctor.py
      mode: "100644"
      type: blob
      blob: 3734b5e9c4445818025a55f988813b0df22f9e41
      contentSha256: b5a3f027f8934ea3d9f4ee31e1c9802c86bf708a3e30cde81eacb55a26e33951
    - path: scripts/harness/tests/test_harness.py
      mode: "100644"
      type: blob
      blob: ce8ece2070cffc81f6a9cf03194e41f53b8917c6
      contentSha256: 3ef12cdd024c481cf243ea3d9ee119d9f84cc9852cf2e1bea2898316aa84160d
independentReviewerRange:
  kind: COMBINED_EFFECTIVE_IMPLEMENTATION_RANGE
  successorSlice: SLICE-GOVERNANCE
  claimedCandidate: 87cd40a2b59317015ce9a8aa55cda2d2fe686c91
  invalidTerminal: 1c1dca2f423ea9935000189e86789201cb859832
  taskImplementationCandidate: REQUIRED
  coverage:
    - 87cd40a2b59317015ce9a8aa55cda2d2fe686c91
    - 1c1dca2f423ea9935000189e86789201cb859832
    - TASK_IMPLEMENTATION_CANDIDATE
  reviewOnlyClaimedCandidate: FAIL
  reviewOnlyTaskCandidate: FAIL
  reviewOnlyInvalidTerminal: FAIL
terminalOnlyPathSet:
  writeAllowlistDoesNotAuthorizeTerminal: true
  successorSlice: SLICE-GOVERNANCE
  exactPaths:
    - docs/tasks/TASK-0197-task0196-invalid-closure-governance-recovery.md
    - .harness/project-state.yaml
    - .harness/task-ledger.yaml
    - docs/evidence/TASK-0197/**
    - docs/handoffs/TASK-0197.json
  mixingAnyOfTheFollowingFails:
    - .harness/ci-execution-policy.yaml
    - scripts/harness/doctor.py
    - scripts/harness/tests/test_harness.py
    - docs/tasks/context/TASK-0197.context-lock.yaml
registeredHistoricalTailCompatibility:
  successorSlice: SLICE-HISTORY
  entries:
    - taskId: TASK-0098
      kind: REGISTERED_POST_TERMINAL_TAIL
      edge: 1696739-to-d335159
    - taskId: TASK-0189
      kind: REGISTERED_POST_TERMINAL_TAIL
      edge: 7f9f9e3-to-c626005
    - kind: TASK_0195_CANONICAL_TERMINAL_POST_TERMINAL_METADATA_TAIL
      canonicalTerminalTask: TASK-0195
      canonicalTerminal: fe0253fc9cfd0b3d88c11a18273c25b2a8e9274f
      metadataTail: 751cb9db547df2ba33d55d310276bc14e1fbd5eb
      consumedAndRegisteredBy: TASK-0196
      mustNotBeCalledTask0196Tail: true
validationPlan: {frozenBefore: READY, policySource: .harness/ci-execution-policy.yaml, selectedChannel: LOCAL_EXACT_TREE_FALLBACK, profile: precheck}
readAllowlist:
  - .gitattributes
  - AGENTS.md
  - CLAUDE.md
  - requirements-harness.txt
  - .harness/agent-entrypoints.yaml
  - .harness/ci-execution-policy.yaml
  - .harness/commands.yaml
  - .harness/invariants.yaml
  - .harness/license-inventory.yaml
  - .harness/license-policy.yaml
  - .harness/paid-feature-denylist.yaml
  - .harness/phase-scope.yaml
  - .harness/project-state.yaml
  - .harness/protected-paths.yaml
  - .harness/skills.yaml
  - .harness/sources-of-truth.yaml
  - .harness/task-backlog.yaml
  - .harness/task-delivery-policy.yaml
  - .harness/task-ledger.yaml
  - .harness/task-lifecycle.yaml
  - .harness/tools.lock.yaml
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
  - docs/tasks/task-card-template.md
  - docs/tasks/TASK-0098-generation-finalization-terminal-concurrency.md
  - docs/tasks/context/TASK-0098.context-lock.yaml
  - docs/evidence/TASK-0098/pre-ready-maintenance-authorization.json
  - docs/tasks/TASK-0141-p2-23-supply-chain-reproducibility.md
  - docs/tasks/context/TASK-0141.context-lock.yaml
  - docs/evidence/TASK-0141/evidence-pack.json
  - docs/handoffs/TASK-0141.json
  - docs/tasks/TASK-0189-canonical-greenline-restore.md
  - docs/tasks/context/TASK-0189.context-lock.yaml
  - docs/evidence/TASK-0189/pre-ready-maintenance-authorization.json
  - docs/tasks/TASK-0195-p1-worker-lease-fence-inherited-adoption.md
  - docs/tasks/context/TASK-0195.context-lock.yaml
  - docs/evidence/TASK-0195/evidence-pack.json
  - docs/handoffs/TASK-0195.json
  - docs/tasks/TASK-0196-post-terminal-tail-doctor-fix.md
  - docs/tasks/context/TASK-0196.context-lock.yaml
  - docs/evidence/TASK-0196/evidence-pack.json
  - docs/evidence/TASK-0196/review-r1.md
  - docs/evidence/TASK-0196/pre-ready-maintenance-authorization.json
  - docs/evidence/TASK-0196/pre-ready-maintenance-recovery-authorization.json
  - docs/evidence/TASK-0196/pre-ready-maintenance-completion-authorization.json
  - docs/handoffs/TASK-0196.json
  - skills/task-intake/SKILL.md
  - skills/task-delivery-flow/SKILL.md
  - skills/harness-change/SKILL.md
  - scripts/harness/doctor.py
  - scripts/harness/tests/test_harness.py
writeAllowlist:
  - docs/tasks/TASK-0197-task0196-invalid-closure-governance-recovery.md
  - docs/tasks/context/TASK-0197.context-lock.yaml
  - docs/evidence/TASK-0197/**
  - docs/handoffs/TASK-0197.json
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
forbiddenPaths:
  - .github/**
  - ci/**
  - service/**
  - frontend/**
  - infra/**
  - scripts/dev/**
  - scripts/harness/**
  - skills/**
  - .harness/agent-entrypoints.yaml
  - .harness/ci-execution-policy.yaml
  - .harness/commands.yaml
  - .harness/invariants.yaml
  - .harness/license-inventory.yaml
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
  - AGENTS.md
  - CLAUDE.md
  - .gitattributes
  - requirements-harness.txt
  - docs/decisions/**
  - docs/planning/**
  - docs/schemas/**
  - docs/source/**
  - docs/tasks/task-card-template.md
  - docs/tasks/TASK-0098-generation-finalization-terminal-concurrency.md
  - docs/tasks/context/TASK-0098.context-lock.yaml
  - docs/evidence/TASK-0098/**
  - docs/handoffs/TASK-0098.json
  - docs/tasks/TASK-0141-p2-23-supply-chain-reproducibility.md
  - docs/tasks/context/TASK-0141.context-lock.yaml
  - docs/evidence/TASK-0141/**
  - docs/handoffs/TASK-0141.json
  - docs/tasks/TASK-0189-canonical-greenline-restore.md
  - docs/tasks/context/TASK-0189.context-lock.yaml
  - docs/evidence/TASK-0189/**
  - docs/handoffs/TASK-0189.json
  - docs/tasks/TASK-0191-owner-context-rls-trust-model.md
  - docs/tasks/TASK-0192-harness-amendment-diffscope-recovery.md
  - docs/tasks/TASK-0193-p0-owner-context-rls-inherited-adoption.md
  - docs/tasks/TASK-0194-worker-lease-fence-transaction-boundary.md
  - docs/tasks/TASK-0195-p1-worker-lease-fence-inherited-adoption.md
  - docs/tasks/TASK-0196-post-terminal-tail-doctor-fix.md
  - docs/tasks/context/TASK-0191.context-lock.yaml
  - docs/tasks/context/TASK-0192.context-lock.yaml
  - docs/tasks/context/TASK-0193.context-lock.yaml
  - docs/tasks/context/TASK-0194.context-lock.yaml
  - docs/tasks/context/TASK-0195.context-lock.yaml
  - docs/tasks/context/TASK-0196.context-lock.yaml
  - docs/evidence/TASK-0191/**
  - docs/evidence/TASK-0192/**
  - docs/evidence/TASK-0193/**
  - docs/evidence/TASK-0194/**
  - docs/evidence/TASK-0195/**
  - docs/evidence/TASK-0196/**
  - docs/handoffs/TASK-0191.json
  - docs/handoffs/TASK-0192.json
  - docs/handoffs/TASK-0193.json
  - docs/handoffs/TASK-0194.json
  - docs/handoffs/TASK-0195.json
  - docs/handoffs/TASK-0196.json
  - specs/**
  - mvnw
  - mvnw.cmd
  - pom.xml
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
  - scripts/harness/doctor.py
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
  - docs/tasks/TASK-0098-generation-finalization-terminal-concurrency.md
  - docs/tasks/context/TASK-0098.context-lock.yaml
  - docs/evidence/TASK-0098/pre-ready-maintenance-authorization.json
  - docs/tasks/TASK-0189-canonical-greenline-restore.md
  - docs/tasks/context/TASK-0189.context-lock.yaml
  - docs/evidence/TASK-0189/pre-ready-maintenance-authorization.json
  - docs/tasks/TASK-0195-p1-worker-lease-fence-inherited-adoption.md
  - docs/tasks/context/TASK-0195.context-lock.yaml
  - docs/evidence/TASK-0195/evidence-pack.json
  - docs/handoffs/TASK-0195.json
  - docs/tasks/TASK-0196-post-terminal-tail-doctor-fix.md
  - docs/tasks/context/TASK-0196.context-lock.yaml
  - docs/evidence/TASK-0196/evidence-pack.json
  - docs/handoffs/TASK-0196.json
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
requiredInvariants:
  - INV-HARNESS-001
  - INV-HARNESS-002
  - INV-HARNESS-003
  - INV-HARNESS-005
  - INV-HARNESS-007
humanApprovals: []
pendingOwnerDecisions:
  - id: MUST_SPLIT
    status: PENDING
    statement: Owner 必须批准按 serialSplitPlan 严格串行拆成三张各一面的后继卡；本卡不得进入 READY。
  - id: SLICE-AUTHORIZATION
    status: PENDING
    statement: 第一张后继卡（AUTHORIZATION）的目标、白名单与 quarantine 合同尚未获可核验批准。
  - id: SLICE-GOVERNANCE
    status: PENDING
    statement: 第二张后继卡（GOVERNANCE）的 harness-change 与失败关闭范围尚未获可核验批准。
  - id: SLICE-HISTORY
    status: PENDING
    statement: 第三张后继卡（HISTORY）的已登记 tail 兼容与 quarantine 可验证性范围尚未获可核验批准。
independentReview: required
reviewers: []
requiredCommands:
  - PATH=/Users/hxf/.zcode/venvs/vc-harness/bin:$PATH python scripts/harness/precheck.py --task TASK-0197
  - PYTHONPATH=scripts/harness:scripts/harness/tests python -m unittest test_harness.Task0197InvalidClosureGovernanceTests test_harness.Task0098PostTerminalTailTests test_harness.Task0189PostTerminalTailTests test_harness.Task0196PostTerminalTailTests
  - git diff --check
```

> 本卡为独立延续单卡，不写 planningBacklog/planningContractHash。永久 ID 由机器真源派生：
> Task Ledger 现存最大编号当时为 TASK-0196（PERMANENT_NEVER_REUSE），仓库内无既有
> TASK-0197 引用，intake 分配本号。TASK-0196 保持 ACCEPTED 机器状态；独立审计结论
> 为 INVALID，该结论是历史事实，不是本卡 harness-change、authorization、quarantine
> 或不可拆卡的可核验 Owner 批准。长线 Goal 继续不等于逐项批准。
> `complexityGate` 已触发 MUST_SPLIT：本卡不得进入 READY，不得把 quarantine 与
> harness/failure-semantics 合成一张可 READY 的卡。当前 Doctor PASS 只证明仓库
> 可检查，不是 TASK-0196 合法终态的证明。本卡不使用 pre-READY maintenance。

## 背景与用户可观察目标

TASK-0196 于 `1c1dca2` 以 ACCEPTED 写入 Task Ledger，成为当前 lastAccepted/lastTerminal。
独立审计结论为 INVALID（作为历史事实冻入 quarantine 合同，不是 READY 授权）：

1. `1c1dca2` 的 8 个路径同时包含实现修改（`scripts/harness/doctor.py`、
   `scripts/harness/tests/test_harness.py`）与终态制品（卡、project-state、ledger、
   Evidence、Handoff），违反 AGENTS.md「终态提交只原子更新任务卡、项目状态、Task
   Ledger、完整 Evidence 和 Handoff」。
2. Evidence/Handoff/Reviewer 声称候选为 `87cd40a`；requiredCommands 的
   `verifiedCommit` 也是 `87cd40a`。`1c1dca2` 在审查与 requiredCommands 之后改变了
   实现树。
3. Evidence 中没有任何 `doctor.py --task TASK-0196 --pre-closure` 记录；修复批次 2
   后没有可核验的 pre-closure receipt。
4. `1c1dca2` 自称「Owner 授权第 2 修复批次」，但 Backlog 无 TASK-0196 amendment、
   卡无 `scopeAmendments`、`maximumFixBatches: 1` 已被 `353b1ac` 以 1/1 消耗。
5. `task_record_bound_skill_paths` 从卡内 `preReadyMaintenancePlan` 等声明取
   `skills/` 路径即豁免 `targetSkillVersions`，不交叉验证 policy 登记记录。
6. `validate_post_terminal_governance_edges` 在 `terminal_commit is None` 时无条件
   `return`，pre-closure 暂存态等于停用该校验器。

用户可观察目标：本 DRAFT 把 MUST_SPLIT 与严格串行拆卡方案冻成机器可读合同；本卡
不实现、不进入 READY。拆卡并获逐项 Owner 批准之后，后继卡分别恢复：仓库可验证，
TASK-0196 历史闭合保持 INVALID，新的终态/Reviewer/pre-closure/READY/fix-batch/
Skill 豁免失败关闭。不得把当前 Doctor PASS 叙述为原闭合合法。

## 范围内

- 将 `complexityAssessment.splitDecision` 冻为 `MUST_SPLIT`；记录三面交叉风险与
  `readyForbiddenUntilSplit: true`。`ownerIndivisibleAuthorization` 为 false，
  禁止 PENDING 或聊天声明绕过拆卡。
- 冻结 `serialSplitPlan` 三张严格串行后继卡（各一面）：SLICE-AUTHORIZATION →
  SLICE-GOVERNANCE → SLICE-HISTORY。后继永久 ID 只在 Owner 批准拆卡后由
  canonical task-intake 分配。
- 冻结后继卡必须继承的合同：`legacyInvalidClosureQuarantine`（1c1dca2 八路径与
  四项 P0）、`independentReviewerRange`、`terminalOnlyPathSet`、
  `registeredHistoricalTailCompatibility`、`requiredCommands` 中的定向 unittest
  单行 argv。
- 本卡自身只允许修订本卡与 Context Lock，以及日后如 Owner 将本卡 REJECTED/
  SUPERSEDED 闭合时的本卡 Evidence/Handoff/project-state/ledger。本卡
  writeAllowlist **不含** `ci-execution-policy.yaml`、`doctor.py`、
  `test_harness.py`。
- 不使用 pre-READY maintenance。

## 明确范围外

- **本卡不可 READY**：不得把未获批准的 quarantine 与 harness/failure-semantics
  合成一张可 READY 的卡；不得用 PENDING 冒充不可拆卡批准。
- **不实现**：不修改 Harness、不落地 quarantine 记录、不改 Doctor/测试。
- **不预占后继 ID**：不创建 TASK-0198/0199 或任何后继卡，除非 Owner 批准拆卡且
  机器真源确认下一永久 ID。
- **不改写历史**：不 amend/rebase/reset/删除/重写 `1c1dca2`、`87cd40a`、`353b1ac`
  或任何 TASK-0196 提交；不修改 TASK-0191–0196 的卡、Context、Evidence、Handoff
  或 Ledger 历史条目。
- **不把 TASK-0196 追述为有效闭合**：机器状态保持 ACCEPTED，历史闭合效力保持
  INVALID。
- 不在 `docs/evidence/TASK-0196/**` 新增或修改 remediation 文件。
- 不修改 TASK-0141 任何制品。
- 不提供通用历史豁免。
- 不伪造 Owner 批准，不写入 `sourceThreadId`，不把长线 Goal 继续写成
  harness-change / authorization / quarantine / 不可拆卡批准。
- 不 push、不 merge、不 rebase、不 reset、不改写历史。`activeTask` 保持 null。

## 输入和前置条件

- Base Commit：`1c1dca2f423ea9935000189e86789201cb859832`（TASK-0196 实际
  ledger introduction / canonical terminal；唯一父 `87cd40a`）。
- Context Lock：`docs/tasks/context/TASK-0197.context-lock.yaml`（fingerprint
  `b4d806ce…`，52 inputs：51 个 Base Commit 仓库路径 + 1 个独立审计 provenance）。
- 已核验机器状态（2026-08-15，`doctor.py --summary` exit 0 / 1137636 checks）：
  当时 HEAD=`1c1dca2`，worktree clean，`main` ahead 63，未 push，`activeTask=null`，
  `lastAccepted=lastTerminal=TASK-0196`。该 PASS 不得当作 TASK-0196 合法证明。
- 已核验 8 路径身份：`git diff --name-only 87cd40a 1c1dca2` 恰为 quarantine
  `exactPaths`；各文件 1c1dca2 侧 mode `100644` / 上表 blob / contentSha256。
- 已核验声称候选：`87cd40a` tree `83deb6e9…`；其 `doctor.py` blob
  `ac22f4cf…` / sha256 `7106e8c7…`，`test_harness.py` blob `ee5552f9…` /
  sha256 `a40f1915…`，与 1c1dca2 实现树不同。
- 已核验 READY 态实现边：`383e403`（READY，authorizationCommit 回填）→
  `353b1ac` 仅改 `doctor.py`+`test_harness.py`。
- 独立审计 provenance：`owner-accepted-task-0196-independent-audit-20260815`
  sha256 `bc3f2ad1e019d46c71657c4764a8e05228337861242d05b5b3c02fc611c3ca5f`
  （intake 时记录的审计文件哈希；路径名是历史标签，不构成 READY 批准）。

## API / 事件 / 数据契约

- 本卡不修改任何机器策略或脚本。后继 SLICE-GOVERNANCE 若获批准，才允许在
  `ci-execution-policy.yaml` 新增 `task0197LegacyInvalidClosure` 并更新
  `CI_EXECUTION_POLICY_CANONICAL_HASH`。
- 不新增/修改任何 OpenAPI、catalog、contracts、events schema。

## 权限、RLS 和数据处理要求

- 不触数据库、不触 RLS、不触任何业务数据。
- 后继 SLICE-GOVERNANCE 将触及 C4 protected paths（`scripts/harness/**`、
  `.harness/ci-execution-policy.yaml`），必须另卡声明 `harness-change` 人工批准
  与独立 Reviewer。本卡 `humanApprovals` 为空；C4 保护路径批准尚未发生。
- 若本卡将来 REJECTED/SUPERSEDED 闭合，终态提交只允许本卡 terminal-only set。

## 状态机和失败行为

- 本卡 `splitDecision: MUST_SPLIT` 且 `thisCardReadyForbidden: true`。进入 READY
  是失败关闭条件，除非 Owner 先按 serialSplitPlan 拆卡并由 task-intake 建立后继卡。
- TASK-0196 保持 ACCEPTED；历史闭合标记为 INVALID。
- 后继 GOVERNANCE 卡必须强制：终态提交混入 policy / `doctor.py` /
  `test_harness.py` / Context Lock 或其他实现路径 → FAIL；`writeAllowlist`
  不能替代 `terminalOnlyPathSet`。
- 后继 GOVERNANCE 卡必须强制：独立 Reviewer 的 combined effective
  implementation range 为 `87cd40a → 1c1dca2 → 该后继卡 implementation
  candidate`；仅审查 `87cd40a` 或仅审查后继 candidate → FAIL。
- READY 态修改实现路径必须失败；超出 `maximumFixBatches` 且无先提交 Backlog
  强类型 Owner amendment 必须失败；卡内自声明 Skill 豁免必须失败；
  `terminal_commit=None` 不得跳过 HEAD/index/worktree。
- 当前 Doctor PASS、提交消息、聊天声明、长线 Goal 继续均不构成放行理由。

## 模型、Prompt、记忆和安全边界

- 不涉及模型、prompt、记忆或安全模块。

## 一次性 quarantine 合同（冻结给后继 AUTHORIZATION 卡，本卡不实施）

`legacyInvalidClosureQuarantine` 精确绑定以下字段，任一漂移即失败关闭：

| 绑定维度 | 值 |
|---|---|
| 授权状态 | PENDING_OWNER（本卡不得实施） |
| 前任 | TASK-0196 ACCEPTED，历史闭合 INVALID |
| 声称候选 | `87cd40a2b59317015ce9a8aa55cda2d2fe686c91` / tree `83deb6e9…` |
| 实际 terminal | `1c1dca2f423ea9935000189e86789201cb859832` / tree `15fa2ef0…` |
| 单父 | `87cd40a2b59317015ce9a8aa55cda2d2fe686c91` |
| 精确路径集合 | 上表 8 路径（不多不少） |
| 四项 P0 | P0-1 终态原子性；P0-2 候选身份；P0-3 pre-closure 缺失；P0-4 授权 |
| 语义 | 只维持历史可验证性，不合法化原闭合 |

## 正负测试清单（冻结给后继 GOVERNANCE/HISTORY 卡的定向 argv）

YAML `requiredCommands` 已冻结完整单行定向 unittest。负例与正例由后继卡落地，
本卡不实现测试类。

负例：

1. 复现 `353b1ac`：READY 态修改 `doctor.py`/`test_harness.py` → FAIL。
2. 复现 `87cd40a→1c1dca2`：终态提交混合实现路径与闭合制品 → FAIL。
3. Reviewer 仅审查 `87cd40a`，或仅审查后继 implementation candidate → FAIL。
   requiredCommands 绑定旧候选（审查 87cd40a、实现变为 1c1dca2）→ FAIL。
4. 缺少或伪造 pre-closure receipt；receipt 与 HEAD/index tree/任务/候选 SHA 不一致 → FAIL。
5. 第二 fix batch 无先提交 Backlog 强类型 amendment，或超过 `maximumFixBatches` → FAIL。
6. 仅在卡内复制 maintenance plan 的 `skills/` 路径以豁免 `targetSkillVersions` → FAIL。
7. `terminal_commit=None` 暂存旁路（无条件 return、不检查 HEAD/index/worktree）→ FAIL。
8. 错父、额外路径、tree/blob/content 漂移、多父、复制记录、重放消费 → FAIL。
9. 终态混入 `ci-execution-policy.yaml`、`doctor.py`、`test_harness.py`、Context Lock
   或其他实现路径 → FAIL。`writeAllowlist` 含这些路径也不能放行终态。

正例：

10. 正常 IN_PROGRESS 候选 → requiredCommands 绑定同一实现 SHA → 独立 Reviewer
    覆盖 `87cd40a→1c1dca2→该候选` → pre-closure receipt 绑定 HEAD/index tree/
    任务/候选 SHA → 纯闭合终态（仅后继卡、project-state、ledger、该后继
    Evidence、Handoff）→ PASS。
11. TASK-0098 已登记 tail（1696739→d335159）、TASK-0189 已登记 tail
    （7f9f9e3→c626005）、以及 TASK-0195 canonical terminal `fe0253f` 的
    post-terminal metadata tail `751cb9d`（由后继 TASK-0196 消费/登记，不得
    称为 TASK-0196 tail）继续 PASS；不提供通用历史豁免。
12. 精确 quarantine 后当前仓库可验证，但不得描述为 TASK-0196 原闭合合法。

## 验收标准

1. 本卡保持 DRAFT，`splitDecision: MUST_SPLIT`，`humanApprovals: []`，
   `ownerIndivisibleAuthorization: false`，无 `sourceThreadId`，无既成
   harness-change/authorization 批准。Doctor DRAFT 检查 PASS 不得当作可 READY。
2. `serialSplitPlan` 三片严格串行、各一面、后继 ID 未预占。
3. quarantine / Reviewer range / terminal-only set / 0195 metadata tail 措辞
   已冻结且身份与 Git 一致。
4. `requiredCommands` 含完整单行定向 unittest argv；定向命令已在本 DRAFT YAML 冻结，不推迟到后续状态。
5. 本卡 diff 只含本卡与 Context Lock。历史制品零修改。

本卡没有「实现完成即 ACCEPTED」的验收；实现验收属于后继卡。

## 必跑检查

以 YAML `requiredCommands` 的精确 argv 为准（已冻结，不再另行延期冻结）：

1. `PATH=/Users/hxf/.zcode/venvs/vc-harness/bin:$PATH python scripts/harness/precheck.py --task TASK-0197`
2. `PYTHONPATH=scripts/harness:scripts/harness/tests python -m unittest test_harness.Task0197InvalidClosureGovernanceTests test_harness.Task0098PostTerminalTailTests test_harness.Task0189PostTerminalTailTests test_harness.Task0196PostTerminalTailTests`
3. `git diff --check`

本 DRAFT 修订只运行 Doctor 与 `git diff --check`。定向 unittest 由后继
GOVERNANCE/HISTORY 卡在实现后执行；本卡不实现测试类，因此该条在本卡生命周期内
保持未执行，不得记为 PASS。

每条命令记录状态、退出码、验证提交、产物哈希或无产物理由。

## 回滚或前向修复

- 本卡只允许修订任务卡与 Context Lock。
- 后继卡修复边界只允许对其自身 writeAllowlist 在 `maximumFixBatches: 1` 内修订，
  且必须先有已提交的 Backlog 强类型 Owner amendment。
- 提交消息、聊天声明、未提交 worktree/index、PENDING 字段不构成授权。

## 停止条件

- 任何把本卡推进 READY 的尝试立即停止。
- 需要修改 writeAllowlist 外路径或实现 Harness 时立即停止。
- 发现必须 pre-READY 修改 Harness 时停在 DRAFT。
- 试图把 TASK-0196 追述为有效闭合、或把 Goal 继续写成逐项批准时立即停止。
- 任何把 NOT_RUN/失败/超时转为 PASS 的行为立即停止。

## Evidence Pack

若 Owner 将本卡按 MUST_SPLIT 作 REJECTED/SUPERSEDED 规划闭合，Evidence 只写入
`docs/evidence/TASK-0197/`，并生成 `docs/handoffs/TASK-0197.json`。不得写入
`docs/evidence/TASK-0196/**`。quarantine JSON 属于后继 AUTHORIZATION 卡，本卡
不创建该文件。

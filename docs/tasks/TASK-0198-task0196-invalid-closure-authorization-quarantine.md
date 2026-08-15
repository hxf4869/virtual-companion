# TASK-0198：TASK-0196 非法终态一次性 quarantine 合同冻结（SLICE-AUTHORIZATION）

```yaml
taskId: TASK-0198
state: READY
owner: repository-owner
riskClass: C2
requiredSkills:
  - task-delivery-flow
  - task-intake
requiredSkillVersions:
  task-delivery-flow: "1.3.7"
  task-intake: "1.2.7"
targetSkillVersions: {}
planningBacklog: null
planningContractHash: null
planningContractHashAlgorithm: null
baseCommit: 0b955f3f0ab577f6f6e9a5262df8d8dc83465a22
authorizationCommit: ""
contextFingerprint: 8239064e349d4f2fcdee202c217e5a7b2245bb927fb37592f144367f5c40a080
contextLock: docs/tasks/context/TASK-0198.context-lock.yaml
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
  riskClass: C2
  surfaceId: TASK_0198_SLICE_AUTHORIZATION_LEGACY_INVALID_CLOSURE_QUARANTINE
  policySurfaces: [AUTHORIZATION]
  distinctCrossRiskSurfaces: 1
  reviewerMinutesEstimate: 10
  terminalCheckMinutesEstimate: 15
  estimatedWallMinutes: 45
  thresholdsTriggered: []
  splitRecommended: false
  splitRequired: false
  splitDecision: KEEP
  readyForbiddenUntilSplit: false
  ownerIndivisibleAuthorization: false
  predecessorSplitCard: TASK-0197
  predecessorSplitDecision: MUST_SPLIT
  thisSlice: SLICE-AUTHORIZATION
  implementationPathsForbidden: true
validationPlan: {frozenBefore: READY, policySource: .harness/ci-execution-policy.yaml, selectedChannel: LOCAL_EXACT_TREE_FALLBACK, profile: precheck}
legacyInvalidClosureQuarantine:
  authorizationStatus: GOAL_AUTHORIZED_SLICE_AUTHORIZATION
  recordId: OWNER-MAINT-20260815-TASK-0198-LEGACY-INVALID-CLOSURE-01
  recordPath: docs/evidence/TASK-0198/legacy-invalid-closure-quarantine.json
  kind: EXACT_ONE_TIME_LEGACY_INVALID_CLOSURE_QUARANTINE
  historicalVerifiabilityOnly: true
  doesNotLegitimizeInvalidClosure: true
  reusable: false
  oneTimeOnly: true
  copiedRecordForbidden: true
  secondConsumptionForbidden: true
  generalizedHistoricalExemptionForbidden: true
  thisCardMustImplementRecord: true
  thisCardMustNotImplementHarness: true
  inheritedFrom: TASK-0197
  predecessor:
    taskId: TASK-0196
    machineState: ACCEPTED
    historicalClosureValidity: INVALID
    successorRecoveryTask: TASK-0197
    authorizationSliceTask: TASK-0198
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
  - docs/tasks/TASK-0196-post-terminal-tail-doctor-fix.md
  - docs/tasks/context/TASK-0196.context-lock.yaml
  - docs/evidence/TASK-0196/evidence-pack.json
  - docs/evidence/TASK-0196/review-r1.md
  - docs/handoffs/TASK-0196.json
  - docs/tasks/TASK-0197-task0196-invalid-closure-governance-recovery.md
  - docs/tasks/context/TASK-0197.context-lock.yaml
  - docs/evidence/TASK-0197/evidence-pack.json
  - docs/evidence/TASK-0197/review-r1.md
  - docs/handoffs/TASK-0197.json
  - scripts/harness/doctor.py
  - scripts/harness/tests/test_harness.py
  - skills/task-intake/SKILL.md
  - skills/task-delivery-flow/SKILL.md
writeAllowlist:
  - docs/tasks/TASK-0198-task0196-invalid-closure-authorization-quarantine.md
  - docs/tasks/context/TASK-0198.context-lock.yaml
  - docs/evidence/TASK-0198/**
  - docs/handoffs/TASK-0198.json
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
  - docs/tasks/TASK-0196-post-terminal-tail-doctor-fix.md
  - docs/tasks/TASK-0197-task0196-invalid-closure-governance-recovery.md
  - docs/tasks/context/TASK-0196.context-lock.yaml
  - docs/tasks/context/TASK-0197.context-lock.yaml
  - docs/evidence/TASK-0196/**
  - docs/evidence/TASK-0197/**
  - docs/handoffs/TASK-0196.json
  - docs/handoffs/TASK-0197.json
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
  - .harness/protected-paths.yaml
  - .harness/skills.yaml
  - skills/task-intake/SKILL.md
  - skills/task-delivery-flow/SKILL.md
  - docs/tasks/TASK-0196-post-terminal-tail-doctor-fix.md
  - docs/tasks/TASK-0197-task0196-invalid-closure-governance-recovery.md
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
humanApprovals:
  - scope: task-intake
    approvedBy: repository-owner
    approvedAt: "2026-08-15"
    evidence: >-
      Owner Goal session 01a0034f-c7a4-7563-bb7a-01834924e3f7 书面授权日常工程、拆卡、
      canonical task-intake 与常规修复。本 Goal 采纳 TASK-0197 推荐方案 A：never-READY
      REJECTED 后 intake 唯一 SLICE-AUTHORIZATION。本卡只冻结 1c1dca2 八路径/四项 P0
      quarantine 合同到本卡 Evidence，不改 Harness，不改变失败/安全/契约语义，不触及
      保护路径 humanApproval。不编造 sourceThreadId。
independentReview: not-required
reviewers: []
requiredCommands:
  - PATH=/Users/hxf/.zcode/venvs/vc-harness/bin:$PATH python scripts/harness/precheck.py --task TASK-0198
  - PATH=/Users/hxf/.zcode/venvs/vc-harness/bin:$PATH python docs/evidence/TASK-0198/verify_quarantine_contract.py
  - git diff --check
```

> 本卡为独立延续单卡，不写 planningBacklog/planningContractHash。永久 ID 由机器真源派生：
> Task Ledger 现存最大编号为 TASK-0197（PERMANENT_NEVER_REUSE），仓库内无既有
> TASK-0198 引用，intake 分配本号。本卡是 TASK-0197 `serialSplitPlan` 的第一片
> SLICE-AUTHORIZATION。TASK-0196 保持 ACCEPTED 机器状态；历史闭合保持 INVALID。
> 本卡不实现 Doctor/Harness，不预占 GOVERNANCE/HISTORY 永久 ID。

## 背景与用户可观察目标

TASK-0197 已按 MUST_SPLIT never-READY REJECTED 纯闭合（`0b955f3`）。其冻结的
`legacyInvalidClosureQuarantine` 身份必须落到后继 Evidence 路径，不得回写
TASK-0196/0197 历史制品。

用户可观察目标：仓库出现一份一次性、不可复用、不合法化原闭合的 quarantine
JSON，精确绑定 1c1dca2 八路径与四项 P0；当前仓库可验证，但不得把 TASK-0196
追述为合法闭合。

## 范围内

- 继承 TASK-0197 冻结的 quarantine 身份（声称候选 87cd40a、实际 terminal
  1c1dca2、READY 实现边 353b1ac、八路径 mode/blob/contentSha256、四项 P0）。
- 新 recordId / recordPath 绑定本卡；`copiedRecordForbidden`：不得复制
  `OWNER-MAINT-20260815-TASK-0197-LEGACY-INVALID-CLOSURE-01`。
- 实现 `docs/evidence/TASK-0198/legacy-invalid-closure-quarantine.json` 与
  只读核验脚本 `docs/evidence/TASK-0198/verify_quarantine_contract.py`。
- 本卡治理制品与终态闭合。

## 明确范围外

- 不修改 `scripts/harness/**`、`.harness/ci-execution-policy.yaml` 或任何
  Harness 失败语义。
- 不改写 TASK-0196/0197 历史卡、Context、Evidence、Handoff、Ledger 条目。
- 不把 TASK-0196 追述为有效闭合。
- 不实施 GOVERNANCE（Doctor 收紧）或 HISTORY（已登记 tail 兼容）。
- 不预占后继 ID，不合卡 COORD/SAFETY/QUOTA/TLS/RETRY/CANCEL。
- 不 push / merge / rebase / reset / 历史改写。

## 输入和前置条件

- Base Commit：`0b955f3f0ab577f6f6e9a5262df8d8dc83465a22`（TASK-0197 REJECTED
  终态；单父 `44bc6aa`）。
- Context Lock：39 输入（38 个 Base 仓库路径 + 1 个独立审计 provenance）。
- TASK-0197 机器 REJECTED；`activeTask=null`；`lastAccepted=TASK-0196`；
  `lastTerminal=TASK-0197`。
- 八路径身份仍以 1c1dca2 侧 blob/contentSha256 为准，与 TASK-0197 冻结表逐字一致。

## API / 事件 / 数据契约

- 不修改 OpenAPI、catalog、contracts、events、数据库。
- quarantine JSON 只维持历史可验证性，不构成通用豁免。

## 权限、RLS 和数据处理要求

- 不触数据库、RLS 或业务数据。
- 写路径均为 C2 task-intake 治理制品；不申请 harness-change 人工批准。

## 状态机和失败行为

- 本卡单面 AUTHORIZATION，`splitDecision: KEEP`。
- quarantine JSON 任一身份字段漂移 → FAIL。
- 把 TASK-0196 写成合法闭合 → FAIL。
- 修改 Harness 或 0196/0197 历史制品 → FAIL。
- 复制 0197 recordId 或二次消费 → FAIL。

## 模型、Prompt、记忆和安全边界

- 不涉及模型、prompt、记忆或安全模块。

## 验收标准

1. `docs/evidence/TASK-0198/legacy-invalid-closure-quarantine.json` 存在且与卡内
   `legacyInvalidClosureQuarantine` 身份字段一致（八路径、四项 P0、87cd40a /
   1c1dca2 / 353b1ac 的 commit/tree/blob/contentSha256）。
2. JSON 声明 `doesNotLegitimizeInvalidClosure: true`；TASK-0196 机器 ACCEPTED，
   历史闭合 INVALID。
3. 核验脚本对正确 JSON PASS，对故意漂移 FAIL。
4. Diff 不包含 Harness、0196/0197 历史制品或保护路径。
5. 冻结 requiredCommands 真实执行；FAIL/NOT_RUN 不得改写成 PASS。

## 必跑检查

以 YAML `requiredCommands` 的精确 argv 为准。

## 回滚或前向修复

- 只允许本卡 writeAllowlist 在 `maximumFixBatches: 1` 内修订。
- 需要 Harness 修复时停止并交给后继 GOVERNANCE 卡。

## 停止条件

- 需要修改 writeAllowlist 外路径立即停止。
- 试图把 TASK-0196 追述为有效闭合立即停止。
- 任何把 NOT_RUN/失败/超时转为 PASS 的行为立即停止。

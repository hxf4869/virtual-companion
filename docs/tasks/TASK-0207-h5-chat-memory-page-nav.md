# TASK-0207：H5 聊天页增加记忆管理入口

```yaml
taskId: TASK-0207
state: DRAFT
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
baseCommit: aca55b002bea606f3ddcebc5220ddd228daf6a87
authorizationCommit: ""
contextFingerprint: a3fafd8c24012e4503f71c19f9efd672f03f2eb5bba29b214637ed81a4e490a4
contextLock: docs/tasks/context/TASK-0207.context-lock.yaml
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
  surfaceId: TASK_0207_H5_CHAT_MEMORY_PAGE_NAV
  policySurfaces: [AUTHORIZATION]
  distinctCrossRiskSurfaces: 1
  reviewerMinutesEstimate: 8
  terminalCheckMinutesEstimate: 10
  estimatedWallMinutes: 30
  thresholdsTriggered: []
  splitRequired: false
  splitDecision: KEEP
  ownerIndivisibleAuthorization: false
validationPlan: {frozenBefore: READY, policySource: .harness/ci-execution-policy.yaml, selectedChannel: LOCAL_EXACT_TREE_FALLBACK, profile: precheck}
readAllowlist:
  - AGENTS.md
  - CLAUDE.md
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - .harness/task-lifecycle.yaml
  - .harness/task-delivery-policy.yaml
  - .harness/protected-paths.yaml
  - .harness/skills.yaml
  - .harness/invariants.yaml
  - .harness/sources-of-truth.yaml
  - skills/task-intake/SKILL.md
  - skills/task-delivery-flow/SKILL.md
  - docs/tasks/task-card-template.md
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
  - frontend/package.json
  - frontend/src/pages/chat/chat.vue
  - frontend/src/pages/chat/chat.spec.ts
  - frontend/src/stores/chat.ts
writeAllowlist:
  - docs/tasks/TASK-0207-h5-chat-memory-page-nav.md
  - docs/tasks/context/TASK-0207.context-lock.yaml
  - docs/evidence/TASK-0207/**
  - docs/handoffs/TASK-0207.json
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - frontend/src/pages/chat/chat.vue
  - frontend/src/pages/chat/chat.spec.ts
forbiddenPaths:
  - .github/**
  - ci/**
  - service/**
  - infra/**
  - scripts/**
  - skills/**
  - .harness/ci-execution-policy.yaml
  - .harness/commands.yaml
  - .harness/invariants.yaml
  - .harness/protected-paths.yaml
  - .harness/skills.yaml
  - .harness/task-backlog.yaml
  - .harness/task-delivery-policy.yaml
  - .harness/task-lifecycle.yaml
  - AGENTS.md
  - CLAUDE.md
  - docs/tasks/task-card-template.md
  - specs/**
  - frontend/src/api/**
  - frontend/src/stores/**
  - frontend/src/domain/**
sourcesOfTruth:
  - AGENTS.md
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - .harness/task-lifecycle.yaml
  - skills/task-intake/SKILL.md
  - frontend/src/pages/chat/chat.vue
  - frontend/src/stores/chat.ts
requiredInvariants:
  - INV-HARNESS-001
  - INV-HARNESS-002
  - INV-GEN-001
humanApprovals:
  - scope: task-intake
    approvedBy: repository-owner
    approvedAt: "2026-08-15"
    evidence: >-
      Owner Goal session 01a0034f-c7a4-7563-bb7a-01834924e3f7 书面授权日常工程、
      产品细节与合法 task-intake。本卡只在聊天页增加通往记忆管理的展示入口，
      不改变发送、取消、失败或记忆确认语义。不编造 sourceThreadId。
independentReview: not-required
reviewers: []
requiredCommands:
  - PATH=/Users/hxf/.zcode/venvs/vc-harness/bin:$PATH python scripts/harness/precheck.py --task TASK-0207
  - pnpm --dir frontend exec vitest run src/pages/chat/chat.spec.ts
  - git diff --check
```

> 本卡为独立延续单卡。永久 ID 由机器派生：Ledger 最大编号 TASK-0206，intake 分配 TASK-0207。

## 背景与用户可观察目标

Technical Alpha 要求候选记忆经确认才成为事实。聊天后用户只能先回边界台再进记忆页。
本卡只在聊天页补通往既有记忆页的展示入口，不改变发送、取消或确认语义。

## 范围内

- 仅改 `chat.vue` 与 `chat.spec.ts`。
- 页头增加 `data-testid=nav-memory`「记忆管理」，复用既有 `goTo`。
- 入口在初始化失败或关系选择态也可见。
- 测试：入口可见；点击导航到 `/pages/memory/memory`，不调用 send/cancel；既有返回边界台测试继续 PASS。
- 不改 store/API/取消。

## 明确范围外

- 不改 `stores/chat.ts`、取消、重试、失败语义。
- 不改记忆确认/store。
- 不在记忆页加回聊天入口（留给后续卡）。

## 输入和前置条件

- Base：`aca55b0`（TASK-0206 ACCEPTED 终态）。
- 仓库 idle，`activeTask=null`。

## API / 事件 / 数据契约

- 不修改任何 API/事件/schema。

## 权限、RLS 和数据处理要求

- 不触后端与 RLS。

## 状态机和失败行为

- 导航失败不影响 `send` / `cancel` / phase。
- 不改变 generation 生命周期。

## 模型、Prompt、记忆和安全边界

- 不改变记忆确认语义。

## 验收标准

1. 聊天页渲染 `data-testid=nav-memory`。
2. 点击导航到 `/pages/memory/memory`。
3. 既有返回边界台、空历史、发送失败回填测试继续 PASS。
4. 冻结命令真实执行；不得把 FAIL/NOT_RUN 写成 PASS。

## 必跑检查

以 YAML `requiredCommands` 为准。

## 回滚或前向修复

- 仅 writeAllowlist，`maximumFixBatches: 1`。

## 停止条件

- 需要改 store/API/取消/确认语义立即停止。
- 伪造 PASS 立即停止。

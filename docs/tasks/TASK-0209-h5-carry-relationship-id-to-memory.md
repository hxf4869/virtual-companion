# TASK-0209：H5 聊天进入记忆页时预填 relationship id

```yaml
taskId: TASK-0209
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
baseCommit: 1239f4fa4dc0d2b876699bb8e267743ca6fd268b
authorizationCommit: c84f2e51481d6a7fd821038a0950ad45bb19fd9e
contextFingerprint: 483f6eceaf43cc059f066b07bbbed907c7020ec31ea8fdfdabb26e923632e7dd
contextLock: docs/tasks/context/TASK-0209.context-lock.yaml
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
  surfaceId: TASK_0209_H5_CARRY_RELATIONSHIP_ID_TO_MEMORY
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
  - frontend/src/pages/memory/memory.vue
  - frontend/src/pages/memory/memory.spec.ts
  - frontend/src/stores/chat.ts
  - frontend/src/stores/memory.ts
writeAllowlist:
  - docs/tasks/TASK-0209-h5-carry-relationship-id-to-memory.md
  - docs/tasks/context/TASK-0209.context-lock.yaml
  - docs/evidence/TASK-0209/**
  - docs/handoffs/TASK-0209.json
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - frontend/src/pages/chat/chat.vue
  - frontend/src/pages/chat/chat.spec.ts
  - frontend/src/pages/memory/memory.vue
  - frontend/src/pages/memory/memory.spec.ts
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
  - frontend/src/pages/memory/memory.vue
requiredInvariants:
  - INV-HARNESS-001
  - INV-HARNESS-002
humanApprovals:
  - scope: task-intake
    approvedBy: repository-owner
    approvedAt: "2026-08-15"
    evidence: >-
      Owner Goal session 01a0034f-c7a4-7563-bb7a-01834924e3f7 书面授权日常工程、
      产品细节与合法 task-intake。本卡只在聊天进入记忆页时用 query 预填 relationship id，
      不自动 load，不改变确认/失败语义。不编造 sourceThreadId。
independentReview: not-required
reviewers: []
requiredCommands:
  - pnpm --dir frontend exec vitest run src/pages/chat/chat.spec.ts src/pages/memory/memory.spec.ts
  - git diff --check
```

> 本卡为独立延续单卡。永久 ID 由机器派生：Ledger 最大编号 TASK-0208，intake 分配 TASK-0209。

## 背景与用户可观察目标

聊天页已能进记忆页，但不带当前关系。用户必须手填 relationship id 才能刷新。
有当前关系时，导航附带 query；记忆页只预填输入框，不自动 load。

## 范围内

- 改 `chat.vue` / `chat.spec.ts` / `memory.vue` / `memory.spec.ts`。
- 聊天「记忆管理」：有 `currentRelationshipId` 时跳到 `/pages/memory/memory?relationshipId=`。
- 无当前关系时仍跳 `/pages/memory/memory`。
- 记忆页挂载时从 `location.search` 读取并预填；不调用 `memory.load`。
- 测试覆盖有/无关系导航，以及预填且不自动 load。

## 明确范围外

- 不改 store/API/确认/取消。
- 不自动刷新记忆。

## 输入和前置条件

- Base：`1239f4f`（TASK-0208 ACCEPTED）。仓库 idle。

## API / 事件 / 数据契约

- 不修改 API/schema。query 仅作页面预填。

## 权限、RLS 和数据处理要求

- 不触后端与 RLS。

## 状态机和失败行为

- 无效/空 query 保持空输入。不自动 load。

## 模型、Prompt、记忆和安全边界

- 不改变记忆确认语义。

## 验收标准

1. 有当前关系时，记忆入口带 `relationshipId` query。
2. 无当前关系时，不带 query。
3. 记忆页预填该 id，且不自动 load。
4. 既有空列表/导航测试继续 PASS。

## 必跑检查

本轮按 Owner 要求只跑 vitest 与 `git diff --check`。canonical precheck / Doctor / pre-closure 延后统一跑，不得把未跑写成 PASS。

## 回滚或前向修复

- 仅 writeAllowlist，`maximumFixBatches: 1`。

## 停止条件

- 需要改 store/API/自动 load 立即停止。

# TASK-0210：H5 记忆页用关系选择器填入 relationship id

```yaml
taskId: TASK-0210
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
baseCommit: 1239f4fa4dc0d2b876699bb8e267743ca6fd268b
authorizationCommit: ""
contextFingerprint: 3340c407bcb50a1f8d441547ff298ad4b38e69175fb55f6ccbe81634a236aadb
contextLock: docs/tasks/context/TASK-0210.context-lock.yaml
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
  surfaceId: TASK_0210_H5_MEMORY_PICK_RELATIONSHIP_ID
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
  - frontend/src/pages/memory/memory.vue
  - frontend/src/pages/memory/memory.spec.ts
  - frontend/src/components/RelationshipSelector.vue
  - frontend/src/components/RelationshipSelector.spec.ts
  - frontend/src/stores/memory.ts
  - frontend/src/stores/relationship.ts
writeAllowlist:
  - docs/tasks/TASK-0210-h5-memory-pick-relationship-id.md
  - docs/tasks/context/TASK-0210.context-lock.yaml
  - docs/evidence/TASK-0210/**
  - docs/handoffs/TASK-0210.json
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
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
  - frontend/src/components/**
sourcesOfTruth:
  - AGENTS.md
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - .harness/task-lifecycle.yaml
  - skills/task-intake/SKILL.md
  - frontend/src/pages/memory/memory.vue
  - frontend/src/components/RelationshipSelector.vue
requiredInvariants:
  - INV-HARNESS-001
  - INV-HARNESS-002
humanApprovals:
  - scope: task-intake
    approvedBy: repository-owner
    approvedAt: "2026-08-15"
    evidence: >-
      Owner Goal session 01a0034f-c7a4-7563-bb7a-01834924e3f7 书面授权日常工程、
      产品细节与合法 task-intake。本卡只让记忆页用既有选择器填入 relationship id，
      不调用 activate/create，不自动 load，不改变确认语义。不编造 sourceThreadId。
independentReview: not-required
reviewers: []
requiredCommands:
  - pnpm --dir frontend exec vitest run src/pages/memory/memory.spec.ts
  - git diff --check
```

> 本卡为独立延续单卡。永久 ID 由机器派生：Ledger 最大编号 TASK-0209（活动中），intake 分配 TASK-0210。
> 当前 `activeTask=TASK-0209`。本卡保持 idle DRAFT，不得 READY，不得实施。READY 前必须把 `baseCommit` / Context Lock 重锚到 TASK-0209 终态。

## 背景与用户可观察目标

记忆页仍靠手填 relationship id。聊天页已有关系选择器，记忆页没有复用。
从边界台进入时用户不知道该填什么。本卡只把既有选择器接到记忆页：选中后写入输入框，用户仍点「刷新记忆」。

## 范围内

- 仅改 `memory.vue` 与 `memory.spec.ts`。
- 复用 `RelationshipSelector`：`@activate` 只把 id 写入 `relationshipId`。
- 可 `relStore.load` 以填充列表；**禁止** `activate` / `create`。
- 不自动 `memory.load`。
- 测试：选择关系后输入框为该 id；不调用 confirm/activate/create/memory.load；既有空列表/预填/导航测试继续 PASS。

## 明确范围外

- 不改 `RelationshipSelector.vue`、relationship/memory store、API。
- 不改变服务端 active companion。
- 不自动刷新记忆。

## 输入和前置条件

- 规划 Base：`1239f4f`（TASK-0208 ACCEPTED，最后终态）。
- 实施前必须重锚到 TASK-0209 ACCEPTED。
- 本卡 DRAFT 期间 `activeTask` 保持 TASK-0209。

## API / 事件 / 数据契约

- 不修改 API/schema。

## 权限、RLS 和数据处理要求

- 不触后端与 RLS。

## 状态机和失败行为

- 选择器 load 失败走既有 selector error，不伪造关系。
- 选中只改输入框。

## 模型、Prompt、记忆和安全边界

- 不改变记忆确认语义。

## 验收标准

1. 记忆页渲染关系选择器。
2. 选择一条关系后，relationship id 输入框为该 id。
3. 不调用 `relStore.activate` / `create` / `memory.load`。
4. 既有预填 query、空列表、导航测试继续 PASS。

## 必跑检查

以 YAML `requiredCommands` 为准。长检查（Doctor / precheck / pre-closure）延后到 0209 终态后的统一批次，不得把未跑写成 PASS。

## 回滚或前向修复

- 仅 writeAllowlist，`maximumFixBatches: 1`。

## 停止条件

- 需要改 store/API/激活/自动 load 立即停止。
- 在 TASK-0209 仍活动时 READY 或实施立即停止。

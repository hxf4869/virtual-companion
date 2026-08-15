# TASK-0212：H5 记忆页隐藏未接线的新建关系控件

```yaml
taskId: TASK-0212
state: ACCEPTED
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
baseCommit: 1391cb11d6b0fbf87148dc2e0f63c78f455055b7
authorizationCommit: 51b34c5baab4e14ab7a3fad0ed06ca9d9c20f7c5
contextFingerprint: 3907911707ff648f97f5e68b34ef0f9fce785be0bdff3905170c1f2e664cbe60
contextLock: docs/tasks/context/TASK-0212.context-lock.yaml
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
  surfaceId: TASK_0212_H5_MEMORY_HIDE_UNWIRED_CREATE
  policySurfaces: [AUTHORIZATION]
  distinctCrossRiskSurfaces: 1
  reviewerMinutesEstimate: 8
  terminalCheckMinutesEstimate: 10
  estimatedWallMinutes: 25
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
  - frontend/src/components/RelationshipSelector.vue
  - frontend/src/components/RelationshipSelector.spec.ts
  - frontend/src/pages/chat/chat.vue
  - frontend/src/pages/memory/memory.vue
  - frontend/src/pages/memory/memory.spec.ts
  - frontend/src/stores/relationship.ts
writeAllowlist:
  - docs/tasks/TASK-0212-h5-memory-hide-unwired-create.md
  - docs/tasks/context/TASK-0212.context-lock.yaml
  - docs/evidence/TASK-0212/**
  - docs/handoffs/TASK-0212.json
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - frontend/src/components/RelationshipSelector.vue
  - frontend/src/components/RelationshipSelector.spec.ts
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
  - frontend/src/pages/chat/**
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
      产品细节与合法 task-intake。本卡只让记忆页隐藏未接线的新建关系控件，
      不调用 create/activate，不自动 load，不改变确认语义。不编造 sourceThreadId。
independentReview: not-required
reviewers: []
requiredCommands:
  - pnpm --dir frontend exec vitest run src/pages/memory/memory.spec.ts src/components/RelationshipSelector.spec.ts
  - git diff --check
```

> 本卡为独立延续单卡。永久 ID 由机器派生：Ledger 最大编号 TASK-0211，intake 分配 TASK-0212。
> Base 为 TASK-0211 ACCEPTED `1391cb1`。本提交将本卡转为 READY。

## 背景与用户可观察目标

记忆页复用关系选择器只为填入 relationship id。选择器仍展示「新建关系」输入和按钮，点击不会创建。
用户会以为可以在记忆页新建关系。本卡隐藏该控件。

## 范围内

- 改 `RelationshipSelector.vue` / `.spec.ts`：增加默认 true 的 `showCreate` 展示开关。
- `showCreate=false` 时不渲染新建输入/按钮；空列表文案不要求去新建。
- 记忆页传入 `showCreate=false`。聊天页保持默认，仍可新建。
- 测试：记忆页无 create 控件；选择器默认仍展示 create；既有填入/预填/导航测试继续 PASS。

## 明确范围外

- 不改 chat.vue、store、API。
- 不接线 `create` / `activate`，不自动 load。

## 输入和前置条件

- Base：`1391cb11d6b0fbf87148dc2e0f63c78f455055b7`（TASK-0211 ACCEPTED）。仓库 idle。

## API / 事件 / 数据契约

- 不修改 API/schema。`create` emit 仍存在，记忆页不监听。

## 权限、RLS 和数据处理要求

- 不触后端与 RLS。

## 状态机和失败行为

- 不改变选择器 load 失败语义。

## 模型、Prompt、记忆和安全边界

- 不改变记忆确认语义。

## 验收标准

1. 记忆页不渲染 persona-ref / create-relationship 控件。
2. 选择器默认（聊天用法）仍渲染新建控件。
3. 既有选择填入、中性提示、预填、导航测试继续 PASS。

## 必跑检查

以 YAML `requiredCommands` 为准。READY 后跑官方 Doctor；终态前跑官方 precheck 与 pre-closure。不得把未跑写成 PASS。

## 回滚或前向修复

- 仅 writeAllowlist，`maximumFixBatches: 1`。

## 停止条件

- 需要改 store/API/聊天页/自动 load/接线 create 立即停止。

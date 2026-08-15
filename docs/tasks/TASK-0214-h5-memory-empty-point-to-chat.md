# TASK-0214：H5 记忆页无关系时提示去聊天新建

```yaml
taskId: TASK-0214
state: IN_REVIEW
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
baseCommit: 14a8f4efba69b77e7f4d629bd73a1e6a68980ae1
authorizationCommit: 8b00c21be6efd6a43fe700aec60e6a1aa0225d98
contextFingerprint: a6e50dedd1bf8f4b0c9eaae63bc76d40765a5b091b79db552380b3aa88bb47e4
contextLock: docs/tasks/context/TASK-0214.context-lock.yaml
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
  surfaceId: TASK_0214_H5_MEMORY_EMPTY_POINT_TO_CHAT
  policySurfaces: [AUTHORIZATION]
  distinctCrossRiskSurfaces: 1
  reviewerMinutesEstimate: 6
  terminalCheckMinutesEstimate: 6
  estimatedWallMinutes: 20
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
  - frontend/src/pages/memory/memory.vue
  - frontend/src/pages/memory/memory.spec.ts
writeAllowlist:
  - docs/tasks/TASK-0214-h5-memory-empty-point-to-chat.md
  - docs/tasks/context/TASK-0214.context-lock.yaml
  - docs/evidence/TASK-0214/**
  - docs/handoffs/TASK-0214.json
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - frontend/src/components/RelationshipSelector.vue
  - frontend/src/components/RelationshipSelector.spec.ts
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
  - frontend/src/pages/index/**
sourcesOfTruth:
  - AGENTS.md
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - .harness/task-lifecycle.yaml
  - skills/task-intake/SKILL.md
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
      产品细节与合法 task-intake。本卡只改无关系空文案，指向离线聊天新建，
      不接线 create/activate，不自动 load。不编造 sourceThreadId。
independentReview: not-required
reviewers: []
requiredCommands:
  - pnpm --dir frontend exec vitest run src/components/RelationshipSelector.spec.ts src/pages/memory/memory.spec.ts
  - git diff --check
```

> 本卡为独立延续单卡。永久 ID 由机器派生：Ledger 最大编号 TASK-0213，intake 分配 TASK-0214。

## 背景与用户可观察目标

记忆页已隐藏新建关系。列表为空时只说「还没有关系。」用户不知道下一步。
无关系且隐藏新建时，文案改为指向离线聊天。

## 范围内

- `showCreate=false` 的空列表文案改为「还没有关系。请到离线聊天新建。」
- 聊天页默认 `showCreate=true` 文案不变。
- 测试覆盖该文案；既有填入/预填/导航测试继续 PASS。

## 明确范围外

- 不接线 create/activate，不自动 load。
- 不改 chat/index/store/API。

## 输入和前置条件

- Base：`14a8f4efba69b77e7f4d629bd73a1e6a68980ae1`（TASK-0213 ACCEPTED）。

## API / 事件 / 数据契约

- 不修改 API/schema。

## 权限、RLS 和数据处理要求

- 不触后端与 RLS。

## 状态机和失败行为

- 不改变选择器 load 失败语义。

## 模型、Prompt、记忆和安全边界

- 不改变记忆确认语义。

## 验收标准

1. `showCreate=false` 且列表为空时，文案包含「离线聊天」。
2. 默认选择器仍提示「请先新建一条陪伴关系」。
3. 既有记忆页测试继续 PASS。

## 必跑检查

本轮只跑 vitest 与 `git diff --check`。Doctor / precheck / pre-closure 不跑，不得把未跑写成 PASS。

## 回滚或前向修复

- 仅 writeAllowlist，`maximumFixBatches: 1`。

## 停止条件

- 需要改 store/API/接线 create 立即停止。

# TASK-0213：H5 边界台进入记忆页时预填 relationship id

```yaml
taskId: TASK-0213
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
baseCommit: 5da7d936f7c80c603d15f198101d8894c24867e1
authorizationCommit: ""
contextFingerprint: cefc91a56aff6f312e950134129afe0ff7f7226a975f17d024e58109f7a39a55
contextLock: docs/tasks/context/TASK-0213.context-lock.yaml
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
  surfaceId: TASK_0213_H5_INDEX_CARRY_RELATIONSHIP_ID_TO_MEMORY
  policySurfaces: [AUTHORIZATION]
  distinctCrossRiskSurfaces: 1
  reviewerMinutesEstimate: 8
  terminalCheckMinutesEstimate: 8
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
  - frontend/src/pages/index/index.vue
  - frontend/src/pages/index/index.spec.ts
  - frontend/src/pages/memory/memory.vue
  - frontend/src/stores/relationship.ts
writeAllowlist:
  - docs/tasks/TASK-0213-h5-index-carry-relationship-id-to-memory.md
  - docs/tasks/context/TASK-0213.context-lock.yaml
  - docs/evidence/TASK-0213/**
  - docs/handoffs/TASK-0213.json
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - frontend/src/pages/index/index.vue
  - frontend/src/pages/index/index.spec.ts
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
  - frontend/src/pages/memory/**
  - frontend/src/pages/chat/**
sourcesOfTruth:
  - AGENTS.md
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - .harness/task-lifecycle.yaml
  - skills/task-intake/SKILL.md
  - frontend/src/pages/index/index.vue
requiredInvariants:
  - INV-HARNESS-001
  - INV-HARNESS-002
humanApprovals:
  - scope: task-intake
    approvedBy: repository-owner
    approvedAt: "2026-08-15"
    evidence: >-
      Owner Goal session 01a0034f-c7a4-7563-bb7a-01834924e3f7 书面授权日常工程、
      产品细节与合法 task-intake。本卡只在边界台进入记忆页时携带已有 currentRelationshipId，
      不激活、不创建、不自动 load，不改变确认语义。不编造 sourceThreadId。
independentReview: not-required
reviewers: []
requiredCommands:
  - pnpm --dir frontend exec vitest run src/pages/index/index.spec.ts
  - git diff --check
```

> 本卡为独立延续单卡。永久 ID 由机器派生：Ledger 最大编号 TASK-0212，intake 分配 TASK-0213。

## 背景与用户可观察目标

边界台「记忆管理」仍跳到不带 query 的记忆页。已有当前关系时，用户还要再选一次。
有当前关系时附带 query；无当前关系时仍跳裸路径。不自动 load。

## 范围内

- 仅改 `index.vue` / `index.spec.ts`。
- 可 `relStore.load` 以得到当前关系；禁止 `activate` / `create`。
- 有 `currentRelationshipId` 时跳 `/pages/memory/memory?relationshipId=`。
- 无当前关系时仍跳 `/pages/memory/memory`。

## 明确范围外

- 不改 memory/chat/store/API。
- 不自动刷新记忆。

## 输入和前置条件

- Base：`5da7d936f7c80c603d15f198101d8894c24867e1`（TASK-0212 ACCEPTED）。

## API / 事件 / 数据契约

- 不修改 API/schema。query 仅作页面预填。

## 权限、RLS 和数据处理要求

- 不触后端与 RLS。

## 状态机和失败行为

- load 失败则不带 query，走裸路径。

## 模型、Prompt、记忆和安全边界

- 不改变记忆确认语义。

## 验收标准

1. 有当前关系时，记忆入口带 `relationshipId` query。
2. 无当前关系时，不带 query。
3. 不调用 activate/create。
4. 既有边界台导航测试继续 PASS。

## 必跑检查

本轮按 Owner 要求只跑 vitest 与 `git diff --check`。Doctor / precheck / pre-closure 不跑，不得把未跑写成 PASS。

## 回滚或前向修复

- 仅 writeAllowlist，`maximumFixBatches: 1`。

## 停止条件

- 需要改 store/API/自动 load 立即停止。

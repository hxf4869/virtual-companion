# TASK-0203：H5 聊天在未创建 generation 的发送失败后恢复输入

```yaml
taskId: TASK-0203
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
baseCommit: 3fe1189bf9d80435bb5ada8c00cf2d73bdde82ad
authorizationCommit: ""
contextFingerprint: 4eebc8ccb257edcae5330b7839d1d76c0cd0bf56314591b7564a9553a69b4196
contextLock: docs/tasks/context/TASK-0203.context-lock.yaml
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
  surfaceId: TASK_0203_H5_CHAT_RESTORE_INPUT_ON_PRESTREAM_FAIL
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
  - docs/tasks/TASK-0203-h5-chat-restore-input-on-prestream-fail.md
  - docs/tasks/context/TASK-0203.context-lock.yaml
  - docs/evidence/TASK-0203/**
  - docs/handoffs/TASK-0203.json
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
      产品细节与合法 task-intake。本卡只在未创建 generation 的发送失败后恢复输入框，
      不改变取消、重试、失败或存在性不披露语义。不编造 sourceThreadId。
independentReview: not-required
reviewers: []
requiredCommands:
  - PATH=/Users/hxf/.zcode/venvs/vc-harness/bin:$PATH python scripts/harness/precheck.py --task TASK-0203
  - pnpm --dir frontend exec vitest run src/pages/chat/chat.spec.ts
  - git diff --check
```

> 本卡为独立延续单卡。永久 ID 由机器派生：Ledger 最大编号 TASK-0202，intake 分配 TASK-0203。

## 背景与用户可观察目标

聊天页 `onSend` 在调用 `store.send` 前清空输入。若 `sendGeneration` 返回 null（存在性不披露失败）或尚无 conversation，phase 变为 failed，用户原文丢失。
仅当失败且 `generationId` 仍为空（未创建 generation）时恢复原文。已创建 generation 后的流失败不得回填，以免重复发送。

## 范围内

- 仅改 `chat.vue` 与 `chat.spec.ts`。
- `onSend`：清空后 `await store.send`；若 `phase==="failed"` 且 `generationId===""`，把 trim 后的原文写回输入框。
- 测试：mock send 为 failed+空 generationId → 输入恢复；failed+非空 generationId → 输入保持空。
- 不改 store/API/取消。

## 明确范围外

- 不改 `stores/chat.ts`、sendGeneration、取消、重试。
- 不把失败改为成功，不伪造消息。

## 输入和前置条件

- Base：`3fe1189`（TASK-0202 ACCEPTED 终态）。
- 仓库 idle，`activeTask=null`。

## API / 事件 / 数据契约

- 不修改任何 API/事件/schema。

## 权限、RLS 和数据处理要求

- 不触后端与 RLS。

## 状态机和失败行为

- 仅恢复输入，不改变 store phase/outcome。
- 有 generationId 的失败不回填。

## 模型、Prompt、记忆和安全边界

- 不涉及。

## 验收标准

1. send 后 failed 且 generationId 为空时，输入框恢复为发送前 trim 文本。
2. send 后 failed 且 generationId 非空时，输入框保持空。
3. 既有空历史/关系选择/按钮禁用测试继续 PASS。
4. 冻结命令真实执行；不得把 FAIL/NOT_RUN 写成 PASS。

## 必跑检查

以 YAML `requiredCommands` 为准。

## 回滚或前向修复

- 仅 writeAllowlist，`maximumFixBatches: 1`。

## 停止条件

- 需要改 store/API/取消语义立即停止。
- 伪造 PASS 立即停止。

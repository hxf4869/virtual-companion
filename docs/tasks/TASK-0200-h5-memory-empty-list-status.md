# TASK-0200：H5 记忆页空列表状态提示

```yaml
taskId: TASK-0200
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
baseCommit: 2c2997677bafe2a19a3a9ff4acae3cde70edd7f8
authorizationCommit: ""
contextFingerprint: dd6136c7f58237f563fb9006b39b2899a0ff667e443b4d38aa03d6a32ff0ab90
contextLock: docs/tasks/context/TASK-0200.context-lock.yaml
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
  surfaceId: TASK_0200_H5_MEMORY_EMPTY_LIST_STATUS
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
  - frontend/src/stores/memory.ts
writeAllowlist:
  - docs/tasks/TASK-0200-h5-memory-empty-list-status.md
  - docs/tasks/context/TASK-0200.context-lock.yaml
  - docs/evidence/TASK-0200/**
  - docs/handoffs/TASK-0200.json
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
sourcesOfTruth:
  - AGENTS.md
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - .harness/task-lifecycle.yaml
  - skills/task-intake/SKILL.md
  - frontend/src/pages/memory/memory.vue
  - frontend/src/stores/memory.ts
requiredInvariants:
  - INV-HARNESS-001
  - INV-HARNESS-002
  - INV-MEM-001
  - INV-MEM-002
humanApprovals:
  - scope: task-intake
    approvedBy: repository-owner
    approvedAt: "2026-08-15"
    evidence: >-
      Owner Goal session 01a0034f-c7a4-7563-bb7a-01834924e3f7 书面授权日常工程、
      产品细节与合法 task-intake。本卡只补 H5 记忆页空列表可见状态，不改变记忆确认、
      取消、重试、安全或外部契约语义，不触及 service/**/memory/** 或 memory-change。
      不编造 sourceThreadId。
independentReview: not-required
reviewers: []
requiredCommands:
  - PATH=/Users/hxf/.zcode/venvs/vc-harness/bin:$PATH python scripts/harness/precheck.py --task TASK-0200
  - pnpm --dir frontend exec vitest run src/pages/memory/memory.spec.ts
  - git diff --check
```

> 本卡为独立延续单卡。永久 ID 由机器派生：Ledger 最大编号 TASK-0199，intake 分配 TASK-0200。

## 背景与用户可观察目标

记忆页在成功加载后，若待确认候选或 Canonical 记忆为空，只渲染带 (0) 的标题，没有可感知空状态。
用户应看到：加载前不声称「没有记忆」；成功加载后空列表给出简短状态提示；有条目时不显示空状态。
候选不得被描述为已保存事实。

## 范围内

- 仅改 `memory.vue` 与 `memory.spec.ts`。
- 页面本地记录是否已成功 load；成功 load 后 `pendingCount===0` 渲染
  `data-testid="empty-pending"`；`canonicalCount===0` 渲染
  `data-testid="empty-canonical"`（均 `role="status"`）。
- 文案区分候选与 Canonical；不把候选写成已保存事实。
- 保留 P3-03：空 evidence 不渲染容器；编辑仅在确认保存后退出。

## 明确范围外

- 不改 `stores/memory.ts`、memory API、service/**/memory/**。
- 不改确认/拒绝/编辑/删除语义，不改 RLS。
- 不实现取消/重试/安全流水线。

## 输入和前置条件

- Base：`2c29976`（TASK-0199 ACCEPTED 终态）。
- 仓库 idle，`activeTask=null`。

## API / 事件 / 数据契约

- 不修改任何 API/事件/schema。

## 权限、RLS 和数据处理要求

- 不触后端与 RLS。

## 状态机和失败行为

- 加载失败不把空列表宣称为「已核对无记忆」。
- 有条目的一侧不显示该侧空状态。

## 模型、Prompt、记忆和安全边界

- 展示层不把 PENDING 候选渲染为 Canonical。

## 验收标准

1. 未成功 load 前，页面不存在 empty-pending / empty-canonical。
2. 成功 load 且 pending 为空时存在 empty-pending，文案不含「已保存」。
3. 成功 load 且 canonical 为空时存在 empty-canonical。
4. 对应列表非空时该侧空状态不存在。
5. 既有 P3-03 evidence / 编辑保存测试继续 PASS。
6. 冻结命令真实执行；不得把 FAIL/NOT_RUN 写成 PASS。

## 必跑检查

以 YAML `requiredCommands` 为准。

## 回滚或前向修复

- 仅 writeAllowlist，`maximumFixBatches: 1`。

## 停止条件

- 需要改 store/API/记忆语义立即停止。
- 伪造 PASS 立即停止。

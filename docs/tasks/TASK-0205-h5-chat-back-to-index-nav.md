# TASK-0205：H5 聊天页增加返回边界台入口

```yaml
taskId: TASK-0205
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
baseCommit: 1a2278b522d3f8b65f347d46ff030497f22b168a
authorizationCommit: f347d35358abd60fd316830d01cd89f2c6f04d7d
contextFingerprint: 77a0aa12c54a888028d9d49840207b9fbe6ec07406d2a00175f8de6c74ac2fc6
contextLock: docs/tasks/context/TASK-0205.context-lock.yaml
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
  surfaceId: TASK_0205_H5_CHAT_BACK_TO_INDEX_NAV
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
  - docs/tasks/TASK-0205-h5-chat-back-to-index-nav.md
  - docs/tasks/context/TASK-0205.context-lock.yaml
  - docs/evidence/TASK-0205/**
  - docs/handoffs/TASK-0205.json
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
      产品细节与合法 task-intake。本卡只在聊天页增加返回边界台的展示入口，
      不改变发送、取消、失败或存在性不披露语义。不编造 sourceThreadId。
independentReview: not-required
reviewers: []
requiredCommands:
  - PATH=/Users/hxf/.zcode/venvs/vc-harness/bin:$PATH python scripts/harness/precheck.py --task TASK-0205
  - pnpm --dir frontend exec vitest run src/pages/chat/chat.spec.ts
  - git diff --check
```

> 本卡为独立延续单卡。永久 ID 由机器派生：Ledger 最大编号 TASK-0204，intake 分配 TASK-0205。

## 背景与用户可观察目标

TASK-0204 已让边界台能进入聊天页，但聊天页没有返回入口。用户只能靠浏览器后退或改 URL。
本卡只补展示导航，不改变发送、取消或失败语义。

## 范围内

- 仅改 `chat.vue` 与 `chat.spec.ts`。
- 页头增加 `data-testid=nav-index`「返回边界台」。
- 点击走 `uni.navigateTo`（若存在），否则回退 `location`；失败吞掉，不打断聊天。
- 入口在初始化失败或关系选择态也可见。
- 测试：入口可见；点击导航到 `/pages/index/index`；既有空历史/发送失败回填测试继续 PASS。
- 不改 store/API/取消。

## 明确范围外

- 不改 `stores/chat.ts`、取消、重试、失败语义。
- 不在记忆页加返回（留给后续卡）。
- 不改鉴权。

## 输入和前置条件

- Base：`1a2278b`（TASK-0204 ACCEPTED 终态）。
- 仓库 idle，`activeTask=null`。

## API / 事件 / 数据契约

- 不修改任何 API/事件/schema。

## 权限、RLS 和数据处理要求

- 不触后端与 RLS。

## 状态机和失败行为

- 导航失败不影响 `send` / `cancel` / phase。
- 不改变 generation 生命周期。

## 模型、Prompt、记忆和安全边界

- 不涉及。

## 验收标准

1. 聊天页渲染 `data-testid=nav-index`。
2. 点击导航到 `/pages/index/index`。
3. 既有空历史、关系选择、发送失败回填测试继续 PASS。
4. 冻结命令真实执行；不得把 FAIL/NOT_RUN 写成 PASS。

## 必跑检查

以 YAML `requiredCommands` 为准。

## 回滚或前向修复

- 仅 writeAllowlist，`maximumFixBatches: 1`。

## 停止条件

- 需要改 store/API/取消语义立即停止。
- 伪造 PASS 立即停止。

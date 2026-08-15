# TASK-0206：H5 记忆页增加返回边界台入口

```yaml
taskId: TASK-0206
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
baseCommit: beae47943e06362cf42ade8b8eee88e929e53bfe
authorizationCommit: b9560e90bb0b454db3c593afbf71bb99f466a0b2
contextFingerprint: cab6e8df2823ae56d1f9dfc130a2e814e8848c2cb50c786a44c75197325a8d0d
contextLock: docs/tasks/context/TASK-0206.context-lock.yaml
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
  surfaceId: TASK_0206_H5_MEMORY_BACK_TO_INDEX_NAV
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
  - docs/tasks/TASK-0206-h5-memory-back-to-index-nav.md
  - docs/tasks/context/TASK-0206.context-lock.yaml
  - docs/evidence/TASK-0206/**
  - docs/handoffs/TASK-0206.json
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
humanApprovals:
  - scope: task-intake
    approvedBy: repository-owner
    approvedAt: "2026-08-15"
    evidence: >-
      Owner Goal session 01a0034f-c7a4-7563-bb7a-01834924e3f7 书面授权日常工程、
      产品细节与合法 task-intake。本卡只在记忆页增加返回边界台的展示入口，
      不改变确认/拒绝/编辑/删除或失败关闭语义。不编造 sourceThreadId。
independentReview: not-required
reviewers: []
requiredCommands:
  - PATH=/Users/hxf/.zcode/venvs/vc-harness/bin:$PATH python scripts/harness/precheck.py --task TASK-0206
  - pnpm --dir frontend exec vitest run src/pages/memory/memory.spec.ts
  - git diff --check
```

> 本卡为独立延续单卡。永久 ID 由机器派生：Ledger 最大编号 TASK-0205，intake 分配 TASK-0206。

## 背景与用户可观察目标

TASK-0204 已让边界台能进入记忆页，TASK-0205 已给聊天页补返回入口，记忆页仍没有返回入口。
用户只能靠浏览器后退或改 URL。本卡只补展示导航，不改变记忆确认或失败语义。

## 范围内

- 仅改 `memory.vue` 与 `memory.spec.ts`。
- 工具栏在「刷新记忆」之后增加 `data-testid=nav-index`「返回边界台」，避免打乱既有 `button[0]` 刷新测试。
- 点击走 `uni.navigateTo`（若存在），否则回退 `location`；失败吞掉，不打断记忆操作。
- 入口在未填写 relationship id 时也可见。
- 测试：入口可见；点击导航到 `/pages/index/index`，不调用 load/confirm；既有空列表测试继续 PASS。
- 不改 store/API。

## 明确范围外

- 不改 `stores/memory.ts`、确认/拒绝/编辑/删除语义。
- 不改鉴权、取消、重试、安全流水线。

## 输入和前置条件

- Base：`beae479`（TASK-0205 ACCEPTED 终态）。
- 仓库 idle，`activeTask=null`。

## API / 事件 / 数据契约

- 不修改任何 API/事件/schema。

## 权限、RLS 和数据处理要求

- 不触后端与 RLS。

## 状态机和失败行为

- 导航失败不影响 load/confirm/reject/update/delete。
- 不改变记忆候选与 canonical 状态。

## 模型、Prompt、记忆和安全边界

- 不改变记忆确认语义。

## 验收标准

1. 记忆页渲染 `data-testid=nav-index`。
2. 点击导航到 `/pages/index/index`。
3. 既有空列表/编辑/失败 load 测试继续 PASS。
4. 冻结命令真实执行；不得把 FAIL/NOT_RUN 写成 PASS。

## 必跑检查

以 YAML `requiredCommands` 为准。

## 回滚或前向修复

- 仅 writeAllowlist，`maximumFixBatches: 1`。

## 停止条件

- 需要改 store/API/记忆确认语义立即停止。
- 伪造 PASS 立即停止。

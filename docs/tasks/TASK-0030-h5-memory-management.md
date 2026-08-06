# TASK-0030：H5 记忆管理界面

```yaml
taskId: TASK-0030
state: READY
owner: repository-owner
riskClass: C4
requiredSkills:
  - task-delivery-flow
  - task-intake
requiredSkillVersions:
  task-delivery-flow: "1.3.6"
  task-intake: "1.2.6"
targetSkillVersions: {}
planningBacklog: .harness/task-backlog.yaml
planningContractHash: 4616cf253afce55f0e9198f3e2c2a7bf7b7c7ebabe5849eee92c9c8341c7a3bb
planningContractHashAlgorithm: SHA256_CANONICAL_JSON_V1
baseCommit: f4fc986e5848a6ba863fa1e3a8c9e91b0ba71fba
authorizationCommit: ""
contextFingerprint: bfb88a10d5002de0d061b8f64a899e58a13c063703aab72006a45841bb64b87a
contextLock: docs/tasks/context/TASK-0030.context-lock.yaml
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
  riskClass: C4
  surfaceId: TASK_0030_H5_MEMORY_MANAGEMENT
  policySurfaces: [AUTHORIZATION]
  distinctCrossRiskSurfaces: 1
  reviewerMinutesEstimate: 15
  terminalCheckMinutesEstimate: 15
  estimatedWallMinutes: 75
  thresholdsTriggered: []
  splitRequired: false
  ownerIndivisibleAuthorization: false
validationPlan: {frozenBefore: READY, policySource: .harness/ci-execution-policy.yaml, selectedChannel: LOCAL_EXACT_TREE_FALLBACK, profile: precheck}
readAllowlist:
  - .gitattributes
  - AGENTS.md
  - CLAUDE.md
  - .harness/ci-execution-policy.yaml
  - .harness/commands.yaml
  - .harness/invariants.yaml
  - .harness/project-state.yaml
  - .harness/protected-paths.yaml
  - .harness/skills.yaml
  - .harness/sources-of-truth.yaml
  - .harness/task-backlog.yaml
  - .harness/task-delivery-policy.yaml
  - .harness/task-ledger.yaml
  - .harness/task-lifecycle.yaml
  - .harness/tools.lock.yaml
  - docs/tasks/TASK-0030-h5-memory-management.md
  - docs/tasks/task-card-template.md
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
  - requirements-harness.txt
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
  - docs/decisions/0002-persistence-and-contract-first-direction.md
  - specs/catalog/error-codes.yaml
  - specs/catalog/memory-candidate-statuses.yaml
  - specs/catalog/memory-scopes.yaml
  - specs/catalog/product-scope.yaml
  - specs/catalog/risk-levels.yaml
  - specs/openapi/virtual-companion.yaml
  - frontend/package.json
  - frontend/tsconfig.json
  - frontend/vitest.config.ts
  - frontend/vite.config.ts
  - frontend/src/pages.json
  - frontend/src/manifest.json
  - frontend/src/main.ts
  - frontend/src/App.vue
  - frontend/src/env.d.ts
  - frontend/src/shims-uni.d.ts
  - frontend/src/api/realtime.ts
  - frontend/src/api/realtime.spec.ts
  - frontend/src/stores/chat.ts
  - frontend/src/stores/chat.spec.ts
  - frontend/src/pages/chat/chat.vue
  - frontend/src/domain/stream-reducer.ts
  - scripts/harness/doctor.py
  - scripts/harness/precheck.py
  - scripts/harness/harness_common.py
  - scripts/harness/tests/test_harness.py
  - docs/evidence/TASK-0026/evidence-pack.json
  - docs/evidence/TASK-0028/evidence-pack.json
writeAllowlist:
  - docs/tasks/TASK-0030-h5-memory-management.md
  - docs/tasks/context/TASK-0030.context-lock.yaml
  - docs/evidence/TASK-0030/**
  - docs/handoffs/TASK-0030.json
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - frontend/src/api/memory.ts
  - frontend/src/api/memory.spec.ts
  - frontend/src/stores/memory.ts
  - frontend/src/stores/memory.spec.ts
  - frontend/src/pages/memory/memory.vue
  - frontend/src/pages.json
forbiddenPaths:
  - .gitattributes
  - AGENTS.md
  - CLAUDE.md
  - .github/**
  - ci/**
  - .harness/agent-entrypoints.yaml
  - .harness/ci-execution-policy.yaml
  - .harness/commands.yaml
  - .harness/invariants.yaml
  - .harness/license-policy.yaml
  - .harness/paid-feature-denylist.yaml
  - .harness/phase-scope.yaml
  - .harness/protected-paths.yaml
  - .harness/skills.yaml
  - .harness/sources-of-truth.yaml
  - .harness/task-backlog.yaml
  - .harness/task-delivery-policy.yaml
  - .harness/task-lifecycle.yaml
  - .harness/tools.lock.yaml
  - docs/schemas/**
  - docs/tasks/task-card-template.md
  - requirements-harness.txt
  - scripts/harness/**
  - scripts/dev/**
  - skills/**
  - specs/catalog/**
  - specs/contracts/**
  - specs/generated/**
  - specs/openapi/**
  - service/**
  - deploy/**
  - ops/**
  - docs/source/**
  - docs/decisions/**
  - infra/**
  - frontend/src/api/realtime.ts
  - frontend/src/api/realtime.spec.ts
  - frontend/src/api/baseline.ts
  - frontend/src/api/baseline.spec.ts
  - frontend/src/domain/**
  - frontend/src/stores/chat.ts
  - frontend/src/stores/chat.spec.ts
  - frontend/src/stores/baseline.ts
  - frontend/src/stores/baseline.spec.ts
  - frontend/src/pages/chat/chat.vue
  - frontend/src/pages/index/index.vue
  - frontend/src/App.vue
  - frontend/src/main.ts
  - frontend/src/manifest.json
  - frontend/src/env.d.ts
  - frontend/src/shims-uni.d.ts
  - frontend/package.json
  - frontend/tsconfig.json
  - frontend/vitest.config.ts
  - frontend/vite.config.ts
sourcesOfTruth:
  - AGENTS.md
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - .harness/task-backlog.yaml
  - .harness/task-lifecycle.yaml
  - .harness/task-delivery-policy.yaml
  - .harness/ci-execution-policy.yaml
  - .harness/sources-of-truth.yaml
  - .harness/invariants.yaml
  - .harness/protected-paths.yaml
  - .harness/skills.yaml
  - .harness/commands.yaml
  - skills/task-delivery-flow/SKILL.md
  - docs/decisions/0002-persistence-and-contract-first-direction.md
  - scripts/harness/doctor.py
  - scripts/harness/tests/test_harness.py
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
requiredInvariants:
  - INV-MEM-001
  - INV-MEM-002
  - INV-TENANT-001
  - INV-RT-001
  - INV-HARNESS-002
  - INV-HARNESS-003
  - INV-HARNESS-005
  - INV-HARNESS-007
  - INV-HARNESS-009
requiredCommands:
  - python scripts/harness/precheck.py --task TASK-0030
  - bash -c "cd frontend && npx vitest run"
  - python -m unittest discover -s scripts/harness/tests -p test_*.py
  - git diff --check
reviewers: []
independentReview: required
humanApprovals:
  - scope: task-authorization
    approvedBy: repository-owner
    approvedAt: "2026-08-07"
    sourceThreadId: long-line-execution-product-conversation
    evidence: >-
      长线执行 Owner 授权 TASK-0030 H5 记忆管理界面（frontend/** 未保护路径，riskClass C4，policySurfaces
      AUTHORIZATION，无 protected skill surface 故无需 database-migration/safety-change 等 skill-humanApproval，
      仅需 readyRequiresOwnerApproval 的 task-authorization 批准）。前端遵循既有 api/domain/stores + vitest(node env)
      范式（TASK-0026）：新建 api/memory.ts（transport 注入式，调用 TASK-0028 的 list/get/confirm/reject/update/
      delete/list-evidence 端点；存在性隐藏——not-found 映射 null/empty/false，从不抛错披露存在性，INV-TENANT-001）、
      stores/memory.ts（Pinia setup syntax：pending candidates（PENDING_CONFIRMATION）与 canonical memory（ACCEPTED）
      分离——未确认候选永不混入 canonical、绝不呈现为已保存事实；evidence 按 memoryId 缓存；确认成功才把候选迁入
      canonical；删除失败保留条目并记错误，不乐观移除、不伪装成功；来源/状态/删除结果只反映 API 响应真源）、
      pages/memory/memory.vue（H5 渲染 pending 区+canonical 区，确认/拒绝/编辑/删除按钮+来源展示，失败显示错误态）、
      pages.json 新增 pages/memory/memory 路由。vitest spec（api/memory.spec.ts + stores/memory.spec.ts，transport/store
      mock 覆盖关键交互与越权/失败状态：确认迁入、删除失败不伪装、existence-hidden、pending 不混 canonical、来源状态随 API）。
      不触碰 specs/openapi、specs/catalog、specs/generated、specs/contracts、service、infra、其他 frontend 模块
      （realtime/chat/baseline/domain）；无 WebSocket/media/localStorage token，沿用 TASK-0026 的 FAKE/loopback 边界。
      complexityGate 无 split（仅 AUTHORIZATION 面，distinctCrossRiskSurfaces=1）。满足接受条件——关键交互与越权/失败
      状态可自动复测、来源/状态/删除结果与 API 真源一致。
```

> 规划正文仅为非规范的人类可读渲染；唯一机器真源是 `.harness/task-backlog.yaml` 中本 Task ID 的静态合同，并由 `planningContractHash` 完整绑定。

## 目标

提供 H5 记忆候选确认、来源查看、编辑和删除界面：消费 TASK-0028 的 memory OpenAPI 端点，在 H5 端展示 Pending candidate 与 Canonical Memory（来源 Evidence），并支持确认、编辑、删除与失败恢复。UI 永不把未确认候选呈现为已保存事实，删除失败绝不乐观伪装成功，来源/状态/删除结果与 API 真源一致。

## 范围内

- `frontend/src/api/memory.ts`：transport 注入式 memory API 客户端（镜像 realtime.ts）。调用 TASK-0028 的 list/get/confirm/reject/update/delete/list-evidence 端点；存在性隐藏（not-found → null/empty/false，从不抛错披露存在性）；返回类型化 Memory/MemoryEvidence。
- `frontend/src/stores/memory.ts`：Pinia store（镜像 chat.ts setup syntax）。state 分离 pending candidates（status=PENDING_CONFIRMATION）与 canonical memory（ACCEPTED）——未确认永不混入 canonical；evidence 按 memoryId 缓存。actions：load/confirm/reject/update/remove/loadEvidence，transport 注入。删除失败时保留条目并记录错误（不乐观移除、不伪装成功）；确认成功才把候选迁入 canonical。
- `frontend/src/pages/memory/memory.vue`：H5 页面，渲染 pending 区（候选+来源，确认/拒绝按钮）与 canonical 区（编辑/删除按钮+来源）；删除/确认失败显示错误态，不伪装成功。
- `frontend/src/pages.json`：新增 pages/memory/memory 路由。
- vitest spec（node env，transport/store 注入式 mock）：api/memory.spec.ts（existence-hidden 映射、类型化结果）+ stores/memory.spec.ts（pending/canonical 分离永不混、删除失败不移除不伪装、确认成功才迁入、来源/状态随 API）。

## 明确禁止

- 账号共享记忆（ACCOUNT_SHARED）或自动确认（auto-confirm）——前端不假定自动确认，候选必须用户显式确认；
- UI 把未确认候选展示为已保存事实（pending 必须与 canonical 分离呈现）；
- 删除/确认失败时乐观伪装成功（必须保留原状态并显示错误）；
- 召回/展示绕过 API 真源（来源、状态、删除结果必须来自 API 响应，不得本地臆造）；
- 改动 specs/openapi、specs/catalog、service、infra/db、其他 frontend 模块（realtime/chat/baseline/domain）；
- WebSocket/media/localStorage token 或真实外发（沿用 TASK-0026 的 FAKE/loopback 边界）。

## 依赖与决策闸门

- 依赖：TASK-0026、TASK-0029（均 ACCEPTED）；
- 无独立硬决策闸门。

## 验收

- 关键交互（确认/编辑/删除）和越权/失败状态可自动复测（stores/api spec：确认成功迁入 canonical、删除失败不移除不伪装、not-found/forbidden 经 existence-hidden 映射不披露存在性）；
- 来源、状态和删除结果与 API 真源一致（store 只反映 API 响应的 status/sources；pending 永不呈现为 canonical 事实）。

## 晋级规则

TASK-0026、TASK-0029 ACCEPTED、仓库空闲且 Backlog 顺序允许后，才创建唯一 DRAFT。

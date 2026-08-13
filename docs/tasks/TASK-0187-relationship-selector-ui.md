# TASK-0187：Relationship 选择器 UI 纵切（C2 task-intake）

```yaml
taskId: TASK-0187
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
baseCommit: 5259515a79af140dac761de1ae2f97d52e1f9e59
authorizationCommit: "plan-approved-2026-08-13-relationship-selector-ui"
contextFingerprint: 2e83fbdf10d9fa289a312e227fc2390e370455f3d2549f95c5871e075e1ef209
contextFingerprintAlgorithm: SHA256_ORDINAL_SORTED_PATH_EQUALS_HASH_LF_V1
contextLock: docs/tasks/context/TASK-0187.context-lock.yaml
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
  intakeActivation: {anchor: DRAFT_COMMIT, terminal: READY_DOCTOR_TERMINAL, targetWallMinutes: 60, hardFuseWallMinutes: 90, timeoutStatus: TIMEOUT, closureOnlyOverrunAllowed: true}
  candidateExecution: {anchor: READY_DOCTOR_PASS_AND_IN_PROGRESS_COMMIT, notStartedOutcome: NOT_STARTED, notStartedEligibility: {readyDoctorNonPassRequired: true, readyDoctorPassForbidden: true, inProgressCommitForbidden: true, candidateFreezeForbidden: true}, candidateDeadlineMinutes: 45, targetWallMinutes: 60, hardFuseWallMinutes: 90, timeoutStatus: TIMEOUT, closureOnlyOverrunAllowed: true}
  reviewer: {maximumMinutes: 15, timeoutStatus: TIMEOUT, missingTerminalStatus: UNKNOWN}
complexityAssessment:
  policySource: .harness/task-delivery-policy.yaml
  evaluatedBefore: READY
  riskClass: C2
  surfaceId: TASK_0187_RELATIONSHIP_SELECTOR_UI
  policySurfaces: [FRONTEND]
  distinctCrossRiskSurfaces: 1
  reviewerMinutesEstimate: 10
  terminalCheckMinutesEstimate: 10
  estimatedWallMinutes: 50
  thresholdsTriggered: []
  splitRequired: false
  ownerIndivisibleAuthorization: false
validationPlan: {frozenBefore: READY, profile: precheck}
requiredCommands:
  - pnpm --dir frontend test:run
  - pnpm --dir frontend type-check
  - git diff --check
readAllowlist:
  - AGENTS.md
  - CLAUDE.md
  - .harness/agent-entrypoints.yaml
  - .harness/ci-execution-policy.yaml
  - .harness/commands.yaml
  - .harness/invariants.yaml
  - .harness/license-inventory.yaml
  - .harness/license-policy.yaml
  - .harness/paid-feature-denylist.yaml
  - .harness/phase-scope.yaml
  - .harness/project-state.yaml
  - .harness/protected-paths.yaml
  - .harness/skills.yaml
  - .harness/sources-of-truth.yaml
  - .harness/task-backlog.yaml
  - .harness/task-delivery-policy.yaml
  - .harness/task-ledger.yaml
  - .harness/task-lifecycle.yaml
  - .harness/tools.lock.yaml
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
  - docs/tasks/task-card-template.md
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
  - docs/tasks/TASK-0186-h5-chat-send-flow-history-api.md
  - docs/tasks/context/TASK-0186.context-lock.yaml
  - docs/evidence/TASK-0186/evidence-pack.json
  - docs/evidence/TASK-0186/review-r1.md
  - docs/handoffs/TASK-0186.json
  - docs/tasks/TASK-0024-relationship-active-companion.md
  - specs/openapi/virtual-companion.yaml
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/relationship/web/RelationshipController.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/RelationshipService.java
  - frontend/package.json
  - frontend/src/api/transport.ts
  - frontend/src/api/memory.ts
  - frontend/src/api/chat.ts
  - frontend/src/stores/chat.ts
  - frontend/src/stores/chat.spec.ts
  - frontend/src/stores/auth.ts
  - frontend/src/pages/memory/memory.vue
  - frontend/src/pages/chat/chat.vue
  - frontend/src/pages/chat/chat.spec.ts
writeAllowlist:
  - frontend/src/api/relationship.ts
  - frontend/src/api/relationship.spec.ts
  - frontend/src/stores/relationship.ts
  - frontend/src/stores/relationship.spec.ts
  - frontend/src/components/RelationshipSelector.vue
  - frontend/src/components/RelationshipSelector.spec.ts
  - frontend/src/pages/chat/chat.vue
  - frontend/src/pages/chat/chat.spec.ts
  - docs/tasks/TASK-0187-relationship-selector-ui.md
  - docs/tasks/context/TASK-0187.context-lock.yaml
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - docs/evidence/TASK-0187/**
  - docs/handoffs/TASK-0187.json
forbiddenPaths:
  - docs/tasks/TASK-017[0-9]-*
  - docs/tasks/context/TASK-017[0-9].context-lock.yaml
  - docs/evidence/TASK-017[0-9]/**
  - docs/handoffs/TASK-017[0-9].json
  - docs/tasks/TASK-018[0-6]-*
  - docs/tasks/context/TASK-018[0-6].context-lock.yaml
  - docs/evidence/TASK-018[0-6]/**
  - docs/handoffs/TASK-018[0-6].json
  - .gitattributes
  - AGENTS.md
  - CLAUDE.md
  - README.md
  - ci/**
  - requirements-harness.txt
  - skills/**
  - docs/schemas/**
  - docs/source/**
  - docs/decisions/**
  - docs/planning/**
  - docs/architecture/**
  - docs/engineering/**
  - docs/tasks/task-card-template.md
  - .harness/agent-entrypoints.yaml
  - .harness/ci-execution-policy.yaml
  - .harness/commands.yaml
  - .harness/invariants.yaml
  - .harness/license-inventory.yaml
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
  - scripts/**
  - .github/workflows/**
  - specs/catalog/**
  - specs/generated/**
  - specs/contracts/**
  - specs/openapi/**
  - service/**
  - "**/db/migration/**"
  - infra/**
  - .mvn/**
  - mvnw
  - mvnw.cmd
  - pom.xml
  - frontend/src/api/auth.ts
  - frontend/src/api/auth.spec.ts
  - frontend/src/api/authed-fetch.ts
  - frontend/src/api/baseline.ts
  - frontend/src/api/baseline.spec.ts
  - frontend/src/api/chat.ts
  - frontend/src/api/chat.spec.ts
  - frontend/src/api/memory.ts
  - frontend/src/api/memory.spec.ts
  - frontend/src/api/realtime.ts
  - frontend/src/api/realtime.spec.ts
  - frontend/src/api/realtime-envelope.ts
  - frontend/src/api/realtime-envelope.spec.ts
  - frontend/src/api/realtime-transport.ts
  - frontend/src/api/realtime-transport.spec.ts
  - frontend/src/api/sse-parser.ts
  - frontend/src/api/sse-parser.spec.ts
  - frontend/src/api/transport.ts
  - frontend/src/api/transport.spec.ts
  - frontend/src/domain/**
  - frontend/src/stores/auth.ts
  - frontend/src/stores/auth.spec.ts
  - frontend/src/stores/baseline.ts
  - frontend/src/stores/baseline.spec.ts
  - frontend/src/stores/chat.ts
  - frontend/src/stores/chat.spec.ts
  - frontend/src/stores/memory.ts
  - frontend/src/stores/memory.spec.ts
  - frontend/src/pages/index/**
  - frontend/src/pages/login/**
  - frontend/src/pages/memory/**
  - frontend/src/App.vue
  - frontend/src/main.ts
  - frontend/src/env.d.ts
  - frontend/src/shims-uni.d.ts
  - frontend/src/manifest.json
  - frontend/src/pages.json
  - frontend/src/uni.scss
  - frontend/src/static/**
  - frontend/.gitignore
  - frontend/index.html
  - frontend/package.json
  - frontend/pnpm-lock.yaml
  - frontend/pnpm-workspace.yaml
  - frontend/tsconfig.json
  - frontend/vite.config.ts
  - frontend/vitest.config.ts
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
  - skills/task-intake/SKILL.md
  - specs/openapi/virtual-companion.yaml
  - docs/handoffs/TASK-0186.json
requiredInvariants:
  - INV-TENANT-001
  - INV-HARNESS-001
  - INV-HARNESS-002
  - INV-HARNESS-003
  - INV-HARNESS-005
  - INV-HARNESS-007
  - INV-HARNESS-009
humanApprovals:
  - scope: task-assignment
    approvedBy: repository-owner
    approvedAt: "2026-08-13"
    sourceThreadId: 0187-relationship-selector-ui-2026-08-13
    evidence: >-
      Owner 2026-08-13 长线授权继续 generation/companion 纵切（一次一张新卡，idle DRAFT
      治理例外）。TASK-0186 闭环后 nextAction 指向 relationship 选择器 UI 方向（0186 在 chat.vue
      留下 DEMO_RELATIONSHIP_ID="1" 硬编码作为真实来源待办）。经代码调研确认后端 RelationshipController
      已完整（TASK-0024/0178：POST /api/v1/relationships create + GET list + GET {id} + POST {id}
      activate + POST {id}/deactivate，V* create/list/get/activate/deactivate SD 函数，
      activeCompanionLimit=1），OpenAPI relationship 端点 + Relationship/RelationshipCreateRequest
      schema 完整；但 frontend 完全缺失 relationship 消费层：无 relationship API client、无 store、
      chat.vue 硬编码 DEMO_RELATIONSHIP_ID="1"。本卡建 frontend relationship API client（照 chat.ts
      模式，存在性隐藏）+ relationship store + RelationshipSelector 选择器组件 + chat.vue 移除硬编码
      接 store。不改 specs/openapi（relationship 端点已存在）、不改 specs/contracts/catalog/generated
      （C2 边界），不改 service/** 或 DB migration（后端已完整）。
independentReview: not-required
```

> 本卡不在 Backlog 中，不写 `planningBacklog` 或 `planningContractHash`。它是 generation/companion
> 纵切的 relationship 选择器 UI 消费卡，承接 TASK-0186 闭环后的 nextAction，沿用
> `owner-authorization://longline-2026-08-09` 长线授权（hash `cc0f91c1...`），与 TASK-0173..0186
> 同属 idle DRAFT 治理例外，不进 backlog。**不触碰任何 protected path**：frontend/** 非 protected；
> specs/openapi/** 非 protected 但本卡不改（relationship 端点已存在）；service/** 非 protected 但
> 本卡不改（后端已完整）→ requiredSkills task-delivery-flow+task-intake，independentReview not-required。

## 背景与用户可观察目标

TASK-0178/0024 交付了完整的后端 Relationship API（RelationshipController 5 端点 +
create/list/get/activate/deactivate SD 函数，activeCompanionLimit=1），OpenAPI relationship 端点与
schema 完整。TASK-0186 把 chat.vue 接到了真实发送流程，但 `chat.vue` 仍硬编码
`DEMO_RELATIONSHIP_ID = "1"`——relationshipId 没有真实来源，用户无法选择或创建关系。

本卡交付**relationship 选择器消费纵切**：

1. **`relationship.ts`** — typed relationship API client（照 `chat.ts` 模式）：
   `createRelationship` / `listRelationships` / `getRelationship` / `activateRelationship` /
   `deactivateRelationship`，`RelationshipHttpError` 类型化错误，403/404→null/空数组存在性隐藏，
   `asId` 接受 string|number 归一为 string。
2. **`stores/relationship.ts`** — Pinia relationship store：`relationships` / `currentRelationshipId` /
   `status` / `error` state，`load` / `create` / `activate` / `deactivate` actions（transport 注入），
   `current` getter。
3. **`RelationshipSelector.vue`** — 纯展示选择器组件：下拉激活 + personaRef 创建 + a11y 状态。
4. **`chat.vue`** — 移除 `DEMO_RELATIONSHIP_ID`，onMounted load relationships 选 active 关系发起对话，
   无关系时显示选择器。

用户可观察结果：用户打开聊天页 → 看到自己的关系列表 → 选择/创建关系 → 创建对话 → 进入聊天。
DEMO_RELATIONSHIP_ID 硬编码彻底移除。

## 范围内

1. **`frontend/src/api/relationship.ts`**（新）：`RelationshipTransport` 接口（结构兼容
   `AuthTransport`/`ChatTransport`）；`Relationship` 类型；`RelationshipHttpError`；5 个 API 函数；
   403/404→null/空，401/5xx→throw；`asId` string|number 归一。
2. **`frontend/src/api/relationship.spec.ts`**（新，19 项）：5 函数 wire（method+path+body）+ response
   解析 + 存在性隐藏 + 401/5xx throw + listRelationships malformed 跳过 + asId 归一。
3. **`frontend/src/stores/relationship.ts`**（新）：relationships/currentRelationshipId/status/error
   state；current getter；load/create/activate/deactivate/reset（transport 注入）；catch→error 不伪成功。
4. **`frontend/src/stores/relationship.spec.ts`**（新，11 项）：load 选 active / load 空 / load error /
   create / activate / deactivate / reset。
5. **`frontend/src/components/RelationshipSelector.vue`**（新，新建 components 目录）：props
   relationships/currentId/status/busy；emits activate/create；原生 select + personaRef input + create
   button；error role=alert + loading role=status aria-live=polite。
6. **`frontend/src/components/RelationshipSelector.spec.ts`**（新，7 项）：options 渲染 / activate emit /
   create trim+disabled / busy disabled / error role / loading aria-live。
7. **`frontend/src/pages/chat/chat.vue`**（改）：移除 DEMO_RELATIONSHIP_ID；引入 relationship store +
   RelationshipSelector；onMounted load→选 active→startConversation；无关系显示选择器；复用同一
   createAuthenticatedTransport 喂两个 store。
8. **`frontend/src/pages/chat/chat.spec.ts`**（改，6 项）：stubFetch 增 relationships 分支；5 项原断言
   改异步 flushPromises；新增无关系时显示选择器。
9. 终态治理闭环：frontend vitest 234 项 + type-check exit 0 + git diff --check exit 0 + 结构化
   review-r1 + Evidence/Handoff + 单父提交/push。

## 明确范围外

- **改 OpenAPI**（relationship 端点 + Relationship/RelationshipCreateRequest schema 已完整，无需改）。
- **改 `service/**` 或 DB migration**（后端 RelationshipController + SD 函数已完整）。
- **改 specs/contracts/catalog/generated**（C3 边界）。
- **改 memory.vue relationshipId 自由文本输入**（独立卡统一到 relationship store）。
- **ID hashid 编码**（候选方向，独立卡）。
- **WebSocket、语音、图片、主动消息、多角色**（Alpha forbidden capabilities）。
- **doctor / canonical precheck / 完整 unittest discover**（Owner 2026-08-13 策略：跳过长检查只完成任务；
  Evidence 如实标注 deferred，不标 PASS）。

## 输入和前置条件

- Base `5259515` = TASK-0186 ACCEPTED terminal（已 push、HEAD==origin/main、0/0、clean；
  nextAction 三处 sha256 `f5d8c931...` 一致）。
- context lock 输入钉在 Base（44 inputs = 43 readAllowlist + 1 provenanceOnly
  `owner-authorization://longline-2026-08-09` hash `cc0f91c1...`）；contextFingerprint `2e83fbdf...`
  由复刻 verify_context_lock 算法生成并 round-trip 自验（先复现 TASK-0186 `869ff0d5...` 通过，再生 0187）。
- 受控 Python：`PATH=/Users/hxf/.zcode/venvs/vc-harness/bin:$PATH`。frontend 测试：pnpm 11.9.0 +
  vitest 3.2.6 + vue-tsc 1.0.24（node v22.23.1）。本卡不碰 OpenAPI/DB/service（openapi diff / run-rls /
  mvn 均 SKIP/不适用）。

## Harness 契约与治理边界

- **不触碰任何 protected path**：`frontend/**` 不在 protected-paths.yaml；`service/**` 不在（且本卡
  不改）；`specs/openapi/**` 不在（且本卡不改，relationship 端点已存在）→ 不触发 contract-change /
  catalog-change / database-migration / safety-change。
- 治理路径（`docs/tasks/**`、project-state、task-ledger、evidence、handoff）走 task-intake C2（与
  TASK-0179-0186 C2 卡一致）；`independentReview: not-required`（C2 条件风险）。
- `INV-TENANT-001`（存在性不披露）：relationship.ts 403/404→null/空数组，不 throw existence-disclosing
  error；listRelationships foreign/absent→空数组。

## 验收标准

1. `relationship.ts`：5 个 API 函数 + RelationshipHttpError + asId 归一；403/404→null/空，401/5xx→throw。
2. `stores/relationship.ts`：load/create/activate/deallocate/reset + current getter + status/error；
   catch→error 不伪成功。
3. `RelationshipSelector.vue`：props/emits 选择器组件 + a11y role=alert/status。
4. `chat.vue`：移除 DEMO_RELATIONSHIP_ID；接 relationship store；无关系显示选择器。
5. `relationship.spec.ts`（19）+ `stores/relationship.spec.ts`（11）+ `RelationshipSelector.spec.ts`（7）
   + `pages/chat/chat.spec.ts`（6）全 PASS。
6. `pnpm --dir frontend test:run`：234 tests，0 failures。
7. `pnpm --dir frontend type-check`：vue-tsc exit 0。
8. `git diff --check` exit 0。
9. Evidence 如实记录；doctor / canonical precheck / 完整 unittest deferred per Owner（不标 PASS），
   authorizationCommit 占位符记 knownRisk。
10. 终态单父提交、push 后 `HEAD==origin/main`、`0/0`、clean。

## 回滚或前向修复

- 若 frontend vitest 暴露 relationship API client/store/组件/chat.vue 问题：最多 1 fix batch。
- 若 type-check 暴露类型问题：最多 1 fix batch。
- 若实测必须改 OpenAPI、service、contracts、catalog、generated 或 DB：立即停止（超出授权，需新卡）。

## 停止条件

- writeAllowlist 外路径被修改；forbiddenPaths 被触碰。
- frontend vitest / type-check / diff check 任一非 PASS。
- 候选身份（Commit/Tree）变化或越界。
- hardFuseWallMinutes 90 到达：停止实现/修复/Reviewer/canonical，只允许 closure-only overrun。

## Evidence Pack

输出到 `docs/evidence/TASK-0187/`（evidence-pack.json、review-r1.md），并生成 `docs/handoffs/TASK-0187.json`。

# TASK-0105：Frontend memory/a11y（P2-16 + P3-03 + P3-04）

```yaml
taskId: TASK-0105
state: READY
owner: repository-owner
riskClass: C2
requiredSkills:
  - task-delivery-flow
  - task-intake
requiredSkillVersions:
  task-delivery-flow: "1.3.7"
  task-intake: "1.2.7"
targetSkillVersions: {}
baseCommit: 8e11d11f2789c975b6dadad8c06b2493a15323f4
authorizationCommit: ""
contextFingerprint: 9e54add47463f0d7cd0985abbc368ca7bb4ed2f8054830be097091e180e5bfc6
contextLock: docs/tasks/context/TASK-0105.context-lock.yaml
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
  surfaceId: TASK_0105_FRONTEND_MEMORY_A11Y
  policySurfaces: [AUTHORIZATION]
  distinctCrossRiskSurfaces: 1
  reviewerMinutesEstimate: 15
  terminalCheckMinutesEstimate: 20
  estimatedWallMinutes: 80
  thresholdsTriggered: []
  splitRequired: false
  ownerIndivisibleAuthorization: false
validationPlan: {frozenBefore: READY, policySource: .harness/ci-execution-policy.yaml, selectedChannel: LOCAL_EXACT_TREE_FALLBACK, profile: precheck}
readAllowlist:
  - .gitattributes
  - AGENTS.md
  - CLAUDE.md
  - requirements-harness.txt
  - .harness/agent-entrypoints.yaml
  - .harness/ci-execution-policy.yaml
  - .harness/commands.yaml
  - .harness/invariants.yaml
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
  - docs/tasks/TASK-0104-frontend-realtime-correctness.md
  - docs/handoffs/TASK-0104.json
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
  - frontend/package.json
  - frontend/vitest.config.ts
  - frontend/src/api/auth.ts
  - frontend/src/api/memory.ts
  - frontend/src/api/memory.spec.ts
  - frontend/src/api/transport.ts
  - frontend/src/stores/auth.ts
  - frontend/src/stores/memory.ts
  - frontend/src/stores/memory.spec.ts
  - frontend/src/pages/chat/chat.vue
  - frontend/src/pages/login/login.vue
  - frontend/src/pages/memory/memory.vue
writeAllowlist:
  - docs/tasks/TASK-0105-frontend-memory-a11y.md
  - docs/tasks/context/TASK-0105.context-lock.yaml
  - frontend/src/api/memory.ts
  - frontend/src/api/memory.spec.ts
  - frontend/src/stores/memory.ts
  - frontend/src/stores/memory.spec.ts
  - frontend/src/pages/memory/memory.vue
  - frontend/src/pages/login/login.vue
  - frontend/src/pages/chat/chat.vue
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - docs/evidence/TASK-0105/**
  - docs/handoffs/TASK-0105.json
forbiddenPaths:
  - .gitattributes
  - AGENTS.md
  - CLAUDE.md
  - .github/**
  - ci/**
  - requirements-harness.txt
  - scripts/dev/**
  - scripts/harness/**
  - skills/**
  - docs/schemas/**
  - docs/tasks/task-card-template.md
  - docs/tasks/TASK-0104-frontend-realtime-correctness.md
  - docs/evidence/TASK-0104/**
  - docs/handoffs/TASK-0104.json
  - docs/source/**
  - docs/decisions/**
  - docs/planning/**
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
  - specs/**
  - service/**
  - infra/**
  - frontend/src/main.ts
  - frontend/src/App.vue
  - frontend/src/domain/**
  - frontend/src/api/auth.ts
  - frontend/src/api/baseline.ts
  - frontend/src/api/realtime.ts
  - frontend/src/api/sse-parser.ts
  - frontend/src/api/transport.ts
  - frontend/src/stores/auth.ts
  - frontend/src/stores/baseline.ts
  - frontend/src/stores/chat.ts
  - frontend/src/pages/index/**
  - frontend/package.json
  - frontend/pnpm-lock.yaml
  - frontend/vite.config.*
  - frontend/vitest.config.*
  - frontend/tsconfig*.json
  - mvnw
  - mvnw.cmd
  - pom.xml
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
  - docs/tasks/TASK-0104-frontend-realtime-correctness.md
  - docs/handoffs/TASK-0104.json
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
requiredInvariants:
  - INV-TENANT-001
  - INV-MEM-002
  - INV-HARNESS-002
  - INV-HARNESS-003
  - INV-HARNESS-005
  - INV-HARNESS-007
  - INV-HARNESS-009
humanApprovals:
  - scope: task-assignment
    approvedBy: repository-owner
    approvedAt: "2026-08-09"
    sourceThreadId: zcode-audit-fix-20260809
    evidence: >-
      Owner 按 2026-08-08 审计交接工作包 11 拆卡决策分配 TASK-0105 Frontend
      memory/a11y 卡（P2-16 Memory API 把 401/5xx 映射为空成功 + P3-03 Memory
      页面状态/交互小错 + P3-04 登录与状态反馈缺 a11y）。complexityGate 评估
      三个拆卡触发条件命中（estimatedWallMinutes>90、跨 C2/C4 风险面、需扩大
      writeAllowlist），Owner 2026-08-09 确认拆两张：本卡（纯前端 C2，不触碰
      .github/workflows/ci.yml 与 package.json/pnpm-lock.yaml），TASK-0106
      （P2-19 CI 门禁 + P2-18 依赖完整升级，含 C4 workflow）为同一工作包第二张。
      前端组件测试基建（@vue/test-utils/happy-dom 新增 devDeps）归 TASK-0106
      P2-19，本卡页面行为以 api/store 测试 + 薄页面逻辑覆盖。
independentReview: required
reviewers: []
requiredCommands:
  - python scripts/harness/precheck.py --task TASK-0105
  - pnpm --dir frontend test:run
  - git diff --check
```

> 本卡为独立延续单卡（TASK-0095..0104 先例），不写 planningBacklog/planningContractHash；ID 已核对未占用（TASK-0105 起）。frontend/** 无保护路径规则，风险类 C2；属存在性隐藏（INV-TENANT-001）与记忆候选确认（INV-MEM-002）边界，独立 Reviewer 按卡要求执行。不触碰 `.github/**`、`package.json`/`pnpm-lock.yaml`（TASK-0106 范围）。

## 背景与用户可观察目标

审计确认前端 memory 与登录/状态反馈五个缺陷：

1. **P2-16**：`frontend/src/api/memory.ts` 所有非 2xx 都返回 `[]`/`null`/`false`——401（会话过期）与 5xx（服务故障）被展示为"没有记忆/来源"，用户无法区分"确实没有"与"认证失效/服务出错"。只有经产品确认的 403/404 可做存在性隐藏；401 应走会话处理（与 TASK-0103 统一 transport 的 401 生命周期一致）；5xx/parse failure 应显示 typed error。
2. **P3-03**：memory 页面/存储多处小错——Evidence 成功加载不清旧 error（stores/memory.ts loadEvidence）；空数组为 truthy 导致空来源容器仍渲染（memory.vue `v-if="memory.evidence[m.memoryId]"`）；保存失败也退出编辑（memory.vue onSave 无条件 `editingId.value = null`）；`relationshipId` 未 URL encode（api/memory.ts listMemories 路径拼接）。
3. **P3-04**：login.vue 输入主要依赖 placeholder 无稳定 label/aria；错误/加载/终态信息无 `role="alert"`/live region；chat/memory 状态区（statusText、busy、error）缺少可访问性语义。

本卡完成后，用户能观察到：401 时 memory 请求触发会话过期处理（与全局 401 生命周期一致，跳登录）而非显示"没有记忆"；5xx/parse 失败显示 typed 错误文案；memory 页面来源加载成功清除旧错误、空来源不渲染容器、编辑保存失败保持编辑态；relationshipId 含特殊字符时 URL 正确；登录与 chat/memory 状态区有稳定 label/aria 与 live 语义。

## 范围内

- **`frontend/src/api/memory.ts`（P2-16 + P3-03 编码）**：
  - 新增 typed `MemoryHttpError`（`extends Error`，带 `status` 与 `kind: "unauthorized" | "server" | "client" | "parse"`）与 `isExistenceHidden(status)`（仅 403/404）分类；
  - `MemoryApiResponse` 增加可选 `parseFailed?: boolean`（transport 在 `res.json()` 抛错时置位），既有测试构造不受影响；
  - 所有 JSON 读取端点（listMemories/getMemory/confirmMemory/rejectMemory/updateMemory/listMemoryEvidence）：`ok && !parseFailed` → 正常解析；`ok && parseFailed` → throw `MemoryHttpError(kind=parse)`；非 OK 且 403/404 → 保持存在性隐藏（`[]`/`null`）；非 OK 且 401 → throw `MemoryHttpError(kind=unauthorized)`；非 OK 且其他（5xx/4xx）→ throw `MemoryHttpError(kind=server|client)`；
  - `deleteMemory` 语义不变（返回 `r.ok`，403/404 → false 保持存在性隐藏；401/5xx → throw typed error，由 store 转 `delete-failed`）；
  - `listMemories` 的 `relationshipId` 用 `encodeURIComponent`（P3-03）。
- **`frontend/src/stores/memory.ts`（P2-16 + P3-03 状态）**：
  - catch `MemoryHttpError`：`kind=unauthorized` → `error = "session-expired"`（新 code）；其他 kind → 既有 per-operation codes（load-failed/confirm-failed/reject-failed/update-failed/delete-failed/evidence-failed）；
  - `loadEvidence` 成功路径清除旧 error（与 load/confirm/reject/update/remove 一致的 `error.value = null` 语义）；
  - `update` 返回 `Promise<boolean>`（仅 confirmed 成功返回 true），供页面"保存成功才退出编辑"。
- **`frontend/src/pages/memory/memory.vue`（P3-03 + P3-04）**：
  - 空证据容器用 `length` 判断（`v-if="... && ...length"`）；
  - `onSave` 仅当 `await memory.update(...)` 返回 true 才 `editingId.value = null`（保存失败保持编辑态并显示错误）；
  - transport 改用 `createAuthenticatedTransport`（TASK-0103 唯一凭据/CSRF/401 注入点，符合条件风险 4 方向）：401 → auth store 会话处理（全局 401 生命周期），页面不再散拼 header；
  - 错误区 `role="alert"`、加载/状态区 `aria-live`/`aria-busy` 语义（P3-04）。
- **`frontend/src/pages/login/login.vue`（P3-04）**：
  - 输入加稳定 `aria-label`（用户名/密码），保留 `data-testid` 与 autocomplete；
  - 错误信息 `role="alert"`；提交按钮 `aria-busy`（submitting 时）；登录失败后焦点管理（聚焦用户名输入）。
- **`frontend/src/pages/chat/chat.vue`（P3-04，仅模板/薄胶水）**：
  - 状态区（statusText）加 `role="status"`/`aria-live="polite"`；streaming 时 `aria-busy`；不改 store/domain/api 逻辑。
- **测试**：
  - `api/memory.spec.ts` 增补：401 → throws MemoryHttpError(kind=unauthorized)；5xx → kind=server；403/404 → 保持隐藏（[]/null/false）；parseFailed → kind=parse；encodeURIComponent（特殊字符 relationshipId）；
  - `stores/memory.spec.ts` 增补：401 → session-expired；5xx → per-op failed；loadEvidence 成功清旧 error；update 返回值；既有用例保持（无删测）；
  - 页面行为（保存失败不退出编辑、空证据不渲染）以薄逻辑 + store 返回值为准的 spec 覆盖；组件挂载测试基建归 TASK-0106。

## 明确范围外

- 不改 `.github/**`、`frontend/package.json`、`frontend/pnpm-lock.yaml`、`vitest.config.ts`（TASK-0106 P2-19/P2-18 范围，组件测试基建新增 devDeps 归 TASK-0106）。
- 不修后端（service/**）、P2-18/19、P1-09 遗留（已闭环）、P3-05/06。
- 不改 `frontend/src/api/transport.ts`/`auth.ts`/`stores/auth.ts`（TASK-0103 闭环物，只读复用）、chat store/domain、main.ts、index 页面。
- 不删除测试、不加 skip、不吞退出码、不改写历史 Evidence/Handoff/ADR。

## 输入和前置条件

- Base Commit 固定为 `8e11d11f2789c975b6dadad8c06b2493a15323f4`（TASK-0104 ACCEPTED 终态），DRAFT 创建前工作树干净、`activeTask: null`、ledger 无 TASK-0105 条目。
- Context Lock 只绑定 Base Commit 内仓库相对路径；外部审计/交接文档仅作 provenance。
- 前端验证：`pnpm --dir frontend test:run`（vitest，node 环境）+ `pnpm --dir frontend type-check` + `pnpm --dir frontend build`（定向验证）；本机 pnpm 10.32.1 / node v22.23.1。
- Canonical argv 保持机器策略规定的 `python`（受控 venv `~/.zcode/venvs/vc-harness/bin/python`，PATH 前缀）；每次 doctor/precheck 干净 `TMPDIR=$(mktemp -d ...)`。
- 本卡 C2（frontend/** 无保护路径规则）；不变量 INV-TENANT-001（存在性永不披露——仅 403/404 隐藏）与 INV-MEM-002（未确认候选不呈现为已保存事实）必须保持。

## API / 事件 / 数据契约

- `MemoryHttpError`：`{ status: number; kind: "unauthorized" | "server" | "client" | "parse" }`，`extends Error`；401 → unauthorized；>=500 → server；其他非 2xx 非 403/404 → client；ok 但 parseFailed → parse。
- 存在性隐藏（INV-TENANT-001）：仅 403/404 映射为 `[]`/`null`/`false`；绝不抛存在性披露错误（与 transport.ts/chat.vue 的 NOT_FOUND_OR_FORBIDDEN 语义一致）。
- `MemoryTransport.request` 签名不变；`MemoryApiResponse` 增加可选 `parseFailed?: boolean`。
- `useMemoryStore.update` 返回 `Promise<boolean>`（confirmed 成功 → true；not-confirmed/transport/typed 错误 → false）；其余 store 方法签名不变。
- `listMemories` 路径：`/api/v1/relationships/${encodeURIComponent(relationshipId)}/memories`。
- 无后端/契约/DB 变更。

## 权限、RLS 和数据处理要求

- 不接触真实用户数据/凭据；测试为合成 fixture。
- memory.vue 的 transport 复用 `createAuthenticatedTransport`（唯一凭据/CSRF 注入点，POST/PATCH/DELETE 自动注入 X-CSRF-Token；credentials:"include"）；不向 localStorage/日志写 token。
- 401 生命周期：transport `onUnauthorized` → auth store 清会话跳登录（TASK-0103 语义），store 同时置 `session-expired` typed error。

## 状态机和失败行为

- API 层：ok+parse 正常；ok+parseFailed → parse 错误；403/404 → 隐藏空；401 → unauthorized 抛错；5xx → server 抛错；其他 4xx → client 抛错（400/409/422 等真实失败不再伪装为空成功）。
- Store：unauthorized → `session-expired`；server/client/parse → per-operation failed codes；网络抛错 → 既有 failed codes；confirmed 成功才变更状态（不变）。
- 页面：保存失败保持编辑态（不退出）；证据空数组不渲染容器；错误区 role=alert；busy 状态 aria-live/busy。
- 任一测试失败保持非零退出并如实记录；remote CI 在 Actions 配额耗尽下如实记录非 PASS（TASK-0095..0104 先例），本地等价验证（vitest + type-check + build + canonical precheck）为备用通道（Owner 既有授权）。

## 模型、Prompt、记忆和安全边界

- 不修改模型、Prompt、后端记忆、SafetyGate；不引入新依赖、SaaS 或付费运行时。
- INV-MEM-002 保持：store 仍把 PENDING_CONFIRMATION 候选与 ACCEPTED canonical 严格分离，未确认候选永不呈现为已保存事实。
- INV-TENANT-001 保持：仅 403/404 隐藏存在性；401/5xx 走 typed 错误而非披露资源存在性。

## 验收标准

1. **P2-16 错误映射**：`listMemories`/`getMemory`/`confirm/reject/update/listMemoryEvidence` 对 401 → throw `MemoryHttpError(kind=unauthorized)`（spec 断言）；5xx → kind=server；其他 4xx（400/409/422）→ kind=client；`ok && parseFailed` → kind=parse；403/404 → 仍返回 `[]`/`null`（不抛错，spec 全路径）。
2. **P2-16 会话处理**：store 对 unauthorized → `error === "session-expired"`；memory.vue transport 使用 `createAuthenticatedTransport`（401 → onUnauthorized 清会话跳登录）；spec 断言 store 路径。
3. **P3-03 状态清理**：loadEvidence 成功清除旧 error（store spec：先制造 evidence-failed 再成功加载 → error 为 null）。
4. **P3-03 长度判断**：memory.vue 证据容器只在 `length > 0` 时渲染（模板改动 + build/type-check PASS；空数组不再渲染容器）。
5. **P3-03 仅成功退出编辑**：`store.update` 返回 boolean；`onSave` 仅 true 时 `editingId.value = null`（失败保持编辑态，spec 断言 update 返回 false 且状态不变）。
6. **P3-03 URL encode**：`listMemories` 用 `encodeURIComponent`（spec：relationshipId 含 `?/&/#` 时请求路径正确）。
7. **P3-04 a11y**：login.vue 输入有 aria-label、错误 role="alert"、submitting aria-busy、失败聚焦用户名；memory.vue/chat.vue 状态区 role="alert"/role="status"+aria-live、busy aria-busy（build/type-check PASS + Reviewer 核对模板）。
8. **前端验证**：`pnpm --dir frontend test:run` 全 PASS；type-check PASS；build PASS（定向验证）；canonical precheck 5/5 PASS。
9. **交付闭环**：Diff 仅含 writeAllowlist；独立 Reviewer 通过；remote 按配额受限如实记录（非 PASS，passClaimed=false）；Handoff `nextAction` 与终态 project-state 逐字一致；origin/main `0/0`。

## 必跑检查

以 YAML `requiredCommands` 的精确 argv 为准。Canonical Precheck 只运行一次；`pnpm --dir frontend test:run` 是任务特有前端门禁（precheck 不含前端），只运行一次；`git diff --check` 只运行一次。type-check/build 作为定向验证记录。所有命令记录真实状态、退出码、验证 Commit/Tree、解释器/环境身份。

## 回滚或前向修复

- 修复采用最小前端变更；若测试失败，先确认失败集合是否超出本卡范围，超范围即停止并报告。
- R1 如有阻塞发现，最多一个 fix batch；R2 只验证 finding closure、delta、adjacent risk 和新 P0/P1，禁止第三轮。
- 无持久数据变更；回滚 = 修正文件后重跑 vitest/type-check/build 与 precheck。
- READY 后如需增加路径或改变条款，只能停止并走 Backlog 强类型 Owner amendment（若出现该需求应停止并询问 Owner）。

## 停止条件

- 需要修改 writeAllowlist 外路径（如 transport.ts/auth.ts（TASK-0103 闭环物）、package.json（新依赖）、vitest.config.ts、.github/**、service/** 等）时立即停止并询问 Owner（组件测试基建与依赖变更归 TASK-0106）。
- 实现揭示后端 memory 契约缺口（如 401/5xx 语义与前端假设不符）时停止并询问 Owner。
- 条件风险 4（memory 未统一 authenticated transport）若成为阻塞（如需要后端端点联调才能验证），按既有 Alpha 离线契约以合成/测试路径验证，不扩大范围。
- Context、Owner 批准、Skill、白名单、候选身份、Reviewer、canonical、remote exact-SHA 任一缺失或失败，立即失败关闭并按 lifecycle 转 BLOCKED/REJECTED。
- 90 分钟 hard fuse 到达后停止实现、修复、Reviewer、canonical 和 CI；若仓库已活动，仅允许按策略做 closure-only overrun。

## Evidence Pack

输出 `docs/evidence/TASK-0105/evidence-pack.json`、`pre-closure-request.json`、
`review-r1.md`/必要的 `review-r2.md`，并生成 `docs/handoffs/TASK-0105.json`。所有 PASS
绑定真实候选 Commit/Tree、精确 argv、解释器/环境、Reviewer 和 remote exact-SHA；
Handoff `nextAction` 与终态 project-state 逐字一致。

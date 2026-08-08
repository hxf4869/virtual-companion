# TASK-0103：前端 session 接线（P1-09 前端侧 + 条件风险 4）

```yaml
taskId: TASK-0103
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
baseCommit: f39a550c31ad5572581657b44ac9e162e6c97e81
authorizationCommit: ""
contextFingerprint: 09959deadaf0e9c0411af5ca32e3ff022d365fdd4e5a2b411725a8a9d7fc5ee3
contextLock: docs/tasks/context/TASK-0103.context-lock.yaml
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
  surfaceId: TASK_0103_FRONTEND_SESSION_WIRING
  policySurfaces: [AUTHORIZATION]
  distinctCrossRiskSurfaces: 1
  reviewerMinutesEstimate: 10
  terminalCheckMinutesEstimate: 20
  estimatedWallMinutes: 60
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
  - docs/tasks/TASK-0102-backend-session-boundary.md
  - docs/evidence/TASK-0102/evidence-pack.json
  - docs/handoffs/TASK-0102.json
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
  - specs/contracts/identity-session-boundary-contract.yaml
  - frontend/src/api/auth.ts
  - frontend/src/api/transport.ts
  - frontend/src/api/baseline.ts
  - frontend/src/api/auth.spec.ts
  - frontend/src/api/transport.spec.ts
  - frontend/src/stores/auth.ts
  - frontend/src/stores/auth.spec.ts
  - frontend/src/stores/baseline.ts
  - frontend/src/pages/login/login.vue
  - frontend/package.json
writeAllowlist:
  - docs/tasks/TASK-0103-frontend-session-wiring.md
  - docs/tasks/context/TASK-0103.context-lock.yaml
  - frontend/src/api/auth.ts
  - frontend/src/api/transport.ts
  - frontend/src/api/auth.spec.ts
  - frontend/src/api/transport.spec.ts
  - frontend/src/stores/auth.ts
  - frontend/src/stores/auth.spec.ts
  - frontend/src/pages/login/login.vue
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - docs/evidence/TASK-0103/**
  - docs/handoffs/TASK-0103.json
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
  - docs/tasks/TASK-0102-backend-session-boundary.md
  - docs/evidence/TASK-0102/**
  - docs/handoffs/TASK-0102.json
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
  - frontend/src/api/baseline.ts
  - frontend/src/api/realtime.ts
  - frontend/src/api/memory.ts
  - frontend/src/api/baseline.spec.ts
  - frontend/src/api/realtime.spec.ts
  - frontend/src/api/memory.spec.ts
  - frontend/src/stores/baseline.ts
  - frontend/src/stores/baseline.spec.ts
  - frontend/src/stores/chat.ts
  - frontend/src/stores/chat.spec.ts
  - frontend/src/stores/memory.ts
  - frontend/src/stores/memory.spec.ts
  - frontend/src/pages/chat/**
  - frontend/src/pages/memory/**
  - frontend/src/pages/index/**
  - frontend/package.json
  - frontend/pnpm-lock.yaml
  - frontend/vite.config.*
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
  - specs/contracts/identity-session-boundary-contract.yaml
  - docs/tasks/TASK-0102-backend-session-boundary.md
  - docs/handoffs/TASK-0102.json
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
requiredInvariants:
  - INV-HARNESS-002
  - INV-HARNESS-003
  - INV-HARNESS-005
  - INV-HARNESS-007
  - INV-HARNESS-009
humanApprovals:
  - scope: task-assignment
    approvedBy: repository-owner
    approvedAt: "2026-08-08"
    sourceThreadId: zcode-audit-fix-20260808
    evidence: >-
      Owner 按 2026-08-08 审计交接工作包 9 分配前端 session 接线卡（TASK-0103，
      工作包 9 前端侧）：P1-09 前端侧（auth store 移除 localStorage 持久化，
      access token 仅内存、refresh 走 HttpOnly cookie）与条件风险 4（统一
      authenticated transport，不在页面散拼 header）。后端契约已由 TASK-0102
      冻结（vc_refresh HttpOnly cookie + vc_csrf double-submit + X-CSRF-Token
      header + baseline permitAll），本卡只做前端消费方接线与测试固化。
      P1-09 由 TASK-0102（后端侧）+ TASK-0103（前端侧）共同关闭。
independentReview: required
reviewers: []
requiredCommands:
  - python scripts/harness/precheck.py --task TASK-0103
  - pnpm --dir frontend test:run
  - git diff --check
```

> 本卡为独立延续单卡（TASK-0095..0102 先例），不写 planningBacklog/planningContractHash；ID 已核对未占用（TASK-0103 起）。工作包 9 前端侧；frontend/** 无保护路径规则，风险类 C2，但属认证会话边界（安全相邻），独立 Reviewer 按卡要求执行。后端契约（identity-session-boundary-contract.yaml）已于 TASK-0102 更新并推送，本卡不改契约。

## 背景与用户可观察目标

审计确认 P1-09 的前端侧缺陷：`frontend/src/stores/auth.ts` 把 access token 与 refresh token 明文持久化到 localStorage（XSS 可读）。Owner 已决策 HttpOnly cookie + CSRF/Origin 方案，TASK-0102 已完成后端侧（refresh token 仅经 HttpOnly `vc_refresh` cookie；写操作要求 `X-CSRF-Token` double-submit；响应体不再返回 refreshToken）。

本卡完成后，用户能观察到：前端不再向 localStorage 写入任何 token（access token 仅内存，页面刷新后会话经 HttpOnly cookie 自动恢复）；所有请求统一携带凭据（`credentials: "include"`）与 CSRF header（状态变更方法自动注入 `X-CSRF-Token`，值取自 `vc_csrf` cookie）；401 生命周期统一处理（会话失效清状态并跳登录）；登录/刷新/登出 API 与新后端契约一致（refresh/logout 不再传 refreshToken 参数）。

## 范围内

- **`frontend/src/api/auth.ts`（P1-09 前端侧）**：
  - `AuthTokens` 类型移除 `refreshToken` 字段（后端响应体已不再返回）；`asTokens` 只解析 accessToken/tokenType/expiresInSeconds/accountId/role。
  - `refresh(t)` 移除 refreshToken 参数（cookie 自动携带，body 为空）；`logout(t)` 移除 refreshToken 参数（cookie 自动携带）。
- **`frontend/src/api/transport.ts`（风险 4 统一 transport）**：
  - `createAuthenticatedTransport`：fetch 统一加 `credentials: "include"`（HttpOnly cookie 随请求发送）；
  - 状态变更方法（POST/PUT/PATCH/DELETE）自动从 `document.cookie` 读取 `vc_csrf` 并注入 `X-CSRF-Token` header（无 cookie 则不注入）；GET/HEAD/OPTIONS 不注入；
  - 401 → `provider.onUnauthorized()`（既有语义保持：清会话 + 跳登录）。
  - 这是唯一的凭据/CSRF 注入点（风险 4：页面/业务 store 不得散拼 header）。
- **`frontend/src/stores/auth.ts`（P1-09 前端侧）**：
  - 移除 localStorage 持久化（ACCESS_KEY/REFRESH_KEY/ACCOUNT_KEY/ROLE_KEY 常量与 storage()/read()/write()/remove() 辅助）；accessToken/accountId/role 仅内存；
  - `persist(tokens)` 仅写内存；`tryRefresh(t)` 不再依赖存储的 refresh token（直接调用 `apiRefresh(t)`，cookie 自动携带），成功更新内存、失败清会话；
  - `logout(t)` 调 `apiLogout(t)`（cookie 自动携带）并清内存；`isAuthenticated`/401 生命周期语义保持；
  - 会话恢复：页面加载后调用 `tryRefresh` 经 cookie 恢复（login.vue 或既有入口接线保持）。
- **`frontend/src/pages/login/login.vue`**：适配 transport 新行为（若需要）；基线页面/chat/memory 不动（它们尚未接线真实请求，main.ts 注释保留）。
- **测试（固化正确行为）**：
  - `api/auth.spec.ts`：login/refresh/logout 请求/响应契约——响应体无 refreshToken 也可解析；refresh/logout 不传 refreshToken 参数（body 断言）；
  - `api/transport.spec.ts`：credentials:"include" 断言；状态变更方法注入 X-CSRF-Token（值取 vc_csrf cookie）；GET 不注入；无 cookie 不注入；401 触发 onUnauthorized；
  - `stores/auth.spec.ts`：登录后 localStorage 无 token 键（内存化断言）；刷新会话经 cookie（transport mock 断言无 refreshToken 参数）；logout 清内存；401 清会话 + 跳登录。

## 明确范围外

- 不修后端（TASK-0102 已闭环）：AuthController/CookieCsrfGuardFilter/契约不动。
- 不修 P1-07/P2-14/15/17（frontend realtime）、P2-16/18/19（memory API/依赖审计/前端 CI 门禁——P2-19 是独立审计项，CI 加 test:run/type-check 属工作包 11）、P3-03/04。
- 不改 `specs/contracts/**`（契约已于 TASK-0102 更新）、`frontend/src/api/baseline.ts`、`frontend/src/stores/baseline.ts`（baseline 已是公开 plain fetch）、chat/memory/realtime 文件、`frontend/package.json`、`frontend/pnpm-lock.yaml`、`frontend/src/main.ts`、`frontend/src/domain/**`、pages/chat、pages/memory、pages/index。
- 不删除测试、不加 skip、不吞退出码、不改写历史 Evidence/Handoff/ADR。

## 输入和前置条件

- Base Commit 固定为 `f39a550c31ad5572581657b44ac9e162e6c97e81`（TASK-0102 ACCEPTED 终态），DRAFT 创建前工作树干净、`activeTask: null`、ledger 无 TASK-0103 条目。
- Context Lock 只绑定 Base Commit 内仓库相对路径；外部审计/交接文档仅作 provenance。
- 后端契约已冻结（TASK-0102）：vc_refresh HttpOnly cookie、vc_csrf double-submit、X-CSRF-Token header、refresh/logout cookie 化、响应体无 refreshToken。
- 前端验证：`pnpm --dir frontend test:run`（vitest）+ `pnpm --dir frontend type-check`（vue-tsc）+ `pnpm --dir frontend build`（uni build，作为定向验证；CI 门禁接入属 P2-19 范围外）；本机 pnpm 10.32.1 / node v22.23.1 / node_modules 已存在。
- Canonical argv 保持机器策略规定的 `python`（受控 venv `~/.zcode/venvs/vc-harness/bin/python`，PATH 前缀）；每次 doctor/precheck 干净 `TMPDIR=$(mktemp -d ...)`。
- 本卡 C2（frontend/** 无保护路径规则），但属认证会话边界：独立 Reviewer 按卡要求执行。

## API / 事件 / 数据契约

- `POST /api/v1/auth/login`：请求体不变；响应体解析不含 refreshToken（asTokens 忽略该字段）；Set-Cookie 由浏览器自动处理（HttpOnly）。
- `POST /api/v1/auth/refresh`：无请求体（cookie 携带 vc_refresh）；成功响应体含新 accessToken/accountId/role。
- `POST /api/v1/auth/logout`：无请求体（cookie 携带 vc_refresh）；服务端清 cookie。
- 状态变更请求（含 refresh/logout）自动携带 `X-CSRF-Token: <vc_csrf cookie 值>`；所有请求 `credentials: "include"`。
- 无 DB/后端/契约变更；前端行为与 `identity-session-boundary-contract.yaml` h5CredentialBoundary 一致（refreshTokenInResponseBodyForbidden、csrfRequiredForStateChanges、bearerOnlyWithoutSessionCookieNotCsrfBound）。

## 权限、RLS 和数据处理要求

- 不接触真实用户数据/凭据；测试为合成 fixture。
- token 只存在于内存（accessToken/accountId/role）与 HttpOnly cookie（refresh，浏览器管理，JS 不可读）；localStorage 不再写入任何凭据。
- CSRF header 值来自 vc_csrf cookie（非 HttpOnly，随机值，无凭据语义）；不把 token 写入日志、URL、chat drafts、memory 内容或模型上下文（既有 privacyBoundary 保持）。

## 状态机和失败行为

- 登录成功 → 内存写入 + cookie 由浏览器保存；登录失败 → invalid-credentials/network-failed（既有语义）。
- 刷新：cookie 有效 → 新 accessToken 入内存；401/cookie 失效 → 清会话 + 跳登录（transport onUnauthorized）；网络失败 → refresh-failed（不清会话，可重试）。
- 登出：调用 logout（cookie 携带）→ 服务端撤销 + 清 cookie → 清内存；网络失败 best-effort（既有语义）。
- 页面刷新：无内存 token → 调 tryRefresh 经 cookie 恢复会话；无 cookie → 未认证状态（跳登录）。
- 任一测试失败保持非零退出并如实记录；remote CI 在 Actions 配额耗尽下如实记录非 PASS（TASK-0095..0102 先例），本地等价验证（vitest + type-check + build + canonical precheck）为备用通道（Owner 既有授权）。

## 模型、Prompt、记忆和安全边界

- 不修改模型、Prompt、记忆、SafetyGate；不引入新依赖、SaaS 或付费运行时（仅改既有文件，无 package.json 变更）。
- token 生命周期边界与契约一致；XSS 可读存储（localStorage）中不再出现任何长期凭据。

## 验收标准

1. **P1-09 前端侧无持久化凭据**：auth store 不再向 localStorage 写入任何键（accessToken/refreshToken/accountId/role 均不持久化）；access token 仅内存；刷新后会话经 HttpOnly cookie + tryRefresh 恢复（spec 断言 localStorage 无 token 键）。
2. **API 契约对齐**：`refresh`/`logout` 不携带 refreshToken 参数（body 为空/无该字段）；`AuthTokens` 无 refreshToken 字段；响应体无 refreshToken 也可正确解析。
3. **风险 4 统一 transport**：所有请求 `credentials: "include"`；状态变更方法（POST/PUT/PATCH/DELETE）自动注入 `X-CSRF-Token`（值 = vc_csrf cookie）；GET 不注入；无 vc_csrf cookie 不注入；401 → onUnauthorized（spec 逐项断言）。
4. **401 生命周期**：refresh 返回 401 → 清会话 + 跳登录（不伪造会话）；登录失败/网络失败语义保持（既有 spec 不回归）。
5. **前端验证**：`pnpm --dir frontend test:run` 全 PASS；`pnpm --dir frontend type-check` PASS；`pnpm --dir frontend build` PASS（定向验证）；canonical precheck 5/5 PASS。
6. **交付闭环**：Diff 仅含 writeAllowlist；独立 Reviewer 通过；remote 按配额受限如实记录（非 PASS，passClaimed=false）；Handoff `nextAction` 与终态 project-state 逐字一致；origin/main `0/0`。

## 必跑检查

以 YAML `requiredCommands` 的精确 argv 为准。Canonical Precheck 只运行一次；`pnpm --dir frontend test:run` 是任务特有前端门禁（precheck 不含前端），只运行一次；`git diff --check` 只运行一次。`type-check`/`build` 作为定向验证记录（不重复计入 requiredCommands）。所有命令记录真实状态、退出码、验证 Commit/Tree、解释器/环境身份。

## 回滚或前向修复

- 修复采用最小前端变更；若测试失败，先确认失败集合是否超出本卡范围，超范围即停止并报告。
- R1 如有阻塞发现，最多一个 fix batch；R2 只验证 finding closure、delta、adjacent risk 和新 P0/P1，禁止第三轮。
- 无持久数据变更；回滚 = 修正文件后重跑 vitest/type-check/build 与 precheck。
- READY 后如需增加路径或改变条款，只能停止并走 Backlog 强类型 Owner amendment（若出现该需求应停止并询问 Owner）。

## 停止条件

- 需要修改 writeAllowlist 外路径（如 package.json/pnpm-lock（新依赖）、main.ts、baseline/chat/memory/realtime 文件、specs/contracts/**、service/** 等）时立即停止并询问 Owner。
- 后端契约与 TASK-0102 冻结语义不一致（如需要后端再改 cookie/CSRF 行为）时停止并报告（后端属 TASK-0102 已闭环范围，新需求走新卡）。
- Context、Owner 批准、Skill、白名单、候选身份、Reviewer、canonical、remote exact-SHA 任一缺失或失败，立即失败关闭并按 lifecycle 转 BLOCKED/REJECTED。
- 90 分钟 hard fuse 到达后停止实现、修复、Reviewer、canonical 和 CI；若仓库已活动，仅允许按策略做 closure-only overrun。

## Evidence Pack

输出 `docs/evidence/TASK-0103/evidence-pack.json`、`pre-closure-request.json`、
`review-r1.md`/必要的 `review-r2.md`，并生成 `docs/handoffs/TASK-0103.json`。所有 PASS
绑定真实候选 Commit/Tree、精确 argv、解释器/环境、Reviewer 和 remote exact-SHA；
Handoff `nextAction` 与终态 project-state 逐字一致。

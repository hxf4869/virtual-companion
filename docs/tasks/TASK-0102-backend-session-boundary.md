# TASK-0102：后端 session 边界（P1-08 + P1-09 后端侧 + 条件风险 3）

```yaml
taskId: TASK-0102
state: DRAFT
owner: repository-owner
riskClass: C3
requiredSkills:
  - task-delivery-flow
  - task-intake
  - contract-change
requiredSkillVersions:
  task-delivery-flow: "1.3.7"
  task-intake: "1.2.7"
  contract-change: "1.0.0"
targetSkillVersions: {}
baseCommit: 9ae55774533bc455d1ab911dc01ee7a215d510b5
authorizationCommit: ""
contextFingerprint: 229678870d1137ad57259d3645d347da4817aa3e4026cfe58fdc2355592fc89f
contextLock: docs/tasks/context/TASK-0102.context-lock.yaml
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
  riskClass: C3
  surfaceId: TASK_0102_BACKEND_SESSION_BOUNDARY
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
  - docs/tasks/TASK-0101-database-ci-gate.md
  - docs/handoffs/TASK-0101.json
  - skills/contract-change/SKILL.md
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
  - specs/contracts/identity-session-boundary-contract.yaml
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/AuthSecurityConfig.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/web/AuthController.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/web/AuthRequests.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/web/AuthResponses.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/application/AuthService.java
  - service/apps/runtime/src/main/resources/application.yaml
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/config/AuthSecurityIntegrationTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/application/AuthServiceTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/web/AuthControllerCookieTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/ProductionProfileFailClosedTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/baseline/BaselineControllerTest.java
  - frontend/src/stores/auth.ts
  - frontend/src/api/auth.ts
  - frontend/src/api/transport.ts
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/baseline/BaselineController.java
writeAllowlist:
  - docs/tasks/TASK-0102-backend-session-boundary.md
  - docs/tasks/context/TASK-0102.context-lock.yaml
  - specs/contracts/identity-session-boundary-contract.yaml
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/AuthSecurityConfig.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/CookieCsrfGuardFilter.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/web/AuthController.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/web/AuthRequests.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/web/AuthResponses.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/application/AuthService.java
  - service/apps/runtime/src/main/resources/application.yaml
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/config/AuthSecurityIntegrationTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/application/AuthServiceTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/web/AuthControllerCookieTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/ProductionProfileFailClosedTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/baseline/BaselineControllerTest.java
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - docs/evidence/TASK-0102/**
  - docs/handoffs/TASK-0102.json
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
  - docs/tasks/TASK-0101-database-ci-gate.md
  - docs/evidence/TASK-0101/**
  - docs/handoffs/TASK-0101.json
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
  - specs/catalog/**
  - specs/generated/**
  - specs/contracts/database-ownership-contract.yaml
  - specs/contracts/realtime-contract.yaml
  - specs/contracts/beta-gate-contract.yaml
  - specs/contracts/license-cost-boundary-contract.yaml
  - service/modules/**
  - service/adapters/**
  - service/tests/**
  - service/platform/**
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/tenant/**
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/jwt/**
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/baseline/**
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/jwt/**
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/tenant/**
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/baseline/CatalogSnapshotLoaderTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/RuntimeContextTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/RuntimeModuleStructureTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/modelproviders/**
  - service/apps/runtime/pom.xml
  - frontend/**
  - infra/**
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
  - skills/contract-change/SKILL.md
  - specs/contracts/identity-session-boundary-contract.yaml
  - docs/tasks/TASK-0101-database-ci-gate.md
  - docs/handoffs/TASK-0101.json
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
      Owner 按 2026-08-08 审计交接工作包 9（Frontend session 设计）分配后端
      session 边界卡（TASK-0102）：P1-09 refresh token 采用 HttpOnly cookie +
      CSRF/Origin 方案（Owner 决策：HttpOnly cookie + CSRF/Origin 推荐项）；
      P1-08 baseline API/首页为公开端点 permitAll（Owner 决策：公开端点
      permitAll 推荐项）；条件风险 3 production profile 强制 auth+datasource
      缺配置启动失败。本卡为工作包 9 后端侧（前端接线为后续 TASK-0103）；
      工作包 9 内按 delivery-policy complexityGate 拆分（后端+契约+前端合计
      估算 > 90min）。P1-09/P1-08 由 TASK-0102+TASK-0103 共同关闭。
  - scope: contract-change
    approvedBy: repository-owner
    approvedAt: "2026-08-08"
    sourceThreadId: zcode-audit-fix-20260808
    evidence: >-
      Owner 批准 TASK-0102 修改 specs/contracts/identity-session-boundary-contract.yaml
      （C3 保护路径，requiredSkill=contract-change）：解析 deferredOwnerDecisions 中
      cookie_or_bearer_architecture_and_cookie_parameters（决策：HttpOnly refresh
      cookie + CSRF double-submit + Origin 校验，SameSite=Lax、Secure 可配置默认
      true）与 public_api_paths 中 baseline 公开部分（/api/internal/baseline
      permitAll）；同步 h5CredentialBoundary 与响应契约（refresh token 不再进
      响应体）。contract-change skill 1.0.0；独立 Reviewer 按 C3 要求。
independentReview: required
reviewers: []
requiredCommands:
  - python scripts/harness/precheck.py --task TASK-0102
  - docker run --rm -v /Users/hxf/projects/virtual-companion:/workspace -v vc-maven-cache:/root/.m2 -w /workspace maven:3.9-eclipse-temurin-25-alpine ./mvnw --batch-mode --no-transfer-progress verify
  - git diff --check
```

> 本卡为独立延续单卡（TASK-0095..0101 先例），不写 planningBacklog/planningContractHash；ID 已核对未占用（TASK-0102 起）。工作包 9 按 delivery-policy complexityGate（estimatedWallMinutes > 90 → split）拆为后端卡（本卡）+ 前端卡（TASK-0103）；本卡 C3（specs/contracts/** 触发 contract-change + 独立复核），humanApprovals 已预填 Owner 决策记录。

## 背景与用户可观察目标

审计确认三个后端 session 缺陷/风险：

1. **P1-09（后端侧）**：refresh token 以明文进响应体，前端持久化到 localStorage（XSS 可读）。Owner 已决策：refresh token 走 **HttpOnly + Secure + SameSite cookie**（JS 不可读）；access token 仍由响应体交付（前端仅内存）；写操作配 **CSRF token（double-submit）+ Origin 校验**。
2. **P1-08**：认证开启后 baseline API（`/api/internal/baseline`）被 `anyRequest().authenticated()` 拦截必然 401。Owner 已决策：baseline 为**公开端点**（显式 permitAll）。
3. **条件风险 3**：`application.yaml` 无 production profile 强制——`auth.enabled`/`datasource-enabled` 默认 false，生产部署忘记开启认证时 fail-open。需 production profile 缺配置启动失败。

本卡完成后，用户能观察到：认证开启时 baseline 匿名可访问（200）；登录/刷新通过 HttpOnly cookie 维持会话（refresh token 不再出现在响应体/脚本可读存储）；带会话 cookie 的写操作必须携带 CSRF token 且 Origin 在 allowlist 内，否则 403；production profile 缺 auth/datasource 配置时启动失败（fail-closed）；`identity-session-boundary-contract.yaml` 的 cookie 架构决策解析并与实现一致。

## 范围内

- **`specs/contracts/identity-session-boundary-contract.yaml`（C3 contract-change）**：
  - 解析 `deferredOwnerDecisions.cookie_or_bearer_architecture_and_cookie_parameters`：记录 Owner 2026-08-08 决策（HttpOnly refresh cookie + CSRF double-submit + Origin 校验）；`h5CredentialBoundary.preferredSessionCookie` 确定 SameSite=Lax、Secure 默认 true（本地开发可配置关闭，非生产）、新增 CSRF cookie 属性（非 HttpOnly、随机、随会话轮换）；`csrfRequiredForStateChanges`/`originValidationRequired` 保持 true。
  - 解析 `public_api_paths` 的 baseline 部分：`/api/internal/baseline` 为公开 GET 端点（其余 public 路径与 http statuses/error envelope 语义仍 deferred，属 P2-04/后续卡范围）。
  - 响应契约：login/refresh 响应体移除 `refreshToken` 字段（仅 accessToken/tokenType/expiresInSeconds/accountId/role）；refresh 请求改为从 `vc_refresh` cookie 读取（删除 body refreshToken）。
- **`AuthSecurityConfig.java`**：
  - `/api/internal/baseline` GET permitAll（P1-08）；`/api/v1/auth/login`、`/api/v1/auth/refresh`、`/actuator/health` 保持 public；其余端点 authenticated。
  - 注册 `CookieCsrfGuardFilter`；CORS allowlist 保持（Origin 校验语义由 filter 强化）。
  - 文档注释更新（Bearer-only 说明 → cookie + bearer 混合说明）。
- **新增 `CookieCsrfGuardFilter.java`（config 包）**：
  - 请求带 `vc_refresh`/`vc_csrf` 会话 cookie 时：非 GET/HEAD/OPTIONS 写操作要求 `X-CSRF-Token` header == `vc_csrf` cookie 值（double-submit，常量时间比较），缺失/不匹配 → 403；`Origin` header 存在时必须命中 `virtual-companion.auth.cors-allowed-origins` allowlist，未知 Origin → 403。
  - 无会话 cookie 的 Bearer-only 请求不强制 CSRF token（无 cookie 即无 CSRF 风险面），Origin 校验保持。
  - 不改变既有认证路径（JWT filter、401 AUTHENTICATION_REQUIRED 语义）。
- **`AuthController.java` / `AuthResponses.java` / `AuthService.java`**：
  - login/refresh 成功后：响应体不再含 refreshToken；响应 `Set-Cookie: vc_refresh=<token>; HttpOnly; SameSite=Lax; Secure=<config>; Path=/api/v1/auth`（Path 收窄至 auth 域；Max-Age=refresh-token-ttl）；同时 `Set-Cookie: vc_csrf=<random>`（非 HttpOnly）。
  - refresh 改为读取 `vc_refresh` cookie（body 字段移除）；轮换后旧 refresh 失效语义（V14 rotate 保持不变）；refresh 失败（cookie 缺失/无效）→ 401 AUTHENTICATION_REQUIRED（不泄露存在性）。
  - logout 兼容（cookie 清除 + 既有撤销）。
- **`application.yaml`（风险 3）**：
  - 新增 `production` profile（`spring.config.activate.on-profile: production`）：`virtual-companion.auth.enabled: ${VC_AUTH_ENABLED}`、`datasource-enabled: ${VC_AUTH_DATASOURCE_ENABLED}`（**无默认值**——缺 env 时占位符解析失败 → 启动失败 fail-closed）；`cookie-secure: ${VC_AUTH_COOKIE_SECURE:true}`（auth 属性，默认 true）。
- **测试**：
  - `AuthSecurityIntegrationTest`（auth.enabled=true 集成）：login 响应 Set-Cookie HttpOnly/SameSite/Secure 断言 + body 无 refreshToken；refresh 走 cookie 轮换成功；无 cookie refresh → 401；baseline 匿名 200 + 其他端点匿名 401；带会话 cookie 写操作无 CSRF header → 403、正确 double-submit → 成功、Origin 未知 → 403。
  - `AuthServiceTest`：refresh 不再返回明文 refresh token（返回结构调整）；cookie 语义由 controller 层负责（服务层返回 token 供 cookie 使用）。
  - `BaselineControllerTest`：公开访问 200。
  - production profile fail-closed：RuntimeContextTest 或新增测试——`spring.profiles.active=production` 且缺 `VC_AUTH_ENABLED` 时上下文加载失败；显式 true 时加载成功。

## 明确范围外

- 不修前端（TASK-0103 范围）：auth store localStorage 移除、credentials include、CSRF header 注入、401 生命周期重写、transport 统一（风险 4）。
- 不修 P1-07/P2-14/15/17（frontend realtime）、P2-03/04/13（auth hardening：限流/校验/seed 竞态）、P3-05/06、P2-12、P1-04/05（DB 权限架构）等其余审计项。
- 不改 `**/db/migration/**`、`specs/catalog/**`、`specs/generated/**`、其他 contracts（database-ownership/realtime/beta-gate/license-cost）、`service/platform/**`、JWT 实现（jwt 包只读）、`service/apps/runtime/pom.xml`、`service/apps/runtime/src/main/resources/**`（除 application.yaml）。
- 不删除测试、不加 skip、不吞退出码、不改写历史 Evidence/Handoff/ADR。
- public_api_paths 决策中 http statuses/error envelope 语义（P2-04 相关）不在本卡解析。

## 输入和前置条件

- Base Commit 固定为 `9ae55774533bc455d1ab911dc01ee7a215d510b5`（TASK-0101 ACCEPTED 终态），DRAFT 创建前工作树干净、`activeTask: null`、ledger 无 TASK-0102 条目。
- Context Lock 只绑定 Base Commit 内仓库相对路径；外部审计/交接文档仅作 provenance。
- Owner 决策（2026-08-08 已确认）：P1-09 HttpOnly cookie + CSRF/Origin；P1-08 baseline 公开 permitAll。
- 根级 Maven verify 用 OrbStack docker（maven:3.9-eclipse-temurin-25-alpine + vc-maven-cache volume），记录真实 BUILD SUCCESS/FAILURE。
- Canonical argv 保持机器策略规定的 `python`（受控 venv `~/.zcode/venvs/vc-harness/bin/python`，PATH 前缀）；每次 doctor/precheck 干净 `TMPDIR=$(mktemp -d ...)`。
- 本卡触碰 `specs/contracts/**`（C3 保护路径，requiredSkill=contract-change）：使用 contract-change skill 1.0.0、Owner 人工批准（humanApprovals 已预填 task-assignment + contract-change）、独立 Reviewer。

## API / 事件 / 数据契约

- `POST /api/v1/auth/login`：请求不变；响应体移除 `refreshToken`（保留 accessToken/tokenType/expiresInSeconds/accountId/role）；`Set-Cookie: vc_refresh`（HttpOnly; SameSite=Lax; Secure 默认 true; Path=/api/v1/auth; Max-Age=refresh-token-ttl）+ `Set-Cookie: vc_csrf`（非 HttpOnly，随机）。
- `POST /api/v1/auth/refresh`：请求体移除 `refreshToken`；从 `vc_refresh` cookie 读取；成功 → 新 access token 响应 + vc_refresh/vc_csrf cookie 轮换（V14 rotate 语义保持：旧 refresh 失效、唯一 live successor）；cookie 缺失/无效 → 401 AUTHENTICATION_REQUIRED。
- `POST /api/v1/auth/logout`、`POST /api/v1/auth/admin/accounts`：带会话 cookie 时要求 `X-CSRF-Token` == `vc_csrf`（double-submit）且 Origin 命中 allowlist；Bearer-only 无 cookie 不强制 CSRF token。
- `GET /api/internal/baseline`：公开（permitAll），匿名 200。
- 无 DB schema/迁移变更；JWT 结构与签发逻辑不变。
- 前端消费方（TASK-0103）按本契约改造 auth store/transport。

## 权限、RLS 和数据处理要求

- 不接触真实用户数据/凭据；测试使用合成账号（AuthServiceTest 既有 fixture）。
- refresh token 只进 HttpOnly cookie（JS 不可读）与既有 DB hash 存储；`vc_csrf` 非 HttpOnly 但仅为随机值（无凭据语义）。
- cookie 属性：`HttpOnly; SameSite=Lax; Path=/api/v1/auth; Secure` 默认 true（本地 http 开发经 `VC_AUTH_COOKIE_SECURE=false` 配置，非生产）；CSRF 校验用常量时间比较。
- Origin 校验复用 `virtual-companion.auth.cors-allowed-origins` allowlist（未知 Origin 拒绝），不新增凭据/密钥到日志或仓库。

## 状态机和失败行为

- baseline：认证开/关均 200（公开）；其他端点认证开启时匿名 401（AUTHENTICATION_REQUIRED），关闭时（auth.enabled=false）Security 链不激活（既有语义）。
- refresh：cookie 缺失/无效 → 401；轮换并发/重复由 V14 rotate 幂等语义保持（TASK-0099 已闭环）；响应不含明文 refresh token。
- CSRF：带会话 cookie 的写操作——缺 header/不匹配 → 403（常量时间比较）；Origin 未知 → 403；Bearer-only 无 cookie → 不强制 CSRF（Origin 校验保持）。
- production profile：缺 `VC_AUTH_ENABLED`/`VC_AUTH_DATASOURCE_ENABLED` → 占位符解析失败 → 启动失败（fail-closed）；显式设置 → 正常启动。
- 任一测试失败保持非零退出并如实记录；remote CI 在 Actions 配额耗尽下如实记录非 PASS（TASK-0095..0101 先例），本地等价验证（根级 Maven verify + canonical precheck）为备用通道（Owner 既有授权）。

## 模型、Prompt、记忆和安全边界

- 不修改模型、Prompt、记忆、SafetyGate；不引入新依赖、SaaS 或付费运行时。
- CSRF 校验与 cookie 逻辑不触碰 RLS/租户隔离（INV-TENANT-001 语义不变）；不向任何角色授予新权限。
- 不把 token/cookie 值写入日志、URL 或模型上下文（与契约 privacyBoundary 一致）。

## 验收标准

1. **P1-08 baseline 公开**：`auth.enabled=true` 集成测试中 `GET /api/internal/baseline` 匿名返回 200；`GET /api/v1/...` 其余端点匿名仍 401 AUTHENTICATION_REQUIRED。
2. **P1-09 后端 cookie**：login/refresh 响应 `Set-Cookie: vc_refresh`（HttpOnly + SameSite=Lax + Secure 默认 true + Path=/api/v1/auth）；响应体不含 refreshToken；refresh 从 cookie 轮换成功且旧 token 失效（V14 rotate 语义保持）；无 cookie refresh → 401。
3. **CSRF/Origin**：带 `vc_refresh`/`vc_csrf` 会话 cookie 的写操作——无 `X-CSRF-Token` 或值与 `vc_csrf` 不匹配 → 403；匹配 → 成功；Origin 不在 allowlist → 403；Bearer-only 无 cookie 请求不被 CSRF 阻断（Origin 校验保持）。
4. **风险 3 production fail-closed**：`spring.profiles.active=production` 且未设 `VC_AUTH_ENABLED`/`VC_AUTH_DATASOURCE_ENABLED` → 上下文加载失败；显式 true → 加载成功（测试证明）。
5. **契约同步**：identity-session-boundary-contract.yaml 更新（cookie 决策解析、refresh 响应/请求字段、baseline 公开路径）；`precheck` 内 catalogValidate/catalogDrift PASS；契约字段与实现/测试一致。
6. **交付闭环**：Diff 仅含 writeAllowlist；根级 Maven verify（docker JDK 25）BUILD SUCCESS；canonical Precheck 全 PASS；独立 Reviewer 通过；remote 按配额受限如实记录（非 PASS，passClaimed=false）；Handoff `nextAction` 与终态 project-state 逐字一致；origin/main `0/0`。

## 必跑检查

以 YAML `requiredCommands` 的精确 argv 为准。Canonical Precheck 只运行一次；根级 Maven verify（docker JDK 25，vc-maven-cache）是任务特有后端门禁（precheck 不含 Maven），只运行一次并记录真实 BUILD SUCCESS/FAILURE；`git diff --check` 只运行一次。所有命令记录真实状态、退出码、验证 Commit/Tree、容器/解释器与环境身份。

## 回滚或前向修复

- 修复采用最小实现与测试变更；若根级 verify 失败，先确认失败集合是否超出本卡范围，超范围即停止并报告。
- R1 如有阻塞发现，最多一个 fix batch；R2 只验证 finding closure、delta、adjacent risk 和新 P0/P1，禁止第三轮。
- 无持久数据变更（无迁移）；回滚 = 修正文件后重跑根级 verify 与 precheck。
- READY 后如需增加路径或改变条款，只能停止并走 Backlog 强类型 Owner amendment（本卡为 C3；若出现该需求应停止并询问 Owner）。

## 停止条件

- 需要修改 writeAllowlist 外路径（如其余 contracts、specs/catalog、JWT 实现、pom、frontend/**、.harness/** 机器真源等）时立即停止并询问 Owner。
- 前端接线（auth store/transport/页面）超出本卡范围——属 TASK-0103，不得在本卡实施。
- CSRF/cookie 语义需要改变 Owner 决策（HttpOnly cookie + CSRF/Origin、baseline permitAll）时停止并询问 Owner。
- Context、Owner 批准、Skill、白名单、候选身份、Reviewer、canonical、remote exact-SHA 任一缺失或失败，立即失败关闭并按 lifecycle 转 BLOCKED/REJECTED。
- 90 分钟 hard fuse 到达后停止实现、修复、Reviewer、canonical 和 CI；若仓库已活动，仅允许按策略做 closure-only overrun。

## Evidence Pack

输出 `docs/evidence/TASK-0102/evidence-pack.json`、`pre-closure-request.json`、
`review-r1.md`/必要的 `review-r2.md`，并生成 `docs/handoffs/TASK-0102.json`。所有 PASS
绑定真实候选 Commit/Tree、精确 argv、容器/解释器、环境、Reviewer 和 remote exact-SHA；
Handoff `nextAction` 与终态 project-state 逐字一致。

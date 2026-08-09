# TASK-0112：Auth 输入、错误与身份最小化闭环（P2-04 + P3-05 + P3-06）

```yaml
taskId: TASK-0112
state: DRAFT
owner: repository-owner
riskClass: C3
requiredSkills:
  - task-delivery-flow
  - task-intake
  - catalog-change
  - contract-change
requiredSkillVersions:
  task-delivery-flow: "1.3.7"
  task-intake: "1.2.7"
  catalog-change: "1.0.0"
  contract-change: "1.0.0"
targetSkillVersions: {}
baseCommit: 9bfd47eea55aa2a485c77617a2581924d69dbe84
authorizationCommit: ""
contextFingerprint: 309f100ff8f03e713f7a2ae4eea52ff1386e5a2054a8ef801df2df6374a0090c
contextLock: docs/tasks/context/TASK-0112.context-lock.yaml
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
  surfaceId: TASK_0112_AUTH_INPUT_HYGIENE
  policySurfaces: [AUTHORIZATION]
  distinctCrossRiskSurfaces: 1
  reviewerMinutesEstimate: 15
  terminalCheckMinutesEstimate: 20
  estimatedWallMinutes: 85
  thresholdsTriggered: []
  splitRequired: false
  ownerIndivisibleAuthorization: false
validationPlan: {frozenBefore: READY, policySource: .harness/ci-execution-policy.yaml, selectedChannel: LOCAL_EXACT_TREE_FALLBACK, profile: precheck}
readAllowlist:
  - docs/tasks/TASK-0111-auth-input-hygiene.md
  - docs/tasks/context/TASK-0111.context-lock.yaml
  - docs/evidence/TASK-0111/evidence-pack.json
  - docs/evidence/TASK-0111/pre-closure-request.json
  - docs/evidence/TASK-0111/review-r1.md
  - docs/evidence/TASK-0111/review-r2.md
  - docs/handoffs/TASK-0111.json
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
  - docs/evidence/TASK-0109/zcode-remediation-handoff.md
  - docs/tasks/TASK-0110-provider-response-early-limits.md
  - docs/tasks/context/TASK-0110.context-lock.yaml
  - docs/evidence/TASK-0110/evidence-pack.json
  - docs/evidence/TASK-0110/remote-exact-sha.json
  - docs/handoffs/TASK-0110.json
  - skills/task-intake/SKILL.md
  - skills/task-delivery-flow/SKILL.md
  - skills/catalog-change/SKILL.md
  - skills/contract-change/SKILL.md
  - scripts/harness/catalog_tool.py
  - scripts/dev/openapi_tool.py
  - specs/catalog/catalog-manifest.yaml
  - specs/catalog/error-codes.yaml
  - specs/contracts/identity-session-boundary-contract.yaml
  - specs/openapi/virtual-companion.yaml
  - specs/generated/catalog.snapshot.json
  - specs/generated/java/com/virtualcompanion/catalog/ErrorCode.java
  - specs/generated/openapi/catalog-schemas.yaml
  - specs/generated/sql/catalog-values.sql
  - specs/generated/typescript/catalog.ts
  - specs/openapi/dist/api-bundle.yaml
  - specs/openapi/dist/java/com/virtualcompanion/api/AdminCreateAccountRequest.java
  - specs/openapi/dist/java/com/virtualcompanion/api/ErrorCode.java
  - specs/openapi/dist/openapi.snapshot.json
  - specs/openapi/dist/typescript/api.ts
  - service/apps/runtime/pom.xml
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/web/AuthRequests.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/web/AuthController.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/web/AuthExceptionHandler.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/web/ErrorEnvelope.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/web/AuthErrorException.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/application/AuthService.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/AdminSeedRunner.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/jwt/JwtTokenService.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/application/AuthServiceTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/web/AuthControllerCookieTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/config/AuthSecurityIntegrationTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/jwt/JwtAuthenticationFilterTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/jwt/JwtTokenServiceTest.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/IdentityAccountRepository.java
  - service/platform/persistence/src/main/resources/db/migration/V14__identity_accounts_sessions.sql
writeAllowlist:
  - docs/tasks/TASK-0112-auth-input-hygiene.md
  - docs/tasks/context/TASK-0112.context-lock.yaml
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - docs/evidence/TASK-0112/**
  - docs/handoffs/TASK-0112.json
  - specs/catalog/error-codes.yaml
  - specs/contracts/identity-session-boundary-contract.yaml
  - specs/openapi/virtual-companion.yaml
  - specs/generated/catalog.snapshot.json
  - specs/generated/java/com/virtualcompanion/catalog/ErrorCode.java
  - specs/generated/openapi/catalog-schemas.yaml
  - specs/generated/sql/catalog-values.sql
  - specs/generated/typescript/catalog.ts
  - specs/openapi/dist/api-bundle.yaml
  - specs/openapi/dist/java/com/virtualcompanion/api/AdminCreateAccountRequest.java
  - specs/openapi/dist/java/com/virtualcompanion/api/ErrorCode.java
  - specs/openapi/dist/openapi.snapshot.json
  - specs/openapi/dist/typescript/api.ts
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/web/AuthRequests.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/web/AuthController.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/web/AuthExceptionHandler.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/web/ErrorEnvelope.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/web/AuthErrorException.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/application/AuthService.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/AdminSeedRunner.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/application/AuthServiceTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/web/AuthControllerCookieTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/web/AuthControllerValidationTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/config/AdminSeedRunnerTest.java
forbiddenPaths:
  - docs/tasks/TASK-0111-auth-input-hygiene.md
  - docs/tasks/context/TASK-0111.context-lock.yaml
  - docs/evidence/TASK-0111/**
  - docs/handoffs/TASK-0111.json
  - .gitattributes
  - AGENTS.md
  - CLAUDE.md
  - .github/**
  - ci/**
  - requirements-harness.txt
  - scripts/**
  - skills/**
  - docs/schemas/**
  - docs/tasks/task-card-template.md
  - docs/tasks/TASK-0102-backend-session-boundary.md
  - docs/tasks/TASK-0110-provider-response-early-limits.md
  - docs/tasks/context/TASK-0110.context-lock.yaml
  - docs/evidence/TASK-0102/**
  - docs/evidence/TASK-0109/**
  - docs/evidence/TASK-0110/**
  - docs/handoffs/TASK-0102.json
  - docs/handoffs/TASK-0110.json
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
  - specs/catalog/catalog-manifest.yaml
  - specs/catalog/age-states.yaml
  - specs/catalog/data-categories.yaml
  - specs/catalog/generation-states.yaml
  - specs/catalog/memory-candidate-statuses.yaml
  - specs/catalog/memory-item-statuses.yaml
  - specs/catalog/memory-scopes.yaml
  - specs/catalog/message-states.yaml
  - specs/catalog/model-protocols.yaml
  - specs/catalog/processing-purposes.yaml
  - specs/catalog/product-scope.yaml
  - specs/catalog/provider-attempt-statuses.yaml
  - specs/catalog/realtime-events.yaml
  - specs/catalog/risk-levels.yaml
  - specs/catalog/route-decision-statuses.yaml
  - specs/catalog/safety-classifier-outcomes.yaml
  - specs/catalog/service-modes.yaml
  - specs/contracts/authorization-contract.yaml
  - specs/contracts/beta-gate-contract.yaml
  - specs/contracts/database-ownership-contract.yaml
  - specs/contracts/finalization-contract.yaml
  - specs/contracts/generation-contract.yaml
  - specs/contracts/license-cost-boundary-contract.yaml
  - specs/contracts/memory-contract.yaml
  - specs/contracts/model-protocol-contract.yaml
  - specs/contracts/realtime-contract.yaml
  - "**/db/migration/**"
  - service/modules/**
  - service/adapters/**
  - service/tests/**
  - service/platform/**
  - service/apps/runtime/pom.xml
  - service/apps/runtime/src/main/resources/**
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/jwt/**
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/tenant/**
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/AuthDataSourceConfig.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/AuthSecurityConfig.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/CookieCsrfGuardFilter.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/jwt/**
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/tenant/**
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/config/AuthSecurityIntegrationTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/baseline/**
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/baseline/**
  - frontend/**
  - infra/**
  - mvnw
  - mvnw.cmd
  - pom.xml
sourcesOfTruth:
  - docs/tasks/TASK-0111-auth-input-hygiene.md
  - docs/tasks/context/TASK-0111.context-lock.yaml
  - docs/evidence/TASK-0111/evidence-pack.json
  - docs/evidence/TASK-0111/review-r1.md
  - docs/evidence/TASK-0111/review-r2.md
  - docs/handoffs/TASK-0111.json
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
  - skills/catalog-change/SKILL.md
  - skills/contract-change/SKILL.md
  - specs/catalog/error-codes.yaml
  - specs/contracts/identity-session-boundary-contract.yaml
  - specs/openapi/virtual-companion.yaml
  - docs/evidence/TASK-0109/zcode-remediation-handoff.md
  - docs/evidence/TASK-0110/remote-exact-sha.json
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
requiredInvariants:
  - INV-TENANT-001
  - INV-HARNESS-002
  - INV-HARNESS-003
  - INV-HARNESS-005
  - INV-HARNESS-007
  - INV-HARNESS-009
humanApprovals:
  - scope: task-assignment
    approvedBy: repository-owner
    approvedAt: "2026-08-09"
    sourceThreadId: codex-audit-fix-20260809
    evidence: >-
      Owner 明确要求 Codex 接管当前项目审计与修复，并要求“不用询问我，作为长线任务跑下去”。
      本卡按 TASK-0111 Handoff 的唯一下一动作重新执行 P2-04/P3-05/P3-06；授权在不触碰数据库
      migration、认证架构、限流/锁定或密码最低策略的前提下，采用保守、可回滚的输入卫生实现。
  - scope: auth-validation-catalog-contract
    approvedBy: repository-owner
    approvedAt: "2026-08-09"
    sourceThreadId: codex-audit-fix-20260809
    evidence: >-
      为避免把 400 请求错误错误映射到现有认证/授权/存在性隐藏 Code，按 Owner 的长线自主推进授权
      追加稳定 INVALID_REQUEST Catalog Code（只追加 ordinal 15，不重排既有值），同步 identity contract
      与 OpenAPI；冻结 username 128、password 1024、displayName 256、role 16 的 Bean Validation
      字符上限。这些上限只用于把畸形/过长字段稳定映射为 400，不代表关闭 P2-03 的请求体字节上限、
      login/refresh 限流、退避/锁定、密码最低策略或审计保留决策。
  - scope: local-exact-tree-fallback
    approvedBy: repository-owner
    approvedAt: "2026-08-09"
    sourceThreadId: codex-audit-fix-20260809
    evidence: >-
      Owner 要求长线不中断推进；TASK-0102/TASK-0108 已记录同一 2026-08 配额周期的
      OWNER_SUPPLIED_QUOTA_EXHAUSTED（includedMinutes=usedMinutes=2000、paidBudgetUsd=0、
      stopUsageEnabled=true、dispatchCount=0），TASK-0110 的 2026-08-09 exact-SHA run
      31286798584 又在无 runner、零 step 状态终止。远端继续如实为非 PASS；本卡冻结
      LOCAL_EXACT_TREE_FALLBACK，只对记录的本机 Commit/Tree/命令覆盖声明 PASS。
independentReview: required
reviewers: []
requiredCommands:
  - python scripts/harness/precheck.py --task TASK-0112
  - docker run --rm -v /Users/hxf/projects/virtual-companion:/workspace -v vc-maven-cache:/root/.m2 -w /workspace maven:3.9-eclipse-temurin-25-alpine ./mvnw --batch-mode --no-transfer-progress verify
  - python scripts/dev/openapi_tool.py validate
  - python scripts/dev/openapi_tool.py diff --fail-on-drift
  - git diff --check
```

> 本卡为独立延续单卡，不写 planningBacklog/planningContractHash；永久 ID 已核对未占用。P2-04 的
> 400 Code 不能复用认证/授权/存在性隐藏 Code，因此本卡按 C3 使用 catalog-change + contract-change，
> 只追加 `INVALID_REQUEST` 并确定性再生对应 Catalog/OpenAPI 产物。TASK-0111 的 intake 失败与 TASK-0110 的 Provider early-limit REJECTED 历史均保持不变。

## 背景与用户可观察目标

当前 Auth JSON 入口没有 Bean Validation：缺失/空/畸形 body 由 Spring 默认处理或进入 service 后映射为
404，响应不总是统一 `ErrorEnvelope`；超长字段可以进入 BCrypt/JDBC 路径。登录、建号和 seed 又分别把
raw、lower-only 与数据库 trim/lower 的 username 送往 repository、审计、JWT 和响应，身份表示不一致。
`AdminSeedRunner` 还会把 account id 写入普通应用日志。

完成后，login/admin-account 的畸形 JSON、JSON null、缺 body、`{}`、空白字段和超过冻结上限的字段均以
`400 INVALID_REQUEST` 的固定非敏感 envelope 失败，AuthService 不被调用；合法 username 在登录、建号、
seed、repository、审计、JWT claim 与响应中统一为 `trim + lower(Locale.ROOT)`；普通日志不再包含任何账户标识。

## 范围内

- 在 Error Code Catalog 末尾追加 `INVALID_REQUEST`（ordinal 15），确定性再生五个 Catalog 产物。
- 在 identity session contract 与 OpenAPI 同步 400 语义、字段约束和新增 Error Code，并用生成器再生
  OpenAPI dist；既有 Error Code 值和 ordinal 不变。
- `LoginRequest`：username/password 必填非空白，最大长度分别 128/1024。
- `CreateAccountRequest`：username/password/displayName 必填非空白，最大长度分别 128/1024/256；role
  可选，非空时仅允许 ADMIN/USER（忽略大小写），最大 16。
- `AuthController` 使用 `@Valid`；`AuthExceptionHandler` 将 validation 与 unreadable JSON 统一映射为
  `400 {"code":"INVALID_REQUEST","message":"The request is invalid"}`，不回显字段名、值或解析细节。
- AuthService 对直接调用保留等价 fail-closed 校验，并让 canonical username 同时进入 authenticate、
  login audit、account create/seed、JWT username claim 与 account response；密码保持原样，displayName 只 trim。
- `AdminSeedRunner` 只记录 ensured/skipped 结果，不记录 account id、username、displayName、密码、token 或 hash。
- 增加 standalone MockMvc、service normalization 和日志捕获测试。

## 明确范围外

- 不修改 V14 或任何 migration、repository、JWT 实现、SecurityFilterChain、Cookie/CSRF、前端或认证架构。
- 不解决 P2-03：不设总 request-body/refresh-token 字节上限，不实现 IP/账号/设备限流、退避、锁定、
  密码最低强度或审计聚合/保留。
- 不解决 P2-13 admin seed 并发；不改变单/多 ADMIN 产品语义。
- 不修正 OpenAPI 的其他既有能力漂移，不宣称关闭 P3-01；只同步本卡新增 Code、字段 required/limit。
- 不修改 TASK-0102、TASK-0109、TASK-0110、TASK-0111 的历史 Task/Evidence/Handoff。

## 输入和前置条件

Base 为 TASK-0111 REJECTED 终态 `9bfd47eea55aa2a485c77617a2581924d69dbe84`，仓库在 DRAFT 前与
`origin/main` 0/0 且工作树干净，无活动任务。Context Lock 只绑定 Base Commit 中的机器真源、前序 Auth
合同与实现、审计 Handoff、TASK-0111 闭包证据、TASK-0110 远端不可用证据、生成器和相关测试。

## API / 事件 / 数据契约

- `INVALID_REQUEST` 是向后兼容追加值，ordinal 固定为 15；既有值不重排、不复用、不改语义。
- validation/unreadable JSON 的 HTTP 状态固定 400，body 固定只含非敏感 `code` 与 `message`。
- username canonical form 固定为 `lower(trim(value), Locale.ROOT)`；password 永不 trim/lower；displayName
  trim 后传入既有数据库函数；role 保持 ADMIN/USER canonical uppercase。
- 不改变成功响应字段、cookie、JWT subject（仍为 account id）、token TTL 或数据库 schema。

## 权限、RLS 和数据处理要求

- principal/account id 仍只来自服务端验证上下文，客户端字段不能成为 owner 身份源（INV-TENANT-001）。
- 普通应用日志禁止 account id、username、displayName、密码、access/refresh token 和 hash；数据库内既有
  identity audit sink 保持不变且只接收 canonical username。
- Validation handler 不记录/返回绑定错误对象、raw JSON、异常消息或 rejected value。

## 状态机和失败行为

- 请求解析或字段校验失败时在 controller 边界返回 400，AuthService/repository/BCrypt 均不执行。
- service 被测试或非 Web 调用直接传入无效值时同样抛出 `AuthErrorException(400, INVALID_REQUEST)`。
- 已通过结构校验但凭据错误/账号不存在/disabled/非 ADMIN/重复账号继续保持既有不泄密语义。
- Catalog/OpenAPI 生成或 drift 校验失败时停止，不手改生成物规避。

## 模型、Prompt、记忆和安全边界

本卡不接触模型、Prompt、记忆、Provider 或真实凭据。测试只使用合成用户名、密码和 token 字符串；日志
断言必须证明这些哨兵值及合成 account id 均未出现。

## 验收标准

1. login 和 admin create 对缺 body、JSON `null`、malformed JSON、`{}`、null/blank 必填字段及每个 one-over
   字段均返回 400；body 精确含 `INVALID_REQUEST` 与固定消息，不含字段名、rejected value 或解析细节。
2. 上述失败路径 `AuthService` 零调用；合法请求和既有 cookie 行为不回归。
3. `"  Alice  "` 登录时 authenticate、success/failure audit 与 JWT username 均为 `alice`；密码字节/字符
   保持原样，不被 trim。
4. `"  Bob  "` 建号/seed 时 repository、响应与后续 JWT 语义使用 `bob`；displayName 只 trim；role canonical。
5. Admin seed ensured/skipped 日志不含 account id、username、displayName、密码、token 或 hash 哨兵值。
6. Error Catalog 只在末尾新增 ordinal 15；Catalog 五个生成物和 OpenAPI dist 均由注册工具确定性生成且 drift PASS。
7. 定向 runtime reactor 测试全部 PASS；根级 Maven verify、canonical Precheck、两条 OpenAPI gate 和唯一
   `git diff --check` 均绑定 Reviewer PASS 后的同一候选 Commit/Tree。
8. 不修改 writeAllowlist 外路径；migration、JWT、repository、前端、其他合同和历史制品保持不变。

## 必跑检查

以 YAML `requiredCommands` 的精确 argv 为准。定向 runtime 测试属于实现迭代，不冒充正式 Evidence：
`./mvnw --batch-mode --no-transfer-progress -pl service/apps/runtime -am -Dtest=AuthServiceTest,AuthControllerCookieTest,AuthControllerValidationTest,AdminSeedRunnerTest,AuthSecurityIntegrationTest,JwtAuthenticationFilterTest,JwtTokenServiceTest -Dsurefire.failIfNoSpecifiedTests=false test`。
正式命令只在独立 Reviewer PASS 后对同一冻结候选执行；canonical Precheck 和根 Maven 各一次，两条 OpenAPI
命令各一次，`git diff --check` 只执行一次，记录真实退出码与输出哈希。

## 回滚或前向修复

候选未验收前可在唯一 fix batch 前向修复；不得重排/删除已发布 Error Code。若新增 Code 或字段限制导致
兼容问题，只能新建永久任务追加兼容策略或放宽到经 Owner 授权的新边界，不能改写本卡 Evidence 或历史提交。

## 停止条件

- 需要改变认证架构、数据库 schema/migration、JWT subject、Cookie/CSRF、限流/锁定或密码最低策略。
- 需要修改未列入 writeAllowlist 的 Catalog/Contract/OpenAPI/生成物，或生成器产生意外额外路径。
- 发现 username canonical form 与外部身份提供方/历史账号有不可判定兼容冲突。
- READY Doctor、Reviewer、canonical、exact-tree 或 pre-closure 任一非 PASS；按机器策略如实转 BLOCKED/REJECTED。

## Evidence Pack

输出 `docs/evidence/TASK-0112/`（候选身份、R1/R2、定向与正式命令、Catalog/OpenAPI diff、远端非 PASS 和
本地 exact-tree 限定覆盖）及 `docs/handoffs/TASK-0112.json`，终态原子更新 Task/Project State/Ledger。

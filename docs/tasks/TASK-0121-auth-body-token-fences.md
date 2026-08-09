# TASK-0121：Auth 请求体与 Cookie Token 字节边界

```yaml
taskId: TASK-0121
state: ACCEPTED
terminalStateReason: >-
  Auth login/admin-account 已在 JSON 物化前执行 16384-byte raw body fence，字段与
  vc_refresh 分别在 BCrypt、hash、JDBC、JWT 和 successor 生成前执行冻结的 UTF-8 byte
  fence；cookie-only identity/OpenAPI 契约和确定性生成物已经同步。独立 R1 对候选
  a5722a37/2e19cb31 完整复核 PASS，最终 P0/P1/P2/P3=0；canonical 5/5、定向 82 tests、
  OpenAPI validate/drift、根级 623 tests 与唯一次 git diff --check 全部 PASS。Remote
  exact-SHA 未运行且不声称 PASS，LOCAL_EXACT_TREE_FALLBACK 只绑定记录的候选和本机环境。
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
baseCommit: 7188d27df49bcd624f6017c6ff71ad8ebbc3e0ad
authorizationCommit: 1a558bd44ddbd0b75be11e871d9069ab25767b5d
contextFingerprint: 4d149ba1b4cfd75c37e88141157e402bdc0bd9f6ab4efc4d5286395111a73d26
contextLock: docs/tasks/context/TASK-0121.context-lock.yaml
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
  surfaceId: TASK_0121_AUTH_BODY_TOKEN_FENCES
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
  - .gitattributes
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
  - AGENTS.md
  - CLAUDE.md
  - docs/evidence/TASK-0109/zcode-remediation-handoff.md
  - docs/evidence/TASK-0112/evidence-pack.json
  - docs/evidence/TASK-0112/review-r1.md
  - docs/evidence/TASK-0120/evidence-pack.json
  - docs/evidence/TASK-0120/review-r1.md
  - docs/evidence/TASK-0120/review-r2.md
  - docs/handoffs/TASK-0112.json
  - docs/handoffs/TASK-0120.json
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
  - docs/tasks/TASK-0112-auth-input-hygiene.md
  - docs/tasks/TASK-0120-openai-sse-raw-budget.md
  - docs/tasks/context/TASK-0112.context-lock.yaml
  - docs/tasks/context/TASK-0120.context-lock.yaml
  - docs/tasks/task-card-template.md
  - pom.xml
  - requirements-harness.txt
  - scripts/dev/openapi_tool.py
  - service/apps/runtime/pom.xml
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/application/AuthService.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/application/RefreshTokens.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/AuthDataSourceConfig.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/AuthSecurityConfig.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/CookieCsrfGuardFilter.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/jwt/JwtAuthenticationFilter.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/web/AuthController.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/web/AuthErrorException.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/web/AuthExceptionHandler.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/web/AuthRequests.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/web/AuthResponses.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/web/ErrorEnvelope.java
  - service/apps/runtime/src/main/resources/application.yaml
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/application/AuthServiceTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/config/AuthSecurityIntegrationTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/web/AuthControllerCookieTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/web/AuthControllerValidationTest.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/IdentityAccountRepository.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/IdentityRefreshTokenRepository.java
  - service/platform/persistence/src/main/resources/db/migration/V14__identity_accounts_sessions.sql
  - skills/contract-change/SKILL.md
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
  - specs/catalog/error-codes.yaml
  - specs/contracts/authorization-contract.yaml
  - specs/contracts/identity-session-boundary-contract.yaml
  - specs/openapi/dist/api-bundle.yaml
  - specs/openapi/dist/java/com/virtualcompanion/api/AuthTokenResponse.java
  - specs/openapi/dist/java/com/virtualcompanion/api/LogoutRequest.java
  - specs/openapi/dist/java/com/virtualcompanion/api/RefreshTokenRequest.java
  - specs/openapi/dist/openapi.snapshot.json
  - specs/openapi/dist/typescript/api.ts
  - specs/openapi/virtual-companion.yaml
writeAllowlist:
  - docs/tasks/TASK-0121-auth-body-token-fences.md
  - docs/tasks/context/TASK-0121.context-lock.yaml
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - docs/evidence/TASK-0121/**
  - docs/handoffs/TASK-0121.json
  - specs/contracts/identity-session-boundary-contract.yaml
  - specs/openapi/virtual-companion.yaml
  - specs/openapi/dist/api-bundle.yaml
  - specs/openapi/dist/java/com/virtualcompanion/api/AuthTokenResponse.java
  - specs/openapi/dist/java/com/virtualcompanion/api/LogoutRequest.java
  - specs/openapi/dist/java/com/virtualcompanion/api/RefreshTokenRequest.java
  - specs/openapi/dist/openapi.snapshot.json
  - specs/openapi/dist/typescript/api.ts
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/application/AuthService.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/AuthRequestBodyLimitFilter.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/AuthSecurityConfig.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/web/AuthInputLimits.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/web/AuthRequests.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/application/AuthServiceTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/config/AuthRequestBodyLimitFilterTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/config/AuthSecurityIntegrationTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/web/AuthControllerValidationTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/web/AuthInputLimitsTest.java
forbiddenPaths:
  - docs/tasks/TASK-0109-*
  - docs/tasks/TASK-011*-*
  - docs/tasks/TASK-0120-*
  - docs/tasks/context/TASK-0109.context-lock.yaml
  - docs/tasks/context/TASK-011*.context-lock.yaml
  - docs/tasks/context/TASK-0120.context-lock.yaml
  - docs/evidence/TASK-0109/**
  - docs/evidence/TASK-011*/**
  - docs/evidence/TASK-0120/**
  - docs/handoffs/TASK-0109.json
  - docs/handoffs/TASK-011*.json
  - docs/handoffs/TASK-0120.json
  - .gitattributes
  - AGENTS.md
  - CLAUDE.md
  - .github/**
  - ci/**
  - requirements-harness.txt
  - scripts/**
  - skills/**
  - docs/schemas/**
  - docs/source/**
  - docs/decisions/**
  - docs/planning/**
  - docs/tasks/task-card-template.md
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
  - specs/contracts/beta-gate-contract.yaml
  - specs/contracts/database-ownership-contract.yaml
  - specs/contracts/finalization-contract.yaml
  - specs/contracts/generation-contract.yaml
  - specs/contracts/license-cost-boundary-contract.yaml
  - specs/contracts/memory-contract.yaml
  - specs/contracts/model-protocol-contract.yaml
  - specs/contracts/realtime-contract.yaml
  - specs/openapi/dist/java/com/virtualcompanion/api/VirtualCompanionApi.java
  - "**/db/migration/**"
  - service/platform/**
  - service/modules/**
  - service/adapters/**
  - service/tests/**
  - service/apps/runtime/pom.xml
  - service/apps/runtime/src/main/resources/**
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/application/RefreshTokens.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/AdminSeedRunner.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/AuthDataSourceConfig.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/CookieCsrfGuardFilter.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/jwt/**
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/tenant/**
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/web/AuthController.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/web/AuthErrorException.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/web/AuthExceptionHandler.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/web/AuthResponses.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/web/ErrorEnvelope.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/jwt/**
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/tenant/**
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/web/AuthControllerCookieTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/config/AdminSeedRunnerTest.java
  - frontend/**
  - infra/**
  - .mvn/**
  - pom.xml
  - mvnw
  - mvnw.cmd
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
  - specs/catalog/error-codes.yaml
  - specs/contracts/identity-session-boundary-contract.yaml
  - specs/openapi/virtual-companion.yaml
  - docs/evidence/TASK-0109/zcode-remediation-handoff.md
  - docs/tasks/TASK-0112-auth-input-hygiene.md
  - docs/evidence/TASK-0112/evidence-pack.json
  - docs/handoffs/TASK-0112.json
  - docs/tasks/TASK-0120-openai-sse-raw-budget.md
  - docs/evidence/TASK-0120/evidence-pack.json
  - docs/evidence/TASK-0120/review-r2.md
  - docs/handoffs/TASK-0120.json
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
    sourceThreadId: 019fdf92-9c99-7400-a2ea-d490ef3d7e15
    evidence: >-
      Owner 明确要求 Codex 接管当前项目全部审计与修复，更新当前会话 Goal，并要求
      “不用询问我，作为长线任务跑下去”。TASK-0120 Handoff 与 project-state 的唯一
      下一动作逐字指定通过 task-intake 创建 TASK-0121；本卡不追溯改写历史任务。
  - scope: auth-raw-body-field-and-cookie-token-byte-fences
    approvedBy: repository-owner
    approvedAt: "2026-08-09"
    sourceThreadId: 019fdf92-9c99-7400-a2ea-d490ef3d7e15
    evidence: >-
      Owner 长线授权把低风险工程数值、拆卡、实现与验证细节交由 Codex 按机器真源和最小风险原则
      决定；已接受的 TASK-0120 nextAction 精确冻结 login/admin-account 原始请求体 16384 bytes、
      username/password/displayName/role UTF-8 上限 512/4096/1024/64 bytes，以及 vc_refresh
      cookie 512 bytes。请求体须在 JSON 物化前拒绝，字段与 token 须在 BCrypt/hash/JDBC 前
      拒绝，并保持 INVALID_REQUEST/AUTHENTICATION_REQUIRED 失败语义。
  - scope: local-exact-tree-fallback
    approvedBy: repository-owner
    approvedAt: "2026-08-09"
    sourceThreadId: 019fdf92-9c99-7400-a2ea-d490ef3d7e15
    evidence: >-
      Owner 要求长线不中断推进；TASK-0102/TASK-0108 已记录同一配额周期 includedMinutes=
      usedMinutes=2000、paidBudgetUsd=0、stopUsageEnabled=true、dispatchCount=0，TASK-0110
      exact-SHA run 31286798584 在无 runner、零 step 状态终止；TASK-0112 至 TASK-0120
      已按同一 READY 冻结 fallback 合规 ACCEPTED。本卡冻结 LOCAL_EXACT_TREE_FALLBACK，
      远端继续如实为非 PASS，PASS 只绑定记录的本机 Commit/Tree 与精确命令覆盖。
independentReview: required
reviewers:
  - id: task0121_r1
    kind: independent-review-gate
    verdict: PASS
    reviewedCommit: a5722a37a7c74be66262fe6c641f54c5f1a1f5d0
    evidencePath: docs/evidence/TASK-0121/review-r1.md
    reason: "R1 完整矩阵复核 PASS：请求体、字段和 token 字节边界均在昂贵操作前失败关闭，cookie-only OpenAPI/生成物同步，治理链及 82 项迭代测试一致；最终 P0/P1/P2/P3=0。"
    candidateTree: 2e19cb3111213cf18eb0425d2468ea85614900ec
requiredCommands:
  - python scripts/harness/precheck.py --task TASK-0121
  - docker run --rm -v /Users/hxf/projects/virtual-companion:/workspace -v vc-maven-cache:/root/.m2 -w /workspace maven:3.9-eclipse-temurin-25-alpine ./mvnw --batch-mode --no-transfer-progress -pl service/apps/runtime -am -Dtest=AuthInputLimitsTest,AuthRequestBodyLimitFilterTest,AuthServiceTest,AuthControllerValidationTest,AuthControllerCookieTest,AuthSecurityIntegrationTest -Dsurefire.failIfNoSpecifiedTests=false test
  - python scripts/dev/openapi_tool.py validate
  - python scripts/dev/openapi_tool.py diff --fail-on-drift
  - docker run --rm -v /Users/hxf/projects/virtual-companion:/workspace -v vc-maven-cache:/root/.m2 -w /workspace maven:3.9-eclipse-temurin-25-alpine ./mvnw --batch-mode --no-transfer-progress verify
  - git diff --check
```

> 本卡是 TASK-0120 终态 Handoff 授权的独立延续卡；Backlog 中没有 TASK-0121，因此不写
> `planningBacklog` 或 `planningContractHash`。本卡只关闭 P2-03 的请求体、字段和 cookie token
> 字节边界，并同步已经落地的 cookie-only Auth 契约，不把限流、锁定或审计治理混入同一风险面。

## 背景与用户可观察目标

当前 login 与 admin-account 虽有字符级 Bean Validation，但在 Servlet/Jackson 读取 JSON 前没有原始
请求体上限；攻击者可用超大 body 消耗内存与解析资源。AuthService 的字段检查只按 Java 字符长度，
`vc_refresh` 仅检查 blank 后就进入 SHA-256 与 JDBC。与此同时，运行时已经只从 HttpOnly cookie 读取
refresh/logout token 且响应不返回 refresh token，OpenAPI 仍错误声明 request body 与响应字段。

完成后，两个 JSON 入口在物化前具有 16384-byte raw fence；所有冻结字段与 `vc_refresh` 在昂贵或持久化
操作前具有 UTF-8 byte fence；超限失败为固定、非敏感的既有 ErrorEnvelope；OpenAPI 与 identity contract
准确表达 cookie-only 会话和字节边界。

## 范围内

- 新增仅覆盖 `POST /api/v1/auth/login` 与 `POST /api/v1/auth/admin/accounts` 的 Servlet filter。
- 按实际读取的原始 bytes 计数；已知 `Content-Length` 与未知/chunked body 均受 16384-byte 上限约束。
- exact body 允许并以 byte-identical wrapper 继续到 MVC；one-over 在 JSON/Jackson 前固定拒绝。
- 冻结 username/password/displayName/role 的 UTF-8 上限为 512/4096/1024/64 bytes；保留现有
  128/1024/256/16 Java 字符上限与规范化语义。
- AuthService 的 login、createAccount 和 seedAdmin 在 BCrypt/JDBC 前执行字段防御性校验；规范化后进入
  repository 的 username/displayName/role 也不得绕过相同 byte fence。
- refresh 与 logout 的 `vc_refresh` 原始 token 冻结为 512 UTF-8 bytes，在 SHA-256、rotate/logout JDBC、
  successor token 生成或 JWT 签发前拒绝。
- body/字段超限复用 `400 INVALID_REQUEST`；token 超限复用 `401 AUTHENTICATION_REQUIRED`；不回显字段、
  长度、token、cookie 或解析细节。
- identity contract 与 OpenAPI 同步：refresh/logout 输入是 required `vc_refresh` cookie，login/refresh
  响应不包含 refresh token；删除不再使用的 request schemas，并由 `openapi_tool.py generate` 确定性再生
  精确 dist 产物。
- 增加 raw exact/one-over、known-length/unknown-length、bounded read/replay、UTF-8 与 no-interaction 测试。

## 明确范围外

- 不实现 login/refresh 限流、IP/账号/设备维度、退避、软/硬锁定、`Retry-After` 或新 429 Code。
- 不新增密码最低长度、复杂度、breach 检查或历史密码策略。
- 不修改审计事件写入、聚合、留存、清理或 PII 规则。
- 不修改数据库 migration、repository、SQL、连接池、事务、token rotation、JWT、Cookie/CSRF/Origin 或租户语义。
- 不限制 Bearer JWT、CSRF header/cookie、普通非 Auth body 或网络层总 header bytes；这些残余不得宣称关闭。
- 不新增 Catalog Code，不修改 `specs/catalog/**` 或 `specs/generated/**`，不使用 `catalog-change`。
- 不修改 OpenAPI generator；除 Auth cookie/body/response 漂移及 byte annotations 外，不修正其他既有 OpenAPI 漂移。
- 不修改 frontend、provider adapter、modelruntime、infra、CI、Harness 或历史任务制品。

## 输入和前置条件

- Base 固定为 TASK-0120 已推送且远端 0/0 的终态 `7188d27df49bcd624f6017c6ff71ad8ebbc3e0ad`。
- Context Lock 只读取 Base Commit 中的 71 个仓库相对输入，按
  `SHA256_ORDINAL_SORTED_PATH_EQUALS_HASH_LF_V1` 复算。
- TASK-0120 已 ACCEPTED、Evidence/Handoff 完整、独立 R2 PASS、远端 0/0，满足 longline 下一卡条件。
- `specs/contracts/**` 触发 C3 `contract-change@1.0.0` 与独立 Reviewer；本卡没有 C4 路径或 migration。
- OpenAPI source 是 `specs/openapi/virtual-companion.yaml`；`specs/openapi/dist/**` 只能由
  `python scripts/dev/openapi_tool.py generate` 产生，删除的生成文件也必须保留在 Diff Scope 中。

## API / 事件 / 数据契约

- 生产者：浏览器/客户端提供 login/admin JSON 与 `vc_refresh` cookie；runtime filter/controller/service 生产
  固定错误或受控 Auth 调用。
- 消费者：Servlet/Jackson、AuthService、BCrypt、identity repositories，以及从 OpenAPI 生成的 Java/TS 客户端。
- 原始 body 上限按 HTTP entity 的实际 bytes 计算，不按字符、字段、`Content-Length` 声明或解码后 JSON 计算。
- 字段与 cookie 上限按 Java String 的 UTF-8 编码 bytes 计算；不 trim/clamp/truncate 超限值。
- OpenAPI 用 cookie parameter 表达 refresh/logout；用 `x-utf8-max-bytes` 与描述表达无法由标准 `maxLength`
  单独表达的 UTF-8 byte fence，现有字符 `maxLength` 继续保留。
- 兼容策略：新 byte 上限不放宽现有字符上限；cookie-only 与 response shape 是对已接受运行时和 identity contract
  的纠偏，不改变当前成功响应。依赖旧错误 OpenAPI body/response token 的客户端在当前运行时本已不可用，不设双写窗口。

## 权限、RLS 和数据处理要求

- login/refresh 的 public、logout/admin 的 Bearer/ADMIN 权限保持不变。
- filter 不解析、记录或回显 body；拒绝响应只包含固定 `code/message`。
- raw password、refresh token、cookie、hash、username、displayName 与 body bytes 不进入日志、Evidence 或测试输出。
- repository、SECURITY DEFINER、RLS、owner context、account/token 表结构与审计表均不变。

## 状态机和失败行为

- 非目标 method/path 不读取、不包装 body，保持原过滤链行为。
- 已知 `Content-Length > 16384`：不读取 body，不调用下游，返回固定 400 INVALID_REQUEST。
- 未知/chunked 或声明不可信：最多读取 16385 bytes；exact EOF 后包装继续，首个 one-over byte 触发固定 400，
  不继续读取 sentinel。
- 空、缺失、畸形 JSON 仍由既有 MVC advice 映射为 400 INVALID_REQUEST。
- 字段超限在 authenticate/audit/BCrypt/create/seed JDBC 前固定 400；无 repository、encoder、JWT 或 session 交互。
- null/blank/超 512-byte refresh token 统一 401 AUTHENTICATION_REQUIRED；超限前不得生成 successor、hash、
  rotate/logout JDBC 或签发 JWT。未知、revoked、expired、disabled 与 idempotent logout 的既有语义不变。
- 任何值都不截断、自动修正或降级后继续；实现/契约/生成物漂移均 fail closed。

## 模型、Prompt、记忆和安全边界

本卡不触碰模型路由、Prompt、Generation、Memory 或 Safety。认证输入不得进入这些边界；既有授权、租户、
最终化与安全不变量保持不变。

## 验收标准

1. raw body `16383/16384/16385`、已知长度和未知/chunked 均有测试；exact byte-identical replay，one-over
   下游零调用且底层最多读取 16385 bytes，sentinel 未读。
2. filter 只匹配两个精确 POST 路径，支持 context path；其他 method/path 的 body 零读取。
3. body one-over 响应精确为 `400 {"code":"INVALID_REQUEST","message":"The request is invalid"}`，
   JSON content type/UTF-8 正确，不含请求 sentinel 或长度。
4. UTF-8 helper 覆盖 1/3/4-byte code point、exact/one-over；字段常量精确为 512/4096/1024/64，
   现有字符常量保持 128/1024/256/16。
5. login/createAccount/seedAdmin 的 byte 超限值在 BCrypt/JDBC 前失败；token 512 exact 可达 repository，
   513 one-over 在 hash/JDBC/JWT/successor 生成前失败；Mockito 证明无交互。
6. refresh/logout null、blank、正常 43-byte token、512 exact、513 one-over 与 rotate/idempotent 既有行为回归。
7. identity contract 明确 parser-before fence、字段/token byte values 与失败语义；OpenAPI refresh/logout 无 request body，
   AuthTokenResponse 无 refreshToken，两个旧 request schema/生成文件删除，drift gate PASS。
8. `specs/catalog/**`、`specs/generated/**`、migration、repository、JWT、CookieCsrfGuardFilter、frontend 与 Harness 零 diff。
9. 独立 Reviewer 绑定候选 Commit/Tree 完成全矩阵复核，最终无未关闭 P0/P1；所有正式命令绑定同一 clean 候选。

## 必跑检查

以 YAML `requiredCommands` 的精确 argv 为准。迭代阶段只运行必要的受影响测试；候选提交和独立 Reviewer PASS
后，canonical Precheck、定向测试、两条 OpenAPI gate、根级 Maven verify 与唯一一次 `git diff --check` 按冻结
顺序各执行一次。每条记录真实退出码、Commit/Tree、时间、完整 stdout/stderr 哈希和环境；不把 generator、缓存、
wrapper 或另一提交结果当作 PASS。

## 回滚或前向修复

- 候选前可在白名单内调整实现；Reviewer blocking finding 只允许一个 fix batch 和 R2。
- 候选/终态提交均只前向追加，不改写已推送历史；失败则以真实 REJECTED Evidence/Handoff 原子关闭。
- 运行时问题的前向修复仅可恢复到 Base 的未保护行为或在新任务重新授权，不得放宽 byte 上限、吞错误、移除测试
  或手改生成物以通过门禁。
- OpenAPI 生成必须重新运行 source generator；删除/恢复 generated schema 文件均需与 source 同步。

## 停止条件

- 无法在 JSON 物化前同时覆盖已知与未知长度，或必须无界读取/缓存才能判断 one-over。
- 无法证明字段/token 在 BCrypt、hash 或 JDBC 前拒绝，或错误响应会泄漏输入。
- 需要修改 migration、repository、Catalog、JWT/CSRF、限流、密码策略、审计或本卡 forbidden path。
- Context、Base、Skill、Owner 授权、Diff Scope、候选身份、Reviewer 或 formal command 结果不明确/改变。
- 超过唯一 fix batch、R2 出现新 P0/P1 结构问题、或达到 policy hard fuse；只允许按策略做最小终态闭包。

## Evidence Pack

输出到 `docs/evidence/TASK-0121/`，至少包含 `evidence-pack.json`、最终独立 review、LOCAL_EXACT_TREE_FALLBACK
记录和 pre-closure 请求；Handoff 输出到 `docs/handoffs/TASK-0121.json`。终态 reviewer 数组只保留绑定最终候选的
PASS Reviewer；`nextAction` 必须与同一终态 `.harness/project-state.yaml` 逐字一致，并继续串行处理 P2-03 剩余的
限流/退避/锁定/审计决策，不宣称本卡已关闭这些残余。

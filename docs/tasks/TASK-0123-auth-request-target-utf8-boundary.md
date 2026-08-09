# TASK-0123：Auth 请求目标规范化与严格 UTF-8 边界

```yaml
taskId: TASK-0123
state: REJECTED
owner: repository-owner
riskClass: C3
requiredSkills:
  - task-delivery-flow
  - task-intake
requiredSkillVersions:
  task-delivery-flow: "1.3.7"
  task-intake: "1.2.7"
targetSkillVersions: {}
baseCommit: 30a0a25e20cd1c76b31d016d768faaf13a72588f
authorizationCommit: 8232781dd718f0d6a6b621e56db6b6b54212b254
contextFingerprint: 27fd964b15ac0f6068b1866dd4081cd191bd65a4979d073394709fa9dd11fc05
contextLock: docs/tasks/context/TASK-0123.context-lock.yaml
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
  surfaceId: TASK_0123_AUTH_REQUEST_TARGET_UTF8_BOUNDARY
  policySurfaces: [AUTHORIZATION]
  distinctCrossRiskSurfaces: 1
  reviewerMinutesEstimate: 15
  terminalCheckMinutesEstimate: 20
  estimatedWallMinutes: 90
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
  - docs/evidence/TASK-0122/evidence-pack.json
  - docs/evidence/TASK-0122/review-r1.md
  - docs/evidence/TASK-0122/review-r2.md
  - docs/handoffs/TASK-0122.json
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
  - docs/tasks/TASK-0112-auth-input-hygiene.md
  - docs/tasks/TASK-0121-auth-body-token-fences.md
  - docs/tasks/TASK-0122-auth-abuse-admission-control.md
  - docs/tasks/context/TASK-0112.context-lock.yaml
  - docs/tasks/context/TASK-0121.context-lock.yaml
  - docs/tasks/context/TASK-0122.context-lock.yaml
  - docs/tasks/task-card-template.md
  - pom.xml
  - requirements-harness.txt
  - scripts/dev/openapi_tool.py
  - scripts/harness/catalog_tool.py
  - service/apps/runtime/pom.xml
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/application/AuthAbuseGuard.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/application/AuthService.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/application/RefreshTokens.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/AuthDataSourceConfig.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/AuthRequestBodyLimitFilter.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/AuthSecurityConfig.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/AuthSourceAdmissionFilter.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/CookieCsrfGuardFilter.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/jwt/JwtTokenService.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/web/AuthController.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/web/AuthErrorException.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/web/AuthExceptionHandler.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/web/AuthInputLimits.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/web/AuthRateLimitException.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/web/AuthRateLimitResponse.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/web/AuthRequests.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/web/AuthResponses.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/web/ErrorEnvelope.java
  - service/apps/runtime/src/main/resources/application.yaml
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/application/AuthAbuseGuardTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/application/AuthServiceTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/config/AuthRequestBodyLimitFilterTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/config/AuthSecurityIntegrationTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/config/AuthSourceAdmissionFilterTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/web/AuthControllerAbuseControlTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/web/AuthControllerCookieTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/web/AuthControllerValidationTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/web/AuthInputLimitsTest.java
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
  - specs/catalog/error-codes.yaml
  - specs/contracts/identity-session-boundary-contract.yaml
  - specs/openapi/virtual-companion.yaml
writeAllowlist:
  - docs/tasks/TASK-0123-auth-request-target-utf8-boundary.md
  - docs/tasks/context/TASK-0123.context-lock.yaml
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - docs/evidence/TASK-0123/**
  - docs/handoffs/TASK-0123.json
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/AuthRequestTarget.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/AuthRequestBodyLimitFilter.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/AuthSourceAdmissionFilter.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/web/AuthInputLimits.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/application/AuthServiceTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/config/AuthRequestBodyLimitFilterTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/config/AuthSecurityIntegrationTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/config/AuthSourceAdmissionFilterTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/web/AuthControllerAbuseControlTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/web/AuthControllerValidationTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/web/AuthInputLimitsTest.java
forbiddenPaths:
  - docs/tasks/TASK-0109-*
  - docs/tasks/TASK-011*-*
  - docs/tasks/TASK-0120-*
  - docs/tasks/TASK-0121-*
  - docs/tasks/TASK-0122-*
  - docs/tasks/context/TASK-0109.context-lock.yaml
  - docs/tasks/context/TASK-011*.context-lock.yaml
  - docs/tasks/context/TASK-0120.context-lock.yaml
  - docs/tasks/context/TASK-0121.context-lock.yaml
  - docs/tasks/context/TASK-0122.context-lock.yaml
  - docs/evidence/TASK-0109/**
  - docs/evidence/TASK-011*/**
  - docs/evidence/TASK-0120/**
  - docs/evidence/TASK-0121/**
  - docs/evidence/TASK-0122/**
  - docs/handoffs/TASK-0109.json
  - docs/handoffs/TASK-011*.json
  - docs/handoffs/TASK-0120.json
  - docs/handoffs/TASK-0121.json
  - docs/handoffs/TASK-0122.json
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
  - specs/**
  - "**/db/migration/**"
  - service/platform/**
  - service/modules/**
  - service/adapters/**
  - service/tests/**
  - service/apps/runtime/pom.xml
  - service/apps/runtime/src/main/resources/**
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/application/**
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/AuthDataSourceConfig.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/AuthSecurityConfig.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/CookieCsrfGuardFilter.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/jwt/**
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/tenant/**
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/web/AuthController.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/web/AuthErrorException.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/web/AuthExceptionHandler.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/web/AuthRateLimitException.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/web/AuthRateLimitResponse.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/web/AuthRequests.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/web/AuthResponses.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/web/ErrorEnvelope.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/application/AuthAbuseGuardTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/config/AdminSeedRunnerTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/jwt/**
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/tenant/**
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/web/AuthControllerCookieTest.java
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
  - specs/catalog/error-codes.yaml
  - specs/contracts/identity-session-boundary-contract.yaml
  - specs/openapi/virtual-companion.yaml
  - docs/evidence/TASK-0109/zcode-remediation-handoff.md
  - docs/tasks/TASK-0112-auth-input-hygiene.md
  - docs/tasks/TASK-0121-auth-body-token-fences.md
  - docs/tasks/TASK-0122-auth-abuse-admission-control.md
  - docs/evidence/TASK-0122/evidence-pack.json
  - docs/handoffs/TASK-0122.json
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
requiredInvariants:
  - INV-TENANT-001
  - INV-AUTH-001
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
      Owner 要求 Codex 按当前思考深度、不启用 fast，继续既有长线 goal 且无需询问。TASK-0122
      已 ACCEPTED、推送、远端 0/0 且 post-terminal Doctor PASS；其 Handoff 与 project-state 的
      唯一下一动作逐字指定通过 task-intake 创建 TASK-0123。
  - scope: auth-request-target-and-strict-utf8-boundary
    approvedBy: repository-owner
    approvedAt: "2026-08-09"
    sourceThreadId: 019fdf92-9c99-7400-a2ea-d490ef3d7e15
    evidence: >-
      TASK-0122 终态 nextAction 明确授权统一 Auth request-target parsed/canonical 边界，关闭
      admin/accounts percent-encoded 或 matrix MVC 等价路径绕过 16384-byte body fence，将到达
      filter 的 malformed percent request-target 固定为 400 INVALID_REQUEST 且 body zero-read；
      同时把 username、password、displayName、role 与 refresh token 的 UTF-8 检查改为严格
      CodingErrorAction.REPORT，保持 route 权限、JWT、CSRF、cookie 与数据库状态机语义不变。
  - scope: local-exact-tree-fallback
    approvedBy: repository-owner
    approvedAt: "2026-08-09"
    sourceThreadId: 019fdf92-9c99-7400-a2ea-d490ef3d7e15
    evidence: >-
      Owner 要求长线不中断推进；TASK-0102/TASK-0108 已记录同一配额周期 includedMinutes=
      usedMinutes=2000、paidBudgetUsd=0、stopUsageEnabled=true、dispatchCount=0，TASK-0110
      exact-SHA run 31286798584 在无 runner、零 step 状态终止；TASK-0112 至 TASK-0122
      已按同一 READY 冻结 fallback 合规关闭。本卡冻结 LOCAL_EXACT_TREE_FALLBACK，远端继续
      如实为非 PASS，PASS 只绑定记录的本机 Commit/Tree、精确命令、工具链和输出哈希。
independentReview: required
reviewers:
  - id: task0123_r2
    kind: independent-review-gate
    verdict: FAIL
    reviewedCommit: 70ace14a89a9c094690a94bb8576ca978d518456
    evidencePath: docs/evidence/TASK-0123/review-r2.md
    reason: >-
      R2 FAIL：R1 P2-01 已关闭，但 encoded Auth-prefix alias
      /api/v1/%61uth/admin/accounts 仍由 firewall fallback 产生空 400；自定义
      RequestRejectedHandler 还替代了 Spring Security 默认 observation marking，新增全局可观测性
      P2。唯一 fix batch 已消耗且 R3 禁止。
    candidateTree: 7c195d82363781e73d2747d46ed50af9c36c0f5b
requiredCommands:
  - python scripts/harness/precheck.py --task TASK-0123
  - docker run --rm -v /Users/hxf/projects/virtual-companion:/workspace -v vc-maven-cache:/root/.m2 -w /workspace maven:3.9-eclipse-temurin-25-alpine ./mvnw --batch-mode --no-transfer-progress -pl service/apps/runtime -am -Dtest=AuthRequestBodyLimitFilterTest,AuthSourceAdmissionFilterTest,AuthInputLimitsTest,AuthServiceTest,AuthControllerValidationTest,AuthControllerAbuseControlTest,AuthSecurityIntegrationTest -Dsurefire.failIfNoSpecifiedTests=false test
  - docker run --rm -v /Users/hxf/projects/virtual-companion:/workspace -v vc-maven-cache:/root/.m2 -w /workspace maven:3.9-eclipse-temurin-25-alpine ./mvnw --batch-mode --no-transfer-progress verify
  - git diff --check
```

> 本卡是 TASK-0122 终态 Handoff 授权的独立延续卡；Backlog 中没有 TASK-0123，因此不写
> `planningBacklog` 或 `planningContractHash`。本卡只收敛已有 Auth HTTP 输入边界，不改变认证、
> 授权、会话或数据库业务语义。

## 背景与用户可观察目标

TASK-0121 已为 login 与 admin/accounts 建立 16384-byte 原始请求体上限，TASK-0122 又为
login/refresh 引入 parsed path matching 与 canonical rejection。但 body filter 仍使用 raw URI
精确比较，导致 Spring MVC 可接受的 admin/accounts percent-encoded 或 matrix 等价路径绕过原始
body fence；`ServletRequestPathUtils.parse` 的非法 percent 异常也尚未固定映射。另一方面，
`AuthInputLimits` 通过 replacement-based `String.getBytes(UTF_8)` 计数，孤立 surrogate 会被替换后
继续进入 service 边界。

完成后，所有本卡涉及的 Auth POST 路由共享一个 parsed/canonical 分类器；非 canonical 与 malformed
Auth request-target 在读取 body、Jackson、BCrypt、repository 或 JDBC 前固定返回 400；所有 Auth
字段 UTF-8 尺寸检查都使用 `CodingErrorAction.REPORT`，合法 U+FFFD 与非法 UTF-16 不再混淆。

## 范围内

- 新增 package-private Auth request-target helper，统一 POST login、refresh 与 admin/accounts 的
  Spring parsed path matching、context-path 处理、canonical 判断和 malformed 状态。
- Source admission filter 与 body-limit filter 复用该 helper；admin/accounts encoded/matrix alias 和
  Auth malformed percent request-target 固定为 `400 INVALID_REQUEST`，且 body zero-read、chain zero-call。
- login/refresh 既有 source admission、bulkhead、429、filter 顺序和 canonical rejection 保持不变。
- `AuthInputLimits.utf8ByteLength` 使用严格 UTF-8 encoder；`withinUtf8Bytes` 对 malformed UTF-16
  fail-closed 为 false，同时保留 null 与负上限既有契约。
- 增加 unit、standalone MVC 与 Security-chain 测试，证明固定 envelope、零 body read、service
  不可达、合法 code point 计数和 direct service 边界。

## 明确范围外

- 不改变 endpoint 映射、ADMIN 权限、JWT 校验、CSRF/origin/cookie 策略或 Security filter 顺序。
- 不改变 16384-byte body 上限、字段字符/字节上限、Auth limiter 阈值、backoff、bulkhead 或 HMAC。
- 不修改 Catalog、Contract、OpenAPI、生成物、数据库 schema/migration、repository、RLS 或 datasource。
- 不建立 gateway、trusted proxy、跨实例 limiter、账号锁定、密码最低/breach/history 或审计保留策略。
- 不修改 frontend、CI、Harness、历史任务、Evidence/Handoff 或机器策略。

## 输入和前置条件

- Base 固定为 TASK-0122 已推送且远端 0/0 的终态提交
  `30a0a25e20cd1c76b31d016d768faaf13a72588f`；工作树与 Index 在 intake 前干净。
- Context Lock 只读取 Base 中 71 个精确仓库输入，按
  `SHA256_ORDINAL_SORTED_PATH_EQUALS_HASH_LF_V1` 独立复算。
- TASK-0122 的 task、Evidence、R1/R2、Handoff 与 project-state nextAction 共同授权本卡；历史聊天
  只作为 Owner 授权 provenance，不覆盖机器真源。
- DRAFT 只提交本任务卡与 Context Lock；READY 才原子更新 task 与 project-state，随后单独绑定
  `authorizationCommit` 并运行 READY Doctor。

## API / 事件 / 数据契约

- 既有 canonical routes、HTTP methods、request/response schema 与成功响应完全不变。
- 仅为 MVC 等价但非 canonical 或 malformed 的 Auth request-target 固定 `400`：
  `{"code":"INVALID_REQUEST","message":"The request is invalid"}`，不含 details、raw URI 或输入值。
- Catalog ordinal、identity contract 与 OpenAPI 不变；正式 diff 不得包含 `specs/**`。

## 权限、RLS 和数据处理要求

- 精确 canonical admin/accounts 仍必须通过既有 ADMIN Bearer/JWT 规则；本卡不放宽或绕过认证授权。
- 非 canonical/malformed rejection 只发生在昂贵 body 处理前，不访问 repository、BCrypt 或 JDBC。
- 响应和日志不得包含 raw request target、username、password、displayName、role、refresh token 或替换值。
- 数据库 principal、RLS、session rotation、logout 幂等与 admin seed 语义保持不变。

## 状态机和失败行为

- 非 POST 或非 Auth path 不由 helper 拦截，按既有 filter chain 继续；精确 POST login/refresh/admin
  routes 返回 canonical match。
- percent-encoded 或 matrix 等价 Auth route 返回 non-canonical match并固定 400；不得读 body或进入 chain。
- raw Auth prefix 下非法、截断或非十六进制 percent sequence若到达 filter，返回 malformed并固定 400；
  不传播 `IllegalArgumentException`，不记录 raw URI。
- 严格 UTF-8 编码失败时，`withinUtf8Bytes` 返回 false；direct service 继续通过既有
  INVALID_REQUEST 或 AUTHENTICATION_REQUIRED 失败语义关闭，且任何哈希/JDBC/response 均不可达。
- 任何解析/编码异常不得转为 500、429 状态漂移或 replacement-based alias。

## 模型、Prompt、记忆和安全边界

- 本卡不调用模型，不改 Prompt、记忆、provider 或付费能力。
- 不新增外部依赖、SaaS、网络服务或持久化 limiter。
- 所有拒绝响应固定、低信息量且不泄露具体失败字符、路径、容量或用户标识。

## 验收标准

1. shared helper 对 context path 下 exact POST login、refresh、admin/accounts 分别产生 canonical match；
   GET、非 Auth path 与未知 Auth path保持非目标，不修改下游语义。
2. `/api/v1/auth/admin/acc%6Funts`、`/api/v1/auth/admin/accounts;v=1` 及大小写等价编码
   在 standalone body filter 与实际 Security chain 中均固定 400，body reads=0、chain/service=0。
3. login/refresh encoded/matrix 既有测试继续固定 400；exact routes 的 source window、429、
   Retry-After 与 4-slot lease 不变。
4. raw Auth request target 的 `%`、`%2`、`%ZZ` 等 malformed 变体若到达 source 或 body filter，
   均固定 400/INVALID_REQUEST，body reads=0、下游不可达且不抛未处理异常。
5. known/unknown body 长度的 16384 exact 与 16385 one-over 行为保持；admin canonical route同样受 fence。
6. strict UTF-8 计数对 ASCII/2/3/4-byte code point 与合法 U+FFFD 返回精确字节数；孤立 high/low
   surrogate 使 `withinUtf8Bytes` 为 false，`utf8ByteLength` 抛不含原值的固定异常；null 和负 limit契约不变。
7. AuthService login/createAccount/refresh/logout/seed 的孤立 surrogate用例在 BCrypt、repository、
   token hash、JDBC 或响应对象前按既有错误 envelope 失败；不添加 skip、重试或扩超时。
8. `specs/**`、JWT、CSRF/cookie、数据库与 route mapping 无 diff；C3 独立 Reviewer 对候选
   Commit/Tree、完整矩阵、相邻风险与 P0/P1/P2/P3 给出结构化终态。
9. 冻结 canonical、targeted reactor、root JDK-25 Maven verify 与唯一无参数 `git diff --check`
   在同一 clean candidate 上按顺序各执行一次并真实 PASS。
10. Evidence/Handoff、单父终态提交、push、fetch、HEAD==origin/main、0/0 与 post-terminal Doctor PASS。

## 必跑检查

以 YAML `requiredCommands` 精确 argv 和顺序为准。Reviewer PASS 前只运行有界迭代测试；正式
Precheck、targeted reactor、root verify 与无参数 `git diff --check` 各只运行一次并绑定同一 clean
Commit/Tree。Precheck 已包含 Doctor、Catalog 与 paid/beta checks，不重复执行其子命令。远端 exact-SHA
继续如实为非 PASS，LOCAL_EXACT_TREE_FALLBACK 只声明记录的平台、工具链与命令覆盖。

## 回滚或前向修复

- 候选前允许在唯一 fix batch 内前向修复 helper/filter/input-limit/test 缺陷，不改写历史。
- 终态后发现回归时创建新永久 Task ID；不得 amend、reset、删除测试或修改 TASK-0123 历史 Evidence。
- shared helper 无法在不改变 route 权限/CSRF/cookie 顺序的前提下收敛时，以真实非 PASS 关闭并新建
  更小的替代卡，不得扩大本卡到 Security 架构重写。

## 停止条件

- Context、Base、fingerprint、Owner 授权、Skill、allowlist、candidate identity 或 filter 顺序不明确。
- 需要修改 forbidden path、Catalog/OpenAPI、JWT/CSRF/cookie、数据库或 endpoint mapping 才能实现。
- Reviewer R2 后仍有 P0/P1 或本卡范围内未关闭 P2，或需要第二个 fix batch/R3。
- canonical、targeted、root verify、唯一 diff check、pre-closure、push 或远端 0/0 任一非 PASS。
- 到达 hard fuse 后停止实现、fix、Reviewer、canonical 与 CI，仅允许如实 closure-only 收口。

## Evidence Pack

输出 `docs/evidence/TASK-0123/` 与 `docs/handoffs/TASK-0123.json`，绑定 Base、Context、候选
Commit/Tree、R1/R2、所有命令真实状态/退出码/输出哈希、local exact-tree 环境、remote non-PASS、
delivery timing、首次失败和唯一 nextAction。终态原子更新 Task、Project State、Task Ledger、完整
Evidence 与 Handoff；终态提交含 `[skip ci]`，推送后复核远端 0/0 与 post-terminal Doctor。

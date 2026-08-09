# TASK-0126：Auth Refresh Malformed UTF-16 Fail-Closed

```yaml
taskId: TASK-0126
state: READY
owner: repository-owner
riskClass: C3
requiredSkills:
  - task-delivery-flow
  - task-intake
requiredSkillVersions:
  task-delivery-flow: "1.3.7"
  task-intake: "1.2.7"
targetSkillVersions: {}
baseCommit: dc1dfca319e1c1793bcbaba2b74b38b2b7caea85
authorizationCommit: ""
contextFingerprint: 994d1cf54ef8a0fb8c914983a8e2b72d895aef7fc1ae41b6c77ed1b706530636
contextLock: docs/tasks/context/TASK-0126.context-lock.yaml
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
  surfaceId: TASK_0126_AUTH_REFRESH_MALFORMED_UTF16_FAIL_CLOSED
  policySurfaces: [AUTHORIZATION]
  distinctCrossRiskSurfaces: 1
  reviewerMinutesEstimate: 15
  terminalCheckMinutesEstimate: 20
  estimatedWallMinutes: 75
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
  - docs/evidence/TASK-0125/evidence-pack.json
  - docs/evidence/TASK-0125/local-exact-tree.json
  - docs/evidence/TASK-0125/review-r1.md
  - docs/handoffs/TASK-0125.json
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
  - docs/tasks/TASK-0125-auth-firewall-envelope-observation.md
  - docs/tasks/context/TASK-0125.context-lock.yaml
  - docs/tasks/task-card-template.md
  - pom.xml
  - requirements-harness.txt
  - service/apps/runtime/pom.xml
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/application/AuthAbuseGuard.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/application/AuthService.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/AuthRequestBodyLimitFilter.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/AuthRequestTarget.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/AuthSecurityConfig.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/AuthSourceAdmissionFilter.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/CookieCsrfGuardFilter.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/web/AuthController.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/web/AuthInputLimits.java
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
  - docs/tasks/TASK-0126-auth-refresh-malformed-utf16-fail-closed.md
  - docs/tasks/context/TASK-0126.context-lock.yaml
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - docs/evidence/TASK-0126/**
  - docs/handoffs/TASK-0126.json
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/application/AuthAbuseGuard.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/application/AuthAbuseGuardTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/web/AuthControllerAbuseControlTest.java
forbiddenPaths:
  - docs/tasks/TASK-0109-*
  - docs/tasks/TASK-011*-*
  - docs/tasks/TASK-0120-*
  - docs/tasks/TASK-0121-*
  - docs/tasks/TASK-0122-*
  - docs/tasks/TASK-0123-*
  - docs/tasks/TASK-0124-*
  - docs/tasks/TASK-0125-*
  - docs/tasks/context/TASK-0109.context-lock.yaml
  - docs/tasks/context/TASK-011*.context-lock.yaml
  - docs/tasks/context/TASK-0120.context-lock.yaml
  - docs/tasks/context/TASK-0121.context-lock.yaml
  - docs/tasks/context/TASK-0122.context-lock.yaml
  - docs/tasks/context/TASK-0123.context-lock.yaml
  - docs/tasks/context/TASK-0124.context-lock.yaml
  - docs/tasks/context/TASK-0125.context-lock.yaml
  - docs/evidence/TASK-0109/**
  - docs/evidence/TASK-011*/**
  - docs/evidence/TASK-0120/**
  - docs/evidence/TASK-0121/**
  - docs/evidence/TASK-0122/**
  - docs/evidence/TASK-0123/**
  - docs/evidence/TASK-0124/**
  - docs/evidence/TASK-0125/**
  - docs/handoffs/TASK-0109.json
  - docs/handoffs/TASK-011*.json
  - docs/handoffs/TASK-0120.json
  - docs/handoffs/TASK-0121.json
  - docs/handoffs/TASK-0122.json
  - docs/handoffs/TASK-0123.json
  - docs/handoffs/TASK-0124.json
  - docs/handoffs/TASK-0125.json
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
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/application/AuthService.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/**
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/jwt/**
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/tenant/**
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/web/**
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/application/AuthServiceTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/config/**
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/jwt/**
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/tenant/**
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/web/AuthControllerCookieTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/web/AuthControllerValidationTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/web/AuthInputLimitsTest.java
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
  - docs/tasks/TASK-0125-auth-firewall-envelope-observation.md
  - docs/evidence/TASK-0125/evidence-pack.json
  - docs/evidence/TASK-0125/local-exact-tree.json
  - docs/evidence/TASK-0125/review-r1.md
  - docs/handoffs/TASK-0125.json
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
      Owner 明确恢复当前会话长线 goal，要求使用当前思考深度、不启用 fast，持续修复且不为低风险细节暂停。
      TASK-0125 已真实 REJECTED、推送并远端 0/0；其 Handoff 与 project-state 唯一 nextAction 明确要求
      以新永久 ID 创建 TASK-0126，定位 root verify 中的 malformed UTF-16 refresh admission 失败。
  - scope: auth-refresh-malformed-utf16-fail-closed
    approvedBy: repository-owner
    approvedAt: "2026-08-09"
    sourceThreadId: 019fdf92-9c99-7400-a2ea-d490ef3d7e15
    evidence: >-
      TASK-0125 终态 Handoff 精确授权 TASK-0126：保留已提交 Auth firewall 修复，判明生产 HMAC
      fail-closed 缺陷或测试污染，在最小范围修复 AuthAbuseGuard/AuthAbuseGuardTest，补充必要 controller
      边界证明，并重新覆盖 TASK-0125 完整矩阵。
  - scope: local-exact-tree-fallback
    approvedBy: repository-owner
    approvedAt: "2026-08-09"
    sourceThreadId: 019fdf92-9c99-7400-a2ea-d490ef3d7e15
    evidence: >-
      Owner 要求长线不中断推进；既有 includedMinutes=usedMinutes=2000、paidBudgetUsd=0、
      stopUsageEnabled=true、dispatchCount=0 与无 runner 的 exact-SHA 失败事实保持不变。TASK-0112 至
      TASK-0122 已按同一 fallback 合规闭环；本卡冻结 LOCAL_EXACT_TREE_FALLBACK，远端继续如实非 PASS。
independentReview: required
reviewers: []
requiredCommands:
  - python scripts/harness/precheck.py --task TASK-0126
  - docker run --rm -v /Users/hxf/projects/virtual-companion:/workspace -v vc-maven-cache:/root/.m2 -w /workspace maven:3.9-eclipse-temurin-25-alpine ./mvnw --batch-mode --no-transfer-progress -pl service/apps/runtime -am -Dtest=AuthAbuseGuardTest,AuthRequestBodyLimitFilterTest,AuthSourceAdmissionFilterTest,AuthInputLimitsTest,AuthServiceTest,AuthControllerValidationTest,AuthControllerAbuseControlTest,AuthControllerCookieTest,AuthSecurityIntegrationTest -Dsurefire.failIfNoSpecifiedTests=false test
  - docker run --rm -v /Users/hxf/projects/virtual-companion:/workspace -v vc-maven-cache:/root/.m2 -w /workspace maven:3.9-eclipse-temurin-25-alpine ./mvnw --batch-mode --no-transfer-progress verify
  - git diff --check
```

> 本卡是 TASK-0125 因正式 root verify 失败而真实 REJECTED 后的新永久任务，不重跑或改写其正式门禁，
> 不把 TASK-0125 的 Reviewer/Precheck/targeted PASS 转换为本卡 PASS。Backlog 中没有 TASK-0126，因此不写
> `planningBacklog` 或 `planningContractHash`。

## 背景与用户可观察目标

TASK-0125 已修复 Auth firewall envelope 与 official observation marking，并通过独立 Reviewer、canonical Precheck
和 110 项正式 targeted 测试，但 root JDK-25 verify 在既有
`AuthAbuseGuardTest.malformedUtf16CannotAliasAValidDigestKeyAcrossAnyHmacInput:200` 确定失败。严格
`AuthInputLimits.withinUtf8Bytes` 将孤立 surrogate 映射为 `false`，而 `admitRefresh` 将所有 false 统一当作普通
无效/超长 token 直接放行到 AuthService，导致测试期望的 fail-closed 429 未发生。

完成后，null、blank、超长 refresh token 仍保留既有 AuthService 401 语义；孤立 high/low surrogate 则在 limiter
状态与 AuthService 之前固定 fail-closed 为 429/Retry-After 60，合法 U+FFFD 与 exact 512-byte token 仍可正常进入
独立 HMAC bucket。TASK-0125 的 firewall 行为必须完整保留。

## 范围内

- 在 `AuthAbuseGuard.admitRefresh` 中区分 null/blank/超长 token 与 malformed UTF-16：先用有界 Java length
  coarse fence，再执行 strict UTF-8 length；编码异常沿现有固定 60 秒 fail-closed 路径处理。
- 加固 `AuthAbuseGuardTest`，对 high/low surrogate 的 source/login/refresh 输入分别证明 429、无 map state、
  bulkhead permit 不泄漏，并证明合法 U+FFFD 不发生 alias。
- 增加 refresh controller 边界测试，证明 malformed cookie/token 在 AuthService 前返回固定 429，null/blank/one-over
  仍保持既有 401，exact valid token 与 progressive limiter 语义不回归。
- 重新运行 TASK-0125 firewall、request-target、body fence、source admission、strict UTF-8 和完整 root matrix。

## 明确范围外

- 不改变冻结 byte limits、null/blank/one-over refresh 401、错误 Catalog/Contract/OpenAPI 或 HTTP route。
- 不修改 AuthService、AuthInputLimits、AuthController、Security config、filter 顺序、JWT、CSRF/cookie 属性或数据库。
- 不改变 HMAC 算法、domain/framing、capacity/window/backoff、bulkhead 公平性或跨实例 limiter 范围。
- 不修改 TASK-0125 及更早 Task/Evidence/Handoff，不重跑、覆盖或补写其正式门禁。

## 输入和前置条件

- Base 是 TASK-0125 已推送且远端 0/0、post-terminal Doctor PASS 的 REJECTED 终态提交
  `dc1dfca319e1c1793bcbaba2b74b38b2b7caea85`；其 Auth firewall 实现继续存在，但没有 ACCEPTED/PASS 声明。
- Context Lock 固定 Base 中 55 个输入，包含 TASK-0125 formal failure、当前 limiter/strict UTF-8/controller
  调用链、完整相关测试与治理真源。
- TASK-0125 root verify 的唯一失败是 runtime test line 200；该次正式命令真实 exit 1，不允许重跑或覆盖。

## API / 事件 / 数据契约

- 对合法、null、blank、超长 refresh token 的现有 HTTP/API contract 不变。
- malformed UTF-16 refresh token 固定返回既有 `429 AUTH_RATE_LIMITED` envelope 与 `Retry-After: 60`，不回显 token、
  surrogate、digest、异常 message 或内部状态。
- 不新增错误 code、event、schema、migration 或配置。

## 权限、RLS 和数据处理要求

- malformed token 在 AuthService、repository、JDBC、rotation、JWT issuance 和 audit 前停止，不建立身份或 session。
- 所有 attacker-controlled map key 仍只保存固定长度 HMAC digest；编码失败不建立 bucket，不保存 raw token。
- RLS、tenant、admin、logout 与 database 路径零 diff且不可达。

## 状态机和失败行为

- null/blank/Java length one-over token 不进入 strict encoder/HMAC，仍由 AuthService 现有 401 处理。
- Java length 有界且 strict UTF-8 编码失败时，转换为 `AuthRateLimitException(60)`；不得返回、别名为 U+FFFD 或建立 state。
- strict UTF-8 byte length one-over 继续跳过 limiter并保留 401；exact valid token 进入 refresh bucket。
- HMAC、clock、capacity 或 runtime 异常继续沿既有固定 fail-closed，不吞异常或转为 2xx/401。

## 模型、Prompt、记忆和安全边界

本卡不调用模型，不改 Prompt、Memory、provider、网络或付费能力。

## 验收标准

1. `admitRefresh` 对孤立 high/low surrogate 均抛 `AuthRateLimitException` 且 `retryAfterSeconds=60`；source/login
   语义保持一致，三类输入均不建立 state，bulkhead permits 完整恢复。
2. 合法 U+FFFD、exact 512-byte token 可进入各自 HMAC bucket且不会与 malformed alias；null/blank/one-over
   refresh token 仍不消费 limiter并由 controller/AuthService 保持 401。
3. controller 边界证明 malformed refresh 在 AuthService 前返回 429、固定 code/message/Retry-After 且无输入回显。
4. TASK-0125 encoded Auth-prefix JSON 400、official observation marking、非 Auth 空 400、context-path/malformed target、
   16384/16385 body fence、source/lease/backoff 与 strict service UTF-8 全部保持。
5. AuthInputLimits、AuthService、AuthController、Security config、JWT、CSRF/cookie、database、specs、生成物和依赖零 diff；
   C3 Reviewer 对 root failure closure、完整矩阵、邻接风险和 P0/P1/P2/P3 给结构化终态。
6. frozen canonical、targeted reactor、root JDK-25 verify 与唯一无参数 `git diff --check` 在同一 clean candidate
   上按顺序各执行一次并真实 PASS。
7. Evidence/Handoff、单父终态提交、push/fetch、HEAD==origin/main、0/0 与 post-terminal Doctor PASS。

## 必跑检查

以 YAML `requiredCommands` 精确 argv 和顺序为准。Reviewer PASS 前仅运行有界迭代测试；正式 Precheck、targeted、
root verify 与无参数 diff check 各一次，绑定同一 clean Commit/Tree。远端 exact-SHA 继续真实非 PASS，本地 fallback
只覆盖记录的平台、工具链和输出哈希。

## 回滚或前向修复

- 候选前仅在三条业务白名单路径内前向修复；不得恢复或重写 TASK-0125 历史。
- 如果修复需要改变 null/blank/over-limit 401、AuthInputLimits contract、AuthService 或 Security wiring，则真实
  REJECTED 并分配新永久任务，不扩大本卡 scope。
- 终态后缺陷只允许新永久 Task ID 前向处理，不 amend/reset/删除测试。

## 停止条件

- 需要修改 forbidden AuthInputLimits/AuthService/AuthController/Security/config/spec/database 才能闭合。
- malformed refresh 无法同时证明 429 fail-closed、无 state/service 调用和合法/over-limit fence 保真。
- Reviewer R2 后仍有 P0/P1 或本卡范围内未闭合 P2，需要第二 fix batch/R3，或达到 hard fuse。
- 任一 formal/pre-closure/push/remote 复核非 PASS。

## Evidence Pack

输出 `docs/evidence/TASK-0126/` 与 `docs/handoffs/TASK-0126.json`，绑定 Base、Context、候选 Commit/Tree、Reviewer、
命令真实状态与哈希、local/remote 渠道、delivery timing 和唯一 nextAction；终态原子更新 Task、Project State、
Ledger、Evidence/Handoff，以 `[skip ci]` 单父提交推送并复核远端。

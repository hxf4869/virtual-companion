# TASK-0122：Auth 单实例滥用准入与无阻塞资源舱壁

```yaml
taskId: TASK-0122
state: READY
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
baseCommit: 55629d56be58006b4cffc1fc474229293a04381d
authorizationCommit: ""
contextFingerprint: d608f595fdfc71758b6304b00eb32cc4be495f6d1da88ebae84c37ea7c7fdd9c
contextLock: docs/tasks/context/TASK-0122.context-lock.yaml
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
  surfaceId: TASK_0122_AUTH_ABUSE_ADMISSION_CONTROL
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
  - docs/evidence/TASK-0112/evidence-pack.json
  - docs/evidence/TASK-0121/evidence-pack.json
  - docs/evidence/TASK-0121/review-r1.md
  - docs/handoffs/TASK-0112.json
  - docs/handoffs/TASK-0121.json
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
  - docs/tasks/TASK-0112-auth-input-hygiene.md
  - docs/tasks/TASK-0121-auth-body-token-fences.md
  - docs/tasks/context/TASK-0112.context-lock.yaml
  - docs/tasks/context/TASK-0121.context-lock.yaml
  - docs/tasks/task-card-template.md
  - frontend/src/api/auth.spec.ts
  - frontend/src/api/auth.ts
  - pom.xml
  - requirements-harness.txt
  - scripts/dev/openapi_tool.py
  - scripts/harness/catalog_tool.py
  - service/apps/runtime/pom.xml
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/application/AuthService.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/application/RefreshTokens.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/AuthDataSourceConfig.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/AuthRequestBodyLimitFilter.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/AuthSecurityConfig.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/CookieCsrfGuardFilter.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/jwt/JwtTokenService.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/web/AuthController.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/web/AuthErrorException.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/web/AuthExceptionHandler.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/web/AuthInputLimits.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/web/AuthRequests.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/web/AuthResponses.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/web/ErrorEnvelope.java
  - service/apps/runtime/src/main/resources/application.yaml
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/application/AuthServiceTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/config/AuthRequestBodyLimitFilterTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/config/AuthSecurityIntegrationTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/web/AuthControllerCookieTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/web/AuthControllerValidationTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/web/AuthInputLimitsTest.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/IdentityAccountRepository.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/IdentityRefreshTokenRepository.java
  - service/platform/persistence/src/main/resources/db/migration/V14__identity_accounts_sessions.sql
  - skills/catalog-change/SKILL.md
  - skills/contract-change/SKILL.md
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
  - specs/catalog/catalog-manifest.yaml
  - specs/catalog/error-codes.yaml
  - specs/catalog/product-scope.yaml
  - specs/contracts/authorization-contract.yaml
  - specs/contracts/identity-session-boundary-contract.yaml
  - specs/generated/catalog.snapshot.json
  - specs/generated/java/com/virtualcompanion/catalog/ErrorCode.java
  - specs/generated/openapi/catalog-schemas.yaml
  - specs/generated/sql/catalog-values.sql
  - specs/generated/typescript/catalog.ts
  - specs/openapi/dist/api-bundle.yaml
  - specs/openapi/dist/java/com/virtualcompanion/api/ErrorCode.java
  - specs/openapi/dist/java/com/virtualcompanion/api/ErrorEnvelope.java
  - specs/openapi/dist/java/com/virtualcompanion/api/VirtualCompanionApi.java
  - specs/openapi/dist/openapi.snapshot.json
  - specs/openapi/dist/typescript/api.ts
  - specs/openapi/virtual-companion.yaml
writeAllowlist:
  - docs/tasks/TASK-0122-auth-abuse-admission-control.md
  - docs/tasks/context/TASK-0122.context-lock.yaml
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - docs/evidence/TASK-0122/**
  - docs/handoffs/TASK-0122.json
  - specs/catalog/error-codes.yaml
  - specs/generated/catalog.snapshot.json
  - specs/generated/java/com/virtualcompanion/catalog/ErrorCode.java
  - specs/generated/openapi/catalog-schemas.yaml
  - specs/generated/sql/catalog-values.sql
  - specs/generated/typescript/catalog.ts
  - specs/contracts/identity-session-boundary-contract.yaml
  - specs/openapi/virtual-companion.yaml
  - specs/openapi/dist/api-bundle.yaml
  - specs/openapi/dist/java/com/virtualcompanion/api/ErrorCode.java
  - specs/openapi/dist/java/com/virtualcompanion/api/ErrorEnvelope.java
  - specs/openapi/dist/java/com/virtualcompanion/api/VirtualCompanionApi.java
  - specs/openapi/dist/openapi.snapshot.json
  - specs/openapi/dist/typescript/api.ts
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/application/AuthAbuseGuard.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/application/AuthService.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/AuthDataSourceConfig.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/AuthSecurityConfig.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/AuthSourceAdmissionFilter.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/web/AuthController.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/web/AuthExceptionHandler.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/web/AuthRateLimitException.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/web/AuthRateLimitResponse.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/application/AuthAbuseGuardTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/config/AuthSecurityIntegrationTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/config/AuthSourceAdmissionFilterTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/web/AuthControllerAbuseControlTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/web/AuthControllerCookieTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/web/AuthControllerValidationTest.java
forbiddenPaths:
  - docs/tasks/TASK-0109-*
  - docs/tasks/TASK-011*-*
  - docs/tasks/TASK-0120-*
  - docs/tasks/TASK-0121-*
  - docs/tasks/context/TASK-0109.context-lock.yaml
  - docs/tasks/context/TASK-011*.context-lock.yaml
  - docs/tasks/context/TASK-0120.context-lock.yaml
  - docs/tasks/context/TASK-0121.context-lock.yaml
  - docs/evidence/TASK-0109/**
  - docs/evidence/TASK-011*/**
  - docs/evidence/TASK-0120/**
  - docs/evidence/TASK-0121/**
  - docs/handoffs/TASK-0109.json
  - docs/handoffs/TASK-011*.json
  - docs/handoffs/TASK-0120.json
  - docs/handoffs/TASK-0121.json
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
  - specs/catalog/catalog-manifest.yaml
  - specs/catalog/product-scope.yaml
  - specs/catalog/age-states.yaml
  - specs/catalog/data-categories.yaml
  - specs/catalog/generation-states.yaml
  - specs/catalog/memory-candidate-statuses.yaml
  - specs/catalog/memory-item-statuses.yaml
  - specs/catalog/memory-scopes.yaml
  - specs/catalog/message-states.yaml
  - specs/catalog/model-protocols.yaml
  - specs/catalog/processing-purposes.yaml
  - specs/catalog/provider-attempt-statuses.yaml
  - specs/catalog/realtime-events.yaml
  - specs/catalog/risk-levels.yaml
  - specs/catalog/route-decision-statuses.yaml
  - specs/catalog/safety-classifier-outcomes.yaml
  - specs/catalog/service-modes.yaml
  - specs/generated/java/com/virtualcompanion/catalog/AgeState.java
  - specs/generated/java/com/virtualcompanion/catalog/AssistantMessageState.java
  - specs/generated/java/com/virtualcompanion/catalog/DataCategory.java
  - specs/generated/java/com/virtualcompanion/catalog/GenerationState.java
  - specs/generated/java/com/virtualcompanion/catalog/MemoryCandidateStatus.java
  - specs/generated/java/com/virtualcompanion/catalog/MemoryItemStatus.java
  - specs/generated/java/com/virtualcompanion/catalog/MemoryScope.java
  - specs/generated/java/com/virtualcompanion/catalog/ModelProtocol.java
  - specs/generated/java/com/virtualcompanion/catalog/ProcessingPurpose.java
  - specs/generated/java/com/virtualcompanion/catalog/ProviderAttemptStatus.java
  - specs/generated/java/com/virtualcompanion/catalog/RealtimeEventType.java
  - specs/generated/java/com/virtualcompanion/catalog/RiskLevel.java
  - specs/generated/java/com/virtualcompanion/catalog/RouteDecisionStatus.java
  - specs/generated/java/com/virtualcompanion/catalog/SafetyClassifierOutcome.java
  - specs/generated/java/com/virtualcompanion/catalog/ServiceMode.java
  - specs/generated/java/com/virtualcompanion/catalog/UserMessageState.java
  - specs/contracts/beta-gate-contract.yaml
  - specs/contracts/database-ownership-contract.yaml
  - specs/contracts/finalization-contract.yaml
  - specs/contracts/generation-contract.yaml
  - specs/contracts/license-cost-boundary-contract.yaml
  - specs/contracts/memory-contract.yaml
  - specs/contracts/model-protocol-contract.yaml
  - specs/contracts/realtime-contract.yaml
  - "**/db/migration/**"
  - service/platform/**
  - service/modules/**
  - service/adapters/**
  - service/tests/**
  - service/apps/runtime/pom.xml
  - service/apps/runtime/src/main/resources/**
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/application/RefreshTokens.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/AdminSeedRunner.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/AuthRequestBodyLimitFilter.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/CookieCsrfGuardFilter.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/jwt/**
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/tenant/**
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/web/AuthErrorException.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/web/AuthInputLimits.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/web/AuthRequests.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/web/AuthResponses.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/web/ErrorEnvelope.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/application/AuthServiceTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/config/AdminSeedRunnerTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/config/AuthRequestBodyLimitFilterTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/jwt/**
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/tenant/**
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
  - skills/catalog-change/SKILL.md
  - skills/contract-change/SKILL.md
  - specs/catalog/catalog-manifest.yaml
  - specs/catalog/error-codes.yaml
  - specs/contracts/identity-session-boundary-contract.yaml
  - specs/openapi/virtual-companion.yaml
  - docs/evidence/TASK-0109/zcode-remediation-handoff.md
  - docs/tasks/TASK-0112-auth-input-hygiene.md
  - docs/handoffs/TASK-0112.json
  - docs/tasks/TASK-0121-auth-body-token-fences.md
  - docs/evidence/TASK-0121/evidence-pack.json
  - docs/handoffs/TASK-0121.json
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
      Owner 明确要求 Codex 接管当前项目全部审计与修复，并进一步要求“不用询问我，作为长线任务
      跑下去”。TASK-0121 已 ACCEPTED、推送、远端 0/0 且 post-terminal Doctor PASS；其 Handoff
      与 project-state 的唯一下一动作逐字指定通过 task-intake 创建 TASK-0122。
  - scope: single-instance-auth-abuse-admission-policy
    approvedBy: repository-owner
    approvedAt: "2026-08-09"
    sourceThreadId: 019fdf92-9c99-7400-a2ea-d490ef3d7e15
    evidence: >-
      Owner 长线授权 Codex 在机器真源与最小风险原则内决定拆卡、阈值和实现细节；TASK-0121 终态
      nextAction 已冻结 login source+account 5/15min、source 20/min，refresh source 10/min、
      token 5/min，1/2/4/8/16/60s 非阻塞退避、固定 429、Retry-After、有界状态和 single-instance
      限制。本卡进一步冻结每 route source 4096、login key 8192、refresh key 8192、全局并发 4、
      30 分钟 admission streak 失效、ephemeral HMAC key 和无活跃状态淘汰的失败关闭语义。
  - scope: catalog-auth-rate-limited-code
    approvedBy: repository-owner
    approvedAt: "2026-08-09"
    sourceThreadId: 019fdf92-9c99-7400-a2ea-d490ef3d7e15
    evidence: >-
      已接受的 TASK-0121 nextAction 明确要求固定 429 AUTH_RATE_LIMITED。本卡只向 ErrorCode 末尾
      追加 ordinal 16，不改写或复用既有 Code/ordinal，并同步 identity contract、OpenAPI 与生成物。
  - scope: local-exact-tree-fallback
    approvedBy: repository-owner
    approvedAt: "2026-08-09"
    sourceThreadId: 019fdf92-9c99-7400-a2ea-d490ef3d7e15
    evidence: >-
      Owner 要求长线不中断推进；TASK-0102/TASK-0108 已记录同一配额周期 includedMinutes=
      usedMinutes=2000、paidBudgetUsd=0、stopUsageEnabled=true、dispatchCount=0，TASK-0110
      exact-SHA run 31286798584 在无 runner、零 step 状态终止；TASK-0112 至 TASK-0121
      已按同一 READY 冻结 fallback 合规 ACCEPTED。本卡冻结 LOCAL_EXACT_TREE_FALLBACK，
      远端继续如实为非 PASS，PASS 只绑定记录的本机 Commit/Tree 与精确命令覆盖。
independentReview: required
reviewers: []
requiredCommands:
  - python scripts/harness/precheck.py --task TASK-0122
  - docker run --rm -v /Users/hxf/projects/virtual-companion:/workspace -v vc-maven-cache:/root/.m2 -w /workspace maven:3.9-eclipse-temurin-25-alpine ./mvnw --batch-mode --no-transfer-progress -pl service/apps/runtime -am -Dtest=AuthAbuseGuardTest,AuthSourceAdmissionFilterTest,AuthControllerAbuseControlTest,AuthControllerCookieTest,AuthControllerValidationTest,AuthSecurityIntegrationTest,AuthServiceTest -Dsurefire.failIfNoSpecifiedTests=false test
  - python scripts/dev/openapi_tool.py validate
  - python scripts/dev/openapi_tool.py diff --fail-on-drift
  - docker run --rm -v /Users/hxf/projects/virtual-companion:/workspace -v vc-maven-cache:/root/.m2 -w /workspace maven:3.9-eclipse-temurin-25-alpine ./mvnw --batch-mode --no-transfer-progress verify
  - git diff --check
```

> 本卡是 TASK-0121 终态 Handoff 授权的独立延续卡；Backlog 中没有 TASK-0122，因此不写
> `planningBacklog` 或 `planningContractHash`。本卡只交付可证明的 Technical Alpha 单实例
> 准入边界，不把本地内存状态冒充跨实例产品级滥用防护。

## 背景与用户可观察目标

TASK-0121 已关闭 Auth 请求体、字段和 cookie token 的字节放大，但 login/refresh 仍可无限触发
repository、BCrypt、session JDBC、successor token 生成及逐次失败审计；runtime 使用虚拟线程而 Auth
DataSource pool 只有 5 个连接。仓库没有可信 gateway、共享 limiter、Redis 或其他跨实例原子能力，且
不能信任未配置的转发头。

完成后，单实例 runtime 在任何昂贵 Auth 操作前执行 route-source、source+canonical-username 或
refresh-token admission；并发舱壁绝不等待请求线程；超额请求固定返回 429 与正整数 Retry-After；状态
容量、窗口、退避、过期、时钟倒退和 key 隐私均有确定测试。该边界明确不关闭多实例、密码策略或审计
保留残余。

## 范围内

- 新增只匹配精确 POST login/refresh 的 source admission filter；source 只取 Servlet
  `getRemoteAddr()`，忽略 `Forwarded`/`X-Forwarded-For`/`X-Real-IP`。
- Security chain 顺序冻结为 CookieCsrfGuardFilter -> AuthSourceAdmissionFilter ->
  AuthRequestBodyLimitFilter -> MVC；三个 filter 不得作为容器级 filter 重复注册。
- source filter 在读取 login body 前原子消费 route 独立 rolling window，并以 tryAcquire 获取全局
  4-slot semaphore；lease 持有到完整下游返回，容量不足固定 429/Retry-After=1，禁止 sleep/排队。
- login source 每 60 秒允许 20 次；refresh source 每 60 秒允许 10 次，两个 scope 状态和容量隔离。
- MVC 通过字段/token 边界后、调用 AuthService 前，login 按 HMAC(source + canonical username)
  每 900 秒允许 5 次，refresh 按 HMAC(raw token) 每 60 秒允许 5 次。
- key admission 的第 1/2/3/4/5/6+ 次已准入请求分别设置 1/2/4/8/16/60 秒下次可用时间；streak
  只在 30 分钟没有已准入请求后失效，不因成功响应清零，避免 outcome race。
- 所有 scope 使用进程启动时生成的 256-bit ephemeral HMAC-SHA-256 key 与 domain separation；map
  只保存固定长度 digest、窗口时间和计数，不保存 raw IP、username、password 或 token。
- 每个 login/refresh source scope 上限 4096；login composite 上限 8192；refresh token 上限 8192。
  活跃 key 不做 LRU/随机淘汰；满容量的新 key 固定 429/Retry-After=60，过期 state 才能回收。
- 注入 Clock 并把观测时间钳制为进程内单调不减；同 key check+consume 原子，并发不得超发。
- Catalog 末尾追加 `AUTH_RATE_LIMITED` ordinal 16；HTTP 429 固定 envelope message
  `Authentication is temporarily rate limited`，Retry-After 为向上取整的正整数秒。
- identity contract 与 OpenAPI 同步 source 信任、窗口/容量/退避、single-instance、429 header 和残余。
- 新增 guard/filter/controller/chain 测试，并回归现有 cookie、validation、service 和 security 测试。

## 明确范围外

- 不实现跨 JVM/多实例共享限流、重启后状态保留、Redis/数据库/gateway limiter 或 trusted-proxy 解析。
- 不实现 account-only 跨 source 防护；source+username 不能宣称关闭分布式 credential stuffing。
- 不实现永久账户锁定、写 DISABLED、密码最低长度/复杂度/breach/history 策略。
- 不修改 identity_auth_event 表、逐次审计写入、聚合、去标识化、保留、清理或 90 日策略。
- 不修改 migration、repository、SQL、DataSource pool、事务、refresh rotation、JWT、Cookie 属性或租户语义。
- 不限制 logout/admin-account/Bearer JWT/CSRF header/cookie、其他 body 或网络层 header bytes。
- 不新增依赖、后台线程、定时任务、外部服务或付费/SaaS-only 必需运行时。
- 不修改 frontend、infra、provider、modelruntime、memory、safety、CI、Harness 或历史任务制品。

## 输入和前置条件

- Base 固定为 TASK-0121 已推送、远端 0/0 且 post-terminal Doctor PASS 的终态
  `55629d56be58006b4cffc1fc474229293a04381d`。
- Context Lock 只读取 Base Commit 中 84 个精确输入，按
  `SHA256_ORDINAL_SORTED_PATH_EQUALS_HASH_LF_V1` 独立复算。
- TASK-0121 ACCEPTED Evidence/Handoff 已明确 rate limiting、soft lock、密码和审计残余，没有把它们误报关闭。
- Catalog/Contract 受保护路径触发 C3、`catalog-change@1.0.0`、`contract-change@1.0.0` 与独立 Reviewer。
- Catalog 真源只在 `specs/catalog/error-codes.yaml`；生成物只由 `catalog_tool.py generate` 产生。
- OpenAPI 真源只在 `specs/openapi/virtual-companion.yaml`；dist 只由 `openapi_tool.py generate` 产生。

## API / 事件 / 数据契约

- 新 ErrorCode 是向后兼容的枚举追加，不复用既有 ordinal；login/refresh 新增 429 response，不改变成功体。
- 429 必含 `Retry-After: <positive integer seconds>`、JSON ErrorEnvelope code/message；不得返回 bucket、key、
  剩余次数、IP、username、token、account existence 或内部容量。
- `Retry-After = max(1, ceil(max(nextBackoffAt, earliestRollingReleaseAt) - now))`；容量/舱壁拒绝分别为
  60/1 秒。被 429 拒绝的请求不追加窗口、不递增 streak，不形成自延长。
- source bucket 统计通过 CSRF 后进入精确 route 的所有请求；login composite 与 refresh token bucket 只在
  输入边界通过后统计。source 拒绝不触碰后续 key bucket。
- unknown username、wrong password 与 DISABLED 在相同 source/input key 上具有相同 admission 行为；既有
  AuthService 404/401 成功后错误语义保持，不宣称由本卡消除既有差异。
- 进程 HMAC key、digest 和 limiter state 不持久化、不记录、不暴露到 metrics/API/Evidence；重启全部重置。
- 如果部署经反向代理导致所有 `remoteAddr` 都是代理地址，本边界会安全地聚合限流但可能误伤；该拓扑在
  trusted edge/共享 limiter 完成前不得宣称支持水平扩展或真实用户发布。

## 权限、RLS 和数据处理要求

- login/refresh 的 public 权限保持；filter/guard 不建立身份、不信任 account existence 或客户端 owner 字段。
- raw source/username/token 只作为当前 HMAC 输入短暂存在；map、异常、响应、日志和 Evidence 仅含固定值。
- limiter 不访问数据库，不改变 RLS、SECURITY DEFINER、repository、owner context、account/session 行。
- 429 不写逐次 LOGIN_FAILURE；已经准入后由 AuthService 产生的既有审计语义保持。

## 状态机和失败行为

- 非目标 method/path 不消费 limiter、不读取 body、不获取 semaphore，原链行为保持。
- Cookie/Origin/CSRF 失败先返回既有 403；source/filter/key state 均不消费，login body 零读取。
- source/window/capacity/舱壁拒绝发生在 body filter 前；login body 零读取，MVC/AuthService/BCrypt/JDBC/audit
  零调用。username composite 拒绝必须先解析已受 16384-byte fence 的 JSON，但 AuthService 仍零调用。
- refresh null/blank/超 512-byte token 不做 token HMAC，由 TASK-0121 既有 401 处理；source quota仍已消费。
- rolling window exact N 放行、N+1 拒绝；边界时间到达即回收对应 timestamp。时间倒退按最后观测时间处理。
- 已准入 key 原子写入 timestamp、streak 与 nextBackoffAt 后才允许进入 AuthService；并发失败不能超发。
- success/failure 都不回写或重置 quota，避免旧请求 outcome 覆盖较新的 admission state。
- active map 满时只清理真实过期 state；仍满则新 key fail closed，不驱逐活跃 key，不影响其他 scope。
- 任何拒绝都不 sleep、不阻塞等待、不截断输入、不降级为 permit；内部异常固定 fail closed 为 429。

## 模型、Prompt、记忆和安全边界

本卡不触碰 Model、Prompt、Generation、Memory 或 Safety。Auth 原始输入、HMAC key 与 limiter digest 不得进入
模型上下文、普通日志、URL 或前端存储；既有授权、租户、最终化和安全不变量保持。

## 验收标准

1. source rolling exact/one-over：login 20/21、refresh 10/11；route/capacity 独立，改变转发头不改变 key。
2. login composite 5/6 over 900s、refresh token 5/6 over 60s；canonical username 大小写/首尾空格共享 key。
3. progressive 1/2/4/8/16/60s、30 分钟 streak 失效、Retry-After max/ceil、429 不自增均由 mutable Clock 测试。
4. Clock 倒退不放宽窗口；同 key 并发最多通过原子预算，全局同时在途 Auth 最多 4，拒绝从不等待线程。
5. 四个 scope 达到测试容量后不淘汰活跃 key；新 key 固定 429，过期可回收，token flood 不影响 login/source。
6. CSRF/source/舱壁拒绝时 counting request body 零读取，下游/filter/MVC/AuthService 零调用；username key 拒绝
   只允许已受限 JSON 解析，BCrypt/JDBC/JWT/successor/audit 零调用。
7. refresh token 先受 512-byte fence；null/blank/one-over 不做 token HMAC，保持 401；正常 token 才进入 bucket。
8. 429 精确包含新 Catalog code、固定 message、正整数 Retry-After 与 JSON UTF-8，不含 raw/digest/bucket/details。
9. Security chain 中 Cookie 在 source 前、source 在 body 前，相关 filters 没有容器级重复注册；现有 CSRF/body/JWT 回归。
10. Catalog ordinal 0..15 不变、16 唯一追加；Catalog/OpenAPI source 与全部实际变化的生成物 drift gate PASS。
11. migration、repository、DataSource pool、JWT、cookie、frontend、Harness 和历史制品零 diff。
12. 独立 Reviewer 绑定最终候选 Commit/Tree，最终无 P0/P1；正式命令全部绑定同一 clean 候选。

## 必跑检查

以 YAML `requiredCommands` 的精确 argv 为准。迭代阶段先运行新增 guard/filter/controller tests 和受影响 Auth
回归，并使用 generator 同步 Catalog/OpenAPI；这些不替代正式门禁。候选提交和独立 Reviewer PASS 后，
canonical Precheck、定向 reactor、两条 OpenAPI gate、根级 Maven verify 与唯一次无参数 `git diff --check`
按冻结顺序各执行一次，记录真实退出码、Commit/Tree、时间、stdout/stderr 哈希和环境。

## 回滚或前向修复

- 候选前可在白名单内调整实现；Reviewer blocking finding 只允许一个 fix batch 和 R2。
- 生成物必须从真源重生；不得手改、删除测试、skip、扩大 timeout 或放宽 quota 以通过门禁。
- 已推送历史只前向追加。实现问题的前向修复可禁用整个新增 admission bean/chain 并回到 Base 行为，但必须由
  新任务授权；不得静默复用 AUTH_RATE_LIMITED 为其他语义。
- 若不能在 C3 单卡内证明 filter 顺序、原子状态、容量和 no-leak，则真实 REJECTED 关闭并拆新永久卡。

## 停止条件

- 需要信任转发头、引入外部/共享服务、修改 migration/SQL/repository/DataSource pool 或实现永久锁定。
- 无法证明 body-before-service、token-before-HMAC、同 key 原子、bounded memory 或 active-key no-eviction。
- 新 code 的兼容、HTTP/Retry-After 语义、生产者/消费者、Context、Diff Scope 或生成 ownership 不明确。
- 需要修改 forbidden path、删除/跳过测试、手改生成物、阻塞 sleep 或记录 raw/digest 凭据。
- 候选身份、Reviewer、formal command 结果改变，超过唯一 fix batch，R2 出现新 P0/P1，或达到 hard fuse。

## Evidence Pack

输出 `docs/evidence/TASK-0122/evidence-pack.json`、最终独立 review、LOCAL_EXACT_TREE_FALLBACK 记录与
pre-closure 请求，并生成 `docs/handoffs/TASK-0122.json`。终态 reviewer 数组只保留绑定最终候选的 PASS
Reviewer；Handoff 明确 single-instance、多实例/密码/审计残余，`nextAction` 与终态 project-state 逐字一致。

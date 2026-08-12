# TASK-0168：§4.1 P1-04 应用侧 owner 注入（OncePerRequestFilter 绑定可信 principal 到 DB session）+ 附带修 SchemaReadiness stale 断言

```yaml
taskId: TASK-0168
state: DRAFT
owner: repository-owner
riskClass: C2
requiredSkills:
  - task-delivery-flow
  - task-intake
requiredSkillVersions:
  task-delivery-flow: "1.3.7"
  task-intake: "1.2.7"
targetSkillVersions: {}
baseCommit: b465e73b91347c257f3ab64e78aa960ce810f1ef
authorizationCommit: ""
contextFingerprint: 0d74dd3f6bbfecc6ceac4f1263c664eb9d17c518f30adf32200863f22d3f4e71
contextLock: docs/tasks/context/TASK-0168.context-lock.yaml
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
  overallElapsed: {anchor: DRAFT_COMMIT, terminal: TERMINAL_COMMIT, recordingRequired: true, resetOranchorForbidden: true}
  intakeActivation: {anchor: DRAFT_COMMIT, terminal: READY_DOCTOR_TERMINAL, targetWallMinutes: 60, hardFuseWallMinutes: 90, timeoutStatus: TIMEOUT, closureOnlyOverrunAllowed: true}
  candidateExecution: {anchor: READY_DOCTOR_PASS_AND_IN_PROGRESS_COMMIT, notStartedOutcome: NOT_STARTED, notStartedEligibility: {readyDoctorNonPassRequired: true, readyDoctorPassForbidden: true, inProgressCommitForbidden: true, candidateFreezeForbidden: true}, candidateDeadlineMinutes: 45, targetWallMinutes: 60, hardFuseWallMinutes: 90, timeoutStatus: TIMEOUT, closureOnlyOverrunAllowed: true}
  reviewer: {maximumMinutes: 30, timeoutStatus: TIMEOUT, missingTerminalStatus: UNKNOWN}
complexityAssessment:
  policySource: .harness/task-delivery-policy.yaml
  evaluatedBefore: READY
  riskClass: C2
  surfaceId: TASK_0168_OWNER_INJECTION_FILTER_TRUSTED_PRINCIPAL_BINDING
  policySurfaces: [AUTHORIZATION]
  distinctCrossRiskSurfaces: 1
  reviewerMinutesEstimate: 15
  terminalCheckMinutesEstimate: 20
  estimatedWallMinutes: 30
  thresholdsTriggered: []
  splitRequired: false
  ownerIndivisibleAuthorization: false
validationPlan: {frozenBefore: READY, policySource: .harness/ci-execution-policy.yaml, selectedChannel: LOCAL_EXACT_TREE_FALLBACK, profile: precheck}
requiredCommands:
  - python scripts/harness/precheck.py --task TASK-0168
  - JAVA_HOME=/opt/homebrew/opt/openjdk@25/libexec/openjdk.jdk/Contents/Home ./mvnw --batch-mode --no-transfer-progress -pl service/apps/runtime -am test
  - python -m unittest discover -s scripts/harness/tests -p "test_*.py"
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
  - docs/evidence/TASK-0109/zcode-remediation-handoff.md
  - docs/evidence/TASK-0167/evidence-pack.json
  - docs/evidence/TASK-0167/review-r1.md
  - docs/handoffs/TASK-0167.json
  - docs/tasks/TASK-0167-quota-ledger-release-reservation-idempotency.md
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
  - specs/contracts/authorization-contract.yaml
  - specs/contracts/database-ownership-contract.yaml
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/jwt/JwtAuthenticationFilter.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/jwt/JwtTokenService.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/AuthSecurityConfig.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/AuthDataSourceConfig.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/tenant/OwnerContext.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/tenant/OwnerContextTest.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/web/AuthController.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/baseline/BaselineController.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/config/AuthSecurityIntegrationTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/config/SchemaReadinessHealthIndicatorTest.java
  - service/platform/persistence/src/main/resources/db/migration/V1__extensions_roles_functions.sql
  - service/platform/persistence/src/main/resources/db/migration/V17__sd_owner_param_trusted_assertion.sql
  - owner-authorization://longline-2026-08-09
writeAllowlist:
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/tenant/OwnerInjectionFilter.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/AuthSecurityConfig.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/web/InternalMeController.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/tenant/OwnerInjectionFilterTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/config/AuthSecurityIntegrationTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/config/SchemaReadinessHealthIndicatorTest.java
  - docs/tasks/TASK-0168-owner-injection-filter-trusted-principal-binding.md
  - docs/tasks/context/TASK-0168.context-lock.yaml
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - docs/evidence/TASK-0168/**
  - docs/handoffs/TASK-0168.json
forbiddenPaths:
  - docs/tasks/TASK-00*-*
  - docs/tasks/TASK-010*-*
  - docs/tasks/TASK-011*-*
  - docs/tasks/TASK-012*-*
  - docs/tasks/TASK-013*-*
  - docs/tasks/TASK-014[0-9]-*
  - docs/tasks/TASK-015[0-9]-*
  - docs/tasks/TASK-016[0-7]-*
  - docs/tasks/context/TASK-00*.context-lock.yaml
  - docs/tasks/context/TASK-010*.context-lock.yaml
  - docs/tasks/context/TASK-011*.context-lock.yaml
  - docs/tasks/context/TASK-012*.context-lock.yaml
  - docs/tasks/context/TASK-013*.context-lock.yaml
  - docs/tasks/context/TASK-014[0-9].context-lock.yaml
  - docs/tasks/context/TASK-015[0-9].context-lock.yaml
  - docs/tasks/context/TASK-016[0-7].context-lock.yaml
  - docs/evidence/TASK-00*/**
  - docs/evidence/TASK-010*/**
  - docs/evidence/TASK-011*/**
  - docs/evidence/TASK-012*/**
  - docs/evidence/TASK-013*/**
  - docs/evidence/TASK-014[0-9]/**
  - docs/evidence/TASK-015[0-9]/**
  - docs/evidence/TASK-016[0-7]/**
  - docs/handoffs/TASK-00*.json
  - docs/handoffs/TASK-010*.json
  - docs/handoffs/TASK-011*.json
  - docs/handoffs/TASK-012*.json
  - docs/handoffs/TASK-013*.json
  - docs/handoffs/TASK-014[0-9].json
  - docs/handoffs/TASK-015[0-9].json
  - docs/handoffs/TASK-016[0-7].json
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
  - scripts/harness/**
  - .github/workflows/**
  - specs/**
  - service/modules/**
  - service/adapters/**
  - service/tests/**
  - service/platform/**
  - service/**/pom.xml
  - service/platform/persistence/src/main/resources/db/migration/V[1-9]__*.sql
  - service/platform/persistence/src/main/resources/db/migration/V1[0-9]__*.sql
  - service/platform/persistence/src/main/resources/db/migration/V20__*.sql
  - service/platform/persistence/src/main/resources/db/migration/V21__*.sql
  - infra/db/run-rls-tests.sh
  - infra/db/tests/0[1-9]_*.sql
  - infra/db/tests/[1-3][0-9]_*.sql
  - infra/db/tests/4[0-9]_*.sql
  - infra/db/tests/5[0-9]_*.sql
  - infra/db/tests/6[01]_*.sql
  - frontend/**
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
  - .harness/tools.lock.yaml
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
  - specs/contracts/authorization-contract.yaml
  - specs/contracts/database-ownership-contract.yaml
  - docs/evidence/TASK-0109/zcode-remediation-handoff.md
  - docs/handoffs/TASK-0167.json
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
    approvedAt: "2026-08-12"
    sourceThreadId: 2c8d4f6a-5e3b-4a9c-8d1f-3b5c7e9a2d4f
    evidence: >-
      Owner 2026-08-12 授权长线审计修复一次一张新卡推进，逐项解锁 Owner-gate，从依赖根 P1-04（DB principal）
      起手，并采用 A1（OncePerRequestFilter）+ D1（骨架卡独立闭合 HTTP 半边）方案。经当前 HEAD b465e73 代码考古
      复核确认 P1-04（§4.1 三个 Owner 决策点）真实状态：③ runtime role 窄命令+只读（V16 REVOKE 17 表 DML + 断言、
      test 52/53）与 ①DB 半边 SD owner 可信断言（V17 34 SD 函数改 p_owner_user_id IS DISTINCT FROM current_owner_id
      即 raise、test 54/55）均已由 TASK-0153/0154 闭合；②migration/runtime principal 分离部分闭合
      （AuthDataSourceConfig.flywayMigratorCredentialsGuard 已分离 VC_MIGRATOR_DB_* 与 runtime 池），P1-11 readiness
      仍 OWNER_GATE（TASK-0155 REJECTED 待重做）。P1-04 仍 OWNER_GATE 的真正核心 = ①应用半边"可信 owner 注入器"未
      接线：OwnerContext.asOwner（OwnerContext.java:33 事务级 set_config('vc.owner_user_id',?,true) commit 自清）是
      现成原语，但全仓零业务调用；JwtAuthenticationFilter.java:46,48-51 已构造 UsernamePasswordAuthenticationToken
      (Principal record(accountId,role,username) at JwtTokenService.java:94) 绑入 SecurityContextHolder:53，但无
      filter/aspect 把 principal.accountId() 喂给 OwnerContext.asOwner；V17 fail-closed 断言今天因无供给者会让任何
      真实业务调用立即 raise。本卡 service/apps/runtime/** 6 Java 文件（3 新 OwnerInjectionFilter/InternalMeController/
      OwnerInjectionFilterTest + 3 改 AuthSecurityConfig 注册 addFilterAfter + AuthSecurityIntegrationTest filter 顺序+
      MockMvc + SchemaReadinessHealthIndicatorTest stale 断言修复），非保护路径逐项核对 protected-paths.yaml 不触
      modelruntime/safety/memory/db/migration/specs，新增 GET /api/internal/me 不进 OpenAPI（只枚举 /api/v1/**），故
      C2 independentReview: true 保留 R1，不触 C3/C4 不触 database-migration；不新增 V22，V1-V21 frozen。附带修
      SchemaReadinessHealthIndicatorTest:145-146 stale 断言（期望 17→21，classpath 实际最高 V21）：该测试自 V18
      (TASK-0158) 起即 stale，前序卡只跑 modelruntime 模块从未跑 runtime 全模块故潜伏；本卡是第一个跑 runtime
      全模块（mvn -pl service/apps/runtime -am test）的卡，暴露并修复它（仅 :143-146 注释+断言值，不动 readiness
      决策逻辑与构造参数）。完整 unittest + 根级 Maven verify 按 Owner static-gates-only 策略 deferred to unified audit。
      本卡 DRAFT 初版 writeAllowlist 未含 SchemaReadinessHealthIndicatorTest（5 Java），mvn runtime 验证暴露 stale
      test 阻塞；经 Owner 2026-08-12 授权 git reset --mixed b465e73（3 commit 未推送）扩范围重做，writeAllowlist/
      readAllowlist 加 SchemaReadinessHealthIndicatorTest，实现文件保留。
  - scope: local-exact-tree-fallback
    approvedBy: repository-owner
    approvedAt: "2026-08-12"
    sourceThreadId: 2c8d4f6a-5e3b-4a9c-8d1f-3b5c7e9a2d4f
    evidence: >-
      Owner 要求长线继续推进；既有 includedMinutes=usedMinutes=2000、paidBudgetUsd=0、stopUsageEnabled=true、
      dispatchCount=0 与无 runner exact-SHA 事实保持不变。本卡重新冻结 LOCAL_EXACT_TREE_FALLBACK
      （profile=precheck），远端仍如实非 PASS，不复用任何跨卡 Reviewer 或命令 PASS（TASK-0167 R1 PASS 不复用）。
independentReview: true
reviewers: []
```

> 本卡不在 Backlog 中，不写 `planningBacklog` 或 `planningContractHash`。它是 §4.1 P1-04（caller 可伪造 owner context）
> 的**应用侧接线**卡（见 `docs/evidence/TASK-0109/zcode-remediation-handoff.md` §4.1 第①点"可信 principal 如何绑定到
> 数据库 session/connection pool，谁有权设置 owner context"）。P1-04 的 DB 半边（V17 SD owner 可信断言）已由
> TASK-0154 ACCEPTED 闭环；本卡补**应用半边** owner 注入器。沿用 `owner-authorization://longline-2026-08-09`
> 长线授权（hash `cc0f91c1...`），与 TASK-0153..0167 同属 idle DRAFT 治理例外，不进 backlog。

## 背景与用户可观察目标

§4.1 P1-04（TASK-0109 §4.1 第①点）：可信 principal 如何绑定到数据库 session/连接池，谁有权设置 owner context。
DB 半边已闭合（TASK-0154 V17：34 个 SECURITY DEFINER 函数不再信任 caller 传参，改为强断言
`p_owner_user_id IS DISTINCT FROM vc.current_owner_id()` 即 raise，要求 owner 上下文必须由"服务端可信路径"预先建立）。
本卡闭合其**应用半边剩余缺口**，并附带修复一个本卡验证过程中暴露的 pre-existing stale test。

**缺陷（经当前 HEAD b465e73 代码核实，非盲信清单）：**

- `OwnerContext.java:33` 已提供 `asOwner(long ownerUserId, Runnable work)` 原语：在 `TransactionTemplate.executeWithoutResult`
  内执行 `SELECT set_config('vc.owner_user_id', ?, true)`（`OwnerContext.java:38-40`，第三参 `true`=事务级，commit/rollback
  自动清除），然后 `work.run()`。设计正确，commit 自清使泄漏的连接不携带 owner。
- 但 `OwnerContext.asOwner` 在整个仓库**只有定义、单测（`OwnerContextTest`）、bean 声明（`AuthDataSourceConfig.java:141-146`）
  三处出现，零业务调用点**。
- `JwtAuthenticationFilter.java:38-57` 已是 `OncePerRequestFilter`：`:46` 调 `tokenService.verifyAccessToken(token)` 得
  `JwtTokenService.Principal`（record `(long accountId, String role, String username)`，定义于 `JwtTokenService.java:94`）；
  `:48-51` 构造 `UsernamePasswordAuthenticationToken(principal, null, ...)` 绑入 `SecurityContextHolder`（`:53`）。即 JWT
  侧的 owner 来源（`principal.accountId()` = owner_user_id = JWT subject）已确定且可信。
- `AuthSecurityConfig.java:87-120` 的 `securityFilterChain` 在 `:115` `.addFilterBefore(jwtAuthenticationFilter,
  UsernamePasswordAuthenticationFilter.class)`；admission 三件套挂在 JWT filter 之前（`:116-118`）。
- **缺口**：从 JWT 解析得到的 `Principal.accountId` 到 `SET LOCAL current_owner_id` 之间，没有任何 filter/aspect/interceptor
  把两者连起来（runtime main 内 `@Aspect/@Around/@Before` grep 0 命中）。请求线程的 `vc.owner_user_id` 在到达任何业务 SQL 前
  不会被设置。因此 **V17 要求的"server-trusted current_owner_id"在运行时还没有供给者**——V17 的 fail-closed 断言今天会让
  任何真实业务调用立即 raise。

**附带发现（pre-existing stale test，本卡验证暴露并修复）：** `SchemaReadinessHealthIndicatorTest:145-146` 断言
`expectedSchemaVersionFromClasspath()==17`，但 persistence 模块 jar 在 classpath 实际携带 V1..V21（V18 TASK-0158、V20
TASK-0164、V21 TASK-0165），方法返回 21。该断言自 V18 起即 stale，因前序卡均只跑 `mvn -pl service/modules/modelruntime
-am test`（不含 runtime 模块）而潜伏；本卡是第一个跑 runtime 全模块的卡，`mvn -pl service/apps/runtime -am test` 暴露了
它。该测试文件其余的 `17` 是 `new SchemaReadinessHealthIndicator(...,17)` 的构造参数（测 readiness 决策逻辑，mock 驱动，
pass），只有 `:145-146` 这一处断言 classpath 扫描结果，是 stale。base `b465e73` 同样失败（pre-existing，非本卡引入）。

**范围限定（纯 Java 实现卡 C2，service/apps/runtime 非保护路径）：** 本卡只在 `service/apps/runtime/**` 下新增/修改 6 个
Java 文件，把"认证请求 → 取 Principal.accountId → OwnerContext.asOwner 包裹下游"接线落地，并修一处 stale 断言。不修改
任何 migration（V1-V21 frozen）、任何 DB test、任何 catalog/contract、任何 pom、任何 OpenAPI 源（新增 `/api/internal/me`
与现有 `/api/internal/baseline` 同属 internal 命名空间，不进 `specs/openapi` 只枚举 `/api/v1/**` 的契约源）。

用户可观察结果：
1. 新增 `OwnerInjectionFilter`（OncePerRequestFilter）：在 `JwtAuthenticationFilter` 之后执行，从
   `SecurityContextHolder` 取 `JwtTokenService.Principal`，用 `ownerContext.asOwner(principal.accountId(), () ->
   filterChain.doFilter(...))` 包住下游；认证成功且 Principal 类型匹配时注入事务级 `vc.owner_user_id`，commit 自清。
2. `AuthSecurityConfig` 注册该 filter（`addFilterAfter(ownerInjectionFilter, JwtAuthenticationFilter.class)`）；
   `OwnerContext` bean 只在 `datasource-enabled=true` 存在，filter 用 `ObjectProvider<OwnerContext>` 可选注入，缺失时退化为
   no-op（直接 `filterChain.doFilter`，不注入 owner），保证 `auth.enabled=true` 但 `datasource-enabled=false` 时仍可启动。
3. 新增 `InternalMeController`（`GET /api/internal/me`，受保护测试载体）：`@AuthenticationPrincipal JwtTokenService.Principal`
   回显 `principal.accountId()`；`@ConditionalOnProperty(auth.enabled=true)`。
4. `OwnerInjectionFilterTest`（单元，mock OwnerContext，模板照搬 `OwnerContextTest.java:34-49`）+ `AuthSecurityIntegrationTest`
   增强（filter 注册顺序 + MockMvc /api/internal/me）。
5. 修 `SchemaReadinessHealthIndicatorTest:143-146` stale 断言（注释 V1..V17→V1..V21 + 期望值 17→21）。
6. `JAVA_HOME=/opt/homebrew/opt/openjdk@25/libexec/openjdk.jdk/Contents/Home ./mvnw --batch-mode --no-transfer-progress
   -pl service/apps/runtime -am test` 全 PASS（234 tests 0 failures，含新增 + 既有 runtime 无回归 + stale 断言修复）。
7. 不修改任何既有 migration（V1-V21）、DB test、catalog/contract/pom、其他 service 模块 Java 文件。
8. 终态治理闭环：canonical precheck 8/8 + git diff --check + R1 独立静态复核（C2 保留）+ Evidence/Handoff/单父 [skip ci]/push/远端 0/0。

## 范围内

1. **`OwnerInjectionFilter.java`（新建，`auth/tenant/`）**：
   - `extends OncePerRequestFilter`；构造器注入 `ObjectProvider<OwnerContext> ownerContextProvider`（可选，因 OwnerContext bean
     只在 `datasource-enabled=true` 存在）。
   - `doFilterInternal`：读 `SecurityContextHolder.getContext().getAuthentication()`；若 authentication 非空且
     `getPrincipal() instanceof JwtTokenService.Principal principal`，则 `OwnerContext oc = ownerContextProvider.getIfAvailable()`；
     若 `oc != null` → `oc.asOwner(principal.accountId(), () -> { try { filterChain.doFilter(req,res); } catch(IOException/ServletException e){存 holder} })`，
     asOwner 返回后从 holder rethrow 原 checked exception；若 `oc == null`（无 DB 配置）→ 直接 `filterChain.doFilter(...)`
     （no-op，不注入 owner）。若 principal 不是 `JwtTokenService.Principal`（匿名/未认证/其他）→ 直接 `filterChain.doFilter(...)`。
   - 语义选择：`asOwner` 内部 `TransactionTemplate.executeWithoutResult` 包 `filterChain.doFilter`，**整个 HTTP 请求处于单一
     DB 事务**（请求级事务边界）。这是复用现有 `OwnerContext` 原语的最简形态，事务级 set_config commit 自清保证泄漏连接不携带
     owner。Technical Alpha（单 owner、低并发、HikariCP maximumPoolSize=5）可接受；生产高并发下请求级事务持连可能需演进为更细
     粒度，留作后续业务端点卡的已知演进项（knownRisk）。
   - 不引入 AOP/`@Aspect`（仓库 0 处），不引入 `SET ROLE`/per-principal 连接池（GATE 决策已收敛为 SET LOCAL）。

2. **`AuthSecurityConfig.java`（修改，`auth/config/`）**：
   - 新增 `@Bean OwnerInjectionFilter ownerInjectionFilter(ObjectProvider<OwnerContext> ownerContext)`。
   - `securityFilterChain` 加参数 `OwnerInjectionFilter ownerInjectionFilter`，在现有 `:115` `addFilterBefore(jwt...)` 后追加
     `.addFilterAfter(ownerInjectionFilter, JwtAuthenticationFilter.class)`，确保 owner 注入在 JWT 认证绑定之后执行。

3. **`InternalMeController.java`（新建，`auth/web/`，受保护测试载体端点）**：
   - `@RestController @RequestMapping("/api/internal/me")`，`@ConditionalOnProperty(auth.enabled=true)`。
   - `@GetMapping`，`@AuthenticationPrincipal JwtTokenService.Principal principal`（参照 `AuthController.java:90-97`），返回
     `Map.of("ownerUserId", principal.accountId(), "role", principal.role())`。放 `/api/internal/**` 不进 OpenAPI 契约源。

4. **`OwnerInjectionFilterTest.java`（新建，单元测试）**：4 个测试，mock OwnerContext，模板照搬 `OwnerContextTest.java:34-49`：
   (a) 认证 Principal → `asOwner(eq(accountId), any())` 调用 + chain 继续；(b) SecurityContext 空 → 不调 asOwner + chain 继续；
   (c) principal 非 Principal 类型 → 不调 asOwner + chain 继续；(d) OwnerContext bean 缺失 → no-op + chain 继续。

5. **`AuthSecurityIntegrationTest.java`（修改）**：加 import + 3 个测试：(a) `ownerInjectionFilterIsRegisteredAfterJwtAuthenticationFilter`
   断言 filter 注册顺序（复用现有 indexOf/count helper）；(b) `internalMeEchoesAuthenticatedPrincipal` MockMvc 带 Bearer 打
   /api/internal/me 断言 200 + ownerUserId 回显（此测试无 datasource，OwnerContext bean 缺失 filter no-op，但 principal 流到
   controller 证明接线）；(c) `internalMeRejectsUnauthenticatedRequest` 未认证 401。

6. **`SchemaReadinessHealthIndicatorTest.java`（修改，附带 stale 断言修复）**：`:143-146` 注释 `V1..V17`→`V1..V21` + 断言期望值
   `17`→`21`。**不动**该文件其余的构造参数 `17`（它们是 `new SchemaReadinessHealthIndicator(...,17)` 的 expectedVersion 传入，
   测 readiness 决策逻辑，mock 驱动，与 classpath 实际版本无关，pass），不动 `expectedSchemaVersionFromClasspath` 方法本体
   （在 `SchemaReadinessHealthIndicator.java`，本卡 writeAllowlist 外）。

7. 终态治理闭环：canonical precheck 8/8 + `mvn -pl service/apps/runtime -am test` PASS（234/0）+ git diff --check + R1 独立静态复核
   （C2 保留）+ Evidence/Handoff/单父 [skip ci]/push/远端 0/0。

## 明确范围外

- **不修改任何既有 migration（V1-V21）**（Flyway checksum 安全）；不新增 V22（无 DB 改动）。
- **不修改任何 DB test（01-61）**、`infra/db/run-rls-tests.sh`、任何 RLS policy、角色、约束、SD 函数。
- 不改 catalog（specs/catalog/**）、契约（specs/contracts/**）、OpenAPI 源（specs/openapi/**）、`specs/generated/**`、
  service modules/adapters/tests/platform、frontend、任何 pom.xml。
- 不改 `skills/**`、`AGENTS.md`、`CLAUDE.md`、`.harness/**`（除 project-state/task-ledger）、`scripts/harness/**`、
  `.github/workflows/**`、`ci/**`。
- 不改 `OwnerContext.java`（原语设计正确，仅复用）、`JwtAuthenticationFilter.java`（仅在其后挂新 filter）、
  `JwtTokenService.java`（Principal record 不变）、`AuthDataSourceConfig.java`（OwnerContext bean 不变）、
  `SchemaReadinessHealthIndicator.java`（readiness 决策逻辑不变，只改其测试的 stale 断言）。
- **不处理 worker/coordinator 路径 owner 注入**（`WorkItemClaimService` 装配 + fence Java 签发）：worker 线程无 HTTP Principal，
  owner 来自 `claim_work_items` 的 `p_owner_user_id`（V17 已要求 worker 也有 server-trusted owner），但依赖 coordinator/dispatcher
  整体未落地，留后续独立卡（本卡只闭合 HTTP 请求半边）。
- 不处理其它审计项（P1-11 readiness 决策逻辑、P2-03 限流、P2-22 nextAction 等需 Owner 决策；ProviderAttemptAudit 投影属 P2-12 JDBC 接线；
  §5.1.2 worker claim lease/fence 依赖 P1-04 + coordinator 落地）。本卡只修 SchemaReadinessHealthIndicatorTest 的 stale **断言值**，
  不修 P1-11 readiness 决策逻辑或 expectedVersion 跟随策略（那属 P1-11 OWNER_GATE 范围）。
- 根级 Maven verify 与完整 Harness unittest 按 Owner 2026-08-12 static-gates-only 策略 deferred to unified audit
  （本卡跑受影响模块 runtime 定向 test 作迭代证据）。

## 输入和前置条件

- Base `b465e73b91347c257f3ab64e78aa960ce810f1ef` = TASK-0167 ACCEPTED terminal（已 push、0/0、clean；
  nextAction 与 `docs/handoffs/TASK-0167.json` byte-for-byte 一致，sha256 `9e43d77b...` 已校验）。
- 本卡 context lock 输入钉在 Base；provenance 条目 `owner-authorization://longline-2026-08-09`
  provenanceOnly（沿用 hash `cc0f91c1...`）。context fingerprint `0d74dd3f...` 由自验算法生成
  （先复现 TASK-0167 `53ddb969...` 通过，再生成 TASK-0168；含 SchemaReadinessHealthIndicatorTest 共 44 inputs）。
- 受控 Python：`PATH=/Users/hxf/.zcode/venvs/vc-harness/bin:$PATH`。
- Java 工具链：JDK 25（`/opt/homebrew/opt/openjdk@25`，brew 安装，25.0.4）；项目 `maven.compiler.release=25`。
- Maven 模块定向测试：`JAVA_HOME=/opt/homebrew/opt/openjdk@25/libexec/openjdk.jdk/Contents/Home
  ./mvnw --batch-mode --no-transfer-progress -pl service/apps/runtime -am test`（runtime 模块 artifactId=
  virtual-companion-runtime，parent=根 pom，reactor 声明于根 pom `<module>service/apps/runtime</module>`）。
- canonical precheck：`python scripts/harness/precheck.py --task TASK-0168`（profile=precheck 8 子命令）。
- 远端 exact-SHA 通道仍配额耗尽（dispatchCount=0）；LOCAL_EXACT_TREE_FALLBACK profile=precheck 限于 macOS 本地候选，远端如实非 PASS。

## API / 事件 / 数据契约

- 新增 `GET /api/internal/me`（受保护，回显 `principal.accountId()`）。放 `/api/internal/**` 命名空间，**不**进
  `specs/openapi/**` 契约源（该源只枚举 `/api/v1/**`，现有 `/api/internal/baseline` 也不在；新增 internal 端点不触
  `specs/contracts/**`/`specs/catalog/**`/`specs/generated/**` 任何保护路径）。
- 无 OpenAPI/catalog/契约 drift：本卡不改 `specs/**`，canonical precheck 的 openapiValidate/openapiDrift 子命令不受影响。
- 不涉及事件/数据契约变更。

## 权限、RLS 和数据处理要求

- 本卡闭合 INV-TENANT-001 的**执行半边**：认证请求到达业务 SQL 前，`vc.owner_user_id` 由服务端可信路径
  （OwnerInjectionFilter 从 SecurityContextHolder 的 JWT Principal 取 accountId，经 OwnerContext.asOwner 事务级 set_config
  注入）建立，使 FORCE RLS 谓词 `owner_user_id = vc.current_owner_id()`（`V1__extensions_roles_functions.sql:41-47`）能正确
  匹配当前 owner。V17 SD 函数的 trusted-owner 断言由此获得运行时供给者。
- 不改任何 DB role、RLS policy、GRANT/REVOKE、FORCE RLS 配置（V1-V21 frozen）。
- `OwnerContext.asOwner` 事务级注入 commit 自清；HikariCP 单固定账号池，无 BYPASSRLS、无 `SET ROLE`、无 per-principal 连接池。
- owner 注入只在认证成功（Principal 类型匹配）且 OwnerContext bean 存在（datasource-enabled）时发生；否则 no-op/放行，
  不伪造 owner context。匿名/未认证请求不注入 owner（fail-closed）。
- 不改任何认证/授权快照逻辑（INV-AUTH-001 不受影响）。

## 状态机和失败行为

- 实现 = 6 个 Java 文件（3 新建 OwnerInjectionFilter/InternalMeController/OwnerInjectionFilterTest + 3 修改
  AuthSecurityConfig/AuthSecurityIntegrationTest/SchemaReadinessHealthIndicatorTest stale 断言）。
- `./mvnw -pl service/apps/runtime -am test` 全 PASS（234 tests 0 failures，含新增 + 既有 runtime 无回归）。若编译或测试失败，据此迭代修正。
- canonical precheck 8 子命令 PASS（doctor 校验 writeAllowlist/forbiddenPaths 零冲突、context fingerprint 一致；
  catalog/openapi/license/paid-feature 无 drift）。
- R1 独立静态复核（C2 保留）：0 P0/P1/P2 = PASS。R1 阻塞 → 最多 1 fix batch（仅改 6 个实现文件，不动卡 body 保持 READY
  projection 冻结）→ R2；R3 禁止。超 hardFuse 90min → closure-only overrun 或 REJECTED。
- 语义注意：`asOwner` 包整个 `filterChain.doFilter` = 请求级单一 DB 事务。若 controller 抛未处理异常，事务 rollback
  （整个请求 DB 操作回滚）——这是事务原子性的预期行为。若现有 controller 已有自身事务管理，Spring 默认 PROPAGATION_REQUIRED
  加入外层（无嵌套问题）——R1 复核确认。

## 模型、Prompt、记忆和安全边界

不涉及模型/Prompt/记忆。本卡是 Technical Alpha 认证→RLS 的请求线程 owner 上下文注入接线 + 一处 stale test 断言修复。
不外发、不调模型、不写记忆。

## 验收标准

1. `OwnerInjectionFilter`（OncePerRequestFilter）实现：认证成功 + `Principal` 类型匹配 + OwnerContext bean 存在 →
   `ownerContext.asOwner(principal.accountId(), () -> filterChain.doFilter(...))`；其余情况（匿名/非 Principal/OwnerContext 缺失）
   → 直接 `filterChain.doFilter`（no-op，不注入 owner，不抛异常）。
2. `AuthSecurityConfig` 注册 `OwnerInjectionFilter` bean（ObjectProvider<OwnerContext> 可选注入）并在 SecurityFilterChain
   `.addFilterAfter(ownerInjectionFilter, JwtAuthenticationFilter.class)`。
3. `InternalMeController`（`GET /api/internal/me`）受保护回显 `principal.accountId()`，未认证 401；放 `/api/internal/**` 不进 OpenAPI。
4. `OwnerInjectionFilterTest` 覆盖 4 场景（认证注入/匿名跳过/非 Principal 跳过/OwnerContext 缺失 no-op）。
5. `AuthSecurityIntegrationTest` 增强：OwnerInjectionFilter 注册于 JwtAuthenticationFilter 之后；`GET /api/internal/me`
   未认证 401 + 带 Bearer 200 回显 accountId。
6. `SchemaReadinessHealthIndicatorTest:143-146` stale 断言修复（V1..V21 + 期望 21），不动其余构造参数与方法本体。
7. 不修改任何既有 migration（V1-V21）、DB test（01-61）、catalog/contract/OpenAPI 源/pom、其他 service 模块 Java 文件
   （除本卡 writeAllowlist 列出的 6 个）。
8. `JAVA_HOME=/opt/homebrew/opt/openjdk@25/libexec/openjdk.jdk/Contents/Home ./mvnw --batch-mode --no-transfer-progress
   -pl service/apps/runtime -am test` PASS（exit 0，234 tests 0 failures）。
9. 唯一 canonical precheck 8/8 PASS（profile=precheck）。
10. 唯一无参数 `git diff --check` PASS（exit 0）。
11. R1 独立静态复核 PASS（C2 保留；0 P0/P1/P2）。
12. 根级 Maven verify 与完整 Harness unittest 按 Owner static-gates-only 策略 deferred to unified audit（Evidence 如实标注，
    不转换为 PASS）。
13. 终态单父 [skip ci] ACCEPTED 提交、push 后 HEAD==origin/main、0/0、clean；remote exact-SHA 如实非 PASS（dispatchCount=0，
    LOCAL_EXACT_TREE_FALLBACK 冻结于 READY）。

## 必跑检查

以 YAML `requiredCommands` 精确 argv 为准：
- canonical precheck 只跑一次（8 子命令不重复）；
- `JAVA_HOME=/opt/homebrew/opt/openjdk@25/libexec/openjdk.jdk/Contents/Home ./mvnw --batch-mode --no-transfer-progress
  -pl service/apps/runtime -am test` 跑一次（Java 模块定向迭代证据，JDK 25）；
- 完整 Harness unittest 按 static-gates-only 策略 deferred to unified audit（列入 requiredCommands 但本卡不跑，
  doctor 不校验 requiredCommands 是否真跑，只校验字段冻结）；
- 同一条无参数 `git diff --check` 只执行一次。

## 回滚或前向修复

若 R1 发现阻塞或 Maven test 失败：最多 1 fix batch（仅修正 6 个实现文件）→ R2；
若再次超 hardFuse 或发现真实缺陷，如实 REJECTED 并报告 Owner 决策。本卡是前向 Java 实现，不触碰历史制品；
若复核发现 owner 注入缺陷实际由更深层的事务边界/连接池拓扑问题引起（超出 service/apps/runtime 范围），停止并转
Owner 决策是否扩大范围或改用 AOP 形态（A2）。

## 停止条件

- writeAllowlist 外路径被修改；forbiddenPaths 被触碰（尤其 V1-V21 既有 migration、DB test 01-61、run-rls-tests.sh、
  catalog/contract/OpenAPI 源/pom、OwnerContext/JwtAuthenticationFilter/JwtTokenService/AuthDataSourceConfig/
  SchemaReadinessHealthIndicator 等仅读参考文件）。
- `./mvnw` 模块 test / canonical precheck / diff check 任一非 PASS。
- owner 注入实现破坏既有 fail-closed 语义（匿名请求不应注入 owner；OwnerContext bean 缺失不应阻止启动；principal 类型
  不匹配不应抛异常）。
- 候选身份变化或越界。
- hardFuseWallMinutes 90 到达：停止实现/修复/Reviewer/canonical，只允许 closure-only overrun。

## Evidence Pack

输出到 `docs/evidence/TASK-0168/`（evidence-pack.json、review-r1.md），并生成 `docs/handoffs/TASK-0168.json`。

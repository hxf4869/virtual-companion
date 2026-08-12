# TASK-0168 R1 独立静态复核

- 候选实现 commit：`f59fadc3db0ad9519e971e7a304e8cb55e9a43f0`
- 候选 tree：`6a071b5466090ad2abb99e91e42ad7058b4360e3`
- base commit：`b465e73b91347c257f3ab64e78aa960ce810f1ef`（TASK-0167 ACCEPTED terminal）
- 风险级：C2（`service/apps/runtime/**` 非保护路径，`independentReview: true` 保留 R1）
- 复核模式：acceleration 静态门禁（Owner 2026-08-12 static-gates-only），引用实现者已跑的 mvn/canonical/diff，不 fresh 重跑

## 复核范围

本卡闭合 §4.1 P1-04 应用半边（DB 半边 V17 已由 TASK-0154 闭合）：新增 `OwnerInjectionFilter`（OncePerRequestFilter）
在 `JwtAuthenticationFilter` 之后用 `OwnerContext.asOwner` 事务级 `set_config('vc.owner_user_id', ?, true)` 注入
`principal.accountId()`；新增 `InternalMeController`（`GET /api/internal/me`）受保护测试载体；单元 + 集成测试；
附带修 `SchemaReadinessHealthIndicatorTest:143-146` stale 断言（17→21）。候选 diff 9 文件 969 insertions/6 deletions。

## 静态门禁结果（实现者已跑，R1 引用）

| 门禁 | 命令 | 结果 |
|---|---|---|
| Java 模块定向测试 | `JAVA_HOME=/opt/homebrew/opt/openjdk@25/libexec/openjdk.jdk/Contents/Home ./mvnw --batch-mode --no-transfer-progress -pl service/apps/runtime -am test` | **BUILD SUCCESS, 234 tests / 0 failures / 0 errors**（含新增 4 OwnerInjectionFilterTest + 3 AuthSecurityIntegrationTest + stale 断言修复 + 既有 runtime 无回归） |
| canonical precheck | `python scripts/harness/precheck.py --task TASK-0168` | **PASS 8/8**（doctor 804165 checks 113.2s；catalogValidate/catalogDrift/paidFeatureCheck/licenseCheck 71deps/betaRosterGate CLOSED/openapiValidate/openapiDrift 全 PASS） |
| diff 检查 | `git diff --check b465e73..HEAD` | **exit 0** |

完整 Harness unittest + 根级 Maven verify 按 Owner static-gates-only 策略 deferred to unified audit。

## 语义审查

### 1. OwnerInjectionFilter 逻辑正确性（`auth/tenant/OwnerInjectionFilter.java`）

`doFilterInternal` 四分支全覆盖：
- 认证 `JwtTokenService.Principal` + `OwnerContext` bean 存在 → `ownerContext.asOwner(accountId, () -> filterChain.doFilter(...))`，
  事务级 `vc.owner_user_id` 注入，commit 自清。✓
- 认证 Principal + OwnerContext bean 缺失（auth.enabled 但 datasource-enabled=false）→ 直接 `filterChain.doFilter`（no-op，不注入 owner）。✓ 不伪造 owner。
- `SecurityContext` 空（匿名/未认证）→ principal null → else 分支 `filterChain.doFilter`。✓ 不注入。
- principal 非 `JwtTokenService.Principal` 类型 → `instanceof` false → else 分支。✓ 不注入、不抛异常。

**checked exception 处理正确**：`asOwner` 的 work 是 `Runnable`（不抛 checked），filter 把 `filterChain.doFilter` 的
`IOException`/`ServletException` 捕获到 holder 数组，`asOwner` 返回后从 holder rethrow 原始 checked exception；`RuntimeException`
（如 controller 抛）直接传播出 `asOwner`（事务 rollback），不到 holder 检查代码。语义正确：异常不被吞，事务原子性保持。

**accountId 非正不会发生**：`OwnerContext.asOwner` 对 `ownerUserId<=0` 抛 `IllegalArgumentException`（`OwnerContext.java:34`），
但 `JwtTokenService.Principal` record compact constructor 保证 `accountId>0`（`JwtTokenService.java:97`），故 asOwner 不会因此抛。

### 2. filter 注册顺序（`AuthSecurityConfig.java`）

`securityFilterChain` 加参数 `OwnerInjectionFilter ownerInjectionFilter`，在现有
`.addFilterBefore(jwtAuthenticationFilter, UsernamePasswordAuthenticationFilter.class)` 后追加
`.addFilterAfter(ownerInjectionFilter, JwtAuthenticationFilter.class)`。最终链序（前→后）：
cookieCsrf → authSource → bodyLimit → **jwt → ownerInjection** → UsernamePasswordAuthenticationFilter。
owner 注入在 JWT 认证绑定之后、admission 之后执行 —— 正确（owner 注入需先有认证 principal）。
`AuthSecurityIntegrationTest.ownerInjectionFilterIsRegisteredAfterJwtAuthenticationFilter` 断言 `ownerIndex > jwtIndex` 机器证明。

### 3. InternalMeController（`auth/web/InternalMeController.java`）

`@RestController @RequestMapping("/api/internal/me") @ConditionalOnProperty(auth.enabled=true)`，
`@GetMapping` + `@AuthenticationPrincipal JwtTokenService.Principal` 回显 `Map.of("ownerUserId", accountId, "role", role)`。
放 `/api/internal/**`（与 `BaselineController` 一致），**不进 `specs/openapi`**（只枚举 `/api/v1/**`）—— canonical openapiDrift
PASS 证明无契约 drift。写法参照 `AuthController.java:90-97`。未认证 401 由 SecurityFilterChain `anyRequest().authenticated()` 保证
（`AuthSecurityIntegrationTest.internalMeRejectsUnauthenticatedRequest` 证明）。

### 4. SchemaReadinessHealthIndicatorTest stale 断言修复

`:143-146` 注释 `V1..V17`→`V1..V21` + 断言 `isEqualTo(17)`→`isEqualTo(21)`。`expectedSchemaVersionFromClasspath()`
扫描 classpath 最高 V 返回 21（V21 TASK-0165 是当前最高），与断言一致。
**不动**该文件其余构造参数 `17`（`new SchemaReadinessHealthIndicator(...,17)` 的 expectedVersion 传入，测 readiness
决策逻辑，mock 驱动，与 classpath 实际版本无关），**不动** `SchemaReadinessHealthIndicator.java` 方法本体（本卡 writeAllowlist 外）。
修复范围最小且正确：只修 stale 断言值，不改 P1-11 readiness 决策逻辑或 expectedVersion 跟随策略（那属 P1-11 OWNER_GATE）。

### 5. 范围合规

- 6 Java 文件全在 `writeAllowlist`，全在 `service/apps/runtime/**`（非保护路径，逐项核对 protected-paths.yaml 不触
  modelruntime/safety/memory/db/migration/specs/.harness）。✓
- 不触 migration（V1-V21 frozen，canonical doctor diff scope PASS）。✓
- 不触 catalog/contract/OpenAPI/pom（canonical catalogDrift/openapiDrift PASS）。✓
- `project-state.yaml` 仅终态会改（activeTask/nextAction/lastAccepted/lastTerminal），本候选 commit 已含 READY authorization 的 activeTask 投影。

### 6. INV-TENANT-001 执行半边闭合

本卡闭合 INV-TENANT-001 的**执行半边**：认证请求到达业务 SQL 前，`vc.owner_user_id` 由服务端可信路径
（OwnerInjectionFilter 从 SecurityContextHolder JWT Principal 取 accountId → OwnerContext.asOwner 事务级 set_config）建立，
使 FORCE RLS 谓词 `owner_user_id = vc.current_owner_id()`（V1:41-47）匹配当前 owner，V17 SD 函数 trusted-owner 断言
（`p_owner_user_id IS DISTINCT FROM vc.current_owner_id()` raise）获得运行时供给者。owner 来源 solely 来自服务端可信身份
（JWT Principal），never 请求字段或开发 header。不改 DB role/RLS/policy/GRANT（V1-V21 frozen）。

### 7. 既有 fail-closed 语义保持

- 匿名/未认证请求不注入 owner（`current_owner_id` NULL，RLS 谓词匹配 0 行）。✓
- OwnerContext bean 缺失不阻止启动（ObjectProvider 可选注入，filter no-op）。✓
- principal 类型不匹配不抛异常（instanceof false → 放行）。✓
- `OwnerContext.asOwner` 事务级 set_config commit 自清，泄漏连接不携带 owner。✓（既有 `OwnerContextTest` 保证）

## Findings

- **P0**：0
- **P1**：0
- **P2**：0
- **P3**（informational，non-blocking）：
  1. **请求级事务语义**：`asOwner` 包整个 `filterChain.doFilter` = 整个 HTTP 请求单一 DB 事务（请求级事务边界）。
     Technical Alpha（单 owner、低并发、HikariCP maximumPoolSize=5）可接受；生产高并发下请求级事务持连可能需演进为更细粒度
     （per-repository-call 或 AOP 切面）。本卡 knownRisk 已标注，留后续业务端点卡演进。不阻塞。
  2. **owner 注入只闭合 HTTP 请求半边**：worker/coordinator 路径（`WorkItemClaimService` 装配 + fence Java 签发）仍依赖
     coordinator/dispatcher 整体未落地，留后续独立卡。本卡 D1 范围（骨架卡独立闭合 HTTP 半边）明确，不阻塞。

## 判定

**R1 PASS**：0 P0/P1/P2，2 P3 informational（请求级事务语义 Technical Alpha 可接受 + HTTP 半边闭合范围明确）。

owner 注入 check-and-inject 在 OncePerRequestFilter 内正确（认证 Principal → asOwner 事务级 set_config；其余 no-op 不伪造 owner）；
filter 注册于 JwtAuthenticationFilter 之后（admission 之后）；InternalMeController 受保护测试载体不进 OpenAPI；
SchemaReadinessHealthIndicatorTest stale 断言 17→21 修复最小且正确（不动 readiness 决策逻辑）。

静态门禁全 PASS（mvn -pl service/apps/runtime -am test 234/0；canonical precheck 8/8 doctor 804165；diff exit0）。
6 文件全在 writeAllowlist（service/apps/runtime/**），V1-V21 与 DB test 01-61 frozen，无 catalog/contract/pom/OpenAPI 改动。
完整 unittest + 根级 Maven verify deferred per Owner static-gates-only。

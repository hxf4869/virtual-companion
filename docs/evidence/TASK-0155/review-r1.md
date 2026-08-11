# TASK-0155 R1 独立复核

- **Verdict: FAIL**
- **Reviewer Role**: 独立 R1 Reviewer（fork_turns=none，无任务历史上下文，只读，未修改仓库任何文件）
- **复核时间**: 2026-08-11
- **候选**: `2bc38c6e070533678f4df35e5b6d79c21efd97c3`（tree `b85ab8819f381cdc1fedadcc311b7371f93ea238`），单父 dd0f0ad，工作树 clean
- **Base**: `2ba482966cf3812629c1e8dfd111a798dba9cd96`（TASK-0154 terminal）

## 阻塞结论

唯一 canonical precheck（`python scripts/harness/precheck.py --task TASK-0155`）**7/8 FAIL**——`licenseCheck` 退出码 1：

```
service/apps/runtime/pom.xml: dependency org.springframework.boot:spring-boot-starter-flyway
(scope=compile) is not in license-inventory.yaml
```

`.harness/license-inventory.yaml`（TASK-0152 建立的 license gate）登记每个 Maven 直接依赖；`spring-boot-starter-flyway`（本卡 P1-11 引入）未登记 → licenseCheck FAIL。该文件是本卡 forbiddenPath + C4 protected（`.harness/**` → harness-change + humanApproval），不在 writeAllowlist；本卡候选身份下无法自修。验收标准 #9（唯一 canonical precheck 8/8 PASS）未达成。

## 候选身份核对

- 候选 Commit `2bc38c6…` = HEAD ✓；候选 Tree `b85ab8819f…` ✓
- 提交链线性单父：`2e722ad` DRAFT → `a2e92ec` READY → `f16291b` authorizationCommit → `dd0f0ad` IN_PROGRESS → `2bc38c6` 候选 ✓
- 复核全程工作树 0 porcelain 条目，未修改任何文件 ✓

## 独立运行结果

| # | 命令 | 退出码 | 结果 | 备注 |
|---|------|--------|------|------|
| 1 | `git diff --check 2ba4829..2bc38c6` | 0 | PASS | 输出空，0.018s |
| 2 | `doctor.py --task TASK-0155`（standalone） | 0 | PASS | 729152 checks，114.2s |
| 3 | `precheck.py --task TASK-0155`（canonical） | 1 | **FAIL 7/8** | doctor/catalogValidate/catalogDrift/paidFeatureCheck/betaRosterGate/openapiValidate/openapiDrift PASS；**licenseCheck FAIL（exit=1，spring-boot-starter-flyway 未登记）** |
| 4 | `bash infra/db/run-rls-tests.sh`（OrbStack） | 0 | PASS | 56/56 ALL TESTS PASS，含新 `56_runtime_role_cannot_migrate.sql` |
| 5 | 根级 `./mvnw … verify`（maven:3.9-eclipse-temurin-25-alpine + vc-maven-cache） | 0 | BUILD SUCCESS | 14 模块；runtime 227 tests 0 失败（ProductionProfileFailClosedTest 4/4、SchemaReadinessHealthIndicatorTest 9/9、AuthExceptionHandlerTest 8/8）；25.8s |

## 矩阵核对（静态）

**A. writeAllowlist / forbiddenPaths（PASS）**：writeAllowlist/forbiddenPaths 块在 DRAFT(`2e722ad`)/READY(`a2e92ec`)/候选(`2bc38c6`)/工作树四处字节级一致（sha256 `c3a17d7a…`）。候选 diff 12 文件全部在 writeAllowlist 内；forbiddenPaths 零触碰（`infra/db/tests/01..55` 全部未动，`56_*` 是 writeAllowlist 新文件）。`.harness/project-state.yaml` 改动仅 activeTask/nextAction 状态字段，合法。

**B. context fingerprint（PASS）**：按 `harness_common.py verify_context_lock` 语义独立复算（71 inputs；provenanceOnly 条目 `owner-authorization://longline-2026-08-09` 用固定 hash `cc0f91c1ddad24cb89128002439148384e4af8b6c8d056498ba8814a53580e95`；对每个 readAllowlist 路径 `git cat-file -p BASE:path | sha256sum`；按 path 排序 join `path=hash` 无尾换行；再 sha256）= **`523497cf7051ab4818c0d7ee28caf1ca634cadef9089dba41a2a8c0de379a0f7`**，与卡/锁声明完全一致，逐条 hash 无 mismatch。

**C. 技术复核（整体合格）**：
- `application.yaml`：`spring.flyway.*`（enabled 默认 false、url/user/password 环境化、locations=classpath:db/migration、fail-on-missing-locations=true）；production 块 4 属性无默认值；DataSourceAutoConfiguration exclude 保持 ✓
- `AuthDataSourceConfig`：`flywayMigratorCredentialsGuard`（@ConditionalOnProperty spring.flyway.enabled=true，三凭据空白即 IllegalStateException 含变量名；FlywayConfigurationCustomizer no-op lambda）；`schemaReadinessHealthIndicator` bean（migrator JdbcTemplate 经 `Flyway.getConfiguration().getDataSource()` 取得，无 Flyway 时 null）✓
- `SchemaReadinessHealthIndicator`：三检查顺序与 SQL 正确（pg_proc JOIN pg_namespace；pg_roles IN 4 角色；to_regclass('flyway_schema_history')::text；`count WHERE version=? AND success`；`count WHERE NOT success`）；期望版本来自 classpath `db/migration/V*.sql` 最大数值前缀；任何 RuntimeException → DOWN（fail-closed）✓
- `AuthExceptionHandler`：Set.of 4 SQLSTATE（42883/42P01/42703/3F000）；cause 链 + `SQLException.getNextException()` 链遍历；非 schema DataAccessException 保持 401；401/403/400 其他 handler 不变 ✓
- `pom.xml`：仅新增 spring-boot-starter-flyway（无版本，父托管 flyway 12.4.0，不引第二版本）✓
- `infra/db/tests/56_runtime_role_cannot_migrate.sql`：SET ROLE vc_api 后 5 类 DDL/角色操作（CREATE TABLE vc/public.flyway_schema_history、CREATE SCHEMA、ALTER ROLE、DROP SCHEMA）全 insufficient_privilege 拒绝 + 结尾 RESET ROLE sanity ✓
- 测试质量：indicator 9 例矩阵覆盖空库/落后一版/失败行/角色缺失/查询异常/无 Flyway marker-only/类路径版本推导；handler 8 例覆盖 4 SQLSTATE + 非 schema 回退 + 嵌套 cause ✓

**D. 验收标准逐项**：

| # | 标准 | 结果 |
|---|------|------|
| 1 | pom 含 starter-flyway；application.yaml 含 spring.flyway.* 块；production 强制 | PASS |
| 2 | VC_FLYWAY_ENABLED=true 缺 migrator 凭据 → 启动失败含变量名 | PASS（测试 4/4） |
| 3 | migrator 端口不可达而 runtime 端口不同 → 错误链含 migrator 端口 | PASS（测试 4/4） |
| 4 | indicator 矩阵单测全 PASS | PASS（9/9） |
| 5 | AuthExceptionHandlerTest 三类未定义对象异常 → 503；普通 DataAccess → 401；400 不变 | PASS（8/8，工程适配后行为等价且更强） |
| 6 | test 56 加入 RLS 套件；56/56 PASS | PASS |
| 7 | 手动 e2e（空库→503/login 503；flyway on→迁移+UP） | PASS（日志 `/tmp/vc-e2e-155/e2e.log`，BOOT A health 503 + login 503 SCHEMA_UNAVAILABLE；BOOT B UP + history version=17 success=t + applied_ok=17 + roles=4） |
| 8 | 根级 Maven verify BUILD SUCCESS | PASS |
| 9 | canonical precheck 8/8 PASS | **FAIL（licenseCheck）** |
| 10 | 终态提交/push/远端 exact-SHA | NOT_RUN（closure 阶段，R1 时点未冒充） |

**E. 不变量**：INV-TENANT-001（test 56 实证 runtime 角色无 DDL/角色篡改能力）✓；INV-HARNESS-002（单活动任务）✓；INV-HARNESS-003（protected path 尊重——license-inventory 拒绝写入正是其工作）✓；INV-HARNESS-005（证据诚实：licenseCheck FAIL 如实，未转 PASS）✓；INV-HARNESS-007（single-card）✓；INV-HARNESS-009（LOCAL_EXACT_TREE_FALLBACK 冻结于 READY，远端留待 closure）✓。

## Findings

- **P0（阻塞）**：canonical precheck licenseCheck FAIL——`spring-boot-starter-flyway` 未登记 `license-inventory.yaml` mavenDirectDependencies（flyway-core/flyway-database-postgresql 已登记）。修复需 Owner 授权把 `.harness/license-inventory.yaml` 纳入写范围（C4 harness-change + humanApproval）——经 Owner 确认，amendment 机制无法授权（doctor 硬校验 addedWriteAllowlist 与 forbiddenPaths 零冲突，且 READY 后 forbiddenPaths 不可改）。决议路径：本卡如实 REJECTED，replacement 卡（TASK-0159）从 DRAFT 起把 license-inventory 纳入 writeAllowlist + 声明 C4 授权。
- **P1**：无。
- **P2**：无。
- **P3（信息性）**：
  1. 提交信息措辞「Spring 7 移除 Undefined*Exception 子类」版本归因不精确（实测 7.0.8 jar 含 BadSqlGrammarException/UncategorizedSQLException 等，无 Undefined* 子类），结论不变。
  2. 卡范围内 §5/验收 #5 原按 Undefined*Exception handler 措辞，实现以 SQLSTATE cause 链替代（见下「工程适配判定」）——属文档与实现的工程细节偏差，建议在 replacement 卡正文统一。
  3. pg_proc 检查用两函数总数 ==2 而非「各恰存在 1 个」；V1/V14 均为单签名无重载，无实际影响。
  4. e2e 为迭代验证（日志内容真实一致），非 canonical Evidence。

## 工程适配判定：**批准（合理且必要）**

卡原方案 `@ExceptionHandler({UndefinedFunctionException.class, UndefinedTableException.class, UndefinedColumnException.class})` 在 Spring Framework 7.0.8 不可实现：
- (a) spring-jdbc 7.0.8 jar 中**不存在** Undefined*Exception 类（仅 BadSqlGrammarException/UncategorizedSQLException 等 8 个异常类）；
- (b) 空库真实症状 `schema "vc" does not exist`（SQLSTATE 3F000）由 SQLStateSQLExceptionTranslator 归为 `UncategorizedSQLException`（3F 不在 42xxx/2D/07 语法族），即令 Undefined* 类存在亦无法覆盖；
- (c) 实现改为在 `@ExceptionHandler(DataAccessException)` 内沿 cause + `SQLException.getNextException()` 链判定 4 个 SQLSTATE（42883/42P01/42703/3F000），单测覆盖嵌套 cause，e2e BOOT A 实证真实空库返回 `503 SCHEMA_UNAVAILABLE`（非 401）。
判定：适配正确、fail-closed 契约保持（08001 连接类/42601 语法类仍回退 401 AUTHENTICATION_REQUIRED），覆盖范围更强（含 3F000）。

## Verdict

**R1 FAIL（P0 licenseCheck）**。实现质量与静态矩阵整体合格（A-E 全 PASS，验收 1-8 与 10 PASS/NOT_RUN），唯一阻塞为 canonical precheck licenseCheck。本卡候选身份无法自修；按 Owner 决议路径，TASK-0155 如实 REJECTED，由 replacement 卡 TASK-0159 在 writeAllowlist 纳入 `license-inventory.yaml` 后承接相同实现（已全绿）+ 登记依赖 + 重跑全部门禁收尾。

# TASK-0170 R1 独立复核

- **Verdict: PASS**
- **Reviewer Role**：独立 R1 Reviewer（fork_turns=none，无任务历史上下文，全程只读，未修改仓库任何文件）
- **复核模式**：Owner 2026-08-12 acceleration static-gates-only——仅语义审查（读候选 diff + 静态判断 + 引用实现者已跑的 mvn runtime / run-rls-tests.sh / canonical precheck 结果），不 fresh TMPDIR 重跑；完整 unittest + 根级 Maven verify deferred to 统一全项目复审
- **复核时间**：2026-08-12
- **候选**：`7ea650259a6ee3fd75b44ed330850d7e149063b6`（tree `8780730d2e8d16c1be0ed55dac931760e5900c3c`），单父 7a39b11，工作树 clean
- **Base**：`d44a854a2f9d4a923c5a0c460eba4e36baafde20`（TASK-0169 ACCEPTED terminal）

## 候选身份核对

| 项 | 声明 | 实测 | 结果 |
|---|---|---|---|
| 候选 Commit | `7ea6502…` | `git rev-parse HEAD` = 7ea6502… | PASS |
| 候选 Tree | `8780730d…` | `git rev-parse 7ea6502^{tree}` = 8780730d… | PASS |
| Base | `d44a854…` | d44a854 是 7ea6502 祖先 | PASS |
| 提交链 | f7adb59 DRAFT → 4fb3892 READY → 7a39b11 绑定 → 7ea6502 IN_PROGRESS+实现 | 每提交单父，线性无 merge | PASS |
| 工作树 | clean | `git status --porcelain` 空 | PASS |
| 未推送 | 4 commits（f7adb59..7ea6502） | `git rev-list --left-right --count HEAD...origin/main` = 4/0 | PASS（终态 push 前状态） |

## 静态门禁（引用实现者已跑结果）

| # | 命令 | 退出码 | 结果 | 关键输出 |
|---|------|--------|------|----------|
| 1 | `git diff --check d44a854..7ea6502` | 0 | **PASS** | 输出空 |
| 2 | `python scripts/harness/precheck.py --task TASK-0170`（canonical，8 子命令） | 0 | **PASS 8/8** | doctor PASS（815811 checks，113.9s）；licenseCheck/catalogValidate/catalogDrift/paidFeatureCheck/betaRosterGate/openapiValidate/openapiDrift 全 PASS |
| 3 | `bash infra/db/run-rls-tests.sh`（OrbStack，pgvector/pgvector:0.8.5-pg18 digest-pinned） | 0 | **ALL TESTS PASS** | 62 项全 PASS（基线 61 + 新增 62_identity_auth_event_purge） |
| 4 | `mvn -pl service/apps/runtime -am test`（JDK 25） | 0 | **BUILD SUCCESS** | 240 tests 0 失败 0 skip（基线 238 + 2 IdentityAuthEventPurgeSchedulerTest；SchemaReadinessHealthIndicatorTest 9/0 含 21→22 更新） |

## 矩阵核对

**A. writeAllowlist / forbiddenPaths / diff scope（PASS）**：候选 diff（base..HEAD）7 文件全部在 writeAllowlist 内：
`.harness/project-state.yaml`（M，activeTask/nextAction 状态字段）、`docs/tasks/TASK-0170-*.md`（M，state/authorizationCommit 生命周期字段）、
`docs/tasks/context/TASK-0170.context-lock.yaml`（A）、`V22__identity_auth_event_retention_purge.sql`（A，**protected path **/db/migration/** 命中**）、
`infra/db/tests/62_identity_auth_event_purge.sql`（A）、`AuthDataSourceConfig.java`（M，+@EnableScheduling + scheduler bean）、
`IdentityAuthEventPurgeScheduler.java`（A）、`IdentityAuthEventPurgeSchedulerTest.java`（A）、`SchemaReadinessHealthIndicatorTest.java`（M，21→22）。
forbiddenPaths 零触碰：V1-V21 与 test 01-61 逐文件 frozen；auth/config 非 write 文件（AdminSeedRunner/AuthRequestBodyLimitFilter/
AuthRequestTarget/AuthSecurityConfig/AuthSourceAdmissionFilter/CookieCsrfGuardFilter/SchemaReadinessHealthIndicator 及 4 个既有测试）
精确列禁；service/modules|adapters|tests|platform、specs、scripts/harness、.harness 治理、application.yaml、主类全部未动。
doctor selected-task diff scope PASS 实证。protected path 满足 requiredSkill=database-migration（版本 1.0.0 注册于 .harness/skills.yaml）
+ humanApproval scope:database-migration + independentReview:required。

**B. context fingerprint（PASS）**：contextFingerprint `b6c72ea32e494411539b14163e76beb68b631be0a40abf18fd72b3039dcf688f`，
47 inputs（46 readAllowlist + 1 provenanceOnly `owner-authorization://longline-2026-08-09` 用固定 hash `cc0f91c1…`）。
算法 SHA256_ORDINAL_SORTED_PATH_EQUALS_HASH_LF_V1；实现者脚本先自验复现 TASK-0169 的 `2c16e275…`（MATCH=True），
再生成 TASK-0170 且自洽复现；canonical doctor 子命令校验通过。reset 未推送链后 context-lock 文件未变（不属 reset 修改集），
fingerprint 继续有效。

**C. 技术复核（PASS）**：

- `V22__identity_auth_event_retention_purge.sql`：新增 `vc.identity_auth_event_purge(p_cutoff timestamptz) RETURNS integer`，
  `LANGUAGE plpgsql SECURITY DEFINER SET search_path = vc, pg_catalog`——search_path 与 V18 基线一致（V18 的 pg_proc 循环在
  apply-time 只重写 V22 之前已存在的 SD 函数，新函数必须自声明，本卡正确自声明，test 57 语义保持）。`p_cutoff IS NULL →
  RAISE EXCEPTION` fail-closed（绝不删全表）；`DELETE FROM vc.identity_auth_event WHERE occurred_at < p_cutoff` +
  `GET DIAGNOSTICS v_deleted = ROW_COUNT` + `RETURN v_deleted`。DELETE 以函数 owner（迁移 principal）执行，运行角色 vc_api
  无需表级 DELETE；`REVOKE EXECUTE ... FROM PUBLIC` + `GRANT EXECUTE ... TO vc_api`（镜像 V14 授权约定）。不改任何既有函数
  （全新 CREATE FUNCTION，非 CREATE OR REPLACE），不触碰 V1-V21（Flyway checksum 安全）。
- `infra/db/tests/62_identity_auth_event_purge.sql`：superuser fixture（TRUNCATE + INSERT 4 行：2 旧 200d/190d、2 新 10d/now）；
  `SET ROLE vc_api` 后（1）正测 purge 返回 2（EXECUTE 路径成功）；（2）幂等重跑返回 0；（3）负测直接 `DELETE FROM
  vc.identity_auth_event` 捕获 `insufficient_privilege`（vc_api 仍无表级 DELETE）；（4）`RESET ROLE` 后以 superuser 验证表状态：
  旧行 0、总行 2（recent 保留）。表状态验证在 superuser 身份下做是必要的——V14 `REVOKE ALL` 使 vc_api 对审计表连 SELECT 都无
  （这正是测试想证明的权限边界）。62/62 PASS 实证。
- `AuthDataSourceConfig`：`@EnableScheduling` 加在 `@Configuration @ConditionalOnProperty(auth.enabled+datasource-enabled)`
  类上——默认/测试环境（开关 false）不创建 scheduler bean、不激活调度，无 DB 无 purge（正确）；生产（开关 true）激活调度。
  新增 `@Bean identityAuthEventPurgeScheduler(authJdbcTemplate, @Value("${virtual-companion.auth.audit-retention-days:180}"))`。
  @EnableScheduling 放此条件配置而非主类，是更窄的激活面（主类未触，符合 writeAllowlist）。
- `IdentityAuthEventPurgeScheduler`：plain class（镜像 AdminSeedRunner 的 @Bean 装配风格）；`@Scheduled(cron =
  "${virtual-companion.auth.audit-purge-cron:0 17 3 * * *}")` 每日 03:17；cutoff = `Instant.now().minus(retentionDays, DAYS)`；
  `authJdbcTemplate.queryForObject("SELECT vc.identity_auth_event_purge(?)", Integer.class, Timestamp.from(cutoff))`——精确镜像
  IdentityAccountRepository 的 SELECT-fn queryForObject 约定；null 返回防御性归 0；info 日志只记删除数与天数（无 PII、无
  account id/username）；异常向上传播（Spring 记录，下次调度重试，不吞）。purge 幂等（重跑删 0 或仅新过期行）。
- `IdentityAuthEventPurgeSchedulerTest`：2 测试——(1) mock JdbcTemplate 验证精确 SQL 常量 + `Integer.class` + `Timestamp`
  cutoff 捕获 + cutoff 落在 [调用前-180d-5s, 调用后-180d+5s] 窗口（retention 数学有界验证）；(2) null 返回不抛。无 Spring
  上下文依赖（plain 实例化），与既有 auth/config 单测隔离风格一致。2/2 PASS。
- `SchemaReadinessHealthIndicatorTest`：`expectedSchemaVersionFromClasspathFindsNewestMigration` 断言 21→22（V22 是 classpath
  最新 migration；该断言是加 migration 卡的必然附带变更，V21 卡同理更新过）。9/0 PASS。

**D. 邻接风险（PASS）**：
- vc_api 权限面收窄而非放宽：唯一新增 EXECUTE 是 purge 函数；表级 DML 授权零变化（V14 基线不变）；负测实证直接 DELETE 仍
  insufficient_privilege。test 52（revoked runtime DML）与 test 56/57（migrator/search_path）不受影响（62/62 PASS 实证）。
- search_path：V22 自声明 `vc, pg_catalog`，不盖写 V18 已设 proconfig；test 57（search_path public create fail-closed）PASS。
- 调度安全性：@EnableScheduling 条件激活（生产才跑）；默认单线程 TaskScheduler 无并发 purge；无锁需求（幂等 DELETE）。
- 无新依赖：@Scheduled/@EnableScheduling 来自 spring-context（runtime 已依赖）；V22 只用 plpgsql 内置 GET DIAGNOSTICS/
  ROW_COUNT，无新扩展。
- 不泄露：purge 日志无 PII；审计表本就不存 password/token（V14 设计）。
- 前端/API/OpenAPI 未触（无新端点/错误码）；catalog/contract 未触（canonical catalogValidate/catalogDrift/openapiValidate/
  openapiDrift PASS）。

**E. 验收标准逐项**：

| # | 标准 | 结果 |
|---|------|------|
| 1 | V22 purge 函数（SD + search_path=vc,pg_catalog + DELETE occurred_at<cutoff + RETURN count + null fail-closed + GRANT vc_api/REVOKE PUBLIC；不改 V1-V21） | PASS |
| 2 | test 62 删旧留新 + 返回计数 + vc_api 直接 DELETE insufficient_privilege；run-rls-tests.sh 62/62 | PASS |
| 3 | AuthDataSourceConfig @EnableScheduling + scheduler bean（authJdbcTemplate + retentionDays @Value 默认 180） | PASS |
| 4 | IdentityAuthEventPurgeScheduler @Scheduled cron 默认 0 17 3 * * * + SELECT vc.identity_auth_event_purge(?) + retention 驱动 cutoff | PASS |
| 5 | IdentityAuthEventPurgeSchedulerTest 精确 SQL + 参数 + cutoff 关系；runtime ≥240 全 PASS | PASS（240/0） |
| 6 | SchemaReadinessHealthIndicatorTest 断言 22 | PASS（9/0） |
| 7 | mvn -pl service/apps/runtime -am test BUILD SUCCESS 0 失败 0 skip | PASS（240/0） |
| 8 | run-rls-tests.sh ALL TESTS PASS（含 test 62） | PASS（62/62） |
| 9 | canonical precheck 8/8 PASS + git diff --check exit 0 | PASS |
| 10 | R1 独立复核 PASS（0 P0/P1/P2） | PASS（本报告） |
| 11 | 终态 pre-closure / 单父 [skip ci] / push / HEAD==origin/main / 0/0 / clean / remote exact-SHA | NOT_RUN（终态范围，R1 后执行） |

**F. 不变量**：INV-TENANT-001（vc_api 无 BYPASSRLS、无表级 DML 新增；purge 删平台级审计行，不触租户隔离）✓；
INV-AUTH-001（auth 认证路径未改）✓；INV-HARNESS-001（AGENTS.md 未触）✓；INV-HARNESS-002（单活动任务 TASK-0170 + 冻结
context + 单父原子；reset 未推送链经 Owner 2026-08-12 明确授权，重走 DRAFT→READY→绑定→IN_PROGRESS）✓；
INV-HARNESS-003（**/db/migration/** 满足 database-migration skill + humanApproval scope:database-migration +
independentReview:required）✓；INV-HARNESS-005（evidence 诚实，未运行项 NOT_RUN）✓；INV-HARNESS-007（single-card + bounded
review + exact candidate）✓；INV-HARNESS-009（LOCAL_EXACT_TREE_FALLBACK frozen at READY，dispatchCount=0，远端如实非 PASS）✓。

## Findings

- **P0**：无。
- **P1**：无。
- **P2**：无。
- **P3（信息性，非阻塞）**：
  1. `IdentityAuthEventPurgeSchedulerTest` 的 cutoff 窗口断言用 ±5 秒（围绕 180 天前时刻）。单测毫秒级执行，窗口充足；
     极端慢的 CI 机器上理论 flaky，Technical Alpha 可接受。
  2. `virtual-companion.auth.audit-retention-days` 配置为 ≤0 时 cutoff = now（删几乎所有行）。属 operator 配置责任；
     purge 幂等、无数据损坏风险（删的仍是过保留期数据），默认 180 天。非阻塞。
  3. 默认单线程 TaskScheduler：每日 03:17 一次 purge，无并发。极大数据量（单日删不完）时次日续删（幂等无害），
     Technical Alpha 规模可接受。非阻塞。

## Verdict

**R1 PASS**。TASK-0170 候选 `7ea6502`/tree `8780730d` 为 P2-03 审计保留子项最小实现：V22 新增 SECURITY DEFINER purge 函数
`identity_auth_event_purge(p_cutoff)`（search_path=vc,pg_catalog 匹配 V18 基线、null fail-closed、GRANT EXECUTE vc_api/REVOKE
PUBLIC、vc_api 仍无表级 DML）+ runtime `AuthDataSourceConfig` @EnableScheduling（条件激活）+ `IdentityAuthEventPurgeScheduler`
@Scheduled 每日 03:17 调用（retention 默认 180 天经 @Value 可配置）+ 2 单测 + test 62（正测删旧留新/幂等 + 负测 vc_api 直接
DELETE fail-closed）+ SchemaReadinessHealthIndicatorTest 21→22（加 migration 必然附带变更，Owner 授权 reset 未推送链后修正）。
完全在 writeAllowlist 内、零 forbiddenPaths 触碰（V1-V21/test 01-61 frozen）、context fingerprint b6c72ea3 独立自验一致、
唯一 canonical precheck 8/8 PASS（doctor 815811）、mvn runtime 240/0、run-rls-tests.sh 62/62、git diff --check exit 0、
protected path **/db/migration/** 满足 database-migration skill + humanApproval + independentReview:required。
验收 1-10 PASS，11 属终态范围（NOT_RUN）。完整 unittest + 根级 Maven verify deferred per Owner static-gates-only 策略。
可进入终态闭环。

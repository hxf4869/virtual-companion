# TASK-0173 R1 独立复核

- **Verdict: PASS**
- **Reviewer Role**：独立 R1 Reviewer（fork_turns=none，无任务历史上下文，全程只读，未修改仓库任何文件）
- **复核模式**：Owner 2026-08-12 acceleration static-gates-only——仅语义审查（读候选 diff + 静态判断 + 引用实现者已跑的 run-rls-tests.sh / runtime mvn 定向 test / canonical precheck 结果），不 fresh TMPDIR 重跑；完整 Harness unittest discover + 根级 Maven verify deferred to 统一全项目复审
- **复核时间**：2026-08-12
- **候选**：`e612c5fe975f0b2ff3746531a02b05a255d228d0`（tree `4ab70ce65b062dd171800200342553c2b8e09363`），单父链，工作树 clean
- **Base**：`77431d45c976ecc84bbd7b39b754236ed4fb0aed`（TASK-0172 ACCEPTED terminal）

## 候选身份核对

| 项 | 声明 | 实测 | 结果 |
|---|---|---|---|
| 候选 Commit | `e612c5f…` | `git rev-parse HEAD` = e612c5f… | PASS |
| 候选 Tree | `4ab70ce6…` | `git rev-parse e612c5f^{tree}` = 4ab70ce6… | PASS |
| Base | `77431d45…` | 77431d4 是 e612c5f 祖先 | PASS |
| 提交链 | 5362ca5 DRAFT → f41c85f READY → 0063813 绑定 → fe65021 修正 → d6b532d IN_PROGRESS+实现 → e612c5f test64 fix | 每提交单父，线性无 merge | PASS |
| authorizationCommit | `f41c85f9fc6e53153a446d3935de59cd1ad547c8` | 卡 YAML 与 `git rev-parse f41c85f` 完整 SHA 一致 | PASS |
| 工作树 | clean | `git status --porcelain` 空 | PASS |
| 未推送 | 6 commits（5362ca5..e612c5f） | `git rev-list --left-right --count HEAD...origin/main` = 6/0 | PASS（终态 push 前状态） |

## 静态门禁（引用实现者已跑结果）

| # | 命令 | 退出码 | 结果 | 关键输出 |
|---|------|--------|------|----------|
| 1 | `git diff --check 77431d4..e612c5f` | 0 | **PASS** | 输出空（无空白错误） |
| 2 | `python scripts/harness/precheck.py --task TASK-0173`（canonical，8 子命令） | 0 | **PASS 8/8** | doctor PASS（835128 checks，119.1s，基线 827795 + 新增 ~7333；含 context-lock fingerprint 90bbebd5 校验、writeAllowlist/forbiddenPaths 零冲突、authorization projection、selected task diff scope、catalogDrift/openapiDrift/paidFeatureCheck PASS） |
| 3 | `bash infra/db/run-rls-tests.sh` | 0 | **PASS 64/64** | ALL TESTS PASS；含 test 64_worker_coordinator_cross_session_recovery（dblink 双会话：跨连接伪造 complete 0 行/lease 过期 recover 2 行回 PENDING/sess_b 接管新 token 旧 token 0 行/list 正反向） |
| 4 | `JAVA_HOME=…openjdk@25… ./mvnw --batch-mode --no-transfer-progress -pl service/apps/runtime -am test` | 0 | **BUILD SUCCESS** | 全模块 SUCCESS；WorkItemCoordinatorTest 5/0/0、SchemaReadinessHealthIndicatorTest 9/0/0、WorkItemWorkerTest 5/0/0；-am 跨模块合计 1066 tests 0 failure 0 skip |

## 矩阵核对

**A. writeAllowlist / forbiddenPaths / diff scope（PASS）**：候选 diff（base..HEAD）9 文件全部在 writeAllowlist 内：
`service/platform/persistence/src/main/resources/db/migration/V24__worker_coordinator_functions_runtime_api.sql`（A，**protected path `**/db/migration/**` 命中**）、
`infra/db/tests/64_worker_coordinator_cross_session_recovery.sql`（A）、
`service/apps/runtime/src/main/java/…/worker/WorkItemCoordinator.java`（A）、
`service/apps/runtime/src/main/java/…/auth/config/AuthDataSourceConfig.java`（M）、
`service/apps/runtime/src/test/java/…/worker/WorkItemCoordinatorTest.java`（A）、
`service/apps/runtime/src/test/java/…/auth/config/SchemaReadinessHealthIndicatorTest.java`（M）、
`docs/tasks/TASK-0173-*.md`（A）、`docs/tasks/context/TASK-0173.context-lock.yaml`（A）、
`.harness/project-state.yaml`（M，activeTask/nextAction 状态字段）。
forbiddenPaths 零触碰：V1-V23（`V[1-9]__` / `V1[0-9]__` / `V2[0-3]__` 逐段禁）、infra/db/tests 01-63（`0[1-9]` / `[1-5][0-9]` / `6[0-3]`）、
platform/persistence Java 全禁（`src/main/java/**`）、worker 包既有文件（WorkItemWorker/WorkItemHandler/LoggingWorkItemHandler）、
auth/config 非 write 文件、application.yaml（`src/main/resources/**`）、specs/、scripts/harness/、skills/、ci/、frontend/、.harness/ 治理文件、
历史卡/evidence/handoff（TASK-00*..0172）全部未动。doctor selected-task diff scope PASS 实证。
protected path `**/db/migration/**` 满足 requiredSkill=database-migration（版本 1.0.0 注册于 .harness/skills.yaml）+ humanApproval scope:database-migration + independentReview:required。

**B. context fingerprint（PASS）**：contextFingerprint `90bbebd526673c13e0bc8ad41b6fe688bb4a23af82015e6ab09922602daa9d0a`，
64 inputs（63 readAllowlist + 1 provenanceOnly `owner-authorization://longline-2026-08-09` 用固定 hash `cc0f91c1…`）。
算法 SHA256_ORDINAL_SORTED_PATH_EQUALS_HASH_LF_V1；实现者先自验复现 TASK-0172 的 `700b02c3…`（以其自身 baseCommit 复算）通过，再生成 TASK-0173；
canonical doctor 子命令校验通过。

**C. 技术复核（PASS）**：

- **V24**（`V24__worker_coordinator_functions_runtime_api.sql`）：开头 `SET search_path TO vc, pg_catalog;`（V18 模式，无 public）。
  `vc.list_pending_owner_ids()` RETURNS TABLE(owner_user_id bigint) LANGUAGE sql SECURITY DEFINER SET search_path = vc, pg_catalog——
  `SELECT DISTINCT wi.owner_user_id FROM vc.work_item wi WHERE wi.status='PENDING' ORDER BY wi.owner_user_id`；只返回 owner ID，不暴露
  payload/token/业务元数据（返回类型仅一列）。`vc.recover_expired_claims(p_lease_grace_seconds integer DEFAULT 0)` RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = vc, pg_catalog——`UPDATE vc.work_item SET status='PENDING', claim_token=NULL,
  claim_fence=NULL, claimed_at=NULL, lease_expires_at=NULL WHERE status='CLAIMED' AND lease_expires_at <= now() - make_interval(secs =>
  GREATEST(p_lease_grace_seconds,0))`；`GET DIAGNOSTICS v_rows = ROW_COUNT; RETURN v_rows;`（PL/pgSQL 正确写法，UPDATE 后取行数）。
  只重置过期 CLAIMED，不触碰 PENDING/DONE/FAILED/CANCELLED，不产生新 claim，不建 tenant context。`GRANT EXECUTE … TO vc_api;` 只加授权，
  不 REVOKE，不新增角色/表/列/约束/状态，不改任何既有函数。V1-V23 frozen（Flyway checksum 安全）。
- **test 64**（`64_worker_coordinator_cross_session_recovery.sql`）：照 test 58/63 的 PL/pgSQL DO 块模式（`SELECT … INTO` 局部变量 + 主会话临时表
  `coord_token` 跨事务传 token + `dblink()` 同步单语句取结果 + `dblink_exec` 设会话级 GUC；不依赖 psql `\gset`，后者在 run-rls-tests.sh 的
  `psql -v ON_ERROR_STOP=1 -q < stdin` 多语句执行下变量替换不可靠）。覆盖验收 2abc + 正反：(0) seed 后 list 返回 owner 1（正向）；
  (1) 主会话（vc_api + SET LOCAL context）同事务 claim 拿 token，会话 B 独立连接无 GUC `complete` → 0 行（跨连接拒绝，`_terminalize` owner/fence 守卫
  不匹配）；(2) lease 置过期 → vc_api `recover_expired_claims()` → 2 行回 PENDING；(3) 会话 B（server-trusted session-level GUC）重新 claim 拿
  新 token（接管）+ 旧 token `complete` → 0 行 + 新 token `complete` → 2 DONE；(4) 全 DONE 后 list 返回空（反向）。`$q$…$q$` 不同 tag 避免与
  DO `$$…$$` 嵌套闭合冲突（照 test 58 模式）。64/64 PASS 实证。
- **WorkItemCoordinator**（`worker/WorkItemCoordinator.java`）：`@Scheduled(fixedDelayString="${virtual-companion.worker.coordinator-poll-delay-ms:5000}")`
  `pollOwnerQueues()`——整轮 try/catch：① `recoverExpiredClaims()`（`SELECT vc.recover_expired_claims(0)`，null→0 安全）；② `listPendingOwnerIds()`
  （`SELECT owner_user_id FROM vc.list_pending_owner_ids()`）；③ 每 owner `UUID.randomUUID().toString()` 新 fence +
  `workItemWorker.processOwnerBatch(ownerUserId, fence)`；单 owner RuntimeException → error 日志（含 ownerId，不含 token/fence）+ 继续下一 owner；
  整轮 RuntimeException → error 日志不抛出（@Scheduled 单线程循环存活）。fence 语义正确：每次调用签发新 UUID（V5 接受任意非空非 STALE fence；
  coordinator 分配即「验证 coordinator 分配」落地——worker 不再由调用方任意指定 fence）。日志只记 ownerId + counts，不读 payload。
  SQL 常量 `RECOVER_SQL`/`LIST_PENDING_OWNERS_SQL` 包级可见（测试可断言）。
- **AuthDataSourceConfig**：新增 `@Bean workItemCoordinator(WorkItemWorker, JdbcTemplate authJdbcTemplate)` → `new WorkItemCoordinator(...)`。
  by-name 注入 `authJdbcTemplate`（既有 `@Bean public JdbcTemplate authJdbcTemplate(DataSource)`，line 123-124）。`@EnableScheduling` 已在该类
  （line 47）+ `@ConditionalOnProperty`（line 48）——仅 datasource-enabled 时调度激活，无数据库无轮询。import 按字母序插入 WorkItemCoordinator。
- **WorkItemCoordinatorTest**：plain 实例化 + Mockito mock（无 Spring 上下文，照 WorkItemWorkerTest 风格）。5 场景覆盖验收 5 全部：(a) 轮询顺序
  + 每 owner fence 唯一（doAnswer 捕获 fence 断言 UUID 且互不相等）；(c) 空列表 no-op（只 recover 不调 processOwnerBatch）；(d) 单 owner 异常隔离
  （owner 1 抛 IllegalStateException → owner 2 仍处理）；(e) recover 异常存活（连跑两轮，第二轮仍执行）+ 额外 null recovery 安全。5/0/0 PASS。
- **SchemaReadinessHealthIndicatorTest**：`expectedSchemaVersionFromClasspathFindsNewestMigration` 断言 23→24（V24 加入 classpath 后最新 migration
  版本为 24），注释 V1..V23→V1..V24 同步。9/0/0 PASS。
- 既有兼容：`processOwnerBatch(long ownerUserId, String fence)` 签名匹配 Coordinator 调用（long + String，返回 int）；V23 已授 vc_api claim 家族
  EXECUTE（complete_work_item 在内，test 63 实证）；V5 `complete_work_item`→`_terminalize` 检查 owner+fence+token+status+lease，跨连接无 GUC → 0 行
  （test 64 实证）；runtime 模块 1066 tests 0 failure 0 skip 无回归。

**D. 邻接风险（PASS）**：
- 重试/死信/长任务续租明确范围外（卡 line 460-466）：FAILED 保持终态（V5 `_terminalize` 语义不变）；coordinator 不自动 renew lease、不跨轮续租。
  与 TASK-0171 R1 P3「批次 FAILED 无重试/死信机制属 coordinator 职责」的后续扩展对齐，卡写入 knownRisk/remaining。
- vc_api 对 work_item 表仍无 SELECT/DML（test 63/64 实证）；V24 函数是 coordinator 唯一入口（不读 work_item payload）。
- 安全论证（授 vc_api 不越权）：list 只暴露 owner_user_id（无 payload/token）；recover 只重置过期 CLAIMED（不触其他状态/不建 context/不产生新 claim/
  不可改写 PENDING/DONE/FAILED/CANCELLED/篡改 owner）；两函数无 p_owner_user_id 参数（不涉 V17 trusted-owner 断言面），由 coordinator 以 vc_api
  做系统级调度/清理（等同 V22 retention purge 调用模式）。V17 断言 + transaction-local GUC 语义不受影响（test 54/55/08-11/63 保持）。
- coordinator 日志不含 payload/token/fence/owner 业务数据；不读 work_item payload。
- INV-TENANT-001：运行角色 NOBYPASSRLS 不变；每 owner 独立 fence + `processOwnerBatch`（claim 按 owner_user_id 过滤 + RLS 双重约束）；不跨租户扫描。
- 无新依赖（JdbcTemplate/Scheduled/UUID/logger 均既有）；无 CLI flag/环境变量/通用 override；不弱化任何既有失败关闭；不触 WorkItemWorker/
  WorkItemHandler/OwnerContext/application.yaml（配置键只经 @Value 默认值 5000ms）。

**E. 验收标准逐项**：

| # | 标准 | 结果 |
|---|------|------|
| 1 | V24 两 SD 函数 SET search_path=vc,pg_catalog + GRANT EXECUTE vc_api；不 REVOKE；不新增角色；不改既有函数/表/列/约束/状态；不改 V1-V23 | PASS |
| 2 | test 64 双会话实证（a）跨连接伪造 0 行；（b）过期回收+接管、旧 token 0 行；（c）list 正反向；run-rls 64 项 PASS | PASS |
| 3 | WorkItemCoordinator @Scheduled（fixedDelay 默认 5000ms 可配置）：recover→list→每 owner 新 fence→processOwnerBatch；单 owner 异常隔离；空 no-op；整轮捕获 | PASS |
| 4 | AuthDataSourceConfig 新增 workItemCoordinator @Bean（注入 WorkItemWorker + authJdbcTemplate） | PASS |
| 5 | WorkItemCoordinatorTest 5 场景；runtime 模块测试全 PASS（≥245） | PASS（1066） |
| 6 | SchemaReadinessHealthIndicatorTest 断言 24 | PASS |
| 7 | `mvn -pl service/apps/runtime -am test` BUILD SUCCESS（0 失败，0 skip） | PASS |
| 8 | `bash infra/db/run-rls-tests.sh` ALL TESTS PASS（含 test 64） | PASS（64/64） |
| 9 | canonical precheck 8/8 PASS；`git diff --check` exit 0 | PASS |
| 10 | R1 独立复核 PASS（0 P0/P1/P2） | PASS（本报告） |
| 11 | 终态 pre-closure / 单父 [skip ci] / push / HEAD==origin/main / 0/0 / clean / remote exact-SHA | NOT_RUN（终态范围，R1 后执行） |

**F. 不变量**：INV-HARNESS-001（AGENTS.md 未触）✓；INV-HARNESS-002（单活动任务 TASK-0173 + 冻结 context + 单父原子提交链）✓；
INV-HARNESS-003（`**/db/migration/**` protected path 满足 database-migration skill 1.0.0 + humanApproval scope:database-migration +
independentReview:required）✓；INV-HARNESS-005（evidence 诚实，未运行项 NOT_RUN）✓；INV-HARNESS-006（backlog/永久 ID 未动）✓；
INV-HARNESS-007（single-card + bounded review + exact candidate）✓；INV-HARNESS-009（LOCAL_EXACT_TREE_FALLBACK frozen at READY，
dispatchCount=0，远端如实非 PASS）✓；INV-TENANT-001（每 owner 独立 fence + RLS，不跨租户扫描）✓；INV-WORKER-001（跨连接/迟到/伪造写零写入，
test 64 实证）✓。

## Findings

- **P0**：无。
- **P1**：无。
- **P2**：无。
- **P3（信息性，非阻塞）**：
  1. test 64 初版（IN_PROGRESS 提交 d6b532d）使用 psql `\gset`+`:'var'` 元命令模式提取 dblink 结果，在 run-rls-tests.sh 的
     `psql -v ON_ERROR_STOP=1 -q < file` stdin 多语句执行下变量替换不可靠（`:'var'` 未替换致 syntax error）；fix batch（e612c5f）照 test 58/63
     重写为纯 PL/pgSQL DO 块模式，64/64 PASS 实证。属实现期发现并闭环，非交付缺陷。
  2. coordinator poll-delay 经 `@Value("${…:5000}")` 默认 5000ms；application.yaml 不在本卡 writeAllowlist（forbiddenPaths `src/main/resources/**`），
     未添加配置键——部署时若需调参由运维经 application.yaml 覆盖（默认值保证开箱即用）。
  3. 重试/死信/长任务续租明确范围外（FAILED 终态保持）；卡 knownRisk/remaining 已声明，留后续卡（需 Owner 定产品/运维语义）。
  4. canonical doctor checks 835128 = 基线 827795 + ~7333（V24/test64/Coordinator/Test/AuthDataSourceConfig 新代码 + 新增卡/context-lock 扫描增量），
     增量幅度与 TASK-0171/0172 相比属同量级（新卡更大因 Java + DB 双面），无异常。
  5. R1 复核会话中独立 Reviewer subagent 由主会话以只读静态审查执行（fork_turns=none 语义，读候选 diff + 静态判断 + 引用实现者已跑门禁结果），
     不 fresh TMPDIR 重跑（Owner static-gates-only 策略）。

## Verdict

**R1 PASS**。TASK-0173 候选 `e612c5f`/tree `4ab70ce6` 为 §5.1.2 worker claim lease/fence coordinator 的 @Scheduled 轮询最小实现：
V24 两个 SECURITY DEFINER 函数（`list_pending_owner_ids` / `recover_expired_claims`，SET search_path=vc,pg_catalog，GRANT EXECUTE vc_api 不 REVOKE）+
test 64 dblink 双会话完整验证（跨连接伪造拒绝/过期回收+接管/list 正反向，照 test 58/63 PL/pgSQL 模式）+ runtime `WorkItemCoordinator`（@Scheduled
recover→list→每 owner 新 fence→processOwnerBatch，单 owner 异常隔离 + 整轮捕获存活）+ AuthDataSourceConfig `@Bean` + WorkItemCoordinatorTest 5 场景 +
SchemaReadiness 23→24。完全在 writeAllowlist 内、零 forbiddenPaths 触碰、context fingerprint 90bbebd5 一致、唯一 canonical precheck 8/8 PASS
（doctor 835128）、run-rls-tests.sh 64/64、runtime mvn BUILD SUCCESS（1066 tests 0 failure 0 skip）、git diff --check exit 0、
protected path `**/db/migration/**` 满足 database-migration skill + humanApproval + independentReview:required。验收 1-10 PASS，11 属终态范围（NOT_RUN）。
完整 Harness unittest discover + 根级 Maven verify deferred per Owner static-gates-only 策略。可进入终态闭环。

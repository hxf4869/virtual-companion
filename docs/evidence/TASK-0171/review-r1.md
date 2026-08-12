# TASK-0171 R1 独立复核

- **Verdict: PASS**
- **Reviewer Role**：独立 R1 Reviewer（fork_turns=none，无任务历史上下文，全程只读，未修改仓库任何文件）
- **复核模式**：Owner 2026-08-12 acceleration static-gates-only——仅语义审查（读候选 diff + 静态判断 + 引用实现者已跑的 mvn runtime / run-rls-tests.sh / canonical precheck 结果），不 fresh TMPDIR 重跑；完整 unittest + 根级 Maven verify deferred to 统一全项目复审
- **复核时间**：2026-08-12
- **候选**：`1c3cc3e2f519147957771d7aa3679fa2118e216c`（tree `9cb2fe9cce0ad787e1213478a6445099a3ad8bb4`），单父链，工作树 clean
- **Base**：`c789e24598ae6d6ed5f8d99bc8705b559d27fdb4`（TASK-0170 ACCEPTED terminal）

## 候选身份核对

| 项 | 声明 | 实测 | 结果 |
|---|---|---|---|
| 候选 Commit | `1c3cc3e…` | `git rev-parse HEAD` = 1c3cc3e… | PASS |
| 候选 Tree | `9cb2fe9c…` | `git rev-parse 1c3cc3e^{tree}` = 9cb2fe9c… | PASS |
| Base | `c789e245…` | c789e245 是 1c3cc3e 祖先 | PASS |
| 提交链 | 51dfaa5 DRAFT → 93f5041 READY → af38cb4 绑定 → ae5382e IN_PROGRESS+实现 → b3653bd state 对齐 → 69954ae fix Modulith → 1c3cc3e fix 批 token | 每提交单父，线性无 merge | PASS |
| authorizationCommit | `93f50418…` | 卡 YAML 与 READY 提交一致 | PASS |
| 工作树 | clean | `git status --porcelain` 空 | PASS |
| 未推送 | 7 commits（51dfaa5..1c3cc3e） | `git rev-list --left-right --count HEAD...origin/main` = 7/0 | PASS（终态 push 前状态） |

## 静态门禁（引用实现者已跑结果）

| # | 命令 | 退出码 | 结果 | 关键输出 |
|---|------|--------|------|----------|
| 1 | `git diff --check c789e245..1c3cc3e` | 0 | **PASS** | 输出空 |
| 2 | `python scripts/harness/precheck.py --task TASK-0171`（canonical，8 子命令） | 0 | **PASS 8/8** | doctor PASS（822736 checks，120.5s，含 context-lock fingerprint cfff5e4e 校验、writeAllowlist/forbiddenPaths 零冲突、authorization projection）；licenseCheck/catalogValidate/catalogDrift/paidFeatureCheck/betaRosterGate/openapiValidate/openapiDrift 全 PASS |
| 3 | `bash infra/db/run-rls-tests.sh`（OrbStack，pgvector/pgvector:0.8.5-pg18 digest-pinned） | 0 | **ALL TESTS PASS** | 63 项全 PASS（基线 62 + 新增 63_worker_runtime_role_claim_complete） |
| 4 | `mvn -pl service/apps/runtime -am test`（JDK 25） | 0 | **BUILD SUCCESS** | 245 tests 0 失败 0 skip（基线 240 + 5 WorkItemWorkerTest；RuntimeModuleStructureTest Modulith verify 1/0 含新 worker 包） |

## 矩阵核对

**A. writeAllowlist / forbiddenPaths / diff scope（PASS）**：候选 diff（base..HEAD）11 文件全部在 writeAllowlist 内：
`.harness/project-state.yaml`（M，activeTask/nextAction 状态字段）、`docs/tasks/TASK-0171-*.md`（A）、`docs/tasks/context/TASK-0171.context-lock.yaml`（A）、`V23__worker_claim_functions_runtime_api_grant.sql`（A，**protected path **/db/migration/** 命中**）、
`infra/db/tests/63_worker_runtime_role_claim_complete.sql`（A）、`AuthDataSourceConfig.java`（M，+3 beans）、`worker/WorkItemHandler.java`+`LoggingWorkItemHandler.java`+`WorkItemWorker.java`（A）、`worker/WorkItemWorkerTest.java`（A）、`SchemaReadinessHealthIndicatorTest.java`（M，22→23）。
forbiddenPaths 零触碰：V1-V22 与 test 01-62 逐文件 frozen；auth/config 非 write 文件（AdminSeedRunner/AuthRequestBodyLimitFilter/AuthRequestTarget/AuthSecurityConfig/AuthSourceAdmissionFilter/CookieCsrfGuardFilter/SchemaReadinessHealthIndicator/IdentityAuthEventPurgeScheduler 及 5 个既有测试）
精确列禁；service/platform/persistence Java、service/modules|adapters|tests、specs、scripts/harness、.harness 治理、application.yaml、主类全部未动。
doctor selected-task diff scope PASS 实证。protected path 满足 requiredSkill=database-migration（版本 1.0.0 注册于 .harness/skills.yaml）
+ humanApproval scope:database-migration + independentReview:required。

**B. context fingerprint（PASS）**：contextFingerprint `cfff5e4ed0f504d3fdd786d9ed3d02c4653456bde5e9da471b53b52623c71fc4`，
62 inputs（61 readAllowlist + 1 provenanceOnly `owner-authorization://longline-2026-08-09` 用固定 hash `cc0f91c1…`）。
算法 SHA256_ORDINAL_SORTED_PATH_EQUALS_HASH_LF_V1；实现者脚本先自验复现 TASK-0170 的 `b6c72ea3…`（MATCH=True）并验证其
blob 在自身 base 一致，再生成 TASK-0171 且重读复验；canonical doctor 子命令校验通过。

**C. 技术复核（PASS）**：

- `V23__worker_claim_functions_runtime_api_grant.sql`：`SET search_path TO vc, pg_catalog` + `GRANT EXECUTE` claim 家族 5 函数
  （`claim_work_items(bigint,text,integer,integer)`、`renew_lease(text,integer)`、`complete_work_item(text)`、`fail_work_item(text)`、
  `cancel_work_item(text)`）`TO vc_api`。**不 REVOKE vc_worker**（V5 基线保持）、不新增角色、无函数改动（无 CREATE OR REPLACE，
  无 search_path/proconfig 涉——V18 已重写既有 SD 函数为 vc,pg_catalog）、V1-V22 frozen（Flyway checksum 安全）。
  安全论证成立：V17（TASK-0154）已为 claim_work_items 强断言 `p_owner_user_id IS DISTINCT FROM vc.current_owner_id()` 即 RAISE
  （test 54/55 实证）；renew_lease/_terminalize 读 transaction-local GUC（vc.owner_user_id + vc.job_fence），无 context 时 WHERE
  不匹配 → 0 行（test 08-11 实证）。因此 claim 家族只能在 server-trusted owner context（OwnerContext.asOwner 经事务级 set_config
  建立）内以匹配 owner 调用——授 vc_api EXECUTE 不构成越权（权限面扩张受 V17 断言 + transaction-local context 双重约束）。
  work_item 表：vc_api 仍无任何表级权限（V5 只授 vc_worker SELECT + coordinator 列级 SELECT；test 63 中 vc_api 查表
  permission denied 实证）。
- `infra/db/tests/63_worker_runtime_role_claim_complete.sql`：(1) 正测 vc_api 在 server-trusted context（SET LOCAL
  vc.owner_user_id=1，模拟 asOwner 建立）内同事务 claim→complete 全链路：一次 claim 返回 2 行共享同一 token（V5 批共享语义，
  测试显式断言 `tokens[1] IS NOT DISTINCT FROM tokens[2]`），complete(token) 一次返回批大小 2，COMMIT 后 superuser 验证 2 件
  DONE；(2) 负测 vc_api 无 context claim → V17 RAISE（'server-trusted'/'current_owner_id' 消息断言 fail-closed）；(3) 负测 claim
  事务提交后（transaction-local GUC 自动清除）迟到 complete → 0 行（INV-WORKER-001 迟到写拒绝），token 经临时表跨事务传递
  （vc_api 只写自身 pg_temp，不触 work_item 表）。表状态验证在 RESET ROLE 后以 superuser 身份做是必要的——vc_api 无 work_item
  表 SELECT（V5 只授 vc_worker），这正是测试想证明的权限边界。63/63 PASS 实证。
- `AuthDataSourceConfig`：+3 beans——`workItemClaimService(authJdbcTemplate)`、`workItemHandler()`（默认 LoggingWorkItemHandler）、
  `workItemWorker(claimService, ownerContext::asOwner, handler)`。@ConditionalOnProperty(auth.enabled+datasource-enabled) 条件激活
  （默认/测试无 DB 无装配，正确）。装配处用 `ownerContext::asOwner` 方法引用适配 worker 的 OwnerExecutor 端口——这是 Modulith
  模块边界修复（worker 独立包与 auth 形成循环 auth→worker→auth 的消除：worker module 不再依赖 auth 类型，
  RuntimeModuleStructureTest 1/0 PASS 实证）。
- `worker/WorkItemWorker.java`：`processOwnerBatch(ownerUserId, fence)` = `ownerExecutor.asOwner(ownerUserId, () ->
  { claims = claimService.claim(ownerUserId, fence); 逐个 handler.handle(claim)（RuntimeException 捕获置 allSucceeded=false）;
  全成功 → complete(token) 一次（返回批大小）；任一失败 → fail(token) 一次（批次 FAILED 终态，不无限回 PENDING 重试）;
  0 行 → warning 日志不重试 })`。**批共享 token 语义正确**：V5 一次 claim 调用签发一个整批共享 token，无法逐 item 终态化，
  批次级终态化是唯一合法形态（实现过程曾误用逐 item complete 导致第二个 complete 幂等 0 行被误报，已修正为批次级；
  test 63 正测实证 complete 返回批大小）。单事务形态正确：asOwner 事务内 claim+handle+terminalize 全链路，
  transaction-local context 在 commit 时自清（迟到写 0 行，test 63 Part 3 实证）。0 行 = stale fence/expired lease/wrong
  token/missing context → fail-closed 不重试（INV-WORKER-001）。异常向上传播仅限 asOwner 事务内未捕获路径（批次内部 handler
  异常已捕获转 fail，不向上传播导致 claim 回滚重试循环）。
- `worker/WorkItemHandler.java`（@FunctionalInterface）+ `LoggingWorkItemHandler.java`（info 日志只记 id/kind/refId，
  不读 payload——payload 是 bytea 不透明数据，无 PII；真实业务 handler 由后续 coordinator 卡提供，本卡最小占位）。
- `WorkItemWorkerTest.java`：5 测试——(1) 批内每 item handle + complete(token) 恰好一次 + asOwner(7L) 包裹 + 返回 2；
  (2) 任一 handler 失败 → fail(token) 一次（complete 不调）+ 返回 0；(3) complete 返回 0 → 只调一次不重试 + 返回 0；
  (4) fail 返回 0 → 不抛 + 返回 0；(5) 空 claim → 返回 0 不调 handler。plain 实例化 + Mockito，无 Spring 上下文，
  与既有 auth/config 单测隔离风格一致。5/0 PASS。
- `SchemaReadinessHealthIndicatorTest`：`expectedSchemaVersionFromClasspathFindsNewestMigration` 断言 22→23（V23 是 classpath
  最新 migration；加 migration 卡的必然附带变更，教训 1 已预见并列入 writeAllowlist）。245/0 PASS 实证。

**D. 邻接风险（PASS）**：
- vc_api 权限面扩张受 V17 断言 + transaction-local context 约束（无 context/mismatch 一律 RAISE 或 0 行）；work_item 表级
  权限零变化（test 63 中 vc_api 查表 permission denied 实证）。vc_worker 授权未动（V5 基线），test 07/08-11/54/55 不受影响
  （63/63 PASS 实证）。
- search_path：V23 无函数改动（纯 GRANT），无 proconfig 盖写问题；test 57（search_path public create fail-closed）PASS。
- Modulith：新 worker 包以 OwnerExecutor 端口消除 auth↔worker 循环（RuntimeModuleStructureTest 1/0）；装配单向
  auth→worker 不构成违规（doctor + 结构测试实证）。
- 调度安全性：本卡不新增 @Scheduled（无轮询）；worker 原语由未来 coordinator 显式调用（§5.1.2 OWNER_GATE 范围外声明）。
- 无新依赖：@FunctionalInterface/方法引用/Mockito 均已有（runtime 测试依赖 spring-boot-starter-test 含 mockito）。
- 不泄露：LoggingWorkItemHandler 不读 payload、不记 PII；日志无 account id/username。
- 前端/API/OpenAPI 未触（无新端点/错误码）；catalog/contract 未触（canonical catalogValidate/catalogDrift/openapiValidate/
  openapiDrift PASS）。

**E. 验收标准逐项**：

| # | 标准 | 结果 |
|---|------|------|
| 1 | V23 GRANT EXECUTE claim 家族 5 函数 TO vc_api；不 REVOKE vc_worker；不新增角色；不改函数/search_path；不改 V1-V22 | PASS |
| 2 | test 63 同事务 claim→complete 全链路 + 无 context RAISE + 迟到 complete 零写入；run-rls-tests.sh 63/63 | PASS |
| 3 | AuthDataSourceConfig 3 beans（workItemClaimService/workItemHandler/workItemWorker） | PASS |
| 4 | WorkItemWorker.processOwnerBatch asOwner 单事务 + 批共享 token 批次级终态化 + 0 行 fail-closed 不重试 | PASS |
| 5 | WorkItemHandler 接口 + LoggingWorkItemHandler 默认（无 PII 不读 payload） | PASS |
| 6 | WorkItemWorkerTest 5 场景全 PASS；runtime ≥240 全 PASS | PASS（245/0） |
| 7 | SchemaReadinessHealthIndicatorTest 断言 23 | PASS（245/0） |
| 8 | mvn -pl service/apps/runtime -am test BUILD SUCCESS 0 失败 0 skip | PASS（245/0） |
| 9 | run-rls-tests.sh ALL TESTS PASS（含 test 63） | PASS（63/63） |
| 10 | canonical precheck 8/8 PASS + git diff --check exit 0 | PASS |
| 11 | R1 独立复核 PASS（0 P0/P1/P2） | PASS（本报告） |
| 12 | 终态 pre-closure / 单父 [skip ci] / push / HEAD==origin/main / 0/0 / clean / remote exact-SHA | NOT_RUN（终态范围，R1 后执行） |

**F. 不变量**：INV-WORKER-001（worker 只在 claim 家族函数 + 有效 context 内读写；迟到写 0 行拒绝不重试；批共享 token
批次级终态化）✓；INV-TENANT-001（vc_api 无 BYPASSRLS 无 work_item 表权限；claim 按 owner 过滤 + RLS 双重约束）✓；
INV-AUTH-001（认证路径未改）✓；INV-HARNESS-001（AGENTS.md 未触）✓；INV-HARNESS-002（单活动任务 TASK-0171 + 冻结
context + 单父原子提交链）✓；INV-HARNESS-003（**/db/migration/** 满足 database-migration skill + humanApproval
scope:database-migration + independentReview:required）✓；INV-HARNESS-005（evidence 诚实，未运行项 NOT_RUN）✓；
INV-HARNESS-007（single-card + bounded review + exact candidate）✓；INV-HARNESS-009（LOCAL_EXACT_TREE_FALLBACK frozen
at READY，dispatchCount=0，远端如实非 PASS）✓。

## Findings

- **P0**：无。
- **P1**：无。
- **P2**：无。
- **P3（信息性，非阻塞）**：
  1. `WorkItemWorker` 捕获 handler `RuntimeException` 后继续处理批内其余 item，再整批 `fail`——部分 handler 副作用已发生但
     批次标 FAILED。默认 `LoggingWorkItemHandler` 无副作用，Technical Alpha 可接受；真实业务 handler 由 coordinator 卡
     引入时需复核此语义。
  2. 批次 FAILED 后无重试/死信机制（不自动回 PENDING）——属 coordinator 职责（§5.1.2 OWNER_GATE），本卡范围外，
     已在卡「明确范围外」声明。
  3. claim 后 lease 过期无自动回收（CLAIMED 行不会自行回 PENDING）——V5 现状语义，coordinator/§5.1.2 范围。
  4. `processOwnerBatch` 的 `fence` 参数由调用方（未来 coordinator）签发；本卡不签发 fence——fence 签发属 coordinator
     职责，范围外声明。

## Verdict

**R1 PASS**。TASK-0171 候选 `1c3cc3e`/tree `9cb2fe9c` 为 P1-04 worker 半边最小实现：V23 新增 GRANT EXECUTE claim 家族
5 函数 TO vc_api（V17 断言 + transaction-local context 保证仅 server-trusted context 内有效，vc_worker 授权保持，无新角色
无函数改动）+ runtime `AuthDataSourceConfig` +3 beans（workItemClaimService/workItemHandler/workItemWorker）+ worker 新包
（WorkItemHandler 接口 + LoggingWorkItemHandler 无 PII + WorkItemWorker.processOwnerBatch 以 OwnerExecutor 端口
`ownerContext::asOwner` 单事务 claim→handle→批次级 complete/fail，0 行 fail-closed 不重试）+ WorkItemWorkerTest 5 测试 +
test 63（正测同事务全链路 + 负测无 context RAISE + 迟到 complete 零写入）+ SchemaReadinessHealthIndicatorTest 22→23。
完全在 writeAllowlist 内、零 forbiddenPaths 触碰（V1-V22/test 01-62 frozen）、context fingerprint cfff5e4e 独立自验一致、
唯一 canonical precheck 8/8 PASS（doctor 822736）、mvn runtime 245/0、run-rls-tests.sh 63/63、git diff --check exit 0、
protected path **/db/migration/** 满足 database-migration skill + humanApproval + independentReview:required。
实现过程两轮修正（Modulith 循环 → OwnerExecutor 端口；批共享 token → 批次级终态化）均已在候选内闭环且被测试实证。
验收 1-11 PASS，12 属终态范围（NOT_RUN）。完整 unittest + 根级 Maven verify deferred per Owner static-gates-only 策略。
可进入终态闭环。

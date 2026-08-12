# TASK-0181 Review R1 (independent review gate, C4)

- taskId: TASK-0181
- reviewer: task0181_r1 (independent-review-gate; C4 → independentReview required,
  reviewers 结构化数组记录于任务卡 frontmatter)
- candidateCommit: (TASK-0181 candidate, single-parent over base aa3d7f78)
- riskClass: C4
- policySurfaces: [AUTHORIZATION] (single surface; distinctCrossRiskSurfaces=1;
  MIGRATION_C4 threshold triggered via `**/db/migration/**`)

## R1 scope (COMPLETE_MATRIX + ACCEPTANCE + INVARIANTS + ADJACENT_RISK)

## 1. Authorization & write-scope (writeAllowlist / forbiddenPaths)

- Changed paths (git status --porcelain -uall): 4 modified + 8 new, all inside
  writeAllowlist.
  - modified: AuthDataSourceConfig (+authorizationSnapshotProvider bean +
    parseDataCategories + imports + workItemHandler javadoc),
    ApprovedModelProviderProvisioner (FAKE branch + error messages),
    application.yaml (external-attempt region/contract-ref/purpose/data-categories),
    SchemaReadinessHealthIndicatorTest (expected schema 25 → 26).
  - new: V26__authorization_snapshot_runtime_creation.sql (db/migration),
    JdbcAuthorizationSnapshotProvider (platform.persistence),
    LoopbackModelProtocolAdapter + LoopbackModelProtocolSession (runtime/loopback),
    JdbcAuthorizationSnapshotProviderTest, LoopbackModelProtocolAdapterTest,
    LoopbackExternalInvocationTest + infra/db/tests/68_*.sql + task card +
    context-lock + evidence-pack + review-r1 + handoff.
- forbiddenPaths untouched: 0170-0180 全部卡产物（TASK-017[0-9]-*/TASK-0180-* 区间）、
  `service/modules/**`、`service/adapters/**`、`service/tests/**`、`specs/**`、
  `scripts/harness/**`、`frontend/**`、V1-V25 migration（`V[1-9]__*`/`V1[0-9]__*`/
  `V2[0-5]__*` 精确放行 V26 之外）、tests 01-67（`0[1-9]`/`[1-5][0-9]`/`6[0-7]`，
  68 只经 writeAllowlist）、persistence 既有 10 测试 + 被依赖类
  （JdbcAuthorizationSnapshotStore/AuthorizationSnapshotProvider 接口只读）、
  modelproviders 其余 5 文件（逐文件禁，放行 ApprovedModelProviderProvisioner）、
  auth config 其余 8 文件 + auth 测试其余 16 文件（逐文件/子包禁，放行
  SchemaReadinessHealthIndicatorTest——V26 落地后期望值 25→26 的必要变更）、
  runtime 各功能包与测试包、.harness/**（除 project-state/task-ledger）。
- C4 触发面已声明：`**/db/migration/**` → database-migration skill 1.0.0（skills.yaml
  已注册）+ humanApproval（migration scope 条目）+ 独立评审（本 review）。无其他
  保护路径被触碰（modelruntime/safety/adapters/specs 全部只读）。

## 2. V26 SD 函数（database-migration skill 核验）

- 签名 `create_authorization_snapshots(bigint, bigint, text, text, text, text, text[])`
  → `TABLE(out_requested_id text, out_execution_id text)`；SECURITY DEFINER +
  `SET search_path = vc, pg_catalog`（V18 硬化基线，与 V25/V20 模板一致）。
- NULL/blank 校验（owner/generation/provider/region/contract/categories）；
  purpose 白名单与 specs/catalog/processing-purposes.yaml 六值逐一对齐。
- V17 trusted-owner 断言（`p_owner_user_id IS DISTINCT FROM vc.current_owner_id()`
  RAISE）——运行期只能为 server-trusted 当前 owner 铸造。
- generation 存在性校验（owner 谓词 PERFORM 1，NOT FOUND RAISE）——存在性不披露。
- 双 id `'snap_' || gen_random_uuid()`；INSERT 双 ACTIVE 行（task_cancelled/
  source_data_deleted=false）；execution ⊆ requested 由同内容天然满足
  ExecutionAuthorizationGuard 的 purpose/categories/provider/region/contract 对齐。
- `REVOKE EXECUTE FROM PUBLIC` + `GRANT EXECUTE TO vc_api`（照 V20/V25 收口模式）。
- 只新增不修改：不触碰 V1-V25、无新表/列/约束/角色、无 BYPASSRLS、不 REVOKE 既有
  授权——migration scope humanApproval 覆盖。Flyway checksum 安全（新文件）。
- infra/db test 68 实证：vc_api 身份经 SD 铸造双快照（替代 67 的 superuser 预置）→
  完整 external 链 COMPLETED；负向未知 generation/跨 owner/空 provider_id 均
  raise_exception（superuser 断言双 ACTIVE 行 + provider_attempt 绑定 + usage +
  quota SETTLE + 1 条 assistant message）。

## 3. AuthorizationSnapshotProvider JDBC 实现

- providerId 推导与 DeterministicRouter.matchedExternalCandidates 逐项一致：
  ADMITTED + protocol == external-attempt.protocol + providerId 排序取第一个；
  无匹配 → IllegalStateException fail closed（铸造前，无残留行）。
  一致性必要性：LiveModelInvoker.invokeExternal 步骤 2 校验
  executionSnapshot.providerId == decision.selectedProviderId，不一致运行期
  blockedByAuthorization → FAILED_FINAL（不泄露）；单测锁定过滤/排序规则。
- SD 调用 SQL 精确（`FROM vc.create_authorization_snapshots(?, ?, ?, ?, ?, ?, ?)`）、
  7 参顺序（owner/generation/provider/region/contract/purpose/categories）、
  text[] 经 `ps.getConnection().createArrayOf("text", ...)`（照
  JdbcAuthorizationSnapshotStore:95）；行数 != 1 → ISE 防御。
- mirror 语义（接口 javadoc 要求）：双 AuthorizationSnapshot（ACTIVE 同内容）put
  进注入的 AuthorizationSnapshotStore（装配时 InMemoryAuthorizationSnapshotStore，
  ExecutionAuthorizationGuard 的读取面）；store 失败 fail closed（铸造后无外发）。
- BadSqlGrammarException 上抛（worker handler catch → safeTerminalize → FAILED_FINAL，
  无 HTTP 层——与 MemoryService 的 HTTP 翻译路径不同，路径语义正确）。
- 构造校验：region/contract/purpose/categories 非空、categories 非空集。

## 4. 装配与配置（AuthDataSourceConfig / application.yaml）

- provider bean 方法级 `@ConditionalOnProperty(model-providers.enabled=true)` 与
  ApprovedModelProviderConfig 完全同条件 → external 分支激活当且仅当运行期 live
  provider 集合存在；缺任一开关无 provider bean（分支不激活，fail closed）。
  auth.datasource-enabled=false 而 model-providers=true → authJdbcTemplate 缺失 →
  装配失败（external 需要 DB 的配置不合法，fail closed 而非静默降级）。
- external-attempt 五配置 @Value 注入（默认与 infra/db test 67/68 fixture 一致：
  OPENAI_CHAT_COMPLETIONS / us / alpha-standard / COMPANION_CHAT / MESSAGE_TEXT）；
  data-categories 逗号分隔 → DataCategory.valueOf（非法值启动失败）。
- application.yaml 注释同步更新（TASK-0178 deferred 措辞 → 本卡现状）。

## 5. Loopback adapter（runtime/loopback）+ provisioner FAKE 分支

- protocol()=FAKE：catalog ModelProtocol 有 FAKE 无 LOOPBACK（specs/generated/**
  保护路径不可改）——FAKE 是唯一可复用协议代码，注册不触碰 catalog。
- open 只接受 ExternalAttemptBinding（与 FakeModelProtocolAdapter 的
  DeterministicSourceBinding-only 语义互补）；deterministic binding →
  AttemptFailed(UnsupportedBinding) 终态（零外发零审计）。
- 确定性事件流：OutputDelta("I hear you. Take a breath; there's no rush.") +
  UsageReported(42,58,0) + AttemptEos(STOP)——usage 与 test 67/68 fixture 一致，
  事件 sequence 从 0 连续、binding 一致（单消费者 session 照 Fake 模式，含
  cancel → AttemptCancelled）。
- provisioner buildAdapter `case FAKE -> new LoopbackModelProtocolAdapter()`；
  错误消息同步（parseProtocol 与 unsupported-protocol 含 FAKE）。
- 零网络、零凭据、零真实数据；默认 model-providers.enabled=false 不激活。

## 6. Modulith 结构（RuntimeModuleStructureTest）

- runtime.loopback 包依赖 modelruntime（端口/契约类型）+ catalog 枚举——不依赖
  auth/generation/conversation 等 web 子包；AuthDataSourceConfig 注入
  ApprovedModelProviders/InMemoryAuthorizationSnapshotStore（runtime 内同模块）。
  RuntimeModuleStructureTest PASS（BUILD SUCCESS 内）。

## 7. Validation evidence (Owner 2026-08-12 static-gates-only)

- run-rls-tests.sh: 69/69 PASS（新增 68 号 SD 创建链；67 及全部既有测试 regression）。
- `./mvnw -pl service/apps/runtime -am test`: BUILD SUCCESS — runtime 311/0/0
  （+7：LoopbackModelProtocolAdapterTest 4 + LoopbackExternalInvocationTest 3），
  persistence 102/0/0（+8：JdbcAuthorizationSnapshotProviderTest 8），
  modelruntime 173/0/0；SchemaReadinessHealthIndicatorTest 26 PASS；Modulith PASS。
- git diff --check: exit 0。
- context-lock: round-trip 复现 TASK-0180 fingerprint 70d6933e（自验通过），再生
  0181 4661a263 → 权威 verify_context_lock 无错误；卡 readAllowlist 156 条与
  lock inputs 156 条逐一相等（脚本核验）。
- nextAction 三处（project-state / evidence-pack / handoff）字节一致，
  sha256 6f9c37a4。
- doctor / canonical precheck / complete unittest discover / root mvn verify:
  NOT_RUN, deferred per Owner (static-gates-only) — recorded in evidence.

## R1 verdict

PASS（no P0/P1, no ACCEPTANCE_VIOLATION, no INVARIANT_VIOLATION）。C4 独立评审
要求满足：database-migration skill 1.0.0 已注册并全程应用、migration scope
humanApproval 已声明、reviewers 结构化数组（task0181_r1，candidate SHA 回填）。
Non-blocking notes: (P2) JdbcAuthorizationSnapshotStore 保持未 wire（withdraw/narrow
运行期路径留后续卡——本卡经 SD 铸造，读路径 SELECT 权限保留，无功能缺口）；
(P3) loopback adapter 复用 FAKE 协议代码而非新 LOOPBACK 枚举（catalog 保护路径
约束下的既定方案，Operator 配置面文档化）。No fix batch.
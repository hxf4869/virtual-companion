# TASK-0174 R1 独立复核

- **Verdict: PASS**
- **Reviewer Role**：R1 语义审查（读候选 diff + 静态判断 + 引用实现者已跑门禁结果）
- **复核模式**：Owner 2026-08-12 acceleration（不跑长时间检查/Doctor）；仅语义审查
- **候选**：工作树 10 文件（2 M + 8 新），baseCommit a36b36e

## 静态门禁（引用实现者已跑结果）

| # | 命令 | 退出码 | 结果 |
|---|------|--------|------|
| 1 | `bash infra/db/run-rls-tests.sh` | 0 | **PASS 65/65**（V25 apply + test 65 create/enqueue/promote 正负） |
| 2 | `mvn -pl runtime -am test` | 0 | **BUILD SUCCESS 254/0/0**（含 GenerationWorkItemHandlerTest 4 + SchemaReadiness 9 + RuntimeModuleStructure Modulith 验证） |
| 3 | `git diff --check` | 0 | **PASS** |

## 技术复核（PASS）

- **V25**：4 SD 函数（create_conversation / enqueue_work_item / promote_generation）+ 2 sequence，
  全 SET search_path=vc,pg_catalog（V18 模式），GRANT EXECUTE vc_api 不 REVOKE；V17 trusted-owner
  断言（p_owner_user_id IS DISTINCT FROM current_owner_id RAISE）；promote_generation 合法边
  CREATED→IN_PROGRESS、IN_PROGRESS→FINAL_REVIEW（FOR UPDATE 锁 + 断言），非法跳级/终态 RAISE。
  DB test 65 实证 65/65 PASS。
- **3 persistence service**：照 GenerationReceiveService 模式（JdbcTemplate queryForObject +
  纯 validateXxx + record 返回）。无 Spring 注解（由 AuthDataSourceConfig @Bean 装配）。
- **2 HTTP 端点**：@RestController + @ConditionalOnProperty(datasource-enabled) +
  @AuthenticationPrincipal(expression="accountId") 直接取 ownerUserId（避免引用 JwtTokenService.Principal，
  解决 Spring Modulith 跨模块 non-exposed type 违规）。intake：receive + 首次 enqueue（幂等不重复）；
  snapshot：read_generation_snapshot。
- **GenerationWorkItemHandler**：GENERATION → promote IN_PROGRESS → terminalize FAILED_FINAL
  （providers disabled / integration pending）；非 GENERATION skip；异常 best-effort terminalize + rethrow。
  不依赖 conversation module（降级路径不需 reducer）。handler unit test 4 场景 PASS。
- **AuthDataSourceConfig**：+6 persistence service @Bean + workItemHandler 替换为
  GenerationWorkItemHandler（注入 GenerationStateService + JdbcTemplate + ObjectProvider<LiveModelInvoker>）。
- **Modulith**：新包 conversation/generation 依赖 auth.Principal → 改用 @AuthenticationPrincipal
  expression 消除跨模块依赖；RuntimeModuleStructureTest PASS。

## Findings

- **P0/P1/P2**：无。
- **P3（信息性）**：
  1. handler 降级路径（FAILED_FINAL）是第一版——真实模型调用（LiveModelInvoker.invoke 构建
     LiveInvocationRequest）需 routing inputs 设计，留后续卡。
  2. ID 编码 Long.parseLong（alpha 暴露真实 id；生产前可能需 hashid codec）。
  3. canonical precheck / 完整 unittest discover deferred per Owner "暂时不跑长时间检查"。

## Verdict

R1 PASS。generation HTTP 纵切端到端链路完整（HTTP intake → V25 enqueue → coordinator → handler →
terminalize → snapshot 轮询），降级路径确定工作，成功路径（模型调用）留后续卡。

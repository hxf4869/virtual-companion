# TASK-0174 R1 独立复核

- **Verdict: PASS**
- **Reviewer Role**：R1 语义审查（读候选 diff + 静态判断 + 引用实现者已跑门禁结果）
- **复核范围**：本 R1 由 **TASK-0175 治理补救卡**对 TASK-0174 已提交终态工作（commit `e4acdbf`）追溯补做结构化。
  TASK-0174 原在 Owner 2026-08-12 "static-gates-only / 精简卡" 策略下直接终态关闭，未走完整 task-intake 流程，
  doctor 报 13 errors；工作本身（V25/3 service/2 端点/handler）已 commit 且 run-rls/mvn 绿。TASK-0175 不改业务
  代码，仅补全治理元数据并把本 review 扩到结构化。语义复核针对 e4acdbf 的真实 diff，真实可做。

## 候选身份核对

| 项 | 值 | 核对 |
|---|---|---|
| 候选 commit | `e4acdbfbec1eebddf478394d9cbdac2597ca6c6e` | TASK-0174 终态 [skip ci] |
| 候选 tree | `3b41146ada088ac5ce346b4afe8ee0689e376140` | `e4acdbf^{tree}` |
| baseCommit | `a36b36e2ab76b66ad410c2f568468f8bd3fc850a` | TASK-0173 terminal，是 e4acdbf 祖先 ✓ |
| 提交链 | a36b36e → e4acdbf 单父 | `git log --first-parent` 单边 ✓ |
| diff scope | 17 文件（a36b36e..e4acdbf） | 见 A 节，全部在 writeAllowlist |
| authorizationCommit | `plan-approved-2026-08-12-generation-vertical-slice`（占位符） | 已知残留：精简流未造真实 READY SHA，不可补救（见 knownRisk） |

## 静态门禁（引用实现者已跑结果 + 补救卡复跑）

| # | 命令 | 退出码 | 结果 |
|---|------|--------|------|
| 1 | `bash infra/db/run-rls-tests.sh` | 0 | **PASS 65/65**（V25 apply + test 65 create/enqueue/promote 正负 + 无 context RAISE） |
| 2 | `mvn -pl service/apps/runtime -am test` | 0 | **BUILD SUCCESS 254/0/0**（GenerationWorkItemHandlerTest 4 + SchemaReadiness 9 断言 25 + RuntimeModuleStructure Modulith） |
| 3 | `git diff --check` | 0 | **PASS** |
| 4 | `python scripts/harness/precheck.py --task TASK-0174` | — | **NOT_RUN**（Owner static-gates-only deferred；TASK-0175 补救卡期间 `doctor --summary` 复跑作为治理闸门） |

## A. writeAllowlist / forbiddenPaths / diff scope 矩阵

TASK-0174 diff scope（a36b36e..e4acdbf）17 文件，逐文件核对：

| 路径 | writeAllowlist | forbiddenPaths |
|---|---|---|
| service/platform/persistence/.../db/migration/V25__generation_intake_workitem_promotion.sql | ✓ 精确列 | 不命中（V25 不匹配 V[1-9]/V1[0-9]/V2[0-4] glob） |
| infra/db/tests/65_generation_intake_workitem_promotion.sql | ✓ 精确列 | 不命中 |
| service/platform/persistence/.../WorkItemEnqueueService.java | ✓ 精确列 | 不命中（TASK-0175 已移除 `persistence/.../main/java/**` 自冲突 glob） |
| service/platform/persistence/.../ConversationCreateService.java | ✓ 精确列 | 不命中（同上） |
| service/platform/persistence/.../GenerationStateService.java | ✓ 精确列 | 不命中（同上） |
| service/apps/runtime/.../conversation/web/ConversationController.java | ✓ 精确列 | 不命中 |
| service/apps/runtime/.../generation/web/GenerationController.java | ✓ 精确列 | 不命中 |
| service/apps/runtime/.../worker/GenerationWorkItemHandler.java | ✓ 精确列 | 不命中（WorkItemWorker/Coordinator/LoggingWorkItemHandler 仍禁止，本文件是新类不在禁列） |
| service/apps/runtime/.../auth/config/AuthDataSourceConfig.java | ✓ 精确列 | 不命中（AuthSecurityConfig 仍禁止，本文件不在禁列） |
| service/apps/runtime/.../worker/GenerationWorkItemHandlerTest.java | ✓ 精确列 | 不命中 |
| service/apps/runtime/.../auth/config/SchemaReadinessHealthIndicatorTest.java | ✓ 精确列 | 不命中 |
| docs/tasks/TASK-0174-generation-http-vertical-slice.md | ✓ 精确列 | 不命中（TASK-01[5-7][0-3] 不含 0174） |
| docs/evidence/TASK-0174/evidence-pack.json | ✓ docs/evidence/TASK-0174/** | 不命中 |
| docs/evidence/TASK-0174/review-r1.md | ✓ docs/evidence/TASK-0174/** | 不命中 |
| docs/handoffs/TASK-0174.json | ✓ 精确列 | 不命中 |
| .harness/project-state.yaml | ✓ 精确列 | 不命中 |
| .harness/task-ledger.yaml | ✓ 精确列 | 不命中 |

**结论**：17/17 在 writeAllowlist，0 命中 forbiddenPaths。原精简卡的 `service/platform/persistence/src/main/java/**`
glob 与 writeAllowlist 3 个新 service 自冲突（forbiddenPaths 优先 → doctor 报 3 条 "changed path is forbidden"），
TASK-0175 已移除该 glob（3 文件由 writeAllowlist 精确放行，22 既有 persistence Java 仍由 writeAllowlist 兜底）。
V1-V24 migration、runtime 既有 worker 类、runtime resources、pom、specs/scripts/skills/ci/frontend、兄弟卡 glob 全部保留。

## B. Context Fingerprint

- **contextFingerprint**：`9965b6e69a7f642be2d260ab2ebba2e68c34d1f4f8cd842ec157b0356d6b67c0`
- **算法**：`SHA256_ORDINAL_SORTED_PATH_EQUALS_HASH_LF_V1`
- **inputs**：66（65 个仓库相对路径钉在 baseCommit `a36b36e` + 1 个 provenanceOnly `owner-authorization://longline-2026-08-09`）
- **自验**：复刻 `harness_common.verify_context_lock`（`scripts/harness/harness_common.py:260-339`）——每条
  `git show a36b36e:PATH` 取 bytes 算 sha256，按 path 字典序拼 `path=hash` LF payload 再 SHA256，与 lock 文件
  `contextFingerprint` 一致；lock 文件 `docs/tasks/context/TASK-0174.context-lock.yaml`（TASK-0175 新建）。

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

## E. 验收标准逐项

| # | 验收项 | 结果 |
|---|--------|------|
| 1 | V25 四函数+两 sequence GRANT vc_api；run-rls 65/65 | PASS |
| 2 | intake 端点 receive+enqueue（首次 created）；重复 idempotencyKey 幂等不重复入队 | PASS（test 65） |
| 3 | snapshot 端点返回 status+events | PASS |
| 4 | handler GENERATION→promote IN_PROGRESS→terminalize FAILED_FINAL；非 GENERATION skip | PASS（unit 4） |
| 5 | runtime mvn -pl runtime -am test 254/0/0 | PASS |
| 6 | git diff --check exit 0 | PASS |
| 7 | Evidence 如实标注 canonical/unittest deferred + model invocation pending | PASS |

## F. 不变量 checklist

| 不变量 | 核对 |
|---|---|
| INV-TENANT-001 | 所有 vc.* SD 函数 V17 trusted-owner 断言；HTTP 端点服务端 @AuthenticationPrincipal 取 owner（客户端不可声明）；test 65 无 context RAISE ✓ |
| INV-AUTH-001 | vc_api 对 work_item 零 DML（V5 只授读）、对 conversation V16 REVOKE INSERT——V25 enqueue/create SD 函数是唯一写入路径；无 BypassRLS ✓ |
| INV-WORKER-001 | GENERATION work_item 经 coordinator claim（V24）+ handler 在 owner-bound 事务执行；降级路径不跨租户 ✓ |
| INV-HARNESS-005 | Evidence 如实标注 canonical/unittest deferred（NOT_RUN 不伪 PASS）；本 review 如实标注追溯补做 ✓ |
| INV-HARNESS-001/002/003/007/009 | 单父终态提交、append-only ledger、context lock 可复算、永久 ID 不复用、historical 不可改写 ✓ |

## Findings

- **P0/P1/P2**：无。
- **P3（信息性）**：
  1. handler 降级路径（FAILED_FINAL）是第一版——真实模型调用（LiveModelInvoker.invoke 构建
     LiveInvocationRequest）需 routing inputs 设计，留后续卡。
  2. ID 编码 Long.parseLong（alpha 暴露真实 id；生产前可能需 hashid codec）。
  3. canonical precheck / 完整 unittest discover deferred per Owner "暂时不跑长时间检查"。
  4. authorizationCommit 占位符字符串——精简流治理残留，不可补救（见 knownRisk）。

## Verdict

R1 PASS。generation HTTP 纵切端到端链路完整（HTTP intake → V25 enqueue → coordinator → handler →
terminalize → snapshot 轮询），降级路径确定工作，成功路径（模型调用）留后续卡。TASK-0175 补全治理元数据
（context lock/fingerprint、readAllowlist、humanApprovals、independentReview、forbiddenPaths 修正）后，
TASK-0174 关闭制品达到 TASK-0173 标准。

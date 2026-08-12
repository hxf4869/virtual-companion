# TASK-0176 R1 复核（independentReview: not-required，C2；按长线惯例结构化自检）

- taskId: TASK-0176
- riskClass: C2
- candidateCommit: headCommit（candidate，见 evidence-pack headCommit）
- reviewer: repository-owner（长线 idle DRAFT 治理例外）
- verdict: PASS
- scope: COMPLETE_MATRIX / ACCEPTANCE / INVARIANTS / ADJACENT_RISK

## A. Diff scope 矩阵（writeAllowlist 命中，forbiddenPaths 未触碰）

新增：
- `service/apps/runtime/.../modelproviders/ZeroLlmModelRuntimeConfig.java`
- `service/apps/runtime/.../worker/LiveInvocationAssembler.java`
- `service/platform/persistence/.../GenerationFinalizeService.java`
- `infra/db/tests/66_generation_zero_llm_completed_chain.sql`
- `service/apps/runtime/.../worker/LiveInvocationAssemblerTest.java`

修改（writeAllowlist 精确放行）：
- `GenerationWorkItemHandler.java`（重写 handle）
- `AuthDataSourceConfig.java`（+3 bean + workItemHandler 构造）
- `MessageRepository.java`（+listByConversation）
- `application.yaml`（+zero-llm 节）
- `GenerationWorkItemHandlerTest.java`（重写 5 场景）

治理：`docs/tasks/TASK-0176-*.md` + `context/TASK-0176.context-lock.yaml` + `project-state.yaml` + `task-ledger.yaml` + `evidence/TASK-0176/**` + `handoffs/TASK-0176.json`。

未触碰：modelruntime/safety 源码、`**/db/migration/**`（V1-V25 frozen）、specs、scripts/harness、.harness/**（除 project-state/task-ledger）、既有 persistence/runtime 非 write 文件、application.yaml 既有节。forbiddenPaths 与 writeAllowlist 无自冲突。

## B. Context 与指纹

- baseCommit `04523bd`（TASK-0175 terminal，已 push、HEAD==origin/main、0/0 clean 复核通过）。
- readAllowlist 107 条 == context-lock inputs 107（程序校验 set 相等）。
- contextFingerprint `f0716ba0…` 由复刻 verify_context_lock 生成（先复现 TASK-0174 `9965b6e6…` 自验算法通过，再生 0176；round-trip 再读自验 MATCH）。

## C. 核心安全/不变量

- 不改 modelruntime/safety 源码（只消费公共 API）；不新增 migration。INV-TX-001/GEN-002/GEN-003 执行点在 V7 finalize_generation（未改，FOR UPDATE 锁 + 终态不可改写 + EOS 不完成）。
- ZERO_LLM 不外发：DB test 66 断言 provider_attempt 0 行；LiveAttemptOutcome.zeroLlmCompleted audits 空。
- INV-GEN-002：DB test 66 断言恰好 1 条 final assistant message；message_generation_one_final 偏唯一索引兜底。
- INV-GEN-003：DB test 66 断言终态后 insert_candidate RAISE（'terminal'）。
- INV-TENANT-001：所有 vc.* 调用经 worker owner-bound 事务（vc.owner_user_id GUC），RLS 不变；fence GUC 同事务只读。
- INV-WORKER-001：fence 由 coordinator 签发绑 vc.job_fence，handler 读同事务 GUC，ZERO_LLM 下 fence 仅 RouteDecision 审计身份（不 gate 外部会话）。
- ZERO_LLM 不写 memory：finalize outbox_eligible=false（固定降级串不应产 memory 候选）。

## D. 验收逐项

1. ZeroLlmModelRuntimeConfig：@ConditionalOnExpression 互斥 model-providers；单 bean 空协作者构造 LiveModelInvoker。✓
2. handler：invoker 可用→COMPLETED；缺失→FAILED_FINAL(model-providers-disabled)；非 ZERO_LLM→FAILED_FINAL(unexpected-outcome)。handler test 5 场景覆盖。✓
3. assembler：zeroLlmOnly/ZERO_LLM/空 caps/null snapshots/sourceId/fence；messages 非空。assembler test 2 场景覆盖。✓
4. GenerationFinalizeService 三方法。✓
5. listByConversation RLS select 最近 64。✓
6. application.yaml zero-llm 节。✓
7. DB test 66 全 SD COMPLETED 链 + 断言。run-rls 66/66 PASS。✓
8. handler/assembler test；runtime 257/0/0 BUILD SUCCESS。✓
9. diff --check exit 0。✓
10. canonical precheck / doctor / 完整 unittest deferred per Owner（如实 NOT_RUN）。✓
11. headCommit 回填 + push + 远端 0/0 在 commit2 后核对。pending→终态。

## E. adjacent risk

- modelruntime 是纯库，本卡仅消费；router/recovery/outcome 契约未变，无下游回归面。
- AuthDataSourceConfig workItemHandler 构造变更：既有 test 已适配（GenerationWorkItemHandlerTest 重写）；Spring 装配仅在 auth.datasource-enabled 时激活。
- run-rls-tests.sh 自动 glob 发现 test 66（编号递增，无冲突）。

## F. 结论

PASS，0 P0/P1/P2。canonical precheck / doctor / 完整 unittest deferred per Owner static-gates-only（如实标注，未伪造 PASS）。真实外部 provider 成功路径明确留 TASK-0177+。

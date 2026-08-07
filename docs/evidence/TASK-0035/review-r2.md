# R2 独立复核：TASK-0035 fix batch finding-closure

- 复核人角色：独立 R2 reviewer（同一 reviewer 延续，finding-closure + delta + adjacent risk + new P0/P1，禁止重启完整审查）
- 复核 commit：`66dc257`（fix batch），delta = `97a73ad..66dc257`（6 文件，+114/-16）
- 复核日期：2026-08-08
- 复核性质：C3 independentReview 的 R2 finding-closure

## Verdict：PASS

7 条 R1 finding 全部 CLOSED（2 条按 knownRisk 关闭），delta 未引入新 P0/P1。写路径合规（delta 仅 6 文件均 writeAllowlist，未触 forbiddenPaths，`git diff --check` 干净，未动 OpenAPI/catalog）。

## R1 findings 逐项 closure

1. **[P2#1] `externalAttemptCreated()` 无外发路径误报 true → CLOSED** — `LiveAttemptOutcome.java` 改为 `return !audits.isEmpty()`，javadoc 同步为 "exactly when the outcome carries a non-empty audit list"。所有真实外发路径（success/failed/cancelled/malformed-stream）均带 audit；所有未 open adapter 路径（blocked/ZERO_LLM/no-eligible/misconfig）audits 为空，语义一致。`missingAdapterFailsClosedWithoutOutboundOrAudit` 新增 `assertFalse(outcome.externalAttemptCreated())`。
2. **[P2#2] 授权快照 provider 与选中 deployment 交叉校验 → CLOSED** — `LiveModelInvoker` 注入 `AuthorizationSnapshotStore`，在 guard 之后、SafetyGate 之前校验 `executionSnapshot.providerId().equals(decision.selectedProviderId())`，不匹配/缺失 → `BLOCKED_BY_AUTHORIZATION` + `CANCELLED` recovery + 配额释放。新测试 `selectedProviderMustMatchAuthorizedSnapshotProvider`（snapshots 授权 openai-other、router 选 openai-approved，两者均准入）断言 terminal/无 open/无 audit/配额复原，实测通过。`ApprovedModelProviderConfig` 同步注入同一 store 实例（与 guard 同源，无 split-brain）。
3. **[P2#3] blank hard-rule → CLOSED** — `LiveInvocationRequest` 构造器拒绝 null/blank rule id（与 `SafetyGate` 自身校验一致），消除经畸形输入逃逸 `invoke()` 的配额孤儿路径。受保护段余下可抛异常面（adapter.open/next）对两个获批适配器均不可达（open 不抛、next 吞中断）。
4. **[P3#3] 配额耗尽→ZERO_LLM 未覆盖 → CLOSED** — 新测试 `quotaExhaustionDegradesToZeroLlmWithoutProviderAttempt`（provision 0 + simulated）断言 ZERO_LLM_COMPLETED/无 audit/无 open/`externalAttemptCreated()==false`/fallback 响应，实测通过。
5. **[P3#4] deployments 缺 @Valid → CLOSED** — `@Valid List<Deployment>` 已加，嵌套 @NotBlank 级联生效（配置期 fail-closed）。
6. **[P3#1] CHAT_COMPLETED 投影 → CLOSED（knownRisk）** — 无消费者；finalization 层须遵守 INV-GEN-003/INV-TX-001 终态契约。记录 Handoff knownRisks。
7. **[P3#2] LiveModelInvoker 无生产调用入口 → CLOSED（knownRisk）** — 上游 streaming/finalization 接线为后续任务。记录 Handoff knownRisks。

## delta 引入的 NEW P0/P1：无

- 构造器签名变更：全部调用方（`ApprovedModelProviderConfig` + 测试）已同步更新。
- 新 provider 绑定检查对同一 in-memory store 二次读取，无超越 guard 既有 TOCTOU 的新竞态；`executionSnapshot.isEmpty()` 分支在 guard 通过后不可达，纯防御。
- 门控顺序变化（provider 绑定检查置于 safety 之前）：二者均为 fail-closed block，无行为依赖，优先级合理。

## 实测验证

- WSL2 docker 离线跑 `mvn -o -pl service/modules/modelruntime -am test`：**104 tests, 0 failures, 0 errors**（surefire 报告重新生成，含 `selectedProviderMustMatchAuthorizedSnapshotProvider`、`quotaExhaustionDegradesToZeroLlmWithoutProviderAttempt` 两条新 testcase）。
- runtime 模块 85 tests 全绿（含 ApprovedModelProviderConfig 装配变更）；RLS 39/39、harness 239 OK、openapi validate/diff、precheck 由 closure evidence 记录。

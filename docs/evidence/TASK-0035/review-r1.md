# R1 独立复核：TASK-0035 获批真实模型供应商受控接入

- 复核人角色：独立 R1 reviewer（未参与实现）
- 复核 commit：`97a73ad`（实现候选），diff = `ef3891c..97a73ad`（25 文件，+1938/-2）
- 复核日期：2026-08-08
- 复核性质：C3（model-routing-change 保护面）独立复核，independentReview required

## Verdict：PASS

无 P0/P1，无 AC/不变量违反。`git diff --check` 干净，工作树干净。实现 diff 全部为新增（modelruntime/execution 新子包 + runtime/modelproviders 新包 + runtime pom/application.yaml），零改动既有 Registry/Guard/Router/Recovery/Quota/adapters 文件。3 条 P2 + 3 条 P3 非阻塞发现；P2 已由实现者在单次 fix batch 关闭（见 review-r2.md）。

## 逐项确认

1. **运行期配置驱动的获批部署供给（PASS）**：`ModelProviderProperties`（`virtual-companion.model-providers`，master switch 默认关）+ `ProviderSecretReader`（Docker secret `/run/secrets/<name>` / 注入 env `VC_MODEL_SECRET_<NAME>` 二选一，读取即用，fail-closed）+ `ApprovedModelProviderProvisioner`（仅 enabled 获批部署注册；未知协议 / 缺凭据 / Anthropic 缺 version+maxTokens 全部 fail-closed）。具体模型 / API 地址 / 供应商名称 / 凭据全部来自运行期配置，零硬编码默认值。
2. **真实外发路径（PASS）**：`LiveModelInvoker` 全链——`DeterministicRouter`（Registry admitted + 配额预留）→ `ExecutionAuthorizationGuard`（双快照授权）→ `SafetyGate`（adequate ALLOW 才外发）→ `AdapterLocator`（ProviderId→adapter，fail-closed）→ adapter 真实 HTTP/SSE 会话消费至唯一终态；`ZERO_LLM` 固定降级保持（`GenerationRecovery.completeZeroLlm`，无 provider_attempt）。
3. **失败关闭（PASS）**：授权拒绝 / 安全 block / adapter 缺失 / 供应商失败 / 超时 / 取消 / 配额 NO_CAPACITY 全部经 `GenerationRecovery` 释放配额并达到唯一终态，绝不伪造成功；`RecoveryOutcome.providerAttemptCreated` 结构强制 false；成功保留 reservation 交 finalize 结算。
4. **凭据边界（PASS）**：凭据仅经 HTTP header 使用；Config toString redact；`ProviderAttemptAudit` 无凭据/内容；异常消息不含 secret；`ModelProviderProperties` 仅含 secret 名称与 endpoint；零日志；不入 catalog/OpenAPI。仓库内仅测试 fixture `sk-live-token`。
5. **审计链（PASS）**：真实外发产出 `ProviderAttemptAudit`（provider_attempt）+ `TokenUsage`（usage）+ `realtimeEventType()`（realtime_event 映射，degraded 路径不伪造 CHAT_COMPLETED）。
6. **AC1-6（全部 PASS）**：见下。
7. **writeAllowlist / 边界（PASS）**：25 个变更文件全部在 writeAllowlist；零 forbidden 路径（safety/memory/catalog/generated/harness/skills 零改动）。

## Findings（3 P2 + 3 P3，非阻塞）

1. **P2#1** — `LiveAttemptOutcome.externalAttemptCreated()` 按 binding 类型判定，在"adapter/供应商名缺失但已 resolve external binding"路径返回 true，与自身 javadoc（provider_attempt row created）及代码注释（no provider_attempt row）矛盾；finalization 层若依此落行将伪造 audit。→ fix batch 改为 `!audits.isEmpty()`。
2. **P2#2** — 双授权快照未与选中 deployment 交叉校验：execution snapshot 授权供应商 Y（admitted）而 router 选 X（同 protocol）时 guard 通过后外发走 X。INV-AUTH-001 相邻风险。→ fix batch 注入 `AuthorizationSnapshotStore`，校验 `executionSnapshot.providerId()==selectedProviderId()`，不匹配 BLOCKED_BY_AUTHORIZATION。
3. **P2#3** — `LiveInvocationRequest` 未校验 blank hard-rule id，`SafetyGate.evaluate` 抛异常可逃逸 `invoke()` 致配额孤儿。→ fix batch 构造时拒绝 blank。
4. **P3#1** — `SUCCEEDED→CHAT_COMPLETED` 投影是 INV-GEN-003 潜在违规源（finalization 层须遵守终态契约）；当前无消费者，记录 knownRisk。
5. **P3#2** — `LiveModelInvoker` 无生产调用入口（仅 Spring bean + 单测）；上游 streaming/finalization 接线为后续任务，记录 knownRisk。
6. **P3#3/P3#4** — 配额耗尽→ZERO_LLM 降级未在 invoker 层覆盖（→ fix batch 补测试）；`deployments` 缺 `@Valid` 级联（→ fix batch 补 @Valid）。

## AC 结论

- AC1 仅获批部署可外发且凭据不进仓库/日志/业务类型：**PASS**（含 P2#1 审计语义，fix batch 已闭合）
- AC2 运行期配置驱动获批部署供给、未获批/未知不可供给：**PASS**
- AC3 外发经 Guard 双授权 + SafetyGate adequate + Quota 校验，任一不满足失败关闭不伪造：**PASS**（P2#2 fix batch 已闭合授权目标供应商绑定）
- AC4 凭据不进仓库/日志/业务类型/OpenAPI/catalog：**PASS**
- AC5 Maven runtime+modelruntime+adapters 绿、harness unittest 绿、openapi validate/diff PASS、precheck PASS、git diff --check 干净：**PASS**（Maven 104/85、harness 239 OK、openapi validate+diff PASS、precheck 5 commands PASS、diff--check 干净，实跑）
- AC6 未获批外发被拒、SafetyGate 非 adequate 不外发、Quota 超限/NO_CAPACITY 失败关闭：**PASS**（单测可复测）

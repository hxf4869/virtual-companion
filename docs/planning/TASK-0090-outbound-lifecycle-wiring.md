# TASK-0090 设计文档 — 真实外发路径接入生成生命周期

> 状态：**设计草案（待 Owner 审阅）**｜类型：延续单卡（独立交付，TASK-0080–0088 先例）｜建议执行序：第 1 张（后端核心闭环，供 TASK-0092 消费）
> 依据：TASK-0036 handoff remaining[0]（"上游 streaming/finalization 接线：LiveModelInvoker 尚无生产调用入口"）+ TASK-0032 handoff remaining（终态映射）+ TASK-0035 handoff remaining（审计链落库）

## 1. 目标

把 TASK-0035 交付的 `LiveModelInvoker`（当前**无生产调用入口**，仅 Spring bean + 单测）接入真实生成生命周期，使 **收到消息 → receive_generation → 状态推进 → 路由/双授权/安全/配额 → 真实外发 → 终态落库 → 结算 → SSE 推送** 成为可运行的端到端闭环。这是让 Technical Alpha 已验收能力（TASK-0032/0035）可运行的关键闭环。

## 2. 范围内

- **runtime send-generation 生产入口**：controller/service 接收 OpenAPI `POST /api/v1/conversations/{conversationId}/generations`（`sendGeneration` 契约已有、无实现）→ 调 `receive_generation`（V6 幂等，建 generation status=CREATED + user message）。
- **状态推进**：把 generation 从 CREATED 推进到可外发状态（IN_PROGRESS/WAITING_FOR_CAPACITY/FINAL_REVIEW），遵守 catalog transitions（无 generic transition 函数，需新建或复用）。
- **组装 `LiveInvocationRequest`**：读 vc.message 组装 ProtocolMessage、构造 Entitlement/ClassifierReport/授权快照 ids/fence；**`OwnershipTuple`（String）↔ DB（bigint）映射**（TASK-0035 测绘确认所有 id 字段 DB 侧是 bigint）。
- **`LiveAttemptOutcome` → `GenerationState` 终态映射**（TASK-0032 handoff 建议，需落码）：
  - SUCCEEDED → COMPLETED（走 finalize 原子结算）
  - ZERO_LLM_COMPLETED → COMPLETED_FALLBACK
  - FAILED / TIMED_OUT / NO_ELIGIBLE_DEPLOYMENT → FAILED_FINAL
  - BLOCKED_BY_SAFETY → OUTPUT_BLOCKED
  - CANCELLED / BLOCKED_BY_AUTHORIZATION → CANCELLED（遵守 catalog：非终态须经 CANCEL_REQUESTED 双跳）
- **新建 `provider_attempt` 表**（测绘确认 **V1–V14 中不存在**）+ SECURITY DEFINER 落库函数：把 `ProviderAttemptAudit`（providerAttemptId/ownership/providerId/supplierName/status，无凭据/内容）持久化；这是 TASK-0035 审计链的落库侧。
- **usage 落库**：成功路径 TokenUsage → `generation_usage`（V7）；失败/降级路径如实记录（无 usage 不伪造）。
- **quota 结算**：失败/降级路径 GenerationRecovery 释放 → `quota_ledger_entry` RELEASE 行；成功路径保留 reservation → finalize 原子 SETTLE（INV-COST-001/TASK-0018 契约）。
- **realtime_event 落库 + SSE 推送**：消费 `realtimeEventType()` 映射（chat.completed/cancelled/blocked/failed），delta 用 V8 `append_realtime_event`/`advance_realtime_seq`（终态 generation 拒绝 append，故终态须走 finalize/专用函数）；**realtime HTTP 端点**：POST `/api/v1/realtime/tickets`（V8 `issue_realtime_ticket` 已有）+ GET resume SSE（V8 `resume_stream` 已有）——供 TASK-0092 消费。
- **测试**：outcome→终态映射全枚举、审计/用量/实时事件落库（含故障注入回滚）、配额 RELEASE/SETTLE、ticket 签发/消费、SSE resume 契约。

## 3. 范围外

- 不改 `DeterministicRouter` / `ExecutionAuthorizationGuard` / `SafetyGate` 核心语义（TASK-0035 边界）。
- 不改 frontend（TASK-0092 负责 H5 采纳）。
- Beta、公开注册、真实支付与 Technical Alpha 之外能力。
- 不改 provider_deployment 持久化（TASK-0091 负责）。

## 4. 技术现状与缺口（测绘事实，2026-08-08）

| # | 环节 | 现状 | 缺口 |
|---|---|---|---|
| 1 | send-generation 调用方 | OpenAPI 契约有，runtime **无 controller/service** | 新建 |
| 2 | receive_generation | V6 `vc.receive_generation`（幂等建 generation status=CREATED + user message）+ `GenerationReceiveService`（**非 bean，无调用方**） | 接线为 bean + 调用 |
| 3 | 状态推进 | **无 generic transition 函数**（catalog：CREATED→INPUT_REVIEW→…→FINAL_REVIEW；无 SQL 入口） | 新建 transition 函数/服务 |
| 4 | LiveInvocationRequest 组装 | 缺（需读 vc.message 组 ProtocolMessage + OwnershipTuple String↔bigint 映射） | 新建 |
| 5 | DeterministicRouter | 已有 bean（ApprovedModelProviderConfig，master switch 默认关） | 复用 |
| 6 | ExecutionAuthorizationGuard + 授权快照 | 已有 bean + invoker 内 INV-AUTH-001 交叉校验 | 复用 |
| 7 | SafetyGate | 已有静态 `SafetyGate.evaluate` | 复用 |
| 8 | LiveModelInvoker.invoke | 已有 bean + 15 单测，**无生产调用** | 接线调用 |
| 9 | outcome→GenerationState 终态 | **映射仅在 TASK-0032 handoff 文本**（无代码）；LiveAttemptTerminal 8 值 vs GenerationState 6 终态 | 新建映射 |
| 10 | provider_attempt 落库 | **表不存在**（V1–V14 无；最近似 V2 `vc.generation_attempt` 也无人写） | 新建表+函数 |
| 11 | usage → generation_usage | 成功路径 finalize 原子写（V7）；失败/降级无写入口 | 失败路径处置 |
| 12 | quota_ledger_entry | QuotaLedger in-memory（TASK-0032）；finalize 写 SETTLE；失败路径 recovery 只释放内存**不落 RELEASE 行** | 落 RELEASE 行 |
| 13 | realtime_event + SSE | V7/V8 表+函数已有（仅 vc_api）；Java **无写入/消费**；SSE 输出层无 | 落库 + HTTP 端点 |
| 14 | generation_candidate（finalize 前置） | **无 INSERT 函数/代码**（finalize 需 p_final_candidate_id 已存在） | 新建候选落库 |
| 15 | finalize 成功结算 | V7 `finalize_generation`（前置 FINAL_REVIEW + candidate 存在）原子写 assistant msg/usage/SETTLE/chat.completed/outbox | caller 接线 |
| 16 | 降级终态/取消 | V10 `cancel_generation`（CANCELLED，不写 realtime/quota）；COMPLETED_FALLBACK/OUTPUT_BLOCKED/FAILED_FINAL 无 SQL transition | 新建终态函数 |
| 17 | SSE dispatcher | **无**（无 controller、无 dispatcher；V8 全齐仅 vc_api 可调） | 新建 HTTP 层 |

## 5. 依赖

TASK-0032（GenerationRecovery/QuotaLedger）、TASK-0035（LiveModelInvoker/审计链/ApprovedModelProviderConfig）、TASK-0018（finalize/usage/quota/outbox）、TASK-0021（V8 realtime）、TASK-0025（cancel/消息历史）、TASK-0084（ExecutionAuthorizationGuard）。

## 6. 验收标准（AC，每项可复测）

- AC1：send-generation 端到端——收到消息 → generation 建立（幂等）→ 真实外发（enabled 部署）→ 终态落库 → 可读回。
- AC2：`LiveAttemptOutcome` 8 个终态全部映射到合法 `GenerationState`（全枚举测试，含降级/取消/安全 block/授权 block/超时/配额 NO_CAPACITY），映射遵守 catalog transitions（CANCELLED 双跳）。
- AC3：真实外发产出 `provider_attempt` 行（audits 非空时），`usage` 行，realtime_event 终态行；**降级/blocked 路径不伪造 provider_attempt/chat.completed**（INV-GEN-003）。
- AC4：失败/降级路径 quota RELEASE 落 `quota_ledger_entry`；成功路径保留 reservation 由 finalize 原子 SETTLE（INV-TX-001/INV-COST-001）。
- AC5：realtime HTTP 端点可测——POST tickets 签发（TTL 45s/single-use/boundTo 七元组校验）、GET resume SSE 返回 disposition/events/snapshot；授权要求 Bearer。
- AC6：验证全绿——RLS 新增测试 + Maven 全模块 + openapi validate/diff + harness unittest + precheck PASS；`git diff --check` 干净。

## 7. 受保护面 / skill / 审批 / 复核

- `**/db/migration/**`（**database-migration C4 + humanApproval**）：新建 provider_attempt 表 + transition/终态/审计函数 + 授权。
- `service/**/modelruntime/**`（**model-routing-change C3 independentReview**）：若改 GenerationRecovery/LiveAttemptOutcome 等。
- runtime + persistence JDBC（unprotected）。
- **复杂度评估（intake 前）**：GOVERNANCE/AUTHORIZATION/HISTORY 面——database-migration（AUTHORIZATION 类）+ model-routing-change（AUTHORIZATION 类）同面计数需按 doctor.py 实际判定；**若 distinctCrossRiskSurfaces ≥ 2 或 estimatedWallMinutes > 90 可能触发 split**，intake 时以 `.harness/task-delivery-policy.yaml` complexityGate 判定为准。本卡体量较大，建议 intake 评估是否拆成"运行时编排 + 持久化/审计落库"两半。

## 8. 必跑检查（requiredCommands 草案）

- `python scripts/harness/precheck.py --task TASK-0090`
- WSL docker Maven 全模块：`wsl.exe -d Ubuntu-24.04 -u root -- bash -c 'docker run --rm -v /mnt/g/ai/hxf/virtual-companion:/workspace -v vc-maven-cache:/root/.m2 -w /workspace maven:3.9-eclipse-temurin-25-alpine mvn -o -pl service/apps/runtime -am test'`
- WSL RLS：`wsl.exe -d Ubuntu-24.04 -u root -- bash -c 'cd /mnt/g/ai/hxf/virtual-companion && bash infra/db/run-rls-tests.sh'`
- `python scripts/dev/openapi_tool.py validate` + `diff --fail-on-drift`
- `python -m unittest discover -s scripts/harness/tests -p test_*.py`
- `git diff --check`

## 9. 风险与关键决策

- **candidate 落库缺失**：finalize 需 `generation_candidate` 已存在，但全仓无 INSERT 入口——本卡必须补候选落库（或改 finalize 契约，属 TASK-0018 契约变更需谨慎）。
- **provider_attempt 表新建**是 TASK-0035 审计链的落库前提，属 database-migration C4（humanApproval）。
- **quota 结算语义**：成功路径 reservation 交 finalize SETTLE（TASK-0035 knownRisk：finalize 必须结算否则额度悬置）；失败路径 RELEASE 落库。
- **realtime 终态**：append_realtime_event 拒绝终态 generation——终态 realtime_event 必须由 finalize/专用函数原子写（INV-TX-001），不能先 append 再转终态。
- **auth**：VC_AUTH_ENABLED=true 时所有端点需 Bearer（TASK-0034 security 配置），本卡端点须符合。

## 10. 后续依赖

TASK-0092（H5 采纳本卡 realtime/ticket 端点）；TASK-0091（provider_deployment 持久化）与本卡相互独立，可并行评估。

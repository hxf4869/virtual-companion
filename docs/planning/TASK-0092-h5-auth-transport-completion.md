# TASK-0092 设计文档 — H5 认证接线 + 运输完成

> 状态：**设计草案（待 Owner 审阅）**｜类型：延续单卡（独立交付，frontend only）｜建议执行序：第 3 张（依赖 TASK-0090 的 realtime/ticket HTTP 端点）
> 依据：TASK-0034 handoff remaining[0]（"既有 chat/memory/relationship H5 transports 未接入认证 transport，VC_AUTH_ENABLED=true 后 401"）+ TASK-0026 P2-1/P2-2（.vue 运输 ticket 流 / nextEpoch）+ TASK-0030 remaining（memory transport 未测 glue）

## 1. 目标

使 H5 chat/memory 页面在 `VC_AUTH_ENABLED=true` 下可用：既有页面 transport 无 Bearer 会 401，本卡将其接入 TASK-0034 的 `createAuthenticatedTransport`；同时关闭 TASK-0026 的 **P2-1**（单次 ticket 流）与 **P2-2**（nextEpoch 捕获）两项 .vue 运输契约缺口。

## 2. 范围内

- **memory.vue**：内联 fetch transport（`frontend/src/pages/memory/memory.vue`，无 Authorization/无 401 处理）替换为 `createAuthenticatedTransport`；其返回接口 `AuthTransport{request(method,path,body?)}` 与 `MemoryTransport` 结构相同 → `stores/memory.ts` 调用点零改动。401→`onUnauthorized`（既有 auth store 跳登录）。
- **chat.vue**：`createBrowserRealtimeDeps()`（`frontend/src/pages/chat/chat.vue`）的 `resume()`/`fetchSnapshot()` 接入认证 transport + Bearer；`generationId`/`initialEpoch` 保持既有注入。
- **P2-1（单次 ticket 流）**：`resume()` 先 POST `/api/v1/realtime/tickets`（TTL 45s、single-use、boundTo 七元组：ownerUserId/sessionId/generationId/origin/transport/streamEpoch/afterSeq）取一次性 ticket，再携带 ticket 建 Fetch-SSE（消费 TASK-0090 提供的端点）；ticket 仅内存持有、不入 localStorage、不出现在 query（`longLivedTokenInRealtimeQueryForbidden`）。
- **P2-2（nextEpoch）**：`readSseEvents()` 捕获 RESET_REQUIRED frame 的 `nextEpoch`，返回给 `realtime.ts` 使用真实权威 epoch；后端/DB 当前不产 nextEpoch 时如实记录 `epoch+1` 兜底（realtime-contract 无 nextEpoch 字段，属客户端模型预留挂载点）。
- **401 语义**：resume/snapshot 的 401 → `onUnauthorized`（而非伪装成 NOT_FOUND_OR_FORBIDDEN）；memory 请求 401 → `onUnauthorized`。
- **可测性**：transport 逻辑（ticket 签发→SSE、nextEpoch 捕获）按 transport 注入范式抽取到可测模块（`frontend/src/api/` 下），vitest 覆盖；既有 `realtime.spec.ts`/`chat.spec.ts`/`memory.spec.ts` 注入 vi.fn 假 deps，改造真实 .vue transport **不影响**它们。

## 3. 范围外

- **不改后端 HTTP 层**（realtime/ticket 端点由 TASK-0090 提供；本卡只消费既有/将交付的端点）。
- 不做路由级登录守卫（保留 TASK-0034 被动 onUnauthorized → redirectToLogin）。
- 不改 `domain/stream-reducer.ts` / `stores/chat.ts` 核心编排逻辑（除 nextEpoch 接线）。
- Beta、公开注册、真实支付。

## 4. 技术现状与缺口（测绘事实，2026-08-08）

| 项 | 现状 | 缺口 |
|---|---|---|
| transport 工厂 | `createAuthenticatedTransport(provider: AuthTokenProvider{getAccessToken,onUnauthorized}): AuthTransport{request(method,path,body?)}`（transport.ts:24-44）：恒加 Content-Type、token 存在加 Bearer、401→onUnauthorized、404/403 透传不披露；**无 refreshAccessToken/baseUrl** | 无（已就绪） |
| memory.vue | 内联 fetch transport（memory.vue:104-119）：无 Authorization、无 401 处理；接口与 AuthTransport 结构相同 | 替换为 createAuthenticatedTransport |
| chat.vue resume() | `createBrowserRealtimeDeps()`（chat.vue:119-161）：裸 GET `/api/v1/realtime/resume?generationId=&afterSeq=&streamEpoch=`，**无 Bearer、无 ticket**；401/404→NOT_FOUND_OR_FORBIDDEN；fetchSnapshot GET 无 token | Bearer + ticket 流 |
| readSseEvents | （chat.vue:67-117）只读 `payload.disposition`+`payload.events`，**丢弃 nextEpoch**；返回 `{disposition, events}` | 捕获 nextEpoch |
| realtime 契约 | POST `/api/v1/realtime/tickets`（TTL 45s/single-use/boundTo 七元组/hash-only）；resume SSE `Last-Event-ID`；5 disposition；snapshot GET `/api/v1/generations/{id}/snapshot`；h5Security：preferredSession HttpOnly cookie、`longLivedTokenInRealtimeQueryForbidden:true` | **HTTP 层无 controller**（TASK-0090 交付） |
| nextEpoch | `ResumeResult.nextEpoch?`（api/realtime.ts:30-36）可选；两处用 `nextEpoch ?? epoch+1`（:143/:169）兜底；**后端/DB 不产 nextEpoch**（resume_stream 无 out_next_epoch 列） | 客户端捕获 + 如实兜底 |
| 登录守卫 | **无**：main.ts/App.vue/pages.json 均无路由保护；仅被动 onUnauthorized→redirectToLogin（stores/auth.ts:154-157） | 保持（范围外） |
| 既有测试 | realtime.spec.ts 180 行（depsWith vi.fn 注入）、chat.spec.ts 107、memory.spec.ts（keyedTransport）——**全不触真实 fetch** | 改造 .vue 不影响 |

## 5. 依赖

TASK-0034（createAuthenticatedTransport/auth store/onUnauthorized）、TASK-0026（.vue transport/stream-reducer/chat store）、TASK-0030（memory store/api）、**TASK-0090**（realtime/ticket HTTP 端点）。

## 6. 验收标准（AC，每项可复测）

- AC1：`VC_AUTH_ENABLED=true` 下 chat/memory 请求携带 Bearer；401 → `onUnauthorized` 跳登录（不伪装、不崩溃、不披露存在性）。
- AC2：memory.vue 改用 `createAuthenticatedTransport`，stores/memory.ts 调用点零改动；vitest 覆盖 token 注入 + 401。
- AC3（P2-1）：resume() 先 POST tickets 取单次 ticket（TTL/single-use/boundTo 七元组）再建 SSE；ticket 不在 localStorage/query；测试验证 ticket 呈现顺序。
- AC4（P2-2）：readSseEvents 捕获 RESET_REQUIRED 的 nextEpoch 并传给 orchestration；后端不产时如实 `epoch+1` 兜底；测试验证两条路径。
- AC5：既有 vitest（93）+ vue-tsc 全绿，新增 transport 单测；`git diff --check` 干净。

## 7. 受保护面 / skill / 审批 / 复核

- frontend/** 非保护路径 → **无 protected skill surface**；humanApprovals scope=task-authorization（TASK-0026/0030 先例）；riskClass C4、policySurfaces [AUTHORIZATION]（消费 Bearer/NOT_FOUND_OR_FORBIDDEN/INV-RT-001）。
- 不触 specs/catalog/contracts、不触 service、不触 .harness。

## 8. 必跑检查（requiredCommands 草案）

- `python scripts/harness/precheck.py --task TASK-0092`
- `bash -c "cd frontend && npx vitest run"`
- `bash -c "cd frontend && npx vue-tsc --noEmit"`
- `python -m unittest discover -s scripts/harness/tests -p test_*.py`
- `git diff --check`

## 9. 风险与关键决策

- **后端端点可用性**：本卡依赖 TASK-0090 交付 POST tickets + resume SSE HTTP 端点；若 TASK-0090 未交付，本卡只能做"client 契约就绪 + 端点未实现时如实 N/A"（与 TASK-0026 当时的 P2-1 处置一致——不猜测契约）。**因此执行顺序必须先 TASK-0090。**
- **nextEpoch 契约缺口**：后端/DB 不产 nextEpoch（resume_stream 无 out_next_epoch 列）；客户端捕获能力就绪但真实值依赖后端后续补出，兜底 `epoch+1` 如实记录。
- **cookie vs Bearer**：realtime-contract h5Security 偏好 HttpOnly cookie，但 TASK-0034 用 Bearer + localStorage；本卡沿用 Bearer（既有 AuthTokenProvider），不做 cookie 迁移（范围外）。
- **未测 glue 变可测**：把 .vue 内联 transport 逻辑抽到可测模块，消除 TASK-0030 remaining 的"memory transport 未测 glue"。

## 10. 后续依赖

TASK-0090（后端 realtime/ticket 端点）是本卡前置；TASK-0091 无关。

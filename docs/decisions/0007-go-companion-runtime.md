# ADR-0007：Go 单二进制 Companion Runtime

- 状态：Accepted
- 日期：2026-08-30
- 决策范围：Owner-only 本地 Technical Alpha 及其后续单机并发验证的 **Go 目标运行时**
- 规范：`docs/planning/2026-08-30-go-companion-runtime-redesign.md`（implementation baseline）

## 背景

当前生产 runtime 是一个 Spring Boot 进程。Owner 已确认用 Go 重写常驻服务端，并按 Pi
Agent Core 的小核心、显式状态、上下文变换和事件流思想重构陪伴对话运行时，而不是把
约 9 万行 Java 逐类翻译。在本 ADR、Catalog、contract 和冲突测试合入前，ADR-0006
对 **当前 Java 行为** 仍有效；对应 Go 路径处于 BLOCKED。

本 ADR 是 Go v1 的决策记录。实施顺序、停止线和推荐单元以实施规范为准；API 范围以
`specs/catalog/go-v1-api-scope.yaml` 为机器真源。

## 决策

1. **单二进制**：最终常驻形态是一个 Go module、一个 `companiond`、一个实例。Caddy
   继续负责同源、TLS 和静态 H5。PostgreSQL 18 + pgvector 仍是数据真源。Flyway 只
   作为一次性短生命周期迁移任务，不属于最终常驻资源。
2. **认证**：Go cutover 使用单个同源 opaque HttpOnly session cookie（`vc_session`，
   Secure + SameSite=Lax），删除 JWT access 与 `/auth/refresh`。切换窗口让 Owner
   重新登录；不建立永久 JWT/opaque 双 issuer。只读 strangler 阶段 Go 可验证 Java
   已签发的 JWT，但不得签发 JWT，且该兼容代码必须有删除阶段。
3. **Companion Turn**：一个用户输入对应一次有界 Turn。Go v1 不是工具驱动 Agent
   loop，不允许模型自主调用业务工具、修改 canonical memory、创建提醒、修改角色/
   同意，或递归规划。
4. **单 provider**：Go v1 只装配一个已批准的 OpenAI-compatible Chat Completions
   adapter。`ANTHROPIC_MESSAGES` 为 DEFER；`OPENAI_RESPONSES` 仍只是 spike。FAKE /
   FAILURE / ZERO_LLM 仅用于离线与测试。
5. **Go baseline**：`go 1.26`，toolchain 固定到受支持的 1.26 最新补丁。
6. **当前 Java 继续服务**，直到 Phase 5 在同一维护窗口切换 auth/H5 transport、
   generation、provider、realtime 与数据权利 writer。禁止 Java/Go 业务双写和真实
   provider 双发。

### 对 ADR-0006 的逐条替代

以下条款在所述生效点替代 ADR-0006；其余 Owner-only、本机单实例、数据类别/consent、
MinIO/备份/删除防复活、无真实 Beta 等边界继续有效。

| 当前 Accepted 决策 | Go 目标替代 | 何时生效 |
|---|---|---|
| ADR-0006 §3.3：套餐/价格 UNKNOWN 时 Owner 可继续 | 真实计费但价格或保守 reservation ceiling 未配置时 fail-closed；不显示虚构成本 | Go generation cutover |
| ADR-0006 §3.4：连续 5 次失败持久熔断 | 普通 429/5xx/timeout 仅本请求有限处理；只有 safety leak、credential 明确失效或 Owner 操作可 durable disable | Go generation cutover |
| ADR-0006 §5.2–5.4：每轮远程 input/final classifier | Go v1 只用一份本地 `LocalSafetyPolicy` 做 input/rolling/final；remote classifier DEFER | 本 ADR 与 safety contract 已合入，且 Go safety/generation cutover |
| ADR-0006 §6.1：64D 确定性向量是默认召回 | Go production 不声称其为语义召回；先用显式 candidate + 关键词/来源/recency。Ollama 只可继续做隔离影子评测 | Go memory writer/recall cutover |

### 对其他 ADR 的有界替代

- ADR-0001：Go 目标 runtime 为 `companiond`，不再以 Java/Spring 为唯一常驻技术基线；
  Fetch-SSE 保留，但 Go v1 删除 ticket/gap/reset 持久事件恢复协议，改用 authenticated
  SSE + reconnect snapshot。WebSocket 仍关闭。
- ADR-0004：真实用户 Beta 仍要求成熟身份组件。Owner-only Go v1 允许项目自有
  opaque session；这不批准从零实现 OAuth/OIDC，也不批准公开注册。
- ADR-0005：同源反代、CSRF、Origin 白名单与禁止长期 token 入 localStorage 继续有效。

## API 与协议范围

- 每条当前 OpenAPI operation 的 KEEP / SIMPLIFY / DEFER / RETIRE 只记录在
  `specs/catalog/go-v1-api-scope.yaml`。
- KEEP 必须满足：§17.1 最小结果、当前 H5 生产 caller、明确安全/数据权利义务，或
  Owner 明确要求。不得因为 Java 已实现或旧测试存在就整组移植。
- DEFER/RETIRE 且仍有 H5 生产 caller 的 operation，必须在删除 OpenAPI 的同一
  slice 隐藏或删除对应入口。
- 未写入 OpenAPI 但 Java/H5 仍存在的邀请注册路径（`/api/v1/auth/admin/invites*`、
  `/api/v1/auth/invite-register`）按 RETIRE 处理，不补进 Go v1。
- 删除 endpoint 时不保留 `/v2`、410 stub 或伪成功兼容层。

## 执行后果

- 后续 Agent 先按当前 HEAD、已合入 Catalog/OpenAPI/contract 与本 ADR 做 fit-check。
- 契约未改前不得大规模写 Go handler；G0 之后的实现单元不得让代码静默偏离机器真源。
- Java 实现与断言在 cutover 前继续描述 Java 行为；它们不是 Go v1 必须逐条复现的清单。
- 未迁能力保持 DEFER/RETIRE，不预建空包、空接口或 feature-flag 框架。

## 明确不授权

本 ADR 不授权公开注册、真实用户 Beta、远端生产发布、真实支付、多实例、高可用、
工具 Agent loop、Pi/Node sidecar、Java/Go 双写，或在 Phase 0 资源门槛冻结前开始
大规模 Go handler。

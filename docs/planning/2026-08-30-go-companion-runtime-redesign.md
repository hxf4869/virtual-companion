# Virtual Companion：Pi-inspired Agent Runtime 与 Go 服务端重构实施规范

> 状态：implementation baseline（G0–G10 已合入；G11 已合入——Phase 5 同窗口
> maintenance/drain/cutover/rollback 演练 `ops/deploy/g11-switchover/run-drill.sh`，
> 17/17 PASS：Java serving→maintenance 503→drain→pg_dump 备份与恢复比对→
> Go full 负向闸门（lease 拒绝）→停 Java/lease 释放→Go 接管并 smoke→
> Caddy 切流→回滚（drain/停 Go/备份恢复/Java 重接 lease）；G1 Linux 资源
> 报告见 `docs/planning/g1-java-resource-baseline.md`，Owner Mac 门槛未冻结；
> G12 起为资源/容量验收与 Go-only dogfood）
> 日期：2026-08-30
> 适用阶段：Owner-only 本地 Technical Alpha 及其后续单机并发验证
> 实施目标：用 Go 重写并优化常驻服务端，以 Pi Agent Core 的小核心、显式状态、上下文变换和事件流思想重构陪伴对话运行时
> 明确排除：Stitch/UI 重设计、公开注册、真实用户 Beta、生产发布、支付、多实例、高可用和通用工具 Agent

## 0. 本文的用途、权威边界和阅读方式

本文是 Go 重构的**唯一目标设计与实施基线**，用于让后续 AI Agent 在没有当前会话上下文时也能正确拆分、实现和验收。它不是当前实现状态说明，也不自动把尚未修改的 Catalog、OpenAPI 或数据库契约变成已完成状态。

实施时按以下顺序判断事实：

1. 当前用户明确要求、仓库 `AGENTS.md` 和安全红线；
2. 已更新并合入的 Catalog、OpenAPI、contract、migration/RLS 与测试；
3. 本文描述的目标设计；
4. 当前 Java 代码只作为行为证据和数据兼容参考，不是必须逐类移植的目标；
5. `docs/source/v0.4/**`、旧路线图和历史任务材料只作背景，不构成 Go 实现清单。

当本文与当前机器真源冲突时，后续 Agent 必须先完成对应契约变更，再实现代码；不得让代码静默偏离机器真源，也不得因为旧 contract/test 仍存在就照搬已经决定退役的机制。

本文有意改变 ADR-0006 的少数 dogfood 决策，具体清单见 Phase 0。在替代 ADR、Catalog/contract 和测试尚未合入前，旧 ADR 对**当前 Java 行为**仍有效，对应 Go 路径处于 BLOCKED；实现 Agent 不得同时实现新旧两套，也不得仅凭本文绕过机器真源。

本文只允许通过真实验收条件扩大范围。以下理由都不足以新增包、接口、表、状态、队列、兼容层或恢复链：

- Java 里已经有；
- Pi 支持；
- 蓝图里提到；
- 以后也许会用；
- 看起来更完整；
- 为了让全部旧测试原样通过。

## 1. 决策摘要

### 1.1 这不是语言平移

本次工作不是把约 9 万行 Java 和 14 个 Maven 模块逐类翻译成 Go，而是同时完成三件事：

1. **重定产品运行范围**：只保留 Owner dogfood 核心旅程、真实数据权利和真实安全边界；未获批的 Beta、商业化、多 provider、外部值班能力不进入 Go v1。
2. **重做 Companion Runtime**：借鉴 Pi 的显式 state、context transform、event stream、abort 等原则，但不引入 Pi、Node sidecar 或通用自主 Agent。
3. **删除遗留复杂度**：退出平行 generation 状态机、重复授权快照、复杂 provider 路由、产品等级/试用/多份 quota、伪语义记忆链、复杂实时 ticket 和重复单实例门禁。

### 1.2 最终运行形态

目标部署只保留：

```text
H5
  │ same-origin HTTP / authenticated SSE
  ▼
Caddy
  ▼
companiond（一个 Go module、一个常驻二进制、一个实例）
  ├─ HTTP API / Auth
  ├─ Companion Turn Runtime
  ├─ Realtime Hub
  ├─ Background Jobs
  ├─ PostgreSQL access ─────────────→ PostgreSQL 18 + pgvector
  ├─ approved model egress ─────────→ 当前一个 OpenAI-compatible provider
  └─ approved export storage ───────→ MinIO
                                      （generation cutover 默认保留，
                                       只服务已批准的导出/备份契约）
```

短期内 Flyway 可以继续作为**一次性、短生命周期**迁移任务存在；它不属于最终常驻资源。Caddy 继续负责同源、TLS 和静态 H5。Go generation cutover 默认保持现有 MinIO/导出契约不变，避免同时改语言、数据权利和对象恢复；只有 Go-only 稳定后，Phase 0/资源复测证明 MinIO 是实质资源来源，并且先修订 ADR、备份与删除防复活验收，才允许在 Phase 6 用单独切片替换。不得只删除 reconciliation 而保留异步对象写入。

### 1.3 Go v1 的 Agent 产品语义

> 一个用户输入对应一个有界 Companion Turn。Turn 读取明确上下文，经过输入审核和外发授权后执行一次有界 provider stream；输出通过增量检查、最终审核和原子提交后，才成为正式助手消息。

Go v1 不是工具驱动 Agent loop。首版不允许模型自主：

- 调用业务工具；
- 修改 canonical memory；
- 创建提醒或通知；
- 修改角色、关系或同意状态；
- 递归规划、反思或自我纠错；
- 在一次 provider 请求中伪造“中途改 Prompt”。

## 2. 当前事实与重构动因

### 2.1 当前后端不是 14 个运行服务

根 POM 声明 14 个 Maven 模块，其中包含生产模块、provider adapter 和 4 个契约测试模块；只有 `service/apps/runtime` 有 `main()` 与 Spring Boot 打包插件。实际部署是一个 Spring Boot runtime，不是 14 个微服务。

因此 Go 端不得复制 14 个 module、六边形目录模板或微服务群。当前复杂度的真实表现是：

- 一个 runtime 装配全部生产模块；
- `AuthDataSourceConfig` 约 1,600 行并集中装配大量 Bean；
- `GenerationWorkItemHandler` 超过 1,000 行，混合路由、授权、成本、安全、流、重试、终结和指标；
- `LiveInvocationAssembler` 与 `LiveModelInvoker` 继续承担多种不同生命周期责任；
- 数据库已有 100 多个历史 migration、大量 RLS/函数和 SQL 测试。

### 2.2 当前不是完整 Agent loop

当前生产链路本质上是：

```text
GenerationController
  → durable intake / work item
  → GenerationWorkItemHandler
  → LiveInvocationAssembler
  → LiveModelInvoker
  → 单次 provider stream 到 EOS
  → final review / finalize
```

没有工具调用、观察结果、再次推理的循环。当前效果差不能简单归因于“没用 Pi”，至少还有以下直接原因：

1. 默认外发类别只有 `MESSAGE_TEXT`，组装好的用户 persona（`ACCOUNT_METADATA`）与 memory（`MEMORY_SNIPPET`）会在出站前删除；这是当前条款未知条件下的正确保守行为，但会直接削弱人格和连续感。
2. 当前 persona 仍是较薄的固定 skeleton，没有形成可验证的中文陪伴行为规范。
3. memory extraction 接近“截取最近用户消息作为候选”；确定性 64 维字符哈希 embedding 只适合验证生命周期，不代表中文语义召回。
4. Realtime 固定预留有限 delta 槽位，多订阅者共享队列会竞争消费而非真正 fan-out。
5. 部分失败会在过长的编排链中变成模糊重试、兼容状态或重复审计。

### 2.3 Java 资源问题尚未完整量化

已知事实：

- boot jar 约 56 MiB；
- 历史启动到 ready 约 4.8 秒；
- runtime 容器没有明确 CPU/内存限制，也没有可信的 idle RSS、峰值 RSS、heap、GC 和同负载 CPU 基线；
- 当前整套环境还包括 PostgreSQL、MinIO、Caddy，可能还包括 Ollama，必须分别测量。

一个已经确认、且与语言无关的资源/并发缺陷是：当前 owner 注入可能让整个请求处于数据库事务内，而 SSE live-tail 最长约 120 秒；Hikari 最大连接数只有 5。Go 绝对不能复制“长 HTTP 流持有数据库连接/事务”的边界。

### 2.4 当前产品范围与实现范围明显不匹配

机器真源当前仍是 Technical Alpha：一个 active companion、一个 real model endpoint、HTTP SSE、禁止公开注册/支付/语音/图片/WebSocket。Owner dogfood 决策进一步限定为：一个账号、一台 Mac、一个 runtime、本地使用、无真实 Beta 和外部值班。

但 OpenAPI 已有约 86 条 path，其中包含大量：

- 管理员账号与角色；
- service class、trial、product quota、provider plan；
- provider registry、路由与 reconciliation；
- Beta ops case、retention hold、年龄申诉运营；
- 紧急联系人；
- 多 generation candidate/version 选择；
- 外部告警与恢复机制。

“Java 已实现”不等于“Go 必须移植”。本规范后续给出默认 `KEEP / SIMPLIFY / DEFER / RETIRE` 决策。

## 3. 目标、质量属性与非目标

### 3.1 产品目标

Go v1 必须让唯一 Owner 完成以下连续旅程：

```text
登录
  → 查看/设置唯一 companion
  → 创建或继续 conversation
  → 发送消息
  → 看到安全、可取消、可恢复到最终快照的流式回复
  → 确认/拒绝/编辑/删除 memory
  → 管理 consent、session、数据导出与账号删除
```

核心价值仍是：

- 低压力倾听；
- 可信记忆；
- 用户始终能够退出、撤回、删除和理解哪些上下文真正被使用。

### 3.2 工程目标

- 一个 Go module、一个常驻二进制；
- 常驻内存、CPU、启动时间和镜像均显著优于调优后的 Java 对照；
- 单实例内部可以安全承载未来的有界并发 turn/SSE；
- provider 调用期间不持有数据库事务；
- 没有 Java/Go 业务双写和真实 provider 双调用；
- 数据库/RLS、加密数据、Owner 现有数据可继续使用；
- 删除不再有真实消费者的代码、API、表级写路径和后台任务；
- 新实现比当前更容易理解、测试和定位性能问题。

### 3.3 明确非目标

以下内容不进入本次 Go v1：

- Stitch 或前端视觉重设计；
- 除认证/SSE/API 契约适配、删除死入口和“记住这条”等必要行为外的 H5 布局、样式、组件库或设计系统改造；
- tool-call loop、planner、reflection、chain-of-thought 存储；
- 通用 `Tool` 接口或 Tool Registry；
- 多 Agent、Agent 编排、MCP、插件市场；
- 多 provider 动态路由、会话 affinity、服务等级降级平台；
- Redis、Kafka、NATS、Actor framework、通用 event sourcing；
- WebSocket；
- 多 runtime、多节点、高可用、leader election；
- 公开注册、真实支付、真实用户 Beta、远端生产发布；
- 为未来 Beta 预建 feature flag、运营角色或恢复框架；
- 重写历史 Flyway migration；
- 为保留旧 Java 测试而复制没有真实消费者的兼容 API。

多实例和工具调用都是未来**重新设计触发器**，不是当前扩展点。首版代码中不得先放空接口、空包或未使用字段。

## 4. 设计原则：借鉴 Pi，但不复制 Pi

Pi Agent Core 当前提供 stateful agent、`transformContext`、`convertToLlm`、事件流、abort、steering、follow-up 和工具执行。Go v1 只采纳其中对当前产品有真实价值的原则。

| Pi 原则 | Go v1 决策 | 不采纳的部分 |
|---|---|---|
| 小核心 | `companion` 只处理一次 turn 的显式状态、provider 事件、取消和 outcome | 不让核心依赖 DB、HTTP、auth、quota、UI |
| 显式 state | Turn/Attempt 有明确状态和唯一终态 | 不建立 class-per-state 或第二套持久状态机 |
| context transform | `ContextSeed → ContextPlan` 是纯、确定性变换 | 不建立动态 transform plugin registry |
| message conversion | ContextPlan 明确转换成 provider request | 不让 provider SDK 类型进入业务层 |
| event stream | Provider 输入与 Public SSE 输出两个边界显式映射 | 不建立内部事件总线、事件溯源或只有一个消费者的 `TurnEvent` 层 |
| abort | `context.Context` 取消 + durable cancel intent | 不把 SSE 断开等同于取消 generation |
| steering | 定义为“取消当前 turn，再创建新 turn” | 不声称已经发出的 provider 请求可被中途改写 |
| follow-up | 当前 turn 终态后的普通下一轮 | 无真实 UX 前不建立独立的“待发送 follow-up”队列；§19.5 已接受 generation 的有界容量等待不属于该机制 |
| session backend | PostgreSQL 是唯一生产真源；内存实现只用于测试 | provider session 不成为 conversation/memory 真源 |
| tools | 只有出现第一个获批的具体工具后另做设计 | 首版不创建 Tool port、permission registry 或 loop |

实现中应使用 `Companion Turn Runtime`、`TurnCoordinator` 等名称，避免把系统包装成具有未实现自主性的通用 Agent 平台。

## 5. 目标架构与依赖方向

### 5.1 逻辑架构

```text
HTTP API / Job Worker
         │
         ▼
TurnCoordinator
  ├─ load ContextSeed（短事务）
  ├─ ContextBuilder（纯函数）
  ├─ input safety
  ├─ authorization / egress / budget（短事务）
  ├─ reserve ModelAttempt intent（短事务）
  │
  ▼
Companion Core
  ├─ Provider.Stream（无 DB 事务）
  ├─ rolling delta safety
  ├─ bounded output accumulator
  ├─ accepted delta → RealtimeHub 具体回调
  └─ context cancellation
         │
         ├─ RealtimeHub → authenticated SSE
         ▼
attempt outcome（短事务）
  → final safety
  → atomic finalize/terminalize（短事务）
  → terminal snapshot
```

### 5.2 目录目标

目录是最终边界地图，不要求第一天创建全部空目录。只有对应阶段出现首个生产消费者时才创建包。

```text
backend/
├── go.mod
├── cmd/
│   └── companiond/
│       └── main.go             # 配置加载、显式 wiring、启动/关闭
├── internal/
│   ├── app/                    # composition root；不建 DI 容器
│   ├── httpapi/                # route、request/response、middleware
│   ├── auth/                   # opaque session、CSRF/Origin、reauth
│   ├── companion/              # 纯 Turn/Attempt core、events、outcome
│   ├── turn/                   # coordinator、context、policy orchestration
│   ├── provider/
│   │   └── openai/             # 当前唯一 OpenAI-compatible adapter
│   ├── realtime/               # fan-out hub、SSE、snapshot recovery
│   ├── safety/                 # 本地 input/rolling/final safety
│   ├── memory/                 # canonical lifecycle 与召回
│   ├── jobs/                   # 最小 durable job claim/dispatch
│   └── store/
│       └── postgres/           # pgx、RLS owner transaction、原子函数
└── contracttest/               # provider、crypto、DB/OpenAPI 集成测试
```

### 5.3 依赖规则

- `companion` 只依赖 Go 标准库。
- `turn` 可以依赖 `companion`，反向禁止。
- `provider/openai` 实现 `companion` 消费方定义的 provider port。
- `store/postgres` 实现 `turn`、`auth`、`memory` 消费方定义的最小接口。
- `httpapi` 不直接调用 provider 或拼 Prompt。
- `realtime` 不访问 provider；读取终态只能通过 store 的 snapshot 查询。
- provider、store、realtime 互不直接依赖。
- 接口定义在消费方；没有第二个真实生产实现时不建立全局 `ports` 包。
- 不创建公共 `pkg/`，除非出现第二个二进制消费者。
- 不使用 DI 框架、ORM、Viper、通用 workflow engine 或 reflection registry。
- 普通 SQL 使用 `pgx/v5` 参数化查询；历史 migration 继续由 Flyway 执行。

### 5.4 初始技术选择

- Go baseline：`go 1.26`，初始 toolchain 固定到受支持的 1.26 最新补丁；不要因为 Go 1.27 刚发布就把版本升级混入重构。
- HTTP/SSE：标准库 `net/http`。
- PostgreSQL：`pgx/v5` + `pgxpool`。
- 日志：标准库 `log/slog` JSON handler。
- 密码兼容：`golang.org/x/crypto/bcrypt`。
- Session token：`crypto/rand` 生成，数据库只存不可逆 token hash。
- Metrics：沿用 Prometheus 暴露模式，只引入必要 client；不同时引入 OpenTelemetry。
- 测试：标准 `testing`、`httptest`、现有 OrbStack/PostgreSQL 测试入口；不引入 mock framework。

任何新增生产依赖必须说明它替代了什么实际代码和为何标准库不足。没有明确收益时不加。

## 6. Turn、Attempt、命令与事件

### 6.1 概念边界

- **Conversation**：用户可见对话历史与模式。
- **Turn/Generation**：一个用户输入产生一个最终助手结果的 durable 生命周期。
- **ModelAttempt**：一次真实 provider HTTP 请求；重试必须创建新 Attempt。
- **ContextPlan**：一次 Attempt 真正准备外发的不可变消息计划。
- **Candidate**：进程内、尚未通过最终审核的完整输出；Go 目标不再需要通用持久 candidate set。
- **Final Message**：通过最终审核并和 generation 终态原子提交的助手消息。

### 6.2 内部状态

迁移兼容期继续映射现有 generation catalog，不同时改语言与 DB 状态。Go 代码内部使用更小的 phase 投影：

```text
ACCEPTED
  → PREPARING
  → CALLING
  → REVIEWING
  → COMMITTING
  → COMPLETED

任意允许阶段
  → BLOCKED | FAILED
  → CANCELLING → CANCELLED
```

内部 phase 不是第二份持久状态真源。Java runtime 下线并完成契约清理后，目标持久状态收敛为：

```text
QUEUED | RUNNING | COMPLETED | BLOCKED | FAILED | CANCELLED
```

审核、上下文准备和提交只是处理步骤，不必全部成为持久状态。

Attempt 目标状态：

```text
CREATED → SUCCEEDED
        ├→ FAILED
        ├→ TIMED_OUT
        ├→ CANCELLED
        └→ OUTCOME_UNKNOWN
```

`CONNECTING`、`STREAMING` 和“本次失败是否允许再试”只是一次进程内调用的观测/决策，不写成 durable Attempt 状态。失败时先以 `failure_code` 终结当前 Attempt；只有 retry policy 明确允许时才创建下一个 `CREATED` Attempt，绝不把同一 Attempt 复活。`OUTCOME_UNKNOWN` 是终态，表示 durable outbound intent 已提交，但进程无法证明请求没有到达 provider；它绝不允许自动重放。Go v1 唯一的外部模型调用就是 chat generation，因此不为单一常量预建 `purpose` 列。远程安全 classifier 不在 Go v1 范围；若未来明确批准，必须在同一变更中给 `model_attempt` 增加 purpose、把既有行回填为 `CHAT_GENERATION`，并为 classifier 使用 `SAFETY_CLASSIFICATION`，不能另建平行 intent 表。

### 6.3 状态不变量

1. 同一个 idempotency key 只创建一个 Turn/Generation。
2. Attempt 恰好进入一个终态。
3. 一次 Attempt 对应至多一次 provider 请求。
4. Provider EOS 只结束 Attempt，不完成 Turn。
5. 不同 Attempt 的文本绝不拼接。
6. 一个 Turn 恰好零个或一个最终助手消息。
7. timeout/cancel 后的晚到 token 不得进入 hub、最终文本或数据库。
8. finalize 失败只重试持久化，不得重新调用 provider。
9. SSE 客户端断开不取消 Turn。
10. complete/cancel 竞争由数据库 CAS/fence 决定唯一终态。
11. 未通过最终审核的 candidate 不进入 conversation history，也不能成为 memory evidence。

### 6.4 首版命令

只定义真实消费者存在的命令：

```text
StartTurn
CancelTurn
```

`Steer` 由应用层实现为 `CancelTurn + StartTurn`；follow-up 就是下一个 `StartTurn`。首版不得创建 `SteerTurn`、`QueueFollowUp`、`ToolCall` 等无消费者命令。

### 6.5 两个事件边界

首版只有 provider 输入与客户端输出两个事件边界；coordinator 内部直接调用具体方法，不再定义只有一个消费者的中间事件协议。

**Provider stream callback** 只传递尚未终结的文本增量：

```text
OutputDelta
```

usage 与 finish reason 只由成功返回的 `AttemptResult` 承载；失败只由 typed `error` 承载。callback 不发送 terminal event，因而不存在“事件已终结但函数又返回另一终态”的双通道。

**Public SSE Event**，只表达客户端需要的状态：

```text
chat.accepted
chat.delta
chat.snapshot
chat.completed
chat.blocked
chat.failed
chat.cancelled
```

Attempt id、内部失败细节、路由过程和成本 reservation 不直接暴露给 H5。

映射规则固定写在 `TurnCoordinator`：intake commit 后调用 hub 的 accepted；rolling safety 接受 delta 后调用 append/fan-out；durable terminal commit 后调用 completed/blocked/failed/cancelled 并关闭 hub。测试直接验证这些具体调用与 Public SSE，不建立 `TurnEvent` interface、event registry 或 dispatcher。

## 7. 核心接口与一轮执行协议

### 7.1 最小接口

以下代码是接口形状，不要求机械复制命名；实现不得扩张为通用框架。

```go
type Provider interface {
    Stream(
        ctx context.Context,
        request ModelRequest,
        emit func(OutputDelta) error,
    ) (AttemptResult, error)
}

type TurnStore interface {
    LoadSeed(ctx context.Context, key TurnKey) (ContextSeed, error)
    PrepareAttempt(ctx context.Context, cmd PrepareAttempt) (PreparedAttempt, error)
    RecordAttemptOutcome(ctx context.Context, outcome AttemptOutcome) error
    FinalizeGeneration(ctx context.Context, cmd FinalizeGeneration) error
    TerminalizeGeneration(ctx context.Context, cmd TerminalizeGeneration) error
}
```

约束：

- 只有 provider I/O 与 durable store 两个真实外部边界使用接口；`ContextBuilder`、本地 `SafetyPolicy`、预算和 retry 都是具体类型/纯函数。
- coordinator 直接调用具体 `RealtimeHub` 的 accepted/append/terminal 方法，不为单个消费者增加 `TurnEvent`、`EventSink` 或 dispatcher。
- `Engine` 自身使用具体类型，不为每个 helper 建接口；测试优先传入数据、函数或边界 fake。
- Store 不提供绕过 finalize 的 `AppendAssistantMessage`。
- `RecordAttemptOutcome` 是 Attempt terminal status、failure、usage、billing disposition 与 reservation settle/release 的唯一 writer；`FinalizeGeneration`/`TerminalizeGeneration` 只能消费已经关闭的 Attempt，并且数据库权限/函数签名都不能让它们再次改 outcome、usage、billing 或 reservation。
- 内存 store 只用于单元测试。
- Credential 不出现在 `ModelRequest`；adapter 构造时从受控配置注入。
- context build 纯函数不访问 DB、网络、时钟或随机数，确保同样输入产生同样计划。
- `Provider.Stream` 返回 `error != nil` 时 `AttemptResult` 必须为零值，failure/delivery certainty 只从 typed error 分类；返回 `error == nil` 时 `AttemptResult` 必须包含唯一 terminal finish 与可用 usage。不得同时返回非零 result 和 error。

### 7.2 一轮执行顺序

```text
1. durable intake
   - 验证 owner、conversation、idempotency
   - 写 user message 与 generation/job

2. claim job（短事务）
   - 校验 lock token / fence / owner

3. LoadSeed（短事务）
   - 当前消息、persona、summary、最近历史、canonical memory、consent/config version

4. 输入安全审核
   - 执行唯一 LocalSafetyPolicy 的 input review，不发生网络调用

5. Build ContextPlan（纯函数）

6. PrepareAttempt（短事务）
   - 重验 generation/job/cancel
   - 重读当前 consent 与 provider enabled 状态
   - 计算真正允许的 data categories
   - 检查 token/cost/concurrency budget
   - 写 model_attempt intent
   - commit

7. Provider.Stream（无 DB transaction）
   - 有界 response decode
   - rolling delta safety
   - 通过的 delta fan-out
   - 单份有界最终文本 accumulator

8. RecordAttemptOutcome（短事务）
   - 原子写 attempt terminal status、normalized failure、usage 与 billing disposition
   - 按 disposition 在同一事务 settle/release 该 Attempt reservation
   - 不写 candidate 正文

9. 最终完整输出审核
   - Go v1 只执行本地审核，不发生网络调用

10. FinalizeGeneration/TerminalizeGeneration（单事务）
    - final assistant message
    - generation terminal state
    - safety result
    - 引用已经关闭 reservation 的 attempt outcome/usage/version（无正文）

11. 发布终态并关闭 active hub
```

进程在步骤 6 前崩溃可以安全重新 claim；步骤 6 后出现 outbound 是否到达 provider 的不确定性时，不得静默重放同一 Attempt。

远程 input/final classifier 是明确的后续变更，不是“可选实现”。只有 Owner 批准其数据类别、endpoint、成本和故障语义后才可启用。每一次远程 input 或 final 审核都必须在外发前用短事务创建独立的 `purpose=SAFETY_CLASSIFICATION` `model_attempt`，重新检查当时有效的授权、允许外发类别和成本，提交 intent 后再调用，并独立记录 outcome；它不得借用 chat generation 的 intent。rolling delta 审核始终在本地有界窗口执行，禁止逐 chunk 远程调用。

## 8. Context、Prompt、Persona 与陪伴质量

### 8.1 ContextSeed

`ContextSeed` 只包含本轮可能使用的事实，不把数据库实体直接透传给 provider：

```text
owner / relationship / conversation / generation binding
current user message
conversation mode
static product persona policy version
user-configured persona preferences and version
latest valid conversation summary
recent messages
eligible canonical memories
incognito / no-memory flags
current consent and provider contract state
prompt/config version
```

### 8.2 ContextBlock

每个 block 至少有：

```text
kind
role
content
dataCategory
priority
sourceKind
sourceId（仅内部，不外发）
version
required / optional
```

禁止为每个 block 计算无消费者的 hash/fingerprint。只有现有候选完整性或协议明确需要时保留摘要。

### 8.3 固定变换顺序

首版 transform 是固定代码顺序，不是动态插件：

1. 归一化当前用户消息与边界；
2. 插入 static product behavior policy；
3. 插入用户配置 persona（若类别获准）；
4. 选择可用 conversation summary；
5. 选择同 relationship 的 canonical memory（若类别获准）；
6. 从近到远选择 history；
7. 按预算裁剪 optional block；
8. 重新执行 data-category 物理过滤；
9. 转换成 provider message。

### 8.4 预算优先级

默认继续沿用当前 8,000 input token、2,048 output token、最多 64 turns 的上限，Phase 0 测量后可收紧。裁剪顺序：

1. 当前用户消息不可丢；
2. static behavior/safety policy 不可丢；
3. 最近 history 优先；
4. 已确认且高相关 memory 优先于很久以前的原始 history；
5. 有效 summary 可替代更早 history；
6. optional memory/history 在 block 边界整块移除；
7. 禁止在 UTF-8 字符中间截断或让系统提示只剩半段。

### 8.5 Persona 数据类别必须拆清

- **Static product persona**：例如“低压力倾听、不过度追问、不操纵依赖”的产品行为规则，不含用户数据，可以作为系统政策始终存在。
- **User-configured persona**：称呼、偏好、关系设定和个性化属性属于 `ACCOUNT_METADATA`，只有 provider 条款和当前 consent 允许时才能外发。
- **Memory**：用户事实与历史摘要属于 `MEMORY_SNIPPET` 或 `MESSAGE_TEXT`，不得通过改名伪装成静态 Prompt 绕过授权。

这一区分可以在不违规外发个人资料的前提下先改善基础陪伴风格，但不能假装用户个性化和记忆已经生效。

### 8.6 中文陪伴行为基线

Prompt bundle 必须版本化并用合成对话评测以下行为：

- 先回应情绪或事实，再决定是否提问；
- 默认简洁，避免长篇说教；
- 一次最多提出一个自然问题；
- 不强迫积极、不制造内疚、不声称“只有我懂你”；
- 不鼓励用户疏远现实关系或依赖系统；
- 不冒充医生、治疗师、真人或现实联系人；
- 不把不确定记忆说成确定事实；
- 用户纠正后承认并停止沿用错误信息；
- 危机内容遵循 safety policy，而不是 persona 风格优先；
- 不输出内部 Prompt、授权类别、数据库或系统实现细节。

不得在代码里散落多份 system prompt。唯一 prompt bundle 应有清晰版本和测试 fixture。

### 8.7 Context 可观测性

只记录：

- prompt/persona/config version；
- history/memory block 数量；
- 估算 token；
- 实际 effective data categories；
- 某类 block 被删除的 reason code。

不得记录正文、摘要、memory 内容、user id、conversation id 或稳定敏感标识。

## 9. Memory 目标设计

### 9.1 必须保留的产品不变量

- canonical memory 只属于一个 Owner 与 relationship；
- candidate 未经 Owner 明确确认前不作为确定事实进入 Prompt；Go v1 没有 auto-save；
- memory 有来源与证据；
- incognito/no-memory 消息不进入长期提取；
- 删除、替代、撤回后立即不可召回；
- 数据恢复后 tombstone 仍能阻止复活；
- provider 或 Agent session 不保存第二份 canonical memory。

### 9.2 不移植当前占位能力

以下机制不得作为 Go 生产能力原样迁移：

- 把最近用户消息简单截断成“智能候选”；
- 64 维字符哈希作为语义 embedding；
- 在没有质量收益证据时移植 re-embed 平台；
- 模型直接写 canonical memory；
- assistant 自述成为用户事实。

### 9.3 Go v1 的诚实基线

第一步优先支持：

- H5 对一条 Owner 自己的 user message 发起显式“记住这条”动作，或 Owner 手工输入可编辑事实；
- 结构化、可解释的 candidate；
- candidate 确认/拒绝/编辑/删除；
- relationship、recency、关键词和来源过滤；
- 当前有效、未删除的 canonical memory 召回。

真实 embedding 先在合成/明确脱敏样本上做影子评测。只有 Recall@3、误召回、无匹配拒绝、跨 relationship 隔离和删除防复活均有明确收益后，才替换占位向量。不要先建“多 embedding provider 平台”。

### 9.4 Go v1 不设自动 extraction job

显式记忆动作直接调用 memory candidate command，不经过 Companion loop，也不依赖聊天 finalize：

- 服务端验证 relationship/message ownership、incognito/no-memory 与删除状态；
- message 来源只作为可追溯 evidence，candidate 文本由 Owner 在 H5 中确认/编辑；
- 无 message 来源的手工事实标记为 `USER_DIRECT`，不能伪造模型推断来源；
- candidate create 使用 idempotency key，重复提交不产生多条；
- confirm 后才成为 canonical memory；reject/delete 后不可召回。

因此 Go v1 的 finalize 不创建 memory job，jobs 表也没有 `MEMORY_EXTRACTION`。未来若要自动或远程 extraction，必须先定义具体 extractor、输入/输出、质量阈值、数据类别/consent、成本和删除语义，再新增实现；本规范不预建其状态、purpose、接口或 adapter。

## 10. Provider、Retry、Budget 与成本

### 10.1 Provider 范围

Go v1 只实现当前真实使用的 OpenAI Chat Completions compatible adapter。Anthropic、Responses API 与 provider marketplace 均为 `DEFER`。

Fake/Failure 不再是生产 module，只作为 provider contract test fixture。

### 10.2 Provider adapter 的责任

负责：

- HTTP/SSE codec；
- connect、first-token、total timeout；
- `context.Context` cancel；
- redirect/endpoint/DNS 限制；
- response body、单 event、累计输出上限；
- Unicode、usage、finish reason 映射；
- 429、5xx、malformed event、early EOF 分类；
- terminal 后关闭输入并丢弃 late event。

不得：

- 读取数据库、persona 或 memory；
- 持久化 conversation/session；
- 记录 request/response 正文或 credential；
- 自行隐藏重试；
- 把 provider SDK 类型暴露到 `companion`；
- 把 provider session id 当成记忆或会话真源。

### 10.3 HTTP client 约束

- endpoint 只能来自仓库外私有配置；
- 只允许明确批准的 HTTPS scheme/host/port；
- 禁止自动跟随到未批准 host；
- credential 只加在批准 endpoint 的请求上；
- connect/first-token/total timeout 默认保持 10s/60s/240s，测量后再收紧；
- `maxResponseBytes` 默认 256 KiB，非法配置启动失败；
- 不使用 `io.ReadAll` 读取无上限响应；
- transport 连接池有明确 idle/timeouts，shutdown 时关闭 idle connections。

### 10.4 Retry 规则

Retry 只能由一个小的显式 policy 决定，每次重试创建新 Attempt：

| 失败 | 默认行为 |
|---|---|
| 配置、auth、consent、安全、成本、输入错误 | 不重试 |
| cancel | 不重试 |
| total timeout | 不自动重试 |
| outbound 是否到达 provider 不确定 | 标记 `OUTCOME_UNKNOWN`，不自动重放 |
| 明确未发送的 connect failure | 最多一次新 Attempt |
| 429 | 不自动重试；没有当前供应商不计费证据，按未知费用收敛 |
| 5xx/early EOF | 默认不自动重放，除非 provider 有可靠幂等语义 |
| finalize 持久化失败 | 只重试 finalize，禁止再次调用 provider |

“最多三次 Attempt”只是迁移兼容上限，不是必须用满的恢复链。实际数据支持前，Go v1 默认 `maxAttempts=2`。

### 10.5 Provider state

单 provider 只需要一份权威状态：

```text
ENABLED | DISABLED
reason
updatedAt
```

- 普通 429、5xx、超时、断连只按本次请求的有限 retry/退避规则处理，不累计成持久熔断状态；
- 明确 safety leak、credential 被撤销/判定无效或 Owner 主动操作时，才允许持久化 `DISABLED`；
- 启动配置缺失不写 durable state，runtime 直接 not-ready；
- 恢复由 Owner 明确操作；
- 不实现“连续 N 次失败自动禁用”、半开探测、route registry、affinity、failover、service-class 或 durable rollback 链。

### 10.6 TurnBudget

每轮在 intake/prepare 时冻结、并随 Attempt 审计的预算只有：

```text
maxInputTokens
maxOutputTokens
maxResponseBytes
connectTimeout
firstTokenTimeout
totalTimeout
maxAttempts
maxReservedCost
```

`maxConcurrentTurns`、`maxOutstandingTurns`、`queueTimeout`、`monthlyCostLimit` 和 realtime buffer 上限属于 runtime/admission 配置，不伪装成单轮预算。非法、负数、组合矛盾或超过硬上限的配置必须启动失败。provider 无权扩大任何预算。

### 10.7 成本

删除 synthetic unlimited quota、trial、ECONOMY/PREMIUM、entitlement snapshot、product quota reconciliation。Go v1 只保留：

- 实际 usage；
- 单请求 token 上限；
- 一个原子月度成本硬上限；
- 并发 reservation/settlement，防止并发超预算；
- 价格未知且 provider 真实计费时 fail-closed。

每个 Attempt outcome 必须持久化一个有实际决策消费者的 `billing_disposition`：

| disposition | 证据 | reservation 处理 | 可否自动新 Attempt |
|---|---|---|---|
| `NOT_SENT` | transport 能证明请求字节未离开进程 | release | 仅按 §10.4 有限 retry |
| `USAGE_REPORTED` | provider 返回可校验 usage 且价格已配置 | settle actual | 按失败类型决定 |
| `UNKNOWN` | 其余已外发/可能外发情况 | 按 reservation ceiling settle | 否 |

Go v1 只实现表中三个真实可达状态；不得从“没有 usage 字段”推断零费用。只有后续 ADR/contract 记录了具体 provider 响应及其权威不计费依据，才允许在同一变更中增加新的 disposition、DB constraint 和测试，本规范不预建。`billing_disposition`、usage、Attempt 终态与该 Attempt 的 reservation settlement/release 由同一个 `RecordAttemptOutcome` 事务写入；只有事务提交后才能决定 retry 或进入 final review。finalize 只引用已关闭的 reservation，不重新猜测或再次结算。

## 11. Safety、授权与失败语义

### 11.1 只保留有独立意义的安全层

```text
1. request/body 边界
2. 唯一 LocalSafetyPolicy 分别执行 input、rolling-window、final-full-output review
3. outbound 前当前 consent / category / endpoint / cost gate
4. DB/RLS/atomic finalize 作为独立信任边界
```

固定“已分类且无风险”的占位报告、同一层重复读取的快照和多份同义 guard 不移植。

Go v1 只有一份具体的本地确定性 `LocalSafetyPolicy`：从当前经测试的 `DeterministicSafetyClassifier` 规则做行为迁移，规则在启动时编译一次；input 扫输入，rolling 用同一规则扫新增内容和必要尾窗，final 用同一规则扫完整输出。不引入第二规则引擎、本地 ML/Ollama classifier 或不同的 input/final policy。远程 classifier 为 DEFER，不能由实现 Agent 因“接口已经预留”而自行启用；若未来启用，必须完整满足 §7.2 的独立 intent、当前授权、成本与 outcome 边界。

### 11.2 增量审核

不得只逐 chunk 独立匹配，因为风险短语可能跨 chunk。实现应：

- 维护一个有界 rolling tail/window；
- 新 delta 到来时只扫描新增内容和必要尾窗，避免每次重扫完整输出；
- 风险/审核失败后立即停止公开新 delta；
- 最终完整文本只再扫描一次；
- 未通过最终审核绝不产生 `chat.completed`。

流式 delta 在最终审核前只是可撤销的 UI 草稿，不是消息。rolling 或 final 审核失败、cancel 或普通失败时必须按以下顺序收敛：

1. 以当前 attempt fence 停止接收/公开晚到 delta，并取消 provider context；
2. 清空该 generation 在 hub 中的 active accumulator，再发布不带正文的 `chat.blocked`、`chat.cancelled` 或 `chat.failed` 终态；
3. H5 收到任一非 completed 终态后立即删除本地 assistant draft，不得把它复制为 message、重试输入或离线缓存；
4. 数据库只保存 generation/attempt 的终态与非敏感 reason code，不保存未审核 partial；
5. 之后的 snapshot/reconnect 只能返回 durable 非 completed 终态，绝不重新提供被清除的 partial。

客户端短暂看过草稿是流式体验的已知性质；安全保证是“检测后立即撤回、不能成为 durable history、不能重连复现”，而不是声称用户从未看见任何 delta。若产品要求展示前审核，必须改为非流式或引入经批准的缓冲策略，不能在本实现中暗中改变协议。

### 11.3 当前授权与不可变审计

目标不再保留 requested/execution 两份内容相同的授权快照。改为：

1. provider outbound 前读取**当前** consent、provider contract 和 allowed categories；
2. 未授权 optional block 物理删除；当前消息无权外发则 block；
3. 在 `model_attempt` 保存一份当时实际生效的 categories、consent version、provider contract version 和 decision code；
4. 审计记录不可变，但撤回 consent 不需要回写旧审计状态。

撤回后下一次 outbound 必须立即失败；缓存或旧审计不能覆盖当前 consent。

### 11.4 Fail-closed 与降级矩阵

“fail-closed”不能泛化成任何附属服务失败都阻断聊天：

| 失败领域 | 行为 |
|---|---|
| 身份、session、Owner/RLS 上下文 | fail-closed |
| 当前 consent/外发类别 | fail-closed |
| input/final safety | fail-closed 或确定性安全替代 |
| provider endpoint/credential/DNS | fail-closed |
| 成本硬上限 | fail-closed |
| semantic memory recall | 降级为无 memory，不伪造 |
| optional semantic recall/embedding | 降级为无 semantic memory；聊天继续，不生成伪候选 |
| conversation summary | 降级为有界最近 history |
| metrics/本地告警 | 记录失败，不阻断聊天 |
| 单个 SSE 慢消费者 | 断开/要求 snapshot，generation 继续 |
| realtime hub 丢失 | 客户端从 durable snapshot 恢复 |
| provider outbound 不确定 | Attempt 失败且不自动重放 |

## 12. Realtime/SSE 重设计

### 12.1 目标协议

Fetch-SSE 可以携带正常认证，因此 Go 目标删除单次七元组 ticket endpoint。SSE 使用同源 HttpOnly session cookie、Origin 校验和正常 owner authorization。

```text
GET /api/v1/realtime/streams/{generationId}
```

连接建立流程：

```text
验证 session（短查询）
  → 短 owner transaction 读取 generation/snapshot 权限
  → commit/release DB connection
  → 注册 RealtimeHub subscriber
  → 持续 HTTP stream，不持有 DB transaction
  → 终态时短查询 committed snapshot
```

### 12.2 Fan-out

- 一个 active generation 一个 hub entry；
- 每个 subscriber 有独立 bounded channel；
- broker 广播到每个 subscriber，不共享消费队列；
- 慢 subscriber 不得反压 provider 或无限占内存；
- channel 超限时直接断开该 subscriber；H5 按普通重连重新取得 snapshot；
- generation terminal 后按短 TTL 清理 hub；
- 最后一个客户端离开不取消 provider；
- idle conversation 不保留 goroutine/hub。

默认有界值先按以下实现并由 Phase 0 压测收紧，不得改成无上限：

- 单 public SSE event 最大 16 KiB；更大的 provider delta 按 UTF-8 边界拆分；
- 单 subscriber queue 同时受 128 events 与 128 KiB 双上限约束；
- 单 generation subscriber 默认最多 8；
- 超限只影响慢 subscriber，不丢弃或取消 generation。

Hub 只保留 Provider.Stream 已经需要的**一份**有界 final accumulator，不再复制 replay ring 或独立 partial cache。注册 subscriber 时在同一个 hub mutex 临界区内：先把由当前 accumulator 生成的 `chat.snapshot` 放入该 subscriber 空队列，再把 subscriber 加入 fan-out；之后的 delta 才可能入队，因此 snapshot 与后续 delta 顺序确定。H5 对 `chat.snapshot` 的语义是“替换当前 assistant draft”，对后续 `chat.delta` 才是追加。

Publisher 对每个已通过 rolling review 的 delta，也必须在**同一个 hub mutex** 内完成“append accumulator → 对当前 subscribers 做非阻塞 enqueue”；不得在锁外把 append 与 fan-out 拆开，否则新 subscriber 会重复或漏掉临界 delta。blocked/failed/cancelled 同样在该锁内完成“clear accumulator → enqueue terminal → 从 active map 摘除”的有序状态变更。mutex 只保护内存状态和 channel enqueue，绝不包住 socket 写、provider I/O 或数据库调用。

Go v1 不发送 SSE `id`，也不实现 epoch、sequence、`Last-Event-ID` 或逐 delta replay。active snapshot 可以包含截至当前已通过 rolling review 的 partial，但这不代表已通过最终完整审核。`chat.blocked`、`chat.failed` 或 `chat.cancelled` 发布前，hub 必须先清空 accumulator；这些终态之后的 snapshot 不含任何旧 partial。

### 12.3 恢复语义

Go v1 的重连只做 snapshot，不做逐 token 重放：

- active hub 存在时，新连接先收到当前 accumulator 的 `chat.snapshot`，再收到新 delta；
- hub 不存在或进程已重启时，只返回数据库 durable snapshot；未提交 partial 已丢失，不编造也不拼接；
- terminal 以数据库 generation snapshot/final message 为真源；
- crash 后未终态 generation 由 job/attempt recovery 明确失败或恢复。

旧 `realtime ticket / durable seq reservation / gap-expiry` 契约在客户端切换后正式更新并删除，不保留永久兼容层。

### 12.4 Realtime 并发验收

- 两个 tab 同时订阅同一 generation，收到相同顺序和内容；
- 一个 subscriber 人为变慢，不影响另一个和 provider；
- subscriber 退出后 goroutine/channel 被清理；
- 断线重连最终得到与数据库一致的完整 final message；
- final review 失败后，当前页面清除 assistant draft，重连也看不到任何旧 partial；
- SSE 持续期间 DB active transaction 为 0；
- 关闭全部 SSE 后连接池回到 idle 基线。

## 13. Auth 与 Owner 边界

### 13.1 目标认证模型

最终 Go runtime 使用一个同源 opaque session，而不是长期维护“短 JWT + refresh cookie + access snapshot”三层状态：

- 登录成功生成至少 256-bit 随机 session token；
- 浏览器只收到 `HttpOnly; Secure; SameSite=Lax` cookie；
- 数据库只保存 token hash、account、created/expiry/revoked 和 reauth 时间；
- session absolute TTL 默认 7 天；
- logout/revoke/password change/account disable 后下一请求失效；
- state-changing request 继续使用 double-submit CSRF 和精确 Origin；
- 高风险操作要求新鲜 reauth；
- 不把长期 token 放 localStorage、query 或日志。

这是 Technical Alpha 的有意破坏性简化。切换时同步更新 H5 transport，让 Owner 重新登录；不建立永久 JWT/opaque 双模兼容。

### 13.2 迁移兼容

在只读 strangler 阶段，Go 可暂时验证 Java 签发的现有 HS256 access token，但：

- Java 仍是唯一 login/refresh/logout writer；
- Go 不签发 JWT；
- 该兼容代码必须有删除阶段；
- auth 正式切换窗口让旧 session 失效并要求 Owner 重新登录；
- 切换后删除 `/auth/refresh` 和前端自动 refresh 链。

### 13.3 密码与 session

- 继续兼容现有 BCrypt hash；
- 不在 Go 迁移同时更换密码算法；
- unknown-account login 仍执行等价的 dummy BCrypt 比较，避免明显 timing oracle；
- 登录和 password/reauth 有请求体字节上限、单进程 source/account rate window 与并发上限；
- 当前单实例不保留第二套 DB 共享限流；真正多实例出现前再设计；
- rate-limit 内存 key 数有硬上限与 TTL，防止来源爆炸耗尽内存。

### 13.4 Owner/RLS transaction

认证 middleware 不得包裹整个 HTTP 请求事务。正确顺序：

1. 解析 session cookie；
2. 短查询验证 session/account；
3. 将 principal 放入 request context；
4. 每个 DB operation 自己打开短事务；
5. 在同一 connection/transaction 内设置现有 owner context 并执行查询；
6. handler 返回前提交/回滚。

迁移期保留现有 owner-binding HMAC、RLS、复合 ownership FK 和 least-privilege role。是否进一步简化 HMAC 必须另做 threat-model，不属于语言重构的顺手改动。

### 13.5 Auth API 目标

保留：

- login、logout；
- list/revoke/revoke-all sessions；
- password change；
- reauth；
- account deletion。

删除或不移植：

- refresh；
- public/invite registration；
- admin account create/disable/reset；
- service class、trial、quota admin；
- 当前 Owner-only 阶段没有消费者的多角色运营 API。

## 14. PostgreSQL、事务、Schema 与加密

### 14.1 数据 ownership

| 数据 | 唯一真源 |
|---|---|
| account/session/consent | PostgreSQL |
| relationship/conversation/message | PostgreSQL |
| generation/model attempt/final message | PostgreSQL |
| canonical memory/tombstone | PostgreSQL |
| job/lease/fence | PostgreSQL |
| provider enabled/disabled 与成本累计 | PostgreSQL |
| active cancel func、subscriber channel、partial output | Go 进程内 |
| provider session/cache | 无产品 ownership |
| H5 | 只拥有未提交输入与 UI 草稿 |

### 14.2 事务边界

必须保持：

```text
prepare/read tx
  → commit
  → external HTTP / SSE（无 tx）
  → attempt outcome tx
  → final review
  → finalize/terminalize tx
```

禁止：

- HTTP provider 调用跨 DB transaction；
- SSE 生命周期跨 DB transaction；
- 在 finalize 提交前发布 completed；
- 把 message、generation 和 attempt/cost 终态分成 best-effort 多次写；
- 因 finalize 失败重新调用模型。

### 14.3 SQL 使用原则

- 普通 CRUD：参数化 SQL + RLS +复合 FK/unique constraint；
- 跨表原子操作：保留或重写成一个明确 SQL function/transaction；
- intake、claim、attempt intent、finalize、account deletion 属于原子边界；
- Java 层预读后 SQL 再校验造成 TOCTOU 的路径，改为单个条件更新/`RETURNING`；
- 一个不变量只保留一个权威写路径；
- 已由 DB 约束保证的状态，不在三个 Go wrapper 重复检查；HTTP 输入合法性与 DB 最终约束可以各保留一层，因为信任边界不同。

### 14.4 Migration

- 历史 Flyway migration 永不修改或翻译；
- Go 共存期只做 additive migration；
- destructive cleanup 必须等 Java runtime 下线、Go-only 验证和备份恢复通过；
- 默认保留 Owner 现有数据，不允许为方便重构 reset 数据库；
- schema cleanup 通过新 migration 删除 obsolete table/function；
- migration 始终只有一个 writer。

### 14.5 加密兼容

Go 必须逐字节兼容当前 `RestFieldCipher`，不能按常见做法自行补字段。当前 `enc2` 写格式准确为：

```text
enc2:<keyId>:<positiveVersion>:<standard-padded-base64(payload)>
payload = iv || ciphertext || gcmTag
algorithm = AES-256-GCM
iv = 12 bytes / 96 bits，逐次随机
gcmTag = 16 bytes / 128 bits，由 cipher 输出附在 ciphertext 尾部
AAD = none
key material = standard Base64 解码后的恰好 32 bytes
```

Go 在迁移窗口内保留受支持的 `enc1`/旧明文双读边界，但它必须有明确退出条件：

- Java/Go golden vector 双向验证；
- 只使用标准、有 padding 的 Base64；不得换成 URL-safe/no-padding；
- 不得添加 AAD，也不得把 prefix/key id/version 当作 AAD，否则现有数据无法读取；
- Go 切换后只写当前 `enc2`；
- plaintext/legacy 读取只用于现有数据迁移，不成为永久写路径；
- key/credential 不进入日志、错误和测试 fixture。

Phase 0 必须按受保护列统计 `enc2`、`enc1`、旧明文和不可识别格式的**行数**，只记录数量与列名，绝不读取、输出或采样正文。Phase 6 在备份恢复已验证后，以受控批次把仍需保留的 `enc1`/旧明文重写为当前 `enc2`；每批按主键游标推进并可幂等重跑，不新建通用迁移框架。只有所有受保护列的 `enc1`、旧明文和不可识别格式均为 0，才删除 legacy reader、golden vector、配置和分支。旧 `enc2` key version 若仍在密钥轮换保留期内可继续读取；这不构成保留 `enc1`/明文 reader 的理由。

## 15. Generation 与持久模型收敛

### 15.1 迁移兼容期

当前数据库有两套相关持久结构：`attempt_intent` 是 provider outbound 前的 fence，`provider_attempt` 是 Java 的后置审计；两表没有可靠相关键，历史记录不能一一配对。本次不增加临时关联键，也不让 Go 双写两表：

- Phase 5 前用 additive migration 直接给 `attempt_intent` 补齐目标所需的 terminal status、normalized failure、effective categories/version、usage、`billing_disposition`、reserved/actual cost 与时间字段，并增加 Go 专用的 create/record SQL function；
- Java 仍运行时继续走原有两表和原函数；Go generation 此时硬禁，不写其中任何一表；
- 维护窗口停止 Java 后，Go 只把扩展后的 `attempt_intent` 当作一个 `ModelAttempt` 写入；`provider_attempt` 从该刻起是只读 Java-era 历史，runtime role 同时失去其 INSERT/UPDATE 与写函数权限；
- Go core、store 和统计均只看一个稳定 attempt id、一张 active 表和一条写路径；不得增加同步器、双写补偿、兼容 repository 或按时间/provider/status 猜配历史行。

在当前 status catalog 仍不支持 `OUTCOME_UNKNOWN` 的兼容窗口，Go store 将该逻辑终态保守映射为扩展后 `attempt_intent.ABANDONED_LATE`，同时把 job/generation 写为 `FAILED` 并保留 `PROVIDER_OUTCOME_UNKNOWN` reason；此映射绝不表示可重试。Phase 6 重命名后，`model_attempt` 直接使用 `OUTCOME_UNKNOWN`，并在迁移校验中把上述 Go-era 兼容记录转换回来。

### 15.2 Go-only 后的目标模型

保留：

- `message_generation`（或等价 generation 表）；
- 一张 `model_attempt`：同一行在 outbound 前插入 intent，outbound 后更新 outcome/usage/audit；它同时是 fence 和审计，不再分表；
- final assistant message；
- minimal jobs；
- monthly cost state；

`model_attempt` 只保存有当前验收消费者的字段：attempt/generation/job 绑定与序号、状态、provider/model、实际 effective categories、consent/provider-contract/prompt-config version、started/first-output/terminal 时间、normalized failure code、input/output tokens、billing disposition、reserved/actual cost。outbound intent 创建事务必须验证当前 job claim/fence，但不保存原始 credential、claim token 或正文。不另建泛化 audit metadata 表。

删除/合并候选：

- 把已扩展且由 Go 单写的 `attempt_intent` 原位提升/重命名为 `model_attempt`，删除 Java-era 函数/caller 以及 `provider_attempt` 的 runtime grant；不做两表 merge；
- `generation_route` 及 route-decision audit：单 provider 无路由消费者；
- 通用 `generation_candidate` set 与版本选择：首版只有一个最终结果；
- requested/execution 双授权快照：折入 attempt 审计；
- synthetic/product quota、entitlement/trial 账本；
- realtime ticket、durable delta seq 表；
- token-only/batch compatibility work-item API；
- 生产未引用的 conversation generation reducer/candidate classes。

未审核 output 默认不持久化；进程崩溃时该 Attempt 失败，不能用不安全 draft 恢复。只有证据证明“审核前持久 candidate”是必要用户能力时再设计。

Phase 6 的推荐物理迁移是：验证所有 Go-era `attempt_intent` 都具备目标终态/usage/billing 字段并且只有 Go writer 后，在短维护窗口将它原位重命名为 `model_attempt`，替换 catalog/函数名并撤销旧函数。`provider_attempt` 是无法可靠关联的 Java-era 历史，绝不回填或猜配：若已达到现行 retention cutoff，按既有删除策略清除并 drop；尚在保留期内才重命名为无 runtime grant、无 writer/function、仅由 retention purge 读取的 `legacy_provider_attempt_audit`，并在 migration/验收记录中写死最晚删除条件。它不是 active 真源，不得新增查询 API、兼容 view、同步任务或统计读取。完成 active cutover 后只能有一张可写 `model_attempt` 和一条权威写路径。

### 15.3 FinalizeGeneration/TerminalizeGeneration 目标

同一事务至少完成：

- generation 唯一终态；
- 只有 `COMPLETED` 才插入 final assistant message 并绑定 reference；`BLOCKED/FAILED/CANCELLED` 不插入 assistant draft；
- final safety decision（若已进入 final review）；
- 若已创建 `model_attempt`，它必须已经终态且 reservation 已关闭；这两个 generation 终结操作不再次结算，也不能改写 Attempt 的 status、failure、usage、billing disposition 或 reservation。

Go realtime 采用 snapshot 恢复后，不必为 UI 额外持久化 `chat.completed` outbox；如果进程在 commit 后、推送前崩溃，客户端以 generation snapshot 发现终态。对应 contract 必须先更新，不能代码先漂移。

## 16. Jobs、调度与恢复

### 16.1 最小 durable job

目标 jobs 表只需要：

```text
id
type
owner_id
resource_id
status
attempt
next_run_at
locked_until
lock_token
last_error_code
created_at / updated_at
```

payload 只放 opaque reference，不放 message body、memory 或 credential。

### 16.2 Claim 与 handler

- 单 worker loop 一次原子 claim 有限数量；
- handler 明确区分 `prepare → external/no-tx → finalize`；
- generation、export、retention/cleanup 可以共享最小 claim storage，但重试规则分别定义；
- stale lock token/fence 不能写终态；
- job lease 应大于该 handler 的硬 timeout + 小幅 finalize 余量；
- generation 默认通过一次足够长 lease 避免无意义 heartbeat；
- 真正超长 export 如需续租，只实现该 handler 的明确续租，不建通用 heartbeat framework。

#### 16.2.1 Generation 过期 claim 的唯一恢复协议

恢复扫描必须按 generation → job → 全部 attempts → reservations/monthly-cost 的固定顺序锁定相关行，并在**一个数据库事务**内收敛 durable 状态；应用层不得先读后分别更新：

1. generation 已经 terminal：以 generation/final-message 事实为准，幂等关闭残留 job；`COMPLETED` 必须已有原子提交的 final message，否则视为数据库不变量失败并停止自动修复；
2. generation 未 terminal，且从未提交任何 `model_attempt` intent：清除旧 claim/fence，job 可以回到 `PENDING`，因为尚无 provider 外发证据；
3. 只要已有任一 Attempt，job 就**绝不回到 `PENDING`、绝不创建新 Attempt**。选择最大 `attempt_no` 作为当前 Attempt，同时检查并关闭所有遗留 reservation；
4. 当前 Attempt 仍是唯一非终态 `CREATED`：写为 `OUTCOME_UNKNOWN`；兼容期按 §15.1 映射为物理 `ABANDONED_LATE`。其 billing disposition 固定为 `UNKNOWN`，按 reservation ceiling settle；
5. 当前 Attempt 已是 `SUCCEEDED`：保留其 Attempt 终态。由于未审核 candidate 只在内存且已经丢失，generation/job 写为 `FAILED/CANDIDATE_LOST_AFTER_ATTEMPT`，不写 assistant message、不重放 provider；
6. 当前 Attempt 已是 `FAILED/TIMED_OUT/CANCELLED/OUTCOME_UNKNOWN`：保留 Attempt 终态；除第 7 条的 durable user cancel 外，generation/job 写为 `FAILED` 与对应 normalized reason；crash recovery 不继续原本也许可用的 retry budget；
7. 若已有 durable cancel intent，则在 generation 尚未终态时由 cancel 优先，generation/job 写为 `CANCELLED`；非终态 Attempt 仍按第 4 条记 `OUTCOME_UNKNOWN`，不能把取消伪装成“provider 一定没收到”；
8. 对已 terminal Attempt，reservation 按其已持久化 disposition 幂等收敛：`NOT_SENT` release，`USAGE_REPORTED` settle actual，`UNKNOWN` 或缺失 disposition 按 ceiling settle。正常 `RecordAttemptOutcome` 已关闭的 reservation 只验证，不重复计费；
9. durable transaction 提交成功后再清空/终止对应 hub 状态；旧 lock token/fence 的 late callback 只能得到 no-op/conflict，不能改终态、usage、cost 或消息。

恢复函数必须幂等：重复扫描返回已收敛结果，不重复计费、不改变终态。该协议同时覆盖 intent commit 后尚未外发、provider stream 中途崩溃、`RecordAttemptOutcome` 提交后但 final review/finalize 前崩溃，以及 finalize commit 后 job 清理前崩溃。它有意牺牲 crash 后的自动 retry，换取不重复外发、不拼接未审核 candidate 和单一恢复路径；不用 heartbeat、分布式事务或 provider shadow call 去消除窗口。

### 16.3 唤醒与 CPU

Durable jobs 表是真源。为降低空闲轮询 CPU并避免固定 5 秒延迟，可使用 PostgreSQL `LISTEN/NOTIFY` 作为**唤醒提示**，同时保留低频恢复扫描：

- enqueue transaction commit 后 notify；
- worker 阻塞等待 notify 或 timer；
- notify 丢失不丢 job，恢复扫描最终领取；
- 不建立第二个消息队列。

若 Phase 0 实测普通自适应 polling 已满足 CPU/延迟目标，可以不引入 NOTIFY；必须用数据选择，不为技术完整性添加。

### 16.4 Retained jobs

Go v1 只保留真实旅程所需：

- generation；
- export/delete lifecycle；
- retention purge；
- session/expired export cleanup；
- 必要 backup/restore reconcile。

不默认移植：

- provider plan/entitlement/quota reconciliation；
- DAU/Beta service-window 运营统计；
- 外部 webhook/fallback alert dispatcher；
- placeholder re-embed；
- 跨实例 cancellation poller；
- 无真实值班接收人的 ops job。

### 16.5 迁移期 Generation Plane 排他

PostgreSQL **generation plane advisory lease 只用于 Java→Go 共存/回滚窗口**，防止两种 runtime 同时外发；它不是 Go-only 永久架构。迁移期只有以下两个显式模式：

迁移期允许且只允许两个显式运行模式：

```text
api-migration
  - 不获取 generation plane lease
  - 配置层硬禁 provider、generation、realtime hub、job claim、scheduler
  - 只服务被 Caddy 明确切给 Go 的少量只读 API slice；全部 command/write route 返回不可用

full
  - 必须获取 generation plane lease
  - 才允许 provider、generation、realtime 和 jobs
```

`api-migration` 是短期只读 strangler seam，Phase 6 必须删除，不能演化为永久 feature-profile 系统。当前 Java runtime 继续持有现有 singleton lock 时，Go `api-migration` 不尝试获取同一锁；所有 production writer 仍归 Java。Phase 5 停 Java 后，Go 才以 `full` 获取该锁并一次接管 writer。

不移植：

- 多层 profile/replica 自证；
- DataSource 每连接包装 gate；
- 独立 watchdog 与多份 fail-stop 状态。

迁移窗口内，full 模式 lease 丢失时 runtime 停止接收新 generation、进入 not-ready 并退出。Phase 6 在 Java rollback window 关闭后同时删除 `api-migration/full` 模式、advisory lease、专用连接与相关 config/test，Go-only 只剩普通启动模式。最终单实例由本地部署只配置一个 companiond/Caddy upstream 保证；job 自身的 row lease/fence 继续保证同一 job 不被重复终结，但本规范不声称支持两个 Go realtime 实例。真正出现多实例需求时重新设计，不能让一次性迁移锁永久占用连接。

## 17. API 范围与破坏性简化

当前没有外部真实用户或第三方客户端，兼容对象只有当前 H5 和 Owner 数据。因此允许在同一实现切片中原子更新 OpenAPI、H5 调用和后端，不创建 `/v2` 或永久 legacy adapter。

### 17.1 CORE OUTCOME：必须保留结果，不预判全部 endpoint

下表定义 Go v1 必须交付的用户/安全结果，不代表当前同领域的每条 Java operation 都是 KEEP：

| 领域 | 最小结果 |
|---|---|
| 基础 | version、liveness/readiness |
| Admission | 唯一 Owner 的模拟成年状态与必要 consent 可建立/查看 |
| Relationship | 创建、查看、修改、删除唯一 active companion；额外 list/activate/deactivate 只在 consumer matrix 有调用时保留 |
| Conversation/message | 创建/继续、列表/历史、结束与删除；rename、单消息删除、no-memory/wipe 按当前 H5 与数据权利证据选最小 operation |
| Generation | send、cancel、durable snapshot |
| Realtime | authenticated SSE fan-out/reconnect snapshot，无 ticket |
| Memory | Owner 显式 create candidate、confirm/reject/edit/delete、查看 canonical memory；无 auto-save |
| Consent/privacy | list/record/withdraw、incognito/no-memory，且 outbound 前使用当前状态 |
| Auth | login/logout、查看/撤销 session、password、reauth、account deletion |
| Data rights | export create/status/download，账号/对话/消息/角色数据删除 |

generation feedback、memory evidence 独立 endpoint、safety report list/get、survey 和任何管理视图都只是 `CANDIDATE KEEP`：只有 Phase 0 找到当前 H5 caller、明确安全/数据权利义务或 Owner 指令才保留。Safety report create 也必须先确认 H5 确有入口；不能因为 Java 已有就默认移植。

### 17.2 SIMPLIFY：保留用户结果，重做协议

| 当前能力 | Go 目标 |
|---|---|
| JWT access + refresh | 单 opaque HttpOnly session；删除 refresh |
| realtime ticket/gap/reset/seq | 正常 session SSE + bounded fan-out + reconnect snapshot |
| generation versions/select | 一个 Turn 一个最终结果；删除多版本选择 |
| conversation summary endpoint | summary 作为 context 内部能力；需要展示时并入 conversation response |
| provider registry/plan status | 单 provider enabled/disabled 与本地状态 |
| quota/entitlement/trial | usage + request limit + monthly cost hard cap |
| requested/execution snapshots | outbound 当前检查 + attempt 一份不可变审计 |
| work item batch/fence API | minimal job claim/lock token/fence |

### 17.3 DEFER：不进入 Go v1 装配

- memory import；
- reminder/proactive follow-up；
- usage-health heartbeat/reminder 后端；
- survey；
- Anthropic adapter；
- remote age provider/appeal operations；
- external alert delivery；
- semantic re-embed job；
- emergency contact；
- Beta operator console。

如果 H5 当前仍调用这些 API，同一切片必须删除/隐藏对应入口或给出明确重新分类理由，不能仅因前端存在就自动移植。

### 17.4 RETIRE：更新 OpenAPI、H5 和代码后删除

- `/auth/refresh`；
- `/realtime/tickets`；
- generation version/select；
- admin account create/disable/reset；
- admin service class/list；
- provider plan/registry/quota reconciliation；
- trial grant/status；
- Beta ops case/internal note；
- retention legal hold UI；
- Beta export/memory sampling/admin report/age appeal endpoints；
- emergency-contact 全组 endpoint；
- invite/public registration；
- 无真实消费者的外部 webhook 管理。

### 17.5 Phase 0 必须产出的 API consumer matrix

每条当前 operation 只记录四列：

```text
operationId | current H5 caller | Go decision | replacement/user impact
```

不建立评分表、任务卡或第二套状态系统。每个 operation 只有满足以下至少一项才能标为 KEEP：实现 §17.1 的最小结果、存在当前 H5 caller、对应明确安全/数据权利义务，或 Owner 明确要求。其余默认 DEFER/RETIRE；不得因为同领域出现在 §17.1、Java 已实现或旧测试存在就整组移植。

### 17.6 HTTP 与错误契约

- 保留当前统一 `ErrorEnvelope`：`code`、非敏感 `message`、可选结构化 `details`；
- foreign/absent resource 继续统一为 `NOT_FOUND_OR_FORBIDDEN`，不得泄漏存在性；
- `details` 不得放正文、id、token、credential、SQL 或 provider 原始响应；
- 429 必须带正确 `Retry-After`；
- request body 使用明确 byte limit，未知字段策略由 OpenAPI 统一；
- state-changing 成功响应和幂等重放必须保持同一语义；
- opaque session 切换时 OpenAPI security scheme 从 bearer JWT 改为 cookie session，并同步 H5；
- 删除 endpoint 时直接从 OpenAPI 和 H5 移除，不长期返回伪成功、空数据或 410 compatibility stub。

## 18. 遗留机制取舍矩阵

| 领域 | 现有机制 | 决策 | Go 替代 / 停止线 |
|---|---|---|---|
| Auth | JWT、refresh、session epoch、access snapshot | 简化 | opaque session；撤销后下一请求失效 |
| Auth rate | 进程 + DB 两套来源限流 | 简化 | 单实例有界内存滑窗；多实例前再设计 |
| Consent | requested/execution 两份快照，多次重读 | 简化 | outbound 当前检查 + attempt audit |
| Generation | DB runtime 外另有未接入 reducer/aggregate | 不移植 | DB-backed lifecycle 唯一真源 |
| Generation | route/attempt/candidate 多层描述单 provider | 简化 | generation + model_attempt + final message |
| Safety | 固定“已分类”占位报告 | 不移植 | 一次真实 input review + rolling/final output review |
| Realtime | ticket/epoch/durable seq/gap/reset，delta 却不持久 | 简化 | authenticated SSE + fan-out + snapshot |
| Realtime | subscriber 共享 queue | 删除 | 每 subscriber 独立 bounded channel |
| Memory | candidate/confirm/delete/tombstone | 保留 | 产品核心，不得弱化 |
| Memory | 截取消息 + 64D hash + placeholder reembed | 不移植 | 显式 candidate + 评测后真实 embedding |
| Provider | registry/admission/circuit/affinity/rollback 多层 | 简化 | 一个 adapter + 一份 durable enabled state |
| Cost | synthetic quota + product quota + trial + entitlement | 不移植 | usage + monthly hard cap |
| Jobs | owner enumeration/batch token/ThreadLocal/legacy API | 简化 | minimal jobs + per-handler policy |
| Singleton | replicas + preflight + advisory + datasource gate/watchdog | 迁移后删除 | Java/Go 共存期一个 advisory lease；Phase 6 与迁移模式一并删除 |
| Ops | durable webhook outbox/fallback/双重去重 | 不移植 | 本地日志/health/last-success；有接收人再设计 |
| Export | MinIO intent/reconcile/prefix audit | 条件保留 | 保留 MinIO 就必须保留竞态收敛；替换存储时整体重做 |
| Retention | 30 天、备份、tombstone、restore-before-read | 保留 | 直接保护删除防复活 |
| DB | RLS/FK/least privilege/delete intent | 保留 | 独立信任边界 |
| DB | 每个 CRUD 都是函数且应用重复预校验 | 简化 | 普通参数 SQL；原子跨表操作保留函数 |
| Migration | 重写历史 Flyway | 禁止 | 历史不变，新 migration 演进 |

## 19. 内存、CPU 与并发设计

### 19.1 Phase 0 基准方法

Java 与 Go 必须在同一 Mac、同一 PostgreSQL 数据量、同一 fake provider 行为、同一请求脚本下比较。真实 provider 只做功能 smoke，不用于 CPU/RSS 对比。

每次场景必须同时记录三个边界，不能只展示最有利的 Go 进程数字：

```text
A. runtime-only
   Java runtime 或 companiond

B. retained resident stack
   Caddy + runtime + PostgreSQL + MinIO

C. model provider
   Ollama 或其他本机 provider（若启用），单独列示
```

B 是用户为当前服务真实常驻承担的默认口径。Java/Go 对比时 Caddy、PostgreSQL、MinIO 使用同一版本、数据和资源配置；不得在 Go 样本中偷偷停掉 MinIO。若本次配置使用本机 Ollama，除了单列 C 外，还要附加 `B+C` 的端到端总量，但不把模型资源涨跌归因于语言重构。RSS/PSS、CPU time 与采样窗口必须一致，并记录容器/宿主口径，不能混用。

场景：

1. cold start 到 readiness；
2. ready 后 idle 10 分钟；
3. 3 路 idle SSE；
4. 1 generation + 1 SSE，fake provider 固定 delta/延迟；
5. 4 concurrent generation + 8 SSE；
6. cancel、reconnect、slow subscriber；
7. 100 连续 generation 后回到 idle；
8. worker 在 claim、provider stream、finalize 三个点异常退出；
9. login/session revoke 并发；
10. 16 generation + 64 SSE 仅做容量画像，不作为当前产品承诺。

记录：

- cold/readiness 时间；
- idle/peak RSS/PSS；
- 进程 CPU time 与 idle CPU；
- retained stack 的 idle/peak RSS/PSS 与总 CPU time，并逐组件列出 Caddy/PostgreSQL/MinIO；
- 本机 provider 的 idle/peak RSS/PSS 与 CPU（若存在，独立于 runtime/stack gate）；
- Java thread/heap/non-heap/GC；
- Go goroutine/heap/alloc/GC；
- DB active/idle connection 和最长 transaction；
- open fd；
- request app-overhead p50/p95；
- first delta（fake provider 已知延迟后扣除 provider 部分）；
- 错误率、queue wait、slow-subscriber disconnect；
- workload 结束后资源是否回落。

Java 只允许一次有界的公平基线调优：合理 container memory limit 与 JVM RAM 参数。不得把 Phase 0 变成新的 Java 架构优化项目。

### 19.2 Phase 0 冻结资源门槛的方法

在真实 Java 基线产生前，不用任意百分比假装精确门槛。Phase 0 对每个场景先 warm-up，再至少执行 3 次独立测量，把下表的数值直接补回本文并由 Owner 确认；在该表没有冻结前不得进入大规模 Go handler 实现。

2026-08-29 Linux 样本（方法与完整场景见 `docs/planning/g1-java-resource-baseline.md`）**不是** Owner Mac 数字，**不能**当作已冻结的 Go 硬上限或 Owner 绝对预算。复跑：`bash scripts/measure/g1-java-baseline/run.sh`。

| 指标 | 调优 Java 中位数 | Java 波动范围 | Go 硬上限 | 选择理由 |
|---|---:|---:|---:|---|
| runtime idle RSS/PSS | 372.5 / 369.3 MiB（Linux） | 371.5–373.0 / 368.4–370.0 MiB | Owner 冻结 | 必须明显降低常驻内存 |
| runtime `4 turn + 8 SSE` peak RSS/PSS | 409.2 / 406.0 MiB（Linux；4gen 窗口） | 采样窗口，见 G1 报告 | Owner 冻结 | 覆盖目标并发 |
| runtime 同 workload CPU time | 0.67 s（1gen+1sse，Linux） | 0.46–1.15 s | Owner 冻结 | 必须明显降低 CPU |
| cold start/readiness | 6.22 s（schema 已在，Linux） | 6.20–6.24 s | Owner 冻结 | 防止启动回归 |
| API app-overhead p95 | 19.17 ms p50；本轮 max 40.71 ms（intake，Linux） | 15.70–40.71 ms | Owner 冻结 | 不能用资源节省换明显延迟 |
| retained stack idle/peak RSS/PSS | idle 633.7 MiB RSS（Linux；MinIO 进程 RSS 本机 NOT_RUN） | 633.6–634.8 MiB | Owner 的 Mac 绝对预算 | 反映实际常驻成本 |
| retained stack workload CPU time | idle 窗 runtime 分量 4.71 s / 600 s（Linux） | 3.62–6.35 s | Owner 的 Mac 绝对预算 | 反映实际 CPU 成本 |
| runtime image size | 432.1 MiB（Linux JRE 镜像） | n/a | Owner 冻结 | 只作发布资源，不凌驾正确性 |

冻结值必须满足这些最低规则：

- runtime idle RSS/PSS 和代表 workload CPU time 都要低于调优 Java，且差值大于 Java 重复测量的自然波动；否则不能宣称语言重构解决了资源问题；
- fixed fake-provider API p95 不得出现超出基线波动的实质回归；
- retained stack 使用绝对预算，不要求 PostgreSQL/MinIO/Caddy 共同达到一个数学上可能不可达的比例；固定组件只要求逐项报告，若出现超出基线波动的回归再定位 Go 查询/连接行为，不顺手优化组件本身；
- idle 不得 busy-poll，SSE/provider 期间不得持有长 DB transaction；
- 100 turns 后进入相同 warm-idle 观察窗时，RSS/PSS、DB pool、goroutine 和 fd 必须回到 Phase 0 冻结的稳定波动带，不能持续单调增长；
- correctness、安全和完整核心旅程先通过，不能靠减少必要检查或停止 MinIO 得到资源数字。

门槛冻结后，只有 workload、测量口径或 Owner 的实际机器预算发生明确变化，才能经 Owner 决定修改；实现 Agent不能因未达标自行放宽。如果 Go 达不到已冻结的内存/CPU目标，先用 pprof/trace 定位，再决定修复或停止全量切换。

若 Phase 6 另行替换 MinIO，报告必须同时给出“Go runtime cutover（相同 MinIO）”与“storage replacement”两段增量，不能把后者的节省算成 Go 重写收益。

### 19.3 内存规则

- 不加载完整 conversation history；只取 summary + 有界 recent history；
- provider response、最终 accumulator、subscriber buffer 都有字节上限；
- 一份 candidate accumulator，不为每层复制完整文本；
- 不为 idle conversation/session 保留 goroutine；
- 每 subscriber 独立 buffer，但总 subscriber 数和单 generation 数有上限；
- 大导出不得整份读入内存；
- JSON/HTTP body 使用 limit reader；
- metrics label 不带高基数 id；
- 不做无证据的 sync.Pool 或 unsafe 优化，先看 pprof。

### 19.4 CPU 规则

- regex/词典在启动时编译一次；
- delta safety 扫描新增内容 + rolling tail，不每个 chunk 重扫全文；
- worker 使用阻塞等待、自适应 timer 或经测量批准的 LISTEN/NOTIFY；
- 不固定 250ms 全局轮询 owner/account；
- 不用 reflection DI、ORM 自动脏检查或运行时 classpath scanning；
- provider stream 采用阻塞 I/O，不主动 spin；
- 查询必须有真实 `EXPLAIN` 证据后才加索引，不能为理论访问模式建索引矩阵。

### 19.5 单实例并发

- intake 打开 owner-scoped 事务后，先 `SELECT` 当前 account/owner 行 `FOR UPDATE`；这张已存在的 owner 行是容量和同 Owner 幂等接收的唯一序列化点，不新增 capacity 表，也不依赖 READ COMMITTED 下不安全的“count 后 insert”；
- 取得行锁后必须重新查询 owner + idempotency key：已存在时返回同一个已记录的 `202 Accepted` envelope，不检查当前容量、不重复创建、不改成 429；
- key 不存在时，仍在同一锁/事务内统计 outstanding；低于上限才一次创建 user message、generation 与 generation job并返回 `202 Accepted`；`(owner_user_id,idempotency_key)` 唯一约束继续作为最后一层不变量；
- Owner-only 默认 `maxConcurrentTurns=1`、`maxOutstandingTurns=8`；指定 benchmark 可临时配置为 4/16 或 16/64，测试结束必须还原，产品默认不得被压测参数悄悄改写；
- outstanding 定义为本实例尚未 terminal 的 `QUEUED + RUNNING` generation；count 与 intake insert 必须都在上述 owner 行锁内，禁止在事务外先查后信任结果；
- `maxConcurrentTurns` 由显式 semaphore/有限 claim 控制，不靠 goroutine 数碰运气；已 durable 接受但暂未获得 slot 的 generation 按 `created_at,id` FIFO 等待；
- queue timeout 默认 5 分钟；超时且尚未 claim/创建 attempt 时，原子把 generation/job 写为 `FAILED/CAPACITY_TIMEOUT`，不调用 provider、不自动重排；
- claim 前收到 cancel 时，原子把 generation/job 写为 `CANCELLED`，不创建 attempt、不调用 provider；
- 当新 key 到达且 outstanding 已达到当前有效 `maxOutstandingTurns`（产品默认 8），事务不得创建 user message、generation 或 job，返回 `429` 和 `Retry-After: 2`；H5 保留用户输入并允许用户稍后显式重试；
- provider slot、export slot 与 DB pool 分开，不建立“一个全局 semaphore 管一切”；
- DB pool 初始最大 8，Phase 0 按等待/利用率调整；provider HTTP 期间不占 DB connection；
- 每个 active turn 有一个 root context，cancel/shutdown 向下传播；
- in-flight map 用简单 mutex，不预建 shard/actor；
- 单机容量不够时先测量瓶颈；只有多实例成为明确产品需求后才外置 realtime/cancel/provider state。

### 19.6 Graceful shutdown

```text
stop readiness / stop new turn admission
  → stop claiming new jobs
  → allow current safe phase drain
  → cancel provider contexts at deadline
  → terminalize or leave lease recoverable
  → close SSE；客户端按正常规则重连并取得 snapshot
  → close DB/HTTP idle resources
  → 若仍在迁移窗口则 release generation plane lease
```

同一个 generation 不在关机时转交给另一引擎继续拼接。

## 20. 分阶段迁移与每阶段停止条件

### Phase 0：机器真源、范围与性能基线

**目标**：决定要移植什么、验证为什么改 Go，并先修订目标契约。

交付：

- 本文状态改为 implementation baseline；
- 新 ADR：Go 单二进制、opaque session、Pi-inspired bounded turn、单 provider，并逐条声明下表中的 supersession；
- 更新 `product-scope.yaml` technology/protocol active scope；
- 同步更新 safety/provider/memory 相关 Catalog、contract 和旧断言测试；不得只写 ADR 让机器契约继续冲突；
- API consumer matrix 与 OpenAPI 删除清单；
- DB writer/job ownership matrix；
- 每个受保护列的 `enc2`/`enc1`/旧明文/不可识别格式计数基线（只记数量与列名，不采样正文）；
- Java runtime-only 与 `Caddy + Java + PostgreSQL + MinIO` retained-stack resource baseline；
- Go runtime-only、同 MinIO retained-stack resource gate；本机 Ollama 如存在则单列；
- 保留不变量的黑盒测试清单。

新 ADR 必须明确写出，而不是含糊地“参考” ADR-0006：

| 当前 Accepted 决策 | Go 目标替代 | 何时生效 |
|---|---|---|
| ADR-0006 §3.3：套餐/价格 UNKNOWN 时 Owner 可继续 | 真实计费但价格/保守 reservation ceiling 未配置时 fail-closed；不显示虚构成本 | Go generation cutover |
| ADR-0006 §3.4：连续 5 次失败持久熔断 | 普通 429/5xx/timeout 仅本请求有限处理；只有 safety leak、credential 明确失效或 Owner 操作可 durable disable | Go generation cutover |
| ADR-0006 §5.2–5.4：每轮远程 input/final classifier | Go v1 只用一份本地 `LocalSafetyPolicy` 做 input/rolling/final；remote classifier DEFER | 相关 safety contract/test 更新且 Go cutover |
| ADR-0006 §6.1：64D 确定性向量是默认召回 | Go production 不声称其为语义召回，先用显式 candidate + 关键词/来源/recency；Ollama 只可继续做隔离影子评测 | Go memory writer/recall cutover |

ADR-0006 的 Owner-only、本机单实例、数据类别/consent、MinIO/备份/删除防复活、无真实 Beta 等其余边界继续有效。G0 必须精确更新 `safety-fail-closed-contract.yaml`、受影响 provider disable/rollback 测试、memory contract/catalog 和 OpenAPI 描述；任一冲突未消除就停止进入对应实现单元。

停止：

- 无法重复测得 Java RSS/CPU/DB transaction 基线；
- Owner 数据保留策略不明确；
- Go 目标仍要求全部 86 path 等价实现；
- 在契约未改前开始大规模写 Go handler。

### Phase 1：Go 基础与离线契约

**目标**：建立可验证的最小运行骨架，不接真实流量。

交付：

- 单 `go.mod`、`companiond`、显式 config/wiring；
- health/readiness、structured logging、process metrics；
- pgx pool 与 owner-bound transaction；
- Java JWT verifier（仅迁移兼容）；
- BCrypt、owner HMAC、`enc1/enc2` golden vectors；
- OpenAI-compatible provider mock contract；
- fake/failure test fixture；
- shutdown 与仅迁移期使用的 generation plane lease。

验收：

- crypto/JWT/owner proof 与 Java 双向一致；
- RLS/cross-owner/least-privilege 测试通过；
- provider success/Unicode/usage/429/5xx/timeouts/malformed/cancel/late event 通过；
- 无网络、无真实 provider、无当前 DB 写入。

停止：任何一步需要 BYPASSRLS、明文迁移、复制 Java SDK 类型或新建通用框架。

迁移期间不部署 Java→Go 内部 RPC/provider sidecar。Go provider/core 先用离线 contract 与合成数据验证，生产只在 Phase 5 generation plane 整体切换时启用，避免临时桥接演变成永久架构和额外常驻进程。

### Phase 2：只读 Strangler 与短事务验证

**目标**：验证 Go auth verifier、RLS、错误语义和连接管理。

ownership：

- Java：全部 writer、token issuer、worker/provider/scheduler；
- Go：version/health 和少量明确只读路由；
- Flyway：唯一 schema writer。

建议顺序：

1. version/health；
2. conversation/message read；
3. relationship/memory read。

验收：

- Java/Go 对合成数据响应语义一致；
- missing/foreign owner 不泄漏存在性；
- 事务与连接在 response 前释放；
- Caddy path 可以一键回 Java；
- 不新增 schema、cookie 或 token 格式。

只读阶段应短，不得发展为永久 Java/Go 双 runtime 架构。

### Phase 3：Companion Core、Context 与质量离线验证

**目标**：在不双发真实 provider 的条件下完成新运行时。

交付：

- Turn/Attempt core、状态测试与 OutputDelta→Public SSE 映射测试；
- ContextSeed/ContextPlan 固定变换；
- static persona 与 user persona category 分离；
- input/rolling/final safety；
- provider adapter；
- Retry/Budget/Cost policy；
- RealtimeHub fan-out；
- 诚实 memory candidate/recall；
- synthetic Golden Conversation Set。

对比只允许：

- 合成/明确脱敏的 ContextSeed；
- fake provider 或录制的无敏感响应；
- request shape、category、裁剪、事件、outcome；
- 不向真实 provider 发第二次请求。

停止：persona/memory 条款未确认却试图绕过 category；为了 Pi 完整性加入 tools/steering queue/plugin。

### Phase 4：隔离 Writer 实现与完整切换演练

**目标**：把 relationship/conversation/memory/consent/data-rights 等 writer 按 G7/G8 小切片实现并验证，但不在当前生产数据库制造 Java/Go 写入交错。

生产 ownership 在本阶段保持不变：

- Java 是 auth、全部 command/writer、worker/provider/scheduler 的唯一 owner；
- Go `api-migration` 仍只承接 Phase 2 已验证的少量只读路由，provider、generation、realtime、job claim、scheduler 和全部写路由硬禁；
- Caddy 不把 POST/PUT/PATCH/DELETE 路由到 Go，也不为过渡新增 Java→Go RPC、双 auth issuer 或字段级双写。

实现与验证方式：

1. 按 relationship/conversation/message、memory、consent/report/data-rights 的领域切片完成 G7/G8；
2. 使用合成 PostgreSQL 或自动恢复出的**隔离副本**执行 OpenAPI、RLS、加密与生命周期测试；隔离副本不得连接 provider，AI Agent 不读取或输出真实正文；
3. 在隔离环境演练 consent 撤回与 outbound、delete intent 与 late writer、memory confirm/delete、export/delete object lifecycle 的竞争；
4. 使用待发布 H5/API contract 做离线 E2E，证明所有 command 在 Phase 5 可以作为一个路由单元启用；
5. 若任一能力只有借助生产双写、临时同步器或 Java→Go 内部调用才能验证，停止该方案并回到接口/数据边界，不得把 bridge 当作交付。

验收：G7/G8 的功能和破坏性竞争在隔离环境通过；当前生产流量仍只有 Java writer，Go 日志中写路由调用数为 0。所有 Go writer 与 opaque auth 一起留到 Phase 5 激活。

### Phase 5：Generation Plane 整体切换

**目标**：在同一维护窗口把 auth/H5 transport、generation、provider、realtime、cancel、export/delete lifecycle 和相关 jobs 交给 Go，避免新 opaque session 无法调用仍要求 Java Bearer JWT 的聊天接口。

这里的“同一窗口”只指**最终激活/路由切换**，不指同一个实现 slice：G3–G10 必须先分领域离线完成，G11 不再重写 auth/generation/realtime/schema，只执行 maintenance、drain、启动、路由、smoke 与回滚。之所以不利用临时 Java JWT verifier 把 generation 更早切走，是因为那还需要让 Java 进入新的“auth-only、禁全部 worker/provider/scheduler”生产 profile；为一次过渡新增该模式会扩大双 runtime 面。export/delete 与 retained jobs 也必须在同窗激活，因为 Java runtime 将整体停止，对象生命周期和删除防复活不能出现无人负责或双 writer。若未来机器真源证明 Java 已有可复用且可删除的安全 auth-only 模式，可另行缩小窗口；当前实现 Agent不得自行创建。

切换前必须完成：

- Go core/provider/safety/context/realtime 全部通过；
- target retained job handlers（generation、export/delete lifecycle、retention/session cleanup、必要 backup/restore reconcile）已由 Go 覆盖；
- Java 旧 `MEMORY_EXTRACT` job 在停机前已 drain 或按旧 contract 明确 terminalize，且 intake/finalize 已停止再产生；Go 不实现该 handler；
- opaque auth 与新版 H5 transport 已实现并完成离线/E2E 验证，但尚未对当前流量启用；
- §15.1 对 `attempt_intent` 的 additive 字段与 Go 专用函数已部署；Java 仍走原有两表路径，隔离 contract 已证明 Go 只写扩展后的 `attempt_intent`，且 outcome/usage/disposition/reservation 原子收敛；
- G7/G8 的全部 command/writer 已在隔离环境通过，但生产仍未路由到 Go；它们与 opaque auth、generation 和数据权利在本窗口一次激活，不能遗留无人负责的 Java writer；
- Go 已实现 lease/fence/finalize/late event 语义；
- 维护态、drain、回滚脚本人工演练通过。

切换顺序：

```text
generation admission → maintenance
  → 等待/取消 active invocation
  → 确认无 active claim 或等 lease 到期
  → 固定当前 H5/Java 回滚制品与数据库备份
  → 停 Java runtime
  → 确认 Java generation plane lease 释放
  → 启 Go companiond full 并获取 generation plane lease
  → 在 maintenance 入口后直连完成 DB privilege/schema/provider synthetic smoke
  → 在 maintenance 内把 Caddy API/SSE 切到 Go，并把 opaque-session H5 作为同一发布单元上线
  → Owner 强制刷新并重新登录；旧 Java session 作废
  → 通过正式 Caddy 入口完成核心 journey smoke
  → 恢复 admission
```

绝对禁止 Java/Go generation plane 同时 active。数据库 CAS 即使能阻止双 finalize，也阻止不了双 provider 外发、双费用、隐私重复处理和分裂 live delta。

### Phase 6：Go-only Legacy Cleanup

**目标**：确保本次不是“保留所有遗留的语言迁移”。

前置：

- Go-only 核心旅程稳定；
- 资源目标通过；
- 备份恢复通过；
- Java rollback window 结束；
- 所有待删表/函数查询消费者为零。

交付：

- 更新 generation/realtime/auth/finalization contracts；
- 新 migration 按 §15.2 将已扩展的 `attempt_intent` 原位提升/重命名为唯一 `model_attempt`，删除旧函数/caller，并按 retention 条件 drop 或限期归档只读 `provider_attempt`；同时合并/删除 route decision、candidate set、双 auth snapshot、realtime ticket/seq、trial/entitlement/product quota 等遗留；
- 以受控批次把仍需保留的 `enc1`/旧明文重写为当前 `enc2`；确认所有受保护列 legacy/unknown 格式计数为 0 后，删除 `enc1`/明文 reader、fixture、配置和测试分支；
- 删除 `api-migration/full` 模式、generation plane advisory lease、专用连接与相关配置/测试，只保留 Go-only 普通启动模式；
- 删除 Java runtime/module/POM/CI；
- Flyway 如仍保留，只作为迁移 job；
- 更新 README/TODO/architecture 为 Go 当前真相；
- 未迁能力明确标记 DEFER 或 RETIRE，不留“以后可能恢复”的死代码。

停止：仍需 Java 读取验证 Go 数据、仍有 hidden writer/scheduler、或者 destructive migration 无可验证备份。

## 21. 禁止双跑、允许并存与回滚

### 21.1 任一时刻只能一个 owner

- DB migration；
- login/session/logout/password/cookie 签发；
- 所有 command endpoint；
- generation intake/cancel；
- provider outbound 与 attempt/cost reservation；
- final message/finalize；
- job claim/lease/fence；
- realtime active hub；
- memory candidate/canonical/embedding write；
- account deletion；
- export object/file put/delete/seal；
- retention/purge/backup reconcile；
- runtime singleton membership。

### 21.2 允许短期并存

- read-only API；
- `api-migration` Go 验证 Java JWT，且 provider/jobs/realtime 被硬禁；
- 隔离合成 DB 的 contract comparison；
- fake provider/录制响应的 Context/Core shadow；
- Java Flyway migrator 与 Go runtime，但 migration 期间 Go 必须 readiness false/停止业务写。

### 21.3 回滚原则

- 回滚只影响新的 generation；
- 先停止新 admission/claim；
- drain 或终态化 Go in-flight；
- 停 Go 并释放 lease；
- 恢复配套的旧 H5 制品与 Java runtime，并完成 synthetic smoke；
- Owner 在 Java 登录页重新登录；不尝试把 opaque session 转换回 JWT/refresh；
- 同一 generation 不交给另一引擎继续；
- 共存期 schema 只 additive，回滚不需要 reverse migration；
- destructive cleanup 后不再承诺 Java runtime 回滚。

## 22. 测试、评测和日常检查

### 22.1 单元测试

- Turn/Attempt 合法状态与唯一终态；
- Context transform 顺序、预算和 category 过滤；
- persona/memory/history 裁剪；
- Retry/timeout/outcome unknown；
- Go v1 input/rolling/final safety 全部本地且 rolling 不产生网络调用；
- rolling delta 跨 chunk 风险；
- blocked/failed/cancelled 清空 hub accumulator 和客户端 draft 状态；
- auth session/CSRF/Origin/reauth；
- subscriber fan-out/backpressure/cleanup；
- memory candidate lifecycle；
- config 组合校验。

### 22.2 Provider contract

- non-stream/stream success；
- Unicode/长文本；
- usage/finish reason；
- 429/5xx；
- connect/first-token/total timeout；
- malformed SSE/JSON；
- response/body/output limit；
- cancel 与 late token；
- redirect/DNS/host restriction；
- credential 不泄漏到错误/日志。

### 22.3 PostgreSQL integration

- cross-owner/cross-relationship/cross-conversation 拒绝；
- missing owner context fail-closed；
- runtime role 无 DDL/BYPASSRLS；
- idempotent intake；
- outstanding 上限的并发 intake 不穿透，429 时零新增 message/generation/job；
- queue timeout 与 claim 前 cancel 都不创建 attempt、不调用 provider；
- concurrent claim/stale lock/fence；
- outbound 前 attempt intent；
- `RecordAttemptOutcome` 原子写 terminal/usage/billing disposition 并关闭 reservation；
- claim 过期恢复矩阵：无 intent 才 requeue；非终态 attempt → `OUTCOME_UNKNOWN`；`SUCCEEDED` 但未 finalize → `CANDIDATE_LOST_AFTER_ATTEMPT`；其他终态/cancel 按 §16.2.1 收敛；重复恢复不重复计费；
- cancel/complete race；
- atomic finalize；
- delete intent 与 late write 防复活；
- session revoke/password change；
- cost concurrent reservation；
- encryption Java/Go compatibility。
- legacy encryption 格式计数不读取正文；受控重写可幂等恢复，结束后 `enc1`/旧明文/unknown 均为 0 且 legacy reader 已删除。

### 22.4 E2E

- 登录到完成一轮 chat；
- 正常流、慢客户端、双 tab、断线重连、snapshot；
- final review 失败后当前页面与重连都看不到已撤回 partial；
- cancel before/while/after stream；
- 有界排队、满载 429、幂等重放和 queue timeout；
- provider 429/timeout/malformed/outcome unknown；
- consent 撤回后下一次 outbound 为 0；
- persona/memory category 实际生效/被删除；
- memory confirm/reject/edit/delete/no-memory/incognito；
- report/export/account deletion；
- crash/restart/job lease recovery；
- graceful shutdown。

### 22.5 陪伴质量 Golden Set

使用合成或 Owner 明确脱敏的 30–50 组对话，至少覆盖：

- 普通倾诉、疲惫、委屈、沉默、不想被建议；
- 用户纠正事实；
- persona 偏好生效与被授权过滤；
- 正确/错误/无关 memory；
- 不确定时不硬认；
- 长 history 裁剪；
- prompt injection 与 memory poisoning；
- 危机/敏感输入；
- provider/category 不可用的诚实降级。

评测只回答可操作问题：是否遵循风格、是否错用记忆、是否泄漏/越权、是否过度追问、是否在 category 被删时假装记得。不要建立庞大主观评分平台。

### 22.6 Race、Benchmark 与 Leak

- `go test -race ./...`；
- provider/core/realtime focused benchmark；
- pprof heap/CPU/goroutine；
- 100 turn 与容量画像；
- shutdown 后 goroutine/fd/DB connection 回落。

性能基准不进入每次日常 `check.sh`。它是阶段验收；日常入口仍只有 `bash scripts/check.sh`。

### 22.7 检查入口

Go 进入仓库后：

- `scripts/check.sh` 增加快速、无网络、无 DB 的 `go test ./...`；
- 保持全量日常检查 <60 秒；
- DB/contract/performance 进入已有 CI/显式阶段入口，不建立 doctor/precheck 第二体系；
- 不为 Go 重构恢复退役的 task/evidence/handoff 治理链。

## 23. Observability、日志与诊断

### 23.1 日志

使用 `slog` 结构化 JSON，只记录：

- request/run correlation id；
- operation/event type；
- outcome/error code；
- duration/bytes/count；
- provider/model/config version（不含 credential）；
- effective category names；
- retry/disable reason。

禁止：

- prompt、response、message、memory、summary；
- password、session、JWT、cookie、API key、webhook；
- 真实账号、联系方式；
- 稳定 user/conversation/generation 标识；
- 把敏感正文塞入 error wrapping。

异步 worker 使用一次 claim 生成的短生命周期 `run_id` 做关联，不记录 durable owner/resource id。

### 23.2 Metrics

最低集合：

- process RSS/CPU/goroutine/fd；
- DB pool active/idle/wait/transaction duration；
- HTTP latency/status；
- active/queued turns；
- provider connect/first-token/total/outcome；
- realtime subscribers/slow-disconnect/reconnect；
- job depth/claim/retry/last-success；
- memory candidate/recall outcome；
- safety/authorization decision code；
- monthly cost used/reserved。

label 只用低基数枚举，不用 owner/id/error message。

### 23.3 pprof

pprof 默认关闭，只允许本机/受控诊断启用；不得经 Caddy 公开。性能修复必须先有 profile 证据，不凭感觉加 pool、cache、unsafe 或自定义 allocator。

## 24. 配置原则

- 一个显式 `Config`，启动时解析并完整校验；
- Secret 只来自环境或仓库外私有文件；
- provider enabled 时缺 credential/endpoint 必须启动失败或明确禁用 chat，不得半配置运行；
- 不建立动态通用 feature-flag 系统；
- 只保留真实配置：DB、session、provider、budget、cost、concurrency、retention、export、observability；
- defaults 必须服务当前 Owner dogfood，不复制 Beta/商业化配置；
- config 不支持无消费者的热更新；provider durable disable 由 DB 状态表达。

## 25. 后续 AI Agent 的执行约束

### 25.1 每个实现任务开始前

1. 只读本文中对应阶段与直接引用的 contract/code；
2. 检查当前 HEAD，确认能力未被其他任务完成；
3. 明确本任务唯一写入 owner、生产消费者、要删除/替换的旧路径；
4. 明确验收命令和停止条件；
5. 如果需要新增表、状态、接口、feature flag、兼容层，逐项指出它对应本文哪条当前验收；答不出来就不加。

### 25.2 实施规则

- 一次只做一个可验证 slice；
- 不在同一 slice 同时重写 auth、generation、schema 和 realtime；
- 不把 Java 类名/包层级当设计输入；
- 先写行为/contract test，再实现最小代码；
- 不为理论异常穷举恢复分支；
- 安全失败与普通降级按 §11.4，不滥用 fail-closed；
- 不吞错误、不记录正文、不把未知失败变成功；
- 删除旧路径时同步删除配置、API、测试和文档，不留双真源；
- 不新增生产依赖、远端服务、公开接口或真实数据外发，除非 Owner 明确批准；
- 同一资源/command 始终一个 writer；
- 遇到未决产品选择时停在最小安全边界，不自创完整产品。

### 25.3 变更规模停止线

出现任一情况立即停止扩大并回到设计：

- 一个 slice 新增多个持久表或两套状态机；
- 新增的接口多于真实生产实现；
- 为让旧测试通过开始复制 RETIRE 机制；
- 引入 message broker、cache、workflow/DI/ORM framework；
- Java/Go 需要长期双写；
- provider 真实请求需要 shadow 双发；
- Go 需要 BYPASSRLS、直接明文或放宽 consent/safety；
- 资源目标没有测量却开始微优化；
- 新包无法指出当前消费者；
- 迁移 bridge 没有删除阶段。

## 26. 推荐实施单元

以下是顺序依赖，不是新增任务治理系统：

| ID | 单一交付 | 主要验收 | 不包含 |
|---|---|---|---|
| G0 | ADR/Catalog/OpenAPI scope 与 API consumer matrix | catalog/openapi check | Go 业务代码 |
| G1 | Java 资源/事务基线与 benchmark workload | 可重复报告 | Java 架构优化 |
| G2 | Go module、config、health、logging、metrics、shutdown、`api-migration/full` 硬隔离 | unit/check；migration 模式无法启动 provider/jobs | DB 业务 API |
| G3 | pgx owner tx、RLS、crypto/Bcrypt/JWT migration verifier | DB/golden vectors | auth writer |
| G4 | OpenAI-compatible provider adapter | mock contract | real provider shadow |
| G5 | Companion Core、Context、Persona、Safety、Budget | unit/Golden Set | tools/memory write |
| G6 | RealtimeHub 与 authenticated SSE | fan-out/reconnect/leak | ticket compatibility |
| G7 | Relationship/Conversation/Message core API | OpenAPI/E2E | generation plane |
| G8 | Memory/Consent/Report/Data rights | lifecycle/RLS/E2E | semantic platform |
| G9 | Opaque Auth + H5 transport 实现和离线验证；实际启用留到 Phase 5 | session/CSRF/reauth E2E | JWT/opaque 双 issuer |
| G10 | Jobs、generation worker、finalize/cancel/provider integration | contract/DB/E2E | Java/Go dual active |
| G11 | Auth/H5 + generation plane 同窗口 maintenance/drain/cutover/rollback rehearsal | synthetic smoke | destructive schema cleanup |
| G12 | Resource/capacity验收与 Go-only dogfood | §19 gates | future HA |
| G13 | Legacy API/schema/Java runtime 清理 | zero consumer + restore | historical migration rewrite |

任何单元如果明显超过一个 Agent 可闭环的写入范围，应按领域拆小，但不得新建第二套长期计划文件。

## 27. Definition of Done

本次重构完成必须同时满足：

### 功能

- Owner 核心旅程只依赖 Caddy、Go、PostgreSQL、当前一个获批模型 provider，以及当前批准的导出存储（generation cutover 默认 MinIO）；
- Java runtime 可以关闭；
- chat、cancel、snapshot、reconnect、memory、consent、auth、数据权利 E2E 通过；
- persona/category/memory 的实际生效状态可解释；
- 未迁能力已明确 DEFER/RETIRE，H5 没有死入口。

### 正确性与安全

- RLS、ownership、least privilege、加密兼容通过；
- provider outbound 前 attempt intent 与当前授权通过；
- intent 后崩溃按 §16.2.1 原子收敛且绝不重放未知 outbound；
- provider 调用/SSE 无长 DB transaction；
- cancel/timeout/late event/finalize race 通过；
- Attempt outcome/usage/billing/reservation 原子，final message/generation 终态原子；
- 删除/恢复不复活；
- 日志/metrics 无正文、token、secret、稳定敏感标识。

### 架构

- 一个 Go module、一个常驻 binary；
- 只有一张 active `model_attempt` 表和一条 attempt 写路径；
- 受保护字段只写/读受支持的 `enc2` key version；无 `enc1` 或明文兼容 reader；
- 无 Node/Pi sidecar、tools、message broker、DI/ORM/workflow framework；
- 无 Java/Go 双 writer、双 provider call 或永久 compatibility mode；
- 无未使用包、接口、表、状态、feature flag；
- Go-only 后完成 legacy cleanup，而非仅让旧 Java 退出流量。

### 资源与并发

- 达到 §19.2 冻结的 RSS/CPU/startup/image gate；
- runtime-only 与 retained resident stack 两套 gate 均达到；本机 provider 单列，不混入语言收益；
- 4 generation + 8 SSE 稳定通过；
- 16 generation + 64 SSE 有容量画像与明确饱和点；
- 无持续 goroutine/fd/connection/RSS 增长；
- graceful shutdown/drain/rollback 演练通过。

### 验证

- `bash scripts/check.sh` PASS；
- Go unit/race PASS；
- provider contract PASS；
- PostgreSQL/RLS/concurrency tests PASS；
- frontend core journey PASS；
- 性能基准按冻结 workload 完成；
- 任何未运行项如实标记 `NOT_RUN`，不得宣称通过。

## 28. 关键现有真源与外部参考

当前仓库：

- `AGENTS.md`
- `specs/catalog/product-scope.yaml`
- `specs/openapi/virtual-companion.yaml`
- `specs/contracts/generation-contract.yaml`
- `specs/contracts/finalization-contract.yaml`
- `specs/contracts/realtime-contract.yaml`
- `specs/contracts/authorization-contract.yaml`
- `specs/contracts/safety-fail-closed-contract.yaml`
- `specs/contracts/worker-lease-contract.yaml`
- `specs/contracts/database-ownership-contract.yaml`
- `docs/decisions/0006-owner-only-local-dogfood-boundary.md`
- `docs/engineering/checks-principles.md`

外部原则参考：

- Pi Agent Core README：<https://github.com/earendil-works/pi/blob/main/packages/agent/README.md>
- Pi AI README：<https://github.com/earendil-works/pi/blob/main/packages/ai/README.md>
- Go release policy/history：<https://go.dev/doc/devel/release>

Pi 只用于理解小核心、context transform、event stream 和控制语义；本文才是本项目的目标设计边界。

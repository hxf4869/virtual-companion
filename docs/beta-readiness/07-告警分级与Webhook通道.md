# 07 · 告警分级与 Webhook 通道（草案）

对应需求 §22.12「告警分级」、§26.6「Controlled Beta 安全运营门槛」。
**状态：Agent 代拟草案，Owner 复核后生效。** 2026-08-23 Owner 已确认本人
担任当前内部 Canary 的主要告警接收人，并确认供应商连续失败熔断阈值为 5；
2026-08-24 Owner 选择已入群的飞书应用机器人作为告警通道；最小权限、旧密钥
轮换、本机私有凭据注入及真实群投递均已完成验证。独立 generic signed
Webhook 替补通道与主通道失败后的 outbox 投递已接线、默认关闭；替补接收人
和独立 endpoint 仍待指定。（METRICS-ALERT）已接线部分还包括 Micrometer
指标暴露、自动告警点和 R3/R4 SLA 队列可见性。其余人工升级条目仍待 Owner
落实。

## 1. 指标暴露（已接线）

- 端点：`GET /actuator/prometheus`（Prometheus 文本格式；`/actuator/health` 不变）。
- 指标（标签值只含终态枚举与目录码，绝无聊天原文，§22.11）：

| 指标 | 标签 | 含义 |
|---|---|---|
| `vc_generation_total` | `result` | generation 工作项处理终态计数：completed / completed_zero_llm / failed / retried / blocked_input / blocked_output / blocked_budget / error（每处理项恰好 +1，worker finally 单点记录） |
| `vc_generation_duration` | `result` | 单个 generation 工作项处理耗时 |
| `vc_tokens_total` | `kind=input/output` | finalize 结算的 token 用量 |
| `vc_provider_attempt_total` | `result` | provider attempt 终态（LiveAttemptTerminal 名） |
| `vc_safety_event_total` | `stage`, `risk` | 确定性安全事件（INPUT/INCREMENTAL/FINAL × risk-levels 目录码） |
| `vc_beta_dau` | — | 当日活跃用户数（V77 `vc.job_daily_active_users`，按服务窗口时区日界，默认 60s 刷新，仅聚合计数） |
| `vc_alert_webhook_delivery_total` | `result` | durable outbox 的 enqueued/duplicate/delivered/retried/dead/refused/fallback_delivered 计数；不含 payload 文本 |

- 抓取凭据口径：本地开发（auth 关闭）可直接访问；**auth 开启的部署中
  `/actuator/prometheus` 与其余端点一致要求 Bearer 认证**——Prometheus 侧用
  `authorization` 头携带有效账号令牌抓取，或由反代限制到内网并注入令牌。
  专用抓取凭据（非用户账号）留待 Beta 部署时定，见 §6。

## 2. 告警通知通道（协议已接线，飞书应用机器人已真实验证）

- 总开关：`virtual-companion.alerts.webhook-provider`（env
  `VC_ALERT_WEBHOOK_PROVIDER`）。`generic` / `feishu-custom-bot` 以空
  `VC_ALERT_WEBHOOK_URL` 禁用；`feishu-app-bot` 缺少任一 App ID、App Secret
  或群 `chat_id` 时禁用。指标始终照常暴露。
- 行为：业务路径只把固定级别/code/短运维文案写入 V85 durable outbox，不同步
  外发；同一 `code`/窗口数据库去重。dispatcher 以 `SKIP LOCKED` 认领，网络/429/5xx
  按指数退避最多 5 次，进程在 IN_FLIGHT 中退出后 30 秒可重领，达到上限进入 DEAD；
  投递异常绝不反抛业务路径。payload、指标与日志均不接受聊天正文、Token、联系方式
  或 owner 标识。
- 替补：`VC_ALERT_FALLBACK_WEBHOOK_URL/SECRET/ALLOWED_HOSTS` 配置一条**独立**
  generic signed webhook；默认空值关闭，禁止复用主通道 Secret。主通道任一
  非 DELIVERED 结果会尝试替补；任一路径真实成功后 outbox 才记 DELIVERED，
  两路均失败则按原有有界重试/dead-letter 口径处理。
- `generic`（默认）：保持原有扁平 JSON，并以 `VC_ALERT_WEBHOOK_SECRET` 对完整
  body 做 HMAC-SHA256，写入 `X-VC-Signature`。Payload 示例：

```json
{"severity":"P2","code":"DAU_CAP_REACHED","message":"daily active users reached the beta cap; new actives refused","occurredAt":"2026-08-21T12:00:00Z"}
```

- `feishu-custom-bot`：仅支持已开启“签名校验”的飞书群自定义机器人。
  `VC_ALERT_WEBHOOK_SECRET` 必须填写该机器人的**签名密钥**，不是飞书应用的
  App Secret；请求使用 `timestamp`、`sign`、`msg_type=text`、`content.text`
  协议，不发送 `X-VC-Signature`。序列化后的请求不得超过飞书的 20 KB 限制。
- 飞书 HTTP 2xx 仍不代表成功：只有响应中的 `code` / 兼容字段
  `StatusCode` 均为数值 0 才记为 `DELIVERED`；限流码 `11232` 进入现有有界
  重试，其余业务错误拒绝并进入 dead-letter，缺少业务码或非法 JSON 不会误报
  成功。协议参考[飞书自定义机器人使用指南](https://open.feishu.cn/document/client-docs/bot-v3/add-custom-bot)。
- `feishu-app-bot`（当前选定）：使用已在目标群中的飞书自建应用机器人，配置
  `VC_ALERT_FEISHU_APP_ID`、`VC_ALERT_FEISHU_APP_SECRET` 和
  `VC_ALERT_FEISHU_CHAT_ID`；`VC_ALERT_WEBHOOK_URL` / `SECRET` 留空。服务只向
  固定的飞书官方 token 与消息 API 出站，不开放可配置 API base URL。App Secret
  换取的 `tenant_access_token` 仅驻内存并在到期前刷新，不写仓库或日志。
- 应用需启用机器人能力、申请最小权限 `im:message:send_as_bot`、创建并发布新
  版本；机器人须仍在目标群且有发言权。若需要通过“获取机器人所在群列表”发现
  `chat_id`，可临时再申请只读权限 `im:chat:read`，人工确认目标群后只把 ID 写入
  私有部署配置。**单向告警不需要事件订阅、回调 URL、Verification Token 或
  Encrypt Key**；事件订阅只在未来需要接收群消息/成员变化时启用。
- 应用机器人请求使用 `receive_id_type=chat_id`、`msg_type=text`，并把内容编码为
  JSON 字符串。Outbox ID 生成不含正文的稳定 `uuid`，使超时或 `230049` 后的 5 次
  有界重试仍受飞书一小时去重保护；请求不超过文本消息 150 KB。只有 `code=0`
  且返回非空 `data.message_id` 才记为 `DELIVERED`；`230020`（限流）、`230049`
  （发送中）、HTTP 429/5xx/网络错误进入重试；权限、群、发言或参数类错误进入
  dead-letter。token 失效会原子清除内存缓存，下次重试重新鉴权。协议参考
  [获取 tenant_access_token](https://open.feishu.cn/document/server-docs/authentication-management/access-token/tenant_access_token_internal)、
  [发送消息](https://open.feishu.cn/document/server-docs/im-v1/message/create)和
  [事件订阅概述](https://open.feishu.cn/document/server-docs/event-subscription-guide/overview)。
- 部署建议显式配置
  `VC_ALERT_WEBHOOK_ALLOWED_HOSTS=open.feishu.cn`。Webhook URL、签名密钥、
  App Secret 与群 ID 均只允许写入部署 Secret / 本机私有 `.env`，不得写入
  仓库、日志或聊天。2026-08-24 曾在聊天中暴露的旧 App Secret 必须先轮换，
  本项目不会使用该旧值。
- 2026-08-24 真实通道 smoke：使用轮换后凭据从 Git 忽略的本机私有
  配置向目标群只发送 1 条无敏感数据的 P2 测试告警；飞书返回 HTTP 200、
  `code=0` 和非空 `message_id`，Owner 确认群内已收到，结论 **PASS**。
  该结果只证明告警通道可投递，不代表 Canary/Beta 获批。凭据、token、
  `chat_id` 和 `message_id` 均未记录到仓库或日志。

## 2a. ROUTE-HARDEN 熔断器（已接线，§12.12 / §12.8）

- 配置：`virtual-companion.model-providers.circuit-failure-threshold`（默认 5）
  与 `circuit-cooldown-millis`（默认 60000）。
- S0-24 Owner 决策（2026-08-23）：内部 Canary 保持阈值 5。连续 5 次失败
  自动 OPEN，并通过 V98 `rollback_provider_deployment` 把该供应商已配置部署
  原子收紧为 durable `DISABLED`，追加只含固定 trigger/actor/state/time 的回滚
  历史；重启不会静默恢复。过程发送 `PROVIDER_CIRCUIT_OPEN` 与
  `PROVIDER_DURABLE_ROLLBACK`。数据库不可写时仍保持进程内 OPEN，并发送 P0
  `PROVIDER_DURABLE_ROLLBACK_FAILED`。
- Safety leak 保持人工立即回滚口径：仅 `SAFETY_LEAK + OPERATOR` 可执行；
  数据库拒绝 AUTO 冒充人工决定。操作仍只调用受限函数，禁止直接 UPDATE。
- 粒度与口径：**按供应商**（supplier name）计数——外部 attempt 连续失败达
  阈值即该供应商熔断 OPEN；冷却期满放行单个半开探针（由 worker 出站门禁
  `allow()` 认领，恰好一个），成功闭合、失败带新冷却重开。
- 路由决策接入：路由健康感知选路——会话粘滞的健康部署优先，OPEN 供应商被
  跳过（流量在轮次边界切换到健康候选），候选全 OPEN 时按既有口径降级
  ZERO_LLM 或 NO_ELIGIBLE。
- 出站门禁位置：worker 在 attempt intent 落库之前拒绝出站（无 intent 残留，
  进入既有 RETRY-A 有界重试；长故障经死信预算自然终止）。
- 会话模型粘滞（§12.8）：外部成功把 conversation→deployment 记入进程内
  affinity（单机 Compose 口径，重启后首轮成功自然重建）；健康变化才在轮次
  边界切换，已开始的流不在中途换模型（每 attempt 单一供应商会话）。

## 2b. BUDGET-HALT 硬预算停机（已接线，§22.18）

- 配置：`budget-monthly-usd` 是 provider 月度美元硬上限；默认 0 仅允许 Provider
  关闭或纯 FAKE/loopback。任何启用的 OpenAI/Anthropic 部署在 datasource 模式下若
  上限非正、当前 provider+model price 缺失，启动/prepare 均 fail-closed。
- V105 在 prepare 的 attempt intent 之前按冻结 price version、估算 input 与最坏 8192
  output token 原子预留；月行锁保证并发总额不越 ceiling。同一 work item retry 复用
  hold，换部署先 release；失败/取消/超时 release，成功（含最终审核拦截）按实际 token
  settle；正常完成同时把 actual USD 写 generation usage，最终审核拦截仍只留成本账。
  ZERO_LLM 和输入危机模板不建 reservation。
- 80/95/100% 只发固定码 `BUDGET_80/BUDGET_95/BUDGET_100`（不含 owner/provider）；
  超 cap 无出站。旧 `BudgetGuard` 仍作快速读门禁，V105 reservation 是并发权威。

## 2c. Scheduler lease、dry-run 与 freshness（S0-31，已接线）

- V86 对 `RETENTION_PURGE`、`AUTH_EVENT_PURGE`、`DAU_METRICS`、`EXPORT_EXPIRY`
  使用数据库行锁租约；不同 holder 在租约未过期时不能同时执行。pause fail-closed；
  retention 的 DB/部署 dry-run 都真实执行 legal-hold-aware 估算，并以 `DRY_RUN` +
  每类计数结束 run，不把 dry-run 当作空跳过。
- 每次 run 仅记录固定 job 名、STARTED/终态、聚合分类计数和最长 120 字符固定错误码；
  不记录 owner、聊天正文或自由文本。V107 `list_job_health()` 提供 last-success、最新
  状态和起止时间。默认 DAU/export 5 分钟、日任务 26 小时无成功即 P1 stale；超出
  最大运行时长的 STARTED 也告警。pause 的任务不报 stale，retention 未启用时不监测。
- retention 的 legal hold 与默认 dry-run 仍以 `08-数据保留策略草案.md` 为准；本项不
  授权真实 purge。阈值可用 `VC_JOB_*_STALE_SECONDS` 收紧，修改后须演练并复核告警噪声。

## 3. 已接线的自动告警

| code | 级别 | 触发点 |
|---|---|---|
| `DAU_CAP_REACHED` | P2 | Beta 服务窗口因 DAU 达上限拒绝新活跃用户（GenerationController SVC-WINDOW 分支） |
| `ACCOUNT_DELETE_FAILED` | P1 | 自助注销遇数据访问异常（AuthService.deleteAccount；异常仍按原口径转为不披露错误） |
| `RETENTION_PURGE_FAILED` | P1 | 分类清理单类失败（其余类继续；run 标为 FAILED） |
| `AUTH_EVENT_PURGE_FAILED` | P1 | 认证审计保留清理失败并记录 FAILED run |
| `DAU_METRICS_FAILED` | P1 | DAU 聚合刷新失败；保留上次 gauge 并记录 FAILED run |
| `EXPORT_EXPIRY_FAILED` | P1 | 导出残留过期清理失败并记录 FAILED run |
| `RETENTION_PURGE_STALE` | P1 | 已启用 retention 在 26 小时内无成功/DRY_RUN 或运行超时 |
| `AUTH_EVENT_PURGE_STALE` | P1 | 认证审计日任务在 26 小时内无成功或运行超时 |
| `DAU_METRICS_STALE` | P1 | DAU 聚合在 5 分钟内无成功或运行超时 |
| `EXPORT_EXPIRY_STALE` | P1 | 导出过期任务在 5 分钟内无成功或运行超时 |
| `BUDGET_HALT_REACHED` | P1 | 硬预算停机触发（BLOCKED_BY_BUDGET，见 §2b） |
| `BUDGET_80` | P2 | 原子 reservation 后月度总额进入 80% 阈值窗口 |
| `BUDGET_95` | P1 | 原子 reservation 后月度总额进入 95% 阈值窗口 |
| `BUDGET_100` | P0 | 原子 reservation 恰达 ceiling；后续 reservation 全部拒绝 |
| `PROVIDER_CIRCUIT_OPEN` | P2 | 供应商熔断器 CLOSED→OPEN（连续失败达阈值；路由已切换/降级，见 §2a） |
| `PROVIDER_DURABLE_ROLLBACK` | P1 | 熔断阈值触发 V98 durable DISABLED（含 already-disabled 幂等结果；不含 provider ID/endpoint） |
| `PROVIDER_DURABLE_ROLLBACK_FAILED` | P0 | 进程内已 OPEN，但 durable disable 无匹配部署或数据库失败；禁止靠重启恢复流量 |

## 4. R3/R4 SLA 可见性（已接线）

- V69 重定义 `list_safety_events`：每行新增 `age_hours`（SQL 只报事实年龄）；
- `GET /api/v1/auth/admin/safety-events` 响应新增 `ageHours` 与 `slaBreached`
  （阈值来自部署配置 `r3-sla-hours` 默认 24、`r4-sla-hours` 默认 1——**草案值，
  Owner 复核**）；
- admin 安全队列每行展示事实年龄，`slaBreached` 行附「SLA 超时」标记。

## 5. 分级定义（§22.12 全集，Owner 复核）

### P0（立即响应）

跨用户数据泄漏；高风险危机规则整体失效；加密密钥泄漏或异常访问；删除任务
批量失败且超过时限；未授权模型进入生产路由；数据库不可恢复或大规模数据丢失；
管理员账号被接管。

### P1（当班响应）

主模型全部不可用；降级率持续超阈值；消息持久化失败；Outbox 严重积压；
高风险人工处理超时（对应 `slaBreached` 的 R3/R4 行）；模型成本异常增长；
输出安全拦截率突变。

### P2（下次复盘处理）

单一供应商部分区域异常；记忆处理延迟；Embedding 迁移积压；DAU 上限触发
（已接线 `DAU_CAP_REACHED`）。

> 后续接线位：P0/P1 多数条目依赖真实 provider 与部署环境（R47 DEPLOY 后的
> 组合探测），本轮先落通道与两处确定性触发点；新触发点必须复用
> `AlertNotifier.alert(severity, code, message)` 并在本文档登记。

## 6. Owner 待填清单

- `[主要告警接收人]`：Owner 本人（2026-08-23 已确认；仓库只记录角色，
  不记录真实联系方式）
- `[告警接收端]`：已入群的飞书应用机器人（2026-08-24 已完成权限、密钥
  轮换、私有配置注入与真实群投递验证；凭据不入仓库）
- `[替补接收人/独立 endpoint]`：代码与默认关闭配置已就绪，人员和真实目标未指定；
  缺替补时只允许内部测试，不允许真实用户 Beta
- `[SLA 阈值复核]`：R3=24h / R4=1h 是否符合值班人力
- `[升级路径]`：P0 无响应时的升级人与方式
- `[抓取凭据方案]`：Prometheus 抓取是否引入专用凭据（非用户账号令牌），
  还是维持账号令牌/反代注入（见 §1）

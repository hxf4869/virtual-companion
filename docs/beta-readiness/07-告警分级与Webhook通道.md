# 07 · 告警分级与 Webhook 通道（草案）

对应需求 §22.12「告警分级」、§26.6「Controlled Beta 安全运营门槛」。
**状态：Agent 代拟草案，Owner 复核后生效。** 本轮（METRICS-ALERT）已接线的
部分：Micrometer 指标暴露、Webhook 告警通道、两个自动告警点、R3/R4 SLA
队列可见性。其余条目为分级定义与后续接线规划。

## 1. 指标暴露（已接线）

- 端点：`GET /actuator/prometheus`（Prometheus 文本格式；`/actuator/health` 不变）。
- 指标（标签值只含终态枚举与目录码，绝无聊天原文，§22.11）：

| 指标 | 标签 | 含义 |
|---|---|---|
| `vc_generation_total` | `result` | generation 终态计数：completed / completed_zero_llm / failed / retried / blocked_input / blocked_output |
| `vc_generation_duration` | `result` | 单个 generation 工作项处理耗时 |
| `vc_tokens_total` | `kind=input/output` | finalize 结算的 token 用量 |
| `vc_provider_attempt_total` | `result` | provider attempt 终态（LiveAttemptTerminal 名） |
| `vc_safety_event_total` | `stage`, `risk` | 确定性安全事件（INPUT/INCREMENTAL/FINAL × risk-levels 目录码） |

## 2. Webhook 通道（已接线）

- 配置：`virtual-companion.alerts.webhook-url`（env `VC_ALERT_WEBHOOK_URL`，
  部署注入；**留空即完全禁用发送**，指标照常暴露）。
- 行为：异步 POST JSON，2s 连接超时；失败只记 WARN 日志，绝不阻断业务；
  同一 `code` 60 秒节流，防止热循环刷爆接收端。
- Payload 示例：

```json
{"severity":"P2","code":"DAU_CAP_REACHED","message":"daily active users reached the beta cap; new actives refused","occurredAt":"2026-08-21T12:00:00Z"}
```

## 3. 已接线的自动告警

| code | 级别 | 触发点 |
|---|---|---|
| `DAU_CAP_REACHED` | P2 | Beta 服务窗口因 DAU 达上限拒绝新活跃用户（GenerationController SVC-WINDOW 分支） |
| `ACCOUNT_DELETE_FAILED` | P1 | 自助注销遇数据访问异常（AuthService.deleteAccount；异常仍按原口径转为不披露错误） |

## 4. R3/R4 SLA 可见性（已接线）

- V69 重定义 `list_safety_events`：每行新增 `age_hours`（SQL 只报事实年龄）；
- `GET /api/v1/auth/admin/safety-events` 响应新增 `ageHours` 与 `slaBreached`
  （阈值来自部署配置 `r3-sla-hours` 默认 24、`r4-sla-hours` 默认 1——**草案值，
  Owner 复核**）；admin 安全队列据此可见超时行。

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

- `[告警接收端 URL]`（部署配置注入，不入仓库）
- `[SLA 阈值复核]`：R3=24h / R4=1h 是否符合值班人力
- `[升级路径]`：P0 无响应时的升级人与方式

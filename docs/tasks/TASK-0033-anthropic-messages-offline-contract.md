# TASK-0033：Anthropic Messages 离线 HTTP/SSE 合同

```yaml
taskId: TASK-0033
state: PLANNED
owner: repository-owner
planningBacklog: .harness/task-backlog.yaml
planningContractHash: 1210817368805f8217761e017b2d0ede36c9db1ddc092ddf3a7f46428c44ac1a
planningContractHashAlgorithm: SHA256_CANONICAL_JSON_V1
```

## 目标

以 `127.0.0.1` mock-server 实现 Anthropic Messages 非流与 SSE 离线 Adapter 合同。

## 范围内

- `/v1/messages` 请求、流事件、Usage、Stop Reason 和结构化能力；
- 429、5xx、三段超时、取消、Malformed Event 和 Late Fence。

## 明确禁止

- 读取真实 Key、访问真实供应商或接入 Runtime；
- Adapter 内置重试、路由或业务状态真源；
- 把 OpenAI Responses API 纳入本任务。

## 依赖与决策闸门

- 依赖：TASK-0011、TASK-0013；
- 无独立硬决策闸门，但执行顺序位于 TASK-0032 之后。

## 验收

- model-protocol-contract 的两个主协议均通过本地 mock-server；
- 单请求、loopback、脱敏和失败关闭边界完整自动化。

## 晋级规则

依赖 ACCEPTED 且轮到本卡时，才基于当时最新协议资料、main 和工具链补齐动态证据；PLANNED 阶段不冻结协议依赖版本或命令。

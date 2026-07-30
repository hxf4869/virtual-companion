# TASK-0025：Chat、Generation、History API

```yaml
taskId: TASK-0025
state: PLANNED
owner: repository-owner
planningBacklog: .harness/task-backlog.yaml
planningContractHash: 9bf68f30450b35a9e6bec6bb0618c552f1326692b14c2d2174e18bf9a281b572
planningContractHashAlgorithm: SHA256_CANONICAL_JSON_V1
```

> 规划正文仅为非规范的人类可读渲染；唯一机器真源是 `.harness/task-backlog.yaml` 中本 Task ID 的静态合同，并由 `planningContractHash` 完整绑定。

## 目标

以生成契约提供 Chat 接收、Generation 状态和历史读取 API。

## 范围内

- 幂等发送、取消、Generation snapshot 和分页历史；
- 服务端所有权谓词与统一错误语义。

## 明确禁止

- 客户端 `owner_user_id` 成为授权依据；
- 历史 API 暴露跨用户资源存在性；
- 公开注册、真实账号、WebSocket 或主动消息。

## 依赖与决策闸门

- 依赖：TASK-0021、TASK-0023、TASK-0024；
- 无独立硬决策闸门。

## 验收

- OpenAPI 合同、实现和生成 Client 无漂移；
- 幂等、取消、分页和越权测试全部通过。

## 晋级规则

全部依赖 ACCEPTED 且本卡成为首个可晋级项时，才补齐最新 main 的动态证据。

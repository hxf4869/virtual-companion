# TASK-0017：Conversation/Generation 持久化与幂等接收

```yaml
taskId: TASK-0017
state: PLANNED
owner: repository-owner
planningBacklog: .harness/task-backlog.yaml
planningContractHash: 9a85e17a78baebcd2a87417c7e60a6a7f53c8dbff933fb0f8c019ec1b8fe0538
planningContractHashAlgorithm: SHA256_CANONICAL_JSON_V1
```

## 目标

持久化 Conversation、Message 与 Generation，并保证一个逻辑请求对应稳定 `generationId`。

## 范围内

- Conversation、Message、Generation 复合所有权模型；
- 幂等请求键、稳定 `generationId` 和状态迁移。

## 明确禁止

- 重试、降级或模型切换时更换 `generationId`；
- 客户端 owner 声明成为所有权真源；
- 提前实现最终化事务、SSE 或 H5。

## 依赖与决策闸门

- 依赖：TASK-0015；
- 无独立硬决策闸门。

## 验收

- 重复接收只返回同一 `generationId` 且不重复创建消息；
- 所有状态与所有权约束具有数据库和集成测试。

## 晋级规则

只有 TASK-0015 已 ACCEPTED、仓库空闲且执行顺序允许时，才创建唯一 DRAFT 并绑定动态数据库证据。

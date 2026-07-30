# TASK-0026：H5 离线聊天、流式显示与恢复

```yaml
taskId: TASK-0026
state: PLANNED
owner: repository-owner
planningBacklog: .harness/task-backlog.yaml
planningContractHash: ba76742dc7a03fcdda086cfbc37c8bda4a63ce4a47eee0406e0438adece0d7b7
planningContractHashAlgorithm: SHA256_CANONICAL_JSON_V1
```

> 规划正文仅为非规范的人类可读渲染；唯一机器真源是 `.harness/task-backlog.yaml` 中本 Task ID 的静态合同，并由 `planningContractHash` 完整绑定。

## 目标

用离线后端实现 H5 聊天、增量显示、断线恢复和安全终态呈现。

## 范围内

- Fetch-SSE、连续 cursor、gap/reset/snapshot UI；
- 发送幂等、取消和终态替换。

## 明确禁止

- WebSocket、语音、图片和主动消息；
- 长期 Token 存 `localStorage`；
- Gap 后继续拼接草稿。

## 依赖与决策闸门

- 依赖：TASK-0025；
- 无独立硬决策闸门。

## 验收

- 离线成功、断线、Gap、Reset、取消和失败场景可自动复测；
- 客户端不伪造缺失 delta。

## 晋级规则

TASK-0025 ACCEPTED、仓库空闲且 Backlog 顺序允许后，才创建唯一 DRAFT。

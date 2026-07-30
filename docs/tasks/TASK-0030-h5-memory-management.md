# TASK-0030：H5 记忆管理界面

```yaml
taskId: TASK-0030
state: PLANNED
owner: repository-owner
planningBacklog: .harness/task-backlog.yaml
planningContractHash: 4616cf253afce55f0e9198f3e2c2a7bf7b7c7ebabe5849eee92c9c8341c7a3bb
planningContractHashAlgorithm: SHA256_CANONICAL_JSON_V1
```

> 规划正文仅为非规范的人类可读渲染；唯一机器真源是 `.harness/task-backlog.yaml` 中本 Task ID 的静态合同，并由 `planningContractHash` 完整绑定。

## 目标

提供 H5 记忆候选确认、来源查看、编辑和删除界面。

## 范围内

- Pending candidate、Canonical Memory 和来源展示；
- 确认、编辑、删除与错误恢复。

## 明确禁止

- 账号共享记忆和自动确认；
- UI 把未确认候选展示为已保存事实；
- 删除失败时乐观伪装成功。

## 依赖与决策闸门

- 依赖：TASK-0026、TASK-0029；
- 无独立硬决策闸门。

## 验收

- 关键交互和越权/失败状态可自动复测；
- 来源、状态和删除结果与 API 真源一致。

## 晋级规则

全部依赖 ACCEPTED、仓库空闲且本卡为首个可晋级项时，才补齐动态实现授权。

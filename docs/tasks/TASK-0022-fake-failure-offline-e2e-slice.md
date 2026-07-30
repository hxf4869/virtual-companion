# TASK-0022：Fake/Failure 后端离线端到端纵切

```yaml
taskId: TASK-0022
state: PLANNED
owner: repository-owner
planningBacklog: .harness/task-backlog.yaml
planningContractHash: 16b6aafc725373a04279f93714ca97da46e01f32af51696421bd5784c0686c3d
planningContractHashAlgorithm: SHA256_CANONICAL_JSON_V1
```

> 规划正文仅为非规范的人类可读渲染；唯一机器真源是 `.harness/task-backlog.yaml` 中本 Task ID 的静态合同，并由 `planningContractHash` 完整绑定。

## 目标

用 Fake、Failure 和合成数据贯通接收、授权、Worker、安全、最终化与恢复。

## 范围内

- 完整离线成功、失败、取消、超时和恢复纵切；
- `127.0.0.1` 或进程内合成测试。

## 明确禁止

- 读取真实凭据、访问真实 Provider 或使用真实数据；
- 失败时绕过 Guard、安全或 Fence；
- 提前实现 H5 产品界面。

## 依赖与决策闸门

- 依赖：TASK-0016、TASK-0019、TASK-0021；
- 无独立硬决策闸门。

## 验收

- Fake 成功与 Failure 故障矩阵端到端可重复；
- 零真实外发、零真实数据且所有终态唯一。

## 晋级规则

全部依赖 ACCEPTED、仓库空闲且本卡为首个可晋级项时，才创建动态授权证据。

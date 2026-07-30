# TASK-0032：最小 ZERO_LLM、额度释放与全故障恢复

```yaml
taskId: TASK-0032
state: PLANNED
owner: repository-owner
planningBacklog: .harness/task-backlog.yaml
planningContractHash: ca5e005fdf2d0d066a4d5fdfc3c220088eb85883d0622cd54bcab8d9f0324f81
planningContractHashAlgorithm: SHA256_CANONICAL_JSON_V1
```

> 规划正文仅为非规范的人类可读渲染；唯一机器真源是 `.harness/task-backlog.yaml` 中本 Task ID 的静态合同，并由 `planningContractHash` 完整绑定。

## 目标

实现最小 ZERO_LLM、安全确定性响应、额度释放和全 Provider 故障恢复。

## 范围内

- ZERO_LLM 无 `provider_attempt` 路径；
- 额度释放、失败终态和恢复事件。

## 明确禁止

- ZERO_LLM 创建 Provider Attempt；
- 全故障时输出未经审查自由文本；
- 绕过最终安全复核或稳定 `generationId`。

## 依赖与决策闸门

- 依赖：TASK-0020、TASK-0021、TASK-0031；
- 无独立硬决策闸门。

## 验收

- 超时、取消、无容量和全故障均正确释放或结算额度；
- 恢复路径保持稳定 `generationId` 和唯一终态。

## 晋级规则

全部依赖 ACCEPTED、仓库空闲且执行顺序允许时，才创建唯一 DRAFT。

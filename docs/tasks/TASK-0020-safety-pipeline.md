# TASK-0020：输入、增量输出和最终输出安全流水线

```yaml
taskId: TASK-0020
state: PLANNED
owner: repository-owner
planningBacklog: .harness/task-backlog.yaml
planningContractHash: cc663f75c8c9c17de49fb5c9e09fe01079262467ea617e77f2771244e4ac01f2
planningContractHashAlgorithm: SHA256_CANONICAL_JSON_V1
```

> 规划正文仅为非规范的人类可读渲染；唯一机器真源是 `.harness/task-backlog.yaml` 中本 Task ID 的静态合同，并由 `planningContractHash` 完整绑定。

## 目标

实现输入、增量输出和最终输出的确定性优先、失败关闭安全流水线。

## 范围内

- 硬规则、分类信号、增量暂停和最终复核；
- ZERO_LLM 或确定性安全替代。

## 明确禁止

- 分类器降低硬规则风险；
- 超时、低置信、无效响应或规则冲突时放行自由文本；
- 未获批即猜测 Beta 或 Alpha 安全政策。

## 依赖与决策闸门

- 依赖：TASK-0014、TASK-0019；
- 无独立硬决策闸门。

## 验收

- 所有 classifier failure outcome 均失败关闭；
- final review 失败时不存在 `chat.completed`。

## 晋级规则

全部依赖 ACCEPTED、仓库空闲且执行顺序允许后，才能绑定安全 Skill、人工批准和精确测试成为唯一 DRAFT。

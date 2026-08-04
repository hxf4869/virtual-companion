# TASK-0056：Idle planning checkpoint 四消费者接线与 CI 闭环

```yaml
taskId: TASK-0056
state: PLANNED
owner: repository-owner
planningBacklog: .harness/task-backlog.yaml
planningContractHash: 4444bceb0a68f725db68f4277f74f033fec17843157aec6e86e32544545c62d1
planningContractHashAlgorithm: SHA256_CANONICAL_JSON_V1
```

> 规划正文仅为非规范的人类可读渲染；唯一机器真源是 `.harness/task-backlog.yaml` 中本 Task ID 的静态合同，并由 `planningContractHash` 完整绑定。

## 目标

将已验证 checkpoint 统一接入四个执行消费者，并以 canonical 与 exact-SHA CI 完整闭环。

## 范围内

- 四个消费者共享同一 checkpoint；
- 合法规划尾部成为下一 DRAFT/Base-Handoff 锚点，前卡 Diff Scope 截止 canonical terminal。

## 明确禁止

- 各消费者重复实现解析；
- 重写 TASK-0073 核心语义，或顺带实现性能、路径感知 CI、receipt。

## 依赖与决策闸门

- 依赖：TASK-0076；
- 无新增硬决策闸门。

## 验收

- 四个消费者对同一历史得到同一结果；
- 无尾部行为不变，轻量集成、canonical 与 exact-SHA CI 全部通过。

## 晋级规则

TASK-0073 必须 ACCEPTED，仓库必须空闲，且本卡是执行顺序中首个可晋级任务。

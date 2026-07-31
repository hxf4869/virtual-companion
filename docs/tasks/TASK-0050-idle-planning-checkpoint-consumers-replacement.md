# TASK-0050：Idle planning checkpoint 四消费者接线最终替代

```yaml
taskId: TASK-0050
state: SUPERSEDED
planningResolution:
  state: SUPERSEDED
  reason: TASK-0049 已由 TASK-0055 替代；由 TASK-0056 在新后继链上承接相同四消费者接线与 CI 闭环范围。
  decidedBy: repository-owner
  decidedAt: "2026-07-31"
  replacementTask: TASK-0056
owner: repository-owner
planningBacklog: .harness/task-backlog.yaml
planningContractHash: 2b32a8e0fdb175d297b24ee14c9c702b2c08b325c39b4149211a993126e4b12d
planningContractHashAlgorithm: SHA256_CANONICAL_JSON_V1
```

> 规划正文仅为非规范的人类可读渲染；唯一机器真源是 `.harness/task-backlog.yaml` 中本 Task ID 的静态合同，并由 `planningContractHash` 完整绑定。

## 目标

承接 TASK-0044，将已验证 checkpoint 统一接入 DRAFT、Base-Handoff、idle terminal 与 terminal Diff Scope。

## 范围内

- 四个消费者共享同一 checkpoint；
- 合法规划尾部成为下一 DRAFT/Base-Handoff 锚点，前卡 Diff Scope 截止 canonical terminal。

## 明确禁止

- 各消费者重复实现解析；
- 重写 TASK-0049 核心语义，或顺带实现性能、CI、receipt。

## 依赖与决策闸门

- 依赖：TASK-0049；
- 无新增硬决策闸门。

## 验收

- 四个消费者对同一历史得到同一结果；
- 无尾部行为不变，轻量集成、canonical 与 exact-SHA CI 通过。

## 晋级规则

TASK-0049 必须 ACCEPTED，仓库必须空闲，且本卡是执行顺序中首个可晋级任务。

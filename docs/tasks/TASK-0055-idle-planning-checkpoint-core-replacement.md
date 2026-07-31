# TASK-0055：Idle planning checkpoint 核心父边校验

```yaml
taskId: TASK-0055
state: PLANNED
owner: repository-owner
planningBacklog: .harness/task-backlog.yaml
planningContractHash: 11bbbfda8c0015c63c8763e7a9c6f47dc24343a014e50a3f2b24a586c0e27abf
planningContractHashAlgorithm: SHA256_CANONICAL_JSON_V1
```

> 规划正文仅为非规范的人类可读渲染；唯一机器真源是 `.harness/task-backlog.yaml` 中本 Task ID 的静态合同，并由 `planningContractHash` 完整绑定。

## 目标

承接被 TASK-0048 REJECTED 阻断的 TASK-0049，建立 idle planning checkpoint 的唯一父边核心。

## 范围内

- 校验单父、非空、原子 planning-only resolution 边、可选 nextAction、100644 mode 与错误后恢复；
- 覆盖合法串行 resolution 和无可晋级状态的正负矩阵。

## 明确禁止

- 建立第二状态机或第二 Backlog；
- 接入四个执行消费者，或重做已闭环的 baseline fixture。

## 依赖与决策闸门

- 依赖：standalone TASK-0054；
- 无新增硬决策闸门。

## 验收

- checkpoint 只从 canonical terminal 后的 Git parent history 派生；
- 合法边通过，merge、空提交、拆分、多 resolution、mode 漂移和错误后恢复均失败。

## 晋级规则

TASK-0054 必须 ACCEPTED，仓库必须空闲，且本卡是执行顺序中首个可晋级任务。

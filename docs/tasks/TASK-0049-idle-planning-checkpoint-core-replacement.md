# TASK-0049：Idle planning checkpoint 核心父边校验最终替代

```yaml
taskId: TASK-0049
state: SUPERSEDED
planningResolution:
  state: SUPERSEDED
  reason: TASK-0048 已执行态 REJECTED，原依赖链不可晋级；由 TASK-0055 依赖 ACCEPTED 的 TASK-0054 承接相同 idle checkpoint 核心范围。
  decidedBy: repository-owner
  decidedAt: "2026-07-31"
  replacementTask: TASK-0055
owner: repository-owner
planningBacklog: .harness/task-backlog.yaml
planningContractHash: f884630114eb6a4fe59ccbbacdb457ff59c64446c8cc5d1d882cfafe1b12f0f5
planningContractHashAlgorithm: SHA256_CANONICAL_JSON_V1
```

> 规划正文仅为非规范的人类可读渲染；唯一机器真源是 `.harness/task-backlog.yaml` 中本 Task ID 的静态合同，并由 `planningContractHash` 完整绑定。

## 目标

承接 TASK-0043，建立 idle planning checkpoint 的唯一 Git parent-edge 派生与失败关闭核心，不接入执行消费者。

## 范围内

- 校验单父、非空、原子 planning-only resolution 边、可选 nextAction、100644 mode 与错误后恢复；
- 覆盖合法串行 resolution 和无可晋级状态的正负矩阵。

## 明确禁止

- 建立第二状态机或第二 Backlog；
- 接入四个执行消费者，或重做 TASK-0048 已修复的 baseline fixture。

## 依赖与决策闸门

- 依赖：standalone TASK-0048；
- 无新增硬决策闸门。

## 验收

- checkpoint 只从 canonical terminal 后的 Git parent history 派生；
- 合法边通过，merge、空提交、拆分、多 resolution、mode 漂移和错误后恢复均失败。

## 晋级规则

TASK-0048 必须 ACCEPTED，仓库必须空闲，且本卡是执行顺序中首个可晋级任务。

# TASK-0052：Harness 路径感知 CI 与包装器平台策略最终替代

```yaml
taskId: TASK-0052
state: PLANNED
owner: repository-owner
planningBacklog: .harness/task-backlog.yaml
planningContractHash: acc1d889d7fad17585688a12914ba3826389886017d77c7cb282bd3d4ce96e1d
planningContractHashAlgorithm: SHA256_CANONICAL_JSON_V1
```

> 规划正文仅为非规范的人类可读渲染；唯一机器真源是 `.harness/task-backlog.yaml` 中本 Task ID 的静态合同，并由 `planningContractHash` 完整绑定。

## 目标

承接 TASK-0046，让 CI 始终产生确定终态并失败关闭地选择 smoke 与参考平台全量验证。

## 范围内

- workflow 始终触发、job 内分类与未知路径全量回退；
- Ubuntu exact-SHA 全量、Windows/macOS wrapper smoke 与确定升级矩阵。

## 明确禁止

- trigger paths 造成 required check pending；
- smoke 冒充全量 PASS 或未知路径静默跳过。

## 依赖与决策闸门

- 依赖：TASK-0051；
- 无新增硬决策闸门。

## 验收

- 所有受治理提交得到可判定终态；
- 平台职责、失败回退和升级矩阵由机器测试约束。

## 晋级规则

TASK-0051 必须 ACCEPTED，仓库必须空闲，且本卡是执行顺序中首个可晋级任务。

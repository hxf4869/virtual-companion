# TASK-0059：Harness 内容寻址快照复用与 Evidence 门禁

```yaml
taskId: TASK-0059
state: PLANNED
owner: repository-owner
planningBacklog: .harness/task-backlog.yaml
planningContractHash: 95a3b7ae41bf571979ddf35097e3e28be20a6d0de8f4e409550524d812d7a68b
planningContractHashAlgorithm: SHA256_CANONICAL_JSON_V1
```

> 规划正文仅为非规范的人类可读渲染；唯一机器真源是 `.harness/task-backlog.yaml` 中本 Task ID 的静态合同，并由 `planningContractHash` 完整绑定。

## 目标

以完整输入身份和可审计 receipt 约束同一调度上下文内的结果复用。

## 范围内

- 完整 manifest、内容寻址 receipt 与 Evidence 命中门禁；
- pre-closure/真实 HEAD 分离及当前实现 exact-SHA CI。

## 明确禁止

- 跨 SHA 或跨调度上下文复用终态结果；
- 缺失输入以及 FAIL、TIMEOUT、CANCELLED、NOT_RUN 或 UNKNOWN 结果命中 receipt。

## 依赖与决策闸门

- 依赖：TASK-0058；
- 无新增硬决策闸门。

## 验收

- receipt 严格绑定完整 manifest，未知输入失败关闭；
- Evidence 可审计且 exact-SHA CI 对当前实现真实运行。

## 晋级规则

TASK-0058 必须 ACCEPTED，仓库必须空闲，且本卡是执行顺序中首个可晋级任务。

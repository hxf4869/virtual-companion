# TASK-0014：授权快照与 Execution Authorization Guard

```yaml
taskId: TASK-0014
state: PLANNED
owner: repository-owner
planningBacklog: .harness/task-backlog.yaml
planningContractHash: c1e3d20ee5ba7ec7fc61d8b5a8bffbc627b2dcbfcc683760a7c866f06a10ddb0
planningContractHashAlgorithm: SHA256_CANONICAL_JSON_V1
```

> 规划正文仅为非规范的人类可读渲染；唯一机器真源是 `.harness/task-backlog.yaml` 中本 Task ID 的静态合同，并由 `planningContractHash` 完整绑定。

## 目标

实现请求时与执行时授权快照及统一外发 Guard，撤销或收窄后零外发。

## 范围内

- requested 与 execution authorization snapshot 领域模型；
- Provider、区域、合同、用途和数据类别执行前复核。

## 明确禁止

- 复用已撤销授权执行待处理工作；
- Guard 失败后降级为真实外发；
- 提前接入真实 Provider 或身份供应商。

## 依赖与决策闸门

- 依赖：TASK-0013；
- 无独立硬决策闸门。

## 验收

- 所有外部 attempt 路径强制绑定双快照；
- 撤销、收窄、区域或合同失效均取消并释放额度。

## 晋级规则

只有 TASK-0013 已 ACCEPTED、仓库空闲且本卡是 Backlog 中首个可晋级任务时，才能基于最新 main 创建唯一 DRAFT。

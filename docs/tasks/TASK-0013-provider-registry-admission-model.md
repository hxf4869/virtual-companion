# TASK-0013：Provider Registry 与供应商中立准入模型

```yaml
taskId: TASK-0013
state: PLANNED
owner: repository-owner
planningBacklog: .harness/task-backlog.yaml
planningContractHash: 7a05b2bdb8e3a0bec89b8e8a6a14fa59b803ef29ccb63e5a2e0a2d3398cf67d1
planningContractHashAlgorithm: SHA256_CANONICAL_JSON_V1
```

> 规划正文仅为非规范的人类可读渲染；唯一机器真源是 `.harness/task-backlog.yaml` 中本 Task ID 的静态合同，并由 `planningContractHash` 完整绑定。

## 目标

建立供应商中立的 Provider、协议、部署、区域、合同与能力准入模型，不接真实供应商。

## 范围内

- Provider Registry 核心端口、准入状态和不可变部署标识；
- Fake、Failure 与离线协议 Adapter 的登记边界。

## 明确禁止

- 猜测默认供应商、模型、区域或合同；
- 把 Adapter 配置当作业务真源，或让业务层依赖供应商 SDK、模型名或 Key；
- 读取真实凭据或访问真实供应商。

## 依赖与决策闸门

- 依赖：TASK-0012；
- 无独立硬决策闸门。

## 验收

- 供应商中立登记、禁用和能力匹配均有失败关闭测试；
- 业务模块不依赖供应商专属类型。

## 晋级规则

只有 TASK-0012 已 ACCEPTED、仓库空闲且本卡是 Backlog 中首个可晋级任务时，才能补齐当时最新 main 的动态证据并成为唯一 DRAFT。

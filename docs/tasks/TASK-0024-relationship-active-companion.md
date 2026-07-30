# TASK-0024：Relationship 与唯一活跃 Companion

```yaml
taskId: TASK-0024
state: PLANNED
owner: repository-owner
planningBacklog: .harness/task-backlog.yaml
planningContractHash: 2a0256e62e24d35d443b1a3237f7241d6de92429a1ff36fd3e62792f04f05a63
planningContractHashAlgorithm: SHA256_CANONICAL_JSON_V1
```

> 规划正文仅为非规范的人类可读渲染；唯一机器真源是 `.harness/task-backlog.yaml` 中本 Task ID 的静态合同，并由 `planningContractHash` 完整绑定。

## 目标

实现 Relationship 所有权和每个用户唯一活跃 Companion 的 Alpha 约束。

## 范围内

- Relationship 生命周期与 `activeCompanionLimit=1`；
- 复合所有权数据库和 API 契约。

## 明确禁止

- 多角色、多活跃 Companion 和恋爱模式；
- 跨 Owner 关系引用；
- 绕过唯一活跃 Companion 约束。

## 依赖与决策闸门

- 依赖：TASK-0015、TASK-0023；
- 无独立硬决策闸门。

## 验收

- 并发创建仍最多一个活跃 Companion；
- 越权查询统一 `NOT_FOUND_OR_FORBIDDEN`。

## 晋级规则

全部依赖 ACCEPTED、仓库空闲且执行顺序允许时，才创建唯一 DRAFT。

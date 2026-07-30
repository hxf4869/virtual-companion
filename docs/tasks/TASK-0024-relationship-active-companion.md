# TASK-0024：Relationship 与唯一活跃 Companion

```yaml
taskId: TASK-0024
state: PLANNED
owner: repository-owner
planningBacklog: .harness/task-backlog.yaml
planningContractHash: 5dbf4a7213a17af93b8459b5f30dd03cfdef4f924892790284a72141cf0ac5c7
planningContractHashAlgorithm: SHA256_CANONICAL_JSON_V1
```

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

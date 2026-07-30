# TASK-0029：跨会话召回、Context 注入与删除墓碑

```yaml
taskId: TASK-0029
state: PLANNED
owner: repository-owner
planningBacklog: .harness/task-backlog.yaml
planningContractHash: 7adf92848326d3340b6b5d3de8923c6cfbff13ad9b84541c7d1b160391488802
planningContractHashAlgorithm: SHA256_CANONICAL_JSON_V1
```

## 目标

实现跨 Conversation 召回、ContextPlan 注入和删除墓碑过滤。

## 范围内

- RELATIONSHIP 作用域召回、来源和预算；
- tombstone、重建索引和删除传播。

## 明确禁止

- 未确认候选召回；
- 删除数据通过向量或缓存复活；
- 召回绕过 ContextPlan 来源、预算或所有权。

## 依赖与决策闸门

- 依赖：TASK-0019、TASK-0028；
- 无独立硬决策闸门。

## 验收

- 删除前后召回、墓碑和索引重建具有确定性测试；
- 跨会话只注入当前 Owner/Relationship 的已确认记忆。

## 晋级规则

全部依赖 ACCEPTED 且执行顺序允许时，才创建唯一 DRAFT 并锁定当时适用的 Memory Skill 与测试。

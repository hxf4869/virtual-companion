# TASK-0027：Canonical Memory 持久化与所有权隔离

```yaml
taskId: TASK-0027
state: PLANNED
owner: repository-owner
planningBacklog: .harness/task-backlog.yaml
planningContractHash: 1dbb31ed0f2b244d6b2b0ae13a753f7b2a43fd809eab052b804cc6176b3db27f
planningContractHashAlgorithm: SHA256_CANONICAL_JSON_V1
```

> 规划正文仅为非规范的人类可读渲染；唯一机器真源是 `.harness/task-backlog.yaml` 中本 Task ID 的静态合同，并由 `planningContractHash` 完整绑定。

## 目标

建立 PostgreSQL Canonical Memory、证据来源、作用域和复合所有权隔离。

## 范围内

- SESSION 与 RELATIONSHIP Memory 持久模型；
- FORCE RLS、证据链和删除状态。

## 明确禁止

- 模型输出直接写 Canonical Memory；
- 跨 Relationship 读取或引用；
- 在 Alpha 启用 ACCOUNT_PRIVATE 或 ACCOUNT_SHARED。

## 依赖与决策闸门

- 依赖：TASK-0016、TASK-0024；
- 无独立硬决策闸门。

## 验收

- Canonical Memory 只有确认路径可创建有效记录；
- 跨用户、跨关系和缺上下文均失败关闭。

## 晋级规则

全部依赖 ACCEPTED 后，按 Backlog 顺序创建唯一 DRAFT，并在该时点锁定数据库与 Memory Skill 证据。

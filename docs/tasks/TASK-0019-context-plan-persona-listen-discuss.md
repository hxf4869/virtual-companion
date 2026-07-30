# TASK-0019：ContextPlan、人格结构、LISTEN/DISCUSS

```yaml
taskId: TASK-0019
state: PLANNED
owner: repository-owner
planningBacklog: .harness/task-backlog.yaml
planningContractHash: 132d657b747110f1d6326db938081e6c8c6a8bce4b193767e7cad6a2facf5189
planningContractHashAlgorithm: SHA256_CANONICAL_JSON_V1
```

## 目标

建立供应商中立 ContextPlan、结构化人格和 LISTEN/DISCUSS 交互意图。

## 范围内

- ContextPlan 结构、来源标记和预算；
- gentle-listener 人格骨架及 LISTEN/DISCUSS 确定性选择。

## 明确禁止

- 把 Provider session 当作记忆真源；
- 模型输出直接成为 Canonical Memory；
- 在本任务猜测最终真实 Persona 内容。

## 依赖与决策闸门

- 依赖：TASK-0013、TASK-0017；
- 无独立硬决策闸门。

## 验收

- Context 顺序、预算、来源和模式选择可确定性复测；
- 人格结构不包含供应商专属字段。

## 晋级规则

全部依赖 ACCEPTED 且 Backlog 顺序允许时，才创建唯一 DRAFT；具体依赖与精确命令在该时点锁定。

# TASK-0028：记忆候选、确认、修改、删除与来源 API

```yaml
taskId: TASK-0028
state: PLANNED
owner: repository-owner
planningBacklog: .harness/task-backlog.yaml
planningContractHash: 2115f609477ab4c79e1e08e209213a88f3dec3b54566fab7ef2ee140b4904647
planningContractHashAlgorithm: SHA256_CANONICAL_JSON_V1
```

## 目标

提供记忆候选、用户确认、修改、删除和来源追溯 API。

## 范围内

- 候选生命周期、确认门禁和来源 Evidence；
- 用户编辑、删除和幂等 API。

## 明确禁止

- 无确认自动写入；
- 安全失败的候选进入 Canonical Memory；
- 删除后仍作为有效记忆返回。

## 依赖与决策闸门

- 依赖：TASK-0020、TASK-0025、TASK-0027；
- 无独立硬决策闸门。

## 验收

- 所有模型提取候选必须明确确认；
- 确认、修改、删除、重复请求和越权均有合同测试。

## 晋级规则

全部依赖 ACCEPTED、仓库空闲且本卡为首个可晋级项时，才补齐动态 Context、命令和 Skill 版本。

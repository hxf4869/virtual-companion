# TASK-0018：Finalization、Usage/Quota 结算与 Outbox 原子事务

```yaml
taskId: TASK-0018
state: PLANNED
owner: repository-owner
planningBacklog: .harness/task-backlog.yaml
planningContractHash: fe1901c3b514fd380e84f9018825e2b7c25f6fe00e03c31124062167716e953e
planningContractHashAlgorithm: SHA256_CANONICAL_JSON_V1
```

## 目标

在单一事务中完成最终消息、安全结果、Generation 终态、Usage/Quota、事件与 Outbox。

## 范围内

- `finalize_generation` 事务和唯一最终消息；
- Usage/Quota 结算或释放及持久 Outbox。

## 明确禁止

- commit 前发布 `chat.completed`；
- 持久化重试触发第二次模型调用；
- 把 Provider EOS 当作 Generation 完成。

## 依赖与决策闸门

- 依赖：TASK-0014、TASK-0016、TASK-0017；
- 无独立硬决策闸门。

## 验收

- 故障注入证明原子提交或完整回滚；
- Provider EOS 绝不直接完成 Generation。

## 晋级规则

全部依赖 ACCEPTED 且本卡成为首个可晋级任务后，才可在唯一 DRAFT 中绑定事务测试命令与 Context。

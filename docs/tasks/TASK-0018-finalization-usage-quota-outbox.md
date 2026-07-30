# TASK-0018：Finalization、Usage/Quota 结算与 Outbox 原子事务

```yaml
taskId: TASK-0018
state: PLANNED
owner: repository-owner
planningBacklog: .harness/task-backlog.yaml
planningContractHash: 296e3fb92db63612d4b681c1023e94b1db0d9bdab8f6164bb6ef08e3527a9877
planningContractHashAlgorithm: SHA256_CANONICAL_JSON_V1
```

> 规划正文仅为非规范的人类可读渲染；唯一机器真源是 `.harness/task-backlog.yaml` 中本 Task ID 的静态合同，并由 `planningContractHash` 完整绑定。

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

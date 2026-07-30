# TASK-0016：Worker Claim、Lease、Fence 与过期写拒绝

```yaml
taskId: TASK-0016
state: PLANNED
owner: repository-owner
planningBacklog: .harness/task-backlog.yaml
planningContractHash: 40097ebafaa371789f84e3dfbf16bc3b26b51f6e0a8bbe218928717d59b2afa4
planningContractHashAlgorithm: SHA256_CANONICAL_JSON_V1
```

## 目标

实现不透明 Claim、Lease、Fence、`SET LOCAL` 租户上下文和所有迟到写拒绝。

## 范围内

- `claim_work_items` 与 `app_begin_job_context`；
- 续租、完成、失败、取消和 stale fence 拒绝。

## 明确禁止

- Worker 跨租户扫描；
- 外部队列成为租户授权边界；
- 迟到 Worker 写结果、Usage、消息、事件或记忆任务。

## 依赖与决策闸门

- 依赖：TASK-0015；
- 无独立硬决策闸门。

## 验收

- 过期 lease、错误 token、旧 fence 和缺失上下文均零写入；
- 协调器只读取不透明任务元数据。

## 晋级规则

只有 TASK-0015 已 ACCEPTED 且数据库测试资源能在 DRAFT 动态锁定时，才可按 Backlog 顺序晋级。

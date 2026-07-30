# TASK-0021：持久化 Fetch-SSE、续传、Gap/Reset/Snapshot

```yaml
taskId: TASK-0021
state: PLANNED
owner: repository-owner
planningBacklog: .harness/task-backlog.yaml
planningContractHash: ebf3ddec0b8605f0322ce1f72ccb0423a41eb5bc133caab5b60e1f5f1f4543f6
planningContractHashAlgorithm: SHA256_CANONICAL_JSON_V1
```

## 目标

以 PostgreSQL 持久事件支撑 Fetch-SSE、续传、Gap、Reset 和 Snapshot 恢复。

## 范围内

- 短期单次 Ticket、epoch、eventSeq 和 Last-Event-ID；
- terminal snapshot、gap/reset 和连续 cursor。

## 明确禁止

- WebSocket；
- 长期凭据进入 URL、query 或实时参数；
- 客户端伪造缺失 delta，或发布未提交终态事件。

## 依赖与决策闸门

- 依赖：TASK-0018、TASK-0020；
- 无独立硬决策闸门。

## 验收

- 断线、过期窗口、epoch 变化和越权恢复均有合同测试；
- 客户端只推进最后连续序号。

## 晋级规则

全部依赖 ACCEPTED 且执行顺序允许时，才可基于最新 main 创建唯一 DRAFT。

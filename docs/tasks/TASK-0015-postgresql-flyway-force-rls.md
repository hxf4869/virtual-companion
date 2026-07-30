# TASK-0015：PostgreSQL、Flyway、复合所有权和 FORCE RLS

```yaml
taskId: TASK-0015
state: PLANNED
owner: repository-owner
planningBacklog: .harness/task-backlog.yaml
planningContractHash: e59dffb6b7f4f2ea52f2a67113ae266b58c8ee01f293d67099a02540adb94bb4
planningContractHashAlgorithm: SHA256_CANONICAL_JSON_V1
```

> 规划正文仅为非规范的人类可读渲染；唯一机器真源是 `.harness/task-backlog.yaml` 中本 Task ID 的静态合同，并由 `planningContractHash` 完整绑定。

## 目标

建立 PostgreSQL 18、Flyway、复合所有权外键、最小权限角色和 FORCE RLS 基线。

## 范围内

- 用户域核心表、授权快照和 Provider Registry 持久化骨架；
- `owner_user_id` 复合约束、FORCE RLS 和跨租户失败测试。

## 明确禁止

- API 或 Worker 使用 BYPASSRLS；
- 连接或修改现有 MySQL、Redis、RabbitMQ、Kingbase；
- 保存真实数据、凭据或长期测试资源。

## 依赖与决策闸门

- 依赖：TASK-0014；
- 无独立硬决策闸门。

## 验收

- 跨用户、跨关系、跨会话和缺上下文访问失败关闭；
- 一次性 PostgreSQL 18/pgvector 容器仅使用合成数据、临时端口和临时卷，并完整清理。

## 晋级规则

TASK-0014 ACCEPTED 后，晋级 DRAFT 时才动态锁定镜像版本、摘要、端口、卷和清理命令；PLANNED 阶段不冻结这些值。

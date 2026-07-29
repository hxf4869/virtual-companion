# ADR-0002：持久化与接口采用显式契约优先

- 状态：Proposed
- 日期：2026-07-29
- 决策范围：首个业务纵切

## 提议

- 持久层优先采用 Spring JDBC/JdbcClient、显式 SQL 和 Flyway，不在首个纵切引入重型 ORM。
- PostgreSQL 18 与 pgvector 0.8.5 按机器真源接入，但 TASK-0001 不启动数据库。
- HTTP API 以 `specs/openapi/*.yaml` 为契约，生成 Java 接口和 TypeScript Client；实现代码不得反向覆盖契约。
- API 与 Worker 分进程后，以 PostgreSQL 持久事件中继支撑 SSE 恢复，不依赖单进程内存事件总线。

## 接受条件

本 ADR 在首个数据库/API READY 任务中补齐以下内容后才能改为 Accepted：

1. Migration、RLS Policy、复合所有权约束和最小权限角色；
2. Generation 最终化事务及 Outbox 的故障注入测试；
3. Worker Claim、Lease、Fence 与过期写入拒绝测试；
4. OpenAPI 生成和漂移检查；
5. 持久事件 Gap、Reset、Snapshot 的契约测试。

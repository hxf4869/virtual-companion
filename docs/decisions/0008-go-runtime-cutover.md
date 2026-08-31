# ADR-0008：Go runtime 切流并下线 Java 应用

- 状态：Accepted
- 日期：2026-08-30

## 决策

默认部署和持续集成只构建、测试并运行 Go `companiond`。Java/Spring Boot 应用停止，
不再接收流量，也不再作为运行时回滚路径。模型供应商、模型发现和全局路由由
ADMIN 页面及 Go API 管理，凭据加密存入 PostgreSQL。

Compose 的常驻服务为 PostgreSQL、MinIO、Caddy 和 `companiond full`。SQL 迁移与
Go bootstrap 是启动前一次性任务，migrator 凭据不进入常驻 runtime。

## 切流记录

- 切流前数据库已生成私有 `pg_dump` 备份；
- V119 已成功应用，旧迁移历史已导入 Go migrator 的 `vc_schema_history`；
- Java runtime 停止后，Go runtime 获得单实例 lease 并通过 readiness；
- 真实环境 health、version、opaque login、ADMIN provider list 均返回 200；
- 常驻 runtime 入口为 `/usr/local/bin/companiond`，无 Java/JAR/Spring 进程。

## 遗留处理

SQL migration 真源已迁至 `backend/internal/migrate/sql/`，由 `companiond migrate`
嵌入执行。旧后端源码、构建包装器、生成物、部署与演练脚本均已删除；数据库升级、
RLS 验证和空库初始化继续使用同一组 V1–V119 SQL。

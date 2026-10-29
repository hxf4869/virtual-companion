# 技术基线

## 当前锁定

| 层 | 基线 | 机器真源 |
| --- | --- | --- |
| 后端 | Go 1.26.7，单体 `companiond` | `backend/go.mod` |
| 数据库 | PostgreSQL 18 + pgvector 0.8.5 | `ops/deploy/docker-compose.yml` |
| 数据访问 | pgx/v5，短事务 + RLS | `backend/internal/store/postgres/` |
| 迁移 | `companiond migrate`，嵌入式顺序迁移，当前版本以目录为真源 | `backend/internal/migrate/` |
| 前台 | SillyTavern 宿主 + 扩展 | `integrations/sillytavern/` |
| Node.js | 22.13+（ST 集成单测与受管宿主） | `integrations/sillytavern/README.md` |
| 部署 | Go image + PostgreSQL + MinIO + Caddy | `ops/deploy/` |

Major 版本升级必须同时更新机器真源、契约、构建镜像和相关测试。叙述性文档与
机器真源冲突时，以代码、锁文件、Catalog 和 Compose 为准。

## 本机构建

```bash
# 唯一日常入口
bash scripts/check.sh

# 后端离线验证
GOPROXY=off go test -C backend -mod=vendor -count=1 ./...

# ST 集成离线单测
node --test "integrations/sillytavern/tests/*.test.mjs"

# 数据库/RLS
bash infra/db/run-rls-tests.sh
```

Windows 可使用 `scripts/dev/start-backend.ps1` 启动 Go 后端；部署与隔离数据库验证
统一使用 OrbStack/Docker Compose。

## 依赖边界

- 后端生产依赖只由 `backend/go.mod` 与 `backend/vendor/` 管理；
- Catalog 生成 TypeScript、OpenAPI schema 和 SQL 参考数据，不生成后端语言源码；
- OpenAPI 生成器只生成 bundle 与审计 snapshot；
- 模型供应商、模型和路由通过管理员页面与 Go API 管理，凭据加密存入 PostgreSQL；
- 商业软件与付费 SaaS 不得成为正确运行的核心前置条件。

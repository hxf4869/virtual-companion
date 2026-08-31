# Virtual Companion

AI 虚拟陪伴系统的 Technical Alpha 单体仓库。当前后端运行时为 Go 1.26.7
`companiond`，前端为 uni-app + Vue 3 + TypeScript，数据层为 PostgreSQL 18 +
pgvector。Generation、Realtime、Memory、数据权利与管理员模型配置已接入 Go
runtime；项目尚未达到真实用户或公开生产发布条件。

## 快速开始

```bash
# 日常检查：契约/生成物、Go 单测、前端测试与类型检查
bash scripts/check.sh

# 启动真实本地栈
cp ops/deploy/.env.example ops/deploy/.env.local
# 填写 ops/deploy/.env.local，真实 Secret 不入库
pnpm --dir frontend install --frozen-lockfile
pnpm --dir frontend build
cd ops/deploy
docker compose --env-file .env.local up -d --build
```

部署、证书与验证步骤见 [`ops/deploy/README.md`](ops/deploy/README.md)，
Owner-only 联调见 [`ops/deploy/DOGFOOD.md`](ops/deploy/DOGFOOD.md)。

## 当前架构

- `backend/`：Go `companiond`，包含配置、opaque cookie auth、CSRF/Origin、
  PostgreSQL/RLS store、三类模型协议适配器、generation worker、Realtime SSE、
  Memory/Consent/Report/Export 和管理员 provider/model routing；
- `frontend/`：uni-app H5，Vue 3 + TypeScript + Pinia；
- `backend/internal/migrate/sql/`：嵌入式顺序迁移真源，当前版本以该目录为准，由 `companiond migrate` 执行；
- `ops/deploy/`：Go-only Compose、Caddy、数据库/bootstrap 与 MinIO；
- `specs/`：Catalog、OpenAPI 与关键协议契约；
- `infra/db/`：迁移、RLS、最小权限与升级验证。

默认 Compose 常驻进程只有 `companiond`、PostgreSQL、MinIO 和 Caddy。
`migrate` 与 `bootstrap` 是同一 Go 镜像的一次性启动任务。仓库不再包含旧后端源码、
构建工具或运行脚本。

## Go runtime 能力

公开探针：

- `GET /actuator/health`
- `GET /actuator/health/liveness`
- `GET /actuator/health/readiness`
- `GET /api/v1/version`

登录后主要 API：

- opaque session：登录、登出、会话列表/撤销、改密、reauth、账号删除；
- relationship、conversation、message CRUD；
- consent、memory candidate/确认/拒绝/证据；
- report 与异步 export；
- generation intake/cancel、worker、SSE snapshot/delta/completed；
- ADMIN-only provider/model 配置、模型发现和全局路由排序。

Go v1 的明确范围与退役接口见
[`specs/catalog/go-v1-api-scope.yaml`](specs/catalog/go-v1-api-scope.yaml)。

## 页面配置模型

管理员登录后进入“管理 → 模型供应商”，可完成：

1. 新增 OpenAI Chat Completions、OpenAI Responses 或 Anthropic Messages 供应商；
2. 保存 Base URL 与 API Key；
3. 发现/维护模型；
4. 启用模型并调整全局主备路由顺序。

API Key 使用 `VC_CRYPTO_REST_KEY` 加密落库，读取接口不会返回明文。默认部署只通过
管理员页面和 Go API 配置模型。

## 开发与验证

```bash
# Go 后端（vendor 离线依赖）
GOPROXY=off go test -C backend -mod=vendor -count=1 ./...

# 前端
pnpm --dir frontend test:run
pnpm --dir frontend type-check
pnpm --dir frontend build

# PostgreSQL 18 + pgvector / RLS
bash infra/db/run-rls-tests.sh
bash infra/db/run-go-store-tests.sh

# Compose 配置
cd ops/deploy
docker compose --env-file .env.local config --quiet
```

## 当前边界

- Technical Alpha 严格单 runtime；PostgreSQL advisory lock 会拒绝第二个活跃实例；
- H5 与 API 只支持同源 HTTPS cookie 会话；
- 真实 provider 调用、费用和数据外发由 Owner 显式配置并自行核验；
- 不支持公开注册、真实支付或未完成合规准备的真实用户 Beta；
- 项目现状与后续项见 [`TODO.md`](TODO.md)，Agent 规则见 [`AGENTS.md`](AGENTS.md)。

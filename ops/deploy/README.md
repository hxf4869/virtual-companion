# Go-only 部署

默认部署只运行 Go `companiond`。常驻拓扑为 PostgreSQL 18 + pgvector、
`companiond`、MinIO 和 Caddy；`migrate` 与 `bootstrap` 是启动前的一次性任务，
成功后退出。旧后端技术链已从仓库与部署中移除。

## 前置条件

- OrbStack/Docker 与 Compose v2；
- Go 版本由 `backend/go.mod` 锁定，前端使用 Node 22 + pnpm 11；
- H5 与 API 使用同一个 `VC_DOMAIN`，由 Caddy 终止 TLS。

## 首次启动

```bash
cp ops/deploy/.env.example ops/deploy/.env.local
# 编辑 .env.local；数据库密码使用 URL-safe 随机值，密钥不要提交。

pnpm --dir frontend install --frozen-lockfile
pnpm --dir frontend build

cd ops/deploy
docker compose --env-file .env.local up -d --build
docker compose --env-file .env.local ps
```

启动顺序固定为：数据库健康 → SQL 迁移 → owner/admin bootstrap → MinIO bucket
初始化 → `companiond` 健康 → Caddy。任一步失败都会阻止后续服务启动。

## 验证

```bash
curl -k "https://$VC_DOMAIN/actuator/health"
curl -k "https://$VC_DOMAIN/api/v1/version"
docker compose --env-file .env.local exec -T runtime \
  wget -qO- http://127.0.0.1:8080/actuator/health
docker top deploy-runtime-1 -eo pid,comm,args
```

健康响应应为 `{"status":"UP"}`，runtime 进程应为
`/usr/local/bin/companiond`，常驻容器只允许这一 Go 后端进程。

局域网 IP/`localhost` 使用 Caddy 本地 CA 时，命令行可用 `curl -k` 做连通性验证；
浏览器页面测试需要设备先信任该 Caddy 根证书，不应绕过浏览器安全告警。

## 模型配置

模型供应商不通过部署 profile、YAML override 或环境变量注入。管理员登录后，
在“管理 → 模型供应商”页面完成：

1. 新增供应商并选择 OpenAI Chat Completions、OpenAI Responses 或 Anthropic Messages；
2. 填写 Base URL 和 API Key；Key 只加密保存，不回显；
3. 发现或手工添加模型；
4. 调整全局模型路由顺序并启用模型。

对应接口为 `GET/PUT /api/v1/admin/providers`、
`POST /api/v1/admin/providers/{providerId}/models/discover` 和
`PUT /api/v1/admin/model-routing-order`，均为 ADMIN-only。

## 数据库与升级

- `vc_migrator` 只供一次性 `migrate`/`bootstrap` 使用；
- `vc_runtime_login` 无 DDL、SUPERUSER 或 BYPASSRLS 权限，只注入常驻 runtime；
- 两个密码必须不同；
- 升级前先备份数据库，确认无 in-flight generation 后再重建服务。

```bash
cd ops/deploy
docker compose --env-file .env.local exec -T db \
  pg_dump -U vc_migrator -d vc -Fc > .local/pre-upgrade.dump
chmod 600 .local/pre-upgrade.dump
docker compose --env-file .env.local up -d --build
```

## 日常命令

```bash
# 查看状态和 Go 日志
docker compose --env-file .env.local ps
docker compose --env-file .env.local logs --tail=200 runtime

# 重建并滚动到最新 Go 镜像
docker compose --env-file .env.local up -d --build runtime caddy

# 停止整套环境（保留 volume）
docker compose --env-file .env.local down
```

不要使用 `down -v`，除非明确要删除数据库、MinIO 与 Caddy 数据。

# Owner-only Go dogfood

本手册只适用于本机/受控局域网的单 Owner 环境。默认 runtime 是 Go
`companiond`；旧后端不再参与构建、迁移后的常驻运行或回滚。

## 1. 准备私有配置

```bash
cp ops/deploy/.env.example ops/deploy/.env.local
chmod 600 ops/deploy/.env.local
```

至少填写：

- `VC_DOMAIN`；
- 两个不同的 URL-safe 数据库密码；
- `VC_OWNER_BINDING_SECRET` 与 `VC_CRYPTO_REST_KEY`；
- 首次登录用的 `VC_ADMIN_SEED_USERNAME` / `VC_ADMIN_SEED_PASSWORD`；
- MinIO access/secret。

推荐命令：数据库密码使用 `openssl rand -hex 32`，两个密钥分别使用
`openssl rand -base64 32`。不要把值粘贴到日志、聊天或仓库。

## 2. 构建并启动

```bash
bash scripts/check.sh
pnpm --dir frontend build

cd ops/deploy
docker compose --env-file .env.local up -d --build
docker compose --env-file .env.local ps
```

首次启动会依次完成 SQL 迁移、owner-binding 校验/初始化和可选管理员种子；
之后只保留数据库、MinIO、Caddy 与 Go runtime 常驻。

## 3. 验证 Go 已接管

```bash
cd ops/deploy
set -a; source .env.local; set +a
curl -k "https://$VC_DOMAIN/actuator/health"
curl -k "https://$VC_DOMAIN/api/v1/version"
docker top deploy-runtime-1 -eo pid,comm,args
docker ps --filter label=com.docker.compose.project=deploy \
  --format '{{.Names}} {{.Image}} {{.Status}}'
```

必须看到 `companiond` 且健康接口为 200；常驻容器只允许 Go 后端进程。

## 4. 浏览器与证书

H5 和 API 都从 `https://$VC_DOMAIN` 访问。局域网 IP 使用 Caddy 本地 CA 时，
需要在测试设备上显式信任 Caddy 根证书；遇到浏览器证书告警时不要绕过。
证书位于 Compose 的 `caddy-data` volume，可按 Caddy 官方方式导出后由 Owner
在受控设备上安装。

## 5. 在页面配置模型

1. 用管理员种子账号登录；
2. 打开“管理 → 模型供应商”；
3. 新增供应商，填写协议、Base URL、API Key；
4. 执行模型发现或手工添加模型；
5. 启用模型并调整全局路由顺序；
6. 回到聊天页做一轮短对话，检查 SSE 完成事件和最终消息。

API Key 仅在保存时提交，服务端使用 `VC_CRYPTO_REST_KEY` 加密存储，列表接口不回显。
本机 HTTP 模型服务仅允许 loopback 地址，并需显式设置
`VC_PROVIDER_ALLOW_LOOPBACK_HTTP=true`；其他环境保持 false。

## 6. 日常观察与停止条件

```bash
docker compose --env-file .env.local logs --tail=200 runtime
docker compose --env-file .env.local exec -T db \
  psql -U vc_migrator -d vc -c 'select version, name, applied_at from vc_schema_history order by version desc limit 3'
```

出现以下任一情况立即停止 dogfood 并保存脱敏日志：

- readiness 非 200 或 runtime 重启循环；
- provider 凭据、对话正文或稳定敏感标识进入日志；
- 跨 Owner 数据可见、RLS/鉴权异常；
- generation 长时间卡在非终态或费用预算异常。

停止但保留数据：

```bash
docker compose --env-file .env.local down
```

不要运行 `down -v`，除非明确决定销毁本地数据库和对象存储。

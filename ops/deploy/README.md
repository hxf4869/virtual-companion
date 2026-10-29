# Go-only 部署

本目录的 Compose 不是 V2 栈。它只运行 Go `companiond`、PostgreSQL 18 + pgvector、
MinIO 和 Caddy，不含 SillyTavern，不含 MemoryCore。V2 只在本机受管栈运行，启动、停止、
日志、备份与恢复见 [`integrations/sillytavern/README.md`](../../integrations/sillytavern/README.md)
「本机运行说明」。远端部署未授权（`TODO.md` 的 `V2-OWNER-DEPLOY`）。

`migrate` 与 `bootstrap` 是这份 Compose 启动前的一次性任务，成功后退出。旧后端技术链已从仓库与部署中移除。
下面的 Compose 命令是这份 Go-only 栈的既有说明；W16-2 没有重跑它们。

## 前置条件

- OrbStack/Docker 与 Compose v2；
- Go 版本由 `backend/go.mod` 锁定；
- API 使用 `VC_DOMAIN`，由 Caddy 终止 TLS。浏览器前台是 SillyTavern 受管宿主，
  见 [`integrations/sillytavern/README.md`](../../integrations/sillytavern/README.md)，不由本 Compose 提供静态页。

## 首次启动

```bash
cp ops/deploy/.env.example ops/deploy/.env.local
# 编辑 .env.local；数据库密码使用 URL-safe 随机值，密钥不要提交。

cd ops/deploy
docker compose --env-file .env.local up -d --build
docker compose --env-file .env.local ps
```

`up --build` 会同时构建三个本地镜像：`companiond`（backend/Dockerfile）、
Caddy 边缘镜像（ops/deploy/Dockerfile.web）与 MinIO 镜像（ops/deploy/minio）。

## MinIO 生产镜像（VC-R54）

上游 `minio/minio` / `minio/mc` 固定 tag 的 OCI 镜像已无法从 registry 拉取
（VC-R19），生产改用 `ops/deploy/minio/Dockerfile` 本地封装：以与
backend/Dockerfile 相同的固定 `alpine:3.23.3` 为基座，从 GitHub Release 资产
按 sha256 固定获取同版本官方静态二进制（minio `RELEASE.2025-09-07T16-13-09Z`、
mc `RELEASE.2025-08-13T08-35-41Z`，arm64/amd64 各两份校验值，与 E2E 用的
`scripts/dev/Dockerfile.e2e-minio-tools` 完全一致）。同一镜像通过入口分发脚本
同时充当 `minio` server 与 `minio-init` 初始化容器；`docker compose build minio`
即可单独重建。

与旧上游镜像的差异与保留项：

- 相同二进制的新封装，**不是**旧 OCI digest 的复现；镜像内容改为 alpine +
  官方二进制 + 两个入口脚本。
- 沿用旧官方镜像的默认 root 运行，避免既有 `minio-data` 卷发生 UID 迁移；
  数据卷仍由 compose 显式挂载，镜像内不声明 VOLUME。
- 基座无 curl，minio 健康检查改用 BusyBox `wget` 探测同一
  `/minio/health/live` 端点，语义不变。
- `minio-init` 不再用 `mc alias set`（root secret 曾出现在 argv）：凭据从
  环境读取，经 BusyBox awk 正确转义（引号、反斜杠、换行等控制字符）写入
  compose 挂载的私有 tmpfs（`MC_CONFIG_DIR=/mc-config`，目录 0700、
  config.json 0600）中的 mc config v10 JSON，不出现在 argv、镜像层或日志；
  桶创建与"禁止匿名访问"校验语义保持不变。
- 构建时需要能访问 github.com 下载两份二进制；构建后离线可用。

2026-10-22 实际验证范围：linux/arm64 本机真实构建、`minio/mc --version`
核对既定版本、全新隔离 fixture 全链启动（DB→migrate→bootstrap→MinIO
init→Go runtime→Caddy，HTTPS 经 Caddy 本地 CA 真实证书链验证）；linux/amd64
同 Dockerfile 真实构建并在 OrbStack Rosetta 下执行两份 `--version`。未运行
的场景：amd64 生产部署、多节点与真实外部存储。MinIO 上游归档后的维护与
长期存储选型仍为 Owner 待决事项，不因本封装自动关闭。


启动顺序固定为：数据库健康 → SQL 迁移 → owner/admin bootstrap → MinIO bucket
初始化 → `companiond` 健康 → Caddy。任一步失败都会阻止后续服务启动。

## Caddy 边缘镜像重编

`ops/deploy/Dockerfile.web` 不直接使用上游 runtime 基底镜像内的 Caddy 二进制：
build 阶段以 digest 固定的 `golang:1.26.10-alpine3.23`，按官方 xcaddy 无插件
模板（`ops/deploy/caddy-build`：Caddy v2.11.7 标准模块 + `time/tzdata`）重编
`/usr/bin/caddy`（`CGO_ENABLED=0`、`-trimpath`、`-tags=nobadger,nomysql,nopgx`），
并把 `golang.org/x/net` 固定到 `v0.60.0`——这是相对 Caddy v2.11.7 自身
go.mod（v0.59.0）的唯一依赖版本变化，其余版本不变。final 阶段仍基于已验证
digest 的 `caddy:2.11.7` 基底，只替换该二进制，并用基底自带的 `setcap` 恢复
原有 `cap_net_bind_service=+ep`。首次构建需要访问 Go module proxy 下载依赖
并通过 go.sum 校验，之后可复用 BuildKit 缓存。

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
在 SillyTavern 受管宿主的模型页完成（Go API 仍是目录权威）：

1. 新增供应商并选择 OpenAI Chat Completions、OpenAI Responses 或 Anthropic Messages；
2. 填写 Base URL 和 API Key；Key 只加密保存，不回显；
3. 发现或手工添加模型；
4. 调整全局模型路由顺序并启用模型。

对应接口为 `GET/PUT /api/v1/admin/providers`、
`POST /api/v1/admin/providers/{providerId}/models/discover` 和
`PUT /api/v1/admin/model-routing-order`，均为 ADMIN-only。

### 模型成本准入

聊天生成和自动记忆提取共用一个原子维护的本地月度成本准入额度。启动配置
`VC_BUDGET_MAX_RESERVED_COST`（每次模型请求的保守预留上限）与
`VC_MONTHLY_COST_LIMIT`（全局月度上限）均以 **micro-USD** 表示，
1 USD = 1,000,000 micro-USD。默认 0 表示未配置：应用仍可启动和管理数据，
但不会发送模型请求。限额必须为正，且单次上限不得超过月度上限。

外发还要求 `vc.model_unit_price` 存在当前启用、已生效、精确匹配
`provider_id` 与 `model_id` 的价格。由有权维护数据库的管理员录入经核对的
`input_usd_per_1k`、`output_usd_per_1k`（USD / 1,000 tokens），更新价格时新增
递增的 `price_version`；不使用 `*` 模型兜底，也不把未知价格当作免费。
这些价格与限额配置不等于授权真实供应商外发。

每次请求外发前预留完整单次上限，且配置的 token 预算按当前价格计算后须能
容纳在该上限内。每条 reservation 冻结价格版本与原始月份；正常结果按真实
usage 结算并释放未用余额，明确未发送时释放全部，取消、崩溃或结果未知时
按预留上限结算。已发出的请求若供应商报告超出预估的真实费用，会如实记账，
后续请求将被月度额度拒绝；不要把单次上限配置得低于供应商的实际计价上界。
本地合成测试使用显式的合成正价格和独立额度，不复用真实账单数据。

## 数据库与升级

本节只针对上面的 Go-only Compose。V2 受管栈没有单独的升级命令；改 `upstream.lock.json` 后重装配的步骤见集成 README，且该步骤本轮未执行。

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

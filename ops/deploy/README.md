# DEPLOY 生产部署拓扑（§14.6 / R47）

Compose 三件套：**PostgreSQL 18 + pgvector**（内网、无宿主端口）、
**runtime jar**（production profile，fail-closed 全开）、**Caddy 边缘**
（自动 HTTPS + H5 静态包 + API/SSE 反代）。密钥只从部署 `.env` 注入。

## 前置

1. 服务器：Docker + Compose v2；域名 DNS 已指向服务器；
2. **境内合规提醒**：域名备案、生成式 AI 相关类目/算法材料在对外开放前完成
   （§21.7/§21.8——H5 不是合规绕行方式）；
3. 本机构建产物：`./mvnw verify`（JDK 25）产出 runtime jar；
   `pnpm --dir frontend build` 产出 H5 dist。

## 步骤

```bash
# 0) 构建（本机或 CI 产物随仓库走）
export JAVA_HOME="$(brew --prefix openjdk@25)/libexec/openjdk.jdk/Contents/Home"
./mvnw --batch-mode --no-transfer-progress verify
pnpm --dir frontend build

# 1) 配置
cp ops/deploy/.env.example ops/deploy/.env   # 逐项填写;三个密钥用 openssl rand -base64 32
#    VC_DOMAIN 必须是真实域名(或 localhost 用于本机演练)

# 2) 起服务(在 ops/deploy 下)
docker compose up -d --build

# 3) 验证
curl -s https://"$VC_DOMAIN"/actuator/health          # {"status":"UP",...}
curl -sI https://"$VC_DOMAIN"/ | head -1              # 200,H5 壳
```

## 冒烟演练（本机即可,无需域名）

`bash ops/deploy/smoke-drill.sh`：构建镜像 → 断言 production profile 在缺
`VC_CRYPTO_REST_KEY` 时拒绝启动(fail-closed 实弹) → 注入完整密钥起全栈 →
健康检查 + H5 壳 + API 探针 → 清理。演练记录归档到
`docs/beta-readiness/records/`。

## 上线后

- 备份：接入 `infra/db/backup/run-backup-drill.sh` 同款策略（见其 README）；
- 告警：`.env` 里配 `VC_ALERT_WEBHOOK_URL`（分级见 docs/beta-readiness/07）;
- 数据保留：Owner/法务复核草案周期后将 `VC_RETENTION_PURGE_ENABLED=true`。

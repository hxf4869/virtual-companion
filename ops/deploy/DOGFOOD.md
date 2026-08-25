# DOGFOOD — Owner-only 本地 7 天 Dogfood 运行手册（ADR-0006）

依据 `docs/decisions/0006-owner-only-local-dogfood-boundary.md`（§1 运行边界、§3 canary
口径）：服务只运行在 Owner 的 Mac 单实例上，H5 与 API 按 ADR-0005 同源（Caddy 反代），
手机经同一局域网访问；全天仅 Owner 单账号可用；不部署远端、不开放公开注册。

本手册只覆盖运行操作，不改变任何门禁语义。

## 1. 前提

1. **容器运行时**：OrbStack（`docker` 在 PATH，context 为 `orbstack`）。不使用 Docker Desktop。
2. **构建工具**：JDK 25（runtime jar）、Node 22 + pnpm 11（H5 dist）。
3. **仓库外私有配置清单**（全部 0600，全部不入库、不提交任何私有值；值只存在本机）：

   | 文件 | 用途 |
   |---|---|
   | `ops/deploy/.env.local` | compose 变量与 fail-closed 密钥（本次 dogfood 的注入入口） |
   | `ops/deploy/.local/application-provider.yml` | provider profile 私有配置（endpoint/套餐绑定） |
   | `ops/deploy/.env.feishu.local` | 飞书告警通道私有凭据 |

   ```bash
   chmod 600 ops/deploy/.env.local \
            ops/deploy/.local/application-provider.yml \
            ops/deploy/.env.feishu.local
   ls -l ops/deploy/.env.local ops/deploy/.local/application-provider.yml \
         ops/deploy/.env.feishu.local   # 三行都应显示 -rw-------
   ```

   凭据不得出现在 Git、日志、测试产物或文档中（ADR-0006 §3.2）。

## 2. 启动步骤

### 2.1 构建镜像产物

```bash
cd /Users/hxf/projects/virtual-companion
export JAVA_HOME="$(brew --prefix openjdk@25)/libexec/openjdk.jdk/Contents/Home"
./mvnw --batch-mode --no-transfer-progress verify          # 产出 runtime jar
pnpm --dir frontend build                                   # 产出 frontend/dist/build/h5
```

### 2.2 配置 `.env.local`

`VC_DOMAIN` 决定 Caddy 站点、TLS 证书与 runtime 的 Origin 白名单。dogfood 期间把它设为
Mac 的局域网 IP（手机可达地址）：

```bash
ipconfig getifaddr en0        # 例如输出 192.168.1.23；Wi-Fi 不在 en0 时换 en1 等
```

`.env.local` 需要包含（key 清单；值为私有，不写入任何仓库文件）：

```text
VC_DOMAIN=<上面的局域网 IP>
VC_HTTP_PORT=80
VC_HTTPS_PORT=443
VC_MIGRATOR_DB_PASSWORD=<强随机>          # 与 runtime 密码不同
VC_RUNTIME_DB_PASSWORD=<强随机>
VC_JWT_SECRET=<openssl rand -base64 32>
VC_OWNER_BINDING_SECRET=<openssl rand -base64 32>
VC_SHARED_RATE_LIMIT_SECRET=<openssl rand -base64 32>
VC_CRYPTO_REST_KEY=<openssl rand -base64 32>
VC_ADMIN_SEED_USERNAME=<管理员种子用户名，可选>
VC_ADMIN_SEED_PASSWORD=<管理员种子密码，可选>
VC_BETA_GENERATION_ENABLED=true           # dogfood 专用；见 §4
# provider profile（docker-compose.override.yml 要求）：
VC_MODEL_SECRET_OPENCODE_GO_API_KEY=<私有>
VC_MODEL_SECRET_WEIXIN_API_KEY=<私有>
VC_MODEL_EGRESS_ALLOWED_HOSTS=<私有>
```

注意：`.env.local` 若仍持有旧 key `VC_POSTGRES_PASSWORD`，该 key 已废弃——compose 现在从
`VC_MIGRATOR_DB_PASSWORD` / `VC_RUNTIME_DB_PASSWORD` 读取，缺失时 `:?` 直接拒绝启动。
80/443 被其他栈占用（如 `docker ps` 里的 `vc-local`）时，先停占用方或改用
`VC_HTTP_PORT=18080` / `VC_HTTPS_PORT=18443`（手机访问需带端口号）。

### 2.3 启动

```bash
cd ops/deploy
docker compose --env-file .env.local up -d --build
```

在 `ops/deploy` 下不带 `-f` 运行时，compose 自动合并 `docker-compose.override.yml`
（provider profile、挂载 `.local/application-provider.yml`、邀请注册临时开启，见 §4③）。
只想跑基础栈（无真实 provider）时显式加 `-f docker-compose.yml`。

### 2.4 健康验证

```bash
LAN_IP="$(ipconfig getifaddr en0)"
docker compose --env-file .env.local ps                 # 三服务 healthy/running
curl -k "https://${LAN_IP}/actuator/health"             # {"status":"UP",...}
curl -k -o /dev/null -w '%{http_code}\n' "https://${LAN_IP}/"          # 200，H5 壳
curl -k -o /dev/null -w '%{http_code}\n' "https://${LAN_IP}/api/v1/version"  # 200，同源 API
```

## 3. 局域网手机访问（私有 CA）

### 3.1 证书与 SNI 的机制事实

- `VC_DOMAIN` 是局域网 IP 时，Caddy 自动 HTTPS 对该 IP 使用**内部 CA**
  （`Caddy Local Authority`）签发证书——实测 issuer 为
  `CN=Caddy Local Authority - ECC Intermediate`。公网域名才会走 ACME。
- 浏览器对**纯 IP 地址不发送 SNI**（RFC 6066），本仓库 Caddyfile 已设置
  `default_sni {$VC_DOMAIN}` 兜底；否则 IP 访问的 TLS 握手会直接失败
  （实测修复前无 SNI 握手被拒：`tlsv1 alert internal error`）。
- Caddy 监听 `0.0.0.0`（compose ports 默认绑定全部接口），手机与 Mac 在同一 Wi-Fi/网段
  即可访问 `https://<LAN_IP>`。

### 3.2 iPhone（Safari）

推荐安装内部根证书，避免 7 天内逐次点击警告：

```bash
docker compose --env-file .env.local exec caddy \
  cat /data/caddy/pki/authorities/local/root.crt > /tmp/vc-caddy-root.crt
# 把 /tmp/vc-caddy-root.crt 通过 AirDrop / 文件 App 发送到 iPhone
```

iPhone 上：设置 → 通用 → VPN与设备管理（或"描述文件"）→ 安装该描述文件 → 再到
设置 → 通用 → 关于本机 → **证书信任设置** → 对该 root 开启完全信任（只"安装"不"信任"
Safari 仍会告警）。

不装证书的边界（如实说明）：Safari 首次访问会显示"网站证书无效"警告，通常可
"显示详情 → 访问此网站"逐次继续；但 iOS 版本行为可能变化，且每次新会话可能重复告警。
无法继续时必须走上面的描述文件路线。

### 3.3 Android（Chrome）

Chrome 首次访问提示"您的连接不是私密连接"→ **高级 → 继续前往**即可。
（Android 7+ 用户安装的 CA 证书不被 Chrome 信任，装证书无收益，不推荐。）

### 3.4 Origin 白名单自动跟随（不改代码）

机制事实：`docker-compose.yml` 注入
`VC_CORS_ALLOWED_ORIGINS: https://${VC_DOMAIN}`；`application.yaml`
（`virtual-companion.auth.cors-allowed-origins: ${VC_CORS_ALLOWED_ORIGINS:}`）读取该精确
origin，`AuthSecurityConfig` / `CookieCsrfGuardFilter` 用它做 Origin 门禁，通配符启动即拒
绝。因此 `VC_DOMAIN` 改为局域网 IP 后，手机浏览器发起的同源 POST/PUT 自动被放行，无需
任何代码或 CORS 改动。实测容器内 `VC_CORS_ALLOWED_ORIGINS=https://<LAN_IP>`。

### 3.5 私有 CA 局限声明

内部 CA + IP 访问只适用于 Owner-only 本地 dogfood。生产/真实用户 Beta 必须使用公网域名
与 ACME 证书，本节的手动信任步骤不适用于任何对外发布形态。

## 4. 「全天仅 Owner」组合口径

全可用范围 = 以下五项同时成立；任何一项缺失，Owner 也会进入 MAINTENANCE/受限模式。

### ① 生成开关 `VC_BETA_GENERATION_ENABLED=true`

`application.yaml` 的 `virtual-companion.beta.generation-enabled`（env 名
`VC_BETA_GENERATION_ENABLED`，默认 false）。compose 已透传该变量（默认 false），在
`.env.local` 加 `VC_BETA_GENERATION_ENABLED=true` 即生效，无需改代码或 application.yaml。
该开关为 false 时 ServiceMode 直接 MAINTENANCE（"当前未开放新的生成请求"，
`ServiceModeService`）。它只是部署侧开关，**不构成放行**——真正的账号门禁在 ④。

### ② 服务时段窗保持关闭

`virtual-companion.beta.service-window.enabled` 默认 false（窗口默认 10:00–22:00，
`BetaServiceWindow`）。dogfood 的"全天"来自窗口门禁整体关闭（enabled=false → 不拦截），
**不是**把窗口改成全天并写进默认值——ADR-0006 §1.3 明确现有 Beta 时段与门禁不变，
不得把全天范围扩散成 Beta 默认。本手册不引入任何 service-window 配置。

### ③ 邀请注册保持关闭

`virtual-companion.auth.invite-registration-enabled` 默认 false（`AuthController`）。
当前 `docker-compose.override.yml` 临时设为 true，仅用于 Owner 创建 dogfood 账号
（经邀请码兑换，role=USER）。账号创建完成后，把 override 中
`VIRTUAL_COMPANION_AUTH_INVITE_REGISTRATION_ENABLED` 改回 `"false"`（或删除该行）并
`docker compose --env-file .env.local up -d runtime` 重建，恢复关闭状态。

### ④ ReleaseGate 推进到 CANARY 并绑定 Owner 账号（具体命令）

代码事实：runtime 只读 `vc.release_gate_snapshot()`（`ReleaseGate.java`）；推进门禁唯一
途径是数据库函数 `vc.advance_release_gate(stage, eval_passed, policy_version, canary_owner_user_id)`
（V87/V95，SECURITY DEFINER；grep 全仓无 HTTP admin 端点调用它）。CANARY 绑定要求账号
`role='USER'` 且 `status='ACTIVE'`——ADMIN 种子账号会被拒绝（V95 fail-closed），因此必须
绑定 ③ 中创建的 USER 账号。

```bash
cd ops/deploy
# 1) 查询 Owner 账号 id（选 dogfood 用的 USER/ACTIVE 账号）
docker compose --env-file .env.local exec db psql -U vc_migrator -d vc \
  -c "SELECT id, username, role, status FROM vc.identity_account ORDER BY id;"

# 2) 推进到 CANARY 并绑定（<owner-account-id> 换成上一步的 id）
docker compose --env-file .env.local exec db psql -U vc_migrator -d vc \
  -c "SELECT vc.advance_release_gate('CANARY', true, 'dogfood-owner-v1', <owner-account-id>);"

# 3) 确认快照（期望 CANARY | t | dogfood-owner-v1 | <owner-account-id>）
docker compose --env-file .env.local exec db psql -U vc_migrator -d vc \
  -c "SELECT * FROM vc.release_gate_snapshot();"
```

回退（dogfood 结束或紧急禁用时）：

```bash
docker compose --env-file .env.local exec db psql -U vc_migrator -d vc \
  -c "SELECT vc.advance_release_gate('SYNTHETIC', false, 'synthetic-v1');"
```

前置条件：先完成 ①②③ 与账号创建，再执行 ④（CANARY 校验账号存在且 ACTIVE，顺序不能反）。
canary 成功率门槛（滚动 20 次至少 19 次成功等）见 ADR-0006 §3.4，由 Owner 在 dogfood 中
自行观察。

### ⑤ 单账号强制 = 运行时硬门禁

CANARY 阶段 `ReleaseGate.allowsGenerationFor` 只放行
`canaryOwnerUserId == ownerUserId` 的那个账号（ReleaseGate.java 的 CANARY 分支）；
eval 未通过、绑定缺失/陈旧一律拒绝。这把 ADR-0006「仅一个内部账号」落成数据库与
runtime 层的强制，而非流程约定。BETA 阶段才会放开到全部 owner——dogfood 不得推进到
BETA。

## 5. 停止 / 清理

```bash
cd ops/deploy
docker compose --env-file .env.local ps
docker compose --env-file .env.local stop          # 暂停（保留数据）
docker compose --env-file .env.local down          # 移除容器（保留数据卷）
docker compose --env-file .env.local down -v       # 连 db-data 等数据卷一起删除
```

`down -v` 会销毁 7 天对话与记忆数据；只有确定不再需要 dogfood 数据或要重置环境时使用。
`caddy-data` 卷保存内部 CA 根证书，删掉后手机需要重新信任新根。

## 6. 范围声明

本手册仅覆盖 ADR-0006 授权的 Owner-only 本地 7 天 dogfood：
不代表 D0 完成，不代表 `GO`，不授权远端部署、公开注册、真实支付、真实用户 Beta 或
生产发布（ADR-0006「明确不授权」）。手机真机验证（iPhone Safari / Android Chrome
VoiceOver/TalkBack 冒烟）是 Owner 执行项。

## 7. 本手册已验证内容（2026-08-24，隔离栈实测）

在隔离项目 `vc-dogfood01`（`VC_DOMAIN=<本机 en0 局域网 IP>`、端口 18080/18443、合成
密钥，与既有 `vc-local` 栈互不影响）验证后 `down -v` 清理：

| 项 | 结果 |
|---|---|
| Caddy 对 IP 用内部 CA 签发（issuer `Caddy Local Authority - ECC Intermediate`） | PASS |
| IP 访问无 SNI 握手失败 → Caddyfile `default_sni` 修复后 TLSv1.3 握手成功 | PASS（修复前 FAIL） |
| `curl -k https://<LAN-IP>:18443/` → HTTP 200 且含 H5 壳 `<div id="app">` | PASS |
| `curl -k https://<LAN-IP>:18443/actuator/health` → `{"status":"UP"}` | PASS |
| `curl -k https://<LAN-IP>:18443/api/v1/version` → HTTP 200（同源反代） | PASS |
| 443/80 发布在 `0.0.0.0`（`docker port` 确认） | PASS |
| 容器内 `VC_CORS_ALLOWED_ORIGINS=https://<LAN-IP>` 自动跟随 | PASS |
| 容器内 `VC_BETA_GENERATION_ENABLED` 透传（默认 false；置 true 即 §4①） | PASS |
| `advance_release_gate('CANARY',…, 999999)` 绑不存在账号 → `ERROR: CANARY owner must be an ACTIVE USER` | PASS（fail-closed） |
| 插入临时 USER/ACTIVE 账号后 advance CANARY 成功，snapshot 正确，回退 SYNTHETIC 成功 | PASS |
| 三个私有配置文件权限位 `-rw-------` | PASS |
| 真实渠道 smoke（仓库内可复核的唯一记录：2026-08-23 合成 smoke，in 25/out 5 tokens、脚本总时长 4.1s、首 token NOT_MEASURED，见 `docs/beta-readiness/records/2026-08-23-S0-24-真实Provider合成Smoke.md`） | PASS（2026-08-23，`weixin-ds-flash` 已恢复 DISABLED） |
| 2026-08-24 曾声称的「2.2s COMPLETED、in 12/out 26」 | UNVERIFIED / NOT_MEASURED（仓库内无可复核记录；稳定化整改起不再调用真实 provider，正式数值待 Owner 按第 11 节运行时实测） |
| 手机真机访问（iPhone/Android 信任流程） | NOT_RUN — Owner 执行项 |
| 真实 Owner 账号的 CANARY 绑定 | NOT_RUN — 需 dogfood 栈与真实账号，命令见 §4④ |

## 8. 数据导出对象存储（MinIO，DOGFOOD-02）

compose 已内置 `minio`（私有 bucket `vc-exports` 由 `minio-init` 一次性创建并确认为
private）与 runtime 的 `VC_EXPORT_S3_*` 注入。在 `.env.local` 提供：

```text
VC_EXPORT_S3_ENABLED=true
VC_EXPORT_S3_ENDPOINT=http://minio:9000     # 固定值（容器内网）
VC_EXPORT_S3_BUCKET=vc-exports
VC_EXPORT_S3_ACCESS_KEY=<强随机>
VC_EXPORT_S3_SECRET_KEY=<强随机>
```

开启后导出文档以 AES-GCM 加密 envelope（RestFieldCipher，密钥来自
`VC_CRYPTO_REST_KEY`）写入 MinIO 私有桶——桶内不存在明文导出 JSON；下载走一次性
token 的 `/api/v1/exports/{id}/download`（服务端取回 envelope、解密返回，成功后删除
对象并清指针）。没有签名 URL 下载入口：presigned 端口已删除，私有桶仅应用凭据可达。
EXPIRED 与 FAILED（封存失败但留了 V110 指针）两类行由清扫器统一删对象清指针，删除
失败如实记 FAILED JobRun 并 P1 重试；账号删除按防竞态顺序执行：先持久化删除意图
（阻断新导出请求与新封存）→ 取消在途调用 → 循环清空该账号全部导出对象指针（单次
SQL 至多 500 行，清不动即中止）→ cascade 前复查一遍仍为空；无对象存储装配但仍有
指针、或任一对象删除失败，都中止删除并发 P1。`VC_EXPORT_S3_ENABLED` 默认 false
（内联模式，行为与旧版一致）。
本地真实 MinIO 演练（2026-08-24 稳定化）：私有桶匿名 GET 拒绝、envelope 字节级
round-trip、删除幂等、桶缺失启动拒绝。

## 9. 每日加密备份（DOGFOOD-03）

脚本 `infra/db/backup/run-daily-backup.sh`：pg_dump + MinIO 对象导出 → VCBAE1 认证加密
（openssl AES-256-CBC 密文 + 独立 PBKDF2-HMAC-SHA256 MAC，encrypt-then-MAC；错误
passphrase、密文或 MAC 被篡改都在解密前失败；passphrase 经 env 或 0600 keyfile，不进
argv）→ `~/.virtual-companion/backups/`（0600，保留 7 天自动清理）；删除墓碑 manifest
同样以 VCBAE1 加密存 `~/.virtual-companion/deletion-manifests/`（与备份目录分离）。
退出码契约（见 `infra/db/backup/README.md`）：0=FULL；2=MinIO 变量全缺失（DB-only
fail-safe）；4=MinIO endpoint/bucket 不可达（脱敏报错）；5=部分配置；8=认证加密/
python3 不可用。pg_dump 与 mc mirror 是两次独立捕获、**不是原子快照**（崩溃窗口可能
不一致；恢复顺序=DB 恢复→先 reconcile→对象恢复+墓碑过滤→再开放读取）。
恢复演练（含对象逐字节校验与备份前/后删除防复活断言）：
`bash infra/db/backup/run-restore-drill.sh`（建议每月一次）。

定时：参照 `infra/db/backup/launchd/com.virtualcompanion.daily-backup.plist.template`
（每天 04:30）创建 0600 env 文件后 `launchctl bootstrap gui/$(id -u) <plist>` 并 kickstart
验证一次 exit 0。完整说明见 `infra/db/backup/README.md`。

## 10. 对话正文 30 天保留（DOGFOOD-07）

启动顺序（激活是本机数据操作，不进迁移默认值；其余类别保持 DRAFT fail-closed）：

```bash
# 1) 迁移已应用后，激活 NORMAL_CHAT=30 天（幂等，可重复执行）
docker compose --env-file .env.local exec db psql -U vc_migrator -d vc \
  -f - < infra/db/dogfood/activate-normal-chat-30d.sql
# 2) 先 dry-run 观察（保持 VC_RETENTION_PURGE_ENABLED=false）
docker compose --env-file .env.local exec db psql -U vc_migrator -d vc \
  -c "SET ROLE vc_api; SELECT * FROM vc.run_retention_category('NORMAL_CHAT', true);"
# 3) 复核计数无误后：.env.local 加 VC_RETENTION_PURGE_ENABLED=true 且
#    VC_RETENTION_DRY_RUN=true，观察调度 DRY_RUN 计数；最终 VC_RETENTION_DRY_RUN=false
#    启用真实清理（回退=脚本内 RETIRED 语句）。
```

已确认结构化记忆（ACCEPTED）不在任何 purge 谓词内，保留至主动删除/撤回/替代。

## 11. 真实 provider 运行前置（DOGFOOD-05）

Owner 尚未批准真实 provider 时，本地 Dogfood 使用确定性 `ZERO_LLM`：

```bash
# .env.local（私有，不入库）
VC_MODEL_PROVIDERS_ENABLED=false
VC_ZERO_LLM_ENABLED=true

# 只启动基础栈；不加载 docker-compose.override.yml
docker compose --env-file .env.local -f docker-compose.yml up -d --build
```

该组合不装配真实 provider，不读取 provider 凭据；`VC_ZERO_LLM_SOURCE_ID`
可留默认 `ZERO_LLM_FALLBACK`。

- `.local/application-provider.yml` 的 `weixin-ds-flash` deployment 需补 `model-revision`
  与 `config-version`（非空必填；Owner 向渠道确认不可变 revision 后填入——只有别名时
  不得自造 revision，见 TODO `OWNER-INPUT-PROVIDER-REVISION`）。
- DOGFOOD-STABILIZATION-03：generation 外发边界敏感门禁独立于 moderation——只要
  generation provider 开启（`VC_MODEL_PROVIDERS_ENABLED=true`）且
  `VC_GENERATION_PROVIDER_TERMS_VERIFIED=false`（默认；Owner 核验渠道条款并记录
  不可变 revision 前不得置 true），每次外发请求中的全部 MESSAGE_TEXT（当前消息 +
  可进入请求的历史）都必须先通过本地敏感数据检测器；命中零 generation HTTP、
  fail-closed，日志/异常只含命中类别不含正文。该检测与 `VC_MODERATION_ENABLED`
  无关；`MEMORY_SNIPPET`/`ACCOUNT_METADATA` 块的许可仍由授权快照交集控制（未授权
  类别不外发）。
- 被阻断轮次（INPUT_BLOCKED/OUTPUT_BLOCKED/危机阻断/取消）的消息按数据权利保留
  在导出与历史读取中，但持久化了模型外发资格位（V112 `vc.message.model_eligible`
  在终态写入的同一事务内翻转），后续任何 generation 请求的历史组装（资格过滤读）
  都不会再携带这些正文。
- 导出对象 key 按 claim 隔离（`exports/{owner}/{export}-{fence摘要}.json`，摘要为
  claim fence 的 SHA-256 前 16 hex，不含原始 claim secret）：stale claimant 的失败
  补偿只能删自己的对象，接管者封存成功后清理同前缀的残留尝试对象；账号删除意图
  提交后（V113）新的导出请求、READY 封存与 FAILED 留指针路径在数据库层被原子拒绝。
- runtime 的路由选择要求 DB 有该 deployment 的 `ADMITTED` 行
  （`vc.provider_deployment`）。
- 套餐动态状态：`.env.local` 注入 `VC_PROVIDER_PLAN_*`（`VC_PROVIDER_PLAN_ENABLED`、
  `VC_PROVIDER_PLAN_NAME`、`VC_PROVIDER_PLAN_VALID_FROM`、`VC_PROVIDER_PLAN_VALID_UNTIL`
  （YYYY-MM-DD）、`VC_PROVIDER_PLAN_TOKEN_CAP`、`VC_PROVIDER_PLAN_REQUEST_CAP`）。
  缺失/过期 → admin 页显示 `UNKNOWN`（每日一条 P2 告警，同日重启经持久告警 outbox
  去重），**不会显示 0 成本或虚构额度**；canary 继续。
- 远程 safety 分类（`VC_MODERATION_ENABLED=true` 时）：`VC_MODERATION_MODE=chat-completions`
  是本轮唯一被接受的 mode（`openai-moderations` 在装配层被拒绝启动——其 client 尚无
  chat-completions 同级的 egress 白名单/DNS rebinding 防护/响应大小上限，不得保留
  不受保护的默认路径）。另需 `VC_MODERATION_PROVIDER_TERMS_VERIFIED`（条款核验前保持
  false——只有本地敏感数据检测器（身份证/银行卡/手机号/邮箱/地址/密码与 API key/
  验证码）判定干净的正文可外发）与 `VC_MODERATION_ALLOWED_HOSTS`（moderation endpoint
  的精确 host 白名单）。`VC_MODERATION_BASE_URL` 填 API 根地址（例如
  `https://api.example.com/v1`）——客户端（`ChatCompletionsSafetyClient`）会自行在根地址
  后拼接 `/chat/completions`，不要复制完整 endpoint（会拼出重复路径）。每次远程调用都
  要求 ADR-0006 五类必要同意已授、无账号删除
  意图、该 provider 当前 ADMITTED——授权读取在独立的短 owner 事务中完成，HTTP 阶段
  不持有数据库事务；任何拒绝或读取失败零外发 fail-closed。
- DOGFOOD-STABILIZATION-04 边界（与上轮 03 的修复同源，运维需知）：
  - **generation 出口门禁的会话状态**：敏感历史命中门禁后，不再是通用异常——致拒的
    持久化消息按 id 原子标记 `model_eligible=false`（V112 `mark_messages_model_ineligible`），
    回合进入 `INPUT_BLOCKED`（`EGRESS_SENSITIVE_DATA`），work item 完成；下一干净回合正常
    执行，条款开关之后翻 true 也不会重新放出被拒消息（资格是持久化列，不是运行时分类）。
    敏感拼写规范化后同等拦截：全角数字、零宽字符插入、`+86`/括号/空格分隔手机号、
    `我的密码 hunter2secret` 等空格分隔秘密表达；`这个市区道路很宽` 等无门牌号句子不再误报。
  - **V112 升级回填**：迁移会把 V112 之前已经 INPUT_BLOCKED/OUTPUT_BLOCKED/CANCELLED 的
    关联消息回填为不可模型外发（真实 V111→latest 升级测试见
    `bash infra/db/run-upgrade-test.sh`，不用 TRUNCATE 重建数据）。
  - **账号删除原子屏障（V113 owner 级锁）**：`create_export_request`/`complete_export`/
    `fail_export_with_object`/`request_account_deletion_current` 共享同一 owner 级事务
    advisory lock（在 intent 检查之前获取）：删除侧先等所有在途指针写事务退出再提交
    intent；intent 提交后所有新指针写拒绝。删除请求可能因等待导出封存而短暂阻塞，
    属预期。
  - **导出对象孤儿闭环（V114）**：每次对象上传前先在独立已提交事务记录
    `vc.export_upload_intent`；封存/FAILED-with-pointer 原子删除对应 intent 行；
    `ExportUploadReconciliationScheduler` 每 5 分钟对账一次（默认 15 分钟宽限，单轮
    ≤100 行，可重入），crash-after-put 的无指针对象必然被回收；失败 P1
    `EXPORT_OBJECT_ORPHAN_RISK` 只含 owner/export id。
- DOGFOOD-STABILIZATION-05 边界（独立验收缺陷修复，运维需知）：
  - **V114 围栏化上传协议**：上传 intent 带状态机（OPEN→CLAIMED 墓碑）、租约
    （`lease_expires_at`，活跃上传可续约防误回收）与原子 claim——清扫器只在赢得
    单行原子 claim 后才删对象，READY/FAILED 指针已引用的对象绝不会被清扫器删除；
    claim 之后该 attempt 的封存被 fence 拒绝（指针回滚）。claim 留下的 CLAIMED 墓碑行
    被周期重扫（幂等再删对象），迟到 put 的对象必然收敛；行本身由 export 终态清理
    （`clear_export_object`）或账号删除 cascade 移除。清扫器第三段是 `exports/` 前缀
    audit：无任何数据库记录的对象（账号删除 cascade 后迟到 worker 的上传）会被删除。
    intent key 强绑定 `exports/{owner}/{export}-{16位hex}.json`，跨 owner/不匹配
    export 的 key 被拒绝。
  - **V113 bigint 锁键**：owner 级屏障锁改为 bigint 无损拆分
    （`(owner>>32, 低32位)`），owner_user_id ≥ 2147483648 不再溢出报错；不同 owner
    永不互相串行（双连接 lock-timeout 测试钉死）。
  - **敏感检测器 05 样本**：`0086`/`+86` 国家码、逗号/间隔号分隔、阿拉伯-印度数字
    （所有 Unicode Nd 类别数字统一折叠）、软连字符拆词（`密­码是…`）、明确住址披露
    语境（"我家地址是…"）均阻断且 provider HTTP=0；`token budget 128`/
    `password manager`/`API key rotation policy` 等普通技术用语保持 clean（秘密值须
    含数字或为 ≥9 字符的类凭据单词）。
- DOGFOOD-STABILIZATION-06 边界（V114 协议收口 + 敏感检测矩阵，运维需知）：
  - **claim 的实时租约重验**：清扫器的原子 claim 在同一条条件 UPDATE 里重验实时
    lease（对同一 grace）、state、指针与删除状态——stale 列表后 worker renew/重录
    的旧候选 claim 必输且不碰对象；claim 赢后 renew 返回 0 行、封存被拒（指针回滚）。
  - **生产上传租约（B 方案）**：MinIO 客户端所有调用带确定总超时（OkHttp
    callTimeout 60s），worker 记录 intent 时初始 lease=120s（2 倍超时窗口）；无心跳
    线程，超时 put 直接走补偿路径（delete + FAILED 终态），零秒 lease 不再冒充活跃
    租约。
  - **对象封存强制消费 intent**：`complete_export`/`fail_export_with_object` 对
    object 模式要求恰好一条 owner/export/key 全匹配的 OPEN intent 并在同一事务原子
    消费（seal 函数自验 key 形状）；缺 intent、错 owner/export/key、已 CLAIMED 一律
    拒绝且指针回滚。inline payload 模式不要求 intent。
  - **墓碑退休与有界 audit**：CLAIMED 墓碑在（claim 窗口过 60s 下限、export 终态、
    key 无指针）三条件同时满足的最后一次对象删除后退休删行；普通 `fail_export`
    终态直接消费该 export 的 intent 行——不再有永久日扫墓碑。前缀 audit 改为每轮
    一页（`listPage` limit=200 + cursor 推进，正常对象计入 limit），不再全桶加载。
  - **敏感检测器 06 矩阵**：规范化按 code point 遍历并剥除全部 Unicode FORMAT(Cf)
    字符（LRM/RLI/软连字符/零宽）；增补平面 Nd 数字（`𝟏𝟑𝟖…`）折叠后等同 ASCII。
    SECRET 规则改为：明确赋值语境（是/为/:/=、is/are）允许多词 passphrase（≥8 字符）
    或单 token ≥8 字符，裸关键词短语只在后续 token 含数字时阻断——
    `password management`/`token performance`/`API key configuration`/
    `password forgotten`/`我的地址选择城市`/`我的地址需要在市区更新` 保持 clean；
    `密码是 correct horse battery staple`/`密码是 abcdefgh`/`密⁧码是 hunter2secret`
    阻断且 provider HTTP=0。验收限定为该明确矩阵，不宣称"识别所有个人数据"。
- DOGFOOD-STABILIZATION-07 边界（4×P1 + 1×P2 收口，运维需知）：
  - **真实 MinIO 递归分页**：`listPage` 递归列出 `exports/{owner}/` 下实际对象并
    过滤目录伪键（非递归会返回 `exports/1/` 这类 common-prefix 假键，真对象永不被
    枚举）；真实 MinIO 集成测试（临时容器，不跳过）验证双 owner 子目录、多页
    cursor 不漏不重、startAfter 严格后续、无记录迟到对象真实删除。
  - **multipart 上传生命周期**：单次 HTTP call 的 60s callTimeout 只是每分片/complete
    的上界，不是整个 put 的总上界（8MiB multipart 集成测试实证总时长可超单 call
    窗口仍成功）。租约由 durable heartbeat 维持：record 时 lease=90s，上传期间每
    30s 续约（=3 倍间隔容忍一次抖动），续约失败经可中断流中止上传、put 后还有
    一次同步最终续约作确定性 fail-closed 门（不 seal READY，进入补偿）。
  - **fail_export 并发协议**：plain fail 取与 record/seal 相同的 owner barrier
    （record 持锁时 fail 等待，无穿透窗口），且不再删除 OPEN/CLAIMED intent——
    活跃 intent 由统一协议 claim 回收，CLAIMED 墓碑只经退休路径删除。
  - **prefix audit 持久门禁**：新增 `vc.export_object_fence`（每 key 唯一
    WRITER/RECLAIM 持有者）。audit 删除前必须先占 RECLAIM fence（record 并发到达
    时在同唯一行上输掉并 RAISE）；record 提交即持 WRITER fence（audit 占位失败、
    对象保留）；seal 消费 intent 时释放 fence；claim 把 WRITER 转 RECLAIM；退休/
    clear/cascade 释放。READY 指针不可能指向已删对象。
  - **墓碑退休窗口重设计**：不再以"claim 后 60s"为安全证明——退休窗口下限 300s
    （默认 900s=claim grace），推导链：claim 需 lease 过期+grace，上传期间靠
    heartbeat 维持租约、每个 call ≤60s，claim 时一切合法 writer 早已终结；病态
    writer 的迟到对象由 fence 门禁的前缀 audit 兜底收敛（audit 是正确性底线，
    窗口只减少无谓重扫）。
  - **敏感检测器 07 收紧**：SECRET 值真正有边界（到第一个句界/标点或文末，英文
    is/are 语境收紧为单 token 含数字）；地址上下文要求连续地址结构（两级后缀间距
    ≤12 字且排除 城市/地区/城区/市区/都市 泛指复合词）——
    `密码是忘记了，请帮我重置`/`password is forgotten and needs reset`/
    `token is performance budget setting`/`我的地址选择城市功能并支持地区筛选`/
    `我的地址选择城市后设置城区偏好` 全部 clean，06/05 阻断与 clean 矩阵零回退。
- DOGFOOD-STABILIZATION-08 边界（3×P1 + 2×P2 收口，运维需知）：
  - **deleted-owner 孤儿 fence**：`export_object_fence.owner_user_id` 改为 nullable +
    `ON DELETE SET NULL`——账号删除 cascade 不再销毁 fence 行。owner 删除后残留的
    WRITER fence 变为 ownerless 孤儿，audit 可接管（`fence_export_orphan_reclaim`
    从存活 `vc_user` 解析 owner，已删 owner 的 key 以 ownerless 行建立/接管 RECLAIM，
    不再有 FK 异常）；活跃 owner 的 WRITER（owner_user_id 非空）永不可被伪造 key
    接管。账号删除后的迟到 put 由真实 PG + 真实 MinIO + Scheduler 组合测试证明
    最终真实删除且幂等（infra/db/tests/168 + ExportDeletedOwnerConvergenceIntegrationTest）。
  - **fence 内原子重验**：`objectHasRecord` 仅是性能预筛；`fence_export_orphan_reclaim`
    在成功取得 RECLAIM 排他权后同事务重读 pointer 与 intent（任何状态，含 CLAIMED
    墓碑）——有记录即释放占位返回 false，Scheduler 不删对象。预筛后 worker 完成
    record+put+seal READY 的时序下 fence 必 false，READY 指针与对象都保留。
  - **英文密码/passphrase 阻断恢复**：英文赋值语境（is/are）不再强制值含数字——
    值首 token 命中状态/配置词表（forgotten/incorrect/expired/management/rotation/
    budget/performance…，correct 刻意不在表内）判 clean；否则 ≥8 非空白或含数字
    token 判 SECRET。`password is abcdefgh`/`password is correct horse battery
    staple`/`my API key is abcdefghijklmnop` 阻断（gate 级 execute=never 已证），
    状态/重置描述保持 clean。
  - **中文无标点与地址设置误报收紧**：CJK 赋值值前缀命中状态/求助短语（忘记了/
    错误的/需要/请/无法…）判 clean；地址上下文要求关键词与第一级行政区之间存在
    披露关系词（是/为/:/填/位于/住在/寄到/送到/搬到…）——`密码是忘记了请帮我重置`/
    `密码是错误的需要重新设置`/`我的地址选择北京市后设置海淀区偏好`/
    `收货地址可以选择北京市或者天津市` 全部 clean；既有阻断零回退。
- 运维注意：Spring 命令行的 `deployments[0].enabled=true` 会整体替换 list 导致启动失败——
  开关 deployment 必须改 `.local/application-provider.yml` 文件本身。
- canary 健康观察入口：`/actuator/prometheus` 的
  `vc_canary_rolling_success_20`（滚动 20 次成功率，门槛 ≥0.95）、
  `vc_generation_first_token_seconds`（首 token P95，门槛 ≤60s）；240s 硬超时与 5 连败
  熔断为既有默认。最终输出被判 R4 计为 canary 失败且不记 supplier 成功；durable
  停用成功后 deployment 为 DISABLED（P1 `PROVIDER_SAFETY_LEAK_DISABLED`），停用写库
  失败则 P0 并在本进程内立即隔离该精确 deployment（下一次路由零外发，直到重启或
  人工修复）；恢复一律由 Owner 手动 ADMIT。

## 12. 每日体验入口与脱敏反馈（DOGFOOD-10 / A4）

### 12.1 每日体验入口（两类手机）

手机与 Mac 同一局域网，打开 `https://<LAN_IP>`（信任步骤见 §3；Android 带"高级→继续
前往"）。每天至少完成一次核心旅程（ADR-0006 §2.1）：

1. 登录 Owner 账号（§4③ 创建、④ 绑定的那个 USER 账号）。
2. 创建或打开角色 → 聊天一轮（观察流式回复、状态行、字体放大下的布局）。
3. 记忆页：确认/拒绝一条候选（或两步删除一条已保存记忆）。
4. 我的导出：输入当前密码发起导出并下载一次（验证一次性语义）。
5. （可选）admin 账号查看 provider-plan 状态卡与用量。

iPhone 用 Safari、Android 用 Chrome；7 天周期内两类设备都要覆盖。第 1 天建议同时完成
§8/§10/§11 的启动前置与附录 A 的 VoiceOver/TalkBack 首次冒烟。

### 12.2 每日健康观察（Owner，1 分钟）

```bash
docker compose --env-file .env.local exec runtime sh -c \
  'wget -qO- http://localhost:8080/actuator/prometheus | grep -E "vc_canary_rolling_success_20|vc_generation_first_token_seconds_count|vc_provider_attempt_total"'
```

关注：滚动成功率 ≥19/20、无持续 `PROVIDER_PLAN_UNKNOWN` 告警、无 R4 事件。异常先看
`docs/beta-readiness/07` 分级，供应商连续故障按 ADR §3.4 由 Owner 决定恢复。

### 12.3 脱敏问题反馈方式（唯一回流通道）

- 原始对话、账号、密钥、套餐截图数值、本机私有配置**不得**进入 Git 或交给 Agent
  （ADR-0006 §2.3）。
- Owner 先自行脱敏（去除正文/可识别信息），把问题以「脱敏摘要 + 严重程度
  （P0–P2）+ 复现场景一句话 + 建议顺序」追加到 `TODO.md` 的 DOGFOOD 段下方新建的
  「dogfood 脱敏问题」小节；确需 Agent 定位原始片段时，在当次请求中明确授权该片段。
- 结束时汇总体验观察与缺陷清单，不写 `GO/PIVOT/STOP`、不形成 Beta 放行结论。

### 12.4 已知问题重点确认（真实手机首次冒烟必查）

自动化现状（2026-08-24 稳定化后）：axe 全量规则无禁用、无对比度放行；四条历史禁用
规则（label/landmark-one-main/region/page-has-heading-one）已真实修复——
`src/platform/h5-a11y.ts` 全局 DOM 修补把 uni-input 的 aria-label 转发到内部原生
input、给 uni-button 补 tabindex/role 并支持 Enter/Space 激活（disabled 态同步为
aria-disabled=true + tabindex=-1：键盘不可聚焦、不可激活），导航栏声明 banner，
页面侧每页 role=main + 一级标题；键盘断言含 Tab 顺序、Space 激活与 Enter 完整登录；
登录页 submit 在禁用态与启用态各扫一次 axe（启用态覆盖主题色按钮的
color-contrast，缺陷 F 修复后对比度 ≥4.5:1）。
仍需真机确认：

1. VoiceOver/TalkBack 聚焦用户名/密码/聊天输入框：DOM 修补后应读出字段名——记录
   实际朗读内容（修补在真机读屏下的实际效果只有真机能验证）。
2. 触屏/读屏双击激活全部按钮；蓝牙键盘 Tab 到 submit 可聚焦、Enter 可提交。
3. 对比度已修复项复核：disabled 按钮（#6e6e6e）与记忆页提示文案，在系统深色模式下
   粗查是否仍可读；读屏/键盘对 disabled 按钮的现状：报出“已停用”
   （aria-disabled=true）、Tab 不可聚焦（tabindex=-1）、Enter/Space 不激活——
   与原生 disabled 行为一致，真机上如有差异如实记录。

## 附录 A：双端无障碍手工冒烟清单（Owner 执行）

### iPhone Safari（VoiceOver：设置 → 辅助功能 → VoiceOver；转子=双指旋转）

1. 字体放大 200%：设置 → 辅助功能 → 显示与文字大小 → 更大字体 → 200%；走
   登录→边界台→聊天→记忆→导出，核对无截断/横向滚动/按钮不可点。
2. 页面缩放：Safari 双指捏合可放大（viewport 已放开禁缩放）；设置→Safari→页面缩放。
3. 登录字段朗读：逐元素滑动过用户名/密码框，记录是否读出字段名（见 §12.4-1）。
4. 错误焦点恢复：故意输错密码提交，核对焦点是否回到用户名框（自动化已断言）。
5. 转子标题导航：切到"标题"，边界台上下滑核对区块跳转。
6. 聊天一轮：VO 下输入→发送→流式回复，核对"已完成…"状态通报、回复不重复朗读。
7. 记忆两步操作：候选确认/拒绝、已保存记忆两步删除的朗读与焦点落点。
8. 导出闭环：密码确认框朗读、状态通报（role=status）、一次性下载结果通报。
9. VO 激活方式：登录/发送/导出按钮用单指滑动+双击（非键盘路径）。

### Android Chrome（TalkBack：设置 → 无障碍 → TalkBack，或音量键长按快捷）

1. 显示大小与字体均最大：设置 → 显示；走核心旅程核对布局与可读性。
2. 页面缩放：双指张开；Chrome 设置"强制启用缩放"后仍可放大。
3. 登录字段朗读：左右滑动遍历登录页，记录导航按钮与输入框的朗读名称。
4. 完成一次真实登录：错误提示（role=alert）是否即时通报。
5. 聊天一轮：输入→发送→回复逐条可定位。
6. 记忆两步删除：确认文案朗读与焦点位置。
7. 导出闭环：密码确认、状态刷新、一次性下载通报。
8. 深色模式粗查：系统深色 + Chrome 强制深色下 disabled 按钮与提示文案对比度。
9. （可选）蓝牙键盘 Tab：验证用户名→密码→按钮的可达顺序（uni-button 已由全局
   修补补 tabindex=0，可聚焦、Enter/Space 可激活；disabled 按钮 tabindex=-1 不可
   聚焦——顺带核对禁用语义）。

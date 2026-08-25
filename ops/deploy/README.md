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
cp ops/deploy/.env.example ops/deploy/.env   # 逐项填写;四个密钥用 openssl rand -base64 32
#    VC_DOMAIN 必须是真实域名(或 localhost 用于本机演练)

# 2) 起服务(在 ops/deploy 下)
docker compose up -d --build

# 3) 验证
curl -s https://"$VC_DOMAIN"/actuator/health          # {"status":"UP",...}
curl -sI https://"$VC_DOMAIN"/ | head -1              # 200,H5 壳
```

## 冒烟演练（本机即可,无需域名）

`bash ops/deploy/smoke-drill.sh`：构建镜像 → 断言 production profile 在缺
`VC_CRYPTO_REST_KEY` 时拒绝启动(fail-closed 实弹) → 断言声明副本数=2 时拒绝
启动(S0-33) → 注入完整密钥起全栈 → 健康检查 + H5 壳 + API 探针 →
`--scale runtime=2` 合成部署被单副本门禁阻断（第二实例 RUNTIME_SINGLETON_REFUSED
且首个实例持续 UP）→ 缩回 1 恢复 → 清理。演练记录归档到
`docs/beta-readiness/records/`。

## 数据库角色隔离（S0-27）

- `vc_migrator`：独立迁移登录（空库建 schema/role/extension）；只给
  `VC_MIGRATOR_DB_PASSWORD`。
- `vc_runtime_login`：无 SUPERUSER/BYPASSRLS/CREATEDB/CREATEROLE/schema CREATE，
  仅继承 `vc_api/vc_worker/vc_job_coordinator/vc_dispatcher` 的既有最小函数权限；只给
  `VC_RUNTIME_DB_PASSWORD`。runtime 启动时再次查询角色属性，任一高权限或缺少成员资格即拒启。
- 两个密码必须不同；Compose 不再把 `postgres` 或 migrator 凭据注入 runtime。

全新 volume 由 `db-init/01-runtime-roles.sh` 自动建立角色。旧 volume 升级前先备份，
填好两个新密码后执行一次：

```bash
docker compose exec -e POSTGRES_USER=postgres db \
  /docker-entrypoint-initdb.d/01-runtime-roles.sh
docker compose up -d --build
```

随后必须运行 `bash infra/db/run-role-separation-drill.sh`；它在匿名临时数据库中证明
runtime 不能 CREATE/读取 owner-binding Secret，而 migrator 仍可从空库应用全部迁移。

## 共享限流与并发租约（S0-30）

production 必须同时设置 `VC_SHARED_RATE_LIMIT_ENABLED=true` 与独立的
`VC_SHARED_RATE_LIMIT_SECRET`（至少 32 字节；不得复用 JWT、owner-binding 或静态加密密钥）。
登录/刷新只把经域分离 HMAC 后的来源摘要写入 V106 窗口表，不保存原始 IP、凭据或
Token；generation/export/report 频率窗及 generation/SSE 并发租约均由 PostgreSQL 原子
函数共享，拒绝时返回 429 和 `Retry-After`。SSE 租约在完成、超时或错误时释放，异常
退出由 TTL 回收。紧急联系人/危机求助路径不在限流匹配列表内。密钥轮换会切换来源
摘要命名空间；先按变更窗口替换并接受旧窗口自然过期，禁止导出或记录旧摘要。

## 告警 outbox 与维护任务 freshness（S0-31）

告警业务路径只写 V85 outbox；dispatcher 默认每 5 秒认领，短故障指数退避、最多 5 次，
DEAD 与 `vc_alert_webhook_delivery_total` 必须纳入抓取。V86 四类维护任务使用数据库
排他租约和 run history；V107 `SELECT * FROM vc.list_job_health()` 只返回固定任务元数据，
可用于核对 last-success。默认 DAU/export 5 分钟、auth/retention 日任务 26 小时无成功
会发 P1；`VC_JOB_*_STALE_SECONDS` 只能在演练后调整。pause 不报 stale；retention 未经
Owner/法务批准必须保持 `VC_RETENTION_PURGE_ENABLED=false`，批准试运行时仍先保持
`VC_RETENTION_DRY_RUN=true` 并复核 DRY_RUN 分类计数与 legal hold。真实替补 endpoint
未指定时不得把主通道 smoke 当成完整值班升级链。

## H5/API 同源（S0-06 / ADR-0005）

Caddy 在同一 `VC_DOMAIN` 提供 H5 壳和 `/api/*`。这是 Technical Alpha/受控 Beta **唯一受支持**
的浏览器会话模型：

- runtime 注入 `VC_CORS_ALLOWED_ORIGINS=https://$VC_DOMAIN`（精确 origin，禁止 `*`）；
- CSRF + Origin 门禁保持开启；cookie SameSite=Lax；access token 不进 `localStorage`；
- 不要把 H5 放到另一个站点或子域再打 API——那不是当前受支持部署，也不能靠放开 CORS
  或关闭 CSRF 来“打通”。

## 单副本硬门禁（S0-33 / §12.7）

Technical Alpha/Beta **严格单副本**：共享 Realtime、在途取消、授权镜像、Quota、
熔断和 Scheduler 状态外置（S2-37）之前，任何时点只允许一个 active runtime。
三层门禁，全部为硬失败而非告警，且无远程 feature flag 可绕过：

1. **声明面**（compose）：`deploy.replicas: 1`（本文件）+ `VC_RUNTIME_REPLICAS`
   注入 runtime（默认 1）。任何显式值 ≠1 → 启动前预检拒绝；
2. **Startup Preflight**（runtime 内，`SingleReplicaPreflightEnvironmentPostProcessor`，
   所有 profile 生效）：声明副本数 ≠1 即拒绝启动，bean 创建前报错；
3. **成员资格排他**（runtime 内，`RuntimeSingletonLease` + `SingletonLeaseDataSource`）：
   用 PostgreSQL 会话级 advisory lock（`vc.runtime.singleton`）做进程互斥。第一个
   实例持有租约、正常服务；第二个实例（`--scale`、第二套 stack、手工 `docker run`
   指向同一数据库）启动时获取租约失败 → 每条连接 fail-closed（
   `RUNTIME_SINGLETON_REFUSED`）→ 进程以退出码 87 停止。持有实例崩溃 → 会话结束、
   锁自动释放 → 重启/替换实例重新获取——因此**故障恢复不可能同时存在两个 active
   runtime**，且无陈旧租约残留。

### 运维规则（违反即发布失败或实例退出）

- 禁止 `docker compose up --scale runtime=N`（N>1）；禁止第二套 compose stack
  指向同一数据库；禁止手工 `docker run` 再起一个 runtime；
- 禁止把 `VC_RUNTIME_REPLICAS` 设为 1 以外的值；
- 副本数、实例身份或 HA 需求出现时 → 先进 S2-37 共享状态 ADR，逐项外置后
  再放开，不在门禁上开洞。

### 进入 S2-37 前必须外置的状态（清单；不在此实现外置）

| 状态 | 位置 | 失败模式 |
|---|---|---|
| Realtime live delta 缓冲（LiveDeltaBroker） | `runtime/realtime/LiveDeltaBroker.java`（进程内队列） | worker 与 SSE 长连接分属两实例时 delta 全丢 |
| 在途模型会话（ActiveInvocationRegistry） | `modelruntime/execution/ActiveInvocationRegistry.java` | 取消落在非执行实例 → provider 不被中断 |
| 熔断器状态（SupplierCircuitBreaker） | `modelruntime/execution/SupplierCircuitBreaker.java` | 各副本独立计数，阈值/半开漂移 |
| 会话-部署亲和（SessionDeploymentAffinity） | `modelruntime/routing/SessionDeploymentAffinity.java` | 连续 turn 不粘滞，persona 漂移 |
| 进程内 Quota ledger（QuotaLedger） | `modelruntime/routing/QuotaLedger.java` | 双副本各放行全额 = 配额 2× |
| 认证进程内 bulkhead/账号键退避（AuthAbuseGuard） | `runtime/auth/application/AuthAbuseGuard.java` | 并发 bulkhead 与账号维度退避仍按副本拆分；来源频率窗已由 V106 共享 |
| 告警节流/去重（WebhookAlertNotifier） | `runtime/observability/WebhookAlertNotifier.java` | 告警重复/漏去重 |
| 指标聚合（VcMetrics DAU 侧） | `runtime/observability/VcMetrics.java` | 双实例双重计数 |

已外置（无需外置）：授权快照权威 `vc.authorization_snapshot`（S0-25）、work item
claim/lease（V24）、realtime ticket/resume/event（V8）、取消终态（V10）、真实花费
`vc.generation_usage`、quota 账本持久化（V61）、敏感路由频率窗（V84）、共享
login/refresh 来源窗与 generation/SSE 并发租约（V106），以及全部业务实体表。

### 何时进入、何时才能退出 S2-37

以下任一事实只会**启动 S2-37 ADR/容量评审**，不会授权把副本数改为 2：单实例在 30 天
内造成 ≥2 次不可用事件或累计不可用 ≥30 分钟；连续 3 个业务日峰值窗口中 CPU 或 JVM
heap ≥70% 持续 15 分钟且已排除单请求异常；已批准的维护/可用性 SLO 明确要求无中断替换。

只有同时满足以下退出条件才可提交移除门禁的变更：上表每项进程内状态都有单一共享
权威和故障语义；双实例故障注入证明 realtime 无丢/重、取消命中执行者、配额不超卖、
熔断/亲和一致、告警与指标不重复；滚动替换与网络分区演练通过；对应指标和 runbook
已上线；Owner 完成 ADR/费用/值班批准。任一条件缺失，`deploy.replicas: 1`、preflight
和 advisory-lock 三层门禁均不得删除、降级为告警或加 feature flag 绕过。

## 上线后

- 备份：接入 `infra/db/backup/run-backup-drill.sh` 同款策略（见其 README）；
- 告警：`.env` 里配置 provider 与精确 host allowlist。当前飞书应用机器人使用
  `VC_ALERT_WEBHOOK_PROVIDER=feishu-app-bot`、`VC_ALERT_FEISHU_APP_ID`、
  `VC_ALERT_FEISHU_APP_SECRET`、`VC_ALERT_FEISHU_CHAT_ID` 和
  `VC_ALERT_WEBHOOK_ALLOWED_HOSTS=open.feishu.cn`，Webhook URL/secret 留空；
  App Secret 只写私有 `.env`，不写仓库、日志或聊天。替补通道用
  `VC_ALERT_FALLBACK_WEBHOOK_URL/SECRET/ALLOWED_HOSTS` 注入独立 generic
  signed webhook；三项留空即禁用，不得复用主通道 Secret。分级与权限要求见
  `docs/beta-readiness/07-告警分级与Webhook通道.md`；
- Provider 成本：启用任何非 FAKE deployment 前，由 migrator 追加对应
  `(provider_id, model_id, price_version)` 单价，配置正数
  `VC_MODEL_BUDGET_MONTHLY_USD`；缺价格/上限 runtime 启动或 prepare fail-closed。
- 数据保留：仓库 policy 均为 DRAFT。Owner/法务批准并由 migrator 标为 ACTIVE 后，
  才可设置 `VC_RETENTION_PURGE_ENABLED=true`；首轮必须保持
  `VC_RETENTION_DRY_RUN=true`，复核 run history 与 legal hold 后另行批准真实删除。
  account deletion digest manifest 必须加密保存在备份/PITR 边界之外，恢复时先
  dry-run reconcile 再 apply（见 `infra/db/backup/README.md`）。

## Owner-only 本地 dogfood（ADR-0006）

单 Owner、Mac 单实例、`VC_DOMAIN` 设为局域网 IP 的 7 天 dogfood 运行手册见
[`DOGFOOD.md`](DOGFOOD.md)：私有配置 0600 清单、手机信任内部 CA 步骤、
`VC_BETA_GENERATION_ENABLED` 注入与 ReleaseGate CANARY 单账号绑定的具体命令。
该手册只覆盖本地 dogfood，不授权远端部署或真实用户 Beta。

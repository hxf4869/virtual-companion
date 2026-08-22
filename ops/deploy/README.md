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
`VC_CRYPTO_REST_KEY` 时拒绝启动(fail-closed 实弹) → 断言声明副本数=2 时拒绝
启动(S0-33) → 注入完整密钥起全栈 → 健康检查 + H5 壳 + API 探针 →
`--scale runtime=2` 合成部署被单副本门禁阻断（第二实例 RUNTIME_SINGLETON_REFUSED
且首个实例持续 UP）→ 缩回 1 恢复 → 清理。演练记录归档到
`docs/beta-readiness/records/`。

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
| 登录限流窗口（AuthAbuseGuard） | `runtime/auth/application/AuthAbuseGuard.java` | 限流按副本拆分减弱 |
| 告警节流/去重（WebhookAlertNotifier） | `runtime/observability/WebhookAlertNotifier.java` | 告警重复/漏去重 |
| 指标聚合（VcMetrics DAU 侧） | `runtime/observability/VcMetrics.java` | 双实例双重计数 |

已外置（无需外置）：授权快照权威 `vc.authorization_snapshot`（S0-25）、work item
claim/lease（V24）、realtime ticket/resume/event（V8）、取消终态（V10）、真实花费
`vc.generation_usage`、quota 账本持久化（V61）与全部业务实体表。

## 上线后

- 备份：接入 `infra/db/backup/run-backup-drill.sh` 同款策略（见其 README）；
- 告警：`.env` 里配 `VC_ALERT_WEBHOOK_URL`（分级见 docs/beta-readiness/07）;
- 数据保留：Owner/法务复核草案周期后将 `VC_RETENTION_PURGE_ENABLED=true`。

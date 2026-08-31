# 全项目审计修复：多 Agent 执行规范

> 状态：READY_FOR_EXECUTION
> 日期：2026-08-31
> 基线：`main@d93bce13da03685452c12d683d245011b8468935`
> 审计结论：0 Critical / 6 High / 21 Medium / 4 Low
> 当前环境：用户项目容器保持停止；实施阶段默认只允许静态检查和隔离临时容器

## 1. 文档用途

本文是本轮 31 项审计问题的唯一执行入口，用于让多个 Agent 在明确文件所有权、依赖顺序、验收条件和停止条件下完成修复。

本文只修复已确认问题，不授权重新设计产品、重构整套架构或恢复已退役的治理体系。执行时仍按以下顺序判断事实：

1. 用户当前明确要求、根目录 `AGENTS.md` 与 `AGENTS.override.md`；
2. Catalog、OpenAPI、migration/RLS、当前代码和测试；
3. 本文的工作包和验收条件；
4. 历史 ADR、旧 planning、tasks/evidence/handoffs 只作背景。

如果代码事实已变化，Agent 应先报告差异并缩小工作包，不得为了完成本文编号重写已经正确的实现。

## 2. 总目标与完成定义

完成时必须同时满足：

- 6 个 High 全部关闭；
- 21 个 Medium 全部关闭或有经 Owner 明确接受且带到期日的现有例外；
- 4 个 Low 全部关闭；
- 当前受支持的 Go-only Compose 能真实使用 MinIO 完成导出对象写入、一次性下载和删除；
- 改密与会话撤销原子完成；
- 匿名公开页面、聊天取消/防重复提交、后台保存反馈在单元测试和浏览器 E2E 中可验证；
- `scripts/check.sh`、后端、前端、数据库、隔离 E2E、部署 smoke、备份恢复 drill 按本文规定通过；
- 未运行的检查必须标 `NOT_RUN`，失败必须标 `FAIL`，不得用旧记录冒充本轮结果；
- 工作树只包含本轮文件，且没有恢复 Java/Spring/Maven/Gradle 运行链。

## 3. 本轮明确不做

以下内容即使看起来“顺便更完整”，也不进入本轮：

- 不重做前端视觉、Stitch 设计、设计系统或页面信息架构；
- 不改 OpenAPI 的业务范围，不新增公开注册、支付、MFA、多租户、多管理员权限模型；
- 不引入 Redis、消息队列、分布式锁、跨节点取消总线、通用补偿框架或对象存储插件体系；
- 不建立 KMS、Vault、自动轮换、通用 Secret Agent；
- 不新增 ORM、DI 框架、通用状态机、通用请求队列、全局 schema validator；
- 不手写 S3 签名算法，不支持 AWS/GCS/多云；本轮只支持当前本机私有 MinIO；
- 不批量迁移历史 inline export，不批量重加密历史明文/enc1，不重写 V1–V120；
- 不为理论异常增加多层 fallback、重试队列或永久兼容分支；
- 不批量升级所有 Go/Node 依赖，只升级本轮直接受影响的最小集合；
- 不把 Playwright 放入 `scripts/check.sh`，不新增浏览器/操作系统矩阵或截图基线；
- 不恢复 `docs/tasks/`、`docs/evidence/`、`docs/handoffs/`、`docs/archive/` 的旧任务卡/证据流程；
- 不把历史文档中的 “Java” 字样全仓清零。历史事实可以保留，当前构建、部署、运行和操作入口不得再指向 Java；
- 不启动远端或生产环境，不删除真实账号，不修改真实管理员密码，不调用真实付费模型做本轮验收。

## 4. 多 Agent 协作模型

### 4.1 角色与文件所有权

| Agent | 工作包 | 独占写入范围 | 禁止写入 |
| --- | --- | --- | --- |
| `coordinator` | AR-00、集成、提交、推送、最终验收 | 本文、集成时的最小冲突修正 | 不代替工作 Agent 做无关重构 |
| `export-backend` | AR-01 | `backend/internal/jobs/export.go`、`scheduler.go`、`export_test.go`、`scheduler_test.go` | `jobs/loop.go`、`loop_test.go`、`config/**`、`app/**`、`cmd/**`、`go.mod`、`vendor/**` |
| `auth-backend` | AR-03 | `backend/internal/httpapi/auth.go`、`backend/internal/store/postgres/session.go`、V121、认证定向测试 | 其他 migration、`config/**`、前端、部署 |
| `frontend-runtime` | AR-05 | 本文列出的 nav/api/chat/admin 页面、store 与定向测试/E2E journey | 设计系统、全局样式、后端和 CI |
| `runtime-storage` | AR-02、AR-04 | `backend/internal/config/**`、`app/**`、`cmd/companiond/**`、`jobs/loop.go`、`httpapi/core.go`、账户删除相关文件、新 MinIO adapter、`go.mod/go.sum/vendor/**` | AR-01/AR-03 已归属文件、部署脚本 |
| `infra-ops` | AR-06 | `ops/deploy/**`、`infra/db/backup/**`、`infra/db/run-upgrade-test.sh`、`scripts/dev/e2e-stack.sh` | 后端业务代码、前端生产代码、CI |
| `quality-contract` | AR-07、AR-08 | `scripts/check.sh`、列出的 checks/measure 工具、Catalog/OpenAPI 生成器与生成物、`ops/model-providers.example.yml`、依赖台账、pnpm override/lock、CI、当前态文档 | 前后端业务代码、migration、`ops/deploy/**` |

所有权是写入边界，不是阅读限制。Agent 可以读取调用链和测试，但不得修改未归属文件。确需跨边界时先把建议发给 `coordinator`，由对应 owner 实施。

### 4.2 并发上限与共享工作树规则

- 同时最多运行 3 个工作 Agent，加 1 个 `coordinator`；不再派生二级 Subagent。
- 所有 Agent 共享工作树时，Agent 不得执行 `git add`、`git commit`、`git push`、`git checkout`、`git reset`、`git rebase` 或回滚他人文件。
- 每个文件同一时刻只有一个写入 owner。同一文件被两个工作包需要时，按本文波次串行。
- Agent 完成后只返回：改动文件、行为变化、测试结果、遗留风险；由 `coordinator` 对照 allowlist 检查并按精确路径暂存。
- `coordinator` 每次提交后立即 push 当前跟踪分支；禁止 force push，不开 PR，除非用户另行要求。
- 不提交无法独立构建的半成品。跨工作包接口先冻结名称和签名，再写消费者。

### 4.3 推荐执行分支与提交

执行开始时由 `coordinator` 从最新 `main` 创建 `codex/audit-remediation`。建议提交顺序：

1. `fix: 修正导出对象生命周期`（AR-01）
2. `fix: 原子化认证与会话失效`（AR-03）
3. `fix: 修复前端关键交互回归`（AR-05）
4. `fix: 接通加密 MinIO 导出存储`（AR-02）
5. `fix: 删除账户时取消本地生成`（AR-04）
6. `fix: 对齐部署备份与隔离演练`（AR-06）
7. `fix: 收紧契约工具与质量门禁`（AR-07/AR-08）

如果两个相邻工作包必须同提交才能编译，只允许由 `coordinator` 合并这两个提交，不为保持提交数量制造临时兼容层。

## 5. 执行波次与依赖

```text
AR-00 基线冻结
  ├─ Wave A: AR-01 导出安全
  ├─ Wave A: AR-03 认证/会话
  └─ Wave A: AR-05 前端行为

AR-01 完成
  └─ Wave B: AR-02 加密/MinIO/Go 依赖
        └─ Wave C: AR-04 账户本地取消

AR-02 配置名与接口冻结
  └─ Wave B: AR-06 Compose/备份/E2E 栈

AR-05、AR-06 稳定
  └─ Wave C: AR-08 依赖审计与 Playwright CI

AR-07 可在 Wave B 独立执行
  └─ 最终串行验收
```

### 5.1 Wave A：可并行

- `export-backend` 执行 AR-01；
- `auth-backend` 执行 AR-03 中除 trusted proxy 配置字段外的内容；
- `frontend-runtime` 执行 AR-05。

### 5.2 Wave B：接口冻结后并行

- `runtime-storage` 执行 AR-02，并统一添加 S3 配置及 trusted proxy 配置字段；
- `infra-ops` 在配置名冻结后执行 AR-06；
- `quality-contract` 执行 AR-07。

### 5.3 Wave C：共享文件串行

- `runtime-storage` 在 AR-02 提交后执行 AR-04，因为两者都需要 `jobs/loop.go` 和 `httpapi/core.go`；
- `auth-backend` 在 trusted proxy 字段落地后完成 AR-03 的限流 source 部分；
- `quality-contract` 在前端与 E2E 栈稳定后执行 AR-08；
- `coordinator` 最后执行隔离容器和全链验收。

## 6. 31 项问题追踪矩阵

| ID | 问题摘要 | 工作包 | 关闭证据 |
| --- | --- | --- | --- |
| H1 | 公开页面被匿名 session 401 强制登录 | AR-05 | nav/index 单测 + 移动端公开路由 E2E |
| H2 | 缺少静态加密密钥时写入明文 | AR-02 | config 负测 + DB 新写入 `enc2:` |
| H3 | MinIO/BlobStore 未接入 | AR-01/02/06 | Compose 实际对象导出、下载、删除 smoke |
| H4 | 删除对象失败仍清指针 | AR-01 | nil/error/success 调度器单测 |
| H5 | 改密和撤销会话非原子 | AR-03 | V121 SQL + 两会话/回滚集成测试 |
| H6 | 备份默认 Compose 项目名错误 | AR-06 | 默认 FULL backup 命中 `deploy` 栈 |
| M1 | logout 撤销失败仍报成功 | AR-03 | store error 返回 503 且不清 cookie |
| M2 | 限流按 Caddy 地址聚合 | AR-02/03/06 | trusted proxy 单测 + Caddy smoke |
| M3 | 导出 key 不符合 V114 | AR-01 | worker 生成 `exports/{owner}/{id}-{16hex}.json` |
| M4 | 账户删除不取消本地 provider | AR-04 | 阻塞 provider 被取消，其他 owner 不受影响 |
| M5 | inactive 账号可枚举 | AR-03 | unknown/inactive/wrong password 响应一致 |
| M6 | JSON 解析失败伪装成空数据 | AR-05 | transport + memory 联动测试 |
| M7 | cancel 等待无界 HTTP 后才 abort | AR-05 | pending cancel 时立即 abort 单测 |
| M8 | send/regenerate 可重复提交 | AR-05 | deferred POST 并发测试 + 按钮禁用 |
| M9 | 模型保存回读失败仍提示成功 | AR-05 | PUT 200 + GET 500 组件测试 |
| M10 | 路由保存回读失败仍提示成功 | AR-05 | PUT 200 + GET 500 组件测试 |
| M11 | smoke 硬编码 119 migrations | AR-06 | 从 V 文件动态计算并在 disposable stack 验证 |
| M12 | Spring provider 示例仍被当作当前配置 | AR-07 | 删除文件及直接引用，当前入口指向 ADMIN 页面 |
| M13 | 未使用的 OpenAPI TS 生成器语义错误 | AR-07 | 删除未消费 TS artifact/生成逻辑，保留 bundle/snapshot |
| M14 | Catalog 接受不存在的 H5 caller | AR-07 | 真实路径存在性检查 + 14 条陈旧 caller 对账 |
| M15 | 空成本输入返回 PASS | AR-07 | 空/缺列失败，合法/超阈值 fixture 正负测试 |
| M16 | 无 memory metric 返回成功 | AR-07 | 无参数非零，单项合法指标可执行 |
| M17 | 跨关系测试声称 1000 实跑 500 | AR-07 | 循环与 notice 均为 1000 |
| M18 | 备份凭据进入 docker argv/config | AR-06 | argv/inspect/log 无密钥 + restore drill |
| M19 | pgx/x/text 可达漏洞 | AR-02 | 最小版本升级 + pinned govulncheck 0 reachable |
| M20 | 前端 audit 软门禁漏掉 nanoid High | AR-08 | nanoid 3.3.18 + ledger 对账硬门禁 |
| M21 | 11 个 Playwright journey 不进 CI | AR-08 | Linux-only E2E CI job 全项目通过 |
| L1 | `--quick` 仍执行 Go tests | AR-07 | quick 无 Go 依赖且预算内，full 仍跑 Go |
| L2 | Catalog 残留 Java packageName | AR-07 | 删除字段并重生成 snapshot |
| L3 | upgrade test 使用可变 DB tag | AR-06 | 与 DB 测试统一 digest |
| L4 | 当前文档固定写 V1–V119 | AR-07 | 当前态文档改为不易漂移的“嵌入式顺序迁移”表述 |

## 7. 工作包 AR-00：基线、接口冻结与安全盘点

### Owner

`coordinator`

### 必须做

1. 确认工作树 clean、HEAD、当前最大 migration 和现有项目容器状态。
2. 确认 V121 尚未被占用；只有 `auth-backend` 可以创建 V121。
3. 冻结以下配置名，后续 Agent 不得各自发明别名：
   - `VC_EXPORT_S3_ENDPOINT`
   - `VC_EXPORT_S3_ACCESS_KEY`
   - `VC_EXPORT_S3_SECRET_KEY`
   - `VC_EXPORT_S3_BUCKET`
   - `VC_HTTP_TRUST_PROXY_HEADERS`
4. 冻结代理 header 为单值 `X-Forwarded-For`；Caddy 必须覆盖客户端自带值，后端仅在 trusted proxy 开关启用时读取。
5. 冻结对象 key：`exports/{ownerId}/{exportId}-{16位小写十六进制}.json`，遵循 V114，不放宽数据库正则。
6. 记录唯一预计新增的生产依赖：`github.com/minio/minio-go/v7`。执行真正新增前必须取得 Owner 对该依赖的明确批准；若未批准，AR-02 标 `BLOCKED`，不得手写 SigV4 绕过。

### 只读真实数据盘点

用户项目容器仍停止时不启动它。恢复真实环境前才执行：

- 查询 `export_request.object_key` 和 `export_upload_intent` 数量；
- 列出 MinIO 中 `exports/` 与错误的 `export/` 前缀对象数量，只记录 key 形状和计数，不输出内容；
- 检查受保护字段是否存在最近新增的非 `enc2:` 数据，只输出计数；
- 检查 Compose volume/project 名，不重命名、不删除。

如果发现真实 `export/` 对象，立即停止自动清理并报告。只有真实存在时才另行制定一次性迁移；无数据时不建立永久兼容层。

## 8. 工作包 AR-01：导出对象 key 与清理顺序

### Owner 与范围

`export-backend`

允许修改：

- `backend/internal/jobs/export.go`
- `backend/internal/jobs/scheduler.go`
- `backend/internal/jobs/export_test.go`
- `backend/internal/jobs/scheduler_test.go`

若测试文件尚不存在可以创建；不得把 AR-01 测试塞入 `loop_test.go`，该文件留给 AR-02/AR-04 owner。

### 必须做

1. 在 worker 中按冻结格式生成对象 key；attempt 部分使用 `crypto/rand` 生成 8 bytes，并编码为 16 位小写 hex。
2. 随机源失败时任务明确失败，不使用固定值、时间戳、hash 或复用旧 key。
3. 保持 V114 顺序：生成 key → 记录 upload intent → Put → seal。
4. scheduler 在 `blobs == nil` 时保留指针并记录低基数错误。
5. `Delete` 返回错误时不调用 `ClearExportObject`；下一次 `RunOnce` 依靠现有指针重试。
6. `Delete` 成功后才 clear；clear 失败不增加第二套任务或状态表，依靠现有幂等 Delete + pointer 重试收敛。

### 明确不做

- 不修改 V109–V114；
- 不接受旧错误前缀作为新写入；
- 不增加重试队列、补偿表、死信或对象 reconciliation 框架；
- 不接入 MinIO、不改依赖；这些由 AR-02 完成。

### 最小验收

- 单测覆盖 key 格式、两次 attempt 不复用、随机源失败；
- scheduler 覆盖 blob=nil、Delete error、Delete success + Clear、Clear error 后再次收敛；
- 所有日志不包含对象内容或凭据；
- `GOPROXY=off go test -C backend -mod=vendor -count=1 ./internal/jobs` 通过。

## 9. 工作包 AR-02：加密 fail-closed、MinIO 接线与 Go 依赖

### Owner 与范围

`runtime-storage`

允许修改：

- `backend/internal/config/**`
- `backend/internal/app/**`
- `backend/cmd/companiond/**`
- `backend/internal/jobs/loop.go` 及直接受影响测试
- `backend/internal/httpapi/core.go` 及直接受影响测试
- 新增一个具体包 `backend/internal/blobstore/`
- `backend/go.mod`、`backend/go.sum`、`backend/vendor/**`

### AR-02A：静态加密 fail-closed

必须做：

- `ModeFull && Database.DSN != ""` 时强制要求当前 `VC_CRYPTO_REST_KEY` 有效且版本为正数；
- 在打开监听端口、启动 jobs、接受写请求前失败；
- 错误只说配置项无效，不回显值；
- 保留 enc1/旧明文 dual-read，只阻止新的无密钥写入；
- `api-migration`、`migrate`、`bootstrap` 不被错误要求提供运行期对象存储配置。

不做：

- 不重写 FieldCipher；
- 不自动生成密钥；
- 不自动迁移或回填历史行；
- 不添加多级 key fallback。

### AR-02B：一个具体 MinIO adapter

必须做：

1. 配置只包含冻结的 endpoint/access/secret/bucket；四项在 full+DB 模式全部必填，禁止生产静默回退 inline。
2. partial 配置和 endpoint/bucket 不可访问均在 startup/readiness 前失败。
3. 使用经 Owner 批准并固定版本的 `minio-go/v7`；不实现通用 provider registry。
4. adapter 只实现当前真实消费者需要的 `Put/Get/Delete`。
5. 同一个 adapter 实例同时传给 jobs loop 和 `httpapi.Core.Blobs`。
6. 对象内容继续使用现有 `FieldCipher` 的 `enc2` 格式：Put 前加密，Get 后解密；不创造第三种 envelope。
7. jobs 的 Put 必须能够获得实际写入对象的字节数；允许把 jobs 的 `Put` 改为返回 stored bytes，并把 HTTP 侧接口收窄为实际使用的 `Get/Delete`，不要新增 `Stat` 或第二套 size API。
8. runtime 使用同一个具体 `FieldCipher` 实例装配 PostgreSQL store 和 blob adapter，允许给 `app.Deps` 增加直接字段，不建立 DI 容器或全局 crypto service。
9. bucket 创建和匿名策略继续由 `minio-init` 负责；runtime 不提升权限、不自动建 bucket、不改 policy。

保留：

- 已有 inline export 的读取兼容和纯单元测试 fake；
- HTTP/OpenAPI 下载形状和一次性 token 语义。

不做：

- 不支持云 S3、region matrix、presigned URL、multipart upload 或版本控制；
- 不批量搬迁 inline payload；
- 不在本轮重做 `ConsumeExport` 协议。正常配置下的 Blobs=nil 503 必须消失；若真实 MinIO 故障暴露“一次 token 在对象读取失败时被消耗”的独立缺陷，单独记录，不在本轮临时改成非原子 peek/consume。

### AR-02C：最小依赖升级

必须做：

- pgx 升级到修复 `GO-2026-5004` 的最低兼容版本（审计基线为 `v5.9.2`）；
- `golang.org/x/text` 升级到修复 `GO-2026-5970` 的最低兼容版本（审计基线为 `v0.39.0`）；
- 增加固定版本的 MinIO client；
- 统一执行一次 `go mod tidy`、`go mod vendor`，不得手改 vendor；
- 仅处理上述依赖带来的必要间接版本，不执行 `go get -u ./...`。

### 最小验收

- config 单测：full+DSN 缺 key、缺任一 S3 配置、非法 endpoint 均失败；合法配置通过；
- adapter 单测：加密 Put、解密 Get、幂等 Delete、错误不泄密；
- composition test：loop 与 Core 获得同一个非 nil adapter；
- DB 集成：新消息/记忆/inline legacy 路径不会新增明文，新对象为 `enc2:`；
- 临时 MinIO：真实 Put/Get/Delete；
- `GOPROXY=off go build -C backend -mod=vendor ./cmd/companiond`；
- `GOPROXY=off go test -C backend -mod=vendor -count=1 ./...`；
- 使用固定版本的 `govulncheck` 一次性验证，不把新扫描器扩成第二套日常门禁；
- `python3 scripts/checks/check_licenses.py`。

## 10. 工作包 AR-03：认证、会话与代理限流

### Owner 与范围

`auth-backend`

允许修改：

- `backend/internal/httpapi/auth.go`
- `backend/internal/store/postgres/session.go`
- `backend/internal/migrate/sql/V121__atomic_password_and_session_revoke.sql`
- 认证/session 直接测试

`backend/internal/config/**` 由 AR-02 owner 修改，`ops/deploy/**` 由 AR-06 owner 修改。

### AR-03A：原子改密

必须做：

1. 新增 V121，`CREATE OR REPLACE` 现有 `vc.identity_change_current_password(text)` owner-bound wrapper。
2. wrapper 在同一函数/事务内完成密码更新与全部 opaque session 撤销；继续复用已有核心函数，不新增表和 session 类型。
3. actor 参数函数继续对 `vc_api` 撤权。
4. Go 使用 `WithOwner` 调用 current wrapper，删除提交后再调用 `RevokeAllOpaqueSessions` 的第二次数据库操作。
5. 任一步异常时密码和 session 状态一起回滚。

不做：

- 不修改已应用的 V92/V102/V116；
- 不改 cookie、CSRF、session token 格式或 refresh 历史兼容；
- 不新建 transaction manager。

### AR-03B：logout 如实失败

- 撤销 token 失败时返回 503，不清 session/CSRF cookie；
- 撤销成功或 token 已不存在时清 cookie 并返回 200；
- 不增加 logout queue、token blacklist 或自动重试。

### AR-03C：统一登录失败

- unknown、inactive、错误密码使用完全一致的 status、error code 和 body；
- 保留当前恒定成本 password match 路径；
- 不改变用户名规则、BCrypt 参数或登录 API。

### AR-03D：Caddy 后真实 source 限流

- AR-02 在 `HTTP` config 中增加默认 false 的 `VC_HTTP_TRUST_PROXY_HEADERS`；
- 开关关闭时只用 `RemoteAddr`，忽略任何伪造 header；
- 开关开启时只接受一个合法 IP 的 `X-Forwarded-For`；缺失、非法或多值时回退 `RemoteAddr`；
- 不实现代理链/CIDR 推断、Redis 或分布式限流。

### 最小验收

- SQL：两个 opaque sessions → 改密 → 两个会话立即失效；故意触发后半步错误时整体回滚；跨 owner 拒绝；
- HTTP：logout store error 返回非 2xx 且没有过期 Set-Cookie；
- 登录三种失败响应逐字节一致；
- proxy 开关关/开、合法/非法/多值 header 表驱动测试；
- `bash infra/db/run-go-store-tests.sh` 和 `bash infra/db/run-rls-tests.sh` 在最终阶段通过。

## 11. 工作包 AR-04：账户删除即时取消本地生成

### Owner 与范围

`runtime-storage`，必须在 AR-02 完成后执行。

允许修改：

- `backend/internal/jobs/loop.go`
- `backend/internal/jobs/generation.go`
- `backend/internal/httpapi/account.go`
- `backend/internal/httpapi/core.go`
- `backend/internal/store/postgres/account.go`
- 直接测试

### 必须做

1. `Cancels` 的注册项携带 owner ID，不只保存 generation ID。
2. 增加有界的 `CancelOwner(ownerID)`：只取消并移除该 owner 当前进程内 active contexts，返回首次实际取消数量。
3. 保持现有 durable deletion intent 为主边界：先让数据库阻止新的 outbound，再取消本进程 active provider contexts。
4. 把实际数量传给现有 `record_account_deletion_cancel_signals_current`；删除硬编码 0。
5. owner A 删除不得影响 owner B；重复删除不得重复统计已移除条目。

### 明确不做

- 不新增跨节点总线、轮询器或第二个 cancel registry；
- 不改变 single-runtime 决策；
- 不让本地 cancel 替代 durable DB cancellation；
- 不修改账户删除 HTTP/OpenAPI 形状。

### 最小验收

- Cancels 并发单测并运行 `-race`；
- 阻塞 fake provider → 删除 owner A → provider 收到 `context.Canceled`；
- owner B 继续运行；
- 记录数量与首次实际取消数一致；
- 完整账号删除对象清理在隔离 MinIO E2E 中验证，不对真实管理员执行。

## 12. 工作包 AR-05：前端行为修复

### Owner 与范围

`frontend-runtime`

允许修改：

- `frontend/src/domain/nav-runtime.ts` 及测试
- `frontend/src/pages/index/index.vue` 及测试
- `frontend/src/api/transport.ts`、必要的共享响应类型、transport/memory 测试
- `frontend/src/stores/chat.ts`、`frontend/src/pages/chat/chat.vue` 及测试
- `frontend/src/pages/admin-models/**`
- `frontend/src/pages/admin-routing/**`
- 最接近行为的既有 E2E journey

### AR-05A：公开路由与匿名恢复

必须做：

- 保留普通业务 transport 的全局 401 → `auth.onUnauthorized()` 行为；
- 只调整启动/首页匿名 session 恢复的专用 callback：401 落定 anonymous 并 `auth.clear()`，随后由现有 route guard 决定是否跳登录；
- public 首页、帮助、AI 说明保持原路径；protected 深链仍跳登录并保留 return。

不做：

- 不修改后端匿名 401；
- 不把 protected 路由公开；
- 不重写认证 store、导航守卫或建立第二套 session 恢复。

### AR-05B：JSON 解析失败可见

- transport 在 `response.json()` 失败时返回 `json: null` 且 `parseFailed: true`；
- 有效 JSON 保持当前行为；
- memory API 遇到 200 非 JSON 必须抛 parse error，不得返回空列表；
- 不引入 zod/ajv 或全 API schema 校验。

### AR-05C：取消立即 abort

- 发出一次 cancel 请求后，在同一操作中立即 abort 本地 SSE 并清恢复记录；
- cancel HTTP 作为 best-effort 独立完成，成功、失败、永久 pending 都不能阻塞本地 teardown；
- 捕获异步失败，禁止 unhandled rejection；
- 不增加全局 timeout/retry 框架。

### AR-05D：generation 创建 single-flight

- 在 store 增加一个只覆盖 generation 创建 POST 窗口的布尔状态；
- `send()` 与 `regenerate()` 共用该互斥；第二次并发调用直接忽略，不生成新 idempotency key；
- 成功、空结果、异常均释放；
- 页面发送/重试/重新生成按钮同步 disabled，但 store guard 才是正确性边界；
- 不建立 action queue，不重写聊天 phase 状态机。

### AR-05E：后台保存后回读

- 模型页和路由页的 reload 返回明确成功/失败；
- PUT 成功且 GET 成功才提示“已保存并生效”；
- PUT 成功、GET 失败提示“保存请求成功，但无法读取最新配置，请刷新确认”，保留旧 baseline/draft；
- PUT 失败保持既有错误/重新认证行为；
- 不做乐观更新、不自动重复 PUT、不重做后台布局。

### 最小验收

定向：

```bash
pnpm --dir frontend exec vitest run \
  src/domain/nav-runtime.spec.ts \
  src/pages/index/index.spec.ts \
  src/api/transport.spec.ts \
  src/api/memory.spec.ts \
  src/stores/chat.spec.ts \
  src/pages/chat/chat.spec.ts \
  src/pages/admin-models/admin-models.spec.ts \
  src/pages/admin-routing/admin-routing.spec.ts
```

稳定候选：

```bash
pnpm --dir frontend test:run
pnpm --dir frontend type-check
pnpm --dir frontend build
```

浏览器 E2E 至少断言：

- iPhone WebKit、Android Chromium 匿名公开路由不跳登录；
- protected 深链仍跳登录；
- 390×844 快速双击只产生一个 generation；
- 延迟 cancel 时 UI 立即停止；
- 关系选择器仍能通过 touch 打开/选择；
- 后台回读失败提示不被底部操作区遮挡。

不新增截图基线或设备矩阵。

## 13. 工作包 AR-06：部署、备份与隔离运行环境

### Owner 与范围

`infra-ops`

### AR-06A：Compose 与 MinIO 配置

- `runtime` 注入冻结的 S3 endpoint `http://minio:9000`、bucket、access、secret；
- Caddy 对反代请求覆盖为单值 `X-Forwarded-For`，runtime Compose 启用 trusted proxy；
- MinIO 继续私有 bucket，不开放宿主端口、不改匿名策略；
- `scripts/dev/e2e-stack.sh` 增加隔离 MinIO，使 full 模式和 export journey 测试真实对象路径；
- E2E 清理同时删除 PostgreSQL/MinIO 临时容器和进程，不碰用户项目 stack。

### AR-06B：备份项目名

- 标准无 `-p` 部署的现有项目名冻结为 `deploy`；
- `run-daily-backup.sh`、launchd 模板和 backup README 默认改为 `deploy` / `deploy_default`；
- 仍允许显式 `-p` / `VC_BACKUP_COMPOSE_PROJECT` 覆盖；
- 不自动扫描/猜测项目，不重命名 volume，不迁移数据库。

### AR-06C：备份凭据不进 argv/config

- Dockerized `mc` 使用当前 0700 临时目录内的 0600 secret 文件；
- 只把文件只读挂载给 one-shot container，由容器入口读取，docker argv 和 `docker inspect Config.Env` 不出现 secret 值；
- trap 清理文件，日志保持脱敏；
- 不引入 Vault、KMS、Swarm secrets 或常驻 secret service。

### AR-06D：动态 migration smoke

- 从 `backend/internal/migrate/sql/V*.sql` 计算 count/min/max，并与 `vc_schema_history` 比较；
- 检查重复版本和数字缺口即可；
- 不新增 migration manifest 或历史治理数据库；
- 当前 V120 和未来 V121 均无需手改常量。

### AR-06E：固定升级测试镜像

- `infra/db/run-upgrade-test.sh` 使用与 `run-rls-tests.sh` 相同的 digest；
- 不顺便升级 PostgreSQL/pgvector 版本。

### 最小验收

- `docker compose --env-file ... -f ops/deploy/docker-compose.yml config`；
- `bash -n` 覆盖修改的 shell；
- disposable `bash ops/deploy/smoke-drill.sh`；
- FULL `bash infra/db/backup/run-restore-drill.sh`；
- 实际 worker 生成对象，不能只用脚本手拼 `exports/` fixture；
- 导出下载后 object/pointer 消失；隔离账号删除后 owner 前缀无残留；
- 捕获宿主 argv、container inspect、stdout/stderr，均不得出现测试 access/secret；
- 所有 disposable container 清理完成。

## 14. 工作包 AR-07：契约工具、测量脚本与当前态清理

### Owner 与范围

`quality-contract`

### AR-07A：删除旧 Spring provider 模板

- 删除 `ops/model-providers.example.yml`；
- 删除它的直接当前态引用；ADMIN 页面和 Go API 仍是唯一 provider/model 配置入口；
- 不修改历史 ADR、旧 roadmap、tasks/evidence 中的 Java 事实。

### AR-07B：移除无消费者的伪 TypeScript client

当前 `specs/openapi/dist/typescript/api.ts` 没有生产消费者。最小方案不是实现一个完整 OpenAPI 生成器，而是：

- 删除该 TS artifact；
- 从 `scripts/dev/openapi_tool.py` 删除 TypeScript client 生成逻辑和虚假能力说明；
- 继续生成/校验 `api-bundle.yaml` 与 `openapi.snapshot.json`；
- 保持 OpenAPI source 和 drift gate；
- 不引入 openapi-generator、模板引擎或新 Node/Python 依赖。

### AR-07C：Catalog caller 路径真实存在

- 对 `currentH5Callers` 的每个仓库相对路径执行普通文件存在性验证；
- 逐条对账当前 14 个不存在路径：真实 caller 改成现行路径，已退役能力改为空列表；
- 不通过 glob、别名映射或兼容表让旧路径继续通过；
- 删除 `catalog-manifest.yaml` 的 Java `packageName`，用既有 generator 重生成 snapshot。

### AR-07D：测量脚本不能空跑通过

- cost reconciliation：usage 和 bill 都必须至少一条有效数据，缺列/空文件非零退出；
- memory stats：至少提供一个 metric 参数；每个已提供指标继续使用当前阈值和样本数；
- phase 81 循环真实执行 1000 次，notice 报 1000；
- 只增加小型正负 fixture/subprocess 测试，不建立测量框架或结果数据库。

### AR-07E：恢复 quick 语义

- `scripts/check.sh --quick` 只运行秒级 catalog/openapi/paid-features/licenses；
- Go tests 移回非 quick 分支；
- 普通 `scripts/check.sh` 仍运行 Go + frontend；
- 不新增 precheck/doctor 或第二入口；
- 实测 quick <5s、full <60s，并更新 `checks-principles.md` 当前表格中的真实值，不写虚构耗时。

### AR-07F：当前态文档去漂移

- README、`docs/architecture/repository-structure.md`、`docs/engineering/technology-baseline.md` 不再固定写 V1–V119，改成“嵌入式顺序迁移，当前版本以目录为真源”；
- `TODO.md` 与 ADR 中“切流时 V119 已应用”是历史事实，不改写成 V121；
- 不批量编辑历史文档。

### 最小验收

- OpenAPI validate/diff；
- Catalog validate/diff；
- 故意放入一个不存在 caller 时 validate 必须失败；
- 测量脚本空/合法/越阈值正负测试；
- `bash scripts/check.sh --quick` 在无 Go PATH 的受控环境仍通过；
- `bash scripts/check.sh` 仍执行 Go 与前端；
- 定向 `rg` 确认当前构建/部署/运行入口不再引用被删除的 Spring provider 模板。

## 15. 工作包 AR-08：依赖审计与 Playwright CI

### Owner 与范围

`quality-contract`，必须等待 AR-05/AR-06 稳定。

### AR-08A：前端 audit 硬门禁

必须做：

1. 将 `frontend/pnpm-workspace.yaml` 的 `nanoid@3` override 从 3.3.17 升到修复版本 3.3.18，并更新 lockfile。
2. 不把 nanoid 加入 exception ledger。
3. 增加一个单职责 checker，读取 `pnpm audit --json` 和现有 `docs/dependency-audit-exceptions.yaml`：
   - 未登记或已过期的 high/critical 失败；
   - 已登记且未过期的 High 允许但输出摘要；
   - audit 命令失败、空输出或 JSON 解析失败均失败；
   - moderate/low 本轮继续可见但不提升为新硬门禁。
4. CI 移除无条件 `continue-on-error`，由 checker 的退出码决定结果。
5. 只增加允许、未登记、过期三类最小 fixture/test；不建漏洞数据库、SBOM 平台或第二台账。

### AR-08B：Linux-only 浏览器 E2E

- CI 新增单一 Linux job，不做 OS matrix；
- 安装 Chromium + WebKit，运行现有 Playwright 三个 project；
- 设置 `E2E_DOCKER_CONTEXT=default`；
- 复用 Playwright `webServer` 和 `scripts/dev/e2e-stack.sh`，workflow 不复制启动逻辑；
- 失败上传 trace、`frontend/test-results/**` 和可用的 runtime/provider/H5 日志；
- job 结束执行现有 teardown，确认无 `vc-e2e-*` container/孤儿进程；
- E2E 不加入 `scripts/check.sh`，不新增 retry 来掩盖不稳定。

### 最小验收

- `pnpm --dir frontend install --frozen-lockfile`；
- `pnpm --dir frontend audit --json` + checker；
- `pnpm --dir frontend test:run && pnpm --dir frontend type-check && pnpm --dir frontend build`；
- `E2E_DOCKER_CONTEXT=orbstack pnpm --dir frontend test:e2e` 本机隔离运行；
- CI 语法与 job 完整执行一次。

## 16. 验证分层

### 16.1 工作包内定向验证

每个 Agent 只运行能证明自己改动的最小测试。输入未变化时不得重复全量检查。

### 16.2 稳定候选检查

代码和配置稳定后由 `coordinator` 运行一次：

```bash
bash scripts/check.sh
GOPROXY=off go test -C backend -mod=vendor -race -count=1 ./internal/jobs ./internal/httpapi ./internal/store/postgres
pnpm --dir frontend build
```

如果 race 包名与实际目录不匹配，只运行直接受并发改动影响的包，不扩大为全仓 race。

### 16.3 隔离容器验收

以下检查预计明显慢于日常入口，只在最终稳定候选运行一次，修复其发现的问题后只重跑受影响部分：

```bash
bash infra/db/run-rls-tests.sh
bash infra/db/run-go-store-tests.sh
E2E_DOCKER_CONTEXT=orbstack pnpm --dir frontend test:e2e
bash ops/deploy/smoke-drill.sh
bash infra/db/backup/run-restore-drill.sh
```

规则：

- 使用 OrbStack `orbstack` context；
- 只启动脚本自己命名并清理的隔离容器；
- 不启动或修改当前停用的 `ops/deploy` 用户项目；
- 任一命令预计或实际超过 10 分钟时，先报告当前进度、耗时来源和较小替代，再继续；
- 不保留测试 volume、明文 fixture、临时 secret 或真实用户数据。

### 16.4 真实环境验收

只有用户在实施阶段明确要求恢复项目容器后才执行：

1. 完成 AR-00 只读数据盘点；
2. 先验证一份可解密的 PostgreSQL + MinIO FULL backup；
3. 迁移 job 应用 V121，再启动更新后的 runtime；
4. 验证 health/version、匿名公开路由、登录/logout、ADMIN provider/model 读取；
5. 使用当前账号创建一次导出并下载，确认对象和 pointer 删除；
6. 不在真实管理员上执行账户删除或改密；这些只在隔离环境验收；
7. 不调用真实付费模型，除非用户另行明确授权一次真实 provider smoke；
8. 失败则保留日志和数据，不自动 reset、清库或删除疑似孤儿对象。

## 17. 停止条件

出现以下任一情况立即停止对应工作包并报告，不自行扩大：

- 工作树出现不属于当前 Agent 的重叠修改；
- V121 已被其他变更占用；
- Owner 未批准新增 `minio-go/v7` 生产依赖；
- 依赖升级要求改变 Go major/toolchain、uni-app 大版本或 Vue/Vite 主线；
- 真实 bucket 存在错误 `export/` 前缀对象，需要数据迁移；
- 需要新增表、队列、长期兼容模式或多云抽象才能继续；
- 需要删除/重命名真实 Compose volume；
- E2E 必须依赖真实 provider、真实账号删除或远端服务才能通过；
- 修复范围明显超过本文文件所有权或 31 项追踪矩阵；
- 任一安全检查只能通过吞退出码、加 skip、降低断言或扩充例外台账。

## 18. 最终交付报告格式

最终报告只保留以下内容，不创建任务卡、证据包或新治理目录：

1. 31 项按 `FIXED / ACCEPTED_EXCEPTION / BLOCKED` 的逐项状态；
2. 提交列表和已 push 分支；
3. 修改的生产依赖及批准记录；
4. `PASS / FAIL / NOT_RUN` 验证表；
5. 是否启动过隔离容器、是否恢复过用户项目容器；
6. 是否发现真实 `export/` 对象、非 `enc2` 新数据或备份异常；
7. 仍需 Owner 决策的唯一下一步。

当 31 项全部有终态、必要验证通过且用户项目状态符合要求时立即停止，不继续做可选重构。

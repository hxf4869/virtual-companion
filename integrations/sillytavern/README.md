# SillyTavern 集成（V2-W03-S1 / W03 受管装配）

V2 方向（ADR-0009）的锁定 ST 宿主开发入口：真实上游栈 + 本切片脚本，全部在本机 127.0.0.1 运行。
五个上游组件由 `upstream.lock.json` 固定 commit 与原始产物 SHA256；本目录自有代码按 AGPL-3.0-only
（`package.json`），许可门禁见 `scripts/checks/license-policy.yaml` 的 `domainPolicies.stIntegration`。

两条运行入口（互相独立，可同时运行）：

- **原生（S1）**：`bootstrap.mjs` / `start.mjs`，dataRoot `dev/data`，ST 127.0.0.1:8742 + mock 8743；
  核心桥补丁不参与，`enableServerPlugins=false`。
- **受管（managed，V2-W03 集成收口）**：`assemble-managed.mjs` / `start-managed.mjs`，dataRoot
  `dev-managed/data`，ST 127.0.0.1:8752；ST 源码以「最小可重放运行副本」`dev-managed/st-run` 运行，
  集中规格的核心桥补丁打在副本上（`upstream/` 永远保持原始），`enableServerPlugins=true` 装载
  `server-plugin/virtual-companion`；W05 起入口经 Go 密码+TOTP 登录（见「登录与身份」）。
  见下文「受管（managed）运行装配」。

## 首次准备

1. `upstream/`（gitignored）：按 `upstream.lock.json` 克隆五个仓库并 checkout 锁定 commit
   （bootstrap 不自动克隆，避免隐式网络写操作）：
   - SillyTavern 1.19.0（`7e8663cd9`）
   - Tavern Helper / JS-Slash-Runner 4.11.3（`0af42106`，PolyForm-Noncommercial → 仅 Owner 本人非商业使用）
   - ST-Prompt-Template 1.17.9（`d6f520d1`）
   - MagVarUpdate（MVU）（`d03b7dc8`）
   - TencentDB-Agent-Memory（`084bed45cad6bb7f877455082cee82835d65671a`，MIT），检出目录 `upstream/TencentDB-Agent-Memory/`
2. Node 22.13+（本机验证 22.23.1）；`npm ci`（安装 `devDependencies: playwright-core`，驱动本机 Chrome 做验收）。
3. `node scripts/bootstrap.mjs`：校验上游 commit/产物 SHA → ST 依赖树按锁 `npm ci`（联网）→
   下载 `vendor.lock.json` 固定的 npm 官方 tarball（联网，逐文件 sha256）→ 在 `dev/data` 重建
   dataRoot（复制 Helper/EJS、应用确定性补丁、自托管 vendor 与 MVU bundle）→ 生成 `dev/config.yaml`。
   `--offline` 复用已缓存资产；任何校验失败即硬失败，不产出半成品。

## 日常入口

| 命令 | 说明 |
| --- | --- |
| `node scripts/start.mjs` | 预检（配置不变量 / 依赖树 / 补丁与 vendor SHA / 端口）后启动 ST（127.0.0.1:8742）与本地固定 provider mock（8743）；PID 记录在 `dev/run/*.pid` |
| `node scripts/stop.mjs` | 只停 `dev/run/*.pid` 归属本实例的进程（核对进程命令行） |
| `node scripts/status.mjs` | 只读汇报进程 / `/version` / dataRoot 权限 / 配置不变量 / 依赖树与补丁、vendor 完整性（JSON） |
| `node scripts/assemble-managed.mjs` | 受管装配：校验 upstream 干净与依赖树 → 整体重建 `dev-managed/st-run`（复制源码树 + `node_modules` 符号链接 + 核心补丁）→ 部署 server plugin 与 `vc-model-settings` 扩展（排除 `harness/`）→ 写受管 `config.yaml`（`enableServerPlugins:true`、`enableUserAccounts:true`、SSO 头自动登录禁用）与 `derived-manifest.json`；幂等可重跑 |
| `node scripts/start-managed.mjs` | 受管启动（127.0.0.1:8752）：预检含核心补丁输入/输出 SHA、upstream 干净、部署完整性与 Go 桥接环境硬校验；缺独立 `VC_MEMORYCORE_SERVICE_TOKEN` 或 `VC_ST_GO_BASE_URL` / `VC_ST_PLUGIN_SERVICE_TOKEN`（>=32 字节）/ `VC_ST_ACCOUNT_HANDLES`（非空 Go 账号→ST handle 映射）即硬失败退出，绝不静默降级回原生 Key；健康等待公开 `/auth/`；PID/日志在 `dev-managed/run/` |
| `node scripts/stop-managed.mjs` | 先停止核验归属的 `memorycore.pid`，再停 `dev-managed/run/st.pid` 归属受管实例的进程（核对命令行，不碰 8742/8743 原生实例） |
| `node scripts/status-managed.mjs` | 只读汇报受管实例状态（JSON；登录入口 `/auth/` 探活、账号映射只报 configured 布尔，不输出密钥与映射值） |
| `node scripts/accept.mjs [--only C07]` | 真浏览器验收（下节）；不进 `scripts/check.sh` |
| `node scripts/accept-managed.mjs [--filter <场景,…>]` | 受管端到端验收（见「受管端到端验收」节）：默认 14 个接口/协议场景；`ui03-browser` 真实界面场景需显式 `--filter`；不进 `scripts/check.sh` |
| `node scripts/protection-report.mjs [--archive … --key-file …]` | C1/D01 保护清单与权限报告（只读） |
| `bash scripts/backup.sh <dataRoot> <config.yaml\|-> <out.vcbae1>` | C1 加密备份（tar → openssl aes-256-cbc → `vc_aead.py` VCBAE1 认证封装），口令用环境变量或 0600 keyfile |
| `bash scripts/restore.sh <archive.vcbae1> <空目标目录>` | MAC 先校验再解密，恢复到隔离目录（0700/0600），不覆盖原 dataRoot |
| `node --test "tests/*.test.mjs"` | 离线单测（S1 config / backup / patcher / lock 与 S3/S4 扩展、协议、桥接测试），已并入 `scripts/check.sh` 全量 |

目录：`scripts/`（入口与 `lib/` 共享实现）、`tests/`、`patches/`（确定性补丁规格）、
`dev/`（原生 dataRoot 与运行产物，gitignored）、`dev-managed/`（受管 dataRoot、st-run 运行副本与
运行产物，gitignored）、`upstream/`（gitignored）、`extension/`（S3 扩展，另见其目录）。
`.local/` 是 W00 调试遗留，gitignored，不是交付物。

## 本机运行说明（W16-2）

V2 只在本机受管栈运行：本目录的 SillyTavern 与 MemoryCore，加上 Go `companiond`、PostgreSQL、MinIO。
`ops/deploy` 的 Compose 只含 `companiond`、PostgreSQL、MinIO、Caddy，不含 SillyTavern，不含 MemoryCore，不是 V2 栈。
远端部署未授权（`TODO.md` 的 `V2-OWNER-DEPLOY`）。

并行 worktree 在仓库根先执行 `set -a; . ./.vc-wt.env; set +a`，只用该文件里的端口和容器名。
没有该文件时，脚本默认是 ST `127.0.0.1:8752`、Go `8095`、MemoryCore `8754`，容器 `vc-w03-managed-pg` / `vc-w03-managed-minio`。
口令、DSN、服务令牌与 S3 凭据只放进程环境或 0600 文件，不写入仓库、argv 或说明。

除「升级与回退」标明未执行外，下面写出的命令都在 2026-10-29 于本机合成环境执行并成功。工作树为 `v2/w16`（`051585fb`）。环境文件把 ST 放到 `9852`、Go 放到 `9195`、MemoryCore 放到 `9854`，容器名为 `vc-w16-managed-pg` 与 `vc-w16-managed-minio`。时间为 CST。

### 启动

`bootstrap.mjs` 写原生 `integrations/sillytavern/dev`。环境里若已把 `VC_ST_DEV_DIR` 指到受管目录，这条命令必须改回原生目录。

```bash
VC_ST_DEV_DIR="$PWD/integrations/sillytavern/dev" node integrations/sillytavern/scripts/bootstrap.mjs
```

2026-10-29 13:12:16–13:12:23，退出码 0。五个上游 HEAD 与 `upstream.lock.json` 一致，生产依赖 667 个包与锁一致，vendor 18 个文件校验通过。本工作树的 `upstream/` 指向主检出，未执行 `npm ci`。

加载本链 `.vc-wt.env` 后：

```bash
node integrations/sillytavern/scripts/assemble-managed.mjs
```

13:13:46–13:13:47，退出码 0。重建 `dev-managed/st-run` 与 `memorycore-run`，18 个核心补丁的输入/输出 SHA 通过，扩展 28 个文件（排除 `harness/`）。装配保留已有数据目录；本轮目录是新建的。

Go、PostgreSQL、MinIO 不由 `start-managed` 拉起。现有编排在 `scripts/accept-managed.mjs`：标签 `com.vc.w03=managed`，容器名取 `VC_W03_PG_CONTAINER` / `VC_W03_MINIO_CONTAINER`，镜像为 `pgvector/pgvector:0.8.5-pg18` 与本机已有的 `vc-g12-minio-tools:local`（不自动拉取），端口是随机的 `127.0.0.1` 高端口。本轮按同一约定执行，均成功：

- 13:13:04 `docker run -d --name "$VC_W03_PG_CONTAINER" --label com.vc.w03=managed -e POSTGRES_PASSWORD="$PG_PASSWORD" -e POSTGRES_DB=vc -p 127.0.0.1::5432 pgvector/pgvector:0.8.5-pg18`。13:13:21 容器内 `pg_isready -h 127.0.0.1 -p 5432 -U postgres -d vc` 通过。本轮发布端口 33396。
- 13:13:21–13:13:28 `GOTOOLCHAIN=go1.26.10 GOPROXY=off go run -C backend -mod=vendor ./cmd/companiond migrate`（`VC_MIGRATE_DB_DSN`），输出 `companiond migrate complete`。
- 13:13:28–13:13:29 同一工具链 `./cmd/companiond bootstrap`（`VC_BOOTSTRAP_DB_DSN`、`VC_OWNER_BINDING_SECRET`），输出 `companiond bootstrap complete`。
- 13:13:29 `docker run -d --name "$VC_W03_MINIO_CONTAINER" --label com.vc.w03=managed -e MINIO_ROOT_USER="$MINIO_USER" -e MINIO_ROOT_PASSWORD="$MINIO_PASS" -p 127.0.0.1::9000 vc-g12-minio-tools:local server /data`。13:13:31 `GET /minio/health/live` 成功。本轮发布端口 33397。
- 13:13:31–13:13:32 用同一镜像的 `mc`，经 `--network container:<MinIO>` 和用完即删的 0600 配置执行 `mb --ignore-existing w03/$VC_W03_S3_BUCKET`。输出 `Bucket created successfully`。
- 13:13:32 `GOTOOLCHAIN=go1.26.10 GOPROXY=off go build -C backend -mod=vendor -o <仓库外临时路径> ./cmd/companiond`，随即以前台环境启动该二进制（`VC_MODE=full`、`VC_HTTP_ADDR=127.0.0.1:$VC_W03_GO_PORT`、`VC_HTTP_ORIGINS` 为受管 ST 的 origin、`VC_DB_DSN`、`VC_CRYPTO_REST_KEY`、`VC_EXPORT_S3_*`、`VC_ST_PLUGIN_SERVICE_TOKEN`、`VC_ST_HOST_BASE_URL`、`VC_MEMORYCORE_BASE_URL`、`VC_MEMORYCORE_SERVICE_TOKEN`）。13:13:33 `GET /actuator/health` 为 `{"status":"UP"}`，`/api/v1/version` 返回本轮设置的 `w16-runbook`。`accept-managed.mjs` 把二进制和 `go.log` 放在当轮 `dev-managed/run` 与 `dev-managed/artifacts/accept-<时间>/`，本轮为避免把验收产物写进仓库，二进制和 Go 日志放在仓库外。

桥接环境就绪后（`VC_ST_GO_BASE_URL`、至少 32 字节的 `VC_ST_PLUGIN_SERVICE_TOKEN`、非空 `VC_ST_ACCOUNT_HANDLES`、至少 32 字节的 `VC_MEMORYCORE_SERVICE_TOKEN`）：

```bash
node integrations/sillytavern/scripts/start-managed.mjs
```

13:13:47–13:13:53，退出码 0。ST `http://127.0.0.1:9852/auth/` 返回 HTTP 200 与 HTML，pid 81818。本轮未设置 MemoryCore callback token，`/readyz` 为 `foundation=true`、`storageReady=true`、`businessReady=false`。

### 状态、停止与日志

```bash
node integrations/sillytavern/scripts/status-managed.mjs
```

13:13:53，退出码 0。ST `auth.ready=true`，MemoryCore pid 存活且 health HTTP 200；输出只有 token 与映射是否已配置，没有值。

```bash
node integrations/sillytavern/scripts/stop-managed.mjs
```

13:14:30，退出码 0。先停 MemoryCore，再停受管 ST，并确认端口 9852 已释放。该命令不停 Go、PostgreSQL 或 MinIO。

停止后再次执行 `status-managed.mjs`（13:14:30，退出码 0）：`memorycore.alive=false`，`st.alive=false`。

日志：

- ST：`$VC_ST_DEV_DIR/run/st.log`。13:13:53 为 0600、33243 字节。
- MemoryCore：`$VC_ST_DEV_DIR/run/memorycore.log`。13:13:53 为 0600、28 字节，内容是 `MEMORYCORE_FOUNDATION_READY`。
- Go 不由 `start-managed` 写固定日志。本轮把进程标准输出重定向到仓库外临时文件（13:13:33 为 1182 字节）。未把上游 ST 日志逐行审计一遍。这些日志都不在 `backup.sh` 清单内。

### 备份与恢复

先停 MemoryCore。服务持有 `memorycore-data/runtime.lock` 时，快照会拒绝。口令用 `VC_ST_BACKUP_PASSPHRASE` 或 0600 的 `VC_ST_BACKUP_PASSPHRASE_FILE`，只能设一个，不能放在 dataRoot 内，也不能与归档同目录。`owners/` 存在时会纳入 MemoryCore，此时 `VC_MEMORYCORE_DATABASE_URL` 与 `VC_MEMORYCORE_PG_CONTAINER` 必须恰好设置一个。MemoryCore 数据根默认是脚本旁的 `dev-managed/memorycore-data`，不读 `VC_ST_DEV_DIR`；目录被环境改掉时要另设 `VC_MEMORYCORE_DATA_ROOT`。

本轮停止后写入合成聊天 `data/default-user/chats/w16-synthetic/marker.jsonl` 和合成 `memorycore-data/owners/1/vectors.db`，再执行：

```bash
bash integrations/sillytavern/scripts/backup.sh \
  "$VC_ST_DEV_DIR/data" \
  "$VC_ST_DEV_DIR/config.yaml" \
  "$OUT"
```

13:14:31，退出码 0。归档在仓库外，模式 0600，4432071 字节；明文 tar 4431872 字节、59 个条目；自校验与原始 tar 字节一致；密钥来源为环境变量。打包清单含 `cookie-secret.txt`、`settings.json`、`chats`、`group chats`、`groups`、`characters`、`worlds`、`backups`、`OpenAI Settings`、`user` 与 `_config/config.yaml`。本轮没有 `secrets.json`，脚本跳过。`_memorycore/owners/1/vectors.db` 在随后的恢复副本中，行内容与合成标记一致。没有保留期剪枝，也没有定时任务。

```bash
bash integrations/sillytavern/scripts/restore.sh "$ARCHIVE" "$EMPTY_DIR"
```

13:14:31，退出码 0。目标是新建空目录。59 个条目，目录 0700、文件 0600。合成聊天与 `vectors.db` 在副本中可读，原 dataRoot 里的同名文件仍在。副本没有 `_vc_accounts/`，也没有 `.vc-f2/`。`_memorycore/restore-pending.json` 已由当前 PostgreSQL 重写（95 字节）。归档里的 `go-rights.json` 不作为恢复后门禁。这次只证明解包到空目录成功。D06 另有离线演练：存在时把 `_vc_accounts/` 与各用户 `.vc-f2/` 打进归档；删除清单写在归档外。恢复先保持 `restore-gate.json` blocked，用当前库并上那份清单清理后再删除标记。

需要把 PostgreSQL 打进同一份归档时，设置 `VC_BACKUP_PG_DSN` 或 `VC_BACKUP_PG_CONTAINER`，恰好一个。脚本用 `pg_dump -Fc`（自定义格式）写入归档内的 `_postgres/db.dump`，并附带不含口令的 `_postgres/source.json`。DSN 的口令只写入临时 0600 `PGPASSFILE`；容器模式在容器内执行。两者都不设置时不导出数据库，输出标明「未含 PostgreSQL」。

MinIO 不备份。应用对象是 `exports/<owner>/<id>-<hex>.json`，约 24 小时过期，是对话与记忆的临时下载副本，由 scheduler 清理。权威数据在 PostgreSQL 与 ST 文件里。过期副本不进归档，恢复也不会把它们复活；需要时重新导出。

`restore.sh` 发现 `_postgres/db.dump` 时，在同一实例上 `CREATE DATABASE` 一个新的 `vc_restore_*` 库并 `pg_restore`。不覆盖、不改名当前库，也不自动切换。成功时输出 `RESTORED_DATABASE name=... source=... switched=false`，由 Owner 决定是否改连接。新库装入快照之后、删除 `restore-gate.json` 之前，先把删除并集应用到该库：当前库删除意图 ∪ 归档外删除清单 ∪ 当前数据根。顺序是删除列出的记忆行、列出的会话、已经没有会话且不属于被删账号的关系、再删除账号（`vc.vc_user`），最后把当前库里这些账号的 `account_deletion_intent` 复制进新库。任一步失败则退出 5，恢复门保持 blocked，并丢掉未完成的新库。文件侧仍用同一并集清理，且不写回当前库。数据库不可达时同样失败并保持 blocked。

旧的 `infra/db/backup/run-daily-backup.sh` 仍是 Go 库与对象存储那条历史链路（含 MinIO mirror），不含 ST dataRoot 与 MemoryCore，不是 V2 入口。不设定期备份。

### 升级与回退（未执行，仅说明）

没有单独的升级或回退命令。五个上游 commit 记在 `upstream.lock.json`。应用升级是修改锁中的 commit 与对应产物 SHA256，再执行 `assemble-managed.mjs`：重建 `st-run` 与 `memorycore-run`，保留 `data/` 与 `memorycore-data/`。回退应用是把锁改回上一组 commit 后重新装配。PostgreSQL 迁移不承诺降级。本轮没有修改锁，也没有为升级或回退重跑装配。

### C1 数据清单

记忆域明文是 Owner 已决定项（ADR-0009 §2）。磁盘加密、备份放在哪、留多久、密钥放在哪、ST 聊天留多久，仍是 `V2-OWNER-PROTECTION`。2026-10-29 13:12 `fdesetup status` 的结果是 `FileVault is Off`。目录 0700/0600 和备份加密都没有满足 D01.a。

| 数据 | 位置 | 正文或私密 | 加密 | 备份是否覆盖 |
| --- | --- | --- | --- | --- |
| ST 聊天、群聊、角色、世界书、自动备份、secrets、设置与 cookie secret | 受管 `dev-managed/data`（`VC_ST_DEV_DIR`）；原生在 `dev/data`。清单见 `backup.sh` | 含。jsonl 与 secrets 在 dataRoot 内可被 ST 进程读取 | 静态明文。只在 `backup.sh` 打成 VCBAE1（openssl aes-256-cbc，再经 `vc_aead.py` 封装） | 覆盖清单内已存在的路径。排除 `extensions/` 与锁定的 MVU bundle。无保留期 |
| ST 身份墓碑 | 用户根下 `.vc-f2/*.json` | 身份、路径、revision，不含正文副本 | 明文 | 目录存在时进入 `backup.sh`。恢复不拿归档里的旧墓碑当权威，改用当前库、当前数据根和归档外清单的并集 |
| 账号映射与删除状态 | `DATA_ROOT/_vc_accounts/<id>.json` | 账号到 handle，以及 ACTIVE/DELETING/DELETED | 明文 | 目录存在时进入清单。同上，归档内的 ACTIVE 不能抵消当前删除 |
| Go PostgreSQL `vc.*` | 受管验收容器或本机合成容器中的库 | 记忆、摘要、来源快照含正文。凭据、TOTP、通知渠道凭据、导出口令仍走字段加密 | 记忆域明文（`V146__memory_plaintext.sql`，列名仍是 `content_cipher` / `temporal_cipher`）。其余为 AES-256-GCM `enc2` | `VC_BACKUP_PG_DSN` 或 `VC_BACKUP_PG_CONTAINER` 恰好其一时，`pg_dump -Fc` 打进同一 VCBAE1。都不设置时输出「未含 PostgreSQL」。恢复只进新的 `vc_restore_*` 库，不覆盖当前库。旧每日脚本不是 V2 入口 |
| 删除意图 | `vc.account_deletion_intent`，以及已删除的 conversation / relationship 映射 | digest、身份与路径，不是正文 | 不是字段加密 | 不打进归档。`backup.sh` 在设置了当前库时把最新清单写到 `VC_ST_DELETION_MANIFEST`（默认与归档同目录的 `deletion-manifest.json`）。恢复与当前库取并集，不写回 PostgreSQL。MemoryCore 的 `go-rights.json` 仍只是当时读到的权利；恢复先读当前库，再与清单里的权利取交集，避免回滚后的库把已删记录加回 allowlist |
| MemoryCore | `dev-managed/memorycore-data/owners/<十进制 owner>/` | 含。`vectors.db`、jsonl、画像与操作记录可含派生文本 | 明文，目录 0700、文件 0600。Owner 决定不加密 | `owners/` 存在时纳入，排除 wal/shm 与 `runtime.lock`。本轮已验证。无保留期 |
| MinIO 导出对象 | `exports/<owner>/<id>-<hex>.json` | 含对话与记忆副本 | 上传前字段加密 | 约 24 小时过期的临时下载副本。默认不进 `backup.sh`：权威数据在 PostgreSQL 与 ST 文件，过期副本不备份、不随恢复复活。本轮只建了空桶，没有导出对象 |
| 本机 embedding | 约定 `127.0.0.1:11438` 的 `qwen3-embedding:0.6b`，容器名 `vc-w08-embedding` | 请求瞬时可能含记忆文本；容器内是模型权重 | 无应用层加密 | 无备份。仓库没有创建该容器的脚本。本轮未启动 |
| 日志 | `dev-managed/run/st.log`、`memorycore.log`；Go 为进程自身输出 | 插件约定禁止正文与令牌。本轮 MemoryCore 日志只有固定就绪码 | 明文。MemoryCore 日志文件为 0600 | 不进备份 |

恢复门是副本里的 `restore-gate.json`。`companiond` 启动时读取 `VC_RESTORE_GATE_FILE` 指向的路径，每次领取任务和读取记忆时再读文件内容。文件为 `{"blocked":true}`、内容无效或无法读取时，不领取任务、不跑恢复、不投递通知，记忆列表/详情/证据返回 `503 RESTORE_GATE_CLOSED`。文件不存在或 `blocked` 为 false 时开放。`restore.sh` 在清理完成前留下 blocked，成功后删除该文件。上面 13:14 的空目录解包没有删除状态，不能代替 D06 演练；演练在 `tests/backup-d06.test.mjs`。

### 已知缺口

- MinIO 导出对象不备份，也不由 `restore.sh` 恢复。它们约 24 小时过期；删掉的下载副本不会从归档回来，需要时重新导出。
- PostgreSQL 恢复只创建隔离库，不自动切换生产库。切换前恢复门保持 blocked，直到删除并集已应用到新库。
- 备份位置、保留期、密钥存放位置、FileVault 或等价卷加密、ST 聊天留存期限仍待 Owner（`V2-OWNER-PROTECTION`）。成功恢复会标明 `expires=unset`，不把在线删除写成离线副本已经消失。远端常驻部署仍待 Owner（`V2-OWNER-DEPLOY`）。

## 受管（managed）运行装配

W03 集成收口的受管链路：ST 前台生成经 server plugin 桥接 Go 后端（Go 为模型目录与凭据唯一权威），
`upstream/` 始终保持原始（HEAD 对锁、工作树干净），集中规格的核心桥补丁只打在运行副本上。

- **运行副本 `dev-managed/st-run`**：ST 源码树复制品（顶层排除 `.git`/`node_modules`/`data`/`backups`/`colab`）；
  `node_modules` 用符号链接指向 `upstream/SillyTavern/node_modules`（原生 bootstrap 已按锁定 package-lock
  重建并校验，受管只复用不重建）。`assemble-managed` 按集中规格（`scripts/lib/paths.mjs` 的
  `CORE_PATCH_SPECS`）对副本应用核心补丁：app 级单点登录钩子（`st-host-auth`）、登录客户端与
  F2 全链 CAS 系列、`/generate` 桥与 provider 正文日志收口（输入/输出 SHA256 硬校验，不匹配即
  失败；清单以 `CORE_PATCH_SPECS` 为准，不在此固定数量）。副本整体重建，重跑逐字节一致。
- **部署**（同为可重放派生物，整体重建）：`server-plugin/virtual-companion` → `st-run/plugins/virtual-companion/`
  （ST serverDirectory/plugins 装载点）；`extension/vc-model-settings` → `dev-managed/data/default-user/extensions/vc-model-settings/`
  （排除 `harness/` 开发验收用具）。W04 起复用 `bootstrap --offline` 将锁定 Helper / EJS / MVU
  装配到受管 dataRoot；只复用原生 `dev/vendor-cache` 静态资源（可用 `VC_ST_VENDOR_CACHE` 指定），
  不复制原生聊天、设置或凭据。派生产物记录在 `dev-managed/derived-manifest.json`；`upstream.lock.json` 不改。
- **配置与环境**：受管 `config.yaml` 与原生共用同一安全不变量体系；在原生全部保护之上，受管差异为
  `enableServerPlugins=true` 与 `enableUserAccounts=true`（Go 唯一身份经 ST 账户会话绑定本地 handle），
  并显式禁用 SSO 头自动登录（`sso.autheliaAuth` / `sso.authentikAuth` 均 `false`、
  `sso.trustedProxies=[]` 不信任任何转发头）；ST 原生登录、恢复与账号管理 API 由登录中间件拒绝
  （唯一例外：认证后的 `GET /api/users/me` 只读自身 profile），不构成第二套入口。
  `enableServerPluginsAutoUpdate=false`、扩展 `autoUpdate=false` 等其余不变量不变。
  端口默认 127.0.0.1:8752（`VC_ST_PORT` 可覆盖）；运行目录默认 `dev-managed`，dataRoot 在其 `data/`
  子目录中（`VC_ST_DEV_DIR` 可覆盖运行目录，供测试隔离；指向原生 `dev/` 会被拒绝）。
  原生（S1）离线 dev 配置不变：`enableServerPlugins=false`、`enableUserAccounts=false`，无上述
  桥接环境与登录要求。
- **启动门槛**：`start-managed` 要求 `VC_ST_GO_BASE_URL`（如 `http://127.0.0.1:8095`）、
  `VC_ST_PLUGIN_SERVICE_TOKEN`（>=32 字节）与 `VC_ST_ACCOUNT_HANDLES` 存在且有效，否则硬失败退出
  ——受管宿主策略不静默降级回 ST 本地密钥；三者与可选 `VC_ST_GO_TIMEOUT_MS` 透传给 ST 进程环境，
  不落盘（`VC_ST_ACCOUNT_HANDLES` 预检解析后重新序列化透传，原始值与解析值都不写配置文件与日志）。
- **登录与身份（W05）**：Go 密码 + TOTP 是唯一可见登录。`VC_ST_ACCOUNT_HANDLES` 是显式私有环境变量：
  Go 账号 ID→ST 本地 handle 的 JSON 对象，不能为空映射；账号须为正整数 ID，handle 仅限字母数字与
  `_-` 且不可复用（两个账号不能绑定同一 handle），校验失败即拒绝启动。server plugin 的
  `lib/host-auth.js` 提供 app 级单点登录钩子（插件 `init` 注册到全局桥对象，`st-host-auth`
  补丁让 server-main 在 ST 用户解析、静态资源与原生 API 之前调用它）：未登录访问 `/`
  跳转 `/auth/`；`/auth/` 静态登录页（`server-plugin/virtual-companion/auth/`）与 `/auth/api/*`
  （会话查询 / 登录 / 注销 / 改密与重验证 / TOTP 设置与确认 / 恢复码）代理到 Go `/api/v1/auth/*`，
  只透传 `vc_*` cookie 与必要头，不信任 `Remote-User` 等客户端身份头；Go 会话须 ACTIVE 且已启用
  TOTP，才按映射绑定本地 handle 进入聊天空间。start-managed / status-managed 的就绪探针只读公开的
  `/auth/`（HTTP 200 + HTML）；`/version` 等其余资源都在认证之后，未认证响应不判为不健康。
- **F2 保存冲突（W05）**：聊天 JSONL 的 live revision 是唯一权威；`.vc-f2` 只存身份、墓碑与中断恢复
  信息，不构成第二份内容真源。原生保存 / 改名 / 删除 / 导入 / 群聊 / 角色批量 / DataMaid / 启动迁移
  全链路带 CAS 版本检查，force 参数不能绕过；冲突输入只保留在本页，经显式复制 / 重载才能落到新版本。
  Tavern Helper 与 MVU 的异步写入有来源守卫，不冒充原生保存链路。验收入口：
  `node scripts/accept-managed.mjs --filter auth-browser,f2-native,f2-browser`（浏览器场景需
  `VC_W03_CHROMIUM_PATH` 指向本机真实 Chromium 系浏览器）；结果状态由外层统一回填，本节不预设通过。
- **桥接语义**：ST 侧的模型保存、用途绑定与仅配置投影零上游请求；受控取用（显式连接检查/目录拉取）
  与生成是分开的显式动作。写请求携带 Go 会话身份快照头（`X-VC-Expected-Account-ID` /
  `X-VC-Expected-Session-ID`），revision 冲突返回 409 且界面草稿保留；模型 Key 不回显，界面只显示状态。
- **生命周期边界**：`assemble-managed` / `start-managed` 负责 ST 与 MemoryCore，不拉起 Go、PostgreSQL 或 MinIO。
  这三项按 `accept-managed.mjs` 的容器与环境约定启动，命令和 2026-10-29 的执行结果见上文「本机运行说明」。
  默认容器名是 `vc-w03-managed-pg` 与 `vc-w03-managed-minio`；并行 worktree 用 `.vc-wt.env` 覆盖。
  原生实例（8742/8743）与受管实例互不接管，`stop`/`stop-managed` 各按自己的 pid 文件收口，也不停 Go 与数据库容器。
- 冻结端口约定：受管 ST=8752、合成 provider=8753、Go=8095；Go 侧 `VC_HTTP_ORIGINS` 需含
  `http://127.0.0.1:8752`。

## 受管端到端验收（scripts/accept-managed.mjs）

单命令拉起完整受管合成栈并跑接口/协议验收场景（不进 `scripts/check.sh`）。用法与全量场景清单
`--help` 可见；退出码 0=全部所选场景通过、2=用法错误、3=生命周期失败、4=场景失败（结果 JSON 仍写出）。

- **默认 14 场景**（无参全选）：`login-shape`（合成 Owner 登录请求形状）、`catalog-admin`（Go 建
  provider/模型/用途绑定 + UI03 API 面：保存/读回/Key 三态/独立用途/409 保留草稿）、
  `zero-upstream-on-save`（保存与仅配置投影零上游请求）、`service-resolve`（受控取用：精确 ID /
  revision 冲突 / 邻值拒绝）、`e2e-chat` / `e2e-responses` / `e2e-anthropic`（三协议经真实 ST
  `/generate`）、`tool-round`、`cancel-stream`、`context-budget`、`native-drift`、`key-revoke`、
  `revision-conflict`、`continuation-hygiene`。
- **`--filter <场景,…>`**：按场景 id 具名选择，依赖闭包自动补齐且依赖先行（如 `--filter e2e-chat`
  会自动先跑 `catalog-admin` 建目录）；`--dry-run` 只做 fixture 与断言库自检，不碰 docker/Go/ST 完整栈。
- **`ui04-browser`（可选，默认不选）**：`--filter ui04-browser` 通过完整 Go / ST 栈复用 C04 / C05 与
  UI02 基础浏览器验收，实际加载本项目聊天导航、模型投影及锁定 Helper / EJS / MVU。只使用本地合成
  provider；360 / 390 窄视口和短视口不替代目标手机或软键盘验收。只复验已有合成卡的 UI02 时，
  指定 `VC_W04_CASES=UI02 VC_ST_ACCEPT_CHARACTER=<已通过C04/C05且当前状态为8的合成卡名>`；
  原生流程会重新打开该卡、核对其合成标记和真实状态，不重跑已经通过的 C04/C05。
- **`ui03-browser`（可选真实界面场景，默认不选）**：`--filter ui03-browser` 显式执行，真实浏览器完成
  UI03 全流程（编辑保存读回 / 409 冲突保留草稿 / Key 只显状态 / 用途绑定投影写原生设置 / 三协议经
  原生界面发送）。浏览器由 `playwright-core` 驱动（随 `npm ci` 安装），可执行文件以
  `VC_W03_CHROMIUM_PATH` 指定本机已有 Chromium 系浏览器的绝对路径，不要求 Playwright 自带浏览器
  已下载：
  `VC_W03_CHROMIUM_PATH=/absolute/path/to/chrome node scripts/accept-managed.mjs --filter ui03-browser`。
- **`story-view-browser`（W12 玩家剧情页，默认不选，不调用模型）**：扩展菜单「剧情」打开独立页面。
  先在本链工作目录执行 `set -a; . ./.vc-wt.env; set +a`，再用本链端口与容器名运行
  `node integrations/sillytavern/scripts/accept-managed.mjs --filter story-view-browser`。
  页面放在现有扩展 `vc-model-settings`（`story-page.js`），因为受管装配只部署该扩展。
  验收覆盖开局、玩家可见视图、桌面三列与 390px 单列；不提交行动、不回档、不显示结局。
- **`story-outbound`（W13 三协议剧情出站，默认不选）**：先在本链工作目录执行
  `set -a; . ./.vc-wt.env; set +a`，再用本链端口与容器名运行
  `node integrations/sillytavern/scripts/accept-managed.mjs --filter story-outbound`。
  场景会先跑 `catalog-admin`。固定 provider 捕获三协议实际上游 body，并只做一次工具调用后续。
  断言规范视图、本轮玩家话语与工具记录；世界书探针、他人私密、GM 标记与跨角色 reasoning 不出站。
  请求正文不写入结果目录。
- **夹具生命周期**：端口归属检查（ST 8752 / fixture 8753 / Go 8095 任一被监听即退出，不接管）→
  专用 loopback 容器（label `com.vc.w03=managed`，随机 127.0.0.1 端口）：PG `vc-w03-managed-pg`
  （默认镜像 `pgvector/pgvector:0.8.5-pg18`）与 MinIO `vc-w03-managed-minio`（默认镜像
  `vc-g12-minio-tools:local`，本机按 `scripts/dev/Dockerfile.e2e-minio-tools` 构建的 pinned 产物，
  脚本不自动拉取；容器名/镜像等以脚本 `VC_W03_*` 环境变量面为准）→ `companiond migrate` +
  `bootstrap`（owner binding secret 种子）→ 运行 Go（8095）→ 合成账号真实密码/TOTP 登录 →
  受管 ST（8752）与 fixture provider（8753）。
- **凭据与数据**：临时口令/令牌/Key 在进程内生成；登录口令复用已签入的公开 BCrypt 测试向量。
  仅使用合成材料，只进子进程环境与 gitignored 的 `dev-managed/`，
  不打印、不写示例值，无需任何真实凭据；受管 dataRoot 跨 run 保留合成聊天与设置（UI03 文本带本轮
  唯一 scope 后缀）。产物写 `dev-managed/artifacts/accept-<ts>/`（结果 JSON + 截图，截图不含 Key）。
- **清理归属**：进程只停本轮归属（ST 经 `stop-managed.mjs` 按 st.pid 命令行核对；go/fixture 只停
  本轮实际启动的 child）。容器只移除本轮环境变量命名的 PG 与 MinIO（默认 `vc-w03-managed-pg`、
  `vc-w03-managed-minio`），且标签必须是 `com.vc.w03=managed`；不按标签扫删其他链的容器。
  不 lsof 扫端口杀进程，不碰 8742/8743 原生实例。
- **验收边界**：以上为合成环境验收；FileVault 磁盘加密、正式备份配置、真实 provider Key、预算与
  手机等 Owner 项仍未验收，不据此声称 V2 整体完成。

## 浏览器验收（scripts/accept.mjs）

- 前置：`start.mjs` 已运行（脚本不代为启动）；本机有 Chromium 系浏览器（`VC_ST_BROWSER` 可覆盖路径）。
- 用 `lib/fixtures.mjs` 生成的原创合成数据驱动真 ST 前端，固定 provider 由 `scripts/mock-provider.mjs`
  返回确定性回复；对模型请求的断言读 mock 内存捕获（`/__captures`），不落盘请求正文。
- 覆盖 VER §2 的 C01（JSON/PNG 卡）、C02（世界书关键词/次级/递归/预算/冷却）、C03（宏/预设/正则三层
  区别）、C04/C05（原创复杂卡：真实 Helper iframe / MVU / EJS 与原生 swipe，见下小节）、C06（CHARX 自有
  资源原生导入；ST 无 CHARX 导出，不承诺）、C07（群聊指定发言/策略/停止/身份）。
- 产物：`dev/artifacts/accept-<run>/`（result.json、各用例截图、fixtures）；真实模型与目标手机为 NOT_RUN，
  不与 mock 结果混写。已知 ST 自身噪声（建群高亮的未处理拒绝等）在 result.json `error_notes` 中逐条说明。

### 复杂卡 C04/C05（真实 Helper iframe / MVU / EJS）

- 可直接导入的原生导出卡：[澄夏复杂卡](fixtures/chengxia-complex.json)。卡名保留验收时的合成标识；
  内嵌世界书、显示正则和自托管脚本引用均由真实 ST 导出，使用前先完成本目录 bootstrap。
- 用法：`node scripts/accept.mjs --only C04,C05`。C05 依赖 C04 产出的角色与候选状态（`complex.ready`），
  单独 `--only C05` 只会记 NOT_RUN。
- 卡由 `scripts/lib/complex-card.mjs` 原创合成（角色「澄夏」；`complexCard(name, book)` /
  `complexReply(trust)` / `statusPanel`），不含真实数据：`[InitVar]` 世界书条目初始化
  `trust=10 / scene / discussed_book`、关键词条目（`VC04_BOOK`）、EJS 常驻条目
  （`getvar('stat_data.discussed_book')` 为真才输出 `VC04_EJS_DISCUSS`）、两条角色正则（显示层隐藏
  `<UpdateVariable>` 协议块；`<StatusPlaceHolderImpl/>` 替换为真实 iframe 状态栏，按钮只读所在楼层变量）、
  角色脚本 `vc04-mvu` 引用自托管锁定 bundle `/user/files/mvu-bundle-d03b7dc8.js`（见 `patches/README.md`）。
- 覆盖：C04 初始化 10 → 原生生成经 MVU 解析为 15（原文保留 `_.set('trust', 15)`，显示层隐藏）→ 刷新重开
  保持 → 下一轮实际请求含 EJS 条件片段且无未替换宏；C05 原生右滑生成候选 8（不在 15 上累加）→ 刷新保持 8
  → 左滑回 15 / 右滑回 8 → 原生分支隔离 → 末条编辑后显式重算 → 重生成 → 切换聊天后迟到任务无效。
  编辑最后一条回复后使用卡自带的 MVU「重新处理变量」按钮；更早楼层需用 MVU 回放功能，
  不承诺任意历史编辑会自动级联重算。关键状态同时断言 `Mvu.getMvuData` 内存值、iframe 面板读数与原生 chat JSONL
  `variables[swipe_id].stat_data` 落盘。
- 回复注入：`mock-provider.mjs` 的 `POST /__replies` 接收一次性字符串队列（最多 8 条、每条 ≤16000 字符），
  按请求顺序消费，耗尽回落固定回复；进程重启即清空，仅 loopback。C04/C05 用它送入
  `complexReply(15 / 8)` 的 `<UpdateVariable>` 文本，不涉及任何真实模型。
- 产物：`dev/artifacts/accept-<run>/fixtures/` 保存导入卡 JSON 与 C04.4 原生导出的
  `complex-card-export.json`，截图 `C04-desktop.png` / `C05-swipes.png`。这些只是本地合成验收生成物，
  不构成目标手机或真实模型证据。
- 边界：仅本地合成模型；W05 F2、记忆注入、真实手机与真实模型均待后续工作项，不得据此声称 PASS。
  当前验收结果统一见仓库 `TODO.md` 的 V2-W04。

## 保护范围与边界

- 仅监听 127.0.0.1：whitelist 限 loopback、CSRF 开启、无 basicAuth / CORS proxy / 各类自动更新与
  模型自动下载关闭；安全不变量集中在 `scripts/lib/config.mjs`（原生 `CONFIG_INVARIANTS`；受管
  `MANAGED_CONFIG_INVARIANTS` 在原生集合上覆盖 `enableServerPlugins=true`、`enableUserAccounts=true`，
  并断言两种 SSO 头自动登录均禁用），start / start-managed 预检与
  status / status-managed 分别核对。受管 server plugin 装载即受管：Go 桥接环境（base URL / token /
  账号映射）缺失或非法时启动硬失败，不静默降级回 ST 本地密钥。
- `dev/data`、`dev-managed/data` 目录 0700 / 文件 0600（start 后收紧）；磁盘卷加密状态由
  protection-report 如实报告（FileVault Off 即 D01.a BLOCKED，待 Owner 开启，脚本不推断为已保护）。
- 只使用合成数据与合成 key（`VC_ST_MOCK_EXPECT_KEY`，默认 `vc03-synthetic-key`）；禁止真实私人数据、
  真实 provider 凭据或正式 Key 进入 `dev/`、`dev-managed/`、日志与任何提交物；受管
  `VC_ST_PLUGIN_SERVICE_TOKEN` 与 `VC_ST_ACCOUNT_HANDLES` 只经进程环境注入，不落盘、不进日志与
  status 输出。
- Tavern Helper 为 PolyForm-Noncommercial：禁止商业使用，禁止向 Owner 以外的人提供本服务（ADR-0009 §3/§4）。
- 备份打包显式保护清单（chats、group chats、groups、characters、worlds、backups、OpenAI Settings、
  user 资源、settings/secrets、cookie-secret、config.yaml，以及存在的 `_vc_accounts/` 与各用户 `.vc-f2/`）；
  `memorycore-data/owners/` 存在时另打 MemoryCore 快照。排除可确定性再生的自托管派生文件与 `extensions/`。
  MinIO 不纳入。设置 `VC_BACKUP_PG_DSN` 或 `VC_BACKUP_PG_CONTAINER` 之一时，同一归档纳入 `pg_dump -Fc`；都不设置则不含数据库。删除清单在归档外，不随快照回滚。
  keyfile 不得位于 dataRoot 内、不得与归档同目录。保留期未定，见「本机运行说明」。

### W06 持久来源对账

Go 进程设置 `VC_ST_HOST_BASE_URL` 为该受管 ST 的内部地址（本机开发为
`http://127.0.0.1:8752`），与 ST 共用 `VC_ST_PLUGIN_SERVICE_TOKEN`。该令牌仅用于
服务端私有通道；`POST /internal/v1/st/sources` 拒绝浏览器 Origin，以 Go 账号映射选择
唯一用户根。未配置或读取失败时来源为待核对，不能把缺失响应当作删除。

ST JSONL 的 F2 revision 是持久权威；`vc_message_id` 与每个 swipe 的 `extra.vc_source`
记录稳定来源身份。Go 只保留已核对索引和加密来源快照。打开、重连、保存后通知加速对账，
检索与提取提交仍独立读回，因此关闭浏览器不会使旧来源永久有效。

### W06 数据副本与删除

- **入口**：Owner 的数据副本与账号删除入口在 ST 扩展菜单「数据副本与删除」（`vc-model-settings`
  扩展）。扩展只是入口与状态展示：导出/删除实际由 Go `/api/v1/exports` 与 `/api/v1/auth/account`
  执行，密码确认、一次性下载令牌等语义以 Go API 为准。
- **跨存储前提**：完整（受管）模式设置了 `VC_ST_PLUGIN_SERVICE_TOKEN` 时，Go 启动即校验
  `VC_ST_HOST_BASE_URL` 必须指向该 ST 的内部地址（见上节），缺失或非法是启动校验失败，
  不会带病进入运行态。运行中 ST 不可达才是 PENDING 语义：需要 ST 数据域的导出任务保持 PENDING
  （`errorMessage=ST_UNAVAILABLE`，同一任务恢复后自动继续），账号删除保持 202 PENDING，
  由后台任务重试至确认。
- **导出语义**：完整副本 `snapshotMode=PER_FILE_AND_QUERY`——ST 私有内容按文件逐个捕获（凭据、
  历史备份、可再生缓存与锁定受管扩展可重新生成的调试 source map 排除；settings 副本剔除凭据值，
  运行代码与私人扩展仍保留在副本中），Go 侧记录按有界查询导出，两者经来源绑定与
  任务结果合并进下载文档的 `v2` 域（`go` / `st` / `domains` 覆盖清单）。ST 在线副本上限 64 MiB 与
  10000 个文件，超限任务显式失败（`ST_EXPORT_TOO_LARGE`），绝不静默截断。
- **删除语义**：Go 先落删除意图并冻结该账号；ST 私有根清理未确认时删除返回 202
  `{status:"PENDING",pendingDomains:["ST"]}`，对象存储清理失败保持 503 与 pending 信息；
  会话查询可见 `deletionPending`。确认完成后才返回 200 `{"ok":true}`。
- **账号映射登记**：ST dataRoot 下的 `_vc_accounts/`（各用户根目录的兄弟目录，即
  `DATA_ROOT/_vc_accounts/<ownerAccountId>.json`）持久保存账号映射与删除状态
  （ACTIVE/DELETING/DELETED），重启保留。删除的冻结与幂等重试依赖它；清空该目录不受支持，
  也不会恢复账号——Go 侧删除意图与账号 tombstone 独立存在。
  首次认证进入 ST 时，经私有服务通道把账号→handle 登记到 Go；尚未创建聊天的私有角色、世界书
  也进入导出与删除范围。以后移除 ST 通道配置不会把已登记的数据域误报为不存在，相关任务仍待处理。
- **ST 来源提取现状**：`ST_MEMORY_EXTRACT` 复用现有队列、attempt 与用量账本，生产 handler 调用
  MemoryCore 阶段提交；旧 `MEMORY_EXTRACT` 不再入队、领取、消费或重放 payload。
  用途固定为 `MEMORY_EXTRACTION_DEDUP_SUMMARY`，缺失即失败，不回落前台/全局 provider。
  Go Broker 显式映射已声明支持的 temperature/topP/reasoningEffort，配置变更使旧能力失效。
- **边界**：MemoryCore 自 W08 纳入必需在线导出/删除域；离线快照与恢复门禁见「本机运行说明」和下面的 W08 备份段。
  离线备份没有保留期，`backup.sh` 不剪枝，存放位置与期限属 `V2-OWNER-PROTECTION`。
  Inbox 与邮箱／飞书的合成验收在 W10（本地 SMTP 与本地 Webhook，N01–N03 已做）。真实邮箱、真实飞书和手机关网页后的送达未做，属 `V2-OWNER-NOTIFY` 与 `V2-OWNER-DEVICE`。
- **验收入口**：`node scripts/accept-managed.mjs --filter source-native,rights-browser,rights-native`；
  浏览器路径使用上文 `VC_W03_CHROMIUM_PATH`。覆盖实际来源读回、桌面/手机宽度页面、一次性副本、
  ST 不可用后的同任务恢复与独立合成账号清理，不使用真实 Owner 数据。

## W07 原生注入与时间门禁（W08 切换引擎后保留）

- 原生扩展设置中的「长期记忆」开关和召回预算控制专用 `vc_long_term_memory` 资料块；默认开启、
  1024 token，范围 128–2048。块使用原生 USER 历史资料位置，不覆盖角色卡、世界书或系统指令。
- 当前已保存的用户消息作为查询；Go 从会话绑定确定 Owner、实例、模式与允许来源，构造已发布记录
  allowlist。MemoryCore 在此集合内做本机向量和词检索，低相关先拒绝再融合；事件日期由 Go 硬过滤。
  仅同实例独立会话共享，当前分支不读取同族母分支或兄弟分支的私人经历；剧情暂不注入日常记忆。
- 候选、L2/L3 派生摘要与实际出站分别核对完整持久来源。只有通过核验的派生内容才可注入；
  不把助手台词当工具完成证明。遗忘、编辑、删除、swipe 变化会撤销受影响记录及派生资料。
  来源暂不可读时显示「本轮已跳过」，不以旧摘要兜底；旧聊天漏报修改也会被检索恢复对账发现。
- 新来源保存原始时间/时区，规范化结果与记录时间分离。明确日期、下一自然周和有限清晰时间表达
  可解释；缺失时区、多日期或「晚上」等歧义保持待澄清。只有日期不会创建零点提醒，查询不会移动
  已记录的事件日期。旧来源不会补猜当前设备时区。完整提醒调度见后续 W09。
- `POST /api/v1/st/memory/recall` 只接受聊天身份、版本、开关、预算与查询时间快照。原生 interceptor
  注入后，Chat Completions、Anthropic、Responses 在最终转换请求中再核对并替换/移除原块，
  然后执行最终上下文预算检查。状态通过响应头回到对应聊天页面，不持久化提示块正文。
- 定向实际浏览器验收：`node scripts/accept-managed.mjs --filter memory-browser`，配合上文的
  `VC_W03_CHROMIUM_PATH`。使用 101 条先行无关记忆、旧来源聊天和另一个同实例会话，核对本地 provider
  捕获的原生请求、独立摘要、开关关闭、遗忘与未通知的来源编辑；该入口不调用真实付费模型。

真实模型仅在当前会话授权、私有配置与用途/计费边界明确后单独验证。记忆管理页面和引擎对照属 W08；
本节的固定 provider 结果不代表真实模型提取质量、通知或严格剧情已经验收。


## W08-1 MemoryCore 基础服务

MemoryCore 作为独立 Node 进程运行，默认只监听 `127.0.0.1:8754`（`VC_MEMORYCORE_PORT` 可覆盖）。
默认提供基础存储探针、`GET /healthz` 与带内部鉴权的 `GET /readyz`。显式配置 Go 回调后启用下述隔离受控能力；**生产权威尚未切换**。
`readyz` 的 `foundation=true, storageReady=true, businessReady=false` 仅表示已运行锁定上游的
`LocalStorageBackend.putObject/getObject/deleteObject` 合成读写探针。没有配置真实模型也能启动，且不会调用模型。

- 上游保持干净；`upstream.lock.json` 锁定 MIT LICENSE、package.json 与实际消费模块。
  固定 commit 没有依赖锁；集成域 package-lock 固定 sqlite-vec、jieba 与 crc-32 的必要依赖，
  不安装完整上游依赖，不运行上游 postinstall。装配只转换锁定模块闭包。
- `memorycore-service/` 是自有包装代码；装配到 `dev-managed/memorycore-run/`，只复制所需模块与 LICENSE。
  `patches/memorycore/index.json` 登记提案/严格提交、检索前隔离、清理与向量空间四组补丁；
  通过现有 `scripts/lib/patcher.mjs` 校验输入/输出再应用，不修改上游检出。
- 数据在 `dev-managed/memorycore-data/owners/<可信十进制 owner ID>/`；目录 0700、文件 0600、umask 077。
  装配只重建运行副本，保留数据；运行中的服务拒绝重新装配。`owners/` 存在时 `backup.sh` 会打进加密归档，备份前必须先停服务。在线导出／删除自 W08 起包含该引擎。正式备份位置、保留期与磁盘加密仍属 `V2-OWNER-PROTECTION`。
- 独立服务令牌通过私有运行环境 `VC_MEMORYCORE_SERVICE_TOKEN` 注入（至少 32 字节、无空白），不写入锁、配置、manifest、PID 或日志。
  不与 ST 桥接令牌共用；默认受管启动也不会把它传给 ST。无 CORS，带 Origin 的请求被拒绝。
- `run/memorycore.pid` 与 `memorycore.log` 均 0600。停止只处理 PID 文件所记且入口绝对路径和 dataRoot 匹配的进程，
  不能根据端口接管或杀死其他服务。日志只记录固定生命周期／错误码。

在仓库根目录可单独运行基础服务（先通过私有运行配置提供令牌，不将值写进命令或仓库）：

```bash
node integrations/sillytavern/scripts/bootstrap.mjs --memorycore-only --offline
node integrations/sillytavern/scripts/assemble-managed.mjs --memorycore-only
node integrations/sillytavern/scripts/start-managed.mjs --memorycore-only
node integrations/sillytavern/scripts/status-managed.mjs --memorycore-only
node integrations/sillytavern/scripts/stop-managed.mjs --memorycore-only
```

不带 `--memorycore-only` 的受管入口管理 ST 与 MemoryCore 两个进程，仍需既有 Go 桥接配置。
`VC_ST_DEV_DIR` 同时控制两者的运行根；原生 `dev/` 不用于受管装配。

真实验收复用现有入口：

```bash
node integrations/sillytavern/scripts/accept-managed.mjs --filter memorycore-foundation
```

该场景使用 artifacts 下的独立受管根、随机 loopback 端口和内存中的合成令牌；验证锁定源码、鉴权、权限、
启动、健康／就绪、状态、停止、重装配保留合成 owner 数据、重启和最终端口释放，最后只停止该验收进程。
不启动 Go/PG/MinIO，不调用真实模型，不清理其他受管资源或 `vc-w08-embedding`。
离线 `tests/memorycore-*.test.mjs` 由现有 `scripts/check.sh` 自动覆盖，不依赖上游检出、Docker 或网络。


W08③ 受控能力只面向 Go 内部调用，验收只用合成数据。设置 `VC_MEMORYCORE_CALLBACK_BASE_URL`
（Go 的 `127.0.0.1` HTTP 地址）和独立 `VC_MEMORYCORE_CALLBACK_TOKEN` 后可使用
`POST /internal/{propose,commit,operation-status,search,rebuild-profile,rebuild-space,forget,clear-owner,export-owner}`。
身份、逻辑记忆域、来源、allowlist、revision 与 embedding 快照来自可信 Go；模型只返回内容与动作。
浏览器不可调用内部接口，MemoryCore 不持有供应商密钥。Go 侧操作能力由 `memorycore.Broker.Open`
签发，绑定生产 `ST_MEMORY_EXTRACT` 任务的 claim token/fence；每次模型调用独立准入与记账。

`propose` 不写 live；`commit` 的 SQLite 事务先产生 receipt，再发布 JSONL，部分发布可用同操作 ID 恢复。
L2/L3 在独立 staging 中用受限文件工具生成，`rebuild-profile` 的发布步骤必须带 Go 核验过的完整依赖。
遗忘先提高 revision，再清理所有相关副本；返回 pending 时不得当作清理完成。SQLite WAL/空闲页及离线备份
不属于此步骤物理擦除承诺。配置 callback 且恢复对账通过时健康接口返回 `businessReady=true`；这不代替 Go 的用途配置与逐来源门禁。

Embedding 使用 Go 专用 `/api/v1/admin/embedding-config` 快照与固定本机 Ollama 端点，制品、维度或预处理
变化创建新空间。重建期间只允许词检索；`rebuild-space` 完整成功后才恢复向量。
当前阈值与校准样本见 `memorycore-service/native-engine.mjs`、`scripts/fixtures/memorycore-calibration.json`。
同一问题含 2–4 个独立问句时，在同一可信 allowlist 内逐问句召回再合并已通过门槛的结果，避免多主题
向量互相稀释；单问句保持原查询。该校准是本机中文合成集结果，不代表未测试模型或全量真实记忆的召回率。

```bash
node integrations/sillytavern/scripts/accept-managed.mjs --filter memorycore-native
```

该受管场景验证固定源码/真实 SQLite/sqlite-vec、10,000 条范围外干扰、中文正负召回、纠正、作用域、
遗忘、版本屏障与故障恢复；使用现有 `vc-w08-embedding`，结束删除本轮合成数据，保留 embedding 容器。


W08④ 的 Go 运行配置需要 `VC_MEMORYCORE_BASE_URL=http://127.0.0.1:8754`、独立
`VC_MEMORYCORE_SERVICE_TOKEN` 与 `VC_MEMORYCORE_CALLBACK_TOKEN`；令牌仅由本机私有配置注入。
MemoryCore 进程使用同一 callback token 与 `VC_MEMORYCORE_CALLBACK_BASE_URL` 指向 Go。
提取用途绑定为 `MEMORY_EXTRACTION_DEDUP_SUMMARY`，embedding 使用独立配置，不复用聊天 provider。
旧 Go `MEMORY_EXTRACT`、旧提取 payload 重放、自生成摘要和 `vc.memory_embedding` 不再参与生产。

管理页经 ST 会话/CSRF 桥访问 Go：列表支持 q/status/事件日期筛选与 `X-Next-Cursor`；详情包含来源、
替代历史和 cleanup。纠正携带 `expectedVersion`，创建新记录并替代旧记录；冲突为
`409 MEMORY_VERSION_CONFLICT`。遗忘为 `202`，先停止召回，随后显示 PENDING/DONE/PARTIAL。
DONE 只表示本次在线记忆域清理完成，不表示 ST 聊天原文或离线备份已删除。

```bash
node integrations/sillytavern/scripts/accept-managed.mjs --filter memorycore-native,memory-browser
```

`memory-browser` 通过正式队列提取后在记忆页读取，核对并发纠正冲突、草稿保留、新版本、遗忘后的
实际出站请求、清理状态与 1440/360/390px 布局、键盘焦点和弹窗返回；保留 W07 的来源、日期及摘要断言。
L2/L3 的 Go 摘要投影按来源会话独立构建，跨会话召回再组合完整核验的摘要。原生生成会暂时将
当前聊天来源标为未稳定，因此一个会话的画像不混入另一个活跃会话的来源。跨会话合并的 L1
保留全部证据并继续参与正式召回，不删减依赖以塞入单会话摘要。

`memorycore-native` 另验证未发布记录不可检索、SQLite 清理失败后的抑制与同意图恢复、迟到提交拒绝、
当前 embedding 空间和重建。默认用合成模型，本机 embedding 容器保持运行；手机视口不替代真机软键盘验收。

跨域导出把 `EXTERNAL_MEMORY_ENGINE` 作为必需在线域；引擎未配置或不可达时保留同一任务，
删号在引擎域确认完成前保留 Go 账号与删除意图。
`backup.sh` 自动纳入存在的 `dev-managed/memorycore-data`（可用 `VC_MEMORYCORE_DATA_ROOT` 指定），
须通过私有环境配置 `VC_MEMORYCORE_DATABASE_URL`，或在无本机 psql 时设置 `VC_MEMORYCORE_PG_CONTAINER`
使用 OrbStack PG 容器（二选一；容器内用户/库默认 postgres/vc，可用 `VC_MEMORYCORE_PG_USER` /
`VC_MEMORYCORE_PG_DATABASE` 覆盖），并先停止受管 MemoryCore。`runtime.lock` 拒绝在线
多文件快照；SQLite backup 一致快照包含画像、metadata、适配状态和 Go suppression 快照，外层仍加密。
含 `_memorycore` 的 `restore.sh` 必须连接当前权威 PostgreSQL，生成最新删除/来源 allowlist 恢复门禁；
数据库不可达退出 5 并保留 blocked 标记。归档里带有 `_vc_accounts/`、`.vc-f2/`，或设置了当前库 / 删除清单时，
同一退出码也覆盖 ST 聊天与角色映射的清理。全部 owner 清理、来源对账完成前不开放引擎读取。
`VC_RESTORE_GATE_FILE` 指向副本的 `restore-gate.json` 时，Go 在该标记撤掉前不领取任务、不开放记忆检索。
恢复产物 `_memorycore` 应作为引擎 dataRoot。归档若含 PostgreSQL，`restore.sh` 只恢复到新的隔离库，并在撤掉 blocked 前把删除并集应用到该库，不自动切换生产库。历史归档的 `go-rights`
不能替代最新删除意图。离线备份没有保留期，也没有定时清理，这两项仍是 `V2-OWNER-PROTECTION`。

已有 Owner 授权时，`--filter memory-real-model` 可单独验证 3 条合成来源（中文偏好、跨会话改口、
相对日期）和 API 遗忘。它仅在内存中以 GB18030 读取根目录 gitignored `agents.txt`，使用指定
Chat Completions 模型与 `reasoningEffort=max`，不写凭据或请求正文到日志/产物；结束先关闭用途并清除
临时 provider 凭据，再由受管入口删除临时 PG。逐 stage 的调用次数与 provider token 用量来自 Go
attempt 账本。该场景使用明确的保守验收估算费率（输入 0.01、输出 0.02 USD/1K token）与预算准入，
费率不代表供应商价格，产物不宣称实际费用。首次任务失败即关闭用途，不继续增加样本；默认场景不运行真实模型。
本轮已验证该 Owner 模型的 L1 实际提取与发布；L2 工具步骤未通过，真实改口/日期样本未继续执行。
空场景目录的 list_files 已修复并有离线回归，但不把它宣称为实际 L2 失败的已证实根因。

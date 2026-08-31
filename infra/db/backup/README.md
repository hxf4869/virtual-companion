# 备份与恢复（§22.13 / R47；每日加密备份见 ADR-0006 §7.4）

一次性演练入口：`bash infra/db/backup/run-backup-drill.sh`（匿名容器，无宿主端口/
卷挂载；产物走 stdout/docker cp；日志在 `$VC_DB_LOG_DIR`）。

每日备份入口：`bash infra/db/backup/run-daily-backup.sh`（dogfood 本机定时加密备份）。

端到端恢复演练入口：`bash infra/db/backup/run-restore-drill.sh`（把每日备份产物
当作黑盒，走「恢复 → 先 reconcile → 对象恢复+内容比对+墓碑过滤 → 再开放读取」全链路）。

## 每日加密备份（run-daily-backup.sh，ADR-0006 §7.4）

覆盖 PostgreSQL（`pg_dump -Fc`）与 MinIO 对象（`mc mirror` 整桶导出），打包后
`openssl enc -aes-256-cbc -pbkdf2 -salt` 加密，并叠加独立的 **encrypt-then-MAC**
认证层，只落本机、不同步任何云端。

### 认证加密格式（VCBAE1 容器，`vc_aead.py`）

`openssl enc`（CBC + PBKDF2）只提供机密性、不提供完整性：被篡改的密文常常
仍能"解密成功"。因此归档与 manifest 都是单文件认证容器：

```
MAGIC("VCBAE1\n") || u32be(header_len) || header || ciphertext || mac[32]

header（ASCII key=value，本身被 MAC 覆盖）：
  format=vcb-authenticated-v1 / mac=hmac-sha256
  mac_kdf=pbkdf2-sha256 / mac_iter=200000 / mac_salt=<16 字节随机盐的 hex>
ciphertext：未改动的 openssl enc -aes-256-cbc -pbkdf2 -salt 输出
mac：HMAC-SHA256(K, MAGIC || u32be(header_len) || header || ciphertext)
K  = PBKDF2-HMAC-SHA256("vc-backup-mac-key-v1\0" || passphrase,
                        mac_salt, mac_iter, dklen=32)
```

* MAC 密钥与 openssl 加密密钥经不同 KDF 上下文与不同盐派生（域分隔），互不
  相等、互不可推导；HMAC 只用 macOS 系统 python3 标准库（`hmac`/`hashlib`），
  **密钥经环境变量或 0600 keyfile 传给 python，绝不进 argv/ps**（因此也不用
  `openssl dgst -hmac`，它的 key 走 argv）。
* **校验顺序**：`unseal` 先对整个文件（含 header）流式计算 MAC 并常数时间比较，
  匹配后才输出/解密一个字节的密文。错误 passphrase（→错误 MAC 密钥）、密文被
  篡改、MAC 被篡改、header 被篡改、文件被截断，全部在解密前失败且非零退出，
  不产生任何部分输出。
* 写盘后立即自校验：MAC 验证 → 解密 → tar 目录读取；失败产物直接删除并以
  非零退出，绝不留下一个看似完好的坏备份。
* **旧文件兼容口径**：本改动之前生成的 `vc-backup-*.tar.enc` /
  `deletion-manifest-*.enc`（openssl-only，首字节 `Salted__`，无 VCBAE1 magic）
  **不做迁移、不改名、不删除**，仍按 7 天保留自然过期；如需读取可用
  `openssl enc -d -aes-256-cbc -pbkdf2` 手工解密，但它们**没有完整性保证**，
  只应作为无认证的历史产物对待。
* 文件名与保留策略不变；格式靠文件内 magic 自描述，恢复侧自动识别。
* 依赖 python3（仅标准库）。缺失时脚本硬失败（退出 8），**绝不回退到无认证
  加密**；launchd 环境下脚本会回退 `/usr/bin/python3`（Xcode CLT），也可用
  `VC_BACKUP_PYTHON` 显式指定。

产物布局（两者必须位于**不同目录**，脚本启动时校验并拒绝相同路径）：

| 产物 | 目录（默认） | 保留 |
|---|---|---|
| `vc-backup-YYYYMMDD-HHMMSS.tar.enc`（VCBAE1 认证容器，0600） | `~/.virtual-companion/backups` | 7 天（`find -mtime +6 -delete`，只匹配本命名模式） |
| `deletion-manifest-YYYYMMDD-HHMMSS.enc`（VCBAE1 认证容器，0600） | `~/.virtual-companion/deletion-manifests` | 7 天（同上） |

tar 内含 `db.dump`、`objects/`（FULL 模式）、`backup-manifest.txt`（时间/模式/
计数等非敏感元数据）。deletion manifest 是
`vc.export_account_deletion_tombstones()` 的 digest-only 行，**独立于恢复数据库与
对象备份加密存放**（同样有 MAC 认证——被篡改的墓碑绝不能被 apply 到恢复库），
因此旧备份恢复后仍能用备份之后的 manifest 重新执行删除。

### 一致性边界（如实说明：**不是原子快照**）

`pg_dump` 与 `mc mirror` 是**两次独立捕获**，中间存在一个崩溃窗口：数据库已
写入 dump 而对象尚未 mirror（或反之）时，归档内的数据库状态与对象集合可能互
不一致（例如 dump 里已有某条导出记录、objects/ 里还没有对应对象，或反过来）。
这是该备份形态的固有边界，不宣称、也不应被理解为原子快照。恢复时的处理顺序
正是为此设计（也是 ADR-0006 §7.4 的顺序）：

1. 恢复数据库（`pg_restore`），此时读取保持关闭；
2. **先 reconcile**：用备份之后的 deletion manifest 逐行 dry-run → apply，把
   备份后被删除的账号从恢复库里重新删除（防复活，DB 层）；
3. 再恢复对象，并按墓碑把已删账号的 `exports/{ownerUserId}/` 前缀对象删除/
   排除（防复活，对象层）；
4. 只有以上全部完成后才开放读取。崩溃窗口造成的不一致（多余或缺失的业务
   对象/行）由应用层按业务状态收敛，删除防复活则始终由 2+3 兜底。

### 配置（环境变量，密钥一律不进 Git/日志）

- `VC_BACKUP_DIR` / `VC_BACKUP_MANIFEST_DIR`：如上默认值；必须互不相同。
- passphrase 二选一：
  - `VC_BACKUP_PASSPHRASE`（经 `-pass env:` 传给 openssl、经环境变量传给
    python，不进 argv/ps）；
  - `VC_BACKUP_PASSPHRASE_FILE`（0600 keyfile，openssl 经 `-pass file:`、python
    经 `--pass-file` 读取首行；launchd 推荐）。
  - 两者都缺 → fail-closed 非零退出；keyfile 权限不是 0600 → 拒绝启动。
  - passphrase 同时派生加密密钥与 MAC 密钥——**passphrase 丢失 = 备份不可恢复
    且不可验证**，Owner 必须离线妥善保管。
- `VC_BACKUP_PYTHON`：认证加密所用 python3 覆盖（默认 PATH 中的 python3，
    回退 `/usr/bin/python3`）。
- PostgreSQL 走容器路径（deploy compose 的 db 不发布宿主端口）：
  - 默认：`docker compose -p <项目名> --env-file .env.local exec -T db ...`
    （项目名默认 `deploy`；`VC_BACKUP_COMPOSE_DIR/PROJECT/ENV_FILE/SERVICE` 可调，
    项目名也可用 `-p` 参数）；
  - 或 `VC_BACKUP_PG_CONTAINER=<容器名>` 直接 `docker exec`；
  - `VC_BACKUP_PG_USER` 默认 `vc_migrator`（deploy bootstrap 超级用户；tombstone
    函数已 `REVOKE ... FROM PUBLIC`，只有 migration-owner 角色可执行）。
- MinIO：`VC_BACKUP_S3_ENDPOINT/ACCESS_KEY/SECRET_KEY/BUCKET`；本机有 `mc` 就用本机
  的，否则用 pinned digest 的 `minio/mc` 容器（loopback endpoint 自动改写为
  `host.docker.internal`）。MinIO 不发布宿主端口时，设
  `VC_BACKUP_S3_DOCKER_NETWORK=<compose-network>` 并使用容器服务 DNS endpoint
  （Dogfood 默认：`deploy_default` + `http://minio:9000`）。dockerized `mc` 从
  0700 临时目录中的 0600 只读文件读取凭据；Docker 参数、容器 Config.Env 和
  脱敏日志均不包含凭据值。

### 退出码契约（launchd `LastExitStatus` 判读）

| 退出码 | 含义 |
|---|---|
| 0 | FULL 备份成功（DB + 对象） |
| 2 | DB-only 归档：四个 `VC_BACKUP_S3_*` **全部未配置**（SKIP 已打印；非零是为了让 launchd 可见） |
| 4 | MinIO endpoint/bucket **不可达**、凭据被拒或 mirror 中途失败——错误信息**稳定且脱敏**（不含 endpoint URL、凭据、原始 mc 输出） |
| 5 | `VC_BACKUP_S3_*` **配置了一部分**（视为笔误，硬失败） |
| 6 | 归档自校验失败（MAC/解密/tar；产物已删除） |
| 7 | 墓碑 manifest 自校验失败（产物已删除） |
| 8 | 认证加密失败：python3 缺失/不可用、`vc_aead.py` 缺失或 seal 失败（**绝不回退无认证加密**） |
| 1 | 其他配置错误（passphrase 缺失、目录相同、keyfile 权限等） |

### MinIO 缺失时的 SKIP 语义（fail-safe 选择）

四个 S3 变量**一个都没配**：仍产出 DB-only 归档，日志显式打印
`SKIP: object backup`，**退出码 2**。选非零退出而不是 WARNING：launchd/cron 里
WARNING 只会沉底，`LastExitStatus` 失败是唯一可靠可见的信号，防止「看起来完整的
欠覆盖备份」静默累积；归档内的 `backup-manifest.txt` 也标 `mode=DB_ONLY`。

旧 volume 在 V104 之前尚无墓碑导出函数。升级前备份应显式设置
`VC_BACKUP_PG_USER=postgres`；脚本会为该 pre-V104 状态生成认证加密的空墓碑清单。
函数一旦存在，权限错误或导出失败仍会硬失败，不会降级为空清单。

### launchd 定时（模板 + Owner 手工装载）

模板：`launchd/com.virtualcompanion.daily-backup.plist.template`（每天 04:30）。
装载步骤（Owner 一次性操作，均在本机）：

1. `mkdir -p ~/.virtualcompanion/etc ~/.virtualcompanion/logs`
2. 建 0600 env 文件 `~/.virtualcompanion/etc/daily-backup.env`
   （含 `VC_BACKUP_PASSPHRASE=...` 或 `VC_BACKUP_PASSPHRASE_FILE=...`，以及
   MinIO credential；`chmod 600`）。
3. 建 0600 wrapper `~/.virtualcompanion/etc/daily-backup-wrapper.sh`：
   `#!/bin/bash` + `set -a; . ~/.virtualcompanion/etc/daily-backup.env; set +a` +
   `exec bash /Users/<owner>/projects/virtual-companion/infra/db/backup/run-daily-backup.sh`
   （`chmod 700`）。plist 只引用 wrapper，passphrase 不出现在 plist。
4. 复制模板为 `~/Library/LaunchAgents/com.virtualcompanion.daily-backup.plist`，
   替换 `{{VC_BACKUP_WRAPPER}}`、`{{VC_LOG_DIR}}` 与 EnvironmentVariables 中的
   目录占位（非敏感项）。launchd 不继承用户 PATH：脚本会回退
   `/usr/bin/python3`（需 Xcode CLT），否则在 env 文件里加
   `VC_BACKUP_PYTHON=/opt/homebrew/bin/python3`。
5. 装载与验证（**由 Owner 手工执行**，本仓库脚本/Agent 绝不代跑）：
   - `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.virtualcompanion.daily-backup.plist`
   - 手动触发一次：`launchctl kickstart gui/$(id -u)/com.virtualcompanion.daily-backup`
   - 查看状态/退出码：`launchctl print gui/$(id -u)/com.virtualcompanion.daily-backup`
     —— `last exit code` 按上表判读：`2` = MinIO 配置缺失的 SKIP（补
     `VC_BACKUP_S3_*`）；`4` = MinIO 不可达/凭据被拒；`8` = 认证加密
     （python3/helper）问题；`0` 才是 FULL 成功。
   - 卸载：`launchctl bootout gui/$(id -u)/com.virtualcompanion.daily-backup`

## 端到端恢复演练（run-restore-drill.sh）

证明每日备份产物可恢复，且顺序符合 ADR-0006 §7.4「恢复后先 reconcile、
再开放读取」（全部合成数据，不连任何云对象存储）：

1. 临时 PG（全量迁移 + 种子）+ 临时 MinIO；对象用**真实导出 key 布局**
   `exports/{ownerUserId}/{exportId}-{16位小写十六进制}.json`：alice 3、
   dave 2、carol 2；
2. **备份前删除 carol**：账号注销 + 其对象前缀从源桶清除（等价生产删除流的
   对象清除）——备份 #1 由此根本不包含她的对象；
3. `run-daily-backup.sh` 跑两次（env passphrase / 0600 keyfile 各一次），两次之间
   删除 dave——第二次的 manifest 记录该删除、第一次的 dump 看不到它；
4. **篡改负例**：对归档副本分别翻转密文字节、翻转 MAC 字节、用错误 passphrase
   解封——三种情况都必须在解密前被 MAC 门拒绝（非零退出、零输出）；
5. drop 数据库 → MAC 验证后解密第一次归档 → `pg_restore`；gate A：dave 随恢复
   在**全部五类行**（账号/消息/记忆/向量/导出）复活，证明读取此时必须保持关闭；
   归档对象集恰好 = alice 3 + dave 2、无 carol（场景 a，备份侧断言）；
6. 解密第二次 manifest → 逐行 dry-run → apply（gate B：dave 五类行全部归零、
   COMPLETED tombstone 回落恢复库——场景 b 的 DB 层）；
7. 对象恢复到全新临时 MinIO bucket：gate C 对象名与数量一致；gate C2 恢复对象
   与灾备前对象**逐字节 sha256 比对**（不打印内容）；随后按墓碑把已删账号的
   `exports/{ownerUserId}/` 前缀对象删除（对象层防复活）；gate D：carol 对象
   端到端不存在（场景 a）；gate E：dave 对象被过滤排除、alice 3 个原样保留
   （场景 b，对象层）；
8. 额外断言 `run-daily-backup.sh` 对**不可达 MinIO endpoint** 退出 4、错误信息
   脱敏、备份目录不被污染；
9. 最后才开放读取：业务断言（密文摘要/记忆/导出残留/双墓碑）+ 恢复库重跑
   RLS 01/02/70。

删除防复活的机制对应关系：备份前已删账号（carol）靠「删除时清源 + 备份镜像
活状态」根本不进入可恢复集合；备份后删除账号（dave）靠备份边界之外的独立
墓碑 manifest——DB 行由 `vc.reconcile_account_deletion_tombstone()`（内部
`DELETE FROM vc.vc_user`，级联覆盖账号、消息（经会话）、记忆、向量
（memory_embedding）、导出记录五类）重新删除，对象由恢复后的 owner 前缀过滤
排除。

## 策略（草案，Owner 复核）

| 项 | 草案 | 说明 |
|---|---|---|
| 全量逻辑备份 | 每日 `pg_dump -Fc` | 恢复粒度最细、可跨版本；产物加密存放于部署侧（密钥治理见 09-静态加密） |
| 物理基线 + WAL | `pg_basebackup` + 连续 WAL 归档 | PITR 能力：可恢复到任意时间点；`archive_command` 落部署侧 WAL 归档存储 |
| RPO | ≤ 5 分钟（WAL 段切换频率） | 草案值；`archive_timeout` 按需调低 |
| RTO | ≤ 1 小时 | 草案值；恢复 = 基线 + WAL 回放 + 本演练的验证套件 |
| 保留周期 | 与 `vc.data_retention_policy` 对齐 | §16.7 把「备份」列为独立保留类别；备份按保留周期自然过期（§16.6 删除流程末环） |

## 演练证明了什么（不是「数据库能启动」）

Phase A（逻辑）：

1. `pg_dump -Fc` → **drop database** → `pg_restore`；
2. 业务数据断言：消息正文、记忆状态（ACCEPTED）、导出残留行逐项核对；
   会话摘要在备份中为 enc2 密文（S0-32），恢复后仍由应用层解密，不会以明文复活；
3. **删除防复活（两个场景、两层）**：备份前已注销账号（carol）的对象与行
   根本不进入备份/可恢复集合；备份后注销账号（dave）的对象与五类数据行随旧备份
   "复活"后，由备份边界之外的 digest-only manifest 重新执行删除——DB 行先
   dry-run reconcile（命中 1、零写）再 apply，对象按 owner 前缀过滤；
4. **RLS 在恢复后的集群上成立**：重跑 01 跨用户读拒绝 / 02 跨关系引用拒绝 /
   70 伪造 owner 绑定拒绝三个真实攻击面测试。

Phase B（物理 PITR）：

1. `pg_basebackup` 基线 → 备份后写入 marker 行 → 强制 WAL 切换归档；
2. 全新容器以基线恢复 + `recovery.signal` 回放归档 WAL；
3. 断言 marker 行**只在回放后存在**——证明 WAL 真的回放了，而不是只起了
   一个旧基线。

## 生产落地清单（部署时，Owner）

- `[WAL 归档存储位置与加密方式]`
- 每日 `pg_dump` 的宿主与产物保管（dogfood 现状，ADR-0006 §7.4）：Owner Mac 本机
  `run-daily-backup.sh`，加密产物在仓库外 `~/.virtual-companion/backups`
  （VCBAE1 认证容器，0600，保留 7 天，launchd 每天 04:30），不进 Git、不同步云端。
- `[RPO/RTO 复核结论]`
- account deletion digest manifest（dogfood 现状，ADR-0006 §7.4）：独立于备份目录的
  `~/.virtual-companion/deletion-manifests` 单独加密（VCBAE1 认证容器，0600，保留
  7 天）；导出经 migration-owner 角色（deploy 默认 `vc_migrator`）执行
  `vc.export_account_deletion_tombstones()`；恢复顺序 = 恢复库 → manifest 逐行
  dry-run/apply reconcile → 对象恢复 + 墓碑 owner 前缀过滤 → 才开放读取
  （`run-restore-drill.sh` 已演练，含认证加密负例与两场景防复活断言）。
- 定期（建议每月）跑一次本演练脚本

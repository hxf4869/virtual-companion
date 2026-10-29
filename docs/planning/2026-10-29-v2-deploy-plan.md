# V2 远端部署方案（供执行者使用）

状态：方案，未执行（2026-10-29）。授权与范围：Owner 已决定由 Codex 执行部署（`TODO.md` 的 `V2-OWNER-DEPLOY`）；
执行前仍需 Owner 确认下方「待 Owner 决定」两项。本文件不授予任何超出 Owner 当次指令的权限。

## 0. 执行者必须遵守

- 先读 `AGENTS.override.md`、`AGENTS.md`、`docs/decisions/0009-v2-sillytavern-host-direction.md` 与
  `integrations/sillytavern/README.md`「本机运行说明（W16-2）」。本方案的命令与环境变量以该说明为准，说明里是本机合成环境实测过的做法。
- 所有服务器操作只通过 ssh-skill，不直接运行裸 `ssh` / `scp`。
- 口令、DSN、令牌、模型 Key、SMTP 与飞书凭据只放服务器上的 0600 环境文件或在页面里由 Owner 自己填写；
  不写入仓库、命令行参数、日志或聊天。`agents.txt` 不上传服务器。
- 只供 Owner 本人非商业使用（ADR-0009 §3、§4：Tavern Helper 为 PolyForm Noncommercial；ST/EJS 为 AGPL）。不开放注册，不给他人账号。
- 不在服务器上跑真实邮件/飞书发送，除非 Owner 对该次发送单独授权。
- 每一步完成后记录命令、时间、结果；失败时停下报告，不用破坏性手段绕过。

## 1. 待 Owner 决定（执行前确认）

1. **目标主机**：京东云现有服务器（ssh-skill 中已配置，已运行 Ollama 0.33.2 + `qwen3-embedding:0.6b`），或另一台主机。
   最低资源：2 vCPU、4 GB 内存（PG + MinIO + Ollama 0.6b + ST + MemoryCore + companiond），20 GB 以上磁盘。
2. **访问方式**（二选一）：
   - A. 公网子域名 + HTTPS：Owner 提供已解析到该主机的子域名；Caddy 自动签发证书；只暴露 443。
   - B. 私有网络：Tailscale 等，不暴露公网端口。风险更低，手机需装客户端。

## 2. 目标拓扑

```
手机/电脑浏览器 ──HTTPS──▶ Caddy :443 ──▶ SillyTavern 127.0.0.1:8752（--listen false）
                                              │ 插件桥（服务令牌）
                                              ▼
                               companiond 127.0.0.1:8095 ──▶ PostgreSQL 18 + pgvector（容器，仅本机）
                                   │   ▲                    └─▶ MinIO（容器，仅本机，导出对象）
                                   ▼   │ 回调令牌
                               MemoryCore 127.0.0.1:8754 ──▶ Ollama qwen3-embedding 127.0.0.1:11438
```

- 只有 Caddy 对外。ST、Go、MemoryCore、PG、MinIO、Ollama 全部只绑定 `127.0.0.1`。浏览器的扩展请求都经 ST 插件的管理桥转发到 Go，
  不需要对外暴露 Go。部署后用外部端口扫描确认只开放 443（方式 B 则无公网端口）。
- embedding 地址在代码中固定为 `http://127.0.0.1:11438`（`memorycore-service/embedding.mjs`）。若复用京东云现有 Ollama，
  需确认它在本机 11438 可达且模型为 `qwen3-embedding:0.6b`、1024 维；否则另起一个 `ollama/ollama:0.33.2` 容器映射到 `127.0.0.1:11438`。
- `ops/deploy` 的 Compose 不是 V2 栈（不含 ST 与 MemoryCore），不要直接拿来部署 V2；其 Caddy 配置可参考 TLS 与反向代理写法。

## 3. 部署步骤

1. **只读盘点**：OS、CPU/内存/磁盘、已占用端口、Docker 版本、现有服务（尤其京东云上已有的 embedding 部署）、防火墙与安全组。
   结果写回给 Owner，资源不足或端口冲突时停下。
2. **准备运行时**：Docker；Node 22.13+；Go 1.26.10（或在本机交叉编译 `companiond` 后上传二进制，二选一，推荐交叉编译以免服务器装工具链）；
   Python 3 与 openssl（备份脚本使用）；Caddy（方式 A）或 Tailscale（方式 B）。
3. **代码与上游**：服务器上 clone 本仓库 main 的指定提交；执行 `integrations/sillytavern/scripts/bootstrap.mjs` 拉取并核对
   `upstream.lock.json` 锁定的五个上游与 vendor 校验；再执行 `assemble-managed.mjs` 装配 `st-run` 与 `memorycore-run`。
   不手改 `upstream/` 与 vendored 文件。
4. **数据服务**：按「本机运行说明」的约定启动 `pgvector/pgvector:0.8.5-pg18` 与 MinIO 容器，但使用持久卷（不要用验收时的临时容器），
   端口只绑 `127.0.0.1`；创建导出桶；执行 `companiond migrate` 与 `companiond bootstrap`（创建 Owner 账号，口令与 TOTP 由 Owner 首次登录设置）。
5. **环境文件**（0600，仓库外，例如 `/etc/virtual-companion/*.env`），变量名以「本机运行说明」和 `backend/internal/config/config.go` 为准：
   - Go：`VC_MODE=full`、`VC_HTTP_ADDR=127.0.0.1:8095`、`VC_HTTP_ORIGINS`（对外 ST 的 origin，例如 `https://<子域名>`）、`VC_DB_DSN`、
     `VC_CRYPTO_REST_KEY`、`VC_EXPORT_S3_*`、`VC_ST_PLUGIN_SERVICE_TOKEN`、`VC_ST_HOST_BASE_URL=http://127.0.0.1:8752`、
     `VC_MEMORYCORE_BASE_URL=http://127.0.0.1:8754`、`VC_MEMORYCORE_SERVICE_TOKEN`、`VC_MEMORYCORE_CALLBACK_TOKEN`、`VC_MEMORYCORE_CALLBACK_BASE_URL`。
   - ST 插件：`VC_ST_GO_BASE_URL=http://127.0.0.1:8095`、`VC_ST_PLUGIN_SERVICE_TOKEN`（与 Go 相同，至少 32 字节）、`VC_ST_ACCOUNT_HANDLES`、
     `VC_MEMORYCORE_SERVICE_TOKEN`（至少 32 字节）。
   - 恢复门：`VC_RESTORE_GATE_FILE`（指向数据根下的 `restore-gate.json` 路径；平时文件不存在）。
   令牌用 `openssl rand` 生成，不复用本机验收值。
6. **进程守护**：为 companiond、ST、MemoryCore 写 systemd 单元（以非 root 专用用户运行，读取上述环境文件，`Restart=on-failure`）。
   ST 与 MemoryCore 的启动参数取自 `start-managed.mjs`（ST：`server.js --configPath … --dataRoot … --port 8752 --listen false --browserLaunchEnabled false`），
   不要依赖 `start-managed.mjs` 的分离进程方式做常驻。数据目录权限 0700，文件 0600。
7. **对外访问**：方式 A 写 Caddyfile 反向代理到 `127.0.0.1:8752`，启用 HSTS；方式 B 只在 Tailscale 接口提供访问。
8. **模型与 embedding 配置**（Owner 在页面中完成，执行者只核对）：模型页新增供应商，填 `agents.txt` 中的 Base URL、模型 ID
   `cline-pass/deepseek-v4.1-flash-1017` 与 Key（Owner 本人在页面输入），绑定前台聊天、记忆抽取等用途；单价与预算按 Owner 决定可不填
   （依赖 `V2-F01` 合入后的版本：未配单价照常发送，只记 token）；embedding 配置指向 `127.0.0.1:11438`。
9. **通知**：Owner 在主动陪伴页填写邮箱 SMTP 与飞书 Webhook/签名密钥。真实发送验证需 Owner 对该次发送授权。

## 4. 验收清单

- 健康：`/actuator/health` 为 UP；`status-managed` 等价检查中 ST 与 MemoryCore 存活，MemoryCore `/readyz` 三项为 true。
- 外部只暴露 443（或无公网端口）；ST 未登录访问跳转到登录；登录需要密码 + TOTP。
- 模型页保存供应商不发起上游请求；真实发送一条前台消息成功，模型页用量区出现 token。
- 记忆：发送含明确事实的消息，几分钟内记忆页出现该事实；遗忘后不再召回。
- 剧情：开局、执行一步行动、回档确认可用。
- 手机（`V2-OWNER-DEVICE`，Owner 本人操作）：390/360 宽下七页可用，软键盘弹出时输入框可见可发送，返回手势与弹层关闭正常，复杂卡同屏可读。
- 通知（经 Owner 授权）：两个渠道各收到一条测试通知；页面显示「渠道已接受」。
- 重启：重启服务器后三项服务自动恢复，聊天、记忆、收件箱仍在（可参考 `scripts/w16-restart-accept.mjs` 的断言项手动核对）。

## 5. 运维

- 升级：拉取新提交 → `bootstrap.mjs` 核对上游 → `assemble-managed.mjs` → `companiond migrate` → 依次重启 companiond、MemoryCore、ST。
  PostgreSQL 迁移不承诺降级，升级前先手动备份。
- 备份：Owner 决定不设定期备份，按需手动执行 `integrations/sillytavern/scripts/backup.sh`（先停 MemoryCore；归档与口令文件不放在数据根内）。
  需要纳入 PostgreSQL 时，设置 `VC_BACKUP_PG_DSN` 或 `VC_BACKUP_PG_CONTAINER` 恰好其一；`pg_dump -Fc` 进入同一 VCBAE1，口令不进 argv。都不设置时归档不含数据库，输出标明「未含 PostgreSQL」。
  MinIO 不纳入：导出对象约 24 小时过期，是对话与记忆的临时下载副本，权威数据在 PostgreSQL 与 ST 文件。
  恢复用 `restore.sh` 解到空目录。归档含数据库时只 `pg_restore` 到新的 `vc_restore_*` 隔离库，不覆盖当前库、不自动切换。恢复门在删除并集应用到新库和文件副本之前保持 blocked。成功后输出新库名，由 Owner 决定是否切换。
- 日志：ST 与 MemoryCore 日志在数据目录 `run/` 下；Go 由 systemd journal 收集。日志约定不含对话正文与令牌，定期轮转。
- 磁盘保护：服务器磁盘加密状态在盘点时如实记录；Owner 已决定本机不开 FileVault，服务器同样以盘点结果为准，不宣称已加密。

## 6. 完成后回填

执行者把盘点结果、实际命令与结果、访问方式、验收清单结论写回 `TODO.md` 的 `V2-OWNER-DEPLOY`、`V2-OWNER-DEVICE`、`V2-OWNER-NOTIFY`
条目（只记事实，不写口令与地址以外的敏感值），不新建证据目录。

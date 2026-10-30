# 本机常驻栈

与 `ops/deploy/v2/compose.yaml` 同一套服务。差异只在 `ops/local/compose.override.yaml`：只监听本机回环，秘密放在仓库外。

配置目录默认是家目录下的 `.virtual-companion-local`（目录 0700，文件 0600）。首次 `up` 生成本机口令；终端不打印口令。

```bash
bash scripts/local/dev.sh up
bash scripts/local/dev.sh status
bash scripts/local/dev.sh logs runtime
bash scripts/local/dev.sh down
bash scripts/local/dev.sh rebuild runtime
bash scripts/local/dev.sh rebuild st
bash scripts/local/dev.sh rebuild all
```

`up` 在缺少镜像时构建，然后迁移并等待健康，最后打印访问地址。`down` 停止容器，保留数据卷。再 `up` 会用原来的卷。

`rebuild runtime` 重建 Go 镜像并重启迁移和 runtime。`rebuild st` 重建 SillyTavern / MemoryCore 镜像。扩展目录 `integrations/sillytavern/extension/vc-model-settings` 以只读方式挂进页面；改完刷新浏览器即可，不必重建镜像。

管理员用户名在配置目录的 `admin.username`，口令在 `admin.password`。这是空库第一次启动的口令。从已有数据恢复之后，用原来的账号登录，这个文件里的口令不会覆盖已有账号。

清空本机数据卷需要两次确认：

```bash
VC_LOCAL_RESET_CONFIRM=WIPE-LOCAL-DATA bash scripts/local/dev.sh reset --confirm WIPE-LOCAL-DATA
```

## 模型

重排和嵌入模型复用本机已有文件，不自动下载。找不到时，`up` 会在错误输出里给出一条下载命令。

## 从已有数据恢复

线上别名写在配置目录 `local.env` 的 `VC_PROD_SSH_ALIAS`。不把别名、地址或域名写进本说明。

```bash
bash scripts/local/dev.sh sync-from-prod --plan
bash scripts/local/dev.sh sync-from-prod
bash scripts/local/dev.sh sync-from-prod --from-dir /path/to/backup
```

`--plan` 只打印将要调用的导出工具和别名，不连接。不带 `--from-dir` 时，通过 ssh-skill 在线上只读导出（不停服务、不改线上配置），再下载到本机。`--from-dir` 读取本地备份目录，不连接远程。

备份目录需要：

- `postgres/vc.dump`（`pg_dump -Fc`）
- `st/`（SillyTavern 数据）
- `memorycore/`（MemoryCore 数据）
- `secrets.env`（0600：解密与账号绑定所需的键，以及与线上一致的 SMTP/飞书凭据、模型开关、预算与会话时长；不含数据库口令、服务令牌、对象存储口令）
- `minio/`（可选；没有普通文件就跳过对象存储）

模型供应商与凭据随数据库一起复制。恢复后通知渠道、主动问候和排队任务保持线上原状，与线上一样会真实发送和调用模型；本机与线上同时运行时会收到两份。之后在页面里手动聊天仍可使用已保存的模型。

## 限制

首次构建镜像会比较久。工作区里的上游目录如果是指向仓库外的符号链接，构建前会在配置目录放一份上下文副本，避免镜像构建读不到链接目标。`up` 在镜像已经存在时只负责启动。PostgreSQL 迁移不能降级。`reset` 会删掉本机数据卷。线上导出是运行中的只读拷贝，不保证跨文件的瞬时一致。

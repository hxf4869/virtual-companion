# Owner V2 Docker 部署

这是 V2 栈；同级旧 Compose 不包含 ST 和 MemoryCore。所有服务器命令通过 ssh-skill 执行。
应用基线为 main `12eaee94`，仅供 Owner 非商业使用，不开放注册。

## 网络和数据

现有 Nginx 终止公网域名（`VC_PUBLIC_HOST`）的 TLS，加入 `vc-v2-edge` 后访问
`172.24.0.2:8080`。私有 ingress、companiond、ST、MemoryCore、embedding 共享网络命名空间，
业务服务保持监听 `127.0.0.1`。PostgreSQL 和 MinIO 只在 Docker internal 网络可达。
本 Compose 没有 `ports`，不增加公网监听；现有站点和 SSH 端口保留。

`172.24.0.0/24` 是部署时确认空闲的专用网段。embedding 使用 Ollama 0.33.2 CPU 镜像（`VC_EMBEDDING_IMAGE`），
只读挂载已有的 `qwen3-embedding:0.6b` 模型目录（`VC_EMBEDDING_MODELS_DIR`），单独运行服务。
`db-data`、`minio-data`、`st-data`、`memorycore-data` 是持久卷。不要执行 `down -v`。

## 私有配置

仓库外 `/etc/virtual-companion` 为 0700，所有环境文件为 root 所有、0600：

- `owner-input.env`：Owner 提供的原始资料，POSIX 引号格式；只作为数据解析，不执行。
- `db.env`、`migrate.env`、`bootstrap.env`：分别供应数据库、一次性迁移和账号初始化。
- `runtime.env`、`st.env`、`memorycore.env`：最小运行配置与各服务令牌。
- `minio.env`、`minio-init.env`：对象存储及建桶任务。

Compose 级变量放在 `/etc/virtual-companion/compose.env`（root、0600，不入库）：`VC_PUBLIC_HOST`、
`VC_EMBEDDING_IMAGE`、`VC_EMBEDDING_MODELS_DIR`。所有 `docker compose` 命令都带 `--env-file /etc/virtual-companion/compose.env`，
systemd 单元同样如此；构建 ST 镜像时 `VC_PUBLIC_HOST` 写入 SillyTavern 的 Host 白名单，未设置即构建失败。
`nginx-site.conf` 是模板，安装前把 `__VC_PUBLIC_HOST__` 替换为该域名。

运行环境文件使用每行 `NAME=原始值`，由 Compose 的 `env_file.format: raw` 读取，避免口令中
的 `$`、引号被插值。不要输出 `docker compose config`、环境变量或完整 `docker inspect`；
校验只用 `config -q`。`agents.txt`、Owner 输入和 TLS 私钥不得放入构建上下文。

## 首次启动

先按 `upstream.lock.json` 准备五个干净的上游浅克隆；可从已核验的本机检出经 ssh-skill 传输。
MinIO 和 mc 使用同级 `../minio/Dockerfile` 已固定的 amd64 发布文件；本机下载并核验后，
通过 ssh-skill 放入 `/opt/virtual-companion/minio-tools`，并复制既有 entrypoint/init 两个脚本。
`Dockerfile.minio` 在镜像中再次验证相同校验值。此方式只改变下载位置，不改变版本。
在仓库根执行 `docker compose -f ops/deploy/v2/compose.yaml config -q` 后构建镜像。
本次服务器的 GitHub、APT 和完整 Node 镜像传输不稳定，ST/MemoryCore 镜像实际在本机
OrbStack 的干净代码上下文中以 `--platform linux/amd64` 构建，再经 ssh-skill 传输并
`docker load`；上下文不含 Owner 输入、`agents.txt` 和证书。此方式保留同一 Dockerfile
及上游/依赖/补丁检查，不在服务器额外安装 Node。镜像入口设置 `umask 077`。
首次创建卷时，先用 ST 镜像的空命令挂载 `vc-v2_st-data` 和 `vc-v2_memorycore-data`，
让 Docker 复制镜像中的锁定扩展与 0700/0600 权限。将镜像里的
`/srv/vc-managed/config.yaml` 复制到宿主机 `/srv/virtual-companion/config.yaml`，
设置 UID/GID 1000、0600；将新 MinIO 卷的所有者设为 1000:1000。

```bash
docker compose -f ops/deploy/v2/compose.yaml build
docker compose -f ops/deploy/v2/compose.yaml up -d --wait
```

启动依次完成数据库、迁移、Owner 初始化、MinIO 建桶，再启动 Go、embedding、MemoryCore 和 ST。
将 `virtual-companion-v2.service` 安装到 `/etc/systemd/system/` 并启用，保证开机时由 Compose
按依赖顺序恢复共享网络命名空间。单元只编排 Docker，不在主机运行 Node，也不保存凭据。
可用 `systemctl restart virtual-companion-v2` 有序重启这一栈，不影响现有 Nginx 和其他项目。
核对实际 Owner ID 后更新 `st.env` 的映射；不能将他人绑定到同一聊天空间。
`import-notifications.go` 通过 backend 模块的构建镜像一次性运行，凭据从 0600 环境文件读取，
使用现有 Store 字段加密入库，两个渠道和正文预览保持关闭。它不认证邮箱、不发送通知。

全部健康后，才将 `nginx-site.conf` 放入现有 Nginx 的 conf.d，先 `nginx -t`，再平滑 reload。
现有 Nginx Compose 也需声明 external 网络 `vc-v2-edge`，保证重建后连接保留。
Owner 用所提供的初始口令登录，完成改密和 TOTP；模型可在模型页配置。

## 更新、停止和验收

升级前按需手动备份。应用更新按锁定版本重新构建，执行迁移后更新整个 V2 栈。
共享网络命名空间的服务需要一起重建，不单独删除 ingress；必要时执行
`docker compose -f ops/deploy/v2/compose.yaml up -d --force-recreate --wait`。
停止只针对本 Compose，不重启宿主机或现有 Nginx，不删除持久卷。

验收 Go health、MemoryCore readyz、ST 登录页、未登录拒绝私有资源、HTTPS、限流和公网端口，
并重启 V2 容器核对持久化配置。完整主机重启、真实模型调用、真实通知和手机真机验收另行记录；
未执行的项目不记通过。状态和执行结果回填根 `TODO.md`，不另建证据目录。

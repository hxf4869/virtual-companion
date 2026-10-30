# Owner V2 Docker 部署

这是 V2 栈；同级旧 Compose 不包含 ST 和 MemoryCore。所有服务器命令通过 ssh-skill 执行。
应用版本由 `compose.env` 的 `VC_IMAGE_TAG` 决定，仅供 Owner 非商业使用，不开放注册。

## 网络和数据

现有 Nginx 终止公网域名（`VC_PUBLIC_HOST`）的 TLS，加入 `vc-v2-edge` 后访问
ingress 的 `__VC_EDGE_INGRESS__:8080`。这个地址来自 Compose 变量 `VC_EDGE_INGRESS_IP`
（必须在 `compose.env` 中设置，无默认值）。私有 ingress、companiond、ST、
MemoryCore、embedding、rerank 共享网络命名空间，业务服务保持监听 `127.0.0.1`。
PostgreSQL 和 MinIO 只在 Docker internal 网络可达。
本 Compose 没有 `ports`，不增加公网监听；现有站点和 SSH 端口保留。

edge 网段是 `VC_EDGE_SUBNET`，必须在 `compose.env` 中设置（没有默认值，未设置时 Compose 拒绝启动）。已有部署在升级前把当时选定的网段和 ingress 地址写进 `compose.env`，保持与现有 Nginx 配置一致。embedding 使用 Ollama 0.33.2 CPU 镜像（`VC_EMBEDDING_IMAGE`），
只读挂载已有的 `qwen3-embedding:0.6b` 模型目录（`VC_EMBEDDING_MODELS_DIR`），单独运行服务。
Compose 设置 `OLLAMA_KEEP_ALIVE=-1`，MemoryCore 的每次嵌入请求也带 `keep_alive: -1`，模型在进程活着时保持加载。
Ollama 自身的默认是空闲约 5 分钟后卸载；卸载后的下一次嵌入要重新把模型载入内存。
rerank 使用代码中固定 digest 的 llama.cpp 镜像（多架构，含 amd64），只读挂载 `VC_RERANK_MODELS_DIR` 中的
`bge-reranker-v2-m3-Q8_0.gguf`。进程参数与 `compose.yaml` 一致：`-m /models/bge-reranker-v2-m3-Q8_0.gguf --host 127.0.0.1 --port 11439 -t ${VC_RERANK_THREADS:-4} -c 8192 -b 2048 -ub 2048 --reranking --pooling rank -ngl 0 --fit off --no-op-offload`。
模型目录变量名是 `VC_RERANK_MODELS_DIR`。它只监听共享命名空间内的 `127.0.0.1:11439`，进程启动时加载模型并常驻约 0.5 GB 内存，没有空闲卸载。它不可用、超时或返回异常时，
MemoryCore 回退到余弦 / FTS 门槛，聊天不中断。
`db-data`、`minio-data`、`st-data`、`memorycore-data` 是持久卷。不要执行 `down -v`。

## 私有配置

仓库外 `/etc/virtual-companion` 为 0700，所有环境文件为 root 所有、0600：

- `owner-input.env`：Owner 提供的原始资料，POSIX 引号格式；只作为数据解析，不执行。
- `db.env`、`migrate.env`、`bootstrap.env`：分别供应数据库、一次性迁移和账号初始化。
- `runtime.env`、`st.env`、`memorycore.env`：最小运行配置与各服务令牌。
- `minio.env`、`minio-init.env`：对象存储及建桶任务。

Compose 级变量放在 `/etc/virtual-companion/compose.env`（root、0600，不入库）：`VC_PUBLIC_HOST`、
`VC_EDGE_SUBNET`、`VC_EDGE_INGRESS_IP`、`VC_EMBEDDING_IMAGE`、`VC_EMBEDDING_MODELS_DIR`、`VC_RERANK_MODELS_DIR`，可选 `VC_RERANK_THREADS`（默认 4，按 vCPU 数设置）。所有 `docker compose` 命令都带 `--env-file /etc/virtual-companion/compose.env`，
systemd 单元同样如此；构建 ST 镜像时 `VC_PUBLIC_HOST` 写入 SillyTavern 的 Host 白名单，未设置即构建失败。
`nginx-site.conf` 是模板，安装前把 `__VC_PUBLIC_HOST__` 替换为该域名，把 `__VC_EDGE_INGRESS__` 替换为 `VC_EDGE_INGRESS_IP`。

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

`/etc/virtual-companion/compose.env` 必须含 `VC_IMAGE_TAG`（应用提交短哈希）、`VC_PUBLIC_HOST`、`VC_EDGE_SUBNET`、`VC_EDGE_INGRESS_IP`、`VC_EMBEDDING_IMAGE`、
`VC_EMBEDDING_MODELS_DIR`、`VC_RERANK_MODELS_DIR`。首次从旧版（镜像标签写死在 Compose 中）升级时先创建该文件，值取当前实际部署，并把仓库里新的
`virtual-companion-v2.service` 安装到 `/etc/systemd/system/` 后 `systemctl daemon-reload`。

升级步骤（命令都带 `--env-file /etc/virtual-companion/compose.env`）：

1. 按需手动备份（`integrations/sillytavern/scripts/backup.sh`，可设 `VC_BACKUP_PG_CONTAINER` 纳入 PostgreSQL）。
2. 同步代码到目标提交，准备该提交 `upstream.lock.json` 对应的上游浅克隆。
3. 把 `VC_IMAGE_TAG` 改为目标提交短哈希，构建（或在本机按 `--platform linux/amd64` 构建后传输并 `docker load`）新的 ST 与 runtime 镜像。
4. `docker compose ... up -d --force-recreate --wait`：`migrate` 与 `bootstrap` 一次性服务会先执行新迁移；共享网络命名空间的服务一起重建，不单独删除 ingress。
   从验收点 `09d85132`（当时 186 个迁移，停在 V265）升到当前 main 时，这一步会带上 V266–V270，现在一共 191 个迁移：
   - V266：Owner 重排开关 `vc.owner_memory_rerank`（缺行视为开启）。
   - V267：工具调用标成已验证时，协议、基地址、模型与 provider revision 必须仍与探测时一致。
   - V268：月度结算超出上限的部分记入 `overflow_usd`，不计入准入花费。
   - V269：用量汇总只含当前 Owner；缓存命中率的分母是已结算且上报了缓存计数的输入 token。
   - V270：服务端读取重排开关时断言调用者就是该 Owner。
   embedding 继续使用 Compose 里的 `OLLAMA_KEEP_ALIVE=-1`（MemoryCore 每次嵌入请求也带 `keep_alive: -1`）。重排参数与模型目录变量名见上文，变量名是 `VC_RERANK_MODELS_DIR`。
5. 验收 Go health、MemoryCore readyz、ST 登录页，并核对 `docker compose ... ps` 全部健康。旧镜像确认无误后再清理。

首次升级到含 rerank 的版本（204dc941 及之后）时另加：

1. 在仓库外的模型目录（例如 `/srv/virtual-companion/rerank-models`，UID/GID 1000 可读）放入 Hugging Face
   `gpustack/bge-reranker-v2-m3-GGUF` 的 `bge-reranker-v2-m3-Q8_0.gguf`，核对 SHA256
   `a43c7c9b11a4c1517e5bf95151960e1621d1b72f7a493364b01e386cf1aaa1d3`（635676416 字节），不一致不得使用。
2. `compose.env` 增加 `VC_RERANK_MODELS_DIR=<该目录>`；服务器 vCPU 少于 4 时设 `VC_RERANK_THREADS` 为 vCPU 数。
3. 拉取 compose 中固定 digest 的 llama.cpp 镜像；服务器拉取不稳时在本机 `docker pull --platform linux/amd64` 后 `docker save` 传输再 `docker load`。
4. 升级后核对 `rerank` 健康，并在 companiond 指标中看到 `vc_memory_rerank_applied_total` 随召回增长、`vc_memory_rerank_fallback_total` 不持续增长。

停止只针对本 Compose，不重启宿主机或现有 Nginx，不删除持久卷。回退：把 `VC_IMAGE_TAG` 改回上一版本后 `up -d --force-recreate`；
PostgreSQL 迁移不承诺降级，回退到早于已执行迁移的版本前须先评估，必要时从备份恢复到隔离库。

验收 Go health、MemoryCore readyz、ST 登录页、未登录拒绝私有资源、HTTPS、限流和公网端口，
并重启 V2 容器核对持久化配置。完整主机重启、真实模型调用、真实通知和手机真机验收另行记录；
未执行的项目不记通过。状态和执行结果回填根 `TODO.md`，不另建证据目录。

## 一条命令部署

在仓库根目录执行。服务器别名和源码目录从环境变量或本机 `~/.config/virtual-companion/deploy.env` 读取，不另存进仓库。未设置时别名是 `hxf4869`，源码目录是 `/opt/virtual-companion/source`。

```bash
bash ops/deploy/v2/deploy.sh <提交>
bash ops/deploy/v2/deploy.sh --dry-run <提交>
bash ops/deploy/v2/deploy.sh --skip-build <提交>
```

`--dry-run` 只打印步骤和远端命令。`--skip-build` 使用本机已有镜像。本机已有同标签镜像时也会跳过构建。失败时打印回退命令（把 `VC_IMAGE_TAG` 改回升级前的值再 `up`），不自动回退。

构建 ST 镜像需要 `VC_PUBLIC_HOST`，只作为构建参数，不写入日志。备份口令文件默认 `/etc/virtual-companion/st-backup.pass`（0600）。

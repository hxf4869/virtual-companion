# G12 Go runtime 容量画像（三次独立测量，Owner Mac，2026-08-30）

本报告记录 `scripts/measure/g12-go-capacity/run.sh` 的三次独立运行结果。
测量对象是 host 上的 Go `companiond full` 进程；同一 Go binary 在采样前完成
schema migration。旧后端的 Linux 历史数据不与本次 Mac 数据计算成语言收益比例。

本轮覆盖实施规范 §19.1 场景 5（4 concurrent generation + 8 SSE）、场景
7 的 100-turn soak/recovery，以及场景 10（16 concurrent generation + 64
SSE 容量画像）。这是一份 **runtime-only** 报告，不等同于完整 G12 验收：

- idle 采样窗为 60 秒，不是 §19.1 的 10 分钟；
- 尚未记录 Caddy、PostgreSQL、MinIO 的 retained-stack RSS/PSS/CPU；
- macOS 当前采样器只记录 RSS，PSS 为 `NOT_AVAILABLE`；
- 使用 loopback fake provider，无真实外网、模型费用或真实用户数据；
- Go OCI runtime image size 尚未测量；本文的 16.59 MiB 是未 strip 的 host
  binary，不得当作 image size。

因此本文用于提出 Owner Mac 的 runtime gate 候选值；门槛仍需 Owner 确认，
retained-stack 测量和 Go-only real-provider dogfood 仍需另行完成。

## 1. 环境与口径

| 项目 | 值 |
|---|---|
| 主机 | Apple M4，32 GiB，arm64 |
| 操作系统 | macOS 26.6.1（25G76） |
| Go | go1.26.7 darwin/arm64 |
| 容器运行时 | OrbStack Docker Engine 29.4.0，Linux arm64 |
| 数据库 | PostgreSQL 18 容器；每次 trial 使用新 volume |
| provider | loopback fake OpenAI-compatible provider；first token 200 ms，8 chunks |
| Go 配置 | `VC_MAX_OUTSTANDING_TURNS=16`、`VC_MAX_CONCURRENT_TURNS=16` |
| 独立性 | 每次重建 DB volume、重新启动 companiond、重新 warm-up |
| idle / recovery 窗 | measured idle 60 s；soak 前 warm-idle 10 s；soak 后 recovery 60 s |

每次 trial 的执行顺序如下：

1. 构建 Go binary，启动全新 PostgreSQL 与 fake provider；
2. `companiond migrate` 应用全部 schema migration 后退出；
3. seed 合成 provider、用户和 opaque session，启动 Go `full`；
4. 运行 1 turn warm-up；
5. 采集 60 秒 idle RSS；
6. 运行场景 5 与场景 10，并同时断言 provider 和 worker 的实际并发峰值；
7. 连续完成 100 turns，等待 60 秒后比较 RSS、goroutine、fd 和 DB pool；
8. workload 任一错误、SSE 缺失、并发峰值未达到目标或恢复计数不一致均使
   trial 失败。

复跑单次独立 trial：

```bash
G12_OUTPUT_DIR=scripts/measure/g12-go-capacity/.run/trial-N \
G12_TRIAL_ID=trial-N \
bash scripts/measure/g12-go-capacity/run.sh
```

## 2. 三次结果

### 2.1 进程与启动

| 指标 | Trial 1 | Trial 2 | Trial 3 | 中位数 | 范围 |
|---|---:|---:|---:|---:|---:|
| cold start → readiness | 798.5 ms | 772.1 ms | 956.9 ms | 798.5 ms | 772.1–956.9 ms |
| idle RSS（60 s 均值） | 19.378 MiB | 19.631 MiB | 18.894 MiB | 19.378 MiB | 18.894–19.631 MiB |
| trial 全程 peak RSS | 29.406 MiB | 29.844 MiB | 29.484 MiB | 29.484 MiB | 29.406–29.844 MiB |
| host binary | 16.59 MiB | 16.59 MiB | 16.59 MiB | 16.59 MiB | 固定 |

### 2.2 场景 5：4 generation + 8 SSE

| 指标 | Trial 1 | Trial 2 | Trial 3 | 中位数 | 范围 |
|---|---:|---:|---:|---:|---:|
| intake p95 | 13.1 ms | 39.9 ms | 18.5 ms | 18.5 ms | 13.1–39.9 ms |
| terminal p95 | 1737.3 ms | 1766.1 ms | 1731.6 ms | 1737.3 ms | 1731.6–1766.1 ms |
| SSE subscribe → terminal p95 | 671.1 ms | 830.1 ms | 717.0 ms | 717.0 ms | 671.1–830.1 ms |
| companiond CPU delta | 0.140 s | 0.157 s | 0.145 s | 0.145 s | 0.140–0.157 s |
| peak RSS | 23.016 MiB | 22.984 MiB | 23.359 MiB | 23.016 MiB | 22.984–23.359 MiB |
| provider / worker peak | 4 / 4 | 4 / 4 | 4 / 4 | 4 / 4 | 目标全部达到 |
| SSE / workload errors | 0 | 0 | 0 | 0 | 24/24 SSE 成功 |

### 2.3 场景 10：16 generation + 64 SSE

| 指标 | Trial 1 | Trial 2 | Trial 3 | 中位数 | 范围 |
|---|---:|---:|---:|---:|---:|
| intake p95 | 17.1 ms | 23.7 ms | 16.8 ms | 17.1 ms | 16.8–23.7 ms |
| terminal p95 | 1488.8 ms | 1417.8 ms | 1537.1 ms | 1488.8 ms | 1417.8–1537.1 ms |
| SSE subscribe → terminal p95 | 732.3 ms | 766.7 ms | 709.2 ms | 732.3 ms | 709.2–766.7 ms |
| companiond CPU delta | 0.365 s | 0.328 s | 0.355 s | 0.355 s | 0.328–0.365 s |
| peak RSS | 27.641 MiB | 27.391 MiB | 27.359 MiB | 27.391 MiB | 27.359–27.641 MiB |
| provider / worker peak | 16 / 16 | 16 / 16 | 16 / 16 | 16 / 16 | 配置上限全部达到 |
| SSE / workload errors | 0 | 0 | 0 | 0 | 192/192 SSE 成功 |

16 个 provider 调用和 16 个 worker 在三次 trial 中都真正同时活跃，证明本轮
不是把 16 个请求串行跑完后误报为并发。该场景到达当前配置的 generation
执行上限 16；64 SSE 全部成功且无 429。它是容量画像，不把 16 generation
承诺为常规产品并发。

### 2.4 100-turn soak 与恢复

| 指标 | Trial 1 | Trial 2 | Trial 3 | 中位数 / 结论 |
|---|---:|---:|---:|---:|
| 100-turn CPU delta | 1.755 s | 1.793 s | 1.721 s | 1.755 s |
| warm-idle RSS before → after | 28.050 → 29.394 MiB | 27.797 → 29.844 MiB | 28.250 → 29.481 MiB | 保留增量 1.344 MiB |
| RSS after-before | +1.344 MiB | +2.047 MiB | +1.231 MiB | 范围 +1.231–2.047 MiB |
| goroutine before → after | 9 → 9 | 9 → 9 | 9 → 9 | 回到基线 |
| fd before → after | 19 → 19 | 19 → 19 | 19 → 19 | 回到基线 |
| DB acquired before → after | 0 → 0 | 0 → 0 | 0 → 0 | 回到基线 |
| workload errors | 0 | 0 | 0 | 300/300 turns 成功 |

RSS 没有回到与 soak 前逐字相同的值，而是在 60 秒 recovery 后保留
1.23–2.05 MiB。这与 Go heap 保留相符，但本轮数据只证明三次结果落在窄幅
稳定区间，**不能单凭一次 100-turn 周期证明长期无泄漏**。因此候选 gate 使用
“recovery 后增量不超过 3 MiB，且 goroutine/fd/DB acquired 回到基线”；完整
G12 仍需在 10 分钟 idle/retained-stack 口径下复核是否持续单调增长。

## 3. 汇总结论

- 三次 trial 全部 PASS，共完成 360 个 measured generation、216 个 SSE；
  所有 workload error、SSE error 和 429 均为 0。
- 场景 5 和场景 10 的 provider/worker 实际峰值分别稳定达到 4/4 与 16/16。
- runtime idle RSS 中位数 19.378 MiB，全程 peak RSS 最大 29.844 MiB；没有
  使用旧后端同机复跑来制造并不必要的对照数字。
- s5 intake p95 最差 39.9 ms，s10 最差 23.7 ms；并发提高到 16 时未出现
  intake 排队恶化。
- 三次 `companiond.log` 均无 `WARN` / `ERROR`。
- PSS、retained stack、10 分钟 idle、Go image size 和真实 provider 仍为
  `NOT_RUN`，所以 G12 不能据此标记完成。

## 4. Owner Mac runtime gate 候选

以下值是在三次最大值之外保留可诊断余量的候选，不是自行冻结后的结论：

| gate | 三次观测 | 候选硬上限 |
|---|---:|---:|
| cold start → readiness | max 956.9 ms | ≤ 1.5 s |
| idle RSS（相同 60 s 口径） | max 19.631 MiB | ≤ 25 MiB |
| 场景 5 peak RSS | max 23.359 MiB | ≤ 30 MiB |
| 场景 10 / trial peak RSS | max 29.844 MiB | ≤ 35 MiB |
| 场景 5 companiond CPU delta | max 0.157 s | ≤ 0.25 s |
| 场景 10 companiond CPU delta | max 0.365 s | ≤ 0.50 s |
| 100-turn companiond CPU delta | max 1.793 s | ≤ 2.50 s |
| fixed fake-provider intake p95 | max 39.9 ms | ≤ 50 ms |
| soak recovery | RSS delta max +2.047 MiB；9 goroutines、19 fd、0 DB acquired | RSS delta ≤ +3 MiB；三个计数回到基线 |
| 场景正确性 | 216/216 SSE，360/360 turns，0 error | 0 error；并发峰值达到场景目标 |

不为未测项目编造上限：PSS、retained-stack RSS/PSS/CPU、10 分钟 idle 和 Go
OCI image size必须在补测后再冻结。旧 G1 数字只作历史背景，不参与
上述绝对门槛的计算。

## 5. G12 尚未完成的事项

1. Owner 确认或调整 §4 的 runtime gate 候选；
2. 按 §19.1 补齐 10 分钟 idle 与 retained resident stack 的三次测量，逐项
   记录 Caddy、Go、PostgreSQL、MinIO，PSS 不可得时明确标记；
3. 测量实际 Go OCI runtime image，而不是用 host binary 冒充；
4. 在获得真实 provider 凭据与费用授权后执行 Go-only dogfood；
5. 结合完整核心旅程与以上 gate 决定 G12 验收，届时才可推进破坏性的 G13。

## 6. 2026-10-21 补充：实际 Go OCI 镜像构建与隔离探活（VC-R31）

- `backend/Dockerfile` 在 OrbStack Docker 29.4.0（linux/arm64）按现状实际构建
  成功（`docker --context orbstack build --platform=linux/arm64`，未加 tag，
  未覆盖 `virtual-companion-runtime:local`），rc=0；镜像
  `sha256:9326d87870b0bd954edff4e9798fab1a3e8d0598b0c414f36aafcf45c97440e7`，
  `Os=linux`、`Architecture=arm64`、`Size=9,401,540 bytes ≈ 8.97 MiB`
  （当前 Docker 29.4.0 / containerd 后端 `inspect.Size` 的打包资源大小
  packed resources，选中 linux/arm64，含描述符/清单/配置/压缩层的该 API
  口径；依据固定版本 GitCommit `daa0cb7f` 官方源码
  <https://github.com/moby/moby/blob/daa0cb7f/daemon/containerd/image_inspect.go#L45>
  与同文件 L174-198），不是未压缩 rootfs、实际网络下载流量或多架构
  manifest 总量，`Config.User=vc`。
- 隔离探活：短命容器 `-d --network none --pull=never -e VC_MODE=api-migration`
  （其余默认、DSN 空、provider 默认 disabled，无 `-p`/`-v`），容器内 wget
  `http://127.0.0.1:8080/actuator/health` 实际返回 `HTTP/1.1 200 OK` 与
  `{"status":"UP"}`，镜像内置 healthcheck 达到 `healthy`；确认
  `NetworkMode=none`、`PortBindings={}`、`id -u=100`（非 root）。探活容器
  已 `rm -f` 并确认不存在；镜像与构建缓存保留供复核。
- 口径：本轮只补上 §5 第 3 项「测量实际 Go OCI runtime image」的镜像事实；
  镜像内 binary 为 strip 构建，与本文 16.59 MiB 未 strip host binary 属不同
  口径，不计算比例。本轮未测 unpacked rootfs，未对该口径作结论。
  api-migration 空依赖 health 仅证明进程与 HTTP 存活，不等同 full
  DB/MinIO/TLS 部署验收；上文 2026-08-30 三 trial 记录与当时的 `NOT_RUN`
  表述按当时事实保留不变。10 分钟 idle、retained-stack、PSS、real-provider
  dogfood 与 Owner gate 冻结仍开放，G12 仍不据此标记完成。

## 7. 2026-10-22 补充：600 秒 ready-idle 三次测量（VC-R35）

补 §19.1 场景 2「ready 后 idle 10 分钟」：业务代码基线为 HEAD `1ff0c3bc`，
测量在其上带本轮驱动工作区改动（下述 MinIO/bootstrap/成年 fixture 补齐）
用同一 `scripts/measure/g12-go-capacity/run.sh` 串行完成三次独立
runtime-only trial（measured idle 600 s / warm-idle 10 s / recovery 60 s，
其余场景与 §1 相同）；裸 HEAD 的 runner 不含这些 fixture，不能直接复现。
为在当前协议下启动，驱动补齐了必要 fixture：compose 项目内
loopback MinIO（同 `scripts/dev/Dockerfile.e2e-minio-tools` 钉二进制镜像）
提供 `VC_EXPORT_S3_*` 四元组、migrate 后 `companiond bootstrap` 初始化
owner-binding secret、合成 owner 走真实 `POST /api/v1/age/verification`；
测量逻辑、场景与断言未改。三次采样期间业务代码 HEAD 与上述驱动工作区均
保持不变。KEEP=0 退出
时删除 `go.env`/`compose.env` 的清理分支在三次测量之后加入，仅通过
syntax/diff 验证，未重跑测量。

| 环境 | 值 |
|---|---|
| 主机 | Apple M4，34359738368 bytes = 32 GiB，arm64 |
| 操作系统 | macOS 27.0.1 |
| Go | go1.26.7 darwin/arm64 |
| 栈 | OrbStack Docker；每 trial 新建 PostgreSQL 18、loopback fake provider、loopback MinIO |
| companiond | host `full` 进程；host binary 21,208,018 bytes（未 strip，同 §2.1 口径；与当时 16.59 MiB 属不同代码时点，不作对比） |

### 三次结果

| 指标 | Trial 1 | Trial 2 | Trial 3 |
|---|---:|---:|---:|
| trial wall | 728.9 s | 725.8 s | 727.6 s |
| cold start → readiness | 156.5 ms | 150.3 ms | 156.1 ms |
| idle RSS（600 s 均值） | 22.168 MiB | 21.022 MiB | 21.535 MiB |
| trial 全程 peak RSS | 29.688 MiB | 29.359 MiB | 29.500 MiB |
| sample.csv | 1265 行 / 688.5 s | 1265 行 / 687.2 s | 1263 行 / 687.6 s |

三次全部 PASS：SSE 与 workload error、429 均为 0；结构化日志 1652/1555/1594
行全部 INFO、WARN/ERROR 0。

- s5（4 gen + 8 SSE）：provider/worker 峰值 4/4；intake p50/p95 =
  18.0/24.9、18.8/127.9、18.0/26.6 ms；SSE stream p95 = 709.8、691.2、
  663.3 ms。
- s10（16 gen + 64 SSE）：provider/worker 峰值 16/16；intake p50/p95 =
  23.2/66.3、29.6/68.9、21.4/80.2 ms；stream p95 = 676.1、660.7、703.6 ms。
- 100-turn soak CPU delta（load-only）：1.622、1.379、1.260 s——采样点在
  recovery 等待之前（run.sh 的 SOAK_CPU_AFTER 先于 `sleep POST_IDLE_SECONDS`），
  三次 trial 的该值只覆盖 soak 负载窗；recovery 窗 CPU 自 VC-R40 起由
  recovery_cpu_seconds 另记，本三次未采。warm-idle RSS before→after（before
  为 soak 前均值，after 为 60 s recovery 窗内的采样均值）= 28.124→29.637、
  27.635→29.330、28.297→29.451 MiB；goroutine 9→11、fd 19→20 为记录值、无归基线断言；
  DB acquired 0→0 的终态归 0 有脚本断言——脚本断言为 provider delta ==
  100 与 `vc_generation_active`/`vc_realtime_subscribers`/
  `vc_db_pool_acquired` 归 0。

### 口径与未完成

- 600 s 窗与 2026-08-30 的 60 s 窗是不同观测窗，本文不跨窗计算性能收益；
  §4 的候选 gate（含 intake ≤50 ms）从未冻结，本次 trial2 s5 p95 =
  127.9 ms 如实保留，不作为通过或回退门槛。
- 本节仍为 §19.1 边界 A runtime-only：测量期存活的项目内 MinIO 是 full
模式必需 fixture，不构成 retained-stack（B）逐组件测量；PSS 未采样（`NOT_AVAILABLE`），RSS 不冒充 PSS。
- 10 分钟 recovery 窗、retained-stack、real-provider dogfood 与 Owner gate
  冻结仍开放，G12 不据此标记完成。

复跑一次独立 trial（与本次三轮同参数；端口按当时占用情况替换）：

```bash
DOCKER_CONTEXT=orbstack GOPROXY=off GOFLAGS=-mod=vendor GOTOOLCHAIN=local \
G12_OUTPUT_DIR=/tmp/vcr35/retry3/trial4 G12_TRIAL_ID=vcr35-retry3-trial4 \
G12_GO_PORT=18088 G12_GO_FAKE_PORT=19098 G12_DB_PORT=18438 G12_MINIO_PORT=19099 \
G12_IDLE_SECONDS=600 G12_WARM_IDLE_SECONDS=10 G12_POST_IDLE_SECONDS=60 \
G12_KEEP=0 bash scripts/measure/g12-go-capacity/run.sh
```

## 8. 2026-10-22 补充：常驻栈资源采集能力功能预检（VC-R57，非采样）

本轮只验证 §19.1 B 边界（Caddy + runtime + PostgreSQL + MinIO）在 Linux 容器口径下的
采集接口、权限、归属与计数单位可用性：不跑任何场景负载、10 分钟 idle/recovery、
100-turn、S5/S10 或容量/峰值/gate；所有数值仅是接口可用性证据，不构成性能或容量结论；
不改写 §2/§4/§7 历史实测，不冻结任何 Owner 门槛，G12 不据此标记完成。

### fixture（目标部署版本，合成数据）

- 以 `ops/deploy` 生产 Dockerfile/compose/Caddyfile 从绝对路径渲染私有 compose：
  合成凭据 + 全新 DB 卷（不读真实 `.env`/旧备份/既有卷），project `vcr57-probe`，
  仅 Caddy 一枚 `127.0.0.1:18446→443` TLS 口（db/runtime/MinIO 无宿主端口），
  migrate/bootstrap/runtime 共用同一本轮唯一镜像 tag。
- 组件版本即目标部署：PostgreSQL `pgvector/pgvector:0.8.5-pg18`（digest 固定）、
  companiond（`golang:1.26.7-alpine3.23` 构建，镜像 USER `vc`）、MinIO 本地封装
  `RELEASE.2025-09-07T16-13-09Z`（VC-R54 同源 sha256 固定）、Caddy v2.11.7。
- 功能验证：migrate/bootstrap/minio-init 三个 one-shot 均 exit 0；经 Caddy 内部 CA
  （仅显式 `--cacert`，不进 OS 信任）`GET /actuator/health` 与
  `/actuator/health/readiness` 均 200 `UP`。
- 平台口径：宿主 macOS arm64，容器侧 OrbStack Docker 29.4.0 / API 1.54 /
  linux arm64（Kernel 7.0.11-orbstack，online_cpus=10）。旧 R35/R43 host-Mac 结果
  保持历史，不与本轮容器口径混算比值。

**fixture 事故与处置（如实记录）**：第一次私有渲染只改了顶层 project，canonical
config 冻结的 4 个 volume 名仍是 `deploy_db-data` 等（网络名已在 up 后发现并修正重建）。
该 fixture 被 Root 停止隔离：7 个容器按已捕获确切 CID 以 `docker rm` 处置
（全部 rm rc0、事后 inspect rc1），对旧 CID 的一切探针/stats 结果一律记
`FIXTURE_INVALID`、不作任何 PSS/CPU 结论；渲染脚本改为将每个 volume 与 network 的
name 递归重写/校验为本轮 project 作用域（禁 external 与非本轮 name）后重建，
Mounts 全部指向 `vcr57-probe_*` 卷、网络唯一 `vcr57-probe_default`。4 枚 `deploy_*`
命名卷（label project=vcr57-probe、CreatedAt 本轮 12:11:32）经 Root 以 up.log/up2.log
逐条 Creating/Created 与当前对象标签/时间双重证据核清为本轮创建（非复用既有卷），
随后逐卷复核同一性与 daemon 引用 0 后按精确名称删除（rm rc0/inspect rc1/ls count0）；
R55 三枚未知归属卷仍独立为 UNVERIFIED，不与这 4 卷混称。
修正后 fixture 上重跑全部探针，以下结论均来自修正后 fixture。

### PSS：进程 smaps_rollup 可用（Linux 容器口径）

方法：短命只读 reader（同版本生产 MinIO 封装镜像；`--pid=container:<CID>`、
`--read-only`、`--network none`，与目标不同 cgroup），按目标 PID1 进程树过滤并显式
排除 reader 自身（reader PPid=0 不在树内；reader cgroup `0::/` vs 目标
`0::/../<cid>`）；逐进程读一次 `/proc/<pid>/smaps_rollup`（线程归进程统计，不逐
task 重复加总）。reader 以目标实际 UID/GID 运行：runtime 100:101、db 999:999
（两者 CapEff=0）、caddy/minio root（默认 CapEff=0xa80425fb，其中不含 SYS_PTRACE）。

结果 4/4 组件全可读、0 失败：runtime 1 进程（8 线程）Rss 15768 / Pss 15764 kB；
caddy 1 进程 Rss 50820 / Pss 50816 kB；db 12 进程（postmaster+worker）
Rss 合计 173664 / Pss 合计 55082 kB（共享页差异即 PSS 必要性）；minio 1 进程
Rss 124868 / Pss 124864 kB。结论：容器口径 PSS 采集可用，前提是 reader 与目标同
实际 UID/GID；默认权限即可，无需 SYS_PTRACE/CAP_PERFMON/privileged。§19.2 表中
PSS `NOT_AVAILABLE` 是 host-Mac 口径限制；B 边界容器口径不受该限制。

### CPU：Docker Engine API 累计口径可用

子代理经 `~/.orbstack/run/docker.sock` 直连（Python stdlib，只读 GET）：
`/version` 200；对 4 组件 `GET /containers/{id}/stats?stream=false&one-shot=true`
全部 rc=200。`cpu_stats.cpu_usage.total_usage` 存在且为容器启动以来累计纳秒计数
（kernel+user 分量齐全；本轮读数 0.14–2.52 s 量级，仅证非零可用，非样本）；
`system_cpu_usage` 与 `online_cpus=10` 可用；`percpu_usage` 4/4 缺失（与官方
"cgroup v2 下省略"一致，非缺陷）；one-shot 下 `precpu_stats` 为零值，单次调用不能
得速率百分比（需两次采样差分，且 CLI 百分比是区间速率、≠累计 CPU time）；
`memory_stats.usage` 为含 page cache 的 cgroup 计数，≠进程 RSS、更非 PSS（该 API
不暴露进程级 RSS/PSS）。已退出 PG worker 是否计入该累计：官方文档（Engine v1.54
规格与 kernel cgroup v2 `cpu.stat`）均未逐字说明，记为文档空白；口径按
"aggregated since container inception" 记，将来 G12 若以此覆盖退出 worker 语义，
需另行实测验证。

### 将来同窗 A/B 的最小接入点与十场景真实缺口（源码定位）

- 同窗采样：现有 host sampler 只采 host companiond RSS（`run.sh:300-308`）；B 边界
  最小接入是在同一循环并列追加 4 容器列（Engine API 两次采样差分 CPU + 容器内
  smaps_rollup reader PSS），场景窗口复用 `run_scenario` 的 started/ended
  （`run.sh:334/341`）。
- 流量入口：`GO_BASE` 指向 Caddy 一处改动（`run.sh:26`）；G12 compose 需引入目标
  部署 runtime/caddy 服务并把 DSN/endpoint 改服务名（当前仅 db/fake-provider/minio，
  且其 minio 为 E2E scratch 镜像，与目标部署本地封装不同源）。
- 十场景缺口：S3（idle SSE）、S4（1+1 独立场景与 first-delta 时间测量）、S8（三点
  故障注入）、S9（login/revoke 并发）完全缺失；S6 半缺（cancel 端点与
  slow-subscriber 未用）；S1 readiness 语义（当前等 `/actuator/health` 为 liveness，
  readiness 端点未消费）；S2/S7 的 10 分钟窗待补。expected-account 机制：
  `X-VC-Expected-Account-ID`（`backend/internal/httpapi/core.go:29`；write 必带且须
  匹配 cookie principal，SSE 端点不要求）。
- 未测项（完整 G12 才做）：全部十场景负载、10 分钟 idle/recovery、100-turn、S5/S10
  容器口径、容量/峰值/候选 gate、B+C 总量、Go OCI image size 与启动时间、真实
  provider dogfood、Owner 门槛冻结。

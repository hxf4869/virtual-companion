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
  部署 runtime/caddy 服务并把 DSN/endpoint 改服务名（当前仅 db/fake-provider/minio；
  其 minio 用的是 `scripts/dev/Dockerfile.e2e-minio-tools` 的 scratch 封装——与目标部署
  本地封装下载同一组 4 个官方 release asset 且 sha256 校验完全一致，差异只在封装基座
  scratch 与 Alpine（VC-R58 时点经 Root 对两个 Dockerfile 逐条核实），并非不同的 MinIO
  程序）。
- 十场景缺口：S3（idle SSE）、S4（1+1 独立场景与 first-delta 时间测量）、S8（三点
  故障注入）、S9（login/revoke 并发）完全缺失；S6 半缺（cancel 端点与
  slow-subscriber 未用）；S1 readiness 语义（当前等 `/actuator/health` 为 liveness，
  readiness 端点未消费）；S2/S7 的 10 分钟窗待补。expected-account 机制：
  `X-VC-Expected-Account-ID`（`backend/internal/httpapi/core.go:29`；write 必带且须
  匹配 cookie principal，SSE 端点不要求）。
- 未测项（完整 G12 才做）：全部十场景负载、10 分钟 idle/recovery、100-turn、S5/S10
  容器口径、容量/峰值/候选 gate、B+C 总量、Go OCI image size 与启动时间、真实
  provider dogfood、Owner 门槛冻结。

## 9. 2026-10-22 补充：常驻栈同窗 A/B 采集接入与 --probe 功能验证（VC-R58）

本轮把 `scripts/measure/g12-go-capacity/run.sh` 的测量对象从 host companiond 进程
（host `ps` RSS + 直连 metrics）改为 **ops/deploy 生产派生常驻栈上的同窗 A/B**，并以
`--probe` 功能入口实际验证生产者/消费者链路接通。NO_PERF 约束下本轮**未运行任何性能
档**（无 S5/S10、100-turn、600s idle/recovery、完整 profile），下列全部数值只是
接口可用性与功能链证据，不构成性能或容量结论；不冻结 Owner 门槛，G12 不据此标记
完成。

### 交付与接入点

- 渲染：`render_stack.py` 以 `docker compose config -p <trial>` 渲染 ops/deploy
  canonical 配置（这是 R57 事故的直接回归——不带 `-p` 时卷名冻结为 `deploy_*`），
  递归收窄卷/网络名为本轮 project 作用域、唯一 trial 镜像 tag、唯一发布口
  `127.0.0.1:18447→443`、runtime 环境覆盖（fake provider、并发上限），并双重校验
  （自有 validate + 用 `docker compose config` 真实重解析最终文件后再校验）；渲染文件
  含合成凭据，全程 umask 077/0600。
- 流量与 A/B 同一性：workload 经 Caddy TLS（`https://localhost:18447`，私有 CA 仅显式
  `--cacert`）进入 runtime 容器；A=runtime PID1 companiond（observer 容器共享其网络
  命名空间读 `/actuator/prometheus`，Caddy 不代理 metrics；RSS/PSS/fd 来自目标 cgroup
  内 PID1 的 smaps_rollup），B=db/runtime/minio/caddy 四组件容器 cgroup（Engine
  one-shot stats 累计 CPU + 逐进程 smaps_rollup 求和）。reader/observer 独立 cgroup，
  采集成本不进 B；fake provider 与 runtime 共享网络命名空间（后端把
  `VC_PROVIDER_ALLOW_LOOPBACK_HTTP` 限定在 loopback 字面量端点，service 名不合法），
  独立容器不计 B/C。
- 帧口径：每帧含 ts/platform（Engine 版本与 API）/source/integrity（逐组件
  engine_stats 状态、逐 reader 源时间与年龄、observer 状态）/四组件进程级数据与
  A/B 同帧聚合。B 同帧和仅取四组件全 OK 的帧，峰值是同帧和的峰值；每帧记录
  max_reader_age_s（本轮实测最大 1.923 s）显式暴露源时偏差。组件进程缺失（如 UID999
  reader 读不到的 UID0 `pg_isready` healthcheck exec）记 PARTIAL 并保留 missing 清单，
  绝不当 0 充当完整 B；reader 目标 cgroup 解析失败或进程全失记 NOT_AVAILABLE；Engine
  CPU 计数少于两个有效端点、或出现回落（reset/restart）时该窗 CPU 记 invalid
  （reason），不 clamp 成 0 或缩短窗口冒充有效。
- 资源安全（R55/R57 真实回归条件）：预检（project label/卷/网络/容器名预期不存在）
  失败时零 Docker 写入（实测以 `G12_PROJECT` 指向既有 project 被拒，目标资源零触碰）；
  `up` 前落创建标志与镜像 tag 基线 identity，up 后立即捕获全部容器确切 CID+完整
  Mounts/网络/compose service label；清理只用实际创建清单（collector 助手逐 CID
  stop/rm 并以 daemon 查询确认消失，compose 资源 down 后逐名核验 count 0），镜像仅
  untag 与基线 identity 不同的本轮 tag，禁 `--remove-orphans`、禁按前缀/时间收养。
  `test_collector.py` 22 例单元回归覆盖 R57 冻结名拒绝、external/非 loopback 端口/
  相对 bind/特权拒绝、PARTIAL/空进程集处理、单样本 CPU invalid、counter reset 不
  clamp。

### --probe 实测（FUNCTIONAL_ONLY）

一轮真实 `run.sh --probe`（project `vcg12c-vcr58-probe1`，输出 `/tmp/vcr58/probe1`）
PASS：migrate/bootstrap/minio-init 全部 exit 0；经 Caddy 内部 CA readiness 200
（栈就绪 6935.0 ms，含 caddy 门控量化，非旧 host 进程冷启动口径）；37/37 帧结构
完整，A 归属 37/37（runtime PID1、uid 100、comm companiond），33 帧四组件全 OK
（db 0 PARTIAL——本轮窗口未撞见 healthcheck exec 帧），reader 自身 PID 0 泄漏；
同帧 B RSS/PSS 均值 327569.8/209502.2 kB；四组件累计 CPU 差分 db 185.2 /
runtime 95.9 / minio 46.4 / caddy 50.8 ms（接口可用性证据）；一次真实 1 generation +
1 SSE 经 Caddy TLS 全链路成功，fake provider streamRequests 差分 1、worker 峰值 1、
退出后 active 0；清理后本轮容器/卷/网络/镜像 daemon 查询全部 count 0。

### CPU 累计计数对已退出 worker 的语义（独立子任务实测：RETAINED）

独立子任务（仓库只读，私有产物 `/tmp/vcr58/cpu-exit`）用固定基座
`alpine:3.23.3`（digest 固定、无 VOLUME、不装包）短命 CPU fixture（无服务、
`--network none`）实测 Docker Engine one-shot stats 累计计数是否保留已退出 child 的
CPU：run2 中 child（busybox `dd`，`/dev/zero→/dev/null`）存活期内由 PID 共享
reader 读 `/proc/<pid>/stat`，得 utime+stime 下界 931 ticks；`CLK_TCK=100`，即
≥9.31 CPU 秒。child 退出经 PID 命名空间两次枚举确认（无该 pid、主进程存活、
`DD_RC=0`）后，19 次 one-shot 采样 `total_usage` 恒为 11,555,394,000 ns（18.2 秒内
零回落），与 T0 静默基线 21,302,000 ns 之差 11,534,092,000 ns ≥ 下界
9.31e9 ns，故 **RETAINED**：退出 child 的 CPU 保留在容器累计计数中。run1（更短
child）独立复现。口径澄清：`dd` 自报 `copied, 11.542797 seconds` 是 wall elapsed，
不是 CPU 计时器；本实验未用 wait4 获取完整 child CPU，931 ticks 是存活期观测下界；
观测到的 ns/tick 经验比值仅作一致性参考，不作单位校准。落点：B 侧 CPU 用 Engine
累计计数差分即可覆盖"已退出 PG worker"语义（不必按存活 PID 求和）；counter 回落
仍按 reset 处理。本实验是计数语义验证，不是性能样本。

### 维持开放

- 十场景缺口不变：S3/S4/S8/S9 缺失、S6 半缺、S1 十分钟场景未做（本轮仅把栈就绪
  等待改用 readiness 端点）、S2/S7 的 600 s 窗未跑（默认档 `G12_IDLE_SECONDS`/
  `G12_POST_IDLE_SECONDS` 已改 600 默认面向规范）。
- 默认档既有断言未减弱（4gen8SSE、16gen64SSE、100-turn、反 replay、provider/worker
  峰值证明保留），新增 B 侧记录；本轮未运行默认档。
- B+C 总量、Go OCI image 启动时间口径、真实 provider dogfood、三次独立 trial 与
  Owner 门槛冻结仍开放；probe 不作为资源验收或产品完成。

## 10. 2026-10-22 补充：夹具所有权收口与 CPU 采样窗口有效性（VC-R59，非采样）

### 所有权改为 create receipt（nonce），不再是前后差集

R58 的"预检空 → up 后按 project label 收养"被 Root 复核否决（同 label 外来者会
被误删）。R59 改为：每次调用生成一次性 nonce（`openssl rand -hex 16`），
`render_stack.py` 把它注入渲染后 compose 的**每个** service/volume/network label
（双重渲染校验强制存在），trial tag 亦带 nonce 前缀（`<project>-<nonce8>`，显式
共享 project 的两次调用互不覆盖 tag）。启动拆为
`compose create --build --no-recreate`（只创建不启动、不碰既有容器）→ 立即记录
nonce receipt（8 容器 CID/服务/Mounts/网络、4 卷 driver+CreatedAt+nonce、网络
不可变 Id、已 build 镜像实际 Id，create 中途失败也已记录）→ **启动门**
`verify-start`：对照最终渲染配置，全部服务（含 migrate/bootstrap/minio-init/
fake-provider）、全部声明卷/网络、receipt 容器实际挂载的每个卷都必须有本轮
nonce 收据，缺失/inspect 不可读/预期名被外来者占用即拒绝 start →
`compose up -d --no-build --no-recreate` 只启动已证容器（compose 依赖/健康语义
保留）。外来者出现在 creation 窗口内（同 project label 无 nonce）不会进入清单，
也不会被启动/替换，仅被只读检测器报告；同名同 project 的替代卷/网（CreatedAt/
不可变 Id 不符）一律保留不删。消失证明只认 rc0 查询 count 0，daemon 查询失败
不判"不在"；`record_built` 用 rc0 listing 区分"未 build"与"未知"，未知即失败。
清理消费且仅消费本轮记录：collector CID（`collector.py` 的
`create_helper_container` 现在 docker run 拿到 CID 后**先持久化再 inspect**，
inspect 失败也保留准确 CID）→ 栈容器逐 CID stop/rm → 卷/网按记录身份校验后删
→ trial tag 仅在 identity 仍匹配时 untag；EXIT trap cleanup 显式 `exit` 传播
失败（`return` 不会覆盖主流程成功码），失败时保留 CAPTURE/BUILT_IMAGES/
COLLECTORS/leftovers 供恢复，不删归属清单。输出目录原子独占（默认
`.run/<trial>` 由本次调用 `mkdir`，已存在/非空/已被 claim 即拒绝，拒绝发生在
注册 cleanup 前=零 Docker 写入）；`G12_KEEP=1` 保留资源供检查但绝不授权下一轮
回收。单元回归 `test_resources.py` 27 例覆盖上述负例（bracket 内 intruder、
占预期 migrate 名、占 DB 卷、替代者保留、daemon 错误不报 gone、rc 传播、旧目录
拒绝零 Docker 调用），`test_collector.py` 增至 27 例（含 helper CID 收据先行）。

### CPU 采样窗口有效性（子交付，消费者已接）

`collector.py` 每 component 每帧记录 epoch（Engine inspect `State.StartedAt`，
失败记 null 不伪造）与 `sampled_at`（stats 响应接收时刻——非 Engine `stats.read`
时刻，窗口 bounds 按此口径，不称纳秒精确同步）。分析层给出显式 status：
**VALID**（≥2 样本、epoch 齐全且全程同一、counter 单调、窗口内无缺帧）/
**PARTIAL**（端点连续但有缺帧或样本缺 epoch，delta 附带条件，不再无条件完整值）/
**INVALID**（样本不足、counter 下降 reset、epoch 更换——含同 CID 重启后新
counter 已超过旧值的上升型，delta 为 null，不 clamp）。同 CID epoch 变化且
counter 上升、两有效端点夹缺失帧、缺 epoch、正常单调、reset 五类均有单测。
run.sh 的 scenario/probe/idle/soak 消费者改为按 `status` 断言：INVALID 报错、
PARTIAL 显式呈现（`b_cpu_status` 字段与输出行），不新增无人读的 metadata。

### 最终 --probe 实测（FUNCTIONAL_ONLY）

一轮完整新流程真实 probe（project `vcg12c-vcr59-final`，输出 `/tmp/vcr59/probe2`
700/600，端口 18448）PASS，direct rc=0，104.2 s：create→receipt（8 容器/4 卷/1
网络全带 nonce）→启动门通过→仅启动已证容器；one-shot 全 exit 0；TLS readiness
（6670.5 ms）；36/36 帧结构完整、A 归属 32/32（db 早期 2 帧 NOT_AVAILABLE 为
reader 启动期，PARTIAL 0）；一次真实 1gen+1SSE 全链路成功，provider 差分 1、
worker 峰值 1；四组件 CPU 窗口全 VALID（db 178.5/runtime 99.3/minio 62.8/
caddy 51.0 ms，接口可用性证据）；errors []。退出清理后独立 daemon 查询：project
label 对象 0、nonce 对象 0、卷 0、网络 0、trial tag 0，`cleanup.leftovers.json`
为 `{}`。此前一轮中间验证（`vcr59-probe1`，旧 up 流程）同样 PASS rc=0 且独立
核清 count 0。两轮均为功能接线验证，无数值性能结论、不构成 §19.2 样本。

### 维持开放（R59 后不变的部分）

- 十场景缺口、默认档全负载、600 s 窗、三次独立采样、Owner 冻结与真实 provider
  dogfood 均不变；R55 三个未知归属匿名卷维持"已删除、未恢复、无法证明归属"。
- `record_built` 在 daemon 故障（listing rc!=0）时归属清单可能不完整，此时按
  失败处理并保留记录；trial tag 已带每次调用的 nonce 前缀，下一轮调用 tag 必然
  不同，**旧未知 tag 不能靠下轮同名拒绝被发现**——只能如实记录 unverified 残留
  并保留 nonce/tag 线索（记录文件与 creating/config 不删）供人工核查。cleanup
  的 required 回执（capture/built）缺失/不可读/坏 JSON 同理记 unverified 非 0
  （collectors 未启动时缺失可选、存在但读坏同样升级）；显式有效空记录与未知
  状态严格区分（`_load_state` 三态）。

### 终审复核修正（Root 终审后补）

- 启动门不再按 name 集合放行：每条卷 receipt 必须有完整 driver+CreatedAt 且
  nonce==capture.nonce，网络 receipt 必须有不可变 Id 且 nonce 匹配，容器 receipt
  同样校验 nonce；`{name, identity:None}`（inspect 失败分支）或 nonce 不符一律
  拒绝 start。以 probe2 真实 created-resources + render.summary 字段重放：完整
  receipt 正例 []，卷/网任一换成 identity:None 均拒绝。
- capture 修复 list→inspect 窗口内同名替换：nonce listing 命中后若详情
  nonce/Id 已是外来者的，记为 `unverified`（保留已确认的本轮 receipt），绝不把
  替换者身份提升为本轮 receipt；cleanup 的持久化输入边界同样拒绝 nonce 不符
  记录，替换者保留仅报告。新增替换（卷/网）与不可读 identity 负例各覆盖。
- `reader_frames.sh`/`observer.sh` 写帧前 `umask 077`，frames/*.jsonl 不再依赖
  宿主 umask（probe2 遗留 0644 文件属旧行为）；探针控制器 SIGKILL 后改
  `wait(timeout=30)` 有界 reap，超时如实记 `reap_timeout`。
- cleanup 的 required 回执状态三态化（`_load_state`：missing/unknown/ok）：坏
  JSON 的 built 记录 + 合法空 capture 不再折成"空成功 rc0"——direct rc=1、
  unverified 落 leftovers、creating/capture/built（含坏文件本身）与 config 全部
  保留；已确认 receipt 仍按精确 identity 清理，collectors 缺失可选、存在但读坏
  升级。collectors"缺失可选"仅适用 launch 未尝试：run.sh 在调用 collector
  launch 前落 `.collectors-launched` 标记并传 `--collectors-required`，此后
  missing/不可读均 unverified 非 0（纯 stub 反例：已尝试+记录丢失+helper 仍活
  → rc=1、标记与记录保留、helper 不被触碰；未尝试+缺失+合法空 capture/built
  → rc=0）。负例以纯 stub（零真实 Docker 调用）覆盖 direct rc 与恢复记录保留。
  本批仅收紧非法/未知回执与权限，正常创建/启动/采集协议未变，按 Root 授权
  未重跑第 3 次 probe。

## 11. 2026-10-22 补充：S4 独立场景与真实首 delta 流式计时（VC-R60，非采样）

### 交付

- `workload.py` `Client.sse` 重写：弃用 `resp.read()` 等全流结束再整串
  `text.find("event:")` 的无量纲字节占比（该返回值既不是时间也不被消费），改为
  `read1(65536)` 有界增量解析——帧按空行切分、跨块重组、`:` 注释行（心跳位）不产出
  事件；时间戳是事件所在 socket chunk 的接收时刻（`time.monotonic()`），同一 chunk
  内多事件共享同一时刻。订阅/重试全程一个绝对 deadline：逐块检查、每次阻塞
  read1 前把连接 socket 的 timeout 重设为剩余预算（只在连接时设一次会让每次读
  重跑全额预算），deadline 后收到的 chunk 整块丢弃不解析——过期终态不得算成功
  （Root 复核以两例实测旧缺陷后修复：0.4s budget 下 0.30s burst 后静默实测
  0.710s 才返回、0.55s 终态实测 0.562s 以 ok=True 被接受），响应经上下文管理器
  在所有退出路径关闭。
- live delta 规则按后端真实契约（`internal/realtime/hub.go`，本轮只读研究证据）：
  每次 live 订阅先收一枚 catch-up `chat.snapshot`（首个 delta 前加入时 text 为空），
  之后是 live `chat.delta`，终态前另有落库回放 snapshot（>16KiB 时带 `chat.delta`
  切片）。终态已到、或第 2 枚 snapshot 已现（终态在线上丢失）时，最后 snapshot 之后
  的 delta 判为回放切片不计 live；无此二者的中断尝试，其 delta 全部保留（否则会把
  中途断线的真实样本误判为回放丢弃）。`chat.accepted` 在该后端对订阅者不可见
  （hub 条目创建与 fan-out 同锁），解析器仍支持该事件名。
- 三基线显式分离：`from_send`（POST /generations 发出时刻）、`from_accept`（202
  返回时刻）、`from_subscribe`（SSE 尝试起点）。无有效 delta 时输出原因计数
  （failed / replay_only / terminal_without_delta / no_terminal / connect_failed），
  percentile 保持 `None`，不伪造 0、不 clamp 负值。
- 独立 `s4` scenario（§19.1 场景 4：恰 1 generation + 1 SSE），`--probe` 真实改走
  s4 分支（此前借 s5 名义）。默认档新增 s4 于 s5 之前，trial.summary 纳入；
  S5/S10/100turn/峰值/反重放/600s 断言未削弱，未新增其他 scenario。
- `s4.summary.json` 记录：fake provider 已知延迟（`holdMs+firstTokenMs`，取自
  `/g12/stats` 现成 config 字段，`fake_provider.mjs` 零改动）扣除后的 qualified
  `adjusted_from_send/accept`——provider 侧从收到**它自己的**请求起算，外部不可观测，
  故 adjusted 仍含 intake/claim/provider HTTP/SSE 订阅偏移，明确标注**不是纯服务
  处理时间**；不断言任何 ms 门槛（§19.2 仍 Owner 冻结）。coverage 以 catch-up
  snapshot 文本长度为证：0=订阅先于首个 delta（收到的首 delta 即该代首 delta），
  >0=中途加入（from_send/accept 为上界）。
- 新增 `test_workload.py` 26 例（脚本化假响应+假时钟+真实 127.0.0.1 socket 三类）：
  真实 hub 序列、回放切片、分段跨块重组、同 chunk 多事件共享时刻、心跳/纯注释不误计、
  终态即返不等 EOF、纯注释 drip 绝对 deadline、EOF 重试与连接失败区分、中断尝试
  delta 保留、每次 read 的剩余预算重设（记录 settimeout 序列）、deadline 后交付的
  chunk 丢弃（脚本化确定性）与 Root 两例真实 socket 回归（burst 后静默有界于
  deadline 而非 0.70s；0.55s 过期终态不算成功）、Stats 桶与 None 语义等。

### 验证（定向，非采样）

- `test_workload.py` 26 例全绿、直接 rc=0（含 Root 复核修正后的 deadline 回归）；
  `test_collector.py` 27、`test_resources.py` 42 复跑全绿；`bash -n`/`py_compile`/
  `git diff --check` 过。未跑完整 Go/前端/E2E（零改动）。
- deadline 修正未重跑 Caddy 真实 probe（Root 指示不重启）；明文 socket 已由真实
  回归覆盖，Root 以自有 HTTPS 分段 fixture（临时私有证书+显式 CA，未改 OS 信任）
  验证了新 socket 路径：正常首 delta+终态 ok=True，同两反例均 0.402s 退出、
  ok=False、terminal=None。S4 汇总消费逻辑离线重放（保存的 probe.workload/
  observer/analysis 为输入）errors=[]、complete_stream、known-delay 扣除与原
  字段吻合——属汇总重放，非完整 profile 或新性能样本。
- 最终单次真实 `--probe`（project `vcg12c-vcr60-probe1`、port 18448、独立 OS
  控制器记录真实 Popen rc）：**rc=0、99.4 s、未触 1200 s deadline**。首次控制器
  尝试因误预建输出目录被 run.sh 独占门拒绝（发生在任何 Docker 命令之前、零写入），
  修正后重试成功。链路：1gen+1SSE、provider 差分 1、37/37 帧结构完整、runtime
  PID1 归属 37/37、四组件 CPU 窗口全 VALID、errors=[]。
- 首 delta 接线（FUNCTIONAL_ONLY，**不是性能结论**）：from_send/from_accept/
  from_subscribe = 1022.3/1004.5/222.1 ms；live_deltas_max=8 与 provider
  chunks=8 一致；joined_before_first_delta=1（订阅先于首 delta）；absent_reasons
  空。from_send−from_subscribe≈800 ms 与订阅重试等待一致，from_subscribe≈222 ms
  与 firstTokenMs=200 同量级——量级自洽，仍不作任何达标宣称。
- 清理核清：project label 容器、nonce 容器/卷/网、三个 trial tag、18448 监听全部
  rc0 且 count 0；`cleanup.leftovers.json` 为空 `{}`（resources.py 每次 cleanup 都写
  该文件，空对象=零 unverified），归属记录（compose.env/stack.compose.json/
  built-images.json/.stack-creating）已按成功路径删除。R55 三未知匿名卷口径不变。

### 维持开放

- 未跑完整 profile（S5/S10/100turn/600s 三次采样）——NO_PERF 本轮约束；s4 的
  ms 数值仅接线证明，无任何 §19.2 门槛被提出或冻结。
- 场景缺口推进：S4 已接入；S3（idle SSE）、S6（cancel/reconnect/slow subscriber）、
  S8（worker 三点异常退出）、S9（session revoke 并发）仍缺；S1/S2/S7 与 retained
  stack、10 分钟 idle/recovery、三次独立测量仍待补。G12 维持未完成。
- adjusted 值的"纯服务处理时间"不可达：provider 侧计时起点在本进程内，工作负载侧
  只能给出含订阅偏移的 qualified 值；除非 provider 协议回传服务端时间戳，该界限
  不因补字段而消除。

## 12. 2026-10-22 补充：S3 场景接入与三路静默 SSE 真实状态证明（VC-R61，非采样）

### 场景语义（写入方法，替代蓝图字面"3 路 idle SSE"）

产品 SSE 绑定 generation（claim 前订阅收空 snapshot 后 EOF、终态后快照+终态并关流），
因此"静默 SSE 订阅"在真实产品里只能作为**同一个等待 fake provider 的 generation 的
3 路已建立订阅**存在：本轮 S3 按 §19.1 场景 3 定义为"1 个等待中的 generation
（fake provider 有界 holdMs 挂起）+ 3 路已建立且静默的 SSE 订阅"，属于 A/B 资源
上下文的一部分；**不是**零 generation idle，也不改任何产品 API 制造闲置连接。
该 generation 在窗口内必须同时满足 generation_active=1、provider_active=1、
subscribers=3 且无新增内容 delta；场景结束后 1 个 generation 正常终态、3 路 SSE
全部收束、provider/worker/subscribers 回基线。

### 交付

- `fake_provider.mjs`：stats 最小新增 `contentChunkWrites`（sendStream parts 循环内
  实际写出的内容 chunk 计数；finish/usage 帧不是内容），随现有 GET /g12/stats 与
  observer 记录自然流入 frames，无通用观测框架、无生产字段。
- `workload.py`：新增 `s3` scenario（1 gen + 3 SSE）与 `--sse-timeout`（绝对
  deadline 显式传入，run.sh 按 hold+20s 协调）；新增纯函数
  `observer_quiet_runs(frames, baseline_chunks)`——静默窗口分析。采样单位是
  **去重后的 observer 记录**而非 frame：collector.py 的 Tailer 会在多个 frame 中
  复用最后一条 observer 记录（外层 frame.ts 增长不能证明新鲜采样），仍有效的重复
  记录按 `integrity.observer.observer_ts` 去重且不增长时长；**失效/缺失观测先断窗**
  ——同一缓存记录逐渐过期变 ok=false 是 collector 真实可达状态（Root 负例证实的
  修正点：原实现去重先于 ok 检查，会把中间失效帧整个丢掉、把两端拼成假窗口），
  只有仍有效的重复记录可去重。合格采样须同时满足 subscribers=3、generation_active=1、
  provider_active=1、contentChunkWrites==发起前基线；任何缺失/失效/不满足的观测
  **中断**候选窗口（不筛掉坏帧拼两端），observer ts 非严格递增同样断窗；
  `span_s` 为 observer 时间跨度。SSE 生命周期证明仍由 R60 Client.sse（绝对
  deadline/重试/live 区分）承担。
- `run.sh`：`provider_config_put` 以 `compose exec -T fake-provider node` 在本次
  trial 已验证归属（nonce receipt）的 fake-provider 服务容器内执行 PUT（有界 5s
  超时、timeout destroy、任何失败非零退出），**不新增**任何无 CID/receipt/EXIT
  回收保障的 helper 容器（Root 修正点：初版 `docker run --rm` 临时容器在 CLI 被
  中断时不可作为归属与回收证据）。holdMs 恢复闭环（Root 复验二轮修正）：原值在
  **首次 PUT 之前**登记为待恢复状态（PUT 响应丢失/超时时服务端可能已应用、外部
  无法证明未应用），正常路径恢复成功后清除；首 PUT 失败/watchdog 超时/正常路径
  都有界尝试恢复；cleanup EXIT 对仍 pending 的状态再做**恰一次**有界恢复
  （G12_KEEP=1 栈存活时同样执行），成功即清除故不重复成功恢复，失败保留非零
  rc 并显式记录——改动过的 holdMs 不可能静默存续。`run_scenario_s3`：发起前
  边界精确 scrape
  取 contentChunkWrites 基线与原 holdMs → PUT hold → **直接后台启动 python3**
  （不经包装函数，`$!` 即 python 进程本身，cleanup 对记录的准确 PID 做
  TERM→有界等待→KILL→reap，不会只杀父 shell 留下 Python 子进程）→ 静默观察器
  tail frames.jsonl 去重分析，窗口确立后立即在窗口内做一次边界精确 scrape →
  断窗/预算上限/工作负载退出时收束 → watchdog 有界等待 workload → 恢复配置 →
  断言汇总。默认 profile 在 s4 后接入 s3（S4/S5/S10/100turn/600s/反重放断言全部
  保留），trial.summary 纳入 s3；新增 `--probe-s3` 短功能入口（只跑 S3 链，
  不顺带 S4 真实生成或完整 profile），既有 `--probe` 维持 S4 1gen1SSE 不变。
- 测试：`test_workload.py` +9 例（resolve_shape、--sse-timeout 传递、去重不涨时长、
  坏样本断窗不拼接、同 ts 失效帧先断窗（Root 准确负例）、stale/缺失断窗、
  content counter 超基线断窗、非单调 ts 断窗、谓词失配原因记录），共 35 例；
  `test_resources.py` +4 例（cleanup 按记录 PID 收割残留 s3 workload 且不打扰
  零 rc 清理；**holdMs 恢复闭环三态**：首 PUT 不可达精确替身（PUT 恒败→set/
  函数内恢复/EXIT 恢复三次尝试、整体 rc=1 且 FAILED 记录）、首 PUT 响应丢失但
  provider 可达（set 失败→函数内恢复成功→pending 清除→EXIT 不再恢复、恰两次
  PUT body、无 FAILED）、pending EXIT 成功恢复恰一次 + 正常路径清除后 EXIT 零
  恢复；驱动以 run.sh 文本提取真实 run_scenario_s3（bash -n 校验完整后 source）+
  `trap cleanup EXIT` 主 shell 传播 pending 状态），共 46 例；test_collector 27
  例不变。collector.py/resources.py/render_stack.py/observer.sh 零改动（冻结遵守）。

### 验证（FUNCTIONAL_ONLY，非采样）

- `bash -n`/`py_compile`（含 run.sh 内全部 20 个 python heredoc 提取编译）/
  `node --check`（fake_provider.mjs 与内联 node 脚本）通过；三个单测套件
  35+46+27 全绿（Root 三项修正——断窗去重次序、compose exec 替换、首 PUT 失败
  恢复闭环——分别在其直接影响套件重跑；第三轮仅重跑 bash -n/heredoc 编译/
  test_resources 46 例）。
- 单次真实 `--probe-s3`（project `vcg12c-vcr61-probe1`、port 18448、独立 OS
  控制器 umask 077/独立进程组/真实 Popen rc/1200s deadline）：**rc=0、122.7 s、
  未触 deadline**。静默窗口：5 个去重独立 observer 采样、observer 跨度 4.0 s、
  全程 contentChunkWrites==发起前基线 0；窗口内边界精确 scrape 同时证明
  subscribers=3/generation_active=1/provider_active=1/内容写出 0；断言零妥协
  （3/3 SSE 收束、first delta observed=3 且 coverage joined_before_first_delta=3
  ——三路都在首 delta 前静默建立、provider 差分 1、内容 chunk 差分 8==chunks
  配置、结束后 active generation/provider/subscribers 全回 0、A/B 同窗采集
  A PID1 帧+8 完整同帧+四组件 CPU 全 VALID、errors=[]）。
- 量级自洽（不作性能结论）：stream p50 6707 ms ≈ hold 6000+firstToken 200+8×50；
  from_subscribe p50 6245.5 ms ≈ 静默中订阅、hold 释放后首 delta 到达；
  CPU 0.085 s 为场景全程接线值。probe 窗口参数（hold 6000/quiet 2000）与完整
  方法参数（hold 8000/quiet 3000，均可经 `G12_S3_*`/`G12_PROBE_S3_*` 覆盖）均
  记录在 s3 summary 的 method 块。
- 清理核清：run.sh 成功路径 cleanup 后，独立 daemon 查询 project label 容器/卷/网、
  nonce（vc.g12.nonce）容器/卷/网、三个 trial tag、18448 监听全部 rc0 且 count 0；
  `cleanup.leftovers.json` 空 `{}`；config-set holdMs=6000 与 config-restore
  holdMs=0 均有记录且 restore 无 stderr；无残留 workload 进程。R55 三未知卷口径
  不变。时序说明：该真实 probe 运行于首 PUT 失败恢复修正之前；该修正后仅重跑
  受影响本地测试/语法检查与 Root 准确负例，没有再次跑实栈。

### 维持开放

- 完整 profile（含 s3 的 S5/S10/100turn/600s 三次采样）本轮未跑——NO_PERF 约束；
  probe-s3 的数值仅功能接线证明，无任何 §19.2 门槛被提出或冻结。
- 场景缺口推进：S3、S4 已接入；S6（cancel/reconnect/slow subscriber）、S8（worker
  三点异常退出）、S9（session revoke 并发）仍缺；S1/S2/S7 与 retained stack、
  10 分钟 idle/recovery、三次独立测量仍待补。G12 整体维持未完成、不冻结 Owner
  门槛；Owner gate/真实 provider/dogfood 均未涉及。

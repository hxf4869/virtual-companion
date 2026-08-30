# G12 Go runtime 容量画像（三次独立测量，Owner Mac，2026-08-30）

本报告记录 `scripts/measure/g12-go-capacity/run.sh` 的三次独立运行结果。
测量对象是 host 上的 Go `companiond full` 进程；Java 只负责应用 Flyway
migration，Go 启动和采样前已经停止，**没有重新测量 Java，也不把 Linux Java
历史数据与本次 Mac 数据计算成语言收益比例**。

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
2. Java runtime 只应用 migration，健康后立即停止；
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
  使用 Java 同机复跑来制造并不必要的对照数字。
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
OCI image size必须在补测后再冻结。Linux Java G1 数字只作历史背景，不参与
上述绝对门槛的计算。

## 5. G12 尚未完成的事项

1. Owner 确认或调整 §4 的 runtime gate 候选；
2. 按 §19.1 补齐 10 分钟 idle 与 retained resident stack 的三次测量，逐项
   记录 Caddy、Go、PostgreSQL、MinIO，PSS 不可得时明确标记；
3. 测量实际 Go OCI runtime image，而不是用 host binary 冒充；
4. 在获得真实 provider 凭据与费用授权后执行 Go-only dogfood；
5. 结合完整核心旅程与以上 gate 决定 G12 验收，届时才可推进破坏性的 G13。

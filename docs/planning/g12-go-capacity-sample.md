# G12 Go 容量画像样本（Owner Mac，2026-08-30）

`scripts/measure/g12-go-capacity/run.sh` 的合成单样本输出（loopback fake
provider、无真实外网、无真实用户数据）。对应实施规范 §19.1 场景 5（4
generation + 8 SSE 稳定）与场景 10（16 generation + 64 SSE 容量画像），
以及 §19.2 门槛表的 Go 侧实测列。

**样本性质**：单次运行、Owner Mac（darwin arm64）、fake provider 固定
delta/延迟（first token 200ms / 8 chunks）。§19.2 要求 warm-up 后 ≥3 次
独立测量并经 Owner 冻结，本文件不构成冻结门槛；复跑入口：

```bash
bash scripts/measure/g12-go-capacity/run.sh
```

栈：PostgreSQL 18（OrbStack 容器，Java runtime 仅作为 Flyway migrator 应用
V1–V117 后即停，§21.2 并存模式）+ host Go companiond `full`（并发配置
`VC_MAX_OUTSTANDING_TURNS=16, VC_MAX_CONCURRENT_TURNS=16`，上限内）。

## 结果（单样本）

| 指标 | Go 实测（Mac 样本） | G1 Java 中位数（Linux） | 备注 |
|---|---:|---:|---|
| runtime idle RSS | 25.4 MiB（60s 均值） | 372.5 MiB | 约 1/15，见 §19.2 行 1 |
| 场景 5 全程 peak RSS | 26.1 MiB | 409.2 MiB（4gen 窗口） | 负载期无明显增长 |
| 场景 10 全程 peak RSS | 26.1 MiB | n/a | 16gen+64SSE 无 RSS 增长 |
| cold start/readiness | 约 1–2 s（见 companiond.log） | 6.22 s | 未做 ≥3 次测量 |
| 场景 5 intake p50/p95 | 18.1 / 23.8 ms | 19.17 ms p50（intake） | 同量级 |
| 场景 5 terminal p50/p95 | 2.36 / 2.99 s | n/a（fake 行为不同） | 含 fake 延迟 |
| 场景 5 stream p50/p95 | 0.62 / 0.72 s | n/a | 订阅→终态事件 |
| 场景 10 intake p50/p95 | 14.9 / 18.5 ms | n/a | 16 并发无排队恶化 |
| 场景 10 terminal p50/p95 | 6.89 / 11.93 s | n/a | 16gen 并发画像 |
| 场景 10 stream p50/p95 | 0.62 / 0.70 s | n/a | 64 订阅者 |
| SSE 成功率 | s5 8/8、s10 64/64 | n/a | 0 错误、0 429 |
| companiond 日志 ERROR/WARN | 0 | n/a | 无 DISCONNECTED/finalize 失败 |

## 观察

- Go runtime idle RSS 25.4 MiB，远低于调优 Java 的 372.5 MiB（Linux 样本），
  且 16gen+64SSE 全程峰值 26.1 MiB 无单调增长（§19.2“100 turns 后回落”
  规则方向上成立；正式验收需 ≥3 次独立测量）。
- 并发 intake p50 ~15–18 ms，与 Java 基线同量级，无资源换延迟的迹象。
- 场景 10 的 terminal p95 11.9 s 主要来自 fake provider 固定 8 chunks ×
  50ms + 16 并发在单 node 进程上的串行化；真实 provider 行为另行测量。

## 待 Owner

§19.2 门槛表“Go 硬上限 / Owner 冻结”列仍空置——需 Owner 按 ≥3 次独立
测量冻结 Mac 门槛后，G12 才完成验收；本样本不替代冻结。

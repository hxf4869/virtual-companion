# G1 Java 资源/事务基线（Linux 实测）

> 状态：本机 Linux 可重复报告，**不是** Owner Mac 冻结门槛  
> 规范：`docs/planning/2026-08-30-go-companion-runtime-redesign.md` §19.1 / Phase 0  
> HEAD：`60d63176d1b983d9f7a971739c3d36d06002ef5e`  
> 开始：2026-08-29T21:39:53Z　结束：2026-08-29T22:59:16Z

## 0. 先读这段

这是 Technical Alpha 在 **Debian Linux x86_64** 上测得的 Java 基线，用于给后续 Go 对照提供方法、脚本和一组诚实数字。它：

- **不是** Owner 的 Mac 数字；
- **不能**当作已冻结的 Go 硬上限或 Owner 绝对预算；
- 只允许了一次有界公平调优：容器 `mem_limit=1536m` + `JAVA_TOOL_OPTIONS=-XX:MaxRAMPercentage=70.0 -XX:InitialRAMPercentage=20.0`。没有做 Java 架构优化。

复跑：`bash scripts/measure/g1-java-baseline/run.sh`。原始机器结果在同目录 `.run/`（gitignored，含本地合成口令，不入库）。

## 1. 机器与口径

| 项 | 值 |
|---|---|
| hostname | cursor |
| OS | Linux 6.12.94+ |
| CPU | 8 × Intel(R) Xeon(R) Processor |
| 内存 | 16013.4 MiB 总量 |
| Owner Mac? | **否**（This is a Linux measurement host, not the Owner Mac. Numbers here are not frozen Owner gates.） |
| 容器引擎 | Docker（本机 `box` 用户通过 docker 组 / `sg docker`） |
| 测量网络 | host（host 覆盖仅在 bridge ICC 失败时启用） |
| 存储驱动 | 以 `docker info` 为准（本环境曾为 vfs） |
| runtime-only | 只报 `runtime` 容器内进程 RSS/PSS/CPU/fd |
| retained stack | Caddy + runtime + PostgreSQL + MinIO 的进程 RSS/PSS 之和 |
| model provider | 合成 fake provider（loopback Node）。本机 Ollama：未安装/未运行，单列，不归因于语言 |
| RSS | 容器内 `/proc/<pid>/status` VmRSS 求和 |
| PSS | 容器内 `/proc/<pid>/smaps_rollup` Pss 求和（读不到则 n/a） |
| cgroup | `/sys/fs/cgroup/memory.current`，**不与 RSS 混填同一格** |
| CPU | 容器内 utime+stime ticks / clk_tck |
| 数据量 | G1 隔离空 volume + Flyway + 本轮合成 workload，不是 Owner 数据 |

公平调优：`1536m` / `-XX:MaxRAMPercentage=70.0 -XX:InitialRAMPercentage=20.0`。  
Caddy 本轮为 **HTTP-only + stub H5**（无 ACME/TLS）。Owner Mac dogfood 的 HTTPS 不在这组数字里。  
生产 profile + MinIO 开启 + loopback fake provider。真实 provider **未**用于 CPU/RSS 对比。

Boot jar：55.9 MiB。Runtime image：432.1 MiB。

## 2. 场景结果

| 场景 | 结果 | 备注 |
|---|---|---|
| 1. cold start 到 readiness | PASS | |
| 2. ready 后 idle | PASS | |
| 3. 3 路 idle/long SSE + DB 事务持有 | PARTIAL | 20s hold streams returned 429: the preceding 3x 1gen+SSE occupied Java SSE_MAX_CONCURRENT=3 leases (TTL 130s). pg_stat_activity therefore saw idle pool connections, not a 20s xact. Code-level OwnerInjectionFilter + sync liveTail still holds the request transaction; Go must not copy it. |
| 4. 1 generation + 1 SSE | PASS | |
| 5. 4 concurrent generation + 8 SSE | PASS | |
| 6. cancel / reconnect / slow subscriber | PARTIAL | cancel POST timed out; reconnect/slow still recorded |
| 7. 100 连续 generation 后 idle | PARTIAL | |
| 8. worker 在 claim / stream / finalize 异常退出 | PASS | |
| 9. login / session revoke 并发 | PARTIAL | 8 threads, 0 successful logins (auth admission bulkhead/rate) |
| 10. 16 generation + 64 SSE 容量画像 | PARTIAL | Opening 64 concurrent live-tails would require many owners or raising Java SSE_MAX_CONCURRENT; G1 does not change product caps. 16 streams already portrait saturation. |

### 2.1 长 SSE 持有 DB 事务（§2.3 量化）

Java 事实（代码，不依赖本次数字）：`OwnerInjectionFilter` 用 `OwnerContext.asOwner` 包住整个已认证请求；`RealtimeStreamController.liveTail` 在返回 `SseEmitter` 之前同步阻塞，最长 120s；Hikari `maximumPoolSize=5`；单 owner SSE 上限 3。

本次实测（fake provider `holdMs=20000`，3 路 SSE）：本轮这 3 路在 1gen×3 仍占用 SSE 租约时全部 **429**，因此 **没有采到 20s 事务年龄**（见上表 PARTIAL）。下面 0.0 s 不是“没有持有事务”，只是这次 hold 窗口没有真正连上 live-tail。

- runtime login 会话最长事务年龄：**0.0 s**（hold 未连上；代码路径仍是请求级事务）
- 同时 active：**0**
- idle in transaction：**0**

采样只取 `pg_stat_activity` 的 pid/usename/state/wait_event/年龄，**不 SELECT query 文本**。若最长事务年龄贴近 hold 窗口，即可确认 live-tail 持有事务。Go 不得复制该边界。

Java `liveTail` 在 controller 返回 `SseEmitter` 之前同步阻塞，客户端看到的 first-event 可能等于整段流结束（缓冲到方法返回）。这是基线事实，不是 Go 对照时可以忽略的口径。

### 2.2 受保护列格式计数

库是本机 G1 合成 volume，**不是 Owner Mac 数据**。只记数量与列名。

| 列 | 当前写形态 | enc2 合格 | enc2 畸形 | enc1 | 无前缀 | 不可识别 | NULL | 行数 |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| `vc.conversation_summary.summary` | rest_field_cipher_enc2 | 21 | 0 | 0 | 0 | 0 | 0 | 21 |
| `vc.generation_candidate.content` | rest_field_cipher_enc2 | 29 | 0 | 0 | 0 | 0 | 0 | 29 |
| `vc.memory_item.summary` | rest_field_cipher_enc2 | 29 | 0 | 0 | 0 | 0 | 0 | 29 |
| `vc.message.content` | rest_field_cipher_enc2 | 166 | 0 | 0 | 0 | 0 | 0 | 166 |

`vc.emergency_contact.contact_cipher` 的当前写形态是无 `enc2:` 前缀的 AES-GCM envelope；无前缀 **不等于** 旧明文。Owner 真数据必须用同一 `cipher_counts.sql` 再跑一遍。

## 3. 填回 §19.2 的 Java 列（本机 Linux）

Go 硬上限列保持「Owner 冻结」，**不要**把下面的 Linux 数字写成 Mac 门槛。

| 指标 | 调优 Java 中位数（Linux） | Java 波动范围 | Go 硬上限 |
|---|---:|---:|---|
| runtime idle RSS | 372.5 MiB | 371.5 MiB – 373.0 MiB | Owner 冻结（未冻结） |
| runtime idle PSS | 369.3 MiB | 368.4 MiB – 370.0 MiB | Owner 冻结（未冻结） |
| runtime `4 turn + 8 SSE` peak RSS/PSS | 409.2 MiB RSS / 406.0 MiB PSS | see four_gen_eight_sse samples | Owner 冻结（未冻结） |
| runtime 同 workload CPU time | 0.67 s | 0.46 s – 1.15 s | Owner 冻结（未冻结） |
| cold start/readiness | 6.22 s | 6.20 s – 6.24 s | Owner 冻结（未冻结） |
| API app-overhead p50/p95（intake） | 19.17 ms | 15.70 ms – 40.71 ms | Owner 冻结（未冻结） |
| retained stack idle RSS | 633.7 MiB | 633.6 MiB – 634.8 MiB | Owner 的 Mac 绝对预算（未冻结） |
| retained stack idle 窗口 CPU（runtime 分量） | 4.71 s | 3.62 s – 6.35 s | Owner 的 Mac 绝对预算（未冻结） |
| runtime image size | 432.1 MiB | n/a | Owner 冻结（未冻结） |

Java 单 owner SSE 上限 3、generation 上限 4、Hikari 5；8 SSE 需多 owner。4 turn 峰值取 4gen+3sse/8sse 采样窗口的 runtime RSS/PSS。Go 硬上限不在本机冻结。

`4 turn + 8 SSE` 峰值：Java 产品上限使单 owner 只能稳定做到 4 generation + 3 SSE。多 owner 的 8 SSE 是容量画像，不是产品承诺。未跑到的 64 SSE 标 NOT_RUN，**不要**发明数字。

100 generation 后 post-idle：RSS 411.5 MiB → 435.0 MiB；fd 41 → 40。

## 4. 最终快照：逐组件

| 组件 | RSS | PSS | cgroup | fd | nproc |
|---|---:|---:|---:|---:|---:|
| runtime | 369.5 MiB | 366.6 MiB | 347.5 MiB | 55 | 2 |
| caddy | 51.3 MiB | 50.5 MiB | 18.9 MiB | 21 | 2 |
| db | 292.2 MiB | 0.3 MiB | 144.1 MiB | 443 | 16 |
| minio | n/a | n/a | n/a | None | None |

Fake provider 与本机 Ollama（若有）不计入 retained stack，也不计入语言收益。

## 5. 如何复跑

```bash
bash scripts/measure/g1-java-baseline/run.sh
# 可选：G1_IDLE_SECONDS=600 G1_TRIALS=3 G1_KEEP=1
```

依赖：Docker（本机可能需要 `sudo -n docker`）、能拉 JDK 25 / pgvector / MinIO / Caddy / Node 镜像、仓库内 `mvnw` 在容器里打包 runtime jar。缺依赖时脚本应标 NOT_RUN，而不是编造数字。

本脚本 **不** 进入 `scripts/check.sh`（远超秒级预算）。

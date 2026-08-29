#!/usr/bin/env python3
"""Render the G1 baseline markdown report from results.json. No secrets."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


def mib(n: Any) -> str:
    if not isinstance(n, (int, float)):
        return "n/a"
    return f"{n / 1048576:.1f} MiB"


def num(n: Any, unit: str = "") -> str:
    if not isinstance(n, (int, float)):
        return "n/a"
    if unit:
        return f"{n:.2f} {unit}".rstrip("0").rstrip(".") + ("" if unit else "")
    if abs(n) >= 100:
        return f"{n:.1f}"
    return f"{n:.3f}".rstrip("0").rstrip(".")


def summarize_cell(summary: dict[str, Any] | None, *, as_mib: bool = False, unit: str = "") -> tuple[str, str]:
    summary = summary or {}
    if not summary.get("n"):
        return "Phase 0 填写", "Phase 0 填写"
    med = summary.get("median")
    lo, hi = summary.get("min"), summary.get("max")
    if as_mib:
        return mib(med), f"{mib(lo)} – {mib(hi)}" if lo is not None else "n/a"
    return num(med, unit), f"{num(lo, unit)} – {num(hi, unit)}" if lo is not None else "n/a"


def status_line(scenarios: dict[str, Any]) -> list[str]:
    rows = []
    mapping = [
        ("cold_start", "1. cold start 到 readiness"),
        ("idle", "2. ready 后 idle"),
        ("sse_db_transaction_hold", "3. 3 路 idle/long SSE + DB 事务持有"),
        ("one_gen_one_sse", "4. 1 generation + 1 SSE"),
        ("four_gen_eight_sse", "5. 4 concurrent generation + 8 SSE"),
        ("cancel_reconnect_slow", "6. cancel / reconnect / slow subscriber"),
        ("hundred_generations", "7. 100 连续 generation 后 idle"),
        ("worker_crash", "8. worker 在 claim / stream / finalize 异常退出"),
        ("login_revoke", "9. login / session revoke 并发"),
        ("capacity_16_64", "10. 16 generation + 64 SSE 容量画像"),
    ]
    for key, label in mapping:
        sc = scenarios.get(key) or {}
        st = sc.get("status")
        if not st:
            if key == "login_revoke" and sc:
                st = "PARTIAL" if sc.get("logins") or sc.get("errors") else "NOT_RUN"
            else:
                st = "NOT_RUN"
        extra = sc.get("reason") or sc.get("reason_not_run") or sc.get("sixty_four_sse_reason") or ""
        if key == "cancel_reconnect_slow" and (sc.get("cancel") or {}).get("status") == "FAIL":
            st = "PARTIAL"
            extra = extra or "cancel POST timed out"
        if extra and st in {"NOT_RUN", "FAIL", "PARTIAL"}:
            rows.append(f"| {label} | {st} | {extra} |")
        else:
            rows.append(f"| {label} | {st} | |")
    return rows


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--results", required=True)
    parser.add_argument("--markdown", required=True)
    parser.add_argument("--json-out", required=True)
    args = parser.parse_args()
    data = json.loads(Path(args.results).read_text())
    scenarios = data.get("scenarios") or {}
    machine = data.get("machine") or {}
    tuning = data.get("tuning") or {}
    artifacts = data.get("artifacts") or {}
    idle = scenarios.get("idle") or {}
    cold = scenarios.get("cold_start") or {}
    one = scenarios.get("one_gen_one_sse") or {}
    four = scenarios.get("four_gen_eight_sse") or {}
    hold = scenarios.get("sse_db_transaction_hold") or {}
    hundred = scenarios.get("hundred_generations") or {}
    cipher = data.get("cipher_baseline") or {}
    final = data.get("final_snapshot") or {}

    idle_rss_med, idle_rss_range = summarize_cell(idle.get("runtime_rss_bytes"), as_mib=True)
    idle_pss_med, idle_pss_range = summarize_cell(idle.get("runtime_pss_bytes"), as_mib=True)
    four_peak_rss = four.get("runtime_rss_peak_bytes")
    four_peak_pss = four.get("runtime_pss_peak_bytes")
    if isinstance(four_peak_rss, (int, float)):
        one_peak, one_peak_range = mib(four_peak_rss), "see four_gen_eight_sse samples"
        if isinstance(four_peak_pss, (int, float)):
            one_peak = f"{mib(four_peak_rss)} RSS / {mib(four_peak_pss)} PSS"
    else:
        one_peak, one_peak_range = summarize_cell(one.get("runtime_rss_peak"), as_mib=True)
    cpu_med, cpu_range = summarize_cell(one.get("runtime_cpu_seconds"), unit="s")
    ready_med, ready_range = summarize_cell(cold.get("readiness_s"), unit="s")
    intake_med, intake_range = summarize_cell(one.get("intake_ms"), unit="ms")
    retained_idle, retained_idle_range = summarize_cell(idle.get("retained_rss_bytes"), as_mib=True)
    retained_cpu, retained_cpu_range = summarize_cell(idle.get("runtime_cpu_seconds"), unit="s")
    image = artifacts.get("runtime_image_bytes")
    jar = artifacts.get("boot_jar_bytes")

    # 4 turn peak: we may not have RSS median; use one_gen peak as lower bound
    four_note = (
        "Java 单 owner SSE 上限 3、generation 上限 4、Hikari 5；"
        "8 SSE 需多 owner。4 turn 峰值取 4gen+3sse/8sse 采样窗口的 runtime RSS/PSS。"
        "Go 硬上限不在本机冻结。"
    )

    cipher_rows = []
    for col in cipher.get("columns") or []:
        cipher_rows.append(
            "| `{table}.{col}` | {expected} | {enc2} | {enc2m} | {enc1} | {unpref} | {unk} | {nulls} | {n} |".format(
                table=col.get("table_name"),
                col=col.get("column_name"),
                expected=col.get("expected_current_write"),
                enc2=col.get("enc2_wellformed"),
                enc2m=col.get("enc2_malformed"),
                enc1=col.get("enc1"),
                unpref=col.get("unprefixed"),
                unk=col.get("unrecognized"),
                nulls=col.get("null_value"),
                n=col.get("row_count"),
            )
        )
    if not cipher_rows:
        cipher_rows.append("| n/a | n/a | | | | | | | |")

    components = ((final.get("components") or {}) if final else {})
    comp_lines = []
    for name in ("runtime", "caddy", "db", "minio"):
        row = components.get(name) or {}
        if not row.get("present"):
            comp_lines.append(f"| {name} | NOT_RUN / 不在最终快照 | | | | |")
            continue
        comp_lines.append(
            "| {name} | {rss} | {pss} | {cgroup} | {fd} | {nproc} |".format(
                name=name,
                rss=mib(row.get("rss_bytes")),
                pss=mib(row.get("pss_bytes")) if row.get("pss_bytes") is not None else "n/a",
                cgroup=mib(row.get("cgroup_memory_bytes")),
                fd=row.get("fd"),
                nproc=row.get("nproc"),
            )
        )

    md = f"""# G1 Java 资源/事务基线（Linux 实测）

> 状态：本机 Linux 可重复报告，**不是** Owner Mac 冻结门槛  
> 规范：`docs/planning/2026-08-30-go-companion-runtime-redesign.md` §19.1 / Phase 0  
> HEAD：`{data.get("git_head")}`  
> 开始：{data.get("started_at")}　结束：{data.get("finished_at")}

## 0. 先读这段

这是 Technical Alpha 在 **Debian Linux x86_64** 上测得的 Java 基线，用于给后续 Go 对照提供方法、脚本和一组诚实数字。它：

- **不是** Owner 的 Mac 数字；
- **不能**当作已冻结的 Go 硬上限或 Owner 绝对预算；
- 只允许了一次有界公平调优：容器 `mem_limit=1536m` + `JAVA_TOOL_OPTIONS=-XX:MaxRAMPercentage=70.0 -XX:InitialRAMPercentage=20.0`。没有做 Java 架构优化。

复跑：`bash scripts/measure/g1-java-baseline/run.sh`。原始机器结果在同目录 `.run/`（gitignored，含本地合成口令，不入库）。

## 1. 机器与口径

| 项 | 值 |
|---|---|
| hostname | {machine.get("hostname")} |
| OS | {machine.get("os")} |
| CPU | {machine.get("cpu_count")} × {machine.get("cpu_model")} |
| 内存 | {mib(machine.get("mem_total_bytes"))} 总量 |
| Owner Mac? | **否**（{machine.get("notes")}） |
| 容器引擎 | Docker（本机 `box` 用户通过 docker 组 / `sg docker`） |
| 测量网络 | {data.get("measurement_network") or "compose-bridge"}（host 覆盖仅在 bridge ICC 失败时启用） |
| 存储驱动 | 以 `docker info` 为准（本环境曾为 vfs） |
| runtime-only | 只报 `runtime` 容器内进程 RSS/PSS/CPU/fd |
| retained stack | Caddy + runtime + PostgreSQL + MinIO 的进程 RSS/PSS 之和 |
| model provider | 合成 fake provider（loopback Node）。本机 Ollama：{"存在" if machine.get("ollama_binary") or machine.get("ollama_processes") else "未安装/未运行"}，单列，不归因于语言 |
| RSS | 容器内 `/proc/<pid>/status` VmRSS 求和 |
| PSS | 容器内 `/proc/<pid>/smaps_rollup` Pss 求和（读不到则 n/a） |
| cgroup | `/sys/fs/cgroup/memory.current`，**不与 RSS 混填同一格** |
| CPU | 容器内 utime+stime ticks / clk_tck |
| 数据量 | G1 隔离空 volume + Flyway + 本轮合成 workload，不是 Owner 数据 |

公平调优：`{tuning.get("container_mem_limit")}` / `{tuning.get("java_tool_options")}`。  
Caddy 本轮为 **HTTP-only + stub H5**（无 ACME/TLS）。Owner Mac dogfood 的 HTTPS 不在这组数字里。  
生产 profile + MinIO 开启 + loopback fake provider。真实 provider **未**用于 CPU/RSS 对比。

Boot jar：{mib(jar)}。Runtime image：{mib(image)}。

## 2. 场景结果

| 场景 | 结果 | 备注 |
|---|---|---|
{chr(10).join(status_line(scenarios))}

### 2.1 长 SSE 持有 DB 事务（§2.3 量化）

Java 事实（代码，不依赖本次数字）：`OwnerInjectionFilter` 用 `OwnerContext.asOwner` 包住整个已认证请求；`RealtimeStreamController.liveTail` 在返回 `SseEmitter` 之前同步阻塞，最长 120s；Hikari `maximumPoolSize=5`；单 owner SSE 上限 3。

本次实测（fake provider `holdMs=20000`，3 路 SSE）：

- runtime login 会话最长事务年龄：**{hold.get("observed_max_runtime_login_xact_age_s")} s**
- 同时 active：**{hold.get("observed_max_runtime_login_active")}**
- idle in transaction：**{hold.get("observed_max_idle_in_transaction")}**

采样只取 `pg_stat_activity` 的 pid/usename/state/wait_event/年龄，**不 SELECT query 文本**。若最长事务年龄贴近 hold 窗口，即可确认 live-tail 持有事务。Go 不得复制该边界。

Java `liveTail` 在 controller 返回 `SseEmitter` 之前同步阻塞，客户端看到的 first-event 可能等于整段流结束（缓冲到方法返回）。这是基线事实，不是 Go 对照时可以忽略的口径。

### 2.2 受保护列格式计数

库是本机 G1 合成 volume，**不是 Owner Mac 数据**。只记数量与列名。

| 列 | 当前写形态 | enc2 合格 | enc2 畸形 | enc1 | 无前缀 | 不可识别 | NULL | 行数 |
|---|---|---:|---:|---:|---:|---:|---:|---:|
{chr(10).join(cipher_rows)}

`vc.emergency_contact.contact_cipher` 的当前写形态是无 `enc2:` 前缀的 AES-GCM envelope；无前缀 **不等于** 旧明文。Owner 真数据必须用同一 `cipher_counts.sql` 再跑一遍。

## 3. 填回 §19.2 的 Java 列（本机 Linux）

Go 硬上限列保持「Owner 冻结」，**不要**把下面的 Linux 数字写成 Mac 门槛。

| 指标 | 调优 Java 中位数（Linux） | Java 波动范围 | Go 硬上限 |
|---|---:|---:|---|
| runtime idle RSS | {idle_rss_med} | {idle_rss_range} | Owner 冻结（未冻结） |
| runtime idle PSS | {idle_pss_med} | {idle_pss_range} | Owner 冻结（未冻结） |
| runtime `4 turn + 8 SSE` peak RSS/PSS | {one_peak} | {one_peak_range} | Owner 冻结（未冻结） |
| runtime 同 workload CPU time | {cpu_med} | {cpu_range} | Owner 冻结（未冻结） |
| cold start/readiness | {ready_med} | {ready_range} | Owner 冻结（未冻结） |
| API app-overhead p50/p95（intake） | {intake_med} | {intake_range} | Owner 冻结（未冻结） |
| retained stack idle RSS | {retained_idle} | {retained_idle_range} | Owner 的 Mac 绝对预算（未冻结） |
| retained stack idle 窗口 CPU（runtime 分量） | {retained_cpu} | {retained_cpu_range} | Owner 的 Mac 绝对预算（未冻结） |
| runtime image size | {mib(image)} | n/a | Owner 冻结（未冻结） |

{four_note}

`4 turn + 8 SSE` 峰值：Java 产品上限使单 owner 只能稳定做到 4 generation + 3 SSE。多 owner 的 8 SSE 是容量画像，不是产品承诺。未跑到的 64 SSE 标 NOT_RUN，**不要**发明数字。

100 generation 后 post-idle：RSS {mib(hundred.get("runtime_rss_before"))} → {mib(hundred.get("runtime_rss_after_post_idle") or hundred.get("runtime_rss_after_idle15s"))}；fd {hundred.get("runtime_fd_before")} → {hundred.get("runtime_fd_after_post_idle") or hundred.get("runtime_fd_after_idle15s")}。

## 4. 最终快照：逐组件

| 组件 | RSS | PSS | cgroup | fd | nproc |
|---|---:|---:|---:|---:|---:|
{chr(10).join(comp_lines)}

Fake provider 与本机 Ollama（若有）不计入 retained stack，也不计入语言收益。

## 5. 如何复跑

```bash
bash scripts/measure/g1-java-baseline/run.sh
# 可选：G1_IDLE_SECONDS=600 G1_TRIALS=3 G1_KEEP=1
```

依赖：Docker（本机可能需要 `sudo -n docker`）、能拉 JDK 25 / pgvector / MinIO / Caddy / Node 镜像、仓库内 `mvnw` 在容器里打包 runtime jar。缺依赖时脚本应标 NOT_RUN，而不是编造数字。

本脚本 **不** 进入 `scripts/check.sh`（远超秒级预算）。
"""
    Path(args.markdown).write_text(md, encoding="utf-8")
    # Strip any accidental password fields before committing JSON.
    safe = json.loads(json.dumps(data))
    for owner in (((safe.get("scenarios") or {}).get("owners") or {}).get("owners") or []):
        owner.pop("password", None)
        owner.pop("accessToken", None)
        owner.pop("token", None)
    Path(args.json_out).write_text(json.dumps(safe, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

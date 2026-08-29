#!/usr/bin/env python3
"""G1 resource sampler. Never prints DB query text, tokens, or message bodies."""

from __future__ import annotations

import argparse
import json
import os
import platform
import re
import shutil
import socket
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

COMPONENTS = ("runtime", "caddy", "db", "minio", "fake-provider")
RETAINED = ("runtime", "caddy", "db", "minio")

# POSIX sh + awk/sed. No python inside the container (JRE/pg/minio/caddy
# images typically do not ship python3).
PROC_SCRIPT = r"""
clk=`getconf CLK_TCK 2>/dev/null || echo 100`
rss_kb=0
pss_kb=0
utime=0
stime=0
threads=0
nfd=0
nproc=0
pss_ok=1
for s in /proc/[0-9]*/status; do
  [ -r "$s" ] || continue
  nproc=$((nproc + 1))
  v=`sed -n 's/^VmRSS:[[:space:]]*\([0-9][0-9]*\).*/\1/p' "$s"`
  rss_kb=$((rss_kb + ${v:-0}))
  t=`sed -n 's/^Threads:[[:space:]]*\([0-9][0-9]*\).*/\1/p' "$s"`
  threads=$((threads + ${t:-0}))
  pid=`echo "$s" | sed 's|^/proc/||;s|/status$||'`
  if [ -r "/proc/$pid/stat" ]; then
    eval `awk '{
      idx = match($0, /\) /)
      rest = substr($0, idx + 2)
      n = split(rest, a, " ")
      printf "u=%s s=%s\n", a[12], a[13]
    }' "/proc/$pid/stat"`
    utime=$((utime + ${u:-0}))
    stime=$((stime + ${s:-0}))
  fi
  if [ -d "/proc/$pid/fd" ]; then
    c=`ls "/proc/$pid/fd" 2>/dev/null | wc -l`
    nfd=$((nfd + ${c:-0}))
  fi
  if [ -r "/proc/$pid/smaps_rollup" ]; then
    p=`sed -n 's/^Pss:[[:space:]]*\([0-9][0-9]*\).*/\1/p' "/proc/$pid/smaps_rollup" | head -n 1`
    pss_kb=$((pss_kb + ${p:-0}))
  else
    pss_ok=0
  fi
done
cgroup=""
if [ -r /sys/fs/cgroup/memory.current ]; then
  cgroup=`cat /sys/fs/cgroup/memory.current`
elif [ -r /sys/fs/cgroup/memory/memory.usage_in_bytes ]; then
  cgroup=`cat /sys/fs/cgroup/memory/memory.usage_in_bytes`
fi
if [ -z "$cgroup" ]; then
  cgroup=null
fi
pss_json=$pss_kb
if [ "$pss_ok" -eq 0 ] && [ "$pss_kb" -eq 0 ]; then
  pss_json=null
fi
printf '{"clk_tck":%s,"rss_bytes":%s,"pss_bytes":%s,"cpu_user_ticks":%s,"cpu_sys_ticks":%s,"threads":%s,"fd":%s,"nproc":%s,"cgroup_memory_bytes":%s}\n' \
  "$clk" "$((rss_kb * 1024))" "$(if [ "$pss_json" = null ]; then echo null; else echo $((pss_kb * 1024)); fi)" \
  "$utime" "$stime" "$threads" "$nfd" "$nproc" "$cgroup"
"""

DB_SQL = r"""
SELECT json_build_object(
  'xact', (
    SELECT COALESCE(json_agg(x), '[]'::json)
    FROM (
      SELECT pid,
             usename,
             state,
             wait_event_type,
             wait_event,
             application_name,
             EXTRACT(EPOCH FROM (now() - xact_start))::float8 AS xact_age_s,
             EXTRACT(EPOCH FROM (now() - query_start))::float8 AS query_age_s,
             EXTRACT(EPOCH FROM (now() - backend_start))::float8 AS backend_age_s
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND pid <> pg_backend_pid()
      ORDER BY xact_start NULLS LAST
    ) AS x
  ),
  'runtime_login', (
    SELECT json_build_object(
      'active', count(*) FILTER (WHERE state = 'active'),
      'idle', count(*) FILTER (WHERE state = 'idle'),
      'idle_in_transaction', count(*) FILTER (WHERE state = 'idle in transaction'),
      'total', count(*),
      'max_xact_age_s', COALESCE(max(EXTRACT(EPOCH FROM (now() - xact_start))) FILTER (WHERE xact_start IS NOT NULL), 0)
    )
    FROM pg_stat_activity
    WHERE datname = current_database()
      AND usename = 'vc_runtime_login'
  ),
  'row_counts', (
    SELECT COALESCE(json_object_agg(relname, n_live_tup), '{}'::json)
    FROM pg_stat_user_tables
    WHERE schemaname = 'vc'
  )
);
"""


def docker_cmd() -> list[str]:
    override = os.environ.get("G1_DOCKER")
    if override:
        return override.split()
    if shutil.which("docker"):
        probe = subprocess.run(
            ["docker", "info"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
        if probe.returncode == 0:
            return ["docker"]
    if shutil.which("sudo"):
        probe = subprocess.run(
            ["sudo", "-n", "docker", "info"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
        if probe.returncode == 0:
            return ["sudo", "-n", "docker"]
    raise RuntimeError("docker is not usable (tried docker and sudo -n docker; run via sg docker if needed)")


def run(cmd: list[str], *, input_text: str | None = None, timeout: int = 30) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        cmd,
        input=input_text,
        text=True,
        capture_output=True,
        timeout=timeout,
        check=False,
    )


def machine_info() -> dict[str, Any]:
    uname = platform.uname()
    mem_total = None
    mem_available = None
    try:
        with open("/proc/meminfo", "r", encoding="utf-8") as fh:
            for line in fh:
                if line.startswith("MemTotal:"):
                    mem_total = int(line.split()[1]) * 1024
                elif line.startswith("MemAvailable:"):
                    mem_available = int(line.split()[1]) * 1024
    except OSError:
        pass
    cpu_model = None
    try:
        with open("/proc/cpuinfo", "r", encoding="utf-8") as fh:
            for line in fh:
                if line.startswith("model name"):
                    cpu_model = line.split(":", 1)[1].strip()
                    break
    except OSError:
        pass
    ollama = shutil.which("ollama") is not None
    ollama_pids = []
    try:
        proc = run(["pgrep", "-a", "ollama"])
        if proc.returncode == 0:
            ollama_pids = [line for line in proc.stdout.splitlines() if line.strip()]
    except OSError:
        pass
    return {
        "hostname": socket.gethostname(),
        "os": f"{uname.system} {uname.release}",
        "machine": uname.machine,
        "cpu_model": cpu_model,
        "cpu_count": os.cpu_count(),
        "mem_total_bytes": mem_total,
        "mem_available_bytes": mem_available,
        "python": platform.python_version(),
        "is_owner_mac": False,
        "ollama_binary": ollama,
        "ollama_processes": len(ollama_pids),
        "notes": (
            "This is a Linux measurement host, not the Owner Mac. "
            "Numbers here are not frozen Owner gates."
        ),
    }


def container_id(docker: list[str], project: str, service: str) -> str | None:
    proc = run(
        docker
        + [
            "ps",
            "-q",
            "--filter",
            f"label=com.docker.compose.project={project}",
            "--filter",
            f"label=com.docker.compose.service={service}",
        ]
    )
    cid = proc.stdout.strip().splitlines()
    return cid[0] if cid else None


def sample_container(docker: list[str], cid: str) -> dict[str, Any]:
    proc = run(docker + ["exec", cid, "sh", "-lc", PROC_SCRIPT], timeout=20)
    if proc.returncode != 0:
        return {"error": (proc.stderr or proc.stdout).strip()[:400]}
    try:
        return json.loads(proc.stdout.strip().splitlines()[-1])
    except json.JSONDecodeError:
        return {"error": "proc sampler returned non-json", "raw_len": len(proc.stdout)}


def parse_prometheus(text: str) -> dict[str, Any]:
    out: dict[str, Any] = {
        "heap_used_bytes": None,
        "heap_max_bytes": None,
        "nonheap_used_bytes": None,
        "gc_pause_seconds_sum": None,
        "gc_pause_count": None,
        "threads_live": None,
        "hikari_active": None,
        "hikari_idle": None,
        "hikari_pending": None,
        "process_cpu_seconds": None,
        "process_rss_bytes": None,
        "process_open_fds": None,
    }

    def first(pattern: str) -> float | None:
        match = re.search(pattern, text, re.MULTILINE)
        if not match:
            return None
        try:
            return float(match.group(1))
        except ValueError:
            return None

    out["heap_used_bytes"] = first(
        r'^jvm_memory_used_bytes\{area="heap".*\}\s+([0-9.eE+-]+)'
    )
    # Sum heap used across generations if the first() only caught one series.
    heap_used = 0.0
    heap_max = 0.0
    nonheap_used = 0.0
    found_heap = False
    for match in re.finditer(
        r'^jvm_memory_used_bytes\{([^}]*)\}\s+([0-9.eE+-]+)', text, re.MULTILINE
    ):
        labels, value = match.group(1), float(match.group(2))
        if 'area="heap"' in labels:
            heap_used += value
            found_heap = True
        elif 'area="nonheap"' in labels:
            nonheap_used += value
    if found_heap:
        out["heap_used_bytes"] = heap_used
        out["nonheap_used_bytes"] = nonheap_used
    for match in re.finditer(
        r'^jvm_memory_max_bytes\{([^}]*)\}\s+([0-9.eE+-]+)', text, re.MULTILINE
    ):
        labels, value = match.group(1), float(match.group(2))
        if 'area="heap"' in labels and value > 0:
            heap_max += value
    if heap_max > 0:
        out["heap_max_bytes"] = heap_max
    out["gc_pause_seconds_sum"] = first(
        r'^jvm_gc_pause_seconds_sum\{.*\}\s+([0-9.eE+-]+)'
    )
    gc_sum = 0.0
    gc_count = 0.0
    gc_found = False
    for match in re.finditer(
        r'^jvm_gc_pause_seconds_(sum|count)\{.*\}\s+([0-9.eE+-]+)', text, re.MULTILINE
    ):
        gc_found = True
        if match.group(1) == "sum":
            gc_sum += float(match.group(2))
        else:
            gc_count += float(match.group(2))
    if gc_found:
        out["gc_pause_seconds_sum"] = gc_sum
        out["gc_pause_count"] = gc_count
    out["threads_live"] = first(r'^jvm_threads_live_threads\s+([0-9.eE+-]+)')
    out["hikari_active"] = first(
        r'^hikaricp_connections_active\{.*\}\s+([0-9.eE+-]+)'
    )
    out["hikari_idle"] = first(r'^hikaricp_connections_idle\{.*\}\s+([0-9.eE+-]+)')
    out["hikari_pending"] = first(
        r'^hikaricp_connections_pending\{.*\}\s+([0-9.eE+-]+)'
    )
    out["process_cpu_seconds"] = first(
        r'^process_cpu_seconds_total\s+([0-9.eE+-]+)'
    )
    out["process_rss_bytes"] = first(r'^process_resident_memory_bytes\s+([0-9.eE+-]+)')
    out["process_open_fds"] = first(r'^process_open_fds\s+([0-9.eE+-]+)')
    return out


def scrape_prometheus(url: str, timeout: float = 3.0, token: str | None = None) -> dict[str, Any]:
    try:
        req = urllib.request.Request(url)
        if token:
            req.add_header("Authorization", f"Bearer {token}")
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            text = resp.read().decode("utf-8", "replace")
        parsed = parse_prometheus(text)
        parsed["scrape_ok"] = True
        parsed["bytes"] = len(text)
        parsed["authenticated"] = bool(token)
        return parsed
    except urllib.error.HTTPError as exc:
        return {"scrape_ok": False, "error": f"HTTPError:{exc.code}"}
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        return {"scrape_ok": False, "error": type(exc).__name__}


def sample_db(docker: list[str], cid: str, password: str) -> dict[str, Any]:
    proc = run(
        docker
        + [
            "exec",
            "-i",
            "-e",
            f"PGPASSWORD={password}",
            cid,
            "psql",
            "-U",
            "vc_migrator",
            "-d",
            "vc",
            "-t",
            "-A",
            "-q",
            "--no-psqlrc",
            "-v",
            "ON_ERROR_STOP=1",
        ],
        input_text=DB_SQL,
        timeout=20,
    )
    if proc.returncode != 0:
        return {"error": "psql_failed"}
    text = proc.stdout.strip()
    start = text.find("{")
    end = text.rfind("}")
    if start < 0 or end < start:
        return {"error": "empty_psql"}
    try:
        return json.loads(text[start : end + 1])
    except json.JSONDecodeError:
        return {"error": "db_json"}


def host_ollama(docker_not_used: list[str] | None = None) -> dict[str, Any] | None:
    proc = run(["pgrep", "-d", ",", "ollama"])
    if proc.returncode != 0 or not proc.stdout.strip():
        return None
    pids = [p for p in proc.stdout.strip().split(",") if p]
    rss = pss = 0
    for pid in pids:
        try:
            with open(f"/proc/{pid}/status", "r", encoding="utf-8") as fh:
                for line in fh:
                    if line.startswith("VmRSS:"):
                        rss += int(line.split()[1]) * 1024
        except OSError:
            continue
        try:
            with open(f"/proc/{pid}/smaps_rollup", "r", encoding="utf-8") as fh:
                for line in fh:
                    if line.startswith("Pss:"):
                        pss += int(line.split()[1]) * 1024
                        break
        except OSError:
            pass
    return {
        "pids": len(pids),
        "rss_bytes": rss,
        "pss_bytes": pss,
        "note": "Host Ollama, listed separately; not attributed to Java or language rewrite.",
    }


def snapshot(
    project: str,
    prometheus_url: str,
    db_password: str,
) -> dict[str, Any]:
    docker = docker_cmd()
    components: dict[str, Any] = {}
    for service in COMPONENTS:
        cid = container_id(docker, project, service)
        if not cid:
            components[service] = {"present": False}
            continue
        sample = sample_container(docker, cid)
        sample["present"] = True
        sample["container_id"] = cid[:12]
        components[service] = sample

    retained = {"rss_bytes": 0, "pss_bytes": 0, "cgroup_memory_bytes": 0, "fd": 0, "threads": 0}
    missing = []
    for service in RETAINED:
        row = components.get(service) or {}
        if not row.get("present") or "rss_bytes" not in row:
            missing.append(service)
            continue
        retained["rss_bytes"] += int(row.get("rss_bytes") or 0)
        if row.get("pss_bytes") is None:
            retained["pss_bytes"] = None
        elif retained["pss_bytes"] is not None:
            retained["pss_bytes"] += int(row.get("pss_bytes") or 0)
        retained["cgroup_memory_bytes"] += int(row.get("cgroup_memory_bytes") or 0)
        retained["fd"] += int(row.get("fd") or 0)
        retained["threads"] += int(row.get("threads") or 0)
    retained["missing"] = missing

    db_cid = container_id(docker, project, "db")
    db = sample_db(docker, db_cid, db_password) if db_cid else {"error": "db_missing"}
    token = os.environ.get("G1_PROM_TOKEN") or None
    jvm = scrape_prometheus(prometheus_url, token=token)

    return {
        "ts_unix": time.time(),
        "ts_iso": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "measurement_basis": {
            "rss_pss": "sum of /proc/<pid>/status VmRSS and smaps_rollup Pss inside each container",
            "cgroup_memory": "/sys/fs/cgroup/memory.current (or v1 usage_in_bytes) inside container",
            "cpu_ticks": "/proc/<pid>/stat utime+stime, clk_tck from container",
            "do_not_mix": "Do not compare process RSS with cgroup memory.current in the same cell",
        },
        "components": components,
        "runtime_only": components.get("runtime"),
        "retained_stack": retained,
        "fake_provider": components.get("fake-provider"),
        "host_ollama": host_ollama(),
        "db": db,
        "jvm": jvm,
    }


def median(values: list[float]) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    mid = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[mid]
    return (ordered[mid - 1] + ordered[mid]) / 2


def summarize(values: list[float]) -> dict[str, Any]:
    if not values:
        return {"n": 0, "median": None, "min": None, "max": None, "range": None}
    return {
        "n": len(values),
        "median": median(values),
        "min": min(values),
        "max": max(values),
        "range": max(values) - min(values),
    }


def self_test() -> None:
    assert median([1, 3, 2]) == 2
    assert median([1, 2, 3, 4]) == 2.5
    text = "\n".join(
        [
            'jvm_memory_used_bytes{area="heap",id="G1 Eden Space"} 10',
            'jvm_memory_used_bytes{area="heap",id="G1 Old Gen"} 20',
            'jvm_memory_used_bytes{area="nonheap",id="Metaspace"} 5',
            "process_resident_memory_bytes 123",
        ]
    )
    parsed = parse_prometheus(text)
    assert parsed["heap_used_bytes"] == 30
    assert parsed["nonheap_used_bytes"] == 5
    assert parsed["process_rss_bytes"] == 123
    print("self-test PASS")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=["snapshot", "machine", "self-test"])
    parser.add_argument("--project", default="vc-g1")
    parser.add_argument("--prometheus-url", default="http://127.0.0.1:18081/actuator/prometheus")
    parser.add_argument("--db-password-file")
    parser.add_argument("--out")
    args = parser.parse_args()
    if args.mode == "self-test":
        self_test()
        return 0
    if args.mode == "machine":
        payload = machine_info()
    else:
        password = os.environ.get("VC_MIGRATOR_DB_PASSWORD", "")
        if args.db_password_file:
            password = Path(args.db_password_file).read_text(encoding="utf-8").strip()
        payload = snapshot(args.project, args.prometheus_url, password)
    text = json.dumps(payload, indent=2, sort_keys=True)
    if args.out:
        Path(args.out).write_text(text + "\n", encoding="utf-8")
    else:
        print(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

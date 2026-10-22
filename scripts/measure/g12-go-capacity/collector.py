#!/usr/bin/env python3
"""Same-window A/B frame collector for the G12 resident stack (VC-R58).

Boundary A is the companiond process itself: PID 1 of the runtime container,
sampled via the netns-sharing observer (process_cpu_seconds_total and friends
from /actuator/prometheus — Caddy does not proxy metrics) and via the smaps
reader (RSS/PSS/fds). Boundary B is each measured component's whole container
cgroup: cumulative CPU nanoseconds from the Docker Engine stats counter and
RSS/PSS summed over every process in the target cgroup.

Two honesty rules drive the design. First, readers and the observer run in
their own cgroups and are excluded by cgroup match, so collector cost never
lands in B — but a component whose reader could not read every cgroup process
(e.g. the UID-0 pg_isready healthcheck exec as seen by the UID-999 db reader)
is PARTIAL for that frame, never silently zeroed. Second, the Engine CPU
counter is cumulative: a decrease means a counter reset/restart, which marks
the window invalid instead of being clamped to zero. Sample continuity is
proven by an explicit container-start epoch (State.StartedAt via Engine
inspect): a same-CID restart — even one whose new counter already exceeds the
old value — changes the epoch and invalidates the window. A window with
stats gaps or samples whose epoch could not be read is PARTIAL, never
silently VALID.

Pure functions are unit-tested in test_collector.py; run.sh is the only
production caller.
"""

import argparse
import http.client
import json
import os
import signal
import socket
import subprocess
import sys
import time

COMPONENTS = ("db", "runtime", "minio", "caddy")
# R57-verified per-component reader UID:GID (default permissions suffice; no
# ptrace/cap additions). Only the matching UID can read the target processes.
READER_USERS = {"db": "999:999", "runtime": "100:101", "minio": "0:0", "caddy": "0:0"}
DEFAULT_SOCK = os.path.expanduser("~/.orbstack/run/docker.sock")
STALENESS_FACTOR = 3.0
MIN_STALE_S = 2.0


class DockerUDS:
    """Minimal read-only Docker Engine client over the local Unix socket."""

    def __init__(self, sock_path: str = DEFAULT_SOCK, timeout: float = 10.0):
        self.sock_path = sock_path
        self.timeout = timeout

    def get(self, path: str):
        conn = http.client.HTTPConnection("localhost")
        try:
            conn.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            conn.sock.settimeout(self.timeout)
            conn.sock.connect(self.sock_path)
            conn.request("GET", path, headers={"Host": "docker"})
            resp = conn.getresponse()
            body = resp.read()
            if resp.status != 200:
                raise RuntimeError(f"GET {path}: HTTP {resp.status}")
            return json.loads(body)
        finally:
            conn.close()


def docker_cli(*args, check=True, capture=True):
    cmd = ["docker", *args]
    env = dict(os.environ, DOCKER_CONTEXT=os.environ.get("DOCKER_CONTEXT", "orbstack"))
    proc = subprocess.run(cmd, capture_output=capture, text=True, env=env)
    if check and proc.returncode != 0:
        raise RuntimeError(f"{' '.join(cmd)} failed ({proc.returncode}): "
                           f"{proc.stderr.strip()}")
    return proc


def parse_reader_line(line: str):
    """Parse one reader_frames.sh line; returns None on malformed input."""
    try:
        rec = json.loads(line)
        rec["ts"] = rec["ts_ns"] / 1e9
        return rec
    except (json.JSONDecodeError, KeyError, TypeError, ValueError):
        return None


def component_mem(reader_frame):
    """Sum one reader frame at process granularity.

    Returns (status, rss_kb, pss_kb, n_pids). PARTIAL keeps the readable sum
    but flags the missing processes; the caller must not treat the frame as a
    complete B boundary. A frame with no readable process AND no missing entry
    (e.g. the reader failed to resolve the target cgroup, or the target's
    processes are gone) is NOT_AVAILABLE — an empty cgroup of a running
    container is not a real state, so it must never surface as a complete 0.
    """
    if reader_frame is None:
        return "NOT_AVAILABLE", None, None, 0
    if not reader_frame.get("target_cgroup"):
        return "NOT_AVAILABLE", None, None, 0
    pids = reader_frame.get("pids", [])
    missing = reader_frame.get("missing", [])
    if not pids and not missing:
        return "NOT_AVAILABLE", None, None, 0
    rss = sum(int(p.get("rss_kb", 0)) for p in pids)
    pss = sum(int(p.get("pss_kb", 0)) for p in pids)
    status = "PARTIAL" if missing else "OK"
    return status, rss, pss, len(pids)


def b_frame_complete(frame) -> bool:
    """A frame can only feed a complete-B same-frame sum when all four
    components are fully read (no missing processes, nothing stale)."""
    comps = frame.get("components", {})
    if set(comps) != set(COMPONENTS):
        return False
    return all(c.get("status") == "OK" for c in comps.values())


def b_same_frame_sums(frames):
    """Per-frame component sums and their peak/mean, over complete frames only.

    Each series entry records the per-component reader timestamps and the
    worst reader age inside that frame, so a "same-frame" sum never hides how
    far apart its sources actually were.
    """
    series = []
    for f in frames:
        if not b_frame_complete(f):
            continue
        ts = f["ts"]
        ages = {}
        for c in COMPONENTS:
            reader_ts = ((f.get("integrity", {}).get("readers", {})
                          .get(c) or {}).get("reader_ts"))
            if reader_ts is not None:
                ages[c] = round(ts - reader_ts, 3)
        series.append({
            "ts": ts,
            "b_rss_kb": sum(f["components"][c]["rss_kb"] for c in COMPONENTS),
            "b_pss_kb": sum(f["components"][c]["pss_kb"] for c in COMPONENTS),
            "reader_ages_s": ages,
            "max_reader_age_s": max(ages.values()) if ages else None,
        })
    peak = None
    if series:
        peak = {
            "b_rss_peak_kb": max(s["b_rss_kb"] for s in series),
            "b_pss_peak_kb": max(s["b_pss_kb"] for s in series),
            "b_rss_mean_kb": round(sum(s["b_rss_kb"] for s in series) / len(series), 1),
            "b_pss_mean_kb": round(sum(s["b_pss_kb"] for s in series) / len(series), 1),
            "complete_frames": len(series),
            "max_reader_age_s": max(s["max_reader_age_s"] or 0 for s in series),
        }
    return series, peak


def a_pid1(frame):
    comps = frame.get("components", {}).get("runtime")
    if not comps:
        return None
    for p in comps.get("pids", []):
        if p.get("pid") == 1:
            return p
    return None


def a_window(frames):
    """A-side (companiond PID 1) peaks/means/fds over the window frames."""
    rss = [a["rss_kb"] for f in frames if (a := a_pid1(f)) and a.get("rss_kb")]
    pss = [a["pss_kb"] for f in frames if (a := a_pid1(f)) and a.get("pss_kb")]
    fds = [a["fds"] for f in frames if (a := a_pid1(f)) and a.get("fds") is not None]
    return {
        "frames_with_pid1": len(rss),
        "a_rss_peak_kb": max(rss) if rss else None,
        "a_pss_peak_kb": max(pss) if pss else None,
        "a_rss_mean_kb": round(sum(rss) / len(rss), 1) if rss else None,
        "a_pss_mean_kb": round(sum(pss) / len(pss), 1) if pss else None,
        "a_fds_first_last": [fds[0], fds[-1]] if fds else None,
    }


def cpu_component_window(frames, comp):
    """Cumulative-counter delta for one component across the window frames.

    Returns an explicit status so consumers never mistake a degraded window
    for a complete one:
      VALID   — at least two counter samples, every sample carries a non-null
                epoch and all share one epoch (no same-CID restart, including
                restarts whose new counter already exceeds the old value),
                the counter never decreases between consecutive samples, and
                no window frame is missing stats.
      PARTIAL — the endpoints are otherwise continuous (≥2 samples, monotonic,
                no epoch change) but the window has stats-missing frames
                and/or at least one sample whose epoch could not be read
                (inspect failed). The cumulative counter still yields
                last-minus-first, but only as a PARTIAL value qualified by
                stats_missing_frames and epochs.
      INVALID — fewer than two samples (a single sample cannot bound an
                interval and must not surface as a delta of 0), any counter
                decrease (reset/restart), or an epoch change. cpu_delta_ns
                stays None; nothing is clamped or partially summed.

    cpu_window holds the actual capture moments (entry sampled_at, recorded
    immediately after the Engine responds; falls back to the frame ts only
    for entries written before that field existed).
    """
    samples = []
    missing = 0
    for f in frames:
        entry = (f.get("cpu", {}) or {}).get(comp)
        v = (entry or {}).get("total_usage_ns")
        if v is not None:
            sampled_at = (entry or {}).get("sampled_at")
            samples.append((f["ts"] if sampled_at is None else sampled_at,
                            v, (entry or {}).get("epoch")))
        else:
            missing += 1
    epochs = []
    for _, _, epoch in samples:
        if epoch not in epochs:
            epochs.append(epoch)
    out = {"samples": len(samples), "stats_missing_frames": missing,
           "counter_reset": False,
           "epoch_changed": len([e for e in epochs if e is not None]) > 1,
           "epochs": epochs, "cpu_delta_ns": None,
           "cpu_window": [samples[0][0], samples[-1][0]] if samples else None}
    if not samples:
        out["status"], out["reason"] = "INVALID", "no_engine_samples"
        return out
    if len(samples) < 2:
        out["status"], out["reason"] = "INVALID", "insufficient_samples"
        return out
    for (_, prev, _), (_, cur, _) in zip(samples, samples[1:]):
        if cur < prev:
            out["counter_reset"] = True
    if out["counter_reset"]:
        out["status"], out["reason"] = "INVALID", "counter_reset"
        return out
    if out["epoch_changed"]:
        out["status"], out["reason"] = "INVALID", "epoch_changed"
        return out
    if any(epoch is None for _, _, epoch in samples):
        out["status"], out["reason"] = "PARTIAL", "epoch_missing"
    elif missing:
        out["status"], out["reason"] = "PARTIAL", "stats_missing_frames"
    else:
        out["status"], out["reason"] = "VALID", None
    out["cpu_delta_ns"] = samples[-1][1] - samples[0][1]
    return out


def status_counts(frames):
    counts = {c: {"OK": 0, "PARTIAL": 0, "NOT_AVAILABLE": 0} for c in COMPONENTS}
    for f in frames:
        for c in COMPONENTS:
            counts[c][f.get("components", {}).get(c, {}).get("status", "NOT_AVAILABLE")] += 1
    return counts


def analyze_frames(frames, started: float, ended: float) -> dict:
    window = [f for f in frames if started <= f["ts"] <= ended]
    series, peak = b_same_frame_sums(window)
    out = {
        "window": [started, ended],
        "frames_total": len(frames),
        "frames_in_window": len(window),
        "complete_b_frames": len(series),
        "component_status_frames": status_counts(window),
        "a": a_window(window),
        "b": {
            "same_frame_peak": peak,
            "components": {c: cpu_component_window(window, c) for c in COMPONENTS},
            "component_peaks_kb": {
                c: {
                    "rss": max((f["components"][c]["rss_kb"] for f in window
                                if f.get("components", {}).get(c, {}).get("rss_kb") is not None),
                               default=None),
                    "pss": max((f["components"][c]["pss_kb"] for f in window
                                if f.get("components", {}).get(c, {}).get("pss_kb") is not None),
                               default=None),
                } for c in COMPONENTS},
        },
    }
    return out


class Tailer:
    """Follows a growing JSONL file, keeping only the latest parsed record."""

    def __init__(self, path: str):
        self.path = path
        self.fh = None
        self.last = None

    def poll(self):
        if self.fh is None:
            if not os.path.exists(self.path):
                return self.last
            self.fh = open(self.path)
        for line in self.fh:
            rec = parse_reader_line(line)
            if rec is not None:
                self.last = rec
        return self.last


def component_stats(api: DockerUDS, cid: str) -> dict:
    stats = api.get(f"/containers/{cid}/stats?stream=false&one-shot=true")
    # Actual capture moment of the cumulative counter, taken immediately
    # after the Engine responds — not the sampling loop's frame ts, which the
    # analysis window must never reuse as the sample time.
    sampled_at = time.time()
    cpu = stats.get("cpu_stats", {}) or {}
    usage = (cpu.get("cpu_usage") or {}).get("total_usage")
    return {
        "total_usage_ns": usage,
        "system_usage_ns": cpu.get("system_cpu_usage"),
        "online_cpus": cpu.get("online_cpus"),
        # cgroup accounting including page cache; recorded raw, never used as
        # RSS/PSS (the readers provide process-level smaps numbers).
        "memory_usage_bytes": (stats.get("memory_stats") or {}).get("usage"),
        "sampled_at": sampled_at,
    }


def create_helper_container(image, name, extra, cmd_argv, kind, persist):
    """docker run one collector helper with a receipt-first contract.

    The create receipt (the exact CID docker run returned) is persisted
    BEFORE any follow-up query, so an inspect failure can never lose the CID
    of a container this run created — cleanup still receives it. Mount
    metadata is best-effort enrichment on top of the same entry.
    """
    proc = docker_cli("run", "-d", "--rm", "--name", name, *extra,
                      image, *cmd_argv)
    cid = proc.stdout.strip()
    entry = {"name": name, "cid": cid, "kind": kind, "mounts": None}
    persist(entry)
    info = docker_cli("inspect", cid, check=False)
    if info.returncode == 0:
        try:
            entry["mounts"] = json.loads(info.stdout)[0].get("Mounts", [])
            persist(entry)
        except (json.JSONDecodeError, IndexError, KeyError):
            pass
    return cid


def cmd_launch(args):
    with open(args.manifest) as fh:
        manifest = json.load(fh)
    frames_dir = manifest["frames_dir"]
    os.makedirs(frames_dir, exist_ok=True)
    started = {"project": manifest["project"], "containers": []}

    def persist():
        # Persist the created inventory after every create so a mid-launch
        # failure still leaves the exact CIDs for cleanup — never re-derive
        # ownership by prefix/time later.
        with open(args.out, "w") as fh:
            json.dump(started, fh, indent=1)
            fh.write("\n")

    def run_detach(name, extra, cmd_argv, kind):
        def persist_entry(entry):
            # replace-by-cid: metadata enrichment re-persists the same entry
            started["containers"] = [c for c in started["containers"]
                                     if c["cid"] != entry["cid"]]
            started["containers"].append(entry)
            persist()

        return create_helper_container(args.image, name, extra, cmd_argv,
                                       kind, persist_entry)

    # Readers: one per measured component, in the target's PID namespace and
    # cgroup-matching user, own cgroup/network none/read-only.
    for comp in COMPONENTS:
        cid = manifest["containers"][comp]["cid"]
        name = f"{manifest['project']}-reader-{comp}"
        existing = docker_cli("ps", "-aq", "--filter", f"name=^/{name}$", check=False)
        if existing.stdout.strip():
            raise RuntimeError(f"container name {name} already exists; refusing")
        extra = ["--pid", f"container:{cid}", "--read-only", "--network", "none",
                 "--user", READER_USERS[comp],
                 "--entrypoint", "/bin/sh",
                 "-v", f"{frames_dir}:/frames",
                 "-v", f"{args.harness_dir}/reader_frames.sh:/reader_frames.sh:ro"]
        run_detach(name, extra, ["/reader_frames.sh", comp, str(args.interval)],
                   f"reader-{comp}")

    # Observer: shares only the runtime network namespace (metrics + fake
    # provider stats); own cgroup keeps its cost out of B.
    runtime_cid = manifest["containers"]["runtime"]["cid"]
    obs_name = f"{manifest['project']}-observer"
    existing = docker_cli("ps", "-aq", "--filter", f"name=^/{obs_name}$", check=False)
    if existing.stdout.strip():
        raise RuntimeError(f"container name {obs_name} already exists; refusing")
    extra = ["--network", f"container:{runtime_cid}", "--read-only",
             "--entrypoint", "/bin/sh",
             "-v", f"{frames_dir}:/frames",
             "-v", f"{args.harness_dir}/observer.sh:/observer.sh:ro"]
    run_detach(obs_name, extra, ["/observer.sh", str(args.interval)], "observer")

    # Fail fast unless every reader and the observer are alive AND have
    # actually produced frames — a silently dead reader must never let the
    # sampler run vacuously green on NOT_AVAILABLE components.
    expected_files = [f"{frames_dir}/{c}.jsonl" for c in COMPONENTS] + \
                     [f"{frames_dir}/observer.jsonl"]
    deadline = time.time() + 30
    while True:
        for c in started["containers"]:
            state = json.loads(docker_cli("inspect", c["cid"]).stdout)[0]["State"]
            if not state.get("Running"):
                logs = docker_cli("logs", "--tail", "20", c["cid"],
                                  check=False).stdout
                raise RuntimeError(
                    f"collector {c['kind']} exited early rc={state.get('ExitCode')}: "
                    f"{logs.strip()[-400:]}")
        if all(os.path.exists(p) and os.path.getsize(p) > 0 for p in expected_files):
            break
        if time.time() > deadline:
            missing = [p for p in expected_files
                       if not (os.path.exists(p) and os.path.getsize(p) > 0)]
            raise RuntimeError(f"collectors produced no frames within 30s; "
                               f"missing: {missing}")
        time.sleep(1)

    with open(args.out, "w") as fh:
        json.dump(started, fh, indent=1)
        fh.write("\n")
    print(json.dumps({"started": len(started["containers"]), "out": args.out}))


def cmd_sample(args):
    with open(args.manifest) as fh:
        manifest = json.load(fh)
    api = DockerUDS(args.docker_sock)
    version = api.get("/version")
    platform = {
        "host": f"{sys.platform}",
        "engine_version": version.get("Version"),
        "engine_api": version.get("ApiVersion"),
        "server_os": version.get("Os"),
        "server_arch": version.get("Arch"),
    }
    source = {
        "cpu": "docker-engine-stats/one-shot/total_usage_ns (cumulative; "
               "epoch=State.StartedAt via inspect, sampled_at=capture time)",
        "memory": "proc smaps_rollup per cgroup-matched process (readers)",
        "a_cpu": "runtime /actuator/prometheus via netns observer",
        "boundary": "reader/observer/collector live outside the measured cgroups",
    }
    frames_dir = manifest["frames_dir"]
    tails = {c: Tailer(f"{frames_dir}/{c}.jsonl") for c in COMPONENTS}
    obs_tail = Tailer(f"{frames_dir}/observer.jsonl")
    stop = {"now": False}

    def request_stop(signum, frame):
        stop["now"] = True

    signal.signal(signal.SIGTERM, request_stop)
    signal.signal(signal.SIGINT, request_stop)

    stale_after = max(STALENESS_FACTOR * args.interval, MIN_STALE_S)
    now = time.time()
    with open(args.out, "a") as out:
        while not stop["now"] and not (args.stop_file and os.path.exists(args.stop_file)):
            now = time.time()
            frame = {"ts": now, "platform": platform, "source": source,
                     "integrity": {"readers": {}, "observer": {},
                                   "engine_stats": {}},
                     "components": {}, "cpu": {}, "a": {}, "provider": None}
            for comp in COMPONENTS:
                rec = tails[comp].poll()
                ok = rec is not None and (now - rec["ts"]) <= stale_after
                frame["integrity"]["readers"][comp] = {
                    "ok": ok,
                    "reader_ts": rec["ts"] if rec else None,
                    "age_s": round(now - rec["ts"], 3) if rec else None,
                }
                if not ok:
                    rec = None
                status, rss, pss, n = component_mem(rec)
                frame["components"][comp] = {
                    "status": status, "rss_kb": rss, "pss_kb": pss, "n_pids": n,
                    "pids": (rec or {}).get("pids", []),
                    "missing": (rec or {}).get("missing", []),
                    "reader_self_pid": (rec or {}).get("self_pid"),
                }
                cid = manifest["containers"][comp]["cid"]
                try:
                    entry = component_stats(api, cid)
                    # Container-start epoch for sample continuity: stats carry
                    # no StartedAt, so a same-CID restart is only detectable
                    # via a separate inspect. A failed inspect leaves epoch
                    # None (never fabricated); such a sample can never count
                    # as VALID in the analysis.
                    try:
                        state = api.get(f"/containers/{cid}/json").get("State") or {}
                        entry["epoch"] = state.get("StartedAt")
                    except Exception as exc:
                        print(f"engine inspect error for {comp}: {exc}",
                              file=sys.stderr)
                        entry["epoch"] = None
                    frame["cpu"][comp] = entry
                    frame["integrity"]["engine_stats"][comp] = "ok"
                except Exception as exc:  # surface per component, never fabricate
                    print(f"engine stats error for {comp}: {exc}", file=sys.stderr)
                    frame["cpu"][comp] = None
                    frame["integrity"]["engine_stats"][comp] = f"error: {exc}"
            obs = obs_tail.poll()
            obs_ok = obs is not None and (now - obs["ts"]) <= stale_after
            frame["integrity"]["observer"] = {
                "ok": obs_ok, "observer_ts": obs["ts"] if obs else None}
            if obs_ok:
                frame["a"]["metrics"] = obs.get("metrics", {})
                frame["a"]["metrics_ts"] = obs["ts"]
                frame["provider"] = obs.get("provider")
            else:
                frame["a"]["metrics"] = None
            frame["a"]["pid1"] = a_pid1(frame)
            out.write(json.dumps(frame) + "\n")
            out.flush()
            time.sleep(args.interval)
    print(json.dumps({"stopped": True, "last_ts": now, "out": args.out}))


def cmd_scrape(args):
    """One-shot exact metric/provider scrape at a scenario boundary.

    Uses a transient container sharing the runtime netns (own cgroup, no
    ports): the values are boundary-exact rather than the observer's latest
    poll, matching the pre-VC-R58 curl-at-boundary semantics.
    """
    with open(args.manifest) as fh:
        manifest = json.load(fh)
    runtime_cid = manifest["containers"]["runtime"]["cid"]
    script = (
        "wget -q -O - -T 3 http://127.0.0.1:8080/actuator/prometheus;"
        " printf '\\n===G12SPLIT===\\n';"
        " wget -q -O - -T 3 http://127.0.0.1:19091/g12/stats"
    )
    proc = docker_cli("run", "--rm", "--network", f"container:{runtime_cid}",
                      "--entrypoint", "/bin/sh",
                      args.image, "-c", script, check=False)
    if proc.returncode != 0:
        print(f"scrape failed: {proc.stderr.strip()}", file=sys.stderr)
        return 1
    metrics, provider = {}, None
    parts = proc.stdout.split("===G12SPLIT===")
    wanted = set(args.metrics.split(",")) if args.metrics else None
    for line in parts[0].splitlines():
        fields = line.split()
        if len(fields) == 2 and "{" not in fields[0] and (
                wanted is None or fields[0] in wanted):
            metrics[fields[0]] = fields[1]
    if len(parts) > 1 and parts[1].strip():
        try:
            provider = json.loads(parts[1].strip())
        except json.JSONDecodeError:
            provider = None
    print(json.dumps({"metrics": metrics, "provider": provider}))
    return 0


def cmd_analyze(args):
    with open(args.frames) as fh:
        frames = [json.loads(line) for line in fh if line.strip()]
    started = args.started if args.started is not None else frames[0]["ts"]
    ended = args.ended if args.ended is not None else frames[-1]["ts"]
    print(json.dumps(analyze_frames(frames, started, ended)))
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("launch", help="start readers + observer")
    p.add_argument("--manifest", required=True)
    p.add_argument("--image", required=True, help="reader/observer image (trial minio tag)")
    p.add_argument("--harness-dir", required=True)
    p.add_argument("--interval", type=float, default=1.0)
    p.add_argument("--out", required=True)
    p.set_defaults(func=cmd_launch)

    p = sub.add_parser("sample", help="collect same-window frames until stopped")
    p.add_argument("--manifest", required=True)
    p.add_argument("--docker-sock", default=DEFAULT_SOCK)
    p.add_argument("--interval", type=float, default=0.5)
    p.add_argument("--out", required=True)
    p.add_argument("--stop-file", default="")
    p.set_defaults(func=cmd_sample)

    p = sub.add_parser("scrape", help="one-shot boundary metrics scrape")
    p.add_argument("--manifest", required=True)
    p.add_argument("--image", required=True)
    p.add_argument("--metrics", default="")
    p.set_defaults(func=cmd_scrape)

    p = sub.add_parser("analyze", help="window A/B analysis of collected frames")
    p.add_argument("--frames", required=True)
    p.add_argument("--started", type=float)
    p.add_argument("--ended", type=float)
    p.set_defaults(func=cmd_analyze)

    args = ap.parse_args()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""G12 Go capacity workload (synthetic; loopback fake provider; no real outbound).

Scenarios mirror §19.1 场景 5 (4 concurrent generation + 8 SSE) and
场景 10 (16 generation + 64 SSE capacity profile). One opaque session cookie
drives every request (the session is fabricated by run.sh against the same
DB). Consents/relationship/conversation are created once per scenario.

Per generation: a snapshot poller records intake→terminal latency; N SSE
subscribers retry-subscribe until their stream carries a terminal event
(covers subscribe-before-claim / mid-stream / after-terminal races) and
record the stream duration.
"""

import argparse
import json
import sys
import threading
import time
import urllib.error
import urllib.request

TERMINAL = {"COMPLETED", "COMPLETED_FALLBACK", "CANCELLED", "INPUT_BLOCKED",
            "OUTPUT_BLOCKED", "FAILED_FINAL", "ABANDONED_LATE"}


class Client:
    def __init__(self, base: str, session: str, csrf: str):
        self.base = base.rstrip("/")
        self.session = session
        self.csrf = csrf

    def _headers(self, content: bool = False) -> dict:
        h = {
            "Origin": "http://localhost",
            "Cookie": f"vc_session={self.session}; vc_csrf={self.csrf}",
        }
        if content:
            h["Content-Type"] = "application/json"
            h["X-CSRF-Token"] = self.csrf
        return h

    def json(self, method: str, path: str, body: dict | None = None,
             timeout: float = 30.0):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(self.base + path, data=data,
                                     method=method, headers=self._headers(data is not None))
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
            return resp.status, json.loads(raw) if raw else {}

    def send(self, conv: str, key: str, text: str):
        st, body = self.json("POST", f"/api/v1/conversations/{conv}/generations",
                             {"idempotencyKey": key, "userContent": text})
        return st, body

    def snapshot(self, gid: str):
        st, body = self.json("GET", f"/api/v1/generations/{gid}/snapshot")
        return st, body.get("status", "UNKNOWN")

    def sse(self, gid: str, timeout: float = 30.0):
        """Retry-subscribe until the stream has a terminal event.

        Returns (success, first_event_ms, terminal_ms, bytes).
        """
        deadline = time.monotonic() + timeout
        while True:
            t0 = time.monotonic()
            req = urllib.request.Request(
                self.base + f"/api/v1/realtime/streams/{gid}",
                headers={"Origin": "http://localhost",
                         "Cookie": f"vc_session={self.session}"})
            try:
                with urllib.request.urlopen(req, timeout=timeout) as resp:
                    data = resp.read()
            except Exception:
                if time.monotonic() >= deadline:
                    return False, 0.0, 0.0, 0
                time.sleep(0.1)
                continue
            text = data.decode("utf-8", "replace")
            if "event: chat.failed" in text:
                return False, 0.0, 0.0, len(text)
            if any(f"event: {t}" in text for t in ("chat.completed",
                                                   "chat.cancelled",
                                                   "chat.blocked")):
                first = text.find("event:")
                dur = (time.monotonic() - t0) * 1000
                return True, first / max(len(text), 1), dur, len(text)
            if time.monotonic() >= deadline:
                return False, 0.0, 0.0, len(text)
            time.sleep(0.1)


class Stats:
    def __init__(self):
        self.lock = threading.Lock()
        self.intake_ms: list[float] = []
        self.terminal_ms: list[float] = []
        self.stream_ms: list[float] = []
        self.errors: list[str] = []
        self.sse_ok = 0

    def add_intake(self, ms: float):
        with self.lock:
            self.intake_ms.append(ms)

    def add_terminal(self, ms: float):
        with self.lock:
            self.terminal_ms.append(ms)

    def add_sse_result(self, ok: bool, ms: float):
        with self.lock:
            self.stream_ms.append(ms)
            if ok:
                self.sse_ok += 1

    def note_error(self, msg: str):
        with self.lock:
            self.errors.append(msg)

    def pct(self, xs: list[float], p: float) -> float:
        if not xs:
            return 0.0
        ordered = sorted(xs)
        return ordered[min(len(ordered) - 1, int(len(ordered) * p))]

    def report(self) -> dict:
        with self.lock:
            def summ(xs):
                return {"n": len(xs), "p50": round(self.pct(xs, 0.5), 1),
                        "p95": round(self.pct(xs, 0.95), 1),
                        "max": round(max(xs), 1) if xs else 0.0}
            return {"intake_ms": summ(self.intake_ms),
                    "terminal_ms": summ(self.terminal_ms),
                    "stream_ms": summ(self.stream_ms),
                    "sse_ok": self.sse_ok, "sse_total": len(self.stream_ms),
                    "errors": self.errors[:10], "error_count": len(self.errors)}


def run_scenario(args, stats: Stats) -> dict:
    client = Client(args.base, args.session, args.csrf)
    st, body = client.json("PUT", "/api/v1/consents",
                           {"consentType": "SERVICE_TERMS", "version": "2026-08",
                            "granted": True})
    if st != 200:
        stats.note_error(f"consent {st}")
    for t in ("PRIVACY_POLICY", "AI_CONTENT_NOTICE", "THIRD_PARTY_MODEL_PROCESSING",
              "SENSITIVE_DATA_PROCESSING"):
        client.json("PUT", "/api/v1/consents",
                    {"consentType": t, "version": "2026-08", "granted": True})
    st, rel = client.json("POST", "/api/v1/relationships",
                          {"personaRef": "gentle-listener"})
    rel_id = rel.get("relationshipId")
    st, conv = client.json("POST", "/api/v1/conversations",
                           {"relationshipId": rel_id})
    conv_id = conv.get("conversationId")

    gens = args.gens
    sse_per_gen = args.sse_per_gen
    gids: list[str] = []
    accepted_at: dict[str, float] = {}
    key_prefix = args.key_prefix or args.scenario
    for i in range(gens):
        t0 = time.monotonic()
        st, body = client.send(conv_id, f"{key_prefix}-{i}",
                               f"capacity turn {i}")
        stats.add_intake((time.monotonic() - t0) * 1000)
        gid = body.get("generationId")
        if st != 202 or not gid:
            stats.note_error(f"send {st}: {body}")
            continue
        gid = str(gid)
        gids.append(gid)
        accepted_at[gid] = t0

    threads = []
    for gid in gids:
        threads.append(threading.Thread(
            target=poll_terminal,
            args=(args, stats, client, gid, accepted_at[gid]), daemon=True))
        for _ in range(sse_per_gen):
            threads.append(threading.Thread(
                target=subscribe_one, args=(args, stats, client, gid), daemon=True))
    for th in threads:
        th.start()
    for th in threads:
        th.join(timeout=120)
    alive = sum(1 for th in threads if th.is_alive())
    if alive:
        stats.note_error(f"{alive} workload threads did not finish")

    return {"generations": len(gids), "sse_per_generation": sse_per_gen,
            "expected_sse": len(gids) * sse_per_gen,
            "stats": stats.report()}


def poll_terminal(args, stats: Stats, client: Client, gid: str, accepted_at: float):
    status = "UNKNOWN"
    while time.monotonic() - accepted_at < 120:
        try:
            _, status = client.snapshot(gid)
        except Exception as exc:
            stats.note_error(f"snapshot {gid}: {exc}")
            time.sleep(0.2)
            continue
        if status in TERMINAL:
            break
        time.sleep(0.2)
    stats.add_terminal((time.monotonic() - accepted_at) * 1000)
    if status not in TERMINAL:
        stats.note_error(f"generation {gid} not terminal (status={status})")


def subscribe_one(args, stats: Stats, client: Client, gid: str):
    ok, _, stream_ms, _ = client.sse(gid)
    stats.add_sse_result(ok, stream_ms)
    if not ok:
        stats.note_error(f"sse {gid} no terminal")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="http://127.0.0.1:18082")
    parser.add_argument("--scenario", choices=["s5", "s10"], required=True)
    parser.add_argument("--session", required=True)
    parser.add_argument("--csrf", required=True)
    parser.add_argument("--gens", type=int, default=0)
    parser.add_argument("--sse-per-gen", type=int, default=0)
    parser.add_argument("--key-prefix", default="")
    args = parser.parse_args()

    if args.gens and args.sse_per_gen:
        pass
    elif args.scenario == "s5":
        args.gens, args.sse_per_gen = 4, 2
    else:
        args.gens, args.sse_per_gen = 16, 4

    stats = Stats()
    result = run_scenario(args, stats)
    print(json.dumps({"scenario": args.scenario, **result}, ensure_ascii=False))
    return 0 if len(stats.errors) == 0 else 2

if __name__ == "__main__":
    sys.exit(main())

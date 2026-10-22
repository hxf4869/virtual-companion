#!/usr/bin/env python3
"""G12 Go capacity workload (synthetic; loopback fake provider; no real outbound).

Scenarios mirror §19.1 场景 3 (1 generation waiting on a bounded fake-provider
hold + 3 established silent SSE subscribers — the real product binds SSE to a
generation, so "idle SSE" is only reachable as subscriptions to one in-flight
generation, never as zero-generation idle), 场景 4 (1 generation + 1 SSE,
first-delta timing), 场景 5 (4 concurrent generation + 8 SSE), 场景 10
(16 generation + 64 SSE capacity profile) and 场景 6 (two INDEPENDENT
generations: one where the subscriber deliberately disconnects right after a
live delta and re-subscribes per the snapshot-only contract, and one that is
cancelled only after a live delta proved it active). One opaque session
cookie drives every request (the session is fabricated by run.sh against the
same DB). Consents/relationship/conversation are created once per scenario.

Per generation: a snapshot poller records intake→terminal latency; N SSE
subscribers retry-subscribe until their stream carries a terminal event
(covers subscribe-before-claim / mid-stream / after-terminal races) and
record the stream duration plus, for §19.1 场景 4, the arrival time of the
first live chat.delta relative to several explicit baselines (send start,
202 receipt, subscribe attempt start). For 场景 3 the subscribers themselves
prove only the full lifecycle (3/3 terminal); the silent-window proof lives
in run.sh via observer_quiet_runs() over the collected frames: the quiet
sample unit is one deduplicated observer record (the frame sampler's Tailer
reuses the latest observer record across frames, so frame-ts growth is not
fresh evidence), every sample must keep vc_realtime_subscribers == 3,
vc_generation_active == 1, provider activeStreamRequests == 1 and the
provider contentChunkWrites counter equal to its pre-send baseline, and any
missing/stale/non-qualifying observation BREAKS the candidate window — bad
samples are never filtered out to stitch two ends together.

SSE timing basis: time.monotonic() taken when the socket chunk carrying an
event is received, so events that share one chunk share one timestamp.
Live-delta rule (from the backend hub contract, internal/realtime/hub.go):
every live subscription first receives a catch-up chat.snapshot carrying
the text accumulated so far (empty when subscribing before the first
delta), then live chat.delta events, and just before the terminal event
the committed text is replayed as one more chat.snapshot (plus chat.delta
splits when text exceeds 16 KiB). A chat.delta is therefore live unless it
arrives after the last chat.snapshot preceding the terminal — those are
replay splits. The catch-up snapshot's text length is exact coverage
evidence: empty means the subscriber joined before the first delta, so the
first chat.delta it receives is the generation's first delta. The whole
subscribe/retry loop runs against one absolute deadline: checked between
chunks, every blocking read1 re-caps the connection socket's timeout to
the remaining budget before it is issued (a timeout fixed at connect time
would let each read re-run the full budget), and a chunk received after
the deadline is dropped unparsed — a late terminal can never become a
success.
"""

import argparse
import json
import os
import ssl
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import NamedTuple

TERMINAL = {"COMPLETED", "COMPLETED_FALLBACK", "CANCELLED", "INPUT_BLOCKED",
            "OUTPUT_BLOCKED", "FAILED_FINAL", "ABANDONED_LATE"}

# SSE wire vocabulary (backend/internal/companion/types.go PublicEvent).
SSE_ACCEPTED = "chat.accepted"
SSE_DELTA = "chat.delta"
SSE_SNAPSHOT = "chat.snapshot"
SSE_FAILED = "chat.failed"
SSE_COMPLETED = "chat.completed"
SSE_CANCELLED = "chat.cancelled"
SSE_TERMINAL_EVENTS = ("chat.completed", "chat.cancelled", "chat.blocked",
                       SSE_FAILED)


class SSEResult(NamedTuple):
    """Outcome of one Client.sse() subscribe/retry call.

    Timestamps are absolute time.monotonic() values so callers can re-base
    them onto their own baselines (send start, 202 receipt). A value of None
    means "not observed"; first_delta_reason says why a delta is missing
    instead of inventing a zero.
    """

    ok: bool                      # non-failed terminal event received
    terminal: str | None          # terminal event name, e.g. "chat.completed"
    terminal_at: float | None     # when the terminal event's chunk arrived
    attempt_started_at: float     # monotonic start of the terminal (or last) attempt
    stream_ms: float              # attempt start -> terminal receipt; 0.0 if none
    first_delta_at: float | None  # earliest live chat.delta receipt across attempts
    first_delta_attempt_started_at: float | None  # attempt origin for from-subscribe math
    first_delta_reason: str | None  # None when a delta was observed
    live_deltas: int              # max live chat.delta count seen in one attempt
    saw_accepted: bool            # some attempt's first event was chat.accepted
    bytes_read: int
    attempts: int
    catchup_text_chars: int | None  # catch-up snapshot text length of the
    # attempt that observed the first live delta; 0 = joined before the
    # first delta (exact coverage), >0 = joined mid-stream (upper bound),
    # None = no delta observed or the payload was unparseable


# Why a first delta is absent (first_delta_reason values):
#   "failed": chat.failed terminal, no delta before it
#   "replay_only": terminal reached but text arrived only via snapshots
#   "terminal_without_delta": terminal without snapshot or delta (e.g. cancelled)
#   "no_terminal": streams opened but deadline hit before any terminal
#   "connect_failed": no HTTP response ever opened before the deadline


def sse_event_name(frame: bytes) -> str | None:
    """Event name of one SSE frame (block between blank-line separators).

    Follows the backend wire format (realtime/event.go Encode): an
    "event: <name>" line per frame, no id. Comment lines (":" prefix, i.e.
    heartbeats) and other fields never yield a name; the last event: line
    wins, per the SSE spec.
    """
    name = None
    for line in frame.split(b"\n"):
        if line.startswith(b":"):
            continue
        if line.startswith(b"event:"):
            value = line[len(b"event:"):].strip()
            if value:
                name = value.decode("utf-8", "replace")
    return name


def snapshot_text(frame: bytes) -> str | None:
    """Text of a chat.snapshot frame's data payload, None if unknown.

    The text itself stays in-process (S6 compares snapshot vs committed
    message content in memory); only lengths ever reach reports.
    """
    for line in frame.split(b"\n"):
        if line.startswith(b"data:"):
            try:
                payload = json.loads(line[len(b"data:"):].strip())
            except Exception:
                return None
            if isinstance(payload, dict) and isinstance(payload.get("text"), str):
                return payload["text"]
            return None
    return None


def snapshot_text_chars(frame: bytes) -> int | None:
    text = snapshot_text(frame)
    return None if text is None else len(text)


def bound_socket_timeout(resp, seconds: float) -> None:
    """Cap the response's blocking reads at the remaining deadline budget.

    http.client.HTTPResponse wraps the connection socket at
    resp.fp.raw._sock (plain and TLS alike — both go through
    sock.makefile); a socket timeout applies per read operation, so it
    must be refreshed before every read1: a value set only at connect
    time would let a mid-stream stall re-run the whole original budget
    instead of only the remaining slice.
    """
    resp.fp.raw._sock.settimeout(seconds)


def stream_events(resp, deadline: float, counter: dict | None = None):
    """Incremental SSE frame reader shared by Client.sse and the S6
    first-live-delta probe (§19.1 S6, VC-R62).

    Yields (received_at, event_name, frame) per complete frame as soon as
    the chunk carrying it arrives (nothing waits for stream EOF). The whole
    iteration runs against the caller's absolute deadline: every blocking
    read1 re-caps the connection socket's timeout to the remaining budget
    before it is issued, and a chunk received after the deadline is dropped
    unparsed. The response itself is owned — and closed — by the caller's
    `with`. When a dict is passed as counter, it receives the raw consumed
    byte count under counter["bytes"] (every chunk contributes, EOF-partial
    buffers included) and, once the iteration ENDS on its own (the caller
    did not break out), why it ended under counter["ended"]: "eof" (the
    server closed the stream), "deadline", or "error" — a caller that
    breaks early leaves "ended" unset, which is itself the evidence of a
    deliberate client-side close.
    """
    if counter is None:
        counter = {}
    counter["bytes"] = 0
    buf = b""
    while True:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            counter["ended"] = "deadline"
            return
        bound_socket_timeout(resp, remaining)
        try:
            chunk = resp.read1(65536)
        except Exception:
            counter["ended"] = "error"
            return
        if not chunk:
            counter["ended"] = "eof"
            return
        received_at = time.monotonic()
        if received_at >= deadline:
            # Late chunk: past the absolute deadline. Its events are
            # dropped unparsed — a terminal delivered after the budget can
            # never become a success.
            return
        counter["bytes"] += len(chunk)
        buf += chunk
        while True:
            frame, sep, rest = buf.partition(b"\n\n")
            if not sep:
                break
            buf = rest
            name = sse_event_name(frame)
            if name is None:
                continue
            yield received_at, name, frame


class Client:
    def __init__(self, base: str, session: str, csrf: str, account: str,
                 origin: str | None = None, cafile: str | None = None):
        self.base = base.rstrip("/")
        self.session = session
        self.csrf = csrf
        self.account = account
        if origin is None:
            # The trial configures VC_HTTP_ORIGINS=https://localhost and the
            # backend matches origins exactly (auth.AllowOrigin), so the
            # default derives scheme+hostname only: the Caddy port on the
            # client URL is transport addressing, not part of the origin.
            parts = urllib.parse.urlparse(self.base)
            origin = f"{parts.scheme}://{parts.hostname}"
        self.origin = origin
        # The private Caddy local-CA certificate is passed explicitly and only
        # here (--cacert); it never enters the OS trust store and no library
        # is put into an unverified mode.
        self.ssl_context = ssl.create_default_context(cafile=cafile) if cafile else None

    def _headers(self, content: bool = False) -> dict:
        h = {
            "Origin": self.origin,
            "Cookie": f"vc_session={self.session}; vc_csrf={self.csrf}",
            # VC-R52: authenticated writes must carry the seeded account id the
            # session belongs to; binding it here (not re-read from cookies)
            # keeps the workload's intent pinned for its whole run.
            "X-VC-Expected-Account-ID": self.account,
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
        with urllib.request.urlopen(req, timeout=timeout,
                                    context=self.ssl_context) as resp:
            raw = resp.read()
            return resp.status, json.loads(raw) if raw else {}

    def send(self, conv: str, key: str, text: str):
        st, body = self.json("POST", f"/api/v1/conversations/{conv}/generations",
                             {"idempotencyKey": key, "userContent": text})
        return st, body

    def snapshot(self, gid: str, timeout: float = 30.0):
        st, body = self.json("GET", f"/api/v1/generations/{gid}/snapshot",
                             timeout=timeout)
        return st, body.get("status", "UNKNOWN")

    def cancel(self, gid: str, timeout: float = 30.0):
        # The empty JSON body only exists so json() treats this as a
        # content write and carries Content-Type + X-CSRF-Token — the
        # backend's write path enforces CSRF (403 otherwise) and the
        # handler does not decode the body.
        st, body = self.json("POST", f"/api/v1/generations/{gid}/cancel",
                             body={}, timeout=timeout)
        return st, body

    def messages(self, conv: str):
        st, body = self.json("GET", f"/api/v1/conversations/{conv}/messages")
        return st, body if isinstance(body, list) else []

    def subscribe_until_live_delta(self, gid: str,
                                   timeout: float = 30.0) -> dict:
        """S6 precondition probe (§19.1 S6): subscribe and ACTIVELY close
        the connection right after the first chat.delta arrives on the
        wire — a real-state precondition (the generation is streaming), not
        a sleep. Re-subscribes only while no delta has been observed yet
        (bounded by the same absolute deadline); once a live delta arrives
        the connection is closed on purpose (S6-A disconnect / S6-B cancel
        precondition) and no further frames are read. Message text is
        compared/kept in-process only: the result carries booleans, counts
        and event names, never payload content.
        """
        deadline = time.monotonic() + timeout
        attempts = 0
        got_delta = False
        catchup_chars = None
        deltas_seen = 0
        reason = None
        while not got_delta:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                reason = reason or "deadline_no_delta"
                break
            attempts += 1
            req = urllib.request.Request(
                self.base + f"/api/v1/realtime/streams/{gid}",
                headers={"Origin": self.origin,
                         "Cookie": f"vc_session={self.session}"})
            try:
                with urllib.request.urlopen(
                        req, timeout=remaining,
                        context=self.ssl_context) as resp:
                    catchup_seen = False
                    for _, name, frame in stream_events(resp, deadline):
                        if name == SSE_SNAPSHOT and not catchup_seen:
                            catchup_seen = True
                            catchup_chars = snapshot_text_chars(frame)
                        elif name == SSE_DELTA:
                            # First delta on this fresh subscription: live
                            # streaming evidence — close the connection NOW
                            # (the `with` exit is the deliberate disconnect).
                            deltas_seen += 1
                            got_delta = True
                            break
                        elif name in SSE_TERMINAL_EVENTS:
                            reason = f"terminal:{name}"
                            break
            except Exception:
                pass
            if got_delta or reason:
                break
        return {"got_delta": got_delta, "catchup_chars": catchup_chars,
                "deltas_seen": deltas_seen, "attempts": attempts,
                "reason": reason}

    def subscribe_snapshot_terminal(self, gid: str,
                                    timeout: float = 30.0) -> dict:
        """S6-A terminal re-subscription: records the first chat.snapshot
        text (kept in-process for the caller's full-content comparison; only
        booleans/counts/event names ever leave this method) and the terminal
        event of the snapshot-only stream a FINISHED generation serves
        (persisted snapshot + terminal, then the connection closes). Retries
        only connect-level failures against the same absolute deadline.
        """
        deadline = time.monotonic() + timeout
        attempts = 0
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                break
            attempts += 1
            req = urllib.request.Request(
                self.base + f"/api/v1/realtime/streams/{gid}",
                headers={"Origin": self.origin,
                         "Cookie": f"vc_session={self.session}"})
            first_snapshot_text = None
            terminal = None
            try:
                with urllib.request.urlopen(
                        req, timeout=remaining,
                        context=self.ssl_context) as resp:
                    for _, name, frame in stream_events(resp, deadline):
                        if name == SSE_SNAPSHOT \
                                and first_snapshot_text is None:
                            first_snapshot_text = snapshot_text(frame)
                        elif name in SSE_TERMINAL_EVENTS:
                            terminal = name
                            break
            except Exception:
                pass
            if terminal is not None:
                break
        return {"first_snapshot_text": first_snapshot_text,
                "first_snapshot_chars": (len(first_snapshot_text)
                                         if isinstance(first_snapshot_text,
                                                       str) else None),
                "terminal": terminal,
                "ok": terminal is not None and terminal != SSE_FAILED,
                "attempts": attempts}

    def subscribe_cancel_after_first_delta(self, gid: str,
                                           on_first_delta,
                                           timeout: float = 30.0) -> dict:
        """S6-B cancel proof on the ORIGINAL stream: subscribes, and when
        the first chat.delta arrives on this still-open response, calls
        on_first_delta() synchronously (the caller issues the cancel POST
        there — bounded, no thread needed) and keeps reading the SAME
        response afterwards. The pass shape is: the cancel broadcast
        reaches this live consumer as chat.cancelled, the server then
        closes the connection (iteration ends with counter["ended"] ==
        "eof"). Retry semantics match the sse() claim-before-subscribe
        reality: BEFORE any live delta is observed (and with no terminal),
        an empty snapshot+EOF stream or a connect failure is retried
        within the same absolute deadline — subscribing before the worker
        claim genuinely produces such short-lived streams. Once the first
        live delta arrives the response is LOCKED: a later EOF, read
        error, or deadline without the cancel terminal fails the proof —
        re-subscribing another stream can never pose as
        original_stream_cancelled. The caller reports
        booleans/counts/event names only.
        """
        deadline = time.monotonic() + timeout
        attempts = 0
        got_delta = False
        deltas_seen = 0
        catchup_chars = None
        terminal = None
        stream_ended_by = None
        reason = None
        callback_called = False
        callback_error = None
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                reason = reason or ("deadline_no_delta" if not got_delta
                                    else "deadline_no_terminal")
                break
            attempts += 1
            req = urllib.request.Request(
                self.base + f"/api/v1/realtime/streams/{gid}",
                headers={"Origin": self.origin,
                         "Cookie": f"vc_session={self.session}"})
            counter = {}
            catchup_seen = False
            attempt_terminal = None
            try:
                with urllib.request.urlopen(
                        req, timeout=remaining,
                        context=self.ssl_context) as resp:
                    for _, name, frame in stream_events(resp, deadline,
                                                        counter):
                        if name == SSE_SNAPSHOT and not catchup_seen:
                            catchup_seen = True
                            catchup_chars = snapshot_text_chars(frame)
                        elif name == SSE_DELTA:
                            deltas_seen += 1
                            if not got_delta:
                                got_delta = True
                                # Fire the cancel while THIS response is
                                # alive: what follows on the same wire is
                                # the broadcast + connection close proof.
                                # A callback failure is a sub-scenario
                                # failure with its own reason — it must
                                # never be swallowed by the stream-read
                                # exception handler below.
                                callback_called = True
                                try:
                                    on_first_delta()
                                except Exception as exc:
                                    callback_error = type(exc).__name__
                                    reason = f"callback_error:{callback_error}"
                                    break
                        elif name in SSE_TERMINAL_EVENTS:
                            attempt_terminal = name
                            # Keep reading (no break): the pass shape ends
                            # with the server closing this connection,
                            # which the exhausted iterator records as "eof".
                            continue
                    if callback_error is not None:
                        break
            except Exception:
                pass
            if callback_error is not None:
                break
            ended = counter.get("ended")
            if attempt_terminal is not None:
                terminal = attempt_terminal
                stream_ended_by = ended  # "eof" is the close proof; a
                # deadline (None) or "error" after the terminal fails the
                # original_stream_cancelled assertion downstream.
                break
            if got_delta:
                # Response already LOCKED by its live delta: whatever ended
                # this attempt (eof/error/deadline), it did so without the
                # cancel terminal — a failure, never a retry.
                stream_ended_by = ended
                reason = f"{ended or 'deadline'}_after_delta_without_terminal"
                break
            # No delta and no terminal yet: the pre-claim shape (empty
            # snapshot + EOF) or a connect-level failure — retry within
            # the SAME absolute deadline.
            time.sleep(min(0.1, max(0.0, deadline - time.monotonic())))
        return {"got_delta": got_delta, "deltas_seen": deltas_seen,
                "catchup_chars": catchup_chars, "terminal": terminal,
                "stream_ended_by": stream_ended_by,
                "callback_called": callback_called,
                "callback_error": callback_error, "attempts": attempts,
                "reason": reason}

    def sse(self, gid: str, timeout: float = 30.0) -> SSEResult:
        """Retry-subscribe until a terminal event, parsing incrementally.

        Reads the response chunk-by-chunk (resp.read1, so each increment
        returns as soon as the server flushed it) and parses complete SSE
        frames as they arrive; nothing waits for stream EOF. Live deltas
        are separated from replay at terminal time: chat.delta events
        received after the last chat.snapshot preceding the terminal are
        replay splits (the committed-text burst), everything before is
        live. The whole call runs against one absolute deadline: checked
        between chunks, every blocking read1 re-caps the socket timeout to
        the remaining budget before it is issued, and a chunk received
        after the deadline is dropped unparsed — a stalled stream is
        bounded by the deadline itself (never by a stale per-connect
        timeout), and a late terminal can never become a success.
        The response is closed by its context manager on every exit path,
        including mid-read timeouts; delta observations from an attempt
        that later died are carried into the retry loop's result (the
        subscriber did receive them on the wire).
        """
        deadline = time.monotonic() + timeout
        attempts = 0
        bytes_read = 0
        opened_stream = False
        first_delta_at = None
        first_delta_attempt = None
        first_delta_catchup = None
        live_deltas = 0
        saw_accepted = False
        terminal = None
        terminal_at = None
        terminal_attempt_started = None
        terminal_attempt_snapshot = False
        last_attempt_started = time.monotonic()
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                break
            attempts += 1
            last_attempt_started = attempt_started = time.monotonic()
            req = urllib.request.Request(
                self.base + f"/api/v1/realtime/streams/{gid}",
                headers={"Origin": self.origin,
                         "Cookie": f"vc_session={self.session}"})
            attempt = {"bytes": 0, "deltas": 0, "deltas_since_snapshot": 0,
                       "snapshots": 0, "catchup_chars": None,
                       "first_delta_at": None, "first_delta_seq": None,
                       "last_snapshot_seq": None, "accepted_first": False,
                       "terminal": None, "terminal_at": None, "seq": 0}
            try:
                with urllib.request.urlopen(
                        req, timeout=remaining, context=self.ssl_context) as resp:
                    opened_stream = True
                    first_event_seen = False
                    counter = {}
                    for received_at, name, frame in stream_events(
                            resp, deadline, counter):
                        attempt["seq"] += 1
                        seq = attempt["seq"]
                        if not first_event_seen:
                            first_event_seen = True
                            attempt["accepted_first"] = name == SSE_ACCEPTED
                        if name == SSE_DELTA:
                            attempt["deltas"] += 1
                            attempt["deltas_since_snapshot"] += 1
                            if attempt["first_delta_at"] is None:
                                attempt["first_delta_at"] = received_at
                                attempt["first_delta_seq"] = seq
                        elif name == SSE_SNAPSHOT:
                            if attempt["snapshots"] == 0:
                                attempt["catchup_chars"] = \
                                    snapshot_text_chars(frame)
                            attempt["snapshots"] += 1
                            attempt["last_snapshot_seq"] = seq
                            attempt["deltas_since_snapshot"] = 0
                        elif name in SSE_TERMINAL_EVENTS:
                            attempt["terminal"] = name
                            attempt["terminal_at"] = received_at
                            break
                    attempt["bytes"] = counter["bytes"]
            except Exception:
                pass
            # Replay split separation, decided once the attempt is over.
            # The last snapshot only marks a replay boundary when the
            # terminal followed it (or a second snapshot arrived — the
            # committed replay — and the terminal was lost on the wire):
            # without either, the only snapshot seen is the catch-up and
            # every delta after it is live, so a mid-stream death keeps
            # its delta observations instead of discarding them.
            boundary = attempt["last_snapshot_seq"] \
                if (attempt["terminal"] is not None
                    or attempt["snapshots"] >= 2) else None
            if boundary is None:
                attempt_live = attempt["deltas"]
                attempt_first_live = attempt["first_delta_at"] is not None
            else:
                attempt_live = (attempt["deltas"]
                                - attempt["deltas_since_snapshot"])
                attempt_first_live = (
                    attempt["first_delta_at"] is not None
                    and attempt["first_delta_seq"] < boundary)
            bytes_read += attempt["bytes"]
            if attempt["accepted_first"]:
                saw_accepted = True
            if attempt_first_live and (
                    first_delta_at is None
                    or attempt["first_delta_at"] < first_delta_at):
                first_delta_at = attempt["first_delta_at"]
                first_delta_attempt = attempt_started
                first_delta_catchup = attempt["catchup_chars"]
            if attempt_live > live_deltas:
                live_deltas = attempt_live
            if attempt["terminal"] is not None:
                terminal = attempt["terminal"]
                terminal_at = attempt["terminal_at"]
                terminal_attempt_started = attempt_started
                terminal_attempt_snapshot = attempt["snapshots"] > 0
                break
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                break
            time.sleep(min(0.1, remaining))
        if first_delta_at is not None:
            reason = None
        elif terminal == SSE_FAILED:
            reason = "failed"
        elif terminal is not None and terminal_attempt_snapshot:
            reason = "replay_only"
        elif terminal is not None:
            reason = "terminal_without_delta"
        elif opened_stream:
            reason = "no_terminal"
        else:
            reason = "connect_failed"
        if terminal_at is not None and terminal_attempt_started is not None:
            stream_ms = (terminal_at - terminal_attempt_started) * 1000
            attempt_started_at = terminal_attempt_started
        else:
            stream_ms = 0.0
            attempt_started_at = last_attempt_started
        return SSEResult(
            ok=terminal is not None and terminal != SSE_FAILED,
            terminal=terminal, terminal_at=terminal_at,
            attempt_started_at=attempt_started_at, stream_ms=stream_ms,
            first_delta_at=first_delta_at,
            first_delta_attempt_started_at=first_delta_attempt,
            first_delta_reason=reason, live_deltas=live_deltas,
            saw_accepted=saw_accepted, bytes_read=bytes_read,
            attempts=attempts, catchup_text_chars=first_delta_catchup)


class Stats:
    def __init__(self):
        self.lock = threading.Lock()
        self.intake_ms: list[float] = []
        self.terminal_ms: list[float] = []
        self.stream_ms: list[float] = []
        self.errors: list[str] = []
        self.sse_ok = 0
        # §19.1 first-delta series; only attempts that observed a live
        # chat.delta contribute values, absent ones count by reason so a
        # missing delta is never reported as a fabricated 0.
        self.first_delta_from_subscribe_ms: list[float] = []
        self.first_delta_from_send_ms: list[float] = []
        self.first_delta_from_accept_ms: list[float] = []
        self.first_delta_live_deltas: list[int] = []
        self.first_delta_accepted_first = 0
        # Catch-up-snapshot coverage: 0 chars = subscribed before the first
        # delta (the received first delta is the generation's first delta);
        # >0 chars = joined mid-stream (the received first delta is a later
        # token, so from_send/from_accept are upper bounds).
        self.first_delta_joined_before = 0
        self.first_delta_joined_mid = 0
        self.first_delta_absent: dict[str, int] = {}

    def add_intake(self, ms: float):
        with self.lock:
            self.intake_ms.append(ms)

    def add_terminal(self, ms: float):
        with self.lock:
            self.terminal_ms.append(ms)

    def add_sse_result(self, result: SSEResult,
                       send_started_at: float | None = None,
                       accept_returned_at: float | None = None):
        """Record one subscriber outcome against explicit baselines.

        send_started_at is the monotonic time the POST was issued;
        accept_returned_at is when its 202 response returned. Deltas are
        re-based per baseline only when that baseline is known.
        """
        with self.lock:
            self.stream_ms.append(result.stream_ms)
            if result.ok:
                self.sse_ok += 1
            if result.first_delta_at is None:
                key = result.first_delta_reason or "unknown"
                self.first_delta_absent[key] = \
                    self.first_delta_absent.get(key, 0) + 1
                return
            if result.first_delta_attempt_started_at is not None:
                self.first_delta_from_subscribe_ms.append(
                    (result.first_delta_at
                     - result.first_delta_attempt_started_at) * 1000)
            if send_started_at is not None:
                self.first_delta_from_send_ms.append(
                    (result.first_delta_at - send_started_at) * 1000)
            if accept_returned_at is not None:
                self.first_delta_from_accept_ms.append(
                    (result.first_delta_at - accept_returned_at) * 1000)
            self.first_delta_live_deltas.append(result.live_deltas)
            if result.saw_accepted:
                self.first_delta_accepted_first += 1
            if result.catchup_text_chars == 0:
                self.first_delta_joined_before += 1
            elif result.catchup_text_chars is not None:
                self.first_delta_joined_mid += 1

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

            # First-delta percentiles stay None (never a fake 0) when no
            # live delta was observed; absent_reasons carries the causes.
            def sparse(xs):
                if not xs:
                    return {"n": 0, "p50": None, "p95": None, "max": None}
                return {"n": len(xs), "p50": round(self.pct(xs, 0.5), 1),
                        "p95": round(self.pct(xs, 0.95), 1),
                        "max": round(max(xs), 1)}
            return {"intake_ms": summ(self.intake_ms),
                    "terminal_ms": summ(self.terminal_ms),
                    "stream_ms": summ(self.stream_ms),
                    "sse_ok": self.sse_ok, "sse_total": len(self.stream_ms),
                    "first_delta": {
                        "observed": len(self.first_delta_from_subscribe_ms),
                        "from_subscribe_ms": sparse(self.first_delta_from_subscribe_ms),
                        "from_send_ms": sparse(self.first_delta_from_send_ms),
                        "from_accept_ms": sparse(self.first_delta_from_accept_ms),
                        "live_deltas_max": max(self.first_delta_live_deltas)
                        if self.first_delta_live_deltas else None,
                        "accepted_first": self.first_delta_accepted_first,
                        "coverage": {
                            "joined_before_first_delta": self.first_delta_joined_before,
                            "joined_mid_stream": self.first_delta_joined_mid,
                        },
                        "absent_reasons": dict(self.first_delta_absent),
                    },
                    "errors": self.errors[:10], "error_count": len(self.errors)}


def observer_quiet_runs(frames, baseline_chunks: int, *,
                        want_subscribers: int = 3,
                        want_gen_active: int = 1,
                        want_provider_active: int = 1,
                        min_samples: int = 2) -> dict:
    """Quiet-window analysis over collected frames (§19.1 场景 3).

    The sample unit is one OBSERVER RECORD, not one frame: collector.py's
    frame sampler reuses the latest observer record across frames, so
    several frames can carry the same metrics/provider snapshot — frame-ts
    growth is never fresh evidence. A STILL-VALID record repeated across
    frames is deduplicated by integrity.observer.observer_ts
    (== a.metrics_ts); an invalid/missing observation BREAKS the window even
    when it repeats the previous record's ts — the Tailer-reused record
    aging past the staleness window (ok=false, metrics/provider null) is a
    real collector state and must not be dropped by dedupe. A deduplicated
    sequence must be strictly increasing, and each sample must come from an
    ok, non-stale observation carrying both backend metrics and provider
    stats. A sample qualifies only when subscribers/generation/provider
    active match the wanted shape AND the provider contentChunkWrites
    counter still equals baseline_chunks (the value scraped before this
    generation was sent — anything above it means content already started;
    the hold only delays the FIRST token). Any missing, stale or
    non-qualifying observation BREAKS the candidate run: runs are maximal
    contiguous qualifying stretches, never re-joined across a bad sample,
    and a non-monotonic observer ts splits the run too. The chosen run is
    the first one with at least min_samples distinct samples; span_s is
    the observer-ts span of that run (never padded with repeated records).
    """
    observations: list[dict] = []
    last_valid_ts = object()  # last ts of a VALID record already recorded
    last_break_ts = object()  # last ts of an already-recorded break sample
    for f in frames:
        integrity = ((f.get("integrity") or {}).get("observer") or {})
        obs_ts = integrity.get("observer_ts")
        ok = integrity.get("ok")
        metrics = (f.get("a") or {}).get("metrics")
        provider = f.get("provider")
        if obs_ts is None or not ok or metrics is None or provider is None:
            # Invalid/missing observation: breaks the window even when it
            # repeats the previous record's ts (that same cached record can
            # have aged past the staleness window — a real collector
            # state); only the first frame of such a repeat is recorded.
            if obs_ts is not None and obs_ts == last_break_ts:
                continue
            last_break_ts = obs_ts if obs_ts is not None else object()
            observations.append({"ts": obs_ts, "ok": bool(ok),
                                 "reason": "observer_stale"})
            continue
        if obs_ts == last_valid_ts:
            # Same still-valid observer record reused by the sampler's
            # Tailer: not a fresh observation, must not lengthen any window.
            continue
        last_valid_ts = obs_ts
        last_break_ts = object()
        obs = {"ts": obs_ts, "ok": True, "reason": None}
        try:
            subs = int(float(metrics["vc_realtime_subscribers"]))
            gen = int(float(metrics["vc_generation_active"]))
            pactive = int(provider["activeStreamRequests"])
            chunks = int(provider["contentChunkWrites"])
        except (KeyError, TypeError, ValueError):
            obs["reason"] = "observation_unparseable"
        else:
            obs.update(subscribers=subs, generation_active=gen,
                       provider_active=pactive, content_chunks=chunks)
            if subs != want_subscribers:
                obs["reason"] = f"subscribers={subs}"
            elif gen != want_gen_active:
                obs["reason"] = f"generation_active={gen}"
            elif pactive != want_provider_active:
                obs["reason"] = f"provider_active={pactive}"
            elif chunks != baseline_chunks:
                obs["reason"] = ("content_started"
                                 if chunks > baseline_chunks
                                 else f"content_chunks={chunks}")
        observations.append(obs)

    runs: list[dict] = []
    cur: dict | None = None

    def close(reason):
        nonlocal cur
        if cur is not None:
            cur["break_reason"] = reason
            cur["span_s"] = round(cur["end_ts"] - cur["start_ts"], 3)
            cur["max_content_chunks"] = max(
                o["content_chunks"] for o in cur["samples"])
            cur["sample_count"] = len(cur["samples"])
            cur["sample_ts"] = [o["ts"] for o in cur["samples"]]
            cur["samples"] = cur["sample_ts"]
            runs.append(cur)
            cur = None

    for obs in observations:
        if obs["reason"] is not None:
            close(obs["reason"])
            continue
        if cur is not None and obs["ts"] <= cur["end_ts"]:
            close("non_monotonic_observer_ts")
        if cur is None:
            cur = {"start_ts": obs["ts"], "end_ts": obs["ts"],
                   "samples": [obs], "break_reason": None}
        else:
            cur["end_ts"] = obs["ts"]
            cur["samples"].append(obs)
    close(None)  # a run still open when frames ended: break_reason None

    chosen = next((r for r in runs if r["sample_count"] >= min_samples),
                  None)
    return {"baseline_content_chunks": baseline_chunks,
            "want": {"subscribers": want_subscribers,
                     "generation_active": want_gen_active,
                     "provider_active": want_provider_active},
            "min_samples": min_samples,
            "observations_total": len(observations),
            "observations": observations,
            "runs": runs,
            "chosen": chosen}


def run_scenario(args, stats: Stats) -> dict:
    client = Client(args.base, args.session, args.csrf, args.account,
                    origin=args.origin, cafile=args.cacert)
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
    accept_returned_at: dict[str, float] = {}
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
        accept_returned_at[gid] = time.monotonic()

    threads = []
    for gid in gids:
        threads.append(threading.Thread(
            target=poll_terminal,
            args=(args, stats, client, gid, accepted_at[gid]), daemon=True))
        for _ in range(sse_per_gen):
            threads.append(threading.Thread(
                target=subscribe_one,
                args=(args, stats, client, gid, accepted_at[gid],
                      accept_returned_at[gid]), daemon=True))
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


def assistant_messages(history) -> int:
    return sum(1 for m in history if isinstance(m, dict)
               and m.get("role") == "assistant")


def run_scenario_s6(args, stats: Stats) -> dict:
    """§19.1 S6 (VC-R62): disconnect/reconnect + cancel on the real public
    HTTP chain. Two INDEPENDENT generations, each gated on real state (a
    live chat.delta actually received — never a sleep or a thread-start
    inference):

    - reconnect (A): after the first live delta the SSE connection is closed
      deliberately; the disconnect must neither cancel the generation nor
      re-POST it, so the re-subscription (snapshot-only contract: catch-up
      snapshot + new deltas + terminal) still ends COMPLETED with further
      live deltas, a subscription AFTER the terminal returns the persisted
      snapshot + terminal whose full text equals the single committed
      assistant message (compared in memory; only booleans/lengths are
      reported), and run.sh proves the provider saw exactly one stream
      request for it that completed normally.
    - cancel (B): a fresh generation keeps the SSE response that carried
      its first live delta OPEN; the cancel POST fires while that response
      is alive, and the proof is the ORIGINAL stream receiving the
      chat.cancelled broadcast and being closed by the server
      (original_stream_cancelled). A non-terminal snapshot status is
      checked before the cancel, the cancel response must carry
      status=CANCELLED, the snapshot status is CANCELLED afterwards, no
      assistant message is committed, and run.sh proves the backend's
      provider stream was ABORTED mid-reply by the fixture counters (a
      natural finish is counted separately and can never pose as an
      abort).
    """
    client = Client(args.base, args.session, args.csrf, args.account,
                    origin=args.origin, cafile=args.cacert)
    st, _ = client.json("PUT", "/api/v1/consents",
                        {"consentType": "SERVICE_TERMS", "version": "2026-08",
                         "granted": True})
    if st != 200:
        stats.note_error(f"consent {st}")
    for t in ("PRIVACY_POLICY", "AI_CONTENT_NOTICE", "THIRD_PARTY_MODEL_PROCESSING",
              "SENSITIVE_DATA_PROCESSING"):
        client.json("PUT", "/api/v1/consents",
                    {"consentType": t, "version": "2026-08", "granted": True})
    key_prefix = args.key_prefix or args.scenario

    # ---- sub-scenario A: deliberate disconnect + snapshot-only reconnect
    reconnect: dict = {"precondition_live_delta": False}
    st, rel = client.json("POST", "/api/v1/relationships",
                          {"personaRef": "gentle-listener"})
    st, conv = client.json("POST", "/api/v1/conversations",
                           {"relationshipId": rel.get("relationshipId")})
    conv_a = conv.get("conversationId")
    gid_a = None
    if conv_a:
        st, body = client.send(conv_a, f"{key_prefix}-a", "s6 reconnect turn")
        gid_a = str(body.get("generationId")) if st == 202 else None
    if not gid_a:
        stats.note_error(f"s6a send {st}: no generation")
    else:
        probe = client.subscribe_until_live_delta(
            gid_a, timeout=args.sse_timeout)
        reconnect.update(
            precondition_live_delta=probe["got_delta"],
            precondition_catchup_chars=probe["catchup_chars"],
            precondition_reason=probe["reason"])
        if not probe["got_delta"]:
            stats.note_error(f"s6a no live delta before disconnect "
                             f"({probe['reason']})")
        else:
            # The deliberate disconnect already happened (the probe closed
            # its own connection right after the live delta). Re-subscribe
            # per the snapshot-only contract until the terminal event.
            r2 = client.sse(gid_a, timeout=args.sse_timeout)
            # Subscription AFTER the terminal: persisted snapshot + terminal.
            r3 = client.subscribe_snapshot_terminal(
                gid_a, timeout=args.sse_timeout)
            _, history = client.messages(conv_a)
            assistant = [m for m in history if isinstance(m, dict)
                         and m.get("role") == "assistant"]
            committed = (assistant[0].get("content")
                         if len(assistant) == 1
                         and isinstance(assistant[0].get("content"), str)
                         else None)
            # Full-content comparison in memory (never reported as text):
            # the terminal-time persisted snapshot must EQUAL the single
            # committed assistant message — same length alone proves
            # nothing.
            snapshot_matches = (
                r3["first_snapshot_text"] is not None
                and committed is not None
                and r3["first_snapshot_text"] == committed)
            reconnect.update(
                reconnect_terminal=r2.terminal,
                reconnect_ok=r2.ok,
                reconnect_live_deltas=r2.live_deltas,
                reconnect_catchup_nonempty=bool(r2.catchup_text_chars),
                post_terminal_terminal=r3["terminal"],
                post_terminal_ok=r3["ok"],
                post_terminal_snapshot_chars=r3["first_snapshot_chars"],
                post_terminal_snapshot_matches_assistant=snapshot_matches,
                assistant_messages=len(assistant))
            if r2.terminal != SSE_COMPLETED:
                stats.note_error(f"s6a reconnect terminal {r2.terminal}")
            if not r2.live_deltas:
                stats.note_error("s6a no live delta after reconnect")
            if r3["terminal"] != SSE_COMPLETED:
                stats.note_error(f"s6a post-terminal event {r3['terminal']}")
            if not snapshot_matches:
                stats.note_error(
                    "s6a post-terminal snapshot differs from the committed "
                    "assistant message")
            if len(assistant) != 1:
                stats.note_error(f"s6a assistant messages {len(assistant)}")

    # ---- sub-scenario B: cancel on the original, still-open SSE stream
    cancel: dict = {"precondition_live_delta": False}
    st, rel = client.json("POST", "/api/v1/relationships",
                          {"personaRef": "gentle-listener"})
    st, conv = client.json("POST", "/api/v1/conversations",
                           {"relationshipId": rel.get("relationshipId")})
    conv_b = conv.get("conversationId")
    gid_b = None
    if conv_b:
        st, body = client.send(conv_b, f"{key_prefix}-b", "s6 cancel turn")
        gid_b = str(body.get("generationId")) if st == 202 else None
    if not gid_b:
        stats.note_error(f"s6b send {st}: no generation")
    else:
        observed: dict = {}
        # The callback's two blocking HTTP calls share the SAME monotonic
        # deadline as the SSE subscription itself: each request is capped at
        # the remaining budget before it is issued, so neither can outlive
        # the stream's absolute budget (exhaustion fails the sub-scenario
        # instead of blocking past it).
        cancel_deadline = time.monotonic() + args.sse_timeout

        def cancel_while_streaming():
            # Runs while the original SSE response is alive, right after
            # its first live delta: real-state precondition (non-terminal
            # snapshot status) first, then the cancel POST itself.
            budget = cancel_deadline - time.monotonic()
            if budget <= 0:
                observed["budget_exhausted_before"] = True
                return
            _, status_before = client.snapshot(gid_b, timeout=budget)
            observed["status_before"] = status_before
            budget = cancel_deadline - time.monotonic()
            if budget <= 0:
                observed["budget_exhausted_before"] = True
                return
            st_c, body_c = client.cancel(gid_b, timeout=budget)
            observed["cancel_http_status"] = st_c
            observed["cancel_status_field"] = (body_c.get("status")
                                               if isinstance(body_c, dict)
                                               else None)

        stream = client.subscribe_cancel_after_first_delta(
            gid_b, cancel_while_streaming, timeout=args.sse_timeout)
        # The cancel broadcast must reach THIS original consumer and the
        # server must close the connection after the terminal event.
        original_cancelled = (stream["terminal"] == SSE_CANCELLED
                              and stream["stream_ended_by"] == "eof")
        _, status_after = client.snapshot(gid_b)
        _, history_b = client.messages(conv_b)
        cancel.update(
            precondition_live_delta=stream["got_delta"],
            precondition_reason=stream["reason"],
            callback_called=stream["callback_called"],
            callback_error=stream["callback_error"],
            callback_budget_exhausted=observed.get("budget_exhausted_before",
                                                   False),
            status_before_cancel=observed.get("status_before"),
            status_before_nonterminal=(observed.get("status_before")
                                       not in TERMINAL),
            cancel_http_status=observed.get("cancel_http_status"),
            cancel_status_field=observed.get("cancel_status_field"),
            original_stream_terminal=stream["terminal"],
            original_stream_ended_by=stream["stream_ended_by"],
            original_stream_cancelled=original_cancelled,
            status_after_cancel=status_after,
            assistant_messages=assistant_messages(history_b))
        if not stream["got_delta"]:
            stats.note_error(f"s6b no live delta on original stream "
                             f"({stream['reason']})")
        if stream["callback_error"] is not None:
            stats.note_error(f"s6b cancel callback raised "
                             f"{stream['callback_error']}")
        if observed.get("budget_exhausted_before"):
            stats.note_error("s6b callback budget exhausted before cancel")
        if observed.get("status_before") in TERMINAL:
            stats.note_error(f"s6b status before cancel "
                             f"{observed.get('status_before')}")
        if observed.get("cancel_http_status") != 200:
            stats.note_error(f"s6b cancel http "
                             f"{observed.get('cancel_http_status')}")
        if observed.get("cancel_status_field") != "CANCELLED":
            stats.note_error(f"s6b cancel status "
                             f"{observed.get('cancel_status_field')}")
        if stream["terminal"] != SSE_CANCELLED:
            stats.note_error(f"s6b original stream terminal "
                             f"{stream['terminal']} ({stream['reason']})")
        if stream["stream_ended_by"] != "eof":
            stats.note_error(f"s6b original stream ended by "
                             f"{stream['stream_ended_by']} (want server eof)")
        if status_after != "CANCELLED":
            stats.note_error(f"s6b status after cancel {status_after}")
        if assistant_messages(history_b) != 0:
            stats.note_error("s6b assistant message committed")

    return {"scenario": "s6",
            "generations": sum(1 for g in (gid_a, gid_b) if g),
            "reconnect": reconnect, "cancel": cancel,
            "errors": stats.errors[:10], "error_count": len(stats.errors)}


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


def subscribe_one(args, stats: Stats, client: Client, gid: str,
                  send_started_at: float | None = None,
                  accept_returned_at: float | None = None):
    result = client.sse(gid, timeout=args.sse_timeout)
    stats.add_sse_result(result, send_started_at=send_started_at,
                         accept_returned_at=accept_returned_at)
    if not result.ok:
        stats.note_error(f"sse {gid} no terminal")


def resolve_shape(scenario: str, gens: int, sse_per_gen: int) -> tuple[int, int]:
    """Scenario default shape; explicit --gens/--sse-per-gen win."""
    if gens and sse_per_gen:
        return gens, sse_per_gen
    defaults = {
        # §19.1 场景 3: one generation held by the fake provider (bounded
        # holdMs set by run.sh) + 3 silent subscribers; the quiet-window
        # proof itself lives in run.sh/observer_quiet_runs.
        "s3": (1, 3),
        # §19.1 场景 4: 1 generation + 1 SSE, first-delta timing.
        "s4": (1, 1),
        "s5": (4, 2),
        "s10": (16, 4),
    }
    return defaults[scenario]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="http://127.0.0.1:18082")
    parser.add_argument("--scenario", choices=["s3", "s4", "s5", "s6", "s10"],
                        required=True)
    parser.add_argument("--session", default=None,
                        help="defaults to $G12_SESSION (env keeps the opaque "
                             "session out of argv and logs)")
    parser.add_argument("--csrf", default=None,
                        help="defaults to $G12_CSRF")
    parser.add_argument("--account", default=None,
                        help="seeded account id bound to the fabricated "
                             "session; defaults to $G12_ACCOUNT")
    parser.add_argument("--origin", default=None,
                        help="Origin header; default is derived from --base")
    parser.add_argument("--cacert", default=None,
                        help="PEM CA file for the private Caddy local CA "
                             "(explicit SSLContext only, never OS trust)")
    parser.add_argument("--gens", type=int, default=0)
    parser.add_argument("--sse-per-gen", type=int, default=0)
    parser.add_argument("--sse-timeout", type=float, default=30.0,
                        help="absolute deadline (seconds) for each SSE "
                             "subscribe/retry loop; run.sh sizes it from the "
                             "scenario's provider hold so a held stream can "
                             "never outlive its budget")
    parser.add_argument("--key-prefix", default="")
    args = parser.parse_args()

    # Session/CSRF/account resolve from the environment unless given
    # explicitly; the opaque session never appears in argv or logs.
    missing = [name for name, var in (("session", "G12_SESSION"),
                                       ("csrf", "G12_CSRF"),
                                       ("account", "G12_ACCOUNT"))
               if getattr(args, name) is None and not os.environ.get(var)]
    if missing:
        parser.error(f"missing --{','.join(missing)} (or their G12_* env vars)")
    args.session = args.session or os.environ["G12_SESSION"]
    args.csrf = args.csrf or os.environ["G12_CSRF"]
    args.account = args.account or os.environ["G12_ACCOUNT"]

    stats = Stats()
    if args.scenario == "s6":
        # §19.1 S6 runs its own two independent generations (disconnect/
        # reconnect + cancel); the generic shape/percentile machinery does
        # not apply to it.
        result = run_scenario_s6(args, stats)
    else:
        args.gens, args.sse_per_gen = resolve_shape(
            args.scenario, args.gens, args.sse_per_gen)
        result = run_scenario(args, stats)
    print(json.dumps({"scenario": args.scenario, **result}, ensure_ascii=False))
    return 0 if len(stats.errors) == 0 else 2

if __name__ == "__main__":
    sys.exit(main())

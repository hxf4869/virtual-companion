#!/usr/bin/env python3
"""Unit regression for the VC-R60 G12 workload client (workload.py).

Run: python3 scripts/measure/g12-go-capacity/test_workload.py

Covers the frozen public surface only: sse_event_name / snapshot_text_chars
frame parsing, Client.sse incremental subscribe semantics (live-delta
attribution under the hub catch-up contract — every live subscription sees
a catch-up chat.snapshot first, deltas after the LAST snapshot preceding
the terminal are replay splits — chunk-boundary frame reassembly, absolute
deadline, EOF-retry / connect-failure outcomes, mid-read timeouts keeping
earlier observations, catchup_text_chars coverage evidence) and the Stats
first-delta reporting contract (percentiles stay None — never a fabricated
0 — when no live delta was observed, absent ones count by reason, coverage
counts joined-before-first-delta vs joined-mid-stream).

Determinism: urllib.request.urlopen is swapped for scripted responses and
workload.time for a fake clock, so deadline and timing assertions never
depend on machine speed. Two cases use a real loopback http.server on
127.0.0.1 (ephemeral port, dedicated thread, shut down per test) to prove
chunk-by-chunk flush behavior with loose lower bounds only. No Docker, no
external network, no real provider.
"""

import http.server
import json
import socket
import sys
import threading
import time
import unittest
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import workload  # noqa: E402

T0 = 1000.0   # fake-clock epoch shared by every scripted test
STEP = 0.05   # fake time advanced per scripted read1 chunk

HEARTBEAT = b": keepalive\n\n"
DATA_ONLY = b'data: {"ignored": true}\n\n'


def frame(name: str, data: str = "{}") -> bytes:
    return f"event: {name}\ndata: {data}\n\n".encode()


def snapshot_frame(text: str) -> bytes:
    """chat.snapshot carrying the hub catch-up payload shape."""
    payload = json.dumps({"event": "chat.snapshot", "text": text})
    return f"event: chat.snapshot\ndata: {payload}\n\n".encode()


# Backend wire order for a mid-stream live subscription (hub.go Subscribe):
# catch-up snapshot -> live deltas -> committed-text snapshot (possibly with
# replay splits) -> terminal event. The replay split after the last
# snapshot is defensive (only real when text exceeds 16 KiB).
REAL_SEQUENCE = (
    snapshot_frame(""),
    frame("chat.delta", '{"t": 1}'),
    frame("chat.delta", '{"t": 2}'),
    snapshot_frame("Hello, capacity world!"),
    frame("chat.delta", '{"t": "replay"}'),
    frame("chat.completed"),
)


class FakeClock:
    """time.monotonic / time.sleep stand-in: fully deterministic."""

    def __init__(self, start: float = T0):
        self.now = start

    def monotonic(self) -> float:
        return self.now

    def sleep(self, seconds: float):
        self.now += seconds

    def advance(self, seconds: float):
        self.now += seconds


class FakeSocket:
    """Stands in for resp.fp.raw._sock, recording settimeout calls so the
    per-read remaining-budget cap is asserted deterministically."""

    def __init__(self):
        self.timeouts = []

    def settimeout(self, seconds):
        self.timeouts.append(seconds)


class FakeResponse:
    """Scripted HTTP response: context manager + read1 chunk pump.

    chunks items are bytes payloads (returned by read1) or exceptions
    (raised from read1, e.g. socket.timeout for a mid-read stall); a
    (payload, advance) tuple delivers the payload after advancing the fake
    clock by a custom amount (uneven delivery instants). An exhausted
    script yields b"" (stream EOF). Each read1 advances the fake clock by
    `step` (or the tuple's advance), so chunk arrival instants are
    deterministic. The fp.raw._sock structure mirrors
    http.client.HTTPResponse so workload.bound_socket_timeout finds a
    socket to re-cap before every read.
    """

    def __init__(self, chunks, clock=None, step=STEP):
        self.chunks = list(chunks)
        self.clock = clock
        self.step = step
        self.i = 0
        self.entered = False
        self.closed = False
        self.sock = FakeSocket()
        self.fp = type("FakeFP", (), {})()
        self.fp.raw = type("FakeRaw", (), {})()
        self.fp.raw._sock = self.sock

    def __enter__(self):
        self.entered = True
        return self

    def __exit__(self, exc_type, exc, tb):
        self.closed = True
        return False

    def read1(self, n=-1):
        if self.i >= len(self.chunks):
            return b""
        item = self.chunks[self.i]
        self.i += 1
        advance = self.step
        if isinstance(item, tuple):
            item, advance = item
        if self.clock is not None:
            self.clock.advance(advance)
        if isinstance(item, BaseException):
            raise item
        return item


def sse_result(**overrides) -> workload.SSEResult:
    fields = dict(
        ok=True, terminal="chat.completed", terminal_at=110.0,
        attempt_started_at=100.0, stream_ms=10000.0,
        first_delta_at=102.5, first_delta_attempt_started_at=100.0,
        first_delta_reason=None, live_deltas=3, saw_accepted=True,
        bytes_read=500, attempts=1, catchup_text_chars=0)
    fields.update(overrides)
    return workload.SSEResult(**fields)


class FrameParsingTest(unittest.TestCase):
    """Case 10: unit-level frame extraction rules."""

    def test_named_frame_returns_event(self):
        self.assertEqual(workload.sse_event_name(
            b"event: chat.delta\ndata: 1"), "chat.delta")
        # the backend encoder may omit the space after the colon
        self.assertEqual(workload.sse_event_name(
            b"event:chat.completed"), "chat.completed")

    def test_comment_and_data_only_frames_return_none(self):
        self.assertIsNone(workload.sse_event_name(b": keepalive"))
        self.assertIsNone(workload.sse_event_name(b":keepalive\ndata: {}"))
        self.assertIsNone(workload.sse_event_name(DATA_ONLY))
        self.assertIsNone(workload.sse_event_name(b""))

    def test_last_event_line_wins_and_empty_values_are_skipped(self):
        self.assertEqual(workload.sse_event_name(
            b"event: chat.delta\ndata: 1\nevent: chat.completed"),
            "chat.completed")
        # an empty value must not erase the previous name
        self.assertEqual(workload.sse_event_name(
            b"event: chat.failed\nevent:"), "chat.failed")
        self.assertIsNone(workload.sse_event_name(b"event:"))

    def test_snapshot_text_chars_parses_catchup_payload(self):
        self.assertEqual(workload.snapshot_text_chars(snapshot_frame("")),
                         0)
        self.assertEqual(workload.snapshot_text_chars(snapshot_frame("Hel")),
                         3)
        # dict without a string "text" field, or a non-JSON payload, is
        # unknown — never a guessed length
        self.assertIsNone(workload.snapshot_text_chars(
            frame("chat.snapshot", '{"oops": true}')))
        self.assertIsNone(workload.snapshot_text_chars(
            frame("chat.snapshot", "not json")))
        self.assertIsNone(workload.snapshot_text_chars(frame("chat.delta")))


class SSEClientScriptedTest(unittest.TestCase):
    """Client.sse semantics against scripted responses + fake clock."""

    def setUp(self):
        self.clock = FakeClock(T0)
        self._real_time = workload.time
        workload.time = self.clock
        self.addCleanup(setattr, workload, "time", self._real_time)
        self.client = workload.Client("http://127.0.0.1:1", "sess",
                                      "csrf", "acct")

    def install_urlopen(self, script):
        """Point urllib.request.urlopen at per-attempt scripted outcomes.

        Each script entry is a FakeResponse (returned), an exception
        instance (raised by urlopen itself, i.e. connect failure), or a
        zero-arg callable producing either (fresh responses per retry).
        Returns the recorded urlopen calls (timeout + url per attempt).
        """
        calls = []
        real = urllib.request.urlopen

        def scripted_urlopen(req, timeout=None, context=None):
            calls.append({"timeout": timeout, "url": req.full_url})
            item = script[len(calls) - 1] if len(calls) <= len(script) \
                else script[-1]
            if callable(item):
                item = item()
            if isinstance(item, BaseException):
                raise item
            return item

        urllib.request.urlopen = scripted_urlopen
        self.addCleanup(setattr, urllib.request, "urlopen", real)
        return calls

    def test_first_live_delta_precedes_terminal_with_replay_snapshot(self):
        # Case 1 (hub contract shape): catch-up snapshot(text="") joins
        # before the first delta, two live deltas, then the committed-text
        # snapshot and the terminal event.
        c1 = snapshot_frame("") + frame("chat.delta", '{"t": 1}')
        c2 = frame("chat.delta", '{"t": 2}')
        c3 = snapshot_frame("Hello!") + frame("chat.completed")
        resp = FakeResponse([c1, c2, c3], clock=self.clock, step=STEP)
        calls = self.install_urlopen([resp])
        r = self.client.sse("g1", timeout=30.0)
        self.assertTrue(r.ok)
        self.assertEqual(r.terminal, "chat.completed")
        self.assertIsNone(r.first_delta_reason)
        self.assertEqual(r.live_deltas, 2)
        self.assertEqual(r.catchup_text_chars, 0)  # joined pre-first-delta
        self.assertFalse(r.saw_accepted)           # first event: snapshot
        self.assertEqual(r.attempts, 1)
        self.assertEqual(r.bytes_read, len(c1) + len(c2) + len(c3))
        self.assertAlmostEqual(r.attempt_started_at, T0, places=9)
        self.assertAlmostEqual(r.first_delta_attempt_started_at, T0,
                               places=9)
        # chunk 1 carried snapshot+delta, so both share its instant
        self.assertAlmostEqual(r.first_delta_at, T0 + STEP, places=9)
        self.assertAlmostEqual(r.terminal_at, T0 + 3 * STEP, places=9)
        self.assertLess(r.first_delta_at, r.terminal_at)
        self.assertAlmostEqual(
            (r.first_delta_at - r.first_delta_attempt_started_at) * 1000,
            50.0, places=6)
        self.assertAlmostEqual(r.stream_ms, 150.0, places=6)
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0]["timeout"], 30.0)  # full budget first try
        self.assertTrue(resp.closed)

    def test_mid_stream_join_records_catchup_text_length(self):
        # Same shape, but the catch-up snapshot already carries partial
        # text: coverage evidence must report that length (>0).
        c1 = snapshot_frame("Hel") + frame("chat.delta", '{"t": 1}')
        c2 = frame("chat.delta", '{"t": 2}')
        c3 = snapshot_frame("Hello there") + frame("chat.completed")
        self.install_urlopen(
            [FakeResponse([c1, c2, c3], clock=self.clock, step=STEP)])
        r = self.client.sse("g1b", timeout=30.0)
        self.assertTrue(r.ok)
        self.assertIsNone(r.first_delta_reason)
        self.assertEqual(r.live_deltas, 2)
        self.assertIsNotNone(r.first_delta_at)
        self.assertEqual(r.catchup_text_chars, 3)  # joined mid-stream
        self.assertAlmostEqual(r.first_delta_at, T0 + STEP, places=9)

    def test_replay_split_after_last_snapshot_is_not_live(self):
        # Replay-split case: a chat.delta sitting after the LAST snapshot
        # (the committed-text burst) is not a live token; with no other
        # delta the stream reports replay_only.
        c1 = snapshot_frame("Full text") + frame("chat.delta", '{"slice": 1}')
        c2 = frame("chat.completed")
        self.install_urlopen(
            [FakeResponse([c1, c2], clock=self.clock, step=STEP)])
        r = self.client.sse("g1c", timeout=30.0)
        self.assertTrue(r.ok)
        self.assertEqual(r.terminal, "chat.completed")
        self.assertIsNone(r.first_delta_at)
        self.assertIsNone(r.first_delta_attempt_started_at)
        self.assertIsNone(r.catchup_text_chars)
        self.assertEqual(r.first_delta_reason, "replay_only")
        self.assertEqual(r.live_deltas, 0)

    def test_synthetic_accepted_first_event_is_detected(self):
        # chat.accepted is not visible to real subscribers (hub fan-out
        # lock), but the parser keeps supporting it; saw_accepted is a
        # synthetic-stream contract.
        c1 = frame("chat.accepted") + frame("chat.delta", '{"t": 1}')
        c2 = frame("chat.completed")
        self.install_urlopen(
            [FakeResponse([c1, c2], clock=self.clock, step=STEP)])
        r = self.client.sse("g1d", timeout=30.0)
        self.assertTrue(r.ok)
        self.assertTrue(r.saw_accepted)
        self.assertIsNone(r.first_delta_reason)
        self.assertIsNotNone(r.first_delta_at)
        # no snapshot seen on the delta attempt -> catchup unknown (None)
        self.assertIsNone(r.catchup_text_chars)

    def test_unparseable_catchup_payload_keeps_delta_but_unknown_coverage(self):
        # A catch-up snapshot whose data payload has no parseable text
        # still yields live-delta attribution; only the coverage evidence
        # becomes None (never a guessed length).
        c1 = (frame("chat.snapshot", '{"oops": true}')
              + frame("chat.delta", '{"t": 1}'))
        c2 = snapshot_frame("full text") + frame("chat.completed")
        self.install_urlopen(
            [FakeResponse([c1, c2], clock=self.clock, step=STEP)])
        r = self.client.sse("g1e", timeout=30.0)
        self.assertTrue(r.ok)
        self.assertIsNone(r.first_delta_reason)
        self.assertEqual(r.live_deltas, 1)
        self.assertAlmostEqual(r.first_delta_at, T0 + STEP, places=9)
        self.assertIsNone(r.catchup_text_chars)

    def test_frame_split_across_chunks_is_reassembled(self):
        # Case 2a: one frame's bytes split over 2-3 chunks still parse;
        # the frame's timestamp is the chunk that completed it (its
        # blank-line terminator arrived), not the first fragment.
        delta = frame("chat.delta", '{"t": 1}')
        done = frame("chat.completed")
        pieces = [delta[:9], delta[9:15], delta[15:],
                  done[:17], done[17:]]
        self.install_urlopen(
            [FakeResponse(pieces, clock=self.clock, step=STEP)])
        r = self.client.sse("g2", timeout=30.0)
        self.assertTrue(r.ok)
        self.assertEqual(r.terminal, "chat.completed")
        self.assertAlmostEqual(r.first_delta_at, T0 + 3 * STEP, places=9)
        self.assertAlmostEqual(r.terminal_at, T0 + 5 * STEP, places=9)

    def test_multiple_events_in_one_chunk_share_timestamp(self):
        # Case 2b: several complete frames delivered by one chunk are all
        # parsed and share that chunk's single receipt instant.
        chunk1 = (snapshot_frame("")
                  + frame("chat.delta", '{"t": 1}')
                  + frame("chat.delta", '{"t": 2}'))
        chunk2 = snapshot_frame("all text") + frame("chat.completed")
        self.install_urlopen(
            [FakeResponse([chunk1, chunk2], clock=self.clock, step=STEP)])
        r = self.client.sse("g3", timeout=30.0)
        self.assertTrue(r.ok)
        self.assertEqual(r.terminal, "chat.completed")
        self.assertEqual(r.live_deltas, 2)
        self.assertAlmostEqual(r.first_delta_at, T0 + STEP, places=9)
        self.assertAlmostEqual(r.terminal_at, T0 + 2 * STEP, places=9)
        self.assertEqual(r.catchup_text_chars, 0)

    def test_comments_and_data_only_frames_never_count_as_events(self):
        # Case 3: heartbeats and data-only frames produce no event name,
        # claim no first-event slot, and never count as deltas.
        c1 = HEARTBEAT + DATA_ONLY
        c2 = snapshot_frame("") + frame("chat.delta", '{"t": 1}')
        c3 = DATA_ONLY + HEARTBEAT
        c4 = snapshot_frame("done") + frame("chat.completed")
        resp = FakeResponse([c1, c2, c3, c4], clock=self.clock, step=STEP)
        self.install_urlopen([resp])
        r = self.client.sse("g4", timeout=30.0)
        self.assertTrue(r.ok)
        self.assertEqual(r.terminal, "chat.completed")
        self.assertEqual(r.live_deltas, 1)
        # the first *named* event is the catch-up snapshot: comments and
        # data-only frames did not claim the slot
        self.assertFalse(r.saw_accepted)
        self.assertAlmostEqual(r.first_delta_at, T0 + 2 * STEP, places=9)
        self.assertEqual(r.bytes_read,
                         len(c1) + len(c2) + len(c3) + len(c4))

    def test_endless_comment_drip_hits_absolute_deadline_and_closes(self):
        # Case 3: a never-terminal comment drip is bounded by the absolute
        # deadline (checked between chunks) and the response gets closed.
        resp = FakeResponse([HEARTBEAT] * 200, clock=self.clock, step=STEP)
        self.install_urlopen([resp])
        r = self.client.sse("g5", timeout=1.0)
        self.assertFalse(r.ok)
        self.assertIsNone(r.terminal)
        self.assertEqual(r.first_delta_reason, "no_terminal")
        self.assertEqual(r.attempts, 1)
        self.assertIsNone(r.first_delta_at)
        self.assertEqual(r.live_deltas, 0)
        self.assertFalse(r.saw_accepted)
        self.assertGreater(r.bytes_read, 0)
        self.assertEqual(r.stream_ms, 0.0)
        self.assertIsNone(r.catchup_text_chars)
        self.assertTrue(resp.closed)
        # absolute deadline: the fake clock never ran more than one chunk
        # step past it (and could not have stopped before it)
        self.assertGreaterEqual(self.clock.now, T0 + 1.0 - 0.01)
        self.assertLessEqual(self.clock.now, T0 + 1.0 + STEP + 1e-6)

    def test_replay_only_stream_reports_replay_only(self):
        # Case 4: subscribing after terminal sees the committed snapshot
        # then the terminal event: ok, but no delta at all.
        c1 = snapshot_frame("committed text")
        c2 = frame("chat.completed")
        resp = FakeResponse([c1, c2], clock=self.clock, step=STEP)
        self.install_urlopen([resp])
        r = self.client.sse("g6", timeout=30.0)
        self.assertTrue(r.ok)
        self.assertEqual(r.terminal, "chat.completed")
        self.assertIsNone(r.first_delta_at)
        self.assertIsNone(r.first_delta_attempt_started_at)
        self.assertIsNone(r.catchup_text_chars)
        self.assertEqual(r.first_delta_reason, "replay_only")
        self.assertEqual(r.live_deltas, 0)
        self.assertFalse(r.saw_accepted)
        self.assertEqual(r.attempts, 1)
        self.assertAlmostEqual(r.stream_ms, 100.0, places=6)

    def test_chat_failed_terminal_is_not_ok(self):
        # Case 5: chat.failed is a terminal event that fails the stream.
        resp = FakeResponse([frame("chat.failed")], clock=self.clock,
                            step=STEP)
        self.install_urlopen([resp])
        r = self.client.sse("g7", timeout=30.0)
        self.assertFalse(r.ok)
        self.assertEqual(r.terminal, "chat.failed")
        self.assertIsNone(r.first_delta_at)
        self.assertIsNone(r.catchup_text_chars)
        self.assertEqual(r.first_delta_reason, "failed")
        self.assertEqual(r.live_deltas, 0)
        self.assertEqual(r.attempts, 1)

    def test_immediate_eof_retries_until_deadline_then_no_terminal(self):
        # Case 6: urlopen succeeds but the stream EOFs immediately each
        # time — retries inside the budget and reports no_terminal (the
        # stream did open; this is not a connect failure).
        made = []

        def fresh_eof():
            resp = FakeResponse([b""], clock=self.clock, step=0.0)
            made.append(resp)
            return resp

        calls = self.install_urlopen([fresh_eof])
        r = self.client.sse("g8", timeout=0.35)
        self.assertFalse(r.ok)
        self.assertIsNone(r.terminal)
        self.assertEqual(r.first_delta_reason, "no_terminal")
        self.assertGreaterEqual(r.attempts, 2)
        self.assertEqual(len(calls), r.attempts)
        self.assertEqual(len(made), r.attempts)
        self.assertTrue(all(x.closed for x in made))
        self.assertEqual(r.bytes_read, 0)
        # each retry's urlopen timeout is the remaining budget (never 0,
        # never more than the initial budget past float dust)
        self.assertTrue(all(0 < c["timeout"] <= 0.35 + 1e-9
                            for c in calls))
        self.assertLessEqual(self.clock.now, T0 + 0.35 + 1e-9)

    def test_all_connect_failures_report_connect_failed(self):
        # Case 7: urlopen never opens a response — connect_failed with at
        # least one (here: retried) attempt and a bounded return.
        err = ConnectionRefusedError("connection refused (simulated)")
        calls = self.install_urlopen([err])
        r = self.client.sse("g9", timeout=0.25)
        self.assertFalse(r.ok)
        self.assertIsNone(r.terminal)
        self.assertIsNone(r.first_delta_at)
        self.assertIsNone(r.catchup_text_chars)
        self.assertEqual(r.first_delta_reason, "connect_failed")
        self.assertGreaterEqual(r.attempts, 2)
        self.assertEqual(len(calls), r.attempts)
        self.assertEqual(r.bytes_read, 0)
        self.assertEqual(r.stream_ms, 0.0)
        self.assertLessEqual(self.clock.now, T0 + 0.25 + 1e-9)

    def test_mid_read_timeout_keeps_earlier_delta_observation(self):
        # Case 8: attempt 1 already saw catch-up snapshot + live delta +
        # the committed-text snapshot when read1 raises socket.timeout;
        # attempt 2 replays snapshot+terminal. The delta observed on the
        # wire in attempt 1 is kept, with its own attempt origin and
        # catch-up coverage for the from-subscribe math.
        resp1 = FakeResponse(
            [snapshot_frame("Hel"),
             frame("chat.delta", '{"t": 1}'),
             snapshot_frame("Hello"),
             socket.timeout("simulated read timeout")],
            clock=self.clock, step=STEP)
        resp2 = FakeResponse([snapshot_frame("Hello"),
                              frame("chat.completed")],
                             clock=self.clock, step=STEP)
        calls = self.install_urlopen([resp1, resp2])
        r = self.client.sse("g10", timeout=30.0)
        self.assertTrue(r.ok)
        self.assertEqual(r.terminal, "chat.completed")
        self.assertEqual(r.attempts, 2)
        self.assertEqual(r.live_deltas, 1)
        self.assertIsNone(r.first_delta_reason)
        # first delta came from attempt 1, before the read timed out
        self.assertAlmostEqual(r.first_delta_at, T0 + 2 * STEP, places=9)
        self.assertAlmostEqual(r.first_delta_attempt_started_at, T0,
                               places=9)
        self.assertEqual(r.catchup_text_chars, 3)
        self.assertAlmostEqual(r.attempt_started_at, T0 + 0.3, places=9)
        self.assertAlmostEqual(r.stream_ms, 100.0, places=6)
        self.assertTrue(resp1.closed)
        self.assertTrue(resp2.closed)
        # attempt budgets: full timeout first, then the remainder
        self.assertEqual(calls[0]["timeout"], 30.0)
        self.assertAlmostEqual(calls[1]["timeout"],
                               30.0 - (4 * STEP + 0.1), places=6)

    def test_read_budget_recapped_before_every_read(self):
        # The per-connect urlopen timeout is not enough: each read1 must
        # re-cap the connection socket to the remaining budget, or a
        # mid-stream stall re-runs the whole original budget. The fake
        # clock makes the remaining slices deterministic.
        resp = FakeResponse([snapshot_frame(""), HEARTBEAT,
                             frame("chat.completed")],
                            clock=self.clock, step=STEP)
        self.install_urlopen([resp])
        r = self.client.sse("g11", timeout=30.0)
        self.assertTrue(r.ok)
        # three reads, three re-caps; every cap within budget, shrinking
        # to the remaining slice as the fake clock advances
        self.assertEqual(len(resp.sock.timeouts), 3)
        self.assertTrue(all(0 < t <= 30.0 for t in resp.sock.timeouts))
        self.assertAlmostEqual(resp.sock.timeouts[0], 30.0, places=6)
        self.assertAlmostEqual(resp.sock.timeouts[1], 30.0 - STEP, places=6)
        self.assertAlmostEqual(resp.sock.timeouts[2], 30.0 - 2 * STEP,
                               places=6)

    def test_chunk_delivered_after_deadline_is_dropped(self):
        # Second deadline layer: even when a read returns a chunk whose
        # receipt instant is past the absolute deadline (slow delivery),
        # its events are dropped unparsed — a late terminal can never
        # become a success. Earlier observations keep their timestamps.
        c1 = snapshot_frame("") + frame("chat.delta", '{"t": 1}')  # +0.05
        c2 = (snapshot_frame("Hel"), 0.40)                         # +0.45
        c3 = (snapshot_frame("Hello")
              + frame("chat.completed"), 0.10)                     # +0.55
        resp = FakeResponse([c1, c2, c3], clock=self.clock, step=STEP)
        self.install_urlopen([resp])
        r = self.client.sse("g12", timeout=0.5)
        self.assertFalse(r.ok)
        self.assertIsNone(r.terminal)
        self.assertIsNone(r.terminal_at)
        # a live delta WAS observed before the deadline, so the reason
        # stays None (it explains absent deltas only); the missing
        # terminal is carried by ok=False / terminal=None
        self.assertIsNone(r.first_delta_reason)
        self.assertIsNotNone(r.first_delta_at)
        self.assertAlmostEqual(r.first_delta_at, T0 + STEP, places=9)
        self.assertEqual(r.catchup_text_chars, 0)
        self.assertEqual(r.live_deltas, 1)
        self.assertTrue(resp.closed)
        # near-deadline reads were re-capped to small remaining slices
        self.assertTrue(all(0 < t <= 0.5 for t in resp.sock.timeouts))
        self.assertLessEqual(resp.sock.timeouts[-1], 0.1)


class IncrementalHandler(http.server.BaseHTTPRequestHandler):
    """Flushes one REAL_SEQUENCE frame every `delay` seconds; after the
    terminal frame the socket stays open, so a correct client must return
    on the terminal event itself and never on EOF."""

    delay = 0.05
    linger_after_terminal = 6.0
    sequence = REAL_SEQUENCE

    def log_message(self, fmt, *args):
        pass

    def do_GET(self):
        try:
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.end_headers()
            for blob in self.sequence:
                time.sleep(self.delay)
                self.wfile.write(blob)
                self.wfile.flush()
            time.sleep(self.linger_after_terminal)
        except OSError:
            pass  # client closed at terminal/deadline; nothing to deliver


class DripHandler(http.server.BaseHTTPRequestHandler):
    """Endless heartbeat drip: never a named event, never terminal."""

    def log_message(self, fmt, *args):
        pass

    def do_GET(self):
        try:
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.end_headers()
            for _ in range(1000):  # hard stop even if no client closes
                time.sleep(0.02)
                self.wfile.write(HEARTBEAT)
                self.wfile.flush()
        except OSError:
            pass


class SSERealStreamTest(unittest.TestCase):
    """Real loopback sockets: incremental flush timing with loose bounds
    only (lower bounds from server-side sleeps, generous upper bounds),
    so machine speed cannot flip an assertion."""

    def _serve(self, handler_cls) -> str:
        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0),
                                                 handler_cls)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        return f"http://127.0.0.1:{server.server_address[1]}"

    def test_first_live_delta_timing_on_real_stream(self):
        # Frames are flushed one at a time with 0.05 s gaps following the
        # hub wire order; the replay split after the last snapshot must
        # not count as live.
        client = workload.Client(self._serve(IncrementalHandler),
                                 "sess", "csrf", "acct")
        started = time.monotonic()
        r = client.sse("g-real-1", timeout=10.0)
        elapsed = time.monotonic() - started
        self.assertTrue(r.ok)
        self.assertEqual(r.terminal, "chat.completed")
        self.assertIsNone(r.first_delta_reason)
        self.assertFalse(r.saw_accepted)  # real streams open with snapshot
        self.assertEqual(r.live_deltas, 2)
        self.assertEqual(r.catchup_text_chars, 0)
        self.assertEqual(r.attempts, 1)
        self.assertIsNotNone(r.first_delta_at)
        self.assertIsNotNone(r.terminal_at)
        self.assertLess(r.first_delta_at, r.terminal_at)
        # two server sleeps (0.05+0.05) precede the first delta flush
        gap = r.first_delta_at - r.first_delta_attempt_started_at
        self.assertGreaterEqual(gap, 0.04)
        # four more sleeps (0.2 s) between the first delta and terminal
        self.assertGreaterEqual(r.terminal_at - r.first_delta_at, 0.15)
        self.assertGreaterEqual(r.stream_ms, 150.0)
        # returned at the terminal event, not at the 6 s lingering EOF
        self.assertLess(elapsed, 4.0)

    def test_drip_deadline_bounded_on_real_stream(self):
        client = workload.Client(self._serve(DripHandler),
                                 "sess", "csrf", "acct")
        started = time.monotonic()
        r = client.sse("g-real-2", timeout=0.4)
        elapsed = time.monotonic() - started
        self.assertFalse(r.ok)
        self.assertIsNone(r.terminal)
        self.assertEqual(r.first_delta_reason, "no_terminal")
        self.assertEqual(r.attempts, 1)
        self.assertGreater(r.bytes_read, 0)
        self.assertEqual(r.stream_ms, 0.0)
        # deadline honored (~0.4 s) and the call bounded overall
        self.assertGreaterEqual(elapsed, 0.35)
        self.assertLess(elapsed, 2.0)


class BurstThenSilentHandler(http.server.BaseHTTPRequestHandler):
    """Root repro 1: one burst (catch-up snapshot + live delta) at 0.30 s,
    then total silence. A socket timeout fixed at connect time (0.4 s)
    would make the post-burst read block until ~0.70 s; the deadline must
    bound the call at ~0.4 s instead."""

    def log_message(self, fmt, *args):
        pass

    def do_GET(self):
        try:
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.end_headers()
            time.sleep(0.30)
            self.wfile.write(snapshot_frame("Hel")
                             + frame("chat.delta", '{"t": 1}'))
            self.wfile.flush()
            time.sleep(5.0)  # silence far past any budget
        except OSError:
            pass


class BurstThenLateTerminalHandler(http.server.BaseHTTPRequestHandler):
    """Root repro 2: burst at 0.30 s, final snapshot + terminal at 0.55 s —
    past the 0.4 s deadline. The late terminal must never become ok=True
    (the old code returned 0.56 s with ok=True)."""

    def log_message(self, fmt, *args):
        pass

    def do_GET(self):
        try:
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.end_headers()
            time.sleep(0.30)
            self.wfile.write(snapshot_frame("Hel")
                             + frame("chat.delta", '{"t": 1}'))
            self.wfile.flush()
            time.sleep(0.25)
            self.wfile.write(snapshot_frame("Hello")
                             + frame("chat.completed"))
            self.wfile.flush()
            time.sleep(2.0)
        except OSError:
            pass


class DeadlineRealStreamTest(unittest.TestCase):
    """Root-reproduced regressions on real loopback sockets: blocking
    reads bounded by the remaining budget, and post-deadline chunks
    dropped. Bounds: the server's sleeps pin the lower side; the upper
    side separates the fix (~0.4 s) from the old behavior (0.70 s+)."""

    def _serve(self, handler_cls) -> str:
        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0),
                                                 handler_cls)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        return f"http://127.0.0.1:{server.server_address[1]}"

    def test_silent_after_burst_bounded_by_deadline(self):
        client = workload.Client(self._serve(BurstThenSilentHandler),
                                 "sess", "csrf", "acct")
        started = time.monotonic()
        r = client.sse("g-real-3", timeout=0.4)
        elapsed = time.monotonic() - started
        self.assertFalse(r.ok)
        self.assertIsNone(r.terminal)
        self.assertEqual(r.attempts, 1)
        # the 0.30 s burst was received and attributed before the silence
        # (a live delta observed -> reason stays None; the missing
        # terminal shows up as ok=False / terminal=None)
        self.assertIsNone(r.first_delta_reason)
        self.assertIsNotNone(r.first_delta_at)
        self.assertEqual(r.catchup_text_chars, 3)
        self.assertGreater(r.bytes_read, 0)
        # bounded at the deadline, not at connect-timeout + burst (0.70 s)
        self.assertGreaterEqual(elapsed, 0.39)
        self.assertLess(elapsed, 0.62)

    def test_terminal_after_deadline_is_not_a_success(self):
        client = workload.Client(self._serve(BurstThenLateTerminalHandler),
                                 "sess", "csrf", "acct")
        started = time.monotonic()
        r = client.sse("g-real-4", timeout=0.4)
        elapsed = time.monotonic() - started
        # the 0.55 s terminal arrived past the 0.4 s deadline: dropped,
        # never a success; the earlier live delta keeps its observation
        self.assertFalse(r.ok)
        self.assertIsNone(r.terminal)
        self.assertIsNone(r.terminal_at)
        self.assertIsNone(r.first_delta_reason)
        self.assertIsNotNone(r.first_delta_at)
        self.assertLess(r.first_delta_at - r.first_delta_attempt_started_at,
                        0.4)
        self.assertEqual(r.catchup_text_chars, 3)
        self.assertEqual(r.attempts, 1)
        self.assertGreaterEqual(elapsed, 0.39)
        self.assertLess(elapsed, 0.62)


class StatsTest(unittest.TestCase):
    """Case 9: add_sse_result + report first-delta contract."""

    def test_report_with_deltas_and_absent_reasons(self):
        stats = workload.Stats()
        r1 = sse_result()                                   # catchup 0
        r2 = sse_result(terminal_at=210.0, attempt_started_at=200.0,
                        first_delta_at=205.0,
                        first_delta_attempt_started_at=200.0,
                        live_deltas=2, catchup_text_chars=3)
        r3 = sse_result(terminal_at=110.5, attempt_started_at=110.0,
                        stream_ms=500.0, first_delta_at=None,
                        first_delta_attempt_started_at=None,
                        first_delta_reason="replay_only", live_deltas=0,
                        saw_accepted=False, bytes_read=10)
        r4 = sse_result(ok=False, terminal="chat.failed",
                        terminal_at=100.3, stream_ms=300.0,
                        first_delta_at=None,
                        first_delta_attempt_started_at=None,
                        first_delta_reason="failed", live_deltas=0,
                        saw_accepted=False, bytes_read=5)
        stats.add_sse_result(r1, send_started_at=99.0,
                             accept_returned_at=101.0)
        stats.add_sse_result(r2, send_started_at=198.0,
                             accept_returned_at=201.0)
        # absent results carry baselines too, but must never pollute the
        # delta series with fabricated values
        stats.add_sse_result(r3, send_started_at=109.5,
                             accept_returned_at=110.2)
        stats.add_sse_result(r4)
        stats.note_error("probe marker")
        rep = stats.report()
        for key in ("intake_ms", "terminal_ms", "stream_ms", "sse_ok",
                    "sse_total", "first_delta", "errors", "error_count"):
            self.assertIn(key, rep)
        self.assertEqual(rep["sse_ok"], 3)      # r1, r2, r3 ok; r4 failed
        self.assertEqual(rep["sse_total"], 4)
        self.assertEqual(rep["stream_ms"],
                         {"n": 4, "p50": 10000.0, "p95": 10000.0,
                          "max": 10000.0})
        fd = rep["first_delta"]
        self.assertEqual(fd["observed"], 2)
        self.assertEqual(fd["from_subscribe_ms"],
                         {"n": 2, "p50": 5000.0, "p95": 5000.0,
                          "max": 5000.0})
        self.assertEqual(fd["from_send_ms"],
                         {"n": 2, "p50": 7000.0, "p95": 7000.0,
                          "max": 7000.0})
        self.assertEqual(fd["from_accept_ms"],
                         {"n": 2, "p50": 4000.0, "p95": 4000.0,
                          "max": 4000.0})
        self.assertEqual(fd["live_deltas_max"], 3)
        self.assertEqual(fd["accepted_first"], 2)
        # coverage counted only for observed deltas: r1 joined before the
        # first delta (catchup 0), r2 joined mid-stream (catchup 3)
        self.assertEqual(fd["coverage"],
                         {"joined_before_first_delta": 1,
                          "joined_mid_stream": 1})
        self.assertEqual(fd["absent_reasons"],
                         {"replay_only": 1, "failed": 1})
        self.assertEqual(rep["error_count"], 1)
        self.assertEqual(rep["errors"], ["probe marker"])

    def test_report_without_any_delta_and_partial_baselines(self):
        stats = workload.Stats()
        absent = sse_result(ok=False, terminal=None, terminal_at=None,
                            attempt_started_at=100.0, stream_ms=0.0,
                            first_delta_at=None,
                            first_delta_attempt_started_at=None,
                            first_delta_reason="no_terminal",
                            live_deltas=0, saw_accepted=False,
                            bytes_read=64, attempts=4)
        stats.add_sse_result(absent, send_started_at=99.0,
                             accept_returned_at=99.5)
        rep = stats.report()
        self.assertEqual(rep["sse_ok"], 0)
        self.assertEqual(rep["sse_total"], 1)
        self.assertEqual(rep["first_delta"]["observed"], 0)
        none_summ = {"n": 0, "p50": None, "p95": None, "max": None}
        self.assertEqual(rep["first_delta"]["from_subscribe_ms"],
                         none_summ)
        self.assertEqual(rep["first_delta"]["from_send_ms"], none_summ)
        self.assertEqual(rep["first_delta"]["from_accept_ms"], none_summ)
        self.assertIsNone(rep["first_delta"]["live_deltas_max"])
        self.assertEqual(rep["first_delta"]["accepted_first"], 0)
        self.assertEqual(rep["first_delta"]["coverage"],
                         {"joined_before_first_delta": 0,
                          "joined_mid_stream": 0})
        self.assertEqual(rep["first_delta"]["absent_reasons"],
                         {"no_terminal": 1})
        self.assertEqual(rep["error_count"], 0)
        # a delta result without send/accept baselines widens only the
        # subscribe-based series; the others stay explicitly None (and an
        # unknown catchup coverage counts in neither bucket)
        stats.add_sse_result(sse_result(catchup_text_chars=None,
                                        saw_accepted=False))
        rep = stats.report()
        fd = rep["first_delta"]
        self.assertEqual(fd["observed"], 1)
        self.assertEqual(fd["from_subscribe_ms"],
                         {"n": 1, "p50": 2500.0, "p95": 2500.0,
                          "max": 2500.0})
        self.assertEqual(fd["from_send_ms"], none_summ)
        self.assertEqual(fd["from_accept_ms"], none_summ)
        self.assertEqual(fd["live_deltas_max"], 3)
        self.assertEqual(fd["accepted_first"], 0)
        # unknown catchup coverage (unparseable payload) counts nowhere
        self.assertEqual(fd["coverage"],
                         {"joined_before_first_delta": 0,
                          "joined_mid_stream": 0})
        self.assertEqual(fd["absent_reasons"], {"no_terminal": 1})
        # explicit buckets: catchup 0 joins before the first delta,
        # catchup >0 joins mid-stream
        stats.add_sse_result(sse_result(catchup_text_chars=0,
                                        saw_accepted=False))
        stats.add_sse_result(sse_result(catchup_text_chars=5,
                                        saw_accepted=False))
        fd = stats.report()["first_delta"]
        self.assertEqual(fd["observed"], 3)
        self.assertEqual(fd["coverage"],
                         {"joined_before_first_delta": 1,
                          "joined_mid_stream": 1})


if __name__ == "__main__":
    unittest.main(verbosity=2)

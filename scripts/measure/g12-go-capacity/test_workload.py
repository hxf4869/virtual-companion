#!/usr/bin/env python3
"""Unit regression for the VC-R60 G12 workload client (workload.py).

Run: python3 scripts/measure/g12-go-capacity/test_workload.py

Covers the frozen public surface only: sse_event_name / snapshot_text_chars
frame parsing, Client.sse incremental subscribe semantics (live-delta
attribution under the hub catch-up contract — every live subscription sees
a catch-up chat.snapshot first, deltas after the LAST snapshot preceding
the terminal are replay splits — chunk-boundary frame reassembly, absolute
deadline, EOF-retry / connect-failure outcomes, mid-read timeouts keeping
earlier observations, catchup_text_chars coverage evidence), the Stats
first-delta reporting contract (percentiles stay None — never a fabricated
0 — when no live delta was observed, absent ones count by reason, coverage
counts joined-before-first-delta vs joined-mid-stream), and the §19.1 S9
(VC-R128) real-login scenario: the hand-written RFC 6238 TOTP, Set-Cookie
capture/clearing semantics, the S9Client wire contract (per-client cookie
isolation, CSRF/Origin/expected-account write headers), and the full
run_scenario_s9 orchestration against a stateful fake auth backend
(owner isolation, barrier concurrency with a deterministic rendezvous,
revoke-all causal effects, trusted-cookie fallback, budget exhaustion and
transport failures as explicit errors, no credentials in serialized
output), and the §19.1 S8 (VC-R140) two-phase probe client: prepare fails
explicitly without a real live delta, and verify accepts only the
recovered FAILED_FINAL with the public external-failed fault, fails
closed without a health-control write on any dirty original verdict,
never re-POSTs the original generation, and never lets the health
control mask the original terminal.

Determinism: urllib.request.urlopen is swapped for scripted responses and
workload.time for a fake clock, so deadline and timing assertions never
depend on machine speed. Two cases use a real loopback http.server on
127.0.0.1 (ephemeral port, dedicated thread, shut down per test) to prove
chunk-by-chunk flush behavior with loose lower bounds only. The S9
orchestration runs real threads on the real monotonic clock with the two
concurrent-phase requests rendezvousing inside the fake backend, so the
overlap proof is deterministic. No Docker, no external network, no real
provider.
"""

import contextlib
import http.server
import io
import json
import os
import socket
import sys
import threading
import time
import unittest
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from unittest import mock

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


class S6ProbeScriptedTest(unittest.TestCase):
    """§19.1 S6 (VC-R62) probe semantics against scripted responses +
    fake clock: subscribe_until_live_delta (deliberate disconnect right
    after the first live delta), subscribe_snapshot_terminal (persisted
    snapshot + terminal, full text kept in-process) and
    subscribe_cancel_after_first_delta (cancel fires while the ORIGINAL
    response is alive, then the same stream carries chat.cancelled and
    ends with the server's eof)."""

    def setUp(self):
        self.clock = FakeClock(T0)
        self._real_time = workload.time
        workload.time = self.clock
        self.addCleanup(setattr, workload, "time", self._real_time)
        self.client = workload.Client("http://127.0.0.1:1", "sess",
                                      "csrf", "acct")

    def install_urlopen(self, script):
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

    def test_first_live_delta_closes_connection_immediately(self):
        # The probe must stop reading right after the delta chunk and close
        # the connection — the terminal chunk is never consumed (the
        # deliberate S6-A disconnect).
        resp = FakeResponse(
            [snapshot_frame(""),                       # chunk 1
             frame("chat.delta", '{"t": 1}'),           # chunk 2 -> close
             frame("chat.delta", '{"t": 2}'),
             frame("chat.completed")],
            clock=self.clock, step=STEP)
        self.install_urlopen([resp])
        r = self.client.subscribe_until_live_delta("g20", timeout=30.0)
        self.assertTrue(r["got_delta"])
        self.assertEqual(r["deltas_seen"], 1)
        self.assertEqual(r["catchup_chars"], 0)
        self.assertIsNone(r["reason"])
        self.assertEqual(r["attempts"], 1)
        self.assertTrue(resp.closed)
        self.assertEqual(resp.i, 2)   # never read past the delta chunk

    def test_no_delta_until_deadline_reports_reason(self):
        # Heartbeat-only streams keep retrying (fresh response per attempt)
        # until the absolute deadline; the absence is explained, not zero.
        self.install_urlopen(
            [lambda: FakeResponse([HEARTBEAT, HEARTBEAT, HEARTBEAT],
                                  clock=self.clock, step=STEP)])
        r = self.client.subscribe_until_live_delta("g21", timeout=0.4)
        self.assertFalse(r["got_delta"])
        self.assertEqual(r["reason"], "deadline_no_delta")
        self.assertGreaterEqual(r["attempts"], 2)

    def test_terminal_before_delta_reports_terminal_reason(self):
        # A stream that ends (terminal event) before any delta does not
        # retry past that fact: the terminal is the reason.
        self.install_urlopen(
            [FakeResponse([frame("chat.cancelled")],
                          clock=self.clock, step=STEP)])
        r = self.client.subscribe_until_live_delta("g22", timeout=30.0)
        self.assertFalse(r["got_delta"])
        self.assertEqual(r["reason"], "terminal:chat.cancelled")
        self.assertEqual(r["attempts"], 1)

    def test_snapshot_terminal_carries_full_text_in_process(self):
        resp = FakeResponse([snapshot_frame("Hello, capacity world!"),
                             frame("chat.completed")],
                            clock=self.clock, step=STEP)
        self.install_urlopen([resp])
        r = self.client.subscribe_snapshot_terminal("g23", timeout=30.0)
        self.assertEqual(r["first_snapshot_text"], "Hello, capacity world!")
        self.assertEqual(r["first_snapshot_chars"],
                         len("Hello, capacity world!"))
        self.assertEqual(r["terminal"], "chat.completed")
        self.assertTrue(r["ok"])
        self.assertEqual(r["attempts"], 1)
        self.assertTrue(resp.closed)

    def test_snapshot_terminal_retries_connect_failures(self):
        self.install_urlopen(
            [OSError("connect refused"),
             FakeResponse([snapshot_frame("done"), frame("chat.completed")],
                          clock=self.clock, step=STEP)])
        r = self.client.subscribe_snapshot_terminal("g24", timeout=30.0)
        self.assertEqual(r["terminal"], "chat.completed")
        self.assertEqual(r["attempts"], 2)

    def test_cancel_fires_while_original_stream_open(self):
        # The cancel callback must run while the SAME response that carried
        # the first delta is still open, and the ORIGINAL stream must then
        # deliver chat.cancelled and end with the server's eof (the
        # generator exhausts at the scripted EOF).
        resp = FakeResponse(
            [snapshot_frame(""),
             frame("chat.delta", '{"t": 1}'),
             snapshot_frame(""),
             frame("chat.cancelled")],
            clock=self.clock, step=STEP)
        self.install_urlopen([resp])
        seen = {}

        def cancel_now():
            seen["entered"] = resp.entered
            seen["closed"] = resp.closed

        r = self.client.subscribe_cancel_after_first_delta(
            "g25", cancel_now, timeout=30.0)
        self.assertTrue(seen["entered"])
        self.assertFalse(seen["closed"])   # cancel fired on the live stream
        self.assertTrue(r["callback_called"])
        self.assertTrue(r["got_delta"])
        self.assertEqual(r["deltas_seen"], 1)
        self.assertEqual(r["terminal"], "chat.cancelled")
        self.assertEqual(r["stream_ended_by"], "eof")
        self.assertIsNone(r["reason"])

    def test_pre_claim_empty_stream_retries_until_live_delta(self):
        # Root's exact 2-response pre-claim race: response 1 is the real
        # claim-before-worker shape (empty catch-up snapshot + immediate
        # EOF, no terminal), response 2 is the genuinely live stream
        # (snapshot + live delta + chat.cancelled + server EOF). The probe
        # must retry within the SAME absolute deadline and prove the cancel
        # on the second, actually-live stream — not give up at the first
        # EOF with callback 0 / got_delta false.
        resp1 = FakeResponse([snapshot_frame("")], clock=self.clock,
                             step=STEP)
        resp2 = FakeResponse(
            [snapshot_frame(""),
             frame("chat.delta", '{"t": 1}'),
             frame("chat.cancelled")],
            clock=self.clock, step=STEP)
        calls = self.install_urlopen([resp1, resp2])
        seen = {}

        def cancel_now():
            seen["closed"] = resp2.closed

        r = self.client.subscribe_cancel_after_first_delta(
            "g25b", cancel_now, timeout=30.0)
        self.assertEqual(len(calls), 2)     # the pre-claim EOF retried once
        self.assertTrue(seen["closed"] is False)  # cancel on the LIVE stream
        self.assertTrue(r["got_delta"])
        self.assertEqual(r["attempts"], 2)
        self.assertTrue(r["callback_called"])
        self.assertEqual(r["terminal"], "chat.cancelled")
        self.assertEqual(r["stream_ended_by"], "eof")
        self.assertIsNone(r["reason"])

    def test_locked_stream_eof_without_terminal_never_resubscribes(self):
        # Once the first live delta arrived, the response is LOCKED: an EOF
        # (or error) without the cancel terminal is a FAILURE — a fresh
        # subscription must never be opened to fake
        # original_stream_cancelled. A second scripted response proves the
        # retry never happened.
        resp1 = FakeResponse(
            [snapshot_frame(""),
             frame("chat.delta", '{"t": 1}')],   # then EOF, no terminal
            clock=self.clock, step=STEP)
        resp2 = FakeResponse(
            [snapshot_frame(""), frame("chat.cancelled")],
            clock=self.clock, step=STEP)
        calls = self.install_urlopen([resp1, resp2])
        r = self.client.subscribe_cancel_after_first_delta(
            "g25c", lambda: None, timeout=30.0)
        self.assertEqual(len(calls), 1)     # locked: no second subscription
        self.assertFalse(resp2.entered)
        self.assertTrue(r["got_delta"])
        self.assertTrue(r["callback_called"])
        self.assertIsNone(r["terminal"])
        self.assertEqual(r["stream_ended_by"], "eof")
        self.assertEqual(r["reason"], "eof_after_delta_without_terminal")

    def test_callback_exception_is_reported_not_swallowed(self):
        # A failing cancel callback (e.g. the real-stack CSRF 403 the first
        # probe run exposed) must surface as callback_error + reason — the
        # stream-read exception handler may never swallow it into a bare
        # deadline story.
        resp = FakeResponse(
            [snapshot_frame(""), frame("chat.delta", '{"t": 1}')],
            clock=self.clock, step=STEP)
        self.install_urlopen([resp])

        def boom():
            raise OSError("csrf rejected")

        r = self.client.subscribe_cancel_after_first_delta(
            "g27", boom, timeout=30.0)
        self.assertTrue(r["callback_called"])
        self.assertEqual(r["callback_error"], "OSError")
        self.assertEqual(r["reason"], "callback_error:OSError")
        self.assertIsNone(r["terminal"])
        self.assertIsNone(r["stream_ended_by"])

    def test_cancel_stream_error_after_terminal_is_not_server_eof(self):
        # A read error after the terminal event is NOT the server's clean
        # close: stream_ended_by must say so (original_stream_cancelled
        # would be False — the assertion needs the eof proof).
        resp = FakeResponse(
            [snapshot_frame("") + frame("chat.delta", '{"t": 1}'),
             frame("chat.cancelled"),
             socket.timeout("read died")],
            clock=self.clock, step=STEP)
        self.install_urlopen([resp])
        r = self.client.subscribe_cancel_after_first_delta(
            "g26", lambda: None, timeout=30.0)
        self.assertEqual(r["terminal"], "chat.cancelled")
        self.assertEqual(r["stream_ended_by"], "error")


class RunScenarioS6StubTest(unittest.TestCase):
    """run_scenario_s6 orchestration against a stubbed Client: the result
    dict must consume the probe methods' real dict shapes (no attribute
    access on dicts), report only booleans/counts/statuses/event names
    (never message text), and fail the full-content comparison when the
    persisted snapshot differs from the committed assistant message even
    at identical length (Root's same-length-different-text negative)."""

    def setUp(self):
        self._real_client = workload.Client

    def install(self, stub):
        workload.Client = stub
        self.addCleanup(setattr, workload, "Client", self._real_client)

    @staticmethod
    def args():
        import argparse
        return argparse.Namespace(
            base="http://127.0.0.1:1", session="s", csrf="c", account="a",
            origin=None, cacert=None, scenario="s6", key_prefix="t",
            sse_timeout=30.0, gens=0, sse_per_gen=0)

    def test_happy_path_shapes_and_no_payload_text(self):
        SNAP = COMMIT = "I hear you. Take a breath; there is no rush."
        instances = []

        class Stub:
            def __init__(self, *a, **k):
                instances.append(self)
                self.snapshots = ["GENERATING", "CANCELLED"]
                self.budgets = []
                self.conv_seq = 0

            def json(self, method, path, body=None, timeout=30.0):
                if path == "/api/v1/consents":
                    return 200, {}
                if path == "/api/v1/relationships":
                    return 200, {"relationshipId": "rel"}
                if path == "/api/v1/conversations":
                    self.conv_seq += 1
                    return 200, {"conversationId": f"conv{self.conv_seq}"}
                raise AssertionError(path)

            def snapshot(self, gid, timeout=30.0):
                # runs inside the cancel callback: the timeout handed over
                # is the callback's remaining absolute budget
                self.budgets.append(timeout)
                return 200, self.snapshots.pop(0)

            def cancel(self, gid, timeout=30.0):
                self.budgets.append(timeout)
                return 200, {"status": "CANCELLED"}

            def send(self, conv, key, text):
                return 202, {"generationId": "42"}

            def messages(self, conv):
                if conv == "conv1":    # A's conversation: one assistant
                    return 200, [{"role": "user", "content": "u"},
                                 {"role": "assistant", "content": COMMIT}]
                return 200, [{"role": "user", "content": "u"}]

            def subscribe_until_live_delta(self, gid, timeout=30.0):
                return {"got_delta": True, "catchup_chars": 0,
                        "deltas_seen": 1, "attempts": 1, "reason": None}

            def sse(self, gid, timeout=30.0):
                return sse_result(live_deltas=3, catchup_text_chars=7)

            def subscribe_snapshot_terminal(self, gid, timeout=30.0):
                return {"first_snapshot_text": SNAP,
                        "first_snapshot_chars": len(SNAP),
                        "terminal": "chat.completed", "ok": True,
                        "attempts": 1}

            def subscribe_cancel_after_first_delta(self, gid, cb,
                                                   timeout=30.0):
                cb()
                return {"got_delta": True, "deltas_seen": 1,
                        "catchup_chars": 0, "terminal": "chat.cancelled",
                        "stream_ended_by": "eof", "callback_called": True,
                        "callback_error": None, "attempts": 1,
                        "reason": None}

        stub_cls = Stub
        self.install(stub_cls)
        stats = workload.Stats()
        result = workload.run_scenario_s6(self.args(), stats)
        self.assertEqual(stats.errors, [])
        a = result["reconnect"]
        self.assertTrue(a["precondition_live_delta"])
        self.assertEqual(a["reconnect_terminal"], "chat.completed")
        self.assertGreaterEqual(a["reconnect_live_deltas"], 1)
        self.assertTrue(a["reconnect_catchup_nonempty"])
        self.assertEqual(a["post_terminal_terminal"], "chat.completed")
        self.assertTrue(a["post_terminal_snapshot_matches_assistant"])
        self.assertEqual(a["assistant_messages"], 1)
        b = result["cancel"]
        self.assertTrue(b["original_stream_cancelled"])
        self.assertEqual(b["original_stream_ended_by"], "eof")
        self.assertFalse(b["callback_budget_exhausted"])
        self.assertEqual(b["cancel_http_status"], 200)
        self.assertEqual(b["cancel_status_field"], "CANCELLED")
        self.assertEqual(b["status_after_cancel"], "CANCELLED")
        self.assertEqual(b["assistant_messages"], 0)
        self.assertEqual(result["generations"], 2)
        # No payload text ever leaves the scenario: the serialized result
        # carries only booleans/counts/statuses/event names.
        blob = json.dumps(result, ensure_ascii=False)
        self.assertNotIn(SNAP, blob)
        # The callback's two blocking calls were each capped at the
        # remaining budget of the SHARED deadline — strictly below the
        # 30.0 s default the post-cancel main-flow snapshot still uses
        # (recorded third): neither blocking call can outlive the stream's
        # absolute budget.
        self.assertEqual(len(instances), 1)   # one client drives both subs
        budgets = instances[-1].budgets
        self.assertEqual(len(budgets), 3)     # callback snapshot+cancel, then status_after
        for t in budgets[:2]:
            self.assertGreater(t, 0)
            self.assertLess(t, 30.0)
        self.assertEqual(budgets[2], 30.0)

    def test_same_length_different_text_fails_full_comparison(self):
        # Root negative: snapshot "aaaaa" vs committed "bbbbb" — identical
        # lengths, different content. The length-only comparison would
        # PASS; the full in-memory comparison must FAIL and record it.
        SNAP, COMMIT = "aaaaa", "bbbbb"

        class Stub:
            def __init__(self, *a, **k):
                self.snapshots = ["GENERATING", "CANCELLED"]
                self.conv_seq = 0

            def json(self, method, path, body=None, timeout=30.0):
                if path == "/api/v1/consents":
                    return 200, {}
                if path == "/api/v1/relationships":
                    return 200, {"relationshipId": "rel"}
                if path == "/api/v1/conversations":
                    self.conv_seq += 1
                    return 200, {"conversationId": f"conv{self.conv_seq}"}
                raise AssertionError(path)

            def snapshot(self, gid, timeout=30.0):
                return 200, self.snapshots.pop(0)

            def cancel(self, gid, timeout=30.0):
                return 200, {"status": "CANCELLED"}

            def send(self, conv, key, text):
                return 202, {"generationId": "42"}

            def messages(self, conv):
                if conv == "conv1":    # A's conversation: one assistant
                    return 200, [{"role": "assistant", "content": COMMIT}]
                return 200, [{"role": "user", "content": "u"}]

            def subscribe_until_live_delta(self, gid, timeout=30.0):
                return {"got_delta": True, "catchup_chars": 0,
                        "deltas_seen": 1, "attempts": 1, "reason": None}

            def sse(self, gid, timeout=30.0):
                return sse_result(live_deltas=2, catchup_text_chars=5)

            def subscribe_snapshot_terminal(self, gid, timeout=30.0):
                return {"first_snapshot_text": SNAP,
                        "first_snapshot_chars": len(SNAP),
                        "terminal": "chat.completed", "ok": True,
                        "attempts": 1}

            def subscribe_cancel_after_first_delta(self, gid, cb,
                                                   timeout=30.0):
                cb()
                return {"got_delta": True, "deltas_seen": 1,
                        "catchup_chars": 0, "terminal": "chat.cancelled",
                        "stream_ended_by": "eof", "callback_called": True,
                        "callback_error": None, "attempts": 1,
                        "reason": None}

        self.install(Stub)
        stats = workload.Stats()
        result = workload.run_scenario_s6(self.args(), stats)
        a = result["reconnect"]
        self.assertFalse(a["post_terminal_snapshot_matches_assistant"])
        # same lengths, so the failure is genuinely the content mismatch
        self.assertEqual(a["post_terminal_snapshot_chars"], len(COMMIT))
        self.assertTrue(any("differs" in e for e in stats.errors))
        blob = json.dumps(result, ensure_ascii=False)
        self.assertNotIn(SNAP, blob)
        self.assertNotIn(COMMIT, blob)


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


class ScenarioShapeTest(unittest.TestCase):
    """VC-R61: s3 scenario shape and the SSE deadline plumbing."""

    def test_resolve_shape_defaults(self):
        self.assertEqual(workload.resolve_shape("s3", 0, 0), (1, 3))
        self.assertEqual(workload.resolve_shape("s4", 0, 0), (1, 1))
        self.assertEqual(workload.resolve_shape("s5", 0, 0), (4, 2))
        self.assertEqual(workload.resolve_shape("s10", 0, 0), (16, 4))
        # explicit shape wins over the scenario default
        self.assertEqual(workload.resolve_shape("s3", 2, 5), (2, 5))

    def test_subscribe_one_passes_sse_timeout(self):
        class Args:
            sse_timeout = 12.5

        class Client:
            def __init__(self):
                self.calls = []
                self.gid = None

            def sse(self, gid, timeout=30.0):
                self.calls.append((gid, timeout))
                self.gid = gid
                return sse_result(ok=True)

        client = Client()
        stats = workload.Stats()
        workload.subscribe_one(Args(), stats, client, "gen-1")
        self.assertEqual(client.calls, [("gen-1", 12.5)])
        self.assertEqual(stats.report()["sse_ok"], 1)


def quiet_frame(observer_ts, *, subs=3, gen=1, pactive=1, chunks=7,
                ok=True, ts=0.0, provider=None):
    """One collected frame in the collector.py shape (VC-R61)."""
    if provider is None and ok:
        provider = {"activeStreamRequests": pactive,
                    "contentChunkWrites": chunks, "streamRequests": 5}
    metrics = (None if not ok else
               {"vc_realtime_subscribers": str(subs),
                "vc_generation_active": str(gen)})
    return {"ts": ts,
            "integrity": {"observer": {"ok": ok,
                                       "observer_ts": observer_ts}},
            "a": {"metrics": metrics, "metrics_ts": observer_ts},
            "provider": provider}


class ObserverQuietWindowTest(unittest.TestCase):
    """VC-R61: deduplicated observer-record quiet-window rules.

    The frame sampler's Tailer reuses the latest observer record across
    frames, so frame-ts growth is not a fresh sample; the sample unit is
    the deduplicated observer record, strictly increasing, and any
    missing/stale/non-qualifying observation BREAKS the run — bad samples
    are never filtered away to stitch two ends together.
    """

    BASE = 7

    def test_reused_observer_records_are_deduplicated(self):
        # frame ts advances (10.0..12.5) while the observer record only
        # changes at 10/11/12; the reused records must not lengthen the
        # window or add samples.
        frames = [
            quiet_frame(10.0, ts=10.0), quiet_frame(10.0, ts=10.5),
            quiet_frame(11.0, ts=11.0), quiet_frame(11.0, ts=11.5),
            quiet_frame(12.0, ts=12.0), quiet_frame(12.0, ts=12.4),
            quiet_frame(13.0, chunks=8, ts=12.6), quiet_frame(13.0, ts=13.0),
        ]
        rec = workload.observer_quiet_runs(frames, self.BASE)
        self.assertEqual(rec["observations_total"], 4)
        chosen = rec["chosen"]
        self.assertEqual(chosen["sample_count"], 3)
        self.assertEqual(chosen["sample_ts"], [10.0, 11.0, 12.0])
        self.assertEqual(chosen["span_s"], 2.0)
        self.assertEqual(chosen["break_reason"], "content_started")
        self.assertEqual(chosen["max_content_chunks"], self.BASE)

    def test_bad_sample_breaks_window_without_stitching(self):
        frames = [quiet_frame(10.0, ts=10.0), quiet_frame(11.0, ts=11.0),
                  quiet_frame(12.0, subs=2, ts=12.0),
                  quiet_frame(13.0, ts=13.0), quiet_frame(14.0, ts=14.0)]
        rec = workload.observer_quiet_runs(frames, self.BASE)
        self.assertEqual(len(rec["runs"]), 2)
        chosen = rec["chosen"]
        self.assertEqual(chosen["start_ts"], 10.0)
        self.assertEqual(chosen["sample_count"], 2)
        self.assertEqual(chosen["break_reason"], "subscribers=2")
        second = rec["runs"][1]
        self.assertEqual(second["sample_count"], 2)
        self.assertIsNone(second["break_reason"])

    def test_stale_or_missing_observer_breaks_window(self):
        frames = [quiet_frame(10.0, ts=10.0), quiet_frame(11.0, ts=11.0),
                  # stale observation: frame sampler marked it not-ok, so
                  # metrics and provider are absent on the reused record
                  quiet_frame(12.0, ok=False, ts=12.0),
                  quiet_frame(13.0, ts=13.0), quiet_frame(14.0, ts=14.0)]
        rec = workload.observer_quiet_runs(frames, self.BASE)
        self.assertEqual(rec["observations"][2]["reason"], "observer_stale")
        self.assertEqual(rec["chosen"]["sample_count"], 2)
        self.assertEqual(rec["chosen"]["break_reason"], "observer_stale")
        # a frame whose observer record could not be read at all
        frames2 = [quiet_frame(10.0, ts=10.0), quiet_frame(None, ts=10.5),
                   quiet_frame(11.0, ts=11.0), quiet_frame(12.0, ts=12.0)]
        rec2 = workload.observer_quiet_runs(frames2, self.BASE)
        self.assertEqual(rec2["observations"][1]["reason"],
                         "observer_stale")
        self.assertEqual(rec2["chosen"]["start_ts"], 11.0)

    def test_stale_reuse_of_same_record_breaks_not_deduped(self):
        # Root's exact negative: the frame sampler reuses one cached
        # observer record while it ages past the staleness window — frame
        # ts grows, observer_ts stays 100 and the record turns ok=false.
        # The stale repeat must BREAK the window (it is real evidence the
        # observation was lost), never be dropped by dedupe, so the two
        # valid sides must not be stitched into one span-10/2-sample run.
        frames = [quiet_frame(100.0, ts=100.0),
                  quiet_frame(100.0, ok=False, ts=105.0),
                  quiet_frame(110.0, ts=110.0)]
        rec = workload.observer_quiet_runs(frames, self.BASE)
        self.assertEqual([o["reason"] for o in rec["observations"]],
                         [None, "observer_stale", None])
        self.assertEqual(len(rec["runs"]), 2)
        self.assertEqual(rec["runs"][0]["sample_ts"], [100.0])
        self.assertEqual(rec["runs"][0]["break_reason"], "observer_stale")
        self.assertEqual(rec["runs"][1]["sample_ts"], [110.0])
        self.assertIsNone(rec["runs"][1]["break_reason"])
        # neither 1-sample run reaches the floor: no window may be claimed
        self.assertIsNone(rec["chosen"])

    def test_content_counter_above_baseline_breaks_window(self):
        frames = [quiet_frame(10.0, ts=10.0), quiet_frame(11.0, ts=11.0),
                  quiet_frame(12.0, chunks=self.BASE + 1, ts=12.0)]
        rec = workload.observer_quiet_runs(frames, self.BASE)
        self.assertEqual(rec["observations"][2]["reason"], "content_started")
        self.assertEqual(rec["chosen"]["sample_count"], 2)

    def test_non_monotonic_observer_ts_splits_run(self):
        frames = [quiet_frame(10.0, ts=10.0), quiet_frame(11.0, ts=11.0),
                  quiet_frame(10.5, ts=11.5), quiet_frame(11.5, ts=12.0)]
        rec = workload.observer_quiet_runs(frames, self.BASE)
        self.assertEqual(len(rec["runs"]), 2)
        self.assertEqual(rec["runs"][0]["break_reason"],
                         "non_monotonic_observer_ts")
        self.assertEqual(rec["chosen"]["sample_ts"], [10.0, 11.0])

    def test_predicate_and_shape_mismatches_record_reasons(self):
        frames = [
            quiet_frame(10.0, gen=0, ts=10.0),
            quiet_frame(11.0, pactive=0, ts=11.0),
            quiet_frame(12.0, ok=True, provider={}, ts=12.0),
        ]
        rec = workload.observer_quiet_runs(frames, self.BASE)
        self.assertEqual([o["reason"] for o in rec["observations"]],
                         ["generation_active=0", "provider_active=0",
                          "observation_unparseable"])
        self.assertIsNone(rec["chosen"])


# ---- §19.1 S9 (VC-R128): real login vs session-revocation concurrency ---

S9A = "s9a"
S9B = "s9b"
S9_PASSWORD = "S9-e2e-password-do-not-print"
S9_TOTP_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"


class TOTPCodeTest(unittest.TestCase):
    """RFC 6238 SHA-1 / 30 s / 6-digit vectors for the hand-written TOTP."""

    def test_rfc6238_sha1_vectors_and_step_edges(self):
        # 6-digit truncations of the RFC's 8-digit SHA-1 vectors
        self.assertEqual(workload.s9_totp_code(S9_TOTP_SECRET, 59.0),
                         "287082")
        self.assertEqual(workload.s9_totp_code(S9_TOTP_SECRET, 1111111109.0),
                         "081804")
        self.assertEqual(workload.s9_totp_code(S9_TOTP_SECRET, 1234567890.0),
                         "005924")
        self.assertEqual(workload.s9_totp_code(S9_TOTP_SECRET, 2000000000.0),
                         "279037")
        # base32 case and padding are normalized
        self.assertEqual(
            workload.s9_totp_code(S9_TOTP_SECRET.lower() + "=", 59.0),
            "287082")
        # the code changes exactly at 30 s step boundaries
        self.assertEqual(workload.s9_totp_code(S9_TOTP_SECRET, 29.999),
                         workload.s9_totp_code(S9_TOTP_SECRET, 0.0))
        self.assertNotEqual(workload.s9_totp_code(S9_TOTP_SECRET, 29.999),
                            workload.s9_totp_code(S9_TOTP_SECRET, 30.0))


class S9CookieTest(unittest.TestCase):
    """Set-Cookie capture: multi-header capture, clearing via empty value
    or non-positive Max-Age (the backend's revoke-all shape), names-only
    extraction."""

    def test_apply_set_cookies_captures_and_clears(self):
        jar = {}
        workload.s9_apply_set_cookies([
            "vc_session=abc; Path=/; Max-Age=3600; HttpOnly; Secure; SameSite=Lax",
            "vc_csrf=def; Path=/; Max-Age=3600; SameSite=Lax",
        ], jar)
        self.assertEqual(jar, {"vc_session": "abc", "vc_csrf": "def"})
        # a trusted cookie joins via a third header of the same response
        workload.s9_apply_set_cookies(
            ["vc_trusted_device=tok; Path=/; Max-Age=7776000; HttpOnly"], jar)
        self.assertEqual(jar["vc_trusted_device"], "tok")
        # values containing '=' survive (partition splits on the first only)
        workload.s9_apply_set_cookies(["vc_session=a=b=; Path=/"], jar)
        self.assertEqual(jar["vc_session"], "a=b=")
        # revoke-all's clearing shape (auth.go clearTrustedDeviceCookie)
        workload.s9_apply_set_cookies(
            ["vc_trusted_device=; Path=/; Max-Age=-1;"
             " Expires=Thu, 01 Jan 1970 00:00:01 GMT"], jar)
        self.assertNotIn("vc_trusted_device", jar)
        # empty value clears too; an unrelated cookie survives
        workload.s9_apply_set_cookies(["vc_session="], jar)
        self.assertEqual(jar, {"vc_csrf": "def", })

    def test_cookie_names_reports_names_only(self):
        self.assertEqual(
            workload.s9_cookie_names(["vc_session=x; Path=/",
                                      "vc_csrf=y; Path=/"]),
            ["vc_session", "vc_csrf"])
        self.assertEqual(workload.s9_cookie_names([]), [])
        self.assertEqual(workload.s9_cookie_names(None), [])


class FakeHeaders:
    """Minimal stand-in for the http.client header object: get_all only."""

    def __init__(self, values):
        self.values = {k.lower(): list(v) for k, v in values.items()}

    def get_all(self, name, default=None):
        return self.values.get(name.lower(), default)


class FakeJSONResponse:
    """Scripted JSON HTTP response: context manager + one-shot read."""

    def __init__(self, status, body, set_cookies=()):
        self.status = status
        self._raw = json.dumps(body).encode() if body is not None else b""
        self.headers = FakeHeaders({"content-type": ["application/json"],
                                    "set-cookie": list(set_cookies)})
        self.closed = False

    def read(self):
        return self._raw

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        self.closed = True
        return False


class S9ClientScriptedTest(unittest.TestCase):
    """S9Client wire contract against scripted urlopen responses: the
    cookie header is built from the client's OWN jar only, authenticated
    writes carry CSRF double-submit + expected-account + Content-Type,
    reads carry neither, multiple Set-Cookie headers are surfaced whole,
    HTTPError statuses are returned rather than raised, and a response
    never mutates the issuing client's jar (session identities stay
    isolated)."""

    def install(self, script):
        calls = []
        real = urllib.request.urlopen

        def scripted(req, timeout=None, context=None):
            calls.append({"req": req, "timeout": timeout})
            item = script[len(calls) - 1] if len(calls) <= len(script) \
                else script[-1]
            if callable(item):
                item = item()
            if isinstance(item, BaseException):
                raise item
            return item

        urllib.request.urlopen = scripted
        self.addCleanup(setattr, urllib.request, "urlopen", real)
        return calls

    @staticmethod
    def hget(req, name):
        for k, v in req.headers.items():
            if k.lower() == name.lower():
                return v
        return None

    def test_write_headers_multi_set_cookie_and_jar_isolation(self):
        client = workload.S9Client(
            "http://127.0.0.1:1", cookies={"vc_session": "s1",
                                          "vc_csrf": "c1"}, account_id="42")
        resp = FakeJSONResponse(
            200, {"ok": True},
            ["vc_session=s2; Path=/; Max-Age=3600",
             "vc_csrf=c2; Path=/; Max-Age=3600"])
        calls = self.install([resp])
        status, body, sc = client.request(
            "DELETE", "/api/v1/auth/sessions/9", {}, write=True)
        self.assertEqual(status, 200)
        self.assertEqual(body, {"ok": True})
        self.assertEqual(sc, ["vc_session=s2; Path=/; Max-Age=3600",
                              "vc_csrf=c2; Path=/; Max-Age=3600"])
        req = calls[0]["req"]
        self.assertEqual(req.get_method(), "DELETE")
        self.assertEqual(self.hget(req, "cookie"),
                         "vc_session=s1; vc_csrf=c1")
        self.assertEqual(self.hget(req, "x-csrf-token"), "c1")
        self.assertEqual(self.hget(req, "x-vc-expected-account-id"), "42")
        self.assertEqual(self.hget(req, "content-type"), "application/json")
        self.assertEqual(self.hget(req, "origin"), "http://127.0.0.1")
        # the jar is caller-owned: a response never rewrites it, and other
        # clients' jars are untouched (one login cannot clobber another)
        self.assertEqual(client.cookies, {"vc_session": "s1", "vc_csrf": "c1"})
        other = workload.S9Client("http://127.0.0.1:1",
                                  cookies={"vc_session": "z"})
        self.assertEqual(other.cookies, {"vc_session": "z"})

    def test_http_error_surfaced_and_read_carries_no_csrf(self):
        client = workload.S9Client("https://127.0.0.1:18443/x/",
                                   cookies={"vc_session": "s1"},
                                   account_id="42")
        err = urllib.error.HTTPError(
            "url", 401, "Unauthorized", FakeHeaders({}),
            io.BytesIO(b'{"code":"AUTHENTICATION_REQUIRED"}'))
        calls = self.install([err])
        status, body, sc = client.request("GET", "/api/v1/auth/sessions")
        self.assertEqual(status, 401)
        self.assertEqual(body, {"code": "AUTHENTICATION_REQUIRED"})
        self.assertEqual(sc, [])
        req = calls[0]["req"]
        # origin derives scheme+hostname only (the Client convention)
        self.assertEqual(self.hget(req, "origin"), "https://127.0.0.1")
        self.assertEqual(self.hget(req, "cookie"), "vc_session=s1")
        # a read carries neither CSRF nor Content-Type nor account header
        self.assertIsNone(self.hget(req, "x-csrf-token"))
        self.assertIsNone(self.hget(req, "content-type"))
        self.assertIsNone(self.hget(req, "x-vc-expected-account-id"))


class FakeS9Backend:
    """Stateful stand-in for the real auth endpoints the S9 scenario uses.

    Reproduces the auth.go semantics the scenario depends on: 202 challenge
    on first login, direct 200 via a valid trusted cookie (the token is
    never rotated), authenticator-setup / authenticator-confirm (ENROLL
    mode, strict TOTP against the shared s9_totp_code window), session
    list with current flags, owner-scoped DELETE (404 cross-account) and
    revoke-all with a count — neither sets cookies. Strict about the wire
    contract (Origin on unauthenticated writes; Origin + CSRF
    double-submit + expected-account on authenticated writes) so header
    bugs fail loudly. The two concurrent-phase requests rendezvous on a
    REAL barrier inside the backend, so the overlap measurement has
    deterministic truth on the real monotonic clock.
    """

    def __init__(self, *, keep_trusted_after_revoke=False,
                 lenient_totp=False):
        self.lock = threading.Lock()
        self.keep_trusted_after_revoke = keep_trusted_after_revoke
        self.lenient_totp = lenient_totp
        self.requests = []      # {"method","path","headers","cookies","body"}
        self.account_ids = {S9A: "9000002", S9B: "9000003",
                            "harness": "9000001"}
        self.next_row = 900100
        self.sessions = {}      # token -> {"account","row","live"}
        self.by_account = {}    # account -> [(token, csrf, row), ...]
        self.challenges = {}    # cid -> account
        self.next_cid = 0
        self.trusted = {}       # token -> {"account","live"}
        self.enrolled = set()
        self.trusted_logins = 0
        self.a0_token = None
        self.concurrent_barrier = threading.Barrier(2, timeout=5.0)
        # the harness's fabricated session (run.sh) must keep working
        self.sessions["HARNESS-SESS"] = {"account": "harness",
                                         "row": "900099", "live": True}

    # -- plumbing ------------------------------------------------------

    def __call__(self, req, timeout=None, context=None):
        method = req.get_method()
        path = urllib.parse.urlparse(req.full_url).path
        headers = {k.lower(): v for k, v in req.headers.items()}
        cookies = {}
        for part in headers.get("cookie", "").split(";"):
            name, _, value = part.strip().partition("=")
            if name:
                cookies[name] = value
        body = json.loads(req.data.decode()) if req.data else None
        with self.lock:
            self.requests.append({"method": method, "path": path,
                                  "headers": headers, "cookies": cookies,
                                  "body": body})
        if method == "POST" and path == "/api/v1/auth/login":
            return self._login(headers, cookies, body or {})
        if method == "POST" and path.endswith("/authenticator-setup"):
            return self._setup(headers, path)
        if method == "POST" and path.endswith("/authenticator-confirm"):
            return self._confirm(headers, path, body or {})
        if method == "GET" and path == "/api/v1/auth/sessions":
            return self._list(cookies)
        if method == "DELETE" and path.startswith("/api/v1/auth/sessions/"):
            return self._delete(headers, cookies, path)
        if method == "POST" and path == "/api/v1/auth/sessions/revoke-all":
            return self._revoke_all(headers, cookies)
        raise AssertionError(f"unexpected request {method} {path}")

    @staticmethod
    def _error(status, code):
        return urllib.error.HTTPError(
            "http://backend", status, code, FakeHeaders({}),
            io.BytesIO(json.dumps({"code": code}).encode()))

    def _issue(self, account):
        row = str(self.next_row)
        self.next_row += 1
        token = f"SESS-{account}-{row}"
        csrf = f"CSRF-{account}-{row}"
        self.sessions[token] = {"account": account, "row": row,
                                "live": True}
        self.by_account.setdefault(account, []).append((token, csrf, row))
        if account == S9A and self.a0_token is None:
            self.a0_token = token
        return token, csrf, row

    @staticmethod
    def _session_cookies(token, csrf):
        return [f"vc_session={token}; Path=/; Max-Age=3600; HttpOnly;"
                f" SameSite=Lax",
                f"vc_csrf={csrf}; Path=/; Max-Age=3600; SameSite=Lax"]

    def _rendezvous(self):
        try:
            self.concurrent_barrier.wait()
        except Exception:
            pass  # a scenario that never sends the peer still gets a
            # bounded (5 s) response; the failure then shows up in the
            # scenario's own assertions instead of hanging the test

    def _write_principal(self, headers, cookies):
        """(session-or-None, error-response-or-None): Origin + CSRF
        double-submit + expected-account + live session, as core.go's
        corePrincipal(write=true) demands."""
        if not headers.get("origin"):
            return None, self._error(403, "ACCESS_DENIED")
        if not headers.get("x-csrf-token") \
                or headers.get("x-csrf-token") != cookies.get("vc_csrf"):
            return None, self._error(403, "ACCESS_DENIED")
        session = self.sessions.get(cookies.get("vc_session"))
        if not session or not session["live"]:
            return None, self._error(401, "AUTHENTICATION_REQUIRED")
        if headers.get("x-vc-expected-account-id") \
                != self.account_ids[session["account"]]:
            return None, self._error(409, "ACCOUNT_CONTEXT_CHANGED")
        return session, None

    # -- endpoints ------------------------------------------------------

    def _login(self, headers, cookies, body):
        if not headers.get("origin"):
            return self._error(403, "ACCESS_DENIED")
        account = body.get("account")
        if account not in self.account_ids or \
                body.get("password") != S9_PASSWORD:
            return self._error(404, "NOT_FOUND_OR_FORBIDDEN")
        token = cookies.get("vc_trusted_device")
        trusted = self.trusted.get(token) if token else None
        if token and trusted and trusted["live"]:
            self.trusted_logins += 1
            if self.trusted_logins == 2:   # login#3: the concurrent one
                self._rendezvous()
            new, csrf, _ = self._issue(account)
            return FakeJSONResponse(
                200, {"nextStep": "ACTIVE",
                      "accountId": self.account_ids[account]},
                self._session_cookies(new, csrf))
        clear = []
        if token and (trusted is None or not trusted["live"]):
            if not self.keep_trusted_after_revoke:
                clear = ["vc_trusted_device=; Path=/; Max-Age=-1;"
                         " Expires=Thu, 01 Jan 1970 00:00:01 GMT"]
            else:
                # negative mode: the revoked credential is still accepted
                new, csrf, _ = self._issue(account)
                return FakeJSONResponse(
                    200, {"nextStep": "ACTIVE",
                          "accountId": self.account_ids[account]},
                    self._session_cookies(new, csrf))
        with self.lock:
            self.next_cid += 1
            cid = f"CHAL-{self.next_cid}"
            self.challenges[cid] = account
        step = "TOTP_REQUIRED" if account in self.enrolled \
            else "AUTHENTICATOR_SETUP_REQUIRED"
        return FakeJSONResponse(
            202, {"nextStep": step, "challengeId": cid,
                  "expiresAt": "2026-10-23T00:00:00Z"}, clear)

    def _setup(self, headers, path):
        if not headers.get("origin"):
            return self._error(403, "ACCESS_DENIED")
        cid = path.split("/")[-2]
        if cid not in self.challenges:
            return self._error(404, "NOT_FOUND_OR_FORBIDDEN")
        return FakeJSONResponse(200, {"manualKey": S9_TOTP_SECRET,
                                      "provisioningUri": "otpauth://totp/x",
                                      "qrCodeDataUrl": "data:,"})

    def _confirm(self, headers, path, body):
        if not headers.get("origin"):
            return self._error(403, "ACCESS_DENIED")
        cid = path.split("/")[-2]
        account = self.challenges.get(cid)
        if account is None:
            return self._error(404, "AUTH_CHALLENGE_UNAVAILABLE")
        if not self.lenient_totp:
            now = time.time()
            window = {workload.s9_totp_code(S9_TOTP_SECRET, now + delta)
                      for delta in (0, -30, 30)}
            if body.get("code") not in window:
                return self._error(404, "NOT_FOUND_OR_FORBIDDEN")
        with self.lock:
            del self.challenges[cid]
            self.enrolled.add(account)
            token, csrf, row = self._issue(account)
        set_cookies = self._session_cookies(token, csrf)
        if body.get("trustDevice"):
            trusted = f"TRUST-{account}-{row}"
            self.trusted[trusted] = {"account": account, "live": True}
            set_cookies.append(
                f"vc_trusted_device={trusted}; Path=/; Max-Age=7776000;"
                f" HttpOnly; SameSite=Lax")
        return FakeJSONResponse(
            200, {"nextStep": "ACTIVE",
                  "accountId": self.account_ids[account],
                  "recoveryCodes": ["rc-do-not-print"]}, set_cookies)

    def _list(self, cookies):
        session = self.sessions.get(cookies.get("vc_session"))
        if not session or not session["live"]:
            return self._error(401, "AUTHENTICATION_REQUIRED")
        rows = [{"id": rec["row"], "createdAt": "2026-10-23T00:00:00Z",
                 "expiresAt": "2026-10-30T00:00:00Z",
                 "current": rec["row"] == session["row"],
                 "accountId": self.account_ids[rec["account"]],
                 "role": "USER", "passwordMustChange": False}
                for rec in self.sessions.values()
                if rec["live"] and rec["account"] == session["account"]]
        return FakeJSONResponse(200, rows)

    def _delete(self, headers, cookies, path):
        session, err = self._write_principal(headers, cookies)
        if err is not None:
            return err
        if cookies.get("vc_session") == self.a0_token:
            self._rendezvous()   # the concurrent DELETE (S_a0's browser)
        sid = path.rsplit("/", 1)[1]
        target = next((rec for rec in self.sessions.values()
                       if rec["live"] and rec["row"] == sid
                       and rec["account"] == session["account"]), None)
        if target is None:
            return self._error(404, "NOT_FOUND_OR_FORBIDDEN")
        target["live"] = False
        return FakeJSONResponse(200, {"ok": True})

    def _revoke_all(self, headers, cookies):
        session, err = self._write_principal(headers, cookies)
        if err is not None:
            return err
        with self.lock:
            count = 0
            for rec in self.sessions.values():
                if rec["live"] and rec["account"] == session["account"]:
                    rec["live"] = False
                    count += 1
            if not self.keep_trusted_after_revoke:
                for trusted in self.trusted.values():
                    if trusted["account"] == session["account"]:
                        trusted["live"] = False
        return FakeJSONResponse(200, {"revoked": count})


class FakeS9Clock:
    """time.monotonic stand-in advanced by the test per fake-backend call,
    plus a FIXED wall clock (time.time) so TOTP stays deterministic."""

    def __init__(self, start=1000.0, wall=1_700_000_000.0, step=1.0):
        self.now = start
        self.wall = wall
        self.step = step

    def monotonic(self):
        return self.now

    def time(self):
        return self.wall

    def sleep(self, seconds):
        self.now += seconds

    def advance(self, seconds):
        self.now += seconds


class S9ScenarioOrchestrationTest(unittest.TestCase):
    """run_scenario_s9 end-to-end against the fake auth backend: the full
    §19.1 场景 9 sequence with real threads and a deterministic concurrent
    rendezvous, plus the explicit-failure paths."""

    def setUp(self):
        self.backend = FakeS9Backend()
        real = urllib.request.urlopen

        def routed(req, timeout=None, context=None):
            return self.backend(req, timeout, context)

        urllib.request.urlopen = routed
        self.addCleanup(setattr, urllib.request, "urlopen", real)

    @staticmethod
    def args(budget=60.0):
        import argparse
        return argparse.Namespace(
            base="http://backend", origin=None, cacert=None,
            session="HARNESS-SESS", csrf="HARNESS-CSRF", account="9000001",
            s9_login_a=S9A, s9_login_b=S9B,
            s9_password_a=S9_PASSWORD, s9_password_b=S9_PASSWORD,
            s9_budget_seconds=budget)

    def assert_schema_complete(self, s9):
        self.assertEqual(set(s9),
                         {"deadline_seconds", "budget_expired",
                          "public_calls", "a_enroll", "a_login2", "b_enroll",
                          "owner_isolation", "concurrent", "revoke_all",
                          "trusted_revoked", "g12_probe", "errors",
                          "error_count"})
        self.assertEqual(set(s9["a_enroll"]),
                         {"login_status", "setup_status", "totp_status",
                          "totp_trusted", "session_active"})
        self.assertEqual(set(s9["a_login2"]),
                         {"status", "trusted_cookie_present",
                          "session_active"})
        self.assertEqual(set(s9["b_enroll"]),
                         {"login_status", "setup_status", "totp_status",
                          "session_active"})
        self.assertEqual(set(s9["owner_isolation"]),
                         {"b_delete_status", "target_get_status"})
        self.assertEqual(set(s9["concurrent"]),
                         {"overlap", "overlap_margin_ms", "login_status",
                          "delete_status", "target_after_status",
                          "new_active", "a0_active", "b_active",
                          "delete_no_set_cookie"})
        self.assertEqual(set(s9["revoke_all"]),
                         {"status", "revoked", "a0_after_status",
                          "new_after_status", "b_active", "no_set_cookie"})
        self.assertEqual(set(s9["trusted_revoked"]),
                         {"login_status", "next_step",
                          "session_cookie_absent"})
        self.assertEqual(set(s9["g12_probe"]), {"status"})

    def test_happy_path_full_schema_and_wire(self):
        stats = workload.Stats()
        result = workload.run_scenario_s9(self.args(), stats)
        self.assert_schema_complete(result)
        self.assertEqual(stats.errors, [])
        self.assertEqual(result["public_calls"], 22)
        self.assertFalse(result["budget_expired"])
        self.assertEqual(result["a_enroll"],
                         {"login_status": 202, "setup_status": 200,
                          "totp_status": 200, "totp_trusted": True,
                          "session_active": True})
        self.assertEqual(result["a_login2"],
                         {"status": 200, "trusted_cookie_present": True,
                          "session_active": True})
        self.assertEqual(result["b_enroll"],
                         {"login_status": 202, "setup_status": 200,
                          "totp_status": 200, "session_active": True})
        self.assertEqual(result["owner_isolation"],
                         {"b_delete_status": 404, "target_get_status": 200})
        concurrent = result["concurrent"]
        self.assertTrue(concurrent["overlap"])
        self.assertGreater(concurrent["overlap_margin_ms"], 0.0)
        self.assertEqual(concurrent["login_status"], 200)
        self.assertEqual(concurrent["delete_status"], 200)
        self.assertEqual(concurrent["target_after_status"], 401)
        self.assertTrue(concurrent["new_active"])
        self.assertTrue(concurrent["a0_active"])
        self.assertTrue(concurrent["b_active"])
        self.assertTrue(concurrent["delete_no_set_cookie"])
        revoke = result["revoke_all"]
        self.assertEqual(revoke["status"], 200)
        self.assertEqual(revoke["revoked"], 2)
        self.assertEqual(revoke["a0_after_status"], 401)
        self.assertEqual(revoke["new_after_status"], 401)
        self.assertTrue(revoke["b_active"])
        self.assertTrue(revoke["no_set_cookie"])
        self.assertEqual(result["trusted_revoked"],
                         {"login_status": 202, "next_step": "TOTP_REQUIRED",
                          "session_cookie_absent": True})
        self.assertEqual(result["g12_probe"]["status"], 200)

        # wire evidence: exactly the expected 22 public calls
        requests = self.backend.requests
        self.assertEqual(len(requests), 22)
        rows_a = [row for _, _, row in self.backend.by_account[S9A]]
        target_row = rows_a[1]            # a0, target, new in issue order
        b_token, b_csrf, _ = self.backend.by_account[S9B][0]
        # login#2 (index 3): the trusted-device browser carried ONLY the
        # trusted cookie — no session cookie of any other client
        self.assertEqual(requests[3]["cookies"].keys(),
                         {"vc_trusted_device"})
        trusted_value = requests[3]["cookies"]["vc_trusted_device"]
        # B's cross-account DELETE (index 8) carried B's own CSRF +
        # expected-account and targeted A's session row
        b_delete = requests[8]
        self.assertEqual(b_delete["method"], "DELETE")
        self.assertEqual(b_delete["path"],
                         f"/api/v1/auth/sessions/{target_row}")
        self.assertEqual(b_delete["cookies"]["vc_session"], b_token)
        self.assertEqual(b_delete["headers"]["x-csrf-token"], b_csrf)
        self.assertEqual(b_delete["headers"]["x-vc-expected-account-id"],
                         "9000003")
        # the concurrent pair (indexes 10/11 in either order): trusted
        # login #3 and S_a0's DELETE of the target row
        pair = {requests[10]["path"], requests[11]["path"]}
        self.assertEqual(pair, {"/api/v1/auth/login",
                                f"/api/v1/auth/sessions/{target_row}"})
        # login#4 (index 20) reused the SAME trusted cookie value
        self.assertEqual(requests[20]["path"], "/api/v1/auth/login")
        self.assertEqual(requests[20]["cookies"].get("vc_trusted_device"),
                         trusted_value)
        # no credentials anywhere in the serialized output or errors
        blob = json.dumps(result, ensure_ascii=False) \
            + json.dumps(stats.errors, ensure_ascii=False)
        for secret in (S9_PASSWORD, S9_TOTP_SECRET, "SESS-", "CSRF-",
                       "TRUST-", "CHAL-", "rc-do-not-print", target_row):
            self.assertNotIn(secret, blob)

    def test_trusted_cookie_surviving_revoke_all_fails_login4(self):
        # Root negative: if revoke-all left the trusted credential valid,
        # login#4 returns 200 (not 202 TOTP_REQUIRED) — that MUST be an
        # explicit error, never a green run.
        self.backend = FakeS9Backend(keep_trusted_after_revoke=True)
        real = urllib.request.urlopen

        def routed(req, timeout=None, context=None):
            return self.backend(req, timeout, context)

        urllib.request.urlopen = routed
        stats = workload.Stats()
        result = workload.run_scenario_s9(self.args(), stats)
        tr = result["trusted_revoked"]
        self.assertEqual(tr["login_status"], 200)
        self.assertFalse(tr["session_cookie_absent"])
        self.assertTrue(any("a_login4" in e for e in stats.errors))
        # the rest of the chain still ran and still passed its own checks
        self.assertEqual(result["public_calls"], 22)
        self.assertEqual(result["revoke_all"]["revoked"], 2)
        self.assertTrue(result["revoke_all"]["b_active"])

    def test_budget_exhaustion_is_explicit_failure(self):
        # A late/expired result is never a success: after the deadline the
        # run records budget_expired and fails, with the full schema still
        # present (no vacuous green, no crash).
        self.backend.lenient_totp = True
        clock = FakeS9Clock(step=1.0)
        real_time = workload.time
        inner = urllib.request.urlopen

        def advancing(req, timeout=None, context=None):
            resp = inner(req, timeout, context)
            clock.advance(1.0)
            return resp

        urllib.request.urlopen = advancing
        workload.time = clock
        self.addCleanup(setattr, workload, "time", real_time)
        stats = workload.Stats()
        result = workload.run_scenario_s9(self.args(budget=3.5), stats)
        self.assert_schema_complete(result)
        self.assertTrue(result["budget_expired"])
        # calls issued: a-login, a-setup, a-confirm (t<=1003), a-login2
        # issued at 1003 (0.5 left) and returns at 1004 — past the 1003.5
        # deadline: its 200 must NOT count as session_active
        self.assertEqual(result["public_calls"], 4)
        self.assertEqual(result["a_enroll"]["session_active"], True)
        self.assertEqual(result["a_login2"]["status"], 200)
        self.assertFalse(result["a_login2"]["session_active"])
        self.assertIsNone(result["b_enroll"]["login_status"])
        self.assertTrue(any("budget" in e for e in stats.errors))
        blob = json.dumps(result, ensure_ascii=False)
        self.assertIn("budget_expired", blob)

    def test_transport_failure_is_explicit_not_vacuous(self):
        real = urllib.request.urlopen

        def dead(req, timeout=None, context=None):
            raise OSError("connection refused (simulated)")

        urllib.request.urlopen = dead
        stats = workload.Stats()
        result = workload.run_scenario_s9(self.args(), stats)
        self.assert_schema_complete(result)
        self.assertTrue(any("OSError" in e for e in stats.errors))
        # only the three logins and the probe were issued; every dependent
        # step is skipped with its own error
        self.assertEqual(result["public_calls"], 4)
        self.assertIsNone(result["a_enroll"]["login_status"])
        self.assertIsNone(result["owner_isolation"]["b_delete_status"])
        self.assertIsNone(result["g12_probe"]["status"])
        self.assertFalse(result["concurrent"]["overlap"])
        self.assertFalse(result["budget_expired"])


class S9CLITest(unittest.TestCase):
    """main() plumbing for --scenario s9: required env is enforced with the
    existing parser.error style, and a full run prints the one-line
    {"scenario":"s9","s9":{...}} contract."""

    def setUp(self):
        self.backend = FakeS9Backend()
        real = urllib.request.urlopen

        def routed(req, timeout=None, context=None):
            return self.backend(req, timeout, context)

        urllib.request.urlopen = routed
        self.addCleanup(setattr, urllib.request, "urlopen", real)

    def test_missing_s9_env_is_an_explicit_parser_error(self):
        env = {"G12_SESSION": "s", "G12_CSRF": "c", "G12_ACCOUNT": "a",
               "G12_S9_LOGIN_A": S9A}   # LOGIN_B + both passwords missing
        err = io.StringIO()
        with mock.patch.dict(os.environ, env, clear=True), \
                mock.patch("sys.argv",
                           ["workload.py", "--scenario", "s9"]), \
                contextlib.redirect_stderr(err):
            with self.assertRaises(SystemExit) as caught:
                workload.main()
        self.assertEqual(caught.exception.code, 2)
        self.assertIn("G12_S9_LOGIN_B", err.getvalue())
        self.assertIn("G12_S9_PASSWORD_A", err.getvalue())
        self.assertIn("G12_S9_PASSWORD_B", err.getvalue())

    def test_main_dispatch_prints_s9_shape(self):
        env = {"G12_SESSION": "HARNESS-SESS", "G12_CSRF": "HARNESS-CSRF",
               "G12_ACCOUNT": "9000001", "G12_S9_LOGIN_A": S9A,
               "G12_S9_LOGIN_B": S9B, "G12_S9_PASSWORD_A": S9_PASSWORD,
               "G12_S9_PASSWORD_B": S9_PASSWORD,
               "G12_S9_BUDGET_SECONDS": "30"}
        out = io.StringIO()
        with mock.patch.dict(os.environ, env, clear=True), \
                mock.patch("sys.argv",
                           ["workload.py", "--scenario", "s9",
                            "--base", "http://backend"]), \
                contextlib.redirect_stdout(out):
            rc = workload.main()
        self.assertEqual(rc, 0)
        doc = json.loads(out.getvalue())
        self.assertEqual(set(doc), {"scenario", "s9"})
        self.assertEqual(doc["scenario"], "s9")
        self.assertEqual(doc["s9"]["public_calls"], 22)
        self.assertEqual(doc["s9"]["g12_probe"]["status"], 200)
        self.assertEqual(doc["s9"]["trusted_revoked"]["next_step"],
                         "TOTP_REQUIRED")


class RunScenarioS8StubTest(unittest.TestCase):
    """S8 two-phase probe client (VC-R140) against a stubbed Client: the
    prepare phase must fail explicitly without a live delta (the kill gate
    stays closed), the verify phase must accept only the recovered
    FAILED_FINAL with the public external-failed fault bucket, must fail
    closed (no health-control write) whenever the original's checks are
    not clean, must never re-POST the original generation, and must not
    let a passing health control mask the original gid's terminal."""

    def setUp(self):
        self._real_client = workload.Client

    def install(self, stub):
        workload.Client = stub
        self.addCleanup(setattr, workload, "Client", self._real_client)

    @staticmethod
    def args(**overrides):
        import argparse
        base = dict(
            base="http://127.0.0.1:1", session="s", csrf="c", account="a",
            origin=None, cacert=None, scenario="s8-prepare",
            key_prefix="t", sse_timeout=30.0, s8_generation_id="",
            s8_conversation_id="", s8_recovery_timeout=5.0)
        base.update(overrides)
        return argparse.Namespace(**base)

    def make_stub(self, *, probe=None, snapshots=None, post_terminal=None,
                  histories=None, health_gid="43",
                  health_terminal="chat.completed"):
        instances = []

        class Stub:
            def __init__(self, *a, **k):
                instances.append(self)
                self.sends = []

            def json(self, method, path, body=None, timeout=30.0):
                if method == "PUT" and path == "/api/v1/consents":
                    return 200, {}
                if path == "/api/v1/relationships":
                    return 200, {"relationshipId": "rel"}
                if path == "/api/v1/conversations":
                    return 200, {"conversationId": "7"}
                if path.startswith("/api/v1/generations/") \
                        and path.endswith("/snapshot"):
                    gid_key = path[len("/api/v1/generations/"):-len("/snapshot")]
                    seq = (snapshots or {}).get(gid_key)
                    if not seq:
                        return 200, {"status": "FAILED_FINAL",
                                     "events": [{"event": "chat.failed",
                                                 "fault": "external-failed"}]}
                    item = seq.pop(0) if len(seq) > 1 else seq[0]
                    return 200, item
                raise AssertionError(path)

            def send(self, conv, key, text):
                self.sends.append(key)
                return 202, {"generationId": "42" if key.endswith("-orig")
                             else health_gid}

            def messages(self, conv):
                if histories:
                    return 200, histories.pop(0)
                return 200, []

            def subscribe_until_live_delta(self, gid, timeout=30.0):
                return probe or {"got_delta": True, "catchup_chars": 0,
                                 "deltas_seen": 1, "attempts": 1,
                                 "reason": None}

            def subscribe_snapshot_terminal(self, gid, timeout=30.0):
                return {"first_snapshot_text": None,
                        "first_snapshot_chars": 0,
                        "terminal": post_terminal or "chat.failed",
                        "ok": False, "attempts": 1}

            def sse(self, gid, timeout=30.0):
                ok = health_terminal == "chat.completed"
                return sse_result(terminal=health_terminal, ok=ok)

        return Stub, instances

    def test_prepare_records_ids_and_live_delta(self):
        stub_cls, _ = self.make_stub()
        self.install(stub_cls)
        result = workload.run_scenario_s8_prepare(self.args(), workload.Stats())
        self.assertEqual(result["generation_id"], "42")
        self.assertEqual(result["conversation_id"], "7")
        self.assertTrue(result["got_live_delta"])
        self.assertEqual(result["error_count"], 0)

    def test_prepare_without_live_delta_is_an_explicit_failure(self):
        # A replayed terminal instead of a live delta must never enter a
        # kill phase: got_live_delta False + a recorded reason/error.
        stub_cls, _ = self.make_stub(
            probe={"got_delta": False, "catchup_chars": None,
                   "deltas_seen": 0, "attempts": 2,
                   "reason": "terminal:chat.completed"})
        self.install(stub_cls)
        stats = workload.Stats()
        result = workload.run_scenario_s8_prepare(self.args(), stats)
        self.assertFalse(result["got_live_delta"])
        self.assertEqual(result["reason"], "terminal:chat.completed")
        self.assertEqual(result["error_count"], 1)
        self.assertIn("no live delta", stats.errors[0])

    def test_verify_happy_path_recovery_and_single_health_send(self):
        stub_cls, instances = self.make_stub(
            snapshots={"42": [{"status": "FAILED_FINAL",
                               "events": [{"event": "chat.failed",
                                           "fault": "external-failed"}]}],
                       "43": [{"status": "COMPLETED", "events": []}]},
            histories=[[], [{"role": "assistant", "content": "done"}]])
        self.install(stub_cls)
        result = workload.run_scenario_s8_verify(
            self.args(scenario="s8-verify", s8_generation_id="42",
                      s8_conversation_id="7"),
            workload.Stats())
        original, health = result["original"], result["health"]
        self.assertEqual(result["error_count"], 0)
        self.assertEqual(original["status"], "FAILED_FINAL")
        self.assertTrue(original["failed_fault_ok"])
        self.assertEqual(original["failed_fault"], "external-failed")
        self.assertEqual(original["post_terminal"], "chat.failed")
        self.assertEqual(original["assistant_messages"], 0)
        self.assertEqual(original["status_after_health"], "FAILED_FINAL")
        self.assertEqual(health["terminal"], "chat.completed")
        self.assertTrue(health["completed_ok"])
        self.assertEqual(health["snapshot_status"], "COMPLETED")
        self.assertEqual(health["assistant_messages"], 1)
        # Exactly ONE send ever — the health control; the original
        # generation is never cancelled or re-POSTed.
        self.assertEqual(instances[0].sends, ["t-health"])

    def test_verify_wrong_fault_fails_closed_without_health_write(self):
        stub_cls, instances = self.make_stub(
            snapshots={"42": [{"status": "FAILED_FINAL",
                               "events": [{"event": "chat.failed"}]}]})
        self.install(stub_cls)
        stats = workload.Stats()
        result = workload.run_scenario_s8_verify(
            self.args(scenario="s8-verify", s8_generation_id="42",
                      s8_conversation_id="7"),
            stats)
        self.assertFalse(result["original"]["failed_fault_ok"])
        self.assertEqual(result["error_count"], 1)
        self.assertIn("fault", stats.errors[0])
        # Fail closed: a dirty original verdict means no health-control
        # write is issued at all.
        self.assertEqual(instances[0].sends, [])

    def test_verify_recovery_deadline_never_invents_a_terminal(self):
        stub_cls, instances = self.make_stub(
            snapshots={"42": [{"status": "IN_PROGRESS", "events": []}]})
        self.install(stub_cls)
        stats = workload.Stats()
        result = workload.run_scenario_s8_verify(
            self.args(scenario="s8-verify", s8_generation_id="42",
                      s8_conversation_id="7", s8_recovery_timeout=0.3),
            stats)
        self.assertNotEqual(result["original"]["status"], "FAILED_FINAL")
        self.assertEqual(result["error_count"], 1)
        self.assertIn("FAILED_FINAL", stats.errors[0])
        self.assertEqual(instances[0].sends, [])

    def test_verify_late_terminal_is_rejected(self):
        # A FAILED_FINAL answered PAST the absolute budget is discarded:
        # the fake clock advances beyond the deadline inside the stub's
        # json(), so the verify loop must refuse the late terminal instead
        # of adopting it — and no health-control write may follow.
        clock = FakeClock()
        real_time = workload.time
        workload.time = clock
        self.addCleanup(setattr, workload, "time", real_time)
        sent = []

        class LateStub:
            def __init__(self, *a, **k):
                self.calls = 0

            def json(self, method, path, body=None, timeout=30.0):
                if method == "PUT" and path == "/api/v1/consents":
                    return 200, {}
                if path == "/api/v1/relationships":
                    return 200, {"relationshipId": "rel"}
                if path == "/api/v1/conversations":
                    return 200, {"conversationId": "7"}
                if path.endswith("/snapshot"):
                    self.calls += 1
                    # The answer lands past the absolute budget.
                    clock.advance(100.0)
                    return 200, {"status": "FAILED_FINAL",
                                 "events": [{"event": "chat.failed",
                                             "fault": "external-failed"}]}
                raise AssertionError(path)

            def send(self, conv, key, text):
                sent.append(key)
                raise AssertionError("health sent after a late terminal")

        stub = LateStub
        self.install(stub)
        stats = workload.Stats()
        result = workload.run_scenario_s8_verify(
            self.args(scenario="s8-verify", s8_generation_id="42",
                      s8_conversation_id="7", s8_recovery_timeout=5.0),
            stats)
        self.assertIsNone(result["original"]["status"])
        self.assertEqual(result["error_count"], 2)
        self.assertIn("after the recovery budget", stats.errors[0])
        self.assertIn("FAILED_FINAL", stats.errors[1])
        self.assertEqual(sent, [])

    def test_verify_assistant_before_health_fails_closed(self):
        stub_cls, instances = self.make_stub(
            histories=[[{"role": "assistant", "content": "rogue"}]])
        self.install(stub_cls)
        result = workload.run_scenario_s8_verify(
            self.args(scenario="s8-verify", s8_generation_id="42",
                      s8_conversation_id="7"),
            workload.Stats())
        self.assertEqual(result["original"]["assistant_messages"], 1)
        self.assertEqual(result["error_count"], 1)
        self.assertEqual(instances[0].sends, [])

    def test_verify_health_control_cannot_mask_the_original(self):
        # After the control completes, the original must STILL be
        # FAILED_FINAL; anything else is recorded as a masking failure even
        # though the control itself succeeded.
        stub_cls, _ = self.make_stub(
            snapshots={"42": [{"status": "FAILED_FINAL",
                               "events": [{"event": "chat.failed",
                                           "fault": "external-failed"}]},
                              {"status": "COMPLETED", "events": []}],
                       "43": [{"status": "COMPLETED", "events": []}]},
            histories=[[], [{"role": "assistant", "content": "done"}]])
        self.install(stub_cls)
        result = workload.run_scenario_s8_verify(
            self.args(scenario="s8-verify", s8_generation_id="42",
                      s8_conversation_id="7"),
            workload.Stats())
        self.assertTrue(result["health"]["completed_ok"])
        self.assertEqual(result["original"]["status_after_health"],
                         "COMPLETED")
        self.assertEqual(result["error_count"], 1)
        self.assertIn("mask", result["errors"][0])

    def test_verify_requires_prepare_ids(self):
        err = io.StringIO()
        with mock.patch.dict(os.environ,
                             {"G12_SESSION": "s", "G12_CSRF": "c",
                              "G12_ACCOUNT": "a"}, clear=True), \
                mock.patch("sys.argv",
                           ["workload.py", "--scenario", "s8-verify"]), \
                contextlib.redirect_stderr(err):
            with self.assertRaises(SystemExit) as caught:
                workload.main()
        self.assertEqual(caught.exception.code, 2)
        self.assertIn("s8-generation-id", err.getvalue())


if __name__ == "__main__":
    unittest.main(verbosity=2)

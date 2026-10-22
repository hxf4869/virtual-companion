#!/usr/bin/env python3
"""Behavioral regression for the G12 fake provider's stream-outcome
counters (VC-R62 §19.1 S6).

Run: python3 scripts/measure/g12-go-capacity/test_fake_provider.py

The provider must distinguish a backend-driven mid-reply disconnect from a
natural finish: abortedStreamRequests counts streams whose client closed
the connection before the reply was fully written (the parts loop stops
immediately — no further content chunks are written to the dead socket),
while completedStreamRequests counts streams that wrote their full reply
and [DONE]. A normal close after response.end() is a completion, never an
abort. This is the fixture-side half of the S6 cancel proof: run.sh
asserts exactly one abort (the cancelled generation) and one completion
(the disconnect/reconnect generation) per probe, and that the aborted
stream stopped before writing all its content chunks.

Spawns the real fake_provider.mjs on a loopback ephemeral port with fast
timing knobs via PUT /g12/config; no Docker, no external network. Node
must be on PATH: a missing node is an explicit test FAILURE (a skip here
would let the fixture's abort accounting regress silently).
"""

import http.client
import json
import os
import shutil
import socket
import subprocess
import sys
import time
import unittest
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
NODE = shutil.which("node")


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class FakeProviderStreamOutcomeTest(unittest.TestCase):
    provider_port: int
    proc: subprocess.Popen

    @classmethod
    def setUpClass(cls):
        if NODE is None:
            raise AssertionError(
                "node is not on PATH: the fake provider behavioral "
                "regression requires node (a missing node must fail "
                "loudly, not be skipped)")
        cls.provider_port = free_port()
        env = dict(os.environ,
                   E2E_PROVIDER_HOST="127.0.0.1",
                   E2E_PROVIDER_PORT=str(cls.provider_port),
                   G12_FIRST_TOKEN_MS="30", G12_DELTA_MS="10",
                   G12_CHUNKS="4", G12_HOLD_MS="0")
        cls.proc = subprocess.Popen(
            [NODE, str(HERE / "fake_provider.mjs")], env=env,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            start_new_session=True)
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            try:
                with urllib.request.urlopen(
                        f"http://127.0.0.1:{cls.provider_port}/health",
                        timeout=1) as resp:
                    if json.loads(resp.read()).get("status") == "UP":
                        return
            except Exception:
                time.sleep(0.1)
        cls.tearDownClass()
        raise AssertionError("fake provider did not come up")

    @classmethod
    def tearDownClass(cls):
        proc = getattr(cls, "proc", None)
        if proc is not None and proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait()

    def config(self, **knobs):
        body = json.dumps(knobs).encode()
        req = urllib.request.Request(
            f"http://127.0.0.1:{self.provider_port}/g12/config",
            data=body, method="PUT",
            headers={"content-type": "application/json"})
        with urllib.request.urlopen(req, timeout=5) as resp:
            return json.loads(resp.read())

    def stats(self) -> dict:
        with urllib.request.urlopen(
                f"http://127.0.0.1:{self.provider_port}/g12/stats",
                timeout=5) as resp:
            return json.loads(resp.read())

    def post_stream(self):
        """Open a streaming completion; returns (conn, resp)."""
        conn = http.client.HTTPConnection("127.0.0.1", self.provider_port,
                                          timeout=15)
        conn.request(
            "POST", "/v1/chat/completions",
            body=json.dumps({"stream": True,
                             "messages": [{"role": "user",
                                           "content": "hi"}]}),
            headers={"content-type": "application/json"})
        return conn, conn.getresponse()

    def test_natural_finish_counts_completed_never_aborted(self):
        cfg = self.config(firstTokenMs=30, deltaMs=10, chunks=4, holdMs=0)
        before = self.stats()
        conn, resp = self.post_stream()
        body = resp.read()          # drain to EOF (the server's [DONE])
        # close the response's buffered reader FIRST: it holds the fd
        # reference, so conn.close() alone leaves the socket half-open
        # and the provider would rightly see nothing.
        resp.close()
        conn.close()                # close AFTER the natural finish
        self.assertIn(b"[DONE]", body)
        after = self._await_counter("completedStreamRequests",
                                    before["completedStreamRequests"] + 1)
        self.assertEqual(after["abortedStreamRequests"],
                         before["abortedStreamRequests"])
        self.assertEqual(after["completedStreamRequests"] -
                         before["completedStreamRequests"], 1)
        self.assertEqual(after["contentChunkWrites"] -
                         before["contentChunkWrites"], cfg["chunks"])

    def test_client_disconnect_mid_reply_aborts_and_stops_chunks(self):
        cfg = self.config(firstTokenMs=30, deltaMs=120, chunks=5, holdMs=0)
        before = self.stats()
        conn, resp = self.post_stream()
        first = resp.read(64)       # receive the first content chunk
        self.assertTrue(first)
        resp.close()                # release the reader's fd reference
        conn.close()                # the backend-style mid-reply abort
        after = self._await_counter("abortedStreamRequests",
                                    before["abortedStreamRequests"] + 1)
        written = after["contentChunkWrites"] - before["contentChunkWrites"]
        self.assertGreaterEqual(written, 1)   # the delta we received
        self.assertLess(written, cfg["chunks"])  # stopped before the end
        self.assertEqual(after["completedStreamRequests"],
                         before["completedStreamRequests"])
        # Once counted, the abort is final: the counter must never grow
        # again for this stream (no further chunk writes either).
        time.sleep(0.3)
        settled = self.stats()
        self.assertEqual(settled["abortedStreamRequests"],
                         after["abortedStreamRequests"])
        self.assertEqual(settled["contentChunkWrites"],
                         after["contentChunkWrites"])

    def _await_counter(self, key: str, want: int, budget: float = 5.0):
        deadline = time.monotonic() + budget
        last = self.stats()
        while time.monotonic() < deadline:
            if last.get(key, -1) >= want:
                return last
            time.sleep(0.05)
            last = self.stats()
        self.fail(f"{key} did not reach {want} (last={last.get(key)})")


if __name__ == "__main__":
    sys.exit(unittest.main(verbosity=2))

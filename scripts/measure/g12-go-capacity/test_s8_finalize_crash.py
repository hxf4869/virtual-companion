#!/usr/bin/env python3
"""Unit regression for the VC-R145 S8 before-finalize crash helper.

Run: python3 scripts/measure/g12-go-capacity/test_s8_finalize_crash.py

Behavior tests over the REAL run_probe flow with faked docker/psql seams
(never a real container): the only path that kills is every-gate-green —
acquire the row lock while the attempt is still CREATED, observe the
SUCCEEDED outcome plus exactly one fresh finalize backend blocked by the
control pid with an UNCHANGED query_start, a fully settled old-epoch
provider, and a binding nonce/running identity check on the exact CID —
and the kill must land (exit 137 proven) BEFORE the control transaction
is released. Every failure path (wrong owner, lock too late, gate
budget expiry, worker retry, unsettled provider, identity mismatch,
kill state not 137, mid-flow exceptions) must release the lock, reap
both sessions and exit nonzero. Failures before issuing the kill cannot
kill; an issued kill that is late or unproven never passes.
"""

import argparse
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional
from unittest import mock

import s8_finalize_crash
from s8_finalize_crash import (KILL_WINDOW_S, ProbeError, SQLSession,
                               gate_reason, provider_gate_reason, run_probe)

CONTROL_PID = 4242
GID = 501
OWNER = 2000001
Q_START_1 = "2026-10-23 10:00:24.1"
Q_START_2 = "2026-10-23 10:00:26.9"


def blocked_finalizer(query_start: str = Q_START_1, query_age: float = 0.3,
                      control_pid: int = CONTROL_PID,
                      xact_age: Optional[float] = None) -> Dict[str, Any]:
    return {"pid": 777, "query_start": query_start, "query_age": query_age,
            "xact_age": query_age if xact_age is None else xact_age,
            "wait_event_type": "Lock",
            "wait_event": "transactionid", "blockers": [control_pid],
            "kind": "finalize", "attempt_insert_lock": False}


def created_state() -> Dict[str, Any]:
    return {"generation_status": "IN_PROGRESS", "assistant_null": True,
            "attempts": ["CREATED"], "outcome_age": None,
            "job_status": "CLAIMED", "lease_live": True, "blocked": []}


def good_state(query_start: str = Q_START_1, query_age: float = 0.3,
               outcome_age: float = 0.2,
               xact_age: Optional[float] = None) -> Dict[str, Any]:
    return {"generation_status": "IN_PROGRESS", "assistant_null": True,
            "attempts": ["SUCCEEDED"], "outcome_age": outcome_age,
            "job_status": "CLAIMED", "lease_live": True,
            "blocked": [blocked_finalizer(query_start=query_start,
                                          query_age=query_age,
                                          xact_age=xact_age)]}


def settled_provider() -> Dict[str, Any]:
    return {"streamRequests": 1, "completedStreamRequests": 1,
            "abortedStreamRequests": 0, "activeStreamRequests": 0}


def ok_identity() -> Dict[str, str]:
    return {"id": "cidRT", "running": "true", "nonce": "n0"}


class FakeClock:
    def __init__(self, values: List[float]):
        self.values = list(values)
        self.i = 0
        self.offset = 0.0

    def advance(self, seconds: float) -> None:
        self.offset += seconds

    def __call__(self) -> float:
        value = self.values[self.i] if self.i < len(self.values) \
            else self.values[-1]
        self.i += 1
        return value + self.offset


class FakeSession:
    def __init__(self, name: str, events: List[tuple],
                 responses: List[tuple]):
        self.name = name
        self.responses = responses
        self.events = events
        self.closed = False
        self.info: Dict[str, Any] = {"name": name, "host_pid": 90001,
                                     "backend_pid": CONTROL_PID,
                                     "reaped": False}

    def query(self, sql: str, timeout: float = 0.0) -> Dict[str, Any]:
        for needle, value in self.responses:
            if needle in sql:
                self.events.append(("sql", f"{self.name}:{needle}"))
                return value() if callable(value) else value
        raise AssertionError(f"unexpected query: {sql[:80]}")

    def close(self) -> None:
        if self.closed:
            return
        self.closed = True
        self.events.append(("close", self.name))
        self.info["reaped"] = True


class FakeIO:
    def __init__(self, states: List[Dict[str, Any]],
                 provider: Dict[str, Any], identities: List[Any],
                 locked: Any = GID, killed_state: str = "exited 137 0",
                 kill_error: Optional[Exception] = None,
                 provider_error: Optional[Exception] = None,
                 clock: Optional[FakeClock] = None,
                 identity_advances: Optional[List[float]] = None,
                 kill_return_advance: float = 0.0,
                 state_advances: Optional[List[float]] = None):
        self.events: List[tuple] = []
        self.sessions: List[FakeSession] = []
        self._states = list(states)
        self._provider = provider
        self._identities = list(identities)
        self._locked = locked
        self._killed_state = killed_state
        self._kill_error = kill_error
        self._provider_error = provider_error
        self._clock = clock
        self._identity_advances = list(identity_advances or [])
        self._kill_return_advance = kill_return_advance
        self._state_advances = list(state_advances or [])
        self.kills: List[str] = []
        self.budgets: List[float] = []

    def open_session(self, name: str) -> FakeSession:
        if "control" in name:
            responses = [("FOR UPDATE", {"locked": self._locked}),
                         ("ROLLBACK; SELECT", {"released": True})]
        else:
            responses = [("generation_status", self._next_state),
                         ("absent", {"absent": True})]
        session = FakeSession(name, self.events, responses)
        self.sessions.append(session)
        return session

    def _next_state(self) -> Dict[str, Any]:
        if self._state_advances and self._clock is not None:
            self._clock.advance(self._state_advances.pop(0))
        if len(self._states) > 1:
            return self._states.pop(0)
        return self._states[0]

    def provider_stats(self) -> Dict[str, Any]:
        if self._provider_error is not None:
            raise self._provider_error
        return self._provider

    def identity(self, runtime_cid: str) -> Dict[str, str]:
        value = self._identities.pop(0)
        if isinstance(value, Exception):
            raise value
        if self._identity_advances and self._clock is not None:
            self._clock.advance(self._identity_advances.pop(0))
        self.events.append(("identity", runtime_cid))
        return value

    def kill(self, runtime_cid: str, budget_s: float) -> None:
        self.budgets.append(budget_s)
        if self._kill_error is not None:
            raise self._kill_error
        if self._kill_return_advance and self._clock is not None:
            self._clock.advance(self._kill_return_advance)
        self.kills.append(runtime_cid)
        self.events.append(("kill", runtime_cid))

    def killed_state(self, runtime_cid: str) -> str:
        self.events.append(("killed_state", runtime_cid))
        return self._killed_state


def make_args(out: Path, gate_budget: float = 60.0) -> argparse.Namespace:
    return argparse.Namespace(
        compose_envfile="compose.env", compose_file="stack.compose.json",
        project="vcg12c-test", provider_port=19091, owner=OWNER,
        generation_id=GID, runtime_cid="cidRT", nonce="n0",
        baseline_streams=0, baseline_aborted=0, baseline_completed=0,
        gate_budget=gate_budget, out=str(out))


def success_flow(out: Path, **io_kwargs) -> tuple:
    """Standard green-gate wiring: lock while CREATED, one matching
    observation, binding identity, a final matching gate with the SAME
    query_start, then the kill inside the window bound. Clock call order:
    started, gate-start, loop check, first-read t0/t1, final-read t0/t1,
    pre-kill bound check, kill return, total."""
    io = FakeIO(states=[created_state(), good_state(), good_state()],
                provider=settled_provider(),
                identities=[ok_identity(), ok_identity()], **io_kwargs)
    args = make_args(out)
    clock = FakeClock([0.0, 0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 1.0, 1.5])
    report = run_probe(args, io, clock=clock)
    return report, io


class SuccessPathTests(unittest.TestCase):
    def test_kills_only_after_all_gates_then_releases(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "report.json"
            report, io = success_flow(out)
            self.assertEqual(report["status"], "KILLED")
            self.assertIsNone(report["reason"])
            self.assertTrue(report["kill_issued"])
            # exactly one kill, of the exact receipt CID, exit 137 proven,
            # with a wait budget inside the untouched finalize window
            self.assertEqual(io.kills, ["cidRT"])
            self.assertEqual(len(io.budgets), 1)
            self.assertGreater(io.budgets[0], 0.0)
            self.assertLessEqual(io.budgets[0], KILL_WINDOW_S)
            self.assertEqual(report["killed"]["cid"], "cidRT")
            self.assertEqual(report["killed"]["state"], "exited 137 0")
            # kill BEFORE the control lock release; absence check after it
            kill_at = io.events.index(("kill", "cidRT"))
            release_at = io.events.index(
                ("sql", "r145-bf-control:ROLLBACK; SELECT"))
            absent_at = io.events.index(("sql", "r145-bf-observe:absent"))
            self.assertLess(kill_at, release_at)
            self.assertLess(release_at, absent_at)
            self.assertTrue(report["control_backend_absent"])
            # evidence recorded under the lock
            self.assertEqual(report["initial_after_lock"]["attempts"],
                             ["CREATED"])
            self.assertEqual(report["gate_observation"]["attempts"],
                             ["SUCCEEDED"])
            self.assertEqual(report["reobserve"]["blocked"][0]["query_start"],
                             Q_START_1)
            self.assertEqual(report["provider_at_gate"], settled_provider())
            # window bookkeeping: bound below the DEFAULT 5 s tx window at
            # gate, kill issue and kill return; hit-to-kill measured
            timings = report["timings"]
            self.assertEqual(timings["finalize_window_s"], KILL_WINDOW_S)
            # the basis is the OLDEST of query/xact/outcome age per read
            self.assertEqual(timings["finalize_age_basis_first_read_s"], 0.3)
            self.assertEqual(timings["finalize_age_basis_final_read_s"], 0.3)
            self.assertLessEqual(
                timings["finalize_age_upper_at_gate_s"], KILL_WINDOW_S)
            self.assertLessEqual(
                timings["finalize_age_upper_at_kill_issued_s"], KILL_WINDOW_S)
            self.assertLessEqual(
                timings["finalize_age_upper_at_kill_returned_s"],
                KILL_WINDOW_S)
            # the docker wait budget IS the remaining window at issue time
            self.assertAlmostEqual(
                KILL_WINDOW_S - timings["finalize_age_upper_at_kill_issued_s"],
                io.budgets[0])
            self.assertGreater(timings["hit_to_kill_s"], 0.0)
            self.assertGreater(timings["lock_to_gate_s"], 0.0)
            self.assertGreater(timings["total_s"], 0.0)
            # both direct children reaped and the report persisted
            self.assertTrue(all(c["reaped"] for c in report["connections"]))
            self.assertEqual([c["name"] for c in report["connections"]],
                             ["r145-bf-control", "r145-bf-observe"])
            self.assertEqual(json.loads(out.read_text()), report)


class NoKillFailurePathTests(unittest.TestCase):
    def run_flow(self, io: FakeIO, out: Path,
                 clock: Optional[FakeClock] = None,
                 **args_kwargs) -> Dict[str, Any]:
        return run_probe(make_args(out, **args_kwargs), io,
                         clock=clock or FakeClock(
                             [0.0, 0.5, 0.6, 0.7, 0.7, 0.7, 0.7, 0.7,
                              0.7, 0.7]))

    def assert_aborted(self, report: Dict[str, Any], io: FakeIO,
                       reason: str):
        self.assertEqual(report["status"], "ABORTED")
        self.assertEqual(report["reason"], reason)
        self.assertEqual(io.kills, [])
        # every failure BEFORE the kill was issued: nothing was killed
        self.assertFalse(report["kill_issued"])

    def test_wrong_owner_never_kills(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "r.json"
            io = FakeIO(states=[created_state()], provider={},
                        identities=[ok_identity()], locked=None)
            report = self.run_flow(io, out)
            self.assert_aborted(report, io, "LOCK_MISMATCH")
            self.assertTrue(all(s.closed for s in io.sessions))

    def test_lock_acquired_after_outcome_never_kills(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "r.json"
            io = FakeIO(states=[good_state()], provider=settled_provider(),
                        identities=[ok_identity()])
            report = self.run_flow(io, out)
            self.assert_aborted(report, io, "C_LOCK_TOO_LATE")

    def test_gate_budget_expiry_never_kills(self):
        # The finalize never blocks correctly (the observation keeps
        # failing the gate): the budget must abort the flow, not spin.
        # Clock: started, gate-start, then each loop iteration consumes
        # check + read-t0/read-t1 until the deadline check fails.
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "r.json"
            io = FakeIO(states=[created_state(), created_state()],
                        provider=settled_provider(),
                        identities=[ok_identity()])
            clock = FakeClock([0.0, 0.0, 1.0, 1.0, 1.0, 3.0])
            report = self.run_flow(io, out, clock=clock, gate_budget=2.0)
            self.assert_aborted(report, io, "GATE_BUDGET")

    def test_worker_retry_never_kills(self):
        # The finalize tx timed out and the worker retried between the two
        # observations: a different query_start must fail the gate.
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "r.json"
            io = FakeIO(states=[created_state(), good_state(),
                                good_state(query_start=Q_START_2)],
                        provider=settled_provider(),
                        identities=[ok_identity(), ok_identity()])
            report = self.run_flow(io, out)
            self.assert_aborted(report, io, "GATE_LOST_worker_retried")

    def test_unsettled_provider_never_kills(self):
        # An abort on the old epoch means the provider did NOT finish
        # cleanly before the crash — no kill on that state.
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "r.json"
            stats = settled_provider()
            stats["abortedStreamRequests"] = 1
            io = FakeIO(states=[created_state(), good_state()],
                        provider=stats, identities=[ok_identity()])
            report = self.run_flow(io, out)
            self.assert_aborted(report, io, "provider_not_settled")

    def test_binding_identity_mismatch_after_gates_never_kills(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "r.json"
            io = FakeIO(states=[created_state(), good_state()],
                        provider=settled_provider(),
                        identities=[ok_identity(),
                                    {"id": "cidRT", "running": "true",
                                     "nonce": "OTHER"}])
            report = self.run_flow(io, out)
            self.assert_aborted(report, io, "IDENTITY")

    def test_identity_slowdown_stales_final_gate_never_kills(self):
        # The binding identity check takes too long (fake clock advanced
        # 4 s): the real finalize backend keeps running, so the LAST gate
        # read comes back with a stale query_age and the flow must abort
        # BEFORE the kill — a slow pre-kill step can never be absorbed.
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "r.json"
            clock = FakeClock([0.0, 0.5, 0.6, 0.7, 0.7, 0.7, 0.7, 0.7,
                               0.7, 0.7])
            io = FakeIO(states=[created_state(), good_state(),
                                good_state(query_age=4.4)],
                        provider=settled_provider(),
                        identities=[ok_identity(), ok_identity()],
                        clock=clock, identity_advances=[0.0, 4.0])
            report = self.run_flow(io, out, clock=clock)
            self.assert_aborted(report, io, "GATE_LOST_query_age")
            self.assertIn(("identity", "cidRT"), io.events)

    def test_kill_returned_past_window_is_not_a_pass(self):
        # The kill was ISSUED (its budget was inside the window) but the
        # fake clock shows it returned after the conservative bound: the
        # first-window crash point can no longer be proven — ABORTED, not
        # KILLED, no PASS.
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "r.json"
            clock = FakeClock([0.0, 0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9,
                               0.95, 0.95])
            io = FakeIO(states=[created_state(), good_state()],
                        provider=settled_provider(),
                        identities=[ok_identity(), ok_identity()],
                        clock=clock, kill_return_advance=4.0)
            report = self.run_flow(io, out, clock=clock)
            self.assertEqual(io.kills, ["cidRT"])  # the kill WAS issued
            self.assertTrue(report["kill_issued"])
            self.assertGreater(io.budgets[0], 0.0)
            self.assertEqual(report["status"], "ABORTED")
            self.assertEqual(report["reason"], "KILL_RETURNED_LATE")
            self.assertIn(("close", "r145-bf-control"), io.events)
            self.assertTrue(all(s.closed for s in io.sessions))

    def test_old_xact_and_outcome_age_cap_window_despite_tiny_query_age(self):
        # Root counterexample: the blocked statement is young (query_age
        # 0.2) but the transaction and the committed outcome are already
        # 3.3 s old. The window basis must be the OLDEST age, so the kill
        # deadline sits 0.2 s after the read was sent (3.5 − 3.3): a kill
        # issued just inside it with a slow return (+1 s) is ISSUED but
        # can never be recorded as a PASS. The gate itself still accepts
        # the state (query_age ≤ 2.5, outcome_age ≤ 3.5), so this is the
        # window bound — not the gate — refusing the first-window claim.
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "r.json"
            old = dict(query_age=0.2, xact_age=3.3, outcome_age=3.3)
            # Both reads start at 0; the final SQL round-trip consumes
            # 0.16 s of the 0.2 s remainder, leaving the same 0.04 s
            # budget. Time advances at I/O, independently of clock reads.
            clock = FakeClock([0.0])
            io = FakeIO(states=[created_state(), good_state(**old),
                                good_state(**old)],
                        provider=settled_provider(),
                        identities=[ok_identity(), ok_identity()],
                        clock=clock, state_advances=[0.0, 0.0, 0.16],
                        kill_return_advance=1.0)
            report = self.run_flow(io, out, clock=clock)
            self.assertEqual(io.kills, ["cidRT"])
            self.assertTrue(report["kill_issued"])
            self.assertAlmostEqual(io.budgets[0], 0.04)
            self.assertEqual(report["status"], "ABORTED")
            self.assertEqual(report["reason"], "KILL_RETURNED_LATE")
            timings = report["timings"]
            self.assertEqual(timings["finalize_age_basis_first_read_s"], 3.3)
            self.assertEqual(timings["finalize_age_basis_final_read_s"], 3.3)
            self.assertAlmostEqual(
                timings["finalize_age_upper_at_kill_issued_s"], 3.46)
            self.assertGreater(
                timings["finalize_age_upper_at_kill_returned_s"],
                KILL_WINDOW_S)
            self.assertIn(("close", "r145-bf-control"), io.events)

    def test_first_read_deadline_is_never_reset_by_a_fresher_last_read(self):
        # The first gate read already put the tx at 0.3 s; a long gap
        # before the last read (which still reports the static fake 0.3 s)
        # must NOT re-open the window: the binding deadline is the earlier
        # first-read one, so the pre-kill check refuses to issue at all.
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "r.json"
            # First read is at 0 with deadline 3.2; the binding
            # identity check consumes 4 s. A static, falsely fresh last
            # observation cannot reset that first deadline to 7.2.
            clock = FakeClock([0.0])
            io = FakeIO(states=[created_state(), good_state(), good_state()],
                        provider=settled_provider(),
                        identities=[ok_identity(), ok_identity()],
                        clock=clock, identity_advances=[0.0, 4.0])
            report = self.run_flow(io, out, clock=clock)
            self.assert_aborted(report, io, "KILL_WINDOW_EXHAUSTED")
            self.assertEqual(io.budgets, [])

    def test_precheck_identity_mismatch_never_touches_db(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "r.json"
            io = FakeIO(states=[], provider=settled_provider(),
                        identities=[{"id": "cidFOREIGN", "running": "true",
                                     "nonce": "n0"}])
            report = self.run_flow(io, out)
            self.assert_aborted(report, io, "IDENTITY_PRECHECK")
            self.assertEqual(io.sessions, [])

    def test_kill_state_not_137_still_releases(self):
        # The kill was issued and returned inside the window, but its
        # effect could not be proven 137: nonzero, lock released (the
        # control close() models the real ROLLBACK + \q + reap), children
        # reaped, run.sh must fail.
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "r.json"
            io = FakeIO(states=[created_state(), good_state()],
                        provider=settled_provider(),
                        identities=[ok_identity(), ok_identity()],
                        killed_state="exited 143 0")
            report = self.run_flow(io, out)
            self.assertEqual(io.kills, ["cidRT"])
            self.assertTrue(report["kill_issued"])
            self.assertEqual(report["status"], "ABORTED")
            self.assertEqual(report["reason"], "KILL_STATE_exited_143_0")
            self.assertIn(("close", "r145-bf-control"), io.events)
            self.assertTrue(all(s.closed for s in io.sessions))

    def test_midflow_exceptions_release_without_kill(self):
        # RuntimeError/PROVIDER failures happen BEFORE the kill is issued:
        # nothing killed. A KILL spawn failure happens AFTER the CLI was
        # spawned: reported as issued-but-unproven (never "not killed"),
        # and in every case the lock is released and children reaped.
        pre_kill_cases = [
            ("RuntimeError",
             dict(identities=[ok_identity(), RuntimeError("exec died")])),
            ("PROVIDER_REQUEST_FAILED",
             dict(identities=[ok_identity()],
                  provider_error=ProbeError("PROVIDER_REQUEST_FAILED"))),
        ]
        for reason, kwargs in pre_kill_cases:
            with self.subTest(reason=reason):
                with tempfile.TemporaryDirectory() as tmp:
                    out = Path(tmp) / "r.json"
                    io = FakeIO(states=[created_state(), good_state()],
                                provider=settled_provider(), **kwargs)
                    report = self.run_flow(io, out)
                    self.assert_aborted(report, io, reason)
                    self.assertIn(("close", "r145-bf-control"), io.events)
                    self.assertIn(("close", "r145-bf-observe"), io.events)
                    self.assertTrue(
                        all(c["reaped"] for c in report["connections"]))
        with self.subTest(reason="kill spawn failure is issued-unproven"):
            with tempfile.TemporaryDirectory() as tmp:
                out = Path(tmp) / "r.json"
                io = FakeIO(states=[created_state(), good_state()],
                            provider=settled_provider(),
                            identities=[ok_identity(), ok_identity()],
                            kill_error=ProbeError("DOCKER_KILL_FAILED"))
                report = self.run_flow(io, out)
                self.assertEqual(report["status"], "ABORTED")
                self.assertEqual(report["reason"],
                                 "KILL_UNPROVEN_DOCKER_KILL_FAILED")
                self.assertTrue(report["kill_issued"])
                self.assertEqual(io.kills, [])
                self.assertIn(("close", "r145-bf-control"), io.events)
                self.assertTrue(
                    all(c["reaped"] for c in report["connections"]))


# A minimal local stand-in for the in-container psql: same controlled-stdin
# discipline (one JSON line per SELECT, ROLLBACK no-op, \q quits). Only the
# COMMAND is routed — the real pipes, selector reads and child reaping run
# for real. No docker, no database.
FAKE_PSQL_SRC = r"""
import sys
for line in sys.stdin:
    cmd = line.strip()
    if cmd == "\\q":
        break
    if cmd.rstrip(";").strip() == "ROLLBACK":
        continue
    if "pg_backend_pid" in cmd:
        print('{"pid": 4321}', flush=True)
    elif "locked" in cmd:
        print('{"locked": 501}', flush=True)
    else:
        print('{"ok": true}', flush=True)
"""


class SQLSessionRealPipeTests(unittest.TestCase):
    def test_query_roundtrip_and_close_reap_over_real_pipes(self):
        # Regression for the missing `import os`: the REAL SQLSession path
        # (stdin write -> selector read -> json parse, then close() ->
        # ROLLBACK + \q + communicate reap) must work against a real local
        # child process, with only the psql command itself rerouted.
        real_popen = subprocess.Popen

        def routed(argv, **kwargs):
            if "psql" in argv:
                return real_popen([sys.executable, "-c", FAKE_PSQL_SRC],
                                  **kwargs)
            return real_popen(argv, **kwargs)

        with mock.patch.object(s8_finalize_crash.subprocess, "Popen",
                               side_effect=routed):
            session = SQLSession(
                ["docker", "--context", "orbstack", "compose"], "test-ctl")
            try:
                self.assertEqual(session.info["backend_pid"], 4321)
                row = session.query(
                    "SELECT json_build_object('locked',id) FROM "
                    "vc.generation FOR UPDATE")
                self.assertEqual(row["locked"], 501)
                ack = session.query(
                    "ROLLBACK; SELECT json_build_object('released',true)")
                self.assertEqual(ack["ok"], True)
                self.assertFalse(session.info["reaped"])
            finally:
                session.close()
        self.assertTrue(session.info["reaped"])
        self.assertEqual(session.p.poll(), 0)
        self.assertEqual(session.info["exit_code"], 0)


class GateEvaluatorTests(unittest.TestCase):
    def test_every_gate_dimension_is_enforced(self):
        base = good_state()
        self.assertIsNone(gate_reason(base, CONTROL_PID, 1.5))
        cases = [
            ("generation_status", {**base, "generation_status": "COMPLETED"}),
            ("assistant_present", {**base, "assistant_null": False}),
            ("attempt_not_succeeded", {**base, "attempts": ["CREATED"]}),
            ("outcome_age", {**base, "outcome_age": 4.2}),
            ("outcome_age", {**base, "outcome_age": None}),
            ("lease", {**base, "lease_live": False}),
            ("blocked_count", {**base, "blocked": []}),
            ("wait_event_type", {**base, "blocked": [
                {**blocked_finalizer(), "wait_event_type": "IO"}]}),
            ("kind", {**base, "blocked": [
                {**blocked_finalizer(), "kind": "prepare"}]}),
            ("query_age", {**base, "blocked": [
                blocked_finalizer(query_age=9.9)]}),
        ]
        for expected, state in cases:
            with self.subTest(gate=expected):
                self.assertEqual(
                    gate_reason(state, CONTROL_PID, 1.5), expected)
        with self.subTest(gate="worker_retried"):
            self.assertEqual(
                gate_reason(base, CONTROL_PID, 1.5, Q_START_2),
                "worker_retried")
        # blockers with a foreign control pid fail even with kind=finalize
        foreign = good_state()
        foreign["blocked"][0]["blockers"] = [9999]
        self.assertEqual(gate_reason(foreign, CONTROL_PID, 1.5), "blockers")

    def test_provider_gate_dimensions(self):
        self.assertIsNone(provider_gate_reason(settled_provider(), 0, 0, 0))
        base = {"streamRequests": 2, "completedStreamRequests": 2,
                "abortedStreamRequests": 1, "activeStreamRequests": 0}
        self.assertIsNone(provider_gate_reason(base, 1, 1, 1))
        self.assertEqual(provider_gate_reason(
            {**base, "activeStreamRequests": 1}, 1, 1, 1),
            "provider_not_settled")
        self.assertEqual(provider_gate_reason(
            {**base, "completedStreamRequests": 1}, 1, 1, 1),
            "provider_not_settled")
        self.assertEqual(provider_gate_reason({}, 1, 1, 1),
                         "provider_stats_unparseable")


if __name__ == "__main__":
    unittest.main()

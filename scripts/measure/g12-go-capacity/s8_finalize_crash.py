#!/usr/bin/env python3
"""VC-R145: crash helper for `run.sh --probe-s8-before-finalize` (FUNCTIONAL_ONLY).

Owns the WHOLE S8 "SUCCEEDED-before-finalize" crash window inside one
process so no step is delegated back to the shell or a human while the
~5 s finalize transaction window is open:

1. open one CONTROL `compose exec -T db psql` session (controlled stdin,
   R144 preflight pattern) and BEGIN + lock THIS run's generation row
   FOR UPDATE while the unique attempt is still CREATED — the same
   acquire-early-then-hold shape the R144 preflight proved live;
2. compactly observe the real crash gates on a second (read-only)
   session: the SUCCEEDED outcome committed independently, the
   generation still IN_PROGRESS with no assistant, the work item CLAIMED
   on an unexpired lease, and exactly ONE companiond backend (filtered
   by usename='vc_runtime_login' AND application_name='companiond')
   blocked in `go_finalize_generation` with wait_event_type='Lock' and
   THIS control pid listed in pg_blocking_pids — ages fresh, and the
   SAME worker query_start across two consecutive observations (a
   changed one means the finalize tx timed out and retried: fail);
3. require the OLD-epoch provider to have fully finished the request
   (completed +1, streams +1, abort unchanged, active 0);
4. re-verify the runtime identity on the EXACT CID from this run's
   created-resources receipt (nonce label + running; never a name or
   label search) BEFORE the last real SQL gate, docker-kill that CID with
   a wait budget capped by the remaining crash window, and confirm the
   post-kill state reads `exited 137 0`;
5. only then ROLLBACK (releasing the row lock) and close/reap both
   direct psql children.

The kill is only ever ISSUED before a conservative deadline on the FIRST
blocked finalize transaction: each gate read anchors "sent at t0, already
running at least max(query_age, xact_age, outcome_age)" and derives
t0 + 3.5 s − that age (margin below the untouched ~5 s DEFAULT tx
window); the binding deadline is the EARLIER of the first and last gate
reads' deadlines, so elapsed time is never reset by a fresher read. If
the deadline has passed when the kill RETURNS, the crash point can no
longer be proven: the report stays ABORTED and is never a PASS. Failure
copy distinguishes the two cases: a `kill_issued: false` abort means
nothing was killed; `kill_issued: true` with a non-KILLED status means
the kill WAS issued but the window could not be proven
(KILL_UNPROVEN_*/KILL_RETURNED_LATE).

Every other failure path (wrong owner, lock too late, stale/mismatched
gate, worker retry, provider mismatch, identity mismatch, interrupt)
releases the lock, reaps the children and exits nonzero WITHOUT killing.
A SIGKILLed helper leaves its psql stdin pipes closed: psql exits, the
backends disconnect and the row lock rolls back on its own, with the
control session's own SET LOCAL idle timeout (45 s) as the in-DB
backstop — run.sh additionally TERM/KILL/reaps the helper PID on every
exit path. No product code, SQL objects, dependency, lease, DB clock or
timeout change: DB tx (5 s), claim lease (270 s) and recovery tick stay
at their defaults — the gates must win the finalize window, never extend
it. Output is structured observations only (ids, counts, ages, timings);
no query text, bodies or credentials.
"""

from __future__ import annotations

import argparse
import json
import os
import selectors
import signal
import subprocess
import sys
import time
from typing import Any, Callable, Dict, List, Optional

# The R144-verified worker filter: the runtime's real login role and the
# companiond application name. The control/observer psql sessions run as
# vc_migrator with r145-* app names, so they can never match it.
WORKER_FILTER = ("a.datname=current_database()"
                 " AND a.usename='vc_runtime_login'"
                 " AND a.application_name='companiond'")

# Freshness bounds. The DEFAULT finalize tx window is ~5 s (untouched);
# a first match at query_age <= 1.5 s plus the bounded provider read,
# re-observation, identity check and kill leaves >= 3.5 s of headroom.
# Real windows are far smaller (R144: the whole gate-to-release fit in
# 0.2 s).
FIRST_QUERY_AGE_MAX_S = 1.5
REOBSERVE_QUERY_AGE_MAX_S = 2.5
OUTCOME_AGE_MAX_S = 3.5
# Conservative upper bound on the age of the FIRST blocked finalize
# transaction. Anchor per SQL read (Root-specified): the OLDEST of the
# three DB-reported ages (query_age / xact_age / outcome_age — the tx and
# the committed outcome can both be far older than the current statement)
# bounds how long that transaction had ALREADY been running when the read
# was issued, and counting from BEFORE the SQL was sent (the read's own
# monotonic t0) keeps the whole round-trip on the bill. Each read thus
# derives an absolute kill deadline (t0 + WINDOW − oldest_age); the FIRST
# read's elapsed window can never be reset by a later read, so the binding
# deadline is the EARLIER of the first and last gate reads' deadlines. The
# kill may only be ISSUED before that deadline (docker wait budget capped
# by the remainder), and if it has passed when the kill RETURNS, the crash
# point can no longer be proven — reported ABORTED, never KILLED/PASS. A
# retried finalize (a NEW tx) is never a substitute: the pinned
# query_start fails such states.
KILL_WINDOW_S = 3.5
POLL_S = 0.04
SQL_TIMEOUT_S = 3.0
PROVIDER_TIMEOUT_S = 2.0
DOCKER_TIMEOUT_S = 5.0

# Same bounded node one-liner shape run.sh uses for provider stats, with a
# tighter socket timeout because the caller is inside the finalize window.
PROVIDER_NODE = (
    "const http=require('http');"
    "const q=http.request({host:'127.0.0.1',port:Number(process.argv[1]),"
    "path:'/g12/stats',method:'GET',timeout:1200,headers:{}},"
    "r=>{let s='';r.on('data',c=>s+=c);r.on('end',()=>{"
    "if(r.statusCode!==200)process.exit(2);process.stdout.write(s);});});"
    "q.on('timeout',()=>q.destroy());q.on('error',()=>process.exit(3));q.end();")


class ProbeError(Exception):
    """Any fail-closed abort; the code is the machine-readable reason."""


def need(ok: Any, code: str) -> None:
    if not ok:
        raise ProbeError(code)


class SQLSession:
    """One `compose exec -T db psql` session with controlled stdin.

    Every query() writes one statement and reads exactly one JSON line
    (SELECT json_build_object(...) discipline, R144 preflight pattern).
    close() rolls back, sends \\q and reaps the direct child, recording
    whether the reap was proven.
    """

    def __init__(self, compose: List[str], name: str):
        argv = compose + ["exec", "-T", "-e", f"PGAPPNAME={name}", "db",
                          "psql", "-XAtq", "-v", "ON_ERROR_STOP=1",
                          "-U", "vc_migrator", "-d", "vc"]
        self.p = subprocess.Popen(argv, stdin=subprocess.PIPE,
                                  stdout=subprocess.PIPE,
                                  stderr=subprocess.PIPE)
        self.buffer = b""
        self.sel = selectors.DefaultSelector()
        self.sel.register(self.p.stdout, selectors.EVENT_READ)
        self.closed = False
        self.info: Dict[str, Any] = {"name": name, "host_pid": self.p.pid,
                                     "backend_pid": None, "reaped": False}
        try:
            row = self.query("SELECT json_build_object('pid',pg_backend_pid())")
            self.info["backend_pid"] = row["pid"]
        except Exception:
            self.close()
            raise

    def query(self, sql: str, timeout: float = SQL_TIMEOUT_S) -> Dict[str, Any]:
        limit = time.monotonic() + timeout
        assert self.p.stdin is not None and self.p.stdout is not None
        self.p.stdin.write((sql + ";\n").encode())
        self.p.stdin.flush()
        while True:
            if b"\n" in self.buffer:
                line, self.buffer = self.buffer.split(b"\n", 1)
                if not line.strip():
                    continue
                need(time.monotonic() < limit, "SQL_LATE_RESULT")
                return json.loads(line)
            left = limit - time.monotonic()
            need(left > 0, "SQL_DEADLINE")
            need(bool(self.sel.select(left)), "SQL_READ_TIMEOUT")
            chunk = os.read(self.p.stdout.fileno(), 65536)
            need(bool(chunk), "SQL_PROCESS_CLOSED")
            self.buffer += chunk

    def close(self) -> None:
        if self.closed:
            return
        self.closed = True
        try:
            if self.p.poll() is None:
                assert self.p.stdin is not None
                self.p.stdin.write(b"ROLLBACK;\n\\q\n")
                self.p.stdin.flush()
            self.p.communicate(timeout=3)
        except (BrokenPipeError, ValueError, subprocess.TimeoutExpired):
            if self.p.poll() is None:
                self.p.terminate()
                try:
                    self.p.communicate(timeout=2)
                except subprocess.TimeoutExpired:
                    self.p.kill()
                    self.p.communicate(timeout=2)
        finally:
            self.sel.close()
            self.info["reaped"] = self.p.poll() is not None
            self.info["exit_code"] = self.p.returncode


def state_sql(owner: int, gid: int, control_pid: int) -> str:
    """The R144 combined observation query (read-only), unchanged in shape:
    generation/attempt/work-item state plus the companiond backends this
    control pid is blocking, with the finalize/prepare kind mapping."""
    return f"""SELECT json_build_object(
 'generation_status',g.status,'assistant_null',g.assistant_message_id IS NULL,
 'attempts',COALESCE((SELECT json_agg(ai.status ORDER BY ai.attempt_no) FROM vc.attempt_intent ai WHERE ai.owner_user_id={owner} AND ai.generation_id=g.id),'[]'::json),
 'outcome_age',(SELECT extract(epoch FROM clock_timestamp()-max(ai.terminal_at)) FROM vc.attempt_intent ai WHERE ai.owner_user_id={owner} AND ai.generation_id=g.id),
 'job_status',wi.status,'lease_live',wi.lease_expires_at>clock_timestamp(),
 'blocked',COALESCE((SELECT json_agg(json_build_object('pid',a.pid,'query_start',a.query_start,'query_age',extract(epoch FROM clock_timestamp()-a.query_start),'xact_age',extract(epoch FROM clock_timestamp()-a.xact_start),'wait_event_type',a.wait_event_type,'wait_event',a.wait_event,'blockers',pg_blocking_pids(a.pid),'kind',CASE WHEN a.query LIKE '%go_prepare_model_attempt%' THEN 'prepare' WHEN a.query LIKE '%go_finalize_generation%' THEN 'finalize' ELSE 'other' END,'attempt_insert_lock',EXISTS(SELECT 1 FROM pg_locks l WHERE l.pid=a.pid AND l.relation='vc.attempt_intent'::regclass AND l.mode='RowExclusiveLock' AND NOT l.granted))) FROM pg_stat_activity a WHERE {WORKER_FILTER} AND {control_pid}=ANY(pg_blocking_pids(a.pid))),'[]'::json)
) FROM vc.generation g JOIN vc.work_item wi ON wi.owner_user_id=g.owner_user_id AND wi.kind='GENERATION' AND wi.ref_id=g.id WHERE g.owner_user_id={owner} AND g.id={gid}"""


def gate_reason(state: Dict[str, Any], control_pid: int,
                max_query_age_s: float,
                prev_query_start: Optional[str] = None) -> Optional[str]:
    """None when every C-point gate holds, else the failing gate's code.

    Pure so the unit tests can drive real gate decisions without docker:
    the SUCCEEDED outcome must be committed and fresh, the generation
    still unfinalized, the lease live, and exactly one fresh companiond
    finalize backend blocked by THIS control pid — optionally pinned to
    a previously seen query_start so a retried finalize can never pass.
    """
    if state.get("generation_status") != "IN_PROGRESS":
        return "generation_status"
    if not state.get("assistant_null"):
        return "assistant_present"
    if state.get("attempts") != ["SUCCEEDED"]:
        return "attempt_not_succeeded"
    outcome_age = state.get("outcome_age")
    if outcome_age is None or float(outcome_age) > OUTCOME_AGE_MAX_S:
        return "outcome_age"
    if state.get("job_status") != "CLAIMED" or not state.get("lease_live"):
        return "lease"
    blocked = state.get("blocked") or []
    if len(blocked) != 1:
        return "blocked_count"
    b = blocked[0]
    if control_pid not in (b.get("blockers") or []):
        return "blockers"
    if b.get("wait_event_type") != "Lock":
        return "wait_event_type"
    if b.get("kind") != "finalize":
        return "kind"
    query_age = b.get("query_age")
    if query_age is None or float(query_age) > max_query_age_s:
        return "query_age"
    if prev_query_start is not None and b.get("query_start") != prev_query_start:
        return "worker_retried"
    return None


def provider_gate_reason(stats: Dict[str, Any], base_streams: int,
                         base_aborted: int,
                         base_completed: int) -> Optional[str]:
    """The old epoch must have FULLY finished the request before the kill:
    one more completed stream, no abort, nothing active."""
    try:
        ok = (int(stats["streamRequests"]) == base_streams + 1
              and int(stats["completedStreamRequests"]) == base_completed + 1
              and int(stats["abortedStreamRequests"]) == base_aborted
              and int(stats["activeStreamRequests"]) == 0)
    except (KeyError, TypeError, ValueError):
        return "provider_stats_unparseable"
    return None if ok else "provider_not_settled"


def oldest_age(state: Dict[str, Any]) -> float:
    """The oldest of the three DB-reported ages for the blocked finalize:
    the current statement, its transaction and the committed outcome."""
    b = state["blocked"][0]
    return max(float(b["query_age"]), float(b["xact_age"]),
               float(state.get("outcome_age") or 0.0))


def window_deadline(read_t0: float, state: Dict[str, Any]) -> float:
    """Absolute monotonic instant by which the kill must have been issued
    AND returned, derived from one gate read: the read was sent at
    read_t0. Treating the server-reported oldest age as already elapsed
    at that earlier instant conservatively includes the entire round-trip."""
    return read_t0 + (KILL_WINDOW_S - oldest_age(state))


class RealIO:
    """Default docker/compose-backed seams; the unit tests substitute
    fakes with the same method surface (open_session/provider_stats/
    identity/kill/killed_state plus a .sessions list)."""

    def __init__(self, compose: List[str], provider_port: int):
        self.compose = compose
        self.docker = ["docker", "--context", "orbstack"]
        self.provider_port = provider_port
        self.sessions: List[SQLSession] = []

    def open_session(self, name: str) -> SQLSession:
        session = SQLSession(self.compose, name)
        self.sessions.append(session)
        return session

    def provider_stats(self) -> Dict[str, Any]:
        proc = subprocess.run(
            self.compose + ["exec", "-T", "fake-provider", "node", "-e",
                            PROVIDER_NODE, str(self.provider_port)],
            capture_output=True, timeout=PROVIDER_TIMEOUT_S)
        need(proc.returncode == 0, "PROVIDER_REQUEST_FAILED")
        return json.loads(proc.stdout)

    def identity(self, runtime_cid: str) -> Dict[str, str]:
        proc = subprocess.run(
            self.docker + ["inspect", "-f",
                           "{{.Id}} {{.State.Running}} "
                           "{{index .Config.Labels \"vc.g12.nonce\"}}",
                           runtime_cid],
            capture_output=True, text=True, timeout=DOCKER_TIMEOUT_S)
        need(proc.returncode == 0, "RUNTIME_INSPECT_FAILED")
        parts = proc.stdout.split()
        need(len(parts) == 3, "RUNTIME_INSPECT_PARSE")
        return {"id": parts[0], "running": parts[1], "nonce": parts[2]}

    def kill(self, runtime_cid: str, budget_s: float) -> None:
        """Issue the docker kill with a wait budget that MUST NOT exceed
        the remaining crash window (the caller computes it from the
        finalize-age upper bound). A timeout here means the CLI was
        spawned and the request MAY have reached the daemon unconfirmed —
        reported as issued-but-unproven, never as not-killed."""
        try:
            proc = subprocess.run(self.docker + ["kill", runtime_cid],
                                  capture_output=True, timeout=budget_s)
        except subprocess.TimeoutExpired as exc:
            raise ProbeError("KILL_BUDGET_TIMEOUT") from exc
        need(proc.returncode == 0, "DOCKER_KILL_FAILED")

    def killed_state(self, runtime_cid: str) -> str:
        proc = subprocess.run(
            self.docker + ["inspect", "-f",
                           "{{.State.Status}} {{.State.ExitCode}} "
                           "{{.State.Pid}}", runtime_cid],
            capture_output=True, text=True, timeout=DOCKER_TIMEOUT_S)
        need(proc.returncode == 0, "POST_KILL_INSPECT_FAILED")
        return proc.stdout.strip()


def run_probe(args: Any, io: Any,
              clock: Callable[[], float] = time.monotonic) -> Dict[str, Any]:
    """The single C-point program: lock early, gate, kill, release.

    kill-before-release happens on the success path ONLY; every other
    path (including interrupts raised inside any step) reaches the
    finally block, which rolls back and reaps both sessions.
    """
    report: Dict[str, Any] = {
        "crash_point": "SUCCEEDED_before_finalize",
        "status": "ABORTED", "reason": None,
        # False: failed BEFORE the kill was issued — nothing was killed.
        # True: the kill WAS issued; an ABORTED status then means the
        # first-window crash point could not be PROVEN (never a PASS).
        "kill_issued": False,
        "generation_id": str(args.generation_id),
        "owner": str(args.owner),
        "runtime_cid": args.runtime_cid,
        "control_pid": None,
        "initial_after_lock": None,
        "gate_observation": None,
        "reobserve": None,
        "provider_at_gate": None,
        "killed": None,
        "timings": {},
        "control_backend_absent": None,
        "connections": [],
    }
    started = clock()
    gate_started: Optional[float] = None
    control: Optional[Any] = None
    observer: Optional[Any] = None

    def observe() -> Any:
        assert control is not None and observer is not None
        assert control.info["backend_pid"] is not None
        t0 = clock()
        state = observer.query(
            state_sql(int(args.owner), int(args.generation_id),
                      int(control.info["backend_pid"])))
        return state, t0, clock()

    def on_signal(signum: int, frame: Any) -> None:
        raise ProbeError("INTERRUPTED")

    old_term = signal.signal(signal.SIGTERM, on_signal)
    old_int = signal.signal(signal.SIGINT, on_signal)
    try:
        # Fail fast on identity before touching the database; the binding
        # re-check happens immediately before the kill.
        ident = io.identity(args.runtime_cid)
        need(ident["id"] == args.runtime_cid and ident["running"] == "true"
             and ident["nonce"] == args.nonce, "IDENTITY_PRECHECK")

        control = io.open_session("r145-bf-control")
        observer = io.open_session("r145-bf-observe")
        report["control_pid"] = control.info["backend_pid"]
        locked = control.query(
            f"BEGIN; SET LOCAL idle_in_transaction_session_timeout='45s'; "
            f"SELECT json_build_object('locked',id) FROM vc.generation "
            f"WHERE owner_user_id={int(args.owner)} "
            f"AND id={int(args.generation_id)} FOR UPDATE")
        # A wrong owner/gid locks nothing — fail fast instead of waiting
        # for the state query to time out against a missing row.
        need(str(locked.get("locked")) == str(int(args.generation_id)),
             "LOCK_MISMATCH")
        initial, _, _ = observe()
        report["initial_after_lock"] = initial
        # The lock must have been acquired while the unique attempt is
        # still CREATED: once SUCCEEDED is in, the finalize may already
        # be inside or past its transaction window.
        need(initial.get("generation_status") == "IN_PROGRESS"
             and initial.get("attempts") == ["CREATED"]
             and initial.get("assistant_null")
             and initial.get("job_status") == "CLAIMED"
             and initial.get("lease_live"), "C_LOCK_TOO_LATE")

        gate_started = clock()
        gate_deadline = gate_started + float(args.gate_budget)
        first: Optional[Any] = None
        while True:
            need(clock() < gate_deadline, "GATE_BUDGET")
            state, t0, t1 = observe()
            if gate_reason(state, control.info["backend_pid"],
                           FIRST_QUERY_AGE_MAX_S) is None:
                first = (state, t0, t1)
                break
            need(state.get("generation_status") == "IN_PROGRESS",
                 "TARGET_LEFT_IN_PROGRESS")
            time.sleep(POLL_S)
        state, t0, t1 = first
        report["gate_observation"] = state
        prev_query_start = state["blocked"][0]["query_start"]
        # First-read deadline: elapsed window from here can never be reset
        # by a later read.
        deadline_first = window_deadline(t0, state)
        report["timings"]["finalize_age_basis_first_read_s"] = \
            oldest_age(state)
        hit_rel = t1 - started

        stats = io.provider_stats()
        report["provider_at_gate"] = stats
        reason = provider_gate_reason(stats, int(args.baseline_streams),
                                      int(args.baseline_aborted),
                                      int(args.baseline_completed))
        need(reason is None, str(reason))

        # Binding identity check BEFORE the last real SQL gate: the exact
        # nonce-receipted CID must be re-proven running before any further
        # gating happens. Any slowness here shows up in the final gate's
        # DB-read ages (the real backend keeps running) and in the window
        # deadline — never silently absorbed.
        ident = io.identity(args.runtime_cid)
        need(ident["id"] == args.runtime_cid and ident["running"] == "true"
             and ident["nonce"] == args.nonce, "IDENTITY")

        # LAST real SQL gate: same pinned query_start (a retried finalize
        # is a NEW transaction and can never substitute the first window),
        # SUCCEEDED/no-assistant/live-lease/blocked-by-control re-proven.
        final_state, f0, f1 = observe()
        reason = gate_reason(final_state, control.info["backend_pid"],
                             REOBSERVE_QUERY_AGE_MAX_S, prev_query_start)
        need(reason is None, f"GATE_LOST_{reason}")
        report["reobserve"] = final_state
        report["timings"]["finalize_age_basis_final_read_s"] = \
            oldest_age(final_state)
        # Binding deadline: the EARLIER of the first- and last-read
        # deadlines (first-read elapsed time is never reset; the last read
        # carries the grown DB ages).
        kill_deadline = min(deadline_first, window_deadline(f0, final_state))
        report["timings"]["finalize_age_upper_at_gate_s"] = \
            KILL_WINDOW_S - (kill_deadline - f1)

        # The kill may only be ISSUED before the deadline; its wait budget
        # must not exceed what is left of it.
        now = clock()
        remaining = kill_deadline - now
        need(remaining > 0.0, "KILL_WINDOW_EXHAUSTED")
        report["timings"]["finalize_age_upper_at_kill_issued_s"] = \
            KILL_WINDOW_S - remaining
        try:
            io.kill(args.runtime_cid, remaining)
        except ProbeError as exc:
            # The CLI was spawned: the request MAY have reached the daemon
            # unconfirmed. Report issued-but-unproven — never "not killed".
            report["kill_issued"] = True
            raise ProbeError(f"KILL_UNPROVEN_{exc}") from exc
        report["kill_issued"] = True

        # If the deadline has passed when the kill RETURNS, the first-
        # window crash point can no longer be proven: ABORTED, never
        # KILLED/PASS.
        kill_returned_at = clock()
        report["timings"]["finalize_age_upper_at_kill_returned_s"] = \
            KILL_WINDOW_S - (kill_deadline - kill_returned_at)
        need(kill_returned_at <= kill_deadline, "KILL_RETURNED_LATE")
        killed_state = io.killed_state(args.runtime_cid)
        report["killed"] = {"cid": args.runtime_cid, "state": killed_state,
                            "at_s": kill_returned_at - started}
        need(killed_state == "exited 137 0",
             f"KILL_STATE_{killed_state.replace(' ', '_')}")

        released = control.query(
            "ROLLBACK; SELECT json_build_object('released',true)")
        need(released.get("released") is True, "RELEASE_FAILED")
        control.close()
        absent = observer.query(
            "SELECT json_build_object('absent',NOT EXISTS(SELECT 1 FROM "
            f"pg_stat_activity WHERE pid={control.info['backend_pid']}))")
        report["control_backend_absent"] = absent.get("absent")
        need(absent.get("absent") is True, "CONTROL_BACKEND_REMAINS")
        observer.close()

        report["status"] = "KILLED"
        report["timings"].update({
            "finalize_window_s": KILL_WINDOW_S,
            "lock_to_gate_s": hit_rel - (gate_started - started),
            "hit_to_kill_s": kill_returned_at - started - hit_rel,
            "total_s": clock() - started,
        })
    except ProbeError as exc:
        report["reason"] = str(exc)
    except Exception as exc:  # fail closed with the type name, no details
        report["reason"] = type(exc).__name__
    finally:
        signal.signal(signal.SIGTERM, old_term)
        signal.signal(signal.SIGINT, old_int)
        for session in (control, observer):
            if session is not None:
                try:
                    session.close()
                except Exception:
                    pass
        report["connections"] = [s.info for s in io.sessions]
        with open(args.out, "w") as fh:
            json.dump(report, fh, indent=2)
            fh.write("\n")
    return report


def parse_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="S8 before-finalize crash helper (FUNCTIONAL_ONLY)")
    parser.add_argument("--compose-envfile", required=True)
    parser.add_argument("--compose-file", required=True)
    parser.add_argument("--project", required=True)
    parser.add_argument("--provider-port", required=True, type=int)
    parser.add_argument("--owner", required=True, type=int)
    parser.add_argument("--generation-id", required=True, type=int)
    parser.add_argument("--runtime-cid", required=True)
    parser.add_argument("--nonce", required=True)
    parser.add_argument("--baseline-streams", required=True, type=int)
    parser.add_argument("--baseline-aborted", required=True, type=int)
    parser.add_argument("--baseline-completed", required=True, type=int)
    parser.add_argument("--gate-budget", type=float, default=60.0,
                        help="seconds from the control lock to the gate; "
                             "the default S8 window (8 chunks x 3 s) fits")
    parser.add_argument("--out", required=True)
    return parser.parse_args(argv)


def main(argv: Optional[List[str]] = None) -> int:
    args = parse_args(argv)
    compose = ["docker", "--context", "orbstack", "compose",
               "--env-file", args.compose_envfile,
               "-f", args.compose_file, "-p", args.project]
    report = run_probe(args, RealIO(compose, args.provider_port))
    print(json.dumps({"status": report["status"],
                      "reason": report["reason"]}))
    return 0 if report["status"] == "KILLED" else 1


if __name__ == "__main__":
    sys.exit(main())

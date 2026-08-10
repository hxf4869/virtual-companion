#!/usr/bin/env python3
from __future__ import annotations

import argparse
import subprocess
import sys
import time
from typing import Any

from harness_common import (
    ROOT,
    HarnessError,
    configure_utf8_stdio,
    load_yaml,
    run_command_with_timeout,
)


def command_argv(command: dict[str, Any], task_id: str | None) -> list[str]:
    raw = command.get("argv")
    if not isinstance(raw, list) or not raw:
        raise HarnessError("command argv must be a non-empty list")
    argv = [sys.executable, *(str(item) for item in raw)]
    if task_id and command.get("passTask") is True:
        argv.extend(["--task", task_id])
    return argv


def command_timeout_seconds(command: dict[str, Any]) -> int:
    timeout = command.get("timeoutSeconds")
    if isinstance(timeout, int) and timeout > 0:
        return timeout
    return 1800


def main() -> int:
    configure_utf8_stdio()
    parser = argparse.ArgumentParser(description="Run the canonical cross-platform Harness precheck")
    parser.add_argument("--task", help="Task ID passed to task-aware checks")
    parser.add_argument("--profile", default="precheck", help="Command profile from .harness/commands.yaml")
    parser.add_argument("--list", action="store_true", help="List configured commands without executing them")
    args = parser.parse_args()

    try:
        config = load_yaml(ROOT / ".harness/commands.yaml")
        commands = config.get("commands")
        profiles = config.get("profiles")
        if not isinstance(commands, dict) or not isinstance(profiles, dict):
            raise HarnessError(".harness/commands.yaml must define commands and profiles")
        command_ids = profiles.get(args.profile)
        if not isinstance(command_ids, list) or not command_ids:
            raise HarnessError(f"unknown or empty command profile: {args.profile}")
        if args.list:
            for command_id in command_ids:
                command = commands.get(command_id)
                if not isinstance(command, dict):
                    raise HarnessError(f"profile references unknown command: {command_id}")
                print(f"{command_id}: {' '.join(command_argv(command, args.task))}")
            return 0

        import concurrent.futures as _cf

        def _run_cmd(cid: str, cmd: dict[str, Any], tid: str | None) -> tuple[str, int]:
            argv = command_argv(cmd, tid)
            timeout = command_timeout_seconds(cmd)
            print(f"\n== {cid}: {cmd.get('description', '')}", flush=True)
            started = time.perf_counter()
            returncode, timed_out = run_command_with_timeout(
                argv,
                cwd=ROOT,
                timeout_seconds=timeout,
            )
            elapsed = time.perf_counter() - started
            if timed_out:
                status = "TIMEOUT"
                print(
                    f"== {cid}: {status} "
                    f"(exit={returncode}, elapsed={elapsed:.3f}s, "
                    f"timeout={timeout}s, process tree terminated)",
                    flush=True,
                )
                return cid, 1
            status = "PASS" if returncode == 0 else "FAIL"
            print(
                f"== {cid}: {status} "
                f"(exit={returncode}, elapsed={elapsed:.3f}s)",
                flush=True,
            )
            return cid, int(returncode)

        failures: list[tuple[str, int]] = []
        with _cf.ThreadPoolExecutor(max_workers=len(command_ids)) as pool:
            futs = {}
            for command_id in command_ids:
                command = commands.get(command_id)
                if not isinstance(command, dict):
                    raise HarnessError(f"profile references unknown command: {command_id}")
                futs[pool.submit(_run_cmd, command_id, command, args.task)] = command_id
            for future in _cf.as_completed(futs):
                cid, exit_code = future.result()
                if exit_code != 0:
                    failures.append((str(cid), exit_code))
        if failures:
            for command_id, exit_code in failures:
                print(f"FAIL: {command_id} exited {exit_code}", file=sys.stderr)
            print(f"Harness precheck: FAIL ({len(failures)} commands)", file=sys.stderr)
            return 1
        print(f"\nHarness precheck: PASS ({len(command_ids)} commands)")
        return 0
    except HarnessError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())

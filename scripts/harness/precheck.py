#!/usr/bin/env python3
from __future__ import annotations

import argparse
import subprocess
import sys
import time
from typing import Any

from harness_common import ROOT, HarnessError, configure_utf8_stdio, load_yaml


def command_argv(command: dict[str, Any], task_id: str | None) -> list[str]:
    raw = command.get("argv")
    if not isinstance(raw, list) or not raw:
        raise HarnessError("command argv must be a non-empty list")
    argv = [sys.executable, *(str(item) for item in raw)]
    if task_id and command.get("passTask") is True:
        argv.extend(["--task", task_id])
    return argv


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

        failures: list[tuple[str, int]] = []
        for command_id in command_ids:
            command = commands.get(command_id)
            if not isinstance(command, dict):
                raise HarnessError(f"profile references unknown command: {command_id}")
            argv = command_argv(command, args.task)
            print(f"\n== {command_id}: {command.get('description', '')}", flush=True)
            started = time.perf_counter()
            result = subprocess.run(argv, cwd=ROOT, check=False)
            elapsed = time.perf_counter() - started
            status = "PASS" if result.returncode == 0 else "FAIL"
            print(
                f"== {command_id}: {status} "
                f"(exit={result.returncode}, elapsed={elapsed:.3f}s)",
                flush=True,
            )
            if result.returncode != 0:
                failures.append((str(command_id), result.returncode))
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

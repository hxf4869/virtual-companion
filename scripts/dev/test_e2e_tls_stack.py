#!/usr/bin/env python3
"""Lifecycle regression for scripts/dev/e2e-tls-stack.sh cleanup() (VC-R79).

The launcher is SOURCED with E2E_TLS_SOURCE_ONLY=1 (the seam returns right
after cleanup()/traps are defined — the same pattern run.sh's
G12_SOURCE_ONLY seam gives the G12 tests) and the real cleanup() is driven
with a stubbed cleanup engine, asserting the actual file/exit-code contract:

- engine success: secrets/CA/compose/creating marker/state file removed,
  the shared session material removed, the ownership receipts (capture/
  built — the teardown's idempotent fallback needs them) KEPT, and the
  incoming exit status preserved;
- engine failure: exit forced to 1, the state file and receipts kept as the
  recovery entry, session material still removed;
- E2E_STACK_KEEP=1: nothing removed, no engine call, rc preserved.

The engine stub also records its argv, pinning the receipt paths and the
--deadline-seconds bound. No docker daemon is ever touched.
"""

import json
import os
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
LAUNCHER = os.path.join(HERE, "e2e-tls-stack.sh")

DRIVER = r'''
set -uo pipefail
export E2E_TLS_SOURCE_ONLY=1
export E2E_STACK_KIND=tls
export E2E_DOCKER_CONTEXT=orbstack
export E2E_STACK_STATE_FILE="$STATE_FILE"
source "{launcher}"
if [ "[object Object]" = "1" ]; then
  for name in VC_DOMAIN VC_PROVIDER_ENDPOINT VC_CRYPTO_REST_KEY; do
    if printenv "$name" >/dev/null; then exit 91; fi
  done
fi
python3() {{
  printf '%s\n' "$*" >> "$ENGINE_CALLS"
  return {engine_rc}
}}
# Expose the launcher's own paths to the assertions, then set up the exact
# on-disk shape cleanup() consumes.
printf '%s\n' "$RUN_DIR" "$CAPTURE" "$BUILT_IMAGES" "$LEFTOVERS" \
  "$CREATING" "$ENVFILE" "$RUNTIME_ENVFILE" "$PROVIDER_ENVFILE" \
  "$CA_FILE" "$STACK_COMPOSE" "$E2E_TLS_ORIGIN" "$E2E_TLS_PORT" > "$PATHS_OUT"
: > "$ENVFILE"; : > "$RUNTIME_ENVFILE"; : > "$PROVIDER_ENVFILE"
: > "$CA_FILE"; : > "$STACK_COMPOSE"
printf '{{}}' > "$CAPTURE"; printf '{{}}' > "$BUILT_IMAGES"
touch "$CREATING"
# cleanup() runs ONLY through the EXIT trap — the launcher's real exit
# paths (die/SIGTERM/loop exit) never call it directly.
( exit {incoming_rc} )
exit $?
'''


class CleanupLifecycleTest(unittest.TestCase):
    def run_cleanup(self, *, engine_rc=0, incoming_rc=0, keep=False,
                    tls_port="18457", inherited_config=False):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        work = os.path.join(tmp.name, "work")
        os.makedirs(work)
        state_file = os.path.join(work, "state.json")
        engine_calls = os.path.join(tmp.name, "engine-calls.log")
        paths_out = os.path.join(tmp.name, "paths.log")
        for name in ("state.json", "state.json.auth.json",
                     "state.json.shared-chat.json",
                     "state.json.shared-memory.json",
                     "state.json.shared-admin.json"):
            with open(os.path.join(work, name), "w") as fh:
                fh.write("{}\n")
        env = dict(os.environ,
                   STATE_FILE=state_file,
                   ENGINE_CALLS=engine_calls,
                   PATHS_OUT=paths_out,
                   TMPDIR=tmp.name,
                   E2E_STACK_KEEP="1" if keep else "0",
                   E2E_TLS_PORT=tls_port,
                   EXPECT_ISOLATED_VC="1" if inherited_config else "0")
        if inherited_config:
            env.update(VC_DOMAIN="inherited.example.invalid",
                       VC_PROVIDER_ENDPOINT="https://inherited.example.invalid/v1",
                       VC_CRYPTO_REST_KEY="synthetic-inherited-key")
        proc = subprocess.run(
            ["bash", "-c", DRIVER.format(launcher=LAUNCHER,
                                         engine_rc=engine_rc,
                                         incoming_rc=incoming_rc)],
            capture_output=True, text=True, env=env)
        with open(paths_out) as fh:
            (run_dir, capture, built, leftovers, creating, envfile,
             runtime_env, provider_env, ca_file, compose, tls_origin, normalized_port) = \
                [line.strip() for line in fh if line.strip()]
        calls = []
        if os.path.exists(engine_calls):
            with open(engine_calls) as fh:
                calls = [line.strip() for line in fh if line.strip()]
        paths = {
            "run_dir": run_dir, "capture": capture, "built": built,
            "leftovers": leftovers, "creating": creating, "envfile": envfile,
            "runtime_env": runtime_env, "provider_env": provider_env,
            "ca": ca_file, "compose": compose,
            "origin": tls_origin, "port": normalized_port,
            "state": state_file,
            "auth": state_file + ".auth.json",
            "shared": state_file + ".shared-chat.json",
        }
        return proc, paths, calls

    def test_engine_success_keeps_receipts_and_preserves_rc(self):
        proc, paths, calls = self.run_cleanup(engine_rc=0, incoming_rc=0)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(len(calls), 1, calls)
        argv = calls[0].split()
        self.assertEqual(argv[-2:], ["--deadline-seconds", "90"])
        for token in (paths["capture"], paths["built"], paths["leftovers"],
                      paths["run_dir"]):
            self.assertIn(token, calls[0])
        self.assertTrue(os.path.exists(paths["capture"]))
        self.assertTrue(os.path.exists(paths["built"]))
        for key in ("state", "auth", "shared", "creating", "envfile",
                    "runtime_env", "provider_env", "ca", "compose"):
            self.assertFalse(os.path.exists(paths[key]), key)

    def test_engine_failure_keeps_recovery_entry_and_cleans_sessions(self):
        proc, paths, calls = self.run_cleanup(engine_rc=1, incoming_rc=0)
        self.assertEqual(proc.returncode, 1, proc.stderr)
        self.assertEqual(len(calls), 1, calls)
        # Recovery entry kept: state + receipts + creating marker.
        self.assertTrue(os.path.exists(paths["state"]))
        self.assertTrue(os.path.exists(paths["capture"]))
        self.assertTrue(os.path.exists(paths["built"]))
        self.assertTrue(os.path.exists(paths["creating"]))
        # Session material removed even on failure; secrets removed only by
        # the success path, so they must survive here as part of the record.
        self.assertFalse(os.path.exists(paths["auth"]))
        self.assertFalse(os.path.exists(paths["shared"]))
        self.assertTrue(os.path.exists(paths["envfile"]))

    def test_incoming_failure_rc_preserved_through_successful_cleanup(self):
        proc, paths, _ = self.run_cleanup(engine_rc=0, incoming_rc=7)
        self.assertEqual(proc.returncode, 7, proc.stderr)
        self.assertFalse(os.path.exists(paths["state"]))

    def test_keep_mode_removes_nothing_and_skips_engine(self):
        proc, paths, calls = self.run_cleanup(engine_rc=0, incoming_rc=0,
                                              keep=True)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(calls, [])
        for key in ("state", "auth", "shared", "creating", "envfile",
                    "capture", "built"):
            self.assertTrue(os.path.exists(paths[key]), key)


    def test_inherited_production_settings_cannot_enter_the_synthetic_stack(self):
        proc, _, _ = self.run_cleanup(inherited_config=True)
        self.assertEqual(proc.returncode, 0, proc.stderr)

    def test_origin_uses_the_actual_canonical_https_port(self):
        for raw_port, expected_origin, expected_port in (
            ("443", "https://localhost", "443"),
            ("00443", "https://localhost", "443"),
            ("018457", "https://localhost:18457", "18457"),
        ):
            with self.subTest(port=raw_port):
                proc, paths, _ = self.run_cleanup(tls_port=raw_port)
                self.assertEqual(proc.returncode, 0, proc.stderr)
                self.assertEqual(paths["origin"], expected_origin)
                self.assertEqual(paths["port"], expected_port)


if __name__ == "__main__":
    sys.exit(unittest.main(verbosity=2))

"""Exercise the real Node close command; negative cases never use a Docker daemon."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
CLI = ROOT / "scripts/dev/close-http-e2e-stack.mjs"

class CloseHttpCliTest(unittest.TestCase):
    def run_cli(self, *args, env=None):
        return subprocess.run(["node", "--experimental-strip-types", str(CLI), *map(str, args)],
                              cwd=ROOT, env=env, capture_output=True, text=True, timeout=15)

    def test_help_is_successful_without_stack_metadata(self):
        p = self.run_cli("--help")
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertIn("--state /absolute/", p.stdout)

    def test_missing_relative_and_unknown_arguments_fail(self):
        for args in ((), ("--state", "relative.json"), ("--unknown",)):
            with self.subTest(args=args):
                p = self.run_cli(*args)
                self.assertNotEqual(p.returncode, 0)
                self.assertNotIn("HTTP_E2E_STACK_CLOSED", p.stdout)

    def test_missing_file_does_not_report_closure(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = self.run_cli("--state", Path(tmp) / "missing.json")
            self.assertNotEqual(p.returncode, 0)
            self.assertIn("missing; preserved", p.stderr)

    def test_malformed_json_never_echoes_file_contents(self):
        with tempfile.TemporaryDirectory() as tmp:
            state = Path(tmp) / "state.json"
            state.write_text('{"private":"SYNTHETIC_SENTINEL_DO_NOT_PRINT",oops')
            p = self.run_cli("--state", state)
            self.assertNotEqual(p.returncode, 0)
            self.assertIn("not valid JSON", p.stderr)
            self.assertNotIn("SYNTHETIC_SENTINEL_DO_NOT_PRINT", p.stdout + p.stderr)
            self.assertTrue(state.exists())

    def test_legacy_state_is_preserved(self):
        with tempfile.TemporaryDirectory() as tmp:
            state = Path(tmp) / "state.json"
            raw = json.dumps({"version": 2, "stackKind": "http"})
            state.write_text(raw)
            p = self.run_cli("--state", state)
            self.assertNotEqual(p.returncode, 0)
            self.assertIn("legacy", p.stderr)
            self.assertEqual(state.read_text(), raw)

    def test_mismatched_receipt_cannot_signal_a_real_process(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp); run = base / "run"; run.mkdir(); bindir = base / "bin"; bindir.mkdir()
            calls = base / "docker-called"
            docker = bindir / "docker"
            docker.write_text('#!/bin/sh' + chr(10) + ': >"' + str(calls) + '"' + chr(10) + 'exit 98' + chr(10))
            docker.chmod(0o700)
            child = subprocess.Popen(["sleep", "60"], start_new_session=True)
            try:
                start = subprocess.check_output(["ps", "-o", "lstart=", "-p", str(child.pid)], text=True).strip()
                nonce = "0123456789abcdef0123456789abcdef"; project = "vce2ehttp-" + nonce
                capture = run / "created-resources.json"; built = run / "built-images.json"
                capture.write_text(json.dumps({"nonce": "foreign", "project": project, "containers": [], "volumes": [], "networks": []}))
                built.write_text(json.dumps({"virtual-companion-e2e-minio:" + nonce: "sha256:" + "d" * 64}))
                value = dict(version=4, stackKind="http", supervisorPid=child.pid, supervisorStartedAt=start,
                             runDir=str(run), nonce=nonce, project=project, dockerContext="orbstack", keep=True, creating=True,
                             container="a" * 64, containers=[x * 64 for x in "abc"],
                             processGroups=dict(provider=None, runtime=None, h5=None), processStarts=dict(provider=None, runtime=None, h5=None),
                             releaseMode="full", releasePolicyVersion="e2e-synthetic-v1", providerLogPath=str(run / "provider-requests.jsonl"),
                             receipts=dict(capture=str(capture), built=str(built), collectors=str(run / "collectors.json"),
                                           leftoversOut=str(run / "cleanup.leftovers.json"), resourcesPy="/untrusted/program.py"))
                state = base / "state.json"; state.write_text(json.dumps(value)); auth = base / "state.json.auth.json"; auth.write_text("{}")
                env = dict(os.environ, PATH=str(bindir) + os.pathsep + os.environ["PATH"])
                p = self.run_cli("--state", state, env=env)
                self.assertNotEqual(p.returncode, 0)
                self.assertIn("creation receipt", p.stderr)
                self.assertIsNone(child.poll(), "unverified metadata stopped a real process")
                self.assertFalse(calls.exists()); self.assertTrue(state.exists()); self.assertTrue(auth.exists())
            finally:
                if child.poll() is None: child.terminate()
                child.wait(timeout=5)

if __name__ == "__main__": unittest.main()

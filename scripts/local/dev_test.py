"""Offline checks for the local stack entrypoint.

The tests drive scripts/local/dev.sh. Docker, SSH, and the network are stubs.
They never read or write ~/.virtual-companion-local, and they fail if a
generated secret appears on stdout, stderr, or a stub argv log.
"""
import os
import re
import stat
import subprocess
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
DEV = REPO / "scripts" / "local" / "dev.sh"
README = REPO / "ops" / "local" / "README.md"
OVERRIDE = REPO / "ops" / "local" / "compose.override.yaml"
QUIESCE = REPO / "scripts" / "local" / "quiesce.sql"
REMOTE = REPO / "scripts" / "local" / "remote-export.sh"
RERANK_BYTES = 635676416
RERANK_SHA = "a43c7c9b11a4c1517e5bf95151960e1621d1b72f7a493364b01e386cf1aaa1d3"


def mode(path: Path) -> int:
    return stat.S_IMODE(path.stat().st_mode)


def write_exec(path: Path, text: str) -> None:
    path.write_text(text)
    path.chmod(0o755)


class LocalDevScriptTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="vc-local-dev-test-"))
        self.addCleanup(lambda: subprocess.run(["rm", "-rf", str(self.tmp)], check=False))
        self.state = self.tmp / "state"
        self.home = self.tmp / "home"
        self.home.mkdir()
        self.docker_log = self.tmp / "docker.log"
        self.docker_stdin = self.tmp / "docker.stdin"
        self.ssh_log = self.tmp / "ssh.log"
        self.rerank = self.tmp / "rerank"
        self.rerank.mkdir()
        gguf = self.rerank / "bge-reranker-v2-m3-Q8_0.gguf"
        with gguf.open("wb") as fh:
            fh.truncate(RERANK_BYTES)
        (self.rerank / "bge-reranker-v2-m3-Q8_0.gguf.sha256").write_text(RERANK_SHA + "\n")
        write_exec(self.tmp / "docker", """#!/bin/sh
printf '%s\\n' "$*" >> "$VC_LOCAL_DOCKER_LOG"
if [ "$1" = "compose" ]; then
  for arg in "$@"; do
    if [ "$arg" = "config" ]; then
      saw_config=1
    fi
    if [ "$arg" = "-q" ]; then
      saw_q=1
    fi
  done
  if [ -n "$saw_config" ] && [ -z "$saw_q" ]; then
    echo 'refusing docker compose config without -q' >&2
    exit 1
  fi
fi
for arg in "$@"; do
  if [ "$arg" = "exec" ]; then
    cat >> "$VC_LOCAL_DOCKER_STDIN"
    exit 0
  fi
done
exit 0
""")
        write_exec(self.tmp / "ssh", """#!/bin/sh
printf '%s\\n' "$*" >> "$VC_LOCAL_SSH_LOG"
echo 'ssh stub must not run' >&2
exit 99
""")
        self.env = {
            "PATH": "/usr/bin:/bin:/usr/sbin:/sbin",
            "HOME": str(self.home),
            "TMPDIR": str(self.tmp),
            "LANG": "C",
            "VC_LOCAL_STATE": str(self.state),
            "VC_LOCAL_TEST": "1",
            "VC_LOCAL_DOCKER": str(self.tmp / "docker"),
            "VC_LOCAL_DOCKER_LOG": str(self.docker_log),
            "VC_LOCAL_DOCKER_STDIN": str(self.docker_stdin),
            "VC_LOCAL_SSH_EXECUTE": str(self.tmp / "ssh"),
            "VC_LOCAL_SSH_DOWNLOAD": str(self.tmp / "ssh"),
            "VC_LOCAL_SSH_LOG": str(self.ssh_log),
            "VC_LOCAL_HTTP_PORT": "11080",
            "VC_EMBEDDING_VOLUME": "vc-local-test-embedding",
            "VC_EMBEDDING_SUBPATH": "models",
            "VC_RERANK_MODELS_DIR": str(self.rerank),
        }

    def run_dev(self, *args, extra=None, stdin=""):
        env = self.env.copy()
        if extra:
            env.update(extra)
        return subprocess.run(
            ["bash", str(DEV), *args],
            cwd=REPO,
            env=env,
            input=stdin,
            text=True,
            capture_output=True,
            check=False,
        )

    def combined(self, result) -> str:
        return result.stdout + result.stderr

    def assert_no_secret_leak(self, result, *secrets):
        blob = self.combined(result)
        log = self.docker_log.read_text() if self.docker_log.exists() else ""
        ssh = self.ssh_log.read_text() if self.ssh_log.exists() else ""
        for secret in secrets:
            self.assertTrue(secret, "empty secret is not a meaningful assertion")
            self.assertNotIn(secret, blob)
            self.assertNotIn(secret, log)
            self.assertNotIn(secret, ssh)

    def test_usage_and_rejected_arguments(self):
        missing = self.run_dev()
        self.assertNotEqual(missing.returncode, 0)
        usage = self.combined(missing)
        for word in ("up", "down", "status", "logs", "rebuild", "reset", "sync-from-prod"):
            self.assertIn(word, usage)
        self.assertNotEqual(self.run_dev("nope").returncode, 0)
        self.assertNotEqual(self.run_dev("logs").returncode, 0)
        self.assertNotEqual(self.run_dev("rebuild", "frontend").returncode, 0)
        self.assertNotEqual(self.run_dev("sync-from-prod", "--from-dir").returncode, 0)

    def test_reset_requires_two_confirmations_and_keeps_volumes_otherwise(self):
        self.assertNotEqual(self.run_dev("reset").returncode, 0)
        self.assertNotEqual(self.run_dev("reset", "--confirm", "WIPE-LOCAL-DATA").returncode, 0)
        self.assertNotEqual(
            self.run_dev("reset", extra={"VC_LOCAL_RESET_CONFIRM": "WIPE-LOCAL-DATA"}).returncode,
            0,
        )
        self.assertFalse(self.docker_log.exists() and " -v" in self.docker_log.read_text() and "down" in self.docker_log.read_text())
        ok = self.run_dev(
            "reset",
            "--confirm",
            "WIPE-LOCAL-DATA",
            extra={"VC_LOCAL_RESET_CONFIRM": "WIPE-LOCAL-DATA"},
        )
        self.assertEqual(ok.returncode, 0, self.combined(ok))
        log = self.docker_log.read_text()
        self.assertIn("down", log)
        self.assertIn("-v", log)
        self.assertNotIn("hxf4869", self.combined(ok))

    def test_up_creates_private_secrets_and_does_not_print_them(self):
        result = self.run_dev("up")
        self.assertEqual(result.returncode, 0, self.combined(result))
        self.assertEqual(mode(self.state), 0o700)
        password = (self.state / "admin.password").read_text().strip()
        runtime = (self.state / "runtime.env").read_text()
        crypto = re.search(r"^VC_CRYPTO_REST_KEY=(.*)$", runtime, re.M).group(1)
        binding = re.search(r"^VC_OWNER_BINDING_SECRET=(.*)$", runtime, re.M).group(1)
        db = (self.state / "db.env").read_text()
        pg = re.search(r"^POSTGRES_PASSWORD=(.*)$", db, re.M).group(1)
        token = re.search(r"^VC_ST_PLUGIN_SERVICE_TOKEN=(.*)$", runtime, re.M).group(1)
        for path in (
            "admin.password",
            "db.env",
            "migrate.env",
            "bootstrap.env",
            "runtime.env",
            "st.env",
            "memorycore.env",
            "minio.env",
            "minio-init.env",
            "compose.env",
            "local.env",
        ):
            self.assertEqual(mode(self.state / path), 0o600, path)
        self.assertGreaterEqual(len(password), 8)
        self.assertGreaterEqual(len(binding), 32)
        self.assertNotIn("VC_SMTP_HOST", runtime)
        self.assertNotIn("VC_FEISHU_WEBHOOK_URL", runtime)
        self.assertIn("VC_SESSION_COOKIE_SECURE=false", runtime)
        self.assert_no_secret_leak(result, password, crypto, binding, pg, token)
        log = self.docker_log.read_text()
        self.assertTrue(any("config" in line and "-q" in line.split() for line in log.splitlines()), log)
        self.assertIn("ops/local/compose.override.yaml", log)
        self.assertIn("127.0.0.1:11080:8080", (self.state / "compose.env").read_text() + OVERRIDE.read_text())
        ingress = (self.state / "ingress.conf").read_text()
        self.assertIn("proxy_set_header X-Forwarded-Proto $scheme;", ingress)
        self.assertNotIn("proxy_set_header X-Forwarded-Proto https;", ingress)
        config = (self.state / "config.yaml").read_text()
        self.assertIn("127.0.0.1:11080", config)
        self.assertIn('"enableUserAccounts": true', config)
        self.assertIn('"listen": false', config)
        again = self.run_dev("up")
        self.assertEqual(again.returncode, 0, self.combined(again))
        self.assertEqual((self.state / "admin.password").read_text().strip(), password)
        self.assert_no_secret_leak(again, password, crypto, binding, pg, token)

    def test_missing_rerank_model_prints_one_download_command(self):
        missing = self.tmp / "no-such-rerank"
        result = self.run_dev("up", extra={"VC_RERANK_MODELS_DIR": str(missing)})
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("bge-reranker-v2-m3-Q8_0.gguf", result.stderr)
        self.assertIn("huggingface.co", result.stderr)
        self.assertFalse((missing / "bge-reranker-v2-m3-Q8_0.gguf").exists())
        self.assertFalse(self.state.exists() and (self.state / "runtime.env").exists())

    def test_down_and_status_do_not_drop_volumes(self):
        self.assertEqual(self.run_dev("up").returncode, 0)
        self.docker_log.write_text("")
        down = self.run_dev("down")
        self.assertEqual(down.returncode, 0, self.combined(down))
        log = self.docker_log.read_text()
        self.assertIn("down", log)
        self.assertNotRegex(log, r"(^|\s)-v(\s|$)")
        self.docker_log.write_text("")
        status = self.run_dev("status")
        self.assertEqual(status.returncode, 0, self.combined(status))
        self.assertIn("ps", self.docker_log.read_text())
        logs = self.run_dev("logs", "runtime")
        self.assertEqual(logs.returncode, 0, self.combined(logs))
        self.assertNotEqual(self.run_dev("logs", "postgres").returncode, 0)

    def test_sync_from_dir_restores_without_ssh_and_quiesces(self):
        up = self.run_dev("up")
        self.assertEqual(up.returncode, 0, self.combined(up))
        runtime_before = (self.state / "runtime.env").read_text()
        local_token = re.search(r"^VC_ST_PLUGIN_SERVICE_TOKEN=(.*)$", runtime_before, re.M).group(1)
        local_crypto = re.search(r"^VC_CRYPTO_REST_KEY=(.*)$", runtime_before, re.M).group(1)
        backup = self.tmp / "backup"
        (backup / "postgres").mkdir(parents=True)
        (backup / "st").mkdir()
        (backup / "memorycore").mkdir()
        (backup / "minio").mkdir()
        (backup / "postgres" / "vc.dump").write_bytes(b"PGDMP-fixture")
        (backup / "st" / "marker.txt").write_text("st-marker")
        (backup / "memorycore" / "marker.txt").write_text("mc-marker")
        (backup / "minio" / "object.bin").write_bytes(b"obj")
        crypto = "cHJvZC1jcnlwdG8ta2V5LWZpeHR1cmUtMzJieXRlcyE="
        binding = "prod-owner-binding-secret-0123456789abcdef"
        smtp = "prod-smtp-password-copied-for-parity"
        leaked_token = "prod-plugin-token-must-not-replace-local-one"
        handles = '{"9":"owner"}'
        secrets = backup / "secrets.env"
        secrets.write_text(
            "\n".join([
                f"VC_CRYPTO_REST_KEY={crypto}",
                f"VC_OWNER_BINDING_SECRET={binding}",
                "VC_CRYPTO_REST_KEY_ID=prod-key",
                "VC_CRYPTO_REST_KEY_VERSION=4",
                "VC_CRYPTO_PREVIOUS_REST_KEY=cHJldmlvdXMta2V5LWZpeHR1cmUtMzJieXRlcyEhISE=",
                f"VC_ST_ACCOUNT_HANDLES={handles}",
                f"VC_SMTP_PASSWORD={smtp}",
                "VC_SMTP_HOST=smtp.example.invalid",
                "VC_MONTHLY_COST_LIMIT=12.5",
                f"VC_ST_PLUGIN_SERVICE_TOKEN={leaked_token}",
                "",
            ])
        )
        secrets.chmod(0o600)
        self.docker_log.write_text("")
        self.docker_stdin.write_text("")
        result = self.run_dev("sync-from-prod", "--from-dir", str(backup))
        blob = self.combined(result)
        self.assertEqual(result.returncode, 0, blob)
        self.assertFalse(self.ssh_log.exists() and self.ssh_log.read_text().strip())
        runtime = (self.state / "runtime.env").read_text()
        bootstrap = (self.state / "bootstrap.env").read_text()
        st_env = (self.state / "st.env").read_text()
        self.assertIn(f"VC_CRYPTO_REST_KEY={crypto}", runtime)
        self.assertIn(f"VC_OWNER_BINDING_SECRET={binding}", runtime)
        self.assertIn(f"VC_OWNER_BINDING_SECRET={binding}", bootstrap)
        self.assertIn("VC_CRYPTO_REST_KEY_ID=prod-key", runtime)
        self.assertIn("VC_CRYPTO_REST_KEY_VERSION=4", runtime)
        self.assertIn("VC_CRYPTO_PREVIOUS_REST_KEY=cHJldmlvdXMta2V5LWZpeHR1cmUtMzJieXRlcyEhISE=", runtime)
        self.assertIn(handles, st_env)
        # 通知凭据与行为配置按线上复制，只进 runtime.env。
        self.assertIn(f"VC_SMTP_PASSWORD={smtp}", runtime)
        self.assertIn("VC_SMTP_HOST=smtp.example.invalid", runtime)
        self.assertIn("VC_MONTHLY_COST_LIMIT=12.5", runtime)
        self.assertNotIn(smtp, bootstrap)
        self.assertNotIn(leaked_token, runtime)
        self.assertIn(f"VC_ST_PLUGIN_SERVICE_TOKEN={local_token}", runtime)
        self.assertNotIn(local_crypto, runtime)
        for name in (
            "VC_CRYPTO_REST_KEY",
            "VC_OWNER_BINDING_SECRET",
            "VC_CRYPTO_REST_KEY_ID",
            "VC_CRYPTO_REST_KEY_VERSION",
            "VC_CRYPTO_PREVIOUS_REST_KEY",
            "VC_ST_ACCOUNT_HANDLES",
        ):
            self.assertIn(name, blob)
        self.assertIn("VC_SMTP_PASSWORD", blob)
        self.assertNotIn("VC_ST_PLUGIN_SERVICE_TOKEN", blob.split("synced secret names:", 1)[-1])
        self.assert_no_secret_leak(result, crypto, binding, smtp, leaked_token, local_token)
        sql = self.docker_stdin.read_text()
        self.assertIn("vc.proactive_policy", sql)
        self.assertIn("vc.notification_channel", sql)
        self.assertIn("vc.notification_delivery", sql)
        self.assertIn("vc.follow_up", sql)
        self.assertIn("vc.work_item", sql)
        self.assertIn("FOLLOW_UP", sql)
        self.assertIn("enabled = false", sql)
        self.assertIn(str(backup / "postgres" / "vc.dump"), self.docker_log.read_text())
        self.assertIn("minio", self.docker_log.read_text())
        self.assertEqual(mode(self.state / "runtime.env"), 0o600)

    def test_sync_rejects_loose_secret_file_and_plan_does_not_connect(self):
        self.assertEqual(self.run_dev("up").returncode, 0)
        backup = self.tmp / "loose"
        backup.mkdir()
        (backup / "postgres").mkdir()
        (backup / "st").mkdir()
        (backup / "memorycore").mkdir()
        (backup / "postgres" / "vc.dump").write_bytes(b"PGDMP")
        (backup / "st" / "marker.txt").write_text("x")
        (backup / "memorycore" / "marker.txt").write_text("y")
        secrets = backup / "secrets.env"
        secrets.write_text("VC_CRYPTO_REST_KEY=cHJvZC1jcnlwdG8ta2V5LWZpeHR1cmUtMzJieXRlcyE=\nVC_OWNER_BINDING_SECRET=prod-owner-binding-secret-0123456789abcdef\n")
        secrets.chmod(0o644)
        rejected = self.run_dev("sync-from-prod", "--from-dir", str(backup))
        self.assertNotEqual(rejected.returncode, 0)
        self.assertFalse(self.ssh_log.exists() and self.ssh_log.read_text().strip())
        local = self.state / "local.env"
        text = local.read_text()
        text = re.sub(r"^VC_PROD_SSH_ALIAS=.*$", "VC_PROD_SSH_ALIAS=plan-alias", text, count=1, flags=re.M)
        if "VC_PROD_SSH_ALIAS=" not in text:
            text += "VC_PROD_SSH_ALIAS=plan-alias\n"
        local.write_text(text)
        local.chmod(0o600)
        plan = self.run_dev("sync-from-prod", "--plan")
        self.assertEqual(plan.returncode, 0, self.combined(plan))
        self.assertIn("plan-alias", plan.stdout)
        self.assertIn("ssh_execute.py", plan.stdout)
        self.assertIn("ssh_download.py", plan.stdout)
        self.assertFalse(self.ssh_log.exists() and self.ssh_log.read_text().strip())
        runtime = (self.state / "runtime.env").read_text()
        crypto = re.search(r"^VC_CRYPTO_REST_KEY=(.*)$", runtime, re.M).group(1)
        self.assert_no_secret_leak(plan, crypto)

    def test_remote_stdout_containing_a_secret_is_not_echoed(self):
        secret = "remote-printed-crypto-key-value"
        payload = (
            '{"success": true, "exit_code": 0, "stdout": "VC_CRYPTO_REST_KEY='
            + secret
            + '\\nEXPORT_DIR=/tmp/vc-local-export.abc", "stderr": ""}\n'
        )
        result = self.run_dev("sync-from-prod", "--parse-ssh-json", stdin=payload)
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn(secret, self.combined(result))

    def test_documents_and_compose_override_stay_local_only(self):
        readme = README.read_text()
        override = OVERRIDE.read_text()
        lib = (REPO / "scripts" / "local" / "lib.sh").read_text()
        alias = re.search(r"^VC_PROD_SSH_ALIAS_DEFAULT=(.+)$", lib, re.M)
        self.assertIsNotNone(alias)
        self.assertNotIn(alias.group(1).strip().strip('"').strip("'"), readme)
        self.assertNotIn(alias.group(1).strip().strip('"').strip("'"), override)
        self.assertIsNone(re.search(r"\d{1,3}(?:\.\d{1,3}){3}", readme))
        self.assertNotIn("http://", readme)
        self.assertNotIn("https://", readme)
        for word in ("up", "down", "status", "logs", "rebuild", "reset", "sync-from-prod", "--from-dir"):
            self.assertIn(word, readme)
        self.assertIn("127.0.0.1:", override)
        self.assertNotIn("0.0.0.0", override)
        self.assertIn("!override", override)
        self.assertIn("vc-model-settings", override)
        self.assertIn(":ro", override)
        self.assertNotIn("/etc/virtual-companion", override)
        sql = QUIESCE.read_text()
        self.assertIn("enabled = false", sql)
        self.assertIn("FOLLOW_UP", sql)
        syntax = subprocess.run(["bash", "-n", str(DEV)], capture_output=True, text=True)
        self.assertEqual(syntax.returncode, 0, syntax.stderr)
        remote_syntax = subprocess.run(["bash", "-n", str(REMOTE)], capture_output=True, text=True)
        self.assertEqual(remote_syntax.returncode, 0, remote_syntax.stderr)


if __name__ == "__main__":
    unittest.main()

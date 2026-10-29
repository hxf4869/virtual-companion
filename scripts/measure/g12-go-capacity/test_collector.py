#!/usr/bin/env python3
"""Unit regression for the VC-R58 G12 harness (render + collect + aggregate).

Run: python3 scripts/measure/g12-go-capacity/test_collector.py

The render cases are the direct regression for the VC-R57 fixture incident:
canonical config whose volume/network names stayed frozen as deploy_* under a
renamed project must be rejected before anything is created. The aggregation
cases pin the honesty rules: missing processes make a component PARTIAL (never
zeroed), B peaks come only from same-frame complete sums, and the CPU window
cases pin the explicit VALID/PARTIAL/INVALID contract — stats gaps between
valid endpoints and samples with an unreadable epoch are PARTIAL (qualified,
never VALID), while counter decreases and same-CID epoch changes (even with a
rising counter) are INVALID with no delta at all.
"""

import json
import os
import subprocess
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import collector  # noqa: E402
import render_stack  # noqa: E402

REPO = str(HERE.parents[2])


def canonical_fixture(project="deploy") -> dict:
    """Minimal canonical-shaped stand-in for ops/deploy `compose config`."""
    def vol(key):
        return {"name": f"{project}_{key}", "driver": "local"}
    return {
        "name": project,
        "services": {
            "db": {
                "image": "pgvector/pgvector:0.8.5-pg18@sha256:fixed",
                "volumes": [
                    {"type": "volume", "source": "db-data",
                     "target": "/var/lib/postgresql", "volume": {}},
                    {"type": "bind", "source": f"{REPO}/ops/deploy/db-init",
                     "target": "/docker-entrypoint-initdb.d", "read_only": True},
                ],
            },
            "migrate": {"image": "virtual-companion-runtime:local",
                        "command": ["migrate"], "restart": "no"},
            "bootstrap": {"image": "virtual-companion-runtime:local",
                          "command": ["bootstrap"], "restart": "no"},
            "minio": {"image": "virtual-companion-minio:local",
                      "volumes": [{"type": "volume", "source": "minio-data",
                                   "target": "/data", "volume": {}}]},
            "minio-init": {"image": "virtual-companion-minio:local",
                           "restart": "no"},
            "runtime": {
                "image": "virtual-companion-runtime:local",
                "environment": {
                    "VC_MODE": "full",
                    "VC_HTTP_ORIGINS": "https://localhost",
                    "VC_DB_DSN": "postgres://vc_runtime_login:x@db:5432/vc?sslmode=disable",
                    "VC_PROVIDER_ENDPOINT": "http://127.0.0.1:19091/v1/chat/completions",
                },
                "volumes": [],
            },
            "caddy": {
                "build": {"context": REPO, "dockerfile": "ops/deploy/Dockerfile.web"},
                "depends_on": {"runtime": {"condition": "service_healthy"}},
                "ports": [
                    {"mode": "ingress", "target": 80, "published": "80", "protocol": "tcp"},
                    {"mode": "ingress", "target": 443, "published": "443", "protocol": "tcp"},
                ],
                "volumes": [
                    {"type": "volume", "source": "caddy-data", "target": "/data", "volume": {}},
                ],
            },
        },
        "volumes": {k: vol(k) for k in ("db-data", "minio-data", "caddy-data", "caddy-config")},
        "networks": {"default": {"name": f"{project}_default"}},
    }


TRIAL = "vcg12c-test"
RENDER_KW = dict(project=TRIAL, tag="t1", https_port=18447, repo_root=REPO,
                 fake_port=19091,
                 runtime_env={"VC_PROVIDER_ENABLED": "true"})


def rendered_fixture() -> dict:
    return render_stack.apply_overrides(canonical_fixture(), **RENDER_KW)


class RenderValidationTest(unittest.TestCase):
    def test_valid_render_passes(self):
        self.assertEqual(
            render_stack.validate_render(rendered_fixture(), project=TRIAL,
                                         repo_root=REPO, https_port=18447), [])

    def test_r57_incident_frozen_deploy_names_rejected(self):
        # Canonical output rendered WITHOUT -p: project renamed at the top but
        # the volume names stay deploy_*. Must be rejected before creation.
        bad = canonical_fixture(project="deploy")
        bad["name"] = TRIAL
        with self.assertRaises(AssertionError) as ctx:
            self.assertEqual(
                render_stack.validate_render(bad, project=TRIAL, repo_root=REPO,
                                             https_port=18447), [])
        self.assertIn("not project-scoped", str(ctx.exception))

    def test_external_resources_rejected(self):
        bad = rendered_fixture()
        bad["volumes"]["db-data"]["external"] = True
        errors = render_stack.validate_render(bad, project=TRIAL, repo_root=REPO,
                                              https_port=18447)
        self.assertTrue(any("external" in e for e in errors))

    def test_non_loopback_published_port_rejected(self):
        bad = rendered_fixture()
        bad["services"]["db"]["ports"] = [
            {"mode": "ingress", "target": 5432, "published": "5432",
             "protocol": "tcp", "host_ip": "0.0.0.0"}]
        errors = render_stack.validate_render(bad, project=TRIAL, repo_root=REPO,
                                              https_port=18447)
        self.assertTrue(any("only caddy may" in e for e in errors))
        self.assertTrue(any("non-loopback host_ip" in e for e in errors))

    def test_caddy_wide_open_port_rejected(self):
        bad = rendered_fixture()
        bad["services"]["caddy"]["ports"] = [
            {"mode": "ingress", "target": 443, "published": "443", "protocol": "tcp"}]
        errors = render_stack.validate_render(bad, project=TRIAL, repo_root=REPO,
                                              https_port=18447)
        self.assertTrue(any("loopback" in e for e in errors))

    def test_embedded_host_in_published_rejected(self):
        bad = rendered_fixture()
        bad["services"]["caddy"]["ports"] = [
            {"mode": "ingress", "target": 443,
             "published": "127.0.0.1:18447", "protocol": "tcp"}]
        errors = render_stack.validate_render(bad, project=TRIAL, repo_root=REPO,
                                              https_port=18447)
        self.assertTrue(any("embeds a host address" in e for e in errors))

    def test_relative_and_foreign_binds_rejected(self):
        bad = rendered_fixture()
        bad["services"]["db"]["volumes"][1]["source"] = "ops/deploy/db-init"
        bad2 = rendered_fixture()
        bad2["services"]["db"]["volumes"][1]["source"] = "/etc"
        for candidate in (bad, bad2):
            errors = render_stack.validate_render(candidate, project=TRIAL,
                                                  repo_root=REPO, https_port=18447)
            self.assertTrue(any("bind" in e for e in errors))

    def test_privilege_escalation_rejected(self):
        bad = rendered_fixture()
        bad["services"]["runtime"]["privileged"] = True
        bad["services"]["minio"]["cap_add"] = ["SYS_PTRACE"]
        errors = render_stack.validate_render(bad, project=TRIAL, repo_root=REPO,
                                              https_port=18447)
        self.assertTrue(any("privileged" in e for e in errors))
        self.assertTrue(any("cap_add" in e for e in errors))

    def test_non_loopback_provider_endpoint_rejected(self):
        bad = rendered_fixture()
        bad["services"]["runtime"]["environment"]["VC_PROVIDER_ENDPOINT"] = \
            "http://fake-provider:19091/v1/chat/completions"
        errors = render_stack.validate_render(bad, project=TRIAL, repo_root=REPO,
                                              https_port=18447)
        self.assertTrue(any("loopback" in e and "provider" in e for e in errors))


class ApplyOverridesTest(unittest.TestCase):
    def test_names_images_ports_env(self):
        out = rendered_fixture()
        self.assertEqual(out["name"], TRIAL)
        self.assertEqual(out["volumes"]["db-data"]["name"], f"{TRIAL}_db-data")
        self.assertEqual(out["networks"]["default"]["name"], f"{TRIAL}_default")
        self.assertEqual(out["services"]["runtime"]["image"],
                         "virtual-companion-runtime:t1")
        self.assertEqual(out["services"]["minio"]["image"],
                         "virtual-companion-minio:t1")
        self.assertEqual(out["services"]["caddy"]["image"], "virtual-companion-caddy:t1")
        self.assertEqual(out["services"]["caddy"]["ports"],
                         [{"mode": "ingress", "target": 443, "published": "18447",
                           "protocol": "tcp", "host_ip": "127.0.0.1"}])
        self.assertNotIn("ports", out["services"]["db"])
        self.assertEqual(out["services"]["runtime"]["environment"]
                         ["VC_PROVIDER_ENABLED"], "true")
        self.assertEqual(out["services"]["runtime"]["environment"]["VC_MODE"], "full")
        fp = out["services"]["fake-provider"]
        self.assertEqual(fp["network_mode"], "service:runtime")
        self.assertEqual(fp["volumes"][0]["source"],
                         f"{REPO}/scripts/measure/g12-go-capacity/fake_provider.mjs")


class ProviderParameterizationTest(unittest.TestCase):
    """The journey-dialect provider script and env can be substituted through
    the same fake-provider service. The Vue TLS launcher that used this seam
    was removed with the old frontend. The G12 default render (fixture script
    + timing knobs) stays pinned, and the substituted bind must live inside
    the repo like every other bind."""

    def test_default_provider_fixture_unchanged(self):
        fp = render_stack.fake_provider_service(REPO, 19091)
        self.assertEqual(fp["volumes"][0]["source"],
                         f"{REPO}/scripts/measure/g12-go-capacity/fake_provider.mjs")
        self.assertEqual(fp["volumes"][0]["target"], "/app/fake_provider.mjs")
        self.assertEqual(fp["command"], ["node", "fake_provider.mjs"])
        self.assertEqual(fp["environment"]["E2E_PROVIDER_HOST"], "127.0.0.1")
        self.assertEqual(fp["environment"]["E2E_PROVIDER_PORT"], "19091")
        self.assertEqual(fp["environment"]["G12_FIRST_TOKEN_MS"], "200")

    def test_custom_provider_script_and_env(self):
        rendered = render_stack.apply_overrides(
            canonical_fixture(), project=TRIAL, tag="t1", https_port=18457,
            repo_root=REPO, fake_port=19090,
            runtime_env={"VC_PROVIDER_ENABLED": "true"},
            provider_script="scripts/dev/e2e-provider.mjs",
            provider_env={"E2E_PROVIDER_REQUEST_LOG":
                          "/tmp/vc-e2e-provider-requests-19090.log"})
        fp = rendered["services"]["fake-provider"]
        self.assertEqual(fp["volumes"][0]["source"],
                         f"{REPO}/scripts/dev/e2e-provider.mjs")
        self.assertEqual(fp["volumes"][0]["target"], "/app/e2e-provider.mjs")
        self.assertEqual(fp["command"], ["node", "e2e-provider.mjs"])
        self.assertNotIn("G12_FIRST_TOKEN_MS", fp["environment"])
        self.assertEqual(fp["environment"]["E2E_PROVIDER_PORT"], "19090")
        self.assertEqual(fp["environment"]["E2E_PROVIDER_REQUEST_LOG"],
                         "/tmp/vc-e2e-provider-requests-19090.log")
        self.assertEqual(fp["network_mode"], "service:runtime")
        # The substituted fixture still passes every ownership guard.
        self.assertEqual(
            render_stack.validate_render(rendered, project=TRIAL,
                                         repo_root=REPO, https_port=18457), [])

    def test_provider_script_escaping_repo_rejected(self):
        # A provider script whose bind path normalizes outside the repo must
        # be refused before anything is created (ownership guard, not a
        # name heuristic).
        rendered = render_stack.apply_overrides(
            canonical_fixture(), project=TRIAL, tag="t1", https_port=18457,
            repo_root=REPO, fake_port=19090, runtime_env={},
            provider_script="scripts/../../../outside.mjs")
        errors = render_stack.validate_render(rendered, project=TRIAL,
                                              repo_root=REPO, https_port=18457)
        self.assertTrue(any("binds outside the repo" in e for e in errors))

    def test_provider_script_symlink_escape_rejected(self):
        # A provider script that IS inside the repo but is a symlink whose
        # target lives outside must be refused on the RESOLVED path — the
        # public --provider-script input makes this reachable, so the bind
        # boundary is judged after realpath (VC-R79 Root audit).
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            outside = os.path.join(tmp, "outside.mjs")
            Path(outside).write_text("#!/usr/bin/env node\n")
            fake_repo = os.path.join(tmp, "repo")
            os.makedirs(os.path.join(fake_repo, "scripts"))
            os.symlink(outside, os.path.join(fake_repo, "scripts", "linked.mjs"))
            rendered = render_stack.apply_overrides(
                canonical_fixture(), project=TRIAL, tag="t1", https_port=18457,
                repo_root=fake_repo, fake_port=19090, runtime_env={},
                provider_script="scripts/linked.mjs")
            errors = render_stack.validate_render(rendered, project=TRIAL,
                                                  repo_root=fake_repo,
                                                  https_port=18457)
            self.assertTrue(
                any("binds outside the repo" in e for e in errors),
                f"symlink escape not rejected: {errors}")


def frame(statuses=("OK", "OK", "OK", "OK"), ts=1.0, cpu=1_000_000,
          missing=(), pid1_rss=1000, epoch="2026-10-22T00:00:00Z",
          sampled_at=None):
    comps, cpus = {}, {}
    rss_by = {"db": 500, "runtime": pid1_rss, "minio": 800, "caddy": 400}
    for comp, status in zip(collector.COMPONENTS, statuses):
        pids = ([{"pid": 1, "uid": 999, "comm": comp, "rss_kb": rss_by[comp],
                  "pss_kb": rss_by[comp], "fds": 10}]
                if status != "NOT_AVAILABLE" else [])
        comps[comp] = {"status": status, "rss_kb": rss_by[comp] if pids else None,
                       "pss_kb": rss_by[comp] if pids else None, "n_pids": len(pids),
                       "pids": pids, "missing": list(missing) if comp == "db" else []}
        # Collection-side CPU entry shape: epoch is State.StartedAt (None when
        # the inspect failed), sampled_at the actual capture moment.
        cpus[comp] = {"total_usage_ns": cpu, "system_usage_ns": 2, "online_cpus": 10,
                      "memory_usage_bytes": 1, "epoch": epoch,
                      "sampled_at": ts if sampled_at is None else sampled_at}
    return {"ts": ts, "components": comps, "cpu": cpus}


class AggregationTest(unittest.TestCase):
    def test_partial_component_blocks_complete_b(self):
        partial = frame(statuses=("PARTIAL", "OK", "OK", "OK"))
        self.assertFalse(collector.b_frame_complete(partial))
        ok = frame()
        self.assertTrue(collector.b_frame_complete(ok))

    def test_b_peak_uses_same_frame_sums_only(self):
        frames = [
            frame(ts=1.0, pid1_rss=1000),                       # sum 2700
            frame(ts=2.0, statuses=("PARTIAL", "OK", "OK", "OK"),
                  pid1_rss=5000),                               # excluded though db read high
            frame(ts=3.0, pid1_rss=1200),                       # sum 2900
        ]
        series, peak = collector.b_same_frame_sums(frames)
        self.assertEqual(len(series), 2)
        self.assertEqual(peak["b_rss_peak_kb"], 2900)

    def test_missing_processes_reported_not_zeroed(self):
        reader = {"ts_ns": 1_000_000_000, "target_cgroup": "/../target",
                  "pids": [
                      {"pid": 1, "uid": 999, "comm": "postgres", "rss_kb": 100,
                       "pss_kb": 90, "fds": 5}],
                  "missing": [{"pid": 42, "comm": "pg_isready",
                               "reason": "smaps_rollup_unreadable"}]}
        status, rss, pss, n = collector.component_mem(collector.parse_reader_line(
            json.dumps(reader)))
        self.assertEqual((status, rss, pss, n), ("PARTIAL", 100, 90, 1))

    def test_not_available_when_no_reader_frame(self):
        self.assertEqual(collector.component_mem(None),
                         ("NOT_AVAILABLE", None, None, 0))

    def test_empty_pid_set_is_not_a_complete_zero(self):
        # Reader failed to resolve the target cgroup (or the target's
        # processes are gone): pids and missing both empty must surface as
        # NOT_AVAILABLE, never as a complete B sum of 0.
        for reader in ({"ts_ns": 1, "target_cgroup": "", "pids": [], "missing": []},
                       {"ts_ns": 1, "target_cgroup": "/../t", "pids": [], "missing": []}):
            self.assertEqual(collector.component_mem(reader),
                             ("NOT_AVAILABLE", None, None, 0))


class CounterLifecycleTest(unittest.TestCase):
    # The five CPU-window validity classes. Frames carry the collection-side
    # entry contract: epoch (State.StartedAt, None when inspect failed) and
    # sampled_at (the actual counter capture moment, not the loop frame ts).

    def test_monotonic_same_epoch_is_valid(self):
        frames = [frame(ts=1.0, cpu=10**9, sampled_at=1.25),
                  frame(ts=2.0, cpu=3 * 10**9, sampled_at=2.25)]
        out = collector.cpu_component_window(frames, "runtime")
        self.assertEqual(out["status"], "VALID")
        self.assertIsNone(out["reason"])
        self.assertEqual(out["cpu_delta_ns"], 2 * 10**9)
        self.assertFalse(out["counter_reset"])
        self.assertFalse(out["epoch_changed"])
        # The window spans the actual capture moments, never the frame ts.
        self.assertEqual(out["cpu_window"], [1.25, 2.25])

    def test_missing_frame_between_valid_endpoints_is_partial(self):
        frames = [frame(ts=1.0, cpu=10**9), frame(ts=2.0, cpu=2 * 10**9),
                  frame(ts=3.0, cpu=3 * 10**9)]
        frames[1]["cpu"]["db"] = None
        out = collector.cpu_component_window(frames, "db")
        self.assertEqual(out["status"], "PARTIAL")
        self.assertEqual(out["reason"], "stats_missing_frames")
        self.assertEqual(out["samples"], 2)
        self.assertEqual(out["stats_missing_frames"], 1)
        # Cumulative counters still yield the endpoint delta, but consumers
        # must only read it together with the PARTIAL status and the count.
        self.assertEqual(out["cpu_delta_ns"], 2 * 10**9)

    def test_sample_missing_epoch_is_partial_not_valid(self):
        # The inspect failed for one sample: continuity is unprovable, so the
        # window can never be VALID even though the counter looks monotonic.
        frames = [frame(ts=1.0, cpu=10**9, epoch=None),
                  frame(ts=2.0, cpu=3 * 10**9)]
        out = collector.cpu_component_window(frames, "runtime")
        self.assertEqual(out["status"], "PARTIAL")
        self.assertEqual(out["reason"], "epoch_missing")
        self.assertEqual(out["cpu_delta_ns"], 2 * 10**9)
        self.assertIn(None, out["epochs"])
        self.assertFalse(out["epoch_changed"])

    def test_same_cid_epoch_change_with_rising_counter_is_invalid(self):
        # A same-CID restart whose new counter already exceeds the old value
        # is only detectable via the StartedAt epoch; a counter-only check
        # would call it monotonic and overcount.
        frames = [frame(ts=1.0, cpu=10**9, epoch="2026-10-22T00:00:00Z"),
                  frame(ts=2.0, cpu=5 * 10**9, epoch="2026-10-22T00:01:00Z")]
        out = collector.cpu_component_window(frames, "db")
        self.assertEqual(out["status"], "INVALID")
        self.assertEqual(out["reason"], "epoch_changed")
        self.assertTrue(out["epoch_changed"])
        self.assertFalse(out["counter_reset"])
        self.assertIsNone(out["cpu_delta_ns"])

    def test_counter_decrease_reset_is_invalid_not_clamped(self):
        frames = [frame(ts=1.0, cpu=3 * 10**9), frame(ts=2.0, cpu=5 * 10**8)]
        out = collector.cpu_component_window(frames, "db")
        self.assertEqual(out["status"], "INVALID")
        self.assertTrue(out["counter_reset"])
        self.assertIsNone(out["cpu_delta_ns"])

    def test_single_sample_is_not_a_valid_zero_delta(self):
        # One valid endpoint cannot bound an interval; it must surface as an
        # invalid delta, not as delta=0 (a real collection failure or an
        # exited container must never look like "zero CPU measured").
        frames = [frame(ts=1.0, cpu=10**9)]
        out = collector.cpu_component_window(frames, "runtime")
        self.assertEqual(out["status"], "INVALID")
        self.assertIsNone(out["cpu_delta_ns"])
        self.assertEqual(out["reason"], "insufficient_samples")
        self.assertEqual(out["samples"], 1)

    def test_missing_stats_frames_counted(self):
        # Missing frames also shrink the endpoint count: one survivor cannot
        # bound an interval, and the missing frames stay visible.
        frames = [frame(ts=1.0, cpu=10**9), frame(ts=2.0, cpu=2 * 10**9)]
        frames[1]["cpu"]["db"] = None
        out = collector.cpu_component_window(frames, "db")
        self.assertEqual(out["stats_missing_frames"], 1)
        self.assertEqual(out["status"], "INVALID")
        self.assertIsNone(out["cpu_delta_ns"])
        self.assertEqual(out["reason"], "insufficient_samples")

    def test_missing_samples_reported(self):
        frames = [frame(ts=1.0)]
        frames[0]["cpu"]["caddy"] = None
        out = collector.cpu_component_window(frames, "caddy")
        self.assertEqual(out["samples"], 0)
        self.assertEqual(out["status"], "INVALID")
        self.assertIsNone(out["cpu_delta_ns"])


class AWindowTest(unittest.TestCase):
    def test_pid1_extraction_and_peaks(self):
        frames = [frame(ts=1.0, pid1_rss=1000), frame(ts=2.0, pid1_rss=1400)]
        out = collector.a_window(frames)
        self.assertEqual(out["a_rss_peak_kb"], 1400)
        self.assertEqual(out["frames_with_pid1"], 2)

    def test_analyze_windows_and_status_counts(self):
        frames = [frame(ts=0.5), frame(ts=1.0), frame(ts=2.0),
                  frame(ts=3.0, statuses=("PARTIAL", "OK", "OK", "OK"))]
        out = collector.analyze_frames(frames, 1.0, 2.0)
        self.assertEqual(out["frames_in_window"], 2)
        self.assertEqual(out["complete_b_frames"], 2)
        self.assertEqual(out["component_status_frames"]["db"]["PARTIAL"], 0)
        self.assertEqual(out["b"]["components"]["runtime"]["status"], "VALID")
        self.assertEqual(out["b"]["components"]["runtime"]["cpu_delta_ns"], 0)
        self.assertEqual(out["b"]["same_frame_peak"]["b_rss_peak_kb"], 2700)


class HelperReceiptTest(unittest.TestCase):
    """The collector helper create must persist the docker-run CID receipt
    BEFORE any follow-up query: an inspect failure may lose the mounts
    metadata but never the CID cleanup needs (VC-R59)."""

    def _cli(self, run_stdout, inspect_rc, inspect_stdout=""):
        def fake_cli(*argv, check=True, capture=True):
            if argv[0] == "run":
                return subprocess.CompletedProcess(
                    args=list(argv), returncode=0, stdout=run_stdout,
                    stderr="")
            return subprocess.CompletedProcess(
                args=list(argv), returncode=inspect_rc, stdout=inspect_stdout,
                stderr="simulated inspect failure")

        return fake_cli

    def test_inspect_failure_keeps_the_cid_receipt(self):
        persisted = []
        orig = collector.docker_cli
        collector.docker_cli = self._cli("cid-helper-0001\n", 1)
        try:
            cid = collector.create_helper_container(
                "img:tag", "h1", ["--network", "none"], ["/x.sh"],
                "observer", persisted.append)
        finally:
            collector.docker_cli = orig
        self.assertEqual(cid, "cid-helper-0001")
        self.assertEqual(persisted, [{"name": "h1", "cid": "cid-helper-0001",
                                      "kind": "observer", "mounts": None}])

    def test_metadata_enrichment_replaces_not_duplicates(self):
        persisted = []
        inspect_payload = json.dumps([{"Mounts": [{"Type": "bind"}]}])
        orig = collector.docker_cli
        collector.docker_cli = self._cli("cid-helper-0002\n", 0,
                                         inspect_payload)
        try:
            collector.create_helper_container(
                "img:tag", "h1", [], ["/x.sh"], "reader-db",
                lambda entry: persisted.append(dict(entry)))
        finally:
            collector.docker_cli = orig
        # first receipt persisted immediately (mounts still unknown), then
        # the same entry is enriched and re-persisted
        self.assertEqual(len(persisted), 2)
        self.assertEqual(persisted[0],
                         {"name": "h1", "cid": "cid-helper-0002",
                          "kind": "reader-db", "mounts": None})
        self.assertEqual(persisted[-1]["mounts"], [{"Type": "bind"}])
        self.assertEqual(persisted[-1]["cid"], "cid-helper-0002")


if __name__ == "__main__":
    unittest.main(verbosity=2)

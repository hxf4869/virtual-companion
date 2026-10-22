#!/usr/bin/env python3
"""Render the private, trial-scoped measurement stack from ops/deploy (VC-R58).

The G12 harness measures the production-derived resident stack (Caddy +
companiond runtime + PostgreSQL + MinIO). This module pushes
ops/deploy/docker-compose.yml through `docker compose config` canonical
rendering WITH the trial project name, then rewrites trial-scoped resources
and validates the result before anything is created.

The `-p` on the config render is the direct regression for the VC-R57
incident: rendering canonical config without the project name left the four
volume names frozen as `deploy_*`, so a "renamed" project silently kept the
production names. validate_render() additionally rejects any non-project
volume/network name, external resources, non-loopback published ports,
relative binds, and privilege escalations. Both pure functions are unit
tested in test_collector.py. Two production callers share this renderer:
run.sh (G12 measurement) and scripts/dev/e2e-tls-stack.sh (VC-R79 TLS E2E),
which only substitutes the fake-provider fixture script and env — every
ownership/safety guard is identical for both.
"""

import argparse
import json
import os
import re
import subprocess
import sys

from resources import NONCE_LABEL

PRODUCTION_COMPOSE = "ops/deploy/docker-compose.yml"
MEASURED_COMPONENTS = ("db", "runtime", "minio", "caddy")
PROJECT_RE = re.compile(r"^[a-z0-9][a-z0-9_-]*$")
LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "::1"}
# Privilege/host escapes the measurement fixture must never add (the resident
# stack is measured with default container capabilities, like production).
FORBIDDEN_SERVICE_KEYS = ("privileged", "cap_add", "devices", "ipc", "pid")


def _with_nonce_label(labels, nonce):
    """Merge the per-invocation nonce into a label mapping (compose dict
    form, or the list form normalized to a dict)."""
    if isinstance(labels, dict):
        out = dict(labels)
    elif labels:
        out = {}
        for item in labels:
            key, _, value = str(item).partition("=")
            out[key] = value
    else:
        out = {}
    out[NONCE_LABEL] = nonce
    return out


def canonicalize(production_compose: str, env_file: str, project: str) -> dict:
    """Run `docker compose config` with the trial project pinned (-p)."""
    cmd = ["docker", "compose", "--env-file", env_file, "-f", production_compose,
           "-p", project, "config", "--format", "json"]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"docker compose config failed ({proc.returncode}): "
                           f"{proc.stderr.strip()}")
    return json.loads(proc.stdout)


def fake_provider_service(repo_root: str, fake_port: int, nonce=None, *,
                          script: str = None, extra_env: dict = None) -> dict:
    """Fixture-only fake OpenAI provider sharing the runtime network namespace.

    It binds 127.0.0.1 inside the runtime's netns because the backend bounds
    VC_PROVIDER_ALLOW_LOOPBACK_HTTP to loopback literals only (config.go
    isLoopbackHost); the service-name DNS form is intentionally invalid. The
    provider is its own container/cgroup and is not one of the four measured
    B components; /g12/stats is reached through the observer container that
    shares the same netns, so nothing is published.

    script/extra_env serve the TLS E2E launcher (VC-R79): it swaps in the
    journey-dialect scripts/dev/e2e-provider.mjs and its request-log env while
    keeping the same netns/isolation shape. The G12 timing knobs stay on the
    default fake_provider.mjs fixture only.
    """
    default_fixture = script is None
    script = script or "scripts/measure/g12-go-capacity/fake_provider.mjs"
    script_name = script.rsplit("/", 1)[-1]
    environment = {
        "E2E_PROVIDER_HOST": "127.0.0.1",
        "E2E_PROVIDER_PORT": str(fake_port),
    }
    if default_fixture:
        environment.update({
            "G12_FIRST_TOKEN_MS": "200",
            "G12_DELTA_MS": "50",
            "G12_CHUNKS": "8",
            "G12_HOLD_MS": "0",
        })
    if extra_env:
        environment.update({k: str(v) for k, v in extra_env.items()})
    service = {
        "image": "node:20-bookworm-slim",
        "pull_policy": "missing",
        "network_mode": "service:runtime",
        "depends_on": {"runtime": {"condition": "service_started"}},
        "working_dir": "/app",
        "volumes": [{
            "type": "bind",
            "source": f"{repo_root}/{script}",
            "target": f"/app/{script_name}",
            "read_only": True,
        }],
        "environment": environment,
        "command": ["node", script_name],
        "restart": "no",
    }
    if nonce:
        service["labels"] = _with_nonce_label(service.get("labels"), nonce)
    return service


def apply_overrides(canonical: dict, *, project: str, tag: str, https_port: int,
                    repo_root: str, fake_port: int, runtime_env: dict,
                    nonce: str = None, provider_script: str = None,
                    provider_env: dict = None) -> dict:
    """Rewrite the canonical production config into the trial fixture (pure)."""
    out = json.loads(json.dumps(canonical))
    out["name"] = project

    images = {
        "virtual-companion-runtime:local": f"virtual-companion-runtime:{tag}",
        "virtual-companion-minio:local": f"virtual-companion-minio:{tag}",
    }
    for service in out["services"].values():
        image = service.get("image")
        if image in images:
            service["image"] = images[image]
        # Trial-unique tag for the built edge image (production builds it
        # without an explicit image name).
        if nonce:
            service["labels"] = _with_nonce_label(service.get("labels"), nonce)
    if "caddy" in out["services"] and "build" in out["services"]["caddy"]:
        out["services"]["caddy"]["image"] = f"virtual-companion-caddy:{tag}"

    # The only published port in the fixture: loopback Caddy TLS (canonical
    # long form — host_ip and published are separate fields).
    out["services"]["caddy"]["ports"] = [{
        "mode": "ingress", "target": 443, "published": str(https_port),
        "protocol": "tcp", "host_ip": "127.0.0.1",
    }]
    # db/runtime/minio never publish host ports (production db already does
    # not; strip defensively so a future production edit cannot leak a port).
    for name in ("db", "runtime", "minio", "migrate", "bootstrap", "minio-init"):
        out["services"].get(name, {}).pop("ports", None)

    runtime = out["services"]["runtime"]
    env = dict(runtime.get("environment", {}))
    env.update({k: str(v) for k, v in runtime_env.items()})
    runtime["environment"] = env

    # Recursively pin every volume/network name to this trial's project scope
    # and stamp the per-invocation nonce: the nonce label is the creation
    # receipt cleanup relies on (see resources.py).
    prefix = f"{project}_"
    for key, vol in out.get("volumes", {}).items():
        vol.pop("external", None)
        vol["name"] = f"{prefix}{key}"
        if nonce:
            vol["labels"] = _with_nonce_label(vol.get("labels"), nonce)
    for key, net in out.get("networks", {}).items():
        net.pop("external", None)
        net["name"] = f"{prefix}{key}"
        if nonce:
            net["labels"] = _with_nonce_label(net.get("labels"), nonce)

    out["services"]["fake-provider"] = fake_provider_service(
        repo_root, fake_port, nonce=nonce, script=provider_script,
        extra_env=provider_env)
    return out


def validate_render(rendered: dict, *, project: str, repo_root: str,
                    https_port: int, nonce: str = None) -> list:
    """Return human-readable violations; empty list means safe to create.

    Guards the VC-R57 incident class: every created resource name must be
    project-scoped, nothing external may be reused, only the loopback Caddy
    TLS port may be published, every bind must be an absolute repo path, and
    no service may escalate privileges. With a nonce, every service, volume,
    and network must also carry it — the creation receipt cleanup relies on.
    """
    errors = []
    if not PROJECT_RE.match(project):
        errors.append(f"project name {project!r} is not a valid compose project")
    if rendered.get("name") != project:
        errors.append(f"rendered name {rendered.get('name')!r} != project {project!r}")
    # Bind boundaries are judged on RESOLVED paths: a bind inside the repo
    # whose target is a symlink escaping it (reachable through the public
    # --provider-script input) is outside, exactly like a `..` escape.
    repo_real = os.path.realpath(repo_root)

    prefix = f"{project}_"
    for kind in ("volumes", "networks"):
        for key, spec in (rendered.get(kind) or {}).items():
            name = (spec or {}).get("name")
            if name != f"{prefix}{key}":
                errors.append(f"{kind}[{key}].name {name!r} is not project-scoped "
                              f"(want {prefix}{key})")
            if (spec or {}).get("external"):
                errors.append(f"{kind}[{key}] is external; the fixture must create "
                              "its own resources")
            if nonce and (spec or {}).get("labels", {}).get(NONCE_LABEL) != nonce:
                errors.append(f"{kind}[{key}] missing the nonce creation receipt")

    for svc, service in rendered.get("services", {}).items():
        for key in FORBIDDEN_SERVICE_KEYS:
            if service.get(key) not in (None, False):
                errors.append(f"service {svc} sets {key}; forbidden in the fixture")
        if service.get("security_opt"):
            errors.append(f"service {svc} sets security_opt; forbidden in the fixture")
        if nonce and (service.get("labels") or {}).get(NONCE_LABEL) != nonce:
            errors.append(f"service {svc} missing the nonce creation receipt")
        for vol in service.get("volumes", []):
            if vol.get("type") == "volume":
                if vol.get("source") not in (rendered.get("volumes") or {}):
                    errors.append(f"service {svc} mounts undeclared volume "
                                  f"{vol.get('source')!r}")
            elif vol.get("type") == "bind":
                raw_src = vol.get("source", "")
                if not raw_src.startswith("/"):
                    errors.append(f"service {svc} has relative bind {raw_src!r}")
                else:
                    src = os.path.realpath(raw_src)
                    if not (src.startswith(repo_real + "/") or src == repo_real):
                        errors.append(f"service {svc} binds outside the repo: "
                                      f"{raw_src!r}")
        ports = service.get("ports") or []
        for p in ports:
            host_ip = p.get("host_ip")
            if host_ip is not None and host_ip not in LOOPBACK_HOSTS:
                errors.append(f"service {svc} publishes non-loopback host_ip "
                              f"{host_ip!r}")
            published = str(p.get("published", ""))
            if ":" in published:
                errors.append(f"service {svc} port spec {published!r} embeds a "
                              "host address; use host_ip (docker rejects it)")
        if svc == "caddy":
            if len(ports) != 1 or any(
                    p.get("target") != 443 or p.get("host_ip") != "127.0.0.1"
                    or str(p.get("published")) != str(https_port) for p in ports):
                errors.append(f"caddy ports {ports} != loopback "
                              f"127.0.0.1:{https_port}->443")
        elif ports:
            errors.append(f"service {svc} publishes ports {ports}; only caddy may")

    if "fake-provider" not in rendered.get("services", {}):
        errors.append("fake-provider service missing from the fixture")
    else:
        fp = rendered["services"]["fake-provider"]
        if fp.get("network_mode") != "service:runtime":
            errors.append("fake-provider must share the runtime network namespace")
        host = str(rendered["services"]["runtime"]["environment"]
                   .get("VC_PROVIDER_ENDPOINT", ""))
        m = re.match(r"https?://([^/:]+)", host)
        if not m or m.group(1) not in LOOPBACK_HOSTS:
            errors.append(f"runtime provider endpoint {host!r} is not a loopback "
                          "literal; the SSRF boundary must stay intact")

    missing = [c for c in MEASURED_COMPONENTS if c not in rendered.get("services", {})]
    if missing:
        errors.append(f"measured components missing from render: {missing}")
    return errors


def reparse_rendered(out_path: str, env_file: str, project: str) -> dict:
    """Re-read the rendered file through `docker compose config` before any up.

    Local parse only (no daemon writes): this catches spec shapes compose
    itself would reject — e.g. a published value embedding a host address —
    and returns compose's own normalization, which is then validated again.
    """
    cmd = ["docker", "compose", "--env-file", env_file, "-f", out_path,
           "-p", project, "config", "--format", "json"]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"rendered file failed docker compose config "
                           f"({proc.returncode}): {proc.stderr.strip()[-800:]}")
    return json.loads(proc.stdout)


def _env_file_dict(path: str) -> dict:
    """KEY=VALUE lines (comments/blank lines skipped) -> dict."""
    env = {}
    with open(path) as fh:
        for line in fh:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                env[key] = value
    return env


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--project", required=True)
    ap.add_argument("--env-file", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--repo-root", required=True)
    ap.add_argument("--tag", required=True)
    ap.add_argument("--https-port", type=int, default=18447)
    ap.add_argument("--fake-provider-port", type=int, default=19091)
    ap.add_argument("--runtime-env", default="",
                    help="path to KEY=VALUE lines merged into the runtime env")
    ap.add_argument("--provider-script", default="",
                    help="repository-relative provider script for the "
                         "fake-provider service (default: the G12 "
                         "fake_provider.mjs fixture)")
    ap.add_argument("--provider-env", default="",
                    help="path to KEY=VALUE lines merged into the provider "
                         "env (serves the TLS E2E launcher; VC-R79)")
    ap.add_argument("--nonce", default="",
                    help="per-invocation creation receipt stamped on every "
                         "service/volume/network label")
    args = ap.parse_args()

    repo_root = args.repo_root.rstrip("/")
    runtime_env = _env_file_dict(args.runtime_env) if args.runtime_env else {}
    provider_env = _env_file_dict(args.provider_env) if args.provider_env else None
    provider_script = args.provider_script or None

    canonical = canonicalize(f"{repo_root}/{PRODUCTION_COMPOSE}",
                             args.env_file, args.project)
    nonce = args.nonce or None
    rendered = apply_overrides(
        canonical, project=args.project, tag=args.tag,
        https_port=args.https_port, repo_root=repo_root,
        fake_port=args.fake_provider_port, runtime_env=runtime_env,
        nonce=nonce, provider_script=provider_script,
        provider_env=provider_env)

    errors = validate_render(rendered, project=args.project, repo_root=repo_root,
                             https_port=args.https_port, nonce=nonce)
    if errors:
        for e in errors:
            print(f"render validation FAILED: {e}", file=sys.stderr)
        return 1

    # The rendered file interpolates the synthetic secrets, so keep it private
    # (0600) and make docker compose itself parse the final file before any
    # resource is created; compose's normalization is validated once more.
    with open(args.out, "w") as fh:
        json.dump(rendered, fh, indent=1)
        fh.write("\n")
    os.chmod(args.out, 0o600)
    try:
        reparsed = reparse_rendered(args.out, args.env_file, args.project)
    except RuntimeError as exc:
        print(f"render round-trip FAILED: {exc}", file=sys.stderr)
        return 1
    errors = validate_render(reparsed, project=args.project, repo_root=repo_root,
                             https_port=args.https_port, nonce=nonce)
    if errors:
        for e in errors:
            print(f"round-trip validation FAILED: {e}", file=sys.stderr)
        return 1
    summary = {
        "project": args.project,
        "volumes": {k: v["name"] for k, v in rendered["volumes"].items()},
        "networks": {k: v["name"] for k, v in rendered["networks"].items()},
        "services": sorted(rendered["services"]),
    }
    print(json.dumps(summary))
    return 0


if __name__ == "__main__":
    sys.exit(main())

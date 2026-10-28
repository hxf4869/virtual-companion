#!/usr/bin/env python3
"""Deterministic direct-dependency license gate for Go, the frontend and the ST integration domain.

The Go / frontend domains are checked against the global ``allowedLicenseFamilies``.
The ``integrations/sillytavern`` domain (upstream.lock.json components, vendor.lock.json
self-hosted runtime assets, integrations/sillytavern/package.json) is checked against
``domainPolicies.stIntegration.allowedLicenseFamilies`` only; that list never widens the
Go / frontend policy.

``--root DIR`` points the gate at another repository root (used to prove the gate fails
on a deliberately bad input without touching the real files).
"""
from __future__ import annotations

import json
import re
import sys
from datetime import date
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
if len(sys.argv) >= 3 and sys.argv[1] == "--root":
    ROOT = Path(sys.argv[2]).resolve()
LICENSE_POLICY = ROOT / "scripts/checks/license-policy.yaml"
LICENSE_INVENTORY = ROOT / "scripts/checks/license-inventory.yaml"
ST_UPSTREAM_LOCK = ROOT / "integrations/sillytavern/upstream.lock.json"
ST_VENDOR_LOCK = ROOT / "integrations/sillytavern/vendor.lock.json"
ST_PACKAGE_JSON = ROOT / "integrations/sillytavern/package.json"
GO_REQUIRE = re.compile(r"^([^\s]+)\s+v[^\s]+(?:\s+//\s+indirect)?$")


def extract_go_dependencies(go_mod: Path) -> set[str]:
    """Return direct modules declared by backend/go.mod."""
    dependencies: set[str] = set()
    in_require_block = False
    for raw in go_mod.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if line == "require (":
            in_require_block = True
            continue
        if in_require_block and line == ")":
            in_require_block = False
            continue
        candidate = line
        if not in_require_block:
            if not line.startswith("require "):
                continue
            candidate = line.removeprefix("require ").strip()
        if not candidate or "// indirect" in candidate:
            continue
        match = GO_REQUIRE.fullmatch(candidate)
        if match:
            dependencies.add(match.group(1))
    return dependencies


def extract_frontend_dependencies(package_json: Path) -> set[tuple[str, str]]:
    data = json.loads(package_json.read_text(encoding="utf-8"))
    dependencies: set[tuple[str, str]] = set()
    for name in data.get("dependencies") or {}:
        dependencies.add((name, "dependencies"))
    for name in data.get("devDependencies") or {}:
        dependencies.add((name, "devDependencies"))
    return dependencies


def exception_is_active(entry: dict) -> tuple[bool, str | None]:
    expires_at = str(entry.get("expiresAt", "")).strip()
    if not expires_at:
        return False, "exception missing required field 'expiresAt'"
    try:
        parsed = date.fromisoformat(expires_at.split("T", 1)[0])
    except ValueError:
        return False, f"exception expiresAt is not ISO-8601: {expires_at!r}"
    if parsed <= date.today():
        return False, f"exception has expired (expiresAt={expires_at})"
    return True, None


def split_license_expression(expr: str) -> list[str]:
    """'CC-BY-4.0 AND OFL-1.1 AND MIT' -> each family must be allowed on its own."""
    parts = [p.strip().strip("()") for p in re.split(r"\s+AND\s+", str(expr))]
    return [p for p in parts if p]


def check_st_integration(policy: dict, inventory: dict, errors: list[str]) -> int:
    """Return the number of checked ST-domain items (0 when the domain is absent)."""
    domain = (policy.get("domainPolicies") or {}).get("stIntegration")
    if not isinstance(domain, dict):
        if ST_UPSTREAM_LOCK.exists() or ST_VENDOR_LOCK.exists():
            errors.append("license-policy.yaml: domainPolicies.stIntegration missing while ST locks exist")
        return 0
    allowed = {str(x) for x in domain.get("allowedLicenseFamilies", [])}
    checked = 0

    def require(label: str, expr: object) -> None:
        nonlocal checked
        checked += 1
        families = split_license_expression(str(expr or ""))
        if not families:
            errors.append(f"{label}: missing license")
            return
        for fam in families:
            if fam not in allowed:
                errors.append(f"{label}: license family '{fam}' not allowed for stIntegration")

    if ST_UPSTREAM_LOCK.exists():
        lock = json.loads(ST_UPSTREAM_LOCK.read_text(encoding="utf-8"))
        for comp in lock.get("components", []):
            require(f"upstream.lock.json component '{comp.get('id')}'", comp.get("license"))
    else:
        errors.append("integrations/sillytavern/upstream.lock.json missing")

    if ST_VENDOR_LOCK.exists():
        vendor = json.loads(ST_VENDOR_LOCK.read_text(encoding="utf-8"))
        for pkg in vendor.get("packages", []):
            require(f"vendor.lock.json package '{pkg.get('name')}@{pkg.get('version')}'", pkg.get("license"))
            for item in pkg.get("files", []):
                if item.get("license"):
                    require(f"vendor.lock.json file '{item.get('to')}'", item.get("license"))
        for src in vendor.get("local_sources", []):
            require(f"vendor.lock.json local source '{src.get('name')}'", src.get("license"))
    else:
        errors.append("integrations/sillytavern/vendor.lock.json missing")

    if ST_PACKAGE_JSON.exists():
        st_inventory = {
            str(e.get("name", "")).strip(): str(e.get("licenseFamily", "")).strip()
            for e in inventory.get("integrationDirectDependencies", [])
            if str(e.get("name", "")).strip()
        }
        for name, scope in sorted(extract_frontend_dependencies(ST_PACKAGE_JSON)):
            checked += 1
            family = st_inventory.get(name)
            if not family:
                errors.append(f"integrations/sillytavern/package.json: {scope} '{name}' is not in license-inventory.yaml")
            elif family not in allowed:
                errors.append(f"integrations/sillytavern/package.json: {scope} '{name}' has disallowed license family '{family}'")
    return checked


def main() -> int:
    policy = yaml.safe_load(LICENSE_POLICY.read_text(encoding="utf-8")) or {}
    inventory = yaml.safe_load(LICENSE_INVENTORY.read_text(encoding="utf-8")) or {}
    allowed = {str(item) for item in policy.get("allowedLicenseFamilies", [])}

    errors: list[str] = []
    for exception in inventory.get("exceptions", []):
        if not isinstance(exception, dict):
            errors.append("license-inventory.yaml: exception must be an object")
            continue
        for field in ("dependency", "licenseFamily", "reason"):
            if not str(exception.get(field, "")).strip():
                errors.append(
                    f"license-inventory.yaml: exception missing required field '{field}'"
                )
        active, error = exception_is_active(exception)
        if error:
            errors.append(f"license-inventory.yaml: {error}")
        elif active:
            allowed.add(str(exception["licenseFamily"]).strip())

    go_inventory = {
        str(entry.get("module", "")).strip(): str(entry.get("licenseFamily", "")).strip()
        for entry in inventory.get("goDirectDependencies", [])
        if str(entry.get("module", "")).strip()
    }
    go_dependencies = extract_go_dependencies(ROOT / "backend/go.mod")
    for module in sorted(go_dependencies):
        family = go_inventory.get(module)
        if not family:
            errors.append(
                f"backend/go.mod: direct module {module} is not in license-inventory.yaml"
            )
        elif family not in allowed:
            errors.append(
                f"backend/go.mod: direct module {module} has disallowed license family '{family}'"
            )

    frontend_inventory = {
        str(entry.get("name", "")).strip(): str(entry.get("licenseFamily", "")).strip()
        for entry in inventory.get("frontendDirectDependencies", [])
        if str(entry.get("name", "")).strip()
    }
    package_json = ROOT / "frontend/package.json"
    frontend_dependencies = extract_frontend_dependencies(package_json)
    for name, scope in sorted(frontend_dependencies):
        family = frontend_inventory.get(name)
        if not family:
            errors.append(
                f"frontend/package.json: {scope} '{name}' is not in license-inventory.yaml"
            )
        elif family not in allowed:
            errors.append(
                f"frontend/package.json: {scope} '{name}' has disallowed license family '{family}'"
            )

    st_checked = check_st_integration(policy, inventory, errors)

    if errors:
        for item in sorted(set(errors)):
            print(f"ERROR: {item}", file=sys.stderr)
        return 1

    total = len(go_dependencies) + len(frontend_dependencies)
    print(
        f"License inventory check: PASS ({total} direct dependencies: "
        f"{len(go_dependencies)} Go, {len(frontend_dependencies)} frontend; "
        f"stIntegration domain {st_checked} items)"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

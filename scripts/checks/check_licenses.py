#!/usr/bin/env python3
"""Deterministic direct-dependency license gate for Go and the frontend."""
from __future__ import annotations

import json
import re
import sys
from datetime import date
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
LICENSE_POLICY = ROOT / "scripts/checks/license-policy.yaml"
LICENSE_INVENTORY = ROOT / "scripts/checks/license-inventory.yaml"
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

    if errors:
        for item in sorted(set(errors)):
            print(f"ERROR: {item}", file=sys.stderr)
        return 1

    total = len(go_dependencies) + len(frontend_dependencies)
    print(
        f"License inventory check: PASS ({total} direct dependencies: "
        f"{len(go_dependencies)} Go, {len(frontend_dependencies)} frontend)"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

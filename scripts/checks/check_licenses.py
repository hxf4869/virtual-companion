#!/usr/bin/env python3
"""License inventory gate for canonical precheck.

Reads scripts/checks/license-policy.yaml (allowlist) and scripts/checks/license-inventory.yaml
(pre-recorded inventory), then discovers Maven <dependency> entries across all
pom.xml files and frontend/package.json dependencies, verifying that every direct
dependency is covered by the inventory and its declared license family is allowed.

Exception semantics: each entry in inventory `exceptions[]` carries
dependency / licenseFamily / reason / expiresAt. An exception is honored only
when expiresAt is an ISO-8601 date (or timestamp) strictly after today; an
expired or malformed exception is an error, never a silent pass.

This is a deterministic, local, <1s gate. It does NOT generate a full SBOM or
scan transitive dependencies or known vulnerabilities — that is the CI
supply-chain job's responsibility (cyclonedx + pnpm audit). Its sole purpose is
to block new dependencies with disallowed or unknown licenses from entering
the daily check (scripts/check.sh).
"""
from __future__ import annotations

import json
import os
import sys
import xml.etree.ElementTree as ET
from datetime import date
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
LICENSE_POLICY = ROOT / "scripts/checks/license-policy.yaml"
LICENSE_INVENTORY = ROOT / "scripts/checks/license-inventory.yaml"
NS = "{http://maven.apache.org/POM/4.0.0}"
PRUNED_DIRS = {
    ".git",
    ".gradle",
    ".idea",
    ".mvn-cache",
    ".pytest_cache",
    ".venv",
    "__pycache__",
    "build",
    "dist",
    "node_modules",
    "target",
}


def discover_pom_files(root: Path = ROOT) -> list[Path]:
    """Find all pom.xml files under root, excluding pruned build dirs."""
    result: list[Path] = []
    for directory, dirnames, filenames in os.walk(root):
        dirnames[:] = sorted(name for name in dirnames if name not in PRUNED_DIRS)
        base = Path(directory)
        for name in sorted(filenames):
            if name == "pom.xml":
                result.append(base / name)
    return sorted(result, key=lambda p: p.relative_to(root).as_posix())


def extract_maven_dependencies(pom_path: Path) -> set[tuple[str, str, str]]:
    """Extract (groupId, artifactId, scope) from a pom.xml <dependencies> section.

    Skips <dependencyManagement> entries. Normalizes missing scope to 'compile'.
    """
    try:
        tree = ET.parse(pom_path)
    except ET.ParseError as exc:
        raise RuntimeError(f"cannot parse {pom_path.relative_to(ROOT)}: {exc}") from exc
    root_elem = tree.getroot()
    managed: set[tuple[str, str]] = set()
    for dm in root_elem.findall(f"{NS}dependencyManagement"):
        for deps_elem in dm.findall(f"{NS}dependencies"):
            for dep in deps_elem.findall(f"{NS}dependency"):
                gid = dep.findtext(f"{NS}groupId", "").strip()
                aid = dep.findtext(f"{NS}artifactId", "").strip()
                if gid and aid:
                    managed.add((gid, aid))
    deps: set[tuple[str, str, str]] = set()
    for deps_elem in root_elem.findall(f"{NS}dependencies"):
        for dep in deps_elem.findall(f"{NS}dependency"):
            gid = dep.findtext(f"{NS}groupId", "").strip()
            aid = dep.findtext(f"{NS}artifactId", "").strip()
            if (gid, aid) in managed:
                continue
            if not gid or not aid:
                continue
            scope = (dep.findtext(f"{NS}scope", "") or "compile").strip()
            deps.add((gid, aid, scope))
    return deps


def extract_frontend_dependencies(package_json_path: Path) -> set[tuple[str, str]]:
    """Extract (name, scope) from frontend/package.json dependencies + devDependencies.

    scope is 'dependencies' or 'devDependencies'.
    """
    data = json.loads(package_json_path.read_text(encoding="utf-8"))
    deps: set[tuple[str, str]] = set()
    for name in (data.get("dependencies") or {}):
        deps.add((name, "dependencies"))
    for name in (data.get("devDependencies") or {}):
        deps.add((name, "devDependencies"))
    return deps


def exception_is_active(entry: dict) -> tuple[bool, str | None]:
    """Return (active, error) for an exception entry.

    active=True only when expiresAt is an ISO-8601 date strictly after today.
    Missing/invalid/expired expiresAt yields an error message, never a pass.
    """
    expires_at = str(entry.get("expiresAt", "")).strip()
    if not expires_at:
        return False, "exception missing required field 'expiresAt'"
    token = expires_at.split("T", 1)[0]
    try:
        parsed = date.fromisoformat(token)
    except ValueError:
        return False, f"exception expiresAt is not ISO-8601: {expires_at!r}"
    if parsed <= date.today():
        return False, f"exception has expired (expiresAt={expires_at})"
    return True, None


def main() -> int:
    policy = yaml.safe_load(LICENSE_POLICY.read_text(encoding="utf-8")) or {}
    inventory = yaml.safe_load(LICENSE_INVENTORY.read_text(encoding="utf-8")) or {}

    allowed_families = set(str(f) for f in policy.get("allowedLicenseFamilies", []))
    allowed_families.add("INTERNAL")  # internal modules always allowed

    # Build inventory lookup: (groupId, artifactId) -> licenseFamily for Maven
    maven_inventory: dict[tuple[str, str], str] = {}
    for entry in inventory.get("mavenDirectDependencies", []):
        gid = str(entry.get("groupId", "")).strip()
        aid = str(entry.get("artifactId", "")).strip()
        family = str(entry.get("licenseFamily", "")).strip()
        if gid and aid and family:
            maven_inventory[(gid, aid)] = family

    # Build inventory lookup: name -> licenseFamily for frontend
    frontend_inventory: dict[str, str] = {}
    for entry in inventory.get("frontendDirectDependencies", []):
        name = str(entry.get("name", "")).strip()
        family = str(entry.get("licenseFamily", "")).strip()
        if name and family:
            frontend_inventory[name] = family

    errors: list[str] = []

    # --- Validate exceptions and collect active exception families ---
    active_exception_families: set[str] = set()
    for exc in inventory.get("exceptions", []):
        if not isinstance(exc, dict):
            errors.append("license-inventory.yaml: exception must be an object")
            continue
        for field in ("dependency", "licenseFamily", "reason"):
            if not str(exc.get(field, "")).strip():
                errors.append(
                    f"license-inventory.yaml: exception missing required field '{field}'"
                )
        active, error = exception_is_active(exc)
        if error is not None:
            errors.append(f"license-inventory.yaml: {error}")
        elif str(exc.get("licenseFamily", "")).strip():
            active_exception_families.add(str(exc.get("licenseFamily")).strip())

    allowed_families |= active_exception_families

    # --- Check Maven dependencies ---
    pom_files = discover_pom_files(ROOT)
    maven_checked = 0
    for pom_path in pom_files:
        relative = pom_path.relative_to(ROOT).as_posix()
        deps = extract_maven_dependencies(pom_path)
        for gid, aid, scope in sorted(deps):
            family = maven_inventory.get((gid, aid))
            if family is None:
                errors.append(
                    f"{relative}: dependency {gid}:{aid} (scope={scope}) "
                    f"is not in license-inventory.yaml"
                )
                continue
            if family not in allowed_families:
                errors.append(
                    f"{relative}: dependency {gid}:{aid} has license family "
                    f"'{family}' which is not in allowedLicenseFamilies"
                )
            maven_checked += 1

    # --- Check frontend dependencies ---
    package_json = ROOT / "frontend" / "package.json"
    frontend_checked = 0
    if package_json.is_file():
        frontend_deps = extract_frontend_dependencies(package_json)
        for name, scope in sorted(frontend_deps):
            family = frontend_inventory.get(name)
            if family is None:
                errors.append(
                    f"frontend/package.json: {scope} '{name}' "
                    f"is not in license-inventory.yaml"
                )
                continue
            if family not in allowed_families:
                errors.append(
                    f"frontend/package.json: {scope} '{name}' has license family "
                    f"'{family}' which is not in allowedLicenseFamilies"
                )
            frontend_checked += 1

    if errors:
        for item in sorted(set(errors)):
            print(f"ERROR: {item}", file=sys.stderr)
        return 1

    total = maven_checked + frontend_checked
    print(
        f"License inventory check: PASS ({total} direct dependencies, "
        f"{len(pom_files)} pom files)"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

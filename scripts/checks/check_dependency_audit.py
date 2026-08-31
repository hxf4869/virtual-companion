#!/usr/bin/env python3
"""Fail on unapproved high/critical findings from ``pnpm audit --json``."""
from __future__ import annotations

import argparse
import json
import sys
from datetime import date
from pathlib import Path
from typing import Any

import yaml


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_LEDGER = ROOT / "docs/dependency-audit-exceptions.yaml"
GATED_SEVERITIES = {"high", "critical"}
VISIBLE_SEVERITIES = {"low", "moderate"}


def load_json(path: Path) -> dict[str, Any]:
    raw = path.read_text(encoding="utf-8")
    if not raw.strip():
        raise ValueError("pnpm audit produced empty output")
    value = json.loads(raw)
    if not isinstance(value, dict):
        raise ValueError("pnpm audit JSON root must be an object")
    if not isinstance(value.get("advisories"), dict):
        raise ValueError("pnpm audit JSON has no advisories object")
    metadata = value.get("metadata")
    if not isinstance(metadata, dict) or not isinstance(metadata.get("vulnerabilities"), dict):
        raise ValueError("pnpm audit JSON has no vulnerability metadata")
    return value


def load_ledger(path: Path) -> list[dict[str, Any]]:
    value = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict) or not isinstance(value.get("entries"), list):
        raise ValueError("dependency audit exception ledger must contain an entries list")
    entries = value["entries"]
    if any(not isinstance(entry, dict) for entry in entries):
        raise ValueError("dependency audit exception entries must be objects")
    return entries


def advisory_identity(key: str, advisory: dict[str, Any]) -> tuple[str, str, str, set[str]]:
    advisory_id = str(advisory.get("github_advisory_id") or key).strip()
    package = str(advisory.get("module_name") or "").strip()
    severity = str(advisory.get("severity") or "").strip().lower()
    findings = advisory.get("findings")
    if not advisory_id or not package or not severity or not isinstance(findings, list):
        raise ValueError(f"pnpm audit advisory {key!r} is malformed")
    versions = {
        str(finding.get("version") or "").strip()
        for finding in findings
        if isinstance(finding, dict)
    }
    versions.discard("")
    if not versions:
        raise ValueError(f"pnpm audit advisory {advisory_id} has no affected version")
    return advisory_id, package, severity, versions


def matching_exception(
    entries: list[dict[str, Any]],
    advisory_id: str,
    package: str,
    severity: str,
    versions: set[str],
) -> tuple[dict[str, Any] | None, str | None]:
    for entry in entries:
        if str(entry.get("package") or "").strip() != package:
            continue
        declared_versions = {str(value) for value in entry.get("versions") or []}
        if not versions.issubset(declared_versions):
            continue
        advisories = entry.get("advisories") or []
        if not isinstance(advisories, list):
            continue
        declared = next(
            (
                item for item in advisories
                if isinstance(item, dict)
                and str(item.get("id") or "").strip() == advisory_id
                and str(item.get("severity") or "").strip().lower() == severity
            ),
            None,
        )
        if declared is None:
            continue
        expiry_raw = str(entry.get("expiryDate") or "").strip()
        try:
            expiry = date.fromisoformat(expiry_raw)
        except ValueError:
            return None, f"{package} {advisory_id} has an invalid expiryDate {expiry_raw!r}"
        if expiry <= date.today():
            return None, f"{package} {advisory_id} exception expired on {expiry.isoformat()}"
        return entry, None
    return None, None


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--audit-json", required=True, type=Path)
    parser.add_argument("--audit-exit-code", required=True, type=int)
    parser.add_argument("--ledger", type=Path, default=DEFAULT_LEDGER)
    args = parser.parse_args()

    errors: list[str] = []
    if args.audit_exit_code not in (0, 1):
        errors.append(f"pnpm audit command failed with exit code {args.audit_exit_code}")

    try:
        report = load_json(args.audit_json)
        entries = load_ledger(args.ledger)
    except (OSError, ValueError, json.JSONDecodeError, yaml.YAMLError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1

    advisories = report["advisories"]
    if args.audit_exit_code == 1 and not advisories:
        errors.append("pnpm audit exited non-zero without reporting advisories")

    visible: list[tuple[str, str, str]] = []
    allowed: list[tuple[str, str, str, set[str], str]] = []
    for key, raw_advisory in advisories.items():
        if not isinstance(raw_advisory, dict):
            errors.append(f"pnpm audit advisory {key!r} must be an object")
            continue
        try:
            advisory_id, package, severity, versions = advisory_identity(str(key), raw_advisory)
        except ValueError as exc:
            errors.append(str(exc))
            continue
        if severity in VISIBLE_SEVERITIES:
            visible.append((severity, advisory_id, package))
            continue
        if severity not in GATED_SEVERITIES:
            continue
        exception, exception_error = matching_exception(
            entries, advisory_id, package, severity, versions,
        )
        if exception_error:
            errors.append(exception_error)
        elif exception is None:
            errors.append(
                f"unregistered {severity} advisory {advisory_id} for {package} "
                f"versions={','.join(sorted(versions))}"
            )
        else:
            allowed.append(
                (severity, advisory_id, package, versions, str(exception["expiryDate"])),
            )

    counts = report["metadata"]["vulnerabilities"]
    print(
        "Dependency audit summary: "
        + " ".join(
            f"{severity}={counts.get(severity, 0)}"
            for severity in ("critical", "high", "moderate", "low")
        )
    )
    for severity, advisory_id, package in sorted(visible):
        print(f"VISIBLE {severity} {advisory_id} {package}")
    for severity, advisory_id, package, versions, expiry in sorted(allowed):
        print(
            f"ALLOW {severity} {advisory_id} {package} "
            f"versions={','.join(sorted(versions))} until={expiry}"
        )
    if errors:
        for error in sorted(set(errors)):
            print(f"ERROR: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
from __future__ import annotations
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from pathlib import Path
import re
import sys
from urllib.parse import urlsplit

import yaml

from harness_common import strict_yaml_load

ROOT = Path(__file__).resolve().parents[2]
ROSTER = ROOT / "ops/beta-duty-roster.yaml"
PRODUCT_SCOPE = ROOT / "specs/catalog/product-scope.yaml"
PROJECT_STATE = ROOT / ".harness/project-state.yaml"
PLACEHOLDERS = {"", "tbd", "required", "todo", "unknown", "n/a", "none"}
SECRET_REFERENCE_SCHEMES = {
    "secret",
    "vault",
    "aws-secretsmanager",
    "gcp-secretmanager",
    "azure-keyvault",
    "op",
    "k8s-secret",
}
PLACEHOLDER_TOKEN_RE = re.compile(
    r"(?<![a-z0-9])(?:tbd|todo|required|unknown|n/?a|none)(?![a-z0-9])",
    re.IGNORECASE,
)


def fail(msg: str) -> int:
    print(f"ERROR: {msg}", file=sys.stderr)
    return 1


def projection_error(data: dict, beta: dict) -> str | None:
    canonical_timezone = str(beta.get("timezone", ""))
    if not canonical_timezone:
        return "product-scope betaGate source is missing timezone"
    if data.get("timezone") != canonical_timezone:
        return f"beta roster timezone must match product-scope value {canonical_timezone}"
    expected = {
        "startsAt": beta.get("dutyFrom"),
        "generationOpensAt": beta.get("generationWindowFrom"),
        "longConversationCutoff": beta.get("longConversationCutoff"),
        "newGenerationCutoff": beta.get("newGenerationCutoff"),
        "inFlightGraceUntil": beta.get("inFlightGraceUntil"),
        "endsAt": beta.get("dutyUntil"),
    }
    window = data.get("dutyWindow") or {}
    for key, value in expected.items():
        if not value:
            return f"product-scope betaGate source is missing the value for {key}"
        if window.get(key) != value:
            return f"beta roster dutyWindow.{key} must match product-scope value {value}"
    return None


def is_complete_text(value: object) -> bool:
    return (
        isinstance(value, str)
        and bool(value.strip())
        and value.strip().lower() not in PLACEHOLDERS
        and PLACEHOLDER_TOKEN_RE.search(value.strip()) is None
    )


def canonical_secret_reference(value: object) -> str | None:
    if not is_complete_text(value):
        return None
    text = str(value).strip()
    if re.search(r"\s", text) or "%" in text:
        return None
    parsed = urlsplit(text)
    scheme = parsed.scheme.lower()
    path_segments = parsed.path.split("/")
    identifier_parts = [
        part.strip()
        for part in (parsed.netloc, *path_segments)
        if part
    ]
    if not (
        scheme in SECRET_REFERENCE_SCHEMES
        and bool(re.match(r"^[A-Za-z][A-Za-z0-9+.-]*://", text))
        and bool(parsed.netloc)
        and parsed.username is None
        and parsed.password is None
        and "@" not in parsed.netloc
        and not parsed.path.endswith("/")
        and "" not in path_segments[1:]
        and bool(identifier_parts)
        and all(
            is_complete_text(part)
            and part not in {".", ".."}
            and not re.search(r"\s", part)
            for part in identifier_parts
        )
        and not parsed.query
        and not parsed.fragment
        and len(text) >= 8
    ):
        return None
    return f"{scheme}://{parsed.netloc}{parsed.path}"


def is_secret_reference(value: object) -> bool:
    return canonical_secret_reference(value) is not None


def parse_aware_timestamp(value: object) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None
    candidate = value.strip()
    if candidate.endswith("Z"):
        candidate = candidate[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(candidate)
    except ValueError:
        return None
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        return None
    return parsed


def main() -> int:
    if not ROSTER.exists():
        return fail("ops/beta-duty-roster.yaml is missing")
    try:
        data = strict_yaml_load(ROSTER.read_text(encoding="utf-8")) or {}
        product = strict_yaml_load(PRODUCT_SCOPE.read_text(encoding="utf-8")) or {}
        state = strict_yaml_load(PROJECT_STATE.read_text(encoding="utf-8")) or {}
    except (OSError, UnicodeError, yaml.YAMLError) as exc:
        return fail(f"cannot load beta gate sources: {exc}")
    if not all(isinstance(item, dict) for item in (data, product, state)):
        return fail("beta gate YAML roots must be objects")
    if data.get("schemaVersion") != 1:
        return fail("beta roster schemaVersion is unsupported")
    if product.get("schemaVersion") != 1:
        return fail("product-scope schemaVersion is unsupported")
    if state.get("schemaVersion") != 1:
        return fail("project-state schemaVersion is unsupported")
    beta = product.get("betaGate") or {}
    mismatch = projection_error(data, beta)
    if mismatch:
        return fail(mismatch)
    timezone_name = str(beta.get("timezone"))
    try:
        duty_zone = ZoneInfo(timezone_name)
        today = datetime.now(duty_zone).date()
    except ZoneInfoNotFoundError:
        return fail(f"product-scope betaGate timezone is invalid: {timezone_name}")
    enabled = data.get("beta_generation_enabled") is True
    if not enabled:
        print("Beta duty-roster gate: CLOSED (this does not prove broader launch readiness)")
        return 0
    required_top = ["timezone", "date", "dutyWindow", "primary", "backup", "handoffReceiver", "complaintAndAppeal"]
    missing = [k for k in required_top if not data.get(k)]
    if missing:
        return fail(f"beta enabled but missing top-level fields: {missing}")
    if str(data.get("date")) != today.isoformat():
        return fail("beta enabled but roster date is not today")
    now_utc = datetime.now(timezone.utc)
    role_secret_refs: dict[str, str] = {}
    role_names: dict[str, str] = {}
    for role in ("primary", "backup", "handoffReceiver"):
        item = data.get(role) or {}
        if not is_complete_text(item.get("name")):
            return fail(f"beta enabled but {role}.name is not complete")
        role_names[role] = str(item.get("name")).strip().casefold()
        canonical_ref = canonical_secret_reference(item.get("contactSecretRef"))
        if canonical_ref is None:
            return fail(f"beta enabled but {role}.contactSecretRef is not a valid secret reference")
        role_secret_refs[role] = canonical_ref
        confirmed_at = parse_aware_timestamp(item.get("confirmedAt"))
        if confirmed_at is None:
            return fail(f"beta enabled but {role}.confirmedAt is not a timezone-aware ISO-8601 timestamp")
        if confirmed_at.astimezone(duty_zone).date() != today:
            return fail(f"beta enabled but {role}.confirmedAt does not belong to the roster date")
        if confirmed_at.astimezone(timezone.utc) > now_utc + timedelta(minutes=5):
            return fail(f"beta enabled but {role}.confirmedAt is in the future")
    if role_secret_refs["primary"] == role_secret_refs["backup"]:
        return fail("beta enabled but primary and backup must use different contactSecretRef values")
    if role_names["primary"] == role_names["backup"]:
        return fail("beta enabled but primary and backup must be different people")
    complaint = data.get("complaintAndAppeal") or {}
    if not is_complete_text(complaint.get("ownerName")):
        return fail("beta enabled but complaintAndAppeal.ownerName is not complete")
    if not is_secret_reference(complaint.get("contactSecretRef")):
        return fail("beta enabled but complaintAndAppeal.contactSecretRef is not a valid secret reference")
    real_user_beta = (state.get("capabilityGates") or {}).get("realUserBeta") or {}
    if real_user_beta.get("state") != "OPEN":
        return fail(
            "beta roster is populated but project-state realUserBeta gate is not OPEN; "
            "roster completeness cannot authorize launch"
        )
    print("Beta duty-roster gate: READY; project realUserBeta gate is OPEN")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

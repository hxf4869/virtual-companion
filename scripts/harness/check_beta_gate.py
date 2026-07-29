#!/usr/bin/env python3
from __future__ import annotations
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from pathlib import Path
import re
import sys
from urllib.parse import urlsplit
import yaml

ROOT = Path(__file__).resolve().parents[2]
ROSTER = ROOT / "ops/beta-duty-roster.yaml"
PRODUCT_SCOPE = ROOT / "specs/catalog/product-scope.yaml"
PROJECT_STATE = ROOT / ".harness/project-state.yaml"
PLACEHOLDERS = {"", "tbd", "required", "todo", "unknown", "n/a", "none"}
PUBLIC_CONTACT_SCHEMES = {"data", "http", "https", "mailto", "tel"}


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
    return isinstance(value, str) and value.strip().lower() not in PLACEHOLDERS


def is_secret_reference(value: object) -> bool:
    if not is_complete_text(value):
        return False
    text = str(value).strip()
    if re.search(r"\s", text):
        return False
    parsed = urlsplit(text)
    return (
        bool(parsed.scheme)
        and parsed.scheme.lower() not in PUBLIC_CONTACT_SCHEMES
        and bool(parsed.netloc or parsed.path)
        and len(text) >= 8
    )


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
    data = yaml.safe_load(ROSTER.read_text(encoding="utf-8")) or {}
    product = yaml.safe_load(PRODUCT_SCOPE.read_text(encoding="utf-8")) or {}
    beta = product.get("betaGate") or {}
    mismatch = projection_error(data, beta)
    if mismatch:
        return fail(mismatch)
    timezone_name = str(beta.get("timezone"))
    try:
        today = datetime.now(ZoneInfo(timezone_name)).date()
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
    for role in ("primary", "backup", "handoffReceiver"):
        item = data.get(role) or {}
        if not is_complete_text(item.get("name")):
            return fail(f"beta enabled but {role}.name is not complete")
        if not is_secret_reference(item.get("contactSecretRef")):
            return fail(f"beta enabled but {role}.contactSecretRef is not a valid secret reference")
        confirmed_at = parse_aware_timestamp(item.get("confirmedAt"))
        if confirmed_at is None:
            return fail(f"beta enabled but {role}.confirmedAt is not a timezone-aware ISO-8601 timestamp")
        if confirmed_at.astimezone(timezone.utc) > now_utc + timedelta(minutes=5):
            return fail(f"beta enabled but {role}.confirmedAt is in the future")
    complaint = data.get("complaintAndAppeal") or {}
    if not is_complete_text(complaint.get("ownerName")):
        return fail("beta enabled but complaintAndAppeal.ownerName is not complete")
    if not is_secret_reference(complaint.get("contactSecretRef")):
        return fail("beta enabled but complaintAndAppeal.contactSecretRef is not a valid secret reference")
    project_state = yaml.safe_load(PROJECT_STATE.read_text(encoding="utf-8")) or {}
    real_user_beta = (project_state.get("capabilityGates") or {}).get("realUserBeta") or {}
    if real_user_beta.get("state") != "OPEN":
        return fail(
            "beta roster is populated but project-state realUserBeta gate is not OPEN; "
            "roster completeness cannot authorize launch"
        )
    print("Beta duty-roster gate: READY; project realUserBeta gate is OPEN")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

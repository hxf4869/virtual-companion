#!/usr/bin/env python3
"""G1 HTTP workload against the measurement Caddy edge.

Never logs response bodies that could contain message text, tokens, or secrets.
Status codes, timings, and ids (generation/conversation/account) are kept.
"""

from __future__ import annotations

import argparse
import json
import sys
import threading
import time
import urllib.error
import urllib.request
from typing import Any
from urllib.parse import urlencode


class ApiError(RuntimeError):
    def __init__(self, status: int, code: str, path: str, retry_after: int | None = None):
        super().__init__(f"{path} -> {status} {code}")
        self.status = status
        self.code = code
        self.path = path
        self.retry_after = retry_after


class Client:
    def __init__(self, base: str, token: str | None = None):
        self.base = base.rstrip("/")
        self.token = token
        # Bearer-only: do not store vc_refresh/vc_csrf, otherwise state-changing
        # calls would need the double-submit CSRF header.
        self.opener = urllib.request.build_opener()

    def _request(
        self,
        method: str,
        path: str,
        body: dict[str, Any] | None = None,
        timeout: float = 30.0,
        accept: str | None = None,
        raw: bool = False,
    ) -> tuple[int, dict[str, str], Any]:
        data = None
        headers = {"Accept": accept or "application/json"}
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(
            self.base + path, data=data, headers=headers, method=method
        )
        try:
            with self.opener.open(req, timeout=timeout) as resp:
                payload = resp.read()
                hdrs = {k.lower(): v for k, v in resp.headers.items()}
                if raw:
                    return resp.status, hdrs, payload
                if not payload:
                    return resp.status, hdrs, None
                try:
                    return resp.status, hdrs, json.loads(payload.decode("utf-8"))
                except json.JSONDecodeError:
                    return resp.status, hdrs, {"_non_json": True, "n": len(payload)}
        except urllib.error.HTTPError as exc:
            payload = exc.read()
            parsed: Any
            try:
                parsed = json.loads(payload.decode("utf-8"))
            except json.JSONDecodeError:
                parsed = {"_non_json": True, "n": len(payload)}
            code = ""
            if isinstance(parsed, dict):
                code = str(parsed.get("code") or parsed.get("error") or "")
            retry_after = None
            raw_retry = exc.headers.get("Retry-After") if exc.headers else None
            if raw_retry:
                try:
                    retry_after = int(str(raw_retry).strip())
                except ValueError:
                    retry_after = None
            raise ApiError(exc.code, code, path.split("?", 1)[0], retry_after=retry_after) from None
        except TimeoutError as exc:
            raise ApiError(0, "timeout", path.split("?", 1)[0]) from None
        except urllib.error.URLError as exc:
            raise ApiError(0, type(exc.reason).__name__ if exc.reason else "url", path.split("?", 1)[0]) from None

    def json(self, method: str, path: str, body: dict[str, Any] | None = None, timeout: float = 30.0) -> Any:
        status, _, parsed = self._request(method, path, body, timeout=timeout)
        if status >= 400:
            code = ""
            if isinstance(parsed, dict):
                code = str(parsed.get("code") or "")
            raise ApiError(status, code, path)
        return parsed


def login(base: str, username: str, password: str) -> tuple[Client, dict[str, Any], float]:
    client = Client(base)
    t0 = time.perf_counter()
    body = client.json("POST", "/api/v1/auth/login", {"username": username, "password": password})
    elapsed_ms = (time.perf_counter() - t0) * 1000
    token = body.get("accessToken")
    if not isinstance(token, str) or not token:
        raise ApiError(200, "missing_access_token", "/api/v1/auth/login")
    client.token = token
    return client, body, elapsed_ms


def authed_client(args: argparse.Namespace) -> Client:
    token = getattr(args, "access_token", None)
    if token:
        return Client(args.base, token)
    username = getattr(args, "username", None)
    password = getattr(args, "password", None)
    if not username or not password:
        raise ApiError(0, "missing_credentials", "/api/v1/auth/login")
    client, _, _ = login(args.base, username, password)
    return client


def prepare_generation(client: Client) -> None:
    client.json("POST", "/api/v1/age/verification", None)
    for consent_type in (
        "SERVICE_TERMS",
        "PRIVACY_POLICY",
        "AI_CONTENT_NOTICE",
        "THIRD_PARTY_MODEL_PROCESSING",
        "SENSITIVE_DATA_PROCESSING",
    ):
        client.json(
            "PUT",
            "/api/v1/consents",
            {"consentType": consent_type, "version": "2026-08", "granted": True},
        )


def create_conversation(client: Client) -> dict[str, str]:
    rel = client.json("POST", "/api/v1/relationships", {"personaRef": "gentle-listener"})
    relationship_id = str(rel.get("relationshipId"))
    conv = client.json("POST", "/api/v1/conversations", {"relationshipId": relationship_id})
    return {
        "relationshipId": relationship_id,
        "conversationId": str(conv.get("conversationId")),
    }


def send_generation(
    client: Client,
    conversation_id: str,
    text: str,
    key: str,
    *,
    retry_429: bool = True,
) -> tuple[dict[str, Any], float]:
    t0 = time.perf_counter()
    path = f"/api/v1/conversations/{conversation_id}/generations"
    body_payload = {"idempotencyKey": key, "userContent": text}
    last_error: ApiError | None = None
    for _ in range(8 if retry_429 else 1):
        try:
            body = client.json("POST", path, body_payload, timeout=30.0)
            return body, (time.perf_counter() - t0) * 1000
        except ApiError as exc:
            last_error = exc
            if not retry_429 or exc.status != 429:
                raise
            delay = exc.retry_after if exc.retry_after and exc.retry_after > 0 else 2
            time.sleep(min(delay, 60))
    assert last_error is not None
    raise last_error


def snapshot(client: Client, generation_id: str) -> dict[str, Any]:
    return client.json("GET", f"/api/v1/generations/{generation_id}/snapshot")


def wait_terminal(client: Client, generation_id: str, timeout_s: float = 60.0) -> tuple[str, float]:
    t0 = time.perf_counter()
    last = "UNKNOWN"
    while time.perf_counter() - t0 < timeout_s:
        snap = snapshot(client, generation_id)
        last = str(snap.get("status") or "UNKNOWN")
        if last in {
            "COMPLETED",
            "COMPLETED_FALLBACK",
            "CANCELLED",
            "INPUT_BLOCKED",
            "OUTPUT_BLOCKED",
            "FAILED_FINAL",
        }:
            return last, (time.perf_counter() - t0) * 1000
        time.sleep(0.2)
    return last, (time.perf_counter() - t0) * 1000


def open_sse(
    client: Client,
    generation_id: str,
    origin: str,
    timeout_s: float = 30.0,
    slow_read: bool = False,
    max_bytes: int = 65536,
) -> dict[str, Any]:
    session_id = f"g1-{generation_id}"
    ticket = client.json(
        "POST",
        "/api/v1/realtime/tickets",
        {
            "generationId": str(generation_id),
            "sessionId": session_id,
            "origin": origin,
            "streamEpoch": "1",
            "afterSeq": "0",
        },
    )
    ticket_id = ticket.get("ticketId")
    secret = ticket.get("secret")
    if not ticket_id or not secret:
        raise ApiError(200, "missing_ticket", "/api/v1/realtime/tickets")
    params = urlencode(
        {
            "ticketId": ticket_id,
            "secret": secret,
            "sessionId": session_id,
            "origin": origin,
            "streamEpoch": "1",
        }
    )
    path = f"/api/v1/realtime/streams/{generation_id}?{params}"
    t0 = time.perf_counter()
    first_event_ms = None
    n_bytes = 0
    n_events = 0
    denied = False
    try:
        status, headers, payload = client._request(
            "GET",
            path,
            timeout=timeout_s,
            accept="text/event-stream",
            raw=True,
        )
        if slow_read:
            time.sleep(min(2.0, timeout_s))
        text = payload.decode("utf-8", "replace") if isinstance(payload, (bytes, bytearray)) else str(payload)
        n_bytes = len(payload) if isinstance(payload, (bytes, bytearray)) else len(text)
        if "event:" in text or "data:" in text:
            first_event_ms = (time.perf_counter() - t0) * 1000
        n_events = text.count("\nevent:") + text.count("event:")
        if n_events == 0 and "data:" in text:
            n_events = text.count("data:")
        denied = "stream.denied" in text
        return {
            "status": status,
            "elapsed_ms": (time.perf_counter() - t0) * 1000,
            "first_event_ms": first_event_ms,
            "bytes": n_bytes,
            "events": n_events,
            "denied": denied,
            "content_type": headers.get("content-type", ""),
        }
    except ApiError as exc:
        return {
            "status": exc.status,
            "error": exc.code,
            "path": "/api/v1/realtime/streams",
            "elapsed_ms": (time.perf_counter() - t0) * 1000,
            "first_event_ms": None,
            "bytes": 0,
            "events": 0,
            "denied": exc.status in {401, 403, 404},
        }


def configure_provider(url: str, **kwargs: Any) -> dict[str, Any]:
    data = json.dumps(kwargs).encode("utf-8")
    req = urllib.request.Request(
        url, data=data, method="PUT", headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=5) as resp:
        return json.loads(resp.read().decode("utf-8"))


def provider_health(url: str) -> bool:
    try:
        with urllib.request.urlopen(url, timeout=3) as resp:
            return resp.status == 200
    except (urllib.error.URLError, TimeoutError, OSError):
        return False


def seed_users(admin: Client, count: int) -> list[dict[str, str]]:
    listed = admin.json("GET", "/api/v1/auth/admin/accounts")
    existing = {
        row.get("username")
        for row in listed
        if isinstance(row, dict)
    }
    users = []
    for i in range(count):
        username = f"g1-user-{i+1}"
        password = f"G1-User-{i+1}-Pass-1234!"
        if username not in existing:
            admin.json(
                "POST",
                "/api/v1/auth/admin/accounts",
                {
                    "username": username,
                    "password": password,
                    "displayName": f"G1 user {i+1}",
                    "role": "USER",
                },
            )
        users.append({"username": username, "password": password})
    return users


def cmd_login(args: argparse.Namespace) -> dict[str, Any]:
    client, body, elapsed_ms = login(args.base, args.username, args.password)
    token_out = getattr(args, "token_out", None)
    if token_out and client.token:
        with open(token_out, "w", encoding="utf-8") as fh:
            fh.write(client.token)
    return {
        "ok": True,
        "accountId": body.get("accountId"),
        "role": body.get("role"),
        "login_ms": elapsed_ms,
        "token_present": bool(client.token),
    }


def cmd_seed(args: argparse.Namespace) -> dict[str, Any]:
    admin, _, login_ms = login(args.base, args.admin_user, args.admin_pass)
    users = seed_users(admin, args.count)
    return {"ok": True, "users": len(users), "admin_login_ms": login_ms}


def cmd_prepare_owner(args: argparse.Namespace) -> dict[str, Any]:
    client, body, login_ms = login(args.base, args.username, args.password)
    prepare_generation(client)
    conv = create_conversation(client)
    return {
        "ok": True,
        "accountId": body.get("accountId"),
        "login_ms": login_ms,
        "accessToken": client.token,
        **conv,
    }


def cmd_generation(args: argparse.Namespace) -> dict[str, Any]:
    client = authed_client(args)
    gen, intake_ms = send_generation(
        client, args.conversation_id, args.text, args.idempotency_key
    )
    generation_id = str(gen.get("generationId"))
    status, wait_ms = wait_terminal(client, generation_id, timeout_s=args.timeout)
    return {
        "ok": status.startswith("COMPLETED"),
        "generationId": generation_id,
        "status": status,
        "intake_ms": intake_ms,
        "wait_ms": wait_ms,
        "app_overhead_ms": intake_ms,
    }


def cmd_sse(args: argparse.Namespace) -> dict[str, Any]:
    client = authed_client(args)
    result = open_sse(
        client,
        args.generation_id,
        args.origin,
        timeout_s=args.timeout,
        slow_read=args.slow,
    )
    return result


def cmd_turn_with_sse(args: argparse.Namespace) -> dict[str, Any]:
    client = authed_client(args)
    gen, intake_ms = send_generation(
        client, args.conversation_id, args.text, args.idempotency_key
    )
    generation_id = str(gen.get("generationId"))
    sse_holder: dict[str, Any] = {}

    def _sse() -> None:
        sse_holder.update(
            open_sse(
                client,
                generation_id,
                args.origin,
                timeout_s=args.timeout,
                slow_read=args.slow,
            )
        )

    thread = threading.Thread(target=_sse, daemon=True)
    thread.start()
    status, wait_ms = wait_terminal(client, generation_id, timeout_s=args.timeout)
    thread.join(timeout=args.timeout + 2)
    return {
        "ok": status.startswith("COMPLETED"),
        "generationId": generation_id,
        "status": status,
        "intake_ms": intake_ms,
        "wait_ms": wait_ms,
        "sse": sse_holder,
    }


def cmd_cancel(args: argparse.Namespace) -> dict[str, Any]:
    client = authed_client(args)
    gen, intake_ms = send_generation(
        client, args.conversation_id, args.text, args.idempotency_key
    )
    generation_id = str(gen.get("generationId"))
    t0 = time.perf_counter()
    try:
        client.json("POST", f"/api/v1/generations/{generation_id}/cancel", {})
        cancel_status = "ok"
    except ApiError as exc:
        cancel_status = f"{exc.status}:{exc.code}"
    cancel_ms = (time.perf_counter() - t0) * 1000
    status, wait_ms = wait_terminal(client, generation_id, timeout_s=args.timeout)
    return {
        "generationId": generation_id,
        "intake_ms": intake_ms,
        "cancel_status": cancel_status,
        "cancel_ms": cancel_ms,
        "final_status": status,
        "wait_ms": wait_ms,
    }


def cmd_revoke_storm(args: argparse.Namespace) -> dict[str, Any]:
    errors = 0
    logins = 0
    revokes = 0
    lock = threading.Lock()

    def worker(i: int) -> None:
        nonlocal errors, logins, revokes
        try:
            client, _, _ = login(args.base, args.username, args.password)
            with lock:
                logins += 1
            if i % 2 == 0:
                client.json("POST", "/api/v1/auth/sessions/revoke-all", {})
                with lock:
                    revokes += 1
            else:
                client.json("POST", "/api/v1/auth/logout", {})
        except ApiError:
            with lock:
                errors += 1

    threads = [threading.Thread(target=worker, args=(i,), daemon=True) for i in range(args.count)]
    t0 = time.perf_counter()
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=30)
    return {
        "threads": args.count,
        "logins": logins,
        "revokes": revokes,
        "errors": errors,
        "elapsed_ms": (time.perf_counter() - t0) * 1000,
    }


def cmd_concurrent(args: argparse.Namespace) -> dict[str, Any]:
    specs = json.loads(args.specs)
    results: list[dict[str, Any]] = []
    lock = threading.Lock()
    # Login sequentially: Java login bulkhead is 4 in-flight and 10/min per IP.
    clients: list[tuple[Client, dict[str, Any]]] = []
    login_errors = 0
    for spec in specs:
        try:
            token = spec.get("accessToken")
            if token:
                client = Client(args.base, token)
            else:
                client, _, _ = login(args.base, spec["username"], spec["password"])
                time.sleep(0.2)
            clients.append((client, spec))
        except ApiError:
            login_errors += 1
            clients.append((Client(args.base), spec))

    def run_one(client: Client, spec: dict[str, Any], idx: int) -> None:
        try:
            gen, intake_ms = send_generation(
                client,
                spec["conversationId"],
                spec.get("text") or f"g1 concurrent {idx}",
                spec.get("idempotencyKey") or f"g1-c-{idx}-{int(time.time()*1000)}",
            )
            generation_id = str(gen.get("generationId"))
            sse: dict[str, Any] = {}
            if spec.get("sse"):
                sse = open_sse(
                    client,
                    generation_id,
                    args.origin,
                    timeout_s=args.timeout,
                )
            status, wait_ms = wait_terminal(client, generation_id, timeout_s=args.timeout)
            row = {
                "idx": idx,
                "generationId": generation_id,
                "status": status,
                "intake_ms": intake_ms,
                "wait_ms": wait_ms,
                "sse": sse,
            }
        except ApiError as exc:
            row = {
                "idx": idx,
                "ok": False,
                "status": exc.status,
                "code": exc.code,
                "intake_ms": None,
                "wait_ms": None,
                "sse": {},
            }
        with lock:
            results.append(row)

    threads = [
        threading.Thread(target=run_one, args=(client, spec, i), daemon=True)
        for i, (client, spec) in enumerate(clients)
    ]
    t0 = time.perf_counter()
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=args.timeout + 15)
    return {
        "n": len(specs),
        "elapsed_ms": (time.perf_counter() - t0) * 1000,
        "completed": sum(1 for row in results if str(row.get("status", "")).startswith("COMPLETED")),
        "login_errors": login_errors,
        "results": results,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="http://127.0.0.1:18080")
    parser.add_argument("--origin", default="http://127.0.0.1:18080")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("login")
    p.add_argument("--username", required=True)
    p.add_argument("--password", required=True)
    p.add_argument("--token-out", help="write access token to this file; never printed")

    p = sub.add_parser("seed")
    p.add_argument("--admin-user", required=True)
    p.add_argument("--admin-pass", required=True)
    p.add_argument("--count", type=int, default=8)

    p = sub.add_parser("prepare-owner")
    p.add_argument("--username", required=True)
    p.add_argument("--password", required=True)

    p = sub.add_parser("generation")
    p.add_argument("--username")
    p.add_argument("--password")
    p.add_argument("--access-token")
    p.add_argument("--conversation-id", required=True)
    p.add_argument("--text", default="hello from g1 baseline")
    p.add_argument("--idempotency-key", required=True)
    p.add_argument("--timeout", type=float, default=60)

    p = sub.add_parser("sse")
    p.add_argument("--username")
    p.add_argument("--password")
    p.add_argument("--access-token")
    p.add_argument("--generation-id", required=True)
    p.add_argument("--timeout", type=float, default=30)
    p.add_argument("--slow", action="store_true")

    p = sub.add_parser("turn-with-sse")
    p.add_argument("--username")
    p.add_argument("--password")
    p.add_argument("--access-token")
    p.add_argument("--conversation-id", required=True)
    p.add_argument("--text", default="hello from g1 baseline")
    p.add_argument("--idempotency-key", required=True)
    p.add_argument("--timeout", type=float, default=60)
    p.add_argument("--slow", action="store_true")

    p = sub.add_parser("cancel")
    p.add_argument("--username")
    p.add_argument("--password")
    p.add_argument("--access-token")
    p.add_argument("--conversation-id", required=True)
    p.add_argument("--text", default="please cancel this turn")
    p.add_argument("--idempotency-key", required=True)
    p.add_argument("--timeout", type=float, default=30)

    p = sub.add_parser("revoke-storm")
    p.add_argument("--username", required=True)
    p.add_argument("--password", required=True)
    p.add_argument("--count", type=int, default=8)

    p = sub.add_parser("concurrent")
    p.add_argument("--specs", required=True)
    p.add_argument("--timeout", type=float, default=60)

    p = sub.add_parser("provider-config")
    p.add_argument("--url", default="http://127.0.0.1:19090/g1/config")
    p.add_argument("--first-token-ms", type=float)
    p.add_argument("--delta-ms", type=float)
    p.add_argument("--chunks", type=float)
    p.add_argument("--hold-ms", type=float)

    p = sub.add_parser("provider-health")
    p.add_argument("--url", default="http://127.0.0.1:19090/health")

    args = parser.parse_args()
    try:
        if args.cmd == "provider-config":
            payload = {}
            if args.first_token_ms is not None:
                payload["firstTokenMs"] = args.first_token_ms
            if args.delta_ms is not None:
                payload["deltaMs"] = args.delta_ms
            if args.chunks is not None:
                payload["chunks"] = args.chunks
            if args.hold_ms is not None:
                payload["holdMs"] = args.hold_ms
            result = configure_provider(args.url, **payload)
        elif args.cmd == "provider-health":
            result = {"ok": provider_health(args.url)}
        elif args.cmd == "login":
            result = cmd_login(args)
        elif args.cmd == "seed":
            result = cmd_seed(args)
        elif args.cmd == "prepare-owner":
            result = cmd_prepare_owner(args)
        elif args.cmd == "generation":
            result = cmd_generation(args)
        elif args.cmd == "sse":
            result = cmd_sse(args)
        elif args.cmd == "turn-with-sse":
            result = cmd_turn_with_sse(args)
        elif args.cmd == "cancel":
            result = cmd_cancel(args)
        elif args.cmd == "revoke-storm":
            result = cmd_revoke_storm(args)
        elif args.cmd == "concurrent":
            result = cmd_concurrent(args)
        else:
            raise SystemExit("unknown command")
        json.dump(result, sys.stdout)
        sys.stdout.write("\n")
        return 0
    except ApiError as exc:
        json.dump(
            {
                "ok": False,
                "status": exc.status,
                "code": exc.code,
                "path": exc.path,
                "retry_after": exc.retry_after,
            },
            sys.stdout,
        )
        sys.stdout.write("\n")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""OpenAPI single-source generator and drift gate (TASK-0023).

The hand-written ``specs/openapi/virtual-companion.yaml`` is the single source
of truth (ADR-0002). This tool deterministically generates a bundled OpenAPI
document plus an audit snapshot, and fails closed when the generated artifacts
drift from what is committed. Generation is pure and deterministic — the same
source always yields byte-identical output (LF newlines, stable key order) — so
the drift gate is exact.

It mirrors scripts/checks/catalog_tool.py but lives under scripts/dev/ and
writes to specs/openapi/dist/ so it does not collide with the catalog_tool-owned
specs/generated/ contract.
"""
from __future__ import annotations

import argparse
import hashlib
import shutil
import sys
import tempfile
from pathlib import Path
from typing import Any

import yaml

GENERATOR_VERSION = "1.1.0"


def repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def load_yaml(path: Path) -> dict[str, Any]:
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError(f"{path}: root must be an object")
    return data


def write_text_lf(path: Path, content: str) -> None:
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        handle.write(content)


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def source_path(root: Path) -> Path:
    return root / "specs/openapi/virtual-companion.yaml"


def validate(root: Path) -> list[str]:
    errors: list[str] = []
    path = source_path(root)
    if not path.exists():
        return [f"missing OpenAPI source: {path.relative_to(root)}"]
    doc = load_yaml(path)
    if doc.get("openapi") != "3.1.0":
        errors.append("source: openapi must be 3.1.0")
    info = doc.get("info", {})
    if not info.get("title") or not info.get("version"):
        errors.append("source: info.title and info.version are required")
    schemas = doc.get("components", {}).get("schemas", {})
    envelope = schemas.get("ErrorEnvelope")
    if not isinstance(envelope, dict):
        errors.append("source: components.schemas.ErrorEnvelope is required")
    else:
        required = envelope.get("required", [])
        if "code" not in required or "message" not in required:
            errors.append("source: ErrorEnvelope must require code and message")
        props = envelope.get("properties", {})
        if "$ref" not in props.get("code", {}) and "enum" not in props.get("code", {}):
            if props.get("code", {}).get("$ref") != "#/components/schemas/ErrorCode":
                errors.append("source: ErrorEnvelope.code must reference ErrorCode")
    error_code = schemas.get("ErrorCode", {})
    if not isinstance(error_code, dict) or not error_code.get("enum"):
        errors.append("source: ErrorCode must be a string enum")
    if "NOT_FOUND_OR_FORBIDDEN" not in (error_code.get("enum") or []):
        errors.append("source: ErrorCode must include NOT_FOUND_OR_FORBIDDEN (existence hiding)")
    # M7: the OpenAPI ErrorCode enum must mirror the error-codes catalog (the
    # single source of truth) as an exact set. Only set consistency is checked
    # here; catalog content itself stays catalog_tool's responsibility.
    enum_codes = set(error_code.get("enum") or [])
    catalog_path = root / "specs/catalog/error-codes.yaml"
    if catalog_path.exists():
        try:
            catalog_codes = {
                entry.get("code")
                for entry in load_yaml(catalog_path).get("entries", [])
                if isinstance(entry, dict)
            } - {None}
        except ValueError:
            errors.append(f"source: cannot parse {catalog_path.relative_to(root)}")
        else:
            if catalog_codes:
                missing = sorted(catalog_codes - enum_codes)
                extra = sorted(enum_codes - catalog_codes)
                if missing:
                    errors.append(
                        "source: ErrorCode enum missing catalog codes: " + ", ".join(missing)
                    )
                if extra:
                    errors.append(
                        "source: ErrorCode enum has codes absent from catalog: " + ", ".join(extra)
                    )
    paths = doc.get("paths", {})
    if not paths:
        errors.append("source: at least one path is required")
    for p, item in paths.items():
        if not isinstance(item, dict):
            errors.append(f"source: path {p} must be an object")
            continue
        for method, op in item.items():
            if method == "parameters":
                continue
            if not isinstance(op, dict) or not op.get("operationId"):
                errors.append(f"source: {method.upper()} {p} must define operationId")
    return errors


def symlinked_component_below(root: Path, target: Path) -> Path | None:
    """First symlinked path component strictly below an already-resolved root
    (target included), or None. Aliases above the repository root stay
    normalized because callers resolve root first; redirections inside it
    do not."""
    current = root
    for part in target.relative_to(root).parts:
        current = current / part
        if current.is_symlink():
            return current
    return None


def ensure_safe_output_dir(root: Path, out: Path) -> None:
    """Refuse output targets whose deletion would destroy non-generated content.

    resolve() normalizes '..' and follows symlinks so the checks below operate
    on the real target location, not on the spelling of the path. The
    tool-owned default directory keeps its recursive-delete permission only
    while the lexical chain from the repository root down to it is
    symlink-free: a redirected default (specs/openapi/dist -> anywhere) must
    not inherit that permission just because its target still sits inside the
    repository.
    """
    root = root.resolve()
    resolved = out.resolve()
    home = Path.home().resolve()
    protected = {root, home, *root.parents, *home.parents}
    if resolved in protected:
        raise ValueError(
            f"refusing output directory {resolved}: deleting it would destroy "
            "the repository root, the home directory, or a directory above one of them"
        )
    source = (root / "specs/openapi/virtual-companion.yaml").resolve()
    if resolved == source or source.is_relative_to(resolved):
        raise ValueError(
            f"refusing output directory {resolved}: it contains generator inputs "
            f"({source.parent})"
        )
    default_out = root / "specs/openapi/dist"
    if resolved == default_out.resolve():
        redirect = symlinked_component_below(root, default_out)
        if redirect is not None:
            raise ValueError(
                f"refusing default output directory {default_out}: "
                f"{redirect.relative_to(root)} is a symlink to {redirect.resolve()}; "
                "the tool-owned output must be a real directory, not a redirected alias"
            )
        return
    if resolved.exists():
        if not resolved.is_dir():
            raise ValueError(f"refusing output path {resolved}: not a directory")
        if any(resolved.iterdir()):
            raise ValueError(
                f"refusing non-empty custom output directory {resolved}: "
                "custom --output must not exist or must be empty"
            )


def generate(root: Path, out: Path) -> None:
    ensure_safe_output_dir(root, out)
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True, exist_ok=True)
    doc = load_yaml(source_path(root))

    # Bundled OpenAPI: the source re-emitted with stable formatting so the drift
    # gate is exact (the source itself is the bundle for this self-contained
    # contract; no external $ref resolution is needed).
    write_text_lf(
        out / "api-bundle.yaml",
        yaml.safe_dump(doc, allow_unicode=True, sort_keys=False, width=120),
    )

    # Snapshot for auditability.
    raw = source_path(root).read_bytes()
    snapshot = {
        "generatorVersion": GENERATOR_VERSION,
        "source": {"path": "specs/openapi/virtual-companion.yaml", "sha256": sha256_bytes(raw)},
        "operations": [
            op["operationId"]
            for item in doc.get("paths", {}).values() if isinstance(item, dict)
            for op in item.values() if isinstance(op, dict) and "operationId" in op
        ],
    }
    import json
    write_text_lf(
        out / "openapi.snapshot.json",
        json.dumps(snapshot, ensure_ascii=False, sort_keys=True, indent=2) + "\n",
    )


def file_map(path: Path) -> dict[str, bytes]:
    return {
        str(p.relative_to(path)): p.read_bytes()
        for p in sorted(path.rglob("*"))
        if p.is_file()
    }


def diff_generated(root: Path) -> list[str]:
    committed = root / "specs/openapi/dist"
    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td) / "dist"
        generate(root, tmp)
        a = file_map(committed)
        b = file_map(tmp)
        diffs: list[str] = []
        for key in sorted(set(a) | set(b)):
            if key not in a:
                diffs.append(f"missing committed generated file: {key}")
            elif key not in b:
                diffs.append(f"unexpected committed generated file: {key}")
            elif a[key] != b[key]:
                diffs.append(f"generated drift: {key}")
        return diffs


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("command", choices=["validate", "generate", "diff"])
    ap.add_argument("--root", type=Path, default=repo_root())
    ap.add_argument("--output", type=Path)
    ap.add_argument("--fail-on-drift", action="store_true")
    args = ap.parse_args()
    root = args.root.resolve()
    errors = validate(root)
    if errors:
        for e in errors:
            print(f"ERROR: {e}", file=sys.stderr)
        return 1
    if args.command == "validate":
        print("OpenAPI validation: PASS")
        return 0
    if args.command == "generate":
        out = (args.output or root / "specs/openapi/dist").resolve()
        try:
            generate(root, out)
        except ValueError as exc:
            print(f"ERROR: {exc}", file=sys.stderr)
            return 1
        print(f"Generated: {out}")
        return 0
    diffs = diff_generated(root)
    if diffs:
        for d in diffs:
            print(f"DRIFT: {d}", file=sys.stderr)
        return 1 if args.fail_on_drift else 0
    print("OpenAPI drift check: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

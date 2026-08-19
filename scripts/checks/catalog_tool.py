#!/usr/bin/env python3
from __future__ import annotations
import argparse, hashlib, json, re, shutil, sys, tempfile
from pathlib import Path
from typing import Any
import yaml

GENERATOR_VERSION = "1.0.0"


def repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def load_yaml(path: Path) -> dict[str, Any]:
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError(f"{path}: root must be an object")
    return data


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def write_text_lf(path: Path, content: str) -> None:
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        handle.write(content)


def codes(doc: dict[str, Any]) -> list[str]:
    return [str(e["code"]) for e in doc.get("entries", [])]


def validate(root: Path) -> list[str]:
    errors: list[str] = []
    cdir = root / "specs/catalog"
    manifest = load_yaml(cdir / "catalog-manifest.yaml")
    if manifest.get("generatorVersion") != GENERATOR_VERSION:
        errors.append("catalog-manifest generatorVersion does not match catalog_tool.py")
    listed = [x["file"] for x in manifest.get("catalogs", [])]
    for name in listed:
        path = cdir / name
        if not path.exists():
            errors.append(f"missing catalog: {name}")
            continue
        doc = load_yaml(path)
        if doc.get("schemaVersion") != 1:
            errors.append(f"{name}: schemaVersion must be 1")
        if not doc.get("catalogId"):
            errors.append(f"{name}: catalogId is required")
        for key in ("entries",):
            if key in doc:
                seen: set[str] = set()
                for entry in doc[key]:
                    code = str(entry.get("code", ""))
                    if not code:
                        errors.append(f"{name}: blank code")
                    if code in seen:
                        errors.append(f"{name}: duplicate code {code}")
                    seen.add(code)
    def expect(file: str, expected: list[str]) -> None:
        actual = codes(load_yaml(cdir / file))
        if actual != expected:
            errors.append(f"{file}: expected exact ordered codes {expected}, got {actual}")
    expect("risk-levels.yaml", ["R0_NORMAL","R1_DISTRESS","R2_ELEVATED","R3_HIGH","R4_IMMINENT"])
    expect("safety-classifier-outcomes.yaml", ["CLASSIFIED","LOW_CONFIDENCE","TIMEOUT","UNAVAILABLE","INVALID_RESPONSE","RULE_CONFLICT"])
    expect("age-states.yaml", ["AGE_UNKNOWN","ADULT_SELF_DECLARED","ADULT_VERIFICATION_REQUIRED","ADULT_VERIFIED","MINOR_SUSPECTED","MINOR_VERIFIED","AGE_APPEAL_PENDING","AGE_REVERIFY_REQUIRED","AGE_ACCESS_SUSPENDED"])
    expect("route-decision-statuses.yaml", ["CREATED","SELECTED","NO_ELIGIBLE_DEPLOYMENT","SUPERSEDED","CANCELLED"])
    expect("provider-attempt-statuses.yaml", ["CREATED","CONNECTING","STREAMING","EOS_RECEIVED","SUCCEEDED","RETRYABLE_FAILED","NON_RETRYABLE_FAILED","TIMED_OUT","CANCEL_REQUESTED","CANCELLED","ABANDONED_LATE"])
    expect("model-protocols.yaml", ["OPENAI_CHAT_COMPLETIONS","OPENAI_RESPONSES","ANTHROPIC_MESSAGES","FAKE","FAILURE","ZERO_LLM"])
    gen = codes(load_yaml(cdir / "generation-states.yaml"))
    if "FAILED_RETRYABLE" in gen:
        errors.append("generation-states.yaml: FAILED_RETRYABLE belongs to Route/Attempt, not Generation")
    scopes = codes(load_yaml(cdir / "memory-scopes.yaml"))
    if "RELATIONSHIP" not in scopes or "COMPANION" in scopes:
        errors.append("memory-scopes.yaml: RELATIONSHIP required and COMPANION forbidden")
    product = load_yaml(cdir / "product-scope.yaml")
    alpha = product.get("alpha", {})
    if alpha.get("canonicalLongTermMemoryScope") != "RELATIONSHIP":
        errors.append("product-scope.yaml: canonicalLongTermMemoryScope must be RELATIONSHIP")
    if alpha.get("modelCandidatesRequireConfirmation") is not True:
        errors.append("product-scope.yaml: Alpha model candidates must require confirmation")
    if alpha.get("paymentEnabled") is not False:
        errors.append("product-scope.yaml: Technical Alpha paymentEnabled must be false")
    if product.get("costBoundary", {}).get("commercialSoftwareLicenseRequired") is not False:
        errors.append("product-scope.yaml: commercial software license must not be required")
    if product.get("costBoundary", {}).get("hostedSaasRequired") is not False:
        errors.append("product-scope.yaml: hosted SaaS must not be required")
    if product.get("technology", {}).get("vector") != "PGVECTOR_0.8.5":
        errors.append("product-scope.yaml: vector baseline must be PGVECTOR_0.8.5")
    beta = product.get("betaGate", {})
    expected_beta = {
        "generationWindowFrom": "10:00",
        "longConversationCutoff": "21:45",
        "newGenerationCutoff": "22:00",
        "inFlightGraceUntil": "22:10",
        "dutyFrom": "09:45",
        "dutyUntil": "22:30",
        "ageStateRequired": "ADULT_VERIFIED",
        "betaGenerationEnabledByDefault": False,
    }
    for key, expected_value in expected_beta.items():
        if beta.get(key) != expected_value:
            errors.append(f"product-scope.yaml: betaGate.{key} must be {expected_value!r}")
    candidate = load_yaml(cdir / "memory-candidate-statuses.yaml")
    if candidate.get("alphaModelCandidateInitialStatus") != "PENDING_CONFIRMATION" or candidate.get("alphaModelCandidatesRequireConfirmation") is not True:
        errors.append("memory-candidate-statuses.yaml: Alpha model candidates must be PENDING_CONFIRMATION and require confirmation")
    # Validate transitions only reference declared codes
    for name in ("age-states.yaml", "generation-states.yaml"):
        doc = load_yaml(cdir / name); allowed = set(codes(doc))
        for tr in doc.get("transitions", []):
            if tr.get("from") not in allowed:
                errors.append(f"{name}: transition from unknown code {tr.get('from')}")
            for target in tr.get("to", []):
                if target not in allowed:
                    errors.append(f"{name}: transition to unknown code {target}")
    realtime = set(codes(load_yaml(cdir / "realtime-events.yaml")))
    required_events = {"chat.accepted", "chat.delta", "chat.completed", "stream.gap", "stream.reset", "stream.denied"}
    if not required_events.issubset(realtime):
        errors.append(f"realtime-events.yaml: missing required events {sorted(required_events - realtime)}")
    if "NORMAL" in set(codes(load_yaml(cdir / "risk-levels.yaml"))):
        errors.append("risk-levels.yaml: NORMAL alias is forbidden; use R0_NORMAL")
    return errors


def enum_sources(root: Path) -> list[tuple[str, list[str]]]:
    cdir = root / "specs/catalog"
    manifest = load_yaml(cdir / "catalog-manifest.yaml")
    result: list[tuple[str, list[str]]] = []
    for item in manifest["catalogs"]:
        doc = load_yaml(cdir / item["file"])
        if item["kind"] == "enum":
            result.append((item["typeName"], codes(doc)))
        elif item["kind"] == "multi-enum":
            for enum in doc.get("enums", []):
                result.append((enum["typeName"], [e["code"] for e in enum["entries"]]))
    return result


def generate(root: Path, out: Path) -> None:
    if out.exists(): shutil.rmtree(out)
    java_dir = out / "java/com/virtualcompanion/catalog"
    ts_dir = out / "typescript"; openapi_dir = out / "openapi"; sql_dir = out / "sql"
    for d in (java_dir, ts_dir, openapi_dir, sql_dir): d.mkdir(parents=True, exist_ok=True)
    enums = enum_sources(root)
    header = "// GENERATED by catalog_tool.py; DO NOT EDIT.\n"
    for name, values in enums:
        constants = []
        normalized_seen = set()
        for value in values:
            constant = re.sub(r"[^A-Za-z0-9]+", "_", value).strip("_").upper()
            if not constant or constant[0].isdigit():
                constant = "VALUE_" + constant
            if constant in normalized_seen:
                raise ValueError(f"{name}: Java enum constant collision for {value}: {constant}")
            normalized_seen.add(constant)
            constants.append(f'{constant}("{value}")')
        body = (header + "package com.virtualcompanion.catalog;\n\n"
                + f"public enum {name} {{\n    " + ",\n    ".join(constants) + ";\n\n"
                + "    private final String code;\n\n"
                + f"    {name}(String code) {{ this.code = code; }}\n\n"
                + "    public String code() { return code; }\n"
                + "}\n")
        write_text_lf(java_dir / f"{name}.java", body)
    ts_lines = [header.rstrip(), ""]
    for name, values in enums:
        ts_lines.append(f"export const {name}Values = {json.dumps(values, ensure_ascii=False)} as const")
        ts_lines.append(f"export type {name} = typeof {name}Values[number]")
        ts_lines.append("")
    write_text_lf(ts_dir / "catalog.ts", "\n".join(ts_lines).rstrip()+"\n")
    schemas = {name:{"type":"string","enum":values} for name,values in enums}
    openapi = {"openapi":"3.1.0","info":{"title":"Virtual Companion Generated Catalog Schemas","version":"1.0.0"},"paths":{},"components":{"schemas":schemas}}
    write_text_lf(
        openapi_dir / "catalog-schemas.yaml",
        yaml.safe_dump(openapi, allow_unicode=True, sort_keys=False, width=120),
    )
    sql = ["-- GENERATED by catalog_tool.py; DO NOT EDIT.", "-- Reference data only; include through a reviewed Flyway migration.", "CREATE TABLE IF NOT EXISTS ref_catalog_value (", "  catalog_type varchar(128) NOT NULL,", "  code varchar(128) NOT NULL,", "  ordinal integer NOT NULL,", "  PRIMARY KEY (catalog_type, code)", ");", ""]
    for name, values in enums:
        for i, value in enumerate(values):
            sql.append("INSERT INTO ref_catalog_value(catalog_type, code, ordinal) VALUES ('%s','%s',%d) ON CONFLICT (catalog_type, code) DO UPDATE SET ordinal=EXCLUDED.ordinal;" % (name, value, i))
    write_text_lf(sql_dir / "catalog-values.sql", "\n".join(sql)+"\n")
    cdir = root / "specs/catalog"
    source = {}
    for path in sorted(cdir.glob("*.yaml")):
        raw = path.read_bytes(); source[path.name] = {"sha256":sha256_bytes(raw),"document":load_yaml(path)}
    snapshot = {"generatorVersion":GENERATOR_VERSION,"sources":source,"generatedEnums":{n:v for n,v in enums}}
    write_text_lf(
        out / "catalog.snapshot.json",
        json.dumps(snapshot, ensure_ascii=False, sort_keys=True, indent=2)+"\n",
    )


def file_map(path: Path) -> dict[str, bytes]:
    return {str(p.relative_to(path)):p.read_bytes() for p in sorted(path.rglob("*")) if p.is_file()}


def diff_generated(root: Path) -> list[str]:
    committed = root / "specs/generated"
    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td) / "generated"
        generate(root, tmp)
        a=file_map(committed); b=file_map(tmp)
        diffs=[]
        for key in sorted(set(a)|set(b)):
            if key not in a: diffs.append(f"missing committed generated file: {key}")
            elif key not in b: diffs.append(f"unexpected committed generated file: {key}")
            elif a[key] != b[key]: diffs.append(f"generated drift: {key}")
        return diffs


def main() -> int:
    ap=argparse.ArgumentParser(); ap.add_argument("command", choices=["validate","generate","diff"]); ap.add_argument("--root", type=Path, default=repo_root()); ap.add_argument("--output", type=Path); ap.add_argument("--fail-on-drift", action="store_true")
    args=ap.parse_args(); root=args.root.resolve()
    errors=validate(root)
    if errors:
        for e in errors: print(f"ERROR: {e}", file=sys.stderr)
        return 1
    if args.command == "validate": print("Catalog validation: PASS"); return 0
    if args.command == "generate":
        out=(args.output or root/"specs/generated").resolve(); generate(root,out); print(f"Generated: {out}"); return 0
    diffs=diff_generated(root)
    if diffs:
        for d in diffs: print(f"DRIFT: {d}", file=sys.stderr)
        return 1 if args.fail_on_drift else 0
    print("Catalog drift check: PASS"); return 0

if __name__ == "__main__":
    raise SystemExit(main())

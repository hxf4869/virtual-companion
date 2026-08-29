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
    # S0-02: product-scope.yaml betaGate is the machine source of truth for
    # Beta service times; the beta-gate contract must mirror it, and the
    # §24.7 instants must stay ordered (duty opens first, grace ends last).
    contract = load_yaml(root / "specs/contracts/beta-gate-contract.yaml")
    contract_expect = {
        "generationWindow": {
            "timezone": beta.get("timezone"),
            "opensAt": beta.get("generationWindowFrom"),
            "longConversationCutoff": beta.get("longConversationCutoff"),
            "newGenerationCutoff": beta.get("newGenerationCutoff"),
            "inFlightGraceUntil": beta.get("inFlightGraceUntil"),
        },
        "dutyWindow": {
            "startsAt": beta.get("dutyFrom"),
            "endsAt": beta.get("dutyUntil"),
        },
    }
    for section, fields in contract_expect.items():
        for field, expected in fields.items():
            if contract.get(section, {}).get(field) != expected:
                errors.append(
                    f"beta-gate-contract.yaml: {section}.{field} must match "
                    f"product-scope.yaml betaGate ({expected!r})")
    if contract.get("hardDefault") != "beta_generation_enabled_false":
        errors.append("beta-gate-contract.yaml: hardDefault must be beta_generation_enabled_false")
    def _hhmm(value: str) -> int:
        hours, minutes = str(value).split(":")
        return int(hours) * 60 + int(minutes)
    try:
        ordered = (
            _hhmm(beta["dutyFrom"]) <= _hhmm(beta["generationWindowFrom"])
            < _hhmm(beta["longConversationCutoff"])
            < _hhmm(beta["newGenerationCutoff"]) < _hhmm(beta["inFlightGraceUntil"])
            <= _hhmm(beta["dutyUntil"]))
    except (KeyError, ValueError):
        ordered = False
    if not ordered:
        errors.append(
            "product-scope.yaml: betaGate times must satisfy dutyFrom <= "
            "generationWindowFrom <= longConversationCutoff < newGenerationCutoff "
            "< inFlightGraceUntil <= dutyUntil")
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
    tech = product.get("technology", {})
    if tech.get("goBaseline") != "1.26":
        errors.append("product-scope.yaml: technology.goBaseline must be '1.26'")
    if tech.get("targetRuntime") != "GO_COMPANIOND":
        errors.append("product-scope.yaml: technology.targetRuntime must be GO_COMPANIOND")
    if tech.get("currentRuntimeUntilCutover") != "JAVA_SPRING_BOOT":
        errors.append("product-scope.yaml: technology.currentRuntimeUntilCutover must be JAVA_SPRING_BOOT")
    if tech.get("modelProtocols") != ["OPENAI_CHAT_COMPLETIONS"]:
        errors.append("product-scope.yaml: technology.modelProtocols must be exactly [OPENAI_CHAT_COMPLETIONS]")
    if "ANTHROPIC_MESSAGES" not in (tech.get("deferredModelProtocols") or []):
        errors.append("product-scope.yaml: technology.deferredModelProtocols must include ANTHROPIC_MESSAGES")
    memory_scope = product.get("memory", {})
    if memory_scope.get("autoSaveEnabled") is not False:
        errors.append("product-scope.yaml: memory.autoSaveEnabled must be false")
    if memory_scope.get("productionSemanticRecallClaimed") is not False:
        errors.append("product-scope.yaml: memory.productionSemanticRecallClaimed must be false")
    if product.get("safety", {}).get("remoteClassifier") != "DEFER":
        errors.append("product-scope.yaml: safety.remoteClassifier must be DEFER")
    protocols_doc = load_yaml(cdir / "model-protocols.yaml")
    by_protocol = {str(e.get("code")): e for e in protocols_doc.get("entries", [])}
    if by_protocol.get("OPENAI_CHAT_COMPLETIONS", {}).get("alphaAllowed") is not True:
        errors.append("model-protocols.yaml: OPENAI_CHAT_COMPLETIONS alphaAllowed must be true")
    if by_protocol.get("ANTHROPIC_MESSAGES", {}).get("alphaAllowed") is not False:
        errors.append("model-protocols.yaml: ANTHROPIC_MESSAGES alphaAllowed must be false (Go v1 DEFER)")
    if candidate.get("goV1", {}).get("autoSave") is not False:
        errors.append("memory-candidate-statuses.yaml: goV1.autoSave must be false")
    if candidate.get("goV1", {}).get("productionSemanticRecallClaimed") is not False:
        errors.append("memory-candidate-statuses.yaml: goV1.productionSemanticRecallClaimed must be false")
    safety_contract = load_yaml(root / "specs/contracts/safety-fail-closed-contract.yaml")
    if safety_contract.get("goV1", {}).get("remoteClassifier") != "DEFER":
        errors.append("safety-fail-closed-contract.yaml: goV1.remoteClassifier must be DEFER")
    if safety_contract.get("goV1", {}).get("networkCallsOnInputRollingFinal") is not False:
        errors.append("safety-fail-closed-contract.yaml: goV1.networkCallsOnInputRollingFinal must be false")
    model_contract = load_yaml(root / "specs/contracts/model-protocol-contract.yaml")
    if model_contract.get("protocolFamilies", {}).get("ANTHROPIC_MESSAGES", {}).get("alphaAllowed") is not False:
        errors.append("model-protocol-contract.yaml: ANTHROPIC_MESSAGES alphaAllowed must be false")
    if model_contract.get("goV1", {}).get("liveProtocols") != ["OPENAI_CHAT_COMPLETIONS"]:
        errors.append("model-protocol-contract.yaml: goV1.liveProtocols must be exactly [OPENAI_CHAT_COMPLETIONS]")
    memory_contract = load_yaml(root / "specs/contracts/memory-recall-contract.yaml")
    if memory_contract.get("goV1", {}).get("productionSemanticRecallClaimed") is not False:
        errors.append("memory-recall-contract.yaml: goV1.productionSemanticRecallClaimed must be false")
    if memory_contract.get("goV1", {}).get("autoSave") is not False:
        errors.append("memory-recall-contract.yaml: goV1.autoSave must be false")
    errors.extend(validate_go_v1_api_scope(root))
    return errors


KEEP_REASONS = {"core-outcome", "h5-caller", "safety-or-data-rights", "owner-instruction"}
GO_DECISIONS = {"KEEP", "SIMPLIFY", "DEFER", "RETIRE"}


def openapi_operations(root: Path) -> dict[str, tuple[str, str]]:
    doc = load_yaml(root / "specs/openapi/virtual-companion.yaml")
    found: dict[str, tuple[str, str]] = {}
    for path, item in doc.get("paths", {}).items():
        if not isinstance(item, dict):
            continue
        for method, op in item.items():
            if method == "parameters" or not isinstance(op, dict):
                continue
            oid = op.get("operationId")
            if not oid:
                continue
            if oid in found:
                raise ValueError(f"duplicate OpenAPI operationId {oid}")
            found[str(oid)] = (method.upper(), str(path))
    return found


def validate_go_v1_api_scope(root: Path) -> list[str]:
    errors: list[str] = []
    scope_path = root / "specs/catalog/go-v1-api-scope.yaml"
    if not scope_path.exists():
        return ["missing catalog: go-v1-api-scope.yaml"]
    scope = load_yaml(scope_path)
    if scope.get("catalogId") != "go-v1-api-scope":
        errors.append("go-v1-api-scope.yaml: catalogId must be go-v1-api-scope")
    operations = scope.get("operations")
    if not isinstance(operations, list) or not operations:
        errors.append("go-v1-api-scope.yaml: operations must be a non-empty list")
        return errors
    try:
        openapi = openapi_operations(root)
    except (ValueError, OSError) as exc:
        errors.append(f"go-v1-api-scope.yaml: cannot read OpenAPI operations ({exc})")
        return errors
    seen: set[str] = set()
    counts = {"KEEP": 0, "SIMPLIFY": 0, "DEFER": 0, "RETIRE": 0}
    for index, entry in enumerate(operations):
        if not isinstance(entry, dict):
            errors.append(f"go-v1-api-scope.yaml: operations[{index}] must be an object")
            continue
        oid = str(entry.get("operationId") or "")
        if not oid:
            errors.append(f"go-v1-api-scope.yaml: operations[{index}] missing operationId")
            continue
        if oid in seen:
            errors.append(f"go-v1-api-scope.yaml: duplicate operationId {oid}")
            continue
        seen.add(oid)
        if oid not in openapi:
            errors.append(f"go-v1-api-scope.yaml: {oid} is not an OpenAPI operationId")
            continue
        method, path = openapi[oid]
        if entry.get("method") != method:
            errors.append(f"go-v1-api-scope.yaml: {oid} method must be {method}")
        if entry.get("path") != path:
            errors.append(f"go-v1-api-scope.yaml: {oid} path must be {path}")
        decision = entry.get("decision")
        if decision not in GO_DECISIONS:
            errors.append(f"go-v1-api-scope.yaml: {oid} decision must be one of {sorted(GO_DECISIONS)}")
        else:
            counts[str(decision)] += 1
        callers = entry.get("currentH5Callers")
        if not isinstance(callers, list) or any(not isinstance(c, str) or not c for c in callers):
            errors.append(f"go-v1-api-scope.yaml: {oid} currentH5Callers must be a list of strings")
            callers = []
        impact = entry.get("replacementOrImpact")
        if not isinstance(impact, str) or not impact.strip():
            errors.append(f"go-v1-api-scope.yaml: {oid} replacementOrImpact is required")
        if decision == "KEEP":
            reasons = entry.get("keepBecause")
            if not isinstance(reasons, list) or not reasons:
                errors.append(f"go-v1-api-scope.yaml: {oid} KEEP requires keepBecause")
            else:
                unknown = [r for r in reasons if r not in KEEP_REASONS]
                if unknown:
                    errors.append(f"go-v1-api-scope.yaml: {oid} unknown keepBecause {unknown}")
        elif "keepBecause" in entry:
            errors.append(f"go-v1-api-scope.yaml: {oid} keepBecause is only valid for KEEP")
        hide = entry.get("h5CallerMustHideInSameSlice")
        if decision in {"DEFER", "RETIRE"} and callers:
            if hide is not True:
                errors.append(
                    f"go-v1-api-scope.yaml: {oid} has H5 callers and must set "
                    "h5CallerMustHideInSameSlice true"
                )
        elif hide not in (False, None):
            errors.append(f"go-v1-api-scope.yaml: {oid} h5CallerMustHideInSameSlice must be false or omitted")
    missing = sorted(set(openapi) - seen)
    if missing:
        errors.append(f"go-v1-api-scope.yaml: missing OpenAPI operationIds {missing}")
    declared = scope.get("counts") or {}
    for key, value in counts.items():
        if declared.get(key) != value:
            errors.append(f"go-v1-api-scope.yaml: counts.{key} must be {value}")
    undeclared = scope.get("undeclaredJavaEraOperations")
    if not isinstance(undeclared, list) or not undeclared:
        errors.append("go-v1-api-scope.yaml: undeclaredJavaEraOperations must list invite paths")
    else:
        for item in undeclared:
            if not isinstance(item, dict):
                errors.append("go-v1-api-scope.yaml: undeclaredJavaEraOperations entries must be objects")
                continue
            if item.get("decision") != "RETIRE":
                errors.append(
                    f"go-v1-api-scope.yaml: undeclared {item.get('path')} must be RETIRE"
                )
            if item.get("path") in {path for _, path in openapi.values()}:
                errors.append(
                    f"go-v1-api-scope.yaml: {item.get('path')} is now in OpenAPI; move it into operations"
                )
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

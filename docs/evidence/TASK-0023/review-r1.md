# R1 Review — TASK-0023 (OpenAPI / Client generation drift baseline)

- **Reviewed commit**: `108ee037a6c5ec6c765af752b12dddc8baba6bc9` (candidate)
- **Candidate tree**: `ab069b025465e198162437e03ef8844c6ab02640`
- **Reviewer**: `task0023_r1` (independent-review-gate, general-purpose agent)
- **Budget**: 15 min (elapsed ~340s, hard limit not reached)
- **Verdict**: **PASS** — no P0/P1, all four acceptance criteria + ADR-0002 #4 satisfied.
  Determinism, drift detection and single-source were independently reproduced, not
  trusted from the precheck.

## Adversarial verification (independently executed)
- **Determinism (acceptance #1)**: two consecutive `generate --output` runs produced
  byte-identical output matching the committed `specs/openapi/dist`. Driven by
  `sort_keys=False`, `newline="\n"`, insertion-order iteration, fixed templates;
  PyYAML locked `>=6.0,<7`.
- **Drift detection (acceptance #1)**: hand-edit → `generated drift: ...` exit 1;
  deleted snapshot → `missing committed generated file` exit 1; extra file →
  `unexpected committed generated file` exit 1; clean → exit 0. `--fail-on-drift`
  is the correct exit-1 path.
- **Single source (acceptance #2)**: Java and TS both derive from one `load_yaml` of
  `virtual-companion.yaml`; no back-drive path.
- **Existence hiding (INV-TENANT-001)**: 404 reuses `ErrorEnvelope` (same shape as
  401/200); enum contains `NOT_FOUND_OR_FORBIDDEN`; `validate()` enforces; contract
  declares `resourceExistenceDisclosureForbidden: true`.
- **Source quality**: all internal `$ref` resolve; ErrorCode enum exactly matches
  `specs/catalog/error-codes.yaml` (15 codes, same order and set).
- **READY-frozen integrity**: candidate only adds `writeAllowlist` files; bind commit
  changed only `state` + `authorizationCommit`; no protected path touched.
- **Generated code**: ErrorCode enum, ErrorEnvelope/VersionResponse record compact
  constructors, `getVersion()` interface all syntactically valid; nullable `commit`
  handled; operationId used verbatim.
- **Scope honesty**: title says "基线" (baseline); one endpoint; no overclaim.

## Non-blocking findings
- **P2-1** TS client return type is hardcoded `Promise<VersionResponse>` rather than
  derived from the 200-response schema (unlike the Java path). Coincidentally correct
  for the single baseline endpoint; a second endpoint with a different schema would
  produce wrong-but-deterministic TS types. Documented baseline asymmetry; an
  endpoint-expansion task must fix it.
- **P2-2** All object properties render as String in Java/TS (`ErrorEnvelope.details`
  is `type: object` in source). Misleading shape but documented baseline simplification.
- **P2-3** TS `ErrorCodeValues` uses Python list repr (single quotes) vs the
  catalog_tool reference's `json.dumps` (double quotes). Both valid TS; deviation from
  the declared reference pattern. Cosmetic.
- **P3-1** `validate()` does not assert `ErrorEnvelope.code.$ref` points specifically
  to ErrorCode (any `$ref` passes the guard). Partial intent enforcement; source is
  hand-controlled so not currently broken.
- **P3-2** No automated link between the source ErrorCode enum and
  `specs/catalog/error-codes.yaml` (kept separate to avoid the catalog_tool contract
  collision). Currently identical; future catalog additions could drift silently.
- **P3-3** `import json` is function-local rather than top-level. Cosmetic.

## Recommendation
Proceed to closure. P2-1/P2-2 are explicitly scoped baseline simplifications (not
safety/bearing properties), so no fix batch is warranted. P2-1/P2-2/P3-2 are recorded
for the future endpoint-expansion / type-fidelity task.

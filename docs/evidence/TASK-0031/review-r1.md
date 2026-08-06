# TASK-0031 R1 Independent Review

**Reviewer:** R1 (independent)
**Date:** 2026-08-07
**Candidate:** 1e3dc28 (base 1a55e8f)
**Budget:** 15 min
**Scope:** `service/modules/modelruntime/routing/**` (8 main + 2 test files)

---

## Verdict: PASS

All seven acceptance criteria are met, verified by code reading and cross-checked
against the test suite (20 `DeterministicRouterTest` + 9 `QuotaLedgerTest`).
No P0/P1/ACCEPTANCE_VIOLATION/INVARIANT_VIOLATION found. Six non-blocking
findings (2×P2, 4×P3) are listed below for hardening; none block acceptance.

### Acceptance criteria — verification matrix

| AC | Status | Evidence |
|----|--------|----------|
| 1. Determinism (decisionNo + routing) | MET | `DecisionHash` (SHA-256 over canonical UTF-8), `computeDecisionNo` joins only structural fields; `sameInputProducesSameDecisionNoAndSelection` asserts byte-equal decisionNo + binding across two fresh routers |
| 2. NO_ELIGIBLE_DEPLOYMENT | MET | `disabledServiceClassYieldsNoEligible`, `protocolMismatchYieldsNoEligibleWhenZeroLlmForbidden`, `noEligibleWhenQuotaExhaustedAndZeroLlmForbidden`, `missingSnapshotsAndZeroLlmForbiddenYieldsNoEligible` |
| 3. No registry bypass | MET | `matchedExternalCandidates` streams `registry.deployments()`; `selectedProviderIsAlwaysARegistryMember` asserts membership |
| 4. External → ExternalAttemptBinding + both snapshots (INV-AUTH-001) | MET | `externalAttemptBinding` + `hasAuthorizationSnapshots` gate; `externalAttemptBindsBothAuthorizationSnapshots`; `ExternalAttemptBinding` constructor enforces non-blank via `ContractChecks.requireNonBlank` |
| 5. ZERO_LLM → DeterministicSourceBinding, no provider_attempt | MET | `decide` lines 64-69; `selectedProviderId=null`; `zeroLlmOnlyRoutesToDeterministicSourceAndIgnoresRegistry` asserts `instanceof DeterministicSourceBinding` + empty `selectedProviderIdOptional` |
| 6. Deterministic ordering (ProviderId.value()) | MET | `matchedExternalCandidates` `.sorted(Comparator.comparing(ProviderId::value))`; `selectsDeterministicFirstRegardlessOfInsertionOrder` inserts charlie/alpha/bravo, asserts alpha selected + sorted candidate list |
| 7. Service class provider-neutral | MET | `ServiceClass` record carries only `code`, `externalAttemptAllowed`, `zeroLlmFallbackAllowed`; no model/vendor field exists |

### Invariants

- **INV-AUTH-001** — every external attempt binds both snapshots; structurally
  enforced at router gate and at binding construction. SATISFIED.
- **INV-GEN-001/002** — router produces one decision per call with one binding;
  no output stitching. SATISFIED (router scope).
- **INV-TENANT-001** — router uses upstream-provided `OwnershipTuple`; no DB/RLS
  concern in pure-Java layer. See F-04 for a defensive owner-consistency gap.
- **INV-COST-001** — `Entitlement`/`QuotaLedger` are explicitly simulated; no
  payment/subscription/SaaS prerequisite. SATISFIED.

---

## Findings

### F-01 — P2 — QuotaLedger is not thread-safe (TOCTOU double-reserve)

**File:** `QuotaLedger.java:22,62-67`

**Claim:** `QuotaLedger` uses a plain `HashMap` and `reserve` performs a
non-atomic read-check-write (`get` → compare → `put`). Two concurrent `decide()`
calls for the same owner can both observe `current = N`, both pass
`current < units` as false, and both `put(N - 1)`, decrementing only once while
returning two reservations. This is a classic time-of-check-to-time-of-use
double-spend.

**Why it matters:** `InMemoryProviderRegistry` (same module) and
`InMemoryAuthorizationSnapshotStore` both use `ConcurrentHashMap`, establishing a
codebase-wide expectation that modelruntime in-memory state is concurrency-safe.
`QuotaLedger` is the router's only mutable shared state; if `DeterministicRouter`
is wired as a singleton (the natural integration shape), concurrent requests for
the same owner can over-reserve synthetic quota and silently bypass the
fail-closed budget gate.

**Severity rationale:** P2, not P1 — the acceptance criteria and task card do
not state a concurrency requirement, the Technical Alpha scope is single-threaded,
and all tests pass. But the inconsistency with sibling classes makes this a real
integration hazard worth fixing before the router handles real traffic.

**Suggested fix:** back the map with `ConcurrentHashMap` and guard `reserve` with
`compute` (or `synchronized`), e.g.:
```java
long[] after = new long[1];
QuotaReservation[] result = new QuotaReservation[1];
remainingByOwner.compute(ownerUserId, (k, current) -> {
    if (current == null || current < units) { after[0] = -1L; return current; }
    after[0] = current - units; return after[0];
});
```

---

### F-02 — P2 — Entitlement owner and ownership owner are not cross-validated

**File:** `RoutingRequest.java:29-37` (constructor), `DeterministicRouter.java:87`

**Claim:** `RoutingRequest` accepts an `Entitlement` and an `OwnershipTuple`
independently and never asserts `entitlement.ownerUserId()` equals
`ownership.ownerUserId()`. `DeterministicRouter.tryExternal` charges quota
against `request.entitlement().ownerUserId()` (line 87) while every binding,
decisionNo and audit trail carry `ownership.ownerUserId()` (lines 141,
RouteDecision:137). If a caller constructs a request where these differ, quota
is drawn from owner-A's ledger but the decision is attributed to owner-B's
generation — a silent cross-owner accounting split.

**Why it matters:** The trusted boundary upstream is expected to keep these
consistent, but the router is the last enforcement point before quota mutation
and audit emission. In a C4 protected path, a missing equality check here is a
defensive gap against INV-TENANT-001 (cross-owner confusion, even though the
router itself does not read cross-tenant DB rows). It also breaks
`reservationId` audit alignment: the reservation is for owner-A but the
decisionNo encodes owner-B.

**Severity rationale:** P2 — no test exercises the mismatched path and the
router trusts the caller, so it is not an acceptance violation today; but the
consequence (quota from one owner, audit for another) is serious enough to flag.

**Suggested fix:** add to the `RoutingRequest` compact constructor:
```java
if (!entitlement.ownerUserId().equals(ownership.ownerUserId())) {
    throw new IllegalArgumentException(
        "entitlement.ownerUserId must match ownership.ownerUserId");
}
```

---

### F-03 — P3 — Canonical hash separator is ambiguous for `|`-bearing IDs

**File:** `RouteDecision.java:136-144`, `QuotaLedger.java:68`,
`DeterministicRouter.java:140-146`

**Claim:** Every deterministic digest joins fields with `"|"`. None of the
contributing value types (`OwnershipTuple`, `ProviderId`, owner strings)
sanitize or reject `|`. A `ownerUserId = "a|b"` with `relationshipId = "c"`
produces the same canonical tail as `ownerUserId = "a"` with
`relationshipId = "b|c"`, yielding a hash collision on `decisionNo`,
`providerAttemptId` and `reservationId`.

**Why it matters:** In practice these IDs are system-generated UUIDs and `|` is
implausible, so the live risk is near zero. But the tamper-evidence and
determinism claims are structural ("same content → same digest; different
content → different digest") and the separator ambiguity weakens the
"different content" direction without an enforced guard.

**Severity rationale:** P3 — theoretical, no realistic collision vector with
current ID conventions; noted for completeness.

**Suggested fix (optional):** reject `|` in `OwnershipTuple`/`ProviderId`
constructors, or switch to a length-prefixed canonical encoding.

---

### F-04 — P3 — RouteDecision constructor does not cross-validate status vs binding/provider

**File:** `RouteDecision.java:38-54`

**Claim:** The compact constructor only checks
`binding != null` when `status == SELECTED`. It does not reject the inverse
(`binding != null` when `status != SELECTED`) nor reject `selectedProviderId !=
null` when `status == NO_ELIGIBLE_DEPLOYMENT`. A caller using the public record
constructor directly (bypassing the `selected`/`noEligible` factories) could
construct a `NO_ELIGIBLE_DEPLOYMENT` decision that carries a binding, or a
`SELECTED` decision with `selectedProviderId` set while the binding is a
`DeterministicSourceBinding`.

**Why it matters:** The factories are the intended entry points and the router
always uses them correctly, so this is not reachable through `decide()`. The
gap is a defensive-invariant weakness: the record is public, and a future caller
could construct a semantically inconsistent `RouteDecision` with a matching
`decisionNo` (since `computeDecisionNo` derives from the same fields).

**Severity rationale:** P3 — not reachable via the router; hardening only.

**Suggested fix:** add status-vs-binding and status-vs-providerId assertions to
the compact constructor, or seal the constructor to package-private and expose
only the factories.

---

### F-05 — P3 — decisionNo excludes authorization snapshot IDs

**File:** `RouteDecision.java:119-146`

**Claim:** `computeDecisionNo` feeds `target`, `executionId` (the
`providerAttemptId`) and `fence`, but never the `requestedAuthorizationSnapshotId`
or `executionAuthorizationSnapshotId`. Two SELECTED-external decisions for the
same owner/provider/fence but under different authorization snapshots share the
same `decisionNo`.

**Why it matters:** The doc states "Two decisions with identical content share
the same decisionNo." Two decisions bound to different authorization snapshots
are arguably different content, yet hash identically. This limits the
tamper-evidence of the audit digest w.r.t. authorization rotation. The full
`RouteDecision` (which carries the binding, which carries the snapshot IDs) is
still self-describing, so auditability is not lost — only the digest's
sensitivity is narrowed.

**Severity rationale:** P3 — consistent with the existing `providerAttemptId`
design (which also excludes snapshots); arguably intentional so that
decisionNo is stable across authorization renewal. Flagged for explicit
documentation.

**Suggested fix (optional):** either document the exclusion explicitly in the
`computeDecisionNo` Javadoc, or fold the snapshot IDs into the canonical string
if authorization-sensitivity is desired.

---

### F-06 — P3 — `computeDecisionNo` is package-private, limiting external recomputation

**File:** `RouteDecision.java:119`

**Claim:** The acceptance criteria state the `decisionNo` is "recomputable from
the decision's own fields". `computeDecisionNo` is package-private
(`static String`, no access modifier), so the only caller that can recompute is
inside `com.virtualcompanion.modelruntime.routing`. An external auditor (a
different module, a verification tool, or the evidence harness) cannot call it
and must re-implement the canonical string format by reading the source.

**Why it matters:** Minor API ergonomics. The test
`noEligibleDecisionNoIsRecomputable` proves recomputability within the package,
satisfying the AC as written. But the audit story would be stronger if the
recompute entry point were public.

**Severity rationale:** P3 — AC is satisfied within the package; convenience
gap only.

**Suggested fix (optional):** make `computeDecisionNo` `public`.

---

## Coverage notes

### Well-covered
- Determinism, insertion-order independence, NO_ELIGIBLE_DEPLOYMENT matrix
  (disabled deployment, protocol/capability mismatch, quota exhausted + no
  ZERO_LLM, missing snapshots + no ZERO_LLM, missing ZERO_LLM source).
- INV-AUTH-001 binding shape (both snapshot IDs, `instanceof` check).
- ZERO_LLM isolation (no `selectedProviderId`, no quota reservation,
  `DeterministicSourceBinding` type).
- QuotaLedger fail-closed (insufficient, unknown owner, exact-budget exhaustion,
  negative-budget/negative-units rejection, per-owner independence, deterministic
  reservation id).
- Tamper-evidence (`routeDecisionRejectsTamperedDecisionNo`).

### Gaps (non-blocking)
- **REJECTED admission status** is never tested; only `DISABLED` is exercised
  (`disabledDeploymentIsNotEligible`). The router filters via `isAdmitted()`,
  which excludes both DISABLED and REJECTED, so the behavior is correct — just
  not explicitly pinned by a test.
- **`providerAttemptId` recomputability** is not asserted. The AC requires
  `decisionNo` to be recomputable (tested), and `providerAttemptId` is also a
  deterministic hash, but no test re-derives it from structural fields. The
  hashing path is the same `DecisionHash.hex`, so confidence is high.
- **Same-instance repeated `decide()`** is not tested for decisionNo stability
  across ledger state mutation. AC1 qualifies determinism by "same quota state",
  so two calls on the same router instance are different inputs by construction;
  still, a pinning test would document the intended semantics.
- **Positive capability match** (STREAMING required + STREAMING-capable
  deployment → SELECTED) is not explicitly tested; only the mismatch path is.
  The `supportsAll` loop is symmetric, so coverage is adequate.
- **Exact-budget boundary at the router level** (budget == 1, external attempt
  reserved → next call degrades) is covered at the ledger level
  (`reserveExactBudgetThenExhausted`) but not end-to-end through the router.

---

## Summary

PASS. TASK-0031 meets all acceptance criteria and invariants with no blocking
issues. Two P2 findings (QuotaLedger thread-safety, entitlement/ownership owner
mismatch) and four P3 findings (canonical separator, constructor cross-validation,
decisionNo snapshot exclusion, package-private recompute) are recommended for
follow-up hardening but do not block acceptance.

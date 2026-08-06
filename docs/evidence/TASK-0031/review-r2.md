# TASK-0031 R2 Independent Review (Fix-Batch Closure)

**Reviewer:** R2 (independent)
**Date:** 2026-08-07
**Base:** 1a55e8f
**R1-reviewed candidate:** 1e3dc28 (R1 verdict PASS, 2×P2 + 4×P3, non-blocking)
**Fix-batch candidate (reviewed):** e7f5fc6
**Budget:** 15 min
**Scope:** FINDING_CLOSURE + DELTA + ADJACENT_RISK + NEW P0/P1 only

---

## Verdict: PASS

Both R1 P2 findings (F-01, F-02) are correctly closed by the fix batch. No new
P0/P1/ACCEPTANCE_VIOLATION/INVARIANT_VIOLATION introduced. The four R1 P3
findings remain intentionally deferred and none is load-bearing or safety-critical.

---

## Per-finding closure

### F-01 (P2) — QuotaLedger TOCTOU double-reserve — **CLOSED**

`QuotaLedger.java` now backs `remainingByOwner` with `ConcurrentHashMap` and
replaces the non-atomic `get`-compare-`put` with an atomic
`ConcurrentHashMap.compute` (lines 68-76). Verified properties:

1. **Atomicity.** `compute` holds the per-bin lock for the full remapping
   function, serializing concurrent `reserve` calls for the same owner. The
   TOCTOU window (two callers both observing `current = N`, both decrementing
   once) is eliminated.

2. **Unknown-owner / null-current.** When `current == null`, the lambda returns
   `current` (null). Per `ConcurrentHashMap.compute` contract, a null return
   removes the mapping or leaves it absent — no spurious zero entry is created.
   `outcome` stays null → `Optional.empty()`. Fail-closed preserved, no synthetic
   zero inserted for an unprovisioned owner.

3. **Insufficient balance.** `current < units` returns `current` unchanged;
   ledger not mutated; `outcome` null → `Optional.empty()`. Fail-closed preserved.

4. **No negative balance.** The `current < units` guard returns before any
   subtraction, so the subtract branch is only reached when `current >= units`;
   `after = current - units >= 0`. Negative balance impossible.

5. **Single-threaded parity + determinism.** The reservation-id formula
   `"qr-" + DecisionHash.hex(ownerUserId + "|" + current + "|" + units)` is
   unchanged and still computed from the pre-decrement `current`, so the
   deterministic id is stable for identical inputs. Maven: 9/9 QuotaLedgerTest
   pass, 65/65 module tests pass.

6. **No deadlock / NPE.** The lambda body calls only `DecisionHash.hex` (pure,
   lock-free hashing) and `AtomicReference.set` (lock-free) — no nested lock
   acquisition, hence no deadlock or re-entrancy hazard. `current` is boxed
   `Long`; `current == null` is tested with short-circuit `||` before
   `current < units` auto-unboxes, so no NPE.

### F-02 (P2) — Entitlement/ownership owner mismatch (INV-TENANT-001) — **CLOSED**

`RoutingRequest.java` compact constructor now requires
`entitlement.ownerUserId().equals(ownership.ownerUserId())` else
`IllegalArgumentException` (lines 34-38). Verified properties:

1. **Fail-closed.** Mismatch throws; the record cannot be constructed with split
   owners. This closes the path where quota would be drawn from owner-A while
   the decisionNo/audit trail is attributed to owner-B.

2. **NPE-safe.** `entitlement.ownerUserId()` is guaranteed non-null and non-blank
   by `Entitlement`'s compact constructor (`Objects.requireNonNull` + `isBlank`,
   Entitlement.java:21-24). `ownership.ownerUserId()` is guaranteed non-blank by
   `OwnershipTuple`'s compact constructor (`ContractChecks.requireNonBlank`,
   OwnershipTuple.java:16). `String.equals(null)` is also inherently NPE-safe on
   the argument side. No NPE vector.

3. **Existing valid paths unaffected.** All existing tests route through
   `standardRequest`, which builds both `OwnershipTuple` and `Entitlement` with
   matching `"owner-1"`. 20 prior DeterministicRouterTest cases still pass.

4. **New regression guard.** `routingRequestRejectsMismatchedOwner`
   (DeterministicRouterTest:239-244) constructs `own()` (owner-1) with an
   `Entitlement("owner-2", …)` and asserts `IllegalArgumentException`. The
   +1 test accounts for the 64 → 65 count.

---

## Deferred R1 P3 findings — confirmed non-blocking

| ID | Topic | Why it stays deferred |
|----|-------|-----------------------|
| F-03 | Canonical `|` separator ambiguity | IDs are system-generated UUIDs; `|` collision is theoretical, no realistic vector. Not safety-critical. |
| F-04 | RouteDecision status/binding cross-check | Not reachable via `decide()`, which always uses the `selected`/`noEligible` factories. The record is the only producer path. Not load-bearing. |
| F-05 | decisionNo excludes snapshot ids | Arguably intentional so decisionNo is stable across authorization renewal; the full `RouteDecision` (carrying the binding, which carries snapshot ids) remains self-auditing. Not safety-critical. |
| F-06 | `computeDecisionNo` package-private | AC ("recomputable from the decision's own fields") is satisfied in-package, proven by `noEligibleDecisionNoIsRecomputable`. Convenience/ergonomics only. |

None of F-03..F-06 is load-bearing or safety-critical; deferring them to the
handoff `knownRisks` is appropriate.

---

## NEW findings introduced by the fix batch

**None at P0 or P1.**

- The owner cross-check cannot break a legitimate path: upstream construction of
  `RoutingRequest` always pairs an `OwnershipTuple` with the same owner's
  `Entitlement` (both derive from the same authenticated principal). No existing
  test or call site constructs a mismatched-but-legitimate request.
- The `compute` lambda introduces no deadlock (no nested locking), no NPE
  (short-circuited null guard, pure lambda body), and no behavior change for the
  single-threaded Technical Alpha scope.
- No new acceptance or invariant violation: all seven ACs and all four invariants
  re-verified by reading; Maven reports 65/65 green.

---

## Summary

PASS. F-01 and F-02 are correctly closed (atomic `compute`-based reserve; fail-closed
owner cross-check). No new P0/P1; four R1 P3 findings remain deferred as non-blocking
hardening.

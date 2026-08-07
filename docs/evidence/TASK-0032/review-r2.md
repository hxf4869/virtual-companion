# TASK-0032 — Independent R2 Review (fix-batch)

- **Reviewer:** independent R2 (model-routing-change, FINDING_CLOSURE + DELTA + ADJACENT_RISK)
- **Base:** a448175
- **R1-reviewed candidate:** 750244e (R1 verdict PASS, 2 P2 + 3 P3, non-blocking)
- **Fix-batch candidate (reviewed here):** 828241e (tree 512f1dc5)
- **Diff surface:** `git diff 750244e 828241e` — 4 files, +38/-5
  - `QuotaLedger.java` (+ceiling map, capped release)
  - `GenerationRecovery.java` (NO_CAPACITY fail-closed throw)
  - `QuotaLedgerTest.java` (+`releaseCapsAtProvisionedCeiling`)
  - `GenerationRecoveryTest.java` (+`noCapacityRejectsNonNullReservationFailClosed`)
- **Budget:** 15 min
- **Verdict:** **PASS**

> PASS because R1 F1 (P2) and F2 (P2) are correctly closed by the fix batch, F4 (P3) is now
> covered, F3/F5 remain non-load-bearing P3 deferrals, and no new P0/P1/ACCEPTANCE_VIOLATION/
> INVARIANT_VIOLATION was introduced. Trusted build on 828241e → BUILD SUCCESS, 84 tests,
> 0 failures (R1's 82 + 2 new tests; consistent), not re-run per instructions.

---

## F1 — P2 — NO_CAPACITY fail-closed on non-null prior reservation — **CLOSED**

- **Fix (GenerationRecovery.java:68-73):** the `NO_CAPACITY` case now throws
  `IllegalArgumentException` when `priorReservation != null`, surfacing the caller bug
  (R1's preferred option (a)) instead of silently returning NONE and leaking the reserved unit.
- **Correctness:** AC1 contracts that NO_CAPACITY carries no reservation; a non-null value is a
  caller precondition violation. The throw runs *before* any side effect (no release, no outcome
  construction), so the path is cleanly fail-closed — the caller sees the bug immediately rather
  than discovering an understated `remaining` later.
- **Reachability:** the branch is reachable via the public `recover(...)` for `RecoveryScenario.NO_CAPACITY`.
- **No legitimate path broken:** the documented NO_CAPACITY flow passes `null`; the existing
  `noCapacityHasNoReleaseAndReachesNoCapacityTerminal` (line 50-60) and the three exhaustive-enum
  tests (`recoveryKeepsGenerationIdStableAcrossAllScenarios`, `eachScenarioReachesExactlyOneTerminal`,
  `recoveryNeverCreatesProviderAttempt`) all drive NO_CAPACITY with `null` and continue to assert
  the NO_CAPACITY_TERMINAL / NONE disposition. None of these is disturbed.
- **Proving test:** `noCapacityRejectsNonNullReservationFailClosed` (line 62-70) provisions 5,
  reserves 1, then asserts `IllegalArgumentException` on `recover(own(), NO_CAPACITY, reservation)`.
  The reservation is still held after the throw (no silent leak) — exactly the fail-closed semantic
  R1 asked for.
- **Verdict:** **CLOSED.** The latent leak is now loud and detectable; the null happy-path is intact.

## F2 — P2 — `release` uncapped (budget inflation on over-/double-release) — **CLOSED**

- **Fix (QuotaLedger.java):**
  1. New `ConcurrentHashMap<String, Long> ceilingByOwner`.
  2. `provision` now writes both `remainingByOwner` and `ceilingByOwner` to `budget` (lines 42-43).
  3. `release` caps: `after = Math.min(ceiling, current + units)` (line 109). Unknown owner
     (`current == null || ceiling == null`) stays a no-op returning 0.
- **Correctness — provision sets both:** ✓ both maps updated to the same `budget` value.
- **Correctness — release caps at ceiling:** ✓ `Math.min(ceiling, current + units)`.
- **Correctness — repeated release cannot exceed ceiling:** ✓ proven by `releaseCapsAtProvisionedCeiling`
  (provision 3, reserve 1 → remaining 2; release 1 → min(3,3)=3; release 1 → min(3,4)=3; asserts 3).
- **Correctness — unknown owner still no-op (no ceiling):** ✓ the `current == null || ceiling == null`
  guard returns `null` and sets `newRemaining=0L`; `releaseOnUnknownOwnerIsNoOpReturningZero`
  (line 134-142) still passes unchanged.
- **Correctness — existing reserve/provision/remaining unchanged:** ✓ `reserve` (64-80), `remaining`
  (49-52), and the negative/zero-unit guards in `release` are byte-identical to R1; `provision` only
  adds the second `put`. `releaseRestoresReservedBudget` (provision 5, reserve 2, release 2 → 5) and
  `reserveThenReleaseThenReserveIsCyclicallyStable` (provision 2, reserve 2, release 2 → 2, reserve 2
  → 0) both still hold — the ceiling never clamps a legitimate single release because
  `(budget − units) + units == budget == ceiling`.
- **Proving test:** `releaseCapsAtProvisionedCeiling` (line 122-132) directly exercises the
  double-release case R1/F4 asked for and asserts no inflation.
- **Verdict:** **CLOSED.** Over-release and double-release are structurally bounded by the provisioned
  ceiling; the single legitimate release path is unaffected.

---

## P3 status (none must be fixed now)

- **F3 (P3 — reservation-owner vs outcome-owner not cross-checked):** **deferred, acceptable.** Not
  addressed by the fix batch. Remains a caller-invariant, not a current bug: `RoutingRequest`
  already enforces `entitlement.ownerUserId == ownership.ownerUserId`, and the router reserves
  against the entitlement owner, so the two are equal in every legitimate flow. Releasing against
  the reservation's owner is the more correct choice (the reservation is the receipt). Not
  safety-critical for a Technical Alpha with no consumer wiring. Acceptable to leave.
- **F4 (P3 — missing inflation test):** **COVERED / CLOSED** by `releaseCapsAtProvisionedCeiling`.
  The test asserts the post-fix capped behavior (no inflation beyond ceiling), which is stronger
  than R1's original ask (pin the old additive behavior).
- **F5 (P3 — QuotaDisposition SETTLED omission vs task-card wording):** **deferred, acceptable.**
  Unchanged. `SETTLED` is the TASK-0018 success-finalization path and is genuinely out of scope for
  failure recovery; the code comment at `QuotaDisposition.java:10-13` justifies the omission and the
  card footer declares the card non-normative. Not load-bearing.

---

## NEW findings introduced by the fix batch

No new P0 or P1. One P3 noted for completeness (non-blocking, strictly an improvement over pre-fix):

### N1 — P3 — `ceilingByOwner` read inside `remainingByOwner.compute` is not atomic with provision-refresh
- **File:line:** `QuotaLedger.java:103-112`
- **Claim:** `release` reads `ceilingByOwner.get(key)` inside the `remainingByOwner.compute` lambda.
  `remainingByOwner.compute` holds that map's bin lock, but `ceilingByOwner` is a separate map, so
  a concurrent `provision` refresh (which does two independent `put`s) is not synchronized against
  the ceiling read.
- **Why it does NOT block:**
  1. The dangerous direction is inflation. A release can now never push `remaining` above the
     ceiling it *read*, so the worst case is clamping to a *stale lower* ceiling (under-restore),
     which is fail-closed — the safe direction for a quota ledger. The pre-fix code had *unbounded*
     inflation on any double-release; this is strictly tighter.
  2. There is no concurrent caller in the Technical Alpha. `provision` is called once at setup;
     `release` is called only from `GenerationRecovery.releaseIfPresent` on a single recovery path.
     The R1 review already accepted that no stress test is required for this single-reader synthetic
     alpha.
  3. Even in the contrived concurrent-provision-refresh-*lower*-budget race, inflation is bounded by
     the *old* (higher) ceiling, not unbounded.
- **Severity rationale:** P3 — latent, non-exploitable in current usage, and strictly an improvement
  over the pre-fix uncapped behavior. No action required for this release.

### Other adjacent-risk checks (all clear)
- **NO_CAPACITY throw breaks a path?** No — the only legitimate NO_CAPACITY call passes `null`; every
  in-repo test driver for NO_CAPACITY uses `null`. No regression.
- **Ceiling cap breaks a legitimate release?** No — for a single release of exactly the reserved
  units, `(budget − units) + units == budget == ceiling`, so `min` never clamps. Verified by
  `releaseRestoresReservedBudget` and `reserveThenReleaseThenReserveIsCyclicallyStable`.
- **`provision(budget=0)`?** Sets ceiling=0; reserve(0) succeeds; any release caps at 0. Consistent,
  no inflation, no crash.
- **Side-effect ordering on the throw:** the `NO_CAPACITY` throw is the first statement in the case,
  before any `release`/outcome construction — no partial state.
- **Memory:** one extra `Long` entry per owner; negligible, same lifecycle as the existing map.
- **No acceptance-criterion regression:** AC1 (TIMEOUT/CANCELLED/ALL_FAILURE release; NO_CAPACITY
  NONE) still holds — the throw is only for the *misuse* case, the null case still returns NONE.
  AC2/AC3/AC4 untouched by this diff.
- **Invariants preserved:** INV-GEN-001 (stable generationId), INV-AUTH-001 (no provider_attempt),
  INV-COST-001 (no paid prerequisite), fail-closed — none is touched by the fix batch.

---

## Summary line

**PASS** — R1 F1 and F2 (both P2) are correctly closed with sound logic and proving tests
(`noCapacityRejectsNonNullReservationFailClosed`, `releaseCapsAtProvisionedCeiling`); F4 is covered;
F3/F5 remain acceptable non-load-bearing P3 deferrals; 0 new P0, 0 new P1, 0 ACCEPTANCE_VIOLATION,
0 INVARIANT_VIOLATION (one new P3 concurrency note, non-blocking and strictly tighter than pre-fix).

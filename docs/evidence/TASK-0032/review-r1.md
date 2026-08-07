# TASK-0032 — Independent R1 Review

- **Reviewer:** independent R1 (model-routing-change, independentReview)
- **Candidate:** 750244e (base a448175)
- **Surface:** `service/modules/modelruntime/routing/**` (protected path)
- **Budget:** 15 min
- **Verdict:** **PASS**

> PASS because no P0, P1, ACCEPTANCE_VIOLATION, or INVARIANT_VIOLATION was found. All four
> acceptance criteria are met, all required invariants hold, and none of the forbidden conditions
> hold. Findings below are P2/P3 robustness / coverage notes acceptable for a Technical Alpha,
> single-release synthetic ledger with no consumer wiring yet.

---

## AC Verification Matrix

| AC | Claim | Verdict | Primary evidence |
|----|-------|---------|------------------|
| AC1 | TIMEOUT/CANCELLED/ALL_FAILURE RELEASE reserved quota; NO_CAPACITY NONE | **MET** | `GenerationRecovery.recover` switch (`GenerationRecovery.java:53-83`) calls `releaseIfPresent` for the three failure scenarios; NO_CAPACITY skips release and sets `QuotaDisposition.NONE`. Tests assert `ledger.remaining("owner-1") == 5L` after provision(5)+reserve(1)+recover for TIMEOUT/CANCELLED/ALL_FAILURE (`GenerationRecoveryTest.java:33,47,72`). |
| AC2 | Stable `generationId` + unique terminal | **MET** | `ownership` is passed through untouched to `RecoveryOutcome.of` (no copy/mint); record stores it final. Each `RecoveryScenario` maps to exactly one `RecoveryTerminal` via exhaustive switch with fail-closed `default` throw (`GenerationRecovery.java:81-83`). Tests: `recoveryKeepsGenerationIdStableAcrossAllScenarios` loops all enum values asserting equality (`GenerationRecoveryTest.java:104-117`); `eachScenarioReachesExactlyOneTerminal` (`:119-134`). |
| AC3 | ZERO_LLM creates NO `provider_attempt` | **MET** | `RecoveryOutcome` carries no `InvocationBinding`/`providerAttemptId`/`selectedProviderId`. The compact constructor throws `IllegalArgumentException` when `providerAttemptCreated` is true (`RecoveryOutcome.java:37-40`); the only factory `of(...)` hard-codes `false` (`:52`). Test `recoveryOutcomeRejectsProviderAttemptCreatedTrue` (`:147-151`) proves the guard; `recoveryNeverCreatesProviderAttempt` loops all scenarios + ZERO_LLM (`:136-145`). |
| AC4 | all-failure / ZERO_LLM response is the reviewed safety constant | **MET** | Both paths return `DeterministicSafetyResponse.ZERO_LLM_FALLBACK` directly (a `static final String` in a final class with private ctor) — `GenerationRecovery.java:80,105`. No conditional/parameterization/fallback-to-empty on those paths. `zeroLlmResponseEqualsSafetyConstantAndIsNotEmpty` asserts equality AND `!isBlank` (`:164-177`). |

## Forbidden-condition check

| Forbidden | Holds? | Evidence |
|-----------|--------|----------|
| ZERO_LLM creates a `provider_attempt` | **NO** (good) | See AC3. `GenerationRecovery` never references `ExternalAttemptBinding`/`providerAttemptId`/adapter. |
| All-failure emits unreviewed free text | **NO** (good) | See AC4. |
| Bypass final safety review / break stable generationId | **NO** (good) | Recovery touches only `QuotaLedger` + the safety constant; ownership pass-through; no new generationId. |

## Invariant check

- **INV-GEN-001** (stable generationId): preserved — no path mints or mutates ownership.
- **INV-AUTH-001** (no unbound external attempt): preserved — recovery emits no binding and opens no adapter.
- **INV-COST-001** (no paid/provider prerequisite): preserved — ZERO_LLM is deterministic; recovery only releases synthetic units.
- **fail-closed**: preserved — every failure path releases or NONE; none charges/settles.

## pom acyclicity

`modelruntime → safety → catalog → (junit only)`. `catalog` (`service/platform/catalog/pom.xml`) depends on junit only. `safety` (`service/modules/safety/pom.xml`) depends on catalog + junit. No edge back to modelruntime. **Acyclic.** Safety pulls in nothing unexpected (no Spring, no DB, no adapters).

---

## Findings

### F1 — P2 — NO_CAPACITY silently ignores a non-null prior reservation (latent quota leak on caller misuse)
- **File:line:** `service/modules/modelruntime/routing/GenerationRecovery.java:68-73`
- **Claim:** The `NO_CAPACITY` branch returns `QuotaDisposition.NONE` and never calls `releaseIfPresent`. The method signature permits passing a non-null `priorReservation` for any scenario.
- **Why it matters:** AC1 contracts that "NO_CAPACITY has no reservation," so for correct usage this is fine. But nothing enforces the precondition. A caller that (wrongly) reaches NO_CAPACITY while still holding a reservation would leak the reserved unit indefinitely — the ledger can never recover it and `remaining` is permanently understated by the leaked units. This is the one real fail-closed asymmetry in the new code: `reserve` fails closed, but NO_CAPACITY+reservation does not. There is no test for the misuse case.
- **Suggested fix:** Either (a) assert `priorReservation == null` in the NO_CAPACITY branch, or (b) defensively `releaseIfPresent(priorReservation)` and keep `NONE` only when reservation was null. (a) is preferable because it surfaces the caller bug instead of masking it.
- **Severity rationale:** No consumer wires recovery yet, and the documented contract forbids the misuse; latent only. Not a blocker.

### F2 — P2 — `QuotaLedger.release` is additive with no upper cap (budget inflation on over-/double-release)
- **File:line:** `service/modules/modelruntime/routing/QuotaLedger.java:99-107` (specifically `long after = current + units;`)
- **Claim:** `release` does `current + units` with no clamp at the provisioned budget. Releasing more than was reserved, or releasing the same reservation twice, inflates `remaining` above the provisioned amount.
- **Why it matters:** `reserve` is fail-closed (cannot go negative), but `release` is not symmetric — it cannot detect or prevent over-restoration. `QuotaReservation` carries no consumed/idempotency flag, so a future double-release in a wiring task would silently inflate the synthetic budget. The only production caller (`GenerationRecovery.releaseIfPresent`) releases exactly `reservation.reservedUnits()` once per call, so this is **not exploitable in the current single-release usage**; it is a latent integrity gap.
- **Suggested fix:** Either cap `after` at a stored provisioned ceiling (would require tracking the ceiling), or document the single-release contract on `release`. At minimum, add a test `releaseMoreThanReservedInflatesBudget` to pin today's behavior so a future change is intentional.
- **Severity rationale:** Synthetic in-memory alpha, single-release caller, no real cost. P2.

### F3 — P3 — `releaseIfPresent` releases against the reservation's owner, not the outcome's owner; mismatch not detected
- **File:line:** `service/modules/modelruntime/routing/GenerationRecovery.java:108-112`
- **Claim:** `releaseIfPresent` uses `reservation.ownerUserId()`. If a caller passes an `ownership` for owner-A with a `priorReservation` for owner-B, owner-B's ledger is credited and the outcome carries owner-A's ownership. The two are never compared.
- **Why it matters:** In the only legitimate flow they are equal (`RoutingRequest` enforces `entitlement.ownerUserId == ownership.ownerUserId`, and the router reserves against the entitlement owner). So this is a caller-invariant, not a current bug. Releasing against the reservation owner is arguably the more correct choice (the reservation is the receipt). Not detecting the mismatch is a minor defensive gap.
- **Suggested fix:** Optional `Objects.equals(reservation.ownerUserId(), ownership.ownerUserId())` assertion in `recover`/`completeZeroLlm` to fail fast on caller bugs.

### F4 — P3 — No test for double-release / over-release inflation (coverage gap tied to F2)
- **File:line:** `service/modules/modelruntime/src/test/java/com/virtualcompanion/modelruntime/routing/QuotaLedgerTest.java` (whole file)
- **Claim:** The release tests cover happy-path restore, unknown-owner no-op, zero-unit no-op, negative rejection, and cyclic reserve→release→reserve. There is no test asserting behavior when `release` units exceed reserved units, or when the same reservation is released twice.
- **Why it matters:** The uncapped-additive behavior (F2) is unpinned by a test, so a future change to cap it (or a regression that worsens it) would not be caught.
- **Suggested fix:** Add a test documenting current behavior (e.g., `releaseMoreThanReservedInflatesRemaining`) so the intent is explicit.

### F5 — P3 — Task card lists `QuotaDisposition` values as RELEASED/SETTLED/NONE; implementation omits SETTLED
- **File:line:** `service/modules/modelruntime/routing/QuotaDisposition.java:10-13` vs `docs/tasks/TASK-0032-zero-llm-quota-failure-recovery.md:242`
- **Claim:** The task-card human rendering names three disposition values; the code ships two. The omitted `SETTLED` is the success-finalization path (TASK-0018 `finalize_generation`) and is genuinely out of scope for failure recovery.
- **Why it matters:** It does not — the code comment at `QuotaDisposition.java:10-13` explicitly justifies the omission, the ACs only require RELEASED/NONE, and the card footer states the card is non-normative (machine truth is the backlog). Omitting an unused enum value is defensible (YAGNI). Noted only for traceability.
- **Suggested fix:** None required. Optionally sync the card wording if the card is regenerated.

---

## Coverage notes

- **GenerationRecoveryTest (12 tests):** all four ACs are covered with substantive assertions, not tautologies. The `remaining == 5L` assertions after provision(5)+reserve(1)+recover are the real proof of AC1. Stable-generationId and no-provider-attempt are each asserted across **all** enum values (`:104-117`, `:136-145`), which is the correct exhaustive-enum pattern. The compact-constructor guard has a dedicated negative test (`:147-151`).
- **QuotaLedgerTest release tests (5 added):** happy path, unknown-owner no-op, zero-unit no-op, negative rejection, cyclic stability — solid for the documented contract. Gap: no over-release/double-release (F4).
- **One soft coverage note:** `noCapacityHasNoReleaseAndReachesNoCapacityTerminal` (`:50-60`) asserts `remaining == 5L` after provisioning 5 and doing nothing, so the `remaining` assertion is trivially satisfied (nothing was reserved). The terminal + disposition assertions are the meaningful ones. Acceptable; tied to F1's missing misuse-case test.
- **Concurrency:** neither `reserve` nor `release` has a stress test. Both use `ConcurrentHashMap.compute`, which is atomic per key; a stress test is nice-to-have but not required for a single-reader synthetic alpha.
- **Trusted build:** the harness-reported `mvn -pl service/modules/modelruntime -am test` → BUILD SUCCESS (82 tests, GenerationRecoveryTest 12, QuotaLedgerTest incl. release tests) is consistent with the test files reviewed. Not re-run per instructions.

## Summary line

**PASS** — TASK-0032 meets all four ACs and preserves INV-GEN-001 / INV-AUTH-001 / INV-COST-001 / fail-closed; ZERO_LLM structurally cannot create a provider_attempt and the all-failure/ZERO_LLM response is the safety constant. 0 P0, 0 P1, 2 P2 (NO_CAPACITY reservation leak on misuse; uncapped additive release), 3 P3 (owner-mismatch not asserted; double-release test gap; SETTLED enum doc drift).

# R1 Independent Static Review — TASK-0167

- **Reviewer:** task0167_r1（independent-review-gate, C3 model-routing-change, static-only per Owner 2026-08-12 acceleration strategy）
- **Task:** TASK-0167 — §5.1.4 内存 QuotaLedger.release reservation 级幂等
- **Verdict:** **PASS** — 0 P0 / 0 P1 / 0 P2; 2 P3 (informational, non-blocking, documented below)
- **Reviewed commit:** `723e9bcf6346f6c843a5ee42df6aa4ee39df4b6b`
- **Candidate tree:** `ead8cb398c2c33ac606e0eff97569d723d893215`
- **Base:** `afb43f730189006a371181dbca5413b5cd42cce3`（TASK-0166 ACCEPTED terminal）
- **Authorization commit:** `70f1e0c6014d9adda53db68036220d35c6c26349`

## 1. Method

Static-only R1 (Owner 2026-08-12 acceleration mode): read the full candidate diff + implementation
files + test files, reason about correctness/concurrency/scope/invariants, and reference the
implementer's already-executed gates. No fresh-TMPDIR re-run of doctor / canonical / maven in this
mode. The implementer's gate outputs were inspected from their run logs and re-checked against the
candidate tree.

## 2. Static gates (implementer-executed, referenced)

| Gate | Result | Evidence |
|---|---|---|
| `JAVA_HOME=/opt/homebrew/opt/openjdk@25 ./mvnw --batch-mode --no-transfer-progress -pl service/modules/modelruntime -am test` | **PASS** (exit 0, 3.053s) | BUILD SUCCESS; 173 tests, 0 failures, 0 errors, 0 skipped. QuotaLedgerTest 18 (was 15 + 3 new idempotency tests), GenerationRecoveryTest 13, DeterministicRouterTest 21, LiveModelInvokerTest 26, plus all other modelruntime suites — no regression. |
| `python scripts/harness/precheck.py --task TASK-0167` | **PASS 8/8** (exit 0) | doctor PASS (798315 checks, 121.98s) / catalogValidate / catalogDrift / paidFeatureCheck / licenseCheck / betaRosterGate / openapiValidate / openapiDrift all exit 0. |
| `git diff --check` (working tree and `base..candidate`) | **PASS** (exit 0) | no whitespace/conflict markers across the full range. |
| Diff scope | **6 files, all ∈ writeAllowlist, none ∈ forbiddenPaths** | see §3. |

R1 did not re-run these gates in a fresh TMPDIR (acceleration mode). The candidate identity
(commit `723e9bc`, tree `ead8cb3`) is the one the implementer executed the gates against. Complete
Harness `unittest discover` is deferred to the unified end-of-longline audit per Owner strategy.

## 3. Diff scope verification

Files changed vs base `afb43f73` (name-status):

| Path | Status | writeAllowlist hit |
|---|---|---|
| `.harness/project-state.yaml` | M (activeTask/activeTaskCard/nextAction/updatedAt) | ✓ |
| `docs/tasks/TASK-0167-quota-ledger-release-reservation-idempotency.md` | A (task card) | ✓ |
| `docs/tasks/context/TASK-0167.context-lock.yaml` | A (context lock, fingerprint `53ddb969`) | ✓ |
| `service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/routing/QuotaLedger.java` | M (+73/-) | ✓ |
| `service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/routing/GenerationRecovery.java` | M (1 line) | ✓ |
| `service/modules/modelruntime/src/test/java/com/virtualcompanion/modelruntime/routing/QuotaLedgerTest.java` | M (+97/-) | ✓ |

- **writeAllowlist ∩ forbiddenPaths = ∅**: confirmed by canonical doctor (798315 checks, zero conflict).
  The three written Java files live under `service/modules/modelruntime/**`; `forbiddenPaths` lists
  `service/apps/**`, `service/adapters/**`, `service/tests/**`, `service/platform/**`, `service/**/pom.xml`
  — none glob-match the modelruntime routing files. Other modelruntime files are protected by the
  writeAllowlist allow-listing discipline (any path written but not allowlisted fails doctor).
- **V1–V21 migrations untouched** (forbiddenPaths `V[1-9]__/V1[0-9]__/V20__/V21__`); Flyway checksum safe.
- **DB tests 01–61 untouched**; `infra/db/run-rls-tests.sh` untouched; no DB / RLS / role change.
- **No catalog/contract/openapi/pom change** (canonical drift gates PASS, licenseCheck PASS).
- **QuotaReservation.java / DeterministicRouter.java / RouteDecision.java / LiveModelInvoker.java untouched**
  (reservation flow and audit path unchanged).
- **protected-path trigger & authorization match**: `service/**/modelruntime/**` → C3 +
  `model-routing-change` skill + `independentReview: required` (protected-paths.yaml:28-31 +
  doctor accepted `independentReview in (True,"required","REQUIRED")`); requiredSkillVersions
  `model-routing-change: "1.0.0"`; R1 independent review is mandatory C3 and is this record.
- **contextFingerprint `53ddb969...`** matches context-lock field; inputs pinned at `afb43f73`;
  provenanceOnly `owner-authorization://longline-2026-08-09` hash `cc0f91c1...`. Implementer
  self-verified the algorithm by reproducing TASK-0166 `ad620ead...` first.
- **Authorization projection frozen at READY**: doctor scans every commit
  `authorizationCommit..HEAD` (`70f1e0c` READY → `305e0ca` binding → `723e9bc` IN_PROGRESS); all
  carry a card projection byte-identical to the READY checkpoint (only the mutable `state` /
  `authorizationCommit` fields differ). No projection-changing commit in history.

## 4. Defect authenticity (verified at HEAD `afb43f73`)

- `QuotaLedger.release(String ownerUserId, long units)` (pre-change :94-114) did not receive a
  reservation id. `GenerationRecovery.releaseIfPresent` (:113-117) held a full `QuotaReservation`
  (with `reservationId`) but passed only `ownerUserId()` + `reservedUnits()`, discarding the id.
- The ceiling cap `Math.min(ceiling, current + units)` only blocks a single release from lifting the
  balance above the provisioned ceiling; it cannot tell which reservation a restore belongs to.
  Concrete over-reserve proof: provision 100; reserve r1=60 (rem 40), r2=40 (rem 0); release(r1)
  → rem 60; reserve r3=50 (rem 10); a duplicate release(r1) without idempotency would refund 60
  again → rem 70; then reserve 50 succeeds (70≥50) → over-reserve. With reservation-level
  idempotency the duplicate is a no-op (rem stays 10) and reserve 50 is correctly rejected.
- `releaseCapsAtProvisionedCeiling` (pre-change QuotaLedgerTest:122-132) only covered the benign
  single-reservation repeat (capped by ceiling); it never covered the multi-reservation cross
  over-reserve path. The §5.1.4 Java leg was confirmed open by TASK-0165 review §3
  ("No service/**/*.java changed").

## 5. Implementation semantics

### 5.1 QuotaLedger — reservation-scoped idempotent release

New fields: `releasedReservations: ConcurrentHashMap<String,Boolean>` and
`reservationSequence: AtomicLong`.

- `release(QuotaReservation reservation)` requires non-null; resolves `ownerUserId`,
  `reservedUnits`, `reservationId` from the record; runs inside `remainingByOwner.compute(owner,…)`
  — the contains-key check, the restore, and the `releasedReservations.put` are all inside the same
  compute lambda, and `ConcurrentHashMap.compute` locks the key bin and applies the remapping
  exactly once. So two concurrent releases of the same reservation serialize on the owner key: the
  first restores + marks, the second observes `releasedReservations.containsKey(id)` true and is a
  no-op. ✓ Atomic and exactly-once.
- Restore stays `Math.min(ceiling, current + units)`; an over-release still cannot inflate beyond
  the provisioned ceiling (defense-in-depth behind the idempotency guard). Unknown owner
  (`current == null`) returns 0 and is left absent — fail-closed symmetry with `reserve`. ✓
- Old `release(String, long)` removed. Its only caller already held a `QuotaReservation`; keeping
  the owner+units overload would have left a non-idempotent bypass, defeating this card.

### 5.2 QuotaLedger — reservation id uniqueness

`reserve` now builds `reservationId = "qr-" + reservationSequence.incrementAndGet() + "-" +
DecisionHash.hex(ownerUserId + "|" + current + "|" + units)`. The `incrementAndGet()` runs in the
successful branch of the `compute` lambda (insufficient/unknown branch returns early without
incrementing). Because `compute` applies its remapping exactly-once per call and locks the owner
key, the counter increments exactly once per successful reservation even under contention — there
is no double-increment from remapping retries.

Consequence: successive reservations in one ledger receive distinct ids
(`qr-1-…`, `qr-2-…`, …), so release can idempotently deduplicate a repeated release by id, and a
`reserve→release→reserve→release` cycle for the same (owner, pre-remaining, units) event produces
two distinct reservations each released exactly once. Two **fresh** ledgers observing the same
first event both increment to sequence 1, so `reservationIdIsDeterministicForTheSameEvent` still
holds (mvn PASS). Distinctness within a ledger is asserted by `distinctReservationsReleaseIndependently`.

### 5.3 GenerationRecovery — caller

`releaseIfPresent` now calls `quotaLedger.release(reservation)` (passing the full record). No logic
change; it still guards `null` first. `GenerationRecoveryTest` 13 tests PASS unchanged, proving the
caller adaptation introduces no regression in TIMEOUT/CANCELLED/ALL_FAILURE/NO_CAPACITY/ZERO_LLM
dispositions or the ownership-carry / deterministic-response contracts.

### 5.4 QuotaLedgerTest — coverage

Pre-existing 15 tests retained (provision/reserve/remaining/insufficient/unknown/exhaust/
deterministic-id/zero-units/distinct-owners/negative-reject + 5 release tests), adapted to the new
`release(QuotaReservation)` signature by first reserving to obtain the reservation. No test deleted;
no assertion weakened. `releaseRejectsNegativeUnits` becomes
`reservationRejectsNegativeUnitsSoReleaseCannotUnderflow` — the negative-units rejection is now
enforced by the `QuotaReservation` record compact constructor (which forbids negative
`reservedUnits`), so a forged negative reservation can never reach the restore arithmetic; the
assertion is preserved as an IllegalArgumentException on record construction.

Three new idempotency tests:
- `releaseRepeatedForSameReservationIsIdempotent`: repeat release of one reservation restores once.
- `releaseIdempotencyPreventsOverReserve`: the multi-reservation cross scenario above; asserts the
  duplicate release is a no-op (rem stays 10) and the subsequent 50-unit reservation is correctly
  rejected — machine-proves the over-reserve hole is closed.
- `distinctReservationsReleaseIndependently`: two reservations restore independently and a repeated
  release of one does not disturb the other; also asserts distinct ids within one ledger.

All 18 PASS (mvn).

## 6. Invariants and adjacent risk

- **fail-closed integrity**: reservation still fails closed on unknown owner / insufficient budget;
  release on an owner with no budget is a no-op returning 0; the ceiling cap still prevents
  inflation. The new idempotency is a strict **strengthening** (a repeated release now restores
  exactly what was reserved, never more) — no previously-valid path is narrowed. mvn 173/173 PASS.
- **INV-GEN-001** (stable generationId): unchanged; `QuotaReservation` and the recovery flow still
  carry `OwnershipTuple` unchanged; no generation lifecycle touched.
- **INV-AUTH-001** (external attempt binds snapshots): untouched; `LiveModelInvoker`,
  `ProviderAttemptAudit`, and the snapshot guard path are unchanged. (Java-side audit projection of
  snapshot ids remains a P2-12 JDBC wiring concern, correctly out of scope for this card.)
- **INV-COST-001** / license: no new dependency; `pom.xml` unchanged; licenseCheck PASS.
- **INV-TENANT-001** / RLS: no DB change.
- **INV-HARNESS-002/003/005/007/009**: single active task, writeAllowlist-scoped, evidence does not
  convert an unexecuted check into PASS, single-card policy, LOCAL_EXACT_TREE_FALLBACK frozen at
  READY (remote exact-SHA remains non-PASS, dispatchCount=0).
- **Concurrency**: idempotency check-and-mark is atomic per owner (compute key-bin lock);
  `releasedReservations` is a separate `ConcurrentHashMap` keyed by the globally-unique reservation
  id; cross-owner releases proceed independently with no shared-key contention. No deadlock risk
  (single compute lock, no nested compute).

## 7. Findings by severity

### P0 / P1 / P2 — none.

No security hole, data loss, invariant violation, functional defect, or scope violation. The
over-reserve hole is closed; existing fail-closed semantics preserved; no DB/catalog/contract/pom
change; no test deleted/skipped; no exit code swallowed.

### P3 (informational, non-blocking) — 2

1. **`QuotaReservation.java` javadoc drift (not in writeAllowlist, not fixable in this card).** The
   record's class javadoc states the `reservationId` is "recomputable from this record's own fields"
   because pre-reservation remaining equals `remainingUnits + reservedUnits`. After this change the
   id carries a per-ledger `reservationSequence` prefix that is **not** stored in the record, so the
   full id is no longer recomputable from record fields alone (only its `DecisionHash.hex` suffix
   is). `QuotaLedger`'s own javadoc documents the sequence-prefix trade-off explicitly, so the
   behavioral intent is captured at the producer. Functional impact: none (the id is consumed as an
   opaque idempotency key and audit token, never recomputed by callers). Recommended follow-up: a
   small cleanup card updates `QuotaReservation.java` javadoc (or stores the sequence) so the record
   documentation matches the producer. Non-blocking because `QuotaReservation.java` is outside this
   card's writeAllowlist and the behavior is correct.

2. **`releasedReservations` is unbounded.** The ledger never evicts released reservation ids, so a
   long-running in-memory ledger accumulates one short string per reservation. Acceptable for the
   Technical Alpha synthetic simulator (no persistent row, bounded request volume, per-owner key
   space); a persistence/productionization task (P2-12 JDBC wiring or later) should add eviction or
   move release tracking to the persistent store. Non-blocking.

## 8. Acceleration-mode notes

- Per Owner 2026-08-12 static-gates-only strategy, complete Harness `unittest discover` is deferred
  to the unified end-of-longline audit (single-process serial run); not converted to a PASS here.
  The Java behavior is directly proven by `mvn -pl service/modules/modelruntime -am test` (173 tests)
  and the harness invariants by canonical precheck (doctor 798315).
- Standalone `doctor.py` (summary / DRAFT / READY / pre-closure) was skipped in this mode; the
  canonical precheck `doctor` subcommand is the single doctor gate and it PASSED.
- Root-level `./mvnw verify` is deferred to the unified audit; the affected-module `test` is the
  iteration evidence and PASSED.
- R1 is static-only (no fresh-TMPDIR re-run of doctor/canonical/maven), per the acceleration policy.

## 9. Conclusion

**R1 PASS.** §5.1.4's Java leg lands cleanly: `QuotaLedger.release` is reservation-scoped and
idempotent (atomic check-and-mark in one per-owner `compute`), `reserve` mints ledger-unique
reservation ids via a sequence prefix while preserving cross-ledger event determinism, the sole
caller `GenerationRecovery` passes the full reservation, and three new tests machine-prove the
idempotency including the multi-reservation over-reserve hole. 6 files all in writeAllowlist,
forbiddenPaths zero conflict, V1–V21 and DB tests 01–61 frozen, no catalog/contract/pom change.
0 P0/P1/P2; 2 P3 (QuotaReservation javadoc drift outside writeAllowlist + unbounded released-set,
both non-blocking, both with recommended follow-up). Static gates PASS (mvn 173/0, canonical 8/8
doctor 798315, diff exit 0). Complete Harness unittest + root-level Maven verify deferred to unified
audit per Owner static-gates-only strategy (not converted to PASS).

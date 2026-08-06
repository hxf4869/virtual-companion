# R1 Review — TASK-0022 (Fake/Failure offline end-to-end slice)

- **Reviewed commit**: `69d782b09ff44fca65c978ca22e21e7896c59a67` (candidate)
- **Candidate tree**: `1382e9ea878a60811a9b4c71ee56a239f7d68a0d`
- **Reviewer**: `task0022_r1` (independent-review-gate, general-purpose agent)
- **Budget**: 15 min (elapsed ~378s, hard limit not reached)
- **Verdict**: **PASS** — no P0/P1, no ACCEPTANCE_VIOLATION, no INVARIANT_VIOLATION

## Scope (COMPLETE_MATRIX)
Correctness, acceptance coverage, invariants (INV-AUTH-001, INV-GEN-003,
INV-TX-001, INV-RT-001), adjacent risk, and READY-frozen field integrity.

## Verified (no issue)
1. **READY-frozen fields intact.** `git diff 437a973(READY)..69d782b` on the card
   shows only `state: READY→IN_PROGRESS` and the added `authorizationCommit`.
   `writeAllowlist`/`forbiddenPaths` are unchanged; no forbidden path or main
   module code touched.
2. **Authorization denial = zero outbound transfer (INV-AUTH-001).** The slice
   returns `DENIED_BY_AUTHORIZATION` before the `adapter.open(request)` block.
   With `denyAuthorization=true` the execution snapshot is `WITHDRAWN`;
   `AuthorizationSnapshot.isActive()` is false, so the guard denies and the
   adapter is never opened.
3. **LATE_DELTA → FAILED_INVALID_STREAM (INV-RT-001).** Confirmed against
   `FailureModelProtocolSession`: the stale-fence prefix is discarded on
   `BINDING_MISMATCH` (expectedSequence stays 0), then the following `Disconnected`
   failure is discarded on `SEQUENCE_MISMATCH`; the reducer never terminates and
   the slice maps `termination==null` to `FAILED_INVALID_STREAM`. No missing delta
   is fabricated; `discardedStaleEvents` counts the stale prefix only.
4. **Safety-input design (INV-GEN-003).** `safetyAllowsCompletion=false` plus a
   `Succeeded` termination yields `BLOCKED_AT_SAFETY`; the only completion signal
   is `terminalState==COMPLETED`, never produced for BLOCKED. Provider EOS never
   implies chat.completed. The absence of a safety-module compile dependency is
   structurally enforced (pom is a READY-frozen forbiddenPath); the slice proves
   the terminal-state EFFECT of safety without recomputing the gate.
5. **Dual-binding design.** Structurally required: `guard.authorize()` takes an
   `ExternalAttemptBinding`; Fake/Failure adapters require a
   `DeterministicSourceBinding`. The slice uses the correct binding at each
   primitive. The receive/worker external→deterministic handoff is JDBC-bound and
   proven by the SQL suite — an honest scope boundary.
6. **Sealed-interface exhaustiveness.** `mapFailure` covers all 8 `AdapterFailure`
   subtypes (6 explicit + `UnsupportedBinding`/`UnsupportedCapability` via the
   `FAILED_INVALID_STREAM` fallback). The termination chain covers all 4
   `AttemptTermination` subtypes plus the `termination==null` fallback.
7. **Distinctness.** `allFaultClassesProduceDistinctTerminalStates` runs 13
   scenarios and asserts set size == list size; all 13 map to distinct enum values.
8. **DISCONNECT vs LATE_DELTA.** DISCONNECT's prefix uses the live binding with a
   contiguous sequence, so it is accepted and `discardedStaleEvents==0`. Correctly
   distinguished from LATE_DELTA.

## Non-blocking findings
- **P2** — The card human-readable body lists "恢复" (recovery) in scope, but the
  slice defers resume/recovery to the SQL contract suite (acceptance criteria
  omit recovery; approval evidence narrows scope to the in-process model-runtime
  slice; handoff states this explicitly). Documentation-only inconsistency, not an
  acceptance violation.
- **P3** — `SliceConfiguration.failure(...)` sets `cancelMidStream=false`, which is
  a footgun for `CANCELLATION_FAILED` (that scenario only terminates after
  `cancel()`). Both tests bypass it with the raw constructor. Not a defect — the
  slice is correct and deterministic; ergonomic note for future reuse.

## Recommendation
Proceed to closure. The P2 scope clarification is recorded in the handoff.

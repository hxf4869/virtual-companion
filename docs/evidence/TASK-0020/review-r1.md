# TASK-0020 Independent Review R1

## Candidate

- Commit: `a6628fe6152750f3185236e133d581a7f670088e`
- Tree: `b51aac889fadba3cd3cd5cf03e2184f07ee2ba1f`
- Base: `f186ecedf495e03544d48dbd0dc2a24b62f3a524`

## Verdict: PASS (after one fix batch)

R1 returned PASS with no P0/P1 on the implementation candidate `cacb0a1`. The
cardinal safety invariant (no ALLOW on a classifier failure outcome) holds. One
non-blocking finding (P2-1, test brittleness to catalog outcome additions) was
closed because it strengthens the fail-closed proof. Fix batch (commit `a6628fe`);
R2 finding-closure PASS, no new P0/P1.

## Scope

R1: COMPLETE_MATRIX, ACCEPTANCE, INVARIANTS, ADJACENT_RISK for the deterministic
fail-closed safety pipeline (C4, protected path service/**/safety/**). R2:
FINDING_CLOSURE only.

## Cardinal invariant — verified clean

Traced every `SafetyClassifierOutcome` through `SafetyGate.evaluate`:
- The only ALLOW path (`SafetyGate:44`) requires `classifier.adequate()`.
- `ClassifierReport.adequate()` is `outcome == CLASSIFIED && confidence >= 0.80`, short-circuiting on the outcome — so every failure outcome (LOW_CONFIDENCE, TIMEOUT,
  UNAVAILABLE, INVALID_RESPONSE, RULE_CONFLICT) returns false regardless of confidence → BLOCK.
  **Confidence cannot rescue a failure outcome.** Float boundary is fail-safe (`>=`; any value
  below the constant blocks).
- Hard rules (`SafetyGate:40-42`) are checked first and are absolute: the classifier is never
  queried on the hard-rule path, so it can never lower a hard-rule block (contract rule).
- Final review: `SafetyReview.finalReview` maps non-ALLOW → BLOCK; `mayComplete` returns true only
  on ALLOW, so a final-review failure prevents `chat.completed` (acceptance #2).
- ZERO_LLM: `DeterministicSafetyResponse.ZERO_LLM_FALLBACK` is a fixed non-blank constant; no model
  invocation, deterministic.
- Determinism: static/utility methods + one immutable record; no fields/clock/random/IO. Same
  inputs → same verdict.

## Non-blocking finding (R1, closed)

### [P2-1 / TEST_BRITTLENESS] fail-closed test hardcoded the 5 failure outcomes — fixed

`SafetyGateTest.everyClassifierFailureOutcomeFailsClosed` enumerated the five outcomes literally;
a future catalog outcome addition would not be covered (the gate would still fail closed, but the
test would not prove it). For a safety pipeline this matters. **Fix (a6628fe)**: iterate
`SafetyClassifierOutcome.values()` skipping `CLASSIFIED`, so any new failure outcome is automatically
proven to fail closed. R2 confirmed (13/13 PASS).

## Non-blocking notes (R1, accepted)

- **P2-2**: null/blank inputs throw (NPE / IllegalArgumentException) rather than return BLOCK. These
  are out of the contract's enumerated failure outcomes, there are no consumers yet, and an
  exception de-facto emits no content. Accepted; a future wired caller should treat exceptions as BLOCK.
- **P2-3**: the pipeline delivers raw primitives; wiring into the real streaming pause + chat.completed
  hook lives in the conversation module (forbidden here). Acceptance is stated at the primitive level
  and is met. Tracked as a follow-up.

## Governance & scope — verified clean

- `service/**/safety/**` is C4 requiring safety-change skill + humanApproval + independent review
  (protected-paths). Card carries requiredSkill `safety-change 1.0.0`, a `safety-change` humanApproval
  by repository-owner, and `independentReview: required` (this review).
- 10 candidate files (pom.xml root one-line module add + safety/pom.xml + 5 main + 3 test) all within
  writeAllowlist; forbiddenPaths untouched (conversation, persistence, migrations, specs, scripts, skills
  all empty diff). No external consumer of `com.virtualcompanion.safety` outside the module.

## Coverage notes

R1 ran the Docker Temurin-25 safety build (BUILD SUCCESS, 13/13) and traced every outcome path on the
candidate; the implementer ran the full harness suite (233 OK) and canonical precheck (doctor 292222 PASS).

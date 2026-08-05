# TASK-0018 Independent Review R1

## Candidate

- Commit: `ec95357f14497914a9a529b8c0489287ab395bc`
- Tree: `eb91bb41f6d4594bc54bc22c521daaaba77ec799`
- Base: `2dfee84a9f7ceece071cd102e11e67ef5ed1e42b`

## Verdict: PASS (after one fix batch)

R1 returned PASS with no P0/P1 on the implementation candidate `44d1031`. One
non-blocking finding (P2-1, a misconfigured composite-FK ON DELETE action) was
closed because it declared an impossible action. The fix batch (commit `ec95357`)
switched to PG18 column-scoped `ON DELETE SET NULL (assistant_message_id)`;
R2 finding-closure confirmed PASS with no new P0/P1.

## Scope

R1: COMPLETE_MATRIX, ACCEPTANCE, INVARIANTS, ADJACENT_RISK for the
finalize_generation atomic transaction (C4 database-migration). R2:
FINDING_CLOSURE only.

## Non-blocking finding (R1, closed)

### [P2-1 / SCHEMA_MISCONFIG] composite FK ON DELETE SET NULL covered a NOT NULL column — fixed

`generation_assistant_message_fk` used `FOREIGN KEY (owner_user_id,
assistant_message_id) REFERENCES vc.message(owner_user_id, id) ON DELETE SET NULL`.
A multi-column SET NULL nulls every FK column, but `generation.owner_user_id` is
NOT NULL, so the action could never succeed and would raise on an anomalous
direct delete of a bound assistant message (fail-safe, no corruption; normal
conversation-cascade deletes were unaffected because the generation is cascaded
first). **Fix (ec95357)**: PG18 column-scoped `ON DELETE SET NULL
(assistant_message_id)` — only the nullable binding column is nulled,
`owner_user_id` is preserved. R2 confirmed the migration applies on PG18 and
tests 16/17 (FK-dependent) still PASS.

## Non-blocking note (R1, accepted)

- **P2-2**: `FinalizeGenerationService` uses `double actualCost` for the
  `numeric(18,6)` cost column. `BigDecimal` is the textbook money type, but the
  skeleton is consistent, JDBC converts cleanly and test values map without loss;
  accepted as a future convention refinement, not a defect.

## Verified

- **Atomicity (INV-TX-001)**: test 16 commits all artifacts (final assistant
  message, candidate is_final, generation COMPLETED + assistant binding, usage,
  SETTLE quota, PENDING chat.completed, outbox). Test 17 injects a fault AFTER
  all 7 writes and proves the whole transaction rolls back — generation stays
  FINAL_REVIEW, candidate not final, no assistant message, usage/quota/realtime/
  outbox all 0 rows. The fault hook sits after every write; the exception
  propagates to the caller's subtransaction savepoint. Context is bound with
  SET LOCAL before the DO block so the inner-exception rollback restores owner
  scope for verification (test 16's count==1 with the same binding proves test
  17's count==0 is a real atomicity check, not an RLS false-pass).
- **EOS guard (INV-GEN-003)**: test 18 — an IN_PROGRESS generation is rejected
  by the FINAL_REVIEW precondition; no chat.completed, no assistant message,
  status unchanged. Provider EOS arriving in IN_PROGRESS can never complete.
- **Unique final (INV-GEN-002)**: finalize marks the candidate is_final, backed
  by the pre-existing `generation_candidate_one_final` partial unique index.
- **TASK-0016 P0 trap closed**: `REVOKE EXECUTE ON FUNCTION
  vc.finalize_generation(bigint,bigint,bigint,text,text,bigint,bigint,numeric,
  text,integer,boolean,text) FROM PUBLIC` with the exact CREATE signature; grant
  only to vc_api. Live-probed: vc_worker denied (test 18).
- **Definer/tenant**: set_config('vc.owner_user_id', …, true) before any write;
  FORCE RLS + WITH CHECK on all four new tables; explicit owner predicate in
  every WHERE/VALUES as defense in depth. chat.completed and outbox stay PENDING
  (published post-commit, out of scope).
- **RETURNS TABLE**: out_-prefixed output columns avoid the TASK-0017
  table-column shadowing; no RETURNING ambiguity. JDBC column names match the
  function output exactly.
- No BYPASSRLS anywhere; V1-V6 untouched; 01-15 still apply; all 9 candidate
  files within writeAllowlist; run-rls-tests.sh and tests 01-15 untouched;
  `git diff --check` clean.

## Coverage notes

R1 ran the SQL suite (18/18 PASS) and the Docker Temurin-25 persistence build
(BUILD SUCCESS, FinalizeGenerationServiceTest 5/5) and adversarial probes
(EXECUTE isolation, cross-owner finalize, fault rollback) on the candidate; the
implementer separately ran the full harness suite (233 OK) and canonical
precheck (doctor 280537 PASS).

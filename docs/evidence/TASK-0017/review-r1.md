# TASK-0017 Independent Review R1

## Candidate

- Commit: `63d87be0ee725a710ad9b1bad790f3c5d6ddeee8`
- Tree: `042be64934d9b2a6af550f08abbf90c4b848183d`
- Base: `f46ab941d3d08e1f6637d126f7d09e7ebcb53b95`

## Verdict: PASS (after one fix batch)

R1 returned PASS with no P0/P1 on the implementation candidate `150e78e`. Three
P2 observations were raised; one (P2-1) was closed because it sits on the exact
TASK-0016 P0 defect class. The fix batch (commit `63d87be`) added the missing
regression assertion; R2 finding-closure confirmed PASS with no new P0/P1.

## Scope

R1: COMPLETE_MATRIX, ACCEPTANCE, INVARIANTS, ADJACENT_RISK for the
conversation/generation persistence + idempotent reception layer (C4
database-migration). R2: FINDING_CLOSURE only.

## Non-blocking finding (R1, closed)

### [P2-1 / ACCEPTANCE_GAP, borderline-P1] no EXECUTE-isolation regression for receive_generation — fixed

`vc.receive_generation` is SECURITY DEFINER and correctly revokes PUBLIC EXECUTE
(granting only `vc_api`), but tests 13-15 contained no assertion that a non-`vc_api`
role cannot invoke it. Given TASK-0016's P0 was a default-PUBLIC-EXECUTE payload
leak on the claim functions, the property is load-bearing and should be
machine-checked, not assumed. **Fix (63d87be)**: test 13 now also runs as
`vc_worker` and asserts `receive_generation` raises `insufficient_privilege`
(the `raise_exception` from the "unexpectedly executed" branch would NOT be
caught, so a regression flips the test to FAIL). R2 confirmed.

## Non-blocking findings (R1, accepted as non-exploitable)

- **P2-2**: `GRANT USAGE, SELECT` on both sequences is granted to all four
  runtime roles, wider than the delivered code needs (only the SECURITY DEFINER
  function allocates ids, as definer). Accepted: sequences carry no tenant data,
  cannot `setval` without UPDATE, and V2 already grants all four roles full DML
  on every table — sequence USAGE is strictly less privileged and consistent with
  that baseline. Tightening would add churn for no security gain.
- **P2-3**: the duplicate-reception `SELECT ... INTO` (after ON CONFLICT DO
  NOTHING) takes no lock, so a concurrent delete of that exact row between INSERT
  and SELECT could yield NULL. Accepted as non-exploitable: there is no delete
  path for generations and the migration is append-only; a `FOR UPDATE` would add
  lock contention for no real benefit.

## Verified

- **TASK-0016 P0 trap closed**: `REVOKE EXECUTE ON FUNCTION
  vc.receive_generation(bigint,bigint,text,text,text) FROM PUBLIC` present;
  signature matches CREATE; grant only to `vc_api`. Live-probed: `vc_worker` and
  `vc_job_coordinator` cannot execute (permission denied). No payload surface in
  the return shape regardless.
- **Owner bound before writes**: `set_config('vc.owner_user_id', ...)` runs before
  every insert so FORCE RLS `WITH CHECK (owner_user_id = current_owner_id())`
  passes; owner also used explicitly as a column value (defense in depth).
- **Idempotency is real**: duplicate (same owner + key) returns the SAME
  `logical_generation_id` + `generation_id`, `created=false`, NULL `message_id`,
  and creates no second message (tests 13/14 + a retry-with-different-content
  probe). NULL key is not deduped (partial index ignores it; test 14: 3 messages).
- **No RETURNING/column ambiguity**: the function pre-computes `v_logical`/`v_gen_id`
  so no `RETURNING` is needed (RETURNS TABLE output names would otherwise shadow
  the table columns); the duplicate-path SELECT is alias-qualified.
- **Composite FK intact**: cross-owner generation reference (owner 1 -> conversation
  200 of owner 2) is denied by `vc.generation(owner_user_id, conversation_id) ->
  vc.conversation(owner_user_id, id)` both on direct insert and through the
  SECURITY DEFINER function (test 15).
- **Java correctness**: JDBC RowMapper column names exactly match the function
  output (`logical_generation_id`, `generation_id`, `message_id`, `created`);
  nullable `message_id` read via `(Long) rs.getObject(...)` not `getLong`; status
  kept as `String` (no catalog dependency); value-object invariants sound.
  Docker Temurin-25 build SUCCESS, 17/17 tests.
- No BYPASSRLS anywhere; V1-V5 untouched; 01-12 still apply; all 13 diff files
  within writeAllowlist; `git diff --check` clean.

## Coverage notes

R1 ran the SQL suite (15/15 PASS), the Docker Temurin-25 persistence build
(BUILD SUCCESS, GenerationReceiveServiceTest 12/12) and adversarial probes for
EXECUTE isolation, cross-owner write and conflict idempotency on the candidate;
the implementer separately ran the full harness suite (233 OK) and canonical
precheck (doctor 274817 PASS).

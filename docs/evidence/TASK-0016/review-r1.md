# TASK-0016 Independent Review R1

## Candidate

- Commit: `ec634f3ca00f684eef4334b0932e7fd954e0de7c`
- Tree: `da595e06cf0308d21558c45e44a7ede8ea527784`
- Base: `b552b0f22f81eb61a6856f57aad8c5f0cbe3602a`

## Verdict: PASS (after one fix batch)

R1 initially returned FAIL with one P0 plus P2/P3. The fix batch (commit `ec634f3`)
closed all three; R2 finding-closure confirmed PASS with no new P0/P1.

## Scope

R1: COMPLETE_MATRIX, ACCEPTANCE, INVARIANTS, ADJACENT_RISK for the worker
claim/lease/fence layer (C4 database-migration). R2: FINDING_CLOSURE only.

## Blocking finding (R1, closed)

### [P0 / ACCEPTANCE_VIOLATION] claim_work_items leaked payload via default PUBLIC EXECUTE — fixed
The five SECURITY DEFINER functions defaulted to `PUBLIC EXECUTE`. The table-level
`REVOKE ALL ON vc.work_item FROM PUBLIC` does not affect function privileges, so
`vc_job_coordinator` could call `claim_work_items` (whose `RETURNS TABLE` includes
`payload`) and read work payloads — bypassing the column-level isolation. Test 12
only checked a direct `SELECT payload`, so the gap was undetected.
**Fix (ec634f3)**: `REVOKE EXECUTE ON FUNCTION … FROM PUBLIC` for all five
functions before `GRANT … TO vc_worker`; test 12 now also asserts the coordinator
cannot execute `claim_work_items`. R2 confirmed no PUBLIC EXECUTE remains.

## Non-blocking findings (R1, closed)

- **P2**: `GRANT SELECT, INSERT, UPDATE, DELETE ON vc.work_item TO vc_worker` allowed
  a direct write bypassing `_terminalize`'s lease/fence/token guards. **Fix**: vc_worker
  now holds `GRANT SELECT` only (read preserved for test 07; writes must use the
  SECURITY DEFINER functions). R2 confirmed.
- **P3**: unused `_claim_is_live` was PUBLIC-executable. **Fix**: removed (the live-claim
  guard is inlined in `renew_lease`/`_terminalize`). R2 confirmed.

## Verified

- Late-write guards (08-11): `_terminalize`/`renew_lease` WHERE requires owner =
  current_owner_id(), claim_token, claim_fence = current `vc.job_fence`, status =
  CLAIMED, lease > now(). NULL context / expired lease / wrong token / stale fence all
  match zero rows → zero write. Tests are genuine (test 11 checks status as superuser).
- claim_work_items (07): SECURITY DEFINER, atomic claim via FOR UPDATE SKIP LOCKED +
  LIMIT, filters by p_owner_user_id (no cross-tenant scan), rejects STALE/empty fence,
  binds vc.owner_user_id + vc.job_fence for the transaction.
- Coordinator payload isolation (12): column-level SELECT on metadata only; payload
  denied both via direct SELECT and via function call (after the P0 fix).
- No BYPASSRLS anywhere; FORCE RLS on work_item; V1-V4 untouched; 01-06 still apply.

## Coverage notes

Static review only; the implementer ran the SQL suite (12/12 PASS), the Docker
Temurin-25 build (persistence SUCCESS, WorkItemClaimServiceTest green) and the full
harness suite (233 OK) on the candidate.

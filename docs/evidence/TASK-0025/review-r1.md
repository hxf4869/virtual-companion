# R1 Review — TASK-0025 (Chat/Generation/History API)

- **Reviewed commit**: `5652811484d97c7221147701b2a48d4410948db3` (candidate)
- **Candidate tree**: `40a84ac6093631aafe9d33d6a6203c1a32b092cb`
- **Reviewer**: `task0025_r1` (independent-review-gate, general-purpose agent, single adversarial pass)
- **Budget**: 15 min (elapsed ~258s, hard limit not reached)
- **Verdict**: **PASS** — no P0/P1/P2. One P3 documentation nit. Both acceptance criteria satisfied.

## Acceptance criteria

**OpenAPI 合同与生成 Client 无漂移: SATISFIED.** `openapi_tool.py validate` PASS;
`diff --fail-on-drift` PASS (spec ↔ dist in sync, including the new Generation/
GenerationSnapshot/Message/SendGenerationRequest Java records + TS client + 4 new
interface methods). specs/catalog/error-codes.yaml and specs/generated/** unchanged
(NOT_FOUND_OR_FORBIDDEN reused, no new error code).

**幂等、取消、分页和越权测试全部通过: SATISFIED.** Full SQL suite 01–31 PASS in a fresh
ephemeral PG18+pgvector container (V10 applies after V9 via the sort -V fix). Idempotency
is structurally proven by existing tests 13/14 (partial unique index on receive_generation);
cancel and pagination are proven by the new tests 30/31; cross-tenant fail-closed is re-confirmed
by 01–12/15/24/25/28.

## Review matrix (12) — independently verified

1. **cancel_generation state correctness** — OK. The cancellable IN-list (CREATED, INPUT_REVIEW,
   QUEUED, IN_PROGRESS, WAITING_FOR_CAPACITY, FINAL_REVIEW) exactly matches the catalog states
   that have a →CANCEL_REQUESTED edge. COMMITTING (no edge) and all six terminal states rejected.
   The double-hop non-terminal→CANCEL_REQUESTED→CANCELLED is mandatory (no direct edge).
2. **cancel TOCTOU / concurrency** — OK. SELECT ... FOR UPDATE locks the target; the two UPDATEs
   run in the same transaction. A concurrent finalize/cancel blocks on the row lock, then observes
   the terminal row and is rejected. Ownership check + transition indivisible.
3. **cancel existence hiding** — OK. Cross-owner/absent resolves to 0 rows under FORCE RLS + the
   explicit predicate and raises; the message echoes only the caller-supplied id/owner, never the
   foreign owner (matches the V8 read_generation_snapshot baseline).
4. **list_messages pagination** — OK. Keyset `id > p_after_id ORDER BY m.id LIMIT p_limit` is
   deterministic (id is PK leading column). Limit clamp NULL/<1→50, >100→100; after_id NULL→0.
5. **list_messages existence hiding** — OK. The composite FK (message→conversation on owner+id)
   structurally forbids a cross-owner reference; cross-owner/cross-conversation/absent → 0 rows,
   indistinguishable from an owned-but-empty conversation.
6. **SECURITY DEFINER hygiene** — OK. Both functions SECURITY DEFINER SET search_path=vc,public,
   REVOKE PUBLIC + GRANT vc_api, set_config binds vc.owner_user_id, out_-prefixed RETURNS TABLE.
7. **sort -V fix** — OK. Correct for V1<...<V9<V10 (lex sort put V10 before V1 since '0'<'_');
   matches Flyway version ordering; minimal scope (runner line + comment); test glob unchanged.
8. **OpenAPI correctness** — OK. listMessages correctly omits 404 (200-empty hides existence for a
   LIST; 404-on-empty would leak ownership to a probing caller). send/cancel/snapshot carry 404.
   SendGenerationRequest.idempotencyKey required. Schemas coherent (snapshot events jsonb→object).
9. **No catalog/generated change** — OK. Confirmed by diff.
10. **writeAllowlist / forbiddenPaths** — OK. All 12 changed leaves map to writeAllowlist (V10,
    tests 30/31, run-rls-tests.sh, openapi spec, specs/openapi/dist/**, card, context-lock,
    project-state). No forbidden path touched; V1–V9 unmodified.
11. **Test quality** — OK. Test 30 covers happy path + re-cancel/COMPLETED/COMMITTING rejection +
    cross-owner/absent raise + foreign-untouched + own-cancel. Test 31 covers page/cursor/limit
    clamp/cross-isolation. Neither tautological.
12. **Idempotency reuse** — OK. sendGeneration reuses vc.receive_generation (V6) whose idempotency
    is structurally proven by tests 13/14 via the partial unique index; reuse is correct.

## Independent verification executed
- `bash infra/db/run-rls-tests.sh` → all 31 PASS (re-run in a fresh ephemeral PG18+pgvector container)
- `python scripts/dev/openapi_tool.py validate` → PASS
- `python scripts/dev/openapi_tool.py diff --fail-on-drift` → PASS
- `git diff --stat 84ca885 5652811 -- specs/catalog specs/generated specs/contracts` → empty
- `git diff --stat 84ca885 5652811 -- service/.../V[1-9]__*.sql` → empty (V1–V9 unmodified)
- writeAllowlist cross-checked against all 12 changed leaves

## Non-blocking findings (P3 — no fix batch; pure documentation/coverage, no bearing or safety impact)

- **P3-1** `V10__generation_cancel_message_history.sql:21-23` header comment says
  "set_config binds `vc.current_owner_id`". That GUC does not exist in the codebase — every
  migration and V10 itself (lines 53/115) bind `vc.owner_user_id`. The code is correct; only the
  comment's GUC name is a typo. No runtime impact. (Documented; not a blocker.)
- **P3-2** Test 30 exercises only IN_PROGRESS as the cancellable state (not CREATED/INPUT_REVIEW/
  QUEUED/WAITING_FOR_CAPACITY/FINAL_REVIEW) and two terminal rejections (COMPLETED, CANCELLED). The
  function uses a single IN-list, so IN_PROGRESS is representative; the tricky COMMITTING case is
  tested. Broader state coverage would be stricter but is not a defect.
- **P3-3** `list_messages` filters `conversation_id` against the PK `(owner_user_id, id)`; a dedicated
  `(owner_user_id, conversation_id, id)` index would be more optimal for high-cardinality owners.
  Fine for Alpha scale; noted for completeness, not as a blocker.

## Conclusion
No P0/P1/P2. The state machine, concurrency (FOR UPDATE serialization), existence hiding (empty/
identical-exception across cases), SECURITY DEFINER hygiene, sort -V fix, OpenAPI coherence (including
the deliberate listMessages no-404 design), idempotency reuse and writeAllowlist compliance are sound.
Both acceptance criteria are satisfied.

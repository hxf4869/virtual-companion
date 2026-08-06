# R1 Review — TASK-0027 (Canonical Memory 持久化与所有权隔离)

- **Reviewed commit**: `e4022176cd54c7cc04d96f7c7842d45831bccdc7` (candidate)
- **Candidate tree**: `09c774d83a0c8c17cfe32829b83178ae7a585e73`
- **Reviewer**: `task0027_r1` (independent-review-gate, general-purpose agent, single adversarial pass)
- **Budget**: 15 min (elapsed ~668s, hard limit not reached)
- **Verdict**: **PASS** — no P0/P1. Both acceptance criteria satisfied.

## Acceptance criteria

**Canonical Memory 只有确认路径可创建有效记录: SATISFIED.** create_memory_candidate hardcodes
'PENDING_CONFIRMATION' (never ACCEPTED); confirm_memory_candidate is the sole PENDING_CONFIRMATION→ACCEPTED
transition, guarded by a status check. REVOKE of INSERT/UPDATE/DELETE/SELECT on memory_item/memory_evidence
from every runtime role means a direct INSERT or UPDATE to status='ACCEPTED' is blocked (test 32 proves
INSERT→insufficient_privilege; the reviewer independently probed UPDATE→insufficient_privilege). No other
function touches memory_item.status. ACCEPTED is reachable only via confirm_memory_candidate.

**跨用户、跨关系和缺上下文均失败关闭: SATISFIED.** Cross-user: confirm/reject/delete/get on a foreign id
raise/return-empty without disclosing the foreign owner (test 33). Cross-relationship: list_memory scopes
strictly by (owner, relationship_id), so relationship 10's list excludes relationship 11's memory (test 33).
Missing-context: the runtime role has NO direct table access (SELECT also revoked → insufficient_privilege),
so every access flows through the functions which establish the owner context from their parameter (test 33).

## Review matrix (10) — independently verified
1. **Confirmation-only path (INV-MEM-001/002)** — sound. ACCEPTED only via confirm; create only PENDING_CONFIRMATION; direct INSERT/UPDATE blocked by REVOKE.
2. **Cross-relationship list isolation** — sound. list_memory relationship-scoped (test 33).
3. **Cross-user / existence hiding / TOCTOU** — sound. Foreign id raises/empty without leaking owner; FOR UPDATE in confirm/reject prevents concurrent TOCTOU; delete is an atomic conditional UPDATE.
4. **SECURITY DEFINER hygiene** — sound. All 6 functions SECURITY DEFINER SET search_path=vc,public, fully-qualified vc.*, out_-prefixed RETURNS TABLE, REVOKE PUBLIC + GRANT vc_api. No search_path hijack surface.
5. **Catalog/scope conformance** — sound. Literals match memory-candidate-statuses.yaml; default aligns with alphaModelCandidateInitialStatus; SESSION⇒conversation_id CHECK matches memory-scopes; ACCOUNT_* rejected in Alpha.
6. **REVOKE side effects** — none. CASCADE is owner-scoped, unaffected; no V1-V10 function reads/writes memory_item/evidence (grep-verified); harness unaffected (34/34). SELECT revocation is necessary (prevents owner-wide SELECT bypassing list_memory's relationship filter).
7. **Evidence chain** — sound. FK prevents orphans; test 34 proves 2/1 evidence rows.
8. **V1–V10 + specs untouched** — confirmed. Only V11 + tests 32-34 + task lifecycle.
9. **writeAllowlist / forbiddenPaths** — adhered. All changed paths in writeAllowlist; no forbidden path.
10. **Test quality** — adequate. 32/33/34 prove both criteria (confirmation-only via INSERT rejection + transitions; cross-user + cross-relationship list + direct-access revoked; lifecycle + evidence + scope). No tautology.

## Independent verification executed
- `bash infra/db/run-rls-tests.sh` → 34/34 PASS (fresh ephemeral PG18+pgvector).
- Custom adversarial probes in a fresh DB: direct UPDATE blocked (insufficient_privilege); get_memory owner-scoped cross-relationship behavior; RELATIONSHIP+foreign-conversation; confirm owner-scoped cross-relationship; ACCOUNT_SHARED rejected — all matched the analysis.
- V1–V10 and all specs/** confirmed untouched.

## Non-blocking findings (no fix batch — owner-scope/logical-scoping & coverage/constraint polish; the owner/tenant security boundary is intact, so no 承载性/安全 weakening)

- **P2** `V11` get_memory/confirm_memory_candidate/reject_memory_candidate/delete_memory are owner-scoped, not
  relationship-scoped: they take (owner, memory_id) and do not carry a relationship_id, so an owner can
  operate on their own memory in relationship 11 from relationship 10's context (no relationship predicate).
  This is SAME-OWNER access to OWN data (no cross-tenant leak), consistent with the owner-based FORCE RLS model
  used across the codebase, and list_memory (the primary browse/read API) is correctly relationship-scoped.
  Recorded as a design choice; if strict relationship-scoped point-ops are later required, add a
  p_relationship_id parameter + `AND relationship_id = p_relationship_id` predicate, or introduce a
  relationship-context GUC with a relationship-scoped RLS policy. Not a blocking defect.
- **P3a** Test 32 proves direct INSERT is blocked but not direct UPDATE (REVOKE blocks UPDATE too — independently
  probed insufficient_privilege). Adding an explicit `UPDATE memory_item SET status='ACCEPTED'` case would
  strengthen coverage.
- **P3b** A RELATIONSHIP-scope candidate may bind a conversation owned by another relationship of the same owner
  (conversation ownership is only validated for scope='SESSION'). Same-owner referential-integrity nit; fix by
  validating conversation ownership whenever p_conversation_id is provided, or ignoring it for RELATIONSHIP.
- **P3c** The status column has no CHECK on allowed values; safety rests on the function gates + REVOKE (sound
  today). A `CHECK (status IN ('PENDING_CONFIRMATION','ACCEPTED','REJECTED','EXPIRED'))` would structurally
  harden the confirmation-only invariant against a future function bug.

## Conclusion
No P0/P1. The confirmation-only canonical path is enforced (function gate + privilege revocation of both
INSERT and UPDATE), and cross-user / cross-relationship-list / missing-context all fail closed. The P2 is an
owner-scoped (own-data) point-op behavior consistent with the owner-based ownership model, not a security
weakening; the P3s are coverage/constraint polish. Both acceptance criteria are satisfied.

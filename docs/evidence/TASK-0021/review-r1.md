# TASK-0021 Independent Review R1

## Candidate

- Commit (final): `3c88e36158ae2411c6fc83c2c70858fc46235e70`
- Tree: `6cc4d729dc1238581b24bb7fb058d46911d0b9da`
- Base: `f09a59661711b5ca7957e397128ce7ca364d5771`
- Implementation candidate reviewed by R1: `9581946`; fix batch `3c88e36` (amended to also fold R2 P2-NEW-1).

## Verdict: PASS (after one fix batch + R2 finding-closure)

R1 on `9581946` found 2 P1 blocking findings + several P2. One fix batch closed the
P1s and the load-bearing P2s. R2 finding-closure PASS, no new P0/P1; R2's
non-blocking P2-NEW-1 (read_generation_snapshot ordering) was folded into the same
fix batch. INV-RT-001, INV-TENANT-001, INV-TX-001, INV-GEN-003 verified clean.

## Scope

R1: COMPLETE_MATRIX, ACCEPTANCE, INVARIANTS, ADJACENT_RISK for the C4
database-migration protected change (`**/db/migration/**` V8 + FORCE-RLS tables +
SECURITY DEFINER functions). R2: FINDING_CLOSURE + DELTA + NEW_P0_P1 only.

## Blocking findings (R1, closed)

### [P1-1 / CORRECTNESS] consume_realtime_ticket TOCTOU double-consume — closed

`consume_realtime_ticket` did `SELECT ... INTO` then a separate unconditional
`UPDATE ... SET consumed_at = now()` with no row lock. Under READ COMMITTED two
concurrent consume transactions could both see consumed_at IS NULL, pass every
check, and both UPDATE+COMMIT — silently violating `singleUse: true`. Test 19
missed it (both consumes ran in one transaction).

**Fix (3c88e36)**: `SELECT ... FOR UPDATE` on the ticket row. Under READ COMMITTED
the second consume blocks on the row lock, then re-reads the latest committed
version (consumed_at now set) and raises `ticket already consumed`. Exactly one
consume wins; single-use holds. Single PK row lock, no deadlock risk. R2 confirmed.

### [P1-2 / CORRECTNESS] finalize chat.completed (event_seq=0) snapshot ordering inversion — closed

V8 added `event_seq bigint NOT NULL DEFAULT 0`. V7's `finalize_generation`
(forbidden to modify) INSERTs chat.completed without setting event_seq, so it
defaults to 0. `append_realtime_event` allocates from next_seq starting at 1. For a
generation that appended durable events (chat.accepted, safety.notice, ...) before
finalize, `ORDER BY e.event_seq` placed chat.completed (seq 0) FIRST — before the
events it actually followed — violating the snapshot temporal order and the
contract rule that chat.completed exists only after final message + final safety
review commit. Test 23 missed it (no append before finalize).

**Fix (3c88e36)**: snapshot `ORDER BY e.committed_at, e.event_seq`. chat.completed
(finalize transaction, later committed_at) now sorts AFTER previously-appended
durable events (earlier transactions). Test 23 rewritten to append chat.accepted
and finalize in SEPARATE transactions (as in the real runtime, so committed_at
differs) and assert chat.accepted first / chat.completed last. R2 confirmed the
RESUMED branch correctly keeps `ORDER BY e.event_seq` (single-epoch append events
are monotonic; chat.completed never appears in a non-terminal generation).

### Non-blocking fixes folded into the same batch

- **P2-1**: `expire_realtime_window` read-then-write race could move
  retained_after_seq backwards under concurrency. Fixed with a single atomic
  `UPDATE ... SET retained_after_seq = GREATEST(retained_after_seq, p_up_to_seq)
  RETURNING` so the boundary only ever advances. Unused `v_stream` decl removed.
- **P2-4**: `append_realtime_event` did not reject a terminal generation (defense
  in depth). Added a status check raising on the 6 terminal states. Test 23 asserts
  append-to-COMPLETED fails.
- **P2-NEW-1 (R2)**: `read_generation_snapshot` still ordered by event_seq
  (the replace_all missed it on indentation). Folded the same `committed_at,
  event_seq` ordering for endpoint consistency. Full SQL suite re-run 25/25.

## Non-blocking notes (accepted, left)

- **P2-2**: finalize's chat.completed gets `stream_epoch=1` (V8 DEFAULT) regardless
  of the generation's authoritative epoch; if a generation is reset then finalized
  the envelope misreports streamEpoch. Edge case (normal Alpha flow does not reset
  before finalize); resume TERMINAL_SNAPSHOT ignores epoch and returns all events.
  Accepted as a known risk; a future finalize-via-append path would fix it.
- **P2-3**: `append_realtime_event` reads next_seq then INSERT+UPDATE; concurrent
  appends collide on the `realtime_event_seq_uniq` unique index (one raises
  unique_violation, forcing app retry). Safe for one-stream-per-generation Alpha;
  atomic `UPDATE ... RETURNING next_seq-1` would remove the retry. Accepted.
- **P2-5**: "client advances only last contiguous sequence" is a client
  responsibility; DB-level coverage now includes the ordering regression (test 23)
  and the monotonic cursor (test 20). A mixed durable/non-durable seq gap test is
  out of scope for this persistence task (non-durable deltas are runtime-only).
- **P3-1**: ticket hash compare is non-constant-time; negligible for a 45s TTL
  SHA-256. **P3-2**: reset_stream_epoch does not reject a terminal generation
  (app-layer concern). Both accepted.

## Cardinal invariants — verified clean

- **INV-RT-001**: event_seq is unique per (owner, generation, epoch)
  (`realtime_event_seq_uniq`); resume returns events ordered; GAP_EXPIRED
  (`after_seq < retained_after_seq`) is sound with no off-by-one (boundary
  inclusive, test 21); missing deltas are never fabricated (GAP returns no events).
- **INV-TENANT-001**: both new owned tables (realtime_stream, realtime_ticket)
  carry ENABLE+FORCE RLS + owner_isolation granted to all 4 runtime roles, matching
  V2/V7; no BYPASSRLS; composite FK (owner_user_id, generation_id) → generation
  makes cross-owner reference structurally impossible; cross-owner resume/consume
  fail closed (tests 24, 25).
- **INV-TX-001 / INV-GEN-003**: chat.completed stays PENDING in the DB; under MVCC
  resume/snapshot cannot see it or a COMPLETED status before the finalize
  transaction commits; TERMINAL_SNAPSHOT is reachable only for genuinely terminal
  generations; provider EOS never completes (finalize requires FINAL_REVIEW, test 18).
- All 9 SECURITY DEFINER functions revoke PUBLIC EXECUTE and grant only vc_api;
  vc_worker denied (test 19 mirrors test 18). All use `SET search_path = vc, public`
  and out_-prefixed RETURNS TABLE columns (no shadowing, TASK-0017 lesson applied).
- Ticket: hash-only (sha256(secret), plaintext never stored, test 19); TTL exactly
  45s; boundTo seven-tuple fully validated; every mismatch fails closed.

## Governance & scope — verified clean

- `**/db/migration/**` is C4 requiring database-migration skill + humanApproval +
  independent review. Card carries requiredSkill `database-migration 1.0.0`, a
  `database-migration` humanApproval by repository-owner, and
  `independentReview: required` (this review).
- 16 candidate files (V8 + 7 SQL tests + 6 Java main + 2 Java test) all within
  writeAllowlist; forbiddenPaths untouched (V1-V7 migrations, existing persistence
  Java, specs, scripts, skills, other service modules all empty diff).
- Reusing `vc.finalize_row_id_seq` for the new tables' composite (owner, id) PKs is
  safe (globally unique bigint, no cross-table collision); V8 ALTER of
  realtime_event with NOT NULL DEFAULTs does not break V7 finalize or tests 16-18.

## Coverage notes

R1 ran on the candidate tree; the implementer ran the full Docker pgvector suite
(25/25 PASS, V1-V8 clean migrate) and Maven Temurin-25 persistence build
(BUILD SUCCESS, 39/0) and the full harness suite (233 OK, 1 skipped) and canonical
precheck (doctor 296825 PASS). R2 re-ran the SQL suite (25/25) on the fix batch.

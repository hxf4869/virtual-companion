# TASK-0087 Independent Review R1

## Candidate

- Commit: `6f6b2dab7d02a98fd1c657a98882da34772b2937`
- Tree: `59ef0118a29bb8dcb9e5568a456da59706fb9b39`
- Base: `c2356197e227f69495a26eb6f90b2ffda6c8a456`

## Verdict: PASS

## Scope

R1: COMPLETE_MATRIX, ACCEPTANCE, INVARIANTS, ADJACENT_RISK for the harness
fixture-coupling fix. C4 harness-change. Only `scripts/harness/tests/test_harness.py`
changed in the candidate (scope compliance confirmed).

## Changes reviewed

1. `test_planning_terminal_card_is_atomic_and_does_not_consume_task_ledger`:
   replaced hardcoded `pop("TASK-0013"/"0014")` with a loop that drops any
   ledger entry whose fixture/resolution-restored card state differs from the
   ledger entry's state.
2. `BacklogTests.load_inputs`: when `lastAcceptedTask`'s restored card is not
   ACCEPTED, walk the live `task-ledger.yaml` backwards to the most recent task
   that is ACCEPTED in the fixture set; repoint lastAccepted (and lastTerminal
   if it still dangles).

## Verified

- **No fail-closed weakening.** The drop loop only fires when
  `restored.state != ledger_state`; every agreeing entry (all ACCEPTED
  non-backlog 008x tasks) is still passed to `validate_task_ledger_entries` and
  fully checked (fields, contractVersion, paths, state-terminal, card-match).
  Entries with no matching card (`restored` None) are kept, not dropped.
- **Correct partition.** TASK-0013 (test-set SUPERSEDED vs ledger REJECTED),
  TASK-0014 (PLANNED vs REJECTED), TASK-0015 (PLANNED vs ACCEPTED) are dropped;
  TASK-0080..0085 (ACCEPTED == ACCEPTED) are retained and validated.
- **load_inputs fallback.** The walk only triggers when lastAccepted is not
  fixture-ACCEPTED (i.e. only after TASK-0015); the historical case (lastAccepted
  already ACCEPTED, e.g. TASK-0085) is unchanged. It cannot pick a planning-only
  restored card. Resolves to TASK-0085, consistent with
  `_latest_task_by_terminal_history`, so `validate_project_state` passes.
- **Other load_inputs callers unaffected** — the new branch only fires in the
  new condition; the 50+ other callers see no behavior change.

## Non-blocking

- P2: the ledger-walk fallback uses ledger insertion order while
  `validate_project_state` cross-checks git commit ancestry; they agree today
  (TASK-0085 both) and this is the same class of pre-existing coupling, not new.
- P3: if the walk ever found zero fixture-ACCEPTED tasks (impossible while 008x
  exist), `latest_accepted` would keep its dangling value — worth a comment.

## Coverage

Suite not executed by the reviewer; conclusions from source, live
`.harness/*.yaml`, git history and commit lineage. The implementer ran the full
suite on the candidate: 233 tests, 1 skipped, 0 failures.

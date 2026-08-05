# TASK-0078 Independent Review R1

## Candidate

- Commit: `22615ba956dfdc0dea0f2b00c2a3f872a174ca0d`
- Tree: `81e764aa43faf6d4a4600c9151d28a397e98492a`
- Base: `bf1dc0d7ec0ce29a07ab91303bb6bbbabab779bd`

## Verdict: PASS

## Scope

Reviewed the complete candidate diff against:
- Acceptance criteria from TASK-0078 card
- Harness invariants INV-HARNESS-001 through INV-HARNESS-009
- Fail-closed semantics: fixtures must not weaken Doctor validation
- Coupling: live task lifecycle must not break mechanical backlog tests

## Changes Reviewed

### test_harness.py — Fixture isolation (+143/-29)

1. **`TASK_0013_PLANNED_SNAPSHOT_COMMIT`**: Pins the PLANNED six-field
   snapshot of TASK-0013 at the TASK-0059 ACCEPTED tree
   (`1d245f1...`). Live TASK-0013 may be REJECTED/IN_PROGRESS/etc.;
   mechanical tests always restore the PLANNED projection.

2. **`load_inputs` isolation**:
   - Strips live active/DRAFT tasks other than the restored TASK-0013
     fixture so `repositoryIdle` is True for projection tests.
   - Pins `project-state` terminal pointers to TASK-0059 and sets
     `nextAction` to identify TASK-0013 as next promotable.
   - Restores TASK-0013 metadata from the snapshot commit via
     `git_object` + `task_metadata_from_text`.

3. **Planning-terminal ledger check**: Pops residual TASK-0013 execution
   ledger entry before asserting that planning-only SUPERSEDED does not
   consume the task ledger.

4. **`test_full_history_scans_introduction_and_preterminal_corrupt_restore`**:
   Rewritten as a synthetic single-card fixture (TASK-9002). Live
   planning-card byte fixtures broke whenever the DAG advanced
   TASK-0056..0059 cards out of PLANNED. Synthetic fixture preserves the
   original assertion target (heading/six-section corruption detection)
   without coupling to live cards. Repair-authorization probes against
   out-of-fixture paths raise `HarnessError` and remain unauthorized
   (correct because fixture retains no planning repairs).

## Findings

- **P0**: None
- **P1**: None
- **P2**: None
- **P3**: Snapshot commit is a magic constant. Acceptable: it is the
  last known clean PLANNED tree for TASK-0013 and is documented inline.
  Future promotions of other "canonical PLANNED sample" tasks would need
  the same pattern; out of scope for this card.

## Acceptance Criteria Check

1. ✅ All governed Python harness tests PASS (232 OK, 1 pre-existing skip)
2. ✅ Doctor PASS (195971 checks)
3. ✅ Subsequent product-task promotions will not break fixtures that
   previously hard-coded live TASK-0013 PLANNED state
4. ✅ No tests deleted, no skips added, no exit codes swallowed
5. ✅ No forbidden paths modified; only `test_harness.py` + task artifacts

## Backwards Compatibility

Fixture isolation is test-only. Production Doctor validation paths are
unchanged. Synthetic history fixture is stronger isolation than the
previous live-card approach and preserves the same fail-closed assertion.

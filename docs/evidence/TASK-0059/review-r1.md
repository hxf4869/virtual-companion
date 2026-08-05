# TASK-0059 Independent Review R1

## Candidate

- Commit: `d5f9effb713e0c9ab2cf3a0573f986a4b279134e`
- Tree: `bd944bb121e32968ab00f45885fd05c071412496`
- Base: `4541f618f45afcf0680717334b7b5c2e3b2a7acc`

## Verdict: PASS

## Scope

Reviewed the complete candidate diff (base → HEAD) against:
- Acceptance criteria from TASK-0059 card and backlog entry
- Harness invariants INV-HARNESS-001 through INV-HARNESS-009
- Receipt fail-closed semantics: no cross-SHA reuse, no non-PASS reuse
- Input completeness: manifest binds HEAD, index, index flags, fsmonitor flags

## Changes Reviewed

### doctor.py — Content-addressed receipt system (+40 lines)

Replaced the simple `vc-doctor-cache.json` (HEAD + index SHA-256 only) with
a structured receipt system:

1. **`compute_doctor_receipt_manifest(pre_closure)`**: Computes a complete
   input identity dict with five fields:
   - `head`: full HEAD commit SHA
   - `indexSha256`: SHA-256 of `git ls-files --stage -z` output
   - `indexFlagsSha256`: SHA-256 of `git ls-files -v -z` output
   - `fsmonitorFlagsSha256`: SHA-256 of `git ls-files -f -z` output
   - `preClosure`: "true" or "false" (separates pre-closure from real HEAD)
   
   Returns `None` when any git command fails, ensuring fail-closed.

2. **`compute_receipt_hash(manifest)`**: Canonical JSON SHA-256 of the
   manifest (sorted keys, minimal separators). Deterministic and
   order-independent.

3. **Receipt read**: Validates `receiptHash`, `manifest` byte-equality,
   AND `status == "PASS"` before returning a cache hit. Any mismatch
   fails-closed to full validation.

4. **Receipt write**: Only writes after PASS. Stores the full manifest,
   receipt hash, status, exit code, and check count.

5. **`import tempfile`** moved to module-level (was local import in the
   old cache code).

### test_harness.py — Four receipt system tests (+70 lines)

1. `test_doctor_receipt_manifest_binds_complete_input_identity`: Verifies
   manifest includes all five required fields.

2. `test_doctor_receipt_separates_pre_closure_from_real_head`: Verifies
   pre-closure and normal runs produce different receipt hashes (no
   cross-context reuse).

3. `test_doctor_receipt_fails_closed_when_head_missing`: Verifies manifest
   returns None when HEAD cannot be resolved (fail-closed).

4. `test_doctor_receipt_hash_is_deterministic`: Verifies hash is the same
   regardless of dict insertion order.

Also updated backlog projection expectations for TASK-0059 IN_PROGRESS and
removed TASK-0059 card from frozen byte comparisons in task0066/task0067.

## Findings

- **P0**: None
- **P1**: None
- **P2**: None
- **P3**: None

## Acceptance Criteria Check

1. ✅ **receipt 严格绑定完整 manifest，未知输入失败关闭**: Manifest includes
   HEAD + index + index flags + fsmonitor flags + pre-closure flag. Missing
   any input returns None → no cache hit → full validation. Test
   `test_doctor_receipt_fails_closed_when_head_missing` constrains this.
2. ✅ **Evidence 可审计且 exact-SHA CI 对当前实现真实运行**: Receipt includes
   the full manifest, receipt hash, status, and check count — all auditable.
   The CI (TASK-0058) runs the full test suite on Ubuntu (reference platform).
   Receipt hit verified on second Doctor run (hash `8570348ce180`).
3. ✅ No cross-SHA reuse: manifest binds HEAD, so different commits produce
   different receipts.
4. ✅ No non-PASS reuse: receipt write only happens after PASS; read validates
   `status == "PASS"`.
5. ✅ Pre-closure separation: pre-closure flag in manifest produces different
   receipt hash.

## Backwards Compatibility

The receipt system is a strict superset of the old cache: it includes all
the old inputs (HEAD, index) plus additional inputs (index flags, fsmonitor
flags, pre-closure). A receipt from the old format cannot be reused because
the new format validates manifest dict equality, not just a fingerprint string.

# TASK-0110 Independent Review R1

```yaml
taskId: TASK-0110
reviewerId: task0110_r1
reviewer: "Codex independent reviewer R1 (/root/check_audit_report)"
reviewedCommit: b0c2d10f208be3ec86eea095af7633df95c5a4fb
candidateTree: 4d0cfddf76f1a4e05a25924151841aa96a336178
baseCommit: 717582ec8f0bba5c81ebdc8cb2b535974ce281f0
riskClass: C3
verdict: FAIL
reviewerRunsExpensiveFullTests: false
canonicalPrecheckRunByReviewer: false
rootMavenVerifyRunByReviewer: false
```

## Blocking Finding

### P1-01: Single-line exact payload is charged for SSE framing

`SseDecoder` counted the complete physical line against
`MAX_STREAM_EVENT_BYTES`. A `data: ` line whose semantic payload was exactly
1 MiB therefore crossed the limit while reading the fixed prefix, even though
the composed payload budget intentionally excludes the field name, optional
space, CR/LF, comments, and blank separator.

The existing exact test split the payload over two lines, so it did not expose
the single-line incompatibility. The existing one-over test likewise stopped
at the raw physical-line boundary rather than proving the first payload byte
above 1 MiB caused termination.

Required correction: preserve the bounded physical-line parser, but do not
charge fixed `data: ` framing to the composed payload. Add a single-line exact
1 MiB success test and a payload one-over test bound to the real offending raw
offset.

## Non-blocking Findings

- The targeted log hash was correct and the run was `BUILD SUCCESS`, but its
  summary contained 188 tests across the reported modules, not 174.
- During review, the reviewer accidentally ran
  `git diff --check 717582e..b0c2d10` once with exit 0. This was not the frozen
  no-argument formal gate and is not recorded as that gate's PASS. The process
  fact is retained in Evidence; the formal command remained reserved until a
  Reviewer PASS.

## Acceptance Matrix

1. Existing six constants and the new 8 MiB raw-body constant: PASS.
2. Non-stream exact/one-over bounded reading, close, and terminal behavior: PASS.
3. SSE line/event early-stop: FAIL for exact single-line payload semantics.
4. Invoker cancel on fence/cumulative-output violations: PASS.
5. Complete gate sequence: blocked pending the one allowed fix batch and R2.

No canonical precheck or root Maven verify was run by the reviewer.


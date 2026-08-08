# TASK-0109 Independent Review R1

```yaml
taskId: TASK-0109
reviewerId: task0109_r1
reviewer: "Codex independent reviewer R1 (/root/check_audit_report)"
reviewedCommit: cdddc1b3e7272f1c364b0279e2da59d31c86e167
candidateTree: 75753c35837e497e56709ae747961a391fef9017
baseCommit: 7b3c11415488988ddab20e3b30624e5d686dd2f8
riskClass: C3
verdict: FAIL
reviewerRunsExpensiveFullTests: false
canonicalPrecheckRunByReviewer: false
rootMavenVerifyRunByReviewer: false
```

## Blocking Findings

### P1-01: Response byte limits are enforced only after unbounded buffering

The candidate does not bound provider bytes before materialization:

- `SseDecoder.decode` uses `BufferedReader.readLine()` and accumulates every
  `data:` line in an `ArrayList`, then performs `String.join` before invoking
  `OpenAiChatCompletionsSession.onSseData`. The 1 MiB check at Session lines
  297-301 therefore runs only after an arbitrarily large SSE line/event has
  already been allocated. Large comment lines are also read without a bound.
- The non-stream path calls `jsonMapper.readTree(body)` in
  `OpenAiChatCompletionsCodec.decodeCompletion` before Session lines 271-275
  inspect `completion.content()`. An arbitrarily large JSON body or unrelated
  field can therefore be parsed into a full tree before the 1 MiB content
  check.

This defeats the stated heap/resource protection against a malicious provider
and does not fail closed before resource exhaustion. The new tests at
`OpenAiChatCompletionsBoundaryContractTest` lines 125-183 prove eventual
rejection of finite approximately-1-MiB payloads, but do not prove bounded
reading or early cancellation. `SseDecoder.java` is unchanged and is not in the
task writeAllowlist, so complete repair may require an authorized scope
amendment rather than an out-of-scope edit.

Required correction: enforce byte limits while reading/framing SSE and while
reading the non-stream body, abort the body/session as soon as the bound is
crossed, and test with a counting/throwing stream that proves consumption stops
at the configured bound.

### P1-02: The one-shot `git diff --check` gate was dispatched multiple times

The main agent reported that, before candidate freeze, it executed the literal
`git diff --check` more than once and also executed one
`git diff --cached --check`. This review records that process fact as reported;
it does not rewrite it as a single execution.

`.harness/task-delivery-policy.yaml` line 153 fixes `diffCheckCount: 1`, and the
task card lines 327-332 explicitly says the command is run only once. Multiple
dispatches are therefore an acceptance/governance violation even though they
did not alter the candidate tree. This is blocking under the R1
`ACCEPTANCE_VIOLATION` rule and cannot be cured by claiming one of the repeated
runs as the sole official result.

## Non-blocking Findings And Residual Risk

### P2-01: Invoker fallback does not explicitly cancel a generic session

`LiveModelInvoker` lines 196-200 returns the size-failure outcome directly.
Try-with-resources calls `close()`, and the current OpenAI session implements
`close()` as `cancel()`, but `ModelProtocolSession` defines `cancel()` and
`close()` separately and does not guarantee equivalence. A future/direct
adapter can continue provider work after quota is released and the attempt is
audited failed. The fallback test verifies response/quota/audit, but its
`ScriptedSession` has empty `cancel()` and `close()` and does not assert active
cancellation.

### P2-02: Byte caps do not bound streaming event-object count

`OpenAiChatCompletionsSession` uses an unbounded `LinkedBlockingQueue`. A fast
provider can emit up to roughly one million one-byte deltas within the 1 MiB
payload budget, creating far more than 1 MiB of queued object overhead for a
slow or absent direct adapter consumer. This is adjacent to, but not one of,
the Owner-approved numeric limits.

### P3-01: Other request strings remain outside the approved size matrix

`ResponseMode.StructuredJson.schemaName` remains unbounded and is copied into
the OpenAI JSON body. The enumerated message-count/content/jsonSchema checks do
protect direct `adapter.open(ModelProtocolRequest)` calls, and generic error and
audit paths do not expose request/response content, but the adapter does not
have a total encoded-request-body bound.

## Acceptance Matrix

1. **PASS (static):** constants are exactly 64, 64 KiB, 16 KiB, 1 MiB,
   1 MiB, and 8192.
2. **PASS (static):** domain constructors use UTF-8 byte counts and inclusive
   `actual > maximum` rejection; tests cover exact 64 KiB/64 messages and
   one-over cases plus schema over-limit.
3. **PASS (static):** codec writes `max_tokens=8192`; ModelProtocolRequest and
   codec both reject oversized schema, and direct adapter construction cannot
   bypass the enumerated domain limits.
4. **FAIL:** eventual MalformedResponse behavior is present, but SSE and full
   non-stream bodies are unbounded before the checks (P1-01).
5. **PASS with P2 residual:** Invoker discards partial output, returns
   MalformedResponse, releases ALL_FAILURE quota, and emits
   NON_RETRYABLE_FAILED audit; explicit generic-session cancellation is absent.
6. **FAIL:** R1 has blocking findings and the one-shot diff gate was duplicated.
   Canonical precheck and root JDK-25 Maven verify were not run before review,
   as required by the delivery sequence.
7. **NOT INDEPENDENTLY VERIFIED:** reviewer did not run Maven tests; local Java
   is 21 while the project compiler release is 25.

## Governance And Scope Checks

- Candidate commit and tree exactly match the frozen identities above.
- The chain from Base through DRAFT, READY authorization/binding, IN_PROGRESS,
  and candidate is linear and single-parent.
- All 51 Context Lock blobs match Base; the no-trailing-final-LF fingerprint is
  `17e6c47e55eeff5c3875f5425ee30305609aecfc4d82b5c02db451eb4201cae8`.
- All Base-to-candidate paths are in `writeAllowlist`; no forbidden path was
  changed. The candidate implementation commit changes only authorized source
  and test files.
- `model-routing-change` 1.0.0 and `task-delivery-flow` 1.3.7 match the registry
  and task pins; C3 independent review is required.
- Worktree was clean before this permitted review artifact was created.

## Reviewer Checks

- Read required task, Skills, policy, Context Lock, implementation, adjacent
  adapter/session/decoder paths, and changed tests.
- Verified commit/tree, parent chain, per-edge changed paths, complete
  Base-to-candidate path set, project active task, and Context blob hashes.
- Did not run canonical precheck, root Maven verify, or expensive full tests.
- Did not run `git diff --check`, because the main agent had already disclosed
  repeated execution and another dispatch would further violate the frozen
  one-shot gate.

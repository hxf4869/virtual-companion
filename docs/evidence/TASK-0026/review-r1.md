# R1 Review — TASK-0026 (H5 离线聊天、流式显示与恢复)

- **Reviewed commit**: `21eab7e86aee73bc96674c6ca87deaf8cdd7fe62` (candidate)
- **Candidate tree**: `7de9290e56924da27273f9b73f1c228006bfe073`
- **Reviewer**: `task0026_r1` (independent-review-gate, general-purpose agent, single adversarial pass)
- **Budget**: 15 min (elapsed ~406s, hard limit not reached)
- **Verdict**: **PASS** — no P0/P1. Both acceptance criteria satisfied.

## Acceptance criteria

**离线成功、断线、Gap、Reset、取消和失败场景可自动复测: SATISFIED.** All six scenarios are proven
green via mocked transport across the three spec files: offline-success (reducer + realtime + store),
disconnect (realtime asserts afterSeq=[0,1] so progress is preserved, not replayed), gap (reducer drop +
in-band + GAP_EXPIRED + store draft-prefix), reset (epoch mismatch + RESET_REQUIRED re-sync), cancel
(handle flipped + store), failure (NOT_FOUND_OR_FORBIDDEN + transport-throws→exhausted).

**客户端不伪造缺失 delta: SATISFIED.** Every applyEvent path audited: cursor advances only on the
contiguous branch (eventSeq===cursor+1) and only by +1; the gap branch spreads `...prev` with NO event
added and cursor frozen; epoch mismatch clears the whole draft; duplicates/stale ignored (inclusive `<=`);
the snapshot is server-authoritative. The never-fabricate property is asserted across all three spec files.

## Invariant audit — INV-RT-001 client side
Every `applyEvent` path in stream-reducer.ts traced. The cursor is only ever advanced by the contiguous
branch and exactly +1; it can never skip an unapplied sequence. Missing events are never stored (the gap
branch spreads prev without adding). Epoch mismatch clears events and cursor. Helpers (markGap/resetStream/
cancelStream/beginStreaming) invent nothing; applyTerminalSnapshot populates only from the server snapshot.
Invariant is sound.

## Realtime orchestration audit — realtime.ts
- RESUMED-batch-ends-non-terminal → `continue` resumes from `state.cursor` (disconnect preserves progress).
- In-band gap → snapshot → applyTerminalSnapshot → terminal.
- GAP_EXPIRED → markGap → snapshot → terminal.
- RESET_REQUIRED → resetStream + new epoch from result.nextEpoch + beginStreaming (cursor 0).
- NOT_FOUND_OR_FORBIDDEN → terminal, nothing disclosed.
- Transport throw → exhausted (non-terminal), no fabricated success.
- MAX_RESUME_ATTEMPTS bounds all continue paths (test verifies exact count).

## Contract / h5Security conformance
5 dispositions consistent; cursor=eventSeq; epoch=streamEpoch; last-contiguous; gap→snapshot; epoch
mismatch→reset; never fabricate; chat.completed terminal. No localStorage, no WebSocket, no media, no
long-lived token in the realtime query string (URL carries only generationId/afterSeq/streamEpoch).

## writeAllowlist / forbiddenPaths
Every changed path in `git diff --name-only d2bcfa45 21eab7e8` maps to a frozen writeAllowlist entry. No
forbidden path touched (specs/**, service/**, infra/**, scripts/**, skills/**, baseline frontend files,
configs, package.json, dist, node_modules all unchanged). pages.json diff is purely additive.

## Independent verification executed
- `cd frontend && npx vitest run` → 53 passed (6 files)
- `cd frontend && npx vue-tsc --noEmit` → exit 0, no output
- writeAllowlist cross-checked against all changed paths; no forbidden path touched

## Non-blocking findings (no fix batch — transport interop/polish in the untested .vue glue; does not affect the tested invariant, does not crash or disclose existence)

- **P2-1** `frontend/src/pages/chat/chat.vue` createBrowserRealtimeDeps().resume() calls GET /api/v1/realtime/resume
  directly without issuing the contract's single-use ticket (POST /api/v1/realtime/tickets, boundTo seven-tuple,
  ttlSeconds 45). The tested orchestration (realtime.ts) correctly abstracts this via injected deps so mocked
  tests pass, but the production transport is not contract-conformant. Failure: against a contract-enforcing
  backend the resume is rejected (no ticket) and the stream never opens. Zero current-alpha impact (backend does
  not yet enforce); production interop gap. The exact client-side ticket presentation (query param vs header) is
  underspecified in the contract, so implementation is deferred to the backend-integration task rather than
  guessed here. Recommended fix: issue POST /api/v1/realtime/tickets with the boundTo body, present the returned
  single-use ticket on the resume, and apply a 45s local timeout.
- **P2-2** readSseEvents extracts only `disposition` and `events`; `nextEpoch` from a RESET_REQUIRED frame is
  dropped, so the client falls back to `epoch + 1` (realtime.ts) and may loop to exhaustion if the server bumped
  the epoch by more than one. Not caught by tests because depsWith() sets nextEpoch explicitly in the mock.
  Failure: server RESET_REQUIRED with nextEpoch=5 → client resumes at epoch=2 → rejected → repeats to exhausted.
  Recommended fix: extract payload.nextEpoch (Number.isFinite guard) in readSseEvents and return it.
- **P3-1** `chat.vue` constructs a local `handle = createStreamHandle()` that is never used (the store holds its
  own handle). Dead code; remove it.
- **P3-2** `stores/chat.ts` reset() clears the handle reference without flipping cancelled; a stray streamGeneration
  could still resolve and overwrite state. The onUnmounted sequence (cancel then reset) is safe; only the
  standalone reset() is unsafe. Recommended fix: flip the existing handle before clearing.
- **P3-3** `chat.spec.ts` cancel test asserts `["completed","cancelled"]` (race acknowledged in a comment); the
  realtime-level cancel test proves pre-emption strongly.
- **P3-4** In-band epoch mismatch discards the mismatched event's streamEpoch; the orchestrator guesses epoch+1.
  Only the unusual in-band mismatch path; normal resets carry explicit nextEpoch via RESET_REQUIRED.
- **P3-5** Cancel flipped during a batch/safeSnapshot await is only checked at the next attempt boundary; if the
  loop reaches terminal first the stream returns completed despite cancel. Latency only, not safety.

## Conclusion
No P0/P1. The never-fabricate invariant is sound and the six acceptance scenarios are auto-tested green. The
P2 findings are real but confined to the untested .vue transport (production interop, no crash/existence
disclosure, backend not yet enforcing) and are documented for the backend-integration task; per the review
policy they do not warrant a fix batch for this C4 frontend card. Both acceptance criteria are satisfied.

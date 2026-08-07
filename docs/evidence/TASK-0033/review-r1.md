# TASK-0033 R1 Independent Review

```yaml
taskId: TASK-0033
reviewRole: R1 independentReview (model-routing-change C3, not involved in implementation)
candidateCommitShort: 0987f8b
candidateCommit: 0987f8b0372802cda2a59fba862361cf222ab64f
candidateTree: c2669d533eac0b6e9e0d8fe0c630754c3cba89da
baseCommit: cf29d26e9943dc80da2c35401e43c14f3945c827
verdict: PASS
budgetElapsedSecondsEstimate: 720
reviewDate: "2026-08-07"
```

## Summary

Candidate implements the Anthropic Messages offline adapter (`service/adapters/model-anthropic`) and its 14-test contract suite (`service/tests/anthropic-messages-contract-tests`) by faithfully mirroring the TASK-0011 OpenAI adapter's single-request Session/Codec/three-phase-timeout/single-terminal/late-token-fence/desensitization pattern and replacing only the protocol shape with Anthropic Messages semantics. All 12 acceptance criteria pass, all 14 requiredContractTests have direct test coverage, all invariants hold, and no forbidden paths were modified. No P0 or P1 findings. Three P3 observations (non-blocking).

---

## AC Matrix

### AC1 — Module boundaries (PASS)

- Root `pom.xml` registers exactly two new modules: `service/adapters/model-anthropic` and `service/tests/anthropic-messages-contract-tests` (`pom.xml` diff +2 lines).
- Dependency direction: tests pom depends on `virtual-companion-model-anthropic` (`anthropic-messages-contract-tests/pom.xml:18-22`); adapter pom depends on `virtual-companion-modelruntime` + `jackson-databind` only (`model-anthropic/pom.xml:17-27`). No reverse dependency.
- Runtime exclusion verified: `service/apps/runtime/pom.xml` has zero diff (`git diff cf29d26..0987f8b -- service/apps/runtime/pom.xml` empty) and is asserted by `AnthropicMessagesBoundaryContractTest.adapter_has_no_default_real_endpoint_environment_or_runtime_wiring` (`BoundaryContractTest.java:312-315`).

### AC2 — ExternalAttemptBinding only; zero network for invalid (PASS)

- Adapter rejects non-`ExternalAttemptBinding` before any HTTP call: `AnthropicMessagesAdapter.open()` returns `ImmediateTerminalSession.failed(..., UnsupportedBinding)` (`Adapter.java:77-82`).
- `DeterministicSourceBinding` test: `BoundaryContractTest.deterministic_binding_and_invalid_schema_make_zero_network_calls` uses `NeverCompletingHttpClient` and asserts `client.calls() == 0` (`BoundaryContractTest.java:46-81`).
- Codec encode failure (invalid schema) also returns `ImmediateTerminalSession.failed(..., MalformedResponse)` without network (`Adapter.java:84-92`), verified in same test (`BoundaryContractTest.java:72-80`).

### AC3 — Exactly one sendAsync; no retry/routing/fallback (PASS)

- One `httpClient.sendAsync` per session in `AnthropicMessagesSession.execute()` (`Session.java:131-134`). No retry loop, no fallback path anywhere in the session.
- `CountingHttpClient.asynchronousCalls() == 1` asserted across: non_stream_success (`SuccessContractTest.java:98`), sse_stream_success (`:166`), 429_mapping (`FailureContractTest.java:265`), 5xx_mapping (same), malformed_event (`:122`), trailing tokens (`:219`), non-429-4xx (`:241`), first_token_timeout (`TimeoutCancellationContractTest.java:95`), total_timeout (`:159`), cancellation (`:212`).
- `NeverCompletingHttpClient.calls() == 1` asserted in connect_timeout (`:62`).

### AC4 — Request contract per-field (PASS)

- Method POST: `SuccessContractTest.java:89` asserts `"POST"`.
- Path `/v1/messages`: asserted `:90`. Config validates path (`Config.java:78-82`).
- Content-Type `application/json`: header set at `Adapter.java:97`, asserted `:93`.
- Accept mirrors stream mode: `Adapter.java:98-100` (`text/event-stream` for stream, `application/json` for non-stream), asserted `:94` and `:164`.
- `x-api-key` header: `Adapter.java:95`, asserted `:95`.
- `anthropic-version` header: `Adapter.java:96`, asserted `:96`.
- `model`: codec sets from config (`Codec.java:33`), asserted `:101`.
- `max_tokens`: positive-integer config validated (`Config.java:32-35`), codec sets (`Codec.java:34`), asserted `:102`.
- `stream`: codec sets from request (`Codec.java:56`), asserted `:103` (false) and `:163` (true).
- `system` top-level (not in messages array): SYSTEM messages collected into `root.put("system", ...)` (`Codec.java:40-54`), asserted `:104`.
- `messages` roles only user/assistant: SYSTEM excluded from array, role mapping `Codec.java:166-168`, asserted `:105-113`.
- Authorization snapshots excluded from body: asserted `:115-117` (`!contains(API_KEY)`, `!contains(REQUESTED_AUTH)`, `!contains(EXECUTION_AUTH)`).

### AC5 — 14 requiredContractTests coverage matrix (PASS)

| requiredContractTest | Test class : method |
|---|---|
| non_stream_success | `SuccessContractTest.non_stream_success:45` |
| sse_stream_success | `SuccessContractTest.sse_stream_success:122` (+ `sse_stream_success_with_explicit_event_lines_and_ping:171`) |
| unicode_and_long_text | `SuccessContractTest.unicode_and_long_text:204` |
| usage_mapping | `SuccessContractTest.usage_mapping:243` |
| finish_or_stop_reason_mapping | `SuccessContractTest.finish_or_stop_reason_mapping:267` |
| 429_mapping | `FailureContractTest.http_429_mapping:32` (@DisplayName("429_mapping")) |
| 5xx_mapping | `FailureContractTest.http_5xx_mapping:38` (@DisplayName("5xx_mapping")) |
| connect_timeout | `TimeoutCancellationContractTest.connect_timeout:38` |
| first_token_timeout | `TimeoutCancellationContractTest.first_token_timeout:66` |
| total_timeout | `TimeoutCancellationContractTest.total_timeout:103` |
| malformed_event | `FailureContractTest.malformed_event:45` |
| cancellation | `TimeoutCancellationContractTest.cancellation:168` |
| late_token_fence | `TimeoutCancellationContractTest.late_token_fence:266` |
| structured_output_when_claimed | `SuccessContractTest.structured_output_when_claimed:296` |

Total: 26 `@Test` methods (7 Success + 6 Failure + 7 Boundary + 6 TimeoutCancellation).

### AC6 — Full Binding, contiguous sequence from 0, exactly one terminal, late events dropped (PASS)

- Every event carries the full `ExternalAttemptBinding`; `drain()` asserts `binding()` on every event and contiguous sequence from 0 (`TestSupport.java:174-177`).
- Exactly one terminal: `drain()` asserts `filter(terminal).count() == 1` and last event is terminal (`:172-173`).
- Late events dropped: `drain()` asserts `session.next().isEmpty()` after terminal (`:178-180`); late_token_fence test additionally verifies post-terminal `session.next().isEmpty()` after late socket write (`TimeoutCancellationContractTest.java:313-317`).

### AC7 — SSE EOS gating (PASS)

- `message_stop` handler requires `startSeen && contentSeen && stopReason != null && outputTokens >= 0` before emitting EOS; any missing field throws `AnthropicCodecException` → MalformedResponse (`Session.java:328-334`).
- Missing message_start: `deltaWithoutStart` stream in `FailureContractTest.malformed_event:46-50` → MalformedResponse (`:118`).
- Missing message_stop: `missingMessageStop:52-56` → MalformedResponse.
- Missing stop_reason: `missingStopReason:58-63` → MalformedResponse.
- Missing output_tokens: `missingOutputTokens:65-70` → MalformedResponse.
- Duplicate stop_reason: `duplicateStopReason:72-78` → MalformedResponse.
- Invalid Content-Type for stream: `BoundaryContractTest.streaming_rejects_json_content_type_without_parsing_body:262` → MalformedResponse without body parsing.
- Invalid JSON: `sse("{not-json")` in malformed_event list → MalformedResponse.
- Unknown event type: `unknownEventType:85-91` → MalformedResponse.
- No EOS in any failure case: all malformed scenarios assert `noneMatch(AttemptEos.class::isInstance)` (`:119-120`).

### AC8 — Structured output single validated StructuredJson (PASS)

- Non-stream: `parseCompletion` selects `StructuredJson` payload when `ResponseMode.StructuredJson`, calls `codec.requireStructuredJson(content)` (`Session.java:273-278`).
- Stream: text deltas accumulated in `state.structuredContent` (never emitted as TextDelta); at `message_stop`, `codec.requireStructuredJson(...)` validates and emits single `StructuredJson` (`Session.java:309-313, 341-345`).
- `requireStructuredJson` uses `FAIL_ON_TRAILING_TOKENS` mapper (`Codec.java:25-27, 153-164`).
- Test `structured_output_when_claimed` verifies both non-stream and stream produce exactly 3 events (StructuredJson, Usage, EOS) with no TextChunk payloads (`SuccessContractTest.java:296-360`).
- Trailing-token structured cases fail closed: `FailureContractTest.trailing_json_tokens_fail_closed_without_eos:177-222`.

### AC9 — Three-phase timeout; idempotent cancel/close; late success cannot overwrite (PASS)

- Connect: `awaitResponse` computes `connectDeadline` and selects CONNECT or TOTAL phase by `min(connect, total)` (`Session.java:172-187`). Test: `connect_timeout` with 150ms connect → `TimeoutPhase.CONNECT` (`TimeoutCancellationContractTest.java:38-63`).
- First Token: `awaitFirstContent` uses `firstTokenDeadline` vs `totalDeadlineNanos` (`Session.java:206-242`). Test: `first_token_timeout` with 150ms first-token, keepalive comment (no content) → `FIRST_TOKEN` (`:66-100`).
- Total: `awaitParser` uses `totalDeadlineNanos` (`Session.java:244-259`). Test: `total_timeout` with 300ms total, partial content emitted then timeout → `TOTAL` with partial text preserved (`:103-165`).
- Idempotent cancel/close: `cancellation` test calls `cancel()` twice + `close()` twice, produces exactly one `AttemptCancelled` then empty (`:200-210`).
- Late success does not overwrite: `terminalQueued` guard in `completeSuccessfully`/`terminateFailed`/`emitText` ensures first terminal wins (`Session.java:375-398`).

### AC10 — No logging; desensitized strings (PASS)

- No logging dependency: adapter pom has only modelruntime + jackson-databind (`model-anthropic/pom.xml:17-27`). No slf4j, no java.util.logging.
- Source scan asserts absence of `org.slf4j`, `java.util.logging`, `System.getenv`, `System.getProperty`, `api.anthropic.com` (`BoundaryContractTest.java:306-310`).
- `Config.toString()` redacts apiKey as `<redacted>`, model as `<configured>` (`Config.java:58-67`).
- `Adapter.toString()` shows only protocol + endpoint (`Adapter.java:114-117`).
- `Session.toString()` returns `<redacted>` (`Session.java:125-127`).
- `ImmediateTerminalSession.toString()` returns `<redacted>` (`ImmediateTerminalSession.java:54-56`).
- `AnthropicCodecException` carries generic message only, no stack-cause detail (`AnthropicCodecException.java:7-12`).
- Test `new_type_string_representations_are_secret_and_body_free` asserts no API_KEY, body-sentinel, or auth snapshots in any toString (`BoundaryContractTest.java:199-228`).
- Provider body not in failure toString: `non_429_4xx` and status-mapping tests assert `!failure.toString().contains(providerBody)` (`FailureContractTest.java:242, 263`).

### AC11 — Loopback-only mock; no env/real network; zero-egress assertion (PASS)

- `MockAnthropicServer` binds `InetAddress.getByAddress(new byte[]{127,0,0,1})` on port 0 (`MockAnthropicServer.java:30-32`); `endpoint()` asserts loopback (`:46-48`).
- Captured requests assert `loopback == true` (`SuccessContractTest.java:92`).
- Source scan for `System.getenv`, `System.getProperty`, `api.anthropic.com` all absent (`BoundaryContractTest.java:306-310`).
- No env var read: config requires explicit constructor injection (`Config.java:21-36`); test verifies all constructors require `AnthropicMessagesConfig` (`BoundaryContractTest.java:286-288`).
- `NeverCompletingHttpClient.send` throws AssertionError to guarantee no sync path (`NeverCompletingHttpClient.java:80-81`).

### AC12 — No protected paths modified (PASS)

- Full diff `git diff --stat cf29d26..0987f8b`: 21 files, all within writeAllowlist:
  - `pom.xml` (module registration) ✓
  - `service/adapters/model-anthropic/**` (8 new files) ✓
  - `service/tests/anthropic-messages-contract-tests/**` (9 new files) ✓
  - `docs/tasks/TASK-0033-*.md`, `docs/tasks/context/TASK-0033.context-lock.yaml` ✓
  - `.harness/project-state.yaml` (lifecycle: activeTask + nextAction) ✓
- Zero diff on: `service/modules/modelruntime/**`, `specs/**`, `service/adapters/model-openai/**`, `service/tests/openai-chat-completions-contract-tests/**`, `service/apps/runtime/**`, `ci/**`, `frontend/**`, `deploy/**`, `db/**`, `skills/**`, `.harness/invariants.yaml`, `.harness/protected-paths.yaml`, all other harness policy files.

---

## Invariants

| Invariant | Verdict | Evidence |
|---|---|---|
| INV-GEN-001 | PASS | Adapter emits only `AttemptEos` (not Generation finalize); `ModelProtocolEvent.AttemptEos` javadoc confirms "closes only this session/attempt" (`ModelProtocolEvent.java:7-8`). No generationId minted by adapter. |
| INV-GEN-002 | PASS | All failure paths normalize to `AdapterFailure` sealed interface variants; no provider exception crosses boundary. `AnthropicCodecException` carries no body. |
| INV-GEN-003 | PASS | No state machine outside the single session; one request, one terminal. |
| INV-AUTH-001 | PASS | `ExternalAttemptBinding` requires both auth snapshots (`InvocationBinding.java:28-40`); snapshots carried in event binding only, never in request body/headers. `DeterministicSourceBinding` has no external call. |
| INV-COST-001 | PASS | pom dependencies: modelruntime + jackson-databind only. No paid/SaaS/enterprise/Docker dependency. |
| INV-HARNESS-002 | PASS | Candidate commit `0987f8b` has single parent `2346e34`; 0 merge commits in `cf29d26..0987f8b`. |
| INV-HARNESS-003 | PASS | All 21 changed files are within writeAllowlist; forbiddenPaths untouched. |
| INV-HARNESS-005 | PASS | Evidence (this file) binds exact commit `0987f8b0372802cda2a59fba862361cf222ab64f` and tree `c2669d533eac0b6e9e0d8fe0c630754c3cba89da`. All test references are to actual committed files. |

---

## Anthropic Protocol Correctness

| Semantic | Verdict | Evidence |
|---|---|---|
| `system` top-level field | PASS | `Codec.java:38-54` collects SYSTEM into `root.put("system", ...)`; asserted `SuccessContractTest.java:104` |
| `messages` roles user/assistant only | PASS | `Codec.java:47-49, 166-168`; asserted `:105-113` |
| `max_tokens` required positive int | PASS | `Config.java:32-35`; `Codec.java:34` |
| Non-stream content[0].text + stop_reason + usage | PASS | `Codec.java:80-99` |
| SSE message_start input_tokens in message.usage | PASS | `Codec.java:110-115` |
| SSE content_block_delta delta.type==text_delta→delta.text | PASS | `Codec.java:116-126` |
| SSE message_delta stop_reason + usage.output_tokens | PASS | `Codec.java:127-137` |
| SSE message_stop | PASS | `Codec.java:138-140` |
| ping/content_block_start/content_block_stop ignored | PASS | `Codec.java:141-143` |
| explicit event: lines tolerated | PASS | `SseDecoder.java:58-59`; tested `SuccessContractTest.java:171-201` |
| `:` heartbeat comments ignored | PASS | `SseDecoder.java:46-48`; tested `:176` |
| stop_reason: end_turn/stop_sequence→STOP, max_tokens→LENGTH, tool_use→UNKNOWN, other→fail | PASS | `Codec.java:211-216`; tested `SuccessContractTest.java:267-293` |
| usage total = input+output | PASS | `Codec.java:227` (non-stream), `Session.java:519-524` safeSum (stream) |
| structured: tools + tool_choice{type:tool,name} | PASS | `Codec.java:58-71`; asserted `SuccessContractTest.java:330-338` |
| CRLF tolerated | PASS | `BufferedReader.readLine()` handles CRLF; tested `SuccessContractTest.java:126` (sseCrLf) |
| Multi data: lines joined | PASS | `SseDecoder.java:30,56-57,70`; tested `BoundaryContractTest.java:231-259` |

---

## Fail-Closed / Late Fence

- Terminal arbitration serialized via `stateLock` + `terminalQueued` flag: `emitText` (`Session.java:357-368`), `completeSuccessfully` (`:370-398`), `terminateFailed` (`:400-413`), `terminateCancelled` (`:415-427`) all guard under lock.
- Late bytes after terminal: `abortIo()` interrupts parser + worker threads and closes response body (`:435-455`). Parser callbacks check `terminalQueued` before enqueue.
- Late callback fence test: `late_token_fence` verifies post-EOS late socket write does not produce events (`TimeoutCancellationContractTest.java:266-319`).
- Missing message_start/message_stop/stop_reason/output_tokens/content/duplicate terminal → `AnthropicCodecException` → `MalformedResponse`, no EOS (`Session.java:328-334`, tested `FailureContractTest.malformed_event`).
- Trailing JSON tokens fail closed at parse point: non-stream `readTree` has `FAIL_ON_TRAILING_TOKENS` (`Codec.java:25-27`); structured `requireStructuredJson` uses same mapper (`:153-164`); stream text not parsed mid-stream so trailing tokens only validated at aggregation point (tested `FailureContractTest.trailing_json_tokens_fail_closed_without_eos`).

---

## Findings

### P3-001 — safeSum overflow handling diverges between stream and non-stream paths

- **Severity**: P3 (non-blocking, cosmetic inconsistency)
- **Location**: `AnthropicMessagesSession.java:519-524` (stream path caps at `Long.MAX_VALUE`) vs `AnthropicMessagesCodec.java:224-227` (non-stream path throws `AnthropicCodecException` on overflow)
- **Issue**: Stream `safeSum` silently caps `totalTokens` at `Long.MAX_VALUE` on overflow, while non-stream `requireUsage` throws. Both prevent overflow corruption, but the behavioral asymmetry means a pathological provider payload with `input+output > Long.MAX_VALUE` yields EOS+Usage on stream vs MalformedResponse on non-stream.
- **Suggestion**: Optional alignment — either both cap or both throw. No user impact since token counts never approach `Long.MAX_VALUE` in practice. No fix required for this task.

### P3-002 — StructuredJson validation is syntax-only, not schema-shape validation

- **Severity**: P3 (non-blocking, within spec)
- **Location**: `AnthropicMessagesCodec.java:153-164`
- **Issue**: `requireStructuredJson` validates JSON syntax (including trailing-token rejection) but does not validate the parsed JSON against the declared `jsonSchema` shape (e.g., a JSON array `[]` or scalar `"hello"` would pass syntax validation). The task spec says "JSON 语法校验通过" (JSON syntax validation), so this is spec-compliant, but stricter object-type enforcement would be a defense-in-depth improvement.
- **Suggestion**: Optional future enhancement; not a defect against the current contract.

### P3-003 — SseDecoder rejects standard SSE fields id:/retry:

- **Severity**: P3 (non-blocking, strict-by-design)
- **Location**: `SseDecoder.java:60-62`
- **Issue**: The decoder throws `AnthropicCodecException` for any SSE field other than `data:`, `event:`, and `:` comments. The SSE specification defines additional fields (`id:`, `retry:`) that are valid but unused by Anthropic. If Anthropic ever introduced these, the adapter would fail-closed.
- **Suggestion**: Acceptable for current Anthropic Messages contract. No action needed; documented for future awareness.

---

## Conclusion

Verdict: **PASS**. The candidate faithfully implements the Anthropic Messages offline adapter and contract test suite by mirroring the proven TASK-0011 OpenAI adapter architecture, correctly substituting Anthropic protocol semantics (top-level `system`, `x-api-key`/`anthropic-version` headers, `message_start`/`content_block_delta`/`message_delta`/`message_stop` SSE sequence, `end_turn`/`stop_sequence`/`max_tokens`/`tool_use` stop-reason mapping, tools+tool_choice structured output). All 12 acceptance criteria pass with direct test evidence, all 14 requiredContractTests have dedicated coverage, all 8 invariants hold, and the write scope is clean. No P0 or P1 findings; three P3 non-blocking observations documented.

# TASK-0186 R1 Self-Review (C2 not-required)

**Task**: TASK-0186 — H5 Chat 发送流程 + 历史 API 消费纵切
**Risk class**: C2 (task-intake, independentReview: not-required)
**Reviewer**: self-review (C2 条件风险，无独立 Reviewer gate)
**Verdict**: PASS (no P0/P1/P2)

## Scope compliance

- **writeAllowlist**: 7 frontend files (3 new: chat.ts, chat.spec.ts, authed-fetch.ts; 4 modified:
  stores/chat.ts, stores/chat.spec.ts, pages/chat/chat.vue, pages/chat/chat.spec.ts) + 2 OpenAPI
  (virtual-companion.yaml, dist/**) + 6 governance. All changed files verified via
  `git diff --name-only` + `git ls-files --others --exclude-standard`.
- **forbiddenPaths**: No forbidden path touched. Frontend forbidden files use precise filenames
  (auth.ts, baseline.ts, memory.ts, realtime.ts, realtime-envelope.ts, realtime-transport.ts,
  sse-parser.ts, transport.ts + their specs + domain/** + non-chat stores/pages). No fnmatch cross-
  hyphen collision with writeAllowlist targets (chat.ts ≠ chat.spec.ts ≠ authed-fetch.ts). OpenAPI
  forbidden: specs/contracts/catalog/generated/** only (specs/openapi/** is writable).
- **protected-paths**: frontend/** not listed; specs/openapi/** not listed → C2 task-intake, no
  contract-change/catalog-change/database-migration triggered.

## AC verification

### AC1: chat.ts typed API client
- 4 functions: createConversation, sendGeneration, listMessages, cancelGeneration ✓
- ChatHttpError (unauthorized/server/client/parse) ✓
- 403/404 → null (existence hidden, INV-TENANT-001) ✓
- 401/5xx → throw (never fake success) ✓
- asId accepts string|number → normalises to string ✓
- listMessages: foreign/absent → empty array (no 404 disclosure) ✓

### AC2: authed-fetch.ts
- createAuthedFetch(getAccessToken): typeof fetch ✓
- Bearer header + credentials:include + POST CSRF ✓
- Does NOT modify realtime-transport.ts (uses fetchImpl injection) ✓

### AC3: stores/chat.ts send + history
- send(transport, deps, content): crypto.randomUUID → sendGeneration → run → loadHistory ✓
- loadHistory(transport): listMessages, catch non-fatal ✓
- initConversation(transport, relationshipId): createConversation + loadHistory ✓
- displayMessages getter: messages + streaming draft ✓
- run/cancel/reset unchanged (existing 7 store tests pass) ✓

### AC4: chat.vue real send flow
- sessionId = crypto.randomUUID() (real source) ✓
- onMounted: create conversation + loadHistory (no auto-start) ✓
- Message input + send button + history + draft + status + cancel ✓
- Authenticated transport + authedFetch for realtime ✓
- Removed hardcoded gen-alpha-1 / DEMO_SESSION_ID / auto-start ✓

### AC5: chat.spec.ts (17) + stores/chat.spec.ts (14) + pages/chat/chat.spec.ts (5) = 36 new/updated
- All PASS ✓

### AC6-9: Verification commands
- `pnpm --dir frontend test:run`: 196 passed (18 files) ✓
- `pnpm --dir frontend type-check`: vue-tsc exit 0 ✓
- `python scripts/dev/openapi_tool.py validate`: PASS ✓
- `python scripts/dev/openapi_tool.py diff`: PASS ✓
- `git diff --check`: exit 0 ✓

### AC10: Evidence deferred items
- doctor / canonical precheck / unittest discover: NOT_RUN (deferred per Owner), not marked PASS ✓
- authorizationCommit placeholder + DEMO_RELATIONSHIP_ID recorded as knownRisk ✓

## Adjacent risk assessment

- **INV-RT-001** (client never fabricates deltas): store.send calls existing run/streamGeneration
  which uses the tested reducer. No new delta fabrication path introduced. ✓
- **INV-TENANT-001** (existence hidden): chat.ts 403/404 → null/empty. listMessages returns []
  for foreign conversations. No existence-disclosing errors. ✓
- **INV-GEN-001** (generationId stable): store uses the generationId returned by sendGeneration.
  Idempotency key is crypto.randomUUID() per send. ✓
- **Auth boundary**: authed-fetch adds Bearer + CSRF; transport.ts is the single auth header source
  for the chat API client. Long-lived token never in localStorage/query (sessionId is client UUID,
  ticket secret is 45s single-use). ✓

## Non-blocking notes (P3, no fix batch)

- DEMO_RELATIONSHIP_ID = "1" is a demo constant (relationship selector UI is a future card).
- OpenAPI type:string vs Java long wire format: asId handles both; hashid encoding is future work.
- chat.spec.ts page test stubs fetch globally; a more targeted transport mock could reduce coupling.

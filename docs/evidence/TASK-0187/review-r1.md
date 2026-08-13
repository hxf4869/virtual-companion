# TASK-0187 R1 Self-Review (C2 not-required)

**Task**: TASK-0187 — Relationship 选择器 UI 纵切
**Risk class**: C2 (task-intake, independentReview: not-required)
**Reviewer**: self-review (C2 条件风险，无独立 Reviewer gate)
**Verdict**: PASS (no P0/P1/P2)

## Scope compliance

- **writeAllowlist**: 8 product files (5 new: api/relationship.ts, api/relationship.spec.ts,
  stores/relationship.ts, stores/relationship.spec.ts, components/RelationshipSelector.vue,
  components/RelationshipSelector.spec.ts; 2 modified: pages/chat/chat.vue,
  pages/chat/chat.spec.ts) + 6 governance (task card, context-lock, evidence/**, handoff,
  project-state, task-ledger). All changed files verified via `git diff --name-only` +
  `git ls-files --others --exclude-standard`.
- **forbiddenPaths**: No forbidden path touched. Frontend forbidden files use precise filenames
  (auth.ts, baseline.ts, chat.ts, memory.ts, realtime.ts, realtime-envelope.ts,
  realtime-transport.ts, sse-parser.ts, transport.ts + their specs + domain/** + non-target
  stores/pages). No fnmatch cross-hyphen collision with writeAllowlist targets
  (relationship.ts ≠ relationship.spec.ts; the `relationship` stem does not match any
  `frontend/src/api/*` forbidden literal). No OpenAPI/service/contract/catalog/generated touch.
- **protected-paths**: frontend/** not listed; specs/openapi/** not listed; service/** not touched
  → C2 task-intake, no contract-change/catalog-change/database-migration/safety-change triggered.

## AC verification

### AC1: relationship.ts typed API client
- 5 functions: createRelationship, listRelationships, getRelationship, activateRelationship,
  deactivateRelationship ✓
- RelationshipHttpError (unauthorized/server/client) ✓
- 403/404 → null / empty array (existence hidden, INV-TENANT-001) ✓
- 401/5xx → throw (never fake success) ✓
- asId accepts string|number → normalises to string ✓
- listRelationships: foreign/absent → empty array (no 404 disclosure) ✓

### AC2: stores/relationship.ts
- load(t): listRelationships → fill relationships → current = active (activeCompanionLimit=1) ✓
- create(t, personaRef): createRelationship → load → set current ✓
- activate(t, id): activateRelationship → load → set current ✓
- deactivate(t, id): deactivateRelationship → load → clear current ✓
- catch → status="error", never fakes success ✓
- current getter finds by id; reset clears all ✓

### AC3: RelationshipSelector.vue component
- props relationships/currentId/status/busy; emits activate(id)/create(personaRef) ✓
- native <select>+<option> per relationship; change → emit activate ✓
- personaRef input + create button (disabled when empty/busy) ✓
- error role=alert; loading role=status + aria-live=polite ✓
- Explicit import (no easycom dependency); new components/ dir ✓

### AC4: chat.vue removes DEMO_RELATIONSHIP_ID
- useRelationshipStore + RelationshipSelector wired ✓
- Single createAuthenticatedTransport feeds both relationship and chat stores
  (structural typing: RelationshipTransport ≡ ChatTransport ≡ AuthTransport) ✓
- onMounted: load → if current → startConversation (reset + initConversation) ✓
- onRelActivate/onRelCreate → relStore action → startConversation ✓
- Template: v-if="!hasRelationship" selector, v-else chat UI (history/draft/status/input/cancel
  unchanged) ✓
- Removed hardcoded DEMO_RELATIONSHIP_ID = "1" ✓

### AC5: tests — relationship.spec.ts (19) + stores/relationship.spec.ts (11) +
RelationshipSelector.spec.ts (7) + pages/chat/chat.spec.ts (6) = 43 relationship-related
- All PASS; existing 191 non-relationship tests still PASS (234 total, 21 files) ✓

### AC6-8: Verification commands
- `pnpm --dir frontend test:run`: 234 passed (21 files) ✓
- `pnpm --dir frontend type-check`: vue-tsc exit 0 ✓
- `git diff --check`: exit 0 ✓
- No OpenAPI/DB/Java change → openapi diff / run-rls / mvn not applicable ✓

### AC9: Evidence deferred items
- doctor / canonical precheck / unittest discover: NOT_RUN (deferred per Owner), not marked PASS ✓
- authorizationCommit placeholder recorded as knownRisk ✓

## Adjacent risk assessment

- **INV-TENANT-001** (existence hidden): relationship.ts 403/404 → null/empty. listRelationships
  returns [] for foreign/absent owner. No existence-disclosing errors. ✓
- **activeCompanionLimit=1**: store.load defaults current to the single active relationship;
  activate/deactivate delegate to the backend which enforces the limit. Frontend never claims a
  second active relationship. ✓
- **Auth boundary**: the shared authenticated transport (transport.ts) is the single auth-header
  source for the relationship client; no second auth path introduced. Long-lived token never in
  localStorage/query. ✓
- **Structural transport compatibility**: RelationshipTransport, ChatTransport and AuthTransport
  share `{request(method,path,body?) → {ok,status,json}}`; one transport instance serves both
  stores without widening either interface. ✓

## Non-blocking notes (P3, no fix batch)

- memory.vue still uses a free-text relationshipId input (unifying it onto the relationship store
  is a separate card; out of scope here).
- RelationshipSelector uses native <select> for happy-dom test reliability; a uni-app <picker>
  variant for non-H5 targets is future work.
- relationship.create() sets current without forcing activate; the backend activeCompanionLimit=1
  is the authority on the active flag, while frontend "current" is the chat-selection semantic.

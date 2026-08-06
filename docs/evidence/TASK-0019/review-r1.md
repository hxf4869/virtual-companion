# TASK-0019 Independent Review R1

## Candidate

- Commit: `cee485747b11b9549f74324e8c86bd5391cc5a9e`
- Tree: `5c036bfbf36ada59138b04aab2111f24930e19fd`
- Base: `da045605cff70461406eb5cbc218bba049afeb4a`

## Verdict: PASS (no fix batch)

R1 returned PASS with no P0/P1. Both acceptances are met and no fix batch was
required — the P2 observations are non-defects or future-revisits, not bugs.

## Scope

R1: COMPLETE_MATRIX, ACCEPTANCE, INVARIANTS, ADJACENT_RISK for the provider-neutral
ContextPlan / persona / LISTEN-DISCUSS domain (C4, no DB). No R2 (no fix batch).

## Verified

- **Determinism (acceptance #1)** — `ContextPlan`:
  - Canonical order = `ArrayList.sort(Comparator.comparingInt(ContextEntry::order))` over
    orders that are unique positive ints (deduped via `LinkedHashSet.add`, used only for its
    boolean return, never iterated). No ties → fully deterministic order, no tie-break needed.
  - `entries = List.copyOf(canonical)` stores an immutable list; both `entries()` and
    `orderedEntries()` return the same immutable view, so there is no external mutation path.
  - `ContextBudget` is a value record with positive-int invariants; `InteractionMode` is a
    two-value enum. Same inputs → equal plans (`sameInputsProduceEqualPlans` proves it).
- **Pure selector** — `InteractionModeSelector`: `final` class, private ctor, `static select`,
  zero fields/clock/random. Boundary tested: `>= DEFAULT_LISTEN_SOFT_CAP (3)` → DISCUSS,
  user-opened discussion wins, negative input rejected.
- **Provider-neutrality (acceptance #2)** — `ContextSourceKind` has only SYSTEM, PERSONA,
  SESSION_MEMORY, RELATIONSHIP_MEMORY, CONVERSATION_HISTORY, USER_INPUT; no PROVIDER_SESSION
  (class Javadoc records that a provider session is never a source — INV-MEM-001).
  `PersonaSkeleton` fields are templateId/displayName/tone/defaultMode/reflectionPromptStyle —
  no provider/model/api/adapter field; `defaultMode` is the neutral `InteractionMode` enum.
- **Persona reflection guard** (`PersonaSkeletonTest`): enumerates record components via
  `getRecordComponents()` and rejects any matching `provider|model|api|adapter|vendor|supplier`.
  Verified this is a real guard (adding `providerKey` fails the test), not a tautology, and that
  `defaultMode` → `defaultmode` does NOT false-match `model` (no trailing `l`).
- **INV-MEM-001/002**: no type lets a provider session or model output become a memory source;
  nothing auto-promotes output to memory. INV-TENANT-001 N/A (pure domain types, no DB/RLS).
- **Build/scope**: `mvn -pl service/modules/conversation -am test` BUILD SUCCESS, 13 contextplan
  tests + 15 existing conversation tests pass; `git diff --check` clean; 10 candidate files all
  within writeAllowlist; conversation/generation/**, persistence, migrations, specs untouched.

## P2 observations (non-blocking; no fix batch)

- **P2-1**: the persona no-provider-field guard is a blacklist regex, not an allowlist. It is a
  genuine guard but would not catch a semantically-coupled, neutrally-named field (e.g.
  `endpoint`, `configJson`). An allowlist of permitted component names would be stricter; accepted
  as-is since acceptance #2 is met and the current guard prevents the named regressions.
- **P2-2**: `PersonaSkeleton.gentleListener()` commits concrete `tone`/`reflectionPromptStyle`
  strings. These are skeleton descriptors (not full prompts) and the Javadoc states real persona
  content is approved out of band; revisit at the TASK-0035 approved-content gate.
- **P2-3**: minor test-branch gaps (blank `tone`/`reflectionPromptStyle` and null-element-in-entries
  branches are enforced by code but not separately asserted). Non-correctness; the invariants hold.

## Coverage notes

R1 ran the Docker Temurin-25 conversation build (BUILD SUCCESS, 13/13 contextplan) and
adversarial probing (HashSet ordering leak, mutable-list leak, hidden selector state) on the
candidate; the implementer ran the full harness suite (233 OK) and canonical precheck
(doctor 286199 PASS).

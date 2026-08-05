# TASK-0015 Independent Review R1

## Candidate

- Commit: `8995a749791f8add3f8f5c3c69a4b3b40c64dff1`
- Tree: `1a3795efce86a2eab49b210c07db134486004fcb`
- Base: `4330dca734487446c489dc7fd46c0cb71e963f1e`

## Verdict: PASS (after one fix batch)

R1 initially returned FAIL with one blocking P1. The fix batch (commit `8995a74`)
closed the P1; R2 finding-closure confirmed PASS with no new P0/P1.

## Scope

R1: COMPLETE_MATRIX, ACCEPTANCE, INVARIANTS, ADJACENT_RISK for the PostgreSQL 18 +
pgvector persistence baseline (C4 database-migration). R2: FINDING_CLOSURE only.

## Blocking finding (R1, closed)

### [P1] Invalid SQL in JdbcProviderDeploymentRepository — fixed
- `JdbcProviderDeploymentRepository.findByProviderId` and `findAdmitted` appended
  ` WHERE ...` after a `SELECT_ALL_SQL` that already ended with `ORDER BY provider_id`,
  producing `… ORDER BY provider_id WHERE …`, which PostgreSQL rejects.
- **Fix (commit 8995a74)**: split the base `SELECT` out of `ORDER BY` (`SELECT_BASE`)
  so each method composes valid SQL (WHERE precedes ORDER BY). R2 verified the three
  resolved queries are syntactically valid.

## Verified

- Migrations V1–V4 apply cleanly on PostgreSQL 18 + pgvector; all four runtime roles
  are `NOBYPASSRLS NOLOGIN`; `FORCE ROW LEVEL SECURITY` on every owned table (10 user
  tables + `authorization_snapshot`); `vc.vc_user` uses `id = vc.current_owner_id()`,
  others `owner_user_id = vc.current_owner_id()`; missing context → NULL → fail closed.
- All six composite ownership chains carry composite `(owner_user_id, parent_id)` FKs.
- INV-GEN-001 `UNIQUE(owner_user_id, logical_generation_id)`; INV-GEN-002 partial unique
  index `WHERE is_final`.
- Six SQL tests genuinely prove each named denial (cross_user/relationship/conversation,
  stale_worker_fence, missing_context, authorization_snapshot isolation); test runner
  pins image+digest, `--rm`, no host port, no volume, cleanup, no forbidden services.
- writeAllowlist/forbiddenPaths compliance; `git diff --check` clean vs base.

## Non-blocking (accepted for skeleton)

- P2: Flyway itself not executed by the local harness (psql applies V1–V4); Java/DB
  integration deferred to remote exact-SHA CI per task card.
- P2: authorization_snapshot RLS now covered by test 06 (added in the fix batch).
- P3: `begin_job_context` is not `SECURITY DEFINER` and has no real lease; explicitly
  deferred to TASK-0016 (full claim/lease/fence).

## Could not verify

- Java compilation (no local JDK 25); signatures match the modelruntime interfaces and
  no catalog-generated types are referenced. Remote CI is the compile gate.

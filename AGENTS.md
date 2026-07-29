# Repository Agent Rules — Virtual Companion V0.3.1

## Required reading order

1. `.harness/phase-scope.yaml`
2. `.harness/sources-of-truth.yaml`
3. `.harness/invariants.yaml`
4. `.harness/protected-paths.yaml`
5. Current READY task card and its context lock
6. Exact Skill version required by the task

## Absolute rules

- Do not write business code without a READY task.
- Do not modify files outside the task `writeAllowlist`.
- Do not change Catalog codes, database ownership, safety policy, memory rules, model routing, authorization or Harness without the required Skill and approval.
- Do not introduce a second framework for an existing concern.
- Do not add a paid-license, enterprise-only, paid-plugin or SaaS-only runtime prerequisite.
- Do not expose provider SDK types to business modules.
- Do not treat model context, cache, vector index or observability data as Canonical Memory.
- Do not claim a test passed unless the command was executed and the evidence records exit code, commit and artifact hash.
- Do not weaken, delete or skip a failing test to complete a task.
- Stop when scope, source of truth, ownership or safety behavior is ambiguous.

## Required commands before handoff

```bash
python scripts/harness/catalog_tool.py validate
python scripts/harness/catalog_tool.py diff --fail-on-drift
python scripts/harness/check_paid_features.py
```

Record every command as PASS, FAIL or NOT_RUN. NOT_RUN is allowed only with a truthful reason and cannot satisfy the Definition of Done.

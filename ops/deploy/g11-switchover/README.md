# G11 switchover drill — Phase 5 maintenance/drain/cutover/rollback rehearsal

Rehearses the Phase 5 generation-plane switch sequence of
`docs/planning/2026-08-30-go-companion-runtime-redesign.md` on the isolated
local stack. Synthetic smoke only — never production, never a real provider,
never real user data, no destructive schema cleanup (that is G13).

## What the drill proves

```
Java serves via Caddy edge (fake provider, COMPLETED)
  → maintenance window (edge 503, no new admission)
  → drain (in-flight invocation cancelled, no live work_item claims)
  → backup fixed (pg_dump; restore-to-check-db with identical row counts)
  → negative gate (Go `full` refuses to start while Java holds the
    vc.runtime.singleton generation-plane lease)
  → stop Java → lease released
  → Go companiond `full` acquires the lease and serves (opaque login,
    SSE chat.snapshot/chat.completed, cancel-during-stream → CANCELLED)
  → Caddy API/SSE upstream switches to Go; edge smoke passes
  → rollback: maintenance → drain Go → SIGTERM Go → lease released →
    DB restored from the pre-cutover dump (row counts match) →
    Java restarts, re-acquires the lease, serves COMPLETED via the edge
```

The lease assertion is the load-bearing gate: Java and Go use the same
session-scoped advisory key `vc.runtime.singleton`, so both can never be
active generation-plane writers.

## Run

```bash
bash ops/deploy/g11-switchover/run-drill.sh
```

Optional env:

| variable | default | meaning |
|---|---|---|
| `G11_KEEP` | 0 | keep the compose stack up on exit (`.run/` artifacts are always kept for diagnosis) |
| `G11_CADDY_PORT` | 18080 | edge host port |
| `G11_GO_PORT` | 18082 | Go companiond host port (must differ from the edge) |
| `G11_DB_PORT` | 5432 | host PostgreSQL port for the host Go runtime |
| `G11_RUNTIME_SCRAPE_PORT` | 18081 | Java runtime direct port (operator drain path) |
| `G11_FAKE_PROVIDER_PORT` | 19090 | Java-phase fake provider host port (runtime netns) |
| `G11_GO_FAKE_PORT` | 19091 | Go-phase loopback fake provider host port (own netns) |

Prereqs: docker compose v2 (OrbStack), jq, JDK 25 (jar build on demand),
Go 1.26.7 (`~/.local/go/bin/go`). The H5 stub replaces the real bundle — the
opaque-session H5 release unit is simulated at the API level and the browser
steps stay manual for the real window.

## Layout

- `compose.overlay.yml` — drill overlay on
  `scripts/measure/g1-java-baseline/compose.yml` (adds host PostgreSQL port,
  configurable fake-provider hold, drill-owned edge).
- `Caddyfile.serve` / `Caddyfile.maintenance` — edge configs switched by
  `caddy reload` during the window.
- `h5-stub/` — minimal H5 shell for the edge.
- `run-drill.sh` — the drill itself; secrets are generated into `.run/`
  (mode 0600, gitignored) and never printed.

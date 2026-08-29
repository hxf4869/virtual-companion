# G1 Java resource / transaction baseline

Repeatable Linux measurement for
`docs/planning/2026-08-30-go-companion-runtime-redesign.md` §19.1 / Phase 0.

This host is **not** the Owner Mac. Numbers produced here are a method and a
Linux sample. They are not frozen Go gates and not the Owner absolute budget.

```bash
bash scripts/measure/g1-java-baseline/run.sh
```

Optional env:

| variable | default | meaning |
|---|---|---|
| `G1_IDLE_SECONDS` | 600 | idle window per trial (§19.1: 10 minutes) |
| `G1_TRIALS` | 3 | independent trials after warm-up/first boot |
| `G1_GEN100` | 100 | consecutive fake-provider generations |
| `G1_POST_IDLE_SECONDS` | 60 | idle sample after the 100-generation burst |
| `G1_KEEP` | 0 | keep compose stack on exit |

The stack is isolated (`vc-g1`): Caddy + Java runtime + PostgreSQL 18 + MinIO +
loopback fake provider. Secrets are generated into `.run/compose.env` (mode
0600, gitignored). Logs never include tokens, cookies, or message bodies.
If `docker info` fails because the user is only in the `docker` group via
`sg`, `run.sh` re-execs under `sg docker`.

`run.sh` probes Docker bridge inter-container TCP. If that probe fails (seen on
this Linux vfs sandbox: `bridge-nf-call-iptables=1` and no iptables/nft rules),
it applies `compose.host.yml` so the same four processes bind localhost instead
of the broken bridge. That overlay is a host quirk, not a product topology.
OrbStack/Owner Mac should keep the default bridge.

Fair Java tuning (once, measurement compose only): `mem_limit=1536m` and
`JAVA_TOOL_OPTIONS=-XX:MaxRAMPercentage=70.0 -XX:InitialRAMPercentage=20.0`.
`ops/deploy/docker-compose.yml` is unchanged.

On this Linux sandbox the MinIO S3 API listens on loopback even when
`--address 0.0.0.0` is passed. The measurement compose therefore:

- talks to MinIO from `minio-init` via `network_mode: service:minio` / `127.0.0.1`;
- republishes the API on `minio:19002` with a tiny `socat` helper so the Java
  runtime can reach the bucket.

The socat process is a host quirk, not a product component, and is not part of
the retained-stack RSS sum.

Committed outputs after a successful run:

- `docs/planning/g1-java-resource-baseline.md`
- `docs/planning/g1-java-resource-baseline-results.json`

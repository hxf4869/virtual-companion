# G12 Go capacity profile (synthetic, production-derived resident stack)

Single-trial capacity harness for §19.1 on the resident stack rendered
privately from `ops/deploy` (Caddy TLS + companiond runtime + PostgreSQL 18 +
pgvector + MinIO local packaging, per-trial project/image tags). Traffic enters
through Caddy's loopback TLS port, so boundary A (the companiond process the
traffic hits — runtime PID 1) and boundary B (each component's whole container
cgroup) are collected over the same windows:

- A: `process_cpu_seconds_total` via a network-namespace-sharing observer
  (Caddy does not proxy metrics) plus RSS/PSS/fd from `smaps_rollup`.
- B: cumulative Engine-stats CPU counters per component plus per-process
  `smaps_rollup` sums over the target cgroup (readers run outside the measured
  cgroups; a component with unreadable processes is `PARTIAL`, never zeroed;
  a decreasing CPU counter is a reset, never clamped).

Never a real provider, never real user data; secrets are synthetic and live
only in the private per-trial output directory (gitignored). Each invocation
is one independent trial with its own project, images, output directory, and
data; `render_stack.py` validates resource naming before anything is
created.

Resource ownership is receipt-based (VC-R59): every invocation generates a
fresh nonce that `render_stack.py` stamps onto every rendered service,
volume, and network label. The stack is built and created with
`compose create --build` (nothing started), the exact created identities
(CIDs/mounts/networks, volume driver+CreatedAt+nonce, network immutable Id,
built image ids) are recorded immediately, and only then is the stack
started. Cleanup removes only those records after re-verifying each current
identity — same-name replacements are preserved — and proves absence solely
with rc0/count0 daemon queries; a failed query is never "gone", project
labels/names never serve as creator proofs, and there is no prune /
`--remove-orphans` / prefix or time-window adoption. Missing, unreadable, or
corrupt receipt records surface as `unverified` leftovers — never as an
empty success — while the confirmed receipts are still cleaned by their
exact identities. A failed cleanup keeps
the ownership records (and exits nonzero through the EXIT trap); a previous
run's or concurrently claimed output directory is refused outright, so a
run that created nothing performs zero Docker writes. `G12_KEEP=1` preserves
a run's resources for inspection but never authorizes a later run to
reclaim them.

The run fails if any workload fails, an SSE is missing, provider request count
differs from accepted generations, the provider/worker peak does not prove the
configured generation concurrency, or cleanup verification finds leftover
resources. Warm-up keys are disjoint from measured keys, so idempotent replay
cannot make a sample look faster.

```bash
bash scripts/measure/g12-go-capacity/run.sh            # full profile
bash scripts/measure/g12-go-capacity/run.sh --probe    # FUNCTIONAL_ONLY wiring proof
python3 scripts/measure/g12-go-capacity/test_collector.py  # render/collect/aggregation units
python3 scripts/measure/g12-go-capacity/test_resources.py  # resource-ownership units (stubbed docker)
```

`--probe` is short and bounded: it proves stack boot (migrate/bootstrap/
minio-init exit 0), Caddy TLS readiness via the private CA, collector field
completeness/attribution/observer exclusion/aggregation, and at most one real
1-generation + 1-SSE chain with fake-provider counting. It draws **no**
performance or capacity conclusions and satisfies no §19.2 gate.

Optional env:

| variable | default | meaning |
|---|---|---|
| `G12_GENS_S5` / `G12_SSE_S5` | 4 / 2 | scenario 5 shape |
| `G12_GENS_S10` / `G12_SSE_S10` | 16 / 4 | scenario 10 shape (SSE cap 8/gen) |
| `G12_CONCURRENCY` / `G12_OUTSTANDING` | 16 / 16 | §19.5 overrides (config caps at 16) |
| `G12_SOAK_TURNS` / `G12_SOAK_BATCH` | 100 / 10 | recovery workload and batch size |
| `G12_IDLE_SECONDS` / `G12_WARM_IDLE_SECONDS` / `G12_POST_IDLE_SECONDS` | 600 / 10 / 600 | §19.1 idle and recovery windows (probe uses 6 s) |
| `G12_SAMPLE_INTERVAL` / `G12_READER_INTERVAL` | 0.5 / 1 | frame and reader cadence (seconds) |
| `G12_OUTPUT_DIR` / `G12_TRIAL_ID` / `G12_PROJECT` | `.run/<trial>` / UTC stamp / `vcg12c-<trial>` | per-trial artifacts and compose project; an existing/non-empty or already-claimed output directory is refused |
| `G12_HTTPS_PORT` | 18447 | the only published port: `127.0.0.1:<port>→443` (Caddy TLS) |
| `G12_FAKE_PROVIDER_PORT` | 19091 | fake provider port inside the runtime netns (never published) |
| `G12_KEEP` | 0 | keep the stack and images up on exit |

Output: `trial.summary.json` (probe: `probe.summary.json`, marked
`FUNCTIONAL_ONLY`), scenario result/summary and B-analysis JSON, idle windows,
100-turn batch and recovery summaries, `frames.jsonl` (same-window A/B frames:
timestamp / platform / source / integrity / 4-component data), scrape
snapshots, `created-resources.json` (this run's nonce-receipted inventory:
exact CIDs + mounts/networks + volume/network identity), `cleanup.leftovers.json`
(written when cleanup cannot prove everything gone; ownership records are
kept with it for recovery), and build logs. The fake provider is fixture-only:
separate cgroup, not counted in B.

Boundary caveats that stay open for the full G12 acceptance: the frame window
resolution is the sample interval (A boundary CPUs use exact one-shot
scrapes); `docker image inspect` sizes are packed-resources, not unpacked
rootfs; PG healthcheck execs (UID 0) make individual db frames `PARTIAL`
without breaking the frame series. B-side CPU windows carry an explicit
status (`VALID` / `PARTIAL` / `INVALID`) from the epoch-checked engine
counter analysis — same-CID restarts are detected via `State.StartedAt`
epochs even when the new counter exceeds the old value, missing stats or
epoch reads make a window PARTIAL at most, never silently valid; `sampled_at`
is the local response-receipt time of the engine query, not the engine's own
`stats.read` instant, so window bounds are stated at that resolution, not as
nanosecond-exact synchronization. Sample report:
`docs/planning/g12-go-capacity-sample.md`.

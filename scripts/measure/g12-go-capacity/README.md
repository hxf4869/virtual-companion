# G12 Go capacity profile (synthetic)

Single-trial capacity sample for §19.1 场景 5 (4 generation + 8 SSE), 场景 10
(16 generation + 64 SSE), and the 100-turn post-idle recovery check against
the host Go companiond `full` mode with a loopback fake provider. Java appears
only as the Flyway migrator (applies V1–V117, then stops — §21.2). Never a real
provider, never real user data; secrets are synthetic and generated into
`.run/` (gitignored).

The run fails if any workload fails, an SSE is missing, provider request count
differs from accepted generations, or the provider/worker peak does not prove
the configured generation concurrency. Warm-up keys are distinct from measured
keys, so idempotent replay cannot make a sample look faster.

```bash
bash scripts/measure/g12-go-capacity/run.sh
```

Optional env:

| variable | default | meaning |
|---|---|---|
| `G12_GENS_S5` / `G12_SSE_S5` | 4 / 2 | scenario 5 shape |
| `G12_GENS_S10` / `G12_SSE_S10` | 16 / 4 | scenario 10 shape (SSE cap 8/gen) |
| `G12_CONCURRENCY` / `G12_OUTSTANDING` | 16 / 16 | §19.5 overrides (config caps at 16) |
| `G12_SOAK_TURNS` / `G12_SOAK_BATCH` | 100 / 10 | recovery workload and batch size |
| `G12_IDLE_SECONDS` / `G12_WARM_IDLE_SECONDS` / `G12_POST_IDLE_SECONDS` | 60 / 10 / 60 | cold idle and equal warm-idle observation windows |
| `G12_OUTPUT_DIR` / `G12_TRIAL_ID` | `.run` / UTC timestamp | preserve independent trial artifacts |
| `G12_GO_PORT` | 18082 | companiond host port |
| `G12_GO_FAKE_PORT` | 19091 | loopback fake provider host port |
| `G12_KEEP` | 0 | keep the stack up on exit |

Output: `trial.summary.json`, scenario result/summary JSON, 100-turn batch and
recovery summaries, Prometheus snapshots, `sample.csv` (0.5s RSS/%cpu samples),
and `companiond.log`. Results remain single-trial samples; run at least three
independent trials before proposing §19.2 gates. Sample report:
`docs/planning/g12-go-capacity-sample.md`.

# G12 Go capacity profile (synthetic)

Single-trial capacity sample for §19.1 场景 5 (4 generation + 8 SSE) and
场景 10 (16 generation + 64 SSE) against the host Go companiond `full` mode
with a loopback fake provider. Java appears only as the Flyway migrator
(applies V1–V117, then stops — §21.2). Never a real provider, never real
user data; secrets are synthetic and generated into `.run/` (gitignored).

```bash
bash scripts/measure/g12-go-capacity/run.sh
```

Optional env:

| variable | default | meaning |
|---|---|---|
| `G12_GENS_S5` / `G12_SSE_S5` | 4 / 2 | scenario 5 shape |
| `G12_GENS_S10` / `G12_SSE_S10` | 16 / 4 | scenario 10 shape (SSE cap 8/gen) |
| `G12_CONCURRENCY` / `G12_OUTSTANDING` | 16 / 16 | §19.5 overrides (config caps at 16) |
| `G12_GO_PORT` | 18082 | companiond host port |
| `G12_GO_FAKE_PORT` | 19091 | loopback fake provider host port |
| `G12_KEEP` | 0 | keep the stack up on exit |

Output: `.run/s5.json` / `.run/s10.json` (latency stats), `sample.csv`
(0.5s RSS/%cpu samples), `companiond.log`. Results are single-trial samples;
§19.2 gates stay Owner-frozen (≥3 trials per the spec before freezing).
Sample report: `docs/planning/g12-go-capacity-sample.md`.

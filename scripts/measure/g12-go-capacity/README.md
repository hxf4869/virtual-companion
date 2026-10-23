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
exact identities; a missing collectors record is optional only while the
collector launch was never attempted (run.sh marks the attempt, after which
missing counts as unverified too). A failed cleanup keeps
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

Scenario 4 (§19.1: exactly 1 generation + 1 SSE) measures the first live
`chat.delta` with an incremental SSE parser (chunk-by-chunk `read1`, frames
split on blank lines, comment/heartbeat lines ignored). Timing bases are
explicit: from_send (POST issued), from_accept (202 received), from_subscribe
(SSE attempt start); timestamps are the receipt time of the socket chunk
carrying the event. A delta counts as live unless it sits after the last
`chat.snapshot` preceding the terminal (the committed-text replay burst);
the catch-up snapshot every live subscription starts with is coverage
evidence — empty text means the subscriber predates every delta, so the
first received delta is the generation's first delta. The whole
subscribe/retry loop runs against one absolute deadline: every blocking
read re-caps the connection socket to the remaining budget before it is
issued (a timeout fixed at connect time would re-run the full budget on
each read), and a chunk received after the deadline is dropped unparsed,
so neither a silent stall nor a late terminal can extend the call or
become a success. The adjusted value subtracts the fake provider's known
`holdMs+firstTokenMs` window (measured from when that process received its
request, externally unobservable), so it still contains backend
intake/claim, the provider HTTP round-trip and SSE subscribe offset — it is
never reported as pure service processing time, no ms threshold is asserted
(§19.2 gates stay Owner-frozen), and a missing delta fails with its reason
instead of a fabricated zero.

Scenario 3 (§19.1: 3 silent SSE subscriptions, VC-R61) is measured against
the real product shape: SSE is bound to a generation, so silent
subscriptions exist only on ONE in-flight generation — the scenario is a
single generation whose fake-provider completion is held by a bounded
`holdMs` (`PUT /g12/config` via `compose exec` inside the nonce-receipted
fake-provider container) plus 3 subscribers, never a zero-generation idle
and no product API is changed. The original holdMs is registered as
pending BEFORE the first PUT (a PUT whose response was lost may still have
been applied server-side) and restored right after the scenario on success
and failure paths alike; a successful restore clears the pending state,
and cleanup()'s EXIT path makes exactly one further bounded restore
attempt for anything still pending — including under `G12_KEEP=1`, where
the stack survives the run — keeping the exit nonzero and recorded when
that fails, and never restoring twice successfully. The quiet window is
proven from real state per DEDUPLICATED observer record (the frame sampler
reuses the latest observer record between observer polls, so frame-ts
growth is not a fresh sample; a still-valid record repeated across frames
counts once, while an invalid/stale observation — including the same
cached record aged past the staleness window — breaks the window): each
sample must show `vc_realtime_subscribers=3`, `vc_generation_active=1`,
provider `activeStreamRequests=1` and the provider's `contentChunkWrites`
counter equal to its pre-send baseline, strictly increasing in observer
time; bad samples are never filtered away to stitch two ends together, and
one boundary-exact scrape is taken inside the window. The recording budget
is explicitly bounded and coordinated with the workload's SSE absolute
deadline (`--sse-timeout` = hold + 20 s). The workload runs as a directly
launched python child whose exact PID is reaped by cleanup on every exit
path.

Scenario 6 (§19.1: cancel / disconnect-reconnect, VC-R62) proves the two
S6 cancel/reconnect sub-scenarios on the real public chain with TWO
independent generations, each gated on a live `chat.delta` actually
received (never a sleep or a thread-start inference). (A) The subscriber
closes its SSE connection right after the first live delta: the
disconnect must neither cancel the generation nor re-POST it — the
snapshot-only re-subscription still ends COMPLETED with further live
deltas, a subscription after the terminal returns the persisted snapshot +
terminal whose FULL text equals the single committed assistant message
(compared in memory; only booleans/lengths are reported), and exactly one
assistant message exists. (B) The SSE response carrying the first live
delta stays OPEN while the cancel POST fires (the callback's two blocking
HTTP calls share the stream's monotonic deadline — each is capped at the
remaining budget before it is issued), and the proof is the ORIGINAL
stream receiving the `chat.cancelled` broadcast and being closed by the
server (`original_stream_cancelled`); a pre-claim empty-snapshot+EOF
stream retries within the same deadline, but once the first live delta
arrives the response is LOCKED — a later EOF/error without the cancel
terminal fails and can never be re-subscribed around. The provider
deltaMs is widened for the window (pending-registered before the first
PUT, restored on every exit path exactly like the scenario-3 holdMs). The
fixture proves the provider-side truth: the fake provider counts
`abortedStreamRequests` (client disconnected mid-reply — the parts loop
stops immediately, no further content chunks are written) separately from
`completedStreamRequests` (full reply + [DONE]; a normal close after
`response.end()` is a completion, never an abort), and the scenario
asserts exactly one abort (the cancelled generation, which stopped before
writing all its content chunks) and one completion (the disconnect
generation's natural finish) across exactly two provider requests, with
worker/subscribers/provider-active settling back to baseline confirmed
by a BOUNDED real-state wait (fresh scrapes re-read until all three are
genuinely zero — the fixture's own sleeps make the settle reachable but
delayed, so neither a single post-workload scrape nor a fixed sleep is
accepted as proof, and the scenario window ends only after the settle is
confirmed).

The slow-subscriber sub-scenario of S6 remains open for the deployed chain
(Caddy + TLS + the real companiond process). The existing
`backend/internal/httpapi/realtime_test.go` regression
`TestRealHTTPSlowSubscriberIsolatedAndExits` already covers real TCP
backpressure through the Go handler, with controlled socket buffers and a
test write timeout: slow-handler exit, healthy-reader isolation, catch-up
and snapshot paths, and subscriber cleanup. This is separate from the
public deployment path at its production defaults; `--probe-s6` still
covers only cancel and disconnect/reconnect. A client that merely stops
reading is not proof that server-side slow-subscriber protection fired.

Scenario 9 uses two isolated synthetic accounts and the public password,
authenticator setup/confirm, and session APIs. It overlaps a trusted-device
login with deletion of an explicit existing session: only the target must
fail its next request, while the new session and the other account remain
active. A subsequent revoke-all must invalidate both remaining own sessions
and the SAME previously accepted trusted-device cookie; sending that cookie
again must require TOTP without issuing a new session. A cross-account
session deletion must return 404 without revoking the target, and the original
measurement session must remain usable. The shared admission/result deadline
is 60 seconds by default; expired or late responses fail. This is a bounded
FUNCTIONAL_ONLY chain with no generation or provider traffic, not a capacity
or latency acceptance.

```bash
bash scripts/measure/g12-go-capacity/run.sh                 # full profile (s4, s3, s6, s9, s5, s10, soak)
bash scripts/measure/g12-go-capacity/run.sh --probe         # FUNCTIONAL_ONLY wiring proof (s4 branch)
bash scripts/measure/g12-go-capacity/run.sh --probe-s3      # FUNCTIONAL_ONLY wiring proof (s3 branch)
bash scripts/measure/g12-go-capacity/run.sh --probe-s6      # FUNCTIONAL_ONLY wiring proof (s6 branch)
bash scripts/measure/g12-go-capacity/run.sh --probe-s9      # FUNCTIONAL_ONLY public auth/session concurrency
python3 scripts/measure/g12-go-capacity/test_collector.py   # render/collect/aggregation units
python3 scripts/measure/g12-go-capacity/test_resources.py   # resource-ownership units (stubbed docker)
python3 scripts/measure/g12-go-capacity/test_workload.py    # SSE parser/first-delta/quiet-window/s6/s9 units
python3 scripts/measure/g12-go-capacity/test_fake_provider.py  # fixture abort/completion counters (node)
```

`--probe` is short and bounded: it proves stack boot (migrate/bootstrap/
minio-init exit 0), Caddy TLS readiness via the private CA, collector field
completeness/attribution/observer exclusion/aggregation, and at most one real
1-generation + 1-SSE chain (the scenario 4 branch) with fake-provider
counting and first-delta timing wiring. It draws **no** performance or
capacity conclusions and satisfies no §19.2 gate. `--probe-s3` shares the
same bound for the scenario 3 chain only (one held generation + 3 silent
subscribers with the quiet-window proof above); it runs no S4 chain and no
full profile. `--probe-s6` shares the same bound for the two S6
cancel/reconnect chains only (one deliberate-disconnect generation and one
cancelled generation, with the fixture-side abort/completion accounting
above); it runs no other chain and no full profile. `--probe-s9` runs only the S9
authentication/session chain described above, with the same stack, TLS,
collection, and ownership cleanup; it runs no other scenario or full profile.

Optional env:

| variable | default | meaning |
|---|---|---|
| `G12_GENS_S5` / `G12_SSE_S5` | 4 / 2 | scenario 5 shape |
| `G12_GENS_S10` / `G12_SSE_S10` | 16 / 4 | scenario 10 shape (SSE cap 8/gen) |
| `G12_S3_HOLD_MS` / `G12_S3_QUIET_MS` | 8000 / 3000 | scenario 3 provider hold and quiet-window budget (probe-s3 uses `G12_PROBE_S3_HOLD_MS` / `G12_PROBE_S3_QUIET_MS`, default 6000 / 2000) |
| `G12_S6_DELTA_MS` | 400 | scenario 6 widened provider deltaMs so a stream is still in flight after the first live delta (probe-s6 uses `G12_PROBE_S6_DELTA_MS`, default 400; restored to the original value on every exit path) |
| `G12_S9_BUDGET_SECONDS` | 60 | scenario 9 shared monotonic deadline; each request uses the remaining budget, and late responses fail |
| `G12_CONCURRENCY` / `G12_OUTSTANDING` | 16 / 16 | §19.5 overrides (config caps at 16) |
| `G12_SOAK_TURNS` / `G12_SOAK_BATCH` | 100 / 10 | recovery workload and batch size |
| `G12_IDLE_SECONDS` / `G12_WARM_IDLE_SECONDS` / `G12_POST_IDLE_SECONDS` | 600 / 10 / 600 | §19.1 idle and recovery windows (probe uses 6 s) |
| `G12_SAMPLE_INTERVAL` / `G12_READER_INTERVAL` | 0.5 / 1 | frame and reader cadence (seconds) |
| `G12_OUTPUT_DIR` / `G12_TRIAL_ID` / `G12_PROJECT` | `.run/<trial>` / UTC stamp / `vcg12c-<trial>` | per-trial artifacts and compose project; an existing/non-empty or already-claimed output directory is refused |
| `G12_HTTPS_PORT` | 18447 | the only published port: `127.0.0.1:<port>→443` (Caddy TLS) |
| `G12_FAKE_PROVIDER_PORT` | 19091 | fake provider port inside the runtime netns (never published) |
| `G12_KEEP` | 0 | keep the stack and images up on exit |

Output: `trial.summary.json` (probe: `probe.summary.json`; probe-s3:
`probe-s3.summary.json`; probe-s6: `probe-s6.summary.json`; probe-s9:
`probe-s9.summary.json` — all marked
`FUNCTIONAL_ONLY`), scenario result/summary and B-analysis JSON (s4's
summary carries the first-delta block with its baselines,
provider-known-delay subtraction, coverage evidence and definition; s3's
summary carries the quiet-window record: deduplicated observer samples,
break/end reasons, boundary-exact window scrape, hold/restore values, SSE
deadline and the same-window A/B analysis over the quiet bounds; s6's
summary carries the reconnect/cancel evidence — booleans, counts, event
names, the fixture abort/completion deltas and the deltaMs set/restore
values, never message text; s9 records HTTP statuses, isolation/revocation
booleans, call counts and client-observed request-interval overlap, never
passwords, TOTP material or cookie values), idle windows,
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

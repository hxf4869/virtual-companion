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

VC-R154 measured this boundary once on the deployed chain at the frozen
budget shape (8192 logical chars = engine-estimated 2048 output
tokens, 254274 provider wire bytes, 2048 chunks × 10 ms): a truly
stopped same-gid subscriber (proven by its own first live delta, then
no further read and no connection swap) remained unread through the
observation window; the drop counter
`vc_realtime_slow_disconnect_total` stayed zero across 95 valid
samples while the
healthy subscriber completed exactly once with full 8192-char text —
NOT_TRIGGERED for this shape; handler exit stays UNPROVEN and buffer
absorption is an untested explanation only. Facts and limits:
`docs/planning/g12-go-capacity-sample.md` §19.

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

Scenario 8 (VC-R140 probe) proves ONE worker-crash recovery point on the
real public chain: the runtime container is killed (docker kill, exit 137)
while a generation's unique attempt is still CREATED and a live
`chat.delta` has just been received. A sequential two-phase client avoids
any long-lived controller: `s8-prepare` sends exactly one generation and
returns after the first live delta; run.sh then re-verifies this run's
nonce-receipted runtime/provider CIDs, asserts the DB mid-stream state
read-only (work item CLAIMED with an unexpired lease, one attempt CREATED,
no assistant commit) and the old-epoch provider counters (one active
mid-stream request with content flowing) — any mismatch fails closed
before the kill. The old-epoch provider (its own PID namespace) is
bounded-polled via `docker exec` until the orphaned request is recorded
(abort +1, completed +0, active 0), the SAME runtime CID is restarted (new
StartedAt/PID and a changed real network namespace, read as
`/proc/1/ns/net` from inside the exact CID — `SandboxKey` is empty for
netns-sharing containers) and the provider CID restarted into the new
network namespace (its `/proc/1/ns/net` must change and then equal the
restarted runtime's) with
counters at initial zero and the config read back at the original deltaMs
— old/new epoch counters are recorded separately,
never subtracted across the restart. run.sh then waits out the DEFAULT
claim lease via a read-only DB poll (no timeout/lease/DB-clock tampering,
no DB writes) and, BEFORE any health traffic, fixes the recovered DB state
read-only (attempt ABANDONED_LATE, generation FAILED_FINAL with no
assistant message, work item FAILED / `PROVIDER_OUTCOME_UNKNOWN`, no
requeue, no new attempt) plus a further fixed new-epoch zero-request
sample — forward evidence for the recovery window, never an inference
back from the post-control count. `s8-verify` then re-checks the public
view (FAILED_FINAL with the `external-failed` fault bucket — the wire
never exposes the precise code — the `chat.failed` post-terminal view and
zero assistant messages for the crashed turn) and only then sends ONE
independent health-control generation that must complete (SSE
`chat.completed`, its OWN snapshot reading COMPLETED, exactly one
assistant message afterwards) while the original STILL reads FAILED_FINAL;
the new-epoch provider must show exactly that health request (1 stream /
1 completed / 0 aborted / 0 active). The provider deltaMs is
widened for the probe window (pending-registered before the first PUT,
restored on every exit path like the S3/S6 knobs; the restarted provider
re-reads its initial env, which the restore re-affirms). Collectors,
sampler, idle windows and warm-up are skipped before any helper would be
created: no A/B frames, no cross-restart CPU/RSS analysis, no performance
conclusion. This covers only the attempt-CREATED crash point — the
claim-before-intent and SUCCEEDED-before-finalize crash points stay
outside the probe.

`--probe-s8-before-finalize` (VC-R145) proves the SECOND S8 crash point on
the same bound: the runtime container is killed (docker kill, exit 137)
only AFTER the provider has fully completed the stream and the SUCCEEDED
attempt outcome has been committed independently, while the worker's
finalize transaction is blocked on the generation row. The whole
crash window lives in one helper process (`s8_finalize_crash.py`, launched
and reaped by run.sh): it opens a control `compose exec -T db psql`
session, locks THIS run's generation row FOR UPDATE while the unique
attempt is still CREATED (the R144-preflight-proven shape), observes the
real gates read-only — SUCCEEDED committed and fresh, generation
IN_PROGRESS with no assistant, work item CLAIMED on an unexpired lease,
exactly one companiond backend (`usename='vc_runtime_login' AND
application_name='companiond'`) blocked in `go_finalize_generation` with
`pg_blocking_pids` naming the control pid, fresh ages, and the SAME
worker `query_start` across two consecutive reads (a changed one means
the finalize tx timed out and retried) — plus the old-epoch provider
fully settled (completed +1, streams +1, abort unchanged, active 0).
The exact receipt CID (nonce label + running, never a name/label search)
is re-verified BEFORE the last real SQL gate. Each first/last read uses
`max(query_age, xact_age, outcome_age)` plus monotonic elapsed time from
before that SQL request; the earlier of the two deadlines binds the
3.5 s window, leaving margin below the unchanged 5 s transaction timeout.
The kill is issued only with time remaining, its wait budget cannot exceed
that remainder, and a late return is ABORTED rather than covered/PASS.
Only a kill confirmed as `exited 137 0` within that bound is followed by
ROLLBACK and reaping both psql children. Every failure releases and reaps:
a failure before issuance killed nothing; after issuance the result may
be unproven and cannot pass. The shell gives cooperative cleanup 16 s,
covering both SQL sessions' bounded shutdown. The control session's own
`SET LOCAL` idle timeout bounds only itself (DB tx 5 s, claim lease
270 s and recovery tick untouched). Downstream, the shared restart/lease-wait machinery runs
with C-point expectations: old epoch shows completion WITHOUT any abort,
the recovered DB state reads attempt SUCCEEDED (still exactly one),
generation FAILED_FINAL with no assistant, work item FAILED with
`CANDIDATE_LOST_AFTER_ATTEMPT` and no requeue, the new-epoch provider
stays at zero through recovery (no replay), and the same `s8-verify`
re-checks the public failure view (`external-failed` bucket,
`chat.failed`, zero assistant messages) before the one independent
health-control generation must complete while the original STILL reads
FAILED_FINAL. The deltaMs widen/pending-restore, receipt-based ownership
and cleanup contracts are exactly the probe-s8 ones; the mid-stream and
claim-before-intent crash points stay outside this probe.

`--probe-s8-before-attempt` (VC-R148) is the third implemented standalone
S8 probe entry, covering the claim-before-intent crash point, on the
same bound: the runtime container is killed
after the work item is CLAIMED but BEFORE any attempt intent row exists,
while the worker's prepare INSERT is blocked on a control table lock.
The same one-process helper (`s8_finalize_crash.py --crash-point
before-attempt`) owns the whole window: it prepares the public session
(consents, relationship, conversation) through the real workload Client,
takes `LOCK TABLE vc.attempt_intent IN SHARE MODE` on the control psql
session (grant proven in `pg_locks`), and only then sends exactly ONE
public generation POST (202 → gid; no live delta is waited for — none
can exist under the lock). The read-only crash gates are the shared
shape: attempts strictly empty, generation IN_PROGRESS with no assistant,
work item CLAIMED on an unexpired lease, exactly one companiond backend
blocked in `go_prepare_model_attempt` with its `attempt_intent`
RowExclusiveLock NOT granted and the control pid in `pg_blocking_pids`,
the same pinned `query_start` across two reads, and the old-epoch
provider untouched relative to the baseline (no stream, no completion,
no abort, nothing active, no content chunk — raw stats including the
total request counter are recorded as-is, never conflated with stream
counts). The kill window math (max(query_age, xact_age) basis here),
kill/137/ROLLBACK/reap contracts and 16 s shell grace are the shared
helper ones. The provider deltaMs is NOT widened for this point and no
pending restore is registered. Downstream, the shared
restart/netns/lease machinery runs with A-point expectations: the old
epoch never saw the request; after the DEFAULT lease expires,
`go_reconcile_generation` takes its `REQUEUE_NO_INTENT` branch, a FRESH
attempt runs on the new epoch and the ORIGINAL gid recovers to COMPLETED
(not FAILED_FINAL); the recovered DB state is fixed read-only first
(exactly one SUCCEEDED attempt, generation COMPLETED with the assistant
message committed, work_item DONE, no PENDING/CLAIMED) together with the
new-epoch provider settled at exactly one recovery STREAM request
(two total requests, including the non-streaming call) BEFORE the
health control; `s8-verify --s8-expect completed` then re-checks the
public view (the original gid's own snapshot COMPLETED, post-terminal
`chat.completed`, exactly one assistant message before the control) and
ONE independent health-control generation must complete while the
original STILL reads COMPLETED (assistant 1 → 2); the new-epoch provider
ends at exactly 2 streams / 2 completed / 0 aborted / 0 active. The
mid-stream and SUCCEEDED-before-finalize crash points stay outside this
probe. The single Root-approved real run of this A-point chain has since
completed on the production-derived TLS stack (VC-R149, trial
vcr149-mvkwdc27, HTTPS 18460, rc 0, 346.89 s): the crash gates held
exactly as specified, the default-lease recovery took the
REQUEUE_NO_INTENT branch and the ORIGINAL gid recovered to COMPLETED
through one fresh SUCCEEDED attempt, and the receipts/cleanup contract
verified — recorded in `docs/planning/g12-go-capacity-sample.md` §18
(FUNCTIONAL_ONLY, no performance conclusion).

```bash
bash scripts/measure/g12-go-capacity/run.sh                 # full profile (s4, s3, s6, s9, s5, s10, soak)
bash scripts/measure/g12-go-capacity/run.sh --probe         # FUNCTIONAL_ONLY wiring proof (s4 branch)
bash scripts/measure/g12-go-capacity/run.sh --probe-s3      # FUNCTIONAL_ONLY wiring proof (s3 branch)
bash scripts/measure/g12-go-capacity/run.sh --probe-s6      # FUNCTIONAL_ONLY wiring proof (s6 branch)
bash scripts/measure/g12-go-capacity/run.sh --probe-s9      # FUNCTIONAL_ONLY public auth/session concurrency
bash scripts/measure/g12-go-capacity/run.sh --probe-s8      # FUNCTIONAL_ONLY worker-crash mid-stream recovery (VC-R140)
bash scripts/measure/g12-go-capacity/run.sh --probe-s8-before-finalize  # FUNCTIONAL_ONLY SUCCEEDED-before-finalize crash recovery (VC-R145)
bash scripts/measure/g12-go-capacity/run.sh --probe-s8-before-attempt   # FUNCTIONAL_ONLY claim-before-intent crash recovery (VC-R148; one real run completed, VC-R149)
python3 scripts/measure/g12-go-capacity/test_collector.py   # render/collect/aggregation units
python3 scripts/measure/g12-go-capacity/test_resources.py   # resource-ownership units (stubbed docker)
python3 scripts/measure/g12-go-capacity/test_workload.py    # SSE parser/first-delta/quiet-window/s6/s9 units
python3 scripts/measure/g12-go-capacity/test_s8_finalize_crash.py  # before-finalize/before-attempt crash helper units (faked docker/psql)
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
`--probe-s8` runs only the S8 single-crash-point chain described above
(collectors/sampler/idle/warm-up skipped before launch) with the same
preflight, TLS, seeding and ownership cleanup; it runs no other scenario
and no full profile. `--probe-s8-before-finalize` runs only the second S8
single-crash-point chain described above under the same bound (the same
skips, preflight, TLS, seeding and ownership cleanup; `G12_PROBE_S8_*`
knobs shared with `--probe-s8`). `--probe-s8-before-attempt` runs only
the third S8 single-crash-point chain described above under the same
bound (the same skips, preflight, TLS, seeding and ownership cleanup;
`G12_PROBE_S8_RECOVERY_TIMEOUT` shared, but the deltaMs widen knob is
unused — the A point never widens deltaMs).

Optional env:

| variable | default | meaning |
|---|---|---|
| `G12_GENS_S5` / `G12_SSE_S5` | 4 / 2 | scenario 5 shape |
| `G12_GENS_S10` / `G12_SSE_S10` | 16 / 4 | scenario 10 shape (SSE cap 8/gen) |
| `G12_S3_HOLD_MS` / `G12_S3_QUIET_MS` | 8000 / 3000 | scenario 3 provider hold and quiet-window budget (probe-s3 uses `G12_PROBE_S3_HOLD_MS` / `G12_PROBE_S3_QUIET_MS`, default 6000 / 2000) |
| `G12_S6_DELTA_MS` | 400 | scenario 6 widened provider deltaMs so a stream is still in flight after the first live delta (probe-s6 uses `G12_PROBE_S6_DELTA_MS`, default 400; restored to the original value on every exit path) |
| `G12_PROBE_S8_DELTA_MS` / `G12_PROBE_S8_RECOVERY_TIMEOUT` | 3000 / 360 | probe-s8 / probe-s8-before-finalize widened provider deltaMs (default 8 chunks × 3 s keeps the stream — and its CREATED attempt — in flight well past the serial kill-window gates, including the helper's acquire-while-CREATED lock; set via the existing bounded `PUT /g12/config` deltaMs knob, restored to the original value on every exit path) and the verify phase's absolute recovery budget in seconds — sized for the DEFAULT claim lease (270 s) plus the recovery tick; never a shortened lease or DB clock. probe-s8-before-attempt shares the recovery budget knob but never applies the deltaMs widen (the crash happens before any provider call) |
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
`probe-s9.summary.json`; probe-s8: `probe-s8.summary.json`;
probe-s8-before-finalize: `probe-s8-before-finalize.summary.json`;
probe-s8-before-attempt: `probe-s8-before-attempt.summary.json` — all
marked `FUNCTIONAL_ONLY`), scenario result/summary and B-analysis JSON (s4's
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

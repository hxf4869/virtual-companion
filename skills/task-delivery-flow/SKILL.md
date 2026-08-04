---
name: task-delivery-flow
description: Execute one governed repository task or coordinate a strictly serial Backlog longline. Use for task intake, candidate freeze, bounded independent review, exact-tree channel validation, atomic closure, or advancing fresh visible cards only after the previous card is verified.
---

# Task Delivery Flow

## Read the contract

1. Read `AGENTS.md`, project state, Task Ledger, Backlog, the current task card,
   and its Context Lock.
2. Resolve this Skill from `.harness/skills.yaml`.
3. Read `.harness/task-delivery-policy.yaml` and its single
   `.harness/ci-execution-policy.yaml` validation-channel source. Treat their
   modes, thresholds, frozen profiles, candidate identity, and failure
   semantics as authoritative.
4. Treat `.harness/task-lifecycle.yaml` as the only lifecycle source. The
   policy's `happyPath` is a delivery route, not another state machine.
5. Stop as BLOCKED if the policy, mode, task authority, or required field is
   missing or ambiguous.

## Run a single card

1. Evaluate `complexityGate` before READY and split when the policy requires it.
2. Use `task-intake` for the idle DRAFT, READY authorization, and the declared
   planning-only resolution or terminal-closure exceptions.
3. Read every Skill and approval required by the task and protected-path rules.
4. Enter IN_PROGRESS and run only the current `validation.sequence` stage.
   Iteration uses the bounded targeted checks; it does not consume canonical or
   exact-tree validation channel.
5. For an ordinary card, use `python scripts/harness/precheck.py --task
   TASK-ID` as the canonical command. A wrapper is never an Evidence, receipt,
   or PASS alias. A task that freezes wrapper argv executes and records that
   wrapper as the actual command; freezing does not convert the wrapper into
   the Python canonical command.
6. Stage the exact candidate, record its Commit and Tree, and account for every
   `candidateIdentity.requiredInputs` item. Unknown or changed identity follows
   `unknownOrChanged`; it never inherits PASS.
7. Apply the policy's risk and protected-rule review requirements. R1 covers
   the complete matrix. If blocking findings exist, use at most the allowed
   repair batch and limit R2 to finding closure, delta, adjacent risk, and new
   P0/P1.
8. After Reviewer PASS, run the candidate canonical once and use the READY-
   frozen exact-tree validation channel. Remote exact-SHA is the default.
   A local fallback requires the policy's strong typed unavailability and
   Owner authorization, and its PASS is limited to recorded platforms,
   toolchains, and commands.
9. Produce Evidence and Handoff, stage the closure exactly, run pre-closure,
   create the single-parent terminal commit, push, and reverify remote state.

## TASK-0072 exact one-time self-bootstrap

- The only maintenance boundary exception is record
  `OWNER-MAINT-20260801-READY-GREENLINE-01` for `TASK-0072`.
- Accept it only when the machine policy and Doctor bind the exact single-parent
  chain `a737f223` -> `9725e740` -> `60b09ec` -> boundary, including every
  commit, tree, changed path, Git mode/type, blob identity, and content hash.
- The boundary must directly parent the TASK-0072 DRAFT. After that DRAFT,
  ordinary READY, IN_PROGRESS, IN_REVIEW, and terminal checkpoint rules apply.
- Any other task, a copied record, a second consumption, an extra commit or
  path, or any changed field fails closed. Once TASK-0072 is in the
  Task Ledger, the anchor is consumed and inert except for verifying its
  immutable historical provenance.
- This is not a break-glass mechanism. No environment variable, CLI flag,
  Git note, replace, graft, history rewrite, configurable allowlist, or
  generalized override is authorized.

## TASK-0073 exact one-time pre-READY maintenance

- The only post-DRAFT, pre-READY maintenance record is
  `OWNER-MAINT-20260802-TASK-0073-PRE-READY-01` for `TASK-0073`.
- Accept exactly one direct single-parent child of the frozen TASK-0073 DRAFT.
  Bind Base, DRAFT parent, the derived boundary Commit and Tree, every changed
  path, Git mode/type, blob identity, content hash, and exact Owner evidence.
- The boundary may only repair the task-delivery-policy canonical hash, make
  the consumed TASK-0072 record validate its immutable historical Doctor blob,
  and register the exact policy, tests, and Skill contract needed for that
  bootstrap. Ordinary READY authorization and a real READY Doctor PASS remain
  mandatory before implementation.
- Any other task, copied record, second consumption, extra commit or path,
  current-worktree substitution for the TASK-0072 historical blob, or changed
  identity fails closed. After READY authorization, the record is inert except
  for immutable provenance validation.
- This is not a general maintenance interface. No environment variable, CLI
  flag, Git note, replace, graft, history rewrite, configurable allowlist, or
  generalized override is authorized.

## TASK-0074 exact one-time delivery-flow recovery

- The only TASK-0074 pre-READY maintenance record is
  `OWNER-MAINT-20260802-TASK-0074-PRE-READY-01`. Accept exactly one direct
  single-parent child of the frozen TASK-0074 DRAFT and bind its Base, DRAFT,
  derived Commit and Tree, frozen path set, mode/type/blob/content identities,
  and exact Owner authorization.
- Quarantine only the fixed TASK-0073 terminal Commit and Tree, Evidence and
  Review blobs and hashes, and exact Reviewer command/reason/native-UNKNOWN
  tuple as immutable historical non-PASS. A copied tuple, changed identity, or
  second record fails closed and never changes TASK-0073 from REJECTED.
- Future Evidence and Handoff may use strongly typed `TIMEOUT` or `UNKNOWN`.
  They require null exit/artifact, a truthful reason, candidate Commit and
  Tree, budget, and interruption observation. `FAIL` still requires a real
  non-zero exit code, and `PASS` still requires a real terminal success.
- Record overall elapsed time without reanchoring. Time DRAFT through the READY
  Doctor terminal result separately from candidate execution, which starts
  only after both READY Doctor PASS and the IN_PROGRESS commit. Closure-only
  overrun never permits implementation.
- The only combined gate is TASK-0074 with the READY-frozen
  `HARNESS_PORTABILITY_LOCAL` profile. On one clean candidate and one Windows
  durable receipt, execute the complete profile and every canonical subcommand
  exactly once; this satisfies candidate canonical and Windows exact-tree.
  It is not an alias, cache, or skip. WSL remains an independent later run,
  ordinary cards retain independent canonical, and results cannot downgrade
  the profile.
- Use one `fork_turns=none` Reviewer with a 15-minute maximum. Missing terminal
  output is `TIMEOUT` or `UNKNOWN`, not an invented `FAIL`; stop later gates.
  Ordinary READY authorization and a real READY Doctor PASS remain mandatory.

## TASK-0075 exact permanent delivery-flow recovery

- The only TASK-0075 pre-READY maintenance record is
  `OWNER-MAINT-20260803-TASK-0075-PRE-READY-01`. Accept exactly one direct
  single-parent child of DRAFT
  `2289d7a243d8a7658d11036afe6d338e0868cc8e`, with the frozen 11 exact
  paths and derived Commit/Tree plus per-path mode/type/blob/content identity.
  Bind both the complete Owner authorization plan and the separate acceptance
  `exactOwnerAcceptance` statement in the bound authorization payload.
- Validate TASK-0073 historical CI projection only from maintenance commit
  `b1c37678ab773eca150bdbb273ddafa5d14b781f` and its own Policy Blob.
  Validate planning repair only from the exact historical parent edge
  `d6fbee26442a997b96648eea472f98ecba1a5412..11e6fb12f77486787ef71627e84f34ee069e72bd`
  and the objects stored in those two commits. Current Policy must never
  reinterpret either historical contract.
- Quarantine only TASK-0074 terminal commit
  `d41c9f82e69107cf1ecf0cb2c100d39f436faab7`, its exact Tree, five bound
  artifacts, failed READY/pre-closure receipts, and exact ten-error tuple.
  TASK-0074 remains REJECTED; copied, changed, or second records fail closed.
- Future `candidateExecution` may be `NOT_STARTED` only after a non-PASS READY
  Doctor and only when READY never passed and no IN_PROGRESS commit or
  candidate freeze exists. Its candidate/time anchors are null,
  `elapsedSeconds=0`, `closureOnlyOverrunSeconds=0`, reason is nonblank, and
  reanchoring is forbidden. It is non-PASS, not FAIL/TIMEOUT/UNKNOWN/PASS.
  Existing PASS/FAIL/TIMEOUT/UNKNOWN candidate identity, budget, terminal
  result, and exit-code rules remain unchanged.
- A future terminal Handoff `nextAction` must equal the same terminal
  project-state value byte-for-byte. Only the exact immutable TASK-0074
  historical mismatch is quarantined.
- After an ordinary READY Doctor PASS, migrate TASK-0056 Card, Backlog
  dependency, and delivery-policy core atomically to TASK-0075. Then use one
  read-only `fork_turns=none` Reviewer with a 15-minute maximum, one complete
  Windows combined canonical/exact-tree durable gate, and one subsequent
  independent Ubuntu-24.04 exact-tree run on the same clean candidate.
  Remote remains `UNKNOWN_NOT_RUN / OWNER_QUOTA_EVIDENCE_EXPIRED /
  dispatch=0 / passClaimed=false`.
## TASK-0076 skill version binding recovery

- Record OWNER-MAINT-20260804-TASK-0076-PRE-READY-01, 9 paths.
- Unify harness-change 1.1.5, task-intake 1.2.5, task-delivery-flow 1.3.5.

## TASK-0077 permanent harness recovery and quarantine

- Record OWNER-MAINT-20260805-TASK-0077-PRE-READY-01, 10 paths.
- Quarantine TASK-0076 REJECTED history: fixed chain, fixed forbidden edge.
- Isolate TASK-0071/0073 historical parent edges by object identity.
- Recover TASK-0056 dependency to TASK-0077 with synchronized hash.
- Increase harness-change 1.1.6, task-intake 1.2.6, task-delivery-flow 1.3.6.

## Run a longline

1. Derive order, dependencies, and hard decision gates only from
   `.harness/task-backlog.yaml`. Do not create a parallel plan.
2. Coordinate exactly one fresh visible card at a time. Each card runs the
   complete `single-card` flow.
3. Before a normal dependent card starts, satisfy every
   `modes.longline.nextCardRequires` item. The predecessor must be ACCEPTED,
   pushed, handed off, remotely reverified, and backed by the required exact-
   tree validation channel.
4. Never release a normal dependency from REJECTED or SUPERSEDED.
5. An evidenced BLOCKED card blocks only its dependency descendants. Continue
   another independent promotable card. Pause only when no card is promotable
   or the remaining frontier is Owner-gated.

## Preserve validation and review integrity

- For every Doctor, candidate canonical, or pre-closure command expected to
  exceed 60 seconds, prefer a direct persistent session or PTY from launch.
  If that tool surface is unavailable on Windows, first run a no-side-effect
  exit-7 smoke, then launch exactly once through
  `scripts/harness/durable_command.ps1 -Mode Launch -RequestPath <absolute-json>`.
  The helper requires PowerShell 7 and exact JSON argv; PowerShell 5.1 and
  unsupported platforms never fall back silently.
- With durable transport, poll only whether `receipt.json` exists about every
  60 seconds. Do not inspect PID/process/status or tail logs. After atomic
  publication, read the receipt and complete stdout/stderr once. A missing,
  invalid, or identity-mismatched receipt is `UNKNOWN`, never PASS, and the
  command is not repeated.
- The helper's receipt is transport evidence only. The real inner exit code and
  complete output determine the registered command result.
- Reuse means not dispatching an identical check again. Preserve its one real
  result and never invent a `REUSED` PASS.
- Keep failure, cancellation, timeout, NOT_RUN, UNKNOWN, and
  DEFERRED_NOT_CLAIMED as non-PASS.
- Record strongly typed TIMEOUT/UNKNOWN with candidate Commit and Tree, budget,
  interruption observation, and truthful reason. Never use FAIL to stand in
  for missing Reviewer or command output.
- Do not present another Commit, Tree, platform, execution, or pre-closure
  result as the current exact-tree PASS.
- Freeze the validation profile before READY. Never downgrade it from results.
  A local result binds clean Commit and Tree, exact argv, OS, interpreter,
  toolchain, dependencies, environment, output hashes, and receipt hash.
- Use TERMINAL_METADATA_ONLY only after a verified implementation candidate or
  for REJECTED closure. Require an unchanged implementation-tree projection
  and `[skip ci]`; it never represents CI PASS.
- Keep C1/C2 review conditional unless the task or a protected rule requires
  more. Keep C3/C4 independent review mandatory.
- Leave idle checkpoint core, its four consumers, performance work, path-aware
  CI, and snapshot receipts to the follow-up tasks registered by the policy.

## Fail closed

- Stop promotion on Context, approval, Skill, allowlist, candidate identity,
  Reviewer, canonical, CI, or remote verification failure.
- At `hardFuseWallMinutes`, stop implementation, fixes, Reviewer work,
  canonical validation, and CI. If the repository is still active or
  half-closed, allow only a minimal closure-only overrun for Evidence/Handoff,
  pre-closure, the terminal commit, push, and remote `0/0` verification. Record
  overrun duration and root cause separately, and perform no implementation
  during the overrun.
- Stop at every other policy budget, round, or structural-finding fuse.
- Do not start a third review, add an unbounded fix loop, delete tests, add
  skips, expand timeouts, or weaken policy for the current task.

## Evidence checklist

- [ ] Mode, policy source, lifecycle source, and Skill version are explicit.
- [ ] Base, Context, approval, write scope, and protected rules are valid.
- [ ] Candidate Commit, Tree, and complete identity are recorded.
- [ ] R1 and any allowed R2 are tied to the candidate and delta.
- [ ] Canonical and the frozen exact-tree channel bind the implementation
      Commit and Tree; NOT_RUN/deferred coverage remains explicit.
- [ ] Pre-closure, terminal commit, Handoff, push, and remote state are verified.

---
name: task-delivery-flow
description: Execute one governed repository task or coordinate a strictly serial Backlog longline. Use for task intake, candidate freeze, bounded independent review, exact-SHA validation, atomic closure, or advancing fresh visible cards only after the previous card is remotely verified.
---

# Task Delivery Flow

## Read the contract

1. Read `AGENTS.md`, project state, Task Ledger, Backlog, the current task card,
   and its Context Lock.
2. Resolve this Skill from `.harness/skills.yaml`.
3. Read `.harness/task-delivery-policy.yaml`. Treat its modes, thresholds,
   sequence, candidate identity, and failure semantics as authoritative.
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
   exact-SHA CI.
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
8. After Reviewer PASS, run the candidate canonical once and require exact-SHA
   CI for the same implementation SHA.
9. Produce Evidence and Handoff, stage the closure exactly, run pre-closure,
   create the single-parent terminal commit, push, and reverify remote state.

## Run a longline

1. Derive order, dependencies, and hard decision gates only from
   `.harness/task-backlog.yaml`. Do not create a parallel plan.
2. Coordinate exactly one fresh visible card at a time. Each card runs the
   complete `single-card` flow.
3. Before a normal dependent card starts, satisfy every
   `modes.longline.nextCardRequires` item. The predecessor must be ACCEPTED,
   pushed, handed off, remotely reverified, and backed by exact-SHA CI.
4. Never release a normal dependency from REJECTED or SUPERSEDED.
5. An evidenced BLOCKED card blocks only its dependency descendants. Continue
   another independent promotable card. Pause only when no card is promotable
   or the remaining frontier is Owner-gated.

## Preserve validation and review integrity

- For every Doctor, candidate canonical, or pre-closure command expected to
  exceed 60 seconds, start a persistent session or PTY before launching it. An
  outer tool yield or timeout may yield control only; it must preserve the same
  process, stdout, and real exit code. Never start a duplicate process, add
  parallel `status` or `ps` checks, or fetch the same log again. If transport
  loses the exit code, record `NOT_RUN` or `UNKNOWN`, never PASS.
- Poll that same process about every 60 seconds by default. Polling observes
  status only and never triggers another check.
- Reuse means not dispatching an identical check again. Preserve its one real
  result and never invent a `REUSED` PASS.
- Keep failure, cancellation, timeout, and NOT_RUN as non-PASS.
- Do not present another SHA, platform, execution, or pre-closure result as the
  current exact-SHA PASS.
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
- [ ] Canonical and five CI jobs bind the exact implementation SHA.
- [ ] Pre-closure, terminal commit, Handoff, push, and remote state are verified.

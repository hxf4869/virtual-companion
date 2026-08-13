# TASK-0189：恢复 canonical greenline（post-terminal tail acceptance + legacy reviewers compatibility）

```yaml
taskId: TASK-0189
state: READY
owner: repository-owner
riskClass: C4
requiredSkills:
  - task-delivery-flow
  - task-intake
  - harness-change
requiredSkillVersions:
  task-delivery-flow: "1.3.7"
  task-intake: "1.2.7"
  harness-change: "1.1.7"
targetSkillVersions: {}
planningBacklog: null
planningContractHash: null
planningContractHashAlgorithm: null
baseCommit: c6260059f09cd69595a70aee7ef39de45e99ca78
authorizationCommit: 39d8144569a602b5471fec066c5fdfb0b997b13d
contextFingerprint: 5c145bf85c90965ac61d95047fb8f8009c5d2521d3bfc3ccc390031cd7410907
contextLock: docs/tasks/context/TASK-0189.context-lock.yaml
contextFingerprintAlgorithm: SHA256_ORDINAL_SORTED_PATH_EQUALS_HASH_LF_V1
deliveryMode: single-card
deliveryBudgets:
  schemaVersion: 2
  candidateDeadlineMinutes: 45
  targetWallMinutes: 60
  hardFuseWallMinutes: 90
  maximumFixBatches: 1
  maximumReviewRounds: 2
  r3Forbidden: true
  overallElapsed: {anchor: DRAFT_COMMIT, terminal: TERMINAL_COMMIT, recordingRequired: true, resetOrReanchorForbidden: true}
  intakeActivation: {anchor: DRAFT_COMMIT, terminal: READY_DOCTOR_TERMINAL, targetWallMinutes: 60, hardFuseWallMinutes: 90, timeoutStatus: TIMEOUT, closureOnlyOverrun: true}
  candidateExecution: {anchor: READY_DOCTOR_PASS_AND_IN_PROGRESS_COMMIT, notStartedOutcome: NOT_STARTED, notStartedEligibility: {readyDoctorNonPassRequired: true, readyDoctorPassForbidden: true, inProgressCommitForbidden: true, candidateFreezeForbidden: true}, candidateDeadlineMinutes: 45, targetWallMinutes: 60, hardFuseWallMinutes: 90, timeoutStatus: TIMEOUT, closureOnlyOverrun: true}
  reviewer: {maximumMinutes: 15, timeoutStatus: TIMEOUT, missingTerminalStatus: UNKNOWN}
complexityAssessment:
  policySource: .harness/task-delivery-policy.yaml
  evaluatedBefore: READY
  riskClass: C4
  surfaceId: TASK_0189_CANONICAL_GREENLINE_RESTORE
  policySurfaces: [AUTHORIZATION]
  distinctCrossRiskSurfaces: 1
  reviewerMinutesEstimate: 15
  terminalCheckMinutesEstimate: 20
  estimatedWallMinutes: 80
  thresholdsTriggered: []
  splitRequired: false
  ownerIndivisibleAuthorization: true
  indivisibleReason: >-
    Owner 只授权一条精确一次性恢复链：唯一 pre-READY maintenance 边（6 个冻结
    路径）先建立 task0189PostTerminalTail 机器记录并接受 7f9f9e3→c626005 尾部锚
    （baseCommit=c626005），同时实现严格限定的 legacy reviewers compatibility
    （仅终态 C1/C2 且 independentReview: not-required 允许缺省 reviewers），随后
    同一张卡才能以 baseCommit=c626005 通过普通 READY 门禁并恢复 canonical
    greenline；拆分会留下无法通过 base-anchor 校验的半卡。
preReadyMaintenancePlan:
  recordId: OWNER-MAINT-20260813-TASK-0189-POST-TERMINAL-TAIL-01
  recordPath: docs/evidence/TASK-0189/pre-ready-maintenance-authorization.json
  kind: OWNER_AUTHORIZED_EXACT_ONE_TIME_POST_TERMINAL_TAIL_ACCEPTANCE
  directSingleParentFromDraftRequired: true
  pathSetFrozenAtDraft: true
  additionsOrRemovalsForbidden: true
  oneTimeOnly: true
  reusable: false
  consumedRecordMustBecomeInert: true
  exactPaths:
    - .harness/ci-execution-policy.yaml
    - docs/evidence/TASK-0189/pre-ready-maintenance-authorization.json
    - scripts/harness/doctor.py
    - scripts/harness/tests/test_harness.py
    - skills/task-delivery-flow/SKILL.md
    - skills/task-intake/SKILL.md
validationPlan: {frozenBefore: READY, policySource: .harness/ci-execution-policy.yaml, selectedChannel: LOCAL_EXACT_TREE_FALLBACK, profile: precheck}
readAllowlist:
  - .gitattributes
  - AGENTS.md
  - CLAUDE.md
  - requirements-harness.txt
  - .harness/agent-entrypoints.yaml
  - .harness/ci-execution-policy.yaml
  - .harness/commands.yaml
  - .harness/invariants.yaml
  - .harness/license-policy.yaml
  - .harness/paid-feature-denylist.yaml
  - .harness/phase-scope.yaml
  - .harness/project-state.yaml
  - .harness/protected-paths.yaml
  - .harness/skills.yaml
  - .harness/sources-of-truth.yaml
  - .harness/task-backlog.yaml
  - .harness/task-delivery-policy.yaml
  - .harness/task-ledger.yaml
  - .harness/task-lifecycle.yaml
  - .harness/tools.lock.yaml
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
  - docs/tasks/task-card-template.md
  - docs/tasks/TASK-0098-generation-finalization-terminal-concurrency.md
  - docs/tasks/context/TASK-0098.context-lock.yaml
  - docs/evidence/TASK-0098/pre-ready-maintenance-authorization.json
  - docs/tasks/TASK-0185-h5-realtime-transport-contract-align.md
  - docs/tasks/TASK-0186-h5-chat-send-flow-history-api.md
  - docs/tasks/TASK-0187-relationship-selector-ui.md
  - docs/evidence/TASK-0187/evidence-pack.json
  - docs/handoffs/TASK-0187.json
  - skills/task-intake/SKILL.md
  - skills/task-delivery-flow/SKILL.md
  - skills/harness-change/SKILL.md
  - scripts/harness/doctor.py
  - scripts/harness/tests/test_harness.py
writeAllowlist:
  - docs/tasks/TASK-0189-canonical-greenline-restore.md
  - docs/tasks/context/TASK-0189.context-lock.yaml
  - docs/evidence/TASK-0189/**
  - docs/handoffs/TASK-0189.json
  - .harness/ci-execution-policy.yaml
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - scripts/harness/doctor.py
  - scripts/harness/tests/test_harness.py
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
forbiddenPaths:
  - .github/**
  - ci/**
  - service/**
  - frontend/**
  - infra/**
  - scripts/dev/**
  - scripts/harness/catalog_tool.py
  - scripts/harness/check_beta_gate.py
  - scripts/harness/check_paid_features.py
  - scripts/harness/durable_command.ps1
  - scripts/harness/harness_common.py
  - scripts/harness/precheck.ps1
  - scripts/harness/precheck.py
  - scripts/harness/precheck.sh
  - skills/catalog-change/SKILL.md
  - skills/contract-change/SKILL.md
  - skills/database-migration/SKILL.md
  - skills/memory-change/SKILL.md
  - skills/model-routing-change/SKILL.md
  - skills/safety-change/SKILL.md
  - skills/harness-change/SKILL.md
  - .harness/agent-entrypoints.yaml
  - .harness/commands.yaml
  - .harness/invariants.yaml
  - .harness/license-policy.yaml
  - .harness/paid-feature-denylist.yaml
  - .harness/phase-scope.yaml
  - .harness/protected-paths.yaml
  - .harness/sources-of-truth.yaml
  - .harness/task-backlog.yaml
  - .harness/task-delivery-policy.yaml
  - .harness/task-lifecycle.yaml
  - .harness/tools.lock.yaml
  - docs/decisions/**
  - docs/planning/**
  - docs/schemas/**
  - docs/source/**
  - docs/tasks/task-card-template.md
  - docs/tasks/TASK-0098-generation-finalization-terminal-concurrency.md
  - docs/tasks/context/TASK-0098.context-lock.yaml
  - docs/evidence/TASK-0098/**
  - docs/tasks/TASK-0185-h5-realtime-transport-contract-align.md
  - docs/tasks/TASK-0186-h5-chat-send-flow-history-api.md
  - docs/tasks/TASK-0187-relationship-selector-ui.md
  - docs/evidence/TASK-0187/**
  - docs/handoffs/TASK-0187.json
  - specs/**
  - mvnw
  - mvnw.cmd
  - pom.xml
sourcesOfTruth:
  - AGENTS.md
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - .harness/task-backlog.yaml
  - .harness/task-lifecycle.yaml
  - .harness/task-delivery-policy.yaml
  - .harness/ci-execution-policy.yaml
  - .harness/sources-of-truth.yaml
  - .harness/invariants.yaml
  - .harness/protected-paths.yaml
  - .harness/skills.yaml
  - .harness/commands.yaml
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
  - docs/tasks/TASK-0098-generation-finalization-terminal-concurrency.md
  - docs/tasks/context/TASK-0098.context-lock.yaml
  - docs/evidence/TASK-0098/pre-ready-maintenance-authorization.json
  - docs/tasks/TASK-0185-h5-realtime-transport-contract-align.md
  - docs/tasks/TASK-0186-h5-chat-send-flow-history-api.md
  - docs/tasks/TASK-0187-relationship-selector-ui.md
  - docs/evidence/TASK-0187/evidence-pack.json
  - docs/handoffs/TASK-0187.json
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
requiredInvariants:
  - INV-HARNESS-001
  - INV-HARNESS-002
  - INV-HARNESS-003
  - INV-HARNESS-005
  - INV-HARNESS-007
humanApprovals:
  - scope: harness-change
    approvedBy: repository-owner
    approvedAt: "2026-08-13"
    sourceThreadId: zcode-audit-20260813
    evidence: >-
      Owner 按 2026-08-13 审计交接决策正式授权 TASK-0189 恢复 canonical greenline：
      唯一 pre-READY maintenance 边（recordId OWNER-MAINT-20260813-TASK-0189-POST-TERMINAL-TAIL-01）
      机器绑定接受 7f9f9e3→c626005（TASK-0187 canonical terminal 后的 evidence/handoff
      headCommit 回填 metadata tail，仅改 docs/evidence/TASK-0187/evidence-pack.json 与
      docs/handoffs/TASK-0187.json）作为 DRAFT 锚（baseCommit=c626005）；同时实现严格
      限定的 legacy reviewers compatibility：仅终态（ACCEPTED/REJECTED/SUPERSEDED）C1/C2
      且 independentReview: not-required 的任务允许缺省 reviewers 字段，其余情况失败
      关闭；不得补写 TASK-0185/0186/0187 历史卡；维护边只允许 6 个冻结路径、一次性消费、
      不可复用、禁止历史改写/通用 override；authorizationCommit 占位（plan-approved-...）
      接受为不可逆死债并在 Evidence/Handoff 如实记录。
independentReview: required
reviewers: []
requiredCommands:
  - python scripts/harness/precheck.py --task TASK-0189
  - git diff --check
```

> 本卡为独立延续单卡，不写 planningBacklog/planningContractHash；ID 已核对未占用（ledger 最新 TASK-0187）。`preReadyMaintenancePlan.exactPaths` 与任务卡 `writeAllowlist` 的 maintenance 路径、ci-execution-policy record `boundary.changedPaths` 三处原子一致（6 个冻结路径）。TASK-0185/0186/0187 历史卡（含其 authorizationCommit 占位）一律不改。

## 背景与用户可观察目标

main 分支当前 `doctor --summary` / `doctor --task` 均为 **FAIL（3 errors）**：TASK-0185/0186/0187
任务卡缺必填字段 `reviewers`（其按 2026-08-13 Owner 策略压缩交付：单提交直跳 ACCEPTED、
`authorizationCommit` 为占位字符串、doctor/precheck 记录为 NOT_RUN）。同时 TASK-0187 的
post-terminal metadata tail `7f9f9e3→c626005`（仅回填 evidence/handoff 的 `headCommit` 占位）
不属于 verifier 接受的 canonical terminal boundary 或 idle planning checkpoint，导致任何以
`c626005` 为 Base 的正规新卡无法通过 READY Doctor。本卡通过唯一一次性 maintenance 边：
(a) 机器绑定接受该 tail 作为 TASK-0189 DRAFT 锚；(b) 实现严格限定的 legacy reviewers
compatibility，使历史 C1/C2 压缩交付卡不再产生 schema error，恢复 canonical greenline，
让后续正规新卡（含业务修复卡）可以正常开卡与推进。

## 范围内

- 新增 `task0189PostTerminalTail` 机器记录（`ci-execution-policy.yaml`），一次性精确绑定
  `7f9f9e3→c626005` 的 commit/tree/parent/精确路径/逐文件 blob·mode·type·content（headCommit
  占位 `0000…` → 真实 `7f9f9e3…` 回填语义）。
- `doctor.py`：新增 TASK-0189 常量与 4 个 validator（record/boundary-candidate/boundary/
  card-contract），在 6 个既有调用点接入（READY-parent、base-handoff anchor、policy 循环、
  card-contract、第二 anchor、projection redact）；更新 `CI_EXECUTION_POLICY_CANONICAL_HASH`。
- `doctor.py`：新增严格限定 legacy reviewers compatibility——仅终态（ACCEPTED/REJECTED/
  SUPERSEDED）且 C1/C2 且 `independentReview: not-required` 的任务允许缺省 `reviewers` 字段，
  其余（含活动态、C3/C4、required、或显式非 not-required）一律保持失败关闭。
- `scripts/harness/tests/test_harness.py`：tail acceptance 正负测试 + legacy compatibility
  正负测试 + TASK-0098 回归。
- `skills/task-intake/SKILL.md`、`skills/task-delivery-flow/SKILL.md`：登记 TASK-0189 的
  post-terminal tail 特例条目（recordId、路径数、一次性、禁止复制/二次消费/泛化）。
- 终态产物：Evidence Pack + Handoff + task card + project-state + Task Ledger，ACCEPTED 闭合。

## 明确范围外

- **不补写** TASK-0185/0186/0187 历史卡（不新增 `reviewers` 字段、不改 `authorizationCommit`
  占位、不改任何历史产物）。
- 不修改任何业务代码、数据库迁移、前端、CI workflow、Backlog、lifecycle 或受保护的真源。
- 不修审计发现的任何业务问题（P0 owner context 及其他全部 P1/P2/P3）。
- 不做通用化 tail 规则或"治本 terminal 流程改造"（消除 tail 根因另议）。
- 不创建/不删除任何本地分支，不动 `codex/audit-20260813` 分支。
- 不改写 `7f9f9e3` 或 `c626005` 本身。

## 输入和前置条件

- Base Commit：`c6260059f09cd69595a70aee7ef39de45e99ca78`（TASK-0187 terminal metadata
  closure；唯一父 `7f9f9e3`）。
- Context Lock：`docs/tasks/context/TASK-0189.context-lock.yaml`（fingerprint
  `5c145bf8…`，36 inputs）。
- 已核验 tail 事实：`c626005` 唯一父 `7f9f9e3`；changedPaths 恰为
  `docs/evidence/TASK-0187/evidence-pack.json`、`docs/handoffs/TASK-0187.json`；每文件恰一行
  `headCommit: 0000…`→`7f9f9e3…`；terminal tree `a0b261b5…`、tail tree `88637890…`。
- 需使用 `harness-change`（C4 protected path）与 `task-intake`；本卡 requiredSkillVersions
  固定 Base 上实际存在的版本。

## API / 事件 / 数据契约

- `ci-execution-policy.yaml` 新增顶层 `task0189PostTerminalTail:` record，schema 对标
  `task0098PostTerminalTail` 但 tail 语义为 headCommit 回填（非 project-state nextAction）。
- `doctor.py` 的 `ci_execution_policy_projection` redact 列表新增
  `"task0189PostTerminalTail"`，并同步更新 `CI_EXECUTION_POLICY_CANONICAL_HASH`。
- 不新增/修改任何 OpenAPI、catalog、contracts、events schema。

## 权限、RLS 和数据处理要求

- 不触数据库、不触 RLS、不触任何业务数据；仅修改治理/校验代码与文档。
- `scripts/harness/doctor.py`、`scripts/harness/tests/test_harness.py`、`skills/**` 为 C4
  protected paths（requiredSkill: harness-change，humanApproval: repository-owner，
  independentReview: required）——本卡已声明。

## 状态机和失败行为

- 一次性 maintenance 边消费后惰化；复制记录、二次消费、额外路径、任何身份漂移、泛化到其他
  tail 均失败关闭。
- legacy reviewers compatibility 严格限定：任何活动态/C3/C4/required 任务的 `reviewers`
  缺失必须仍为 error。
- 若 `CI_EXECUTION_POLICY_CANONICAL_HASH` 计算或维护边自校验失败，按维护边校验 FAIL 停止，
  不得以任何方式绕过。
- `authorizationCommit` 占位（0185/0186/0187）为不可逆死债：本卡不改，doctor 因非 SHA 跳过
  其 ancestry/base 校验，是既有行为，不作为本卡修复目标。

## 模型、Prompt、记忆和安全边界

- 不涉及模型、prompt、记忆或安全模块；仅治理校验器改动。

## 验收标准

1. **tail acceptance**：以 `c626005` 为 Base 的 TASK-0189 DRAFT，`doctor.py --task TASK-0189`
   READY Doctor 0 errors PASS（含 base-handoff 边界接受 tail）。
2. **legacy compatibility**：`doctor --summary` 不再报 TASK-0185/0186/0187 的 `reviewers`
   缺失 error；`doctor --task TASK-0189` 亦 0 errors。
3. **失败关闭**：负向测试证明——错误 terminal parent、tail 多/少路径、headCommit 回填错误
   SHA、record 字段漂移、复制 record、非 TASK-0189 任务用该 anchor、泛化到其他 tail 均 FAIL；
   活动态/C3/C4/required 任务缺 `reviewers` 仍 FAIL。
4. **TASK-0098 不回归**：既有 `task0098PostTerminalTail` 校验仍 PASS（定向 unittest 回归）。
5. **正负测试**：tail acceptance 与 legacy compatibility 各有正负测试，均在
   `scripts/harness/tests/test_harness.py` 新增。
6. **不碰历史卡**：`git diff` 中不含 `docs/tasks/TASK-0185*`、`TASK-0186*`、`TASK-0187*`
   （卡/evidence/handoff 均不改）。
7. **交付闭环**：canonical Precheck PASS（doctor 0 errors）；独立 Reviewer PASS；Handoff
   `nextAction` 与终态 project-state 逐字一致；origin/main `0/0`。

## 必跑检查

以 YAML `requiredCommands` 的精确 argv 为准：`python scripts/harness/precheck.py --task
TASK-0189` 与 `git diff --check`；每条记录状态、退出码、验证提交、产物哈希或无产物理由。

## 回滚或前向修复

- 若维护边校验失败，按 `task-delivery-flow` 的 fail-closed 停止，不降级/不绕过。
- 修复边界只允许对 writeAllowlist 内文件在 `maximumFixBatches: 1` 内修订，随后重跑
  doctor/precheck；超出即停止询问 Owner。

## 停止条件

- 需要修改 writeAllowlist 外路径（含任何历史卡、Backlog、lifecycle、业务代码）时立即停止
  询问 Owner。
- 任何把 NOT_RUN/失败/超时转为 PASS 的行为立即停止。
- Reviewer 未通过、canonical 未 PASS 时不得进入 terminal。

## Evidence Pack

输出到 `docs/evidence/TASK-0189/`（含 `review-r1.md`），并生成 `docs/handoffs/TASK-0189.json`。

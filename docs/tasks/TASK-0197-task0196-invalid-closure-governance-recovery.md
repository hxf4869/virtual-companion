# TASK-0197：TASK-0196 非法终态闭合治理恢复

```yaml
taskId: TASK-0197
state: DRAFT
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
baseCommit: 1c1dca2f423ea9935000189e86789201cb859832
authorizationCommit: ""
contextFingerprint: b4d806ce7e2d4a82a53f52d9f447a57b5834143b6afbaca135f85ec363d92905
contextLock: docs/tasks/context/TASK-0197.context-lock.yaml
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
  surfaceId: TASK_0197_TASK0196_INVALID_CLOSURE_GOVERNANCE_RECOVERY
  policySurfaces: [GOVERNANCE, AUTHORIZATION, HISTORY]
  distinctCrossRiskSurfaces: 3
  reviewerMinutesEstimate: 15
  terminalCheckMinutesEstimate: 20
  estimatedWallMinutes: 90
  thresholdsTriggered: [crossRiskSurfacesMinimumDistinct2, reviewerMinutesGreaterThan15, terminalCheckMinutesGreaterThan20, estimatedWallMinutesGreaterThan90]
  splitRecommended: true
  splitProposal: >-
    目标 1（1c1dca2 精确 quarantine）与目标 2-9（终态原子性、候选 SHA 覆盖、
    pre-closure receipt、READY 禁实现、fix-batch amendment、Skill 豁免收紧、
    terminal_commit=None 失败关闭）互为前提：没有 quarantine 的失败关闭会把
    当前仓库判死，没有失败关闭的 quarantine 会把违规终态合法化。拆卡会留下
    半卡。
  ownerIndivisibleAuthorization: true
  indivisibleReason: >-
    Owner 2026-08-15 接受独立审计 INVALID 结论，要求以 canonical task-intake
    建立后继治理卡：为 1c1dca2 建立只维持历史可验证性的 legacy-invalid-closure
    quarantine，同时修复导致该非法终态被 Doctor 放行的校验缺口。quarantine
    与失败关闭必须一次成卡，不得把 TASK-0196 追述为有效闭合。
legacyInvalidClosureQuarantine:
  recordId: OWNER-MAINT-20260815-TASK-0197-LEGACY-INVALID-CLOSURE-01
  recordPath: docs/evidence/TASK-0197/legacy-invalid-closure-quarantine.json
  kind: OWNER_AUTHORIZED_EXACT_ONE_TIME_LEGACY_INVALID_CLOSURE_QUARANTINE
  historicalVerifiabilityOnly: true
  doesNotLegitimizeInvalidClosure: true
  reusable: false
  oneTimeOnly: true
  copiedRecordForbidden: true
  secondConsumptionForbidden: true
  generalizedHistoricalExemptionForbidden: true
  predecessor:
    taskId: TASK-0196
    machineState: ACCEPTED
    historicalClosureValidity: INVALID
    successorRecoveryTask: TASK-0197
    rewriteOrRestateAsValidForbidden: true
  claimedCandidate:
    commit: 87cd40a2b59317015ce9a8aa55cda2d2fe686c91
    tree: 83deb6e913b47bd51cb07cdaf444d8b1afcbdeca
    parent: 353b1acd1ccffef3c3a502c6a0061461943316bc
    role: REVIEWER_AND_REQUIRED_COMMANDS_CLAIMED_CANDIDATE
    evidenceHeadCommit: 87cd40a2b59317015ce9a8aa55cda2d2fe686c91
    reviewerReviewedCommit: 87cd40a2b59317015ce9a8aa55cda2d2fe686c91
  actualTerminal:
    commit: 1c1dca2f423ea9935000189e86789201cb859832
    tree: 15fa2ef0d7fceda45fe7102fede24469313c9427
    parent: 87cd40a2b59317015ce9a8aa55cda2d2fe686c91
    singleParentRequired: true
    role: ACTUAL_LEDGER_INTRODUCTION_TERMINAL_ANCHOR
    mixedImplementationAndClosure: true
  readyStateImplementation:
    commit: 353b1acd1ccffef3c3a502c6a0061461943316bc
    tree: 77c378b749ac2eeff564b0b6976c57f097e695dc
    parent: 383e4032b3ad8cd7ae2fa0f028ac311b8c35cf78
    cardState: READY
    changedPaths:
      - scripts/harness/doctor.py
      - scripts/harness/tests/test_harness.py
  p0Findings:
    - id: P0-1
      title: 终态原子性违规
      statement: 1c1dca2 混合 doctor.py/test_harness.py 实现修改与终态闭合制品，违反终态只允许卡、project-state、ledger、Evidence、Handoff。
    - id: P0-2
      title: 候选身份违规
      statement: requiredCommands 与 C4 Reviewer 均绑定 87cd40a，未覆盖 1c1dca2 的实现变化。
    - id: P0-3
      title: pre-closure 缺失
      statement: 没有可核验的修复后 pre-closure receipt；Doctor 提交态 PASS 不能代替 pre-closure。
    - id: P0-4
      title: 授权违规
      statement: 第二修复批次无先提交的 Backlog 强类型 Owner amendment，且超过 maximumFixBatches=1；提交消息或聊天声明不构成授权。
  exactPaths:
    - .harness/project-state.yaml
    - .harness/task-ledger.yaml
    - docs/evidence/TASK-0196/evidence-pack.json
    - docs/evidence/TASK-0196/review-r1.md
    - docs/handoffs/TASK-0196.json
    - docs/tasks/TASK-0196-post-terminal-tail-doctor-fix.md
    - scripts/harness/doctor.py
    - scripts/harness/tests/test_harness.py
  files:
    - path: .harness/project-state.yaml
      mode: "100644"
      type: blob
      blob: 8bec7912ca22fd5b84ea503c42cf65d6682a6414
      contentSha256: 43fd74543240449bfdbc125598c2c706a7652e19da779e09a58c492b35afc9bc
    - path: .harness/task-ledger.yaml
      mode: "100644"
      type: blob
      blob: 1a44ec2430a5d7acd616a7a6a22f3167c3bc9573
      contentSha256: b360ddbfc69101dfd4b0d99249d2aa19850aac1716c9a9ad24a484c1c611514e
    - path: docs/evidence/TASK-0196/evidence-pack.json
      mode: "100644"
      type: blob
      blob: 2a09edab5b2298bf2bf86f12ab3272e7a471a036
      contentSha256: 5917ebd6e250fd059f02d46b12491ad106ad549b852de39156bf7cfd43dba446
    - path: docs/evidence/TASK-0196/review-r1.md
      mode: "100644"
      type: blob
      blob: 0cad34253717c75581b3db62f7c17f46fbc67990
      contentSha256: 9b2a8be3cd1cf0b964c9999bb32d0b7b2f474f99ff065ac8387cba21547510f1
    - path: docs/handoffs/TASK-0196.json
      mode: "100644"
      type: blob
      blob: f1485ecde9d7af763cd4c79b6ecda98fbfc82d6f
      contentSha256: 623935fb65f37f0d6e1d585e77d5c24af4b6a2b1d553b6a22684b3310caebb4a
    - path: docs/tasks/TASK-0196-post-terminal-tail-doctor-fix.md
      mode: "100644"
      type: blob
      blob: 82990b70e27f5923df799ccb4baf17bfc7c552fc
      contentSha256: b99e119417ea99f4ca18404c99e7667564aad6bd1f45ba1311770a212dada8e5
    - path: scripts/harness/doctor.py
      mode: "100644"
      type: blob
      blob: 3734b5e9c4445818025a55f988813b0df22f9e41
      contentSha256: b5a3f027f8934ea3d9f4ee31e1c9802c86bf708a3e30cde81eacb55a26e33951
    - path: scripts/harness/tests/test_harness.py
      mode: "100644"
      type: blob
      blob: ce8ece2070cffc81f6a9cf03194e41f53b8917c6
      contentSha256: 3ef12cdd024c481cf243ea3d9ee119d9f84cc9852cf2e1bea2898316aa84160d
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
  - .harness/license-inventory.yaml
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
  - docs/tasks/TASK-0141-p2-23-supply-chain-reproducibility.md
  - docs/tasks/context/TASK-0141.context-lock.yaml
  - docs/evidence/TASK-0141/evidence-pack.json
  - docs/handoffs/TASK-0141.json
  - docs/tasks/TASK-0189-canonical-greenline-restore.md
  - docs/tasks/context/TASK-0189.context-lock.yaml
  - docs/evidence/TASK-0189/pre-ready-maintenance-authorization.json
  - docs/tasks/TASK-0195-p1-worker-lease-fence-inherited-adoption.md
  - docs/tasks/context/TASK-0195.context-lock.yaml
  - docs/evidence/TASK-0195/evidence-pack.json
  - docs/handoffs/TASK-0195.json
  - docs/tasks/TASK-0196-post-terminal-tail-doctor-fix.md
  - docs/tasks/context/TASK-0196.context-lock.yaml
  - docs/evidence/TASK-0196/evidence-pack.json
  - docs/evidence/TASK-0196/review-r1.md
  - docs/evidence/TASK-0196/pre-ready-maintenance-authorization.json
  - docs/evidence/TASK-0196/pre-ready-maintenance-recovery-authorization.json
  - docs/evidence/TASK-0196/pre-ready-maintenance-completion-authorization.json
  - docs/handoffs/TASK-0196.json
  - skills/task-intake/SKILL.md
  - skills/task-delivery-flow/SKILL.md
  - skills/harness-change/SKILL.md
  - scripts/harness/doctor.py
  - scripts/harness/tests/test_harness.py
writeAllowlist:
  - docs/tasks/TASK-0197-task0196-invalid-closure-governance-recovery.md
  - docs/tasks/context/TASK-0197.context-lock.yaml
  - docs/evidence/TASK-0197/**
  - docs/handoffs/TASK-0197.json
  - .harness/ci-execution-policy.yaml
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - scripts/harness/doctor.py
  - scripts/harness/tests/test_harness.py
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
  - skills/**
  - .harness/agent-entrypoints.yaml
  - .harness/commands.yaml
  - .harness/invariants.yaml
  - .harness/license-inventory.yaml
  - .harness/license-policy.yaml
  - .harness/paid-feature-denylist.yaml
  - .harness/phase-scope.yaml
  - .harness/protected-paths.yaml
  - .harness/skills.yaml
  - .harness/sources-of-truth.yaml
  - .harness/task-backlog.yaml
  - .harness/task-delivery-policy.yaml
  - .harness/task-lifecycle.yaml
  - .harness/tools.lock.yaml
  - AGENTS.md
  - CLAUDE.md
  - .gitattributes
  - requirements-harness.txt
  - docs/decisions/**
  - docs/planning/**
  - docs/schemas/**
  - docs/source/**
  - docs/tasks/task-card-template.md
  - docs/tasks/TASK-0098-generation-finalization-terminal-concurrency.md
  - docs/tasks/context/TASK-0098.context-lock.yaml
  - docs/evidence/TASK-0098/**
  - docs/handoffs/TASK-0098.json
  - docs/tasks/TASK-0141-p2-23-supply-chain-reproducibility.md
  - docs/tasks/context/TASK-0141.context-lock.yaml
  - docs/evidence/TASK-0141/**
  - docs/handoffs/TASK-0141.json
  - docs/tasks/TASK-0189-canonical-greenline-restore.md
  - docs/tasks/context/TASK-0189.context-lock.yaml
  - docs/evidence/TASK-0189/**
  - docs/handoffs/TASK-0189.json
  - docs/tasks/TASK-0191-owner-context-rls-trust-model.md
  - docs/tasks/TASK-0192-harness-amendment-diffscope-recovery.md
  - docs/tasks/TASK-0193-p0-owner-context-rls-inherited-adoption.md
  - docs/tasks/TASK-0194-worker-lease-fence-transaction-boundary.md
  - docs/tasks/TASK-0195-p1-worker-lease-fence-inherited-adoption.md
  - docs/tasks/TASK-0196-post-terminal-tail-doctor-fix.md
  - docs/tasks/context/TASK-0191.context-lock.yaml
  - docs/tasks/context/TASK-0192.context-lock.yaml
  - docs/tasks/context/TASK-0193.context-lock.yaml
  - docs/tasks/context/TASK-0194.context-lock.yaml
  - docs/tasks/context/TASK-0195.context-lock.yaml
  - docs/tasks/context/TASK-0196.context-lock.yaml
  - docs/evidence/TASK-0191/**
  - docs/evidence/TASK-0192/**
  - docs/evidence/TASK-0193/**
  - docs/evidence/TASK-0194/**
  - docs/evidence/TASK-0195/**
  - docs/evidence/TASK-0196/**
  - docs/handoffs/TASK-0191.json
  - docs/handoffs/TASK-0192.json
  - docs/handoffs/TASK-0193.json
  - docs/handoffs/TASK-0194.json
  - docs/handoffs/TASK-0195.json
  - docs/handoffs/TASK-0196.json
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
  - scripts/harness/doctor.py
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
  - docs/tasks/TASK-0098-generation-finalization-terminal-concurrency.md
  - docs/tasks/context/TASK-0098.context-lock.yaml
  - docs/evidence/TASK-0098/pre-ready-maintenance-authorization.json
  - docs/tasks/TASK-0189-canonical-greenline-restore.md
  - docs/tasks/context/TASK-0189.context-lock.yaml
  - docs/evidence/TASK-0189/pre-ready-maintenance-authorization.json
  - docs/tasks/TASK-0195-p1-worker-lease-fence-inherited-adoption.md
  - docs/tasks/context/TASK-0195.context-lock.yaml
  - docs/evidence/TASK-0195/evidence-pack.json
  - docs/handoffs/TASK-0195.json
  - docs/tasks/TASK-0196-post-terminal-tail-doctor-fix.md
  - docs/tasks/context/TASK-0196.context-lock.yaml
  - docs/evidence/TASK-0196/evidence-pack.json
  - docs/handoffs/TASK-0196.json
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
    approvedAt: "2026-08-15"
    sourceThreadId: grok-main-20260815
    evidence: >-
      Owner 2026-08-15 指令：接手 TASK-0196 非法终态闭合后的治理恢复。当前只完成
      独立恢复、复核关键证据和新卡 DRAFT，不进入 READY、不修改 Harness。Owner
      接受独立审计 INVALID 结论并冻结六项事实：① 1c1dca2 混合 doctor.py/
      test_harness.py 实现修改与终态闭合制品，违反终态原子性；② requiredCommands
      与 C4 Reviewer 均绑定 87cd40a，未覆盖 1c1dca2 的实现变化；③ 没有可核验的
      修复后 pre-closure receipt；④ 第二修复批次无先提交的强类型 amendment，且
      超过 maximumFixBatches=1；⑤ task_record_bound_skill_paths 存在“卡内声明即
      豁免”旁路；⑥ terminal_commit=None 时 post-terminal validator 无条件 return。
      不得把当前 Doctor PASS 当作 TASK-0196 合法的证明。授权本 C4 harness-change
      卡在 Owner 审核进入 READY、再转入 IN_PROGRESS 后实施：ci-execution-policy.yaml
      精确 quarantine 记录 + doctor.py/test_harness.py 失败关闭修复。DRAFT 阶段只建
      卡与 Context Lock。当前 Doctor 为 PASS，原则上不得使用 pre-READY maintenance；
      若必须 pre-READY 修改 Harness，视为设计错误或新阻塞，停在 DRAFT。
  - scope: authorization
    approvedBy: repository-owner
    approvedAt: "2026-08-15"
    sourceThreadId: grok-main-20260815
    evidence: >-
      Owner 2026-08-15 授权建立一次性、不可复制、不可重放的
      legacy-invalid-closure/quarantine 记录（recordId
      OWNER-MAINT-20260815-TASK-0197-LEGACY-INVALID-CLOSURE-01），精确绑定
      TASK-0196、声称候选 87cd40a、实际 terminal 1c1dca2、父/tree、8 个精确路径
      及 mode/blob/content hash，并记录四项 P0。该记录只维持历史可验证性，不把
      违规终态合法化。TASK-0196 保持 ACCEPTED 机器状态，但必须在本卡中明确标记
      为“历史终态闭合无效、由后继治理卡恢复”，不得改写或追述为有效。TASK-0141
      继续作为 activation 前 legacy finding，不在本卡修改。TASK-0098/0189/0195
      已登记 tail 保持精确兼容，不提供通用历史豁免。
independentReview: required
reviewers: []
requiredCommands:
  - PATH=/Users/hxf/.zcode/venvs/vc-harness/bin:$PATH python scripts/harness/precheck.py --task TASK-0197
  - git diff --check
```

> 本卡为独立延续单卡，不写 planningBacklog/planningContractHash。永久 ID 由机器真源派生：
> Task Ledger 现存最大编号 TASK-0196（PERMANENT_NEVER_REUSE），仓库内无任何 TASK-0197
> 引用，下一顺序编号即 TASK-0197。TASK-0196 保持 ACCEPTED 机器状态，但其历史终态闭合
> 被 Owner 接受的独立审计判定为 INVALID；本卡不得改写或追述该闭合为有效。
> 当前 Doctor PASS（2026-08-15，`doctor.py --summary` exit 0 / 1137636 checks）只证明
> 当前仓库可检查，不是 TASK-0196 合法终态的证明。本卡不使用 pre-READY maintenance。

## 背景与用户可观察目标

TASK-0196 于 `1c1dca2` 以 ACCEPTED 写入 Task Ledger，成为当前 lastAccepted/lastTerminal。
独立审计（Owner 2026-08-15 接受，结论 INVALID）证明该闭合不合法：

1. `1c1dca2` 的 8 个路径同时包含实现修改（`scripts/harness/doctor.py`、
   `scripts/harness/tests/test_harness.py`）与终态制品（卡、project-state、ledger、
   Evidence、Handoff），违反 AGENTS.md「终态提交只原子更新任务卡、项目状态、Task
   Ledger、完整 Evidence 和 Handoff」。
2. Evidence/Handoff/Reviewer 声称候选为 `87cd40a`；requiredCommands 的
   `verifiedCommit` 也是 `87cd40a`。`1c1dca2` 在审查与 requiredCommands 之后改变了
   实现树。
3. Evidence 中没有任何 `doctor.py --task TASK-0196 --pre-closure` 记录；修复批次 2
   后没有可核验的 pre-closure receipt。
4. `1c1dca2` 自称「Owner 授权第 2 修复批次」，但 Backlog 无 TASK-0196 amendment、
   卡无 `scopeAmendments`、`maximumFixBatches: 1` 已被 `353b1ac` 以 1/1 消耗。
5. `task_record_bound_skill_paths` 从卡内 `preReadyMaintenancePlan` 等声明取
   `skills/` 路径即豁免 `targetSkillVersions`，不交叉验证 policy 登记记录。
6. `validate_post_terminal_governance_edges` 在 `terminal_commit is None` 时无条件
   `return`，pre-closure 暂存态等于停用该校验器。

用户可观察目标：仓库继续保持可验证，但 TASK-0196 被精确标记为历史非法闭合；此后新的
终态提交、Reviewer/requiredCommands 候选、pre-closure receipt、READY 态写实现、
fix-batch 超限和 Skill 豁免全部失败关闭。不得把当前 Doctor PASS 叙述为原闭合合法。

## 范围内

- 在 `ci-execution-policy.yaml` 新增一次性 `task0197LegacyInvalidClosure` 机器记录，
  并在 `docs/evidence/TASK-0197/legacy-invalid-closure-quarantine.json` 写入精确
  quarantine 授权。记录只维持历史可验证性，明确 `historicalClosureValidity:
  INVALID`，禁止把 `1c1dca2` 追述为合法终态。
- 绑定 TASK-0196、声称候选 `87cd40a`、实际 terminal `1c1dca2`、单父、tree、8 个
  精确路径及逐文件 mode/type/blob/content hash，并冻结四项 P0。
- `doctor.py`：终态提交路径原子性——只允许卡、project-state、ledger、Evidence、
  Handoff；实现路径出现在终态提交必须失败。
- `doctor.py`：所有实现变化必须出现在 Reviewer 与 requiredCommands 的候选 SHA 中；
  终态提交不得改变实现树。
- `doctor.py`：强制 pre-closure receipt 绑定 HEAD、index tree、任务、候选 SHA；
  终态提交必须与放行树精确一致。
- `doctor.py`：禁止 READY 状态修改实现路径；实现变化必须先进入 IN_PROGRESS。
- `doctor.py`：fix batch 超限必须有先提交的 Backlog 强类型 Owner amendment；提交
  消息或聊天声明不构成授权。
- `doctor.py`：删除或收紧 `task_record_bound_skill_paths`——只有 policy 中精确登记
  并绑定 task/record/commit/tree/path/blob 的 maintenance 记录才可豁免；卡内自声明
  不得生效。
- `doctor.py`：`terminal_commit=None` 不得无条件关闭 post-terminal 校验；pre-closure
  暂存态必须验证 HEAD/index/worktree。
- `scripts/harness/tests/test_harness.py`：本卡冻结的正负测试清单全部落地。
- 保持 TASK-0098/0189/0195 已登记 tail 的精确兼容。
- 终态产物：Evidence Pack + Handoff + 任务卡 + project-state + Task Ledger。

## 明确范围外

- **不改写历史**：不 amend/rebase/reset/删除/重写 `1c1dca2`、`87cd40a`、`353b1ac`
  或任何 TASK-0196 提交；不修改 TASK-0191–0196 的卡、Context、Evidence、Handoff
  或 Ledger 历史条目。
- **不把 TASK-0196 追述为有效闭合**：机器状态保持 ACCEPTED，历史闭合效力保持
  INVALID。
- 不在 `docs/evidence/TASK-0196/**` 新增或修改 remediation 文件。所有审计、
  manifest、quarantine 和恢复证据只写入 `docs/evidence/TASK-0197/**`。
- 不修改 TASK-0141 任何制品；它继续作为 activation 前 legacy finding。
- 不提供通用历史豁免、可配置 allowlist、环境变量、CLI flag、git note/replace/
  graft、分支/worktree 旁路。
- 不修改业务代码、数据库、前端、CI workflow、Backlog、lifecycle、Skill 文档、
  `skills/harness-change/SKILL.md` 或 `scripts/harness/` 中除 `doctor.py` 与
  `tests/test_harness.py` 以外的文件。Skill 文档仅当机器证据证明必要时才可由
  Owner amendment 追加；当前无此证据。
- 不使用 pre-READY maintenance。当前 Doctor 为 PASS；正常路径为
  DRAFT → Owner 批准 → READY → IN_PROGRESS → 实现。若实现证明必须先改
  Harness 才能 READY，视为设计错误或新阻塞，停在 DRAFT。
- 本轮 DRAFT 只提交任务卡与 Context Lock；`activeTask` 保持 null。不进入 READY。
- 不 push、不 merge、不 rebase、不 reset、不改写历史。

## 输入和前置条件

- Base Commit：`1c1dca2f423ea9935000189e86789201cb859832`（TASK-0196 实际
  ledger introduction / canonical terminal；唯一父 `87cd40a`）。
- Context Lock：`docs/tasks/context/TASK-0197.context-lock.yaml`（fingerprint
  `b4d806ce…`，52 inputs：51 个 Base Commit 仓库路径 + 1 个 Owner 接受的独立
  审计 provenance）。
- 已核验机器状态（2026-08-15，`doctor.py --summary` exit 0 / 1137636 checks）：
  HEAD=`1c1dca2`，worktree clean，`main` ahead 63，未 push，`activeTask=null`，
  `lastAccepted=lastTerminal=TASK-0196`。该 PASS 不得当作 TASK-0196 合法证明。
- 已核验 8 路径身份：`git diff --name-only 87cd40a 1c1dca2` 恰为 quarantine
  `exactPaths`；各文件 1c1dca2 侧 mode `100644` / 上表 blob / contentSha256。
- 已核验声称候选：`87cd40a` tree `83deb6e9…`；其 `doctor.py` blob
  `ac22f4cf…` / sha256 `7106e8c7…`，`test_harness.py` blob `ee5552f9…` /
  sha256 `a40f1915…`，与 1c1dca2 实现树不同。
- 已核验 READY 态实现边：`383e403`（READY，authorizationCommit 回填）→
  `353b1ac` 仅改 `doctor.py`+`test_harness.py`。
- 独立审计 provenance：`owner-accepted-task-0196-independent-audit-20260815`
  sha256 `bc3f2ad1e019d46c71657c4764a8e05228337861242d05b5b3c02fc611c3ca5f`。

## API / 事件 / 数据契约

- `ci-execution-policy.yaml` 新增顶层 `task0197LegacyInvalidClosure:`：
  `schemaVersion/recordId/decisionId/kind/targetTask/sourceThreadId/
  authorization/predecessor/claimedCandidate/actualTerminal/p0Findings/
  files/activation/consumption/validationChannel/forbiddenInterfaces`。
- `doctor.py` 的 `ci_execution_policy_projection` redact 列表新增
  `"task0197LegacyInvalidClosure"`，并同步 `CI_EXECUTION_POLICY_CANONICAL_HASH`。
- 不新增/修改任何 OpenAPI、catalog、contracts、events schema。

## 权限、RLS 和数据处理要求

- 不触数据库、不触 RLS、不触任何业务数据。
- `scripts/harness/doctor.py`、`scripts/harness/tests/test_harness.py`、
  `.harness/ci-execution-policy.yaml` 为 C4 protected paths（requiredSkill:
  harness-change，humanApproval: repository-owner，independentReview:
  required）。本卡已声明 harness-change 与 authorization 双 scope 批准。
- READY 授权提交只允许任务卡、Context Lock 和 `.harness/project-state.yaml`。

## 状态机和失败行为

- TASK-0196 保持 ACCEPTED；本卡将其历史闭合标记为 INVALID。复制 quarantine
  记录、二次消费、附加路径、多父、任何身份漂移、把 INVALID 改写为 VALID、
  泛化到其他历史终态均失败关闭。
- 终态提交若包含实现路径（含 `scripts/harness/doctor.py`、
  `scripts/harness/tests/test_harness.py` 或任何非卡/project-state/ledger/
  Evidence/Handoff 路径）必须失败。
- Reviewer `reviewedCommit` 与 requiredCommands `verifiedCommit` 必须覆盖全部
  实现变化；终态提交改变实现树必须失败。
- 缺少、伪造或与 HEAD/index tree/任务/候选 SHA 不一致的 pre-closure receipt
  必须失败；终态提交树必须等于放行树。
- READY 态修改实现路径必须失败；必须先进入 IN_PROGRESS。
- 超出 `maximumFixBatches` 且无先提交 Backlog 强类型 Owner amendment 必须失败。
- 仅在卡内复制 maintenance plan 以豁免 Skill 必须失败。
- `terminal_commit=None` 不得跳过 HEAD/index/worktree 校验。
- 当前 Doctor PASS、同卡 writeAllowlist、提交消息或聊天声明均不构成放行理由。

## 模型、Prompt、记忆和安全边界

- 不涉及模型、prompt、记忆或安全模块；仅治理校验器与 quarantine 记录。

## 一次性 quarantine 设计（冻结）

`legacyInvalidClosureQuarantine` 精确绑定以下字段，任一漂移即失败关闭：

| 绑定维度 | 值 |
|---|---|
| task ID | TASK-0197（`targetTask`）；前任 TASK-0196 |
| 前任机器状态 | ACCEPTED |
| 历史闭合效力 | INVALID（不得改写或追述为有效） |
| 声称候选 | `87cd40a2b59317015ce9a8aa55cda2d2fe686c91` / tree `83deb6e9…` |
| 实际 terminal | `1c1dca2f423ea9935000189e86789201cb859832` / tree `15fa2ef0…` |
| 单父 | `87cd40a2b59317015ce9a8aa55cda2d2fe686c91` |
| 精确路径集合 | 上表 8 路径（不多不少） |
| 四项 P0 | P0-1 终态原子性；P0-2 候选身份；P0-3 pre-closure 缺失；P0-4 授权 |
| 一次消费 | `oneTimeOnly: true`，READY 授权后惰化，`reusable: false` |
| 语义 | 只维持历史可验证性，不合法化原闭合 |
| 禁止接口 | CLI flag/env var/git note/replace/graft/历史改写/可配置 allowlist/通配写路径/通用 override/通用历史豁免 全部 false |

READY 后实现约束：
- 记录 identity/字段集合/逐字段值全部硬绑定；
- live edge facts 实时从 Git 复核：`rev-list --parents` 单父、`changed_paths_between`
  精确 8 路径、tree、逐文件 blob/content；
- 复制到其他任务与二次消费必须 FAIL；
- quarantine 放行不得把 TASK-0196 描述为原闭合合法；
- TASK-0098/0189/0195 已登记 tail 继续精确匹配放行，不引入通用豁免。

## 正负测试清单（DRAFT 冻结，IN_PROGRESS 后全部落 `scripts/harness/tests/test_harness.py`）

负例：

1. 复现 `353b1ac`：READY 态修改 `doctor.py`/`test_harness.py` → FAIL。
2. 复现 `87cd40a→1c1dca2`：终态提交混合实现路径与闭合制品 → FAIL。
3. Reviewer/requiredCommands 绑定旧候选（审查 87cd40a、实现变为 1c1dca2）→ FAIL。
4. 缺少或伪造 pre-closure receipt；receipt 与 HEAD/index tree/任务/候选 SHA 不一致 → FAIL。
5. 第二 fix batch 无先提交 Backlog 强类型 amendment，或超过 `maximumFixBatches` → FAIL。
6. 仅在卡内复制 maintenance plan 的 `skills/` 路径以豁免 `targetSkillVersions` → FAIL。
7. `terminal_commit=None` 暂存旁路（无条件 return、不检查 HEAD/index/worktree）→ FAIL。
8. 错父、额外路径、tree/blob/content 漂移、多父、复制记录、重放消费 → FAIL。

正例：

9. 正常 IN_PROGRESS 候选 → requiredCommands 绑定同一实现 SHA → 独立 Reviewer 绑定同一 SHA → pre-closure receipt 绑定 HEAD/index tree/任务/候选 SHA → 纯闭合终态（仅卡、project-state、ledger、Evidence、Handoff）→ PASS。
10. TASK-0098（1696739→d335159）、TASK-0189（7f9f9e3→c626005）、TASK-0196 已登记
    `fe0253f→751cb9d` tail 继续 PASS；不提供通用历史豁免。
11. TASK-0196 精确 quarantine 后当前仓库可验证（Doctor 对 quarantined INVALID 闭合
    给出可验证而非合法化的结果）；任何把该结果描述为「原闭合合法」的断言必须失败。

## 验收标准

1. quarantine 机器校验通过：TASK-0196/87cd40a/1c1dca2/父/tree/8 路径/逐文件
   mode/blob/content/四项 P0 全部精确匹配；复制/二次消费/附加路径/多父/漂移/
   把 INVALID 改写为 VALID 全部失败关闭。
2. `doctor.py --task TASK-0197` READY Doctor 0 errors PASS；`doctor.py --summary`
   无新增 error。PASS 不得叙述为 TASK-0196 原闭合合法。
3. 负例 1–8 与正例 9–11 全部落地并真实 PASS/FAIL（无 NOT_RUN 冒充）。
4. 历史零修改：`git diff` 不含 TASK-0191–0196 任何卡/context/evidence/handoff，
   `1c1dca2`/`87cd40a`/`353b1ac` 原样保留。
5. 无 pre-READY maintenance 边；实现只发生在 IN_PROGRESS 之后。
6. 交付闭环：canonical Precheck PASS；C4 独立 Reviewer 绑定实现候选 SHA；
   pre-closure receipt 与终态树一致；Handoff `nextAction` 与终态 project-state
   逐字一致；不推送、不合并。

## 必跑检查

以 YAML `requiredCommands` 的精确 argv 为准：`PATH=… python scripts/harness/precheck.py
--task TASK-0197` 与 `git diff --check`。另在 READY 前冻结精确的定向 unittest argv：

```
PYTHONPATH=scripts/harness:scripts/harness/tests python -m unittest \
  test_harness.Task0197InvalidClosureGovernanceTests \
  test_harness.Task0098PostTerminalTailTests \
  test_harness.Task0189PostTerminalTailTests \
  test_harness.Task0196PostTerminalTailTests
```

每条命令记录状态、退出码、验证提交、产物哈希或无产物理由。

## 回滚或前向修复

- 若 quarantine 校验或 Doctor 修复校验失败，按 `task-delivery-flow` 的 fail-closed
  停止，不降级、不绕过。
- 修复边界只允许对 writeAllowlist 内文件在 `maximumFixBatches: 1` 内修订，且必须
  先有已提交的 Backlog 强类型 Owner amendment；超出即停止询问 Owner。
- 提交消息、聊天声明、未提交 worktree/index 不构成授权。

## 停止条件

- 需要修改 writeAllowlist 外路径（含任何历史卡、Backlog、lifecycle、Skill 文档、
  业务代码）时立即停止询问 Owner。
- 发现必须 pre-READY 修改 Harness 时停在 DRAFT，视为设计错误或新阻塞。
- 发现记录字段与 Git 事实不符、需要通用化放行通道、或试图把 TASK-0196 追述为
  有效闭合时，立即停止询问 Owner，不得自行扩权。
- 任何把 NOT_RUN/失败/超时转为 PASS 的行为立即停止。
- Reviewer 未通过、canonical 未 PASS、pre-closure 未绑定终态树时不得进入 terminal。
- 未经 Owner 审核不得进入 READY。

## Evidence Pack

输出到 `docs/evidence/TASK-0197/`（含
`legacy-invalid-closure-quarantine.json`、`review-r1.md`），并生成
`docs/handoffs/TASK-0197.json`。不得写入 `docs/evidence/TASK-0196/**`。

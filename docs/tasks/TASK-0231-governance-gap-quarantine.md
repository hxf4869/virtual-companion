# TASK-0231：本轮治理收尾 quarantine（14 卡验证缺口 + TASK-0209/0210 授权缺口 + local exact-tree fallback 证据缺口）

```yaml
taskId: TASK-0231
state: READY
owner: repository-owner
riskClass: C2
requiredSkills:
  - task-delivery-flow
  - task-intake
requiredSkillVersions:
  task-delivery-flow: "1.3.7"
  task-intake: "1.2.7"
targetSkillVersions: {}
planningBacklog: null
planningContractHash: null
planningContractHashAlgorithm: null
baseCommit: a0d4106ab25de7a59803254cb12d823ca2a5a98c
authorizationCommit: ""
contextFingerprint: 5eca768c2f0ddbfef8ae4c579c6951ce0ef447722827e6e8caf2ca4fdf5499b6
contextLock: docs/tasks/context/TASK-0231.context-lock.yaml
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
  riskClass: C2
  surfaceId: TASK_0231_GOVERNANCE_GAP_QUARANTINE
  policySurfaces: [AUTHORIZATION]
  distinctCrossRiskSurfaces: 1
  reviewerMinutesEstimate: 10
  terminalCheckMinutesEstimate: 15
  estimatedWallMinutes: 45
  thresholdsTriggered: []
  splitRecommended: false
  splitRequired: false
  splitDecision: KEEP
  ownerIndivisibleAuthorization: false
  harnessImplementationForbidden: true
validationPlan: {frozenBefore: READY, policySource: .harness/ci-execution-policy.yaml, selectedChannel: LOCAL_EXACT_TREE_FALLBACK, profile: precheck}
governanceGapQuarantine:
  recordId: OWNER-MAINT-20260816-TASK-0231-GOVERNANCE-GAP-QUARANTINE-01
  recordPath: docs/evidence/TASK-0231/governance-gap-quarantine.json
  kind: EXACT_ONE_TIME_GOVERNANCE_GAP_QUARANTINE
  historicalVerifiabilityOnly: true
  doesNotLegitimizeAnyClosure: true
  doesNotRetroactivelyAuthorize: true
  reusable: false
  oneTimeOnly: true
  copiedRecordForbidden: true
  secondConsumptionForbidden: true
  groups:
    - groupId: LEGACY_VALIDATION_GAP_BATCH
      cardCount: 14
      terminalCommits:
        - 14a8f4efba69b77e7f4d629bd73a1e6a68980ae1
        - e69c00b4a12d6291dadf5e890aa2738d8e2c8229
        - 41b0f8215eb64f3ddea68a748fe5f94a0fcfd8c4
        - 425597ca44d188e1827462fc22313499d0ce5ea2
        - fb5656ee3d9491cc304fe2f70601362cb3cfa176
        - bcf182590310135e67a0faf28fe4f7b94dff7e74
        - 8f29c773e55da8c6dc30746d4ae9717928ccd973
        - 98796c05ab2dee73eadb1e42a6f59df019274755
        - 8f18627997b4f230351b34883a0e42161f44c093
        - 99a19a995d617a4e07926646354beef4cbe63a06
        - 12c19137e04a288171849e72a00c3408b4ad35fc
        - 377b95fd7314b44b6db2e32ba8766abd07b62b07
        - 568ba6cc5951895b25227eeef4df5922b1283154
        - d8cae708f0ad59ac07898729d55f7e185c53a159
    - groupId: LEGACY_AUTHORIZATION_GAP_0209_0210
      task0209RejectedCommit: eed0bf6957987ae0adac3f30cc41ce23cf919cf9
      task0210ReadyCommit: ecc35f7feb208686ebd8233e4533f5ce7ebc2d07
      task0210AcceptedCommit: 1e8922cb0637e594e0e9aa2fd24386a40d0c48ee
      task0209PrecheckStatus: FAIL
      task0209PreclosureStatus: FAIL
    - groupId: LEGACY_EXACT_TREE_EVIDENCE_GAP
      representativeTaskId: TASK-0230
      task0230AcceptedCommit: a0d4106ab25de7a59803254cb12d823ca2a5a98c
      task0230EvidenceHeadCommit: 6bfea47d74610e7610d92e588c25a76f05dc677b
      missingStrongTypedRemoteUnavailableEvidence: true
      missingOwnerAuthorizedScope: true
      missingResultRecordRequiredFields: true
      missingUncoveredPlatformsRecord: true
readAllowlist:
  - AGENTS.md
  - CLAUDE.md
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
  - skills/task-intake/SKILL.md
  - skills/task-delivery-flow/SKILL.md
  - docs/tasks/TASK-0213-h5-index-carry-relationship-id-to-memory.md
  - docs/evidence/TASK-0213/evidence-pack.json
  - docs/tasks/TASK-0214-h5-memory-empty-point-to-chat.md
  - docs/evidence/TASK-0214/evidence-pack.json
  - docs/tasks/TASK-0215-h5-login-back-to-index-nav.md
  - docs/evidence/TASK-0215/evidence-pack.json
  - docs/tasks/TASK-0216-h5-memory-empty-id-select-or-fill.md
  - docs/evidence/TASK-0216/evidence-pack.json
  - docs/tasks/TASK-0217-h5-memory-carry-relationship-id-to-chat.md
  - docs/evidence/TASK-0217/evidence-pack.json
  - docs/tasks/TASK-0218-h5-chat-login-nav.md
  - docs/evidence/TASK-0218/evidence-pack.json
  - docs/tasks/TASK-0219-h5-memory-login-nav.md
  - docs/evidence/TASK-0219/evidence-pack.json
  - docs/tasks/TASK-0221-h5-login-memory-nav.md
  - docs/evidence/TASK-0221/evidence-pack.json
  - docs/tasks/TASK-0222-h5-index-carry-relationship-id-to-chat.md
  - docs/evidence/TASK-0222/evidence-pack.json
  - docs/tasks/TASK-0223-h5-index-show-current-relationship.md
  - docs/evidence/TASK-0223/evidence-pack.json
  - docs/tasks/TASK-0224-h5-chat-show-current-relationship.md
  - docs/evidence/TASK-0224/evidence-pack.json
  - docs/tasks/TASK-0225-h5-memory-show-current-relationship.md
  - docs/evidence/TASK-0225/evidence-pack.json
  - docs/tasks/TASK-0226-h5-index-relationship-load-error.md
  - docs/evidence/TASK-0226/evidence-pack.json
  - docs/tasks/TASK-0227-h5-chat-relationship-load-error.md
  - docs/evidence/TASK-0227/evidence-pack.json
  - docs/tasks/TASK-0209-h5-carry-relationship-id-to-memory.md
  - docs/evidence/TASK-0209/evidence-pack.json
  - docs/handoffs/TASK-0209.json
  - docs/tasks/TASK-0210-h5-memory-pick-relationship-id.md
  - docs/evidence/TASK-0210/evidence-pack.json
  - docs/handoffs/TASK-0210.json
  - docs/tasks/TASK-0230-h5-memory-hide-prefill-on-rel-error.md
  - docs/evidence/TASK-0230/evidence-pack.json
  - docs/tasks/TASK-0198-task0196-invalid-closure-authorization-quarantine.md
  - docs/evidence/TASK-0198/legacy-invalid-closure-quarantine.json
writeAllowlist:
  - docs/tasks/TASK-0231-governance-gap-quarantine.md
  - docs/tasks/context/TASK-0231.context-lock.yaml
  - docs/evidence/TASK-0231/**
  - docs/handoffs/TASK-0231.json
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
forbiddenPaths:
  - .github/**
  - ci/**
  - service/**
  - frontend/**
  - infra/**
  - scripts/**
  - skills/**
  - .harness/agent-entrypoints.yaml
  - .harness/ci-execution-policy.yaml
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
  - docs/tasks/TASK-0213-h5-index-carry-relationship-id-to-memory.md
  - docs/tasks/TASK-0214-h5-memory-empty-point-to-chat.md
  - docs/tasks/TASK-0215-h5-login-back-to-index-nav.md
  - docs/tasks/TASK-0216-h5-memory-empty-id-select-or-fill.md
  - docs/tasks/TASK-0217-h5-memory-carry-relationship-id-to-chat.md
  - docs/tasks/TASK-0218-h5-chat-login-nav.md
  - docs/tasks/TASK-0219-h5-memory-login-nav.md
  - docs/tasks/TASK-0221-h5-login-memory-nav.md
  - docs/tasks/TASK-0222-h5-index-carry-relationship-id-to-chat.md
  - docs/tasks/TASK-0223-h5-index-show-current-relationship.md
  - docs/tasks/TASK-0224-h5-chat-show-current-relationship.md
  - docs/tasks/TASK-0225-h5-memory-show-current-relationship.md
  - docs/tasks/TASK-0226-h5-index-relationship-load-error.md
  - docs/tasks/TASK-0227-h5-chat-relationship-load-error.md
  - docs/tasks/TASK-0209-h5-carry-relationship-id-to-memory.md
  - docs/tasks/TASK-0210-h5-memory-pick-relationship-id.md
  - docs/tasks/TASK-0230-h5-memory-hide-prefill-on-rel-error.md
  - docs/tasks/TASK-0198-task0196-invalid-closure-authorization-quarantine.md
  - docs/tasks/context/TASK-0198.context-lock.yaml
  - docs/evidence/TASK-0198/**
  - docs/handoffs/TASK-0198.json
  - docs/evidence/TASK-0196/**
  - docs/handoffs/TASK-0196.json
  - docs/tasks/TASK-0196-post-terminal-tail-doctor-fix.md
  - docs/evidence/TASK-0197/**
  - docs/handoffs/TASK-0197.json
  - docs/tasks/TASK-0197-task0196-invalid-closure-governance-recovery.md
  - docs/evidence/TASK-0209/**
  - docs/handoffs/TASK-0209.json
  - docs/evidence/TASK-0210/**
  - docs/handoffs/TASK-0210.json
  - docs/evidence/TASK-0213/**
  - docs/handoffs/TASK-0213.json
  - docs/evidence/TASK-0214/**
  - docs/handoffs/TASK-0214.json
  - docs/evidence/TASK-0215/**
  - docs/handoffs/TASK-0215.json
  - docs/evidence/TASK-0216/**
  - docs/handoffs/TASK-0216.json
  - docs/evidence/TASK-0217/**
  - docs/handoffs/TASK-0217.json
  - docs/evidence/TASK-0218/**
  - docs/handoffs/TASK-0218.json
  - docs/evidence/TASK-0219/**
  - docs/handoffs/TASK-0219.json
  - docs/evidence/TASK-0221/**
  - docs/handoffs/TASK-0221.json
  - docs/evidence/TASK-0222/**
  - docs/handoffs/TASK-0222.json
  - docs/evidence/TASK-0223/**
  - docs/handoffs/TASK-0223.json
  - docs/evidence/TASK-0224/**
  - docs/handoffs/TASK-0224.json
  - docs/evidence/TASK-0225/**
  - docs/handoffs/TASK-0225.json
  - docs/evidence/TASK-0226/**
  - docs/handoffs/TASK-0226.json
  - docs/evidence/TASK-0227/**
  - docs/handoffs/TASK-0227.json
  - docs/evidence/TASK-0230/**
  - docs/handoffs/TASK-0230.json
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
  - .harness/protected-paths.yaml
  - .harness/skills.yaml
  - .harness/invariants.yaml
  - .harness/sources-of-truth.yaml
  - skills/task-intake/SKILL.md
  - skills/task-delivery-flow/SKILL.md
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
requiredInvariants:
  - INV-HARNESS-001
  - INV-HARNESS-002
  - INV-HARNESS-005
  - INV-HARNESS-009
humanApprovals:
  - scope: task-intake
    approvedBy: repository-owner
    approvedAt: "2026-08-16"
    evidence: >-
      Owner 2026-08-16 /goal 治理收尾指令书面授权：普通调查、治理分析、低风险
      方案选择、task-intake、任务拆分、测试与非保护路径常规修复由本 Agent 决定；
      append-only quarantine 不得合法化历史闭合、不得追溯授权、不得伪造 PASS；
      保护路径与 push 不得自行批准。本卡只把审计事实冻结到新 Evidence 路径，
      不修改任何历史制品，不改变失败/安全/契约语义。不编造 sourceThreadId。
independentReview: not-required
reviewers: []
requiredCommands:
  - PATH=/Users/hxf/.zcode/venvs/vc-harness/bin:$PATH python scripts/harness/precheck.py --task TASK-0231
  - PATH=/Users/hxf/.zcode/venvs/vc-harness/bin:$PATH python docs/evidence/TASK-0231/verify_quarantine_contract.py
  - git diff --check
```

> 本卡为独立延续单卡，不写 planningBacklog/planningContractHash。永久 ID 由机器真源派生：
> Task Ledger 现存最大编号为 TASK-0230（ACCEPTED），仓库内无既有 TASK-0231 引用，intake 分配本号。
> 本卡不实现 Harness 变更、不预占 SLICE-GOVERNANCE/HISTORY 后继 ID，不改变任何失败/安全/契约语义。

## 背景与用户可观察目标

上一轮 Grok Goal 会话（01a0034f-c7a4-7563-bb7a-01834924e3f7）以 infra_paused 结束
（402 Payment Required / Grok Build usage balance exhausted；last_classifier_verdict=not_achieved）。
Owner 2026-08-16 /goal 指令要求对仓库做治理收尾审计。审计结论确认三组缺口：

1. **验证缺口批次（14 张卡）**：TASK-0213/0214/0215/0216/0217/0218/0219/0221/0222/0223/
   0224/0225/0226/0227 全部以 ACCEPTED 闭合，但其 Evidence 中机器要求的验证存在
   NOT_RUN 缺口——除 TASK-0221 的 READY Doctor 与 canonical precheck 真实 PASS 外，
   其余 13 张卡的 READY Doctor、canonical precheck 与 pre-closure 均为 NOT_RUN；
   TASK-0221 的 pre-closure 也是 NOT_RUN。这违反 AGENTS.md「提交前运行
   doctor.py --task TASK-ID --pre-closure」、task-delivery-flow Skill 步骤 9 与
   INV-HARNESS-005/009。直接原因是 Owner 2026-08-15 10:34 会话指令「太长的检查都不跑了，
   以完成任务计划为主」，但机器真源未作相应修改，「后面统一跑」对这 14 张卡从未兑现。
   当前 Doctor 对普通卡的 Evidence 不强制验证这些命令的存在与结果，属于验证覆盖缺口。

2. **TASK-0209/0210 授权缺口**：owner-gates 2026-08-15 18:55 条目要求 Owner 在
   harness-change（方案 B）与 REJECTED-with-real-FAIL 之间作出精确二选一并给出
   「精确授权句」。仓库外待决队列之后没有可核验的 Owner 逐字授权记录；
   TASK-0209 以 REJECTED 闭合（eed0bf6，Evidence 真实记录 precheck FAIL exit 1
   与 pre-closure FAIL exit 1，未改写为 PASS），TASK-0210 随后 READY（ecc35f7）并
   ACCEPTED（1e8922c）。对照先例 TASK-0191 的 REJECTED 有「Owner 2026-08-13 修正版 A
   裁决」精确授权，TASK-0209/0210 没有同等级授权，构成授权缺口，不得追溯补造。

3. **local exact-tree fallback 证据缺口**：以 TASK-0230 为代表的普通卡在卡内声明
   `validationPlan.selectedChannel: LOCAL_EXACT_TREE_FALLBACK`，但 Evidence 缺少
   ci-execution-policy 要求的 STRONG_TYPED_REMOTE_UNAVAILABLE_EVIDENCE、
   OWNER_AUTHORIZED_SCOPE、resultRecordRequiredFields（cleanWorktree/cleanIndex/cwd/
   interpreter/toolchain/dependencies/stdoutSha256/stderrSha256/receiptSha256/
   startedAt/completedAt）与 notCovered 未覆盖平台记录。因此这些卡的 precheck/pre-closure
   PASS 是普通本地验证结果，不能构成 exact-tree release gate（INV-HARNESS-009）。

用户可观察目标：仓库出现一份一次性、不可复用、不合法化任何历史闭合、不追溯授权的
quarantine JSON，精确绑定以上事实；当前仓库可验证，且后续 Owner 决策有单一入口。

## 范围内

- 实现 `docs/evidence/TASK-0231/governance-gap-quarantine.json`：三组缺口
  （LEGACY_VALIDATION_GAP_BATCH / LEGACY_AUTHORIZATION_GAP_0209_0210 /
  LEGACY_EXACT_TREE_EVIDENCE_GAP），逐卡绑定 14 张卡的终态提交、Evidence
  headCommit 与检查状态；绑定 0209/0210 关键提交与 Evidence 状态；绑定 0230
  终态/候选与 fallback 证据缺口声明。
- 实现只读核验脚本 `docs/evidence/TASK-0231/verify_quarantine_contract.py`：
  对正确 JSON PASS；对故意漂移（改提交、改状态、把 NOT_RUN 写成 PASS、
  把缺口卡声明为合法闭合）FAIL。
- 本卡治理制品与终态闭合。

## 明确范围外

- 不修改任何历史卡、Context Lock、Evidence、Handoff、Ledger 条目或终态提交。
- 不修改 `scripts/harness/**`、`.harness/ci-execution-policy.yaml`、
  `.harness/task-delivery-policy.yaml` 或任何保护路径；Doctor 收紧属后继
  SLICE-GOVERNANCE，需 harness-change 人工批准。
- 不补跑 14 张卡的历史验证并把当前运行追溯写成 PASS。
- 不追造 Owner 授权；0209/0210 的追认只能由 Owner 作出。
- 不 push / merge / rebase / reset / 历史改写。

## 输入和前置条件

- Base Commit：`a0d4106ab25de7a59803254cb12d823ca2a5a98c`（TASK-0230 ACCEPTED
  终态）。仓库 idle：`activeTask=null`，工作树与 Index 干净。
- Context Lock：冻结本卡 readAllowlist 全部仓库内输入 + 1 个仓库外 provenance
  （Owner 闸门文件条目摘要）。
- 14 张卡的身份（终态提交与 Evidence 检查状态）以各自 Evidence 文件为准。

## API / 事件 / 数据契约

- 不修改 OpenAPI、catalog、contracts、events、数据库。
- quarantine JSON 只维持历史可验证性，不构成通用豁免。

## 权限、RLS 和数据处理要求

- 不触数据库、RLS 或业务数据。
- 写路径均为 C2 task-intake 治理制品；不申请 harness-change 人工批准。

## 状态机和失败行为

- 本卡单面 AUTHORIZATION，`splitDecision: KEEP`。
- quarantine JSON 任一身份字段漂移 → verify FAIL。
- 把 NOT_RUN/FAIL 改写成 PASS → FAIL。
- 把缺口卡追述为合法闭合、把 0209/0210 追述为已获精确授权 → FAIL。
- 修改 Harness、历史制品或保护路径 → FAIL。
- 复制本 recordId 或二次消费 → FAIL。

## 模型、Prompt、记忆和安全边界

- 不涉及模型、prompt、记忆或安全模块。

## 验收标准

1. `docs/evidence/TASK-0231/governance-gap-quarantine.json` 存在，三组字段与仓库
   事实一致（14 卡终态/headCommit/检查状态；0209/0210 关键提交与 Evidence 状态；
   0230 候选与 fallback 证据缺口声明）。
2. JSON 声明 `doesNotLegitimizeAnyClosure: true` 与
   `doesNotRetroactivelyAuthorize: true`。
3. 核验脚本对正确 JSON PASS，对故意漂移 FAIL。
4. Diff 不包含 Harness、历史卡 Evidence/Handoff、Ledger 历史条目或保护路径。
5. 冻结 requiredCommands 真实执行；FAIL/NOT_RUN 不得改写成 PASS。

## 必跑检查

冻结命令见 YAML `requiredCommands`（canonical precheck、verify 脚本、
`git diff --check`）。READY 后真实跑 `doctor.py --task TASK-0231`；候选冻结后
真实跑官方 `precheck.py --task TASK-0231` 与
`doctor.py --task TASK-0231 --pre-closure`。未跑不得写成 PASS。

## 回滚或前向修复

- 只允许本卡 writeAllowlist 在 `maximumFixBatches: 1` 内修订。
- 需要修改 Harness 或历史制品时立即停止并交给后继 GOVERNANCE 卡或 Owner。

## 停止条件

- 需要修改 writeAllowlist 外路径立即停止。
- 试图把缺口卡追述为合法闭合、把 0209/0210 追述为已授权或把 NOT_RUN/失败转为
  PASS 立即停止。

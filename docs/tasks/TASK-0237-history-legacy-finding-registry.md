# TASK-0237：SLICE-HISTORY——TASK-0141 legacy finding 登记与已登记 tail 兼容确认

```yaml
taskId: TASK-0237
state: DRAFT
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
baseCommit: eae0461440f8e5039a8716ce3fe729d4869d17f5
authorizationCommit: ""
contextFingerprint: 6e79b1d93a31d8e6c74c3c8bf874b02ceb62dad6e0f27d567e79390009c0d192
contextLock: docs/tasks/context/TASK-0237.context-lock.yaml
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
  surfaceId: TASK_0237_HISTORY_LEGACY_FINDING_REGISTRY
  policySurfaces: [HISTORY]
  distinctCrossRiskSurfaces: 1
  reviewerMinutesEstimate: 8
  terminalCheckMinutesEstimate: 15
  estimatedWallMinutes: 40
  thresholdsTriggered: []
  splitRecommended: false
  splitRequired: false
  splitDecision: KEEP
  ownerIndivisibleAuthorization: false
  harnessImplementationForbidden: true
validationPlan: {frozenBefore: READY, policySource: .harness/ci-execution-policy.yaml, selectedChannel: PRIMARY_REMOTE_EXACT_SHA, profile: precheck}
historyRegistry:
  recordId: OWNER-MAINT-20260816-TASK-0237-TASK0141-LEGACY-FINDING-01
  recordPath: docs/evidence/TASK-0237/task0141-legacy-finding-registry.json
  kind: EXACT_ONE_TIME_LEGACY_FINDING_REGISTRY
  historicalVerifiabilityOnly: true
  doesNotLegitimize: true
  doesNotRetroactivelyBlock: true
  reusable: false
  oneTimeOnly: true
  copiedRecordForbidden: true
  task0141State: REJECTED
  task0141TerminalCommit: 61aa6f96f0b4fe5809c53e2cdc7040b8e88fdbcb
  task0141CardPath: docs/tasks/TASK-0141-p2-23-supply-chain-reproducibility.md
  task0141CardBlob: 6edd9607402100dd2dc223e8a97a7ea5453355c0
  task0141CardSha256: bc0b91a9f960a261f23b38951150902b5217d1eebc39f78e876cc06208998efb
  task0141EvidencePath: docs/evidence/TASK-0141/evidence-pack.json
  task0141EvidenceBlob: c958f04633b6846e7212c0a5f5250418bd911da0
  task0141EvidenceSha256: 63ee0ad98a4a16004053a1bfbf6c5fc29b76d29de3a84e31b7f1cfcaee010c68
  task0141HandoffPath: docs/handoffs/TASK-0141.json
  task0141HandoffBlob: a345f505d46a304ed43aae91d567bef846b75548
  task0141HandoffSha256: f6525054c060483aa20d501daea6e02541bb7175332d332ef6188d4399c13349
  registeredTails:
    - taskId: TASK-0098
      recordId: OWNER-MAINT-20260808-TASK-0098-POST-TERMINAL-TAIL-01
    - taskId: TASK-0189
      recordId: OWNER-MAINT-20260813-TASK-0189-POST-TERMINAL-TAIL-01
    - taskId: TASK-0196
      recordId: OWNER-MAINT-20260814-TASK-0196-POST-TERMINAL-TAIL-01
  statement: >-
    TASK-0141 是 enforcement activation 前的 legacy governance finding
    （历史 nextAction 与 project-state 不一致且无 post-terminal edge）。
    TASK-0196 已定性：不追溯阻塞、不称 PASS、不改其历史制品，留待另卡处理。
    本卡为 SLICE-HISTORY 收口登记：绑定 0141 REJECTED 终态制品身份、
    确认已登记 tail（TASK-0098/0189/0196）由 Doctor post-terminal edge
    validator 继续兼容校验（不复制任何 record）。
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
  - scripts/harness/doctor.py
  - docs/tasks/TASK-0141-p2-23-supply-chain-reproducibility.md
  - docs/evidence/TASK-0141/evidence-pack.json
  - docs/handoffs/TASK-0141.json
  - docs/tasks/TASK-0196-post-terminal-tail-doctor-fix.md
writeAllowlist:
  - docs/tasks/TASK-0237-history-legacy-finding-registry.md
  - docs/tasks/context/TASK-0237.context-lock.yaml
  - docs/evidence/TASK-0237/**
  - docs/handoffs/TASK-0237.json
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
  - docs/tasks/TASK-0141-p2-23-supply-chain-reproducibility.md
  - docs/tasks/context/TASK-0141.context-lock.yaml
  - docs/evidence/TASK-0141/**
  - docs/handoffs/TASK-0141.json
  - docs/tasks/TASK-0196-post-terminal-tail-doctor-fix.md
  - docs/evidence/TASK-0196/**
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
  - .harness/protected-paths.yaml
  - .harness/skills.yaml
  - .harness/invariants.yaml
  - .harness/sources-of-truth.yaml
  - scripts/harness/doctor.py
  - skills/task-intake/SKILL.md
  - skills/task-delivery-flow/SKILL.md
  - docs/evidence/TASK-0141/evidence-pack.json
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
      Owner 2026-08-16 /goal 补充明确授权第 6 条：按上一条授权完成治理恢复，
      明确列出 SLICE-HISTORY 为必须完成的工作项。本卡只登记 TASK-0141
      activation 前 legacy finding 的终态制品身份并确认已登记 tail 兼容，
      不修改任何历史制品、不重判、不追溯阻塞、不把 FAIL/NOT_RUN 改成 PASS，
      不改变失败/安全/契约语义。不编造 sourceThreadId。
independentReview: not-required
reviewers: []
requiredCommands:
  - PATH=/Users/hxf/.zcode/venvs/vc-harness/bin:$PATH python scripts/harness/precheck.py --task TASK-0237
  - PATH=/Users/hxf/.zcode/venvs/vc-harness/bin:$PATH python docs/evidence/TASK-0237/verify_history_registry.py
  - git diff --check
```

> 本卡为独立延续单卡，不写 planningBacklog/planningContractHash。永久 ID 由机器真源派生：
> Task Ledger 现存最大编号为 TASK-0236（ACCEPTED），intake 分配本号。
> 本卡是 SLICE-HISTORY 收口卡。SLICE-AUTHORIZATION 已由 TASK-0198、
> SLICE-GOVERNANCE 已由 TASK-0233/0234/0235/0236 完成。

## 背景与用户可观察目标

TASK-0196 handoff 遗留「TASK-0141 legacy governance finding 后续另卡处理」：
TASK-0141（REJECTED）是 enforcement activation 前的历史 nextAction 不一致且
无 post-terminal edge，Doctor 已按「activation 前边缘不追溯阻塞」兼容
（doctor.py 定向记录）。SLICE-HISTORY 的收口 = 把这个 finding 与已登记 tail
兼容状态正式登记为机器可验证记录。

用户可观察目标：仓库出现一份绑定 TASK-0141 终态制品身份（blob/sha256）的
登记 JSON，并确认 TASK-0098/0189/0196 三条已登记 tail 继续由 Doctor
post-terminal edge validator 兼容校验；不复制任何 record。

## 范围内

- 实现 `docs/evidence/TASK-0237/task0141-legacy-finding-registry.json`：登记
  0141 REJECTED 终态提交与卡/Evidence/Handoff 的 blob/contentSha256、finding
  定性（不追溯阻塞、不称 PASS、不改历史制品）、三条已登记 tail 的 recordId 引用。
- 实现只读核验脚本 `docs/evidence/TASK-0237/verify_history_registry.py`：
  对正确登记 PASS（含 Git 对象绑定复核），对故意漂移 FAIL。
- 本卡治理制品与终态闭合。

## 明确范围外

- 不修改 TASK-0141 及任何历史卡、Context Lock、Evidence、Handoff、Ledger
  条目或提交。
- 不修改 `scripts/harness/**`、`.harness/**` 策略或任何保护路径。
- 不复制或二次消费 TASK-0098/0189/0196 的 tail record。
- 不重判 activation 前历史；不 push main、不 force push、不
  merge/rebase/reset/cherry-pick、不建 tag/PR。

## 输入和前置条件

- Base：`eae0461440f8e5039a8716ce3fe729d4869d17f5`（TASK-0236 ACCEPTED 终态；
  已推送至恢复分支，远端 SHA/Tree 复核一致，正式 Doctor 释放绑定 PASS）。
- 仓库 idle：`activeTask=null`，工作树与 Index 干净。

## API / 事件 / 数据契约

- 不修改 OpenAPI、catalog、contracts、events、数据库。
- 登记 JSON 只维持历史可验证性，不构成通用豁免。

## 权限、RLS 和数据处理要求

- 不触数据库、RLS 或业务数据。
- 写路径均为 C2 task-intake 治理制品；不申请 harness-change 人工批准。

## 状态机和失败行为

- 本卡单面 HISTORY，`splitDecision: KEEP`。
- 登记 JSON 任一身份字段漂移 → verify FAIL。
- 绑定 blob/contentSha256 与 Base Commit Git 对象不一致 → FAIL。
- 把 finding 写成 PASS 或追溯阻塞 → FAIL。
- 修改历史制品或保护路径 → FAIL。

## 模型、Prompt、记忆和安全边界

- 不涉及模型、prompt、记忆或安全模块。

## 验收标准

1. `docs/evidence/TASK-0237/task0141-legacy-finding-registry.json` 存在，全部
   身份字段与卡内 `historyRegistry` 合同一致，blob/contentSha256 与 Base
   Commit 处 TASK-0141 制品真实 Git 对象一致。
2. 登记 JSON 声明 `doesNotLegitimize: true` 与 `doesNotRetroactivelyBlock: true`。
3. 核验脚本对正确登记 PASS，对故意漂移 FAIL。
4. Diff 不包含历史制品、Harness 或保护路径。
5. 冻结 requiredCommands 真实执行；FAIL/NOT_RUN 不得改写成 PASS。

## 必跑检查

冻结命令见 YAML `requiredCommands`。READY 后真实跑 `doctor.py --task TASK-0237`；
候选冻结后真实跑官方 `precheck.py --task TASK-0237` 与
`doctor.py --task TASK-0237 --pre-closure`。终态后普通推送至
`refs/heads/codex/governance-recovery-20260816`、fetch 并远端精确 SHA/Tree 复核，
再跑一次正式 `doctor.py --task TASK-0237` 验证释放绑定。未跑不得写成 PASS。

## 回滚或前向修复

- 只允许本卡 writeAllowlist 在 `maximumFixBatches: 1` 内修订。

## 停止条件

- 需要修改 writeAllowlist 外路径、修改历史制品或把 NOT_RUN/失败转为 PASS
  立即停止。

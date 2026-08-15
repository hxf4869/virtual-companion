# TASK-0232：TASK-0231 quarantine 制品的唯一权威登记（继承接纳，不复制 recordId）

```yaml
taskId: TASK-0232
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
baseCommit: 5f829b6c6d62c5fb5c03dcdc4474eab3b729d204
authorizationCommit: f8b9afc9419050b7d5919d204c8832fb2cdb721c
contextFingerprint: 385d905b89c0dd2392790a7d9709b36a5cb65b64b5b917acb548d42acc030516
contextLock: docs/tasks/context/TASK-0232.context-lock.yaml
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
  surfaceId: TASK_0232_QUARANTINE_REGISTRY
  policySurfaces: [AUTHORIZATION]
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
  predecessorSplitCard: TASK-0231
  thisSlice: SLICE-AUTHORIZATION-REGISTRY
validationPlan: {frozenBefore: READY, policySource: .harness/ci-execution-policy.yaml, selectedChannel: LOCAL_EXACT_TREE_FALLBACK, profile: precheck}
quarantineRegistry:
  recordId: OWNER-MAINT-20260816-TASK-0232-QUARANTINE-REGISTRY-01
  recordPath: docs/evidence/TASK-0232/quarantine-registry.json
  kind: EXACT_ONE_TIME_QUARANTINE_REGISTRY
  historicalVerifiabilityOnly: true
  doesNotLegitimizeAnyClosure: true
  doesNotRetroactivelyAuthorize: true
  reusable: false
  oneTimeOnly: true
  copiedRecordForbidden: true
  secondConsumptionForbidden: true
  predecessorTaskId: TASK-0231
  predecessorTerminalCommit: 5f829b6c6d62c5fb5c03dcdc4474eab3b729d204
  predecessorTerminalTree: 0ea212fefb12080ec850a37f76bd9ffd23f5f9ee
  predecessorQuarantinePath: docs/evidence/TASK-0231/governance-gap-quarantine.json
  predecessorQuarantineBlob: ccadd0f1d6fc3098e3475e2c4c053fac9ea1198f
  predecessorQuarantineSha256: b3d647d84fad7fcd5b8bac1542b2e6f4b3bbca3b7b9de88270b1b6dbaa72d883
  predecessorVerifyPath: docs/evidence/TASK-0231/verify_quarantine_contract.py
  predecessorVerifyBlob: 8bee29fe17377301ad822f5fdadf13a994d7bccc
  predecessorVerifySha256: 0eb77612d40d0b37a3647129c626199f1de4b09c494ddc100a562b72890c9f25
  predecessorRecordIdNotCopied: OWNER-MAINT-20260816-TASK-0231-GOVERNANCE-GAP-QUARANTINE-01
  task0210AcceptedCommitCorrectSha: 1e8922ca7394655657f68a9379315116f2e6e91b
  groupIds:
    - LEGACY_VALIDATION_GAP_BATCH
    - LEGACY_AUTHORIZATION_GAP_0209_0210
    - LEGACY_EXACT_TREE_EVIDENCE_GAP
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
  - docs/tasks/TASK-0231-governance-gap-quarantine.md
  - docs/tasks/context/TASK-0231.context-lock.yaml
  - docs/evidence/TASK-0231/evidence-pack.json
  - docs/evidence/TASK-0231/governance-gap-quarantine.json
  - docs/evidence/TASK-0231/verify_quarantine_contract.py
  - docs/handoffs/TASK-0231.json
writeAllowlist:
  - docs/tasks/TASK-0232-quarantine-registry.md
  - docs/tasks/context/TASK-0232.context-lock.yaml
  - docs/evidence/TASK-0232/**
  - docs/handoffs/TASK-0232.json
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
  - docs/tasks/TASK-0231-governance-gap-quarantine.md
  - docs/tasks/context/TASK-0231.context-lock.yaml
  - docs/evidence/TASK-0231/**
  - docs/handoffs/TASK-0231.json
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
  - docs/evidence/TASK-0231/governance-gap-quarantine.json
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
      必要时严格串行拆卡；append-only 记录不得合法化历史闭合、不得追溯授权、
      不得伪造 PASS。本卡按 TASK-0197 REJECTED → TASK-0198 继承先例，把
      TASK-0231 REJECTED 终态已落地的 quarantine 制品登记为唯一权威记录
      （新 recordId，不复制、不二次消费 0231 的 recordId），不修改任何历史
      制品，不改变失败/安全/契约语义。不编造 sourceThreadId。
independentReview: not-required
reviewers: []
requiredCommands:
  - PATH=/Users/hxf/.zcode/venvs/vc-harness/bin:$PATH python scripts/harness/precheck.py --task TASK-0232
  - PATH=/Users/hxf/.zcode/venvs/vc-harness/bin:$PATH python docs/evidence/TASK-0232/verify_registry.py
  - git diff --check
```

> 本卡为独立延续单卡，不写 planningBacklog/planningContractHash。永久 ID 由机器真源派生：
> Task Ledger 现存最大编号为 TASK-0231（REJECTED），仓库内无既有 TASK-0232 引用，intake 分配本号。
> 本卡是 TASK-0231（SLICE-AUTHORIZATION quarantine 卡，REJECTED 闭合）的继承登记片。
> 本卡不实现 Harness 变更，不预占 SLICE-GOVERNANCE/HISTORY 后继 ID。

## 背景与用户可观察目标

TASK-0231 以 REJECTED 诚实闭合（5f829b6）：三组治理缺口的 quarantine JSON
（governance-gap-quarantine.json）与只读核验脚本（verify_quarantine_contract.py）已真实落地
于 `docs/evidence/TASK-0231/`，verify 真实 PASS，但卡本身因 IN_PROGRESS 误改 immutable
metadata（授权投影漂移）而 canonical precheck FAIL，不能以 ACCEPTED 描述。

按 TASK-0197 REJECTED → TASK-0198 继承先例，本卡把 TASK-0231 终态已落地的制品以
blob/contentSha256 精确绑定，登记为唯一权威治理记录（新 recordId，不复制、不二次消费
TASK-0231 的 recordId），使 Owner 后续决策（接受 quarantine / 补验证 / SLICE-GOVERNANCE
收紧 Doctor）有单一机器可验证入口。

用户可观察目标：仓库出现一份绑定 TASK-0231 终态制品的登记 JSON；当前仓库可验证，
且 14 张卡的验证缺口、0209/0210 授权缺口与 exact-tree fallback 证据缺口均已处于
机器可验证的登记状态。

## 范围内

- 实现 `docs/evidence/TASK-0232/quarantine-registry.json`：唯一权威登记记录，
  绑定 TASK-0231 终态提交/树、quarantine JSON 与 verify 脚本的 blob/contentSha256、
  三组 groupId、正确的 TASK-0210 ACCEPTED 完整 SHA
  （1e8922ca7394655657f68a9379315116f2e6e91b）。
- 实现只读核验脚本 `docs/evidence/TASK-0232/verify_registry.py`：对正确登记 PASS，
  对故意漂移（改 blob/SHA/recordId/声明/删组）FAIL。
- 本卡治理制品与终态闭合。

## 明确范围外

- 不修改 TASK-0231 及更早的任何卡、Context Lock、Evidence、Handoff、Ledger 条目或提交。
- 不复制或二次消费 `OWNER-MAINT-20260816-TASK-0231-GOVERNANCE-GAP-QUARANTINE-01`。
- 不修改 `scripts/harness/**`、`.harness/**` 策略或任何保护路径。
- 不补跑 14 张卡的历史验证并追溯写成 PASS；不追造 Owner 授权。
- 不 push / merge / rebase / reset / 历史改写。

## 输入和前置条件

- Base Commit：`5f829b6c6d62c5fb5c03dcdc4474eab3b729d204`（TASK-0231 REJECTED 终态）。
- 仓库 idle：`activeTask=null`，工作树与 Index 干净。
- TASK-0231 终态制品的身份以 Base Commit 处的 Git 对象为准。

## API / 事件 / 数据契约

- 不修改 OpenAPI、catalog、contracts、events、数据库。
- 登记 JSON 只维持历史可验证性，不构成通用豁免。

## 权限、RLS 和数据处理要求

- 不触数据库、RLS 或业务数据。
- 写路径均为 C2 task-intake 治理制品；不申请 harness-change 人工批准。

## 状态机和失败行为

- 本卡单面 AUTHORIZATION，`splitDecision: KEEP`。
- 登记 JSON 任一身份字段漂移 → verify FAIL。
- 绑定 blob/contentSha256 与 Base Commit Git 对象不一致 → FAIL。
- 复制 0231 recordId 或二次消费 → FAIL。
- 把 NOT_RUN/FAIL 改写成 PASS、追述合法闭合或追造授权 → FAIL。

## 模型、Prompt、记忆和安全边界

- 不涉及模型、prompt、记忆或安全模块。

## 验收标准

1. `docs/evidence/TASK-0232/quarantine-registry.json` 存在，全部身份字段与卡内
   `quarantineRegistry` 合同一致，且 blob/contentSha256 与 Base Commit 处
   TASK-0231 制品真实 Git 对象一致。
2. 登记 JSON 声明 `doesNotLegitimizeAnyClosure: true` 与
   `doesNotRetroactivelyAuthorize: true`；0231 记录保持绑定 0231。
3. 核验脚本对正确登记 PASS，对故意漂移 FAIL。
4. Diff 不包含 Harness、历史制品或保护路径。
5. 冻结 requiredCommands 真实执行；FAIL/NOT_RUN 不得改写成 PASS。

## 必跑检查

冻结命令见 YAML `requiredCommands`（canonical precheck、verify_registry.py、
`git diff --check`）。READY 后真实跑 `doctor.py --task TASK-0232`；候选冻结后
真实跑官方 `precheck.py --task TASK-0232` 与
`doctor.py --task TASK-0232 --pre-closure`。未跑不得写成 PASS。

## 回滚或前向修复

- 只允许本卡 writeAllowlist 在 `maximumFixBatches: 1` 内修订。
- 需要修改 Harness 或历史制品时立即停止。

## 停止条件

- 需要修改 writeAllowlist 外路径、复制 0231 recordId 或把 NOT_RUN/失败转为
  PASS 立即停止。

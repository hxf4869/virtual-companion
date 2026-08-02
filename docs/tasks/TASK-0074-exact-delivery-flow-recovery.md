# TASK-0074：精确交付流程与 parent-edge 前向恢复

```yaml
taskId: TASK-0074
state: READY
owner: repository-owner
riskClass: C4
requiredSkills:
  - task-delivery-flow
  - task-intake
  - harness-change
requiredSkillVersions:
  task-delivery-flow: 1.3.2
  task-intake: 1.2.2
  harness-change: 1.1.2
targetSkillVersions:
  task-delivery-flow: 1.3.3
  task-intake: 1.2.3
  harness-change: 1.1.3
baseCommit: 65fbb6e8f3e40ab7b5aa4b0daa7e6a679f977a94
authorizationCommit: ""
contextFingerprint: 76dbcd2ec93b37a9c52bbb99f5f40d94243f8309c6be1f7a34e96c17cd56af48
contextLock: docs/tasks/context/TASK-0074.context-lock.yaml
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
  overallElapsed:
    anchor: DRAFT_COMMIT
    terminal: TERMINAL_COMMIT
    recordingRequired: true
    resetOrReanchorForbidden: true
  intakeActivation:
    anchor: DRAFT_COMMIT
    terminal: READY_DOCTOR_TERMINAL
    targetWallMinutes: 60
    hardFuseWallMinutes: 90
    timeoutStatus: TIMEOUT
    closureOnlyOverrun: true
  candidateExecution:
    anchor: READY_DOCTOR_PASS_AND_IN_PROGRESS_COMMIT
    candidateDeadlineMinutes: 45
    targetWallMinutes: 60
    hardFuseWallMinutes: 90
    timeoutStatus: TIMEOUT
    closureOnlyOverrun: true
  reviewer:
    maximumMinutes: 15
    timeoutStatus: TIMEOUT
    missingTerminalStatus: UNKNOWN
complexityAssessment:
  policySource: .harness/task-delivery-policy.yaml
  evaluatedBefore: READY
  riskClass: C4
  surfaceId: TASK_0074_EXACT_DELIVERY_FLOW_AND_PARENT_EDGE_RECOVERY
  policySurfaces:
    - GOVERNANCE
    - AUTHORIZATION
    - HISTORY
  distinctCrossRiskSurfaces: 3
  reviewerMinutesEstimate: 15
  terminalCheckMinutesEstimate: 60
  estimatedWallMinutes: 90
  thresholdsTriggered:
    - CROSS_RISK_SURFACES
    - TERMINAL_CHECK_MINUTES
  splitRequired: false
  ownerIndivisibleAuthorization: true
  indivisibleReason: >-
    Owner 只授权一条以 65fbb6e8 为 Base 的精确一次性恢复链；唯一
    pre-READY maintenance 必须先恢复普通 READY Doctor，随后同卡才能把
    TASK-0056 与 delivery-policy core 从永久 REJECTED 的 TASK-0073
    前向迁移到 TASK-0074。拆分会留下无法通过普通 READY 门禁或无法释放
    TASK-0056 的半卡。
preReadyMaintenancePlan:
  recordId: OWNER-MAINT-20260802-TASK-0074-PRE-READY-01
  recordPath: docs/evidence/TASK-0074/pre-ready-maintenance-authorization.json
  kind: OWNER_AUTHORIZED_EXACT_ONE_TIME_PRE_READY_MAINTENANCE
  directSingleParentFromDraftRequired: true
  pathSetFrozenAtDraft: true
  additionsOrRemovalsForbidden: true
  oneTimeOnly: true
  reusable: false
  consumedRecordMustBecomeInert: true
  exactPaths:
    - .harness/ci-execution-policy.yaml
    - .harness/task-delivery-policy.yaml
    - .harness/skills.yaml
    - docs/evidence/TASK-0074/pre-ready-maintenance-authorization.json
    - docs/schemas/evidence-pack.schema.json
    - docs/schemas/handoff.schema.json
    - scripts/harness/doctor.py
    - scripts/harness/tests/test_harness.py
    - skills/harness-change/SKILL.md
    - skills/task-delivery-flow/SKILL.md
    - skills/task-intake/SKILL.md
  exactIdentityBinding:
    - BASE_COMMIT_AND_TREE
    - DRAFT_COMMIT_AND_TREE
    - MAINTENANCE_COMMIT_AND_TREE
    - SORTED_PATH_SET
    - PATH_MODE_TYPE_BLOB
    - PATH_SHA256_AND_CONTENT
    - EXACT_OWNER_AUTHORIZATION
  forbiddenInterfaces:
    - SECOND_RECORD_OR_CONSUMPTION
    - OTHER_TASK
    - EXTRA_COMMIT_OR_PATH
    - ENVIRONMENT_OR_CLI_BYPASS
    - GIT_NOTE_REPLACE_OR_GRAFT
    - HISTORY_REWRITE
    - CONFIGURABLE_ALLOWLIST
    - GENERAL_OVERRIDE
historicalQuarantine:
  taskId: TASK-0073
  terminalCommit: 65fbb6e8f3e40ab7b5aa4b0daa7e6a679f977a94
  terminalTree: 5649336f93a8efdecdf0b7213966808e4bd629ed
  immutableOutcome: REJECTED
  passClaimed: false
  evidence:
    path: docs/evidence/TASK-0073/evidence-pack.json
    mode: "100644"
    type: blob
    blob: 6b123197348ad1391fd4953f5ce6741d0b616ad7
    sha256: 22dc47792bb08227709c6c67b9e7d47490604a7ac567182acd1ff642d4a06221
  review:
    path: docs/evidence/TASK-0073/review-r1.md
    mode: "100644"
    type: blob
    blob: 22326ae61ea43ba86565bb96b4c2fd78c68bbecf
    sha256: c92fa49e6d996fd9221ba884c3f6b6acb4feab16a7869c58da8287dd356913c5
  exactReviewerTuple:
    command: Independent Reviewer R1 for TASK-0073 frozen candidate
    nativeResult: UNKNOWN
    storedStatus: FAIL
    exitCode: null
    artifactHash: null
    candidateCommit: 11e6fb12f77486787ef71627e84f34ee069e72bd
    candidateTree: 36e22afcc810cca0630e159568d2acf03845441d
    reason: "BUDGET_FUSED_WITHOUT_TERMINAL_OUTPUT: 唯一 fork_turns=none Reviewer 到 8 分钟预算仍为 running，未返回终态；原生结果是 UNKNOWN/NOT_PASS，终态 Schema 中映射为 Reviewer gate FAIL。"
  copiedOrMutatedTupleMustFailClosed: true
validationPlan:
  frozenBefore: READY
  policySource: .harness/ci-execution-policy.yaml
  selectedChannel: LOCAL_EXACT_TREE_FALLBACK
  profile: HARNESS_PORTABILITY_LOCAL
  candidateBinding:
    commitAndTreeRequired: true
    cleanWorktreeAndIndexRequired: true
    rerunAfterInputChange: true
  reviewer:
    requiredOutcome: PASS
    forkTurns: none
    maximumMinutes: 15
    implementationForbidden: true
    repositoryWritesForbidden: true
    fullDoctorCanonicalOrPlatformSuiteForbidden: true
  windows:
    requiredOutcome: PASS
    kind: COMBINED_CANDIDATE_CANONICAL_AND_WINDOWS_EXACT_TREE
    argv: python scripts/harness/precheck.py --profile harnessPortabilityLocal --task TASK-0074
    durableReceiptRequired: true
    eachCanonicalSubcommandExactlyOnce: true
    aliasCacheOrSkipForbidden: true
    exactSubcommands:
      - python -m unittest discover -s scripts/harness/tests -p test_*.py
      - python scripts/harness/doctor.py --task TASK-0074
      - python scripts/harness/catalog_tool.py validate
      - python scripts/harness/catalog_tool.py drift
      - python scripts/harness/check_paid_features.py
      - python scripts/harness/check_beta_gate.py
    canonicalSubset:
      - python scripts/harness/doctor.py --task TASK-0074
      - python scripts/harness/catalog_tool.py validate
      - python scripts/harness/catalog_tool.py drift
      - python scripts/harness/check_paid_features.py
      - python scripts/harness/check_beta_gate.py
    os: Windows-NT-10.0.26200
    python: 3.12.9
    powershell: 7.6.3
  wsl:
    requiredOutcome: PASS
    startsOnlyAfterWindowsPass: true
    distribution: Ubuntu-24.04
    isolation: GIT_ARCHIVE_EXACT_CANDIDATE_TO_WSL_MKTEMP
    argv: bash scripts/harness/precheck.sh --profile harnessPortabilityLocal --task TASK-0074
  macos:
    requiredOutcome: DEFERRED_NOT_CLAIMED
    residualRisk: >-
      本机没有受控 macOS exact-tree 环境；本卡不声称 macOS PASS。
  remote:
    outcome: UNKNOWN_NOT_RUN
    reasonType: OWNER_QUOTA_EVIDENCE_EXPIRED
    currentQuotaVerified: false
    dispatchCount: 0
    passClaimed: false
  localFallbackActivation:
    scope: TASK_0074_ONLY
    ownerAuthorized: true
    remoteStatusMustRemainNonPass: true
    globalUnknownQuotaBehaviorUnchanged: true
    evidence: >-
      Owner 只允许本卡使用 READY 冻结的 Windows 合并门禁与
      Ubuntu-24.04 WSL exact-tree；不得 dispatch、重跑或轮询 GitHub
      Actions，远端固定保持 UNKNOWN_NOT_RUN /
      OWNER_QUOTA_EVIDENCE_EXPIRED / dispatch=0 / passClaimed=false。
  terminalMetadataOnly:
    requiredCommitMarker: "[skip ci]"
    implementationTreeMustRemainVerified: true
    neverRepresentsCiPass: true
readAllowlist:
  - .gitattributes
  - AGENTS.md
  - .harness/**
  - docs/evidence/TASK-0055/**
  - docs/evidence/TASK-0069/**
  - docs/evidence/TASK-0070/**
  - docs/evidence/TASK-0071/**
  - docs/evidence/TASK-0072/**
  - docs/evidence/TASK-0073/**
  - docs/handoffs/TASK-0055.json
  - docs/handoffs/TASK-0069.json
  - docs/handoffs/TASK-0070.json
  - docs/handoffs/TASK-0071.json
  - docs/handoffs/TASK-0072.json
  - docs/handoffs/TASK-0073.json
  - docs/schemas/**
  - docs/tasks/**
  - requirements-harness.txt
  - scripts/harness/**
  - skills/**
writeAllowlist:
  - .harness/ci-execution-policy.yaml
  - .harness/project-state.yaml
  - .harness/skills.yaml
  - .harness/task-backlog.yaml
  - .harness/task-delivery-policy.yaml
  - .harness/task-ledger.yaml
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
  - docs/tasks/TASK-0056-idle-planning-checkpoint-consumers-ci-closure.md
  - docs/tasks/TASK-0074-exact-delivery-flow-recovery.md
  - docs/tasks/context/TASK-0074.context-lock.yaml
  - docs/evidence/TASK-0074/**
  - docs/handoffs/TASK-0074.json
  - scripts/harness/doctor.py
  - scripts/harness/tests/test_harness.py
  - skills/harness-change/SKILL.md
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
forbiddenPaths:
  - .gitattributes
  - AGENTS.md
  - CLAUDE.md
  - .github/**
  - ci/**
  - .harness/agent-entrypoints.yaml
  - .harness/commands.yaml
  - .harness/invariants.yaml
  - .harness/license-policy.yaml
  - .harness/paid-feature-denylist.yaml
  - .harness/phase-scope.yaml
  - .harness/protected-paths.yaml
  - .harness/sources-of-truth.yaml
  - .harness/task-lifecycle.yaml
  - .harness/tools.lock.yaml
  - docs/evidence/OWNER-MAINT-20260801-READY-GREENLINE-01/**
  - docs/evidence/TASK-0055/**
  - docs/evidence/TASK-0069/**
  - docs/evidence/TASK-0070/**
  - docs/evidence/TASK-0071/**
  - docs/evidence/TASK-0072/**
  - docs/evidence/TASK-0073/**
  - docs/handoffs/OWNER-MAINT-20260801-READY-GREENLINE-01.json
  - docs/handoffs/TASK-0055.json
  - docs/handoffs/TASK-0069.json
  - docs/handoffs/TASK-0070.json
  - docs/handoffs/TASK-0071.json
  - docs/handoffs/TASK-0072.json
  - docs/handoffs/TASK-0073.json
  - docs/tasks/TASK-0049-idle-planning-checkpoint-core-replacement.md
  - docs/tasks/TASK-0055-idle-planning-checkpoint-core-replacement.md
  - docs/tasks/TASK-0057-harness-timing-cross-filesystem-performance-engine.md
  - docs/tasks/TASK-0058-harness-path-aware-ci-wrapper-strategy.md
  - docs/tasks/TASK-0059-harness-snapshot-receipt-evidence-gate.md
  - docs/tasks/TASK-0069-harness-portability-local-history-recovery.md
  - docs/tasks/TASK-0070-backlog-draft-promotion-base-card-snapshot-recovery.md
  - docs/tasks/TASK-0071-idle-planning-checkpoint-core-replacement.md
  - docs/tasks/TASK-0072-exact-self-bootstrap-ratification.md
  - docs/tasks/TASK-0073-pre-ready-greenline-parent-edge-recovery.md
  - docs/tasks/task-card-template.md
  - requirements-harness.txt
  - scripts/harness/catalog_tool.py
  - scripts/harness/check_beta_gate.py
  - scripts/harness/check_paid_features.py
  - scripts/harness/durable_command.ps1
  - scripts/harness/harness_common.py
  - scripts/harness/precheck.py
  - scripts/harness/precheck.ps1
  - scripts/harness/precheck.sh
  - skills/catalog-change/**
  - skills/contract-change/**
  - skills/database-migration/**
  - skills/memory-change/**
  - skills/model-routing-change/**
  - skills/safety-change/**
  - specs/**
  - service/**
  - frontend/**
  - db/**
  - deploy/**
  - ops/**
  - docs/source/**
sourcesOfTruth:
  - .gitattributes
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
  - skills/harness-change/SKILL.md
  - scripts/harness/doctor.py
  - scripts/harness/durable_command.ps1
  - scripts/harness/harness_common.py
  - scripts/harness/precheck.py
  - scripts/harness/precheck.ps1
  - scripts/harness/precheck.sh
  - scripts/harness/tests/test_harness.py
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
  - docs/tasks/TASK-0056-idle-planning-checkpoint-consumers-ci-closure.md
  - docs/tasks/TASK-0071-idle-planning-checkpoint-core-replacement.md
  - docs/tasks/TASK-0072-exact-self-bootstrap-ratification.md
  - docs/tasks/TASK-0073-pre-ready-greenline-parent-edge-recovery.md
  - docs/evidence/TASK-0071/evidence-pack.json
  - docs/evidence/TASK-0071/review-r1.md
  - docs/evidence/TASK-0071/review-r2.md
  - docs/evidence/TASK-0072/evidence-pack.json
  - docs/evidence/TASK-0072/review-r1.md
  - docs/evidence/TASK-0073/evidence-pack.json
  - docs/evidence/TASK-0073/review-r1.md
  - docs/handoffs/TASK-0071.json
  - docs/handoffs/TASK-0072.json
  - docs/handoffs/TASK-0073.json
requiredInvariants:
  - INV-HARNESS-001
  - INV-HARNESS-002
  - INV-HARNESS-003
  - INV-HARNESS-004
  - INV-HARNESS-005
  - INV-HARNESS-006
  - INV-HARNESS-007
  - INV-HARNESS-008
  - INV-HARNESS-009
humanApprovals:
  - scope: harness-change
    approvedBy: repository-owner
    approvedAt: "2026-08-02"
    sourceThreadId: 019fb2c1-8104-73b1-81dc-ee8bcfce6f63
    evidence: "授权 TASK-0074 精确一次性交付流程恢复：以 65fbb6e8f3e40ab7b5aa4b0daa7e6a679f977a94 为 Base，允许唯一 machine-recognized pre-READY maintenance commit：精确隔离 TASK-0073 终态中已绑定 Commit/Tree/Blob 的 Reviewer UNKNOWN 历史记录；为未来 Evidence 增加明确的 TIMEOUT/UNKNOWN 非 PASS 语义；将 DRAFT→READY 与 IN_PROGRESS 后执行预算分开计时，Reviewer 上限固定为 15 分钟；允许同一精确候选上的完整 canonical 与 Windows exact-tree 合并为一次不删测、不降级的证据门禁，WSL 仍独立执行。禁止修改历史产物、通用 override、复用或绕过。普通 READY Doctor PASS 后才能实施，并将 TASK-0056 依赖迁移至 TASK-0074，完整执行独立 Reviewer、合并门禁、WSL、pre-closure 与安全推送。"
  - scope: task-0074-local-exact-tree-fallback
    approvedBy: repository-owner
    approvedAt: "2026-08-02"
    evidence: >-
      GitHub Actions 固定 UNKNOWN_NOT_RUN / OWNER_QUOTA_EVIDENCE_EXPIRED /
      dispatch=0 / passClaimed=false；Reviewer PASS 后只对同一冻结
      TASK-0074 Commit/Tree 启动一次 Windows 合并门禁，Windows PASS 后
      才启动一次 WSL exact-tree。
independentReview: required
reviewers: []
requiredCommands:
  - python -m unittest scripts.harness.tests.test_harness.Task0074PreReadyMaintenanceTests.test_exact_machine_record_is_accepted scripts.harness.tests.test_harness.Task0074PreReadyMaintenanceTests.test_machine_record_mutations_fail_closed scripts.harness.tests.test_harness.Task0074HistoricalQuarantineTests.test_exact_task0073_unknown_tuple_is_quarantined scripts.harness.tests.test_harness.Task0074HistoricalQuarantineTests.test_identity_or_tuple_mutations_fail_closed scripts.harness.tests.test_harness.Task0074EvidenceSemanticsTests.test_timeout_unknown_fail_and_pass_are_strongly_typed scripts.harness.tests.test_harness.Task0074EvidenceSemanticsTests.test_nonpass_requires_candidate_budget_and_interruption scripts.harness.tests.test_harness.Task0074DeliveryContractTests.test_two_stage_budget_anchors_are_exact scripts.harness.tests.test_harness.Task0074DeliveryContractTests.test_combined_windows_gate_is_complete_once_and_candidate_bound scripts.harness.tests.test_harness.BacklogTests.test_task0074_replacement_is_exact_and_atomic scripts.harness.tests.test_harness.IdlePlanningCheckpointTests.test_accepts_no_tail_and_serial_rejected_superseded_edges scripts.harness.tests.test_harness.IdlePlanningCheckpointTests.test_accepts_optional_next_action_and_no_promotable_state scripts.harness.tests.test_harness.IdlePlanningCheckpointTests.test_rejects_merge_empty_split_multiple_and_extra_paths scripts.harness.tests.test_harness.IdlePlanningCheckpointTests.test_rejects_mode_contract_task_mismatch_and_restore_after_error
  - git diff --check
  - python scripts/harness/doctor.py --task TASK-0074
  - python scripts/harness/precheck.py --profile harnessPortabilityLocal --task TASK-0074
  - bash scripts/harness/precheck.sh --profile harnessPortabilityLocal --task TASK-0074
  - python scripts/harness/doctor.py --task TASK-0074 --pre-closure
```

## 背景与用户可观察目标

TASK-0073 已永久 REJECTED；其 parent-edge core 保留在当前 Base，但终态 Evidence
把 Reviewer 原生 UNKNOWN 映射成了 `FAIL + exitCode:null`，旧 Doctor 因而只报
一个全局机械错误。该历史文件、Review、Commit、Tree 与 Blob 均不可修改，也不
能被解释为 PASS。

用户最终可观察到：唯一 TASK-0074 pre-READY maintenance 精确隔离这一份不可变
历史非 PASS，未来 Evidence/Handoff 能强类型表达 TIMEOUT/UNKNOWN，交付预算拆为
intake/activation 与 candidate execution 两阶段，且 Harness/Portability 卡能在
同一 Windows durable receipt 上完整执行一次 canonical 与 Windows exact-tree。
普通 READY Doctor 真实 PASS 后，TASK-0056 与 delivery-policy core 才从失败的
TASK-0073 前向迁移到 TASK-0074。

## 范围内

- DRAFT 后唯一直接单父 maintenance commit：建立 TASK-0074 专用、一次性、
  消费后惰性的机器记录，绑定 Base、DRAFT、maintenance Commit/Tree、冻结路径
  集合及逐路径 mode/type/blob/content 与 Owner 原文；
- 只对 TASK-0073 terminal `65fbb6e...` / Tree `5649336...` 上两份固定
  Blob/SHA 和精确 Reviewer command/reason/native UNKNOWN 元组建立不可变历史
  non-PASS quarantine；错误身份、复制、改变字段或第二条记录失败关闭；
- 为未来正式 Evidence/Handoff 增加 TIMEOUT、UNKNOWN 强类型非 PASS：
  FAIL 仍必须是真实非零 exitCode，PASS 仍必须是真实 exit 0；合法 null
  exitCode/artifact 必须同时有原因、candidate SHA/Tree、预算和中断观察；
- 把 DRAFT 到 READY Doctor 终态与 READY Doctor PASS/IN_PROGRESS 后的 candidate
  执行分开计时，同时保留不可重锚的总时长记录；
- Reviewer 上限固定 15 分钟；未返回时原生 TIMEOUT/UNKNOWN，不伪造 FAIL；
- 对 READY 冻结的 HARNESS/PORTABILITY profile，Windows 一次 durable receipt
  完整执行 harness tests 与五个 canonical 子命令各恰好一次，同时满足 candidate
  canonical 与 Windows exact-tree；WSL 仍独立；
- READY Doctor PASS 后，保留并重新验证 Base 的 parent-edge core，不继承旧
  PASS，把 TASK-0056 Card/Backlog dependency 与 delivery-policy core 从
  TASK-0073 原子迁移到 TASK-0074。

## 明确范围外

- 修改 TASK-0055、TASK-0071、TASK-0072、TASK-0073 的历史 Card、Evidence、
  Review、Handoff、Ledger 事实，或把旧 PASS/FAIL/UNKNOWN/NOT_RUN 当作本卡结果；
- 通用 break-glass、override framework、可配置 allowlist、环境变量、CLI bypass、
  Git note/replace/graft、历史改写、第二条记录、第二次消费或额外 maintenance；
- 接线四消费者、修改 Git/history 性能引擎、workflow、durable runner、precheck
  wrapper、commands profile、产品、Provider、数据库、H5、身份、凭据或真实外发；
- dispatch、重跑、轮询 GitHub Actions，或付费、自托管绕过免费分钟限制。

## 输入和前置条件

- Base Commit `65fbb6e8f3e40ab7b5aa4b0daa7e6a679f977a94` / Tree
  `5649336f93a8efdecdf0b7213966808e4bd629ed`；`main`、单工作树、clean，
  `origin/main=a737f223...`，创建前 ahead/behind `24/0`；
- `activeTask=null`、`lastTerminalTask=TASK-0073`、TASK-0074 未占用；
- 初始化 durable Doctor 真实 exit 1 / 347950 checks，唯一错误是
  `docs/evidence/TASK-0073/evidence-pack.json checks[5]: FAIL requires non-zero exitCode`；
- TASK-0073 terminal Evidence/Review 的 Blob、SHA 与 Reviewer tuple 只作为
  immutable historical non-PASS 输入，不是本卡当前 PASS；
- Owner 精确授权文本 SHA-256
  `4a107e1c6c4d42d773c6d727ed3c9a5e6ba83bbd54294d997f01f9b20e7eacd4`。

## API / 事件 / 数据契约

不修改业务 API、事件、数据库、Catalog 或产品协议。新增合同仅限 TASK-0074
精确 maintenance record、TASK-0073 immutable historical quarantine、未来
Evidence/Handoff 的 TIMEOUT/UNKNOWN 非 PASS、双阶段预算和精确合并门禁。

## 权限、RLS 和数据处理要求

只读取离线 Git 对象并使用合成 fixture；不读取凭据、真实用户或模型数据，
不访问真实 Provider，不修改数据库、容器、账号、权限或仓库可见性。

## 状态机和失败行为

严格执行 `DRAFT -> READY -> IN_PROGRESS -> IN_REVIEW -> ACCEPTED`；maintenance
是 DRAFT 后、READY 前唯一机器识别的直接单父边，不是新状态。maintenance 后
必须建立普通 READY 授权和独立 `authorizationCommit`；READY Doctor 真实 exit 0
前禁止 IN_PROGRESS。

DRAFT commit 是 intake/activation anchor；该阶段在 READY Doctor 终态结束。
只有 READY Doctor PASS 且提交 IN_PROGRESS 后，candidate deadline/target/hard
fuse 才开始。总时长仍从 DRAFT 到 terminal 连续记录，禁止 reset/reanchor 隐藏
已经过去的时间。任一阶段超时只允许 closure-only overrun。

Reviewer 前目标矩阵与唯一 `git diff --check` 必须 PASS。R1 覆盖完整验收；最多
一批集中前向修复和唯一 R2，禁止 R3。Reviewer 15 分钟无终态时真实记录
TIMEOUT/UNKNOWN，立即停止后续长门禁并诚实闭包。

## 模型、Prompt、记忆和安全边界

不修改模型、Prompt、Canonical Memory、安全政策或 Persona；不引入第二套规则、
任务、状态、Evidence、Handoff 或 SaaS-only 必需运行时。

## 验收标准

1. TASK-0074 record 只接受精确 Base、DRAFT parent、唯一直接单父 maintenance
   Commit/Tree、排序且唯一的 11 条路径及逐文件 `100644 blob`/OID/SHA/content；
   其他 Task、copied record、第二次消费、额外提交/路径或禁止接口失败关闭。
2. TASK-0073 只以 terminal Commit/Tree 上固定 Evidence/Review Blob/SHA 和精确
   Reviewer tuple 被识别为 immutable historical non-PASS；错误身份、复制或任一
   字段漂移 FAIL，且 TASK-0073 仍是 REJECTED。
3. Evidence/Handoff Schema、Doctor、tests、policy 与 Skills 一致表达 TIMEOUT/
   UNKNOWN；其 null exitCode/artifact 必须有非空原因、candidate SHA/Tree、预算
   和中断观察；FAIL 仍要求真实非零 exitCode，PASS 仍要求真实 exit 0。
4. 双阶段预算精确冻结 anchor、start/end、timeout 与 closure-only overrun；
   candidate 预算只能在 READY Doctor PASS/IN_PROGRESS 后启动，总时长不可重锚。
5. Reviewer 最大 15 分钟；只接受唯一 `fork_turns=none`、只读、结构化
   P0/P1/P2/AC/invariant 结论；未返回时不伪造 FAIL。
6. Windows 合并门禁只适用于 READY 冻结 HARNESS/PORTABILITY profile，同一
   clean exact Commit/Tree、同一 durable receipt，完整子命令各恰好一次；不是
   alias/cache/skip，结果变化不降级 profile；WSL 在 Windows PASS 后独立执行。
7. 普通 READY Doctor 真实 exit 0 后才有 IN_PROGRESS；TASK-0056 Card/Backlog
   dependency 与 delivery-policy core 只在一个授权单父边从 TASK-0073 迁移到
   TASK-0074；TASK-0055/0071/0072/0073 仍为 REJECTED。
8. 当前 parent-edge core 正负矩阵重新 PASS，四消费者、性能引擎、workflow、
   产品与 receipt transport 范围不变。
9. Reviewer、Windows 合并门禁、WSL 与 pre-closure 全部绑定同一实现 SHA/Tree
   并真实 PASS 才可 ACCEPTED。
10. GitHub 固定 `UNKNOWN_NOT_RUN / OWNER_QUOTA_EVIDENCE_EXPIRED / dispatch=0 /
    passClaimed=false`，macOS 为 `DEFERRED_NOT_CLAIMED`，均不代表 PASS。
11. 终态 `[skip ci]` 安全推送后 `main == origin/main`、ahead/behind `0/0`、
    clean、`activeTask=null`。

## 必跑检查

以 YAML `requiredCommands` 的精确 argv 为准。先完成秒级自绑定矩阵和唯一
`git diff --check`，再冻结 clean candidate。唯一 Reviewer PASS 后只启动一次
Windows 合并门禁；PASS 后只启动一次 WSL exact-tree；然后生成 Evidence/Handoff、
完整暂存 closure 并只启动一次 pre-closure。

所有预计超过 60 秒的 Doctor/合并门禁/pre-closure 使用同一 durable atomic
runner；本任务 runner 已通过真实 exit-7 smoke。每个长命令只启动一个进程，
约 60 秒只检查 receipt 是否存在，发布后一次读取 receipt/stdout/stderr，不查
PID/status/log，不重启。

## 回滚或前向修复

保持 `main` 与单父前向历史；不切分支、不建 worktree、不 reset、rebase、
amend、squash 或改写历史。只有 R1 发现本卡授权范围内真实缺陷时，允许一批
集中前向修复和唯一 R2；不得扩大 allowlist、接线消费者或复用历史候选结果。

## 停止条件

- maintenance 不是 DRAFT 的唯一直接单父子提交，或需要第二条记录/消费、
  额外提交/路径、通用 bypass、历史改写或改变冻结路径；
- READY Doctor 非 0、receipt 缺失/身份不匹配或结果 UNKNOWN；
- 任一阶段 hard fuse、Reviewer 15 分钟 TIMEOUT/UNKNOWN、需要 R3/第二批修复，
  或 R2 出现新结构性 P0/P1；
- Windows 合并门禁或 WSL 非 PASS，或必须修改 workflow/durable helper/commands/
  precheck/产品/四消费者；
- 候选、Context、Skill、Reviewer、receipt 或终态 Evidence 无法精确绑定。

hard fuse 后停止实现、修复、Reviewer、canonical 与平台验证；若仓库 active 或
半闭环，只允许 Evidence/Handoff、一次 pre-closure、terminal commit、push 与
远端 `0/0` 的 closure-only overrun，期间禁止实现。

## Evidence Pack

输出 `docs/evidence/TASK-0074/` 与 `docs/handoffs/TASK-0074.json`。PASS 只绑定
实际执行与精确 Commit/Tree；FAIL 必须有真实非零 exitCode；TIMEOUT、UNKNOWN、
NOT_RUN、DEFERRED_NOT_CLAIMED 与历史隔离永不转换为 PASS。

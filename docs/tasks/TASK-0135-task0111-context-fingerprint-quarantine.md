# TASK-0135：TASK-0111 Context Fingerprint 历史精确隔离与 P2-20 正式承接

```yaml
taskId: TASK-0135
state: IN_PROGRESS
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
baseCommit: 2fe3e470bb499aa1e968d6acd2d23f7421757077
authorizationCommit: 57ef739e2657a1eabf821209447da3349653b5f1
contextFingerprint: 7cd663f1072905dc5d9517033a40d248dd55a8104176dd134e0ff61658ac1490
contextLock: docs/tasks/context/TASK-0135.context-lock.yaml
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
  surfaceId: TASK_0135_TASK0111_CONTEXT_FINGERPRINT_QUARANTINE
  policySurfaces: [GOVERNANCE, AUTHORIZATION, HISTORY]
  distinctCrossRiskSurfaces: 3
  reviewerMinutesEstimate: 15
  terminalCheckMinutesEstimate: 20
  estimatedWallMinutes: 75
  thresholdsTriggered: [crossRiskSurfaces]
  splitRequired: false
  ownerIndivisibleAuthorization: true
  indivisibleReason: >-
    TASK-0111 的固定 REJECTED 身份、错误 context fingerprint、终态产物与唯一测试放行点必须在同一
    fail-closed predicate 中原子绑定；拆分会使 ContextTests 无法建立可验证绿线，后一张卡则依赖尚未
    生效的历史隔离。Owner 已明确批准按该前向恢复方案执行。
rejectedHistoryQuarantine:
  taskId: TASK-0111
  cardPath: docs/tasks/TASK-0111-auth-input-hygiene.md
  baseCommit: a3a294d19b8024bc52fa08eb052fa7a957b046ee
  draftCommit: 54ae758faac0d1ab30a645cd5400b80cdfaba2d7
  readyAuthorizationCommit: 90e1bc36341c6227966a7c4b96bf1066ab6668ea
  readyTree: e4f81f83226efb2a91667b173c0828a7bafc3156
  authorizationBindingCommit: 3280efb70e04cdb38df635489cd575c7f666a48d
  terminalCommit: 9bfd47eea55aa2a485c77617a2581924d69dbe84
  terminalTree: 7ef159f539cb546f4920ac1f4b576f39310d942c
  contextLockPath: docs/tasks/context/TASK-0111.context-lock.yaml
  invalidFingerprint: deadcf31035ec180393998f0f0abf3ae77a5d3a3d07f49b83033a8242fe9a6a9
  actualFingerprint: 5a2147e0c5ea53a843aacdab6b4257da18421f7aedcb47f8221f980521f242e7
  terminalArtifacts:
    docs/tasks/TASK-0111-auth-input-hygiene.md: fdc23db227d596f68d37cfd7d5c7b84511ef0b5a620146150eb3da1593ec4605
    docs/tasks/context/TASK-0111.context-lock.yaml: 0bc99558fbd65b23116957cff1772780cf94deffb3d2c4c5f4243b5f5efda8d5
    docs/evidence/TASK-0111/evidence-pack.json: aa14ca8252e385eb505ef1d2521786eb068f6bd993c96fe3605210c62eb931d8
    docs/handoffs/TASK-0111.json: 917d018752ad66e5da9e3d3833d69bdb424736d5fa1700e4b51bec39219c484a
  expectedMismatchError: 'TASK-0111: context fingerprint mismatch (expected deadcf31035ec180393998f0f0abf3ae77a5d3a3d07f49b83033a8242fe9a6a9, got 5a2147e0c5ea53a843aacdab6b4257da18421f7aedcb47f8221f980521f242e7)'
validationPlan: {frozenBefore: READY, policySource: .harness/ci-execution-policy.yaml, selectedChannel: LOCAL_EXACT_TREE_FALLBACK, profile: precheck}
readAllowlist:
  - .gitattributes
  - .github/workflows/ci.yml
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
  - AGENTS.md
  - CLAUDE.md
  - docs/decisions/0003-portable-agent-harness.md
  - docs/evidence/TASK-0109/zcode-remediation-handoff.md
  - docs/evidence/TASK-0111/evidence-pack.json
  - docs/evidence/TASK-0133/evidence-pack.json
  - docs/evidence/TASK-0133/pre-closure-request.json
  - docs/evidence/TASK-0133/review-r1.md
  - docs/evidence/TASK-0134/evidence-pack.json
  - docs/evidence/TASK-0134/pre-closure-request.json
  - docs/evidence/TASK-0134/review-r1.md
  - docs/handoffs/TASK-0111.json
  - docs/handoffs/TASK-0133.json
  - docs/handoffs/TASK-0134.json
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
  - docs/tasks/TASK-0111-auth-input-hygiene.md
  - docs/tasks/context/TASK-0111.context-lock.yaml
  - docs/tasks/TASK-0133-harness-default-branch-fixture-portability.md
  - docs/tasks/context/TASK-0133.context-lock.yaml
  - docs/tasks/TASK-0134-task0133-harness-approval-quarantine.md
  - docs/tasks/context/TASK-0134.context-lock.yaml
  - docs/tasks/task-card-template.md
  - requirements-harness.txt
  - scripts/harness/doctor.py
  - scripts/harness/harness_common.py
  - scripts/harness/precheck.ps1
  - scripts/harness/precheck.py
  - scripts/harness/precheck.sh
  - scripts/harness/tests/test_harness.py
  - skills/harness-change/SKILL.md
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
writeAllowlist:
  - docs/tasks/TASK-0135-task0111-context-fingerprint-quarantine.md
  - docs/tasks/context/TASK-0135.context-lock.yaml
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - docs/evidence/TASK-0135/**
  - docs/handoffs/TASK-0135.json
  - scripts/harness/doctor.py
  - scripts/harness/tests/test_harness.py
forbiddenPaths:
  - docs/tasks/TASK-00*-*
  - docs/tasks/TASK-010*-*
  - docs/tasks/TASK-0110-*
  - docs/tasks/TASK-0111-*
  - docs/tasks/TASK-0112-*
  - docs/tasks/TASK-0113-*
  - docs/tasks/TASK-0114-*
  - docs/tasks/TASK-0115-*
  - docs/tasks/TASK-0116-*
  - docs/tasks/TASK-0117-*
  - docs/tasks/TASK-0118-*
  - docs/tasks/TASK-0119-*
  - docs/tasks/TASK-012*-*
  - docs/tasks/TASK-0130-*
  - docs/tasks/TASK-0131-*
  - docs/tasks/TASK-0132-*
  - docs/tasks/TASK-0133-*
  - docs/tasks/TASK-0134-*
  - docs/tasks/context/TASK-00*.context-lock.yaml
  - docs/tasks/context/TASK-010*.context-lock.yaml
  - docs/tasks/context/TASK-0110.context-lock.yaml
  - docs/tasks/context/TASK-0111.context-lock.yaml
  - docs/tasks/context/TASK-0112.context-lock.yaml
  - docs/tasks/context/TASK-0113.context-lock.yaml
  - docs/tasks/context/TASK-0114.context-lock.yaml
  - docs/tasks/context/TASK-0115.context-lock.yaml
  - docs/tasks/context/TASK-0116.context-lock.yaml
  - docs/tasks/context/TASK-0117.context-lock.yaml
  - docs/tasks/context/TASK-0118.context-lock.yaml
  - docs/tasks/context/TASK-0119.context-lock.yaml
  - docs/tasks/context/TASK-012*.context-lock.yaml
  - docs/tasks/context/TASK-0130.context-lock.yaml
  - docs/tasks/context/TASK-0131.context-lock.yaml
  - docs/tasks/context/TASK-0132.context-lock.yaml
  - docs/tasks/context/TASK-0133.context-lock.yaml
  - docs/tasks/context/TASK-0134.context-lock.yaml
  - docs/evidence/TASK-00*/**
  - docs/evidence/TASK-010*/**
  - docs/evidence/TASK-0110/**
  - docs/evidence/TASK-0111/**
  - docs/evidence/TASK-0112/**
  - docs/evidence/TASK-0113/**
  - docs/evidence/TASK-0114/**
  - docs/evidence/TASK-0115/**
  - docs/evidence/TASK-0116/**
  - docs/evidence/TASK-0117/**
  - docs/evidence/TASK-0118/**
  - docs/evidence/TASK-0119/**
  - docs/evidence/TASK-012*/**
  - docs/evidence/TASK-0130/**
  - docs/evidence/TASK-0131/**
  - docs/evidence/TASK-0132/**
  - docs/evidence/TASK-0133/**
  - docs/evidence/TASK-0134/**
  - docs/handoffs/TASK-00*.json
  - docs/handoffs/TASK-010*.json
  - docs/handoffs/TASK-0110.json
  - docs/handoffs/TASK-0111.json
  - docs/handoffs/TASK-0112.json
  - docs/handoffs/TASK-0113.json
  - docs/handoffs/TASK-0114.json
  - docs/handoffs/TASK-0115.json
  - docs/handoffs/TASK-0116.json
  - docs/handoffs/TASK-0117.json
  - docs/handoffs/TASK-0118.json
  - docs/handoffs/TASK-0119.json
  - docs/handoffs/TASK-012*.json
  - docs/handoffs/TASK-0130.json
  - docs/handoffs/TASK-0131.json
  - docs/handoffs/TASK-0132.json
  - docs/handoffs/TASK-0133.json
  - docs/handoffs/TASK-0134.json
  - .gitattributes
  - AGENTS.md
  - CLAUDE.md
  - README.md
  - .github/**
  - ci/**
  - requirements-harness.txt
  - scripts/dev/**
  - scripts/harness/catalog_tool.py
  - scripts/harness/check_beta_gate.py
  - scripts/harness/check_paid_features.py
  - scripts/harness/harness_common.py
  - scripts/harness/precheck.ps1
  - scripts/harness/precheck.py
  - scripts/harness/precheck.sh
  - scripts/harness/tests/__init__.py
  - skills/**
  - docs/schemas/**
  - docs/source/**
  - docs/decisions/**
  - docs/planning/**
  - docs/architecture/**
  - docs/engineering/**
  - docs/tasks/task-card-template.md
  - .harness/agent-entrypoints.yaml
  - .harness/ci-execution-policy.yaml
  - .harness/commands.yaml
  - .harness/invariants.yaml
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
  - specs/**
  - service/**
  - frontend/**
  - infra/**
  - .mvn/**
  - pom.xml
  - mvnw
  - mvnw.cmd
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
  - skills/harness-change/SKILL.md
  - docs/decisions/0003-portable-agent-harness.md
  - docs/tasks/TASK-0111-auth-input-hygiene.md
  - docs/tasks/context/TASK-0111.context-lock.yaml
  - docs/evidence/TASK-0111/evidence-pack.json
  - docs/handoffs/TASK-0111.json
  - docs/tasks/TASK-0133-harness-default-branch-fixture-portability.md
  - docs/tasks/context/TASK-0133.context-lock.yaml
  - docs/evidence/TASK-0133/evidence-pack.json
  - docs/evidence/TASK-0133/pre-closure-request.json
  - docs/evidence/TASK-0133/review-r1.md
  - docs/handoffs/TASK-0133.json
  - docs/tasks/TASK-0134-task0133-harness-approval-quarantine.md
  - docs/tasks/context/TASK-0134.context-lock.yaml
  - docs/evidence/TASK-0134/evidence-pack.json
  - docs/evidence/TASK-0134/pre-closure-request.json
  - docs/evidence/TASK-0134/review-r1.md
  - docs/handoffs/TASK-0134.json
  - scripts/harness/doctor.py
  - scripts/harness/tests/test_harness.py
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
  - scope: task-assignment
    approvedBy: repository-owner
    approvedAt: "2026-08-10"
    sourceThreadId: 019fdf92-9c99-7400-a2ea-d490ef3d7e15
    evidence: >-
      Owner 在获知 TASK-0134 因 Base 既存 ContextTests fingerprint 失败（TASK-0111 REJECTED
      历史卡保留错误 context fingerprint）如实 REJECTED 后，明确批准创建本 C4 一次性治理恢复
      任务，精确隔离 TASK-0111 固定历史并恢复完整 Harness 绿线；禁止历史改写和伪造 PASS。
  - scope: harness-change
    approvedBy: repository-owner
    approvedAt: "2026-08-10"
    sourceThreadId: 019fdf92-9c99-7400-a2ea-d490ef3d7e15
    evidence: >-
      Owner 明确批准以精确 scope=harness-change 前向恢复：绑定 TASK-0111 Base、DRAFT、READY、
      binding、REJECTED terminal 与固定产物，只为该已知错误 context fingerprint 历史增加
      fail-closed 隔离 predicate 和对应正负例；允许修改 Doctor、对应 Harness tests 和必要
      lifecycle artifacts，不授权通用豁免、历史重写、policy/Skill/阈值弱化或对其他任务复用。
  - scope: local-exact-tree-fallback
    approvedBy: repository-owner
    approvedAt: "2026-08-10"
    sourceThreadId: 019fdf92-9c99-7400-a2ea-d490ef3d7e15
    evidence: >-
      Owner 要求长线继续推进；既有 includedMinutes=usedMinutes=2000、paidBudgetUsd=0、
      stopUsageEnabled=true、dispatchCount=0 与无 runner exact-SHA 事实保持不变。本卡重新冻结
      LOCAL_EXACT_TREE_FALLBACK，远端仍如实非 PASS，不复用 TASK-0133/TASK-0134 的 Reviewer
      或命令 PASS。
independentReview: required
reviewers: []
requiredCommands:
  - python scripts/harness/precheck.py --task TASK-0135
  - python -m unittest scripts.harness.tests.test_harness
  - git diff --check
```

> 本卡不在 Backlog 中，不写 `planningBacklog` 或 `planningContractHash`。TASK-0111 已按真实失败终态推送；
> 本卡是 Owner 明确批准的永久 replacement，不修改或删除其 Card、Context、Evidence、Review、Handoff。

> **Owner 范围批准（2026-08-10）**：READY 后定向扫描发现完整 Harness 的 `ContextTests.
> test_all_context_locks_are_reproducible` 实际失败历史共有三个（TASK-0111、TASK-0124、TASK-0129，
> 均为 READY 时用带尾随 LF payload 计算 fingerprint、REJECTED 后错误值保留的同类历史；此前被 unittest
> 在 TASK-0111 处中止而遮蔽）。Owner 明确批准本卡隔离范围扩大为这三个固定历史一次恢复绿线；本卡
> frontmatter 的 `rejectedHistoryQuarantine` 为 READY 冻结投影（仅 TASK-0111），三个历史的完整固定
> 身份见下方「TASK-0111/0124/0129 固定身份」节，实现与测试以该节为准。此批准不改写任何历史制品、
> 不引入通用豁免、不修改 READY 授权字段。

## 背景与用户可观察目标

TASK-0111、TASK-0124、TASK-0129 在 READY 时均用带尾随 LF 的 payload 计算 Context Fingerprint，
与 canonical 无尾随 LF 算法不一致（TASK-0111: expected `deadcf31…` got `5a2147e0…`；TASK-0124:
expected `6ac0b7d9…` got `855d3fb3…`；TASK-0129: expected `31abce12…` got `fbdcf399…`）。READY 后
contextFingerprint 不可变，故三卡均如实 REJECTED，错误 fingerprint 保留在历史卡上。生产 Doctor
（doctor.py:6979）只对非终态任务调用 `verify_context_lock`，因此这些 REJECTED 历史被跳过；但
`ContextTests.test_all_context_locks_are_reproducible` 遍历所有任务（除 planning-only）断言空错误，
导致 TASK-0134 的完整 Harness 门禁（261 tests 中唯一失败）在 Base 上即失败——这是三个 REJECTED
历史以来的 Base 既存失败，已由 /tmp 诊断 clone 在 Base `3c30dd69` 与当前 HEAD 多处复现。

用户可观察结果：普通 context-lock 校验仍对任何错误、缺失或模糊的 fingerprint/输入失败关闭；
只有三个固定 REJECTED 历史、固定 terminal/tree 和固定制品的这一组已知错误被识别，
`ContextTests.test_all_context_locks_are_reproducible` 恢复绿线，后续完整 Harness 门禁恢复
PASS 语义。P2-20（merge fixture 真实双亲断言，TASK-0133/0134 候选实现已在 Base 中）随本卡
完整 Harness 通过而正式承接。

## TASK-0111/0124/0129 固定身份

每个历史独立绑定以下固定身份，任一漂移失败关闭：

```text
TASK-0111:  card docs/tasks/TASK-0111-auth-input-hygiene.md
            base a3a294d19b8024bc52fa08eb052fa7a957b046ee
            draft 54ae758faac0d1ab30a645cd5400b80cdfaba2d7
            ready 90e1bc36341c6227966a7c4b96bf1066ab6668ea / tree e4f81f83226efb2a91667b173c0828a7bafc3156
            binding 3280efb70e04cdb38df635489cd575c7f666a48d
            terminal 9bfd47eea55aa2a485c77617a2581924d69dbe84 / tree 7ef159f539cb546f4920ac1f4b576f39310d942c
            invalid deadcf31035ec180393998f0f0abf3ae77a5d3a3d07f49b83033a8242fe9a6a9
            actual 5a2147e0c5ea53a843aacdab6b4257da18421f7aedcb47f8221f980521f242e7
            reviewers 7bc25106719b7990918682084225bdb8c5ca524b691989e3250b40f07f99539b
            artifacts card fdc23db2… / lock 0bc99558… / evidence aa14ca82… / handoff 917d0187…
TASK-0124:  card docs/tasks/TASK-0124-auth-firewall-envelope-observation.md
            base 68dc7f0a486e93768112fca856f9456cb7e31a2d
            draft a726a63a3080cc2f8570ef1c2532e155012b35c0
            ready 952800e80994c734a7cd40e9631f60110fce85d5 / tree b5214bc22c28c0626bd083df0dfb555439423825
            binding 2b34658fc6d7a5c2d8c9c4b0827c03ec27b96dc1
            terminal 098115264879ed1bd99c79e90db2ddca54061c4b / tree 01774a06822aeb53626f18bb66451b686a4c640c
            invalid 6ac0b7d95a19f7456f20a9496a212deb364a0b1664de1d37a616d41e48d739d2
            actual 855d3fb37679a185be843c3843fb7a7e035f39c87f9ebd435694881265a6bb46
            reviewers ddb8f685b3461c9d4406aedd9f7de4303ba7244b0106a668163307d99cd894f7
            artifacts card a3f9a8d7… / lock 9a08a505… / evidence d441bcd9… / handoff 8c200e77…
TASK-0129:  card docs/tasks/TASK-0129-anthropic-tool-use-protocol-replacement.md
            base 603402304b878d939c8381721ff9bc5082561780
            draft 663b4a3556a3a22723f239a22dd4a8832599a3a9
            ready bce01149fa4baabe90e8f2112a103e1f3936bf46 / tree 62c01c31910cf558328fd56162e2d4e9ea24e436
            binding a12b5eaa934f88c983102277d706f179da3dfce8
            terminal ebc7c2228c5ed4d07ec345d9d33a7d187de00392 / tree 21a8fea6819c0bb6df4ba1ca92be8b0c277daf35
            invalid 31abce12955f5be0b2f11e0f18170468c2a236f48e546b5879dc6270a76b15cd
            actual fbdcf3991d84e86450a5a6ee8d22614cd3e8245f61d511dffa5ebba6cb9246c4
            reviewers 1a69a9642e51f2c90cc890a37c46b336da6de2440831d611ddce3dee2d36257e
            artifacts card f37a2e9a… / lock 21864fb3… / evidence 88ff47b6… / handoff e9097ef7…
```

三个历史均验证：完整单父链、READY/terminal Tree、terminal 制品与 Git 对象 byte-for-byte 一致、
Task Ledger 精确终态条目、Evidence/Handoff reviewers canonical hash 与精确 READY Doctor
FAIL/exit 1 绑定。

## 范围内

- 在 Doctor 中新增只接受 TASK-0111/0124/0129 三个固定 ID、Card path、Base、DRAFT/READY/binding、
  terminal/tree、错误 fingerprint、Context Lock 路径、terminal artifact hashes 与精确 mismatch
  错误文本的隔离 predicate（三个固定身份独立绑定，共享同一精确校验实现）。
- 仅在 `scripts/harness/tests/test_harness.py` 的 `ContextTests.test_all_context_locks_are_reproducible`
  消费该 predicate：普通任务仍断言 `verify_context_lock` 无错误，只有三个固定 REJECTED 历史
  且 errors 精确等于各自固定 mismatch 元组时才放行。
- 增加正例和 fail-closed 负例：任务字段、提交/Tree、path、fingerprint、ledger 或任一终态 artifact
  漂移都不得获得隔离；三个历史之间互相不得放行。
- 重新运行完整 Harness（含 P2-20 merge 双亲断言与 TASK-0133/0134 隔离回归）、Reviewer 和正式门禁，
  正式承接 P2-20。

## 明确范围外

- 不修改 TASK-0111/0124/0129 或任何其他历史 Card、Context、Evidence、Review、Handoff、Ledger entry
  或 Git 历史。
- 不把任意 fingerprint mismatch、前缀/后缀/通配、别名或非精确值普遍等同于豁免。
- 不修改 harness_common.py、protected paths、lifecycle、delivery/CI policy、commands、schemas、Skill、
  AGENTS、workflow 或阈值。
- 不修 P2-21（canonical Python 合同选择，OWNER_GATE，需 Owner 决策后另卡处理）、P2-23 至 P2-27、
  OpenAPI、业务、数据库、frontend 或 Provider DNS。

## 输入和前置条件

- Base `2fe3e470bb499aa1e968d6acd2d23f7421757077` 是 TASK-0134 单父 REJECTED terminal，已 push、
  fetch、`HEAD...origin/main=0/0` 且工作树 clean。
- TASK-0111/0124/0129 三个 REJECTED terminal（`9bfd47ee…` / `09811526…` / `ebc7c222…`）与各自
  tree、单父链、错误 fingerprint 与 terminal artifact hashes 已在「TASK-0111/0124/0129 固定身份」节
  固定；三者均为 Context Fingerprint 计算错误 REJECTED 的同类历史。
- Owner 授权 provenance Hash 为 `cc0f91c1ddad24cb89128002439148384e4af8b6c8d056498ba8814a53580e95`。

## API / 事件 / 数据契约

不改变产品 API、事件或数据。隔离 predicate 是 Doctor/测试内部历史审计函数，不提供 CLI flag、
环境变量、Git note/replace/graft 或可配置 allowlist，不影响其他任务的 context-lock 模型。

## 状态机和失败行为

执行普通 `DRAFT -> READY -> IN_PROGRESS -> IN_REVIEW -> ACCEPTED`。READY Doctor 必须在没有任何
pre-READY 代码维护或 override 的情况下真实 PASS；实现只在 IN_PROGRESS 后发生。

隔离的任一身份、hash、path、fingerprint、reviewer 或 artifact 不匹配时返回 False，测试保留原
断言失败。R1 最多两轮、一批前向修复；R2 新增结构性 P0/P1 或任一正式门禁非 PASS 时停止并 REJECTED。

## 验收标准

- TASK-0111/0124/0129 三个固定历史正例均被识别（errors 精确等于各自固定 fingerprint mismatch
  元组）；错误 task/path/state/Base/READY/terminal/Tree/fingerprint/ledger/artifact mutation 全部
  失败关闭，三个历史之间互相不得放行，且其他任务的任何 fingerprint mismatch 仍被拒绝。
- 隔离不改变普通 context-lock 校验路径（非三个固定历史的任何错误仍失败），不增加通用
  兼容层；harness_common.py 零改动。
- 完整 Harness unittest 全部通过（261+ tests），其中 P2-20 merge 双亲断言与 TASK-0133/0134
  隔离回归保持通过。
- 唯一正式 Precheck、唯一 `git diff --check`、独立 C4 R1、终态 pre-closure、push、fetch、clean
  和远端 `0/0` 全部真实完成；remote unavailable 仍非 PASS。
- post-terminal Doctor 在最新终态通过，TASK-0111/0124/0129 原始失败产物保持 byte-for-byte 不变。

## 必跑检查

以 YAML `requiredCommands` 精确 argv 为准。实现迭代只运行新增隔离测试与 ContextTests 目标测试；
冻结候选后依次执行独立 Reviewer、唯一 Precheck、完整 Harness、唯一无参数 diff check、
Evidence/Handoff 和唯一 pre-closure。Precheck 已覆盖的 canonical 子命令不重复。

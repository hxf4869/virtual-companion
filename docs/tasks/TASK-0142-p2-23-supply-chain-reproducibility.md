# TASK-0142：P2-23 供应链可复现（terminal context lock 语义对齐）——replacement of TASK-0141

```yaml
taskId: TASK-0142
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
baseCommit: 61aa6f96f0b4fe5809c53e2cdc7040b8e88fdbcb
authorizationCommit: dab8729b37e407925b629ddd2d561c8eebb15566
contextFingerprint: f342aac2ac4c825227c9db005a45f4ea6c41330a4489b1e3a556ed03e373ad3b
contextLock: docs/tasks/context/TASK-0142.context-lock.yaml
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
  surfaceId: TASK_0142_P2_23_SUPPLY_CHAIN_TERMINAL_CONTEXT_LOCK
  policySurfaces: [GOVERNANCE, CI]
  distinctCrossRiskSurfaces: 2
  reviewerMinutesEstimate: 15
  terminalCheckMinutesEstimate: 20
  estimatedWallMinutes: 60
  thresholdsTriggered: [crossRiskSurfaces]
  splitRequired: false
  ownerIndivisibleAuthorization: true
  indivisibleReason: >-
    TASK-0141 的 P2-23 供应链实现（ci.yml 固定 SHA、requirements-harness.txt 锁文件、
    SupplyChainTests）已经 R1/R2 与正式 Precheck 验证正确，但唯一完整 Harness 暴露既有
    test_all_context_locks_are_reproducible 对 REJECTED TASK-0140 的 context lock 不可复现断言
    失败（TASK-0140 的 context lock 被其 READY checkpoint 字节绑定冻结，文件级修复被 Doctor
    禁止）。本卡必须同时完成：① 将该测试的 terminal-task 语义对齐（Doctor 对 REJECTED/
    SUPERSEDED 任务不做 context lock 可复现校验）；② 重新完整验证 Base 中已就位的 P2-23
    供应链实现。两者同属本 C4 卡的治理/CI 面且互相依赖，拆分会导致同一 test_harness.py 被多张
    卡重复触碰；Owner 已批准承接方案与写路径。
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
  - ci/README.md
  - docs/decisions/0003-portable-agent-harness.md
  - docs/evidence/TASK-0109/zcode-remediation-handoff.md
  - docs/evidence/TASK-0139/evidence-pack.json
  - docs/evidence/TASK-0139/pre-closure-request.json
  - docs/evidence/TASK-0139/review-r1.md
  - docs/evidence/TASK-0140/evidence-pack.json
  - docs/evidence/TASK-0140/pre-closure-request.json
  - docs/evidence/TASK-0140/review-r1.md
  - docs/evidence/TASK-0141/evidence-pack.json
  - docs/evidence/TASK-0141/pre-closure-request.json
  - docs/evidence/TASK-0141/review-r1.md
  - docs/evidence/TASK-0141/review-r2.md
  - docs/handoffs/TASK-0139.json
  - docs/handoffs/TASK-0140.json
  - docs/handoffs/TASK-0141.json
  - docs/tasks/TASK-0139-p2-21-canonical-python-literal-full.md
  - docs/tasks/context/TASK-0139.context-lock.yaml
  - docs/tasks/TASK-0140-p2-23-supply-chain-reproducibility.md
  - docs/tasks/context/TASK-0140.context-lock.yaml
  - docs/tasks/TASK-0141-p2-23-supply-chain-reproducibility.md
  - docs/tasks/context/TASK-0141.context-lock.yaml
  - docs/tasks/task-card-template.md
  - owner-authorization/TASK-0142/019fdf92-9c99-7400-a2ea-d490ef3d7e15
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
  - docs/tasks/TASK-0142-p2-23-supply-chain-reproducibility.md
  - docs/tasks/context/TASK-0142.context-lock.yaml
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - docs/evidence/TASK-0142/**
  - docs/handoffs/TASK-0142.json
  - scripts/harness/tests/test_harness.py
forbiddenPaths:
  - docs/tasks/TASK-00*-*
  - docs/tasks/TASK-010*-*
  - docs/tasks/TASK-011*-*
  - docs/tasks/TASK-012*-*
  - docs/tasks/TASK-013*-*
  - docs/tasks/TASK-0140-*
  - docs/tasks/TASK-0141-*
  - docs/tasks/context/TASK-00*.context-lock.yaml
  - docs/tasks/context/TASK-010*.context-lock.yaml
  - docs/tasks/context/TASK-011*.context-lock.yaml
  - docs/tasks/context/TASK-012*.context-lock.yaml
  - docs/tasks/context/TASK-013*.context-lock.yaml
  - docs/tasks/context/TASK-0140.context-lock.yaml
  - docs/tasks/context/TASK-0141.context-lock.yaml
  - docs/evidence/TASK-00*/**
  - docs/evidence/TASK-010*/**
  - docs/evidence/TASK-011*/**
  - docs/evidence/TASK-012*/**
  - docs/evidence/TASK-013*/**
  - docs/evidence/TASK-0140/**
  - docs/evidence/TASK-0141/**
  - docs/handoffs/TASK-00*.json
  - docs/handoffs/TASK-010*.json
  - docs/handoffs/TASK-011*.json
  - docs/handoffs/TASK-012*.json
  - docs/handoffs/TASK-013*.json
  - docs/handoffs/TASK-0140.json
  - docs/handoffs/TASK-0141.json
  - .gitattributes
  - AGENTS.md
  - CLAUDE.md
  - README.md
  - .github/workflows/ci.yml
  - .github/copilot-instructions.md
  - ci/**
  - requirements-harness.txt
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
  - .harness/agent-entrypoints.yaml
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
  - docs/evidence/TASK-0109/zcode-remediation-handoff.md
  - docs/evidence/TASK-0139/evidence-pack.json
  - docs/handoffs/TASK-0139.json
  - docs/evidence/TASK-0140/evidence-pack.json
  - docs/handoffs/TASK-0140.json
  - docs/evidence/TASK-0141/evidence-pack.json
  - docs/handoffs/TASK-0141.json
  - scripts/harness/precheck.py
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
      Owner 于 2026-08-10 长线会话授权请求中批准 P2-23 供应链可复现 C4 卡（GitHub Actions
      固定完整 commit SHA + Harness Python 依赖精确版本与 hash lock），合并 P2-23 与 P2-24 为
      一张卡；TASK-0140 因 context lock 格式缺陷 READY Doctor FAIL、TASK-0141 因完整 Harness
      暴露 TASK-0140 context lock 遗留缺陷（其 READY checkpoint 字节绑定使文件级修复被 Doctor
      禁止）而如实 REJECTED 后，Owner 批准创建本卡从 DRAFT 起把 test_all_context_locks_are_reproducible
      的 terminal-task 语义对齐（REJECTED/SUPERSEDED 跳过 context lock 可复现校验，对齐 Doctor
      对 terminal 任务不校验的语义）纳入范围，承接同一方案与写路径；禁止历史改写和伪造 PASS。
  - scope: harness-change
    approvedBy: repository-owner
    approvedAt: "2026-08-10"
    sourceThreadId: 019fdf92-9c99-7400-a2ea-d490ef3d7e15
    evidence: >-
      Owner 明确批准以精确 scope=harness-change 实施 P2-23 承接：test_harness.py 的
      test_all_context_locks_are_reproducible 对 REJECTED/SUPERSEDED 任务跳过 context lock
      可复现校验（与 doctor.py 7321 行对 terminal 任务不调用 verify_context_lock 的语义一致；
      不删测、不加 skip、不改 ACCEPTED 任务的校验），并重新完整验证 Base 中已就位的供应链实现
      （ci.yml 全部 actions 固定完整 40-char commit SHA + 受审升级流程注释、requirements-harness.txt
      精确版本 + sha256 hash lock、--require-hashes 安装、SupplyChainTests 锁合同测试、全新临时
      venv 可重复安装验证）；不授权通用 alias、环境变量 override、history rewrite、policy/Skill/
      阈值弱化或对其他任务复用。
  - scope: local-exact-tree-fallback
    approvedBy: repository-owner
    approvedAt: "2026-08-10"
    sourceThreadId: 019fdf92-9c99-7400-a2ea-d490ef3d7e15
    evidence: >-
      Owner 要求长线继续推进；既有 includedMinutes=usedMinutes=2000、paidBudgetUsd=0、
      stopUsageEnabled=true、dispatchCount=0 与无 runner exact-SHA 事实保持不变。本卡重新冻结
      LOCAL_EXACT_TREE_FALLBACK，远端仍如实非 PASS，不复用 TASK-0140/0141 的 Reviewer 或命令 PASS。
independentReview: required
reviewers: []
requiredCommands:
  - python scripts/harness/precheck.py --task TASK-0142
  - python -m unittest scripts.harness.tests.test_harness
  - git diff --check
```

> 本卡不在 Backlog 中，不写 `planningBacklog` 或 `planningContractHash`。P2-23/P2-24 是
> `docs/evidence/TASK-0109/zcode-remediation-handoff.md` §4.7 组 B 登记的 OPEN 审计项；
> 本卡是 TASK-0141 的永久 replacement（TASK-0141 因完整 Harness 暴露 TASK-0140 context lock
> 遗留缺陷如实 REJECTED，其实现保留于历史中由本卡承接验证）。

## 背景与用户可观察目标

P2-23（Actions 使用可变 major tag）与 P2-24（Harness Python 依赖无 hash lock）的供应链实现
已在 TASK-0141 中完成并经 R1/R2 与正式 Precheck 验证：`.github/workflows/ci.yml` 全部 11 处
uses 固定完整 commit SHA（6 个唯一 SHA 与上游 tag 实测一致）+ 受审升级流程注释；
`requirements-harness.txt` 锁定 PyYAML==6.0.3/tzdata==2026.3 精确版本与 23 个 sha256 hash
（与 PyPI digest 逐一对应）；SupplyChainTests 锁合同测试；全新临时 venv `--require-hashes`
安装真实 PASS。该实现保留在 TASK-0141 候选提交（d34ff2c/0b351cd）并随 REJECTED 终态
（61aa6f9）进入 Base。

TASK-0141 唯一完整 Harness 暴露的阻塞：`ContextTests.test_all_context_locks_are_reproducible`
遍历**所有**任务并要求 context lock 可复现，但 REJECTED TASK-0140 的 context lock 因生成缺陷
（provenance 行缺 provenanceOnly: true）不可复现；TASK-0140 的 context lock 被其 READY
checkpoint 字节绑定冻结（`validate_ready_context_lock_bytes` 对 REJECTED 任务仍运行），文件级
修复被 Doctor 禁止。Doctor 本体（doctor.py 7321 行）对 terminal 任务（ACCEPTED/REJECTED/
SUPERSEDED）不调用 `verify_context_lock`——测试与 Doctor 语义不一致。

用户可观察结果：`test_all_context_locks_are_reproducible` 对 REJECTED/SUPERSEDED 任务跳过
context lock 可复现校验（对齐 Doctor 语义，ACCEPTED 任务仍全量校验），完整 Harness 恢复绿线；
P2-23 供应链合同（actions 固定 SHA + 依赖 hash lock + 锁合同测试 + 可重复安装）在完整门禁中
真实通过。

## 范围内

- `scripts/harness/tests/test_harness.py`：`test_all_context_locks_are_reproducible` 对
  REJECTED/SUPERSEDED 任务跳过 `verify_context_lock` 可复现校验（对齐 doctor.py 7321 行对
  terminal 任务不校验的语义；保留 ACCEPTED 任务与 planning-only 跳过逻辑与既有隔离分支）；
  不删测、不加 skip。
- 重新完整验证 Base 中已就位的 P2-23 供应链实现：ci.yml 全部 uses 固定 40-char SHA + 受审
  升级流程注释 + `--require-hashes` 安装命令；requirements-harness.txt 精确版本 + 23 个
  sha256 hash；SupplyChainTests 3 个锁合同测试真实运行；全新临时 venv `--require-hashes`
  安装真实成功（退出码 0，网络偶发失败如实记录不写成 PASS）。
- 唯一正式 Precheck、完整 Harness unittest、唯一 `git diff --check`、独立 C4 R1、pre-closure、
  push、fetch、clean 与远端 `0/0` 全部真实完成。

## 明确范围外

- 不修改 `.github/workflows/ci.yml`、`requirements-harness.txt` 内容（已在 Base 就位，本卡
  只读验证）。
- 不修改 TASK-0140 的 context lock 文件（被其 READY checkpoint 字节绑定冻结，Doctor 禁止）。
- 不修改 AGENTS.md/CLAUDE.md 与 `.harness/agent-entrypoints.yaml`。
- 不修改 TASK-0140/0141 的 Card/Context/Evidence/Handoff/Ledger 条目或任何历史 Git 对象。
- 不修改其他测试逻辑（除本卡声明的单一测试方法语义对齐）、precheck.py/.sh/.ps1、
  commands.yaml、policy、schemas、Skill、task-card-template、ci/README.md 或 .harness 其他文件。
- 不处理 P2-25（license/SBOM/vulnerability gate，Security/Owner 先决策）、P2-26（超时与进程树
  终止）、P2-27（路径感知矩阵与固定 JDK 路径）、OpenAPI、业务、数据库、frontend 或 Provider DNS。

## 输入和前置条件

- Base `61aa6f96f0b4fe5809c53e2cdc7040b8e88fdbcb` 是 TASK-0141 单父 REJECTED terminal
  （P2-23 供应链实现已保留于其历史与 tree），已 push、fetch、`HEAD...origin/main=0/0` 且工作树
  clean。
- 本卡 context lock 的 provenance 条目带 `provenanceOnly: true`（TASK-0140 失败教训），
  fingerprint `f342aac2…` 基于 Base 重新计算。
- 受控 Python 环境：`PATH=/Users/hxf/.zcode/venvs/vc-harness/bin:$PATH` 前置，`python` 解析到
  受控解释器（venv python3.13）。
- Owner 授权 provenance Hash 沿用 `cc0f91c1ddad24cb89128002439148384e4af8b6c8d056498ba8814a53580e95`
  （Owner 2026-08-10 长线批准文本 sha256）。

## API / 事件 / 数据契约

不改变产品 API、事件或数据。治理/CI 内部契约不变：actions 固定 SHA 后升级只能走受审 PR 流程；
锁文件变更只能通过本类 C4 卡或同等受审流程；不提供 CLI flag、环境变量 override、Git
note/replace/graft 或可配置 allowlist。

## 状态机和失败行为

执行普通 `DRAFT -> READY -> IN_PROGRESS -> IN_REVIEW -> ACCEPTED`。READY Doctor 真实 PASS 后
进入实现；README 后不得修改任务卡正文或不可变元数据。

锁合同任一违反（版本非精确、缺 hash、uses 非 40-char SHA、安装命令缺 --require-hashes）时测试
失败关闭。全新环境安装失败（含网络偶发）如实记录非 PASS，不重跑挑结果。R1 最多两轮、一批前向
修复；R2 新增结构性 P0/P1 或任一正式门禁非 PASS 时停止并 REJECTED。

## 验收标准

- `test_all_context_locks_are_reproducible` 对 REJECTED/SUPERSEDED 任务跳过 context lock
  可复现校验、ACCEPTED 任务仍全量校验；无删测、无新增 skip。
- Base 中已就位的供应链合同复核通过：ci.yml 全部 `uses:` 为精确 40-char commit SHA 且带原
  tag/受审升级流程注释；requirements-harness.txt 全部依赖行为精确版本且每行带
  `--hash=sha256:...`，无范围约束残留；两处 harness 安装命令为
  `python -m pip install --require-hashes -r requirements-harness.txt`。
- SupplyChainTests 3 个锁合同测试真实运行通过；全新临时 venv `--require-hashes` 安装真实成功
  （exit 0）。
- 完整 Harness unittest 全部通过（265+ tests，绿线恢复）。
- 唯一正式 Precheck、唯一 `git diff --check`、独立 C4 R1、终态 pre-closure、push、fetch、clean
  和远端 `0/0` 全部真实完成；remote unavailable 仍非 PASS。
- post-terminal Doctor 在最新终态通过，历史制品保持 byte-for-byte 不变。

## 必跑检查

以 YAML `requiredCommands` 精确 argv 为准。实现迭代只运行 `test_all_context_locks_are_reproducible`
定向测试；冻结候选后依次执行独立 Reviewer、唯一 Precheck、完整 Harness、唯一无参数 diff check、
Evidence/Handoff 和唯一 pre-closure。Precheck 已覆盖的 canonical 子命令不重复。

# TASK-0141：P2-23 供应链可复现（GitHub Actions 固定完整 commit SHA + Harness Python 依赖精确版本与 hash lock）——replacement of TASK-0140

```yaml
taskId: TASK-0141
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
baseCommit: 8d613427573915b628d6643bdd78fc0e58227e71
authorizationCommit: ""
contextFingerprint: 36635ef5f02e2d12024f667b7c754bc0a0d99b1e029cafe928ecbb85919677d4
contextLock: docs/tasks/context/TASK-0141.context-lock.yaml
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
  surfaceId: TASK_0141_P2_23_SUPPLY_CHAIN_REPRODUCIBILITY
  policySurfaces: [GOVERNANCE, CI]
  distinctCrossRiskSurfaces: 2
  reviewerMinutesEstimate: 15
  terminalCheckMinutesEstimate: 20
  estimatedWallMinutes: 60
  thresholdsTriggered: [crossRiskSurfaces]
  splitRequired: false
  ownerIndivisibleAuthorization: true
  indivisibleReason: >-
    GitHub Actions 固定完整 commit SHA 与 Harness Python 依赖精确版本/hash lock 同属
    .github/workflows/ci.yml 与 requirements-harness.txt 两条 forbiddenPaths 的 C4 供应链合同，
    两者必须在同一实现中一起收敛（安装命令、锁文件与 CI 引用互为约束），拆分会导致同一受保护
    路径被两张卡重复触碰且验收互相依赖；Owner 已批准该合并范围与写路径。本卡为 TASK-0140 的
    replacement：TASK-0140 因 context lock 的 owner-authorization provenance 条目缺
    provenanceOnly: true 字段导致 READY Doctor FAIL 而如实 REJECTED，本卡从 DRAFT 起修正该
    context lock 格式并承接同一实现方案与写路径。
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
  - docs/handoffs/TASK-0139.json
  - docs/handoffs/TASK-0140.json
  - docs/tasks/TASK-0139-p2-21-canonical-python-literal-full.md
  - docs/tasks/context/TASK-0139.context-lock.yaml
  - docs/tasks/TASK-0140-p2-23-supply-chain-reproducibility.md
  - docs/tasks/context/TASK-0140.context-lock.yaml
  - docs/tasks/task-card-template.md
  - owner-authorization/TASK-0141/019fdf92-9c99-7400-a2ea-d490ef3d7e15
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
  - docs/tasks/TASK-0141-p2-23-supply-chain-reproducibility.md
  - docs/tasks/context/TASK-0141.context-lock.yaml
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - docs/evidence/TASK-0141/**
  - docs/handoffs/TASK-0141.json
  - .github/workflows/ci.yml
  - requirements-harness.txt
  - scripts/harness/tests/test_harness.py
forbiddenPaths:
  - docs/tasks/TASK-00*-*
  - docs/tasks/TASK-010*-*
  - docs/tasks/TASK-011*-*
  - docs/tasks/TASK-012*-*
  - docs/tasks/TASK-013*-*
  - docs/tasks/TASK-0140-*
  - docs/tasks/context/TASK-00*.context-lock.yaml
  - docs/tasks/context/TASK-010*.context-lock.yaml
  - docs/tasks/context/TASK-011*.context-lock.yaml
  - docs/tasks/context/TASK-012*.context-lock.yaml
  - docs/tasks/context/TASK-013*.context-lock.yaml
  - docs/tasks/context/TASK-0140.context-lock.yaml
  - docs/evidence/TASK-00*/**
  - docs/evidence/TASK-010*/**
  - docs/evidence/TASK-011*/**
  - docs/evidence/TASK-012*/**
  - docs/evidence/TASK-013*/**
  - docs/evidence/TASK-0140/**
  - docs/handoffs/TASK-00*.json
  - docs/handoffs/TASK-010*.json
  - docs/handoffs/TASK-011*.json
  - docs/handoffs/TASK-012*.json
  - docs/handoffs/TASK-013*.json
  - docs/handoffs/TASK-0140.json
  - .gitattributes
  - AGENTS.md
  - CLAUDE.md
  - README.md
  - .github/copilot-instructions.md
  - ci/**
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
      Owner 于 2026-08-10 长线会话授权请求中批准创建 P2-23 供应链可复现 C4 卡（GitHub Actions
      固定完整 commit SHA + Harness Python 依赖精确版本与 hash lock），合并 P2-23 与 P2-24 为
      一张卡，自 DRAFT 起纳入 .github/workflows/ci.yml、requirements-harness.txt 与
      scripts/harness/tests/test_harness.py 写路径；actions 固定 SHA 采用 2026-08-10 从各
      actions 仓库 tag 解析的 commit（checkout@v6=d23441a48e516b6c34aea4fa41551a30e30af803、
      setup-python@v6=ece7cb06caefa5fff74198d8649806c4678c61a1、setup-java@v4=
      cf277c60eb25467037889841efdb72551f06f6c3、setup-node@v6=249970729cb0ef3589644e2896645e5dc5ba9c38、
      upload-artifact@v4=ea165f8d65b6e75b540449e92b4886f43607fa02、pnpm/action-setup@v6=
      0977fd99725f1db4007ccb2928dbb4e90d06cc86），依赖锁定当前受控环境已验证版本
      PyYAML==6.0.3、tzdata==2026.3；TASK-0140 因 context lock 格式缺陷（provenance 条目缺
      provenanceOnly: true）READY Doctor FAIL 而如实 REJECTED 后，Owner 批准创建本卡从 DRAFT 起
      修正 context lock 并承接同一方案与写路径；禁止历史改写和伪造 PASS。
  - scope: harness-change
    approvedBy: repository-owner
    approvedAt: "2026-08-10"
    sourceThreadId: 019fdf92-9c99-7400-a2ea-d490ef3d7e15
    evidence: >-
      Owner 明确批准以精确 scope=harness-change 实施 P2-23：.github/workflows/ci.yml 全部
      actions 固定完整 40-char commit SHA（行内注释原 tag 与受审升级流程）、requirements-harness.txt
      收敛为精确版本 + 每发行文件 sha256 hash（覆盖 cp312/cp313 与 CI 三平台 + sdist）、
      ci.yml 安装命令改 python -m pip install --require-hashes -r requirements-harness.txt、
      test_harness.py 新增锁合同测试（uses-SHA/版本/hash/--require-hashes 失败关闭）；
      不删测、不加 skip；不授权通用 alias、环境变量 override、history rewrite、policy/Skill/
      阈值弱化或对其他任务复用。
  - scope: local-exact-tree-fallback
    approvedBy: repository-owner
    approvedAt: "2026-08-10"
    sourceThreadId: 019fdf92-9c99-7400-a2ea-d490ef3d7e15
    evidence: >-
      Owner 要求长线继续推进；既有 includedMinutes=usedMinutes=2000、paidBudgetUsd=0、
      stopUsageEnabled=true、dispatchCount=0 与无 runner exact-SHA 事实保持不变。本卡重新冻结
      LOCAL_EXACT_TREE_FALLBACK，远端仍如实非 PASS，不复用 TASK-0139/0140 的 Reviewer 或命令 PASS。
independentReview: required
reviewers: []
requiredCommands:
  - python scripts/harness/precheck.py --task TASK-0141
  - python -m unittest scripts.harness.tests.test_harness
  - git diff --check
```

> 本卡不在 Backlog 中，不写 `planningBacklog` 或 `planningContractHash`。P2-23/P2-24 是
> `docs/evidence/TASK-0109/zcode-remediation-handoff.md` §4.7 组 B 登记的 OPEN 审计项，
> project-state.nextAction 冻结定义为「GitHub Actions 固定完整 commit SHA + Harness Python
> 依赖精确版本与 hash lock 的可复现供应链」一张 C4 卡；本卡是 TASK-0140 的永久 replacement
> （TASK-0140 因 context lock provenance 字段缺失 READY Doctor FAIL 如实 REJECTED，其
> DRAFT/READY/绑定提交保留为不可变历史）。

## 背景与用户可观察目标

P2-23（Actions 使用可变 major tag）现状：`.github/workflows/ci.yml` 全部六个 actions
（checkout/setup-python/setup-java/setup-node/upload-artifact/pnpm action-setup）使用
`@v6`/`@v4` 可变 tag，tag 可被上游移动或指向恶意 commit，供应链不可复现、不可审计。

P2-24（Harness Python 依赖无 hash lock）现状：`requirements-harness.txt` 只有范围约束
（`PyYAML>=6.0,<7`、`tzdata>=2025.2,<2027`），pip 安装每次解析最新版本，跨环境不可复现，
且无完整性校验；CI 中 `python -m pip install -r requirements-harness.txt` 无 `--require-hashes`。

TASK-0140 已获批同一方案但 READY Doctor FAIL：其 context lock 的 owner-authorization provenance
条目缺 `provenanceOnly: true` 字段，Doctor 将外部 provenance 记录当作仓库文件读取失败且
fingerprint 复算不一致；context lock 在 READY 检查点后字节不可变，无法原地修复。本卡从 DRAFT 起
修正（context lock 的 provenance 条目带 `provenanceOnly: true`，fingerprint 已按 Base
`8d61342` 重新计算）。

用户可观察结果：CI workflow 中每个 actions 引用固定为完整 40-char commit SHA（附原 tag 注释与
受审升级流程）；`requirements-harness.txt` 为精确版本 + 每发行文件 sha256 hash，安装命令带
`--require-hashes`；Harness 测试对锁文件与 ci.yml 的供应链合同失败关闭；全新环境可重复安装验证
真实通过；完整 Harness 恢复绿线。

## 范围内

- `.github/workflows/ci.yml`：全部 actions 的 `uses:` 固定为解析后的完整 40-char commit SHA，
  每行行内注释标注原 tag 与受审升级流程（PR 中同步改 SHA 与注释并跑 CI，禁止直接改 tag）；
  两处 harness 依赖安装命令改为 `python -m pip install --require-hashes -r requirements-harness.txt`。
- `requirements-harness.txt`：收敛为 `PyYAML==6.0.3`、`tzdata==2026.3`（锁定当前受控环境实际
  验证版本），每发行文件附 `--hash=sha256:...`（覆盖 cp312/cp313 wheel 与 CI 三平台 + sdist）。
- `scripts/harness/tests/test_harness.py` 新增锁合同测试：requirements-harness.txt 全部依赖行
  为精确 `==` 版本且每行带 `--hash=`；ci.yml 所有 `uses:` 为 40-char hex SHA 且带原 tag 注释；
  ci.yml 依赖安装命令含 `--require-hashes`；任一违反即失败关闭。
- 全新临时 venv 中 `python -m pip install --require-hashes -r requirements-harness.txt` 安装
  成功（真实执行、退出码 0，网络偶发失败如实记录不写成 PASS）。
- 唯一正式 Precheck、完整 Harness unittest、唯一 `git diff --check`、独立 C4 R1、pre-closure、
  push、fetch、clean 与远端 `0/0` 全部真实完成。

## 明确范围外

- 不修改 AGENTS.md/CLAUDE.md 与 `.harness/agent-entrypoints.yaml`（无 contentSha256 同步需求）。
- 不修改 TASK-0140 的 Card/Context/Evidence/Handoff/Ledger 条目或任何历史 Git 对象。
- 不修改 precheck.py/precheck.sh/precheck.ps1、commands.yaml、task-delivery-policy.yaml、
  ci-execution-policy.yaml、schemas、Skill、task-card-template、ci/README.md 或 .harness 其他文件
  （除本卡 lifecycle 终态更新）。
- 不处理 P2-25（license/SBOM/vulnerability gate，Security/Owner 先决策）、P2-26（超时与进程树
  终止）、P2-27（路径感知矩阵与固定 JDK 路径）、OpenAPI、业务、数据库、frontend 或 Provider DNS。
- 不升级依赖版本本身（仅锁定当前已验证版本），不做 paid/SaaS-only 运行时引入。

## 输入和前置条件

- Base `8d613427573915b628d6643bdd78fc0e58227e71` 是 TASK-0140 单父 REJECTED terminal
  （context lock 缺陷已如实记录），已 push、fetch、`HEAD...origin/main=0/0` 且工作树 clean。
- 本卡 context lock 的 provenance 条目带 `provenanceOnly: true`（TASK-0140 的 FAIL 根因修正），
  fingerprint `36635ef5…` 基于 Base 重新计算。
- 六个 actions 的 commit SHA 于 2026-08-10 通过 `git ls-remote` 从各仓库 tag 解析
  （checkout v6=d23441a4、setup-python v6=ece7cb06、setup-java v4=cf277c60、setup-node v6=
  24997072、upload-artifact v4=ea165f8d、pnpm/action-setup v6=0977fd99，annotated tag 取
  peel 的 commit）；Owner 已在授权请求中确认。
- 受控 Python 环境：`PATH=/Users/hxf/.zcode/venvs/vc-harness/bin:$PATH` 前置，`python` 解析到
  受控解释器（venv python3.13）；当前已验证依赖 PyYAML 6.0.3、tzdata 2026.3。
- Owner 授权 provenance Hash 沿用 `cc0f91c1ddad24cb89128002439148384e4af8b6c8d056498ba8814a53580e95`
  （Owner 2026-08-10 长线批准文本 sha256）。

## API / 事件 / 数据契约

不改变产品 API、事件或数据。供应链合同是治理/CI 内部契约：actions 固定 SHA 后升级只能走受审
PR 流程；锁文件变更只能通过本类 C4 卡或同等受审流程；不提供 CLI flag、环境变量 override、
Git note/replace/graft 或可配置 allowlist。

## 状态机和失败行为

执行普通 `DRAFT -> READY -> IN_PROGRESS -> IN_REVIEW -> ACCEPTED`。READY Doctor 真实 PASS 后
进入实现；README 后不得修改任务卡正文或不可变元数据。

锁合同任一违反（版本非精确、缺 hash、uses 非 40-char SHA、安装命令缺 --require-hashes）时测试
失败关闭。全新环境安装失败（含网络偶发）如实记录非 PASS，不重跑挑结果。R1 最多两轮、一批前向
修复；R2 新增结构性 P0/P1 或任一正式门禁非 PASS 时停止并 REJECTED。

## 验收标准

- ci.yml 全部 `uses:` 为精确 40-char commit SHA，行内注释含原 tag 与受审升级流程；两处 harness
  依赖安装命令为 `python -m pip install --require-hashes -r requirements-harness.txt`。
- requirements-harness.txt 全部依赖行为 `PyYAML==6.0.3`/`tzdata==2026.3` 精确版本且每行带
  `--hash=sha256:...`，无范围约束残留。
- 新增锁合同测试真实运行通过；net 无新增 skip、无删测。
- 全新临时 venv `--require-hashes` 安装真实成功（exit 0）。
- 完整 Harness unittest 全部通过（262+ tests）。
- 唯一正式 Precheck、唯一 `git diff --check`、独立 C4 R1、终态 pre-closure、push、fetch、clean
  和远端 `0/0` 全部真实完成；remote unavailable 仍非 PASS。
- post-terminal Doctor 在最新终态通过，历史制品保持 byte-for-byte 不变。

## 必跑检查

以 YAML `requiredCommands` 精确 argv 为准。实现迭代只运行新增锁合同定向测试；冻结候选后依次
执行独立 Reviewer、唯一 Precheck、完整 Harness、唯一无参数 diff check、Evidence/Handoff 和唯一
pre-closure。Precheck 已覆盖的 canonical 子命令不重复。

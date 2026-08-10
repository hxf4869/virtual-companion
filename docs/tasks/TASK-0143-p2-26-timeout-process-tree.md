# TASK-0143：P2-26 Precheck/CI 超时与进程树终止

```yaml
taskId: TASK-0143
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
baseCommit: 4a5d68119eb544f3c3746ff03dbfb31e1ad088b9
authorizationCommit: ""
contextFingerprint: 5d8e44d42db7d6db90a609cbde7bf04d70155205227b45bd3564385384155977
contextLock: docs/tasks/context/TASK-0143.context-lock.yaml
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
  surfaceId: TASK_0143_P2_26_TIMEOUT_PROCESS_TREE
  policySurfaces: [GOVERNANCE, CI]
  distinctCrossRiskSurfaces: 2
  reviewerMinutesEstimate: 15
  terminalCheckMinutesEstimate: 20
  estimatedWallMinutes: 60
  thresholdsTriggered: [crossRiskSurfaces]
  splitRequired: false
  ownerIndivisibleAuthorization: true
  indivisibleReason: >-
    P2-26 的 timeout 合同横跨 .harness/commands.yaml（命令注册）、scripts/harness/precheck.py
    （执行器）、harness_common.py（进程树终止 helper）、doctor.py（harnessTests 精确命令断言
    同步）与 test_harness.py（阻塞进程测试）——同一受保护路径集必须在一张 C4 卡内原子收敛，
    拆分会导致部分命令无 timeout 或 Doctor 断言漂移；Owner 长线授权已批准工程数值自行决定。
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
  - docs/evidence/TASK-0142/evidence-pack.json
  - docs/evidence/TASK-0142/pre-closure-request.json
  - docs/evidence/TASK-0142/review-r1.md
  - docs/handoffs/TASK-0142.json
  - docs/tasks/TASK-0142-p2-23-supply-chain-reproducibility.md
  - docs/tasks/context/TASK-0142.context-lock.yaml
  - docs/tasks/task-card-template.md
  - owner-authorization/TASK-0143/019fdf92-9c99-7400-a2ea-d490ef3d7e15
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
  - docs/tasks/TASK-0143-p2-26-timeout-process-tree.md
  - docs/tasks/context/TASK-0143.context-lock.yaml
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - docs/evidence/TASK-0143/**
  - docs/handoffs/TASK-0143.json
  - .harness/commands.yaml
  - scripts/harness/precheck.py
  - scripts/harness/harness_common.py
  - scripts/harness/doctor.py
  - scripts/harness/tests/test_harness.py
  - .github/workflows/ci.yml
forbiddenPaths:
  - docs/tasks/TASK-00*-*
  - docs/tasks/TASK-010*-*
  - docs/tasks/TASK-011*-*
  - docs/tasks/TASK-012*-*
  - docs/tasks/TASK-013*-*
  - docs/tasks/TASK-014*-*
  - docs/tasks/context/TASK-00*.context-lock.yaml
  - docs/tasks/context/TASK-010*.context-lock.yaml
  - docs/tasks/context/TASK-011*.context-lock.yaml
  - docs/tasks/context/TASK-012*.context-lock.yaml
  - docs/tasks/context/TASK-013*.context-lock.yaml
  - docs/tasks/context/TASK-014*.context-lock.yaml
  - docs/evidence/TASK-00*/**
  - docs/evidence/TASK-010*/**
  - docs/evidence/TASK-011*/**
  - docs/evidence/TASK-012*/**
  - docs/evidence/TASK-013*/**
  - docs/evidence/TASK-014*/**
  - docs/handoffs/TASK-00*.json
  - docs/handoffs/TASK-010*.json
  - docs/handoffs/TASK-011*.json
  - docs/handoffs/TASK-012*.json
  - docs/handoffs/TASK-013*.json
  - docs/handoffs/TASK-014*.json
  - .gitattributes
  - AGENTS.md
  - CLAUDE.md
  - README.md
  - .github/copilot-instructions.md
  - ci/**
  - requirements-harness.txt
  - scripts/dev/**
  - scripts/harness/catalog_tool.py
  - scripts/harness/check_beta_gate.py
  - scripts/harness/check_paid_features.py
  - scripts/harness/durable_command.ps1
  - scripts/harness/precheck.ps1
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
  - docs/evidence/TASK-0142/evidence-pack.json
  - docs/handoffs/TASK-0142.json
  - scripts/harness/precheck.py
  - scripts/harness/doctor.py
  - scripts/harness/harness_common.py
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
      Owner 于 2026-08-10 长线会话授权 P2-23..P2-27 组 B/C/D/E 依次串行处理（48 项总表 §4.7）；
      P2-26（Precheck 注册命令与主要 CI jobs 增加明确 timeout、超时终止完整进程树、Evidence 为
      真实 TIMEOUT、永久阻塞子进程测试 POSIX/Windows 终止行为）为 OPEN 无 Owner gate 项，
      工程数值（timeoutSeconds 具体值）按长线授权由实施者基于实测决定并如实记录；禁止历史改写
      和伪造 PASS。
  - scope: harness-change
    approvedBy: repository-owner
    approvedAt: "2026-08-10"
    sourceThreadId: 019fdf92-9c99-7400-a2ea-d490ef3d7e15
    evidence: >-
      Owner 明确批准以精确 scope=harness-change 实施 P2-26：.harness/commands.yaml 每命令增加
      timeoutSeconds、scripts/harness/precheck.py 执行器接入超时与进程树终止（POSIX 新进程组
      killpg、Windows CREATE_NEW_PROCESS_GROUP + taskkill /T）、harness_common.py 新增
      run_command_with_timeout、doctor.py 的 harnessTests 精确命令断言同步 timeoutSeconds、
      test_harness.py 新增永久阻塞子进程 POSIX/Windows 终止测试、ci.yml 为 backend/frontend
      补齐 timeout-minutes；超时如实输出 TIMEOUT 并计入失败（非 PASS）；不删测、不加 skip、
      不吞退出码；不授权通用 alias、环境变量 override、history rewrite、policy/Skill/阈值弱化
      或对其他任务复用。
  - scope: local-exact-tree-fallback
    approvedBy: repository-owner
    approvedAt: "2026-08-10"
    sourceThreadId: 019fdf92-9c99-7400-a2ea-d490ef3d7e15
    evidence: >-
      Owner 要求长线继续推进；既有 includedMinutes=usedMinutes=2000、paidBudgetUsd=0、
      stopUsageEnabled=true、dispatchCount=0 与无 runner exact-SHA 事实保持不变。本卡重新冻结
      LOCAL_EXACT_TREE_FALLBACK，远端仍如实非 PASS，不复用 TASK-0142 的 Reviewer 或命令 PASS。
independentReview: required
reviewers: []
requiredCommands:
  - python scripts/harness/precheck.py --task TASK-0143
  - python -m unittest scripts.harness.tests.test_harness
  - git diff --check
```

> 本卡不在 Backlog 中，不写 `planningBacklog` 或 `planningContractHash`。P2-26 是
> `docs/evidence/TASK-0109/zcode-remediation-handoff.md` §4.7 组 D 登记的 OPEN 审计项：
> Precheck 注册命令和主要 CI jobs 增加明确 timeout；timeout 时终止完整进程树，Evidence 为真实
> TIMEOUT（保留命令/耗时/候选身份，绝不变 PASS）；用永久阻塞子进程测试 POSIX/Windows 终止行为。

## 背景与用户可观察目标

P2-26（Precheck/CI 无超时）现状：`scripts/harness/precheck.py` 的 `_run_cmd` 使用
`subprocess.run(argv, cwd=ROOT, check=False)`——无任何超时；若某注册命令永久阻塞（网络挂起、
死循环、等待外部服务），Precheck 会无限期挂起，CI job 只能靠外层 timeout-minutes 兜底，且
超时后只杀直接子进程、不终止完整进程树（孙子进程残留并继续消耗资源）；`.harness/commands.yaml`
无命令级 timeout 字段；`.github/workflows/ci.yml` 的 backend/frontend job 没有
`timeout-minutes`。

用户可观察结果：每个注册命令有明确 `timeoutSeconds`（基于实测：doctor 900s、catalogValidate/
catalogDrift 300s、paidFeatureCheck/betaRosterGate 120s、harnessTests 3600s、durableCommand
600s）；超时后 Precheck 终止完整进程树（POSIX 新进程组 SIGKILL、Windows taskkill /T），输出
`== <cid>: TIMEOUT (elapsed=..., timeout=...)` 并计入失败（precheck 非零退出，证据语义为真实
TIMEOUT 而非 PASS）；永久阻塞子进程测试真实验证 POSIX/Windows 进程树终止；backend/frontend
CI job 有明确 timeout-minutes。

## 范围内

- `.harness/commands.yaml`：每个命令增加 `timeoutSeconds`（doctor 900、catalogValidate 300、
  catalogDrift 300、paidFeatureCheck 120、betaRosterGate 120、harnessTests 3600、
  durableCommand 600）。
- `scripts/harness/harness_common.py`：新增 `run_command_with_timeout(argv, cwd,
  timeout_seconds)` 返回 `(returncode, timed_out)`——POSIX 用 `start_new_session=True` 建立
  新进程组、超时后 `os.killpg(..., SIGKILL)`；Windows 用 `CREATE_NEW_PROCESS_GROUP`、
  超时后 `taskkill /F /T /PID` 终止进程树；超时与正常完成都返回真实退出码与超时标志。
- `scripts/harness/precheck.py`：`_run_cmd` 改用 `run_command_with_timeout`，读取命令的
  `timeoutSeconds`（缺失时默认 1800s 并输出说明）；超时状态打印 `TIMEOUT`（含 elapsed 与
  timeout），计入 failures 使 precheck 非零退出；PASS/FAIL/TIMEOUT 语义互斥。
- `scripts/harness/doctor.py`：ci-execution-policy 校验中 harnessTests 的精确命令 dict 断言
  同步加入 `timeoutSeconds: 3600`（doctor.py 13483-13493 行）。
- `scripts/harness/tests/test_harness.py`：新增 TimeoutTests——永久阻塞子进程（sleep 3600）
  在短 timeout（2s）下被终止（POSIX/Windows 各自进程树终止路径），helper 返回 TIMEOUT 标志与
  真实退出码；无删测、无新增 skip（平台门控仅 Windows/POSIX 各一）。
- `.github/workflows/ci.yml`：backend 补 `timeout-minutes: 30`、frontend 补
  `timeout-minutes: 20`（其余 job 已有）。
- 唯一正式 Precheck、完整 Harness unittest、唯一 `git diff --check`、独立 C4 R1、pre-closure、
  push、fetch、clean 与远端 `0/0` 全部真实完成。

## 明确范围外

- 不修改 precheck.sh/precheck.ps1、durable_command.ps1、catalog_tool.py、check_*.py、
  commands.yaml 的 profile 结构或命令 argv。
- 不修改 AGENTS.md/CLAUDE.md 与 `.harness/agent-entrypoints.yaml`。
- 不修改历史 Evidence/Handoff/Card/Context/Backlog 条目或任何历史 Git 对象。
- 不处理 P2-25（SBOM/license，Owner gate）、P2-27（路径感知矩阵）、OpenAPI、业务、数据库、
  frontend 源码或 Provider DNS。

## 输入和前置条件

- Base `4a5d68119eb544f3c3746ff03dbfb31e1ad088b9` 是 TASK-0142 单父 ACCEPTED terminal，
  已 push、fetch、`HEAD...origin/main=0/0` 且工作树 clean。
- 本卡 context lock 的 provenance 条目带 `provenanceOnly: true`，fingerprint `5d8e44d4…`
  基于 Base 重新计算。
- 受控 Python 环境：`PATH=/Users/hxf/.zcode/venvs/vc-harness/bin:$PATH` 前置，`python` 解析到
  受控解释器（venv python3.13）。
- Owner 授权 provenance Hash 沿用 `cc0f91c1ddad24cb89128002439148384e4af8b6c8d056498ba8814a53580e95`。

## API / 事件 / 数据契约

不改变产品 API、事件或数据。命令注册表新增可选 `timeoutSeconds` 字段（向后兼容，缺失时默认
1800s）；超时输出格式 `== <cid>: TIMEOUT (exit=TERMINATED, elapsed=..., timeout=...)`；
不提供 CLI flag、环境变量 override、Git note/replace/graft 或可配置 allowlist。

## 状态机和失败行为

执行普通 `DRAFT -> READY -> IN_PROGRESS -> IN_REVIEW -> ACCEPTED`。READY Doctor 真实 PASS 后
进入实现；README 后不得修改任务卡正文或不可变元数据。

命令超时：终止完整进程树（POSIX killpg / Windows taskkill /T），状态为 TIMEOUT（非 PASS、非
FAIL 语义），precheck 计入 failures 并以非零退出；Evidence 按真实 TIMEOUT 记录（含命令/耗时/
timeout/候选身份），绝不转换为 PASS。R1 最多两轮、一批前向修复；R2 新增结构性 P0/P1 或任一
正式门禁非 PASS 时停止并 REJECTED。

## 验收标准

- commands.yaml 每个命令有 `timeoutSeconds`（正值整数），precheck 执行时应用。
- 超时场景：永久阻塞子进程在 timeout 后被终止，helper 返回 timed_out=True 与真实退出码；
  POSIX 与 Windows 两条终止路径各有真实测试（sleep 3600 + timeout 2s），测试运行后无残留进程。
- precheck 对超时命令输出 `TIMEOUT` 状态且整体退出码非零；doctor.py harnessTests 精确断言
  与 commands.yaml 一致。
- ci.yml backend/frontend 有 timeout-minutes。
- 完整 Harness unittest 全部通过（265+ tests，含新增 TimeoutTests）。
- 唯一正式 Precheck、唯一 `git diff --check`、独立 C4 R1、终态 pre-closure、push、fetch、clean
  和远端 `0/0` 全部真实完成；remote unavailable 仍非 PASS。
- post-terminal Doctor 在最新终态通过，历史制品保持 byte-for-byte 不变。

## 必跑检查

以 YAML `requiredCommands` 精确 argv 为准。实现迭代只运行 TimeoutTests 与受影响定向测试；
冻结候选后依次执行独立 Reviewer、唯一 Precheck、完整 Harness、唯一无参数 diff check、
Evidence/Handoff 和唯一 pre-closure。Precheck 已覆盖的 canonical 子命令不重复。

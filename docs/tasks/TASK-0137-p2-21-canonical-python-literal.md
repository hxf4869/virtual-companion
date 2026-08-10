# TASK-0137：P2-21 canonical Python 解释器合同统一为字面量 python

```yaml
taskId: TASK-0137
state: REJECTED
closureOnly: true
terminalStateReason: >-
  唯一正式 Precheck 在 Doctor 阶段如实 FAIL：修改 AGENTS.md（P2-21 字面量 python 合同的一部分）
  导致 .harness/agent-entrypoints.yaml 中 codex/zed/githubCopilotCliAgentInstructions 绑定的
  contentSha256 drift，而该文件被本卡 READY 冻结的 forbiddenPaths 禁止（写路径设计错误：
  AGENTS.md 变更的必要伴随同步文件未纳入 writeAllowlist）。READY 后 writeAllowlist/forbiddenPaths
  不可修改（scopeAmendments 需 Backlog 合同，task-backlog.yaml 同样被禁），正式门禁非 PASS 即
  停止 promotion，本卡如实 REJECTED，不改写历史、不删测、不伪造 PASS；P2-21 由新的 C4 治理卡
  从 DRAFT 起将 agent-entrypoints.yaml 纳入写路径后重新验证。
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
baseCommit: 23eda74e56b76cee3ff925c402b8a373bfacf52b
authorizationCommit: 4acbd0059a49a144ae71cab4de04fcaa2eb028ab
contextFingerprint: ed741d05eb2e83f1b2c1811cc63048a4a2a72704866e45eaba195c990d8c8263
contextLock: docs/tasks/context/TASK-0137.context-lock.yaml
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
  surfaceId: TASK_0137_P2_21_CANONICAL_PYTHON_LITERAL
  policySurfaces: [GOVERNANCE, CI]
  distinctCrossRiskSurfaces: 2
  reviewerMinutesEstimate: 15
  terminalCheckMinutesEstimate: 20
  estimatedWallMinutes: 60
  thresholdsTriggered: [crossRiskSurfaces]
  splitRequired: false
  ownerIndivisibleAuthorization: true
  indivisibleReason: >-
    canonical Python 解释器合同必须在 AGENTS、policy、wrapper 与测试中同步收敛为单一字面量；
    拆分会使 wrapper 与 canonical 歧义继续存在，且无法建立可验证的跨平台一致性。Owner 已于
    2026-08-10 明确选择字面量 python。
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
  - docs/evidence/TASK-0124/evidence-pack.json
  - docs/evidence/TASK-0129/evidence-pack.json
  - docs/evidence/TASK-0133/evidence-pack.json
  - docs/evidence/TASK-0133/pre-closure-request.json
  - docs/evidence/TASK-0133/review-r1.md
  - docs/evidence/TASK-0134/evidence-pack.json
  - docs/evidence/TASK-0134/pre-closure-request.json
  - docs/evidence/TASK-0134/review-r1.md
  - docs/evidence/TASK-0135/evidence-pack.json
  - docs/evidence/TASK-0135/pre-closure-request.json
  - docs/evidence/TASK-0135/review-r1.md
  - docs/evidence/TASK-0136/evidence-pack.json
  - docs/evidence/TASK-0136/pre-closure-request.json
  - docs/evidence/TASK-0136/review-r1.md
  - docs/handoffs/TASK-0111.json
  - docs/handoffs/TASK-0124.json
  - docs/handoffs/TASK-0129.json
  - docs/handoffs/TASK-0133.json
  - docs/handoffs/TASK-0134.json
  - docs/handoffs/TASK-0135.json
  - docs/handoffs/TASK-0136.json
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
  - docs/tasks/TASK-0111-auth-input-hygiene.md
  - docs/tasks/context/TASK-0111.context-lock.yaml
  - docs/tasks/TASK-0124-auth-firewall-envelope-observation.md
  - docs/tasks/context/TASK-0124.context-lock.yaml
  - docs/tasks/TASK-0129-anthropic-tool-use-protocol-replacement.md
  - docs/tasks/context/TASK-0129.context-lock.yaml
  - docs/tasks/TASK-0133-harness-default-branch-fixture-portability.md
  - docs/tasks/context/TASK-0133.context-lock.yaml
  - docs/tasks/TASK-0134-task0133-harness-approval-quarantine.md
  - docs/tasks/context/TASK-0134.context-lock.yaml
  - docs/tasks/TASK-0135-task0111-context-fingerprint-quarantine.md
  - docs/tasks/context/TASK-0135.context-lock.yaml
  - docs/tasks/TASK-0136-task0111-0124-0129-context-fingerprint-quarantine.md
  - docs/tasks/context/TASK-0136.context-lock.yaml
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
  - docs/tasks/TASK-0137-p2-21-canonical-python-literal.md
  - docs/tasks/context/TASK-0137.context-lock.yaml
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - docs/evidence/TASK-0137/**
  - docs/handoffs/TASK-0137.json
  - AGENTS.md
  - scripts/harness/precheck.sh
  - scripts/harness/precheck.ps1
  - scripts/harness/tests/test_harness.py
forbiddenPaths:
  - docs/tasks/TASK-00*-*
  - docs/tasks/TASK-010*-*
  - docs/tasks/TASK-011*-*
  - docs/tasks/TASK-012*-*
  - docs/tasks/TASK-0130-*
  - docs/tasks/TASK-0131-*
  - docs/tasks/TASK-0132-*
  - docs/tasks/TASK-0133-*
  - docs/tasks/TASK-0134-*
  - docs/tasks/TASK-0135-*
  - docs/tasks/TASK-0136-*
  - docs/tasks/context/TASK-00*.context-lock.yaml
  - docs/tasks/context/TASK-010*.context-lock.yaml
  - docs/tasks/context/TASK-011*.context-lock.yaml
  - docs/tasks/context/TASK-012*.context-lock.yaml
  - docs/tasks/context/TASK-0130.context-lock.yaml
  - docs/tasks/context/TASK-0131.context-lock.yaml
  - docs/tasks/context/TASK-0132.context-lock.yaml
  - docs/tasks/context/TASK-0133.context-lock.yaml
  - docs/tasks/context/TASK-0134.context-lock.yaml
  - docs/tasks/context/TASK-0135.context-lock.yaml
  - docs/tasks/context/TASK-0136.context-lock.yaml
  - docs/evidence/TASK-00*/**
  - docs/evidence/TASK-010*/**
  - docs/evidence/TASK-011*/**
  - docs/evidence/TASK-012*/**
  - docs/evidence/TASK-0130/**
  - docs/evidence/TASK-0131/**
  - docs/evidence/TASK-0132/**
  - docs/evidence/TASK-0133/**
  - docs/evidence/TASK-0134/**
  - docs/evidence/TASK-0135/**
  - docs/evidence/TASK-0136/**
  - docs/handoffs/TASK-00*.json
  - docs/handoffs/TASK-010*.json
  - docs/handoffs/TASK-011*.json
  - docs/handoffs/TASK-012*.json
  - docs/handoffs/TASK-0130.json
  - docs/handoffs/TASK-0131.json
  - docs/handoffs/TASK-0132.json
  - docs/handoffs/TASK-0133.json
  - docs/handoffs/TASK-0134.json
  - docs/handoffs/TASK-0135.json
  - docs/handoffs/TASK-0136.json
  - .gitattributes
  - CLAUDE.md
  - README.md
  - .github/**
  - ci/**
  - requirements-harness.txt
  - scripts/dev/**
  - scripts/harness/catalog_tool.py
  - scripts/harness/check_beta_gate.py
  - scripts/harness/check_paid_features.py
  - scripts/harness/durable_command.ps1
  - scripts/harness/harness_common.py
  - scripts/harness/precheck.py
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
  - docs/evidence/TASK-0109/zcode-remediation-handoff.md
  - docs/evidence/TASK-0136/evidence-pack.json
  - docs/handoffs/TASK-0136.json
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
      Owner 在长线会话中明确选择 P2-21 canonical Python 解释器合同为「字面量 python」，
      批准创建本 C4 卡同步 AGENTS、policy、Skill、模板、wrapper 与测试并完成完整门禁；
      禁止历史改写和伪造 PASS。
  - scope: harness-change
    approvedBy: repository-owner
    approvedAt: "2026-08-10"
    sourceThreadId: 019fdf92-9c99-7400-a2ea-d490ef3d7e15
    evidence: >-
      Owner 明确批准以精确 scope=harness-change 实施 P2-21：将 AGENTS.md 会话恢复命令、
      precheck.sh/precheck.ps1 解释器探测与对应 wrapper 测试统一收敛为字面量 python；
      不授权通用解释器 alias、环境变量 override、history rewrite、policy/Skill/阈值弱化
      或对其他任务复用。
  - scope: local-exact-tree-fallback
    approvedBy: repository-owner
    approvedAt: "2026-08-10"
    sourceThreadId: 019fdf92-9c99-7400-a2ea-d490ef3d7e15
    evidence: >-
      Owner 要求长线继续推进；既有 includedMinutes=usedMinutes=2000、paidBudgetUsd=0、
      stopUsageEnabled=true、dispatchCount=0 与无 runner exact-SHA 事实保持不变。本卡重新冻结
      LOCAL_EXACT_TREE_FALLBACK，远端仍如实非 PASS，不复用 TASK-0136 的 Reviewer 或命令 PASS。
independentReview: required
reviewers:
  - id: task0137_r1
    kind: independent-review-gate
    verdict: PASS
    reviewedCommit: 187c4f5c95e06bbc0b7f6bfb84f440d7a1db0a0b
    evidencePath: docs/evidence/TASK-0137/review-r1.md
    reason: "R1 完整复核 PASS：候选身份、P2-21 字面量 python 合同验收逐条、INV-HARNESS-001..009 与邻近风险全部核对；AGENTS/precheck.sh/ps1 唯一字面量 python，wrapper 测试正负例覆盖，无删测无吞退出码；P0/P1/P2=0、P3=4 非阻断提示；Reviewer 未运行正式门禁。"
    candidateTree: ce09d8b6e9845724b5a214c41d3661e0f6b99b20
  - id: task0137_r2
    kind: independent-review-gate
    verdict: PASS
    reviewedCommit: 0e65262651f2dba077f52a28aef57609856a30e8
    evidencePath: docs/evidence/TASK-0137/review-r1.md
    reason: "R2 FINDING_CLOSURE + DELTA 复核 PASS：R1 P3-1（wrapper 负例测试平台门控与「无新增 skip」字面冲突）已按 Owner 既定方向关闭——两 wrapper 测试合并为单方法、保留既有 1 个平台门控，net 无新增 skip、无删测、无吞退出码；R2 delta 只改 test_harness.py（+3/-4），无新结构性 P0/P1；Reviewer 未运行正式门禁。"
    candidateTree: 69ed63613b4ee776ca826a07d64adde196c72e0a
requiredCommands:
  - python scripts/harness/precheck.py --task TASK-0137
  - python -m unittest scripts.harness.tests.test_harness
  - git diff --check
```

> 本卡不在 Backlog 中，不写 `planningBacklog` 或 `planningContractHash`。P2-21 是
> `docs/evidence/TASK-0109/zcode-remediation-handoff.md` 登记的 OWNER_GATE 审计项，Owner 已于
> 2026-08-10 选择字面量 python 合同。

## 背景与用户可观察目标

P2-21（canonical Python 合同冲突，OWNER_GATE）现状：机器合同冻结 `python scripts/harness/
precheck.py`（commands.yaml runner、task-delivery-policy canonicalPythonArgv、任务模板均用字面量
python），但 AGENTS.md 会话恢复步骤写了「只有 python3 时使用 python3」的 fallback，precheck.sh
探测顺序为 `python3 python`，precheck.ps1 候选含 `python3` 与 `py -3`，wrapper 测试
`test_posix_wrapper_falls_back_from_old_python3` 断言 python3 失败时回退 python。这些不一致使
wrapper 与 canonical 解释器合同存在歧义。

用户可观察结果：AGENTS.md 与所有 wrapper 统一为字面量 `python`（受控 venv PATH 前置保证指向
受控解释器）；`python3` 不再作为 canonical 或 fallback；wrapper 在缺少可用 python 时失败关闭并
保持真实退出码；wrapper 测试同步验证新合同。跨平台 wrapper 仍调用同一 Python Harness 实现。

## 范围内

- AGENTS.md 会话恢复步骤改为字面量 `python scripts/harness/doctor.py --summary`，移除
  「只有 python3 时使用 python3」fallback 表述。
- scripts/harness/precheck.sh 解释器探测收敛为字面量 `python`（保留 3.11+ 探针与失败关闭，
  移除 python3 候选）。
- scripts/harness/precheck.ps1 候选列表收敛为字面量 `python`（保留 3.11+ 探针、venv/setup-python
  优先语义与失败关闭，移除 python3 与 py -3 候选）。
- scripts/harness/tests/test_harness.py 更新 wrapper 测试以匹配新合同（python3 不再回退，缺少
  python 时失败关闭），保留其余断言。
- 唯一正式 Precheck、完整 Harness unittest、唯一 `git diff --check`、独立 C4 R1、pre-closure、
  push、fetch、clean 与远端 `0/0` 全部真实完成。

## 明确范围外

- 不修改 scripts/harness/precheck.py 本体、commands.yaml、task-delivery-policy.yaml、
  ci-execution-policy.yaml、schemas、Skill、task-card-template、requirements-harness.txt、
  .github/workflows/ci.yml 或 .harness 其他文件（除 project-state/task-ledger 终态更新）。
- 不修改历史 Evidence/Handoff（其中历史命令含 python3 属不可变历史，不追溯改写）。
- 不修 P2-23 至 P2-27、OpenAPI、业务、数据库、frontend 或 Provider DNS。

## 输入和前置条件

- Base `23eda74e56b76cee3ff925c402b8a373bfacf52b` 是 TASK-0136 单父 ACCEPTED terminal，已 push、
  fetch、`HEAD...origin/main=0/0` 且工作树 clean。
- 受控 Python 环境：`PATH=/Users/hxf/.zcode/venvs/vc-harness/bin:$PATH` 前置，`python` 解析到受控
  解释器（venv python3.13）。
- Owner 授权 provenance Hash 为 `cc0f91c1ddad24cb89128002439148384e4af8b6c8d056498ba8814a53580e95`。

## API / 事件 / 数据契约

不改变产品 API、事件或数据。解释器合同是治理/CI 内部契约，不提供 CLI flag、环境变量 override、
Git note/replace/graft 或可配置 allowlist。

## 状态机和失败行为

执行普通 `DRAFT -> READY -> IN_PROGRESS -> IN_REVIEW -> ACCEPTED`。READY Doctor 真实 PASS 后
进入实现；README 后不得修改任务卡正文或不可变元数据。

wrapper 缺少可用 `python` 时以非零退出码失败关闭并输出明确错误；探针版本低于 3.11 同样失败关闭。
R1 最多两轮、一批前向修复；R2 新增结构性 P0/P1 或任一正式门禁非 PASS 时停止并 REJECTED。

## 验收标准

- AGENTS.md、precheck.sh、precheck.ps1 全部以字面量 `python` 为唯一解释器引用；无 `python3`
  作为 canonical 或 fallback 的残留（历史制品除外）。
- wrapper 测试更新后覆盖：python 可用时选择 python；python 缺失时失败关闭（真实非零退出码）；
  不再回退 python3。
- 完整 Harness unittest 全部通过（262+ tests），无删除测试、无新增 skip。
- 唯一正式 Precheck、唯一 `git diff --check`、独立 C4 R1、终态 pre-closure、push、fetch、clean
  和远端 `0/0` 全部真实完成；remote unavailable 仍非 PASS。
- post-terminal Doctor 在最新终态通过，历史制品保持 byte-for-byte 不变。

## 必跑检查

以 YAML `requiredCommands` 精确 argv 为准。实现迭代只运行 wrapper 相关定向测试；冻结候选后
依次执行独立 Reviewer、唯一 Precheck、完整 Harness、唯一无参数 diff check、Evidence/Handoff
和唯一 pre-closure。Precheck 已覆盖的 canonical 子命令不重复。

# TASK-0138：P2-21 canonical Python 解释器合同统一为字面量 python（含 Agent 入口同步）

```yaml
taskId: TASK-0138
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
baseCommit: 336dc60d4fc12bca33ae55cffe367efa50821903
authorizationCommit: ""
contextFingerprint: 1eb8a596bf0e8dabede5fed34ef5dd423c429e3db845a6da36e8334efd641aaa
contextLock: docs/tasks/context/TASK-0138.context-lock.yaml
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
  surfaceId: TASK_0138_P2_21_CANONICAL_PYTHON_LITERAL_WITH_ENTRYPOINTS
  policySurfaces: [GOVERNANCE, CI]
  distinctCrossRiskSurfaces: 2
  reviewerMinutesEstimate: 15
  terminalCheckMinutesEstimate: 20
  estimatedWallMinutes: 60
  thresholdsTriggered: [crossRiskSurfaces]
  splitRequired: false
  ownerIndivisibleAuthorization: true
  indivisibleReason: >-
    canonical Python 解释器合同必须在 AGENTS、agent-entrypoints contentSha256 绑定、policy、wrapper
    与测试中同步收敛为单一字面量；AGENTS.md 变更必然伴随 .harness/agent-entrypoints.yaml 的
    contentSha256 更新（Doctor 强制绑定），因此该文件必须在本卡 writeAllowlist 内。Owner 已于
    2026-08-10 明确选择字面量 python；TASK-0137 因遗漏该写路径如实 REJECTED，本卡自 DRAFT 起修正。
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
  - docs/evidence/TASK-0137/evidence-pack.json
  - docs/evidence/TASK-0137/pre-closure-request.json
  - docs/evidence/TASK-0137/review-r1.md
  - docs/handoffs/TASK-0111.json
  - docs/handoffs/TASK-0124.json
  - docs/handoffs/TASK-0129.json
  - docs/handoffs/TASK-0133.json
  - docs/handoffs/TASK-0134.json
  - docs/handoffs/TASK-0135.json
  - docs/handoffs/TASK-0136.json
  - docs/handoffs/TASK-0137.json
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
  - docs/tasks/TASK-0137-p2-21-canonical-python-literal.md
  - docs/tasks/context/TASK-0137.context-lock.yaml
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
  - docs/tasks/TASK-0138-p2-21-canonical-python-literal-with-entrypoints.md
  - docs/tasks/context/TASK-0138.context-lock.yaml
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - docs/evidence/TASK-0138/**
  - docs/handoffs/TASK-0138.json
  - AGENTS.md
  - .harness/agent-entrypoints.yaml
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
  - docs/tasks/TASK-0137-*
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
  - docs/tasks/context/TASK-0137.context-lock.yaml
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
  - docs/evidence/TASK-0137/**
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
  - docs/handoffs/TASK-0137.json
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
  - docs/evidence/TASK-0137/evidence-pack.json
  - docs/handoffs/TASK-0137.json
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
      Owner 在长线会话中明确选择 P2-21 canonical Python 解释器合同为「字面量 python」；TASK-0137
      因遗漏 .harness/agent-entrypoints.yaml 写路径如实 REJECTED 后，Owner 批准创建本 C4 卡自
      DRAFT 起纳入该伴随同步文件并重跑完整门禁；禁止历史改写和伪造 PASS。
  - scope: harness-change
    approvedBy: repository-owner
    approvedAt: "2026-08-10"
    sourceThreadId: 019fdf92-9c99-7400-a2ea-d490ef3d7e15
    evidence: >-
      Owner 明确批准以精确 scope=harness-change 实施 P2-21：将 AGENTS.md 会话恢复命令、
      .harness/agent-entrypoints.yaml 的 contentSha256 绑定、precheck.sh/precheck.ps1 解释器探测
      与对应 wrapper 测试统一收敛为字面量 python；不授权通用解释器 alias、环境变量 override、
      history rewrite、policy/Skill/阈值弱化或对其他任务复用。
  - scope: local-exact-tree-fallback
    approvedBy: repository-owner
    approvedAt: "2026-08-10"
    sourceThreadId: 019fdf92-9c99-7400-a2ea-d490ef3d7e15
    evidence: >-
      Owner 要求长线继续推进；既有 includedMinutes=usedMinutes=2000、paidBudgetUsd=0、
      stopUsageEnabled=true、dispatchCount=0 与无 runner exact-SHA 事实保持不变。本卡重新冻结
      LOCAL_EXACT_TREE_FALLBACK，远端仍如实非 PASS，不复用 TASK-0136/0137 的 Reviewer 或命令 PASS。
independentReview: required
reviewers: []
requiredCommands:
  - python scripts/harness/precheck.py --task TASK-0138
  - python -m unittest scripts.harness.tests.test_harness
  - git diff --check
```

> 本卡不在 Backlog 中，不写 `planningBacklog` 或 `planningContractHash`。P2-21 是
> `docs/evidence/TASK-0109/zcode-remediation-handoff.md` 登记的 OWNER_GATE 审计项，Owner 已于
> 2026-08-10 选择字面量 python 合同；TASK-0137 因 write-path 设计错误如实 REJECTED，本卡修正承接。

## 背景与用户可观察目标

P2-21（canonical Python 合同冲突，OWNER_GATE）现状：机器合同冻结 `python scripts/harness/
precheck.py`，但 AGENTS.md 会话恢复步骤写了「只有 python3 时使用 python3」的 fallback，precheck.sh
探测顺序为 `python3 python`，precheck.ps1 候选含 `python3` 与 `py -3`，wrapper 测试断言 python3
失败时回退。TASK-0137 已把 AGENTS.md/precheck.sh/precheck.ps1/wrapper 测试收敛为字面量 python
（R1/R2 PASS），但唯一正式 Precheck 发现 AGENTS.md 变更导致 `.harness/agent-entrypoints.yaml`
（codex/zed/githubCopilotCliAgentInstructions）的 contentSha256 绑定 drift，而该文件被 TASK-0137
README 冻结的 forbiddenPaths 禁止；READY 后写路径不可改，故 TASK-0137 如实 REJECTED 并将实现
回滚为 Base 内容（保留在候选提交历史中）。

用户可观察结果：AGENTS.md、agent-entrypoints.yaml 与所有 wrapper 统一为字面量 `python`（受控
venv PATH 前置）；`python3` 不再作为 canonical 或 fallback；wrapper 在缺少可用 python 时失败关闭
并保持真实退出码；Doctor 的 agent-entrypoints contentSha256 绑定同步更新；跨平台 wrapper 仍调用
同一 Python Harness 实现。

## 范围内

- AGENTS.md 会话恢复步骤改为字面量 `python scripts/harness/doctor.py --summary`，移除
  「只有 python3 时使用 python3」fallback 表述。
- `.harness/agent-entrypoints.yaml` 中 codex/zed/githubCopilotCliAgentInstructions 的
  contentSha256 同步为修改后 AGENTS.md 的 SHA-256（claudeCode/claudeImport 的 CLAUDE.md 绑定
  不变）。
- scripts/harness/precheck.sh 解释器探测收敛为字面量 `python`（保留 3.11+ 探针与失败关闭）。
- scripts/harness/precheck.ps1 候选列表收敛为字面量 `python`（保留 3.11+ 探针与失败关闭）。
- scripts/harness/tests/test_harness.py 更新 wrapper 测试以匹配新合同（python3 不再回退，缺少
  python 时失败关闭；合并为单测试方法保留既有平台门控，net 无新增 skip），保留其余断言。
- 唯一正式 Precheck、完整 Harness unittest、唯一 `git diff --check`、独立 C4 R1、pre-closure、
  push、fetch、clean 与远端 `0/0` 全部真实完成。

## 明确范围外

- 不修改 scripts/harness/precheck.py 本体、commands.yaml、task-delivery-policy.yaml、
  ci-execution-policy.yaml、schemas、Skill、task-card-template、requirements-harness.txt、
  .github/workflows/ci.yml 或 .harness 其他文件（除 agent-entrypoints 与本卡 lifecycle 终态更新）。
- 不修改历史 Evidence/Handoff（其中历史命令含 python3 属不可变历史，不追溯改写）。
- 不修 P2-23 至 P2-27、OpenAPI、业务、数据库、frontend 或 Provider DNS。

## 输入和前置条件

- Base `336dc60d4fc12bca33ae55cffe367efa50821903` 是 TASK-0137 单父 REJECTED terminal（实现已
  回滚为 Base 内容），已 push、fetch、`HEAD...origin/main=0/0` 且工作树 clean。
- TASK-0137 候选提交 187c4f5/0e65262 保留字面量 python 实现历史供参考，本卡重新实现，不复用其
  门禁 PASS。
- 受控 Python 环境：`PATH=/Users/hxf/.zcode/venvs/vc-harness/bin:$PATH` 前置，`python` 解析到
  受控解释器（venv python3.13）。
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

- AGENTS.md、agent-entrypoints.yaml、precheck.sh、precheck.ps1 全部以字面量 `python` 为唯一
  解释器引用；无 `python3` 作为 canonical 或 fallback 的残留（历史制品除外）；agent-entrypoints
  contentSha256 与修改后 AGENTS.md 精确一致。
- wrapper 测试更新后覆盖：python 可用时选择 python；python 缺失时失败关闭（真实非零退出码）；
  不再回退 python3；net 无新增 skip、无删测。
- 完整 Harness unittest 全部通过（262+ tests）。
- 唯一正式 Precheck、唯一 `git diff --check`、独立 C4 R1、终态 pre-closure、push、fetch、clean
  和远端 `0/0` 全部真实完成；remote unavailable 仍非 PASS。
- post-terminal Doctor 在最新终态通过，历史制品保持 byte-for-byte 不变。

## 必跑检查

以 YAML `requiredCommands` 精确 argv 为准。实现迭代只运行 wrapper 相关定向测试；冻结候选后
依次执行独立 Reviewer、唯一 Precheck、完整 Harness、唯一无参数 diff check、Evidence/Handoff
和唯一 pre-closure。Precheck 已覆盖的 canonical 子命令不重复。

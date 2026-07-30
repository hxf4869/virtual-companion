# TASK-0009：修复 Windows Harness CI 超时裕量

```yaml
taskId: TASK-0009
state: ACCEPTED
owner: repository-owner
riskClass: C4
requiredSkills:
  - task-intake
  - harness-change
requiredSkillVersions:
  task-intake: 1.1.0
  harness-change: 1.1.0
targetSkillVersions: {}
baseCommit: 8e5e7aa5a8b2f245b804be058c799826d81fd74c
authorizationCommit: 3ee6c1d0c608594bef3a049d1ca92cfe3a814041
contextFingerprint: aae0afd52bb7ccae70afa02646a2dd895cbe90e31b5af56b7fcc44e1c5155470
contextLock: docs/tasks/context/TASK-0009.context-lock.yaml
contextFingerprintAlgorithm: SHA256_ORDINAL_SORTED_PATH_EQUALS_HASH_LF_V1
readAllowlist:
  - AGENTS.md
  - README.md
  - .github/workflows/ci.yml
  - .harness/**
  - skills/task-intake/SKILL.md
  - skills/harness-change/SKILL.md
  - scripts/harness/**
  - requirements-harness.txt
  - docs/decisions/0003-portable-agent-harness.md
  - docs/engineering/agent-onboarding.md
  - docs/tasks/**
  - docs/evidence/TASK-0008/**
  - docs/handoffs/TASK-0008.json
writeAllowlist:
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - docs/tasks/TASK-0009-windows-harness-ci-timeout-budget.md
  - docs/tasks/context/TASK-0009.context-lock.yaml
  - docs/evidence/TASK-0009/**
  - docs/handoffs/TASK-0009.json
  - .github/workflows/ci.yml
  - scripts/harness/tests/test_harness.py
forbiddenPaths:
  - AGENTS.md
  - CLAUDE.md
  - .github/copilot-instructions.md
  - .harness/task-lifecycle.yaml
  - .harness/sources-of-truth.yaml
  - .harness/invariants.yaml
  - .harness/protected-paths.yaml
  - .harness/skills.yaml
  - .harness/commands.yaml
  - .harness/tools.lock.yaml
  - .harness/license-policy.yaml
  - skills/**
  - scripts/harness/doctor.py
  - scripts/harness/harness_common.py
  - scripts/harness/precheck.py
  - scripts/harness/precheck.ps1
  - scripts/harness/precheck.sh
  - scripts/harness/catalog_tool.py
  - scripts/harness/check_beta_gate.py
  - scripts/harness/check_paid_features.py
  - requirements-harness.txt
  - docs/schemas/**
  - docs/tasks/task-card-template.md
  - specs/**
  - service/**
  - frontend/**
  - db/**
  - deploy/**
  - ops/**
  - docs/source/**
sourcesOfTruth:
  - AGENTS.md
  - .github/workflows/ci.yml
  - .harness/project-state.yaml
  - .harness/task-lifecycle.yaml
  - .harness/sources-of-truth.yaml
  - .harness/invariants.yaml
  - .harness/protected-paths.yaml
  - .harness/skills.yaml
  - .harness/commands.yaml
  - .harness/tools.lock.yaml
  - .harness/license-policy.yaml
  - skills/task-intake/SKILL.md
  - skills/harness-change/SKILL.md
  - scripts/harness/doctor.py
  - scripts/harness/precheck.py
  - scripts/harness/precheck.ps1
  - scripts/harness/precheck.sh
  - scripts/harness/tests/test_harness.py
  - requirements-harness.txt
  - docs/decisions/0003-portable-agent-harness.md
  - docs/engineering/agent-onboarding.md
  - docs/evidence/TASK-0008/evidence-pack.json
  - docs/handoffs/TASK-0008.json
requiredInvariants:
  - INV-COST-001
  - INV-HARNESS-001
  - INV-HARNESS-002
  - INV-HARNESS-003
  - INV-HARNESS-004
  - INV-HARNESS-005
humanApprovals:
  - scope: harness-change
    approvedBy: repository-owner
    approvedAt: 2026-07-30
    evidence: 用户此前明确“允许修复 CI”；本任务只前向修复已由两次精确 SHA 运行证明的 Windows Harness 总作业时间预算不足，不删除、跳过或放宽任何检查
independentReview: required
reviewers:
  - id: codex-task0009-ci-reviewer
    kind: ci-harness-timeout-budget
    verdict: PASS
    reviewedCommit: a178e8fb6c3ba05e4c06469fc83f9c553d97ec65
    evidencePath: docs/evidence/TASK-0009/review-ci-harness-timeout.md
requiredCommands:
  - python scripts/harness/doctor.py --task TASK-0009
  - python scripts/harness/catalog_tool.py validate
  - python scripts/harness/catalog_tool.py diff --fail-on-drift
  - python -m unittest discover -s scripts/harness/tests -p test_*.py
  - python scripts/harness/precheck.py --task TASK-0009
  - powershell -NoProfile -ExecutionPolicy Bypass -File scripts/harness/precheck.ps1 -Task TASK-0009
  - wsl.exe -d Ubuntu-24.04 -- bash scripts/harness/precheck.sh --task TASK-0009
  - git diff --check
```

## 背景与用户可观察目标

TASK-0008 的精确实现提交在 GitHub Actions Run `30505196389` 上两次只失败于 Windows Harness 的十分钟总作业上限。首次运行的 69 项 Harness 测试已全部通过，随后统一 precheck 被 GitHub 取消；第二次运行在相同硬上限处甚至来不及完成测试。Backend、Frontend、Ubuntu Harness 与 macOS Harness 均成功，本机 Python、Windows PowerShell 和 WSL2 入口也全部通过。

本任务让 Windows Runner 拥有与真实耗时匹配的明确预算，同时继续执行原有全部测试和统一 precheck。开发者应能区分“门禁失败”和“作业预算不足”，后续业务任务不再依赖偶然的 Runner 速度取得全绿。

## 范围内

- 将 Harness matrix 改为三个显式 OS 项，并为每项声明整数分钟预算；
- Windows Harness 总作业预算设为 20 分钟，Ubuntu 与 macOS 继续保持 10 分钟；
- 保留现有 `fail-fast: false`、Runner、Python 版本、安装、69 项 Harness 测试和 canonical precheck 步骤；
- 增加自动测试，锁定三个 OS、逐 OS 预算与现有步骤序列，防止未来退回单一不足预算或删除检查；
- 使用同一统一 Harness 入口完成 Windows、WSL/POSIX 和 GitHub 三平台复验。

## 明确范围外

- 删除、跳过、拆弱或吞掉任何 Harness 测试、Doctor、Catalog、付费依赖或 Beta Gate；
- 修改 Doctor、precheck 核心、跨平台包装、命令注册表、Schema、Skill、Agent 规则或 Catalog；
- 为了加速而改写 69 项 Harness 测试的语义、Fixture 或失败断言；
- 修改 Backend、Frontend、业务模块、模型协议、数据库、部署或产品能力；
- 更换 GitHub Runner、Actions 主版本、Python 版本或引入第三方 CI 服务；
- 把超时提高视为测试通过；只有步骤实际执行成功才可记为 PASS。

## 输入和前置条件

- Base Commit 为 TASK-0008 终态 `8e5e7aa5a8b2f245b804be058c799826d81fd74c`；
- 精确实现 Run `30505196389` 的两次 Windows 作业均由十分钟 `timeout-minutes` 取消；
- 首次 Windows 日志证明 69 项测试 `OK (skipped=1)` 后才进入 precheck，排除 Generation 代码或 Harness 断言失败；
- `harness-change@1.1.0` 要求 C4、明确人工批准、最小受保护写入和独立 Reviewer；
- DRAFT 只包含本任务卡与 Context Lock，READY 后才允许写 `.github/workflows/ci.yml`。

## API / 事件 / 数据契约

- Harness matrix 必须恰好包含 `ubuntu-latest`、`windows-latest`、`macos-latest`；
- 每项必须提供 `timeoutMinutes`，分别为 `10`、`20`、`10`；
- Job 的 `runs-on` 和 `timeout-minutes` 必须从同一 matrix item 读取；
- Harness 步骤名称和顺序继续为 Checkout、Set up Python、Install harness dependencies、Test Harness failure and portability rules、Windows canonical precheck、POSIX canonical precheck；
- Backend 与 Frontend Job 内容不得变化。

## 权限、RLS 和数据处理要求

- Workflow 权限继续只读 `contents: read`；
- 不新增 Secret、Token 权限、Artifact 上传、外部服务或网络回调；
- 测试不读取真实用户、模型凭据或本机开发凭据。

## 状态机和失败行为

- 任何 Harness 测试或 precheck 非零退出仍立即使对应 OS Job 失败；
- Windows 超过 20 分钟仍由 GitHub 强制失败，不自动重试、不忽略或标绿；
- Ubuntu/macOS 继续受 10 分钟上限保护；
- 若 20 分钟仍不足，停止继续加预算，先分析具体步骤耗时和 Runner 状态。

## 模型、Prompt、记忆和安全边界

本任务不调用模型、不处理 Prompt、Persona、Memory、Safety 或真实用户数据，也不改变真实模型、Beta、注册或支付门禁。

## 验收标准

1. Workflow 只改变 Harness matrix/timeout 表达，Backend 与 Frontend Git Diff 为零。
2. 三个 OS 和预算由自动测试精确断言，Windows 为 20，Ubuntu/macOS 为 10。
3. 既有 Harness 步骤名称与顺序被测试锁定，没有删除、跳过或更改入口。
4. Harness 69 项既有测试加新增预算测试全部通过。
5. Doctor、Catalog validate/drift、Python/Windows/WSL precheck 和 `git diff --check` 全部通过。
6. 精确实现 SHA 的 GitHub Actions 中 Backend、Frontend、Ubuntu/Windows/macOS Harness 五个作业全部 `success`。
7. Windows 日志证明 Harness 测试与 canonical Windows precheck 均实际执行完成，而非仅延长后被取消。

## 必跑检查

以 YAML `requiredCommands` 为准。Evidence 必须同时记录 TASK-0008 两次超时作为根因证据、TASK-0009 精确实现 SHA 的五作业终态，以及本任务没有删减检查的自动断言。

## 回滚或前向修复

本任务无业务数据或外部资源。若 matrix 表达不被 GitHub 接受，前向修正为语义等价的显式 include；不得恢复不足预算、删除测试或降低门禁。若 Windows 在 20 分钟内仍超时，停止提高上限并拆分独立性能诊断任务。

## 停止条件

- 日志出现真实 Harness 断言、Doctor、Catalog 或 precheck 失败，而非 GitHub 总作业取消；
- 需要修改统一 Harness 核心、测试语义、Runner 类型、付费能力或权限范围；
- 无法在不影响 Backend/Frontend 和其他 OS 预算的情况下表达 Windows 独立上限。

## Evidence Pack

输出到 `docs/evidence/TASK-0009/`，并生成 `docs/handoffs/TASK-0009.json`。C4 实现必须由未参与修改的独立 Reviewer 绑定精确实现 Commit 与 Git Tree 复验。

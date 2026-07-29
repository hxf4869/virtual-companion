# TASK-0005：修复 Harness 最新终态任务测试夹具漂移

```yaml
taskId: TASK-0005
state: READY
owner: repository-owner
riskClass: C4
requiredSkills:
  - task-intake
  - harness-change
requiredSkillVersions:
  task-intake: 1.1.0
  harness-change: 1.1.0
targetSkillVersions: {}
baseCommit: 678eec63aeaaf947e22e5b70f24ffa5c2eb50047
authorizationCommit: ""
contextFingerprint: 64663287036c293f6ac78f0ac3a9d3911aa81126e791894348c1900774983a5a
contextLock: docs/tasks/context/TASK-0005.context-lock.yaml
contextFingerprintAlgorithm: SHA256_ORDINAL_SORTED_PATH_EQUALS_HASH_LF_V1
readAllowlist:
  - AGENTS.md
  - README.md
  - .github/workflows/ci.yml
  - .harness/**
  - skills/task-intake/SKILL.md
  - skills/harness-change/SKILL.md
  - scripts/harness/**
  - docs/tasks/**
  - docs/handoffs/**
  - docs/schemas/**
  - requirements-harness.txt
writeAllowlist:
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - docs/tasks/TASK-0005-harness-latest-task-fixture.md
  - docs/tasks/context/TASK-0005.context-lock.yaml
  - docs/evidence/TASK-0005/**
  - docs/handoffs/TASK-0005.json
  - scripts/harness/tests/test_harness.py
forbiddenPaths:
  - AGENTS.md
  - CLAUDE.md
  - .github/**
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
  - scripts/harness/precheck.py
  - scripts/harness/precheck.ps1
  - scripts/harness/precheck.sh
  - specs/**
  - service/**
  - frontend/**
  - db/**
  - deploy/**
  - ops/**
  - docs/source/**
sourcesOfTruth:
  - AGENTS.md
  - .harness/project-state.yaml
  - .harness/task-lifecycle.yaml
  - .harness/sources-of-truth.yaml
  - .harness/invariants.yaml
  - .harness/protected-paths.yaml
  - .harness/skills.yaml
  - .harness/commands.yaml
  - skills/task-intake/SKILL.md
  - skills/harness-change/SKILL.md
  - scripts/harness/doctor.py
  - scripts/harness/tests/test_harness.py
  - .github/workflows/ci.yml
  - docs/handoffs/TASK-0004.json
requiredInvariants:
  - INV-HARNESS-002
  - INV-HARNESS-003
  - INV-HARNESS-004
  - INV-HARNESS-005
humanApprovals:
  - scope: fix-harness-latest-terminal-task-test-fixture-and-ci
    approvedBy: repository-owner
    approvedAt: 2026-07-30
    evidence: 用户已明确“允许修复 CI”，并要求继续按需求清单和功能计划自主完成所有无需其决策的任务；本任务仅修复已定位的 Harness 测试夹具漂移
independentReview: required
reviewers: []
requiredCommands:
  - python scripts/harness/doctor.py --task TASK-0005
  - python -m unittest scripts.harness.tests.test_harness.StateTests.test_project_state_must_point_to_latest_terminal_and_accepted_tasks
  - python -m unittest discover -s scripts/harness/tests -p test_*.py
  - python scripts/harness/precheck.py --task TASK-0005
  - powershell -NoProfile -ExecutionPolicy Bypass -File scripts/harness/precheck.ps1 -Task TASK-0005
  - wsl.exe -d Ubuntu-24.04 -- bash scripts/harness/precheck.sh --task TASK-0005
  - git diff --check
```

## 背景与用户可观察目标

GitHub Actions run `30490509224` 的 Backend 与 Frontend 作业通过，但 Ubuntu、Windows、macOS 三个 Harness 作业都在同一测试失败。`test_project_state_must_point_to_latest_terminal_and_accepted_tasks` 从真实仓库发现全部任务，却把预期最新任务硬编码为 `TASK-0002`；TASK-0003 进入终态后，Doctor 正确报告 `TASK-0003`，测试反而失败。TASK-0004 推送后同一夹具还会继续漂移。

本任务让该测试场景完全由自身夹具定义，不再依赖仓库后来新增了多少终态任务；同时保持 Doctor 的生产逻辑、错误文本、跨平台入口和所有失败关闭门禁不变。完成后，本地与 GitHub Actions 三平台 Harness 应恢复通过，后续新增 TASK-0006、TASK-0007 等任务不需要再次更新这条断言。

## 范围内

- 在目标测试内把发现到的所有任务状态先归一为非终态，再显式构造 `TASK-0002` 为唯一 `ACCEPTED`/terminal 的合成场景；
- 保留对 `lastAcceptedTask` 与 `lastTerminalTask` 两条错误消息的精确断言；
- 运行目标测试、全部 Harness 单测、统一 precheck 及 Windows/WSL 包装入口；
- 将修复提交交给无历史上下文、未参与实现的独立 Reviewer 复验；
- 在终态前核对同一实现提交的 GitHub Actions Backend、Frontend 与三平台 Harness 结果。

## 明确范围外

- 修改 `doctor.py` 的最新任务推导、错误文本、阈值或失败行为；
- 修改 CI 工作流、跨平台包装、Harness 配置、Task/Context/Evidence Schema、Skill 或全局 Agent 规则；
- 修改业务、Catalog、Contract、前后端、数据库、部署或产品能力；
- 通过删除断言、跳过测试、捕获失败、降低门禁或把失败记录为 PASS 来恢复 CI；
- 顺带处理前端既有依赖告警或开发工具升级。

## 输入和前置条件

- Base Commit 是 TASK-0004 终态 `678eec63aeaaf947e22e5b70f24ffa5c2eb50047`；
- GitHub Actions 失败日志在三个操作系统上均指向同一文件、同一行和同一硬编码预期；
- Doctor 的真实输出正确地随当前最新终态任务变化，修复对象仅是测试夹具；
- 用户对 CI 修复已有明确授权，不需要扩大 GitHub 权限或等待新的产品决策；
- DRAFT 检查点只包含本任务卡与 Context Lock，READY 授权必须形成原子授权链。

## API / 事件 / 数据契约

无产品 API、事件或数据契约变更。测试仍直接调用 `validate_project_state`，只改变传入的合成任务状态集合，不改变生产实现。

## 权限、RLS 和数据处理要求

不接触用户、身份、数据库、RLS、凭据或外部业务数据。GitHub CLI 只读检查 Actions 状态和日志；仓库写入限于任务白名单。

## 状态机和失败行为

- 测试夹具必须先把所有发现任务设为非终态，再显式设置唯一接受任务，避免真实 Ledger 增长改变预期；
- 被测 project-state 继续故意指向非接受、非终态的 `TASK-0001`；
- Doctor 必须继续同时报告最新 accepted 与 terminal 指针错误；
- 若目标测试之外出现任何失败，不得扩大本任务范围掩盖，应前向定位并保持真实失败；
- 远端任一平台仍失败时不得宣称 CI 已恢复。

## 模型、Prompt、记忆和安全边界

不调用模型、不新增 Prompt、不修改记忆或安全策略。Harness 测试不得依赖特定 Agent、IDE、操作系统路径或付费服务。

## 验收标准

1. 目标测试在当前含 TASK-0003、TASK-0004 的真实仓库中通过，且预期仍由合成场景唯一确定为 `TASK-0002`。
2. 夹具对全部已发现任务统一归一化，因此未来新增更高编号终态任务不会改变该测试预期。
3. 两条断言仍分别验证 latest accepted 与 latest terminal，不删除、不模糊匹配。
4. `doctor.py`、错误文本、任务排序算法、项目状态与 CI 工作流没有修改。
5. 全部 Harness 单元测试、Doctor、Python/PowerShell/WSL precheck 与 `git diff --check` 通过。
6. 独立 Reviewer 绑定精确实现提交并给出 PASS。
7. GitHub Actions 同一实现提交的 Backend、Frontend、Ubuntu Harness、Windows Harness、macOS Harness 全部成功。
8. Diff 只包含测试夹具及 TASK-0005 生命周期、Context、Evidence、Review 与 Handoff 文件。

## 必跑检查

以 YAML `requiredCommands` 为准；每条命令记录状态、退出码、验证提交和无产物理由。远端 Actions 结果作为附加 Evidence 绑定实现提交与 run URL。

## 回滚或前向修复

本任务不触碰业务数据。若修复不稳定，只在目标测试夹具内前向修复；不得改生产 Doctor、放宽检查或修改真实 Project State 来迎合测试。

## 停止条件

- 根因不再是该单一硬编码夹具，必须修改 `doctor.py`、CI 工作流或其他 Harness 真源；
- 需要删除/跳过失败检查、降低保护级别或伪造跨平台结果；
- 需要修改业务、Catalog、Contract、生成物、数据库、部署或凭据；
- 无法获得独立 Reviewer 对精确实现提交的 PASS。

## Evidence Pack

输出到 `docs/evidence/TASK-0005/`，并生成 `docs/handoffs/TASK-0005.json`。终态提交原子更新任务卡、Project State、Task Ledger、Evidence Pack 与 Handoff。

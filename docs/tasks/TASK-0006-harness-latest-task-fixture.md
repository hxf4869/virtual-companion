# TASK-0006：修复 Harness 最新终态任务测试夹具漂移

```yaml
taskId: TASK-0006
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
baseCommit: 512abfbb7f87a49431026ade888abcecc1fe1ba5
authorizationCommit: ac8711c89dd9eea29ed0f1c843216c6eae97d22d
contextFingerprint: 2462d857768408b9002c5b4797b8668f8e24bc43f9d60ccd98c2d67b380e07e0
contextLock: docs/tasks/context/TASK-0006.context-lock.yaml
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
  - docs/tasks/TASK-0006-harness-latest-task-fixture.md
  - docs/tasks/context/TASK-0006.context-lock.yaml
  - docs/evidence/TASK-0006/**
  - docs/handoffs/TASK-0006.json
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
  - docs/handoffs/TASK-0005.json
requiredInvariants:
  - INV-HARNESS-002
  - INV-HARNESS-003
  - INV-HARNESS-004
  - INV-HARNESS-005
humanApprovals:
  - scope: harness-change
    approvedBy: repository-owner
    approvedAt: 2026-07-30
    evidence: 用户已明确“允许修复 CI”，并要求继续按需求清单和功能计划自主完成所有无需其决策的任务；本任务仅修复已定位的 Harness 测试夹具漂移
independentReview: required
reviewers: []
requiredCommands:
  - python scripts/harness/doctor.py --task TASK-0006
  - python -m unittest scripts.harness.tests.test_harness.StateTests.test_project_state_must_point_to_latest_terminal_and_accepted_tasks
  - python -m unittest discover -s scripts/harness/tests -p test_*.py
  - python scripts/harness/precheck.py --task TASK-0006
  - powershell -NoProfile -ExecutionPolicy Bypass -File scripts/harness/precheck.ps1 -Task TASK-0006
  - wsl.exe -d Ubuntu-24.04 -- bash scripts/harness/precheck.sh --task TASK-0006
  - git diff --check
```

## 背景与用户可观察目标

GitHub Actions run `30494134448` 再次确认：Backend 与 Frontend 通过，Ubuntu、Windows、macOS Harness 都只因 `test_project_state_must_point_to_latest_terminal_and_accepted_tasks` 把最新任务硬编码为 `TASK-0002` 而失败。生产 Doctor 正确报告当前最新接受/终态任务，漂移位于测试夹具。

TASK-0005 因 READY 审批 `scope` 没有精确写成受保护路径要求的 `harness-change` 而被真实拒绝，未包含实现。TASK-0006 继承同一最小修复目标，并以精确审批范围重新形成完整 C4 授权。完成后，测试预期只由合成夹具决定，后续新增任务不再要求改断言，三平台 CI 恢复绿色。

## 范围内

- 将目标测试中发现到的所有任务状态先归一为 `DRAFT`，再显式设置 `TASK-0002` 为唯一 `ACCEPTED`/terminal；
- 保留 latest accepted 与 latest terminal 两条精确错误消息断言；
- 运行目标测试、全部 Harness 单测、统一 precheck 及 Windows/WSL 包装入口；
- 由未参与实现、无历史上下文的独立 Reviewer 绑定精确实现提交复验；
- 终态前验证同一实现提交的 GitHub Actions 五个作业全部成功。

## 明确范围外

- 修改 `doctor.py` 的推导、错误文本、阈值或失败行为；
- 修改 CI 工作流、跨平台包装、Harness 配置、Schema、Skill 或 Agent 规则；
- 修改业务、Catalog、Contract、前后端、数据库、部署或产品门禁；
- 删除/跳过断言、吞掉退出码、降低保护或伪造 PASS；
- 顺带处理依赖告警或工具升级。

## 输入和前置条件

- Base Commit 为 TASK-0005 REJECTED 终态 `512abfbb7f87a49431026ade888abcecc1fe1ba5`；
- 三个平台的失败文件、测试和根因一致，Doctor 生产逻辑无缺陷；
- 用户已批准 CI 修复；本任务的不可变审批范围精确为 `harness-change`；
- DRAFT 只包含任务卡与 Context Lock，READY 授权形成原子提交及锚点。

## API / 事件 / 数据契约

无产品 API、事件或数据契约变更。只调整单元测试传给 `validate_project_state` 的合成任务状态。

## 权限、RLS 和数据处理要求

不接触身份、用户、数据库、RLS、凭据或业务数据。GitHub CLI 只读取 Actions 状态与日志；写入严格限制在任务白名单。

## 状态机和失败行为

- 夹具对全部已发现任务先设置为非终态，再定义唯一接受任务；
- 被测 project-state 继续故意指向 `TASK-0001`，Doctor 必须报告 accepted 与 terminal 两类指针错误；
- 任何其他测试失败都保留为真实失败，不扩大范围掩盖；
- 远端任一平台失败时不得宣称 CI 已恢复。

## 模型、Prompt、记忆和安全边界

不调用模型、不新增 Prompt、不修改记忆或安全策略；不得依赖特定 Agent、IDE、付费服务或操作系统绝对路径。

## 验收标准

1. 目标测试在当前仓库通过，预期由合成场景唯一确定为 `TASK-0002`。
2. 归一逻辑覆盖全部发现任务，未来更高编号终态任务不会污染场景。
3. 两条精确断言都保留；生产 Doctor、错误文本和排序算法不变。
4. 全部 Harness 单测、Doctor、三套 precheck 与 `git diff --check` 通过。
5. Diff 只含目标测试与 TASK-0006 生命周期、Context、Evidence、Review、Handoff。
6. 独立 Reviewer 对精确实现提交给出 PASS。
7. GitHub Actions 同一实现提交的 Backend、Frontend、Ubuntu/Windows/macOS Harness 全部成功。

## 必跑检查

以 YAML `requiredCommands` 为准。远端 Actions 结果作为附加 Evidence，记录 run ID、URL、head SHA 与五项结论。

## 回滚或前向修复

若夹具仍漂移，只在目标测试内前向修复；禁止修改生产 Doctor、真实 Project State 或保护规则迎合测试。

## 停止条件

- 根因需要修改 Doctor、CI 或其他 Harness 真源；
- 需要删除/跳过失败、降低保护或伪造跨平台结果；
- 需要修改业务、Catalog、Contract、生成物、数据库、部署或凭据；
- 独立 Reviewer 无法对精确实现提交给出 PASS。

## Evidence Pack

输出到 `docs/evidence/TASK-0006/`，并生成 `docs/handoffs/TASK-0006.json`。终态提交原子更新任务卡、Project State、Task Ledger、Evidence Pack 与 Handoff。

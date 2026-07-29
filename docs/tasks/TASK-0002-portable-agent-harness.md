# TASK-0002：跨平台、跨 Agent 的可恢复开发 Harness

```yaml
taskId: TASK-0002
state: IN_REVIEW
owner: repository-owner
riskClass: C4
requiredSkills:
  - task-intake
  - harness-change
requiredSkillVersions:
  task-intake: 1.0.0
  harness-change: 1.0.0
targetSkillVersions:
  task-intake: 1.1.0
  harness-change: 1.1.0
  catalog-change: 1.0.0
  contract-change: 1.0.0
baseCommit: 0ae19df7dec791c0968c731cefbe5328d0f0f93f
authorizationCommit: 4f957ec296ac2a2265352d5b3e10fbb9f0bfbd37
contextFingerprint: 2e6eb93c903b74ec4cb0188cc9ceddf8b292f0f1da72422eae6125617945e20f
contextLock: docs/tasks/context/TASK-0002.context-lock.yaml
contextFingerprintAlgorithm: SHA256_ORDINAL_SORTED_PATH_EQUALS_HASH_LF_V1
readAllowlist:
  - AGENTS.md
  - README.md
  - .github/**
  - .harness/**
  - skills/**
  - scripts/harness/**
  - docs/architecture/**
  - docs/decisions/**
  - docs/engineering/**
  - docs/tasks/**
  - docs/evidence/TASK-0001/**
  - docs/handoffs/**
  - docs/schemas/**
  - specs/catalog/**
  - specs/contracts/**
  - specs/generated/**
  - requirements-harness.txt
writeAllowlist:
  - AGENTS.md
  - CLAUDE.md
  - README.md
  - .gitignore
  - requirements-harness.txt
  - .github/copilot-instructions.md
  - .github/workflows/ci.yml
  - ci/**
  - .harness/**
  - skills/task-intake/SKILL.md
  - skills/harness-change/SKILL.md
  - skills/catalog-change/**
  - skills/contract-change/**
  - scripts/harness/**
  - docs/decisions/0003-portable-agent-harness.md
  - docs/engineering/agent-onboarding.md
  - docs/tasks/task-card-template.md
  - docs/tasks/TASK-0001-project-bootstrap.md
  - docs/tasks/TASK-0002-portable-agent-harness.md
  - docs/tasks/context/TASK-0001.context-lock.yaml
  - docs/tasks/context/TASK-0002.context-lock.yaml
  - docs/evidence/TASK-0002/**
  - docs/handoffs/TASK-0001.json
  - docs/handoffs/TASK-0002.json
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
forbiddenPaths:
  - specs/catalog/**
  - specs/contracts/**
  - specs/generated/**
  - service/**
  - frontend/**
  - db/**
  - deploy/**
  - ops/**
  - docs/source/**
sourcesOfTruth:
  - AGENTS.md
  - .harness/phase-scope.yaml
  - .harness/sources-of-truth.yaml
  - .harness/invariants.yaml
  - .harness/protected-paths.yaml
  - .harness/skills.yaml
  - .harness/commands.yaml
requiredInvariants:
  - INV-COST-001
humanApprovals:
  - scope: harness-change
    approvedBy: repository-owner
    approvedAt: 2026-07-30
    evidence: 本次用户消息明确要求在开发前补充 Harness，并授权由 Agent 决定实现方式
independentReview: required
reviewers:
  - id: architecture-review
    kind: architecture
    verdict: PASS
    reviewedCommit: 9103214172720bc08b3b45774ad7b802d6af556d
    evidencePath: docs/evidence/TASK-0002/review-architecture.md
  - id: portability-review
    kind: portability
    verdict: PASS
    reviewedCommit: 9103214172720bc08b3b45774ad7b802d6af556d
    evidencePath: docs/evidence/TASK-0002/review-portability.md
  - id: codex-security-reviewer
    kind: security
    verdict: PASS
    reviewedCommit: 9103214172720bc08b3b45774ad7b802d6af556d
    evidencePath: docs/evidence/TASK-0002/review-safety.md
requiredCommands:
  - python scripts/harness/doctor.py --task TASK-0002
  - python -m unittest discover -s scripts/harness/tests -p test_*.py
  - python scripts/harness/precheck.py --task TASK-0002
  - powershell -NoProfile -ExecutionPolicy Bypass -File scripts/harness/precheck.ps1 -Task TASK-0002
  - wsl.exe -d Ubuntu-24.04 -- bash scripts/harness/precheck.sh --task TASK-0002
  - git diff --check
```

## 背景与用户可观察目标

项目后续可能由 Windows、macOS 或 Linux 上的 Codex、Claude Code、Zed、GitHub Copilot 或其他 Agent 客户端接手。无论 Agent 是否拥有历史聊天、是否自动发现仓库 Skill，都必须能从仓库本身回答：

1. 当前项目处于什么阶段，已经完成了什么；
2. 当前唯一允许推进的任务是什么，下一步做什么；
3. 哪些文件可改、哪些不可改、需要哪个 Skill 和审批；
4. 为什么采用当前设计，哪些事实是机器真源；
5. 如何在本机和 CI 中复验，并如何把结果交给下一个 Agent。

## 范围内

- 以 `AGENTS.md` 为唯一 Agent 行为真源，增加必要的客户端薄适配入口；
- 建立机器可读的项目状态、任务生命周期和客户端入口清单；
- 建立跨平台 Python Harness 入口及 PowerShell/POSIX 薄包装；
- 自动校验任务发现、Context Lock、Skill 注册、受保护路径、Diff Scope、Schema 和证据一致性；
- 修复 Catalog 在 Windows 的 LF/CRLF 漂移误报；
- 排除依赖缓存和构建目录，避免付费能力扫描无界遍历；
- 补齐缺失的 Catalog/Contract 变更 Skill；
- 统一 `TASK-0001` 的终态并修复过时入口；
  - 更新 CI、任务模板、Evidence/Handoff Schema、onboarding 文档和 ADR；
  - 移除会与活动工作流漂移的旧 CI 模板，只保留统一入口说明；
- 增加 Harness 单元测试，并由独立 Agent 进行无历史上下文复核。

## 明确范围外

- 任何聊天、用户、数据库、模型、记忆、安全或其他业务实现；
- 修改 Catalog、Contract 或生成物内容；
- 消除所有历史文档重复或重构产品技术架构；
- 引入依赖特定 SaaS、IDE、商业插件或单一 Agent 厂商的运行时；
- 自动授予审批、自动绕过 READY 任务或替代人工产品决策。

## 输入和前置条件

- Base Commit 是 `TASK-0001` 完成记录后的干净 `main`；
- 用户已明确批准本次 C4 Harness 变更；
- Context Lock 只使用仓库相对路径，并以 Base Commit 中的内容复验；
- Python 3.11+ 与 PyYAML 是 Harness 的最低可执行环境。

## 状态机和失败行为

- 同一时刻最多一个活动任务；活动态为 `READY`、`IN_PROGRESS`、`BLOCKED`、`IN_REVIEW`；
- 终态统一为 `ACCEPTED` 或 `REJECTED`；
- 缺任务、多个活动任务、Context 漂移、Skill 缺失、越界 Diff 或审批缺失时，Doctor 必须失败并给出可操作原因；
- 无法识别的 Agent 客户端必须直接读取 `AGENTS.md`，不得猜测仓库规则；
- Harness 自身失败时不得放宽门禁，只允许前向修复。

## 验收标准

1. 新 Agent 仅凭仓库即可定位项目状态、当前任务、最后交付、下一动作、理由和禁止项。
2. Codex/Zed 直接使用 `AGENTS.md`；Claude Code 与 GitHub Copilot 使用不复制规则正文的薄适配入口。
3. Windows PowerShell、WSL/Linux 和 macOS 兼容入口调用同一 Python 实现。
4. Doctor 能校验活动任务唯一性、Context Fingerprint、Skill/保护规则、Schema、状态和 Diff Scope。
5. Windows Catalog drift 不再因换行产生误报，已安装 `node_modules` 时付费能力检查仍在合理时间内完成。
6. CI 调用统一 Harness precheck 和单元测试，而不是维护另一套命令。
7. TASK-0001、任务模板、Evidence/Handoff Schema 与统一生命周期一致。
8. 关键失败场景有自动测试；独立 Reviewer 从最小上下文复跑并记录结论。

## 回滚或前向修复

本任务不触碰业务数据。发生问题时优先在 Harness 任务内前向修复；若必须回退，只回退 TASK-0002 白名单中的治理文件，并保留 Evidence 中的失败事实。

## 停止条件

- 需要修改任何业务、Catalog、Contract、生成物、数据库、部署或 Beta 值班数据；
- 需要把规则复制成多套客户端专用真源；
- 需要安装付费插件、提交凭据或扩大 GitHub 权限；
- 无法通过自动检查证明 Harness 没有为自身放宽约束。

## Evidence Pack

输出到 `docs/evidence/TASK-0002/`，并生成 `docs/handoffs/TASK-0002.json`。

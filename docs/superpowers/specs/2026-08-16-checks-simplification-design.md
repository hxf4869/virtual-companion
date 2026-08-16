# 检查体系精简设计（2026-08-16）

## 背景与诊断

单任务交付耗时 20 分钟以上，根因经实测确认：

- `scripts/harness/doctor.py` 单文件 22,320 行、约 1200 项检查，其中约 80% 是
  git 全量历史重放（1357 个提交 × 逐任务卡 `ls-tree`/`cat-file`/YAML 解析）。
  实测 `--summary` 运行 185 秒仍停留在第 2/9 阶段，全量预计 15-25 分钟。
- 一次交付最多跑 3 次 doctor（precheck、pre-closure、summary），会话恢复每次还要求再跑一次。
- 治理代码约 21.5 万行（任务卡 10.3 万 + evidence 4.3 万 + harness 脚本 3.7 万 + 策略 yaml），
  约为产品代码（约 7 万行）的 3 倍；同一套策略在 delivery-policy、ci-execution-policy、
  SKILL.md 三处重复，另含 10 个"仅此一次"任务的永久固化条款。
- 产品自足：前端 vitest 292 用例（实测 1.2s）+ vue-tsc；后端 JUnit 852 用例（`./mvnw verify`）；
  84 个 SQL/RLS 测试（`infra/db/run-rls-tests.sh`）。删除治理不伤产品。

## 决策（Owner 2026-08-16 选定）

**拆机制、留历史**：删除全部检查机制与强制流程；历史产物原地保留为只读档案；
日常检查收编为一条 60 秒内的 `scripts/check.sh`。本变更由 Owner 直接指示与计划审批授权，
取代旧治理规则对 protected-paths 的审批要求。

## 变更清单

删除（机制）：

- `scripts/harness/`（doctor.py、precheck.py 及包装器、durable_command.ps1、
  check_beta_gate.py、tests/test_harness.py 等）
- `.harness/` 机制 yaml（lifecycle、delivery-policy、ci-execution-policy、invariants、
  protected-paths、sources-of-truth、skills、commands、agent-entrypoints、tools.lock、
  phase-scope 等）
- `skills/` 全部 SKILL.md、`requirements-harness.txt`、`MANIFEST.sha256`
- CI 中 harness-full / harness-smoke 两个 job

保留并迁移：

- `docs/tasks/`、`docs/evidence/`、`docs/handoffs/`、`docs/schemas/`、`docs/decisions/`
  原样只读保留；`task-ledger.yaml`、`task-backlog.yaml`、`project-state.yaml`
  移至 `docs/archive/`
- 秒级产品检查收编至 `scripts/checks/`：catalog_tool（validate + drift）、
  check_paid_features（数据文件 paid-feature-denylist.yaml 随迁）、
  check_licenses（license-policy.yaml、license-inventory.yaml 随迁）
- `scripts/dev/openapi_tool.py`（validate + drift）原位保留，无治理依赖

新增：

- `scripts/check.sh`：唯一日常检查入口；python3 缺 PyYAML 时自动回退
  `uv run --with PyYAML`；默认全量（快速检查 + 前端 test:run + type-check），
  `--quick` 仅快速检查；失败非零退出
- `TODO.md`：backlog 剩余 PLANNED 项（11 条）一行一条
- 新 `AGENTS.md`（≤30 行）与重写后的 `.github/workflows/ci.yml`
  （backend / database / frontend / supply-chain / checks 五个产品 job）

## 明确不做

- 不保留任务卡生命周期、授权、Evidence、Handoff 流程；后续任务用 TODO.md 或 GitHub issue
- 不重写"极速版 doctor"；不动产品代码、specs 契约与既有产品测试

## 验证与回滚

- `time bash scripts/check.sh` 全绿且 <60s；前端 vitest/type-check 通过；
  后端本机无 JDK 25 时如实报告 SKIP，由 CI backend job 兜底
- 全程在 git 内完成， demolition 为单个原子提交，可整体 revert；历史产物零删除

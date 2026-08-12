# TASK-0172 R1 独立复核

- **Verdict: PASS**
- **Reviewer Role**：独立 R1 Reviewer（fork_turns=none，无任务历史上下文，全程只读，未修改仓库任何文件）
- **复核模式**：Owner 2026-08-12 acceleration static-gates-only——仅语义审查（读候选 diff + 静态判断 + 引用实现者已跑的定向 harness 测试与 canonical precheck 结果），不 fresh TMPDIR 重跑；完整 unittest + 根级 Maven verify deferred to 统一全项目复审
- **复核时间**：2026-08-12
- **候选**：`030f5ad78f9bdc60972fe59caf3f406ea631ab83`（tree `7c1d714815931aa1238b30dd9844ebfb68275ab3`），单父链，工作树 clean
- **Base**：`0b5562292e164c823e254e3949b4d514cc9e8f95`（TASK-0171 ACCEPTED terminal）

## 候选身份核对

| 项 | 声明 | 实测 | 结果 |
|---|---|---|---|
| 候选 Commit | `030f5ad…` | `git rev-parse HEAD` = 030f5ad… | PASS |
| 候选 Tree | `7c1d7148…` | `git rev-parse 030f5ad^{tree}` = 7c1d7148… | PASS |
| Base | `0b556229…` | 0b556229 是 030f5ad 祖先 | PASS |
| 提交链 | 0c51a0d DRAFT → 62b86a2 READY → 7a59a6e 绑定 → 297f191 IN_PROGRESS → 030f5ad 实现 | 每提交单父，线性无 merge | PASS |
| authorizationCommit | `62b86a2d…` | 卡 YAML 与 READY 提交一致 | PASS |
| 工作树 | clean | `git status --porcelain` 空 | PASS |
| 未推送 | 5 commits（0c51a0d..030f5ad） | `git rev-list --left-right --count HEAD...origin/main` = 5/0 | PASS（终态 push 前状态） |

## 静态门禁（引用实现者已跑结果）

| # | 命令 | 退出码 | 结果 | 关键输出 |
|---|------|--------|------|----------|
| 1 | `git diff --check 0b55622..030f5ad` | 0 | **PASS** | 输出空 |
| 2 | `python scripts/harness/precheck.py --task TASK-0172`（canonical，8 子命令） | 0 | **PASS 8/8** | doctor PASS（827795 checks，112.3s，基线 822736 + 新增 ~5059；含 context-lock fingerprint 700b02c3 校验、writeAllowlist/forbiddenPaths 零冲突、authorization projection、selected task diff scope） |
| 3 | `python -m unittest scripts.harness.tests.test_harness.StateTests` | 0 | **10/0 PASS** | 含 3 个新测试（advisory 通过/已注册引用通过/TASK-9999 拒绝） |
| 4 | `python -m unittest scripts.harness.tests.test_harness.BacklogTests scripts.harness.tests.test_harness.EnforcementTests` | 0 | **96/0 PASS** | 无回归（这两个类含全部其他 validate_project_state 调用点） |

## 矩阵核对

**A. writeAllowlist / forbiddenPaths / diff scope（PASS）**：候选 diff（base..HEAD）5 文件全部在 writeAllowlist 内：
`.harness/project-state.yaml`（M，activeTask/nextAction 状态字段）、`docs/tasks/TASK-0172-*.md`（A）、
`docs/tasks/context/TASK-0172.context-lock.yaml`（A）、`scripts/harness/doctor.py`（M，**protected path scripts/harness/** 命中**）、
`scripts/harness/tests/test_harness.py`（M，同 protected path）。
forbiddenPaths 零触碰：harness_common.py/precheck.py/precheck.sh/precheck.ps1/catalog_tool.py/check_*.py/
durable_command.ps1 逐文件列禁；skills/**、.harness/** 治理文件、docs/tasks 历史卡（TASK-00*..0171）、
TASK-0171 卡/evidence/handoff、specs/service/infra/frontend/pom 全部未动。
doctor selected-task diff scope PASS 实证。protected path 满足 requiredSkill=harness-change（版本 1.1.7 注册于
.harness/skills.yaml）+ humanApproval scope:harness-change + independentReview:required。

**B. context fingerprint（PASS）**：contextFingerprint `700b02c383c680d39056f1724808c74e48f6546beed00e6f4ddd67aa8e972f8a`，
36 inputs（35 readAllowlist + 1 provenanceOnly `owner-authorization://longline-2026-08-09` 用固定 hash
`cc0f91c1…`）。算法 SHA256_ORDINAL_SORTED_PATH_EQUALS_HASH_LF_V1；实现者脚本先自验复现 TASK-0171 的
`cfff5e4e…`（MATCH=True，以其自身 baseCommit c789e245 复算），再生成 TASK-0172 且重读复验；
canonical doctor 子命令校验通过。

**C. 技术复核（PASS）**：

- `scripts/harness/doctor.py` 新增 `validate_nextaction_registered_references(audit, state, tasks)`：
  `re.findall(r"TASK-[0-9]{4,}", next_action)` 提取引用集合（与 gate approval 边既有 L11321 同模式），
  `unregistered = [id for id in referenced if id not in tasks]`，`audit.require(not unregistered, ...)`。
  语义正确且最小：**advisory 文本（无 TASK 引用）直接通过**（P2-22 Owner 策略「显式 task-intake 动作」的
  机器落点）；**引用未注册 ID → ERROR 失败关闭**（消息含 "references unregistered task IDs" + 具体 ID）。
  `tasks` = `discover_tasks()`（harness_common.py:189，从 docs/tasks/*.md 任务卡发现全部 ID）——天然覆盖
  ledger 执行链（TASK-0001..0171）、backlog PLANNED 投影卡、idle DRAFT 例外卡（含 TASK-0172 自身，保证
  READY 授权提交 nextAction 引用自己时通过）；卡不可删除（历史不可变）→ 注册集合单调，无假阴性风险。
- 挂载点正确：`validate_project_state` 内既有 `validate_nonblank_text("project-state: nextAction", ...)`
  （L8495）之后一行调用——只作用于当前 HEAD project-state 校验路径（doctor.py 主流程 L18658 唯一调用点），
  不触碰历史 blob 内容校验、不改变 READY/终态 handoff 逐字一致校验（L3681/5466/5478）、不改变 idle
  checkpoint 边「idle 只允许改 nextAction」语义（L11312-11382）、不改变 gate approval 边 next promotable
  检查（L11320-11325，独立语义互补）。
- `scripts/harness/tests/test_harness.py`：import 列表按字母序插入 `validate_nextaction_registered_references`
  （validate_nonblank_text 与 validate_portable_path_collisions 之间，符合既有排序）；StateTests 新增 3 测试：
  (1) advisory 无 TASK 引用 → errors 空；(2) 已注册引用（TASK-0171）→ errors 空；(3) 未注册引用（TASK-9999）
  → errors 含 "references unregistered task IDs" + "TASK-9999"。plain 单元风格（Audit + dict state +
  discover_tasks()），与 StateTests 既有 validate_project_state 测试一致。10/10 PASS 实证。
- 既有测试兼容性：全仓调用 validate_project_state 的测试类 = BacklogTests（L7362 用真实 project-state，
  nextAction 引用 TASK-0171 已注册 ✓）、StateTests（含新 3 测试 ✓）、EnforcementTests（test_execution_
  rejected... 的 nextAction="将 TASK-0038 晋级为唯一 DRAFT"，TASK-0038 卡存在 ✓）——定向跑 106/0 PASS 实证。
  idle/gate fixture（TASK-1001/9999 nextAction）走 derive_idle_planning_checkpoint/approve_gate 路径，
  不经 validate_project_state，不受影响（96/0 实证）。
- 当前 HEAD project-state.nextAction 引用 TASK-0171/TASK-0168（已注册）+ §5.1.2/P2-22 advisory 片段
  （无 TASK 前缀，不误报）→ canonical doctor 827795 checks PASS 实证（基线 822736 + 新校验与新增卡
  ~5059 checks，增量合理）。

**D. 邻接风险（PASS）**：
- gate approval 边既有逻辑（mentioned/allowed_next）与新增通用校验并存：gate 边是历史边专用强约束，
  新增校验是当前 project-state 通用约束，二者不重叠不冲突（96/0 测试实证）。
- 未来撰写 nextAction 的注意点：正文若需提及历史未注册 ID（如解释性文本「TASK-0091/92/93 曾…」）会触发
  ERROR——这正是 P2-22 治理目标（advisory 文本应使用「先通过 task-intake 创建 DRAFT」类措辞）；属预期
  语义而非缺陷（P3 informational 记录）。
- 无新依赖（re 已 import）；无 CLI flag/环境变量/通用 override；不弱化任何既有失败关闭；
  不触 harness_common.py（discover_tasks 只读复用）、precheck、skills、AGENTS.md。
- 本卡不新增 @Scheduled/轮询/DB/前端/OpenAPI 改动；canonical catalogValidate/catalogDrift/
  openapiValidate/openapiDrift/licenseCheck/paidFeatureCheck/betaRosterGate 全 PASS 实证。

**E. 验收标准逐项**：

| # | 标准 | 结果 |
|---|------|------|
| 1 | doctor.py 新增 validate_nextaction_registered_references（未注册引用 ERROR + advisory 放行） | PASS |
| 2 | validate_project_state 内 L8495 后挂载（tasks = discover_tasks() 全量） | PASS |
| 3 | test_harness.py import + 3 测试（advisory/已注册/TASK-9999 拒绝） | PASS |
| 4 | 定向 StateTests 10/10 + BacklogTests/EnforcementTests 96/0 无回归（完整 discover deferred） | PASS |
| 5 | canonical precheck 8/8 PASS（doctor 827795）+ git diff --check exit 0 | PASS |
| 6 | R1 独立复核 PASS（0 P0/P1/P2） | PASS（本报告） |
| 7 | 终态 pre-closure / 单父 [skip ci] / push / HEAD==origin/main / 0/0 / clean / remote exact-SHA | NOT_RUN（终态范围，R1 后执行） |

**F. 不变量**：INV-HARNESS-001（AGENTS.md 未触）✓；INV-HARNESS-002（单活动任务 TASK-0172 + 冻结
context + 单父原子提交链）✓；INV-HARNESS-003（scripts/harness/** 满足 harness-change skill +
humanApproval scope:harness-change + independentReview:required）✓；INV-HARNESS-005（evidence 诚实，
未运行项 NOT_RUN）✓；INV-HARNESS-006（backlog/永久 ID 未动）✓；INV-HARNESS-007（single-card +
bounded review + exact candidate）✓；INV-HARNESS-009（LOCAL_EXACT_TREE_FALLBACK frozen at READY，
dispatchCount=0，远端如实非 PASS）✓。

## Findings

- **P0**：无。
- **P1**：无。
- **P2**：无。
- **P3（信息性，非阻塞）**：
  1. 新校验只作用于 validate_project_state 路径（当前 HEAD project-state）；gate approval 边 nextAction
     校验（next promotable）独立并存——两套逻辑语义互补，均不变。
  2. nextAction 若以解释性文本提及历史未注册 ID（如「TASK-0091/92/93 曾是问题」）会触发 ERROR——这是
     P2-22 治理目标（advisory 文本应使用「先通过 task-intake 创建 DRAFT」类措辞），非缺陷；卡已声明。
  3. 注册集合 = discover_tasks() 卡集合：卡历史不可变 → 集合单调，已注册 ID 永不退化为未注册；
     未来若引入卡删除流程需同步复核本校验（当前无此流程）。
  4. canonical doctor checks 827795 = 基线 822736 + ~5059（新校验 + 新增卡/context lock 扫描增量），
     增量幅度与 TASK-0171（822736 含其自身增量）相比属同量级，无异常。

## Verdict

**R1 PASS**。TASK-0172 候选 `030f5ad`/tree `7c1d7148` 为 P2-22 nextAction 治理最小实现：doctor.py 新增
`validate_nextaction_registered_references`（nextAction 引用未注册 TASK ID → ERROR 失败关闭、advisory
文本放行）并挂载于 `validate_project_state` 内非空校验之后（tasks = discover_tasks() 全量卡，覆盖
ledger/backlog PLANNED/idle DRAFT 例外）；test_harness.py import + StateTests 3 测试（advisory 通过/
已注册引用通过/TASK-9999 拒绝）。完全在 writeAllowlist 内、零 forbiddenPaths 触碰、
context fingerprint 700b02c3 独立自验一致、唯一 canonical precheck 8/8 PASS（doctor 827795）、
定向 harness 测试 106/0（StateTests 10/10 含新 3 + BacklogTests/EnforcementTests 96/0）、
git diff --check exit 0、protected path scripts/harness/** 满足 harness-change skill +
humanApproval + independentReview:required。验收 1-6 PASS，7 属终态范围（NOT_RUN）。
完整 unittest + 根级 Maven verify deferred per Owner static-gates-only 策略。可进入终态闭环。

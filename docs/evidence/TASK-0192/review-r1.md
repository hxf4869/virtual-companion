# C4 独立治理复核 — TASK-0192 review-r1

- Reviewer：independent-review-gate（C4 独立治理 Reviewer，与实现者独立）
- 复核日期：2026-08-14
- 被审提交（候选 HEAD）：`d24d77e27512cf666127cd8ad9a283fade93eec8`
- 被审范围：TASK-0192（Harness 恢复：amendment-diff-scope 缺口修复 + TASK-0191 seed
  遗漏一次性机器绑定恢复）
- 提交链：`2abc531`（TASK-0191 REJECTED 终态，base）→ `cab8311` DRAFT →
  `b9aa1c7` DRAFT 修正 → `a89afdf` pre-READY maintenance boundary（实现）→
  `3143428` READY → `0553e05` bind → `d24d77e` IN_PROGRESS

## 独立性声明

本 Reviewer 与实现者相互独立：未复用实现者输出作为证据，全部事实均在本会话中
从 git 对象（`rev-parse`/`cat-file`/`ls-tree`/`diff`/`rev-list`）、源码
（`scripts/harness/doctor.py`、`scripts/harness/tests/test_harness.py`）与机器真源
（`.harness/*.yaml`、任务卡、owner-auth json）独立重新推导；全部验证命令在本会话
独立重跑。除本文件外未修改任何文件。

## 逐项结果

### 1. 边界合规 — PASS

- `git rev-parse a89afdf^` = `b9aa1c7f4fe9d4b6fec6d4494a6fc56f95b87c3d`（修正后
  DRAFT，非 cab8311），边界为直接单父提交。
- `git diff --name-only b9aa1c7 a89afdf` 恰为 3 个冻结路径：
  `scripts/harness/doctor.py`、`scripts/harness/tests/test_harness.py`、
  `docs/evidence/TASK-0192/pre-ready-maintenance-authorization.json`；无增删。
- owner-auth json（`docs/evidence/TASK-0192/pre-ready-maintenance-authorization.json`）：
  recordId `OWNER-MAINT-20260813-TASK-0192-PRE-READY-01`、kind
  `OWNER_AUTHORIZED_EXACT_ONE_TIME_PRE_READY_MAINTENANCE`、`oneTimeOnly: true`、
  `reusable: false`、`consumedRecordMustBecomeInert: true`、
  `directSingleParentFromDraftRequired: true`、`approvedAt: 2026-08-14`、exactPaths
  恰 3 路径 —— 与卡 `preReadyMaintenancePlan`（recordId/recordPath/kind/
  oneTimeOnly/reusable/consumedRecordMustBecomeInert/exactPaths 逐字段一致）及 Owner
  2026-08-14 条件批准一致；`draftCorrectionCommit=b9aa1c7`、
  `draftAnchorBaseCommit=2abc531` 与 git 事实一致。
- 卡内绑定值与 json 及 git 事实全部一致（独立复核）：
  - amendment 伴随边：父 `3fe5244` tree `d6b2ed71…` → 提交 `2668949` tree
    `5b5745e8…`；changed-path set 恰 6 路径（backlog + TASK-0191 卡 + 4 amendment
    写路径），sorted-set sha256 `ae794360…` 一致。
  - seed 引入边：父 `2668949` tree `5b5745e8…` → 提交 `bfc6a62` tree
    `19ac0333…`；changed-path set 恰 66 路径，sorted-set sha256 `c355d48e…` 一致。
  - TASK-0191 身份：base `3c7fd0b` tree `21dddce6…`、authorizationCommit
    `9aa3221` tree `4e7f600e…` 一致。
  - seed：mode `100644`、blob `5f849398…`、content sha256 `0203668d…` 一致；
    HEAD blob 仍为 `5f849398…`（无漂移）。
- 边界消费后：`a89afdf..d24d77e` 仅改 `.harness/project-state.yaml` 与 TASK-0192
  卡（READY/bind/IN_PROGRESS 状态同步）；doctor.py、test_harness.py、auth json
  自边界后零改动（`git diff --quiet` 验证）。

### 2. 实现正确性 — PASS（读 `scripts/harness/doctor.py`）

- `amendment_governance_companion_paths`（L4452）：仅遍历 `base..head` 中
  **单父边**（`len(parents) != 1` 跳过），且该边经
  `amendment_edge_introduces_without_errors`（L4407，在一次性 Audit 上完整复用
  `validate_amendment_introduction` 全量合同：单父、changed 恰为
  {task card, backlog, addedWriteAllowlist}、`authorizedParentCommit==父`、原子
  backlog 合同、不追溯授权，零错误）时才把 `.harness/task-backlog.yaml` 加入豁免集。
- `validate_diff_scope`（L18848）中豁免仅跳过 allowlist/forbidden 两个
  `audit.require`（`if not exempted` 分支内），protected-path 规则（riskClass/
  requiredSkill/humanApproval/independentReview/generatedOnly）、
  `validate_changed_path_modes`、staged snapshot、portable path collisions 全部
  不受影响；无任何全局 Backlog 忽略（豁免为逐路径集合成员判定）。
- `task0191_seed_recovery_applies`（L4495）：绑定 taskId=TASK-0191、base
  `3c7fd0b`、authorizationCommit `9aa3221`、base/auth tree、引入边父 `2668949`
  （`len(parents)==2` 即单父且 `parents[1]==2668949`）及其 tree、引入提交 `bfc6a62`
  及其 tree、66 路径精确集合、mode 100644/blob/content sha256、HEAD blob 一致性；
  任一不匹配即返回 False（异常路径亦失败关闭）；仅对传入任务的 diff-scope 生效，
  无通用追溯授权。
- 常量 `TASK_0192_SEED_RECOVERY_*`（L450-532）与 git 事实逐字节一致：66 路径
  常量集合与 `git diff --name-only --no-renames 2668949 bfc6a62 | sort` 输出
  `diff` 比对完全相同；`git cat-file -p bfc6a62:<seed> | shasum -a 256` =
  `0203668d…`；66 路径 set sha256 = `c355d48e…`。

### 3. 测试覆盖 — PASS（读 test_harness.py L11287-11539）

Owner 要求清单逐项对应，均实际运行 PASS：
- 正例：真实 TASK-0191 amendment 边零错误通过
  （`test_real_amendment_edge_qualifies_with_zero_errors`）；真实仓库 companion
  集恰 ={backlog}（`test_real_repo_companion_set_is_exactly_backlog`）；seed 恢复
  命中（`test_real_repo_recovery_applies`）；TASK-0012 历史 amendment 边 `1b9eafd`
  合法命中（`test_task0012_valid_amendment_edge_qualifies`）。
- 负例：错误父提交（含把 `3fe5244` 当 seed 边直接父的 cab8311 错误绑定）、错误
  tree、错误 blob、错误 content sha、额外路径（两处）、多父、二次消费（父 backlog
  已含 amendment id）、他任务复制（TASK-0190 身份两次）、backlog 创建边无
  amendment 零豁免（真实历史负例 `test_backlog_change_without_amendment_grants_no_companion`）、
  错误 base/authorization commit、错误 mode —— 全部 fail-closed。
- 回归：Task0098（3）+ Task0189（6）类保持 PASS。

### 4. 验证真实性 — PASS（本会话独立重跑）

- `doctor.py --summary`：PASS（887523 checks，102.5s，0 errors）——与实现者
  canonical precheck 声称的 887523 checks 完全一致。
- canonical precheck（卡的冻结命令
  `python scripts/harness/precheck.py --task TASK-0192`）：PASS（8 commands，
  exit 0，887523 checks，103.5s）。
- 定向 unittest（冻结命令 4 类）：`Ran 29 tests ... OK`（178.976s，约 3 分钟）
  —— 与实现者 29/29 声称一致。
- `git diff --check`：无输出（clean）。

### 5. 范围合规 — PASS

- `git diff --name-only 2abc531..d24d77e` = 6 路径：
  `.harness/project-state.yaml`、`docs/evidence/TASK-0192/pre-ready-maintenance-authorization.json`、
  `docs/tasks/TASK-0192-harness-amendment-diffscope-recovery.md`、
  `docs/tasks/context/TASK-0192.context-lock.yaml`、`scripts/harness/doctor.py`、
  `scripts/harness/tests/test_harness.py` —— 全部 ∈ 卡 writeAllowlist（9 路径）。
- TASK-0191 历史制品零修改：`git diff --exit-code --quiet 2abc531 d24d77e --`
  TASK-0191 卡/context-lock/evidence 目录/handoff 全部无差异；链上亦无
  `.harness/task-backlog.yaml`、`.harness/task-ledger.yaml` 改动（TASK-0191
  REJECTED ledger 条目原样保留）。
- 历史线性：`git log` 显示 7 提交严格单父链，`git rev-list --merges` = 0；无
  rebase/reset/filter 迹象；`0553e05` bind 的 authorizationCommit=3143428 与卡
  一致。

### 6. 未越权声明 — PASS

- `.harness/task-ledger.yaml` 中 TASK-0191 仍为 `state: REJECTED`（非 ACCEPTED）；
  本卡未把 TASK-0191 业务实现（V27/OwnerContext/测试）声明为 ACCEPTED。
- `.harness/project-state.yaml`：`activeTask: TASK-0192`、
  `lastAcceptedTask: TASK-0190`、`lastTerminalTask: TASK-0191`；nextAction 指向
  C4 复核与 ACCEPTED 闭合，并明确后续以独立任务卡接纳 TASK-0191 继承的 P0
  实现。
- Ledger 尚无 TASK-0192 条目（按验收标准 #4 属终态闭合动作，IN_PROGRESS 阶段
  缺失为预期）。

## 结论 — APPROVE

- P0（阻断）：无。
- P1（重大）：无。
- P2（建议/备注，均不阻断）：
  1. doctor 输出存在既有 TASK-0182 schema-incomplete WARN（历史条目，经推导
     验证），与本次交付无关。
  2. 完整 unittest discover（CiPolicy 34 分钟预算）未运行，与卡验收标准 #5
     记录一致，须在终态 Evidence 中如实记录 NOT_RUN。
  3. Ledger 追加 TASK-0192 与 Handoff 生成留待终态闭合提交执行。

六项必查项全部 PASS，实现与 Owner 2026-08-14 条件批准（含修正版机器绑定）逐字
一致，验证证据全部独立复现。批准 TASK-0192 当前候选 HEAD `d24d77e`。

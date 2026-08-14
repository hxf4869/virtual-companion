# TASK-0194 R1 独立复核报告（C4，fork_turns=none，只读）

**裁决对象**：按真实结果将 TASK-0194 闭合为 REJECTED 的处置，及候选事实（a4118b0）的如实呈报。**非**裁决实现可 ACCEPTED。

**最终裁决：APPROVE**（处置正当、事实诚实、证据自洽，无 P0/P1 blocking 发现）

**发现计数：P0=0，P1=0，P2=1，P3=2**

---

## 一、逐项核实结果（含实际执行命令与关键输出）

### 1. 候选提交结构 — 全部核实通过

| 项 | 命令 | 结果 |
|---|---|---|
| 单父 | `git log --format=%P -1 a4118b0` | `f452180a…`（唯一父，IN_PROGRESS 提交）✓ |
| 26 路径 | `git show --stat a4118b0` | 26 files changed，+3861/−467，与描述一致 ✓ |
| V1-V27 零修改 | `git diff --name-only fb9cf0e..a4118b0 -- 'db/migration/V1[0-9]__*.sql' 'V2[0-7]__*.sql'` | 空输出 ✓（Flyway checksum 安全） |
| 0191/0192/0193 历史制品 | `git diff --name-only fb9cf0e..a4118b0 -- 'docs/evidence/TASK-019[123]/'` | 空 ✓ |
| baseCommit/授权提交 | 卡 + 提交核对 | base=fb9cf0e、authorizationCommit=77fb9f9（READY 单父 879da12 修正）✓ |

注意：`git diff fb9cf0e..a4118b0` 另含 3 个治理路径（project-state.yaml、任务卡、context-lock），均属父提交 f452180 引入，候选自身（vs 父）恰 26 路径，无旁路。

### 2. 授权冻结缺口 — 独立确认根因（非实现缺陷）

- 卡 `requiredSkills` = task-delivery-flow / task-intake / database-migration（**无 model-routing-change**）；`humanApprovals` scope = scope-and-split-decision + **database-migration-and-authorization**。
- `.harness/protected-paths.yaml`：`**/db/migration/**` → C4 + requiredSkill=database-migration + humanApproval:true；`service/**/modelruntime/**` → C3 + requiredSkill=model-routing-change。
- doctor.py 门控（18917-18975 行）逐路径强制：`skill_id in required_skills and skill_id in skills`，且 humanApproval 要求 `item.get("scope") == skill_id` **精确相等**。故 4× modelruntime 缺 registered Skill + 1× V28 approval scope 不精确 = 恰 5 errors。
- amendment 合同（doctor.py 128-141 行 `AUTHORIZATION_AMENDMENT_FIELDS`，3986 行强制精确字段集）仅含 addedWriteAllowlist + replacements；requiredSkills/humanApprovals 属 `AUTHORIZATION_FIELDS` 不可变 → **结构性无法修复，非 Owner 不作为**。
- 独立复跑：`python scripts/harness/doctor.py --summary`（903630 checks）复现上述 5 errors（4× model-routing-change + 1× database-migration approval）。我的运行出现第 6 个错误 "worktree changed during validation"——系闭合进程并发写入闭合物（卡/ledger/evidence/handoff）所致，13:02 干净工作树运行恰 5 errors，与交接一致，非事实出入。

### 3. 实现关键点抽查 — 全部与描述相符

- **V28**（677 行，追加式）：时间源 `clock_timestamp()`（墙钟，header 与 155/298/332/339/359/365/385 行）；`create_attempt_intent/record_attempt_outcome/abandon_late_attempt` 独立函数，token/fence 仅落 SHA-256 hash；`assert_active_claim(owner, work_item_id, claim_token, claim_fence)` 显式参数校验、逐行校验 CLAIMED+匹配+lease 未过期、**非 GUC**（文件内 GUC 字样均系"不信任 GUC"注释；V17 job_fence set_config 为既有语义保留）；per-item `complete_work_item/fail_work_item/cancel_work_item/renew_lease`（按三元组定位，废除整批污染）；`recover_expired_claims` intent 感知区分。
- **LiveModelInvoker**：`prepare(request)→PreparedInvocation` 收敛唯一 DB 读（authorizationSnapshotStore.find，注释 TASK-0194）；`execute(prepared)` 对 external 仅跑 adapter 会话（executeExternal 无任何 DB 访问），类内无 JdbcTemplate/TransactionTemplate/DataSource。
- **WorkItemWorker**：claim-tx 段（vc.claim_work_items）→ 逐 item handler → handler 抛错时独立 per-item fail（新事务，仅原三元组，注释 INV-WORKER-001）。
- **GenerationWorkItemHandler**：五段注释与实际分段一致（prepare-tx / external-no-db / audit-outcome-tx / guarded-finalize-tx / guarded-fail-tx）。
- SQL 测试 74-83 存在且为新增。

### 4. 诚实性 — 核实通过，无 PASS 伪装

- `SchemaReadinessHealthIndicatorTest.java` 142-149 行：`expectedSchemaVersionFromClasspath().isEqualTo(27)`（注释"V1..V27"）；目录实际最大版本 V28 → 断言必败。**Maven 1 failure（27→28）属实**；340→345 增量与新增测试吻合。
- RLS 84/84：既有 01-73 + 新增 74-83 共 84，数目自洽。
- evidence-pack.json：precheck FAIL(exit1, 恰 5 gate error)、mvn FAIL(exit1, 345/1 failure)、RLS PASS(84/84)、diff-check PASS、doctor FAIL(5 errors, 903630)、pre-closure FAIL（`PENDING_PRECLOSURE_RESULT` 占位，**如实未伪造**）、discover NOT_RUN（附 34 分钟超预算理由，未转 PASS）。全部绑定候选 a4118b0。

### 5. 闭合正当性与后继路径

- 失败关闭合同（AGENTS.md 硬约束：失败/NOT_RUN 永不转 PASS、不得自批/倒推扩权）：5 gate errors 存在即 ACCEPTED 无合法路径；amendment 无法修改 AUTHORIZATION_FIELDS → 继续修复在本卡内结构性不可行；Owner 2026-08-14 决策方案 2（REJECTED 闭合 + 后继继承接纳）与机器合同一致。
- TASK-0193 先例成立：`docs/handoffs/TASK-0193.json` 载明 "TASK-0193 以 base=9a9c77c 完成继承实现正式接纳：inheritedStateManifest 机器绑定…TASK-0191 保持 REJECTED"，与 70 路径零漂移、四条冻结命令全 PASS 的既有接纳模式一致，后继卡可循此路径承接本候选 26 路径。

---

## 二、分级发现

- **P0（0）**：无。无任何影响处置正当性或事实真实性的阻断缺陷。
- **P1（0）**：无。实现抽查未见功能层面阻断问题；5 errors 确认为授权冻结缺口（READY 卡 requiredSkills/approval scope 与 protected-path 机器 gate 不匹配），非实现缺陷。
- **P2（1）**：证据包 `checks[5]`（`doctor.py --task TASK-0194 --pre-closure`）目前为 `FAIL / PENDING_PRECLOSURE_RESULT` 占位。终态闭合提交必须把"提交后的真实 pre-closure 结果"与 reviewer 记录（reviewers 现为空，本 R1 复核尚未回写）一并原子落入 evidence-pack 后，才算完整闭环；当前占位是诚实的，但须在闭合作业中补完。
- **P3（2）**：(a) 我本次独立 doctor 运行的 6th error（worktree 快照漂移）系并发闭合物写入的环境伪影，13:02 干净运行恰 5 errors，不构成事实偏差；(b) V28 注释保留 V17 job_fence set_config 既有 GUC 语义，非新增 GUC 授权标记，后继继承卡审查时注意区分新旧语义边界即可。

---

## 三、结论

TASK-0194 以真实失败结果闭合为 REJECTED 的处置**正当**（机器失败关闭 + 授权冻结结构性不可修复 + Owner 明确决策），候选事实（26 路径、V1-V27 零修改、5 gate errors、Maven 1 failure 27→28、RLS 84/84、Java 32/32、diff-check PASS、discover NOT_RUN）经独立复核**全部如实**，无 PASS 伪装。实现质量抽查与设计描述一致，可作为后继继承接纳的可靠承接对象（TASK-0193 模式）。**R1 裁决：APPROVE**（P0=0，P1=0，P2=1，P3=2）。

说明：本报告未写入 `docs/evidence/TASK-0194/review-r1.md`（遵循只读约束），markdown 内容如上，由调用方落盘。

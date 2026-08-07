# R1 独立复核：TASK-0036 Technical Alpha 总验收矩阵

- 复核人角色：独立 R1 reviewer（independent-review-gate，未参与实现）
- 复核 commit：`5507bce2a2f8e025b866465455d4f0007aed1690`（矩阵候选），diff = `352dc26..5507bce`（1 文件，+98）
- 复核范围：COMPLETE_MATRIX + ACCEPTANCE + INVARIANTS + ADJACENT_RISK（AC1–AC5 逐项真实核验）
- 复核日期：2026-08-08
- 复核方式：独立抽查证据包 / review 文件 / 日志（vc-session-20260808）/ git 历史 / 源码真源，并现场重跑 openapi validate+diff 与 git diff --check

## Verdict：PASS

矩阵 AC1–AC5 全部真实、可追溯、无掩盖：5 张依赖卡终态 Evidence 的 headCommit 与 git 历史逐卡一致；8 域矩阵计数与执行日志逐项吻合（RLS 39/39、Maven 243/0、vitest 93、harness unittest 239 OK、precheck PASS）；TASK-0034 历史 harness FAIL 如实披露（未掩盖）；TASK-0026 的 P2-1/P2-2 如实标注为**非阻塞 deferral**（未谎称已修复）；禁止能力全部保持关闭；不存在的性能能力如实 N/A，未编造数据。无 P0/P1，无 ACCEPTANCE/INVARIANT 违反。

## 逐项确认

### AC1 — 依赖终态 Evidence 可追溯（PASS）

- 逐卡读取 5 个 `docs/evidence/TASK-00XX/evidence-pack.json` 的 headCommit，与矩阵 §1 追溯表完全一致：
  - TASK-0026 `21eab7e86aee73bc96674c6ca87deaf8cdd7fe62`；TASK-0030 `106cecbabdd5dfcaf778e3dba2671d71e398a31c`；TASK-0032 `828241e13f74f8527aa4740d7f031a3484ab6c91`；TASK-0034 `280c002f91cc44f00a1ed8e674259a04a6f30259`；TASK-0035 `66dc2576861e30d263c351bdf7031f193fa51bf6`。
- 5 个 headCommit 全部 `git merge-base --is-ancestor <sha> HEAD` 为真（均在历史中可复算）。
- 5 个 `docs/handoffs/TASK-00XX.json` 的 headCommit 与 evidence-pack 完全一致；`.harness/task-ledger.yaml` 中 5 卡 state 全部 ACCEPTED。
- review 文件结论与矩阵 §1 声称一致：TASK-0026 review-r1 PASS（0 P0/P1，P2-1/P2-2 明确非阻塞）；TASK-0030 review-r1 PASS（0 P0/P1/P2，5 P3）；TASK-0032 review-r1 PASS（2 P2）+ review-r2 PASS（F1/F2 CLOSED）；TASK-0034 review-r1 + review-harness-fixes-r1 均 PASS；TASK-0035 review-r1 PASS（3 P2）+ review-r2 PASS。
- **TASK-0034 历史 FAIL 处置核对（重点）**：evidence-pack checks[6] 确为 `status=FAIL`（`python -m unittest discover -s scripts/harness/tests`，239 run / 1 failure / `test_backlog_draft_reconstructs_base_git_snapshot`，exit 1）。矩阵 §1 的处置描述与 evidence-pack 的 reason 逐点吻合：pre-existing（15cdee8 同样失败）、根因 e126c12（Gate 批准引入审批数据后 fixture 未同步）、Owner 授权 post-closure harness-change 修复 `ef3891c`。已独立验证 `ef3891c` 与 `15cdee8` 均在 git 历史中，`ef3891c` 提交信息即为 pin 重建 TASK-0034 DRAFT 卡的 harness 修复。**矩阵如实披露，未掩盖。**
- `.harness/project-state.yaml` nextAction 已推进至 TASK-0036（本卡），与 Backlog 顺序一致（backlog 中 TASK-0036 在 criticalPath 尾部、dependencies 恰为 5 张卡、decisionGates 空、promotionConditions 要求依赖全 ACCEPTED）。

### AC2 — 矩阵真实执行（PASS）

逐项对照执行日志（`C:\Users\k\AppData\Local\Temp\vc-session-20260808\`）：

- **RLS 39/39**：`rls-candidate2.log` 中 `grep -c "^PASS"` = 39，无 FAIL/NOT_RUN/SKIP，tail 为 `ALL TESTS PASS / RLS_EXIT=0`。矩阵 §2 引用的覆盖编号逐项命中：01/02/03/06/15/25/33（§2.1）、04/05/07–12/39（§2.2）、19–25（§2.6 realtime）、32–38（§2.4 记忆 7 项）、16/17/13/14/30/31（§2.5）。
- **Maven 243 / 0 failures / 0 errors**：`maven-candidate.log` reactor 模块汇总 2（catalog）+ 13（safety）+ 104（modelruntime）+ 39（persistence）+ 85（runtime）= 243，各模块 Failures=0、Errors=0，`BUILD SUCCESS`。LiveModelInvokerTest=15 tests（§2.7 声称核实）。
- **vitest 93**：`frontend-checks.log` 11 files / 93 passed / VITEST_EXIT=0；vue-tsc VUETSC_EXIT=0。
- **harness unittest 239**：`unittest-candidate2.log` `Ran 239 tests ... OK (skipped=1) / UNITTEST_EXIT=0`。
- **openapi validate + diff**：`fast-checks.log` VALIDATE_EXIT=0、DIFF_EXIT=0；**本复核现场重跑** `openapi_tool.py validate` 与 `diff --fail-on-drift` 均 PASS。
- **precheck（canonical）**：`precheck-candidate.log` `Harness precheck: PASS (5 commands) / PRECHECK_EXIT=0`，doctor 379542 checks PASS（receipt hit）、catalogValidate/catalogDrift/paidFeatureCheck（23 files）/betaRosterGate（CLOSED）全 PASS。
- **性能数据真实性（重点）**：仓库中不存在任何应用层 benchmark/load/perf 脚本（`scripts/` 与全局检索均无），矩阵 §2.8/§5 如实声明"不编造性能数据、以真实执行的测试规模 + 运行期基线断言代替"——**N/A 表述属实**。QuotaLedger 确认为内存 ConcurrentHashMap 实现（无真实持久化结算），provider_deployment 的 JDBC 仓库（`JdbcProviderDeploymentRepository`）无 Spring 注解、无任何调用方，部署数据实际走 `InMemoryProviderRegistry`（内存），"持久化同步不存在/属后续任务"实质准确。
- 运行期基线：`BaselineControllerTest` 现场确认断言 phase=TECHNICAL_ALPHA、transport=HTTP_SSE、technology.javaVersion=25-LTS、7 项受限能力全 false，另有 rejectsPhaseDrift/rejectsTransportDrift 构造期拒绝。

### AC3 — Alpha 禁止能力保持关闭（PASS）

- `.harness/project-state.yaml` capabilityGates：realPayment=**FORBIDDEN**（Technical Alpha 明确禁止）、realUserBeta=**BLOCKED**（PIA/伦理/成年验证/责任人/值班/演练未全证据）、businessImplementation=**BLOCKED**——与矩阵 §3 一致。
- `specs/catalog/product-scope.yaml`：paymentEnabled=false、publicRegistrationEnabled=false、betaGenerationEnabledByDefault=false、romanceModeEnabled=false、voiceEnabled=false、imageEnabled=false、websocketEnabled=false、zeroLlmDefaultForFree=false——与矩阵一致。
- `TechnicalAlphaCapabilities.java`：构造器对 7 项受限能力任一 true 即抛 `IllegalStateException`（source 非 blank 校验独立）——"任一开启即构造失败"属实。
- `scripts/harness/check_paid_features.py`：precheck 内 PASS（23 files）；`.harness/paid-feature-denylist.yaml` 恰 5 条规则——与矩阵"denylist 5 规则"一致。
- `ops/beta-duty-roster.yaml` 存在；precheck betaRosterGate 输出 `CLOSED`。

### AC4 — P0/P1/P2 闭环处置表（PASS）

逐卡对照 review 原文核实矩阵 §4：

- **TASK-0026**：review-r1 中 P2-1（chat.vue resume 未走单次 ticket 流）、P2-2（readSseEvents 丢弃 nextEpoch）均标注为**不崩溃、不披露存在的非阻塞 deferral**（未修复），handoff `remaining[1]`/`knownRisks[0]/[1]` 原样记录。矩阵标注"非阻塞处置 + backend-integration 后续任务"——**未将 deferral 谎称为已修复**，表述诚实。
- **TASK-0030**：review-r1 确认 0 P0/P1/P2、5 条 P3 非阻塞——与矩阵一致。
- **TASK-0032**：review-r2 逐条验证 F1（NO_CAPACITY 预留泄漏→非空预留 fail-closed throw）与 F2（release 无上限→ceiling 封顶）**CLOSED**，各附证明测试（`noCapacityRejectsNonNullReservationFailClosed`、`releaseCapsAtProvisionedCeiling`）——矩阵"CLOSED（R2 fix batch）"属实。
- **TASK-0034**：review-r1 确认 0 P0/P1/P2、6 条 P3；review-harness-fixes-r1 PASS。矩阵计数与严重级准确。
- **TASK-0035**：review-r1 恰 3 条 P2（P2#1 externalAttemptCreated 误报、P2#2 授权快照未交叉校验、P2#3 blank hard-rule）；review-r2 逐条 CLOSED（`!audits.isEmpty()`、providerId 绑定检查 BLOCKED_BY_AUTHORIZATION、构造期拒 blank），P3#1/#2 按 knownRisk 关闭——矩阵属实。
- 5 卡合计 P0=0、P1=0，无未处置 P2；矩阵"闭环语义"段落明确区分 CLOSED（fix batch 实测）与 非阻塞 deferral（review 证据），无夸大。

### 写路径 / 保护（PASS）

- `git diff 352dc26 5507bce --name-only` 仅 `docs/evidence/TASK-0036/technical-alpha-acceptance.md`。
- `git diff a71cf0d 352dc26 --name-only` 仅 `docs/tasks/TASK-0036-technical-alpha-acceptance.md`（writeAllowlist 内）。
- 两个提交均无 forbiddenPaths 触碰；`git diff --check 352dc26 5507bce` 干净。
- 候选提交只含矩阵文件（98 行新增），无隐藏改动。

### 不变量（PASS）

- 矩阵未把 NOT_RUN / 失败 / 超时表述为 PASS；唯一历史 FAIL（TASK-0034 harness unittest）被显式披露并绑定修复提交。
- 矩阵未称"P0/P1/P2 全部已修复"——对 TASK-0026 的 2 条 P2 明确标注为"非阻塞 deferral"并附 review 证据，闭环语义诚实。
- 矩阵对不存在的性能能力（应用层吞吐/延迟 benchmark、QuotaLedger 真实持久化、provider_deployment 持久化同步、LiveModelInvoker 生产调用入口）如实标注 N/A/后续任务。

## Findings

无 P0/P1/ACCEPTANCE_VIOLATION/INVARIANT_VIOLATION。以下为非阻塞 P3 观察：

1. **P3** — 矩阵 §4 TASK-0034 行的括注"6 条 P3（含 2 条闸门固有权衡、1 条 harness post-closure）"存在表述精度问题：review-r1.md 的 6 条 P3 中只有 2 条闸门固有权衡（#1 BCrypt 哈希暴露、#2 无状态 token 不可撤销）能对上，"1 条 harness post-closure"与 review-r1.md 的 6 项无对应（harness 相关的 P3-1/P3-2 位于 review-harness-fixes-r1.md，属另一变更）。计数（6）与严重级（P3 非阻塞）均正确，不影响任何验收结论，建议措辞改为"另含 review-harness-fixes-r1 的 2 条 harness P3"。
2. **P3** — 矩阵 §5"provider_deployment 持久化同步不存在"表述偏松：`service/platform/persistence/.../JdbcProviderDeploymentRepository.java` 确实存在且含 `INSERT INTO vc.provider_deployment`，只是无 Spring 注解、无任何调用方（死代码），实际部署数据走 `InMemoryProviderRegistry`。结论（无功能化持久化同步、属后续任务）实质正确，建议措辞注明"JDBC 仓库存在但未接线"以避免误导。
3. **P3** — 矩阵 §1 头部"READY doctor PASS 378055 checks"描述的是最终 READY 检查点（`doctor-task36-ready2.log` 确认 PASS 378055 checks 127.3s）；首次 READY doctor（`doctor-task36-ready.log`）曾因 Context Lock 变更 + 卡标题问题 FAIL（2 errors, 378055 checks），后经 READY 流程内修正。矩阵只呈现最终 PASS 状态属准确陈述（授权提交 0f853e6 在修正后完成 READY），仅作过程透明性提示，非失实。

## Conclusion

**PASS。** TASK-0036 总验收矩阵候选 `5507bce` 真实通过：5 张依赖卡终态 Evidence 全部可追溯（headCommit 与 git 历史一致）；8 域矩阵全部真实执行且计数与日志吻合（RLS 39/39、Maven 243/0、vitest 93、harness 239 OK、openapi validate+diff、precheck 5 commands）；TASK-0034 历史 FAIL 如实披露、TASK-0026 P2 如实标注为非阻塞 deferral，无掩盖、无伪造；Technical Alpha 禁止能力全部保持关闭；P0/P1 为零、P2 闭环或显式非阻塞处置；不存在的性能能力如实 N/A。3 条 P3 观察均为表述精度层面，不影响验收有效性。可进入终态闭包流程。

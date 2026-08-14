# TASK-0195 C4 独立复核报告（R1）

**裁决对象**：对继承实现 `fb9cf0e..d1941c9`（26 业务路径）的正式接纳 + 候选 `00ecd18` 上全部验收与机械修复（SchemaReadinessHealthIndicatorTest 27→28）的正当性。

## 一、COMPLETE_MATRIX：manifest 独立重算（只读 git，全部命令实跑）

| 核查项 | 命令/方法 | 结果 |
|---|---|---|
| 窗口路径数 | `git diff --name-only fb9cf0e d1941c9` | 恰 33（含 7 治理路径） |
| 治理排除 | 7 条 governanceExcludedPaths 与 manifest 一致 | 恰 7 → 业务 26 |
| 业务集合 | 排除后与 manifest `paths` 排序比对 | 完全一致（26/26） |
| 逐路径绑定 | `git ls-tree d1941c9` 逐项 | 26/26 mode=`100644` + blob 全匹配，无缺失 |
| orderedPathSetSha256 | 排序路径各加 LF 拼接后 sha256 | 计算值 `d6ff8562…f6333` = manifest，MATCH |
| manifestSha256 | 按 canonical 规范 json.dumps 后 sha256 | 计算值 `e94e6668…9b79` = manifest，MATCH |
| rejectedTerminalTree / adoptionBaseTree | `git rev-parse d1941c9^{tree}` | 均 `540a8a71…e92` = manifest，MATCH |
| implementationCommit | a4118b0，tree=`7c5a6e70…` | 与卡/Evidence 一致 |
| 窗口单父链 | `git rev-list --parents` 逐提交 | 9 提交全部 parents=1 |
| 26 路径零漂移 | `git diff --name-status a4118b0 d1941c9` | 仅 6 治理文件变更，26 业务路径零漂移 |
| 候选零漂移 | `git diff --name-status d1941c9 00ecd18` | 恰 4 路径，不含任何继承路径 |

## 二、继承实现范围审查（fb9cf0e..d1941c9）

- **V28**（`service/platform/persistence/src/main/resources/db/migration/V28__worker_lease_fence_business_guard.sql`）：追加式，窗口内 migration 目录仅 `A V28`，V1-V27 零修改（Flyway checksum 安全）。逐函数核对：`create_attempt_intent` 为 claim-scoped（work_item 仍 CLAIMED + digest(token/fence) 与 hash 精确匹配 + `lease_expires_at > clock_timestamp()`，失败 RAISE 禁外发）；`record_attempt_outcome` 仅 CREATED→终态、幂等返回行数；`abandon_late_attempt` 仅闭合既存 intent 为 ABANDONED_LATE 不新建 attempt；`assert_active_claim` 显式 `work_item_id+claim_token+claim_fence` 参数校验（不读任何 transaction-local GUC 作为授权标记）；per-item `complete/fail/cancel/renew_lease` 按 (id, token, fence) 终止，共享 token 版保留兼容（V5 语义仅限既有测试）；`claim_work_items` 墙钟 lease + 返回 claim_fence（DROP+CREATE 有 V20 先例）；`recover_expired_claims` intent 感知 a/b 分支（有 intent→FAILED+ABANDONED_LATE 不回 PENDING；无 intent→回 PENDING）。
- **LiveModelInvoker**：prepare/execute 拆分，注释明确 execute 无 DB 访问；`modelruntime` 主源 grep `JdbcTemplate/TransactionTemplate/DriverManager/DataSource` 零命中。
- **WorkItemWorker**：claim-tx 领批 + per-item handler + independent-fail-tx 以 `(claim.id(), claim.claimToken(), claim.claimFence())` 只终止原项，0 行结果不重试（INV-WORKER-001 fail-closed）。
- **GenerationWorkItemHandler**：五段结构核对通过（prepare-tx 内含 intent 创建 → external-no-db 仅 adapter/session → audit-outcome-tx 同行更新 → guarded-finalize-tx（assert_active_claim+candidate+finalize+per-item complete）→ guarded-fail-tx）。
- **SQL 测试**：`infra/db/tests/74_…83_fenced_finalize_happy_path.sql` 10 个全部存在。

## 三、候选 00ecd18 变更精确性

`git diff d1941c9 00ecd18` 恰含 4 路径：`.harness/project-state.yaml`、任务卡、context-lock、`SchemaReadinessHealthIndicatorTest.java`。Java diff 仅断言 `27→28` 与注释同步 V28 事实（+4/−3 行），无其他语义变更；父链 00ecd18→f2649d4（IN_PROGRESS，仅 project-state）→27c4c09（bind）单父。

## 四、轻量验收复核（如实记录）

- `git diff --check`：工作树与候选 diff 双 exit 0。
- `python -m json.tool docs/evidence/TASK-0195/inherited-manifest.json`：PASS（合法 JSON）。
- **doctor.py 复核**：环境伪影如实记录——首次误用 `/opt/homebrew/bin/python3`（缺 yaml 模块）失败，非有效结果；按冻结命令 `PATH=/Users/hxf/.zcode/venvs/vc-harness/bin:$PATH python scripts/harness/doctor.py --task TASK-0195` 执行：(1) 在 /tmp 纯净克隆（HEAD=00ecd18、干净工作树）上 **PASS 908028 checks（126.2s）**，与 Evidence 记录的 908028 checks 精确一致；(2) 在当前工作树（含未暂存的闭包制品）上 FAIL 17 errors——逐条归因均为 3 个 untracked 文件（evidence-pack/handoff/manifest 未暂存 ×6、evidence-pack schema null ×9、handoff 状态冲突 ×1、handoff 未暂存 ×1），候选提交内容零 error。

## 五、诚实性核查

- Evidence pack（`docs/evidence/TASK-0195/evidence-pack.json`，headCommit=00ecd18）逐项与实现者声称一致：precheck 8 commands PASS（doctor 908028 checks 116.6s）、mvn Tests run=345 F=0 E=0 exit 0、RLS 84/84、diff --check exit 0，且全部绑定 `candidateCommit=00ecd18`；pre-closure 与 unittest discover 如实 `NOT_RUN`（含 34 分钟 CI 预算理由），无 PASS 伪装、未复用 TASK-0194 结果（其 pack 绑定的是 a4118b0）。
- TASK-0194 保持 REJECTED：ledger `state: REJECTED`；project-state `lastTerminalTask=TASK-0194`、`lastAcceptedTask=TASK-0193`、`activeTask=TASK-0195` 未被顺带 ACCEPTED。
- 卡内 requiredSkills 含 `model-routing-change@1.0.0`、humanApprovals 含 database-migration 与 inherited-state-adoption，26 继承路径 forbidden 零漂移、writeAllowlist 仅含 Java 测试与治理路径——与预授权一致（READY Doctor 906148 PASS 已证明 gate 匹配）。

## 六、发现分级（P0/P1 为 blocking）

- **P0 = 0**
- **P1 = 0**
- **P2 = 2**
  - **P2-1（闭包期）**：`docs/handoffs/TASK-0195.json` 占位 `state: ACCEPTED` 在 C4 复核与闭包前写入，与卡 IN_PROGRESS 冲突（doctor: state disagrees with task）。闭包必须按真实终态改写并暂存，否则预闭包 doctor FAIL。
  - **P2-2（闭包期）**：evidence-pack `checks[]` 的 `verifiedCommit` 全为 null、`checks[0].candidateCommit` 为 null，违反 schema（type string, `^[0-9a-f]{40}$`）。doctor 仅对**非终态**任务做 evidence schema 校验（终态跳过，TASK-0194 因此未报），故预闭包前必须回填真实 40 位 SHA（如 27c4c09/00ecd18）或按流程暂存终态卡，否则预闭包 doctor FAIL。
  - 二者均为闭包制品整理问题，不触及继承实现与候选内容，不阻塞本次接纳裁决。
- **P3 = 2**：① V28 部署兼容——全新追加文件 checksum 稳定，全树唯一 V28 blob `386ab92b…`（a4118b0/d1941c9/00ecd18 同一 blob），DROP+CREATE 有 V20 先例，风险仅存在于假想草稿部署；② bounded retry/dead-letter 与 cooperative 中断顺延缺口——recover_expired_claims 无 intent 回 PENDING 的重试热循环收敛仅声明于 DB 可写且 fail tx 成功边界，卡内已如实 advisory 记录（无字面任务 ID），属明确范围外。

## 七、最终裁决

**APPROVE**——对继承实现 `fb9cf0e..d1941c9` 的正式接纳与候选 `00ecd18` 上全部验收及机械修复正当：manifest 机器核验 17 项独立重算全中（数量 33/7/26、26/26 mode/blob、双 SHA、双 tree、9 提交单父、26 路径双端零漂移、候选 4 路径精确）；V28 与 Java 三层实现逐项核对符合卡内设计；纯净候选 doctor 独立复现 PASS 908028 checks（与 Evidence 数字精确吻合）；TASK-0194 保持 REJECTED 未被顺带接纳；无 PASS 伪装。P2 两项为闭包期制品整理义务，需在预闭包 doctor 前解决。

**计数：P0=0，P1=0，P2=2（均闭包期，非 blocking），P3=2。**

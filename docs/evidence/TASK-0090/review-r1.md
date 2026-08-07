# TASK-0090 R1 独立评审报告

- 任务：TASK-0090 生成终态持久化与审计落库（SQL/持久化侧），C4（database-migration）
- 评审提交：`e75df6bf7f3f4200351a3059d87fb06790cce7d5`（实现候选）+ 前置任务链（fd3b6f3 起）
- 评审日期：2026-08-08
- Reviewer：R1（独立，无历史上下文）
- 评审范围：`git diff fd3b6f37c3dafc62b825d3c6cc4b23f13c098070 e75df6b -- service/platform/persistence/src/main/resources/db/migration/V15__provider_attempt_terminal_transitions.sql infra/db/tests/` 及全 diff 治理面
- 方法：只读命令（git show/diff、grep、sed、cat）；未运行任何测试（R1 不执行 requiredCommands，见 AC5）

## Verdict

**PASS** — 无 blocking 发现（P0/P1/AC 违反/不变量违反均为零）。8 条非阻塞发现（P2×3、P3×5）见 Findings；其中 F-1/F-2 建议在 closure 或 TASK-0093 侧消化。

## AC 覆盖矩阵（可复测性）

| AC | 支撑代码 | 支撑测试 | 结论 |
|----|----------|----------|------|
| AC1 V1-V15 应用 + RLS 套件全量 | V15（新建表/4 函数，纯增量，不改既有对象） | 40-43 号新增；`run-rls-tests.sh:66` glob `[0-9][0-9]_*.sql` 自动拾取；既有 01-39 + 新增 4 = 43 | 就绪。实际执行为 requiredCommands `bash infra/db/run-rls-tests.sh`，由 terminal/precheck 执行（R1 NOT_RUN） |
| AC2 record_provider_attempt 落库 + owner 隔离 + 无凭据列 | V15:61-121（存在性隐藏、status 白名单、set_config 绑定）；V15:26-41（7 列，无凭据/内容列） | 40 号：7 列精确断言、无凭据列断言、落库 round-trip、跨租户读 0 行、跨租户写拒绝、非法 status/空 supplier/未知 generation 失败关闭 | 覆盖完整 |
| AC3 terminalize 合法/非法/原子事件/终态拒绝 append | V15:131-215（to_status 白名单、事件-终态配对、FOR UPDATE、catalog 合法边、同事务 UPDATE+INSERT） | 41/42 号：4/5 条合法边 + 非法 from（QUEUED）+ 已终态（COMPLETED）+ 直接 CANCELLED + 未知 generation + 事件类型不匹配拒绝 + 终态 append 拒绝 + TERMINAL_SNAPSHOT 含终态事件 | 覆盖完整（缺 COMMITTING→FAILED_FINAL 一条合法边断言，见 F-2） |
| AC4 candidate 落库 + 单终态唯一 + quota RELEASE | V15:223-277（终态拒绝、唯一索引兜底 INV-GEN-002）；V15:281-329（kind=RELEASE、负数拒绝） | 43 号：candidate 返回 id、finalize 端到端消费（SETTLE 行断言）、第二 final candidate 唯一约束拒绝、终态 generation 拒绝候选、RELEASE 行 kind 断言、负数/未知 generation 拒绝 | 覆盖完整 |
| AC5 验证全绿 | — | precheck/Maven/unittest/git diff --check 均为 requiredCommands 执行项 | R1 不运行测试，NOT_RUN；由 terminal 检查执行 |

## Findings

### F-1（P2，non-blocking）契约列名偏差 — 卡:268 vs V15:68
任务卡「API/事件/数据契约」声明 `record_provider_attempt(...) RETURNS TABLE(out_id bigint, out_owner bigint)`，实现返回 `out_owner_user_id`；测试 40（`r.out_owner_user_id`）按实现断言。属卡内契约文档与代码的命名偏差，不构成 AC 违反（AC2 未规定返回列名），但 TASK-0093 消费侧必须按实现列名（`out_owner_user_id`）编码。建议 closure 时在卡/规划文档修正契约描述或由 TASK-0093 侧消化。

### F-2（P2，non-blocking）合法边测试缺口：COMMITTING→FAILED_FINAL — 41 号测试
AC3 与卡:279 声明 FAILED_FINAL 合法 from 为 IN_PROGRESS/WAITING_FOR_CAPACITY/COMMITTING 三态。实现（V15:182-190）三边均允许，且与 catalog（generation-states.yaml transitions）逐边核对一致（含 QUEUED 无边、FINAL_REVIEW 无 FAILED_FINAL 边）。但 41 号测试仅覆盖 IN_PROGRESS→FAILED_FINAL 与 WAITING_FOR_CAPACITY→FAILED_FINAL，未断言 COMMITTING→FAILED_FINAL（该 generation 5003 走了 COMPLETED_FALLBACK 边）。该边与 WAITING_FOR_CAPACITY 分支同代码路径，风险低；建议在 fix batch（如产生）或 TASK-0093 测试中补一条正向断言，使 AC3 全部合法边可复测。

### F-3（P2，non-blocking）终态事件以 stream_epoch=1/event_seq=0 默认值落库 — V15:199-204
终态 realtime_event INSERT 未显式写 stream_epoch/event_seq，取 V8 列默认（1/0）。与 V7 finalize 的 chat.completed 完全一致（既有模式，测试 23 注释已记录该事实）。若 generation 经历 reset（权威 epoch>1），终态事件仍落在 epoch=1 且 event_seq=0，与 generation 权威 epoch 不一致；resume_stream 终态路径（V8:516-535）无 epoch 过滤、按 committed_at/event_seq 排序，TERMINAL_SNAPSHOT 仍包含该事件，无功能破坏，`realtime_event_seq_uniq` 无冲突（append 的 seq 从 1 起）。INV-TX-001/INV-GEN-003 不受影响。属继承既有模式的技术债，建议后续迁移或 TASK-0093 对齐 epoch。

### F-4（P3，non-blocking）41 号「aborted terminalize 不留事件」断言未触发真实回滚路径 — 41 号测试:96-115
该断言触发的是事件类型校验（写前拒绝），并非 UPDATE+INSERT 之后的故障回滚。INV-TX-001 的原子性由单函数单语句结构保证（函数内任一 RAISE 使整调用回滚），与 V7 fault-injection 模式（17 号测试）同构；terminalize 未提供 p_fault 钩子，不强制要求注入式证明。可接受，留档说明。

### F-5（P3，non-blocking）terminalize/candidate/release 无直接跨租户测试 — 41/42/43 号
三个函数对「他租户 generation」与「未知 generation」走同一条 `WHERE owner_user_id=...` 未命中→RAISE 路径（V15:168-176、246-253、306-312），测试仅覆盖未知 id 形态；record_provider_attempt 的跨租户读写由 40 号直接覆盖（读 0 行 + 写拒绝）。复合 FK (owner_user_id, generation_id) 结构性保证无法引用他租户父行。可接受。

### F-6（P3，non-blocking）record_provider_attempt 不校验授权快照 — V15:96-103
INV-AUTH-001 的 enforcement 为 not_null_constraint/composite_foreign_key/integration_test（.harness/invariants.yaml），授权绑定在 Java 集成层；本卡明确不触碰 Runtime 上下文（卡:253-258 范围外）。SQL 侧不新增授权列、不削弱任何约束；由 TASK-0093 保证调用前授权绑定完成。

### F-7（P3，non-blocking）insert_generation_candidate 状态读取未加 FOR UPDATE — V15:246-249
存在与 finalize 并发下的极小 TOCTOU 窗口；由终态拒绝校验 + `generation_candidate_one_final` 部分唯一索引 + finalize 前置 candidate 存在性检查（V7:186-194）三重兜底，且与 V7 finalize 不加锁模式一致，不构成不变量削弱。

### F-8（P3，informational）V15 顶层无 `SET search_path TO vc, public;` — V15:1-18
V7/V8 有顶层 SET，V15 缺省；但全部对象 schema 限定（`vc.` 前缀），四个函数体内自带 `SET search_path = vc, public`，无实际风险。

### F-9（P3，informational）provider_attempt 仅 GRANT SELECT/INSERT/UPDATE（无 DELETE）— V15:55-57
比 V2/V7/V8 的 SELECT/INSERT/UPDATE/DELETE 更严格，审计表只增语义下合理；owner_isolation 策略 FOR ALL 覆盖全部命令但未授予的 DELETE 不可执行，无安全隐患。

## blocking 定义

- blocking：P0 / P1 / ACCEPTANCE_VIOLATION / INVARIANT_VIOLATION
- non-blocking：P2 / P3

## 不变量核查（requiredInvariants 五项）

- **INV-TENANT-001**：未削弱。V1 四角色均 NOBYPASSRLS；provider_attempt FORCE RLS + owner_isolation FOR ALL 四角色（V15:45-51，与 V2/V7/V8 同构）；复合 FK；40 号跨租户读写测试真实断言。函数体内显式 owner 谓词 + set_config 绑定，与 V6-V10 信任模型一致。
- **INV-AUTH-001**：未削弱。本卡不新增授权写入，无凭据/内容列（40 号断言），授权绑定仍由 Java 集成层负责（F-6）。
- **INV-COST-001**：未削弱。纯 SQL 增量迁移，无付费/SaaS-only 依赖引入。
- **INV-GEN-003**：未削弱。终态事件类型与终态状态在函数内强制配对（V15:158-165）：chat.failed↔FAILED_FINAL、chat.blocked↔OUTPUT_BLOCKED、chat.completed↔COMPLETED_FALLBACK，无法伪造 chat.completed（41/42 号负向断言）；`append_realtime_event` 对终态 generation 的拒绝（V8:231-238）保持不变且由 42 号复测；V7 finalize 语义未动。
- **INV-TX-001**：未削弱。状态 UPDATE（V15:192-195）与终态事件 INSERT（V15:199-204）同函数同事务，单语句原子性结构保证，任一失败整体回滚；42 号测试验证两物同现（status=FAILED_FINAL 且恰一条 PENDING chat.failed）。

## 正确性核对（终态转移 vs generation-states.yaml）

逐边核对 catalog transitions 与 V15:182-190 实现：

| 目标终态 | catalog 合法 from | V15 实现 | 一致 |
|----------|-------------------|----------|------|
| FAILED_FINAL | WAITING_FOR_CAPACITY / IN_PROGRESS / COMMITTING | 同 | ✓ |
| OUTPUT_BLOCKED | FINAL_REVIEW | 同 | ✓ |
| COMPLETED_FALLBACK | COMMITTING | 同 | ✓ |

- QUEUED→FAILED_FINAL 等非法边、已终态再推进、未知 generation 一律 RAISE（失败关闭）；直接 CANCELLED 在 to_status 白名单层拒绝，双跳保留走 V10 `cancel_generation`（V10 不接受 COMMITTING 与终态，无重叠）。✓
- status CHECK 与 ProviderAttemptStatus 枚举 11 值逐字一致（V15:37-41 vs `specs/generated/java/com/virtualcompanion/catalog/ProviderAttemptStatus.java`）。✓
- 函数名与 V1-V14 无冲突（仓库 grep 仅 V15 命中四个新函数名）。✓
- REVOKE PUBLIC + GRANT EXECUTE TO vc_api（V15:116-121/210-215/272-277/324-329），对齐 V6-V10 模式。✓

## 治理合规

- 实现提交 e75df6b 仅含 5 文件（V15 + 40-43 测试），diff 干净聚焦。
- 全 diff（fd3b6f3..e75df6b）共 12 文件，全部落在卡 writeAllowlist 内（任务卡、context-lock、planning 文档、project-state.yaml、V15 精确文件名、infra/db/tests/**）；forbiddenPaths（V1-V14、run-rls-tests.sh、Java、frontend、specs、scripts、skills 等）零触碰。
- requiredSkills 含 database-migration 1.0.0；humanApprovals scope=database-migration（owner 2026-08-08，sourceThreadId continuation-handover-20260808）已声明；independentReview: required 已声明，本报告即该独立评审。
- 测试真实性：40-43 均为 `\set ON_ERROR_STOP on` + DO 块 RAISE EXCEPTION 真断言（列数/内容/状态/事件/kinds 精确计数），TRUNCATE CASCADE fixture 与既有 16-30 号测试同构；非空转。
- 无密钥、Token、真实联系人/用户数据；仅合成数据（alice/bob、persona-a）。
- Task Ledger 无 TASK-0090 条目与既有 append-only 模式一致（ledger 在 ACCEPTED/REJECTED closure 时落条目，TASK-0036 条目即在其 ACCEPTED 提交 fd3b6f3 落入）；活动任务由 project-state.yaml activeTask=TASK-0090 追踪。

## 结论

无 blocking 发现。Verdict：**PASS**。

必须修复项：无。建议跟进项（不阻塞）：F-1 契约列名偏差（`out_owner` vs `out_owner_user_id`，TASK-0093 消费侧按实现编码）、F-2 补 COMMITTING→FAILED_FINAL 正向断言、F-3 终态事件 epoch 对齐（后续迁移）。

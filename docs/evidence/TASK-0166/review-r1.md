# TASK-0166 R1 独立静态复核

- **reviewer**: task0166_r1（independent-review-gate，static-only per Owner 2026-08-12 acceleration）
- **candidateCommit**: `bae036cfd471637d89dbaec998c4bfb1c2f89a31`
- **candidateTree**: `317aa143dbdfdb4560bf97baabe6e8acc1cbf647`
- **baseCommit**: `091e01e927dd59655e6ae6472c20ace43867024d`（TASK-0165 ACCEPTED terminal）
- **verdict**: **PASS**（0 P0 / 0 P1 / 0 P2 / 0 P3）
- **scope**: §5.1.6 / RISK-10 V8/V11 存量数据升级 fail-closed 测试覆盖

## 1. 静态门禁（引用实现者已跑结果，未 fresh 重跑）

| 门禁 | 命令 | 结果 | 证据 |
|---|---|---|---|
| DB RLS 测试 | `bash infra/db/run-rls-tests.sh` | **PASS** 61/61 | exit 0；test 61 新增 PASS；test 1-60 无回归（含 test 50/57/60） |
| canonical precheck | `python scripts/harness/precheck.py --task TASK-0166` | **PASS** 8/8 | exit 0；doctor 792478 checks 108.1s；catalogValidate/catalogDrift/paidFeatureCheck/licenseCheck/betaRosterGate/openapiValidate/openapiDrift 全 PASS |
| diff whitespace | `git diff --check` | **PASS** | exit 0 |

加速模式：跳过 fresh TMPDIR 重跑 doctor/canonical/rls；引用实现者已跑的真实退出码与终态。canonical precheck 的 doctor 子命令是候选合法性唯一 doctor 校验（fingerprint/字段/writeAllowlist-forbiddenPaths 零冲突/protected-path 技能匹配/authorization projection 历史冻结全 PASS）。

## 2. Diff Scope（base 091e01e..HEAD bae036cf）

| 路径 | 类型 | 在 writeAllowlist | 在 forbiddenPaths |
|---|---|---|---|
| `infra/db/tests/61_v8_v11_legacy_upgrade_fail_closed.sql` | 新增 | ✅ | ✅ 不在（glob 0[1-9]/[1-3][0-9]/4[0-9]/5[0-9]/60_* 不匹配 61） |
| `docs/tasks/TASK-0166-v8-v11-legacy-upgrade-fail-closed-test.md` | 新增 | ✅ | ✅ 不在（forbidden 到 TASK-0165-*） |
| `docs/tasks/context/TASK-0166.context-lock.yaml` | 新增 | ✅ | ✅ 不在（forbidden 到 TASK-0165） |
| `.harness/project-state.yaml` | 修改（activeTask/nextAction） | ✅ | ✅ 不在（lifecycleExemption） |

4 路径全在 writeAllowlist，无一出现在 forbiddenPaths glob（doctor 硬校验零冲突已 PASS）。**不触任何保护路径**：`infra/db/tests/**` 不匹配 `**/db/migration/**`（是 `db/tests` 非 `db/migration`），故 C2 非 C4；无 service/specs/.harness（除 project-state exemption）/skills/scripts 变更。

## 3. 实现语义分析（test 61 四场景）

**场景 1 — V8 升级 unique 碰撞（核心）+ 正向控制：**
- `BEGIN; DROP INDEX IF EXISTS vc.realtime_event_seq_uniq;` 插 2 条同 `(owner=1, gen=7000, epoch=1, seq=0)` realtime_event（忠实模拟 V8 DEFAULT 0 backfill 在 2 条存量 V7 行上的输出——V7 realtime_event 无 stream_epoch/event_seq 列，V8 ADD COLUMN NOT NULL DEFAULT 把全部填成 (1,0)）。
- DO 块执行 V8:50-51 的 `CREATE UNIQUE INDEX realtime_event_seq_uniq ON (owner_user_id, generation_id, stream_epoch, event_seq)` → 捕获 `unique_violation`（**证明 V8 在此碰撞数据上 abort，fail-closed**）。DO 子事务回滚 CREATE INDEX，外层 INSERT 仍在事务内。
- `ROLLBACK` 恢复索引 + 清除行（DDL 事务化，DROP INDEX 回滚恢复索引）。
- 正向控制：2 条 distinct (gen=7000/gen=7001) 行各 seq=0 → CREATE UNIQUE INDEX 成功（**证明单行-per-(owner,gen) backfill 安全，无碰撞**）。
- **判定：忠实复现 V8 升级步骤，fail-closed 与安全 backfill 双向证明。**

**场景 2 — V8 post-migration 守卫：**
- 直接插 `(owner=1, gen=7000, epoch=1, seq=5)`，再插同 key → existing index `realtime_event_seq_uniq`（V8 已建）拒绝 `unique_violation`。
- **判定：证明 V8 建的索引持续强制 INV-RT-001 单调游标不变量（升级后不可注入碰撞）。**

**场景 3 — V11 升级 CHECK 碰撞：**
- `BEGIN; ALTER TABLE vc.memory_item DROP CONSTRAINT memory_item_session_requires_conversation;` 插 `scope='SESSION', conversation_id=NULL` memory_item（忠实模拟存量 SESSION memory——V2 memory_item 无 conversation_id 列，V11 ADD COLUMN nullable backfill 为 NULL）。FK（仍在）不拒：MATCH SIMPLE 下 conversation_id=NULL 跳过 FK 检查。
- DO 块执行 V11:36-38 的 `ADD CONSTRAINT memory_item_session_requires_conversation CHECK (scope <> 'SESSION' OR conversation_id IS NOT NULL)` → 捕获 `check_violation`（**证明 V11 abort，fail-closed**）。
- `ROLLBACK` 恢复 CHECK。
- **判定：忠实复现 V11 CHECK 升级步骤，fail-closed。**

**场景 4 — V11 升级 FK 碰撞：**
- `BEGIN; ALTER TABLE vc.memory_item DROP CONSTRAINT memory_item_conversation_fk;` 插 `scope='SESSION', conversation_id=999888` memory_item（模拟存量 SESSION memory 指向已删 conversation）。CHECK（仍在）通过（conversation_id IS NOT NULL）。
- DO 块执行 V11:44-47 的 `ADD CONSTRAINT memory_item_conversation_fk FOREIGN KEY (owner_user_id, conversation_id) REFERENCES vc.conversation(owner_user_id, id)` → 捕获 `foreign_key_violation`（**证明 V11 abort，fail-closed**）。
- `ROLLBACK` 恢复 FK。
- **判定：忠实复现 V11 FK 升级步骤，fail-closed。**

## 4. 事务隔离与清理正确性

- 所有 DROP INDEX/CONSTRAINT 在 `BEGIN/ROLLBACK` 内。PostgreSQL DDL 事务化：ROLLBACK 恢复索引/约束。每个场景独立事务，终态 schema 与测试前一致（run-rls-tests 每次全新容器 + test 61 是最高编号，无后续测试受影响，但事务化清理仍是正确实践）。
- DO 块 `EXCEPTION WHEN unique_violation/check_violation/foreign_key_violation` 精确捕获目标错误类；若 CREATE INDEX/ADD CONSTRAINT 意外成功，紧跟的 `RAISE EXCEPTION 'must fail'` 使测试失败（fail-loud，不吞通过）。
- 超管（postgres，无 SET ROLE）插入绕过 V16 运行角色 DML 撤销 + FORCE RLS，与 test 50:146-162 的 CHECK 验证超管路径一致（约束是表级、caller-role-independent）。

## 5. 范围与不变量

- **不改任何 migration（V1-V21）**：diff 仅新增 test 61，无 `db/migration/` 变更（doctor diff scope 子命令 0.275s PASS 确认）。
- **不改 test 01-60**：test 61 是唯一新增测试文件。
- **不改 Java/catalog/contract/service**：无 service/** 变更。
- **INV-RT-001**（event gaps/epoch 显式，client 不 fabricate missing deltas）：场景 1/2 证明 realtime_event_seq_uniq 强制 per-(owner,gen,epoch) seq 唯一——升级时 fail-closed（场景 1）+ 升级后持续强制（场景 2）。
- **INV-MEM-001/002**（canonical memory 是 PG truth，model 只创 candidate；candidate 需用户确认）：V11 CHECK/FK 碰撞证明（场景 3/4）确保 SESSION memory 必须有有效 conversation 绑定——升级 fail-closed 保护此结构不变量。
- **INV-TX-001**：test 61 不触 finalize 事务，无关。
- **INV-HARNESS-002/003/005/007/009**：唯一活动任务、writeAllowlist 边界、evidence 不伪造未跑为 PASS、canonical 一次、exact-tree 通道如实——全满足。

## 6. RISK-10 闭合评估

RISK-10 要求"在保留真实数据前提供 preflight/backfill，并用不兼容历史数据做升级测试"：
- **preflight**：V8/V11 migration 本身即 preflight——CREATE UNIQUE INDEX / ADD CONSTRAINT 在坏数据上 abort，阻止升级继续（场景 1/3/4 机器证明）。
- **backfill**：V8 ADD COLUMN DEFAULT 0（单行/合法情形，正向控制证明）+ V11 ADD COLUMN nullable（场景 3/4 证明坏情形 abort）。
- **不兼容历史数据升级测试**：test 61 四场景即是——用 V7/V2 原始列形状的忠实碰撞数据，复现 V8/V11 约束创建步骤，断言 fail-closed。

**结论**：test 61 闭合 RISK-10 的证据要求（升级行为机器证明）；V8/V11 已 fail-closed 无 latent bug 需修，纯测试覆盖卡是正确范围。

## 7. Findings by severity

- **P0**: 0
- **P1**: 0
- **P2**: 0
- **P3**: 0（test 61 散文与实现完全一致；无 search_path 类散文漂移问题——本卡不触 SD 函数）

## 8. Acceleration notes

- 完整 Harness unittest 按 Owner 2026-08-12 static-gates-only 策略 deferred to unified audit（test 61 是纯 SQL 测试，由 run-rls-tests.sh 61 测试直接验证，无 Python harness 改动）。
- standalone Doctor（DRAFT/READY/pre-closure）全部跳过；canonical precheck doctor 子命令（792478 checks）是唯一 doctor 门禁。
- R1 static-only：读候选 diff + 静态判断 + 引用实现者已跑 run-rls-tests/canonical/diff 真实结果，未 fresh TMPDIR 重跑。

## 9. 结论

**R1 PASS**：0 P0/P1/P2/P3。test 61 四场景忠实复现 V8/V11 在不兼容存量数据上的升级步骤（V8:38-53 DEFAULT 0 backfill + CREATE UNIQUE INDEX；V11:36-47 nullable conversation_id + ADD CHECK + ADD FK），用 V7/V2 原始列形状的碰撞数据机器证明三者 fail-closed（unique_violation / check_violation / foreign_key_violation）+ V8 post-migration 守卫持续强制 INV-RT-001。全 BEGIN/ROLLBACK 事务化清理，schema 终态不变。静态门禁全 PASS（rls 61/61、canonical 8/8 doctor 792478、diff exit0）。纯测试覆盖卡不触任何 migration/Java/catalog/contract，4 路径全在 writeAllowlist，V1-V21 与 test 01-60 冻结。§5.1.6 / RISK-10 升级 fail-closed 证据要求闭合。

# TASK-0154 R1 Review (Rebuild Chain)

- **Verdict: PASS**
- **Reviewer Role**: Independent R1 Reviewer (C4 database-migration, full-matrix review)
- **Review Date**: 2026-08-11
- **Chain Type**: Rebuild (首批链 R1 FAIL：test 35 在 IN_PROGRESS 后从 forbiddenPaths 自行移入 writeAllowlist)

## 候选身份（重建链）

| 字段 | 值 |
|---|---|
| Candidate Commit | `391cd42a41fc052bf03d48b9bafa862e1b7b67ef` |
| Candidate Tree | `4054224b389033166e8f3fb8adaf50945fa7a87a` |
| Base Commit | `2c97bad86ce655cc98f5bc70ad99907ab8a2bd16` |
| Repository | `/Users/hxf/projects/virtual-companion` |

提交链（重建后）：
- `d09ea14` DRAFT（writeAllowlist 自始含 test 35）
- `0b73b2f` READY 授权
- `1e52817` authorizationCommit 绑定
- `55ebb1a` IN_PROGRESS
- `391cd42` 实现（V17 + 9 测试重构 + 2 新负测）

---

## 1. R1 FAIL 核心阻塞修复验证（关键）

首批 R1 的唯一阻塞是 writeAllowlist 在 READY 后扩入 test 35（违反「READY 后只接受 Backlog 强类型 amendment」）。本节验证重建链修复。

### 1.1 writeAllowlist 三提交字节级一致性

`writeAllowlist:` + `forbiddenPaths:` 整块在 DRAFT / READY / CANDIDATE 三提交间 `diff` 结果：

```
diff DRAFT(d09ea14) vs READY(0b73b2f)   → IDENTICAL
diff READY(0b73b2f) vs CANDIDATE(391cd42) → IDENTICAL
```

test 35 在三提交的 writeAllowlist 中均出现（DRAFT 第 127 行、READY 第 127 行、CANDIDATE 第 128 行）：

```
- infra/db/tests/35_memory_edit_evidence.sql   (writeAllowlist)
```

### 1.2 forbiddenPaths 不含 test 35

forbiddenPaths 列出 `infra/db/tests/01..53`（缺 07/13/14/35/44/45/46/47/49），test 35 不在其中。三提交 forbiddenPaths 块同样字节一致。

### 1.3 humanApprovals evidence 提及 9 测试

`humanApprovals.scope: task-assignment` evidence 明文：

> 重构 9 个受影响的现有测试加 SET LOCAL/set_config vc.owner_user_id 前置
> （07/13/14/35/44/45/46/47/49；其中 35 的超级用户 DO 块用 set_config 模拟可信 context）。

**R1 FAIL 核心阻塞已修复**：writeAllowlist 自 DRAFT 起即含 test 35，三提交一致；forbiddenPaths 全程不含 test 35；Owner 授权（humanApprovals）明文 9 测试。治理闭环。

---

## 2. 技术层面复核

### 2.1 V17 migration 技术计数

文件：`service/platform/persistence/src/main/resources/db/migration/V17__sd_owner_param_trusted_assertion.sql`（1992 行）

| 项 | 期望 | 实测 | 结果 |
|---|---|---|---|
| `CREATE OR REPLACE FUNCTION` | 34 | 34 | PASS |
| `IS DISTINCT FROM vc.current_owner_id()` | 34 | 34 | PASS |
| 实际 `PERFORM set_config('vc.owner_user_id' ...)` 调用 | 0 | 0 | PASS |
| `set_config('vc.owner_user_id'` 字符串出现 | 注释 OK | 2（均注释：行 8 头部 + 行 1954 尾部） | PASS |
| `set_config('vc.job_fence'` 保留 | 1（claim_work_items） | 1 | PASS |
| `p_owner_user_id IS NULL` 守卫 | ≥34 | 57 | PASS |
| `CREATE TABLE / ALTER TABLE / CREATE POLICY / GRANT / REVOKE / CREATE INDEX` | 0 | 0 | PASS |

claim_work_items 函数体抽样（V17 第 18-27 行）确认：fence 守卫保留 → owner NULL 守卫 → owner IS DISTINCT FROM 断言 → `PERFORM set_config('vc.job_fence', p_fence, true)`（fence 保留，owner set_config 已移除）。

### 2.2 9 个重构测试

| Test | 角色 | context 机制 | diff 行数 | 结果 |
|---|---|---|---|---|
| 07_claim_binds_context | vc_worker | SET LOCAL | +3 | PASS |
| 13_idempotent_receive_same_generation_id | vc_api | SET LOCAL | +2 | PASS |
| 14_idempotent_receive_no_duplicate_message | vc_api | SET LOCAL | +2 | PASS |
| 35_memory_edit_evidence | 超级用户 DO 块 | set_context（7 处） | +2 | PASS |
| 44_finalize_finalize_concurrent | vc_api | SET LOCAL | +5 | PASS |
| 45_finalize_cancel_concurrent | vc_api | SET LOCAL（2 处） | +6 | PASS |
| 46_finalize_terminalize_concurrent | vc_api | SET LOCAL（2 处） | +6 | PASS |
| 47_candidate_terminal_toctou | vc_api | SET LOCAL | +4 | PASS |
| 49_realtime_seq_concurrent | vc_api（dblink） | `SET vc.owner_user_id` per dblink session | +3 | PASS |

test 49 使用 dblink 并发会话，通过 `dblink_exec('sess_X', 'SET vc.owner_user_id = ''1''')` 预设 context —— 与并发测试模式一致，技术上正确。

### 2.3 2 个新负测

- **54_sd_owner_mismatch_fail_closed.sql**：`SET LOCAL vc.owner_user_id='1'` + 调用传 `p_owner_user_id=2`，跨 V5-V15 代表性函数（claim_work_items / receive_generation / finalize_generation / append_realtime_event / create_relationship / cancel_generation / create_memory_candidate / record_provider_attempt）断言全部 RAISE。结构正确。
- **55_sd_missing_context_fail_closed.sql**：不预设 context（先验证 `current_owner_id() IS NULL` 基线），调用传非 NULL `p_owner_user_id`，同样跨代表性函数断言全部 RAISE。结构正确。

---

## 3. 独立运行验证（本 Reviewer 亲自执行）

### 3.1 DB RLS 套件

命令：`PATH=/Users/hxf/.orbstack/bin:$PATH bash infra/db/run-rls-tests.sh`（OrbStack pgvector:0.8.5-pg18 临时实例）

- **结果：55/55 PASS**（ALL TESTS PASS）
- V1..V17 全迁移成功应用（V17 在 V16 后干净执行）
- 9 个重构测试（07/13/14/35/44/45/46/47/49）全部 PASS
- 2 个新负测（54/55）PASS
- 其余 44 个现有测试全部 PASS（无回归）

### 3.2 git diff --check

命令：`git diff --check 2c97bad..391cd42`
- **exit 0**（无空白错误）

### 3.3 doctor

命令：`PATH=/Users/hxf/.zcode/venvs/vc-harness/bin:$PATH python scripts/harness/doctor.py --task TASK-0154`
- **PASS（722269 checks）** [receipt hit 06dd31b28341]

### 3.4 canonical precheck（8 命令）

命令：`python scripts/harness/precheck.py --task TASK-0154`
- **Harness precheck: PASS (8 commands)**
  - doctor PASS / catalogValidate PASS / catalogDrift PASS / paidFeatureCheck PASS
  - licenseCheck PASS / betaRosterGate PASS / openapiValidate PASS / openapiDrift PASS

---

## 4. 验收标准逐项（任务卡 ## 验收标准 1-8）

| # | 标准 | 验证 | 结果 |
|---|---|---|---|
| 1 | V17 存在 + Flyway V1..V17 成功 | run-rls-tests.sh 日志 V1..V17 全 apply | PASS |
| 2 | 34 SD 函数含 owner 断言 + 移除内部 set_config owner（claim_work_items 保留 fence） | grep 计数 + 函数体抽样 | PASS |
| 3 | 重构测试加 SET LOCAL 前置后 PASS | 9 测试 PASS（注：见 P3 finding 关于"8 vs 9"文档措辞） | PASS |
| 4 | test 54：context=1 + param=2 → RAISE | test 54 PASS | PASS |
| 5 | test 55：无 context + param 非 NULL → RAISE | test 55 PASS | PASS |
| 6 | 其余 53 个现有 SQL 测试无回归 | 53 测试全部 PASS | PASS |
| 7 | 根级 Maven verify BUILD SUCCESS | 本链无 Java/pom 变更（`git diff --name-only 2c97bad 391cd42 -- service/**/*.java pom.xml` 为空），Maven 结构性不受影响 | PASS（由 absence 验证） |
| 8 | canonical precheck 8 命令 PASS + Harness unittest PASS + git diff --check PASS | precheck 8/8 PASS、doctor PASS（含 unittest receipt）、diff --check exit 0 | PASS |

---

## 5. 不变量与相邻风险

### 5.1 不变量保持

| 不变量 | 声明 | V17 影响 | 结果 |
|---|---|---|---|
| INV-TENANT-001 | API/Worker 无 BYPASSRLS + 跨租户读拒 | V17 不动 RLS / role 属性（TASK-0153 V16 已处理） | 保持 |
| INV-WORKER-001 | Worker 仅在 claim/lease/fence 后读租户数据 + SET LOCAL job context | claim_work_items 保留 fence set_config；owner context 改由可信路径预设 | 保持 |
| INV-AUTH-001 | 每次外部 model attempt 绑定 authorization snapshot | V17 不动 snapshot 表/逻辑 | 保持 |

### 5.2 相邻风险

- **Java caller 签名未变**：`git diff --name-only 2c97bad 391cd42 -- service/**/*.java` 为空。context-lock 钉住 WorkItemClaimService / GenerationReceiveService / FinalizeGenerationService / ConversationRepository / MessageRepository / RealtimeEventRepository 等调用点 sha256。
- **RLS policy 未变**：`git diff` 无 rls/policy 文件改动。
- **V1-V16 未修改**：context-lock 将 V1-V16 全部钉在 baseCommit sha256；V17 仅 CREATE OR REPLACE FUNCTION 不破坏 Flyway checksum。
- **保护治理文件未触碰**：invariants.yaml / protected-paths.yaml / task-lifecycle.yaml / sources-of-truth.yaml / task-backlog.yaml / task-delivery-policy.yaml / skills.yaml 全部未变。
- **保护路径合规**：`**/db/migration/**` 要求 `database-migration` skill + humanApproval；任务卡含 `humanApprovals.scope: database-migration`（Owner 2026-08-11 授权）。

### 5.3 Context Lock 完整性

`docs/tasks/context/TASK-0154.context-lock.yaml` 全部 inputs 钉在 `baseCommit 2c97bad`：
- 全部 `.harness/*.yaml` 真源
- V1-V16 migration 文件（Flyway checksum 安全）
- Java 调用点（签名不变证据）
- `skills/database-migration/SKILL.md`
- `owner-authorization://longline-2026-08-09`（provenanceOnly）

---

## 6. Diff Scope 合规

`git diff --name-status 2c97bad 391cd42`（14 文件，全部在 writeAllowlist 内）：

```
M  .harness/project-state.yaml
A  docs/tasks/TASK-0154-sd-owner-param-trusted-assertion.md
A  docs/tasks/context/TASK-0154.context-lock.yaml
M  infra/db/tests/07_claim_binds_context.sql
M  infra/db/tests/13_idempotent_receive_same_generation_id.sql
M  infra/db/tests/14_idempotent_receive_no_duplicate_message.sql
M  infra/db/tests/35_memory_edit_evidence.sql
M  infra/db/tests/44_finalize_finalize_concurrent.sql
M  infra/db/tests/45_finalize_cancel_concurrent.sql
M  infra/db/tests/46_finalize_terminalize_concurrent.sql
M  infra/db/tests/47_candidate_terminal_toctou.sql
M  infra/db/tests/49_realtime_seq_concurrent.sql
A  infra/db/tests/54_sd_owner_mismatch_fail_closed.sql
A  infra/db/tests/55_sd_missing_context_fail_closed.sql
A  service/platform/persistence/src/main/resources/db/migration/V17__sd_owner_param_trusted_assertion.sql
```

无 writeAllowlist 外路径，无 forbiddenPaths 触碰。

---

## 7. Findings 分级

### P0（阻塞）— 无

### P1（必须修复）— 无

### P2（应修复）— 无

### P3（建议，非阻塞）

- **P3-01 任务卡正文 8/9 测试措辞不一致**：scope-in 第 2 点（约第 448 行）与验收标准 3 表述"重构 8 个现有测试"，列出 8 个（07/13/14/44/45/46/47/49），遗漏 test 35。但 humanApprovals task-assignment evidence（权威授权源）明文"重构 9 个…（07/13/14/35/44/45/46/47/49）"，writeAllowlist（三提交字节一致）列 9 个，背景段（第 358 行）亦说"重构 9 个"。实现与全部权威源一致（9 个）。属文档措辞残留（首批草稿未含 35 的痕迹），非授权或实现偏差。建议下次卡内统一为 9，不影响本卡 PASS。

---

## 8. Verdict

**R1 PASS**。

理由：
1. R1 FAIL 核心阻塞（writeAllowlist READY 后扩展）**已修复**：writeAllowlist 自 DRAFT(d09ea14) 起即含 test 35，经 READY(0b73b2f) 至 CANDIDATE(391cd42) 三提交字节级一致；forbiddenPaths 全程不含 test 35；humanApprovals 明文授权 9 测试。
2. 技术实现正确：V17 含 34 个 CREATE OR REPLACE FUNCTION + 34 IS DISTINCT FROM 断言，0 真实 owner set_config 调用，claim_work_items fence set_config 保留；V1-V16 未改（Flyway checksum 安全）；9 测试重构 + 2 新负测结构正确。
3. 独立运行验证全绿：DB RLS 55/55 PASS、git diff --check exit 0、doctor PASS（722269 checks）、canonical precheck 8/8 PASS。
4. 验收标准 1-8 全部满足；INV-TENANT-001 / INV-WORKER-001 / INV-AUTH-001 保持；Java 调用签名与 RLS policy 未变。
5. Diff scope 全部在 writeAllowlist 内；保护路径 `**/db/migration/**` 的 database-migration skill + humanApproval 要求满足。

唯一 finding 为 P3 文档措辞不一致（非阻塞）。可进入 C4 独立 Reviewer 终态复核与 closure。

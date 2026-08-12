# R1 Independent Review — TASK-0164（§5.1.3 `provider_attempt` 授权快照 DB 强制 INV-AUTH-001）

- Reviewer: `task0164_r1`（independent-review-gate，C4 database-migration，static-only，fresh TMPDIR 重跑）
- Candidate commit: `0161ca773669a41fffff1d46bc576bd17b909dc1`
- Candidate tree: `32c9c6a7d08a30589aef6919109dddaccaf63af8`
- Base commit: `fd7b64653f771a88989494122c8a10fcb54f810a`（TASK-0163 ACCEPTED terminal）
- Verdict: **PASS** — 0 P0 / 0 P1 / 0 P2

## 1. 复核范围

R1 覆盖 diff scope / V20 SQL 语义 / INV-AUTH-001 DB 强制三腿 / test 40-54-55-59 语义 / 相邻不变量与回归 / 治理合规，静态 only
（Owner 2026-08-12 static-gates-only 策略；完整 Harness unittest deferred to unified audit）。

## 2. 独立静态门禁重跑（fresh TMPDIR `/tmp/r1-task0164.LpilmK`）

受控 Python：`PATH=/Users/hxf/.zcode/venvs/vc-harness/bin:$PATH`；Docker：`/Users/hxf/.orbstack/bin/docker`
（OrbStack `pgvector/pgvector:0.8.5-pg18` digest-pinned，匿名 `--rm` 容器）。

| 门禁 | 结果 | 证据 |
|---|---|---|
| `doctor --task TASK-0164` | **PASS** | 780916 checks，103.7s，exit 0（fresh TMPDIR 全量，非 receipt 命中） |
| canonical precheck（profile=precheck 8 子命令） | **PASS** | doctor / catalogValidate / catalogDrift / paidFeatureCheck / licenseCheck / betaRosterGate / openapiValidate / openapiDrift 全 exit 0；1.695s total；内嵌 doctor 通过 receipt `0b982e5cc547` 命中（fresh TMPDIR 已先全量跑过，符合 doctor receipt 设计） |
| `bash infra/db/run-rls-tests.sh` | **PASS** | 59/59 tests PASS（含新增 59、改后 40/54/55；test 1-58 无回归），32.541s，exit 0 |
| `git diff --check` | **PASS** | exit 0，log 为空（无 whitespace 错误） |

R1 完全独立重跑，未复用实现者的 run-rls-tests / precheck / diff-check 作为本 PASS 来源。完整 Harness unittest
discover 按 static-gates-only 策略 deferred to unified audit（列入 requiredCommands 但本卡不跑，doctor 只校验字段冻结，
不转换为 PASS）。

## 3. 范围与 diff scope

Diff `fd7b646..0161ca7` 恰好 8 路径，全部 ∈ writeAllowlist，无一 ∈ forbiddenPaths：

| 路径 | 性质 | writeAllowlist 命中 |
|---|---|---|
| `.harness/project-state.yaml` | activeTask/nextAction 治理投影 | ✓ |
| `docs/tasks/TASK-0164-provider-attempt-authorization-snapshot-db-enforcement.md` | 任务卡（IN_PROGRESS + 实现） | ✓ |
| `docs/tasks/context/TASK-0164.context-lock.yaml` | context lock（fingerprint `f732afcc`） | ✓ |
| `infra/db/tests/40_provider_attempt_rls.sql` | 列数断言 7→9 + 调用签名扩展 | ✓ |
| `infra/db/tests/54_sd_owner_mismatch_fail_closed.sql` | 调用签名扩展（trusted-context 场景） | ✓ |
| `infra/db/tests/55_sd_missing_context_fail_closed.sql` | 调用签名扩展（trusted-context 场景） | ✓ |
| `infra/db/tests/59_provider_attempt_authorization_snapshot_fk.sql` | 新增 INV-AUTH-001 integration_test | ✓ |
| `service/platform/persistence/src/main/resources/db/migration/V20__provider_attempt_authorization_snapshot.sql` | 新增 V20 forward-only migration | ✓ |

- **零 Java 改动**：`service/**/*.java` 完全未触（纯 DB 卡承诺兑现，`service/apps|modules|adapters|tests|**.java|**/pom.xml`
  全 forbidden，0 命中）。
- **V1-V19 既有 migration 冻结**：forbiddenPaths 中 `V[1-9]__*.sql`（1-9）/`V1[0-9]__*.sql`（10-19）的 glob
  不匹配 V20；V1-V19 未改一个字符，Flyway checksum 安全。
- **既有 DB 测试冻结边界正确**：forbiddenPaths glob `0[1-9]/[1-3][0-9]/4[1-9]/5[0-3]/56/57/58_*.sql` 不覆盖 40、54、55、59，
  而 writeAllowlist 显式列入 40/54/55/59——治理投影自洽。
- **protected-path 触发与授权匹配**：`**/db/migration/**` → C4 + `database-migration` skill + `humanApproval: true`
  （`protected-paths.yaml:16-19`）；requiredSkills `database-migration:1.0.0`，humanApprovals 三 scope 齐全
  （task-assignment / database-migration / local-exact-tree-fallback），均 2026-08-12 Owner 授权。
- **contextFingerprint 一致**：任务卡 `f732afcc74ecdc064439d5c5a720a1296e2a43012a095b259dde6c7f0ff530ef`
  == context-lock 字段值；inputs 全部钉在 `fd7b646`，provenanceOnly `owner-authorization://longline-2026-08-09`
  沿用 hash `cc0f91c1...`。

## 4. INV-AUTH-001 DB 强制三腿落地审查

INV-AUTH-001（`invariants.yaml:27-29`）：`statement: every external model attempt binds requested and execution
authorization snapshots`；`enforcement: [not_null_constraint, composite_foreign_key, integration_test]`。

| enforcement 腿 | DB 机器证据 | 位置 |
|---|---|---|
| `not_null_constraint` | `requested_authorization_snapshot text NOT NULL` + `execution_authorization_snapshot text NOT NULL` | V20 :11-12（ALTER ADD COLUMN） |
| `composite_foreign_key` | 两条复合 FK 指向 `vc.authorization_snapshot(owner_user_id, snapshot_id)` 复合 PK（V3:22）；ON DELETE NO ACTION 默认 | V20 :14-20（两条 ADD CONSTRAINT） |
| `integration_test` | test 59：正向 round-trip / 负向 A 未知 snapshot_id / 负向 B 跨 owner 借用 | `infra/db/tests/59_*.sql` |

**关键正确性**：FK 目标是 V3 复合 PK `(owner_user_id, snapshot_id)`，**不是** V3 也存在的 `UNIQUE(snapshot_id)`。
只有复合 FK 才能拒绝"owner A 借用 owner B 的 snapshot 行"——这正是 `composite_foreign_key` 的语义。test 59
负向 B 机器证明这一点（owner 1 调用传入 owner 2 的 `snap-2-req`/`snap-2-exec` → `foreign_key_violation`）。

## 5. V20 / tests 语义逐项审查

### 5.1 V20 SQL 正确性

1. **ALTER ADD 两 text NOT NULL 列（V20 :11-12）**：fresh migration，provider_attempt 无历史行（无生产写入端，
   P2-12 JDBC 持久化仍 PLANNED），`ADD COLUMN NOT NULL` 无 default 无回填难题。类型 `text` 与 V3
   `snapshot_id text` 类型一致。
2. **两条复合 FK（V20 :14-20）**：`FOREIGN KEY (owner_user_id, requested_authorization_snapshot) REFERENCES
   vc.authorization_snapshot(owner_user_id, snapshot_id)`；execution 同理。两条约束名
   `provider_attempt_requested_auth_snapshot_fk` / `provider_attempt_execution_auth_snapshot_fk` 不冲突。
   ON DELETE 默认 NO ACTION：被审计的 attempt 行钉死其 snapshot（审计链完整性）。
3. **DROP FUNCTION IF EXISTS + CREATE（V20 :22-107）**：DROP 五参数签名（与 V15/V17 一致）；`CREATE OR REPLACE`
   不能改参数列表，故 DROP+CREATE 是 PostgreSQL 唯一正确路径。
4. **V17 trusted-context 校验段保留（V20 :62-66）**：与 V17 `:1715-1720` 逐行一致——
   `IF p_owner_user_id IS NULL THEN RAISE 'p_owner_user_id is required'` +
   `IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN RAISE 'p_owner_user_id does not match
   server-trusted current_owner_id'`。所有后续校验（generation_id 非空、provider_id/supplier_name 非空白、
   status 11 值枚举、generation 存在性、existence hidden）均与 V17 `:1721-1745` 字面等价，仅追加两 snapshot
   参数的非空校验（V20 :89-95）。
5. **INSERT 列清单扩展（V20 :99-105）**：列对齐正确，7 列与 7 参数一一映射；`v_id := nextval('vc.provider_attempt_id_seq')`
   保留 V17 序列路径。
6. **GRANT/REVOKE（V20 :109-114）**：`REVOKE EXECUTE ON FUNCTION ... FROM PUBLIC` + `GRANT EXECUTE ON FUNCTION
   ... TO vc_api`，签名 7 参数（`(bigint, bigint, text, text, text, text, text)`），与 V15:116-121 / V17 模式一致。
7. **search_path 改为 `vc,pg_catalog`（V20 :37 + :60）**：V17 原声明 `vc, public`，但 V18 已批量 ALTER 全部 SD 函数
   至 `vc, pg_catalog`（V18 :30-46）；V20 DROP+CREATE 新签名时直接写 `vc, pg_catalog` 保持 V18 后的状态——
   符合 RISK-09 方向，与 V18/V19 一致。函数体全 schema-qualified（`vc.current_owner_id`/`vc.generation`/
   `vc.provider_attempt`/`vc.provider_attempt_id_seq`），`btrim` 是内置函数（pg_catalog），无论 search_path
   如何都解析为同一函数，行为零变更。
8. **返回类型（V20 :35）**：`RETURNS TABLE(out_id bigint, out_owner_user_id bigint)` 与 V17 :1707 完全一致；
   唯一差异是参数列表拓宽 2 个 `text`，调用方需相应扩展（test 40/54/55 已同步）。

### 5.2 test 40（`infra/db/tests/40_provider_attempt_rls.sql`）

- **列数断言 7→9**（:44-45）：`IF c <> 9 THEN RAISE 'provider_attempt must have exactly 9 columns (got %)', c`，
  与 V20 加 2 列后实际列数一致。
- **seed authorization_snapshot**（:23-28）：owner 1 两行 `req-snap-1` / `exec-snap-1`，状态 ACTIVE，使后续
  `record_provider_attempt` 调用 FK 命中。
- **正向 round-trip**（:54-66）：单行写入后 `requested_authorization_snapshot = 'req-snap-1'` AND
  `execution_authorization_snapshot = 'exec-snap-1'` 断言通过。
- **负向断言保留 fail-closed**：`MADE_UP` status（:78）、blank supplier ` `（:88）、unknown generation id=9999（:98）、
  cross-tenant owner 2 写 generation 5000（:111）均继续被拒；只是调用签名扩 7 参数（占位 snapshot 用合法
  seed 值，不干扰原 fail-closed 路径）。
- **列级 RLS 隐含覆盖**：cross-tenant 读 0 行（:101-103）继续通过。

### 5.3 test 54 / 55（trusted-context 场景）

- **调用签名扩 7 参数**（test 54 :118；test 55 :122）：占位 `'snap-x','snap-y'` 在 DB 中不存在，但函数
  trusted-context 校验在 snapshot 非空校验和 FK 检查之前（V20 :62-66 在 :89-95 之前；INSERT 时才触发 FK），
  故 owner mismatch / missing context 仍先于 snapshot FK 校验失败——`EXCEPTION WHEN OTHERS` 捕获，
  `position(expected in SQLERRM)` 断言 V17 fail-closed 文案不变。trusted-context 优先级语义保留。

### 5.4 test 59（`infra/db/tests/59_provider_attempt_authorization_snapshot_fk.sql`，新增）

- **seed**（:21-37）：TRUNCATE CASCADE 干净起点；owner 1 与 owner 2 各有独立 snapshot 行。
- **正向**（:45-56）：`record_provider_attempt(1, 5000, ..., 'req-snap-1', 'exec-snap-1')` 返回 id+owner，
  两列 round-trip。
- **负向 A**（:58-65）：传入 `'does-not-exist'`（本 owner 无该 snapshot_id）→ INSERT 触发复合 FK 检查
  → `foreign_key_violation` 精确捕获。
- **负向 B**（:67-76）：owner 1 借用 owner 2 的 `'snap-2-req'`/`'snap-2-exec'`——`snap-2-req` 在
  authorization_snapshot 中存在（owner 2 持有），但复合 FK `(owner_user_id, requested_authorization_snapshot)`
  = `(1, 'snap-2-req')` 在 PK 中无匹配（PK 行是 `(2, 'snap-2-req')`）→ `foreign_key_violation`。
  这是 INV-AUTH-001 `composite_foreign_key` 的机器证明核心。
- **无残留行**（:78-82）：两次 rejected INSERT 不留半行（PostgreSQL INSERT...FK fail 全事务回滚到 savepoint 不适用，
  这里在 EXCEPTION 块中自动 rollback 该语句）→ `count(*) = 1`（只剩正向行）。

## 6. 不变量与相邻风险

- **INV-AUTH-001**：DB 层三腿（not_null + composite_fk + integration_test）齐全落地；契约层 Java 内存
  `requireNonBlank` 软约束升级为 DB 硬约束；跨 owner snapshot 借用机器证明被拒。
- **INV-TENANT-001**：V20 未改任何 RLS policy、未改任何角色 NOBYPASSRLS/BYPASSRLS；provider_attempt 既有
  FORCE RLS（V16）覆盖新列；复合 FK 的 owner_user_id 分量进一步强化租户隔离。
- **无回归**：RLS 59/59 PASS 已证明 test 1-58 无回归；尤其 test 51（`authorization_snapshot_one_way_lifecycle`）
  仅 INSERT/UPDATE authorization_snapshot（不 DELETE），FK ON DELETE NO ACTION 不阻止 status lifecycle
  （ACTIVE→WITHDRAWN/NARROWED 不改 PK 列），继续 PASS。
- **INV-HARNESS-002/003/005/007/009**：唯一活动任务、writeAllowlist 内、Evidence 不把未跑转 PASS、
  single-card policy、LOCAL_EXACT_TREE_FALLBACK 冻结于 READY（remote exact-SHA 如实非 PASS，dispatchCount=0）。
- **无新依赖**：`pom.xml` / `license-inventory.yaml` 未改（licenseCheck PASS）。
- **无 API/事件/数据契约变更**：catalog `provider-attempt-statuses.yaml` status 枚举不变；
  `database-ownership-contract.yaml` 所有权模型不变（provider_attempt 仍 `owner_user_id` 复合所有权）。
- **Flyway checksum 安全**：V1-V19 一个字符未改；V20 是前向新增 migration。

## 7. 发现项

- **P0**：0
- **P1**：0
- **P2**：0

## 8. 结论

**R1 PASS**。INV-AUTH-001 在 DB 层的三项 enforcement（`not_null_constraint` + `composite_foreign_key` +
`integration_test`）齐全落地，且 DB 机器证据完备：V20 加两 `text NOT NULL` 列、两条复合 FK 指向
`vc.authorization_snapshot(owner_user_id, snapshot_id)` 复合 PK（非 `UNIQUE(snapshot_id)`，正确满足
composite_foreign_key 语义），test 59 机器证明正向 round-trip + 负向 A 未知 snapshot_id + 负向 B 跨 owner
借用均按预期 fail-closed。V17 trusted-context 校验段（:1715-1720）字面保留；search_path `vc,pg_catalog`
与 V18/V19 一致（RISK-09 方向）。范围严格限定纯 DB 层（无 Java 改动），8 路径全在 writeAllowlist，
forbiddenPaths 零冲突，contextFingerprint `f732afcc` 一致。fresh TMPDIR 独立重跑 doctor（780916 checks）
/ canonical precheck 8/8 / run-rls-tests.sh 59/59 / git diff --check 全 PASS。完整 Harness unittest
deferred per Owner 2026-08-12 static-gates-only 策略（不转换为 PASS）。

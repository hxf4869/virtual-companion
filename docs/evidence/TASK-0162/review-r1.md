# TASK-0162 R1 独立静态复核

## 候选身份

- taskId: TASK-0162（P2-13 admin seed 并发保护）
- baseCommit: `0e0fd69bf9c506b38443b455554862ba83e1153f`（TASK-0158 ACCEPTED terminal）
- candidateCommit: `1d2be92d62c3e4b7d32c75faffdef78d4436ae44`（IN_PROGRESS + 实现）
- candidateTree: `4b13062a98030c28718459aacdc7e4683c18faff`
- authorizationCommit: `4b06b5e95c050c6995297f9f92ecb0bb5f04d8e8`
- riskClass: C4（`**/db/migration/**` → database-migration + humanApproval）

## 独立重跑门禁（fresh TMPDIR，不复用 impl 阶段结果）

| 门禁 | 结果 |
|---|---|
| canonical precheck 8/8 | **PASS**（doctor 769584 checks / 113.6s；paidFeature/license/catalog×2/openapi×2/betaRoster 全 PASS） |
| run-rls-tests.sh | **PASS** 58/58（V1..V19 应用 + 含新增 `58_admin_seed_concurrent.sql`） |
| git diff --check | exit 0（worktree clean + base..candidate 无 whitespace 问题） |

## Diff Scope（base..candidate，5 文件全在 writeAllowlist）

| 文件 | 性质 |
|---|---|
| `service/.../V19__admin_seed_concurrency_guard.sql` | 新增（~70 行） |
| `infra/db/tests/58_admin_seed_concurrent.sql` | 新增（~85 行） |
| `docs/tasks/TASK-0162-p2-13-admin-seed-concurrency-guard.md` | 新增任务卡 |
| `docs/tasks/context/TASK-0162.context-lock.yaml` | 新增 context lock |
| `.harness/project-state.yaml` | activeTask/activeTaskCard/nextAction（READY 同步） |

无路径越界；`writeAllowlist` ∩ `forbiddenPaths` = ∅（doctor 硬校验 PASS）。

## 静态审查

### V19 函数体与 V14 等价性

`CREATE OR REPLACE FUNCTION vc.identity_admin_seed(p_username text, p_password_hash
text, p_display_name text) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER`。
与 V14 line 359-396 逐行对比，差异仅两处：

1. **`SET search_path = vc, pg_catalog`**（V14 为 `vc, public`）——与 V18（TASK-0158）全部 37 个 SD
   函数收紧一致，消除 public 项；语义无害（函数体内全部对象已用 `vc.` 显式限定）。
2. **新增 `PERFORM pg_advisory_xact_lock(hashtext('vc.identity_admin_seed.bootstrap'));`**（在
   password 非空校验之后、`SELECT ... WHERE role='ADMIN'` 之前）——事务级锁，事务结束自动释放，
   无跨事务残留、无死锁面（单锁无嵌套）。

DECLARE（`v_username := lower(btrim(p_username))`、`v_account_id bigint`）、username/password 非空
校验、`SELECT id ... WHERE role='ADMIN' ORDER BY id LIMIT 1` + `IF FOUND THEN RETURN`、`nextval +
INSERT vc_user + identity_account + identity_auth_event('ACCOUNT_CREATE') + RETURN` 逻辑与 V14 **完全
等价**。签名/参数类型/返回类型/SECURITY DEFINER/LANGUAGE 不变；`CREATE OR REPLACE` 保留 V14 既有的
`GRANT EXECUTE TO vc_api` 与 `REVOKE FROM PUBLIC`（PG 语义：CREATE OR REPLACE 不改变权限）。

advisory lock key `hashtext('vc.identity_admin_seed.bootstrap')` 与既有 `hashtext('vc.relationship.active:'||owner)`
（V9/V17）字符串不同，无 key 冲突。

**方案正确性**：未采用 `partial unique index WHERE role='ADMIN'`，因为 `identity_account_create`
（V14 line 305-350）允许 ACTIVE ADMIN 经 `/admin/accounts` API 创建第二个 ADMIN（role 接受 'ADMIN'，
line 331）；partial index 会破坏该能力。advisory lock 语义中立，只串行化 bootstrap check-then-insert，
不限制 ADMIN 总数，对"single bootstrap + 之后可经 API 增加 ADMIN"的现有语义零变更。

### V1-V18 未改（Flyway checksum 安全）

`git diff --name-only base..HEAD -- .../db/migration/` 仅 V19。V1-V18 历史冻结。

### test 58 正确性

`infra/db/tests/58_admin_seed_concurrent.sql` 参照 test 48 dblink 模式：
- TRUNCATE identity 相关表（CASCADE）。
- `dblink_connect` 两独立 session（sess_a/sess_b）。
- `dblink_send_query` 让两 session **同时**调用 `vc.identity_admin_seed`（不同 username
  race-admin-a/race-admin-b），`dblink_get_result` 收集返回值。
- 断言：两返回值非空且相同；`count(ADMIN)=1`；winner 是两 username 之一；vc_user ownership root 存在；
  ACCOUNT_CREATE audit 恰好一次；`dblink_disconnect` 清理。

验证 advisory lock 在真实并发下串行化 check-then-insert（无 lock 时并发可产生 count=2）。

### protected-path / Skill / humanApproval

- `**/db/migration/**` → database-migration C4 + humanApproval：任务卡声明 `requiredSkill:
  database-migration(1.0.0)` + `humanApprovals: scope: database-migration`。✓
- C4 独立 Reviewer：本 R1 即独立 review-gate（static-gates-only，不跑完整 unittest discover）。✓
- `forbiddenPaths` 覆盖 V1-V18（`V[1-9]__*.sql` + `V1[0-8]__*.sql`）与 test 01-57（`[0-4][0-9]_*.sql`
  + `5[0-7]_*.sql`），历史卡/evidence/handoffs/治理文件全覆盖；本卡（0162）不在 forbidden。✓

## P0/P1/P2 清单

- **P0**（安全/数据丢失/越权）：0。advisory lock 只增不改语义；不改 RLS/GRANT/角色/表结构；不接触用户数据。
- **P1**（正确性/状态机/并发）：0。函数体等价；advisory lock 正确串行化 bootstrap；test 58 机器证明并发下
  count(ADMIN)=1 + 相同 id；不改变 idempotent 语义。
- **P2**（质量/可维护性）：0。V19 注释充分解释方案与 partial-index 取舍；test 58 覆盖 winner/loser/audit/ownership。

## 非 static-gates 部分（如实标注）

完整 Harness unittest discover（35-45 min）按 Owner 2026-08-12 static-gates-only 策略 **deferred
to unified audit**，本卡不跑（`requiredCommands` 列入但 Evidence 标注 deferred，不转换为 PASS）。
DB 行为由 run-rls-tests.sh 58 测试（含 test 58 真并发）直接验证。

remote exact-SHA 通道仍配额耗尽（dispatchCount=0）；LOCAL_EXACT_TREE_FALLBACK 冻结于 READY，限于
macOS 本地候选（doctor + canonical + run-rls-tests + git diff --check）。

## Verdict

**PASS** —— 0 P0/P1/P2。独立重跑全部静态门禁 PASS（canonical 8/8、run-rls-tests 58/58、git diff --check
exit 0）。V19 是前向新增 migration（不改 V1-V18），仅给 identity_admin_seed 加事务级 advisory lock
串行化 bootstrap check-then-insert；test 58 用 dblink 两 session 真并发机器证明单 bootstrap ADMIN
在并发下唯一确定。advisory lock 方案经代码分析确认对"single bootstrap + API 可增 ADMIN"语义零变更。
完整 unittest deferred per Owner static-gates-only 策略。

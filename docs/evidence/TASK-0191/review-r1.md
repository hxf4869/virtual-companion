# TASK-0191 C4 独立复核 R1（REJECTED 诚实闭合）

```yaml
reviewer: independent-review-gate
reviewDate: "2026-08-13"
reviewedCommit: 8f08bb1d197c2787d91080aa33684a8444b8b7b0
taskId: TASK-0191
candidateState: REJECTED
verdict: APPROVE
```

## 结论

**APPROVE**：同意 TASK-0191 以真实结果闭合为 **REJECTED**，不得描述为 ACCEPTED。
无 P0/P1/P2 阻断项。REJECTED 的根因（amendment 按
`validate_amendment_introduction` 必须原子包含 backlog，而 `validate_diff_scope`
联合检查将该边 backlog 计入任务 diff-scope，卡冻结 forbiddenPaths 含 backlog；
`00_owner_binding_secret_seed.sql` 为 READY 冻结遗漏）经独立复核属实，且未发现
任何将 FAIL/NOT_RUN 伪装为 PASS 的迹象。实现本身（V27 密码学绑定、运行时适配、
测试）经抽查与独立重跑均正确。

## 逐项核验结果

| # | 必查项 | 结果 | 独立依据 |
|---|--------|------|----------|
| 1 | 诚实性：无伪装 PASS、工作树干净 | **PASS** | `git status` 工作树干净；范围 3c7fd0b..8f08bb1 恰 8 个提交，逐条提交信息（含全文）无 precheck PASS/ACCEPTED 声明；`docs/evidence/TASK-0191/` 此前不存在（无伪造证据包）；ledger 无 TASK-0191 条目（终态提交时才追加）；全 diff 密钥扫描仅命中确定性测试固定值（测试源码与 00-seed fixture），无真实凭据 |
| 2 | 实现正确性抽查 | **PASS** | V27：域分离四元绑定 `vc-owner-binding-v1\|owner\|pg_backend_pid()\|pg_current_xact_id()\|nonce`；`current_owner_id()` SECURITY DEFINER 每调用重算 HMAC、任一缺失/不匹配返回 NULL fail-closed；`begin_job_context` REVOKE PUBLIC+四 runtime 角色；`_owner_binding_expected/_message` 双 REVOKE（防 minting-oracle）；迁移末尾 DO 块对 4 角色+PUBLIC 逐项 fail-closed 断言；V27 全文无密钥明文。`OwnerContext.java`：proof 进程内计算，异常/日志固定文案不含秘密与 proof；nonce=SecureRandom 16 字节；常量时间比较。`OwnerBindingSecretBootstrap.java`：JDBC 参数绑定幂等 INSERT ON CONFLICT DO NOTHING + 读回 `MessageDigest.isEqual` 常量时间校验，异常不含密钥；`AuthDataSourceConfig` FlywayMigrationStrategy 在 migrate() 后、业务/readiness 前执行；application.yaml 生产 profile `owner-binding-secret: ${VC_OWNER_BINDING_SECRET}`（无默认，缺失启动失败）。新测试 69-73 关键断言在真实 runtime 角色下执行（抽查 69/71/72） |
| 3 | amendment 合规 | **PASS** | 2668949 单父恰为 3fe5244；`git diff --name-only 3fe5244 2668949` 恰 6 路径（backlog+卡+4 新增路径）；backlog `authorizationAmendments.owner-amendment-20260813-task-0191-scope-01` 与卡 `scopeAmendments[0].contract` 逐字一致（dict 相等）；用 harness venv 导入 `doctor.canonical_json_sha256` 计算 contract → **e97473f95395a12638d04bcd41d192563b5c1d2ef7bbb8177a81ef8c025675a0** = 卡 contractHash ✓；`authorizedParentCommit` 绑定正确；doctor 的 `validate_amendment_introduction` 通过（错误仅限 3 条 diff-scope，无 amendment 错误） |
| 4 | 验证真实性（独立重跑） | **PASS** | 独立重跑 mvn：`JAVA_HOME=...openjdk@25... ./mvnw --batch-mode --no-transfer-progress -pl service/apps/runtime -am test` → **340/340，BUILD SUCCESS，exit 0**；独立重跑 doctor：`PATH=...vc-harness/bin:$PATH python scripts/harness/doctor.py --task TASK-0191` → **exit 1，恰 3 errors（882594 checks）**：`.harness/task-backlog.yaml` outside writeAllowlist ×2 + `infra/db/tests/00_owner_binding_secret_seed.sql` outside writeAllowlist，无其它错误；独立重跑 canonical precheck → **exit 1，FAIL（1 commands）**，其余 7 项（licenseCheck/catalogValidate/catalogDrift/paidFeatureCheck/openapiValidate/openapiDrift/betaRosterGate）全 PASS；独立重跑 RLS：`bash infra/db/run-rls-tests.sh` → **74 PASS / 0 FAIL / ALL TESTS PASS**，与 /tmp/rls-final3.log 一致；`git diff --check 3c7fd0b 8f08bb1` → **exit 0** |
| 5 | 范围事实 | **PASS** | `git diff --name-only 3c7fd0b 8f08bb1` 共 74 路径，每个 ∈ 卡 writeAllowlist(71) ∪ amendment 4 路径，例外**恰为** `.harness/task-backlog.yaml` 与 `infra/db/tests/00_owner_binding_secret_seed.sql`（即 doctor 报的两条）；变更 migration 仅 V27 一个；V1-V26 与历史任务制品（TASK-0184/0189/0190 evidence/handoff、decisions、planning、specs、scripts、skills、ci、frontend）零修改 |
| 6 | REJECTED 依据 | **PASS** | canonical precheck 独立重跑真实非零（doctor exit 1，3 errors）→ 依策略不得 ACCEPTED；卡验收标准 2「requiredCommands 四条以同一候选 SHA 真实 PASS」未满足 → REJECTED 为正确终态。根因独立核验：卡 forbiddenPaths 含 `.harness/task-backlog.yaml`（第 234 行），而 `validate_amendment_introduction`（doctor.py:4234-4304）要求 amendment 提交原子引入 Backlog 合同 → 该边路径合法但被 diff-scope 联合检查判为 forbidden；对照先例 TASK-0037（writeAllowlist 第 39 行含 backlog）未触发；00-seed 不在 READY 冻结 writeAllowlist（71 路径逐条核对）→ READY 冻结遗漏属实 |

## 附加观察（非阻断）

- `infra/db/tests/00_owner_binding_secret_seed.sql` 含固定测试密钥
  `vc-test-owner-binding-secret-0123456789abcdef`（43 字节 ≥32），文件头与 DO 块
  明确标注 test-only、匿名 `--rm` 容器、幂等重种；属治理范围遗漏（freeze
  omission），不构成安全缺陷，与 REJECTED 根因同源。
- RLS 日志中的 ledger schema-incomplete WARN（TASK-0177..0182）为历史条目
  预存在告警，非本任务引入。

## Reviewer 独立性声明

本 reviewer（independent-review-gate）与 TASK-0191 实现者独立：全部判定基于
仓库当前 HEAD 8f08bb1 的独立命令执行（git 对象读取、harness venv 导入 doctor
校验、mvn/doctor/precheck/RLS/git diff --check 五次独立重跑）与源代码阅读，
未采信实现者口头结论；除本文件 `docs/evidence/TASK-0191/review-r1.md`（卡
writeAllowlist 授权路径）外未修改任何文件；未与实现者共享执行环境或结果。

# C4 独立治理复核 — TASK-0193 review-r1

- Reviewer：independent-review-gate（C4 独立治理 Reviewer，与实现者完全独立）
- 复核日期：2026-08-14
- 被审提交（候选 HEAD）：`1d2cf97f084c4afad75abdd65621482aae859dc1`（tree 986925437c96664210fe5fe2e4a386afffe14a89）
- 被审范围：TASK-0193（inherited-state adoption/verification：TASK-0191 继承实现的正式接纳）
- 提交链：`9a9c77c`（TASK-0192 ACCEPTED 终态，base）→ `ed02c4d` DRAFT → `c5b379d` READY → `d64f2de` bind → `1d2cf97` IN_PROGRESS

## 独立性声明

本 Reviewer 与实现者相互独立：未采信实现者的任何结论（包括其提交信息中的 PASS 声明），全部事实均在本会话中从 git 对象（`rev-parse`/`ls-tree`/`log`/`diff`/`show`）、源码（V27 migration、OwnerContext.java、OwnerBindingSecretBootstrap.java、AuthDataSourceConfig.java、application.yaml、测试 00/69-73、Java 测试）与任务卡 YAML 机器绑定独立重新推导；四条冻结验收命令在本会话全部独立重跑并记录真实退出码。除本报告文本外未写任何文件（运行期间工作树保持 clean，`git status --porcelain` 为空）。

## 逐项结果

### A. 继承 manifest 独立核对 — PASS

- 启动核对：`git rev-parse HEAD` = `1d2cf97f084c4afad75abdd65621482aae859dc1`，与候选 SHA 精确相等（不等则 P0，未触发）。
- `git diff --name-only 3c7fd0b5… 2abc531b…` 总路径数 = **78**（`wc -l` 实测）。
- 卡 `governanceExcludedPaths` 恰 8 个 TASK-0191 治理路径，逐项在 78 路径 diff 内；排除后恰 **70** 路径，与卡 `inheritedStateManifest.paths` 70 项集合**完全相等**（脚本 `set(inherited) == set(manifest)` 断言通过）。
- 对 70 路径逐项 `git ls-tree 9a9c77c -- <path>`：**70/70 mode=100644、blob 与卡逐项一致**（零 mismatch）。
- **orderedPathSetSha256 独立重算 = `b9f027776723d4c5803d1e02991c9669ee37a23756b8ea430936142626b16615`**，与卡声明一致（sha256(每个 sorted path 后跟 LF 的串接)）。
- **manifestSha256 独立重算 = `d19579012582dd565648fbd899499c3a8e52597fe18280c4ef90c407bdf4629a`**，与卡一致（按卡 manifestCanonicalization 逐字规则：json.dumps({algorithm, baseCommit:adoptionBase, paths:entries}, ensure_ascii=False, sort_keys=True, separators=(",",":"))，entries 为 {blob, mode:"100644", path} 按 path 排序）。
- `git rev-parse 2abc531^{tree}` = `d60e437be565221344e67d59cc182b08328aff84`、`9a9c77c^{tree}` = `7e2dd00183e2838c27d9dc0ed3f2ce8169eb5c29`，均与卡一致。
- 零漂移：70 路径在 `2abc531` 与 `9a9c77c` 的 `ls-tree` 输出**逐项相同**（70/70，无任何路径漂移）。
- 提交链单父关系（`git log --format='%H %P'` 实测）：`3fe5244` → `2668949`（父 3fe5244，amendment）→ `bfc6a62`（父 2668949，实现）→ `8f08bb1`（父 bfc6a62，修复）→ `2abc531`（父 8f08bb1，REJECTED 终态），每边恰一个父。

### B. 继承实现安全审查（3c7fd0b..2abc531 业务范围，实读源码）— PASS，无 P0/P1

**V27__owner_context_cryptographic_binding.sql**（实读全文 282 行）：
- 域分离四元绑定成立：`proof = HMAC-SHA256(K, 'vc-owner-binding-v1|' || owner || '|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || nonce)`；三个 GUC 均 `set_config(..., true)` transaction-local。
- `current_owner_id()` 每调用重校验完整 tuple（owner/nonce/proof GUC 任一缺失、key 行缺失、`_owner_binding_expected` 重算不匹配、非法 bigint 转换均返回 NULL，fail-closed），是全部 RLS/V17 断言唯一信任根。
- `set_owner_context` 服务端重算证明：先校验 owner>0、nonce 1..256、proof 恰 64 hex、key 已初始化，**证明通过后才写任何 GUC**。
- `begin_job_context` EXECUTE 从 PUBLIC + 全部 4 个 runtime 角色双 REVOKE（定义保留冻结）。
- `_owner_binding_secret` 表 REVOKE ALL（PUBLIC + 4 runtime 角色），migration 内**无任何密钥明文**（由 OwnerBindingSecretBootstrap 以绑定参数初始化）。
- `_owner_binding_expected`/`_owner_binding_message` EXECUTE 全部撤销（不成 minting oracle）；末尾 DO 块 fail-closed 断言 4 角色与 PUBLIC 的所有关键权限边。
- 注：PG 18 镜像（pgvector/pgvector:0.8.5-pg18）支持 `pg_current_xact_id()`。

**OwnerContext.java**：HMAC proof 消息与 DB 端 `_owner_binding_message` 逐字节一致（`BINDING_DOMAIN="vc-owner-binding-v1"`，owner/pid/xact/nonce 拼接次序与格式相同，pid/xact 取自 `SELECT pg_backend_pid(), pg_current_xact_id()::text` 同会话查询）；nonce 每次调用由 SecureRandom 生成 16 字节（hex 32）；`proofFor` 异常仅报 "owner binding proof computation failed"，不携带 secret/proof；构造器拒绝 null/空白/<32 字节 secret。

**OwnerBindingSecretBootstrap.java + application.yaml**：绑定参数 `INSERT … ON CONFLICT DO NOTHING` + 读回 `MessageDigest.isEqual` 常量时间比对，缺失/不一致 → `IllegalStateException` 启动失败；SQLException 包装仅含异常类名，无任何值；production profile 下 `owner-binding-secret` **无默认值**（占位符解析失败即启动失败，fail-closed，与 jwt/migrator 同模式）；FlywayMigrationStrategy 先 `migrate()` 再 `initializeAndVerify()`，早于 readiness。

**测试 69-73 与 00 seed**（全部关键断言在真实 runtime 角色下执行，superuser 仅 fixture）：69 直接 SET GUC → NULL + 0 行（vc_api/vc_worker）；70 垃圾 proof/跨 owner 篡改/篡改 nonce 全部失败关闭；72 跨 owner 重放（establisher 重算拒绝）、跨事务重放（xact id 绑定）、跨 backend 重放（pid+1 失败）、合法路径成功 + 恰见 1 行 + 对端租户不可见 + 畸形输入拒绝后无残留上下文；71 `begin_job_context` 四角色 SQLSTATE 42501 + catalog 断言；73 secret 表 SELECT/INSERT/UPDATE/DELETE 四角色与 PUBLIC 全拒 + 活体 42501 探针 + mint helper EXECUTE 全拒；00 固定 test-only 密钥幂等 seed（>=32 字节，fail-closed 校验）。Java 测试：`OwnerBindingSecretBootstrapTest`（null/空/过短/不一致 → ISE）、`OwnerContextTest`（proof 不含密钥、nonce 随机、消息格式）、`ProductionProfileFailClosedTest`（production 缺开关/缺 secret 启动失败）覆盖矩阵其余项。**Owner 要求的安全矩阵 11 项全部有实证覆盖**。

### C. TASK-0193 治理 diff 审查 — PASS

- `git diff --name-only 9a9c77c 1d2cf97` 恰 3 文件：`.harness/project-state.yaml`、任务卡、context lock。
- 逐提交父边路径集（`git diff --name-only` 逐对实测）：
  - `9a9c77c..ed02c4d`（DRAFT）：卡 + context lock（91 行新建）；
  - `ed02c4d..c5b379d`（READY）：project-state（8 行）+ 卡（2 行，state DRAFT→READY）；
  - `c5b379d..d64f2de`（bind）：仅卡；
  - `d64f2de..1d2cf97`（IN_PROGRESS）：仅卡（state READY→IN_PROGRESS）。
- 链 `9a9c77c→ed02c4d→c5b379d→d64f2de→1d2cf97` 全单父；`authorizationCommit=c5b379d503b0cda9e126b990512e2344b10a8528` 是 Base 后**首个 READY 单父提交**，与卡字段一致，bind 提交 d64f2de 显式记录。
- project-state（c5b379d 处实测）：`activeTask: TASK-0193`、`lastAcceptedTask: TASK-0192`、`lastTerminalTask: TASK-0192`、nextAction 与卡 READY 动作逐字同步。
- writeAllowlist 共 76 项 = **70 个精确继承路径（零 glob）** + 5 个本卡治理路径（卡/context lock/project-state/task-ledger/handoff）+ 1 个 `docs/evidence/TASK-0193/**`（本卡证据输出目录，非继承路径）；70 路径全部在列、无额外精确路径。
- forbiddenPaths 76 项含 **V1–V26 全部 26 个 migration**、TASK-0191/0192 全部卡/context lock/evidence/handoff 制品；`writeAllowlist ∩ forbiddenPaths = ∅`（脚本断言）。
- 未修改任何 70 继承路径（B 段零漂移已证；治理链上 70 路径零触碰）。
- `doctor --task TASK-0193` 独立可复跑（见 D-1，PASS exit 0）。

### D. 独立重跑四条冻结验收命令（HEAD=1d2cf97，真实退出码）— PASS

1. `PATH=/Users/hxf/.zcode/venvs/vc-harness/bin:$PATH python scripts/harness/precheck.py --task TASK-0193` → **exit 0**，8 commands 全 PASS（doctor PASS 892570 checks、licenseCheck PASS 72 deps、catalogValidate/catalogDrift、openapiValidate/openapiDrift、paidFeatureCheck、betaRosterGate CLOSED）。
2. `JAVA_HOME=…openjdk@25… ./mvnw --batch-mode --no-transfer-progress -pl service/apps/runtime -am test` → **exit 0**，BUILD SUCCESS；全 reactor **Tests run=1356, Failures=0, Errors=0, Skipped=0**（runtime 模块 340）。
3. `bash infra/db/run-rls-tests.sh` → **exit 0**，**74 个 PASS**，尾部 "ALL TESTS PASS"（含 69–73 全绿）。
4. `git diff --check` → **exit 0**（工作树 clean）。

## 发现清单

- **P0：无。**
- **P1：无。**
- **P2：无。**
- **P3（不阻塞，建议后续记录）**：
  1. V27 `set_owner_context` 内 proof 比较为普通 `<>`（非常量时间）；256-bit HMAC 密钥下无实用利用面，且失败仅抛泛化异常、无部分匹配 oracle。
  2. V27 末尾 DO 块仅断言 secret 表 SELECT 权限边（INSERT/UPDATE/DELETE 由已执行的 REVOKE ALL 覆盖，且测试 73 活体断言四项齐全）。
  3. `OwnerBindingSecretBootstrap.initializeAndVerify` 以 US_ASCII 字节比对读回值：非 ASCII secret 会触发启动失败（fail-closed 方向），构造器已强制 >=32 UTF-8 字节。
  4. 信息项：`current_owner_id` 保留 PUBLIC EXECUTE（设计使然——纯校验信任根，只返回 NULL 或 owner，不暴露 proof/secret）。

## 总结裁决：**APPROVE**

逐条理由：
1. HEAD 与候选 SHA 精确一致；A 段 78/8/70、逐路径 mode/blob、两个 hash、两棵树、提交链与零漂移全部独立重算吻合，manifest 机器绑定无任何漂移。
2. B 段实际代码审查确认域分离四元绑定、每调用重校验、服务端重算、双 REVOKE、零权限秘密表与 fail-closed 启动语义均按 Owner 批准的安全矩阵实现并有真实 runtime 角色测试实证，未发现 P0/P1 安全缺陷（仅 4 项 P3 性质观察）。
3. C 段治理 diff 仅含卡/context lock/project-state 三个授权文件，逐提交单父、状态迁移 DRAFT→READY→READY(bind)→IN_PROGRESS 正确，authorizationCommit 为 Base 后首个 READY 提交，writeAllowlist 恰为 70 精确路径 + 本卡治理路径且与 forbidden 无冲突，V1-V26 与 TASK-0191/0192 历史制品零修改。
4. D 段四条冻结验收命令在同一真实候选 SHA 上全部 PASS（exit 0 / 0 / 0 / 0；8 commands、1356 tests、74 RLS PASS），证据与卡验收标准 1-5 相符，TASK-0191 保持 REJECTED 未被顺带改写。
5. 无推送、无合并、无历史改写；worktree 复核前后均 clean。

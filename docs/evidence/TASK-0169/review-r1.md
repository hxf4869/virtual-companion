# TASK-0169 R1 独立复核

- **Verdict: PASS**
- **Reviewer Role**：独立 R1 Reviewer（fork_turns=none，无任务历史上下文，全程只读，未修改仓库任何文件）
- **复核模式**：Owner 2026-08-12 acceleration static-gates-only——仅语义审查（读候选 diff + 静态判断 + 引用实现者已跑的 mvn runtime / canonical precheck 结果），不 fresh TMPDIR 重跑；完整 unittest + 根级 Maven verify deferred to 统一全项目复审
- **复核时间**：2026-08-12
- **候选**：`2eaa9843da1402ddff0784efe4c2a88399f9505b`（tree `d4b7377588accf20f4cd86ca7c3ac652794d7f9d`），单父 68ebf2e，工作树 clean
- **Base**：`fe1341253bec6b42c8053d1924ed40634c6221c3`（TASK-0168 ACCEPTED terminal）

## 候选身份核对

| 项 | 声明 | 实测 | 结果 |
|---|---|---|---|
| 候选 Commit | `2eaa984…` | `git rev-parse HEAD` = 2eaa984… | PASS |
| 候选 Tree | `d4b73775…` | `git rev-parse 2eaa984^{tree}` = d4b73775… | PASS |
| Base | `fe13412…` | fe13412 是 2eaa984 祖先 | PASS |
| 提交链 | c5b2b3c DRAFT → cb1ab5a READY → 68ebf2e 绑定 → 2eaa984 IN_PROGRESS+实现 | 每提交单父，线性无 merge | PASS |
| 工作树 | clean | `git status --porcelain` 空 | PASS |

## 静态门禁（引用实现者已跑结果）

| # | 命令 | 退出码 | 结果 | 关键输出 |
|---|------|--------|------|----------|
| 1 | `git diff --check fe13412..2eaa984` | 0 | **PASS** | 输出空 |
| 2 | `python scripts/harness/precheck.py --task TASK-0169`（canonical，8 子命令） | 0 | **PASS 8/8** | doctor PASS（809949 checks，122.6s）；licenseCheck/catalogValidate/catalogDrift/paidFeatureCheck/betaRosterGate/openapiValidate/openapiDrift 全 PASS |
| 3 | `mvn -pl service/apps/runtime -am test`（JDK 25） | 0 | **BUILD SUCCESS** | 238 tests 0 失败 0 skip（基线 234 + 3 AuthServiceTest 策略矩阵 + 1 AuthControllerValidationTest Bean Validation） |

## 矩阵核对

**A. writeAllowlist / forbiddenPaths / diff scope（PASS）**：候选 diff（base..HEAD）7 文件全部在 writeAllowlist 内：
`.harness/project-state.yaml`（M，activeTask/nextAction 状态字段）、`docs/tasks/TASK-0169-*.md`（A）、
`docs/tasks/context/TASK-0169.context-lock.yaml`（A）、`AuthService.java`（M）、`AuthRequests.java`（M）、
`AuthServiceTest.java`（M）、`AuthControllerValidationTest.java`（M）。forbiddenPaths 零触碰
（V1..V21、.harness 治理文件、scripts/harness、specs、infra/db、service/modules|adapters|tests|platform、
auth/config|jwt|tenant、baseline、modelruntime、resources、pom 全部未动）。doctor selected-task diff scope PASS 实证。

**B. context fingerprint（PASS）**：contextFingerprint `2c16e275cc90479fc611d86c62f2492a4180b8b7ca0532e44d3b5bd1445083f5`，
46 inputs（45 readAllowlist + 1 provenanceOnly `owner-authorization://longline-2026-08-09` 用固定 hash `cc0f91c1…`）。
算法 SHA256_ORDINAL_SORTED_PATH_EQUALS_HASH_LF_V1；实现者脚本先自验复现 TASK-0168 的 `0d74dd3f…`（MATCH=True），
再生成本卡；canonical doctor 子命令校验通过。

**C. 技术复核（PASS）**：

- `AuthService.validatePasswordPolicy`：先 `length < 8 → invalidRequestError()`；再逐字符 `Character.isUpperCase/isLowerCase/isDigit` 分类
  （else=符号=任何非字母非数字），四类 `uppercase && lowercase && digit && symbol` 不全 → `invalidRequestError()`。复用既有
  非泄露 400 `INVALID_REQUEST`（固定消息），不区分缺哪一类，无枚举侧信道。密码是创建时攻击者自选（非被验证的 secret），
  无 secret-dependent timing 风险。调用点保证 password 非 null/非 blank/在字节与字符上限内（前置 if-block 已校验），无 NPE。
- `validateAccountInput`（createAccount 路径）：既有 null/blank/byte/max 校验通过后调用 `validatePasswordPolicy(password)`，
  位于方法末尾。createAccount 先校验 principal role（非 ADMIN → 403 ACCESS_DENIED，line 170），策略只对 ADMIN 创建路径生效。
- `seedAdmin`：既有 absent-return-0（canonicalUsername/password/displayName 任一 blank → return 0）与 byte/max 校验通过后、
  `validateNormalizedInput` 之前调用 `validatePasswordPolicy(password)`。blank 密码仍 return 0（策略不触发），既有
  `seedAdminIsSkippedWhenCredentialsAbsent` 行为不变。
- `validateLoginInput` 未改：login 只认证既有账号、不校验密码强度；既有弱密码账号登录与全部 login/refresh 测试不受影响。
- `AuthRequests.CreateAccountRequest.password`：`@Size(max=128)` → `@Size(min=8, max=128)`，Bean Validation 层 <8 早拒
  （进入 AuthService 前 400）；`LoginRequest.password` 保持 `@Size(max=128)` 不变。
- 测试质量：AuthServiceTest 正向用例弱密码（`s3cret`/`pw`/`secret`）已更新为 `Str0ng!Pw`（S 大写/tr0ng 小写+数字/! 符号，
  长度 9，四类齐全）且 `verify(passwordEncoder).encode(...)` 同步；新增 3 策略矩阵测试（createAccount 太短 + 缺各类 4 子 +
  seedAdmin 矩阵 5 子，复用 assertInvalidAccount/assertInvalidSeed 断言 INVALID_REQUEST + verifyNoInteractions）；
  AuthControllerValidationTest 新增 `@Size(min=8)` Bean Validation 测试（7 字符 `Str0ng!` → 400 + verifyNoInteractions）。

**D. 邻接风险（PASS）**：
- login 隔离：validateLoginInput 不变；AuthControllerAbuseControlTest 全为 login/refresh 限流测试（用 "pw"），login 不强制策略，
  mvn 238/0 实证无回归。
- createAccount role 门先于策略：`nonAdminCannotCreateAccounts`（密码 "pw"）仍 → ACCESS_DENIED（role 先判），策略不触发。
- 非泄露：全部策略失败同一 INVALID_REQUEST + 固定 "The request is invalid"，不暴露缺失类别。
- BCrypt DoS：策略要求 ≥8 但仍受 MAX（128 字符/128 字节）上界约束，无新 DoS 面。
- directAccountValidationFailsClosed / seedAdminByteValidation / malformedUtf16 既有负测：这些 "pw" 用例在 if-block（null/blank/
  byte/max）即 throw，或仍映射 INVALID_REQUEST；不触策略或触策略结果相同，全部通过（mvn 实证）。

**E. 验收标准逐项**：

| # | 标准 | 结果 |
|---|------|------|
| 1 | validatePasswordPolicy length<8 或缺四类任一 → invalidRequestError | PASS |
| 2 | validateAccountInput + seedAdmin 调用；seedAdmin absent-return-0 早于策略 | PASS |
| 3 | CreateAccountRequest.password @Size(min=8,max=128)；LoginRequest 不变 | PASS |
| 4 | AuthServiceTest 策略矩阵全 PASS + 正向用例强密码 + verify encode 同步 | PASS（mvn 238/0） |
| 5 | AuthControllerValidationTest @Size(min=8) 测试 + 既有负测 | PASS（mvn 238/0） |
| 6 | mvn -pl service/apps/runtime -am test BUILD SUCCESS ≥234 0 失败 | PASS（238/0） |
| 7 | canonical precheck 8/8 PASS + git diff --check exit 0 | PASS |
| 8 | R1 独立复核 PASS（0 P0/P1/P2） | PASS（本报告） |
| 9 | 终态 pre-closure / 单父 [skip ci] / push / HEAD==origin/main / 0/0 / clean / remote exact-SHA | NOT_RUN（终态范围，R1 后执行） |

**F. 不变量**：INV-TENANT-001（account_id 仍 server 派生，密码策略不触所有权）✓；INV-AUTH-001（auth fail-closed，弱密码被拒非被纳）✓；
INV-HARNESS-001（AGENTS.md 单一权威源未触）✓；INV-HARNESS-002（单活动任务 TASK-0169 + 冻结 context + 单父原子）✓；
INV-HARNESS-005（evidence 诚实，未运行项 NOT_RUN）✓；INV-HARNESS-007（single-card + bounded review + exact candidate）✓；
INV-HARNESS-009（LOCAL_EXACT_TREE_FALLBACK frozen at READY，dispatchCount=0，远端如实非 PASS）✓。

## Findings

- **P0**：无。
- **P1**：无。
- **P2**：无。
- **P3（信息性，非阻塞）**：
  1. `validatePasswordPolicy` 逐 `char` 分类（`Character.isUpperCase` 等）；非 BMP 代理对字符属「非字母非数字」→ 计为符号。密码通常为 BMP；
     代理对计为符号无害。Technical Alpha 可接受。
  2. 符号定义 = 任何非字母非数字字符（含空格）。空格计为「符号」是标准 password-policy 语义（空格是合法密码字符、增大熵）。
     Owner「符号」映射到标准非字母数字定义；若需收紧为「仅标点」可用 `Character.getType` 限定，Technical Alpha 无需。
  3. `directAccountValidationFailsClosed` 中 role-only-invalid 用例（role "" / "MANAGER" + 密码 "pw"）现因 "pw"<8 在策略处
     先 fail（仍 INVALID_REQUEST，测试仍通过），字段隔离度降低；测试目的是「全部非法输入→固定 400 envelope + 不触 service」，
     该目的仍成立。非阻塞。

## Verdict

**R1 PASS**。TASK-0169 候选 `2eaa984`/tree `d4b73775` 为 P2-03 密码最低策略与复杂度（min 8 + 大写/小写/数字/符号四类全要）
最小实现：`validatePasswordPolicy` 注入 createAccount（validateAccountInput）+ seedAdmin，login 不强制；`AuthRequests`
`@Size(min=8)` Bean Validation 早拒；正向用例弱密码更新 + 3 策略矩阵测试 + 1 Bean Validation 测试。完全在 writeAllowlist 内、
零 forbiddenPaths 触碰、context fingerprint 独立自验一致、唯一 canonical precheck 8/8 PASS（doctor 809949）、
mvn runtime 238/0、git diff --check exit 0、protected-path 无命中（service/apps/runtime/** 非保护，C3 auth + independentReview:required）。
验收 1-8 PASS，9 属终态范围（NOT_RUN）。完整 unittest + 根级 Maven verify deferred per Owner static-gates-only 策略。
可进入终态闭环。

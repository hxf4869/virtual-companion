# ZCode 后续修复交接

> 用途：把 Codex 原计划继续修复的内容、当前失败状态、剩余审计项、决策点和执行顺序交给 ZCode。
> 本文是信息性交接，不是第二套 Backlog、任务卡、Evidence Pack 或终态 Handoff。任何冲突均以
> `AGENTS.md`、`.harness/**`、当前活动任务卡、Accepted ADR、代码和测试为准。

## 1. 交接快照

- 生成时间：`2026-08-09T06:16:48+08:00`
- 仓库：`/Users/hxf/projects/virtual-companion`
- 分支：`main`
- 远端基线：`origin/main = 7b3c11415488988ddab20e3b30624e5d686dd2f8`
  （`TASK-0108 ACCEPTED`）
- 本地 HEAD：`cdddc1b3e7272f1c364b0279e2da59d31c86e167`
- 候选 Tree：`75753c35837e497e56709ae747961a391fef9017`
- 本地相对远端：ahead 5，尚未 push
- 活动任务：`TASK-0109`，任务卡状态 `IN_PROGRESS`，风险 `C3`
- 当前工作树在生成本文前仅有未跟踪目录 `docs/evidence/TASK-0109/`，其中已有独立审查
  `review-r1.md`；本文也位于该任务已授权的 `docs/evidence/TASK-0109/**`。

不要从本文中的时间点推断当前状态。ZCode 接手后的第一步必须重新读取机器真源并核对 Git，不能把
本文快照当成动态授权。

## 2. 当前最高优先级：TASK-0109 必须失败关闭

### 2.1 已发生的提交链

```text
7b3c114  TASK-0108 ACCEPTED（origin/main）
ee7882b  TASK-0109 DRAFT
c396da6  TASK-0109 READY / Owner 授权
38383ad  TASK-0109 authorizationCommit 绑定
c79f6c6  TASK-0109 IN_PROGRESS
cdddc1b  TASK-0109 实现候选（当前 HEAD）
```

READY Doctor 已在受控 Python 环境和全新 TMPDIR 中真实 PASS：473603 checks、70.6 秒、exit 0。
实现阶段定向 Docker Maven reactor 三次 `BUILD SUCCESS`；最后一次覆盖 modelruntime 134 tests、
OpenAI Boundary 13 tests 及相关模块，均无 failure/error/skip。这些只是迭代证据，不是 canonical、
根级 Maven 或终态 exact-tree PASS。

### 2.2 候选已经实现的内容

候选 `cdddc1b` 修改 11 个授权文件，404 insertions / 6 deletions：

- 新增 `SizeLimits`：消息数 64、单消息 64 KiB、schema 16 KiB、单流事件 1 MiB、累计输出
  1 MiB、OpenAI `max_tokens=8192`。
- `ProtocolMessage`、`LiveInvocationRequest`、`ModelProtocolRequest` 增加构造期边界；消息数也在
  `ModelProtocolRequest` 复核，避免直接 adapter 调用绕过。
- `OpenAiChatCompletionsCodec` 写入 `max_tokens` 并复核 schema。
- `OpenAiChatCompletionsSession` 检查单 SSE data、累计流式输出和非流 content。
- `LiveModelInvoker` 增量统计 UTF-8 字节，超限丢弃部分输出、释放 quota、生成
  `MalformedResponse` 和 `NON_RETRYABLE_FAILED` audit。
- 已增加边界、超一、Unicode、max_tokens、流/非流和 Invoker 失败关闭测试。

这些实现不能被视为已接受。它们将作为 TASK-0109 的失败候选留在历史中，由 replacement task
修正并重新验证。

### 2.3 R1 独立审查结论

审查文件：`docs/evidence/TASK-0109/review-r1.md`

R1 对 `cdddc1b` / `75753c3` 给出 `FAIL`，有两个阻塞 P1：

1. **响应上限检查发生在无界物化之后。**
   - `SseDecoder` 先用 `BufferedReader.readLine()` 读取任意长行，再用 `ArrayList` 收集全部
     `data:` 行并 `String.join`，Session 的 1 MiB 检查太晚；超大 comment/未知字段行也可先分配。
   - 非流路径先由 `jsonMapper.readTree(body)` 完整解析任意大 JSON，再检查 `content`；超大无关字段
     仍可耗尽堆。
   - 现有测试只证明有限大 payload 最终被拒绝，没有证明读到上限即停止和取消。
2. **字面量 `git diff --check` 被多次调度。**
   - 策略固定 `diffCheckCount: 1`，该过程事实已经发生，不能通过挑选一次作为“正式执行”、删除
     Evidence、reset/rebase 或重新描述来修复。

R1 另记录三个非阻塞残余：

- Invoker 超限依赖 try-with-resources 的 `close()`；通用 `ModelProtocolSession` 不保证
  `close()==cancel()`，应显式 `session.cancel()` 并测试。
- Session 使用无界 `LinkedBlockingQueue`；约 1 MiB 的一字节 delta 可形成约百万个对象。
- `schemaName` 和总编码请求体没有上限。

R1 后未运行 canonical precheck、根级 Docker Maven verify、正式 exact-tree validation，也没有再运行
`git diff --check`。不要为了“补证据”在当前 TASK-0109 上运行这些命令。

### 2.4 合规恢复路径

推荐且默认采用 **TASK-0109 原子 REJECTED + 新永久 replacement task**，不要重建同一任务历史。

理由：

- 多次 `git diff --check` 是不可抹除的验收事实。
- 完整修复需要把 `SseDecoder.java` 和相应测试加入写范围，还可能新增非流 raw-body 数值；这些超出
  READY 冻结授权。
- 原卡只有一个 fix batch、最多两轮 review，且 `overallElapsed` 禁止 reset/reanchor。
- “尚未 push”不等于事实未发生，也不授权 history rewrite。

ZCode 应按当前版本的 lifecycle/policy重新核对下列步骤后执行：

1. 保留 `cdddc1b`、R1、所有失败事实；禁止 reset、rebase、squash、force-push 或删除审查文件。
2. 为 TASK-0109 生成真实的 REJECTED Evidence/Handoff：记录候选 Commit/Tree、R1 FAIL、两次阻塞、
   未运行的 canonical/root Maven/exact-tree，以及真实 timing。
3. 按 `IN_PROGRESS -> REJECTED` 做单父原子 terminal closure；同步任务卡、project-state、Task Ledger、
   Evidence Pack 和 `docs/handoffs/TASK-0109.json`。
4. 按 REJECTED 的 terminal-metadata-only / pre-closure 规则验证；不得把 rejection closure 写成 CI PASS。
5. push 后远端复核 0/0，使失败链成为不可变历史。
6. 从机器真源确认未占用永久 ID。若仍为下一个 ID，则创建 `TASK-0110`，明确
   `replacement of TASK-0109`，Base 为 TASK-0109 的 REJECTED 终态提交。
7. 新卡重新生成 Context Lock、复杂度、预算、allowlist、Owner 数值审批和 Reviewer；旧 READY、R1、
   timing 或 receipt 不能复制为新卡 PASS。

### 2.5 Replacement task 的技术范围

原 Owner 已确认的六个上限保持不变：64 条消息、单条 64 KiB、schema 16 KiB、单事件 1 MiB、
累计输出 1 MiB、OpenAI max_tokens 8192。

新卡至少需要授权并完成：

1. **SSE 读取阶段即有界。**
   - 将 `SseDecoder.java` 和可证明 early-stop 的测试加入 allowlist/Context Lock。
   - 不得调用无界 `readLine()` 后才检查；按原始字节增量读取并在超过上限的第一个字节立即失败。
   - 同时限制 comment、未知字段和没有空行的超长输入，不能只限制 `data:` 拼接结果。
   - 保持 UTF-8、LF/CRLF、BOM（若原实现支持）、多行 `data:` 以换行拼接、空 data、终止帧等既有语义。
   - 超限后停止消费 body、主动 cancel/close 网络请求，只产出统一 `MalformedResponse`。
2. **非流 body 在 Jackson 之前有界。**
   - 对原始 HTTP response body 使用 bounded stream/reader；不能先 `readTree` 完整物化再检查。
   - 推荐向 Owner 申请 `MAX_NON_STREAM_RESPONSE_BYTES = 8 MiB`。原因：合法 1 MiB decoded content
     在 JSON 中最坏可经 `\uXXXX` 扩展到约 6 MiB，8 MiB 留出 envelope 余量。
   - 8 MiB 只是建议值，不是既有授权；Owner 未确认前不能写入任务卡或代码。
3. **显式取消通用 session。**
   - `LiveModelInvoker` 在输出超限时显式调用 `session.cancel()`，不能依赖某个 adapter 的
     `close()` 恰好等价于 cancel。
   - 测试必须观察 cancel 被调用、quota 恢复、audit 失败、无部分成功输出。
4. **证明读取在边界停止。**
   - 使用 counting/throwing InputStream 或等价受控源：如果实现多读一个限定外字节之后继续消费，
     测试必须失败。
   - 覆盖恰好边界、超一字节、超长 comment、无分隔事件、多行 data、CRLF、Unicode、超大无关 JSON
     字段、非流 escaped content、取消和连接关闭。
5. **对相邻残余作明确决策。**
   - 无界 queue 对象数、`schemaName`、总编码请求体应在新卡 intake 时评估。
   - 若加入新的事件数量/请求体数值，必须让 Owner 选择并重新评估复杂度；不要私定阈值。
   - 若不纳入新卡，必须写入该卡 Handoff 的 remainingItems/knownRisks，并在真实 provider/HTTP 接线前
     建独立任务。

## 3. 原始 48 项审计状态表

下表以旧审计 ID 为索引。`CLOSED` 只表示已有 Accepted task 证据；不要重复修改历史 Evidence。
`OPEN`/`OWNER_GATE` 仍需当前 HEAD 复核后创建新任务；`REPLACEMENT` 表示当前失败链必须由新卡闭环。

| ID | 状态 | 当前证据或下一动作 |
|---|---|---|
| P1-01 Doctor cache 身份绑定 | CLOSED | TASK-0095 ACCEPTED `0151e32`；TASK-0094 REJECTED 历史不可改 |
| P1-02 根级 Maven verify 红 | CLOSED | TASK-0097 ACCEPTED `1696739` |
| P1-03 generation 终态并发 | CLOSED | TASK-0098 ACCEPTED `60c00e1` |
| P1-04 caller 可伪造 owner context | OWNER_GATE | 先决定可信 DB principal/连接池绑定模型 |
| P1-05 runtime roles 直写绕过状态机 | OWNER_GATE | 依赖 P1-04，再撤销宽泛 DML |
| P1-06 refresh rotation 多后继 | CLOSED | TASK-0099 ACCEPTED `7607433` |
| P1-07 snapshot 伪装安全完成 | CLOSED | TASK-0104 ACCEPTED `8e11d11` |
| P1-08 auth 开启后 baseline 401 | CLOSED | TASK-0102 ACCEPTED `f39a550`，决策为显式 permitAll |
| P1-09 token 写 localStorage | CLOSED | TASK-0102 后端 + TASK-0103 前端 ACCEPTED `c9c3ccc` |
| P1-10 DB/RLS tests 未进入 CI | CLOSED | TASK-0101 ACCEPTED `9ae5577` |
| P1-11 空库仍启动并健康 | OWNER_GATE | migration/runtime principal 和 readiness 拓扑待决策 |
| P2-01 LiveModelInvoker 未接 protocol fence | CLOSED | TASK-0107 ACCEPTED `df85ece` |
| P2-02 Anthropic structured output 错误 | CLOSED | TASK-0107 ACCEPTED `df85ece` |
| P2-03 login/refresh 无限制 | OWNER_GATE | 需决定限流/退避/锁定/body 与字段阈值 |
| P2-04 Auth validation/error envelope | OPEN | Bean Validation + 统一 400，可独立小卡 |
| P2-05 provider secret/egress | CLOSED | TASK-0108 ACCEPTED `7b3c114` |
| P2-06 模型尺寸/成本上限 | REPLACEMENT | TASK-0109 R1 FAIL；按第 2 节失败关闭并新建 replacement |
| P2-07 realtime seq 竞态 | CLOSED | TASK-0100 ACCEPTED `0a70e94` |
| P2-08 durable event type 无约束 | CLOSED | TASK-0100 ACCEPTED `0a70e94` |
| P2-09 终态 event 固定 epoch/seq | CLOSED | TASK-0100 ACCEPTED `0a70e94` |
| P2-10 candidate/terminalize TOCTOU | CLOSED | TASK-0098 ACCEPTED `60c00e1` |
| P2-11 cancel 缺少原子 event | CLOSED | TASK-0100 ACCEPTED `0a70e94` |
| P2-12 JDBC snapshot 可复活 | OPEN | insert-only + 单向状态转换 + ID 一致性测试 |
| P2-13 admin seed 并发 | OWNER_GATE | 需决定单 Admin/多 Admin 语义和锁/唯一模型 |
| P2-14 取消不终止 SSE/fetch | CLOSED | TASK-0104 ACCEPTED `8e11d11` |
| P2-15 SSE CRLF/错误吞噬 | CLOSED | TASK-0104 ACCEPTED `8e11d11` |
| P2-16 Memory API 把错误变空成功 | CLOSED | TASK-0105 ACCEPTED `950162c` |
| P2-17 旧 chat run 覆盖新状态 | CLOSED | TASK-0104 ACCEPTED `8e11d11` |
| P2-18 前端依赖漏洞 | CLOSED | TASK-0106 ACCEPTED `5a0490c`；后续仍需持续扫描 |
| P2-19 前端 CI 不跑 test/type-check | CLOSED | TASK-0106 ACCEPTED `5a0490c` |
| P2-20 Harness fixture 硬编码 master | OPEN | C4 Harness 可移植性卡 |
| P2-21 canonical Python 合同冲突 | OWNER_GATE | 选择字面量 python/python3 或受控解释器解析 |
| P2-22 nextAction 指向未注册任务 | OWNER_GATE | 决定注册 Backlog 或显式 task-intake 动作 |
| P2-23 Actions 使用可变 major tag | OPEN | 固定完整 commit SHA + 受审更新流程 |
| P2-24 Harness Python 依赖无 hash lock | OPEN | 精确版本/hash + 可重复安装验证 |
| P2-25 license/SBOM 不覆盖传递依赖 | OWNER_GATE | 决定扫描器、例外与到期策略 |
| P2-26 Precheck/CI 无超时 | OPEN | timeout、进程树终止、TIMEOUT Evidence |
| P2-27 策略与跨平台 CI 分叉 | OWNER_GATE | 决定 Windows 正式支持或 deferred/not claimed |
| P2-28 PostgreSQL readiness 竞态 | CLOSED | TASK-0101 ACCEPTED `9ae5577` |
| P2-29 V1 不纠正危险 role 属性 | OPEN | 与 P1-04/05 的 DB 安全边界协同但独立 migration |
| P3-01 OpenAPI drift gate 未进 CI | OPEN | 接入现有 `diff --fail-on-drift` |
| P3-02 README 状态/端点过期 | OPEN | 按 Technical Alpha 真实能力更新 |
| P3-03 Memory 页面状态/交互 | CLOSED | TASK-0105 ACCEPTED `950162c` |
| P3-04 前端可访问性 | CLOSED | TASK-0105 ACCEPTED `950162c` |
| P3-05 普通日志记录 account id | OPEN | 移除身份标识并加日志捕获测试 |
| P3-06 username 规范化不一致 | OPEN | 统一 lower/trim 与 JWT/响应/audit 语义 |
| P3-07 DB test runner 陈旧注释/glob | OPEN | 与下一张 DB-CI hygiene 卡处理 |
| P3-08 full-module Evidence 标签歧义 | OPEN-POLICY | 不改历史；后续 Evidence 使用精确 reactor 标签 |

## 4. 剩余审计项的详细修复要求

以下条目不能一次性塞进一张大卡。每张卡都要在 intake 时从当前 Base 重新确认行号、调用链、风险级、
保护规则、复杂度和验证命令。

### 4.1 P1-04 + P1-05 + P2-29：租户 principal 与 DB 权限边界

**状态：Owner gate，真实业务/HTTP 接线前阻断。**

主要位置：

- `V1__foundation_roles_rls_context.sql`：`current_owner_id`、`begin_job_context`、既有 role 创建逻辑。
- V2 的 RLS policy 与 runtime role grants。
- V7/V8/V15 对 generation、message、usage、quota、realtime、outbox、provider_attempt 的宽泛 DML。
- 多个 SECURITY DEFINER 函数直接 `set_config(..., p_owner_user_id, true)`。

风险：caller 可自行 `SET LOCAL vc.owner_user_id`，函数又用调用参数覆盖 owner context；同租户内可直接
改状态、quota 和终态事件，错误的连接/角色模型下还可能跨租户。V1 只在角色不存在时创建
`NOBYPASSRLS NOLOGIN`，不会纠正预先存在的 `LOGIN/BYPASSRLS` 危险属性。

Owner 必须先决定：

1. 可信 principal 如何绑定到数据库 session/connection pool，谁有权设置 owner context。
2. migration principal、runtime principal、Flyway/job 的部署拓扑与凭据边界。
3. runtime role 是否只允许窄 SECURITY DEFINER 命令，哪些只读能力保留。

修复要求：

- 普通 runtime caller 不能任意选择 owner；函数参数必须与 server-trusted context 一致，不能覆盖它。
- 撤销核心状态表直接 INSERT/UPDATE/DELETE；只暴露状态机窄函数，必要时增加 transition/不可变列约束。
- 对已有危险 role 属性启动/迁移时失败关闭或明确纠正。
- 使用真实 LOGIN role 和真实连接池测试：缺 context、伪造 context、owner/argument mismatch、连接复用、
  同租户直写、跨租户读写、BYPASSRLS/LOGIN 预置均应拒绝。

该工作横跨授权架构与多个 migration，预计必须拆卡；不能与 TASK-0109 或普通 Auth hygiene 混合。

### 4.2 P1-11：数据库 readiness 与 migrator/runtime 分离

主要位置：`application.yaml`、`AuthDataSourceConfig.java`、`AuthExceptionHandler.java` 和 Flyway 启动路径。

风险：空库、落后一版或迁移失败时应用仍可能启动并报告健康；缺 schema 可能被错误映射为 401；同一
DataSource 若同时承担 Flyway 与 runtime，会在“可迁移”和“最小运行权限”之间二选一。

修复要求：

- 显式分离 migration principal/job 与 runtime datasource。
- readiness 校验 schema version、必需表/函数/role，失败时拒绝业务流量。
- 缺 schema/迁移失败映射 503，不得伪装认证失败。
- 测试空库、落后一版、迁移失败、错误 role、runtime role 尝试 DDL/Flyway。

该卡依赖 4.1 的部署拓扑决定和已存在的 DB CI 门禁。

### 4.3 P2-03：登录/刷新限流、锁定和输入上限

主要位置：

- `AuthController.java` login/refresh 入口。
- `AuthRequests.java` 请求 record。
- `AuthService.java` BCrypt、LOGIN_FAILURE audit 和 token 路径。

需由 Owner/Security 决定：网关与应用各自阈值、IP/账号/设备维度、退避与锁定时长、body/username/
password/refresh-token 字节上限、密码最低策略、审计聚合与保留期限。不要由实现者私定安全数值。

修复后验证：超长 body/字段早拒绝；未知用户与已知用户时序不形成明显枚举；并发凭据填充触发限流但
不耗尽 BCrypt/连接池；锁定、解锁、refresh abuse 和审计保留均有确定测试。

### 4.4 P2-04 + P3-05 + P3-06：Auth hygiene

主要位置：`AuthRequests.java`、`AuthController.java`、`AuthExceptionHandler.java`、`AuthService.java`、
`AdminSeedRunner.java`，必要时 V14 identity functions。

修复要求：

- Bean Validation + `@Valid`；malformed JSON、null body、`{}`、空/超长字段统一为不泄密的
  400 `ErrorEnvelope`。
- 通用应用日志不记录 account id、username、密码、token 或 hash；身份审计进入受控 audit sink。
- username 的 trim/lower/subject/display 语义在创建账号、登录、JWT、响应和审计中一致。
- 增加 WebMvc、日志捕获、大小写/空白规范化和错误 envelope 测试。

如果修改 V14 migration 或身份契约，风险级和 Skill 必须升级；不要为了凑一张小卡越过 protected path。

### 4.5 P2-12：JDBC authorization snapshot 不可复活

主要位置：`JdbcAuthorizationSnapshotStore.java:44-58,102-124`、内存实现的 insert-only 语义、V3 grants。

风险：`put` 的 UPSERT 可把 `WITHDRAWN/NARROWED` 记录覆盖回 `ACTIVE`，且 narrow 的 ID 一致性不足；
真实 JDBC 接线后会违反授权快照单向生命周期。

修复要求：

- `put` 改为 insert-only，重复 ID 失败。
- withdraw/narrow 使用行锁和带当前状态条件的单向转换。
- 校验原 ID、narrowed ID、owner 和 parent 链一致；撤销普通 role 对该表的直接 UPDATE/DELETE。
- 测试 ACTIVE -> WITHDRAWN/NARROWED 后重复 put、并发 withdraw/narrow、跨 owner 和 ID mismatch。

### 4.6 P2-13：admin seed 并发

主要位置：V14 `identity_admin_seed` 和 `AdminSeedRunner`。

Owner 先决定产品语义是“系统最多一个 ADMIN”还是“只允许一个 bootstrap ADMIN，之后可人工增加”。
随后选择 advisory lock、唯一 partial index 或一次性 bootstrap migration。测试必须用两个真实 DB 会话，
覆盖同用户名、不同用户名、多实例同时启动，并保证 loser 行为确定、无多 Admin、无启动随机失败。

### 4.7 Harness/CI 剩余组

这些都触碰 C4 治理路径，必须独立 Owner 批准与 Reviewer；不要把所有项打成超预算“大一统 Harness 卡”。

**组 A：P2-20 + P2-21，解释器与 Git fixture 可移植性**

- `test_harness.py` 不应在 `git init` 后硬编码 `master`；显式创建/查询当前分支并覆盖 main/master/
  无全局配置/Windows。
- 当前机器合同冻结 `python scripts/harness/precheck.py`，POSIX 文档/wrapper 又使用 `python3`，且 wrapper
  不是 Evidence alias。Owner 必须选择字面量解释器或受控解析后的 canonical argv，并同步 AGENTS、
  policy、Skill、模板、wrapper 和测试。

**组 B：P2-23 + P2-24，供应链可复现**

- GitHub Actions 固定完整 commit SHA，建立受审升级流程。
- Harness Python 依赖精确版本和 hash lock，使用 `--require-hashes` 或等价可重复安装流程。
- 在全新环境验证安装、缓存和失败关闭，不把网络偶发失败写成 PASS。

**组 C：P2-25，license/SBOM/vulnerability gate**

- 扫描 Maven/pnpm 直接及传递依赖、SPDX license、SBOM 和已知漏洞。
- Security/Owner 先决定工具、离线/在线要求、严重级门槛、例外字段、到期策略和 paid/SaaS-only 边界。
- 不能仅按漏洞数量盲升依赖，也不能让扫描器成为付费必需运行时。

**组 D：P2-26，超时和进程树终止**

- Precheck 注册命令和主要 CI jobs 增加明确 timeout。
- timeout 时终止完整进程树，Evidence 为真实 `TIMEOUT`，保留命令/耗时/候选身份，绝不变 PASS。
- 用永久阻塞子进程测试 POSIX/Windows 终止行为。

**组 E：P2-27 + governance H-2，路径感知矩阵**

- 当前 policy 宣称 Windows/Linux 范围，而 backend/frontend 主要是 Ubuntu；历史又把部分平台 smoke-only
  记为 intentional。
- Owner 必须选择实现路径分类后的完整矩阵升级，或把未支持平台正式标为 deferred/not claimed。
- 移除固定单机 JDK 路径，使用可配置、可验证 toolchain。

**组 F：P3-01，OpenAPI drift**

- 把现有 `scripts/dev/openapi_tool.py ... diff --fail-on-drift` 接入 CI/canonical 注册。
- 制造 drift 的测试必须阻断；生成物与手写源的 ownership 要明确，禁止手改生成物。

### 4.8 P2-22：未来任务引用必须机器可执行

`project-state.nextAction` 曾引用 TASK-0091/0092/0093，但这些 ID 没有正式 Backlog/Task Ledger/任务卡。
Owner 需决定：

- 先登记永久 Backlog 合同，再按依赖晋级；或
- 将 nextAction 明确写成“先通过 task-intake 创建 DRAFT”，并让 Doctor 区分 advisory 文本与可执行任务。

任何 Agent 都不能把 planning 文档中的 TASK-0091/92/93 当作现成授权直接写代码。

### 4.9 P3 文档与低风险 hygiene

- `README.md` 只描述 Technical Alpha 已真实接线的能力和端点，不把规划能力写成可用。
- DB runner 注释和测试发现逻辑保持动态一致；覆盖空目录和特殊文件名。
- 历史 Evidence/Handoff append-only，不修改 TASK-0090 的旧标签；新 Evidence 使用精确的
  `runtime-upstream-reactor` 等名称，避免 `full-module` 误导。

## 5. 新审计候选与上线前门禁

下列项来自并行审计，其中部分审计基线早于 TASK-0095..0108。ZCode 必须在当前 HEAD 上复现后才能
新建修复卡；不能直接把旧行号当作现存缺陷，也不能因为旧 task 名称相似就自动标 CLOSED。

### 5.1 需要当前 HEAD 复核的代码候选

1. **Frontend realtime envelope：`event` 与 `eventType`。**
   - 旧前端 parser 只读取 `eventType`，catalog/SQL envelope 使用 `event`。
   - TASK-0104 改了 SSE/snapshot，但 Accepted commit 摘要没有明确证明该字段映射。
   - 用真实 SQL/catalog envelope 覆盖 resume、snapshot、terminal、gap、reset；若仍丢事件，建独立前端
     边界卡，不要改 reducer 来掩盖 transport 字段错误。
2. **Worker claim 的 lease/fence 绑定。**
   - V1 `begin_job_context`、V5 `claim_work_items` 和 `WorkItemClaimService` 旧实现可能只拒绝空/STALE
     fence，却不验证 coordinator 分配；autocommit 还可能在后续 renew/complete 前丢失 transaction-local
     context。
   - 依赖可信 principal 设计；用真实连接验证伪造 owner/fence、过期/接管/旧 fence 和跨连接操作。
3. **Provider attempt 的 authorization snapshot/fence。**
   - V15 provider_attempt 旧 schema 没有 requested/execution snapshot、route/fence 绑定。
   - 在 TASK-0093 真实接线前确认 `INV-AUTH-001` 的数据库/事务强制方式，补 NOT NULL/FK 或同事务契约。
4. **Quota 数值与 release 幂等。**
   - 复核 usage/token/cost/quota 的非负 CHECK，以及重复/并发 quota release 是否有 reservation/
     idempotency key。
5. **SECURITY DEFINER search_path。**
   - 复核 `SET search_path = vc, public` 和未限定扩展函数；若 `public` 可被不可信 role CREATE，存在对象
     劫持风险。建议 `vc,pg_catalog`、显式 schema qualification 和 public CREATE 负向测试。
6. **存量 migration 兼容。**
   - V8 将旧 realtime event 填 `seq=0` 后建唯一索引、V11 为旧 SESSION memory 增 FK/CHECK 的路径可能
     假设空表。用带存量数据的真实 upgrade 测试确认，必要时 preflight/backfill。

### 5.2 明确的相邻风险

- TASK-0109 replacement 未必覆盖 stream queue 对象数、schemaName 和总编码请求体；必须 Owner 决策或
  形成 remaining item。
- 已接受的 P2-18 只代表当时候选的依赖修复；供应链漏洞会变化，最终复审必须重新跑当前 lockfile
  audit，并区分 production/dev/CI 攻击面。
- 没有仓库级 CODEOWNERS 不是自动漏洞，但如果希望 Git 平台层强制 ownership，需要独立治理决策；
  当前权威仍是 task owner、protected-path Skill、人工批准和 Reviewer。

### 5.3 未实现能力与发布门禁

这些不是“当前代码已回归”的同义词，但在开放真实用户/provider 前必须有正式任务与证据：

| 条件风险 | 触发前必须具备的证据 |
|---|---|
| RISK-01 Generation/Realtime HTTP 纵切 | 正式 intake controller、dispatcher、owner binding、Realtime ticket/resume/SSE、终态闭环；对应 TASK-0093 只是方向，不是现成授权 |
| RISK-02 Realtime wire 字段 | 在唯一 transport boundary 固化 `event`/`eventType` schema，并用真实 envelope 覆盖全部事件 |
| RISK-03 auth 默认关闭 | production profile 强制 auth + datasource，缺配置启动失败；业务 owner 只来自 verified principal |
| RISK-04 chat/memory authenticated transport | H5 统一复用认证 transport、ticket、cursor/nextEpoch；对应 TASK-0092 只是方向，不在页面散拼凭据 |
| RISK-05 Provider EOS 不是最终完成 | 必须经过 FINAL_REVIEW、最终安全审查、原子 finalize 后才能产生 `chat.completed` |
| RISK-06 provider attempt 授权绑定 | requested/execution authorization snapshots、route/fence 由 schema 强约束或有可验证的同事务 enforcement |
| RISK-07 registry/quota 持久化 | provider registry、quota/cost 在多实例和重启下有持久化与幂等语义；对应 TASK-0091 只是方向 |
| RISK-08 生产部署边界 | 镜像、proxy、TLS/HSTS/CSP、egress、日志保留、备份恢复、密钥轮换、SBOM/镜像/密钥扫描均有可审计证据 |
| RISK-09 SECURITY DEFINER search_path | 撤销/验证 `public CREATE`，优先 `vc,pg_catalog` 和 schema qualification，并有 shadow-object 负测 |
| RISK-10 V8/V11 存量升级 | 在保留真实数据前提供 preflight/backfill，并用不兼容历史数据做升级测试 |
| RISK-11 产品与伦理 | PIA、成人/未成年人边界、紧急求助职责、数据保留/导出/删除、滥用响应、责任人、值班和安全演练形成正式证据 |

`realUserBeta` 在 RISK-11 和机器真源列出的门禁完成前保持 BLOCKED；真实支付仍为 FORBIDDEN。

## 6. 推荐执行顺序

1. **先关闭当前链：**TASK-0109 REJECTED，push 并远端复核。
2. **立即 replacement：**新卡完成 early-bounded SSE/non-stream、显式 cancel 和测试，C3 独立 Review，
   正常 ACCEPTED 后 push/远端复核。
3. **处理 P1 DB 架构决策：**P1-04/P1-05/P2-29；Owner 未决定可信 principal 时保持 BLOCKED，转做
   独立可晋级项。
4. **处理 P1-11 readiness/migrator 分离。**
5. **处理 Auth：**P2-03 决策卡；P2-04/P3-05/P3-06 hygiene；P2-13 admin seed 独立 DB 卡。
6. **处理授权存储：**P2-12；随后复核 provider-attempt/quota/worker 候选。
7. **分批处理 Harness/CI：**解释器+fixture、Actions+lock、timeout、matrix、SBOM、OpenAPI，分别控制在
   policy 预算内。
8. **处理低风险文档/hygiene。**
9. **正式 intake TASK-0091/0092/0093 方向；**不得直接使用未注册 ID。
10. **全部闭环后做一次全项目重新审计：**治理、依赖/质量、后端协议与状态机、数据库并发/RLS/
    migration、前端 transport/UI、安全与发布门禁分别独立复核；逐项对照本表，新增问题也要入账。

依赖不满足的卡只阻塞其后代；仍有独立 promotable card 时继续，不要因为一个 Owner gate 停掉所有工作。

### 6.1 每类任务的最低验证

- **Harness：**冻结的定向 unittest；不依赖默认分支/ambient config 的全量 harness tests；canonical
  precheck；独立 Reviewer；绑定精确 Commit/Tree 的远端或 READY 冻结 fallback。
- **Backend：**JDK 25 + Maven 3.9 根级 `verify`；受影响模块定向测试只作迭代证据，不能替代 root gate。
- **Database：**fresh digest-pinned PostgreSQL/pgvector 全迁移、完整 SQL suite、真实双 session 并发交错、
  runtime role/RLS 负测、带存量数据升级和失败回滚；使用 OrbStack。
- **Frontend：**frozen install、type-check、Vitest、production build；transport/page glue 用组件或浏览器测试；
  涉及 UI 时验证 desktop/mobile、键盘、焦点、aria/live 和无重叠。
- **CI/供应链：**PR workflow 实际运行并绑定 exact SHA；Actions pin、依赖 hash、SBOM、license、漏洞和
  例外到期均可复验。
- **安全/身份：**失败路径、跨租户、并发、token 存储、CSRF/Origin、日志隐私、rate limit/lockout 全部
  有负向测试；不能用 happy path 代表安全闭环。

### 6.2 审计修复完成定义

只有同时满足下列条件，ZCode 才能宣称全部审计修复完成：

1. 原始 48 项逐项有 Accepted task 证据，或有 Owner 明确接受、写明理由与到期日的延期；不能用一个
   笼统 PASS 批量关闭。
2. TASK-0109 的 REJECTED 历史和 replacement 均完成远端闭环；R1 三个相邻残余、新审计候选和最终
   re-audit 新发现也逐项关闭或正式延期。
3. 根级 Maven、完整 Harness、完整 DB suite + 并发/升级测试、前端 type-check/tests/build、OpenAPI
   drift 和供应链 gates 已进入持续 CI，且实际验证当前精确 SHA。
4. 11 个条件风险在触发前已修复，或被机器发布门禁可靠阻断；产品/伦理证据不能由代码单测替代。
5. 所有终态 Handoff、Evidence、Reviewer、Commit/Tree、远端 SHA、project-state、Task Ledger 一致；
   工作树 clean，`HEAD...origin/main` 为 `0/0`。
6. 最终全项目独立审计基于最新远端 HEAD，不依赖旧行号或任务名；所有 P0/P1 为零，剩余 P2/P3 有
   Accepted 修复或带到期日的 Owner 风险接受。

## 7. 每张任务的执行纪律

- 会话恢复先读根 `AGENTS.md` 和机器真源，运行一次 `doctor.py --summary`；再读活动卡、Context Lock、
  精确 Skill 版本和 delivery policy。
- 永远只有一个活动任务；PLANNED 不可直接执行；所有修改必须在 writeAllowlist 内，forbiddenPaths 优先。
- READY 后需要扩大路径、改变数值/语义或触碰新风险面时停止，走强类型 Owner amendment 或失败关闭后
  replacement，不能自批。
- 修改前读调用链和现有测试；复用项目 helper，不建第二套计划/ADR/lifecycle/Evidence。
- 使用 OrbStack Docker；不要寻找或启动 Docker Desktop。
- 候选精确暂存，保持 index/worktree/tree 身份一致；C3/C4 使用真正独立 Reviewer。
- R1 有阻塞时只允许 policy 规定的一次 fix batch；R2 只验证 closure/delta/adjacent risk；禁止 R3。
- Reviewer PASS 后才运行 canonical 和 exact-tree channel；canonical、根级特殊门禁、`git diff --check`
  按任务卡次数执行，不能通过重复运行“提高可信度”。
- FAIL、TIMEOUT、UNKNOWN、NOT_RUN、配额耗尽和局部测试都不得写成 PASS。
- 终态原子更新 task card、project-state、Task Ledger、完整 Evidence/Handoff；push 后复核远端分支、
  candidate/terminal SHA、0/0 状态和 exact-tree 结果。
- 不改写 Accepted/Rejected 历史，不删除测试、不加 skip、不吞退出码、不提交 secret/真实联系人/真实用户数据。
- 用户已授权低风险合理假设继续推进；仅在范围、成本、权限、数值、架构、不可逆历史、发布门禁或高风险
  选择时集中提问。

## 8. 可直接复制给 ZCode 的提示词

```text
请接手并继续修复仓库 /Users/hxf/projects/virtual-companion。

先完整读取：
1. /Users/hxf/projects/virtual-companion/AGENTS.md
2. .harness/project-state.yaml、task-ledger.yaml、task-backlog.yaml、sources-of-truth.yaml、
   invariants.yaml、protected-paths.yaml、task-lifecycle.yaml、task-delivery-policy.yaml、skills.yaml
3. 当前活动任务卡与 Context Lock、卡中精确 Skill
4. docs/evidence/TASK-0109/zcode-remediation-handoff.md
5. docs/evidence/TASK-0109/review-r1.md

机器真源、当前 Git 和代码优先于交接文档；不要依赖旧聊天摘要。先核对 branch、HEAD、origin/main、
ahead/behind、工作树、activeTask、任务状态、candidate Commit/Tree 和 hard-fuse 时间，运行项目规定的一次
doctor summary。不要修改或删除用户/其他 Agent 的现有改动。

当前已知：TASK-0109 候选 cdddc1b / tree 75753c3 尚未 push，R1 已 FAIL。阻塞项是 SSE/非流响应在
无界物化后才检查上限，以及 git diff --check 被多次调度。不要 reset/rebase/squash/force-push，不要
删除或改写 R1，不要在当前 TASK-0109 上再运行 canonical、根级 Maven 或 git diff --check 来伪造闭环。

你的第一项工作不是继续追加源码，而是按当前 lifecycle/policy核对并提出 TASK-0109 原子 REJECTED +
新永久 replacement task 的执行方案。第一次回复请只向我集中确认两个高风险决定：
1. 是否授权按推荐路径失败关闭 TASK-0109、push/远端复核后创建 replacement（若下一个 ID 仍空闲则
   TASK-0110），禁止重写同一任务历史；
2. replacement 是否采用非流原始 HTTP body 8 MiB 上限，同时保留既有 Owner 已确认的 64 条、
   64 KiB、16 KiB、1 MiB、1 MiB、8192 六个上限。

replacement 必须授权 SseDecoder 和可证明 early-stop 的测试：读取阶段按字节有界，超限首字节即停止并
cancel；限制 data/comment/未知字段/无分隔长事件；兼容 UTF-8、LF/CRLF、多行 data；非流在 Jackson
readTree 前限制 raw body；LiveModelInvoker 显式 session.cancel；用 counting/throwing stream 证明不
继续消费，并验证 quota/audit/无部分输出。无界 queue 对象数、schemaName 和总请求体若不纳入，必须
经 Owner 决策后写入 remaining risk。

Owner 确认后，严格一张卡一张卡串行执行：唯一 active task、只写 allowlist、forbidden 优先、READY
Doctor、候选冻结、独立 Reviewer、Reviewer PASS 后 canonical/exact-tree、终态 Evidence/Handoff、
pre-closure、单父原子提交、push 和远端复核。C3/C4 必须独立 Review；canonical 和 git diff --check
按卡规定只执行一次。使用 OrbStack Docker，不使用 Docker Desktop。任何 FAIL/TIMEOUT/UNKNOWN/
NOT_RUN/局部测试都不能写成 PASS。

TASK-0109 replacement 闭环后，按交接文档第 3 至第 6 节处理所有 OPEN/OWNER_GATE 和新审计候选。
已由 TASK-0095..0108 ACCEPTED 的项不要重复修，除非当前 HEAD 可复现回归。遇到 DB trusted principal、
认证限流阈值、单 Admin 语义、canonical Python、平台支持、扫描器/例外策略、任务注册方式等决策时问我；
低风险实现细节自行按现有模式推进。

所有既有项闭环后，重新做一次完整项目审计，至少拆分治理/CI、依赖质量、后端协议和状态机、数据库
并发/RLS/migration、前端 transport/UI、安全与发布门禁；用当前代码和真实测试逐项验证，不能仅引用
旧任务号。最终交付新的审计清单、每项状态、证据 SHA/命令/结果和唯一下一动作。
```

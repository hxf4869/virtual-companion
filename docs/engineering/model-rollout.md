# 模型版本升级 / 灰度 / 回滚流程（MODEL-ROLL，§12.14 / §12.8 / R49）

**状态：流程与配置位文档（Agent 代拟，Owner 复核）。** 2026-08-23 Owner
已确认 S0-24 单账号内部 Canary 阈值，Owner 本人担任当前主要告警接收人；
飞书应用机器人告警通道已于 2026-08-24 完成真实群投递验证；S0-24-B2 的
调用观测与不可变版本绑定底座也已完成。替补、唯一内部账号、供应商不可变
revision 和 D0 GO 等剩余门禁仍待确认，本文不代表 Canary/Beta 已获批。

## 1. 原则

- 模型是**配置的部署**（`ops/model-providers.example.yml` 的
  `deployments[]`），不是代码：换模型/灰度/回滚全部走部署配置变更 +
  重启/热加载，不改代码。
- 每个部署由 `provider-id` 唯一标识；路由审计落在 `generation_route`
  （每次决策可追溯 provider_ref）。
- 运行期资格取配置 `enabled=true` 与 durable
  `vc.provider_deployment.admission_state=ADMITTED` 的交集；缺任一条件都
  fail-closed。紧急回滚先把 durable 状态置为 `DISABLED`，再把部署
  `enabled: false` 并重启，既立即截断新路由，也确保重启后仍关闭。

## 2. 升级流程（登记 → 评测 → 小流量 → 全量）

1. **登记**：新模型以**新增 deployment 条目**加入（`enabled: false`），
   记录 model 版本号、日期、理由到本文档 §5 变更台账；
2. **评测**：跑既有合约测试（OpenAI/Anthropic contract-tests）+ 
   `infra/db/measure/run-measure.sh` 全套 + MEM-EVAL 抽样回归；
3. **小流量**：新条目保持 `enabled: true`，但只有 Owner 指定的 Canary
   部署进入 durable `ADMITTED`；不得依赖 YAML 列表顺序做权重——当前路由
   在健康/会话粘滞约束下按 `provider-id` 排序。观察
   `/actuator/prometheus` 的 `vc_provider_attempt_total{result}` 与
   `vc_generation_duration`,以及 B1-COST 日对账漂移；
4. **全量**：稳定后把旧条目 `enabled: false` 或移除;台账记完成日期。

### 2.1 S0-24-A 合成评测门禁

固定 profile `e2e-synthetic-v1` 只使用隔离 PostgreSQL、回环
`e2e-openai` / `e2e-model` 和合成账号；连接/首 token/总超时分别为
1s/2s/3s。它不读取真实 Provider 凭据，也不产生真实 Provider 费用。

唯一编排入口：

```bash
bash scripts/dev/synthetic-eval.sh
```

该入口在当前工作树构建 runtime，运行固定 1,000 条红队语料、复合
safety/moderation、OpenAI-compatible 429/5xx/断流/超时合约、服务级
`SYNTHETIC/eval=false` fail-closed 负例与 ReleaseGate 快照单测，再以真实
浏览器跑「角色→聊天」和「输出安全拦截/供应商超时」两条纵切。浏览器
纵切只在新建的回环数据库内临时进入 `BETA/eval=true`，因为生产代码不再
提供绕过 ReleaseGate 的 Alpha 早返回；启动前必须先确认
`SYNTHETIC/eval=false`，teardown 必须先确认预期的隔离 BETA 状态，再回退并
确认 `SYNTHETIC / eval=false / e2e-synthetic-v1` 后销毁数据库。任一步失败
即非零退出。

该临时 BETA 只存在于无真实凭据、不可复用、测试后销毁的本机数据库，
不代表也不会触碰任何真实环境 gate。PASS 只是进入内部 Canary 的必要
条件；真实 Canary/Beta 仍需 Owner 确认账号、值班和其余门禁。结果只记入
现有 `docs/beta-readiness/records/`，不新建第二套 check/evidence 体系。

### 2.2 S0-24-B1 单账号硬门禁（实现完成，未启用）

V95 把唯一 `canary_owner_user_id` 与 stage/eval/policy 放在同一数据库行：
`CANARY` 必须绑定一个当时为 `ACTIVE USER` 的账号，其他阶段必须没有绑定。
运行时在创建 generation 及任何正文/任务持久化之前，将认证账号与该绑定
逐次比较；未绑定、不匹配、未知阶段、快照读取失败或账号失效均拒绝。
`VC_ADMISSION_ENFORCE=false` 只关闭成年/同意/Beta-switch 检查，不能绕过
ReleaseGate。表和推进函数均不授权 runtime role；`vc_api` 只能读取受控快照。

实际 Canary 仍未启动。V96/V97 已完成不可变 model/prompt/config bundle、
首 token 与失败分类观测；仍须按 §2.3 配齐供应商 revision，并私下选定唯一
内部账号后，operator/migrator 才可执行（账号 ID 不得写入仓库、日志或公开
记录）：

```sql
SELECT vc.advance_release_gate(
    'CANARY', true, '<immutable-policy-version>', <internal-account-id>
);
```

真实 Canary 还必须设置 `VC_ADMISSION_ENFORCE=true`、
`VC_BETA_GENERATION_ENABLED=true` 和已确认的必要同意集合；这些是成年/同意
门禁，不是单账号 ReleaseGate 的开关。

V95 升级前置：若目标库仍在 V94，先把新 Provider durable
`DISABLED`，再用旧三参数函数回退到安全状态：

```sql
SELECT vc.advance_release_gate(
    'SYNTHETIC', false, '<pre-v95-rollback-policy-version>'
);
```

确认快照为 `SYNTHETIC/eval=false` 后再应用 V95。历史
`CANARY`（尚无 owner 列）或 `SYNTHETIC/eval=true` 会被 V95 约束安全拒绝，
不会静默迁移成可放量状态。

### 2.3 S0-24-B2 调用观测与不可变版本绑定（实现完成，未实测 Canary）

V96 在 `vc.attempt_intent` 持久化 `attempt_started_at`、
`first_output_latency_ms`、`terminal_at` 和固定枚举 `failure_code`。开始时间与
intent 在外发前同事务写入；首输出只在 JVM 内用单调时钟测量，execute 返回后
才写库，流式回调中没有数据库访问。失败只记录 `HTTP_429`、`HTTP_5XX`、
`DISCONNECTED`、三种 timeout 或 `OTHER`，不记录异常正文、对话正文或请求体。

V97 为每个新真实 attempt 固定并只写一次：实际选中 deployment 的 `model_id`、
显式 `model_revision`、`config_version`，assembler 的
`prompt_bundle_version` / `persona_bundle_version`，以及 intent 创建时数据库
锁定读取的 `release_stage` / `release_policy_version`。历史行允许整组为 NULL，
新调用必须整组完整；旧十参数写入口和缺版本 deployment 均 fail-closed。
trigger 保护 provider identity 与 release bundle，runtime role 无法直接更新。
真实调用后的审计/finalize 异常会在新的 owner 事务中幂等归还持久配额。

启用 deployment 时必须同时配置：

```yaml
model: <实际发送给供应商的模型标识>
model-revision: <供应商明确提供的不可变 revision>
config-version: <运营方对该 deployment 配置的版本>
```

`model` 可能是会漂移的 alias，不能复制到 `model-revision` 伪装成不可变版本。
如果供应商不能提供或证明不可变 revision，该 deployment 不满足本次 Canary
门禁，应保持 `enabled: false`。当前代码中的 prompt/persona bundle 版本分别为
`companion-chat-v1` 与 `gentle-listener-v1`；修改实际组装内容时必须同步换版。

真实 Canary 开始后，由具备最小只读权限的 operator 在私有会话中代入唯一
账号 ID 执行下列查询；不得把账号 ID 或结果中的稳定标识提交到仓库：

```sql
-- 最近 20 个有真实 attempt 的请求：不足 20 只算 warm-up。
WITH latest_attempt AS (
    SELECT DISTINCT ON (ai.generation_id)
           ai.generation_id,
           ai.status AS attempt_status,
           ai.first_output_latency_ms,
           ai.attempt_started_at,
           g.status AS generation_status
      FROM vc.attempt_intent ai
      JOIN vc.generation g
        ON g.owner_user_id = ai.owner_user_id AND g.id = ai.generation_id
     WHERE ai.owner_user_id = <internal-account-id>
       AND ai.release_stage = 'CANARY'
     ORDER BY ai.generation_id, ai.attempt_started_at DESC, ai.id DESC
), recent AS (
    SELECT * FROM latest_attempt
     ORDER BY attempt_started_at DESC, generation_id DESC
     LIMIT 20
)
SELECT count(*) AS sample_size,
       count(*) FILTER (
           WHERE attempt_status = 'SUCCEEDED'
             AND generation_status = 'COMPLETED') AS successful_requests,
       percentile_cont(0.95) WITHIN GROUP (
           ORDER BY first_output_latency_ms)
           FILTER (WHERE first_output_latency_ms IS NOT NULL) AS first_token_p95_ms
  FROM recent;

-- 最近 5 个 Provider attempt 是否全部为约定的供应商失败。
WITH recent AS (
    SELECT status, failure_code
      FROM vc.attempt_intent
     WHERE owner_user_id = <internal-account-id>
       AND release_stage = 'CANARY'
       AND terminal_at IS NOT NULL
     ORDER BY attempt_started_at DESC, id DESC
     LIMIT 5
)
SELECT count(*) AS sample_size,
       count(*) = 5 AND bool_and(
           status IN ('RETRYABLE_FAILED', 'NON_RETRYABLE_FAILED', 'TIMED_OUT')
           AND failure_code IN (
               'HTTP_429', 'HTTP_5XX', 'DISCONNECTED',
               'TIMEOUT_CONNECT', 'TIMEOUT_FIRST_TOKEN', 'TIMEOUT_TOTAL',
               'OTHER'))
           AS five_consecutive_provider_failures
  FROM recent;
```

第一条查询只有在 `sample_size=20`、`successful_requests>=19` 且
`first_token_p95_ms<=60000` 时满足扩大流量的这部分条件；它本身不授权扩大。
第二条查询用于 durable 复核；进程内熔断器仍会在第 5 次连续失败时自动 OPEN
并发送既有飞书告警。

## 3. 回滚触发条件（任一即回滚）

### 3.1 S0-24 单账号内部 Canary 阈值（Owner 2026-08-23 确认）

- 范围严格限制为 **1 个内部测试账号**；测试消息总数不设上限。
- 不增加 Canary 专用的单条或累计 output-token 上限；单次请求仍受该模型
  部署配置的 `max-tokens` 约束。此决定不移除 `BudgetGuard`、供应商账户
  费用上限或 B1-COST 对账。
- 最近 20 条请求采用滚动窗口：至少 19 条成功；样本不足 20 条时只作
  warm-up，不据此扩大流量。低于 19/20 只阻止扩大流量并进入人工复核，
  不单独触发自动停机。
- 首 token P95 不超过 60 秒；不设置完成时延 P95 门槛。
- runtime 的单次调用 240 秒硬超时继续保留；命中硬超时按失败计，不能以
  “完成时延不限”绕过租约和防重复调用保护。
- 任一安全泄漏立即由 Operator 调用 V98 受限函数 durable 回滚（数据库拒绝
  `SAFETY_LEAK + AUTO`）；连续 5 次供应商失败触发熔断 OPEN、
  `PROVIDER_CIRCUIT_OPEN`，并自动以 `CONSECUTIVE_FAILURES + AUTO` 将匹配部署
  durable `DISABLED`、追加脱敏历史和发送 P1 结果告警。HTTP 429、5xx、流中断
  和硬超时均计为失败。

### 3.2 通用回滚触发条件

- `vc_generation_total{result=failed}` 连续 10 分钟显著高于基线;
- 安全拦截率突变（`vc_safety_event_total` 异常抬升）;
- B1-COST 单日对账漂移超容差;
- 输出质量抽检不合格（Owner 判定）。

回滚操作：先通过受限函数 `vc.rollback_provider_deployment(..., 'OPERATOR')`
将新部署收紧为 `DISABLED` 并留下历史，禁止直接 UPDATE；再把
部署 `enabled: false`、按需恢复旧部署、重启 runtime，并通过受限推进函数把
发布门禁退回 `SYNTHETIC/eval=false`。会话内已产生的消息/记忆不受影响（记忆与正文按
owner 存储，与模型解耦）。

## 4. 会话粘滞（§12.8,ROUTE-HARDEN 承接）

同一会话在健康时偏好同一部署(轮次边界才允许切换);实现随 ROUTE-HARDEN
熔断器一并交付——粘滞键为 conversation_id,健康变化(熔断 open/half-open)
是唯一允许的会话中途切换原因。

## 5. 变更台账（Owner 追加）

| 日期 | provider-id | model | 动作 | 备注 |
|---|---|---|---|---|
| （待填） | | | 登记/灰度/全量/回滚 | |


## 6. 灵活供应商接线增量（协议/egress 基础已完成，真实启用待审批）

以 OpenCode Go / Hy3 为首个外部供应商(OpenAI 兼容,端点
`https://opencode.ai/zen/go/v1/chat/completions`,模型 id `hy3`,直连探测
已验证 key/协议/响应形状)。当前两道门阻止接入,实施清单:

**2026-08-24 对账**：下列 1–3 与 policy/DNS/redirect contract 已完成，且 OpenAI/
Anthropic 共享同一 `VC_MODEL_EGRESS_ALLOWED_HOSTS`；4–5 及真实外发 E2E 仍依赖
供应商/费用/Owner 发布批准，Provider 和 ReleaseGate 保持关闭。

1. `OpenAiChatCompletionsConfig.requireEndpoint`:路径校验从「恰等于
   /v1/chat/completions」放宽为「endsWith(/v1/chat/completions)」;
2. 出站白名单可配:`ProviderEgressPolicy.defaults()` 在
   OpenAiChatCompletionsConfig(:127)与 AnthropicMessagesConfig(:137)为
   硬编码;新增可选构造参数注入额外批准主机(如 opencode.ai),经
   Provisioner 从部署配置 `egress-allowed-hosts` 读入;
3. `EgressDnsGuard`(session 内 DNS 解析守卫)同步使用注入策略;
4. 部署配置:deployments 增 opencode-go 条目(enabled=true,model=hy3,
   credential-secret=opencode-go-api-key),密钥经
   VC_MODEL_SECRET_OPENCODE_GO_API_KEY 注入(本机 .env.local 已备);
5. max-tokens 必须 ≥2048(Hy3 为推理模型,思考消耗 token,content 才产出);
6. 测试:EgressPolicy 自定义主机用例 + 合约测试回归 + 本机全栈 E2E
   (admin→invite→user→generation 走通 Hy3)。


## 7. Hy3 本机联调现场记录（已跑通,2026-08-22 收口）

### 结论

本机全栈（https://localhost, compose 项目 vc-local）已用真实外部模型端到端
跑通:hy3 经 opencode-go 部署产生真实回复并完成全审计链落库;SSE 流式增量
（chat.delta）在生成过程中实时到达;usage 真实记账。

### 上一会话遗留谜题的解（Bean 未激活 → 实际全部激活）

用 /actuator/conditions 结合 admin token 直连 runtime 实证:

- `ApprovedModelProviderConfig` 与 `AuthDataSourceConfig#authorizationSnapshotProvider`
  均为 **positiveMatches**;`ZeroLlmModelRuntimeConfig` 为 **negativeMatches**
  ——条件装配一直正常,「Bean 未激活」推断不成立;
- 每次 generation 双快照（V26）正常 mint,provider_id=opencode-go（路由候选
  排序首位）;entitlement mint=ECONOMY（外部允许）;
- 真正根因一:**`QuotaLedger` 生产装配从不 provision 任何 owner**——
  `ApprovedModelProviderConfig.quotaLedger()` 直接 `new QuotaLedger()`,
  而 reserve 对未知 owner 恒返回 empty,`DeterministicRouter.tryExternal`
  恒 null → 折叠 ZERO_LLM。修复:QuotaLedger 增加 default-allowance 构造
  （首次 reserve 自动预置,release 不越界）,装配传 Long.MAX_VALUE 合成额度
  （TechAlpha 无真实成本,真实花费由 BudgetGuard §22.18 基于
  vc.generation_usage 执行）。

### 跑通过程中的其余阻塞与修复（按序）

1. **部署 jar 陈旧**:Dockerfile 直接 COPY 本地
   `service/apps/runtime/target/*.jar`,必须先在宿主机 `./mvnw verify`
   产出新 jar 再 `compose up -d --build`;只改代码不 verify 时镜像里是旧包。
2. **外部超时预算 1s**:`LiveInvocationAssembler.assembleExternal` 硬编码
   TimeoutBudget(1s,1s,1s),推理模型必超时;改为
   `virtual-companion.external-attempt.timeout-connect/first-token/total`
   （默认 10s/60s/240s,env VC_EXTERNAL_TIMEOUT_* 可调）。
3. **claim 租约 30s 过期**:真实外部调用 30s+ 期间租约到期,finalize 段
   `assert_active_claim` 全拒、coordinator 回收重排有重复调用风险;修复:
   外部 prepare（写 intent 前）对 per-item 续租
   `virtual-companion.worker.external-claim-lease-seconds`（默认 300）,0 行
   续租即 fail-closed 中止。实测 intent 状态从 FAILED 变 SUCCEEDED。
4. **finalize_generation 参数解析失败**:Java double 经 pgjdbc 绑定为 float8,
   PG 对 numeric 参数无隐式转换,报 `does not exist`（ZERO 路径用字面量 0
   未暴露）;两处调用点（GenerationFinalizeService /
   FinalizeGenerationService）改 `?::numeric`。
5. **reconcile 无限报错**:GenerationReconcileScheduler 直接调
   terminalize（无 V27 owner 上下文）→ `p_owner_user_id does not match`;
   改为经 OwnerExecutor（auth 侧传 `ownerContext::asOwner`）执行,顺带证明
   Modulith 无环（worker 不依赖 auth 类型）。
6. **历史消息密文入请求**:vc.message 全量 CRYPTO-REST 加密,但
   `MessageRepository.listByConversation`（assembler 与 memory-extract 共用）
   原样返回 enc1: blob,模型将历史当作「encoded thoughts」;注入
   RestFieldCipher 在读取路径解密,legacy 明文与无 cipher 构造保持直通。

### 验收证据（generation 11/12/13,owner 1000002）

- status=COMPLETED,usage input 340~975 / output 1317~3001（真实 provider）;
- 事件流 seq 1 → 66（64 delta seq 块已预留 → 外部模式确定）;
- 审计链:attempt_intent SUCCEEDED（opencode-go,双快照 id）+
  entitlement_snapshot ECONOMY + authorization_snapshot ACTIVE×2 +
  generation_usage（provider_ref=pa-<hash>,cost 0 因 TechAlpha 不计费）;
- SSE:生成中实时捕获 24 个 `chat.delta` 增量事件（`payload` 逐段中文,
  seq 2..24）;H5 前端 realtime-transport 单测覆盖 delta 解析;
- hy3 实测回复（gentle-listener,温度 0.8）:「听到你说加班到这么晚、
  感到有些累……我就在这里陪着你,你想随便说点今天的琐事,或者只是
  默不作声地待一会儿,都很好。」人设一致,PASS 无需调温;
- max-tokens:hy3 由 2048 → 4096（.local 配置,gitignored）,gen 11 实测
  output 3001 token,2048 会截断,PASS;
- H5 页面人工目验（https://localhost 登录对话）:头部无头 Chrome 渲染空白,
  未目验（NOT_RUN,建议本机真实浏览器点验）;协议层 SSE 证据见上。

### 遗留说明

- `vc.provider_attempt`（V20 `record_provider_attempt`）仍是无现行调用方的
  早期遗留表；`vc.generation_route` 已由 V81 的
  `record_route_decision` 重新接线为当前路由决策审计。外发结果审计由
  `attempt_intent`、`generation_usage`、`entitlement_snapshot` 和
  `authorization_snapshot` 共同承载。
- override 中的 DEBUG 日志 / env+conditions 端点（含 SHOW_VALUES=always）为
  调试临时项,已移除还原为 health,prometheus。

# 模型版本升级 / 灰度 / 回滚流程（MODEL-ROLL，§12.14 / §12.8 / R49）

**状态：流程与配置位文档（Agent 代拟，Owner 复核）。** 灰度权重位随真实
provider 接线（R49 适配器）落地；本文先行钉死流程与回滚语义。

## 1. 原则

- 模型是**配置的部署**（`ops/model-providers.example.yml` 的
  `deployments[]`），不是代码：换模型/灰度/回滚全部走部署配置变更 +
  重启/热加载，不改代码。
- 每个部署由 `provider-id` 唯一标识；路由审计落在 `generation_route`
  （每次决策可追溯 provider_ref）。
- 灰度期新旧部署并存；回滚 = 把新部署 `enabled: false` + 重启（秒级，
  无数据迁移）。

## 2. 升级流程（登记 → 评测 → 小流量 → 全量）

1. **登记**：新模型以**新增 deployment 条目**加入（`enabled: false`），
   记录 model 版本号、日期、理由到本文档 §5 变更台账；
2. **评测**：跑既有合约测试（OpenAI/Anthropic contract-tests）+ 
   `infra/db/measure/run-measure.sh` 全套 + MEM-EVAL 抽样回归；
3. **小流量**：将新条目置 `enabled: true` 并排在旧部署之后（确定性路由
   按列表序 failover——排后者即只承接 failover 流量）；观察
   `/actuator/prometheus` 的 `vc_provider_attempt_total{result}` 与
   `vc_generation_duration`,以及 B1-COST 日对账漂移；
4. **全量**：稳定后把旧条目 `enabled: false` 或移除;台账记完成日期。

## 3. 回滚触发条件（任一即回滚）

- `vc_generation_total{result=failed}` 连续 10 分钟显著高于基线;
- 安全拦截率突变（`vc_safety_event_total` 异常抬升）;
- B1-COST 单日对账漂移超容差;
- 输出质量抽检不合格（Owner 判定）。

回滚操作：旧部署 `enabled: true`、新部署 `enabled: false`、重启 runtime;
会话内已产生的消息/记忆不受影响(记忆与正文按 owner 存储,与模型解耦)。

## 4. 会话粘滞（§12.8,ROUTE-HARDEN 承接）

同一会话在健康时偏好同一部署(轮次边界才允许切换);实现随 ROUTE-HARDEN
熔断器一并交付——粘滞键为 conversation_id,健康变化(熔断 open/half-open)
是唯一允许的会话中途切换原因。

## 5. 变更台账（Owner 追加）

| 日期 | provider-id | model | 动作 | 备注 |
|---|---|---|---|---|
| （待填） | | | 登记/灰度/全量/回滚 | |


## 6. 灵活供应商接线增量（已勘定,待执行）

以 OpenCode Go / Hy3 为首个外部供应商(OpenAI 兼容,端点
`https://opencode.ai/zen/go/v1/chat/completions`,模型 id `hy3`,直连探测
已验证 key/协议/响应形状)。当前两道门阻止接入,实施清单:

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

- `vc.provider_attempt`（V20 record_provider_attempt）与 `vc.generation_route`
  为早期设计遗留表:前者服务方法无任何调用方,后者无任何写入函数;现行审计
  等价物为 attempt_intent + generation_usage + entitlement_snapshot +
  authorization_snapshot。如需旧表落库需另行接线（未做,超范围）。
- override 中的 DEBUG 日志 / env+conditions 端点（含 SHOW_VALUES=always）为
  调试临时项,已移除还原为 health,prometheus。

# 模型版本升级 / 灰度 / 回滚流程（MODEL-ROLL，§12.14 / §12.8 / R49）

**状态：流程与配置位文档（Agent 代拟，Owner 复核）。** 2026-08-23 Owner
已确认 S0-24 单账号内部 Canary 阈值，Owner 本人担任当前主要告警接收人；
飞书应用机器人告警通道已于 2026-08-24 完成真实群投递验证；S0-24-B2 的
调用观测与不可变版本绑定底座也已完成。替补、唯一内部账号、供应商不可变
revision 和 D0 GO 等剩余门禁仍待确认，本文不代表 Canary/Beta 已获批。

## 1. 原则

- 模型供应商、模型与全局路由是管理员配置，不是代码或部署文件；统一通过
  “管理 → 模型供应商”页面及 ADMIN-only Go API 修改。
- 供应商配置保存在 `vc.provider_config`，模型与优先级保存在
  `vc.provider_model`；凭据以 `enc2` 加密保存且读取接口不回显。
- 运行期只选择供应商和模型均为 `ENABLED` 的路由，并同步维护
  `vc.provider_deployment.admission_state`。紧急回滚在页面禁用供应商或模型，
  新 generation 随即停止选择该路由，无需重启 runtime。

## 2. 升级流程（登记 → 评测 → 小流量 → 全量）

1. **登记**：在管理员页面新增供应商，保存 Base URL/API Key，发现或手工添加
   模型；供应商先保持 `DISABLED`，记录模型版本、日期和理由；
2. **评测**：跑既有合约测试（OpenAI/Anthropic contract-tests）+ 
   `infra/db/measure/run-measure.sh` 全套 + MEM-EVAL 抽样回归；
3. **小流量**：只启用 Owner 指定的 Canary 路由，并把它放在全局优先链首位；
   当前路由是确定性的主备顺序，不支持权重随机。观察
   `/actuator/prometheus` 的 `vc_provider_attempt_total{result}` 与
   `vc_generation_duration`,以及 B1-COST 日对账漂移；
4. **全量**：稳定后在页面禁用或删除旧模型，并在台账记录完成日期。

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
## 6. 当前供应商接线

管理员登录后在“管理 → 模型供应商”完成全部接线：

1. 创建供应商，选择协议并填写 Base URL 与 API Key；
2. 使用模型发现或手工维护模型；供应商启用前至少要有一个启用模型；
3. 在全局路由中按主备顺序排序，默认最多尝试两条安全路由；
4. 先在隔离/Owner-only 环境验证 health、generation、SSE、usage 与预算；
5. 发生 §3 任一触发条件时，立即在页面禁用模型或供应商并复核审计记录。

凭据只以加密 envelope 写入 PostgreSQL，列表接口仅返回
`credentialConfigured`。旧部署文件、进程启动参数和环境变量接线路径已退役，
不得恢复为第二配置真源。

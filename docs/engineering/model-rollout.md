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

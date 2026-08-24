# S0-24 真实 Provider 合成 Smoke 记录

- 日期：2026-08-23；执行：Agent（本地）；Owner 已明确授权一次低成本、仅合成内容的真实调用。
- 环境：OrbStack `vc-local` 单 runtime；当前工作树构建的 runtime jar；边缘、数据库和 Provider
  均为本机部署，不开放真实用户。
- 结论：**PASS（仅 S0-24 合成 smoke）**。本记录不是内部 Canary 或真实用户 Beta 的 GO。

## 版本与门禁绑定

| 项目 | 本次有效值 | 可追溯性 |
|---|---|---|
| 工作树基线 | Git `aaf53fb2` | 工作树含尚未提交的 S0-23/S0-24 改动，不是可发布的不可变制品版本 |
| Provider / 协议 | `weixin-ds-flash` / `OPENAI_CHAT_COMPLETIONS` | 本次唯一临时 `ADMITTED` 的部署；结束后恢复为 `DISABLED` |
| 供应商 / 模型标签 | `WeChat` / `Deepseek-v4-flash` | 仅能确认部署标签；供应商侧不可变模型修订号未提供，标记为 `NOT_VERIFIED` |
| Persona / Prompt | `gentle-listener`，请求模式 `CASUAL` | Persona 相关受控文件最后变更 `2938aa65`；尚无独立 prompt bundle 版本 |
| 本次操作配置标签 | `local-synthetic-smoke-v1` | 非敏感有效配置：`maxTokens=64`、`temperature=0.8`；Endpoint 和凭据不入记录 |
| Eval / 发布门禁 | `SYNTHETIC / eval=false / synthetic-v1` | 调用前后均一致；未推进到 `CANARY` 或 `BETA` |

凭据仍只存在于 Git 忽略的本机部署配置，文件权限为 `0600`；本次未输出、复制或记录
密钥、账号、Endpoint、对话正文或真实用户数据。

## 执行结果

| 检查 | 结果 | 观测 |
|---|---|---|
| 最新 runtime 启动 | PASS | 原地重建唯一 runtime 后健康检查 `UP`；V87/V93 ReleaseGate 已生效 |
| 路由收敛 | PASS | durable registry 原为空；本次只临时准入 `weixin-ds-flash`，其他配置部署持续 fail-closed |
| 合成生成 | PASS | 终态 `COMPLETED`；事件仅记录类型 `chat.accepted`、`chat.completed`，不记录正文 |
| 用量落库 | PASS | input 25 tokens、output 5 tokens；应用侧 `actual_cost=0.000000 USD` |
| 外部链路 | PASS | runtime 明确记录 generation 由 external provider 完成，候选用量与快照一致 |
| 自动恢复 | PASS | Provider 恢复 `DISABLED`；ReleaseGate 保持 `SYNTHETIC/eval=false`；合成关系删除返回 HTTP 200 |
| 配置恢复 | PASS | 临时 64-token 上限恢复为原部署值，runtime 重启后健康检查仍为 `UP` |

`actual_cost=0` 只是应用当前计价配置的结果，**不能证明供应商账单为零**，不得作为成本
对账证据。整个授权脚本约 4.1 秒结束，但其中包含登录、建关系、轮询和清理，不能替代
首 token 或独立完成时延测量；两项发布指标仍标记为 `NOT_MEASURED`。

## 检查偏差

初始检查错误地查询历史表 `vc.provider_attempt`，因此脚本最终以非零退出；当前外部 worker
审计权威表为 `vc.attempt_intent`。这是检查命令选表错误，不是 Provider 调用失败：生成终态、
用量落库及 runtime external-provider 完成日志相互一致。合成关系随后按计划删除，其关联审计
也随级联清理；为避免未经授权的第二次费用，本轮没有重发请求补取审计行。

正式 eval 工具应在清理前读取 `vc.attempt_intent`，并只输出 Provider、终态和计时等非正文
字段。

## 关联自动化验证

- Playwright 真实浏览器旅程：7/7 PASS（隔离 fake provider 环境）。
- `MeasureRedTeamCorpusTest`：固定 1,000 条语料（500 red / 500 benign）PASS；零泄漏、零误拦。
- JDK 25 Maven Verify：15 个 reactor 模块 PASS；runtime 727 个测试 PASS。
- `bash scripts/check.sh`：catalog、OpenAPI、付费特性、许可证、前端测试和类型检查全部 PASS。

## Owner 已确认的内部 Canary 阈值（2026-08-23）

- 严格限制为 1 个内部测试账号，测试消息总数不设上限；
- 不增加 Canary 专用的单条或累计 output-token 上限，沿用模型部署配置的
  `max-tokens`；既有预算停机与供应商费用保护不移除；
- 最近 20 条滚动窗口至少 19 条成功；不足 20 条只作 warm-up；低于门槛
  阻止扩大流量并进入人工复核，不单独自动停机；
- 首 token P95 不超过 60 秒，不设置完成时延 P95；
- runtime 240 秒单次调用硬超时保留，命中即按失败计；
- 任一安全泄漏立即人工 durable 回滚；连续 5 次失败触发现有熔断器自动
  OPEN 与告警，Owner 再确认 durable `DISABLED`；429、5xx、流中断和硬
  超时均计失败；
- 主要告警接收人为 Owner 本人；飞书应用机器人通道已于 2026-08-24
  完成轮换后凭据注入与真实群投递（HTTP 200、`code=0`、非空
  `message_id`，Owner 确认收件）；仓库不记录联系方式或通道标识，替补仍待填。

阈值的运维真源同步记录在
[`docs/engineering/model-rollout.md`](../../engineering/model-rollout.md) §3.1。

## 尚未满足的扩大流量条件

- 供应商侧不可变模型版本、独立 prompt/config bundle 版本尚未冻结；
- 首 token、滚动成功率、429/5xx/断流和真实账单漂移尚未按上述阈值测量；
- 主要告警接收人与实际飞书告警通道已确认并验证；替补与值班升级链
  仍未确认；
- D0 GO、真实成年验证、真实 moderation、真实 embedding 未就绪；
- 未指定单个内部 Canary 账号，也未授权真实用户流量。

因此保持 `weixin-ds-flash=DISABLED`、`SYNTHETIC/eval=false`，不得进入内部 Canary 或 Beta。

# 虚拟对象 V0.3.1 技术契约与机器真源起步包

该目录可直接合并到代码仓库根目录。它不是完整应用代码，而是 Technical Alpha 在冻结数据库、API 和状态机前必须具备的最小治理基线：机器可读 Catalog、关键技术契约、零漂移生成器、免费/社区版边界、Beta 硬门禁和首批 Harness 文件。

## 1. 本包解决什么问题

- 统一 `R0_NORMAL`、`RELATIONSHIP`、Generation/Route/Provider Attempt 等 Code；
- 确保一个稳定 `generationId` 可对应多次路由和供应商尝试，但最多一个最终结果；
- 把正式消息、最终审核、`chat.completed`、记忆提取和摘要 Outbox 纳入同一事务契约；
- 明确 Worker Claim、租约、Fence、RLS 和授权快照边界；
- 固化 Fetch-SSE、一次性 Ticket、Gap、Reset、Snapshot 和 H5 安全约束；
- 约束模型只通过 OpenAI-Compatible 或 Anthropic-Compatible 协议适配器进入；
- 阻止 AI 引入付费许可证、企业版、付费插件或 SaaS 专属能力作为核心运行前提；
- 让新 AI 会话能够从仓库恢复范围、真源、任务和证据，而不是依赖聊天记忆。

## 2. 成本边界

除模型推理、Embedding、模型审核算力，以及服务器、存储、带宽等实际资源成本外，本包不要求任何付费软件功能：

- 不要求 JobRunr Pro；
- 不要求 LiteLLM Enterprise；
- 不要求 Langfuse Cloud/Enterprise；
- 不要求 Centrifugo Pro；
- 不要求 Flyway Enterprise；
- 不要求商业向量数据库；
- 不要求付费托管身份服务。

这些社区组件可以按触发条件接入，但都必须位于自有 Port/Adapter 之后，且不能成为消息、记忆、安全、授权、审计或实时恢复的唯一真源。

## 3. 目录

```text
.harness/                    技术基线、许可证、真源、受保护路径和不变量
specs/catalog/               状态、作用域、协议和阶段范围唯一机器真源
specs/contracts/             Generation、事务、Worker、授权、实时和 Beta 契约
specs/generated/             确定性生成物，禁止手改
scripts/harness/             校验、生成、漂移和付费特性检查
skills/                      Alpha 最小 Skill 骨架
ops/                         Beta 值班硬门禁（默认关闭）与示例
ci/                          GitHub/GitLab CI 示例
docs/tasks/                  READY 任务卡模板
docs/schemas/                Evidence/Handoff 示例 Schema
```

## 4. 使用

```bash
python -m pip install -r requirements-harness.txt
python scripts/harness/catalog_tool.py validate
python scripts/harness/catalog_tool.py generate
python scripts/harness/catalog_tool.py diff --fail-on-drift
python scripts/harness/check_paid_features.py
python scripts/harness/check_beta_gate.py
bash scripts/harness/precheck.sh
```

## 5. 接入仓库后的硬规则

1. `specs/catalog/*.yaml` 是 Code 和阶段范围真源；Markdown 不能覆盖它。
2. `specs/generated/**` 禁止手工修改。
3. Catalog、契约、数据库、OpenAPI、Java 和 TypeScript 必须零漂移。
4. Alpha 模型提取的长期记忆候选全部进入 `PENDING_CONFIRMATION`。
5. 长期角色记忆作用域固定为 `RELATIONSHIP`，禁止同义 `COMPANION`。
6. Generation 不包含“可重试失败”；重试属于 Route/Provider Attempt。
7. `chat.completed` 只能来自已提交的最终化事务。
8. 普通 Worker 不得跨租户扫描，运行角色不得拥有 `BYPASSRLS`。
9. OpenAI-Compatible 与 Anthropic-Compatible 保持各自协议语义，不做最低公分母式错误统一。
10. Beta 值班表包含空值、TBD、过期班次或未确认人员时，`beta_generation_enabled=false`。
11. 新增运行时依赖、Major 升级、商业版功能或 SaaS 必须单独 ADR 和人工批准。

## 6. 注意

本包没有填写真实 Beta 责任人和联系方式。`ops/beta-duty-roster.example.yaml` 故意保持关闭状态；在真实人员、有效 Secret 引用、日期和确认记录完成前，不得开放真实用户 Beta。

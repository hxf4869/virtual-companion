# TASK-0011：建立 OpenAI Chat Completions 离线 HTTP/SSE Adapter 合同基线

```yaml
taskId: TASK-0011
state: DRAFT
owner: repository-owner
riskClass: C3
requiredSkills:
  - task-intake
  - model-routing-change
requiredSkillVersions:
  task-intake: 1.1.0
  model-routing-change: 1.0.0
targetSkillVersions: {}
baseCommit: b18dd0dc83a360be014b7b8f322cd42bc6c89e38
authorizationCommit: ""
contextFingerprint: c5b803c6b702c856528fbc97e218f85e86f4808f87201164fde24cfe6ad2c741
contextLock: docs/tasks/context/TASK-0011.context-lock.yaml
contextFingerprintAlgorithm: SHA256_ORDINAL_SORTED_PATH_EQUALS_HASH_LF_V1
readAllowlist:
  - AGENTS.md
  - README.md
  - .github/workflows/ci.yml
  - .harness/**
  - skills/task-intake/SKILL.md
  - skills/model-routing-change/SKILL.md
  - specs/catalog/**
  - specs/contracts/**
  - specs/generated/**
  - docs/architecture/**
  - docs/decisions/**
  - docs/tasks/**
  - docs/handoffs/**
  - docs/evidence/TASK-0010/**
  - docs/schemas/**
  - pom.xml
  - service/platform/catalog/**
  - service/modules/modelruntime/**
  - service/adapters/model-fake/**
  - service/adapters/model-failure/**
  - service/tests/model-protocol-contract-tests/**
writeAllowlist:
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - docs/tasks/TASK-0011-openai-chat-completions-offline-adapter.md
  - docs/tasks/context/TASK-0011.context-lock.yaml
  - docs/evidence/TASK-0011/**
  - docs/handoffs/TASK-0011.json
  - pom.xml
  - service/adapters/model-openai/**
  - service/tests/openai-chat-completions-contract-tests/**
forbiddenPaths:
  - AGENTS.md
  - CLAUDE.md
  - README.md
  - .github/**
  - .harness/task-lifecycle.yaml
  - .harness/sources-of-truth.yaml
  - .harness/invariants.yaml
  - .harness/protected-paths.yaml
  - .harness/skills.yaml
  - .harness/commands.yaml
  - .harness/tools.lock.yaml
  - .harness/license-policy.yaml
  - .harness/agent-entrypoints.yaml
  - skills/**
  - scripts/**
  - specs/**
  - docs/architecture/**
  - docs/decisions/**
  - docs/engineering/**
  - docs/schemas/**
  - docs/source/**
  - service/platform/catalog/**
  - service/modules/modelruntime/**
  - service/modules/conversation/**
  - service/adapters/model-fake/**
  - service/adapters/model-failure/**
  - service/adapters/model-anthropic/**
  - service/apps/**
  - service/tests/model-protocol-contract-tests/**
  - service/tests/generation-contract-tests/**
  - frontend/**
  - db/**
  - deploy/**
  - ci/**
  - ops/**
sourcesOfTruth:
  - AGENTS.md
  - .github/workflows/ci.yml
  - .harness/project-state.yaml
  - .harness/task-lifecycle.yaml
  - .harness/sources-of-truth.yaml
  - .harness/invariants.yaml
  - .harness/protected-paths.yaml
  - .harness/skills.yaml
  - .harness/commands.yaml
  - .harness/tools.lock.yaml
  - .harness/license-policy.yaml
  - skills/task-intake/SKILL.md
  - skills/model-routing-change/SKILL.md
  - specs/catalog/product-scope.yaml
  - specs/catalog/model-protocols.yaml
  - specs/catalog/provider-attempt-statuses.yaml
  - specs/contracts/generation-contract.yaml
  - specs/contracts/model-protocol-contract.yaml
  - specs/contracts/authorization-contract.yaml
  - specs/contracts/finalization-contract.yaml
  - specs/contracts/license-cost-boundary-contract.yaml
  - docs/decisions/0001-v031-technology-and-transport-baseline.md
  - docs/architecture/repository-structure.md
  - docs/handoffs/TASK-0010.json
  - pom.xml
  - service/modules/modelruntime/pom.xml
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/AdapterFailure.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/InvocationBinding.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/ModelPayload.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/ModelProtocolCapabilities.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/ModelProtocolEvent.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/ModelProtocolRequest.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/ProtocolMessage.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/ResponseMode.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/StopReason.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/TimeoutBudget.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/TokenUsage.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/guard/ModelProtocolEventFence.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/port/ModelProtocolAdapter.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/port/ModelProtocolSession.java
requiredInvariants:
  - INV-GEN-001
  - INV-GEN-002
  - INV-GEN-003
  - INV-AUTH-001
  - INV-COST-001
  - INV-HARNESS-002
  - INV-HARNESS-003
  - INV-HARNESS-005
humanApprovals:
  - scope: offline-openai-chat-completions-adapter-only
    approvedBy: repository-owner
    approvedAt: 2026-07-30
    evidence: 用户明确要求在新会话自主建立 OpenAI Chat Completions /v1/chat/completions 离线 HTTP/SSE Adapter 与 127.0.0.1 本地 mock-server 合同基线，并明确排除 Anthropic、Responses API、Runtime 接线、真实网络、凭据、区域、合同、Beta、支付和安全政策决策
independentReview: required
reviewers: []
requiredCommands:
  - .\mvnw.cmd --batch-mode --no-transfer-progress -pl service/tests/openai-chat-completions-contract-tests -am verify
  - .\mvnw.cmd --batch-mode --no-transfer-progress verify
  - python -m unittest discover -s scripts/harness/tests -p test_*.py
  - python scripts/harness/precheck.py --task TASK-0011
  - powershell -NoProfile -ExecutionPolicy Bypass -File scripts/harness/precheck.ps1 -Task TASK-0011
  - wsl.exe -d Ubuntu-24.04 -- bash scripts/harness/precheck.sh --task TASK-0011
  - git diff --check
```

## 背景与用户可观察目标

机器真源已经把 `OPENAI_CHAT_COMPLETIONS` 列为 Technical Alpha 允许的主协议，并要求 `/v1/chat/completions` 的离线 HTTP/SSE Adapter 通过本地 mock-server 合同测试。仓库当前只有供应商中立端口和确定性 Fake/Failure Adapter，尚未证明真实 Chat Completions 请求形状、SSE framing、Usage、终止、超时、取消与迟到事件边界。

本任务在不接入 Runtime、不读取真实凭据、不访问公网的前提下新增一个只依赖 JDK 25、项目已管理 Jackson 3 和现有 `modelruntime` 端口的 OpenAI Chat Completions Adapter，并以仅绑定 `127.0.0.1:0` 的 JDK `HttpServer` 建立可复验合同基线。

## 范围内

- 新增 `service/adapters/model-openai`，实现固定 `/v1/chat/completions` 的非流式 JSON 与流式 SSE 映射；
- 新增 `service/tests/openai-chat-completions-contract-tests`，使用 JDK `HttpServer` 和合成 Token/正文进行离线合同测试；
- 根 `pom.xml` 只登记上述两个模块，Runtime 不依赖新 Adapter；
- 每个合法 Session 恰好调用一次 JDK `HttpClient`，无重试、路由、fallback 或跨 Attempt 拼接；
- 只接受完整 `ExternalAttemptBinding`；确定性 Binding 或构造后仍非法的请求零网络失败关闭；
- 请求固定 `POST /v1/chat/completions`、JSON Content-Type、Bearer Header、模型、供应商中立 messages、stream 与结构化响应字段；
- 流式请求固定发送 `stream_options.include_usage=true`；
- 显式区分 Connect、First Token、Total 三段超时，取消和关闭幂等；
- 终态唯一，终态后所有迟到字节、异步回调和事件均丢弃；
- 非流与 SSE 都把完整输入 Binding 原样映射到连续 sequence 事件；
- 文本流逐 Delta 输出；结构化流先聚合并验证 JSON，成功时只发一个 `StructuredJson`；
- 只有合法 finish reason、完整 Usage 和流式 `[DONE]` 全部出现后才发 Attempt EOS；
- 新代码不记录请求 Header、Token、正文、授权快照或响应正文，Adapter/配置/Session 的 `toString` 不包含这些数据。

## 明确范围外

- Anthropic Messages、OpenAI Responses API、Spring AI、供应商 SDK或第二套模型端口；
- Runtime、API、Worker、Conversation、数据库、RLS、Provider Registry、路由、降级、重试、Quota 或最终化接线；
- 真实 Provider 域名、真实模型准入、环境变量、API Key、代理、DNS、公网或任何非 loopback 测试连接；
- 供应商、区域、合同、价格、配额、安全政策、PIA、Beta、注册或支付决策；
- 修改 Catalog、Contract、生成物、`modelruntime`、Fake/Failure Adapter、现有合同测试、Runtime、前端、数据库、部署、CI、Harness 或 Agent/Skill 规则；
- 把 Provider EOS 解释为 Generation 完成，或把 Adapter 输出写成 Canonical Memory。

## 输入和前置条件

- Base Commit 为 TASK-0010 ACCEPTED 终态 `b18dd0dc83a360be014b7b8f322cd42bc6c89e38`，与 `origin/main` 同步且工作区干净；
- `ModelProtocolAdapter`、`ModelProtocolSession`、完整 `ExternalAttemptBinding`、供应商中立消息/响应模式、三段 `TimeoutBudget`、归一化 Event/Failure 与 Fence Gate 已存在且本任务禁止修改；
- OpenAI 官方 Chat Completions 参考确认当前端点为 `POST /v1/chat/completions`，流式 chunk 使用 `choices[].delta.content` 与 `finish_reason`，`stream_options.include_usage` 在终尾 chunk 提供 Usage；
- 本任务只锁定当前 Chat Completions 合同所需字段，不引入 OpenAI Responses API；
- 使用项目固定 Temurin JDK 25，不改变主机系统 Java。

## API / 事件 / 数据契约

- Adapter `protocol()` 固定返回生成 Catalog 的 `ModelProtocol.OPENAI_CHAT_COMPLETIONS`；
- Adapter 声明 `STREAMING` 与 `STRUCTURED_OUTPUT`，只从供应商专用构造配置读取 endpoint、合成/本地 Token 与模型名；
- 合法请求 body：
  - `model` 为 Adapter 配置；
  - `messages` 只映射 `SYSTEM`、`USER`、`ASSISTANT` 与文本 `content`；
  - `stream` 与中立请求一致；
  - 流式时必须包含 `stream_options: {"include_usage": true}`；
  - 结构化请求使用 Chat Completions `response_format`，包含请求给定的 schema name 与 JSON Schema；
- 非流式 200 只接受 JSON Content-Type、单一 choice/index 0、文本 content、合法 `finish_reason` 和完整 Usage，依次输出一个 Payload、Usage、EOS；
- SSE 200 只接受 `text/event-stream`，最小 decoder 支持 UTF-8、CRLF/LF、注释和多 `data:` 行，拒绝非法字段、非法 JSON、空/多 choices、错 index、重复终止、缺 Usage 或缺 `[DONE]`；
- SSE 文本 Delta 按到达顺序映射；Usage 在完成 chunk 后映射；`[DONE]` 后映射 EOS；
- 结构化流在完成前不暴露局部 JSON，完成后只发一个 `StructuredJson`、Usage、EOS；
- finish reason 映射：`stop → STOP`、`length → LENGTH`、`content_filter → POLICY`，允许的工具调用型终止映射 `UNKNOWN`；其他值失败关闭；
- 429 映射 `RateLimited`，5xx 映射 `UpstreamUnavailable`，解析/Content-Type/协议错误映射 `MalformedResponse`；
- Connect、First Token、Total 到期分别映射对应 `AdapterFailure.TimeoutPhase`，超时后取消唯一 HTTP 操作并封闭事件流；
- 全部事件携带输入完整 Binding，sequence 从 0 连续增长，终态后 `next()` 永远为空。

## 权限、RLS 和数据处理要求

- `ExternalAttemptBinding` 缺 Owner 元组、Attempt ID、Fence 或任一授权快照时由现有值对象拒绝；Adapter 不补默认值；
- `DeterministicSourceBinding`、不支持的 endpoint/request/capability 在调用 `HttpClient` 前失败；
- Authorization Snapshot 只随内部 Binding 事件返回，不写入外部请求 Header/Body；
- 合同测试只使用 `127.0.0.1:0`、合成 Token、合成模型名与合成消息，不读取环境变量或 Secret；
- 新代码没有日志语句，不把 Token、Authorization Header、Prompt、响应正文或授权快照放入异常消息和新类型 `toString`；
- 不写数据库、不改变授权、不结算配额、不创建真实 `provider_attempt` 记录。

## 状态机和失败行为

- 合法 Session 创建时只发起一次请求；任何 HTTP/解析/超时失败都直接形成唯一归一化终态，不重试或 fallback；
- 获取响应头前的连接阶段受 Connect 与 Total 上限共同约束；响应头后直到首个非空 Provider 内容受 First Token 与 Total 上限共同约束；之后只受剩余 Total 上限约束；
- 取消可发生在连接、首 Token、流式中途或终态后；前 3 种只产生一个 `AttemptCancelled`，终态后为空操作；
- 终止仲裁串行化 sequence 与终态；超时、取消、解析失败、正常 EOS 竞争时只有首个终态可见；
- Parser/HttpClient 在终态后产生的迟到数据、异常或回调不得进入事件队列；
- 流式缺 finish reason、Usage 或 `[DONE]` 不得发 EOS；已发文本前缀可以保留，但最终必须为失败；
- 结构化输出只有完整 JSON 验证通过才可作为一个 Payload 发出，局部或非法 JSON 不得泄露为 Text Delta；
- 任何多 choice 或非 0 index 响应失败关闭，避免跨候选拼接。

## 模型、Prompt、记忆和安全边界

- 不调用真实模型，不读取本机凭据，不使用真实域名、真实用户数据或供应商 SDK；
- Adapter 只做协议转换与失败归一化，不决定 Provider、模型准入、区域、合同、路由、重试、fallback 或业务安全策略；
- Prompt 只在内存中序列化到唯一 loopback 请求，不持久化、不记录日志、不进入 Evidence；
- Provider Session 和输出都不是 Canonical Truth，EOS 只终止当前 Attempt；
- 不引入付费软件、企业功能、托管 SaaS、Docker 或外部服务作为构建/测试前提。

## 验收标准

1. 根 Maven 聚合新增且仅新增 OpenAI Adapter 与独立合同测试模块，依赖方向为 tests → model-openai → modelruntime → catalog；Runtime classpath 不含新 Adapter。
2. Adapter 仅接受完整 `ExternalAttemptBinding`，确定性 Binding 形成 `UnsupportedBinding` 且 mock-server 请求计数为 0。
3. 每个合法 Session 的 `HttpClient.sendAsync` 调用计数恰为 1；429、5xx、超时、解析失败和取消均无重试、路由或 fallback。
4. 请求合同逐项断言 method、`/v1/chat/completions`、Content-Type、Bearer Header、model、messages、stream、`include_usage` 和结构化 `response_format`；授权快照不进入请求。
5. 机器真源 14 项 `non_stream_success`、`sse_stream_success`、`unicode_and_long_text`、`usage_mapping`、`finish_or_stop_reason_mapping`、`429_mapping`、`5xx_mapping`、`connect_timeout`、`first_token_timeout`、`total_timeout`、`malformed_event`、`cancellation`、`late_token_fence`、`structured_output_when_claimed` 全部由本模块离线测试覆盖。
6. 非流与 SSE 都保留完整 Binding、从 0 连续 sequence、恰好一个末尾终态；终态后的 late token/late callback 被丢弃。
7. SSE 只有在合法 finish reason、Usage 与 `[DONE]` 全部到齐后才 EOS；非法 Content-Type/JSON/SSE、缺 DONE、缺 Usage、重复 finish、多 choices 或错 index 均失败关闭。
8. 结构化非流/流式都只输出一个经 JSON 语法验证的 `StructuredJson`；结构化流不输出中间 Text Delta。
9. Connect、First Token、Total 三段超时分别形成正确 TimeoutPhase；取消/关闭幂等，且不会被迟到成功覆盖。
10. 新代码无日志依赖或日志语句；Adapter、配置、Session 与归一化失败的字符串表示不包含合成 Token、正文或授权快照；异常不携带响应正文。
11. 所有 mock-server 都仅绑定 `127.0.0.1:0`，测试不读取环境变量、真实 Key、真实域名、Docker 或公网；零真实外发有自动断言。
12. Catalog/Contract/modelruntime、Conversation、Fake/Failure、Runtime、Frontend、DB、Deploy、CI、Harness 和 Agent/Skill 规则保持未修改。
13. 固定 JDK 25 下目标 Maven verify、全仓 Maven verify、完整 Harness 测试、Python/PowerShell/WSL canonical precheck 与 `git diff --check` 全部 PASS。
14. 未参与实现的独立 Reviewer 绑定精确实现 Commit 与 Git Tree复核通过；该实现 SHA 的 GitHub Backend、Frontend、Ubuntu/Windows/macOS 五作业全部成功。

## 必跑检查

以 YAML `requiredCommands` 为准。三个 canonical precheck 是用户明确要求冻结的独立入口，均调用同一 Python Harness 并各自真实执行 Doctor、Catalog validate/drift、付费依赖与 Beta Gate；不再额外安排相同终态快照上的 standalone Doctor/Catalog 命令。Maven 命令执行时只为该进程指定项目固定 Temurin JDK 25。

Evidence Pack 还必须分别记录 14 项离线合同覆盖、请求计数/loopback 断言、独立 Reviewer、精确实现 SHA 五作业 CI，以及真实 Provider、凭据、区域、合同、Runtime 外发、Alpha live、Beta、支付和安全政策为 `NOT_RUN`。

## 回滚或前向修复

本任务不含数据库、外部资源或 Runtime 接线。失败时只在新 Adapter、合同测试模块和根 POM 内前向修复；不得通过修改 `modelruntime`、Catalog/Contract、删除失败测试、放宽 Binding/终态条件或引入真实网络制造通过。若现有端口不足，记录 BLOCKED 并由 Owner 另开受保护 Contract/modelruntime 任务。

## 停止条件

- 必须修改 Catalog、Contract、生成物、`modelruntime`、Conversation、Fake/Failure、Runtime、CI、Harness、Agent 或 Skill 才能实现；
- 需要选择真实 Provider、模型、Key、域名、区域、合同、价格、路由、重试、fallback、Runtime 外发或安全政策；
- 需要访问非 loopback 网络、环境 Secret、Docker、数据库或外部服务；
- 无法证明每 Session 单请求、完整 Binding、三段超时、终态唯一、迟到事件丢弃或缺 Usage/DONE 时不 EOS；
- 独立 Reviewer 发现 P0/P1/P2，或精确实现 SHA 的五作业 CI 未全部成功。

## Evidence Pack

输出到 `docs/evidence/TASK-0011/`，并生成 `docs/handoffs/TASK-0011.json`。C3 实现必须由未参与修改的独立 Reviewer 绑定精确实现 Commit 与 Git Tree 复验。

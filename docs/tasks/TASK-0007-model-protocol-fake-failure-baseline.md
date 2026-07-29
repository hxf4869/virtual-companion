# TASK-0007：建立 ModelProtocolAdapter 与 Fake/Failure 合同测试基线

```yaml
taskId: TASK-0007
state: IN_PROGRESS
owner: repository-owner
riskClass: C3
requiredSkills:
  - task-intake
  - model-routing-change
requiredSkillVersions:
  task-intake: 1.1.0
  model-routing-change: 1.0.0
targetSkillVersions: {}
baseCommit: cbcffad9e0fa7311baa3cf9ba91d0cef86336881
authorizationCommit: e2dffdee09963f1058a2e6391e81df22fd252819
contextFingerprint: 6d7502efc0da1217389df6d472f6b89fe1f57f1c7de754357e782aa4c8e087a4
contextLock: docs/tasks/context/TASK-0007.context-lock.yaml
contextFingerprintAlgorithm: SHA256_ORDINAL_SORTED_PATH_EQUALS_HASH_LF_V1
readAllowlist:
  - AGENTS.md
  - README.md
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
  - docs/schemas/**
  - pom.xml
  - service/platform/catalog/**
  - service/apps/runtime/pom.xml
  - service/modules/modelruntime/**
  - service/adapters/model-fake/**
  - service/adapters/model-failure/**
  - service/tests/model-protocol-contract-tests/**
writeAllowlist:
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - docs/tasks/TASK-0007-model-protocol-fake-failure-baseline.md
  - docs/tasks/context/TASK-0007.context-lock.yaml
  - docs/evidence/TASK-0007/**
  - docs/handoffs/TASK-0007.json
  - pom.xml
  - service/modules/modelruntime/**
  - service/adapters/model-fake/**
  - service/adapters/model-failure/**
  - service/tests/model-protocol-contract-tests/**
forbiddenPaths:
  - AGENTS.md
  - CLAUDE.md
  - .github/**
  - .harness/task-lifecycle.yaml
  - .harness/sources-of-truth.yaml
  - .harness/invariants.yaml
  - .harness/protected-paths.yaml
  - .harness/skills.yaml
  - .harness/commands.yaml
  - .harness/tools.lock.yaml
  - .harness/license-policy.yaml
  - skills/**
  - scripts/**
  - specs/catalog/**
  - specs/contracts/**
  - specs/generated/**
  - service/platform/catalog/**
  - service/apps/runtime/**
  - service/adapters/model-openai/**
  - service/adapters/model-anthropic/**
  - frontend/**
  - db/**
  - deploy/**
  - ops/**
  - docs/source/**
sourcesOfTruth:
  - AGENTS.md
  - .harness/project-state.yaml
  - .harness/task-lifecycle.yaml
  - .harness/sources-of-truth.yaml
  - .harness/invariants.yaml
  - .harness/protected-paths.yaml
  - .harness/skills.yaml
  - .harness/tools.lock.yaml
  - .harness/license-policy.yaml
  - skills/task-intake/SKILL.md
  - skills/model-routing-change/SKILL.md
  - specs/catalog/product-scope.yaml
  - specs/catalog/model-protocols.yaml
  - specs/catalog/provider-attempt-statuses.yaml
  - specs/catalog/generation-states.yaml
  - specs/generated/java/com/virtualcompanion/catalog/ModelProtocol.java
  - specs/generated/java/com/virtualcompanion/catalog/ProviderAttemptStatus.java
  - specs/generated/java/com/virtualcompanion/catalog/GenerationState.java
  - specs/contracts/generation-contract.yaml
  - specs/contracts/model-protocol-contract.yaml
  - specs/contracts/authorization-contract.yaml
  - specs/contracts/finalization-contract.yaml
  - specs/contracts/license-cost-boundary-contract.yaml
  - docs/architecture/repository-structure.md
  - docs/decisions/0001-v031-technology-and-transport-baseline.md
  - docs/handoffs/TASK-0006.json
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
  - scope: decision-free-model-protocol-fake-failure-baseline
    approvedBy: repository-owner
    approvedAt: 2026-07-30
    evidence: 用户明确要求继续按需求清单和功能计划自主完成所有无需其决策的任务；本任务只实现机器真源已要求的供应商中立端口与本地 Fake/Failure 基线，不选择真实供应商、凭据、商业路由或公开能力
independentReview: required
reviewers: []
requiredCommands:
  - python scripts/harness/doctor.py --task TASK-0007
  - python scripts/harness/catalog_tool.py validate
  - python scripts/harness/catalog_tool.py diff --fail-on-drift
  - .\mvnw.cmd --batch-mode --no-transfer-progress -pl service/tests/model-protocol-contract-tests -am verify
  - .\mvnw.cmd --batch-mode --no-transfer-progress verify
  - python scripts/harness/precheck.py --task TASK-0007
  - powershell -NoProfile -ExecutionPolicy Bypass -File scripts/harness/precheck.ps1 -Task TASK-0007
  - wsl.exe -d Ubuntu-24.04 -- bash scripts/harness/precheck.sh --task TASK-0007
  - git diff --check
```

## 背景与用户可观察目标

Technical Alpha 的机器真源要求存在 Fake 与 Failure Model Adapter，现有仓库只有 Catalog 和 Runtime 能力门禁，没有模型协议端口或适配器。TASK-0007 建立可被后续 Agent 复用的供应商中立 `ModelProtocolAdapter`、确定性 Fake/Failure 实现和本地合同测试，使成功、失败、取消、EOS 与迟到事件边界无需真实模型、凭据或网络即可稳定复验。

历史方案中的 `ChatInferencePort` 只是非权威快照；当前机器契约明确内部端口名为 `ModelProtocolAdapter`，实现必须以后者为准。

## 范围内

- 新增 `service/modules/modelruntime`，只依赖 JDK 与 `virtual-companion-catalog`，提供供应商中立端口和值对象；
- 新增 `service/adapters/model-fake`，以不可变脚本确定性产生非流式结果、归一化流事件、Unicode/长文本、Usage、StopReason 与可选结构化 JSON；
- 新增 `service/adapters/model-failure`，确定性注入 429、5xx、连接/首 Token/总时长超时、畸形事件、断流、取消失败和迟到 Delta；
- 新增 `service/tests/model-protocol-contract-tests`，集中验证两个 Adapter 的内部归一化合同，不进入 Runtime classpath；
- 使用 Catalog 生成的 `ModelProtocol.FAKE`、`ModelProtocol.FAILURE`、Generation 与 Attempt 状态，不复制第二套全局状态枚举；
- 用完整不可变 Binding 与 Fence Gate 拒绝错 Owner、Relationship、Conversation、Generation、Source/Attempt 或 Fence 的事件；
- 证明 Adapter EOS 只终止本次 Session，不产生 Generation 完成、`chat.completed` 或最终消息；
- 根 `pom.xml` 仅登记上述模块，`service/apps/runtime` 保持不依赖 Adapter。

## 明确范围外

- OpenAI Chat Completions、Anthropic Messages、OpenAI Responses 或任何真实 Provider Adapter；
- 真实 HTTP、SSE framing/parser、mock-server 协议符合性、网络、模型名、API Key、供应商 SDK 或供应商异常；
- `model-protocol-contract.yaml` 的两类主协议 `offlineContractRequirement`；本任务只能建立内部归一化语义基线，不能把 Fake 流误报为 SSE 合同通过；
- `alphaLiveRequirement`、真实 Deployment、Provider Registry、区域/合同准入、动态商业路由、价格权重或降级决策；
- `ZERO_LLM`、Runtime API、前端、数据库、`provider_attempt` 持久化、RLS、Worker、最终化事务或真实用户；
- 修改 Catalog、Contract、生成物、Harness、CI、Agent 规则或引入 Spring AI/HTTP Client/新第三方依赖；
- 验证当前 Consent、Provider/Region、合同 Registry 或持久化授权快照；本任务只保留外部 Attempt 必须携带双授权快照的结构边界。

## 输入和前置条件

- Base Commit 为 TASK-0006 ACCEPTED 终态 `cbcffad9e0fa7311baa3cf9ba91d0cef86336881`，工作树干净且与 `origin/main` 一致；
- `product-scope.yaml` 明确 `fakeAdapterRequired: true` 与 `failureAdapterRequired: true`；
- `model-protocols.yaml` 明确 `FAKE`、`FAILURE` 均为 `external: false`，因此二者必须使用确定性来源绑定，不创建或冒充外部 `provider_attempt`；
- Generation Candidate 可以来自 Provider Attempt 或确定性来源；本任务只实现后者及通用事件门；
- Context Lock 只绑定 Base Commit 中的机器真源、Skill、架构、上个 Handoff 与 Maven 基线。

## API / 事件 / 数据契约

最小设计必须保留以下语义，具体 Java 文件可在白名单内按可读性拆分：

- `ModelProtocolAdapter` 暴露 `protocol()`、`capabilities()` 与 `open(ModelProtocolRequest)`；
- `ModelProtocolSession` 暴露顺序 `next()`、幂等 `cancel()`/`close()`，终态事件后只能返回空；
- `InvocationBinding` 区分 `ExternalAttemptBinding` 与 `DeterministicSourceBinding`：
  - 外部 Binding 结构上必须包含完整 Owner 元组、`providerAttemptId`、Fence、requested/execution Authorization Snapshot ID；
  - Fake/Failure 只接受确定性来源 Binding；
- `ModelProtocolRequest` 只含 Binding、供应商中立消息、文本或结构化响应模式、是否流式和超时预算；
- `ModelProtocolEvent` 至少区分 Output Delta、Usage、Attempt EOS、Attempt Failed、Attempt Cancelled，并携带 Binding 与单调序号；
- 失败只暴露供应商中立分类：Rate Limited、Upstream Unavailable、Connect/First Token/Total Timeout、Malformed、Disconnected、Cancellation Failed、Unsupported Capability；
- 事件门只接受与期望 Binding 完全相等的事件，其余返回丢弃；不同 Session/Binding 的内容不得提供拼接 API；
- Fake/Failure 的外部 `protocol()` 分别固定为 Catalog 的 `FAKE` 与 `FAILURE`。

## 权限、RLS 和数据处理要求

- 端口不得接受客户端声明的 Owner 作为可信真源；本任务只携带已由上游建立的不可变 Owner 元组，不实现身份映射；
- 外部 Attempt Binding 缺任一 requested/execution Authorization Snapshot ID 时构造即失败，不能以 `authorized=true` 布尔值替代；
- Fake/Failure 为非外部确定性来源，不发生网络外发、不保存请求、不写数据库、不结算配额；
- 测试数据只使用合成文本，不包含真实用户、个人信息、秘密或模型凭据；
- 完整授权执行检查、撤回、`CANCELLED_BY_AUTHORIZATION`、Quota Release 与数据库外键留给后续授权/路由集成任务。

## 状态机和失败行为

- 每个 Session 事件序号从固定起点单调增加，恰有一个 Attempt 终态，终态后无事件；
- 非流式 Fake 产生单一完整 Payload、Usage、EOS；流式 Fake 产生固定 Delta 序列、Usage、EOS；
- EOS 只表示 Adapter Session/Attempt 结束，不可直接产生 `GenerationState.COMPLETED`、`chat.completed` 或最终消息；
- 429/5xx 只映射到内部中立失败，不在本任务擅自冻结持久化重试策略；
- Connect/First Token Timeout 在任何 Delta 前失败；Total Timeout 与 Disconnect 可在同一 Binding 的固定前缀后失败，但不得产生成功 EOS；
- Fake 取消后只产生取消终态；Failure 可确定性产生取消失败；
- Late Delta 故障注入使用不匹配 Binding，Fence Gate 必须丢弃；这不等同于已经验证数据库当前 Fence 或真实 Provider 并发；
- 任一不支持的 Binding、结构化能力或非法脚本均失败关闭，不回退到真实 Provider。

## 模型、Prompt、记忆和安全边界

- 不调用真实模型，不读取环境凭据，不访问网络，不依赖时间、随机数、线程调度、文件或外部服务；
- 相同请求和不可变脚本必须产生值相等且顺序相同的全部事件；
- Prompt 只作为供应商中立不可变消息传入，不实现 Persona、记忆检索、Safety、Tool Call 或业务编排；
- Adapter 不持有 Conversation、Generation、Memory 或授权真源，不把供应商 Session 当记忆；
- 不引入付费软件、托管 SaaS 或商业功能作为构建或测试前提。

## 验收标准

1. 四个新 Maven 模块依赖方向为 tests → adapters → modelruntime → catalog；Runtime 保持只依赖 Catalog。
2. `modelruntime` 主代码只依赖 JDK 与 Catalog，公共 API 不出现供应商 SDK、模型名、API Key、供应商异常或供应商 Session。
3. Fake 相同脚本与请求重复执行得到完全相等的非流式/流式事件序列，并覆盖中文、emoji、组合字符、长文本、Usage、StopReason 和声明后的结构化 JSON。
4. Failure 无网络、无 `sleep` 地覆盖 429、5xx、Connect/First Token/Total Timeout、Malformed、Disconnect、Cancellation Failed 与 Late Delta。
5. Fake 取消成功、Failure 取消失败均只产生一个归一化终态；`cancel()` 与 `close()` 幂等。
6. Fence Gate 对完整 Binding 相等的事件放行，对 Owner、Relationship、Conversation、Generation、Source/Attempt、Fence 任一不匹配逐项丢弃。
7. EOS 事件只表示 Attempt/Session 结束；模块中不存在 Generation 完成、最终消息、`chat.completed` 或跨 Attempt 输出拼接路径。
8. Fake/Failure 只接受 `DeterministicSourceBinding`，协议分别来自 `ModelProtocol.FAKE` 与 `ModelProtocol.FAILURE`，不创建或冒充 `provider_attempt`。
9. 合同测试逐项记录内部归一化基线结果；主协议 mock-server 合同与 Alpha live deployment 明确记录为 `NOT_RUN`，不得由 Fake/Failure 结果替代。
10. Catalog validate/drift、目标模块 Maven verify、全仓 Maven verify、Doctor、三套 precheck、`git diff --check` 与独立 Reviewer 全部通过。

## 必跑检查

以 YAML `requiredCommands` 为准。Evidence Pack 必须把内部 Fake/Failure 基线与未运行的主协议 mock-server/live deployment 分开记录；每条执行命令绑定精确实现提交。

## 回滚或前向修复

本任务无运行数据、数据库或外部资源。失败时只在白名单模块和根 POM 内前向修复；不得通过修改 Catalog/Contract、删除失败测试、放宽 Fence、引入真实 Provider 或降低门禁来制造通过。

## 停止条件

- 发现现有 Contract/Catalog 必须修改才能表达最小端口；
- 需要选择供应商、模型、凭据、区域、商业路由、HTTP/SSE 库或付费能力；
- 需要修改 Runtime、API、前端、数据库、Harness、CI、生成物或受保护真源；
- 需要擅自冻结 429/5xx 到持久化 Attempt 状态的业务重试策略；
- 不能证明 Fake/Failure 为确定性来源、无外发、EOS 不完成 Generation 或错 Fence 事件被丢弃。

## Evidence Pack

输出到 `docs/evidence/TASK-0007/`，并生成 `docs/handoffs/TASK-0007.json`。C3 实现必须由未参与修改的独立 Reviewer 绑定精确实现提交与 Git Tree 复验。

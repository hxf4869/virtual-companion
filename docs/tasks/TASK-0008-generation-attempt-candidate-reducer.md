# TASK-0008：建立 Generation Attempt/Candidate 归约与隔离合同基线

```yaml
taskId: TASK-0008
state: IN_REVIEW
owner: repository-owner
riskClass: C3
requiredSkills:
  - task-intake
  - model-routing-change
requiredSkillVersions:
  task-intake: 1.1.0
  model-routing-change: 1.0.0
targetSkillVersions: {}
baseCommit: 7bfa82399765ff9014d445eba0bcc4095d7d75d3
authorizationCommit: b6d06b004c96c26b5c37ef1c7dee73e63288510a
contextFingerprint: 839e58046739fc0d2bb5f004a50c921051e8dfe3938e46e7e1ca78fa23ea8d12
contextLock: docs/tasks/context/TASK-0008.context-lock.yaml
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
  - service/modules/conversation/**
  - service/tests/generation-contract-tests/**
writeAllowlist:
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - docs/tasks/TASK-0008-generation-attempt-candidate-reducer.md
  - docs/tasks/context/TASK-0008.context-lock.yaml
  - docs/evidence/TASK-0008/**
  - docs/handoffs/TASK-0008.json
  - pom.xml
  - service/modules/conversation/**
  - service/tests/generation-contract-tests/**
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
  - service/modules/modelruntime/**
  - service/adapters/**
  - service/tests/model-protocol-contract-tests/**
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
  - docs/handoffs/TASK-0007.json
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/InvocationBinding.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/ModelPayload.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/ModelProtocolEvent.java
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
  - scope: decision-free-generation-attempt-candidate-reducer
    approvedBy: repository-owner
    approvedAt: 2026-07-30
    evidence: 用户明确要求继续按需求清单和功能计划自主完成所有无需其决策的任务；本任务只实现机器真源已冻结的 Generation 归约与隔离内核，不选择重试、路由、胜出策略、数据库、API、真实模型或安全政策
independentReview: required
reviewers: []
requiredCommands:
  - python scripts/harness/doctor.py --task TASK-0008
  - python scripts/harness/catalog_tool.py validate
  - python scripts/harness/catalog_tool.py diff --fail-on-drift
  - .\mvnw.cmd --batch-mode --no-transfer-progress -pl service/tests/generation-contract-tests -am verify
  - .\mvnw.cmd --batch-mode --no-transfer-progress verify
  - python scripts/harness/precheck.py --task TASK-0008
  - powershell -NoProfile -ExecutionPolicy Bypass -File scripts/harness/precheck.ps1 -Task TASK-0008
  - wsl.exe -d Ubuntu-24.04 -- bash scripts/harness/precheck.sh --task TASK-0008
  - git diff --check
```

## 背景与用户可观察目标

TASK-0007 已提供供应商中立模型事件、完整 Binding/Fence 和确定性 Fake/Failure，但仓库还没有 Generation 消费方。TASK-0008 建立纯内存 Attempt 事件归约、冻结 Candidate 与同一 Generation 候选隔离基线，使成功、失败、取消、错 Binding、迟到 Fence 和多 Attempt 场景可在不接数据库或真实模型的条件下稳定复验。

本任务只建立后续业务纵切可复用的领域内核，不声称已经具备聊天 API、最终消息、实时推送或真实模型能力。

## 范围内

- 新增 `service/modules/conversation`，依赖 Catalog 与 `modelruntime`，不依赖 Adapter、Spring、HTTP 或数据库；
- 新增 `service/tests/generation-contract-tests`，仅测试依赖 Fake/Failure Adapter；
- 为一个期望 `InvocationBinding` 顺序归约 Output、Usage 与 Attempt 终态；
- 对 Binding 完全相等且序号连续的事件才推进状态，错 Owner、Relationship、Conversation、Generation、Execution ID 或 Fence 均丢弃；
- EOS 时冻结单个 Candidate，保留来源 Binding、内容、Usage、StopReason 和确定性 SHA-256 内容地址；
- 同一 Generation 可登记多个独立 Candidate，但内容永不跨 Binding/Attempt 拼接；
- Candidate 选择必须由显式调用触发，同一 Generation 至多一个 selected Candidate；本任务不实现选择策略；
- 使用 Catalog `GenerationState` 证明 Adapter EOS 不把 Generation 变为 `COMPLETED`、`COMPLETED_FALLBACK` 或其他终态；
- 根 `pom.xml` 仅登记 conversation 与集中合同测试模块，Runtime 保持不依赖它们。

## 明确范围外

- 修改 `modelruntime`、Fake/Failure、Catalog、Contract、生成物、Harness、CI 或 Agent 规则；
- OpenAI/Anthropic HTTP/SSE Adapter、本地 mock-server 主协议合同、真实模型、凭据、区域或 Deployment；
- Route Decision、模型/供应商选择、重试/降级/回退策略、429/5xx 是否重试、配额和成本结算；
- 数据库表、Migration、RLS、Provider Attempt 持久化、Worker Lease/Fence、Outbox 或最终化事务；
- Runtime API、前端、SSE、`chat.completed`、最终 Assistant Message、Memory、Persona、Tool Call 或 Safety；
- 自动选择 Candidate、自动进入 `FINAL_REVIEW`、自动完成 Generation 或生成新的全局状态枚举；
- 真实用户、公开注册、Beta、真实支付或任何外部数据传输。

## 输入和前置条件

- Base Commit 为 TASK-0007 ACCEPTED 终态 `7bfa82399765ff9014d445eba0bcc4095d7d75d3`；
- TASK-0007 已证明 Fake/Failure 产生顺序归一化事件，并明确未实现主协议或 Runtime 接线；
- Generation Contract 已冻结稳定 `generationId`、多 Attempt、最多一个 selected Candidate、不拼接和 EOS 不完成 Generation；
- Finalization Contract 要求 Candidate 内容冻结且可按 Hash 寻址，但真正 Finalize 事务不在本任务；
- Context Lock 只绑定 Base Commit 中的机器真源、Skill、上个 Handoff、Maven 基线和 TASK-0007 公共模型协议 API。

## API / 事件 /数据契约

- 一个 Reducer 必须绑定一个不可变 `InvocationBinding`、一个上游分配的非空 `candidateId` 与一个非终态 Generation 状态；
- `accept(ModelProtocolEvent)` 返回显式结果：接受、丢弃或终止，不以异常代表正常的迟到事件；
- 只有完整 Binding 相等且 `sequence` 等于期望序号的事件可推进；被丢弃事件不得改变序号、内容、Usage、终态或 Candidate；
- 文本 Delta 只在同一 Binding 内按序拼接；结构化 JSON 作为单一结构化内容冻结；文本与结构化 Payload 混用时失败关闭且不产生 Candidate；
- Usage 最多接受一次；重复 Usage、重复终态、终态后事件或非法序号均不得产生第二个 Candidate；
- EOS 产生一个不可变 Frozen Candidate；失败和取消只产生对应 Attempt Outcome，不产生 Candidate；
- 内容地址使用固定算法 `SHA-256(type + NUL + UTF-8 content)`，结果为 64 位小写十六进制；
- Candidate Set 必须校验完整 Ownership 中的 `generationId` 一致、Candidate ID 唯一，并保证显式选择幂等且最多一个 selected；
- 公共类型不得出现 Provider SDK、HTTP、数据库 Entity、Assistant Message、`chat.completed` 或供应商异常。

## 权限、RLS 和数据处理要求

- Ownership 只来自上游建立的不可变 Binding，不信任客户端声明，也不实现身份映射；
- 外部 Binding 的 requested/execution Authorization Snapshot ID 由 `modelruntime` 构造约束保留，本任务不得删除、替换为布尔值或推导当前授权有效；
- Reducer 不执行外发、不读环境凭据、不访问网络、不保存请求、不写数据库；
- 测试只使用合成 Owner、授权快照和文本，不包含真实用户数据、秘密或供应商凭据；
- 授权撤回、Consent、Provider/Region Registry 与额度释放留给独立 Execution Guard 任务。

## 状态机和失败行为

- 初始期望序号为 0；每个接受事件严格递增 1；
- Binding 或 Fence 不匹配、重复/跳跃序号和终态后迟到事件均返回丢弃，且不污染 Candidate；
- EOS 关闭当前 Attempt 归约并冻结 Candidate，但 Generation 状态保持调用方给定值，不自动进入 `FINAL_REVIEW` 或任何终态；
- Attempt Failed/Cancelled 关闭当前归约且无 Candidate；不在本任务把失败分类映射为持久化重试策略；
- 一个失败 Attempt 的部分文本不能进入另一个 Attempt 的 Candidate；
- Candidate Set 登记多个完整 Candidate 时保持逐 Candidate 内容独立；选择第二个不同 Candidate 必须失败关闭，重复选择同一个 Candidate 幂等；
- 所有操作确定性、单线程、无时间、随机数、网络或文件依赖。

## 模型、Prompt、记忆和安全边界

- 本任务不调用模型；Fake/Failure 只作为测试输入；
- 不编译 Prompt、不读取 Persona 或 Memory、不执行输入/增量/最终安全审核；
- Frozen Candidate 不是最终 Assistant Message，也未通过 Final Safety Review；
- 不产生 `chat.completed`、Memory Extraction、Conversation Summary 或任何 Outbox 事件；
- 不把 Adapter Session、Attempt Outcome 或 Candidate 当作 Conversation/Memory 真源。

## 验收标准

1. 依赖方向为 tests → conversation → modelruntime → catalog，测试另可依赖 Fake/Failure；Runtime 不新增依赖。
2. 同一 logical request 的所有 Reducer/Candidate 使用同一个稳定 `generationId`，任一 Ownership 字段不匹配的事件均丢弃。
3. Fake 非流式/归一化流 EOS 各冻结一个内容、Usage、StopReason 和 Hash 均确定的 Candidate。
4. Failure 的前缀失败、取消和迟到 Fence 场景不产生成功 Candidate；迟到 Delta 不进入内容。
5. 两个不同 Binding 的输出永不拼接；失败 Attempt 的部分输出不会出现在后续成功 Candidate。
6. Candidate 内容 Hash 在 Unicode、emoji、组合字符和长文本下重复执行值相等，文本与结构化内容域分离。
7. 同一 Generation 可登记多个 Candidate，但 Candidate ID 唯一且最多一个被显式选择；不实现自动选择策略。
8. EOS、失败或取消后继续输入事件均不产生第二终态或 Candidate；Generation 不自动成为完成态，也不产生 `chat.completed` 或最终消息。
9. Catalog validate/drift、目标 Maven verify、全仓 Maven verify、Doctor、三套 precheck、`git diff --check` 与独立 Reviewer 全部通过。

## 必跑检查

以 YAML `requiredCommands` 为准。Evidence Pack 必须区分“纯内存归约合同已通过”与数据库、最终化、真实 Provider、主协议 mock-server、Runtime/API 均未运行。

## 回滚或前向修复

本任务无运行数据或外部资源。失败时只在两个新模块和根 POM 内前向修复；不得通过修改 Contract/Catalog、放宽 Binding/Fence、删除失败测试或引入自动完成路径制造通过。

## 停止条件

- 现有 ModelProtocol API 无法在不修改受保护模块的情况下表达最小归约；
- 需要选择重试、路由、降级、Candidate 胜出、安全或最终化策略；
- 需要修改 Runtime、前端、数据库、Harness、CI、Catalog、Contract、生成物或现有 Adapter；
- 无法证明 EOS 不完成 Generation、失败前缀不跨 Attempt 拼接或错 Binding/Fence 事件无副作用。

## Evidence Pack

输出到 `docs/evidence/TASK-0008/`，并生成 `docs/handoffs/TASK-0008.json`。C3 实现必须由未参与修改的独立 Reviewer 绑定精确实现提交与 Git Tree 复验。

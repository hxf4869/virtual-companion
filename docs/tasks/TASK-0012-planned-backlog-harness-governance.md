# TASK-0012：PLANNED 队列、Backlog 和 Harness 治理

```yaml
taskId: TASK-0012
state: IN_REVIEW
owner: repository-owner
riskClass: C4
requiredSkills:
  - task-intake
  - harness-change
requiredSkillVersions:
  task-intake: 1.1.0
  harness-change: 1.1.0
targetSkillVersions:
  task-intake: 1.2.0
baseCommit: b65caf309d4fb740b20648ee74c7b764537582c9
authorizationCommit: dacafdb72096696909425841c8d0a829702a2531
contextFingerprint: 880dfd135a84e1d1c826edeb7b7c783c657696a7a8a9182761604292467b87aa
contextLock: docs/tasks/context/TASK-0012.context-lock.yaml
contextFingerprintAlgorithm: SHA256_ORDINAL_SORTED_PATH_EQUALS_HASH_LF_V1
readAllowlist:
  - AGENTS.md
  - README.md
  - .github/workflows/ci.yml
  - .harness/**
  - skills/task-intake/SKILL.md
  - skills/harness-change/SKILL.md
  - scripts/harness/**
  - requirements-harness.txt
  - docs/architecture/**
  - docs/decisions/**
  - docs/engineering/**
  - docs/tasks/**
  - docs/schemas/**
  - docs/evidence/TASK-0011/**
  - docs/handoffs/TASK-0011.json
  - specs/catalog/**
  - specs/contracts/**
  - pom.xml
  - service/**
  - frontend/**
writeAllowlist:
  - AGENTS.md
  - .harness/agent-entrypoints.yaml
  - .harness/invariants.yaml
  - .harness/project-state.yaml
  - .harness/skills.yaml
  - .harness/sources-of-truth.yaml
  - .harness/task-backlog.yaml
  - .harness/task-ledger.yaml
  - .harness/task-lifecycle.yaml
  - skills/task-intake/SKILL.md
  - scripts/harness/doctor.py
  - scripts/harness/tests/test_harness.py
  - docs/engineering/agent-onboarding.md
  - docs/schemas/handoff.schema.json
  - docs/tasks/task-card-template.md
  - docs/tasks/TASK-0012-planned-backlog-harness-governance.md
  - docs/tasks/context/TASK-0012.context-lock.yaml
  - docs/tasks/TASK-0013-provider-registry-admission-model.md
  - docs/tasks/TASK-0014-execution-authorization-guard.md
  - docs/tasks/TASK-0015-postgresql-flyway-force-rls.md
  - docs/tasks/TASK-0016-worker-claim-lease-fence.md
  - docs/tasks/TASK-0017-conversation-generation-persistence.md
  - docs/tasks/TASK-0018-finalization-usage-quota-outbox.md
  - docs/tasks/TASK-0019-context-plan-persona-listen-discuss.md
  - docs/tasks/TASK-0020-safety-pipeline.md
  - docs/tasks/TASK-0021-fetch-sse-resume-gap-reset-snapshot.md
  - docs/tasks/TASK-0022-fake-failure-offline-e2e-slice.md
  - docs/tasks/TASK-0023-openapi-client-generation-drift.md
  - docs/tasks/TASK-0024-relationship-active-companion.md
  - docs/tasks/TASK-0025-chat-generation-history-api.md
  - docs/tasks/TASK-0026-h5-offline-chat-stream-recovery.md
  - docs/tasks/TASK-0027-canonical-memory-persistence.md
  - docs/tasks/TASK-0028-memory-candidate-management-api.md
  - docs/tasks/TASK-0029-memory-recall-context-tombstone.md
  - docs/tasks/TASK-0030-h5-memory-management.md
  - docs/tasks/TASK-0031-entitlement-service-class-routing.md
  - docs/tasks/TASK-0032-zero-llm-quota-failure-recovery.md
  - docs/tasks/TASK-0033-anthropic-messages-offline-contract.md
  - docs/tasks/TASK-0034-identity-component-internal-accounts.md
  - docs/tasks/TASK-0035-approved-live-model-provider.md
  - docs/tasks/TASK-0036-technical-alpha-acceptance.md
  - docs/evidence/TASK-0012/**
  - docs/handoffs/TASK-0012.json
forbiddenPaths:
  - CLAUDE.md
  - .github/**
  - ci/**
  - .harness/commands.yaml
  - .harness/license-policy.yaml
  - .harness/protected-paths.yaml
  - .harness/tools.lock.yaml
  - skills/harness-change/**
  - skills/catalog-change/**
  - skills/contract-change/**
  - skills/database-migration/**
  - skills/memory-change/**
  - skills/model-routing-change/**
  - skills/safety-change/**
  - scripts/harness/harness_common.py
  - scripts/harness/precheck.py
  - scripts/harness/precheck.ps1
  - scripts/harness/precheck.sh
  - scripts/harness/catalog_tool.py
  - scripts/harness/check_beta_gate.py
  - scripts/harness/check_paid_features.py
  - requirements-harness.txt
  - docs/decisions/**
  - docs/schemas/evidence-pack.schema.json
  - docs/source/**
  - specs/**
  - service/**
  - frontend/**
  - db/**
  - deploy/**
  - ops/**
  - pom.xml
sourcesOfTruth:
  - AGENTS.md
  - .github/workflows/ci.yml
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - .harness/task-lifecycle.yaml
  - .harness/sources-of-truth.yaml
  - .harness/invariants.yaml
  - .harness/protected-paths.yaml
  - .harness/skills.yaml
  - .harness/commands.yaml
  - .harness/agent-entrypoints.yaml
  - skills/task-intake/SKILL.md
  - skills/harness-change/SKILL.md
  - scripts/harness/harness_common.py
  - scripts/harness/doctor.py
  - scripts/harness/precheck.py
  - scripts/harness/tests/test_harness.py
  - docs/tasks/task-card-template.md
  - docs/decisions/0003-portable-agent-harness.md
  - docs/engineering/agent-onboarding.md
  - specs/catalog/product-scope.yaml
  - specs/catalog/model-protocols.yaml
  - specs/contracts/authorization-contract.yaml
  - specs/contracts/database-ownership-contract.yaml
  - specs/contracts/worker-lease-contract.yaml
  - specs/contracts/generation-contract.yaml
  - specs/contracts/finalization-contract.yaml
  - specs/contracts/realtime-contract.yaml
  - specs/contracts/model-protocol-contract.yaml
  - specs/contracts/identity-session-boundary-contract.yaml
  - specs/contracts/safety-fail-closed-contract.yaml
requiredInvariants:
  - INV-HARNESS-001
  - INV-HARNESS-002
  - INV-HARNESS-003
  - INV-HARNESS-004
  - INV-HARNESS-005
humanApprovals:
  - scope: harness-change
    approvedBy: repository-owner
    approvedAt: 2026-07-30
    evidence: Owner 明确授权 TASK-0012 建立 Technical Alpha 多任务 PLANNED 队列、唯一 Backlog 真源、生命周期与 Harness 门禁，并要求完整 C4 独立复核和闭环
scopeAmendments:
  - schemaVersion: 2
    amendmentId: task-0012-owner-formalize-task-0037
    contractSource: .harness/task-backlog.yaml
    contractHashAlgorithm: SHA256_CANONICAL_JSON_V1
    contractHash: 578711b359e96a35a4e1e7570f2ad5e0696bcecc688ad00ce96a2df8dc0d1dc1
    contract:
      schemaVersion: 1
      taskId: TASK-0012
      amendmentType: OWNER_CLAUSE_REPLACEMENT
      approvedBy: repository-owner
      approvedAt: "2026-07-30"
      evidence: Owner 针对 TASK-0012 无限检查与 Reviewer 循环作出有界设计重设，明确只替代验收条款 001 与 004，并授权 TASK-0037 排序
      reason: 保留 TASK-0012 至 TASK-0036 的全部原永久 ID、产品语义和未列授权，仅追加性能治理卡并调整两步晋级顺序
      authorizedParentCommit: 2a55335e695c8fc5434c0dbc867288842c804e74
      baseAuthorizationProjectionHash: 4bdee3003a92a5620e2c31f8eabb2e03df43895c39e24363ed6dd8275fb6da9e
      scopeGrantAmendmentId: null
      addedWriteAllowlist:
        - docs/tasks/TASK-0037-harness-performance-layered-validation.md
      replacements:
        - supersedes:
            clauseId: TASK-0012-ACCEPTANCE-001
            statement: "`.harness/task-backlog.yaml` 恰好登记 TASK-0012～TASK-0036 的 25 个永久编号和规定名称；执行顺序唯一，依赖全部可解析且无环，声明的关键路径是连续依赖链并终止于 TASK-0036。"
            statementHash: f64d2a376461f6e807c0ad11b22ea70397abfb444a3c863b678883d887891f8d
          replacement:
            statement: 正式 Backlog 保留 TASK-0012～TASK-0036 全部原永久 ID 与产品语义，并追加 TASK-0037，共 26 个永久 ID；不得改号、复用或删除原卡。
            statementHash: 55de9d39eab9f34d0e21f8359f3a49e23c6ebcd86aff67f1a884583a7322ea06
        - supersedes:
            clauseId: TASK-0012-ACCEPTANCE-004
            statement: Backlog 的晋级解析同时执行依赖、执行顺序和硬决策闸门；最终快照中下一张可晋级卡为 TASK-0013，TASK-0034/0035 因硬闸门保持不可晋级，TASK-0036 因依赖保持 PLANNED/BLOCKED。
            statementHash: 44d1f19c2c523a2ae0823bc9ca832e20768788dc5b73da95f05d40464558e0fc
          replacement:
            statement: TASK-0012 ACCEPTED 后第一张可晋级为 TASK-0037；TASK-0037 ACCEPTED 后再按原 DAG 推进 TASK-0013。
            statementHash: 99f1ce4576652caa72db70cce3714c64771922b34a0ea921e6c3931c7a304e53
independentReview: required
reviewers:
  - id: task-0012-c4-static-reviewer-20260731-r1-performance-delta
    kind: planned-backlog-harness-governance
    verdict: PASS
    reviewedCommit: d629fc20ac17bedb1e43eece361159c652ef785d
    evidencePath: docs/evidence/TASK-0012/review-planned-backlog-harness-governance.md
requiredCommands:
  - python -m unittest discover -s scripts/harness/tests -p test_*.py
  - .\mvnw.cmd --batch-mode --no-transfer-progress verify
  - python scripts/harness/precheck.py --task TASK-0012
  - powershell -NoProfile -ExecutionPolicy Bypass -File scripts/harness/precheck.ps1 -Task TASK-0012
  - wsl.exe -d Ubuntu-24.04 -- bash scripts/harness/precheck.sh --task TASK-0012
  - git diff --check
```

## 背景与用户可观察目标

当前 Harness 只认识单个 DRAFT/活动任务，无法在不伪造多张 DRAFT 的情况下保存 Technical Alpha 的正式执行队列、依赖 DAG、关键路径和硬决策闸门。交付后，仓库应有且只有一个机器可执行的
`.harness/task-backlog.yaml` 作为 TASK-0012～TASK-0036 的规划真源；Doctor 能区分不占
`activeTask`、不可执行的 PLANNED 卡与唯一 DRAFT/活动任务，并在规划合同漂移、ID 复用、依赖环、闸门绕过或动态证据提前冻结时失败关闭。

## 范围内

- 新增 Technical Alpha Backlog，永久登记 TASK-0012～TASK-0036 的编号、名称、执行顺序、依赖 DAG、关键路径、静态规划合同、决策闸门和晋级条件；
- 为 TASK-0013～TASK-0036 建立正式 PLANNED 卡；卡片通过可复算 Hash 绑定 Backlog 中的静态规划合同；
- 扩展生命周期为 `PLANNED -> DRAFT -> READY -> IN_PROGRESS -> IN_REVIEW -> ACCEPTED`，保留
  BLOCKED、REJECTED，并新增 SUPERSEDED 终态；
- 明确多个 PLANNED 合法、最多一个待处理 DRAFT、最多一个活动任务，PLANNED 不占
  `project-state.activeTask` 且不能作为 Diff Scope 执行授权；
- 在 Sources of Truth、Invariants、Doctor、任务模板、task-intake Skill、恢复手册和 Harness 测试中集成上述规则；
- 为 Backlog 缺失、重复 ID、Card/Hash 漂移、依赖环、无效关键路径、未批准硬闸门晋级、PLANNED 动态字段和 PLANNED 执行尝试增加失败关闭测试。

## 明确范围外

- 实现 TASK-0013～TASK-0036 的任何业务代码、数据库、API、H5、身份或真实模型接线；
- 创建 `.planning`、`CONTEXT.md`、第二套 ADR、第二套任务目录或任何平行规划系统；
- 开启公开注册、真实支付、恋爱模式、语音、图片、WebSocket、主动消息、多角色、第二家真实供应商或 Beta；
- 读取真实 Provider Key、选择真实供应商/模型/区域/合同、访问公网模型端点或启动数据库；
- 修改 Catalog、Contract、生成物、CI 工作流、业务模块或本机服务；
- 为当前任务降低 C4、审批、Reviewer、Context、Diff Scope、Evidence 或跨平台门禁。

## 输入和前置条件

- 实际 Base Commit 为 `b65caf309d4fb740b20648ee74c7b764537582c9`，与开工时最新
  `origin/main` 一致且工作区干净；
- TASK-0011 已 ACCEPTED，`project-state.activeTask` 为 null；
- Owner 已明确批准本卡的目标、范围、C4 风险、写入白名单、Technical Alpha 边界和独立 Reviewer；
- Java 验证固定使用 `G:\ai\hxf\.tools\temurin-25.0.4+7\jdk-25.0.4+7`，不修改系统 Java；
- 本任务只记录后续一次性 PostgreSQL 18/pgvector 合成数据测试容器约束，不启动数据库或接触现有本机服务。

## API / 事件 / 数据契约

- Backlog 是执行顺序、依赖、关键路径、决策闸门与晋级条件的唯一机器真源；
- PLANNED 卡是 Backlog 静态规划合同的可审计投影，不成为第二真源；
- PLANNED 卡只绑定目标、范围、禁止项、依赖、验收和决策闸门，不包含
  `baseCommit`、`authorizationCommit`、Context Lock/Hash、精确命令或 Skill 版本；
- 晋级为唯一 DRAFT 时，才基于当时最新、干净、可安全同步的 main 创建动态证据；READY 仍按现有原子授权提交和不可前移授权锚执行。

## 权限、RLS 和数据处理要求

- 只读取 Git 元数据、现有机器真源、代码结构和合成测试夹具；
- 不读取、记录或输出本机凭据、真实用户数据、真实模型请求或现有数据库内容；
- 后续数据库任务只可按各自动态授权在 WSL2 Docker 使用一次性 PostgreSQL 18/pgvector、合成数据、临时端口和临时卷，并在结束后清理；不得连接或修改 MySQL、Redis、RabbitMQ、Kingbase；
- 所有真实外发集中到 TASK-0035；此前只允许 Fake、Failure、合成记录和
  `127.0.0.1` loopback。

## 状态机和失败行为

- `PLANNED` 不是 active state；存在任意数量 PLANNED 不改变 `activeTask`；
- 同时存在两个 DRAFT、两个活动任务或试图直接执行 PLANNED 时 Doctor 失败；
- 依赖未 ACCEPTED、硬决策闸门未 APPROVED、存在更高优先级可晋级任务或仓库非空闲时，任务保持
  PLANNED，并在 Backlog 解析结果中标记不可晋级；
- 取消或替代已登记 ID 时，原卡必须进入 REJECTED 或 SUPERSEDED 并保留原因、Backlog 条目和历史；编号永久不复用；
- Backlog 条目删除、重命名、静态规划合同改写、依赖环、跨 Phase 任务、关键路径断裂或规划 Hash 漂移均失败关闭；
- TASK-0034 的身份供应商、登录渠道和会话策略未获批时不得晋级；TASK-0035 的供应商、模型、凭据、区域、合同、Persona 内容和 Alpha 安全政策未全部获批时不得晋级；TASK-0036 的依赖未满足时保持 PLANNED/BLOCKED。

## 模型、Prompt、记忆和安全边界

- TASK-0011 已完成 OpenAI Chat Completions 离线 Adapter；Anthropic Messages 离线合同保留为
  TASK-0033，以满足两个主协议的本地 mock-server 要求；
- OpenAI Responses 仅为 spike，不纳入 Alpha 实现队列；
- 本任务不修改 Prompt、Persona 内容、安全分类策略、Canonical Memory 或模型路由实现；
- Provider SDK 类型、模型名、Key 与错误类型不得泄漏到业务模块；真实外发前必须通过 Provider
  Registry、Execution Authorization Guard、安全流水线、模拟权益和故障恢复任务。

## 验收标准

1. `.harness/task-backlog.yaml` 恰好登记 TASK-0012～TASK-0036 的 25 个永久编号和规定名称；执行顺序唯一，依赖全部可解析且无环，声明的关键路径是连续依赖链并终止于 TASK-0036。
2. TASK-0013～TASK-0036 均存在唯一 PLANNED 卡，Card Path、Task ID 和可复算规划合同 Hash 与 Backlog 一致；卡中不存在任何提前冻结的动态证据字段。
3. Lifecycle、Doctor 与项目状态允许多个 PLANNED，但最多一个 DRAFT、最多一个 active task；PLANNED 不占
   `activeTask`、不能作为执行任务或绕过 Diff Scope。
4. Backlog 的晋级解析同时执行依赖、执行顺序和硬决策闸门；最终快照中下一张可晋级卡为
   TASK-0013，TASK-0034/0035 因硬闸门保持不可晋级，TASK-0036 因依赖保持 PLANNED/BLOCKED。
5. TASK-0012～TASK-0036 的编号和静态合同在 Git 历史中不可删除、复用或静默改写；取消/替代只能保留
   REJECTED/SUPERSEDED 记录与非空原因。
6. Backlog 已注册到 Sources of Truth，新增 Harness 不变量由 Doctor 和测试实际消费；task-intake Skill
   升级且注册表、Frontmatter、任务模板、恢复文档和 Agent 入口 Hash 一致。
7. 自动测试覆盖所有成功与失败语义；固定 JDK 25 Maven、Python/PowerShell/WSL canonical precheck、
   `git diff --check` 和精确实现 SHA 的 GitHub CI 全部真实通过。
8. 无实现历史上下文的独立 Reviewer 绑定精确 Commit/Tree，复核生命周期、唯一真源、DAG/闸门、ID
   永久性、动态字段、失败关闭、测试和范围边界，最终 P0/P1/P2 均闭环。

## 必跑检查

以 YAML `requiredCommands` 的精确 argv 为准。正式终态前另运行
`python scripts/harness/doctor.py --task TASK-0012 --pre-closure`；canonical precheck 已包含正式
Doctor，不在同一终态快照重复登记 standalone Doctor。

## 回滚或前向修复

若新增状态或 Backlog 校验破坏既有任务历史、授权锚、终态 Evidence 或跨平台入口，前向修复统一 Python
Harness 和测试；不得删除历史任务、放宽检查或退回多 DRAFT。若静态规划合同需要改变，保留原 ID 的
REJECTED/SUPERSEDED 记录并以新永久 ID 提交独立治理任务，不覆盖原规划事实。

## 停止条件

- 远端 main 出现不可安全快进、未知工作区修改或任务 Base 不再是最新终态边界；
- 需要弱化既有 Harness、改写历史 Ledger/Evidence/Handoff 或扩大到业务代码才能通过；
- DAG、硬决策闸门或 Technical Alpha 范围仍存在会改变交付方向的未决语义；
- Reviewer 发现 P0/P1 未闭环，或最终实现 Commit/Tree、CI 与 Evidence 无法精确绑定。

## Evidence Pack

输出到 `docs/evidence/TASK-0012/`，并生成 `docs/handoffs/TASK-0012.json`。C4 实现必须由未参与实现且无实现历史上下文的独立 Reviewer 绑定精确实现 Commit 与 Git Tree 复验。

# TASK-0003：冻结供应商中立的身份与登录会话安全边界

```yaml
taskId: TASK-0003
state: IN_REVIEW
owner: repository-owner
riskClass: C3
requiredSkills:
  - task-intake
  - contract-change
requiredSkillVersions:
  task-intake: 1.1.0
  contract-change: 1.0.0
targetSkillVersions: {}
baseCommit: 6a86b19fb9f8671aaaaba26aa2b2bf8573f925a9
authorizationCommit: 312cd5c9fcdc5fa8ce26a70571cc7b01899c0d0c
contextFingerprint: e0ab9aa55e2a73c409b5b582e0ac6f6589d232e0f0d959ed5178cfb20be28b39
contextLock: docs/tasks/context/TASK-0003.context-lock.yaml
contextFingerprintAlgorithm: SHA256_ORDINAL_SORTED_PATH_EQUALS_HASH_LF_V1
readAllowlist:
  - AGENTS.md
  - README.md
  - .harness/**
  - skills/task-intake/SKILL.md
  - skills/contract-change/SKILL.md
  - specs/catalog/product-scope.yaml
  - specs/catalog/age-states.yaml
  - specs/catalog/error-codes.yaml
  - specs/contracts/**
  - docs/architecture/**
  - docs/decisions/**
  - docs/source/**
  - docs/tasks/**
  - docs/handoffs/**
writeAllowlist:
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - docs/tasks/TASK-0003-identity-session-contract.md
  - docs/tasks/context/TASK-0003.context-lock.yaml
  - docs/evidence/TASK-0003/**
  - docs/handoffs/TASK-0003.json
  - docs/decisions/0004-identity-session-boundary.md
  - specs/contracts/identity-session-boundary-contract.yaml
forbiddenPaths:
  - specs/catalog/**
  - specs/generated/**
  - service/**
  - frontend/**
  - db/**
  - deploy/**
  - ops/**
  - docs/source/**
  - .github/**
  - ci/**
  - scripts/**
  - skills/**
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
  - specs/catalog/product-scope.yaml
  - specs/catalog/age-states.yaml
  - specs/catalog/error-codes.yaml
  - specs/contracts/database-ownership-contract.yaml
  - specs/contracts/realtime-contract.yaml
  - specs/contracts/beta-gate-contract.yaml
  - specs/contracts/license-cost-boundary-contract.yaml
requiredInvariants:
  - INV-TENANT-001
  - INV-RT-001
  - INV-COST-001
  - INV-HARNESS-002
  - INV-HARNESS-003
  - INV-HARNESS-005
humanApprovals:
  - scope: decision-free-identity-session-boundary-contract
    approvedBy: repository-owner
    approvedAt: 2026-07-30
    evidence: 用户明确要求继续按需求清单和功能计划自主完成所有不依赖其决策的任务；本任务只冻结现有机器真源已确定的安全边界，不代替 Owner 选择 IdP、API、TTL、账号供给或状态语义
independentReview: required
reviewers:
  - id: codex-identity-boundary-reviewer
    kind: security-contract
    verdict: PASS
    reviewedCommit: 3645416657455a54b00725d77b3d7043c51e394b
    evidencePath: docs/evidence/TASK-0003/review-identity-boundary.md
requiredCommands:
  - python scripts/harness/doctor.py --task TASK-0003
  - python scripts/harness/catalog_tool.py validate
  - python scripts/harness/catalog_tool.py diff --fail-on-drift
  - python scripts/harness/precheck.py --task TASK-0003
  - powershell -NoProfile -ExecutionPolicy Bypass -File scripts/harness/precheck.ps1 -Task TASK-0003
  - wsl.exe -d Ubuntu-24.04 -- bash scripts/harness/precheck.sh --task TASK-0003
  - git diff --check
```

## 背景与用户可观察目标

Project State 要求首个业务任务从用户身份与会话边界开始。当前机器真源已经明确所有权、H5 凭据安全、公开注册关闭、成本和失败关闭原则，但尚未选择 IdP、登录渠道、TTL、账号供给或公开 API。

本任务只把已经确定的安全交集冻结为供应商中立 Contract 与 ADR。完成后，后续 Agent 可以在不依赖聊天历史的情况下判断一个身份实现是否越过信任边界；仍需 Owner 决策的产品参数被机器可读地列为延后项，而不是用临时默认值掩盖。

本任务不提供可运行登录，也不创建真实用户。

## 范围内

- 新增身份与认证登录会话边界 Contract；
- 明确认证登录会话、Conversation、实时恢复 Ticket 和记忆 `SESSION` 是不同概念及不同标识；
- 明确身份与 `owner_user_id` 只能来自服务端验证后的映射，客户端声明不构成所有权；
- 明确 H5 Cookie、CSRF、Origin 与长期 Token 禁止边界；
- 明确未认证、一般拒绝、跨用户资源隐藏和年龄门禁使用现有 Catalog ErrorCode；
- 明确身份提供方必须位于自有端口之后，核心运行时不得只依赖付费或托管 IdP；
- 明确公开注册、真实 Beta 和真实支付保持关闭；
- 新增 ADR 记录为什么先冻结安全交集、哪些选择被有意延后。

## 明确范围外

- 选择或部署 Keycloak、托管 IdP、短信、微信、Apple、邮箱、Passkey；
- 定义登录/登出/当前用户的 URL、HTTP 方法、状态码或错误包络；
- 定义 Cookie 名、SameSite 精确值、TTL、刷新、轮换、并发设备或撤销策略；
- 定义账号状态、认证会话状态、首次登录建档、邀请或账号合并；
- 修改 Catalog、生成物、应用代码、前端、数据库、迁移、部署或 CI；
- 自研密码、Token、MFA、OIDC/OAuth、Refresh Token 或会话撤销核心；
- 真实用户、真实个人数据、公开注册、真实 Beta 或真实支付。

## 输入和前置条件

- Base Commit 为 TASK-0002 的终态边界 `6a86b19fb9f8671aaaaba26aa2b2bf8573f925a9`；
- TASK-0003 在 READY 前只允许任务卡和 Context Lock 发生变化；
- `TECHNICAL_ALPHA`、公开注册关闭、支付关闭和 Beta 生成默认关闭不得改变；
- 历史 `docs/source/**` 只能解释背景，不能覆盖机器真源；
- 本任务不接受 `ADR-0002` 的持久化或 OpenAPI 提议；
- READY 后由 `contract-change@1.0.0` 执行，C3 必须独立复核。

## 生产者、消费者与兼容窗口

- 未来生产者：成熟身份提供方适配器验证外部凭据后产生服务端认证主体与认证会话上下文；
- 未来消费者：API 入口、Owner 解析器、用户域查询、实时 Ticket 签发和审计边界；
- 当前仓库没有身份生产者或消费者，因此本契约是新增约束，不存在旧客户端兼容窗口；
- 任何首个实现必须先满足本契约，不得以“暂时本地开发”为由信任 Header、query、请求体或硬编码生产用户。

## API / 事件 / 数据契约

Contract 至少包含：

- `authenticationSessionId` 只表示认证登录会话；
- `conversationId` 只表示业务对话；
- `realtimeTicketId`/Ticket 只表示短期实时恢复授权；
- 记忆 `SESSION` 只表示记忆作用域；
- 上述标识不得互换或复用；
- 外部身份至少以不透明的 `provider + subject` 进入适配器边界；
- 内部 `owner_user_id` 只能由服务端受控映射产生；
- 公开 API 不得接受客户端 `owner_user_id` 作为所有权真源；
- Contract 不规定具体字段长度、数据库表或公开端点。

## 权限、RLS 和数据处理要求

- 用户域读取和写入继续遵守应用 Owner 谓词、复合所有权外键与 FORCE RLS；
- API/Worker 运行角色不得拥有 `BYPASSRLS`，不得依赖表 Owner 绕过策略；
- 外部身份映射缺失、冲突、不可验证或认证上下文不完整时失败关闭；
- 认证、账号、年龄和会话信息按最小化原则处理，不得进入普通日志、URL 或模型上下文；
- 资源不存在和属于其他用户必须使用相同外部行为，避免存在性泄漏。

## 状态机和失败行为

- 未建立有效服务端认证上下文：`AUTHENTICATION_REQUIRED`；
- 已认证但一般操作无权：`ACCESS_DENIED`；
- 用户资源不存在或不属于当前 Owner：`NOT_FOUND_OR_FORBIDDEN`；
- 需要成年验证的能力而状态不满足：`AGE_VERIFICATION_REQUIRED`；
- IdP 未配置、验证失败、映射未知、会话未知或边界字段缺失时不得猜测为已认证；
- 身份提供方不可用时不得降级为客户端用户 ID、开发 Header 或共享固定生产身份；
- 本任务不定义额外错误码或 HTTP 映射。

## H5 与凭据边界

- 优先使用 `HttpOnly + Secure + SameSite` 会话 Cookie；
- 所有状态变更必须具备 CSRF 防护和 Origin 校验；
- 长期 Token 不得放入 `localStorage`、URL、query 或实时连接参数；
- 实时 Ticket 必须保持短期、单次使用、服务端只存 Hash，且不得携带长期凭据；
- Cookie 的精确 SameSite、跨域和生命周期由后续 Owner 决策。

## 供应商、成本与安全边界

- 身份协议与认证核心由成熟组件承担，项目不从零实现；
- 自有业务代码只依赖供应商中立端口和服务端认证主体；
- 核心正确运行不得只依赖 managed-identity-only 或付费企业功能；
- 选择 Keycloak Community、其他自托管 OIDC 或托管 IdP 属后续决策；
- IdP 不保存虚拟对象关系、Conversation 或 Canonical Memory 真源。

## 延后决策

- 正式 IdP 与登录渠道；
- Alpha 账号供给与首次登录建档；
- Cookie/Bearer 具体架构和 Cookie 参数；
- 会话 TTL、刷新、撤销、多设备和并发上限；
- Account/Session 状态 Catalog；
- 外部身份绑定、合并、解绑和删除同步；
- API 路径、HTTP 状态与错误包络；
- 年龄验证供应商和申诉流程。

这些项目必须在后续任务中由 Owner 明确，不得从本 Contract 推导默认答案。

## 验收标准

1. 新 Contract 是合法 YAML，`schemaVersion` 和 `contractId` 明确。
2. 四类 Session/ID 的术语和禁止复用规则明确。
3. 客户端用户 ID 永远不能成为 Owner 真源，缺失映射时失败关闭。
4. H5 Cookie、CSRF、Origin、长期 Token 和实时 Ticket 既有边界完整保留。
5. 四个既有身份相关 ErrorCode 的使用语义明确，未新增 Catalog Code。
6. 公开注册、真实 Beta、真实支付保持关闭。
7. IdP 供应商、API、TTL、账号供给和状态机仍被明确标记为延后决策。
8. Diff 中不存在 Catalog、生成物、业务代码、数据库、前端、部署或凭据。
9. 独立 Reviewer 从客户端伪造 Owner、身份映射缺失、跨用户枚举、Token 泄漏和 managed-only 依赖五类失败场景复核并 PASS。

## 必跑检查

以 YAML `requiredCommands` 为准；每条命令记录状态、退出码、验证提交和无产物理由。独立 Reviewer 必须绑定精确实现提交。

## 回滚或前向修复

本任务不接触运行数据或环境。若 Contract 表述与既有机器真源冲突，只允许在白名单内前向修复；若无法消除冲突则进入 `REJECTED`，不得放宽 Owner、Cookie、RLS、成本或失败关闭边界。

## 停止条件

- 需要替 Owner 选择任一延后决策；
- 需要修改 Catalog、生成物、应用、前端、数据库、部署、CI 或凭据；
- 需要把历史 Markdown 草案提升为机器事实；
- 需要 managed-only 或付费企业能力成为核心前置；
- 不能证明 Contract 保留现有 Owner、H5、RLS、成本和 Beta 门禁。

## Evidence Pack

输出到 `docs/evidence/TASK-0003/`，并生成 `docs/handoffs/TASK-0003.json`。终态提交原子更新任务卡、Project State、Task Ledger、Evidence Pack 与 Handoff。

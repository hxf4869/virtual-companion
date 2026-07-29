# TASK-0003：冻结 Technical Alpha 身份与登录会话契约

```yaml
taskId: TASK-0003
state: DRAFT
owner: repository-owner
riskClass: C3
requiredSkills:
  - task-intake
  - catalog-change
  - contract-change
requiredSkillVersions:
  task-intake: 1.1.0
  catalog-change: 1.0.0
  contract-change: 1.0.0
targetSkillVersions: {}
baseCommit: 6a86b19fb9f8671aaaaba26aa2b2bf8573f925a9
authorizationCommit: ""
contextFingerprint: c53d3f8a18489894aa1f158520af0ad15c2bb17019f1187a8fc6c9c638338642
contextLock: docs/tasks/context/TASK-0003.context-lock.yaml
contextFingerprintAlgorithm: SHA256_ORDINAL_SORTED_PATH_EQUALS_HASH_LF_V1
readAllowlist:
  - AGENTS.md
  - README.md
  - .harness/**
  - skills/task-intake/SKILL.md
  - skills/catalog-change/SKILL.md
  - skills/contract-change/SKILL.md
  - specs/catalog/**
  - specs/contracts/**
  - specs/generated/**
  - docs/architecture/**
  - docs/decisions/**
  - docs/source/**
  - docs/tasks/**
  - docs/handoffs/**
  - pom.xml
  - service/**
  - frontend/**
writeAllowlist:
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - docs/tasks/TASK-0003-identity-session-contract.md
  - docs/tasks/context/TASK-0003.context-lock.yaml
  - docs/evidence/TASK-0003/**
  - docs/handoffs/TASK-0003.json
  - docs/decisions/0004-identity-and-authentication-session-boundary.md
  - specs/catalog/catalog-manifest.yaml
  - specs/catalog/account-states.yaml
  - specs/catalog/authentication-session-states.yaml
  - specs/catalog/error-codes.yaml
  - specs/contracts/identity-session-contract.yaml
  - specs/generated/**
forbiddenPaths:
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
  - specs/catalog/catalog-manifest.yaml
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
humanApprovals: []
independentReview: required
reviewers: []
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

仓库下一动作要求从用户身份与会话最小闭环开始，但现有机器真源只确定了安全底线，没有冻结登录提供方、凭证承载、账号状态、认证会话生命周期或公开 API 形状。

本任务在 Owner 作出下方限定决策后，把身份与“认证登录会话”的最小语义冻结为 Catalog、Contract 和 ADR，使后续实现任务不再依赖某个 Agent 的临时理解。任务完成后，开发者能够从机器真源明确回答：谁建立身份、系统内部信任什么、登录态怎样创建和撤销、H5 如何保存凭据、哪些状态和错误可出现，以及哪些能力仍然关闭。

当前 DRAFT 不是业务实现授权；在 Owner 批准前，项目状态保持无活动任务，业务实现门禁保持 `BLOCKED`。

## 范围内

- 明确本任务中的 `session` 仅表示认证登录会话；Conversation、实时恢复会话和记忆 `SESSION` 作用域保持独立；
- 选择 Technical Alpha 身份提供方边界，并保持核心运行时不依赖付费或托管身份能力；
- 冻结内部 `owner_user_id` 与外部身份 `provider + subject` 的映射原则；
- 冻结账号状态、认证会话状态、合法迁移和最小错误语义；
- 冻结 H5 凭据承载、Cookie、CSRF、Origin、Token 禁止项和注销语义；
- 冻结公开注册关闭时的内部 Alpha 账号供给方式；
- 定义创建登录态、查询当前主体、销毁当前登录态三类能力的契约形状；
- 为后续 C4 数据库与实现任务明确边界、停止条件和测试义务；
- 通过 Catalog 生成器产生确定性 Java/TypeScript 生成物。

## 明确范围外

- 任何 Java、前端、数据库迁移、部署或运行环境实现；
- 真实用户、公开注册、真实 Beta、真实支付或真实年龄验证；
- 自研密码哈希、找回密码、MFA、OAuth/OIDC 协议、Refresh Token 轮换或 IdP 会话撤销核心；
- 短信、微信、Apple、邮箱、Passkey 或其他真实登录连接器；
- Conversation、消息、角色、模型、记忆、安全审核、权益或支付能力；
- 接受 `ADR-0002` 的全部持久化/OpenAPI 提议；
- 修改现有迁移、真实账号、真实个人数据、凭据或外部系统。

## 输入和前置条件

- Base Commit 必须保持为 `6a86b19fb9f8671aaaaba26aa2b2bf8573f925a9`；
- `TECHNICAL_ALPHA`、公开注册关闭、支付关闭、Beta 生成默认关闭不可被本任务放宽；
- H5 必须遵守现有实时 Contract 中的 HttpOnly/Secure/SameSite Cookie 偏好、CSRF、Origin 和长期 Token 禁令；
- 用户域仍受应用 Owner 谓词、复合所有权外键、FORCE RLS 和无 `BYPASSRLS` 约束；
- 历史 `docs/source/**` 只提供需求线索，不覆盖机器真源；
- Owner 必须逐项确认“待 Owner 决策”，再把任务从 DRAFT 更新为 READY；
- READY 授权必须按 Task Intake 形成原子授权提交，并在后续单文件提交写入 `authorizationCommit`。

## 待 Owner 决策

以下项目均会改变安全或产品语义，DRAFT 不预填人工批准：

1. **会话术语**：建议本任务只定义“认证登录会话”；Conversation、SSE 恢复 `sessionId` 和记忆 `SESSION` 另行命名并禁止混用。
2. **身份提供方**：建议业务契约保持 OIDC 中立，Technical Alpha 的首个可运行实现采用自托管 Keycloak Community；托管 IdP 作为可替换适配器，不成为核心运行前提。
3. **H5 凭据模式**：建议采用 BFF/服务端登录会话与 `HttpOnly + Secure + SameSite` Cookie，浏览器不持有长期 Bearer/Refresh Token；具体 SameSite、Cookie 名和跨域策略需确认。
4. **Alpha 账号供给**：建议仅管理员预置或一次性邀请，不提供公开注册；需要确认账号领取、失效和审计方式。
5. **会话生命周期**：需要确认空闲/绝对超时、轮换、单设备或多设备、并发上限、逐会话/全账号撤销及失效后的行为。
6. **状态 Catalog**：需要确认账号与认证会话状态集合、合法迁移、停用/删除语义和新账号初始年龄状态。
7. **API 与错误包络**：需要确认端点路径、HTTP 方法/状态码、幂等要求和统一错误响应；现有错误码只覆盖认证必需、拒绝、资源隐藏和年龄验证。
8. **内部所有权映射**：需要确认首次见到外部 `provider + subject` 时是拒绝、自动建档还是绑定预置账号，以及合并/解绑规则。

## API / 事件 / 数据契约

本任务只冻结能力，不在 DRAFT 中把历史草案路径冒充已批准 API：

- `CreateAuthenticationSession`：由已选成熟身份提供方完成认证后建立本系统登录态，不接受客户端声明 `owner_user_id`；
- `GetCurrentIdentity`：只返回当前主体所需的最小账号、年龄和会话投影，不提供任意 `{userId}` 查询；
- `RevokeCurrentAuthenticationSession`：使当前登录态失效并清理客户端可用凭据；
- 外部身份唯一性至少绑定 `provider + subject`，内部所有权只能来自服务端已验证映射；
- 认证会话 ID、Conversation ID、Generation ID、实时恢复 Ticket 和记忆作用域不得复用；
- 错误不得泄漏其他用户或账号是否存在。

若 Owner 批准新增 Catalog，Catalog Manifest、源文件和全部生成物必须由生成器一次性更新，不得手改 `specs/generated/**`。

## 权限、RLS 和数据处理要求

- 任何前端请求体、Header、query 或路径中的用户 ID 都不能单独建立数据所有权；
- 后续实现必须同时执行服务端身份映射、应用 Owner 谓词与数据库 FORCE RLS；
- API/Worker 运行角色不得拥有 `BYPASSRLS`，不得以表 Owner 身份运行；
- 身份资料、年龄结果和账号元数据按敏感个人信息最小化处理，不写日志或客户端缓存；
- 未认证访问保护资源使用 `AUTHENTICATION_REQUIRED`；
- 已认证但无权执行一般操作使用 `ACCESS_DENIED`；
- 用户资源不存在或不属于当前 Owner 时统一使用 `NOT_FOUND_OR_FORBIDDEN`；
- 需要成年验证的能力在状态不满足时使用 `AGE_VERIFICATION_REQUIRED`。

## 状态机和失败行为

- DRAFT 阶段缺少任一 Owner 决策时不得进入 READY；
- 后续实现必须默认拒绝：IdP 未配置、映射不存在、会话失效、状态未知、年龄未知或授权上下文缺失时均不得猜测为可访问；
- 登出或撤销结果不确定时，客户端立即隐藏受保护数据，不得继续显示已认证业务态；
- 身份提供方不可用不得降级为信任客户端用户 ID、开发 Header 或硬编码生产用户；
- 公开注册、Beta 生成和支付门禁不得随身份功能自动开启。

## 模型、Prompt、记忆和安全边界

- 本任务不调用模型、不发送身份数据给模型供应商、不创建记忆；
- 认证会话不得成为 Conversation、模型供应商会话或 Canonical Memory 真源；
- 安全、数据权利和年龄申诉入口不能因账号无付费权益而关闭；
- Keycloak 或其他 IdP 只提供身份协议与认证能力，不保存虚拟陪伴业务关系。

## 验收标准

1. 认证会话与 Conversation、实时恢复和记忆 `SESSION` 的术语/ID 边界无歧义。
2. 身份提供方、H5 凭据模式、账号供给和会话生命周期有 Owner 的精确批准记录。
3. Catalog 包含经过批准的账号/认证会话状态及合法迁移；生成物与源文件无漂移。
4. 身份会话 Contract 明确创建、查询当前主体、撤销、失败关闭、CSRF/Origin/Cookie 与长期 Token 禁令。
5. 外部身份到内部 Owner 的映射不信任客户端输入，并保留复合所有权与 FORCE RLS 要求。
6. 错误码、HTTP 状态和错误包络映射完整，不泄漏账号或跨用户资源存在性。
7. `publicRegistrationEnabled`、Beta 与支付门禁保持关闭。
8. 独立 Reviewer 覆盖认证失败、撤销、跨用户访问、资源枚举、CSRF、Origin、Cookie 和 Token 泄漏场景。
9. 后续实现任务的数据库、后端、前端、IdP 适配器和测试范围可由本契约直接推导，无需依赖历史聊天。

## 必跑检查

以 YAML `requiredCommands` 为准；每条命令记录状态、退出码、验证提交、产物哈希或无产物理由。

## 回滚或前向修复

本任务不接触运行数据。Catalog/Contract 一旦进入 READY 后只允许在任务白名单内前向修复；若 Reviewer 拒绝，任务进入 `IN_PROGRESS` 或 `REJECTED`，保留失败事实。不得为通过检查而放宽公开注册、年龄、Cookie、Owner 或 RLS 边界。

## 停止条件

- Owner 尚未批准任一“待 Owner 决策”；
- 需要实现登录、数据库、前端、IdP、真实连接器或部署；
- 需要接触凭据、真实账号或个人数据；
- 需要修改现有 Catalog/Contract 的未授权语义，或手改生成物；
- 需要接受 `ADR-0002` 的全部提议而没有独立架构决定；
- 无法证明核心运行时不依赖付费/托管身份能力；
- 无法通过 Catalog 漂移、Harness Doctor 或独立复核。

## Evidence Pack

进入 READY 并完成契约冻结后输出到 `docs/evidence/TASK-0003/`，并生成 `docs/handoffs/TASK-0003.json`。DRAFT 阶段不创建 Evidence/Handoff，不修改 Project State。

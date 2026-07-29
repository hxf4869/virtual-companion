# TASK-0004：交付 Technical Alpha 能力门禁与 Runtime 连通性页面

```yaml
taskId: TASK-0004
state: DRAFT
owner: repository-owner
riskClass: C2
requiredSkills:
  - task-intake
requiredSkillVersions:
  task-intake: 1.1.0
targetSkillVersions: {}
baseCommit: 0bad567f18e2d5eadecff002037af000ddde3227
authorizationCommit: ""
contextFingerprint: a79fb2988933edc7d57a0fdd4ec57c72b64e5e6fd55de8899e8d61ab5d0c3303
contextLock: docs/tasks/context/TASK-0004.context-lock.yaml
contextFingerprintAlgorithm: SHA256_ORDINAL_SORTED_PATH_EQUALS_HASH_LF_V1
readAllowlist:
  - AGENTS.md
  - README.md
  - .harness/**
  - skills/task-intake/SKILL.md
  - specs/catalog/product-scope.yaml
  - specs/generated/catalog.snapshot.json
  - specs/contracts/beta-gate-contract.yaml
  - specs/contracts/license-cost-boundary-contract.yaml
  - docs/architecture/**
  - docs/tasks/**
  - docs/handoffs/**
  - pom.xml
  - service/platform/catalog/**
  - service/apps/runtime/**
  - frontend/**
writeAllowlist:
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - docs/tasks/TASK-0004-alpha-capability-gate.md
  - docs/tasks/context/TASK-0004.context-lock.yaml
  - docs/evidence/TASK-0004/**
  - docs/handoffs/TASK-0004.json
  - service/platform/catalog/pom.xml
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/baseline/BaselineResponse.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/baseline/BaselineService.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/baseline/CatalogSnapshotLoader.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/baseline/TechnicalAlphaCapabilities.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/baseline/BaselineControllerTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/baseline/CatalogSnapshotLoaderTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/RuntimeContextTest.java
  - frontend/package.json
  - frontend/pnpm-lock.yaml
  - frontend/vitest.config.ts
  - frontend/src/api/baseline.ts
  - frontend/src/api/baseline.spec.ts
  - frontend/src/domain/capability-gates.ts
  - frontend/src/domain/capability-gates.spec.ts
  - frontend/src/stores/baseline.ts
  - frontend/src/stores/baseline.spec.ts
  - frontend/src/pages/index/index.vue
  - frontend/src/pages.json
  - frontend/src/manifest.json
forbiddenPaths:
  - specs/catalog/**
  - specs/contracts/**
  - specs/generated/**
  - service/**/modelruntime/**
  - service/**/safety/**
  - service/**/memory/**
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
  - specs/generated/catalog.snapshot.json
  - specs/contracts/beta-gate-contract.yaml
  - specs/contracts/license-cost-boundary-contract.yaml
  - docs/handoffs/TASK-0003.json
requiredInvariants:
  - INV-COST-001
  - INV-HARNESS-002
  - INV-HARNESS-003
  - INV-HARNESS-005
humanApprovals:
  - scope: technical-alpha-capability-gate-and-runtime-connectivity-page
    approvedBy: repository-owner
    approvedAt: 2026-07-30
    evidence: 用户明确要求继续按需求清单和功能计划自主完成所有不依赖其决策的任务；本任务只展示已冻结的 Technical Alpha 能力门禁与本地 Runtime 连通性，不开放真实用户、支付、模型或身份能力
independentReview: not-required
reviewers: []
requiredCommands:
  - python scripts/harness/doctor.py --task TASK-0004
  - python scripts/harness/catalog_tool.py validate
  - python scripts/harness/catalog_tool.py diff --fail-on-drift
  - .\mvnw.cmd --batch-mode --no-transfer-progress verify
  - pnpm --dir frontend test:run
  - pnpm --dir frontend type-check
  - pnpm --dir frontend build:h5
  - python scripts/harness/precheck.py --task TASK-0004
  - powershell -NoProfile -ExecutionPolicy Bypass -File scripts/harness/precheck.ps1 -Task TASK-0004
  - wsl.exe -d Ubuntu-24.04 -- bash scripts/harness/precheck.sh --task TASK-0004
  - git diff --check
```

## 背景与用户可观察目标

当前 H5 只把 `/api/internal/baseline` 的整段 JSON 显示在通用白色卡片中，用户无法快速区分“Runtime 已连接”“Catalog 中允许的值”和“当前真正开放的能力”。Technical Alpha 的公开注册、支付、浪漫、语音、图片、WebSocket 与 Beta 默认生成均已由机器真源关闭，但页面没有把这些边界结构化呈现。

本任务交付一个内部开发预检页：开发者或产品协作者打开 H5 后，能在一个屏幕内看清 Runtime 连通状态、当前 `TECHNICAL_ALPHA + HTTP_SSE` 基线，以及七项受限能力是否仍保持关闭。后端不可达或响应不可信时，页面明确提示修复动作，并继续按关闭处理。

## 范围内

- 将 `specs/generated/catalog.snapshot.json` 作为 Catalog JAR 的只读资源打包；
- Runtime 从生成快照白名单提取 phase、transport 和七项布尔门禁，禁止手写第二份能力常量；
- `/api/internal/baseline` 以向后兼容的新增字段返回最小能力投影，不暴露整份快照；
- 前端严格验证响应、区分 loading/ready/unreachable/timeout/http/invalid-response；
- 页面结构化显示门禁，默认隐藏原始技术详情，并提供清晰重试操作；
- 增加后端、API、Store 和纯门禁映射测试；
- 更新页面与 H5 标题，使其准确表示内部 Technical Alpha 边界台。

## 明确范围外

- 登录、注册、真实用户、账号、Cookie、Token 或身份提供方；
- Conversation、角色、模型调用、真实 Provider、Fake/Failure Adapter、ZERO_LLM、记忆或安全处置；
- 打开 Beta、支付、WebSocket、语音、图片、浪漫模式或任何当前关闭能力；
- 展示当前 ServiceMode、宣称真实模型已连接，或把 `realModelEndpointCount` 当成运行事实；
- 正式 AI 身份声明、品牌视觉、角色形象、营销文案或面向真实用户的产品承诺；
- 修改 Catalog、Contract、生成快照、CI、部署或 Harness。

## 输入和前置条件

- Base Commit 必须是 TASK-0003 终态 `0bad567f18e2d5eadecff002037af000ddde3227`；
- 生成快照中的 `sources["product-scope.yaml"].document` 是页面能力的唯一值来源；
- 后端现有 phase/transport 构建属性必须与快照一致，不一致时失败关闭；
- 页面是内部开发视图，不得把历史需求文案提升为正式产品声明；
- DRAFT 检查点只允许任务卡与 Context Lock；READY 授权按 Task Intake 形成原子授权链。

## API / 事件 / 数据契约

`GET /api/internal/baseline` 保留现有字段，并新增以下只读投影：

```json
{
  "capabilities": {
    "source": "specs/generated/catalog.snapshot.json#sources/product-scope.yaml/document",
    "publicRegistrationEnabled": false,
    "paymentEnabled": false,
    "romanceModeEnabled": false,
    "voiceEnabled": false,
    "imageEnabled": false,
    "websocketEnabled": false,
    "betaGenerationEnabledByDefault": false
  }
}
```

- 变更是内部端点的向后兼容新增字段；现有字段不删除、不改名；
- 当前唯一消费者 H5 在同一任务内升级，无外部客户端迁移窗口；
- 后端只返回白名单投影，不返回完整快照、成本信息或未来能力配置；
- 前端只接受精确类型，七项门禁任一缺失、非布尔或意外为 `true` 都视为不可信响应，并按关闭处理。

## 权限、RLS 和数据处理要求

- 端点保持只读，不接受用户标识或请求体；
- 不新增数据库、RLS、Cookie、本地身份、客户端持久化或分析上报；
- 页面不缓存个人信息、凭据或门禁响应；
- 原始技术详情只包含现有 baseline 与门禁白名单，不包含环境变量、密钥或完整机器真源。

## 状态机和失败行为

- `idle -> loading -> ready | error`；
- 每次重试先清空旧 Payload、旧错误和旧门禁投影；
- HTTP 非 2xx、超时、网络不可达和响应非法使用不同错误类型及可行动文案；
- `ready` 只表示当前 Runtime 响应通过严格验证，不表示真实模型、身份或 Beta 已启用；
- 任何错误状态均显示“能力状态未验证，继续按关闭处理”，不得沿用上次成功结果；
- Catalog 资源缺失、结构错误、phase/transport 漂移或受限能力意外开启时，后端启动/读取失败关闭。

## 视觉方向

- **主题与单一任务**：面向开发者和产品协作者的“夜间预检边界台”，一眼判断连接和关闭边界，不模拟陪伴聊天产品；
- **颜色**：深海蓝 `#14213D`、信号青 `#168C84`、警戒珊瑚 `#D95D55`、未验证琥珀 `#B77A16`、雾蓝 `#EEF3F9`、纸白 `#FBFCFE`；
- **字体**：标题使用 `Avenir Next / Segoe UI / PingFang SC` 收窄字距，正文使用 `Inter / Segoe UI / PingFang SC`，数据标签使用等宽系统字体；
- **布局**：顶部连接信号区，中央“边界轨”串联七张关闭卡片，底部按需展开技术详情；
- **记忆点**：唯一强调元素是贯穿页面的边界轨，连接成功时稳定、读取时单点移动、失败时中断；其余视觉保持安静；
- **可访问性**：键盘焦点清晰，状态不只依赖颜色，窄屏单列，尊重 `prefers-reduced-motion`。

## 模型、Prompt、记忆和安全边界

- 不调用模型，不新增 Prompt，不产生或读取记忆；
- 不展示 ServiceMode 当前值，不把合法枚举误报为运行状态；
- 不创建 AI 身份正式文案或安全免责声明；
- 不因 Runtime 连接成功而放宽任何 Beta、年龄、安全、身份或支付门禁。

## 验收标准

1. Catalog JAR 中的快照资源字节来自受控生成物，Catalog 源与生成物无漂移。
2. Runtime 正常响应包含七项 `false` 门禁，phase 为 `TECHNICAL_ALPHA`，transport 为 `HTTP_SSE`，原字段兼容。
3. 快照缺失、字段缺失、类型错误、phase/transport 不一致或任一受限能力为 `true` 时测试证明失败关闭。
4. 前端解析器拒绝缺失、类型错误和意外开启的门禁，不把任何错误解释为能力开放。
5. Store 重试会清理旧成功数据，分别暴露 timeout、unreachable、http 和 invalid-response。
6. 页面展示连接状态、七项关闭卡片、明确错误修复动作和默认折叠的技术详情。
7. 页面不显示“当前 ServiceMode”、不声称真实模型/身份/Beta 可用，不出现正式产品或 AI 身份声明。
8. 390px 手机与 1440px 桌面 H5 均无横向溢出，交互焦点可见，减弱动画设置有效。
9. Maven verify、Vitest、Vue type-check、H5 build、三平台 Harness precheck 和 `git diff --check` 全部通过。
10. Diff 不包含 Catalog、Contract、生成物、身份、数据库、模型、安全、部署或凭据。

## 必跑检查

以 YAML `requiredCommands` 为准；每条命令记录状态、退出码、验证提交和无产物理由。另以浏览器截图检查 390×844 与 1440×900 两个视口。

## 回滚或前向修复

本任务不接触运行数据。若资源打包、响应校验或页面状态错误，只允许在白名单内前向修复；不得通过接受不完整/`true` 门禁、缓存旧成功响应或硬编码能力值让页面“看起来可用”。

## 停止条件

- 需要修改 Catalog、Contract、生成快照、CI、部署或 Harness；
- 需要开放任何当前关闭能力；
- 需要身份、真实用户、真实模型、个人数据或外部凭据；
- 只能通过放宽响应校验、删除失败测试或把目标范围误报为运行事实才能通过。

## Evidence Pack

输出到 `docs/evidence/TASK-0004/`，并生成 `docs/handoffs/TASK-0004.json`。终态提交原子更新任务卡、Project State、Task Ledger、Evidence Pack 与 Handoff。

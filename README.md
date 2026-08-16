# Virtual Companion

AI 虚拟陪伴系统的 Technical Alpha 单体仓库。身份会话、生成/记忆/安全领域内核、
PostgreSQL 持久化迁移、模型协议适配器和 uni-app H5 页面均已实现；Generation、Realtime、
Memory 的 HTTP 纵切（含异步 worker 与 Fetch-SSE 恢复流）已接通，但尚未达到真实用户或生产发布条件。

## 快速开始

日常检查唯一入口（秒级仓库检查 + 前端测试与类型检查，1 分钟内）：

```bash
bash scripts/check.sh          # 全量
bash scripts/check.sh --quick  # 仅秒级仓库检查
```

后端（需 JDK 25）与数据库（OrbStack Docker）入口见下文「当前工程能力」。当前待办见
[`TODO.md`](TODO.md)；Agent 行为约定见 [`AGENTS.md`](AGENTS.md)。

## 当前工程能力

- Catalog、OpenAPI、关键技术契约和确定性生成物；
- Java 25 + Spring Boot 4.1 的 15 模块 Maven reactor，包含 Safety、Conversation、Model Runtime、
  Persistence 以及 Fake、Failure、OpenAI Chat Completions、Anthropic Messages adapters；
- PostgreSQL 18 + pgvector 的 V1-V15 迁移和完整 SQL/RLS/并发测试入口；
- 自托管 Auth 的 login、refresh rotation、logout、admin account provisioning、cookie/CSRF、输入边界、
  admission limiter 与 production profile fail-closed 配置；
- uni-app + Vue 3 + TypeScript + Pinia 的 Login、Chat、Memory H5 页面、typed transport 与组件/状态测试；
- GitHub Actions 的后端、前端、数据库、供应链与快速检查门禁。

这些组件的存在不等于端到端产品已经接线。当前 runtime 固定提供：

- `GET /actuator/health`
- `GET /api/internal/baseline`
- `GET /api/v1/version`（公开，OpenAPI `getVersion`）

显式开启 Auth 及其 datasource 后，runtime 还提供：

- `POST /api/v1/auth/login`
- `POST /api/v1/auth/refresh`
- `POST /api/v1/auth/logout`
- `POST /api/v1/auth/admin/accounts`
- `POST /api/v1/relationships`、`GET /api/v1/relationships`、`GET/POST /api/v1/relationships/{relationshipId}`、
  `POST /api/v1/relationships/{relationshipId}/deactivate`
- `POST /api/v1/conversations`、`POST /api/v1/conversations/{conversationId}/generations`、
  `GET /api/v1/conversations/{conversationId}/messages`
- `GET /api/v1/generations/{generationId}/snapshot`、`POST /api/v1/generations/{generationId}/cancel`
- `POST /api/v1/realtime/tickets`、`GET /api/v1/realtime/streams/{generationId}`（Fetch-SSE 恢复流）
- 8 个 memory 端点（candidates/list/get/update/delete/confirm/reject/evidence）

`specs/openapi/virtual-companion.yaml` 的合同面已全部由 runtime controller 实现（version、
relationship、conversation、generation、snapshot、cancel、message、realtime、memory）。
Chat/Memory 页面、领域内核、provider adapters 和数据库函数是已实现的组成部分；纵切仅限本地开发与
CI 合成数据，不应被描述成已可供真实用户调用。真实 provider 默认关闭，具体 deployment、endpoint 和
凭据只允许由部署配置注入。

后端需要 JDK 25：

```powershell
.\mvnw.cmd --batch-mode --no-transfer-progress verify
```

```bash
./mvnw --batch-mode --no-transfer-progress verify
```

前端使用 Node.js 22 和 pnpm 11：

```text
pnpm --dir frontend install --frozen-lockfile
pnpm --dir frontend test:run
pnpm --dir frontend type-check
pnpm --dir frontend build
```

数据库全迁移与 SQL/RLS/并发测试使用 OrbStack Docker：

```bash
bash infra/db/run-rls-tests.sh
```

Windows + WSL2 Docker 的本机辅助入口位于 `scripts/dev/*.ps1`。这些脚本是该主机环境的便利工具，不是 macOS/Linux 的必要前置；其他平台直接使用 Maven Wrapper、pnpm 和 `scripts/check.sh`。

## 文档与历史档案

- 架构决策：`docs/decisions/`；技术基线：`docs/engineering/technology-baseline.md`
- 检查与流程设计原则：`docs/engineering/checks-principles.md`（新增任何检查前必读，防过度工程化复发）
- 仓库边界：`docs/architecture/repository-structure.md`；原始需求快照：`docs/source/`（仅历史来源）
- 机器契约：`specs/catalog/`、`specs/contracts/`、`specs/openapi/`；`specs/generated/**` 为生成物，禁止手改
- 2026-08-16 退役的旧任务治理体系（任务卡、Evidence、Handoff、账本）只读保留在
  `docs/tasks/`、`docs/evidence/`、`docs/handoffs/`、`docs/archive/`，仅供追溯
- 当前待办：[`TODO.md`](TODO.md)

## 安全与发布状态

当前只允许本地开发和 CI 使用合成数据。普通 profile 的 Auth 与 live provider 均默认关闭；production profile
要求 Auth 和 datasource 两个开关显式为 `true`：缺少任一配置或显式 `false` 都会启动失败（fail-closed，
由配置代码自身强制），但这不代表生产就绪。系统未开放注册、未启用真实支付、未授权保存真实用户数据。
generation/realtime/memory 纵切已接通，但仅限本地开发与 CI 合成数据，不面向真实用户。

Duty-roster 检查通过不等于 Beta 获批；`realUserBeta` 在 PIA、伦理适用性、成年人验证、责任人、值班和安全
演练形成证据前保持 `BLOCKED`，`realPayment` 在 Technical Alpha 保持 `FORBIDDEN`。真实 provider 外发还必须
满足授权快照、最终安全审查、持久化 quota/registry、部署和密钥治理等独立门禁。

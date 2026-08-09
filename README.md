# Virtual Companion

AI 虚拟陪伴系统的 Technical Alpha 单体仓库。当前已实现身份会话、生成/记忆/安全领域内核、
PostgreSQL 持久化迁移、模型协议适配器和 uni-app H5 页面，但还没有接通 Generation、Realtime、
Memory 的完整 HTTP 纵切，也未达到真实用户或生产发布条件。

## Agent 或开发者从这里开始

1. 阅读 [`AGENTS.md`](AGENTS.md)，它是唯一 Agent 行为真源。
2. 安装 Harness 依赖。
3. 运行状态摘要和统一 precheck。

先激活让 `python` 指向项目 Harness 环境的虚拟环境。Windows PowerShell：

```powershell
python -m pip install -r requirements-harness.txt
python scripts/harness/doctor.py --summary
python scripts/harness/precheck.py
```

macOS、Linux 或 WSL：

```bash
python -m pip install -r requirements-harness.txt
python scripts/harness/doctor.py --summary
python scripts/harness/precheck.py
```

PowerShell/POSIX 包装器仍可用于本机辅助，但正式 Evidence 的 canonical 入口是上面的
`python scripts/harness/precheck.py`。不要从 README 猜当前任务；`.harness/project-state.yaml` 与 Doctor
的扫描结果才是当前状态。

## 当前工程能力

- Catalog、OpenAPI、关键技术契约和确定性生成物；
- Java 25 + Spring Boot 4.1 的 15 模块 Maven reactor，包含 Safety、Conversation、Model Runtime、
  Persistence 以及 Fake、Failure、OpenAI Chat Completions、Anthropic Messages adapters；
- PostgreSQL 18 + pgvector 的 V1-V15 迁移和完整 SQL/RLS/并发测试入口；
- 自托管 Auth 的 login、refresh rotation、logout、admin account provisioning、cookie/CSRF、输入边界、
  admission limiter 与 production profile fail-closed 配置；
- uni-app + Vue 3 + TypeScript + Pinia 的 Login、Chat、Memory H5 页面、typed transport 与组件/状态测试；
- GitHub Actions 的跨平台 Harness，以及后端、前端和数据库门禁；
- 可恢复的任务卡、Context Lock、Evidence 和 Handoff。

这些组件的存在不等于端到端产品已经接线。当前 runtime 固定提供：

- `GET /actuator/health`
- `GET /api/internal/baseline`

显式开启 Auth 及其 datasource 后，runtime 还提供：

- `POST /api/v1/auth/login`
- `POST /api/v1/auth/refresh`
- `POST /api/v1/auth/logout`
- `POST /api/v1/auth/admin/accounts`

`specs/openapi/virtual-companion.yaml` 还定义了 relationship、generation、message、snapshot 和 memory 的合同面，
但当前 runtime 没有对应 controller。Chat/Memory 页面、领域内核、provider adapters 和数据库函数是已实现的
组成部分，不应被描述成已可供真实用户调用的完整纵切。真实 provider 默认关闭，具体 deployment、endpoint
和凭据只允许由部署配置注入。

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

Windows + WSL2 Docker 的本机辅助入口位于 `scripts/dev/*.ps1`。这些脚本是该主机环境的便利工具，不是 macOS/Linux 的必要前置；其他平台直接使用 Maven Wrapper、pnpm 和统一 Harness。

## 治理与开发入口

- Agent 恢复和跨客户端说明：`docs/engineering/agent-onboarding.md`
- 项目机器状态：`.harness/project-state.yaml`
- 终态任务与审计产物索引：`.harness/task-ledger.yaml`
- 原始需求与架构快照：`docs/source/`（仅历史来源）
- 根目录 `MANIFEST.sha256`：仅证明 V0.3.1 起步包来源，不是当前仓库完整性清单
- 技术基线：`docs/engineering/technology-baseline.md`
- 仓库边界：`docs/architecture/repository-structure.md`
- 架构决策：`docs/decisions/`
- 任务、Context、Evidence、Handoff：`docs/tasks/`、`docs/evidence/`、`docs/handoffs/`
- 机器真源：`.harness/`、`specs/catalog/`、`specs/contracts/`

无 READY/IN_PROGRESS 任务时不得直接开发。禁止手改 `specs/generated/**`；Catalog、Contract、数据库、安全、记忆、模型路由和 Harness 变更必须走注册 Skill、审批和独立复核。
Harness 按完整 Git 父边历史而非最终净差异审计范围；正式检查前需暂存完整候选快照，并按任务或保护规则
要求由独立 Reviewer 复核同一精确提交。Evidence 必须用实际 argv 描述验证范围，明确区分 targeted 或
runtime-upstream reactor、root 15-module reactor、本地 exact-tree fallback 与远端 exact-SHA；历史 Evidence
保持 append-only，不为修正文案追溯改写。

## 安全与发布状态

当前只允许本地开发和 CI 使用合成数据。普通 profile 的 Auth 与 live provider 均默认关闭；production profile
要求显式开启 Auth 和 datasource，但这只证明配置缺失时会失败关闭，不代表生产就绪。系统未开放注册、
未启用真实支付、未授权保存真实用户数据，也没有接通面向用户的 generation/realtime/memory 纵切。

Duty-roster 检查通过不等于 Beta 获批；`realUserBeta` 在 PIA、伦理适用性、成年人验证、责任人、值班和安全
演练形成证据前保持 `BLOCKED`，`realPayment` 在 Technical Alpha 保持 `FORBIDDEN`。真实 provider 外发还必须
满足授权快照、最终安全审查、持久化 quota/registry、部署和密钥治理等独立门禁。

# Virtual Companion

AI 虚拟陪伴系统的 Technical Alpha 单体仓库。当前已有 V0.3.1 技术契约、机器真源、Java/Spring 与 uni-app H5 工程骨架；尚未实现用户、聊天、数据库、模型、记忆或安全业务，不能面向真实用户开放。

## Agent 或开发者从这里开始

1. 阅读 [`AGENTS.md`](AGENTS.md)，它是唯一 Agent 行为真源。
2. 安装 Harness 依赖。
3. 运行状态摘要和统一 precheck。

Windows PowerShell：

```powershell
python -m pip install -r requirements-harness.txt
python scripts/harness/doctor.py --summary
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/harness/precheck.ps1
```

macOS、Linux 或 WSL：

```bash
python3 -m pip install -r requirements-harness.txt
python3 scripts/harness/doctor.py --summary
bash scripts/harness/precheck.sh
```

所有平台最终调用同一个 `scripts/harness/precheck.py`。不要从 README 猜当前任务；`.harness/project-state.yaml` 与 Doctor 的扫描结果才是当前状态。

## 当前工程能力

- Catalog、关键技术契约和确定性生成物；
- Java 25 + Spring Boot 4.1 的 Maven 聚合工程；
- `/actuator/health` 和 `/api/internal/baseline` 两个非业务端点；
- uni-app + Vue 3 + TypeScript + Pinia 的 H5 开发基线页；
- GitHub Actions 的跨平台 Harness，以及后端、前端构建；
- 可恢复的任务卡、Context Lock、Evidence 和 Handoff。

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
pnpm --dir frontend build
```

Windows + WSL2 Docker 的本机辅助入口位于 `scripts/dev/*.ps1`。这些脚本是该主机环境的便利工具，不是 macOS/Linux 的必要前置；其他平台直接使用 Maven Wrapper、pnpm 和统一 Harness。

## 治理与开发入口

- Agent 恢复和跨客户端说明：`docs/engineering/agent-onboarding.md`
- 项目机器状态：`.harness/project-state.yaml`
- 原始需求与架构快照：`docs/source/`（仅历史来源）
- 根目录 `MANIFEST.sha256`：仅证明 V0.3.1 起步包来源，不是当前仓库完整性清单
- 技术基线：`docs/engineering/technology-baseline.md`
- 仓库边界：`docs/architecture/repository-structure.md`
- 架构决策：`docs/decisions/`
- 任务、Context、Evidence、Handoff：`docs/tasks/`、`docs/evidence/`、`docs/handoffs/`
- 机器真源：`.harness/`、`specs/catalog/`、`specs/contracts/`

无 READY/IN_PROGRESS 任务时不得直接开发。禁止手改 `specs/generated/**`；Catalog、Contract、数据库、安全、记忆、模型路由和 Harness 变更必须走注册 Skill、审批和独立复核。

## 安全与发布状态

当前只允许本地开发和 CI 验证：未接真实模型、未开放注册、未启用支付、未保存真实用户数据。Duty-roster 检查通过也不等于 Beta 获批；在 PIA、伦理适用性、成年验证、责任人、值班和安全演练全部形成证据前，生成能力必须保持关闭。

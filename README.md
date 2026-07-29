# Virtual Companion

AI 虚拟陪伴系统的 Technical Alpha 单体仓库。当前已包含 V0.3.1 技术契约与机器真源，并建立 Java/Spring 与 uni-app H5 的最小可运行工程；尚未实现聊天、用户、记忆、安全、模型或数据库业务。

## 当前能力

- Catalog、关键技术契约和确定性生成物；
- Java 25 + Spring Boot 4.1 的 Maven 聚合工程；
- `/actuator/health` 和 `/api/internal/baseline` 两个非业务端点；
- uni-app + Vue 3 + TypeScript + Pinia 的 H5 开发基线页；
- GitHub Actions 的 Harness、后端和前端检查；
- Windows 本机与 WSL2 Docker 构建入口。

## 快速开始

先安装 Harness 依赖并校验机器真源：

```powershell
python -m pip install -r requirements-harness.txt
python scripts/harness/catalog_tool.py validate
python scripts/harness/catalog_tool.py diff --fail-on-drift
python scripts/harness/check_paid_features.py
```

后端需要 JDK 25：

```powershell
.\mvnw.cmd --batch-mode --no-transfer-progress verify
.\scripts\dev\start-backend.ps1
```

如果 Windows 尚无 JDK 25，可通过已安装的 WSL2 Docker 验证：

```powershell
.\scripts\dev\maven-verify.ps1
.\scripts\dev\smoke-backend.ps1
.\scripts\dev\start-backend-container.ps1
```

前端使用 Node.js 22 和 pnpm 11：

```powershell
pnpm --dir frontend install --frozen-lockfile
pnpm --dir frontend build:h5
.\scripts\dev\start-frontend.ps1
```

后端默认地址为 `http://127.0.0.1:8080`。前端开发服务器通过本地代理访问 `/api` 和 `/actuator`，无法访问后端时必须显示离线状态，不会伪造成功数据。

## 开发入口

- 原始需求与架构快照：`docs/source/`
- 技术基线：`docs/engineering/technology-baseline.md`
- 仓库边界：`docs/architecture/repository-structure.md`
- 架构决策：`docs/decisions/`
- 当前 READY 任务：`docs/tasks/TASK-0001-project-bootstrap.md`
- 机器真源：`.harness/`、`specs/catalog/`、`specs/contracts/`

开始业务开发前先创建新的 READY 任务。禁止直接修改 `specs/generated/**`，Catalog、Contract、数据库和安全相关变更必须走对应受保护流程。

## 安全与发布状态

当前只允许本地开发和 CI 验证：未接真实模型、未开放注册、未启用支付、未保存真实用户数据。Beta 值班表保持关闭；在真实责任人、PIA、伦理评审、年龄门禁和安全演练全部完成前，不得面向真实用户开放生成能力。

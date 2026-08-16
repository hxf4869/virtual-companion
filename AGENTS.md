# Repository Agent Rules — Virtual Companion

AI 虚拟陪伴系统单体仓库：Java 25 + Spring Boot 4.1 后端（15 模块）、uni-app + Vue 3 H5 前端、
PostgreSQL 18 + pgvector。Technical Alpha：Generation/Realtime/Memory 纵切未接通，现状以 README 为准。

## 开发约定

- 改动前先读相关代码与 `specs/` 契约；`specs/generated/**` 是生成物，禁止手改
  （用 `python scripts/checks/catalog_tool.py generate` 重新生成）。
- 小步提交；不做与目标无关的重构；完成后必须验证并如实报告 PASS/FAIL/SKIP/NOT_RUN。
- 不删测试、不加 skip、不吞退出码。

## 检查与工具链

- 日常检查唯一入口：`bash scripts/check.sh`（秒级仓库检查 + 前端测试与类型检查，1 分钟内）。
- 后端（需 JDK 25）：`./mvnw --batch-mode --no-transfer-progress verify`
- 前端（Node 22 + pnpm 11）：`pnpm --dir frontend test:run && pnpm --dir frontend type-check`
- 数据库（OrbStack Docker）：`bash infra/db/run-rls-tests.sh`
- 检查脚本依赖 PyYAML；系统 python3 缺少时 `scripts/check.sh` 自动回退 `uv run --with PyYAML`。

## 红线

- 不提交密钥、Token、真实联系人或真实用户数据；真实 provider 凭据只允许部署配置注入。
- Technical Alpha 禁止真实支付与公开注册（`specs/catalog/product-scope.yaml`）。
- 真实用户 Beta 的前置条件（PIA、成年验证、值班等）未满足前不得对真实用户开放。

## 历史档案（只读）

`docs/tasks/`、`docs/evidence/`、`docs/handoffs/`、`docs/archive/` 是 2026-08-16 退役的旧治理体系产物，
仅供追溯，不适用任何流程；退役决策见 `docs/superpowers/specs/2026-08-16-checks-simplification-design.md`。

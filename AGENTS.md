# Repository Agent Rules — Virtual Companion

AI 虚拟陪伴系统单体仓库：Java 25 + Spring Boot 4.1 后端（14 模块）、uni-app + Vue 3 H5 前端、
PostgreSQL 18 + pgvector。Technical Alpha：Generation/Realtime/Memory 纵切已接通，现状以 README 为准。

## 开发约定

- 改动前先读相关代码与 `specs/` 契约；`specs/generated/**` 是生成物，禁止手改
  （用 `python scripts/checks/catalog_tool.py generate` 重新生成）。
- 小步提交；不做与目标无关的重构；完成后必须验证并如实报告 PASS/FAIL/SKIP/NOT_RUN。
- 不删测试、不加 skip、不吞退出码。

## 产品材料与持续开发入口

- `docs/source/v0.4/virtual-companion-v0.4-blueprint.md` 是目标产品与设计源快照，不是当前实现或机器真源；
  冲突时依次以本文件、相关 Catalog/OpenAPI/contract、migration/RLS、当前代码与测试、README/TODO 为准。
- `docs/planning/2026-08-22-product-enhancement-roadmap.md` 是候选 Backlog，不是完成状态真源。派发前只读取所选
  ID 及其直接依赖，并先对照当前 `HEAD`、`TODO.md`、契约和调用链，避免重做或按过时现状开发。
- Go v1 目标 runtime 以 `docs/decisions/0007-go-companion-runtime.md` 与
  `docs/planning/2026-08-30-go-companion-runtime-redesign.md` 为准；API 范围为
  `specs/catalog/go-v1-api-scope.yaml`。当前常驻 runtime 在 cutover 前仍是 Java。
- 当前 Owner-only 本地 7 天 dogfood 的决策边界只见
  `docs/decisions/0006-owner-only-local-dogfood-boundary.md`，执行顺序只见 `TODO.md` 的
  `DOGFOOD-*` 段；该范围不授权 D0、真实用户 Beta、远端部署或生产发布。
- 只有用户明确要求持续执行或使用 `/goal` 时，才进入 Goal 模式；一次只设一个可验证目标、一个路线图 ID
  或其单一写入 owner 子交付，并明确停止条件和验证入口。普通请求不得自动扩展到下一个 Backlog 项。
- 不安装 Goal Kit 的 `.agent` 状态、外部循环器或第二套检查/交接体系；跨任务恢复依赖当前 Git 状态、
  机器真源和已对账的路线图条目，不恢复下述历史档案流程。

## 检查与工具链

- 日常检查唯一入口：`bash scripts/check.sh`（秒级仓库检查 + 前端测试与类型检查，1 分钟内）。
- 后端（需 JDK 25）：`./mvnw --batch-mode --no-transfer-progress verify`
- 前端（Node 22 + pnpm 11）：`pnpm --dir frontend test:run && pnpm --dir frontend type-check`
- 数据库（OrbStack Docker）：`bash infra/db/run-rls-tests.sh`
- 检查脚本依赖 PyYAML；系统 python3 缺少时 `scripts/check.sh` 自动回退 `uv run --with PyYAML`。
- 新增任何检查前必读：`docs/engineering/checks-principles.md`（耗时预算与防过度工程化硬规则）。

## 红线

- 不提交密钥、Token、真实联系人或真实用户数据；真实 provider 凭据只允许部署配置注入。
- 日志、指标和测试产物不得记录对话正文、密钥、Token、真实联系方式或稳定的敏感标识。
- Technical Alpha 禁止真实支付与公开注册（`specs/catalog/product-scope.yaml`）。
- 真实用户 Beta 的前置条件（PIA、成年验证、值班等）未满足前不得对真实用户开放。

## 历史档案（只读）

`docs/tasks/`、`docs/evidence/`、`docs/handoffs/`、`docs/archive/` 是 2026-08-16 退役的旧治理体系产物，
仅供追溯，不适用任何流程；退役决策见 `docs/superpowers/specs/2026-08-16-checks-simplification-design.md`。

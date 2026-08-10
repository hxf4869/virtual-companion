# TASK-0148 P3-02 README 核对矩阵

生成时间：2026-08-11（候选 bbad5e7 之后的 TASK-0148 实现阶段）
核对基准：`README.md` 全部可验证声明 vs 代码/配置/OpenAPI/frontend/文件系统事实。

| # | README 声明（行号） | 核对源 | 结论 |
|---|---|---|---|
| 1 | 固定端点 `GET /actuator/health`（47 行） | `service/apps/runtime/src/main/resources/application.yaml` `management.endpoints.web.exposure.include: health`、`show-details: never` | 一致 |
| 2 | 固定端点 `GET /api/internal/baseline`（48 行） | `BaselineController.java` `@RequestMapping("/api/internal/baseline")` | 一致 |
| 3 | `POST /api/v1/auth/login`（52 行） | `AuthController.java` `@RequestMapping("/api/v1/auth")` + `@PostMapping("/login")` | 一致 |
| 4 | `POST /api/v1/auth/refresh`（53 行） | 同上 `@PostMapping("/refresh")` | 一致 |
| 5 | `POST /api/v1/auth/logout`（54 行） | 同上 `@PostMapping("/logout")` | 一致 |
| 6 | `POST /api/v1/auth/admin/accounts`（55 行） | 同上 `@PostMapping("/admin/accounts")` | 一致 |
| 7 | 合同面 version/relationship/generation/message/snapshot/memory 无 controller（57-58 行） | `specs/openapi/virtual-companion.yaml` paths 含 `/api/v1/version`、`/api/v1/relationships*`、`/api/v1/conversations*`、`/api/v1/generations*`、`/api/v1/memories*`；`grep @RequestMapping` 仅 auth/baseline 两处 | 一致 |
| 8 | Java 25 + Spring Boot 4.1 的 15 模块 Maven reactor（36 行） | `pom.xml` 14 个 `<module>` + 根 pom（项目惯例 "15 模块"，与 TASK-0112/0143 evidence 一致）；`.harness/tools.lock.yaml` JDK 25 | 一致 |
| 9 | PostgreSQL 18 + pgvector V1-V15 迁移（38 行） | `db/migration/` 15 个 V1..V15 文件；`infra/db/run-rls-tests.sh` 的 pgvector/pgvector:0.8.5-pg18 镜像 | 一致 |
| 10 | 自托管 Auth 的 login/refresh rotation/logout/admin provisioning/cookie/CSRF/输入边界/admission limiter/production fail-closed（39-40 行） | AuthController/AuthRequests 约束、CookieCsrfGuardFilter、AuthRateLimitException/Response（TASK-0122）、application.yaml `on-profile: production` 强制 VC_AUTH_ENABLED/VC_AUTH_DATASOURCE_ENABLED | 一致 |
| 11 | uni-app + Vue 3 + TypeScript + Pinia 的 Login/Chat/Memory H5 页面、typed transport（41 行） | `frontend/package.json` @dcloudio/uni-app 依赖与 `uni build` 脚本、`src/pages/{login,chat,memory,index}`、`src/api/transport.ts` | 一致 |
| 12 | GitHub Actions 跨平台 Harness + 后端/前端/数据库门禁（42 行） | `.github/workflows/ci.yml` harness-full/harness-smoke/backend/database/frontend jobs | 一致 |
| 13 | Auth 与 live provider 默认关闭、production 强制、不拒绝显式 false（110-111 行） | application.yaml `auth.enabled: ${VC_AUTH_ENABLED:false}`、`datasource-enabled: ${VC_AUTH_DATASOURCE_ENABLED:false}`、`model-providers.enabled: ${VC_MODEL_PROVIDERS_ENABLED:false}`；production profile 无默认值 | 一致 |
| 14 | 未开放注册/无真实支付/未授权真实用户数据/未接通 generation-realtime-memory 纵切（112-113 行） | 技术 Alpha 边界（phase-scope、capabilityGates realPayment FORBIDDEN、无 public registration controller） | 一致 |
| 15 | 脚本与文档引用：scripts/dev/*.ps1、docs/engineering/agent-onboarding.md、technology-baseline.md、docs/architecture/repository-structure.md（87、91-100 行） | 文件系统存在性检查 | 一致 |
| 16 | MANIFEST.sha256 仅证明 V0.3.1 起步包来源（95 行） | MANIFEST.sha256 头部说明 | 一致 |

## 结论

README.md 的全部 16 项可验证声明与当前代码、配置、OpenAPI、frontend 与文件系统事实一致；
**无差异，README.md 保持字节不变**（`git diff` 为空）。P3-02 审计项由本核对矩阵闭环：
README 未把规划能力写成可用，端点列表与 runtime 实际接线一致。

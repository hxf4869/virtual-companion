# TASK-0091 设计文档 — 获批部署持久化供给

> 状态：**设计草案（待 Owner 审阅）**｜类型：延续单卡（独立交付）｜建议执行序：第 2 张（与 TASK-0090 相互独立，可并行评估）
> 依据：TASK-0035 handoff remaining[1]（"provider_deployment 表持久化同步：ApprovedModelProviderProvisioner 目前只注册 in-memory registry；接入 JdbcProviderDeploymentRepository（datasource-enabled）同步准入状态由后续 persistence 接线"）+ TASK-0036 总验收矩阵 §5（"provider_deployment 持久化同步不存在，JDBC 仓库未接线"）

## 1. 目标

把 TASK-0035 交付的内存 `InMemoryProviderRegistry` 供给变为 **DB 持久化**：获批 enabled 部署经 `provider_deployment` 表（平台级参考数据，无 RLS）落库，使运行期供给有持久化真相、可审计、可恢复。消除 `JdbcProviderDeploymentRepository` 死代码状态。

## 2. 范围内

- **`JdbcProviderDeploymentRepository` 接线**：加 `@Repository`（或显式 `@Bean`），构造注入 `JdbcTemplate`；方法与 V4 表对齐（UPSERT/findByProviderId/findAdmitted/findAll 已实现，仅需注解 + 装配 + 单测）。
- **datasource 条件化**：沿用 TASK-0034 模式——`virtual-companion.auth.datasource-enabled`（或新增 model-providers 专属 datasource 键，intake 定）；**默认关**，不破坏 `RuntimeContextTest`/`ApprovedModelProviderConfigTest`/`ApprovedModelProviderDisabledTest` 的无 DB 上下文。
- **supplier→DB 单向同步**：`ApprovedModelProviderProvisioner`（或委托 bean）把获批 enabled 部署 UPSERT 到 `provider_deployment`；写入前核对 V4 授权（INSERT/UPDATE 仅 `vc_job_coordinator`，运行期连接角色必须匹配）。
- **运行期供给**：datasource-enabled=true 时，供给流程先持久化获批部署、再注册内存 registry（当前 TASK-0035 供给语义保持）；datasource-enabled=false 时退回纯内存供给（TASK-0035 现状），**不静默回退**。
- **失败关闭**：DB 不可用/UPSERT 失败 → 供给失败关闭（不注册半套、不假装成功）。
- **测试**：repository 单测（UPSERT/findByProviderId/findAdmitted 映射，含 text[] capabilities 数组往返）；provisioner 接线测试（datasource-on 持久化 + 注册、datasource-off 纯内存、DB 失败关闭）；条件化装配测试（默认上下文无 DB 依赖）。

## 3. 范围外

- 不改 `InMemoryProviderRegistry`/`ProviderRegistry` 语义（modelruntime 不依赖 persistence，端口类型无法引用 `ProviderDeploymentRecord`）。
- 不做 DB→registry 反向启动回填（当前无代码调 `findAdmitted()` 重灌 registry；除非 intake 评估为必要，否则留给后续）。
- 不改 adapter / modelruntime 其他模块。
- Beta、公开注册、真实支付。

## 4. 技术现状与缺口（测绘事实，2026-08-08）

| 项 | 现状 | 缺口 |
|---|---|---|
| `provider_deployment` 表 | V4 建表：provider_id/protocol/capabilities(text[])/admission_state/created_at/updated_at + CHECK(ADMITTED/DISABLED/REJECTED)；**无 owner、无 RLS**（平台级参考数据）；**直接 DML 授权**（SELECT→vc_api/vc_worker/vc_job_coordinator/vc_dispatcher；INSERT/UPDATE→仅 vc_job_coordinator；无 DELETE）；V5–V14 无后续改动 | 无（表已就绪） |
| `JdbcProviderDeploymentRepository` | 死代码：**无 @Repository/@Bean/@Component 注解**、零调用方；UPSERT_SQL + findByProviderId + findAdmitted + findAll + rowMapper（`rs.getArray("capabilities")` 解 text[]）已实现；record `ProviderDeploymentRecord`（providerId/protocol/capabilities/admissionState，构造校验） | 注解 + 装配 + 单测 |
| `ApprovedModelProviderProvisioner` | 静态 `provision(ModelProviderProperties, ProviderSecretReader)`：对 enabled 部署 `registry.register(new ProviderRegistration(...))`（InMemoryProviderRegistry）；**零 DB 接触**（无 DataSource/JdbcTemplate 注入） | config→DB 同步缺失 |
| `InMemoryProviderRegistry` | ConcurrentHashMap；register/disable/findAdmitted/deployments；重复 register 抛异常；modelruntime **不依赖 persistence**（端口类型无法引用 DB record） | 无 |
| runtime 装配 | `ApprovedModelProviderConfig`：`@ConditionalOnProperty(virtual-companion.model-providers.enabled=true)` 装配全链 beans，**无 DataSource/JdbcTemplate**；application.yaml **排除 DataSourceAutoConfiguration**；唯一 DataSource 由 `AuthDataSourceConfig` 门控（auth.datasource-enabled） | datasource 条件化接线 |
| 上下文约束 | `RuntimeContextTest`（无属性 @SpringBootTest）断言无 DB 起上下文；`ApprovedModelProviderConfigTest`（model-providers.enabled=true，auth 关→无 DataSource）验证 registry 精确 1 部署；`ApprovedModelProviderDisabledTest`（开关关→无 bean） | 接线后必须保持无 DB 可启动 |

**同步方向**：TASK-0035 handoff 明确设计意图是 **supplier→DB 单向同步**（config→in-memory 已有；config→DB 缺失）；不存在 DB→registry 反向回填代码。

## 5. 依赖

TASK-0035（ApprovedModelProviderProvisioner/ModelProviderProperties/ProviderSecretReader）、TASK-0081（ProviderRegistry/InMemoryProviderRegistry）、V4 迁移（provider_deployment 表）。

## 6. 验收标准（AC，每项可复测）

- AC1：`JdbcProviderDeploymentRepository` 成为可装配 bean，UPSERT/findByProviderId/findAdmitted 单测覆盖（含 capabilities text[] 数组往返、admission_state 映射）。
- AC2：datasource-enabled=true 时，`ApprovedModelProviderProvisioner` 供给流程把获批 enabled 部署 UPSERT 到 `provider_deployment`，随后注册内存 registry（TASK-0035 供给语义保持）。
- AC3：datasource-enabled=false（默认）时纯内存供给，**不触 DB、不静默回退**；`RuntimeContextTest`/`ApprovedModelProviderConfigTest`/`ApprovedModelProviderDisabledTest` 在无 DB 上下文继续通过。
- AC4：DB 不可用/UPSERT 失败 → 供给失败关闭（不注册半套、不假装成功）。
- AC5：验证全绿——RLS（含 V4 授权回归）+ Maven 全模块 + openapi validate/diff + harness unittest + precheck PASS；`git diff --check` 干净。

## 7. 受保护面 / skill / 审批 / 复核

- 主要面：persistence JDBC + runtime（**unprotected**，C2/C4 authorization）。
- 潜在面：若需改 V4 授权/加函数 → `**/db/migration/**`（**database-migration C4 + humanApproval**）；若改 `ApprovedModelProviderProvisioner`（在 `service/apps/runtime` 下，不在 modelruntime 保护 glob）——需核对 `service/**/modelruntime/**` 是否触及（本卡不改 modelruntime）。
- **复杂度评估**：单 GOVERANCE/AUTHORIZATION 面为主，intake 时以 complexityGate 判定；预计不 split（除非加 migration 面）。
- 无 frontend 面。

## 8. 必跑检查（requiredCommands 草案）

- `python scripts/harness/precheck.py --task TASK-0091`
- WSL docker Maven 全模块（同 TASK-0090 草案）
- WSL RLS（同草案）
- `python scripts/dev/openapi_tool.py validate` + `diff --fail-on-drift`（若 openapi 有改动）
- `python -m unittest discover -s scripts/harness/tests -p test_*.py`
- `git diff --check`

## 9. 风险与关键决策

- **运行期连接角色 vs V4 授权**：`provider_deployment` 的 INSERT/UPDATE 仅授权 `vc_job_coordinator`；runtime 供给进程连接角色若为 vc_api/vc_worker 则 UPSERT 会被拒——intake 时须核对 datasource 连接角色与授权，或调整授权（database-migration）。
- **条件化键选择**：复用 `virtual-companion.auth.datasource-enabled`（与 TASK-0034 共享 DataSource）vs 新增 model-providers 专属键——intake 定；默认关保持无 DB 上下文。
- **capabilities 排序注释**：V4 注释声称排序 text[]，但 repository 原样写入——registry 匹配实际发生在内存层，DB 排序无功能性负载；保持现状或如实注明。
- **单向同步语义**：本卡只做 supplier→DB；DB→registry 反向回填、以及 coordinator 写入的准入状态变更（disable/REJECTED）如何反映回运行期，属后续（若需要）。

## 10. 后续依赖

TASK-0090（真实外发接线）用已获批部署；本卡提供持久化真相。两者相互独立。

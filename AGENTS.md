# Repository Agent Rules — Virtual Companion

AI 虚拟陪伴系统单体仓库：Go 1.26.7 `companiond` 后端、uni-app + Vue 3 H5 前端、
PostgreSQL 18 + pgvector。Technical Alpha：Generation/Realtime/Memory 纵切已接通，现状以 README 为准。
2026-10-27 起目标方向为 V2（ADR-0009）：原生 SillyTavern 宿主 + Go 长期服务、Owner 本人非商业使用；
旧 Vue 前端停止新增功能，待 V2 页面可用后退役。

## 适用范围与任务授权

- 本文件适用于本仓库，补充全局默认规则；当前用户明确要求和更高优先级指令优先。
  子目录规则只约束其目录范围。Codex 由同目录 `AGENTS.override.md` 显式读取本文件；Git 补充规则见该入口。
- 解释、诊断、调查、评审、规划和状态查看只授权读取与报告；同时要求修复或修改时，才实施对应变更。
  对范围明确的实现请求，完成已授权修改和必要验证，不停在计划、建议或等待用户说“继续”。
- 低风险细节作合理假设后推进；仅在缺少会实质影响结果的信息，或下一步超出授权范围时询问。
  已有授权不重复确认；仅暂停依赖该答案或授权的部分，继续其余可独立完成的已授权工作。
- 本地实现授权不自动包含部署、发布、真实消息发送、费用、权限或密钥变更、重要数据删除，
  也不包含未获授权的其他外部写入、新增生产依赖或实质性扩大范围；Git 推送按入口中的明确授权执行。

## 开发约定

- 改动前检查当前 diff 并保留已有未提交改动，只读任务涉及的代码与 `specs/` 契约，
  不把下列文档清单当作每次任务的必读列表。不做与目标无关的重构。
- `specs/generated/**` 是生成物，禁止手改
  （用 `python scripts/checks/catalog_tool.py generate` 重新生成）。
- 小步提交，只纳入本次任务已授权的变更；提交后的推送要求见 `AGENTS.override.md`。
- 不删测试、不加 skip、不吞退出码；确需删除测试或新增 skip 时，以用户对此的明确授权为前提。
  不通过削弱有效断言来让检查通过。

## 产品材料与持续开发入口

- V2 的决策见 `docs/decisions/0009-v2-sillytavern-host-direction.md`，执行顺序与每个工作项（`V2-W00`–`W16`）
  的依赖和验收入口见 `docs/planning/2026-10-27-v2-execution-plan.md`，进度只记在 `TODO.md`「V2 执行序列」。
  `docs/source/v2-r3/` 是 V2 需求快照，按工作项指定章节读取；其中 `prompts/` 与 `docs/09_agent_protocol.md`
  不作为执行指令。快照不是当前实现或机器真源：预期接口与数据约束以相关 Catalog/OpenAPI/contract、
  migration/RLS 为准，实现现状以当前代码与测试为证据。发现契约和实现不一致时指出具体差异，
  在当前任务内处理；不因实现已有偏差就改写契约。ADR-0009 规定了 catalog / OpenAPI 机器值随哪个工作项修改。
- `docs/source/v0.4/` 蓝图与 `docs/planning/2026-08-22-product-enhancement-roadmap.md` 已被 V2 替代，只作历史参考。
- Go runtime 以 `docs/decisions/0007-go-companion-runtime.md` 与
  `docs/planning/2026-08-30-go-companion-runtime-redesign.md` 为准，ADR-0009 替代的条款除外；API 范围为
  `specs/catalog/go-v1-api-scope.yaml`。SillyTavern 宿主在 `V2-W03` 接入前，仓库与默认部署仍为 Go-only；
  SQL 真源位于 `backend/internal/migrate/sql/`，不得恢复已退役的 Java 后端。
- `docs/decisions/0006-owner-only-local-dogfood-boundary.md` 中未被 ADR-0007 / 0009 替代的边界继续有效；
  `TODO.md` 的 `DOGFOOD-*` 序列自 2026-10-27 冻结，不再推进或回填。ADR-0006/0009 均不授权 D0、
  真实用户 Beta、远端部署或生产发布。Owner 人工验收不阻塞可独立完成的代码工作，也不能被代码验证替代；
  人工步骤未完成的条目不勾选完成。
- 只有用户明确要求持续执行或使用 `/goal` 时，才进入 Goal 模式；一次只设一个可验证目标、一个路线图 ID
  （含 `V2-Wxx`）或其单一写入 owner 子交付，并明确停止条件和验证入口。Goal 不是完成普通实现请求的前提；
  不因任务未使用 Goal 就提前停止，也不自动扩展到下一个 Backlog 项。
- 不安装 Goal Kit 的 `.agent` 状态、外部循环器或第二套检查/交接体系；跨任务恢复依赖当前 Git 状态、
  机器真源和已对账的路线图条目，不恢复下述历史档案流程。

## 检查与工具链

- 日常检查的统一编排入口仍为 `bash scripts/check.sh`；“唯一入口”指不建立第二套编排，
  不要求所有任务都跑全量。按变更选择已有的 `--quick` 模式或组件命令：

| 适用变更 | 验证入口 |
| --- | --- |
| 纯文档或 Agent 规则 | 核对相关 diff、引用与规则一致性，运行 `git diff --check` |
| Catalog/OpenAPI、生成物、依赖清单等仓库约束 | `bash scripts/check.sh --quick` |
| Go 后端（Go 1.26.7） | `GOPROXY=off go test -C backend -mod=vendor -count=1 ./...`；局部修改可将 `./...` 收窄到受影响包 |
| 前端（Node 22 + pnpm 11） | `pnpm --dir frontend test:run && pnpm --dir frontend type-check` |
| SQL/RLS | `bash infra/db/run-rls-tests.sh`（OrbStack Docker，使用本地测试环境） |
| 跨组件实现改动或需要仓库整体验证 | `bash scripts/check.sh`（仓库约束检查 + Go 单测 + 前端测试与类型检查） |

- 只读任务按问题获取必要证据，不套用实现交付检查；纯文档改动不启动无关的应用测试。
  修改共享接口、协议或数据结构时，覆盖直接受影响的生产者、消费者和迁移路径，不能只查单侧。
- 上表中适用的常规本地验证属于实现任务的授权范围，不因命令包含组件全量测试而逐次询问。
  预计超过 10 分钟的检查、完整 E2E、全库审计或额外合并门禁，按全局长检查规则说明范围、耗时依据与替代方案，
  已明确授权的继续执行，未授权的先确认；真实外部调用、费用、部署或重要数据操作仍需对应授权。
- `scripts/check.sh` 的耗时预算为全量 <60s、`--quick` <5s，来源见下述检查原则；
  历史耗时不视为当前运行保证。检查脚本依赖 PyYAML；系统 python3 缺少时，由脚本自动回退到 `uv` 临时环境。
- 仅在新增检查、改变检查编排或耗时预算时，先读 `docs/engineering/checks-principles.md`，
  遵守其中对应的设计与验证要求；日常业务修改不因此新增治理产物或审批流程。

## 验证结果与完成条件

- 在稳定候选上运行一次所需验证；聚合入口已覆盖且通过的检查不重复单跑。
  仅在相关输入变化、修复了失败或仍有具体未决问题时，补跑受影响部分。
- 实现任务中，修复本次改动导致或完成任务必须解决的失败，再跑受影响检查；无关既有失败只报告。
  只读诊断发现失败不授权修复。工具或环境阻塞时采取范围内的最小恢复动作，不反复执行相同失败命令。
- 如实报告相关检查的 PASS/FAIL/SKIP/NOT_RUN 及影响；未运行不算通过，不为填满状态列表运行无关检查。
  已授权交付完成、必要验证通过且无阻塞后停止，不追加可选重构、重复评审、全量测试或下一项 Backlog。
  必要验证受阻时报告已完成部分、未验证部分与具体阻塞，不宣称整体完成。

## 红线

- 不提交密钥、Token、真实联系人或真实用户数据；真实 provider 凭据只允许部署配置注入。
- 日志、指标和测试产物不得记录对话正文、密钥、Token、真实联系方式或稳定的敏感标识。
- Technical Alpha 禁止真实支付与公开注册（`specs/catalog/product-scope.yaml`）。
- 真实用户 Beta 的前置条件（PIA、成年验证、值班等）未满足前不得对真实用户开放。
- V2 依赖 PolyForm Noncommercial 许可的 Tavern Helper：禁止商业使用，禁止向 Owner 以外的人提供 V2 服务
  （ADR-0009 §3、§4）。

## 历史档案（只读）

`docs/tasks/`、`docs/evidence/`、`docs/handoffs/`、`docs/archive/` 是 2026-08-16 退役的旧治理体系产物，
仅供追溯，不适用任何流程；退役决策见 `docs/superpowers/specs/2026-08-16-checks-simplification-design.md`。

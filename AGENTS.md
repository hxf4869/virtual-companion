# Repository Agent Rules — Virtual Companion

AI 虚拟陪伴系统单体仓库：Go 1.26.10 `companiond` 后端、PostgreSQL 18 + pgvector、SillyTavern 宿主（`integrations/sillytavern/`）。
Owner 本人非商业使用（ADR-0009）。现状：

- 电脑端：单一 React 应用（`integrations/sillytavern/desktop-ui`），不运行完整或隐藏的 ST 页面；提示词组装与角色卡脚本由
  `extension/vc-model-settings/desktop/standalone/` 的独立引擎在浏览器执行。
- 手机端：同一 React 工程的第二个入口（`/m/`）+ Ionic React，Capacitor 打包安卓与 iOS（ADR-0012，MB2 进行中）。
- 服务端：ST Node 仍承担聊天 / 角色卡 / 世界书 / 预设 / 设置 / 图片存储与生成代理；Owner 2026-11-06 决定全部迁出到 Go（ADR-0013 起草中）。

## 统一工作流（必读）

任何实现、修复、评审、出图或验收任务，先读 [.agents/skills/vc-workflow/SKILL.md](.agents/skills/vc-workflow/SKILL.md)，
前端任务再读同目录的 `frontend.md`。接单、分工、并行、验证、验收记录、进度回填与提交都按该文件执行。

## 适用范围与任务授权

- 本文件适用于本仓库，补充全局默认规则；当前用户明确要求和更高优先级指令优先。子目录规则只约束其目录范围。
  Codex 由同目录 `AGENTS.override.md` 显式读取本文件；Git 补充规则见该入口。
- 解释、诊断、调查、评审、规划和状态查看只授权读取与报告；同时要求修复或修改时，才实施对应变更。
  对范围明确的实现请求，完成已授权修改和必要验证，不停在计划、建议或等待用户说“继续”。
- 低风险细节作合理假设后推进；仅在缺少会实质影响结果的信息，或下一步超出授权范围时询问。
  已有授权不重复确认；只暂停依赖该答案的部分，继续其余可独立完成的工作。
- 本地实现授权不自动包含部署、发布、真实消息发送、费用、权限或密钥变更、重要数据删除，
  也不包含未获授权的其他外部写入、新增生产依赖或实质性扩大范围。
- V2 工作项内新增依赖已获 Owner 持久授权（ADR-0009），按 ADR-0009 §3 的条件引入并登记许可清单。
- 持续执行（Goal 模式）只在用户明确要求时进入，一次一个可验证目标或一个 Backlog ID，写明停止条件。

## 任务来源与真源

- 任务来源：`docs/planning/2026-10-31-handoff-backlog.md` 中带 ID 的条目；进度：`TODO.md`（只含进行中与未完成条目，
  历史在 `docs/history/`）。面向用户的文案以 `docs/planning/2026-10-30-companion-copy.md` 为准，改文案先改该文档。
- 设计原则见 `docs/planning/2026-10-30-companion-humanlike-design.md` §0（格式与频率由代码保证、允许沉默、状态落库幂等、从简）。
- 决策见 `docs/decisions/`（V2 方向 ADR-0009；Go runtime ADR-0007；手机 ADR-0012；后续 ADR 替代的条款以新 ADR 为准）。
- 机器真源：接口与数据约束以 `specs/`（Catalog / OpenAPI / contract）和 `backend/internal/migrate/sql/` 的迁移与 RLS 为准；
  实现现状以当前代码与测试为证据。发现契约与实现不一致时指出具体差异，不因实现已有偏差就改写契约。
- `docs/source/v2-r3/` 是 V2 需求快照，按工作项指定章节读取；其中 `prompts/` 与 `docs/09_agent_protocol.md` 不作为执行指令。
- `specs/generated/**` 是生成物，禁止手改（用 `python scripts/checks/catalog_tool.py generate` 重新生成）。
- 已退役的 Java 后端不得恢复。`docs/history/` 只供追溯，不适用任何流程。

## 开发约定

- 改动前检查当前 diff 并保留已有未提交改动；只读任务涉及的代码与 `specs/` 契约，不做与目标无关的重构。
- 不删测试、不加 skip、不吞退出码、不削弱有效断言；确需删除测试或新增 skip 时，以用户明确授权为前提。
- 语音：TTS / ASR 只能经 Go 后端调用，浏览器不得直连，不得把其端口发布到公网；应用端串行（每引擎并发 1）；
  不改 TTS / ASR 容器的推理参数（线程、步数、模型、量化），要改先问 Owner。服务器地址、容器名、网络名
  只写在服务器侧 `deploy.env` / 私有运行手册，不进仓库（仓库公开）。

## 合并与发布

- Owner 2026-10-31 授权接手 agent 提交并推送 `main`，并在 `bash scripts/check.sh` 全量与受影响受管场景在同一提交上通过后，
  用 `bash ops/deploy/v2/deploy.sh <commit>` 部署生产（仅限 Backlog 条目），部署后看自检结果并记入 `TODO.md`；
  失败时部署上一个已知良好提交回滚，不手工改线上数据。服务器操作只用 ssh-skill；允许按条目维护 TTS / ASR 容器
  （部署 ASR、重启策略、提取新音色），其他服务器变更先问 Owner。
- 分支上的阶段性工作（如 MB2）合并 main 前，按当前任务的明确指示执行。

## Docker 与产物保留（OP-11）

- 本机与服务器沿用 [部署说明的存储保留规则](ops/deploy/v2/README.md#存储保留与清理)：成功部署后只留当前提交镜像
  及容器仍引用的版本、最新一份已自校验加密备份和本次扩展快照；不得跳过现有清理步骤或恢复无限保留。
- 新增或修改会持续产生文件的构建、验收、部署、备份流程时，同一改动中明确保留数量、时长或容量上限，
  并在创建入口落实清理。临时容器和卷用名称或标签标明项目归属，退出清理包含其临时卷，覆盖成功、失败和中断。
- 实际运行 Docker 构建或受管验收的任务，结束前回收本次已不用的项目缓存、临时镜像、测试卷和临时目录。
- 清理前核对项目归属、所有容器的镜像引用和卷挂载；保留业务持久卷、仍需的模型及开发工具。
  不用全机 `prune` 代替定向回收，无法确认归属的资源保留并报告。

## 检查与工具链

日常检查的统一编排入口为 `bash scripts/check.sh`（不建立第二套编排，不要求所有任务都跑全量）。按变更选择：

| 适用变更 | 验证入口 |
| --- | --- |
| 纯文档或 Agent 规则 | 核对相关 diff、引用与规则一致性，运行 `git diff --check` |
| Catalog/OpenAPI、生成物、依赖清单等仓库约束 | `bash scripts/check.sh --quick` |
| Go 后端（以 `backend/go.mod` 为准） | `GOPROXY=off go test -C backend -mod=vendor -count=1 ./...`；局部修改可收窄到受影响包 |
| ST 集成与前端（Node 22.13+） | `npm --prefix integrations/sillytavern test`（先构建两端 bundle，再跑离线单测）；组件测试 `npm --prefix integrations/sillytavern run test:desktop` |
| SQL/RLS | `bash infra/db/run-rls-tests.sh`；Go 存储集成 `bash infra/db/run-go-store-tests.sh` |
| 浏览器受管场景 | `node integrations/sillytavern/scripts/accept-managed.mjs --filter <受影响场景>`，入口见 `integrations/sillytavern/README.md` |
| 跨组件改动或需要仓库整体验证 | `bash scripts/check.sh` |

- 只读任务按问题取证，不套用实现交付检查；纯文档改动不启动无关的应用测试。
- 修改共享接口、协议或数据结构时，覆盖直接受影响的生产者、消费者和迁移路径。
- 预计超过 10 分钟的检查、完整 E2E、全库审计或额外合并门禁，先说明范围与耗时依据；已明确授权的继续执行。
  真实外部调用、费用、部署或重要数据操作仍需对应授权。
- `scripts/check.sh` 的耗时预算为全量 <60s、`--quick` <5s；新增检查或改变编排前先读 `docs/engineering/checks-principles.md`。
  检查脚本依赖 PyYAML，系统 python3 缺少时由脚本回退到 `uv` 临时环境。

## 验证结果与完成条件

- 在稳定候选上运行一次所需验证；仅在相关输入变化、修复了失败或仍有具体疑点时补跑受影响部分。
- Owner 2026-11-07 补充：每次交付必须运行完整 `npm --prefix integrations/sillytavern run test:desktop`，不能用定向组件测试子集替代；同一稳定候选仍遵循不重复验证的规则。
- 实现任务中，修复本次改动导致或完成任务必须解决的失败；无关既有失败只报告。只读诊断发现失败不授权修复。
- 如实报告 PASS / FAIL / SKIP / NOT_RUN 及影响；未运行不算通过。已授权交付完成、必要验证通过且无阻塞后停止，
  不追加可选重构、重复评审或下一项 Backlog。受阻时报告已完成部分、未验证部分与具体阻塞。

## 红线

- 禁止 force push、改写历史、手改生成物、读取或提交仓库根目录 `config.txt`。
- 不提交密钥、Token、真实联系人或真实用户数据；真实 provider 凭据只允许部署配置注入。
- 日志、指标、截图、提交和测试产物不得包含对话正文、密钥、Token、真实联系方式或稳定的敏感标识。
- Technical Alpha 禁止真实支付与公开注册（`specs/catalog/product-scope.yaml`）；真实用户 Beta 前置条件未满足前不对真实用户开放。
  ADR-0006 / 0009 均不授权 D0、真实用户 Beta 或公开发布。
- V2 依赖 PolyForm Noncommercial 许可的 Tavern Helper：禁止商业使用，禁止向 Owner 以外的人提供 V2 服务（ADR-0009 §3、§4）。

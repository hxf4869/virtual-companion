# V2 执行计划（SillyTavern 宿主 + Go）

- 日期：2026-10-27
- 决策：`docs/decisions/0009-v2-sillytavern-host-direction.md`
- 需求快照：`docs/source/v2-r3/`（只读；下称“快照”）
- 进度入口：`TODO.md`「V2 执行序列」——唯一进度记录，本文件不记录进度

本文件是 V2 的唯一计划文件：规定执行顺序、相对快照的调整、每个工作项的依赖与验收入口。
W00 结论与 W01 模块处置表完成后回填到本文件对应章节。

## 1. 阅读顺序与优先级

1. 规则优先级：当次用户指令 > `AGENTS.md` > ADR-0009 > 本计划 > 快照。
2. 快照中 `START_HERE.md`、`prompts/`、`docs/09_agent_protocol.md` 的执行方式不适用；按本计划第 2 节执行。
3. 每个工作项只读本计划列出的快照章节、相关代码与契约，不通读整个快照。快照中的
   `MANIFEST.sha256.json`、`BUNDLE_VALIDATION.md`、`templates/` 只是材料自身记录，不需要维护。

## 2. 执行方式

整个 V2 序列可以连续执行（`AGENTS.md` 允许用一个 Goal 覆盖），按本节的顺序、完成标准与暂停条件逐项推进。

### 2.1 顺序与依赖

按编号顺序推进；一个工作项完成并回填 `TODO.md` 后再开始下一项，同一时间只推进一个工作项。
依赖满足指依赖项状态为 `DONE` 或 `READY_FOR_OWNER`。

| 项 | 依赖 | 项 | 依赖 |
|---|---|---|---|
| W00 | — | W09 | W03、W07 |
| W01 | W00（结论为可行） | W10 | W05、W09 |
| W02 | W00 | W11 | W09 |
| W03 | W00（结论为可行）、W01 | W12 | W03、W05 |
| W04 | W03 | W13 | W00、W12 |
| W05 | W00、W03 | W14 | W13 |
| W06 | W01、W05 | W15 | W04、W08、W10、W14 |
| W07 | W06 | W16 | W15 |
| W08 | W07 | | |

只缺 Owner 输入（Stitch 稿、真实凭据、预算、目标手机、部署授权）的工作项照常推进：用合成数据完成可做部分，
缺输入的子项记为 `BLOCKED`。

### 2.2 每个工作项的做法

- **fit-check**：开始前对照当前 `HEAD`、`TODO.md` 与契约；已满足的部分只验证并记录，不为完成编号重写。
- **契约先行**：涉及接口、数据或范围约束的工作项，在同一项内同步修改 `specs/catalog`、
  `specs/openapi`、`backend/internal/migrate/sql/`（含 RLS 测试），并用
  `python scripts/checks/catalog_tool.py generate` 重新生成 `specs/generated/**`。ADR-0009 §5 规定了
  catalog / OpenAPI 机器值的生效工作项，提前修改会让契约与实现脱节。
- **验证**：按 `AGENTS.md` 检查表对受影响组件做一次相称验证。首次引入 ST 扩展 / server plugin 等 Node 代码的
  工作项须先读 `docs/engineering/checks-principles.md`，再把其测试接入 `scripts/check.sh`，并更新
  `AGENTS.md` 检查表。
- **依赖**：新增依赖直接引入（ADR-0009 §3），许可须允许非商业自用，版本固定并登记许可。
- **真实外部动作**：真实模型调用、邮件 / 飞书发送、远端部署按当次会话授权；运行配置未填写时
  使用合成固定 provider 与本地模拟，继续独立开发。
- **提交**：小步提交，中文提交信息；工作项结束时 `git status` 干净。

### 2.3 回填 TODO

用快照 `docs/08_verification_operations.md` §2 的用例 ID 记录状态；跨阶段用例只记录已具备的子项，
不提前标整案 PASS。不创建单独的证据文件。

```text
- [x] `V2-W00` ……（原文不改）
      结果：DONE（2026-10-28）；提交 <起>..<止>；验证 <命令> PASS
      用例：C01 PASS；C02 NOT_RUN（原因）；……
```

状态：全部完成为 `DONE` 并勾选；代码完成但还差 Owner 人工验收为 `READY_FOR_OWNER`，不勾选；
只完成部分且被 Owner 输入阻塞为 `BLOCKED`，不勾选并写明缺什么。

### 2.4 暂停条件

出现以下情况时停止推进，在 `TODO.md` 当前条目写明已完成部分、阻塞原因和需要的决定，并向 Owner 报告：

- W00 结论为不可行，或实现事实表明 ADR-0009 §1–§2 的范围或架构需要改变；
- 同一工作项的同一失败经 3 次修复仍未解决；
- 剩余可做的工作都需要真实模型调用、真实邮件 / 飞书发送或远端部署，而当前会话没有授权；
- 剩余工作项都被 Owner 项阻塞。

### 2.5 整体完成

W00–W16 均为 `DONE`，或只因 Owner 项保持 `READY_FOR_OWNER` / `BLOCKED`；在最终状态上运行一次
`bash scripts/check.sh` 并记录结果后停止，等待 Owner 安排最终审计。不自行追加重构或新一轮计划。

## 3. 相对快照的调整

| # | 调整 | 原因 |
|---|---|---|
| 1 | 新增 W00（ST 宿主可行性验证），W03 / W05 依赖其结论 | F2 全保存保护、最终请求校验与账号绑定都可能要改 ST 核心；补丁面决定方案是否成立 |
| 2 | 每项同步 catalog / OpenAPI / migration / RLS / 生成物 | 快照未提及仓库的契约体系与 `check.sh` |
| 3 | 前台安全策略按 ADR-0009 §4 | 快照未处理 ST 前台绕过 Go 本地安全策略的问题 |
| 4 | W00 把上游锁到 tag / commit，下载后记录产物 SHA256 | 快照 `upstreams.lock.json` 中 MVU 用 `beta`、Helper / Pi 用 `main`、MemoryCore 用 `feat/server_team` 分支 |
| 5 | 模型目录唯一权威在 Go；Go 已有三协议 adapter（`backend/internal/provider/factory.go`），ST 前台补齐自身三协议，不新增第三条模型链 | 避免两套配置与第三条调用链 |
| 6 | 邮件发送需新引入实现（仓库没有 SMTP 代码），W10 直接选型引入 | 快照假设“复用现有发信能力”，本仓库不成立 |
| 7 | Stitch 稿由 Owner 提供或在具备 Stitch 访问的会话生成；缺失时页面实现项 `BLOCKED`，后端与兼容验证继续 | 当前 Agent 环境不保证有 Stitch |
| 8 | 引入 ST 栈的工作项扩展许可清单（`scripts/checks/license-inventory.yaml` 等） | 现有许可门禁只扫描 `backend/go.mod` 与 `frontend/package.json` |
| 9 | 旧数据不保留：W01 清理 V2 前的旧业务数据与本地备份。B03 改为验证旧数据已清理且未进入 V2；D02–D04 不再包含旧 Go 数据域 | Owner 2026-10-27 决定，替代快照 E3 中“保管、导出与删除责任”的要求 |
| 10 | W01 在 W00 结论为可行后执行（快照允许并行） | W01 含不可逆清理，应在确认方向可行后进行 |

## 4. 目录约定（W00 可按实际情况调整并回填）

- 自有集成代码：`integrations/sillytavern/extension/`、`integrations/sillytavern/server-plugin/`、
  `integrations/sillytavern/patches/`（每个补丁附理由、上游版本、可去除条件）。
- 上游版本锁：`integrations/sillytavern/upstream.lock.json`（tag / commit、产物 SHA256、许可）。
- 上游源码与构建产物不提交，拉取到 gitignored 目录。
- ST 补丁与插件按 AGPL-3.0 标注；Go 代码保持 Apache-2.0。

## 5. 工作项

快照章节缩写：MP = `MASTER_PLAN.md`，ARCH = `docs/03_architecture.md`，WP = `docs/07_work_plan.md`，
VER = `docs/08_verification_operations.md`，TAV = `docs/04_tavern_compatibility.md`，
MEM = `docs/05_memory_companion.md`，STORY = `docs/06_story_runtime.md`。

### W00 ST 宿主可行性验证（新增，最先执行）

- 读：ARCH §4、§6、§7、§14；TAV；`references/upstreams.lock.json`。
- 做：在 gitignored 目录拉取候选 ST（快照记录为 1.19.0）+ Helper + EJS + MVU，确认版本存在并锁定
  tag / commit；本地启动，用快照 `fixtures/` 的合成卡做最小冒烟。
- 盘点三类入口，逐条判断“公开扩展点可覆盖 / 需改 ST 核心”：
  1. 聊天写入：单聊与群聊保存、metadata 保存、编辑、swipe、删除消息与聊天、改名、分支 / 回档、
     导入覆盖、备份恢复，以及前端与第三方脚本（Helper / MVU）调用的保存 API；评估 ST 现有
     chat integrity / `force` 机制能否扩展为 base revision 检查。
  2. 最终请求：世界书、宏、EJS、扩展注入之后能否在发送前按角色校验（如
     `CHAT_COMPLETION_PROMPT_READY` 的实际顺序与参数语义），三协议是否走同一出口。
  3. 认证：ST 多用户、可信头 / SSO 能力，Go 会话与 ST 会话的绑定点。
- 产出：回填本计划第 6 节（入口清单、补丁清单与规模、版本锁、结论），提交
  `integrations/sillytavern/upstream.lock.json` 与 `.gitignore` 调整；不写业务代码。
- 停止条件：F2 或最终请求校验若只能靠散布式改写 ST 核心流程实现（无法形成集中、可重放的补丁集），
  停止并报告 Owner 重新决策，不进入 W03 / W05。
- 完成后先停下，向 Owner 报告结论，确认后再继续。
- 验证：`git diff --check`；记录实际运行的启动与冒烟命令及结果。

### W01 现有工程盘点与旧数据清理（P0，W00 结论为可行后执行）

- 读：WP W01；快照 `docs/01_existing_audit.md` §8、§10；ARCH §13。
- 盘点：逐模块给出“保留 / 改造 / 替换 / 删除”及理由（认证、关系、记忆、任务、字段加密、导出 / 删除、
  provider、realtime、Vue 前端）；列出 V2 前旧业务数据的位置：PostgreSQL 中的会话、消息、记忆、任务、
  同意与导出记录，对象存储中的导出对象，本地加密备份与删除 tombstone manifest。
- 清理：删除上述旧业务数据与本地备份，不导出（ADR-0009 E3）。Owner 账号与身份验证器可清除后重建，
  是否保留按 W05 需要决定。只清理本仓库服务在本机产生的数据，不碰其他项目或 OrbStack 中的无关容器与卷。
- 产出：回填本计划第 7 节（处置表、实际执行的清理命令与删除范围）。
- 验证：只读查询确认清理目标已空；`git diff --check`。

### W02 设计规范与 Stitch 稿（P0）

- 文档对齐部分已在 2026-10-27 完成（ADR-0009、`PRODUCT.md`、`AGENTS.md`、`TODO.md`）。
- 做：以快照 `DESIGN.md` 为起点建立工作副本 `docs/product/v2-design.md`，按 W00 实测的 ST 主题 /
  扩展能力修订；生成或接收 Stitch 桌面 / 手机稿并记录页面对应关系。
- 依赖：Stitch 访问（Owner 项 `V2-OWNER-STITCH`）；缺失时只完成规范，稿件标 `NOT_GENERATED`。
- 验收：UI01 的设计来源子项。

### W03 原生宿主、存储保护与模型配置基础（P1）

- 读：WP W03；ARCH §8、§15、§17；`fixtures/model_profiles.json`。
- 依赖：W00 结论为可行；W01。
- 做：固定版本 ST 栈的开发启动方式；C1 开发环境保护基线；Go 模型目录 Provider → Model → 用途绑定，
  ST 前台作为受版本同步的投影；ST 侧三协议（含 Responses 真实语义适配，不只换路径）。
- 契约：`product-scope.yaml` `technology.currentRuntime` / `targetRuntime` 与 `catalog_tool.py` 校验；
  模型目录与用途绑定的 OpenAPI；许可清单纳入 ST 栈；Node 测试接入 `check.sh`。
- 验收：C01、C02、C03、C06、C07；D01 基线；MODEL06–MODEL08 协议基础；UI03（有设计稿后）。

### W04 复杂状态卡与首轮手机体验（P1）

- 读：WP W04；`fixtures/complex_card_recipe.md`；TAV。
- 依赖：W03；页面部分依赖 W02 设计稿。
- 验收：C04、C05；UI01 / UI02 中聊天、导航与手机基础操作子项（真机为 Owner 项）。

### W05 认证、角色实例与 F2 全写入保护（P2）

- 读：WP W05；ARCH §6、§11、§14。
- 依赖：W00、W03。
- 做：Go 密码＋TOTP 作为唯一可见登录入口并绑定 ST 会话；CharacterInstance / ConversationBinding；
  W00 盘点出的全部写入口统一 base revision 原子检查，`force` 不绕过；冲突保留草稿。
- 契约：`activeCompanionLimit`、V9 唯一活跃关系约束（新 migration）、OpenAPI 关系接口描述，与代码
  在本项内一起修改；RLS 测试覆盖新表。
- 验收：B01、B05、B07（B04 留到 W10）。

### W06 来源对账、E3 与跨存储数据权利（P2）

- 读：WP W06；ARCH §12、§13、§16；`fixtures/lifecycle_cases.json`。
- 依赖：W05、W01。
- 验收：B02、B03、R01–R05、D02–D05。

### W07 相关检索、摘要与时间规范（P3）

- 读：WP W07；MEM；`fixtures/memory_cases.json`。
- 做：以查询驱动的召回替换 `backend/internal/store/postgres/generation.go` 的固定窗口与同分路径；
  接通摘要来源与失效；拆分来源时间、记录时间、事件日期与提醒时刻。
- 契约：`memory-*.yaml` catalog 与相关 OpenAPI。
- 验收：M01–M12 中检索与日期子项。

### W08 记忆实现对照与管理闭环（P3）

- 读：WP W08；MEM；快照 `docs/02_reuse_and_licenses.md`。
- 做：现有 Go 记忆与 MemoryCore 按 scope、来源、纠正、删除、导出对照，选定后直接接入，只保留一个
  提取责任方；记忆查看 / 纠正 / 遗忘页面（依赖设计稿）。
- 验收：M01–M12 全部；MODEL05。

### W09 跟进、时间与 G2 后台配置（P4）

- 读：WP W09；ARCH §17；MEM 主动跟进部分。
- 验收：A01、A02；MODEL01–MODEL04 中后台用途子项。

### W10 Inbox 与邮箱＋飞书通知（P4）

- 读：WP W10；ARCH §5、§11。
- 依赖：W05（F2）、W09。
- 做：inbox 领取 / 保存 / ACK；SMTP 与飞书群 Webhook 两个渠道，独立投递记录、重试、quiet hours、
  结果未知状态；通知文本经本地安全策略；邮件库按需选型直接引入。
- 契约：开启 `PUSH_NOTIFICATION` 同意（OpenAPI 同意枚举、`V41__consent_records.sql` 起的同意记录），
  按需更新 `processing-purposes.yaml` / `data-categories.yaml`。
- 验收：C08、B04、N01–N03；A04 需 Owner 配置真实目标并在手机上验证。

### W11 有限工具与统一调用计量（P4）

- 读：WP W11；ARCH §17.5。
- 验收：A03、MODEL01–MODEL05；受影响的 MODEL06–MODEL08。

### W12 世界、角色视图与样例（P5）

- 读：WP W12；STORY；`fixtures/rainy_inn_case.json`、`fixtures/public_lore.json`。
- 验收：S01 中世界与视图子项。

### W13 三协议最终请求控制（P5）

- 读：WP W13；STORY；ARCH §7。
- 依赖：W00 最终请求结论、W12。
- 验收：S01、MODEL07 剧情子项。

### W14 行动、分支、结局与陪伴角色入局（P5）

- 读：WP W14；STORY；ARCH §17.6（剧情世界提交与聊天投影的恢复）。
- 验收：S02–S05。

### W15 完整界面、手机与性能（P6）

- 读：WP W15；VER §3、§4。
- 做：收敛 UI01–UI03；对应 ST 页面可用后删除旧 Vue / uni-app 前端及其检查入口。
- 验收：UI01–UI03；性能只针对实测瓶颈。

### W16 保护、恢复与运行说明（P6）

- 读：WP W16；VER §5–§8。
- 验收：D06、O01；最终报告列出用例状态、三协议 / 两渠道结果、真实费用、E3 旧数据位置与责任。

## 6. W00 结论（待回填）

尚未执行。

## 7. W01 模块处置表与清理记录（待回填）

尚未执行。

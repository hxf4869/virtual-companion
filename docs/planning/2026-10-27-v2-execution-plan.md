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

## 6. W00 结论（2026-10-28 回填）

**总体结论：可行性未闭合，W00 BLOCKED。** 已拉取并锁定四个上游，完成三类入口的初步源码分析，
取得 ST 启动、Helper/EJS 加载、合成卡导入、角色选择与脚本启用持久化的运行证据。
但 `window.Mvu` 在三次针对性修复后仍未出现，已触发 §2.4「同一工作项的同一失败经 3 次修复仍未解决」。
已停止重试；没有完成 ST + Helper + EJS + MVU 的最小组合冒烟，也没有实施或验证拟议补丁。
源码分析提供了集中补丁的候选接入点，不能据此把 W00 标为可行或完成。
**W01–W16 均未启动；须由 Owner 决定是否恢复 W00 排查，补齐证据并确认结论后再按依赖推进。**

### 6.1 上游版本锁

版本、commit、许可、产物 SHA256、自托管与运行状态见 `integrations/sillytavern/upstream.lock.json`
（仓库唯一提交物之一；上游源码与运行产物在 gitignored 的 `integrations/sillytavern/upstream/` 与
`integrations/sillytavern/.local/`）。要点：ST `1.19.0` 轻量 tag = `7e8663cd`（AGPL-3.0）；
Helper `0af42106`（4.11.3，PolyForm Noncommercial 1.0.0）；EJS `d6f520d1`（1.17.9，AGPL-3.0）；
MVU `d03b7dc8`（MIT，无发布版本号，按 commit + bundle SHA256 锁定，已自托管替代 CDN `@master`）。
Helper/EJS 的 dist 与 MVU 的 artifact/bundle.js 均随上游提交，无需本地构建；MemoryCore / pi 不在 W00 栈内。

### 6.2 入口盘点与"公开扩展点 / 需改 ST 核心"判断

**聊天写入（F2）** —— 初步判断：普通保存有共同函数，但导入、删除、改名及启动迁移有独立写入路径；纯公开扩展点不足。

| 入口类 | 事实（ST 1.19.0 源码定位） | 判断 |
|---|---|---|
| 单聊/群聊内容保存（新消息、编辑、swipe、删消息、metadata、分支/checkpoint、Helper/MVU 全部保存 API） | 普通 `/save`、`/group/save` 收敛到 `src/endpoints/chats.js:532` `trySaveChat`（`/save`、`/group/save` 透传 `force`=第三参 `skipIntegrityCheck`，truthy 即完全跳过 integrity 比较）；写入原子（write-file-atomic 5.0.1）；revision 可存 `chatData[0].chat_metadata` 自有命名空间随 JSONL 一次落盘、重启从首行恢复 | 需改核心，但单点（P1/P2） |
| 前端保存 | 收敛到 `public/script.js:7395` `saveChat` 与 `public/scripts/group-chats.js:623` `saveGroupChat` 2 个函数；另有 4 处绕行 fetch（`renamePastChats`、`renameGroupMember`、`saveGroupBookmarkChat`、`convertSoloToGroupChat`）不带 force 也不处理 integrity 错误；`getContext().saveChat` 实为 `saveChatConditional`，错误被吞 | 需改核心（P8–P11） |
| 删除/改名/导入 | 10 处独立 fs 入口不经 `trySaveChat`：`/rename`(chats.js:621，copy+unlink 非原子)、`/delete`(654)、`/group/delete`(900)、`/import`(771)、`/group/import`(751)、BYAF 导入(characters.js:803)、`/groups/delete`(groups.js:203)、`/characters/rename`(1053，整目录 cp+rm)、`/characters/delete`(1416)、data-maid(770)；删除后旧请求可重建同名文件（chats.js:339 视不存在为 intact） | 需改核心（P3–P7）；chat identity=文件名，无持久 id |
| 保存完成事件 | 服务端无 chat_saved 事件；前端 `MESSAGE_RECEIVED`≠持久化；server plugin 拿不到 app、挂在全部核心路由之后，**不能拦截原生路由**（`src/plugin-loader.js:213`） | 需改核心（P12 进程内事件） |
| Helper/MVU 写入 | 全部经 `saveChatConditional`/`saveMetadataDebounced` → 收敛入 P1 覆盖范围，无绕过；唯一例外 Helper `/api/chats/import`（`TH/src/function/import_raw.ts:72`） | 需随导入与普通保存适配，运行兼容性未验证 |


补充盘点（外层核对）：备份恢复由 `public/scripts/chat-backups.js:73` 的 `restoreBackup`
下载 JSONL 后调用 `importCharacterChat` / `importGroupChat`，必须纳入导入的身份/revision 规则，
不能把备份里的旧 revision 当作新写入凭据。`src/endpoints/backups.js` 本身只列出、下载与删除备份。
另有启动路径 `src/server-main.js:302` → `groups.js:34` `migrateGroupChatsMetadataFormat`，
在 `groups.js:87` 直接重写旧格式群聊；它不经过 `trySaveChat`。当前 V2 无旧聊天迁移，但恢复旧格式
ST 副本时该路径可能可达，恢复顺序与身份/revision 初始化仍待验证，不能宣称所有内容写入均已收敛。

**最终请求（三协议）** —— 候选方案：前端公开事件配合服务端最终出站校验；未取得最终请求运行证据。

| 挂钩/出口 | 事实 | 判断 |
|---|---|---|
| `CHAT_COMPLETION_SETTINGS_READY` | `public/scripts/openai.js:3146`，事件之后直接序列化 body 并 fetch，无额外提示词构造；载荷即最终 body 引用，属性级修改（含整体替换 messages、tools）生效；dryRun 不触发；工具后续轮次 `return Generate('normal',...)` 完整重入（tool-calling.js:255，RECURSE_LIMIT=5）→ 每轮必触发 | **公开扩展点可用**：校验扩展 loading_order > EJS(1) 后注册后执行，看到的是 EJS 改写后结果 |
| `CHAT_COMPLETION_PROMPT_READY` | openai.js:1619，之后仍有消息过滤/role 改写/服务端转换；不读回整体替换 | 不作唯一校验点（可作早期检查） |
| EJS/Helper 顺序风险 | EJS 核心改写就在 SETTINGS_READY 事件内（其 manifest loading_order=1 先执行）；Helper iframe 脚本可晚注册排在校验之后、Helper per-request optionsInjector `once()` 排最后可覆写 tools（不动 messages）；`custom-request.js` ChatCompletionService 直接 fetch 绕过两事件 | 残余通道 → 服务端最小兜底补丁（在 `/api/backends/chat-completions/generate` 路由，chat-completions.js:2242） |
| 三协议出口 | Anthropic Messages（`sendClaudeRequest`，Claude 转换 prompt-converters.js:197）与 OpenAI Chat Completions / Custom（`endpointUrl=${apiUrl}/chat/completions`，2626）同一前端出口 + 同一服务端路由；流式 Claude/通用均原始 SSE 透传；**OpenAI Responses API 在 1.19.0 完全不存在**（全量 grep 无 `/v1/responses`、`previous_response_id` 等） | Responses 需新增：服务端 `sendResponsesRequest` + 请求体映射 + 流事件重组（或转 OpenAI chunk SSE 不动前端解析）+ 工具调用/usage/取消/错误映射，估 300–500 行 + 流 100–200 行；前端只加 source 配置 |
| text completion | 独立出口（`/api/backends/text-completions/*`），不在首版三协议范围内 | 严格剧情模式须拒绝未受校验的出口；不能假设用户不会切换而允许绕过 |

**认证** —— 候选方案：反向代理保护全部 HTTP 入口，并在 ST 用户解析后绑定 Go 与 ST 身份；集成未运行。

| 事项 | 事实 | 判断 |
|---|---|---|
| server plugin | `init(router)` 只拿独立 Router 挂 `/api/plugins/<id>`，在 `requireLoginMiddleware`（server-main.js:248）与 CSRF 之后，拿不到 app，**不能作认证前置**（server-main.js:313 晚于 setupPrivateEndpoints:278） | plugin 仅做 Go 桥接 API |
| session/多用户 | `cookie-session`（客户端 cookie，HMAC 签名，无服务端 store）；`enableUserAccounts` off 时恒为 default-user；密码 scrypt；session.version 绑定密码（改密踢会话） | — |
| SSO 可信头 | `sso.autheliaAuth` 读 `Remote-User`，仅 `GET /login` 且无既有 session 时触发（users.js:1048），头值须匹配**已存在且启用**的 handle，不自动建号；trustedProxies 校验直连 socket 非 XFF | 反代可注入自动登录 |
| 路由覆盖面 | 业务路由/用户数据文件路由全部在 requireLogin 之后（server-startup.js:141-188 + users.js:1212）；免登录白名单：`/`、`/login`、`/csrf-token`、`public/` 静态、`POST /api/users/{list,login,recover-step1,recover-step2}`；模型响应存在流式 HTTP 通道，也必须受相同入口鉴权保护 | 反代 `auth_request` 全覆盖；须显式拦 login/recover 路由 + 剥离外部身份头 + ST 仅听 127.0.0.1 |
| Go 侧绑定 | 已有只读校验端点 `GET /api/v1/auth/session`（backend/internal/httpapi/core.go:217、auth.go:141）可复用其鉴权逻辑；该端点返回 JSON，且身份响应含 `PasswordMustChange` 等状态，不能直接等同于完整 ST 准入接口。仍须按 ARCH §14 检查会话/TOTP 完成态并输出可信 ST handle | W05 增映射 |
| 会话一致性/主动清理 | 已有 ST session 不因头变化切换或失效（users.js:751-775）；cookie-session 无服务端 store 无法服务端踢除 | W05 必须验证注销、失效及合成账号切换，需绑定补丁（P14） |

### 6.3 集中可重放补丁清单（评估，未实施）

以下为设计候选，不是已验证的完整补丁集。ST 补丁基于锁定 commit `7e8663cd`；拟存放 `integrations/sillytavern/patches/`，每个附理由/版本/可去除条件。

| # | 位置 | 内容 | 预计规模 | 可去除条件 |
|---|---|---|---|---|
| P1 | `src/endpoints/chats.js` `trySaveChat` | base revision 读取/比较/推进 + chat identity 临界区串行（单实例内） | 60–100 行 | 上游原生支持 revision 或 F2 废止 |
| P2 | 同上 `/save`、`/group/save` | `force` 不再豁免项目 revision 检查 | 5–10 行 | 同上 |
| P3–P7 | chats.js `/rename`/`/delete`/`/group/delete`/`/import`/`/group/import`、characters.js `/rename`/`/delete`、groups.js `/delete`、data-maid | 删除墓碑（阻止旧请求重建）、重命名保 identity、导入撞名走 revision 规则、目录迁移同步身份记录 | 每路由 10–25 行，共 ~80 行 | 同上 |
| P8–P11 | 前端 `script.js` `saveChat`、`group-chats.js` `saveGroupChat` 等、`bookmarks.js` | 携带 base revision、移除 OVERWRITE→force 通道改 F2 冲突流程、4 处绕行 fetch 补基线 | 80–120 行 | 同上 |
| P12 | chats.js `trySaveChat` 尾部 | 保存完成通知仅用于加速；Go 仍须对账持久内容，不能仅凭事件判定 delivered | 10–20 行接线估计 | 可靠轮询取代通知 |
| P13 | 自有 server plugin（不改 ST） | 身份/映射/来源查询桥接；聊天写入仍由 ST 受保护入口执行，Go 不平行改写聊天文件 | 未估计 | — |
| P14 | `src/server-main.js:164` 后单点插入 | ST session handle 与可信头映射一致性校验（不一致清 session 拒绝）；W05 必做，Owner-only 不豁免注销失效与合成账号切换验收 | ~30–40 行 | 上游合入 app 级插件钩子或强制 SSO 模式 |
| P15 | `src/endpoints/backends/chat-completions.js` | `/generate` 出站前最小校验兜底（覆盖 Helper optionsInjector 晚注册与 custom-request 绕过通道）；配合前端 SETTINGS_READY 扩展 | 30–60 行 | 前端残余通道被上游收口 |
| P16 | 同文件新增 `sendResponsesRequest` + prompt-converters 转换 | OpenAI Responses 协议（请求映射、流重组、工具、usage、取消、错误） | 300–500 + 流 100–200 行 | 上游实现 Responses |

表中行数是子代理给出的接线估计，尚未通过实现验证，**不构成总规模承诺**；稳定聊天身份、
持久删除状态、重命名/恢复的崩溃顺序、同端异步快照基线、冲突草稿等仍需在获准恢复后闭合设计。
原汇总的“7 文件、8–12 块、600–900 行”未覆盖全部自有逻辑及启动迁移，不作为结论保留。
每个原生入口应调用同一版本检查/提交实现，不能只先检查再在锁外写入；若后续证据表明无法形成
集中可重放补丁，仍须按 ADR-0009 §2 停止并重新决策。Responses 属首版明确需求，尚未实现。

### 6.4 实际启动与冒烟命令及结果

```bash
# 上游拉取与锁定（gitignored：integrations/sillytavern/upstream/）
git clone https://github.com/SillyTavern/SillyTavern.git SillyTavern
git -C SillyTavern checkout 7e8663cd9c184a550b37238218bdd32c6efc68e9  # tag 1.19.0
# Helper/EJS/MVU 同法 checkout 0af42106 / d6f520d1 / d03b7dc8（核验存在后固定）
cd SillyTavern && npm install --no-save --no-audit --no-fund --loglevel=error --no-progress --omit=dev --ignore-scripts  # 667 包
# 启动（.local/st/ 隔离 config 与 dataRoot，仅 127.0.0.1:8742）
# 以下在仓库根目录执行；脚本与测试依赖均仅保留于本机忽略目录
bash integrations/sillytavern/.local/scripts/start-st.sh   # PASS：/version → 1.19.0 / 7e8663cd9
node integrations/sillytavern/.local/scripts/mock-provider.mjs  # 本地固定 provider，:8743
node integrations/sillytavern/.local/scripts/smoke.mjs     # 退出码 1：S10 FAIL，S11–S15 NOT_RUN
```

这里的 S01–S16 是临时脚本步骤编号，**不是 VER §2 的剧情验收用例 S01–S05**。
冒烟结果（真实浏览器：playwright-core 1.64.1 驱动系统 Chrome 156 headless；结果 JSON 在
`.local/artifacts/smoke-result.json`，gitignored）：

- **已验证的子项**：页面加载与 ST 前端就绪；Helper 加载（`globalThis.TavernHelper` 160 API）；
  EJS 加载（设置面板 + `pt_enabled=true` + console `ST-Prompt-Template initialized`）；
  `/api/extensions/discover` 列出两扩展；Chat Completion→Custom 指向本地 mock 连接终态"有效的"
  （ST custom source 设计上不发探测请求，真实出站证据在发送链）；合成卡导入（含 3 条世界书
  条目 + 1 条 Helper 脚本，强断言字段齐备）；角色已选中且聊天对象存在开场白（唯一角色名，新聊天；最后一次记录 `dom_mes=0`，不证明开场白已可见渲染）；
  世界书导入弹窗确认；公开 API 启用角色脚本并持久化（`extension_settings.tavern_helper.script.
  enabled.characters` 含 avatar，reload 后仍生效）。
- **S10 FAIL；S11–S15 NOT_RUN**：`window.Mvu` 60s 未出现 → MVU `[InitVar]` 初始化、发送→mock 回复、
  最终请求内容捕获、聊天 JSONL 落盘全部 NOT_RUN（级联）。三次针对性修复（①Helper 启用弹窗
  处理——原测试未覆盖 Helper 自有 useModal 弹窗；②唯一角色名隔离消除
  状态残留；③公开 API 写入启用列表 + reload）后仍未通，已用尽 Owner 允许的修复次数。
- **诊断事实与限制**：自托管 bundle HTTP 200（611598 字节）；终端 curl 对 testingcf.jsdelivr.net
  的 vue、log.js 及 gcore.jsdelivr.net 的 vue 三个 URL 均返回 200。这不能排除浏览器 iframe 的
  请求、模块加载或运行错误。主页面未捕获 console/pageerror，不等于 iframe 内没有错误；
  脚本启用状态已持久化，但 iframe 是否实际执行及失败原因仍未定位。

验证结束后已停止本轮 ST（8742）与固定 provider（8743）进程；本机合成数据和失败结果保留。

### 6.5 结论与限制

1. **W00 BLOCKED，触发 §2.4 三次修复暂停条件。** 没有运行第四次修复；W01 以及依赖 W00 的
   后续工作均未启动。需要 Owner 决定是否恢复 W00 定位 Helper 角色脚本加载，不能把该阻塞推迟到 W03。
2. **R-CDN（版本锁限制）**：Helper 4.11.3 的 iframe 运行期引用未锁版本的 CDN 资源，涉及
   jquery/jquery-ui/vue/vue-router/fontawesome/log.js。四个仓库 commit 已固定，不等于完整运行依赖
   已固定；后续必须补齐这些资源的固定版本/自托管，不能直接接受可变 URL 为完成状态。
3. **恢复排查的候选入口（未执行）**：获准继续 W00 后，用 headed 浏览器检查当前角色的 Helper
   脚本库、实际 iframe 创建、frame console 与 network；保留现有合成状态，不先假设是网络故障。
   本机忽略目录保留测试脚本与失败结果；这些临时脚本不是仓库新增测试编排入口。
4. **未验证项**：F2 原子基线检查、稳定身份/删除墓碑/恢复顺序、监听器运行时顺序、三协议最终
   出站与工具后续轮次、Go/ST 绑定均未实现或未运行。静态定位只提供后续设计输入，不记为用例 PASS。
5. **委派设置**：ZCode 主会话界面为 GLM-5.3／最高思考；3 个 `general-purpose` 只读子代理
   已完成，无嵌套、无写入。ZCode 报告子代理元数据为 `claude-fable-5-1`，无法据此确认其实际模型
   符合 GLM-5.3 要求，后续委派须先核实；本轮不声称子代理模型配置已满足。
6. 目录约定（§4）已应用于 `.gitignore` 和 `upstream.lock.json`；未创建业务扩展或核心补丁。
   进度与提交记录仅写入 TODO 的 V2-W00 条目。

## 7. W01 模块处置表与清理记录（待回填）

尚未执行。

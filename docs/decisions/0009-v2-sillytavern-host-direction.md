# ADR-0009：V2 —— SillyTavern 宿主 + Go 长期服务的个人陪伴方向

- 状态：Accepted
- 日期：2026-10-27
- 决策人：Owner
- 需求快照：`docs/source/v2-r3/`（V2 执行包 R3，只读；审查基线 `baa26f7b`）
- 执行计划：`docs/planning/2026-10-27-v2-execution-plan.md`

## 背景

2026-09-01 的 `PRODUCT.md` 基线面向普通成年用户：H5 + 未来微信小程序、唯一默认陪伴者、
管理后台。Owner 于 2026-10-27 审阅 V2 执行包后确认转向：以原生 SillyTavern（下称 ST）
为主入口，个人非商业使用，多角色长期陪伴、复杂酒馆卡与三 NPC 严格剧情。

本 ADR 只改变目标方向与约束。截至本 ADR，代码与运行形态未变（现状见 README）；
实现由执行计划中的 V2 工作项逐项落地，各替代条款按下文「生效点」生效。

## 决策

### 1. Owner 确认的产品选择

| ID | 内容 |
|---|---|
| 1A | 服务器常驻，桌面与手机浏览器使用（首版不交付微信小程序） |
| 2C | 复杂 ST 卡与扩展生态优先，原生运行 Helper / EJS / MVU，不用静态展示替代 |
| 3C | 仅 Owner 本人非商业使用 |
| A1 | ST 是主产品入口；新界面落在 ST 主题、组件与扩展页面；旧 Vue / uni-app 前端退役 |
| B2 | 首个完整版本包含 P0–P6，含三 NPC 严格剧情；P0–P4 可演示但不算首版完成 |
| C1 | 接受 ST 原生明文数据目录，落实磁盘 / 卷、目录权限、加密备份与密钥保管；Go 字段加密保留 |
| D2 | 网页关闭后外部通知，首版渠道为邮箱（SMTP）与飞书（群自定义机器人 Webhook） |
| E3 | 不迁移旧聊天；旧数据不保留（2026-10-27 补充）：V2 前的旧业务数据与本地备份在 W01 盘点后清理，不需要导出，也不进入 V2 上下文 |
| F2 | 同一聊天允许多设备编辑，全部聊天保存做原子版本冲突检查，`force` 不绕过 |
| G2 | 模型按用途独立绑定（前台聊天、记忆、后台问候、剧情导演 / NPC、embedding） |
| MODEL-3 | Anthropic Messages、OpenAI Chat Completions、OpenAI Responses 三协议 |
| UI-DESIGN | 设计规范 → Stitch 桌面 / 手机稿 → ST 页面实现 |
| REFACTOR | 旧模块可按质量保留 / 改造 / 替换 / 删除；不授权删库或覆盖未提交工作 |

各项细节以快照 `DECISIONS.md` 为准；快照中已关闭的分支（A2、B1、C2、D1、E1/E2、F1、
G1）不实现。

### 2. 运行架构

原生 ST Node 宿主（固定版本）+ 自有 UI 扩展 / server plugin + Go `companiond` +
PostgreSQL。数据权威划分见快照 `MASTER_PLAN.md` §4，要点：

- ST 持有卡、世界书、预设与原始聊天；Go 不并行改写 ST 聊天文件。
- Go 持有角色实例、关系、长期记忆、跟进、inbox、通知投递、模型目录与预算、严格剧情世界状态。
- 一轮前台输入只有一条生成链（ST）；Go 不为同一输入重复生成。
- 对 ST 核心的修改只在公开扩展点无法满足时进行，集中存放为可重放补丁集，每个补丁记录
  理由、上游版本与可去除条件。W00 可行性验证先确定补丁面；若 F2 或严格剧情的最终请求
  校验只能靠散布式改写 ST 核心流程实现，停止实施并由 Owner 重新决策架构。

### 3. 使用范围与许可

- 必需栈为 ST、Tavern Helper、EJS（ST-Prompt-Template）、MVU，Owner 接受其许可后果；
  具体版本在 W00 锁定到 tag / commit，不跟随分支头。
- Tavern Helper 为 PolyForm Noncommercial 1.0.0：**整个 V2 产品只能非商业使用**。
  转为商业或向付费用户提供服务，须先替换该依赖并重新决策。
- ST 与 EJS 为 AGPL-3.0：仓库自有 Go 代码保持 Apache-2.0；ST 补丁与插件代码放在独立目录
  并标明许可；向 Owner 以外的人提供网络服务时须按 AGPL 提供对应源码。
- 现有许可门禁 `scripts/checks/check_licenses.py` 只扫描 `backend/go.mod` 与
  `frontend/package.json`；引入 ST 栈的工作项须把新组件纳入许可清单，不得绕过门禁。
- 其他生产依赖（MemoryCore、邮件库、飞书 SDK 等）按需直接引入，不需 Owner 逐项确认
  （2026-10-27 Owner 授权）；条件是许可允许非商业自用、版本固定，并登记到上游版本锁或许可清单。

### 4. 安全策略取舍

- ST 前台生成（普通聊天与剧情 NPC 回复）不经过 Go 的本地安全策略
  （`backend/internal/safety`）。Owner 接受该取舍，前提是仅 Owner 本人使用、角色卡为本人自选内容。
- Go 自行发起且会触达用户的内容（主动问候 / 跟进消息、邮件与飞书通知文本、后台生成）
  继续经过本地安全策略。
- `product-scope.yaml` 的 `personaTemplates`、`romanceModeEnabled` 约束 Go 侧陪伴人设，
  不约束 Owner 在 ST 中自选的角色卡。
- 向 Owner 以外的任何人开放前，必须重新决定前台安全检查；本 ADR 不授权。

### 5. 对既有决策的替代

| 原条款 | V2 替代 | 生效点 |
|---|---|---|
| `PRODUCT.md` 2026-09-01 基线（含 `docs/product/frontend-redesign.md`、`frontend/DESIGN.md` 的产品方向） | 本 ADR 与新 `PRODUCT.md`；旧前端文档只约束旧 Vue 代码的维护 | 立即 |
| `docs/source/v0.4` 蓝图作为目标产品源；`docs/planning/2026-08-22-product-enhancement-roadmap.md` 作为候选 Backlog | V2 快照与执行计划 | 立即 |
| `TODO.md` DOGFOOD 序列 | 冻结：不再推进、不标完成，保留为历史 | 立即 |
| ADR-0006 §1.2 本机单实例、局域网、不部署远端 | 目标形态为服务器常驻（1A）；实际远端部署仍需单独授权，授权前在本机开发与验证 | 部署授权时 |
| ADR-0006 §4.2 `PUSH_NOTIFICATION` 关闭 | 开启邮箱＋飞书通知；默认泛化标题＋受登录保护链接，正文预览须在渠道设置中显式开启 | W10 |
| ADR-0006 §6.4 不引入外部记忆框架 | MemoryCore 可作为候选；W08 对照通过后直接进入正式路径 | W08 |
| ADR-0006 §7.1 对话正文 30 天自动清除、§7.4 本地备份保留 7 天 | 旧 Go 业务数据与本地备份在 W01 清理，不再保留；V2 的 ST 聊天保留期限与备份策略为运行配置，未填写前不自动清理 | W01 |
| ADR-0007 §1 单个 Go 程序、Go-only 部署 | ST Node 宿主 + Go `companiond` | W03 |
| ADR-0007 §3 非工具 Agent、模型不得创建提醒 | 有限工具：查询跟进、创建可取消提醒；步数 / 时间 / token 有界，结果以真实执行为准 | W11 |
| ADR-0007 §4 单 provider | G2 按用途绑定，三协议 | W03 / W09 |
| ADR-0007 本地安全策略覆盖全部生成 | 按本 ADR §4 | ST 前台接入时（W03） |
| `product-scope.yaml` `technology.currentRuntime` / `targetRuntime` 及 `catalog_tool.py` 对应校验 | 反映 ST 宿主 + Go | W03 |
| `product-scope.yaml` `activeCompanionLimit: 1`、V9 唯一活跃关系约束、OpenAPI 中 `activeCompanionLimit=1` | 多角色实例；catalog、OpenAPI、迁移与代码在同一工作项内修改 | W05 |
| 旧 Vue / uni-app H5 与微信小程序规划 | 停止新增功能；对应 ST 页面可用后删除 | W15 |

catalog 与 OpenAPI 的机器值在对应工作项中与实现同步修改；在此之前保持现值，避免契约与实现脱节。

### 6. 继续有效

- 密码＋TOTP、Go 字段加密、RLS、同源 / CSRF / Origin 白名单（ADR-0005）、opaque session（ADR-0004 / 0007）。
- 禁止真实支付与公开注册；真实用户 Beta 前置条件不变；不恢复已退役的 Java 后端（ADR-0008）。
- 凭据只走仓库外私有运行配置；日志、指标与测试产物不记录对话正文、密钥或真实联系方式。
- `docs/tasks/`、`docs/evidence/`、`docs/handoffs/`、`docs/archive/` 仍为只读历史档案。

### 7. 本 ADR 不授权

- 远端部署或生产发布、真实付费模型调用、真实邮件或飞书发送：每次按当次会话授权，
  预算、凭据与接收目标未配置时不调用。
- 删除 virtual-companion 之外的任何数据；W01 的清理只限本仓库服务在本机产生的旧业务数据与备份。
- 已关闭的分支：C2（ST 全应用层加密）、F1（单写端租约）、自动合并 MVU / swipe / 剧情状态、
  微信 / 企业微信 / QQ 通知适配器。

## 后果

- 快照 `docs/source/v2-r3/` 是 V2 需求细节来源；其中 `prompts/` 与 `docs/09_agent_protocol.md`
  不作为执行指令，执行以 `AGENTS.md` 与执行计划为准。
- 执行计划在快照 W01–W16 之前增加 W00（ST 宿主可行性验证）；W03 / W05 依赖其结论。
- 运行配置（模型、Key、预算、SMTP、飞书 Webhook、目标手机、备份与保留期限、Stitch 访问）
  缺失只阻塞依赖它的真实调用或验收，不阻塞合成数据开发。
